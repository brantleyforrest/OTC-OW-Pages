// cowell.js
// Cowell's method, the propagator setting's alternative to Kepler: r and v integrated with the
// forces that are on (perturbations.js) by the Runge-Kutta solver the settings choose (tableaus in
// solvers.js), one adaptive stepper for all four.
// No DOM. Load after math/motion/perturbations.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('cowell.js: load math/common.js first');

    /* Cowell's method: Runge-Kutta solvers on r and v --------------------------------------------- */
    OM.define('cowell', ['forces'], function (C, OC, FO) {
        const T = { TABLEAUS: OC.SOLVERS, IDS: OC.SOLVER_IDS, DEFAULT_ID: OC.DEFAULTS.solver };
        const F = FO;   // forces section
        const MAX_STEPS = OC.LIMITS.cowellMaxSteps;

        /* ------------------------------------------------------------------ */
        /* Solver setting (the site settings; default Prince–Dormand 8(7))      */
        /* ------------------------------------------------------------------ */
        function solverIds() { return T.IDS.slice(); }

        // The solver the site settings choose (PD78 unless changed).
        function getSolver() {
            const id = OC.Settings.get().solver;
            return T.TABLEAUS[id] ? id : T.DEFAULT_ID;
        }

        /* ------------------------------------------------------------------ */
        /* Equations of motion                                                */
        /* ------------------------------------------------------------------ */
        // y = [x, y, z, vx, vy, vz]; t = seconds after the start time; returns dy/dt.
        // forces: { j2, j34, j22, drag, sun, moon, srp }, all off unless set true.
        function makeDerivative(constants, forces = {}, spacecraft = {}, epochMs = F.LOAD_TIME_MS) {
            const accel = F.makeAcceleration(forces, constants, spacecraft);
            const jd0 = F.julianDate(epochMs);
            return function (t, y) {
                const a = accel([y[0], y[1], y[2]], [y[3], y[4], y[5]], jd0 + t / 86400);
                return [y[3], y[4], y[5], a[0], a[1], a[2]];
            };
        }

        /* ------------------------------------------------------------------ */
        /* One Runge–Kutta step                                               */
        /* ------------------------------------------------------------------ */
        // k0: the slope at (t, y) if already known (first-same-as-last reuse).
        function rkStep(tab, f, t, y, h, k0) {
            const s = tab.c.length, n = y.length;
            const k = new Array(s);
            k[0] = k0 || f(t, y);
            for (let i = 1; i < s; i++) {
                const yi = y.slice();
                const ai = tab.a[i];
                for (let j = 0; j < i; j++) {
                    const w = h * ai[j];
                    if (w !== 0) for (let m = 0; m < n; m++) yi[m] += w * k[j][m];
                }
                k[i] = f(t + tab.c[i] * h, yi);
            }
            const yNew = y.slice();
            const err = tab.bHat ? new Array(n).fill(0) : null;
            for (let i = 0; i < s; i++) {
                const wb = h * tab.b[i];
                const we = err ? h * (tab.b[i] - tab.bHat[i]) : 0;
                for (let m = 0; m < n; m++) {
                    yNew[m] += wb * k[i][m];
                    if (err) err[m] += we * k[i][m];
                }
            }
            return { y: yNew, err, kFirst: k[0], kLast: k[s - 1], evals: k0 ? s - 1 : s };
        }

        /* ------------------------------------------------------------------ */
        /* Propagate one state by dt seconds (dt may be negative)             */
        /* ------------------------------------------------------------------ */
        // options: constants (required), forces ({} = two-body only), spacecraft (cd, cr, areaToMass,
        //          solar), epoch (start time: Date, ms, or ISO text; default the clock at page load),
        //          solver (the setting), rtol and atol (1e-12), stepsPerOrbit for fixed-step RK4 (1000).
        function propagate(r0, v0, dt, options = {}) {
            const id = options.solver || getSolver();
            const tab = T.TABLEAUS[id];
            if (!tab) throw new Error(`Unknown solver "${id}"`);
            const C = options.constants || {};
            const epochMs = F.toMs(options.epoch);
            const f = makeDerivative(C, options.forces || {}, options.spacecraft || {}, epochMs);
            let y = [r0[0], r0[1], r0[2], v0[0], v0[1], v0[2]];
            const stats = { solver: id, steps: 0, rejected: 0, evals: 0 };
            if (dt === 0) return { r: r0.slice(), v: v0.slice(), ...stats };

            const dir = Math.sign(dt);
            const span = Math.abs(dt);
            const rMag = Math.hypot(r0[0], r0[1], r0[2]);
            const vMag = Math.hypot(v0[0], v0[1], v0[2]);
            const a = 1 / (2 / rMag - vMag * vMag / C.mu);
            // Orbit period for an ellipse; for open orbits, the time scale at the current radius.
            const timeScale = a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / C.mu) : 2 * Math.PI * Math.sqrt(rMag * rMag * rMag / C.mu);

            if (!tab.bHat) {
                const per = options.stepsPerOrbit || 1000;
                const steps = Math.max(1, Math.ceil(span / (timeScale / per)));
                const h = dt / steps;
                let t = 0;
                for (let i = 0; i < steps; i++) {
                    const res = rkStep(tab, f, t, y, h);
                    y = res.y; t += h; stats.evals += res.evals;
                }
                stats.steps = steps;
                return { r: y.slice(0, 3), v: y.slice(3), ...stats };
            }

            const rtol = options.rtol ?? 1e-12;
            const atol = options.atol ?? 1e-12;
            const exponent = 1 / (tab.errOrder + 1);
            let t = 0;
            let h = dir * Math.min(span, timeScale / 100);
            let kFirst = null;
            while (dir * (dt - t) > 0) {
                if (dir * (t + h - dt) > 0) h = dt - t;
                if (stats.steps + stats.rejected > MAX_STEPS) throw new Error('Cowell: too many steps');
                if (Math.abs(h) < 1e-12 * Math.max(1, span)) throw new Error('Cowell: step size underflow');
                const res = rkStep(tab, f, t, y, h, kFirst);
                stats.evals += res.evals;
                let e = 0;
                for (let m = 0; m < 6; m++) {
                    const scale = atol + rtol * Math.max(Math.abs(y[m]), Math.abs(res.y[m]));
                    e = Math.max(e, Math.abs(res.err[m]) / scale);
                }
                if (e <= 1) {
                    t += h; y = res.y; stats.steps++;
                    kFirst = tab.fsal ? res.kLast : null;
                } else {
                    stats.rejected++;
                    kFirst = res.kFirst;                 // same state, so the first slope still holds
                }
                h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(e || 1e-16, -exponent)));
            }
            return { r: y.slice(0, 3), v: y.slice(3), ...stats };
        }

        // States at each time in times (seconds from the start, any order, may be negative).
        // Integrates outward from t = 0 in each direction, so each segment continues the last.
        function trajectory(r0, v0, times, options = {}) {
            const out = new Array(times.length);
            const epochMs = F.toMs(options.epoch);
            const order = times.map((t, i) => i);
            for (const sign of [1, -1]) {
                const idx = order.filter((i) => (sign > 0 ? times[i] >= 0 : times[i] < 0))
                    .sort((i, j) => sign * (times[i] - times[j]));
                let r = r0, v = v0, t = 0;
                for (const i of idx) {
                    const res = propagate(r, v, times[i] - t, { ...options, epoch: epochMs + t * 1000 });
                    r = res.r; v = res.v; t = times[i];
                    out[i] = { t, r, v };
                }
            }
            return out;
        }

        return { solverIds, getSolver, makeDerivative, rkStep, propagate, trajectory };
    });
})(typeof window !== 'undefined' ? window : globalThis);
