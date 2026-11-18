// Test 2 Practice, RMOE Signs (#signs). A one-sentence scenario at GEO: chase is somewhere and
// makes one burn for a stated purpose. Five sign fields (+, −, 0): x_C, C, z_max, y_C0, and the
// drift rate ẏ_C, just after the burn. Each problem is built from a starting state and the burn
// the purpose calls for, then RpoMath.rmoeFromState; nothing is looked up from a table.
// No DOM access. Load after rpo-math.js, practice-math.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const A = M.GEO_A;
    const N = M.meanMotion(A);
    const ZERO_KM = 1e-6, ZERO_RATE = 1e-12;
    const FIELDS = [['xc', 'x_C', 'NMC center, radial'], ['C', 'C', 'NMC size'], ['zmax', 'z_{max}', 'Cross-track size'],
        ['yc0', 'y_{C0}', 'NMC center, in-track'], ['drift', '\\dot y_C', 'Drift rate']];
    const SYMBOL = { '+': '+', '-': '−', '0': '0' };

    const centered = (C, M0) => M.stateFromRmoe({ xc: 0, yc0: 0, C, M0, zmax: 0, dM0: null }, N, 0);
    const perched = y => [0, y, 0, 0, 0, 0];

    // Each template: the scenario, a starting state, and the burn (km/s). d, C, delta, z in km.
    const TEMPLATES = [
        { key: 'nmc-ahead', make: v => ({ text: `Chase is perched ${v.d} km ahead of the target. It burns to enter an NMC centered on the target.`, s: perched(v.d), dv: [N * v.d / 2, 0, 0], axis: 'radial' }) },
        { key: 'nmc-behind', make: v => ({ text: `Chase is perched ${v.d} km behind the target. It burns to enter an NMC centered on the target.`, s: perched(-v.d), dv: [-N * v.d / 2, 0, 0], axis: 'radial' }) },
        { key: 'lower', make: v => ({ text: `Chase is perched ${v.d} km ahead of the target. It burns to lower its semi-major axis by ${v.delta} km.`, s: perched(v.d), dv: [0, -N / 2 * v.delta, 0], axis: 'in-track' }) },
        { key: 'raise', make: v => ({ text: `Chase is perched ${v.d} km behind the target. It burns to raise its semi-major axis by ${v.delta} km.`, s: perched(-v.d), dv: [0, N / 2 * v.delta, 0], axis: 'in-track' }) },
        { key: 'drift-bottom', make: v => { const s = centered(v.C, 0); return { text: `Chase is at the bottom of a ${v.C} km NMC centered on the target. It burns to enter a linear drift.`, s, dv: [-s[3], -1.5 * N * s[0] - s[4], 0], axis: 'in-track' }; } },
        { key: 'drift-top', make: v => { const s = centered(v.C, 180); return { text: `Chase is at the top of a ${v.C} km NMC centered on the target. It burns to enter a linear drift.`, s, dv: [-s[3], -1.5 * N * s[0] - s[4], 0], axis: 'in-track' }; } },
        { key: 'cross-bottom', make: v => ({ text: `Chase is at the bottom of a ${v.C} km NMC centered on the target. It burns cross-track to start a ${v.z} km side-to-side swing.`, s: centered(v.C, 0), dv: [0, 0, N * v.z], axis: 'cross-track' }) },
        { key: 'cross-perch', make: v => { const dir = C2.sign(); return { text: `Chase is perched ${v.d} km ahead of the target. It burns ${dir > 0 ? 'left' : 'right'} to start a ${v.z} km side-to-side swing.`, s: perched(v.d), dv: [0, 0, dir * N * v.z], axis: 'cross-track' }; } },
        { key: 'halve', make: v => ({ text: `Chase is at the front of a ${v.C} km NMC centered on the target. A radial burn halves the NMC’s size.`, s: centered(v.C, 90), dv: [-N * v.C / 2, 0, 0], axis: 'radial' }) },
        { key: 'stop-radial', make: v => ({ text: `Chase is at the back of a ${v.C} km NMC centered on the target. A radial burn stops its radial motion.`, s: centered(v.C, 270), dv: [N * v.C, 0, 0], axis: 'radial' }) },
        { key: 'stop-drift', make: v => { const s = [v.h, v.d, 0, 0, -1.5 * N * v.h, 0]; return { text: `Chase is in a linear drift ${v.h} km above the target, now ${v.d} km ahead. It burns to stop the drift.`, s, dv: [0, -N / 2 * v.h, 0], axis: 'in-track' }; } },
        { key: 'forward', make: v => ({ text: `Chase is at the front of a ${v.C} km NMC centered on the target. It burns forward to raise its center by ${2 * v.delta} km.`, s: centered(v.C, 90), dv: [0, N * v.delta, 0], axis: 'in-track' }) }
    ];
    const AXIS_RULE = {
        radial: 'A radial burn moves the NMC center forward or backward and changes C and M; it leaves x<sub>C</sub> and the drift alone.',
        'in-track': 'An in-track burn moves the NMC center up or down, so it starts, stops, or changes the drift; it also changes C and M.',
        'cross-track': 'A cross-track burn changes only the side-to-side swing (z<sub>max</sub> and ΔM); every in-plane RMOE stays.'
    };

    const signOf = (v, zero) => (Math.abs(v) <= zero ? '0' : v > 0 ? '+' : '-');
    function signsAfter(r) {
        const drift = -1.5 * N * r.xc;
        return { xc: signOf(r.xc, ZERO_KM), C: signOf(r.C, ZERO_KM), zmax: signOf(r.zmax, ZERO_KM), yc0: signOf(r.yc0, ZERO_KM), drift: signOf(drift, ZERO_RATE) };
    }

    function generate(type) {
        const tpl = type && type !== 'random' ? (TEMPLATES.find(t => t.key === type) || C2.pick(TEMPLATES)) : C2.pick(TEMPLATES);
        const v = { d: C2.stepIn(10, 40, 5), C: C2.randInt(2, 10), delta: C2.randInt(1, 5), z: C2.randInt(2, 10), h: C2.randInt(1, 5) };
        const sc = tpl.make(v);
        const after = M.applyBurn(sc.s, sc.dv);
        const r0 = M.rmoeFromState(sc.s, N);
        const r = M.rmoeFromState(after, N);
        const signs = signsAfter(r);
        const drift = -1.5 * N * r.xc;
        const ms = x => C2.fixed(x * 1000, 4);
        const kmT = x => C2.texNum(C2.fixed(Math.abs(x) < ZERO_KM ? 0 : x, 3));
        const vals = { xc: kmT(r.xc) + '\\ \\text{km}', C: kmT(r.C) + '\\ \\text{km}', zmax: kmT(r.zmax) + '\\ \\text{km}', yc0: kmT(r.yc0) + '\\ \\text{km}', drift: C2.texNum(ms(Math.abs(drift) < ZERO_RATE ? 0 : drift)) + '\\ \\text{m/s}' };
        const why = {
            xc: signs.xc === '0' ? 'the center is level with the target' : 'the center is ' + (signs.xc === '+' ? 'above' : 'below') + ' the target',
            C: signs.C === '0' ? 'there is no NMC' : 'chase is on an NMC',
            zmax: signs.zmax === '0' ? 'chase stays in the target’s plane' : 'chase now swings to the side',
            yc0: signs.yc0 === '0' ? 'the center is beside the target along the track' : 'the center is ' + (signs.yc0 === '+' ? 'ahead of' : 'behind') + ' the target',
            drift: signs.drift === '0' ? 'with x<sub>C</sub> = 0 there is no drift' : (signs.drift === '+' ? 'below the target the center drifts forward' : 'above the target the center drifts backward')
        };
        const stateHtml = calc('\\rho_0', [], '[' + sc.s.slice(0, 3).map(x => C2.fixed(x, 3)).join(',\\ ') + ']\\ \\text{km}') +
            calc('\\dot\\rho_0', [], '[' + sc.s.slice(3).map(ms).join(',\\ ') + ']\\ \\text{m/s}');
        const steps = [
            { key: 'given', title: 'The state before the burn', result: '',
              caption: 'Where chase is, and how it moves, just before the burn.',
              methods: [{ name: 'State', html: rule(C2.reading(r0, N, A)) + stateHtml }] },
            { key: 'burn', title: 'What the burn changes', result: sc.axis,
              caption: 'Which RMOEs a burn along this axis can change.',
              methods: [{ name: 'Rule', html: rule(AXIS_RULE[sc.axis]) + calc('\\Delta V', [], '[' + sc.dv.map(ms).join(',\\ ') + ']\\ \\text{m/s}') }] },
            { key: 'answer', title: 'Each sign', result: FIELDS.map(([k]) => SYMBOL[signs[k]]).join(' '),
              caption: 'The motion just after the burn.',
              methods: [{ name: 'Signs', html: FIELDS.map(([k, tex]) => rule('$' + tex + ' = ' + vals[k] + '$: ' + why[k] + '.', SYMBOL[signs[k]])).join('') +
                  note(C2.reading(r, N, A)) }] }
        ];
        return {
            type: tpl.key,
            model: { kind: 'rel', a: A, n: N, rmoe: r, revs: 2, showStart: true, start: sc.s, before: r0, dv: sc.dv },
            title: 'RMOE Signs',
            prompt: prose('The target is geostationary. ' + sc.text + ' Just after the burn, is each RMOE positive, negative, or zero?'),
            statement: '',
            overviewCaption: 'Chase (gold triangle) just before the burn, on its old path.',
            limitsHtml: 'Pick +, −, or 0 for each.',
            fields: FIELDS.map(([key, tex, name]) => ({ key, tex, name, unitType: 'sign' })),
            answers: Object.fromEntries(FIELDS.map(([k]) => [k, { value: signs[k], text: SYMBOL[signs[k]] }])),
            steps
        };
    }

    global.Test2SignsProblems = { generate, grade: C2.grade, templates: TEMPLATES.map(t => t.key), signsAfter };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2SignsProblems;
