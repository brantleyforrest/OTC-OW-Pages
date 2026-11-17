// Test 2 Practice: helpers shared by the problem modules (random picks, target orbits, number
// formats, and the givens table). No DOM access, so the modules also run in Node.
// Load as a classic script, after rpo/rpo-math.js and practice-math.js.
(function (global) {
    'use strict';

    const M = global.RpoMath;

    const pick = list => list[Math.floor(Math.random() * list.length)];
    const chance = p => Math.random() < p;
    const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
    // A whole number of steps of size step from lo to hi, both included.
    const stepIn = (lo, hi, step) => lo + step * randInt(0, Math.round((hi - lo) / step));
    const sign = () => (chance(0.5) ? 1 : -1);
    function shuffle(list) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    // Target orbits: GEO 60 percent of the time, otherwise one of the other examples.
    const OTHER_A = [6517.16, 6750, 6900, 7000, 26562];
    function pickTargetA() { return chance(0.6) ? M.GEO_A : pick(OTHER_A); }
    function orbitName(a) {
        if (Math.abs(a - M.GEO_A) < 1) return 'GEO';
        if (Math.abs(a - 26562) < 1) return 'MEO';
        return 'LEO';
    }

    // Number text. Trailing zeros are kept, so that every given has the same look.
    const fixed = (v, d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
    const km = (v, d = 4) => fixed(v, d);
    const ms = (vKmPerSec, d = 6) => fixed(vKmPerSec * 1000, d);
    const deg = (v, d = 1) => fixed(v, d);
    // A plain number with no needless zeros, for elements such as 42164 or 0.0003.
    const plain = (v, d = 6) => String(Number(v.toFixed(d)));
    // TeX for a signed number, with a true minus sign.
    const texNum = text => String(text).replace(/^-/, '−');

    global.Test2Common = { M, pick, chance, randInt, stepIn, sign, shuffle, pickTargetA, orbitName, fixed, km, ms, deg, plain, texNum };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2Common;
