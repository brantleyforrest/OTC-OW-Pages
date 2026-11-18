// Test 2 Practice, Drift (#drift). Two of the three variants (the third, an in-track burn that
// drifts chase to the target, comes with the maneuver topics):
//  - perch: chase is perched d km ahead or behind and changes its semi-major axis by Δa. Find y
//    one rev later and the NMC center's y one day later.
//  - degrees: at GEO, given Δa, find the drift in degrees per rev and per day.
// No DOM access. Load after rpo-math.js, practice-math.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const DAY = 86400;

    function perch() {
        const a = C2.pickTargetA();
        const n = M.meanMotion(a), P = 2 * Math.PI / n;
        const s = C2.sizesFor(a);
        const d = C2.sign() * C2.randInt(Math.ceil(s.y / 4), s.y);
        const da = C2.sign() * C2.halfKm(0.5, s.xc);
        const y1 = d - 3 * Math.PI * da;
        const yd = -1.5 * n * da;
        const ycDay = d + yd * DAY;
        const revsDay = DAY / P;
        // The motion after the change: an NMC of size |Δa| whose center is Δa above the perch.
        const rmoe = { xc: da, yc0: d, C: Math.abs(da), M0: da > 0 ? 0 : 180, zmax: 0, dM0: null };
        const where = Math.abs(d) + ' km ' + (d > 0 ? 'ahead of' : 'behind');
        const steps = [
            { key: 'xc', title: 'The new center height', result: '$x_C = ' + C2.texNum(C2.plain(da, 2)) + '$ km',
              caption: 'Changing a by Δa puts the NMC center Δa above the target’s orbit; chase starts at its ' + (da > 0 ? 'bottom' : 'top') + '.',
              methods: [{ name: 'Rule', html: rule('$x_C = a_{chase} - a_{target} = \\Delta a$.', '$x_C = ' + C2.texNum(C2.plain(da, 2)) + '$ km') +
                  note('The center is ' + (da > 0 ? 'above' : 'below') + ' the target, so chase drifts ' + (da > 0 ? 'backward' : 'forward') + '.') }] },
            { key: 'drift', title: 'Drift per rev', result: '$' + C2.texNum(C2.fixed(-3 * Math.PI * da, 3)) + '$ km/rev',
              caption: 'The center moves −3π x<sub>C</sub> along the track every rev.',
              methods: [{ name: 'Formula', html: calc('\\Delta y_{rev} = -3\\pi x_C', ['-3\\pi \\times ' + p(da, 2)], C2.fixed(-3 * Math.PI * da, 3) + '\\ \\text{km}') }] },
            { key: 'y1', title: 'Where chase is one rev later', result: '$y = ' + C2.texNum(C2.fixed(y1, 3)) + '$ km',
              caption: 'After one whole rev chase is back at the same point of its NMC, which has drifted.',
              methods: [{ name: 'Add', html: calc('y_1 = d - 3\\pi \\Delta a', [p(d, 0) + ' - 3\\pi \\times ' + p(da, 2)], C2.fixed(y1, 3) + '\\ \\text{km}') }] },
            { key: 'day', title: 'The center one day later', result: '$y_C = ' + C2.texNum(C2.fixed(ycDay, 3)) + '$ km',
              caption: 'A day is not a whole number of revs, so follow the center, which drifts steadily.',
              methods: [{ name: 'Per second', html: calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{398600.44 / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}') +
                  calc('\\dot y_C = -\\tfrac{3}{2} n x_C', ['-1.5 \\times ' + sci(n) + ' \\times ' + p(da, 2)], sci(yd) + '\\ \\text{km/s}') +
                  calc('y_C = y_{C0} + \\dot y_C \\times 86400\\ \\text{s}', [p(d, 0) + ' + ' + p(yd, 8) + ' \\times 86400'], C2.fixed(ycDay, 3) + '\\ \\text{km}') },
                { name: 'Per rev', html: calc('P = 2\\pi / n', [], C2.fixed(P, 1) + '\\ \\text{s}') +
                  calc('\\text{revs per day} = 86400 / P', [], C2.fixed(revsDay, 4)) +
                  calc('y_C = d - 3\\pi \\Delta a \\times ' + C2.fixed(revsDay, 4), [], C2.fixed(ycDay, 3) + '\\ \\text{km}') }] },
            { key: 'answer', title: 'What the motion looks like', result: '', caption: 'Chase’s motion after the change, over two revs.',
              methods: [{ name: 'Reading', html: note('Chase loops in an NMC ' + C2.plain(2 * Math.abs(da), 2) + ' km tall that drifts ' + (da > 0 ? 'backward' : 'forward') + ' about ' +
                  C2.plain(Math.abs(3 * Math.PI * da), 1) + ' km each rev, so a day later its center is ' + C2.plain(Math.abs(ycDay), 1) + ' km ' + (ycDay >= 0 ? 'ahead of' : 'behind') + ' the target.') }] }
        ];
        return {
            type: 'perch',
            model: { kind: 'rel', a, n, rmoe, revs: 2, showStart: true },
            title: 'Drift: Perch and Δa',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase is perched ' + where + ' the target. A burn ' +
                (da > 0 ? 'raises' : 'lowers') + ' chase’s semi-major axis by ' + C2.plain(Math.abs(da), 2) + ' km. Where is chase one rev later, and where is the center of its motion one day later?'),
            statement: C2.givenItem('a', C2.plain(a, 2), 'km') + C2.givenItem('y_0', String(d), 'km') + C2.givenItem('\\Delta a', C2.plain(da, 2), 'km'),
            overviewCaption: 'Chase (gold triangle) at its perch, just before the burn.',
            limitsHtml: 'Within 1 percent (at least 0.02 km). Ahead of the target is positive.',
            fields: [C2.fKm('y1', 'y', 'In-track position one rev later'), C2.fKm('ycDay', 'y_C', 'Center one day later')],
            answers: { y1: C2.ansKm(y1), ycDay: C2.ansKm(ycDay) },
            steps
        };
    }

    function degrees() {
        const a = M.GEO_A;
        const n = M.meanMotion(a), P = 2 * Math.PI / n;
        const da = C2.sign() * C2.stepIn(5, 100, 5);
        const perRev = -540 / a * da;
        const perDay = perRev * DAY / P;
        const rmoe = { xc: da, yc0: 0, C: 0, M0: null, zmax: 0, dM0: null };
        const steps = [
            { key: 'xc', title: 'Center height', result: '$x_C = ' + C2.texNum(C2.plain(da, 0)) + '$ km',
              caption: 'The difference in semi-major axis is the height of the center.',
              methods: [{ name: 'Rule', html: rule('$x_C = \\Delta a$.', '$x_C = ' + C2.texNum(C2.plain(da, 0)) + '$ km') }] },
            { key: 'drift', title: 'Degrees per rev', result: '$' + C2.texNum(C2.fixed(perRev, 4)) + '°$/rev',
              caption: 'The drift as an angle around the orbit.',
              methods: [{ name: 'Formula', html: calc('\\dot y_C = -\\frac{540}{a_{target}}\\, x_C', ['-\\frac{540}{42164} \\times ' + p(da, 0)], C2.fixed(perRev, 4) + '°\\ \\text{per rev}') +
                  note('This is $-3\\pi x_C$ km per rev turned into degrees: $\\frac{-3\\pi x_C}{2\\pi a} \\times 360° = -\\frac{540}{a} x_C$.') }] },
            { key: 'answer', title: 'Degrees per day', result: '$' + C2.texNum(C2.fixed(perDay, 4)) + '°$/day',
              caption: 'A GEO rev is a sidereal day, a little shorter than 86400 s.',
              methods: [{ name: 'Per day', html: calc('P = 2\\pi\\sqrt{a^3/\\mu}', [], C2.fixed(P, 1) + '\\ \\text{s}') +
                  calc('\\dot y_C = ' + p(perRev, 4) + '° \\times \\frac{86400}{' + C2.fixed(P, 1) + '}', [], C2.fixed(perDay, 4) + '°\\ \\text{per day}') +
                  note('Rule of thumb: about 78 km of $\\Delta a$ gives 1° per day. Here ' + C2.plain(Math.abs(da), 0) + ' km gives about ' + C2.plain(Math.abs(perDay), 2) + '° per day, ' + (da > 0 ? 'westward (backward)' : 'eastward (forward)') + '.') }] }
        ];
        return {
            type: 'degrees',
            model: { kind: 'rel', a, n, rmoe, revs: 2, showStart: true },
            title: 'Drift: Degrees at GEO',
            prompt: prose('The target is geostationary ($a = 42164$ km). Chase’s orbit is circular and ' + C2.plain(Math.abs(da), 0) + ' km ' + (da > 0 ? 'larger' : 'smaller') + '. How fast does chase drift, in degrees per rev and per day?'),
            statement: C2.givenItem('a', '42164', 'km') + C2.givenItem('\\Delta a', C2.plain(da, 0), 'km'),
            overviewCaption: 'Chase (gold triangle) on its own circular orbit.',
            limitsHtml: 'Within 1 percent (at least 0.001°). Forward (east) is positive.',
            fields: [{ key: 'perRev', tex: '\\dot y_C', name: 'Drift per rev', unit: '°/rev', tolerance: C2.TOL.rate, unitType: 'rate' },
                { key: 'perDay', tex: '\\dot y_C', name: 'Drift per day', unit: '°/day', tolerance: C2.TOL.rate, unitType: 'rate' }],
            answers: { perRev: { value: perRev, text: C2.fixed(perRev, 4) + '°/rev' }, perDay: { value: perDay, text: C2.fixed(perDay, 4) + '°/day' } },
            steps
        };
    }

    function generate(type) {
        if (type === 'perch') return perch();
        if (type === 'degrees') return degrees();
        return C2.chance(0.6) ? perch() : degrees();
    }

    global.Test2DriftProblems = { generate, grade: C2.grade };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2DriftProblems;
