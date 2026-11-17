/* Relative motion math shared by the RIC tools and Test 2 Practice.
 *
 * Pure functions, no DOM. Internal units: km, km/s, seconds, radians.
 * Public angles are degrees. A state is [x, y, z, vx, vy, vz] in the RIC frame:
 *   x = R, radial, up (away from Earth)
 *   y = I, in-track, forward
 *   z = C, cross-track, left
 * RMOE objects are { xc, yc0, C, M0, zmax, dM0 }; an undefined angle is null.
 * Element objects are { a, e, i, raan, argp, nu } in km and degrees.
 *
 * Two models live here:
 *   the course model  (CW equations and RMOEs; needs a circular target, close spacecraft)
 *   the exact model   (each spacecraft on its own two-body orbit; relativeState)
 */
(function () {
    'use strict';

    const MU = 398600.44;
    const RE = 6378.137;
    const G0 = 9.81;
    const GEO_A = 42164;
    const OMEGA_E = 7.292115e-5;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const TWO_PI = 2 * Math.PI;
    const TINY = 1e-9;

    const ORBITS = {
        geo: { key: 'geo', label: 'GEO', a: 42164, i: 0, raan: 0, ecef: true },
        gps: { key: 'gps', label: 'GPS-type', a: 26562, i: 55, raan: 30, ecef: false },
        leo: { key: 'leo', label: 'LEO', a: 7000, i: 51.6, raan: 30, ecef: false }
    };

    function meanMotion(a) { return Math.sqrt(MU / (a * a * a)); }
    function period(a) { return TWO_PI / meanMotion(a); }
    function wrap360(deg) {
        const w = ((deg % 360) + 360) % 360;
        return w === 360 ? 0 : w;
    }
    function wrap180(deg) {
        const w = wrap360(deg);
        return w > 180 ? w - 360 : w;
    }
    function wrapPi(rad) {
        let w = rad % TWO_PI;
        if (w > Math.PI) w -= TWO_PI;
        if (w <= -Math.PI) w += TWO_PI;
        return w;
    }

    // ---------- vectors ----------
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
    function unit(a) { const m = norm(a); return [a[0] / m, a[1] / m, a[2] / m]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

    // ---------- RMOEs (course model) ----------
    function rmoeFromState(state, n) {
        const [x0, y0, z0, vx, vy, vz] = state;
        const xc = 4 * x0 + 2 * vy / n;
        const yc0 = y0 - 2 * vx / n;
        const C = Math.hypot(xc - x0, vx / n);
        const zmax = Math.hypot(z0, vz / n);
        return {
            xc, yc0, C, zmax,
            M0: C < TINY ? null : wrap360(Math.atan2(vx / n, xc - x0) * R2D),
            dM0: zmax < TINY ? null : wrap360(Math.atan2(z0, vz / n) * R2D)
        };
    }

    function stateFromRmoe(rmoe, n, t) {
        t = t || 0;
        const M = n * t + (rmoe.M0 === null ? 0 : rmoe.M0) * D2R;
        const dM = n * t + (rmoe.dM0 === null ? 0 : rmoe.dM0) * D2R;
        const ycDot = -1.5 * n * rmoe.xc;
        return [
            rmoe.xc - rmoe.C * Math.cos(M),
            rmoe.yc0 + ycDot * t + 2 * rmoe.C * Math.sin(M),
            rmoe.zmax * Math.sin(dM),
            n * rmoe.C * Math.sin(M),
            ycDot + 2 * n * rmoe.C * Math.cos(M),
            n * rmoe.zmax * Math.cos(dM)
        ];
    }

    function rmoeAt(rmoe, n, t) {
        const adv = n * t * R2D;
        return {
            xc: rmoe.xc,
            yc0: rmoe.yc0 - 1.5 * n * rmoe.xc * t,
            C: rmoe.C,
            zmax: rmoe.zmax,
            M0: rmoe.M0 === null ? null : wrap360(rmoe.M0 + adv),
            dM0: rmoe.dM0 === null ? null : wrap360(rmoe.dM0 + adv)
        };
    }

    function driftRate(rmoe, n, aTarget) {
        return {
            kmPerSec: -1.5 * n * rmoe.xc,
            kmPerRev: -3 * Math.PI * rmoe.xc,
            degPerRev: -(540 / aTarget) * rmoe.xc
        };
    }

    // The value of M at the positive plane crossing.
    function planeCrossingM(rmoe) {
        if (rmoe.M0 === null || rmoe.dM0 === null) return null;
        return wrap360(rmoe.M0 - rmoe.dM0);
    }

    function boundaryTable(rmoe, n) {
        const ycDot = -1.5 * n * rmoe.xc;
        const { xc, yc0, C, zmax } = rmoe;
        return {
            inPlane: [
                { name: 'Bottom', angle: 0, x: xc - C, y: yc0, vx: 0, vy: ycDot + 2 * n * C },
                { name: 'Front', angle: 90, x: xc, y: yc0 + 2 * C, vx: n * C, vy: ycDot },
                { name: 'Top', angle: 180, x: xc + C, y: yc0, vx: 0, vy: ycDot - 2 * n * C },
                { name: 'Back', angle: 270, x: xc, y: yc0 - 2 * C, vx: -n * C, vy: ycDot }
            ],
            cross: [
                { name: '+P.C.', angle: 0, z: 0, vz: n * zmax },
                { name: 'Left', angle: 90, z: zmax, vz: 0 },
                { name: '−P.C.', angle: 180, z: 0, vz: -n * zmax },
                { name: 'Right', angle: 270, z: -zmax, vz: 0 }
            ]
        };
    }

    function timeToAngle(nowDeg, targetDeg, n) {
        return wrap360(targetDeg - nowDeg) / 360 * (TWO_PI / n);
    }

    // ---------- CW equations (course model) ----------
    function cwPropagate(state, n, t) {
        const [x0, y0, z0, vx, vy, vz] = state;
        const c = Math.cos(n * t);
        const s = Math.sin(n * t);
        return [
            4 * x0 + 2 * vy / n - (3 * x0 + 2 * vy / n) * c + (vx / n) * s,
            y0 - 2 * vx / n - (3 * vy + 6 * n * x0) * t + (2 * vx / n) * c + (4 * vy / n + 6 * x0) * s,
            z0 * c + (vz / n) * s,
            (3 * n * x0 + 2 * vy) * s + vx * c,
            -(3 * vy + 6 * n * x0) - 2 * vx * s + (4 * vy + 6 * n * x0) * c,
            -n * z0 * s + vz * c
        ];
    }

    function stm(n, t) {
        const c = Math.cos(n * t);
        const s = Math.sin(n * t);
        return {
            rr: [[4 - 3 * c, 0, 0], [6 * (s - n * t), 1, 0], [0, 0, c]],
            rv: [[s / n, 2 * (1 - c) / n, 0], [-2 * (1 - c) / n, (4 * s - 3 * n * t) / n, 0], [0, 0, s / n]],
            vr: [[3 * n * s, 0, 0], [-6 * n * (1 - c), 0, 0], [0, 0, -n * s]],
            vv: [[c, 2 * s, 0], [-2 * s, 4 * c - 3, 0], [0, 0, c]]
        };
    }

    // The velocity needed at r0 to arrive at r1 after time t, or null where no answer exists.
    function transferVelocity(r0, r1, n, t) {
        const m = stm(n, t);
        const bx = r1[0] - (m.rr[0][0] * r0[0]);
        const by = r1[1] - (m.rr[1][0] * r0[0] + r0[1]);
        const bz = r1[2] - m.rr[2][2] * r0[2];
        const a = m.rv[0][0], b = m.rv[0][1], c = m.rv[1][0], d = m.rv[1][1];
        const det = a * d - b * c;                       // (8(1 - cos) - 3 nt sin) / n^2
        if (Math.abs(det) * n * n < 1e-9) return null;
        let vz = 0;
        const sz = m.rv[2][2];                           // sin(nt) / n
        if (Math.abs(sz) * n < 1e-9) {
            if (Math.abs(bz) > 1e-9) return null;
        } else {
            vz = bz / sz;
        }
        return [(d * bx - b * by) / det, (-c * bx + a * by) / det, vz];
    }

    function applyBurn(state, dv) {
        return [state[0], state[1], state[2], state[3] + dv[0], state[4] + dv[1], state[5] + dv[2]];
    }

    // Rules of thumb. Results are km/s; "d" means want minus have.
    const rule = {
        recenter: (n, dyc) => -(n / 2) * dyc,
        resize: (n, dC, xdotSign) => (xdotSign < 0 ? -1 : 1) * n * dC,
        raise: (n, dxc) => (n / 2) * dxc,
        driftOverRevs: (n, dyc, k) => -(n / (6 * Math.PI)) * (dyc / k),
        crossTrack: (n, dzmax, zdotSign) => (zdotSign < 0 ? -1 : 1) * n * dzmax
    };

    // ---------- orbits (exact model) ----------
    function keplerE(M, e) {
        const m = wrapPi(M);
        let E = e >= 0.8 ? Math.PI * (m < 0 ? -1 : 1) : m + e * Math.sin(m);
        for (let k = 0; k < 30; k++) {
            const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
            E -= step;
            if (Math.abs(step) < 1e-13) break;
        }
        return E;
    }

    function meanFromTrue(nuDeg, e) {
        const h = nuDeg * D2R / 2;
        const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(h), Math.sqrt(1 + e) * Math.cos(h));
        return E - e * Math.sin(E);
    }

    function trueFromMean(M, e) {
        const E = keplerE(M, e);
        const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        return wrap360(nu * R2D);
    }

    // The same orbit t seconds later. Always computed from the elements, never stepped.
    function coeAt(coe, t) {
        const M = meanFromTrue(coe.nu, coe.e) + meanMotion(coe.a) * t;
        return { a: coe.a, e: coe.e, i: coe.i, raan: coe.raan, argp: coe.argp, nu: trueFromMean(M, coe.e) };
    }

    function orbitProblem(coe) {
        if (!(coe.a > 0)) return 'a';
        if (!(coe.e >= 0 && coe.e < 0.95)) return 'e';
        if (coe.a * (1 - coe.e) < RE + 100) return 'perigee';
        return null;
    }

    function coesToRv(coe) {
        const i = coe.i * D2R, O = coe.raan * D2R, w = coe.argp * D2R, nu = coe.nu * D2R;
        const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w);
        const ci = Math.cos(i), si = Math.sin(i);
        const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
        const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
        const p = coe.a * (1 - coe.e * coe.e);
        const r = p / (1 + coe.e * Math.cos(nu));
        const k = Math.sqrt(MU / p);
        const cn = Math.cos(nu), sn = Math.sin(nu);
        return {
            r: [r * (cn * P[0] + sn * Q[0]), r * (cn * P[1] + sn * Q[1]), r * (cn * P[2] + sn * Q[2])],
            v: [k * (-sn * P[0] + (coe.e + cn) * Q[0]), k * (-sn * P[1] + (coe.e + cn) * Q[1]), k * (-sn * P[2] + (coe.e + cn) * Q[2])]
        };
    }

    // The RIC axes at time t, as ECI unit vectors, with the target's state and the frame's turn rate.
    function ricBasis(targetCoe, t) {
        const rv = coesToRv(t ? coeAt(targetCoe, t) : targetCoe);
        const h = cross(rv.r, rv.v);
        const R = unit(rv.r);
        const C = unit(h);
        const I = cross(C, R);
        const rr = dot(rv.r, rv.r);
        return { R, I, C, r: rv.r, v: rv.v, omega: norm(h) / rr };
    }

    function ricToEci(rho, basis) {
        return [
            rho[0] * basis.R[0] + rho[1] * basis.I[0] + rho[2] * basis.C[0],
            rho[0] * basis.R[1] + rho[1] * basis.I[1] + rho[2] * basis.C[1],
            rho[0] * basis.R[2] + rho[1] * basis.I[2] + rho[2] * basis.C[2]
        ];
    }

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
        const z = a * (di * Math.sin(u) - dO * Math.sin(i) * Math.cos(u));
        const zDotOverN = a * (di * Math.cos(u) + dO * Math.sin(i) * Math.sin(u));
        const C = chaseCoe.a * chaseCoe.e;
        const zmax = Math.hypot(z, zDotOverN);
        return {
            xc: chaseCoe.a - a,
            yc0: a * (du + dO * Math.cos(i)),
            C,
            zmax,
            M0: C < TINY ? null : wrap360(Mc * R2D),
            dM0: zmax < TINY ? null : wrap360(Math.atan2(z, zDotOverN) * R2D),
            n
        };
    }

    // Exact relative position and its rate in the RIC frame at time t.
    function relativeState(targetCoe, chaseCoe, t) {
        const basis = ricBasis(targetCoe, t);
        const c = coesToRv(t ? coeAt(chaseCoe, t) : chaseCoe);
        const dr = sub(c.r, basis.r);
        const dv = sub(c.v, basis.v);
        const rho = [dot(dr, basis.R), dot(dr, basis.I), dot(dr, basis.C)];
        const w = basis.omega;
        // omega x rho with omega along C is [-w y, w x, 0]. Leaving this out gives the wrong rate.
        const rhoDot = [dot(dv, basis.R) + w * rho[1], dot(dv, basis.I) - w * rho[0], dot(dv, basis.C)];
        return { rho, rhoDot, range: norm(dr), basis, rT: basis.r, rC: c.r };
    }

    function sampleRelative(targetCoe, chaseCoe, t0, t1, count) {
        const out = new Float64Array(count * 3);
        for (let k = 0; k < count; k++) {
            const t = count > 1 ? t0 + (t1 - t0) * k / (count - 1) : t0;
            const rho = relativeState(targetCoe, chaseCoe, t).rho;
            out[3 * k] = rho[0]; out[3 * k + 1] = rho[1]; out[3 * k + 2] = rho[2];
        }
        return out;
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

    function modelFit(targetCoe, maxRangeKm) {
        if (targetCoe.e > 1e-6) return 'na';
        const ratio = maxRangeKm / targetCoe.a;
        if (ratio < 0.01) return 'good';
        if (ratio <= 0.05) return 'fair';
        return 'poor';
    }

    // ---------- description, sampling, plans ----------
    const MOTIONS = {
        '000': ['perch', 'Perch'],
        '100': ['linear-drift', 'Drift'],
        '010': ['stationary-nmc', 'NMC'],
        '110': ['drifting-nmc', 'Drifting NMC'],
        '001': ['cross-track', 'Cross-track motion'],
        '101': ['drifting-cross-track', 'Drift with cross-track motion'],
        '011': ['nmc-cross-track', 'NMC with cross-track motion'],
        '111': ['corkscrew', 'Corkscrew']
    };

    function classifyMotion(rmoe) {
        const eps = Math.max(0.01, 0.002 * Math.max(Math.abs(rmoe.xc), rmoe.C, rmoe.zmax, 1));
        const code = (Math.abs(rmoe.xc) > eps ? '1' : '0') + (rmoe.C > eps ? '1' : '0') + (rmoe.zmax > eps ? '1' : '0');
        const [key, label] = MOTIONS[code];
        if (key === 'perch' && Math.abs(rmoe.yc0) <= eps) return { key, label: 'At the target' };
        return { key, label };
    }

    // Least distance to the target over a coast with no burns.
    function minRange(state, n, revs, samplesPerRev) {
        const count = Math.max(2, Math.round(revs * (samplesPerRev || 64)) + 1);
        const tEnd = revs * TWO_PI / n;
        let least = Infinity;
        for (let k = 0; k < count; k++) {
            const s = cwPropagate(state, n, tEnd * k / (count - 1));
            least = Math.min(least, Math.hypot(s[0], s[1], s[2]));
        }
        return least;
    }

    function sampleTrajectory(rmoe, n, t0, t1, count) {
        const out = new Float64Array(count * 3);
        for (let k = 0; k < count; k++) {
            const t = count > 1 ? t0 + (t1 - t0) * k / (count - 1) : t0;
            const s = stateFromRmoe(rmoe, n, t);
            out[3 * k] = s[0]; out[3 * k + 1] = s[1]; out[3 * k + 2] = s[2];
        }
        return out;
    }

    // Fly a list of burns with CW coasts between them. burns: [{ t seconds, dv: [3] km/s }].
    // legs has one entry per coast that lasts longer than zero: { t0, t1, state0, rmoe }.
    function flyPlan(state0, n, burns, tEnd) {
        const order = burns.map((b, k) => ({ b, k })).sort((p, q) => (p.b.t - q.b.t) || (p.k - q.k)).map(p => p.b);
        const legs = [];
        let state = state0.slice();
        let t = 0;
        let dvTotal = 0;
        function coastTo(t1) {
            if (t1 <= t) return;
            legs.push({ t0: t, t1, state0: state.slice(), rmoe: rmoeFromState(state, n) });
            state = cwPropagate(state, n, t1 - t);
            t = t1;
        }
        order.forEach(b => {
            if (b.t > tEnd) return;
            coastTo(b.t);
            state = applyBurn(state, b.dv);
            dvTotal += Math.hypot(b.dv[0], b.dv[1], b.dv[2]);
        });
        coastTo(tEnd);
        return { state, dvTotal, legs };
    }

    function propellant(massKg, isp, dvMs) {
        return massKg * (1 - Math.exp(-dvMs / (isp * G0)));
    }

    const fmt = {
        km(v) {
            if (v === null || v === undefined || !isFinite(v)) return 'undefined';
            const m = Math.abs(v);
            return v.toFixed(m < 100 ? 3 : m < 1000 ? 2 : 1);
        },
        ms(vKmPerSec) {
            if (vKmPerSec === null || vKmPerSec === undefined || !isFinite(vKmPerSec)) return 'undefined';
            const v = vKmPerSec * 1000;
            return v.toFixed(Math.abs(v) < 10 ? 4 : 3);
        },
        deg(v) {
            if (v === null || v === undefined || !isFinite(v)) return 'undefined';
            return v.toFixed(1);
        },
        signed(v, digits) {
            if (v === null || v === undefined || !isFinite(v)) return 'undefined';
            const text = Math.abs(v).toFixed(digits);
            if (Number(text) === 0) return text;
            return (v < 0 ? '−' : '+') + text;
        }
    };

    const RpoMath = {
        MU, RE, G0, GEO_A, OMEGA_E, D2R, R2D, ORBITS,
        meanMotion, period, wrap360, wrap180,
        rmoeFromState, stateFromRmoe, rmoeAt, driftRate, planeCrossingM, boundaryTable, timeToAngle,
        cwPropagate, stm, transferVelocity, applyBurn, rule,
        keplerE, meanFromTrue, trueFromMean, coeAt, orbitProblem, coesToRv, ricBasis, ricToEci,
        rmoeFromCoes, relativeState, sampleRelative, coeDifference, coeFromDifference, modelFit,
        classifyMotion, minRange, sampleTrajectory, flyPlan, propellant, fmt
    };

    if (typeof window !== 'undefined') window.RpoMath = RpoMath;
    if (typeof module !== 'undefined' && module.exports) module.exports = RpoMath;
})();
