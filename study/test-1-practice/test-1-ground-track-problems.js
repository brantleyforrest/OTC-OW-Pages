// Ground track problems for the Test 1 Practice page. The view draws the ground track of one
// standard orbit on a world map, and the student reads it with the Ground Tracks lesson's
// checklist: the period from the westward shift between consecutive ascending nodes, then the
// semi-major axis from Kepler's third law, whether the eccentricity is zero (from whether the
// descending node sits halfway between the ascending nodes, so the satellite spends equal time
// north and south), the inclination from the latitude peaks, the argument of perigee from the
// hemisphere where the satellite spends longer (apogee), and the
// true anomaly from where the satellite is marked.
// Every track comes from a bank of standard orbits, so that each one can be read from the map.
// The track uses the course model: two-body motion with a fixed orbital plane, a spherical
// Earth, and Earth turning 15° per hour. The map shows one period, from one ascending node to
// the next. The satellite is marked at an ascending node, a descending node, or a latitude peak,
// where its argument of latitude can be read (a geostationary track is a single point).
// Load as a classic script, after test-1-rendezvous-problems.js (for its time parser).
(function (global) {
    'use strict';

    const Check = global.AnswerCheck;
    const Rendezvous = global.Test1RendezvousProblems;
    const { math, prose, calc, note, rule } = global.PracticeMath;

    // Ground-track math is course math: test-1-practice-math.js, section groundTrack.
    const GT = global.TestReviewMath.groundTrack;
    const { MU, R_EARTH, EARTH_DEG_PER_HOUR, eccentricityFor, solveKepler, meanFromTrue, trackPoint, timeAtU } = GT;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const TWO_PI = 2 * Math.PI;
    const MU_TEX = global.TestReviewMath.course.MU_TEX;

    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const wrap360 = (deg) => ((deg % 360) + 360) % 360;
    const wrap180 = (deg) => wrap360(deg + 180) - 180;

    /* ------------------------------------------------------------------ */
    /* Bank of Standard Orbits                                            */
    /* ------------------------------------------------------------------ */
    // Every angle on the map falls on its 15° grid, so the map needs no degree labels: the
    // nodes sit on 15° longitude lines and the peaks on 15° latitude lines.
    // shifts: the westward shift between consecutive ascending nodes, in degrees, which sets
    // the period at 15° per hour. It is a multiple of 15°, so a low orbit takes 2 hours (30°),
    // the lesson's own example. Each inclination is the standard orbit's, rounded to the
    // nearest 15°. No track reaches higher than 75°, so none runs off the top or bottom of the
    // map. argp lists the arguments of perigee offered, with the standard 270° (apogee north)
    // offered twice as often as 90°.
    const BANK = [
        { id: 'leo45', name: 'a mid-inclination LEO orbit', family: 'circular', i: 45, shifts: [30] },
        { id: 'leo30', name: 'a low-inclination LEO orbit', family: 'circular', i: 30, shifts: [30] },
        { id: 'retro', name: 'a retrograde LEO orbit, tilted past 90° like a sun-synchronous orbit', family: 'circular', i: 105, shifts: [30] },
        { id: 'gps', name: 'a semi-synchronous MEO orbit, like a GPS satellite’s', family: 'circular', i: 60, shifts: [180] },
        { id: 'igso', name: 'an inclined geosynchronous orbit', family: 'circular', i: [15, 30, 45], shifts: [360] },
        { id: 'geo', name: 'a geostationary orbit', family: 'circular', i: 0, shifts: [360] },
        // apsisHours: the time from perigee to the ascending node. Earth turns 15° per hour, so
        // a whole number of hours puts perigee, apogee, both peaks, and the descending node on
        // 15° longitude lines. The eccentricity is solved from it (see eccentricityFor):
        // about 0.55 for Molniya (1 h) and 0.27 for Tundra (4 h).
        { id: 'molniya', name: 'a Molniya orbit', family: 'elliptical', apsisHours: 1, i: 60, argp: [270, 270, 90], shifts: [180] },
        { id: 'tundra', name: 'a Tundra orbit', family: 'elliptical', apsisHours: 4, i: 60, argp: [270, 270, 90], shifts: [360] }
    ];


    /* ------------------------------------------------------------------ */
    /* Orbit Motion                                                       */
    /* ------------------------------------------------------------------ */




    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    const group = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const deg = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
    function lonText(lon) {
        const w = wrap180(lon);
        if (Math.abs(w) < 1e-9) return '0°';
        if (Math.abs(Math.abs(w) - 180) < 1e-9) return '180°';
        return `${deg(Math.abs(w))}°${w < 0 ? 'W' : 'E'}`;
    }
    const signed = (lon) => {
        const w = wrap180(lon);
        return w < 0 ? `(-${deg(-w)}°)` : `${deg(w)}°`;
    };
    const hoursText = (h) => {
        if (h < 2) return `${group(h, 4).replace(/0+$/, '').replace(/\.$/, '')} h (${group(h * 60)} min)`;
        return `${group(h)} h`;
    };
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;

    const FEATURES = {
        0: 'the ascending node, crossing the equator heading north',
        90: 'the northern peak, the highest latitude of the track',
        180: 'the descending node, crossing the equator heading south',
        270: 'the southern peak, the lowest latitude of the track'
    };

    /* ------------------------------------------------------------------ */
    /* Grading                                                            */
    /* ------------------------------------------------------------------ */
    // The period: a bare number is in hours. With a unit (s, min, h) or as h:mm:ss, it uses the
    // rendezvous time parser. Eccentricity: zero or nonzero. An angle that is undefined for a
    // circular orbit takes "undefined", "none", or "n/a".
    const UNDEFINED = /^(undefined|undef|not defined|none|n\/?a|na|-+|—|no perigee|dne)$/;
    const ZERO = /^(0+(\.0*)?|zero|e\s*=\s*0|circular|circle)$/;
    const NONZERO = /^(non-?\s*zero|not zero|>\s*0|e\s*>\s*0|e\s*(!=|≠)\s*0|(!=|≠)\s*0|positive|elliptical|elliptic|ellipse|eccentric|yes)$/;
    const ANGLE_UNITS = /\s*(degrees|degree|deg|°)$/;

    function grade(tolerance, text, truth, unitType) {
        const typed = String(text).trim().toLowerCase();
        if (!typed) return 'blank';
        if (unitType === 'zero_nonzero') {
            if (NONZERO.test(typed)) return truth === 1 ? 'right' : 'wrong';
            if (ZERO.test(typed)) return truth === 0 ? 'right' : 'wrong';
            const value = Check.parseAnswer(typed);
            if (value === null) return 'invalid';
            return (value === 0 ? 0 : 1) === truth ? 'right' : 'wrong';
        }
        if (unitType === 'period') {
            const value = /[a-z:]/.test(typed) ? Rendezvous.parseSeconds(typed) : (Check.parseAnswer(typed) ?? NaN) * 3600;
            if (value === null || !Number.isFinite(value)) return 'invalid';
            return Check.isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
        }
        if (unitType === 'angle_or_undefined') {
            if (UNDEFINED.test(typed)) return truth === null ? 'right' : 'wrong';
            const value = Check.parseAnswer(typed.replace(ANGLE_UNITS, ''));
            if (value === null) return 'invalid';
            if (truth === null) return 'wrong';
            return Check.isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
        }
        return Check.grade(tolerance, typed, truth);
    }

    /* ------------------------------------------------------------------ */
    /* Problem                                                            */
    /* ------------------------------------------------------------------ */
    function build(entry) {
        const shift = pick(entry.shifts);
        const periodH = shift / EARTH_DEG_PER_HOUR;
        const P = periodH * 3600;
        const n = TWO_PI / P;
        const a = Math.cbrt(MU * (P / TWO_PI) ** 2);
        const elliptical = entry.family === 'elliptical';
        const e = elliptical ? eccentricityFor(entry.apsisHours, P) : 0;
        const i = Array.isArray(entry.i) ? pick(entry.i) : entry.i;
        const argp = elliptical ? pick(entry.argp) : 0;
        const retrograde = i > 90;
        const equatorial = i === 0;   // Geostationary: the track is one point, with no nodes
        const peak = retrograde ? 180 - i : i;
        const lambda1 = 15 * Math.floor(Math.random() * 24) - 180;
        const lambda2 = wrap180(lambda1 - shift);

        const model = {
            id: entry.id,
            name: entry.name,
            a, e, i, argp, n, period: P, shift, lambda1, lambda2, peak, retrograde, elliptical, equatorial,
            M0: meanFromTrue(-argp, e)
        };

        // Where the satellite is marked: one of the four features, during the one period drawn,
        // from ascending node 1 to node 2. Only a feature reached a whole number of hours after
        // the node lies on a 15° longitude line. A 2-hour orbit reaches its peaks at the half
        // hour, so its satellite is marked only at a node.
        const onGrid = (u) => {
            const hours = (u === 0 ? P : timeAtU(model, u, 0)) / 3600;
            return Math.abs(hours - Math.round(hours)) < 1e-6;
        };
        const satU = equatorial ? null : pick([0, 90, 180, 270].filter(onGrid));
        model.satU = satU;
        model.tSat = equatorial ? 0 : satU === 0 ? P : timeAtU(model, satU, 0);
        model.nu = elliptical ? wrap360(satU - argp) : null;
        model.tNorth = timeAtU(model, 90, 0);
        model.tSouth = timeAtU(model, 270, 0);
        model.tDescending = timeAtU(model, 180, 0);
        // The node-halves test for e: the hours spent north and south of the equator, the
        // descending node that makes them, and where a circular orbit would put it
        model.tNorthH = Math.round(model.tDescending / 3600 * 1e6) / 1e6;
        model.tSouthH = periodH - model.tNorthH;
        model.lambdaD = wrap180(lambda1 + 180 - EARTH_DEG_PER_HOUR * model.tNorthH);
        model.lambdaDCircular = wrap180(lambda1 + 180 - shift / 2);
        if (elliptical) {
            model.tPerigeeAfterNode = timeAtU(model, argp, 0);
            model.tApogeeAfterNode = timeAtU(model, wrap360(argp + 180), 0);
        }
        model.tStart = 0;
        model.tEnd = P;

        /* Answers ---------------------------------------------------------- */
        const answers = {
            p: { value: P, text: hoursText(periodH) },
            a: { value: a, text: `${group(a)} km` },
            e: { value: elliptical ? 1 : 0, text: elliptical ? 'Nonzero' : 'Zero' },
            i: { value: i, text: `${i}°` },
            argp: { value: elliptical ? argp : null, text: elliptical ? `${argp}°` : 'Undefined' },
            nu: { value: model.nu, text: elliptical ? `${model.nu}°` : 'Undefined' }
        };

        const fields = [
            { key: 'p', tex: 'P', name: 'Period', unit: 'h', tolerance: { relative: 0.02 }, unitType: 'period' },
            { key: 'a', tex: 'a', name: 'Semi-major axis', unit: 'km', tolerance: { relative: 0.01 }, unitType: 'number' },
            { key: 'e', tex: 'e', name: 'Eccentricity', unit: '', placeholder: 'zero or nonzero', tolerance: { absolute: 0 }, unitType: 'zero_nonzero', textOk: true },
            { key: 'i', tex: 'i', name: 'Inclination', unit: '°', tolerance: { absolute: 7.5 }, unitType: 'number' },
            { key: 'argp', tex: '\\omega', name: 'Argument of perigee', unit: '°', placeholder: 'or n/a', tolerance: { absolute: 1, wrap: 360 }, unitType: 'angle_or_undefined', textOk: true },
            { key: 'nu', tex: '\\nu', name: 'True anomaly now', unit: '°', placeholder: 'or n/a', tolerance: { absolute: 1, wrap: 360 }, unitType: 'angle_or_undefined', textOk: true }
        ];

        /* Steps ------------------------------------------------------------ */
        // Step 1: the westward shift between the two labeled ascending nodes, then the period.
        let shiftWork;
        if (equatorial) {
            shiftWork = rule(`The track is a single point on the equator at ${lonText(lambda1)}. The satellite keeps pace with Earth's turn, so one orbit takes exactly one turn of Earth.`, `$\\Delta N = 360°$`);
        } else if (shift === 360) {
            shiftWork = rule(`Both ascending nodes are at ${lonText(lambda1)}: the track closes on itself after one orbit. Earth turned one full revolution under the orbit.`, `$\\Delta N = 360°$`);
        } else {
            const raw = wrap180(lambda1) - wrap180(lambda2);
            const wraps = raw < 0;
            shiftWork = calc('\\Delta N = \\lambda_1 - \\lambda_2', [
                `${signed(lambda1)} - ${signed(lambda2)}${wraps ? ' + 360°' : ''}`
            ], `${deg(shift)}°`)
                + note(`East longitudes are positive and west longitudes negative. Node 2 is ${deg(shift)}° west of node 1${wraps ? ', across the 180° line, so add $360°$' : ''}.`);
        }
        const periodStep = {
            key: 'period',
            title: prose('Period from the node shift, $P$'),
            result: math(`P = ${deg(Math.round(periodH * 1e4) / 1e4)}\\text{ h}`),
            caption: equatorial
                ? prose('<b>Period.</b> The satellite stays over one point, so it circles Earth once each time Earth turns once: $360° / 15°$ per hour $= 24$ hours.')
                : prose(`<b>Period.</b> Between two matching passes Earth turns ${deg(shift)}° east under the orbit, so the next ascending node lands ${deg(shift)}° farther west. At $15°$ per hour, that is $${deg(Math.round(periodH * 1e4) / 1e4)}$ hours.`),
            methods: [{
                name: 'Node shift',
                html: shiftWork
                    + calc('P = \\dfrac{\\Delta N}{15°/\\text{h}}', [`\\dfrac{${deg(shift)}°}{15°/\\text{h}}`], `${deg(Math.round(periodH * 1e4) / 1e4)}\\text{ h} = ${group(P)}\\text{ s}`)
                    + note(equatorial
                        ? 'A fixed point on the equator is the signature of a geostationary orbit: one sidereal day, about 23 h 56 min, which the course rounds to 24 h.'
                        : 'Compare the same feature on consecutive orbits: ascending node to ascending node. Never an ascending node with a descending node.')
            }]
        };

        const smaStep = {
            key: 'sma',
            title: prose('Semi-major axis, $a$'),
            result: math(`a = ${group(a)}\\text{ km}`),
            caption: prose(`<b>Size.</b> Kepler's third law turns the period into the semi-major axis: $a = ${group(a)}\\text{ km}$.`),
            methods: [{
                name: 'Kepler III',
                html: calc('a = \\left[\\mu\\left(\\dfrac{P}{2\\pi}\\right)^2\\right]^{1/3}', [
                    `\\left[${MU_TEX}\\left(\\dfrac{${group(P)}}{2\\pi}\\right)^2\\right]^{1/3}`
                ], `${group(a)}\\text{ km}`)
                    + note('Use the period in seconds, so that $a$ comes out in kilometers.')
                    + (elliptical ? '' : note(`For a circular orbit this is also the radius: altitude $h = a - R_\\oplus \\approx ${group(a - R_EARTH)}\\text{ km}$.`))
            }]
        };

        let incWork;
        if (equatorial) {
            incWork = rule('The track never leaves the equator, so the orbit is not tilted at all.', '$i = 0°$');
        } else if (retrograde) {
            incWork = rule(`The track's highest and lowest points sit on the ${peak}°N and ${peak}°S grid lines. The arrows show it crossing the equator heading west of north, against Earth's turn: the orbit is retrograde.`, `$i = 180° - ${peak}° = ${i}°$`);
        } else {
            incWork = rule(`The track's highest and lowest points sit on the ${peak}°N and ${peak}°S grid lines. The arrows show it crossing the ascending node heading east of north, with Earth's turn: the orbit is prograde.`, `$i = ${i}°$`);
        }
        const incStep = {
            key: 'inc',
            title: prose('Inclination from the latitude peaks, $i$'),
            result: math(`i = ${i}°`),
            caption: equatorial
                ? prose('<b>Inclination.</b> The track stays on the equator: $i = 0°$.')
                : prose(`<b>Inclination.</b> The highest and lowest latitudes of the track are $\\pm ${peak}°$.${retrograde ? ' The orbit is retrograde, so $i = 180°$ minus the peak.' : ''}`),
            methods: [{
                name: 'Peaks',
                html: incWork
                    + note('Read the peak to the nearest $15°$ grid line. A prograde track peaks at $\\pm i$. A retrograde track peaks at $\\pm(180° - i)$, so check the direction of travel too.')
            }]
        };

        const apogeeNorth = argp === 270;
        const { tNorthH, tSouthH, lambdaD, lambdaDCircular } = model;
        const halfShift = shift / 2;
        const atNode1 = Math.abs(wrap180(lambdaDCircular - lambda1)) < 1e-9;
        const circularDN = `${lonText(lambdaDCircular)}${atNode1 ? ', the same point as node 1, so the track would cross itself there in a figure-8' : ''}`;
        const eccWork = equatorial
            ? rule('The track is one fixed point. An eccentric orbit would speed up and slow down, so the point would swing east and west during the day. It does not, so the speed is constant: a circle.', '$e = 0$')
            : rule(`Each half of the orbit, from one node to the other, is $180°$ of the orbit. At constant speed each half takes $P/2 = ${deg(periodH / 2)}\\text{ h}$, and Earth turns $\\Delta N/2 = ${deg(halfShift)}°$ under it. So a circular orbit puts the descending node $180°$ from node 1, then ${deg(halfShift)}° west: ${circularDN}.`)
                + (elliptical
                    ? rule(`The track's descending node is at ${lonText(lambdaD)}, not ${lonText(lambdaDCircular)}. Earth turned ${deg(15 * tNorthH)}° under the northern half and ${deg(15 * tSouthH)}° under the southern, so the satellite spent ${deg(tNorthH)} h north of the equator and ${deg(tSouthH)} h south. The halves take different times, so the speed changes around the orbit: an ellipse.`, '$e > 0$')
                    : rule(`The track's descending node is at ${lonText(lambdaD)}, right where a circular orbit puts it. The northern and southern halves are the same width and are mirror images of each other.`, '$e = 0$'));
        const eccStep = {
            key: 'ecc',
            title: prose('Eccentricity: zero or nonzero, $e$'),
            result: elliptical ? math('e > 0') : math('e = 0'),
            caption: elliptical
                ? prose(`<b>Shape.</b> The descending node is off-center, so the two halves of the track are lopsided: ${deg(tNorthH)} h north of the equator and ${deg(tSouthH)} h south. The satellite is slow near apogee and fast near perigee. The orbit is elliptical.`)
                : equatorial
                    ? prose('<b>Shape.</b> The track does not drift east or west at all: the satellite keeps exact pace with Earth all day, so its speed never changes. The orbit is circular.')
                    : prose('<b>Shape.</b> The descending node is exactly halfway, so the satellite spends half its period north of the equator and half south. The two halves of the track are mirror images. The orbit is circular.'),
            methods: [{
                name: 'Node halves',
                html: eccWork
                    + (equatorial ? '' : note('The quick check: is the descending node centered, and are the northern and southern halves mirror images? An eccentric track is lopsided, with a wide, slow half around apogee and a narrow, fast half around perigee. This works whenever perigee is away from the nodes, as in Molniya and Tundra orbits ($\\omega = 90°$ or $270°$).'))
                    + note('The map can show that $e$ is not zero, but not its exact value.')
            }]
        };

        const argpStep = {
            key: 'argp',
            title: prose('Argument of perigee, $\\omega$'),
            result: elliptical ? math(`\\omega = ${argp}°`) : 'Undefined',
            caption: elliptical
                ? prose(`<b>Perigee.</b> Apogee is at the ${apogeeNorth ? 'northern' : 'southern'} peak, so perigee is at the ${apogeeNorth ? 'southern' : 'northern'} peak, $\\omega = ${argp}°$ past the ascending node.`)
                : prose('<b>No perigee.</b> A circular orbit has no closest point, so $\\omega$ is undefined.'),
            methods: [{
                name: 'Hemisphere',
                html: elliptical
                    ? rule(`The satellite spends longer in the ${apogeeNorth ? 'north' : 'south'} (${deg(apogeeNorth ? tNorthH : tSouthH)} h against ${deg(apogeeNorth ? tSouthH : tNorthH)} h), so it is slowest there: apogee is at the ${apogeeNorth ? 'northern' : 'southern'} peak and perigee at the ${apogeeNorth ? 'southern' : 'northern'} peak. From the ascending node, the satellite reaches the northern peak at $u = 90°$ and the southern peak at $u = 270°$.`, `$\\omega = ${argp}°$`)
                        + note('$\\omega \\approx 270°$ puts apogee north (the standard Molniya and Tundra design). $\\omega \\approx 90°$ puts apogee south.')
                    : rule('With $e = 0$ every point is the same distance from Earth. There is no perigee to measure to.', '$\\omega$ is undefined')
            }]
        };

        const nuLines = elliptical
            ? calc('\\nu = u - \\omega', [`${satU}° - ${argp}°${satU - argp < 0 ? ' + 360°' : ''}`], `${model.nu}°`)
            : '';
        const nuStep = {
            key: 'nu',
            title: prose('True anomaly now, $\\nu$'),
            result: elliptical ? math(`\\nu = ${model.nu}°`) : 'Undefined',
            caption: equatorial
                ? prose('<b>Where the satellite is.</b> On the one point of the track. A circular, equatorial orbit has no perigee and no ascending node, so neither $\\nu$ nor $u$ is defined.')
                : elliptical
                    ? prose(`<b>Where the satellite is.</b> It is at ${FEATURES[satU]}, $u = ${satU}°$ past the ascending node (the purple arc) and $\\nu = ${model.nu}°$ past perigee.`)
                    : prose(`<b>Where the satellite is.</b> It is at ${FEATURES[satU]}, $u = ${satU}°$ past the ascending node (the purple arc). With no perigee, $\\nu$ is undefined.`),
            methods: [{
                name: 'From the node',
                html: (equatorial
                    ? rule('With $e = 0$ there is no perigee, and with $i = 0°$ there is no ascending node either. There is nothing to measure $\\nu$ or $u$ from.', '$\\nu$ is undefined')
                        + note('For a geostationary satellite, its position is given by its longitude instead.')
                    : rule(`The satellite is at ${FEATURES[satU]}, so its argument of latitude is $u = ${satU}°$.`)
                        + (elliptical
                            ? nuLines + note(`$\\nu$ is measured from perigee, and $u = \\omega + \\nu$. ${model.nu === 0 ? 'The satellite is at perigee.' : model.nu === 180 ? 'The satellite is at apogee.' : ''}`)
                            : rule('A circular orbit has no perigee to measure from, so $\\nu$ is undefined. Use $u$ instead.', '$\\nu$ is undefined')))
                    + note(`This track is ${entry.name}.`)
            }]
        };

        return {
            type: entry.family,
            model,
            title: 'Ground Track',
            prompt: prose('The view shows one period of a satellite’s ground track, with its direction of travel and where the satellite is now. Read the node longitudes and peak latitudes from the map’s grid, then find the period, semi-major axis, whether the eccentricity is zero, the inclination, argument of perigee, and true anomaly.'),
            statement: item('\\omega_\\oplus \\approx 15°/\\text{h}')
                + item('\\text{Grid: every } 15°'),
            overviewCaption: equatorial
                ? prose('<b>The ground track as given.</b> One full period, drawn over a whole day. The satellite is at the single point of the track.')
                : prose(`<b>The ground track as given.</b> One period: the track starts at an ascending node and ends at the next one. Arrows show the direction of travel. The nodes and peaks all fall on 15° grid lines.`),
            limitsHtml: prose(`Accepted: $P$ within 2% (a bare number is hours; or type s, min, or h), $a$ within 1%, $e$ as zero or nonzero, $i$ within 7.5° (read the peaks to the nearest 15° line), $\\omega$ and $\\nu$ within 1°. Type <i>undefined</i> or <i>n/a</i> for an angle the orbit does not have. The solutions use Earth turning $15°$/h, $\\mu = ${MU_TEX}\\text{ km}^3/\\text{s}^2$, and $R_\\oplus = 6{,}378\\text{ km}$.`),
            fields,
            answers,
            steps: [periodStep, smaStep, incStep, eccStep, argpStep, nuStep]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    const TYPES = ['circular', 'elliptical'];

    function generate(type) {
        const family = TYPES.includes(type) ? type : pick(TYPES);
        return build(pick(BANK.filter((entry) => entry.family === family)));
    }

    global.Test1GroundTrackProblems = {
        constants: { MU, R_EARTH, EARTH_DEG_PER_HOUR },
        types: TYPES,
        bank: BANK,
        generate,
        grade,
        trackPoint,
        build
    };
})(typeof window !== 'undefined' ? window : globalThis);
