// Inertial Frame Orbital Elements Visualizer
// Classical Orbital Elements (COEs) in the Earth-Centered Inertial (ECI) frame:
// a (semi-major axis), e (eccentricity), i (inclination),
// Omega (RAAN), omega (argument of perigee), nu (true anomaly).
// All six measurements stay on screen with their live values. Selecting an element
// only emphasizes its measurement and shows its definition in the caption.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;

    const statusEl = $('status');
    function showStatus(text) {
        statusEl.style.display = 'flex';
        statusEl.textContent = text;
    }

    showStatus('Loading the 3D view...');
    let THREE;
    try {
        THREE = await import(THREE_URL);
    } catch (err) {
        showStatus('The 3D library could not be loaded. This tool needs an internet connection the first time it opens.');
        return;
    }

    /* ------------------------------------------------------------------ */
    /* Constants                                                          */
    /* ------------------------------------------------------------------ */
    const R_E = 6378.137;         // Earth equatorial radius (km). One scene unit is one Earth radius.
    const MU = 398600.4418;       // Earth gravitational parameter (km^3/s^2)
    const OMEGA_E = 7.292115e-5;  // Earth rotation rate (rad/s)
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const TWO_PI = 2 * Math.PI;

    // Every orbit plays in the same time, so that a low orbit is not a blur.
    const ORBIT_PLAY_SECONDS = 20;
    const SPEEDS = [
        { rate: 0.4, label: 'Slow' },
        { rate: 1.0, label: 'Normal' },
        { rate: 2.2, label: 'Fast' }
    ];

    const COLORS = {
        eci: '#60a5fa',
        a: '#e0b64f',
        e: '#34d399',
        i: '#38bdf8',
        raan: '#a3e635',
        argp: '#f472b6',
        nu: '#c4a1ff'
    };

    const PRESETS = {
        iss: {
            name: 'International Space Station',
            a: 6798, e: 0.001, i: 51.6, raan: 75, argp: 40, nu: 60,
            desc: 'A low, nearly circular orbit about 420 km above Earth.'
        },
        gps: {
            name: 'GPS satellite',
            a: 26560, e: 0.01, i: 55, raan: 135, argp: 0, nu: 90,
            desc: 'A nearly circular orbit with a period of about 12 hours.'
        },
        molniya: {
            name: 'Molniya orbit',
            a: 26600, e: 0.72, i: 63.4, raan: 60, argp: 270, nu: 180,
            desc: 'A long ellipse with its apogee high above the Northern Hemisphere.'
        },
        geo: {
            name: 'Geostationary orbit',
            a: 42164, e: 0.001, i: 0.2, raan: 0, argp: 0, nu: 0,
            desc: 'An orbit over the equator, once in the time Earth takes to rotate once.'
        },
        sso: {
            name: 'Sun-synchronous orbit',
            a: 7178, e: 0.002, i: 98.6, raan: 220, argp: 90, nu: 45,
            desc: 'A low, nearly polar orbit that is slightly retrograde.'
        }
    };

    const CAPTIONS = {
        a: ['Semi-major axis (a): the orbit’s size.', 'Half the orbit’s longest width, shown by the gold bar from the orbit’s center to apogee, its farthest point from Earth. It sets the orbit’s energy and period. Range: a > 6,378 km.'],
        e: ['Eccentricity (e): the orbit’s shape.', 'How stretched the orbit is, from 0 (a circle) toward 1. It equals the green bar, the distance from the orbit’s center to Earth’s center, divided by a. Range: 0 ≤ e < 1.'],
        i: ['Inclination (i): the orbit’s tilt.', 'The angle between the orbital plane (gold) and the equatorial plane (blue). Below 90° the satellite moves eastward (prograde), at 90° over the poles (polar), and above 90° westward (retrograde). Range: 0° ≤ i ≤ 180°.'],
        raan: ['Right Ascension of the Ascending Node (Ω, RAAN): the orbit’s twist.', 'The angle east along the equator from the vernal equinox (Î), a fixed direction in space, to the ascending node, where the satellite crosses the equator heading north. Range: 0° ≤ Ω < 360°.'],
        argp: ['Argument of perigee (ω): perigee’s location.', 'The angle in the orbital plane, in the direction of motion, from the ascending node to perigee, the orbit’s closest point to Earth. Range: 0° ≤ ω < 360°.'],
        nu: ['True anomaly (ν): the satellite’s location.', 'The angle in the direction of motion from perigee to the satellite. It is the only element that changes over time. Range: 0° ≤ ν < 360°.']
    };

    /* ------------------------------------------------------------------ */
    /* State                                                              */
    /* ------------------------------------------------------------------ */
    const state = {
        a: PRESETS.iss.a,
        e: PRESETS.iss.e,
        i: PRESETS.iss.i,
        raan: PRESETS.iss.raan,
        argp: PRESETS.iss.argp,
        nu: PRESETS.iss.nu,
        activePreset: 'iss',
        presetCaption: false,
        selected: null,
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        showLabels: true
    };

    // The camera frames the whole orbit (fit). Zoom multiplies that distance.
    const HOME_VIEW = { az: -50, el: 26 };
    const camView = { ...HOME_VIEW, zoom: 1 };
    const MIN_CAMERA_DISTANCE = 1.8;
    const MAX_ZOOM = 3;
    const FOV_DEG = 40;
    const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);

    function fitDistance() {
        const apogee = (state.a * (1 + state.e)) / R_E;
        return Math.max(2.6, apogee * 1.25) / TAN_HALF_FOV;
    }
    let camFit = fitDistance();

    /* ------------------------------------------------------------------ */
    /* Renderer and Scene                                                 */
    /* ------------------------------------------------------------------ */
    const view = $('view');
    const canvas = $('scene');
    const hud = $('hud');

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
        showStatus('This browser could not initialize WebGL. WebGL must be enabled to use this tool.');
        return;
    }
    renderer.setClearColor(0x060b14);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 500);
    camera.up.set(0, 0, 1); // Z points north

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(12, 6, 8);
    scene.add(sunLight);

    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const layer = new Kit.LabelLayer($('labels'), { wide: true });

    const X_AXIS = new THREE.Vector3(1, 0, 0);
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const Z_AXIS = new THREE.Vector3(0, 0, 1);
    const ORIGIN = new THREE.Vector3();

    // Geometry here changes after creation, so a stored bounding sphere would cull it wrongly.
    function addDynamic(obj) {
        obj.frustumCulled = false;
        scene.add(obj);
        return obj;
    }

    function pointGeometry(pointCount) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
        return geo;
    }

    function fanIndex(segments) {
        const index = [];
        for (let k = 1; k <= segments; k++) index.push(0, k, k + 1);
        return index;
    }

    function segmentLine(color, opacity) {
        return addDynamic(new THREE.Line(pointGeometry(2), new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    }

    function setSegment(line, a, b) {
        const pos = line.geometry.attributes.position;
        pos.setXYZ(0, a.x, a.y, a.z);
        pos.setXYZ(1, b.x, b.y, b.z);
        pos.needsUpdate = true;
    }

    function sphere(radius, color) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 16, 12),
            new THREE.MeshBasicMaterial({ color })
        );
        scene.add(mesh);
        return mesh;
    }

    /* ECI axes: the two reference directions of the lesson figure */
    const iAxis = new THREE.ArrowHelper(X_AXIS, ORIGIN, 2, COLORS.eci);
    const kAxis = new THREE.ArrowHelper(Z_AXIS, ORIGIN, 2, COLORS.eci);
    scene.add(iAxis, kAxis);

    /* Equatorial plane */
    const eqGroup = new THREE.Group();
    scene.add(eqGroup);
    const eqFill = new THREE.MeshBasicMaterial({ color: 0x3a82f7, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    eqGroup.add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), eqFill));
    {
        const pts = [];
        for (let j = 0; j <= 120; j++) {
            const ang = (j / 120) * TWO_PI;
            pts.push(new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0));
        }
        eqGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x3a82f7, transparent: true, opacity: 0.4 })
        ));
    }

    /* Orbital plane, drawn as a triangle fan from Earth's center */
    const ORBIT_PTS = 256;
    const orbDiskGeo = pointGeometry(ORBIT_PTS + 2);
    orbDiskGeo.setIndex(fanIndex(ORBIT_PTS));
    const orbFill = new THREE.MeshBasicMaterial({ color: COLORS.a, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
    addDynamic(new THREE.Mesh(orbDiskGeo, orbFill));

    /* Orbit, drawn as a thin tube because WebGL lines are only one pixel wide */
    const orbitCurve = new THREE.Curve();
    orbitCurve.arcLengthDivisions = ORBIT_PTS;
    const orbitShape = { P: X_AXIS.clone(), Q: Y_AXIS.clone(), p: 1, e: 0 };
    orbitCurve.getPoint = (t, target = new THREE.Vector3()) => {
        const th = t * TWO_PI;
        const r = orbitShape.p / (1 + orbitShape.e * Math.cos(th));
        return target.set(0, 0, 0)
            .addScaledVector(orbitShape.P, r * Math.cos(th))
            .addScaledVector(orbitShape.Q, r * Math.sin(th));
    };
    const orbitTube = addDynamic(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLORS.a })));

    /* Bars for a and for the center-to-Earth distance that gives e. Both are drawn over
       Earth, because on low orbits they lie almost entirely inside it. */
    function createBar(color) {
        const bar = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 1, 10),
            new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })
        );
        bar.renderOrder = 5;
        scene.add(bar);
        return bar;
    }
    const barA = createBar(COLORS.a);
    const barE = createBar(COLORS.e);
    const barDir = new THREE.Vector3();

    function placeBar(bar, from, to, radius) {
        barDir.subVectors(to, from);
        const len = barDir.length();
        bar.visible = len > 1e-3;
        if (!bar.visible) return;
        bar.position.copy(from).addScaledVector(barDir, 0.5);
        bar.quaternion.setFromUnitVectors(Y_AXIS, barDir.normalize());
        bar.scale.set(radius, len, radius);
    }

    /* Reference lines and markers */
    const nodeSpoke = segmentLine(COLORS.i, 0.8);
    const perigeeSpoke = segmentLine(COLORS.argp, 0.8);
    const rLine = segmentLine(0xffffff, 0.85);
    const rGuide = segmentLine(0x94a3b8, 0.45);
    const nodeMarker = sphere(0.07, COLORS.i);
    const perigeeMarker = sphere(0.07, COLORS.argp);
    const apogeeMarker = sphere(0.07, COLORS.a);
    const satMarker = sphere(0.1, 0xffffff);

    /* Angles: a band with an arrowhead, plus a dim copy that shows through Earth, so that
       no measurement is lost from view. A selected angle also fills with a wedge. */
    const ARC_RES = 64;
    function createArc(color) {
        const bandGeo = pointGeometry((ARC_RES + 1) * 2);
        const bandIndex = [];
        for (let k = 0; k < ARC_RES; k++) {
            const j = k * 2;
            bandIndex.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
        }
        bandGeo.setIndex(bandIndex);
        addDynamic(new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })));

        const ghost = addDynamic(new THREE.Mesh(bandGeo, new THREE.MeshBasicMaterial({
            color, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false
        })));
        ghost.renderOrder = 4;

        const wedgeGeo = pointGeometry(ARC_RES + 2);
        wedgeGeo.setIndex(fanIndex(ARC_RES));
        const wedge = addDynamic(new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false
        })));

        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 12), new THREE.MeshBasicMaterial({ color }));
        scene.add(tip);
        return { bandGeo, wedge, tip };
    }
    const arcRAAN = createArc(COLORS.raan);
    const arcInc = createArc(COLORS.i);
    const arcArgP = createArc(COLORS.argp);
    const arcNu = createArc(COLORS.nu);

    /* Labels. Measurements carry a live value and are never dropped. */
    function measureLabel(symbol, color) {
        const lbl = layer.add(`<b style="color:${color}">${symbol}</b><span class="val"></span>`, { rank: 0 });
        lbl.el.classList.add('measure');
        lbl.valEl = lbl.el.querySelector('.val');
        return lbl;
    }
    function wordLabel(html, options) {
        const lbl = layer.add(html, options);
        lbl.el.classList.add('word');
        return lbl;
    }

    const measureLabels = {
        a: measureLabel('a', COLORS.a),
        e: measureLabel('e', COLORS.e),
        i: measureLabel('i', COLORS.i),
        raan: measureLabel('Ω', COLORS.raan),
        argp: measureLabel('ω', COLORS.argp),
        nu: measureLabel('ν', COLORS.nu)
    };
    const labelI = wordLabel(`<b style="color:${COLORS.eci}">Î</b><span class="hint">Vernal equinox</span>`, { rank: 1 });
    const labelK = wordLabel(`<b style="color:${COLORS.eci}">K̂</b><span class="hint">North Pole</span>`, { rank: 1 });
    const labelSat = wordLabel('Satellite', { rank: 1 });
    const labelNode = wordLabel('Ascending node', { rank: 2 });
    const labelPerigee = wordLabel('Perigee', { rank: 2 });
    const labelApogee = wordLabel('Apogee', { rank: 3, optional: true });

    function setLabelValue(lbl, text) {
        if (lbl.valEl.textContent === text) return;
        // Measure the label again only when its width can have changed.
        if (lbl.valEl.textContent.length !== text.length) lbl.width = 0;
        lbl.valEl.textContent = text;
    }

    const anchors = {
        I: new THREE.Vector3(), K: new THREE.Vector3(),
        node: new THREE.Vector3(), perigee: new THREE.Vector3(), apogee: new THREE.Vector3(),
        sat: new THREE.Vector3(), orbitCenter: new THREE.Vector3(),
        a: new THREE.Vector3(), e: new THREE.Vector3(), i: new THREE.Vector3(),
        raan: new THREE.Vector3(), argp: new THREE.Vector3(), nu: new THREE.Vector3()
    };

    /* ------------------------------------------------------------------ */
    /* Orbital Mechanics                                                  */
    /* ------------------------------------------------------------------ */

    // Unit vectors in ECI: P toward perigee, Q in the plane 90 degrees ahead of P,
    // W along the angular momentum, and n toward the ascending node.
    function orbitBasis() {
        const O = state.raan * D2R, inc = state.i * D2R, w = state.argp * D2R;
        const cosO = Math.cos(O), sinO = Math.sin(O);
        const cosi = Math.cos(inc), sini = Math.sin(inc);
        const cosw = Math.cos(w), sinw = Math.sin(w);
        return {
            P: new THREE.Vector3(cosO * cosw - sinO * sinw * cosi, sinO * cosw + cosO * sinw * cosi, sinw * sini),
            Q: new THREE.Vector3(-cosO * sinw - sinO * cosw * cosi, -sinO * sinw + cosO * cosw * cosi, cosw * sini),
            W: new THREE.Vector3(sinO * sini, -cosO * sini, cosi),
            n: new THREE.Vector3(cosO, sinO, 0)
        };
    }

    // Solves Kepler's equation, M = E - e sin E, for the eccentric anomaly E.
    function solveKepler(M, e) {
        let E = e < 0.8 ? M : Math.PI;
        for (let iter = 0; iter < 12; iter++) {
            const delta = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= delta;
            if (Math.abs(delta) < 1e-9) break;
        }
        return E;
    }

    // Moves the true anomaly forward by a fraction of one orbit, equal in time. The satellite
    // therefore moves faster near perigee and slower near apogee.
    function advanceTrueAnomaly(nuDeg, e, orbitFraction) {
        const nu = nuDeg * D2R;
        const root = Math.sqrt(Math.max(0, 1 - e * e));
        const E0 = Math.atan2(root * Math.sin(nu), e + Math.cos(nu));
        const M = (((E0 - e * Math.sin(E0)) + orbitFraction * TWO_PI) % TWO_PI + TWO_PI) % TWO_PI;
        const E = solveKepler(M, e);
        const next = Math.atan2(root * Math.sin(E), Math.cos(E) - e) * R2D;
        return (next + 360) % 360;
    }

    function isEquatorial() { return state.i < 0.05 || state.i > 179.95; }
    function isCircular() { return state.e < 1e-4; }

    /* ------------------------------------------------------------------ */
    /* Scene Update                                                       */
    /* ------------------------------------------------------------------ */
    let geometryKey = '';
    let tubeKey = '';
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();

    function rebuildOrbitGeometry(P, Q, p, e) {
        orbitShape.P.copy(P);
        orbitShape.Q.copy(Q);
        orbitShape.p = p;
        orbitShape.e = e;

        const diskPos = orbDiskGeo.attributes.position;
        diskPos.setXYZ(0, 0, 0, 0);
        for (let k = 0; k <= ORBIT_PTS; k++) {
            orbitCurve.getPoint(k / ORBIT_PTS, tmpA);
            diskPos.setXYZ(k + 1, tmpA.x, tmpA.y, tmpA.z);
        }
        diskPos.needsUpdate = true;
    }

    function rebuildOrbitTube(radius) {
        orbitTube.geometry.dispose();
        orbitCurve.updateArcLengths();
        orbitTube.geometry = new THREE.TubeGeometry(orbitCurve, ORBIT_PTS, radius, 6, true);
    }

    // Draws an angle from direction u toward direction v (perpendicular unit vectors). At an
    // angle of zero, the arc has no length, but its label still marks where it starts.
    function drawArc(arc, anchor, center, u, v, radius, span, sizeScale, selected) {
        const band = arc.bandGeo.attributes.position;
        const fan = arc.wedge.geometry.attributes.position;
        const halfWidth = 0.011 * sizeScale;
        fan.setXYZ(0, center.x, center.y, center.z);
        for (let j = 0; j <= ARC_RES; j++) {
            const ang = (j / ARC_RES) * span;
            const c = Math.cos(ang), s = Math.sin(ang);
            tmpA.copy(center).addScaledVector(u, c * radius).addScaledVector(v, s * radius);
            fan.setXYZ(j + 1, tmpA.x, tmpA.y, tmpA.z);
            tmpB.copy(u).multiplyScalar(c).addScaledVector(v, s).multiplyScalar(halfWidth);
            band.setXYZ(j * 2, tmpA.x - tmpB.x, tmpA.y - tmpB.y, tmpA.z - tmpB.z);
            band.setXYZ(j * 2 + 1, tmpA.x + tmpB.x, tmpA.y + tmpB.y, tmpA.z + tmpB.z);
        }
        band.needsUpdate = true;
        fan.needsUpdate = true;
        arc.wedge.visible = selected;

        // Arrowhead at the end of the arc, pointing along the direction of measurement
        arc.tip.visible = span > 2 * D2R;
        arc.tip.position.copy(tmpA);
        tmpB.set(0, 0, 0).addScaledVector(u, -Math.sin(span)).addScaledVector(v, Math.cos(span)).normalize();
        arc.tip.quaternion.setFromUnitVectors(Y_AXIS, tmpB);
        arc.tip.scale.setScalar(sizeScale);

        anchor.copy(center)
            .addScaledVector(u, radius * Math.cos(span / 2))
            .addScaledVector(v, radius * Math.sin(span / 2));
    }

    function update3DScene() {
        const { a, e, nu, selected } = state;
        const { P, Q, W, n } = orbitBasis();
        const aScene = a / R_E;
        const p = aScene * (1 - e * e);
        const rp = aScene * (1 - e);
        const ra = aScene * (1 + e);
        const nuRad = nu * D2R;
        const r = p / (1 + e * Math.cos(nuRad));

        // Markers and arrowheads keep a steady size on screen at any zoom.
        const sizeScale = (camFit * camView.zoom) / 7;

        const key = [a, e, state.i, state.raan, state.argp].join();
        if (key !== geometryKey) {
            geometryKey = key;
            rebuildOrbitGeometry(P, Q, p, e);
        }
        const tubeRadius = 0.013 * sizeScale;
        const nextTubeKey = `${key}|${tubeRadius.toPrecision(2)}`;
        if (nextTubeKey !== tubeKey) {
            tubeKey = nextTubeKey;
            rebuildOrbitTube(tubeRadius);
        }

        // Reference sizes, in the proportions of the lesson figure
        const disk = Math.max(2.4, ra * 1.08);
        const raanRadius = Math.max(1.7, 0.7 * disk);
        const argpRadius = Math.max(1.5, 0.5 * disk);
        const nuRadius = Math.max(1.3, 0.41 * disk);

        eqGroup.scale.set(disk, disk, 1);
        eqFill.opacity = (selected === 'i' || selected === 'raan') ? 0.2 : 0.07;
        orbFill.opacity = (selected === 'i' || selected === 'argp' || selected === 'nu') ? 0.2 : 0.06;

        const iLen = disk * 1.09;
        const kLen = disk * 0.8;
        iAxis.setLength(iLen, 0.3 * sizeScale, 0.13 * sizeScale);
        kAxis.setLength(kLen, 0.3 * sizeScale, 0.13 * sizeScale);
        anchors.I.set(iLen, 0, 0);
        anchors.K.set(0, 0, kLen);

        // The ascending node lies where the orbit itself crosses the equator heading north.
        const rNode = p / (1 + e * Math.cos(state.argp * D2R));
        anchors.node.copy(n).multiplyScalar(rNode);
        nodeMarker.position.copy(anchors.node);
        nodeMarker.scale.setScalar(sizeScale);
        setSegment(nodeSpoke, ORIGIN, tmpA.copy(n).multiplyScalar(Math.max(rNode, raanRadius * 1.04)));

        // Perigee, apogee, and the bars along the major axis
        anchors.perigee.copy(P).multiplyScalar(rp);
        anchors.apogee.copy(P).multiplyScalar(-ra);
        anchors.orbitCenter.copy(P).multiplyScalar(-aScene * e);
        perigeeMarker.position.copy(anchors.perigee);
        apogeeMarker.position.copy(anchors.apogee);
        perigeeMarker.scale.setScalar(sizeScale);
        apogeeMarker.scale.setScalar(sizeScale);
        setSegment(perigeeSpoke, ORIGIN, tmpA.copy(P).multiplyScalar(Math.max(rp, argpRadius * 1.04, nuRadius * 1.04)));

        placeBar(barA, anchors.orbitCenter, anchors.apogee, (selected === 'a' ? 0.034 : 0.018) * sizeScale);
        placeBar(barE, anchors.orbitCenter, ORIGIN, (selected === 'e' ? 0.034 : 0.018) * sizeScale);
        anchors.a.copy(anchors.orbitCenter).addScaledVector(P, -aScene * 0.62);
        // Eccentricity describes the whole ellipse, so its label sits at the ellipse's widest point.
        anchors.e.copy(anchors.orbitCenter).addScaledVector(Q, -aScene * Math.sqrt(1 - e * e));

        // Satellite and position vector
        anchors.sat.set(0, 0, 0)
            .addScaledVector(P, r * Math.cos(nuRad))
            .addScaledVector(Q, r * Math.sin(nuRad));
        satMarker.position.copy(anchors.sat);
        satMarker.scale.setScalar(sizeScale);
        setSegment(rLine, ORIGIN, anchors.sat);
        rGuide.visible = nuRadius > r;
        if (rGuide.visible) setSegment(rGuide, anchors.sat, tmpA.copy(anchors.sat).setLength(nuRadius * 1.04));

        // Angles
        drawArc(arcRAAN, anchors.raan, ORIGIN, X_AXIS, Y_AXIS, raanRadius, state.raan * D2R, sizeScale, selected === 'raan');
        drawArc(arcInc, anchors.i, anchors.node, tmpInEast.set(-n.y, n.x, 0), Z_AXIS, Math.max(0.6, 0.22 * disk), state.i * D2R, sizeScale, selected === 'i');
        drawArc(arcArgP, anchors.argp, ORIGIN, n, tmpInPlane.crossVectors(W, n).normalize(), argpRadius, state.argp * D2R, sizeScale, selected === 'argp');
        drawArc(arcNu, anchors.nu, ORIGIN, P, Q, nuRadius, nuRad, sizeScale, selected === 'nu');
    }
    const tmpInEast = new THREE.Vector3();
    const tmpInPlane = new THREE.Vector3();

    /* ------------------------------------------------------------------ */
    /* Readouts                                                           */
    /* ------------------------------------------------------------------ */
    function formatNumber(num, decimals = 1) {
        return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }

    function formatPeriod(periodSec) {
        if (periodSec < 7200) return `${(periodSec / 60).toFixed(1)} min`;
        const totalMin = Math.round(periodSec / 60);
        return `${Math.floor(totalMin / 60)} h ${totalMin % 60} min`;
    }

    // Vector components use a true minus sign and no thousands separators, so that the
    // commas read only as separators between components.
    function formatVector(v, decimals) {
        return `[${[v.x, v.y, v.z].map((c) => c.toFixed(decimals).replace('-', '−')).join(', ')}]`;
    }

    function updatePanels() {
        const { a, e, nu } = state;
        const p = a * (1 - e * e);
        const hp = a * (1 - e) - R_E;
        const ha = a * (1 + e) - R_E;
        const nuRad = nu * D2R;
        const r = p / (1 + e * Math.cos(nuRad));
        const speed = Math.sqrt(MU * (2 / r - 1 / a));
        const period = TWO_PI * Math.sqrt(Math.pow(a, 3) / MU);

        const { P, Q, W } = orbitBasis();
        const rVec = new THREE.Vector3()
            .addScaledVector(P, r * Math.cos(nuRad))
            .addScaledVector(Q, r * Math.sin(nuRad));
        const vScale = Math.sqrt(MU / p);
        const vVec = new THREE.Vector3()
            .addScaledVector(P, -vScale * Math.sin(nuRad))
            .addScaledVector(Q, vScale * (e + Math.cos(nuRad)));

        // The north-south part of the angular momentum direction classifies the motion.
        let direction = 'Polar';
        if (W.z > 1e-6) direction = 'Prograde';
        else if (W.z < -1e-6) direction = 'Retrograde';

        $('val-direction').textContent = direction;
        $('val-period').textContent = formatPeriod(period);
        $('val-hp').textContent = `${formatNumber(hp, 0)} km`;
        $('val-ha').textContent = `${formatNumber(ha, 0)} km`;
        $('val-r').textContent = `${formatNumber(r, 0)} km`;
        $('val-v').textContent = `${formatNumber(speed, 2)} km/s`;
        $('val-r-vec').textContent = formatVector(rVec, 0);
        $('val-v-vec').textContent = formatVector(vVec, 2);

        updateCaption(hp);
    }

    // The caption changes only when the orbit or selection does, so that screen readers
    // are not flooded.
    let captionKey = '';
    function updateCaption(hp) {
        const sel = state.selected;
        const preset = PRESETS[state.activePreset];
        let title = 'Classical Orbital Elements (COEs).';
        let body = 'These six numbers describe an orbit and the satellite’s place on it. Select one to see what it measures.';
        if (sel) {
            [title, body] = CAPTIONS[sel];
        } else if (state.presetCaption && preset) {
            title = `${preset.name}.`;
            body = preset.desc;
        }

        const notes = [];
        if (hp < 0) notes.push('This orbit passes through Earth: its perigee is below the surface.');
        if (isEquatorial() && (sel === 'i' || sel === 'raan' || sel === 'argp')) {
            notes.push('At this inclination the orbit does not cross the equator, so the node shown is where it would lie.');
        }
        if (isCircular() && (sel === 'e' || sel === 'argp' || sel === 'nu')) {
            notes.push('A circle has no closest point, so the perigee shown is where it would lie.');
        }

        const key = [title, body, ...notes].join('|');
        if (key === captionKey) return;
        captionKey = key;

        hud.textContent = '';
        const titleEl = document.createElement('b');
        titleEl.textContent = title;
        hud.append(titleEl, document.createTextNode(` ${body}`));
        if (notes.length) {
            const noteEl = document.createElement('span');
            noteEl.className = 'hud-note';
            noteEl.textContent = ` ${notes.join(' ')}`;
            hud.append(noteEl);
        }
        hud.classList.toggle('warning', hp < 0);
    }

    /* ------------------------------------------------------------------ */
    /* Camera and Labels                                                  */
    /* ------------------------------------------------------------------ */
    let viewW = 1, viewH = 1;

    function updateCamera() {
        const d = (camFit * camView.zoom) / Math.min(1, viewW / viewH);
        const el = camView.el * D2R;
        const az = camView.az * D2R;
        camera.position.set(
            d * Math.cos(el) * Math.cos(az),
            d * Math.cos(el) * Math.sin(az),
            d * Math.sin(el)
        );
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
    }

    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();

    function isBlockedByEarth(pt) {
        toPoint.copy(pt).sub(camera.position);
        const dist = toPoint.length();
        toPoint.divideScalar(dist);
        const along = -camera.position.dot(toPoint);
        const offCenter = camera.position.lengthSq() - along * along;
        if (offCenter >= 1) return false;
        const entry = along - Math.sqrt(1 - offCenter);
        return entry > 0 && entry < dist;
    }

    function project(lbl, pt, opacity) {
        projected.copy(pt).project(camera);
        layer.show(lbl, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH, opacity);
    }

    // A measurement behind Earth keeps its label, slightly dimmed.
    function showMeasure(name) {
        project(measureLabels[name], anchors[name], isBlockedByEarth(anchors[name]) ? 0.85 : 1);
    }

    function showWord(lbl, pt) {
        if (!isBlockedByEarth(pt)) project(lbl, pt, 1);
    }

    function updateLabels() {
        layer.begin();
        if (state.showLabels) {
            setLabelValue(measureLabels.a, `${formatNumber(state.a, 0)} km`);
            setLabelValue(measureLabels.e, state.e.toFixed(3));
            setLabelValue(measureLabels.i, `${state.i.toFixed(1)}°`);
            setLabelValue(measureLabels.raan, `${state.raan.toFixed(0)}°`);
            setLabelValue(measureLabels.argp, `${state.argp.toFixed(0)}°`);
            setLabelValue(measureLabels.nu, `${state.nu.toFixed(0)}°`);
            Object.keys(measureLabels).forEach(showMeasure);

            showWord(labelSat, anchors.sat);
            showWord(labelI, anchors.I);
            showWord(labelK, anchors.K);
            showWord(labelNode, anchors.node);
            showWord(labelPerigee, anchors.perigee);
            showWord(labelApogee, anchors.apogee);
        }
        layer.place(viewW, viewH);
    }

    function renderFrame() {
        updateCamera();
        update3DScene();
        renderer.render(scene, camera);
        updateLabels();
    }

    /* ------------------------------------------------------------------ */
    /* Controls                                                           */
    /* ------------------------------------------------------------------ */
    let dirty = true;

    // wrap: angles measured around a full circle, where 360 is the same as 0.
    const PARAMS = {
        a: { min: 6500, max: 45000, decimals: 0 },
        e: { min: 0, max: 0.85, decimals: 3 },
        i: { min: 0, max: 180, decimals: 1 },
        raan: { min: 0, wrap: true, decimals: 1 },
        argp: { min: 0, wrap: true, decimals: 1 },
        nu: { min: 0, wrap: true, decimals: 1 }
    };

    function writeInputs(name) {
        $(`${name}-range`).value = state[name];
        $(`${name}-number`).value = state[name].toFixed(PARAMS[name].decimals);
    }

    function setParam(name, raw) {
        const spec = PARAMS[name];
        state[name] = spec.wrap
            ? ((raw % 360) + 360) % 360
            : Math.max(spec.min, Math.min(spec.max, raw));
        writeInputs(name);
        // True anomaly places the satellite on the orbit. It does not change the orbit itself.
        if (name === 'nu') {
            setPlaying(false);
        } else {
            state.activePreset = null;
            $('preset').value = '';
        }
        dirty = true;
    }

    // Selecting emphasizes one measurement. It never removes the others.
    function setSelected(name) {
        if (state.selected === name) return;
        state.selected = name;
        if (name) state.presetCaption = false;
        document.querySelectorAll('.param').forEach((row) => {
            row.classList.toggle('selected', row.dataset.param === name);
        });
        Object.keys(measureLabels).forEach((key) => {
            measureLabels[key].el.classList.toggle('active', key === name);
        });
        dirty = true;
    }

    Object.keys(PARAMS).forEach((name) => {
        const numberEl = $(`${name}-number`);
        $(`${name}-range`).addEventListener('input', (e) => setParam(name, parseFloat(e.target.value)));
        numberEl.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value);
            if (Number.isFinite(val)) setParam(name, val);
            else writeInputs(name);
        });
    });

    // Using any part of an element's row selects that element.
    document.querySelectorAll('.param').forEach((row) => {
        row.addEventListener('pointerdown', () => setSelected(row.dataset.param));
        row.addEventListener('focusin', () => setSelected(row.dataset.param));
    });

    function applyPreset(key) {
        const preset = PRESETS[key];
        if (!preset) return;
        Object.keys(PARAMS).forEach((name) => {
            state[name] = preset[name];
            writeInputs(name);
        });
        state.activePreset = key;
        $('preset').value = key;
        dirty = true;
    }

    $('preset').addEventListener('change', (e) => {
        applyPreset(e.target.value);
        setSelected(null);
        state.presetCaption = true;
        dirty = true;
    });

    function setPlaying(val) {
        state.playing = val;
        $('play').textContent = val ? 'Pause' : 'Play';
    }

    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('reset-view').addEventListener('click', () => {
        camView.az = HOME_VIEW.az;
        camView.el = HOME_VIEW.el;
        camView.zoom = 1;
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speed = parseInt(e.target.value, 10);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    $('show-labels').addEventListener('change', (e) => {
        state.showLabels = e.target.checked;
        dirty = true;
    });

    /* Rotating and zooming the view */
    const hint = $('view-hint');
    const pointers = new Map();
    let pinchStart = 0, pinchZoom = 1;
    const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_CAMERA_DISTANCE / camFit, z));

    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            pinchZoom = camView.zoom;
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
            const [p1, p2] = [...pointers.values()];
            camView.zoom = clampZoom((pinchZoom * pinchStart) / Math.hypot(p1.x - p2.x, p1.y - p2.y));
        }
        dirty = true;
    });

    const removePointer = (e) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', removePointer);
    canvas.addEventListener('pointercancel', removePointer);

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        camView.zoom = clampZoom(camView.zoom * Math.exp(e.deltaY * 0.0012));
        dirty = true;
    }, { passive: false });

    /* ------------------------------------------------------------------ */
    /* Start                                                              */
    /* ------------------------------------------------------------------ */
    applyPreset('iss');
    setPlaying(state.playing);
    $('speed-value').textContent = SPEEDS[state.speed].label;
    statusEl.style.display = 'none';

    Kit.observeSize(view, (w, h) => {
        viewW = w;
        viewH = h;
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        layer.remeasure();
        renderFrame();
    });
    updatePanels();

    Kit.startLoop((seconds) => {
        // The framing eases toward the current orbit, including while paused.
        const fit = fitDistance();
        if (Math.abs(fit - camFit) > 0.002) {
            camFit += (fit - camFit) * (1 - Math.exp(-seconds * 5));
            dirty = true;
        } else {
            camFit = fit;
        }

        if (state.playing) {
            const orbitFraction = (seconds * SPEEDS[state.speed].rate) / ORBIT_PLAY_SECONDS;
            state.nu = advanceTrueAnomaly(state.nu, state.e, orbitFraction);
            $('nu-range').value = state.nu;
            // Leave the field alone while it is being typed in.
            if (document.activeElement !== $('nu-number')) $('nu-number').value = state.nu.toFixed(1);

            // Earth turns by the true amount for the time the orbit represents.
            const period = TWO_PI * Math.sqrt(Math.pow(state.a, 3) / MU);
            earth.pivot.rotation.z += OMEGA_E * period * orbitFraction;
            dirty = true;
        }

        if (dirty) {
            dirty = false;
            renderFrame();
            updatePanels();
        }
    });
})();
