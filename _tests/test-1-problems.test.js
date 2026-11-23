// Run with: node _tests/test-1-problems.test.js
// Generates 200 problems per Test 1 Practice section and checks each answer by a separate route.
// The givens are read back from the problem statement, as a student sees them, and the answers
// are worked again from those numbers with formulas written here: Vallado's acos-and-quadrant
// route for R-V to COEs and back, velocity vectors for plane changes, flying each rendezvous
// plan to see that the spacecraft meet, a ground track drawn here, and the three propulsion
// equations. Every answer must also grade right as given and as shown, and wrong when off.
const assert = require('node:assert');
globalThis.window = globalThis;
require('./load-math.js');
require('../study/answer-check.js');
require('../assets/tex-render.js');
require('../study/test-1-practice/rv-coe-problems.js');
require('../study/test-1-practice/maneuvers-problems.js');
require('../study/test-1-practice/test-1-maneuver-problems.js');
require('../study/test-1-practice/test-1-rendezvous-problems.js');
require('../study/test-1-practice/test-1-tof-problems.js');
require('../study/test-1-practice/test-1-ground-track-problems.js');
require('../study/test-1-practice/test-1-coe-box-problems.js');
require('../study/test-1-practice/test-1-propulsion-problems.js');
require('../study/test-1-practice/test-1-law-matching.js');
const {
    AnswerCheck: Check, RvCoeProblems: Rv, Test1ManeuverProblems: Man, Test1RendezvousProblems: Rz,
    Test1TofProblems: Tof, Test1GroundTrackProblems: Gt, Test1CoeBoxProblems: Box,
    Test1PropulsionProblems: Prop, Test1LawMatching: Laws
} = globalThis;

// The generators use Math.random. A fixed seed makes every run, and every failure, repeat.
let seed = 20261118;
Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const COUNT = 200;
// The course constants, which Test 1 Practice always uses (math/constants/course.js).
const { mu: MU, re: R_EARTH } = globalThis.OrbitConstants.SETS.course;
const G0 = 9.81;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
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
const wrapDeg = (x) => ((x % 360) + 540) % 360 - 180;
function nearAngle(got, want, tol, what) {
    near(wrapDeg(got - want), 0, tol, what);
}

/* ------------------------------------------------------------------ */
/* Reading the statement                                              */
/* ------------------------------------------------------------------ */
// Without KaTeX, PracticeMath shows each formula as its TeX source in a <code> element.
function texItems(html) {
    return [...String(html).matchAll(/<code class="tex-source">([\s\S]*?)<\/code>/g)]
        .map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}
// The first number in a piece of TeX: "6{,}900\text{ km}" is 6900, "-45^\circ" is -45.
function texNumber(tex) {
    const m = tex.replace(/\{,\}/g, '').replace(/−/g, '-').match(/-?\d+(\.\d+)?/);
    assert.ok(m, `no number in "${tex}"`);
    return Number(m[0]);
}
// Each "symbol = value" given, keyed by its TeX symbol.
function givens(html) {
    const out = {};
    for (const tex of texItems(html)) {
        const k = tex.indexOf('=');
        if (k > 0) out[tex.slice(0, k).trim()] = tex.slice(k + 1).trim();
    }
    return out;
}
const given = (g, key) => {
    assert.ok(key in g, `the statement gives ${key} (it gives ${Object.keys(g).join(', ')})`);
    return texNumber(g[key]);
};

/* ------------------------------------------------------------------ */
/* Grading                                                            */
/* ------------------------------------------------------------------ */
// The shown answer, cut to what a student would type: "2.426 km/s (2426 m/s)" becomes "2.426 km/s".
const shown = (text) => String(text).split(' (')[0].trim();

