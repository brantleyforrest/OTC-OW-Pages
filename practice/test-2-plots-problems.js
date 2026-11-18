// Test 2 Practice, Reading Plots (#plots). The view is part of the question: the view from the
// left and the view from behind, with labeled dimensions (the NMC center, its height and length,
// the cross-track width, chase's position, and an arrow for its direction of motion).
//  - read: find the six RMOEs from the plots.
//  - later: find chase's position and velocity a quarter, half, or one rev later.
// Angles are at multiples of 90°, so chase sits on a corner and a boundary-table row.
// No DOM access. Load after rpo-math.js, practice-math.js, test-2-common.js, test-2-rmoe-problems.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const LATER = [[0.25, 'a quarter rev'], [0.5, 'half a rev'], [1, 'one rev']];

    function pickTruth(a) {
        let r = global.Test2RmoeProblems.pickRmoe(a, true);
        if (r.C === 0) r = Object.assign(r, { C: C2.halfKm(1, C2.sizesFor(a).C), M0: 90 * C2.randInt(0, 3) });
        return r;
    }

    function readSteps(r, n, a) {
        const corner = C2.cornerName(r.M0);
        const sw = C2.swingName(r.dM0);
        return [
            { key: 'xc', title: 'Center: x<sub>C</sub> and y<sub>C0</sub>', result: '$x_C = ' + C2.texNum(C2.plain(r.xc, 2)) + '$, $y_{C0} = ' + C2.texNum(C2.plain(r.yc0, 2)) + '$',
              caption: 'The cross marks the NMC center at epoch. Its height is x<sub>C</sub>; its place along the track is y<sub>C0</sub>.',
              methods: [{ name: 'Read', html: rule('From the left, the center is ' + C2.plain(Math.abs(r.xc), 2) + ' km ' + (r.xc >= 0 ? 'above' : 'below') + ' the target and ' +
                  C2.plain(Math.abs(r.yc0), 2) + ' km ' + (r.yc0 >= 0 ? 'ahead (to the left)' : 'behind (to the right)') + '.', '$x_C = ' + C2.texNum(C2.plain(r.xc, 2)) + '$ km, $y_{C0} = ' + C2.texNum(C2.plain(r.yc0, 2)) + '$ km') +
                  (Math.abs(r.xc) > 1e-9 ? note('The center is ' + (r.xc > 0 ? 'above' : 'below') + ' the target, so the loops walk ' + (r.xc > 0 ? 'backward' : 'forward') + '.') : '') }] },
            { key: 'C', title: 'Size: C', result: '$C = ' + C2.plain(r.C, 2) + '$ km',
              caption: 'The NMC is 2C tall and 4C long.',
              methods: [{ name: 'Read', html: calc('C = \\tfrac{1}{2}\\,\\text{height}', ['\\tfrac{1}{2} \\times ' + C2.plain(2 * r.C, 2)], C2.plain(r.C, 2) + '\\ \\text{km}') +
                  note('Check: the length is $4C = ' + C2.plain(4 * r.C, 2) + '$ km.') }] },
            { key: 'M0', title: 'Place on the NMC: M<sub>0</sub>', result: '$M_0 = ' + r.M0 + '°$',
              caption: 'Chase is at the ' + corner + ' of the NMC.',
              methods: [{ name: 'Read', html: rule('Chase is at the ' + corner + ' of the NMC (0° bottom, 90° front, 180° top, 270° back).', '$M_0 = ' + r.M0 + '°$') }] },
            { key: 'zmax', title: 'Swing: z<sub>max</sub>', result: '$z_{max} = ' + C2.plain(r.zmax, 2) + '$ km',
              caption: 'From behind, chase swings z<sub>max</sub> to each side of the target’s plane.',
              methods: [{ name: 'Read', html: r.zmax > 0 ? calc('z_{max} = \\tfrac{1}{2}\\,\\text{width}', ['\\tfrac{1}{2} \\times ' + C2.plain(2 * r.zmax, 2)], C2.plain(r.zmax, 2) + '\\ \\text{km}')
                  : rule('From behind, chase never leaves the target’s plane.', '$z_{max} = 0$') }] },
            { key: 'dM0', title: 'Place in the swing: ΔM<sub>0</sub>', result: r.dM0 === null ? 'undefined' : '$\\Delta M_0 = ' + r.dM0 + '°$',
              caption: 'Chase’s side position and the arrow’s direction from behind give ΔM<sub>0</sub>.',
              methods: [{ name: 'Read', html: r.dM0 === null ? rule('$z_{max} = 0$: there is no swing, so $\\Delta M_0$ is undefined.')
                  : rule('From behind, chase is at its ' + sw + (r.dM0 % 180 === 0 ? ', moving ' + (r.dM0 === 0 ? 'left' : 'right') : '') + '.', '$\\Delta M_0 = ' + r.dM0 + '°$') }] }
        ];
    }

    function generate(type) {
        const later = type === 'later' || (type !== 'read' && C2.chance(0.5));
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const r = pickTruth(a);
        const steps = readSteps(r, n, a);
        const model = { kind: 'rel', a, n, rmoe: r, revs: 1, labels: true, showStart: true };
        const base = {
            model, viewIsGiven: true,
            overviewCaption: 'From the left (+I to the left) and from behind (+C to the left). The dotted ellipse is the NMC at epoch; the arrow shows which way chase is moving.'
        };
        if (!later) {
            steps.push({ key: 'answer', title: 'What the motion looks like', result: '', caption: 'The motion, played over one rev.',
                methods: [{ name: 'Reading', html: note(C2.reading(r, n, a)) }] });
            return Object.assign(base, {
                type: 'read', title: 'Reading Plots',
                prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. The plots show chase’s motion at epoch. Read the six RMOEs.'),
                statement: C2.givenItem('a', C2.plain(a, 2), 'km'),
                limitsHtml: C2.LIMITS,
                fields: C2.RMOE_FIELDS(),
                answers: C2.rmoeAnswers(r),
                steps
            });
        }
        const [frac, words] = C2.pick(LATER);
        const P = 2 * Math.PI / n, t = frac * P;
        const s = M.stateFromRmoe(r, n, t);
        const at = M.rmoeAt(r, n, t);
        const yd = -1.5 * n * r.xc;
        const ms = v => C2.fixed(v * 1000, 4);
        const corner = C2.cornerName(at.M0);
        const sw = C2.swingName(at.dM0);
        const advanceHtml = [
            calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{398600.44 / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}'),
            rule(words.charAt(0).toUpperCase() + words.slice(1) + ' adds ' + (360 * frac) + '° to both angles.',
                '$M = ' + C2.fixed(at.M0, 0) + '°$' + (at.dM0 === null ? '' : ', $\\Delta M = ' + C2.fixed(at.dM0, 0) + '°$')),
            calc('y_C = y_{C0} - 3\\pi x_C \\times ' + frac, [p(r.yc0, 2) + ' - 3\\pi \\times ' + p(r.xc, 2) + ' \\times ' + frac], C2.fixed(at.yc0, 3) + '\\ \\text{km}')
        ].join('');
        steps.push({ key: 'advance', title: 'Advance ' + words, result: 'the ' + corner,
            caption: 'The angles advance; the center drifts; the size stays.', methods: [{ name: 'Advance', html: advanceHtml }] });
        steps.push({ key: 'answer', title: 'Read the boundary tables', result: '',
            caption: 'The motion, played over one rev.',
            methods: [{ name: 'Tables', html: [
                calc('\\dot y_C = -\\tfrac{3}{2} n x_C', [], ms(yd) + '\\ \\text{m/s}'),
                rule('At the ' + corner + (sw ? ' and the ' + sw : ' with no swing') + ':'),
                calc('x', [], C2.fixed(s[0], 3) + '\\ \\text{km}'), calc('y', [], C2.fixed(s[1], 3) + '\\ \\text{km}'), calc('z', [], C2.fixed(s[2], 3) + '\\ \\text{km}'),
                calc('\\dot x', [], ms(s[3]) + '\\ \\text{m/s}'), calc('\\dot y', [], ms(s[4]) + '\\ \\text{m/s}'), calc('\\dot z', [], ms(s[5]) + '\\ \\text{m/s}')
            ].join('') + note(C2.reading(at, n, a)) }] });
        return Object.assign(base, {
            type: 'later', title: 'Reading Plots: Later',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. The plots show chase’s motion at epoch. Find chase’s position and velocity ' + words + ' later.'),
            statement: C2.givenItem('a', C2.plain(a, 2), 'km') + '<div class="given-item">Time: ' + words + ' after epoch</div>',
            limitsHtml: C2.LIMITS.replace(/ Tick.*$/, ''),
            fields: C2.STATE_FIELDS(),
            answers: C2.stateAnswers(s),
            later: frac,
            steps
        });
    }

    global.Test2PlotsProblems = { generate, grade: C2.grade };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2PlotsProblems;
