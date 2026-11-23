// Run with: node _tests/gmat-cases.test.js
//      or: node _tests/gmat-cases.test.js --scripts <folder>   (also writes one GMAT script per case)
//
// Cross-check cases against GMAT (NASA's General Mission Analysis Tool). Each case states the exact
// settings to reproduce it: WGS-84 constants, Cowell with Prince-Dormand 8(7) (two-body cases too, so
// both tools integrate), the forces, the start
// time and the initial state. The test computes the site's answer with OrbitMath and compares it with
// the GMAT answer recorded below. Until a GMAT run is recorded (gmat: null) the case is reported as
// pending, with the site's numbers printed, and does not fail.
//
// To record a case: run its script in GMAT (R2022a or later), read the last line of the report file,
// and paste the numbers into that case's gmat field in the same order as its `fields`.
// GMAT notes: the scripts work in true-of-date axes (TODEq) so the Earth's pole is the frame's z, as
// in the site's math; GMAT's JGM-2 field differs from WGS-84's J2 by about 2e-7, far below the
// tolerances. Drag and the Sun and Moon use different models in the two tools (the site: a piecewise
// exponential atmosphere and low-precision Almanac Sun and Moon), so those tolerances are loose and
// say so.
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
globalThis.window = globalThis;
const OM = require('./load-math.js');
const OC = globalThis.OrbitConstants;
const S = OC.Settings;
const P = OM.propagate, EL = OM.elements;

const START = Date.UTC(2026, 10, 20, 0, 0, 0);      // 20 Nov 2026 00:00:00 UTC
const DAY = 86400;
const NO_FORCES = { j2: false, j34: false, j22: false, drag: false, sun: false, moon: false, srp: false };

