// COE box problems for the Test 1 Practice page. The problem gives a set of classical orbital
// elements, and the student checks every one of the 14 boxes on the course sheet that describes
// the orbit or where the spacecraft is. The rules are the HP Prime app's (owBox in
// ../../HP Prime OW/OTCOW-app.txt):
//   circular             e = 0
//   equatorial           i = 0° or 180°
//   prograde / retrograde / polar orbit   i < 90° / i > 90° / i = 90°
//   s/c at north / south pole             the K part of r/|r| is +1 / -1
//   s/c on i / j / k axis only            the other two parts of r/|r| are 0
//   s/c at ascending / descending node    not equatorial, and u = 0° / 180°
//   s/c at perigee / apogee               not circular, and nu = 0° / 180°
// with u = omega + nu and r/|r| = R3(-Omega) R1(-i) R3(-u) I.
// An undefined element is replaced as the Inertial Frame Orbital Elements lesson does: a circular
// inclined orbit gives the argument of latitude u, an elliptical equatorial orbit the longitude of
// perigee Pi, and a circular equatorial orbit the true longitude l, both measured east from +I.
// Load as a classic script, after practice-math.js.
(function (global) {
    'use strict';

    const { math, prose, calc, note, rule, column } = global.PracticeMath;
    const D2R = Math.PI / 180;
    const R_EARTH = global.TestReviewMath.course.R_EARTH;
    const MIN_PERIGEE = 6578;               // Perigee at least 200 km up

    // The kinds of orbit, and how often each comes up
    const KINDS = [
        ['elliptical', 0.45],
        ['circular', 0.2],
        ['ellipticalEquatorial', 0.15],
        ['circularEquatorial', 0.2]
    ];

    // The 14 boxes, in the sheet's order: the orbit's column, then the position's
    const BOXES = [
        { key: 'circular', name: 'circular' },
        { key: 'equatorial', name: 'equatorial' },
        { key: 'prograde', name: 'prograde' },
        { key: 'retrograde', name: 'retrograde' },
        { key: 'polar', name: 'polar orbit' },
        { key: 'north', name: 's/c at north pole' },
        { key: 'south', name: 's/c at south pole' },
        { key: 'iaxis', name: 's/c on i axis <u>only</u>' },
        { key: 'jaxis', name: 's/c on j axis <u>only</u>' },
        { key: 'kaxis', name: 's/c on k axis <u>only</u>' },
        { key: 'an', name: 's/c at ascending node' },
        { key: 'dn', name: 's/c at descending node' },
        { key: 'perigee', name: 's/c at perigee' },
        { key: 'apogee', name: 's/c at apogee' }
    ];

    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const chance = (p) => Math.random() < p;
    const wrap360 = (x) => ((x % 360) + 360) % 360;
    // A whole number of 5° steps from low to high, both included
    const step5 = (low, high) => low + 5 * Math.floor(Math.random() * ((high - low) / 5 + 1));
    const SPECIAL = [0, 90, 180, 270];
    // An angle that is often on an axis: one of the four quarter turns, or any 5° step
    const angle = (special) => (chance(special) ? pick(SPECIAL) : step5(0, 355));

    function pickKind() {
        let r = Math.random();
        for (const [kind, weight] of KINDS) {
            if ((r -= weight) < 0) return kind;
        }
        return KINDS[0][0];
    }

    // An inclined orbit: polar often, the named real orbits sometimes, else any 5° step
    function inclination() {
        const r = Math.random();
        if (r < 0.25) return 90;
        if (r < 0.4) return pick([28.5, 51.6, 63.4]);
        let i;
        do { i = step5(5, 175); } while (i === 90);
        return i;
    }

    function semiMajorAxis(e) {
        const low = Math.max(7000, MIN_PERIGEE / (1 - e));
        const a = low + Math.random() * (42000 - low);
        return Math.ceil(a / 500) * 500;
    }

    /* ------------------------------------------------------------------ */
    /* The Boxes                                                          */
    /* ------------------------------------------------------------------ */
    // The direction to the spacecraft. An inclined orbit uses u from the node; an equatorial
    // orbit uses its longitude L, measured east from +I. Each part is rounded to 9 places so that
    // a value like cos 90° counts as zero.
    const clean = (x) => {
        const r = Math.round(x * 1e9) / 1e9;
        return Object.is(r, -0) ? 0 : r;
    };

    function direction(m) {
        if (m.equatorial) return [clean(Math.cos(m.L * D2R)), clean(Math.sin(m.L * D2R)), 0];
        const [cO, sO] = [Math.cos(m.raan * D2R), Math.sin(m.raan * D2R)];
        const [cu, su] = [Math.cos(m.u * D2R), Math.sin(m.u * D2R)];
        const [ci, si] = [Math.cos(m.i * D2R), Math.sin(m.i * D2R)];
        return [clean(cO * cu - sO * su * ci), clean(sO * cu + cO * su * ci), clean(su * si)];
    }

    function boxesFor(m) {
        const [rx, ry, rz] = m.rhat;
        return {
            circular: m.circular,
            equatorial: m.equatorial,
            prograde: m.i < 90,
            retrograde: m.i > 90,
            polar: m.i === 90,
            north: rz === 1,
            south: rz === -1,
            iaxis: ry === 0 && rz === 0,
            jaxis: rx === 0 && rz === 0,
            kaxis: rx === 0 && ry === 0,
            an: !m.equatorial && m.u === 0,
            dn: !m.equatorial && m.u === 180,
            perigee: !m.circular && m.nu === 0,
            apogee: !m.circular && m.nu === 180
        };
    }

    /* ------------------------------------------------------------------ */
    /* The Orbit                                                          */
    /* ------------------------------------------------------------------ */
    function model(kind) {
        const circular = kind === 'circular' || kind === 'circularEquatorial';
        const equatorial = kind === 'ellipticalEquatorial' || kind === 'circularEquatorial';
        const e = circular ? 0 : step5(5, 80) / 100;
        const m = {
            kind, circular, equatorial, e,
            a: semiMajorAxis(e),
            i: equatorial ? (kind === 'circularEquatorial' && chance(0.3) ? 180 : 0) : inclination(),
            raan: null, argp: null, nu: null, u: null, Pi: null, ell: null, L: null
        };
        if (kind === 'elliptical') {
            m.raan = angle(0.6);
            m.u = angle(0.7);
            m.nu = chance(0.5) ? pick([0, 180]) : angle(0.3);
            m.argp = wrap360(m.u - m.nu);
        } else if (kind === 'circular') {
            m.raan = angle(0.6);
            m.u = angle(0.7);
        } else if (kind === 'ellipticalEquatorial') {
            m.Pi = angle(0.5);
            m.nu = chance(0.5) ? pick([0, 180]) : angle(0.3);
            m.L = wrap360(m.Pi + m.nu);
        } else {
            m.ell = angle(0.7);
            m.L = m.ell;
        }
        m.rhat = direction(m);
        m.boxes = boxesFor(m);
        return m;
    }

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    const deg = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    const km = (x) => Number(x).toLocaleString('en-US');
    const num = (x) => {
        const r = Math.round(x * 1e4) / 1e4;
        return String(Object.is(r, -0) ? 0 : r).replace('-', '−');
    };
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;
    const UNDEF = '\\text{undefined}';
    const box = (m, key) => {
        const b = BOXES.find((x) => x.key === key);
        return `${m.boxes[key] ? '☑' : '☐'} ${b.name}`;
    };
    const boxLines = (m, keys) => keys.map((key) => box(m, key)).join('<br>');

    function statement(m) {
        const angleOr = (x) => (x === null ? UNDEF : `${deg(x)}°`);
        let text = item(`a = ${km(m.a)}\\text{ km}`) + item(`e = ${m.circular ? '0.0' : m.e}`) + item(`i = ${deg(m.i)}°`);
        if (m.kind === 'elliptical' || m.kind === 'circular') {
            text += item(`\\Omega = ${deg(m.raan)}°`) + item(`\\omega = ${angleOr(m.argp)}`) + item(`\\nu = ${angleOr(m.nu)}`);
            if (m.circular) text += item(`u = ${deg(m.u)}°`);
        } else if (m.kind === 'ellipticalEquatorial') {
            text += item(`\\Omega = ${UNDEF}`) + item(`\\omega = ${UNDEF}`) + item(`\\nu = ${deg(m.nu)}°`) + item(`\\Pi = ${deg(m.Pi)}°`);
        } else {
            text += item(`\\Omega = ${UNDEF}`) + item(`\\omega = ${UNDEF}`) + item(`\\nu = ${UNDEF}`) + item(`\\ell = ${deg(m.ell)}°`);
        }
        return text;
    }

    /* ------------------------------------------------------------------ */
    /* Walkthrough                                                        */
    /* ------------------------------------------------------------------ */
    function shapeStep(m) {
        return {
            key: 'shape',
            title: prose('Shape from $e$'),
            result: math(m.circular ? 'e = 0' : `e = ${m.e} > 0`),
            caption: '',
            methods: [{
                name: 'Shape',
                html: (m.circular
                    ? rule('$e = 0$: the orbit is a circle. It has no perigee or apogee, so $\\omega$ and $\\nu$ are undefined.', boxLines(m, ['circular']))
                    : rule(`$e = ${m.e}$ is more than zero: the orbit is an ellipse, not a circle.`, boxLines(m, ['circular'])))
            }]
        };
    }

    function tiltStep(m) {
        let text;
        if (m.i === 0) text = '$i = 0°$: the orbit lies in the equator, moving east with Earth. It is equatorial, and also prograde.';
        else if (m.i === 180) text = '$i = 180°$: the orbit lies in the equator, moving west against Earth. It is equatorial, and also retrograde.';
        else if (m.i === 90) text = '$i = 90°$: the orbit passes over both poles. It is a polar orbit, which is neither prograde nor retrograde.';
        else if (m.i < 90) text = `$i = ${deg(m.i)}°$ is less than $90°$: the orbit is prograde, moving east like Earth. It is tilted, so it is not equatorial.`;
        else text = `$i = ${deg(m.i)}°$ is more than $90°$: the orbit is retrograde, moving west against Earth. It is tilted, so it is not equatorial.`;
        return {
            key: 'tilt',
            title: prose('Tilt from $i$'),
            result: math(`i = ${deg(m.i)}°`),
            caption: '',
            methods: [{
                name: 'Tilt',
                html: rule(text, boxLines(m, ['equatorial', 'prograde', 'retrograde', 'polar']))
                    + note('$i < 90°$ is prograde, $i > 90°$ retrograde, and $i = 90°$ polar. $i = 0°$ or $180°$ is equatorial.')
            }]
        };
    }

    function whereStep(m) {
        let html, result;
        if (m.kind === 'elliptical') {
            const raw = m.argp + m.nu;
            html = calc('u = \\omega + \\nu', [`${deg(m.argp)}° + ${deg(m.nu)}°`], raw >= 360 ? `${deg(raw)}° - 360° = ${deg(m.u)}°` : `${deg(m.u)}°`)
                + note('The argument of latitude $u$ is how far the spacecraft is past the ascending node, in the direction of travel.');
            result = math(`u = ${deg(m.u)}°`);
        } else if (m.kind === 'circular') {
            html = rule(`A circular orbit has no perigee, so the position is given as the argument of latitude: $u = ${deg(m.u)}°$ past the ascending node.`);
            result = math(`u = ${deg(m.u)}°`);
        } else if (m.kind === 'ellipticalEquatorial') {
            const raw = m.Pi + m.nu;
            html = rule('An equatorial orbit has no ascending node, so perigee is located by the longitude of perigee $\\Pi$, measured east from $+\\hat{I}$.')
                + calc('L = \\Pi + \\nu', [`${deg(m.Pi)}° + ${deg(m.nu)}°`], raw >= 360 ? `${deg(raw)}° - 360° = ${deg(m.L)}°` : `${deg(m.L)}°`)
                + note('$L$ is the spacecraft\'s angle east of $+\\hat{I}$, in the equator.');
            result = math(`L = ${deg(m.L)}°`);
        } else {
            html = rule(`A circular equatorial orbit has no perigee and no node, so the position is given as the true longitude: $\\ell = ${deg(m.ell)}°$ east of $+\\hat{I}$.`);
            result = math(`\\ell = ${deg(m.ell)}°`);
        }
        return { key: 'where', title: prose('Where the spacecraft is'), result, caption: '', methods: [{ name: 'Position angle', html }] };
    }

    function directionStep(m) {
        const r = m.rhat;
        const rCol = column(r.map(num));
        let work;
        if (m.equatorial) {
            const L = m.L;
            work = calc('\\hat{r} = \\begin{bmatrix}\\cos L \\\\ \\sin L \\\\ 0\\end{bmatrix}', [
                `\\begin{bmatrix}\\cos ${deg(L)}° \\\\ \\sin ${deg(L)}° \\\\ 0\\end{bmatrix}`
            ], rCol);
        } else {
            work = calc('\\hat{r} = \\begin{bmatrix}\\cos\\Omega\\cos u - \\sin\\Omega\\sin u\\cos i \\\\ \\sin\\Omega\\cos u + \\cos\\Omega\\sin u\\cos i \\\\ \\sin u\\sin i\\end{bmatrix}', [
                `\\begin{bmatrix}\\cos ${deg(m.raan)}°\\cos ${deg(m.u)}° - \\sin ${deg(m.raan)}°\\sin ${deg(m.u)}°\\cos ${deg(m.i)}° \\\\ \\sin ${deg(m.raan)}°\\cos ${deg(m.u)}° + \\cos ${deg(m.raan)}°\\sin ${deg(m.u)}°\\cos ${deg(m.i)}° \\\\ \\sin ${deg(m.u)}°\\sin ${deg(m.i)}°\\end{bmatrix}`
            ], rCol);
        }

        const zeros = r.filter((x) => x === 0).length;
        let reading;
        if (m.boxes.north) reading = 'The K part is $+1$: the spacecraft is straight over the north pole, on the k axis.';
        else if (m.boxes.south) reading = 'The K part is $-1$: the spacecraft is straight over the south pole, on the k axis.';
        else if (zeros === 2) reading = `Only the ${m.boxes.iaxis ? 'I' : 'J'} part is not zero: the spacecraft is on the ${m.boxes.iaxis ? 'i' : 'j'} axis only, over the equator.`;
        else reading = 'More than one part is not zero, so the spacecraft is between the axes: on no axis, and over neither pole.';

        let picture = '';
        if (!m.equatorial) {
            if (m.u === 0 || m.u === 180) picture = `$u = ${m.u}°$ puts the spacecraft on the line of nodes, which points along $\\Omega$. That is the i axis when $\\Omega = 0°$ or $180°$, and the j axis when $\\Omega = 90°$ or $270°$.`;
            else if (m.u === 90 || m.u === 270) picture = `$u = ${m.u}°$ is the ${m.u === 90 ? 'northernmost' : 'southernmost'} point of the orbit, $${deg(m.i)}°$ from the equator. It is over a pole, on the k axis, only when $i = 90°$.`;
            else picture = 'Quick check: with $u$ not $0°$, $90°$, $180°$, or $270°$, the spacecraft cannot be on an axis or over a pole.';
        } else {
            picture = 'In the equator, the spacecraft is on the i axis at $0°$ or $180°$ and on the j axis at $90°$ or $270°$. It can never be over a pole.';
        }

        return {
            key: 'direction',
            title: prose('Direction to the spacecraft, $\\hat{r}$'),
            result: math(`\\hat{r} = ${rCol}`),
            caption: '',
            methods: [{
                name: 'Unit vector',
                html: work + rule(reading, boxLines(m, ['north', 'south', 'iaxis', 'jaxis', 'kaxis'])) + note(picture)
                    + note('"Only" means the other two parts are zero. A spacecraft over a pole is also on the k axis only.')
            }]
        };
    }

    function nodesStep(m) {
        let text;
        if (m.equatorial) text = 'An equatorial orbit never crosses the equator: it has no nodes.';
        else if (m.u === 0) text = '$u = 0°$: the spacecraft is crossing the equator heading north, at the ascending node.';
        else if (m.u === 180) text = '$u = 180°$: the spacecraft is crossing the equator heading south, at the descending node.';
        else text = `$u = ${deg(m.u)}°$ is not $0°$ or $180°$: the spacecraft is ${m.u < 180 ? 'north' : 'south'} of the equator, not at a node.`;
        return {
            key: 'nodes',
            title: prose('Nodes from $u$'),
            result: prose(m.boxes.an ? 'Ascending node' : m.boxes.dn ? 'Descending node' : 'No node'),
            caption: '',
            methods: [{ name: 'Nodes', html: rule(text, boxLines(m, ['an', 'dn'])) }]
        };
    }

    function apsidesStep(m) {
        let text;
        if (m.circular) text = 'A circular orbit has no perigee or apogee: every point is the same distance from Earth.';
        else if (m.nu === 0) text = '$\\nu = 0°$: the spacecraft is at perigee, its closest point to Earth.';
        else if (m.nu === 180) text = '$\\nu = 180°$: the spacecraft is at apogee, its farthest point from Earth.';
        else text = `$\\nu = ${deg(m.nu)}°$ is not $0°$ or $180°$: the spacecraft is ${m.nu < 180 ? 'moving out from perigee toward apogee' : 'falling back from apogee toward perigee'}.`;
        return {
            key: 'apsides',
            title: prose('Perigee and apogee from $\\nu$'),
            result: prose(m.boxes.perigee ? 'Perigee' : m.boxes.apogee ? 'Apogee' : 'Neither'),
            caption: '',
            methods: [{ name: 'Apsides', html: rule(text, boxLines(m, ['perigee', 'apogee'])) }]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Problem                                                            */
    /* ------------------------------------------------------------------ */
    function generate() {
        const m = model(pickKind());
        const answers = {};
        const fields = BOXES.map((b) => {
            answers[b.key] = { value: m.boxes[b.key] ? 1 : 0, text: m.boxes[b.key] ? 'Checked' : 'Not checked' };
            return { key: b.key, tex: '', name: b.name, unit: '', tolerance: null, unitType: 'check' };
        });
        return {
            type: m.kind,
            model: m,
            title: 'COE Box Problem',
            prompt: prose('Given the COEs, check <b>all</b> boxes that accurately describe the orbit or the spacecraft’s position in the orbit.'),
            statement: statement(m),
            overviewCaption: '',
            limitsHtml: prose('Each box is graded on its own: checked when it fits, empty when it does not. An undefined element is replaced by $u$ (circular), $\\Pi$ (elliptical equatorial), or $\\ell$ (circular equatorial), measured as in the Orbital Elements lesson.'),
            fields,
            answers,
            steps: [shapeStep(m), tiltStep(m), whereStep(m), directionStep(m), nodesStep(m), apsidesStep(m)]
        };
    }

    // A checkbox answer: '1' when checked
    function grade(field, typed, truth) {
        return (typed === '1' ? 1 : 0) === truth ? 'right' : 'wrong';
    }

    // The boxes for a given orbit, for checking: { circular, equatorial, i, raan, u, nu, L }
    function evaluate(given) {
        const m = { ...given };
        m.rhat = direction(m);
        return boxesFor(m);
    }

    global.Test1CoeBoxProblems = { boxes: BOXES, generate, grade, evaluate, R_EARTH };
})(window);
