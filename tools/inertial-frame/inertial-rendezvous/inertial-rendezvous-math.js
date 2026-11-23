// inertial-rendezvous-math.js
// The Inertial Rendezvous page's own math: coplanar and co-orbital rendezvous plans, and the scene geometry.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('inertial-rendezvous-math.js: load math/common.js first');

    /* Inertial rendezvous: coplanar and co-orbital plans ------------------------------------------- */
    OM.define('rendezvous', ['vec', 'keplerPropagator', 'propagate'], function (C, OC, V, KP, PR) {
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

        // Universal-variable Kepler propagation (math/propagation/kepler.js).
        const propagate = KP.universal;

        // State of both chase and target at physical time t
        // With the Cowell propagator (tool pages only), both spacecraft are stored as r and v at the
        // start and flown by OrbitMath.propagate; each burn before arrival adds its planned Δv to the
        // chase's velocity. The plan itself stays the two-body one, so the chase can miss the target.
        const flownPlans = new WeakMap();
        function cowellOn() {
            return PR.propagatorName() === 'cowell';
        }
        function flown(model) {
            let f = flownPlans.get(model);
            if (f) return f;
            const P = PR;
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
                const target = PR.stateAt(f.target, t);
                if (t >= model.arrival) return { chase: { r: target.r, v: target.v }, target: { r: target.r, v: target.v } };
                let leg = f.legs[0];
                for (const l of f.legs) if (l.t <= t) leg = l;
                const chase = PR.stateAt(leg.sat, t);
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
    });

    /* Rendezvous plans for the Inertial Rendezvous page ------------------------------------------- */
    OM.define('rendezvousPlan', ['rendezvous'], function (C, OC, RM) {
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
    });

    /* Coplanar path geometry for the rendezvous scene --------------------------------------------- */
    OM.define('rendezvousGeometry', [], function (C, OC) {
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
