// time.js
// Start time, Julian date, Greenwich mean sidereal time, and low-precision Sun and Moon positions
// (the series and their sources are in math/constants/shared.js). Used by the Cowell forces and the
// pages that turn Earth to the real date.
// No DOM. Load after math/common.js.
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('time.js: load math/common.js first');

    const LOAD_TIME_MS = OM.LOAD_TIME_MS;

    /* Time, sidereal time, Sun and Moon -------------------------------------------------------- */
    // The computer clock gives UTC, used here for UT1 and TT as well: the differences (under 1 s and
    // about 69 s) are far below what the low-precision Sun and Moon series resolve.
    OM.define('time', [], function (C, OC) {
        const D2R = Math.PI / 180;
        const T = OC.TIME;
        function toMs(epoch) {
            if (epoch === undefined || epoch === null) return LOAD_TIME_MS;
            if (epoch instanceof Date) return epoch.getTime();
            if (typeof epoch === 'number') return epoch;
            const ms = Date.parse(epoch);
            if (Number.isNaN(ms)) throw new Error(`Cannot read the start time "${epoch}"`);
            return ms;
        }
        const julianDate = (ms) => ms / (T.DAY_S * 1000) + T.JD_UNIX_EPOCH;

        // Greenwich mean sidereal time, radians (IAU 1982, in days and centuries from J2000).
        function gmst(jd) {
            const d = jd - T.JD_J2000, c = d / T.DAYS_PER_CENTURY, k = OC.GMST;
            const deg = k[0] + k[1] * d + k[2] * c * c + k[3] * c * c * c;
            return (((deg % 360) + 360) % 360) * D2R;
        }

        // Low-precision Sun (Astronomical Almanac), geocentric equatorial km: about 0.01 deg.
        function sunPosition(jd, AU = OC.THIRD_BODY.AU) {
            const s = OC.SUN_SERIES;
            const n = jd - T.JD_J2000;
            const L = s.L[0] + s.L[1] * n;
            const g = (s.g[0] + s.g[1] * n) * D2R;
            const lambda = (L + s.lon[0] * Math.sin(g) + s.lon[1] * Math.sin(2 * g)) * D2R;
            const eps = (s.eps[0] + s.eps[1] * n) * D2R;
            const R = (s.R[0] + s.R[1] * Math.cos(g) + s.R[2] * Math.cos(2 * g)) * AU;
            return [R * Math.cos(lambda), R * Math.cos(eps) * Math.sin(lambda), R * Math.sin(eps) * Math.sin(lambda)];
        }

        // Low-precision Moon (Astronomical Almanac), geocentric equatorial km: about 0.3 deg in
        // longitude, 0.2 deg in latitude.
        function moonPosition(jd) {
            const m = OC.MOON_SERIES;
            const t = (jd - T.JD_J2000) / T.DAYS_PER_CENTURY;
            const s = (deg) => Math.sin(deg * D2R), c = (deg) => Math.cos(deg * D2R);
            const sum = (terms, f) => terms.reduce((acc, [amp, phase, rate]) => acc + amp * f(phase + rate * t), 0);
            const lambda = m.lonBase[0] + m.lonBase[1] * t + sum(m.lonSin, s);
            const beta = sum(m.latSin, s);
            const parallax = m.parallaxBase + sum(m.parallaxCos, c);
            const r = m.parallaxRadius / s(parallax);
            const l = c(beta) * c(lambda);
            const mm = m.cosEps * c(beta) * s(lambda) - m.sinEps * s(beta);
            const n = m.sinEps * c(beta) * s(lambda) + m.cosEps * s(beta);
            return [r * l, r * mm, r * n];
        }
        return { LOAD_TIME_MS, toMs, julianDate, gmst, sunPosition, moonPosition };
    });
})(typeof window !== 'undefined' ? window : globalThis);
