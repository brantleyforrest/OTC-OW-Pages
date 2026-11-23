// Run with: node _tests/ric-model.test.js
// The RIC model setting (math/relative/cw.js and exact.js): CW against the exact difference of two
// propagated orbits, in rectilinear and curvilinear axes. References: the CW closed form for small
// separations, geometry (a co-orbital chase keeps a fixed arc), and the axis round trip.
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('./load-math.js');
const OC = globalThis.OrbitConstants;
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = OC.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
OC.Settings.set({ constants: TEST_SET.id });
const M = OM.rpo;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
const GEO = { a: M.GEO_A, e: 0, i: 0, raan: 0, argp: 0, nu: 0 };
const LEO = { a: 6778, e: 0, i: 51.6, raan: 40, argp: 0, nu: 30 };
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Worst distance between the exact path and CW over one orbit.
function worstGap(coe, rmoe, axes, orbits = 1) {
    const n = M.meanMotion(coe.a), P = 2 * Math.PI / n;
    const T = M.targetSat(coe), ch = M.chaseSatFromRic(M.stateFromRmoe(rmoe, n, 0), T, 0, axes);
    let w = 0;
    for (let k = 0; k <= 240; k++) {
        const t = orbits * P * k / 240;
        w = Math.max(w, gap(M.relativeStateSats(T, ch, t, axes).rho, M.stateFromRmoe(rmoe, n, t)));
    }
    return w;
}

check('a 1 km NMC at GEO: CW and exact agree to under 1 m over one orbit, both axis types', () => {
    const nmc = { xc: 0, yc0: 0, C: 1, zmax: 0.5, M0: 30, dM0: 60 };
    for (const axes of ['rectilinear', 'curvilinear']) {
        const w = worstGap(GEO, nmc, axes);
        assert.ok(w < 1e-3, `${axes}: ${(w * 1000).toFixed(3)} m`);
    }
});

check('the gap grows with the separation (about as its square), as the CW error table expects', () => {
    const at = (C) => worstGap(GEO, { xc: 0, yc0: 0, C, zmax: 0, M0: 0, dM0: 0 }, 'rectilinear');
    const g1 = at(1), g10 = at(10), g100 = at(100);
    assert.ok(g10 > 30 * g1 && g10 < 300 * g1, `10 km / 1 km: ${(g10 / g1).toFixed(0)}`);
    assert.ok(g100 > 30 * g10 && g100 < 300 * g10, `100 km / 10 km: ${(g100 / g10).toFixed(0)}`);
});

check('curvilinear keeps a co-orbital chase 50 km ahead fixed; rectilinear sees it drift', () => {
    const n = M.meanMotion(GEO.a), P = 2 * Math.PI / n;
    const T = M.targetSat(GEO);
    const still = [0, 50, 0, 0, 0, 0];
    const curv = M.chaseSatFromRic(still, T, 0, 'curvilinear');
    const rect = M.chaseSatFromRic(still, T, 0, 'rectilinear');
    let wc = 0, wr = 0;
    for (let k = 0; k <= 60; k++) {
        const t = P * k / 60;
        wc = Math.max(wc, gap(M.relativeStateSats(T, curv, t, 'curvilinear').rho, still));
        wr = Math.max(wr, gap(M.relativeStateSats(T, rect, t, 'rectilinear').rho, still));
    }
    assert.ok(wc < 1e-6, `curvilinear moved ${wc} km`);
    assert.ok(wr > 0.1, `rectilinear should drift (a straight 50 km offset is higher up): ${wr} km`);
});

check('curvilinear and rectilinear states convert both ways', () => {
    for (const s of [[3, -40, 7, 0.01, -0.02, 0.003], [-100, 300, -50, 0.1, 0.05, -0.2], [0, 0, 0, 0, 0, 0]]) {
        for (const [rt, rtDot] of [[7000, 0.1], [42164, 0], [26600, -1.2]]) {
            const back = M.rectFromCurvilinear(M.curvilinearFromRect(s, rt, rtDot), rt, rtDot);
            s.forEach((x, k) => assert.ok(Math.abs(back[k] - x) < 1e-9, `component ${k}: ${back[k]} vs ${x}`));
        }
    }
});

check('the exact state agrees with the elements-based relativeState in rectilinear axes', () => {
    const chaseCoe = M.coeFromDifference(LEO, { da: 2, de: 0.0003, di: 0.01, draan: 0.02, dargp: 0, dnu: -0.05 });
    const T = M.targetSat(LEO), C = M.targetSat(chaseCoe);
    for (const t of [0, 1000, 4000]) {
        const a = M.relativeStateSats(T, C, t).rho, b = M.relativeState(LEO, chaseCoe, t).rho;
        assert.ok(gap(a, b) < 1e-9, `t = ${t}: ${gap(a, b)} km`);
    }
});

check('the chase built from a RIC state reads back the same state at that moment', () => {
    const T = M.targetSat(LEO);
    const s = [0.4, -3, 0.2, 0.0005, -0.001, 0.0002];
    for (const axes of ['rectilinear', 'curvilinear']) {
        const ch = M.chaseSatFromRic(s, T, 900, axes);
        const back = M.relativeStateSats(T, ch, 900, axes);
        [...back.rho, ...back.rhoDot].forEach((x, k) => assert.ok(Math.abs(x - s[k]) < 1e-10, `${axes} component ${k}`));
    }
});

check('an elliptical target (its radius changing): curvilinear rates read back, and match a finite difference', () => {
    const MOL = { a: 26600, e: 0.74, i: 63.4, raan: 20, argp: 270, nu: 60 };
    const T = M.targetSat(MOL);
    const s = [2, -15, 1, 0.002, -0.004, 0.001];
    const ch = M.chaseSatFromRic(s, T, 0, 'curvilinear');
    const back = M.relativeStateSats(T, ch, 0, 'curvilinear');
    [...back.rho, ...back.rhoDot].forEach((x, k) => assert.ok(Math.abs(x - s[k]) < 1e-9, `component ${k}: ${x} vs ${s[k]}`));
    // The curvilinear rates are the time derivatives of the curvilinear position.
    const h = 0.5, t0 = 1200;
    const p = M.relativeStateSats(T, ch, t0 + h, 'curvilinear').rho, m = M.relativeStateSats(T, ch, t0 - h, 'curvilinear').rho;
    const mid = M.relativeStateSats(T, ch, t0, 'curvilinear').rhoDot;
    for (let k = 0; k < 3; k++) {
        const fd = (p[k] - m[k]) / (2 * h);
        assert.ok(Math.abs(fd - mid[k]) < 1e-6, `rate ${k}: ${mid[k]} vs finite difference ${fd}`);
    }
});

check('sampled paths give the chosen axes and the rectilinear path for ECI', () => {
    const T = M.targetSat(GEO), ch = M.chaseSatFromRic([0, 50, 0, 0, 0, 0], T, 0, 'curvilinear');
    const s = M.sampleRelativeSats(T, ch, 0, 3600, 5, 'curvilinear');
    assert.strictEqual(s.path.length, 15);
    assert.ok(Math.abs(s.path[1] - 50) < 1e-9);
    assert.ok(Math.abs(s.rect[1] - 50) > 1e-6 || Math.abs(s.rect[0]) > 1e-3, 'the rectilinear y of a 50 km arc is shorter, and x is below');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
