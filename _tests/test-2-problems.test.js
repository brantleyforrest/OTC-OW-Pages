// Run with: node _tests/test-2-problems.test.js
// Generates 200 problems per Test 2 Practice section and checks each answer independently.
const assert = require('node:assert');
globalThis.window = globalThis;
const M = require('../practice/test-review-math.js').rpo;
// PracticeMath runs without KaTeX: math is shown as its TeX source.
require('../practice/practice-math.js');
require('../practice/test-2-common.js');
require('../practice/answer-check.js');
const Visual = require('../practice/test-2-visual.js');
const Rmoe = require('../practice/test-2-rmoe-problems.js');
const Coeric = require('../practice/test-2-coeric-problems.js');
const Vis = require('../practice/test-2-visual-problems.js');
const Burns = require('../practice/test-2-burns-problems.js');

const COUNT = 200;
let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + (err.stack || err.message).split('\n').slice(0, 3).join('\n      ')); }
}

// Pick fields (choice, plot, sign): the answer is one of the options, the options are distinct,
// the answer grades right, every other option wrong, and a blank is blank.
function checkPicks(module, p) {
    assert.ok(p.title && p.prompt && Array.isArray(p.fields) && p.steps.length > 0, 'shape');
    for (const field of p.fields) {
        const answer = p.answers[field.key];
        assert.ok(answer && answer.value !== undefined && answer.text, 'answer for ' + field.key);
        const values = field.unitType === 'sign' ? ['+', '-', '0'] : field.options.map(o => o.value);
        assert.ok(values.includes(answer.value), 'answer is one of the options for ' + field.key);
        assert.strictEqual(new Set(values).size, values.length, 'options are distinct');
        assert.strictEqual(module.grade(field, answer.value, answer.value), 'right');
        values.filter(v => v !== answer.value).forEach(v => assert.strictEqual(module.grade(field, v, answer.value), 'wrong'));
        assert.strictEqual(module.grade(field, '', answer.value), 'blank');
    }
}

