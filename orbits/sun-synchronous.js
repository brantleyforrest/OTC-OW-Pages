// A year of orbit-plane motion: a sun-synchronous orbit that turns with the mean Sun under J2,
// compared with a polar orbit at the same altitude, whose plane J2 does not turn.
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

    /* Physics, for a circular orbit */
    const MU = 398600.4418;      // km^3/s^2
    const RE = 6378.137;         // km
    const J2 = 1.08262668e-3;
    const YEAR_DAYS = 365.2422;
    const DAY_S = 86400;
    const SUN_RATE = 2 * Math.PI / (YEAR_DAYS * DAY_S); // rad/s
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;

    const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
    const j2Factor = (a) => 1.5 * J2 * meanMotion(a) * (RE / a) * (RE / a);
    const nodalRate = (a, inc) => -j2Factor(a) * Math.cos(inc);
    const sunSyncCos = (a) => -SUN_RATE / j2Factor(a);

    const wrap180 = (deg) => ((deg % 360) + 540) % 360 - 180;
    const wrap360 = (deg) => ((deg % 360) + 360) % 360;
    const wrap12 = (hours) => ((hours % 24) + 36) % 24 - 12;

    function formatTime(hours) {
        const total = Math.round(hours * 60);
        const minutes = ((total % 1440) + 1440) % 1440;
        return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }

    /* Settings */
    const SPEEDS = [
        { rate: 10, label: '10 days/s' },
        { rate: 30, label: '30 days/s' },
        { rate: 90, label: '90 days/s' }
    ];
    const NODE_TIMES = {
        dawn: { hours: 18, caption: 'Node at 18:00. The orbit rides the line between day and night, so its solar panels stay in sunlight almost all year.' },
        morning: { hours: 22.5, caption: 'Node at 22:30, so the descending pass crosses the equator at 10:30. This time is common for Earth imaging.' },
        afternoon: { hours: 13.5, caption: 'Node at 13:30, an early-afternoon pass used by many weather satellites.' }
    };
    const POLAR_RAAN = 90; // One polar orbit for every node time. Its node is at 18:00 on March 20.
    const HOME_VIEW = { az: 40, el: 26, dist: 14.5 };
    const ZOOM = { min: 4, max: 34 };
    const SUN_PATH_RADIUS = 4.8;
    const SATELLITE_RATE = 110;  // Degrees per second of animation. Slowed, so that it can be followed.
    const EARTH_SPIN_RATE = 12;  // Degrees per second of animation. Slowed for the same reason.
    const COLOR_SSO = 0xe3b85a;
    const COLOR_POLAR = 0x60a5fa;
    const COLOR_SUN = 0xffe6a0;
    const CSS_SSO = '#e3b85a';
    const CSS_POLAR = '#60a5fa';
    const CSS_SUN = '#ffe6a0';

    // The orbit is drawn larger than scale. Its true height would barely clear Earth in this view.
    const drawRadius = (altitude) => 1.55 + (altitude - 300) / 1700 * 0.55;

    /* State */
    const state = {
        days: 0,
        satelliteDeg: 0,
        earthDeg: 0,
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        altitude: 700,
        nodeTime: 'dawn',
        shownHours: NODE_TIMES.dawn.hours,
        frame: 'inertial',
        showPolar: true,
        showLabels: true
    };
    const camView = { ...HOME_VIEW };
    const frameChange = { from: 0, blend: 1 };

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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.16));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.8);
    scene.add(sunLight);

    const SPHERE_RADIUS = 1;
    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const stars = window.EarthScene.addStars(THREE, scene);

    // Earth's spin axis
    const axisLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1.4), new THREE.Vector3(0, 0, 1.4)]),
        new THREE.LineBasicMaterial({ color: 0x94a3b8 })
    );
    scene.add(axisLine);
    const northPoint = new THREE.Vector3(0, 0, 1.4);

    /* The Sun and its yearly path. Everything in sunGroup turns with the Sun. */
    const sunGroup = new THREE.Group();
    scene.add(sunGroup);

    const sunBody = new THREE.Mesh(
        new THREE.SphereGeometry(0.27, 32, 20),
        new THREE.MeshBasicMaterial({ color: COLOR_SUN })
    );
    sunBody.position.set(SUN_PATH_RADIUS, 0, 0);
    sunGroup.add(sunBody);

    function makeGlowTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const g = c.getContext('2d');
        const gradient = g.createRadialGradient(64, 64, 8, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 225, 150, 0.9)');
        gradient.addColorStop(0.35, 'rgba(255, 190, 90, 0.28)');
        gradient.addColorStop(1, 'rgba(255, 170, 60, 0)');
        g.fillStyle = gradient;
        g.fillRect(0, 0, 128, 128);
        const texture = new THREE.CanvasTexture(c);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    }));
    glow.scale.setScalar(2.2);
    glow.position.copy(sunBody.position);
    sunGroup.add(glow);

    const sunBeam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(SUN_PATH_RADIUS, 0, 0), new THREE.Vector3(1, 0, 0)]),
        new THREE.LineBasicMaterial({ color: COLOR_SUN, transparent: true, opacity: 0.55 })
    );
    sunGroup.add(sunBeam);

    // The wedge between the Sun and the sun-synchronous node. It is the angle held constant.
    const wedge = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ color: COLOR_SSO, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
    );
    sunGroup.add(wedge);
    let wedgeKey = '';

    function updateWedge(radius) {
        const angle = wrap12(state.shownHours - 12) * 15 * D2R;
        const key = `${angle.toFixed(4)}:${radius.toFixed(4)}`;
        if (key === wedgeKey) return;
        wedgeKey = key;
        wedge.geometry.dispose();
        wedge.geometry = new THREE.RingGeometry(1.02, radius, 72, 1, Math.min(0, angle), Math.abs(angle));
    }

    const sunPathPoints = [];
    for (let i = 0; i < 256; i++) {
        const a = i / 256 * 2 * Math.PI;
        sunPathPoints.push(new THREE.Vector3(SUN_PATH_RADIUS * Math.cos(a), SUN_PATH_RADIUS * Math.sin(a), 0));
    }
    scene.add(new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(sunPathPoints),
        new THREE.LineBasicMaterial({ color: 0x475569 })
    ));

    /* Labels and season marks */
    const layer = new Kit.LabelLayer($('labels'));
    const sunLabel = layer.add(`<b style="color:${CSS_SUN}">Sun</b>`, { rank: 0 });
    const northLabel = layer.add('<b>N</b>', { rank: 3, optional: true });
    const seasonMarks = ['Mar', 'Jun', 'Sep', 'Dec'].map((name, i) => {
        const a = i * Math.PI / 2;
        const position = new THREE.Vector3(SUN_PATH_RADIUS * Math.cos(a), SUN_PATH_RADIUS * Math.sin(a), 0);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0x94a3b8 }));
        dot.position.copy(position);
        scene.add(dot);
        return { position, label: layer.add(`<span style="color:#cbd5e1">${name}</span>`, { rank: 2, optional: true }) };
    });

    /* The two orbits. Each is a ring and a filled plane in a group turned to RAAN and inclination. */
    function makeOrbit(color, name, cssColor) {
        const group = new THREE.Group();
        group.rotation.order = 'ZXY';
        scene.add(group);

        group.add(new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.011, 8, 240),
            new THREE.MeshBasicMaterial({ color })
        ));
        group.add(new THREE.Mesh(
            new THREE.CircleGeometry(1, 120),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
        ));

        const satellite = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        const node = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshBasicMaterial({ color }));
        scene.add(satellite, node);

        const label = layer.add(`<b style="color:${cssColor}">${name} <span class="node-time">18:00</span></b><span class="hint">ascending node</span>`, { rank: 1 });
        return { group, satellite, node, label, timeEl: label.el.querySelector('.node-time'), raanDeg: 0, nodeHours: 0, inc: 0 };
    }
    const sso = makeOrbit(COLOR_SSO, 'SSO', CSS_SSO);
    const polar = makeOrbit(COLOR_POLAR, 'Polar', CSS_POLAR);
    polar.inc = Math.PI / 2;

    const setText = (el, text) => {
        if (el.textContent !== text) el.textContent = text;
    };

    function placeOrbit(orbit, radius, satelliteDeg) {
        const raan = orbit.raanDeg * D2R;
        const u = satelliteDeg * D2R;
        const ci = Math.cos(orbit.inc), si = Math.sin(orbit.inc);
        const co = Math.cos(raan), so = Math.sin(raan);
        const cu = Math.cos(u), su = Math.sin(u);
        orbit.group.rotation.set(orbit.inc, 0, raan);
        orbit.group.scale.setScalar(radius);
        orbit.satellite.position.set(
            radius * (co * cu - so * su * ci),
            radius * (so * cu + co * su * ci),
            radius * su * si
        );
        orbit.node.position.set(radius * co, radius * so, 0);
    }

    const sunDeg = () => state.days * DAY_S * SUN_RATE * R2D;

    function updateScene() {
        const a = RE + state.altitude;
        const radius = drawRadius(state.altitude);
        const sun = sunDeg();

        sso.inc = Math.acos(sunSyncCos(a));
        const startRaan = (state.shownHours - 12) * 15;
        sso.raanDeg = startRaan + nodalRate(a, sso.inc) * state.days * DAY_S * R2D;
        polar.raanDeg = POLAR_RAAN + nodalRate(a, polar.inc) * state.days * DAY_S * R2D;

        for (const orbit of [sso, polar]) {
            orbit.nodeHours = 12 + wrap180(orbit.raanDeg - sun) / 15;
            setText(orbit.timeEl, formatTime(orbit.nodeHours));
        }

        placeOrbit(sso, radius, state.satelliteDeg);
        placeOrbit(polar, radius, state.satelliteDeg + 40);
        polar.group.visible = polar.satellite.visible = polar.node.visible = state.showPolar;

        sunGroup.rotation.z = sun * D2R;
        sunLight.position.set(Math.cos(sun * D2R), Math.sin(sun * D2R), 0).multiplyScalar(10);
        updateWedge(radius);
        earth.pivot.rotation.z = state.earthDeg * D2R;
    }

    function updateHud() {
        const gold = '<span class="key-sso">sun-synchronous orbit</span>';
        const blue = '<span class="key-polar">polar orbit</span>';
        if (state.frame === 'sun') {
            hud.innerHTML = state.showPolar
                ? `The camera follows the Sun. The ${gold} holds still, while the ${blue} drifts around once a year.`
                : `The camera follows the Sun. The ${gold} holds still, so the wedge never changes.`;
        } else {
            hud.innerHTML = state.showPolar
                ? `The Sun circles once a year. The ${gold} turns with it, while the ${blue} stays fixed in space.`
                : `The Sun circles once a year. The ${gold} turns with it, so the wedge never changes.`;
        }
        layer.remeasure();
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MARCH_EQUINOX = Date.UTC(2025, 2, 20);

    function updatePanels() {
        const date = new Date(MARCH_EQUINOX + (state.days % YEAR_DAYS) * DAY_S * 1000);
        setText($('date'), `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`);
        setText($('sun-ra'), `${wrap360(sunDeg()).toFixed(1)}°`);
        setText($('sso-raan'), `${wrap360(sso.raanDeg).toFixed(1)}°`);
        setText($('polar-raan'), `${wrap360(polar.raanDeg).toFixed(1)}°`);
        setText($('sso-time'), formatTime(sso.nodeHours));
        setText($('polar-time'), formatTime(polar.nodeHours));
    }

    function updateEquations() {
        const a = RE + state.altitude;
        const cosI = sunSyncCos(a);
        setText($('altitude-value'), `${state.altitude.toLocaleString('en-US')} km, i = ${(Math.acos(cosI) * R2D).toFixed(2)}°`);
        setText($('eq-rate'), `${(SUN_RATE * DAY_S * R2D).toFixed(4)}°/day`);
        setText($('eq-n'), `${(meanMotion(a) * 1000).toFixed(4)} mrad/s`);
        setText($('eq-a'), `a = ${Math.round(a).toLocaleString('en-US')} km`);
        setText($('eq-i'), `${(Math.acos(cosI) * R2D).toFixed(2)}°`);
        setText($('eq-cos'), `= ${cosI.toFixed(4).replace('-', '−')}`);
    }

    /* Camera. "Follow Sun" turns the camera with the Sun, so the stars appear to wheel past. */
    let viewW = 1, viewH = 1;

    function frameOffset() {
        const target = state.frame === 'sun' ? sunDeg() : 0;
        if (frameChange.blend >= 1) return target;
        const t = frameChange.blend;
        const eased = t * t * (3 - 2 * t);
        return frameChange.from + wrap180(target - frameChange.from) * eased;
    }

    function updateCamera() {
        const fit = Math.min(1, (viewW / viewH) * 0.85);
        const d = camView.dist / fit;
        const el = camView.el * D2R, az = (camView.az + frameOffset()) * D2R;
        camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
    }

    /* Labels. A label is hidden when Earth blocks the line of sight to its point. */
    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const worldSun = new THREE.Vector3();

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

    function updateLabels() {
        layer.begin();
        if (state.showLabels) {
            sunBody.getWorldPosition(worldSun);
            showLabel(sunLabel, worldSun);
            showLabel(sso.label, sso.node.position);
            if (state.showPolar) showLabel(polar.label, polar.node.position);
            showLabel(northLabel, northPoint);
            for (const mark of seasonMarks) showLabel(mark.label, mark.position);
        }
        layer.place(viewW, viewH, [Kit.overlayBox(hud, view)]);
    }

    function renderFrame() {
        updateScene();
        updateCamera();
        stars.follow(camera);
        renderer.render(scene, camera);
        updateLabels();
    }

    /* Controls */
    let dirty = true;

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
    }

    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('restart').addEventListener('click', () => {
        state.days = 0;
        state.satelliteDeg = 0;
        state.earthDeg = 0;
        dirty = true;
    });
    $('reset-view').addEventListener('click', () => {
        Object.assign(camView, HOME_VIEW);
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speed = Number(e.target.value);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    $('altitude').addEventListener('input', (e) => {
        state.altitude = Number(e.target.value);
        updateEquations();
        dirty = true;
    });
    const selectNodeTime = Kit.bindSegmented($('node-time'), (value) => {
        state.nodeTime = value;
        $('node-time-caption').textContent = NODE_TIMES[value].caption;
        dirty = true;
    });
    const selectFrame = Kit.bindSegmented($('frame'), (value) => {
        if (value === state.frame) return;
        frameChange.from = frameOffset();
        frameChange.blend = 0;
        state.frame = value;
        updateHud();
        dirty = true;
    });
    $('show-polar').addEventListener('change', (e) => {
        state.showPolar = e.target.checked;
        updateHud();
        dirty = true;
    });
    $('show-labels').addEventListener('change', (e) => {
        state.showLabels = e.target.checked;
        dirty = true;
    });

    /* Drag to rotate. Scroll or pinch to zoom. */
    const hint = $('view-hint');
    hint.style.display = '';
    const pointers = new Map();
    let pinchStart = 0, pinchDist = 0;
    const clampZoom = (d) => Math.min(ZOOM.max, Math.max(ZOOM.min, d));
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            pinchDist = camView.dist;
        }
        hint.style.display = 'none';
    });
    canvas.addEventListener('pointermove', (e) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        if (pointers.size === 1) {
            camView.az -= (e.clientX - last.x) * 0.35;
            camView.el = Math.min(86, Math.max(-86, camView.el + (e.clientY - last.y) * 0.3));
        }
        last.x = e.clientX;
        last.y = e.clientY;
        if (pointers.size === 2 && pinchStart > 0) {
            const [a, b] = [...pointers.values()];
            camView.dist = clampZoom(pinchDist * pinchStart / Math.hypot(a.x - b.x, a.y - b.y));
        }
        dirty = true;
    });
    const endPointer = (e) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        camView.dist = clampZoom(camView.dist * Math.exp(e.deltaY * 0.0012));
        dirty = true;
    }, { passive: false });

    // Smooth changes of node time and camera frame. Returns true while either is still moving.
    function stepTransitions(seconds) {
        let moving = false;
        const gap = wrap12(NODE_TIMES[state.nodeTime].hours - state.shownHours);
        if (gap !== 0) {
            state.shownHours = Math.abs(gap) < 0.01
                ? NODE_TIMES[state.nodeTime].hours
                : state.shownHours + gap * (1 - Math.exp(-seconds * 7));
            moving = true;
        }
        if (frameChange.blend < 1) {
            frameChange.blend = Math.min(1, frameChange.blend + seconds / 0.8);
            moving = true;
        }
        return moving;
    }

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    selectNodeTime(state.nodeTime);
    selectFrame(state.frame);
    setPlaying(state.playing);
    updateHud();
    updateEquations();
    status.style.display = 'none';

    Kit.observeSize(view, (width, height) => {
        viewW = width;
        viewH = height;
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        layer.remeasure();
        renderFrame(); // Resizing clears the canvas, so draw at once to avoid a blank frame.
    });

    Kit.startLoop((seconds) => {
        if (state.playing) {
            state.days += seconds * SPEEDS[state.speed].rate;
            state.satelliteDeg += seconds * SATELLITE_RATE;
            state.earthDeg += seconds * EARTH_SPIN_RATE;
            dirty = true;
        }
        if (stepTransitions(seconds)) dirty = true;
        if (!dirty) return;
        dirty = false;
        renderFrame();
        updatePanels();
    });
})();
