// Run with: node _tests/review-math-cross-check.test.js
// practice/test-review-math.js keeps its own copy of the course equations and never calls
// assets/orbit-math.js. This test runs both files on the same random inputs under the same constant
// set and checks that they agree, so a fix made in one file and not the other shows up here.
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('../assets/orbit-math.js');
const TRM = require('../practice/test-review-math.js');
const OC = globalThis.OrbitConstants;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
// Small fixed-seed generator, so a failure repeats.
let seed = 2468;
function rnd(lo, hi) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return lo + (hi - lo) * seed / 4294967296;
}
const N = 2000;

// Deep comparison: numbers to a relative tolerance, angles in degrees modulo 360 when named so.
const ANGLE_KEYS = /^(raan|argp|nu|M0|dM0|i|u|lon|lat|theta|phi)/;
function same(a, b, path, tol = 1e-9) {
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return;
        let d = Math.abs(a - b);
        if (ANGLE_KEYS.test(path.split('.').pop())) d = Math.min(d, Math.abs(360 - d));
        assert.ok(d <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${path}: ${a} vs ${b}`);
        return;
    }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        assert.strictEqual(a, b, `${path}: ${a} vs ${b}`);
        return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (typeof a[k] === 'function' || typeof b[k] === 'function') continue;
        same(a[k], b[k], `${path}.${k}`, tol);
    }
}
function crossCheck(name, trmFn, omFn, args) {
    check(name, () => {
        for (let k = 0; k < N; k++) {
            const a = args();
            same(trmFn(...a), omFn(...a), name);
        }
    });
}

// Both files under each constant set, so the comparison is not tied to one set of numbers.
for (const setId of Object.keys(OC.SETS)) {
    const T = TRM.bind(OC.SETS[setId]);
    const O = OM.bind(OC.SETS[setId]);
    const tag = (s) => `[${setId}] ${s}`;

    /* Kepler's equation */
    crossCheck(tag('kepler.solve'), T.kepler.solve, O.kepler.solve, () => [rnd(-40, 40), rnd(0, 0.97)]);
    crossCheck(tag('groundTrack.solveKepler vs kepler.solve'), T.groundTrack.solveKepler, O.kepler.solve,
        () => [rnd(0, 2 * Math.PI), rnd(0, 0.95)]);
    crossCheck(tag('motion.trueFromMean vs energy.trueFromMean'),
        (M, e) => T.motion.trueFromMean(M, e),
        (M, e) => {
            // The practice copy keeps whole turns; the tool returns one turn. Compare on one turn.
            const nu = O.energy.trueFromMean(M, e);
            return nu + 2 * Math.PI * Math.round((T.motion.trueFromMean(M, e) - nu) / (2 * Math.PI));
        },
        () => [rnd(0, 2 * Math.PI), rnd(0, 0.95)]);

    /* Relative motion */
    const ricState = () => {
        const a = rnd(6800, 43000), n = Math.sqrt(O.rpo.MU / a ** 3);
        return [[rnd(-20, 20), rnd(-50, 50), rnd(-10, 10), rnd(-0.01, 0.01), rnd(-0.01, 0.01), rnd(-0.005, 0.005)], n];
    };
    crossCheck(tag('rpo.rmoeFromState'), T.rpo.rmoeFromState, O.rpo.rmoeFromState, ricState);
    crossCheck(tag('rpo.cwPropagate'), T.rpo.cwPropagate, O.rpo.cwPropagate, () => [...ricState(), rnd(0, 90000)]);
    crossCheck(tag('rpo.stateFromRmoe'), T.rpo.stateFromRmoe, O.rpo.stateFromRmoe, () => {
        const [s, n] = ricState();
        return [T.rpo.rmoeFromState(s, n), n, rnd(0, 90000)];
    });
    crossCheck(tag('rpo.transferVelocity'), T.rpo.transferVelocity, O.rpo.transferVelocity, () => {
        const [s, n] = ricState();
        return [s.slice(0, 3), [rnd(-20, 20), rnd(-50, 50), rnd(-10, 10)], n, rnd(600, 0.45 * 2 * Math.PI / n)];
    });
    const coe = () => ({ a: rnd(6800, 43000), e: rnd(0, 0.3), i: rnd(0, 180), raan: rnd(0, 360), argp: rnd(0, 360), nu: rnd(0, 360) });
    crossCheck(tag('rpo.coesToRv'), T.rpo.coesToRv, O.rpo.coesToRv, () => [coe()]);
    crossCheck(tag('rpo.conicFromRv'), T.rpo.conicFromRv, O.rpo.conicFromRv, () => {
        const { r, v } = O.rpo.coesToRv(coe());
        return [r, v];
    });
    crossCheck(tag('rpo.coeDifference'), T.rpo.coeDifference, O.rpo.coeDifference, () => {
        const t = coe();
        return [t, { ...t, a: t.a + rnd(-5, 5), i: t.i + rnd(-0.1, 0.1), nu: t.nu + rnd(-0.1, 0.1) }];
    });
    crossCheck(tag('rpo.relativeState'), T.rpo.relativeState, O.rpo.relativeState, () => {
        const t = coe();
        const c = { ...t, a: t.a + rnd(-5, 5), e: Math.max(0, t.e + rnd(-1e-3, 1e-3)), nu: t.nu + rnd(-0.1, 0.1) };
        return [t, c, rnd(0, 20000)];
    });

    /* State vector to elements: the practice solver against the tool's conic */
    check(tag('rvCoe.solve vs rpo.conicFromRv'), () => {
        for (let k = 0; k < N; k++) {
            const { r, v } = O.rpo.coesToRv({ a: rnd(6800, 43000), e: rnd(0.01, 0.6), i: rnd(1, 179), raan: rnd(0, 360), argp: rnd(0, 360), nu: rnd(0, 360) });
            const s = T.rvCoe.solve(r, v);
            const c = O.rpo.conicFromRv(r, v);
            same(s.eMag, c.e, 'e');
            same(s.aRaw * (1 - s.eMag * s.eMag), c.p, 'p');
            same(s.nuRaw, c.nu0 * 180 / Math.PI, 'nu', 1e-6);   // the practice solver rounds angles to 1e-6 deg
        }
    });

    /* Universal-variable Kepler and the rendezvous plans */
    crossCheck(tag('rendezvous.propagate'), T.rendezvous.propagate, O.rendezvous.propagate, () => {
        const { r, v } = O.rpo.coesToRv(coe());
        return [r, v, rnd(-40000, 40000)];
    });
    crossCheck(tag('rendezvous.solveCoplanar'), T.rendezvous.solveCoplanar, O.rendezvous.solveCoplanar,
        () => [{ Rchase: rnd(6700, 42000), Rtarget: rnd(6700, 42000), phi0: rnd(-180, 180) }]);
    crossCheck(tag('rendezvous.solveCoOrbital'), T.rendezvous.solveCoOrbital, O.rendezvous.solveCoOrbital,
        () => [{ Rchase: rnd(6700, 42000), phi0: rnd(-180, 180), k: 1 + Math.floor(rnd(0, 4)) }]);

    /* Maneuvers */
    crossCheck(tag('maneuver.solveHohmann'), T.maneuver.solveHohmann, O.maneuver.solveHohmann, () => [rnd(6600, 45000), rnd(6600, 45000)]);
    crossCheck(tag('maneuver.solveInclinationChange'), T.maneuver.solveInclinationChange, O.maneuver.solveInclinationChange,
        () => [rnd(200, 36000), rnd(0, 180), rnd(0, 180), rnd(0, 360), rnd(0, 360)]);
    crossCheck(tag('maneuver.solvePolarRaanChange'), T.maneuver.solvePolarRaanChange, O.maneuver.solvePolarRaanChange,
        () => [rnd(200, 36000), rnd(0, 360), rnd(0, 360), rnd(0, 360)]);
    crossCheck(tag('maneuver.solveCombined'), T.maneuver.solveCombined, O.maneuver.solveCombined,
        () => [rnd(6600, 45000), rnd(6600, 45000), rnd(0, 90), rnd(0, 90)]);
    crossCheck(tag('maneuverGeometry.transferU'), T.maneuverGeometry.transferU, O.maneuverGeometry.transferU,
        () => [rnd(0, 1), rnd(-0.8, 0.8)]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
