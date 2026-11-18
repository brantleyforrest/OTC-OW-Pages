// Run with: node _tests/test-2-problems.test.js
// Generates 200 problems per Test 2 Practice section and checks each answer independently.
const assert = require('node:assert');
globalThis.window = globalThis;
const M = require('../rpo/rpo-math.js');
globalThis.RpoMath = M;
// PracticeMath runs without KaTeX: math is shown as its TeX source.
require('../practice/practice-math.js');
require('../practice/test-2-common.js');
const Axes = require('../practice/test-2-axes-problems.js');
const Motion = require('../practice/test-2-motion-problems.js');
const Concepts = require('../practice/test-2-concepts-problems.js');
require('../practice/answer-check.js');
const Rmoe = require('../practice/test-2-rmoe-problems.js');
const Coeric = require('../practice/test-2-coeric-problems.js');
const Plots = require('../practice/test-2-plots-problems.js');
const Drift = require('../practice/test-2-drift-problems.js');
const Signs = require('../practice/test-2-signs-problems.js');

const COUNT = 200;
let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + (err.stack || err.message).split('\n').slice(0, 3).join('\n      ')); }
}

// Every ordinary problem: fields and answers line up, the exact answer grades right, and any
// other choice grades wrong.
function checkForm(module, p) {
    assert.ok(p.title && p.prompt && Array.isArray(p.fields) && Array.isArray(p.steps), 'shape');
    assert.ok(p.steps.length > 0, 'has steps');
    for (const field of p.fields) {
        const answer = p.answers[field.key];
        assert.ok(answer && answer.value !== undefined && answer.text, 'answer for ' + field.key);
        if (field.unitType === 'check') {
            assert.ok(answer.value === 0 || answer.value === 1, 'check value');
            assert.strictEqual(module.grade(field, answer.value ? '1' : '', answer.value), 'right');
            assert.strictEqual(module.grade(field, answer.value ? '' : '1', answer.value), 'wrong');
            continue;
        }
        const values = field.options.map(o => o.value);
        assert.ok(values.includes(answer.value), 'answer is one of the options for ' + field.key);
        assert.strictEqual(new Set(values).size, values.length, 'options are distinct');
        assert.strictEqual(module.grade(field, answer.value, answer.value), 'right');
        values.filter(v => v !== answer.value).forEach(v => assert.strictEqual(module.grade(field, v, answer.value), 'wrong'));
        assert.strictEqual(module.grade(field, '', answer.value), 'blank');
    }
}

// Table 5.9, worked from which elements differ, without the linear mapping.
function motionFromDifferences(target, chase) {
    const differs = k => Math.abs(M.wrap180 ? (k === 'a' || k === 'e' ? chase[k] - target[k] : M.wrap180(chase[k] - target[k])) : chase[k] - target[k]) > 1e-9;
    const drift = differs('a');
    const nmc = differs('e');
    const cross = differs('i') || (differs('raan') && target.i > 0);
    return ['perch', 'cross-track', 'stationary-nmc', 'nmc-cross-track', 'linear-drift', 'drifting-cross-track', 'drifting-nmc', 'corkscrew'][(drift ? 4 : 0) + (nmc ? 2 : 0) + (cross ? 1 : 0)];
}

