// practice-common.js
// The math Test 1 and Test 2 Practice both use, written as the course teaches it, and the plumbing
// that holds the rest. Each practice page keeps its own math in its folder
// (study/test-1-practice/test-1-practice-math.js, study/test-2-practice/test-2-practice-math.js).
// The practice math has its own copy of every equation and never calls OrbitMath, so the tests can
// check the two against each other; it ignores the site's settings (constants, propagator, RIC
// model) and always uses the course constants.
//
//   vec      3-vector helpers
//   kepler   Kepler's equation
//   define(name, deps, factory): adds a section; factory(C, OC, ...the sections named in deps)
//            returns it. The sections on TestReviewMath are built from the course constants.
//            build(C) and bind(C) build every section from another set, for the tests that
//            compare the two files under both sets.
//
// No DOM. Works in the browser (window.TestReviewMath) and in Node. Load after the constant files
// and math/settings.js.
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC || !OC.SETS.course) throw new Error('practice-common.js: load math/constants/*.js first');

    const entries = [];
    const SECTION_NAMES = [];
    const cache = new Map();        // one built copy of every section per constant set

    const addTo = (S, e) => { S[e.name] = e.factory(S.constants, OC, ...e.deps.map((d) => S[d])); };

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

    // Practice always uses the course constants, whatever the site's settings say.
    const COURSE = bind(OC.SETS.course);
    const TestReviewMath = { OC, constants: COURSE.constants, SECTION_NAMES, define, build, bind };

    function define(name, deps, factory) {
        if (TestReviewMath[name] !== undefined || SECTION_NAMES.includes(name)) throw new Error(`TestReviewMath: section "${name}" is already defined`);
        for (const d of deps) {
            if (!SECTION_NAMES.includes(d)) throw new Error(`TestReviewMath: section "${name}" needs "${d}"; load the file that defines it first`);
        }
        const e = { name, deps, factory };
        entries.push(e);
        SECTION_NAMES.push(name);
        for (const S of cache.values()) addTo(S, e);
        TestReviewMath[name] = COURSE[name];
    }

    /* 3-vectors ------------------------------------------------------------------------------ */
    define('vec', [], function () {
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const norm = (a) => Math.hypot(a[0], a[1], a[2]);
        const unit = (a) => { const m = norm(a); return [a[0] / m, a[1] / m, a[2] / m]; };
        const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
        const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
        return { dot, cross, norm, unit, add, sub, scale };
    });

    /* Kepler's equation ----------------------------------------------------------------------- */
    define('kepler', [], function () {
        const TWO_PI = 2 * Math.PI;
        function wrapPi(rad) {
            let w = rad % TWO_PI;
            if (w > Math.PI) w -= TWO_PI;
            if (w <= -Math.PI) w += TWO_PI;
            return w;
        }
        // E for mean anomaly M (any size), 0 <= e < 1, by Newton's method on M wrapped to (-pi, pi];
        // the turns removed are added back.
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
        return { solve, wrapPi };
    });

    global.TestReviewMath = TestReviewMath;
})(typeof window !== 'undefined' ? window : globalThis);
