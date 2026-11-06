// Starter for a tool drawn in 3D with Three.js, around the shared Earth in assets/earth-scene.js.
// The axes and moving point are placeholders.
// Replace the sections marked REPLACE. Keep the structure around them.
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

    /* REPLACE: the content and settings for this tool */
    const SPEEDS = [
        { rate: 15, label: 'Slow' },
        { rate: 45, label: 'Normal' },
        { rate: 135, label: 'Fast' }
    ];
    const OPTIONS = {
        a: { radius: 2.6, caption: 'Describe what Option A shows.' },
        b: { radius: 1.8, caption: 'Describe what Option B shows.' }
    };
    const HOME_VIEW = { az: 35, el: 24, dist: 9.5 };
    const ZOOM = { min: 3, max: 30 };
    const AXIS_LENGTH = 3.2;

    /* State */
    const state = {
        t: 0,
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        option: 'a',
        showPath: true,
        showLabels: true
    };
    const camView = { ...HOME_VIEW };

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
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 2, 5);
    scene.add(sun);

    /* The shared Earth and stars. Earth has a radius of 1 and Z points north. */
    const EARTH_SPIN_RATE = 6; // Degrees per second of animation. Set this for the tool.
    const SPHERE_RADIUS = 1;
    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const stars = window.EarthScene.addStars(THREE, scene);

    /* REPLACE: build the rest of the scene. */
    const layer = new Kit.LabelLayer($('labels'));
    const axisTips = [];
    [[1, 0, 0, 'X'], [0, 1, 0, 'Y'], [0, 0, 1, 'Z']].forEach(([x, y, z, name]) => {
        const direction = new THREE.Vector3(x, y, z);
        scene.add(new THREE.ArrowHelper(direction, new THREE.Vector3(), AXIS_LENGTH, 0x60a5fa, 0.28, 0.14));
        axisTips.push({
            position: direction.clone().multiplyScalar(AXIS_LENGTH),
            label: layer.add(`<b style="color:#60a5fa">${name}</b>`, { rank: 1 })
        });
    });

    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(marker);
    const markerLabel = layer.add('<b>Moving point</b><span class="hint">placeholder</span>', { rank: 0 });

    const PATH_POINTS = 180;
    const path = new THREE.LineLoop(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_POINTS * 3), 3)),
        new THREE.LineBasicMaterial({ color: 0xc59b3c })
    );
    scene.add(path);

    function rebuildPath() {
        const r = OPTIONS[state.option].radius;
        const positions = path.geometry.attributes.position;
        for (let i = 0; i < PATH_POINTS; i++) {
            const a = i / PATH_POINTS * 2 * Math.PI;
            positions.setXYZ(i, r * Math.cos(a), r * Math.sin(a), 0);
        }
        positions.needsUpdate = true;
    }

    // REPLACE: move the objects to the current time.
    function updateScene() {
        const r = OPTIONS[state.option].radius;
        const a = state.t * Math.PI / 180;
        marker.position.set(r * Math.cos(a), r * Math.sin(a), 0);
        earth.pivot.rotation.z = (state.t / SPEEDS[1].rate) * EARTH_SPIN_RATE * Math.PI / 180;
        path.visible = state.showPath;
    }

    // REPLACE: update the values shown in the side panels.
    function updatePanels() {
        $('elapsed').textContent = `${(state.t / SPEEDS[1].rate).toFixed(1)} s`;
        $('angle').textContent = `${Math.floor(state.t % 360)}°`;
    }

    /* Camera. Pulls back on narrow screens, so that the scene still fits. */
    let viewW = 1, viewH = 1;
    function updateCamera() {
        const fit = Math.min(1, (viewW / viewH) * 0.85);
        const d = camView.dist / fit;
        const el = camView.el * Math.PI / 180, az = camView.az * Math.PI / 180;
        camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
    }

    /* Labels. A label is hidden when the sphere blocks the line of sight to its point. */
    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
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
            showLabel(markerLabel, marker.position);
            for (const tip of axisTips) showLabel(tip.label, tip.position);
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
        state.t = 0;
        dirty = true;
    });
    $('reset-view').style.display = '';
    $('reset-view').addEventListener('click', () => {
        Object.assign(camView, HOME_VIEW);
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speed = Number(e.target.value);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    const selectOption = Kit.bindSegmented($('option'), (value) => {
        state.option = value;
        $('option-caption').textContent = OPTIONS[value].caption;
        rebuildPath();
        dirty = true;
    });
    $('show-path').addEventListener('change', (e) => {
        state.showPath = e.target.checked;
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

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    selectOption(state.option);
    setPlaying(state.playing);
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
            state.t += seconds * SPEEDS[state.speed].rate;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        renderFrame();
        updatePanels();
    });
})();
