// exact.js
// The relative motion setting's exact model: both spacecraft propagated on their own
// (math/motion/propagate.js, with the settings' propagator), subtracted, and turned into the
// target's RIC axes, rectilinear or curvilinear. The course model is cw.js beside this file.
// No DOM. Load after math/motion/propagate.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('exact.js: load math/common.js first');

    /* Exact relative motion and the two RIC axis types ---------------------------------------------- */
    OM.define('exact', ['vec', 'angles', 'kepler', 'propagate'], function (C, OC, V, A, K, PR) {
        const MU = C.mu;
        const RE = C.re;
        const { D2R, R2D, wrap360, wrapPi } = A;
        const { dot, cross, norm, unit, sub } = V;
        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));

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

        return {
            keplerE, meanFromTrue, trueFromMean, coeAt, orbitProblem, coesToRv, rvAt, conicFromRv, ricBasis, ricToEci, chaseRvFromRic,
            basisFromRv, curvilinearFromRect, rectFromCurvilinear, relativeFromRv, relativeStateSats, sampleRelativeSats,
            chaseSatFromRic, targetSat, relativeState, sampleRelative
        };
    });
})(typeof window !== 'undefined' ? window : globalThis);
