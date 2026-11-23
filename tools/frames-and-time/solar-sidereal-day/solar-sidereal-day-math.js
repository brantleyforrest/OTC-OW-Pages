// solar-sidereal-day-math.js
// The Solar vs. Sidereal Day page's own math: solar and sidereal days.
// It joins OrbitMath like the shared sections, built from the constants the reader chose. Only this
// page uses it; it moves to math/ if another page comes to need it.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('solar-sidereal-day-math.js: load math/common.js first');

    /* Solar and sidereal days (Solar vs. Sidereal Day page) --------------------------------------- */
    OM.define('earthRotation', [], function (C, OC) {
        const D2R = Math.PI / 180;

        const SOLAR_DAY = OC.TIME.DAY_S;             // average solar day, s
        const TROPICAL_YEAR = OC.TIME.TROPICAL_YEAR_DAYS * SOLAR_DAY;  // s
        const REAL_ORBIT_RATE = 360 / TROPICAL_YEAR; // degrees per second, Earth around the Sun

        // In one solar day Earth spins 360 deg plus the angle it moved along its orbit.
        const SIDEREAL_DAY = 360 / (360 / SOLAR_DAY + REAL_ORBIT_RATE); // s
        const SPIN_RATE = 360 / SIDEREAL_DAY;        // degrees per second

        // Spin needed for the Sun to return to the same place in the sky.
        const SOLAR_DAY_ROTATION = 360 * SPIN_RATE / (SPIN_RATE - REAL_ORBIT_RATE); // deg
        const EXTRA_ROTATION_PER_DAY = SOLAR_DAY_ROTATION - 360;                     // deg

        const timeForRotation = (deg) => deg / SPIN_RATE;                  // s
        const orbitTravelDuring = (seconds) => REAL_ORBIT_RATE * seconds;  // deg
        return { D2R, SOLAR_DAY, TROPICAL_YEAR, REAL_ORBIT_RATE, SIDEREAL_DAY, SPIN_RATE, SOLAR_DAY_ROTATION, EXTRA_ROTATION_PER_DAY, timeForRotation, orbitTravelDuring };
    });
})(typeof window !== 'undefined' ? window : globalThis);
