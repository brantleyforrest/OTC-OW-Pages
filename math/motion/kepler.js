// kepler.js
// The Kepler propagator (the propagator setting's default): exact two-body motion. Closed orbits use
// Kepler's equation in difference form with the f and g functions; open orbits use the
// universal-variable solver. The other choice, Cowell's method, is cowell.js beside this file; the
// setting itself is applied in propagate.js.
// No DOM. Load after math/common.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('kepler.js: load math/common.js first');

    /* Two-body motion: universal variables and Kepler's equation in difference form --------------- */
    OM.define('keplerPropagator', ['vec'], function (C, OC, V) {
        const MU = C.mu, TWO_PI = 2 * Math.PI;
        const { dot, norm, cross, scale, add } = V;

        function c2(psi) {
            if (psi > 1e-6) {
                return (1 - Math.cos(Math.sqrt(psi))) / psi;
            }
            if (psi < -1e-6) {
                const sq = Math.sqrt(-psi);
                return (1 - Math.cosh(sq)) / psi;
            }
            return 0.5;
        }

        function c3(psi) {
            if (psi > 1e-6) {
                const sq = Math.sqrt(psi);
                return (sq - Math.sin(sq)) / (sq * sq * sq);
            }
            if (psi < -1e-6) {
                const sq = Math.sqrt(-psi);
                return (Math.sinh(sq) - sq) / (sq * sq * sq);
            }
            return 1 / 6;
        }

        // Universal-variable Kepler propagation (Vallado's KEPLER algorithm), for any conic.
        function universal(r0, v0, dt, mu = MU) {
            if (Math.abs(dt) < 1e-9) {
                return { r: [r0[0], r0[1], r0[2]], v: [v0[0], v0[1], v0[2]] };
            }

            const r0_mag = norm(r0);
            const v0_mag = norm(v0);
            const r0_dot_v0 = dot(r0, v0);
            const alpha = 2 / r0_mag - (v0_mag * v0_mag) / mu;

            // Starting guess for chi
            let chi;
            if (alpha > 1e-6) {
                // Elliptic
                chi = Math.sqrt(mu) * dt * alpha;
            } else if (alpha < -1e-6) {
                // Hyperbolic
                const a = 1 / alpha;
                const sign_dt = dt >= 0 ? 1 : -1;
                const num = -2 * mu * alpha * dt;
                const den = r0_dot_v0 + sign_dt * Math.sqrt(-mu * a) * (1 - r0_mag * alpha);
                chi = sign_dt * Math.sqrt(-a) * Math.log(Math.max(1e-12, num / den));
            } else {
                // Parabolic
                const h = cross(r0, v0);
                const p = (norm(h) * norm(h)) / mu;
                const s = 0.5 * (Math.PI / 2 - Math.atan(3 * Math.sqrt(mu / (p * p * p)) * dt));
                const w = Math.atan(Math.cbrt(Math.tan(s)));
                chi = Math.sqrt(p) * (2 / Math.tan(2 * w));
            }

            // Newton iterations on chi
            for (let iter = 0; iter < 50; iter++) {
                const psi = chi * chi * alpha;
                const c2_val = c2(psi);
                const c3_val = c3(psi);
                const r = chi * chi * c2_val + (r0_dot_v0 / Math.sqrt(mu)) * chi * (1 - psi * c3_val) + r0_mag * (1 - psi * c2_val);
                // Universal Kepler equation: sqrt(mu) dt = chi^3 c3 + (r0.v0 / sqrt(mu)) chi^2 c2 + r0 chi (1 - psi c3)
                const f_val = Math.sqrt(mu) * dt - Math.pow(chi, 3) * c3_val - (r0_dot_v0 / Math.sqrt(mu)) * chi * chi * c2_val - r0_mag * chi * (1 - psi * c3_val);
                const step = f_val / r;
                chi += step;
                if (Math.abs(step) < 1e-9) break;
            }

            const psi = chi * chi * alpha;
            const c2_val = c2(psi);
            const c3_val = c3(psi);
            const r_mag = chi * chi * c2_val + (r0_dot_v0 / Math.sqrt(mu)) * chi * (1 - psi * c3_val) + r0_mag * (1 - psi * c2_val);

            const f = 1 - (chi * chi * c2_val) / r0_mag;
            const g = dt - (Math.pow(chi, 3) * c3_val) / Math.sqrt(mu);
            const gdot = 1 - (chi * chi * c2_val) / r_mag;
            const fdot = (Math.sqrt(mu) * chi * (psi * c3_val - 1)) / (r_mag * r0_mag);

            const r = add(scale(r0, f), scale(v0, g));
            const v = add(scale(r0, fdot), scale(v0, gdot));

            return { r, v };
        }

        // Two-body motion from (r0, v0) over dt seconds.
        function kepler(r0, v0, dt) {
            if (dt === 0) return { r: r0.slice(), v: v0.slice() };
            const R0 = norm(r0), V0 = norm(v0);
            const alpha = 2 / R0 - V0 * V0 / MU;           // 1/a
            if (!(alpha > 1e-12)) return universal(r0, v0, dt, MU);
            const a = 1 / alpha;
            const n = Math.sqrt(MU * alpha * alpha * alpha);
            const period = TWO_PI / n;
            // Whole turns change nothing, so step over the remainder only.
            let t = dt % period;
            if (t < 0) t += period;
            const dM = n * t;
            const s0 = dot(r0, v0) / Math.sqrt(MU * a);     // e sin E0
            const c0 = 1 - R0 / a;                         // e cos E0
            // dM = dE - c0 sin dE + s0 (1 - cos dE); its slope r/a stays positive, so a Newton step kept
            // inside a bracket always converges.
            const F = (x) => x - c0 * Math.sin(x) + s0 * (1 - Math.cos(x)) - dM;
            let lo = dM - 2, hi = dM + 2;
            let x = dM + (c0 * Math.sin(dM) - s0 * (1 - Math.cos(dM))) ;
            for (let k = 0; k < 60; k++) {
                const f = F(x);
                if (f > 0) hi = Math.min(hi, x); else lo = Math.max(lo, x);
                const slope = 1 - c0 * Math.cos(x) + s0 * Math.sin(x);
                let next = x - f / slope;
                if (!(next > lo && next < hi)) next = (lo + hi) / 2;
                if (Math.abs(next - x) < 1e-15 * Math.max(1, Math.abs(x))) { x = next; break; }
                x = next;
            }
            const cosX = Math.cos(x), sinX = Math.sin(x);
            const f = 1 - (1 - cosX) / (alpha * R0);
            const g = t - (x - sinX) / n;
            const r = [0, 1, 2].map((k) => f * r0[k] + g * v0[k]);
            const R = norm(r);
            const fDot = -Math.sqrt(MU * a) * sinX / (R * R0);
            const gDot = 1 - (1 - cosX) * a / R;
            return { r, v: [0, 1, 2].map((k) => fDot * r0[k] + gDot * v0[k]) };
        }

        return { c2, c3, universal, kepler };
    });
})(typeof window !== 'undefined' ? window : globalThis);