// Every field: the exact answer grades right, the shown answer grades right, and an answer three
// tolerances off grades wrong.
function checkGrading(p, grade, where) {
    for (const f of p.fields) {
        const answer = p.answers[f.key];
        assert.ok(answer && answer.value !== undefined && answer.text !== undefined, `${where}: an answer for ${f.key}`);
        const g = (typed) => grade(f, typed, answer.value);
        if (f.unitType === 'check') {
            assert.strictEqual(g(answer.value ? '1' : ''), 'right', `${where}: box ${f.key}`);
            assert.strictEqual(g(answer.value ? '' : '1'), 'wrong', `${where}: box ${f.key} flipped`);
            continue;
        }
        if (answer.value === null) {
            assert.strictEqual(g('undefined'), 'right', `${where}: ${f.key} undefined`);
            assert.strictEqual(g('45'), 'wrong', `${where}: ${f.key} given a number`);
            continue;
        }
        if (f.unitType === 'zero_nonzero' || f.unitType === 'yesno') {
            assert.strictEqual(g(answer.text), 'right', `${where}: ${f.key} "${answer.text}"`);
            continue;
        }
        // A ground track period is stored in seconds, but a bare number in its box means hours.
        const typed = (x) => (f.unitType === 'period' ? `${x} s` : String(x));
        assert.strictEqual(g(typed(answer.value)), 'right', `${where}: ${f.key} exact ${answer.value}`);
        if (!/undefined/i.test(answer.text)) {
            assert.strictEqual(g(shown(answer.text)), 'right', `${where}: ${f.key} as shown, "${answer.text}"`);
        }
        const tol = f.tolerance;
        const off = tol.relative ? answer.value * (1 + 3 * tol.relative) : answer.value + Math.max(3 * tol.absolute, 1);
        assert.strictEqual(g(typed(off)), 'wrong', `${where}: ${f.key} off at ${off} (truth ${answer.value})`);
    }
}

/* ------------------------------------------------------------------ */
/* Independent orbit math                                             */
/* ------------------------------------------------------------------ */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const acosd = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * R2D;

// Position and velocity from elements (km, degrees): perifocal, then R3(-raan) R1(-i) R3(-argp).
function coeToRv(a, e, i, raan, argp, nu) {
    const p = a * (1 - e * e), f = nu * D2R, r = p / (1 + e * Math.cos(f));
    const rot = (x) => {
        const [O, I, w] = [raan * D2R, i * D2R, argp * D2R];
        const x1 = [x[0] * Math.cos(w) - x[1] * Math.sin(w), x[0] * Math.sin(w) + x[1] * Math.cos(w), x[2]];
        const x2 = [x1[0], x1[1] * Math.cos(I) - x1[2] * Math.sin(I), x1[1] * Math.sin(I) + x1[2] * Math.cos(I)];
        return [x2[0] * Math.cos(O) - x2[1] * Math.sin(O), x2[0] * Math.sin(O) + x2[1] * Math.cos(O), x2[2]];
    };
    const k = Math.sqrt(MU / p);
    return { r: rot([r * Math.cos(f), r * Math.sin(f), 0]), v: rot([-k * Math.sin(f), k * (e + Math.cos(f)), 0]) };
}

// Vallado's RV2COE: each angle by acos, then its quadrant from one component. The course's
// conventions for undefined angles: e < 0.001 is circular (omega = 0, nu = argument of latitude,
// or the true longitude when also equatorial); an equatorial orbit has Omega = 0 and omega = the
// longitude of perigee. Angles in an equatorial orbit run in the direction of travel.
function rvToCoes(r, v) {
    const R = norm(r), V = norm(v);
    const h = cross(r, v), H = norm(h);
    const n = [-h[1], h[0], 0], N = norm(n);
    const eVec = sub(r.map((c) => c * (V * V - MU / R)), v.map((c) => c * dot(r, v))).map((c) => c / MU);
    const e = norm(eVec);
    const i = acosd(h[2] / H);
    const equatorial = N < 1e-9 * H;
    const circular = e < 0.001;
    const out = { a: -MU / (2 * (V * V / 2 - MU / R)), e, i, raan: 0, argp: 0, nu: 0, circular, equatorial };
    if (!equatorial) {
        out.raan = acosd(n[0] / N);
        if (n[1] < 0) out.raan = 360 - out.raan;
    }
    if (!circular) {
        out.nu = acosd(dot(eVec, r) / (e * R));
        if (dot(r, v) < 0) out.nu = 360 - out.nu;
        if (!equatorial) {
            out.argp = acosd(dot(n, eVec) / (N * e));
            if (eVec[2] < 0) out.argp = 360 - out.argp;
        } else {
            out.argp = acosd(eVec[0] / e);
            if (eVec[1] < 0) out.argp = 360 - out.argp;
            if (i > 90) out.argp = 360 - out.argp;
        }
    } else if (!equatorial) {
        out.nu = acosd(dot(n, r) / (N * R));
        if (r[2] < 0) out.nu = 360 - out.nu;
    } else {
        out.nu = acosd(r[0] / R);
        if (r[1] < 0) out.nu = 360 - out.nu;
        if (i > 90) out.nu = 360 - out.nu;
    }
    return out;
}

