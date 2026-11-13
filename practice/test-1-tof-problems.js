// Time of flight problems for the Test 1 Practice page, solved with D = RT on a circular orbit:
// Distance is the angle swept along the orbit, Rate is the mean motion n, and Time is the flight
// time. One kind finds the time to sweep from u_0 to u_1 (T = D / n). The other finds where the
// satellite is after a given time (D = n T, then u_1 = u_0 + D). The worked steps follow the
// Time of Flight & Orbit Prediction lesson, with its constants, mu = 398,600.44 km^3/s^2 and
// R_earth = 6,378 km, and its order: mean motion, angular distance, then time or position.
// Load as a classic script, after test-1-rendezvous-problems.js (for its time parser).
(function (global) {
    'use strict';

    const Check = global.AnswerCheck;
    const Rendezvous = global.Test1RendezvousProblems;
    const { math, prose, calc, note } = global.PracticeMath;

    const MU = 398600.44;
    const R_EARTH = 6378;
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const MU_TEX = '398{,}600.44';

    // The orbit: a semi-major axis from low Earth orbit out to the middle of MEO, picked evenly
    // in its logarithm so that low orbits come up as often as high ones. Sometimes the orbit is
    // given by its altitude instead, which adds the step a = R_earth + h.
    const RADIUS = [6700, 27000];
    const GIVEN_AS_ALTITUDE = 0.4;
    // Every given angle is a multiple of this many degrees
    const ANGLE_STEP = 5;
    // Find position: the flight time, as a share of one period. Past one period, the satellite
    // laps the orbit, and the answer is wrapped back to 0°–360°.
    const TIME_SHARE = [0.1, 1.8];
    const GIVEN_IN_MINUTES = 0.5;

    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const logBetween = ([low, high]) => Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * Math.random());
    const snap = (x, step) => Math.round(x / step) * step;
    const angleBetween = (low, high) => low + ANGLE_STEP * Math.floor(Math.random() * ((high - low) / ANGLE_STEP + 1));
    const wrap360 = (deg) => ((deg % 360) + 360) % 360;

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    // PracticeMath turns a thousands comma into {,} and ° into ^\circ, so these work in TeX too.
    const group = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const sci = (x, d = 4) => {
        const [mant, exp] = Number(x).toExponential(d).split('e');
        return `${mant} \\times 10^{${Number(exp)}}`;
    };
    const sciText = (x, d = 4) => {
        const [mant, exp] = Number(x).toExponential(d).split('e');
        return `${mant} × 10^${Number(exp)}`;
    };
    const minutes = (s) => (s / 60).toFixed(2);
    const timeText = (s) => `${group(s, 1)} s (${minutes(s)} min)`;
    const timeTex = (s) => `${group(s, 1)}\\text{ s} \\;(${minutes(s)}\\text{ min})`;
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;

    /* ------------------------------------------------------------------ */
    /* Grading                                                            */
    /* ------------------------------------------------------------------ */
    // Times use the rendezvous time parser: seconds, minutes, hours, or h:mm:ss. A rate is
    // graded in rad/s, and may be typed in °/s or deg/s instead. An angle is graded in the
    // field's unit (rad or °), and may be typed in the other unit.
    function splitUnit(text, units) {
        const s = String(text).trim().toLowerCase().replace(/\s+$/, '');
        for (const unit of units) {
            if (s.endsWith(unit)) return { number: s.slice(0, -unit.length), unit };
        }
        return { number: s, unit: '' };
    }

    function readNumber(text) {
        return Check.parseAnswer(text);
    }

    const RATE_UNITS = ['rad/s', 'rad/sec', '°/s', '°/sec', 'deg/s', 'deg/sec', 'degrees/s'];
    const ANGLE_UNITS = ['radians', 'radian', 'rad', 'degrees', 'degree', 'deg', '°'];

    function grade(tolerance, text, truth, unitType) {
        if (!String(text).trim()) return 'blank';
        let value;
        if (unitType === 'time_s') {
            value = Rendezvous.parseSeconds(text);
        } else if (unitType === 'rate') {
            const { number, unit } = splitUnit(text, RATE_UNITS);
            value = readNumber(number);
            if (value !== null && unit && !unit.startsWith('rad')) value *= D2R;
        } else {
            // 'angle_deg' or 'angle_rad'
            const { number, unit } = splitUnit(text, ANGLE_UNITS);
            value = readNumber(number);
            const typedRad = unit.startsWith('rad');
            const typedDeg = unit && !typedRad;
            if (value !== null && unitType === 'angle_deg' && typedRad) value *= R2D;
            if (value !== null && unitType === 'angle_rad' && typedDeg) value *= D2R;
        }
        if (value === null || value === undefined) return 'invalid';
        return Check.isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
    }

    const MU_NOTE = 'The solutions use $\\mu = 398{,}600.44\\text{ km}^3/\\text{s}^2$ and $R_\\oplus = 6{,}378\\text{ km}$.';

    /* ------------------------------------------------------------------ */
    /* Shared Steps                                                       */
    /* ------------------------------------------------------------------ */
    // The orbit, given by its semi-major axis or by its altitude
    function orbit() {
        const asAltitude = Math.random() < GIVEN_AS_ALTITUDE;
        let a = snap(logBetween(RADIUS), 100);
        let h = a - R_EARTH;
        if (asAltitude) {
            h = Math.max(300, snap(h, 50));
            a = R_EARTH + h;
        }
        const n = Math.sqrt(MU / (a * a * a));
        return { a, h, asAltitude, n, period: 2 * Math.PI / n };
    }

    function orbitGiven(o) {
        return o.asAltitude ? item(`h = ${group(o.h)}\\text{ km}`) : item(`a = ${group(o.a)}\\text{ km}`);
    }

    function rateStep(o) {
        const sizeWork = o.asAltitude
            ? calc('a = R_\\oplus + h', [`${group(R_EARTH)} + ${group(o.h)}`], `${group(o.a)}\\text{ km}`)
            : '';
        return {
            key: 'rate',
            title: prose('Rate: mean motion, $n$'),
            result: math(`n = ${sci(o.n)}\\text{ rad/s}`),
            caption: prose('<b>Rate.</b> On a circular orbit the satellite moves at the same angular rate everywhere: the mean motion $n$. One lap takes one period.'),
            methods: [{
                name: 'Formula',
                html: sizeWork
                    + calc('n = \\sqrt{\\dfrac{\\mu}{a^3}}', [
                        `\\sqrt{\\dfrac{${MU_TEX}}{(${group(o.a)})^3}}`
                    ], `${sci(o.n)}\\text{ rad/s}`)
                    + note(`For reference, one period is $2\\pi / n = ${group(o.period, 1)}\\text{ s}$ (${minutes(o.period)} min).`)
                    + note('Keep the rate in rad/s, so that the angle in D = RT is in radians.')
            }]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Find the Time (T = D / R)                                          */
    /* ------------------------------------------------------------------ */
    function timeProblem() {
        const o = orbit();
        const u0 = angleBetween(0, 355);
        const sweep = angleBetween(10, 350);
        const u1 = wrap360(u0 + sweep);
        const passesNode = u1 < u0;
        const Drad = sweep * D2R;
        const T = Drad / o.n;

        const answers = {
            n: { value: o.n, text: `${sciText(o.n)} rad/s` },
            d: { value: Drad, text: `${Drad.toFixed(4)} rad (${sweep}°)` },
            t: { value: T, text: timeText(T) }
        };

        const fields = [
            { key: 'n', tex: 'n', name: 'Rate, mean motion', unit: 'rad/s', tolerance: { relative: 0.005 }, unitType: 'rate' },
            { key: 'd', tex: 'D', name: 'Distance, angle swept', unit: 'rad', tolerance: { relative: 0.005 }, unitType: 'angle_rad' },
            { key: 't', tex: 'T', name: 'Time of flight', unit: 's', tolerance: { relative: 0.005 }, unitType: 'time_s' }
        ];

        const distanceLines = passesNode
            ? [`${u1}° - ${u0}° + 360°`, `${sweep}°`]
            : [`${u1}° - ${u0}°`];

        const steps = [
            rateStep(o),
            {
                key: 'distance',
                title: prose('Distance: angle swept, $D$'),
                result: math(`D = ${Drad.toFixed(4)}\\text{ rad}`),
                caption: prose(`<b>Distance.</b> The satellite moves forward from $u_0$ to $u_1$, sweeping $D = ${sweep}°$${passesNode ? ', past the ascending node' : ''}.`),
                methods: [{
                    name: 'Formula',
                    html: calc('D = u_1 - u_0', distanceLines, `${sweep}°`)
                        + (passesNode ? note('$u_1$ is less than $u_0$, so the satellite passes $u = 0°$ on the way: add $360°$ to keep $D$ positive.') : '')
                        + calc('D = ' + `${sweep}° \\times \\dfrac{\\pi\\text{ rad}}{180°}`, [], `${Drad.toFixed(4)}\\text{ rad}`)
                }]
            },
            {
                key: 'time',
                title: prose('Time: $T = D / R$'),
                result: math(`T = ${group(T, 1)}\\text{ s}`),
                caption: prose('<b>Time of flight.</b> At the steady rate $n$, the satellite sweeps $D$ in $T = D / n$.'),
                methods: [{
                    name: 'Formula',
                    html: calc('T = \\dfrac{D}{R} = \\dfrac{D}{n}', [
                        `\\dfrac{${Drad.toFixed(4)}\\text{ rad}}{${sci(o.n)}\\text{ rad/s}}`
                    ], timeTex(T))
                        + note(`Check: $D$ is ${(sweep / 360 * 100).toFixed(0)}% of a lap, and $T$ is ${(T / o.period * 100).toFixed(0)}% of the period.`)
                }]
            }
        ];

        return {
            type: 'time',
            model: { a: o.a, n: o.n, period: o.period, u0, sweep, u1, T, find: 'time' },
            title: 'Time of Flight',
            prompt: prose('A satellite is on a circular orbit. Use $D = RT$ to find how long it takes to fly forward from $u_0$ to $u_1$: the rate (mean motion), the distance (angle swept, in radians), and the time.'),
            statement: orbitGiven(o) + item(`u_0 = ${u0}°`) + item(`u_1 = ${u1}°`),
            overviewCaption: prose(`<b>The problem as given.</b> The satellite is at $u_0 = ${u0}°$ and flies forward, in the direction of motion, to $u_1 = ${u1}°$. $u$ is measured from the ascending node.`),
            limitsHtml: prose(`Accepted: $n$ within 0.5% (rad/s or °/s), $D$ within 0.5% (rad or °), $T$ within 0.5% (seconds, minutes, hours, or h:mm:ss). ${MU_NOTE}`),
            fields,
            answers,
            steps
        };
    }

    /* ------------------------------------------------------------------ */
    /* Find the Position (D = R T)                                        */
    /* ------------------------------------------------------------------ */
    function positionProblem() {
        const o = orbit();
        const u0 = angleBetween(0, 355);
        const inMinutes = Math.random() < GIVEN_IN_MINUTES;
        const raw = o.period * (TIME_SHARE[0] + (TIME_SHARE[1] - TIME_SHARE[0]) * Math.random());
        const T = inMinutes ? Math.max(60, snap(raw, 60)) : Math.max(100, snap(raw, 100));
        const Drad = o.n * T;
        const Ddeg = Drad * R2D;
        const sum = u0 + Ddeg;
        const laps = Math.floor(sum / 360);
        const u1 = sum - 360 * laps;

        const answers = {
            n: { value: o.n, text: `${sciText(o.n)} rad/s` },
            d: { value: Ddeg, text: `${Ddeg.toFixed(2)}° (${Drad.toFixed(4)} rad)` },
            u1: { value: u1, text: `${u1.toFixed(2)}°` }
        };

        const fields = [
            { key: 'n', tex: 'n', name: 'Rate, mean motion', unit: 'rad/s', tolerance: { relative: 0.005 }, unitType: 'rate' },
            { key: 'd', tex: 'D', name: 'Distance, angle swept', unit: '°', tolerance: { relative: 0.005 }, unitType: 'angle_deg' },
            { key: 'u1', tex: 'u_1', name: 'Position after the flight', unit: '°', tolerance: { absolute: 0.5, wrap: 360 }, unitType: 'angle_deg' }
        ];

        const timeGiven = inMinutes ? `T = ${T / 60}\\text{ min}` : `T = ${group(T)}\\text{ s}`;
        const timeWork = inMinutes
            ? calc('T', [`${T / 60}\\text{ min} \\times 60\\text{ s/min}`], `${group(T)}\\text{ s}`)
            : '';
        const lapLines = laps === 0
            ? [`${u0}° + ${Ddeg.toFixed(2)}°`]
            : [`${u0}° + ${Ddeg.toFixed(2)}°`, `${sum.toFixed(2)}° - ${laps === 1 ? '' : laps}(360°)`];
        const lapNote = laps === 0
            ? 'Less than one lap: $u_1$ is already between $0°$ and $360°$.'
            : `The sum passes $360°$, so the satellite has crossed the ascending node ${laps === 1 ? 'once' : `${laps} times`}. Subtract ${laps === 1 ? '$360°$' : `$${laps}(360°)$`} to bring $u_1$ back between $0°$ and $360°$.`;

        const steps = [
            rateStep(o),
            {
                key: 'distance',
                title: prose('Distance: $D = R \\cdot T$'),
                result: math(`D = ${Ddeg.toFixed(2)}°`),
                caption: prose(`<b>Distance.</b> In $T = ${group(T)}\\text{ s}$, the satellite sweeps $D = n \\cdot T$ along its orbit${Ddeg > 360 ? ', more than one full lap' : ''}.`),
                methods: [{
                    name: 'Formula',
                    html: timeWork
                        + calc('D = R \\cdot T = n \\cdot T', [
                            `(${sci(o.n)}\\text{ rad/s})(${group(T)}\\text{ s})`
                        ], `${Drad.toFixed(4)}\\text{ rad}`)
                        + calc(`D = ${Drad.toFixed(4)}\\text{ rad} \\times \\dfrac{180°}{\\pi\\text{ rad}}`, [], `${Ddeg.toFixed(2)}°`)
                        + note('Convert to degrees as a separate, last step.')
                }]
            },
            {
                key: 'position',
                title: prose('Position: $u_1 = u_0 + D$'),
                result: math(`u_1 = ${u1.toFixed(2)}°`),
                caption: prose(`<b>Orbit prediction.</b> After $T$, the satellite is at $u_1 = ${u1.toFixed(2)}°$.`),
                methods: [{
                    name: 'Formula',
                    html: calc('u_1 = u_0 + D', lapLines, `${u1.toFixed(2)}°`)
                        + note(lapNote)
                }]
            }
        ];

        return {
            type: 'position',
            model: { a: o.a, n: o.n, period: o.period, u0, sweep: Ddeg, u1, T, find: 'position' },
            title: 'Orbit Prediction',
            prompt: prose('A satellite is on a circular orbit. Use $D = RT$ to find where it is after flying for time $T$: the rate (mean motion), the distance (angle swept, in degrees), and its new position $u_1$.'),
            statement: orbitGiven(o) + item(`u_0 = ${u0}°`) + item(timeGiven),
            overviewCaption: prose(`<b>The problem as given.</b> The satellite starts at $u_0 = ${u0}°$ and flies for ${inMinutes ? `${T / 60} minutes` : `${group(T)} seconds`}. $u$ is measured from the ascending node.`),
            limitsHtml: prose(`Accepted: $n$ within 0.5% (rad/s or °/s), $D$ within 0.5% (° or rad), $u_1$ within 0.5°. ${MU_NOTE}`),
            fields,
            answers,
            steps
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    const GENERATORS = { time: timeProblem, position: positionProblem };
    const TYPES = Object.keys(GENERATORS);

    function generate(type) {
        const chosen = GENERATORS[type] ? type : pick(TYPES);
        return GENERATORS[chosen]();
    }

    global.Test1TofProblems = {
        constants: { MU, R_EARTH },
        types: TYPES,
        generate,
        grade
    };
})(typeof window !== 'undefined' ? window : globalThis);
