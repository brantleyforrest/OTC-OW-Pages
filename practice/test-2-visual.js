// Test 2 Practice: the shared parts of the picture-choice problems (Visualize and Burn
// Trajectories): the motion names, plot specs, and wrong pictures that differ from the right one in
// something the givens decide. No DOM access. Load after test-review-math.js and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const REVS = 2;

    // The relative motions of the course table, with the names TestReviewMath.rpo.classifyMotion uses.
    const MOTIONS = [
        { value: 'perch', html: 'Perch' },
        { value: 'linear-drift', html: 'Drift' },
        { value: 'stationary-nmc', html: 'NMC' },
        { value: 'drifting-nmc', html: 'Drifting NMC' },
        { value: 'cross-track', html: 'Cross-track motion' },
        { value: 'drifting-cross-track', html: 'Snake' },
        { value: 'nmc-cross-track', html: 'Cross-Track NMC' },
        { value: 'corkscrew', html: 'Corkscrew' }
    ];
    const LABEL = Object.fromEntries(MOTIONS.map(m => [m.value, m.html]));
    // Which RMOEs each motion has: D a drift (x_C), E an ellipse (C), Z a side-to-side swing (z_max).
    const PARTS = {
        perch: '', 'linear-drift': 'D', 'stationary-nmc': 'E', 'drifting-nmc': 'DE',
        'cross-track': 'Z', 'drifting-cross-track': 'DZ', 'nmc-cross-track': 'EZ', corkscrew: 'DEZ'
    };
    const IN_PLANE = ['perch', 'linear-drift', 'stationary-nmc', 'drifting-nmc'];

    const sample = (rmoe, n, count) => M.sampleTrajectory(rmoe, n, 0, REVS * 2 * Math.PI / n, count || 120 * REVS + 1);

    // The same motion with the ellipse stood on end (twice as tall as it is long): a common mistake.
    function tallPath(rmoe, n) {
        const P = sample(rmoe, n), out = new Float64Array(P.length);
        const ydot = -1.5 * n * rmoe.xc;
        for (let k = 0; k < P.length / 3; k++) {
            const t = k / (P.length / 3 - 1) * REVS * 2 * Math.PI / n;
            const yc = rmoe.yc0 + ydot * t;
            out[3 * k] = rmoe.xc + 2 * (P[3 * k] - rmoe.xc);
            out[3 * k + 1] = yc + (P[3 * k + 1] - yc) / 4;
            out[3 * k + 2] = P[3 * k + 2];
        }
        return out;
    }

    // A plot pair: from the left, then from behind. A spec is { rmoe } or, for a drawing no RMOE
    // can make, { path }.
    function pairFor(spec, n) {
        if (spec.path) return [{ path: spec.path, plane: 'left' }, { path: spec.path, plane: 'behind' }];
        return [{ rmoe: spec.rmoe, n, revs: REVS, plane: 'left' }, { rmoe: spec.rmoe, n, revs: REVS, plane: 'behind' }];
    }

    // How far apart two drawings are, in km, over every sampled point.
    function gap(a, b, n) {
        const P = a.path || sample(a.rmoe, n), Q = b.path || sample(b.rmoe, n);
        let worst = 0;
        for (let k = 0; k < P.length; k++) worst = Math.max(worst, Math.abs(P[k] - Q[k]));
        return worst;
    }
    function sizeOf(rmoe) { return Math.max(rmoe.C, Math.abs(rmoe.xc) * 2, rmoe.zmax, Math.abs(rmoe.yc0) / 3, 2); }

    // Wrong pictures. Each differs from the right one in something the givens decide: which way it
    // drifts, the center ahead or behind, where chase starts, the ellipse's shape, or a part of the
    // motion added or left out. Three are picked at random from those that look different.
    function distractors(rmoe, n) {
        const eps = 1e-6;
        const D = Math.abs(rmoe.xc) > eps, E = rmoe.C > eps, Z = rmoe.zmax > eps;
        const size = sizeOf(rmoe);
        const out = [];
        if (D) out.push({ why: 'drift the wrong way', rmoe: { ...rmoe, xc: -rmoe.xc } });
        if (Math.abs(rmoe.yc0) > eps) out.push({ why: 'center on the other side', rmoe: { ...rmoe, yc0: -rmoe.yc0 } });
        if (E) out.push({ why: 'starts on the other side of the ellipse', rmoe: { ...rmoe, M0: M.wrap360(rmoe.M0 + 180) } });
        if (E) out.push({ why: 'ellipse drawn tall', path: tallPath(rmoe, n) });
        if (Z && Math.abs(Math.sin(rmoe.dM0 * Math.PI / 180)) > 0.5) out.push({ why: 'swing starts on the other side', rmoe: { ...rmoe, dM0: M.wrap360(rmoe.dM0 + 180) } });
        if (Z) out.push({ why: 'no cross-track motion', rmoe: { ...rmoe, zmax: 0, dM0: null } });
        else out.push({ why: 'cross-track motion added', rmoe: { ...rmoe, zmax: size * 0.8, dM0: 90 } });
        if (!E) out.push({ why: 'an ellipse added', rmoe: { ...rmoe, C: size * 0.6, M0: 0 } });
        else out.push({ why: 'no ellipse', rmoe: { ...rmoe, C: 0, M0: null } });
        if (!D) out.push({ why: 'a drift added', rmoe: { ...rmoe, xc: size * 0.4 * C2.sign() } });
        // Keep only pictures that look different from the right one and from each other.
        const chosen = [{ rmoe }];
        C2.shuffle(out).forEach(d => {
            if (chosen.length < 4 && chosen.every(c => gap(c, d, n) > 0.1 * size)) chosen.push(d);
        });
        return chosen.slice(1);
    }

    // Four answer choices, A to D: the right picture and three wrong ones, in a random order.
    function plotOptions(rmoe, n) {
        const right = { rmoe };
        const options = C2.shuffle([right].concat(distractors(rmoe, n))).map((spec, k) => ({ value: 'ABCD'[k], plots: pairFor(spec, n), spec }));
        const answer = options.find(o => o.spec === right).value;
        options.forEach(o => { delete o.spec; });
        return { options, answer };
    }

    global.Test2Visual = { REVS, MOTIONS, LABEL, PARTS, IN_PLANE, sample, tallPath, pairFor, gap, plotOptions };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2Visual;
