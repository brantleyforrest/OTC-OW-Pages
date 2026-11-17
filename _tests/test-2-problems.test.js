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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
