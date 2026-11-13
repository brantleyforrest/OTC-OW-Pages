// All physics for the Perturbations Explorer (orbits/perturbations.html). No DOM and no Three.js, so every
// function can be checked in Node. Classic script, so that the page also runs from a local file.
//
// Units inside the model: km, seconds, radians, unless a name says otherwise (incDeg, tDays, and so on).
// Returned for display: rates in deg/day, accelerations in m/s^2.
//
// The constants are the lesson's ("Perturbations & Orbit Types"), so that the tool reproduces its worked
// examples to the printed digit. Do not change a formula to make a chart look better.
(function (root) {
    'use strict';

    const PI = Math.PI;
    const D2R = PI / 180;
    const R2D = 180 / PI;

    /* 1. Constants */
    const MU = 398600.44;          // km^3/s^2
    const RE = 6378.14;            // km
    const J2 = 1.08263e-3;
    const J22 = 1.8e-6;
    const LON22 = -15;             // deg east, the long axis of the equator
    const R_GEO = 42164;           // km
    const MU_MOON = 4902.8;        // km^3/s^2
    const D_MOON = 384400;         // km
    const MU_SUN = 132712440018;   // km^3/s^2
    const D_SUN = 149597870;       // km
    const P_SUN = 4.54e-6;         // N/m^2 at 1 AU
    const CD = 2.2;
    const CR = 1.3;
    const DAY_S = 86400;
    const YEAR_DAYS = 365.25;
    const GEO_TILT_PERIOD = 53;    // years
    const SUN_RATE = 2 * PI / (YEAR_DAYS * DAY_S); // rad/s
    const SSO_RATE = 0.9856;       // deg/day
    const CRITICAL_INC = [63.4349, 116.5651];
    const STABLE_LON = [75, -105];
    const UNSTABLE_LON = [-15, 165];

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

    function solveKepler(M, e) {
        let E = M + e * Math.sin(M);
        for (let k = 0; k < 8; k++) {
            const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= dE;
            if (Math.abs(dE) < 1e-12) break;
        }
        return E;
    }
    const trueFromEccentric = (E, e) => 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

    /* 3. Atmospheric drag (lesson Section 1, SOB 1) */
    // Piecewise exponential mean atmosphere: [h0 km, rho0 kg/m^3, H km]. Same data as the lesson's figure.
    const DENSITY = [
        [0, 1.225, 7.249], [25, 3.899e-2, 6.349], [30, 1.774e-2, 6.682], [40, 3.972e-3, 7.554],
        [50, 1.057e-3, 8.382], [60, 3.206e-4, 7.714], [70, 8.770e-5, 6.549], [80, 1.905e-5, 5.799],
        [90, 3.396e-6, 5.382], [100, 5.297e-7, 5.877], [110, 9.661e-8, 7.263], [120, 2.438e-8, 9.473],
        [130, 8.484e-9, 12.636], [140, 3.845e-9, 16.149], [150, 2.070e-9, 22.523], [180, 5.464e-10, 29.740],
        [200, 2.789e-10, 37.105], [250, 7.248e-11, 45.546], [300, 2.418e-11, 53.628], [350, 9.518e-12, 53.298],
        [400, 3.725e-12, 58.515], [450, 1.585e-12, 60.828], [500, 6.967e-13, 63.822], [600, 1.454e-13, 71.835],
        [700, 3.614e-14, 88.667], [800, 1.170e-14, 124.64], [900, 5.245e-15, 181.05], [1000, 3.019e-15, 268.00]
    ];
    function density(h) {
        let row = DENSITY[0];
        for (let k = 1; k < DENSITY.length; k++) {
            if (DENSITY[k][0] <= h) row = DENSITY[k];
            else break;
        }
        return row[1] * Math.exp(-(h - row[0]) / row[2]);
    }

    const SOLAR = { min: 0.4, mean: 1.0, max: 2.5 };
    const AREA = { feathered: 0.004, nominal: 0.01, windmill: 0.03 }; // A/m, m^2/kg
    const ballisticCoefficient = (areaToMass) => 1 / (CD * areaToMass); // kg/m^2

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

    const CAP_YEARS = 200;
    function decayHistory({ hp, ha, areaToMass, solar }) {
        const B = CD * areaToMass * SOLAR[solar];
        const cap = CAP_YEARS * YEAR_DAYS * DAY_S;
        let { a, e } = elementsFromAltitudes(hp, ha);
        let t = 0;
        const samples = [{ t: 0, a, e }];
        let reentered = false;
        const rates = (aa, ee) => dragRates(aa, Math.max(0, ee), B);
        for (let step = 0; step < 20000; step++) {
            if (a * (1 - e) - RE <= 100) { reentered = true; break; }
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
        if (!reentered && a * (1 - e) - RE <= 100) reentered = true;
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

    const dragRegime = (hp) => hp < 120 ? 'immediate' : hp <= 600 ? 'active' : 'low';
    const dragPhase = (e) => e > 0.05 ? 1 : 2;
    function dragHeat(a, e, nu) {
        const r = radiusAt(a, e, nu);
        const v = speedAt(a, r);
        return Math.log10(density(r - RE) * v * v);
    }

    /* 4. J2 secular drift (lesson Section 2, SOB 2) */
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

    /* 5. J2,2 longitude drift at GEO (lesson Section 2.6, SOB 3). Longitude is east-positive. */
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
    const eastWestDvPerYear = (lonDeg) => 1.715 * Math.abs(sin2(lonDeg)); // m/s/yr, the lesson's printed maximum

    /* 6. Third-body gravity (lesson Section 3.1, SOB 3) */
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
    const OBLIQUITY = 23.44 * D2R;
    const BODY_DIRECTION = [0, Math.cos(OBLIQUITY), Math.sin(OBLIQUITY)];
    function geoTilt(tYears) {
        return { incDeg: 15 * Math.sin(PI * tYears / GEO_TILT_PERIOD), nodeDeg: 90 - 180 * tYears / GEO_TILT_PERIOD };
    }
    const geoTiltRate = (tYears) => (15 * PI / GEO_TILT_PERIOD) * Math.cos(PI * tYears / GEO_TILT_PERIOD); // deg/yr
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
    const NORTH_SOUTH_DV = { moon: 36.9, sun: 14.5, total: 51.4 }; // m/s/yr, lesson's SMAD table

    /* 7. Solar radiation pressure (lesson Section 3.3, SOB 3) */
    const AREA_SRP = { dense: 0.01, arrays: 0.04, foil: 5 }; // A/m, m^2/kg
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
            srp: P_SUN * CR * 0.01,
            drag: h <= 1000 ? dragAccel(h, Math.sqrt(MU / r), 0.01, 'mean') : null
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

    root.PerturbationModel = {
        MU, RE, J2, J22, LON22, R_GEO, MU_MOON, D_MOON, MU_SUN, D_SUN, P_SUN, CD, CR, DAY_S, YEAR_DAYS,
        GEO_TILT_PERIOD, SUN_RATE, SSO_RATE, CRITICAL_INC, STABLE_LON, UNSTABLE_LON, CAP_YEARS,
        wrap180, wrap360, meanMotion, periodSeconds, elementsFromAltitudes, altitudesFromElements,
        radiusAt, speedAt, solveKepler, trueFromEccentric,
        DENSITY, density, SOLAR, AREA, ballisticCoefficient, dragAccel, dragRates, decayHistory, sampleHistory,
        dragRegime, dragPhase, dragHeat,
        j2Rates, nodeDirection, perigeeDirection, sunSyncInclination, apogeeLatitude,
        K22, tangentialAccel, longitudeAccel, driftPotential, stepLongitude, nearestStable, ellipticK,
        LIBRATION_T0_DAYS, librationPeriodDays, semiMajorOffsetKm, eastWestDvPerYear,
        thirdBodyAccel, BODY_DIRECTION, geoTilt, geoTiltRate, figureEight, NORTH_SOUTH_DV,
        AREA_SRP, srpAccel, V_GEO, srpRadius, srpEccVector, srpPerigeeDipKm,
        accelerationsAt, leadingPerturbation, leadingNonGravitational
    };
})(globalThis);
