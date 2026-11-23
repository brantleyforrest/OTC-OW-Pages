// orbit-equation-math.js
// The Orbital Equation Explorer's own math: orbit shape and speed.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('orbit-equation-math.js: load math/common.js first');

    /* Orbit shape and speed (Orbital Equation Explorer) ------------------------------------------- */
    OM.define('orbit', ['kepler'], function (C, OC, K) {
        const MU = C.mu;           // km^3/s^2
        const R_E = C.re;          // km
        const D2R = Math.PI / 180;
        const TWO_PI = 2 * Math.PI;

        const wrap360 = (deg) => ((deg % 360) + 360) % 360;

        // Orbit equation: r = a(1 - e^2) / (1 + e cos nu)
        const semiLatus = (a, e) => a * (1 - e * e);
        const radiusAt = (a, e, nu) => semiLatus(a, e) / (1 + e * Math.cos(nu * D2R));
        const perigeeRadius = (a, e) => a * (1 - e);
        const apogeeRadius = (a, e) => a * (1 + e);
        const semiMinorAxis = (a, e) => a * Math.sqrt(1 - e * e);

        // Vis-viva and circular speed, km/s
        const orbitSpeed = (r, a) => Math.sqrt(MU * (2 / r - 1 / a));
        const circularSpeed = (r) => Math.sqrt(MU / r);

        // Position in the orbit plane: x toward perigee, y toward nu = 90 deg.
        function positionAt(a, e, nu) {
            const r = radiusAt(a, e, nu);
            return { x: r * Math.cos(nu * D2R), y: r * Math.sin(nu * D2R) };
        }

        // The same ellipse from eccentric anomaly E (rad). Even steps in E give a smooth curve.
        function positionAtEccentric(a, e, E) {
            return { x: a * (Math.cos(E) - e), y: semiMinorAxis(a, e) * Math.sin(E) };
        }

        function orbitValues(a, e, nu) {
            const r = radiusAt(a, e, nu);
            return {
                r,
                rp: perigeeRadius(a, e),
                ra: apogeeRadius(a, e),
                v: orbitSpeed(r, a),
                vc: circularSpeed(r)
            };
        }

        // Mean motion, rad/s.
        const meanMotion = (a) => Math.sqrt(MU / a ** 3);
        return { MU, R_E, D2R, TWO_PI, wrap360, radiusAt, perigeeRadius, apogeeRadius, semiMinorAxis, circularSpeed, positionAt, positionAtEccentric, orbitValues, meanMotion };
    });
})(typeof window !== 'undefined' ? window : globalThis);
