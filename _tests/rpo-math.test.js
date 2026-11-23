// Run with: node _tests/rpo-math.test.js
// Checks the relative-motion math (math/relative, section rpo) against values that were worked out and verified separately.
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('./load-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const M = OM.bind(TEST_SET).rpo;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
function near(got, want, tol, what) {
    assert.ok(Math.abs(got - want) <= tol, `${what || 'value'}: got ${got}, want ${want} (tolerance ${tol})`);
}
function nearVec(got, want, tol, what) {
    want.forEach((w, k) => near(got[k], w, tol, `${what || 'vector'}[${k}]`));
}
function nearAngle(got, want, tol, what) {
    if (want === null) { assert.strictEqual(got, null, `${what}: want undefined`); return; }
    assert.notStrictEqual(got, null, `${what}: got undefined`);
    near(Math.abs(M.wrap180(got - want)), 0, tol, what);
}
// Small fixed-seed generator, so a failure repeats.
let seed = 12345;
function rnd(lo, hi) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return lo + (hi - lo) * seed / 4294967296;
}
const ms = v => v.map(x => x / 1000);            // m/s to km/s
const nGeo = M.meanMotion(42164);
const PGeo = M.period(42164);

check('reference numbers', () => {
    near(nGeo, 7.29216e-5, 1e-9); near(PGeo, 86163.6, 0.1);
    near(M.meanMotion(7000), 1.07801e-3, 1e-8); near(M.period(6517.16), 5235.99, 0.01);
});

check('state to RMOEs at GEO', () => {
    const rows = [
        [[2, 6, -2], [0.145843, -0.218765, 0], [2, 2, 2, 90, 2, 270, -18.850]],
        [[-2, -1, 0], [0, 0.291686, -0.145843], [0, -1, 2, 0, 2, 180, 0]],
        [[0, 7, 0], [0, 0.036460, 0], [1, 7, 1, 0, 0, null, -9.425]],
        [[-2, -11, 0], [-0.2917, 0.2188, -0.3646], [-1.999, -3, 4, 270, 5, 180, 18.84]]
    ];
    rows.forEach(([r, v, w], k) => {
        const e = M.rmoeFromState(r.concat(ms(v)), nGeo);
        near(e.xc, w[0], 0.003, `row ${k} xc`); near(e.yc0, w[1], 0.003, `row ${k} yc0`);
        near(e.C, w[2], 0.003, `row ${k} C`); nearAngle(e.M0, w[3], 0.1, `row ${k} M0`);
        near(e.zmax, w[4], 0.003, `row ${k} zmax`); nearAngle(e.dM0, w[5], 0.1, `row ${k} dM0`);
        near(M.driftRate(e, nGeo, 42164).kmPerRev, w[6], 0.02, `row ${k} drift`);
    });
});

check('RMOEs to state at GEO', () => {
    const e = { xc: -2, yc0: 0, C: 18, M0: 0, zmax: 10, dM0: 0 };
    const s0 = M.stateFromRmoe(e, nGeo, 0);
    nearVec(s0, [-20, 0, 0], 1e-9); nearVec(s0.slice(3).map(x => x * 1000), [0, 2.843942, 0.729216], 1e-5);
    const q = M.stateFromRmoe(e, nGeo, PGeo / 4);
    nearVec(q, [-2, 40.7124, 10], 1e-3); nearVec(q.slice(3).map(x => x * 1000), [1.3126, 0.2188, 0], 1e-3);
    nearVec(M.stateFromRmoe(e, nGeo, PGeo / 2), [16, 9.4248, 0], 1e-3);
    nearVec(M.stateFromRmoe(e, nGeo, PGeo), [-20, 18.8496, 0], 1e-3);
});

check('round trip state -> RMOEs -> state, 500 states', () => {
    for (let k = 0; k < 500; k++) {
        const n = M.meanMotion(rnd(6600, 45000));
        const s = [rnd(-50, 50), rnd(-200, 200), rnd(-50, 50), rnd(-0.01, 0.01), rnd(-0.01, 0.01), rnd(-0.01, 0.01)];
        nearVec(M.stateFromRmoe(M.rmoeFromState(s, n), n, 0), s, 1e-9, `state ${k}`);
    }
});

