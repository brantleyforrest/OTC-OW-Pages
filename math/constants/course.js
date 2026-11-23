// course.js
// The course constant set (the default): the values on the course equation sheet and lessons.
// The other set is wgs84.js beside this file; numbers both sets use are in shared.js.
// No DOM. Load after shared.js.
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC) throw new Error('course.js: load math/constants/shared.js first');

    OC.SETS.course = {
        id: 'course', name: 'Course constants',
        mu: 398600.44,            // km^3/s^2, every lesson and the equation sheet
        re: 6378.137,             // km, equation sheet (examples round to 6378)
        J2: 1.08263e-3,           // Perturbations lesson, Test 1 study guide
        omegaE: 7.2921e-5,        // rad/s, one turn per sidereal day as the relative-motion lessons use
        g0: 9.81,                 // m/s^2, propulsion lesson and equation sheet
        J22: 1.8e-6,              // Perturbations lesson
        LON22: -15                // deg east, long axis of the equator, Perturbations lesson
    };
})(typeof window !== 'undefined' ? window : globalThis);
