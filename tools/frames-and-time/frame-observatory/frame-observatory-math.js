// frame-observatory-math.js
// The Reference Frame Observatory's own math: ECI, ECEF and RIC viewpoints.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('frame-observatory-math.js: load math/common.js first');

    /* Reference frames: ECI, ECEF and RIC viewpoints ---------------------------------------------- */
    OM.define('frames', ['vec', 'kepler', 'elements', 'propagate'], function (C, OC, V, K, EL, PR) {
        const MU = C.mu;               // Earth gravitational parameter, km^3/s^2
        const RE = C.re;               // Earth equatorial radius, km
        const OMEGA_E = C.omegaE;      // Earth rotation rate, rad/s
        const D2R = Math.PI / 180;
        const SIDEREAL_DAY = 2 * Math.PI / OMEGA_E;
        const OBLIQUITY = OC.LESSON.obliquityDeg * D2R;
        const YEAR = OC.TIME.TROPICAL_YEAR_DAYS * OC.TIME.DAY_S;

        // Radius at which one orbit takes exactly one Earth rotation.
        const GEO_RADIUS = Math.cbrt(MU / (OMEGA_E * OMEGA_E));

        const { dot, cross, unit } = V;

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

        // RIC unit vectors, in ECI, at time t, from the target's own r and v (so they follow it with
        // either propagator): R along r, C along r x v, I = C x R.
        function ricBasis(s, t) {
            const st = PR.stateAt(s.target.sat, t);
            const R = unit(st.r);
            const C = unit(cross(st.r, st.v));
            return { R, I: cross(C, R), C };
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
    });
})(typeof window !== 'undefined' ? window : globalThis);
