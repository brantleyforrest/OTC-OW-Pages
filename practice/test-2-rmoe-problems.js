// Test 2 Practice, Position and Velocity to RMOEs (#rmoe).
//  - forward: given a_target and chase's RIC position and velocity at epoch, find the six RMOEs and
//    the drift rate (m/s and km/rev).
//  - reverse: given the RMOEs with chase at a corner of the NMC, find its position and velocity.
// The answer is picked first from round values; the givens are computed from it with RpoMath and
// rounded to 4 decimals (km) and 6 decimals (m/s), so the given numbers give back the round answer.
// No DOM access. Load after rpo-math.js, practice-math.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    // TeX helpers: a number in parentheses when negative; n in scientific form.
    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const deg1 = v => C2.fixed(v, 1) + '°';

    // Round RMOEs. corners: M_0 and ΔM_0 at multiples of 90° (for boundary-table problems).
    function pickRmoe(a, corners) {
        const s = C2.sizesFor(a);
        const xc = C2.chance(0.25) ? 0 : C2.sign() * C2.halfKm(0.5, s.xc);
        const yc0 = C2.chance(0.15) ? 0 : C2.halfKm(-s.y, s.y);
        const C = C2.chance(corners ? 0.05 : 0.12) ? 0 : C2.halfKm(0.5, s.C);
        const zmax = C2.chance(0.2) ? 0 : C2.halfKm(0.5, s.C);
        const angle = () => (corners ? 90 * C2.randInt(0, 3) : C2.stepIn(0, 355, 5));
        return { xc, yc0, C, M0: C > 0 ? angle() : null, zmax, dM0: zmax > 0 ? angle() : null };
    }
    // The given state, rounded the way it is shown.
    const roundState = s => s.map((v, k) => (k < 3 ? Number(v.toFixed(4)) : Number((v * 1000).toFixed(6)) / 1000));

    function nStep(a, n) {
        return { key: 'n', title: 'Mean motion of the target', result: '$n = ' + sci(n) + '$ rad/s',
            caption: 'n sets how fast every angle advances: one turn per target orbit.',
            methods: [{ name: 'Formula', html: calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{398600.44 / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}') }] };
    }

    /* ---------- forward: state to RMOEs ---------- */
    function forward() {
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        const truth = pickRmoe(a, false);
        const s = roundState(M.stateFromRmoe(truth, n, 0));
        const [x0, y0, z0, vx, vy, vz] = s;
        const vms = v => p(v * 1000, 6) + '/1000';
        const drift = M.driftRate(truth, n, a);

        const steps = [nStep(a, n)];
        steps.push({ key: 'xc', title: 'Center height, x<sub>C</sub>', result: '$x_C = ' + C2.texNum(C2.fixed(truth.xc, 3)) + '$ km',
            caption: 'x<sub>C</sub> is the height of the NMC center; above the target it drifts backward.',
            methods: [{ name: 'Formula', html: calc('x_C = 4x_0 + \\frac{2\\dot y_0}{n}', ['4' + p(x0, 4) + ' + \\frac{2' + vms(vy) + '}{' + sci(n) + '}'], C2.fixed(truth.xc, 3) + '\\ \\text{km}') }] });
        steps.push({ key: 'yc0', title: 'Center along the track, y<sub>C0</sub>', result: '$y_{C0} = ' + C2.texNum(C2.fixed(truth.yc0, 3)) + '$ km',
            caption: 'y<sub>C0</sub> is where the NMC center is along the track at epoch.',
            methods: [{ name: 'Formula', html: calc('y_{C0} = y_0 - \\frac{2\\dot x_0}{n}', [p(y0, 4) + ' - \\frac{2' + vms(vx) + '}{' + sci(n) + '}'], C2.fixed(truth.yc0, 3) + '\\ \\text{km}') }] });
        steps.push({ key: 'C', title: 'NMC size, C', result: '$C = ' + C2.fixed(truth.C, 3) + '$ km',
            caption: 'C is the radial half-height of the NMC; it is 2C long on each side of its center.',
            methods: [{ name: 'Formula', html: calc('C = \\sqrt{(x_C - x_0)^2 + \\left(\\frac{y_{C0} - y_0}{2}\\right)^2}',
                ['\\sqrt{' + p(truth.xc - x0, 4) + '^2 + ' + p((truth.yc0 - y0) / 2, 4) + '^2}'], C2.fixed(truth.C, 3) + '\\ \\text{km}') +
                (truth.C === 0 ? note('C is 0 (up to the rounding of the givens): there is no NMC.') : '') }] });
        steps.push({ key: 'zmax', title: 'Cross-track size, z<sub>max</sub>', result: '$z_{max} = ' + C2.fixed(truth.zmax, 3) + '$ km',
            caption: 'z<sub>max</sub> is how far chase swings to each side of the target’s plane.',
            methods: [{ name: 'Formula', html: calc('z_{max} = \\sqrt{z_0^2 + (\\dot z_0 / n)^2}',
                ['\\sqrt{' + p(z0, 4) + '^2 + \\left(\\frac{' + vms(vz) + '}{' + sci(n) + '}\\right)^2}'], C2.fixed(truth.zmax, 3) + '\\ \\text{km}') +
                (truth.zmax === 0 ? note('z_max is 0 (up to rounding): chase stays in the target’s plane.') : '') }] });
        if (truth.M0 === null) {
            steps.push({ key: 'M0', title: 'Place on the NMC, M<sub>0</sub>', result: 'undefined', caption: 'With no NMC there is no place on it.',
                methods: [{ name: 'Rule', html: rule('$C = 0$, so $M_0$ is undefined.', '$M_0 = \\text{undefined}$') }] });
        } else {
            const base = Math.acos(Math.max(-1, Math.min(1, (truth.xc - x0) / truth.C))) * M.R2D;
            const flip = vx < 0;
            steps.push({ key: 'M0', title: 'Place on the NMC, M<sub>0</sub>', result: '$M_0 = ' + deg1(truth.M0) + '$',
                caption: 'M<sub>0</sub> is where chase is on the NMC: 0° bottom, 90° front, 180° top, 270° back.',
                methods: [{ name: 'Formula', html: calc('M_0 = \\cos^{-1}\\frac{x_C - x_0}{C}', ['\\cos^{-1}\\frac{' + p(truth.xc - x0, 4) + '}{' + C2.fixed(truth.C, 3) + '}'], deg1(base)) +
                    rule(flip ? '$\\dot x_0 < 0$ (chase is moving down), so $M_0 = 360° - ' + deg1(base) + '$.' : '$\\dot x_0 \\ge 0$, so $M_0$ stays ' + deg1(base) + '.', '$M_0 = ' + deg1(truth.M0) + '$') }] });
        }
        if (truth.dM0 === null) {
            steps.push({ key: 'dM0', title: 'Place in the swing, ΔM<sub>0</sub>', result: 'undefined', caption: 'With no swing there is no place in it.',
                methods: [{ name: 'Rule', html: rule('$z_{max} = 0$, so $\\Delta M_0$ is undefined.', '$\\Delta M_0 = \\text{undefined}$') }] });
        } else {
            const base = Math.asin(Math.max(-1, Math.min(1, z0 / truth.zmax))) * M.R2D;
            const flip = vz < 0;
            const text = flip ? '$\\dot z_0 < 0$ (chase is moving right), so $\\Delta M_0 = 180° - ' + p(base, 1) + '°$.'
                : base < -1e-9 ? '$\\dot z_0 \\ge 0$; a negative angle wraps to $' + deg1(truth.dM0) + '$.' : '$\\dot z_0 \\ge 0$, so $\\Delta M_0$ stays ' + deg1(base) + '.';
            steps.push({ key: 'dM0', title: 'Place in the swing, ΔM<sub>0</sub>', result: '$\\Delta M_0 = ' + deg1(truth.dM0) + '$',
                caption: 'ΔM<sub>0</sub> is where chase is in the swing: 0° +P.C., 90° far left, 180° −P.C., 270° far right.',
                methods: [{ name: 'Formula', html: calc('\\Delta M_0 = \\sin^{-1}\\frac{z_0}{z_{max}}', ['\\sin^{-1}\\frac{' + p(z0, 4) + '}{' + C2.fixed(truth.zmax, 3) + '}'], p(base, 1) + '°') +
                    rule(text, '$\\Delta M_0 = ' + deg1(truth.dM0) + '$') }] });
        }
        steps.push({ key: 'drift', title: 'Drift rate', result: '$' + C2.texNum(C2.fixed(drift.kmPerRev, 3)) + '$ km/rev',
            caption: 'The center drifts along the track at a steady rate set by x<sub>C</sub>.',
            methods: [{ name: 'Per second', html: calc('\\dot y_C = -\\tfrac{3}{2} n x_C', ['-1.5 \\times ' + sci(n) + ' \\times ' + p(truth.xc, 3)], C2.fixed(drift.kmPerSec * 1000, 4) + '\\ \\text{m/s}') },
                { name: 'Per rev', html: calc('\\dot y_C = -3\\pi x_C', ['-3\\pi \\times ' + p(truth.xc, 3)], C2.fixed(drift.kmPerRev, 3) + '\\ \\text{km/rev}') }] });
        steps.push({ key: 'answer', title: 'What the motion looks like', result: '', caption: 'The motion these RMOEs describe, over two revs.',
            methods: [{ name: 'Reading', html: note(C2.reading(truth, n, a)) }] });

        const fields = C2.RMOE_FIELDS().concat([C2.fMs('drift', '\\dot y_C', 'Drift rate'), { key: 'driftRev', tex: '\\dot y_C', name: 'Drift per rev', unit: 'km/rev', tolerance: C2.TOL.km, unitType: 'dist' }]);
        const answers = Object.assign(C2.rmoeAnswers(truth), {
            drift: C2.ansMs(drift.kmPerSec),
            driftRev: { value: drift.kmPerRev, text: C2.fixed(drift.kmPerRev, 3) + ' km/rev' }
        });
        return {
            type: 'forward',
            model: { kind: 'rel', a, n, rmoe: truth, revs: 2, showStart: true, given: s },
            title: 'Position and Velocity to RMOEs',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase’s position and velocity in the RIC frame at epoch are given. Find the six RMOEs and the drift rate.'),
            statement: C2.givenState(s),
            overviewCaption: 'Chase (gold triangle) at its given position. The walkthrough adds the NMC it is on.',
            limitsHtml: C2.LIMITS,
            fields, answers, steps
        };
    }

    /* ---------- reverse: RMOEs to state ---------- */
    function reverse() {
        const a = C2.pickTargetA();
        const n = M.meanMotion(a);
        let truth = pickRmoe(a, true);
        if (truth.C === 0) truth = Object.assign(truth, { C: 1, M0: 90 * C2.randInt(0, 3) });
        const s = M.stateFromRmoe(truth, n, 0);
        const yd = -1.5 * n * truth.xc;
        const corner = C2.cornerName(truth.M0);
        const cornerTeX = {
            bottom: ['x_C - C', 'y_{C0}', '0', '\\dot y_C + 2nC'], front: ['x_C', 'y_{C0} + 2C', 'nC', '\\dot y_C'],
            top: ['x_C + C', 'y_{C0}', '0', '\\dot y_C - 2nC'], back: ['x_C', 'y_{C0} - 2C', '-nC', '\\dot y_C']
        }[corner];
        const ms = v => C2.fixed(v * 1000, 4);
        const steps = [nStep(a, n)];
        steps.push({ key: 'drift', title: 'Drift rate', result: '$\\dot y_C = ' + C2.texNum(ms(yd)) + '$ m/s',
            caption: 'The in-track rate at every corner includes the drift.',
            methods: [{ name: 'Formula', html: calc('\\dot y_C = -\\tfrac{3}{2} n x_C', ['-1.5 \\times ' + sci(n) + ' \\times ' + p(truth.xc, 3) + '\\times 1000'], ms(yd) + '\\ \\text{m/s}') }] });
        steps.push({ key: 'M0', title: 'In the plane: the ' + corner, result: 'the ' + corner,
            caption: 'M<sub>0</sub> = ' + truth.M0 + '° puts chase at the ' + corner + ' of the NMC. Read its row of the boundary table.',
            methods: [{ name: 'Boundary table', html: rule('$M_0 = ' + truth.M0 + '°$: chase is at the ' + corner + '.') +
                calc('x_0 = ' + cornerTeX[0], [], C2.fixed(s[0], 3) + '\\ \\text{km}') +
                calc('y_0 = ' + cornerTeX[1], [], C2.fixed(s[1], 3) + '\\ \\text{km}') +
                calc('\\dot x_0 = ' + cornerTeX[2], [], ms(s[3]) + '\\ \\text{m/s}') +
                calc('\\dot y_0 = ' + cornerTeX[3], [], ms(s[4]) + '\\ \\text{m/s}') }] });
        if (truth.dM0 === null) {
            steps.push({ key: 'dM0', title: 'Across the plane: no swing', result: '$z_0 = 0$', caption: 'With z<sub>max</sub> = 0 chase stays in the target’s plane.',
                methods: [{ name: 'Rule', html: rule('$z_{max} = 0$, so $z_0 = 0$ and $\\dot z_0 = 0$.') }] });
        } else {
            const sw = C2.swingName(truth.dM0);
            const k = Math.round(truth.dM0 / 90) % 4;
            const zT = ['0', 'z_{max}', '0', '-z_{max}'][k], vzT = ['n z_{max}', '0', '-n z_{max}', '0'][k];
            steps.push({ key: 'dM0', title: 'Across the plane: ' + sw, result: sw,
                caption: 'ΔM<sub>0</sub> = ' + truth.dM0 + '° puts chase at its ' + sw + '.',
                methods: [{ name: 'Boundary table', html: rule('$\\Delta M_0 = ' + truth.dM0 + '°$: chase is at its ' + sw + '.') +
                    calc('z_0 = ' + zT, [], C2.fixed(s[2], 3) + '\\ \\text{km}') + calc('\\dot z_0 = ' + vzT, [], ms(s[5]) + '\\ \\text{m/s}') }] });
        }
        steps.push({ key: 'answer', title: 'What the motion looks like', result: '', caption: 'The motion these RMOEs describe, over two revs.',
            methods: [{ name: 'Reading', html: note(C2.reading(truth, n, a)) }] });
        return {
            type: 'reverse',
            model: { kind: 'rel', a, n, rmoe: truth, revs: 2, showStart: false },
            title: 'RMOEs to Position and Velocity',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit with $a = ' + C2.plain(a, 2) + '$ km. Chase’s RMOEs at epoch are given. Find its position and velocity in the RIC frame at epoch.'),
            statement: C2.givenRmoe(truth),
            overviewCaption: 'The view adds chase’s motion as the walkthrough goes.',
            limitsHtml: C2.LIMITS.replace(/ Tick.*$/, ''),
            fields: C2.STATE_FIELDS(),
            answers: C2.stateAnswers(s),
            steps
        };
    }

    function generate(type) {
        if (type === 'forward') return forward();
        if (type === 'reverse') return reverse();
        return C2.chance(0.6) ? forward() : reverse();
    }

    global.Test2RmoeProblems = { generate, grade: C2.grade, pickRmoe, roundState };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2RmoeProblems;
