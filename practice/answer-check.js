// Reads typed answers and decides whether each is close enough. Shared by every practice
// problem type. Load as a classic script, so that the page runs from a local file.
(function (global) {
    'use strict';

    // Returns the number in a typed answer, or null if there is none. Accepts forms such as
    // 7466, 7,466.2, 7.466e3, 7.466 x 10^3, .0625, 45°, 45 deg, and 7466 km.
    function parseAnswer(text) {
        let s = String(text).trim().toLowerCase();
        if (!s) return null;
        s = s.replace(/[−–]/g, '-')
            .replace(/(km\/s|km|degrees|degree|deg|°)\s*$/, '')
            .replace(/\s+/g, '');

        // A comma before exactly three digits separates thousands. Any other comma is a decimal point.
        if (/^[-+]?\d{1,3}(,\d{3})+(?!\d)/.test(s)) s = s.replace(/,/g, '');
        else s = s.replace(',', '.');

        s = s.replace(/[x×*]10(\^|\*\*)?/, 'e');
        if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
        const value = Number(s);
        return Number.isFinite(value) ? value : null;
    }

    // wrap: the size of a full circle, for an angle where 360 is the same as 0.
    function difference(value, truth, wrap) {
        const gap = Math.abs(value - truth);
        if (!wrap) return gap;
        const remainder = gap % wrap;
        return Math.min(remainder, wrap - remainder);
    }

    // tolerance: { relative: fraction of the true value } or { absolute: amount }, with an
    // optional wrap. The small extra amount keeps a value exactly on the limit from failing
    // because of floating-point error.
    function isAccepted(tolerance, value, truth) {
        const allowed = tolerance.relative ? Math.abs(truth) * tolerance.relative : tolerance.absolute;
        return difference(value, truth, tolerance.wrap) <= allowed + 1e-9;
    }

    // Returns 'blank', 'invalid', 'right', or 'wrong'.
    function grade(tolerance, text, truth) {
        if (!String(text).trim()) return 'blank';
        const value = parseAnswer(text);
        if (value === null) return 'invalid';
        return isAccepted(tolerance, value, truth) ? 'right' : 'wrong';
    }

    global.AnswerCheck = { parseAnswer, isAccepted, grade };
})(window);
