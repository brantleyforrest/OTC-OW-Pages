// elements.js
// Classical orbital elements to position and velocity and back, with the circular and equatorial
// cases. Every satellite is stored as r and v (math/motion/propagate.js), so any page that takes or
// shows elements goes through here.
// No DOM. Load after math/common.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('elements.js: load math/common.js first');

    /* Classical elements and r, v ----------------------------------------------------------------- */
    // a (km), e, i, raan, argp, nu (deg) to ECI r (km), v (km/s), and back (Vallado's RV2COE). When an
    // angle is undefined the conversion uses the usual stand-ins, so the two directions round-trip:
    //   circular inclined:     argp = 0, nu = argument of latitude u (from the ascending node)
    //   elliptical equatorial: raan = 0, argp = longitude of periapsis (from x, in the direction of motion)
    //   circular equatorial:   raan = argp = 0, nu = true longitude (from x, in the direction of motion)
    // elementsFromRv(r, v, ref) can instead keep a reference set's own values for the undefined angles
    // (a page's slider values), moving nu by the same amount, so a circle drawn from a slider set at
    // argp = 60 deg keeps argp = 60 deg.
    OM.define('elements', ['vec'], function (C, OC, V) {
        const MU = C.mu;
        const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;
        const { dot, cross, norm } = V;
        // Below these an orbit counts as circular (e) or equatorial (sin i) for the stand-in angles.
        const CIRCULAR_E = 1e-10, EQUATORIAL_SIN_I = 1e-10;
        const wrap360 = (deg) => ((deg % 360) + 360) % 360;
        // Angle from a to b about the axis h (radians, 0 to 2 pi, in the direction of motion).
        const angleAbout = (a, b, h) => {
            const x = dot(a, b), y = dot(cross(a, b), h) / norm(h);
            const ang = Math.atan2(y, x);
            return ang < 0 ? ang + TWO_PI : ang;
        };

        function rvFromElements(el) {
            const i = el.i * D2R, O = el.raan * D2R, w = el.argp * D2R, nu = el.nu * D2R;
            const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
            const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
            const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
            const p = el.a * (1 - el.e * el.e);
            const rMag = p / (1 + el.e * Math.cos(nu));
            const k = Math.sqrt(MU / p);
            const cn = Math.cos(nu), sn = Math.sin(nu);
            return {
                r: [0, 1, 2].map((j) => rMag * (cn * P[j] + sn * Q[j])),
                v: [0, 1, 2].map((j) => k * (-sn * P[j] + (el.e + cn) * Q[j]))
            };
        }

        function elementsFromRv(r, v, ref) {
            const R = norm(r), Vm = norm(v);
            const h = cross(r, v), H = norm(h);
            const n = [-h[1], h[0], 0], N = norm(n);
            const eVec = r.map((x, k) => ((Vm * Vm - MU / R) * x - dot(r, v) * v[k]) / MU);
            const e = norm(eVec);
            const energy = Vm * Vm / 2 - MU / R;
            const a = -MU / (2 * energy);
            const p = H * H / MU;
            const i = Math.atan2(N, h[2]) * R2D;
            const circular = e < CIRCULAR_E;
            const equatorial = N / H < EQUATORIAL_SIN_I;
            const xHat = [1, 0, 0];
            let raan, argp, nu;
            if (!circular && !equatorial) {
                raan = angleAbout(xHat, n, [0, 0, 1]) * R2D;   // atan2(n_y, n_x)
                argp = angleAbout(n, eVec, h) * R2D;
                nu = angleAbout(eVec, r, h) * R2D;
            } else if (circular && !equatorial) {
                raan = angleAbout(xHat, n, [0, 0, 1]) * R2D;
                argp = 0;
                nu = angleAbout(n, r, h) * R2D;                   // argument of latitude
            } else if (!circular && equatorial) {
                raan = 0;
                argp = angleAbout(xHat, eVec, h) * R2D;           // longitude of periapsis
                nu = angleAbout(eVec, r, h) * R2D;
            } else {
                raan = 0;
                argp = 0;
                nu = angleAbout(xHat, r, h) * R2D;                // true longitude
            }
            const el = {
                a, e, i, raan: wrap360(raan), argp: wrap360(argp), nu: wrap360(nu), p, h: H, energy,
                kind: (circular ? 'circular' : 'elliptical') + (equatorial ? ' equatorial' : ' inclined'),
                undefinedAngles: { raan: equatorial, argp: circular || equatorial, nu: circular }
            };
            if (ref) keepReferenceAngles(el, ref);
            return el;
        }

        // Puts a reference set's raan and argp in place of undefined ones; nu moves by the same amount,
        // so the position is unchanged. Circular inclined keeps u = argp + nu. An equatorial orbit keeps
        // its longitudes, measured in the direction of motion: s raan + argp (+ nu), where s is +1 for a
        // prograde orbit and -1 for a retrograde one (i = 180 deg turns the raan the other way).
        function keepReferenceAngles(el, ref) {
            const s = el.i > 90 ? -1 : 1;
            const sum = s * el.raan + el.argp + el.nu;
            if (el.undefinedAngles.raan && el.undefinedAngles.argp) {
                // Circular equatorial: only the true longitude is defined.
                el.raan = wrap360(ref.raan); el.argp = wrap360(ref.argp);
                el.nu = wrap360(sum - s * el.raan - el.argp);
            } else if (el.undefinedAngles.raan) {
                // Elliptical equatorial: only the longitude of periapsis is defined.
                const lonPeri = s * el.raan + el.argp;
                el.raan = wrap360(ref.raan);
                el.argp = wrap360(lonPeri - s * el.raan);
            } else if (el.undefinedAngles.argp) {
                // Circular inclined: only the argument of latitude is defined.
                const u = el.argp + el.nu;
                el.argp = wrap360(ref.argp);
                el.nu = wrap360(u - el.argp);
            }
            return el;
        }

        // Where r sits on a given (drawn) orbit: its angle in that orbit's plane from that orbit's
        // perigee (deg, 0 to 360). For a satellite on the orbit this is its true anomaly; for one that
        // forces have moved a little off it, it stays steady where the osculating true anomaly of a
        // nearly circular orbit would jump about.
        function angleOnOrbit(r, el) {
            const O = el.raan * D2R, w = el.argp * D2R, i = el.i * D2R;
            const cO = Math.cos(O), sO = Math.sin(O), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i);
            const P = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
            const Q = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
            return wrap360(Math.atan2(dot(r, Q), dot(r, P)) * R2D);
        }

        return { CIRCULAR_E, EQUATORIAL_SIN_I, rvFromElements, elementsFromRv, keepReferenceAngles, angleOnOrbit };
    });
})(typeof window !== 'undefined' ? window : globalThis);
