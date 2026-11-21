// orbit-constants.js
// Every number the site's orbital math uses, in one place, each with its source.
// Formulas live in math/orbit-math.js (tools) and math/test-review-math.js (Test 1 and Test 2
// Practice). Neither file declares a physical constant of its own.
//
// Contents
//   1. Constant sets: course (default) and WGS-84
//   2. Time
//   3. Gravity field beyond J2
//   4. Sun, Moon and radiation
//   5. Atmosphere
//   6. Sun and Moon position series, sidereal time
//   7. Solver tableaus for Cowell's method (checked when this file loads)
//   8. Lesson figures used by the Perturbations Explorer
//   9. Thresholds and limits
//  10. Spacecraft and setting defaults
//  11. The settings store: the reader's choices, saved in the browser
// No DOM. Works in the browser (window.OrbitConstants) and in Node (module.exports).
(function (global) {
    'use strict';

    /* 1. Constant sets ------------------------------------------------- */
    // Course: the values on the course equation sheet and lessons.
    // WGS-84: the defining and derived WGS-84 values; g0 is standard gravity.
    const SETS = {
        course: {
            id: 'course', name: 'Course constants',
            mu: 398600.44,            // km^3/s^2, every lesson and the equation sheet
            re: 6378.137,             // km, equation sheet (examples round to 6378)
            J2: 1.08263e-3,           // Perturbations lesson, Test 1 study guide
            omegaE: 7.2921e-5,        // rad/s, one turn per sidereal day as the relative-motion lessons use
            g0: 9.81,                 // m/s^2, propulsion lesson and equation sheet
            J22: 1.8e-6,              // Perturbations lesson
            LON22: -15                // deg east, long axis of the equator, Perturbations lesson
        },
        wgs84: {
            id: 'wgs84', name: 'WGS-84',
            mu: 398600.4418,          // km^3/s^2
            re: 6378.137,             // km
            J2: 1.08262668e-3,
            omegaE: 7.292115e-5,      // rad/s
            g0: 9.80665               // m/s^2, standard gravity
            // J22 and LON22 are added below from the EGM-96 C22 and S22.
        }
    };

    /* 2. Time ---------------------------------------------------------- */
    const TIME = {
        DAY_S: 86400,                 // s, mean solar day
        HOUR_S: 3600,
        TROPICAL_YEAR_DAYS: 365.2422, // days, Sun returns to the same season
        JULIAN_YEAR_DAYS: 365.25,     // days, used by the Perturbations lesson
        JD_UNIX_EPOCH: 2440587.5,     // Julian date of 1970-01-01 00:00 UTC
        JD_J2000: 2451545.0,          // Julian date of 2000-01-01 12:00 TT
        DAYS_PER_CENTURY: 36525
    };

    /* 3. Gravity field beyond J2 (EGM-96, unnormalized) ------------------ */
    const GRAVITY_FIELD = {
        J3: -2.5327e-6,
        J4: -1.6196e-6,
        C22: 1.574460e-6,
        S22: -9.038038e-7
    };
    SETS.wgs84.J22 = Math.hypot(GRAVITY_FIELD.C22, GRAVITY_FIELD.S22);
    SETS.wgs84.LON22 = 0.5 * Math.atan2(GRAVITY_FIELD.S22, GRAVITY_FIELD.C22) * 180 / Math.PI;

    /* 4. Sun, Moon and radiation ----------------------------------------- */
    const THIRD_BODY = {
        muSun: 1.32712440018e11,      // km^3/s^2, IAU
        muMoon: 4902.800066,          // km^3/s^2, DE-430
        AU: 149597870.7               // km, IAU 2012
    };
    const RADIATION = {
        solarConstant: 1361,          // W/m^2 at 1 AU, IAU 2015 nominal
        c: 299792458                  // m/s
    };
    RADIATION.P_SUN = RADIATION.solarConstant / RADIATION.c;   // N/m^2 at 1 AU

    /* 5. Atmosphere ------------------------------------------------------- */
    // Piecewise exponential mean atmosphere: [h0 km, rho0 kg/m^3, H km], the Perturbations lesson's figure.
    const ATMOSPHERE = {
        DENSITY: [
            [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554],
            [50, 1.057e-3, 8.382], [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799],
            [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473],
            [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523], [180, 5.464e-10, 29.740],
            [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
            [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
            [700, 3.614e-14, 88.667], [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00]
        ],
        // Density scale for solar activity (Perturbations lesson).
        SOLAR: { min: 0.4, mean: 1.0, max: 2.5 },
        // Area-to-mass presets, m^2/kg (Perturbations lesson).
        AREA: { feathered: 0.004, nominal: 0.01, windmill: 0.03 }
    };

    /* 6. Sun and Moon position series, sidereal time ---------------------- */
    // Low-precision Sun (Astronomical Almanac): angles in degrees, n = days from J2000.
    const SUN_SERIES = {
        L: [280.460, 0.9856474],      // mean longitude: L0 + L1 n
        g: [357.528, 0.9856003],      // mean anomaly: g0 + g1 n
        lon: [1.915, 0.020],          // lambda = L + lon0 sin g + lon1 sin 2g
        eps: [23.439, -0.0000004],    // obliquity: eps0 + eps1 n
        R: [1.00014, -0.01671, -0.00014]  // AU: R0 + R1 cos g + R2 cos 2g
    };
    // Low-precision Moon (Astronomical Almanac): T = Julian centuries from J2000; each term [amp, phase, rate].
    const MOON_SERIES = {
        lonBase: [218.32, 481267.881],
        lonSin: [[6.29, 135.0, 477198.87], [-1.27, 259.3, -413335.36], [0.66, 235.7, 890534.22],
            [0.21, 269.9, 954397.74], [-0.19, 357.5, 35999.05], [-0.11, 186.5, 966404.03]],
        latSin: [[5.13, 93.3, 483202.02], [0.28, 228.2, 960400.89], [-0.28, 318.3, 6003.15],
            [-0.17, 217.6, -407332.21]],
        parallaxBase: 0.9508,
        parallaxCos: [[0.0518, 135.0, 477198.87], [0.0095, 259.3, -413335.36], [0.0078, 235.7, 890534.22],
            [0.0028, 269.9, 954397.74]],
        cosEps: 0.9175,               // ecliptic to equator, the series' own rounded obliquity
        sinEps: 0.3978,
        parallaxRadius: 6378.14       // km, the Earth radius the parallax series is built on
    };
    // Greenwich mean sidereal time (IAU 1982), degrees: c0 + c1 d + c2 T^2 + c3 T^3.
    const GMST = [280.46061837, 360.98564736629, 0.000387933, -1 / 38710000];

    /* 7. Solver tableaus for Cowell's method -------------------------------- */
    // c: stage times; a[i][j]: stage weights; b: kept solution; bHat: embedded estimate (none = fixed step);
    // fsal: last stage equals the next step's first.
    const SOLVERS = {
        PD78: {
            name: 'Prince–Dormand 8(7)',
            source: 'Prince & Dormand (1981), RK8(7)13M; GMAT PrinceDormand78',
            order: 8, errOrder: 7, fsal: false,
            c: [0, 1 / 18, 1 / 12, 1 / 8, 5 / 16, 3 / 8, 59 / 400, 93 / 200,
                5490023248 / 9719169821, 13 / 20, 1201146811 / 1299019798, 1, 1],
            a: [
                [],
                [1 / 18],
                [1 / 48, 1 / 16],
                [1 / 32, 0, 3 / 32],
                [5 / 16, 0, -75 / 64, 75 / 64],
                [3 / 80, 0, 0, 3 / 16, 3 / 20],
                [29443841 / 614563906, 0, 0, 77736538 / 692538347, -28693883 / 1125000000,
                    23124283 / 1800000000],
                [16016141 / 946692911, 0, 0, 61564180 / 158732637, 22789713 / 633445777,
                    545815736 / 2771057229, -180193667 / 1043307555],
                [39632708 / 573591083, 0, 0, -433636366 / 683701615, -421739975 / 2616292301,
                    100302831 / 723423059, 790204164 / 839813087, 800635310 / 3783071287],
                [246121993 / 1340847787, 0, 0, -37695042795 / 15268766246, -309121744 / 1061227803,
                    -12992083 / 490766935, 6005943493 / 2108947869, 393006217 / 1396673457,
                    123872331 / 1001029789],
                [-1028468189 / 846180014, 0, 0, 8478235783 / 508512852, 1311729495 / 1432422823,
                    -10304129995 / 1701304382, -48777925059 / 3047939560, 15336726248 / 1032824649,
                    -45442868181 / 3398467696, 3065993473 / 597172653],
                [185892177 / 718116043, 0, 0, -3185094517 / 667107341, -477755414 / 1098053517,
                    -703635378 / 230739211, 5731566787 / 1027545527, 5232866602 / 850066563,
                    -4093664535 / 808688257, 3962137247 / 1805957418, 65686358 / 487910083],
                [403863854 / 491063109, 0, 0, -5068492393 / 434740067, -411421997 / 543043805,
                    652783627 / 914296604, 11173962825 / 925320556, -13158990841 / 6184727034,
                    3936647629 / 1978049680, -160528059 / 685178525, 248638103 / 1413531060, 0]
            ],
            b: [14005451 / 335480064, 0, 0, 0, 0, -59238493 / 1068277825, 181606767 / 758867731,
                561292985 / 797845732, -1041891430 / 1371343529, 760417239 / 1151165299,
                118820643 / 751138087, -528747749 / 2220607170, 1 / 4],
            bHat: [13451932 / 455176623, 0, 0, 0, 0, -808719846 / 976000145, 1757004468 / 5645159321,
                656045339 / 265891186, -3867574721 / 1518517206, 465885868 / 322736535,
                53011238 / 667516719, 2 / 45, 0]
        },
        DP45: {
            name: 'Prince–Dormand 4(5)',
            source: 'Dormand & Prince (1980), RK5(4)7M; MATLAB ode45; GMAT PrinceDormand45',
            order: 5, errOrder: 4, fsal: true,
            c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
            a: [
                [],
                [1 / 5],
                [3 / 40, 9 / 40],
                [44 / 45, -56 / 15, 32 / 9],
                [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
                [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
                [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
            ],
            b: [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0],
            bHat: [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40]
        },
        RKF45: {
            name: 'Runge–Kutta–Fehlberg 4(5)',
            source: 'Fehlberg (1969), NASA TR R-315; the 5th-order solution is kept',
            order: 5, errOrder: 4, fsal: false,
            c: [0, 1 / 4, 3 / 8, 12 / 13, 1, 1 / 2],
            a: [
                [],
                [1 / 4],
                [3 / 32, 9 / 32],
                [1932 / 2197, -7200 / 2197, 7296 / 2197],
                [439 / 216, -8, 3680 / 513, -845 / 4104],
                [-8 / 27, 2, -3544 / 2565, 1859 / 4104, -11 / 40]
            ],
            b: [16 / 135, 0, 6656 / 12825, 28561 / 56430, -9 / 50, 2 / 55],
            bHat: [25 / 216, 0, 1408 / 2565, 2197 / 4104, -1 / 5, 0]
        },
        RK4: {
            name: 'Runge–Kutta 4 (fixed step)',
            source: 'Classic fourth-order Runge–Kutta; no error estimate, so the step is fixed',
            order: 4, errOrder: null, fsal: false,
            c: [0, 1 / 2, 1 / 2, 1],
            a: [[], [1 / 2], [0, 1 / 2], [0, 0, 1]],
            b: [1 / 6, 1 / 3, 1 / 3, 1 / 6]
        }
    };
    const SOLVER_IDS = ['PD78', 'DP45', 'RKF45', 'RK4'];

    // Problems with a tableau; empty when consistent (rows of a sum to c; b and bHat sum to 1).
    function validateTableau(t) {
        const problems = [];
        const sum = (row) => row.reduce((s, x) => s + x, 0);
        const close = (x, y) => Math.abs(x - y) <= 1e-13;
        const s = t.c.length;
        if (t.a.length !== s || t.b.length !== s || (t.bHat && t.bHat.length !== s)) problems.push('lengths of c, a, b, bHat differ');
        t.a.forEach((row, i) => {
            if (row.length !== i) problems.push(`row ${i} of a has ${row.length} entries, want ${i}`);
            if (!close(sum(row), t.c[i])) problems.push(`row ${i} of a sums to ${sum(row)}, c is ${t.c[i]}`);
        });
        if (!close(sum(t.b), 1)) problems.push(`b sums to ${sum(t.b)}`);
        if (t.bHat && !close(sum(t.bHat), 1)) problems.push(`bHat sums to ${sum(t.bHat)}`);
        if (!!t.bHat !== (t.errOrder !== null)) problems.push('bHat and errOrder disagree');
        if (t.fsal) {
            const last = t.a[s - 1];
            if (t.c[s - 1] !== 1 || !last.every((x, j) => close(x, t.b[j])) || t.b[s - 1] !== 0) problems.push('fsal set but the last stage is not the solution');
        }
        return problems;
    }
    for (const id of SOLVER_IDS) {
        const problems = validateTableau(SOLVERS[id]);
        if (problems.length) throw new Error(`orbit-constants.js: solver ${id} is inconsistent: ${problems.join('; ')}`);
    }

    /* 8. Lesson figures used by the Perturbations Explorer -------------------- */
    // Round figures the Perturbations lesson prints, so the page reproduces its worked examples.
    const LESSON = {
        rGeo: 42164,                  // km, GEO radius used in course problems
        nGeo: 7.29212e-5,             // rad/s, equation sheet's GEO mean motion
        muMoon: 4902.8,               // km^3/s^2
        dMoon: 384400,                // km, mean Earth-Moon distance
        muSun: 132712440018,          // km^3/s^2
        dSun: 149597870,              // km
        pSun: 4.54e-6,                // N/m^2 at 1 AU
        cd: 2.2,
        cr: 1.3,
        geoTiltPeriodYears: 53,       // GEO inclination cycle with no stationkeeping
        ssoRateDegPerDay: 0.9856,     // Sun's apparent motion
        criticalInc: [63.4349, 116.5651],
        stableLon: [75, -105],
        unstableLon: [-15, 165],
        moonPeakAccelGeo: 8.68e-6,    // m/s^2, the Moon's peak differential pull at GEO
        eastWestDvPerYear: 1.715,     // m/s per year, printed stationkeeping budget
        earthDegPerHour: 15,          // Earth's turn under a ground track, the course's rounded rate
        rendezvousExample: { mu: 398600.44, re: 6378.0 },  // rounded values in the rendezvous lesson's worked examples
        obliquityDeg: 23.44,          // Earth's axial tilt
        geoTiltMaxDeg: 15,            // peak GEO inclination over the tilt cycle
        northSouthDv: { moon: 36.9, sun: 14.5, total: 51.4 },  // m/s per year, the lesson's SMAD table
        areaSrp: { dense: 0.01, arrays: 0.04, foil: 5 }       // A/m presets for SRP, m^2/kg
    };

    /* 9. Thresholds and limits ------------------------------------------------ */
    const LIMITS = {
        minSafeAltitude: 100,         // km, rendezvous plans below this are rejected
        reentryAltitude: 100,         // km, a drag decay history ends when perigee falls this low
        decayCapYears: 200,           // drag decay histories stop here
        cowellMaxSteps: 1e6
    };

    // Example orbits the relative-motion tools offer (radius km, angles deg).
    const ORBIT_PRESETS = {
        geo: { key: 'geo', label: 'GEO', a: 42164, i: 0, raan: 0, ecef: true },
        gps: { key: 'gps', label: 'MEO', a: 26562, i: 55, raan: 30, ecef: false },
        leo: { key: 'leo', label: 'LEO', a: 7000, i: 51.6, raan: 30, ecef: false }
    };

    /* 10. Spacecraft and setting defaults ------------------------------------- */
    const SPACECRAFT = { cd: 2.2, cr: 1.3, areaToMass: 0.01, solar: 'mean' };
    const FORCE_IDS = ['j2', 'j34', 'j22', 'drag', 'sun', 'moon', 'srp'];
    const DEFAULTS = {
        constants: 'course',
        propagator: 'kepler',
        solver: 'PD78',
        forces: { j2: false, j34: false, j22: false, drag: false, sun: false, moon: false, srp: false },
        ricModel: 'cw',
        ricAxes: 'rectilinear',
        cwOverlay: false
    };
    const STORAGE_KEY = 'otc-orbit-settings';
    // The choices each setting allows; anything else read from storage or a link falls back to the default.
    const CHOICES = {
        constants: Object.keys(SETS),
        propagator: ['kepler', 'cowell'],
        solver: SOLVER_IDS,
        ricModel: ['cw', 'exact'],
        ricAxes: ['rectilinear', 'curvilinear']
    };

    /* 11. The settings store ---------------------------------------------------- */
    // One copy of the reader's choices for the whole site, saved in browser storage. A page opened
    // from a shared link uses the link's choices for that visit only: nothing is saved until the
    // reader keeps them. The start time is never saved: each visit starts at the computer clock
    // (null) unless one is typed or comes from a link.
    function normalizeSettings(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        for (const [key, allowed] of Object.entries(CHOICES)) {
            out[key] = allowed.includes(src[key]) ? src[key] : DEFAULTS[key];
        }
        const forces = src.forces && typeof src.forces === 'object' ? src.forces : {};
        out.forces = {};
        for (const id of FORCE_IDS) out.forces[id] = forces[id] === true;
        out.cwOverlay = src.cwOverlay === true;
        const ms = typeof src.startMs === 'number' ? src.startMs : Date.parse(src.startMs);
        out.startMs = Number.isFinite(ms) ? ms : null;
        // Spacecraft properties for drag and solar radiation pressure, used by every satellite on the
        // page that has none of its own. Like the start time, they last for the visit (or come from a
        // link) and are not saved.
        const sc = src.spacecraft && typeof src.spacecraft === 'object' ? src.spacecraft : {};
        const within = (x, lo, hi, fallback) => (typeof x === 'number' && x >= lo && x <= hi ? x : fallback);
        out.spacecraft = {
            cd: within(sc.cd, 0.5, 5, SPACECRAFT.cd),
            cr: within(sc.cr, 1, 2, SPACECRAFT.cr),
            areaToMass: within(sc.areaToMass, 1e-4, 1, SPACECRAFT.areaToMass),
            solar: sc.solar in ATMOSPHERE.SOLAR ? sc.solar : SPACECRAFT.solar
        };
        return out;
    }
    const sameSettings = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const Settings = (function () {
        const listeners = [];
        let shared = false;
        function storage() {
            // Browsers only: Node has no page to remember settings for.
            if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
            try { return global.localStorage || null; } catch (err) { return null; }
        }
        function load() {
            try {
                const s = storage();
                const text = s && s.getItem(STORAGE_KEY);
                return normalizeSettings(text ? JSON.parse(text) : null);
            } catch (err) { return normalizeSettings(null); }
        }
        function save() {
            if (shared) return;
            try {
                const s = storage();
                if (!s) return;
                const { startMs, spacecraft, ...kept } = current;   // the start time and spacecraft are never saved
                s.setItem(STORAGE_KEY, JSON.stringify(kept));
            } catch (err) { /* storage blocked: the choice lasts for this visit */ }
        }
        let current = load();

        // Calls each listener with (settings, changedKeys).
        function emit(before) {
            const changed = Object.keys(current).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(before[k]));
            if (!changed.length) return;
            const copy = get();
            for (const fn of listeners.slice()) {
                try { fn(copy, changed); } catch (err) { console.error(err); }
            }
        }
        function get() { return JSON.parse(JSON.stringify(current)); }
        function set(patch) {
            const before = current;
            const forces = { ...current.forces, ...((patch && patch.forces) || {}) };
            current = normalizeSettings({ ...current, ...patch, forces });
            save();
            emit(before);
        }
        function reset() {
            const before = current;
            current = normalizeSettings({ ...DEFAULTS, startMs: null });
            save();
            emit(before);
        }
        function onChange(fn) {
            listeners.push(fn);
            return () => { const k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); };
        }
        // A shared link's settings, for this visit only.
        function useShared(raw) {
            const before = current;
            shared = true;
            current = normalizeSettings(raw);
            emit(before);
        }
        function keepShared() { shared = false; save(); }
        const isShared = () => shared;
        const isDefault = () => sameSettings(normalizeSettings({ ...DEFAULTS, startMs: current.startMs }), current);
        const active = () => SETS[current.constants];
        const startMs = () => current.startMs;
        return { get, set, reset, onChange, useShared, keepShared, isShared, isDefault, active, startMs, normalize: normalizeSettings };
    })();

    const OrbitConstants = {
        SETS, TIME, GRAVITY_FIELD, THIRD_BODY, RADIATION, ATMOSPHERE, SUN_SERIES, MOON_SERIES, GMST,
        SOLVERS, SOLVER_IDS, validateTableau, LESSON, LIMITS, ORBIT_PRESETS, SPACECRAFT, FORCE_IDS, DEFAULTS,
        STORAGE_KEY, CHOICES, Settings,
        active: Settings.active
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = OrbitConstants;
    global.OrbitConstants = OrbitConstants;
})(typeof window !== 'undefined' ? window : globalThis);
