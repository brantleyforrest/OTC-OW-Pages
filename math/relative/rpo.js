// rpo.js
// OrbitMath.rpo, the relative motion section pages use: the CW model (cw.js) and the exact model
// (exact.js) together, with the course's element-difference method (RMOEs from two sets of
// elements and back), the example orbits, and number formatting for the readouts.
// No DOM. Load after math/relative/cw.js and math/relative/exact.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('rpo.js: load math/common.js first');

    /* Relative motion: both models, element differences, formatting -------------------------------- */
    OM.define('rpo', ['vec', 'angles', 'cw', 'exact'], function (C, OC, V, A, CWm, EX) {
        const MU = C.mu;
        const RE = C.re;
        const G0 = C.g0;
        const GEO_A = OC.LESSON.rGeo;
        const OMEGA_E = C.omegaE;
        const { D2R, R2D, TWO_PI, wrap360, wrap180, wrapPi } = A;
        const TINY = 1e-9;
        const ORBITS = OC.ORBIT_PRESETS;
        const { dot } = V;
        const { meanFromTrue, trueFromMean, ricBasis } = EX;

        function meanMotion(a) { return Math.sqrt(MU / (a * a * a)); }
        function period(a) { return TWO_PI / meanMotion(a); }

        // Linear mapping from element differences to RMOEs (the method the course teaches).
        function rmoeFromCoes(targetCoe, chaseCoe) {
            const a = targetCoe.a;
            const n = meanMotion(a);
            const i = targetCoe.i * D2R;
            const u = (targetCoe.argp + targetCoe.nu) * D2R;
            const Mc = meanFromTrue(chaseCoe.nu, chaseCoe.e);
            const du = wrapPi(chaseCoe.argp * D2R + Mc - u);
            const di = (chaseCoe.i - targetCoe.i) * D2R;
            const dO = wrapPi((chaseCoe.raan - targetCoe.raan) * D2R);
            let z, zDotOverN;
            if (Math.abs(Math.sin(i)) < EQUATORIAL) {
                // A (nearly) equatorial target: chase's node can be anywhere, so the small-angle form in
                // di and dO does not hold. Use chase's orbit normal h: z = -a h.R and z'/n = -a h.I,
                // scaled by theta / sin theta (theta the angle between the planes), so a plain
                // inclination difference gives exactly a di sin u, as in the small-angle form.
                const b = ricBasis(targetCoe, 0);
                const h = orbitNormal(chaseCoe);
                const hR = dot(h, b.R), hI = dot(h, b.I), s = Math.min(1, Math.hypot(hR, hI));
                const f = s > 1e-12 ? Math.asin(s) / s : 1;
                z = -a * f * hR;
                zDotOverN = -a * f * hI;
            } else {
                z = a * (di * Math.sin(u) - dO * Math.sin(i) * Math.cos(u));
                zDotOverN = a * (di * Math.cos(u) + dO * Math.sin(i) * Math.sin(u));
            }
            const C = chaseCoe.a * chaseCoe.e;
            const zmax = Math.hypot(z, zDotOverN);
            return {
                xc: chaseCoe.a - a,
                yc0: a * wrapPi(du + dO * Math.cos(i)),
                C,
                zmax,
                M0: C < TINY ? null : wrap360(Mc * R2D),
                dM0: zmax < TINY ? null : wrap360(Math.atan2(z, zDotOverN) * R2D),
                n
            };
        }

        const EQUATORIAL = 0.02;   // |sin i| below this (about 1.1°) counts as an equatorial target
        function orbitNormal(coe) {
            const i = coe.i * D2R, O = coe.raan * D2R;
            return [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
        }

        // The inverse of rmoeFromCoes: chase's elements for a circular target and a set of RMOEs, so
        // that rmoeFromCoes(target, coesFromRmoe(target, rmoe)) gives the same RMOEs back. An
        // undefined M0 or dM0 (null) is taken as 0.
        function coesFromRmoe(targetCoe, rmoe) {
            const a = targetCoe.a;
            const i = targetCoe.i * D2R;
            const u = (targetCoe.argp + targetCoe.nu) * D2R;
            const aC = a + rmoe.xc;
            const eC = rmoe.C / aC;
            const Mc = (rmoe.M0 === null || rmoe.M0 === undefined ? 0 : rmoe.M0) * D2R;
            const dM = (rmoe.dM0 === null || rmoe.dM0 === undefined ? 0 : rmoe.dM0) * D2R;
            const z = rmoe.zmax * Math.sin(dM), zd = rmoe.zmax * Math.cos(dM);
            let iC, raanC;
            if (Math.abs(Math.sin(i)) < EQUATORIAL) {
                // Tilt the target's plane by theta about the line dM behind the target.
                const b = ricBasis(targetCoe, 0);
                const th = Math.min(Math.PI / 2, rmoe.zmax / a), s = Math.sin(th), c = Math.cos(th);
                const Mhat = [0, 1, 2].map(k => Math.sin(dM) * b.R[k] + Math.cos(dM) * b.I[k]);
                const h = [0, 1, 2].map(k => c * b.C[k] - s * Mhat[k]);
                iC = Math.acos(Math.max(-1, Math.min(1, h[2])));
                raanC = Math.hypot(h[0], h[1]) < 1e-12 ? targetCoe.raan * D2R : Math.atan2(h[0], -h[1]);
            } else {
                iC = i + (z * Math.sin(u) + zd * Math.cos(u)) / a;
                raanC = targetCoe.raan * D2R + (zd * Math.sin(u) - z * Math.cos(u)) / (a * Math.sin(i));
            }
            const dO = wrapPi(raanC - targetCoe.raan * D2R);
            const argpC = u + rmoe.yc0 / a - dO * Math.cos(i) - Mc;
            return {
                a: aC, e: eC, i: iC * R2D, raan: wrap360(raanC * R2D),
                argp: wrap360(argpC * R2D), nu: wrap360(trueFromMean(Mc, eC))
            };
        }

        function coeDifference(targetCoe, chaseCoe) {
            return {
                da: chaseCoe.a - targetCoe.a,
                de: chaseCoe.e - targetCoe.e,
                di: chaseCoe.i - targetCoe.i,
                draan: wrap180(chaseCoe.raan - targetCoe.raan),
                dargp: wrap180(chaseCoe.argp - targetCoe.argp),
                dnu: wrap180(chaseCoe.nu - targetCoe.nu)
            };
        }

        function coeFromDifference(targetCoe, diff) {
            return {
                a: targetCoe.a + diff.da,
                e: targetCoe.e + diff.de,
                i: Math.min(180, Math.max(0, targetCoe.i + diff.di)),
                raan: wrap360(targetCoe.raan + diff.draan),
                argp: wrap360(targetCoe.argp + diff.dargp),
                nu: wrap360(targetCoe.nu + diff.dnu)
            };
        }

        // toFixed of a tiny negative number gives '-0.000'; show it as '0.000'.
        const noNegZero = (text) => Number(text) === 0 ? text.replace('-', '') : text;
        const fmt = {
            km(v) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                const m = Math.abs(v);
                return noNegZero(v.toFixed(m < 100 ? 3 : m < 1000 ? 2 : 1));
            },
            ms(vKmPerSec) {
                if (vKmPerSec === null || vKmPerSec === undefined || !isFinite(vKmPerSec)) return 'undefined';
                const v = vKmPerSec * 1000;
                return noNegZero(v.toFixed(Math.abs(v) < 10 ? 4 : 3));
            },
            deg(v) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                return noNegZero(v.toFixed(1));
            },
            signed(v, digits) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                const text = Math.abs(v).toFixed(digits);
                if (Number(text) === 0) return text;
                return (v < 0 ? '−' : '+') + text;
            }
        };

        return {
            MU, RE, G0, GEO_A, OMEGA_E, D2R, R2D, ORBITS,
            meanMotion, period, wrap360, wrap180,
            ...CWm, ...EX,
            rmoeFromCoes, coesFromRmoe, coeDifference, coeFromDifference, fmt
        };
    });
})(typeof window !== 'undefined' ? window : globalThis);
