// Test 2 Practice, COE to RIC Signs (#coeric). The problem gives the classical orbital
// elements of a circular target and of a chase that differs a little, both with ω = 0 and the same
// true anomaly (0°, 90°, 180°, or 270°; only 0° or 180° when chase's e differs, so chase is at its
// perigee or apogee). The student gives the sign (+, −, or 0) of each part of chase's RIC position
// and velocity, in the homework's grid (rows R, I, C; columns position, velocity). The walkthrough
// works the numbers: the RMOEs the elements give, then the boundary tables. Answers:
// TestReviewMath.rpo.rmoeFromCoes, then stateFromRmoe. A node difference is used only with a polar target, where it moves no point
// along the track. No DOM access. Load after test-2-practice-math.js, tex-render.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const TARGET_A = 6900;
    const TARGET_I = [90, 90, 45];
    const ROWS = [['a', 'a', 'km', v => C2.plain(v, 2)], ['e', 'e', '', v => C2.plain(v, 7)], ['i', 'i', '°', v => C2.plain(v, 4)],
        ['raan', '\\Omega', '°', v => C2.plain(v, 4)], ['argp', '\\omega', '°', v => C2.plain(v, 4)], ['nu', '\\nu', '°', v => C2.plain(v, 4)]];

    function statementHtml(target, chase) {
        const body = ROWS.map(([k, tex, unit, f]) => {
            const differs = Math.abs(target[k] - chase[k]) > 1e-12;
            return '<tr' + (differs ? ' class="differs"' : '') + '><th>' + prose('$' + tex + '$') + '</th><td>' + f(target[k]) + (unit ? ' ' + unit : '') +
                '</td><td>' + f(chase[k]) + (unit ? ' ' + unit : '') + '</td></tr>';
        }).join('');
        return '<div class="given-item given-wide"><table class="el-given"><thead><tr><th></th><th>Target</th><th>Chase</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    // Which differences, never more than two elements (as in the homework): in-plane (a, e, or
    // both), cross (i or Ω alone), or both (a or e, with i or Ω).
    function pickDiffs(type) {
        const t = type === 'in-plane' || type === 'cross' || type === 'both' ? type : C2.pick(['in-plane', 'cross', 'both']);
        const cross = () => [C2.chance(0.6) ? 'i' : 'raan'];
        if (t === 'in-plane') return { type: t, diffs: C2.pick([['a'], ['e'], ['a', 'e'], ['a', 'e']]) };
        if (t === 'cross') return { type: t, diffs: cross() };
        return { type: t, diffs: [C2.pick(['a', 'e'])].concat(cross()) };
    }

    // Where the exact difference of the two orbits falls outside a numeric tolerance of the linear
    // answer, the solution says so. With differences this large it often does: for example, tilting
    // the velocity by an angle shortens its in-track part by about v times the angle squared over 2,
    // a second-order effect the linear model leaves out. The graded answers are the linear signs.
    function exactNote(target, chase, st) {
        const rel = M.relativeState(target, chase, 0);
        const exact = [...rel.rho, ...rel.rhoDot];
        const answers = C2.stateAnswers(st), exactAnswers = C2.stateAnswers(exact);
        const off = C2.STATE_FIELDS().filter(fl => C2.grade(fl, String(exactAnswers[fl.key].value), answers[fl.key].value) === 'wrong');
        if (!off.length) return '';
        const num = (ans) => C2.texNum(ans.text.replace(/ .*$/, ''));
        const list = off.map(fl => '$' + fl.tex + '_0 = ' + num(exactAnswers[fl.key]) + '$ ' + fl.unit).join(', ');
        return note('The exact difference of the two orbits gives ' + list + ' here, against the linear model’s ' +
            off.map(fl => '$' + num(answers[fl.key]) + '$').join(', ') +
            '. The gap is what the linear model leaves out, and it grows with the size of the differences. Answer with the linear model, as the course does.');
    }

    function generate(type) {
        const pick = pickDiffs(type);
        const diffs = pick.diffs;
        const node = diffs.includes('raan');
        // The target the homework always uses: 6900 km, polar or 45°, Ω = 45°. A node difference
        // needs the polar target, where it moves no point along the track.
        const a = TARGET_A;
        const n = M.meanMotion(a);
        const nu = diffs.includes('e') ? C2.pick([0, 180]) : C2.pick([0, 90, 180, 270]);
        const target = { a, e: 0, i: node ? 90 : C2.pick(TARGET_I), raan: 45, argp: 0, nu };
        // Differences the size the homework uses (there: a by 10 km, e = 0.0015, i or Ω by 0.1°):
        // a by 5 to 20 km, e from 0.001 to 0.002, an angle by 0.1° to 0.5°. Chase's perigee must
        // stay at least 200 km above Earth.
        const chase = Object.assign({}, target);
        if (diffs.includes('a')) chase.a = a + C2.sign() * C2.stepIn(5, 20, 5);
        if (diffs.includes('e')) chase.e = Number(C2.stepIn(0.001, 0.002, 0.0005).toFixed(4));
        if (chase.a * (1 - chase.e) < M.RE + 200) return generate(type);
        const ang = Number(C2.stepIn(0.1, 0.5, 0.1).toFixed(1));
        if (diffs.includes('i')) chase.i = target.i + (target.i > 0 ? C2.sign() : 1) * ang;
        if (node) chase.raan = M.wrap360(target.raan + C2.sign() * ang);

        const r = M.rmoeFromCoes(target, chase);
        const st = M.stateFromRmoe(r, n, 0);
        const ms = v => C2.fixed(v * 1000, 4);
        const signs = signsOf(st);
        if (!signs) return generate(type);      // a component too near zero to call: try again
        // The exact difference of the two orbits must not flip a + or − (it can, for a small
        // in-track rate, through the second-order effect of a plane difference): try again.
        const rel = M.relativeState(target, chase, 0);
        const exact = [...rel.rho, ...rel.rhoDot];
        if (SIGN_FIELDS.some(([key], k) => signs[key] !== '0' && Math.sign(exact[k]) !== (signs[key] === '+' ? 1 : -1))) return generate(type);
        // A 0 must stay close to 0 in the exact orbits too: under 5 percent of the size of the
        // motion (the same line a + or − must clear in the linear model). Size: the largest exact
        // position, or velocity over n, whichever is larger, so a tiny second-order speed is not
        // measured against itself when every other speed is zero.
        const size = Math.max(...exact.slice(0, 3).map(Math.abs), ...exact.slice(3).map(v => Math.abs(v) / n));
        const exactScale = [size, size * n];
        if (SIGN_FIELDS.some(([key], k) => signs[key] === '0' && Math.abs(exact[k]) > 0.05 * exactScale[k < 3 ? 0 : 1])) return generate(type);

        // Steps: n; the RMOEs from the elements; where chase is; the boundary tables.
        const steps = [{ key: 'n', title: 'Mean motion of the target', result: '$n = ' + sci(n) + '$ rad/s',
            caption: 'n sets how fast every angle advances: one turn per target orbit.',
            methods: [{ name: 'Formula', html: calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{' + M.MU + ' / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}') }] }];

        const inPlaneHtml = [
            calc('x_C = a_{chase} - a_{target}', [C2.plain(chase.a, 2) + ' - ' + C2.plain(a, 2)], C2.fixed(r.xc, 3) + '\\ \\text{km}'),
            calc('C = a_{chase}\\, e_{chase}', [C2.plain(chase.a, 2) + ' \\times ' + C2.plain(chase.e, 7)], C2.fixed(r.C, 3) + '\\ \\text{km}'),
            rule('Both spacecraft are at the same true anomaly with $\\omega = 0$, so neither leads the other: $y_{C0} = 0$.'),
            r.C > 1e-9 ? rule('Chase is at its ' + (nu === 0 ? 'perigee, the lowest point' : 'apogee, the highest point') + ' of its orbit, so it is at the ' + (nu === 0 ? 'bottom' : 'top') + ' of the NMC.', '$M_0 = ' + nu + '°$')
                : rule('$C = 0$: there is no NMC, and $M_0$ is undefined.')
        ].join('');
        steps.push({ key: 'xc', title: 'In-plane RMOEs', result: '$x_C = ' + C2.texNum(C2.fixed(r.xc, 3)) + '$, $C = ' + C2.fixed(r.C, 3) + '$',
            caption: 'The size difference sets the center height; chase’s eccentricity sets the NMC size.',
            methods: [{ name: 'From the elements', html: inPlaneHtml }] });

        let crossHtml;
        if (r.zmax < 1e-9) crossHtml = rule('Same inclination and node: the orbits share a plane, so $z_{max} = 0$ and $z_0 = \\dot z_0 = 0$.');
        else {
            const u = nu;
            const sw = C2.swingName(r.dM0);
            const tilt = node ? '\\Delta\\Omega \\sin i' : '\\Delta i';
            const tiltNum = node ? (chase.raan - target.raan) : (chase.i - target.i);
            const wrapped = node ? M.wrap180(tiltNum) : tiltNum;
            crossHtml = calc('z_{max} = a\\, |' + tilt + '|', [C2.plain(a, 2) + ' \\times ' + C2.plain(Math.abs(wrapped), 4) + '° \\times \\frac{\\pi}{180°}' + (node ? ' \\times \\sin 90°' : '')], C2.fixed(r.zmax, 3) + '\\ \\text{km}') +
                rule(node
                    ? 'Turning the node by $\\Delta\\Omega$ tilts chase’s plane about the polar axis. At $u = ' + u + '°$ (' + (u % 180 === 0 ? 'over the equator' : 'over a pole') + ') chase is at its ' + sw + '.'
                    : 'Tilting the plane by $\\Delta i$ about the line of nodes: at the nodes ($u = 0°$ or $180°$) chase crosses the target’s plane, and a quarter rev later it is farthest to the side. Here $u = ' + u + '°$ and $\\Delta i ' + (wrapped > 0 ? '> 0' : '< 0') + '$, so chase is at its ' + sw + '.',
                    '$\\Delta M_0 = ' + C2.fixed(r.dM0, 0) + '°$');
        }
        steps.push({ key: 'zmax', title: 'Cross-track RMOEs', result: r.zmax > 1e-9 ? '$z_{max} = ' + C2.fixed(r.zmax, 3) + '$, $\\Delta M_0 = ' + C2.fixed(r.dM0, 0) + '°$' : '$z_{max} = 0$',
            caption: 'A plane difference sets how far chase swings to the side and where in the swing it is.',
            methods: [{ name: 'From the elements', html: crossHtml }] });

        const corner = C2.cornerName(r.M0);
        const drift = -1.5 * n * r.xc;
        const tableHtml = [
            calc('\\dot y_C = -\\tfrac{3}{2} n x_C', ['-1.5 \\times ' + sci(n) + ' \\times ' + p(r.xc, 3) + ' \\times 1000'], ms(drift) + '\\ \\text{m/s}'),
            corner ? rule('At the ' + corner + ' of the NMC (boundary table):') : rule('No NMC: chase sits at the center, $x_0 = x_C$, $y_0 = y_{C0}$, $\\dot x_0 = 0$, $\\dot y_0 = \\dot y_C$.'),
            calc('x_0', [], C2.fixed(st[0], 3) + '\\ \\text{km}'), calc('y_0', [], C2.fixed(st[1], 3) + '\\ \\text{km}'),
            calc('\\dot x_0', [], ms(st[3]) + '\\ \\text{m/s}'), calc('\\dot y_0', [], ms(st[4]) + '\\ \\text{m/s}'),
            calc('z_0', [], C2.fixed(st[2], 3) + '\\ \\text{km}'), calc('\\dot z_0', [], ms(st[5]) + '\\ \\text{m/s}')
        ].join('');
        steps.push({ key: 'tables', title: 'Read the boundary tables', result: '',
            caption: 'Chase’s position and velocity from these RMOEs.',
            methods: [{ name: 'Tables', html: tableHtml + exactNote(target, chase, st) }] });

        const signRows = SIGN_FIELDS.map(([key, tex, name], k) => rule('$' + tex + '_0 = ' + C2.texNum(k < 3 ? C2.fixed(st[k], 3) : ms(st[k])) + '$ ' + (k < 3 ? 'km' : 'm/s') +
            ' (' + name + ')', SYMBOL[signs[key]])).join('');
        steps.push({ key: 'answer', title: 'Each sign', result: SIGN_FIELDS.map(([key]) => SYMBOL[signs[key]]).join(' '),
            caption: 'Chase’s motion from these RMOEs, beside both orbits.',
            methods: [{ name: 'Signs', html: signRows + note(C2.reading(r, n, a)) }] });

        return {
            type: pick.type,
            model: { kind: 'motion', target, chase, rmoe: r, n, revs: 2, secondsPerRev: 15 },
            title: 'COE to RIC Signs',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit. Chase is on the orbit given beside it, at the same moment. Is each part of chase’s position and velocity in the RIC frame positive, negative, or zero? (Use the course’s linear model.)'),
            statement: statementHtml(target, chase),
            overviewCaption: 'The target (green square) and chase (gold triangle), each on its own orbit. The RIC panes fill in at the last step.',
            limitsHtml: 'Pick +, −, or 0 for each.',
            gridHeads: ['\\bar\\rho', '\\dot{\\bar\\rho}'],   // TeX: the grid's two columns
            fields: GRID_ORDER.map(key => { const [, tex, name] = SIGN_FIELDS.find(f => f[0] === key); return { key, tex, name, unitType: 'sign' }; }),
            answers: Object.fromEntries(SIGN_FIELDS.map(([key]) => [key, { value: signs[key], text: SYMBOL[signs[key]] }])),
            steps
        };
    }

    // The grid: rows R, I, C; columns ρ̄ (position) and ρ̄̇ (velocity). The form fills two columns
    // row by row.
    const SIGN_FIELDS = [['x', 'x', 'R'], ['y', 'y', 'I'], ['z', 'z', 'C'],
        ['vx', '\\dot x', 'R'], ['vy', '\\dot y', 'I'], ['vz', '\\dot z', 'C']];
    const GRID_ORDER = ['x', 'vx', 'y', 'vy', 'z', 'vz'];
    const SYMBOL = { '+': '+', '-': '−', '0': '0' };
    // Signs of the linear-model state. A part is 0 only when it is zero by construction (round-off
    // aside); one that is nonzero but small next to the largest part of its kind gives null, so the
    // problem is made again rather than hang on a near-zero value.
    function signsOf(st) {
        const out = {};
        const scale = [Math.max(...st.slice(0, 3).map(Math.abs)), Math.max(...st.slice(3).map(Math.abs))];
        for (let k = 0; k < 6; k++) {
            const s = scale[k < 3 ? 0 : 1], v = st[k];
            if (Math.abs(v) <= Math.max(1e-9 * s, k < 3 ? 1e-9 : 1e-13)) out[SIGN_FIELDS[k][0]] = '0';
            else if (Math.abs(v) < 0.05 * s) return null;
            else out[SIGN_FIELDS[k][0]] = v > 0 ? '+' : '-';
        }
        return out;
    }

    global.Test2CoericProblems = { generate, grade: C2.grade, signsOf };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2CoericProblems;
