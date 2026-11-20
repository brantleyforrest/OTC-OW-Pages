// Test 2 Practice, Burn Trajectories (#burns). Chase starts at the target (x_C = y_C0 = C = 0) and
// makes one burn straight up (+R), down (−R), forward (+I), or back (−I). The motion is drawn over
// two revs in the view from the left. The student draws it on paper, then shows the answer (the
// motion in the view and in words) and checks the drawing against it; nothing is graded.
// Topic types: 'random' or one burn ('+R', '-R', '+I', '-I').
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
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const dvMs = C2.pick(dvChoices(a));
        const dv = dvMs / 1000;
        const burn = BURNS.find(b => b.value === type) || C2.pick(BURNS);
        const r = rmoeAfter(burn, dv, n);
        const radial = burn.axis === 0;

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
            { key: 'given', title: 'Before the burn', result: 'at the target',
              caption: 'Chase sits on the target with no relative motion until the burn.',
              methods: [{ name: 'Start', html: rule('$x_C = y_{C0} = C = 0$: chase starts at the target. Right after the burn its velocity is the burn, $\\dot\\rho_0 = \\Delta V$.') }] },
            { key: 'burn', title: radial ? 'What a radial burn does' : 'What an in-track burn does', result: NAME[burn.value],
              caption: 'The burn arrow shows the direction of the ΔV.',
              methods: [{ name: 'Rule', html: ruleHtml }] },
            { key: 'answer', title: 'The motion', result: radial ? 'closed ellipse' : 'drifting loops',
              caption: 'Two revs after the burn, in the view from the left.',
              methods: [{ name: 'Result', html: rule('A ' + NAME[burn.value] + ' burn gives ' + LOOK[burn.value]) + note(C2.reading(r, n, a)) }] }
        ];

        return {
            type: burn.value,
            model: { kind: 'rel', a, n, rmoe: r, revs: VZ.REVS, showStart: true, start: [0, 0, 0, 0, 0, 0], before: AT_TARGET, dv: dvVector(burn, dv), dvGiven: true },
            title: 'Burn Trajectories',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase starts at the target ($x_C = y_{C0} = C = 0$) and burns ' +
                C2.plain(dvMs, 3) + ' m/s straight ' + { '+R': 'up (+R)', '-R': 'down (−R)', '+I': 'forward (+I)', '-I': 'back (−I)' }[burn.value] + '. Draw its motion over the next two revs.'),
            statement: '',
            overviewCaption: 'Chase at the target, with the burn arrow.',
            limitsHtml: 'On paper, draw the view from the left (+R up, +I to the left) over two revs. Mark the target, draw an arrow for the ΔV and arrows for the way chase moves. Then show the answer and check your drawing against it.',
            selfCheck: true,
            revealHtml: prose('<b>' + NAME[burn.value] + ':</b> ' + LOOK[burn.value] + ' ' + C2.reading(r, n, a)),
            fields: [],
            answers: {},
            steps
        };
    }

    global.Test2BurnsProblems = { generate, grade: C2.grade, burns: BURNS.map(b => b.value), rmoeAfter };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2BurnsProblems;
