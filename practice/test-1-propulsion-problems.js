// Propulsion problems for the Test 1 Practice page. Every problem is solved with only three
// equations, their algebraic rearrangements, and mass accounting (m_i = m_dry + m_p,
// m_p = m_i - m_f):
//   Ideal rocket equation    dV = Isp g_0 ln(m_i / m_f)
//   Spacecraft acceleration  a = F / m
//   Maneuver duration        dt = dV / a
// No other propulsion or orbital mechanics equation is needed. g_0 = 9.81 m/s^2, the course
// standard. As in the Spacecraft Propulsion lesson, a burn's duration is estimated with the
// acceleration at the start of the burn, a_0 = F / m_i.
//
// Each template is one kind of operation (stationkeeping, collision avoidance, disposal, ...)
// with a difficulty from 4/10 to 7.5/10, in three levels:
//   foundational  4-5      about two steps: two equations, or one rearranged and then used
//   intermediate  5.5-6.5  two or three steps, with intermediate unknowns or working backward
//   advanced      6.5-7.5  three or four steps, usually all three equations, with constraints
// Successive problems never repeat a template, and each draws its own spacecraft, engine,
// numbers, and units. These problems have no 3D view.
// Load as a classic script, after test-1-rendezvous-problems.js (for its time parser).
(function (global) {
    'use strict';

    const Check = global.AnswerCheck;
    const Rendezvous = global.Test1RendezvousProblems;
    const { math, prose, calc, note } = global.PracticeMath;

    const G0 = 9.81;
    const ISP = 'I_{\\text{sp}}';
    const ROCKET = `\\Delta V = ${ISP}\\, g_0 \\ln\\!\\left(\\dfrac{m_i}{m_f}\\right)`;

    /* ------------------------------------------------------------------ */
    /* Random Values                                                      */
    /* ------------------------------------------------------------------ */
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const chance = (p) => Math.random() < p;
    const between = (low, high) => low + (high - low) * Math.random();
    const logBetween = (low, high) => Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * Math.random());
    const snap = (x, step) => Number((Math.round(x / step) * step).toFixed(6));
    const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

    // Spacecraft, with the lesson's benchmark engines. prop is the propellant load as a share of
    // the dry mass.
    const VEHICLES = {
        leo: {
            names: ['a LEO Earth-imaging satellite', 'a LEO weather satellite', 'a small LEO reconnaissance satellite'],
            engine: 'engine', dry: [150, 700], prop: [0.06, 0.3],
            isp: [220, 225, 230, 235], thrust: [1, 4, 5, 10, 22]
        },
        geo: {
            names: ['a GEO communications satellite', 'a GEO missile-warning satellite', 'a GEO weather satellite'],
            engine: 'engine', dry: [1500, 3500], prop: [0.1, 0.45],
            isp: [300, 310, 315, 320], thrust: [400, 440, 490]
        },
        geoRcs: {
            names: ['a GEO communications satellite', 'a GEO missile-warning satellite', 'a GEO weather satellite'],
            engine: 'engine', dry: [1500, 3500], prop: [0.08, 0.3],
            isp: [285, 290, 295, 300], thrust: [10, 22]
        },
        servicer: {
            names: ['a satellite-servicing vehicle', 'an on-orbit inspector spacecraft', 'a GEO space tug'],
            engine: 'engine', dry: [600, 2000], prop: [0.15, 0.5],
            isp: [290, 300, 310], thrust: [100, 200, 220, 440]
        },
        electric: {
            names: ['an all-electric GEO satellite', 'a MEO navigation satellite', 'an electric orbit-transfer vehicle'],
            engine: 'engine', dry: [800, 2500], prop: [0.05, 0.25], electric: true,
            isp: [1500, 1600, 1800, 2000], thrust: [0.08, 0.1, 0.15, 0.2, 0.25, 0.3]
        }
    };

    function vehicle(keys) {
        const v = VEHICLES[pick(keys)];
        const dry = snap(logBetween(...v.dry), 10);
        return {
            name: pick(v.names),
            engine: v.engine,
            electric: Boolean(v.electric),
            dry,
            prop: snap(dry * between(...v.prop), 1),
            isp: pick(v.isp),
            F: pick(v.thrust)
        };
    }

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    // PracticeMath turns a thousands comma into {,}, so these work in TeX too.
    const group = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    // A given mass, and a computed one with about four or more figures
    const mass = (x) => (Number.isInteger(x) ? group(x) : group(x, 2));
    const fine = (x) => group(x, Math.abs(x) < 1 ? 4 : Math.abs(x) < 10 ? 3 : 2);
    // A speed, with more decimals for a small one
    const speed = (x) => group(x, Math.abs(x) < 10 ? 3 : Math.abs(x) < 100 ? 2 : 1);
    const ratio = (R) => R.toFixed(5);
    const sci = (x, d = 3) => {
        const [mant, exp] = Number(x).toExponential(d).split('e');
        return `${mant} \\times 10^{${Number(exp)}}`;
    };
    const sciText = (x, d = 3) => {
        const [mant, exp] = Number(x).toExponential(d).split('e');
        return `${mant} × 10^${Number(exp)}`;
    };
    const accelTex = (a) => (a >= 0.01 ? a.toFixed(4) : sci(a));
    const accelText = (a) => (a >= 0.01 ? a.toFixed(4) : sciText(a));
    const force = (F) => group(F, F < 1 ? 3 : F < 100 ? 2 : 1);
    // A duration in seconds, with minutes, hours, or days alongside
    function longTime(s) {
        if (s < 3600) return `${(s / 60).toFixed(2)} min`;
        if (s < 172800) return `${(s / 3600).toFixed(2)} hr`;
        return `${(s / 86400).toFixed(2)} days`;
    }
    const timeText = (s) => `${group(s, 1)} s (${longTime(s)})`;
    const timeTex = (s) => `${group(s, 1)}\\text{ s} \\;(\\text{${longTime(s)}})`;
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;

    // A thrust as given: in mN for an electric thruster, sometimes in kN for a large engine.
    // work converts it to newtons in the step that first uses it.
    function thrustGiven(F) {
        if (F < 1) {
            return {
                tex: `F = ${group(F * 1000)}\\text{ mN}`,
                work: calc('F', [`${group(F * 1000)}\\text{ mN} \\times \\dfrac{1\\text{ N}}{1{,}000\\text{ mN}}`], `${F}\\text{ N}`)
            };
        }
        if (F >= 100 && chance(0.35)) {
            return {
                tex: `F = ${F / 1000}\\text{ kN}`,
                work: calc('F', [`${F / 1000}\\text{ kN} \\times 1{,}000\\text{ N/kN}`], `${group(F)}\\text{ N}`)
            };
        }
        return { tex: `F = ${group(F)}\\text{ N}`, work: '' };
    }

    // A duration as given, between low and high seconds: in hours, minutes, or seconds.
    function durationGiven(low, high, sym = '\\Delta t') {
        const raw = between(low, high);
        if (raw >= 7200) {
            const h = Math.max(2, Math.round(raw / 3600));
            return { s: h * 3600, tex: `${sym} = ${h}\\text{ hr}`, work: calc(sym, [`${h}\\text{ hr} \\times 3{,}600\\text{ s/hr}`], `${group(h * 3600)}\\text{ s}`) };
        }
        if (raw >= 120 && chance(0.65)) {
            const m = Math.max(2, Math.round(raw / 60));
            return { s: m * 60, tex: `${sym} = ${m}\\text{ min}`, work: calc(sym, [`${m}\\text{ min} \\times 60\\text{ s/min}`], `${group(m * 60)}\\text{ s}`) };
        }
        const s = Math.max(10, snap(raw, raw < 100 ? 5 : 10));
        return { s, tex: `${sym} = ${group(s)}\\text{ s}`, work: '' };
    }

    // A time limit, in the unit a planner would use
    function limitGiven(seconds, sym) {
        if (seconds < 7200) {
            const m = Math.max(1, Math.round(seconds / 60));
            return { s: m * 60, tex: `${sym} = ${m}\\text{ min}`, work: calc(sym, [`${m}\\text{ min} \\times 60\\text{ s/min}`], `${group(m * 60)}\\text{ s}`) };
        }
        const h = Math.max(2, Math.round(seconds / 3600));
        return { s: h * 3600, tex: `${sym} = ${h}\\text{ hr}`, work: calc(sym, [`${h}\\text{ hr} \\times 3{,}600\\text{ s/hr}`], `${group(h * 3600)}\\text{ s}`) };
    }

    /* ------------------------------------------------------------------ */
    /* Worked Steps                                                       */
    /* ------------------------------------------------------------------ */
    const step = (key, title, result, html) => ({
        key, title: prose(title), result: math(result), caption: '', methods: [{ name: 'Formula', html }]
    });

    const W = {
        // Mass accounting
        sum: (dry, mp, sym = 'm_i') => calc(`${sym} = m_{\\text{dry}} + m_p`, [`${mass(dry)} + ${mass(mp)}`], `${mass(dry + mp)}\\text{ kg}`),
        diff: (sym, a, b, res) => calc(sym, [`${fine(a)} - ${fine(b)}`], `${fine(res)}\\text{ kg}`),

        // The rocket equation and its rearrangements
        dv: (mi, mf, isp, dv) => calc(ROCKET, [
            `(${group(isp)}\\text{ s})(9.81\\text{ m/s}^2) \\ln\\!\\left(\\dfrac{${fine(mi)}}{${fine(mf)}}\\right)`,
            `${group(isp * G0, 1)} \\times \\ln(${ratio(mi / mf)})`
        ], `${speed(dv)}\\text{ m/s}`),
        mf: (mi, dv, isp, mf) => {
            const x = dv / (isp * G0);
            return calc(`m_f = \\dfrac{m_i}{e^{\\Delta V / (${ISP} g_0)}}`, [
                `\\dfrac{${fine(mi)}}{e^{${speed(dv)} / ${group(isp * G0, 1)}}}`,
                `\\dfrac{${fine(mi)}}{e^{${x.toFixed(5)}}} = \\dfrac{${fine(mi)}}{${ratio(Math.exp(x))}}`
            ], `${fine(mf)}\\text{ kg}`)
                + note(`Rearranged rocket equation: divide both sides by $${ISP} g_0$, raise $e$ to each side to get $m_i / m_f$, then solve for $m_f$.`);
        },
        mi: (mf, dv, isp, mi) => {
            const x = dv / (isp * G0);
            return calc(`m_i = m_f\\, e^{\\Delta V / (${ISP} g_0)}`, [
                `${fine(mf)}\\, e^{${speed(dv)} / ${group(isp * G0, 1)}}`,
                `${fine(mf)} \\times e^{${x.toFixed(5)}} = ${fine(mf)} \\times ${ratio(Math.exp(x))}`
            ], `${fine(mi)}\\text{ kg}`)
                + note(`Rearranged rocket equation: $m_i / m_f = e^{\\Delta V / (${ISP} g_0)}$, so multiply the final mass by that ratio.`);
        },
        ratio: (dv, isp, R) => calc(`\\dfrac{m_i}{m_f} = e^{\\Delta V / (${ISP} g_0)}`, [
            `e^{${speed(dv)} / ${group(isp * G0, 1)}}`,
            `e^{${(dv / (isp * G0)).toFixed(5)}}`
        ], ratio(R)) + note(`Rearranged rocket equation: divide both sides by $${ISP} g_0$, then raise $e$ to each side.`),
        isp: (dv, mi, mf, isp) => calc(`${ISP} = \\dfrac{\\Delta V}{g_0 \\ln(m_i / m_f)}`, [
            `\\dfrac{${speed(dv)}}{9.81 \\ln(${ratio(mi / mf)})}`,
            `\\dfrac{${speed(dv)}}{9.81 \\times ${Math.log(mi / mf).toFixed(6)}}`
        ], `${group(isp, 1)}\\text{ s}`) + note('Rearranged rocket equation: divide $\\Delta V$ by $g_0 \\ln(m_i / m_f)$.'),

        // a = F / m and its rearrangements
        accel: (F, m, a, aSym = 'a_0', mSym = 'm_i') => calc(`${aSym} = \\dfrac{F}{${mSym}}`, [
            `\\dfrac{${force(F)}\\text{ N}}{${fine(m)}\\text{ kg}}`
        ], `${accelTex(a)}\\text{ m/s}^2`),
        force: (m, a, F, mSym = 'm_i') => calc(`a = \\dfrac{F}{m} \\;\\Rightarrow\\; F = ${mSym}\\, a`, [
            `(${fine(m)}\\text{ kg})(${accelTex(a)}\\text{ m/s}^2)`
        ], `${force(F)}\\text{ N}`) + note('$1\\text{ kg·m/s}^2 = 1\\text{ N}$.'),
        massFromForce: (F, a, m) => calc('a = \\dfrac{F}{m} \\;\\Rightarrow\\; m = \\dfrac{F}{a}', [
            `\\dfrac{${force(F)}\\text{ N}}{${accelTex(a)}\\text{ m/s}^2}`
        ], `${fine(m)}\\text{ kg}`),

        // dt = dV / a and its rearrangements
        dt: (dv, a, dt, aSym = 'a_0') => calc(`\\Delta t = \\dfrac{\\Delta V}{${aSym}}`, [
            `\\dfrac{${speed(dv)}\\text{ m/s}}{${accelTex(a)}\\text{ m/s}^2}`
        ], timeTex(dt)),
        dvFromBurn: (a, dt, dv) => calc('\\Delta t = \\dfrac{\\Delta V}{a} \\;\\Rightarrow\\; \\Delta V = a\\, \\Delta t', [
            `(${accelTex(a)}\\text{ m/s}^2)(${group(dt)}\\text{ s})`
        ], `${speed(dv)}\\text{ m/s}`),
        aFromBurn: (dv, dt, a) => calc('\\Delta t = \\dfrac{\\Delta V}{a} \\;\\Rightarrow\\; a = \\dfrac{\\Delta V}{\\Delta t}', [
            `\\dfrac{${speed(dv)}\\text{ m/s}}{${group(dt)}\\text{ s}}`
        ], `${accelTex(a)}\\text{ m/s}^2`)
    };

    const WET_NOTE = 'Use the mass at the start of the burn, $m_i$. This is the course-standard estimate: the spacecraft gets lighter as it burns, so the real burn is a little shorter.';
    const N_NOTE = '$1\\text{ N} = 1\\text{ kg·m/s}^2$, so newtons divided by kilograms gives m/s².';

    /* ------------------------------------------------------------------ */
    /* Answer Fields                                                      */
    /* ------------------------------------------------------------------ */
    const TOL = { relative: 0.01 };
    const F_ = {
        dv: (key = 'dv', name = 'Velocity change', tex = '\\Delta V') => ({ key, tex, name, unit: 'm/s', tolerance: TOL, unitType: 'speed' }),
        mass: (key, tex, name) => ({ key, tex, name, unit: 'kg', tolerance: TOL, unitType: 'mass' }),
        accel: (key = 'a', tex = 'a', name = 'Acceleration') => ({ key, tex, name, unit: 'm/s²', tolerance: TOL, unitType: 'accel' }),
        time: (key = 'dt', tex = '\\Delta t', name = 'Burn duration') => ({ key, tex, name, unit: 's', tolerance: TOL, unitType: 'time_s' }),
        force: (key = 'F', tex = 'F', name = 'Thrust') => ({ key, tex, name, unit: 'N', tolerance: TOL, unitType: 'force' }),
        isp: (name = 'Specific impulse') => ({ key: 'isp', tex: ISP, name, unit: 's', tolerance: TOL, unitType: 'isp' }),
        ratio: () => ({ key: 'ratio', tex: 'm_i / m_f', name: 'Mass ratio', unit: '', tolerance: { relative: 0.001 }, unitType: 'ratio' }),
        count: (name) => ({ key: 'n', tex: 'N', name, unit: 'burns', tolerance: { absolute: 0 }, unitType: 'count' }),
        yesno: (name = 'Feasible?') => ({ key: 'feasible', tex: '', name, unit: 'yes/no', tolerance: { absolute: 0 }, unitType: 'yesno' })
    };

    const A = {
        dv: (v) => ({ value: v, text: `${speed(v)} m/s` }),
        mass: (v) => ({ value: v, text: `${fine(v)} kg` }),
        accel: (v) => ({ value: v, text: `${accelText(v)} m/s²` }),
        time: (v) => ({ value: v, text: timeText(v) }),
        force: (v) => ({ value: v, text: `${force(v)} N` }),
        isp: (v) => ({ value: v, text: `${group(v, 1)} s` }),
        ratio: (v) => ({ value: v, text: ratio(v) }),
        count: (v) => ({ value: v, text: `${v} burns` }),
        yesno: (v) => ({ value: v ? 1 : 0, text: v ? 'Yes' : 'No' })
    };

    /* ------------------------------------------------------------------ */
    /* Grading                                                            */
    /* ------------------------------------------------------------------ */
    // A typed unit is converted to the field's unit: km/s for a speed, kN or mN for a force.
    // Times use the rendezvous time parser: seconds, minutes, hours, days, or h:mm:ss.
    const UNITS = {
        speed: [['km/s', 1000], ['m/s', 1]],
        mass: [['kg', 1]],
        force: [['kn', 1000], ['mn', 0.001], ['n', 1]],
        accel: [['m/s^2', 1], ['m/s²', 1], ['m/s2', 1], ['m/s/s', 1]],
        isp: [['seconds', 1], ['sec', 1], ['s', 1]],
        count: [['burns', 1], ['burn', 1]],
        ratio: []
    };

    function grade(tolerance, text, truth, unitType) {
        const typed = String(text).trim().toLowerCase();
        if (!typed) return 'blank';
        if (unitType === 'yesno') {
            if (/^(y|yes|feasible|true)\b/.test(typed)) return truth === 1 ? 'right' : 'wrong';
            if (/^(n|no|not|infeasible|false)\b/.test(typed)) return truth === 0 ? 'right' : 'wrong';
            return 'invalid';
        }
        let value;
        if (unitType === 'time_s') {
            value = Rendezvous.parseSeconds(typed);
        } else {
            let s = typed;
            let scale = 1;
            for (const [unit, factor] of UNITS[unitType] || []) {
                if (s.endsWith(unit)) {
                    s = s.slice(0, -unit.length);
                    scale = factor;
                    break;
                }
            }
            value = Check.parseAnswer(s);
            if (value !== null) value *= scale;
        }
        if (value === null || value === undefined) return 'invalid';
        return Check.isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
    }

    function limitsFor(fields) {
        const has = (type) => fields.some((f) => f.unitType === type);
        let text = 'Accepted: numbers within 1%';
        if (has('ratio')) text += ' (the mass ratio within 0.1%)';
        text += '. Units may be typed: m/s or km/s, N, kN, or mN.';
        if (has('time_s')) text += ' Times in seconds, minutes, hours, days, or h:mm:ss.';
        if (has('count')) text += ' The number of burns must be exact.';
        if (has('yesno')) text += ' Answer feasibility with yes or no.';
        return prose(`${text} The solutions use $g_0 = 9.81\\text{ m/s}^2$ and only the rocket equation, $a = F/m$, and $\\Delta t = \\Delta V / a$.`);
    }

    /* ------------------------------------------------------------------ */
    /* Foundational (4-5)                                                 */
    /* ------------------------------------------------------------------ */
    // Stationkeeping or drag makeup: a = F / m, then dt = dV / a.
    function stationkeepingBurn() {
        const v = vehicle(['leo', 'geoRcs', 'electric']);
        const m = v.dry + v.prop;
        const dv = v.electric ? snap(between(1, 5), 0.5) : snap(between(0.5, 8), 0.1);
        const a = v.F / m;
        const dt = dv / a;
        const thrust = thrustGiven(v.F);
        const op = pick(v.electric ? ['north-south stationkeeping', 'east-west stationkeeping'] : ['stationkeeping', 'drag-makeup', 'orbit-trim']);
        return {
            scenario: 'Stationkeeping Burn', difficulty: 4,
            prompt: prose(`${cap(v.name)} uses its ${v.engine} for a ${op} burn of $\\Delta V$. Its current mass is $m$. Find the acceleration the thrust gives it, then how long the burn lasts.`),
            statement: item(`m = ${mass(m)}\\text{ kg}`) + item(thrust.tex) + item(`\\Delta V = ${dv}\\text{ m/s}`),
            fields: [F_.accel('a0', 'a', 'Acceleration'), F_.time()],
            answers: { a0: A.accel(a), dt: A.time(dt) },
            steps: [
                step('a0', 'Acceleration: $a = F / m$', `a = ${accelTex(a)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, m, a, 'a', 'm') + note(N_NOTE)),
                step('dt', 'Duration: $\\Delta t = \\Delta V / a$', `\\Delta t = ${group(dt, 1)}\\text{ s}`, W.dt(dv, a, dt, 'a'))
            ]
        };
    }

    // Fuel gauge: m_i from mass accounting, then the rocket equation to the dry mass.
    function availableDv() {
        const v = vehicle(['leo', 'geo', 'servicer', 'electric']);
        const mi = v.dry + v.prop;
        const dv = v.isp * G0 * Math.log(mi / v.dry);
        return {
            scenario: 'Propellant Gauge Check', difficulty: 4,
            prompt: prose(`Telemetry from ${v.name} shows how much usable propellant is left. Its ${v.engine} has specific impulse $${ISP}$. Find the spacecraft's current mass, then the total $\\Delta V$ it could still deliver if it burned all of the propellant.`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`),
            fields: [F_.mass('m_i', 'm_i', 'Current (wet) mass'), F_.dv('dv', 'Total ΔV available')],
            answers: { m_i: A.mass(mi), dv: A.dv(dv) },
            steps: [
                step('m_i', 'Mass accounting: $m_i = m_{\\text{dry}} + m_p$', `m_i = ${mass(mi)}\\text{ kg}`, W.sum(v.dry, v.prop)),
                step('dv', 'Rocket equation, burning to empty', `\\Delta V = ${speed(dv)}\\text{ m/s}`, W.dv(mi, v.dry, v.isp, dv)
                    + note('Burning all of the propellant leaves only the dry mass, so $m_f = m_{\\text{dry}}$.'))
            ]
        };
    }

    // Time-constrained burn: a = dV / dt, then F = m a.
    function timedBurnThrust() {
        const v = vehicle(['servicer', 'leo', 'geo']);
        const m = v.dry + v.prop;
        const dv = snap(between(4, 60), 1);
        const dur = durationGiven(60, 900);
        const a = dv / dur.s;
        const F = m * a;
        const why = pick([
            'so that it reaches the next rendezvous waypoint on schedule',
            'before the spacecraft leaves ground-station contact',
            'within the window that the proximity-operations plan allows'
        ]);
        return {
            scenario: 'Time-Constrained Burn', difficulty: 4.5,
            prompt: prose(`${cap(v.name)} must complete a $\\Delta V$ burn within $\\Delta t$, ${why}. Using its current mass $m$, find the acceleration it needs, then the thrust its engine must produce.`),
            statement: item(`m = ${mass(m)}\\text{ kg}`) + item(`\\Delta V = ${dv}\\text{ m/s}`) + item(dur.tex),
            fields: [F_.accel('a', 'a', 'Acceleration needed'), F_.force('F', 'F', 'Thrust needed')],
            answers: { a: A.accel(a), F: A.force(F) },
            steps: [
                step('a', 'Rearrange: $a = \\Delta V / \\Delta t$', `a = ${accelTex(a)}\\text{ m/s}^2`, dur.work + W.aFromBurn(dv, dur.s, a)
                    + note('Put the time in seconds first, so that the acceleration comes out in m/s².')),
                step('F', 'Rearrange: $F = m\\, a$', `F = ${force(F)}\\text{ N}`, W.force(m, a, F, 'm'))
            ]
        };
    }

    // Propellant budgeting: the rocket equation solved for m_f, then m_p = m_i - m_f.
    function propellantBudget() {
        const v = vehicle(['leo', 'geo', 'servicer', 'electric']);
        const mi = v.dry + v.prop;
        const dv = v.electric ? snap(between(50, 600), 10) : snap(between(10, 250), 5);
        const mf = mi / Math.exp(dv / (v.isp * G0));
        const mp = mi - mf;
        const op = pick(['an inclination trim', 'an orbit-raising burn', 'a phasing maneuver', 'a relocation burn']);
        return {
            scenario: 'Propellant Budgeting', difficulty: 4.5,
            prompt: prose(`Mission planners for ${v.name} are budgeting propellant for ${op} of $\\Delta V$, made with its ${v.engine}. Find the spacecraft's mass after the burn, then the propellant the burn uses.`),
            statement: item(`m_i = ${mass(mi)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(`\\Delta V = ${dv}\\text{ m/s}`),
            fields: [F_.mass('m_f', 'm_f', 'Mass after the burn'), F_.mass('m_p', 'm_p', 'Propellant used')],
            answers: { m_f: A.mass(mf), m_p: A.mass(mp) },
            steps: [
                step('m_f', 'Rearrange the rocket equation for $m_f$', `m_f = ${fine(mf)}\\text{ kg}`, W.mf(mi, dv, v.isp, mf)),
                step('m_p', 'Mass accounting: $m_p = m_i - m_f$', `m_p = ${fine(mp)}\\text{ kg}`, W.diff('m_p = m_i - m_f', mi, mf, mp)
                    + note(`The burn uses ${(mp / mi * 100).toFixed(1)}% of the spacecraft's starting mass.`))
            ]
        };
    }

    // Timed burn: a = F / m, then dV = a dt.
    function burnDeltaV() {
        const v = vehicle(['servicer', 'leo', 'geo']);
        const m = v.dry + v.prop;
        const thrust = thrustGiven(v.F);
        const dur = durationGiven(v.F >= 100 ? 20 : 60, v.F >= 100 ? 240 : 900);
        const a = v.F / m;
        const dv = a * dur.s;
        const op = pick(['an orbit-correction burn', 'a collision-avoidance burn', 'a phasing burn']);
        return {
            scenario: 'Orbit Correction', difficulty: 5,
            prompt: prose(`${cap(v.name)} fires its ${v.engine} for ${op} lasting $\\Delta t$. Using its mass $m$ at ignition, find its acceleration, then the $\\Delta V$ the burn delivers.`),
            statement: item(`m = ${mass(m)}\\text{ kg}`) + item(thrust.tex) + item(dur.tex),
            fields: [F_.accel('a0', 'a', 'Acceleration'), F_.dv()],
            answers: { a0: A.accel(a), dv: A.dv(dv) },
            steps: [
                step('a0', 'Acceleration: $a = F / m$', `a = ${accelTex(a)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, m, a, 'a', 'm') + note(N_NOTE)),
                step('dv', 'Rearrange: $\\Delta V = a\\, \\Delta t$', `\\Delta V = ${speed(dv)}\\text{ m/s}`, dur.work + W.dvFromBurn(a, dur.s, dv))
            ]
        };
    }

    // Comparing propulsion: the mass ratio from mass accounting, then the rocket equation solved
    // for Isp.
    function minimumIsp() {
        const v = vehicle(['leo', 'geo', 'servicer', 'electric']);
        const mi = v.dry + v.prop;
        const dv = snap(v.isp * G0 * Math.log(mi / v.dry) * between(0.9, 1.1), 10);
        const R = mi / v.dry;
        const isp = dv / (G0 * Math.log(R));
        return {
            scenario: 'Engine Selection', difficulty: 5,
            prompt: prose(`Engineers are choosing the propulsion system for ${v.name}. Its dry mass is $m_{\\text{dry}}$, its tank holds $m_p$ of propellant, and the mission needs a total $\\Delta V$. Find the mass ratio when the tank is used up, then the minimum specific impulse an engine needs.`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`\\Delta V = ${group(dv)}\\text{ m/s}`),
            fields: [F_.ratio(), F_.isp('Minimum specific impulse')],
            answers: { ratio: A.ratio(R), isp: A.isp(isp) },
            steps: [
                step('ratio', 'Mass ratio: $m_i / m_f$', `m_i / m_f = ${ratio(R)}`, W.sum(v.dry, v.prop)
                    + calc('\\dfrac{m_i}{m_f} = \\dfrac{m_i}{m_{\\text{dry}}}', [`\\dfrac{${mass(mi)}}{${mass(v.dry)}}`], ratio(R))),
                step('isp', 'Rearrange the rocket equation for $I_{\\text{sp}}$', `${ISP} = ${group(isp, 1)}\\text{ s}`, W.isp(dv, mi, v.dry, isp)
                    + note('Any engine with at least this specific impulse can deliver the mission $\\Delta V$ with this tank.'))
            ]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Intermediate (5.5-6.5)                                             */
    /* ------------------------------------------------------------------ */
    // End-of-mission assessment: m_i, the rocket equation to empty, a_0, then the duration.
    function fullTankBurn() {
        const v = vehicle(['leo', 'geo', 'servicer']);
        const mi = v.dry + v.prop;
        const dv = v.isp * G0 * Math.log(mi / v.dry);
        const a0 = v.F / mi;
        const dt = dv / a0;
        const thrust = thrustGiven(v.F);
        return {
            scenario: 'Performance Assessment', difficulty: 5.5,
            prompt: prose(`An operations crew is assessing ${v.name}. If it burned all of its remaining propellant in one maneuver with its ${v.engine}, find the $\\Delta V$ it gains, its acceleration at ignition, and the burn duration (estimated with the mass at ignition).`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(thrust.tex),
            fields: [F_.dv('dv', 'ΔV available'), F_.accel('a0', 'a_0', 'Acceleration at ignition'), F_.time()],
            answers: { dv: A.dv(dv), a0: A.accel(a0), dt: A.time(dt) },
            steps: [
                step('m_i', 'Mass accounting: $m_i = m_{\\text{dry}} + m_p$', `m_i = ${mass(mi)}\\text{ kg}`, W.sum(v.dry, v.prop)),
                step('dv', 'Rocket equation, burning to empty', `\\Delta V = ${speed(dv)}\\text{ m/s}`, W.dv(mi, v.dry, v.isp, dv)),
                step('a0', 'Acceleration at ignition: $a_0 = F / m_i$', `a_0 = ${accelTex(a0)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, mi, a0)),
                step('dt', 'Duration: $\\Delta t = \\Delta V / a_0$', `\\Delta t = ${group(dt, 1)}\\text{ s}`, W.dt(dv, a0, dt) + note(WET_NOTE))
            ]
        };
    }

    // Collision avoidance: a = F / m_i, dV = a dt, then the rocket equation for the propellant.
    function timedBurnPropellant() {
        const v = vehicle(['servicer', 'leo', 'geo']);
        const mi = v.dry + v.prop;
        const thrust = thrustGiven(v.F);
        const dur = durationGiven(v.F >= 100 ? 20 : 60, v.F >= 100 ? 240 : 900);
        const a = v.F / mi;
        const dv = a * dur.s;
        const mf = mi / Math.exp(dv / (v.isp * G0));
        const mp = mi - mf;
        const op = pick(['a collision-avoidance burn', 'a debris-avoidance burn', 'an evasive burn']);
        return {
            scenario: 'Collision Avoidance', difficulty: 6,
            prompt: prose(`${cap(v.name)} fires its ${v.engine} for ${op} lasting $\\Delta t$. Estimating with its mass at ignition, find its acceleration and the $\\Delta V$ the burn delivers, then the propellant the burn uses.`),
            statement: item(`m_i = ${mass(mi)}\\text{ kg}`) + item(thrust.tex) + item(dur.tex) + item(`${ISP} = ${v.isp}\\text{ s}`),
            fields: [F_.accel('a0', 'a_0', 'Acceleration'), F_.dv(), F_.mass('m_p', 'm_p', 'Propellant used')],
            answers: { a0: A.accel(a), dv: A.dv(dv), m_p: A.mass(mp) },
            steps: [
                step('a0', 'Acceleration: $a_0 = F / m_i$', `a_0 = ${accelTex(a)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, mi, a)),
                step('dv', 'Rearrange: $\\Delta V = a_0\\, \\Delta t$', `\\Delta V = ${speed(dv)}\\text{ m/s}`, dur.work + W.dvFromBurn(a, dur.s, dv)),
                step('m_f', 'Rearrange the rocket equation for $m_f$', `m_f = ${fine(mf)}\\text{ kg}`, W.mf(mi, dv, v.isp, mf)),
                step('m_p', 'Mass accounting: $m_p = m_i - m_f$', `m_p = ${fine(mp)}\\text{ kg}`, W.diff('m_p = m_i - m_f', mi, mf, mp))
            ]
        };
    }

    // Orbit raising: the rocket equation for m_f, m_p, then the acceleration at burnout.
    function burnoutAcceleration() {
        const v = vehicle(['geo', 'servicer', 'electric', 'leo']);
        const mi = v.dry + v.prop;
        const dvMax = v.isp * G0 * Math.log(mi / v.dry);
        const dv = snap(dvMax * between(0.35, 0.85), v.electric ? 10 : 5);
        const mf = mi / Math.exp(dv / (v.isp * G0));
        const mp = mi - mf;
        const af = v.F / mf;
        const a0 = v.F / mi;
        const thrust = thrustGiven(v.F);
        return {
            scenario: 'Orbit Raising', difficulty: 6,
            prompt: prose(`${cap(v.name)} makes an orbit-raising burn of $\\Delta V$ with its ${v.engine}. Find the propellant it uses, its mass at burnout, and its acceleration at burnout (when the spacecraft is lightest).`),
            statement: item(`m_i = ${mass(mi)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(thrust.tex) + item(`\\Delta V = ${group(dv)}\\text{ m/s}`),
            fields: [F_.mass('m_p', 'm_p', 'Propellant used'), F_.mass('m_f', 'm_f', 'Mass at burnout'), F_.accel('a_f', 'a_f', 'Acceleration at burnout')],
            answers: { m_p: A.mass(mp), m_f: A.mass(mf), a_f: A.accel(af) },
            steps: [
                step('m_f', 'Rearrange the rocket equation for $m_f$', `m_f = ${fine(mf)}\\text{ kg}`, W.mf(mi, dv, v.isp, mf)),
                step('m_p', 'Mass accounting: $m_p = m_i - m_f$', `m_p = ${fine(mp)}\\text{ kg}`, W.diff('m_p = m_i - m_f', mi, mf, mp)),
                step('a_f', 'Acceleration at burnout: $a_f = F / m_f$', `a_f = ${accelTex(af)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, mf, af, 'a_f', 'm_f')
                    + note(`At ignition, $a_0 = F / m_i = ${accelTex(a0)}\\text{ m/s}^2$. The same thrust accelerates the lighter spacecraft ${((af / a0 - 1) * 100).toFixed(1)}% harder at burnout.`))
            ]
        };
    }

    // End-of-life disposal: work backward from the dry mass to the minimum propellant reserve,
    // then the burn time.
    function disposalReserve() {
        const geo = chance(0.5);
        const v = vehicle(geo ? ['geoRcs'] : ['leo']);
        const dv = geo ? snap(between(9, 15), 0.5) : snap(between(60, 160), 5);
        const mi = v.dry * Math.exp(dv / (v.isp * G0));
        const mp = mi - v.dry;
        const a0 = v.F / mi;
        const dt = dv / a0;
        const where = geo
            ? 'raise it into a graveyard orbit above the GEO belt'
            : 'lower its perigee so that it reenters the atmosphere';
        return {
            scenario: 'End-of-Life Disposal', difficulty: 6.5,
            prompt: prose(`At the end of its mission, ${v.name} must keep enough propellant to ${where}, a burn of $\\Delta V$ with its ${v.engine}. The burn may use the tanks to empty. Find the minimum propellant reserve, the spacecraft's mass when the burn starts, and the burn duration (estimated with the mass at ignition).`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(`F = ${v.F}\\text{ N}`) + item(`\\Delta V = ${dv}\\text{ m/s}`),
            fields: [F_.mass('m_p', 'm_p', 'Minimum propellant reserve'), F_.mass('m_i', 'm_i', 'Mass at the start of the burn'), F_.time()],
            answers: { m_p: A.mass(mp), m_i: A.mass(mi), dt: A.time(dt) },
            steps: [
                step('m_i', 'Rearrange the rocket equation for $m_i$', `m_i = ${fine(mi)}\\text{ kg}`, W.mi(v.dry, dv, v.isp, mi)
                    + note('With the tanks used to empty, the final mass is the dry mass: $m_f = m_{\\text{dry}}$.')),
                step('m_p', 'Mass accounting: $m_p = m_i - m_{\\text{dry}}$', `m_p = ${fine(mp)}\\text{ kg}`, W.diff('m_p = m_i - m_{\\text{dry}}', mi, v.dry, mp)),
                step('a0', 'Acceleration: $a_0 = F / m_i$', `a_0 = ${accelTex(a0)}\\text{ m/s}^2`, W.accel(v.F, mi, a0)),
                step('dt', 'Duration: $\\Delta t = \\Delta V / a_0$', `\\Delta t = ${group(dt, 1)}\\text{ s}`, W.dt(dv, a0, dt))
            ]
        };
    }

    // Spacecraft design: work backward from a propellant load and a dV to the largest dry mass.
    function maximumDryMass() {
        const v = vehicle(['leo', 'geo', 'servicer', 'electric']);
        const dv = v.electric ? snap(between(400, 2000), 50) : snap(between(150, 1200), 25);
        const R = Math.exp(dv / (v.isp * G0));
        const mp = snap(v.dry * (R - 1), 5) || 5;
        const dry = mp / (R - 1);
        const mi = dry + mp;
        return {
            scenario: 'Mass Budget Design', difficulty: 6.5,
            prompt: prose(`Designers of ${v.name} have a tank that holds $m_p$ of propellant for its ${v.engine}, and the mission needs a total $\\Delta V$. Burning the full tank must deliver that $\\Delta V$. Find the required mass ratio, the largest dry mass the spacecraft can have, and its fully fueled mass.`),
            statement: item(`m_p = ${mass(mp)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(`\\Delta V = ${group(dv)}\\text{ m/s}`),
            fields: [F_.ratio(), F_.mass('m_dry', 'm_{\\text{dry}}', 'Largest dry mass'), F_.mass('m_i', 'm_i', 'Fully fueled mass')],
            answers: { ratio: A.ratio(R), m_dry: A.mass(dry), m_i: A.mass(mi) },
            steps: [
                step('ratio', 'Rearrange the rocket equation for $m_i / m_f$', `m_i / m_f = ${ratio(R)}`, W.ratio(dv, v.isp, R)),
                step('m_dry', 'Mass accounting: solve for $m_{\\text{dry}}$', `m_{\\text{dry}} = ${fine(dry)}\\text{ kg}`,
                    calc('\\dfrac{m_i}{m_f} = \\dfrac{m_{\\text{dry}} + m_p}{m_{\\text{dry}}} \\;\\Rightarrow\\; m_{\\text{dry}} = \\dfrac{m_p}{m_i / m_f - 1}', [
                        `\\dfrac{${mass(mp)}}{${ratio(R)} - 1}`
                    ], `${fine(dry)}\\text{ kg}`)
                    + note('A full burn leaves only the dry mass, so $m_f = m_{\\text{dry}}$ and $m_i = m_{\\text{dry}} + m_p$. Multiply both sides by $m_{\\text{dry}}$ and collect the $m_{\\text{dry}}$ terms.')),
                step('m_i', 'Mass accounting: $m_i = m_{\\text{dry}} + m_p$', `m_i = ${fine(mi)}\\text{ kg}`,
                    calc('m_i = m_{\\text{dry}} + m_p', [`${fine(dry)} + ${mass(mp)}`], `${fine(mi)}\\text{ kg}`)
                    + note(`Check: $${fine(mi)} / ${fine(dry)} = ${ratio(mi / dry)}$, the required mass ratio.`))
            ]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Advanced (6.5-7.5)                                                 */
    /* ------------------------------------------------------------------ */
    // Stationkeeping budget: total dV from the propellant, the number of burns it covers, and the
    // duration of the first burn.
    function stationkeepingBudget() {
        for (let tries = 0; tries < 50; tries++) {
            const v = vehicle(['geoRcs', 'leo', 'electric']);
            const mi = v.dry + v.prop;
            const dvTotal = v.isp * G0 * Math.log(mi / v.dry);
            const each = v.electric ? snap(between(1, 5), 0.5) : (v.F >= 10 && v.dry >= 1500 ? snap(between(1.5, 6), 0.5) : snap(between(0.5, 3), 0.1));
            const share = dvTotal / each;
            const n = Math.floor(share);
            if (share - n < 0.03 || share - n > 0.97 || n < 3) continue;
            const a0 = v.F / mi;
            const dt = each / a0;
            const thrust = thrustGiven(v.F);
            const kind = v.electric ? 'north-south stationkeeping' : v.dry >= 1500 ? 'north-south stationkeeping' : 'drag-makeup';
            return {
                scenario: 'Stationkeeping Budget', difficulty: 7,
                prompt: prose(`${cap(v.name)} uses its ${v.engine} for ${kind} burns of $\\Delta V_{\\text{burn}}$ each. Find the total $\\Delta V$ its remaining propellant can deliver, how many full burns that covers, and how long the next burn lasts.`),
                statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`)
                    + item(thrust.tex) + item(`\\Delta V_{\\text{burn}} = ${each}\\text{ m/s}`),
                fields: [F_.dv('dv_total', 'Total ΔV available'), F_.count('Full burns'), F_.time('dt', '\\Delta t', 'Next burn duration')],
                answers: { dv_total: A.dv(dvTotal), n: A.count(n), dt: A.time(dt) },
                steps: [
                    step('dv_total', 'Total $\\Delta V$: rocket equation to empty', `\\Delta V = ${speed(dvTotal)}\\text{ m/s}`, W.sum(v.dry, v.prop) + W.dv(mi, v.dry, v.isp, dvTotal)
                        + note('Many small burns that use up the tank deliver the same total $\\Delta V$ as one burn that uses it all.')),
                    step('n', 'Number of full burns', `N = ${n}`, calc('N = \\dfrac{\\Delta V}{\\Delta V_{\\text{burn}}}', [`\\dfrac{${speed(dvTotal)}}{${each}}`, share.toFixed(2)], `${n}\\text{ full burns}`)
                        + note('Round down: the propellant for a partial burn cannot complete one.')),
                    step('a0', 'Acceleration now: $a_0 = F / m_i$', `a_0 = ${accelTex(a0)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, mi, a0)),
                    step('dt', 'Next burn: $\\Delta t = \\Delta V_{\\text{burn}} / a_0$', `\\Delta t = ${group(dt, 1)}\\text{ s}`, W.dt(each, a0, dt)
                        + note('Later burns are shorter: as propellant is used, the same thrust accelerates a lighter spacecraft.'))
                ]
            };
        }
        return fullTankBurn();
    }

    // Feasibility: enough propellant, and short enough burn, for a required dV?
    function maneuverFeasibility() {
        for (let tries = 0; tries < 50; tries++) {
            const v = vehicle(['geo', 'servicer', 'leo']);
            const mi = v.dry + v.prop;
            const dvAvail = v.isp * G0 * Math.log(mi / v.dry);
            const outcome = pick(['ok', 'ok', 'propellant', 'time']);
            const dvReq = snap(dvAvail * (outcome === 'propellant' ? between(1.1, 1.5) : between(0.35, 0.85)), dvAvail > 200 ? 5 : 1);
            const a0 = v.F / mi;
            const dt = dvReq / a0;
            const limit = limitGiven(dt * (outcome === 'time' ? between(0.4, 0.8) : between(1.3, 2.5)), '\\Delta t_{\\max}');
            const propOk = dvAvail >= dvReq;
            const timeOk = dt <= limit.s;
            if (Math.abs(dvAvail / dvReq - 1) < 0.04 || Math.abs(dt / limit.s - 1) < 0.04 || dvReq < 1) continue;
            const ok = propOk && timeOk;
            const thrust = thrustGiven(v.F);
            const op = pick([
                'a rendezvous plan calls for a transfer burn',
                'the constellation manager wants to move it to a new orbital slot, a burn',
                'a predicted conjunction calls for an avoidance burn'
            ]);
            const verdict = ok
                ? 'Feasible: there is enough propellant, and the burn fits within the time limit.'
                : !propOk && !timeOk
                    ? 'Not feasible: the spacecraft is short of propellant, and the burn would also run past the time limit.'
                    : !propOk
                        ? 'Not feasible: the spacecraft does not carry enough propellant for the required $\\Delta V$.'
                        : 'Not feasible: there is enough propellant, but the thrust is too low to finish within the time limit.';
            return {
                scenario: 'Maneuver Feasibility', difficulty: 7,
                prompt: prose(`${cap(v.name)} has the remaining propellant shown, and ${op} of $\\Delta V_{\\text{req}}$ that must finish within $\\Delta t_{\\max}$. Find the $\\Delta V$ its ${v.engine} can deliver, estimate the burn duration for $\\Delta V_{\\text{req}}$ with its mass at ignition, and decide whether the maneuver is feasible.`),
                statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(thrust.tex)
                    + item(`\\Delta V_{\\text{req}} = ${group(dvReq)}\\text{ m/s}`) + item(limit.tex),
                fields: [F_.dv('dv_avail', 'ΔV available'), F_.time('dt', '\\Delta t', 'Burn duration for $\\Delta V_{\\text{req}}$'), F_.yesno('Is the maneuver feasible?')],
                answers: { dv_avail: A.dv(dvAvail), dt: A.time(dt), feasible: A.yesno(ok) },
                steps: [
                    step('dv_avail', 'Propellant check: $\\Delta V$ available', `\\Delta V = ${speed(dvAvail)}\\text{ m/s}`, W.sum(v.dry, v.prop) + W.dv(mi, v.dry, v.isp, dvAvail)
                        + note(`${propOk ? 'Enough' : 'Not enough'}: $${speed(dvAvail)}\\text{ m/s}$ ${propOk ? '≥' : '<'} $\\Delta V_{\\text{req}} = ${group(dvReq)}\\text{ m/s}$.`)),
                    step('a0', 'Acceleration at ignition: $a_0 = F / m_i$', `a_0 = ${accelTex(a0)}\\text{ m/s}^2`, thrust.work + W.accel(v.F, mi, a0)),
                    step('dt', 'Time check: $\\Delta t = \\Delta V_{\\text{req}} / a_0$', `\\Delta t = ${group(dt, 1)}\\text{ s}`, W.dt(dvReq, a0, dt) + limit.work
                        + note(`${timeOk ? 'Within the limit' : 'Past the limit'}: $${group(dt, 1)}\\text{ s}$ ${timeOk ? '≤' : '>'} $${group(limit.s)}\\text{ s}$.${propOk ? '' : ' (This is the time the burn would take if the propellant were there.)'}`)),
                    step('feasible', 'Decision', ok ? '\\text{Feasible}' : '\\text{Not feasible}', note(verdict + ' Both checks must pass.'))
                ]
            };
        }
        return fullTankBurn();
    }

    // Comparing propulsion: the same spacecraft and dV with a chemical and an electric system.
    function propulsionComparison() {
        const chem = vehicle(['geo', 'servicer']);
        const elec = vehicle(['electric']);
        const mi = snap(logBetween(1200, 3500), 10);
        const dv = snap(between(30, 250), 5);
        const op = pick(['relocate along the GEO belt to a new slot', 'raise its orbit to clear a crowded altitude band', 'phase ahead of a planned rendezvous']);
        const side = (sys) => {
            const mf = mi / Math.exp(dv / (sys.isp * G0));
            const a0 = sys.F / mi;
            return { mf, mp: mi - mf, a0, dt: dv / a0, thrust: thrustGiven(sys.F) };
        };
        const A_ = side(chem);
        const B_ = side(elec);
        return {
            scenario: 'Propulsion Trade Study', difficulty: 7,
            prompt: prose(`A spacecraft of mass $m_i$ must ${op}, a burn of $\\Delta V$. Option A is a chemical engine and Option B is an electric engine. For each option, find the propellant used and estimate the burn duration with the mass at ignition.`),
            statement: item(`m_i = ${mass(mi)}\\text{ kg}`) + item(`\\Delta V = ${dv}\\text{ m/s}`)
                + item(`\\text{A: } ${ISP} = ${chem.isp}\\text{ s},\\; ${A_.thrust.tex}`)
                + item(`\\text{B: } ${ISP} = ${elec.isp}\\text{ s},\\; ${B_.thrust.tex}`),
            fields: [
                F_.mass('m_pA', 'm_{p,A}', 'Propellant, Option A'), F_.mass('m_pB', 'm_{p,B}', 'Propellant, Option B'),
                F_.time('dtA', '\\Delta t_A', 'Burn duration, Option A'), F_.time('dtB', '\\Delta t_B', 'Burn duration, Option B')
            ],
            answers: { m_pA: A.mass(A_.mp), m_pB: A.mass(B_.mp), dtA: A.time(A_.dt), dtB: A.time(B_.dt) },
            steps: [
                step('m_pA', 'Option A propellant: rocket equation, then $m_i - m_f$', `m_{p,A} = ${fine(A_.mp)}\\text{ kg}`, W.mf(mi, dv, chem.isp, A_.mf) + W.diff('m_{p,A} = m_i - m_f', mi, A_.mf, A_.mp)),
                step('m_pB', 'Option B propellant: rocket equation, then $m_i - m_f$', `m_{p,B} = ${fine(B_.mp)}\\text{ kg}`, W.mf(mi, dv, elec.isp, B_.mf) + W.diff('m_{p,B} = m_i - m_f', mi, B_.mf, B_.mp)
                    + note(`Option B uses ${(A_.mp / B_.mp).toFixed(1)} times less propellant.`)),
                step('dtA', 'Option A duration: $a_0 = F / m_i$, then $\\Delta V / a_0$', `\\Delta t_A = ${group(A_.dt, 1)}\\text{ s}`, A_.thrust.work + W.accel(chem.F, mi, A_.a0) + W.dt(dv, A_.a0, A_.dt)),
                step('dtB', 'Option B duration: $a_0 = F / m_i$, then $\\Delta V / a_0$', `\\Delta t_B = ${group(B_.dt, 1)}\\text{ s}`, B_.thrust.work + W.accel(elec.F, mi, B_.a0) + W.dt(dv, B_.a0, B_.dt)
                    + note(`Option B takes ${group(B_.dt / A_.dt)} times longer: the propellant savings cost time, so B cannot respond to anything urgent.`))
            ]
        };
    }

    // Collision avoidance: a deadline sets the minimum thrust; the rocket equation sets the
    // propellant used and what is left.
    function minimumThrust() {
        const v = vehicle(['leo', 'servicer', 'geo']);
        const mi = v.dry + v.prop;
        const dv = snap(between(1, 25), 0.5);
        const limit = limitGiven(between(90, 900), '\\Delta t_{\\max}');
        const mf = mi / Math.exp(dv / (v.isp * G0));
        const mp = mi - mf;
        const left = v.prop - mp;
        const a = dv / limit.s;
        const F = mi * a;
        return {
            scenario: 'Conjunction Response', difficulty: 7.5,
            prompt: prose(`A conjunction warning gives ${v.name} until $\\Delta t_{\\max}$ from now to complete an avoidance burn of $\\Delta V$, and the burn can start right away. Find the propellant the burn uses, the propellant left afterward, and the minimum thrust that finishes the burn in time (estimated with the mass at ignition).`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`)
                + item(`\\Delta V = ${dv}\\text{ m/s}`) + item(limit.tex),
            fields: [F_.mass('m_used', 'm_{p,\\text{used}}', 'Propellant used'), F_.mass('m_left', 'm_{p,\\text{left}}', 'Propellant left'), F_.force('F', 'F_{\\min}', 'Minimum thrust')],
            answers: { m_used: A.mass(mp), m_left: A.mass(left), F: A.force(F) },
            steps: [
                step('m_f', 'Mass at burnout: rearranged rocket equation', `m_f = ${fine(mf)}\\text{ kg}`, W.sum(v.dry, v.prop) + W.mf(mi, dv, v.isp, mf)),
                step('m_used', 'Propellant used and left', `m_{p,\\text{left}} = ${fine(left)}\\text{ kg}`, W.diff('m_{p,\\text{used}} = m_i - m_f', mi, mf, mp)
                    + W.diff('m_{p,\\text{left}} = m_p - m_{p,\\text{used}}', v.prop, mp, left)),
                step('a', 'Acceleration needed: $a = \\Delta V / \\Delta t_{\\max}$', `a = ${accelTex(a)}\\text{ m/s}^2`, limit.work + W.aFromBurn(dv, limit.s, a)),
                step('F', 'Minimum thrust: $F = m_i\\, a$', `F_{\\min} = ${force(F)}\\text{ N}`, W.force(mi, a, F)
                    + note('Sized with the mass at ignition, the heaviest point of the burn. Any thruster at least this strong meets the deadline.'))
            ]
        };
    }

    // Performance assessment: a test burn's measured dV and propellant use give the spacecraft's
    // mass (from a = F / m) and the engine's delivered Isp.
    function testBurnIsp() {
        for (let tries = 0; tries < 50; tries++) {
            const v = vehicle(['servicer', 'geo', 'leo']);
            const trueMass = v.dry + v.prop;
            const dur = durationGiven(v.F >= 100 ? 30 : 120, v.F >= 100 ? 300 : 1200);
            const dv = snap((v.F / trueMass) * dur.s, 0.01);
            const mpTrue = trueMass * (1 - Math.exp(-dv / (v.isp * G0 * between(0.94, 1))));
            const mp = snap(mpTrue, 0.01);
            if (mp < 4 || dv < 2) continue;
            const a = dv / dur.s;
            const mi = v.F / a;
            const mf = mi - mp;
            const isp = dv / (G0 * Math.log(mi / mf));
            const thrust = thrustGiven(v.F);
            return {
                scenario: 'Thruster Performance Check', difficulty: 7.5,
                prompt: prose(`After a test burn of $\\Delta t$ with its ${v.engine}, rated at thrust $F$, tracking shows ${v.name} gained $\\Delta V$, and telemetry shows it used $m_p$ of propellant. Estimating the burn with the mass at ignition, find its acceleration, its mass at ignition, and the specific impulse the engine actually delivered.`),
                statement: item(thrust.tex) + item(`${ISP}\\text{ rated} = ${v.isp}\\text{ s}`) + item(dur.tex) + item(`\\Delta V = ${dv.toFixed(2)}\\text{ m/s}`) + item(`m_p = ${mp.toFixed(2)}\\text{ kg}`),
                fields: [F_.accel('a0', 'a_0', 'Acceleration'), F_.mass('m_i', 'm_i', 'Mass at ignition'), F_.isp('Delivered specific impulse')],
                answers: { a0: A.accel(a), m_i: A.mass(mi), isp: A.isp(isp) },
                steps: [
                    step('a0', 'Rearrange: $a_0 = \\Delta V / \\Delta t$', `a_0 = ${accelTex(a)}\\text{ m/s}^2`, dur.work + W.aFromBurn(dv, dur.s, a)),
                    step('m_i', 'Rearrange: $m_i = F / a_0$', `m_i = ${fine(mi)}\\text{ kg}`, thrust.work + W.massFromForce(v.F, a, mi)),
                    step('m_f', 'Mass accounting: $m_f = m_i - m_p$', `m_f = ${fine(mf)}\\text{ kg}`, W.diff('m_f = m_i - m_p', mi, mp, mf)),
                    step('isp', 'Rearrange the rocket equation for $I_{\\text{sp}}$', `${ISP} = ${group(isp, 1)}\\text{ s}`, W.isp(dv, mi, mf, isp)
                        + note('Compare with the engine\'s rated value: a delivered $I_{\\text{sp}}$ well below it would point to a degraded engine.'))
                ]
            };
        }
        return timedBurnPropellant();
    }

    // Rendezvous window: the dV a short window allows, the propellant it uses, and the dV left.
    function rendezvousWindow() {
        const v = vehicle(['servicer', 'geo']);
        const mi = v.dry + v.prop;
        const a0 = v.F / mi;
        const dvAvail = v.isp * G0 * Math.log(mi / v.dry);
        const window = limitGiven(between(0.15, 0.6) * dvAvail / a0, '\\Delta t_{\\text{window}}');
        const dv = a0 * window.s;
        const mf = mi / Math.exp(dv / (v.isp * G0));
        const mp = mi - mf;
        const dvLeft = v.isp * G0 * Math.log(mf / v.dry);
        const thrust = thrustGiven(v.F);
        return {
            scenario: 'Rendezvous Burn Window', difficulty: 7,
            prompt: prose(`${cap(v.name)} is closing on a client satellite. Its ${v.engine} can fire for at most $\\Delta t_{\\text{window}}$ before the approach corridor closes. Estimating with the mass at ignition, find the largest $\\Delta V$ it can make in the window, the propellant that burn uses, and the $\\Delta V$ it still has afterward.`),
            statement: item(`m_{\\text{dry}} = ${mass(v.dry)}\\text{ kg}`) + item(`m_p = ${mass(v.prop)}\\text{ kg}`) + item(`${ISP} = ${v.isp}\\text{ s}`) + item(thrust.tex) + item(window.tex),
            fields: [F_.dv('dv', 'ΔV in the window'), F_.mass('m_p', 'm_p', 'Propellant used'), F_.dv('dv_left', 'ΔV left afterward', '\\Delta V_{\\text{left}}')],
            answers: { dv: A.dv(dv), m_p: A.mass(mp), dv_left: A.dv(dvLeft) },
            steps: [
                step('a0', 'Acceleration at ignition: $a_0 = F / m_i$', `a_0 = ${accelTex(a0)}\\text{ m/s}^2`, W.sum(v.dry, v.prop) + thrust.work + W.accel(v.F, mi, a0)),
                step('dv', 'Rearrange: $\\Delta V = a_0\\, \\Delta t$', `\\Delta V = ${speed(dv)}\\text{ m/s}`, window.work + W.dvFromBurn(a0, window.s, dv)),
                step('m_p', 'Propellant: rocket equation for $m_f$, then $m_i - m_f$', `m_p = ${fine(mp)}\\text{ kg}`, W.mf(mi, dv, v.isp, mf) + W.diff('m_p = m_i - m_f', mi, mf, mp)),
                step('dv_left', '$\\Delta V$ left: rocket equation from $m_f$ to empty', `\\Delta V_{\\text{left}} = ${speed(dvLeft)}\\text{ m/s}`, W.dv(mf, v.dry, v.isp, dvLeft)
                    + note(`Check: $${speed(dv)} + ${speed(dvLeft)} = ${speed(dv + dvLeft)}\\text{ m/s}$, the same as burning the full tank from the start.`))
            ]
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    const TEMPLATES = [
        { id: 'stationkeeping', level: 'foundational', make: stationkeepingBurn },
        { id: 'gauge', level: 'foundational', make: availableDv },
        { id: 'timed-thrust', level: 'foundational', make: timedBurnThrust },
        { id: 'budget', level: 'foundational', make: propellantBudget },
        { id: 'burn-dv', level: 'foundational', make: burnDeltaV },
        { id: 'min-isp', level: 'foundational', make: minimumIsp },
        { id: 'full-tank', level: 'intermediate', make: fullTankBurn },
        { id: 'timed-prop', level: 'intermediate', make: timedBurnPropellant },
        { id: 'burnout', level: 'intermediate', make: burnoutAcceleration },
        { id: 'disposal', level: 'intermediate', make: disposalReserve },
        { id: 'dry-mass', level: 'intermediate', make: maximumDryMass },
        { id: 'sk-budget', level: 'advanced', make: stationkeepingBudget },
        { id: 'feasibility', level: 'advanced', make: maneuverFeasibility },
        { id: 'trade', level: 'advanced', make: propulsionComparison },
        { id: 'min-thrust', level: 'advanced', make: minimumThrust },
        { id: 'isp-test', level: 'advanced', make: testBurnIsp },
        { id: 'window', level: 'advanced', make: rendezvousWindow }
    ];
    const LEVELS = ['foundational', 'intermediate', 'advanced'];
    const LEVEL_NAMES = { foundational: 'Foundational', intermediate: 'Intermediate', advanced: 'Advanced' };
    let lastId = null;

    // level: 'foundational', 'intermediate', 'advanced', or anything else for any level. The
    // template is never the same as the one before.
    function generate(level, templateId) {
        let pool = TEMPLATES.filter((t) => (templateId ? t.id === templateId : (LEVELS.includes(level) ? t.level === level : true)));
        if (pool.length > 1) pool = pool.filter((t) => t.id !== lastId);
        const template = pick(pool);
        lastId = template.id;
        const p = template.make();
        return {
            ...p,
            type: template.id,
            level: template.level,
            title: `${p.scenario} · ${LEVEL_NAMES[template.level]} ${p.difficulty}/10`,
            overviewCaption: '',
            limitsHtml: limitsFor(p.fields)
        };
    }

    global.Test1PropulsionProblems = {
        constants: { G0 },
        types: LEVELS,
        templates: TEMPLATES.map((t) => t.id),
        generate,
        grade
    };
})(typeof window !== 'undefined' ? window : globalThis);
