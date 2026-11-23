// Run with: node _tests/propagator-setting.test.js
// The propagator setting (math/propagation/propagate.js): Kepler by default; Cowell with the
// settings' solver and forces, read through cached samples. References: Kepler for two-body motion,
// the J2 secular node rate, drag lowering a, and the work budget for animation.
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('./load-math.js');
const OC = globalThis.OrbitConstants;
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = OC.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
OC.Settings.set({ constants: TEST_SET.id });
const P = OM.propagate, EL = OM.elements;
const MU = TEST_SET.mu, RE = TEST_SET.re;
const S = OC.Settings;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
    finally { S.reset(); S.set({ constants: TEST_SET.id }); }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const periodOf = (a) => 2 * Math.PI * Math.sqrt(a ** 3 / MU);
// The orbits the pages show, each over the longest span a page plays.
const PAGE_ORBITS = [
    ['LEO, 5 orbits', { a: 6778, e: 0.001, i: 51.6, raan: 30, argp: 40, nu: 10 }, 5],
    ['GPS, 2 orbits', { a: 26560, e: 0.01, i: 55, raan: 100, argp: 0, nu: 0 }, 2],
    ['Molniya, 2 orbits', { a: 26600, e: 0.74, i: 63.4, raan: 20, argp: 270, nu: 0 }, 2],
    ['GEO, 3 orbits', { a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, 3],
    ['transfer ellipse, 1 orbit', { a: 24421, e: 0.7265, i: 28.5, raan: 0, argp: 0, nu: 0 }, 1]
];

check('the default is Kepler, and stateAt matches the Kepler solver exactly', () => {
    assert.strictEqual(P.propagatorName(), 'kepler');
    const sat = P.fromElements(PAGE_ORBITS[0][1]);
    const s = P.stateAt(sat, 1234.5), k = P.kepler(sat.r, sat.v, 1234.5);
    assert.deepStrictEqual(s.r, k.r);
});

check('Cowell with every force off matches Kepler to under 1 mm on each page orbit (cached samples)', () => {
    S.set({ propagator: 'cowell' });
    for (const [name, el, orbits] of PAGE_ORBITS) {
        const sat = P.fromElements(el, 50);
        const span = orbits * periodOf(el.a);
        let worst = 0;
        // Odd times, so most fall between samples and use the interpolation.
        for (let k = 0; k <= 97; k++) {
            const t = 50 + span * k / 97;
            const c = P.stateAt(sat, t), kp = P.kepler(sat.r, sat.v, t - 50);
            worst = Math.max(worst, dist(c.r, kp.r));
        }
        assert.ok(worst < 1e-6, `${name}: ${(worst * 1e6).toFixed(3)} mm`);
    }
});

check('Cowell short steps (an animation frame) match Kepler too, and so does going backward', () => {
    S.set({ propagator: 'cowell' });
    const sat = P.fromElements(PAGE_ORBITS[2][1]);
    for (const t of [0.016, 20, -20, -3 * periodOf(26600) / 4]) {
        const c = P.stateAt(sat, t), kp = P.kepler(sat.r, sat.v, t);
        assert.ok(dist(c.r, kp.r) < 1e-6, `t = ${t}: ${dist(c.r, kp.r)} km`);
    }
});

check('every solver stays within 1 mm of Kepler over one LEO orbit with forces off', () => {
    for (const solver of OC.SOLVER_IDS) {
        S.set({ propagator: 'cowell', solver });
        const sat = P.fromElements(PAGE_ORBITS[0][1]);
        const t = periodOf(6778);
        const err = dist(P.stateAt(sat, t).r, P.kepler(sat.r, sat.v, t).r);
        assert.ok(err < 1e-6, `${solver}: ${(err * 1e6).toFixed(3)} mm`);
    }
});

check('J2 on: the node of a prograde LEO orbit moves west at the secular rate', () => {
    S.set({ propagator: 'cowell', forces: { j2: true } });
    const el = { a: 7000, e: 0.001, i: 50, raan: 0, argp: 0, nu: 0 };
    const sat = P.fromElements(el);
    const span = 10 * periodOf(7000);
    const after = P.stateAt(sat, span);
    const raan = EL.elementsFromRv(after.r, after.v).raan;
    const moved = ((raan + 180) % 360) - 180;          // degrees, west is negative
    const n = Math.sqrt(MU / 7000 ** 3), p = 7000 * (1 - 0.001 ** 2);
    const rate = -1.5 * n * TEST_SET.J2 * (RE / p) ** 2 * Math.cos(50 * Math.PI / 180);
    const want = rate * span * 180 / Math.PI;
    assert.ok(moved < 0, 'moves west');
    // The osculating node wobbles around the mean motion; 10 orbits average it well.
    assert.ok(Math.abs(moved - want) < 0.03 * Math.abs(want), `moved ${moved.toFixed(4)}°, secular ${want.toFixed(4)}°`);
});

check('drag on: a low orbit loses energy; Kepler does not', () => {
    S.set({ propagator: 'cowell', forces: { drag: true } });
    const sat = P.fromElements({ a: RE + 300, e: 0.001, i: 51.6, raan: 0, argp: 0, nu: 0 });
    const t = 5 * periodOf(RE + 300);
    const s = P.stateAt(sat, t);
    const a = EL.elementsFromRv(s.r, s.v).a;
    assert.ok(a < RE + 300 - 0.05, `a fell by ${(RE + 300 - a).toFixed(3)} km`);
    S.set({ propagator: 'kepler' });
    const k = P.stateAt(sat, t);
    assert.ok(Math.abs(EL.elementsFromRv(k.r, k.v).a - (RE + 300)) < 1e-6);
});

check('changing a setting starts the samples again', () => {
    S.set({ propagator: 'cowell' });
    const sat = P.fromElements(PAGE_ORBITS[0][1]);
    const t = 2.5 * periodOf(6778);
    const plain = P.stateAt(sat, t).r;
    S.set({ forces: { j2: true } });
    const withJ2 = P.stateAt(sat, t).r;
    assert.ok(dist(plain, withJ2) > 1, `J2 moved it ${dist(plain, withJ2).toFixed(3)} km`);
    S.set({ forces: { j2: false } });
    assert.ok(dist(P.stateAt(sat, t).r, plain) < 1e-9, 'back to the same samples');
});

check('date-dependent forces use each satellite\'s own time: restarting from a later state changes nothing', () => {
    S.set({ propagator: 'cowell', forces: { j22: true, sun: true, moon: true }, startMs: Date.UTC(2026, 10, 20) });
    const day = 86400;
    const first = P.fromElements({ a: 7000, e: 0.01, i: 40, raan: 10, argp: 0, nu: 0 }, 0);
    const mid = P.stateAt(first, day);                       // the same spacecraft, stored again at t = 1 day
    const restarted = P.satellite(mid.r, mid.v, day);
    const a = P.stateAt(first, 1.5 * day).r, b = P.stateAt(restarted, 1.5 * day).r;
    assert.ok(dist(a, b) < 1e-3, `restarted copy is ${dist(a, b).toFixed(4)} km away`);
});

check('Inertial Rendezvous: a plan flown with Cowell and no forces arrives within 1 mm; with J2 it misses', () => {
    const R = OM.rendezvous;
    const plan = R.solveCoplanar({ Rchase: 6678, Rtarget: 42164, phi0: 30 });
    assert.strictEqual(R.missAtArrival(plan), null, 'Kepler: no miss to show');
    S.set({ propagator: 'cowell' });
    assert.ok(R.missAtArrival(plan) < 1e-6, `forces off: ${R.missAtArrival(plan)} km`);
    // Before arrival the chase is where the two-body plan puts it.
    const t = 0.6 * plan.arrival;
    S.set({ propagator: 'kepler' });
    const kep = R.stateAt(plan, t).chase.r;
    S.set({ propagator: 'cowell' });
    assert.ok(dist(R.stateAt(plan, t).chase.r, kep) < 1e-6);
    S.set({ forces: { j2: true } });
    const withJ2 = R.solveCoplanar({ Rchase: 6678, Rtarget: 42164, phi0: 30 });
    assert.ok(R.missAtArrival(withJ2) > 1, `J2: ${R.missAtArrival(withJ2)} km`);
});

check('budget: 5 LEO orbits sampled with every force on in under 50 ms per satellite (median of 5)', () => {
    S.set({ propagator: 'cowell', forces: { j2: true, j34: true, j22: true, drag: true, sun: true, moon: true, srp: true } });
    const times = [];
    for (let run = 0; run < 5; run++) {
        const sat = P.fromElements({ ...PAGE_ORBITS[0][1], raan: 30 + run });
        const t0 = process.hrtime.bigint();
        const span = 5 * periodOf(6778);
        for (let k = 0; k <= 600; k++) P.stateAt(sat, span * k / 600);
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    times.sort((x, y) => x - y);
    console.log(`      median ${times[2].toFixed(1)} ms (runs: ${times.map((x) => x.toFixed(1)).join(', ')})`);
    assert.ok(times[2] < 50, `median ${times[2].toFixed(1)} ms`);
});

check('Frame Observatory: the RIC axes follow the drawn target with Cowell and J2 on', () => {
    S.set({ propagator: 'cowell', forces: { j2: true } });
    const Fr = OM.frames, D2R = Math.PI / 180;
    const s = Fr.makeScenario({ radius: 7000, inclination: 51.6 * D2R, raan: 30 * D2R, startAngle: 0,
        separation: 20, tiltOffset: 0.2 * D2R, siteLongitude: 0 });
    for (const t of [0, 5400, 86400]) {
        const r = Fr.positionEci(s.target, t), b = Fr.ricBasis(s, t);
        const along = (r[0] * b.R[0] + r[1] * b.R[1] + r[2] * b.R[2]) / Math.hypot(...r);
        assert.ok(1 - along < 1e-12, `R axis off the target by ${Math.acos(Math.min(1, along)) / D2R} deg at t = ${t} s`);
        const own = Fr.coordinates('RIC', r, t, s);
        assert.ok(Math.hypot(...own) < 1e-9, 'target not at the RIC origin');
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
