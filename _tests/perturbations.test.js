// Run with: node _tests/perturbations.test.js
// Checks math/propagation/perturbations.js (the perturbation forces for Cowell's method) against references that do
// not share its code: gradients of the textbook potentials, Meeus's worked examples for sidereal time,
// the Sun and the Moon, closed-form third-body values, the Perturbations Explorer's J2,2 and drag
// formulas, and long-run behaviour (energy, GEO inclination growth, drag decay).
const assert = require('node:assert');
globalThis.window = globalThis;
const OM = require('./load-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const OC = globalThis.OrbitConstants;
const F = OM.bind(TEST_SET).forces;
const Cowell = OM.bind(TEST_SET).cowell;
const PM = OM.bind(TEST_SET).perturbation;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
function near(got, want, tol, what) {
    assert.ok(Math.abs(got - want) <= tol, `${what || 'value'}: got ${got}, want ${want} (tolerance ${tol})`);
}
let seed = 13579;
function rnd(lo, hi) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return lo + (hi - lo) * seed / 4294967296;
}

const WGS = { mu: 398600.4418, re: 6378.137, J2: 1.08262668e-3 };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EPOCH = Date.UTC(2026, 10, 19, 0, 0, 0);
const JD = F.julianDate(EPOCH);

function circular(mu, r, iDeg, uDeg = 0) {
    const i = iDeg * D2R, u = uDeg * D2R, v = Math.sqrt(mu / r);
    return {
        r: [r * Math.cos(u), r * Math.sin(u) * Math.cos(i), r * Math.sin(u) * Math.sin(i)],
        v: [-v * Math.sin(u), v * Math.cos(u) * Math.cos(i), v * Math.cos(u) * Math.sin(i)]
    };
}
// Central-difference gradient of a potential U(x, y, z).
function gradient(U, p) {
    return [0, 1, 2].map((k) => {
        const h = 1e-3 * norm(p) * 1e-3;
        const a = p.slice(), b = p.slice();
        a[k] += h; b[k] -= h;
        return (U(a) - U(b)) / (2 * h);
    });
}
function assertVecRel(got, want, rel, what) {
    const err = norm([got[0] - want[0], got[1] - want[1], got[2] - want[2]]);
    assert.ok(err <= rel * norm(want), `${what}: off by ${(err / norm(want)).toExponential(2)} relative (limit ${rel})`);
}
// Ecliptic longitude, latitude (deg) and distance of an equatorial vector.
function ecliptic(p, epsDeg = 23.4393) {
    const e = epsDeg * D2R;
    const y = p[1] * Math.cos(e) + p[2] * Math.sin(e), z = -p[1] * Math.sin(e) + p[2] * Math.cos(e);
    return { lon: ((Math.atan2(y, p[0]) * R2D) + 360) % 360, lat: Math.asin(z / norm(p)) * R2D, dist: norm(p) };
}

check('toggles: all off is two-body, unknown names refused, time needed only where it matters', () => {
    const a0 = F.makeAcceleration({}, WGS);
    const p = [7000, 300, -200];
    assert.deepStrictEqual(a0(p, [0, 7.5, 0], JD), F.twoBody(p, WGS.mu));
    const off = F.makeAcceleration(Object.fromEntries(F.FORCE_IDS.map((id) => [id, false])), WGS);
    assert.deepStrictEqual(off(p, [0, 7.5, 0], JD), F.twoBody(p, WGS.mu));
    assert.throws(() => F.makeAcceleration({ srpx: true }, WGS));
    assert.deepStrictEqual(F.FORCE_IDS, ['j2', 'j34', 'j22', 'drag', 'sun', 'moon', 'srp']);
    assert.strictEqual(F.needsTime({ j2: true, j34: true, drag: true }), false);
    for (const id of ['j22', 'sun', 'moon', 'srp']) assert.strictEqual(F.needsTime({ [id]: true }), true, id);
    assert.throws(() => F.makeAcceleration({ j2: true }, { mu: WGS.mu, re: WGS.re }), /J2/);
    assert.throws(() => F.makeAcceleration({ drag: true }, WGS, { solar: 'huge' }));
});

