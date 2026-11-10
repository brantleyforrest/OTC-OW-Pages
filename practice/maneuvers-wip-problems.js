// Orbital maneuver problems for the Test 1 Practice work-in-progress page. The solvers and the
// worked math come from maneuvers-problems.js. This file picks the numbers and writes the
// problem text in the same voice as the R-V problems.
//
// Every orbit is at least 1.5 Earth radii from Earth's center, and a transfer's higher orbit is
// 1.6 to 2.6 times its lower one, so that every orbit, burn, and angle has room in the 3D view.
// Load as a classic script, after maneuvers-problems.js.
(function (global) {
    'use strict';

    const Base = global.ManeuversProblems;
    const { math, prose } = global.PracticeMath;

    const LOWER_RADIUS = [9600, 16000];     // Lower orbit of a transfer (km)
    const RADIUS_RATIO = [1.6, 2.6];        // Higher orbit / lower orbit
    const ALTITUDE = [3300, 14000];         // Plane change orbits (km), so r is at least 9,678 km
    const LOWERING = 0.3;                   // Share of transfers that go down instead of up

    const INCLINATION_PAIRS = [[28.5, 55.0], [28.5, 51.6], [51.6, 28.5], [15.0, 45.0], [30.0, 60.0], [20.0, 45.0], [35.0, 65.0], [60.0, 30.0]];
    const RAAN_CHOICES = [0, 30, 45, 60, 90, 120, 150];
    const NODE_POSITIONS = [45, 90, 135, 225, 270, 315];                       // Never at a node
    const POLAR_RAAN_PAIRS = [[15, 45], [30, 60], [45, 90], [60, 105], [90, 120], [0, 30], [45, 15], [120, 80]];
    const POLE_POSITIONS = [0, 30, 45, 60, 120, 150, 210, 240, 300, 330];   // Never at a pole
    const COMBINED_PAIRS = [[28.5, 55.0], [28.5, 0.0], [28.5, 63.4], [51.6, 28.5], [35.0, 65.0]];

    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const between = ([low, high]) => low + (high - low) * Math.random();
    const snap = (x) => Math.round(x / 100) * 100;

    const km = (x) => Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
    const one = (x) => Number(x).toFixed(1);
    const item = (tex) => `<div class="given-item">${math(tex)}</div>`;

    function transferRadii() {
        const low = snap(between(LOWER_RADIUS));
        const high = snap(low * between(RADIUS_RATIO));
        return Math.random() < LOWERING ? [high, low] : [low, high];
    }

    /* ------------------------------------------------------------------ */
    /* Problem Text                                                       */
    /* ------------------------------------------------------------------ */
    const TRANSFER_LIMITS = prose('Accepted: $a_{tx}$ within 0.5%, each $\\Delta V$ within 2% (km/s or m/s), $TOF$ within 1.5% (minutes or h:mm:ss). Keep at least 3 decimals in each speed.');
    const PLANE_LIMITS = prose('Accepted: $V$ within 0.5%, $\\Delta \\theta$ within 0.5°, $\\Delta V$ within 1% (km/s or m/s).');

    const FIELD_NAMES = {
        a_tx: 'Transfer semi-major axis',
        dv1: 'First burn',
        dv2: 'Second burn',
        dv_total: 'Total',
        tof: 'Transfer time',
        v: 'Circular speed',
        delta_theta: 'Plane change angle',
        dv: 'Plane change'
    };

    function speedChange(raise, from, to, where) {
        return raise
            ? `At $${where}$, a prograde burn speeds the spacecraft up from $${from}$ to $${to}$.`
            : `At $${where}$, a retrograde burn slows the spacecraft down from $${from}$ to $${to}$.`;
    }

    const COMBINED_BURN = (where) => `$${where}$ is the higher orbit, where the spacecraft is slowest, so this burn also turns the velocity into the new plane. $\\Delta V$ runs from the tip of the old velocity to the tip of the new one.`;

    function transferSteps(data) {
        const { isRaise, type } = data;
        const combined = type === 'combined';
        const combinedFirst = combined && !isRaise;
        const combinedSecond = combined && isRaise;
        return {
            atx: {
                title: 'Transfer semi-major axis, $a_{tx}$',
                caption: '<b>Transfer orbit.</b> Its ends touch the two orbits, on opposite sides of Earth. Half of its longest width is $a_{tx}$.'
            },
            burn1: {
                title: combinedFirst ? 'First burn, combined, $\\Delta V_1$' : 'First burn, $\\Delta V_1$',
                caption: `<b>First burn.</b> ${combinedFirst ? COMBINED_BURN('R_1') : speedChange(isRaise, 'V_1', 'V_{tx_1}', 'R_1')}`
            },
            burn2: {
                title: combinedSecond ? 'Second burn, combined, $\\Delta V_2$' : 'Second burn, $\\Delta V_2$',
                caption: `<b>Second burn.</b> ${combinedSecond ? COMBINED_BURN('R_2') : speedChange(isRaise, 'V_{tx_2}', 'V_2', 'R_2')}`
            },
            dvtotal: {
                title: 'Total, $\\Delta V_{total}$',
                caption: '<b>Total.</b> The cost of the maneuver is the sum of the two burns.'
            },
            tof: {
                title: 'Transfer time, $TOF$',
                caption: '<b>Transfer time.</b> The spacecraft flies half of the transfer ellipse, so the trip takes half of its period.'
            },
            summary_table: {
                title: 'Summary table',
                caption: '<b>Summary.</b> The whole maneuver in the 5-column table from the lesson.'
            }
        };
    }

    function planeSteps(polar) {
        return {
            speed: {
                title: 'Circular speed, $V$',
                caption: '<b>Speed.</b> On a circular orbit the speed is the same everywhere, and it depends only on the radius.'
            },
            angle: {
                title: 'Plane change angle, $\\Delta \\theta$',
                caption: polar
                    ? '<b>Plane change angle.</b> Every polar orbit passes over both poles, so the two orbits cross there. The angle between them is $\\Delta \\Omega$.'
                    : '<b>Plane change angle.</b> The two orbits cross at the line of nodes. With $\\Omega$ unchanged, the angle between them there is $\\Delta i$.'
            },
            dv: {
                title: 'Plane change, $\\Delta V$',
                caption: '<b>Plane change.</b> The burn turns the velocity without changing its length. $\\Delta V$ runs from the tip of the old velocity to the tip of the new one.'
            },
            location: {
                title: 'Where to burn',
                caption: polar
                    ? '<b>Where to burn.</b> The burn must happen where the orbits cross, over a pole. The spacecraft coasts $\\Delta u$ to the next one.'
                    : '<b>Where to burn.</b> The burn must happen where the orbits cross, at a node. The spacecraft coasts $\\Delta u$ to the next one.'
            }
        };
    }

    const TEXT = {
        hohmann: (d) => ({
            title: 'Hohmann Transfer',
            prompt: 'Both orbits are circular and in the same plane. Find the transfer orbit, each burn, the total, and the transfer time.',
            statement: item(`R_1 = ${km(d.R1)}\\text{ km}`) + item(`R_2 = ${km(d.R2)}\\text{ km}`),
            overview: `<b>The problem as given.</b> The spacecraft is on the initial orbit, $R_1$. The target orbit, $R_2$, is in the same plane, ${d.isRaise ? 'farther out' : 'closer in'}.`,
            limits: TRANSFER_LIMITS,
            steps: transferSteps(d)
        }),
        combined: (d) => ({
            title: 'Combined Plane Change',
            prompt: 'A Hohmann transfer between these circular orbits also changes the inclination. Put the plane change in the burn at the higher orbit.',
            statement: item(`R_1 = ${km(d.R1)}\\text{ km}`) + item(`i_1 = ${one(d.i1)}°`) + item(`R_2 = ${km(d.R2)}\\text{ km}`) + item(`i_2 = ${one(d.i2)}°`),
            overview: '<b>The problem as given.</b> The two orbits differ in size and in tilt. Their planes cross along the line through both burns.',
            limits: TRANSFER_LIMITS,
            steps: transferSteps(d)
        }),
        inclination: (d) => ({
            title: 'Simple Plane Change: Inclination',
            prompt: 'A circular orbit changes inclination, with $\\Omega$ unchanged. Find the speed, the plane change angle, and $\\Delta V$. $u$ is measured from the ascending node.',
            statement: item(`h = ${km(d.alt)}\\text{ km}`) + item(`i_1 = ${one(d.i1)}°`) + item(`i_2 = ${one(d.i2)}°`) + item(`\\Omega = ${one(d.raan)}°`) + item(`u = ${Math.round(d.u_sc)}°`),
            overview: '<b>The problem as given.</b> The spacecraft is on the initial orbit at $u$. The target orbit is the same size, with the same $\\Omega$, tilted to $i_2$.',
            limits: PLANE_LIMITS,
            steps: planeSteps(false)
        }),
        polar_raan: (d) => ({
            title: 'Simple Plane Change: Polar RAAN',
            prompt: 'A circular polar orbit changes its RAAN. Find the speed, the plane change angle, and $\\Delta V$. $u$ is measured from the ascending node.',
            statement: item(`h = ${km(d.alt)}\\text{ km}`) + item('i = 90°') + item(`\\Omega_1 = ${one(d.raan1)}°`) + item(`\\Omega_2 = ${one(d.raan2)}°`) + item(`u = ${Math.round(d.u_sc)}°`),
            overview: '<b>The problem as given.</b> The spacecraft is on the initial polar orbit at $u$. The target orbit is the same size, also polar, turned to $\\Omega_2$.',
            limits: PLANE_LIMITS,
            steps: planeSteps(true)
        })
    };

    // Rewrites the text of a problem from maneuvers-problems.js. The numbers and the worked math stay.
    function restyle(problem) {
        const d = problem.data;
        const text = TEXT[d.type](d);
        problem.title = text.title;
        problem.prompt = prose(text.prompt);
        problem.statement = text.statement;
        problem.overviewCaption = prose(text.overview);
        problem.limitsHtml = text.limits;
        problem.fields = problem.fields.map((field) => {
            let name = FIELD_NAMES[field.key] || field.name;
            const combinedBurn = d.type === 'combined' && ((field.key === 'dv1' && !d.isRaise) || (field.key === 'dv2' && d.isRaise));
            if (combinedBurn) name += ', combined';
            return { ...field, name };
        });
        problem.steps = problem.steps.map((step) => {
            const words = text.steps[step.key];
            return words ? { ...step, title: prose(words.title), caption: prose(words.caption) } : step;
        });
        return problem;
    }

    /* ------------------------------------------------------------------ */
    /* Generators                                                         */
    /* ------------------------------------------------------------------ */
    const GENERATORS = {
        hohmann() {
            const [R1, R2] = transferRadii();
            return Base.buildHohmannProblem(Base.solveHohmann(R1, R2));
        },
        inclination() {
            const [i1, i2] = pick(INCLINATION_PAIRS);
            const alt = snap(between(ALTITUDE));
            return Base.buildInclinationProblem(Base.solveInclinationChange(alt, i1, i2, pick(RAAN_CHOICES), pick(NODE_POSITIONS)));
        },
        polar_raan() {
            const [raan1, raan2] = pick(POLAR_RAAN_PAIRS);
            const alt = snap(between(ALTITUDE));
            return Base.buildPolarRaanProblem(Base.solvePolarRaanChange(alt, raan1, raan2, pick(POLE_POSITIONS)));
        },
        combined() {
            const [R1, R2] = transferRadii();
            const [i1, i2] = pick(COMBINED_PAIRS);
            return Base.buildCombinedProblem(Base.solveCombined(R1, R2, i1, i2));
        }
    };

    const TYPES = Object.keys(GENERATORS);

    function generate(type) {
        const chosen = GENERATORS[type] ? type : pick(TYPES);
        return restyle(GENERATORS[chosen]());
    }

    global.ManeuversWipProblems = {
        constants: Base.constants,
        types: TYPES,
        generate,
        grade: Base.customGrade
    };
})(window);
