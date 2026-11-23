// mechanical-energy-math.js
// The Mechanical Energy Explorer's own math: specific mechanical energy.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('mechanical-energy-math.js: load math/common.js first');

    /* Specific mechanical energy (Mechanical Energy Explorer) ------------------------------------- */
    OM.define('energy', ['kepler'], function (C, OC, K) {
        const MU = C.mu;           // km^3/s^2
        const RE = C.re;           // km
        const D2R = Math.PI / 180;
        const TWO_PI = 2 * Math.PI;

        const wrap = (angle) => ((angle % TWO_PI) + TWO_PI) % TWO_PI;

        // The orbit set by perigee and apogee altitudes (km).
        function orbitFromAltitudes(hp, ha) {
            const Rp = RE + hp;
            const Ra = RE + ha;
            const a = (Ra + Rp) / 2;
            const e = (Ra - Rp) / (Ra + Rp);
            const p = a * (1 - e * e);                       // semi-latus rectum
            const eps = -MU / (2 * a);                       // specific mechanical energy
            const period = TWO_PI * Math.sqrt(a * a * a / MU);
            const speedAt = (R) => Math.sqrt(Math.max(0, 2 * (MU / R + eps)));   // energy equation
            return { Rp, Ra, a, e, p, eps, period, Vp: speedAt(Rp), Va: speedAt(Ra), speedAt };
        }

        // Kepler's equation, M = E - e sin E, solved for E (shared solver).
        const eccentricAnomaly = K.solve;

        function trueFromMean(M, e) {
            const E = eccentricAnomaly(M, e);
            return wrap(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(Math.max(1e-12, 1 - e)) * Math.cos(E / 2)));
        }

        function meanFromTrue(nu, e) {
            const E = 2 * Math.atan2(Math.sqrt(Math.max(1e-12, 1 - e)) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
            return wrap(E - e * Math.sin(E));
        }

        // Point on the ellipse from eccentric anomaly E, perigee along +x. Even steps in E draw a smooth curve.
        function ellipsePoint(o, E) {
            return { x: o.a * (Math.cos(E) - o.e), y: o.a * Math.sqrt(Math.max(0, 1 - o.e * o.e)) * Math.sin(E) };
        }

        // State at true anomaly nu, in the orbit plane with perigee along +x.
        // Velocity components: v = sqrt(mu/p) [-sin nu, e + cos nu].
        function pointAt(o, nu) {
            const R = o.p / (1 + o.e * Math.cos(nu));
            const vScale = Math.sqrt(MU / Math.max(1e-6, o.p));
            const V = o.speedAt(R);
            return {
                nu, R, V,
                x: R * Math.cos(nu),
                y: R * Math.sin(nu),
                vx: -vScale * Math.sin(nu),
                vy: vScale * (o.e + Math.cos(nu)),
                ke: V * V / 2,      // specific kinetic energy
                pe: -MU / R         // specific potential energy
            };
        }
        // Mean motion, rad/s; and the specific kinetic and potential energy at radius R, speed V.
        const meanMotion = (a) => Math.sqrt(MU / a ** 3);
        const energies = (R, V) => ({ ke: V * V / 2, pe: -MU / R });
        return { MU, RE, D2R, TWO_PI, wrap, orbitFromAltitudes, eccentricAnomaly, trueFromMean, meanFromTrue, ellipsePoint, pointAt, meanMotion, energies };
    });
})(typeof window !== 'undefined' ? window : globalThis);
