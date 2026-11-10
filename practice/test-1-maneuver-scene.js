// The 3D view for orbital maneuver problems on the Test 1 Practice page. It is
// drawn the same way as the R-V view (rv-coe-scene.js). It starts with only Earth, the reference
// axes, and the given orbits. Each walkthrough step animates in what that step finds, moves the
// camera to frame it, and dims what came before. The satellite moves along with the steps: it
// coasts to each burn, flies the transfer, and leaves on the new orbit. Computed values are
// labeled only after the student's answers are graded.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const Motion = global.SatelliteMotion;
    const { math } = global.PracticeMath;

    const CAMERA_SECONDS = 1.7;
    const RESET_SECONDS = 0.9;
    const BUILD_DELAY = 0.8;    // A new part starts this long after the camera starts moving
    const FADE_TIME = 0.3;      // Time constant for brightening and dimming, in seconds
    const UNDO_SECONDS = 0.4;   // Going back to an earlier step removes a part this quickly
    const DIMMED = 0.3;
    const TRANSFER_SECONDS = 2.6;   // The satellite takes this long to fly the transfer
    const PLANE_LAP_SECONDS = 12;   // and this long to go once around a plane change's orbit

    const smooth = (t) => t * t * (3 - 2 * t);
    const nearestAngle = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

    // A part appears at its `from` stage and takes `seconds` to build, starting after the part
    // named by `after` has finished. It is bright at its `focus` stages, `dimmed` at the others,
    // and gone after its `until` stage.
    const AXIS_PARTS = {
        axisI: { from: 'given', focus: ['given', 'summary_table'], dimmed: 0.45 },
        axisJ: { from: 'given', focus: ['given', 'summary_table'], dimmed: 0.45 },
        axisK: { from: 'given', focus: ['given', 'summary_table'], dimmed: 0.45 }
    };

    // Hohmann transfers and combined plane changes
    function transferPlan(combined, highBurn) {
        const parts = {
            ...AXIS_PARTS,
            orbit1: { from: 'given', focus: ['given', 'burn1', 'summary_table'], dimmed: 0.55 },
            orbit2: { from: 'given', focus: ['given', 'burn2', 'summary_table'], dimmed: 0.55 },
            rBar1: { from: 'given', focus: ['given', 'atx'], dimmed: 0.25 },
            rBar2: { from: 'given', focus: ['given', 'atx'], dimmed: 0.25 },
            majorAxis: { from: 'atx', focus: ['atx'], seconds: 1.4, dimmed: 0.2 },
            transfer: { from: 'atx', focus: ['atx', 'tof', 'summary_table'], seconds: 2.6, after: 'majorAxis', dimmed: 0.6 },
            transferRest: { from: 'atx', focus: ['atx'], seconds: 1.4, after: 'transfer', dimmed: 0.45 },
            aBar: { from: 'atx', until: 'atx', focus: ['atx'], seconds: 1.0, after: 'transfer' },
            vel1: { from: 'burn1', focus: ['burn1'], seconds: 0.9, dimmed: 0.22 },
            dv1: { from: 'burn1', focus: ['burn1', 'dvtotal', 'summary_table'], seconds: 0.7, after: 'vel1', dimmed: 0.45 },
            vel2: { from: 'burn2', focus: ['burn2'], seconds: 0.9, dimmed: 0.22 },
            dv2: { from: 'burn2', focus: ['burn2', 'dvtotal', 'summary_table'], seconds: 0.7, after: 'vel2', dimmed: 0.45 },
            tofArc: { from: 'tof', focus: ['tof'], seconds: 2.4, dimmed: 0.3 }
        };
        if (combined) {
            parts.equator = { from: 'given', focus: ['given', highBurn], dimmed: 0.4 };
            parts.theta = { from: highBurn, until: highBurn, focus: [highBurn], seconds: 1.0, after: highBurn === 'burn1' ? 'vel1' : 'vel2' };
        }
        return { stages: ['given', 'atx', 'burn1', 'burn2', 'dvtotal', 'tof', 'summary_table'], parts };
    }

    // Simple plane changes: inclination, and RAAN of a polar orbit
    function planePlan() {
        return {
            stages: ['given', 'speed', 'angle', 'dv', 'location'],
            parts: {
                ...AXIS_PARTS,
                equator: { from: 'given', focus: ['given', 'angle'], dimmed: 0.4 },
                orbit1: { from: 'given', focus: ['given', 'speed', 'location'], dimmed: 0.55 },
                orbit2: { from: 'given', focus: ['given', 'angle', 'dv'], dimmed: 0.55 },
                rBar: { from: 'speed', focus: ['speed'], seconds: 0.8, dimmed: 0.25 },
                vSat: { from: 'speed', until: 'speed', focus: ['speed'], seconds: 0.8, after: 'rBar' },
                nodeAxis: { from: 'angle', focus: ['angle', 'location'], seconds: 1.2, dimmed: 0.35 },
                burnMark: { from: 'angle', focus: ['angle', 'dv', 'location'], seconds: 0.4, after: 'nodeAxis', dimmed: 0.6 },
                vel: { from: 'angle', focus: ['angle', 'dv'], seconds: 1.0, after: 'burnMark', dimmed: 0.3 },
                theta: { from: 'angle', focus: ['angle'], seconds: 1.0, after: 'vel', dimmed: 0.35 },
                dv: { from: 'dv', focus: ['dv'], seconds: 0.8, dimmed: 0.45 },
                coastArc: { from: 'location', focus: ['location'], seconds: 2.0 }
            }
        };
    }

    function create(THREE, dom, constants) {
        const R_E = constants.R_EARTH;
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const FOV_DEG = 40;
        const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);
        const MIN_CAMERA_DISTANCE = 1.8;
        const MAX_ZOOM = 3;
        const ORBIT_SEGMENTS = 256;
        const ORBIT_SIDES = 6;
        const ARC_SEGMENTS = 96;
        const ARC_SIDES = 8;
        const MAX_TILT = 74;            // Steepest camera angle a step uses, in degrees
        const FRAME_MARGIN = 1.18;      // Room left around what a step frames
        const EARTH_EDGE = 1.03;
        const TIP_CLEARANCE = 3.2;      // The camera stays this many tip distances from the center

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
            dom.showStatus('This browser could not initialize WebGL. The answers and walkthrough still work.');
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

        const earth = window.EarthScene.addEarth(THREE, renderer, scene);
        earth.atmosphere.renderOrder = 1;
        const stars = window.EarthScene.addStars(THREE, scene);
        const layer = new Kit.LabelLayer(dom.labels, { wide: true });

        const X_AXIS = new THREE.Vector3(1, 0, 0);
        const Y_AXIS = new THREE.Vector3(0, 1, 0);
        const Z_AXIS = new THREE.Vector3(0, 0, 1);
        const ORIGIN = new THREE.Vector3();
        const tmp = new THREE.Vector3();
        const tmpEnd = new THREE.Vector3();
        const tmpBefore = new THREE.Vector3();
        const tmpA = new THREE.Vector3();

        // Every object, so that a new problem can hide what the last one drew.
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

        // Grows from the tail as the part builds, and is drawn thicker while it is in focus.
        function placeArrow(arrow, part, from, to, sz, weight = 1) {
            tmp.subVectors(to, from).multiplyScalar(smooth(part.grow));
            const len = tmp.length();
            arrow.group.visible = part.level > 0.01 && len > 1e-4;
            if (!arrow.group.visible) return;
            const thick = weight * (0.85 + 0.35 * part.level);
            const headLen = Math.min(3.4 * sz * thick, len * 0.45);
            const shaftLen = len - headLen;
            arrow.group.position.copy(from);
            arrow.group.quaternion.setFromUnitVectors(Y_AXIS, tmp.normalize());
            arrow.shaft.scale.set(0.16 * sz * thick, shaftLen, 0.16 * sz * thick);
            arrow.shaft.position.y = shaftLen / 2;
            arrow.head.scale.setScalar(headLen / 1.6);
            arrow.head.position.y = shaftLen + headLen / 2;
            setOpacity(arrow.shaft, part.level);
            setOpacity(arrow.head, part.level);
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

        // A bar that grows from `from` toward `to` as its part builds.
        function growBar(bar, part, from, to, radius) {
            const k = smooth(part.grow);
            placeBar(bar, k > 0 ? part.level : 0, from, tmpA.lerpVectors(from, to, k), radius);
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

        // Spreads outward from the center as the part builds.
        function placeDisc(disc, part, radius) {
            const k = smooth(part.grow);
            disc.group.visible = part.level > 0.01 && k > 0.001;
            if (!disc.group.visible) return;
            disc.group.scale.setScalar(radius * k);
            disc.fill.opacity = disc.fillOpacity * part.level;
            disc.rim.opacity = disc.rimOpacity * part.level;
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

        // Draws the path from its start to the fraction k. The tubes are rebuilt only when the
        // path or the zoom changes.
        function drawTube(t, k, opacity, key, pointAt, sz, anchor) {
            const shown = k > 0.002 && opacity > 0.01;
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

        const rBar1 = createBar(COLORS.orbit1);
        const rBar2 = createBar(COLORS.orbit2);
        const rBarPlane = createBar(COLORS.radius);
        const majorAxisBar = createBar(COLORS.transfer);
        const aBar = createBar(COLORS.transfer);
        const nodeBar = createBar(COLORS.node);

        // Before and after each burn, and the change between them
        const arrowBefore1 = createArrow(COLORS.orbit1);
        const arrowAfter1 = createArrow(COLORS.transfer);
        const arrowDv1 = createArrow(COLORS.dv);
        const arrowBefore2 = createArrow(COLORS.transfer);
        const arrowAfter2 = createArrow(COLORS.orbit2);
        const arrowDv2 = createArrow(COLORS.dv);
        const arrowVSat = createArrow(COLORS.orbit1);

        const markerSat = createMarker(0xffffff);
        const markerCenter = createMarker(0x94a3b8);
        const markerPen = createMarker(COLORS.transfer);
        const markerBurn = createMarker(COLORS.node);

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
            atx: measureLabel('a_{tx}', COLORS.transfer, 0),
            before1: measureLabel('V_1', COLORS.orbit1, 1),
            after1: measureLabel('V_{tx_1}', COLORS.transfer, 1),
            before2: measureLabel('V_{tx_2}', COLORS.transfer, 1),
            after2: measureLabel('V_2', COLORS.orbit2, 1),
            dv1: measureLabel('\\Delta V_1', COLORS.dv, 0),
            dv2: measureLabel('\\Delta V_2', COLORS.dv, 0),
            dv: measureLabel('\\Delta V', COLORS.dv, 0),
            tof: measureLabel('TOF', COLORS.tof, 0),
            theta: measureLabel('\\theta', COLORS.theta, 0),
            dtheta: measureLabel('\\Delta \\theta', COLORS.theta, 0),
            r: measureLabel('r', COLORS.radius, 1),
            v: measureLabel('V', COLORS.orbit1, 0),
            du: measureLabel('\\Delta u', COLORS.tof, 1),
            burn: wordLabel()
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
        // A circular orbit's point and direction of travel, from its inclination, RAAN, and the
        // argument of latitude u, all in degrees.
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

        // Looks down on a plane from its north side, tilted a little toward -J.
        function aboveView(normal) {
            const up = normal.z < 0 ? normal.clone().negate() : normal.clone();
            return up.addScaledVector(Z_AXIS, 0.24).add(new THREE.Vector3(0, -0.35, 0)).normalize();
        }

        // The arc between two directions at a point, for the angle a burn turns the velocity.
        function turnArc(point, from, to, radius) {
            const u = from.clone().normalize();
            const w = to.clone().normalize();
            const n = w.clone().addScaledVector(u, -w.dot(u)).normalize();
            const angle = u.angleTo(w);
            return (t, out) => out.copy(point).addScaledVector(u, radius * Math.cos(angle * t)).addScaledVector(n, radius * Math.sin(angle * t));
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
                afterFrom,
                tipBefore,
                tipAfter: afterFrom.clone().add(after),
                dvFrom: tipBefore.clone().sub(offset),
                dvEnd: P.clone().sub(offset).add(after),
                before,
                after
            };
        }

        function transferData(source) {
            const combined = source.type === 'combined';
            const R1 = source.R1 / R_E, R2 = source.R2 / R_E;
            const i1 = combined ? source.i1 : 0, i2 = combined ? source.i2 : 0;
            const iTransfer = combined ? (source.isRaise ? source.i1 : source.i2) : 0;
            const highBurn = source.isRaise ? 'burn2' : 'burn1';
            const a = (R1 + R2) / 2, eSigned = (R2 - R1) / (R1 + R2), p = a * (1 - eSigned * eSigned);
            const transferAt = (u, out = new THREE.Vector3()) => orbitPoint(p / (1 + eSigned * Math.cos(u * D2R)), iTransfer, 0, u, out);

            // The satellite's path, timed in units of the transfer time. It goes once around the
            // first orbit to the first burn, flies the transfer, then stays on the second orbit.
            // Periods scale with the 3/2 power of the size, and the transfer is half its own period.
            const T1 = 2 * Math.pow(R1 / a, 1.5), T2 = 2 * Math.pow(R2 / a, 1.5);
            const e = Math.abs(eSigned), raise = eSigned > 0;
            const transferU = (t) => {
                const M = Math.PI * (raise ? t : 1 + t);
                return Motion.trueFromMean(M, e) * R2D - (raise ? 0 : 180);
            };
            const satAt = (tau, out) => {
                if (tau < T1) return orbitPoint(R1, i1, 0, (360 * tau) / T1 - 360, out);
                if (tau <= T1 + 1) return transferAt(transferU(tau - T1), out);
                return orbitPoint(R2, i2, 0, 180 + (360 * (tau - T1 - 1)) / T2, out);
            };

            // At each burn, the faster velocity is drawn half as long as the radius there, and the
            // slower one in proportion. The two burns are not drawn to the same scale.
            const velocities = (R, u, incBefore, vBefore, incAfter, vAfter) => {
                const scale = (0.5 * R) / Math.max(vBefore, vAfter);
                return [orbitTangent(incBefore, 0, u).multiplyScalar(vBefore * scale), orbitTangent(incAfter, 0, u).multiplyScalar(vAfter * scale)];
            };
            const P1 = orbitPoint(R1, i1, 0, 0), P2 = orbitPoint(R2, i2, 0, 180);
            const b1 = burnAt(P1, ...velocities(R1, 0, i1, source.v1, iTransfer, source.v_tx1));
            const b2 = burnAt(P2, ...velocities(R2, 180, iTransfer, source.v_tx2, i2, source.v2));
            const high = highBurn === 'burn1' ? b1 : b2;
            const center = P1.clone().add(P2).multiplyScalar(0.5);
            const Q1 = orbitPoint(R1, i1, 0, -60), Q2 = orbitPoint(R2, i2, 0, -120);

            const d = {
                family: 'transfer',
                plan: transferPlan(combined, highBurn),
                source, combined, highBurn, R1, R2, i1, i2, iTransfer, P1, P2, b1, b2, center, Q1, Q2,
                ...frame(Math.max(R1, R2), 0.55),
                ring1: ring(R1, i1, 0),
                ring2: ring(R2, i2, 0),
                T1, T2, transferU, satAt,
                motionRate: TRANSFER_SECONDS,
                transferHalf: (t, out) => transferAt(t * 180, out),
                transferOther: (t, out) => transferAt(180 + t * 180, out),
                thetaPath: combined ? turnArc(high.P, high.before, high.after, 0.42 * Math.min(high.before.length(), high.after.length())) : null,
                aAnchor: center.clone().lerp(P2, 0.55),
                r1Anchor: Q1.clone().multiplyScalar(0.6),
                r2Anchor: Q2.clone().multiplyScalar(0.6),
                i1Anchor: orbitPoint(R1, i1, 0, 90),
                i2Anchor: orbitPoint(R2, i2, 0, 90),
                rings: ringSample(R1, i1, 0).concat(ringSample(R2, i2, 0)),
                transferPoints: Array.from({ length: 13 }, (_, k) => transferAt(k * 15))
            };
            d.transferCurve = new PathCurve(d.transferHalf);
            const W = planeNormal(iTransfer, 0);
            d.above = aboveView(W);
            d.home = homeView(W, -70);
            return d;
        }

        function planeData(source) {
            const polar = source.type === 'polar_raan';
            const r = source.r / R_E;
            const plane1 = polar ? { inc: 90, raan: source.raan1 } : { inc: source.i1, raan: source.raan };
            const plane2 = polar ? { inc: 90, raan: source.raan2 } : { inc: source.i2, raan: source.raan };
            const uBurn = source.u_burn;
            const coast = polar ? source.delta_u_to_pole : source.delta_u_to_node;
            const vLength = 0.45 * r;
            const sat = orbitPoint(r, plane1.inc, plane1.raan, source.u_sc);
            const B = orbitPoint(r, plane1.inc, plane1.raan, uBurn);
            const T1 = orbitTangent(plane1.inc, plane1.raan, uBurn);
            const T2 = orbitTangent(plane2.inc, plane2.raan, uBurn);
            const V1tip = B.clone().addScaledVector(T1, vLength);
            const V2tip = B.clone().addScaledVector(T2, vLength);
            // The line where the planes cross: the line of nodes, or Earth's axis for polar orbits
            const along = polar ? Z_AXIS.clone() : new THREE.Vector3(Math.cos(plane1.raan * D2R), Math.sin(plane1.raan * D2R), 0);
            const W1 = planeNormal(plane1.inc, plane1.raan), W2 = planeNormal(plane2.inc, plane2.raan);
            const view = frame(r, 0.9);

            // At the burn, look along the line where the planes cross, so the two velocities show
            // at their true angle. Over a pole, look in from the side instead of down Earth's axis.
            const Bhat = B.clone().normalize();
            const burnDir = polar
                ? Bhat.clone().addScaledVector(T1.clone().add(T2).normalize(), 0.9).normalize()
                : Bhat.clone().addScaledVector(Z_AXIS, 0.35).addScaledVector(new THREE.Vector3().crossVectors(Z_AXIS, Bhat).normalize(), -0.25).normalize();

            // The satellite's path, timed in laps. It coasts on the first orbit to the burn, then
            // continues on the second.
            const tauBurn = coast / 360;
            const satAt = (tau, out) => (tau < tauBurn
                ? orbitPoint(r, plane1.inc, plane1.raan, source.u_sc + 360 * tau, out)
                : orbitPoint(r, plane2.inc, plane2.raan, source.u_sc + 360 * tau, out));

            const d = {
                family: 'plane',
                tauBurn, satAt,
                motionRate: PLANE_LAP_SECONDS,
                plan: planePlan(),
                source, polar, r, plane1, plane2, sat, B, V1tip, V2tip, coast, burnDir,
                ...view,
                ring1: ring(r, plane1.inc, plane1.raan),
                ring2: ring(r, plane2.inc, plane2.raan),
                vSatTip: sat.clone().addScaledVector(orbitTangent(plane1.inc, plane1.raan, source.u_sc), vLength),
                nodeFrom: along.clone().multiplyScalar(-r * 1.25),
                nodeTo: along.clone().multiplyScalar(r * 1.25),
                thetaPath: turnArc(B, T1, T2, 0.4 * vLength),
                coastPath: (t, out) => orbitPoint(r, plane1.inc, plane1.raan, source.u_sc + t * coast, out),
                anchor1: polar ? orbitPoint(r, plane1.inc, plane1.raan, 0) : orbitPoint(r, plane1.inc, plane1.raan, 90),
                anchor2: polar ? orbitPoint(r, plane2.inc, plane2.raan, 0) : orbitPoint(r, plane2.inc, plane2.raan, 90),
                ring1Points: ringSample(r, plane1.inc, plane1.raan),
                nearBurn: ringSample(r, plane1.inc, plane1.raan, uBurn - 25, uBurn + 25, 6).concat(ringSample(r, plane2.inc, plane2.raan, uBurn - 25, uBurn + 25, 6)),
                burnWord: polar ? source.next_pole : source.next_node
            };
            d.above = aboveView(W1);
            d.home = homeView(W1.clone().add(W2).normalize(), 35);
            return d;
        }

        /* Problem setup ---------------------------------------------------- */
        let data = null;
        let stages = ['given'];
        let spec = {};
        let parts = {};
        let partEntries = [];
        let stage = 'given';
        let stageClock = 0;
        let dirty = true;
        let problemId = 0;
        let viewW = 1, viewH = 1;
        let flight = null;      // The camera move in progress
        let manual = false;     // True once the reader has turned or zoomed the view in this step
        let answersShown = false;
        let motion = null;      // Where the satellite is, and where the current step moves it
        const satPoint = new THREE.Vector3();
        const camView = { az: 25, el: 22, zoom: 1, x: 0, y: 0, z: 0 };
        const CAMERA_KEYS = Object.keys(camView);
        const NONE = { on: false, grow: 0, level: 0 };
        const part = (name) => parts[name] || NONE;
        const stageOrder = (name) => stages.indexOf(name);
        const anchors = { theta: new THREE.Vector3(), tof: new THREE.Vector3(), du: new THREE.Vector3() };

        function partExists(name) {
            if (name === 'coastArc') return data.coast > 0.5;
            return true;
        }

        function setProblem(problem) {
            if (!problem || !problem.data) return;
            const source = problem.data;
            problemId += 1;
            data = source.type === 'hohmann' || source.type === 'combined' ? transferData(source) : planeData(source);
            data.id = problemId;
            stages = data.plan.stages;
            spec = data.plan.parts;
            parts = {};
            for (const name of Object.keys(spec)) {
                parts[name] = { on: partExists(name), grow: spec[name].from === 'given' ? 1 : 0, level: 0, goalGrow: 0, goalLevel: 0 };
            }
            partEntries = Object.entries(parts);
            for (const object of everything) object.visible = false;

            stage = 'given';
            stageClock = 0;
            manual = false;
            flight = null;
            answersShown = false;
            motion = Motion.create(data.motionRate);
            // A transfer starts a quarter turn before the first burn. A plane change starts where
            // the problem puts the satellite.
            motion.reset(data.family === 'transfer' ? 0.75 * data.T1 : 0);
            applyStage();
            planMotion();
            if (Kit.prefersReducedMotion()) motion.finish();
            for (const [, p] of partEntries) p.level = p.goalLevel;
            Object.assign(camView, stageGoal('given'));
            setWord(labels.burn, data.burnWord || '');
            layer.remeasure();
            dirty = true;
        }

        function setAnswersShown(shown) {
            answersShown = Boolean(shown);
            dirty = true;
        }

        /* Moving from step to step ----------------------------------------- */
        function applyStage() {
            const at = stageOrder(stage);
            for (const [name, p] of partEntries) {
                const s = spec[name];
                const reached = p.on && at >= stageOrder(s.from);
                const present = reached && (!s.until || at <= stageOrder(s.until));
                const resting = s.dimmed === undefined ? DIMMED : s.dimmed;
                p.goalGrow = reached ? 1 : 0;
                p.goalLevel = present ? (s.focus.includes(stage) ? 1 : resting) : 0;
            }
        }

        // Where the satellite goes at each step.
        function planMotion() {
            const d = data;
            const afterDelay = { wait: () => stageClock >= BUILD_DELAY };
            if (d.family === 'transfer') {
                const atBurn1 = d.T1, atBurn2 = d.T1 + 1;
                switch (stage) {
                    // Going around the first orbit, which has the first burn on it
                    case 'given': return motion.plan([{ to: atBurn1 }], [0, d.T1]);
                    case 'atx':
                    case 'burn1': return motion.plan([{ to: atBurn1 }]);
                    case 'burn2':
                    case 'dvtotal': return motion.plan([{ to: atBurn2 }]);
                    // Flies the transfer again, timed against the clock
                    case 'tof': return motion.plan([{ to: atBurn1 }, afterDelay, { to: atBurn2 }]);
                    default: return motion.plan([{ to: atBurn2 }], [atBurn2, atBurn2 + d.T2]);
                }
            }
            const burn = d.tauBurn;
            switch (stage) {
                case 'angle': return motion.plan([{ to: burn }]);
                // After the burn, the satellite leaves along the new orbit.
                case 'dv': return motion.plan([{ to: burn }, { wait: () => part('dv').grow >= 1 }, { to: burn + 25 / 360 }]);
                // Coasts from where the problem starts to the burn, then keeps going on the new orbit.
                case 'location': return motion.plan([{ to: 0 }, afterDelay, { to: burn }], [burn, burn + 1]);
                default: return motion.plan([{ to: 0 }]);
            }
        }

        function flyTo(goal, seconds) {
            const from = { ...camView };
            flight = { from, to: { ...goal, az: nearestAngle(from.az, goal.az) }, clock: 0, seconds };
            dirty = true;
        }

        function finishNow() {
            for (const [, p] of partEntries) {
                p.grow = p.goalGrow;
                p.level = p.goalLevel;
            }
            if (flight) Object.assign(camView, flight.to);
            flight = null;
            if (motion) motion.finish();
            dirty = true;
        }

        function setStage(next) {
            stage = stages.includes(next) ? next : 'given';
            stageClock = 0;
            manual = false;
            if (!data) return;
            applyStage();
            planMotion();
            flyTo(stageGoal(stage), CAMERA_SECONDS);
            if (Kit.prefersReducedMotion()) finishNow();
        }

        function canStartBuilding(s) {
            if (stageClock < BUILD_DELAY) return false;
            if (!s.after) return true;
            const prior = parts[s.after];
            return !prior || !prior.on || prior.grow >= 1;
        }

        function advance(seconds) {
            if (!data) return;
            stageClock += seconds;
            for (const [name, p] of partEntries) {
                const s = spec[name];
                if (p.grow !== p.goalGrow) {
                    if (p.goalGrow === 0) p.grow = Math.max(0, p.grow - seconds / UNDO_SECONDS);
                    else if (canStartBuilding(s)) p.grow = Math.min(1, p.grow + seconds / (s.seconds || 1));
                    dirty = true;
                }
                if (p.level !== p.goalLevel) {
                    p.level += (p.goalLevel - p.level) * (1 - Math.exp(-seconds / FADE_TIME));
                    if (Math.abs(p.level - p.goalLevel) < 0.004) p.level = p.goalLevel;
                    dirty = true;
                }
            }
            if (motion.advance(seconds, Kit.prefersReducedMotion())) dirty = true;
            if (flight) {
                flight.clock += seconds;
                const k = smooth(Math.min(1, flight.clock / flight.seconds));
                for (const key of CAMERA_KEYS) camView[key] = flight.from[key] + (flight.to[key] - flight.from[key]) * k;
                if (flight.clock >= flight.seconds) flight = null;
                dirty = true;
            }
        }

        /* Where the camera goes at each step ------------------------------- */

        // The camera setting that looks along `direction` and fits these points and Earth. With
        // `tight`, only the points are fitted, so the view centers on them.
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

        // A burn seen from above its plane, or, when it turns the velocity, along the line
        // where the planes cross, so the triangle of velocities shows at its true angle. The
        // burn is far from Earth's axis, so the K arrow cannot point into the camera.
        function burnGoal(b, R, incBefore, incAfter, u) {
            const near = ringSample(R, incBefore, 0, u - 12, u + 12, 4).concat(ringSample(R, incAfter, 0, u - 12, u + 12, 4));
            const points = [b.P, b.tipBefore, b.tipAfter, b.dvFrom, b.dvEnd, b.afterFrom, ...near];
            if (b.collinear) return fit(data.above, points, true, false);
            const outward = b.P.clone().normalize();
            return fit(outward.add(new THREE.Vector3(0, -0.3, 0.35)).normalize(), points, true, false);
        }

        function stageGoal(name) {
            const d = data;
            if (name === 'given' || name === 'summary_table') return { az: d.home.az, el: d.home.el, zoom: 1, x: 0, y: 0, z: 0 };

            if (d.family === 'transfer') {
                switch (name) {
                    case 'burn1': return burnGoal(d.b1, d.R1, d.i1, d.iTransfer, 0);
                    case 'burn2': return burnGoal(d.b2, d.R2, d.iTransfer, d.i2, 180);
                    case 'tof': return fit(d.above, [...d.transferPoints, d.P1, d.P2]);
                    default: return fit(d.above, [...d.rings, d.b1.tipAfter, d.b2.tipAfter]);
                }
            }

            switch (name) {
                case 'speed': return fit(d.above, [...d.ring1Points, d.sat, d.vSatTip]);
                case 'angle':
                case 'dv': return fit(d.burnDir, [d.B, d.V1tip, d.V2tip, ...d.nearBurn], true);
                default: return fit(d.above, [...d.ring1Points, d.sat, d.B]);
            }
        }

        /* Scene update ----------------------------------------------------- */
        // `drawn`, if given, is how much of the path to draw, in place of how far the part has built.
        function drawPart(t, name, key, pointAt, sz, anchor, opacityScale = 1, drawn = null) {
            const p = part(name);
            const k = !p.on ? 0 : (drawn === null ? smooth(p.grow) : drawn);
            drawTube(t, k, p.level * opacityScale, key, pointAt, sz, anchor);
        }

        function updateTransfer(sz, key) {
            const d = data;
            drawPart(orbit1Tube, 'orbit1', key('orbit1'), d.ring1, sz);
            drawPart(orbit2Tube, 'orbit2', key('orbit2'), d.ring2, sz);
            drawPart(transferTube, 'transfer', key('transfer'), d.transferHalf, sz);
            drawPart(transferRestTube, 'transferRest', key('rest'), d.transferOther, sz, null, 0.5);
            const k = smooth(part('transfer').grow);
            placeMarker(markerPen, k > 0 && k < 1 ? 1 : 0, transferTube.curve ? transferTube.curve.getPointAt(k, tmp) : d.P1, 0.42 * sz);

            growBar(rBar1, part('rBar1'), ORIGIN, d.Q1, 0.1 * sz);
            growBar(rBar2, part('rBar2'), ORIGIN, d.Q2, 0.1 * sz);
            growBar(majorAxisBar, part('majorAxis'), d.P1, d.P2, 0.08 * sz);
            const aGrown = smooth(part('aBar').grow);
            growBar(aBar, part('aBar'), d.center, d.P2, 0.18 * sz);
            placeMarker(markerCenter, part('aBar').level * aGrown, d.center, 0.3 * sz);

            const { b1, b2 } = d;
            placeArrow(arrowBefore1, part('vel1'), b1.P, b1.tipBefore, sz);
            placeArrow(arrowAfter1, part('vel1'), b1.afterFrom, b1.tipAfter, sz);
            placeArrow(arrowDv1, part('dv1'), b1.dvFrom, b1.dvEnd, sz, 1.25);
            placeArrow(arrowBefore2, part('vel2'), b2.P, b2.tipBefore, sz);
            placeArrow(arrowAfter2, part('vel2'), b2.afterFrom, b2.tipAfter, sz);
            placeArrow(arrowDv2, part('dv2'), b2.dvFrom, b2.dvEnd, sz, 1.25);

            if (d.thetaPath) drawPart(thetaArc, 'theta', key('theta'), d.thetaPath, sz, anchors.theta);
            // While the satellite flies the transfer against the clock, the arc ends at the satellite.
            let tofDrawn = null;
            if (stage === 'tof') {
                const t = Math.max(0, Math.min(1, motion.tau - d.T1));
                tofDrawn = Motion.lengthFraction(d.transferCurve, d.transferU(t) / 180);
            }
            drawPart(tofArc, 'tofArc', key('tof'), d.transferHalf, sz, anchors.tof, 1, tofDrawn);
            placeMarker(markerSat, 1, d.satAt(motion.tau, satPoint), 0.55 * sz);
        }

        function updatePlane(sz, key) {
            const d = data;
            drawPart(orbit1Tube, 'orbit1', key('orbit1'), d.ring1, sz);
            drawPart(orbit2Tube, 'orbit2', key('orbit2'), d.ring2, sz);
            placeMarker(markerSat, 1, d.satAt(motion.tau, satPoint), 0.55 * sz);

            growBar(rBarPlane, part('rBar'), ORIGIN, d.sat, 0.1 * sz);
            placeArrow(arrowVSat, part('vSat'), d.sat, d.vSatTip, sz, 1.1);
            growBar(nodeBar, part('nodeAxis'), d.nodeFrom, d.nodeTo, 0.08 * sz);
            placeMarker(markerBurn, part('burnMark').level * (part('burnMark').grow > 0.9 ? 1 : 0), d.B, 0.5 * sz);

            placeArrow(arrowBefore1, part('vel'), d.B, d.V1tip, sz);
            placeArrow(arrowAfter2, part('vel'), d.B, d.V2tip, sz);
            placeArrow(arrowDv1, part('dv'), d.V1tip, d.V2tip, sz, 1.25);
            drawPart(thetaArc, 'theta', key('theta'), d.thetaPath, sz, anchors.theta);
            // While the satellite coasts to the burn, the arc ends at the satellite.
            const coastDrawn = stage === 'location' && d.tauBurn > 0 ? Math.max(0, Math.min(1, motion.tau / d.tauBurn)) : null;
            drawPart(coastArc, 'coastArc', key('coast'), d.coastPath, sz, anchors.du, 1, coastDrawn);
        }

        function updateScene() {
            const d = data;
            const sz = (d.camFit * camView.zoom) / 100; // About 1/70 of the view's height at any zoom
            const zoomKey = Math.round(Math.log(sz) * 16);
            const key = (name) => `${d.id}|${zoomKey}|${name}`;

            placeArrow(axisI, part('axisI'), ORIGIN, d.iTip, sz, 0.85);
            placeArrow(axisJ, part('axisJ'), ORIGIN, d.jTip, sz, 0.85);
            placeArrow(axisK, part('axisK'), ORIGIN, d.kTip, sz, 0.85);
            placeDisc(equatorDisc, part('equator'), d.equatorRadius);

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

            // Two axes can line up on screen. The later name then moves beside the earlier one.
            for (const other of axisSpots) {
                const apartX = (spot.w + other.w) / 2 + 4, apartY = (spot.h + other.h) / 2 + 3;
                if (Math.abs(spot.x - other.x) < apartX && Math.abs(spot.y - other.y) < apartY) {
                    spot.x = other.x + (other.x < viewW / 2 ? apartX : -apartX);
                }
            }
            axisSpots.push(spot);
            layer.show(label, spot.x, spot.y);
        }

        const built = (name, level = 0.1) => part(name).on && part(name).grow > 0.7 && part(name).level > level;
        // A computed value is labeled only after the answers are graded.
        const answer = (text) => (answersShown ? text : '');
        const midpoint = (a, b) => tmpA.lerpVectors(a, b, 0.5);

        function transferLabels() {
            const d = data;
            const S = d.source;
            if (built('rBar1')) {
                setLabelValue(labels.R1, kmText(S.R1));
                project(labels.R1, d.r1Anchor, part('rBar1').level);
            }
            if (built('rBar2')) {
                setLabelValue(labels.R2, kmText(S.R2));
                project(labels.R2, d.r2Anchor, part('rBar2').level);
            }
            if (d.combined && ['given', d.highBurn, 'summary_table'].includes(stage)) {
                setLabelValue(labels.i1, degText(S.i1));
                setLabelValue(labels.i2, degText(S.i2));
                project(labels.i1, d.i1Anchor);
                project(labels.i2, d.i2Anchor);
            }
            if (built('aBar', 0.5)) {
                setLabelValue(labels.atx, answer(kmText(S.a_tx)));
                project(labels.atx, d.aAnchor);
            }
            const burnLabels = (b, velName, dvName, beforeLabel, afterLabel, dvLabel, value) => {
                if (built(velName, 0.5)) {
                    project(beforeLabel, b.tipBefore);
                    project(afterLabel, b.tipAfter);
                }
                if (built(dvName, 0.5)) {
                    setLabelValue(dvLabel, answer(kmsText(value)));
                    project(dvLabel, midpoint(b.dvFrom, b.dvEnd), part(dvName).level);
                }
            };
            burnLabels(d.b1, 'vel1', 'dv1', labels.before1, labels.after1, labels.dv1, S.dv1);
            burnLabels(d.b2, 'vel2', 'dv2', labels.before2, labels.after2, labels.dv2, S.dv2);
            if (built('theta', 0.6)) {
                setLabelValue(labels.theta, answer(degText(S.delta_theta)));
                project(labels.theta, anchors.theta);
            }
            if (built('tofArc', 0.6)) {
                setLabelValue(labels.tof, answer(`${S.tof_min.toFixed(1)} min`));
                project(labels.tof, anchors.tof);
            }
        }

        function planeLabels() {
            const d = data;
            const S = d.source;
            const [first, second] = d.polar ? [labels.raan1, labels.raan2] : [labels.i1, labels.i2];
            setLabelValue(first, degText(d.polar ? S.raan1 : S.i1));
            setLabelValue(second, degText(d.polar ? S.raan2 : S.i2));
            if (built('orbit1', 0.5)) project(first, d.anchor1);
            if (built('orbit2', 0.5)) project(second, d.anchor2);

            if (built('rBar', 0.5)) project(labels.r, midpoint(ORIGIN, d.sat));
            if (built('vSat', 0.5)) {
                setLabelValue(labels.v, answer(kmsText(S.v)));
                project(labels.v, d.vSatTip);
            }
            if (built('burnMark')) project(labels.burn, d.B, part('burnMark').level);
            if (built('vel', 0.5)) {
                project(labels.before1, d.V1tip);
                project(labels.after2, d.V2tip);
            }
            if (built('theta', 0.6)) {
                setLabelValue(labels.dtheta, answer(degText(S.delta_theta)));
                project(labels.dtheta, anchors.theta);
            }
            if (built('dv', 0.3)) {
                setLabelValue(labels.dv, answer(kmsText(S.dv)));
                project(labels.dv, midpoint(d.V1tip, d.V2tip), part('dv').level);
            }
            if (built('coastArc', 0.6)) project(labels.du, anchors.du);
        }

        function updateLabels() {
            const d = data;
            layer.begin();
            axisSpots.length = 0;
            showAxisName(labels.I, d.iTip, X_AXIS);
            showAxisName(labels.J, d.jTip, Y_AXIS);
            showAxisName(labels.K, d.kTip, Z_AXIS);
            if (d.family === 'transfer') transferLabels();
            else planeLabels();
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

        function takeOverCamera() {
            flight = null;
            manual = true;
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
            hint.style.display = 'none';
        });

        canvas.addEventListener('pointermove', (event) => {
            const last = pointers.get(event.pointerId);
            if (!last || !data) return;
            takeOverCamera();
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
            takeOverCamera();
            camView.zoom = clampZoom(camView.zoom * Math.exp(event.deltaY * 0.0012));
            dirty = true;
        }, { passive: false });

        // Returns to the framing of the current step.
        dom.reset.addEventListener('click', () => {
            if (!data) return;
            manual = false;
            flyTo(stageGoal(stage), RESET_SECONDS);
        });

        /* Start ------------------------------------------------------------ */
        function resize() {
            viewW = Math.max(1, view.clientWidth);
            viewH = Math.max(1, view.clientHeight);
            renderer.setSize(viewW, viewH, false);
            camera.aspect = viewW / viewH;
            camera.updateProjectionMatrix();
            layer.remeasure();
            if (data && !manual) {
                const goal = stageGoal(stage);
                if (flight) flight.to = { ...goal, az: nearestAngle(flight.from.az, goal.az) };
                else Object.assign(camView, goal);
            }
            renderFrame();
        }

        Kit.observeSize(view, resize);

        Kit.startLoop((seconds) => {
            advance(seconds);
            if (layer.settling) dirty = true;
            if (dirty) {
                dirty = false;
                renderFrame();
            }
        });

        return { setProblem, setStage, setAnswersShown, resize };
    }

    global.Test1ManeuverScene = { create };
})(window);
