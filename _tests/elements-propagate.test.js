// Run with: node _tests/elements-propagate.test.js
// Classical elements to r and v and back (orbit-math.js, section elements), and satellites stored as
// r and v moved by the Kepler propagator (section propagate).
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('../math/orbit-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const B = OM.bind(TEST_SET);
const EL = B.elements, P = B.propagate, RM = B.rendezvous;
const MU = TEST_SET.mu;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// A repeatable random stream, so a failure can be reproduced.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const randomElements = (kind) => {
    const circular = kind.includes('circular'), equatorial = kind.includes('equatorial');
    const rp = 6600 + rand() * 40000;
    const e = circular ? 0 : rand() * 0.95;
    return {
        a: rp / (1 - e), e,
        i: equatorial ? (rand() < 0.5 ? 0 : 180) : 0.01 + rand() * 179.98,
        raan: rand() * 360, argp: rand() * 360, nu: rand() * 360
    };
};

check('elements to r, v and back round-trip on 10,000 random orbits of every kind', () => {
    const kinds = ['elliptical inclined', 'circular inclined', 'elliptical equatorial', 'circular equatorial'];
    let worstR = 0, worstAng = 0;
    for (let k = 0; k < 10000; k++) {
        const kind = kinds[k % 4];
        const el = randomElements(kind);
        const { r, v } = EL.rvFromElements(el);
        const back = EL.elementsFromRv(r, v, el);
        assert.strictEqual(back.kind, kind, `orbit ${k}`);
        assert.ok(Math.abs(back.a - el.a) / el.a < 1e-9, `a, orbit ${k}`);
        assert.ok(Math.abs(back.e - el.e) < 1e-9, `e, orbit ${k}`);
        worstAng = Math.max(worstAng, angDiff(back.i, el.i), angDiff(back.raan, el.raan), angDiff(back.argp, el.argp), angDiff(back.nu, el.nu));
        // And without the reference, the stand-in angles still give the same r and v.
        const plain = EL.elementsFromRv(r, v);
        const again = EL.rvFromElements(plain);
        worstR = Math.max(worstR, dist(again.r, r) / norm(r), dist(again.v, v) / norm(v));
    }
    assert.ok(worstAng < 1e-6, `worst angle error ${worstAng} deg`);
    assert.ok(worstR < 1e-10, `worst relative r or v error ${worstR}`);
});

check('the stand-in angles follow the usual conventions', () => {
    // Circular inclined: argp = 0 and nu is the argument of latitude.
    let s = EL.rvFromElements({ a: 7000, e: 0, i: 50, raan: 30, argp: 40, nu: 20 });
    let el = EL.elementsFromRv(s.r, s.v);
    assert.strictEqual(el.argp, 0);
    assert.ok(angDiff(el.nu, 60) < 1e-9 && angDiff(el.raan, 30) < 1e-9);
    assert.deepStrictEqual(el.undefinedAngles, { raan: false, argp: true, nu: true });
    // Elliptical equatorial: raan = 0 and argp is the longitude of periapsis.
    s = EL.rvFromElements({ a: 9000, e: 0.2, i: 0, raan: 30, argp: 40, nu: 20 });
    el = EL.elementsFromRv(s.r, s.v);
    assert.ok(el.raan === 0 && angDiff(el.argp, 70) < 1e-9 && angDiff(el.nu, 20) < 1e-9);
    // Retrograde equatorial: still measured in the direction of motion.
    s = EL.rvFromElements({ a: 9000, e: 0.2, i: 180, raan: 0, argp: 40, nu: 20 });
    el = EL.elementsFromRv(s.r, s.v);
    assert.ok(angDiff(el.i, 180) < 1e-9 && angDiff(el.argp, 40) < 1e-9 && angDiff(el.nu, 20) < 1e-9);
    // Circular equatorial: nu is the true longitude.
    s = EL.rvFromElements({ a: 42164, e: 0, i: 0, raan: 10, argp: 20, nu: 30 });
    el = EL.elementsFromRv(s.r, s.v);
    assert.ok(el.raan === 0 && el.argp === 0 && angDiff(el.nu, 60) < 1e-9);
    assert.strictEqual(el.kind, 'circular equatorial');
});

