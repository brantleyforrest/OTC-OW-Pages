// burn-sandbox-math.js
// The RIC Burn Sandbox's own math: burn plans with CW coasts.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('burn-sandbox-math.js: load math/common.js first');

    /* Burn plans with CW coasts (RIC Burn Sandbox) ------------------------------------------------ */
    OM.define('burns', ['rpo'], function (C, OC, M) {

        // Chase's state at t = 0: at rest at the target, on a perch 10 km behind, or on an NMC
        // with C = 5 km starting at the given corner (M0).
        function initialState(start, corner, n) {
            if (start === 'perch') return [0, -10, 0, 0, 0, 0];
            if (start === 'nmc') return M.stateFromRmoe({ xc: 0, yc0: 0, C: 5, M0: corner, zmax: 0, dM0: null }, n, 0);
            return [0, 0, 0, 0, 0, 0];
        }

        // State at time t: the CW coast from the last burn at or before t. Each burn is
        // { t, after } with `after` the state just after it.
        function chaseStateAt(t, start, corner, burns, n) {
            let base = initialState(start, corner, n), tb = 0;
            for (const b of burns) { if (b.t <= t + 1e-9) { base = b.after; tb = b.t; } }
            return M.cwPropagate(base, n, t - tb);
        }

        // Time to coast until the next corner (M = stop) or, for stop = 'pc', the next plane
        // crossing (dM = 0 or 180). null when that angle is undefined. Never less than a sliver.
        function timeToCoastStop(rmoe, stop, n) {
            const P = 2 * Math.PI / n;
            const next = (now, ang) => { let dt = M.timeToAngle(now, ang, n); if (dt < 1e-4 * P) dt += P; return dt; };
            if (stop === 'pc') return rmoe.dM0 === null ? null : Math.min(next(rmoe.dM0, 0), next(rmoe.dM0, 180));
            return rmoe.M0 === null ? null : next(rmoe.M0, Number(stop));
        }

        // Positions along a CW coast from s0 for time T, count + 1 samples, pushed onto out.
        function coastPath(s0, n, T, count, out) {
            for (let k = 0; k <= count; k++) { const s = M.cwPropagate(s0, n, T * k / count); out.push([s[0], s[1], s[2]]); }
            return out;
        }

        // Natural motion: an NMC with C = 5 km, entered from a perch 10 km behind with one
        // radial burn, dV = -(n/2) dy_C.
        function naturalNmc(n) {
            const rmoe = { xc: 0, yc0: 0, C: 5, M0: 270, zmax: 0, dM0: null };
            return {
                path: coastPath(M.stateFromRmoe(rmoe, n, 0), n, 2 * Math.PI / n, 120, []),
                from: [0, -10, 0],
                dv: [M.rule.recenter(n, 10), 0, 0]
            };
        }

        // Forced motion: a circle of the given radius in the R-I plane, flown as `count` CW legs
        // between waypoints, one lap in lapTime. Each burn turns the arrival velocity into the
        // next leg's departure velocity.
        function forcedCircle(n, radius, count, lapTime) {
            const Tc = lapTime / count, pts = [];
            for (let k = 0; k < count; k++) { const f = 2 * Math.PI * k / count; pts.push([-radius * Math.cos(f), radius * Math.sin(f), 0]); }
            const path = [], burns = [];
            let lapDv = 0;
            for (let k = 0; k < count; k++) {
                const prev = pts[(k + count - 1) % count], cur = pts[k], next = pts[(k + 1) % count];
                const vin = M.transferVelocity(prev, cur, n, Tc);
                const arrive = M.cwPropagate([...prev, ...vin], n, Tc);
                const vout = M.transferVelocity(cur, next, n, Tc);
                const dv = [vout[0] - arrive[3], vout[1] - arrive[4], vout[2] - arrive[5]];
                lapDv += Math.hypot(dv[0], dv[1], dv[2]);
                burns.push({ at: cur, dv });
                coastPath([...cur, ...vout], n, Tc, 20, path);
            }
            return { path, burns, lapDv };
        }

        // Forced motion: a teardrop hold at r0, back at r0 after each cycle by one burn there.
        function teardropHold(n, r0, cycle) {
            const v0 = M.transferVelocity(r0, r0, n, cycle);
            const end = M.cwPropagate([...r0, ...v0], n, cycle);
            const dv = [v0[0] - end[3], v0[1] - end[4], v0[2] - end[5]];
            return { path: coastPath([...r0, ...v0], n, cycle, 90, []), dv, cost: Math.hypot(dv[0], dv[1], dv[2]) };
        }
        return { initialState, chaseStateAt, timeToCoastStop, coastPath, naturalNmc, forcedCircle, teardropHold };
    });
})(typeof window !== 'undefined' ? window : globalThis);