check('CW closed form = RMOE propagation = matrices', () => {
    for (let k = 0; k < 200; k++) {
        const n = M.meanMotion(rnd(6600, 45000));
        const s = [rnd(-20, 20), rnd(-80, 80), rnd(-20, 20), rnd(-0.005, 0.005), rnd(-0.005, 0.005), rnd(-0.005, 0.005)];
        const t = rnd(0, 3) * 2 * Math.PI / n;
        const cw = M.cwPropagate(s, n, t);
        nearVec(M.stateFromRmoe(M.rmoeFromState(s, n), n, t), cw, 1e-9, `rmoe ${k}`);
        const m = M.stm(n, t);
        const mul = (A, B, v, w) => A.map((row, r) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2] + B[r][0] * w[0] + B[r][1] * w[1] + B[r][2] * w[2]);
        const r0 = s.slice(0, 3), v0 = s.slice(3);
        nearVec(mul(m.rr, m.rv, r0, v0).concat(mul(m.vr, m.vv, r0, v0)), cw, 1e-9, `stm ${k}`);
        const later = M.rmoeFromState(cw, n), adv = M.rmoeAt(M.rmoeFromState(s, n), n, t);
        near(later.yc0 - (-1.5 * n * later.xc) * t, M.rmoeFromState(s, n).yc0, 1e-6, 'center');
        nearAngle(later.M0, adv.M0, 1e-4, 'M advance'); nearAngle(later.dM0, adv.dM0, 1e-4, 'dM advance');
    }
});

check('basic burns from rest (a = 7000, 1 m/s)', () => {
    const n = M.meanMotion(7000), P = M.period(7000);
    const up = [0, 0, 0, 0.001, 0, 0], fwd = [0, 0, 0, 0, 0.001, 0];
    const xy = (s, f) => M.cwPropagate(s, n, f * P).slice(0, 2);
    nearVec(xy(up, 0.05), [0.29, -0.09], 0.01); nearVec(xy(up, 0.25), [0.93, -1.86], 0.01);
    nearVec(xy(up, 0.5), [0, -3.71], 0.01); nearVec(xy(up, 1), [0, 0], 0.01);
    nearVec(xy(fwd, 0.05), [0.09, 0.27], 0.01); nearVec(xy(fwd, 0.25), [1.86, -0.66], 0.01);
    nearVec(xy(fwd, 0.5), [3.71, -8.74], 0.01); nearVec(xy(fwd, 1), [0, -17.49], 0.01);
    const e = M.rmoeFromState(up, n);
    near(e.yc0, -1.855, 0.001); near(e.C, 0.928, 0.001); nearAngle(e.M0, 90, 0.01, 'M0');
    // +R goes up then behind: a stationary NMC is traced bottom, front, top, back.
    assert.ok(xy(up, 0.1)[0] > 0 && xy(up, 0.1)[1] < 0, '+R goes up, then behind');
});

check('burn rules (n = 0.0012)', () => {
    const n = M.meanMotion(6517.16);
    near(n, 0.0012, 1e-9);
    near(M.rule.recenter(n, -1) * 1000, 0.6, 1e-6);
    near(M.rule.driftOverRevs(n, -1, 1) * 1000, 0.063662, 1e-6);
    near(M.rule.driftOverRevs(n, 6, 2) * 1000, -0.190986, 1e-6);
    near(M.rule.crossTrack(n, 1, 1) * 1000, 1.2, 1e-6);
    near(M.rule.resize(n, 1, 1) * 1000, 1.2, 1e-6);
    near(M.rule.raise(n, 5) * 1000, 3.0, 1e-6);
    near(M.timeToAngle(90, 180, n), 1309.0, 0.05);
});

