// Test 2 Practice, Burn Trajectories (#burns). Chase starts at the target (x_C = y_C0 = C = 0) and
// makes one burn straight up (+R), down (−R), forward (+I), or back (−I). The motion is drawn over
// two revs in the view from the left.
//  - drawing: given the burn, pick its drawing from the four (one per burn direction).
//  - burn: given the drawing (the view is part of the question), name the burn.
// Every path is the course model (TestReviewMath.rpo.rmoeFromState of the state just after the burn).
// No DOM access. Load after test-review-math.js, practice-math.js, test-2-common.js, test-2-visual.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const VZ = global.Test2Visual;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const BURNS = [
        { value: '+R', html: '+R (up)', axis: 0, sign: 1 },
        { value: '-R', html: '−R (down)', axis: 0, sign: -1 },
        { value: '+I', html: '+I (forward)', axis: 1, sign: 1 },
        { value: '-I', html: '−I (back)', axis: 1, sign: -1 }
    ];
    const NAME = Object.fromEntries(BURNS.map(b => [b.value, b.html]));
    const AT_TARGET = { xc: 0, yc0: 0, C: 0, M0: null, zmax: 0, dM0: null };

    // Burn sizes in m/s that give motions a few km across.
    function dvChoices(a) {
        if (a > 40000) return [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
        if (a > 20000) return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        return [0.5, 1, 1.5, 2, 2.5, 3];
    }

    const dvVector = (burn, dvKmS) => { const v = [0, 0, 0]; v[burn.axis] = burn.sign * dvKmS; return v; };
    const rmoeAfter = (burn, dvKmS, n) => M.rmoeFromState(M.applyBurn([0, 0, 0, 0, 0, 0], dvVector(burn, dvKmS)), n);

    // What each burn does, in words.
    const LOOK = {
        '+R': 'a closed ellipse entirely behind the target; chase goes up first, swings back, and returns to the target each rev. No drift.',
        '-R': 'a closed ellipse entirely ahead of the target; chase goes down first, swings forward, and returns to the target each rev. No drift.',
        '+I': 'loops above the target that drift backward; each loop touches the target’s altitude once per rev, farther behind each time.',
        '-I': 'loops below the target that drift forward; each loop touches the target’s altitude once per rev, farther ahead each time.'
    };

    function generate(type) {
        const kind = type === 'drawing' || type === 'burn' ? type : C2.pick(['drawing', 'burn']);
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const dvMs = C2.pick(dvChoices(a));
        const dv = dvMs / 1000;
        const burn = C2.pick(BURNS);
        const r = rmoeAfter(burn, dv, n);
        const radial = burn.axis === 0;

        // The four drawings. The ±R pair shares one scale and the ±I pair another, so a radial
        // ellipse is not shrunk to a dot beside the larger in-track loops.
        const all = Object.fromEntries(BURNS.map(b => [b.value, rmoeAfter(b, dv, n)]));
        const fitFor = b => (b.axis === 0 ? [all['+R'], all['-R']] : [all['+I'], all['-I']]);
        const options = C2.shuffle(BURNS).map((b, k) => ({ value: 'ABCD'[k], burn: b.value,
            plots: [{ rmoe: all[b.value], n, revs: VZ.REVS, plane: 'left', fit: fitFor(b) }] }));
        const answerPlot = options.find(o => o.burn === burn.value).value;
        options.forEach(o => { delete o.burn; });

        const ms = v => C2.fixed(v * 1000, 4);
        const ruleHtml = radial
            ? calc('x_C = 4x_0 + \\frac{2\\dot y_0}{n}', [], '0') +
              calc('y_{C0} = y_0 - \\frac{2\\dot x_0}{n}', ['-\\frac{2 \\times (' + C2.texNum(C2.plain(burn.sign * dvMs, 3)) + '/1000)}{' + sci(n) + '}'], C2.texNum(C2.fixed(r.yc0, 3)) + '\\ \\text{km}') +
              calc('C = \\frac{|\\dot x_0|}{n}', ['\\frac{' + C2.plain(dvMs, 3) + '/1000}{' + sci(n) + '}'], C2.fixed(r.C, 3) + '\\ \\text{km}') +
              rule('A radial burn moves the center forward or back and makes an ellipse, but leaves $x_C = 0$: no drift. ' +
                  (burn.sign > 0 ? 'Up puts the center behind the target.' : 'Down puts the center ahead of the target.'))
            : calc('x_C = 4x_0 + \\frac{2\\dot y_0}{n}', ['\\frac{2 \\times (' + C2.texNum(C2.plain(burn.sign * dvMs, 3)) + '/1000)}{' + sci(n) + '}'], C2.texNum(C2.fixed(r.xc, 3)) + '\\ \\text{km}') +
              calc('C = |x_C - x_0|', [], C2.fixed(r.C, 3) + '\\ \\text{km}') +
              calc('\\dot y_C = -\\tfrac{3}{2} n x_C = -3\\dot y_0', [], C2.texNum(ms(-1.5 * n * r.xc)) + '\\ \\text{m/s}') +
              rule('An in-track burn moves the center up or down, so it starts a drift. ' +
                  (burn.sign > 0 ? 'Forward raises the orbit: higher is slower, so chase drifts backward.' : 'Back lowers the orbit: lower is faster, so chase drifts forward.'));

        const steps = [
            { key: 'given', title: kind === 'burn' ? 'Read the picture' : 'Before the burn', result: kind === 'burn' ? (radial ? 'closed loop' : 'drifting loops') : 'at the target',
              caption: kind === 'burn' ? 'Is the path closed or does it drift? Which side of the target is it on?' : 'Chase sits on the target with no relative motion until the burn.',
              methods: [{ name: 'Start', html: kind === 'burn'
                  ? rule('The path ' + (radial ? 'closes on itself each rev, so there is no drift: the burn was radial. It lies ' + (burn.sign > 0 ? 'behind' : 'ahead of') + ' the target.'
                      : 'drifts ' + (burn.sign > 0 ? 'backward (to the right in the view from the left), in loops above' : 'forward (to the left in the view from the left), in loops below') + ' the target: the burn was in-track.'))
                  : rule('$x_C = y_{C0} = C = 0$: chase starts at the target. Right after the burn its velocity is the burn, $\\dot\\rho_0 = \\Delta V$.') }] },
            { key: 'burn', title: radial ? 'What a radial burn does' : 'What an in-track burn does', result: NAME[burn.value],
              caption: 'The burn arrow shows the direction of the ΔV.',
              methods: [{ name: 'Rule', html: ruleHtml }] },
            { key: 'answer', title: 'The motion', result: NAME[burn.value],
              caption: 'Two revs after the burn, in the view from the left.',
              methods: [{ name: 'Result', html: rule('A ' + NAME[burn.value] + ' burn gives ' + LOOK[burn.value]) + note(C2.reading(r, n, a)) }] }
        ];

        const orbit = 'The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase starts at the target ($x_C = y_{C0} = C = 0$)';
        const common = {
            model: { kind: 'rel', a, n, rmoe: r, revs: VZ.REVS, showStart: true, start: [0, 0, 0, 0, 0, 0], before: AT_TARGET, dv: dvVector(burn, dv),
                dvGiven: kind === 'drawing', pathGiven: kind === 'burn' },
            statement: '',
            steps
        };
        if (kind === 'drawing') {
            return Object.assign(common, {
                type: 'drawing',
                title: 'Burn Trajectories: Pick the Drawing',
                prompt: prose(orbit + ' and burns ' + C2.plain(dvMs, 3) + ' m/s straight ' + { '+R': 'up (+R)', '-R': 'down (−R)', '+I': 'forward (+I)', '-I': 'back (−I)' }[burn.value] + '. Pick the drawing of its motion over the next two revs.'),
                overviewCaption: 'Chase at the target, with the burn arrow.',
                limitsHtml: 'Each drawing is the view from the left (+R up, +I to the left). The ring is the start (the target) and the triangle is chase two revs later.',
                fields: [{ key: 'plot', tex: '', name: 'Drawing', unitType: 'plot', options }],
                answers: { plot: { value: answerPlot, text: 'Drawing ' + answerPlot } }
            });
        }
        return Object.assign(common, {
            type: 'burn',
            viewIsGiven: true,
            title: 'Burn Trajectories: Pick the Burn',
            prompt: prose(orbit + ' and makes one burn straight up, down, forward, or back. The view shows its path over the next two revs. Which burn was it?'),
            overviewCaption: 'Chase’s path over two revs after the burn. From the left, +I is drawn to the left.',
            limitsHtml: 'Pick one burn.',
            fields: [{ key: 'burn', tex: '', name: 'The burn', unitType: 'choice', options: BURNS.map(b => ({ value: b.value, html: b.html })) }],
            answers: { burn: { value: burn.value, text: NAME[burn.value] } }
        });
    }

    global.Test2BurnsProblems = { generate, grade: C2.grade, burns: BURNS.map(b => b.value), rmoeAfter };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2BurnsProblems;
