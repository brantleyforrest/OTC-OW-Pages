// forces.js
// The force setting's seven toggles for Cowell's method (all off by default): J2, J3 and J4, J2,2,
// atmospheric drag, the Sun, the Moon and solar radiation pressure, as accelerations in km/s^2, and
// the mean atmosphere drag uses. Constants come from math/constants.
// No DOM. Load after math/time.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('forces.js: load math/common.js first');

    /* Forces for Cowell's method, each behind a toggle -------------------------------------------- */
    OM.define('forces', ['time'], function (C, OC, T) {
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

        // Piecewise exponential mean atmosphere: [h0 km, rho0 kg/m^3, H km]. Same data as the
        // Perturbations lesson's figure. Density at altitude h km, kg/m^3.
        const DENSITY = OC.ATMOSPHERE.DENSITY;
        function density(h) {
            let row = DENSITY[0];
            for (let k = 1; k < DENSITY.length; k++) {
                if (DENSITY[k][0] <= h) row = DENSITY[k];
                else break;
            }
            return row[1] * Math.exp(-(h - row[0]) / row[2]);
        }
        // Density scale for solar activity.
        const SOLAR = OC.ATMOSPHERE.SOLAR;

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
            const rho = density(h) * SOLAR[sc.solar];                     // kg/m^3
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
            if (on.drag && !(sc.solar in SOLAR)) throw new Error(`spacecraft.solar must be one of ${Object.keys(SOLAR).join(', ')}`);
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
            FORCE_IDS, NEEDS_TIME, LOAD_TIME_MS, DEFAULT_CONSTANTS, DEFAULT_SPACECRAFT, DENSITY, density, SOLAR,
            toMs, julianDate, gmst, sunPosition, moonPosition,
            twoBody, j2Accel, j34Accel, j22Accel, dragAccel, thirdBodyAccel, inShadow, srpAccel,
            makeAcceleration, needsTime
        };
    });
})(typeof window !== 'undefined' ? window : globalThis);