/* ------------------------------------------------------------------ */
/* R-V Vectors to COEs                                                */
/* ------------------------------------------------------------------ */
check(`R-V to COEs: ${COUNT} problems, by Vallado's route and back to the vectors`, () => {
    const seen = { circular: 0, equatorial: 0, perigee: 0, apogee: 0 };
    for (let k = 0; k < COUNT; k++) {
        const p = Rv.generate();
        const vectors = texItems(p.statement).map((tex) => {
            const body = tex.match(/\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/)[1];
            return body.split('\\\\').map(texNumber);
        });
        const [r, v] = vectors;
        assert.strictEqual(vectors.length, 2, 'two vectors given');
        const c = rvToCoes(r, v);
        const A = Object.fromEntries(Object.entries(p.answers).map(([key, x]) => [key, x.value]));
        const where = `problem ${k} (r = ${r}, v = ${v})`;
        if (c.circular) {
            seen.circular++;
            near(A.a, norm(r), 1e-9, `${where}: a is the radius`);
            nearRel(c.a, A.a, 0.002, `${where}: a from the energy, with the speed rounded`);
            assert.strictEqual(A.e, 0, `${where}: e`);
        } else {
            seen[c.nu < 90 ? 'perigee' : 'apogee']++;
            nearRel(A.a, c.a, 1e-9, `${where}: a`);
            near(A.e, c.e, 1e-9, `${where}: e`);
        }
        if (c.equatorial) seen.equatorial++;
        // acos loses digits near 0 and 180 deg (about 1e-6 deg), so angles are held to 1e-4 deg,
        // still 5,000 times inside the 0.5 deg grading limit.
        near(A.i, c.i, 1e-4, `${where}: i`);
        nearAngle(A.raan, c.raan, 1e-4, `${where}: raan`);
        nearAngle(A.argp, c.argp, 1e-4, `${where}: argp`);
        nearAngle(A.nu, c.nu, 1e-4, `${where}: nu`);
        // Back again: the answers, with their conventions, rebuild the given vectors.
        const back = coeToRv(A.a, A.e, A.i, A.raan, A.argp, A.nu);
        back.r.forEach((x, j) => near(x, r[j], 1e-6 * norm(r), `${where}: r[${j}] rebuilt`));
        back.v.forEach((x, j) => near(x, v[j], c.circular ? 1e-3 : 1e-9, `${where}: v[${j}] rebuilt`));
        // The R-V fields belong to the module, the same for every problem.
        checkGrading({ ...p, fields: Rv.fields }, (f, typed, truth) => Check.grade(f.tolerance, typed, truth), where);
    }
    Object.entries(seen).forEach(([kind, n]) => assert.ok(n > 5, `${kind} problems appear (${n})`));
});

/* ------------------------------------------------------------------ */
/* COE Box Problems                                                   */
/* ------------------------------------------------------------------ */
check(`COE boxes: ${COUNT} problems, every box worked from the position vector`, () => {
    for (let k = 0; k < COUNT; k++) {
        const p = Box.generate();
        const g = givens(p.statement);
        const val = (key) => (/undefined/.test(g[key]) ? null : texNumber(g[key]));
        const e = val('e'), i = val('i');
        const circular = e === 0, equatorial = i === 0 || i === 180;
        // The position direction from the full rotation, using omega and nu where they exist.
        let rhat, u = null, nu = null;
        if (!equatorial) {
            const raan = val('\\Omega');
            if (circular) u = val('u');
            else { nu = val('\\nu'); u = (val('\\omega') + nu) % 360; }
            rhat = coeToRv(7000, circular ? 0 : e, i, raan, circular ? 0 : val('\\omega'), circular ? u : nu).r;
        } else if (!circular) {
            nu = val('\\nu');
            rhat = coeToRv(7000, e, i, 0, val('\\Pi'), nu).r;
        } else {
            rhat = coeToRv(7000, 0, i, 0, 0, val('\\ell')).r;
        }
        rhat = rhat.map((x) => x / norm(rhat));
        const zero = (x) => Math.abs(x) < 1e-9;
        const want = {
            circular, equatorial,
            prograde: i < 90, retrograde: i > 90, polar: i === 90,
            north: zero(rhat[2] - 1), south: zero(rhat[2] + 1),
            iaxis: zero(rhat[1]) && zero(rhat[2]), jaxis: zero(rhat[0]) && zero(rhat[2]), kaxis: zero(rhat[0]) && zero(rhat[1]),
            an: !equatorial && u === 0, dn: !equatorial && u === 180,
            perigee: !circular && nu === 0, apogee: !circular && nu === 180
        };
        for (const b of Box.boxes) {
            assert.strictEqual(p.answers[b.key].value, want[b.key] ? 1 : 0, `problem ${k} (${p.statement.replace(/<[^>]+>/g, ' ')}): box ${b.key}`);
        }
        checkGrading(p, (f, typed, truth) => Box.grade(f, typed, truth), `problem ${k}`);
    }
});

