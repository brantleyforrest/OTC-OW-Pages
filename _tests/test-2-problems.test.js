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

/* ---------- 1. COE to RIC Signs ---------- */
check(`COE to RIC Signs: ${COUNT} problems, signs from the linear mapping by hand`, () => {
    const zeros = new Set(), signs = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Coeric.generate(['in-plane', 'cross', 'both', 'random'][k % 4]);
        checkPicks(Coeric, p);
        assert.deepStrictEqual(p.gridHeads, ['\\bar\\rho', '\\dot{\\bar\\rho}'], 'grid heads');
        assert.deepStrictEqual(p.fields.map(f => f.key), ['x', 'vx', 'y', 'vy', 'z', 'vz'], 'grid order: rows R, I, C');
        const { target, chase, n } = p.model;
        assert.strictEqual(target.argp, 0); assert.strictEqual(chase.argp, 0);
        assert.strictEqual(target.nu, chase.nu, 'same true anomaly');
        assert.ok([0, 90, 180, 270].includes(target.nu));
        if (chase.e > 0) assert.ok([0, 180].includes(chase.nu), 'perigee or apogee');
        // Homework-sized differences: a by 5 to 20 km, e from 0.001 to 0.002, angles by 0.1° to 0.5°.
        const da = Math.abs(chase.a - target.a), di0 = Math.abs(chase.i - target.i), dO0 = Math.abs(M.wrap180(chase.raan - target.raan));
        const inRange = (v, lo, hi) => v === 0 || (v >= lo - 1e-9 && v <= hi + 1e-9);
        assert.ok(inRange(da, 5, 20), 'a differs by 5 to 20 km: ' + da);
        assert.ok(inRange(chase.e, 0.001, 0.002), 'e from 0.001 to 0.002: ' + chase.e);
        assert.ok(inRange(di0, 0.1, 0.5), 'i differs by 0.1° to 0.5°: ' + di0);
        assert.ok(inRange(dO0, 0.1, 0.5), 'Ω differs by 0.1° to 0.5°: ' + dO0);
        assert.ok(da + chase.e + di0 + dO0 > 0, 'something differs');
        assert.ok(chase.a * (1 - chase.e) >= M.RE + 200, 'perigee at least 200 km up');
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
check('COE to RIC Signs: the exact answer departs beyond tolerance only where the solution says so', () => {
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
            // The exact model never flips a + or −, and keeps every 0 under 5 percent of the size
            // of the motion (largest exact position in km, or speed in km/s over n).
            const ev = exact[field.key].value, ans = p.answers[field.key].value;
            if (ans !== '0' && Math.sign(ev) !== (ans === '+' ? 1 : -1)) flips++;
            const j = STATE_KEYS.indexOf(field.key), n = p.model.n;
            const size = Math.max(...STATE_KEYS.map((key, q) => Math.abs(exact[key].value) / (q < 3 ? 1 : 1000 * n)));
            const limit = 0.05 * size * (j < 3 ? 1 : 1000 * n);
            if (ans === '0') assert.ok(Math.abs(ev) <= limit + 1e-9, 'a 0 stays near 0 exactly: ' + field.key + ' ' + ev);
        }
        assert.strictEqual(html.includes('The exact difference of the two orbits'), any, 'note shown exactly when needed');
    }
    console.log(`      ${off} of ${total} values fall outside the numeric tolerance when worked exactly; worst ${worst.toFixed(1)} times the tolerance`);
    assert.strictEqual(flips, 0, 'the exact model never flips a + or − answer');
});

