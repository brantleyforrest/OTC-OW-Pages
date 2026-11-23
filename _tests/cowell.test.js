// Run with: node _tests/cowell.test.js
// Checks Cowell's method (math/motion/cowell.js) and every solver tableau in math/motion/solvers.js against references that do not
// share its code: the site's universal-variable Kepler (section rendezvous), an own Kepler-equation
// solution, energy and angular momentum conservation with J2, and the J2 secular node rate.
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('./load-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const OC = globalThis.OrbitConstants;
const T = { TABLEAUS: OC.SOLVERS, IDS: OC.SOLVER_IDS, validate: OC.validateTableau };
const Cowell = OM.bind(TEST_SET).cowell;
const RM = OM.bind(TEST_SET).rendezvous;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
function below(got, limit, what) {
    assert.ok(got <= limit, `${what}: ${got} is above ${limit}`);
}
let seed = 24680;
function rnd(lo, hi) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return lo + (hi - lo) * seed / 4294967296;
}

const WGS = { mu: 398600.4418, re: 6378.137, J2: 1.08262668e-3 };
const COURSE = { mu: 398600.44, re: 6378, J2: 1.08263e-3 };
const D2R = Math.PI / 180;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const diff = (a, b) => norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// r, v from elements (perifocal, then R3(-raan) R1(-i) R3(-argp)).
function rvFromCoe(mu, a, e, iDeg, raanDeg, argpDeg, nuDeg) {
    const p = a * (1 - e * e), nu = nuDeg * D2R;
    const r = p / (1 + e * Math.cos(nu));
    const rp = [r * Math.cos(nu), r * Math.sin(nu), 0];
    const vp = [-Math.sqrt(mu / p) * Math.sin(nu), Math.sqrt(mu / p) * (e + Math.cos(nu)), 0];
    const O = raanDeg * D2R, w = argpDeg * D2R, i = iDeg * D2R;
    const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
    const R = [
        [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
        [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
        [sw * si, cw * si, ci]
    ];
    const rot = (u) => R.map((row) => row[0] * u[0] + row[1] * u[1] + row[2] * u[2]);
    return { r: rot(rp), v: rot(vp) };
}

// Own Kepler-equation solution in the orbit plane (independent of the site math).
function keplerInPlane(mu, a, e, t) {
    const M = Math.sqrt(mu / a ** 3) * t;
    let E = M;
    for (let k = 0; k < 60; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const r = a * (1 - e * Math.cos(E));
    return {
        r: [a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), 0],
        v: [-Math.sqrt(mu * a) / r * Math.sin(E), Math.sqrt(mu * a * (1 - e * e)) / r * Math.cos(E), 0]
    };
}

// Fixed-step run of any tableau (for measuring order), using Cowell's own step function.
function fixedRun(tab, C, y0r, y0v, dt, steps) {
    const f = Cowell.makeDerivative(C);
    let y = [...y0r, ...y0v];
    const h = dt / steps;
    for (let k = 0; k < steps; k++) y = Cowell.rkStep(tab, f, k * h, y, h).y;
    return y.slice(0, 3);
}

check('every table is consistent, and a planted typo is caught', () => {
    for (const id of T.IDS) assert.deepStrictEqual(T.validate(T.TABLEAUS[id]), [], id);
    const bad = JSON.parse(JSON.stringify(T.TABLEAUS.PD78));
    bad.a[9][4] = -309121744 / 1061227808;          // one digit changed in the denominator
    assert.ok(T.validate(bad).length > 0, 'typo in PD78 a[9][4] not caught');
    const bad2 = JSON.parse(JSON.stringify(T.TABLEAUS.DP45));
    bad2.bHat[2] = 7571 / 16696;
    assert.ok(T.validate(bad2).length > 0, 'typo in DP45 bHat not caught');
});

check('solver setting: default PD78, follows the site settings, unknown ids fall back', () => {
    const S = OC.Settings;
    assert.strictEqual(Cowell.getSolver(), 'PD78');
    assert.deepStrictEqual(Cowell.solverIds(), ['PD78', 'DP45', 'RKF45', 'RK4']);
    S.set({ solver: 'RKF45' });
    assert.strictEqual(Cowell.getSolver(), 'RKF45');
    S.set({ solver: 'Euler' });                      // not a choice: the store keeps the default
    assert.strictEqual(Cowell.getSolver(), 'PD78');
    S.reset();
    assert.strictEqual(Cowell.getSolver(), 'PD78');
});

check('observed order matches each method (fixed step, 5 orbits, e = 0.1)', () => {
    const C = WGS, a = 7000, e = 0.1, P = 2 * Math.PI * Math.sqrt(a ** 3 / C.mu);
    const s0 = keplerInPlane(C.mu, a, e, 0), truth = keplerInPlane(C.mu, a, e, 5 * P);
    const steps = { RK4: 2000, RKF45: 2000, DP45: 2000, PD78: 100 };   // PD78 hits rounding by ~300
    for (const id of T.IDS) {
        const tab = T.TABLEAUS[id];
        const e1 = diff(fixedRun(tab, C, s0.r, s0.v, 5 * P, steps[id]), truth.r);
        const e2 = diff(fixedRun(tab, C, s0.r, s0.v, 5 * P, 2 * steps[id]), truth.r);
        const order = Math.log2(e1 / e2);
        assert.ok(order > tab.order - 0.5, `${id}: observed order ${order.toFixed(2)}, want about ${tab.order}`);
        if (tab.bHat) {
            const low = { ...tab, b: tab.bHat, bHat: null };
            const l1 = diff(fixedRun(low, C, s0.r, s0.v, 5 * P, steps[id]), truth.r);
            const l2 = diff(fixedRun(low, C, s0.r, s0.v, 5 * P, 2 * steps[id]), truth.r);
            const lowOrder = Math.log2(l1 / l2);
            assert.ok(lowOrder > tab.errOrder - 0.5, `${id} embedded: observed order ${lowOrder.toFixed(2)}, want about ${tab.errOrder}`);
        }
    }
});

check('each solver matches Kepler over 5 orbits (e = 0.1) with its stated cost', () => {
    const C = WGS, a = 7000, e = 0.1, P = 2 * Math.PI * Math.sqrt(a ** 3 / C.mu);
    const s0 = keplerInPlane(C.mu, a, e, 0), truth = keplerInPlane(C.mu, a, e, 5 * P);
    const limitKm = { PD78: 1e-6, DP45: 1e-5, RKF45: 1e-5, RK4: 1e-3 };
    for (const id of T.IDS) {
        const res = Cowell.propagate(s0.r, s0.v, 5 * P, { constants: C, solver: id });
        below(diff(res.r, truth.r), limitKm[id], `${id} position error (km)`);
        below(diff(res.v, truth.v), limitKm[id] / 1000, `${id} velocity error (km/s)`);
        assert.strictEqual(res.solver, id);
    }
    const pd = Cowell.propagate(s0.r, s0.v, 5 * P, { constants: C });
    assert.strictEqual(pd.solver, 'PD78', 'no solver given uses the default');
    below(pd.steps, 400, 'PD78 steps for 5 orbits');
});

check('slope reuse: DP45 spends 6 new evaluations per step, others reuse after a rejection', () => {
    const C = WGS, s0 = keplerInPlane(C.mu, 7000, 0.1, 0);
    const res = Cowell.propagate(s0.r, s0.v, 20000, { constants: C, solver: 'DP45' });
    assert.strictEqual(res.evals, 1 + 6 * (res.steps + res.rejected));
    const pd = Cowell.propagate(s0.r, s0.v, 20000, { constants: C, solver: 'PD78' });
    assert.strictEqual(pd.evals, 13 * pd.steps + 12 * pd.rejected);
});

check('PD78 agrees with the site\'s universal-variable Kepler on 200 random orbits', () => {
    let worst = 0;
    for (let k = 0; k < 200; k++) {
        const C = k % 2 ? WGS : COURSE;
        const rp = rnd(6578, 9000), e = rnd(0, 0.7);
        const a = rp / (1 - e);
        const s = rvFromCoe(C.mu, a, e, rnd(0, 180), rnd(0, 360), rnd(0, 360), rnd(0, 360));
        const P = 2 * Math.PI * Math.sqrt(a ** 3 / C.mu);
        const dt = rnd(-5, 5) * P;
        const ref = RM.propagate(s.r, s.v, dt, C.mu);
        const res = Cowell.propagate(s.r, s.v, dt, { constants: C });
        worst = Math.max(worst, diff(res.r, ref.r) / norm(ref.r));
    }
    below(worst, 1e-9, 'worst relative position difference');
});

check('PD78 agrees with universal-variable Kepler on hyperbolic arcs', () => {
    for (let k = 0; k < 40; k++) {
        const C = WGS, rp = rnd(6600, 8000), e = rnd(1.1, 3);
        const a = rp / (1 - e);                       // negative for a hyperbola
        const s = rvFromCoe(C.mu, a, e, rnd(0, 180), rnd(0, 360), rnd(0, 360), rnd(-60, 60));
        const dt = rnd(-4000, 4000);
        const ref = RM.propagate(s.r, s.v, dt, C.mu);
        const res = Cowell.propagate(s.r, s.v, dt, { constants: C });
        below(diff(res.r, ref.r) / norm(ref.r), 1e-9, `hyperbola ${k}`);
    }
});

check('forward then backward returns to the start', () => {
    const C = WGS, s = rvFromCoe(C.mu, 26560, 0.6, 63.4, 40, 270, 10);
    for (const id of T.IDS) {
        const out = Cowell.propagate(s.r, s.v, 86400, { constants: C, solver: id });
        const back = Cowell.propagate(out.r, out.v, -86400, { constants: C, solver: id });
        below(diff(back.r, s.r), id === 'RK4' ? 1e-2 : 1e-4, `${id} round trip (km)`);
    }
});

check('with J2: energy and polar angular momentum are conserved', () => {
    const C = WGS;
    const s = rvFromCoe(C.mu, 7000, 0.05, 51.6, 30, 60, 0);
    const energy = (r, v) => {
        const R = norm(r), z = r[2];
        const U = -C.mu / R * (1 - C.J2 * (C.re / R) ** 2 * (1.5 * (z / R) ** 2 - 0.5));
        return 0.5 * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + U;
    };
    const E0 = energy(s.r, s.v), hz0 = cross(s.r, s.v)[2];
    const P = 2 * Math.PI * Math.sqrt(7000 ** 3 / C.mu);
    const out = Cowell.propagate(s.r, s.v, 15 * P, { constants: C, forces: { j2: true } });
    below(Math.abs(energy(out.r, out.v) / E0 - 1), 1e-11, 'relative energy change');
    below(Math.abs(cross(out.r, out.v)[2] / hz0 - 1), 1e-11, 'relative h_z change');
});

check('with J2: node turns at the secular rate (ISS-like orbit, 15 orbits, within 1%)', () => {
    const C = WGS, r = 6778, i = 51.6;
    const s = rvFromCoe(C.mu, r, 0, i, 0, 0, 0);
    const P = 2 * Math.PI * Math.sqrt(r ** 3 / C.mu);
    const out = Cowell.propagate(s.r, s.v, 15 * P, { constants: C, forces: { j2: true } });
    const h = cross(out.r, out.v);
    const raan = Math.atan2(h[0], -h[1]) / D2R;
    const n = Math.sqrt(C.mu / r ** 3);
    const want = -1.5 * n * C.J2 * (C.re / r) ** 2 * Math.cos(i * D2R) * 15 * P / D2R;
    below(Math.abs(raan / want - 1), 0.01, `node change ${raan.toFixed(4)} vs ${want.toFixed(4)} deg`);
});

check('trajectory returns the same states as single propagations, in any time order', () => {
    const C = WGS, s = rvFromCoe(C.mu, 7200, 0.02, 98, 10, 20, 30);
    const times = [3000, -1200, 0, 600, 9000, -50];
    const traj = Cowell.trajectory(s.r, s.v, times, { constants: C });
    times.forEach((t, k) => {
        const one = Cowell.propagate(s.r, s.v, t, { constants: C });
        assert.strictEqual(traj[k].t, t);
        below(diff(traj[k].r, one.r), 1e-6, `t = ${t} (km)`);
    });
});

check('missing constants are refused instead of guessed', () => {
    const s = keplerInPlane(WGS.mu, 7000, 0, 0);
    assert.throws(() => Cowell.propagate(s.r, s.v, 100, {}));
    assert.throws(() => Cowell.propagate(s.r, s.v, 100, { constants: { mu: WGS.mu }, forces: { j2: true } }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
