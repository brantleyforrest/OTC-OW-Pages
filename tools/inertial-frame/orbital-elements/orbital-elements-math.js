// orbital-elements-math.js
// The Orbital Elements Explorer's own math: classical elements to position and velocity.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('orbital-elements-math.js: load math/common.js first');

    /* Classical orbital elements to position and velocity (Orbital Elements Explorer) ------------- */
    OM.define('coe', ['kepler'], function (C, OC, K) {
        const R_E = C.re;             // km
        const MU = C.mu;              // km^3/s^2
        const OMEGA_E = C.omegaE;     // rad/s, Earth's rotation
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;

        const periodOf = (a) => TWO_PI * Math.sqrt(a * a * a / MU);
        const isEquatorial = (el) => el.i < 0.05 || el.i > 179.95;
        const isCircular = (el) => el.e < 1e-4;

        // Unit vectors in ECI: P toward perigee, Q in the plane 90 deg ahead of P,
        // W along the angular momentum, and n toward the ascending node.
        function orbitBasis(el) {
            const O = el.raan * D2R, inc = el.i * D2R, w = el.argp * D2R;
            const cosO = Math.cos(O), sinO = Math.sin(O);
            const cosi = Math.cos(inc), sini = Math.sin(inc);
            const cosw = Math.cos(w), sinw = Math.sin(w);
            return {
                P: { x: cosO * cosw - sinO * sinw * cosi, y: sinO * cosw + cosO * sinw * cosi, z: sinw * sini },
                Q: { x: -cosO * sinw - sinO * cosw * cosi, y: -sinO * sinw + cosO * cosw * cosi, z: cosw * sini },
                W: { x: sinO * sini, y: -cosO * sini, z: cosi },
                n: { x: cosO, y: sinO, z: 0 }
            };
        }

        // r = p / (1 + e cos nu), km
        const radiusAt = (el, nuDeg) => el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(nuDeg * D2R));

        // u P + v Q
        const inPlane = (basis, u, v) => ({
            x: basis.P.x * u + basis.Q.x * v,
            y: basis.P.y * u + basis.Q.y * v,
            z: basis.P.z * u + basis.Q.z * v
        });

        // ECI position (km) at true anomaly nu (deg).
        function positionAt(el, basis, nuDeg) {
            const r = radiusAt(el, nuDeg), nu = nuDeg * D2R;
            return inPlane(basis, r * Math.cos(nu), r * Math.sin(nu));
        }

        // ECI velocity (km/s): v = sqrt(mu/p) [-sin nu P + (e + cos nu) Q].
        function velocityAt(el, basis, nuDeg) {
            const p = el.a * (1 - el.e * el.e), nu = nuDeg * D2R;
            const k = Math.sqrt(MU / p);
            return inPlane(basis, -k * Math.sin(nu), k * (el.e + Math.cos(nu)));
        }

        // Everything the readouts show for one element set.
        function orbitState(el) {
            const { a, e, nu } = el;
            const basis = orbitBasis(el);
            const r = radiusAt(el, nu);
            return {
                r,
                hp: a * (1 - e) - R_E,
                ha: a * (1 + e) - R_E,
                speed: Math.sqrt(MU * (2 / r - 1 / a)),   // vis-viva
                period: periodOf(a),
                rVec: positionAt(el, basis, nu),
                vVec: velocityAt(el, basis, nu),
                // The north component of h classifies the motion.
                direction: basis.W.z > 1e-6 ? 'Prograde' : basis.W.z < -1e-6 ? 'Retrograde' : 'Polar'
            };
        }
        return { R_E, MU, OMEGA_E, D2R, R2D, TWO_PI, periodOf, isEquatorial, isCircular, orbitBasis, radiusAt, inPlane, positionAt, velocityAt, orbitState };
    });
})(typeof window !== 'undefined' ? window : globalThis);