// Numeric problems: every answer finite (or undefined where allowed), the exact answer grades
// right, a number for an undefined answer grades wrong, and an answer 3 percent off (or past the
// floor, for values near zero; 3° for angles) grades wrong.
function checkNumeric(module, p) {
    assert.ok(p.title && p.prompt && p.steps.length > 0, 'shape');
    for (const field of p.fields) {
        const answer = p.answers[field.key];
        assert.ok(answer && answer.text, 'answer for ' + field.key);
        if (answer.value === null) {
            assert.ok(field.allowUndefined, 'undefined only where allowed: ' + field.key);
            assert.strictEqual(module.grade(field, 'undefined', null), 'right');
            assert.strictEqual(module.grade(field, '0', null), 'wrong');
            continue;
        }
        assert.ok(Number.isFinite(answer.value), 'finite ' + field.key);
        assert.strictEqual(module.grade(field, String(answer.value), answer.value), 'right', 'exact ' + field.key);
        assert.strictEqual(module.grade(field, answer.text, answer.value), 'right', 'shown text ' + field.key + ' ' + answer.text);
        if (field.allowUndefined) assert.strictEqual(module.grade(field, 'undefined', answer.value), 'wrong');
        const t = field.tolerance;
        const off = t.absolute !== undefined ? 3 : Math.max(0.03 * Math.abs(answer.value), 2 * (t.floor || 0));
        assert.strictEqual(module.grade(field, String(answer.value + off), answer.value), 'wrong', '3 percent off ' + field.key);
        assert.strictEqual(module.grade(field, '', answer.value), 'blank');
    }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const angleGap = (a, b) => { const g = Math.abs(a - b) % 360; return Math.min(g, 360 - g); };
// The equation-sheet forms (acos and asin with the quadrant rules), not the atan2 forms in test-review-math.js.
function sheetRmoe(s, n) {
    const [x0, y0, z0, vx, vy, vz] = s;
    const xc = 4 * x0 + 2 * vy / n, yc0 = y0 - 2 * vx / n;
    const C = Math.sqrt((xc - x0) ** 2 + ((yc0 - y0) / 2) ** 2), zmax = Math.sqrt(z0 ** 2 + (vz / n) ** 2);
    let M0 = Math.acos(Math.max(-1, Math.min(1, (xc - x0) / C))) * 180 / Math.PI; if (vx < 0) M0 = 360 - M0;
    let dM0 = Math.asin(Math.max(-1, Math.min(1, z0 / zmax))) * 180 / Math.PI; if (vz < 0) dM0 = 180 - dM0; dM0 = ((dM0 % 360) + 360) % 360;
    return { xc, yc0, C, zmax, M0, dM0 };
}
// The boundary tables, written out again.
function tableState(r, n) {
    const yd = -1.5 * n * r.xc;
    const k = Math.round((r.M0 || 0) / 90) % 4, j = Math.round((r.dM0 || 0) / 90) % 4;
    const inPlane = [[r.xc - r.C, r.yc0, 0, yd + 2 * n * r.C], [r.xc, r.yc0 + 2 * r.C, n * r.C, yd], [r.xc + r.C, r.yc0, 0, yd - 2 * n * r.C], [r.xc, r.yc0 - 2 * r.C, -n * r.C, yd]][k];
    const cross = r.dM0 === null ? [0, 0] : [[0, n * r.zmax], [r.zmax, 0], [0, -n * r.zmax], [-r.zmax, 0]][j];
    return [inPlane[0], inPlane[1], cross[0], inPlane[2], inPlane[3], cross[1]];
}
const STATE_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz'];
// Positions in km against tol; velocities in m/s against tol / 10.
function checkState(p, s, tol, what) {
    STATE_KEYS.forEach((key, k) => near(p.answers[key].value, k < 3 ? s[k] : s[k] * 1000, k < 3 ? tol : tol / 10, what + ' ' + key));
}
// The motion name from which RMOEs are there, without classifyMotion.
function motionFromParts(r) {
    const D = Math.abs(r.xc) > 1e-3, E = r.C > 1e-3, Z = r.zmax > 1e-3;
    return ['perch', 'cross-track', 'stationary-nmc', 'nmc-cross-track', 'linear-drift', 'drifting-cross-track', 'drifting-nmc', 'corkscrew'][(D ? 4 : 0) + (E ? 2 : 0) + (Z ? 1 : 0)];
}

/* ---------- 1. Elements to RIC Signs ---------- */
check(`Elements to RIC Signs: ${COUNT} problems, signs from the linear mapping by hand`, () => {
    const zeros = new Set(), signs = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Coeric.generate(['in-plane', 'cross', 'both', 'random'][k % 4]);
        checkPicks(Coeric, p);
        assert.deepStrictEqual(p.gridHeads, ['Position', 'Velocity'], 'grid heads');
        assert.deepStrictEqual(p.fields.map(f => f.key), ['x', 'vx', 'y', 'vy', 'z', 'vz'], 'grid order: rows R, I, C');
        const { target, chase, n } = p.model;
        assert.strictEqual(target.argp, 0); assert.strictEqual(chase.argp, 0);
        assert.strictEqual(target.nu, chase.nu, 'same true anomaly');
        assert.ok([0, 90, 180, 270].includes(target.nu));
        if (chase.e > 0) assert.ok([0, 180].includes(chase.nu), 'perigee or apogee');
        // The linear mapping worked by hand.
        const u = target.nu * Math.PI / 180, a = target.a, D = Math.PI / 180;
        const di = (chase.i - target.i) * D, dO = M.wrap180(chase.raan - target.raan) * D, i = target.i * D;
        const C = chase.a * chase.e, xc = chase.a - a;
        const cosM = target.nu === 0 ? 1 : target.nu === 180 ? -1 : 0;
        const z = a * (di * Math.sin(u) - dO * Math.sin(i) * Math.cos(u));
        const zd = n * a * (di * Math.cos(u) + dO * Math.sin(i) * Math.sin(u));
        const s = C > 0 ? [xc - C * cosM, 0, z, 0, -1.5 * n * xc + 2 * n * C * cosM, zd] : [xc, 0, z, 0, -1.5 * n * xc, zd];
        const posScale = Math.max(...s.slice(0, 3).map(Math.abs)), velScale = Math.max(...s.slice(3).map(Math.abs));
        STATE_KEYS.forEach((key, j) => {
            const v = s[j], scale = j < 3 ? posScale : velScale;
            const want = Math.abs(v) <= Math.max(1e-6 * scale, j < 3 ? 1e-9 : 1e-13) ? '0' : v > 0 ? '+' : '-';
            if (want !== '0') assert.ok(Math.abs(v) >= 0.04 * scale, 'a nonzero part is clearly nonzero: ' + key);
            assert.strictEqual(p.answers[key].value, want, 'sign of ' + key + ' (' + v + ')');
            (want === '0' ? zeros : signs).add(key);
        });
    }
    assert.strictEqual(zeros.size + signs.size >= 6, true);
    ['x', 'y', 'vx'].forEach(key => assert.ok(zeros.has(key) || signs.has(key), 'seen ' + key));
    ['x', 'z', 'vy', 'vz'].forEach(key => assert.ok(signs.has(key), 'nonzero ' + key + ' appears'));
});