/* ---------- 2 and 3. Visualize ---------- */
function checkVisual(module, p, given) {
    // Sketch and check: nothing to grade; the answer shown names the motion and reads the RMOEs.
    assert.ok(p.title && p.prompt && p.steps.length > 0 && p.limitsHtml, 'shape');
    assert.ok(p.selfCheck, 'a sketch-and-check problem');
    assert.strictEqual(p.fields.length, 0, 'no answer fields');
    const { n, rmoe: r } = p.model;
    assert.strictEqual(p.motion, motionFromParts(r), 'motion name from the parts');
    assert.strictEqual(M.classifyMotion(r).key, p.motion, 'motion name from classifyMotion');
    assert.ok(p.revealHtml.includes(Visual.LABEL[p.motion]), 'the answer names the motion');
    assert.strictEqual(p.model.revs, Visual.REVS, 'two revs, as the prompt says');
    assert.ok(M.sampleTrajectory(r, n, 0, Visual.REVS * 2 * Math.PI / n, 41).every(Number.isFinite), 'finite motion');
    if (given) {
        // The RMOEs worked from the rounded givens by the equation-sheet forms give the same motion.
        const sheet = sheetRmoe(given, n);
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(sheet[key], r[key], 0.01, 'givens give back ' + key));
        assert.strictEqual(motionFromParts(sheet), p.motion, 'motion from the givens');
        if (r.C > 0) assert.ok(angleGap(sheet.M0, r.M0) < 0.5, 'M0 from the givens');
        if (r.zmax > 0) assert.ok(angleGap(sheet.dM0, r.dM0) < 0.5, 'dM0 from the givens');
    }
}

check(`Visualize from ρ̄, ρ̄̇: ${COUNT} problems`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const type = ['in-plane', 'cross', 'random'][k % 3];
        const p = Vis.state.generate(type);
        checkVisual(Vis.state, p, p.model.given);
        seen.add(p.motion);
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
        seen.add(p.motion);
        [p.model.rmoe.M0, p.model.rmoe.dM0].forEach(v => assert.ok(v === null || v % 5 === 0, '5° steps'));
    }
    assert.strictEqual(seen.size, 8, 'all eight motions appear');
});

