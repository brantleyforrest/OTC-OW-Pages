// shared.js
// The numbers both constant sets use, each with its source: time, the gravity field beyond J2, the
// Sun, Moon and radiation, the atmosphere, the Sun and Moon position series and sidereal time, the
// round figures the lessons print, and limits. The two sets themselves are in course.js and
// wgs84.js beside this file; the solver tableaus are in math/motion/solvers.js. No formula in the
// site declares a physical constant of its own.
//
// Load this first: it starts window.OrbitConstants, which the other constant files add to.
// No DOM. Works in the browser (window.OrbitConstants) and in Node (math/index.js loads it).
(function (global) {
    'use strict';

    if (global.OrbitConstants) throw new Error('shared.js: OrbitConstants is already loaded');

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

    global.OrbitConstants = {
        SETS: {}, TIME, GRAVITY_FIELD, THIRD_BODY, RADIATION, ATMOSPHERE, SUN_SERIES, MOON_SERIES, GMST,
        LESSON, LIMITS, ORBIT_PRESETS
    };
})(typeof window !== 'undefined' ? window : globalThis);
