// The 3D view for the Orbital Maneuvers tool. It is drawn the same way as the maneuver view on
// the Test 1 Practice page (practice/test-1-maneuver-scene.js): the same colors, tube and arrow
// sizes, camera framing, and labels. Unlike that view, every part is shown at once and is
// rebuilt whenever a slider moves. A timeline from 0 to 1 moves the spacecraft through the
// maneuver, and each burn brightens while it happens.
// Load as a classic script.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;

    /* Timeline --------------------------------------------------------- */
    // The parts of the timeline for a maneuver, each with its start and end, from 0 to 1. Both
    // the scene and the page use this, so that the caption and the picture always agree.
    function segments(model) {
        if (!model) return [{ key: 'coast1', from: 0, to: 1 }];
        if (model.type === 'hohmann' || model.type === 'combined') {
            if (Math.abs(model.R1 - model.R2) < 1e-6) return [{ key: 'coast1', from: 0, to: 1 }];
            const separate = model.type === 'combined' && model.planeChangeLocation === 'separate';
            if (separate && model.isRaise) {
                return [
                    { key: 'coast1', from: 0, to: 0.2 }, { key: 'burn1', from: 0.2, to: 0.25 },
                    { key: 'transfer', from: 0.25, to: 0.7 }, { key: 'burn2', from: 0.7, to: 0.75 },
                    { key: 'burn3', from: 0.75, to: 0.8 }, { key: 'coast2', from: 0.8, to: 1 }
                ];
            }
            if (separate) {
                return [
                    { key: 'coast1', from: 0, to: 0.15 }, { key: 'burn3', from: 0.15, to: 0.2 },
                    { key: 'burn1', from: 0.2, to: 0.25 }, { key: 'transfer', from: 0.25, to: 0.75 },
                    { key: 'burn2', from: 0.75, to: 0.8 }, { key: 'coast2', from: 0.8, to: 1 }
                ];
            }
            return [
                { key: 'coast1', from: 0, to: 0.2 }, { key: 'burn1', from: 0.2, to: 0.25 },
                { key: 'transfer', from: 0.25, to: 0.75 }, { key: 'burn2', from: 0.75, to: 0.8 },
                { key: 'coast2', from: 0.8, to: 1 }
            ];
        }
        if (model.delta_theta < 0.01) return [{ key: 'coast1', from: 0, to: 1 }];
        return [
            { key: 'coast1', from: 0, to: 0.45 }, { key: 'burn', from: 0.45, to: 0.55 },
            { key: 'coast2', from: 0.55, to: 1 }
        ];
    }

    // The part of the timeline at t, and how far through it t is, from 0 to 1.
    function phaseAt(model, t) {
        const list = segments(model);
        for (const s of list) {
            if (t < s.to || s === list[list.length - 1]) {
                return { key: s.key, k: Math.max(0, Math.min(1, (t - s.from) / Math.max(1e-6, s.to - s.from))), from: s.from, to: s.to };
            }
        }
        return { key: 'coast1', k: 0, from: 0, to: 1 };
    }

    // Which burn of a combined maneuver turns the plane.
    function planeBurn(model) {
        if (model.type !== 'combined') return null;
        const loc = model.planeChangeLocation || 'higher';
        if (loc === 'separate') return 'burn3';
        if (loc === 'lower') return model.isRaise ? 'burn1' : 'burn2';
        return model.isRaise ? 'burn2' : 'burn1';
    }

    const smooth = (t) => t * t * (3 - 2 * t);
    const nearestAngle = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

    function create(THREE, dom, constants) {
        const R_E = constants.R_EARTH;
        const FOV_DEG = 40;
        const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);
        const MIN_CAMERA_DISTANCE = 1.8;
        const MAX_ZOOM = 3;
        const ORBIT_SEGMENTS = 256;
        const ORBIT_SIDES = 6;
        const ARC_SEGMENTS = 96;
        const ARC_SIDES = 8;
        const DIMMED = 0.3;
        const HOME_SECONDS = 0.9;
        const CAMERA_SECONDS = 1.4;     // A camera move to the next step
        const MAX_TILT = 74;            // Steepest camera angle a step uses, in degrees
        const FRAME_MARGIN = 1.18;      // Room left around what a step frames
        const EARTH_EDGE = 1.03;
        const TIP_CLEARANCE = 3.2;      // The camera stays this many tip distances from the center

        // Levels for a burn's arrows: before it happens, while it happens, and after it.
        const UPCOMING = 0.3;
        const DONE = 0.7;

        const COLORS = {
            eci: '#60a5fa',
            orbit1: '#e0b64f',
            orbit2: '#34d399',
            transfer: '#ff8a3d',
            dv: '#f87171',
            node: '#fbbf24',
            theta: '#38bdf8',
            tof: '#c4a1ff',
            radius: '#f0f4fa'
        };

        // Draw order, lowest first. Dim "ghost" copies are drawn last, without depth testing, so
        // that a part behind or inside Earth is still faintly visible.
        const ORDER = { planes: 2, ghost: 6 };

        const { view, canvas, hint } = dom;

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
        camera.up.set(0, 0, 1); // Z points north

        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
        sunLight.position.set(12, 6, 8);
        scene.add(sunLight);

        const earth = global.EarthScene.addEarth(THREE, renderer, scene);
        earth.atmosphere.renderOrder = 1;
        const stars = global.EarthScene.addStars(THREE, scene);
        const layer = new Kit.LabelLayer(dom.labels, { wide: true });
        const { math } = global.PracticeMath;

        const X_AXIS = new THREE.Vector3(1, 0, 0);
        const Y_AXIS = new THREE.Vector3(0, 1, 0);
        const Z_AXIS = new THREE.Vector3(0, 0, 1);
        const ORIGIN = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        const tmpEnd = new THREE.Vector3();
        const tmpBefore = new THREE.Vector3();
        const tmpA = new THREE.Vector3();
        const tmpB = new THREE.Vector3();
        const satPoint = new THREE.Vector3();

        const everything = [];
        const track = (object) => {
            everything.push(object);
            return object;
        };

        /* Scene objects ---------------------------------------------------- */
        // A solid object plus a dim ghost of it, sharing one geometry.
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
            group.userData.parts.forEach((part) => { part.geometry = geometry; });
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

        // `grow` draws the arrow part of the way from its tail. A brighter arrow is drawn thicker.
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

        // Follows a function of t from 0 to 1, for a tube along an orbit or an angle.
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

        // An orbit is a plain tube. An angle or a stretch of travel also has a glow and an arrowhead.
        function createTube(color, { arc = false, radius = arc ? 0.3 : 0.2, ghost = arc ? 0.35 : 0.28 } = {}) {
            const tube = ghosted(new THREE.BufferGeometry(), color, ghost);
            Object.assign(tube.userData.solidMat, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
            scene.add(track(tube));
            const t = { tube, radius, key: '', curve: null, segments: arc ? ARC_SEGMENTS : ORBIT_SEGMENTS, sides: arc ? ARC_SIDES : ORBIT_SIDES };
            if (arc) {
                t.glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
                t.glow = new THREE.Mesh(new THREE.BufferGeometry(), t.glowMat);
                t.glow.frustumCulled = false;
                t.head = ghosted(HEAD, color);
                scene.add(track(t.glow), track(t.head));
            }
            return t;
        }

        // Draws the path from its start to the fraction k of its length. The tubes are rebuilt
        // only when the path or the zoom changes.
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
                setGeometry(t.tube, new THREE.TubeGeometry(t.curve, t.segments, t.radius * sz, t.sides, false));
                if (t.glow) {
                    t.glow.geometry.dispose();
                    t.glow.geometry = new THREE.TubeGeometry(t.curve, t.segments, 0.85 * sz, t.sides, false);
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

        const axisI = createArrow(COLORS.eci);
        const axisJ = createArrow(COLORS.eci);
        const axisK = createArrow(COLORS.eci);
        const equatorDisc = createDisc(0x3a82f7, 0.15, 0.6);

        const orbit1Tube = createTube(COLORS.orbit1);
        const orbit2Tube = createTube(COLORS.orbit2);
        const transferTube = createTube(COLORS.transfer);
        const transferRestTube = createTube(COLORS.transfer, { radius: 0.12 });
        const tofArc = createTube(COLORS.tof, { arc: true });
        const coastArc = createTube(COLORS.tof, { arc: true });
        const thetaArc = createTube(COLORS.theta, { arc: true });
        const raanArc = createTube(COLORS.theta, { arc: true });

        const rBar1 = createBar(COLORS.orbit1);
        const rBar2 = createBar(COLORS.orbit2);
        const rBarPlane = createBar(COLORS.radius);
        const majorAxisBar = createBar(COLORS.transfer);
        const nodeBar = createBar(COLORS.node);

        // Before and after each burn, and the change between them
        const burnArrows = ['burn1', 'burn2', 'burn3', 'burn'].reduce((all, name) => {
            all[name] = { before: createArrow(COLORS.orbit1), after: createArrow(COLORS.transfer), dv: createArrow(COLORS.dv) };
            return all;
        }, {});
        const recolor = (arrow, color) => {
            [arrow.shaft, arrow.head].forEach((g) => {
                g.userData.solidMat.color.set(color);
                g.userData.ghostMat.color.set(color);
            });
        };

        const markerSat = createMarker(0xffffff);
        const burnMarkers = { burn1: createMarker(COLORS.node), burn2: createMarker(COLORS.node), burn3: createMarker(COLORS.node), burn: createMarker(COLORS.node) };

        /* Labels ----------------------------------------------------------- */
        function measureLabel(tex, color, rank) {
            const label = layer.add(`<span style="color:${color}">${math(tex)}</span><span class="val"></span>`, { rank });
            label.el.classList.add('measure');
            label.valEl = label.el.querySelector('.val');
            return label;
        }

        function wordLabel(rank = 2, optional = false) {
            const label = layer.add('', { rank, optional });
            label.el.classList.add('word');
            return label;
        }

        function axisLabel(letter) {
            const label = layer.add(math(`\\mathbf{\\hat{${letter}}}`), { rank: 1 });
            label.el.classList.add('axis');
            label.center = true;
            return label;
        }

        const labels = {
            I: axisLabel('I'),
            J: axisLabel('J'),
            K: axisLabel('K'),
            R1: measureLabel('R_1', COLORS.orbit1, 1),
            R2: measureLabel('R_2', COLORS.orbit2, 1),
            i1: measureLabel('i_1', COLORS.orbit1, 2),
            i2: measureLabel('i_2', COLORS.orbit2, 2),
            raan1: measureLabel('\\Omega_1', COLORS.orbit1, 2),
            raan2: measureLabel('\\Omega_2', COLORS.orbit2, 2),
            atx: measureLabel('a_{tx}', COLORS.transfer, 1),
            r: measureLabel('r', COLORS.radius, 1),
            dtheta: measureLabel('\\Delta \\theta', COLORS.theta, 0),
            draan: measureLabel('\\Delta \\Omega', COLORS.theta, 1),
            tof: measureLabel('TOF', COLORS.tof, 1),
            du: measureLabel('\\Delta u', COLORS.tof, 1),
            burn: wordLabel(),
            burns: {
                burn1: { before: measureLabel('V_1', COLORS.orbit1, 2), after: measureLabel('V_{tx_1}', COLORS.transfer, 2), dv: measureLabel('\\Delta V_1', COLORS.dv, 0) },
                burn2: { before: measureLabel('V_{tx_2}', COLORS.transfer, 2), after: measureLabel('V_2', COLORS.orbit2, 2), dv: measureLabel('\\Delta V_2', COLORS.dv, 0) },
                burn3: { before: measureLabel('V', COLORS.orbit1, 2), after: measureLabel('V', COLORS.orbit2, 2), dv: measureLabel('\\Delta V_3', COLORS.dv, 0) },
                burn: { before: measureLabel('V_1', COLORS.orbit1, 2), after: measureLabel('V_2', COLORS.orbit2, 2), dv: measureLabel('\\Delta V', COLORS.dv, 0) }
            }
        };

        function setLabelValue(label, text) {
            if (label.valEl.textContent === text) return;
            if (label.valEl.textContent.length !== text.length) label.width = 0;
            label.valEl.textContent = text;
        }

        function setWord(label, text) {
            if (label.el.textContent === text) return;
            label.el.textContent = text;
            label.width = 0;
        }

        const kmText = (x) => `${Math.round(x).toLocaleString('en-US')} km`;
        const kmsText = (x) => `${x.toFixed(3)} km/s`;
        const degText = (x) => `${x.toFixed(1)}°`;

        /* Orbit geometry --------------------------------------------------- */
        function orbitPoint(r, inc, raan, u, out = new THREE.Vector3()) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return out.set(
                r * (Math.cos(o) * Math.cos(a) - Math.sin(o) * Math.sin(a) * Math.cos(i)),
                r * (Math.sin(o) * Math.cos(a) + Math.cos(o) * Math.sin(a) * Math.cos(i)),
                r * Math.sin(a) * Math.sin(i)
            );
        }

        function orbitTangent(inc, raan, u, out = new THREE.Vector3()) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return out.set(
                -Math.cos(o) * Math.sin(a) - Math.sin(o) * Math.cos(a) * Math.cos(i),
                -Math.sin(o) * Math.sin(a) + Math.cos(o) * Math.cos(a) * Math.cos(i),
                Math.cos(a) * Math.sin(i)
            ).normalize();
        }

        const planeNormal = (inc, raan) => new THREE.Vector3(
            Math.sin(raan * D2R) * Math.sin(inc * D2R), -Math.cos(raan * D2R) * Math.sin(inc * D2R), Math.cos(inc * D2R));
        const ring = (r, inc, raan) => (t, out) => orbitPoint(r, inc, raan, t * 360, out);
        const ringSample = (r, inc, raan, from = 0, to = 360, count = 36) =>
            Array.from({ length: count + 1 }, (_, k) => orbitPoint(r, inc, raan, from + ((to - from) * k) / count));

        // Looks down on a plane from its north side, tilted a little toward -J.
        function aboveView(normal) {
            const up = normal.z < 0 ? normal.clone().negate() : normal.clone();
            return up.addScaledVector(Z_AXIS, 0.24).add(new THREE.Vector3(0, -0.35, 0)).normalize();
        }

        function fromAngles(az, el) {
            const a = az * D2R, b = el * D2R;
            return new THREE.Vector3(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b));
        }

        // Looks at the orbital plane from well off to one side, so that it does not appear edge-on.
        function homeView(normal, baseAz) {
            const base = fromAngles(baseAz, 22);
            const toward = normal.clone();
            if (toward.dot(base) < 0) toward.negate();
            const direction = base.multiplyScalar(0.9).add(toward).normalize();
            return {
                az: Math.atan2(direction.y, direction.x) * R2D,
                el: Math.max(12, Math.min(62, Math.asin(direction.z) * R2D))
            };
        }

        // The arc between two directions at a point, for the angle a burn turns the velocity.
        function turnArc(point, from, to, radius) {
            const u = from.clone().normalize();
            const w = to.clone().normalize();
            const n = w.clone().addScaledVector(u, -w.dot(u)).normalize();
            const angle = u.angleTo(w);
            return (t, out) => out.copy(point).addScaledVector(u, radius * Math.cos(angle * t)).addScaledVector(n, radius * Math.sin(angle * t));
        }

        // A direction part of the way from `from` to `to`, turning in the plane of the two.
        function turnToward(from, to, k, out) {
            const u = tmpA.copy(from).normalize();
            const w = tmpB.copy(to).normalize();
            const angle = u.angleTo(w);
            if (angle < 1e-4) return out.copy(from).lerp(to, k);
            const n = w.addScaledVector(u, -w.dot(u)).normalize();
            const length = from.length() + (to.length() - from.length()) * k;
            return out.copy(u).multiplyScalar(Math.cos(angle * k)).addScaledVector(n, Math.sin(angle * k)).multiplyScalar(length);
        }

        // The size of the view and the reference axes, from how far out the orbits reach.
        function frame(reach, kScale) {
            const axisBase = Math.max(2.1, reach * 1.25);
            const viewRadius = Math.max(2.6, axisBase * 1.14);
            return {
                reach,
                axisBase,
                iTip: new THREE.Vector3(axisBase * 1.08, 0, 0),
                jTip: new THREE.Vector3(0, axisBase * 1.08, 0),
                kTip: new THREE.Vector3(0, 0, axisBase * kScale),
                equatorRadius: axisBase * 0.96,
                camFit: viewRadius / TAN_HALF_FOV
            };
        }

        // A burn at point P, where the velocity changes from `before` to `after`. A burn that only
        // changes the speed draws three parallel lines: the new velocity just outside the old one,
        // and the change just inside it, starting level with the tip of the old velocity.
        function burnAt(P, before, after) {
            const collinear = before.angleTo(after) < 0.5 * D2R;
            const offset = collinear ? P.clone().normalize().multiplyScalar(0.09 * Math.max(before.length(), after.length())) : new THREE.Vector3();
            const afterFrom = P.clone().add(offset);
            const tipBefore = P.clone().add(before);
            return {
                P,
                collinear,
                offset,
                afterFrom,
                tipBefore,
                tipAfter: afterFrom.clone().add(after),
                dvFrom: tipBefore.clone().sub(offset),
                dvEnd: P.clone().sub(offset).add(after),
                before,
                after
            };
        }

        // The faster velocity at a burn is drawn half as long as the radius there, as in Test 1.
        function velocities(R, u, incBefore, vBefore, incAfter, vAfter) {
            const scale = (0.5 * R) / Math.max(vBefore, vAfter);
            return [orbitTangent(incBefore, 0, u).multiplyScalar(vBefore * scale), orbitTangent(incAfter, 0, u).multiplyScalar(vAfter * scale)];
        }

        // True anomaly on the transfer, from the share of the transfer time flown. The spacecraft
        // is fastest near perigee.
        function transferU(t, eSigned) {
            if (t <= 0) return 0;
            if (t >= 1) return 180;
            const e = Math.abs(eSigned), raise = eSigned >= 0;
            const M = Math.PI * (raise ? t : 1 + t);
            let E = M;
            for (let k = 0; k < 12; k++) {
                const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
                E -= step;
                if (Math.abs(step) < 1e-10) break;
            }
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return ((nu * R2D + 360) % 360) - (raise ? 0 : 180);
        }

        // Share of a path's length covered by its parameter x, for drawing a tube up to a point.
        function lengthTable(pointAt) {
            const N = 180, lengths = [0];
            const a = new THREE.Vector3(), b = new THREE.Vector3();
            pointAt(0, a);
            for (let j = 1; j <= N; j++) {
                pointAt(j / N, b);
                lengths.push(lengths[j - 1] + a.distanceTo(b));
                a.copy(b);
            }
            const total = lengths[N] || 1;
            return (x) => {
                const f = Math.max(0, Math.min(1, x)) * N, j = Math.floor(f);
                const l = j >= N ? lengths[N] : lengths[j] + (lengths[j + 1] - lengths[j]) * (f - j);
                return l / total;
            };
        }

        /* Model data ------------------------------------------------------- */
        function transferData(m) {
            const combined = m.type === 'combined';
            const R1 = m.R1 / R_E, R2 = m.R2 / R_E;
            const i1 = combined ? m.i1 : 0, i2 = combined ? m.i2 : 0;
            const turnBurn = planeBurn(m);
            const separate = turnBurn === 'burn3';
            const raise = m.isRaise;

            // The plane of each leg. A separate plane change is its own burn at the higher orbit.
            const incStart = separate && !raise ? i2 : i1;       // Just before burn 1
            const iTransfer = turnBurn === 'burn1' || (separate && !raise) ? i2 : i1;
            const incEnd = separate && raise ? i1 : i2;          // Just after burn 2
            const noTransfer = Math.abs(R1 - R2) < 1e-6;

            const a = (R1 + R2) / 2, eSigned = (R2 - R1) / (R1 + R2), p = a * (1 - eSigned * eSigned);
            const transferAt = (u, out = new THREE.Vector3()) => orbitPoint(p / (1 + eSigned * Math.cos(u * D2R)), iTransfer, 0, u, out);
            const transferHalf = (t, out) => transferAt(t * 180, out);

            const P1 = orbitPoint(R1, i1, 0, 0), P2 = orbitPoint(R2, i2, 0, 180);
            const burns = {
                burn1: burnAt(P1, ...velocities(R1, 0, incStart, m.v1, iTransfer, m.v_tx1)),
                burn2: burnAt(P2, ...velocities(R2, 180, iTransfer, m.v_tx2, incEnd, m.v2))
            };
            if (separate) {
                const highR = raise ? R2 : R1, highU = raise ? 180 : 0, highV = raise ? m.v2 : m.v1;
                burns.burn3 = burnAt(raise ? P2.clone() : P1.clone(), ...velocities(highR, highU, i1, highV, i2, highV));
            }
            const turn = turnBurn ? burns[turnBurn] : null;
            const center = P1.clone().add(P2).multiplyScalar(0.5);
            const Q1 = orbitPoint(R1, i1, 0, -60), Q2 = orbitPoint(R2, i2, 0, -120);
            const W = planeNormal(iTransfer, 0);

            return {
                family: 'transfer',
                model: m, combined, noTransfer, R1, R2, i1, i2, incStart, incEnd, iTransfer, eSigned,
                P1, P2, burns, turnBurn, center, Q1, Q2,
                ...frame(Math.max(R1, R2), 0.55),
                ring1: ring(R1, i1, 0),
                ring2: ring(R2, i2, 0),
                transferAt,
                transferHalf,
                transferOther: (t, out) => transferAt(180 + t * 180, out),
                transferLength: lengthTable(transferHalf),
                thetaPath: turn && m.delta_theta > 0.05 ? turnArc(turn.P, turn.before, turn.after, 0.42 * Math.min(turn.before.length(), turn.after.length())) : null,
                aAnchor: center.clone().lerp(P2, 0.55),
                r1Anchor: Q1.clone().multiplyScalar(0.6),
                r2Anchor: Q2.clone().multiplyScalar(0.6),
                i1Anchor: orbitPoint(R1, i1, 0, 90),
                i2Anchor: orbitPoint(R2, i2, 0, 90),
                home: homeView(W, -70),
                // For framing each step
                above: aboveView(W),
                ring1Points: ringSample(R1, i1, 0),
                transferPoints: Array.from({ length: 13 }, (_, k) => transferAt(k * 15)),
                burnFrames: {
                    burn1: [R1, incStart, iTransfer, 0],
                    burn2: [R2, iTransfer, incEnd, 180],
                    burn3: raise ? [R2, i1, i2, 180] : [R1, i1, i2, 0]
                }
            };
        }

        function planeData(m) {
            const polar = m.type === 'polar_raan';
            const r = m.r / R_E;
            const plane1 = polar ? { inc: 90, raan: m.raan1 } : { inc: m.i1, raan: m.raan };
            const plane2 = polar ? { inc: 90, raan: m.raan2 } : { inc: m.i2, raan: m.raan };
            const uBurn = m.u_burn;
            const coast = polar ? m.delta_u_to_pole : m.delta_u_to_node;
            const vLength = 0.45 * r;
            const sat = orbitPoint(r, plane1.inc, plane1.raan, m.u_sc);
            const B = orbitPoint(r, plane1.inc, plane1.raan, uBurn);
            const T1 = orbitTangent(plane1.inc, plane1.raan, uBurn).multiplyScalar(vLength);
            const T2 = orbitTangent(plane2.inc, plane2.raan, uBurn).multiplyScalar(vLength);
            // The line where the planes cross: the line of nodes, or Earth's axis for polar orbits
            const along = polar ? Z_AXIS.clone() : new THREE.Vector3(Math.cos(plane1.raan * D2R), Math.sin(plane1.raan * D2R), 0);
            const W1 = planeNormal(plane1.inc, plane1.raan), W2 = planeNormal(plane2.inc, plane2.raan);
            const planesMatch = m.delta_theta < 0.01;
            const raanRadius = 0.6 * r;

            return {
                family: 'plane',
                model: m, polar, r, plane1, plane2, uBurn, coast, sat, B, T1, T2, planesMatch,
                burn: burnAt(B, T1, T2),
                ...frame(r, 0.9),
                // A tilted orbit rises above the frame's circle, so leave a little more room.
                // Polar orbits reach up to the poles, where their burn and its labels are.
                camFit: frame(r, 0.9).camFit * (polar ? 1.3 : 1.12),
                ring1: ring(r, plane1.inc, plane1.raan),
                ring2: ring(r, plane2.inc, plane2.raan),
                nodeFrom: along.clone().multiplyScalar(-r * 1.25),
                nodeTo: along.clone().multiplyScalar(r * 1.25),
                thetaPath: turnArc(B, T1, T2, 0.4 * vLength),
                coastPath: (t, out) => orbitPoint(r, plane1.inc, plane1.raan, m.u_sc + t * coast, out),
                raanPath: polar && !planesMatch
                    ? (t, out) => {
                        const angle = (m.raan1 + t * (m.raan2 - m.raan1)) * D2R;
                        return out.set(raanRadius * Math.cos(angle), raanRadius * Math.sin(angle), 0);
                    }
                    : null,
                anchor1: polar ? orbitPoint(r, plane1.inc, plane1.raan, 0) : orbitPoint(r, plane1.inc, plane1.raan, 90),
                anchor2: polar ? orbitPoint(r, plane2.inc, plane2.raan, 0) : orbitPoint(r, plane2.inc, plane2.raan, 90),
                home: homeView(planesMatch ? W1 : W1.clone().add(W2).normalize(), 35),
                // For framing each step. At the burn, look along the line where the planes
                // cross, so the two velocities show at their true angle. Over a pole, look in
                // from the side instead of down Earth's axis.
                above: aboveView(W1),
                ring1Points: ringSample(r, plane1.inc, plane1.raan),
                nearBurn: ringSample(r, plane1.inc, plane1.raan, uBurn - 14, uBurn + 14, 4)
                    .concat(ringSample(r, plane2.inc, plane2.raan, uBurn - 14, uBurn + 14, 4)),
                V1tip: B.clone().add(T1),
                V2tip: B.clone().add(T2),
                burnDir: (() => {
                    const Bhat = B.clone().normalize();
                    return polar
                        ? Bhat.clone().addScaledVector(T1.clone().add(T2).normalize(), 0.9).normalize()
                        : Bhat.clone().addScaledVector(Z_AXIS, 0.35).addScaledVector(new THREE.Vector3().crossVectors(Z_AXIS, Bhat).normalize(), -0.25).normalize();
                })()
            };
        }

        /* State ------------------------------------------------------------ */
        let data = null;
        let modelId = 0;
        let lastType = '';
        let time = 0;
        let phase = { key: 'coast1', k: 0 };
        let shown = { vectors: true, angles: true, labels: true };
        let dirty = true;
        let viewW = 1, viewH = 1;
        let flight = null;
        const camView = { az: 25, el: 30, zoom: 1, x: 0, y: 0, z: 0 };
        const CAMERA_KEYS = Object.keys(camView);
        const anchors = { theta: new THREE.Vector3(), tof: new THREE.Vector3(), du: new THREE.Vector3(), raan: new THREE.Vector3() };

        let focusKey = 'start';   // The step the camera frames
        let manual = false;       // True once the reader has turned or zoomed the view in this step

        function homeGoal() {
            return { az: data.home.az, el: data.home.el, zoom: 1, x: 0, y: 0, z: 0 };
        }

        function flyTo(goal, seconds) {
            const from = { ...camView };
            flight = { from, to: { ...goal, az: nearestAngle(from.az, goal.az) }, clock: 0, seconds };
        }

        // The camera setting that looks along `direction` and fits these points and Earth. With
        // `tight`, only the points are fitted, so the view centers on them. From Test 1.
        function fit(direction, points, tight = false, clearTip = true) {
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
            for (const point of all) {
                const x = point.dot(right), y = point.dot(up);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
            const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;

            const aspect = viewW / viewH;
            let distance = 0;
            for (const point of all) {
                const depth = point.dot(dir);
                const needY = (Math.abs(point.dot(up) - midY) * FRAME_MARGIN) / TAN_HALF_FOV;
                const needX = (Math.abs(point.dot(right) - midX) * FRAME_MARGIN) / (TAN_HALF_FOV * aspect);
                distance = Math.max(distance, depth + needY, depth + needX);
            }
            // An arrow pointing at the camera looks huge up close.
            if (clearTip) distance = Math.max(distance, data.kTip.dot(dir) * TIP_CLEARANCE);

            const target = right.multiplyScalar(midX).addScaledVector(up, midY);
            const zoom = Math.min(MAX_ZOOM, (distance * Math.min(1, aspect)) / data.camFit);
            return { az, el, zoom, x: target.x, y: target.y, z: target.z };
        }

        // A burn seen from above its plane, or, when it turns the velocity, from outside the
        // orbit, so the triangle of velocities shows at its true angle.
        function burnGoal(b, R, incBefore, incAfter, u) {
            const near = ringSample(R, incBefore, 0, u - 12, u + 12, 4).concat(ringSample(R, incAfter, 0, u - 12, u + 12, 4));
            const points = [b.P, b.tipBefore, b.tipAfter, b.dvFrom, b.dvEnd, b.afterFrom, ...near];
            if (b.collinear) return fit(data.above, points, true, false);
            const outward = b.P.clone().normalize();
            return fit(outward.add(new THREE.Vector3(0, -0.3, 0.35)).normalize(), points, true, false);
        }

        // Where the camera goes for each step: the whole maneuver at the start and the end, and
        // a close view of each burn, coast, and transfer in between.
        function goalFor(key) {
            const d = data;
            if (key === 'start' || key === 'coast2') return homeGoal();
            if (d.family === 'transfer') {
                if (d.noTransfer) return homeGoal();
                switch (key) {
                    case 'coast1': return fit(d.above, [...d.ring1Points, d.P1]);
                    case 'transfer': return fit(d.above, [...d.transferPoints, d.P1, d.P2]);
                    case 'burn1': case 'burn2': case 'burn3':
                        return d.burns[key] ? burnGoal(d.burns[key], ...d.burnFrames[key]) : homeGoal();
                    default: return homeGoal();
                }
            }
            if (d.planesMatch) return homeGoal();
            if (key === 'coast1') return fit(d.above, [...d.ring1Points, d.sat, d.B]);
            if (key === 'burn') return fit(d.burnDir, [d.B, d.V1tip, d.V2tip, ...d.nearBurn], true, false);
            return homeGoal();
        }

        // Moves the camera to frame a step.
        function setFocus(key, instant = false) {
            focusKey = key;
            manual = false;
            if (!data) return;
            if (instant || Kit.prefersReducedMotion()) {
                flight = null;
                Object.assign(camView, goalFor(key));
            } else {
                flyTo(goalFor(key), CAMERA_SECONDS);
            }
            dirty = true;
        }

        // Keeps the current step framed after the orbits or the view size change.
        function refit() {
            if (!data || manual) return;
            const goal = goalFor(focusKey);
            if (flight) flight.to = { ...goal, az: nearestAngle(flight.from.az, goal.az) };
            else Object.assign(camView, goal);
        }

        function setModel(model) {
            if (!model) return;
            modelId += 1;
            data = model.type === 'hohmann' || model.type === 'combined' ? transferData(model) : planeData(model);
            data.id = modelId;
            for (const object of everything) object.visible = false;
            setWord(labels.burn, data.family === 'plane' ? (data.polar ? model.next_pole : model.next_node) || '' : '');
            // A new kind of maneuver starts from its overview. Moving a slider keeps the current
            // step framed, unless the reader has moved the view.
            if (model.type !== lastType) {
                const first = !lastType;
                lastType = model.type;
                layer.remeasure();
                setFocus('start', first);
            } else {
                refit();
            }
            phase = phaseAt(model, time);
            dirty = true;
        }

        function setTime(t) {
            time = Math.max(0, Math.min(1, t));
            if (data) phase = phaseAt(data.model, time);
            dirty = true;
            return phase.key;
        }

        function setShown(config) {
            shown = { ...shown, ...config };
            dirty = true;
        }

        // Returns to the framing of the current step.
        function resetView() {
            if (!data) return;
            manual = false;
            flyTo(goalFor(focusKey), HOME_SECONDS);
        }

        /* Scene update ----------------------------------------------------- */
        const ORDER_OF = (key) => {
            const list = segments(data.model);
            const index = list.findIndex((s) => s.key === key);
            return index < 0 ? -1 : index;
        };

        // How bright a burn's arrows are, and how far its new velocity has grown.
        function burnState(name) {
            const now = ORDER_OF(phase.key), at = ORDER_OF(name);
            if (at < 0) return { level: 0, grow: 0, active: false };
            if (now < at) return { level: UPCOMING, grow: 1, active: false };
            if (now === at) return { level: 1, grow: smooth(phase.k), active: true };
            return { level: DONE, grow: 1, active: false };
        }

        function satelliteTransfer(d, out) {
            const p = phase;
            switch (p.key) {
                case 'coast1': return d.noTransfer
                    ? orbitPoint(d.R1, d.i1, 0, 360 * p.k - 60, out)
                    : orbitPoint(d.R1, d.i1, 0, -60 * (1 - p.k), out);
                case 'burn1': return out.copy(d.P1);
                case 'transfer': return d.transferAt(transferU(p.k, d.eSigned), out);
                case 'burn2': return out.copy(d.P2);
                case 'burn3': return out.copy(d.burns.burn3.P);
                default: return orbitPoint(d.R2, d.i2, 0, 180 + 90 * p.k, out);
            }
        }

        function satellitePlane(d, out) {
            const p = phase;
            const m = d.model;
            if (d.planesMatch) return orbitPoint(d.r, d.plane1.inc, d.plane1.raan, m.u_sc + 360 * p.k, out);
            if (p.key === 'coast1') return orbitPoint(d.r, d.plane1.inc, d.plane1.raan, m.u_sc + d.coast * p.k, out);
            if (p.key === 'burn') return out.copy(d.B);
            return orbitPoint(d.r, d.plane2.inc, d.plane2.raan, d.uBurn + 150 * p.k, out);
        }

        function updateBurnArrows(name, b, sz, colors) {
            const arrows = burnArrows[name];
            const s = b ? burnState(name) : { level: 0 };
            const level = shown.vectors ? s.level : 0;
            if (colors) {
                recolor(arrows.before, colors[0]);
                recolor(arrows.after, colors[1]);
            }
            if (!b) {
                placeArrow(arrows.before, 0, ORIGIN, X_AXIS, sz);
                placeArrow(arrows.after, 0, ORIGIN, X_AXIS, sz);
                placeArrow(arrows.dv, 0, ORIGIN, X_AXIS, sz);
                return s;
            }
            placeArrow(arrows.before, level, b.P, b.tipBefore, sz);
            if (b.collinear) {
                placeArrow(arrows.after, level, b.afterFrom, b.tipAfter, sz, 1, s.grow);
                placeArrow(arrows.dv, level, b.dvFrom, b.dvEnd, sz, 1.25, s.grow);
            } else {
                // The new velocity turns from the old one into the new plane as the burn happens.
                const tip = turnToward(b.before, b.after, s.grow, tmp.clone()).add(b.P);
                placeArrow(arrows.after, level, b.P, tip, sz);
                placeArrow(arrows.dv, s.grow > 0.02 ? level : 0, b.tipBefore, tip, sz, 1.25);
            }
            placeMarker(burnMarkers[name], s.active ? 1 : 0.75, b.P, 0.5 * sz);
            return s;
        }

        function updateTransfer(sz, key) {
            const d = data;
            drawTube(orbit1Tube, 1, 1, key('orbit1'), d.ring1, sz);
            placeBar(rBar1, 0.5, ORIGIN, d.Q1, 0.1 * sz);
            placeMarker(markerSat, 1, satelliteTransfer(d, satPoint), 0.55 * sz);
            if (d.combined) placeDisc(equatorDisc, 0.6, d.equatorRadius);
            if (d.noTransfer) return;

            const arrived = ORDER_OF(phase.key) >= ORDER_OF('burn2');
            drawTube(orbit2Tube, 1, arrived ? 1 : 0.75, key('orbit2'), d.ring2, sz);
            drawTube(transferTube, 1, 1, key('transfer'), d.transferHalf, sz);
            drawTube(transferRestTube, 1, 0.4, key('rest'), d.transferOther, sz);
            placeBar(rBar2, 0.5, ORIGIN, d.Q2, 0.1 * sz);
            placeBar(majorAxisBar, 0.35, d.P1, d.P2, 0.08 * sz);

            const incColor = (inc, fallback) => (inc === d.i2 && d.i1 !== d.i2 ? COLORS.orbit2 : fallback);
            updateBurnArrows('burn1', d.burns.burn1, sz, [incColor(d.incStart, COLORS.orbit1), COLORS.transfer]);
            updateBurnArrows('burn2', d.burns.burn2, sz, [COLORS.transfer, d.incEnd === d.i2 ? COLORS.orbit2 : COLORS.orbit1]);
            updateBurnArrows('burn3', d.burns.burn3 || null, sz, [COLORS.orbit1, COLORS.orbit2]);

            // The time of flight follows the spacecraft along the transfer.
            const now = ORDER_OF(phase.key), tx = ORDER_OF('transfer');
            const flown = now < tx ? 0 : now > tx ? 1 : d.transferLength(transferU(phase.k, d.eSigned) / 180);
            drawTube(tofArc, flown, shown.angles ? 0.9 : 0, key('tof'), d.transferHalf, sz, anchors.tof);

            if (d.thetaPath) {
                const s = burnState(d.turnBurn);
                drawTube(thetaArc, s.grow, shown.angles ? Math.max(0.45, s.level) : 0, key('theta'), d.thetaPath, sz, anchors.theta);
            }
        }

        function updatePlane(sz, key) {
            const d = data;
            placeDisc(equatorDisc, 0.6, d.equatorRadius);
            drawTube(orbit1Tube, 1, 1, key('orbit1'), d.ring1, sz);
            placeBar(rBarPlane, 0.5, ORIGIN, d.sat, 0.1 * sz);
            placeMarker(markerSat, 1, satellitePlane(d, satPoint), 0.55 * sz);
            if (d.planesMatch) return;

            const after = phase.key === 'coast2';
            drawTube(orbit2Tube, 1, after ? 1 : 0.75, key('orbit2'), d.ring2, sz);
            placeBar(nodeBar, 0.8, d.nodeFrom, d.nodeTo, 0.08 * sz);
            const s = updateBurnArrows('burn', d.burn, sz, [COLORS.orbit1, COLORS.orbit2]);

            const angleLevel = shown.angles ? Math.max(0.45, s.level) : 0;
            drawTube(thetaArc, s.grow, angleLevel, key('theta'), d.thetaPath, sz, anchors.theta);
            if (d.raanPath) drawTube(raanArc, 1, shown.angles ? 0.6 : 0, key('raan'), d.raanPath, sz, anchors.raan);

            // The coast to the burn ends at the spacecraft while it travels.
            const coastDrawn = phase.key === 'coast1' ? phase.k : 1;
            drawTube(coastArc, d.coast > 0.5 ? coastDrawn : 0, shown.angles ? 0.85 : 0, key('coast'), d.coastPath, sz, anchors.du);
        }

        function updateScene() {
            const d = data;
            const sz = (d.camFit * camView.zoom) / 100; // About 1/70 of the view's height at any zoom
            const zoomKey = Math.round(Math.log(sz) * 16);
            const key = (name) => `${d.id}|${zoomKey}|${name}`;

            placeArrow(axisI, 0.8, ORIGIN, d.iTip, sz, 0.85);
            placeArrow(axisJ, 0.8, ORIGIN, d.jTip, sz, 0.85);
            placeArrow(axisK, 0.8, ORIGIN, d.kTip, sz, 0.85);

            if (d.family === 'transfer') updateTransfer(sz, key);
            else updatePlane(sz, key);
        }

        /* Camera and labels ------------------------------------------------ */
        const lookTarget = new THREE.Vector3();

        function updateCamera() {
            const distance = (data.camFit * camView.zoom) / Math.min(1, viewW / viewH);
            const el = camView.el * D2R, az = camView.az * D2R;
            lookTarget.set(camView.x, camView.y, camView.z);
            camera.position.set(
                lookTarget.x + distance * Math.cos(el) * Math.cos(az),
                lookTarget.y + distance * Math.cos(el) * Math.sin(az),
                lookTarget.z + distance * Math.sin(el)
            );
            camera.lookAt(lookTarget);
            camera.updateMatrixWorld();
        }

        const projected = new THREE.Vector3();
        const tipScreen = new THREE.Vector3();
        const axisSpots = [];

        function project(label, point, level = 1) {
            projected.copy(point).project(camera);
            if (projected.z > 1) return;
            layer.show(label, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH, Math.max(0.55, level));
        }

        // Places an axis name just past the tip of its arrow, whichever way the view is turned.
        function showAxisName(label, tip, direction) {
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

        const midpoint = (a, b) => tmpA.lerpVectors(a, b, 0.5);

        function burnLabels(name, b, values) {
            if (!b || !shown.vectors) return;
            const s = burnState(name);
            if (s.level < DONE - 0.01) return;    // Upcoming burns stay unlabeled, to keep the view clear
            const set = labels.burns[name];
            const tip = b.collinear ? b.tipAfter : turnToward(b.before, b.after, s.grow, tmp.clone()).add(b.P);
            project(set.before, b.tipBefore, s.level);
            if (s.grow > 0.5) project(set.after, tip, s.level);
            setLabelValue(set.dv, kmsText(values.dv));
            if (s.grow > 0.3) project(set.dv, b.collinear ? midpoint(b.dvFrom, b.dvEnd) : midpoint(b.tipBefore, tip), s.level);
        }

        function transferLabels() {
            const d = data;
            const m = d.model;
            setLabelValue(labels.R1, kmText(m.R1));
            project(labels.R1, d.r1Anchor, 0.8);
            if (d.combined) {
                setLabelValue(labels.i1, degText(m.i1));
                project(labels.i1, d.i1Anchor);
            }
            if (d.noTransfer) return;
            setLabelValue(labels.R2, kmText(m.R2));
            project(labels.R2, d.r2Anchor, 0.8);
            if (d.combined) {
                setLabelValue(labels.i2, degText(m.i2));
                project(labels.i2, d.i2Anchor);
            }
            setLabelValue(labels.atx, kmText(m.a_tx));
            project(labels.atx, d.aAnchor, 0.8);

            burnLabels('burn1', d.burns.burn1, { dv: m.dv1 });
            burnLabels('burn2', d.burns.burn2, { dv: m.dv2 });
            if (d.burns.burn3) {
                const burn3Dv = 2 * (m.isRaise ? m.v2 : m.v1) * Math.sin((m.delta_theta / 2) * D2R);
                burnLabels('burn3', d.burns.burn3, { dv: burn3Dv });
            }

            if (shown.angles) {
                if (d.thetaPath && burnState(d.turnBurn).grow > 0.6) {
                    setLabelValue(labels.dtheta, degText(m.delta_theta));
                    project(labels.dtheta, anchors.theta);
                }
                if (ORDER_OF(phase.key) > ORDER_OF('transfer')) {
                    setLabelValue(labels.tof, `${m.tof_min.toFixed(1)} min`);
                    project(labels.tof, anchors.tof, 0.9);
                }
            }
        }

        function planeLabels() {
            const d = data;
            const m = d.model;
            const [first, second] = d.polar ? [labels.raan1, labels.raan2] : [labels.i1, labels.i2];
            setLabelValue(first, degText(d.polar ? m.raan1 : m.i1));
            project(first, d.anchor1);
            setLabelValue(labels.r, kmText(m.r));
            project(labels.r, midpoint(ORIGIN, d.sat), 0.8);
            if (d.planesMatch) return;
            setLabelValue(second, degText(d.polar ? m.raan2 : m.i2));
            project(second, d.anchor2);
            project(labels.burn, d.B, 0.9);
            burnLabels('burn', d.burn, { dv: m.dv });
            if (shown.angles) {
                if (burnState('burn').grow > 0.6) {
                    setLabelValue(labels.dtheta, degText(m.delta_theta));
                    project(labels.dtheta, anchors.theta);
                }
                if (d.raanPath) {
                    setLabelValue(labels.draan, degText(m.delta_raan));
                    project(labels.draan, anchors.raan, 0.8);
                }
                if (d.coast > 0.5 && (phase.key !== 'coast1' || phase.k > 0.5)) {
                    setLabelValue(labels.du, `${Math.round(d.coast)}°`);
                    project(labels.du, anchors.du, 0.9);
                }
            }
        }

        function updateLabels() {
            const d = data;
            layer.begin();
            axisSpots.length = 0;
            showAxisName(labels.I, d.iTip, X_AXIS);
            showAxisName(labels.J, d.jTip, Y_AXIS);
            showAxisName(labels.K, d.kTip, Z_AXIS);
            if (shown.labels) {
                if (d.family === 'transfer') transferLabels();
                else planeLabels();
            }
            layer.place(viewW, viewH);
        }

        function renderFrame() {
            if (!data) return;
            updateCamera();
            updateScene();
            stars.follow(camera);
            renderer.render(scene, camera);
            updateLabels();
        }

        /* Rotating and zooming --------------------------------------------- */
        const pointers = new Map();
        let pinchStart = 0, pinchZoom = 1;

        function clampZoom(z) {
            const offset = Math.hypot(camView.x, camView.y, camView.z);
            return Math.min(MAX_ZOOM, Math.max((MIN_CAMERA_DISTANCE + offset) / data.camFit, z));
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
            if (!last || !data) return;
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
            if (!data) return;
            event.preventDefault();
            flight = null;
            manual = true;
            camView.zoom = clampZoom(camView.zoom * Math.exp(event.deltaY * 0.0012));
            dirty = true;
        }, { passive: false });

        if (dom.reset) dom.reset.addEventListener('click', resetView);

        /* Start ------------------------------------------------------------ */
        function resize() {
            viewW = Math.max(1, view.clientWidth);
            viewH = Math.max(1, view.clientHeight);
            renderer.setSize(viewW, viewH, false);
            camera.aspect = viewW / viewH;
            camera.updateProjectionMatrix();
            layer.remeasure();
            refit();
            renderFrame();
        }

        Kit.observeSize(view, resize);

        Kit.startLoop((seconds) => {
            if (flight) {
                flight.clock += seconds;
                const k = smooth(Math.min(1, flight.clock / flight.seconds));
                for (const name of CAMERA_KEYS) camView[name] = flight.from[name] + (flight.to[name] - flight.from[name]) * k;
                if (k >= 1) flight = null;
                dirty = true;
            }
            if (layer.settling) dirty = true;
            if (dirty) {
                dirty = false;
                renderFrame();
            }
        });

        return { setModel, setTime, setShown, setFocus, resetView, resize };
    }

    global.ManeuverScene = { create, segments, phaseAt, planeBurn };
})(window);
