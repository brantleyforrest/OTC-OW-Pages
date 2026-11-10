// Problem definitions, generators, and math walkthroughs for Orbital Maneuvers:
// Hohmann Transfers and Simple Plane Changes (Inclination and Polar Orbit RAAN).
// Strictly adheres to the fundamental formulas taught in class:
//   Hohmann: a_tx = (R1 + R2)/2, V = sqrt(mu/R), V_tx = sqrt(mu * (2/r - 1/a_tx)),
//            Delta V1 = |V_tx1 - V1|, Delta V2 = |V2 - V_tx2|, Delta V_total = Delta V1 + Delta V2,
//            TOF = pi * sqrt(a_tx^3 / mu).
//   Plane Change: V = sqrt(mu / r), Delta_theta = |Delta_i| (or |Delta_Omega| for polar orbits),
//                 Delta V = 2 * V * sin(Delta_theta / 2).
//   Combined Plane Change: Hohmann speeds, with the burn at the higher orbit using the law of cosines:
//                 Delta V = sqrt(V_initial^2 + V_final^2 - 2 * V_initial * V_final * cos(theta)).
// Load as a classic script.
(function (global) {
    'use strict';

    const { math, prose, column, calc, note, rule } = global.PracticeMath;

    const MU = 398600.4418;     // Earth gravitational parameter (km^3/s^2)
    const R_EARTH = 6378.137;   // Earth equatorial radius (km)
    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;

    // Formatting helpers
    const fixed = (val, d = 3) => {
        if (!Number.isFinite(val)) return '0';
        return Number(val).toFixed(d);
    };
    const formatNum = (val, d = 2) => {
        if (!Number.isFinite(val)) return '0';
        const s = Number(val).toFixed(d);
        const parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    };
    const deg = (degVal) => `${fixed(degVal, 1)}°`;

    /* ------------------------------------------------------------------ */
    /* Tolerant Answer Evaluation                                         */
    /* Handles km/s vs m/s automatically, as well as degree symbols and   */
    /* minute units.                                                      */
    /* ------------------------------------------------------------------ */
    const UNIT_SCALE = {
        speed_kms: { 'km/s': 1, 'm/s': 0.001, 'meters/s': 0.001 },
        dist: { km: 1, meters: 0.001 },
        time: { min: 1, mins: 1, minutes: 1, s: 1 / 60, sec: 1 / 60, seconds: 1 / 60 },
        angle: { deg: 1, degrees: 1, '°': 1 }
    };

    function customGrade(tolerance, text, truth, unitType) {
        if (!String(text).trim()) return 'blank';
        let s = String(text).trim().toLowerCase();
        let unit = '';
        s = s.replace(/[−–]/g, '-')
            .replace(/(km\/s|m\/s|km|meters\/s|meters|deg|degrees|°|min|mins|minutes|s|sec|seconds)\s*$/, (match, found) => {
                unit = found;
                return '';
            })
            .replace(/\s+/g, '');
        if (/^[-+]?\d{1,3}(,\d{3})+(?!\d)/.test(s)) s = s.replace(/,/g, '');
        else s = s.replace(',', '.');
        // A time may be typed as h:mm:ss, the form used on the slides
        const hms = unitType === 'time' && s.match(/^(\d+):(\d{2}):(\d{2})$/);
        if (hms) s = String(Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60);
        s = s.replace(/[x×*]10(\^|\*\*)?/, 'e');
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return 'invalid';

        let val = Number(s);
        if (!Number.isFinite(val)) return 'invalid';

        // A typed unit is converted to the field's unit. A unit that cannot apply to the field is wrong.
        if (unit) {
            const scale = (UNIT_SCALE[unitType] || {})[unit];
            if (scale === undefined) return 'wrong';
            val *= scale;
        }

        // Check primary value
        const allowed = tolerance.relative ? Math.abs(truth) * tolerance.relative : tolerance.absolute;
        const diff = Math.abs(val - truth);
        if (diff <= allowed + 1e-9) return 'right';

        // With no unit typed, a speed may be in m/s (e.g. 120 for a truth of 0.120 km/s)
        if (!unit && unitType === 'speed_kms' && Math.abs(val / 1000 - truth) <= allowed + 1e-9) {
            return 'right';
        }
        // If angle with wrap
        if (tolerance.wrap) {
            const gap = Math.abs(val - truth);
            const rem = gap % tolerance.wrap;
            if (Math.min(rem, tolerance.wrap - rem) <= allowed + 1e-9) return 'right';
        }

        return 'wrong';
    }

    /* ------------------------------------------------------------------ */
    /* 1. HOHMANN TRANSFER SOLVER & GENERATOR                             */
    /* ------------------------------------------------------------------ */
    function solveHohmann(R1, R2) {
        const a1 = R1;
        const a2 = R2;
        const a_tx = (R1 + R2) / 2;

        const v1 = Math.sqrt(MU / R1);
        const v_tx1 = Math.sqrt(MU * (2 / R1 - 1 / a_tx));
        const dv1 = Math.abs(v_tx1 - v1);

        const v_tx2 = Math.sqrt(MU * (2 / R2 - 1 / a_tx));
        const v2 = Math.sqrt(MU / R2);
        const dv2 = Math.abs(v2 - v_tx2);

        const dv_total = dv1 + dv2;
        const tof_s = Math.PI * Math.sqrt(Math.pow(a_tx, 3) / MU);
        const tof_min = tof_s / 60;

        const isRaise = R2 >= R1;

        return {
            type: 'hohmann',
            R1,
            R2,
            a1,
            a2,
            a_tx,
            v1,
            v_tx1,
            dv1,
            v_tx2,
            v2,
            dv2,
            dv_total,
            tof_s,
            tof_min,
            isRaise
        };
    }

    function buildHohmannProblem(data, isLectureExample = false) {
        const { R1, R2, a1, a2, a_tx, v1, v_tx1, dv1, v_tx2, v2, dv2, dv_total, tof_s, tof_min, isRaise } = data;

        const dv1_ms = dv1 * 1000;
        const dv2_ms = dv2 * 1000;
        const dv_total_ms = dv_total * 1000;

        const title = isLectureExample ? 'Lecture Slide Example #2: Hohmann Transfer' : (isRaise ? 'Hohmann Transfer: Orbit Raise' : 'Hohmann Transfer: Orbit Lowering');
        const prompt = `Calculate the transfer orbit semi-major axis, burn impulse $\\Delta V_1$, burn impulse $\\Delta V_2$, total $\\Delta V$, and transfer time (TOF) to transfer between the two coplanar circular orbits.`;

        const statement = `
            <div class="given-item"><b>Initial Orbit:</b> $R_1 = ${formatNum(R1, 0)}\\text{ km}$</div>
            <div class="given-item"><b>Target Orbit:</b> $R_2 = ${formatNum(R2, 0)}\\text{ km}$</div>
            <div class="given-item"><b>Type:</b> ${isRaise ? 'Coplanar orbit raising' : 'Coplanar orbit lowering'}</div>
        `;

        const answers = {
            a_tx: { value: a_tx, text: `${formatNum(a_tx, 1)} km`, unitType: 'dist' },
            dv1: { value: dv1, text: `${fixed(dv1, 3)} km/s (${Math.round(dv1_ms)} m/s)`, unitType: 'speed_kms' },
            dv2: { value: dv2, text: `${fixed(dv2, 3)} km/s (${Math.round(dv2_ms)} m/s)`, unitType: 'speed_kms' },
            dv_total: { value: dv_total, text: `${fixed(dv_total, 3)} km/s (${Math.round(dv_total_ms)} m/s)`, unitType: 'speed_kms' },
            tof: { value: tof_min, text: `${fixed(tof_min, 1)} min (${Math.round(tof_s)} s)`, unitType: 'time' }
        };

        const fields = [
            { key: 'a_tx', tex: 'a_{tx}', name: 'Transfer semi-major axis', unit: 'km', tolerance: { relative: 0.005 }, unitType: 'dist' },
            { key: 'dv1', tex: '\\Delta V_1', name: 'Burn 1 $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'dv2', tex: '\\Delta V_2', name: 'Burn 2 $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'dv_total', tex: '\\Delta V_{total}', name: 'Total $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'tof', tex: 'TOF', name: 'Transfer Time', unit: 'min', tolerance: { relative: 0.015 }, unitType: 'time' }
        ];

        // 5-column table matching lecture slide #2
        const tableHtml = transferTable(data, {
            digits: 4,
            before: 'have',
            after: 'want',
            dv1: fixed(dv1, 3),
            dv2: fixed(dv2, 3),
            total: fixed(dv_total, 3),
            tof: `${fixed(tof_min, 1)} min`,
            tofDetail: `${Math.round(tof_s)} s`
        });

        const steps = [
            {
                key: 'atx',
                title: 'Transfer Orbit Semi-Major Axis',
                result: math(`a_{tx} = ${formatNum(a_tx, 1)}\\text{ km}`),
                caption: `<b>Transfer Orbit Geometry:</b> The transfer ellipse connects radius $R_1 = ${formatNum(R1, 0)}\\text{ km}$ to $R_2 = ${formatNum(R2, 0)}\\text{ km}$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('a_{\\text{transfer}} = \\frac{R_1 + R_2}{2}', [
                            `\\frac{${formatNum(R1, 0)} + ${formatNum(R2, 0)}}{2}`
                        ], `${formatNum(a_tx, 1)}\\text{ km}`)}
                        ${note(`For any Hohmann transfer between circular orbits, the transfer orbit's major axis is $2a = R_1 + R_2$, so the semi-major axis is simply their average.`)}
                    `
                }]
            },
            {
                key: 'burn1',
                title: 'First Burn at R₁ (ΔV₁)',
                result: math(`\\Delta V_1 = ${fixed(dv1, 3)}\\text{ km/s}`),
                caption: `<b>First Burn at $R_1$:</b> Speed changes from circular $V_1 = ${fixed(v1, 4)}\\text{ km/s}$ to transfer ${isRaise ? 'periapsis' : 'apoapsis'} $V_{tx,1} = ${fixed(v_tx1, 4)}\\text{ km/s}$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('V_1 = \\sqrt{\\frac{\\mu}{R_1}}', [
                            `\\sqrt{\\frac{398{,}600.44}{${formatNum(R1, 0)}}}`
                        ], `${fixed(v1, 4)}\\text{ km/s}`)}
                        ${calc('V_{\\text{transfer}_1} = \\sqrt{\\mu \\left(\\frac{2}{R_1} - \\frac{1}{a_{\\text{tx}}}\\right)}', [
                            `\\sqrt{398{,}600.44 \\left(\\frac{2}{${formatNum(R1, 0)}} - \\frac{1}{${formatNum(a_tx, 1)}}\\right)}`
                        ], `${fixed(v_tx1, 4)}\\text{ km/s}`)}
                        ${calc('\\Delta V_1 = |V_{\\text{transfer}_1} - V_1|', [
                            `|${fixed(v_tx1, 4)} - ${fixed(v1, 4)}|`
                        ], `${fixed(dv1, 3)}\\text{ km/s} = ${Math.round(dv1_ms)}\\text{ m/s}`)}
                        ${note(isRaise ? `This is a <b>prograde burn</b>: increasing speed puts the spacecraft onto the transfer ellipse heading outward.` : `This is a <b>retrograde burn</b>: slowing down drops periapsis inward.`)}
                    `
                }]
            },
            {
                key: 'burn2',
                title: 'Second Burn at R₂ (ΔV₂)',
                result: math(`\\Delta V_2 = ${fixed(dv2, 3)}\\text{ km/s}`),
                caption: `<b>Second Burn at $R_2$:</b> Speed changes from transfer ${isRaise ? 'apoapsis' : 'periapsis'} $V_{tx,2} = ${fixed(v_tx2, 4)}\\text{ km/s}$ to circular $V_2 = ${fixed(v2, 4)}\\text{ km/s}$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('V_{\\text{transfer}_2} = \\sqrt{\\mu \\left(\\frac{2}{R_2} - \\frac{1}{a_{\\text{tx}}}\\right)}', [
                            `\\sqrt{398{,}600.44 \\left(\\frac{2}{${formatNum(R2, 0)}} - \\frac{1}{${formatNum(a_tx, 1)}}\\right)}`
                        ], `${fixed(v_tx2, 4)}\\text{ km/s}`)}
                        ${calc('V_2 = \\sqrt{\\frac{\\mu}{R_2}}', [
                            `\\sqrt{\\frac{398{,}600.44}{${formatNum(R2, 0)}}}`
                        ], `${fixed(v2, 4)}\\text{ km/s}`)}
                        ${calc('\\Delta V_2 = |V_2 - V_{\\text{transfer}_2}|', [
                            `|${fixed(v2, 4)} - ${fixed(v_tx2, 4)}|`
                        ], `${fixed(dv2, 3)}\\text{ km/s} = ${Math.round(dv2_ms)}\\text{ m/s}`)}
                        ${note(isRaise ? `This second <b>prograde burn</b> circularizes the orbit at $R_2$.` : `This second <b>retrograde burn</b> circularizes the orbit at $R_2$.`)}
                    `
                }]
            },
            {
                key: 'dvtotal',
                title: 'Total Delta-V (ΔV_total)',
                result: math(`\\Delta V_{\\text{total}} = ${fixed(dv_total, 3)}\\text{ km/s}`),
                caption: `<b>Total Maneuver Cost:</b> Sum of both impulse burns $\\Delta V_{total} = ${fixed(dv_total, 3)}\\text{ km/s}$ (${Math.round(dv_total_ms)} m/s).`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('\\Delta V_{\\text{total}} = \\Delta V_1 + \\Delta V_2', [
                            `${fixed(dv1, 4)} + ${fixed(dv2, 4)}`
                        ], `${fixed(dv_total, 3)}\\text{ km/s} = ${Math.round(dv_total_ms)}\\text{ m/s}`)}
                    `
                }]
            },
            {
                key: 'tof',
                title: 'Transfer Time (Time of Flight)',
                result: math(`TOF = ${fixed(tof_min, 1)}\\text{ min}`),
                caption: `<b>Transfer Time:</b> Exactly half the period of the transfer ellipse: $TOF = ${fixed(tof_min, 1)}\\text{ min}$ (${Math.round(tof_s)} s).`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('P_{\\text{transfer}} = 2\\pi \\sqrt{\\frac{a_{\\text{tx}}^3}{\\mu}}', [
                            `2\\pi \\sqrt{\\frac{(${formatNum(a_tx, 1)})^3}{398{,}600.44}}`
                        ], `${fixed(tof_s * 2, 1)}\\text{ s}`)}
                        ${calc('TOF = \\frac{P_{\\text{transfer}}}{2} = \\pi \\sqrt{\\frac{a_{\\text{tx}}^3}{\\mu}}', [
                            `\\pi \\sqrt{\\frac{(${formatNum(a_tx, 1)})^3}{398{,}600.44}}`
                        ], `${fixed(tof_s, 1)}\\text{ s} = ${fixed(tof_min, 1)}\\text{ min}`)}
                        ${note(`The Hohmann transfer traverses exactly half of the transfer ellipse (from ${isRaise ? 'periapsis to apoapsis' : 'apoapsis to periapsis'}), so the time of flight is always half the orbital period.`)}
                    `
                }]
            },
            {
                key: 'summary_table',
                title: 'Summary Table (Slide Format)',
                result: math(`\\text{Full 5-Column Solution}`),
                caption: `<b>Classroom 5-Column Format:</b> Complete overview of Position, Size, Velocity, $\\Delta V$, and Summary.`,
                methods: [{
                    name: '5-Column Table',
                    html: `
                        ${prose(tableHtml)}
                        ${note(`This matches the exact 5-column problem template shown in Lecture Slide #2.`)}
                    `
                }]
            }
        ];

        return {
            title,
            prompt,
            statement,
            answers,
            fields,
            steps,
            data,
            limitsHtml: 'Enter values within <b>0.5%</b> for $a_{tx}$, <b>2%</b> for $\\Delta V$ (km/s or m/s), and <b>1.5%</b> for $TOF$ (minutes). $\\Delta V$ is a small difference of two speeds, so keep at least 3 decimals in each speed.'
        };
    }

    /* ------------------------------------------------------------------ */
    /* 2. SIMPLE INCLINATION CHANGE SOLVER & GENERATOR                    */
    /* ------------------------------------------------------------------ */
    function solveInclinationChange(alt, i1, i2, raan = 45, u_sc = 270) {
        const r = R_EARTH + alt;
        const v = Math.sqrt(MU / r);
        const delta_i = Math.abs(i2 - i1);
        const delta_theta = delta_i;
        const dv = 2 * v * Math.sin((delta_theta / 2) * D2R);

        // Period
        const period_s = 2 * Math.PI * Math.sqrt(Math.pow(r, 3) / MU);
        const period_min = period_s / 60;

        // Burn must occur at Ascending Node (u = 0° / 360°) or Descending Node (u = 180°)
        // Determine distance to next node from current spacecraft position u_sc
        const u_norm = ((u_sc % 360) + 360) % 360;
        let next_node = '';
        let next_node_at = '';
        let delta_u_to_node = 0;
        if (u_norm <= 180) {
            next_node = 'Descending Node';
            next_node_at = '180°';
            delta_u_to_node = 180 - u_norm;
        } else {
            next_node = 'Ascending Node';
            next_node_at = '0° / 360°';
            delta_u_to_node = 360 - u_norm;
        }
        const u_burn = u_norm + delta_u_to_node;
        const time_to_burn_s = (delta_u_to_node / 360) * period_s;
        const time_to_burn_min = time_to_burn_s / 60;

        return {
            type: 'inclination',
            alt,
            r,
            v,
            i1,
            i2,
            delta_i,
            delta_theta,
            dv,
            raan,
            u_sc,
            period_s,
            period_min,
            next_node,
            next_node_at,
            delta_u_to_node,
            u_burn,
            time_to_burn_s,
            time_to_burn_min
        };
    }

    function buildInclinationProblem(data, isLectureExample = false) {
        const { alt, r, v, i1, i2, delta_i, delta_theta, dv, raan, u_sc, period_min, next_node, next_node_at, delta_u_to_node, time_to_burn_min } = data;

        let burnNote = `From $u = ${fixed(u_sc, 0)}^\\circ$, the spacecraft reaches the ${next_node} after traveling another $${delta_u_to_node}^\\circ$, where the engine fires.`;
        if (delta_u_to_node === 0) burnNote = `The spacecraft is already at the ${next_node}, so the engine can fire now.`;
        if (isLectureExample) burnNote = `The slide notes that the spacecraft is at 270° from the ascending node. It will reach the ascending node (0°/360°) after traveling another 90°, where the engine fires!`;

        const title = isLectureExample ? 'Lecture Slide Example #1: Simple Plane Change' : 'Simple Plane Change: Inclination';
        const prompt = `Find the orbital speed $V$, plane change angle $\\Delta \\theta$, and required $\\Delta V$ to change the orbit inclination from $${fixed(i1, 1)}^\\circ$ to $${fixed(i2, 1)}^\\circ$.`;

        const statement = `
            <div class="given-item"><b>Altitude:</b> $h = ${formatNum(alt, 0)}\\text{ km}$ (circular)</div>
            <div class="given-item"><b>Initial Inclination:</b> $i_1 = ${fixed(i1, 1)}^\\circ$</div>
            <div class="given-item"><b>Target Inclination:</b> $i_2 = ${fixed(i2, 1)}^\\circ$</div>
            <div class="given-item"><b>RAAN:</b> $\\Omega = ${fixed(raan, 1)}^\\circ$</div>
            <div class="given-item"><b>Current Spacecraft Position:</b> $u = ${fixed(u_sc, 0)}^\\circ$ from ascending node</div>
        `;

        const answers = {
            v: { value: v, text: `${fixed(v, 3)} km/s`, unitType: 'speed_kms' },
            delta_theta: { value: delta_theta, text: `${fixed(delta_theta, 1)}°`, unitType: 'angle' },
            dv: { value: dv, text: `${fixed(dv, 6)} km/s (${Math.round(dv * 1000)} m/s)`, unitType: 'speed_kms' }
        };

        const fields = [
            { key: 'v', tex: 'V', name: 'Circular orbital speed', unit: 'km/s', tolerance: { relative: 0.005 }, unitType: 'speed_kms' },
            { key: 'delta_theta', tex: '\\Delta \\theta', name: 'Plane change angle ($\\Delta i$)', unit: '°', tolerance: { absolute: 0.5 }, unitType: 'angle' },
            { key: 'dv', tex: '\\Delta V', name: 'Required $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.01 }, unitType: 'speed_kms' }
        ];

        const steps = [
            {
                key: 'speed',
                title: 'Orbit Radius & Speed',
                result: math(`V = ${fixed(v, 3)}\\text{ km/s}`),
                caption: `<b>Orbital Speed:</b> Circular velocity at altitude $h = ${formatNum(alt, 0)}\\text{ km}$ ($r = ${formatNum(r, 1)}\\text{ km}$).`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('r = R_{\\text{Earth}} + h', [
                            `6{,}378.14 + ${formatNum(alt, 0)}`
                        ], `${formatNum(r, 1)}\\text{ km}`)}
                        ${calc('V = \\sqrt{\\frac{\\mu}{r}}', [
                            `\\sqrt{\\frac{398{,}600.44}{${formatNum(r, 1)}}}`
                        ], `${fixed(v, 6)}\\text{ km/s} \\approx ${fixed(v, 3)}\\text{ km/s}`)}
                        ${note(`Because the orbit is circular, speed remains constant throughout the orbit.`)}
                    `
                }]
            },
            {
                key: 'angle',
                title: 'Plane Change Angle (Δθ = Δi)',
                result: math(`\\Delta \\theta = ${fixed(delta_theta, 1)}^\\circ`),
                caption: `<b>Plane Change Angle:</b> Pure inclination change with constant RAAN means $\\Delta \\theta = |i_2 - i_1| = ${fixed(delta_theta, 1)}^\\circ$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('\\Delta \\theta = \\Delta i = |i_2 - i_1|', [
                            `|${fixed(i2, 1)}^\\circ - ${fixed(i1, 1)}^\\circ|`
                        ], `${fixed(delta_theta, 1)}^\\circ`)}
                        ${note(`When changing inclination alone (without changing the longitude of the ascending node), the planes intersect along the line of nodes, and the angle between the planes is exactly $\\Delta i$.`)}
                    `
                }]
            },
            {
                key: 'dv',
                title: 'Required Delta-V Impulse',
                result: math(`\\Delta V = ${fixed(dv, 6)}\\text{ km/s}`),
                caption: `<b>Simple Plane Change Formula:</b> $\\Delta V = 2 V \\sin(\\Delta \\theta / 2) = ${fixed(dv, 6)}\\text{ km/s}$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('\\Delta V = 2 V \\sin\\left(\\frac{\\Delta \\theta}{2}\\right)', [
                            `2 (${fixed(v, 6)}) \\sin\\left(\\frac{${fixed(delta_theta, 1)}^\\circ}{2}\\right)`,
                            `2 (${fixed(v, 6)}) \\sin(${fixed(delta_theta / 2, 2)}^\\circ)`
                        ], `${fixed(dv, 6)}\\text{ km/s} \\approx ${fixed(dv, 3)}\\text{ km/s} \\; (${Math.round(dv * 1000)}\\text{ m/s})`)}
                        ${note(isLectureExample ? `Notice this matches the slide's answer of <b>3.541495 km/s</b> exactly!` : `Plane changes require significant $\\Delta V$ because they turn the large velocity vector of the spacecraft.`)}
                    `
                }]
            },
            {
                key: 'location',
                title: 'Burn Location & Timing',
                result: math(`u_{\\text{burn}} = \\text{Node line}`),
                caption: `<b>Where to Burn:</b> Plane change must occur at a node line intersection (Ascending or Descending node). Current position $u = ${fixed(u_sc, 0)}^\\circ$.`,
                methods: [{
                    name: 'Geometry Explanation',
                    html: `
                        ${rule(`Two orbits with the same RAAN but different inclinations intersect exclusively along the <b>line of nodes</b>. Therefore, the plane change burn MUST occur at either the Ascending Node ($0^\\circ$) or the Descending Node ($180^\\circ$).`)}
                        ${calc('\\Delta u = u_{\\text{burn}} - u_{\\text{current}}', [
                            `\\text{Next node is ${next_node} } (${next_node_at})`,
                            `${delta_u_to_node}^\\circ \\text{ travel angle remaining}`
                        ], `\\Delta u = ${delta_u_to_node}^\\circ`)}
                        ${calc('t_{\\text{burn}} = \\left(\\frac{\\Delta u}{360^\\circ}\\right) P', [
                            `\\left(\\frac{${delta_u_to_node}^\\circ}{360^\\circ}\\right) (${fixed(period_min, 1)}\\text{ min})`
                        ], `${fixed(time_to_burn_min, 1)}\\text{ min}`)}
                        ${note(burnNote)}
                    `
                }]
            }
        ];

        return {
            title,
            prompt,
            statement,
            answers,
            fields,
            steps,
            data,
            limitsHtml: 'Enter speed within <b>0.5%</b>, angle within <b>0.5°</b>, and $\\Delta V$ within <b>1%</b> (km/s or m/s).'
        };
    }

    /* ------------------------------------------------------------------ */
    /* 3. POLAR ORBIT RAAN CHANGE SOLVER & GENERATOR                      */
    /* ------------------------------------------------------------------ */
    function solvePolarRaanChange(alt, raan1, raan2, u_sc = 30) {
        const r = R_EARTH + alt;
        const v = Math.sqrt(MU / r);
        const delta_raan = Math.abs(raan2 - raan1);
        const delta_theta = delta_raan;
        const dv = 2 * v * Math.sin((delta_theta / 2) * D2R);

        const period_s = 2 * Math.PI * Math.sqrt(Math.pow(r, 3) / MU);
        const period_min = period_s / 60;

        // Polar planes intersect along Earth's spin axis (the North and South poles).
        // North Pole is at u = 90°, South Pole is at u = 270°.
        const u_norm = ((u_sc % 360) + 360) % 360;
        let next_pole = '';
        let next_pole_at = '';
        let delta_u_to_pole = 0;
        if (u_norm <= 90) {
            next_pole = 'North Pole';
            next_pole_at = 'u = 90°';
            delta_u_to_pole = 90 - u_norm;
        } else if (u_norm <= 270) {
            next_pole = 'South Pole';
            next_pole_at = 'u = 270°';
            delta_u_to_pole = 270 - u_norm;
        } else {
            next_pole = 'North Pole';
            next_pole_at = 'u = 90°';
            delta_u_to_pole = 360 - u_norm + 90;
        }
        const u_burn = u_norm + delta_u_to_pole;
        const time_to_burn_min = (delta_u_to_pole / 360) * period_min;

        return {
            type: 'polar_raan',
            alt,
            r,
            v,
            i: 90,
            raan1,
            raan2,
            delta_raan,
            delta_theta,
            dv,
            u_sc,
            period_s,
            period_min,
            next_pole,
            next_pole_at,
            delta_u_to_pole,
            u_burn,
            time_to_burn_min
        };
    }

    function buildPolarRaanProblem(data, isLectureExample = false) {
        const { alt, r, v, raan1, raan2, delta_raan, delta_theta, dv, u_sc, period_min, next_pole, next_pole_at, delta_u_to_pole, time_to_burn_min } = data;

        const title = isLectureExample ? 'Polar Orbit RAAN Change' : 'Polar Orbit Plane Change (Changing RAAN)';
        const prompt = `For a polar orbit ($i = 90^\\circ$), find the orbital speed $V$, plane change angle $\\Delta \\theta$, and $\\Delta V$ needed to shift the RAAN from $\\Omega_1 = ${fixed(raan1, 1)}^\\circ$ to $\\Omega_2 = ${fixed(raan2, 1)}^\\circ$.`;

        const statement = `
            <div class="given-item"><b>Orbit Type:</b> Polar circular ($i = 90^\\circ$)</div>
            <div class="given-item"><b>Altitude:</b> $h = ${formatNum(alt, 0)}\\text{ km}$</div>
            <div class="given-item"><b>Initial RAAN:</b> $\\Omega_1 = ${fixed(raan1, 1)}^\\circ$</div>
            <div class="given-item"><b>Target RAAN:</b> $\\Omega_2 = ${fixed(raan2, 1)}^\\circ$</div>
            <div class="given-item"><b>Current Spacecraft Position:</b> $u = ${fixed(u_sc, 0)}^\\circ$ from ascending node</div>
        `;

        const answers = {
            v: { value: v, text: `${fixed(v, 3)} km/s`, unitType: 'speed_kms' },
            delta_theta: { value: delta_theta, text: `${fixed(delta_theta, 1)}°`, unitType: 'angle' },
            dv: { value: dv, text: `${fixed(dv, 4)} km/s (${Math.round(dv * 1000)} m/s)`, unitType: 'speed_kms' }
        };

        const fields = [
            { key: 'v', tex: 'V', name: 'Circular orbital speed', unit: 'km/s', tolerance: { relative: 0.005 }, unitType: 'speed_kms' },
            { key: 'delta_theta', tex: '\\Delta \\theta', name: 'Plane change angle ($\\Delta \\Omega$)', unit: '°', tolerance: { absolute: 0.5 }, unitType: 'angle' },
            { key: 'dv', tex: '\\Delta V', name: 'Required $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.01 }, unitType: 'speed_kms' }
        ];

        const steps = [
            {
                key: 'speed',
                title: 'Polar Orbit Geometry & Speed',
                result: math(`V = ${fixed(v, 3)}\\text{ km/s}`),
                caption: `<b>Polar Orbit Speed:</b> At $i = 90^\\circ$ and altitude $h = ${formatNum(alt, 0)}\\text{ km}$, circular speed is $V = ${fixed(v, 3)}\\text{ km/s}$.`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('r = R_{\\text{Earth}} + h', [
                            `6{,}378.14 + ${formatNum(alt, 0)}`
                        ], `${formatNum(r, 1)}\\text{ km}`)}
                        ${calc('V = \\sqrt{\\frac{\\mu}{r}}', [
                            `\\sqrt{\\frac{398{,}600.44}{${formatNum(r, 1)}}}`
                        ], `${fixed(v, 3)}\\text{ km/s}`)}
                        ${note(`Every circular orbit at this altitude has this same orbital speed, regardless of inclination or RAAN.`)}
                    `
                }]
            },
            {
                key: 'angle',
                title: 'Plane Change Angle at the Poles',
                result: math(`\\Delta \\theta = ${fixed(delta_theta, 1)}^\\circ`),
                caption: `<b>Angle Between Polar Planes:</b> All polar orbit planes intersect along Earth's spin axis. The angle between them is simply $\\Delta \\Omega = ${fixed(delta_theta, 1)}^\\circ$.`,
                methods: [{
                    name: 'Geometric Principle',
                    html: `
                        ${rule(`Because both orbits pass directly over the North and South poles, the line of intersection between any two polar orbit planes is Earth's <b>polar rotation axis (Z-axis)</b>.`)}
                        ${calc('\\Delta \\theta = \\Delta \\Omega = |\\Omega_2 - \\Omega_1|', [
                            `|${fixed(raan2, 1)}^\\circ - ${fixed(raan1, 1)}^\\circ|`
                        ], `${fixed(delta_theta, 1)}^\\circ`)}
                        ${note(`No complicated spherical trigonometry is required! At the poles, the dihedral angle between polar orbit planes is equal to the difference in their RAAN values: $\\Delta \\theta = \\Delta \\Omega$.`)}
                    `
                }]
            },
            {
                key: 'dv',
                title: 'Required Delta-V Impulse',
                result: math(`\\Delta V = ${fixed(dv, 4)}\\text{ km/s}`),
                caption: `<b>Plane Change Formula:</b> $\\Delta V = 2 V \\sin(\\Delta \\Omega / 2) = ${fixed(dv, 4)}\\text{ km/s}$ (${Math.round(dv * 1000)} m/s).`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('\\Delta V = 2 V \\sin\\left(\\frac{\\Delta \\theta}{2}\\right) = 2 V \\sin\\left(\\frac{\\Delta \\Omega}{2}\\right)', [
                            `2 (${fixed(v, 4)}) \\sin\\left(\\frac{${fixed(delta_theta, 1)}^\\circ}{2}\\right)`,
                            `2 (${fixed(v, 4)}) \\sin(${fixed(delta_theta / 2, 2)}^\\circ)`
                        ], `${fixed(dv, 4)}\\text{ km/s} = ${Math.round(dv * 1000)}\\text{ m/s}`)}
                        ${note(`This is the exact same simple plane change formula, applied at the pole where the velocity vector is rotated by $\\Delta \\Omega$.`)}
                    `
                }]
            },
            {
                key: 'location',
                title: 'Burn Location at the Poles',
                result: math(`u_{\\text{burn}} = 90^\\circ \\text{ or } 270^\\circ`),
                caption: `<b>Where to Burn:</b> The burn MUST occur directly over either the North Pole ($u = 90^\\circ$) or South Pole ($u = 270^\\circ$).`,
                methods: [{
                    name: 'Pole Crossing',
                    html: `
                        ${rule(`In a polar orbit ($i = 90^\\circ$), the satellite crosses the North Pole at argument of latitude $u = 90^\\circ$ and the South Pole at $u = 270^\\circ$. The burn can only be performed at these two crossing points.`)}
                        ${calc('\\Delta u = u_{\\text{pole}} - u_{\\text{current}}', [
                            `\\text{Next crossing is ${next_pole} } (${next_pole_at})`,
                            `${delta_u_to_pole}^\\circ \\text{ travel angle remaining}`
                        ], `\\Delta u = ${delta_u_to_pole}^\\circ`)}
                        ${calc('t_{\\text{burn}} = \\left(\\frac{\\Delta u}{360^\\circ}\\right) P', [
                            `\\left(\\frac{${delta_u_to_pole}^\\circ}{360^\\circ}\\right) (${fixed(period_min, 1)}\\text{ min})`
                        ], `${fixed(time_to_burn_min, 1)}\\text{ min}`)}
                    `
                }]
            }
        ];

        return {
            title,
            prompt,
            statement,
            answers,
            fields,
            steps,
            data,
            limitsHtml: 'Enter speed within <b>0.5%</b>, angle within <b>0.5°</b>, and $\\Delta V$ within <b>1%</b> (km/s or m/s).'
        };
    }

    /* ------------------------------------------------------------------ */
    /* 4. COMBINED PLANE CHANGE SOLVER & GENERATOR                        */
    /* The plane change goes in the burn at the higher of the two orbits, */
    /* where the spacecraft is slowest.                                   */
    /* ------------------------------------------------------------------ */
    function solveCombined(R1, R2, i1, i2) {
        const base = solveHohmann(R1, R2);
        const { v1, v_tx1, v_tx2, v2, isRaise } = base;
        const delta_theta = Math.abs(i2 - i1);
        const theta = delta_theta * D2R;

        const v_initial = isRaise ? v_tx2 : v1;
        const v_final = isRaise ? v2 : v_tx1;
        const dv_combined = Math.sqrt(v_initial * v_initial + v_final * v_final - 2 * v_initial * v_final * Math.cos(theta));
        const dv_separate = 2 * v_initial * Math.sin(theta / 2) + Math.abs(v_final - v_initial);

        const dv1 = isRaise ? base.dv1 : dv_combined;
        const dv2 = isRaise ? dv_combined : base.dv2;

        return {
            ...base,
            type: 'combined',
            i1,
            i2,
            delta_theta,
            v_initial,
            v_final,
            dv_combined,
            dv_separate,
            dv1,
            dv2,
            dv_total: dv1 + dv2
        };
    }

    function formatHms(seconds) {
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    function buildCombinedProblem(data, isLectureExample = false) {
        const { R1, R2, a_tx, v1, v_tx1, v_tx2, v2, dv1, dv2, dv_total, tof_s, tof_min, isRaise, i1, i2, delta_theta, dv_separate, dv_combined } = data;

        const speed = (val) => fixed(val, 5);
        const theta = fixed(delta_theta, 1);
        // The plain burn is shown as the difference of the speeds as displayed, so the subtraction checks by hand.
        const displayedDifference = (a, b) => Math.abs(Number(speed(a)) - Number(speed(b)));
        const dv1Text = speed(isRaise ? displayedDifference(v_tx1, v1) : dv1);
        const dv2Text = speed(isRaise ? dv2 : displayedDifference(v2, v_tx2));
        const dv1_ms = Math.round(dv1 * 1000);
        const dv2_ms = Math.round(dv2 * 1000);
        const dv_total_ms = Math.round(dv_total * 1000);
        const hms = formatHms(tof_s);

        const title = isLectureExample ? 'Lecture Slide Example: Combined Plane Change' : (isRaise ? 'Combined Plane Change: Orbit Raise' : 'Combined Plane Change: Orbit Lowering');
        const prompt = `Find the transfer semi-major axis, each burn $\\Delta V$, total $\\Delta V$, and transfer time between these circular orbits. Combine the plane change with the burn at the higher orbit.`;

        const statement = `
            <div class="given-item"><b>Initial Orbit:</b> $R_1 = ${formatNum(R1, 0)}\\text{ km}$, $i_1 = ${fixed(i1, 1)}^\\circ$</div>
            <div class="given-item"><b>Target Orbit:</b> $R_2 = ${formatNum(R2, 0)}\\text{ km}$, $i_2 = ${fixed(i2, 1)}^\\circ$</div>
            <div class="given-item"><b>Type:</b> ${isRaise ? 'Orbit raising' : 'Orbit lowering'} with plane change</div>
        `;

        const answers = {
            a_tx: { value: a_tx, text: `${formatNum(a_tx, 1)} km`, unitType: 'dist' },
            dv1: { value: dv1, text: `${dv1Text} km/s (${dv1_ms} m/s)`, unitType: 'speed_kms' },
            dv2: { value: dv2, text: `${dv2Text} km/s (${dv2_ms} m/s)`, unitType: 'speed_kms' },
            dv_total: { value: dv_total, text: `${fixed(dv_total, 3)} km/s (${dv_total_ms} m/s)`, unitType: 'speed_kms' },
            tof: { value: tof_min, text: `${fixed(tof_min, 1)} min (${hms})`, unitType: 'time' }
        };

        const fields = [
            { key: 'a_tx', tex: 'a_{tx}', name: 'Transfer semi-major axis', unit: 'km', tolerance: { relative: 0.005 }, unitType: 'dist' },
            { key: 'dv1', tex: '\\Delta V_1', name: isRaise ? 'Burn 1' : 'Burn 1 (combined)', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'dv2', tex: '\\Delta V_2', name: isRaise ? 'Burn 2 (combined)' : 'Burn 2', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'dv_total', tex: '\\Delta V_{total}', name: 'Total $\\Delta V$', unit: 'km/s', tolerance: { relative: 0.02 }, unitType: 'speed_kms' },
            { key: 'tof', tex: 'TOF', name: 'Transfer Time', unit: 'min', tolerance: { relative: 0.015 }, unitType: 'time' }
        ];

        const tableHtml = transferTable(data, {
            digits: 5,
            before: 'initial',
            after: 'final',
            dv1: dv1Text,
            dv2: dv2Text,
            total: fixed(dv_total, 3),
            tof: hms,
            tofDetail: `${fixed(tof_min, 1)} min`,
            combinedBurn: isRaise ? 2 : 1
        });

        // The work for the burn at the higher orbit
        function combinedWork(burnTex, radiusTex, viValue, vfValue, dvText, dvMs) {
            const vi = speed(viValue);
            const vf = speed(vfValue);
            return `
                ${rule(`$${radiusTex}$ is the higher orbit, so the spacecraft is slowest there. Turning the velocity vector costs the least where it is smallest, so the plane change goes in this burn.`)}
                ${calc('\\theta = |i_2 - i_1|', [
                    `|${fixed(i2, 1)}^\\circ - ${fixed(i1, 1)}^\\circ|`
                ], `${theta}^\\circ`)}
                ${calc(`${burnTex} = \\sqrt{V_{\\text{initial}}^2 + V_{\\text{final}}^2 - 2 V_{\\text{initial}} V_{\\text{final}} \\cos\\theta}`, [
                    `\\sqrt{(${vi})^2 + (${vf})^2 - 2(${vi})(${vf})\\cos(${theta}^\\circ)}`
                ], `${dvText}\\text{ km/s} = ${dvMs}\\text{ m/s}`)}
                ${note(`Doing these separately here would cost $|\\Delta V_{\\text{simple}}| + |\\Delta V_{\\text{increase}}| = ${fixed(dv_separate, 3)}\\text{ km/s}$. Combining them saves ${fixed(dv_separate - dv_combined, 3)} km/s.`)}
            `;
        }

        const speedCalc = (symbol, formula, line, value) => calc(`${symbol} = ${formula}`, [line], `${speed(value)}\\text{ km/s}`);
        const circular = (R) => `\\sqrt{\\frac{398{,}600.44}{${formatNum(R, 0)}}}`;
        const visViva = (R) => `\\sqrt{398{,}600.44 \\left(\\frac{2}{${formatNum(R, 0)}} - \\frac{1}{${formatNum(a_tx, 1)}}\\right)}`;
        const vis1 = '\\sqrt{\\mu \\left(\\frac{2}{R_1} - \\frac{1}{a_{\\text{tx}}}\\right)}';
        const vis2 = '\\sqrt{\\mu \\left(\\frac{2}{R_2} - \\frac{1}{a_{\\text{tx}}}\\right)}';

        const burn1Speeds = `
            ${speedCalc(isRaise ? 'V_1' : 'V_{\\text{initial}} = V_1', '\\sqrt{\\frac{\\mu}{R_1}}', circular(R1), v1)}
            ${speedCalc(isRaise ? 'V_{\\text{transfer}_1}' : 'V_{\\text{final}} = V_{\\text{transfer}_1}', vis1, visViva(R1), v_tx1)}
        `;
        const burn2Speeds = `
            ${speedCalc(isRaise ? 'V_{\\text{initial}} = V_{\\text{transfer}_2}' : 'V_{\\text{transfer}_2}', vis2, visViva(R2), v_tx2)}
            ${speedCalc(isRaise ? 'V_{\\text{final}} = V_2' : 'V_2', '\\sqrt{\\frac{\\mu}{R_2}}', circular(R2), v2)}
        `;

        const burn1Work = isRaise
            ? `${calc('\\Delta V_1 = |V_{\\text{transfer}_1} - V_1|', [`|${speed(v_tx1)} - ${speed(v1)}|`], `${dv1Text}\\text{ km/s} = ${dv1_ms}\\text{ m/s}`)}
               ${note(`This <b>prograde burn</b> starts the transfer. The transfer ellipse stays in the initial orbit plane.`)}`
            : combinedWork('\\Delta V_1', 'R_1', v1, v_tx1, dv1Text, dv1_ms);
        const burn2Work = isRaise
            ? combinedWork('\\Delta V_2', 'R_2', v_tx2, v2, dv2Text, dv2_ms)
            : `${calc('\\Delta V_2 = |V_2 - V_{\\text{transfer}_2}|', [`|${speed(v2)} - ${speed(v_tx2)}|`], `${dv2Text}\\text{ km/s} = ${dv2_ms}\\text{ m/s}`)}
               ${note(`This <b>retrograde burn</b> circularizes at $R_2$. The transfer ellipse is already in the final orbit plane.`)}`;

        const steps = [
            {
                key: 'atx',
                title: 'Transfer Orbit Semi-Major Axis',
                result: math(`a_{tx} = ${formatNum(a_tx, 1)}\\text{ km}`),
                caption: `<b>Transfer Orbit Geometry:</b> The transfer ellipse connects $R_1 = ${formatNum(R1, 0)}\\text{ km}$ to $R_2 = ${formatNum(R2, 0)}\\text{ km}$. Both burns sit on the line of nodes.`,
                methods: [{
                    name: 'Formula',
                    html: calc('a_{\\text{transfer}} = \\frac{R_1 + R_2}{2}', [
                        `\\frac{${formatNum(R1, 0)} + ${formatNum(R2, 0)}}{2}`
                    ], `${formatNum(a_tx, 1)}\\text{ km}`)
                }]
            },
            {
                key: 'burn1',
                title: isRaise ? 'First Burn at R₁ (ΔV₁)' : 'First Burn at R₁: Combined (ΔV₁)',
                result: math(`\\Delta V_1 = ${dv1Text}\\text{ km/s}`),
                caption: isRaise
                    ? `<b>First Burn at $R_1$:</b> A plain speed change at the lower orbit, with no plane change.`
                    : `<b>Combined Burn at $R_1$:</b> The higher orbit, so the speed change and the ${theta}° plane change happen together.`,
                methods: [{ name: 'Formula', html: `${burn1Speeds}${burn1Work}` }]
            },
            {
                key: 'burn2',
                title: isRaise ? 'Second Burn at R₂: Combined (ΔV₂)' : 'Second Burn at R₂ (ΔV₂)',
                result: math(`\\Delta V_2 = ${dv2Text}\\text{ km/s}`),
                caption: isRaise
                    ? `<b>Combined Burn at $R_2$:</b> The higher orbit, so the speed change and the ${theta}° plane change happen together.`
                    : `<b>Second Burn at $R_2$:</b> A plain speed change at the lower orbit, with no plane change.`,
                methods: [{ name: 'Formula', html: `${burn2Speeds}${burn2Work}` }]
            },
            {
                key: 'dvtotal',
                title: 'Total Delta-V',
                result: math(`\\Delta V_{\\text{total}} = ${fixed(dv_total, 3)}\\text{ km/s}`),
                caption: `<b>Total Maneuver Cost:</b> Sum of both burns, $\\Delta V_{total} = ${fixed(dv_total, 3)}\\text{ km/s}$ (${dv_total_ms} m/s).`,
                methods: [{
                    name: 'Formula',
                    html: calc('\\Delta V_{\\text{total}} = \\Delta V_1 + \\Delta V_2', [
                        `${dv1Text} + ${dv2Text}`
                    ], `${fixed(dv_total, 3)}\\text{ km/s} = ${dv_total_ms}\\text{ m/s}`)
                }]
            },
            {
                key: 'tof',
                title: 'Transfer Time (Time of Flight)',
                result: math(`TOF = \\text{${hms}}`),
                caption: `<b>Transfer Time:</b> Half the period of the transfer ellipse, $TOF = ${fixed(tof_min, 1)}\\text{ min}$ (${hms}).`,
                methods: [{
                    name: 'Formula',
                    html: `
                        ${calc('TOF = \\frac{P_{\\text{transfer}}}{2} = \\pi \\sqrt{\\frac{a_{\\text{tx}}^3}{\\mu}}', [
                            `\\pi \\sqrt{\\frac{(${formatNum(a_tx, 1)})^3}{398{,}600.44}}`
                        ], `${fixed(tof_s, 1)}\\text{ s} = ${fixed(tof_min, 1)}\\text{ min} = \\text{${hms}}`)}
                        ${note(`The plane change does not affect the transfer time. The spacecraft still flies exactly half of the transfer ellipse.`)}
                    `
                }]
            },
            {
                key: 'summary_table',
                title: 'Summary Table (Slide Format)',
                result: math(`\\text{Full 5-Column Solution}`),
                caption: `<b>Classroom 5-Column Format:</b> Complete overview of Position, Size, Velocity, $\\Delta V$, and Summary.`,
                methods: [{ name: '5-Column Table', html: prose(tableHtml) }]
            }
        ];

        return {
            title,
            prompt,
            statement,
            answers,
            fields,
            steps,
            data,
            limitsHtml: 'Enter values within <b>0.5%</b> for $a_{tx}$, <b>2%</b> for $\\Delta V$ (km/s or m/s), and <b>1.5%</b> for $TOF$ (minutes or h:mm:ss). Keep at least 3 decimals in each speed.'
        };
    }

    // The 5-column solution table from the lecture slides, shared by the transfer problems.
    function transferTable(data, options) {
        const { R1, R2, a1, a2, a_tx, v1, v_tx1, v_tx2, v2, dv1, dv2, dv_total } = data;
        const { digits, before, after, combinedBurn } = options;
        const speed = (val) => fixed(val, digits);
        const combinedTag = (burn) => (combinedBurn === burn ? ' <small>(combined)</small>' : '');
        const metersPerSecond = (val) => `<small>(${Math.round(val * 1000)} m/s)</small>`;
        return `
            <div class="hohmann-table-wrap">
                <table class="hohmann-table">
                    <thead>
                        <tr>
                            <th>Position</th>
                            <th>Size</th>
                            <th>Velocity</th>
                            <th>$\\Delta V$</th>
                            <th>Summary</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td rowspan="2"><b>$R_1$</b><br>${formatNum(R1, 0)} km</td>
                            <td>$a_1 = ${formatNum(a1, 0)}\\text{ km}$</td>
                            <td>$V_{\\text{${before}}} = V_1 = ${speed(v1)}\\text{ km/s}$</td>
                            <td rowspan="2" class="highlight-cell"><b>$\\Delta V_1$</b>${combinedTag(1)}<br>${options.dv1} km/s<br>${metersPerSecond(dv1)}</td>
                            <td rowspan="2" class="highlight-cell summary-cell"><b>$\\Delta V_{\\text{total}}$</b><br>${options.total} km/s<br>${metersPerSecond(dv_total)}</td>
                        </tr>
                        <tr>
                            <td rowspan="2" class="transfer-row"><b>$a_{\\text{transfer}}$</b><br>${formatNum(a_tx, 0)} km</td>
                            <td>$V_{\\text{${after}}} = V_{\\text{transfer}_1} = ${speed(v_tx1)}\\text{ km/s}$</td>
                        </tr>
                        <tr>
                            <td rowspan="2"><b>$R_2$</b><br>${formatNum(R2, 0)} km</td>
                            <td>$V_{\\text{${before}}} = V_{\\text{transfer}_2} = ${speed(v_tx2)}\\text{ km/s}$</td>
                            <td rowspan="2" class="highlight-cell"><b>$\\Delta V_2$</b>${combinedTag(2)}<br>${options.dv2} km/s<br>${metersPerSecond(dv2)}</td>
                            <td rowspan="2" class="highlight-cell summary-cell"><b>$TOF$</b><br>${options.tof}<br><small>(${options.tofDetail})</small></td>
                        </tr>
                        <tr>
                            <td>$a_2 = ${formatNum(a2, 0)}\\text{ km}$</td>
                            <td>$V_{\\text{${after}}} = V_2 = ${speed(v2)}\\text{ km/s}$</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    /* ------------------------------------------------------------------ */
    /* Problem Generator Dispatcher                                       */
    /* ------------------------------------------------------------------ */
    const PRESETS = {
        slide1: () => buildInclinationProblem(solveInclinationChange(300, 28.5, 55.0, 45, 270), true),
        slide2: () => buildHohmannProblem(solveHohmann(6578, 7000), true),
        polar: () => buildPolarRaanProblem(solvePolarRaanChange(600, 30, 60, 45), true),
        combined: () => buildCombinedProblem(solveCombined(6678, 26562, 28.5, 55.0), true)
    };

    function randomChoice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function randomHohmann() {
        // Pairs of clean realistic orbital radii
        const pairs = [
            [6578, 7000],   // Lecture example
            [6578, 6778],   // LEO 200 km to ISS 400 km
            [6678, 7178],   // 300 km to 800 km
            [6578, 7500],   // 200 km to 1122 km
            [6678, 8000],   // 300 km to 1622 km
            [6778, 10000],  // 400 km to 3622 km
            [7000, 6578],   // Orbit lowering (7000 km to 6578 km)
            [7200, 6678],   // Orbit lowering
            [6578, 12000],  // LEO to MEO
            [6678, 42164]   // LEO to GEO (Geostationary)
        ];
        const [R1, R2] = randomChoice(pairs);
        return buildHohmannProblem(solveHohmann(R1, R2), false);
    }

    function randomInclination() {
        const altitudes = [300, 400, 500, 600, 800];
        const incPairs = [
            [28.5, 55.0],   // Cape Canaveral to ISS inclination
            [28.5, 51.6],   // Cape Canaveral to Baikonur / ISS
            [51.6, 28.5],   // ISS to Cape
            [15.0, 45.0],
            [30.0, 60.0],
            [20.0, 40.0],
            [35.0, 65.0]
        ];
        const raans = [0, 30, 45, 60, 90, 120, 180];
        const u_scs = [45, 90, 135, 180, 225, 270, 315];

        const alt = randomChoice(altitudes);
        const [i1, i2] = randomChoice(incPairs);
        const raan = randomChoice(raans);
        const u_sc = randomChoice(u_scs);

        return buildInclinationProblem(solveInclinationChange(alt, i1, i2, raan, u_sc), false);
    }

    function randomPolarRaan() {
        const altitudes = [400, 500, 600, 700, 800];
        const raanPairs = [
            [15, 45],
            [30, 60],
            [45, 90],
            [60, 105],
            [90, 120],
            [0, 30],
            [45, 15]
        ];
        const u_scs = [0, 30, 45, 60, 120, 150, 210, 240, 300, 330];

        const alt = randomChoice(altitudes);
        const [raan1, raan2] = randomChoice(raanPairs);
        const u_sc = randomChoice(u_scs);

        return buildPolarRaanProblem(solvePolarRaanChange(alt, raan1, raan2, u_sc), false);
    }

    function randomCombined() {
        const radii = [
            [6678, 26562],  // LEO to GPS
            [6578, 26562],
            [6778, 26562],
            [6678, 42164],  // LEO to GEO
            [6578, 20000],
            [6678, 12000],
            [26562, 6678],  // Orbit lowering
            [20000, 6578],
            [12000, 6778]
        ];
        const incPairs = [
            [28.5, 55.0],   // Cape Canaveral to GPS
            [28.5, 0.0],    // Cape Canaveral to equatorial
            [28.5, 63.4],
            [51.6, 28.5],
            [35.0, 65.0]
        ];
        const [R1, R2] = randomChoice(radii);
        const [i1, i2] = randomChoice(incPairs);
        return buildCombinedProblem(solveCombined(R1, R2, i1, i2), false);
    }

    function generate(type = 'all') {
        if (type === 'hohmann') return randomHohmann();
        if (type === 'inclination') return randomInclination();
        if (type === 'polar_raan') return randomPolarRaan();
        if (type === 'combined') return randomCombined();
        // 'all' picks randomly among the four types
        const types = ['hohmann', 'inclination', 'polar_raan', 'combined'];
        const chosen = randomChoice(types);
        return generate(chosen);
    }

    global.ManeuversProblems = {
        constants: { MU, R_EARTH },
        solveHohmann,
        solveInclinationChange,
        solvePolarRaanChange,
        solveCombined,
        buildHohmannProblem,
        buildInclinationProblem,
        buildPolarRaanProblem,
        buildCombinedProblem,
        PRESETS,
        generate,
        customGrade
    };
})(window);
