// Run with: node _tests/orbits-math.test.js
// Checks the math behind the inertial-frame tools (Orbital Maneuvers, Inertial Rendezvous,
// Perturbations, Sun-Synchronous, Ground Track, Reference Frame Observatory, Solar vs. Sidereal
// Day) against published values and against the same physics worked again here by another
// route (bisection for Kepler's equation, velocity vectors for plane changes, flying a plan to
// see that the spacecraft meet). The page math lives in assets/orbit-math.js and is checked there,
// bound to the constants each page uses.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
const OM = require('../assets/orbit-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const TRM = require('../practice/test-review-math.js');
const OC = globalThis.OrbitConstants;
// Each section bound to the constants its page uses until the constants setting arrives.
const OMW = OM.bind(TEST_SET);
const RM = OMW.rendezvous;
const Rpo = OM.bind(TEST_SET).rpo;
const MP = OMW.maneuver;
const PM = OM.bind(TEST_SET).perturbation;
const FM = OMW.frames;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + (err.stack || err.message).split('\n').slice(0, 3).join('\n      ')); }
}
function near(got, want, tol, what) {
    assert.ok(Math.abs(got - want) <= tol, `${what || 'value'}: got ${got}, want ${want} (tolerance ${tol})`);
}
function nearRel(got, want, rel, what) {
    assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${what || 'value'}: got ${got}, want ${want} (relative tolerance ${rel})`);
}
function nearVec(got, want, tol, what) {
    want.forEach((w, k) => near(got[k], w, tol, `${what || 'vector'}[${k}]`));
}
// Small fixed-seed generator, so a failure repeats.
let seed = 20261118;
function rnd(lo, hi) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return lo + (hi - lo) * seed / 4294967296;
}

const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ------------------------------------------------------------------ */
/* Independent math, written here                                     */
/* ------------------------------------------------------------------ */
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a) => scale(a, 1 / norm(a));
const wrapDeg = (x) => ((x % 360) + 540) % 360 - 180;          // to (-180, 180]

// Kepler's equation E - e sin E = M by bisection: slow, but it cannot fail to converge.
function keplerBisect(M, e) {
    const m = ((M % TWO_PI) + TWO_PI) % TWO_PI;
    let lo = 0, hi = TWO_PI;
    for (let k = 0; k < 200; k++) {
        const mid = (lo + hi) / 2;
        if (mid - e * Math.sin(mid) < m) lo = mid; else hi = mid;
    }
    return Math.floor(M / TWO_PI) * TWO_PI + (lo + hi) / 2;
}

// Position and velocity from elements (km, degrees), through the perifocal frame and the
// rotation R3(-raan) R1(-i) R3(-argp).
function coeToRv(a, e, iDeg, raanDeg, argpDeg, nuDeg, mu) {
    const p = a * (1 - e * e);
    const nu = nuDeg * D2R;
    const r = p / (1 + e * Math.cos(nu));
    const rp = [r * Math.cos(nu), r * Math.sin(nu), 0];
    const vp = [-Math.sqrt(mu / p) * Math.sin(nu), Math.sqrt(mu / p) * (e + Math.cos(nu)), 0];
    const rot = (x) => {
        const [O, i, w] = [raanDeg * D2R, iDeg * D2R, argpDeg * D2R];
        const x1 = [x[0] * Math.cos(w) - x[1] * Math.sin(w), x[0] * Math.sin(w) + x[1] * Math.cos(w), x[2]];
        const x2 = [x1[0], x1[1] * Math.cos(i) - x1[2] * Math.sin(i), x1[1] * Math.sin(i) + x1[2] * Math.cos(i)];
        return [x2[0] * Math.cos(O) - x2[1] * Math.sin(O), x2[0] * Math.sin(O) + x2[1] * Math.cos(O), x2[2]];
    };
    return { r: rot(rp), v: rot(vp) };
}

// Two-body propagation of an ellipse by Kepler's equation (bisection), from any r, v.
function keplerPropagate(r0, v0, dt, mu) {
    const R = norm(r0), V = norm(v0);
    const a = 1 / (2 / R - V * V / mu);
    const h = cross(r0, v0);
    const eVec = scale(sub(scale(r0, V * V - mu / R), scale(v0, dot(r0, v0))), 1 / mu);
    const e = norm(eVec);
    const P = e > 1e-10 ? unit(eVec) : unit(r0);
    const Q = cross(unit(h), P);
    const nu0 = Math.atan2(dot(r0, Q), dot(r0, P));
    const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2), Math.sqrt(1 + e) * Math.cos(nu0 / 2));
    const n = Math.sqrt(mu / (a * a * a));
    const E = keplerBisect(E0 - e * Math.sin(E0) + n * dt, e);
    const b = a * Math.sqrt(1 - e * e);
    const r = a * (1 - e * Math.cos(E));
    const k = Math.sqrt(mu * a) / r;
    return {
        r: add(scale(P, a * (Math.cos(E) - e)), scale(Q, b * Math.sin(E))),
        v: add(scale(P, -k * Math.sin(E)), scale(Q, k * Math.sqrt(1 - e * e) * Math.cos(E)))
    };
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */
check('constants: no orbital constant is written anywhere but assets/orbit-constants.js', () => {
    // Named constants given a number, and the numbers themselves, wherever they appear in code.
    const named = /const (MU|LESSON_MU|RE|R_E|R_EARTH|LESSON_R_EARTH|J2|J22|LON22|OMEGA_E|G0|GEO_A|R_GEO)\s*=\s*-?[0-9.]+(?:e-?\d+)?\s*[;,]/g;
    const literal = /(?<![\w.])(398600\.4\d*|6378(?:\.\d+)?|1\.0826\d*e-3|7\.2921\d*e-5|9\.81|9\.80665|42164(?:\.\d+)?)(?![\w.])/g;
    const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    const problems = [];
    for (const dir of ['orbits', 'frames', 'time', 'rpo', 'practice', 'assets']) {
        for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js'))) {
            if (dir === 'assets' && (file === 'orbit-constants.js' || file === 'vendor.js' || file.startsWith('earth-land'))) continue;
            const code = stripComments(source(`${dir}/${file}`));
            for (const m of code.matchAll(named)) problems.push(`${dir}/${file}: ${m[0]}`);
            for (const m of code.matchAll(literal)) problems.push(`${dir}/${file}: ${m[1]}`);
        }
    }
    assert.deepStrictEqual(problems, [], 'constants written outside orbit-constants.js');
});

/* ------------------------------------------------------------------ */
/* Kepler's equation                                                  */
/* ------------------------------------------------------------------ */
check("Kepler's equation: every solver agrees with bisection for e up to 0.9", () => {
    const solvers = {
        'assets/orbit-math.js kepler.solve': OM.kepler.solve,
        'assets/orbit-math.js rpo.keplerE': Rpo.keplerE,
        'assets/orbit-math.js perturbation.solveKepler': PM.solveKepler,
        'practice/test-review-math.js groundTrack.solveKepler': TRM.groundTrack.solveKepler,
        'practice/test-review-math.js kepler.solve': TRM.kepler.solve
    };
    for (const [name, solve] of Object.entries(solvers)) {
        for (const e of [0, 0.01, 0.3, 0.6, 0.75, 0.8, 0.85, 0.9]) {
            for (let k = 0; k <= 720; k++) {
                const M = k / 720 * TWO_PI;
                const E = solve(M, e);
                const residual = Math.atan2(Math.sin(E - e * Math.sin(E) - M), Math.cos(E - e * Math.sin(E) - M));
                assert.ok(Math.abs(residual) < 1e-12, `${name}: e = ${e}, M = ${M}: residual ${residual}`);
                near(wrapDeg((E - keplerBisect(M, e)) * R2D), 0, 1e-9, `${name}: e = ${e}, M = ${M}`);
            }
        }
    }
    // The Observatory's solver is private; check it through positionEci, for e up to 0.9.
    for (let k = 0; k < 200; k++) {
        const e = rnd(0, 0.9), a = rnd(7000, 45000);
        const s = FM.makeScenario({ radius: a, inclination: rnd(0, Math.PI), raan: rnd(0, TWO_PI), startAngle: rnd(0, TWO_PI), separation: e * a, tiltOffset: 0, siteLongitude: 0 });
        const el = s.second;                                  // e = separation / a, argp = 40 deg
        const t = rnd(0, 3) * TWO_PI / el.n;
        const E = keplerBisect(el.M0 + el.n * t, el.e);
        const want = add(scale(el.P, el.a * (Math.cos(E) - el.e)), scale(el.Q, el.b * Math.sin(E)));
        nearVec(FM.positionEci(el, t), want, 1e-6 * a, `Observatory position ${k}`);
    }
});

/* ------------------------------------------------------------------ */
/* Propagation                                                         */
/* ------------------------------------------------------------------ */
check('universal-variable propagation (Inertial Rendezvous) matches Kepler propagation, 300 orbits', () => {
    const mu = RM.constants.MU;
    for (let k = 0; k < 300; k++) {
        const a = rnd(6700, 50000), e = rnd(0, 0.9);
        const s = coeToRv(a, e, rnd(0, 180), rnd(0, 360), rnd(0, 360), rnd(0, 360), mu);
        const dt = rnd(-1, 3) * TWO_PI * Math.sqrt(a * a * a / mu);
        const got = RM.propagate(s.r, s.v, dt, mu);
        const want = keplerPropagate(s.r, s.v, dt, mu);
        nearVec(got.r, want.r, 1e-7 * a, `r ${k}`);
        nearVec(got.v, want.v, 1e-7 * norm(s.v), `v ${k}`);
        // Energy and angular momentum are kept.
        nearRel(norm(got.v) ** 2 / 2 - mu / norm(got.r), norm(s.v) ** 2 / 2 - mu / norm(s.r), 1e-9, `energy ${k}`);
        nearVec(cross(got.r, got.v), cross(s.r, s.v), 1e-7 * norm(cross(s.r, s.v)), `h ${k}`);
    }
});

/* ------------------------------------------------------------------ */
/* Orbital Maneuvers                                                  */
/* ------------------------------------------------------------------ */
check('Hohmann transfer, 300 km LEO to GEO: the published values', () => {
    const h = MP.solveHohmann(6378.137 + 300, 42164);
    near(h.dv1, 2.426, 0.001, 'dV1 km/s');
    near(h.dv2, 1.467, 0.001, 'dV2 km/s');
    near(h.dv_total, 3.893, 0.001, 'total km/s');
    near(h.tof_s / 3600, 5.275, 0.005, 'transfer time h');
});

check('plane changes and combined maneuvers equal the velocity-vector difference, 200 each', () => {
    const mu = MP.MU, RE = MP.R_EARTH;
    for (let k = 0; k < 200; k++) {
        // Inclination change at a node: both orbits share the node line, so the burn point is the same.
        const r = rnd(6700, 45000), i1 = rnd(0, 170), i2 = rnd(0, 170), raan = rnd(0, 360);
        const inc = MP.solveInclinationChange(r - RE, i1, i2, raan, 45);
        for (const u of [0, 180]) {
            const before = coeToRv(r, 0, i1, raan, 0, u, mu), after = coeToRv(r, 0, i2, raan, 0, u, mu);
            nearVec(before.r, after.r, 1e-6, `same point ${k}`);
            nearRel(inc.dv, norm(sub(after.v, before.v)), 1e-9, `inclination dV ${k}`);
        }
        nearRel(inc.v, Math.sqrt(mu / r), 1e-12, `speed ${k}`);
        // Polar RAAN change over a pole (u = 90 deg): both polar orbits pass through it.
        const O1 = rnd(0, 180), O2 = rnd(0, 180);
        const pol = MP.solvePolarRaanChange(r - RE, O1, O2, 30);
        const b = coeToRv(r, 0, 90, O1, 0, 90, mu), c = coeToRv(r, 0, 90, O2, 0, 90, mu);
        nearVec(b.r, c.r, 1e-6, `pole ${k}`);
        nearRel(pol.dv, norm(sub(c.v, b.v)), 1e-9, `polar RAAN dV ${k}`);
        // Combined: the plane change rides on the burn at the higher orbit, at the node.
        const R1 = rnd(6700, 45000), R2 = rnd(6700, 45000), j1 = rnd(0, 60), j2 = rnd(0, 60);
        const cmb = MP.solveCombined(R1, R2, j1, j2);
        const aTx = (R1 + R2) / 2, eTx = Math.abs(R2 - R1) / (R1 + R2);
        const high = Math.max(R1, R2), low = Math.min(R1, R2);
        // On the transfer, the higher end is apogee (nu = 180) and the lower end perigee (nu = 0).
        const txHighOld = coeToRv(aTx, eTx, j1, 0, 0, 180, mu), txHighNew = coeToRv(aTx, eTx, j2, 0, 0, 180, mu);
        const circHighOld = coeToRv(high, 0, j1, 0, 180, 0, mu), circHighNew = coeToRv(high, 0, j2, 0, 180, 0, mu);
        const raise = R2 >= R1;
        const dvHigh = raise ? norm(sub(circHighNew.v, txHighOld.v)) : norm(sub(txHighNew.v, circHighOld.v));
        const dvLow = Math.abs(Math.sqrt(mu * (2 / low - 1 / aTx)) - Math.sqrt(mu / low));
        nearRel(raise ? cmb.dv2 : cmb.dv1, dvHigh, 1e-9, `combined burn ${k}`);
        nearRel(raise ? cmb.dv1 : cmb.dv2, dvLow, 1e-9, `coplanar burn ${k}`);
        nearRel(cmb.dv_total, dvHigh + dvLow, 1e-9, `combined total ${k}`);
        nearRel(cmb.tof_s, Math.PI * Math.sqrt(aTx ** 3 / mu), 1e-12, `transfer time ${k}`);
    }
});

/* ------------------------------------------------------------------ */
/* Inertial Rendezvous                                                */
/* ------------------------------------------------------------------ */
check('coplanar rendezvous: in the animation the chase reaches the target, 200 cases', () => {
    for (let k = 0; k < 200; k++) {
        const Rchase = rnd(6700, 30000), Rtarget = Rchase * rnd(0.5, 2);
        if (Math.abs(Rchase - Rtarget) < 100) continue;
        const m = RM.solveCoplanar({ Rchase, Rtarget, phi0: rnd(0, 360) });
        assert.ok(m.WT >= 0 && m.WT < m.T_syn, `wait ${m.WT} is the first opportunity (synodic period ${m.T_syn})`);
        const t = m.arrival - 1e-3;
        const s = RM.stateAt(m, t);
        assert.ok(norm(sub(s.chase.r, s.target.r)) < 0.05, `case ${k}: miss distance ${norm(sub(s.chase.r, s.target.r))} km`);
        // Before the burn the chase is on its own orbit; after it, on a Hohmann ellipse.
        near(norm(RM.stateAt(m, m.WT / 2).chase.r), Rchase, 1e-6, `chase radius before ${k}`);
        near(norm(s.chase.r), Rtarget, 1e-3, `chase radius at arrival ${k}`);
    }
});

check('co-orbital rendezvous: in the animation the chase reaches the target, 200 cases', () => {
    for (let k = 0; k < 200; k++) {
        const R = rnd(7000, 30000);
        const phi0 = rnd(5, 355);
        const m = RM.solveCoOrbital({ Rchase: R, phi0, k: 1 + Math.floor(rnd(0, 3)) });
        if (m.h_p < 100) continue;
        const s = RM.stateAt(m, m.arrival - 1e-3);
        assert.ok(norm(sub(s.chase.r, s.target.r)) < 0.05, `case ${k}: miss distance ${norm(sub(s.chase.r, s.target.r))} km`);
        // The phasing orbit's ends: the burn point is one apsis.
        const a = m.a_phasing;
        near(Math.min(m.r_p, m.r_a), Math.min(R, 2 * a - R), 1e-6, `perigee ${k}`);
    }
});

/* ------------------------------------------------------------------ */
/* Perturbations                                                      */
/* ------------------------------------------------------------------ */
check('drag: the atmosphere table has no typing errors (each band meets the next within 0.5%)', () => {
    const T = PM.DENSITY;
    for (let k = 0; k < T.length - 1; k++) {
        const [h0, rho0, H] = T[k];
        const top = rho0 * Math.exp(-(T[k + 1][0] - h0) / H);
        nearRel(top, T[k + 1][1], 0.005, `band ${h0} km reaching ${T[k + 1][0]} km`);
    }
});

check('drag: circular decay rate is -rho B sqrt(mu a), and the lifetime integration agrees with an independent one', () => {
    for (const h of [250, 400, 600, 800]) {
        const a = PM.RE + h, B = PM.CD * 0.01;
        const want = -PM.density(h) * B * Math.sqrt(PM.MU * a) * 1000;      // km/s; B rho is per meter
        nearRel(PM.dragRates(a, 0, B).da, want, 1e-6, `da/dt at ${h} km`);
    }
    // Lifetime from 400 km, nominal area-to-mass, mean sun: RK4 written here, with small steps.
    const B = PM.CD * PM.AREA.nominal * PM.SOLAR.mean;
    const rate = (a) => -PM.density(a - PM.RE) * B * Math.sqrt(PM.MU * a) * 1000;
    let a = PM.RE + 400, t = 0;
    while (a - PM.RE > 100) {
        const dt = Math.min(3600 * 6, 0.2 / Math.abs(rate(a)));
        const k1 = rate(a), k2 = rate(a + k1 * dt / 2), k3 = rate(a + k2 * dt / 2), k4 = rate(a + k3 * dt);
        a += dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
        t += dt;
    }
    const tool = PM.decayHistory({ hp: 400, ha: 400, areaToMass: PM.AREA.nominal, solar: 'mean' });
    assert.ok(tool.reentered, 'reenters');
    nearRel(tool.days, t / 86400, 0.01, 'lifetime in days');
});

check('J2: node and perigee rates, sun-synchronous inclination, critical inclination', () => {
    // Published: sun-synchronous at 800 km is about 98.6 deg; the ISS node moves about -5.0 deg/day.
    near(PM.sunSyncInclination(PM.RE + 800), 98.6, 0.05, 'SSO inclination at 800 km');
    near(PM.j2Rates(PM.RE + 400, 0, 51.6).nodeDegDay, -5.0, 0.1, 'ISS node rate');
    // The rates, worked again: dOmega/dt = -1.5 n J2 (R/p)^2 cos i, domega/dt = 0.75 n J2 (R/p)^2 (5 cos^2 i - 1).
    for (let k = 0; k < 200; k++) {
        const a = rnd(6700, 30000), e = rnd(0, 0.7), i = rnd(0, 180);
        const p = a * (1 - e * e), n = Math.sqrt(PM.MU / a ** 3), f = n * PM.J2 * (PM.RE / p) ** 2 * 86400 * R2D;
        const r = PM.j2Rates(a, e, i);
        near(r.nodeDegDay, -1.5 * f * Math.cos(i * D2R), 1e-9, `node rate ${k}`);
        near(r.perigeeDegDay, 0.75 * f * (5 * Math.cos(i * D2R) ** 2 - 1), 1e-9, `perigee rate ${k}`);
    }
    // Critical inclination: 5 cos^2 i = 1.
    near(PM.CRITICAL_INC[0], Math.acos(Math.sqrt(0.2)) * R2D, 1e-4, 'critical inclination');
    // A sun-synchronous orbit's node turns with the mean sun, 360 deg a year.
    for (const h of [400, 600, 800, 1000]) {
        const i = PM.sunSyncInclination(PM.RE + h);
        near(PM.j2Rates(PM.RE + h, 0, i).nodeDegDay, 360 / 365.2422, 1e-4, `SSO node rate at ${h} km`);
    }
});

check('J2,2 at GEO: acceleration, stable points, libration period, east-west budget', () => {
    const R = PM.R_GEO;
    // Tangential acceleration from the J2,2 potential term, and the longitude acceleration it gives.
    const aLambdaMax = 6 * PM.MU * PM.RE ** 2 * PM.J22 / R ** 4;                  // km/s^2
    for (let lon = -180; lon <= 180; lon += 15) {
        near(PM.tangentialAccel(lon), -aLambdaMax * Math.sin(2 * (lon - PM.LON22) * D2R) * 1000, 1e-15, `a_lambda at ${lon}`);
        near(PM.longitudeAccel(lon), -3 * PM.tangentialAccel(lon) / 1000 / R, 1e-20, `lambda'' at ${lon}`);
    }
    // Stable points pull back; unstable points push away.
    for (const lon of PM.STABLE_LON) assert.ok(PM.longitudeAccel(lon + 1) < 0 && PM.longitudeAccel(lon - 1) > 0, `stable at ${lon}`);
    for (const lon of PM.UNSTABLE_LON) assert.ok(PM.longitudeAccel(lon + 1) > 0 && PM.longitudeAccel(lon - 1) < 0, `unstable at ${lon}`);
    // Libration period: integrate the pendulum here and time a full swing.
    for (const amp of [5, 30, 60]) {
        let lon = (75 + amp) * D2R, rate = 0, t = 0, crossings = 0, first = null, prev = lon;
        const acc = (x) => PM.K22 * Math.sin(2 * (x - PM.LON22 * D2R));
        const h = 3600;
        while (crossings < 3) {
            const k1v = acc(lon), k1x = rate;
            const k2v = acc(lon + k1x * h / 2), k2x = rate + k1v * h / 2;
            const k3v = acc(lon + k2x * h / 2), k3x = rate + k2v * h / 2;
            const k4v = acc(lon + k3x * h), k4x = rate + k3v * h;
            lon += h / 6 * (k1x + 2 * k2x + 2 * k3x + k4x);
            rate += h / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
            t += h;
            if ((prev - 75 * D2R) * (lon - 75 * D2R) < 0) {
                const tc = t - h * (lon - 75 * D2R) / (lon - prev);
                if (first === null) first = tc;
                crossings++;
                if (crossings === 3) nearRel(tc - first, PM.librationPeriodDays(amp) * 86400, 0.005, `period at amplitude ${amp}`);
            }
            prev = lon;
        }
    }
    const small = PM.librationPeriodDays(1);
    assert.ok(small > 780 && small < 900, `small-amplitude libration ${small} days (published: about 2.2 to 2.4 years)`);
    // The east-west budget uses the lesson's printed 1.715 m/s/yr; the model's own formula gives
    // a value 2% higher. Both are inside the published "about 1.7 m/s per year".
    const formula = aLambdaMax * 1000 * 365.25 * 86400;
    nearRel(PM.eastWestDvPerYear(PM.LON22 + 45), formula, 0.03, 'east-west m/s per year at the worst longitude');
});

check('third-body gravity at GEO: exact on the body line and at right angles, and the far-body limit', () => {
    const r = PM.R_GEO;
    const across = unit(cross(PM.BODY_DIRECTION, [1, 0, 0]));       // at right angles to the body line
    for (const [mu, d, name] of [[PM.MU_MOON, PM.D_MOON, 'Moon'], [PM.MU_SUN, PM.D_SUN, 'Sun']]) {
        const body = scale(PM.BODY_DIRECTION, d);
        // On the line toward the body: mu [1 / (d - r)^2 - 1 / d^2], pointing at the body.
        const onLine = PM.thirdBodyAccel(mu, body, scale(PM.BODY_DIRECTION, r));
        nearRel(dot(onLine, PM.BODY_DIRECTION), mu * (1 / (d - r) ** 2 - 1 / d ** 2) * 1000, 1e-9, `${name} on the line (m/s^2)`);
        // At right angles: pulled back toward Earth's center by mu r / (d^2 + r^2)^1.5, and along
        // the body line by mu d [1 / (d^2 + r^2)^1.5 - 1 / d^3].
        const side = PM.thirdBodyAccel(mu, body, scale(across, r));
        const q = (d * d + r * r) ** 1.5;
        nearRel(dot(side, across), -mu * r / q * 1000, 1e-9, `${name} at right angles, inward`);
        near(dot(side, PM.BODY_DIRECTION), mu * d * (1 / q - 1 / d ** 3) * 1000, 1e-15, `${name} at right angles, along the line`);
    }
    // Far from the body the on-line pull tends to the tidal 2 mu r / d^3 (the Sun at GEO: r/d = 3e-4).
    const sun = PM.thirdBodyAccel(PM.MU_SUN, scale(PM.BODY_DIRECTION, PM.D_SUN), scale(PM.BODY_DIRECTION, r));
    nearRel(norm(sun), 2 * PM.MU_SUN * r / PM.D_SUN ** 3 * 1000, 0.001, 'Sun, tidal limit');
});

/* ------------------------------------------------------------------ */
/* Page scripts                                                       */
/* ------------------------------------------------------------------ */
check('Sun-Synchronous page: 98.6 deg at 800 km, and its node keeps pace with the mean sun', () => {
    const P = OMW.sunSync;
    const a = P.RE + 800;
    const i = Math.acos(P.sunSyncCos(a));
    near(i * R2D, 98.6, 0.05, 'inclination');
    near(P.nodalRate(a, i) * 86400 * R2D, 360 / 365.2422, 1e-6, 'node rate deg/day');
    near(i * R2D, PM.sunSyncInclination(PM.RE + 800), 0.01, 'agrees with the Perturbations Explorer');
});

check('Solar vs. Sidereal Day page: the sidereal day is 86,164.09 s', () => {
    const P = OMW.earthRotation;
    near(P.SIDEREAL_DAY, 86164.0905, 0.01, 'seconds');
});

check('Ground Track page: equal-time motion along the orbit, and Earth turning at 15.04 deg/h', () => {
    const P = OMW.groundTrack;
    near(P.EARTH_DEG_PER_HOUR, 360 / (86164.0905 / 3600), 1e-3, 'deg/h');
    // The page's satellite moves with OrbitMath.propagate (Kepler by default).
    const PR = OM.propagate, EL = OM.elements;
    for (let k = 0; k < 300; k++) {
        const e = rnd(0, 0.85), nu0 = rnd(0, 360), f = rnd(0, 1);
        const el = { a: 8000 + rnd(0, 30000), e, i: rnd(0, 120), raan: rnd(0, 360), argp: rnd(0, 360), nu: nu0 };
        const sat = PR.fromElements(el);
        const s = PR.stateAt(sat, f * 2 * Math.PI * Math.sqrt(el.a ** 3 / TEST_SET.mu));
        const nu1 = EL.elementsFromRv(s.r, s.v, el).nu;
        // Mean anomaly, worked here by the half-angle formula, must grow by exactly f of a turn.
        const M = (nu) => {
            const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu * D2R / 2));
            return E - e * Math.sin(E);
        };
        near(wrapDeg((M(nu1) - M(nu0)) * R2D - 360 * f), 0, 1e-6, `case ${k}`);
    }
});

check('Reference Frame Observatory: GEO radius, sidereal day, RIC axes, ECEF, sun direction', () => {
    // GEO radius from the set's mu and omegaE, and close to the true 42,164.2 km in either set.
    near(FM.GEO_RADIUS, Math.cbrt(TEST_SET.mu / TEST_SET.omegaE ** 2), 1e-6, 'GEO radius km');
    near(FM.GEO_RADIUS, 42164.2, 0.1, 'GEO radius near the true value');
    // One turn at the set's rate: 86,164.10 s for WGS-84 (7.292115e-5 rad/s), 86,164.28 s for the
    // course's rounded 7.2921e-5 rad/s; the true sidereal day is 86,164.0905 s.
    near(FM.SIDEREAL_DAY, 2 * Math.PI / TEST_SET.omegaE, 1e-6, 'sidereal day s');
    near(FM.SIDEREAL_DAY, 86164.0905, 0.2, 'sidereal day near the true value');
    const s = FM.makeScenario({ radius: 7000, inclination: 51.6 * D2R, raan: 0.5, startAngle: 1, separation: 5, tiltOffset: 0.001, siteLongitude: 0.3 });
    for (let k = 0; k < 50; k++) {
        const t = rnd(0, 20000);
        const b = FM.ricBasis(s, t);
        [b.R, b.I, b.C].forEach((v, j) => near(norm(v), 1, 1e-12, `unit ${j}`));
        near(dot(b.R, b.I), 0, 1e-12); near(dot(b.I, b.C), 0, 1e-12); near(dot(b.C, b.R), 0, 1e-12);
        const p = FM.positionEci(s.target, t);
        nearVec(b.R, unit(p), 1e-9, 'R along the position');
        const v = sub(FM.positionEci(s.target, t + 0.01), FM.positionEci(s.target, t - 0.01));
        nearVec(b.C, unit(cross(p, v)), 1e-6, 'C along the angular momentum');
        nearVec(FM.coordinates('RIC', p, t, s), [0, 0, 0], 1e-9, 'the target is the RIC origin');
    }
    // A circular equatorial orbit at the GEO radius stays put in ECEF.
    const g = FM.makeScenario({ radius: FM.GEO_RADIUS, inclination: 0, raan: 0, startAngle: 0, separation: 0, tiltOffset: 0, siteLongitude: 0 });
    const start = FM.coordinates('ECEF', FM.positionEci(g.target, 0), 0, g);
    for (let t = 0; t <= 86400; t += 3600) nearVec(FM.coordinates('ECEF', FM.positionEci(g.target, t), t, g), start, 1e-6, `GEO in ECEF at ${t} s`);
    // The sun's declination reaches 23.44 deg a quarter year after the March equinox.
    near(Math.asin(FM.sunDirection(365.2422 * 86400 / 4)[2]) * R2D, 23.44, 1e-6, 'June solstice declination');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