check('start time: Date, ms and ISO text agree; default is the clock when the file loaded', () => {
    assert.strictEqual(F.toMs(new Date(EPOCH)), EPOCH);
    assert.strictEqual(F.toMs('2026-11-19T00:00:00Z'), EPOCH);
    assert.strictEqual(F.toMs(EPOCH), EPOCH);
    assert.strictEqual(F.toMs(undefined), F.LOAD_TIME_MS);
    assert.ok(Math.abs(F.LOAD_TIME_MS - Date.now()) < 60000, 'load time is the computer clock');
    assert.throws(() => F.toMs('not a date'));
    near(F.julianDate(Date.UTC(2000, 0, 1, 12)), 2451545.0, 1e-9, 'J2000 Julian date');
});

check('J2, J3+J4 and J2,2 accelerations equal the gradient of their potentials', () => {
    const C = { ...F.DEFAULT_CONSTANTS, ...WGS };
    const P2 = (s) => 1.5 * s * s - 0.5, P3 = (s) => 2.5 * s ** 3 - 1.5 * s, P4 = (s) => (35 * s ** 4 - 30 * s * s + 3) / 8;
    const Uz = (n, Jn, P) => (p) => { const r = norm(p); return -C.mu / r * Jn * (C.re / r) ** n * P(p[2] / r); };
    const th = F.gmst(JD);
    const U22 = (p) => {
        const x = Math.cos(th) * p[0] + Math.sin(th) * p[1], y = -Math.sin(th) * p[0] + Math.cos(th) * p[1];
        const r = norm(p), lat = Math.asin(p[2] / r), lon = Math.atan2(y, x);
        return C.mu / r * (C.re / r) ** 2 * 3 * Math.cos(lat) ** 2 * (C.C22 * Math.cos(2 * lon) + C.S22 * Math.sin(2 * lon));
    };
    for (let k = 0; k < 100; k++) {
        const r = rnd(6600, 45000), lat = rnd(-85, 85) * D2R, lon = rnd(0, 360) * D2R;
        const p = [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
        assertVecRel(F.j2Accel(p, C.mu, C.re, C.J2), gradient(Uz(2, C.J2, P2), p), 1e-6, `J2 at point ${k}`);
        const U34 = (q) => Uz(3, C.J3, P3)(q) + Uz(4, C.J4, P4)(q);
        assertVecRel(F.j34Accel(p, C.mu, C.re, C.J3, C.J4), gradient(U34, p), 1e-6, `J3+J4 at point ${k}`);
        assertVecRel(F.j22Accel(p, JD, C.mu, C.re, C.C22, C.S22), gradient(U22, p), 1e-6, `J2,2 at point ${k}`);
    }
});

check('sidereal time matches Meeus examples 12.a and 12.b', () => {
    near(F.gmst(F.julianDate(Date.UTC(1987, 3, 10))) * R2D, 197.693195, 1e-5, 'GMST 1987-04-10 0h');
    near(F.gmst(F.julianDate(Date.UTC(1987, 3, 10, 19, 21))) * R2D, 128.737873, 1e-5, 'GMST 1987-04-10 19:21');
});

check('Sun position matches Meeus example 25.a (1992-10-13)', () => {
    const s = F.sunPosition(F.julianDate(Date.UTC(1992, 9, 13)));
    const e = ecliptic(s);
    near(e.lon, 199.90895, 0.02, 'longitude, deg');
    near(e.dist / F.DEFAULT_CONSTANTS.AU, 0.99766, 2e-4, 'distance, AU');
    near(Math.asin(s[2] / norm(s)) * R2D, -7.78507, 0.02, 'declination, deg');
});

check('Moon position matches Meeus example 47.a (1992-04-12)', () => {
    const e = ecliptic(F.moonPosition(F.julianDate(Date.UTC(1992, 3, 12))));
    near(e.lon, 133.162655, 0.3, 'longitude, deg');
    near(e.lat, -3.229126, 0.2, 'latitude, deg');
    near(e.dist, 368409.7, 0.003 * 368409.7, 'distance, km');
});

check('third-body acceleration matches closed forms on the body line and at right angles', () => {
    const mu = F.DEFAULT_CONSTANTS.muMoon, D = 384400;
    for (const rho of [7000, 42164, 100000]) {
        const a1 = F.thirdBodyAccel([rho, 0, 0], [D, 0, 0], mu);
        near(a1[0], mu * (1 / (D - rho) ** 2 - 1 / D ** 2), 1e-12 * mu / D ** 2, `on the line, rho ${rho}`);
        const a2 = F.thirdBodyAccel([0, rho, 0], [D, 0, 0], mu);
        const q = Math.pow(D * D + rho * rho, 1.5);
        near(a2[0], mu * (D / q - 1 / D ** 2), 1e-12 * mu / D ** 2, `right angle x, rho ${rho}`);
        near(a2[1], -mu * rho / q, 1e-12 * mu / D ** 2, `right angle y, rho ${rho}`);
    }
});

check('J2,2 along-track acceleration at GEO matches the Perturbations Explorer', () => {
    const C = { mu: PM.MU, re: PM.RE, J22: PM.J22, LON22: PM.LON22 };
    const accel = F.makeAcceleration({ j22: true }, C);
    const th = F.gmst(JD);
    for (const lonDeg of [-105, -60, -15, 0, 30, 75, 120, 165]) {
        const a = (th + lonDeg * D2R);
        const r = [PM.R_GEO * Math.cos(a), PM.R_GEO * Math.sin(a), 0];
        const east = [-Math.sin(a), Math.cos(a), 0];
        const tot = accel(r, [0, 0, 0], JD), tb = F.twoBody(r, C.mu);
        const along = dot([tot[0] - tb[0], tot[1] - tb[1], tot[2] - tb[2]], east) * 1000;   // m/s^2
        near(along, PM.tangentialAccel(lonDeg), 1e-12, `longitude ${lonDeg}`);
    }
});

check('solar radiation pressure: size at 1 AU, points away from the Sun, zero in Earth\'s shadow', () => {
    const C = F.DEFAULT_CONSTANTS, sc = { cr: 1.5, areaToMass: 0.02 };
    const sun = [0.983 * C.AU, 0, 0];                // near perihelion, so 1/d and 1/d^2 differ
    const lit = F.srpAccel([0, 42164, 0], sun, WGS.re, C.P_SUN, C.AU, sc);
    const d = [0.983 * C.AU, -42164, 0], dm = norm(d);
    const want = C.P_SUN * (C.AU / dm) ** 2 * 1.5 * 0.02 / 1000;
    near(norm(lit), want, 1e-15, 'magnitude, km/s^2');
    near(dot(lit, d) / (norm(lit) * dm), -1, 1e-12, 'direction (cosine with the Sun line)');
    near(norm(F.srpAccel([-42164, 0, 0], sun, WGS.re, C.P_SUN, C.AU, sc)), 0, 0, 'behind Earth');
    near(norm(F.srpAccel([-42164, 6300, 0], sun, WGS.re, C.P_SUN, C.AU, sc)), 0, 0, 'just inside the shadow');
    assert.ok(norm(F.srpAccel([-42164, 6400, 0], sun, WGS.re, C.P_SUN, C.AU, sc)) > 0, 'just outside the shadow');
    assert.ok(norm(F.srpAccel([42164, 0, 0], sun, WGS.re, C.P_SUN, C.AU, sc)) > 0, 'between Earth and Sun');
});

check('drag: turning atmosphere, decay rate of a 400 km polar orbit matches -rho B sqrt(mu a)', () => {
    const r = WGS.re + 400, s = circular(WGS.mu, r, 90);
    const sc = { cd: 2.2, areaToMass: 0.01, solar: 'mean' };
    const day = 86400;
    const res = Cowell.propagate(s.r, s.v, day, { constants: WGS, forces: { drag: true }, spacecraft: sc });
    const sma = (p, v) => 1 / (2 / norm(p) - dot(v, v) / WGS.mu);
    const got = sma(res.r, res.v) - r;
    const want = -PM.density(400) * 2.2 * 0.01 * Math.sqrt(WGS.mu * r) * 1000 * day;
    near(got / want, 1, 0.03, `semimajor axis change ${got.toFixed(4)} km vs ${want.toFixed(4)} km`);
    const resMax = Cowell.propagate(s.r, s.v, day, { constants: WGS, forces: { drag: true }, spacecraft: { ...sc, solar: 'max' } });
    near((sma(resMax.r, resMax.v) - r) / got, PM.SOLAR.max, 0.05, 'solar maximum scales the decay');
    // Turning air: an equatorial prograde orbit sees slower air than a retrograde one.
    const acc = F.makeAcceleration({ drag: true }, WGS, sc);
    const pro = circular(WGS.mu, r, 0, 40), retro = circular(WGS.mu, r, 180, 40);
    const dragOnly = (st) => { const a = acc(st.r, st.v, JD), b = F.twoBody(st.r, WGS.mu); return norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]); };
    const vAir = WGS.omegaE ?? F.DEFAULT_CONSTANTS.omegaE;
    near(dragOnly(pro) / dragOnly(retro), ((norm(pro.v) - vAir * r) / (norm(pro.v) + vAir * r)) ** 2, 1e-9, 'prograde vs retrograde drag ratio');
});

