// propagate.js
// Satellites stored as r and v, moved by the propagator the settings choose: Kepler (kepler.js) or
// Cowell (cowell.js) with cached samples. Every page that draws a moving satellite uses this.
// No DOM. Load after the other files in math/propagation.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('propagate.js: load math/common.js first');

    /* Satellites and propagation ------------------------------------------------------------------ */
    // Every satellite a page draws is stored as { r, v, t, props }: ECI km and km/s at t seconds
    // after the page's start time, and its own spacecraft properties (or null for the settings').
    // stateAt moves it with the propagator the settings choose:
    //   Kepler (default): exact two-body motion. Closed orbits use Kepler's equation in difference
    //     form with the f and g functions, open orbits the universal-variable solver.
    //   Cowell: the settings' solver and forces, from the start time. Short steps are integrated
    //     directly; longer ones read samples integrated once per satellite (SAMPLES_PER_ORBIT per
    //     orbit) and cached, with quintic Hermite interpolation (r, v and acceleration at each end)
    //     between them. The cache starts again when a setting changes.
    OM.define('propagate', ['vec', 'keplerPropagator', 'elements', 'cowell', 'forces'], function (C, OC, V, KP, EL, CW, FO) {
        const MU = C.mu, TWO_PI = 2 * Math.PI;
        const { dot, norm } = V;
        const SAMPLES_PER_ORBIT = 192;
        // The settings, kept current without copying them on every call.
        let model = OC.Settings.get();
        OC.Settings.onChange((s) => { model = s; });
        const startMs = () => (model.startMs === null ? FO.LOAD_TIME_MS : model.startMs);

        function satellite(r, v, t = 0, props = null) {
            return { r: [r[0], r[1], r[2]], v: [v[0], v[1], v[2]], t, props };
        }
        function fromElements(el, t = 0, props = null) {
            const { r, v } = EL.rvFromElements(el);
            return satellite(r, v, t, props);
        }

        // Two-body motion from (r0, v0) over dt seconds (math/propagation/kepler.js).
        const kepler = KP.kepler;

        /* Cowell, with cached samples */
        const grids = new WeakMap();
        function cowellOptions(sat) {
            // RK4 has fixed steps: 2,000 per orbit keeps it within 1 mm of Kepler over a LEO orbit.
            return { constants: C, forces: model.forces, spacecraft: sat.props || model.spacecraft, solver: model.solver, stepsPerOrbit: 2000 };
        }
        // The time to the next sample: a share of the local time scale 2 pi sqrt(r^3 / mu), so samples
        // crowd together near perigee, where the motion bends fastest (one period / SAMPLES_PER_ORBIT
        // on a circle).
        const sampleStep = (r) => TWO_PI * Math.sqrt(Math.pow(norm(r), 3) / MU) / SAMPLES_PER_ORBIT;
        function gridFor(sat) {
            const opts = cowellOptions(sat);
            const key = JSON.stringify([model.forces, model.solver, startMs(), opts.spacecraft]);
            let g = grids.get(sat);
            if (g && g.key === key) return g;
            const epoch0 = startMs() + sat.t * 1000;
            const f = CW.makeDerivative(C, model.forces, opts.spacecraft, epoch0);
            const node = (tt, r, v) => {
                const d = f(tt, [r[0], r[1], r[2], v[0], v[1], v[2]]);
                return { t: tt, r, v, a: [d[3], d[4], d[5]] };
            };
            const first = node(0, sat.r.slice(), sat.v.slice());
            g = { key, opts, epoch0, node, h: sampleStep(sat.r), forward: [first], backward: [first], failed: null };
            grids.set(sat, g);
            return g;
        }
        // Extends the samples in one direction until they pass the time span |dt|.
        function extend(g, list, span, dir) {
            while (Math.abs(list[list.length - 1].t) < span && !g.failed) {
                const last = list[list.length - 1];
                const h = sampleStep(last.r);
                try {
                    const res = CW.propagate(last.r, last.v, dir * h, { ...g.opts, epoch: g.epoch0 + last.t * 1000 });
                    list.push(g.node(last.t + dir * h, res.r, res.v));
                } catch (err) {
                    g.failed = { t: last.t, message: err.message };   // for example, drag brought it down
                }
            }
        }
        // Quintic Hermite between two samples: matches r, v and the acceleration at both ends. v is
        // the derivative of the same curve, so r and v stay consistent.
        function hermite(n0, n1, tt) {
            const h = n1.t - n0.t, s = (tt - n0.t) / h;
            const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s;
            const H = [
                1 - 10 * s3 + 15 * s4 - 6 * s5, s - 6 * s3 + 8 * s4 - 3 * s5, (s2 - 3 * s3 + 3 * s4 - s5) / 2,
                (s3 - 2 * s4 + s5) / 2, -4 * s3 + 7 * s4 - 3 * s5, 10 * s3 - 15 * s4 + 6 * s5
            ];
            const D = [
                -30 * s2 + 60 * s3 - 30 * s4, 1 - 18 * s2 + 32 * s3 - 15 * s4, (2 * s - 9 * s2 + 12 * s3 - 5 * s4) / 2,
                (3 * s2 - 8 * s3 + 5 * s4) / 2, -12 * s2 + 28 * s3 - 15 * s4, 30 * s2 - 60 * s3 + 30 * s4
            ];
            const mix = (W, scale) => [0, 1, 2].map((k) => (W[0] * n0.r[k] + W[1] * h * n0.v[k] + W[2] * h * h * n0.a[k]
                + W[3] * h * h * n1.a[k] + W[4] * h * n1.v[k] + W[5] * n1.r[k]) * scale);
            return { r: mix(H, 1), v: mix(D, 1 / h) };
        }
        function cowell(sat, dt) {
            const g = gridFor(sat);
            if (Math.abs(dt) <= g.h) {
                try {
                    return CW.propagate(sat.r, sat.v, dt, { ...g.opts, epoch: g.epoch0 });
                } catch (err) { /* fall through to the samples, which hold the last good state */ }
            }
            const dir = dt >= 0 ? 1 : -1;
            const list = dir > 0 ? g.forward : g.backward;
            const span = Math.abs(dt);
            extend(g, list, span, dir);
            if (Math.abs(list[list.length - 1].t) < span) {
                // Past the last good sample (the integration failed): the satellite stays there.
                const last = list[list.length - 1];
                return { r: last.r.slice(), v: last.v.slice(), stopped: g.failed };
            }
            // The last sample at or before the span (binary search: samples are not evenly spaced).
            let lo = 0, hi = list.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (Math.abs(list[mid].t) <= span) lo = mid; else hi = mid;
            }
            return hermite(list[lo], list[hi], dt);
        }

        // The propagator the settings choose: 'kepler' or 'cowell'.
        const propagatorName = () => model.propagator;

        // The satellite at time t (seconds after the page's start time).
        function stateAt(sat, t) {
            const dt = t - sat.t;
            const s = model.propagator === 'cowell' ? cowell(sat, dt) : kepler(sat.r, sat.v, dt);
            const out = satellite(s.r, s.v, t, sat.props);
            if (s.stopped) out.stopped = s.stopped;
            return out;
        }
        // The satellite at each time, oldest first.
        const trajectory = (sat, times) => Array.from(times, (t) => stateAt(sat, t));

        // Keeps a page's satellite in step with its sliders. sat(el) rebuilds r and v only when the
        // slider elements change; move(el, dt) moves the satellite on by dt seconds and returns the
        // elements read back from r and v (keeping the sliders' angles where an angle is undefined),
        // so the page can show them. Missing i, raan and argp count as 0 (an orbit drawn in a plane).
        function tracker() {
            let key = '', sat = null;
            const full = (el) => ({ i: 0, raan: 0, argp: 0, ...el });
            const keyOf = (el) => [el.a, el.e, el.i, el.raan, el.argp, el.nu].join();
            return {
                sat(el) {
                    const f = full(el), k = keyOf(f);
                    if (k !== key) { sat = fromElements(f, sat ? sat.t : 0); key = k; }
                    return sat;
                },
                move(el, dt) {
                    const f = full(el);
                    const s = this.sat(f);
                    sat = stateAt(s, s.t + dt);
                    const back = EL.elementsFromRv(sat.r, sat.v, f);
                    // The page's true anomaly: where the satellite sits on the slider orbit (the same
                    // as the osculating value for two-body motion).
                    back.nu = EL.angleOnOrbit(sat.r, f);
                    key = keyOf({ ...f, nu: back.nu });
                    return back;
                },
                // Speed, radius and the other readouts every page shows, from r and v.
                readout(el) {
                    const s = this.sat(el);
                    return { r: norm(s.r), v: norm(s.v), sat: s, elements: EL.elementsFromRv(s.r, s.v, full(el)) };
                }
            };
        }

        return { SAMPLES_PER_ORBIT, satellite, fromElements, kepler, stateAt, trajectory, tracker, propagatorName, startMs };
    });
})(typeof window !== 'undefined' ? window : globalThis);
