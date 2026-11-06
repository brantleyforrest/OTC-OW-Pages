// Orbit and reference frame calculations for the Reference Frame Observatory.
// All motion is computed once, in ECI. Every other frame is only a change of
// viewpoint applied to those ECI positions. Distances are in kilometers and
// times are in seconds. Classic script, so that it also runs from a local file.
(function (root) {
    'use strict';

    const MU = 398600.4418;        // Earth gravitational parameter, km^3/s^2
    const RE = 6378.137;           // Earth mean equatorial radius, km
    const OMEGA_E = 7.292115e-5;   // Earth rotation rate, rad/s
    const D2R = Math.PI / 180;
    const SIDEREAL_DAY = 2 * Math.PI / OMEGA_E;
    const OBLIQUITY = 23.44 * D2R;
    const YEAR = 365.2422 * 86400;

    // Radius at which one orbit takes exactly one Earth rotation.
    const GEO_RADIUS = Math.cbrt(MU / (OMEGA_E * OMEGA_E));

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];

    function earthAngle(t) {
        return OMEGA_E * t;
    }

    function solveKepler(M, e) {
        let E = M;
        for (let k = 0; k < 6; k++) {
            E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        }
        return E;
    }

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
            Q: [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si]
        };
    }

    function positionEci(el, t) {
        const E = solveKepler(el.M0 + el.n * t, el.e);
        const x = el.a * (Math.cos(E) - el.e);
        const y = el.b * Math.sin(E);
        return [
            x * el.P[0] + y * el.Q[0],
            x * el.P[1] + y * el.Q[1],
            x * el.P[2] + y * el.Q[2]
        ];
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

    root.FrameMath = {
        MU, RE, OMEGA_E, D2R, SIDEREAL_DAY, GEO_RADIUS,
        earthAngle, makeScenario, positionEci, sitePositionEci, ricBasis,
        coordinates, toDisplay, displayTransform, speedInFrame, sunDirection, dot, cross
    };
})(typeof window !== 'undefined' ? window : globalThis);