check('a worked case: Vallado example 2-6 style orbit gives the textbook r and v magnitudes', () => {
    const el = { a: 8000, e: 0.1, i: 30, raan: 40, argp: 60, nu: 90 };
    const { r, v } = EL.rvFromElements(el);
    const p = 8000 * 0.99;
    assert.ok(Math.abs(norm(r) - p) < 1e-9, 'r = p at nu = 90');
    assert.ok(Math.abs(norm(v) - Math.sqrt(MU * (2 / p - 1 / 8000))) < 1e-12, 'vis-viva');
    // The angular momentum points along the orbit normal from i and raan.
    const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const D = Math.PI / 180;
    const nHat = [Math.sin(30 * D) * Math.sin(40 * D), -Math.sin(30 * D) * Math.cos(40 * D), Math.cos(30 * D)];
    nHat.forEach((x, k) => assert.ok(Math.abs(h[k] / norm(h) - x) < 1e-12));
});

check('Kepler propagation matches the universal-variable solver and keeps energy and h', () => {
    let worst = 0;
    for (let k = 0; k < 2000; k++) {
        const el = randomElements('elliptical inclined');
        const sat = P.fromElements(el, 100);
        const period = 2 * Math.PI * Math.sqrt(el.a ** 3 / MU);
        const t = 100 + (rand() * 6 - 3) * period;
        const a = P.stateAt(sat, t);
        const b = RM.propagate(sat.r, sat.v, t - 100, MU);
        worst = Math.max(worst, dist(a.r, b.r) / norm(b.r));
        const back = EL.elementsFromRv(a.r, a.v);
        assert.ok(Math.abs(back.a - el.a) / el.a < 1e-11 && Math.abs(back.e - el.e) < 1e-10, `orbit ${k}`);
        assert.strictEqual(a.t, t);
    }
    assert.ok(worst < 1e-8, `worst relative difference ${worst}`);
});

check('Kepler propagation moves the mean anomaly by n t, exactly, across many periods', () => {
    const el = { a: 26600, e: 0.74, i: 63.4, raan: 20, argp: 270, nu: 0 };
    const n = Math.sqrt(MU / el.a ** 3);
    const sat = P.fromElements(el);
    for (const t of [1, 600, 21600, 43082, 1e6, -5000, 3.15e7]) {
        const s = P.stateAt(sat, t);
        const back = EL.elementsFromRv(s.r, s.v);
        const E = 2 * Math.atan(Math.sqrt((1 - el.e) / (1 + el.e)) * Math.tan(back.nu * Math.PI / 360));
        const M = E - el.e * Math.sin(E);
        const want = (n * t) % (2 * Math.PI);
        const diff = Math.abs(((M - want) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
        assert.ok(diff < 1e-9, `t = ${t}: mean anomaly off by ${diff}`);
    }
});

check('open orbits and zero time steps', () => {
    const sat = P.satellite([7000, 0, 0], [0, 12, 1], 0);
    const s = P.stateAt(sat, 3000);
    const b = RM.propagate(sat.r, sat.v, 3000, MU);
    assert.ok(dist(s.r, b.r) < 1e-9);
    const z = P.stateAt(sat, 0);
    assert.deepStrictEqual(z.r, sat.r);
    assert.notStrictEqual(z.r, sat.r, 'a copy, not the same array');
    const traj = P.trajectory(P.fromElements({ a: 7000, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }), [0, 10, 20]);
    assert.strictEqual(traj.length, 3);
    assert.deepStrictEqual(traj.map((x) => x.t), [0, 10, 20]);
});

check('a page tracker and the rpo states rebuild r and v when the elements change', () => {
    const tr = P.tracker();
    const el = { a: 8000, e: 0.1, i: 30, raan: 10, argp: 20, nu: 0 };
    const s1 = tr.sat(el);
    assert.strictEqual(tr.sat({ ...el }), s1, 'same elements: same satellite');
    const s2 = tr.sat({ ...el, a: 9000 });
    assert.ok(Math.abs(norm(s2.r) - 9000 * 0.9) < 1e-9, 'rebuilt for the new a');
    // move() reads the new true anomaly back, and a slider set to it does not rebuild.
    const back = tr.move({ ...el, a: 9000 }, 600);
    const moved = tr.sat({ ...el, a: 9000, nu: back.nu });
    assert.strictEqual(moved.t, 600);
    // The rpo section keeps one satellite per elements object, and rebuilds it when the object changes.
    const R = B.rpo, coe = { a: 7000, e: 0, i: 50, raan: 0, argp: 0, nu: 0 };
    const r1 = R.rvAt(coe, 0).r.slice();
    coe.nu = 90;
    const r2 = R.rvAt(coe, 0).r;
    assert.ok(dist(r1, r2) > 1000, 'moved to the new true anomaly');
    const later = R.rvAt(coe, 300).r;
    const want = P.stateAt(P.fromElements(coe), 300).r;
    assert.ok(dist(later, want) < 1e-9, 'propagated from the stored r and v');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