check('two-burn transfer and its singular times (GEO)', () => {
    const v0 = M.transferVelocity([0, -20, 0], [0, -4, 0], nGeo, PGeo / 4);
    nearVec(v0.map(x => x * 1000), [-0.70978, 0.35489, 0], 1e-4);
    const arrive = M.cwPropagate([0, -20, 0].concat(v0), nGeo, PGeo / 4);
    nearVec(arrive, [0, -4, 0], 1e-9); nearVec(arrive.slice(3).map(x => x * 1000), [0.70978, 0.35489, 0], 1e-4);
    assert.strictEqual(M.transferVelocity([0, -20, 0], [0, -4, 0], nGeo, PGeo), null, 'whole rev');
    assert.strictEqual(M.transferVelocity([0, 0, 1], [0, 0, 2], nGeo, PGeo / 2), null, 'cross-track at half rev');
});

// Flies a list of burns with CW coasts between them, as the Burn Sandbox does.
function flyPlan(state0, n, burns, tEnd) {
    const order = burns.map((b, k) => ({ b, k })).sort((p, q) => (p.b.t - q.b.t) || (p.k - q.k)).map(p => p.b);
    const legs = [];
    let state = state0.slice(), t = 0, dvTotal = 0;
    const coastTo = (t1) => {
        if (t1 <= t) return;
        legs.push({ t0: t, t1 });
        state = M.cwPropagate(state, n, t1 - t);
        t = t1;
    };
    order.forEach(b => {
        if (b.t > tEnd) return;
        coastTo(b.t);
        state = M.applyBurn(state, b.dv);
        dvTotal += Math.hypot(b.dv[0], b.dv[1], b.dv[2]);
    });
    coastTo(tEnd);
    return { state, dvTotal, legs };
}
// M at the positive plane crossing.
const planeCrossingM = (r) => (r.M0 === null || r.dM0 === null ? null : M.wrap360(r.M0 - r.dM0));

check('planner examples (burns with CW coasts)', () => {
    const n = M.meanMotion(6517.16), P = M.period(6517.16);
    const run = (rmoe, burns, endRev) => {
        const out = flyPlan(M.stateFromRmoe(rmoe, n, 0), n, burns.map(([rev, dv]) => ({ t: rev * P, dv: ms(dv) })), endRev * P);
        return { e: M.rmoeFromState(out.state, n), total: out.dvTotal * 1000, legs: out.legs, state: out.state };
    };
    const perch = y => ({ xc: 0, yc0: y, C: 0, M0: null, zmax: 0, dM0: null });
    const nmc3 = { xc: 0, yc0: 0, C: 3, M0: 0, zmax: 0, dM0: null };
    let r = run(perch(-12), [[0, [0, -0.190986, 0]], [2, [0, 0.190986, 0]]], 2);
    near(r.e.yc0, -6, 1e-3); near(r.e.xc, 0, 1e-6); near(r.e.C, 0, 1e-4); near(r.total, 0.3820, 1e-4);
    r = run({ xc: 1, yc0: 20, C: 0, M0: null, zmax: 0, dM0: null }, [[0, [0, -0.3, 0]], [0.5, [0, -0.3, 0]]], 0.5);
    near(r.e.yc0, 17.644, 1e-3); near(r.e.xc, 0, 1e-6); near(r.e.C, 0, 1e-6); near(r.total, 0.6, 1e-9);
    r = run(perch(-6), [[0, [-3.6, 0, 0]]], 0);
    near(r.e.yc0, 0, 1e-6); near(r.e.C, 3, 1e-6); nearAngle(r.e.M0, 270, 1e-4, 'at the back');
    r = run(nmc3, [[0.25, [-1.2, 0, 0]], [0.75, [1.2, 0, 0]]], 0.75);
    near(r.e.yc0, 0, 1e-6); near(r.e.C, 1, 1e-6); near(r.total, 2.4, 1e-9);
    r = run(nmc3, [[1, [0, 0, 3.6]]], 1);
    near(r.e.C, 3, 1e-6); near(r.e.zmax, 3, 1e-6); nearAngle(planeCrossingM(r.e), 0, 1e-4, 'M_+PC');
    r = run(perch(-12), [[0, [0, -0.190986, 0]], [2, [0, 0.190986, 0]], [2, [-3.6, 0, 0]], [2.25, [0, 0, 3.6]]], 2.25);
    near(r.e.xc, 0, 1e-5); near(r.e.yc0, 0, 1e-3); near(r.e.C, 3, 1e-3); near(r.e.zmax, 3, 1e-6);
    nearAngle(planeCrossingM(r.e), 0, 0.01, 'M_+PC'); near(r.total, 7.5820, 1e-4);
    assert.strictEqual(r.legs.length, 2, 'two coasts: the burns that share a time make no coast');
    // The two wrong plans.
    r = run({ xc: 1, yc0: 20, C: 0, M0: null, zmax: 0, dM0: null }, [[0, [0, -0.6, 0]]], 0);
    near(r.e.C, 1, 1e-6); near(r.e.yc0, 20, 1e-6);
    r = run(nmc3, [[0.25, [-2.4, 0, 0]]], 0.25);
    near(r.e.C, 1, 1e-6); near(r.e.yc0, 4, 1e-6);
});