// kind 'state': the final r (km) and v (km/s) after `span` seconds.
// kind 'node': the change in right ascension of the node (deg) over `span`, osculating, end minus start.
// kind 'relative': chase minus target in the target's rectilinear RIC axes (km) at each of `times`.
const CASES = [
    { id: 'twobody-leo', what: 'Two-body LEO, 1 day', kind: 'state', forces: {}, span: DAY,
        el: { a: 6778.137, e: 0.0005, i: 51.6, raan: 30, argp: 40, nu: 10 }, tol: 1e-3, gmat: null },
    { id: 'twobody-molniya', what: 'Two-body Molniya, 2 orbits', kind: 'state', forces: {}, span: 2 * 43082.0,
        el: { a: 26600, e: 0.74, i: 63.4, raan: 20, argp: 270, nu: 0 }, tol: 1e-3, gmat: null },
    { id: 'twobody-geo', what: 'Two-body GEO, 1 day', kind: 'state', forces: {}, span: DAY,
        el: { a: 42164.17, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, tol: 1e-3, gmat: null },
    { id: 'j2-node-leo', what: 'J2 only: node change of a LEO orbit over 30 days', kind: 'node', forces: { j2: true }, span: 30 * DAY,
        el: { a: 6778.137, e: 0.0005, i: 51.6, raan: 30, argp: 40, nu: 10 }, tol: 0.01, gmat: null },
    { id: 'j2-j4-leo', what: 'J2 to J4 zonal: LEO state after 1 day', kind: 'state', forces: { j2: true, j34: true }, span: DAY,
        el: { a: 7000, e: 0.001, i: 98, raan: 100, argp: 0, nu: 0 }, tol: 0.05, gmat: null },
    { id: 'sun-moon-geo', what: 'Sun and Moon: GEO state after 7 days (loose: ephemeris models differ)', kind: 'state',
        forces: { sun: true, moon: true }, span: 7 * DAY,
        el: { a: 42164.17, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, tol: 5, gmat: null },
    { id: 'drag-leo', what: 'Drag: 300 km LEO after 1 day (loose: atmosphere models differ)', kind: 'state',
        forces: { drag: true }, span: DAY,
        el: { a: 6678.137, e: 0.0001, i: 51.6, raan: 0, argp: 0, nu: 0 }, tol: 50, gmat: null },
    { id: 'relative-geo', what: 'Exact two-body relative motion: GEO, chase on a 1 km NMC', kind: 'relative', forces: {},
        el: { a: 42164.17, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, ric: [-0.5, 0, 0, 0, 2 * 0.5 * 7.2921e-5, 0],
        times: [0.25, 0.5, 1, 2], tol: 1e-3, gmat: null },
    { id: 'relative-leo', what: 'Exact two-body relative motion: LEO, chase on a 10 km NMC and 2 km cross-track', kind: 'relative', forces: {},
        el: { a: 6778.137, e: 0, i: 51.6, raan: 30, argp: 0, nu: 0 }, ric: [-5, 0, 2, 0, 0, 0],
        times: [0.25, 0.5, 1, 2], tol: 1e-3, gmat: null }
];

function settingsFor(c) {
    S.reset();
    S.set({ constants: 'wgs84', propagator: 'cowell', solver: 'PD78',
        forces: { ...NO_FORCES, ...c.forces }, startMs: START });
}
const periodOf = (a) => 2 * Math.PI * Math.sqrt(a ** 3 / OM.rpo.MU);

// The site's answer for a case, as a flat list of numbers, with field names.
function siteAnswer(c) {
    settingsFor(c);
    const sat = P.fromElements(c.el, 0);
    if (c.kind === 'state') {
        const s = P.stateAt(sat, c.span);
        return { fields: ['x', 'y', 'z', 'vx', 'vy', 'vz'], values: [...s.r, ...s.v], init: sat };
    }
    if (c.kind === 'node') {
        const s = P.stateAt(sat, c.span);
        const d = ((EL.elementsFromRv(s.r, s.v).raan - c.el.raan) % 360 + 540) % 360 - 180;
        return { fields: ['dRaan_deg'], values: [d], init: sat };
    }
    const M = OM.rpo;
    // The chase's RIC state is CW-shaped; scale the in-track rate to this orbit's mean motion.
    const n = M.meanMotion(c.el.a);
    const ric = c.ric.slice();
    if (c.id === 'relative-geo') ric[4] = 2 * 0.5 * n;
    if (c.id === 'relative-leo') ric[4] = 2 * 5 * n;
    const T = M.targetSat(c.el), C = M.chaseSatFromRic(ric, T, 0, 'rectilinear');
    const P0 = periodOf(c.el.a);
    const values = [], fields = [];
    for (const k of c.times) {
        const rel = M.relativeStateSats(T, C, k * P0, 'rectilinear');
        values.push(...rel.rho);
        fields.push(`x@${k}`, `y@${k}`, `z@${k}`);
    }
    return { fields, values, init: T, chase: C, period: P0 };
}

/* ---------- GMAT scripts ---------- */
const gmatDate = (ms) => {
    const d = new Date(ms);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    const p2 = (x) => String(x).padStart(2, '0');
    return `${p2(d.getUTCDate())} ${mon} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.000`;
};
const num = (x) => x.toPrecision(16);
function spacecraft(name, sat) {
    const sc = OC.Settings.get().spacecraft;
    return [`Create Spacecraft ${name};`, `${name}.DateFormat = UTCGregorian;`, `${name}.Epoch = '${gmatDate(START)}';`,
        `${name}.CoordinateSystem = EarthTOD;`, `${name}.DisplayStateType = Cartesian;`,
        `${name}.X = ${num(sat.r[0])};`, `${name}.Y = ${num(sat.r[1])};`, `${name}.Z = ${num(sat.r[2])};`,
        `${name}.VX = ${num(sat.v[0])};`, `${name}.VY = ${num(sat.v[1])};`, `${name}.VZ = ${num(sat.v[2])};`,
        `${name}.DryMass = 100;`, `${name}.Cd = ${sc.cd};`, `${name}.Cr = ${sc.cr};`,
        `${name}.DragArea = ${num(sc.areaToMass * 100)};`, `${name}.SRPArea = ${num(sc.areaToMass * 100)};`].join('\n');
}
function forceModel(c) {
    const f = { ...NO_FORCES, ...c.forces };
    const degree = f.j34 ? 4 : f.j2 ? 2 : 0;
    const lines = ['Create ForceModel FM;', 'FM.CentralBody = Earth;'];
    if (degree) lines.push('FM.PrimaryBodies = {Earth};', `FM.GravityField.Earth.Degree = ${degree};`, 'FM.GravityField.Earth.Order = 0;',
        "FM.GravityField.Earth.PotentialFile = 'JGM2.cof';");
    else lines.push('FM.PointMasses = {Earth};');
    const third = [f.sun && 'Sun', f.moon && 'Luna'].filter(Boolean);
    if (third.length) lines.push(`FM.PointMasses = {${degree ? '' : 'Earth, '}${third.join(', ')}};`);
    if (f.drag) lines.push('FM.Drag.AtmosphereModel = Exponential;');
    lines.push('Create Propagator Prop;', 'Prop.FM = FM;', 'Prop.Type = PrinceDormand78;', 'Prop.InitialStepSize = 60;',
        'Prop.Accuracy = 1e-13;', 'Prop.MinStep = 0;', 'Prop.MaxStep = 600;');
    return lines.join('\n');
}
function gmatScript(c, site) {
    const head = [`% ${c.what}`, `% Site answer (${site.fields.join(', ')}):`, `% ${site.values.map(num).join(' ')}`,
        'Earth.Mu = 398600.4418;', 'Earth.EquatorialRadius = 6378.137;',
        'Create CoordinateSystem EarthTOD;', 'EarthTOD.Origin = Earth;', 'EarthTOD.Axes = TODEq;'];
    if (c.kind === 'relative') {
        const body = [spacecraft('Target', site.init), spacecraft('Chase', site.chase), forceModel(c),
            'Create ReportFile RF;', `RF.Filename = '${c.id}.txt';`, 'RF.WriteHeaders = true;', 'BeginMissionSequence;'];
        for (const k of c.times) {
            const last = k * site.period;
            body.push(`Propagate Synchronized Prop(Target, Chase) {Target.ElapsedSecs = ${num(last)}};`,
                'Report RF Target.EarthTOD.X Target.EarthTOD.Y Target.EarthTOD.Z Target.EarthTOD.VX Target.EarthTOD.VY Target.EarthTOD.VZ Chase.EarthTOD.X Chase.EarthTOD.Y Chase.EarthTOD.Z;');
        }
        body.push('% Turn each line into RIC: R = r_T/|r_T|, C = (r_T x v_T)/|r_T x v_T|, I = C x R; rho = (r_C - r_T) . [R, I, C].');
        return head.concat(body).join('\n') + '\n';
    }
    const out = c.kind === 'node' ? 'Sat.EarthTOD.RAAN' : 'Sat.EarthTOD.X Sat.EarthTOD.Y Sat.EarthTOD.Z Sat.EarthTOD.VX Sat.EarthTOD.VY Sat.EarthTOD.VZ';
    return head.concat([spacecraft('Sat', site.init), forceModel(c), 'Create ReportFile RF;', `RF.Filename = '${c.id}.txt';`,
        'RF.WriteHeaders = true;', 'BeginMissionSequence;', `Report RF ${out};`,
        `Propagate Prop(Sat) {Sat.ElapsedSecs = ${num(c.span)}};`, `Report RF ${out};`,
        c.kind === 'node' ? '% Answer: last RAAN minus first RAAN, in -180..180 deg.' : '']).join('\n') + '\n';
}

/* ---------- run ---------- */
let passed = 0, failed = 0, pending = 0;
const scriptDir = process.argv.includes('--scripts') ? process.argv[process.argv.indexOf('--scripts') + 1] : null;
if (scriptDir) fs.mkdirSync(scriptDir, { recursive: true });
for (const c of CASES) {
    let site;
    try {
        site = siteAnswer(c);
        site.values.forEach((v, k) => assert.ok(Number.isFinite(v), `${site.fields[k]} is not finite`));
        if (scriptDir) fs.writeFileSync(path.join(scriptDir, c.id + '.script'), gmatScript(c, site));
        if (!c.gmat) {
            pending++;
            console.log(`pend  ${c.what}\n      site: ${site.fields.map((f, k) => f + ' ' + site.values[k].toPrecision(10)).join(', ')}`);
            continue;
        }
        assert.strictEqual(c.gmat.length, site.values.length, 'GMAT values in the order of the fields');
        const worst = Math.max(...site.values.map((v, k) => Math.abs(v - c.gmat[k])));
        assert.ok(worst <= c.tol, `worst difference ${worst} against tolerance ${c.tol}`);
        passed++;
        console.log(`ok    ${c.what} (worst difference ${worst.toExponential(2)})`);
    } catch (err) {
        failed++;
        console.log(`FAIL  ${c.what}\n      ${err.message}`);
    }
}
S.reset();
console.log(`\n${passed} passed, ${failed} failed, ${pending} pending a GMAT run`);
process.exit(failed ? 1 : 0);