/* ---------- 4 and 5. RMOE conversions ---------- */
check(`ρ̄, ρ̄̇ to RMOEs: ${COUNT} problems`, () => {
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

check(`RMOEs to ρ̄, ρ̄̇: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Rmoe.generate('reverse');
        checkNumeric(Rmoe, p);
        const { n, rmoe: r } = p.model;
        checkState(p, tableState(r, n), 1e-9, 'reverse');
        [r.M0, r.dM0].forEach(v => assert.ok(v === null || v % 90 === 0, 'corner angles'));
    }
});

/* ---------- 6. Burn Trajectories ---------- */
check(`Burn Trajectories: ${COUNT} problems against CW from the start point`, () => {
    const seen = new Set(), starts = new Set();
    for (let k = 0; k < COUNT; k++) {
        const asked = ['random', '+R', '-R', '+I', '-I'][k % 5];
        const p = Burns.generate(asked);
        const { n, rmoe: r, dv } = p.model;
        const which = (dv[0] > 0 ? '+R' : dv[0] < 0 ? '-R' : dv[1] > 0 ? '+I' : '-I');
        if (asked !== 'random') assert.strictEqual(which, asked, 'the topic picks the burn');
        assert.strictEqual(p.type, which, 'the burn named is the burn made');
        seen.add(which);
        assert.ok(p.selfCheck && p.fields.length === 0 && p.model.dvGiven, 'draw, then check');
        assert.ok(p.revealHtml.includes(which.replace('-', '−')), 'the answer names the burn');
        assert.ok(p.prompt.includes(which.replace('-', '−')), 'the prompt names the burn');
        // Chase starts at rest: at the target or perched on the in-track axis.
        const y0 = p.model.start[1];
        assert.deepStrictEqual([p.model.start[0], ...p.model.start.slice(2)], [0, 0, 0, 0, 0], 'at rest on the in-track axis');
        assert.strictEqual(p.model.before.yc0, y0, 'the perch before the burn');
        starts.add(Math.sign(y0));
        if (y0) assert.ok(p.prompt.includes('perched ' + Math.abs(y0)), 'the prompt gives the perch');
        // CW from the start point with this burn, by hand: the rules of thumb.
        const v = Math.abs(dv[0] || dv[1]);
        const T = 2 * 2 * Math.PI / n;
        const after = M.cwPropagate([0, y0, 0, dv[0], dv[1], dv[2]], n, T);
        if (which[1] === 'R') {
            near(r.xc, 0, 1e-9, 'radial: no drift'); near(r.C, v / n, 1e-9, 'radial: C = dv/n');
            near(r.yc0, y0 - 2 * dv[0] / n, 1e-9, 'radial: center behind the burn point for +R'); near(after[1], y0, 1e-6, 'closed: back at the burn point');
        } else {
            near(r.xc, 2 * dv[1] / n, 1e-9, 'in-track: x_C = 2 dv/n'); near(r.C, Math.abs(r.xc), 1e-9, 'in-track: C = |x_C|');
            near(r.yc0, y0, 1e-9, 'in-track: center beside the burn point');
            near(after[1], y0 - 3 * dv[1] * T, 1e-6, 'in-track: drifts -3 dv per second');
        }
    }
    assert.strictEqual(seen.size, 4, 'all four burns');
    assert.strictEqual(starts.size, 3, 'starts at the target, ahead, and behind');
});

/* ---------- 7. Visualize from COEs ---------- */
check(`Visualize from COEs: ${COUNT} problems`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const type = ['in-plane', 'cross', 'both', 'random'][k % 4];
        const p = Vis.coe.generate(type);
        assert.strictEqual(p.model.kind, 'motion', 'both orbits in the view');
        checkVisual(Vis.coe, p, null);
        const { target, chase, rmoe: r } = p.model;
        const fresh = M.rmoeFromCoes(target, chase);
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(r[key], fresh[key], 1e-9, 'RMOEs from the elements ' + key));
        if (type === 'in-plane') assert.strictEqual(r.zmax, 0, 'in-plane has no swing');
        if (type === 'cross' || type === 'both') assert.ok(r.zmax > 0, 'cross has a swing');
        assert.ok(p.steps.every(s => !['tables'].includes(s.key)) && p.steps.at(-1).key === 'answer', 'steps end with the picture');
        seen.add(p.motion);
    }
    assert.ok(seen.size >= 6, 'many motions appear: ' + [...seen].join(', '));
});

/* ---------- 8. RMOEs Later ---------- */
check(`RMOEs Later: ${COUNT} problems against CW propagation`, () => {
    const fracs = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Rmoe.generate('later');
        checkNumeric(Rmoe, p);
        const { n, rmoe: r0 } = p.model;
        fracs.add(p.later);
        const t = p.later * 2 * Math.PI / n;
        // Independent route: propagate the epoch state with the CW equations, then read it back.
        const s = M.cwPropagate(M.stateFromRmoe(r0, n, 0), n, t);
        checkState(p, s, 1e-6, 'later');
        const sheet = sheetRmoe(s, n);
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(p.answers[key].value, sheet[key], 1e-6, 'later ' + key));
        if (r0.C > 0) assert.ok(angleGap(p.answers.M0.value, sheet.M0) < 1e-6, 'later M0');
        if (r0.zmax > 0) assert.ok(angleGap(p.answers.dM0.value, sheet.dM0) < 1e-6, 'later dM0');
        else assert.strictEqual(p.answers.dM0.value, null, 'no swing: dM0 undefined');
        // The new state is a boundary-table corner again.
        checkState(p, tableState({ xc: sheet.xc, yc0: sheet.yc0, C: sheet.C, zmax: sheet.zmax, M0: p.answers.M0.value, dM0: p.answers.dM0.value }, n), 1e-6, 'corner');
        near(p.answers.driftRev.value, -3 * Math.PI * r0.xc, 1e-9, 'drift km/rev');
        assert.deepStrictEqual(p.fields.slice(8).map(f => f.key), ['x', 'vx', 'y', 'vy', 'z', 'vz'], 'state in two columns');
    }
    assert.strictEqual(fracs.size, 3, 'a quarter, half, and whole period');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
