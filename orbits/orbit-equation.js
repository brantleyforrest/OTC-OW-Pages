// Orbit Equation Explorer: r = a (1 - e^2) / (1 + e cos nu), drawn around a 3D Earth.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;

    const status = $('status');
    function showStatus(text) {
        status.style.display = 'flex';
        status.textContent = text;
    }

    showStatus('Loading the 3D view.');
    let THREE;
    try {
        THREE = await import(THREE_URL);
    } catch (err) {
        showStatus('The 3D library could not be loaded. This tool needs an internet connection the first time it opens.');
        return;
    }

    /* Physical constants */
    const R_E = 6378.137;      // km
    const MU = 398600.4418;    // km^3/s^2
    const D2R = Math.PI / 180;
    const TWO_PI = 2 * Math.PI;

    /* Limits and animation ranges */
    const LIMITS = {
        a: { min: 6378, max: 500000, sweepMin: 10000, sweepMax: 60000 },
        e: { min: 0, max: 0.99, sweepMin: 0, sweepMax: 0.7 },
        nu: { min: 0, max: 360 }
    };
    const DEFAULTS = { a: 26000, e: 0.3, nu: 0 };
    const SWEEP_SECONDS = 8;   // One pass through a range at normal speed
    const ORBIT_SECONDS = 12;  // One orbit at normal speed
    const EARTH_SPIN = 12;     // Degrees per second at normal speed
    const SPEEDS = [
        { rate: 0.5, label: 'Slow' },
        { rate: 1, label: 'Normal' },
        { rate: 2, label: 'Fast' }
    ];

    /* Scene settings */
    const HOME_VIEW = { az: -68, el: 52, zoom: 1 };
    const ZOOM = { min: 0.2, max: 3 };
    const FOV = 38;
    const AXIS_SCALE = 1.15;   // Axis length as a multiple of a
    const AXIS_MIN = 1.9;      // Shortest axis, in Earth radii
    const RING_KM = [20000, 40000, 60000, 80000, 120000, 160000, 240000, 320000, 480000, 640000, 960000]; // Distance rings
    const RING_POINTS = 128;
    const RING_OPACITY = 0.4;
    const A_ZOOM_SHARE = 0.6;  // While a is changing, the view's size grows as a to this power
    const SLIDER_EASE = 14;    // How quickly the orbit catches up to the a slider, per second
    const COLORS = { a: 0xe0b64f, e: 0x34d399, nu: 0xc4a1ff, r: 0xffffff, eci: 0x60a5fa };

    /* State */
    const state = {
        ...DEFAULTS,
        sweep: 'nu',
        sweepDir: 1,
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        spin: 0,
        showLabels: true
    };
    const camView = { ...HOME_VIEW };
    const camFit = { cx: 0, radius: 6 };   // Eased toward the target fit, in Earth radii
    let heldFit = null;                    // Keeps one scale throughout an animation of e
    let showRings = false;                 // Distance rings and partial zoom while a is being changed
    let aGoal = null;                      // The value the orbit is easing toward after a slider move
    let sliderOwner = null;                // The parameter last set by its slider, which keeps its position

    /* The orbit equation and the values that follow from it */
    const radiusAt = (nu) => state.a * (1 - state.e * state.e) / (1 + state.e * Math.cos(nu * D2R));

    function orbitValues() {
        const { a, e } = state;
        return {
            r: radiusAt(state.nu),
            rp: a * (1 - e),
            ra: a * (1 + e),
            T: TWO_PI * Math.sqrt(a * a * a / MU)
        };
    }

    /* Kepler's second law: motion along the orbit, with equal areas in equal times */
    function advanceAnomaly(nuDeg, deltaMean, e) {
        const half = nuDeg * D2R / 2;
        const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(half), Math.sqrt(1 + e) * Math.cos(half));
        let M = E0 - e * Math.sin(E0) + deltaMean;
        M = ((M + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
        let E = M + (Math.sin(M) >= 0 ? e : -e);
        for (let i = 0; i < 16; i++) {
            const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= step;
            if (Math.abs(step) < 1e-10) break;
        }
        const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        return ((nu / D2R) % 360 + 360) % 360;
    }

    /* Renderer */
    const view = $('view');
    const canvas = $('scene');
    const hud = $('hud');
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
        showStatus('This browser could not start the 3D view. WebGL must be enabled to use this tool.');
        return;
    }
    renderer.setClearColor(0x03060c);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(4, -5, 4);
    scene.add(sun);

    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const stars = window.EarthScene.addStars(THREE, scene);

    /* A curve in the orbit plane, drawn as a thin tube with a set width on screen */
    const TUBE_SIDES = 6;
    function makeTube(count, closed, color, opacity = 1) {
        const positions = new Float32Array(count * TUBE_SIDES * 3);
        const index = [];
        const segments = closed ? count : count - 1;
        for (let i = 0; i < segments; i++) {
            const next = (i + 1) % count;
            for (let s = 0; s < TUBE_SIDES; s++) {
                const t = (s + 1) % TUBE_SIDES;
                const a = i * TUBE_SIDES + s, b = i * TUBE_SIDES + t;
                const c = next * TUBE_SIDES + s, d = next * TUBE_SIDES + t;
                index.push(a, c, b, b, c, d);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setIndex(index);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color, side: THREE.DoubleSide, transparent: opacity < 1, opacity
        }));
        mesh.frustumCulled = false;
        scene.add(mesh);
        return { mesh, count, closed, xs: new Float64Array(count), ys: new Float64Array(count) };
    }

    function writeTube(tube, width) {
        const { count, closed, xs, ys } = tube;
        const attr = tube.mesh.geometry.attributes.position;
        const out = attr.array;
        let o = 0;
        for (let i = 0; i < count; i++) {
            const prev = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
            const next = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
            let nx = -(ys[next] - ys[prev]), ny = xs[next] - xs[prev];
            const len = Math.hypot(nx, ny) || 1;
            nx /= len;
            ny /= len;
            for (let s = 0; s < TUBE_SIDES; s++) {
                const a = s / TUBE_SIDES * TWO_PI;
                const ca = Math.cos(a) * width, sa = Math.sin(a) * width;
                out[o++] = xs[i] + nx * ca;
                out[o++] = ys[i] + ny * ca;
                out[o++] = sa;
            }
        }
        attr.needsUpdate = true;
    }

    /* A straight line, drawn as a thin cylinder */
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const lineGeometry = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
    function makeLine(color, opacity = 1) {
        const mesh = new THREE.Mesh(lineGeometry, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
        scene.add(mesh);
        return mesh;
    }

    const direction = new THREE.Vector3();
    function setLine(mesh, x0, y0, x1, y1, width) {
        direction.set(x1 - x0, y1 - y0, 0);
        const len = direction.length() || 1e-6;
        mesh.position.set(x0, y0, 0);
        mesh.quaternion.setFromUnitVectors(Y_AXIS, direction.divideScalar(len));
        mesh.scale.set(width, len, width);
    }

    function makeDot(color) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color }));
        scene.add(mesh);
        return mesh;
    }

    /* Inertial frame axes */
    const layer = new Kit.LabelLayer($('labels'));
    const axes = [
        [1, 0, 0, 'Î', 'vernal equinox'],
        [0, 1, 0, 'Ĵ', ''],
        [0, 0, 1, 'K̂', 'north']
    ].map(([x, y, z, name, hint]) => ({
        dir: new THREE.Vector3(x, y, z),
        arrow: new THREE.ArrowHelper(new THREE.Vector3(x, y, z), new THREE.Vector3(), 2, COLORS.eci, 0.2, 0.1),
        tip: new THREE.Vector3(),
        label: layer.add(`<b style="color:#60a5fa">${name}</b>${hint ? `<span class="hint">${hint}</span>` : ''}`, { rank: 3, optional: true })
    }));
    axes.forEach((axis) => scene.add(axis.arrow));

    /* Orbit parts */
    const ORBIT_POINTS = 360;
    const ARC_POINTS = 64;
    const orbitTube = makeTube(ORBIT_POINTS, true, COLORS.e);
    const arcTube = makeTube(ARC_POINTS, false, COLORS.nu);
    const apsisLine = makeLine(COLORS.e, 0.45);
    const aLine = makeLine(COLORS.a);
    const rLine = makeLine(COLORS.r);
    const craft = makeDot(0xffffff);
    const perigeeDot = makeDot(COLORS.e);
    const apogeeDot = makeDot(COLORS.e);
    const centerDot = makeDot(COLORS.a);

    /* Rings at fixed distances from Earth's center, shown while a is being changed, so that
       the orbit's growth reads against a fixed ruler. */
    const rings = RING_KM.map((distance) => {
        const tube = makeTube(RING_POINTS, true, 0x94a3b8, RING_OPACITY);
        for (let i = 0; i < RING_POINTS; i++) {
            const angle = i / RING_POINTS * TWO_PI;
            tube.xs[i] = distance / R_E * Math.cos(angle);
            tube.ys[i] = distance / R_E * Math.sin(angle);
        }
        return {
            tube,
            radius: distance / R_E,
            label: layer.add(`<span style="color:#cbd5e1">${distance.toLocaleString('en-US')} km</span>`, { rank: 4, optional: true })
        };
    });

    const labels = {
        craft: layer.add('<b>Spacecraft</b>', { rank: 0 }),
        r: layer.add('<b>r</b>', { rank: 1 }),
        a: layer.add('<b style="color:#e0b64f">a</b>', { rank: 1 }),
        nu: layer.add('<b style="color:#c4a1ff">ν</b>', { rank: 1 }),
        perigee: layer.add('<b style="color:#34d399">Perigee</b>', { rank: 2 }),
        apogee: layer.add('<b style="color:#34d399">Apogee</b>', { rank: 2 })
    };

    /* Framing: the view fits the orbit. An animation of e holds one scale, so that the change
       in shape is visible. An animation of a zooms only part of the way, so that the orbit
       visibly grows on screen as the view zooms out, and reaches the edge of the view at the
       top of the range. */
    function fitFor(a, e) {
        const xMin = Math.min(-a * (1 + e) / R_E, -1.25);
        const xMax = Math.max(AXIS_SCALE * a / R_E, AXIS_MIN); // The Î axis reaches past perigee.
        const yMax = xMax; // The Ĵ axis reaches past the orbit, whose half-width is at most a.
        return { cx: (xMin + xMax) / 2, radius: Math.max((xMax - xMin) / 2, yMax, 1.6) };
    }

    function sweepFit() {
        if (state.sweep === 'e') return fitFor(state.a, Math.max(state.e, LIMITS.e.sweepMax));
        return null;
    }

    function currentFit() {
        if (heldFit) return heldFit;
        if (!showRings) return fitFor(state.a, state.e);
        const top = Math.max(state.a, LIMITS.a.sweepMax);
        return fitFor(top * Math.pow(state.a / top, A_ZOOM_SHARE), state.e);
    }

    let viewW = 1, viewH = 1, camDistance = 20;
    const target = new THREE.Vector3();

    function easeCamera(seconds) {
        const goal = currentFit();
        const k = seconds < 0 ? 1 : 1 - Math.exp(-seconds * 5);
        camFit.cx += (goal.cx - camFit.cx) * k;
        camFit.radius += (goal.radius - camFit.radius) * k;
        return Math.abs(goal.cx - camFit.cx) > 1e-3 || Math.abs(goal.radius / camFit.radius - 1) > 1e-3;
    }

    function updateCamera() {
        // The sphere around the orbit fits within both the height and the width of the view.
        const vertical = Math.sin(FOV / 2 * D2R);
        const horizontal = Math.sin(Math.atan(Math.tan(FOV / 2 * D2R) * viewW / viewH));
        const zoomed = Math.min(1, camView.zoom);
        camDistance = camFit.radius * 1.12 / Math.min(vertical, horizontal) * camView.zoom;
        target.set(camFit.cx * zoomed * zoomed, 0, 0);
        const el = camView.el * D2R, az = camView.az * D2R;
        camera.position.set(
            target.x + camDistance * Math.cos(el) * Math.cos(az),
            camDistance * Math.cos(el) * Math.sin(az),
            camDistance * Math.sin(el)
        );
        // Keep the camera outside Earth when zoomed in.
        const fromCenter = camera.position.length();
        if (fromCenter < 1.5) camera.position.multiplyScalar(1.5 / fromCenter);
        camera.lookAt(target);
        camera.near = Math.max(0.02, camDistance * 0.004);
        camera.far = camDistance * 8 + 20;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    /* Move every object to the current values. Lengths are in Earth radii. */
    const perPixel = () => 2 * camera.position.distanceTo(target) * Math.tan(FOV / 2 * D2R) / viewH;

    function updateScene() {
        const { e, nu } = state;
        const px = perPixel();
        const lineWidth = px * 0.9;
        const a = state.a / R_E;

        // Even steps in eccentric anomaly keep the curve smooth at high eccentricity.
        const b = a * Math.sqrt(1 - e * e);
        for (let i = 0; i < ORBIT_POINTS; i++) {
            const E = i / ORBIT_POINTS * TWO_PI;
            orbitTube.xs[i] = a * (Math.cos(E) - e);
            orbitTube.ys[i] = b * Math.sin(E);
        }
        writeTube(orbitTube, lineWidth * 1.2);

        const rNow = radiusAt(nu) / R_E;
        const cx = rNow * Math.cos(nu * D2R), cy = rNow * Math.sin(nu * D2R);
        const rp = a * (1 - e), ra = a * (1 + e);

        setLine(rLine, 0, 0, cx, cy, lineWidth);
        // The semi-major axis runs from the center of the ellipse out to apogee.
        setLine(aLine, -a * e, 0, -ra, 0, lineWidth * 1.1);
        setLine(apsisLine, -ra, 0, rp, 0, lineWidth * 0.6);

        craft.position.set(cx, cy, 0);
        craft.scale.setScalar(px * 5.5);
        craft.visible = rNow >= 1;
        perigeeDot.position.set(rp, 0, 0);
        apogeeDot.position.set(-ra, 0, 0);
        perigeeDot.scale.setScalar(px * 3.5);
        apogeeDot.scale.setScalar(px * 3.5);
        perigeeDot.visible = apogeeDot.visible = e > 0.001;
        apsisLine.visible = e > 0.001;
        centerDot.position.set(-a * e, 0, 0);
        centerDot.scale.setScalar(px * 3);
        centerDot.visible = a * e > 1.05;

        // The true anomaly arc, drawn clear of Earth and inside the orbit where there is room.
        const arcRadius = Math.max(1.28, Math.min(0.5 * rp, 0.32 * camFit.radius));
        for (let i = 0; i < ARC_POINTS; i++) {
            const angle = i / (ARC_POINTS - 1) * nu * D2R;
            arcTube.xs[i] = arcRadius * Math.cos(angle);
            arcTube.ys[i] = arcRadius * Math.sin(angle);
        }
        writeTube(arcTube, lineWidth * 1.3);
        arcTube.mesh.visible = nu > 0.5;

        const axisLength = Math.max(AXIS_MIN, AXIS_SCALE * a);
        for (const axis of axes) {
            axis.arrow.setLength(axisLength, axisLength * 0.07, axisLength * 0.03);
            axis.tip.copy(axis.dir).multiplyScalar(axisLength);
        }

        // Rings too small to read against the current scale fade out.
        for (const ring of rings) {
            ring.fade = showRings ? Math.min(1, Math.max(0, (ring.radius / camFit.radius - 0.12) / 0.1)) : 0;
            ring.tube.mesh.visible = ring.fade > 0;
            if (ring.fade > 0) {
                ring.tube.mesh.material.opacity = RING_OPACITY * ring.fade;
                writeTube(ring.tube, lineWidth * 0.6);
            }
        }

        earth.pivot.rotation.z = state.spin * D2R;
    }

    /* Labels. A label is hidden when Earth blocks the line of sight to its point. */
    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const anchor = new THREE.Vector3();

    function isBlocked(point) {
        toPoint.copy(point).sub(camera.position);
        const distance = toPoint.length();
        toPoint.divideScalar(distance);
        const along = -camera.position.dot(toPoint);
        const offCenter = camera.position.lengthSq() - along * along;
        if (offCenter >= 1) return false;
        const entry = along - Math.sqrt(1 - offCenter);
        return entry > 0 && entry < distance;
    }

    function showLabel(label, x, y, z) {
        anchor.set(x, y, z);
        if (isBlocked(anchor)) return;
        projected.copy(anchor).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        const sx = (projected.x + 1) * 0.5 * viewW, sy = (1 - projected.y) * 0.5 * viewH;
        if (sx < 0 || sx > viewW || sy < 0 || sy > viewH) return;
        layer.show(label, sx, sy);
    }

    function updateLabels() {
        layer.begin();
        if (state.showLabels) {
            const { e, nu } = state;
            const a = state.a / R_E;
            const rNow = radiusAt(nu) / R_E;
            const cx = rNow * Math.cos(nu * D2R), cy = rNow * Math.sin(nu * D2R);
            if (rNow >= 1) {
                showLabel(labels.craft, cx, cy, 0);
                showLabel(labels.r, cx * 0.62, cy * 0.62, 0);
            }
            showLabel(labels.a, -a * e - a / 2, 0, 0);
            if (e > 0.001) {
                showLabel(labels.perigee, a * (1 - e), 0, 0);
                showLabel(labels.apogee, -a * (1 + e), 0, 0);
            }
            if (nu > 8) {
                const rp = a * (1 - e);
                const arcRadius = Math.max(1.28, Math.min(0.5 * rp, 0.32 * camFit.radius));
                const mid = nu / 2 * D2R;
                showLabel(labels.nu, arcRadius * Math.cos(mid), arcRadius * Math.sin(mid), 0);
            }
            for (const axis of axes) showLabel(axis.label, axis.tip.x, axis.tip.y, axis.tip.z);
            if (showRings) {
                for (const ring of rings) {
                    if (ring.fade > 0.5) showLabel(ring.label, 0, -ring.radius, 0);
                }
            }
        }
        layer.place(viewW, viewH, [Kit.overlayBox(hud, view)]);
    }

    function renderFrame() {
        updateCamera();
        updateScene();
        stars.follow(camera);
        renderer.render(scene, camera);
        updateLabels();
    }

    /* Number formats */
    const km = (value) => `${Math.round(value).toLocaleString('en-US')} km`;

    function formatPeriod(seconds) {
        const hours = seconds / 3600;
        if (hours < 48) {
            const h = Math.floor(hours);
            const m = Math.floor((seconds - h * 3600) / 60);
            return `${h} h ${String(m).padStart(2, '0')} m`;
        }
        return `${(hours / 24).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} days`;
    }

    const formatE = (e) => {
        const text = e.toFixed(3);
        return text.endsWith('0') ? e.toFixed(2) : text;
    };
    const formatNu = (nu) => (Number.isInteger(nu) ? String(nu) : nu.toFixed(1));

    /* The a slider is logarithmic, so that near-Earth orbits have as much room as distant ones */
    const aLogRange = Math.log(LIMITS.a.max / LIMITS.a.min);
    const aToSlider = (a) => Math.log(a / LIMITS.a.min) / aLogRange * 1000;
    const sliderToA = (s) => LIMITS.a.min * Math.exp(s / 1000 * aLogRange);

    /* Panels */
    const inputs = {
        a: { number: $('a-number'), range: $('a-range'), button: $('a-animate'), show: (v) => String(Math.round(v)), slider: aToSlider },
        e: { number: $('e-number'), range: $('e-range'), button: $('e-animate'), show: formatE, slider: (v) => v },
        nu: { number: $('nu-number'), range: $('nu-range'), button: $('nu-animate'), show: (v) => formatNu(Math.round(v * 10) / 10), slider: (v) => v }
    };

    function updatePanels() {
        const { a, e, nu } = state;
        const values = orbitValues();
        const nuShown = state.playing && state.sweep === 'nu' ? Math.round(nu) : Math.round(nu * 10) / 10;

        for (const key of Object.keys(inputs)) {
            const control = inputs[key];
            if (document.activeElement !== control.number) control.number.value = control.show(state[key]);
            if (sliderOwner !== key) control.range.value = control.slider(state[key]);
            const running = state.playing && state.sweep === key;
            control.button.setAttribute('aria-pressed', String(running));
            control.button.textContent = running ? 'Stop' : 'Animate';
        }

        $('eq-a').textContent = Math.round(a).toLocaleString('en-US');
        $('eq-e').textContent = formatE(e);
        $('eq-e2').textContent = formatE(e);
        $('eq-nu').textContent = `${formatNu(nuShown)}°`;
        $('eq-r').textContent = km(values.r);

        $('val-r').textContent = km(values.r);
        $('val-alt').textContent = km(values.r - R_E);
        $('val-rp').textContent = km(values.rp);
        $('val-ra').textContent = km(values.ra);
        $('val-shape').textContent = e <= 0.001 ? 'Circle' : 'Ellipse';
        $('val-t').textContent = formatPeriod(values.T);

        updateHud(values);
    }

    let hudText = '';
    function updateHud(values) {
        const below = values.rp < R_E;
        let text;
        if (below) {
            text = `Perigee is ${km(R_E - values.rp)} below Earth's surface. The equation still gives this ellipse, but a spacecraft on this path would strike Earth.`;
        } else if (state.playing && state.sweep === 'a') {
            text = 'As a grows, the orbit expands across the rings, which mark fixed distances from Earth. The view also zooms out, so Earth looks smaller.';
        } else if (state.playing && state.sweep === 'e') {
            text = 'Changing e changes the shape of the orbit. The size a stays the same, so perigee moves in as apogee moves out by the same distance.';
        } else if (state.playing && state.sweep === 'nu') {
            text = state.e <= 0.001
                ? 'With e at zero, the orbit is a circle, so r equals a at every ν.'
                : 'As ν advances, r changes while the orbit stays fixed. The spacecraft moves fastest at perigee and slowest at apogee.';
        } else if (showRings) {
            text = 'The rings mark fixed distances from Earth, so the size of the orbit can be read against them.';
        } else if (state.e <= 0.001) {
            text = 'With e at zero, the orbit is a circle, so r equals a at every ν.';
        } else {
            text = 'The white line is r, the result of the equation for the current values.';
        }
        hud.classList.toggle('warning', below);
        if (text !== hudText) {
            hudText = text;
            hud.textContent = text;
        }
    }

    /* Controls */
    let dirty = true;

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
        updatePanels();
        dirty = true;
    }

    function startSweep(key) {
        state.sweep = key;
        const limit = LIMITS[key];
        if (key !== 'nu') state.sweepDir = state[key] >= limit.sweepMax ? -1 : 1;
        aGoal = null;
        sliderOwner = null;
        heldFit = sweepFit();
        showRings = key === 'a';
        setPlaying(true);
    }

    // A value entered by hand stops the animation of that value only.
    function setByUser(key, value) {
        state[key] = value;
        if (state.playing && state.sweep === key) setPlaying(false);
        if (key !== 'nu') heldFit = state.playing ? sweepFit() : null;
        if (key === 'a') {
            aGoal = null;
            showRings = true;
        }
        dirty = true;
    }

    for (const key of Object.keys(inputs)) {
        const control = inputs[key];
        const limit = LIMITS[key];

        control.button.addEventListener('click', () => {
            if (state.playing && state.sweep === key) setPlaying(false);
            else startSweep(key);
        });

        control.range.addEventListener('input', () => {
            const raw = Number(control.range.value);
            sliderOwner = key;
            if (key === 'a') {
                // The orbit eases toward the slider, so that its steps do not show as jumps.
                const from = state.a;
                setByUser('a', Math.round(sliderToA(raw)));
                aGoal = state.a;
                state.a = from;
            } else {
                setByUser(key, raw);
            }
        });

        // Apply each valid value while typing. Out-of-range values are marked, then limited on leaving the box.
        control.number.addEventListener('input', () => {
            const value = Number(control.number.value);
            control.edited = true;
            const valid = control.number.value.trim() !== '' && value >= limit.min && value <= limit.max;
            control.number.setAttribute('aria-invalid', String(!valid));
            if (valid) {
                sliderOwner = null;
                setByUser(key, value);
            }
        });

        const finishEntry = () => {
            const value = Number(control.number.value);
            control.number.setAttribute('aria-invalid', 'false');
            // Leaving the box without typing keeps the current value and any animation that is running.
            const typed = control.edited;
            control.edited = false;
            if (typed && control.number.value.trim() !== '' && Number.isFinite(value)) {
                sliderOwner = null;
                setByUser(key, Math.min(limit.max, Math.max(limit.min, value)));
            }
            control.number.value = control.show(state[key]);
        };
        control.number.addEventListener('change', finishEntry);
        control.number.addEventListener('blur', finishEntry);
        control.number.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') control.number.blur();
        });
    }

    $('play').addEventListener('click', () => {
        if (state.playing) setPlaying(false);
        else startSweep(state.sweep);
    });
    $('reset-values').addEventListener('click', () => {
        Object.assign(state, DEFAULTS);
        aGoal = null;
        sliderOwner = null;
        heldFit = state.playing ? sweepFit() : null;
        showRings = state.playing && state.sweep === 'a';
        dirty = true;
    });
    $('reset-view').addEventListener('click', () => {
        Object.assign(camView, HOME_VIEW);
        dirty = true;
    });
    $('speed').addEventListener('input', (event) => {
        state.speed = Number(event.target.value);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    $('show-labels').addEventListener('change', (event) => {
        state.showLabels = event.target.checked;
        dirty = true;
    });

    /* Drag to rotate. Scroll or pinch to zoom. */
    const hint = $('view-hint');
    const pointers = new Map();
    let pinchStart = 0, pinchZoom = 1;
    const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (event) => {
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            pinchZoom = camView.zoom;
        }
        hint.style.display = 'none';
    });
    canvas.addEventListener('pointermove', (event) => {
        const last = pointers.get(event.pointerId);
        if (!last) return;
        if (pointers.size === 1) {
            camView.az -= (event.clientX - last.x) * 0.35;
            camView.el = Math.min(88, Math.max(-88, camView.el + (event.clientY - last.y) * 0.3));
        }
        last.x = event.clientX;
        last.y = event.clientY;
        if (pointers.size === 2 && pinchStart > 0) {
            const [a, b] = [...pointers.values()];
            camView.zoom = clampZoom(pinchZoom * pinchStart / Math.hypot(a.x - b.x, a.y - b.y));
        }
        dirty = true;
    });
    const endPointer = (event) => pointers.delete(event.pointerId);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        camView.zoom = clampZoom(camView.zoom * Math.exp(event.deltaY * 0.0012));
        dirty = true;
    }, { passive: false });

    /* Advance the running animation */
    function advance(seconds) {
        const rate = SPEEDS[state.speed].rate;
        state.spin = (state.spin + seconds * rate * EARTH_SPIN) % 360;

        if (state.sweep === 'nu') {
            state.nu = advanceAnomaly(state.nu, seconds * rate * TWO_PI / ORBIT_SECONDS, state.e);
            return;
        }
        const limit = LIMITS[state.sweep];
        if (state.sweep === 'a') {
            // Even steps on a logarithmic scale, as on the slider.
            const factor = Math.exp(state.sweepDir * seconds * rate * Math.log(limit.sweepMax / limit.sweepMin) / SWEEP_SECONDS);
            state.a *= factor;
        } else {
            state.e += state.sweepDir * seconds * rate * (limit.sweepMax - limit.sweepMin) / SWEEP_SECONDS;
        }
        if (state.sweepDir > 0 && state[state.sweep] >= limit.sweepMax) {
            state[state.sweep] = limit.sweepMax;
            state.sweepDir = -1;
        } else if (state.sweepDir < 0 && state[state.sweep] <= limit.sweepMin) {
            state[state.sweep] = limit.sweepMin;
            state.sweepDir = 1;
        }
    }

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    setPlaying(state.playing);
    easeCamera(-1);
    status.style.display = 'none';

    Kit.observeSize(view, (width, height) => {
        viewW = width;
        viewH = height;
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        layer.remeasure();
        renderFrame(); // Resizing clears the canvas, so draw at once to avoid a blank frame.
    });

    updatePanels();

    Kit.startLoop((seconds) => {
        if (state.playing) {
            advance(seconds);
            dirty = true;
        }
        if (aGoal !== null) {
            const k = 1 - Math.exp(-seconds * SLIDER_EASE);
            state.a *= Math.pow(aGoal / state.a, k);
            if (Math.abs(aGoal / state.a - 1) < 5e-4) {
                state.a = aGoal;
                aGoal = null;
            }
            if (heldFit) heldFit = sweepFit();
            dirty = true;
        }
        if (easeCamera(seconds)) dirty = true;
        if (!dirty) return;
        dirty = false;
        renderFrame();
        updatePanels();
    });
})();