check('Kepler equation', () => {
    near(M.keplerE(1, 0.3), 1.288091313, 1e-9); near(M.keplerE(3.0, 0.9), 3.067037497, 1e-9);
    near(M.keplerE(0.05, 0.95), 0.531420642, 1e-9);
    for (let k = 0; k < 200; k++) {
        const e = rnd(0, 0.94), nu = rnd(0, 360);
        near(Math.abs(M.wrap180(M.trueFromMean(M.meanFromTrue(nu, e), e) - nu)), 0, 1e-8, 'true -> mean -> true');
    }
});

const tgt = { a: 6900, e: 0, i: 90, raan: 45, argp: 0, nu: 0 };
check('elements to RIC, exact and linear (a = 6900)', () => {
    const rows = [
        [{ a: 6910 }, 0, [10, 0, 0], [0, -16.517, 0]],
        [{ a: 6890 }, 0, [-10, 0, 0], [0, 16.529, 0]],
        [{ e: 0.0015 }, 0, [-10.35, 0, 0], [0, 22.810, 0]],
        [{ e: 0.0015 }, 180, [10.35, 0, 0], [0, -22.793, 0]],
        [{ i: 89.9 }, 0, [0, 0, 0], [0, 0, -13.265]],
        [{ i: 89.9 }, 90, [0, 0, -12.043], [0, 0, 0]],
        [{ raan: 45.1 }, 0, [0, 0, -12.043], [0, 0, 0]],
        [{ raan: 45.1 }, 90, [0, 0, 0], [0, 0, 13.265]]
    ];
    rows.forEach(([d, u, rho, rate], k) => {
        const t = Object.assign({}, tgt, { nu: u });
        const c = Object.assign({}, t, d);
        const ex = M.relativeState(t, c, 0);
        nearVec(ex.rho, rho, 0.02, `row ${k} rho`); nearVec(ex.rhoDot.map(x => x * 1000), rate, 0.02, `row ${k} rate`);
        const lin = M.stateFromRmoe(M.rmoeFromCoes(t, c), M.meanMotion(t.a), 0);
        nearVec(lin, ex.rho, 0.25, `row ${k} linear position`);
    });
    const e = M.rmoeFromCoes(Object.assign({}, tgt, { nu: 90 }), Object.assign({}, tgt, { nu: 90, i: 89.9 }));
    near(e.zmax, 12.043, 0.001); nearAngle(e.dM0, 270, 0.01, 'dM0');
});

const gT = { a: 42164, e: 0, i: 30, raan: 20, argp: 0, nu: 70 };
const gC = { a: 42174, e: 0.0004, i: 30.02, raan: 20.03, argp: 40, nu: 30.05 };
check('general case: linear mapping and exact model', () => {
    const e = M.rmoeFromCoes(gT, gC);
    near(e.xc, 10, 1e-9); near(e.yc0, 39.028, 0.005); near(e.C, 16.870, 0.001);
    nearAngle(e.M0, 30.0, 0.05, 'M0'); near(e.zmax, 18.398, 0.005); nearAngle(e.dM0, 33.1, 0.05, 'dM0');
    const ex = M.relativeState(gT, gC, 0);
    nearVec(ex.rho, [-4.6421, 55.9044, 10.0697], 1e-3); near(ex.range, 56.9934, 1e-3);
    nearVec(ex.rhoDot.map(x => x * 1000), [0.61415, 1.03655, 1.12330], 2e-4);
    nearVec(M.stateFromRmoe(e, nGeo, 0), [-4.6055, 55.9110, 10.0550], 1e-3);
    nearVec(M.relativeState(gT, gC, PGeo / 4).rho, [18.4121, 44.6983, 15.4082], 2e-3);
    nearVec(M.stateFromRmoe(e, nGeo, PGeo / 4), [18.4417, 44.6767, 15.4067], 2e-3);
});

