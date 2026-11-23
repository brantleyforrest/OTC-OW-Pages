// wgs84.js
// The WGS-84 constant set: the defining and derived WGS-84 values; g0 is standard gravity. J2,2 and
// its longitude come from the EGM-96 C22 and S22 in shared.js. The course set is course.js.
// No DOM. Load after shared.js and course.js.
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC) throw new Error('wgs84.js: load math/constants/shared.js first');

    const G = OC.GRAVITY_FIELD;
    OC.SETS.wgs84 = {
        id: 'wgs84', name: 'WGS-84',
        mu: 398600.4418,          // km^3/s^2
        re: 6378.137,             // km
        J2: 1.08262668e-3,
        omegaE: 7.292115e-5,      // rad/s
        g0: 9.80665,              // m/s^2, standard gravity
        J22: Math.hypot(G.C22, G.S22),
        LON22: 0.5 * Math.atan2(G.S22, G.C22) * 180 / Math.PI   // deg east, long axis of the equator
    };
})(typeof window !== 'undefined' ? window : globalThis);
