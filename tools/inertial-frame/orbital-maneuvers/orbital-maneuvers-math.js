// orbital-maneuvers-math.js
// The Orbital Maneuvers page's own math: Hohmann transfers, plane changes and combined maneuvers, and the scene geometry.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('orbital-maneuvers-math.js: load math/common.js first');

    /* Impulsive maneuvers: Hohmann, plane changes, combined (Orbital Maneuvers) ------------------- */
    OM.define('maneuver', [], function (C, OC) {
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
    });

    /* Orbit and transfer geometry for the maneuver scene ------------------------------------------ */
    OM.define('maneuverGeometry', [], function (C, OC) {
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
    });
})(typeof window !== 'undefined' ? window : globalThis);