const eT = { a: 26562, e: 0.3, i: 55, raan: 30, argp: 40, nu: 10 };
const eC = { a: 26600, e: 0.28, i: 54, raan: 31, argp: 42, nu: 14 };
check('exact model with an eccentric target', () => {
    near(M.coeAt(eT, 5000).nu, 78.7600, 1e-3); near(M.coeAt(eC, 5000).nu, 79.2281, 1e-3);
    const ex = M.relativeState(eT, eC, 5000);
    nearVec(ex.rho, [425.684, 1240.824, -173.533], 0.05); near(ex.range, 1323.240, 0.05);
    nearVec(ex.rhoDot.map(x => x * 1000), [-79.0880, -82.9521, 81.8450], 0.02);
    near(ex.basis.omega, 1.88225e-4, 1e-8);
    const vHat = ex.basis.v.map(x => x / Math.hypot(...ex.basis.v));
    near(ex.basis.I[0] * vHat[0] + ex.basis.I[1] * vHat[1] + ex.basis.I[2] * vHat[2], 0.963465, 1e-5);
});

check('exact model integrity', () => {
    const P = M.period(eT.a);
    near(P, 43082.62, 0.01);
    const rv0 = M.coesToRv(eT);
    const h0 = Math.hypot(...[rv0.r[1] * rv0.v[2] - rv0.r[2] * rv0.v[1], rv0.r[2] * rv0.v[0] - rv0.r[0] * rv0.v[2], rv0.r[0] * rv0.v[1] - rv0.r[1] * rv0.v[0]]);
    for (let k = 0; k <= 40; k++) {
        const t = P * k / 40;
        const b = M.ricBasis(eT, t);
        const energy = (b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2) / 2 - M.MU / Math.hypot(...b.r);
        near(energy, -7.503208, 1e-5, 'energy');
        near(b.omega * (b.r[0] ** 2 + b.r[1] ** 2 + b.r[2] ** 2) / h0, 1, 1e-9, 'angular momentum');
        const x = [b.R[1] * b.I[2] - b.R[2] * b.I[1], b.R[2] * b.I[0] - b.R[0] * b.I[2], b.R[0] * b.I[1] - b.R[1] * b.I[0]];
        nearVec(x, b.C, 1e-12, 'R x I = C'); near(Math.hypot(...b.R), 1, 1e-12); near(Math.hypot(...b.I), 1, 1e-12);
        const ex = M.relativeState(eT, eC, t);
        near(Math.hypot(...ex.rho), ex.range, 1e-9, '|rho| = range');
        nearVec(M.relativeState(eT, eT, t).rho, [0, 0, 0], 1e-9, 'same orbit');
        const back = M.ricToEci(ex.rho, ex.basis);
        nearVec(back, ex.rC.map((v, j) => v - ex.rT[j]), 1e-8, 'ricToEci');
    }
    nearVec(M.coesToRv(M.coeAt(eT, P)).r, rv0.r, 1e-6, 'returns after one period');
});

