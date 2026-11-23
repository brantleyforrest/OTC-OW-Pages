// tool-template-math.js
// REPLACE: this tool's own math, the formulas only this page uses. It joins OrbitMath as its own
// section, built from the constants the reader chose, like the shared sections in math/. If a
// second page comes to need it, move it to math/. Delete this file, and its line in index.html,
// if the tool needs no math of its own.
// No DOM. Load after the math/ files (math/index.js lists them in order).
(function (global) {
    'use strict';

    const OM = global.OrbitMath;
    if (!OM) throw new Error('tool-template-math.js: load math/common.js first');

    /* REPLACE: the section name (OrbitMath.toolTemplate) and its formulas ------------------------- */
    OM.define('toolTemplate', [], function (C, OC) {
        const MU = C.mu;
        // Period of a circular orbit of radius r km, s.
        const circularPeriod = (r) => 2 * Math.PI * Math.sqrt(r * r * r / MU);
        return { circularPeriod };
    });
})(typeof window !== 'undefined' ? window : globalThis);