// The course's element-difference answers against the exact r/v answer from the tools' math
// (OrbitMath, course set): every value the exact answer would put outside the numeric tolerance
// must be explained in the solution. Reports how often and by how much.
check('Elements to RIC Signs: the exact answer departs beyond tolerance only where the solution says so', () => {
    const OM = require('../assets/orbit-math.js');
    const O = OM.bind(globalThis.OrbitConstants.SETS.course).rpo;
    const C2 = globalThis.Test2Common;
    let off = 0, total = 0, worst = 0, flips = 0;
    for (let k = 0; k < 4 * COUNT; k++) {
        const p = Coeric.generate(['in-plane', 'cross', 'both', 'random'][k % 4]);
        const linear = C2.stateAnswers(M.stateFromRmoe(p.model.rmoe, p.model.n, 0));
        const rel = O.relativeState(p.model.target, p.model.chase, 0);
        const exact = C2.stateAnswers([...rel.rho, ...rel.rhoDot]);
        const html = p.steps.find(s => s.key === 'tables').methods[0].html;
        let any = false;
        for (const field of C2.STATE_FIELDS()) {
            total++;
            const truth = linear[field.key].value;
            if (C2.grade(field, String(exact[field.key].value), truth) === 'wrong') {
                off++; any = true;
                const tol = field.tolerance;
                worst = Math.max(worst, Math.abs(exact[field.key].value - truth) / Math.max(Math.abs(truth) * tol.relative, tol.floor || 0));
            }
            // A sign the exact model would flip must be a linear 0 (a second-order part).
            const ev = exact[field.key].value, ans = p.answers[field.key].value;
            if (ans !== '0' && Math.sign(ev) !== (ans === '+' ? 1 : -1)) flips++;
        }
        assert.strictEqual(html.includes('The exact difference of the two orbits'), any, 'note shown exactly when needed');
    }
    console.log(`      ${off} of ${total} values fall outside the numeric tolerance when worked exactly; worst ${worst.toFixed(2)} times the tolerance`);
    assert.ok(worst < 5, 'the gap stays a small multiple of the tolerance');
    assert.strictEqual(flips, 0, 'the exact model never flips a + or − answer');
});

