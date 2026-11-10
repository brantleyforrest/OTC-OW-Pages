// Ground Track Visualizer
// A split view of one orbit: in 3D around a turning Earth, and as its ground track on a map.
// The ground track is the path of the point directly below the satellite. Earth turns under the
// orbit, so the track depends on time as well as on the six Classical Orbital Elements.
// Motion is two-body around a spherical Earth.
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
    const ORBIT_PLAY_SECONDS = 12;
    const SPEEDS = [
        { rate: 0.4, label: 'Slow' },
        { rate: 1.0, label: 'Normal' },
        { rate: 2.2, label: 'Fast' }
    ];

    // Perigee, apogee, and the ascending node use their colors from the Orbital Elements
    // Visualizer, and the descending node is a paler shade of the ascending node's. The phase
    // differential shares the color of a, the element that sets the period.
    const COLORS = {
        orbit: '#e0b64f',
        track: '#ffe08a',
        perigee: '#f472b6',
        apogee: '#ff8a3d',
        node: '#38bdf8',
        descending: '#bae6fd',
        phase: '#ff8a3d'
    };
    const AHEAD_OPACITY = 0.45;
    const E_MAX = 0.85;           // Largest eccentricity offered
    const CIRCULAR_E = 0.02;      // Below this, an orbit counts as circular: no perigee or apogee
    const EARTH_DEG_PER_HOUR = OMEGA_E * R2D * 3600;

    const POINTS_PER_ORBIT = 240; // Enough that the track looks smooth at the largest eccentricity
    const MAX_PAST_ORBITS = 16;   // About one day of a low orbit
    const TRACK_POINTS = (MAX_PAST_ORBITS + 1) * POINTS_PER_ORBIT + 1;
    const TRACK_RADIUS = 1.004;   // The track on the globe lies just above the surface
    const MARKER_MAX = MAX_PAST_ORBITS + 2; // Perigee or apogee passes that can be in view at once

    // A slice of the globe is built fine enough that its flat facets stay above the surface.
    const SLICE_ROWS = 48;
    const SLICE_COLUMNS = 96;
    const SLICE_RADIUS = 1.003;
    const RULER_HEIGHT = 8;       // Height of the hour ruler on the map, in pixels

    // Draw order, lowest first. Solid objects are hidden by Earth. Their dim "ghost" copies are
    // drawn last, without depth testing, so that a part behind Earth is still faintly visible.
    const ORDER = { slice: 2, track: 3, ghost: 6 };

    const PRESETS = {
        iss: {
            name: 'International Space Station',
            a: 6798, e: 0.001, i: 51.6, raan: 285, argp: 40, nu: 60,
            desc: 'A low orbit about 93 minutes long. Earth turns about 23° in that time, so each pass lands that far west of the last.'
        },
        gps: {
            name: 'GPS satellite',
            a: 26560, e: 0.01, i: 55, raan: 300, argp: 0, nu: 90,
            desc: 'Two orbits take one sidereal day, the time Earth takes to turn once, so the track repeats every two orbits.'
        },
        molniya: {
            name: 'Molniya orbit',
            a: 26600, e: 0.72, i: 63.4, raan: 310, argp: 270, nu: 180,
            desc: 'A long ellipse. The satellite lingers near apogee, so the track loops high over the Northern Hemisphere.'
        },
        geo: {
            name: 'Geostationary orbit',
            a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0,
            desc: 'One orbit takes one sidereal day and follows the equator, so the track is a single point.'
        },
        geoInclined: {
            name: 'Inclined geosynchronous orbit',
            a: 42164, e: 0, i: 30, raan: 0, argp: 0, nu: 0,
            desc: 'One orbit takes one sidereal day, but the tilt carries the satellite north and south, so the track is a figure eight.'
        },
        sso: {
            name: 'Sun-synchronous orbit',
            a: 7178, e: 0.002, i: 98.6, raan: 220, argp: 90, nu: 45,
            desc: 'A low orbit tilted just past 90°. It passes over nearly every latitude, and its track leans the opposite way from a prograde orbit’s.'
        }
    };

    const INTRO_BODY = 'The path of the point directly below the satellite. Earth turns under the orbit, so each pass lands farther west. Select an element to see what it changes.';
    const PERIOD_TITLE = 'Phase differential (Δλ).';
    const PERIOD_BODY = 'During one orbit Earth turns east beneath the satellite, so the next pass crosses the equator farther west. The orange slice is the part of Earth that turned past the orbit. Earth turns 15.04° each hour, so the ruler on the equator reads that slice as the period.';
    const CAPTIONS = {
        a: ['Semi-major axis (a): sets the period.', 'A longer period gives Earth more time to turn during each orbit, so the phase differential grows.'],
        e: ['Eccentricity (e): stretches the track.', 'The satellite moves fastest at perigee and slowest at apogee, so the track stretches out near perigee and bunches up near apogee. Below 0.02 the orbit is nearly a circle, so neither is marked.'],
        i: ['Inclination (i): sets how far north and south the track reaches.', 'The track’s highest latitude equals i, or 180° − i when the orbit is retrograde.'],
        raan: ['Right Ascension of the Ascending Node (Ω, RAAN): slides the track.', 'Turning the orbit about Earth’s axis moves the whole track east or west without changing its shape.'],
        argp: ['Argument of perigee (ω): sets where perigee is.', 'It moves the fast and slow parts of the track along the orbit, and sets which hemisphere holds apogee.'],
        nu: ['True anomaly (ν): moves the satellite.', 'Moving the satellite takes time, so Earth turns with it. The satellite slides along the track, and the track stays in place.']
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
        theta: 0,              // Earth's rotation: the Prime Meridian's angle east of the vernal equinox (rad)
        pastOrbits: 3,
        onePeriod: false,      // Shows one orbit, from one ascending node to the next
        activePreset: 'iss',
        presetCaption: false,
        selected: null,        // The element described in the caption
        playing: false,
        speed: 1
    };

    // The camera frames the whole orbit (fit). Zoom multiplies that distance.
    const HOME_VIEW = { az: 25, el: 22 };
    const camView = { ...HOME_VIEW, zoom: 1 };
    const MIN_CAMERA_DISTANCE = 1.8;
    const MAX_ZOOM = 3;
    const FOV_DEG = 40;
    const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * D2R);

    function fitDistance() {
        const apogee = (state.a * (1 + state.e)) / R_E;
        return Math.max(1.7, apogee * 1.1) / TAN_HALF_FOV;
    }
    let camFit = fitDistance();

    /* ------------------------------------------------------------------ */
    /* Renderer and Scene                                                 */
    /* ------------------------------------------------------------------ */
    const orbitPane = $('orbit-pane');
    const mapPane = $('map-pane');
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

    const earth = window.EarthScene.addEarth(THREE, renderer, scene, { primeMeridian: true });
    earth.atmosphere.renderOrder = 1;
    const stars = window.EarthScene.addStars(THREE, scene);

    function pointGeometry(pointCount) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
        return geo;
    }

    // A solid object plus a dim ghost of it. Earth hides the solid part, and the ghost still
    // shows where that part is. Both share one geometry, so a group can be moved, scaled, and
    // hidden as one object. Geometry here can change after creation, so nothing is culled.
    function ghosted(geometry, color, { ghost = 0.3, line = false } = {}) {
        const group = new THREE.Group();
        const solidMat = line
            ? new THREE.LineBasicMaterial({ color, transparent: true })
            : new THREE.MeshBasicMaterial({ color, transparent: true });
        const ghostMat = line
            ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: ghost, depthTest: false, depthWrite: false })
            : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ghost, depthTest: false, depthWrite: false });
        const Kind = line ? THREE.Line : THREE.Mesh;
        const solid = new Kind(geometry, solidMat);
        const dim = new Kind(geometry, ghostMat);
        dim.renderOrder = ORDER.ghost;
        solid.frustumCulled = false;
        dim.frustumCulled = false;
        group.add(solid, dim);
        group.userData.parts = [solid, dim];
        scene.add(group);
        return group;
    }

    /* Orbit, drawn as a thin tube because WebGL lines are only one pixel wide */
    const ORBIT_PTS = 256;
    const orbitCurve = new THREE.Curve();
    orbitCurve.arcLengthDivisions = ORBIT_PTS;
    const orbitShape = { P: new THREE.Vector3(1, 0, 0), Q: new THREE.Vector3(0, 1, 0), p: 1, e: 0 };
    orbitCurve.getPoint = (t, target = new THREE.Vector3()) => {
        const th = t * TWO_PI;
        const r = orbitShape.p / (1 + orbitShape.e * Math.cos(th));
        return target.set(0, 0, 0)
            .addScaledVector(orbitShape.P, r * Math.cos(th))
            .addScaledVector(orbitShape.Q, r * Math.sin(th));
    };
    const orbitTube = ghosted(new THREE.BufferGeometry(), COLORS.orbit, { ghost: 0.28 });

    /* The satellite, and the line straight down to the point below it */
    const SPHERE = new THREE.SphereGeometry(1, 16, 12);
    const satMarker = ghosted(SPHERE, 0xffffff, { ghost: 0.4 });
    const groundMarker = ghosted(SPHERE, 0xffffff, { ghost: 0.4 });
    const nadirLine = ghosted(pointGeometry(2), 0xffffff, { ghost: 0.3, line: true });

    // The track on the globe, drawn as a flat band because WebGL lines are only one pixel wide.
    // It belongs to Earth, so it turns with Earth.
    function createRibbon(opacity) {
        const geometry = pointGeometry(TRACK_POINTS * 2);
        const index = [];
        for (let k = 0; k < TRACK_POINTS - 1; k++) {
            const v = 2 * k;
            index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
        geometry.setIndex(index);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: COLORS.track, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = ORDER.track;
        earth.pivot.add(mesh);
        return mesh;
    }
    const pastRibbon = createRibbon(1);
    const nextRibbon = createRibbon(AHEAD_OPACITY);

    /* Perigee, apogee, and the nodes on the orbit, and on the ground track below them */
    const perigeeMarker = ghosted(SPHERE, COLORS.perigee, { ghost: 0.4 });
    const apogeeMarker = ghosted(SPHERE, COLORS.apogee, { ghost: 0.4 });
    const ascendingMarker = ghosted(SPHERE, COLORS.node, { ghost: 0.4 });
    const descendingMarker = ghosted(SPHERE, COLORS.descending, { ghost: 0.4 });

    function surfaceDots(color, capacity) {
        const dots = new THREE.InstancedMesh(SPHERE, new THREE.MeshBasicMaterial({ color }), capacity);
        dots.frustumCulled = false;
        earth.pivot.add(dots);
        return dots;
    }
    const perigeeDots = surfaceDots(COLORS.perigee, MARKER_MAX);
    const apogeeDots = surfaceDots(COLORS.apogee, MARKER_MAX);
    const ascendingDots = surfaceDots(COLORS.node, MARKER_MAX);
    const descendingDots = surfaceDots(COLORS.descending, MARKER_MAX);

    /* One period: the slice of Earth that turned past the orbit, and a line down from the
       ascending node, which stays fixed in space while Earth turns. */
    function createSlice(opacity) {
        const geometry = pointGeometry((SLICE_ROWS + 1) * (SLICE_COLUMNS + 1));
        const index = [];
        for (let r = 0; r < SLICE_ROWS; r++) {
            for (let q = 0; q < SLICE_COLUMNS; q++) {
                const v = r * (SLICE_COLUMNS + 1) + q, up = v + SLICE_COLUMNS + 1;
                index.push(v, v + 1, up, v + 1, up + 1, up);
            }
        }
        geometry.setIndex(index);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            color: COLORS.phase, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false
        }));
        mesh.frustumCulled = false;
        mesh.renderOrder = ORDER.slice;
        earth.pivot.add(mesh);
        return mesh;
    }
    const wholeSlice = createSlice(0.2);
    const turnedSlice = createSlice(0.4);
    const nodeLine = ghosted(pointGeometry(2), COLORS.node, { ghost: 0.3, line: true });
    const periodObjects = [wholeSlice, turnedSlice, nodeLine];

    /* ------------------------------------------------------------------ */
    /* Orbital Mechanics                                                  */
    /* ------------------------------------------------------------------ */

    // Unit vectors in ECI: P toward perigee, Q in the plane 90 degrees ahead of P.
    function orbitBasis() {
        const O = state.raan * D2R, inc = state.i * D2R, w = state.argp * D2R;
        const cosO = Math.cos(O), sinO = Math.sin(O);
        const cosi = Math.cos(inc), sini = Math.sin(inc);
        const cosw = Math.cos(w), sinw = Math.sin(w);
        return {
            P: new THREE.Vector3(cosO * cosw - sinO * sinw * cosi, sinO * cosw + cosO * sinw * cosi, sinw * sini),
            Q: new THREE.Vector3(-cosO * sinw - sinO * cosw * cosi, -sinO * sinw + cosO * cosw * cosi, cosw * sini)
        };
    }

    const meanMotion = (a) => Math.sqrt(MU / (a * a * a));

    function eccentricAnomaly(nuDeg, e) {
        const nu = nuDeg * D2R;
        return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
    }

    function meanAnomaly(nuDeg, e) {
        const E = eccentricAnomaly(nuDeg, e);
        return E - e * Math.sin(E);
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
        const M = ((meanAnomaly(nuDeg, e) + orbitFraction * TWO_PI) % TWO_PI + TWO_PI) % TWO_PI;
        const E = solveKepler(M, e);
        const next = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e) * R2D;
        return (next + 360) % 360;
    }

    const isCircular = () => state.e < CIRCULAR_E;
    const isEquatorial = () => state.i < 0.05 || state.i > 179.95;
    const periodSeconds = () => TWO_PI / meanMotion(state.a);

    // The most recent ascending node at or before the satellite: its eccentric anomaly, and the
    // time since the satellite passed it.
    function lastNode() {
        const { e } = state;
        const E0 = eccentricAnomaly(state.nu, e);
        const behind = (((E0 - eccentricAnomaly(-state.argp, e)) % TWO_PI) + TWO_PI) % TWO_PI;
        const start = E0 - behind;
        const elapsed = (behind + e * (Math.sin(start) - Math.sin(E0))) / meanMotion(state.a);
        return { start, elapsed };
    }

    // Each sample is the unit vector, in Earth-fixed axes, toward the point below the satellite.
    // Samples are evenly spaced in eccentric anomaly, which keeps them close together near perigee
    // without a Kepler solve for each one. The current position is the sample at index trackNow.
    const track = new Float32Array(TRACK_POINTS * 3);
    let trackNow = 0, trackEnd = 0;
    let periodElapsed = 0;     // Time since the first equator crossing of the period shown (s)

    // Every pass in view of each marked point. The first "past" of them are behind the satellite.
    const passes = () => ({ points: new Float32Array(MARKER_MAX * 3), count: 0, past: 0 });
    const perigees = passes(), apogees = passes(), ascents = passes(), descents = passes();

    function computeTrack() {
        const { a, e } = state;
        const { P, Q } = orbitBasis();
        const root = Math.sqrt(1 - e * e);
        const n = meanMotion(a);
        const E0 = eccentricAnomaly(state.nu, e);
        const M0 = E0 - e * Math.sin(E0);

        // One period runs from one ascending node to the next. When the satellite reaches the
        // next node, the view moves on to the pass that starts there, and Earth keeps turning.
        let start = E0 - state.pastOrbits * TWO_PI;
        let end = E0 + TWO_PI;
        if (state.onePeriod) {
            const node = lastNode();
            start = node.start;
            end = start + TWO_PI;
            periodElapsed = node.elapsed;
        }

        const groundPoint = (E, target, index) => {
            const elapsed = (E - e * Math.sin(E) - M0) / n;
            const turned = state.theta + OMEGA_E * elapsed;
            const cosT = Math.cos(turned), sinT = Math.sin(turned);
            const r = a * (1 - e * Math.cos(E));
            const px = a * (Math.cos(E) - e), py = a * root * Math.sin(E);
            const x = P.x * px + Q.x * py, y = P.y * px + Q.y * py, z = P.z * px + Q.z * py;
            target[3 * index] = (cosT * x + sinT * y) / r;
            target[3 * index + 1] = (-sinT * x + cosT * y) / r;
            target[3 * index + 2] = z / r;
        };

        // The satellite is always a sample, and the two ends land exactly on the window's ends.
        const step = TWO_PI / POINTS_PER_ORBIT;
        trackNow = Math.ceil((E0 - start) / step - 1e-9);
        trackEnd = trackNow + Math.ceil((end - E0) / step - 1e-9);
        for (let k = 0; k <= trackEnd; k++) {
            const E = k === 0 ? start : k === trackEnd ? end : E0 + (k - trackNow) * step;
            groundPoint(E, track, k);
        }

        // Perigee is at E = 0 and apogee at E = 180 degrees, once per orbit. The nodes are at true
        // anomalies of -w and 180 - w. One period runs from one ascending node to the next, so
        // both of its ends are marked.
        const collect = (set, phase, includeEnd = false) => {
            const last = includeEnd ? end + 1e-9 : end - 1e-9;
            set.count = set.past = 0;
            for (let m = Math.ceil((start - phase) / TWO_PI - 1e-9); phase + m * TWO_PI < last; m++) {
                const E = phase + m * TWO_PI;
                groundPoint(E, set.points, set.count);
                set.count++;
                if (E <= E0) set.past = set.count;
            }
        };
        collect(perigees, 0);
        collect(apogees, Math.PI);
        collect(ascents, eccentricAnomaly(-state.argp, e), state.onePeriod);
        collect(descents, eccentricAnomaly(180 - state.argp, e));
    }

    const longitudeOf = (points, k) => Math.atan2(points[3 * k + 1], points[3 * k]) * R2D;
    const latitudeOf = (points, k) => Math.asin(Math.max(-1, Math.min(1, points[3 * k + 2]))) * R2D;
    const longitudeAt = (k) => longitudeOf(track, k);
    const latitudeAt = (k) => latitudeOf(track, k);
    const wrapLongitude = (lon) => (((lon + 180) % 360) + 360) % 360 - 180;

    /* ------------------------------------------------------------------ */
    /* 3D Scene Update                                                    */
    /* ------------------------------------------------------------------ */
    let geometryKey = '';
    let tubeKey = '';
    const satPos = new THREE.Vector3();
    const groundPos = new THREE.Vector3();

    function rebuildOrbitTube(radius) {
        orbitTube.userData.parts[0].geometry.dispose();
        orbitCurve.updateArcLengths();
        const geometry = new THREE.TubeGeometry(orbitCurve, ORBIT_PTS, radius, 6, true);
        orbitTube.userData.parts.forEach((part) => { part.geometry = geometry; });
    }

    // Writes the part of the track from sample "from" to sample "to" into a band.
    function writeRibbon(ribbon, from, to, halfWidth) {
        const pos = ribbon.geometry.attributes.position;
        let sideX = 0, sideY = 0, sideZ = 1; // Kept from the last sample where the track stands still
        for (let k = from; k <= to; k++) {
            const b = 3 * Math.max(k - 1, from), c = 3 * Math.min(k + 1, to), j = 3 * k;
            const ux = track[j], uy = track[j + 1], uz = track[j + 2];
            const tx = track[c] - track[b], ty = track[c + 1] - track[b + 1], tz = track[c + 2] - track[b + 2];
            const sx = uy * tz - uz * ty, sy = uz * tx - ux * tz, sz = ux * ty - uy * tx;
            const len = Math.hypot(sx, sy, sz);
            if (len > 1e-7) { sideX = sx / len; sideY = sy / len; sideZ = sz / len; }
            const v = 2 * (k - from);
            const mx = TRACK_RADIUS * ux, my = TRACK_RADIUS * uy, mz = TRACK_RADIUS * uz;
            pos.setXYZ(v, mx + sideX * halfWidth, my + sideY * halfWidth, mz + sideZ * halfWidth);
            pos.setXYZ(v + 1, mx - sideX * halfWidth, my - sideY * halfWidth, mz - sideZ * halfWidth);
        }
        pos.needsUpdate = true;
        ribbon.geometry.setDrawRange(0, 6 * (to - from));
    }

    function setLine(line, from, to) {
        const pos = line.userData.parts[0].geometry.attributes.position;
        pos.setXYZ(0, from.x, from.y, from.z);
        pos.setXYZ(1, to.x, to.y, to.z);
        pos.needsUpdate = true;
    }

    const dotMatrix = new THREE.Matrix4();
    function writeDots(dots, points, count, radius) {
        dots.count = count;
        for (let k = 0; k < count; k++) {
            dotMatrix.makeScale(radius, radius, radius);
            dotMatrix.setPosition(points[3 * k] * TRACK_RADIUS, points[3 * k + 1] * TRACK_RADIUS, points[3 * k + 2] * TRACK_RADIUS);
            dots.setMatrixAt(k, dotMatrix);
        }
        dots.instanceMatrix.needsUpdate = true;
    }

    // Writes the part of the globe that runs spanDeg westward from eastLon, from pole to pole.
    function writeSlice(slice, eastLon, spanDeg) {
        const pos = slice.geometry.attributes.position;
        const span = Math.min(spanDeg, 360) * D2R, east = eastLon * D2R;
        let v = 0;
        for (let r = 0; r <= SLICE_ROWS; r++) {
            const lat = (r / SLICE_ROWS - 0.5) * Math.PI;
            const ring = SLICE_RADIUS * Math.cos(lat), z = SLICE_RADIUS * Math.sin(lat);
            for (let q = 0; q <= SLICE_COLUMNS; q++) {
                const lon = east - (q / SLICE_COLUMNS) * span;
                pos.setXYZ(v++, ring * Math.cos(lon), ring * Math.sin(lon), z);
            }
        }
        pos.needsUpdate = true;
    }

    const nodePos = new THREE.Vector3();
    const nodeGround = new THREE.Vector3();

    function update3DScene() {
        const { a, e, nu } = state;
        const { P, Q } = orbitBasis();
        const aScene = a / R_E;
        const p = aScene * (1 - e * e);
        const nuRad = nu * D2R;
        const r = p / (1 + e * Math.cos(nuRad));

        earth.pivot.rotation.z = state.theta;

        // World units per screen pixel at Earth's center, so that lines and markers keep a
        // steady size on screen at any zoom and in any size of view.
        const px = (2 * camera.position.length() * TAN_HALF_FOV) / viewH;

        const key = [a, e, state.i, state.raan, state.argp].join();
        if (key !== geometryKey) {
            geometryKey = key;
            orbitShape.P.copy(P);
            orbitShape.Q.copy(Q);
            orbitShape.p = p;
            orbitShape.e = e;
        }
        const tubeRadius = 1.3 * px;
        const nextTubeKey = `${key}|${tubeRadius.toPrecision(2)}`;
        if (nextTubeKey !== tubeKey) {
            tubeKey = nextTubeKey;
            rebuildOrbitTube(tubeRadius);
        }

        satPos.set(0, 0, 0)
            .addScaledVector(P, r * Math.cos(nuRad))
            .addScaledVector(Q, r * Math.sin(nuRad));
        groundPos.copy(satPos).normalize();
        satMarker.position.copy(satPos);
        satMarker.scale.setScalar(5 * px);
        groundMarker.position.copy(groundPos);
        groundMarker.scale.setScalar(3 * px);

        setLine(nadirLine, groundPos, satPos);

        const halfWidth = 1.2 * px;
        writeRibbon(pastRibbon, 0, trackNow, halfWidth);
        writeRibbon(nextRibbon, trackNow, trackEnd, halfWidth);

        // Perigee and apogee, on the orbit and on the track. A circle has neither.
        const hasApsides = !isCircular();
        perigeeMarker.visible = apogeeMarker.visible = hasApsides;
        perigeeMarker.position.copy(P).multiplyScalar(aScene * (1 - e));
        apogeeMarker.position.copy(P).multiplyScalar(-aScene * (1 + e));
        perigeeMarker.scale.setScalar(4 * px);
        apogeeMarker.scale.setScalar(4 * px);
        writeDots(perigeeDots, perigees.points, hasApsides ? perigees.count : 0, 3.5 * px);
        writeDots(apogeeDots, apogees.points, hasApsides ? apogees.count : 0, 3.5 * px);

        // The nodes, on the orbit and on the track. An orbit in the equator's plane has none, but
        // one period is still measured between the points where it would ascend.
        const raan = state.raan * D2R;
        const cosArgp = Math.cos(state.argp * D2R);
        const showAscending = state.onePeriod || !isEquatorial();
        const showDescending = !isEquatorial();
        nodeGround.set(Math.cos(raan), Math.sin(raan), 0);
        nodePos.copy(nodeGround).multiplyScalar(p / (1 + e * cosArgp));
        ascendingMarker.visible = showAscending;
        descendingMarker.visible = showDescending;
        ascendingMarker.position.copy(nodePos);
        descendingMarker.position.copy(nodeGround).multiplyScalar(-p / (1 - e * cosArgp));
        ascendingMarker.scale.setScalar(4 * px);
        descendingMarker.scale.setScalar(4 * px);
        writeDots(ascendingDots, ascents.points, showAscending ? ascents.count : 0, 3.5 * px);
        writeDots(descendingDots, descents.points, showDescending ? descents.count : 0, 3.5 * px);

        // In one period, the slice runs west from the first crossing. Its growing part ends
        // directly beneath the node, which stays fixed in space while Earth carries the slice.
        periodObjects.forEach((object) => { object.visible = state.onePeriod; });
        if (state.onePeriod) {
            const first = longitudeAt(0);
            writeSlice(wholeSlice, first, OMEGA_E * periodSeconds() * R2D);
            writeSlice(turnedSlice, first, OMEGA_E * periodElapsed * R2D);
            setLine(nodeLine, nodeGround, nodePos);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Map                                                                */
    /* ------------------------------------------------------------------ */
    // An equirectangular map, the same projection as Earth's texture, so the texture is the map.
    const map = $('map');
    const mapCtx = map.getContext('2d');
    const mapBase = document.createElement('canvas'); // The map without the track, redrawn only on resize
    const plot = { x: 0, y: 0, w: 1, h: 1 };
    let mapW = 1, mapH = 1;

    const mapX = (lon) => plot.x + ((lon + 180) / 360) * plot.w;
    const mapY = (lat) => plot.y + ((90 - lat) / 180) * plot.h;

    function drawMapBase() {
        mapBase.width = map.width;
        mapBase.height = map.height;
        const g = mapBase.getContext('2d');
        const ratio = map.width / mapW;
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.imageSmoothingQuality = 'high';
        g.drawImage(earth.mesh.material.map.image, plot.x, plot.y, plot.w, plot.h);

        g.strokeStyle = 'rgba(255, 255, 255, 0.13)';
        g.lineWidth = 1;
        g.beginPath();
        for (let lon = -150; lon <= 150; lon += 30) {
            g.moveTo(mapX(lon), plot.y);
            g.lineTo(mapX(lon), plot.y + plot.h);
        }
        for (let lat = -60; lat <= 60; lat += 30) {
            g.moveTo(plot.x, mapY(lat));
            g.lineTo(plot.x + plot.w, mapY(lat));
        }
        g.stroke();

        const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
        g.font = `10px ${mono}`;
        g.fillStyle = '#cbd5e1';
        g.shadowColor = '#000000';
        g.shadowBlur = 3;
        g.textAlign = 'center';
        g.textBaseline = 'bottom';
        for (let lon = -120; lon <= 120; lon += 60) {
            const name = lon === 0 ? '0°' : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`;
            g.fillText(name, mapX(lon), plot.y + plot.h - 2);
        }
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        for (let lat = -60; lat <= 60; lat += 30) {
            const name = lat === 0 ? '0°' : `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`;
            g.fillText(name, plot.x + 4, mapY(lat));
        }
    }

    // Draws part of the track. Where it crosses the map's edge at 180° longitude, the line runs
    // to that edge and continues from the opposite edge. Directly over a pole, longitude flips
    // by half a turn in one step, so the line stops there and restarts on the far side.
    function strokeTrack(g, from, to) {
        g.beginPath();
        let lastLon = longitudeAt(from), lastLat = latitudeAt(from);
        g.moveTo(mapX(lastLon), mapY(lastLat));
        for (let k = from + 1; k <= to; k++) {
            const lon = longitudeAt(k), lat = latitudeAt(k);
            const jump = lon - lastLon;
            const crossesEdge = Math.abs(jump) > 180;
            const overPole = (crossesEdge ? 360 - Math.abs(jump) : Math.abs(jump)) > 150;
            if (overPole) {
                g.moveTo(mapX(lon), mapY(lat));
            } else {
                if (crossesEdge) {
                    const edge = jump > 0 ? -180 : 180;
                    const share = (edge - lastLon) / (jump - Math.sign(jump) * 360);
                    const edgeLat = lastLat + share * (lat - lastLat);
                    g.lineTo(mapX(edge), mapY(edgeLat));
                    g.moveTo(mapX(-edge), mapY(edgeLat));
                }
                g.lineTo(mapX(lon), mapY(lat));
            }
            lastLon = lon;
            lastLat = lat;
        }
        g.stroke();
    }

    // Fills the map's columns from eastLon to spanDeg west of it, wrapping around the map's edges.
    function fillWestOf(g, eastLon, spanDeg, y, height) {
        const width = (Math.min(spanDeg, 360) / 360) * plot.w;
        const x = mapX(eastLon) - width;
        for (const shift of [-plot.w, 0, plot.w]) g.fillRect(x + shift, y, width, height);
    }

    // The phase differential, drawn as Earth used as a clock. The slice is the part of Earth that
    // turned past the orbit in one period, and its stronger part is what has turned so far. The
    // ruler on the equator marks each hour of Earth's turn, so it reads the slice as a time. The
    // needle is where the orbit crosses the equator now, and the satellite arrives there at the
    // end of the period.
    function drawPeriodSlice(g) {
        const first = longitudeAt(0);
        const hours = periodSeconds() / 3600;
        const span = EARTH_DEG_PER_HOUR * hours;
        const turned = OMEGA_E * periodElapsed * R2D;
        const y = mapY(0) - RULER_HEIGHT / 2;

        g.fillStyle = COLORS.phase;
        g.globalAlpha = 0.16;
        fillWestOf(g, first, span, plot.y, plot.h);
        g.globalAlpha = 0.26;
        fillWestOf(g, first, turned, plot.y, plot.h);

        g.globalAlpha = 1;
        g.fillStyle = 'rgba(6, 11, 20, 0.8)';
        fillWestOf(g, first, span, y, RULER_HEIGHT);
        g.fillStyle = COLORS.phase;
        fillWestOf(g, first, turned, y, RULER_HEIGHT);

        // Finer marks when an hour is wide enough on screen to hold them.
        const pxPerHour = (EARTH_DEG_PER_HOUR / 360) * plot.w;
        const minorHours = pxPerHour >= 30 ? 0.25 : pxPerHour >= 14 ? 0.5 : 1;
        const labelHours = [1, 2, 3, 6].find((step) => step * pxPerHour >= 32) || 6;
        const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
        g.font = `10px ${mono}`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        for (let k = 1; k * minorHours < hours && k * minorHours * EARTH_DEG_PER_HOUR <= 360; k++) {
            const hour = k * minorHours;
            const x = mapX(wrapLongitude(first - hour * EARTH_DEG_PER_HOUR));
            const whole = Number.isInteger(hour);
            g.fillStyle = '#ffffff';
            g.fillRect(x - 0.5, y, 1, whole ? RULER_HEIGHT + 3 : RULER_HEIGHT / 2);
            if (whole && hour % labelHours === 0 && (hours - hour) * pxPerHour > 12) {
                g.shadowColor = '#000000';
                g.shadowBlur = 3;
                g.fillText(`${hour} h`, x, y + RULER_HEIGHT + 4);
                g.shadowBlur = 0;
            }
        }

        const needle = mapX(wrapLongitude(first - Math.min(turned, 360)));
        g.fillStyle = COLORS.phase;
        g.fillRect(needle - 0.75, plot.y, 1.5, plot.h);
    }

    const circleMark = (g, x, y) => g.arc(x, y, 4.2, 0, TWO_PI);
    const diamondMark = (g, x, y) => {
        const r = 5.4;
        g.moveTo(x, y - r);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r);
        g.lineTo(x - r, y);
        g.closePath();
    };
    // An equilateral triangle centered on its point, up for a pass heading north.
    const triangleMark = (up) => (g, x, y) => {
        const r = 6.2 * up;
        g.moveTo(x, y - r);
        g.lineTo(x + 0.866 * r, y + 0.5 * r);
        g.lineTo(x - 0.866 * r, y + 0.5 * r);
        g.closePath();
    };
    const ascendingMark = triangleMark(1);
    const descendingMark = triangleMark(-1);

    function drawMark(g, shape, lon, lat, color) {
        g.beginPath();
        shape(g, mapX(lon), mapY(lat));
        g.fillStyle = color;
        g.fill();
        g.lineWidth = 1.3;
        g.strokeStyle = '#060b14';
        g.stroke();
    }

    function drawPassMarks(g, set, shape, color) {
        for (let k = 0; k < set.count; k++) {
            g.globalAlpha = k < set.past ? 1 : 0.7;
            drawMark(g, shape, longitudeOf(set.points, k), latitudeOf(set.points, k), color);
        }
        g.globalAlpha = 1;
    }

    /* Map labels. Each one names a single pass of its point, so that they stay few enough to read. */
    const mapLayer = new Kit.LabelLayer($('map-labels'));
    function mapLabel(symbol, color, options) {
        const label = mapLayer.add(`<b style="color:${color}">${symbol}</b><span class="val"></span>`, options);
        label.el.classList.add('measure');
        label.valEl = label.el.querySelector('.val');
        return label;
    }
    const labelDelta = mapLabel('Δλ', COLORS.phase, { rank: 0 });
    labelDelta.center = true;
    const labelFirst = mapLabel('Asc. node λ₁', COLORS.node, { rank: 1 });
    let firstLabelWest = false;
    const labelNext = mapLabel('λ₂', COLORS.node, { rank: 1 });
    labelNext.spot = 3; // West of its point, so that the two crossings' labels stay apart
    const labelPerigee = mapLabel('Perigee', COLORS.perigee, { rank: 2, optional: true });
    const labelApogee = mapLabel('Apogee', COLORS.apogee, { rank: 2, optional: true });
    const labelAscending = mapLabel('Asc. node', COLORS.node, { rank: 2, optional: true });
    const labelDescending = mapLabel('Desc. node', COLORS.descending, { rank: 2, optional: true });

    // Names the most recent pass behind the satellite, the last one drawn at full strength.
    function labelPass(label, set) {
        const k = Math.max(set.past - 1, 0);
        mapLayer.show(label, mapX(longitudeOf(set.points, k)), mapY(latitudeOf(set.points, k)));
    }

    function placeMapLabels() {
        mapLayer.begin();
        if (state.onePeriod) {
            const first = longitudeAt(0), equator = mapY(0);
            const hours = periodSeconds() / 3600, span = EARTH_DEG_PER_HOUR * hours;
            const text = ` ${span.toFixed(1)}° → ${hours.toFixed(2)} h`;
            if (labelDelta.valEl.textContent.length !== text.length) labelDelta.width = 0;
            labelDelta.valEl.textContent = text;
            mapLayer.show(labelDelta, mapX(wrapLongitude(first - Math.min(span, 360) / 2)), equator - 20);
            mapLayer.show(labelFirst, mapX(first), equator);
            mapLayer.show(labelNext, mapX(longitudeAt(trackEnd)), equator);

            // λ₁'s label moves to the west side when it would cover a descending node just east.
            const toDescending = mapX(longitudeOf(descents.points, 0)) - mapX(first);
            const west = toDescending > 0 && toDescending < labelFirst.width + 24;
            if (west !== firstLabelWest) {
                firstLabelWest = west;
                labelFirst.spot = west ? 3 : 0;
            }
        } else if (!isEquatorial()) {
            labelPass(labelAscending, ascents);
        }
        if (!isCircular()) {
            labelPass(labelPerigee, perigees);
            labelPass(labelApogee, apogees);
        }
        if (!isEquatorial()) labelPass(labelDescending, descents);
        mapLayer.place(mapW, mapH, [Kit.overlayBox($('map-title'), mapPane)]);
    }

    function drawMap() {
        const g = mapCtx;
        g.clearRect(0, 0, mapW, mapH);
        g.drawImage(mapBase, 0, 0, mapW, mapH);

        g.save();
        g.beginPath();
        g.rect(plot.x, plot.y, plot.w, plot.h);
        g.clip();
        if (state.onePeriod) drawPeriodSlice(g);

        g.lineJoin = 'round';
        g.strokeStyle = COLORS.track;
        g.globalAlpha = AHEAD_OPACITY;
        g.lineWidth = 1.6;
        strokeTrack(g, trackNow, trackEnd);
        g.globalAlpha = 1;
        g.lineWidth = 2;
        strokeTrack(g, 0, trackNow);

        if (state.onePeriod || !isEquatorial()) drawPassMarks(g, ascents, ascendingMark, COLORS.node);
        if (!isEquatorial()) drawPassMarks(g, descents, descendingMark, COLORS.descending);
        if (!isCircular()) {
            drawPassMarks(g, perigees, circleMark, COLORS.perigee);
            drawPassMarks(g, apogees, diamondMark, COLORS.apogee);
        }

        g.beginPath();
        g.arc(mapX(longitudeAt(trackNow)), mapY(latitudeAt(trackNow)), 5, 0, TWO_PI);
        g.fillStyle = '#ffffff';
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = '#060b14';
        g.stroke();
        g.restore();

        placeMapLabels();
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

    function formatAngle(degrees, positive, negative) {
        return `${Math.abs(degrees).toFixed(1)}° ${degrees < 0 ? negative : positive}`;
    }

    function updatePanels() {
        const { a, e, nu, i } = state;
        const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu * D2R));
        const period = periodSeconds();
        const shift = OMEGA_E * period * R2D;
        const lat = formatAngle(latitudeAt(trackNow), 'N', 'S');
        const lon = formatAngle(longitudeAt(trackNow), 'E', 'W');

        if (state.onePeriod) {
            // Longitudes are signed, east positive, so that the subtraction can be read as written.
            const signed = (deg) => `${deg.toFixed(1).replace('-', '−')}°`;
            const first = longitudeAt(0), next = longitudeAt(trackEnd);
            const fullTurns = Math.round((shift - (first - next)) / 360);
            const subtrahend = next < 0 ? `(${signed(next)})` : signed(next);
            $('res-dl').textContent = `${shift.toFixed(1)}° W`;
            $('work-dl').textContent = `= ${signed(first)} − ${subtrahend}${fullTurns ? ` + ${fullTurns * 360}°` : ''}`;
            $('res-t').textContent = formatPeriod(period);
            $('work-t').textContent = `= ${shift.toFixed(1)}° / (${EARTH_DEG_PER_HOUR.toFixed(2)}°/h) = ${(period / 3600).toFixed(2)} h`;
            $('val-elapsed').textContent = `${(periodElapsed / 3600).toFixed(2)} h`;
            $('val-pos').textContent = `${lat}, ${lon}`;
        } else {
            $('val-period').textContent = formatPeriod(period);
            $('val-shift').textContent = `${shift.toFixed(1)}° W`;
            $('val-max-lat').textContent = `${(i <= 90 ? i : 180 - i).toFixed(1)}°`;
            $('val-lat').textContent = lat;
            $('val-lon').textContent = lon;
            $('val-alt').textContent = `${formatNumber(r - R_E, 0)} km`;
        }

        $('map-title').classList.toggle('circular', isCircular());
        updateCaption(a * (1 - e) - R_E);
    }

    // The caption changes only when the orbit or selection does, so that screen readers
    // are not flooded.
    let captionKey = '';
    function updateCaption(hp) {
        const preset = PRESETS[state.activePreset];
        let title = state.onePeriod ? PERIOD_TITLE : 'Ground track.';
        let body = state.onePeriod ? PERIOD_BODY : INTRO_BODY;
        if (state.selected) {
            [title, body] = CAPTIONS[state.selected];
        } else if (state.presetCaption && preset) {
            title = `${preset.name}.`;
            body = preset.desc;
        }

        const notes = [];
        if (hp < 0) notes.push('This orbit passes through Earth: its perigee is below the surface.');
        if (isEquatorial()) {
            notes.push(state.onePeriod
                ? 'At this inclination the orbit does not cross the equator, so λ₁ and λ₂ are where it would.'
                : 'At this inclination the orbit does not cross the equator, so it has no nodes to mark.');
        }
        const note = notes.join(' ');

        const key = [title, body, note].join('|');
        if (key === captionKey) return;
        captionKey = key;

        hud.textContent = '';
        const titleEl = document.createElement('b');
        titleEl.textContent = title;
        hud.append(titleEl, document.createTextNode(` ${body}`));
        if (note) {
            const noteEl = document.createElement('span');
            noteEl.className = 'hud-note';
            noteEl.textContent = ` ${note}`;
            hud.append(noteEl);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Camera                                                             */
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

    function renderFrame() {
        computeTrack();
        updateCamera();
        update3DScene();
        stars.follow(camera);
        renderer.render(scene, camera);
        drawMap();
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
        const value = spec.wrap
            ? ((raw % 360) + 360) % 360
            : Math.max(spec.min, Math.min(spec.max, raw));
        if (name === 'nu') {
            // Moving the satellite takes time, so Earth turns by the same amount of time. The
            // satellite takes the shorter way around, and the track stays where it is.
            let dM = (meanAnomaly(value, state.e) - meanAnomaly(state.nu, state.e)) % TWO_PI;
            if (dM > Math.PI) dM -= TWO_PI;
            if (dM < -Math.PI) dM += TWO_PI;
            state.theta += (OMEGA_E * dM) / meanMotion(state.a);
            setPlaying(false);
        } else {
            state.activePreset = null;
            $('preset').value = '';
            // In one period, the first crossing stays put while the orbit changes shape.
            if (state.onePeriod) {
                const thetaAtNode = state.theta - OMEGA_E * lastNode().elapsed;
                state[name] = value;
                state.theta = thetaAtNode + OMEGA_E * lastNode().elapsed;
            }
        }
        state[name] = value;
        writeInputs(name);
        dirty = true;
    }

    function setSelected(name) {
        if (state.selected === name) return;
        state.selected = name;
        if (name) state.presetCaption = false;
        document.querySelectorAll('.param').forEach((row) => {
            row.classList.toggle('selected', row.dataset.param === name);
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
        state.theta = 0;
        state.activePreset = key;
        $('preset').value = key;
        dirty = true;
    }

    // The node is fixed in space, so the slice stays near this view for the whole period.
    function faceNode() {
        camView.az = state.raan;
        camView.el = HOME_VIEW.el;
        dirty = true;
    }

    const selectTrackMode = Kit.bindSegmented($('track-mode'), (mode) => {
        const one = mode === 'one';
        if (one && !state.onePeriod) faceNode();
        state.onePeriod = one;
        $('orbits').disabled = one;
        $('orbits-control').classList.toggle('off', one);
        $('stats-orbits').hidden = one;
        $('stats-period').hidden = !one;
        setSelected(null);
        state.presetCaption = false;
        dirty = true;
    });

    $('preset').addEventListener('change', (e) => {
        applyPreset(e.target.value);
        if (state.onePeriod) faceNode();
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
        dirty = true;
    });
    $('reset-view').addEventListener('click', () => {
        camView.az = state.onePeriod ? state.raan : HOME_VIEW.az;
        camView.el = HOME_VIEW.el;
        camView.zoom = 1;
        dirty = true;
    });
    $('speed').addEventListener('input', (e) => {
        state.speed = parseInt(e.target.value, 10);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    $('orbits').addEventListener('input', (e) => {
        state.pastOrbits = parseInt(e.target.value, 10);
        $('orbits-value').textContent = state.pastOrbits;
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
    selectTrackMode('one');
    setPlaying(state.playing);
    $('speed-value').textContent = SPEEDS[state.speed].label;
    statusEl.style.display = 'none';

    // The caption changes length with the selected element. Space is reserved for the longest
    // caption, so that the view does not change size when the selection changes.
    function reserveCaptionSpace() {
        const texts = [['Ground track.', INTRO_BODY], [PERIOD_TITLE, PERIOD_BODY], ...Object.values(CAPTIONS)];
        Object.values(PRESETS).forEach((preset) => texts.push([`${preset.name}.`, preset.desc]));
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

    Kit.observeSize(orbitPane, (w, h) => {
        reserveCaptionSpace();
        viewW = w;
        viewH = h;
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        renderFrame();
    });

    // The map keeps its true 2:1 shape and is centered in whatever space its pane has.
    function redrawMap() {
        drawMapBase();
        drawMap();
    }
    Kit.observeSize(mapPane, (w, h) => {
        mapW = w;
        mapH = h;
        plot.w = Math.min(w, 2 * h);
        plot.h = plot.w / 2;
        plot.x = (w - plot.w) / 2;
        plot.y = (h - plot.h) / 2;
        Kit.fitCanvas2D(map, mapCtx, w, h);
        mapLayer.remeasure();
        redrawMap();
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawMap);
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
            state.theta = (state.theta + (OMEGA_E * TWO_PI * orbitFraction) / meanMotion(state.a)) % TWO_PI;
            dirty = true;
        }

        // Keep drawing while a label glides to a new spot.
        if (mapLayer.settling) dirty = true;

        if (dirty) {
            dirty = false;
            renderFrame();
            updatePanels();
        }
    });
})();
