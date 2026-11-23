// test-1-practice-math.js
// Test 1 Practice's own math, written as the course teaches it: constants for the problem sections, Kepler's equation that keeps whole turns, COEs from r and v, Hohmann transfers and plane changes, ground tracks with the course 15 deg/h Earth, coplanar and co-orbital rendezvous with universal-variable Kepler, and the scene geometry.
// It joins TestReviewMath (math/practice-common.js), built from the course constants whatever the
// site's settings say, and never calls OrbitMath, so the tests can check the two against each other.
// No DOM. Load after math/practice-common.js.
(function (global) {
    'use strict';

    const TRM = global.TestReviewMath;
    if (!TRM) throw new Error('test-1-practice-math.js: load math/practice-common.js first');

    /* Constants for the problem sections ---------------------------------------------------------- */
    TRM.define('course', [], function (C, OC) {
        const MU = C.mu;                              // km^3/s^2
        const R_EARTH = C.re;                         // km
        const G0 = C.g0;                              // m/s^2
        const MIN_ALT = OC.LIMITS.minSafeAltitude;    // lowest safe perigee altitude, km
        const GEO_A = OC.LESSON.rGeo;                 // km
        // The constants as the problems print them: plain ('398,600.44') and TeX ('398{,}600.44').
        const grouped = (x, sep) => {
            const [whole, frac] = String(x).split('.');
            return whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (frac ? '.' + frac : '');
        };
        const MU_TEXT = grouped(MU, ','), MU_TEX = grouped(MU, '{,}');
        const RE_TEXT = grouped(R_EARTH, ','), RE_TEX = grouped(R_EARTH, '{,}');
        // Mean motion, rad/s.
        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
        return { MU, R_EARTH, G0, MIN_ALT, GEO_A, MU_TEXT, MU_TEX, RE_TEXT, RE_TEX, meanMotion };
    });

    /* Kepler's equation that keeps whole turns (practice scenes) ---------------------------------- */
    TRM.define('motion', [], function (C, OC) {
        const TWO_PI = 2 * Math.PI;

        // Kepler's equation, for an ellipse with eccentricity e. Both keep track of whole turns, so
        // that the angle keeps growing as the satellite goes around again.
        function trueFromMean(M, e) {
            const turns = Math.round(M / TWO_PI);
            const Mr = M - turns * TWO_PI;
            let E = e < 0.8 ? Mr : Math.PI * Math.sign(Mr || 1);
            for (let k = 0; k < 30; k++) {
                const step = (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
                E -= step;
                if (Math.abs(step) < 1e-12) break;
            }
            const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
            return nu + turns * TWO_PI;
        }

        function meanFromTrue(nu, e) {
            const turns = Math.round(nu / TWO_PI);
            const nr = nu - turns * TWO_PI;
            const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nr / 2), Math.sqrt(1 + e) * Math.cos(nr / 2));
            return E - e * Math.sin(E) + turns * TWO_PI;
        }
        return { TWO_PI, trueFromMean, meanFromTrue };
    });

    /* COEs from r and v (R-V to COEs) ------------------------------------------------------------- */
    TRM.define('rvCoe', [], function (C, OC) {
        const MU = C.mu;            // Earth's gravitational parameter (km^3/s^2)
        const R_EARTH = C.re;       // Earth's equatorial radius (km)
        const R2D = 180 / Math.PI;

        // A circular problem's speed is rounded to three decimals, which leaves a tiny eccentricity.
        // Anything below this counts as circular. Elliptical problems never come close to it.
        const CIRCULAR_E = 0.001;

        const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
        const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
        const length = (p) => Math.sqrt(dot(p, p));
        const arccos = (x) => Math.acos(Math.max(-1, Math.min(1, x))) * R2D;
        const wrap360 = (x) => ((x % 360) + 360) % 360;

        // Classical elements from r and v (km, km/s), as the course teaches it: a from energy, e from the
        // eccentricity vector, i, RAAN, argp and nu from h, n and e. An undefined angle is taken as 0.
        function solve(r, v) {
            const R = length(r), V = length(v);
            const rDotV = dot(r, v);
            const energy = V * V / 2 - MU / R;
            const aRaw = -MU / (2 * energy);

            const h = cross(r, v), H = length(h);
            const i = arccos(h[2] / H);

            const n = [-h[1], h[0], 0], N = length(n);
            const equatorial = N < 1e-6 * H;

            const bracket = V * V - MU / R;
            const eVec = r.map((c, k) => (bracket * c - rDotV * v[k]) / MU);
            const eMag = length(eVec);
            const circular = eMag < CIRCULAR_E;

            const vCirc = Math.sqrt(MU / R);
            const apsis = circular ? 'circular' : (V > vCirc ? 'perigee' : 'apogee');

            const raanFlat = equatorial ? 0 : arccos(n[0] / N);
            const raanRaw = n[1] < 0 ? 360 - raanFlat : raanFlat;

            // An undefined angle is taken as 0°, and every angle measured from it is still defined.
            // With no node (equatorial), the node direction is +I. With no perigee (circular), the
            // perigee direction is the node direction. Angles are measured in the direction of travel.
            const hHat = h.map((c) => c / H);
            const nodeHat = equatorial ? [1, 0, 0] : n.map((c) => c / N);
            const perigeeHat = circular ? nodeHat : eVec.map((c) => c / eMag);
            const angleAround = (from, to) => {
                const raw = Math.atan2(dot(hHat, cross(from, to)), dot(from, to)) * R2D;
                return wrap360(Math.round(raw * 1e6) / 1e6);
            };
            const argpRaw = circular ? 0 : angleAround(nodeHat, perigeeHat);
            const nuRaw = angleAround(perigeeHat, r.map((c) => c / R));

            const raanUndefined = equatorial;
            const argpUndefined = circular;
            const nuUndefined = false;

            // A circular orbit's radius is exact. The energy result differs from it only because the
            // given speed is rounded.
            const a = circular ? R : aRaw;


            return {
                r, v, R, V, rDotV, energy, a, aRaw, h, H, i, n, N, eVec, eMag, vCirc, apsis, circular, equatorial,
                raan: raanRaw, argp: argpRaw, nu: nuRaw, raanRaw, argpRaw, nuRaw, raanUndefined, argpUndefined, nuUndefined
            };
        }
        // For building problems: the circular speed at R, the speed at perigee or apogee R of an
        // ellipse of eccentricity e, and 1/a from the energy equation (vis-viva).
        const circularSpeed = (R) => Math.sqrt(MU / R);
        const apsisSpeed = (kind, R, e) => Math.sqrt(MU * (kind === 'perigee' ? 1 + e : 1 - e) / R);
        const inverseA = (R, V) => 2 / R - V * V / MU;
        return { MU, R_EARTH, R2D, CIRCULAR_E, dot, cross, length, arccos, wrap360, solve, circularSpeed, apsisSpeed, inverseA };
    });

    /* Hohmann transfers and plane changes (Maneuvers) --------------------------------------------- */
    TRM.define('maneuver', [], function (C, OC) {
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

        return { MU, R_EARTH, D2R, solveHohmann, solveInclinationChange, solvePolarRaanChange, solveCombined };
    });

    /* Orbit and transfer geometry for the maneuver scene ------------------------------------------ */
    TRM.define('maneuverGeometry', ['motion'], function (C, OC, Motion) {
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
        // always the start at R1 and u = 180 the end at R2. Periods are in units of the transfer
        // time (half the transfer orbit's period), from P proportional to a^(3/2).
        function transferEllipse(R1, R2) {
            const a = (R1 + R2) / 2;
            const eSigned = (R2 - R1) / (R1 + R2);
            const p = a * (1 - eSigned * eSigned);
            return {
                a, eSigned, p,
                radiusAt: (u) => p / (1 + eSigned * Math.cos(u * D2R)),
                T1: 2 * Math.pow(R1 / a, 1.5),
                T2: 2 * Math.pow(R2 / a, 1.5)
            };
        }

        // Angle u flown on the transfer after the share t (0 to 1) of its flight time (Kepler's
        // equation, via SatelliteMotion). The spacecraft is fastest near perigee.
        function transferU(t, eSigned) {
            const e = Math.abs(eSigned), raise = eSigned > 0;
            const M = Math.PI * (raise ? t : 1 + t);
            return Motion.trueFromMean(M, e) * R2D - (raise ? 0 : 180);
        }

        return { D2R, R2D, orbitPosition, orbitDirection, orbitNormal, transferEllipse, transferU };
    });

    /* Ground tracks with the course 15 deg/h Earth (Ground Tracks) -------------------------------- */
    TRM.define('groundTrack', [], function (C, OC) {
        const MU = C.mu;
        const R_EARTH = C.re;
        const EARTH_DEG_PER_HOUR = OC.LESSON.earthDegPerHour;   // The course approximation
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        const wrap180 = (deg) => wrap360(deg + 180) - 180;

        // The eccentricity for which the satellite takes `hours` to fly from perigee to true anomaly
        // 90°, the ascending node when the argument of perigee is 270° (and, by symmetry, from the
        // node to perigee when it is 90°). The time shrinks as e grows, so bisection finds it.
        function eccentricityFor(hours, period) {
            const timeTo90 = (e) => (Math.acos(e) - e * Math.sqrt(1 - e * e)) / TWO_PI * period / 3600;
            let low = 0, high = 0.95;
            for (let k = 0; k < 60; k++) {
                const mid = (low + high) / 2;
                if (timeTo90(mid) > hours) low = mid;
                else high = mid;
            }
            return (low + high) / 2;
        }

        function solveKepler(M, e) {
            let E = e < 0.8 ? M : Math.PI;
            for (let k = 0; k < 30; k++) {
                const delta = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
                E -= delta;
                if (Math.abs(delta) < 1e-12) break;
            }
            return E;
        }

        function meanFromTrue(nuDeg, e) {
            const nu = nuDeg * D2R;
            const E = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
            return E - e * Math.sin(E);
        }

        // The point below the satellite t seconds after it crossed the first labeled ascending node,
        // at longitude lambda1. Returns latitude, longitude (east positive), and the argument of
        // latitude u, all in degrees.
        function trackPoint(m, t) {
            const M = m.M0 + m.n * t;
            const E = solveKepler(M, m.e);
            const nu = Math.atan2(Math.sqrt(1 - m.e * m.e) * Math.sin(E), Math.cos(E) - m.e) * R2D;
            const u = (nu + m.argp) * D2R;
            const inc = m.i * D2R;
            const lat = Math.asin(Math.sin(inc) * Math.sin(u)) * R2D;
            const alpha = Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u)) * R2D;
            const lon = wrap180(m.lambda1 + alpha - EARTH_DEG_PER_HOUR * t / 3600);
            return { lat, lon, u: wrap360(u * R2D) };
        }

        // The first time after `after` seconds at which the satellite's argument of latitude is u.
        function timeAtU(m, uDeg, after = 0) {
            const M = meanFromTrue(uDeg - m.argp, m.e);
            let t = (M - m.M0) / m.n;
            const period = TWO_PI / m.n;
            t -= Math.floor((t - after) / period) * period;
            if (t <= after + 1e-6) t += period;
            return t;
        }
        return { MU, R_EARTH, EARTH_DEG_PER_HOUR, D2R, R2D, TWO_PI, wrap360, wrap180, eccentricityFor, solveKepler, meanFromTrue, trackPoint, timeAtU };
    });

    /* Coplanar and co-orbital rendezvous, universal-variable Kepler (Rendezvous) ------------------ */
    TRM.define('rendezvous', ['vec'], function (C, OC, V) {
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

        function wrapPi(rad) {
            let val = (rad + Math.PI) % (2 * Math.PI);
            if (val < 0) val += 2 * Math.PI;
            return val - Math.PI;
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
        function stateAt(model, t) {
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
            solveCoplanar, solveCoOrbital, propagate, stateAt,
            wrap2Pi, wrapPi, wrap360, formatHms
        };
    });

    /* Coplanar path geometry for the rendezvous scene --------------------------------------------- */
    TRM.define('rendezvousGeometry', [], function (C, OC) {
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
    });
})(typeof window !== 'undefined' ? window : globalThis);
