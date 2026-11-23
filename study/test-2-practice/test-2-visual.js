// Test 2 Practice: the motion names shared by the Visualize sections, and the number of revs every
// picture problem shows. No DOM access. Load after test-2-common.js.
(function (global) {
    'use strict';

    const REVS = 2;

    // The relative motions of the course table, with the names TestReviewMath.rpo.classifyMotion uses.
    const MOTIONS = [
        { value: 'perch', html: 'Perch' },
        { value: 'linear-drift', html: 'Drift' },
        { value: 'stationary-nmc', html: 'NMC' },
        { value: 'drifting-nmc', html: 'Drifting NMC' },
        { value: 'cross-track', html: 'Cross-track motion' },
        { value: 'drifting-cross-track', html: 'Snake' },
        { value: 'nmc-cross-track', html: 'Cross-Track NMC' },
        { value: 'corkscrew', html: 'Corkscrew' }
    ];
    const LABEL = Object.fromEntries(MOTIONS.map(m => [m.value, m.html]));
    // Which RMOEs each motion has: D a drift (x_C), E an ellipse (C), Z a side-to-side swing (z_max).
    const PARTS = {
        perch: '', 'linear-drift': 'D', 'stationary-nmc': 'E', 'drifting-nmc': 'DE',
        'cross-track': 'Z', 'drifting-cross-track': 'DZ', 'nmc-cross-track': 'EZ', corkscrew: 'DEZ'
    };
    const IN_PLANE = ['perch', 'linear-drift', 'stationary-nmc', 'drifting-nmc'];

    global.Test2Visual = { REVS, MOTIONS, LABEL, PARTS, IN_PLANE };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2Visual;