check('with J2 and J3+J4 on, energy (including those potentials) is conserved over 15 orbits', () => {
    const C = { ...F.DEFAULT_CONSTANTS, ...WGS };
    const s = circular(C.mu, 7000, 63);
    const P2 = (x) => 1.5 * x * x - 0.5, P3 = (x) => 2.5 * x ** 3 - 1.5 * x, P4 = (x) => (35 * x ** 4 - 30 * x * x + 3) / 8;
    const energy = (p, v) => {
        const r = norm(p), sl = p[2] / r;
        const U = C.mu / r * (1 - C.J2 * (C.re / r) ** 2 * P2(sl) - C.J3 * (C.re / r) ** 3 * P3(sl) - C.J4 * (C.re / r) ** 4 * P4(sl));
        return dot(v, v) / 2 - U;
    };
    const P = 2 * Math.PI * Math.sqrt(7000 ** 3 / C.mu);
    const out = Cowell.propagate(s.r, s.v, 15 * P, { constants: WGS, forces: { j2: true, j34: true } });
    near(energy(out.r, out.v) / energy(s.r, s.v), 1, 1e-11, 'energy ratio');
    near(cross(out.r, out.v)[2] / cross(s.r, s.v)[2], 1, 1e-11, 'h_z ratio');
});

// The textbook rate is 0.75 to 0.95 deg/yr, depending on the tilt of the Moon's orbit to the equator
// (18.6-year cycle). 2024-2026 is near the steepest tilt, so the rate should sit near the top.
// Shorter spans are dominated by the Moon's half-month and the Sun's half-year wobbles.
check('Sun and Moon tilt a GEO orbit by 0.75 to 0.95 deg in a year', () => {
    const s = circular(WGS.mu, 42164, 0);
    const out = Cowell.propagate(s.r, s.v, 365.25 * 86400, { constants: WGS, forces: { sun: true, moon: true }, epoch: EPOCH });
    const h = cross(out.r, out.v);
    const inc = Math.acos(h[2] / norm(h)) * R2D;
    assert.ok(inc > 0.75 && inc < 0.95, `inclination after a year ${inc.toFixed(4)} deg`);
});

