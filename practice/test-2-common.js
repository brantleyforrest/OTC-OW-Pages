// Test 2 Practice: helpers shared by the problem modules (random picks, target orbits, number
// formats, and the givens table). No DOM access, so the modules also run in Node.
// Load as a classic script, after test-review-math.js and practice-math.js.
(function (global) {
    'use strict';

    const M = global.TestReviewMath.rpo;   // course relative-motion math

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

    /* ---------- Numeric answers ----------
     * Tolerances: distances and speeds 1 percent, with a floor of 0.02 km or 0.002 m/s; angles
     * within 1° on a circle. A field with allowUndefined takes the word 'undefined', which is right
     * only when the true value is null. */
    const TOL = {
        km: { relative: 0.01, floor: 0.02 },
        ms: { relative: 0.01, floor: 0.002 },
        deg: { absolute: 1, wrap: 360 },
        rate: { relative: 0.01, floor: 0.001 }
    };
    const LIMITS = 'Distances and speeds within 1 percent (at least 0.02 km or 0.002 m/s); angles within 1°. ' +
        'Tick <b>undefined</b> for an angle that has no value.';
    function parseNumber(text) {
        const s = String(text).trim().replace(/\s*(m\/s|km\/rev|km\/day|°\/rev|°\/day|deg\/rev|deg\/day)$/i, '');
        return global.AnswerCheck ? global.AnswerCheck.parseAnswer(s) : (Number.isFinite(Number(s)) && s !== '' ? Number(s) : null);
    }
    function gradeNumber(field, text, truth) {
        const s = String(text).trim();
        if (!s) return 'blank';
        if (s === 'undefined') return truth === null ? 'right' : 'wrong';
        if (truth === null) return 'wrong';
        const v = parseNumber(s);
        if (v === null) return 'invalid';
        const t = field.tolerance;
        const allowed = t.absolute !== undefined ? t.absolute : Math.max(Math.abs(truth) * t.relative, t.floor || 0);
        let gap = Math.abs(v - truth);
        if (t.wrap) { gap %= t.wrap; gap = Math.min(gap, t.wrap - gap); }
        return gap <= allowed + 1e-9 ? 'right' : 'wrong';
    }
    // Any field: picks and checks are equal-or-not; everything else is a number.
    function grade(field, text, truth) {
        if (['choice', 'plot', 'sign'].includes(field.unitType)) {
            if (!String(text).trim()) return 'blank';
            return String(text) === String(truth) ? 'right' : 'wrong';
        }
        return gradeNumber(field, text, truth);
    }

    // Field factories. tex is the symbol, name the words.
    const fKm = (key, tex, name) => ({ key, tex, name, unit: 'km', tolerance: TOL.km, unitType: 'dist' });
    const fMs = (key, tex, name) => ({ key, tex, name, unit: 'm/s', tolerance: TOL.ms, unitType: 'speed' });
    const fDeg = (key, tex, name, undef) => ({ key, tex, name, unit: '°', tolerance: TOL.deg, unitType: 'angle', allowUndefined: Boolean(undef) });
    const STATE_FIELDS = () => [
        fKm('x', 'x', 'Radial position'), fKm('y', 'y', 'In-track position'), fKm('z', 'z', 'Cross-track position'),
        fMs('vx', '\\dot x', 'Radial rate'), fMs('vy', '\\dot y', 'In-track rate'), fMs('vz', '\\dot z', 'Cross-track rate')
    ];
    const RMOE_FIELDS = () => [
        fKm('xc', 'x_C', 'NMC center, radial'), fKm('yc0', 'y_{C0}', 'NMC center, in-track'), fKm('C', 'C', 'NMC size'),
        fDeg('M0', 'M_0', 'Place on the NMC', true), fKm('zmax', 'z_{max}', 'Cross-track size'), fDeg('dM0', '\\Delta M_0', 'Place in the swing', true)
    ];
    // Answers: a number with its text, or undefined.
    const ansKm = v => ({ value: v, text: fixed(v, 3) + ' km' });
    const ansMs = vKmPerSec => ({ value: vKmPerSec * 1000, text: fixed(vKmPerSec * 1000, 4) + ' m/s' });
    const ansDeg = v => (v === null ? { value: null, text: 'undefined' } : { value: v, text: fixed(v, 1) + '°' });
    function stateAnswers(s) {
        return { x: ansKm(s[0]), y: ansKm(s[1]), z: ansKm(s[2]), vx: ansMs(s[3]), vy: ansMs(s[4]), vz: ansMs(s[5]) };
    }
    function rmoeAnswers(r) {
        return { xc: ansKm(r.xc), yc0: ansKm(r.yc0), C: ansKm(r.C), M0: ansDeg(r.M0), zmax: ansKm(r.zmax), dM0: ansDeg(r.dM0) };
    }

    // Givens. A row of name = value items.
    // Math is rendered here (PracticeMath is looked up when called, so Node can load this file first).
    const proseOf = text => (global.PracticeMath ? global.PracticeMath.prose(text) : text);
    const givenItem = (texLhs, valueText, unit) => '<div class="given-item">' + proseOf('$' + texLhs + ' = ' + texNum(valueText) + '$') + (unit ? ' ' + unit : '') + '</div>';
    function givenState(s) {
        return [givenItem('x_0', km(s[0]), 'km'), givenItem('y_0', km(s[1]), 'km'), givenItem('z_0', km(s[2]), 'km'),
            givenItem('\\dot x_0', ms(s[3]), 'm/s'), givenItem('\\dot y_0', ms(s[4]), 'm/s'), givenItem('\\dot z_0', ms(s[5]), 'm/s')].join('');
    }
    function givenRmoe(r) {
        const ang = v => (v === null ? '\\text{undefined}' : fixed(v, 0) + '°');
        return [givenItem('x_C', plain(r.xc, 3), 'km'), givenItem('y_{C0}', plain(r.yc0, 3), 'km'), givenItem('C', plain(r.C, 3), 'km'),
            '<div class="given-item">' + proseOf('$M_0 = ' + ang(r.M0) + '$') + '</div>', givenItem('z_{max}', plain(r.zmax, 3), 'km'),
            '<div class="given-item">' + proseOf('$\\Delta M_0 = ' + ang(r.dM0) + '$') + '</div>'].join('');
    }

    // Round values to pick an answer from.
    const halfKm = (lo, hi) => stepIn(lo, hi, 0.5);
    // Distance sizes for each kind of target: [largest center offset, largest C or z_max, largest in-track].
    function sizesFor(a) {
        if (a > 40000) return { xc: 5, C: 10, y: 40 };
        if (a > 20000) return { xc: 4, C: 8, y: 30 };
        return { xc: 2, C: 4, y: 15 };
    }

    // Where chase is on the NMC and in the swing, in words, for an angle that is a multiple of 90.
    const CORNER = ['bottom', 'front', 'top', 'back'];
    const SWING = ['positive plane crossing (+P.C.)', 'far left', 'negative plane crossing (−P.C.)', 'far right'];
    const cornerName = M0 => (M0 === null ? null : Math.abs(M0 / 90 - Math.round(M0 / 90)) < 1e-6 ? CORNER[Math.round(M0 / 90) % 4] : null);
    const swingName = d => (d === null ? null : Math.abs(d / 90 - Math.round(d / 90)) < 1e-6 ? SWING[Math.round(d / 90) % 4] : null);

    // One plain sentence that reads a set of RMOEs, such as "Chase is at the front of a drifting
    // NMC centered 2 km above and 4 km ahead of the target, moving backward about 19 km each rev."
    function reading(r, n, a) {
        const eps = 1e-6;
        const D = Math.abs(r.xc) > eps, E = r.C > eps, Z = r.zmax > eps;
        const parts = [];
        if (Math.abs(r.xc) > eps) parts.push(plain(Math.abs(r.xc), 2) + ' km ' + (r.xc > 0 ? 'above' : 'below'));
        if (Math.abs(r.yc0) > eps) parts.push(plain(Math.abs(r.yc0), 2) + ' km ' + (r.yc0 > 0 ? 'ahead of' : 'behind'));
        const centerText = parts.length ? 'centered ' + parts.join(' and ') + ' the target' : 'centered on the target';
        let text;
        const drift = M.driftRate(r, n, a).kmPerRev;
        const driftText = D ? ', moving ' + (drift < 0 ? 'backward' : 'forward') + ' about ' + plain(Math.abs(drift), 1) + ' km each rev' : '';
        if (E) {
            const corner = cornerName(r.M0);
            text = 'Chase is ' + (corner ? 'at the ' + corner + ' of ' : 'on ') + 'a' + (D ? ' drifting' : '') + ' NMC ' + plain(2 * r.C, 2) + ' km tall and ' +
                plain(4 * r.C, 2) + ' km long, ' + centerText + driftText;
        } else if (D) {
            text = 'Chase drifts ' + (drift < 0 ? 'backward' : 'forward') + ' about ' + plain(Math.abs(drift), 1) + ' km each rev, ' + plain(Math.abs(r.xc), 2) + ' km ' +
                (r.xc > 0 ? 'above' : 'below') + ' the target, now ' + plain(Math.abs(r.yc0), 2) + ' km ' + (r.yc0 >= 0 ? 'ahead' : 'behind');
        } else if (Math.abs(r.yc0) > eps) {
            text = 'Chase is perched ' + plain(Math.abs(r.yc0), 2) + ' km ' + (r.yc0 > 0 ? 'ahead of' : 'behind') + ' the target';
        } else text = 'Chase is at the target';
        if (Z) {
            const sw = swingName(r.dM0);
            text += ', and swings ' + plain(r.zmax, 2) + ' km to each side of the target’s plane' + (sw ? ' (now at its ' + sw + ')' : '');
        }
        return text + '.';
    }

    global.Test2Common = {
        M, pick, chance, randInt, stepIn, sign, shuffle, pickTargetA, orbitName, fixed, km, ms, deg, plain, texNum,
        TOL, LIMITS, gradeNumber, grade, fKm, fMs, fDeg, STATE_FIELDS, RMOE_FIELDS, ansKm, ansMs, ansDeg, stateAnswers, rmoeAnswers,
        givenItem, givenState, givenRmoe, halfKm, sizesFor, cornerName, swingName, reading
    };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2Common;