/* ---------- 2 and 3. Visualize ---------- */
function checkVisual(module, p, given) {
    checkPicks(module, p);
    const { n, rmoe: r } = p.model;
    assert.strictEqual(p.answers.motion.value, motionFromParts(r), 'motion name from the parts');
    assert.strictEqual(M.classifyMotion(r).key, p.answers.motion.value, 'motion name from classifyMotion');
    if (given) {
        // The RMOEs worked from the rounded givens by the equation-sheet forms give the same motion.
        const sheet = sheetRmoe(given, n);
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(sheet[key], r[key], 0.01, 'givens give back ' + key));
        assert.strictEqual(motionFromParts(sheet), p.answers.motion.value, 'motion from the givens');
        if (r.C > 0) assert.ok(angleGap(sheet.M0, r.M0) < 0.5, 'M0 from the givens');
        if (r.zmax > 0) assert.ok(angleGap(sheet.dM0, r.dM0) < 0.5, 'dM0 from the givens');
    }
    // Exactly one plot pair draws the true motion (cwPropagate of the epoch state); every other pair
    // draws something visibly different.
    const field = p.fields.find(f => f.unitType === 'plot');
    assert.strictEqual(field.options.length, 4, 'four plot choices');
    const T = Visual.REVS * 2 * Math.PI / n, N = 41;
    const s0 = M.stateFromRmoe(r, n, 0);
    const truth = new Float64Array(3 * N);
    for (let j = 0; j < N; j++) { const s = M.cwPropagate(s0, n, T * j / (N - 1)); truth.set(s.slice(0, 3), 3 * j); }
    const size = Math.max(r.C, Math.abs(r.xc) * 2, r.zmax, Math.abs(r.yc0) / 3, 2);
    const pathOf = spec => spec.path ? Float64Array.from({ length: 3 * N }, (_, q) => spec.path[3 * Math.round((Math.floor(q / 3)) * (spec.path.length / 3 - 1) / (N - 1)) + q % 3])
        : M.sampleTrajectory(spec.rmoe, n, 0, T, N);
    const gapTo = P => { let w = 0; for (let q = 0; q < P.length; q++) w = Math.max(w, Math.abs(P[q] - truth[q])); return w; };
    const matches = field.options.filter(o => gapTo(pathOf(o.plots[0])) < 1e-6);
    assert.strictEqual(matches.length, 1, 'one plot is the true motion');
    assert.strictEqual(matches[0].value, p.answers.plot.value, 'the true plot is the answer');
    field.options.filter(o => o !== matches[0]).forEach(o => assert.ok(gapTo(pathOf(o.plots[0])) > 0.1 * size, 'a wrong plot looks different'));
    field.options.forEach(o => o.plots.forEach(s => assert.ok(pathOf(s).every(Number.isFinite), 'finite plot')));
    assert.deepStrictEqual(field.options[0].plots.map(s => s.plane), ['left', 'behind'], 'left, then behind');
}

check(`Visualize from Position and Velocity: ${COUNT} problems`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const type = ['in-plane', 'cross', 'random'][k % 3];
        const p = Vis.state.generate(type);
        checkVisual(Vis.state, p, p.model.given);
        seen.add(p.answers.motion.value);
        if (type === 'in-plane') assert.strictEqual(p.model.rmoe.zmax, 0, 'in-plane has no swing');
        if (type === 'cross') assert.ok(p.model.rmoe.zmax > 0, 'cross has a swing');
    }
    assert.strictEqual(seen.size, 8, 'all eight motions appear');
});

check(`Visualize from RMOEs: ${COUNT} problems`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Vis.rmoe.generate(['in-plane', 'cross', 'random'][k % 3]);
        checkVisual(Vis.rmoe, p, null);
        seen.add(p.answers.motion.value);
        [p.model.rmoe.M0, p.model.rmoe.dM0].forEach(v => assert.ok(v === null || v % 5 === 0, '5° steps'));
    }
    assert.strictEqual(seen.size, 8, 'all eight motions appear');
});

