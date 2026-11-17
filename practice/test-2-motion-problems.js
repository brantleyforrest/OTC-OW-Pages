// Test 2 Practice, Elements to Motion (#motion). The problem gives the classical orbital elements
// of a target in a circular orbit and of a chase that differs in one to three of a, e, i, Omega,
// and nu. The student names the relative motion and picks the pair of plots (from the left and
// from behind) that shows it. Answers come from the linear mapping (RpoMath.rmoeFromCoes).
// No DOM access. Load after rpo-math.js, practice-math.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, rule, note } = global.PracticeMath;

    const MOTIONS = [
        { value: 'perch', html: 'Perch' },
        { value: 'linear-drift', html: 'Drift' },
        { value: 'stationary-nmc', html: 'NMC' },
        { value: 'drifting-nmc', html: 'Drifting NMC' },
        { value: 'cross-track', html: 'Cross-track motion' },
        { value: 'drifting-cross-track', html: 'Drift with cross-track motion' },
        { value: 'nmc-cross-track', html: 'Cross-Track NMC' },
        { value: 'corkscrew', html: 'Corkscrew' }
    ];
    const LABEL = Object.fromEntries(MOTIONS.map(m => [m.value, m.html]));

    // The combinations of table "elements to relative motion", and the motion each one gives.
    // inclined: the combination needs an inclined target (a node difference does nothing at i = 0).
    const COMBOS = [
        { diffs: ['nu'], key: 'perch' },
        { diffs: ['a'], key: 'linear-drift' },
        { diffs: ['e'], key: 'stationary-nmc' },
        { diffs: ['i'], key: 'cross-track' },
        { diffs: ['raan'], key: 'cross-track', inclined: true },
        { diffs: ['a', 'e'], key: 'drifting-nmc' },
        { diffs: ['a', 'e', 'i'], key: 'corkscrew' },
        { diffs: ['a', 'e', 'raan'], key: 'corkscrew', inclined: true },
        { diffs: ['raan', 'a'], key: 'drifting-cross-track', inclined: true },
        { diffs: ['i', 'a'], key: 'drifting-cross-track' },
        { diffs: ['e', 'i'], key: 'nmc-cross-track' }
    ];
    const INCLINED_A = [6517.16, 6750, 6900, 7000, 26562];
    const LEO_I = [28.5, 45, 51.6, 63.4];
    const REVS = 2;

    const NAMES = { a: 'semi-major axis $a$', e: 'eccentricity $e$', i: 'inclination $i$', raan: 'right ascension of the ascending node $\\Omega$', nu: 'true anomaly $\\nu$' };
    const EFFECT = {
        nu: 'A different position in the same circular orbit is a fixed point ahead or behind: a perch.',
        a: 'A different semi-major axis is a different period, so chase drifts steadily. Larger $a$ drifts backward; smaller $a$ drifts forward.',
        e: 'A different eccentricity with the same period makes chase trace a 2-by-1 ellipse: an NMC.',
        i: 'A different inclination tilts chase’s plane, so chase swings left and right of the target’s plane once per rev.',
        raan: 'A different node turns chase’s plane about Earth’s axis. With an inclined target, the planes cross twice per rev, so chase swings left and right.'
    };

    // Small differences, sized for each kind of target orbit.
    function sizes(a) {
        if (a > 40000) return { da: [1, 10], C: [2, 10], ang: [0.005, 0.03, 0.005], nu: [0.01, 0.05, 0.005] };
        if (a > 20000) return { da: [1, 8], C: [2, 8], ang: [0.005, 0.03, 0.005], nu: [0.01, 0.05, 0.005] };
        return { da: [1, 5], C: [1, 5], ang: [0.01, 0.05, 0.01], nu: [0.02, 0.1, 0.01] };
    }

    function pickCombo(type) {
        const pool = type && type !== 'random' ? COMBOS.filter(c => c.key === type) : COMBOS;
        return C2.pick(pool.length ? pool : COMBOS);
    }

    // Plot paths. A plot is { rmoe, n, revs, plane } or, for a drawing no RMOE can make, { path, plane }.
    function sample(rmoe, n) { return M.sampleTrajectory(rmoe, n, 0, REVS * 2 * Math.PI / n, 120 * REVS + 1); }
    function tallPath(rmoe, n) {
        // The same motion with the ellipse stood on end (twice as tall as it is wide): a common mistake.
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
    function pairFor(spec, n) {
        if (spec.path) return [{ path: spec.path, plane: 'left' }, { path: spec.path, plane: 'behind' }];
        return [{ rmoe: spec.rmoe, n, revs: REVS, plane: 'left' }, { rmoe: spec.rmoe, n, revs: REVS, plane: 'behind' }];
    }

    // Three wrong pictures, in the order the build notes ask for, then fillers.
    function distractors(rmoe, n) {
        const eps = 1e-6;
        const D = Math.abs(rmoe.xc) > eps, E = rmoe.C > eps, Z = rmoe.zmax > eps;
        const size = Math.max(rmoe.C, Math.abs(rmoe.xc) * 2, rmoe.zmax, Math.abs(rmoe.yc0) / 3, 2);
        const out = [];
        if (D) out.push({ why: 'drift the wrong way', rmoe: { ...rmoe, xc: -rmoe.xc } });
        if (E) out.push({ why: 'ellipse drawn tall', path: tallPath(rmoe, n) });
        if (Z) out.push({ why: 'no cross-track motion', rmoe: { ...rmoe, zmax: 0, dM0: null } });
        else out.push({ why: 'cross-track motion added', rmoe: { ...rmoe, zmax: size * 0.8, dM0: 0 } });
        if (!E) out.push({ why: 'an ellipse added', rmoe: { ...rmoe, C: size * 0.6, M0: 0 } });
        if (E && !D) out.push({ why: 'a drift added', rmoe: { ...rmoe, xc: size * 0.4 * C2.sign() } });
        if (D && E) out.push({ why: 'drift with no ellipse', rmoe: { ...rmoe, C: 0, M0: null } });
        if (!D) out.push({ why: 'a drift added', rmoe: { ...rmoe, xc: size * 0.4 * C2.sign() } });
        if (E) out.push({ why: 'no ellipse', rmoe: { ...rmoe, C: 0, M0: null } });
        return out.slice(0, 3);
    }

    function fmtAngle(v) { return C2.plain(v, 4); }
    function statementHtml(target, chase, diffs) {
        const rows = [['a', 'a', 'km', v => C2.plain(v, 2)], ['e', 'e', '', v => C2.plain(v, 7)], ['i', 'i', '°', fmtAngle],
            ['raan', '\\Omega', '°', fmtAngle], ['argp', '\\omega', '°', fmtAngle], ['nu', '\\nu', '°', fmtAngle]];
        const body = rows.map(([k, tex, unit, f]) => {
            const differs = Math.abs(target[k] - chase[k]) > 1e-12;
            return '<tr' + (differs ? ' class="differs"' : '') + '><th>' + prose('$' + tex + '$') + '</th><td>' + f(target[k]) + (unit ? ' ' + unit : '') +
                '</td><td>' + f(chase[k]) + (unit ? ' ' + unit : '') + '</td></tr>';
        }).join('');
        return '<div class="given-item given-wide"><table class="el-given"><thead><tr><th></th><th>Target</th><th>Chase</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    function reading(rmoe, n, a) {
        const parts = [];
        const drift = M.driftRate(rmoe, n, a).kmPerRev;
        if (Math.abs(rmoe.xc) > 1e-6) parts.push('drifts ' + (drift < 0 ? 'backward' : 'forward') + ' about ' + C2.plain(Math.abs(drift), 1) + ' km each rev (it is ' + C2.plain(Math.abs(rmoe.xc), 2) + ' km ' + (rmoe.xc > 0 ? 'above' : 'below') + ' the target on average)');
        else if (rmoe.C < 1e-6 && rmoe.zmax < 1e-6) parts.push('stays ' + C2.plain(Math.abs(rmoe.yc0), 2) + ' km ' + (rmoe.yc0 >= 0 ? 'ahead of' : 'behind') + ' the target');
        if (rmoe.C > 1e-6) parts.push('traces a 2-by-1 ellipse ' + C2.plain(2 * rmoe.C, 2) + ' km tall and ' + C2.plain(4 * rmoe.C, 2) + ' km long');
        if (rmoe.zmax > 1e-6) parts.push('swings up to ' + C2.plain(rmoe.zmax, 2) + ' km to each side of the target’s plane');
        const last = parts.pop();
        return 'Chase ' + (parts.length ? parts.join(', ') + ', and ' : '') + last + '.';
    }

    function generate(type) {
        const combo = pickCombo(type);
        for (let attempt = 0; attempt < 20; attempt++) {
            const a = combo.inclined ? C2.pick(INCLINED_A) : C2.pickTargetA();
            const geo = Math.abs(a - M.GEO_A) < 1;
            const target = {
                a, e: 0,
                i: geo ? 0 : Math.abs(a - 26562) < 1 ? 55 : C2.pick(LEO_I),
                raan: geo ? 0 : C2.stepIn(0, 355, 5),
                argp: 0,
                nu: C2.stepIn(0, 355, 5)
            };
            const s = sizes(a);
            const diff = { da: 0, de: 0, di: 0, draan: 0, dargp: 0, dnu: 0 };
            if (combo.diffs.includes('a')) diff.da = C2.sign() * C2.randInt(s.da[0], s.da[1]);
            if (combo.diffs.includes('i')) diff.di = (target.i > 0 ? C2.sign() : 1) * C2.stepIn(s.ang[0], s.ang[1], s.ang[2]);   // i cannot go below 0
            if (combo.diffs.includes('raan')) diff.draan = C2.sign() * C2.stepIn(s.ang[0], s.ang[1], s.ang[2]);
            if (combo.diffs.includes('nu')) diff.dnu = C2.sign() * C2.stepIn(s.nu[0], s.nu[1], s.nu[2]);
            const chase = M.coeFromDifference(target, diff);
            if (combo.diffs.includes('e')) chase.e = Number((C2.randInt(s.C[0], s.C[1]) / chase.a).toFixed(7));
            // Round the chase angles for display; the answer is worked from the numbers shown.
            ['i', 'raan', 'nu'].forEach(k => { chase[k] = Number(chase[k].toFixed(4)); });
            const rmoe = M.rmoeFromCoes(target, chase);
            const n = M.meanMotion(a);
            if (M.classifyMotion(rmoe).key !== combo.key) continue;      // never show a problem whose answer is not the one named

            const correct = { rmoe };
            const options = C2.shuffle([correct].concat(distractors(rmoe, n))).map((spec, k) => ({ value: 'ABCD'[k], plots: pairFor(spec, n), spec }));
            const answerPlot = options.find(o => o.spec === correct).value;
            options.forEach(o => { delete o.spec; });

            const diffList = combo.diffs.map(k => NAMES[k]);
            const drift = M.driftRate(rmoe, n, a);
            const effects = combo.diffs.map(k => {
                let num = '';
                if (k === 'a') num = ' Here $x_C = \\Delta a = ' + C2.plain(rmoe.xc, 2) + '$ km, so the drift is $-3\\pi x_C = ' + C2.texNum(C2.plain(drift.kmPerRev, 2)) + '$ km/rev.';
                if (k === 'e') num = ' Here $C = a_{chase} e_{chase} = ' + C2.plain(rmoe.C, 3) + '$ km.';
                if (k === 'i' || k === 'raan') num = ' Here $z_{max} = ' + C2.plain(rmoe.zmax, 3) + '$ km.';
                if (k === 'nu') num = ' Here chase sits $y_{C0} = ' + C2.texNum(C2.plain(rmoe.yc0, 3)) + '$ km along the track.';
                return rule(EFFECT[k] + num);
            }).join('');
            const label = LABEL[combo.key];
            const read = reading(rmoe, n, a);

            return {
                type: combo.key,
                model: { kind: 'motion', target, chase, rmoe, n, revs: REVS },
                title: 'Elements to Motion',
                prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit. Chase is on the orbit given beside it. Name the relative motion, and pick the pair of plots (from the left, then from behind) that shows it over two revs.'),
                statement: statementHtml(target, chase, combo.diffs),
                overviewCaption: 'The target (green square) and chase (gold triangle), each on its own orbit. The RIC panes are empty until the walkthrough reaches the motion.',
                limitsHtml: 'Pick one motion and one pair of plots. In each plot, +I is to the left (from the left) and +C is to the left (from behind).',
                fields: [
                    { key: 'motion', tex: '', name: 'Relative motion', unitType: 'choice', options: MOTIONS },
                    { key: 'plot', tex: '', name: 'Plots (left, then behind)', unitType: 'plot', options }
                ],
                answers: {
                    motion: { value: combo.key, text: label },
                    plot: { value: answerPlot, text: 'Plots ' + answerPlot }
                },
                steps: [
                    { key: 'diff', title: 'Which elements differ', result: combo.diffs.map(k => ({ a: 'a', e: 'e', i: 'i', raan: 'Ω', nu: 'ν' })[k]).join(', '),
                      caption: 'Compare the two columns: only the highlighted rows differ.',
                      methods: [{ name: 'Compare', html: rule('Chase differs from the target in its ' + diffList.join(', ') + '. Everything else is the same.') }] },
                    { key: 'effects', title: 'What each difference does', result: '',
                      caption: 'Each difference adds one thing to the motion in the RIC frame.',
                      methods: [{ name: 'Effects', html: effects }] },
                    { key: 'answer', title: 'The combined motion', result: label,
                      caption: 'The combined motion, from the left and from behind, beside both orbits.',
                      methods: [{ name: 'Result', html: rule('Put the effects together: ' + label + '.', label) + note(read) }] }
                ]
            };
        }
        return generate(type);
    }

    function grade(field, text, truth) {
        if (!String(text).trim()) return 'blank';
        return String(text) === String(truth) ? 'right' : 'wrong';
    }

    global.Test2MotionProblems = { generate, grade, motions: MOTIONS, combos: COMBOS };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2MotionProblems;
