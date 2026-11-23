// sun-synchronous-math.js
// The Sun-Synchronous Orbit page's own math: J2 nodal regression and sun-synchronous orbits.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('sun-synchronous-math.js: load math/common.js first');

    /* J2 nodal regression and sun-synchronous orbits (Sun-Synchronous Orbit page) ----------------- */
    OM.define('sunSync', [], function (C, OC) {
        const MU = C.mu;             // km^3/s^2
        const RE = C.re;             // km
        const J2 = C.J2;
        const YEAR_DAYS = OC.TIME.TROPICAL_YEAR_DAYS;
        const DAY_S = OC.TIME.DAY_S;
        const SUN_RATE = 2 * Math.PI / (YEAR_DAYS * DAY_S); // rad/s, mean Sun's motion in right ascension
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;

        const wrap180 = (deg) => ((deg % 360) + 540) % 360 - 180;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        const wrap12 = (hours) => ((hours % 24) + 36) % 24 - 12;

        // RAAN rate: dOmega/dt = -(3/2) J2 n (RE/a)^2 cos i, for e = 0.
        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
        const j2Factor = (a) => 1.5 * J2 * meanMotion(a) * (RE / a) * (RE / a);
        const nodalRate = (a, inc) => -j2Factor(a) * Math.cos(inc);

        // Sun-synchronous: set dOmega/dt equal to the Sun's rate and solve for cos i.
        const sunSyncCos = (a) => -SUN_RATE / j2Factor(a);
        const sunSyncInclination = (a) => Math.acos(sunSyncCos(a));

        // Angles after a number of days, in degrees.
        const sunRightAscension = (days) => days * DAY_S * SUN_RATE * R2D;
        const raanAfter = (raan0Deg, a, inc, days) => raan0Deg + nodalRate(a, inc) * days * DAY_S * R2D;

        // Local time at the node: 12:00 when the node points at the Sun, 15 deg per hour.
        const nodeLocalTime = (raanDeg, sunDeg) => 12 + wrap180(raanDeg - sunDeg) / 15;
        const raanForNodeTime = (hours, sunDeg) => sunDeg + (hours - 12) * 15;

        // Position on a circular orbit of the given radius at argument of latitude u (deg).
        function circularOrbitPosition(radius, raanDeg, inc, uDeg) {
            const raan = raanDeg * D2R, u = uDeg * D2R;
            const ci = Math.cos(inc), si = Math.sin(inc);
            const co = Math.cos(raan), so = Math.sin(raan);
            const cu = Math.cos(u), su = Math.sin(u);
            return {
                x: radius * (co * cu - so * su * ci),
                y: radius * (so * cu + co * su * ci),
                z: radius * su * si
            };
        }
        return { MU, RE, J2, YEAR_DAYS, DAY_S, SUN_RATE, D2R, R2D, wrap180, wrap360, wrap12, meanMotion, j2Factor, nodalRate, sunSyncCos, sunSyncInclination, sunRightAscension, raanAfter, nodeLocalTime, raanForNodeTime, circularOrbitPosition };
    });
})(typeof window !== 'undefined' ? window : globalThis);