check(`RIC Axes: ${COUNT} arrow problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Axes.generate('arrows');
        checkForm(Axes, p);
        assert.deepStrictEqual(p.fields.map(f => p.answers[f.key].value), p.model.arrows, 'answers follow the arrows');
        assert.deepStrictEqual([...p.model.arrows].sort(), ['C', 'I', 'R'], 'each axis once');
        assert.ok(Axes.views[p.model.view], 'known view');
        assert.ok(Number.isFinite(p.model.u), 'finite angle');
    }
});

check(`RIC Axes: ${COUNT} card decks`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Axes.generate('cards');
        assert.ok(p.matching && p.deck.length === 6, 'six cards');
        assert.strictEqual(new Set(p.deck.map(c => c.key)).size, 6, 'distinct keys');
    }
});

check(`Elements to Motion: ${COUNT} problems, answers worked independently`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Motion.generate(k < 88 ? Motion.combos[k % Motion.combos.length].key : 'random');
        checkForm(Motion, p);
        const { target, chase, rmoe } = p.model;
        seen.add(p.answers.motion.value);
        assert.strictEqual(p.answers.motion.value, motionFromDifferences(target, chase), 'motion name from the table');
        const again = M.rmoeFromCoes(target, chase);
        assert.strictEqual(M.classifyMotion(again).key, p.answers.motion.value, 'motion name from the RMOEs');
        ['xc', 'yc0', 'C', 'zmax'].forEach(key => assert.ok(Number.isFinite(rmoe[key]), key + ' finite'));
        // The right plot is the true motion; every other plot draws something else.
        const plotField = p.fields.find(f => f.unitType === 'plot');
        const right = plotField.options.find(o => o.value === p.answers.plot.value);
        assert.ok(right.plots[0].rmoe && Math.abs(right.plots[0].rmoe.xc - again.xc) < 1e-9 && Math.abs(right.plots[0].rmoe.C - again.C) < 1e-9 &&
            Math.abs(right.plots[0].rmoe.zmax - again.zmax) < 1e-9, 'right plot is the true motion');
        assert.strictEqual(plotField.options.length, 4, 'four plot choices');
        plotField.options.filter(o => o !== right).forEach(o => {
            const s = o.plots[0];
            if (s.path) return;                                  // a hand-made wrong picture
            const same = Math.abs(s.rmoe.xc - again.xc) < 1e-9 && Math.abs(s.rmoe.C - again.C) < 1e-9 && Math.abs(s.rmoe.zmax - again.zmax) < 1e-9;
            assert.ok(!same, 'a wrong plot differs from the right one');
        });
        plotField.options.forEach(o => o.plots.forEach(s => {
            const path = s.path || M.sampleTrajectory(s.rmoe, s.n, 0, s.revs * 2 * Math.PI / s.n, 50);
            assert.ok(path.every(Number.isFinite), 'finite plot');
        }));
    }
    assert.strictEqual(seen.size, 8, 'all eight motions appear');
});

check(`Concepts: ${COUNT} problems`, () => {
    const right = new Set(Concepts.assumptions.right.map(a => a.key));
    for (let k = 0; k < COUNT; k++) {
        const p = Concepts.generate(Concepts.types[k % Concepts.types.length]);
        if (p.matching) {
            assert.ok(p.deck.length >= 4, 'a deck');
            assert.strictEqual(new Set(p.deck.map(c => c.key)).size, p.deck.length, 'distinct keys');
            continue;
        }
        checkForm(Concepts, p);
        p.fields.forEach(f => assert.strictEqual(p.answers[f.key].value, right.has(f.key) ? 1 : 0, 'needed or not: ' + f.key));
        assert.strictEqual(p.fields.filter(f => p.answers[f.key].value === 1).length, 3, 'three needed');
    }
});

// Numeric problems: every answer finite (or undefined where allowed), the exact answer grades
// right, a number for an undefined answer grades wrong, and an answer 3 percent off (or past the
// floor, for values near zero; 3° for angles) grades wrong.
function checkNumeric(module, p) {
    assert.ok(p.title && p.prompt && p.steps.length > 0, 'shape');
    for (const field of p.fields) {
        const answer = p.answers[field.key];
        assert.ok(answer && answer.text, 'answer for ' + field.key);
        if (field.unitType === 'sign') {
            assert.ok(['+', '-', '0'].includes(answer.value), 'sign value');
            assert.strictEqual(module.grade(field, answer.value, answer.value), 'right');
            ['+', '-', '0'].filter(v => v !== answer.value).forEach(v => assert.strictEqual(module.grade(field, v, answer.value), 'wrong'));
            continue;
        }
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
// The equation-sheet forms (acos and asin with the quadrant rules), not the atan2 forms in RpoMath.
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

check(`Position and Velocity to RMOEs: ${COUNT} problems`, () => {
    const types = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Rmoe.generate(k % 2 ? 'forward' : 'reverse');
        checkNumeric(Rmoe, p);
        types.add(p.type);
        const { n, rmoe: r, given } = p.model;
        if (p.type === 'forward') {
            // The round answer, recovered from the rounded givens by the equation-sheet forms.
            const sheet = sheetRmoe(given, n);
            ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(p.answers[key].value, sheet[key], Math.max(0.005 * Math.abs(sheet[key]), 0.01), 'forward ' + key));
            if (r.C > 0) assert.ok(angleGap(p.answers.M0.value, sheet.M0) < 0.5, 'M0 ' + p.answers.M0.value + ' ' + sheet.M0);
            else assert.ok(sheet.C < 1e-3, 'C rounds to 0');
            if (r.zmax > 0) assert.ok(angleGap(p.answers.dM0.value, sheet.dM0) < 0.5, 'dM0');
            else assert.ok(sheet.zmax < 1e-3, 'zmax rounds to 0');
            near(p.answers.driftRev.value, -3 * Math.PI * sheet.xc, 0.02, 'drift km/rev');
            near(p.answers.drift.value, -1.5 * n * sheet.xc * 1000, 0.002, 'drift m/s');
        } else {
            checkState(p, tableState(r, n), 1e-9, 'reverse');
            [r.M0, r.dM0].forEach(v => assert.ok(v === null || v % 90 === 0, 'corner angles'));
        }
    }
    assert.strictEqual(types.size, 2);
});

check(`Elements to Position and Velocity: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Coeric.generate(['in-plane', 'cross', 'both', 'random'][k % 4]);
        checkNumeric(Coeric, p);
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
        checkState(p, s, 1e-6, 'linear');
        // The exact model agrees with the linear answer for these small differences.
        const ex = M.relativeState(target, chase, 0);
        const scale = Math.max(1, Math.hypot(...ex.rho));
        [0, 1, 2].forEach(j => near(p.answers[STATE_KEYS[j]].value, ex.rho[j], 0.03 * scale, 'exact ' + STATE_KEYS[j]));
    }
});

