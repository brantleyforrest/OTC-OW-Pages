// The 3D view for time of flight problems on the Test 1 Practice page. Earth, the circular
// orbit, and the satellite at u_0. The walkthrough plays the motion:
// one lap at the steady rate n, then the sweep D from u_0, drawn as an arc behind the satellite.
// A sweep of more than one lap spirals outward, so that each lap stays visible. Computed values
// are labeled only after the answers are graded.
// Load as a classic script, after earth-scene.js and practice-math.js.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const { math } = global.PracticeMath;
    const smooth = (t) => t * t * (3 - 2 * t);

    const D2R = Math.PI / 180;
    const FOV_DEG = 38;
    const TILT = 28 * D2R;              // The orbit plane's tilt in the view (not part of the problem)
    const HOME = { az: -62, el: 58 };
    const ZOOM = { min: 0.35, max: 3 };
    const ARC_SEGMENTS = 360;
    const ARC_SIDES = 8;
    const SPIRAL = 0.06;                // Each extra lap of the sweep is drawn this much farther out
    const START_DELAY = 0.5;
    const COLORS = {
        orbit: '#e0b64f',
        start: '#34d399',
        end: '#ff8a3d',
        sweep: '#c4a1ff',
        sat: '#ffffff'
    };

    function create(THREE, dom, constants) {
        const R_E = constants.R_EARTH;
        const { view, canvas, hint } = dom;

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        } catch (err) {
            dom.showStatus('This browser could not initialize WebGL. The answers and walkthrough still work.');
            return null;
        }
        renderer.setClearColor(0x03060c);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 900);
        camera.up.set(0, 0, 1);
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
        sunLight.position.set(12, 6, 8);
        scene.add(sunLight);

        global.EarthScene.addEarth(THREE, renderer, scene);
        const stars = global.EarthScene.addStars(THREE, scene);
        const layer = new Kit.LabelLayer(dom.labels, { wide: true });

        // The orbit plane: tilted about X, so that u = 0° is on +X.
        const plane = new THREE.Group();
        plane.rotation.x = TILT;
        scene.add(plane);

        const mat = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
        const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });

        const orbitLine = new THREE.LineLoop(new THREE.BufferGeometry(), lineMat(COLORS.orbit, 0.85));
        plane.add(orbitLine);
        const startLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(COLORS.start, 0.8));
        const endLine = new THREE.Line(new THREE.BufferGeometry(), lineMat(COLORS.end, 0.8));
        plane.add(startLine, endLine);

        const sweep = new THREE.Mesh(new THREE.BufferGeometry(), mat(COLORS.sweep, 0.9));
        plane.add(sweep);

        const dot = (color, size) => new THREE.Mesh(new THREE.SphereGeometry(size, 20, 14), mat(color));
        const startDot = dot(COLORS.start, 1);
        const endDot = dot(COLORS.end, 1);
        const sat = dot(COLORS.sat, 1);
        plane.add(startDot, endDot, sat);

        const tag = (html, rank, extra = '') => {
            const label = layer.add(`${html}<span class="val"></span>`, { rank });
            label.el.classList.add('measure');
            if (extra) label.el.classList.add(extra);
            label.val = label.el.querySelector('.val');
            return label;
        };
        const labels = {
            start: tag(`<span style="color:${COLORS.start}">${math('u_0')}</span>`, 1),
            end: tag(`<span style="color:${COLORS.end}">${math('u_1')}</span>`, 1),
            sweep: tag(`<span style="color:${COLORS.sweep}">${math('D')}</span>`, 2),
            sat: tag(`<span style="color:${COLORS.sat}">${math('t')}</span>`, 0)
        };

        /* State ------------------------------------------------------------ */
        let model = null;
        let r = 1;                  // Orbit radius in Earth radii
        let stage = 'given';
        let answersShown = false;
        let anim = null;            // { kind: 'lap' | 'sweep', clock, seconds }
        let progress = 0;           // 0 to 1 along the current motion
        let motion = 'none';        // 'none', 'lap', or 'sweep'
        const camView = { ...HOME, zoom: 1 };
        let viewW = 1, viewH = 1;
        let dirty = true;

        const spiral = (deg) => r * (1 + SPIRAL * Math.max(0, deg - 360) / 360);
        const inPlane = (deg, radius) => new THREE.Vector3(radius * Math.cos(deg * D2R), radius * Math.sin(deg * D2R), 0);

        function setLine(line, points) {
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry().setFromPoints(points);
            if (line.computeLineDistances) line.computeLineDistances();
        }

        function buildSweep() {
            // A tube along the swept angle, from u_0 forward. Past one lap it spirals outward.
            const total = model.sweep;
            const pts = [];
            for (let i = 0; i <= ARC_SEGMENTS; i++) {
                const along = total * i / ARC_SEGMENTS;
                pts.push(inPlane(model.u0 + along, spiral(along)));
            }
            const curve = new THREE.CatmullRomCurve3(pts);
            sweep.geometry.dispose();
            sweep.geometry = new THREE.TubeGeometry(curve, ARC_SEGMENTS, 0.012 * r + 0.006, ARC_SIDES, false);
        }

        function setProblem(problem) {
            if (!problem || !problem.model) return;
            model = problem.model;
            r = model.a / R_E;
            const ring = [];
            for (let i = 0; i < 256; i++) ring.push(inPlane(i / 256 * 360, r));
            setLine(orbitLine, ring);
            setLine(startLine, [new THREE.Vector3(0, 0, 0), inPlane(model.u0, r)]);
            const endRadius = spiral(model.sweep);
            setLine(endLine, [new THREE.Vector3(0, 0, 0), inPlane(model.u1, endRadius)]);
            buildSweep();
            const size = 0.035 * Math.max(1.4, r);
            startDot.scale.setScalar(size * 0.8);
            endDot.scale.setScalar(size * 0.8);
            sat.scale.setScalar(size);
            startDot.position.copy(inPlane(model.u0, r));
            endDot.position.copy(inPlane(model.u1, endRadius));
            labels.start.val.innerHTML = math(`= ${model.u0}°`);
            stage = 'given';
            answersShown = false;
            anim = null;
            motion = 'none';
            progress = 0;
            Object.assign(camView, HOME, { zoom: 1 });
            dirty = true;
        }

        function setStage(next) {
            if (!model) return;
            stage = next;
            if (next === 'rate') motion = 'lap';
            else if (next === 'given') motion = 'none';
            else motion = 'sweep';
            const animate = next !== 'given' && !Kit.prefersReducedMotion();
            progress = animate ? 0 : 1;
            anim = animate ? { clock: -START_DELAY, seconds: motion === 'lap' ? 3.6 : 2.4 + 0.8 * Math.min(2, model.sweep / 360) } : null;
            Object.assign(camView, HOME, { zoom: 1 });
            dirty = true;
        }

        function setAnswersShown(shown) {
            answersShown = Boolean(shown);
            dirty = true;
        }

        /* Drawing ---------------------------------------------------------- */
        // What each stage shows. The end point is given in a time problem; in a position problem
        // it is the answer, so it appears once the walkthrough reaches it or the answers are graded.
        function updateScene() {
            const isTime = model.find === 'time';
            const showEnd = isTime || stage === 'position' || answersShown;
            endDot.visible = showEnd;
            endLine.visible = showEnd;

            const swept = motion === 'sweep' ? progress * model.sweep : 0;
            const showSweep = motion === 'sweep' || (answersShown && stage === 'given');
            sweep.visible = showSweep;
            if (showSweep) {
                const f = motion === 'sweep' ? progress : 1;
                const sides = ARC_SIDES * 6;
                sweep.geometry.setDrawRange(0, Math.floor(f * ARC_SEGMENTS) * sides);
            }

            let angle = model.u0;
            let radius = r;
            if (motion === 'lap') angle = model.u0 + 360 * progress;
            if (motion === 'sweep') {
                angle = model.u0 + swept;
                radius = spiral(swept);
            }
            sat.position.copy(inPlane(angle, radius));
        }

        function updateLabelText() {
            const values = answersShown;
            const isTime = model.find === 'time';
            labels.end.val.innerHTML = isTime || values ? math(`= ${isTime ? model.u1 : model.u1.toFixed(2)}°`) : '';
            labels.sweep.val.innerHTML = values ? math(`= ${model.sweep.toFixed(isTime ? 0 : 2)}°`) : '';
            // The clock: elapsed flight time as the satellite moves. In a time problem the flight
            // time is the answer, so its clock runs only at the time step or after grading.
            let t = 0;
            if (motion === 'lap') t = model.period * progress;
            if (motion === 'sweep') t = model.T * progress;
            const showClock = motion === 'lap' || !isTime || stage === 'time' || values;
            labels.sat.val.innerHTML = motion !== 'none' && showClock ? math(`= ${Math.round(t).toLocaleString('en-US')}\\text{ s}`) : '';
        }

        /* Camera ----------------------------------------------------------- */
        function frameRadius() {
            return Math.max(1.3, spiral(model ? model.sweep : 0) * 1.12);
        }

        function updateCamera() {
            const tanHalf = Math.tan(FOV_DEG / 2 * D2R);
            const fit = Math.min(1, viewW / viewH);
            const d = (frameRadius() / tanHalf / fit) * 1.08 * camView.zoom;
            const el = camView.el * D2R, az = camView.az * D2R;
            camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
        }

        /* Labels ----------------------------------------------------------- */
        const projected = new THREE.Vector3();
        const toPoint = new THREE.Vector3();
        const world = new THREE.Vector3();
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

        function showAt(label, local) {
            world.copy(local).applyMatrix4(plane.matrixWorld);
            if (isBlocked(world)) return;
            projected.copy(world).project(camera);
            if (projected.z < -1 || projected.z > 1) return;
            layer.show(label, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH);
        }

        function updateLabels() {
            layer.begin();
            showAt(labels.start, startDot.position);
            if (endDot.visible) showAt(labels.end, endDot.position);
            if (sweep.visible) {
                const mid = (motion === 'sweep' ? progress : 1) * model.sweep / 2;
                if (mid > 2) showAt(labels.sweep, inPlane(model.u0 + mid, spiral(mid) * 1.06));
            }
            if (motion !== 'none') showAt(labels.sat, sat.position);
            layer.place(viewW, viewH, [Kit.overlayBox(document.getElementById('hud'), view)]);
        }

        function renderFrame() {
            if (!model) {
                renderer.render(scene, camera);
                return;
            }
            updateScene();
            updateLabelText();
            updateCamera();
            plane.updateMatrixWorld();
            stars.follow(camera);
            renderer.render(scene, camera);
            updateLabels();
        }

        /* Controls --------------------------------------------------------- */
        const pointers = new Map();
        let pinchStart = 0, pinchZoom = 1;
        const clampZoom = (z) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';

        canvas.addEventListener('pointerdown', (event) => {
            canvas.setPointerCapture(event.pointerId);
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size === 2) {
                const [p1, p2] = [...pointers.values()];
                pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                pinchZoom = camView.zoom;
            }
            hint.style.display = 'none';
        });
        canvas.addEventListener('pointermove', (event) => {
            const last = pointers.get(event.pointerId);
            if (!last) return;
            if (pointers.size === 1) {
                camView.az -= (event.clientX - last.x) * 0.35;
                camView.el = Math.min(86, Math.max(-86, camView.el + (event.clientY - last.y) * 0.3));
            }
            last.x = event.clientX;
            last.y = event.clientY;
            if (pointers.size === 2 && pinchStart > 0) {
                const [p1, p2] = [...pointers.values()];
                camView.zoom = clampZoom(pinchZoom * pinchStart / Math.hypot(p1.x - p2.x, p1.y - p2.y));
            }
            dirty = true;
        });
        const removePointer = (event) => pointers.delete(event.pointerId);
        canvas.addEventListener('pointerup', removePointer);
        canvas.addEventListener('pointercancel', removePointer);
        canvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            camView.zoom = clampZoom(camView.zoom * Math.exp(event.deltaY * 0.0012));
            dirty = true;
        }, { passive: false });

        dom.reset.addEventListener('click', () => {
            Object.assign(camView, HOME, { zoom: 1 });
            dirty = true;
        });

        /* Start ------------------------------------------------------------ */
        function resize() {
            viewW = Math.max(1, view.clientWidth);
            viewH = Math.max(1, view.clientHeight);
            renderer.setSize(viewW, viewH, false);
            camera.aspect = viewW / viewH;
            camera.updateProjectionMatrix();
            layer.remeasure();
            renderFrame();
        }

        Kit.observeSize(view, resize);

        Kit.startLoop((seconds) => {
            if (anim) {
                anim.clock += seconds;
                progress = smooth(Math.max(0, Math.min(1, anim.clock / anim.seconds)));
                if (anim.clock >= anim.seconds) anim = null;
                dirty = true;
            }
            if (layer.settling) dirty = true;
            if (dirty && !canvas.hidden) {
                dirty = false;
                renderFrame();
            }
        });

        return { setProblem, setStage, setAnswersShown, resize };
    }

    global.Test1TofScene = { create };
})(window);
