// R-V vector problems for Test 1 Practice. Each problem gives a position and a velocity with at
// most three nonzero components in total and at most two in either vector. The orbit is either
// circular, or the satellite is at perigee or apogee. Every angle is a multiple of 45 degrees, so
// a vector with two components has equal components. All six elements are asked for, and an
// undefined element counts as 0 degrees.
//
// The walkthrough calculates only size and shape. It reads the four angles by inspection and the
// right-hand rule, following the visual inspection section of the Inertial Frame Orbital Elements
// lesson. The vectors h, n, and e are used only for the true answers and the 3D view.
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
        const argpFlat = hasPerigeeAngle ? arccos(dot(n, eVec) / (N * eMag)) : 0;
        const argpRaw = eVec[2] < 0 ? 360 - argpFlat : argpFlat;

        const nuFlat = circular ? 0 : arccos(dot(eVec, r) / (eMag * R));
        const nuRaw = rDotV < 0 ? 360 - nuFlat : nuFlat;

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
            r, v, R, V, rDotV, energy, a, aRaw, h, H, i, n, N, eVec, eMag, vCirc, apsis, circular, equatorial,
            raan: raanRaw, argp: argpRaw, nu: nuRaw, raanUndefined, argpUndefined, nuUndefined, answers
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

    // Two equal components point halfway between two axes, which keeps every angle on 45 degrees.
    function equalParts(axes, part) {
        const out = [0, 0, 0];
        for (const axis of axes) out[axis] = randomSign() * part;
        return out;
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
            const axes = [0, 1, 2].filter((axis) => axis !== vAxis);
            const r = equalParts(axes, snapRadius(randomRadius() * Math.SQRT1_2));
            const speed = speedFor(kind, length(r));
            if (!speed) return null;
            return { kind, r, v: vectorAlong(vAxis, randomSign() * snapSpeed(speed)) };
        }

        const rAxis = pick([0, 1, 2]);
        const axes = [0, 1, 2].filter((axis) => axis !== rAxis);
        const R = randomRadius();
        const speed = speedFor(kind, R);
        if (!speed) return null;
        return { kind, r: vectorAlong(rAxis, randomSign() * R), v: equalParts(axes, snapSpeed(speed * Math.SQRT1_2)) };
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

    const radiusText = (R) => (Number.isInteger(R) ? fixed(R, 0) : fixed(R, 2));

    /* ------------------------------------------------------------------ */
    /* Equation Notation                                                  */
    /* ------------------------------------------------------------------ */
    const R_V = '\\bar{\\mathbf{r}}', V_V = '\\bar{\\mathbf{v}}';
    const I_HAT = '\\mathbf{\\hat{I}}', J_HAT = '\\mathbf{\\hat{J}}', K_HAT = '\\mathbf{\\hat{K}}';
    const V_CIRC = 'v_{\\text{circ}}';
    const MU_TEXT = '398,600.44';

    const KM = '\\text{ km}', KM_S = '\\text{ km/s}', KM2_S2 = '\\text{ km}^2/\\text{s}^2';

    const frac = (top, bottom) => `\\dfrac{${top}}{${bottom}}`;
    const sqrt = (inner) => `\\sqrt{${inner}}`;
    const paren = (text) => (text.startsWith(MINUS) ? `(${text})` : text);
    const squares = (parts) => parts.map((part) => `${paren(part)}^2`).join(' + ');

    const undefinedMethod = (html) => [{ name: 'Undefined', value: 0, html }];
    const angleResult = (answer) => (answer.undefined ? prose('Undefined, so $0°$') : math(answer.text));
    const atPerigee = (S) => S.R < S.aRaw;

    function statement(r, v) {
        const item = (tex) => `<div class="given-item">${math(tex)}</div>`;
        return item(`${R_V} = ${column(r.map(compR))}${KM}`) + item(`${V_V} = ${column(v.map(compV))}${KM_S}`);
    }

    /* ------------------------------------------------------------------ */
    /* Where the Satellite Is                                             */
    /* ------------------------------------------------------------------ */
    // In every problem, r_z and v_z tell where the satellite is on its orbit. If r_z is not zero,
    // v_z must be zero, because r and v are perpendicular and have at most three nonzero components.
    const QUARTERS_PAST_NODE = { ascending: 0, top: 90, descending: 180, bottom: 270 };

    function placeOf(S) {
        if (S.r[2] > 0) return 'top';
        if (S.r[2] < 0) return 'bottom';
        if (S.v[2] > 0) return 'ascending';
        return S.v[2] < 0 ? 'descending' : 'equatorial';
    }

    const CURL = `Curl your right fingers from $${R_V}$ toward $${V_V}$.`;

    const circularSpeedCalc = (S) => calc(`${V_CIRC} = ${sqrt(frac('\\mu', 'r'))}`,
        [sqrt(frac(MU_TEXT, radiusText(S.R)))], `${fixed(S.vCirc, 4)}${KM_S}`);

    function apsisByDistance(S) {
        const near = atPerigee(S);
        return rule(`$r = ${radiusText(S.R)}${KM}$ is ${near ? 'less' : 'more'} than $a = ${fixed(S.aRaw, 1)}${KM}$.`,
            near ? `The satellite is at perigee, so $r_p = r$` : `The satellite is at apogee, so $r_a = r$`);
    }

    /* ------------------------------------------------------------------ */
    /* Walkthrough Steps                                                  */
    /* ------------------------------------------------------------------ */
    function stepMagnitudes(S) {
        const html = calc(`r = ${sqrt('r_x^2 + r_y^2 + r_z^2')}`, [sqrt(squares(S.r.map(compR)))], `${radiusText(S.R)}${KM}`)
            + calc(`v = ${sqrt('v_x^2 + v_y^2 + v_z^2')}`, [sqrt(squares(S.v.map(compV)))], `${fixed(S.V, 4)}${KM_S}`)
            + note(`$${R_V}$ and $${V_V}$ share no nonzero component, so they are perpendicular. The satellite is at perigee, at apogee, or on a circular orbit.`);
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

    function stepEccentricity(S) {
        let methods;
        if (S.circular) {
            methods = [{
                name: 'Compare r and a',
                value: 0,
                html: rule(`$a = ${fixed(S.aRaw, 1)}${KM}$ and $r = ${radiusText(S.R)}${KM}$ match to within rounding.`, 'The orbit is circular, so $e = 0$')
            }, {
                name: 'Circular speed',
                value: 0,
                html: circularSpeedCalc(S)
                    + rule(`$v = ${fixed(S.V, 4)}${KM_S}$, which matches $${V_CIRC}$ after rounding.`, 'The orbit is circular, so $e = 0$')
            }];
        } else {
            const near = atPerigee(S);
            const other = 2 * S.aRaw - S.R;
            const rp = near ? S.R : other;
            const ra = near ? other : S.R;
            const fromApsis = near ? 1 - S.R / S.aRaw : S.R / S.aRaw - 1;
            methods = [{
                name: 'Apsis radius',
                value: fromApsis,
                html: apsisByDistance(S)
                    + (near
                        ? calc(`r_p = a(1 - e) \\text{, so } e = 1 - ${frac('r_p', 'a')}`, [`1 - ${frac(radiusText(S.R), fixed(S.aRaw, 1))}`], fixed(fromApsis, 4))
                        : calc(`r_a = a(1 + e) \\text{, so } e = ${frac('r_a', 'a')} - 1`, [`${frac(radiusText(S.R), fixed(S.aRaw, 1))} - 1`], fixed(fromApsis, 4)))
            }, {
                name: 'Both apsides',
                value: (ra - rp) / (ra + rp),
                html: apsisByDistance(S)
                    + (near
                        ? calc(`a = ${frac('r_a + r_p', '2')} \\text{, so } r_a = 2a - r_p`, [`2(${fixed(S.aRaw, 1)}) - ${radiusText(S.R)}`], `${fixed(ra, 1)}${KM}`)
                        : calc(`a = ${frac('r_a + r_p', '2')} \\text{, so } r_p = 2a - r_a`, [`2(${fixed(S.aRaw, 1)}) - ${radiusText(S.R)}`], `${fixed(rp, 1)}${KM}`))
                    + calc(`e = ${frac('r_a - r_p', 'r_a + r_p')}`, [frac(fixed(ra - rp, 1), fixed(ra + rp, 1))], fixed((ra - rp) / (ra + rp), 4))
            }];
        }
        return {
            key: 'e',
            title: prose('Eccentricity, $e$'),
            result: math(S.answers.e.text),
            caption: prose(`<b>Eccentricity.</b> With $a$ and $e$, the orbit’s size and shape are known, so it can be drawn. It lies in the plane of $${R_V}$ and $${V_V}$.`),
            methods
        };
    }

    function inclinationMethod(S) {
        const [rx, ry, rz] = S.r;
        const [vx, vy, vz] = S.v;
        const place = placeOf(S);
        const eastward = rx * vy - ry * vx > 0;

        if (place === 'equatorial') {
            const value = eastward ? 0 : 180;
            return {
                value,
                html: rule(`${CURL} Your thumb points straight ${eastward ? `up, along $+${K_HAT}$` : `down, along $${MINUS}${K_HAT}$`}.`)
                    + note(`Both vectors lie in the equatorial plane, so the orbit does too. It moves ${eastward ? 'east, the same way Earth turns' : 'west, against Earth’s turn'}.`)
                    + rule(eastward ? 'Your thumb matches the North Pole.' : 'Your thumb is opposite the North Pole.', `$i = ${deg(value)}$`)
            };
        }

        const overPole = rx === 0 && ry === 0;
        const straightUp = rz === 0 && vx === 0 && vy === 0;
        if (overPole || straightUp) {
            const why = overPole
                ? `The satellite is directly over the ${rz > 0 ? 'North' : 'South'} Pole, so the orbit passes over the poles.`
                : `The satellite is on the equator and moving straight ${vz > 0 ? 'north' : 'south'}, so the orbit passes over the poles.`;
            return {
                value: 90,
                html: rule(`${CURL} Your thumb lies level with the equator.`) + rule(why, 'The orbit is polar, so $i = 90.00°$')
            };
        }

        // The vertical part and the one horizontal part of whichever vector is tilted
        const letter = rz === 0 ? 'v' : 'r';
        const [x, y, z] = rz === 0 ? S.v : S.r;
        const sideAxis = x !== 0 ? 'x' : 'y';
        const tilt = Math.atan2(Math.abs(z), Math.abs(x !== 0 ? x : y)) * R2D;
        const value = eastward ? tilt : 180 - tilt;
        const why = rz === 0
            ? `The satellite is on the equator, so the climb of $${V_V}$ out of the equator is the tilt of the orbit.`
            : `$v_z = 0$, so the satellite is at the ${rz > 0 ? 'top' : 'bottom'} of its orbit. Its latitude there equals the tilt of the orbit.`;
        const halfway = rz === 0 ? `halfway between level and straight ${vz > 0 ? 'north' : 'south'}` : 'halfway between the equator and the pole';
        return {
            value,
            html: rule(`${CURL} Your thumb leans ${eastward ? 'north, so the satellite moves east and the orbit is prograde' : 'south, so the satellite moves west and the orbit is retrograde'}.`)
                + rule(why)
                + rule(`$|${letter}_z|$ and $|${letter}_${sideAxis}|$ are equal, so $${letter === 'v' ? V_V : R_V}$ is ${halfway}.`, 'The tilt is $45°$')
                + rule(eastward ? 'Prograde, so the tilt is the inclination.' : 'Retrograde, so subtract the tilt from 180°.',
                    eastward ? `$i = ${deg(value)}$` : `$i = 180° - 45° = ${deg(value)}$`)
        };
    }

    function stepInclination(S) {
        const method = inclinationMethod(S);
        return {
            key: 'i',
            title: prose('Inclination, $i$'),
            result: angleResult(S.answers.i),
            caption: prose(`<b>Inclination.</b> Curl your right fingers from $${R_V}$ to $${V_V}$. Your thumb is the orbit’s axis, and $i$ is the angle from $${K_HAT}$ to your thumb.`),
            methods: [{ name: 'Right-hand rule', value: method.value, html: method.html }]
        };
    }

    // Which way the ascending node lies, in the equatorial plane.
    function findNode(S) {
        const place = placeOf(S);
        const [source, letter, sign, sentence] = {
            ascending: [S.r, 'r', 1, `$r_z = 0$ and $v_z > 0$, so the satellite is on the equator heading north. It is at the ascending node, along $${R_V}$.`],
            descending: [S.r, 'r', -1, `$r_z = 0$ and $v_z < 0$, so the satellite is on the equator heading south. It is at the descending node, so the ascending node is on the far side of Earth, along $${MINUS}${R_V}$.`],
            top: [S.v, 'v', -1, `$r_z > 0$ and $v_z = 0$, so the satellite is level at the top of its orbit. The ascending node is a quarter orbit behind it, along $${MINUS}${V_V}$.`],
            bottom: [S.v, 'v', 1, `$r_z < 0$ and $v_z = 0$, so the satellite is level at the bottom of its orbit. The ascending node is a quarter orbit ahead of it, along $${V_V}$.`]
        }[place];
        return { x: sign * source[0], y: sign * source[1], letter, source, sentence };
    }

    function readNodeAngle(node) {
        const { x, y, letter } = node;
        if (x === 0 || y === 0) {
            const [angle, axis, phrase] = x > 0 ? [0, `+${I_HAT}`, 'right at'] : y > 0 ? [90, `+${J_HAT}`, 'a quarter turn east of']
                : x < 0 ? [180, `${MINUS}${I_HAT}`, 'a half turn east of'] : [270, `${MINUS}${J_HAT}`, 'three quarters of a turn east of'];
            return {
                value: angle,
                html: rule(`The ascending node lies along $${axis}$, ${phrase} $${I_HAT}$.`, `$\\Omega = ${deg(angle)}$`)
            };
        }

        const tilt = Math.atan2(Math.abs(y), Math.abs(x)) * R2D;
        const [value, halfway] = x > 0 && y > 0 ? [tilt, `$+${I_HAT}$ at $0°$ and $+${J_HAT}$ at $90°$`]
            : x < 0 && y > 0 ? [180 - tilt, `$+${J_HAT}$ at $90°$ and $${MINUS}${I_HAT}$ at $180°$`]
                : x < 0 ? [180 + tilt, `$${MINUS}${I_HAT}$ at $180°$ and $${MINUS}${J_HAT}$ at $270°$`]
                    : [360 - tilt, `$${MINUS}${J_HAT}$ at $270°$ and $+${I_HAT}$ at $360°$`];
        return {
            value,
            html: rule(`$|${letter}_x|$ and $|${letter}_y|$ are equal, so the ascending node is halfway between ${halfway}.`, `$\\Omega = ${deg(value)}$`)
        };
    }

    function stepRaan(S) {
        if (S.equatorial) {
            return {
                key: 'raan',
                title: prose('RAAN, $\\Omega$'),
                result: angleResult(S.answers.raan),
                caption: prose('<b>RAAN.</b> An equatorial orbit has no ascending node, so $\\Omega$ is undefined and defaults to $0°$.'),
                methods: undefinedMethod(rule('The orbit lies in the equatorial plane, so it never crosses the equator and has no ascending node.', '$\\Omega$ is undefined, so it defaults to $0°$'))
            };
        }
        const node = findNode(S);
        const reading = readNodeAngle(node);
        return {
            key: 'raan',
            title: prose('RAAN, $\\Omega$'),
            result: angleResult(S.answers.raan),
            caption: prose(`<b>RAAN.</b> The bright half of the orbit is north of the equator and begins at the ascending node. $\\Omega$ is measured eastward from $${I_HAT}$ to that node.`),
            methods: [{
                name: 'Right-hand rule',
                value: reading.value,
                html: rule(node.sentence)
                    + rule(`Point your right thumb at $${K_HAT}$. Your fingers curl east, from $${I_HAT}$ toward $${J_HAT}$. $\\Omega$ grows in that direction.`)
                    + reading.html
            }]
        };
    }

    function undefinedArgpReason(S) {
        if (S.equatorial && S.circular) return 'The orbit has no ascending node and no perigee.';
        return S.equatorial ? 'The orbit has no ascending node to measure from.' : 'The orbit has no perigee to measure to.';
    }

    const PLACE_TEXT = {
        ascending: 'The satellite is at the ascending node, so it has traveled $0°$ from it.',
        top: 'The satellite is at the top of its orbit, a quarter orbit past the ascending node, so it has traveled $90°$.',
        descending: 'The satellite is at the descending node, a half orbit past the ascending node, so it has traveled $180°$.',
        bottom: 'The satellite is at the bottom of its orbit, three quarters of an orbit past the ascending node, so it has traveled $270°$.'
    };

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
        const place = placeOf(S);
        const traveled = QUARTERS_PAST_NODE[place];
        const near = atPerigee(S);
        const value = near ? traveled : wrap360(traveled + 180);
        return {
            key: 'argp',
            title: prose('Argument of perigee, $\\omega$'),
            result: angleResult(S.answers.argp),
            caption: prose('<b>Argument of perigee.</b> Measured along the orbit, in the direction of travel, from the ascending node to perigee.'),
            methods: [{
                name: 'Right-hand rule',
                value,
                html: rule('Keep your right thumb on the orbit’s axis. Your fingers curl in the direction of travel. $\\omega$ grows in that direction.')
                    + rule(PLACE_TEXT[place])
                    + rule(near ? 'The satellite is at perigee, so perigee is at that same point.' : 'The satellite is at apogee, and perigee is a half orbit from apogee.',
                        near ? `$\\omega = ${deg(value)}$` : `$\\omega = ${deg(traveled)} \\pm 180° = ${deg(value)}$`)
            }]
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
        const near = atPerigee(S);
        const value = near ? 0 : 180;
        const conclusion = near
            ? 'The satellite is at perigee, so it has traveled $\\nu = 0.00°$ from perigee'
            : 'The satellite is at apogee, a half orbit from perigee, so $\\nu = 180.00°$';
        return {
            key: 'nu',
            title: prose('True anomaly, $\\nu$'),
            result: angleResult(S.answers.nu),
            caption: prose('<b>True anomaly.</b> Measured along the orbit, in the direction of travel, from perigee to the satellite.'),
            methods: [{
                name: 'Distance',
                value,
                html: rule(`$r = ${radiusText(S.R)}${KM}$ is ${near ? 'less' : 'more'} than $a = ${fixed(S.aRaw, 1)}${KM}$.`, conclusion)
            }, {
                name: 'Speed check',
                value: S.V > S.vCirc ? 0 : 180,
                html: circularSpeedCalc(S)
                    + rule(`$v = ${fixed(S.V, 4)}${KM_S} ${S.V > S.vCirc ? '>' : '<'} ${V_CIRC}$.`, conclusion)
            }]
        };
    }

    function buildSteps(S) {
        return [
            stepMagnitudes(S),
            stepSemiMajorAxis(S),
            stepEccentricity(S),
            stepInclination(S),
            stepRaan(S),
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
