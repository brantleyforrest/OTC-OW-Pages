// common.js
// The math every other file builds on, and the plumbing that lets the reader switch constant sets.
//
//   vec      3-vector helpers (dot, cross, norm, unit, add, sub, scale)
//   angles   degree and radian conversions and wrapping
//   kepler   Kepler's equation
//   define, build, bind, useConstants: every section, shared or page-specific, is built from one
//            constant set; the sections on OrbitMath follow the set the reader chose
//            (OrbitConstants.Settings) and change when the choice does, so pages read them as
//            OrbitMath.<section> after every settings change.
//
// The shared math is in the files beside this one (math/index.js lists them in load order). Math
// that only one page uses lives in that page's folder, in <page>-math.js, and joins OrbitMath the
// same way.
// Units: km, km/s, s and radians inside; names say otherwise (deg, Days, ...).
// No DOM. Works in the browser (window.OrbitMath) and in Node (math/index.js).
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC || !OC.Settings) throw new Error('common.js: load math/constants/*.js, math/motion/solvers.js and math/settings.js first');

    // The start time pages use when none is set: the computer clock, read once when this file loads.
    const LOAD_TIME_MS = Date.now();

    /* Sections ---------------------------------------------------------------------------------- */
    // A section is a set of formulas built from one constant set C. define(name, deps, factory)
    // adds one: factory(C, OC, ...the sections named in deps) returns it. Every file in math/ and
    // each page's own math file calls define once per section, after the files it depends on.
    const entries = [];
    const SECTION_NAMES = [];
    const cache = new Map();        // one built copy of every section per constant set
    let active = null;              // the copy for the constants the reader chose

    const addTo = (S, e) => { S[e.name] = e.factory(S.constants, OC, ...e.deps.map((d) => S[d])); };

    function define(name, deps, factory) {
        if (OrbitMath[name] !== undefined || SECTION_NAMES.includes(name)) throw new Error(`OrbitMath: section "${name}" is already defined`);
        for (const d of deps) {
            if (!SECTION_NAMES.includes(d)) throw new Error(`OrbitMath: section "${name}" needs "${d}"; load the file that defines it first`);
        }
        const e = { name, deps, factory };
        entries.push(e);
        SECTION_NAMES.push(name);
        for (const S of cache.values()) addTo(S, e);
        if (active) OrbitMath[name] = active[name];
    }

    // Every section defined so far, bound to one constant set C (course or WGS-84, see
    // math/constants). bind(C) does the same but keeps one copy per set.
    function build(constants) {
        const C = Object.freeze({ ...OC.SETS.course, ...constants });
        const S = { constants: C };
        for (const e of entries) addTo(S, e);
        return S;
    }
    function bind(constants) {
        const key = JSON.stringify({ ...OC.SETS.course, ...constants });
        if (!cache.has(key)) cache.set(key, build(constants));
        return cache.get(key);
    }

    const OrbitMath = { OC, LOAD_TIME_MS, SECTION_NAMES, define, build, bind };

    // Points OrbitMath's sections at a constant set: an id from OrbitConstants.SETS or a set object.
    function useConstants(set) {
        const C = typeof set === 'string' ? OC.SETS[set] : set;
        if (!C) throw new Error(`Unknown constant set "${set}". Choices: ${Object.keys(OC.SETS).join(', ')}`);
        active = bind(C);
        OrbitMath.constants = active.constants;
        for (const name of SECTION_NAMES) OrbitMath[name] = active[name];
        return active;
    }
    OrbitMath.useConstants = useConstants;

    /* 3-vectors ------------------------------------------------------------------------------ */
    define('vec', [], function () {
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const cross = (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
        const norm = (a) => Math.hypot(a[0], a[1], a[2]);
        const unit = (a) => { const m = norm(a); return [a[0] / m, a[1] / m, a[2] / m]; };
        const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
        return { dot, cross, norm, unit, add, sub, scale };
    });

    /* Angles ------------------------------------------------------------------------------------- */
    define('angles', [], function () {
        const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;
        // Degrees to [0, 360).
        function wrap360(deg) {
            const w = ((deg % 360) + 360) % 360;
            return w === 360 ? 0 : w;
        }
        // Degrees to (-180, 180].
        function wrap180(deg) {
            const w = wrap360(deg);
            return w > 180 ? w - 360 : w;
        }
        // Radians to (-pi, pi].
        function wrapPi(rad) {
            let w = rad % TWO_PI;
            if (w > Math.PI) w -= TWO_PI;
            if (w <= -Math.PI) w += TWO_PI;
            return w;
        }
        return { D2R, R2D, TWO_PI, wrap360, wrap180, wrapPi };
    });

    /* Kepler's equation ----------------------------------------------------------------------- */
    define('kepler', ['angles'], function (C, OC, A) {
        const wrapPi = A.wrapPi;
        // Eccentric anomaly E for mean anomaly M (radians, any size), 0 <= e < 1. Newton's method
        // on M wrapped to (-pi, pi], started at pi for e >= 0.8; the turns removed are added back,
        // so E keeps M's revolution count.
        function solve(M, e) {
            const m = wrapPi(M);
            let E = e >= 0.8 ? Math.PI * (m < 0 ? -1 : 1) : m + e * Math.sin(m);
            for (let k = 0; k < 30; k++) {
                const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
                E -= step;
                if (Math.abs(step) < 1e-13) break;
            }
            return E + (M - m);
        }
        const trueFromEccentric = (E, e) => 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        return { solve, trueFromEccentric, wrapPi };
    });

    useConstants(OC.Settings.active());
    // Registered before any page's listener, so pages see the new sections when they are told.
    OC.Settings.onChange((settings, changed) => {
        if (changed.includes('constants')) useConstants(OC.Settings.active());
    });

    global.OrbitMath = OrbitMath;
})(typeof window !== 'undefined' ? window : globalThis);
