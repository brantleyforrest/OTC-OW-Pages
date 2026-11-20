// Run with: node _tests/cw-error-table.js            (course constants)
//       or: CONSTANTS=wgs84 node _tests/cw-error-table.js
// Prints the CW-versus-exact error table as Markdown: for LEO and GEO targets, three kinds of motion
// at separations from 1 to 300 km, the worst distance between the CW path and the exact path (two
// two-body orbits subtracted) over 1 and 3 target orbits, in rectilinear and curvilinear RIC axes.
// A last block adds target eccentricity, which CW ignores. The "Range" column is the farthest the
// chase gets from the target, as a share of the target's semi-major axis.
// Not a test (no pass or fail); the numbers come from OrbitMath, the same code the pages run.
globalThis.window = globalThis;
const OM = require('../assets/orbit-math.js');
const OC = globalThis.OrbitConstants;
const SET = OC.SETS[process.env.CONSTANTS || 'course'];
if (!SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
OC.Settings.set({ constants: SET.id });
const M = OM.rpo;

const STEPS_PER_ORBIT = 360;
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Worst |exact - CW| over the given number of target orbits, and the largest separation reached.
function worst(coe, rmoe, axes, orbits) {
    const n = M.meanMotion(coe.a), P = 2 * Math.PI / n;
    const T = M.targetSat(coe);
    const ch = M.chaseSatFromRic(M.stateFromRmoe(rmoe, n, 0), T, 0, axes);
    let w = 0, far = 0;
    for (let k = 0; k <= STEPS_PER_ORBIT * orbits; k++) {
        const t = P * k / STEPS_PER_ORBIT;
        const cw = M.stateFromRmoe(rmoe, n, t);
        w = Math.max(w, gap(M.relativeStateSats(T, ch, t, axes).rho, cw));
        far = Math.max(far, Math.hypot(cw[0], cw[1], cw[2]));
    }
    return { w, far };
}
const fmtLen = (km) => (km < 1e-3 ? (km * 1e6).toFixed(1) + ' mm' : km < 1 ? (km * 1000).toFixed(km < 0.01 ? 2 : 1) + ' m' : km.toFixed(km < 10 ? 3 : 1) + ' km');
const pct = (x) => (100 * x).toFixed(x < 0.001 ? 3 : 2) + '%';

const TARGETS = [
    ['LEO', { a: 6778, e: 0, i: 51.6, raan: 0, argp: 0, nu: 0 }],
    ['GEO', { a: M.GEO_A, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }]
];
const SEPARATIONS = [1, 10, 50, 100, 300];
const KINDS = [
    ['in-track perch', (d) => ({ xc: 0, yc0: d, C: 0, M0: null, zmax: 0, dM0: null })],
    ['NMC, 2C = d', (d) => ({ xc: 0, yc0: 0, C: d / 2, M0: 0, zmax: 0, dM0: null })],
    ['cross-track, z_max = d', (d) => ({ xc: 0, yc0: 0, C: 0, M0: null, zmax: d, dM0: 0 })]
];

console.log(`CW against the exact two-body difference (${SET.name}). Error is the worst distance between the paths.\n`);
console.log('| Target | Motion | d | Range | Rectilinear, 1 orbit | Rectilinear, 3 orbits | Curvilinear, 1 orbit | Curvilinear, 3 orbits |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [tName, coe] of TARGETS) {
    for (const [kName, make] of KINDS) {
        for (const d of SEPARATIONS) {
            const rmoe = make(d);
            const cells = [];
            let far = 0;
            for (const axes of ['rectilinear', 'curvilinear']) {
                for (const orbits of [1, 3]) {
                    const r = worst(coe, rmoe, axes, orbits);
                    far = Math.max(far, r.far);
                    cells.push(`${fmtLen(r.w)} (${pct(r.w / Math.max(r.far, 1e-12))})`);
                }
            }
            console.log(`| ${tName} | ${kName} | ${d} km | ${pct(far / coe.a)} of a | ${cells.join(' | ')} |`);
        }
    }
}

console.log('\nTarget eccentricity (CW assumes a circular target): a 1 km NMC and a 10 km perch, rectilinear axes.\n');
console.log('| Target | e | Motion | 1 orbit | 3 orbits |');
console.log('|---|---|---|---|---|');
for (const [tName, base] of [['LEO', TARGETS[0][1]], ['GEO', TARGETS[1][1]]]) {
    for (const e of [0.0001, 0.001, 0.01]) {
        const coe = { ...base, e };
        for (const [kName, rmoe] of [['NMC, C = 0.5 km', KINDS[1][1](1)], ['perch, 10 km', KINDS[0][1](10)]]) {
            const one = worst(coe, rmoe, 'rectilinear', 1), three = worst(coe, rmoe, 'rectilinear', 3);
            console.log(`| ${tName} | ${e} | ${kName} | ${fmtLen(one.w)} | ${fmtLen(three.w)} |`);
        }
    }
}
