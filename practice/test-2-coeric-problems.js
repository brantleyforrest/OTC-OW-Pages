// Test 2 Practice, Elements to Position and Velocity (#coeric). The problem gives the classical
// orbital elements of a circular target and of a chase that differs a little, both with ω = 0 and
// the same true anomaly (0°, 90°, 180°, or 270°; only 0° or 180° when chase's e differs, so chase
// is at its perigee or apogee). The student finds chase's RIC position and velocity: first the
// RMOEs the elements give, then the boundary tables. Answers: RpoMath.rmoeFromCoes, then
// stateFromRmoe. A node difference is used only with a polar target, where it moves no point
// along the track. No DOM access. Load after rpo-math.js, practice-math.js, and test-2-common.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const M = C2.M;
    const { prose, calc, rule, note } = global.PracticeMath;

    const p = (v, d) => { const s = C2.fixed(v, d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const sci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    const LEO_I = [28.5, 45, 51.6, 63.4, 90];
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

    // Which differences: in-plane (a and/or e), cross (i or Ω, sometimes with a), or both.
    function pickDiffs(type) {
        const t = type === 'in-plane' || type === 'cross' || type === 'both' ? type : C2.pick(['in-plane', 'cross', 'both']);
        const inPlane = () => C2.pick([['a'], ['e'], ['a', 'e'], ['a', 'e']]);
        const cross = () => [C2.chance(0.6) ? 'i' : 'raan'];
        if (t === 'in-plane') return { type: t, diffs: inPlane() };
        if (t === 'cross') return { type: t, diffs: cross().concat(C2.chance(0.4) ? ['a'] : []) };
        return { type: t, diffs: inPlane().concat(cross()) };
    }

    function generate(type) {
        const pick = pickDiffs(type);
        const diffs = pick.diffs;
        const node = diffs.includes('raan');
        let a = C2.pickTargetA();
        if (node && a > 40000) a = C2.pick([6517.16, 6750, 6900, 7000, 26562]);   // GEO is equatorial: Ω means nothing there
        const n = M.meanMotion(a);
        const geo = a > 40000;
        const s = C2.sizesFor(a);
        const nu = diffs.includes('e') ? C2.pick([0, 180]) : C2.pick([0, 90, 180, 270]);
        const target = {
            a, e: 0,
            i: node ? 90 : geo ? 0 : a > 20000 ? 55 : C2.pick(LEO_I),
            raan: geo ? 0 : C2.stepIn(0, 355, 5),
            argp: 0, nu
        };
        const chase = Object.assign({}, target);
        if (diffs.includes('a')) chase.a = a + C2.sign() * C2.halfKm(0.5, s.xc);
        if (diffs.includes('e')) chase.e = Number((C2.halfKm(0.5, s.C) / chase.a).toFixed(7));
        const angStep = geo ? 0.005 : a > 20000 ? 0.005 : 0.01;
        const ang = C2.stepIn(angStep, angStep * 6, angStep);
        if (diffs.includes('i')) chase.i = Number((target.i + (target.i > 0 ? C2.sign() : 1) * ang).toFixed(4));
        if (node) chase.raan = Number(M.wrap360(target.raan + C2.sign() * ang).toFixed(4));

        const r = M.rmoeFromCoes(target, chase);
        const st = M.stateFromRmoe(r, n, 0);
        const ms = v => C2.fixed(v * 1000, 4);

        // Steps: n; the RMOEs from the elements; where chase is; the boundary tables.
        const steps = [{ key: 'n', title: 'Mean motion of the target', result: '$n = ' + sci(n) + '$ rad/s',
            caption: 'n sets how fast every angle advances: one turn per target orbit.',
            methods: [{ name: 'Formula', html: calc('n = \\sqrt{\\mu / a^3}', ['\\sqrt{398600.44 / ' + C2.plain(a, 2) + '^3}'], sci(n) + '\\ \\text{rad/s}') }] }];

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
        steps.push({ key: 'answer', title: 'Read the boundary tables', result: '',
            caption: 'Chase’s motion from these RMOEs, beside both orbits.',
            methods: [{ name: 'Tables', html: tableHtml + note(C2.reading(r, n, a)) }] });

        return {
            type: pick.type,
            model: { kind: 'motion', target, chase, rmoe: r, n, revs: 2 },
            title: 'Elements to Position and Velocity',
            prompt: prose('The target is in a circular ' + C2.orbitName(a) + ' orbit. Chase is on the orbit given beside it, at the same moment. Find chase’s position and velocity in the RIC frame (use the course’s linear model).'),
            statement: statementHtml(target, chase),
            overviewCaption: 'The target (green square) and chase (gold triangle), each on its own orbit. The RIC panes fill in at the last step.',
            limitsHtml: C2.LIMITS.replace(/ Tick.*$/, ''),
            fields: C2.STATE_FIELDS(),
            answers: C2.stateAnswers(st),
            steps
        };
    }

    global.Test2CoericProblems = { generate, grade: C2.grade };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2CoericProblems;
