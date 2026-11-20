// Test 2 Practice, the two Visualize sections: picture the motion before calculating anything.
//  - #vis-state: given chase's RIC position and velocity at epoch.
//  - #vis-rmoe: given chase's six RMOEs.
// The student draws the motion on paper (from the left and from behind, over two revs), then shows
// the answer and checks the drawing against it; nothing is graded. The RMOEs are picked first from round values for a chosen
// motion; for #vis-state the given state is worked from them and rounded as #rmoe does.
// Topic types: 'random', 'in-plane' (no cross-track motion), 'cross' (with cross-track motion).
// No DOM access. Load after test-review-math.js, practice-math.js, test-2-common.js, test-2-visual.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const VZ = global.Test2Visual;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const roundState = s => s.map((v, k) => (k < 3 ? Number(v.toFixed(4)) : Number((v * 1000).toFixed(6)) / 1000));

    function pickMotion(type) {
        const pool = type === 'in-plane' ? VZ.IN_PLANE
            : type === 'cross' ? VZ.MOTIONS.map(m => m.value).filter(k => VZ.PARTS[k].includes('Z'))
                : VZ.MOTIONS.map(m => m.value);
        return C2.pick(pool);
    }

    // Round RMOEs that give exactly the motion named. Angles sit on a corner of the NMC or the
    // swing most of the time (as in the homework), otherwise on any 5° step.
    function pickRmoe(key, a) {
        const s = C2.sizesFor(a);
        const parts = VZ.PARTS[key];
        const angle = () => (C2.chance(0.7) ? 90 * C2.randInt(0, 3) : C2.stepIn(0, 355, 5));
        const xc = parts.includes('D') ? C2.sign() * C2.halfKm(0.5, s.xc) : 0;
        const C = parts.includes('E') ? C2.halfKm(1, s.C) : 0;
        const zmax = parts.includes('Z') ? C2.halfKm(1, s.C) : 0;
        let yc0 = C2.chance(key === 'perch' ? 0 : 0.25) ? 0 : C2.halfKm(-s.y, s.y);
        if (key === 'perch' && Math.abs(yc0) < 2) yc0 = (yc0 < 0 ? -1 : 1) * C2.halfKm(2, s.y);
        return { xc, yc0, C, M0: C > 0 ? angle() : null, zmax, dM0: zmax > 0 ? angle() : null };
    }

    const nStep = (a, n) => ({ key: 'n', title: 'Mean motion of the target', result: '$n = ' + sci(n) + '$ rad/s',
        caption: 'n sets how fast every angle advances: one turn per target orbit.',
        methods: [{ name: 'Formula', html: calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{' + M.MU + ' / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}') }] });

    // What each RMOE does to the picture, in words.
    function centerWords(r) {
        if (Math.abs(r.xc) < 1e-6) return 'The center is level with the target, so there is no drift.';
        return 'The center is ' + C2.plain(Math.abs(r.xc), 3) + ' km ' + (r.xc > 0 ? 'above' : 'below') + ' the target, so it drifts ' +
            (r.xc > 0 ? 'backward (higher is slower)' : 'forward (lower is faster)') + ', about ' + C2.plain(3 * Math.PI * Math.abs(r.xc), 1) + ' km each rev.';
    }
    function alongWords(r) {
        if (Math.abs(r.yc0) < 1e-6) return 'At epoch the center is right beside the target along the track.';
        return 'At epoch the center is ' + C2.plain(Math.abs(r.yc0), 3) + ' km ' + (r.yc0 > 0 ? 'ahead of' : 'behind') + ' the target.';
    }
    function ellipseWords(r) {
        if (r.C < 1e-6) return 'No ellipse: chase sits on the center itself.';
        return 'A 2-by-1 ellipse ' + C2.plain(2 * r.C, 3) + ' km tall and ' + C2.plain(4 * r.C, 3) + ' km long around the center, traced clockwise in the view from the left (bottom, front, top, back).';
    }
    function startWords(r) {
        if (r.C < 1e-6) return 'With no ellipse there is no place on it.';
        const corner = C2.cornerName(r.M0);
        return '$M_0 = ' + C2.fixed(r.M0, 0) + '°$: chase starts ' + (corner ? 'at the ' + corner : 'between the corners') + ' of the ellipse (0° bottom, 90° front, 180° top, 270° back).';
    }
    function swingWords(r) {
        if (r.zmax < 1e-6) return 'No swing: chase stays in the target’s plane.';
        const sw = C2.swingName(r.dM0);
        return 'Chase swings ' + C2.plain(r.zmax, 3) + ' km to each side of the target’s plane. $\\Delta M_0 = ' + C2.fixed(r.dM0, 0) + '°$' +
            (sw ? ' puts it at its ' + sw : '') + ' (0° +P.C. moving left, 90° far left, 180° −P.C., 270° far right).';
    }

    // A sketch-and-check problem: no answer fields. The student draws the motion on paper, then
    // shows the answer (the motion in the view and its name) and checks the drawing against it.
    function finish(r, n, a, type, key, extra) {
        const label = VZ.LABEL[key];
        return Object.assign({
            type,
            title: '',
            selfCheck: true,
            overviewCaption: 'Chase (gold triangle) at epoch. The answer or the walkthrough adds the motion.',
            limitsHtml: 'On paper, draw two views over two revs: from the left (+R up, +I to the left) and from behind (+R up, +C to the left). ' +
                'Mark the target, where chase starts, and arrows for the way it moves, and name the motion. Then show the answer and check your drawing against it.',
            revealHtml: prose('<b>' + label + '.</b> ' + C2.reading(r, n, a)),
            fields: [],
            answers: {},
            motion: key
        }, extra);
    }

    /* ---------- from position and velocity ---------- */
    function fromState(type) {
        const key = pickMotion(type);
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const truth = pickRmoe(key, a);
        const s = roundState(M.stateFromRmoe(truth, n, 0));
        const [x0, y0, z0, vx, vy, vz] = s;
        const vms = v => p(v * 1000, 6) + '/1000';
        const steps = [nStep(a, n)];
        steps.push({ key: 'xc', title: 'Above or below: x<sub>C</sub>', result: '$x_C = ' + C2.texNum(C2.fixed(truth.xc, 2)) + '$ km',
            caption: 'x<sub>C</sub> is the height of the center; it sets the drift.',
            methods: [{ name: 'Formula', html: calc('x_C = 4x_0 + \\frac{2\\dot y_0}{n}', ['4' + p(x0, 4) + ' + \\frac{2' + vms(vy) + '}{' + sci(n) + '}'], C2.fixed(truth.xc, 2) + '\\ \\text{km}') + rule(centerWords(truth)) }] });
        steps.push({ key: 'yc0', title: 'Ahead or behind: y<sub>C0</sub>', result: '$y_{C0} = ' + C2.texNum(C2.fixed(truth.yc0, 2)) + '$ km',
            caption: 'y<sub>C0</sub> is where the center is along the track at epoch.',
            methods: [{ name: 'Formula', html: calc('y_{C0} = y_0 - \\frac{2\\dot x_0}{n}', [p(y0, 4) + ' - \\frac{2' + vms(vx) + '}{' + sci(n) + '}'], C2.fixed(truth.yc0, 2) + '\\ \\text{km}') + rule(alongWords(truth)) }] });
        steps.push({ key: 'C', title: 'An ellipse? C', result: '$C = ' + C2.fixed(truth.C, 2) + '$ km',
            caption: 'C is the ellipse’s radial half-height.',
            methods: [{ name: 'Formula', html: calc('C = \\sqrt{(x_C - x_0)^2 + \\left(\\frac{y_{C0} - y_0}{2}\\right)^2}',
                ['\\sqrt{' + p(truth.xc - x0, 4) + '^2 + ' + p((truth.yc0 - y0) / 2, 4) + '^2}'], C2.fixed(truth.C, 2) + '\\ \\text{km}') + rule(ellipseWords(truth)) +
                (truth.C > 0 ? rule('Where chase starts: ' + (x0 < truth.xc - 1e-3 ? 'below' : x0 > truth.xc + 1e-3 ? 'above' : 'level with') + ' the center and ' +
                    (y0 > truth.yc0 + 1e-3 ? 'ahead of' : y0 < truth.yc0 - 1e-3 ? 'behind' : 'even with') + ' it. ' + startWords(truth)) : '') }] });
        steps.push({ key: 'zmax', title: 'Side to side? z<sub>max</sub>', result: '$z_{max} = ' + C2.fixed(truth.zmax, 2) + '$ km',
            caption: 'z<sub>max</sub> is how far chase swings to each side of the target’s plane.',
            methods: [{ name: 'Formula', html: calc('z_{max} = \\sqrt{z_0^2 + (\\dot z_0 / n)^2}',
                ['\\sqrt{' + p(z0, 4) + '^2 + \\left(\\frac{' + vms(vz) + '}{' + sci(n) + '}\\right)^2}'], C2.fixed(truth.zmax, 2) + '\\ \\text{km}') +
                rule(truth.zmax > 0 ? 'Chase is ' + (Math.abs(z0) < 1e-3 ? 'in the target’s plane' : (z0 > 0 ? 'left' : 'right') + ' of the target’s plane') + ' and moving ' +
                    (Math.abs(vz) < 1e-9 ? 'neither way (at the end of its swing)' : vz > 0 ? 'left' : 'right') + '. ' + swingWords(truth) : swingWords(truth)) }] });
        steps.push({ key: 'answer', title: 'The picture', result: VZ.LABEL[key],
            caption: 'The motion over two revs, from the left and from behind.',
            methods: [{ name: 'Result', html: rule('Put the parts together: ' + VZ.LABEL[key] + '.', VZ.LABEL[key]) + note(C2.reading(truth, n, a)) }] });
        return finish(truth, n, a, type, key, {
            model: { kind: 'rel', a, n, rmoe: truth, revs: VZ.REVS, showStart: true, given: s },
            title: 'Visualize from Position and Velocity',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase’s position and velocity in the RIC frame at epoch are given. Before calculating anything, picture the motion and draw it.'),
            statement: C2.givenState(s),
            steps
        });
    }

    /* ---------- from RMOEs ---------- */
    function fromRmoe(type) {
        const key = pickMotion(type);
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const r = pickRmoe(key, a);
        const steps = [
            { key: 'xc', title: 'Center height, x<sub>C</sub>', result: Math.abs(r.xc) > 0 ? (r.xc > 0 ? 'above: drifts back' : 'below: drifts forward') : 'level: no drift',
              caption: 'x<sub>C</sub> is the height of the center; it sets the drift.', methods: [{ name: 'Meaning', html: rule(centerWords(r)) }] },
            { key: 'yc0', title: 'Center along the track, y<sub>C0</sub>', result: Math.abs(r.yc0) > 0 ? (r.yc0 > 0 ? 'ahead' : 'behind') : 'beside the target',
              caption: 'y<sub>C0</sub> is where the center is along the track at epoch.', methods: [{ name: 'Meaning', html: rule(alongWords(r)) }] },
            { key: 'C', title: 'The ellipse: C and M<sub>0</sub>', result: r.C > 0 ? C2.plain(2 * r.C, 2) + ' by ' + C2.plain(4 * r.C, 2) + ' km' : 'none',
              caption: 'C is the ellipse’s radial half-height; M<sub>0</sub> is where chase starts on it.', methods: [{ name: 'Meaning', html: rule(ellipseWords(r)) + (r.C > 0 ? rule(startWords(r)) : '') }] },
            { key: 'zmax', title: 'Side to side: z<sub>max</sub> and ΔM<sub>0</sub>', result: r.zmax > 0 ? '±' + C2.plain(r.zmax, 2) + ' km' : 'none',
              caption: 'z<sub>max</sub> is how far chase swings to each side; ΔM<sub>0</sub> is where it starts in the swing.', methods: [{ name: 'Meaning', html: rule(swingWords(r)) }] },
            { key: 'answer', title: 'The picture', result: VZ.LABEL[key],
              caption: 'The motion over two revs, from the left and from behind.',
              methods: [{ name: 'Result', html: rule('Put the parts together: ' + VZ.LABEL[key] + '.', VZ.LABEL[key]) + note(C2.reading(r, n, a)) }] }
        ];
        return finish(r, n, a, type, key, {
            model: { kind: 'rel', a, n, rmoe: r, revs: VZ.REVS, showStart: true },
            title: 'Visualize from RMOEs',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase’s RMOEs at epoch are given. Picture the motion and draw it.'),
            statement: C2.givenRmoe(r),
            steps
        });
    }

    global.Test2VisStateProblems = { generate: fromState, grade: C2.grade, pickRmoe };
    global.Test2VisRmoeProblems = { generate: fromRmoe, grade: C2.grade, pickRmoe };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = { state: globalThis.Test2VisStateProblems, rmoe: globalThis.Test2VisRmoeProblems };
