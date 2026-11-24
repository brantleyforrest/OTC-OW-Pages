// Mechanical Energy: a spacecraft trading kinetic and potential energy in an elliptical orbit
// around a 3D Earth, beside a live bar chart of specific kinetic, potential, and mechanical energy.
(async function () {
    'use strict';

    /* ================================================================== */
    /* ORBIT MATH                                                         */
    /* In mechanical-energy-math.js, section energy.                        */
    /* Constants follow the site settings (orbit-settings-panel.js).      */
    /* ================================================================== */
    const OM = window.OrbitMath;   // its sections follow the constants setting
    let {
        MU, RE, D2R, TWO_PI, wrap, orbitFromAltitudes, eccentricAnomaly, trueFromMean, meanFromTrue,
        ellipsePoint, pointAt, meanMotion, energies
    } = OM.energy;
    // The satellite, stored as r and v: built at perigee from the altitudes (OrbitMath.propagate).
    let track = OM.propagate.tracker();
    // Read the math again after the constants setting changes.
    function rebindMath() {
        track = OM.propagate.tracker();
        ({
            MU, RE, D2R, TWO_PI, wrap, orbitFromAltitudes, eccentricAnomaly, trueFromMean, meanFromTrue,
            ellipsePoint, pointAt
        } = OM.energy);
    }

    /* ================================================================== */
    /* RENDERING AND CONTROLS                                             */
    /* ================================================================== */
    const ALT_MIN = 100;       // km, slider limits
    const ALT_MAX = 100000;    // km

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;

    const statusEl = $('status');
    function showStatus(text) {
        if (statusEl) {
            statusEl.style.display = 'flex';
            statusEl.textContent = text;
        }
    }

    showStatus('Loading the 3D view.');
    let THREE;
    try {
        THREE = await Vendor.three();
    } catch (err) {
        showStatus('The 3D library could not be loaded. This tool needs an internet connection the first time it opens.');
        return;
    }

    const COLORS = {
        ke: '#34d399',
        pe: '#60a5fa',
        total: '#e0b64f',
        orbit: 0x4a88d9,
        apsides: 0x94a3b8,
        craft: 0xffffff,
        dim: '#64748b',
        text: '#f0f4fa',
        muted: '#94a3b8'
    };

    // Seconds of animation for one orbit at each speed setting.
    // The spacecraft follows Kepler's second law, moving fastest at perigee.
    const SPEEDS = [
        { period: 24, label: 'Slow' },
        { period: 12, label: 'Normal' },
        { period: 6, label: 'Fast' }
    ];

    const PRESETS = {
        gto: { hp: 300, ha: 35786 },      // Transfer orbit to geostationary altitude
        molniya: { hp: 600, ha: 39700 },  // A 12-hour, highly elliptical orbit
        lesson: { hp: 500, ha: 1500 },    // The worked example in the 2-Body Motion lesson
        circular: { hp: 1000, ha: 1000 }
    };
    const DEFAULT_PRESET = 'gto';

    /* Camera settings: fixed space-based (inertial) oblique view */
    const HOME_VIEW = { az: -68, el: 52, zoom: 1 };
    const FOV = 38;
    const EARTH_SPIN_RATE = 10; // Degrees per second of simulation when playing

    /* State */
    const state = {
        hp: PRESETS[DEFAULT_PRESET].hp,
        ha: PRESETS[DEFAULT_PRESET].ha,
        preset: DEFAULT_PRESET,
        M: 0,               // Mean anomaly, rad
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        spin: 0,            // Earth rotation angle (rad)
        showVelocity: true,
        showLabels: true
    };
    const camView = { ...HOME_VIEW };
    const camFit = { cx: 0, radius: 6 };
    let dirty = true;
    const orbit = () => orbitFromAltitudes(state.hp, state.ha);

    /* Number formatting */
    const fixed = (value, digits) => (value < 0 ? '−' : '') + Math.abs(value).toFixed(digits);
    const comma = (value) => Math.round(value).toLocaleString('en-US');

    /* 3D Scene & Renderer */
    const orbitPane = $('orbit-pane');
    const sceneCanvas = $('scene');
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas: sceneCanvas, antialias: true });
    } catch (err) {
        showStatus('This browser could not start the 3D view. WebGL must be enabled to use this tool.');
        return;
    }
    renderer.setClearColor(0x03060c);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(4, -5, 4);
    scene.add(sun);

    // Shared Earth and star field (Earth has radius 1.0, centered at origin, Z points north)
    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const stars = window.EarthScene.addStars(THREE, scene);
    if (statusEl) statusEl.style.display = 'none';

    /* 3D Orbit curve tube */
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

    /* 3D Straight lines (thin cylinders) */
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const NEG_Y_AXIS = new THREE.Vector3(0, -1, 0);
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

    /* Orbit parts in scene coordinates (Earth radii) */
    const ORBIT_POINTS = 360;
    const orbitTube = makeTube(ORBIT_POINTS, true, COLORS.orbit, 0.95);
    const apsisLine = makeLine(COLORS.apsides, 0.4);
    const radiusLine = makeLine(0xcbd5e1, 0.5);
    const craft = makeDot(COLORS.craft);
    const perigeeDot = makeDot(0x34d399);
    const apogeeDot = makeDot(0x60a5fa);

    /* Velocity arrows */
    const velArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x34d399, 0.2, 0.12);
    scene.add(velArrow);

    function makeGhostArrow() {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x34d399, 0.2, 0.12);
        arrow.line.material.transparent = true;
        arrow.line.material.opacity = 0.35;
        arrow.cone.material.transparent = true;
        arrow.cone.material.opacity = 0.35;
        scene.add(arrow);
        return arrow;
    }
    const periArrow = makeGhostArrow();
    const apoArrow = makeGhostArrow();

    /* Labels */
    const layer = new Kit.LabelLayer($('labels'));
    const labels = {
        craft: layer.add('', { rank: 0 }),
        perigee: layer.add('<b>Perigee</b><span class="hint">fastest</span>', { rank: 1 }),
        apogee: layer.add('<b>Apogee</b><span class="hint">slowest</span>', { rank: 1 })
    };

    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const SPHERE_RADIUS = 1.0;

    function isBlocked(point) {
        toPoint.copy(point).sub(camera.position);
        const distance = toPoint.length();
        toPoint.divideScalar(distance);
        const along = -camera.position.dot(toPoint);
        const offCenter = camera.position.lengthSq() - along * along;
        if (offCenter >= SPHERE_RADIUS * SPHERE_RADIUS) return false;
        const entry = along - Math.sqrt(SPHERE_RADIUS * SPHERE_RADIUS - offCenter);
        return entry > 0 && entry < distance;
    }

    function showLabel(label, point) {
        if (isBlocked(point)) return;
        projected.copy(point).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        layer.show(label, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH);
    }

    /* Camera framing */
    function fitFor(aKm, e) {
        const a = aKm / RE;
        const b = a * Math.sqrt(Math.max(0, 1 - e * e));
        const ra = a * (1 + e);
        const rp = a * (1 - e);
        const xMin = -ra;
        const xMax = Math.max(rp, 1.2);
        const cx = (xMin + xMax) / 2;
        const radius = Math.max((xMax - xMin) / 2, b, 1.8);
        return { cx, radius };
    }

    const target = new THREE.Vector3();
    let viewW = 1, viewH = 1, camDistance = 20;

    function easeCamera(seconds) {
        const o = orbit();
        const goal = fitFor(o.a, o.e);
        const k = seconds < 0 ? 1 : 1 - Math.exp(-seconds * 5);
        camFit.cx += (goal.cx - camFit.cx) * k;
        camFit.radius += (goal.radius - camFit.radius) * k;
        return Math.abs(goal.cx - camFit.cx) > 1e-3 || Math.abs(goal.radius / camFit.radius - 1) > 1e-3;
    }

    function updateCamera() {
        const vertical = Math.sin(FOV / 2 * D2R);
        const horizontal = Math.sin(Math.atan(Math.tan(FOV / 2 * D2R) * viewW / viewH));
        const fitRatio = Math.min(vertical, horizontal) || 1e-4;
        camDistance = (camFit.radius * 1.15 / fitRatio) * camView.zoom;
        target.set(camFit.cx, 0, 0);

        const el = camView.el * D2R, az = camView.az * D2R;
        camera.position.set(
            target.x + camDistance * Math.cos(el) * Math.cos(az),
            camDistance * Math.cos(el) * Math.sin(az),
            camDistance * Math.sin(el)
        );
        const fromCenter = camera.position.length();
        if (fromCenter < 1.4) camera.position.multiplyScalar(1.4 / fromCenter);

        camera.lookAt(target);
        // Match the view's shape, so that Earth is round and not stretched.
        camera.aspect = viewW / viewH || 1;
        camera.near = Math.max(0.02, camDistance * 0.005);
        camera.far = camDistance * 8 + 30;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
    }

    const perPixel = () => 2 * camera.position.distanceTo(target) * Math.tan(FOV / 2 * D2R) / viewH;
    const vDir = new THREE.Vector3();

    function updateScene(o, now) {
        const px = perPixel();
        const lineWidth = px * 1.4;

        // Populate orbit tube
        for (let i = 0; i < ORBIT_POINTS; i++) {
            const p = ellipsePoint(o, i / ORBIT_POINTS * TWO_PI);
            orbitTube.xs[i] = p.x / RE;
            orbitTube.ys[i] = p.y / RE;
        }
        writeTube(orbitTube, lineWidth * 1.3);

        const rp = o.Rp / RE;
        const ra = o.Ra / RE;
        const cx = now.x / RE;
        const cy = now.y / RE;

        // Line of apsides
        setLine(apsisLine, -ra, 0, rp, 0, lineWidth * 0.7);
        apsisLine.visible = o.e > 0.0005;

        // Radius line from Earth center to craft
        setLine(radiusLine, 0, 0, cx, cy, lineWidth * 0.8);

        // Craft
        craft.position.set(cx, cy, 0);
        craft.scale.setScalar(px * 5.5);

        // Apse markers
        perigeeDot.position.set(rp, 0, 0);
        perigeeDot.scale.setScalar(px * 3.8);
        perigeeDot.visible = o.e > 0.0005;

        apogeeDot.position.set(-ra, 0, 0);
        apogeeDot.scale.setScalar(px * 3.8);
        apogeeDot.visible = o.e > 0.0005;

        // Velocity arrow
        if (state.showVelocity) {
            const vLen = Math.hypot(now.vx, now.vy) || 1e-6;
            vDir.set(now.vx / vLen, now.vy / vLen, 0);
            const maxArrow = px * 48;
            const arrowLen = Math.max(px * 8, maxArrow * (now.V / o.Vp));
            const headLen = Math.min(arrowLen * 0.42, px * 11);
            velArrow.position.set(cx, cy, 0);
            velArrow.setDirection(vDir);
            velArrow.setLength(arrowLen, headLen, headLen * 0.65);
            velArrow.visible = true;

            if (o.e > 0.0005) {
                const headP = Math.min(maxArrow * 0.42, px * 11);
                periArrow.position.set(rp, 0, 0);
                periArrow.setDirection(Y_AXIS);
                periArrow.setLength(maxArrow, headP, headP * 0.65);
                periArrow.visible = true;

                const apoArrowLen = Math.max(px * 8, maxArrow * (o.Va / o.Vp));
                const headA = Math.min(apoArrowLen * 0.42, px * 11);
                apoArrow.position.set(-ra, 0, 0);
                apoArrow.setDirection(NEG_Y_AXIS);
                apoArrow.setLength(apoArrowLen, headA, headA * 0.65);
                apoArrow.visible = true;
            } else {
                periArrow.visible = false;
                apoArrow.visible = false;
            }
        } else {
            velArrow.visible = false;
            periArrow.visible = false;
            apoArrow.visible = false;
        }
    }

    function updateLabels(o, now) {
        labels.craft.el.innerHTML = `<b>V</b> ${now.V.toFixed(2)} km/s`;
        labels.craft.width = 0;

        layer.begin();
        if (state.showLabels) {
            showLabel(labels.craft, craft.position);
            if (o.e > 0.0005) {
                showLabel(labels.perigee, perigeeDot.position);
                showLabel(labels.apogee, apogeeDot.position);
            }
        }
        layer.place(viewW, viewH, []);
    }

    /* 2D Energy Chart */
    const chartPane = $('chart-pane');
    const chartCanvas = $('chart');
    const chartCtx = chartCanvas.getContext('2d');
    let chartW = 1, chartH = 1;

    function drawChart(o, now) {
        if (!chartCtx || chartW <= 1 || chartH <= 1) return;
        const g = chartCtx;
        g.clearRect(0, 0, chartW, chartH);

        const pad = 14;
        const top = 10;
        const titleH = 22;
        const footH = 46;
        const plotTop = top + titleH;
        const plotBottom = chartH - footH;
        const plotH = Math.max(20, plotBottom - plotTop);
        const left = pad;
        const right = chartW - pad;

        g.font = '600 12px Inter, sans-serif';
        g.fillStyle = COLORS.muted;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.fillText('Specific energy (km²/s²)', left, top + 14);

        // Scale runs from perigee kinetic energy down to perigee potential energy
        const peri = pointAt(o, 0), apo = pointAt(o, Math.PI);
        const keMax = peri.ke;
        const peMin = peri.pe;
        const span = Math.max(1e-6, keMax - peMin);
        const yOf = (value) => plotTop + (keMax - value) / span * plotH;
        const y0 = yOf(0);

        const columns = [
            { key: 'ke', name: 'sKE', value: now.ke, color: COLORS.ke, perigee: peri.ke, apogee: apo.ke },
            { key: 'pe', name: 'sPE', value: now.pe, color: COLORS.pe, perigee: peri.pe, apogee: apo.pe },
            { key: 'total', name: 'ε', value: o.eps, color: COLORS.total }
        ];
        const slot = (right - left) / columns.length;
        const barW = Math.min(46, slot * 0.46);

        // Zero line
        g.strokeStyle = 'rgba(148, 163, 184, 0.6)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(left, y0);
        g.lineTo(right, y0);
        g.stroke();
        g.font = '11px "JetBrains Mono", monospace';
        g.fillStyle = COLORS.dim;
        g.textAlign = 'right';
        g.textBaseline = 'bottom';
        g.fillText('0', right, y0 - 2);

        // The total stays fixed, so its level is drawn across the whole chart.
        const yEps = yOf(o.eps);
        g.strokeStyle = 'rgba(224, 182, 79, 0.55)';
        g.setLineDash([5, 4]);
        g.beginPath();
        g.moveTo(left, yEps);
        g.lineTo(right, yEps);
        g.stroke();
        g.setLineDash([]);

        columns.forEach((col, i) => {
            const cx = left + slot * (i + 0.5);
            const x = cx - barW / 2;

            // Range swept between perigee and apogee
            if (col.perigee !== undefined && o.e > 0.0005) {
                const yA = yOf(col.apogee), yP = yOf(col.perigee);
                g.fillStyle = 'rgba(148, 163, 184, 0.08)';
                g.fillRect(x - 6, Math.min(yA, yP), barW + 12, Math.abs(yP - yA));
            }

            const yV = yOf(col.value);
            g.fillStyle = col.color;
            g.globalAlpha = 0.85;
            g.fillRect(x, Math.min(y0, yV), barW, Math.max(1, Math.abs(yV - y0)));
            g.globalAlpha = 1;

            // Perigee and apogee marks
            if (col.perigee !== undefined && o.e > 0.0005) {
                g.font = '600 10px Inter, sans-serif';
                g.textBaseline = 'middle';
                for (const [value, tag] of [[col.perigee, 'P'], [col.apogee, 'A']]) {
                    const y = yOf(value);
                    g.strokeStyle = '#cbd5e1';
                    g.lineWidth = 1;
                    g.beginPath();
                    g.moveTo(x - 6, y);
                    g.lineTo(x + barW + 6, y);
                    g.stroke();
                    g.fillStyle = '#cbd5e1';
                    g.textAlign = 'left';
                    g.fillText(tag, x + barW + 9, y);
                }
            }

            // Name and value beneath the plot
            g.textAlign = 'center';
            g.textBaseline = 'alphabetic';
            g.font = '600 12px "JetBrains Mono", monospace';
            g.fillStyle = col.color;
            g.fillText(col.name, cx, plotBottom + 17);
            g.font = '12px "JetBrains Mono", monospace';
            g.fillStyle = COLORS.text;
            g.fillText(fixed(col.value, 2), cx, plotBottom + 33);
        });

        // Plus and equals signs between the columns, read as sKE + sPE = ε
        g.font = '600 13px Inter, sans-serif';
        g.fillStyle = COLORS.muted;
        g.textAlign = 'center';
        g.fillText('+', left + slot, plotBottom + 17);
        g.fillText('=', left + slot * 2, plotBottom + 17);
    }

    // The satellite now, from r and v: moved on from perigee by the mean anomaly's share of a period.
    // Its speed, radius and energies are read from r and v.
    function satPoint(o) {
        const atPerigee = track.sat({ a: o.a, e: o.e, nu: 0 });
        const s = OM.propagate.stateAt(atPerigee, state.M / meanMotion(o.a));
        const R = Math.hypot(s.r[0], s.r[1], s.r[2]);
        const V = Math.hypot(s.v[0], s.v[1], s.v[2]);
        const nu = OM.elements.angleOnOrbit(s.r, { i: 0, raan: 0, argp: 0 }) * D2R;   // where it sits on the drawn orbit
        return { nu, R, V, x: s.r[0], y: s.r[1], vx: s.v[0], vy: s.v[1], ...energies(R, V) };
    }

    function renderFrame() {
        const o = orbit();
        const now = satPoint(o);

        updateScene(o, now);
        updateCamera();
        stars.follow(camera);
        renderer.render(scene, camera);
        updateLabels(o, now);
        drawChart(o, now);
        updatePanels(o, now);
    }

    /* Panels & HUD */
    function updatePanels(o, now) {
        const peri = pointAt(o, 0);
        const apo = pointAt(o, Math.PI);
        const rows = [
            ['r', (pt) => comma(pt.R)],
            ['v', (pt) => pt.V.toFixed(2)],
            ['ke', (pt) => fixed(pt.ke, 2)],
            ['pe', (pt) => fixed(pt.pe, 2)],
            ['e', () => fixed(o.eps, 2)]
        ];
        for (const [key, format] of rows) {
            $(`c-${key}-p`).textContent = format(peri);
            $(`c-${key}-n`).textContent = format(now);
            $(`c-${key}-a`).textContent = format(apo);
        }

        $('r-ke').textContent = `${fixed(now.ke, 2)} km²/s²`;
        $('w-ke-v').textContent = now.V.toFixed(2);
        $('r-pe').textContent = `${fixed(now.pe, 2)} km²/s²`;
        $('w-pe-r').textContent = comma(now.R);
        $('r-eps1').textContent = `${fixed(now.ke + now.pe, 2)} km²/s²`;
        $('w-eps-ke').textContent = fixed(now.ke, 2);
        $('w-eps-pe').textContent = fixed(now.pe, 2);
        $('r-a').textContent = `${comma(o.a)} km`;
        $('w-a-ra').textContent = comma(o.Ra);
        $('w-a-rp').textContent = comma(o.Rp);
        $('r-eps2').textContent = `${fixed(o.eps, 2)} km²/s²`;
        $('w-eps-a').textContent = comma(o.a);
        $('r-v').textContent = `${now.V.toFixed(2)} km/s`;
        $('w-v-r').textContent = comma(now.R);
        $('w-v-eps').textContent = fixed(o.eps, 2);

        const nuDeg = now.nu * 180 / Math.PI;
        $('nu-value').textContent = `${Math.round(nuDeg) % 360}°`;
        if (document.activeElement !== $('nu-range')) $('nu-range').value = Math.round(nuDeg) % 360;
    }

    /* Controls */
    const altFromSlider = (value) => ALT_MIN * Math.pow(ALT_MAX / ALT_MIN, value / 1000);
    const sliderFromAlt = (alt) => Math.round(1000 * Math.log(alt / ALT_MIN) / Math.log(ALT_MAX / ALT_MIN));
    const roundAlt = (alt) => alt < 2000 ? Math.round(alt / 10) * 10 : Math.round(alt / 100) * 100;

    const altControls = {
        hp: { number: $('hp-number'), range: $('hp-range') },
        ha: { number: $('ha-number'), range: $('ha-range') }
    };

    function showAltitudes() {
        for (const key of ['hp', 'ha']) {
            const control = altControls[key];
            if (document.activeElement !== control.number) control.number.value = state[key];
            control.number.setAttribute('aria-invalid', 'false');
            control.range.value = sliderFromAlt(state[key]);
        }
    }

    function setAltitude(key, value) {
        const nu = trueFromMean(state.M, orbit().e);
        state[key] = value;
        if (key === 'hp' && state.ha < value) state.ha = value;
        if (key === 'ha' && state.hp > value) state.hp = value;
        state.M = meanFromTrue(nu, orbit().e);
        markPreset(null);
        dirty = true;
    }

    for (const key of ['hp', 'ha']) {
        const control = altControls[key];
        control.range.addEventListener('input', () => {
            setAltitude(key, roundAlt(altFromSlider(Number(control.range.value))));
            showAltitudes();
        });
        control.number.addEventListener('input', () => {
            const value = Number(control.number.value);
            const valid = control.number.value !== '' && value >= ALT_MIN && value <= ALT_MAX;
            control.number.setAttribute('aria-invalid', String(!valid));
            if (!valid) return;
            setAltitude(key, value);
            const other = altControls[key === 'hp' ? 'ha' : 'hp'];
            other.number.value = state[key === 'hp' ? 'ha' : 'hp'];
            for (const k of ['hp', 'ha']) altControls[k].range.value = sliderFromAlt(state[k]);
        });
        const finish = () => showAltitudes();
        control.number.addEventListener('change', finish);
        control.number.addEventListener('blur', finish);
        control.number.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') control.number.blur();
        });
    }

    const presetButtons = [...$('preset').querySelectorAll('button')];
    function markPreset(name) {
        state.preset = name;
        for (const button of presetButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.value === name));
        }
    }
    function applyPreset(name) {
        const nu = trueFromMean(state.M, orbit().e);
        state.hp = PRESETS[name].hp;
        state.ha = PRESETS[name].ha;
        state.M = meanFromTrue(nu, orbit().e);
        markPreset(name);
        showAltitudes();
        dirty = true;
    }
    for (const button of presetButtons) {
        button.addEventListener('click', () => applyPreset(button.dataset.value));
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
    }

    function goTo(nuDeg) {
        setPlaying(false);
        state.M = meanFromTrue(nuDeg * Math.PI / 180, orbit().e);
        dirty = true;
    }

    $('nu-range').addEventListener('input', (event) => goTo(Number(event.target.value)));
    $('go-perigee').addEventListener('click', () => goTo(0));
    $('go-apogee').addEventListener('click', () => goTo(180));

    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('reset').addEventListener('click', () => {
        state.M = 0;
        applyPreset(DEFAULT_PRESET);
        Object.assign(camView, HOME_VIEW);
        setPlaying(!Kit.prefersReducedMotion());
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
    $('show-velocity').addEventListener('change', (event) => {
        state.showVelocity = event.target.checked;
        dirty = true;
    });
    $('show-labels').addEventListener('change', (event) => {
        state.showLabels = event.target.checked;
        dirty = true;
    });

    /* Rotating and zooming the view */
    const hint = $('view-hint');
    const pointers = new Map();
    let pinchStart = 0, pinchZoom = 1;
    const clampZoom = (z) => Math.min(3.5, Math.max(0.3, z));

    sceneCanvas.style.touchAction = 'none';
    sceneCanvas.style.cursor = 'grab';

    sceneCanvas.addEventListener('pointerdown', (e) => {
        sceneCanvas.setPointerCapture(e.pointerId);
        sceneCanvas.style.cursor = 'grabbing';
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            pinchZoom = camView.zoom;
        }
        if (hint) hint.style.display = 'none';
    });

    sceneCanvas.addEventListener('pointermove', (e) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        if (pointers.size === 1) {
            camView.az -= (e.clientX - last.x) * 0.35;
            camView.el = Math.min(86, Math.max(-86, camView.el + (e.clientY - last.y) * 0.3));
        }
        last.x = e.clientX;
        last.y = e.clientY;
        if (pointers.size === 2 && pinchStart > 0) {
            const [p1, p2] = [...pointers.values()];
            camView.zoom = clampZoom((pinchZoom * pinchStart) / Math.hypot(p1.x - p2.x, p1.y - p2.y));
        }
        dirty = true;
    });

    const removePointer = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size === 0) sceneCanvas.style.cursor = 'grab';
    };
    sceneCanvas.addEventListener('pointerup', removePointer);
    sceneCanvas.addEventListener('pointercancel', removePointer);

    sceneCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        camView.zoom = clampZoom(camView.zoom * Math.exp(e.deltaY * 0.0012));
        dirty = true;
    }, { passive: false });

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    showAltitudes();
    setPlaying(state.playing);
    Object.assign(camFit, fitFor(orbit().a, orbit().e));

    Kit.observeSize(orbitPane, (w, h) => {
        viewW = w;
        viewH = h;
        renderer.setSize(w, h, false);
        layer.remeasure();
        dirty = true;
        renderFrame();
    });

    Kit.observeSize(chartPane, (w, h) => {
        chartW = w;
        chartH = h;
        Kit.fitCanvas2D(chartCanvas, chartCtx, w, h);
        drawChart(orbit(), satPoint(orbit()));
    });

    Kit.startLoop((seconds) => {
        if (state.playing) {
            state.M = wrap(state.M + 2 * Math.PI * seconds / SPEEDS[state.speed].period);
            state.spin = (state.spin + seconds * (EARTH_SPIN_RATE * D2R)) % TWO_PI;
            earth.pivot.rotation.z = state.spin;
            dirty = true;
        }
        if (easeCamera(seconds)) dirty = true;

        if (!dirty) return;
        dirty = false;
        renderFrame();
    });

    // The model settings panel (../../assets/orbit-settings-panel.js): redraw on a settings change.
    if (window.OrbitSettingsPanel) window.OrbitSettingsPanel.registerPage({
        // Shown in the settings panel when Cowell is chosen.
        modelNote: "The energy formulas are two-body. With Cowell, the satellite and its readouts follow its own motion, so drag shows energy draining away; the drawn orbit stays the two-body one.",
        onSettingsChange() {
            rebindMath();
            dirty = true;
        }
    });
})();
