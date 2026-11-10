// R-V vector problems for Test 1 Practice. Each problem gives a position and a velocity with at
// most three nonzero components in total and at most two in either vector. The orbit is either
// circular, or the satellite is at perigee or apogee. All six elements are asked for, and an
// undefined element counts as 0 degrees.
//
// The equations, the notation, and the order of the steps follow the Inertial Frame Orbital
// Elements lesson. The alternate methods come from that lesson and the Inertial Frame 2-Body
// Motion lesson.
(function (global) {
    'use strict';

    const { math, prose, column, calc, note, rule } = global.PracticeMath;

    const MU = 398600.44;       // Earth's gravitational parameter (km^3/s^2), as in the lessons
    const R_EARTH = 6378.137;   // Earth's equatorial radius (km), as in the lessons
    const R2D = 180 / Math.PI;

    const MIN_ALTITUDE = 200;   // Lowest perigee altitude used in a problem (km)
    const MAX_APOGEE = 100000;  // Highest apogee distance used in a problem (km)
    const MIN_E = 0.02;
    const MAX_E = 0.7;

    // A circular problem's speed is rounded to three decimals, which leaves a tiny eccentricity.
    // Anything below this counts as circular. Elliptical problems never come close to it.
    const CIRCULAR_E = 0.001;

    // Each limit accepts an answer correctly rounded to that place value: a to three significant
    // figures, e to two decimal places, and angles to the whole degree.
    const FIELDS = [
        { key: 'a', tex: 'a', name: 'Semi-major axis', unit: 'km', tolerance: { relative: 0.005 } },
        { key: 'e', tex: 'e', name: 'Eccentricity', unit: '', tolerance: { absolute: 0.005 } },
        { key: 'i', tex: 'i', name: 'Inclination', unit: '°', tolerance: { absolute: 0.5 } },
        { key: 'raan', tex: '\\Omega', name: 'RAAN', unit: '°', tolerance: { absolute: 0.5, wrap: 360 } },
        { key: 'argp', tex: '\\omega', name: 'Argument of perigee', unit: '°', tolerance: { absolute: 0.5, wrap: 360 } },
        { key: 'nu', tex: '\\nu', name: 'True anomaly', unit: '°', tolerance: { absolute: 0.5, wrap: 360 } }
    ];

    /* ------------------------------------------------------------------ */
    /* Vector Math                                                        */
    /* ------------------------------------------------------------------ */
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
    const length = (p) => Math.sqrt(dot(p, p));
    const arccos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * R2D;
    const wrap360 = (x) => ((x % 360) + 360) % 360;

    /* ------------------------------------------------------------------ */
    /* Solving a State Vector                                             */
    /* ------------------------------------------------------------------ */
    function solve(r, v) {
        const R = length(r), V = length(v);
        const rDotV = dot(r, v);
        const energy = V * V / 2 - MU / R;
        const aRaw = -MU / (2 * energy);

        const h = cross(r, v), H = length(h);
        const i = arccos(h[2] / H);

        const n = [-h[1], h[0], 0], N = length(n);
        const equatorial = N < 1e-6 * H;

        const bracket = V * V - MU / R;
        const eVec = r.map((c, k) => (bracket * c - rDotV * v[k]) / MU);
        const eMag = length(eVec);
        const circular = eMag < CIRCULAR_E;

        const vCirc = Math.sqrt(MU / R);
        const apsis = circular ? 'circular' : (V > vCirc ? 'perigee' : 'apogee');

        const raanFlat = equatorial ? 0 : arccos(n[0] / N);
        const raanRaw = n[1] < 0 ? 360 - raanFlat : raanFlat;

        const hasPerigeeAngle = !equatorial && !circular;
        const nDotE = dot(n, eVec);
        const argpFlat = hasPerigeeAngle ? arccos(nDotE / (N * eMag)) : 0;
        const argpRaw = eVec[2] < 0 ? 360 - argpFlat : argpFlat;

        const eDotR = dot(eVec, r);
        const nuFlat = circular ? 0 : arccos(eDotR / (eMag * R));
        const nuRaw = rDotV < 0 ? 360 - nuFlat : nuFlat;

        const nDotR = dot(n, r);
        const uFlat = equatorial ? 0 : arccos(nDotR / (N * R));
        const u = r[2] < 0 ? 360 - uFlat : uFlat;

        const raanUndefined = equatorial;
        const argpUndefined = equatorial || circular;
        const nuUndefined = circular;

        // A circular orbit's radius is exact. The energy result differs from it only because the
        // given speed is rounded.
        const a = circular ? R : aRaw;

        const answers = {
            a: { value: a, text: `${fixed(a, 1)} km` },
            e: { value: circular ? 0 : eMag, text: circular ? '0' : fixed(eMag, 4) },
            i: { value: i, text: deg(i) },
            raan: { value: raanUndefined ? 0 : raanRaw, text: raanUndefined ? 'Undefined, so 0°' : deg(raanRaw), undefined: raanUndefined },
            argp: { value: argpUndefined ? 0 : argpRaw, text: argpUndefined ? 'Undefined, so 0°' : deg(argpRaw), undefined: argpUndefined },
            nu: { value: nuUndefined ? 0 : nuRaw, text: nuUndefined ? 'Undefined, so 0°' : deg(nuRaw), undefined: nuUndefined }
        };

        return {
            r, v, R, V, rDotV, energy, a, aRaw, h, H, i, n, N, bracket, eVec, eMag, vCirc, apsis,
            circular, equatorial, raan: raanRaw, raanFlat, argp: argpRaw, argpFlat, nu: nuRaw, nuFlat,
            u, uFlat, nDotE, eDotR, nDotR, raanUndefined, argpUndefined, nuUndefined, answers
        };
    }

    /* ------------------------------------------------------------------ */
    /* Generating a Problem                                               */
    /* ------------------------------------------------------------------ */
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const between = (low, high) => low + (high - low) * Math.random();
    const randomSign = () => (Math.random() < 0.5 ? -1 : 1);
    const snapRadius = (x) => Math.round(x / 100) * 100;
    const snapSpeed = (x) => Number(x.toFixed(3));

    function randomRadius() {
        const band = Math.random();
        if (band < 0.5) return snapRadius(between(6700, 9000));
        if (band < 0.8) return snapRadius(between(9000, 30000));
        return snapRadius(between(30000, 45000));
    }

    // The speed that makes this radius circular, the perigee, or the apogee of a random ellipse.
    function speedFor(kind, R) {
        if (kind === 'circular') return Math.sqrt(MU / R);
        const lowest = R_EARTH + MIN_ALTITUDE;
        const eMax = kind === 'perigee'
            ? Math.min(MAX_E - 0.05, (MAX_APOGEE - R) / (MAX_APOGEE + R))
            : Math.min(MAX_E - 0.05, (R - lowest) / (R + lowest));
        if (eMax < 0.03) return null;
        const e = between(0.03, eMax);
        return Math.sqrt(MU * (kind === 'perigee' ? 1 + e : 1 - e) / R);
    }

    const vectorAlong = (axis, value) => {
        const out = [0, 0, 0];
        out[axis] = value;
        return out;
    };

    function splitAngle() {
        return pick([30, 45, 60, between(20, 70)]) / R2D;
    }

    // The nonzero components of position and velocity, as [in r, in v]. The velocity is always
    // perpendicular to the position, because the satellite is at an apsis or on a circle.
    function buildCandidate() {
        const kind = pick(['circular', 'circular', 'perigee', 'perigee', 'perigee', 'apogee', 'apogee', 'apogee']);
        const pattern = pick(['1-1', '1-1', '2-1', '2-1', '2-1', '1-2', '1-2', '1-2']);

        if (pattern === '1-1') {
            const equatorialPair = Math.random() < 0.5;
            const rAxis = equatorialPair ? pick([0, 1]) : pick([0, 1, 2]);
            const vAxis = equatorialPair ? 1 - rAxis : (rAxis === 2 ? pick([0, 1]) : 2);
            const R = randomRadius();
            const speed = speedFor(kind, R);
            if (!speed) return null;
            return { kind, r: vectorAlong(rAxis, randomSign() * R), v: vectorAlong(vAxis, randomSign() * snapSpeed(speed)) };
        }

        if (pattern === '2-1') {
            const vAxis = pick([0, 1, 2]);
            const [first, second] = [0, 1, 2].filter((axis) => axis !== vAxis);
            const size = randomRadius(), angle = splitAngle();
            const r = [0, 0, 0];
            r[first] = randomSign() * snapRadius(size * Math.cos(angle));
            r[second] = randomSign() * snapRadius(size * Math.sin(angle));
            const speed = speedFor(kind, length(r));
            if (!speed) return null;
            return { kind, r, v: vectorAlong(vAxis, randomSign() * snapSpeed(speed)) };
        }

        const rAxis = pick([0, 1, 2]);
        const [first, second] = [0, 1, 2].filter((axis) => axis !== rAxis);
        const R = randomRadius();
        const speed = speedFor(kind, R);
        if (!speed) return null;
        const angle = splitAngle();
        const v = [0, 0, 0];
        v[first] = randomSign() * snapSpeed(speed * Math.cos(angle));
        v[second] = randomSign() * snapSpeed(speed * Math.sin(angle));
        return { kind, r: vectorAlong(rAxis, randomSign() * R), v };
    }

    const nonzeroCount = (p) => p.filter((c) => c !== 0).length;

    function isUsable(candidate, S) {
        const counts = [nonzeroCount(candidate.r), nonzeroCount(candidate.v)];
        if (counts[0] < 1 || counts[1] < 1 || counts[0] > 2 || counts[1] > 2 || counts[0] + counts[1] > 3) return false;
        if (S.rDotV !== 0 || S.energy >= 0 || S.apsis !== candidate.kind) return false;
        if (candidate.kind === 'circular') return S.circular;
        if (S.eMag < MIN_E || S.eMag > MAX_E) return false;
        const perigee = S.aRaw * (1 - S.eMag), apogee = S.aRaw * (1 + S.eMag);
        return perigee >= R_EARTH + MIN_ALTITUDE && apogee <= MAX_APOGEE;
    }

    function generate() {
        for (;;) {
            const candidate = buildCandidate();
            if (!candidate) continue;
            const S = solve(candidate.r, candidate.v);
            if (isUsable(candidate, S)) return fromState(candidate.r, candidate.v);
        }
    }

    function fromState(r, v) {
        const solution = solve(r, v);
        return { r, v, statement: statement(r, v), solution, answers: solution.answers, steps: buildSteps(solution) };
    }

    /* ------------------------------------------------------------------ */
    /* Number Formatting                                                  */
    /* ------------------------------------------------------------------ */
    const MINUS = '−';

    function fixed(x, decimals) {
        const rounded = Number(Math.abs(x).toFixed(decimals));
        const text = rounded.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
        return (x < 0 && rounded !== 0 ? MINUS : '') + text;
    }

    // Number of decimals that leaves this many significant digits
    function placesFor(x, digits) {
        return Math.max(0, Math.min(12, digits - 1 - Math.floor(Math.log10(Math.abs(x)))));
    }

    function sig(x, digits = 5) {
        if (!Number.isFinite(x) || Math.abs(x) < 1e-12) return '0';
        return fixed(x, placesFor(x, digits));
    }

    function deg(x) {
        return `${fixed(x, 2)}°`;
    }

    const compR = (x) => (x === 0 ? '0' : fixed(x, 0));
    const compV = (x) => (x === 0 ? '0' : fixed(x, 3));
    const compAny = (x, digits = 5) => (Math.abs(x) < 1e-12 ? '0' : fixed(x, placesFor(x, digits)));

    const radiusText = (R) => (Number.isInteger(R) ? fixed(R, 0) : fixed(R, 2));

    /* ------------------------------------------------------------------ */
    /* Equation Notation                                                  */
    /* ------------------------------------------------------------------ */
    const R_V = '\\bar{\\mathbf{r}}', V_V = '\\bar{\\mathbf{v}}', H_V = '\\bar{\\mathbf{h}}', N_V = '\\bar{\\mathbf{n}}', E_V = '\\bar{\\mathbf{e}}';
    const ZERO_V = '\\bar{\\mathbf{0}}';
    const I_HAT = '\\mathbf{\\hat{I}}', J_HAT = '\\mathbf{\\hat{J}}', K_HAT = '\\mathbf{\\hat{K}}';
    const V_CIRC = 'v_{\\text{circ}}', V_HORIZONTAL = 'v_{\\text{horizontal}}';
    const MU_TEXT = '398,600.44';

    const KM = '\\text{ km}', KM_S = '\\text{ km/s}';
    const KM2_S = '\\text{ km}^2/\\text{s}', KM2_S2 = '\\text{ km}^2/\\text{s}^2';

    const frac = (top, bottom) => `\\dfrac{${top}}{${bottom}}`;
    const sqrt = (inner) => `\\sqrt{${inner}}`;
    const dotted = (p, q) => `${p} \\cdot ${q}`;
    const arcOf = (inner) => `\\arccos\\left(${inner}\\right)`;
    const paren = (text) => (text.startsWith(MINUS) ? `(${text})` : text);
    const squares = (parts) => parts.map((part) => `${paren(part)}^2`).join(' + ');
    const products = (parts) => parts.map(([p, q]) => `(${p})(${q})`).join(' + ');

    const undefinedMethod = (html) => [{ name: 'Undefined', value: 0, html }];
    const angleResult = (answer) => (answer.undefined ? prose('Undefined, so $0°$') : math(answer.text));

    function statement(r, v) {
        const item = (tex) => `<div class="given-item">${math(tex)}</div>`;
        return item(`${R_V} = ${column(r.map(compR))}${KM}`) + item(`${V_V} = ${column(v.map(compV))}${KM_S}`);
    }

    /* ------------------------------------------------------------------ */
    /* Shared Worked Lines                                                */
    /* ------------------------------------------------------------------ */
    const circularSpeedCalc = (S) => calc(`${V_CIRC} = ${sqrt(frac('\\mu', 'r'))}`,
        [sqrt(frac(MU_TEXT, radiusText(S.R)))], `${fixed(S.vCirc, 4)}${KM_S}`);

    function apsisDecision(S) {
        const perigee = S.apsis === 'perigee';
        const speeds = `$v = ${fixed(S.V, 4)}${KM_S} ${perigee ? '>' : '<'} ${V_CIRC}$`;
        return rule(speeds, perigee
            ? `The satellite is at perigee, so $r_p = r = ${radiusText(S.R)}${KM}$`
            : `The satellite is at apogee, so $r_a = r = ${radiusText(S.R)}${KM}$`);
    }

    const AXIS_LETTER = [I_HAT, J_HAT, K_HAT];

    // The axis a vector lies along, such as +I-hat, or null if it has two nonzero components.
    function axisOf(p) {
        const nonzero = [0, 1, 2].filter((k) => p[k] !== 0);
        if (nonzero.length !== 1) return null;
        const k = nonzero[0];
        return { index: k, sign: p[k] > 0 ? 1 : -1, text: `${p[k] > 0 ? '+' : MINUS}${AXIS_LETTER[k]}` };
    }

    /* ------------------------------------------------------------------ */
    /* Walkthrough Steps                                                  */
    /* ------------------------------------------------------------------ */
    function stepMagnitudes(S) {
        const html = calc(`r = ${sqrt('r_x^2 + r_y^2 + r_z^2')}`, [sqrt(squares(S.r.map(compR)))], `${radiusText(S.R)}${KM}`)
            + calc(`v = ${sqrt('v_x^2 + v_y^2 + v_z^2')}`, [sqrt(squares(S.v.map(compV)))], `${fixed(S.V, 4)}${KM_S}`)
            + calc(`${dotted(R_V, V_V)} = r_x v_x + r_y v_y + r_z v_z`,
                [products(S.r.map((c, k) => [compR(c), compV(S.v[k])]))], '0')
            + note('Velocity is perpendicular to position, so the satellite is at perigee, at apogee, or on a circular orbit.');
        return {
            key: 'mag',
            title: prose('Magnitudes'),
            result: math(`${radiusText(S.R)}${KM},\\ ${fixed(S.V, 3)}${KM_S}`),
            caption: prose(`<b>Magnitudes.</b> $${R_V}$ runs from Earth’s center to the satellite, and $${V_V}$ is at a right angle to it. $${V_V}$ is not drawn to scale.`),
            methods: [{ name: 'Vector length', value: S.R, html }]
        };
    }

    function stepSemiMajorAxis(S) {
        const circularNote = S.circular
            ? note(`The result is $${radiusText(S.R)}${KM}$ to within rounding, because the given speed is rounded. On a circle, $a = r$.`)
            : '';
        const inverseA = 2 / S.R - S.V * S.V / MU;
        const methods = [{
            name: 'Energy',
            value: S.aRaw,
            html: calc(`\\varepsilon = ${frac('v^2', '2')} - ${frac('\\mu', 'r')}`,
                [`${frac(`${paren(fixed(S.V, 4))}^2`, '2')} - ${frac(MU_TEXT, radiusText(S.R))}`], `${sig(S.energy)}${KM2_S2}`)
                + calc(`a = -${frac('\\mu', '2\\varepsilon')}`,
                    [`-${frac(MU_TEXT, `2(${sig(S.energy)})`)}`], `${fixed(S.aRaw, 1)}${KM}`)
                + circularNote
        }, {
            name: 'Vis-viva',
            value: S.aRaw,
            html: calc(`v = ${sqrt(`\\mu\\left(${frac('2', 'r')} - ${frac('1', 'a')}\\right)`)}`, [], '')
                + calc(`${frac('1', 'a')} = ${frac('2', 'r')} - ${frac('v^2', '\\mu')}`,
                    [`${frac('2', radiusText(S.R))} - ${frac(sig(S.V * S.V), MU_TEXT)}`], `${sig(inverseA, 7)}\\text{ km}^{-1}`)
                + calc('a = 1 / (1/a)', [`1 / ${sig(inverseA, 7)}`], `${fixed(S.aRaw, 1)}${KM}`)
                + circularNote
        }];
        if (S.circular) {
            methods.push({
                name: 'Circular speed',
                value: S.R,
                html: circularSpeedCalc(S)
                    + rule(`$v = ${fixed(S.V, 4)}${KM_S}$, which matches $${V_CIRC}$ after rounding.`, `The orbit is circular, so $a = r = ${radiusText(S.R)}${KM}$`)
            });
        }
        return {
            key: 'a',
            title: prose('Semi-major axis, $a$'),
            result: math(`${fixed(S.a, 1)}${KM}`),
            caption: S.circular
                ? prose('<b>Semi-major axis.</b> On a circle, $a$ is the radius.')
                : prose('<b>Semi-major axis.</b> The satellite is at one end of the orbit’s longest width. Half of that width is $a$.'),
            methods
        };
    }

    function stepAngularMomentum(S) {
        const [x, y, z] = S.r.map(compR);
        const [vx, vy, vz] = S.v.map(compV);
        const html = calc(`${H_V} = ${R_V} \\times ${V_V} = ${column(['r_y v_z - r_z v_y', 'r_z v_x - r_x v_z', 'r_x v_y - r_y v_x'])}`,
            [column([`(${y})(${vz}) - (${z})(${vy})`, `(${z})(${vx}) - (${x})(${vz})`, `(${x})(${vy}) - (${y})(${vx})`])],
            `${column(S.h.map((c) => compAny(c)))}${KM2_S}`)
            + calc(`h = ${sqrt('h_x^2 + h_y^2 + h_z^2')}`,
                [sqrt(squares(S.h.map((c) => compAny(c))))], `${sig(S.H)}${KM2_S}`);
        return {
            key: 'h',
            title: prose(`Angular momentum, $${H_V}$`),
            result: math(`${sig(S.H)}${KM2_S}`),
            caption: prose(`<b>Angular momentum.</b> $${H_V}$ is perpendicular to $${R_V}$ and $${V_V}$, by the right-hand rule. The orbit lies in the plane those two share.`),
            methods: [{ name: 'Cross product', value: S.H, html }]
        };
    }

    function directionWord(i) {
        if (i < 89.995) return 'prograde';
        if (i > 90.005) return 'retrograde';
        return 'polar';
    }

    function velocityTiltMethod(S) {
        if (S.r[2] !== 0) return null;
        const [vx, vy, vz] = S.v;
        const horizontal = Math.hypot(vx, vy);
        const speedLine = calc(`${V_HORIZONTAL} = ${sqrt('v_x^2 + v_y^2')}`,
            [sqrt(squares([compV(vx), compV(vy)]))], `${sig(horizontal)}${KM_S}`);

        if (horizontal === 0) {
            return {
                name: 'Velocity tilt',
                value: 90,
                html: speedLine + rule('The velocity has no horizontal speed at the equator.', 'The orbit is polar, so $i = 90.00°$')
            };
        }

        const position = axisOf(S.r);
        const eastward = -S.r[1] * vx + S.r[0] * vy > 0;
        const EAST = { 0: { 1: `+${J_HAT}`, '-1': `${MINUS}${J_HAT}` }, 1: { 1: `${MINUS}${I_HAT}`, '-1': `+${I_HAT}` } };
        const eastText = EAST[position.index][position.sign];
        const theta = Math.atan2(Math.abs(vz), horizontal) * R2D;
        const value = eastward ? theta : 180 - theta;
        return {
            name: 'Velocity tilt',
            value,
            html: speedLine
                + calc(`\\tan\\theta = ${frac('|v_z|', V_HORIZONTAL)}`,
                    [frac(fixed(Math.abs(vz), 3), sig(horizontal))], `${sig(Math.abs(vz) / horizontal)}`)
                + calc(`\\theta = \\arctan(${sig(Math.abs(vz) / horizontal)})`, [], deg(theta))
                + rule(`East at $${position.text}$ is $${eastText}$, so the satellite is moving ${eastward ? 'eastward' : 'westward'}.`,
                    eastward ? `$i = \\theta = ${deg(value)}$` : `$i = 180° - \\theta = ${deg(value)}$`)
        };
    }

    function stepInclination(S) {
        const cosI = S.h[2] / S.H;
        const methods = [{
            name: 'Angular momentum',
            value: S.i,
            html: calc(`\\cos i = ${frac(dotted(H_V, K_HAT), 'h')} = ${frac('h_z', 'h')}`,
                [frac(sig(S.h[2]), sig(S.H))], sig(cosI, 4))
                + calc(`i = \\arccos(${sig(cosI, 4)})`, [], deg(S.i))
                + note(`No quadrant check is needed. This orbit is ${directionWord(S.i)}.`)
        }];
        const tilt = velocityTiltMethod(S);
        if (tilt) methods.push(tilt);
        return {
            key: 'i',
            title: prose('Inclination, $i$'),
            result: angleResult(S.answers.i),
            caption: prose(`<b>Inclination.</b> The angle from $${K_HAT}$ to $${H_V}$, which is also the tilt of the orbital plane from the equator.`),
            methods
        };
    }

    function stepNodeVector(S) {
        const hx = compAny(S.h[0]), hy = compAny(S.h[1]);
        const html = calc(`${N_V} = ${K_HAT} \\times ${H_V} = ${column(['-h_y', 'h_x', '0'])}`,
            [column([`-${paren(hy)}`, hx, '0'])], `${column(S.n.map((c) => compAny(c)))}${KM2_S}`)
            + calc(`n = ${sqrt('h_x^2 + h_y^2')}`, [sqrt(squares([hx, hy]))], `${sig(S.N)}${KM2_S}`)
            + (S.equatorial ? note(`$${H_V}$ is parallel to $${K_HAT}$, so $${N_V}$ has no length. The orbit is equatorial and has no ascending node.`) : '');
        return {
            key: 'n',
            title: prose(`Node vector, $${N_V}$`),
            result: S.equatorial ? prose('$0$ (no node)') : math(`${sig(S.N)}${KM2_S}`),
            caption: S.equatorial
                ? prose(`<b>Node vector.</b> The orbit lies in the equatorial plane, so it never crosses the equator and $${N_V}$ has no length.`)
                : prose(`<b>Node vector.</b> $${N_V}$ lies where the two planes meet. It points to the ascending node, where the satellite crosses the equator heading north. The northern half of the orbital plane is shaded.`),
            methods: [{ name: 'Cross product', value: S.N, html }]
        };
    }

    function spotTheNodeMethod(S) {
        if (S.r[2] !== 0) return null;
        const northbound = S.v[2] > 0;
        const position = axisOf(S.r);
        const flat = arccos(S.r[0] / S.R);
        const direction = S.r[1] < 0 ? 360 - flat : flat;
        const directionLines = position
            ? rule(`$${R_V}$ lies along $${position.text}$.`, `Its direction from $${I_HAT}$ is $${deg(direction)}$`)
            : calc(`\\text{Direction of } ${R_V} = ${arcOf(frac('r_x', 'r'))}`, [arcOf(frac(compR(S.r[0]), radiusText(S.R)))], deg(flat))
                + (S.r[1] < 0 ? rule(`$r_y < 0$, so use $360° - ${deg(flat)} = ${deg(direction)}$`) : '');
        const value = northbound ? direction : wrap360(direction + 180);
        return {
            name: 'Spot the node',
            value,
            html: directionLines + rule(
                northbound
                    ? '$r_z = 0$ and $v_z > 0$, so the satellite is at the ascending node.'
                    : '$r_z = 0$ and $v_z < 0$, so the satellite is at the descending node. The ascending node is 180° away.',
                `$\\Omega = ${deg(value)}$`)
        };
    }

    function stepRaan(S) {
        if (S.equatorial) {
            return {
                key: 'raan',
                title: prose('RAAN, $\\Omega$'),
                result: angleResult(S.answers.raan),
                caption: prose('<b>RAAN.</b> An equatorial orbit has no ascending node, so $\\Omega$ is undefined and defaults to $0°$.'),
                methods: undefinedMethod(rule(`$${N_V} = ${ZERO_V}$, so there is no ascending node to measure to.`, '$\\Omega$ is undefined, so it defaults to $0°$'))
            };
        }
        const methods = [{
            name: 'Node vector',
            value: S.raan,
            html: calc(arcOf(frac('n_x', 'n')), [arcOf(frac(sig(S.n[0]), sig(S.N)))], deg(S.raanFlat))
                + rule(S.n[1] < 0 ? `$n_y = ${sig(S.n[1])} < 0$, so use $360°$ minus this value.` : `$n_y = ${sig(S.n[1])} \\ge 0$, so no quadrant change is needed.`, `$\\Omega = ${deg(S.raan)}$`)
        }];
        const spot = spotTheNodeMethod(S);
        if (spot) methods.push(spot);
        return {
            key: 'raan',
            title: prose('RAAN, $\\Omega$'),
            result: angleResult(S.answers.raan),
            caption: prose(`<b>RAAN.</b> Measured eastward along the equator from $${I_HAT}$ to $${N_V}$.`),
            methods
        };
    }

    function stepEccentricity(S) {
        const vectorMethod = {
            name: 'Eccentricity vector',
            value: S.answers.e.value,
            html: calc(`v^2 - ${frac('\\mu', 'r')}`, [`${sig(S.V * S.V)} - ${frac(MU_TEXT, radiusText(S.R))}`], `${sig(S.bracket)}${KM2_S2}`)
                + calc(`${E_V} = ${frac('1', '\\mu')}\\left[\\left(v^2 - ${frac('\\mu', 'r')}\\right)${R_V} - (${dotted(R_V, V_V)})${V_V}\\right]`,
                    [`${frac('1', MU_TEXT)}\\left[(${sig(S.bracket)})${column(S.r.map(compR))} - (0)${column(S.v.map(compV))}\\right]`],
                    column(S.eVec.map((c) => compAny(c, 4))))
                + calc(`e = |${E_V}|`, [sqrt(squares(S.eVec.map((c) => compAny(c, 4))))],
                    S.circular ? `${sig(S.eMag, 2)}` : fixed(S.eMag, 4))
                + (S.circular ? note('The value is not exactly zero only because the given speed is rounded. Treat the orbit as circular, so $e = 0$.') : '')
        };

        let methods;
        if (S.circular) {
            methods = [vectorMethod, {
                name: 'Circular speed',
                value: 0,
                html: circularSpeedCalc(S)
                    + rule(`$v = ${fixed(S.V, 4)}${KM_S}$, which matches $${V_CIRC}$ after rounding.`, 'The orbit is circular, so $e = 0$')
            }];
        } else {
            const perigee = S.apsis === 'perigee';
            const rp = perigee ? S.R : 2 * S.aRaw - S.R;
            const ra = perigee ? 2 * S.aRaw - S.R : S.R;
            const p = S.H * S.H / MU;
            methods = [vectorMethod, {
                name: 'Apsis radius',
                value: perigee ? 1 - S.R / S.aRaw : S.R / S.aRaw - 1,
                html: circularSpeedCalc(S) + apsisDecision(S)
                    + (perigee
                        ? calc(`r_p = a(1 - e) \\text{, so } e = 1 - ${frac('r_p', 'a')}`, [`1 - ${frac(radiusText(S.R), fixed(S.aRaw, 1))}`], fixed(1 - S.R / S.aRaw, 4))
                        : calc(`r_a = a(1 + e) \\text{, so } e = ${frac('r_a', 'a')} - 1`, [`${frac(radiusText(S.R), fixed(S.aRaw, 1))} - 1`], fixed(S.R / S.aRaw - 1, 4)))
            }, {
                name: 'Both apsides',
                value: (ra - rp) / (ra + rp),
                html: circularSpeedCalc(S) + apsisDecision(S)
                    + (perigee
                        ? calc(`a = ${frac('r_a + r_p', '2')} \\text{, so } r_a = 2a - r_p`, [`2(${fixed(S.aRaw, 1)}) - ${radiusText(S.R)}`], `${fixed(ra, 1)}${KM}`)
                        : calc(`a = ${frac('r_a + r_p', '2')} \\text{, so } r_p = 2a - r_a`, [`2(${fixed(S.aRaw, 1)}) - ${radiusText(S.R)}`], `${fixed(rp, 1)}${KM}`))
                    + calc(`e = ${frac('r_a - r_p', 'r_a + r_p')}`, [frac(fixed(ra - rp, 1), fixed(ra + rp, 1))], fixed((ra - rp) / (ra + rp), 4))
            }, {
                name: 'Angular momentum',
                value: Math.sqrt(1 - p / S.aRaw),
                html: calc(`p = ${frac('h^2', '\\mu')}`, [frac(`${paren(sig(S.H))}^2`, MU_TEXT)], `${fixed(p, 1)}${KM}`)
                    + calc(`p = a(1 - e^2) \\text{, so } e = ${sqrt(`1 - ${frac('p', 'a')}`)}`, [sqrt(`1 - ${frac(fixed(p, 1), fixed(S.aRaw, 1))}`)], fixed(Math.sqrt(1 - p / S.aRaw), 4))
            }];
        }

        return {
            key: 'e',
            title: prose(`Eccentricity vector, $${E_V}$, and $e$`),
            result: math(S.answers.e.text),
            caption: S.circular
                ? prose('<b>Eccentricity.</b> With $e = 0$, the shape is known, so the orbit can be drawn. A circle has no perigee to point to.')
                : prose(`<b>Eccentricity.</b> $e$ is the last piece of the shape, so the orbit can now be drawn. $${E_V}$ points from Earth’s center to perigee.`),
            methods
        };
    }

    function undefinedArgpReason(S) {
        if (S.equatorial && S.circular) return 'The orbit has no ascending node and no perigee.';
        return S.equatorial ? 'The orbit has no ascending node to measure from.' : 'The orbit has no perigee to measure to.';
    }

    function stepArgumentOfPerigee(S) {
        if (S.argpUndefined) {
            const reason = undefinedArgpReason(S);
            return {
                key: 'argp',
                title: prose('Argument of perigee, $\\omega$'),
                result: angleResult(S.answers.argp),
                caption: prose(`<b>Argument of perigee.</b> ${reason} $\\omega$ is undefined and defaults to $0°$.`),
                methods: undefinedMethod(rule(reason, '$\\omega$ is undefined, so it defaults to $0°$'))
            };
        }
        const perigee = S.apsis === 'perigee';
        const fromSatellite = perigee ? S.u : wrap360(S.u + 180);
        const methods = [{
            name: 'Dot product',
            value: S.argp,
            html: calc(`${dotted(N_V, E_V)} = n_x e_x + n_y e_y + n_z e_z`,
                [products(S.n.map((c, k) => [compAny(c), compAny(S.eVec[k], 4)]))], sig(S.nDotE))
                + calc(arcOf(frac(dotted(N_V, E_V), 'n\\,e')), [arcOf(frac(sig(S.nDotE), `(${sig(S.N)})(${fixed(S.eMag, 4)})`))], deg(S.argpFlat))
                + rule(S.eVec[2] < 0 ? `$e_z = ${sig(S.eVec[2], 4)} < 0$, so use $360°$ minus this value.` : `$e_z = ${sig(S.eVec[2], 4)} \\ge 0$, so no quadrant change is needed.`, `$\\omega = ${deg(S.argp)}$`)
        }, {
            name: 'Satellite position',
            value: fromSatellite,
            html: calc(`${dotted(N_V, R_V)} = n_x r_x + n_y r_y + n_z r_z`,
                [products(S.n.map((c, k) => [compAny(c), compR(S.r[k])]))], sig(S.nDotR))
                + calc(`u = ${arcOf(frac(dotted(N_V, R_V), 'n\\,r'))}`, [arcOf(frac(sig(S.nDotR), `(${sig(S.N)})(${radiusText(S.R)})`))], deg(S.uFlat))
                + rule(S.r[2] < 0 ? '$r_z < 0$, so use $360°$ minus this value.' : '$r_z \\ge 0$, so no quadrant change is needed.', `$u = ${deg(S.u)}$`)
                + rule(perigee
                    ? '$u$ is the angle from the ascending node to the satellite. The satellite is at perigee, so $\\omega = u$.'
                    : '$u$ is the angle from the ascending node to the satellite. The satellite is at apogee, and perigee is 180° from apogee.',
                perigee ? `$\\omega = ${deg(fromSatellite)}$` : `$\\omega = ${deg(S.u)} \\pm 180° = ${deg(fromSatellite)}$`)
        }];
        return {
            key: 'argp',
            title: prose('Argument of perigee, $\\omega$'),
            result: angleResult(S.answers.argp),
            caption: prose('<b>Argument of perigee.</b> Measured along the orbit, in the direction of travel, from the ascending node to perigee.'),
            methods
        };
    }

    function stepTrueAnomaly(S) {
        if (S.nuUndefined) {
            return {
                key: 'nu',
                title: prose('True anomaly, $\\nu$'),
                result: angleResult(S.answers.nu),
                caption: prose('<b>True anomaly.</b> A circle has no perigee to measure from, so $\\nu$ is undefined and defaults to $0°$.'),
                methods: undefinedMethod(rule('The orbit has no perigee to measure from.', '$\\nu$ is undefined, so it defaults to $0°$'))
            };
        }
        const perigee = S.apsis === 'perigee';
        const methods = [{
            name: 'Dot product',
            value: S.nu,
            html: calc(`${dotted(E_V, R_V)} = e_x r_x + e_y r_y + e_z r_z`,
                [products(S.eVec.map((c, k) => [compAny(c, 4), compR(S.r[k])]))], `${sig(S.eDotR)}${KM}`)
                + calc(arcOf(frac(dotted(E_V, R_V), 'e\\,r')), [arcOf(frac(sig(S.eDotR), `(${fixed(S.eMag, 4)})(${radiusText(S.R)})`))], deg(S.nuFlat))
                + rule(`$${dotted(R_V, V_V)} = 0 \\ge 0$, so no quadrant change is needed.`, `$\\nu = ${deg(S.nu)}$`)
        }, {
            name: 'Speed check',
            value: perigee ? 0 : 180,
            html: circularSpeedCalc(S)
                + rule(`$v = ${fixed(S.V, 4)}${KM_S} ${perigee ? '>' : '<'} ${V_CIRC}$, and $${dotted(R_V, V_V)} = 0$.`,
                    perigee ? 'The satellite is at perigee, so $\\nu = 0.00°$' : 'The satellite is at apogee, so $\\nu = 180.00°$')
        }];
        return {
            key: 'nu',
            title: prose('True anomaly, $\\nu$'),
            result: angleResult(S.answers.nu),
            caption: prose('<b>True anomaly.</b> Measured along the orbit, in the direction of travel, from perigee to the satellite.'),
            methods
        };
    }

    function buildSteps(S) {
        return [
            stepMagnitudes(S),
            stepSemiMajorAxis(S),
            stepAngularMomentum(S),
            stepInclination(S),
            stepNodeVector(S),
            stepRaan(S),
            stepEccentricity(S),
            stepArgumentOfPerigee(S),
            stepTrueAnomaly(S)
        ];
    }

    global.RvCoeProblems = {
        title: 'R-V Vectors to COEs',
        prompt: 'Find all six Classical Orbital Elements. Enter 0° for any element that is undefined.',
        limitsHtml: prose(`Accepted: $a$ within 0.5%, $e$ within 0.005, angles within 0.5°. $\\mu = ${MU_TEXT}\\text{ km}^3/\\text{s}^2$.`),
        overviewCaption: prose(`<b>The problem as given.</b> Only $${R_V}$ and $${V_V}$ are known. $${I_HAT}$ points toward the vernal equinox, and $${K_HAT}$ points toward the North Pole.`),
        constants: { MU, MU_TEXT, R_EARTH },
        fields: FIELDS,
        generate,
        fromState
    };
})(window);
