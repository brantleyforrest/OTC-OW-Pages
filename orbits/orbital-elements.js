// Orbital Elements Visualizer
// Classical Orbital Elements (COEs) in the Earth-Centered Inertial (ECI) frame:
// a (semi-major axis), e (eccentricity), i (inclination),
// Omega (RAAN), omega (argument of perigee), nu (true anomaly).
// The view always shows Earth, the orbit, and the satellite. Selecting an element adds only
// the lines, angle, and labels that measure it, so that one idea is on screen at a time.
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

    const RING_KM = [20000, 40000, 60000, 80000, 120000]; // Distance rings
    const RING_POINTS = 128;
    const RING_SIDES = 6;
    const RING_OPACITY = 0.4;
    const A_ZOOM_SHARE = 0.6;  // While a is being changed, the view's size grows as a to this power
    const E_MAX = 0.85;        // Largest eccentricity offered

    const COLORS = {
        eci: '#60a5fa',
        orbit: '#e0b64f',
        a: '#ff8a3d',
        e: '#34d399',
        i: '#38bdf8',
        raan: '#a3e635',
        argp: '#f472b6',
        nu: '#c4a1ff'
    };

    // Draw order, lowest first. Solid objects are hidden by Earth. Their dim "ghost" copies are
    // drawn last, without depth testing, so that a part behind Earth is still faintly visible.
    const ORDER = { planes: 2, wedge: 3, ghost: 6 };

    const PRESETS = {
        generic: {
            name: 'Generic orbit',
            a: 20000, e: 0.5, i: 40, raan: 60, argp: 50, nu: 70,
            desc: 'A mid-sized, moderately elliptical orbit, large enough that each element is easy to see.'
        },
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

    const INTRO_BODY = 'These six numbers describe an orbit and the satellite’s place on it. Select one to see what it measures.';
    const CAPTIONS = {
        a: ['Semi-major axis (a): the orbit’s size.', 'Half the orbit’s longest width, shown by the orange bar from the orbit’s center to apogee, its farthest point from Earth. It sets the orbit’s energy and period. Range: a > 6,378 km.'],
        e: ['Eccentricity (e): the orbit’s shape.', 'How stretched the orbit is, from 0 (a circle) toward 1. It equals the green bar, the distance from the orbit’s center to Earth’s center, divided by a. Range: 0 ≤ e < 1.'],
        i: ['Inclination (i): the orbit’s tilt.', 'The angle from north (K̂) to the angular momentum vector (ĥ), which stands perpendicular to the orbital plane. It is also the tilt between the orbital plane (gold) and the equatorial plane (blue). Below 90° the satellite moves eastward (prograde), at 90° over the poles (polar), and above 90° westward (retrograde). Range: 0° ≤ i ≤ 180°.'],
        raan: ['Right Ascension of the Ascending Node (Ω, RAAN): the orbit’s twist.', 'The angle east along the equator from the vernal equinox (Î), a fixed direction in space, to the ascending node, where the satellite crosses the equator heading north. Range: 0° ≤ Ω < 360°.'],
        argp: ['Argument of perigee (ω): perigee’s location.', 'The angle in the orbital plane, in the direction of motion, from the ascending node to perigee, the orbit’s closest point to Earth. Range: 0° ≤ ω < 360°.'],
        nu: ['True anomaly (ν): the satellite’s location.', 'The angle in the direction of motion from perigee to the satellite. It is the only element that changes over time. Range: 0° ≤ ν < 360°.']
    };

    /* ------------------------------------------------------------------ */
    /* State                                                              */
    /* ------------------------------------------------------------------ */
    const state = {
        a: PRESETS.generic.a,
        e: PRESETS.generic.e,
        i: PRESETS.generic.i,
        raan: PRESETS.generic.raan,
        argp: PRESETS.generic.argp,
        nu: PRESETS.generic.nu,
        activePreset: 'generic',
        presetCaption: false,
        selected: null,        // The element described in the caption and drawn boldest
        mode: 'all',           // Which measurements are drawn: none, one, some, or all
        chosen: new Set(),     // The elements drawn in 'some' mode
        playing: false,
        speed: 1,
        showLabels: true,
        showFill: false,
        showValues: false
    };

    // The camera frames the whole orbit (fit). Zoom multiplies that distance.
    const HOME_VIEW = { az: 25, el: 22 };
    const camView = { ...HOME_VIEW, zoom: 1 };
    const MIN_CAMERA_DISTANCE = 1.8;
    const MAX_ZOOM = 3;
    const FOV_DEG = 40;
    const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);

    let changingA = false;     // Partial zoom while a is being changed

    // The framing depends on a, not e: it leaves room for the most elongated orbit, so that
    // changing e changes the orbit's shape and nothing else on screen. While a is being changed,
    // the view zooms only part of the way, so that the orbit visibly grows on screen as it
    // expands across the rings.
    function fitDistance() {
        const sizeKm = changingA ? PARAMS.a.max * Math.pow(state.a / PARAMS.a.max, A_ZOOM_SHARE) : state.a;
        const apogee = (sizeKm * (1 + E_MAX)) / R_E;
        return Math.max(2.6, apogee * 1.1) / TAN_HALF_FOV;
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
    renderer.setClearColor(0x03060c);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 500);
    camera.up.set(0, 0, 1); // Z points north

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(12, 6, 8);
    scene.add(sunLight);

    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    earth.atmosphere.renderOrder = 1;
    const stars = window.EarthScene.addStars(THREE, scene);
    const layer = new Kit.LabelLayer($('labels'), { wide: true });

    const X_AXIS = new THREE.Vector3(1, 0, 0);
    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const Z_AXIS = new THREE.Vector3(0, 0, 1);
    const ORIGIN = new THREE.Vector3();

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

    // A solid object plus a dim ghost of it. Earth hides the solid part, and the ghost still
    // shows where that part is. Both share one geometry, so a group can be moved, scaled, and
    // hidden as one object. Geometry here can change after creation, so nothing is culled.
    function ghosted(geometry, color, { ghost = 0.3, line = false, doubleSide = false } = {}) {
        const group = new THREE.Group();
        const side = doubleSide ? THREE.DoubleSide : THREE.FrontSide;
        const solidMat = line
            ? new THREE.LineBasicMaterial({ color, transparent: true })
            : new THREE.MeshBasicMaterial({ color, side, transparent: true });
        const ghostMat = line
            ? new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false })
            : new THREE.MeshBasicMaterial({ color, side, transparent: true, depthTest: false, depthWrite: false });
        const Kind = line ? THREE.Line : THREE.Mesh;
        const solid = new Kind(geometry, solidMat);
        const dim = new Kind(geometry, ghostMat);
        dim.renderOrder = ORDER.ghost;
        solid.frustumCulled = false;
        dim.frustumCulled = false;
        group.add(solid, dim);
        group.userData = { solidMat, ghostMat, ghost, parts: [solid, dim] };
        setOpacity(group, 1);
        scene.add(group);
        return group;
    }

    function setOpacity(group, k) {
        const { solidMat, ghostMat, ghost } = group.userData;
        solidMat.opacity = k;
        ghostMat.opacity = ghost * k;
    }

    function setGeometry(group, geometry) {
        group.userData.parts.forEach((part) => { part.geometry = geometry; });
    }

    function segmentLine(color, opacity, ghost = 0.3) {
        const line = ghosted(pointGeometry(2), color, { line: true, ghost });
        setOpacity(line, opacity);
        return line;
    }

    function setSegment(line, a, b) {
        const pos = line.userData.parts[0].geometry.attributes.position;
        pos.setXYZ(0, a.x, a.y, a.z);
        pos.setXYZ(1, b.x, b.y, b.z);
        pos.needsUpdate = true;
    }

    const SPHERE = new THREE.SphereGeometry(1, 16, 12);
    function marker(color) {
        return ghosted(SPHERE, color, { ghost: 0.4 });
    }

    /* ECI axes: the two reference directions of the lesson figure, drawn as slim shafts with
       arrowheads, and dim until an element uses them */
    const AXIS_CONE = new THREE.ConeGeometry(0.5, 1.6, 12);
    const AXIS_SHAFT = new THREE.CylinderGeometry(1, 1, 1, 8);
    function createAxis(dir, color = COLORS.eci) {
        const group = new THREE.Group();
        group.quaternion.setFromUnitVectors(Y_AXIS, dir);
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
        const shaft = new THREE.Mesh(AXIS_SHAFT, mat);
        const head = new THREE.Mesh(AXIS_CONE, mat);
        group.add(shaft, head);
        group.userData = { shaft, head, mat };
        scene.add(group);
        return group;
    }
    // Places the axis from the origin out to len, with a head that is headLen long.
    function setAxis(axis, len, sz) {
        const { shaft, head } = axis.userData;
        const headLen = 3 * sz;
        shaft.scale.set(0.15 * sz, len - headLen, 0.15 * sz);
        shaft.position.y = (len - headLen) / 2;
        head.scale.setScalar(1.5 * sz);
        head.position.y = len - headLen / 2;
    }
    function setAxisOpacity(axis, k) {
        axis.userData.mat.opacity = k;
    }
    const iAxis = createAxis(X_AXIS);
    const kAxis = createAxis(Z_AXIS);
    // The angular momentum vector h, perpendicular to the orbital plane. It is drawn only while
    // inclination is shown, because inclination is measured from K to h.
    const hAxis = createAxis(Z_AXIS, COLORS.orbit);

    /* Equatorial plane: a faint disk and its rim */
    const eqGroup = new THREE.Group();
    scene.add(eqGroup);
    const eqFill = new THREE.MeshBasicMaterial({ color: 0x3a82f7, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
    // The disk and rim hold the orbit's projection onto the equatorial plane (z dropped). They
    // are filled in by rebuildOrbitGeometry whenever the orbit changes.
    const ORBIT_PTS = 256;
    const eqDiskGeo = pointGeometry(ORBIT_PTS + 2);
    eqDiskGeo.setIndex(fanIndex(ORBIT_PTS));
    const eqDisk = new THREE.Mesh(eqDiskGeo, eqFill);
    eqDisk.frustumCulled = false;
    eqDisk.renderOrder = ORDER.planes;
    eqGroup.add(eqDisk);
    const eqRimMat = new THREE.LineBasicMaterial({ color: 0x3a82f7, transparent: true, opacity: 0.3 });
    const eqRimGeo = pointGeometry(ORBIT_PTS + 1);
    const eqRim = new THREE.Line(eqRimGeo, eqRimMat);
    eqRim.frustumCulled = false;
    eqGroup.add(eqRim);

    /* Orbital plane, drawn as a triangle fan from Earth's center */
    const orbDiskGeo = pointGeometry(ORBIT_PTS + 2);
    orbDiskGeo.setIndex(fanIndex(ORBIT_PTS));
    const orbFill = new THREE.MeshBasicMaterial({ color: COLORS.orbit, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false });
    const orbDisk = new THREE.Mesh(orbDiskGeo, orbFill);
    orbDisk.frustumCulled = false;
    orbDisk.renderOrder = ORDER.planes;
    scene.add(orbDisk);

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
    const orbitTube = ghosted(new THREE.BufferGeometry(), COLORS.orbit, { ghost: 0.28 });

    /* Bars for a and for the center-to-Earth distance that gives e */
    const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10);
    const barA = ghosted(CYLINDER, COLORS.a, { ghost: 0.35 });
    const barE = ghosted(CYLINDER, COLORS.e, { ghost: 0.35 });
    const barDir = new THREE.Vector3();

    function placeBar(bar, from, to, radius) {
        barDir.subVectors(to, from);
        const len = barDir.length();
        bar.visible = bar.visible && len > 1e-3;
        if (!bar.visible) return;
        bar.position.copy(from).addScaledVector(barDir, 0.5);
        bar.quaternion.setFromUnitVectors(Y_AXIS, barDir.normalize());
        bar.scale.set(radius, len, radius);
    }

    /* Reference lines and markers */
    const nodeSpoke = segmentLine(COLORS.i, 0.9);
    const perigeeSpoke = segmentLine(COLORS.argp, 0.9);
    const rLine = segmentLine(0xffffff, 0.9);
    const nodeMarker = marker(COLORS.i);
    const perigeeMarker = marker(COLORS.argp);
    const apogeeMarker = marker(COLORS.a);
    const centerMarker = marker(0x94a3b8);
    const satMarker = marker(0xffffff);

    /* Angles: a band that follows its path, with an arrowhead on the point it measures to, plus a
       faint wedge that fills the angle. */
    const ARC_RES = 96;
    const RING = 8; // Sides of the tube drawn along an arc
    const CONE = new THREE.ConeGeometry(0.5, 1.6, 12);
    function createArc(color) {
        // A thin tube along the path, as thick as the orbit line, so that on the orbit it
        // covers exactly its own stretch of the line.
        const bandGeo = pointGeometry((ARC_RES + 1) * RING);
        const bandIndex = [];
        for (let k = 0; k < ARC_RES; k++) {
            for (let m = 0; m < RING; m++) {
                const m2 = (m + 1) % RING;
                const v00 = k * RING + m, v01 = k * RING + m2, v10 = (k + 1) * RING + m, v11 = (k + 1) * RING + m2;
                bandIndex.push(v00, v01, v10, v01, v11, v10);
            }
        }
        bandGeo.setIndex(bandIndex);
        const band = ghosted(bandGeo, color, { ghost: 0.35, doubleSide: true });
        // Where the arc lies on the orbit line, the arc wins, and only along its own stretch.
        Object.assign(band.userData.solidMat, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

        const wedgeGeo = pointGeometry(ARC_RES + 2);
        wedgeGeo.setIndex(fanIndex(ARC_RES));
        const wedge = new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
        }));
        wedge.frustumCulled = false;
        wedge.renderOrder = ORDER.wedge;
        scene.add(wedge);

        const tip = ghosted(CONE, color, { ghost: 0.35 });
        return { bandGeo: band.userData.parts[0].geometry, band, wedge, tip };
    }
    // The orbit's longest width, from perigee to apogee
    const majorAxis = segmentLine(COLORS.a, 0.4);
    const arcRAAN = createArc(COLORS.raan);
    const arcInc = createArc(COLORS.i);
    const arcArgP = createArc(COLORS.argp);
    const arcNu = createArc(COLORS.nu);

    /* Labels. Only the selected element's measurement is labeled, with its live value. */
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
    const labelI = wordLabel(`<b>Î</b>`, { rank: 1 });
    labelI.el.classList.add('axis');
    const labelK = wordLabel(`<b>K̂</b>`, { rank: 1 });
    labelK.el.classList.add('axis');
    const labelH = wordLabel(`<b style="color:${COLORS.orbit}">ĥ</b>`, { rank: 1 });
    labelH.el.classList.add('axis');
    const labelSat = wordLabel('Satellite', { rank: 1 });
    const labelNode = wordLabel('Ascending node', { rank: 2 });
    const labelPerigee = wordLabel('Perigee', { rank: 2 });
    const labelApogee = wordLabel('Apogee', { rank: 3, optional: true });

    /* Rings at fixed distances from Earth's center, drawn in the equatorial plane whatever the
       orbit's tilt, so that the orbit's size reads against a fixed ruler. */
    const ringIndex = [];
    for (let k = 0; k < RING_POINTS; k++) {
        const next = (k + 1) % RING_POINTS;
        for (let s = 0; s < RING_SIDES; s++) {
            const t = (s + 1) % RING_SIDES;
            const v00 = k * RING_SIDES + s, v01 = k * RING_SIDES + t, v10 = next * RING_SIDES + s, v11 = next * RING_SIDES + t;
            ringIndex.push(v00, v10, v01, v01, v10, v11);
        }
    }
    const rings = RING_KM.map((distance) => {
        const geometry = pointGeometry(RING_POINTS * RING_SIDES);
        geometry.setIndex(ringIndex);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: 0x94a3b8, side: THREE.DoubleSide, transparent: true, opacity: RING_OPACITY, depthWrite: false
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = ORDER.planes;
        scene.add(mesh);
        return {
            mesh,
            radius: distance / R_E,
            fade: 0,
            anchor: new THREE.Vector3(0, -distance / R_E, 0),
            label: layer.add(`<span style="color:#cbd5e1">${distance.toLocaleString('en-US')} km</span>`, { rank: 4, optional: true })
        };
    });

    function writeRing(ring, width) {
        const pos = ring.mesh.geometry.attributes.position;
        for (let k = 0; k < RING_POINTS; k++) {
            const th = (k / RING_POINTS) * TWO_PI;
            for (let s = 0; s < RING_SIDES; s++) {
                const ang = (s / RING_SIDES) * TWO_PI;
                const dist = ring.radius + Math.cos(ang) * width;
                pos.setXYZ(k * RING_SIDES + s, dist * Math.cos(th), dist * Math.sin(th), Math.sin(ang) * width);
            }
        }
        pos.needsUpdate = true;
    }

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
        raan: new THREE.Vector3(), argp: new THREE.Vector3(), nu: new THREE.Vector3(),
        H: new THREE.Vector3()
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
    const tmpInEast = new THREE.Vector3();

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

        // The same points with the height dropped: the orbit's shadow on the equatorial plane
        const eqDiskPos = eqDiskGeo.attributes.position;
        const eqRimPos = eqRimGeo.attributes.position;
        eqDiskPos.setXYZ(0, 0, 0, 0);
        for (let k = 0; k <= ORBIT_PTS; k++) {
            orbitCurve.getPoint(k / ORBIT_PTS, tmpA);
            eqDiskPos.setXYZ(k + 1, tmpA.x, tmpA.y, 0);
            eqRimPos.setXYZ(k, tmpA.x, tmpA.y, 0);
        }
        eqDiskPos.needsUpdate = true;
        eqRimPos.needsUpdate = true;
    }

    function rebuildOrbitTube(radius) {
        orbitTube.userData.parts[0].geometry.dispose();
        orbitCurve.updateArcLengths();
        setGeometry(orbitTube, new THREE.TubeGeometry(orbitCurve, ORBIT_PTS, radius, 6, true));
    }

    // Draws an angle as a band along a path. pointAt(t, out) gives the path's point for t from
    // 0 to 1, and normal is the axis the angle turns about. The arrowhead sits on the last point,
    // pointing along the path, so it points at the spot the angle measures to. At an angle of
    // zero, the arc has no length, but its label still marks where it starts.
    const PATH = Array.from({ length: ARC_RES + 1 }, () => new THREE.Vector3());
    const tmpTan = new THREE.Vector3();
    const tmpSide = new THREE.Vector3();
    function drawArc(arc, anchor, pointAt, normal, span, sz, shown, bold) {
        arc.band.visible = shown;
        arc.wedge.visible = shown && state.showFill;
        arc.tip.visible = shown && span > 2 * D2R;
        if (!shown) return;

        const band = arc.bandGeo.attributes.position;
        const fan = arc.wedge.geometry.attributes.position;
        const radius = (bold ? 0.27 : 0.23) * sz;
        arc.wedge.material.opacity = bold ? 0.24 : 0.1;
        fan.setXYZ(0, 0, 0, 0);
        for (let j = 0; j <= ARC_RES; j++) pointAt(j / ARC_RES, PATH[j]);
        for (let j = 0; j <= ARC_RES; j++) {
            const pt = PATH[j];
            tmpTan.subVectors(PATH[Math.min(j + 1, ARC_RES)], PATH[Math.max(j - 1, 0)]);
            if (tmpTan.lengthSq() < 1e-12) tmpTan.copy(X_AXIS);
            tmpTan.normalize();
            tmpSide.crossVectors(normal, tmpTan).normalize();
            for (let m = 0; m < RING; m++) {
                const ang = (m / RING) * TWO_PI;
                const c = Math.cos(ang) * radius, sn = Math.sin(ang) * radius;
                band.setXYZ(j * RING + m,
                    pt.x + tmpSide.x * c + normal.x * sn,
                    pt.y + tmpSide.y * c + normal.y * sn,
                    pt.z + tmpSide.z * c + normal.z * sn);
            }
            fan.setXYZ(j + 1, pt.x, pt.y, pt.z);
        }
        band.needsUpdate = true;
        fan.needsUpdate = true;

        // The arrowhead's tip, not its middle, lands on the last point.
        const tipSize = sz * (bold ? 1.5 : 1.2);
        arc.tip.position.copy(PATH[ARC_RES]).addScaledVector(tmpTan, -0.8 * tipSize);
        arc.tip.quaternion.setFromUnitVectors(Y_AXIS, tmpTan);
        arc.tip.scale.setScalar(tipSize);

        anchor.copy(PATH[ARC_RES >> 1]);
    }

    const ELEMENTS = ['a', 'e', 'i', 'raan', 'argp', 'nu'];

    // The elements whose measurements are drawn, set by the Show elements control.
    function shownElements() {
        if (state.mode === 'none') return new Set();
        if (state.mode === 'all') return new Set(ELEMENTS);
        if (state.mode === 'some') return state.chosen;
        return state.selected ? new Set([state.selected]) : new Set();
    }

    // What the shown elements add to the base view of Earth, orbit, and satellite.
    function visibility(set) {
        const has = (name) => set.has(name);
        return {
            barA: has('a') || has('e'),
            barE: has('e'),
            majorAxis: has('a') || has('e'),
            center: has('a') || has('e'),
            perigee: has('a') || has('e') || has('argp') || has('nu'),
            apogee: has('a') || has('e'),
            node: has('raan') || has('argp'),
            perigeeSpoke: has('argp') || has('nu'),
            rLine: has('nu'),
            hVector: has('i')
        };
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
        const shown = shownElements();
        const show = visibility(shown);
        const has = (name) => shown.has(name);
        const bold = (name) => selected === name && shown.size > 1;

        // One unit is about 1/70 of the view's height at any zoom, so that markers, lines, and
        // arrowheads stay small and steady on screen.
        const sz = (camFit * camView.zoom) / 100;

        const key = [a, e, state.i, state.raan, state.argp].join();
        if (key !== geometryKey) {
            geometryKey = key;
            rebuildOrbitGeometry(P, Q, p, e);
        }
        const tubeRadius = 0.2 * sz;
        const nextTubeKey = `${key}|${tubeRadius.toPrecision(2)}`;
        if (nextTubeKey !== tubeKey) {
            tubeKey = nextTubeKey;
            rebuildOrbitTube(tubeRadius);
        }

        // The reference axes' length depends on a, not e.
        const axisBase = Math.max(2.1, aScene * 1.575);

        // Planes brighten only while an element measured between them is shown.
        // The equatorial plane shows the orbit's projection onto it at the current inclination
        // (built in rebuildOrbitGeometry). It narrows as the inclination grows and touches the
        // orbit at the nodes.
        const eqOn = has('i') || has('raan');
        eqFill.opacity = eqOn ? 0.14 : 0.05;
        eqRimMat.opacity = eqOn ? 0.6 : 0.3;
        orbFill.opacity = (has('i') || has('argp') || has('nu')) ? 0.09 : 0.035;

        // The two reference axes are always present but dim, and brighten when they matter.
        const iLen = axisBase * 1.08;
        const kLen = axisBase * 0.8;
        setAxis(iAxis, iLen, sz);
        setAxis(kAxis, kLen, sz);
        setAxisOpacity(iAxis, has('raan') ? 1 : 0.5);
        setAxisOpacity(kAxis, has('i') ? 1 : 0.5);
        anchors.I.set(iLen, 0, 0);
        anchors.K.set(0, 0, kLen);

        // The angular momentum vector, as long as K, pointing along W
        hAxis.visible = show.hVector;
        hAxis.quaternion.setFromUnitVectors(Y_AXIS, W);
        setAxis(hAxis, kLen, sz);
        setAxisOpacity(hAxis, 1);
        anchors.H.copy(W).multiplyScalar(kLen);

        // The ascending node lies where the orbit itself crosses the equator heading north.
        const rNode = p / (1 + e * Math.cos(state.argp * D2R));
        anchors.node.copy(n).multiplyScalar(rNode);
        nodeMarker.visible = show.node;
        nodeMarker.position.copy(anchors.node);
        nodeMarker.scale.setScalar(0.4 * sz);
        nodeSpoke.visible = show.node;
        setSegment(nodeSpoke, ORIGIN, tmpA.copy(n).multiplyScalar(rNode));

        // Perigee, apogee, orbit center, and the bars along the major axis
        anchors.perigee.copy(P).multiplyScalar(rp);
        anchors.apogee.copy(P).multiplyScalar(-ra);
        anchors.orbitCenter.copy(P).multiplyScalar(-aScene * e);
        perigeeMarker.visible = show.perigee;
        apogeeMarker.visible = show.apogee;
        centerMarker.visible = show.center;
        perigeeMarker.position.copy(anchors.perigee);
        apogeeMarker.position.copy(anchors.apogee);
        centerMarker.position.copy(anchors.orbitCenter);
        perigeeMarker.scale.setScalar(0.4 * sz);
        apogeeMarker.scale.setScalar(0.4 * sz);
        centerMarker.scale.setScalar(0.3 * sz);
        // The lines from Earth's center to perigee and to the satellite go with the angle fill.
        perigeeSpoke.visible = show.perigeeSpoke && state.showFill;
        setSegment(perigeeSpoke, ORIGIN, tmpA.copy(P).multiplyScalar(rp));
        // The thin line from perigee through Earth's center to apogee also goes with the fill.
        majorAxis.visible = show.majorAxis && state.showFill;
        setSegment(majorAxis, anchors.perigee, anchors.apogee);

        // When e is shown without a being selected, a stays quiet, so that the two bars compare.
        barA.visible = show.barA;
        barE.visible = show.barE;
        setOpacity(barA, selected === 'e' && has('e') ? 0.45 : 1);
        placeBar(barA, anchors.orbitCenter, anchors.apogee, (bold('a') ? 0.2 : 0.14) * sz);
        placeBar(barE, anchors.orbitCenter, ORIGIN, (bold('e') ? 0.36 : 0.26) * sz);
        anchors.a.copy(anchors.orbitCenter).addScaledVector(P, -aScene * 0.62);
        anchors.e.copy(anchors.orbitCenter).multiplyScalar(0.5);

        // Satellite, with the position vector as one side of the true anomaly
        anchors.sat.set(0, 0, 0)
            .addScaledVector(P, r * Math.cos(nuRad))
            .addScaledVector(Q, r * Math.sin(nuRad));
        satMarker.position.copy(anchors.sat);
        satMarker.scale.setScalar(0.55 * sz);
        rLine.visible = show.rLine && state.showFill;
        setSegment(rLine, ORIGIN, anchors.sat);

        // Inclination: measured at Earth's center, from K (north) to the angular momentum vector
        // h. The two lie in a plane whose normal is the line of nodes n, and the arc turns about n
        // from K toward h. It is drawn well inside the arrow tips so that both arrows stay clear.
        tmpInEast.set(-n.y, n.x, 0);
        const incRad = state.i * D2R;
        const incRadius = kLen * 0.6;

        // Angles
        // Each arc runs along the path it measures along, and ends on the point it measures to:
        // RAAN along the equator to the node, the argument of perigee along the orbit from the
        // node to perigee, and the true anomaly along the orbit from perigee to the satellite.
        const orbitPoint = (theta, out) => {
            const dist = p / (1 + e * Math.cos(theta));
            return out.copy(P).multiplyScalar(dist * Math.cos(theta)).addScaledVector(Q, dist * Math.sin(theta));
        };
        const raanRad = state.raan * D2R, argpRad = state.argp * D2R;
        drawArc(arcRAAN, anchors.raan, (t, out) => out.set(Math.cos(raanRad * t) * rNode, Math.sin(raanRad * t) * rNode, 0),
            Z_AXIS, raanRad, sz, has('raan'), bold('raan'));
        drawArc(arcInc, anchors.i, (t, out) => out.copy(Z_AXIS).multiplyScalar(Math.cos(incRad * t) * incRadius).addScaledVector(tmpInEast, -Math.sin(incRad * t) * incRadius),
            n, incRad, sz, has('i'), bold('i'));
        drawArc(arcArgP, anchors.argp, (t, out) => orbitPoint(-argpRad * (1 - t), out), W, argpRad, sz, has('argp'), bold('argp'));
        drawArc(arcNu, anchors.nu, (t, out) => orbitPoint(nuRad * t, out), W, nuRad, sz, has('nu'), bold('nu'));

        // Rings too small to read against the current scale fade out.
        const viewRadius = camFit * TAN_HALF_FOV;
        const ringWidth = 0.54 * (2 * camera.position.length() * TAN_HALF_FOV) / viewH;
        rings.forEach((ring) => {
            ring.fade = Math.min(1, Math.max(0, (ring.radius / viewRadius - 0.12) / 0.1));
            ring.mesh.visible = ring.fade > 0;
            if (ring.fade > 0) {
                ring.mesh.material.opacity = RING_OPACITY * ring.fade;
                writeRing(ring, ringWidth);
            }
        });

    }

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
        let body = INTRO_BODY;
        if (sel) {
            [title, body] = CAPTIONS[sel];
        } else if (state.presetCaption && preset) {
            title = `${preset.name}.`;
            body = `${preset.desc} Select an element to see what it measures.`;
        }

        const notes = [];
        if (hp < 0) notes.push('This orbit passes through Earth: its perigee is below the surface.');
        const shown = shownElements();
        if (isEquatorial() && (shown.has('i') || shown.has('raan') || shown.has('argp'))) {
            notes.push('At this inclination the orbit does not cross the equator, so the node shown is where it would lie.');
        }
        if (isCircular() && (shown.has('e') || shown.has('argp') || shown.has('nu'))) {
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

    // A label is either in front of Earth or behind it, never partly covered. It is covered over
    // Earth's whole disc when the point it names is on or past Earth's center plane, or inside
    // Earth. A point outside Earth that is nearer than that plane is always in front of Earth's
    // surface wherever it appears on the disc, so its label is never covered. (The graphics, by
    // contrast, always show through Earth as faint ghosts.) The eccentricity label is never
    // covered, because its bar lies mostly inside Earth.
    const earthOnScreen = { x: 0, y: 0, radius: 0 };

    function coverRadius(point) {
        const toward = point.dot(camera.position) / camera.position.length(); // Toward the camera
        return toward <= 0 || point.lengthSq() < 1 ? earthOnScreen.radius : 0;
    }

    function showMeasure(name) {
        const lbl = measureLabels[name];
        lbl.cover = name === 'e' ? 0 : coverRadius(anchors[name]);
        lbl.fixed = name !== 'e' && isBlockedByEarth(anchors[name]);
        project(lbl, anchors[name], 1);
    }

    // Places an axis name just past the tip of its arrow, in the direction the arrow points on
    // screen, whichever way the view is turned.
    const tipScreen = new THREE.Vector3();
    const tmpDirH = new THREE.Vector3();
    function showAxisName(lbl, tip, direction) {
        lbl.center = true;
        lbl.cover = coverRadius(tip);
        lbl.fixed = false;
        projected.copy(tip).project(camera);
        const x = (projected.x + 1) * 0.5 * viewW, y = (1 - projected.y) * 0.5 * viewH;
        tipScreen.copy(tip).addScaledVector(direction, 0.5).project(camera);
        let dx = (tipScreen.x + 1) * 0.5 * viewW - x, dy = (1 - tipScreen.y) * 0.5 * viewH - y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-3) { dx = 0; dy = -1; } else { dx /= length; dy /= length; }
        if (!lbl.width) { lbl.width = lbl.el.offsetWidth || 14; lbl.height = lbl.el.offsetHeight || 20; }
        // Far enough that the label's nearest edge, not its middle, is a few pixels past the tip.
        const reach = 6 + Math.abs(dx) * lbl.width / 2 + Math.abs(dy) * lbl.height / 2;
        layer.show(lbl, x + dx * reach, y + dy * reach, 1);
    }

    function showWord(lbl, pt) {
        lbl.cover = coverRadius(pt);
        lbl.fixed = isBlockedByEarth(pt);
        project(lbl, pt, 1);
    }

    // Clips a label to the part that Earth does not cover. The label layer calls this each time
    // it places a label, so the clip always matches the label's current position.
    function clipToEarth(lbl) {
        const r = lbl.cover || 0;
        const near = Math.hypot(lbl.x + lbl.width / 2 - earthOnScreen.x, lbl.y + lbl.height / 2 - earthOnScreen.y) < r + lbl.width / 2 + lbl.height / 2;
        const mask = r > 0 && near
            ? `radial-gradient(circle at ${(earthOnScreen.x - lbl.x).toFixed(1)}px ${(earthOnScreen.y - lbl.y).toFixed(1)}px, transparent ${r.toFixed(1)}px, #000 ${(r + 0.5).toFixed(1)}px)`
            : '';
        if (lbl.maskText !== mask) {
            lbl.maskText = mask;
            lbl.el.style.maskImage = mask;
            lbl.el.style.webkitMaskImage = mask;
        }
    }
    layer.labels.forEach((lbl) => { lbl.onPlace = clipToEarth; });

    function measureEarthOnScreen() {
        projected.set(0, 0, 0).project(camera);
        earthOnScreen.x = (projected.x + 1) * 0.5 * viewW;
        earthOnScreen.y = (1 - projected.y) * 0.5 * viewH;
        earthOnScreen.radius = (Math.tan(Math.asin(Math.min(1, 1 / camera.position.length()))) / TAN_HALF_FOV) * (viewH / 2);
    }

    // A ring's distance is hidden when Earth blocks it or when it is outside the view.
    function showRingLabel(ring) {
        if (ring.fade <= 0.5 || isBlockedByEarth(ring.anchor)) return;
        projected.copy(ring.anchor).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        const x = (projected.x + 1) * 0.5 * viewW, y = (1 - projected.y) * 0.5 * viewH;
        if (x < 0 || x > viewW || y < 0 || y > viewH) return;
        layer.show(ring.label, x, y);
    }

    function updateLabels() {
        layer.begin();
        measureEarthOnScreen();
        if (state.showLabels) {
            const shown = shownElements();
            const show = visibility(shown);
            const texts = {
                a: `${formatNumber(state.a, 0)} km`,
                e: state.e.toFixed(3),
                i: `${state.i.toFixed(1)}°`,
                raan: `${state.raan.toFixed(0)}°`,
                argp: `${state.argp.toFixed(0)}°`,
                nu: `${state.nu.toFixed(0)}°`
            };
            ELEMENTS.forEach((name) => {
                measureLabels[name].el.classList.toggle('active', shown.size > 1 && state.selected === name);
                if (!shown.has(name)) return;
                setLabelValue(measureLabels[name], state.showValues ? texts[name] : '');
                showMeasure(name);
            });

            showAxisName(labelI, anchors.I, X_AXIS);
            showAxisName(labelK, anchors.K, Z_AXIS);
            if (show.hVector) showAxisName(labelH, anchors.H, tmpDirH.copy(anchors.H).normalize());
            if (shown.size === 0 || shown.has('nu')) showWord(labelSat, anchors.sat);
            if (show.node) showWord(labelNode, anchors.node);
            if (show.perigee) showWord(labelPerigee, anchors.perigee);
            if (show.apogee) showWord(labelApogee, anchors.apogee);
            if (state.showValues) rings.forEach(showRingLabel);
        }
        layer.place(viewW, viewH);
    }

    function renderFrame() {
        updateCamera();
        update3DScene();
        stars.follow(camera);
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
        e: { min: 0, max: E_MAX, decimals: 3 },
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
        if (name === 'a') changingA = true;
        // True anomaly places the satellite on the orbit. It does not change the orbit itself.
        if (name === 'nu') {
            setPlaying(false);
        } else {
            state.activePreset = null;
            $('preset').value = '';
        }
        dirty = true;
    }

    // Selecting adds one element's measurement to the view and removes the previous one's.
    function setSelected(name) {
        if (state.selected === name) return;
        state.selected = name;
        if (name !== 'a') changingA = false;
        if (name) state.presetCaption = false;
        syncVisBoxes();
        document.querySelectorAll('.param').forEach((row) => {
            row.classList.toggle('selected', row.dataset.param === name);
        });
        dirty = true;
    }

    // Each row has a checkbox that applies in 'some' mode. In other modes it shows what is drawn.
    const visBoxes = {};
    document.querySelectorAll('.param').forEach((row) => {
        const name = row.dataset.param;
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'vis';
        box.setAttribute('aria-label', `Show ${row.querySelector('.param-name').textContent}`);
        box.addEventListener('change', () => {
            if (box.checked) state.chosen.add(name);
            else state.chosen.delete(name);
            dirty = true;
        });
        row.querySelector('.param-head').prepend(box);
        visBoxes[name] = box;
    });

    function syncVisBoxes() {
        const shown = shownElements();
        ELEMENTS.forEach((name) => {
            visBoxes[name].checked = shown.has(name);
            visBoxes[name].disabled = state.mode !== 'some';
        });
    }

    const selectMode = Kit.bindSegmented($('show-mode'), (mode) => {
        const before = shownElements();
        if (mode === 'some' && state.mode !== 'some') state.chosen = new Set(before);
        if (mode === 'one' && !state.selected) setSelected([...before][0] || 'a');
        state.mode = mode;
        syncVisBoxes();
        dirty = true;
    });

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
        changingA = false;
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

    $('play').addEventListener('click', () => {
        setPlaying(!state.playing);
        changingA = false;
        dirty = true;
    });
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
    $('show-values').addEventListener('change', (e) => {
        state.showValues = e.target.checked;
        layer.remeasure();
        dirty = true;
    });
    $('show-fill').addEventListener('change', (e) => {
        state.showFill = e.target.checked;
        dirty = true;
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
    applyPreset('generic');
    setSelected('a');
    syncVisBoxes();
    setPlaying(state.playing);
    $('speed-value').textContent = SPEEDS[state.speed].label;
    statusEl.style.display = 'none';

    // The caption changes length with the selected element. Space is reserved for the longest
    // caption (not for the occasional warning added to it), so that the view does not change size, and the scene does not shift, when the
    // selection changes.
    function reserveCaptionSpace() {
        const texts = [];
        const add = (title, body) => texts.push([title, body]);
        add('Classical Orbital Elements (COEs).', INTRO_BODY);
        Object.values(CAPTIONS).forEach(([title, body]) => add(title, body));
        Object.values(PRESETS).forEach((preset) => add(`${preset.name}.`, `${preset.desc} Select an element to see what it measures.`));
        const probe = document.createElement('div');
        probe.className = hud.className;
        probe.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;min-height:0;width:${hud.clientWidth}px`;
        hud.parentNode.appendChild(probe);
        let tallest = 0;
        texts.forEach(([title, body]) => {
            probe.textContent = '';
            const titleEl = document.createElement('b');
            titleEl.textContent = title;
            probe.append(titleEl, document.createTextNode(` ${body}`));
            tallest = Math.max(tallest, probe.offsetHeight);
        });
        probe.remove();
        if (tallest && hud.style.minHeight !== `${tallest}px`) hud.style.minHeight = `${tallest}px`;
    }

    Kit.observeSize(view, (w, h) => {
        reserveCaptionSpace();
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

        // Keep drawing while a label glides to a new spot.
        if (layer.settling) dirty = true;

        if (dirty) {
            dirty = false;
            renderFrame();
            updatePanels();
        }
    });
})();
