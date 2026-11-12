// Rendezvous problems for the Test 1 Practice page: coplanar rendezvous (wait for the right phase
// angle, then fly a Hohmann transfer) and co-orbital rendezvous (phasing orbits). The numbers come
// from the solvers behind the Inertial Rendezvous tool (../orbits/rendezvous-math.js). The worked
// steps follow the Inertial Frame Rendezvous lesson, with its constants, mu = 398,600.44 km^3/s^2
// and R_earth = 6,378 km, and its order: Example 1 for coplanar, the Practice Problem for co-orbital.
// Load as a classic script, after rendezvous-math.js and maneuvers-problems.js.
(function (global) {
    'use strict';

    const RM = global.RendezvousMath;
    const Base = global.ManeuversProblems;
    const Check = global.AnswerCheck;
    const { math, prose, calc, note, rule } = global.PracticeMath;

    const MU = 398600.44;
    const R_EARTH = 6378;
    const MIN_ALT = 100;            // Lowest safe perigee altitude (km)
    const R2D = 180 / Math.PI;
    const MU_TEX = '398{,}600.44';

    // Coplanar: the lower orbit, the higher orbit as a multiple of it, and how often the chase
    // starts on the higher one
    const LOWER_RADIUS = [7000, 16000];
    const RADIUS_RATIO = [1.15, 2.6];
    const CHASE_HIGHER = 0.3;
    // A wait this close to zero or to a full synodic period is left out, so that a small rounding
    // difference cannot move the answer to the next opportunity
    const WAIT_SHARE = [0.05, 0.95];

    // Co-orbital: the shared orbit and the number of phasing orbits
    const SHARED_RADIUS = [7000, 20000];
    const PHASING_ORBITS = [1, 1, 2, 2, 3];
    const PERIGEE_FLOOR = 50;       // Phasing perigees stay at least this high (km altitude)

    // Every given angle is a multiple of this many degrees
    const ANGLE_STEP = 5;

    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const between = ([low, high]) => low + (high - low) * Math.random();
    const snap = (x) => Math.round(x / 100) * 100;
    // A whole number of angle steps from `low` to `high` degrees, both included
    const angleBetween = (low, high) => low + ANGLE_STEP * Math.floor(Math.random() * ((high - low) / ANGLE_STEP + 1));

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    // PracticeMath turns a thousands comma into {,} and ° into ^\circ, so these work in TeX too.
    const group = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const km = (x) => group(x);
    const sci = (x, d = 5) => {
        const [mant, exp] = Number(x).toExponential(d).split('e');
        return `${mant} \\times 10^{${Number(exp)}}`;
    };
    // A rate in degrees per second, with enough digits for a wait time of days
    const degRate = (radPerSec) => Number((radPerSec * R2D).toPrecision(6)).toString();
    const signed = (x, d) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(d)}`;
    const hms = (s) => RM.formatHms(s);
    const timeText = (s) => `${group(s, 1)} s (${hms(s)})`;
    const timeTex = (s) => `${group(s, 1)}\\text{ s} \\;(\\text{${hms(s)}})`;
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;

    /* ------------------------------------------------------------------ */
    /* Grading                                                            */
    /* ------------------------------------------------------------------ */
    // Times are graded in seconds. A typed unit (s, min, h, d) is converted, and the h:mm:ss and
    // "1 d 12:42:25" forms used in the answers are accepted. Other fields use the maneuver
    // grading: km/s or m/s for speeds, km for distances, degrees for angles.
    const TIME_UNITS = {
        s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
        min: 60, mins: 60, minute: 60, minutes: 60,
        h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
        d: 86400, day: 86400, days: 86400
    };

    function parseSeconds(text) {
        let s = String(text).trim().toLowerCase().replace(/[−–]/g, '-');
        const clock = s.match(/^(?:(\d+)\s*d(?:ays?)?\s+)?(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/);
        if (clock) return Number(clock[1] || 0) * 86400 + Number(clock[2]) * 3600 + Number(clock[3]) * 60 + Number(clock[4]);

        let scale = 1;
        s = s.replace(/([a-z]+)\s*$/, (match, unit) => {
            scale = TIME_UNITS[unit];
            return '';
        }).replace(/\s+/g, '');
        if (scale === undefined) return null;
        if (/^[-+]?\d{1,3}(,\d{3})+(?!\d)/.test(s)) s = s.replace(/,/g, '');
        else s = s.replace(',', '.');
        s = s.replace(/[x×*]10(\^|\*\*)?/, 'e');
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
        const value = Number(s) * scale;
        return Number.isFinite(value) ? value : null;
    }

    function grade(tolerance, text, truth, unitType) {
        if (unitType !== 'time_s') return Base.customGrade(tolerance, text, truth, unitType);
        if (!String(text).trim()) return 'blank';
        const value = parseSeconds(text);
        if (value === null) return 'invalid';
        return Check.isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
    }

    const TIME_FORMS = 'seconds, minutes, hours, or h:mm:ss';
    const MU_NOTE = 'The solutions use $\\mu = 398{,}600.44\\text{ km}^3/\\text{s}^2$.';

    /* ------------------------------------------------------------------ */
    /* Coplanar Rendezvous                                                */
    /* ------------------------------------------------------------------ */
    function coplanarModel() {
        for (let tries = 0; tries < 200; tries++) {
            const low = snap(between(LOWER_RADIUS));
            const high = snap(low * between(RADIUS_RATIO));
            const [Rchase, Rtarget] = Math.random() < CHASE_HIGHER ? [high, low] : [low, high];
            const phi0 = angleBetween(5, 355);
            const m = RM.solveCoplanar({ Rchase, Rtarget, phi0, mu: MU, rEarth: R_EARTH });
            const share = m.WT / m.T_syn;
            if (share > WAIT_SHARE[0] && share < WAIT_SHARE[1]) return m;
        }
        // The lesson's Example 1
        return RM.solveCoplanar({ Rchase: 6900, Rtarget: 7000, phi0: 180, mu: MU, rEarth: R_EARTH });
    }

    function coplanarProblem() {
        const m = coplanarModel();
        const { Rchase, Rtarget, n_chase, n_target, T_syn, a_transfer, TOF, nu_travel_deg, phi_desired_deg, WT, TOF_total } = m;
        const phi0 = m.phi0;
        const chaseLower = Rchase < Rtarget;
        const drift = (n_chase - n_target) * R2D;           // °/s, negative when the chase is higher

        // phi_desired = nu_travel - 180°, made positive by adding one lap if needed
        const phiRaw = nu_travel_deg - 180;
        const phiD = phi_desired_deg;
        // The phase change during the wait: phi_desired - phi_0 plus whole laps, with the same
        // sign as the drift rate and less than one lap, for the first opportunity
        const raw = phiD - phi0;
        let change = ((raw % 360) + 360) % 360;
        if (drift < 0 && change > 0) change -= 360;
        const laps = Math.round((change - raw) / 360);
        const lapTex = laps === 0 ? '' : ` ${laps > 0 ? '+' : '-'} ${Math.abs(laps) === 1 ? '' : Math.abs(laps)}(360^\\circ)`;
        const phiDText = phiD > 180 ? `${phiD.toFixed(2)}° (or −${(360 - phiD).toFixed(2)}°)` : `${phiD.toFixed(2)}°`;

        const answers = {
            t_syn: { value: T_syn, text: timeText(T_syn) },
            tof: { value: TOF, text: timeText(TOF) },
            nu: { value: nu_travel_deg, text: `${nu_travel_deg.toFixed(2)}°` },
            phi_d: { value: phiD, text: phiDText },
            wt: { value: WT, text: timeText(WT) },
            tof_total: { value: TOF_total, text: timeText(TOF_total) }
        };

        const fields = [
            { key: 't_syn', tex: 'T_{\\text{syn}}', name: 'Synodic period', unit: 's', tolerance: { relative: 0.01 }, unitType: 'time_s' },
            { key: 'tof', tex: 'TOF', name: 'Transfer time', unit: 's', tolerance: { relative: 0.005 }, unitType: 'time_s' },
            { key: 'nu', tex: '\\nu_{\\text{travel}}', name: 'Target travel', unit: '°', tolerance: { absolute: 0.5 }, unitType: 'angle' },
            { key: 'phi_d', tex: '\\phi_{\\text{desired}}', name: 'Desired phase angle', unit: '°', tolerance: { absolute: 0.5, wrap: 360 }, unitType: 'angle' },
            { key: 'wt', tex: 'WT', name: 'Wait time, first opportunity', unit: 's', tolerance: { relative: 0.01 }, unitType: 'time_s' },
            { key: 'tof_total', tex: 'TOF_{\\text{total}}', name: 'Total time', unit: 's', tolerance: { relative: 0.01 }, unitType: 'time_s' }
        ];

        const leadNote = phiRaw < 0
            ? `At the burn, the target must lead the chase by $180^\\circ - \\nu_{\\text{travel}} = ${(-phiRaw).toFixed(2)}°$. Measured from the target to the chase, in the direction of motion, that is $${phiD.toFixed(2)}°$.`
            : `At the burn, the chase must lead the target by $${phiD.toFixed(2)}°$.`;
        const waitNote = chaseLower
            ? `The chase is lower and faster, so $\\phi$ grows and the drift rate is positive. Laps are added until the change is positive and less than $360°$: that is the first opportunity.`
            : `The chase is higher and slower, so $\\phi$ shrinks and the drift rate is negative. Laps are subtracted until the change is negative and less than $360°$ in size: that is the first opportunity.`;

        const steps = [
            {
                key: 'motions',
                title: prose('Mean motions, $n_{\\text{chase}}$ and $n_{\\text{target}}$'),
                result: math(`n_{\\text{chase}} - n_{\\text{target}} = ${degRate((n_chase - n_target))}°\\text{/s}`),
                caption: prose(`<b>Mean motions.</b> The ${chaseLower ? 'chase is lower, so it is faster' : 'chase is higher, so it is slower'}. The phase angle $\\phi$ changes at the drift rate, $n_{\\text{chase}} - n_{\\text{target}}$.`),
                methods: [{
                    name: 'Formula',
                    html: calc('n_{\\text{chase}} = \\sqrt{\\dfrac{\\mu}{R_{\\text{chase}}^3}}', [
                        `\\sqrt{\\dfrac{${MU_TEX}}{(${km(Rchase)})^3}}`
                    ], `${sci(n_chase)}\\text{ rad/s} = ${degRate(n_chase)}°\\text{/s}`)
                        + calc('n_{\\text{target}} = \\sqrt{\\dfrac{\\mu}{R_{\\text{target}}^3}}', [
                            `\\sqrt{\\dfrac{${MU_TEX}}{(${km(Rtarget)})^3}}`
                        ], `${sci(n_target)}\\text{ rad/s} = ${degRate(n_target)}°\\text{/s}`)
                        + calc('\\omega_{\\text{drift}} = n_{\\text{chase}} - n_{\\text{target}}', [
                            `${degRate(n_chase)} - ${degRate(n_target)}`
                        ], `${degRate(n_chase - n_target)}°\\text{/s}`)
                        + note('Keep the units together: degrees with °/s, or radians with rad/s.')
                }]
            },
            {
                key: 'synodic',
                title: prose('Synodic period, $T_{\\text{syn}}$'),
                result: math(`T_{\\text{syn}} = ${group(T_syn, 1)}\\text{ s}`),
                caption: prose('<b>Synodic period.</b> Each time the faster spacecraft gains a full lap on the slower one, the same geometry returns. There is one rendezvous opportunity per $T_{\\text{syn}}$.'),
                methods: [{
                    name: 'Formula',
                    html: calc('T_{\\text{syn}} = \\dfrac{360^\\circ}{|n_{\\text{chase}} - n_{\\text{target}}|}', [
                        `\\dfrac{360^\\circ}{${degRate(Math.abs(n_chase - n_target))}°\\text{/s}}`
                    ], timeTex(T_syn))
                        + note('The time between rendezvous opportunities.')
                }]
            },
            {
                key: 'transfer',
                title: prose('Transfer time, $TOF$'),
                result: math(`TOF = ${group(TOF, 1)}\\text{ s}`),
                caption: prose(`<b>Transfer.</b> The chase flies half of the transfer ellipse, ${chaseLower ? 'out' : 'down'} to the target's orbit, in $TOF$.`),
                methods: [{
                    name: 'Formula',
                    html: calc('a_{\\text{transfer}} = \\dfrac{R_{\\text{chase}} + R_{\\text{target}}}{2}', [
                        `\\dfrac{${km(Rchase)} + ${km(Rtarget)}}{2}`
                    ], `${group(a_transfer, 1)}\\text{ km}`)
                        + calc('TOF = \\dfrac{\\text{Period}_{\\text{transfer}}}{2} = \\pi\\sqrt{\\dfrac{a_{\\text{transfer}}^3}{\\mu}}', [
                            `\\pi\\sqrt{\\dfrac{(${group(a_transfer, 1)})^3}{${MU_TEX}}}`
                        ], timeTex(TOF))
                        + note('A Hohmann transfer is half of an ellipse, so the chase travels exactly $180°$ during it.')
                }]
            },
            {
                key: 'travel',
                title: prose('Target travel, $\\nu_{\\text{travel}}$'),
                result: math(`\\nu_{\\text{travel}} = ${nu_travel_deg.toFixed(2)}°`),
                caption: prose('<b>Target travel.</b> While the chase flies the transfer, the target moves $\\nu_{\\text{travel}}$ along its orbit.'),
                methods: [{
                    name: 'Formula',
                    html: calc('\\nu_{\\text{travel}} = n_{\\text{target}} \\cdot TOF', [
                        `(${degRate(n_target)}°\\text{/s})(${group(TOF, 1)}\\text{ s})`
                    ], `${nu_travel_deg.toFixed(2)}°`)
                        + note('Distance = rate × time, with the target’s mean motion as the rate.')
                }]
            },
            {
                key: 'desired',
                title: prose('Desired phase angle, $\\phi_{\\text{desired}}$'),
                result: math(`\\phi_{\\text{desired}} = ${phiD.toFixed(2)}°`),
                caption: prose('<b>Desired phase angle.</b> At the departure burn, the phase angle must be $\\phi_{\\text{desired}}$. Then the target reaches the far end of the transfer just as the chase does.'),
                methods: [{
                    name: 'Formula',
                    html: calc('\\phi_{\\text{desired}} = \\nu_{\\text{travel}} - 180^\\circ', phiRaw < 0
                        ? [`${nu_travel_deg.toFixed(2)}° - 180°`, `${phiRaw.toFixed(2)}° + 360°`]
                        : [`${nu_travel_deg.toFixed(2)}° - 180°`], `${phiD.toFixed(2)}°`)
                        + note(leadNote)
                }]
            },
            {
                key: 'wait',
                title: prose('Wait time, $WT$'),
                result: math(`WT = ${group(WT, 1)}\\text{ s}`),
                caption: prose('<b>Wait time.</b> The chase coasts on its orbit while $\\phi$ drifts from $\\phi_0$ to $\\phi_{\\text{desired}}$. Then it makes the first burn.'),
                methods: [{
                    name: 'Formula',
                    html: calc('WT = \\dfrac{\\phi_{\\text{desired}} - \\phi_0 \\pm k(360^\\circ)}{n_{\\text{chase}} - n_{\\text{target}}}', [
                        `\\dfrac{${phiD.toFixed(2)}° - ${phi0}°${lapTex}}{${degRate(n_chase - n_target)}°\\text{/s}}`,
                        `\\dfrac{${change.toFixed(2)}°}{${degRate(n_chase - n_target)}°\\text{/s}}`
                    ], timeTex(WT))
                        + note(waitNote)
                        + note(`Check: the wait is shorter than one synodic period, $${group(T_syn, 1)}\\text{ s}$.`)
                }]
            },
            {
                key: 'total',
                title: prose('Total time, $TOF_{\\text{total}}$'),
                result: math(`TOF_{\\text{total}} = ${group(TOF_total, 1)}\\text{ s}`),
                caption: prose('<b>Rendezvous.</b> Wait, then transfer: the chase and the target meet at the far end of the transfer.'),
                methods: [{
                    name: 'Formula',
                    html: calc('TOF_{\\text{total}} = WT + TOF', [
                        `${group(WT, 1)} + ${group(TOF, 1)}`
                    ], timeTex(TOF_total))
                }]
            }
        ];

        return {
            type: 'coplanar',
            model: m,
            title: 'Coplanar Rendezvous',
            prompt: prose('The chase and the target are on circular orbits in the same plane. The chase waits for the right phase angle, then flies a Hohmann transfer to meet the target. Find the synodic period, the transfer time, the target’s travel during the transfer, the desired phase angle, the wait for the first opportunity, and the total time.'),
            statement: item(`R_{\\text{chase}} = ${km(Rchase)}\\text{ km}`) + item(`R_{\\text{target}} = ${km(Rtarget)}\\text{ km}`) + item(`\\phi_0 = ${phi0}°`),
            overviewCaption: prose(`<b>The problem as given.</b> The chase is on the ${chaseLower ? 'inner' : 'outer'} orbit and the target on the ${chaseLower ? 'outer' : 'inner'} one, in the same plane. $\\phi_0$ is measured from the target to the chase, in the direction of motion.`),
            limitsHtml: prose(`Accepted: $T_{\\text{syn}}$, $WT$, and $TOF_{\\text{total}}$ within 1%, $TOF$ within 0.5% (${TIME_FORMS}), $\\nu_{\\text{travel}}$ and $\\phi_{\\text{desired}}$ within 0.5°. $\\phi_{\\text{desired}}$ may be given as a negative angle. ${MU_NOTE}`),
            fields,
            answers,
            steps
        };
    }

    /* ------------------------------------------------------------------ */
    /* Co-orbital Rendezvous                                              */
    /* ------------------------------------------------------------------ */
    function coorbitalModel() {
        for (let tries = 0; tries < 200; tries++) {
            const R = snap(between(SHARED_RADIUS));
            const phi0 = angleBetween(10, 350);
            if (phi0 === 180) continue;     // Neither ahead nor behind
            const k = pick(PHASING_ORBITS);
            const m = RM.solveCoOrbital({ Rchase: R, phi0, k, mu: MU, rEarth: R_EARTH });
            if (m.h_p >= PERIGEE_FLOOR) return m;
        }
        // The lesson's Practice Problem
        return RM.solveCoOrbital({ Rchase: 7000, phi0: 20, k: 1, mu: MU, rEarth: R_EARTH });
    }

    function coorbitalProblem() {
        const m = coorbitalModel();
        const { Rchase: R, phi0, phi_eff_deg, isBehind, k, n_target, nu_travel_deg, Period_phasing, TOF_rendezvous, a_phasing, V_chase, V_phasing, dv1, dv_total, r_p, r_a, h_p } = m;
        const nu = nu_travel_deg;

        // The burn is the difference of the two speeds as written, as in the lesson
        const vc = V_chase.toFixed(5);
        const vp = V_phasing.toFixed(5);
        const dvShown = Number(vp) - Number(vc);
        const safe = h_p > MIN_ALT;

        const answers = {
            nu: { value: nu, text: `${nu.toFixed(2)}°` },
            tof: { value: TOF_rendezvous, text: timeText(TOF_rendezvous) },
            a_ph: { value: a_phasing, text: `${group(a_phasing, 1)} km` },
            h_p: { value: h_p, text: `${group(h_p, 1)} km` },
            dv1: { value: dv1, text: `${signed(dv1, 4)} km/s (${signed(dv1 * 1000, 1)} m/s)` },
            dv_total: { value: dv_total, text: `${dv_total.toFixed(4)} km/s (${(dv_total * 1000).toFixed(1)} m/s)` }
        };

        const fields = [
            { key: 'nu', tex: '\\nu_{\\text{travel}}', name: 'Target travel, one phasing orbit', unit: '°', tolerance: { absolute: 0.5 }, unitType: 'angle' },
            { key: 'tof', tex: 'TOF_{\\text{rendezvous}}', name: 'Time to rendezvous', unit: 's', tolerance: { relative: 0.005 }, unitType: 'time_s' },
            { key: 'a_ph', tex: 'a_{\\text{phasing}}', name: 'Phasing orbit size', unit: 'km', tolerance: { relative: 0.005 }, unitType: 'dist' },
            { key: 'h_p', tex: 'h_p', name: 'Perigee altitude', unit: 'km', tolerance: { absolute: 10 }, unitType: 'dist' },
            { key: 'dv1', tex: '\\Delta V_1', name: 'First burn, with its sign', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'dv_total', tex: '\\Delta V_{\\text{total}}', name: 'Total', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' }
        ];

        const kText = k === 1 ? 'one phasing orbit' : `${k} phasing orbits`;
        const geometry = isBehind
            ? rule(`$\\phi_0 = ${phi0}°$ is more than $180°$, so the chase is <b>behind</b> the target. Rule of thumb: use the negative angle.`, `$\\phi_0 = ${phi0}° - 360° = ${phi_eff_deg}°$`)
            : rule(`$\\phi_0 = ${phi0}°$ is less than $180°$, so the chase is <b>ahead of</b> the target.`);

        const perigeeWork = isBehind
            ? rule('The burn point is the apogee of the smaller phasing orbit, so $r_a = R$.')
                + calc('r_p = 2a_{\\text{phasing}} - R', [`2(${group(a_phasing, 2)}) - ${km(R)}`], `${group(r_p, 2)}\\text{ km}`)
                + calc('h_p = r_p - R_\\oplus', [`${group(r_p, 2)} - ${km(R_EARTH)}`], `${group(h_p, 2)}\\text{ km}`)
            : rule('The burn point is the perigee of the larger phasing orbit, so $r_p = R$.')
                + calc('h_p = r_p - R_\\oplus', [`${km(R)} - ${km(R_EARTH)}`], `${group(h_p, 2)}\\text{ km}`)
                + note(`Apogee: $r_a = 2a_{\\text{phasing}} - R = ${group(r_a, 1)}\\text{ km}$.`);
        const verdict = safe
            ? `Safe: perigee is more than ${MIN_ALT} km above the surface.`
            : `Too low: perigee is less than ${MIN_ALT} km above the surface, inside the atmosphere. In practice, choose more phasing orbits (a larger $k$).`;

        const steps = [
            {
                key: 'nu',
                title: prose('Target travel, $\\nu_{\\text{travel}}$'),
                result: math(`\\nu_{\\text{travel}} = ${nu.toFixed(2)}°`),
                caption: prose(`<b>Target travel.</b> During each phasing orbit, the target moves $\\nu_{\\text{travel}}$ along the shared orbit. The chase is ${isBehind ? 'behind, so that is less than a full lap' : 'ahead, so that is more than a full lap'}.`),
                methods: [{
                    name: 'Formula',
                    html: geometry
                        + calc('\\nu_{\\text{travel}} = 360^\\circ + \\dfrac{\\phi_0}{k}', [
                            `360° + \\dfrac{${phi_eff_deg}°}{${k}}`
                        ], `${nu.toFixed(2)}°`)
                        + note(isBehind
                            ? 'The target needs less than a full lap to reach the chase, so the chase flies a smaller, faster phasing orbit.'
                            : 'The target goes all the way around and then some, so the chase flies a larger, slower phasing orbit.')
                }]
            },
            {
                key: 'period',
                title: prose('Phasing period and $TOF_{\\text{rendezvous}}$'),
                result: math(`TOF = ${group(TOF_rendezvous, 1)}\\text{ s}`),
                caption: prose(`<b>Phasing.</b> The chase flies ${kText} while the target travels ${k === 1 ? '$\\nu_{\\text{travel}}$' : `$${k}\\,\\nu_{\\text{travel}}$`}, so they both arrive back at the burn point together.`),
                methods: [{
                    name: 'Formula',
                    html: calc('n_{\\text{target}} = \\sqrt{\\dfrac{\\mu}{R^3}}', [
                        `\\sqrt{\\dfrac{${MU_TEX}}{(${km(R)})^3}}`
                    ], `${sci(n_target)}\\text{ rad/s} = ${degRate(n_target)}°\\text{/s}`)
                        + calc('\\text{Period}_{\\text{phasing}} = \\dfrac{\\nu_{\\text{travel}}}{n_{\\text{target}}}', [
                            `\\dfrac{${nu.toFixed(2)}°}{${degRate(n_target)}°\\text{/s}}`
                        ], timeTex(Period_phasing))
                        + calc('TOF_{\\text{rendezvous}} = k \\cdot \\text{Period}_{\\text{phasing}}', [
                            `${k} \\times ${group(Period_phasing, 1)}\\text{ s}`
                        ], timeTex(TOF_rendezvous))
                        + note('Keep the units together: degrees with °/s, or radians with rad/s.')
                }]
            },
            {
                key: 'size',
                title: prose('Phasing orbit size, $a_{\\text{phasing}}$'),
                result: math(`a_{\\text{phasing}} = ${group(a_phasing, 1)}\\text{ km}`),
                caption: prose(`<b>Phasing orbit.</b> Its period sets its size. It is ${isBehind ? 'smaller than the shared orbit, so the chase goes around faster and catches up' : 'larger than the shared orbit, so the chase goes around slower and the target catches up'}.`),
                methods: [{
                    name: 'Formula',
                    html: calc('a_{\\text{phasing}} = \\sqrt[3]{\\mu\\left(\\dfrac{\\text{Period}_{\\text{phasing}}}{2\\pi}\\right)^2}', [
                        `\\sqrt[3]{${MU_TEX}\\left(\\dfrac{${group(Period_phasing, 2)}}{2\\pi}\\right)^2}`
                    ], `${group(a_phasing, 2)}\\text{ km}`)
                        + note(`Compare with the shared orbit, $R = ${km(R)}\\text{ km}$: the phasing orbit is ${isBehind ? 'smaller' : 'larger'}.`)
                }]
            },
            {
                key: 'perigee',
                title: prose('Perigee check, $h_p$'),
                result: math(`h_p = ${group(h_p, 1)}\\text{ km}`),
                caption: prose(`<b>Perigee check.</b> ${isBehind ? 'The smaller phasing orbit dips toward Earth on the far side.' : 'The larger phasing orbit is lowest at the burn point.'} Check that perigee is not too low.`),
                methods: [{
                    name: 'Formula',
                    html: perigeeWork + note(verdict)
                }]
            },
            {
                key: 'burn',
                title: prose('Phasing burns, $\\Delta V$'),
                result: math(`\\Delta V_1 = ${signed(dv1, 4)}\\text{ km/s}`),
                caption: prose(`<b>Burns.</b> A ${dv1 >= 0 ? 'posigrade' : 'retrograde'} burn, $\\Delta V_1$, puts the chase on the phasing orbit. After ${kText}, $\\Delta V_2 = -\\Delta V_1$ puts it back on the circle, next to the target.`),
                methods: [{
                    name: 'Formula',
                    html: calc('V_{\\text{chase}} = \\sqrt{\\dfrac{\\mu}{R}}', [
                        `\\sqrt{\\dfrac{${MU_TEX}}{${km(R)}}}`
                    ], `${vc}\\text{ km/s}`)
                        + calc('V_{\\text{phasing}} = \\sqrt{\\mu\\left(\\dfrac{2}{R} - \\dfrac{1}{a_{\\text{phasing}}}\\right)}', [
                            `\\sqrt{${MU_TEX}\\left(\\dfrac{2}{${km(R)}} - \\dfrac{1}{${group(a_phasing, 2)}}\\right)}`
                        ], `${vp}\\text{ km/s}`)
                        + calc('\\Delta V_1 = V_{\\text{phasing}} - V_{\\text{chase}}', [
                            `${vp} - ${vc}`
                        ], `${signed(dvShown, 5)}\\text{ km/s} = ${signed(dvShown * 1000, 2)}\\text{ m/s}`)
                        + calc('\\Delta V_{\\text{total}} = 2\\,|\\Delta V_1|', [
                            `2(${Math.abs(dvShown).toFixed(5)})`
                        ], `${(2 * Math.abs(dvShown)).toFixed(5)}\\text{ km/s} = ${(2000 * Math.abs(dvShown)).toFixed(2)}\\text{ m/s}`)
                        + note(dv1 >= 0
                            ? 'Positive: a <b>posigrade</b> burn, along the velocity, raises the orbit. The arrival burn, $\\Delta V_2 = -\\Delta V_1$, is retrograde.'
                            : 'Negative: a <b>retrograde</b> burn, against the velocity, lowers the orbit. The arrival burn, $\\Delta V_2 = -\\Delta V_1$, is posigrade.')
                }]
            }
        ];

        return {
            type: 'coorbital',
            model: m,
            title: 'Co-orbital Rendezvous',
            prompt: prose(`The chase and the target share one circular orbit. The chase flies ${kText} and meets the target where it started. Find the target’s travel during one phasing orbit, the time to rendezvous, the phasing orbit’s size, its perigee altitude, the first burn, and the total $\\Delta V$.`),
            statement: item(`R = ${km(R)}\\text{ km}`) + item(`\\phi_0 = ${phi0}°`) + item(`k = ${k}`) + item(`R_\\oplus = ${km(R_EARTH)}\\text{ km}`),
            overviewCaption: prose('<b>The problem as given.</b> The chase and the target share one circular orbit. $\\phi_0$ is measured from the target to the chase, in the direction of motion.'),
            limitsHtml: prose(`Accepted: $\\nu_{\\text{travel}}$ within 0.5°, $TOF_{\\text{rendezvous}}$ within 0.5% (${TIME_FORMS}), $a_{\\text{phasing}}$ within 0.5%, $h_p$ within 10 km, each $\\Delta V$ within 2% (km/s or m/s). Give $\\Delta V_1$ its sign: negative for a retrograde burn. ${MU_NOTE}`),
            fields,
            answers,
            steps
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    const GENERATORS = { coplanar: coplanarProblem, coorbital: coorbitalProblem };
    const TYPES = Object.keys(GENERATORS);

    function generate(type) {
        const chosen = GENERATORS[type] ? type : pick(TYPES);
        return GENERATORS[chosen]();
    }

    global.Test1RendezvousProblems = {
        constants: { MU, R_EARTH, MIN_ALT },
        types: TYPES,
        generate,
        grade,
        parseSeconds
    };
})(typeof window !== 'undefined' ? window : globalThis);