check('same-orbit cases', () => {
    const t = { a: 7000, e: 0, i: 51.6, raan: 30, argp: 0, nu: 0 };
    const c = Object.assign({}, t, { nu: 2 });
    [0, 1000, 4000].forEach(time => {
        const ex = M.relativeState(t, c, time);
        nearVec(ex.rho, [-4.2642, 244.2965, 0], 1e-3); nearVec(ex.rhoDot, [0, 0, 0], 1e-9);
    });
    near(M.rmoeFromCoes(t, c).yc0, 244.3461, 1e-3);
    const et = { a: 26562, e: 0.3, i: 55, raan: 30, argp: 0, nu: 0 };
    const ec = Object.assign({}, et, { nu: 1 });
    near(M.relativeState(et, ec, 0).range, 324.5, 0.1);
    near(M.relativeState(et, ec, M.period(et.a) / 2).range, 174.7, 0.1);
});

check('the rate in RIC needs the frame-rotation term', () => {
    const t = { a: 6900, e: 0, i: 90, raan: 45, argp: 0, nu: 0 };
    const ex = M.relativeState(t, Object.assign({}, t, { a: 6910 }), 0);
    near(ex.rhoDot[1], -1.5 * M.meanMotion(6900) * 10, 2e-5, 'about -(3/2) n x');
});

check('element differences are inverses of each other, 200 pairs', () => {
    for (let k = 0; k < 200; k++) {
        const t = { a: rnd(6700, 45000), e: rnd(0, 0.5), i: rnd(1, 179), raan: rnd(0, 360), argp: rnd(0, 360), nu: rnd(0, 360) };
        const c = { a: rnd(6700, 45000), e: rnd(0, 0.5), i: rnd(1, 179), raan: rnd(0, 360), argp: rnd(0, 360), nu: rnd(0, 360) };
        const back = M.coeFromDifference(t, M.coeDifference(t, c));
        near(back.a, c.a, 1e-9); near(back.e, c.e, 1e-12); near(back.i, c.i, 1e-9);
        ['raan', 'argp', 'nu'].forEach(key => near(Math.abs(M.wrap180(back[key] - c[key])), 0, 1e-9, key));
    }
});

check('motion names, formats, orbit checks', () => {
    const name = (xc, C, zmax, yc0) => M.classifyMotion({ xc, yc0: yc0 || 5, C, zmax, M0: 0, dM0: 0 }).key;
    assert.deepStrictEqual([name(0, 0, 0), name(1, 0, 0), name(0, 1, 0), name(1, 1, 0), name(0, 0, 1), name(1, 0, 1), name(0, 1, 1), name(1, 1, 1)],
        ['perch', 'linear-drift', 'stationary-nmc', 'drifting-nmc', 'cross-track', 'drifting-cross-track', 'nmc-cross-track', 'corkscrew']);
    assert.strictEqual(M.classifyMotion({ xc: 0, yc0: 0, C: 0, zmax: 0, M0: null, dM0: null }).label, 'At the target');
    assert.strictEqual(M.fmt.km(1.23456), '1.235'); assert.strictEqual(M.fmt.km(123.456), '123.46');
    assert.strictEqual(M.fmt.ms(0.000190986), '0.1910'); assert.strictEqual(M.fmt.deg(null), 'undefined');
    assert.strictEqual(M.fmt.km(-0.0001), '0.000'); assert.strictEqual(M.fmt.ms(-1e-9), '0.0000'); assert.strictEqual(M.fmt.deg(-0.01), '0.0');
    assert.strictEqual(M.orbitProblem(gT), null); assert.strictEqual(M.orbitProblem({ a: 6400, e: 0 }), 'perigee');
    assert.strictEqual(M.orbitProblem({ a: 7000, e: 0.96 }), 'e'); assert.strictEqual(M.orbitProblem({ a: -1, e: 0 }), 'a');
    const b = M.boundaryTable({ xc: 1, yc0: 2, C: 3, M0: 0, zmax: 4, dM0: 0 }, 0.001);
    b.inPlane.forEach(p => nearVec(M.stateFromRmoe({ xc: 1, yc0: 2, C: 3, M0: p.angle, zmax: 0, dM0: null }, 0.001, 0).slice(0, 2), [p.x, p.y], 1e-12));
    b.cross.forEach(p => near(M.stateFromRmoe({ xc: 0, yc0: 0, C: 0, M0: null, zmax: 4, dM0: p.angle }, 0.001, 0)[2], p.z, 1e-12));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