/* ------------------------------------------------------------------ */
/* Orbital Maneuvers                                                  */
/* ------------------------------------------------------------------ */
check(`Maneuvers: ${COUNT} problems, burns from velocity vectors`, () => {
    const vis = (r, a) => Math.sqrt(MU * (2 / r - 1 / a));
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const type = Man.types[k % Man.types.length];
        const p = Man.generate(type);
        seen.add(p.data.type);
        const g = givens(p.statement);
        const A = Object.fromEntries(Object.entries(p.answers).map(([key, x]) => [key, x.value]));
        const where = `${type} problem ${k}`;
        // The solver uses WGS-84's mu, the page prints the course's: they differ by 5e-9.
        const rel = 1e-6;
        if (type === 'hohmann' || type === 'combined') {
            const R1 = given(g, 'R_1'), R2 = given(g, 'R_2');
            const aTx = (R1 + R2) / 2;
            const high = Math.max(R1, R2), low = Math.min(R1, R2);
            let dvHigh = Math.abs(Math.sqrt(MU / high) - vis(high, aTx));
            if (type === 'combined') {
                // At the higher orbit's node, the old velocity in plane i1 and the new one in plane i2.
                const i1 = given(g, 'i_1'), i2 = given(g, 'i_2');
                const eTx = (high - low) / (high + low);
                const raise = R2 > R1;
                const before = raise ? coeToRv(aTx, eTx, i1, 0, 0, 180).v : coeToRv(high, 0, i1, 0, 180, 0).v;
                const after = raise ? coeToRv(high, 0, i2, 0, 180, 0).v : coeToRv(aTx, eTx, i2, 0, 0, 180).v;
                dvHigh = norm(sub(after, before));
            }
            const dvLow = Math.abs(vis(low, aTx) - Math.sqrt(MU / low));
            const [dv1, dv2] = R2 > R1 ? [dvLow, dvHigh] : [dvHigh, dvLow];
            nearRel(A.a_tx, aTx, rel, `${where}: a_tx`);
            nearRel(A.dv1, dv1, rel, `${where}: dv1`);
            nearRel(A.dv2, dv2, rel, `${where}: dv2`);
            nearRel(A.dv_total, dv1 + dv2, rel, `${where}: total`);
            nearRel(A.tof, Math.PI * Math.sqrt(aTx ** 3 / MU) / 60, rel, `${where}: TOF minutes`);
        } else {
            const r = given(g, 'r');
            const polar = type === 'polar_raan';
            // Polar orbits cross over the pole (u = 90); same-node orbits cross at the node (u = 0).
            const before = polar ? coeToRv(r, 0, 90, given(g, '\\Omega_1'), 0, 90) : coeToRv(r, 0, given(g, 'i_1'), given(g, '\\Omega'), 0, 0);
            const after = polar ? coeToRv(r, 0, 90, given(g, '\\Omega_2'), 0, 90) : coeToRv(r, 0, given(g, 'i_2'), given(g, '\\Omega'), 0, 0);
            assert.ok(norm(sub(before.r, after.r)) < 1e-6, `${where}: the orbits cross there`);
            const angle = acosd(dot(before.v, after.v) / (norm(before.v) * norm(after.v)));
            nearRel(A.v, Math.sqrt(MU / r), rel, `${where}: V`);
            near(A.delta_theta, angle, 1e-6, `${where}: plane change angle`);
            nearRel(A.dv, norm(sub(after.v, before.v)), rel, `${where}: dV`);
        }
        checkGrading(p, (f, typed, truth) => Man.grade(f.tolerance, typed, truth, f.unitType), where);
    }
    assert.strictEqual(seen.size, 4, 'all four kinds appear');
});

