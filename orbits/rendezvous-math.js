// rendezvous-math.js
// Pure orbital rendezvous physics and math solvers.
// Note: Noncoplanar and Gauss modes were removed from the user interface per user instruction as they are not useful for this project.
// No DOM, Three.js, or KaTeX dependencies. Works in the browser and Node.js.
(function (global) {
    'use strict';

    const MU = 398600.4418;       // Earth gravitational parameter (km^3/s^2)
    const R_EARTH = 6378.137;     // Earth equatorial radius (km)
    const MIN_ALT = 100.0;        // Minimum safe altitude (km)
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

    // Vector math helpers (3-element arrays [x, y, z])
    function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }

    function norm(a) {
        return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    }

    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }

    function scale(a, s) {
        return [a[0] * s, a[1] * s, a[2] * s];
    }

    function add(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    }

    function sub(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    }

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

    // Sample points along an orbit between true anomalies or times
    function conicPoints(r0, v0, fromT, toT, count = 100, mu = MU) {
        const pts = [];
        const dt = (toT - fromT) / Math.max(1, count - 1);
        for (let i = 0; i < count; i++) {
            const t = fromT + i * dt;
            const res = propagate(r0, v0, t, mu);
            pts.push(res.r);
        }
        return pts;
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

    /* ------------------------------------------------------------------ */
    /* 5.4 Noncoplanar Solver                                             */
    /* ------------------------------------------------------------------ */
    function solveNoncoplanar({
        Rchase,
        Rtarget,
        iChase,
        iTarget,
        uChase,
        uTarget,
        raan = 45,
        kChase = 1,
        mu = MU,
        rEarth = R_EARTH
    }) {
        const warnings = [];
        const u_chase_deg = wrap360(uChase);
        const u_target_deg = wrap360(uTarget);
        const i_chase_deg = iChase;
        const i_target_deg = iTarget;
        const raan_deg = wrap360(raan);

        const i_chase = i_chase_deg * D2R;
        const i_target = i_target_deg * D2R;
        const raan_rad = raan_deg * D2R;
        const delta_inc = Math.abs(i_target - i_chase);

        if (Math.abs(iChase - iTarget) < 1e-4) {
            warnings.push('same-plane');
        }

        const n_chase = Math.sqrt(mu / Math.pow(Rchase, 3));
        const n_target = Math.sqrt(mu / Math.pow(Rtarget, 3));

        // Step 1: Next node reached moving forward from u_chase
        const delta_u0 = (360 - u_chase_deg) % 360;
        const delta_u180 = (540 - u_chase_deg) % 360;
        let u_N, delta_u;
        if (delta_u0 <= delta_u180) {
            u_N = 0;
            delta_u = delta_u0;
        } else {
            u_N = 180;
            delta_u = delta_u180;
        }
        const t_node = (delta_u * D2R) / n_chase;

        // Step 2: Target at that time
        const u_target_node_deg = (u_target_deg + (n_target * t_node * R2D)) % 360;

        // Step 3: Hohmann transfer parameters
        const a_tx = (Rchase + Rtarget) / 2;
        const TOF = Math.PI * Math.sqrt(Math.pow(a_tx, 3) / mu);
        const nu_travel = n_target * TOF;
        const nu_travel_deg = nu_travel * R2D;

        // RZ-14: Where target must be at transfer burn so it reaches u_N + 180
        const u_req = wrap360(u_N + 180 - nu_travel_deg);

        // RZ-15: Phase gap delta
        const delta_deg = wrap360(u_req - u_target_node_deg);

        // Step 5: Phasing at the node
        let Period_phasing = 0;
        let a_phasing = Rchase;
        let k_target = 0;
        let skipPhasing = false;

        const isRaise = Rtarget >= Rchase;
        const V_chase = Math.sqrt(mu / Rchase);
        const V_target = Math.sqrt(mu / Rtarget);
        const V_tx1 = Math.sqrt(mu * (2 / Rchase - 1 / a_tx));
        const V_tx2 = Math.sqrt(mu * (2 / Rtarget - 1 / a_tx));

        if (delta_deg < 0.5 || delta_deg > 359.5) {
            skipPhasing = true;
            Period_phasing = 0;
            k_target = 0;
            a_phasing = Rchase;
        } else {
            // Find k_target (0 to 20) with lowest total dV and far apsis > rEarth + 100 km
            let best_dv = Infinity;
            let best_kt = 0;
            let best_period = 0;
            let best_a = Rchase;

            for (let kt = 0; kt <= 20; kt++) {
                const P_p = ((delta_deg + 360 * kt) * D2R) / (kChase * n_target);
                const a_p = Math.cbrt(mu * Math.pow(P_p / (2 * Math.PI), 2));
                const far_apsis = 2 * a_p - Rchase;
                if (far_apsis <= rEarth + MIN_ALT) continue;

                const V_p = Math.sqrt(mu * (2 / Rchase - 1 / a_p));
                let dv_tot;
                if (isRaise) {
                    const dv1 = Math.abs(V_p - V_chase);
                    const dv2 = Math.abs(V_tx1 - V_p);
                    const dv3 = Math.sqrt(V_tx2 * V_tx2 + V_target * V_target - 2 * V_tx2 * V_target * Math.cos(delta_inc));
                    dv_tot = dv1 + dv2 + dv3;
                } else {
                    const dv1 = Math.abs(V_p - V_chase);
                    const dv2 = Math.sqrt(V_p * V_p + V_tx1 * V_tx1 - 2 * V_p * V_tx1 * Math.cos(delta_inc));
                    const dv3 = Math.abs(V_target - V_tx2);
                    dv_tot = dv1 + dv2 + dv3;
                }

                if (dv_tot < best_dv - 1e-6 || (Math.abs(dv_tot - best_dv) <= 1e-3 && P_p < best_period)) {
                    best_dv = dv_tot;
                    best_kt = kt;
                    best_period = P_p;
                    best_a = a_p;
                }
            }

            k_target = best_kt;
            Period_phasing = best_period;
            a_phasing = best_a;
        }

        const far_apsis = 2 * a_phasing - Rchase;
        if (!skipPhasing && far_apsis <= rEarth + MIN_ALT) {
            warnings.push('perigee-low');
        }

        const V_p = Math.sqrt(mu * (2 / Rchase - 1 / a_phasing));
        let dv1, dv2, dv3, dv_total;
        if (skipPhasing) {
            if (isRaise) {
                dv1 = Math.abs(V_tx1 - V_chase);
                dv2 = Math.sqrt(V_tx2 * V_tx2 + V_target * V_target - 2 * V_tx2 * V_target * Math.cos(delta_inc));
                dv3 = 0;
            } else {
                dv1 = Math.sqrt(V_chase * V_chase + V_tx1 * V_tx1 - 2 * V_chase * V_tx1 * Math.cos(delta_inc));
                dv2 = Math.abs(V_target - V_tx2);
                dv3 = 0;
            }
            dv_total = dv1 + dv2;
        } else {
            if (isRaise) {
                dv1 = Math.abs(V_p - V_chase);
                dv2 = Math.abs(V_tx1 - V_p);
                dv3 = Math.sqrt(V_tx2 * V_tx2 + V_target * V_target - 2 * V_tx2 * V_target * Math.cos(delta_inc));
            } else {
                dv1 = Math.abs(V_p - V_chase);
                dv2 = Math.sqrt(V_p * V_p + V_tx1 * V_tx1 - 2 * V_p * V_tx1 * Math.cos(delta_inc));
                dv3 = Math.abs(V_target - V_tx2);
            }
            dv_total = dv1 + dv2 + dv3;
        }

        const dv_plane_alone = 2 * V_target * Math.sin(delta_inc / 2);
        const dv_hohmann_alone = Math.abs(V_tx1 - V_chase) + Math.abs(V_target - V_tx2);

        const TOF_phasing_total = skipPhasing ? 0 : kChase * Period_phasing;
        const TOF_total = t_node + TOF_phasing_total + TOF;

        // Position & Velocity Events
        const events = [];
        const u_N_rad = u_N * D2R;
        const u_arr_rad = (u_N + 180) * D2R;

        // Point at departure node (in chase plane)
        const r_node = orbitPoint(Rchase, i_chase, raan_rad, u_N_rad);
        const v_chase_node = orbitVelocity(Rchase, i_chase, raan_rad, u_N_rad, mu);

        if (!skipPhasing) {
            // Burn 1: into phasing orbit (at t_node)
            const v_p_node = scale(v_chase_node, V_p / V_chase);
            const dv1_vec = sub(v_p_node, v_chase_node);
            events.push({
                t: t_node,
                r: r_node,
                vBefore: v_chase_node,
                vAfter: v_p_node,
                dv: dv1_vec,
                dv_mag: dv1,
                label: 'Burn 1 (Phasing)'
            });

            // Burn 2: from phasing onto transfer orbit (at t_node + TOF_phasing_total)
            const t_dep = t_node + TOF_phasing_total;
            if (isRaise) {
                // Transfer is in chase plane
                const v_tx1_node = scale(v_chase_node, V_tx1 / V_chase);
                const dv2_vec = sub(v_tx1_node, v_p_node);
                events.push({
                    t: t_dep,
                    r: r_node,
                    vBefore: v_p_node,
                    vAfter: v_tx1_node,
                    dv: dv2_vec,
                    dv_mag: dv2,
                    label: 'Burn 2 (Transfer)'
                });

                // Burn 3: at arrival node (in target plane)
                const r_arr = orbitPoint(Rtarget, i_chase, raan_rad, u_arr_rad); // nodal point is shared!
                const v_tx2_arr = orbitVelocity(Rtarget, i_chase, raan_rad, u_arr_rad, mu);
                const v_tx2_actual = scale(v_tx2_arr, V_tx2 / Math.sqrt(mu / Rtarget));
                const v_target_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const dv3_vec = sub(v_target_arr, v_tx2_actual);
                events.push({
                    t: TOF_total,
                    r: r_arr,
                    vBefore: v_tx2_actual,
                    vAfter: v_target_arr,
                    dv: dv3_vec,
                    dv_mag: dv3,
                    label: 'Burn 3 (Arrival & Plane Change)'
                });
            } else {
                // Lowering: transfer is in target plane, so plane change occurs at burn 2!
                const v_tx1_node = orbitVelocity(Rchase, i_target, raan_rad, u_N_rad, mu);
                const v_tx1_actual = scale(v_tx1_node, V_tx1 / Math.sqrt(mu / Rchase));
                const dv2_vec = sub(v_tx1_actual, v_p_node);
                events.push({
                    t: t_dep,
                    r: r_node,
                    vBefore: v_p_node,
                    vAfter: v_tx1_actual,
                    dv: dv2_vec,
                    dv_mag: dv2,
                    label: 'Burn 2 (Transfer & Plane Change)'
                });

                // Burn 3: arrival in target plane
                const r_arr = orbitPoint(Rtarget, i_target, raan_rad, u_arr_rad);
                const v_tx2_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const v_tx2_actual = scale(v_tx2_arr, V_tx2 / Math.sqrt(mu / Rtarget));
                const v_target_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const dv3_vec = sub(v_target_arr, v_tx2_actual);
                events.push({
                    t: TOF_total,
                    r: r_arr,
                    vBefore: v_tx2_actual,
                    vAfter: v_target_arr,
                    dv: dv3_vec,
                    dv_mag: dv3,
                    label: 'Burn 3 (Arrival)'
                });
            }
        } else {
            // Direct transfer without phasing
            if (isRaise) {
                const v_tx1_node = scale(v_chase_node, V_tx1 / V_chase);
                const dv1_vec = sub(v_tx1_node, v_chase_node);
                events.push({
                    t: t_node,
                    r: r_node,
                    vBefore: v_chase_node,
                    vAfter: v_tx1_node,
                    dv: dv1_vec,
                    dv_mag: dv1,
                    label: 'Burn 1 (Transfer)'
                });

                const r_arr = orbitPoint(Rtarget, i_chase, raan_rad, u_arr_rad);
                const v_tx2_arr = orbitVelocity(Rtarget, i_chase, raan_rad, u_arr_rad, mu);
                const v_tx2_actual = scale(v_tx2_arr, V_tx2 / Math.sqrt(mu / Rtarget));
                const v_target_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const dv2_vec = sub(v_target_arr, v_tx2_actual);
                events.push({
                    t: TOF_total,
                    r: r_arr,
                    vBefore: v_tx2_actual,
                    vAfter: v_target_arr,
                    dv: dv2_vec,
                    dv_mag: dv2,
                    label: 'Burn 2 (Arrival & Plane Change)'
                });
            } else {
                const v_tx1_node = orbitVelocity(Rchase, i_target, raan_rad, u_N_rad, mu);
                const v_tx1_actual = scale(v_tx1_node, V_tx1 / Math.sqrt(mu / Rchase));
                const dv1_vec = sub(v_tx1_actual, v_chase_node);
                events.push({
                    t: t_node,
                    r: r_node,
                    vBefore: v_chase_node,
                    vAfter: v_tx1_actual,
                    dv: dv1_vec,
                    dv_mag: dv1,
                    label: 'Burn 1 (Transfer & Plane Change)'
                });

                const r_arr = orbitPoint(Rtarget, i_target, raan_rad, u_arr_rad);
                const v_tx2_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const v_tx2_actual = scale(v_tx2_arr, V_tx2 / Math.sqrt(mu / Rtarget));
                const v_target_arr = orbitVelocity(Rtarget, i_target, raan_rad, u_arr_rad, mu);
                const dv2_vec = sub(v_target_arr, v_tx2_actual);
                events.push({
                    t: TOF_total,
                    r: r_arr,
                    vBefore: v_tx2_actual,
                    vAfter: v_target_arr,
                    dv: dv2_vec,
                    dv_mag: dv2,
                    label: 'Burn 2 (Arrival)'
                });
            }
        }

        return {
            mode: 'noncoplanar',
            constants: { MU: mu, R_EARTH: rEarth, MIN_ALT },
            Rchase,
            Rtarget,
            iChase,
            iTarget,
            uChase: u_chase_deg,
            uTarget: u_target_deg,
            raan: raan_deg,
            kChase,
            delta_inc,
            delta_inc_deg: delta_inc * R2D,
            n_chase,
            n_target,
            u_N,
            delta_u,
            t_node,
            u_target_node_deg,
            a_tx,
            TOF,
            nu_travel,
            nu_travel_deg,
            u_req,
            delta_deg,
            skipPhasing,
            k_target,
            Period_phasing,
            a_phasing,
            far_apsis,
            V_chase,
            V_target,
            V_tx1,
            V_tx2,
            V_phasing: V_p,
            V_p,
            dv1,
            dv2,
            dv3,
            dv_total,
            dv_plane_alone,
            dv_hohmann_alone,
            TOF_phasing_total,
            TOF_total,
            arrival: TOF_total,
            target: { R: Rtarget, inc: i_target, raan: raan_rad, theta0: u_target_deg * D2R, n: n_target },
            chase: { R: Rchase, inc: i_chase, raan: raan_rad, theta0: u_chase_deg * D2R, n: n_chase },
            events,
            status: { ok: warnings.length === 0, warnings }
        };
    }

    /* ------------------------------------------------------------------ */
    /* 5.5 Lambert Solver                                                 */
    /* ------------------------------------------------------------------ */
    function lambert(R1, R2, TOF, dnu, mu = MU) {
        const r1 = norm(R1);
        const r2 = norm(R2);

        // Short way if dnu < pi, long way if dnu > pi
        const t_m = dnu < Math.PI ? 1 : -1;
        const cos_dnu = Math.cos(dnu);
        const sin_dnu = Math.sin(dnu);
        const A = t_m * Math.sqrt(Math.max(0, r1 * r2 * (1 + cos_dnu)));

        if (Math.abs(A) < 1e-12) {
            return { converged: false, error: 'singular' };
        }

        let psi = 0;
        let c2_val = 0.5;
        let c3_val = 1 / 6;
        let psi_up = 4 * Math.PI * Math.PI;
        let psi_low = -4 * Math.PI;
        let iterations = 0;
        let converged = false;

        let y = 0;
        for (let iter = 0; iter < 200; iter++) {
            iterations = iter + 1;
            y = r1 + r2 + (A * (psi * c3_val - 1)) / Math.sqrt(c2_val);
            if (A > 0 && y < 0) {
                while (y < 0) {
                    psi += 0.1;
                    c2_val = c2(psi);
                    c3_val = c3(psi);
                    y = r1 + r2 + (A * (psi * c3_val - 1)) / Math.sqrt(c2_val);
                }
                psi_low = psi;
            }

            const chi = Math.sqrt(y / c2_val);
            const dt_n = (Math.pow(chi, 3) * c3_val + A * Math.sqrt(y)) / Math.sqrt(mu);

            if (Math.abs(dt_n - TOF) < 1e-6) {
                converged = true;
                break;
            }

            if (dt_n <= TOF) {
                psi_low = psi;
            } else {
                psi_up = psi;
            }
            psi = (psi_up + psi_low) / 2;
            c2_val = c2(psi);
            c3_val = c3(psi);
        }

        const f = 1 - y / r1;
        const g = A * Math.sqrt(y / mu);
        const gdot = 1 - y / r2;

        const v1 = scale(sub(R2, scale(R1, f)), 1 / g);
        const v2 = scale(sub(scale(R2, gdot), R1), 1 / g);

        return {
            v1,
            v2,
            f,
            g,
            gdot,
            psi,
            y,
            iterations,
            converged
        };
    }

    /* ------------------------------------------------------------------ */
    /* 5.5 Gauss Mode Solver                                              */
    /* ------------------------------------------------------------------ */
    function solveGauss({
        Rchase,
        Rtarget,
        phi0,
        tWait = 0,
        tof,
        mu = MU,
        rEarth = R_EARTH
    }) {
        const warnings = [];
        const phi0_deg = wrap360(phi0);
        const phi0_rad = phi0_deg * D2R;

        const n_chase = Math.sqrt(mu / Math.pow(Rchase, 3));
        const n_target = Math.sqrt(mu / Math.pow(Rtarget, 3));
        const omega_drift = n_chase - n_target;
        const T_syn = (2 * Math.PI) / Math.abs(omega_drift);

        const a_transfer_hohmann = (Rchase + Rtarget) / 2;
        const TOF_Hohmann = Math.PI * Math.sqrt(Math.pow(a_transfer_hohmann, 3) / mu);

        // Default TOF if omitted: Hohmann TOF
        const flightTime = tof !== undefined ? tof : TOF_Hohmann;

        const theta_1 = n_chase * tWait;
        const theta_2_raw = -phi0_rad + n_target * (tWait + flightTime);

        let dnu = wrap2Pi(theta_2_raw - theta_1);

        // Singular guard: at exactly pi, plane is undefined
        let singularAdjusted = false;
        if (Math.abs(dnu - Math.PI) < 1e-4) {
            dnu = Math.PI - 1e-4;
            singularAdjusted = true;
        }

        const theta_2 = theta_1 + dnu;
        const R1 = [Rchase * Math.cos(theta_1), Rchase * Math.sin(theta_1), 0];
        const R2 = [Rtarget * Math.cos(theta_2), Rtarget * Math.sin(theta_2), 0];

        let sol = null;
        if (dnu < 1e-3 || dnu > 2 * Math.PI - 1e-3) {
            warnings.push('target-too-close');
        } else {
            sol = lambert(R1, R2, flightTime, dnu, mu);
            if (!sol.converged) {
                warnings.push('lambert-failed');
            }
        }

        const V_chase_circ = Math.sqrt(mu / Rchase);
        const V_target_circ = Math.sqrt(mu / Rtarget);

        const v_have1 = [-V_chase_circ * Math.sin(theta_1), V_chase_circ * Math.cos(theta_1), 0];
        const v_want2 = [-V_target_circ * Math.sin(theta_2), V_target_circ * Math.cos(theta_2), 0];

        let v_want1 = [0, 0, 0];
        let v_have2 = [0, 0, 0];
        let dv1_vec = [0, 0, 0];
        let dv2_vec = [0, 0, 0];
        let dv1 = NaN;
        let dv2 = NaN;
        let dv_total = NaN;
        let a_tx = NaN;
        let e_tx = NaN;
        let p_tx = NaN;
        let min_alt = NaN;
        let f = NaN, g = NaN, gdot = NaN;
        let f_p = NaN, g_p = NaN, gdot_p = NaN;

        if (sol && sol.converged) {
            v_want1 = sol.v1;
            v_have2 = sol.v2;
            f = sol.f;
            g = sol.g;
            gdot = sol.gdot;

            dv1_vec = sub(v_want1, v_have1);
            dv2_vec = sub(v_want2, v_have2);
            dv1 = norm(dv1_vec);
            dv2 = norm(dv2_vec);
            dv_total = dv1 + dv2;

            // Orbit geometry
            const v1_mag = norm(v_want1);
            const energy = (v1_mag * v1_mag) / 2 - mu / Rchase;
            a_tx = -mu / (2 * energy);

            // Eccentricity vector
            // e = ((v^2 - mu/r) r - (r . v) v) / mu
            const term1 = scale(R1, v1_mag * v1_mag - mu / Rchase);
            const term2 = scale(v_want1, dot(R1, v_want1));
            const e_vec = scale(sub(term1, term2), 1 / mu);
            e_tx = norm(e_vec);

            // Semi-latus rectum p
            const h_vec = cross(R1, v_want1);
            const h_mag = norm(h_vec);
            p_tx = (h_mag * h_mag) / mu;

            // Textbook p-form f, g, gdot for verification (RZ-22)
            f_p = 1 - (Rtarget / p_tx) * (1 - Math.cos(dnu));
            g_p = (Rchase * Rtarget * Math.sin(dnu)) / Math.sqrt(mu * p_tx);
            gdot_p = 1 - (Rchase / p_tx) * (1 - Math.cos(dnu));

            // Sample flown arc to find lowest point
            let lowest_r = Math.min(Rchase, Rtarget);
            const n_samples = 40;
            for (let i = 0; i <= n_samples; i++) {
                const dt_s = (i / n_samples) * flightTime;
                const pt = propagate(R1, v_want1, dt_s, mu);
                const r_pt = norm(pt.r);
                if (r_pt < lowest_r) lowest_r = r_pt;
            }
            min_alt = lowest_r - rEarth;

            if (min_alt < MIN_ALT) {
                warnings.push('perigee-low');
            }
        }

        // Hohmann comparison
        const hohmann_res = solveCoplanar({ Rchase, Rtarget, phi0, mu, rEarth });

        const events = [];
        if (sol && sol.converged) {
            events.push({
                t: tWait,
                r: R1,
                vBefore: v_have1,
                vAfter: v_want1,
                dv: dv1_vec,
                dv_mag: dv1,
                label: 'Departure Burn (ΔV̄₁)'
            });
            events.push({
                t: tWait + flightTime,
                r: R2,
                vBefore: v_have2,
                vAfter: v_want2,
                dv: dv2_vec,
                dv_mag: dv2,
                label: 'Arrival Burn (ΔV̄₂)'
            });
        }

        return {
            mode: 'gauss',
            constants: { MU: mu, R_EARTH: rEarth, MIN_ALT },
            Rchase,
            Rtarget,
            phi0: phi0_deg,
            phi0_rad,
            tWait,
            tof: flightTime,
            TOF_Hohmann,
            tofMultiple: flightTime / TOF_Hohmann,
            T_syn,
            dnu,
            dnu_deg: dnu * R2D,
            theta_1,
            theta_2,
            R1,
            R2,
            v_have1,
            v_want1,
            v_have2,
            v_want2,
            dv1_vec,
            dv2_vec,
            dv1,
            dv2,
            dv_total,
            a_tx,
            e_tx,
            p_tx,
            min_alt,
            isHyperbolic: a_tx < 0,
            f,
            g,
            gdot,
            f_p,
            g_p,
            gdot_p,
            hohmann_res,
            arrival: tWait + flightTime,
            target: { R: Rtarget, inc: 0, raan: 0, theta0: -phi0_rad, n: n_target },
            chase: { R: Rchase, inc: 0, raan: 0, theta0: 0, n: n_chase },
            events,
            status: { ok: warnings.length === 0, warnings }
        };
    }

    // ΔV map grid for the Trade panel
    function gaussGrid({ Rchase, Rtarget, phi0, mu = MU, rEarth = R_EARTH }, nx = 60, ny = 60) {
        const n_chase = Math.sqrt(mu / Math.pow(Rchase, 3));
        const n_target = Math.sqrt(mu / Math.pow(Rtarget, 3));
        const omega_drift = n_chase - n_target;
        const T_syn = (2 * Math.PI) / Math.abs(omega_drift);

        const a_tx = (Rchase + Rtarget) / 2;
        const TOF_Hohmann = Math.PI * Math.sqrt(Math.pow(a_tx, 3) / mu);

        const grid = new Float64Array(nx * ny);
        let min_dv = Infinity;
        let min_x = 0;
        let min_y = 0;

        for (let j = 0; j < ny; j++) {
            // y goes from 0.40 to 1.60 TOF_Hohmann
            const tof_mult = 0.40 + (1.60 - 0.40) * (j / (ny - 1));
            const tof = tof_mult * TOF_Hohmann;

            for (let i = 0; i < nx; i++) {
                // x goes from 0 to T_syn
                const tWait = (i / (nx - 1)) * T_syn;
                const res = solveGauss({ Rchase, Rtarget, phi0, tWait, tof, mu, rEarth });

                const idx = j * nx + i;
                if (!res.status.ok && res.status.warnings.includes('lambert-failed')) {
                    grid[idx] = NaN;
                } else if (res.min_alt < MIN_ALT) {
                    grid[idx] = NaN;
                } else {
                    grid[idx] = res.dv_total;
                    if (res.dv_total < min_dv) {
                        min_dv = res.dv_total;
                        min_x = tWait;
                        min_y = tof;
                    }
                }
            }
        }

        return {
            grid,
            nx,
            ny,
            min_dv,
            min_x,
            min_y,
            T_syn,
            TOF_Hohmann
        };
    }

    /* ------------------------------------------------------------------ */
    /* Export                                                             */
    /* ------------------------------------------------------------------ */
    const RendezvousMath = {
        constants: { MU, R_EARTH, MIN_ALT },
        solveCoplanar,
        solveCoOrbital,
        solveNoncoplanar,
        solveGauss,
        gaussGrid,
        lambert,
        propagate,
        stateAt,
        conicPoints,
        wrap2Pi,
        wrapPi,
        wrap360,
        formatHms
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RendezvousMath;
    }
    global.RendezvousMath = RendezvousMath;
})(typeof window !== 'undefined' ? window : globalThis);
