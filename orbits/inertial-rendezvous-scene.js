// orbits/inertial-rendezvous-scene.js
// 3D scene visualizer for orbital rendezvous in the inertial (ECI) frame.
// Builds upon orbital-maneuvers-scene.js conventions, colors, and controls.
// Load as a classic script.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;

    /* ------------------------------------------------------------------ */
    /* Timeline Segments & Mission Clock                                  */
    /* ------------------------------------------------------------------ */
    function segments(model) {
        if (!model) return [{ key: 'overview', from: 0, to: 1, t0: 0, t1: 1 }];

        const mu = (model.constants && model.constants.MU) || 398600.4418;
        const R_target = model.Rtarget || model.Rchase;
        const T_target = 2 * Math.PI * Math.sqrt(Math.pow(R_target, 3) / mu);
        const t_together = 0.08 * T_target;

        const raw = [];

        if (model.mode === 'coplanar') {
            const hasWait = model.WT > 1e-3;
            if (hasWait) raw.push({ key: 'wait', share: 0.22, t0: 0, t1: model.WT });
            raw.push({ key: 'burn1', share: 0.05, t0: model.WT, t1: model.WT });
            raw.push({ key: 'transfer', share: 0.38, t0: model.WT, t1: model.WT + model.TOF });
            raw.push({ key: 'burn2', share: 0.05, t0: model.WT + model.TOF, t1: model.WT + model.TOF });
            raw.push({ key: 'together', share: 0.12, t0: model.arrival, t1: model.arrival + t_together });
        } else if (model.mode === 'coorbital') {
            raw.push({ key: 'burn1', share: 0.05, t0: 0, t1: 0 });
            raw.push({ key: 'phasing', share: 0.42, t0: 0, t1: model.TOF_rendezvous });
            raw.push({ key: 'burn2', share: 0.05, t0: model.TOF_rendezvous, t1: model.TOF_rendezvous });
            raw.push({ key: 'together', share: 0.12, t0: model.arrival, t1: model.arrival + t_together });
        }
        // Note: Noncoplanar and Gauss modes were removed per user instruction as they are not useful for this project.

        const totalShare = raw.reduce((sum, item) => sum + item.share, 0);
        let curr = 0;
        return raw.map((item) => {
            const normShare = item.share / totalShare;
            const from = curr;
            const to = Math.min(1, curr + normShare);
            curr = to;
            return {
                key: item.key,
                from,
                to,
                t0: item.t0,
                t1: item.t1
            };
        });
    }

    function phaseAt(model, tl) {
        const list = segments(model);
        for (const s of list) {
            if (tl < s.to || s === list[list.length - 1]) {
                const span = Math.max(1e-6, s.to - s.from);
                const k = Math.max(0, Math.min(1, (tl - s.from) / span));
                return { key: s.key, k, from: s.from, to: s.to, t0: s.t0, t1: s.t1 };
            }
        }
        return { key: list[0].key, k: 0, from: 0, to: 1, t0: 0, t1: 1 };
    }

    function clockAt(model, tl) {
        if (!model) return 0;
        const p = phaseAt(model, tl);
        if (p.key.startsWith('burn')) {
            return p.t0;
        }
        return p.t0 + p.k * (p.t1 - p.t0);
    }

    const smooth = (t) => t * t * (3 - 2 * t);
    const nearestAngle = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

    /* ------------------------------------------------------------------ */
    /* 3D Scene Constructor                                               */
    /* ------------------------------------------------------------------ */
    function create(THREE, dom, constants = {}) {
        const R_E = constants.R_EARTH || 6378.137;
        const FOV_DEG = 40;
        const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);
        const MIN_CAMERA_DISTANCE = 1.8;
        const MAX_ZOOM = 3.5;
        const ORBIT_SEGMENTS = 256;
        const ORBIT_SIDES = 6;
        const ARC_SEGMENTS = 96;
        const ARC_SIDES = 8;
        const DIMMED = 0.3;
        const HOME_SECONDS = 0.9;
        const CAMERA_SECONDS = 1.2;
        const MAX_TILT = 74;
        const FRAME_MARGIN = 1.22;
        const EARTH_EDGE = 1.05;

        const UPCOMING = 0.3;
        const DONE = 0.7;

        const COLORS = {
            eci: '#60a5fa',
            orbit1: '#e0b64f',     // Chase & orbit 1
            orbit2: '#34d399',     // Target & orbit 2
            transfer: '#ff8a3d',   // Transfer arc
            phase: '#a3e635',      // Phasing orbit
            dv: '#f87171',         // Delta-V
            theta: '#38bdf8',      // Phase angles phi, Delta nu, Delta u
            tof: '#c4a1ff',        // Target travel angles
            node: '#fbbf24',       // Line of nodes & markers
            radius: '#f0f4fa'      // Radius lines & rendezvous marker
        };

        const ORDER = { planes: 2, ghost: 6 };

        const { view, canvas, hint } = dom;
        const resetBtn = dom.reset || dom.resetViewBtn;

        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        } catch (err) {
            if (dom.showStatus) dom.showStatus('This browser could not start the 3D view. The sliders, values, and equations still work.');
            return null;
        }
        renderer.setClearColor(0x03060c);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 900);
        camera.up.set(0, 0, 1); // Z north

        scene.add(new THREE.AmbientLight(0xffffff, 0.85));
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
        sunLight.position.set(12, 6, 8);
        scene.add(sunLight);

        // Earth & Stars (never hidden or put into everything)
        const earth = global.EarthScene.addEarth(THREE, renderer, scene);
        earth.atmosphere.renderOrder = 1;
        const stars = global.EarthScene.addStars(THREE, scene);
        const layer = new Kit.LabelLayer(dom.labels, { wide: true });
        const MathRenderer = global.PracticeMath || { math: (s) => s };

        const X_AXIS = new THREE.Vector3(1, 0, 0);
        const Y_AXIS = new THREE.Vector3(0, 1, 0);
        const Z_AXIS = new THREE.Vector3(0, 0, 1);
        const ORIGIN = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        const tmpEnd = new THREE.Vector3();
        const tmpBefore = new THREE.Vector3();

        const everything = [];
        const track = (obj) => { everything.push(obj); return obj; };

        // Ghosted mesh helper
        function ghosted(geometry, color, ghost = 0.35) {
            const group = new THREE.Group();
            const solidMat = new THREE.MeshBasicMaterial({ color, transparent: true });
            const ghostMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false });
            const solid = new THREE.Mesh(geometry, solidMat);
            const dim = new THREE.Mesh(geometry, ghostMat);
            dim.renderOrder = ORDER.ghost;
            solid.frustumCulled = false;
            dim.frustumCulled = false;
            group.add(solid, dim);
            group.userData = { solidMat, ghostMat, ghost, parts: [solid, dim] };
            setOpacity(group, 1);
            return group;
        }

        function setOpacity(group, k) {
            const { solidMat, ghostMat, ghost } = group.userData;
            solidMat.opacity = k;
            ghostMat.opacity = ghost * k;
        }

        function setGeometry(group, geometry) {
            group.userData.parts[0].geometry.dispose();
            group.userData.parts.forEach((p) => { p.geometry = geometry; });
        }

        const SHAFT = new THREE.CylinderGeometry(1, 1, 1, 10);
        const HEAD = new THREE.ConeGeometry(0.5, 1.6, 14);
        const SPHERE = new THREE.SphereGeometry(1, 16, 12);

        function createArrow(color) {
            const group = new THREE.Group();
            const shaft = ghosted(SHAFT, color);
            const head = ghosted(HEAD, color);
            group.add(shaft, head);
            scene.add(track(group));
            return { group, shaft, head };
        }

        function placeArrow(arrow, level, from, to, sz, weight = 1, grow = 1) {
            tmp.subVectors(to, from).multiplyScalar(grow);
            const len = tmp.length();
            arrow.group.visible = level > 0.01 && len > 1e-4;
            if (!arrow.group.visible) return;
            const thick = weight * (0.85 + 0.35 * level);
            const headLen = Math.min(3.4 * sz * thick, len * 0.45);
            const shaftLen = len - headLen;
            arrow.group.position.copy(from);
            arrow.group.quaternion.setFromUnitVectors(Y_AXIS, tmp.normalize());
            arrow.shaft.scale.set(0.16 * sz * thick, shaftLen, 0.16 * sz * thick);
            arrow.shaft.position.y = shaftLen / 2;
            arrow.head.scale.setScalar(headLen / 1.6);
            arrow.head.position.y = shaftLen + headLen / 2;
            setOpacity(arrow.shaft, level);
            setOpacity(arrow.head, level);
        }

        function createMarker(color) {
            const marker = ghosted(SPHERE, color, 0.4);
            scene.add(track(marker));
            return marker;
        }

        function placeMarker(marker, opacity, position, size) {
            marker.visible = opacity > 0.01;
            if (!marker.visible) return;
            marker.position.copy(position);
            marker.scale.setScalar(size);
            setOpacity(marker, opacity);
        }

        function createRingMarker(color) {
            const geom = new THREE.RingGeometry(0.8, 1.1, 32);
            const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, depthWrite: false });
            const mesh = new THREE.Mesh(geom, mat);
            scene.add(track(mesh));
            return mesh;
        }

        function placeRing(ring, opacity, position, size) {
            ring.visible = opacity > 0.01;
            if (!ring.visible) return;
            ring.position.copy(position);
            ring.scale.setScalar(size);
            ring.material.opacity = opacity;
        }

        function createBar(color) {
            const bar = ghosted(SHAFT, color);
            scene.add(track(bar));
            return bar;
        }

        function placeBar(bar, opacity, from, to, radius) {
            tmp.subVectors(to, from);
            const len = tmp.length();
            bar.visible = opacity > 0.01 && len > 1e-3;
            if (!bar.visible) return;
            bar.position.copy(from).addScaledVector(tmp, 0.5);
            bar.quaternion.setFromUnitVectors(Y_AXIS, tmp.normalize());
            bar.scale.set(radius, len, radius);
            setOpacity(bar, opacity);
        }

        function createDisc(color, fillOpacity, rimOpacity) {
            const group = new THREE.Group();
            const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
            const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 96), fill);
            disk.renderOrder = ORDER.planes;
            const rim = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
            const points = [];
            for (let j = 0; j <= 120; j++) {
                const angle = (j / 120) * 2 * Math.PI;
                points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
            }
            group.add(disk, new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), rim));
            scene.add(track(group));
            return { group, fill, rim, fillOpacity, rimOpacity };
        }

        function placeDisc(disc, level, radius) {
            disc.group.visible = level > 0.01;
            if (!disc.group.visible) return;
            disc.group.scale.setScalar(radius);
            disc.fill.opacity = disc.fillOpacity * level;
            disc.rim.opacity = disc.rimOpacity * level;
        }

        class PathCurve extends THREE.Curve {
            constructor(fn) {
                super();
                this.fn = fn;
                this.arcLengthDivisions = ORBIT_SEGMENTS;
            }
            getPoint(t, target = new THREE.Vector3()) {
                return this.fn(t, target);
            }
        }

        // Orbits are thick, continuous tubes. Angle arcs are thinner, end in an
        // arrowhead, and can be dashed, so the two never read as the same thing.
        function createTube(color, { arc = false, dashed = false, radius = arc ? 0.13 : 0.24, ghost = arc ? 0.35 : 0.28 } = {}) {
            const tube = ghosted(new THREE.BufferGeometry(), color, ghost);
            Object.assign(tube.userData.solidMat, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
            if (dashed) {
                tube.userData.solidMat.vertexColors = true;
                tube.userData.ghostMat.vertexColors = true;
            }
            scene.add(track(tube));
            const t = {
                tube,
                radius,
                dashed,
                key: '',
                curve: null,
                segments: arc ? ARC_SEGMENTS : ORBIT_SEGMENTS,
                sides: arc ? ARC_SIDES : ORBIT_SIDES
            };
            if (arc) {
                t.glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: dashed });
                t.glow = new THREE.Mesh(new THREE.BufferGeometry(), t.glowMat);
                t.glow.frustumCulled = false;
                t.head = ghosted(HEAD, color);
                scene.add(track(t.glow), track(t.head));
            }
            return t;
        }

        // Dash a tube by fading alternate runs of rings to transparent (RGBA vertex colors)
        const DASH_RINGS = 3;
        function dashTube(geometry, segments, sides) {
            const colors = new Float32Array(geometry.attributes.position.count * 4);
            for (let i = 0; i <= segments; i++) {
                const alpha = Math.floor(i / DASH_RINGS) % 2 === 0 ? 1 : 0;
                for (let j = 0; j <= sides; j++) {
                    colors.set([1, 1, 1, alpha], (i * (sides + 1) + j) * 4);
                }
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
            return geometry;
        }

        // Shaded angle wedge: an annular sector in the orbital plane (z = 0)
        function createSector(color) {
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
            const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
            mesh.renderOrder = ORDER.planes;
            mesh.frustumCulled = false;
            scene.add(track(mesh));
            return { mesh, mat, key: '' };
        }

        function placeSector(sec, opacity, key, start, sweep, rIn, rOut) {
            sec.mesh.visible = opacity > 0.01 && sweep > 0.004 && rOut > rIn;
            if (!sec.mesh.visible) return;
            if (sec.key !== key) {
                sec.key = key;
                const n = Math.max(6, Math.ceil((sweep / (2 * Math.PI)) * 120));
                const pos = new Float32Array((n + 1) * 2 * 3);
                const idx = [];
                for (let i = 0; i <= n; i++) {
                    const a = start + (sweep * i) / n;
                    const c = Math.cos(a), s = Math.sin(a);
                    pos.set([rIn * c, rIn * s, 0, rOut * c, rOut * s, 0], i * 6);
                    if (i < n) {
                        const v = i * 2;
                        idx.push(v, v + 1, v + 3, v, v + 3, v + 2);
                    }
                }
                const geom = new THREE.BufferGeometry();
                geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                geom.setIndex(idx);
                sec.mesh.geometry.dispose();
                sec.mesh.geometry = geom;
            }
            // Lighter as the sweep grows, so a near-full wedge reads as an angle, not a disc
            sec.mat.opacity = opacity * Math.min(1, Math.sqrt(Math.PI / sweep));
        }

        function drawTube(t, k, opacity, key, pointAt, sz, anchor) {
            const shown = k > 0.002 && opacity > 0.01 && Boolean(pointAt);
            t.tube.visible = shown;
            if (t.glow) {
                t.glow.visible = shown;
                t.head.visible = shown;
            }
            if (!shown) return;

            if (t.key !== key) {
                t.key = key;
                t.curve = new PathCurve(pointAt);
                const geom = new THREE.TubeGeometry(t.curve, t.segments, t.radius * sz, t.sides, false);
                setGeometry(t.tube, t.dashed ? dashTube(geom, t.segments, t.sides) : geom);
                if (t.glow) {
                    t.glow.geometry.dispose();
                    const glow = new THREE.TubeGeometry(t.curve, t.segments, 0.45 * sz, t.sides, false);
                    t.glow.geometry = t.dashed ? dashTube(glow, t.segments, t.sides) : glow;
                }
            }

            const count = 6 * t.sides * Math.ceil(t.segments * k);
            t.tube.userData.parts[0].geometry.setDrawRange(0, count);
            setOpacity(t.tube, opacity);
            if (t.glow) {
                t.glow.geometry.setDrawRange(0, count);
                t.glowMat.opacity = 0.3 * Math.max(0, (opacity - DIMMED) / (1 - DIMMED));
                t.curve.getPointAt(k, tmpEnd);
                t.curve.getPointAt(Math.max(0, k - 0.012), tmpBefore);
                tmp.subVectors(tmpEnd, tmpBefore).normalize();
                const tipSize = 1.6 * sz;
                t.head.position.copy(tmpEnd).addScaledVector(tmp, -0.8 * tipSize);
                t.head.quaternion.setFromUnitVectors(Y_AXIS, tmp);
                t.head.scale.setScalar(tipSize);
                setOpacity(t.head, opacity);
            }
            if (anchor) t.curve.getPointAt(0.5, anchor);
        }

        // Axes
        const axisI = createArrow(COLORS.eci);
        const axisJ = createArrow(COLORS.eci);
        const axisK = createArrow(COLORS.eci);

        // Orbits and paths (Coplanar & Co-orbital)
        const orbitChaseTube = createTube(COLORS.orbit1);
        const orbitTargetTube = createTube(COLORS.orbit2);
        const transferTube = createTube(COLORS.transfer);
        const transferFaintTube = createTube(COLORS.transfer, { radius: 0.12 });
        const phasingTube = createTube(COLORS.phase);

        // Arcs
        const phiArc = createTube(COLORS.theta, { arc: true });
        const phiDesiredArc = createTube(COLORS.theta, { arc: true, dashed: true });
        const nuTravelArc = createTube(COLORS.tof, { arc: true });

        // Given positions, measured from I-hat (only when a frame angle is set)
        const thetaChaseArc = createTube(COLORS.orbit1, { arc: true });
        const thetaTargetArc = createTube(COLORS.orbit2, { arc: true });

        // Angle wedges (shaded between Earth and the arc) and the radial legs that
        // bound each angle at Earth's center, as in the lesson figures
        const phiSector = createSector(COLORS.theta);
        const nuSector = createSector(COLORS.tof);
        const legs = [0, 1, 2].map(() => createBar(COLORS.radius));
        const thetaLegs = [0, 1].map(() => createBar(COLORS.radius));

        // Radius lines
        const rChaseBar = createBar(COLORS.orbit1);
        const rTargetBar = createBar(COLORS.orbit2);

        // Spacecraft Markers
        const chaseConeGroup = new THREE.Group();
        const chaseConeMesh = ghosted(new THREE.ConeGeometry(0.35, 1.1, 14), COLORS.orbit1);
        chaseConeMesh.position.y = 0.55;
        chaseConeGroup.add(chaseConeMesh);
        scene.add(track(chaseConeGroup));

        const markerTarget = createMarker(COLORS.orbit2);
        const ghostTarget = createRingMarker(COLORS.orbit2);
        const markerRendezvous = createRingMarker(COLORS.radius);

        // Burn arrows
        const burnArrows = [1, 2, 3].map(() => ({
            before: createArrow(COLORS.orbit1),
            after: createArrow(COLORS.transfer),
            dv: createArrow(COLORS.dv)
        }));
        const burnMarkers = [1, 2, 3].map(() => createMarker(COLORS.node));

        /* ------------------------------------------------------------------ */
        /* Labels Setup                                                       */
        /* ------------------------------------------------------------------ */
        function measureLabel(tex, color, rank) {
            const math = MathRenderer.math;
            const label = layer.add(`<span style="color:${color}">${math(tex)}</span><span class="val"></span>`, { rank });
            label.el.classList.add('measure');
            label.valEl = label.el.querySelector('.val');
            return label;
        }

        function wordLabel(text, rank = 2, optional = false) {
            const label = layer.add(text, { rank, optional });
            label.el.classList.add('word');
            return label;
        }

        function axisLabel(letter) {
            const math = MathRenderer.math;
            const label = layer.add(math(`\\mathbf{\\hat{${letter}}}`), { rank: 1 });
            label.el.classList.add('axis');
            label.center = true;
            return label;
        }

        const labels = {
            I: axisLabel('I'),
            J: axisLabel('J'),
            K: axisLabel('K'),
            chase: wordLabel('Chase', 1, true),
            target: wordLabel('Target', 1, true),
            phi: measureLabel('\\phi', COLORS.theta, 0),
            phi0: measureLabel('\\phi_0', COLORS.theta, 0),
            phiDesired: measureLabel('\\phi_{\\text{desired}}', COLORS.theta, 1),
            thetaChase: measureLabel('\\theta_{\\text{chase}}', COLORS.orbit1, 1),
            thetaTarget: measureLabel('\\theta_{\\text{target}}', COLORS.orbit2, 1),
            nuTravel: measureLabel('\\nu_{\\text{travel}}', COLORS.tof, 1),
            rendezvous: wordLabel('Rendezvous', 2, true),
            r1: measureLabel('R_{\\text{chase}}', COLORS.orbit1, 2),
            r2: measureLabel('R_{\\text{target}}', COLORS.orbit2, 2),
            burns: [1, 2, 3].map((num) => ({
                dv: measureLabel(`\\Delta V_${num}`, COLORS.dv, 0)
            }))
        };

        function setLabelValue(label, text) {
            if (!label || !label.valEl) return;
            if (label.valEl.textContent === text) return;
            label.valEl.textContent = text;
            label.width = 0;
        }

        const kmText = (x) => `${Math.round(x).toLocaleString('en-US')} km`;
        const kmsText = (x) => `${Number(x).toFixed(3)} km/s`;
        const signedKmsText = (x) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(3)} km/s`;
        const degText = (x) => `${Number(x).toFixed(1)}°`;

        // Where the angle arcs sit (scene units), so none of them lies on an orbit:
        //   nu    the target's travel, a clear gap outside the orbit it measures
        //   live  the phase angle; between Earth and the inner orbit when there is
        //         room, otherwise outside everything (beyond nu)
        //   desired  the desired phase angle, just inside (or outside) the live arc
        function angleLayout(rIn, rOut, rNu) {
            const step = Math.max(0.16, 0.06 * rOut);
            const nu = Math.max(rNu, rOut) + step;
            const gap = rIn - 1;
            if (gap > 0.45) {
                return { inside: true, live: 1 + 0.64 * gap, desired: 1 + 0.34 * gap, nu, lap: 0.6 * step, fillIn: 1.02 };
            }
            return { inside: false, live: nu + 1.4 * step, desired: nu + 2.4 * step, nu, lap: 0.6 * step, fillIn: rOut + 0.25 * step };
        }

        // Largest radius drawn (scene units): the orbits, plus the angle arcs when
        // they are set off outside them. The camera frames and the axes reach this.
        function sceneExtent(m) {
            const rC = m.Rchase / R_E;
            const rT = (m.Rtarget || m.Rchase) / R_E;
            let ext = Math.max(rC, rT);
            const turns = Math.max(0, m.nu_travel || 0) / (2 * Math.PI);
            if (m.mode === 'coplanar') {
                const lay = angleLayout(Math.min(rC, rT), ext, rT);
                ext = Math.max(ext, lay.nu + lay.lap * turns, lay.inside ? 0 : lay.desired);
            } else if (m.mode === 'coorbital' && m.phi0 > 0) {
                const outer = Math.max(rC, m.r_a / R_E);
                const lay = angleLayout(Math.min(rC, m.r_p / R_E), outer, outer);
                ext = Math.max(ext, outer, lay.nu + lay.lap * turns, lay.inside ? 0 : lay.live);
            }
            return ext;
        }

        // Radii of the given-position arcs (theta_chase, theta_target), outside everything else
        function thetaRadii(m) {
            const ext = sceneExtent(m);
            const step = Math.max(0.22, 0.09 * ext);
            return [ext + step, ext + 2 * step];
        }

        function axisLength(m) {
            const reach = framed ? thetaRadii(m)[1] * 1.08 : 0;
            return Math.max(Math.max(m.Rchase, m.Rtarget || m.Rchase) / R_E * 1.35, sceneExtent(m) * 1.1, reach);
        }

        // What the camera keeps in view: the given-position arcs too, when there are any,
        // so the framing does not jump when they go away
        function viewExtent(m) {
            return framed ? thetaRadii(m)[1] : sceneExtent(m);
        }

        // Thin radial leg from Earth's center out through a point to at least `reach`
        function placeLeg(leg, opacity, point, reach, sz) {
            const len = Math.hypot(point.x, point.y, point.z);
            if (len < 1e-6) { leg.visible = false; return; }
            const end = tmpEnd.copy(point).multiplyScalar(Math.max(len, reach) / len);
            placeBar(leg, opacity, ORIGIN, end, 0.05 * sz);
        }

        // One velocity scale per scenario: the fastest speed at any burn is drawn
        // 35% as long as the largest orbit radius.
        function velocityScale(m) {
            let maxBurnVel = 1;
            (m.events || []).forEach((ev) => {
                maxBurnVel = Math.max(maxBurnVel, Math.hypot(...ev.vBefore), Math.hypot(...ev.vAfter));
            });
            const maxRScene = Math.max(m.Rchase, m.Rtarget || m.Rchase) / R_E;
            return (maxRScene * 0.35) / maxBurnVel;
        }

        // Co-orbital burns happen at the same point. Draw only the burn the timeline
        // has reached last, so their arrows and labels never stack.
        function burnHidden(m, idx, curKey) {
            const evs = m.events || [];
            const ev = evs[idx];
            const later = evs[idx + 1];
            if (!ev) return true;
            const samePoint = (a, b) => a && b && Math.hypot(a.r[0] - b.r[0], a.r[1] - b.r[1], a.r[2] - b.r[2]) < 1e-6;
            if (samePoint(ev, later)) {
                const list = segments(m);
                const now = list.findIndex((s) => s.key === curKey);
                const laterAt = list.findIndex((s) => s.key === `burn${idx + 2}`);
                if (laterAt >= 0 && now >= laterAt) return true;
            }
            const earlier = evs[idx - 1];
            if (samePoint(ev, earlier)) {
                const list = segments(m);
                const now = list.findIndex((s) => s.key === curKey);
                const at = list.findIndex((s) => s.key === `burn${idx + 1}`);
                if (now < at) return true;
            }
            return false;
        }

        const sameOrbit = (m) => m.mode === 'coplanar' && Math.abs(m.Rchase - m.Rtarget) <= 50;

        /* ------------------------------------------------------------------ */
        /* State & Camera                                                     */
        /* ------------------------------------------------------------------ */
        let currentModel = null;
        let modelSeq = 0;
        let timelineTl = 0;
        // The solvers start the chase at theta = 0. A frame angle (the chase's given position,
        // measured from I-hat) turns the inertial axes back by that much, and the camera with
        // them, so the axes look the same and the chase starts that far from I-hat.
        let frameRad = 0;
        let framed = false;
        const axisDir = (rad, out = new THREE.Vector3()) => out.set(Math.cos(rad - frameRad), Math.sin(rad - frameRad), 0);
        // values: false labels computed quantities by symbol only (a practice page hides them
        // until the answers are graded); the given radii and initial phase angle keep theirs.
        // reveal: null draws everything; an object draws only the parts of the solution set in
        // it (transfer, phasing, nu, desired, burns), so that a walkthrough can build them up.
        let shown = { vectors: true, angles: true, labels: true, values: true, reveal: null, compareHohmann: false };
        const revealed = (part) => !shown.reveal || Boolean(shown.reveal[part]);
        let dirty = true;
        let viewW = 1, viewH = 1;
        let flight = null;
        const camView = { az: 25, el: 55, zoom: 1, x: 0, y: 0, z: 0 };
        const CAMERA_KEYS = ['az', 'el', 'zoom', 'x', 'y', 'z'];
        let focusKey = 'start';
        let manual = false;

        function fromAngles(az, el) {
            const a = az * D2R, e = el * D2R;
            return new THREE.Vector3(
                Math.cos(e) * Math.cos(a),
                Math.cos(e) * Math.sin(a),
                Math.sin(e)
            );
        }

        function homeGoal() {
            // Pull back on narrow (portrait) views so the largest orbit fits side to side
            const aspect = viewW / viewH;
            const zoom = Math.min(MAX_ZOOM, Math.max(1, 1.08 / Math.max(0.2, aspect)));
            return { az: 25 - frameRad * R2D, el: 55, zoom, x: 0, y: 0, z: 0 };
        }

        function flyTo(goal, seconds) {
            const from = { ...camView };
            flight = {
                from,
                to: { ...goal, az: nearestAngle(from.az, goal.az) },
                clock: 0,
                seconds
            };
        }

        function fit(direction, points, tight = false) {
            const az = Math.atan2(direction.y, direction.x) * R2D;
            const el = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.asin(Math.max(-1, Math.min(1, direction.z))) * R2D));
            const dir = fromAngles(az, el);
            const right = new THREE.Vector3().crossVectors(Z_AXIS, dir).normalize();
            const up = new THREE.Vector3().crossVectors(dir, right);
            const all = tight ? points : points.concat([
                right.clone().multiplyScalar(EARTH_EDGE), right.clone().multiplyScalar(-EARTH_EDGE),
                up.clone().multiplyScalar(EARTH_EDGE), up.clone().multiplyScalar(-EARTH_EDGE)
            ]);

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of all) {
                const x = p.dot(right), y = p.dot(up);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
            const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
            const aspect = viewW / viewH;
            let distance = 0;
            for (const p of all) {
                const depth = p.dot(dir);
                const needY = (Math.abs(p.dot(up) - midY) * FRAME_MARGIN) / TAN_HALF_FOV;
                const needX = (Math.abs(p.dot(right) - midX) * FRAME_MARGIN) / (TAN_HALF_FOV * aspect);
                distance = Math.max(distance, depth + needY, depth + needX);
            }

            const target = right.multiplyScalar(midX).addScaledVector(up, midY);
            const baseDist = Math.max(3.9, (currentModel ? viewExtent(currentModel) : 4) * 2.8);
            const zoom = Math.min(MAX_ZOOM, (distance * Math.min(1, aspect)) / baseDist);
            return { az, el, zoom, x: target.x, y: target.y, z: target.z };
        }

        function goalFor(key) {
            if (!currentModel || key === 'start' || key === 'together' || key === 'overview') {
                return homeGoal();
            }
            const baseDir = fromAngles(camView.az, 55);

            if (key === 'burn1' || key === 'burn2' || key === 'burn3') {
                const evIdx = key === 'burn1' ? 0 : key === 'burn2' ? 1 : 2;
                if (currentModel.events && currentModel.events[evIdx]) {
                    // Frame the burn point, its velocity arrows, and Earth, so the
                    // close-up keeps the arrows whole and shows where the burn is.
                    const ev = currentModel.events[evIdx];
                    const vs = velocityScale(currentModel);
                    const p = new THREE.Vector3(...ev.r).multiplyScalar(1 / R_E);
                    const tipB = p.clone().addScaledVector(new THREE.Vector3(...ev.vBefore), vs);
                    const tipA = p.clone().addScaledVector(new THREE.Vector3(...ev.vAfter), vs);
                    const goal = fit(baseDir, [p, tipB, tipA, ORIGIN]);
                    goal.zoom = Math.max(0.45, goal.zoom);
                    return goal;
                }
            }
            return homeGoal();
        }

        function setFocus(key, instant = false) {
            focusKey = key;
            manual = false;
            if (!currentModel) return;
            if (instant || (Kit && Kit.prefersReducedMotion && Kit.prefersReducedMotion())) {
                flight = null;
                Object.assign(camView, goalFor(key));
            } else {
                flyTo(goalFor(key), CAMERA_SECONDS);
            }
            dirty = true;
        }

        function refit() {
            if (!currentModel || manual) return;
            const goal = goalFor(focusKey);
            if (flight) flight.to = { ...goal, az: nearestAngle(flight.from.az, goal.az) };
            else Object.assign(camView, goal);
        }

        function resetView(zoom) {
            manual = false;
            const goal = homeGoal();
            if (typeof zoom === 'number') goal.zoom = zoom;
            flyTo(goal, HOME_SECONDS);
            dirty = true;
        }

        function setModel(model) {
            if (!model) return;
            modelSeq++;
            currentModel = model;
            currentModel.id = modelSeq;
            layer.remeasure();
            if (!manual) {
                refit();
            }
            dirty = true;
        }

        function setTime(tl) {
            timelineTl = Math.max(0, Math.min(1, tl));
            dirty = true;
        }

        function setShown(cfg) {
            shown = { ...shown, ...cfg };
            dirty = true;
        }

        // deg: where the chase starts, measured from I-hat; null for no frame (chase on I-hat)
        function setFrame(deg) {
            framed = typeof deg === 'number' && Number.isFinite(deg);
            frameRad = framed ? deg * D2R : 0;
            dirty = true;
        }

        /* ------------------------------------------------------------------ */
        /* Orbit & Burn Helpers                                               */
        /* ------------------------------------------------------------------ */
        function orbitPoint3D(r, incRad, raanRad, uRad, out = new THREE.Vector3()) {
            const cosO = Math.cos(raanRad), sinO = Math.sin(raanRad);
            const cosI = Math.cos(incRad), sinI = Math.sin(incRad);
            const cosU = Math.cos(uRad), sinU = Math.sin(uRad);
            return out.set(
                r * (cosO * cosU - sinO * sinU * cosI),
                r * (sinO * cosU + cosO * sinU * cosI),
                r * sinU * sinI
            );
        }

        function burnState(name, curKey, curK) {
            const list = segments(currentModel);
            const now = list.findIndex((s) => s.key === curKey);
            const at = list.findIndex((s) => s.key === name);
            if (at < 0) return { level: 0, grow: 0, active: false };
            if (now < at) return { level: UPCOMING, grow: 1, active: false };
            if (now === at) return { level: 1, grow: smooth(curK), active: true };
            return { level: DONE, grow: 1, active: false };
        }

        /* ------------------------------------------------------------------ */
        /* Dynamic Anchor Cache for Labels                                    */
        /* ------------------------------------------------------------------ */
        const anchors = {
            chasePos: new THREE.Vector3(),
            targetPos: new THREE.Vector3(),
            rendezvousPos: new THREE.Vector3(),
            rChaseMid: new THREE.Vector3(),
            rTargetMid: new THREE.Vector3(),
            phiAnchor: new THREE.Vector3(),
            nuAnchor: new THREE.Vector3(),
            deltaAnchor: new THREE.Vector3(),
            phiDesiredAnchor: new THREE.Vector3(),
            phiDesiredText: '',
            phiIsInitial: false,
            thetaChaseAnchor: new THREE.Vector3(),
            thetaTargetAnchor: new THREE.Vector3(),
            thetaChaseText: '',
            thetaTargetText: '',
            burns: [
                { pos: new THREE.Vector3(), dvVal: 0, name: 'burn1' },
                { pos: new THREE.Vector3(), dvVal: 0, name: 'burn2' },
                { pos: new THREE.Vector3(), dvVal: 0, name: 'burn3' }
            ],
            phiText: '',
            hasRendezvous: false
        };

        /* ------------------------------------------------------------------ */
        /* Scene Geometry Update                                              */
        /* ------------------------------------------------------------------ */
        function updateScene() {
            if (!currentModel) return;

            const m = currentModel;
            const mid = m.id || 0;
            const tl = timelineTl;
            const p = phaseAt(m, tl);
            const t_phys = clockAt(m, tl);
            const state = global.RendezvousMath.stateAt(m, t_phys);

            const rChaseKm = m.Rchase;
            const rTargetKm = m.Rtarget || m.Rchase;
            const rChaseScene = rChaseKm / R_E;
            const rTargetScene = rTargetKm / R_E;
            const maxRScene = Math.max(rChaseScene, rTargetScene);
            const sz = Math.max(0.04, maxRScene * 0.012);

            // Hide all dynamic tracked objects
            for (const o of everything) o.visible = false;

            // Coordinate axes
            const axisLen = axisLength(m);
            placeArrow(axisI, 0.45, ORIGIN, axisDir(0).multiplyScalar(axisLen), sz);
            placeArrow(axisJ, 0.45, ORIGIN, axisDir(Math.PI / 2).multiplyScalar(axisLen), sz);
            placeArrow(axisK, 0.45, ORIGIN, new THREE.Vector3(0, 0, axisLen), sz);

            // Craft positions
            anchors.chasePos.set(state.chase.r[0] / R_E, state.chase.r[1] / R_E, state.chase.r[2] / R_E);
            const chaseVel = new THREE.Vector3(...state.chase.v);
            anchors.targetPos.set(state.target.r[0] / R_E, state.target.r[1] / R_E, state.target.r[2] / R_E);

            // Place Craft Markers
            chaseConeGroup.visible = true;
            chaseConeGroup.position.copy(anchors.chasePos);
            if (chaseVel.lengthSq() > 1e-6) {
                tmp.copy(chaseVel).normalize();
                chaseConeGroup.quaternion.setFromUnitVectors(Y_AXIS, tmp);
            }
            chaseConeGroup.scale.setScalar(sz * 2.8);
            setOpacity(chaseConeMesh, 1);

            placeMarker(markerTarget, 1, anchors.targetPos, sz * 1.8);

            anchors.hasRendezvous = false;
            anchors.phiText = '';
            anchors.phiDesiredText = '';
            anchors.phiIsInitial = false;
            anchors.nuShown = false;

            const same = sameOrbit(m);

            /* Mode-specific visuals */
            if (m.mode === 'coplanar') {
                const theta_dep = m.n_chase * m.WT;
                const onStartOrbit = t_phys < m.WT || same;

                // Radius lines: the chase's line follows it until the departure burn,
                // then stays on the departure point; the target is always on its circle.
                const depPos = tmpB.set(rChaseScene * Math.cos(theta_dep), rChaseScene * Math.sin(theta_dep), 0);
                const chaseBarEnd = onStartOrbit ? anchors.chasePos : depPos;
                anchors.rChaseMid.copy(chaseBarEnd).multiplyScalar(0.5);
                anchors.rTargetMid.copy(anchors.targetPos).multiplyScalar(0.5);
                placeBar(rChaseBar, 0.35, ORIGIN, chaseBarEnd, 0.08 * sz);
                placeBar(rTargetBar, 0.35, ORIGIN, anchors.targetPos, 0.08 * sz);

                // Chase circle
                drawTube(orbitChaseTube, 1, 0.85, `${mid}_cp_chase`, (t, out) => {
                    const ang = t * 2 * Math.PI;
                    return out.set(rChaseScene * Math.cos(ang), rChaseScene * Math.sin(ang), 0);
                }, sz);

                // Target circle
                drawTube(orbitTargetTube, 1, 0.85, `${mid}_cp_target`, (t, out) => {
                    const ang = t * 2 * Math.PI;
                    return out.set(rTargetScene * Math.cos(ang), rTargetScene * Math.sin(ang), 0);
                }, sz);

                if (!same && revealed('transfer')) {
                    // Hohmann transfer: always prograde. Departure is perigee when
                    // raising and apogee when lowering, so the true anomaly at the
                    // departure point is 0 or 180 degrees.
                    const a_tx_scene = m.a_transfer / R_E;
                    const e_tx = Math.abs(rChaseScene - rTargetScene) / (rChaseScene + rTargetScene);
                    const p_tx = a_tx_scene * (1 - e_tx * e_tx);
                    const nuDep = rChaseScene <= rTargetScene ? 0 : Math.PI;
                    const txPoint = (sweep, out) => {
                        const r = p_tx / (1 + e_tx * Math.cos(nuDep + sweep));
                        const angle = theta_dep + sweep;
                        return out.set(r * Math.cos(angle), r * Math.sin(angle), 0);
                    };
                    const flying = p.key === 'transfer' || p.key === 'burn1';
                    drawTube(transferTube, 1, flying || p.key === 'burn2' ? 0.95 : 0.6, `${mid}_cp_tx`, (t, out) => txPoint(t * Math.PI, out), sz);
                    drawTube(transferFaintTube, 1, 0.22, `${mid}_cp_tx_faint`, (t, out) => txPoint(Math.PI + t * Math.PI, out), sz);

                    // Rendezvous point: the far end of the transfer
                    const arrTheta = theta_dep + Math.PI;
                    anchors.rendezvousPos.set(rTargetScene * Math.cos(arrTheta), rTargetScene * Math.sin(arrTheta), 0);
                    anchors.hasRendezvous = true;
                    placeRing(markerRendezvous, 0.9, anchors.rendezvousPos, sz * 2.4);
                }

                const rIn = Math.min(rChaseScene, rTargetScene);
                const rOut = Math.max(rChaseScene, rTargetScene);
                const lay = angleLayout(rIn, rOut, rTargetScene);
                const waiting = !same && p.key === 'wait';
                const desiredShown = waiting && revealed('desired');

                // Ghost target: where the target must be at the departure burn
                const theta_target_dep = -m.phi0_rad + m.n_target * m.WT;
                const ghostPos = tmpA.set(rTargetScene * Math.cos(theta_target_dep), rTargetScene * Math.sin(theta_target_dep), 0);
                if (desiredShown) placeRing(ghostTarget, 0.75, ghostPos, sz * 2.2);

                if (shown.angles) {
                    // Live phase angle: from the target's radial line to the chase's,
                    // in the direction of motion (the long way when over 180 degrees).
                    // A shaded wedge between its radial lines marks it as an angle.
                    const tAng = Math.atan2(anchors.targetPos.y, anchors.targetPos.x);
                    const curPhiRad = global.RendezvousMath.wrap2Pi(Math.atan2(anchors.chasePos.y, anchors.chasePos.x) - tAng);
                    if (curPhiRad > 0.004 && p.key !== 'together') {
                        const key = `${mid}_phi_${curPhiRad.toFixed(3)}`;
                        drawTube(phiArc, 1, 0.95, key, (t, out) => {
                            const ang = tAng + t * curPhiRad;
                            return out.set(lay.live * Math.cos(ang), lay.live * Math.sin(ang), 0);
                        }, sz, anchors.phiAnchor);
                        placeSector(phiSector, 0.16, key, tAng, curPhiRad, lay.fillIn, lay.live);
                        anchors.phiText = degText(curPhiRad * R2D);
                        if (!lay.inside) {
                            // Arcs outside the orbits: carry the radial lines out to them
                            placeLeg(rChaseBar, 0.35, anchors.chasePos, lay.live, sz);
                            placeLeg(rTargetBar, 0.35, anchors.targetPos, lay.live, sz);
                        }
                    }

                    // Desired phase angle at the departure burn (dashed: a goal, not yet
                    // reached), between the target-at-departure and departure-point legs
                    if (desiredShown && m.phi_desired > 0.004) {
                        drawTube(phiDesiredArc, 1, 0.75, `${mid}_phides`, (t, out) => {
                            const ang = theta_target_dep + t * m.phi_desired;
                            return out.set(lay.desired * Math.cos(ang), lay.desired * Math.sin(ang), 0);
                        }, sz, anchors.phiDesiredAnchor);
                        anchors.phiDesiredText = degText(m.phi_desired_deg);
                        placeLeg(legs[1], 0.3, depPos, lay.desired, sz);
                    }

                    // Target angular travel during the transfer, from the target at
                    // departure to the rendezvous point, set off from the target orbit
                    // (spiraling outward if it passes 360 degrees)
                    if (!same && revealed('nu')) {
                        anchors.nuShown = true;
                        const nuLevel = p.key === 'transfer' ? 1.0 : p.key === 'burn2' || p.key === 'together' ? 0.75 : 0.5;
                        const nuEnd = lay.nu + lay.lap * (m.nu_travel / (2 * Math.PI));
                        drawTube(nuTravelArc, 1, nuLevel, `${mid}_nu_trav`, (t, out) => {
                            const ang = theta_target_dep + t * m.nu_travel;
                            const r = lay.nu + lay.lap * ((t * m.nu_travel) / (2 * Math.PI));
                            return out.set(r * Math.cos(ang), r * Math.sin(ang), 0);
                        }, sz, anchors.nuAnchor);
                        if (p.key === 'transfer') {
                            placeSector(nuSector, 0.09, `${mid}_nusec`, theta_target_dep, Math.min(m.nu_travel, 2 * Math.PI), rTargetScene, lay.nu);
                        }
                        placeLeg(legs[0], 0.3, ghostPos, Math.max(lay.nu, desiredShown ? lay.desired : 0), sz);
                        if (anchors.hasRendezvous) placeLeg(legs[2], 0.3, anchors.rendezvousPos, nuEnd, sz);
                    }
                }

            } else if (m.mode === 'coorbital') {
                // Radius line to the target, which never leaves the shared circle
                anchors.rChaseMid.copy(anchors.targetPos).multiplyScalar(0.5);
                placeBar(rChaseBar, 0.35, ORIGIN, anchors.targetPos, 0.08 * sz);

                // Shared circular orbit
                drawTube(orbitTargetTube, 1, 0.85, `${mid}_co_orbit`, (t, out) => {
                    const ang = t * 2 * Math.PI;
                    return out.set(rChaseScene * Math.cos(ang), rChaseScene * Math.sin(ang), 0);
                }, sz);

                // Phasing orbit: touches the circle at the burn point (theta = 0), which
                // is its apogee when the chase is behind and its perigee when ahead
                const a_p_scene = m.a_phasing / R_E;
                const e_p = Math.abs(m.a_phasing - rChaseKm) / m.a_phasing;
                const isBehind = m.isBehind;
                const isDangerous = m.h_p < m.constants.MIN_ALT;

                phasingTube.tube.userData.solidMat.color.set(isDangerous ? COLORS.dv : COLORS.phase);
                phasingTube.tube.userData.ghostMat.color.set(isDangerous ? COLORS.dv : COLORS.phase);

                if (m.phi0 > 0 && revealed('phasing')) {
                    const phasingLevel = p.key === 'phasing' ? 0.95 : 0.7;
                    drawTube(phasingTube, 1, phasingLevel, `${mid}_co_phasing_${a_p_scene.toFixed(4)}`, (t, out) => {
                        const nu = t * 2 * Math.PI;
                        const r = (a_p_scene * (1 - e_p * e_p)) / (1 + e_p * Math.cos(isBehind ? nu + Math.PI : nu));
                        return out.set(r * Math.cos(nu), r * Math.sin(nu), 0);
                    }, sz);
                }

                if (shown.angles && m.phi0 > 0) {
                    const outer = Math.max(rChaseScene, m.r_a / R_E);
                    const lay = angleLayout(Math.min(rChaseScene, m.r_p / R_E), outer, outer);
                    // Initial phase angle: target to chase, in the direction of motion,
                    // shaded between its radial lines
                    const tStartAng = -m.phi0_rad;
                    const phiLevel = p.key === 'together' ? 0.45 : 0.9;
                    drawTube(phiArc, 1, phiLevel, `${mid}_co_phi`, (t, out) => {
                        const ang = tStartAng + t * m.phi0_rad;
                        return out.set(lay.live * Math.cos(ang), lay.live * Math.sin(ang), 0);
                    }, sz, anchors.phiAnchor);
                    placeSector(phiSector, 0.16 * phiLevel, `${mid}_co_phisec`, tStartAng, m.phi0_rad, lay.fillIn, lay.live);
                    anchors.phiText = degText(m.phi0);
                    anchors.phiIsInitial = true;

                    // Target travel during ONE phasing orbit, set off outside both orbits;
                    // past 360 degrees (chase ahead) it spirals outward for the extra turn,
                    // as in the lesson figure
                    const nuLevel = p.key === 'phasing' ? 1.0 : 0.6;
                    const nuOn = revealed('nu');
                    const nuEnd = lay.nu + lay.lap * (m.nu_travel / (2 * Math.PI));
                    if (nuOn) {
                        anchors.nuShown = true;
                        drawTube(nuTravelArc, 1, nuLevel, `${mid}_co_nu1`, (t, out) => {
                            const ang = tStartAng + t * m.nu_travel;
                            const r = lay.nu + lay.lap * ((t * m.nu_travel) / (2 * Math.PI));
                            return out.set(r * Math.cos(ang), r * Math.sin(ang), 0);
                        }, sz, anchors.nuAnchor);
                    }

                    // Radial legs: the target's start (where phi_0 and nu_travel begin)
                    // and the burn point (where both end)
                    const reach = Math.max(nuOn ? nuEnd : 0, lay.inside ? 0 : lay.live);
                    placeLeg(legs[0], 0.3, tmpA.set(Math.cos(tStartAng), Math.sin(tStartAng), 0).multiplyScalar(rChaseScene), reach, sz);
                    placeLeg(legs[1], 0.3, tmpB.set(rChaseScene, 0, 0), reach, sz);
                }
            }

            // Given positions at the start: theta from I-hat to each spacecraft, in the
            // direction of motion, set off just outside everything else
            anchors.thetaChaseText = '';
            anchors.thetaTargetText = '';
            if (framed && shown.angles && revealed('thetas') && tl <= 1e-6) {
                const [rChaseArc, rTargetArc] = thetaRadii(m);
                const start = -frameRad;
                const thetaTarget = global.RendezvousMath.wrap2Pi(frameRad - m.phi0_rad);
                const arcs = [
                    { tube: thetaChaseArc, sweep: frameRad, r: rChaseArc, pos: anchors.chasePos, anchor: anchors.thetaChaseAnchor, text: 'thetaChaseText' },
                    { tube: thetaTargetArc, sweep: thetaTarget, r: rTargetArc, pos: anchors.targetPos, anchor: anchors.thetaTargetAnchor, text: 'thetaTargetText' }
                ];
                arcs.forEach((a, i) => {
                    placeLeg(thetaLegs[i], 0.3, a.pos, a.r, sz);
                    if (a.sweep < 0.004) return;
                    drawTube(a.tube, 1, 0.9, `${mid}_theta${i}_${a.sweep.toFixed(4)}_${frameRad.toFixed(4)}`, (t, out) => {
                        const ang = start + t * a.sweep;
                        return out.set(a.r * Math.cos(ang), a.r * Math.sin(ang), 0);
                    }, sz, a.anchor);
                    anchors[a.text] = degText(a.sweep * R2D);
                });
            }

            // Burn velocity & Delta-V arrows
            anchors.burns.forEach((b) => { b.shown = false; });
            if (shown.vectors && m.events && m.events.length > 0 && !same && revealed('burns')) {
                const vScale = velocityScale(m);
                const minDv = 2 * sz;

                m.events.forEach((ev, idx) => {
                    if (idx >= burnArrows.length) return;
                    const evKey = `burn${idx + 1}`;
                    anchors.burns[idx].shown = false;
                    if (burnHidden(m, idx, p.key)) return;

                    const arrows = burnArrows[idx];
                    const burnPos = new THREE.Vector3(...ev.r).multiplyScalar(1 / R_E);
                    const vB = new THREE.Vector3(...ev.vBefore).multiplyScalar(vScale);
                    const vA = new THREE.Vector3(...ev.vAfter).multiplyScalar(vScale);
                    const s = burnState(evKey, p.key, p.k);
                    const level = s.level;

                    // Tiny burns (a few m/s) get a minimum-length Delta-V arrow, labeled as enlarged
                    const dV = new THREE.Vector3().subVectors(vA, vB);
                    const enlarged = dV.length() < minDv;
                    if (enlarged && dV.lengthSq() > 0) dV.setLength(minDv);

                    const offset = burnPos.clone().normalize().multiplyScalar(0.08 * Math.max(vB.length(), vA.length()));
                    const tipBefore = burnPos.clone().add(vB);
                    // Old velocity on the orbit; new velocity and Delta-V drawn just
                    // outside and inside it, so all three stay visible when they are parallel
                    placeArrow(arrows.before, level, burnPos, tipBefore, sz);
                    placeArrow(arrows.after, level, burnPos.clone().add(offset), burnPos.clone().add(offset).add(vA), sz, 1, s.grow);
                    const dvFrom = tipBefore.clone().sub(offset);
                    placeArrow(arrows.dv, s.grow > 0.02 ? level : 0, dvFrom, dvFrom.clone().add(dV), sz, 1.25, s.grow);
                    anchors.burns[idx].pos.copy(dvFrom).addScaledVector(dV, 0.5 * s.grow).sub(offset);

                    placeMarker(burnMarkers[idx], s.active ? 1 : 0.7, burnPos, 0.5 * sz);
                    anchors.burns[idx].dvVal = typeof ev.dv_signed === 'number' ? ev.dv_signed : Math.hypot(...ev.dv);
                    anchors.burns[idx].signed = typeof ev.dv_signed === 'number';
                    anchors.burns[idx].enlarged = enlarged;
                    anchors.burns[idx].shown = true;
                });
            }
        }

        /* ------------------------------------------------------------------ */
        /* Label Placement                                                    */
        /* ------------------------------------------------------------------ */
        const projected = new THREE.Vector3();
        const tipScreen = new THREE.Vector3();
        const axisSpots = [];

        function project(label, point, level = 1) {
            if (!label || !point) return;
            projected.copy(point).project(camera);
            if (projected.z > 1) return;
            layer.show(label, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH, Math.max(0.55, level));
        }

        function showAxisName(label, tip, direction) {
            if (!label) return;
            projected.copy(tip).project(camera);
            const x = (projected.x + 1) * 0.5 * viewW, y = (1 - projected.y) * 0.5 * viewH;
            tipScreen.copy(tip).addScaledVector(direction, 0.5).project(camera);
            let dx = (tipScreen.x + 1) * 0.5 * viewW - x, dy = (1 - tipScreen.y) * 0.5 * viewH - y;
            const size = Math.hypot(dx, dy);
            if (size < 1e-3) { dx = 0; dy = -1; } else { dx /= size; dy /= size; }
            if (!label.width) { label.width = label.el.offsetWidth || 14; label.height = label.el.offsetHeight || 20; }
            const reach = 6 + (Math.abs(dx) * label.width) / 2 + (Math.abs(dy) * label.height) / 2;
            const spot = { x: x + dx * reach, y: y + dy * reach, w: label.width, h: label.height };
            for (const other of axisSpots) {
                const apartX = (spot.w + other.w) / 2 + 4, apartY = (spot.h + other.h) / 2 + 3;
                if (Math.abs(spot.x - other.x) < apartX && Math.abs(spot.y - other.y) < apartY) {
                    spot.x = other.x + (other.x < viewW / 2 ? apartX : -apartX);
                }
            }
            axisSpots.push(spot);
            layer.show(label, spot.x, spot.y);
        }

        function updateLabels() {
            if (!currentModel) return;
            layer.begin();
            axisSpots.length = 0;

            const axisLen = axisLength(currentModel);
            const dirI = axisDir(0), dirJ = axisDir(Math.PI / 2);
            showAxisName(labels.I, dirI.clone().multiplyScalar(axisLen * 1.05), dirI);
            showAxisName(labels.J, dirJ.clone().multiplyScalar(axisLen * 1.05), dirJ);
            showAxisName(labels.K, new THREE.Vector3(0, 0, axisLen * 1.05), Z_AXIS);

            if (shown.labels) {
                // Craft names
                project(labels.chase, anchors.chasePos, 0.95);
                project(labels.target, anchors.targetPos, 0.95);

                // Radii
                const same = sameOrbit(currentModel);
                if (currentModel.mode !== 'coorbital') {
                    setLabelValue(labels.r1, kmText(currentModel.Rchase));
                    project(labels.r1, anchors.rChaseMid, 0.8);
                    if (!same) {
                        setLabelValue(labels.r2, kmText(currentModel.Rtarget));
                        project(labels.r2, anchors.rTargetMid, 0.8);
                    }
                } else {
                    setLabelValue(labels.r1, kmText(currentModel.Rchase));
                    project(labels.r1, anchors.rChaseMid, 0.8);
                }

                // Rendezvous arrival point
                if (anchors.hasRendezvous) {
                    project(labels.rendezvous, anchors.rendezvousPos, 0.85);
                }

                // Angles. At the start, the live phase angle is the given phi_0.
                if (shown.angles) {
                    if (anchors.phiText && anchors.phiAnchor.lengthSq() > 1e-4) {
                        const lbl = anchors.phiIsInitial ? labels.phi0 : labels.phi;
                        // A walkthrough that asks for phi_0 reveals its value with the 'phi0' part
                        const given = (anchors.phiIsInitial || clockAt(currentModel, timelineTl) <= 0) && revealed('phi0');
                        setLabelValue(lbl, shown.values || given ? anchors.phiText : '');
                        project(lbl, anchors.phiAnchor, 0.85);
                    }
                    if (anchors.thetaChaseText) {
                        setLabelValue(labels.thetaChase, anchors.thetaChaseText);
                        project(labels.thetaChase, anchors.thetaChaseAnchor, 0.85);
                    }
                    if (anchors.thetaTargetText) {
                        setLabelValue(labels.thetaTarget, anchors.thetaTargetText);
                        project(labels.thetaTarget, anchors.thetaTargetAnchor, 0.85);
                    }
                    if (anchors.phiDesiredText && anchors.phiDesiredAnchor.lengthSq() > 1e-4) {
                        setLabelValue(labels.phiDesired, shown.values ? anchors.phiDesiredText : '');
                        project(labels.phiDesired, anchors.phiDesiredAnchor, 0.8);
                    }
                    if (anchors.nuShown && currentModel.nu_travel_deg && !same && currentModel.phi0 !== 0 && anchors.nuAnchor.lengthSq() > 1e-4) {
                        setLabelValue(labels.nuTravel, shown.values ? degText(currentModel.nu_travel_deg) : '');
                        project(labels.nuTravel, anchors.nuAnchor, 0.85);
                    }
                }

                // Burn labels: only for burns drawn this frame that are active or done
                if (shown.vectors && currentModel.events && !same) {
                    const p = phaseAt(currentModel, timelineTl);
                    currentModel.events.forEach((ev, idx) => {
                        if (idx >= labels.burns.length) return;
                        const b = anchors.burns[idx];
                        if (!b.shown) return;
                        const s = burnState(`burn${idx + 1}`, p.key, p.k);
                        if (s.level >= DONE - 0.01 && s.grow > 0.02) {
                            const lbl = labels.burns[idx].dv;
                            const value = shown.values ? (b.signed ? signedKmsText(b.dvVal) : kmsText(b.dvVal)) : '';
                            setLabelValue(lbl, [value, b.enlarged ? '(enlarged)' : ''].filter(Boolean).join(' '));
                            project(lbl, b.pos, s.level);
                        }
                    });
                }
            }

            layer.place(viewW, viewH);
        }

        /* ------------------------------------------------------------------ */
        /* Camera Update & Render Frame                                       */
        /* ------------------------------------------------------------------ */
        function updateCamera() {
            const baseDist = Math.max(3.9, (currentModel ? viewExtent(currentModel) : 4) * 2.8);
            const distance = baseDist * camView.zoom;
            const el = camView.el * D2R, az = camView.az * D2R;
            const lookTarget = new THREE.Vector3(camView.x, camView.y, camView.z);
            camera.position.set(
                lookTarget.x + distance * Math.cos(el) * Math.cos(az),
                lookTarget.y + distance * Math.cos(el) * Math.sin(az),
                lookTarget.z + distance * Math.sin(el)
            );
            camera.lookAt(lookTarget);
            camera.updateMatrixWorld();
        }

        function renderFrame() {
            if (!currentModel) return;
            updateCamera();
            updateScene();
            stars.follow(camera);
            renderer.render(scene, camera);
            updateLabels();
        }

        /* ------------------------------------------------------------------ */
        /* Pointer Drag & Zoom Interaction                                    */
        /* ------------------------------------------------------------------ */
        const pointers = new Map();
        let pinchStart = 0, pinchZoom = 1;

        function clampZoom(z) {
            return Math.min(MAX_ZOOM, Math.max(0.35, z));
        }

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
            if (hint) hint.style.display = 'none';
        });

        canvas.addEventListener('pointermove', (event) => {
            const last = pointers.get(event.pointerId);
            if (!last || !currentModel) return;
            flight = null;
            manual = true;
            if (pointers.size === 1) {
                camView.az -= (event.clientX - last.x) * 0.35;
                camView.el = Math.min(86, Math.max(-86, camView.el + (event.clientY - last.y) * 0.3));
            }
            last.x = event.clientX;
            last.y = event.clientY;
            if (pointers.size === 2 && pinchStart > 0) {
                const [p1, p2] = [...pointers.values()];
                camView.zoom = clampZoom((pinchZoom * pinchStart) / Math.hypot(p1.x - p2.x, p1.y - p2.y));
            }
            dirty = true;
        });

        const removePointer = (event) => pointers.delete(event.pointerId);
        canvas.addEventListener('pointerup', removePointer);
        canvas.addEventListener('pointercancel', removePointer);

        canvas.addEventListener('wheel', (event) => {
            if (!currentModel) return;
            event.preventDefault();
            flight = null;
            manual = true;
            camView.zoom = clampZoom(camView.zoom * Math.exp(event.deltaY * 0.0012));
            dirty = true;
            if (hint) hint.style.display = 'none';
        }, { passive: false });

        if (resetBtn) {
            resetBtn.addEventListener('click', () => resetView());
        }

        /* ------------------------------------------------------------------ */
        /* Resize & Animation Loop                                            */
        /* ------------------------------------------------------------------ */
        function resize() {
            viewW = Math.max(1, view.clientWidth);
            viewH = Math.max(1, view.clientHeight);
            renderer.setSize(viewW, viewH, false);
            camera.aspect = viewW / viewH;
            camera.updateProjectionMatrix();
            layer.remeasure();
            refit();
            dirty = true;
            renderFrame();
        }

        if (Kit && Kit.observeSize) {
            Kit.observeSize(view, resize);
        } else {
            window.addEventListener('resize', resize);
        }

        if (Kit && Kit.startLoop) {
            Kit.startLoop((seconds) => {
                if (flight) {
                    flight.clock += seconds;
                    const k = smooth(Math.min(1, flight.clock / flight.seconds));
                    for (const name of CAMERA_KEYS) {
                        camView[name] = flight.from[name] + (flight.to[name] - flight.from[name]) * k;
                    }
                    if (k >= 1) flight = null;
                    dirty = true;
                }
                if (layer.settling) dirty = true;
                if (dirty) {
                    dirty = false;
                    renderFrame();
                }
            });
        }

        return {
            setModel,
            setTime,
            setShown,
            setFrame,
            setFocus,
            resetView,
            resize
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    global.RendezvousScene = {
        create,
        segments,
        phaseAt,
        clockAt
    };

})(typeof window !== 'undefined' ? window : globalThis);
