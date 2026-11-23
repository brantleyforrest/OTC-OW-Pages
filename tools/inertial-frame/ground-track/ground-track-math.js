// ground-track-math.js
// The Ground Track page's own math: ground tracks over a turning Earth.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('ground-track-math.js: load math/common.js first');

    /* Ground tracks over a turning Earth (Ground Track page) -------------------------------------- */
    OM.define('groundTrack', ['kepler'], function (C, OC, K) {
        const R_E = C.re;             // km
        const MU = C.mu;              // km^3/s^2
        const OMEGA_E = C.omegaE;     // rad/s
        const D2R = Math.PI / 180;
        const R2D = 180 / Math.PI;
        const TWO_PI = 2 * Math.PI;
        const EARTH_DEG_PER_HOUR = OMEGA_E * R2D * 3600;
        const CIRCULAR_E = 0.02;      // Below this, an orbit counts as circular: no perigee or apogee

        const POINTS_PER_ORBIT = 240; // Track samples per orbit
        const MAX_PAST_ORBITS = 16;   // About one day of a low orbit
        const TRACK_POINTS = (MAX_PAST_ORBITS + 1) * POINTS_PER_ORBIT + 1;
        const MARKER_MAX = MAX_PAST_ORBITS + 2; // Perigee (or apogee, or node) passes in one track

        const meanMotion = (a) => Math.sqrt(MU / (a * a * a));
        const periodOf = (a) => TWO_PI / meanMotion(a);
        const isCircular = (el) => el.e < CIRCULAR_E;
        const isEquatorial = (el) => el.i < 0.05 || el.i > 179.95;

        // Perifocal unit vectors in ECI: P toward perigee, Q 90 deg ahead of P in the orbit plane.
        function orbitBasis(el) {
            const O = el.raan * D2R, inc = el.i * D2R, w = el.argp * D2R;
            const cosO = Math.cos(O), sinO = Math.sin(O);
            const cosi = Math.cos(inc), sini = Math.sin(inc);
            const cosw = Math.cos(w), sinw = Math.sin(w);
            return {
                P: { x: cosO * cosw - sinO * sinw * cosi, y: sinO * cosw + cosO * sinw * cosi, z: sinw * sini },
                Q: { x: -cosO * sinw - sinO * cosw * cosi, y: -sinO * sinw + cosO * cosw * cosi, z: cosw * sini }
            };
        }

        // r = p / (1 + e cos nu), km
        const radiusAt = (el, nuDeg) => el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(nuDeg * D2R));

        // ECI position (km) at true anomaly nu (deg).
        function positionAt(el, basis, nuDeg) {
            const r = radiusAt(el, nuDeg), nu = nuDeg * D2R;
            const px = r * Math.cos(nu), py = r * Math.sin(nu);
            const { P, Q } = basis;
            return { x: P.x * px + Q.x * py, y: P.y * px + Q.y * py, z: P.z * px + Q.z * py };
        }

        // The ascending node is at nu = -argp, the descending node at nu = 180 - argp.
        const nodeRadii = (el) => ({ ascending: radiusAt(el, -el.argp), descending: radiusAt(el, 180 - el.argp) });

        function eccentricAnomaly(nuDeg, e) {
            const nu = nuDeg * D2R;
            return Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
        }

        function meanAnomaly(nuDeg, e) {
            const E = eccentricAnomaly(nuDeg, e);
            return E - e * Math.sin(E);
        }

        // Time (s) to move from nu0 to nu1 the shorter way around; negative when nu1 is behind.
        function shortestTimeBetween(el, nu0Deg, nu1Deg) {
            let dM = (meanAnomaly(nu1Deg, el.e) - meanAnomaly(nu0Deg, el.e)) % TWO_PI;
            if (dM > Math.PI) dM -= TWO_PI;
            if (dM < -Math.PI) dM += TWO_PI;
            return dM / meanMotion(el.a);
        }

        // Earth's rotation (rad) during a time span (s).
        const earthTurn = (seconds) => OMEGA_E * seconds;

        // The most recent ascending node at or before the satellite: its eccentric anomaly, and the
        // time (s) since the satellite passed it.
        function lastAscendingNode(el) {
            const { e } = el;
            const E0 = eccentricAnomaly(el.nu, e);
            const behind = (((E0 - eccentricAnomaly(-el.argp, e)) % TWO_PI) + TWO_PI) % TWO_PI;
            const start = E0 - behind;
            const elapsed = (behind + e * (Math.sin(start) - Math.sin(E0))) / meanMotion(el.a);
            return { start, elapsed };
        }

        // Unit vector, in Earth-fixed axes, toward the point below the satellite at eccentric anomaly E.
        // theta is Earth's rotation angle when the satellite is at mean anomaly M0. Written into out[3k..3k+2].
        function subSatellitePoint(el, basis, M0, theta, E, out, k) {
            const { a, e } = el;
            const { P, Q } = basis;
            const elapsed = (E - e * Math.sin(E) - M0) / meanMotion(a);
            const turned = theta + earthTurn(elapsed);
            const cosT = Math.cos(turned), sinT = Math.sin(turned);
            const r = a * (1 - e * Math.cos(E));
            const px = a * (Math.cos(E) - e), py = a * Math.sqrt(1 - e * e) * Math.sin(E);
            const x = P.x * px + Q.x * py, y = P.y * px + Q.y * py, z = P.z * px + Q.z * py;
            out[3 * k] = (cosT * x + sinT * y) / r;
            out[3 * k + 1] = (-sinT * x + cosT * y) / r;
            out[3 * k + 2] = z / r;
        }

        // The ground track from `pastOrbits` orbits back to one orbit ahead, or, in onePeriod mode,
        // from the last ascending node to the next. Samples are even in E, so they bunch near perigee
        // without a Kepler solve per sample. Fills out.track and the pass lists in `out`
        // (perigees, apogees, ascents, descents). Returns the sample index of the satellite, the last
        // sample index, and the time since the last ascending node (onePeriod mode only, else null).
        function computeGroundTrack(el, theta, pastOrbits, onePeriod, out) {
            const { e } = el;
            const basis = orbitBasis(el);
            const E0 = eccentricAnomaly(el.nu, e);
            const M0 = E0 - e * Math.sin(E0);

            let start = E0 - pastOrbits * TWO_PI;
            let end = E0 + TWO_PI;
            let periodElapsed = null;
            if (onePeriod) {
                const node = lastAscendingNode(el);
                start = node.start;
                end = start + TWO_PI;
                periodElapsed = node.elapsed;
            }

            // The satellite is always a sample, and the two ends land exactly on the window's ends.
            const step = TWO_PI / POINTS_PER_ORBIT;
            const now = Math.ceil((E0 - start) / step - 1e-9);
            const last = now + Math.ceil((end - E0) / step - 1e-9);
            for (let k = 0; k <= last; k++) {
                const E = k === 0 ? start : k === last ? end : E0 + (k - now) * step;
                subSatellitePoint(el, basis, M0, theta, E, out.track, k);
            }

            // Every pass of a fixed point on the orbit (fixed E) inside the window. The first
            // `past` of them are behind the satellite.
            const collect = (set, phase, includeEnd = false) => {
                const stop = includeEnd ? end + 1e-9 : end - 1e-9;
                set.count = set.past = 0;
                for (let m = Math.ceil((start - phase) / TWO_PI - 1e-9); phase + m * TWO_PI < stop; m++) {
                    const E = phase + m * TWO_PI;
                    subSatellitePoint(el, basis, M0, theta, E, set.points, set.count);
                    set.count++;
                    if (E <= E0) set.past = set.count;
                }
            };
            collect(out.perigees, 0);
            collect(out.apogees, Math.PI);
            collect(out.ascents, eccentricAnomaly(-el.argp, e), onePeriod);
            collect(out.descents, eccentricAnomaly(180 - el.argp, e));

            return { trackNow: now, trackEnd: last, periodElapsed };
        }

        // Longitude and latitude (deg) of sample k of a list of Earth-fixed unit vectors.
        const longitudeOf = (points, k) => Math.atan2(points[3 * k + 1], points[3 * k]) * R2D;
        const latitudeOf = (points, k) => Math.asin(Math.max(-1, Math.min(1, points[3 * k + 2]))) * R2D;
        const wrapLongitude = (lon) => (((lon + 180) % 360) + 360) % 360 - 180;
        return { R_E, MU, OMEGA_E, D2R, R2D, TWO_PI, EARTH_DEG_PER_HOUR, CIRCULAR_E, POINTS_PER_ORBIT, MAX_PAST_ORBITS, TRACK_POINTS, MARKER_MAX, meanMotion, periodOf, isCircular, isEquatorial, orbitBasis, radiusAt, positionAt, nodeRadii, eccentricAnomaly, meanAnomaly, shortestTimeBetween, earthTurn, lastAscendingNode, subSatellitePoint, computeGroundTrack, longitudeOf, latitudeOf, wrapLongitude };
    });
})(typeof window !== 'undefined' ? window : globalThis);
