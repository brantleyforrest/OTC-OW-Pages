// Turns TeX into page markup for the practice problems, using KaTeX. If KaTeX could not be
// loaded, each expression is shown as its TeX source, so that the numbers can still be read.
(function (global) {
    'use strict';

    const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Numbers are formatted for reading. TeX needs braces around a thousands comma, an ordinary
    // hyphen for a minus sign, and \circ for degrees.
    const toTex = (source) => source
        .replace(/−/g, '-')
        .replace(/(\d),(?=\d{3})/g, '$1{,}')
        .replace(/°/g, '^\\circ');

    function math(source) {
        const tex = toTex(source);
        if (!global.katex) return `<code class="tex-source">${escapeHtml(tex)}</code>`;
        return global.katex.renderToString(tex, { throwOnError: false });
    }

    // Text with math between dollar signs. The text may contain markup such as <b>.
    const prose = (text) => text.split('$').map((part, index) => (index % 2 ? math(part) : part)).join('');

    const column = (parts) => `\\begin{bmatrix}${parts.join('\\\\')}\\end{bmatrix}`;

    // One worked calculation: the symbols, any lines of substituted numbers, and the result.
    function calc(symbols, lines, result) {
        const row = (className, tex) => `<div class="${className}">${math(tex)}</div>`;
        const body = lines.map((line) => row('calc-line', `= ${line}`)).join('');
        const end = result ? row('calc-line calc-result', `= ${result}`) : '';
        return `<div class="calc">${row('calc-sym', symbols)}${body}${end}</div>`;
    }

    const note = (text) => `<p class="step-note">${prose(text)}</p>`;

    // A sentence of reasoning, with an optional conclusion below it.
    function rule(text, result) {
        const end = result ? `<div class="calc-line calc-result">${prose(result)}</div>` : '';
        return `<div class="calc"><div class="calc-sym">${prose(text)}</div>${end}</div>`;
    }

    global.PracticeMath = { math, prose, column, calc, note, rule };
})(window);