check(`Reading Plots: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Plots.generate(k % 2 ? 'read' : 'later');
        checkNumeric(Plots, p);
        assert.ok(p.viewIsGiven && p.model.labels, 'the view is the question');
        const { n, rmoe: r } = p.model;
        assert.ok(r.C > 0 && r.M0 % 90 === 0, 'chase on a corner');
        if (p.type === 'read') ['xc', 'yc0', 'C', 'zmax'].forEach(key => near(p.answers[key].value, r[key], 1e-12, 'read ' + key));
        else checkState(p, M.cwPropagate(M.stateFromRmoe(r, n, 0), n, p.later * 2 * Math.PI / n), 1e-6, 'CW');
    }
});

check(`Drift: ${COUNT} problems`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Drift.generate(k % 2 ? 'perch' : 'degrees');
        checkNumeric(Drift, p);
        const { n, rmoe: r, a } = p.model;
        if (p.type === 'perch') {
            // A perch, an in-track burn that changes a by x_C, then one rev of CW motion.
            const s = M.applyBurn([0, r.yc0, 0, 0, 0, 0], [0, n / 2 * r.xc, 0]);
            near(p.answers.y1.value, M.cwPropagate(s, n, 2 * Math.PI / n)[1], 1e-6, 'y after one rev');
            near(p.answers.ycDay.value, M.rmoeAt(M.rmoeFromState(s, n), n, 86400).yc0, 1e-6, 'center after a day');
        } else {
            const perRev = -3 * Math.PI * r.xc / (2 * Math.PI * a) * 360;
            near(p.answers.perRev.value, perRev, 1e-9, 'deg per rev');
            near(p.answers.perDay.value, perRev * 86400 * n / (2 * Math.PI), 1e-9, 'deg per day');
        }
    }
});

check('Drift: the GEO check in 5.13 (20 km behind, a lowered 5 km)', () => {
    const n = M.meanMotion(M.GEO_A);
    near(-20 + 3 * Math.PI * 5, 27.12, 0.005, 'one rev');
    near(-20 + 1.5 * n * 5 * 86400, 27.25, 0.005, 'one day');
});

check(`RMOE Signs: ${COUNT} problems match the table`, () => {
    const TABLE = {
        'nmc-ahead': '0+000', 'nmc-behind': '0+000', lower: '-+0++', raise: '++0--', 'drift-bottom': '-000+', 'drift-top': '+000-',
        'cross-bottom': '0++00', 'cross-perch': '00++0', halve: '0+0+0', 'stop-radial': '000-0', 'stop-drift': '0+0+0', forward: '++00-'
    };
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const p = Signs.generate(Signs.templates[k % Signs.templates.length]);
        checkNumeric(Signs, p);
        seen.add(p.type);
        assert.strictEqual(['xc', 'C', 'zmax', 'yc0', 'drift'].map(f => p.answers[f].value).join(''), TABLE[p.type], 'signs for ' + p.type);
    }
    assert.strictEqual(seen.size, 12, 'all twelve scenarios');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