/* ---------- 4 and 5. RMOE conversions ---------- */
check(`Position and Velocity to RMOEs: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Rmoe.generate('forward');
        checkNumeric(Rmoe, p);
        const { n, rmoe: r, given } = p.model;
        // The round answer, recovered from the rounded givens by the equation-sheet forms.
        const sheet = sheetRmoe(given, n);
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(p.answers[key].value, sheet[key], Math.max(0.005 * Math.abs(sheet[key]), 0.01), 'forward ' + key));
        if (r.C > 0) assert.ok(angleGap(p.answers.M0.value, sheet.M0) < 0.5, 'M0 ' + p.answers.M0.value + ' ' + sheet.M0);
        else assert.ok(sheet.C < 1e-3, 'C rounds to 0');
        if (r.zmax > 0) assert.ok(angleGap(p.answers.dM0.value, sheet.dM0) < 0.5, 'dM0');
        else assert.ok(sheet.zmax < 1e-3, 'zmax rounds to 0');
        near(p.answers.driftRev.value, -3 * Math.PI * sheet.xc, 0.02, 'drift km/rev');
        near(p.answers.drift.value, -1.5 * n * sheet.xc * 1000, 0.002, 'drift m/s');
    }
});

check(`RMOEs to Position and Velocity: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Rmoe.generate('reverse');
        checkNumeric(Rmoe, p);
        const { n, rmoe: r } = p.model;
        checkState(p, tableState(r, n), 1e-9, 'reverse');
        [r.M0, r.dM0].forEach(v => assert.ok(v === null || v % 90 === 0, 'corner angles'));
    }
});

/* ---------- 6. Burn Trajectories ---------- */
check(`Burn Trajectories: ${COUNT} problems against CW from the target`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Burns.generate(k % 2 ? 'drawing' : 'burn');
        checkPicks(Burns, p);
        const { n, rmoe: r, dv } = p.model;
        const which = (dv[0] > 0 ? '+R' : dv[0] < 0 ? '-R' : dv[1] > 0 ? '+I' : '-I');
        seen.add(p.type + which);
        // CW from the target with this burn, by hand: the rules of thumb.
        const v = Math.abs(dv[0] || dv[1]);
        const T = 2 * 2 * Math.PI / n;
        const after = M.cwPropagate([0, 0, 0, dv[0], dv[1], dv[2]], n, T);
        if (which[1] === 'R') {
            near(r.xc, 0, 1e-9, 'radial: no drift'); near(r.C, v / n, 1e-9, 'radial: C = dv/n');
            near(r.yc0, -2 * dv[0] / n, 1e-9, 'radial: center behind for +R'); near(after[1], 0, 1e-6, 'closed: back at the target');
        } else {
            near(r.xc, 2 * dv[1] / n, 1e-9, 'in-track: x_C = 2 dv/n'); near(r.C, Math.abs(r.xc), 1e-9, 'in-track: C = |x_C|');
            near(after[1], -3 * dv[1] * T, 1e-6, 'in-track: drifts -3 dv per second');
        }
        if (p.type === 'drawing') {
            const field = p.fields[0];
            assert.strictEqual(field.options.length, 4);
            const right = field.options.find(o => o.value === p.answers.plot.value);
            const spec = right.plots[0];
            ['xc', 'yc0', 'C'].forEach(key => near(spec.rmoe[key], r[key], 1e-12, 'right drawing ' + key));
            assert.strictEqual(new Set(field.options.map(o => Math.sign(o.plots[0].rmoe.xc) + ',' + Math.sign(o.plots[0].rmoe.yc0))).size, 4, 'four different drawings');
            field.options.forEach(o => assert.strictEqual(o.plots[0].fit.length, 2, 'a pair of drawings shares a scale'));
            assert.ok(p.model.dvGiven && !p.model.pathGiven);
        } else {
            assert.strictEqual(p.answers.burn.value, which, 'the burn named is the burn made');
            assert.ok(p.viewIsGiven && p.model.pathGiven, 'the view is the question');
        }
    }
    assert.strictEqual(seen.size, 8, 'both kinds with all four burns');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
