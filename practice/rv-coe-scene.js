// The 3D view for R-V vector problems. It starts with only Earth, the reference axes, and the
// given vectors. Each walkthrough step animates in what that step finds, moves the camera to
// frame it, and dims what came before. The orbit itself is drawn once its shape is known.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const { math } = global.PracticeMath;

    const STAGES = ['given', 'mag', 'a', 'h', 'i', 'n', 'raan', 'e', 'argp', 'nu'];
    const stageOrder = (name) => STAGES.indexOf(name);

    const CAMERA_SECONDS = 1.7;
    const RESET_SECONDS = 0.9;
    const BUILD_DELAY = 0.8;    // A new part starts this long after the camera starts moving
    const FADE_TIME = 0.3;      // Time constant for brightening and dimming, in seconds
    const UNDO_SECONDS = 0.4;   // Going back to an earlier step removes a part this quickly
    const DIMMED = 0.3;

    // A part appears at its `from` stage and takes `seconds` to build, starting after the part
    // named by `after` has finished. It is bright at its `focus` stages, `dimmed` at the others,
    // and gone after its `until` stage.
    const PARTS = {
        axisI: { from: 'given', focus: ['given', 'raan'], dimmed: 0.45 },
        axisJ: { from: 'given', focus: ['given'], dimmed: 0.45 },
        axisK: { from: 'given', focus: ['given', 'i', 'n'], dimmed: 0.45 },
        r: { from: 'given', focus: ['given', 'mag', 'h', 'nu'] },
        v: { from: 'given', focus: ['given', 'mag', 'h'] },
        rightAngle: { from: 'mag', until: 'mag', focus: ['mag'], seconds: 0.7 },
        majorAxis: { from: 'a', focus: ['a', 'e'], seconds: 1.7 },
        aBar: { from: 'a', until: 'a', focus: ['a'], seconds: 1.2, after: 'majorAxis' },
        apsides: { from: 'a', focus: ['a', 'e'], seconds: 0.4, after: 'majorAxis', dimmed: 0.6 },
        h: { from: 'h', focus: ['h', 'i', 'n'], seconds: 1.5 },
        plane: { from: 'h', until: 'raan', focus: ['h', 'i', 'n'], seconds: 1.6, after: 'h', dimmed: 0.5 },
        equator: { from: 'i', focus: ['i', 'raan'], seconds: 1.6, dimmed: 0.45 },
        arcI: { from: 'i', focus: ['i'], seconds: 1.6, after: 'equator' },
        n: { from: 'n', focus: ['n', 'raan', 'argp'], seconds: 1.4 },
        nodeLine: { from: 'n', until: 'n', focus: ['n'], seconds: 1.4 },
        northHalf: { from: 'n', until: 'n', focus: ['n'], seconds: 1.3, after: 'n' },
        arcRaan: { from: 'raan', focus: ['raan'], seconds: 1.9 },
        e: { from: 'e', focus: ['e', 'argp', 'nu'], seconds: 1.4 },
        orbit: { from: 'e', focus: ['e'], seconds: 4.2, after: 'e', dimmed: 0.6 },
        perigeeSpan: { from: 'e', until: 'e', focus: ['e'], seconds: 0.9, after: 'orbit' },
        arcArgp: { from: 'argp', focus: ['argp'], seconds: 2 },
        arcNu: { from: 'nu', focus: ['nu'], seconds: 2 }
    };

    const smooth = (t) => t * t * (3 - 2 * t);
    const nearestAngle = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

    // Some parts do not exist for some orbits. A circle has no perigee, for example.
    function partExists(name, S) {
        switch (name) {
            case 'majorAxis': case 'apsides': case 'e': case 'perigeeSpan': return !S.circular;
            case 'n': case 'nodeLine': case 'northHalf': return !S.equatorial;
            case 'arcI': return S.i > 0.5;
            case 'arcRaan': return !S.raanUndefined && S.raan > 0.5;
            case 'arcArgp': return !S.argpUndefined && S.argp > 0.5;
            case 'arcNu': return !S.nuUndefined && S.nu > 0.5;
            default: return true;
        }
    }

    function create(THREE, dom, constants) {
        const R_E = constants.R_EARTH;
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;
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
        const SHORTEST_ARROW = 1.6;     // n and e are drawn at least this long, to clear Earth

        const COLORS = {
            eci: '#60a5fa',
            orbit: '#e0b64f',
            r: '#f0f4fa',
            v: '#f87171',
            a: '#ff8a3d',
            e: '#34d399',
            i: '#38bdf8',
            raan: '#a3e635',
            argp: '#f472b6',
            nu: '#c4a1ff'
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
        const tmpB = new THREE.Vector3();
        const tmpC = new THREE.Vector3();

        const parts = Object.fromEntries(Object.keys(PARTS).map((name) => [name, { on: true, grow: 0, level: 0, goalGrow: 0, goalLevel: 0 }]));
        const partEntries = Object.entries(parts);

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
            scene.add(group);
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
            scene.add(marker);
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
            scene.add(bar);
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
                const angle = (j / 120) * TWO_PI;
                points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
            }
            group.add(disk, new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), rim));
            scene.add(group);
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

        function createArc(color, { arrowhead = true } = {}) {
            const tube = ghosted(new THREE.BufferGeometry(), color);
            Object.assign(tube.userData.solidMat, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
            const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
            const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
            glow.frustumCulled = false;
            const head = arrowhead ? ghosted(HEAD, color) : null;
            scene.add(tube, glow);
            if (head) scene.add(head);
            return { tube, glow, glowMat, head, key: '', curve: null };
        }

        // Draws an angle or a stretch of the orbit from its start, with a glow while it is in
        // focus. The tubes are rebuilt only when the path or the zoom changes.
        function drawArc(arc, part, key, pointAt, sz, anchor) {
            const k = smooth(part.grow);
            const shown = k > 0.002 && part.level > 0.01;
            arc.tube.visible = shown;
            arc.glow.visible = shown;
            if (arc.head) arc.head.visible = shown;
            if (!shown) return;

            if (arc.key !== key) {
                arc.key = key;
                arc.curve = new PathCurve(pointAt);
                setGeometry(arc.tube, new THREE.TubeGeometry(arc.curve, ARC_SEGMENTS, 0.3 * sz, ARC_SIDES, false));
                arc.glow.geometry.dispose();
                arc.glow.geometry = new THREE.TubeGeometry(arc.curve, ARC_SEGMENTS, 0.85 * sz, ARC_SIDES, false);
            }

            const count = 6 * ARC_SIDES * Math.ceil(ARC_SEGMENTS * k);
            arc.tube.userData.parts[0].geometry.setDrawRange(0, count);
            arc.glow.geometry.setDrawRange(0, count);
            setOpacity(arc.tube, part.level);
            arc.glowMat.opacity = 0.3 * Math.max(0, (part.level - DIMMED) / (1 - DIMMED));

            if (arc.head) {
                arc.curve.getPointAt(k, tmpEnd);
                arc.curve.getPointAt(Math.max(0, k - 0.012), tmpBefore);
                tmp.subVectors(tmpEnd, tmpBefore).normalize();
                const tipSize = 1.6 * sz;
                arc.head.position.copy(tmpEnd).addScaledVector(tmp, -0.8 * tipSize);
                arc.head.quaternion.setFromUnitVectors(Y_AXIS, tmp);
                arc.head.scale.setScalar(tipSize);
                setOpacity(arc.head, part.level);
            }
            if (anchor) arc.curve.getPointAt(0.5, anchor);
        }

        function fanGeometry(pointCount) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((pointCount + 2) * 3), 3));
            const index = [];
            for (let k = 1; k <= pointCount; k++) index.push(0, k, k + 1);
            geometry.setIndex(index);
            return geometry;
        }

        function createFan(geometry, color) {
            const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
            const mesh = new THREE.Mesh(geometry, fill);
            mesh.frustumCulled = false;
            mesh.renderOrder = ORDER.planes;
            scene.add(mesh);
            return { mesh, fill, geometry };
        }

        const axisI = createArrow(COLORS.eci);
        const axisJ = createArrow(COLORS.eci);
        const axisK = createArrow(COLORS.eci);

        const equatorDisc = createDisc(0x3a82f7, 0.15, 0.6);
        const planeDisc = createDisc(COLORS.orbit, 0.13, 0.5);
        const orbitFan = createFan(fanGeometry(ORBIT_SEGMENTS), COLORS.orbit);
        const northFan = createFan(fanGeometry(ARC_SEGMENTS), COLORS.raan);
        const orbitTube = ghosted(new THREE.BufferGeometry(), COLORS.orbit, 0.28);
        scene.add(orbitTube);

        const arrowR = createArrow(COLORS.r);
        const arrowV = createArrow(COLORS.v);
        const arrowH = createArrow(COLORS.i);
        const arrowN = createArrow(COLORS.raan);
        const arrowE = createArrow(COLORS.e);

        const barA = createBar(COLORS.a);
        const majorAxis = createBar(COLORS.a);
        const nodeLine = createBar(COLORS.raan);
        const rightMarkA = createBar(0xffffff);
        const rightMarkB = createBar(0xffffff);

        const markerSat = createMarker(0xffffff);
        const markerPerigee = createMarker(COLORS.argp);
        const markerApogee = createMarker(COLORS.a);
        const markerNode = createMarker(COLORS.raan);
        const markerCenter = createMarker(0x94a3b8);
        const markerPen = createMarker(COLORS.orbit);

        const arcI = createArc(COLORS.i);
        const arcRaan = createArc(COLORS.raan);
        const arcArgp = createArc(COLORS.argp);
        const arcNu = createArc(COLORS.nu);
        const perigeeSpan = createArc(COLORS.e, { arrowhead: false });

        /* Labels ----------------------------------------------------------- */
        function measureLabel(tex, color, rank) {
            const label = layer.add(`<span style="color:${color}">${math(tex)}</span><span class="val"></span>`, { rank });
            label.el.classList.add('measure');
            label.valEl = label.el.querySelector('.val');
            return label;
        }

        function wordLabel(text) {
            const label = layer.add(text, { rank: 3, optional: true });
            label.el.classList.add('word');
            return label;
        }

        function axisLabel(letter) {
            const label = layer.add(math(`\\mathbf{\\hat{${letter}}}`), { rank: 1 });
            label.el.classList.add('axis');
            label.center = true;
            return label;
        }

        const vectorTex = (letter) => `\\bar{\\mathbf{${letter}}}`;

        const labels = {
            I: axisLabel('I'),
            J: axisLabel('J'),
            K: axisLabel('K'),
            r: measureLabel(vectorTex('r'), COLORS.r, 0),
            v: measureLabel(vectorTex('v'), COLORS.v, 0),
            h: measureLabel(vectorTex('h'), COLORS.i, 0),
            n: measureLabel(vectorTex('n'), COLORS.raan, 0),
            e: measureLabel(vectorTex('e'), COLORS.e, 0),
            a: measureLabel('a', COLORS.a, 0),
            i: measureLabel('i', COLORS.i, 0),
            raan: measureLabel('\\Omega', COLORS.raan, 0),
            argp: measureLabel('\\omega', COLORS.argp, 0),
            nu: measureLabel('\\nu', COLORS.nu, 0),
            perigee: wordLabel('Perigee'),
            apogee: wordLabel('Apogee'),
            node: wordLabel('Ascending node')
        };

        function setLabelValue(label, text) {
            if (label.valEl.textContent === text) return;
            if (label.valEl.textContent.length !== text.length) label.width = 0;
            label.valEl.textContent = text;
        }

        /* Problem geometry ------------------------------------------------- */
        let data = null;
        let stage = 'given';
        let stageClock = 0;
        let dirty = true;
        let problemId = 0;
        let viewW = 1, viewH = 1;
        let flight = null;      // The camera move in progress
        let manual = false;     // True once the reader has turned or zoomed the view in this step
        const camView = { az: 25, el: 22, zoom: 1, x: 0, y: 0, z: 0 };
        const CAMERA_KEYS = Object.keys(camView);

        const toUnit = (v) => new THREE.Vector3(v[0], v[1], v[2]).normalize();
        const toScene = (v) => new THREE.Vector3(v[0] / R_E, v[1] / R_E, v[2] / R_E);

        function fromAngles(az, el) {
            const a = az * D2R, b = el * D2R;
            return new THREE.Vector3(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b));
        }

        // Looks at the orbital plane from well off to one side, so that it does not appear edge-on.
        function homeView(normal) {
            const base = fromAngles(35, 22);
            const toward = normal.clone();
            if (toward.dot(base) < 0) toward.negate();
            const direction = base.multiplyScalar(0.9).add(toward).normalize();
            return {
                az: Math.atan2(direction.y, direction.x) * R2D,
                el: Math.max(12, Math.min(62, Math.asin(direction.z) * R2D))
            };
        }

        function sampleOrbit(from, to, count) {
            const points = [];
            for (let k = 0; k <= count; k++) points.push(data.orbitPoint(from + ((to - from) * k) / count, new THREE.Vector3()));
            return points;
        }

        function setProblem(problem) {
            const S = problem.solution;
            const e = S.circular ? 0 : S.eMag;
            const r = toScene(S.r);
            const W = toUnit(S.h);
            const P = S.circular ? toUnit(S.r) : toUnit(S.eVec);
            const Q = new THREE.Vector3().crossVectors(W, P).normalize();
            const a = S.a / R_E;
            const p = a * (1 - e * e);
            const rp = a * (1 - e), ra = a * (1 + e);
            const reach = Math.max(ra, r.length());
            const axisBase = Math.max(2.1, reach * 1.25);
            const viewRadius = Math.max(2.6, axisBase * 1.14);
            const n = S.equatorial ? null : toUnit(S.n);
            const argp = S.argpUndefined ? 0 : S.argp * D2R;
            const thetaSat = Math.atan2(r.dot(Q), r.dot(P));
            const thetaNode = n ? Math.atan2(n.dot(Q), n.dot(P)) : 0;
            const rNode = n ? p / (1 + e * Math.cos(thetaNode)) : 0;
            const vDir = toUnit(S.v);
            const vLength = viewRadius * Math.max(0.24, Math.min(0.62, 0.42 * S.V / S.vCirc));
            const perigee = P.clone().multiplyScalar(rp);
            const apogee = P.clone().multiplyScalar(-ra);
            const atPerigee = S.apsis === 'perigee';

            problemId += 1;
            data = {
                S, e, r, W, P, Q, a, p, rp, ra, n, argp, reach, axisBase, vDir, perigee, apogee,
                rNode, thetaSat,
                id: problemId,
                rHat: r.clone().normalize(),
                center: P.clone().multiplyScalar(-a * e),
                near: atPerigee ? perigee : apogee,
                far: atPerigee ? apogee : perigee,
                barEnd: S.circular ? P.clone().multiplyScalar(-a) : apogee,
                vTip: r.clone().addScaledVector(vDir, vLength),
                iTip: new THREE.Vector3(axisBase * 1.08, 0, 0),
                jTip: new THREE.Vector3(0, axisBase * 1.08, 0),
                kTip: new THREE.Vector3(0, 0, axisBase * 0.9),
                hTip: W.clone().multiplyScalar(axisBase * 0.72),
                nTip: n ? n.clone().multiplyScalar(Math.max(rNode, SHORTEST_ARROW)) : new THREE.Vector3(),
                eTip: P.clone().multiplyScalar(Math.max(rp, SHORTEST_ARROW)),
                nodePoint: n ? n.clone().multiplyScalar(rNode) : new THREE.Vector3(),
                planeRadius: Math.max(1.7, reach * 1.1),
                equatorRadius: axisBase * 0.96,
                arcRadiusRaan: Math.max(rNode, 1.45),
                camFit: viewRadius / TAN_HALF_FOV,
                home: homeView(W),
                orbitPoint(theta, out) {
                    const dist = p / (1 + e * Math.cos(theta));
                    return out.copy(P).multiplyScalar(dist * Math.cos(theta)).addScaledVector(Q, dist * Math.sin(theta));
                }
            };
            data.aAnchor = data.center.clone().lerp(data.barEnd, 0.62);
            data.wholeOrbit = sampleOrbit(0, TWO_PI, 48);

            // The orbit is drawn starting from the satellite, in the direction of travel.
            data.orbitCurve = new PathCurve((t, out) => data.orbitPoint(thetaSat + t * TWO_PI, out));
            data.orbitCurve.updateArcLengths();
            const orbitFanPoints = orbitFan.geometry.attributes.position;
            orbitFanPoints.setXYZ(0, 0, 0, 0);
            for (let k = 0; k <= ORBIT_SEGMENTS; k++) {
                data.orbitCurve.getPointAt(k / ORBIT_SEGMENTS, tmp);
                orbitFanPoints.setXYZ(k + 1, tmp.x, tmp.y, tmp.z);
            }
            orbitFanPoints.needsUpdate = true;

            // The half of the orbital plane north of the equator
            if (n) {
                const north = new THREE.Vector3().crossVectors(W, n).normalize();
                const northPoints = northFan.geometry.attributes.position;
                northPoints.setXYZ(0, 0, 0, 0);
                for (let k = 0; k <= ARC_SEGMENTS; k++) {
                    const phi = (k / ARC_SEGMENTS) * Math.PI;
                    tmp.copy(n).multiplyScalar(Math.cos(phi)).addScaledVector(north, Math.sin(phi)).multiplyScalar(data.planeRadius);
                    northPoints.setXYZ(k + 1, tmp.x, tmp.y, tmp.z);
                }
                northPoints.needsUpdate = true;
            }

            planeDisc.group.quaternion.setFromUnitVectors(Z_AXIS, W);

            stage = 'given';
            stageClock = 0;
            manual = false;
            flight = null;
            for (const [name, part] of partEntries) {
                part.on = partExists(name, S);
                part.grow = PARTS[name].from === 'given' ? 1 : 0;
            }
            applyStage();
            for (const [, part] of partEntries) part.level = part.goalLevel;
            Object.assign(camView, stageGoal('given'));
            tubeKey = '';
            layer.remeasure();
            dirty = true;
        }

        /* Moving from step to step ----------------------------------------- */
        function applyStage() {
            const at = stageOrder(stage);
            for (const [name, part] of partEntries) {
                const spec = PARTS[name];
                const reached = part.on && at >= stageOrder(spec.from);
                const present = reached && (!spec.until || at <= stageOrder(spec.until));
                const resting = spec.dimmed === undefined ? DIMMED : spec.dimmed;
                part.goalGrow = reached ? 1 : 0;
                part.goalLevel = present ? (spec.focus.includes(stage) ? 1 : resting) : 0;
            }
        }

        function flyTo(goal, seconds) {
            const from = { ...camView };
            flight = { from, to: { ...goal, az: nearestAngle(from.az, goal.az) }, clock: 0, seconds };
            dirty = true;
        }

        function finishNow() {
            for (const [, part] of partEntries) {
                part.grow = part.goalGrow;
                part.level = part.goalLevel;
            }
            if (flight) Object.assign(camView, flight.to);
            flight = null;
            dirty = true;
        }

        function setStage(next) {
            stage = next;
            stageClock = 0;
            manual = false;
            if (!data) return;
            applyStage();
            flyTo(stageGoal(stage), CAMERA_SECONDS);
            if (Kit.prefersReducedMotion()) finishNow();
        }

        function canStartBuilding(spec) {
            if (stageClock < BUILD_DELAY) return false;
            if (!spec.after) return true;
            const prior = parts[spec.after];
            return !prior.on || prior.grow >= 1;
        }

        function advance(seconds) {
            if (!data) return;
            stageClock += seconds;
            for (const [name, part] of partEntries) {
                const spec = PARTS[name];
                if (part.grow !== part.goalGrow) {
                    if (part.goalGrow === 0) part.grow = Math.max(0, part.grow - seconds / UNDO_SECONDS);
                    else if (canStartBuilding(spec)) part.grow = Math.min(1, part.grow + seconds / spec.seconds);
                    dirty = true;
                }
                if (part.level !== part.goalLevel) {
                    part.level += (part.goalLevel - part.level) * (1 - Math.exp(-seconds / FADE_TIME));
                    if (Math.abs(part.level - part.goalLevel) < 0.004) part.level = part.goalLevel;
                    dirty = true;
                }
            }
            if (flight) {
                flight.clock += seconds;
                const k = smooth(Math.min(1, flight.clock / flight.seconds));
                for (const key of CAMERA_KEYS) camView[key] = flight.from[key] + (flight.to[key] - flight.from[key]) * k;
                if (flight.clock >= flight.seconds) flight = null;
                dirty = true;
            }
        }

        /* Where the camera goes at each step ------------------------------- */

        // The camera setting that looks along `direction` and fits these points and Earth.
        function fit(direction, points) {
            const az = Math.atan2(direction.y, direction.x) * R2D;
            const el = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.asin(Math.max(-1, Math.min(1, direction.z))) * R2D));
            const dir = fromAngles(az, el);
            const right = new THREE.Vector3().crossVectors(Z_AXIS, dir).normalize();
            const up = new THREE.Vector3().crossVectors(dir, right);
            const all = points.concat([
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

            const target = right.multiplyScalar(midX).addScaledVector(up, midY);
            const zoom = Math.min(MAX_ZOOM, (distance * Math.min(1, aspect)) / data.camFit);
            return { az, el, zoom, x: target.x, y: target.y, z: target.z };
        }

        function sideView() {
            const along = data.n || data.rHat;
            const across = new THREE.Vector3().crossVectors(Z_AXIS, along).normalize();
            return along.clone().addScaledVector(Z_AXIS, 0.2).addScaledVector(across, 0.14).normalize();
        }

        function stageGoal(name) {
            const d = data;
            const S = d.S;
            if (name === 'given') return { az: d.home.az, el: d.home.el, zoom: 1, x: 0, y: 0, z: 0 };

            const above = (d.W.z < 0 ? d.W.clone().negate() : d.W.clone()).addScaledVector(Z_AXIS, 0.24).normalize();
            const both = (u, size) => [u.clone().multiplyScalar(size), u.clone().multiplyScalar(-size)];
            const planeEdges = [...both(d.P, d.planeRadius), ...both(d.Q, d.planeRadius)];
            const equatorEdges = [...both(X_AXIS, d.equatorRadius), ...both(Y_AXIS, d.equatorRadius)];
            const tiltView = () => fit(sideView(), [d.kTip, d.hTip, ...planeEdges, ...equatorEdges]);

            switch (name) {
                case 'mag':
                    return fit(above, [d.r, d.vTip]);
                case 'a':
                    return fit(above, [d.near, d.far, d.barEnd, d.r, d.vTip]);
                case 'h': {
                    const corner = d.rHat.clone().add(d.vDir).addScaledVector(d.W, 0.75).normalize();
                    return fit(corner, [d.r, d.vTip, d.hTip, ...planeEdges]);
                }
                case 'i':
                    return tiltView();
                case 'n':
                    if (S.equatorial) return tiltView();
                    return fit(fromAngles(Math.atan2(d.n.y, d.n.x) * R2D - 50, 34), [d.kTip, d.hTip, ...planeEdges]);
                case 'raan': {
                    if (S.equatorial) return tiltView();
                    const swept = [];
                    for (let k = 0; k <= 12; k++) {
                        const angle = (k / 12) * S.raan * D2R;
                        swept.push(new THREE.Vector3(Math.cos(angle) * d.arcRadiusRaan, Math.sin(angle) * d.arcRadiusRaan, 0));
                    }
                    return fit(fromAngles(S.raan / 2, 64), [d.iTip, d.nTip, ...swept]);
                }
                case 'argp':
                    if (S.argpUndefined) return fit(above, d.wholeOrbit);
                    return fit(above, [...sampleOrbit(-d.argp, 0, 16), d.nTip, d.eTip]);
                case 'nu':
                    if (S.nuUndefined) return fit(above, d.wholeOrbit);
                    return fit(above, [...sampleOrbit(0, S.nu * D2R, 16), d.r, d.vTip, d.perigee]);
                default:
                    return fit(above, d.wholeOrbit);
            }
        }

        /* Scene update ----------------------------------------------------- */
        const anchors = { i: new THREE.Vector3(), raan: new THREE.Vector3(), argp: new THREE.Vector3(), nu: new THREE.Vector3() };
        let tubeKey = '';

        function updateOrbit(sz, zoomKey) {
            const d = data;
            const part = parts.orbit;
            const k = smooth(part.grow);
            const shown = k > 0.001 && part.level > 0.01;
            orbitTube.visible = shown;
            orbitFan.mesh.visible = shown;
            markerPen.visible = false;
            if (!shown) return;

            const key = `${d.id}|${zoomKey}`;
            if (key !== tubeKey) {
                tubeKey = key;
                setGeometry(orbitTube, new THREE.TubeGeometry(d.orbitCurve, ORBIT_SEGMENTS, 0.2 * sz, ORBIT_SIDES, false));
            }
            const drawn = Math.ceil(ORBIT_SEGMENTS * k);
            orbitTube.userData.parts[0].geometry.setDrawRange(0, 6 * ORBIT_SIDES * drawn);
            setOpacity(orbitTube, part.level);
            orbitFan.geometry.setDrawRange(0, 3 * drawn);
            orbitFan.fill.opacity = 0.11 * part.level;
            if (k < 1) placeMarker(markerPen, 1, d.orbitCurve.getPointAt(k, tmp), 0.42 * sz);
        }

        function updateScene() {
            const d = data;
            const S = d.S;
            const sz = (d.camFit * camView.zoom) / 100; // About 1/70 of the view's height at any zoom
            const zoomKey = Math.round(Math.log(sz) * 16);
            const arcKey = (name) => `${d.id}|${zoomKey}|${name}`;

            updateOrbit(sz, zoomKey);

            // Reference axes and the given vectors
            placeArrow(axisI, parts.axisI, ORIGIN, d.iTip, sz, 0.85);
            placeArrow(axisJ, parts.axisJ, ORIGIN, d.jTip, sz, 0.85);
            placeArrow(axisK, parts.axisK, ORIGIN, d.kTip, sz, 0.85);
            placeArrow(arrowR, parts.r, ORIGIN, d.r, sz, 1.2);
            placeArrow(arrowV, parts.v, d.r, d.vTip, sz, 1.2);
            placeMarker(markerSat, 1, d.r, 0.55 * sz);

            // A square corner where the two vectors meet
            const markSize = 2.6 * sz;
            const markOpacity = parts.rightAngle.level * smooth(parts.rightAngle.grow);
            tmpA.copy(d.r).addScaledVector(d.rHat, -markSize);
            tmpB.copy(tmpA).addScaledVector(d.vDir, markSize);
            tmpC.copy(d.r).addScaledVector(d.vDir, markSize);
            placeBar(rightMarkA, markOpacity, tmpA, tmpB, 0.07 * sz);
            placeBar(rightMarkB, markOpacity, tmpB, tmpC, 0.07 * sz);

            // The longest width, drawn from the satellite through Earth, then the semi-major axis
            placeBar(majorAxis, parts.majorAxis.level, d.near, tmpA.lerpVectors(d.near, d.far, smooth(parts.majorAxis.grow)), 0.08 * sz);
            const barGrown = smooth(parts.aBar.grow);
            placeBar(barA, parts.aBar.level * (barGrown > 0 ? 1 : 0), d.center, tmpA.lerpVectors(d.center, d.barEnd, barGrown), 0.18 * sz);
            placeMarker(markerCenter, parts.aBar.level * barGrown, d.center, 0.3 * sz);
            const apsisOpacity = parts.apsides.level * smooth(parts.apsides.grow);
            placeMarker(markerPerigee, apsisOpacity, d.perigee, 0.46 * sz);
            placeMarker(markerApogee, apsisOpacity, d.apogee, 0.46 * sz);

            // The planes, the vectors that define them, and where they meet
            placeArrow(arrowH, parts.h, ORIGIN, d.hTip, sz, 1.2);
            placeDisc(planeDisc, parts.plane, d.planeRadius);
            placeDisc(equatorDisc, parts.equator, d.equatorRadius);

            placeArrow(arrowN, parts.n, ORIGIN, d.nTip, sz, 1.2);
            placeMarker(markerNode, parts.n.level * (parts.n.grow > 0.9 ? 1 : 0), d.nodePoint, 0.46 * sz);
            if (d.n) {
                const lineReach = d.planeRadius * smooth(parts.nodeLine.grow);
                tmpA.copy(d.n).multiplyScalar(-lineReach);
                tmpB.copy(d.n).multiplyScalar(lineReach);
                placeBar(nodeLine, parts.nodeLine.level, tmpA, tmpB, 0.09 * sz);
            } else {
                nodeLine.visible = false;
            }

            const northGrown = smooth(parts.northHalf.grow);
            northFan.mesh.visible = parts.northHalf.level > 0.01 && northGrown > 0.001;
            northFan.geometry.setDrawRange(0, 3 * Math.ceil(ARC_SEGMENTS * northGrown));
            northFan.fill.opacity = 0.26 * parts.northHalf.level;

            placeArrow(arrowE, parts.e, ORIGIN, d.eTip, sz, 1.2);

            // Angles and stretches of the orbit
            const radial = Math.max(1.5, d.reach * 0.62);
            const kToH = new THREE.Vector3().crossVectors(Z_AXIS, d.W);
            if (kToH.lengthSq() < 1e-10) kToH.copy(X_AXIS);
            kToH.normalize();
            const sideways = new THREE.Vector3().crossVectors(kToH, Z_AXIS).normalize();
            const iRad = S.i * D2R;
            drawArc(arcI, parts.arcI, arcKey('i'), (t, out) => out.copy(Z_AXIS).multiplyScalar(Math.cos(iRad * t) * radial)
                .addScaledVector(sideways, Math.sin(iRad * t) * radial), sz, anchors.i);

            const raanRad = S.raan * D2R;
            drawArc(arcRaan, parts.arcRaan, arcKey('raan'), (t, out) => out.set(Math.cos(raanRad * t) * d.arcRadiusRaan, Math.sin(raanRad * t) * d.arcRadiusRaan, 0), sz, anchors.raan);
            drawArc(arcArgp, parts.arcArgp, arcKey('argp'), (t, out) => d.orbitPoint(-d.argp * (1 - t), out), sz, anchors.argp);
            const nuRad = S.nu * D2R;
            drawArc(arcNu, parts.arcNu, arcKey('nu'), (t, out) => d.orbitPoint(nuRad * t, out), sz, anchors.nu);
            const span = 28 * D2R;
            drawArc(perigeeSpan, parts.perigeeSpan, arcKey('span'), (t, out) => d.orbitPoint((2 * t - 1) * span, out), sz, null);
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
            layer.show(label, x + dx * reach, y + dy * reach);
        }

        function updateLabels() {
            const d = data;
            const S = d.S;
            const answers = S.answers;
            const built = (name, level = 0.1) => parts[name].on && parts[name].grow > 0.7 && parts[name].level > level;
            layer.begin();

            showAxisName(labels.I, d.iTip, X_AXIS);
            showAxisName(labels.J, d.jTip, Y_AXIS);
            showAxisName(labels.K, d.kTip, Z_AXIS);

            const atMagnitudes = stage === 'mag';
            setLabelValue(labels.r, atMagnitudes ? `${Math.round(S.R).toLocaleString('en-US')} km` : '');
            setLabelValue(labels.v, atMagnitudes ? `${S.V.toFixed(3)} km/s` : '');
            project(labels.r, tmp.copy(d.r).multiplyScalar(Math.max(0.72, Math.min(0.92, 1 - 0.45 / d.r.length()))), parts.r.level);
            project(labels.v, d.vTip, parts.v.level);

            if (built('h')) project(labels.h, d.hTip, parts.h.level);
            if (built('n')) {
                project(labels.n, tmp.copy(d.nTip).multiplyScalar(0.72), parts.n.level);
                project(labels.node, d.nodePoint, parts.n.level);
            }
            if (built('e')) project(labels.e, tmp.copy(d.eTip).multiplyScalar(0.72), parts.e.level);
            if (built('apsides')) {
                project(labels.perigee, d.perigee, parts.apsides.level);
                project(labels.apogee, d.apogee, parts.apsides.level);
            }
            if (built('aBar', 0.5)) {
                setLabelValue(labels.a, answers.a.text);
                project(labels.a, d.aAnchor);
            }

            const angle = (partName, labelName) => {
                if (!built(partName, 0.6)) return;
                setLabelValue(labels[labelName], answers[labelName].text);
                project(labels[labelName], anchors[labelName]);
            };
            angle('arcI', 'i');
            angle('arcRaan', 'raan');
            angle('arcArgp', 'argp');
            angle('arcNu', 'nu');

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

        return { setProblem, setStage, resize };
    }

    global.RvCoeScene = { create };
})(window);