/* ------------------------------------------------------------------ */
/* Rendezvous                                                         */
/* ------------------------------------------------------------------ */
check(`Rendezvous: ${COUNT} problems, each plan flown to see that the spacecraft meet`, () => {
    for (let k = 0; k < COUNT; k++) {
        const type = Rz.types[k % Rz.types.length];
        const p = Rz.generate(type);
        const g = givens(p.statement);
        const A = Object.fromEntries(Object.entries(p.answers).map(([key, x]) => [key, x.value]));
        const where = `${type} problem ${k}`;
        const thC = given(g, '\\theta_{\\text{chase}}'), thT = given(g, '\\theta_{\\text{target}}');
        // The phase angle runs from the target to the chase, in the direction of motion.
        nearAngle(A.phi0, thC - thT, 1e-9, `${where}: phi0`);
        if (type === 'coplanar') {
            const Rc = given(g, 'R_{\\text{chase}}'), Rt = given(g, 'R_{\\text{target}}');
            const nc = Math.sqrt(MU / Rc ** 3), nt = Math.sqrt(MU / Rt ** 3);
            const aTx = (Rc + Rt) / 2, tof = Math.PI * Math.sqrt(aTx ** 3 / MU);
            nearRel(A.tof, tof, 1e-9, `${where}: TOF`);
            near(A.nu, nt * tof * R2D, 1e-6, `${where}: target travel`);
            // Fly it: wait, burn, coast half the ellipse. The chase arrives 180 deg past its burn point.
            const chaseArrives = thC + nc * A.wt * R2D + 180;
            const targetThen = thT + nt * (A.wt + tof) * R2D;
            nearAngle(chaseArrives, targetThen, 1e-6, `${where}: they meet`);
            nearAngle(A.phi_d, (thC + nc * A.wt * R2D) - (thT + nt * A.wt * R2D), 1e-6, `${where}: phase at the burn`);
            // The first chance: no earlier wait works, and they line up once per synodic period.
            assert.ok(A.wt >= 0 && A.wt < 2 * Math.PI / Math.abs(nc - nt), `${where}: first opportunity`);
            nearRel(A.tof_total, A.wt + tof, 1e-9, `${where}: total`);
        } else {
            const R = given(g, 'R'), kOrbits = given(g, 'k');
            assert.strictEqual(given(g, 'R_\\oplus'), R_EARTH, 'R_earth');
            const n = Math.sqrt(MU / R ** 3);
            // The target must fly to where the chase is, in k phasing periods, with k whole laps
            // plus the phase it has to make up (the shorter way round).
            const lead = wrapDeg(thC - thT);
            const tof = (360 * kOrbits + lead) * D2R / n;
            nearRel(A.tof, tof, 1e-9, `${where}: time to rendezvous`);
            nearAngle(thT + n * A.tof * R2D, thC, 1e-6, `${where}: they meet`);
            near(A.nu, n * (A.tof / kOrbits) * R2D, 1e-6, `${where}: travel per phasing orbit`);
            const aPh = Math.cbrt(MU * (A.tof / kOrbits / (2 * Math.PI)) ** 2);
            nearRel(A.a_ph, aPh, 1e-9, `${where}: a_phasing`);
            // The burn point is one end of the phasing orbit; the other end is 2 a - R.
            near(A.h_p, Math.min(R, 2 * aPh - R) - R_EARTH, 1e-6, `${where}: perigee altitude`);
            assert.ok(A.h_p > 50, `${where}: the phasing orbit stays clear of Earth`);
            const dv1 = Math.sqrt(MU * (2 / R - 1 / aPh)) - Math.sqrt(MU / R);
            nearRel(A.dv1, dv1, 1e-9, `${where}: dV1 with its sign`);
            nearRel(A.dv_total, 2 * Math.abs(dv1), 1e-9, `${where}: total`);
        }
        checkGrading(p, (f, typed, truth) => Rz.grade(f.tolerance, typed, truth, f.unitType), where);
    }
});

/* ------------------------------------------------------------------ */
/* Time of Flight                                                     */
/* ------------------------------------------------------------------ */
check(`Time of flight: ${COUNT} problems, D = RT on a circle`, () => {
    for (let k = 0; k < COUNT; k++) {
        const type = Tof.types[k % Tof.types.length];
        const p = Tof.generate(type);
        const g = givens(p.statement);
        const A = Object.fromEntries(Object.entries(p.answers).map(([key, x]) => [key, x.value]));
        const where = `${type} problem ${k}`;
        const a = 'a' in g ? given(g, 'a') : R_EARTH + given(g, 'h');
        const n = Math.sqrt(MU / a ** 3);
        nearRel(A.n, n, 1e-12, `${where}: n`);
        const u0 = given(g, 'u_0');
        if (type === 'time') {
            const sweep = (((given(g, 'u_1') - u0) % 360) + 360) % 360;
            near(A.d, sweep * D2R, 1e-12, `${where}: D in radians`);
            nearRel(A.t, sweep * D2R / n, 1e-12, `${where}: T`);
        } else {
            const T = g.T.includes('min') ? given(g, 'T') * 60 : given(g, 'T');
            nearRel(A.d, n * T * R2D, 1e-12, `${where}: D in degrees`);
            nearAngle(A.u1, u0 + n * T * R2D, 1e-9, `${where}: u1`);
        }
        checkGrading(p, (f, typed, truth) => Tof.grade(f.tolerance, typed, truth, f.unitType), where);
    }
});

