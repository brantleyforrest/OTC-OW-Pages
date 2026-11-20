// orbit-math.js
// Every orbital formula the site's tools use. Numbers come from assets/orbit-constants.js; nothing
// here declares a physical constant of its own. Test 1 and Test 2 Practice use their own copy of the
// course equations (practice/test-review-math.js), and tests check the two files against each other.
//
// build(C) returns every section bound to one constant set C (course or WGS-84, see orbit-constants
// section 1). bind(C) does the same but keeps one copy per set. The sections on OrbitMath itself
// follow the constants the reader chose (OrbitConstants.Settings), and change when the choice does:
// pages read them as OrbitMath.<section> after every settings change.
//
// Sections
//   vec            3-vector helpers
//   kepler         Kepler's equation
//   time           start time, Julian date, sidereal time, Sun and Moon positions
//   perturbation   the Perturbations lesson's models (drag decay, J2 drift, J2,2, third body, SRP)
//   forces         accelerations for Cowell's method, each behind a toggle
//   cowell         Cowell's method with the four Runge-Kutta solvers
//   rendezvous     universal-variable Kepler and the coplanar and co-orbital rendezvous plans
//   elements       classical elements to r and v and back, with the circular and equatorial cases
//   propagate      satellites stored as r and v, moved by the propagator the settings choose
//   frames         ECI, ECEF and RIC viewpoints for the Reference Frame Observatory
//   rpo            relative motion: CW, RMOEs and the exact two-orbit model
// and one section per tool page whose math used to live in the page script:
//   orbit          orbit shape and speed (Orbital Equation Explorer)
//   energy         specific mechanical energy (Mechanical Energy Explorer)
//   coe            classical elements to r and v (Orbital Elements Explorer)
//   sunSync        J2 nodal regression, sun-synchronous orbits
//   groundTrack    ground tracks over a turning Earth
//   earthRotation  solar and sidereal days
//   maneuver       Hohmann transfers, plane changes, combined maneuvers (Orbital Maneuvers)
//   maneuverGeometry, rendezvousPlan, rendezvousGeometry   scene geometry and plan choice
//   burns          burn plans with CW coasts (RIC Burn Sandbox)
//
// Units: km, km/s, s and radians inside; names say otherwise (deg, Days, ...).
// No DOM. Works in the browser (window.OrbitMath) and in Node (module.exports).
(function (global) {
    'use strict';

    const OC = (typeof module !== 'undefined' && module.exports)
        ? require('./orbit-constants.js')
        : global.OrbitConstants;
    if (!OC) throw new Error('orbit-math.js: load assets/orbit-constants.js first');

    // The start time pages use when none is set: the computer clock, read once when this file loads.
    const LOAD_TIME_MS = Date.now();

    function build(constants) {
        const C = Object.freeze({ ...OC.SETS.course, ...constants });
        const S = { constants: C };

        /* 3-vectors ------------------------------------------------------------------------------ */
        S.vec = (function () {
            const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
            const cross = (a, b) => [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0]
            ];
            const norm = (a) => Math.hypot(a[0], a[1], a[2]);
            const unit = (a) => { const m = norm(a); return [a[0] / m, a[1] / m, a[2] / m]; };
            const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
            const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
            const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
            return { dot, cross, norm, unit, add, sub, scale };
        })();

        /* Kepler's equation ----------------------------------------------------------------------- */
        S.kepler = (function () {
            const TWO_PI = 2 * Math.PI;
            function wrapPi(rad) {
                let w = rad % TWO_PI;
                if (w > Math.PI) w -= TWO_PI;
                if (w <= -Math.PI) w += TWO_PI;
                return w;
            }
            // Eccentric anomaly E for mean anomaly M (radians, any size), 0 <= e < 1. Newton's method
            // on M wrapped to (-pi, pi], started at pi for e >= 0.8; the turns removed are added back,
            // so E keeps M's revolution count.
            function solve(M, e) {
                const m = wrapPi(M);
                let E = e >= 0.8 ? Math.PI * (m < 0 ? -1 : 1) : m + e * Math.sin(m);
                for (let k = 0; k < 30; k++) {
                    const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
                    E -= step;
                    if (Math.abs(step) < 1e-13) break;
                }
                return E + (M - m);
            }
            const trueFromEccentric = (E, e) => 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return { solve, trueFromEccentric, wrapPi };
        })();

        /* Time, sidereal time, Sun and Moon -------------------------------------------------------- */
        // The computer clock gives UTC, used here for UT1 and TT as well: the differences (under 1 s and
        // about 69 s) are far below what the low-precision Sun and Moon series resolve.
        S.time = (function () {
            const D2R = Math.PI / 180;
            const T = OC.TIME;
            function toMs(epoch) {
                if (epoch === undefined || epoch === null) return LOAD_TIME_MS;
                if (epoch instanceof Date) return epoch.getTime();
                if (typeof epoch === 'number') return epoch;
                const ms = Date.parse(epoch);
                if (Number.isNaN(ms)) throw new Error(`Cannot read the start time "${epoch}"`);
                return ms;
            }
            const julianDate = (ms) => ms / (T.DAY_S * 1000) + T.JD_UNIX_EPOCH;

            // Greenwich mean sidereal time, radians (IAU 1982, in days and centuries from J2000).
            function gmst(jd) {
                const d = jd - T.JD_J2000, c = d / T.DAYS_PER_CENTURY, k = OC.GMST;
                const deg = k[0] + k[1] * d + k[2] * c * c + k[3] * c * c * c;
                return (((deg % 360) + 360) % 360) * D2R;
            }

            // Low-precision Sun (Astronomical Almanac), geocentric equatorial km: about 0.01 deg.
            function sunPosition(jd, AU = OC.THIRD_BODY.AU) {
                const s = OC.SUN_SERIES;
                const n = jd - T.JD_J2000;
                const L = s.L[0] + s.L[1] * n;
                const g = (s.g[0] + s.g[1] * n) * D2R;
                const lambda = (L + s.lon[0] * Math.sin(g) + s.lon[1] * Math.sin(2 * g)) * D2R;
                const eps = (s.eps[0] + s.eps[1] * n) * D2R;
                const R = (s.R[0] + s.R[1] * Math.cos(g) + s.R[2] * Math.cos(2 * g)) * AU;
                return [R * Math.cos(lambda), R * Math.cos(eps) * Math.sin(lambda), R * Math.sin(eps) * Math.sin(lambda)];
            }

            // Low-precision Moon (Astronomical Almanac), geocentric equatorial km: about 0.3 deg in
            // longitude, 0.2 deg in latitude.
            function moonPosition(jd) {
                const m = OC.MOON_SERIES;
                const t = (jd - T.JD_J2000) / T.DAYS_PER_CENTURY;
                const s = (deg) => Math.sin(deg * D2R), c = (deg) => Math.cos(deg * D2R);
                const sum = (terms, f) => terms.reduce((acc, [amp, phase, rate]) => acc + amp * f(phase + rate * t), 0);
                const lambda = m.lonBase[0] + m.lonBase[1] * t + sum(m.lonSin, s);
                const beta = sum(m.latSin, s);
                const parallax = m.parallaxBase + sum(m.parallaxCos, c);
                const r = m.parallaxRadius / s(parallax);
                const l = c(beta) * c(lambda);
                const mm = m.cosEps * c(beta) * s(lambda) - m.sinEps * s(beta);
                const n = m.sinEps * c(beta) * s(lambda) + m.cosEps * s(beta);
                return [r * l, r * mm, r * n];
            }
            return { LOAD_TIME_MS, toMs, julianDate, gmst, sunPosition, moonPosition };
        })();

    /* Perturbations: the lesson models (drag decay, J2 drift, J2,2, third body, SRP) -------------- */
    S.perturbation = (function (C, OC, K) {
        const PI = Math.PI;
        const D2R = PI / 180;
        const R2D = 180 / PI;
        const L = OC.LESSON;

        /* 1. Constants */
        const MU = C.mu, RE = C.re, J2 = C.J2, J22 = C.J22, LON22 = C.LON22;
        const R_GEO = L.rGeo, MU_MOON = L.muMoon, D_MOON = L.dMoon, MU_SUN = L.muSun, D_SUN = L.dSun;
        const P_SUN = L.pSun, CD = L.cd, CR = L.cr;
        const DAY_S = OC.TIME.DAY_S;
        const YEAR_DAYS = OC.TIME.JULIAN_YEAR_DAYS;
        const GEO_TILT_PERIOD = L.geoTiltPeriodYears;
        const SUN_RATE = 2 * PI / (YEAR_DAYS * DAY_S); // rad/s
        const SSO_RATE = L.ssoRateDegPerDay;
        const CRITICAL_INC = L.criticalInc, STABLE_LON = L.stableLon, UNSTABLE_LON = L.unstableLon;

        /* 2. General orbit helpers */
        const wrap180 = (deg) => ((deg % 360) + 540) % 360 - 180;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));       // rad/s
        const periodSeconds = (a) => 2 * PI / meanMotion(a);

        function elementsFromAltitudes(hp, ha) {
            return { a: RE + (hp + ha) / 2, e: (ha - hp) / (2 * RE + hp + ha) };
        }
        function altitudesFromElements(a, e) {
            return { hp: a * (1 - e) - RE, ha: a * (1 + e) - RE };
        }
        const radiusAt = (a, e, nu) => a * (1 - e * e) / (1 + e * Math.cos(nu));
        const speedAt = (a, r) => Math.sqrt(MU * (2 / r - 1 / a));
        const circularSpeed = (r) => Math.sqrt(MU / r);
        const specificEnergy = (a) => -MU / (2 * a);
        const radiusForMeanMotion = (n) => Math.cbrt(MU / (n * n));         // circular orbit, km
        const planeChangeDv = (v, deg) => Math.abs(2 * v * Math.sin(deg * D2R / 2));   // same units as v

        const solveKepler = K.solve;
        const trueFromEccentric = (E, e) => 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

        /* 3. Atmospheric drag */
        // Piecewise exponential mean atmosphere: [h0 km, rho0 kg/m^3, H km]. Same data as the lesson's figure.
        const DENSITY = OC.ATMOSPHERE.DENSITY;
        function density(h) {
            let row = DENSITY[0];
            for (let k = 1; k < DENSITY.length; k++) {
                if (DENSITY[k][0] <= h) row = DENSITY[k];
                else break;
            }
            return row[1] * Math.exp(-(h - row[0]) / row[2]);
        }

        const SOLAR = OC.ATMOSPHERE.SOLAR;
        const AREA = OC.ATMOSPHERE.AREA;   // A/m, m^2/kg

        // m/s^2
        function dragAccel(h, speedKmS, areaToMass, solarKey) {
            return 0.5 * density(h) * SOLAR[solarKey] * speedKmS * speedKmS * 1e6 * CD * areaToMass;
        }

        // Orbit-averaged rates, per second. B = CD * A/m * solar factor, m^2/kg.
        const N_QUAD = 360;
        function dragRates(a, e, B) {
            let sumA = 0, sumE = 0;
            for (let k = 0; k < N_QUAD; k++) {
                const c = Math.cos(2 * PI * (k + 0.5) / N_QUAD);
                const d = density(a * (1 - e * c) - RE);
                const q = 1 - e * c;
                sumA += d * Math.pow(1 + e * c, 1.5) / Math.sqrt(q);
                sumE += d * c * Math.sqrt((1 + e * c) / q);
            }
            const w = 2 * PI / N_QUAD;
            const P = periodSeconds(a);
            const dARev = -(B * 1000) * a * a * w * sumA;
            const dERev = -(B * 1000) * a * (1 - e * e) * w * sumE;
            return { da: dARev / P, de: e <= 1e-5 ? 0 : dERev / P };
        }

        const CAP_YEARS = OC.LIMITS.decayCapYears;
        const REENTRY = OC.LIMITS.reentryAltitude;
        function decayHistory({ hp, ha, areaToMass, solar }) {
            const B = CD * areaToMass * SOLAR[solar];
            const cap = CAP_YEARS * YEAR_DAYS * DAY_S;
            let { a, e } = elementsFromAltitudes(hp, ha);
            let t = 0;
            const samples = [{ t: 0, a, e }];
            let reentered = false;
            const rates = (aa, ee) => dragRates(aa, Math.max(0, ee), B);
            for (let step = 0; step < 20000; step++) {
                if (a * (1 - e) - RE <= REENTRY) { reentered = true; break; }
                if (t >= cap) break;
                const k1 = rates(a, e);
                const dt = Math.min(5 / Math.abs(k1.da), cap - t);
                const k2 = rates(a + k1.da * dt / 2, e + k1.de * dt / 2);
                const k3 = rates(a + k2.da * dt / 2, e + k2.de * dt / 2);
                const k4 = rates(a + k3.da * dt, e + k3.de * dt);
                a += dt / 6 * (k1.da + 2 * k2.da + 2 * k3.da + k4.da);
                e += dt / 6 * (k1.de + 2 * k2.de + 2 * k3.de + k4.de);
                if (e < 0) e = 0;
                t += dt;
                samples.push({ t: t / DAY_S, a, e });
            }
            if (!reentered && a * (1 - e) - RE <= REENTRY) reentered = true;
            return { samples, days: t / DAY_S, reentered, steps: samples.length - 1 };
        }

        function sampleHistory(history, tDays) {
            const s = history.samples;
            if (tDays <= 0) return { a: s[0].a, e: s[0].e };
            if (tDays >= s[s.length - 1].t) return { a: s[s.length - 1].a, e: s[s.length - 1].e };
            let lo = 0, hi = s.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (s[mid].t <= tDays) lo = mid; else hi = mid;
            }
            const f = (tDays - s[lo].t) / (s[hi].t - s[lo].t);
            return { a: s[lo].a + f * (s[hi].a - s[lo].a), e: s[lo].e + f * (s[hi].e - s[lo].e) };
        }

        const dragPhase = (e) => e > 0.05 ? 1 : 2;
        function dragHeat(a, e, nu) {
            const r = radiusAt(a, e, nu);
            const v = speedAt(a, r);
            return Math.log10(density(r - RE) * v * v);
        }

        /* 4. J2 secular drift */
        function j2Rates(a, e, incDeg) {
            const p = a * (1 - e * e);
            const n = meanMotion(a);
            const f = J2 * (RE / p) * (RE / p) * n;
            let c = Math.cos(incDeg * D2R);
            if (Math.abs(c) < 1e-9) c = 0;
            const k = DAY_S * R2D;
            let nodeDegDay = -1.5 * f * c * k;
            let perigeeDegDay = 0.75 * f * (5 * c * c - 1) * k;
            if (nodeDegDay === 0) nodeDegDay = 0; // no -0
            return { p, n, nodeDegDay, perigeeDegDay };
        }
        const nodeDirection = (incDeg) => incDeg < 90 ? 'west' : incDeg > 90 ? 'east' : 'none';
        function perigeeDirection(incDeg) {
            if (CRITICAL_INC.some((c) => Math.abs(incDeg - c) <= 0.05)) return 'none';
            return incDeg > CRITICAL_INC[0] && incDeg < CRITICAL_INC[1] ? 'backward' : 'forward';
        }
        function sunSyncInclination(a) {
            return Math.acos(-SSO_RATE / (1.5 * J2 * (RE / a) * (RE / a) * meanMotion(a) * DAY_S * R2D)) * R2D;
        }
        const apogeeLatitude = (incDeg, argpDeg) => Math.asin(Math.sin(incDeg * D2R) * Math.sin((argpDeg + 180) * D2R)) * R2D;

        /* 5. J2,2 longitude drift at GEO. Longitude is east-positive. */
        const K22 = 18 * MU * RE * RE * J22 / Math.pow(R_GEO, 5); // rad/s^2
        const sin2 = (lonDeg) => Math.sin(2 * (lonDeg - LON22) * D2R);
        const tangentialAccel = (lonDeg) => -6 * MU * RE * RE * J22 / Math.pow(R_GEO, 4) * sin2(lonDeg) * 1000; // m/s^2
        const longitudeAccel = (lonDeg) => K22 * sin2(lonDeg); // rad/s^2, = -3 a_lambda / r
        const driftPotential = (lonDeg) => Math.cos(2 * (lonDeg - LON22) * D2R);

        // Velocity Verlet on s = { lon (rad, unwrapped), rate (rad/s) }.
        function stepLongitude(s, dtDays) {
            const n = Math.max(1, Math.ceil(dtDays));
            const h = dtDays * DAY_S / n;
            const acc = (lonRad) => K22 * Math.sin(2 * (lonRad - LON22 * D2R));
            let a0 = acc(s.lon);
            for (let k = 0; k < n; k++) {
                s.lon += s.rate * h + 0.5 * a0 * h * h;
                const a1 = acc(s.lon);
                s.rate += 0.5 * (a0 + a1) * h;
                a0 = a1;
            }
            return s;
        }

        function nearestStable(lonDeg) {
            let best = STABLE_LON[0];
            for (const s of STABLE_LON) {
                if (Math.abs(wrap180(lonDeg - s)) < Math.abs(wrap180(lonDeg - best))) best = s;
            }
            return { lon: best, amplitudeDeg: Math.min(90, Math.abs(wrap180(lonDeg - best))) };
        }
        function ellipticK(m) {
            let a = 1, b = Math.sqrt(1 - m);
            for (let k = 0; k < 30 && Math.abs(a - b) > 1e-15; k++) {
                const an = (a + b) / 2;
                b = Math.sqrt(a * b);
                a = an;
            }
            return PI / (2 * a);
        }
        const LIBRATION_T0_DAYS = 2 * PI / Math.sqrt(2 * K22) / DAY_S;
        function librationPeriodDays(amplitudeDeg) {
            if (amplitudeDeg > 89.9) return Infinity;
            const s = Math.sin(amplitudeDeg * D2R);
            return LIBRATION_T0_DAYS * (2 / PI) * ellipticK(s * s);
        }
        // Positive means above GEO. The satellite is above GEO while it drifts west.
        const semiMajorOffsetKm = (rateRadS) => -(2 * R_GEO / (3 * meanMotion(R_GEO))) * rateRadS;
        const eastWestDvPerYear = (lonDeg) => L.eastWestDvPerYear * Math.abs(sin2(lonDeg)); // m/s/yr, the lesson's printed maximum

        /* 6. Third-body gravity */
        // m/s^2. Both positions from Earth's center, km.
        function thirdBodyAccel(mu3, body, sat) {
            const rx = sat[0] - body[0], ry = sat[1] - body[1], rz = sat[2] - body[2];
            const rr = Math.hypot(rx, ry, rz), bb = Math.hypot(body[0], body[1], body[2]);
            const r3 = rr * rr * rr, b3 = bb * bb * bb;
            return [
                -mu3 * (rx / r3 + body[0] / b3) * 1000,
                -mu3 * (ry / r3 + body[1] / b3) * 1000,
                -mu3 * (rz / r3 + body[2] / b3) * 1000
            ];
        }
        const OBLIQUITY = L.obliquityDeg * D2R;
        const BODY_DIRECTION = [0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)];
        function geoTilt(tYears) {
            return { incDeg: L.geoTiltMaxDeg * Math.sin(PI * tYears / GEO_TILT_PERIOD), nodeDeg: 90 - 180 * tYears / GEO_TILT_PERIOD };
        }
        const geoTiltRate = (tYears) => (L.geoTiltMaxDeg * PI / GEO_TILT_PERIOD) * Math.cos(PI * tYears / GEO_TILT_PERIOD); // deg/yr
        function figureEight(incDeg, count) {
            const ci = Math.cos(incDeg * D2R), si = Math.sin(incDeg * D2R);
            const out = [];
            for (let k = 0; k <= count; k++) {
                const u = 2 * PI * k / count;
                out.push({
                    lat: Math.asin(si * Math.sin(u)) * R2D,
                    lonOffset: wrap180((Math.atan2(ci * Math.sin(u), Math.cos(u)) - u) * R2D)
                });
            }
            return out;
        }
        const NORTH_SOUTH_DV = L.northSouthDv; // m/s/yr, lesson's SMAD table

        /* 7. Solar radiation pressure */
        const AREA_SRP = L.areaSrp; // A/m, m^2/kg
        const srpAccel = (areaToMass) => P_SUN * CR * areaToMass; // m/s^2
        const V_GEO = meanMotion(R_GEO) * R_GEO; // km/s
        const srpRadius = (areaToMass) => 3 * (srpAccel(areaToMass) / 1000) / (2 * V_GEO * SUN_RATE);
        function srpEccVector(tDays, areaToMass) {
            const rE = srpRadius(areaToMass);
            const L = SUN_RATE * tDays * DAY_S;
            const ex = rE * (Math.cos(L) - 1), ey = rE * Math.sin(L);
            return { ex, ey, e: Math.hypot(ex, ey), perigeeDeg: Math.atan2(ey, ex) * R2D };
        }
        const srpPerigeeDipKm = (e) => R_GEO * e;

        /* 8. Perturbation size versus altitude (lesson figure) */
        function accelerationsAt(h) {
            const r = RE + h;
            const r4 = r * r * r * r;
            const moon = 2 * MU_MOON * r / (D_MOON * D_MOON * D_MOON) * 1000;
            const sun = 2 * MU_SUN * r / (D_SUN * D_SUN * D_SUN) * 1000;
            return {
                central: MU / (r * r) * 1000,
                j2: 1.5 * J2 * MU * RE * RE / r4 * 1000,
                j22: 6 * MU * RE * RE * J22 / r4 * 1000,
                moon, sun,
                thirdBody: moon + sun,
                srp: P_SUN * CR * AREA.nominal,
                drag: h <= DENSITY[DENSITY.length - 1][0] ? dragAccel(h, Math.sqrt(MU / r), AREA.nominal, 'mean') : null
            };
        }
        function leadingPerturbation(h) {
            const acc = accelerationsAt(h);
            let best = 'j2';
            for (const k of ['j22', 'thirdBody', 'srp', 'drag']) {
                if (acc[k] !== null && acc[k] > acc[best]) best = k;
            }
            return best;
        }
        function leadingNonGravitational(h) {
            const acc = accelerationsAt(h);
            return acc.drag !== null && acc.drag > acc.srp ? 'drag' : 'srp';
        }

        return {
            MU, RE, J2, J22, LON22, R_GEO, MU_MOON, D_MOON, MU_SUN, D_SUN, P_SUN, CD, CR, DAY_S, YEAR_DAYS,
            GEO_TILT_PERIOD, SUN_RATE, SSO_RATE, CRITICAL_INC, STABLE_LON, UNSTABLE_LON, CAP_YEARS,
            wrap180, wrap360, meanMotion, periodSeconds, elementsFromAltitudes, altitudesFromElements,
            radiusAt, speedAt, circularSpeed, specificEnergy, radiusForMeanMotion, planeChangeDv,
            solveKepler, trueFromEccentric,
            DENSITY, density, SOLAR, AREA, dragAccel, dragRates, decayHistory, sampleHistory,
            dragPhase, dragHeat,
            j2Rates, nodeDirection, perigeeDirection, sunSyncInclination, apogeeLatitude,
            K22, tangentialAccel, longitudeAccel, driftPotential, stepLongitude, nearestStable, ellipticK,
            LIBRATION_T0_DAYS, librationPeriodDays, semiMajorOffsetKm, eastWestDvPerYear,
            thirdBodyAccel, BODY_DIRECTION, geoTilt, geoTiltRate, figureEight, NORTH_SOUTH_DV,
            AREA_SRP, srpAccel, V_GEO, srpRadius, srpEccVector, srpPerigeeDipKm,
            accelerationsAt, leadingPerturbation, leadingNonGravitational
        };
    })(C, OC, S.kepler);

    /* Forces for Cowell's method, each behind a toggle -------------------------------------------- */
    S.forces = (function (C, OC, T, PM) {
        const D2R = Math.PI / 180;
        const FORCE_IDS = OC.FORCE_IDS;
        const NEEDS_TIME = ['j22', 'sun', 'moon', 'srp'];
        const G = OC.GRAVITY_FIELD, B = OC.THIRD_BODY;

        // Constants used when the caller's constants object does not give them. mu, re and J2 always
        // come from the caller (the site's course / WGS-84 setting).
        const DEFAULT_CONSTANTS = {
            J3: G.J3, J4: G.J4, C22: G.C22, S22: G.S22,
            omegaE: C.omegaE,
            muSun: B.muSun, muMoon: B.muMoon, AU: B.AU,
            P_SUN: OC.RADIATION.P_SUN
        };
        const DEFAULT_SPACECRAFT = { ...OC.SPACECRAFT };
        const { LOAD_TIME_MS, toMs, julianDate, gmst, sunPosition, moonPosition } = T;

        /* ------------------------------------------------------------------ */
        /* Accelerations, km/s^2                                              */
        /* ------------------------------------------------------------------ */
        function twoBody(r, mu) {
            const r3 = Math.pow(r[0] * r[0] + r[1] * r[1] + r[2] * r[2], 1.5);
            return [-mu * r[0] / r3, -mu * r[1] / r3, -mu * r[2] / r3];
        }

        function j2Accel(r, mu, re, J2) {
            const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], rm = Math.sqrt(r2);
            const f = 1.5 * J2 * mu * re * re / (r2 * r2 * rm);
            const q = 5 * r[2] * r[2] / r2;
            return [f * r[0] * (q - 1), f * r[1] * (q - 1), f * r[2] * (q - 3)];
        }

        function j34Accel(r, mu, re, J3, J4) {
            const [x, y, z] = r;
            const r2 = x * x + y * y + z * z, rm = Math.sqrt(r2), r7 = r2 * r2 * r2 * rm;
            const zr2 = z * z / r2;
            const k3 = -2.5 * J3 * mu * re * re * re / r7;
            const k4 = 1.875 * J4 * mu * re * re * re * re / r7;
            const h3 = k3 * (3 * z - 7 * z * zr2);
            const h4 = k4 * (1 - 14 * zr2 + 21 * zr2 * zr2);
            return [
                x * (h3 + h4),
                y * (h3 + h4),
                k3 * (6 * z * z - 7 * z * z * zr2 - 0.6 * r2) + k4 * z * (5 - 70 / 3 * zr2 + 21 * zr2 * zr2)
            ];
        }

        // Sectoral (2,2) term: U = 3 mu re^2 (C22 (x^2 - y^2) + 2 S22 x y) / r^5 in Earth-fixed axes.
        function j22Accel(r, jd, mu, re, C22, S22) {
            const th = gmst(jd), ct = Math.cos(th), st = Math.sin(th);
            const x = ct * r[0] + st * r[1], y = -st * r[0] + ct * r[1], z = r[2];
            const r2 = x * x + y * y + z * z, r5 = r2 * r2 * Math.sqrt(r2), r7 = r5 * r2;
            const F = C22 * (x * x - y * y) + 2 * S22 * x * y;
            const k = 3 * mu * re * re;
            const ax = k * (2 * (C22 * x + S22 * y) / r5 - 5 * F * x / r7);
            const ay = k * (2 * (S22 * x - C22 * y) / r5 - 5 * F * y / r7);
            const az = k * (-5 * F * z / r7);
            return [ct * ax - st * ay, st * ax + ct * ay, az];
        }

        function dragAccel(r, v, re, omegaE, sc) {
            const h = Math.hypot(r[0], r[1], r[2]) - re;
            const rho = PM.density(h) * PM.SOLAR[sc.solar];                     // kg/m^3
            const vr = [v[0] + omegaE * r[1], v[1] - omegaE * r[0], v[2]];      // v - omega x r, km/s
            const speed = Math.hypot(vr[0], vr[1], vr[2]);
            const k = -0.5 * rho * sc.cd * sc.areaToMass * speed * 1000;          // 1/s
            return [k * vr[0], k * vr[1], k * vr[2]];
        }

        // Third body at s (km from Earth's center): the pull on the satellite minus the pull on Earth.
        function thirdBodyAccel(r, s, muBody) {
            const d = [s[0] - r[0], s[1] - r[1], s[2] - r[2]];
            const d3 = Math.pow(d[0] * d[0] + d[1] * d[1] + d[2] * d[2], 1.5);
            const s3 = Math.pow(s[0] * s[0] + s[1] * s[1] + s[2] * s[2], 1.5);
            return [0, 1, 2].map((k) => muBody * (d[k] / d3 - s[k] / s3));
        }

        // Cylindrical shadow: no pressure when behind Earth, inside a cylinder of radius re.
        function inShadow(r, sun, re) {
            const sm = Math.hypot(sun[0], sun[1], sun[2]);
            const u = [sun[0] / sm, sun[1] / sm, sun[2] / sm];
            const along = r[0] * u[0] + r[1] * u[1] + r[2] * u[2];
            if (along >= 0) return false;
            const p = [r[0] - along * u[0], r[1] - along * u[1], r[2] - along * u[2]];
            return Math.hypot(p[0], p[1], p[2]) < re;
        }

        function srpAccel(r, sun, re, P_SUN, AU, sc) {
            if (inShadow(r, sun, re)) return [0, 0, 0];
            const d = [sun[0] - r[0], sun[1] - r[1], sun[2] - r[2]];
            const dm = Math.hypot(d[0], d[1], d[2]);
            const k = -P_SUN * (AU / dm) * (AU / dm) * sc.cr * sc.areaToMass / 1000 / dm; // km/s^2 per km
            return [k * d[0], k * d[1], k * d[2]];
        }

        /* ------------------------------------------------------------------ */
        /* Combined                                                           */
        /* ------------------------------------------------------------------ */
        // forces: { j2, j34, j22, drag, sun, moon, srp } (missing = off). Returns accel(r, v, jd).
        function makeAcceleration(forces = {}, constants = {}, spacecraft = {}) {
            for (const id of Object.keys(forces)) {
                if (!FORCE_IDS.includes(id)) throw new Error(`Unknown force "${id}". Choices: ${FORCE_IDS.join(', ')}`);
            }
            const on = Object.fromEntries(FORCE_IDS.map((id) => [id, !!forces[id]]));
            const C = { ...DEFAULT_CONSTANTS, ...constants };
            if (C.J22 !== undefined && C.LON22 !== undefined && constants.C22 === undefined) {
                C.C22 = C.J22 * Math.cos(2 * C.LON22 * D2R);           // J22 and its longitude given instead
                C.S22 = C.J22 * Math.sin(2 * C.LON22 * D2R);
            }
            const sc = { ...DEFAULT_SPACECRAFT, ...spacecraft };
            if (!(C.mu > 0)) throw new Error('constants.mu is required');
            const needRe = on.j2 || on.j34 || on.j22 || on.drag || on.srp || on.moon;
            if (needRe && !(C.re > 0)) throw new Error('constants.re is required for the forces that are on');
            if (on.j2 && !(C.J2 > 0)) throw new Error('constants.J2 is required for J2');
            if (on.drag && !(sc.solar in PM.SOLAR)) throw new Error(`spacecraft.solar must be one of ${Object.keys(PM.SOLAR).join(', ')}`);
            if ((on.drag || on.srp) && !(sc.areaToMass > 0)) throw new Error('spacecraft.areaToMass must be positive');

            return function accel(r, v, jd) {
                const a = twoBody(r, C.mu);
                const add = (b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; };
                if (on.j2) add(j2Accel(r, C.mu, C.re, C.J2));
                if (on.j34) add(j34Accel(r, C.mu, C.re, C.J3, C.J4));
                if (on.j22) add(j22Accel(r, jd, C.mu, C.re, C.C22, C.S22));
                if (on.drag) add(dragAccel(r, v, C.re, C.omegaE, sc));
                let sun = null;
                if (on.sun || on.srp) sun = sunPosition(jd, C.AU);
                if (on.sun) add(thirdBodyAccel(r, sun, C.muSun));
                if (on.moon) add(thirdBodyAccel(r, moonPosition(jd), C.muMoon));
                if (on.srp) add(srpAccel(r, sun, C.re, C.P_SUN, C.AU, sc));
                return a;
            };
        }

        const needsTime = (forces = {}) => NEEDS_TIME.some((id) => !!forces[id]);

        return {
            FORCE_IDS, NEEDS_TIME, LOAD_TIME_MS, DEFAULT_CONSTANTS, DEFAULT_SPACECRAFT,
            toMs, julianDate, gmst, sunPosition, moonPosition,
            twoBody, j2Accel, j34Accel, j22Accel, dragAccel, thirdBodyAccel, inShadow, srpAccel,
            makeAcceleration, needsTime
        };
    })(C, OC, S.time, S.perturbation);

    /* Cowell's method: Runge-Kutta solvers on r and v --------------------------------------------- */
    S.cowell = (function (C, OC, FO) {
        const T = { TABLEAUS: OC.SOLVERS, IDS: OC.SOLVER_IDS, DEFAULT_ID: OC.DEFAULTS.solver };
        const F = FO;   // forces section
        const MAX_STEPS = OC.LIMITS.cowellMaxSteps;

        /* ------------------------------------------------------------------ */
        /* Solver setting (the site settings; default Prince–Dormand 8(7))      */
        /* ------------------------------------------------------------------ */
        function solverIds() { return T.IDS.slice(); }

        // The solver the site settings choose (PD78 unless changed).
        function getSolver() {
            const id = OC.Settings.get().solver;
            return T.TABLEAUS[id] ? id : T.DEFAULT_ID;
        }

        /* ------------------------------------------------------------------ */
        /* Equations of motion                                                */
        /* ------------------------------------------------------------------ */
        // y = [x, y, z, vx, vy, vz]; t = seconds after the start time; returns dy/dt.
        // forces: { j2, j34, j22, drag, sun, moon, srp }, all off unless set true.
        function makeDerivative(constants, forces = {}, spacecraft = {}, epochMs = F.LOAD_TIME_MS) {
            const accel = F.makeAcceleration(forces, constants, spacecraft);
            const jd0 = F.julianDate(epochMs);
            return function (t, y) {
                const a = accel([y[0], y[1], y[2]], [y[3], y[4], y[5]], jd0 + t / 86400);
                return [y[3], y[4], y[5], a[0], a[1], a[2]];
            };
        }

        /* ------------------------------------------------------------------ */
        /* One Runge–Kutta step                                               */
        /* ------------------------------------------------------------------ */
        // k0: the slope at (t, y) if already known (first-same-as-last reuse).
        function rkStep(tab, f, t, y, h, k0) {
            const s = tab.c.length, n = y.length;
            const k = new Array(s);
            k[0] = k0 || f(t, y);
            for (let i = 1; i < s; i++) {
                const yi = y.slice();
                const ai = tab.a[i];
                for (let j = 0; j < i; j++) {
                    const w = h * ai[j];
                    if (w !== 0) for (let m = 0; m < n; m++) yi[m] += w * k[j][m];
                }
                k[i] = f(t + tab.c[i] * h, yi);
            }
            const yNew = y.slice();
            const err = tab.bHat ? new Array(n).fill(0) : null;
            for (let i = 0; i < s; i++) {
                const wb = h * tab.b[i];
                const we = err ? h * (tab.b[i] - tab.bHat[i]) : 0;
                for (let m = 0; m < n; m++) {
                    yNew[m] += wb * k[i][m];
                    if (err) err[m] += we * k[i][m];
                }
            }
            return { y: yNew, err, kFirst: k[0], kLast: k[s - 1], evals: k0 ? s - 1 : s };
        }

        /* ------------------------------------------------------------------ */
        /* Propagate one state by dt seconds (dt may be negative)             */
        /* ------------------------------------------------------------------ */
        // options: constants (required), forces ({} = two-body only), spacecraft (cd, cr, areaToMass,
        //          solar), epoch (start time: Date, ms, or ISO text; default the clock at page load),
        //          solver (the setting), rtol and atol (1e-12), stepsPerOrbit for fixed-step RK4 (1000).
        function propagate(r0, v0, dt, options = {}) {
            const id = options.solver || getSolver();
            const tab = T.TABLEAUS[id];
            if (!tab) throw new Error(`Unknown solver "${id}"`);
            const C = options.constants || {};
            const epochMs = F.toMs(options.epoch);
            const f = makeDerivative(C, options.forces || {}, options.spacecraft || {}, epochMs);
            let y = [r0[0], r0[1], r0[2], v0[0], v0[1], v0[2]];
            const stats = { solver: id, steps: 0, rejected: 0, evals: 0 };
            if (dt === 0) return { r: r0.slice(), v: v0.slice(), ...stats };

            const dir = Math.sign(dt);
            const span = Math.abs(dt);
            const rMag = Math.hypot(r0[0], r0[1], r0[2]);
            const vMag = Math.hypot(v0[0], v0[1], v0[2]);
            const a = 1 / (2 / rMag - vMag * vMag / C.mu);
            // Orbit period for an ellipse; for open orbits, the time scale at the current radius.
            const timeScale = a > 0 ? 2 * Math.PI * Math.sqrt(a * a * a / C.mu) : 2 * Math.PI * Math.sqrt(rMag * rMag * rMag / C.mu);

            if (!tab.bHat) {
                const per = options.stepsPerOrbit || 1000;
                const steps = Math.max(1, Math.ceil(span / (timeScale / per)));
                const h = dt / steps;
                let t = 0;
                for (let i = 0; i < steps; i++) {
                    const res = rkStep(tab, f, t, y, h);
                    y = res.y; t += h; stats.evals += res.evals;
                }
                stats.steps = steps;
                return { r: y.slice(0, 3), v: y.slice(3), ...stats };
            }

            const rtol = options.rtol ?? 1e-12;
            const atol = options.atol ?? 1e-12;
            const exponent = 1 / (tab.errOrder + 1);
            let t = 0;
            let h = dir * Math.min(span, timeScale / 100);
            let kFirst = null;
            while (dir * (dt - t) > 0) {
                if (dir * (t + h - dt) > 0) h = dt - t;
                if (stats.steps + stats.rejected > MAX_STEPS) throw new Error('Cowell: too many steps');
                if (Math.abs(h) < 1e-12 * Math.max(1, span)) throw new Error('Cowell: step size underflow');
                const res = rkStep(tab, f, t, y, h, kFirst);
                stats.evals += res.evals;
                let e = 0;
                for (let m = 0; m < 6; m++) {
                    const scale = atol + rtol * Math.max(Math.abs(y[m]), Math.abs(res.y[m]));
                    e = Math.max(e, Math.abs(res.err[m]) / scale);
                }
                if (e <= 1) {
                    t += h; y = res.y; stats.steps++;
                    kFirst = tab.fsal ? res.kLast : null;
                } else {
                    stats.rejected++;
                    kFirst = res.kFirst;                 // same state, so the first slope still holds
                }
                h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(e || 1e-16, -exponent)));
            }
            return { r: y.slice(0, 3), v: y.slice(3), ...stats };
        }

        // States at each time in times (seconds from the start, any order, may be negative).
        // Integrates outward from t = 0 in each direction, so each segment continues the last.
        function trajectory(r0, v0, times, options = {}) {
            const out = new Array(times.length);
            const epochMs = F.toMs(options.epoch);
            const order = times.map((t, i) => i);
            for (const sign of [1, -1]) {
                const idx = order.filter((i) => (sign > 0 ? times[i] >= 0 : times[i] < 0))
                    .sort((i, j) => sign * (times[i] - times[j]));
                let r = r0, v = v0, t = 0;
                for (const i of idx) {
                    const res = propagate(r, v, times[i] - t, { ...options, epoch: epochMs + t * 1000 });
                    r = res.r; v = res.v; t = times[i];
                    out[i] = { t, r, v };
                }
            }
            return out;
        }

        return { solverIds, getSolver, makeDerivative, rkStep, propagate, trajectory };
    })(C, OC, S.forces);

    /* Inertial rendezvous: universal-variable Kepler, coplanar and co-orbital plans --------------- */
    S.rendezvous = (function (C, OC, V) {
        const MU = C.mu;              // Earth gravitational parameter (km^3/s^2)
        const R_EARTH = C.re;         // Earth equatorial radius (km)
        const MIN_ALT = OC.LIMITS.minSafeAltitude;   // Minimum safe altitude (km)
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;

        // Angle wrapping helpers
        function wrap2Pi(rad) {
            let val = rad % (2 * Math.PI);
            if (val < 0) val += 2 * Math.PI;
            return val;
        }

        function wrap360(deg) {
            let val = deg % 360;
            if (val < 0) val += 360;
            return val;
        }

        function formatHms(seconds) {
            const total = Math.max(0, Math.round(seconds));
            const d = Math.floor(total / 86400);
            const rem = total % 86400;
            const h = Math.floor(rem / 3600);
            const m = Math.floor((rem % 3600) / 60);
            const s = rem % 60;
            const hms = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            if (d > 0) {
                return `${d} d ${hms}`;
            }
            return hms;
        }

        const { dot, norm, cross, scale, add, sub } = V;

        // Position on a circular or inclined orbit given argument of latitude u
        function orbitPoint(R, incRad, raanRad, uRad) {
            const cosO = Math.cos(raanRad);
            const sinO = Math.sin(raanRad);
            const cosI = Math.cos(incRad);
            const sinI = Math.sin(incRad);
            const cosU = Math.cos(uRad);
            const sinU = Math.sin(uRad);

            return [
                R * (cosO * cosU - sinO * sinU * cosI),
                R * (sinO * cosU + cosO * sinU * cosI),
                R * (sinU * sinI)
            ];
        }

        // Tangent velocity vector on a circular orbit
        function orbitVelocity(R, incRad, raanRad, uRad, mu) {
            const V = Math.sqrt(mu / R);
            const cosO = Math.cos(raanRad);
            const sinO = Math.sin(raanRad);
            const cosI = Math.cos(incRad);
            const sinI = Math.sin(incRad);
            const cosU = Math.cos(uRad);
            const sinU = Math.sin(uRad);

            // Derivative with respect to u
            const du = [
                -cosO * sinU - sinO * cosU * cosI,
                -sinO * sinU + cosO * cosU * cosI,
                cosU * sinI
            ];
            return scale(du, V);
        }

        /* ------------------------------------------------------------------ */
        /* Universal Variables & Propagation                                  */
        /* ------------------------------------------------------------------ */
        function c2(psi) {
            if (psi > 1e-6) {
                return (1 - Math.cos(Math.sqrt(psi))) / psi;
            }
            if (psi < -1e-6) {
                const sq = Math.sqrt(-psi);
                return (1 - Math.cosh(sq)) / psi;
            }
            return 0.5;
        }

        function c3(psi) {
            if (psi > 1e-6) {
                const sq = Math.sqrt(psi);
                return (sq - Math.sin(sq)) / (sq * sq * sq);
            }
            if (psi < -1e-6) {
                const sq = Math.sqrt(-psi);
                return (Math.sinh(sq) - sq) / (sq * sq * sq);
            }
            return 1 / 6;
        }

        // Universal-variable Kepler propagation (Vallado's KEPLER algorithm)
        function propagate(r0, v0, dt, mu = MU) {
            if (Math.abs(dt) < 1e-9) {
                return { r: [r0[0], r0[1], r0[2]], v: [v0[0], v0[1], v0[2]] };
            }

            const r0_mag = norm(r0);
            const v0_mag = norm(v0);
            const r0_dot_v0 = dot(r0, v0);
            const alpha = 2 / r0_mag - (v0_mag * v0_mag) / mu;

            // Starting guess for chi
            let chi;
            if (alpha > 1e-6) {
                // Elliptic
                chi = Math.sqrt(mu) * dt * alpha;
            } else if (alpha < -1e-6) {
                // Hyperbolic
                const a = 1 / alpha;
                const sign_dt = dt >= 0 ? 1 : -1;
                const num = -2 * mu * alpha * dt;
                const den = r0_dot_v0 + sign_dt * Math.sqrt(-mu * a) * (1 - r0_mag * alpha);
                chi = sign_dt * Math.sqrt(-a) * Math.log(Math.max(1e-12, num / den));
            } else {
                // Parabolic
                const h = cross(r0, v0);
                const p = (norm(h) * norm(h)) / mu;
                const s = 0.5 * (Math.PI / 2 - Math.atan(3 * Math.sqrt(mu / (p * p * p)) * dt));
                const w = Math.atan(Math.cbrt(Math.tan(s)));
                chi = Math.sqrt(p) * (2 / Math.tan(2 * w));
            }

            // Newton iterations on chi
            for (let iter = 0; iter < 50; iter++) {
                const psi = chi * chi * alpha;
                const c2_val = c2(psi);
                const c3_val = c3(psi);
                const r = chi * chi * c2_val + (r0_dot_v0 / Math.sqrt(mu)) * chi * (1 - psi * c3_val) + r0_mag * (1 - psi * c2_val);
                // Universal Kepler equation: sqrt(mu) dt = chi^3 c3 + (r0.v0 / sqrt(mu)) chi^2 c2 + r0 chi (1 - psi c3)
                const f_val = Math.sqrt(mu) * dt - Math.pow(chi, 3) * c3_val - (r0_dot_v0 / Math.sqrt(mu)) * chi * chi * c2_val - r0_mag * chi * (1 - psi * c3_val);
                const step = f_val / r;
                chi += step;
                if (Math.abs(step) < 1e-9) break;
            }

            const psi = chi * chi * alpha;
            const c2_val = c2(psi);
            const c3_val = c3(psi);
            const r_mag = chi * chi * c2_val + (r0_dot_v0 / Math.sqrt(mu)) * chi * (1 - psi * c3_val) + r0_mag * (1 - psi * c2_val);

            const f = 1 - (chi * chi * c2_val) / r0_mag;
            const g = dt - (Math.pow(chi, 3) * c3_val) / Math.sqrt(mu);
            const gdot = 1 - (chi * chi * c2_val) / r_mag;
            const fdot = (Math.sqrt(mu) * chi * (psi * c3_val - 1)) / (r_mag * r0_mag);

            const r = add(scale(r0, f), scale(v0, g));
            const v = add(scale(r0, fdot), scale(v0, gdot));

            return { r, v };
        }

        // State of both chase and target at physical time t
        // With the Cowell propagator (tool pages only), both spacecraft are stored as r and v at the
        // start and flown by OrbitMath.propagate; each burn before arrival adds its planned Δv to the
        // chase's velocity. The plan itself stays the two-body one, so the chase can miss the target.
        const flownPlans = new WeakMap();
        function cowellOn() {
            return !!(S.propagate && S.propagate.propagatorName() === 'cowell');
        }
        function flown(model) {
            let f = flownPlans.get(model);
            if (f) return f;
            const P = S.propagate;
            const mu = model.constants ? model.constants.MU : MU;
            const tg = model.target, ch = model.chase;
            const target = P.satellite(orbitPoint(tg.R, tg.inc, tg.raan, tg.theta0), orbitVelocity(tg.R, tg.inc, tg.raan, tg.theta0, mu), 0);
            let chase = P.satellite(orbitPoint(ch.R, ch.inc, ch.raan, ch.theta0), orbitVelocity(ch.R, ch.inc, ch.raan, ch.theta0, mu), 0);
            const legs = [{ t: -Infinity, sat: chase }];
            for (const ev of model.events || []) {
                if (ev.t >= model.arrival - 1e-9) break;
                const before = P.stateAt(chase, ev.t);
                chase = P.satellite(before.r, before.v.map((x, k) => x + ev.dv[k]), ev.t);
                legs.push({ t: ev.t, sat: chase });
            }
            const atArrival = P.stateAt(chase, model.arrival);
            const targetThen = P.stateAt(target, model.arrival);
            const miss = Math.hypot(...atArrival.r.map((x, k) => x - targetThen.r[k]));
            f = { target, legs, miss };
            flownPlans.set(model, f);
            return f;
        }
        // How far the chase passes from the target at the planned arrival time (km), flown with the
        // Cowell propagator; null with Kepler, where the plan is exact.
        function missAtArrival(model) {
            if (!cowellOn() || !model || !Number.isFinite(model.arrival)) return null;
            return flown(model).miss;
        }

        function stateAt(model, t) {
            if (cowellOn() && Number.isFinite(model.arrival)) {
                const f = flown(model);
                const target = S.propagate.stateAt(f.target, t);
                if (t >= model.arrival) return { chase: { r: target.r, v: target.v }, target: { r: target.r, v: target.v } };
                let leg = f.legs[0];
                for (const l of f.legs) if (l.t <= t) leg = l;
                const chase = S.propagate.stateAt(leg.sat, t);
                return { chase: { r: chase.r, v: chase.v }, target: { r: target.r, v: target.v } };
            }
            const mu = model.constants ? model.constants.MU : MU;

            // Target is in circular orbit
            const target = model.target;
            const theta_t = target.theta0 + target.n * t;
            const r_target = orbitPoint(target.R, target.inc, target.raan, theta_t);
            const v_target = orbitVelocity(target.R, target.inc, target.raan, theta_t, mu);

            // Chase
            let r_chase, v_chase;
            if (t >= model.arrival) {
                // Chase has arrived and flies with target
                r_chase = [r_target[0], r_target[1], r_target[2]];
                v_chase = [v_target[0], v_target[1], v_target[2]];
            } else if (!model.events || model.events.length === 0 || t < model.events[0].t) {
                // Chase is on starting circular orbit
                const chase = model.chase;
                const theta_c = chase.theta0 + chase.n * t;
                r_chase = orbitPoint(chase.R, chase.inc, chase.raan, theta_c);
                v_chase = orbitVelocity(chase.R, chase.inc, chase.raan, theta_c, mu);
            } else {
                // Find latest burn at or before t
                let currentBurn = model.events[0];
                for (let i = 1; i < model.events.length; i++) {
                    if (model.events[i].t <= t) {
                        currentBurn = model.events[i];
                    } else {
                        break;
                    }
                }
                const dt = t - currentBurn.t;
                const prop = propagate(currentBurn.r, currentBurn.vAfter, dt, mu);
                r_chase = prop.r;
                v_chase = prop.v;
            }

            return {
                chase: { r: r_chase, v: v_chase },
                target: { r: r_target, v: v_target }
            };
        }


        /* ------------------------------------------------------------------ */
        /* 5.2 Coplanar Solver                                                */
        /* ------------------------------------------------------------------ */
        function solveCoplanar({ Rchase, Rtarget, phi0, mu = MU, rEarth = R_EARTH }) {
            const warnings = [];
            const phi0_deg = wrap360(phi0);
            const phi0_rad = phi0_deg * D2R;

            if (Math.abs(Rchase - Rtarget) <= 50) {
                warnings.push('same-orbit');
            }

            const n_chase = Math.sqrt(mu / Math.pow(Rchase, 3));
            const n_target = Math.sqrt(mu / Math.pow(Rtarget, 3));
            const omega_drift = n_chase - n_target;
            // Equal radii never drift: no synodic period, no wait time (the page sends the reader to Co-orbital)
            const sameRate = Math.abs(omega_drift) < 1e-15;
            const T_syn = sameRate ? Infinity : (2 * Math.PI) / Math.abs(omega_drift);

            const a_transfer = (Rchase + Rtarget) / 2;
            const Period_transfer = 2 * Math.PI * Math.sqrt(Math.pow(a_transfer, 3) / mu);
            const TOF = Period_transfer / 2;

            const V_chase = Math.sqrt(mu / Rchase);
            const V_target = Math.sqrt(mu / Rtarget);
            const V_tx1 = Math.sqrt(mu * (2 / Rchase - 1 / a_transfer));
            const V_tx2 = Math.sqrt(mu * (2 / Rtarget - 1 / a_transfer));

            const dv1 = V_tx1 - V_chase; // signed: posigrade if > 0, retrograde if < 0
            const dv2 = V_target - V_tx2; // signed
            const dv_total = Math.abs(dv1) + Math.abs(dv2);

            // RZ-4: Target angular travel
            const nu_travel = n_target * TOF; // radians
            const nu_travel_deg = nu_travel * R2D;

            // RZ-5: Desired phase angle
            const phi_desired = wrap2Pi(nu_travel - Math.PI);
            const phi_desired_deg = phi_desired * R2D;
            const lead_angle_deg = 360 - phi_desired_deg;

            // RZ-6: Wait time
            // WT = (phi_desired - phi0 ± k*2pi) / omega_drift
            // Smallest WT with 0 <= WT < T_syn
            const raw_WT = sameRate ? 0 : (phi_desired - phi0_rad) / omega_drift;
            let WT = sameRate ? 0 : ((raw_WT % T_syn) + T_syn) % T_syn;
            // Avoid -0 or 2pi edge rounding
            if (Math.abs(WT - T_syn) < 1e-4) WT = 0;

            // Recover k and sign used: WT * omega_drift - (phi_desired - phi0_rad) = k * 2pi
            const k_val = sameRate ? 0 : Math.round((WT * omega_drift - (phi_desired - phi0_rad)) / (2 * Math.PI));

            const TOF_total = WT + TOF;

            // Spacecraft coordinate orientations
            // Chase starts at theta = 0, target at -phi0
            const theta_c0 = 0;
            const theta_t0 = -phi0_rad;

            // At departure (t = WT):
            const theta_c_dep = theta_c0 + n_chase * WT;
            const r_burn1 = [Rchase * Math.cos(theta_c_dep), Rchase * Math.sin(theta_c_dep), 0];
            const v_before1 = [-V_chase * Math.sin(theta_c_dep), V_chase * Math.cos(theta_c_dep), 0];
            const v_after1 = [-V_tx1 * Math.sin(theta_c_dep), V_tx1 * Math.cos(theta_c_dep), 0];
            const dv1_vec = sub(v_after1, v_before1);

            // At arrival (t = WT + TOF):
            const theta_arr = theta_c_dep + Math.PI;
            const r_burn2 = [Rtarget * Math.cos(theta_arr), Rtarget * Math.sin(theta_arr), 0];
            const v_before2 = [-V_tx2 * Math.sin(theta_arr), V_tx2 * Math.cos(theta_arr), 0];
            const v_after2 = [-V_target * Math.sin(theta_arr), V_target * Math.cos(theta_arr), 0];
            const dv2_vec = sub(v_after2, v_before2);

            const events = [
                {
                    t: WT,
                    r: r_burn1,
                    vBefore: v_before1,
                    vAfter: v_after1,
                    dv: dv1_vec,
                    dv_mag: Math.abs(dv1),
                    dv_signed: dv1,
                    label: 'Burn 1'
                },
                {
                    t: TOF_total,
                    r: r_burn2,
                    vBefore: v_before2,
                    vAfter: v_after2,
                    dv: dv2_vec,
                    dv_mag: Math.abs(dv2),
                    dv_signed: dv2,
                    label: 'Burn 2'
                }
            ];

            return {
                mode: 'coplanar',
                constants: { MU: mu, R_EARTH: rEarth, MIN_ALT },
                Rchase,
                Rtarget,
                phi0: phi0_deg,
                phi0_rad,
                n_chase,
                n_target,
                omega_drift,
                T_syn,
                a_transfer,
                Period_transfer,
                TOF,
                V_chase,
                V_target,
                V_tx1,
                V_tx2,
                dv1,
                dv2,
                dv_total,
                nu_travel,
                nu_travel_deg,
                phi_desired,
                phi_desired_deg,
                lead_angle_deg,
                WT,
                raw_WT,
                k_val,
                TOF_total,
                arrival: TOF_total,
                target: { R: Rtarget, inc: 0, raan: 0, theta0: theta_t0, n: n_target },
                chase: { R: Rchase, inc: 0, raan: 0, theta0: theta_c0, n: n_chase },
                events,
                status: { ok: warnings.length === 0, warnings }
            };
        }

        /* ------------------------------------------------------------------ */
        /* 5.3 Co-Orbital Solver                                              */
        /* ------------------------------------------------------------------ */
        function solveCoOrbital({ Rchase, phi0, k = 1, mu = MU, rEarth = R_EARTH }) {
            const warnings = [];
            const phi0_deg = wrap360(phi0);
            const phi0_rad = phi0_deg * D2R;

            // Golden Rule of Phasing:
            // phi is measured from TARGET to CHASE in direction of motion.
            // Rule of thumb: if phi0 > 180, use negative angle (phi0 - 360).
            // At exactly 180, treated as ahead (nu_travel = 360 + 180/k).
            const isBehind = phi0_deg > 180;
            const phi_eff_deg = isBehind ? phi0_deg - 360 : phi0_deg;

            if (phi0_deg === 0) {
                warnings.push('no-phasing-needed');
            }

            const n_target = Math.sqrt(mu / Math.pow(Rchase, 3));
            const T_target = (2 * Math.PI) / n_target;

            // RZ-8: nu_travel for ONE phasing orbit
            const nu_travel_deg = 360 + phi_eff_deg / k;
            const nu_travel = nu_travel_deg * D2R;

            // RZ-9: Phasing period
            const Period_phasing = nu_travel / n_target;
            const TOF_rendezvous = k * Period_phasing;

            // RZ-10: a_phasing
            const a_phasing = Math.cbrt(mu * Math.pow(Period_phasing / (2 * Math.PI), 2));

            // RZ-11: Speeds
            const V_chase = Math.sqrt(mu / Rchase);
            const V_phasing = Math.sqrt(mu * (2 / Rchase - 1 / a_phasing));

            // RZ-12: Delta-V
            const dv1 = V_phasing - V_chase; // signed: positive posigrade, negative retrograde
            const dv2 = -dv1;
            const dv_total = 2 * Math.abs(dv1);

            // RZ-13: Perigee / Apogee check
            let r_p, r_a;
            if (isBehind) {
                // Lower phasing orbit, burn point is apogee
                r_a = Rchase;
                r_p = 2 * a_phasing - Rchase;
            } else {
                // Higher phasing orbit, burn point is perigee
                r_p = Rchase;
                r_a = 2 * a_phasing - Rchase;
            }
            const h_p = r_p - rEarth;
            const h_a = r_a - rEarth;

            if (r_p <= rEarth) {
                warnings.push('phasing-hits-earth');
            } else if (r_p <= rEarth + MIN_ALT) {
                warnings.push('perigee-low');
            }

            // Vectors & Events
            const theta_c0 = 0;
            const theta_t0 = -phi0_rad;

            // Burn 1 is at t = 0 at theta = 0
            const r_burn1 = [Rchase, 0, 0];
            const v_before1 = [0, V_chase, 0];
            const v_after1 = [0, V_phasing, 0];
            const dv1_vec = sub(v_after1, v_before1);

            // Burn 2 is at t = TOF_rendezvous at theta = 0
            const r_burn2 = [Rchase, 0, 0];
            const v_before2 = [0, V_phasing, 0];
            const v_after2 = [0, V_chase, 0];
            const dv2_vec = sub(v_after2, v_before2);

            const events = [
                {
                    t: 0,
                    r: r_burn1,
                    vBefore: v_before1,
                    vAfter: v_after1,
                    dv: dv1_vec,
                    dv_mag: Math.abs(dv1),
                    dv_signed: dv1,
                    label: 'Burn 1'
                },
                {
                    t: TOF_rendezvous,
                    r: r_burn2,
                    vBefore: v_before2,
                    vAfter: v_after2,
                    dv: dv2_vec,
                    dv_mag: Math.abs(dv2),
                    dv_signed: dv2,
                    label: 'Burn 2'
                }
            ];

            return {
                mode: 'coorbital',
                constants: { MU: mu, R_EARTH: rEarth, MIN_ALT },
                Rchase,
                Rtarget: Rchase,
                phi0: phi0_deg,
                phi0_rad,
                phi_eff_deg,
                isBehind,
                k,
                n_target,
                T_target,
                nu_travel,
                nu_travel_deg,
                Period_phasing,
                TOF_rendezvous,
                a_phasing,
                V_chase,
                V_phasing,
                dv1,
                dv2,
                dv_total,
                r_p,
                r_a,
                h_p,
                h_a,
                arrival: TOF_rendezvous,
                target: { R: Rchase, inc: 0, raan: 0, theta0: theta_t0, n: n_target },
                chase: { R: Rchase, inc: 0, raan: 0, theta0: theta_c0, n: n_target },
                events,
                status: { ok: warnings.length === 0, warnings }
            };
        }

        return {
            constants: { MU, R_EARTH, MIN_ALT },
            solveCoplanar, solveCoOrbital, propagate, stateAt, missAtArrival,
            wrap2Pi, wrap360, formatHms
        };
    })(C, OC, S.vec);

    /* Classical elements and r, v ----------------------------------------------------------------- */
    // a (km), e, i, raan, argp, nu (deg) to ECI r (km), v (km/s), and back (Vallado's RV2COE). When an
    // angle is undefined the conversion uses the usual stand-ins, so the two directions round-trip:
    //   circular inclined:     argp = 0, nu = argument of latitude u (from the ascending node)
    //   elliptical equatorial: raan = 0, argp = longitude of periapsis (from x, in the direction of motion)
    //   circular equatorial:   raan = argp = 0, nu = true longitude (from x, in the direction of motion)
    // elementsFromRv(r, v, ref) can instead keep a reference set's own values for the undefined angles
    // (a page's slider values), moving nu by the same amount, so a circle drawn from a slider set at
    // argp = 60 deg keeps argp = 60 deg.
    S.elements = (function (C, V) {
        const MU = C.mu;
        const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;
        const { dot, cross, norm } = V;
        // Below these an orbit counts as circular (e) or equatorial (sin i) for the stand-in angles.
        const CIRCULAR_E = 1e-10, EQUATORIAL_SIN_I = 1e-10;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        // Angle from a to b about the axis h (radians, 0 to 2 pi, in the direction of motion).
        const angleAbout = (a, b, h) => {
            const x = dot(a, b), y = dot(cross(a, b), h) / norm(h);
            const ang = Math.atan2(y, x);
            return ang < 0 ? ang + TWO_PI : ang;
        };

        function rvFromElements(el) {
            const i = el.i * D2R, O = el.raan * D2R, w = el.argp * D2R, nu = el.nu * D2R;
            const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
            const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
            const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
            const p = el.a * (1 - el.e * el.e);
            const rMag = p / (1 + el.e * Math.cos(nu));
            const k = Math.sqrt(MU / p);
            const cn = Math.cos(nu), sn = Math.sin(nu);
            return {
                r: [0, 1, 2].map((j) => rMag * (cn * P[j] + sn * Q[j])),
                v: [0, 1, 2].map((j) => k * (-sn * P[j] + (el.e + cn) * Q[j]))
            };
        }

        function elementsFromRv(r, v, ref) {
            const R = norm(r), Vm = norm(v);
            const h = cross(r, v), H = norm(h);
            const n = [-h[1], h[0], 0], N = norm(n);
            const eVec = r.map((x, k) => ((Vm * Vm - MU / R) * x - dot(r, v) * v[k]) / MU);
            const e = norm(eVec);
            const energy = Vm * Vm / 2 - MU / R;
            const a = -MU / (2 * energy);
            const p = H * H / MU;
            const i = Math.atan2(N, h[2]) * R2D;
            const circular = e < CIRCULAR_E;
            const equatorial = N / H < EQUATORIAL_SIN_I;
            const xHat = [1, 0, 0];
            let raan, argp, nu;
            if (!circular && !equatorial) {
                raan = angleAbout(xHat, n, [0, 0, 1]) * R2D;   // atan2(n_y, n_x)
                argp = angleAbout(n, eVec, h) * R2D;
                nu = angleAbout(eVec, r, h) * R2D;
            } else if (circular && !equatorial) {
                raan = angleAbout(xHat, n, [0, 0, 1]) * R2D;
                argp = 0;
                nu = angleAbout(n, r, h) * R2D;                   // argument of latitude
            } else if (!circular && equatorial) {
                raan = 0;
                argp = angleAbout(xHat, eVec, h) * R2D;           // longitude of periapsis
                nu = angleAbout(eVec, r, h) * R2D;
            } else {
                raan = 0;
                argp = 0;
                nu = angleAbout(xHat, r, h) * R2D;                // true longitude
            }
            const el = {
                a, e, i, raan: wrap360(raan), argp: wrap360(argp), nu: wrap360(nu), p, h: H, energy,
                kind: (circular ? 'circular' : 'elliptical') + (equatorial ? ' equatorial' : ' inclined'),
                undefinedAngles: { raan: equatorial, argp: circular || equatorial, nu: circular }
            };
            if (ref) keepReferenceAngles(el, ref);
            return el;
        }

        // Puts a reference set's raan and argp in place of undefined ones; nu moves by the same amount,
        // so the position is unchanged. Circular inclined keeps u = argp + nu. An equatorial orbit keeps
        // its longitudes, measured in the direction of motion: s raan + argp (+ nu), where s is +1 for a
        // prograde orbit and -1 for a retrograde one (i = 180 deg turns the raan the other way).
        function keepReferenceAngles(el, ref) {
            const s = el.i > 90 ? -1 : 1;
            const sum = s * el.raan + el.argp + el.nu;
            if (el.undefinedAngles.raan && el.undefinedAngles.argp) {
                // Circular equatorial: only the true longitude is defined.
                el.raan = wrap360(ref.raan); el.argp = wrap360(ref.argp);
                el.nu = wrap360(sum - s * el.raan - el.argp);
            } else if (el.undefinedAngles.raan) {
                // Elliptical equatorial: only the longitude of periapsis is defined.
                const lonPeri = s * el.raan + el.argp;
                el.raan = wrap360(ref.raan);
                el.argp = wrap360(lonPeri - s * el.raan);
            } else if (el.undefinedAngles.argp) {
                // Circular inclined: only the argument of latitude is defined.
                const u = el.argp + el.nu;
                el.argp = wrap360(ref.argp);
                el.nu = wrap360(u - el.argp);
            }
            return el;
        }

        // Where r sits on a given (drawn) orbit: its angle in that orbit's plane from that orbit's
        // perigee (deg, 0 to 360). For a satellite on the orbit this is its true anomaly; for one that
        // forces have moved a little off it, it stays steady where the osculating true anomaly of a
        // nearly circular orbit would jump about.
        function angleOnOrbit(r, el) {
            const O = el.raan * D2R, w = el.argp * D2R, i = el.i * D2R;
            const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
            const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
            const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
            return wrap360(Math.atan2(dot(r, Q), dot(r, P)) * R2D);
        }

        return { CIRCULAR_E, EQUATORIAL_SIN_I, rvFromElements, elementsFromRv, keepReferenceAngles, angleOnOrbit };
    })(C, S.vec);

    /* Satellites and propagation ------------------------------------------------------------------ */
    // Every satellite a page draws is stored as { r, v, t, props }: ECI km and km/s at t seconds
    // after the page's start time, and its own spacecraft properties (or null for the settings').
    // stateAt moves it with the propagator the settings choose:
    //   Kepler (default): exact two-body motion. Closed orbits use Kepler's equation in difference
    //     form with the f and g functions, open orbits the universal-variable solver.
    //   Cowell: the settings' solver and forces, from the start time. Short steps are integrated
    //     directly; longer ones read samples integrated once per satellite (SAMPLES_PER_ORBIT per
    //     orbit) and cached, with quintic Hermite interpolation (r, v and acceleration at each end)
    //     between them. The cache starts again when a setting changes.
    S.propagate = (function (C, OC, V, RM, EL, CW, FO) {
        const MU = C.mu, TWO_PI = 2 * Math.PI;
        const { dot, norm } = V;
        const SAMPLES_PER_ORBIT = 192;
        // The settings, kept current without copying them on every call.
        let model = OC.Settings.get();
        OC.Settings.onChange((s) => { model = s; });
        const startMs = () => (model.startMs === null ? FO.LOAD_TIME_MS : model.startMs);

        function satellite(r, v, t = 0, props = null) {
            return { r: [r[0], r[1], r[2]], v: [v[0], v[1], v[2]], t, props };
        }
        function fromElements(el, t = 0, props = null) {
            const { r, v } = EL.rvFromElements(el);
            return satellite(r, v, t, props);
        }

        // Two-body motion from (r0, v0) over dt seconds.
        function kepler(r0, v0, dt) {
            if (dt === 0) return { r: r0.slice(), v: v0.slice() };
            const R0 = norm(r0), V0 = norm(v0);
            const alpha = 2 / R0 - V0 * V0 / MU;           // 1/a
            if (!(alpha > 1e-12)) return RM.propagate(r0, v0, dt, MU);
            const a = 1 / alpha;
            const n = Math.sqrt(MU * alpha * alpha * alpha);
            const period = TWO_PI / n;
            // Whole turns change nothing, so step over the remainder only.
            let t = dt % period;
            if (t < 0) t += period;
            const dM = n * t;
            const s0 = dot(r0, v0) / Math.sqrt(MU * a);     // e sin E0
            const c0 = 1 - R0 / a;                         // e cos E0
            // dM = dE - c0 sin dE + s0 (1 - cos dE); its slope r/a stays positive, so a Newton step kept
            // inside a bracket always converges.
            const F = (x) => x - c0 * Math.sin(x) + s0 * (1 - Math.cos(x)) - dM;
            let lo = dM - 2, hi = dM + 2;
            let x = dM + (c0 * Math.sin(dM) - s0 * (1 - Math.cos(dM))) ;
            for (let k = 0; k < 60; k++) {
                const f = F(x);
                if (f > 0) hi = Math.min(hi, x); else lo = Math.max(lo, x);
                const slope = 1 - c0 * Math.cos(x) + s0 * Math.sin(x);
                let next = x - f / slope;
                if (!(next > lo && next < hi)) next = (lo + hi) / 2;
                if (Math.abs(next - x) < 1e-15 * Math.max(1, Math.abs(x))) { x = next; break; }
                x = next;
            }
            const cosX = Math.cos(x), sinX = Math.sin(x);
            const f = 1 - (1 - cosX) / (alpha * R0);
            const g = t - (x - sinX) / n;
            const r = [0, 1, 2].map((k) => f * r0[k] + g * v0[k]);
            const R = norm(r);
            const fDot = -Math.sqrt(MU * a) * sinX / (R * R0);
            const gDot = 1 - (1 - cosX) * a / R;
            return { r, v: [0, 1, 2].map((k) => fDot * r0[k] + gDot * v0[k]) };
        }

        /* Cowell, with cached samples */
        const grids = new WeakMap();
        function cowellOptions(sat) {
            // RK4 has fixed steps: 2,000 per orbit keeps it within 1 mm of Kepler over a LEO orbit.
            return { constants: C, forces: model.forces, spacecraft: sat.props || model.spacecraft, solver: model.solver, stepsPerOrbit: 2000 };
        }
        // The time to the next sample: a share of the local time scale 2 pi sqrt(r^3 / mu), so samples
        // crowd together near perigee, where the motion bends fastest (one period / SAMPLES_PER_ORBIT
        // on a circle).
        const sampleStep = (r) => TWO_PI * Math.sqrt(Math.pow(norm(r), 3) / MU) / SAMPLES_PER_ORBIT;
        function gridFor(sat) {
            const opts = cowellOptions(sat);
            const key = JSON.stringify([model.forces, model.solver, startMs(), opts.spacecraft]);
            let g = grids.get(sat);
            if (g && g.key === key) return g;
            const epoch0 = startMs() + sat.t * 1000;
            const f = CW.makeDerivative(C, model.forces, opts.spacecraft, epoch0);
            const node = (tt, r, v) => {
                const d = f(tt, [r[0], r[1], r[2], v[0], v[1], v[2]]);
                return { t: tt, r, v, a: [d[3], d[4], d[5]] };
            };
            const first = node(0, sat.r.slice(), sat.v.slice());
            g = { key, opts, epoch0, node, h: sampleStep(sat.r), forward: [first], backward: [first], failed: null };
            grids.set(sat, g);
            return g;
        }
        // Extends the samples in one direction until they pass the time span |dt|.
        function extend(g, list, span, dir) {
            while (Math.abs(list[list.length - 1].t) < span && !g.failed) {
                const last = list[list.length - 1];
                const h = sampleStep(last.r);
                try {
                    const res = CW.propagate(last.r, last.v, dir * h, { ...g.opts, epoch: g.epoch0 + last.t * 1000 });
                    list.push(g.node(last.t + dir * h, res.r, res.v));
                } catch (err) {
                    g.failed = { t: last.t, message: err.message };   // for example, drag brought it down
                }
            }
        }
        // Quintic Hermite between two samples: matches r, v and the acceleration at both ends. v is
        // the derivative of the same curve, so r and v stay consistent.
        function hermite(n0, n1, tt) {
            const h = n1.t - n0.t, s = (tt - n0.t) / h;
            const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s;
            const H = [
                1 - 10 * s3 + 15 * s4 - 6 * s5, s - 6 * s3 + 8 * s4 - 3 * s5, (s2 - 3 * s3 + 3 * s4 - s5) / 2,
                (s3 - 2 * s4 + s5) / 2, -4 * s3 + 7 * s4 - 3 * s5, 10 * s3 - 15 * s4 + 6 * s5
            ];
            const D = [
                -30 * s2 + 60 * s3 - 30 * s4, 1 - 18 * s2 + 32 * s3 - 15 * s4, (2 * s - 9 * s2 + 12 * s3 - 5 * s4) / 2,
                (3 * s2 - 8 * s3 + 5 * s4) / 2, -12 * s2 + 28 * s3 - 15 * s4, 30 * s2 - 60 * s3 + 30 * s4
            ];
            const mix = (W, scale) => [0, 1, 2].map((k) => (W[0] * n0.r[k] + W[1] * h * n0.v[k] + W[2] * h * h * n0.a[k]
                + W[3] * h * h * n1.a[k] + W[4] * h * n1.v[k] + W[5] * n1.r[k]) * scale);
            return { r: mix(H, 1), v: mix(D, 1 / h) };
        }
        function cowell(sat, dt) {
            const g = gridFor(sat);
            if (Math.abs(dt) <= g.h) {
                try {
                    return CW.propagate(sat.r, sat.v, dt, { ...g.opts, epoch: g.epoch0 });
                } catch (err) { /* fall through to the samples, which hold the last good state */ }
            }
            const dir = dt >= 0 ? 1 : -1;
            const list = dir > 0 ? g.forward : g.backward;
            const span = Math.abs(dt);
            extend(g, list, span, dir);
            if (Math.abs(list[list.length - 1].t) < span) {
                // Past the last good sample (the integration failed): the satellite stays there.
                const last = list[list.length - 1];
                return { r: last.r.slice(), v: last.v.slice(), stopped: g.failed };
            }
            // The last sample at or before the span (binary search: samples are not evenly spaced).
            let lo = 0, hi = list.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (Math.abs(list[mid].t) <= span) lo = mid; else hi = mid;
            }
            return hermite(list[lo], list[hi], dt);
        }

        // The propagator the settings choose: 'kepler' or 'cowell'.
        const propagatorName = () => model.propagator;

        // The satellite at time t (seconds after the page's start time).
        function stateAt(sat, t) {
            const dt = t - sat.t;
            const s = model.propagator === 'cowell' ? cowell(sat, dt) : kepler(sat.r, sat.v, dt);
            const out = satellite(s.r, s.v, t, sat.props);
            if (s.stopped) out.stopped = s.stopped;
            return out;
        }
        // The satellite at each time, oldest first.
        const trajectory = (sat, times) => Array.from(times, (t) => stateAt(sat, t));

        // Keeps a page's satellite in step with its sliders. sat(el) rebuilds r and v only when the
        // slider elements change; move(el, dt) moves the satellite on by dt seconds and returns the
        // elements read back from r and v (keeping the sliders' angles where an angle is undefined),
        // so the page can show them. Missing i, raan and argp count as 0 (an orbit drawn in a plane).
        function tracker() {
            let key = '', sat = null;
            const full = (el) => ({ i: 0, raan: 0, argp: 0, ...el });
            const keyOf = (el) => [el.a, el.e, el.i, el.raan, el.argp, el.nu].join();
            return {
                sat(el) {
                    const f = full(el), k = keyOf(f);
                    if (k !== key) { sat = fromElements(f, sat ? sat.t : 0); key = k; }
                    return sat;
                },
                move(el, dt) {
                    const f = full(el);
                    const s = this.sat(f);
                    sat = stateAt(s, s.t + dt);
                    const back = EL.elementsFromRv(sat.r, sat.v, f);
                    // The page's true anomaly: where the satellite sits on the slider orbit (the same
                    // as the osculating value for two-body motion).
                    back.nu = EL.angleOnOrbit(sat.r, f);
                    key = keyOf({ ...f, nu: back.nu });
                    return back;
                },
                // Speed, radius and the other readouts every page shows, from r and v.
                readout(el) {
                    const s = this.sat(el);
                    return { r: norm(s.r), v: norm(s.v), sat: s, elements: EL.elementsFromRv(s.r, s.v, full(el)) };
                }
            };
        }

        return { SAMPLES_PER_ORBIT, satellite, fromElements, kepler, stateAt, trajectory, tracker, propagatorName, startMs };
    })(C, OC, S.vec, S.rendezvous, S.elements, S.cowell, S.forces);

    /* Reference frames: ECI, ECEF and RIC viewpoints ---------------------------------------------- */
    S.frames = (function (C, OC, V, K, EL, PR) {
        const MU = C.mu;               // Earth gravitational parameter, km^3/s^2
        const RE = C.re;               // Earth equatorial radius, km
        const OMEGA_E = C.omegaE;      // Earth rotation rate, rad/s
        const D2R = Math.PI / 180;
        const SIDEREAL_DAY = 2 * Math.PI / OMEGA_E;
        const OBLIQUITY = OC.LESSON.obliquityDeg * D2R;
        const YEAR = OC.TIME.TROPICAL_YEAR_DAYS * OC.TIME.DAY_S;

        // Radius at which one orbit takes exactly one Earth rotation.
        const GEO_RADIUS = Math.cbrt(MU / (OMEGA_E * OMEGA_E));

        const { dot, cross } = V;

        function earthAngle(t) {
            return OMEGA_E * t;
        }

        const solveKepler = K.solve;

        function elements(a, e, i, raan, argp, M0) {
            const n = Math.sqrt(MU / (a * a * a));
            const ci = Math.cos(i), si = Math.sin(i);
            const cO = Math.cos(raan), sO = Math.sin(raan);
            const cw = Math.cos(argp), sw = Math.sin(argp);
            return {
                a, e, n, M0,
                b: a * Math.sqrt(1 - e * e),
                // Perifocal axes expressed in ECI
                P: [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si],
                Q: [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si],
                // The satellite itself, stored as r and v at t = 0 (OrbitMath.propagate).
                sat: satelliteAt(a, e, i, raan, argp, M0)
            };
        }

        function satelliteAt(a, e, i, raan, argp, M0) {
            const E = solveKepler(M0, e);
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            const R2D = 180 / Math.PI;
            return PR.fromElements({ a, e, i: i * R2D, raan: raan * R2D, argp: argp * R2D, nu: nu * R2D });
        }

        // ECI position (km) at t seconds, propagated from the stored r and v.
        function positionEci(el, t) {
            return PR.stateAt(el.sat, t).r;
        }

        // Builds the scenario: a circular target orbit, a second spacecraft on a
        // slightly different orbit with the same period, and a ground site.
        // separation: the second spacecraft's radial swing above and below the target, km.
        // tiltOffset: the difference between the two orbits' inclinations, radians.
        function makeScenario(opts) {
            const a = opts.radius;
            const i = opts.inclination;
            const raan = opts.raan;
            const u0 = opts.startAngle;
            const argp2 = 40 * D2R;
            const target = elements(a, 0, i, raan, 0, u0);
            const second = elements(a, opts.separation / a, i + opts.tiltOffset, raan, argp2, u0 - argp2);
            const siteLon = opts.siteLongitude;
            return {
                a, i, raan, u0, target, second,
                period: 2 * Math.PI / target.n,
                siteEcef: [RE * Math.cos(siteLon), RE * Math.sin(siteLon), 0]
            };
        }

        function sitePositionEci(s, t) {
            const th = earthAngle(t), c = Math.cos(th), si = Math.sin(th);
            return [
                c * s.siteEcef[0] - si * s.siteEcef[1],
                si * s.siteEcef[0] + c * s.siteEcef[1],
                s.siteEcef[2]
            ];
        }

        // RIC unit vectors, in ECI, at time t.
        function ricBasis(s, t) {
            const el = s.target;
            const u = el.M0 + el.n * t;
            const cu = Math.cos(u), su = Math.sin(u);
            const R = [cu * el.P[0] + su * el.Q[0], cu * el.P[1] + su * el.Q[1], cu * el.P[2] + su * el.Q[2]];
            const I = [-su * el.P[0] + cu * el.Q[0], -su * el.P[1] + cu * el.Q[1], -su * el.P[2] + cu * el.Q[2]];
            const C = cross(R, I);
            return { R, I, C };
        }

        // Coordinates of an ECI position in a frame, in the order the frame names them:
        // ECI [I, J, K], ECEF [X, Y, Z], RIC [R, I, C].
        function coordinates(frame, p, t, s) {
            if (frame === 'ECI') return [p[0], p[1], p[2]];
            if (frame === 'ECEF') {
                const th = earthAngle(t), c = Math.cos(th), si = Math.sin(th);
                return [c * p[0] + si * p[1], -si * p[0] + c * p[1], p[2]];
            }
            const b = ricBasis(s, t);
            const o = positionEci(s.target, t);
            const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
            return [dot(d, b.R), dot(d, b.I), dot(d, b.C)];
        }

        // Screen layout of each frame. ECI and ECEF keep the third axis up. RIC keeps
        // R up, so that Earth is always below the target.
        function toDisplay(frame, c) {
            return frame === 'RIC' ? [c[1], c[2], c[0]] : c;
        }

        // Rotation from ECI into display axes, as three rows, plus the frame origin in ECI.
        function displayTransform(frame, t, s) {
            if (frame === 'ECI') {
                return { rows: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0] };
            }
            if (frame === 'ECEF') {
                const th = earthAngle(t), c = Math.cos(th), si = Math.sin(th);
                return { rows: [[c, si, 0], [-si, c, 0], [0, 0, 1]], origin: [0, 0, 0] };
            }
            const b = ricBasis(s, t);
            return { rows: [b.I, b.C, b.R], origin: positionEci(s.target, t) };
        }

        // Speed of a moving point as measured inside a frame, km/s.
        function speedInFrame(frame, positionAt, t, s) {
            const h = 1;
            const a = coordinates(frame, positionAt(t - h), t - h, s);
            const b = coordinates(frame, positionAt(t + h), t + h, s);
            return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * h);
        }

        // Unit vector toward the Sun in ECI. At t = 0 the simulation is at the March
        // equinox, when the Sun lies along +I.
        function sunDirection(t) {
            const l = 2 * Math.PI * t / YEAR;
            return [Math.cos(l), Math.sin(l) * Math.cos(OBLIQUITY), Math.sin(l) * Math.sin(OBLIQUITY)];
        }

        return {
            MU, RE, OMEGA_E, D2R, SIDEREAL_DAY, GEO_RADIUS,
            earthAngle, makeScenario, positionEci, sitePositionEci, ricBasis,
            coordinates, toDisplay, displayTransform, speedInFrame, sunDirection, dot, cross
        };
    })(C, OC, S.vec, S.kepler, S.elements, S.propagate);

    /* Relative motion: CW, RMOEs and the exact two-orbit model ------------------------------------ */
    S.rpo = (function (C, OC, V, K, PR) {
        const MU = C.mu;
        const RE = C.re;
        const G0 = C.g0;
        const GEO_A = OC.LESSON.rGeo;
        const OMEGA_E = C.omegaE;
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;
        const TINY = 1e-9;

        const ORBITS = OC.ORBIT_PRESETS;

        function meanMotion(a) { return Math.sqrt(MU / (a * a * a)); }
        function period(a) { return TWO_PI / meanMotion(a); }
        function wrap360(deg) {
            const w = ((deg % 360) + 360) % 360;
            return w === 360 ? 0 : w;
        }
        function wrap180(deg) {
            const w = wrap360(deg);
            return w > 180 ? w - 360 : w;
        }
        function wrapPi(rad) {
            let w = rad % TWO_PI;
            if (w > Math.PI) w -= TWO_PI;
            if (w <= -Math.PI) w += TWO_PI;
            return w;
        }

        // ---------- vectors ----------
        const { dot, cross, norm, unit, sub } = V;

        // ---------- RMOEs (course model) ----------
        function rmoeFromState(state, n) {
            const [x0, y0, z0, vx, vy, vz] = state;
            const xc = 4 * x0 + 2 * vy / n;
            const yc0 = y0 - 2 * vx / n;
            const C = Math.hypot(xc - x0, vx / n);
            const zmax = Math.hypot(z0, vz / n);
            return {
                xc, yc0, C, zmax,
                M0: C < TINY ? null : wrap360(Math.atan2(vx / n, xc - x0) * R2D),
                dM0: zmax < TINY ? null : wrap360(Math.atan2(z0, vz / n) * R2D)
            };
        }

        function stateFromRmoe(rmoe, n, t) {
            t = t || 0;
            const M = n * t + (rmoe.M0 === null ? 0 : rmoe.M0) * D2R;
            const dM = n * t + (rmoe.dM0 === null ? 0 : rmoe.dM0) * D2R;
            const ycDot = -1.5 * n * rmoe.xc;
            return [
                rmoe.xc - rmoe.C * Math.cos(M),
                rmoe.yc0 + ycDot * t + 2 * rmoe.C * Math.sin(M),
                rmoe.zmax * Math.sin(dM),
                n * rmoe.C * Math.sin(M),
                ycDot + 2 * n * rmoe.C * Math.cos(M),
                n * rmoe.zmax * Math.cos(dM)
            ];
        }

        // The whole NMC that chase is on right now: one revolution of the course model from these
        // RMOEs with the drift held still, so the loop sits around the current center and moves with
        // chase. count + 1 points [x, y, z, ...] in km, the last repeating the first to close it.
        function nmcLoop(rmoe, count) {
            count = count || 120;
            const out = new Float64Array(3 * (count + 1));
            const m0 = (rmoe.M0 === null ? 0 : rmoe.M0) * D2R, d0 = (rmoe.dM0 === null ? 0 : rmoe.dM0) * D2R;
            for (let k = 0; k <= count; k++) {
                const a = 2 * Math.PI * k / count;
                out[3 * k] = rmoe.xc - rmoe.C * Math.cos(m0 + a);
                out[3 * k + 1] = rmoe.yc0 + 2 * rmoe.C * Math.sin(m0 + a);
                out[3 * k + 2] = rmoe.zmax * Math.sin(d0 + a);
            }
            return out;
        }

        function rmoeAt(rmoe, n, t) {
            const adv = n * t * R2D;
            return {
                xc: rmoe.xc,
                yc0: rmoe.yc0 - 1.5 * n * rmoe.xc * t,
                C: rmoe.C,
                zmax: rmoe.zmax,
                M0: rmoe.M0 === null ? null : wrap360(rmoe.M0 + adv),
                dM0: rmoe.dM0 === null ? null : wrap360(rmoe.dM0 + adv)
            };
        }

        function driftRate(rmoe, n, aTarget) {
            return {
                kmPerSec: -1.5 * n * rmoe.xc,
                kmPerRev: -3 * Math.PI * rmoe.xc,
                degPerRev: -(540 / aTarget) * rmoe.xc
            };
        }

        function boundaryTable(rmoe, n) {
            const ycDot = -1.5 * n * rmoe.xc;
            const { xc, yc0, C, zmax } = rmoe;
            return {
                inPlane: [
                    { name: 'Bottom', angle: 0, x: xc - C, y: yc0, vx: 0, vy: ycDot + 2 * n * C },
                    { name: 'Front', angle: 90, x: xc, y: yc0 + 2 * C, vx: n * C, vy: ycDot },
                    { name: 'Top', angle: 180, x: xc + C, y: yc0, vx: 0, vy: ycDot - 2 * n * C },
                    { name: 'Back', angle: 270, x: xc, y: yc0 - 2 * C, vx: -n * C, vy: ycDot }
                ],
                cross: [
                    { name: '+P.C.', angle: 0, z: 0, vz: n * zmax },
                    { name: 'Left', angle: 90, z: zmax, vz: 0 },
                    { name: '−P.C.', angle: 180, z: 0, vz: -n * zmax },
                    { name: 'Right', angle: 270, z: -zmax, vz: 0 }
                ]
            };
        }

        function timeToAngle(nowDeg, targetDeg, n) {
            return wrap360(targetDeg - nowDeg) / 360 * (TWO_PI / n);
        }

        // ---------- CW equations (course model) ----------
        function cwPropagate(state, n, t) {
            const [x0, y0, z0, vx, vy, vz] = state;
            const c = Math.cos(n * t);
            const s = Math.sin(n * t);
            return [
                4 * x0 + 2 * vy / n - (3 * x0 + 2 * vy / n) * c + (vx / n) * s,
                y0 - 2 * vx / n - (3 * vy + 6 * n * x0) * t + (2 * vx / n) * c + (4 * vy / n + 6 * x0) * s,
                z0 * c + (vz / n) * s,
                (3 * n * x0 + 2 * vy) * s + vx * c,
                -(3 * vy + 6 * n * x0) - 2 * vx * s + (4 * vy + 6 * n * x0) * c,
                -n * z0 * s + vz * c
            ];
        }

        function stm(n, t) {
            const c = Math.cos(n * t);
            const s = Math.sin(n * t);
            return {
                rr: [[4 - 3 * c, 0, 0], [6 * (s - n * t), 1, 0], [0, 0, c]],
                rv: [[s / n, 2 * (1 - c) / n, 0], [-2 * (1 - c) / n, (4 * s - 3 * n * t) / n, 0], [0, 0, s / n]],
                vr: [[3 * n * s, 0, 0], [-6 * n * (1 - c), 0, 0], [0, 0, -n * s]],
                vv: [[c, 2 * s, 0], [-2 * s, 4 * c - 3, 0], [0, 0, c]]
            };
        }

        // The velocity needed at r0 to arrive at r1 after time t, or null where no answer exists.
        function transferVelocity(r0, r1, n, t) {
            const m = stm(n, t);
            const bx = r1[0] - (m.rr[0][0] * r0[0]);
            const by = r1[1] - (m.rr[1][0] * r0[0] + r0[1]);
            const bz = r1[2] - m.rr[2][2] * r0[2];
            const a = m.rv[0][0], b = m.rv[0][1], c = m.rv[1][0], d = m.rv[1][1];
            const det = a * d - b * c;                       // (8(1 - cos) - 3 nt sin) / n^2
            if (Math.abs(det) * n * n < 1e-9) return null;
            let vz = 0;
            const sz = m.rv[2][2];                           // sin(nt) / n
            if (Math.abs(sz) * n < 1e-9) {
                if (Math.abs(bz) > 1e-9) return null;
            } else {
                vz = bz / sz;
            }
            return [(d * bx - b * by) / det, (-c * bx + a * by) / det, vz];
        }

        function applyBurn(state, dv) {
            return [state[0], state[1], state[2], state[3] + dv[0], state[4] + dv[1], state[5] + dv[2]];
        }

        // Rules of thumb. Results are km/s; "d" means want minus have.
        const rule = {
            recenter: (n, dyc) => -(n / 2) * dyc,
            resize: (n, dC, xdotSign) => (xdotSign < 0 ? -1 : 1) * n * dC,
            raise: (n, dxc) => (n / 2) * dxc,
            driftOverRevs: (n, dyc, k) => -(n / (6 * Math.PI)) * (dyc / k),
            crossTrack: (n, dzmax, zdotSign) => (zdotSign < 0 ? -1 : 1) * n * dzmax
        };

        // ---------- orbits (exact model) ----------
        function keplerE(M, e) { return K.solve(wrapPi(M), e); }

        function meanFromTrue(nuDeg, e) {
            const h = nuDeg * D2R / 2;
            const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(h), Math.sqrt(1 + e) * Math.cos(h));
            return E - e * Math.sin(E);
        }

        function trueFromMean(M, e) {
            const E = keplerE(M, e);
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return wrap360(nu * R2D);
        }

        // The same orbit t seconds later. Always computed from the elements, never stepped.
        function coeAt(coe, t) {
            const M = meanFromTrue(coe.nu, coe.e) + meanMotion(coe.a) * t;
            return { a: coe.a, e: coe.e, i: coe.i, raan: coe.raan, argp: coe.argp, nu: trueFromMean(M, coe.e) };
        }

        function orbitProblem(coe) {
            if (!(coe.a > 0)) return 'a';
            if (!(coe.e >= 0 && coe.e < 0.95)) return 'e';
            if (coe.a * (1 - coe.e) < RE + 100) return 'perigee';
            return null;
        }

        function coesToRv(coe) {
            const i = coe.i * D2R, O = coe.raan * D2R, w = coe.argp * D2R, nu = coe.nu * D2R;
            const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w);
            const ci = Math.cos(i), si = Math.sin(i);
            const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
            const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
            const p = coe.a * (1 - coe.e * coe.e);
            const r = p / (1 + coe.e * Math.cos(nu));
            const k = Math.sqrt(MU / p);
            const cn = Math.cos(nu), sn = Math.sin(nu);
            return {
                r: [r * (cn * P[0] + sn * Q[0]), r * (cn * P[1] + sn * Q[1]), r * (cn * P[2] + sn * Q[2])],
                v: [k * (-sn * P[0] + (coe.e + cn) * Q[0]), k * (-sn * P[1] + (coe.e + cn) * Q[1]), k * (-sn * P[2] + (coe.e + cn) * Q[2])]
            };
        }

        // The conic through an ECI state: semi-latus rectum p, eccentricity e, perifocal unit
        // vectors P (toward perigee, or along r for a circle) and Q, and the true anomaly nu0 (rad)
        // of r. null when the state does not define an orbit.
        function conicFromRv(r, v) {
            const h = cross(r, v);
            const hn = norm(h), rn = norm(r);
            if (hn === 0 || rn === 0) return null;
            const ev = cross(v, h).map((x, k) => x / MU - r[k] / rn);   // eccentricity vector
            const e = norm(ev);
            const P = e > 1e-9 ? ev.map((x) => x / e) : r.map((x) => x / rn);
            const Q = cross(h.map((x) => x / hn), P);
            return { p: hn * hn / MU, e, P, Q, nu0: Math.atan2(dot(r, Q), dot(r, P)) };
        }

        // The RIC axes at time t, as ECI unit vectors, with the target's state and the frame's turn rate.
        // Each spacecraft is stored as r and v (OrbitMath.propagate), built once from its elements and
        // rebuilt only when they change; its state at time t is propagated from there.
        const stored = new WeakMap();
        function rvAt(coe, t) {
            const key = [coe.a, coe.e, coe.i, coe.raan, coe.argp, coe.nu].join();
            let entry = stored.get(coe);
            if (!entry || entry.key !== key) {
                entry = { key, sat: PR.fromElements(coe) };
                stored.set(coe, entry);
            }
            return t ? PR.stateAt(entry.sat, t) : entry.sat;
        }

        function ricBasis(targetCoe, t) {
            return basisFromRv(rvAt(targetCoe, t));
        }
        // The target's RIC axes from its r and v: R along r, C along h, I = C x R; omega = |h| / r^2.
        function basisFromRv(rv) {
            const h = cross(rv.r, rv.v);
            const R = unit(rv.r);
            const C = unit(h);
            const I = cross(C, R);
            const rr = dot(rv.r, rv.r);
            return { R, I, C, r: rv.r.slice(), v: rv.v.slice(), omega: norm(h) / rr };
        }

        /* Exact relative motion and the two RIC axis types ---------------------------------------- */
        // Rectilinear RIC: the straight-line offset along the target's R, I, C axes (the default).
        // Curvilinear RIC: x is the difference in radius, y the arc along the target's orbit
        // (r_t times the angle around), z the arc out of the plane (r_t times the angle). For a few
        // km at GEO the two agree to centimetres; they part as the separation grows.
        // States are [x, y, z, xdot, ydot, zdot], rates seen from the rotating RIC axes; rt and rtDot
        // are the target's radius and its rate of change.
        function curvilinearFromRect(s, rt, rtDot) {
            const px = rt + s[0], py = s[1], pz = s[2];
            const vx = rtDot + s[3], vy = s[4], vz = s[5];
            const P = Math.hypot(px, py, pz), Pdot = (px * vx + py * vy + pz * vz) / P;
            const dTheta = Math.atan2(py, px), phi = Math.asin(pz / P);
            const dThetaDot = (px * vy - py * vx) / (px * px + py * py);
            const phiDot = (vz * P - pz * Pdot) / (P * P * Math.cos(phi));
            return [P - rt, rt * dTheta, rt * phi, Pdot - rtDot, rtDot * dTheta + rt * dThetaDot, rtDot * phi + rt * phiDot];
        }
        function rectFromCurvilinear(c, rt, rtDot) {
            const P = rt + c[0], dTheta = c[1] / rt, phi = c[2] / rt;
            const Pdot = rtDot + c[3];
            const dThetaDot = (c[4] - rtDot * dTheta) / rt, phiDot = (c[5] - rtDot * phi) / rt;
            const cT = Math.cos(dTheta), sT = Math.sin(dTheta), cP = Math.cos(phi), sP = Math.sin(phi);
            const u = [cP * cT, cP * sT, sP];
            const du = [0, 1, 2].map((k) => [-cP * sT, cP * cT, 0][k] * dThetaDot + [-sP * cT, -sP * sT, cP][k] * phiDot);
            const p = u.map((x) => P * x), pDot = [0, 1, 2].map((k) => Pdot * u[k] + P * du[k]);
            return [p[0] - rt, p[1], p[2], pDot[0] - rtDot, pDot[1], pDot[2]];
        }
        // Rectilinear relative state of chase from target, both as { r, v } at the same moment.
        function relativeFromRv(T, Cs) {
            const basis = basisFromRv(T);
            const dr = sub(Cs.r, T.r), dv = sub(Cs.v, T.v);
            const rho = [dot(dr, basis.R), dot(dr, basis.I), dot(dr, basis.C)];
            const w = basis.omega;
            // omega x rho with omega along C is [-w y, w x, 0]. Leaving this out gives the wrong rate.
            const rhoDot = [dot(dv, basis.R) + w * rho[1], dot(dv, basis.I) - w * rho[0], dot(dv, basis.C)];
            return { rho, rhoDot, basis, range: norm(dr) };
        }
        // The exact model: both spacecraft propagated on their own (OrbitMath.propagate, with the
        // settings' propagator), subtracted, and turned into the target's RIC axes of the given type.
        // rect always holds the rectilinear state, for drawing in ECI.
        function relativeStateSats(targetSat, chaseSat, t, axes = 'rectilinear') {
            const T = PR.stateAt(targetSat, t), Cs = PR.stateAt(chaseSat, t);
            const rel = relativeFromRv(T, Cs);
            const rect = [...rel.rho, ...rel.rhoDot];
            let shown = rect;
            if (axes === 'curvilinear') {
                const rt = norm(T.r);
                shown = curvilinearFromRect(rect, rt, dot(T.r, T.v) / rt);
            }
            return {
                rho: shown.slice(0, 3), rhoDot: shown.slice(3), rect: { rho: rel.rho, rhoDot: rel.rhoDot },
                basis: rel.basis, range: rel.range, rT: T.r, rC: Cs.r, chase: Cs, target: T
            };
        }
        // Samples of relativeStateSats from t0 to t1: the path in the chosen axes, and the
        // rectilinear path for the ECI view.
        function sampleRelativeSats(targetSat, chaseSat, t0, t1, count, axes = 'rectilinear') {
            const path = new Float64Array(count * 3), rect = new Float64Array(count * 3);
            for (let k = 0; k < count; k++) {
                const tt = count > 1 ? t0 + (t1 - t0) * k / (count - 1) : t0;
                const s = relativeStateSats(targetSat, chaseSat, tt, axes);
                for (let a = 0; a < 3; a++) { path[3 * k + a] = s.rho[a]; rect[3 * k + a] = s.rect.rho[a]; }
            }
            return { path, rect };
        }
        // The chase as a stored satellite, from a relative state in the target's RIC axes at time t.
        function chaseSatFromRic(state, targetSat, t, axes = 'rectilinear') {
            const T = PR.stateAt(targetSat, t);
            let rect = state;
            if (axes === 'curvilinear') {
                const rt = norm(T.r);
                rect = rectFromCurvilinear(state, rt, dot(T.r, T.v) / rt);
            }
            const rv = chaseRvFromRic(rect, basisFromRv(T));
            return PR.satellite(rv.r, rv.v, t);
        }
        // The target as a stored satellite, from its elements.
        const targetSat = (coe) => rvAt(coe, 0);

        function ricToEci(rho, basis) {
            return [
                rho[0] * basis.R[0] + rho[1] * basis.I[0] + rho[2] * basis.C[0],
                rho[0] * basis.R[1] + rho[1] * basis.I[1] + rho[2] * basis.C[1],
                rho[0] * basis.R[2] + rho[1] * basis.I[2] + rho[2] * basis.C[2]
            ];
        }

        // Chase's ECI state from its RIC state: r = rT + rho, v = vT + omega x rho + rho dot,
        // with the frame turning at basis.omega about C.
        function chaseRvFromRic(state, basis) {
            const w = basis.omega;
            const rho = ricToEci(state, basis);
            const rel = ricToEci([state[3] - w * state[1], state[4] + w * state[0], state[5]], basis);
            return { r: basis.r.map((x, k) => x + rho[k]), v: basis.v.map((x, k) => x + rel[k]) };
        }

        // Linear mapping from element differences to RMOEs (the method the course teaches).
        function rmoeFromCoes(targetCoe, chaseCoe) {
            const a = targetCoe.a;
            const n = meanMotion(a);
            const i = targetCoe.i * D2R;
            const u = (targetCoe.argp + targetCoe.nu) * D2R;
            const Mc = meanFromTrue(chaseCoe.nu, chaseCoe.e);
            const du = wrapPi(chaseCoe.argp * D2R + Mc - u);
            const di = (chaseCoe.i - targetCoe.i) * D2R;
            const dO = wrapPi((chaseCoe.raan - targetCoe.raan) * D2R);
            let z, zDotOverN;
            if (Math.abs(Math.sin(i)) < EQUATORIAL) {
                // A (nearly) equatorial target: chase's node can be anywhere, so the small-angle form in
                // di and dO does not hold. Use chase's orbit normal h: z = -a h.R and z'/n = -a h.I,
                // scaled by theta / sin theta (theta the angle between the planes), so a plain
                // inclination difference gives exactly a di sin u, as in the small-angle form.
                const b = ricBasis(targetCoe, 0);
                const h = orbitNormal(chaseCoe);
                const hR = dot(h, b.R), hI = dot(h, b.I), s = Math.min(1, Math.hypot(hR, hI));
                const f = s > 1e-12 ? Math.asin(s) / s : 1;
                z = -a * f * hR;
                zDotOverN = -a * f * hI;
            } else {
                z = a * (di * Math.sin(u) - dO * Math.sin(i) * Math.cos(u));
                zDotOverN = a * (di * Math.cos(u) + dO * Math.sin(i) * Math.sin(u));
            }
            const C = chaseCoe.a * chaseCoe.e;
            const zmax = Math.hypot(z, zDotOverN);
            return {
                xc: chaseCoe.a - a,
                yc0: a * wrapPi(du + dO * Math.cos(i)),
                C,
                zmax,
                M0: C < TINY ? null : wrap360(Mc * R2D),
                dM0: zmax < TINY ? null : wrap360(Math.atan2(z, zDotOverN) * R2D),
                n
            };
        }

        const EQUATORIAL = 0.02;   // |sin i| below this (about 1.1°) counts as an equatorial target
        function orbitNormal(coe) {
            const i = coe.i * D2R, O = coe.raan * D2R;
            return [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
        }

        // The inverse of rmoeFromCoes: chase's elements for a circular target and a set of RMOEs, so
        // that rmoeFromCoes(target, coesFromRmoe(target, rmoe)) gives the same RMOEs back. An
        // undefined M0 or dM0 (null) is taken as 0.
        function coesFromRmoe(targetCoe, rmoe) {
            const a = targetCoe.a;
            const i = targetCoe.i * D2R;
            const u = (targetCoe.argp + targetCoe.nu) * D2R;
            const aC = a + rmoe.xc;
            const eC = rmoe.C / aC;
            const Mc = (rmoe.M0 === null || rmoe.M0 === undefined ? 0 : rmoe.M0) * D2R;
            const dM = (rmoe.dM0 === null || rmoe.dM0 === undefined ? 0 : rmoe.dM0) * D2R;
            const z = rmoe.zmax * Math.sin(dM), zd = rmoe.zmax * Math.cos(dM);
            let iC, raanC;
            if (Math.abs(Math.sin(i)) < EQUATORIAL) {
                // Tilt the target's plane by theta about the line dM behind the target.
                const b = ricBasis(targetCoe, 0);
                const th = Math.min(Math.PI / 2, rmoe.zmax / a), s = Math.sin(th), c = Math.cos(th);
                const Mhat = [0, 1, 2].map(k => Math.sin(dM) * b.R[k] + Math.cos(dM) * b.I[k]);
                const h = [0, 1, 2].map(k => c * b.C[k] - s * Mhat[k]);
                iC = Math.acos(Math.max(-1, Math.min(1, h[2])));
                raanC = Math.hypot(h[0], h[1]) < 1e-12 ? targetCoe.raan * D2R : Math.atan2(h[0], -h[1]);
            } else {
                iC = i + (z * Math.sin(u) + zd * Math.cos(u)) / a;
                raanC = targetCoe.raan * D2R + (zd * Math.sin(u) - z * Math.cos(u)) / (a * Math.sin(i));
            }
            const dO = wrapPi(raanC - targetCoe.raan * D2R);
            const argpC = u + rmoe.yc0 / a - dO * Math.cos(i) - Mc;
            return {
                a: aC, e: eC, i: iC * R2D, raan: wrap360(raanC * R2D),
                argp: wrap360(argpC * R2D), nu: wrap360(trueFromMean(Mc, eC))
            };
        }

        // Exact relative position and its rate in the RIC frame at time t.
        function relativeState(targetCoe, chaseCoe, t) {
            const T = rvAt(targetCoe, t), c = rvAt(chaseCoe, t);
            const rel = relativeFromRv(T, c);
            return { rho: rel.rho, rhoDot: rel.rhoDot, range: rel.range, basis: rel.basis, rT: T.r, rC: c.r };
        }

        function sampleRelative(targetCoe, chaseCoe, t0, t1, count) {
            const out = new Float64Array(count * 3);
            for (let k = 0; k < count; k++) {
                const t = count > 1 ? t0 + (t1 - t0) * k / (count - 1) : t0;
                const rho = relativeState(targetCoe, chaseCoe, t).rho;
                out[3 * k] = rho[0]; out[3 * k + 1] = rho[1]; out[3 * k + 2] = rho[2];
            }
            return out;
        }

        function coeDifference(targetCoe, chaseCoe) {
            return {
                da: chaseCoe.a - targetCoe.a,
                de: chaseCoe.e - targetCoe.e,
                di: chaseCoe.i - targetCoe.i,
                draan: wrap180(chaseCoe.raan - targetCoe.raan),
                dargp: wrap180(chaseCoe.argp - targetCoe.argp),
                dnu: wrap180(chaseCoe.nu - targetCoe.nu)
            };
        }

        function coeFromDifference(targetCoe, diff) {
            return {
                a: targetCoe.a + diff.da,
                e: targetCoe.e + diff.de,
                i: Math.min(180, Math.max(0, targetCoe.i + diff.di)),
                raan: wrap360(targetCoe.raan + diff.draan),
                argp: wrap360(targetCoe.argp + diff.dargp),
                nu: wrap360(targetCoe.nu + diff.dnu)
            };
        }

        // ---------- description, sampling, plans ----------
        const MOTIONS = {
            '000': ['perch', 'Perch'],
            '100': ['linear-drift', 'Drift'],
            '010': ['stationary-nmc', 'NMC'],
            '110': ['drifting-nmc', 'Drifting NMC'],
            '001': ['cross-track', 'Cross-track motion'],
            '101': ['drifting-cross-track', 'Snake'],
            '011': ['nmc-cross-track', 'Cross-Track NMC'],
            '111': ['corkscrew', 'Corkscrew']
        };

        function classifyMotion(rmoe) {
            const eps = Math.max(0.01, 0.002 * Math.max(Math.abs(rmoe.xc), rmoe.C, rmoe.zmax, 1));
            const code = (Math.abs(rmoe.xc) > eps ? '1' : '0') + (rmoe.C > eps ? '1' : '0') + (rmoe.zmax > eps ? '1' : '0');
            const [key, label] = MOTIONS[code];
            if (key === 'perch' && Math.abs(rmoe.yc0) <= eps) return { key, label: 'At the target' };
            return { key, label };
        }

        function sampleTrajectory(rmoe, n, t0, t1, count) {
            const out = new Float64Array(count * 3);
            for (let k = 0; k < count; k++) {
                const t = count > 1 ? t0 + (t1 - t0) * k / (count - 1) : t0;
                const s = stateFromRmoe(rmoe, n, t);
                out[3 * k] = s[0]; out[3 * k + 1] = s[1]; out[3 * k + 2] = s[2];
            }
            return out;
        }


        // toFixed of a tiny negative number gives '-0.000'; show it as '0.000'.
        const noNegZero = (text) => Number(text) === 0 ? text.replace('-', '') : text;
        const fmt = {
            km(v) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                const m = Math.abs(v);
                return noNegZero(v.toFixed(m < 100 ? 3 : m < 1000 ? 2 : 1));
            },
            ms(vKmPerSec) {
                if (vKmPerSec === null || vKmPerSec === undefined || !isFinite(vKmPerSec)) return 'undefined';
                const v = vKmPerSec * 1000;
                return noNegZero(v.toFixed(Math.abs(v) < 10 ? 4 : 3));
            },
            deg(v) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                return noNegZero(v.toFixed(1));
            },
            signed(v, digits) {
                if (v === null || v === undefined || !isFinite(v)) return 'undefined';
                const text = Math.abs(v).toFixed(digits);
                if (Number(text) === 0) return text;
                return (v < 0 ? '−' : '+') + text;
            }
        };

        return {
            MU, RE, G0, GEO_A, OMEGA_E, D2R, R2D, ORBITS,
            meanMotion, period, wrap360, wrap180,
            rmoeFromState, stateFromRmoe, rmoeAt, nmcLoop, driftRate, boundaryTable, timeToAngle,
            cwPropagate, stm, transferVelocity, applyBurn, rule,
            keplerE, meanFromTrue, trueFromMean, coeAt, orbitProblem, coesToRv, rvAt, conicFromRv, ricBasis, ricToEci, chaseRvFromRic,
            basisFromRv, curvilinearFromRect, rectFromCurvilinear, relativeFromRv, relativeStateSats, sampleRelativeSats,
            chaseSatFromRic, targetSat,
            rmoeFromCoes, coesFromRmoe, relativeState, sampleRelative, coeDifference, coeFromDifference,
            classifyMotion, sampleTrajectory, fmt
        };
    })(C, OC, S.vec, S.kepler, S.propagate);

    /* Orbit shape and speed (Orbital Equation Explorer) ------------------------------------------- */
    S.orbit = (function (C, OC, K) {
        const MU = C.mu;           // km^3/s^2
        const R_E = C.re;          // km
        const D2R = Math.PI / 180;
        const TWO_PI = 2 * Math.PI;

        const wrap360 = (deg) => ((deg % 360) + 360) % 360;

        // Orbit equation: r = a(1 - e^2) / (1 + e cos nu)
        const semiLatus = (a, e) => a * (1 - e * e);
        const radiusAt = (a, e, nu) => semiLatus(a, e) / (1 + e * Math.cos(nu * D2R));
        const perigeeRadius = (a, e) => a * (1 - e);
        const apogeeRadius = (a, e) => a * (1 + e);
        const semiMinorAxis = (a, e) => a * Math.sqrt(1 - e * e);

        // Vis-viva and circular speed, km/s
        const orbitSpeed = (r, a) => Math.sqrt(MU * (2 / r - 1 / a));
        const circularSpeed = (r) => Math.sqrt(MU / r);

        // Position in the orbit plane: x toward perigee, y toward nu = 90 deg.
        function positionAt(a, e, nu) {
            const r = radiusAt(a, e, nu);
            return { x: r * Math.cos(nu * D2R), y: r * Math.sin(nu * D2R) };
        }

        // The same ellipse from eccentric anomaly E (rad). Even steps in E give a smooth curve.
        function positionAtEccentric(a, e, E) {
            return { x: a * (Math.cos(E) - e), y: semiMinorAxis(a, e) * Math.sin(E) };
        }

        function orbitValues(a, e, nu) {
            const r = radiusAt(a, e, nu);
            return {
                r,
                rp: perigeeRadius(a, e),
                ra: apogeeRadius(a, e),
                v: orbitSpeed(r, a),
                vc: circularSpeed(r)
            };
        }

        // Mean motion, rad/s.
        const meanMotion = (a) => Math.sqrt(MU / a ** 3);
        return { MU, R_E, D2R, TWO_PI, wrap360, radiusAt, perigeeRadius, apogeeRadius, semiMinorAxis, circularSpeed, positionAt, positionAtEccentric, orbitValues, meanMotion };
    })(C, OC, S.kepler);

    /* Specific mechanical energy (Mechanical Energy Explorer) ------------------------------------- */
    S.energy = (function (C, OC, K) {
        const MU = C.mu;           // km^3/s^2
        const RE = C.re;           // km
        const D2R = Math.PI / 180;
        const TWO_PI = 2 * Math.PI;

        const wrap = (angle) => ((angle % TWO_PI) + TWO_PI) % TWO_PI;

        // The orbit set by perigee and apogee altitudes (km).
        function orbitFromAltitudes(hp, ha) {
            const Rp = RE + hp;
            const Ra = RE + ha;
            const a = (Ra + Rp) / 2;
            const e = (Ra - Rp) / (Ra + Rp);
            const p = a * (1 - e * e);                       // semi-latus rectum
            const eps = -MU / (2 * a);                       // specific mechanical energy
            const period = TWO_PI * Math.sqrt(a * a * a / MU);
            const speedAt = (R) => Math.sqrt(Math.max(0, 2 * (MU / R + eps)));   // energy equation
            return { Rp, Ra, a, e, p, eps, period, Vp: speedAt(Rp), Va: speedAt(Ra), speedAt };
        }

        // Kepler's equation, M = E - e sin E, solved for E (shared solver).
        const eccentricAnomaly = K.solve;

        function trueFromMean(M, e) {
            const E = eccentricAnomaly(M, e);
            return wrap(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(Math.max(1e-12, 1 - e)) * Math.cos(E / 2)));
        }

        function meanFromTrue(nu, e) {
            const E = 2 * Math.atan2(Math.sqrt(Math.max(1e-12, 1 - e)) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
            return wrap(E - e * Math.sin(E));
        }

        // Point on the ellipse from eccentric anomaly E, perigee along +x. Even steps in E draw a smooth curve.
        function ellipsePoint(o, E) {
            return { x: o.a * (Math.cos(E) - o.e), y: o.a * Math.sqrt(Math.max(0, 1 - o.e * o.e)) * Math.sin(E) };
        }

        // State at true anomaly nu, in the orbit plane with perigee along +x.
        // Velocity components: v = sqrt(mu/p) [-sin nu, e + cos nu].
        function pointAt(o, nu) {
            const R = o.p / (1 + o.e * Math.cos(nu));
            const vScale = Math.sqrt(MU / Math.max(1e-6, o.p));
            const V = o.speedAt(R);
            return {
                nu, R, V,
                x: R * Math.cos(nu),
                y: R * Math.sin(nu),
                vx: -vScale * Math.sin(nu),
                vy: vScale * (o.e + Math.cos(nu)),
                ke: V * V / 2,      // specific kinetic energy
                pe: -MU / R         // specific potential energy
            };
        }
        // Mean motion, rad/s; and the specific kinetic and potential energy at radius R, speed V.
        const meanMotion = (a) => Math.sqrt(MU / a ** 3);
        const energies = (R, V) => ({ ke: V * V / 2, pe: -MU / R });
        return { MU, RE, D2R, TWO_PI, wrap, orbitFromAltitudes, eccentricAnomaly, trueFromMean, meanFromTrue, ellipsePoint, pointAt, meanMotion, energies };
    })(C, OC, S.kepler);

    /* Classical orbital elements to position and velocity (Orbital Elements Explorer) ------------- */
    S.coe = (function (C, OC, K) {
        const R_E = C.re;             // km
        const MU = C.mu;              // km^3/s^2
        const OMEGA_E = C.omegaE;     // rad/s, Earth's rotation
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;

        const periodOf = (a) => TWO_PI * Math.sqrt(a * a * a / MU);
        const isEquatorial = (el) => el.i < 0.05 || el.i > 179.95;
        const isCircular = (el) => el.e < 1e-4;

        // Unit vectors in ECI: P toward perigee, Q in the plane 90 deg ahead of P,
        // W along the angular momentum, and n toward the ascending node.
        function orbitBasis(el) {
            const O = el.raan * D2R, inc = el.i * D2R, w = el.argp * D2R;
            const cosO = Math.cos(O), sinO = Math.sin(O);
            const cosi = Math.cos(inc), sini = Math.sin(inc);
            const cosw = Math.cos(w), sinw = Math.sin(w);
            return {
                P: { x: cosO * cosw - sinO * sinw * cosi, y: sinO * cosw + cosO * sinw * cosi, z: sinw * sini },
                Q: { x: -cosO * sinw - sinO * cosw * cosi, y: -sinO * sinw + cosO * cosw * cosi, z: cosw * sini },
                W: { x: sinO * sini, y: -cosO * sini, z: cosi },
                n: { x: cosO, y: sinO, z: 0 }
            };
        }

        // r = p / (1 + e cos nu), km
        const radiusAt = (el, nuDeg) => el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(nuDeg * D2R));

        // u P + v Q
        const inPlane = (basis, u, v) => ({
            x: basis.P.x * u + basis.Q.x * v,
            y: basis.P.y * u + basis.Q.y * v,
            z: basis.P.z * u + basis.Q.z * v
        });

        // ECI position (km) at true anomaly nu (deg).
        function positionAt(el, basis, nuDeg) {
            const r = radiusAt(el, nuDeg), nu = nuDeg * D2R;
            return inPlane(basis, r * Math.cos(nu), r * Math.sin(nu));
        }

        // ECI velocity (km/s): v = sqrt(mu/p) [-sin nu P + (e + cos nu) Q].
        function velocityAt(el, basis, nuDeg) {
            const p = el.a * (1 - el.e * el.e), nu = nuDeg * D2R;
            const k = Math.sqrt(MU / p);
            return inPlane(basis, -k * Math.sin(nu), k * (el.e + Math.cos(nu)));
        }

        // Everything the readouts show for one element set.
        function orbitState(el) {
            const { a, e, nu } = el;
            const basis = orbitBasis(el);
            const r = radiusAt(el, nu);
            return {
                r,
                hp: a * (1 - e) - R_E,
                ha: a * (1 + e) - R_E,
                speed: Math.sqrt(MU * (2 / r - 1 / a)),   // vis-viva
                period: periodOf(a),
                rVec: positionAt(el, basis, nu),
                vVec: velocityAt(el, basis, nu),
                // The north component of h classifies the motion.
                direction: basis.W.z > 1e-6 ? 'Prograde' : basis.W.z < -1e-6 ? 'Retrograde' : 'Polar'
            };
        }
        return { R_E, MU, OMEGA_E, D2R, R2D, TWO_PI, periodOf, isEquatorial, isCircular, orbitBasis, radiusAt, inPlane, positionAt, velocityAt, orbitState };
    })(C, OC, S.kepler);

    /* J2 nodal regression and sun-synchronous orbits (Sun-Synchronous Orbit page) ----------------- */
    S.sunSync = (function (C, OC) {
        const MU = C.mu;             // km^3/s^2
        const RE = C.re;             // km
        const J2 = C.J2;
        const YEAR_DAYS = OC.TIME.TROPICAL_YEAR_DAYS;
        const DAY_S = OC.TIME.DAY_S;
        const SUN_RATE = 2 * Math.PI / (YEAR_DAYS * DAY_S); // rad/s, mean Sun's motion in right ascension
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;

        const wrap180 = (deg) => ((deg % 360) + 540) % 360 - 180;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        const wrap12 = (hours) => ((hours % 24) + 36) % 24 - 12;

        // RAAN rate: dOmega/dt = -(3/2) J2 n (RE/a)^2 cos i, for e = 0.
        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
        const j2Factor = (a) => 1.5 * J2 * meanMotion(a) * (RE / a) * (RE / a);
        const nodalRate = (a, inc) => -j2Factor(a) * Math.cos(inc);

        // Sun-synchronous: set dOmega/dt equal to the Sun's rate and solve for cos i.
        const sunSyncCos = (a) => -SUN_RATE / j2Factor(a);
        const sunSyncInclination = (a) => Math.acos(sunSyncCos(a));

        // Angles after a number of days, in degrees.
        const sunRightAscension = (days) => days * DAY_S * SUN_RATE * R2D;
        const raanAfter = (raan0Deg, a, inc, days) => raan0Deg + nodalRate(a, inc) * days * DAY_S * R2D;

        // Local time at the node: 12:00 when the node points at the Sun, 15 deg per hour.
        const nodeLocalTime = (raanDeg, sunDeg) => 12 + wrap180(raanDeg - sunDeg) / 15;
        const raanForNodeTime = (hours, sunDeg) => sunDeg + (hours - 12) * 15;

        // Position on a circular orbit of the given radius at argument of latitude u (deg).
        function circularOrbitPosition(radius, raanDeg, inc, uDeg) {
            const raan = raanDeg * D2R, u = uDeg * D2R;
            const ci = Math.cos(inc), si = Math.sin(inc);
            const co = Math.cos(raan), so = Math.sin(raan);
            const cu = Math.cos(u), su = Math.sin(u);
            return {
                x: radius * (co * cu - so * su * ci),
                y: radius * (so * cu + co * su * ci),
                z: radius * su * si
            };
        }
        return { MU, RE, J2, YEAR_DAYS, DAY_S, SUN_RATE, D2R, R2D, wrap180, wrap360, wrap12, meanMotion, j2Factor, nodalRate, sunSyncCos, sunSyncInclination, sunRightAscension, raanAfter, nodeLocalTime, raanForNodeTime, circularOrbitPosition };
    })(C, OC);

    /* Ground tracks over a turning Earth (Ground Track page) -------------------------------------- */
    S.groundTrack = (function (C, OC, K) {
        const R_E = C.re;             // km
        const MU = C.mu;              // km^3/s^2
        const OMEGA_E = C.omegaE;     // rad/s
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;
        const EARTH_DEG_PER_HOUR = OMEGA_E * R2D * 3600;
        const CIRCULAR_E = 0.02;      // Below this, an orbit counts as circular: no perigee or apogee

        const POINTS_PER_ORBIT = 240; // Track samples per orbit
        const MAX_PAST_ORBITS = 16;   // About one day of a low orbit
        const TRACK_POINTS = (MAX_PAST_ORBITS + 1) * POINTS_PER_ORBIT + 1;
        const MARKER_MAX = MAX_PAST_ORBITS + 2; // Perigee (or apogee, or node) passes in one track

        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
        const periodOf = (a) => TWO_PI / meanMotion(a);
        const isCircular = (el) => el.e < CIRCULAR_E;
        const isEquatorial = (el) => el.i < 0.05 || el.i > 179.95;

        // Perifocal unit vectors in ECI: P toward perigee, Q 90 deg ahead of P in the orbit plane.
        function orbitBasis(el) {
            const O = el.raan * D2R, inc = el.i * D2R, w = el.argp * D2R;
            const cosO = Math.cos(O), sinO = Math.sin(O);
            const cosi = Math.cos(inc), sini = Math.sin(inc);
            const cosw = Math.cos(w), sinw = Math.sin(w);
            return {
                P: { x: cosO * cosw - sinO * sinw * cosi, y: sinO * cosw + cosO * sinw * cosi, z: sinw * sini },
                Q: { x: -cosO * sinw - sinO * cosw * cosi, y: -sinO * sinw + cosO * cosw * cosi, z: cosw * sini }
            };
        }

        // r = p / (1 + e cos nu), km
        const radiusAt = (el, nuDeg) => el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(nuDeg * D2R));

        // ECI position (km) at true anomaly nu (deg).
        function positionAt(el, basis, nuDeg) {
            const r = radiusAt(el, nuDeg), nu = nuDeg * D2R;
            const px = r * Math.cos(nu), py = r * Math.sin(nu);
            const { P, Q } = basis;
            return { x: P.x * px + Q.x * py, y: P.y * px + Q.y * py, z: P.z * px + Q.z * py };
        }

        // The ascending node is at nu = -argp, the descending node at nu = 180 - argp.
        const nodeRadii = (el) => ({ ascending: radiusAt(el, -el.argp), descending: radiusAt(el, 180 - el.argp) });

        function eccentricAnomaly(nuDeg, e) {
            const nu = nuDeg * D2R;
            return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
        }

        function meanAnomaly(nuDeg, e) {
            const E = eccentricAnomaly(nuDeg, e);
            return E - e * Math.sin(E);
        }

        // Time (s) to move from nu0 to nu1 the shorter way around; negative when nu1 is behind.
        function shortestTimeBetween(el, nu0Deg, nu1Deg) {
            let dM = (meanAnomaly(nu1Deg, el.e) - meanAnomaly(nu0Deg, el.e)) % TWO_PI;
            if (dM > Math.PI) dM -= TWO_PI;
            if (dM < -Math.PI) dM += TWO_PI;
            return dM / meanMotion(el.a);
        }

        // Earth's rotation (rad) during a time span (s).
        const earthTurn = (seconds) => OMEGA_E * seconds;

        // The most recent ascending node at or before the satellite: its eccentric anomaly, and the
        // time (s) since the satellite passed it.
        function lastAscendingNode(el) {
            const { e } = el;
            const E0 = eccentricAnomaly(el.nu, e);
            const behind = (((E0 - eccentricAnomaly(-el.argp, e)) % TWO_PI) + TWO_PI) % TWO_PI;
            const start = E0 - behind;
            const elapsed = (behind + e * (Math.sin(start) - Math.sin(E0))) / meanMotion(el.a);
            return { start, elapsed };
        }

        // Unit vector, in Earth-fixed axes, toward the point below the satellite at eccentric anomaly E.
        // theta is Earth's rotation angle when the satellite is at mean anomaly M0. Written into out[3k..3k+2].
        function subSatellitePoint(el, basis, M0, theta, E, out, k) {
            const { a, e } = el;
            const { P, Q } = basis;
            const elapsed = (E - e * Math.sin(E) - M0) / meanMotion(a);
            const turned = theta + earthTurn(elapsed);
            const cosT = Math.cos(turned), sinT = Math.sin(turned);
            const r = a * (1 - e * Math.cos(E));
            const px = a * (Math.cos(E) - e), py = a * Math.sqrt(1 - e * e) * Math.sin(E);
            const x = P.x * px + Q.x * py, y = P.y * px + Q.y * py, z = P.z * px + Q.z * py;
            out[3 * k] = (cosT * x + sinT * y) / r;
            out[3 * k + 1] = (-sinT * x + cosT * y) / r;
            out[3 * k + 2] = z / r;
        }

        // The ground track from `pastOrbits` orbits back to one orbit ahead, or, in onePeriod mode,
        // from the last ascending node to the next. Samples are even in E, so they bunch near perigee
        // without a Kepler solve per sample. Fills out.track and the pass lists in `out`
        // (perigees, apogees, ascents, descents). Returns the sample index of the satellite, the last
        // sample index, and the time since the last ascending node (onePeriod mode only, else null).
        function computeGroundTrack(el, theta, pastOrbits, onePeriod, out) {
            const { e } = el;
            const basis = orbitBasis(el);
            const E0 = eccentricAnomaly(el.nu, e);
            const M0 = E0 - e * Math.sin(E0);

            let start = E0 - pastOrbits * TWO_PI;
            let end = E0 + TWO_PI;
            let periodElapsed = null;
            if (onePeriod) {
                const node = lastAscendingNode(el);
                start = node.start;
                end = start + TWO_PI;
                periodElapsed = node.elapsed;
            }

            // The satellite is always a sample, and the two ends land exactly on the window's ends.
            const step = TWO_PI / POINTS_PER_ORBIT;
            const now = Math.ceil((E0 - start) / step - 1e-9);
            const last = now + Math.ceil((end - E0) / step - 1e-9);
            for (let k = 0; k <= last; k++) {
                const E = k === 0 ? start : k === last ? end : E0 + (k - now) * step;
                subSatellitePoint(el, basis, M0, theta, E, out.track, k);
            }

            // Every pass of a fixed point on the orbit (fixed E) inside the window. The first
            // `past` of them are behind the satellite.
            const collect = (set, phase, includeEnd = false) => {
                const stop = includeEnd ? end + 1e-9 : end - 1e-9;
                set.count = set.past = 0;
                for (let m = Math.ceil((start - phase) / TWO_PI - 1e-9); phase + m * TWO_PI < stop; m++) {
                    const E = phase + m * TWO_PI;
                    subSatellitePoint(el, basis, M0, theta, E, set.points, set.count);
                    set.count++;
                    if (E <= E0) set.past = set.count;
                }
            };
            collect(out.perigees, 0);
            collect(out.apogees, Math.PI);
            collect(out.ascents, eccentricAnomaly(-el.argp, e), onePeriod);
            collect(out.descents, eccentricAnomaly(180 - el.argp, e));

            return { trackNow: now, trackEnd: last, periodElapsed };
        }

        // Longitude and latitude (deg) of sample k of a list of Earth-fixed unit vectors.
        const longitudeOf = (points, k) => Math.atan2(points[3 * k + 1], points[3 * k]) * R2D;
        const latitudeOf = (points, k) => Math.asin(Math.max(-1, Math.min(1, points[3 * k + 2]))) * R2D;
        const wrapLongitude = (lon) => (((lon + 180) % 360) + 360) % 360 - 180;
        return { R_E, MU, OMEGA_E, D2R, R2D, TWO_PI, EARTH_DEG_PER_HOUR, CIRCULAR_E, POINTS_PER_ORBIT, MAX_PAST_ORBITS, TRACK_POINTS, MARKER_MAX, meanMotion, periodOf, isCircular, isEquatorial, orbitBasis, radiusAt, positionAt, nodeRadii, eccentricAnomaly, meanAnomaly, shortestTimeBetween, earthTurn, lastAscendingNode, subSatellitePoint, computeGroundTrack, longitudeOf, latitudeOf, wrapLongitude };
    })(C, OC, S.kepler);

    /* Solar and sidereal days (Solar vs. Sidereal Day page) --------------------------------------- */
    S.earthRotation = (function (C, OC) {
        const D2R = Math.PI / 180;

        const SOLAR_DAY = OC.TIME.DAY_S;             // average solar day, s
        const TROPICAL_YEAR = OC.TIME.TROPICAL_YEAR_DAYS * SOLAR_DAY;  // s
        const REAL_ORBIT_RATE = 360 / TROPICAL_YEAR; // degrees per second, Earth around the Sun

        // In one solar day Earth spins 360 deg plus the angle it moved along its orbit.
        const SIDEREAL_DAY = 360 / (360 / SOLAR_DAY + REAL_ORBIT_RATE); // s
        const SPIN_RATE = 360 / SIDEREAL_DAY;        // degrees per second

        // Spin needed for the Sun to return to the same place in the sky.
        const SOLAR_DAY_ROTATION = 360 * SPIN_RATE / (SPIN_RATE - REAL_ORBIT_RATE); // deg
        const EXTRA_ROTATION_PER_DAY = SOLAR_DAY_ROTATION - 360;                     // deg

        const timeForRotation = (deg) => deg / SPIN_RATE;                  // s
        const orbitTravelDuring = (seconds) => REAL_ORBIT_RATE * seconds;  // deg
        return { D2R, SOLAR_DAY, TROPICAL_YEAR, REAL_ORBIT_RATE, SIDEREAL_DAY, SPIN_RATE, SOLAR_DAY_ROTATION, EXTRA_ROTATION_PER_DAY, timeForRotation, orbitTravelDuring };
    })(C, OC);

    /* Impulsive maneuvers: Hohmann, plane changes, combined (Orbital Maneuvers) ------------------- */
    S.maneuver = (function (C, OC) {
        const MU = C.mu;            // Earth gravitational parameter (km^3/s^2)
        const R_EARTH = C.re;       // Earth equatorial radius (km)
        const D2R = Math.PI / 180;

        // Hohmann transfer between circular orbits of radii R1 and R2.
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

        // Simple inclination change at a node of a circular orbit at altitude alt.
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

        // RAAN change of a polar circular orbit, made over a pole.
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

        // Hohmann transfer with the plane change in the burn at the higher orbit.
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

        // Pure plane change at speed v through angle theta: dV = 2 v sin(theta/2).
        const planeChangeDv = (v, thetaDeg) => 2 * v * Math.sin(thetaDeg * D2R / 2);

        // Speed change and plane change in one burn (law of cosines).
        const combinedBurnDv = (vBefore, vAfter, thetaDeg) =>
            Math.sqrt(vBefore * vBefore + vAfter * vAfter - 2 * vBefore * vAfter * Math.cos(thetaDeg * D2R));

        // A combined Hohmann transfer and plane change, with the plane turned at the higher orbit
        // (the solver's default), at the lower orbit, or as a separate burn at the higher orbit.
        function solveCombinedOptions(R1, R2, i1, i2, location) {
            const base = solveCombined(R1, R2, i1, i2);
            const { isRaise, v1, v_tx1, v_tx2, v2, delta_theta } = base;

            // Plane turned with the burn at the lower orbit.
            const dv1_lower = isRaise ? combinedBurnDv(v1, v_tx1, delta_theta) : Math.abs(v_tx1 - v1);
            const dv2_lower = isRaise ? Math.abs(v2 - v_tx2) : combinedBurnDv(v_tx2, v2, delta_theta);
            const dv_total_lower = dv1_lower + dv2_lower;

            // Hohmann plus a separate pure plane change at the higher orbit.
            const dv_total_separate = base.dv_separate + (isRaise ? base.dv1 : base.dv2);

            let dv1 = base.dv1, dv2 = base.dv2, dv_total = base.dv_total;
            if (location === 'lower') {
                dv1 = dv1_lower;
                dv2 = dv2_lower;
                dv_total = dv_total_lower;
            } else if (location === 'separate') {
                dv_total = dv_total_separate;
            }

            return {
                ...base,
                planeChangeLocation: location,
                dv1,
                dv2,
                dv_total,
                dv_higher_total: base.dv_total,
                dv_lower_total: dv_total_lower,
                dv_separate_total: dv_total_separate,
                dv1_lower,
                dv2_lower
            };
        }

        // The solved maneuver for one maneuver type and its input values.
        function solveManeuver(type, vals) {
            if (type === 'hohmann') {
                return { ...solveHohmann(vals.R1, vals.R2), type };
            }
            if (type === 'inclination') {
                const res = solveInclinationChange(vals.r - R_EARTH, vals.i1, vals.i2, vals.raan, vals.u_sc);
                return { ...res, type, r: vals.r };
            }
            if (type === 'polar_raan') {
                const res = solvePolarRaanChange(vals.r - R_EARTH, vals.raan1, vals.raan2, vals.u_sc);
                return { ...res, type, r: vals.r, i: 90 };
            }
            if (type === 'combined') {
                return { ...solveCombinedOptions(vals.R1, vals.R2, vals.i1, vals.i2, vals.location), type };
            }
            return null;
        }
        return { MU, R_EARTH, D2R, solveHohmann, solveInclinationChange, solvePolarRaanChange, solveCombined, planeChangeDv, combinedBurnDv, solveCombinedOptions, solveManeuver };
    })(C, OC);

    /* Orbit and transfer geometry for the maneuver scene ------------------------------------------ */
    S.maneuverGeometry = (function (C, OC) {
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;

        // Position on an orbit of radius r in the plane (inc, raan), at argument of latitude u.
        function orbitPosition(r, inc, raan, u) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return {
                x: r * (Math.cos(o) * Math.cos(a) - Math.sin(o) * Math.sin(a) * Math.cos(i)),
                y: r * (Math.sin(o) * Math.cos(a) + Math.cos(o) * Math.sin(a) * Math.cos(i)),
                z: r * Math.sin(a) * Math.sin(i)
            };
        }

        // Unit vector along the direction of motion there (d position / du).
        function orbitDirection(inc, raan, u) {
            const i = inc * D2R, o = raan * D2R, a = u * D2R;
            return {
                x: -Math.cos(o) * Math.sin(a) - Math.sin(o) * Math.cos(a) * Math.cos(i),
                y: -Math.sin(o) * Math.sin(a) + Math.cos(o) * Math.cos(a) * Math.cos(i),
                z: Math.cos(a) * Math.sin(i)
            };
        }

        // Unit normal of the plane (direction of the angular momentum).
        const orbitNormal = (inc, raan) => ({
            x: Math.sin(raan * D2R) * Math.sin(inc * D2R),
            y: -Math.cos(raan * D2R) * Math.sin(inc * D2R),
            z: Math.cos(inc * D2R)
        });

        // Hohmann transfer between radii R1 and R2. eSigned < 0 when lowering, so that u = 0 is
        // always the start at R1 and u = 180 the end at R2.
        function transferEllipse(R1, R2) {
            const a = (R1 + R2) / 2;
            const eSigned = (R2 - R1) / (R1 + R2);
            const p = a * (1 - eSigned * eSigned);
            return { a, eSigned, p, radiusAt: (u) => p / (1 + eSigned * Math.cos(u * D2R)) };
        }

        // Angle u flown on the transfer after the share t (0 to 1) of its flight time,
        // from Kepler's equation M = E - e sin E. The spacecraft is fastest near perigee.
        function transferU(t, eSigned) {
            if (t <= 0) return 0;
            if (t >= 1) return 180;
            const e = Math.abs(eSigned), raise = eSigned >= 0;
            const M = Math.PI * (raise ? t : 1 + t);
            let E = M;
            for (let k = 0; k < 12; k++) {
                const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
                E -= step;
                if (Math.abs(step) < 1e-10) break;
            }
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return ((nu * R2D + 360) % 360) - (raise ? 0 : 180);
        }

        // Pure plane change at speed v through angle theta: dV = 2 v sin(theta/2).
        const planeChangeDv = (v, thetaDeg) => 2 * v * Math.sin(thetaDeg * D2R / 2);
        return { D2R, R2D, orbitPosition, orbitDirection, orbitNormal, transferEllipse, transferU, planeChangeDv };
    })(C, OC);

    /* Rendezvous plans for the Inertial Rendezvous page ------------------------------------------- */
    S.rendezvousPlan = (function (C, OC, RM) {
        const MU = C.mu;
        const R_EARTH = C.re;
        const MIN_ALT = OC.LIMITS.minSafeAltitude;
        const R2D = 180 / Math.PI;

        // The lesson's worked examples use these rounded constants
        const LESSON_MU = OC.LESSON.rendezvousExample.mu;
        const LESSON_R_EARTH = OC.LESSON.rendezvousExample.re;

        function solveRendezvous(mode, vals, useLessonConstants) {
            const mu = useLessonConstants ? LESSON_MU : MU;
            const rEarth = useLessonConstants ? LESSON_R_EARTH : R_EARTH;
            if (mode === 'coplanar') return RM.solveCoplanar({ ...vals, mu, rEarth });
            if (mode === 'coorbital') return RM.solveCoOrbital({ ...vals, mu, rEarth });
            return null;
        }
        return { MU, R_EARTH, MIN_ALT, R2D, LESSON_MU, LESSON_R_EARTH, solveRendezvous };
    })(C, OC, S.rendezvous);

    /* Coplanar path geometry for the rendezvous scene --------------------------------------------- */
    S.rendezvousGeometry = (function (C, OC) {
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;

        const circularPeriod = (r, mu) => TWO_PI * Math.sqrt(r * r * r / mu);
        const conicRadius = (a, e, nu) => a * (1 - e * e) / (1 + e * Math.cos(nu));
        const pointAtAngle = (r, angle) => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });

        // Coplanar: the chase waits WT on its circle, then departs.
        const departureAngle = (m) => m.n_chase * m.WT;
        const targetAngleAtDeparture = (m) => -m.phi0_rad + m.n_target * m.WT;

        // Coplanar Hohmann transfer, `sweep` rad past the departure point. Departure is perigee
        // when raising and apogee when lowering.
        function transferPoint(m, sweep) {
            const Rc = m.Rchase, Rt = m.Rtarget;
            const e = Math.abs(Rc - Rt) / (Rc + Rt);
            const nuDep = Rc <= Rt ? 0 : Math.PI;
            return pointAtAngle(conicRadius(m.a_transfer, e, nuDep + sweep), departureAngle(m) + sweep);
        }

        // Co-orbital phasing orbit at angle theta from the burn point, which is its apogee when
        // the chase is behind and its perigee when it is ahead.
        function phasingPoint(m, theta) {
            const e = Math.abs(m.a_phasing - m.Rchase) / m.a_phasing;
            return pointAtAngle(conicRadius(m.a_phasing, e, m.isBehind ? theta + Math.PI : theta), theta);
        }
        return { D2R, R2D, TWO_PI, circularPeriod, conicRadius, pointAtAngle, departureAngle, targetAngleAtDeparture, transferPoint, phasingPoint };
    })(C, OC);

    /* Burn plans with CW coasts (RIC Burn Sandbox) ------------------------------------------------ */
    S.burns = (function (C, OC, M) {

        // Chase's state at t = 0: at rest at the target, on a perch 10 km behind, or on an NMC
        // with C = 5 km starting at the given corner (M0).
        function initialState(start, corner, n) {
            if (start === 'perch') return [0, -10, 0, 0, 0, 0];
            if (start === 'nmc') return M.stateFromRmoe({ xc: 0, yc0: 0, C: 5, M0: corner, zmax: 0, dM0: null }, n, 0);
            return [0, 0, 0, 0, 0, 0];
        }

        // State at time t: the CW coast from the last burn at or before t. Each burn is
        // { t, after } with `after` the state just after it.
        function chaseStateAt(t, start, corner, burns, n) {
            let base = initialState(start, corner, n), tb = 0;
            for (const b of burns) { if (b.t <= t + 1e-9) { base = b.after; tb = b.t; } }
            return M.cwPropagate(base, n, t - tb);
        }

        // Time to coast until the next corner (M = stop) or, for stop = 'pc', the next plane
        // crossing (dM = 0 or 180). null when that angle is undefined. Never less than a sliver.
        function timeToCoastStop(rmoe, stop, n) {
            const P = 2 * Math.PI / n;
            const next = (now, ang) => { let dt = M.timeToAngle(now, ang, n); if (dt < 1e-4 * P) dt += P; return dt; };
            if (stop === 'pc') return rmoe.dM0 === null ? null : Math.min(next(rmoe.dM0, 0), next(rmoe.dM0, 180));
            return rmoe.M0 === null ? null : next(rmoe.M0, Number(stop));
        }

        // Positions along a CW coast from s0 for time T, count + 1 samples, pushed onto out.
        function coastPath(s0, n, T, count, out) {
            for (let k = 0; k <= count; k++) { const s = M.cwPropagate(s0, n, T * k / count); out.push([s[0], s[1], s[2]]); }
            return out;
        }

        // Natural motion: an NMC with C = 5 km, entered from a perch 10 km behind with one
        // radial burn, dV = -(n/2) dy_C.
        function naturalNmc(n) {
            const rmoe = { xc: 0, yc0: 0, C: 5, M0: 270, zmax: 0, dM0: null };
            return {
                path: coastPath(M.stateFromRmoe(rmoe, n, 0), n, 2 * Math.PI / n, 120, []),
                from: [0, -10, 0],
                dv: [M.rule.recenter(n, 10), 0, 0]
            };
        }

        // Forced motion: a circle of the given radius in the R-I plane, flown as `count` CW legs
        // between waypoints, one lap in lapTime. Each burn turns the arrival velocity into the
        // next leg's departure velocity.
        function forcedCircle(n, radius, count, lapTime) {
            const Tc = lapTime / count, pts = [];
            for (let k = 0; k < count; k++) { const f = 2 * Math.PI * k / count; pts.push([-radius * Math.cos(f), radius * Math.sin(f), 0]); }
            const path = [], burns = [];
            let lapDv = 0;
            for (let k = 0; k < count; k++) {
                const prev = pts[(k + count - 1) % count], cur = pts[k], next = pts[(k + 1) % count];
                const vin = M.transferVelocity(prev, cur, n, Tc);
                const arrive = M.cwPropagate([...prev, ...vin], n, Tc);
                const vout = M.transferVelocity(cur, next, n, Tc);
                const dv = [vout[0] - arrive[3], vout[1] - arrive[4], vout[2] - arrive[5]];
                lapDv += Math.hypot(dv[0], dv[1], dv[2]);
                burns.push({ at: cur, dv });
                coastPath([...cur, ...vout], n, Tc, 20, path);
            }
            return { path, burns, lapDv };
        }

        // Forced motion: a teardrop hold at r0, back at r0 after each cycle by one burn there.
        function teardropHold(n, r0, cycle) {
            const v0 = M.transferVelocity(r0, r0, n, cycle);
            const end = M.cwPropagate([...r0, ...v0], n, cycle);
            const dv = [v0[0] - end[3], v0[1] - end[4], v0[2] - end[5]];
            return { path: coastPath([...r0, ...v0], n, cycle, 90, []), dv, cost: Math.hypot(dv[0], dv[1], dv[2]) };
        }
        return { initialState, chaseStateAt, timeToCoastStop, coastPath, naturalNmc, forcedCircle, teardropHold };
    })(C, OC, S.rpo);
        return S;
    }

    // One built copy per constant set.
    const cache = new Map();
    function bind(constants) {
        const key = JSON.stringify({ ...OC.SETS.course, ...constants });
        if (!cache.has(key)) cache.set(key, build(constants));
        return cache.get(key);
    }

    const SECTION_NAMES = ['vec', 'kepler', 'time', 'perturbation', 'forces', 'cowell', 'rendezvous', 'elements', 'propagate', 'frames', 'rpo',
        'orbit', 'energy', 'coe', 'sunSync', 'groundTrack', 'earthRotation', 'maneuver', 'maneuverGeometry',
        'rendezvousPlan', 'rendezvousGeometry', 'burns'];
    const OrbitMath = { OC, LOAD_TIME_MS, SECTION_NAMES, build, bind };

    // Points OrbitMath's sections at a constant set: an id from OrbitConstants.SETS or a set object.
    function useConstants(set) {
        const C = typeof set === 'string' ? OC.SETS[set] : set;
        if (!C) throw new Error(`Unknown constant set "${set}". Choices: ${Object.keys(OC.SETS).join(', ')}`);
        const S = bind(C);
        OrbitMath.constants = S.constants;
        for (const name of SECTION_NAMES) OrbitMath[name] = S[name];
        return S;
    }
    OrbitMath.useConstants = useConstants;
    useConstants(OC.Settings.active());
    // Registered before any page's listener, so pages see the new sections when they are told.
    OC.Settings.onChange((settings, changed) => {
        if (changed.includes('constants')) useConstants(OC.Settings.active());
    });

    if (typeof module !== 'undefined' && module.exports) module.exports = OrbitMath;
    global.OrbitMath = OrbitMath;
})(typeof window !== 'undefined' ? window : globalThis);
