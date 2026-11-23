// cw.js
// The relative motion setting's default model, as the course teaches it: the Clohessy-Wiltshire
// (CW) equations and the relative motion orbital elements (RMOEs) for a chase near a target on a
// circular orbit, the burn rules of thumb, and the names of the motions. The other model is exact.js
// beside this file; rpo.js joins the two as OrbitMath.rpo.
// No DOM. Load after math/common.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('cw.js: load math/common.js first');

    /* CW equations and RMOEs (course model) ------------------------------------------------------- */
    OM.define('cw', ['angles'], function (C, OC, A) {
        const { D2R, R2D, TWO_PI, wrap360 } = A;
        const TINY = 1e-9;

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

        return {
            rmoeFromState, stateFromRmoe, rmoeAt, nmcLoop, driftRate, boundaryTable, timeToAngle,
            cwPropagate, stm, transferVelocity, applyBurn, rule,
            classifyMotion, sampleTrajectory
        };
    });
})(typeof window !== 'undefined' ? window : globalThis);