/* ------------------------------------------------------------------ */
/* Ground Tracks                                                      */
/* ------------------------------------------------------------------ */
// The track drawn again here: Kepler's equation by bisection, Earth turning 15 deg per hour
// (the course model), time from the first ascending node.
function keplerBisect(M, e) {
    const m = ((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let lo = 0, hi = 2 * Math.PI;
    for (let k = 0; k < 200; k++) {
        const mid = (lo + hi) / 2;
        if (mid - e * Math.sin(mid) < m) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}
function trackAt(m, a, t) {
    const n = Math.sqrt(MU / a ** 3), e = m.e;
    const nuNode = -m.argp * D2R;                                  // the ascending node, u = 0
    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nuNode / 2));
    const E = keplerBisect(E0 - e * Math.sin(E0) + n * t, e);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    const u = nu + m.argp * D2R;
    const i = m.i * D2R;
    return {
        lat: Math.asin(Math.sin(u) * Math.sin(i)) * R2D,
        lon: m.lambda1 + Math.atan2(Math.sin(u) * Math.cos(i), Math.cos(u)) * R2D - 15 * t / 3600,
        u: ((u * R2D) % 360 + 360) % 360
    };
}

check(`Ground tracks: ${COUNT} problems, each answer read off a track drawn here`, () => {
    const onGrid = (deg) => Math.abs(wrapDeg(deg) / 15 - Math.round(wrapDeg(deg) / 15)) < 1e-6;
    for (let k = 0; k < COUNT; k++) {
        const p = Gt.generate(Gt.types[k % Gt.types.length]);
        const m = p.model;
        const A = Object.fromEntries(Object.entries(p.answers).map(([key, x]) => [key, x.value]));
        const where = `${m.id} problem ${k}`;
        // The semi-major axis from the period by Kepler's third law.
        nearRel(A.a, Math.cbrt(MU * (A.p / (2 * Math.PI)) ** 2), 1e-12, `${where}: a`);
        const P = A.p;
        // Sample one period of the track.
        const pts = [];
        for (let j = 0; j <= 4000; j++) pts.push(trackAt(m, A.a, P * j / 4000));
        if (m.equatorial) {
            pts.forEach((q) => { near(q.lat, 0, 1e-9, `${where}: on the equator`); nearAngle(q.lon, pts[0].lon, 1e-6, `${where}: a single point`); });
            assert.strictEqual(A.i, 0, `${where}: i`);
            assert.strictEqual(A.argp, null, `${where}: omega undefined`);
            assert.strictEqual(A.nu, null, `${where}: nu undefined`);
            checkGrading(p, (f, typed, truth) => Gt.grade(f.tolerance, typed, truth, f.unitType), where);
            continue;
        }
        // The period: the westward shift between the two ascending nodes, at 15 deg/h.
        near(pts[0].lat, 0, 1e-9, `${where}: starts at a node`);
        near(pts[4000].lat, 0, 1e-6, `${where}: ends at a node`);
        nearAngle(pts[0].lon - pts[4000].lon, 15 * P / 3600, 1e-6, `${where}: westward shift`);
        assert.ok(onGrid(pts[0].lon) && onGrid(pts[4000].lon), `${where}: the nodes are on 15 deg lines`);
        // The inclination: the highest latitude is i (or 180 - i for a retrograde orbit), on a grid line, below 75 deg.
        const peak = Math.max(...pts.map((q) => q.lat));
        near(peak, A.i > 90 ? 180 - A.i : A.i, 0.01, `${where}: peak latitude`);
        assert.ok(onGrid(peak) || Math.abs(peak - Math.round(peak / 15) * 15) < 0.01, `${where}: the peak is on a 15 deg line`);
        assert.ok(peak <= 75.01, `${where}: the track stays on the map`);
        // The eccentricity: equal time north and south of the equator for a circle.
        const north = pts.filter((q) => q.lat > 0).length, south = pts.filter((q) => q.lat < 0).length;
        assert.strictEqual(A.e, Math.abs(north - south) > 40 ? 1 : 0, `${where}: e is ${A.e ? 'nonzero' : 'zero'} (north ${north}, south ${south})`);
        if (A.e) {
            // Apogee is where the satellite is slowest: the hemisphere where it spends longer.
            assert.strictEqual(A.argp, north > south ? 270 : 90, `${where}: omega from the hemispheres`);
        } else {
            assert.strictEqual(A.argp, null, `${where}: omega undefined`);
        }
        // Where the satellite is marked: on a grid line at a feature, with the answer's nu.
        const sat = trackAt(m, A.a, m.tSat);
        assert.ok([0, 90, 180, 270].some((u) => Math.abs(wrapDeg(sat.u - u)) < 1e-6), `${where}: marked at a feature`);
        assert.ok(onGrid(sat.lon), `${where}: the mark is on a 15 deg longitude line`);
        if (A.e) nearAngle(A.nu, sat.u - A.argp, 1e-6, `${where}: nu`);
        else assert.strictEqual(A.nu, null, `${where}: nu undefined`);
        checkGrading(p, (f, typed, truth) => Gt.grade(f.tolerance, typed, truth, f.unitType), where);
    }
});

/* ------------------------------------------------------------------ */
/* Propulsion                                                         */
/* ------------------------------------------------------------------ */
// A given as a number in base units: kg, s, m/s, N.
function quantity(tex) {
    let x = texNumber(tex);
    if (/\\text\{ mN\}/.test(tex)) x /= 1000;
    else if (/\\text\{ kN\}/.test(tex)) x *= 1000;
    else if (/\\text\{ min\}/.test(tex)) x *= 60;
    else if (/\\text\{ hr\}/.test(tex)) x *= 3600;
    return x;
}
const rocket = (isp, mi, mf) => isp * G0 * Math.log(mi / mf);
const afterBurn = (mi, dv, isp) => mi / Math.exp(dv / (isp * G0));

// Each template's answers, from its givens, with only the rocket equation, a = F / m, and
// dt = dV / a. A burn's acceleration is taken at its start, as the course does.
const PROPULSION = {
    stationkeeping: (q) => ({ a0: q.F / q.m, dt: q.dV / (q.F / q.m) }),
    gauge: (q) => ({ m_i: q.dry + q.mp, dv: rocket(q.isp, q.dry + q.mp, q.dry) }),
    'timed-thrust': (q) => ({ a: q.dV / q.dt, F: q.m * q.dV / q.dt }),
    budget: (q) => ({ m_f: afterBurn(q.mi, q.dV, q.isp), m_p: q.mi - afterBurn(q.mi, q.dV, q.isp) }),
    'burn-dv': (q) => ({ a0: q.F / q.m, dv: q.F / q.m * q.dt }),
    'min-isp': (q) => ({ ratio: (q.dry + q.mp) / q.dry, isp: q.dV / (G0 * Math.log((q.dry + q.mp) / q.dry)) }),
    'full-tank': (q) => {
        const mi = q.dry + q.mp, dv = rocket(q.isp, mi, q.dry);
        return { dv, a0: q.F / mi, dt: dv / (q.F / mi) };
    },
    'timed-prop': (q) => {
        const dv = q.F / q.mi * q.dt;
        return { a0: q.F / q.mi, dv, m_p: q.mi - afterBurn(q.mi, dv, q.isp) };
    },
    burnout: (q) => {
        const mf = afterBurn(q.mi, q.dV, q.isp);
        return { m_p: q.mi - mf, m_f: mf, a_f: q.F / mf };
    },
    disposal: (q) => {
        const mi = q.dry * Math.exp(q.dV / (q.isp * G0));
        return { m_p: mi - q.dry, m_i: mi, dt: q.dV / (q.F / mi) };
    },
    'dry-mass': (q) => {
        const R = Math.exp(q.dV / (q.isp * G0)), dry = q.mp / (R - 1);
        return { ratio: R, m_dry: dry, m_i: dry + q.mp };
    },
    'sk-budget': (q) => {
        const mi = q.dry + q.mp, total = rocket(q.isp, mi, q.dry);
        return { dv_total: total, n: Math.floor(total / q.dVburn), dt: q.dVburn / (q.F / mi) };
    },
    feasibility: (q) => {
        const mi = q.dry + q.mp, avail = rocket(q.isp, mi, q.dry), dt = q.dVreq / (q.F / mi);
        return { dv_avail: avail, dt, feasible: avail >= q.dVreq && dt <= q.dtmax ? 1 : 0 };
    },
    trade: (q) => {
        const side = (isp, F) => ({ mp: q.mi - afterBurn(q.mi, q.dV, isp), dt: q.dV / (F / q.mi) });
        const a = side(q.ispA, q.FA), b = side(q.ispB, q.FB);
        return { m_pA: a.mp, m_pB: b.mp, dtA: a.dt, dtB: b.dt };
    },
    'min-thrust': (q) => {
        const mi = q.dry + q.mp, used = mi - afterBurn(mi, q.dV, q.isp);
        return { m_used: used, m_left: q.mp - used, F: mi * q.dV / q.dtmax };
    },
    'isp-test': (q) => {
        const a = q.dV / q.dt, mi = q.F / a;
        return { a0: a, m_i: mi, isp: q.dV / (G0 * Math.log(mi / (mi - q.mp))) };
    },
    window: (q) => {
        const mi = q.dry + q.mp, dv = q.F / mi * q.dtwin, mf = afterBurn(mi, dv, q.isp);
        return { dv, m_p: mi - mf, dv_left: rocket(q.isp, mf, q.dry) };
    }
};

function propulsionGivens(statement) {
    const q = {};
    const symbols = {
        'm': 'm', 'm_i': 'mi', 'm_{\\text{dry}}': 'dry', 'm_p': 'mp', 'I_{\\text{sp}}': 'isp', 'I_{\\text{sp}}\\text{ rated}': 'ispRated',
        'F': 'F', '\\Delta V': 'dV', '\\Delta V_{\\text{burn}}': 'dVburn', '\\Delta V_{\\text{req}}': 'dVreq',
        '\\Delta t': 'dt', '\\Delta t_{\\text{window}}': 'dtwin', '\\Delta t_{\\max}': 'dtmax'
    };
    for (const tex of texItems(statement)) {
        const option = tex.match(/^\\text\{([AB]): \}\s*(.*)$/);
        if (option) {
            // "A: Isp = 310 s, F = 440 N"
            const [ispPart, fPart] = option[2].split(',\\;');
            q['isp' + option[1]] = quantity(ispPart.split('=')[1]);
            q['F' + option[1]] = quantity(fPart.split('=')[1]);
            continue;
        }
        const k = tex.indexOf('=');
        const symbol = tex.slice(0, k).trim();
        assert.ok(symbol in symbols, `unknown given "${symbol}"`);
        q[symbols[symbol]] = quantity(tex.slice(k + 1));
    }
    return q;
}

check(`Propulsion: ${COUNT} problems over all ${Prop.templates.length} templates, worked from the printed givens`, () => {
    const seen = new Set();
    for (let k = 0; k < COUNT; k++) {
        const id = Prop.templates[k % Prop.templates.length];
        const p = Prop.generate(null, id);
        seen.add(p.type);
        const solve = PROPULSION[p.type];
        assert.ok(solve, `a solver for ${p.type}`);
        const want = solve(propulsionGivens(p.statement));
        const where = `${p.type} problem ${k}`;
        for (const f of p.fields) {
            assert.ok(f.key in want, `${where}: the test works out ${f.key}`);
            if (f.unitType === 'yesno' || f.unitType === 'count') assert.strictEqual(p.answers[f.key].value, want[f.key], `${where}: ${f.key}`);
            else nearRel(p.answers[f.key].value, want[f.key], 1e-9, `${where}: ${f.key}`);
        }
        checkGrading(p, (f, typed, truth) => Prop.grade(f.tolerance, typed, truth, f.unitType), where);
    }
    // Templates that fall back to another when their numbers do not work out are fine, but every
    // answer above was checked against the template that actually made it.
    assert.ok(seen.size >= Prop.templates.length - 3, `templates seen: ${[...seen].join(', ')}`);
});

/* ------------------------------------------------------------------ */
/* Laws                                                               */
/* ------------------------------------------------------------------ */
check("Laws: Kepler's three and Newton's four, each with its own statement and equation", () => {
    const L = Laws.laws;
    assert.strictEqual(L.filter((x) => x.group === 'kepler').length, 3, "Kepler's laws");
    assert.strictEqual(L.length, 7, 'seven laws');
    for (const field of ['key', 'name', 'statement', 'equation']) {
        assert.strictEqual(new Set(L.map((x) => x[field])).size, 7, `distinct ${field}s`);
    }
    const eq = (key) => L.find((x) => x.key === key).equation;
    assert.ok(/p\}\{1 \+ e\\cos\\nu/.test(eq('k1')), 'first law: the conic equation');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