check('trajectory carries the start time forward between samples', () => {
    const s = circular(WGS.mu, 42164, 5);
    const opts = { constants: WGS, forces: { sun: true, moon: true, j22: true, srp: true }, epoch: EPOCH };
    const traj = Cowell.trajectory(s.r, s.v, [43200, 86400, 2 * 86400], opts);
    const one = Cowell.propagate(s.r, s.v, 2 * 86400, opts);
    near(norm([traj[2].r[0] - one.r[0], traj[2].r[1] - one.r[1], traj[2].r[2] - one.r[2]]), 0, 1e-5, 'chained vs single run, km');
    const later = Cowell.propagate(s.r, s.v, 2 * 86400, { ...opts, epoch: EPOCH + 10 * 86400000 });
    assert.ok(norm([later.r[0] - one.r[0], later.r[1] - one.r[1], later.r[2] - one.r[2]]) > 1e-3, 'a different start time changes the answer');
});

check('every force on at once runs with each solver and the solvers agree', () => {
    const s = circular(WGS.mu, 6878, 51.6, 20);
    const forces = Object.fromEntries(F.FORCE_IDS.map((id) => [id, true]));
    const base = { constants: WGS, forces, epoch: EPOCH };
    const ref = Cowell.propagate(s.r, s.v, 3 * 5700, { ...base, solver: 'PD78' });
    for (const solver of ['DP45', 'RKF45', 'RK4']) {
        const out = Cowell.propagate(s.r, s.v, 3 * 5700, { ...base, solver });
        const d = norm([out.r[0] - ref.r[0], out.r[1] - ref.r[1], out.r[2] - ref.r[2]]);
        assert.ok(d < 1e-3, `${solver} differs from PD78 by ${d} km`);
    }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
