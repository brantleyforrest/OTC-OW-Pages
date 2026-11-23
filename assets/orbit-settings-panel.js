// orbit-settings-panel.js
// The Model badge in the top bar and the settings panel it opens: which constants the tools use,
// Reset, and Share. Display only: the choices live in OrbitConstants.Settings and the math reads
// them; this file only shows them and changes them.
//
// A tool page tells the panel how to redraw and how to save and restore its own options:
//   OrbitSettingsPanel.registerPage({
//       onSettingsChange(settings, changedKeys) { ... },   // re-read OrbitMath and redraw
//       getShareState() { return {...} },                    // optional; default: every input
//       applyShareState(obj) { ... }                         // optional; default: every input
//   });
// Share copies a link holding the settings, the start time and the page's options. Opening it
// applies them for that visit only and cleans the address bar; nothing is saved until the reader
// presses "Keep these settings".
//
// On the practice pages (no OrbitMath loaded) the panel is shown greyed out: practice always uses
// the course material. The home page has its own Settings button in the nav bar, marked
// data-orbit-settings; the panel opens from it and changes the settings every tool reads.
// Works in the browser (window.OrbitSettingsPanel); the link encoding also loads in Node for tests.
(function (global) {
    'use strict';

    const PARAM = 's';          // the address-bar parameter a shared link uses
    const VERSION = 1;          // bump when the payload changes; older links then fall back

    /* Link encoding: URL-safe base64 of JSON --------------------------------------------------- */
    function toBase64Url(text) {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function fromBase64Url(text) {
        let b = String(text).replace(/-/g, '+').replace(/_/g, '/');
        while (b.length % 4) b += '=';
        const bin = atob(b);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }
    function encodeShare(settings, pageState) {
        return toBase64Url(JSON.stringify({ v: VERSION, s: settings, p: pageState || null }));
    }
    // Returns { settings, page } or throws when the link is damaged or from another version.
    function decodeShare(text) {
        const obj = JSON.parse(fromBase64Url(text));
        if (!obj || typeof obj !== 'object' || obj.v !== VERSION) throw new Error('unknown link version');
        return { settings: obj.s && typeof obj.s === 'object' ? obj.s : {}, page: obj.p && typeof obj.p === 'object' ? obj.p : null };
    }

    const api = { PARAM, VERSION, encodeShare, decodeShare };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;   // Node: the encoding only

    const OC = global.OrbitConstants;
    if (!OC) throw new Error('orbit-settings-panel.js: load math/settings.js first');
    const S = OC.Settings;
    // The home page's Settings button. With it, the panel sets the site's settings with no tool open.
    const SITE_BUTTON = document.querySelector('[data-orbit-settings]');
    const PRACTICE = !global.OrbitMath && !SITE_BUTTON;
    const PRACTICE_NOTE = 'Test 1 and Test 2 Practice always use the course material: course constants, two-body motion, and CW.';
    const SITE_NOTE = 'These settings apply to every tool and are kept in this browser. ' + PRACTICE_NOTE;

    /* Number display -------------------------------------------------------------------------- */
    const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
    function sci(x) {
        if (x === undefined) return '';
        if (Math.abs(x) >= 1e-2 && Math.abs(x) < 1e7) return String(x);
        const [m, e] = x.toExponential().split('e');
        return `${m} × 10${String(Number(e)).split('').map((c) => SUP[c]).join('')}`;
    }
    function setLine(set) {
        return [
            `μ = ${sci(set.mu)} km³/s²`,
            `R⊕ = ${sci(set.re)} km`,
            `J₂ = ${sci(set.J2)}`,
            `ω⊕ = ${sci(set.omegaE)} rad/s`,
            `g₀ = ${sci(set.g0)} m/s²`
        ].join(' · ');
    }

    /* Motion choices --------------------------------------------------------------------------- */
    const FORCES = [
        ['j2', 'J₂', 'Earth’s oblateness'],
        ['j34', 'J₃ and J₄', 'the next zonal terms (pear shape)'],
        ['j22', 'J₂,₂', 'the equator’s slight ellipse, turning with Earth'],
        ['drag', 'Drag', 'the upper atmosphere'],
        ['sun', 'Sun', 'the Sun’s gravity'],
        ['moon', 'Moon', 'the Moon’s gravity'],
        ['srp', 'Solar radiation pressure', 'sunlight pushing on the spacecraft']
    ];
    // Forces that depend on the date: Earth's turn (J₂,₂), the Sun and the Moon.
    const TIME_FORCES = ['j22', 'sun', 'moon', 'srp'];
    const SOLAR_LEVELS = { min: 'Solar minimum', mean: 'Average', max: 'Solar maximum' };
    const loadTimeMs = () => (global.OrbitMath ? global.OrbitMath.LOAD_TIME_MS : Date.now());
    // The start time as the datetime-local field shows it, in UTC.
    const toField = (ms) => new Date(ms).toISOString().slice(0, 16);
    const fromField = (text) => Date.parse(text + 'Z');

    /* Page options, unless the page says otherwise: every segmented button group (an element with an
       id holding buttons with data-value, the pressed one marked aria-pressed="true"), and every
       input, select and text area with an id. Groups are applied first, since a mode or preset can
       reset the inputs. */
    function pageControls() {
        return Array.from(document.querySelectorAll('main input[id], main select[id], main textarea[id]'))
            .filter((el) => !el.closest('.orbit-settings') && el.type !== 'file' && el.type !== 'password');
    }
    function pageGroups() {
        return Array.from(document.querySelectorAll('main [id]'))
            .filter((el) => !el.closest('.orbit-settings') && el.querySelector(':scope > button[data-value]'));
    }
    function genericState() {
        const inputs = {}, groups = {};
        for (const el of pageGroups()) {
            const on = el.querySelector(':scope > button[data-value][aria-pressed="true"]');
            if (on) groups[el.id] = on.dataset.value;
        }
        for (const el of pageControls()) inputs[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
        return { groups, inputs };
    }
    function applyGenericState(state) {
        if (!state) return;
        const groups = state.groups || {};
        for (const el of pageGroups()) {
            if (!(el.id in groups)) continue;
            const button = Array.from(el.querySelectorAll(':scope > button[data-value]')).find((b) => b.dataset.value === String(groups[el.id]));
            if (button && !button.disabled && button.getAttribute('aria-pressed') !== 'true') button.click();
        }
        const obj = state.inputs || {};
        for (const el of pageControls()) {
            if (!(el.id in obj) || el.disabled) continue;
            const v = obj[el.id];
            if (el.type === 'checkbox' || el.type === 'radio') {
                if (el.checked === (v === true)) continue;
                el.checked = v === true;
            } else {
                if (el.value === String(v)) continue;
                el.value = String(v);
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /* A shared link in the address bar ---------------------------------------------------------- */
    let linkState = null;        // null, 'shared' or 'bad'
    let pendingPage = null;
    (function readLink() {
        let params;
        try { params = new URLSearchParams(global.location.search); } catch (err) { return; }
        const raw = params.get(PARAM);
        if (raw === null) return;
        try {
            const { settings, page } = decodeShare(raw);
            if (!PRACTICE) S.useShared(settings);
            pendingPage = page;
            linkState = 'shared';
        } catch (err) {
            linkState = 'bad';
        }
        params.delete(PARAM);
        const query = params.toString();
        try {
            global.history.replaceState(global.history.state, '', global.location.pathname + (query ? `?${query}` : '') + global.location.hash);
        } catch (err) { /* the address keeps the link; harmless */ }
    })();

    let page = null;
    // A page registers: onSettingsChange, getShareState and applyShareState (share links),
    // usesStartTime() (true when the page itself shows the start date), modelNote (shown with
    // Cowell, for a page whose readouts are formulas that Cowell does not change).
    function registerPage(p) {
        page = p || {};
        applyPending();
        if (typeof render === 'function') render();
    }

    function applyPending() {
        if (!pendingPage) return;
        const st = pendingPage;
        pendingPage = null;
        try {
            if (page && page.applyShareState) page.applyShareState(st);
            else applyGenericState(st);
        } catch (err) {
            console.error(err);
            toast('Some of the shared page options could not be applied.');
        }
    }
    // A page that never registers still gets its inputs back once everything has loaded.
    global.addEventListener('load', () => { if (!page) applyPending(); });

    /* Badge and panel --------------------------------------------------------------------------- */
    function summary(s) {
        if (PRACTICE) return 'Course material';
        return [OC.SETS[s.constants].name, s.propagator === 'cowell' ? 'Cowell' : 'Kepler', s.ricModel === 'exact' ? 'Exact RIC' : 'CW'].join(' · ');
    }

    // Every page has the badge in its own top bar, so the bar is drawn whole before any script
    // runs. Its label stays "Settings" so the badge keeps one size on every page; the current
    // settings show in its tooltip and in the panel. A page without one gets one made here.
    const STATIC_BADGE = SITE_BUTTON || document.querySelector('.nav-inner > .model-badge');
    const badge = STATIC_BADGE || document.createElement('button');
    badge.setAttribute('aria-haspopup', 'dialog');
    if (STATIC_BADGE) {
        badge.insertAdjacentHTML('beforeend', '<span class="model-badge-dot" hidden></span>');
    } else {
    badge.type = 'button';
    badge.className = 'model-badge';
    badge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>' +
        '<span class="model-badge-text">Settings</span><span class="model-badge-dot" hidden></span>';
    }
    const badgeDot = badge.querySelector('.model-badge-dot');

    const overlay = document.createElement('div');
    overlay.className = 'orbit-settings';
    overlay.hidden = true;
    const setChoices = Object.values(OC.SETS).map((set) => `
                <label class="orbit-settings-choice">
                    <input type="radio" name="orbit-constants" value="${set.id}">
                    <span><span class="orbit-settings-choice-name">${set.name}</span>
                    <span class="orbit-settings-choice-detail">${setLine(set)}</span></span>
                </label>`).join('');
    overlay.innerHTML = `
        <div class="orbit-settings-card" role="dialog" aria-modal="true" aria-labelledby="orbit-settings-title">
            <div class="orbit-settings-head">
                <h2 id="orbit-settings-title">Settings</h2>
                <button type="button" class="orbit-settings-close" aria-label="Close">×</button>
            </div>
            <div class="orbit-settings-note practice" ${PRACTICE ? '' : 'hidden'}>${PRACTICE_NOTE}</div>
            <div class="orbit-settings-note site" ${SITE_BUTTON ? '' : 'hidden'}>${SITE_NOTE}</div>
            <div class="orbit-settings-note shared" hidden>
                <span>Opened from a shared link. These settings apply to this visit only.</span>
                <button type="button" class="btn orbit-settings-keep">Keep these settings</button>
            </div>
            <div class="orbit-settings-note bad" hidden>This shared link could not be read, so the page opened with your own settings.</div>
            <fieldset class="orbit-settings-group" ${PRACTICE ? 'disabled' : ''}>
                <legend>Constants</legend>
                ${setChoices}
            </fieldset>
            <fieldset class="orbit-settings-group orbit-settings-motion" ${PRACTICE ? 'disabled' : ''}>
                <legend>Motion</legend>
                <label class="orbit-settings-choice">
                    <input type="radio" name="orbit-propagator" value="kepler">
                    <span><span class="orbit-settings-choice-name">Kepler (two-body)</span>
                    <span class="orbit-settings-choice-detail">Exact motion around a point-mass Earth, as the course teaches.</span></span>
                </label>
                <label class="orbit-settings-choice">
                    <input type="radio" name="orbit-propagator" value="cowell">
                    <span><span class="orbit-settings-choice-name">Cowell (numerical)</span>
                    <span class="orbit-settings-choice-detail">Integrates the motion step by step, with the forces chosen below.</span></span>
                </label>
                <div class="orbit-settings-sub">
                    <label class="orbit-settings-row" for="orbit-settings-solver">Solver
                        <select id="orbit-settings-solver">${OC.SOLVER_IDS.map((id) => `<option value="${id}">${OC.SOLVERS[id].name}</option>`).join('')}</select>
                    </label>
                    <div class="orbit-settings-forces">
                        ${FORCES.map(([id, name, what]) => `<label class="orbit-settings-check"><input type="checkbox" data-force="${id}"> <span><b>${name}</b> <span class="orbit-settings-muted">${what}</span></span></label>`).join('')}
                    </div>
                    <p class="orbit-settings-why cowell-why">Solver and forces apply to Cowell only.</p>
                </div>
                <div class="orbit-settings-sub orbit-settings-time">
                    <div class="orbit-settings-row">
                        <label for="orbit-settings-start">Start date and time (UTC)</label>
                        <span class="orbit-settings-time-input">
                            <input type="datetime-local" id="orbit-settings-start" step="60">
                            <button type="button" class="btn orbit-settings-now">Now</button>
                        </span>
                    </div>
                    <p class="orbit-settings-why time-why"></p>
                </div>
                <div class="orbit-settings-sub orbit-settings-craft" hidden>
                    <div class="orbit-settings-muted">Spacecraft (every satellite on this page; for this visit only)</div>
                    <div class="orbit-settings-craft-grid">
                        <label><span>Drag coefficient, C<sub>D</sub></span><input type="number" id="orbit-settings-cd" min="0.5" max="5" step="0.1"></label>
                        <label><span>Reflectivity, C<sub>R</sub></span><input type="number" id="orbit-settings-cr" min="1" max="2" step="0.05"></label>
                        <label><span>Area to mass (m²/kg)</span><input type="number" id="orbit-settings-am" min="0.0001" max="1" step="0.001"></label>
                        <label><span>Solar activity</span><select id="orbit-settings-solar">${Object.entries(SOLAR_LEVELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                    </div>
                </div>
                <p class="orbit-settings-pagenote" hidden></p>
            </fieldset>
            <fieldset class="orbit-settings-group orbit-settings-ric" ${PRACTICE ? 'disabled' : ''}>
                <legend>Relative motion (RIC)</legend>
                <label class="orbit-settings-choice">
                    <input type="radio" name="orbit-ric-model" value="cw">
                    <span><span class="orbit-settings-choice-name">CW (linear)</span>
                    <span class="orbit-settings-choice-detail">The Clohessy-Wiltshire equations and RMOEs, as the course teaches. Good for a few km.</span></span>
                </label>
                <label class="orbit-settings-choice">
                    <input type="radio" name="orbit-ric-model" value="exact">
                    <span><span class="orbit-settings-choice-name">Exact difference</span>
                    <span class="orbit-settings-choice-detail">Both spacecraft fly their own orbits (with the Motion settings above); the chase's offset is read in the target's axes.</span></span>
                </label>
                <div class="orbit-settings-sub">
                    <div class="orbit-settings-row">
                        <span>Axes</span>
                        <span class="orbit-settings-time-input">
                            <label class="orbit-settings-check"><input type="radio" name="orbit-ric-axes" value="rectilinear"> <span>Rectilinear</span></label>
                            <label class="orbit-settings-check"><input type="radio" name="orbit-ric-axes" value="curvilinear"> <span>Curvilinear</span></label>
                        </span>
                    </div>
                    <label class="orbit-settings-check"><input type="checkbox" id="orbit-settings-cw-overlay"> <span>Show the CW path too, and the gap between them</span></label>
                    <p class="orbit-settings-why ric-why">Axes and the CW overlay apply to the exact model only. Curvilinear: y is the arc along the target's orbit, not a straight line.</p>
                </div>
            </fieldset>
            <div class="orbit-settings-foot">
                <button type="button" class="btn orbit-settings-reset" ${PRACTICE ? 'disabled' : ''}>Reset to defaults</button>
                <button type="button" class="btn primary orbit-settings-share" ${PRACTICE ? 'disabled' : ''} ${SITE_BUTTON ? 'hidden' : ''}>Copy share link</button>
            </div>
            <div class="orbit-settings-link" hidden>
                <label for="orbit-settings-link-text">Copy this link:</label>
                <input type="text" id="orbit-settings-link-text" readonly>
            </div>
            <div class="orbit-settings-status" aria-live="polite"></div>
        </div>`;
    const q = (sel) => overlay.querySelector(sel);
    const card = q('.orbit-settings-card');
    const statusEl = q('.orbit-settings-status');

    function render() {
        const s = S.get();
        badge.title = PRACTICE ? PRACTICE_NOTE : `Settings: ${summary(s)}`;
        badge.classList.toggle('practice', PRACTICE);
        badgeDot.hidden = PRACTICE || !(S.isShared() || !S.isDefault());
        const shown = PRACTICE ? 'course' : s.constants;   // practice always uses the course set
        for (const r of overlay.querySelectorAll('input[name="orbit-constants"]')) r.checked = r.value === shown;
        // Motion: practice always shows the course model (Kepler, no forces).
        const cowell = !PRACTICE && s.propagator === 'cowell';
        for (const r of overlay.querySelectorAll('input[name="orbit-propagator"]')) r.checked = r.value === (cowell ? 'cowell' : 'kepler');
        const solver = q('#orbit-settings-solver');
        solver.value = s.solver;
        solver.disabled = !cowell;
        for (const box of overlay.querySelectorAll('input[data-force]')) {
            box.checked = !PRACTICE && s.forces[box.dataset.force];
            box.disabled = !cowell;
        }
        q('.cowell-why').hidden = cowell;
        const timeForces = cowell && TIME_FORCES.some((id) => s.forces[id]);
        const pageTime = !!(page && page.usesStartTime && page.usesStartTime());
        const timeOn = !PRACTICE && (timeForces || pageTime);
        const start = q('#orbit-settings-start');
        if (document.activeElement !== start) start.value = toField(s.startMs === null ? loadTimeMs() : s.startMs);
        start.disabled = !timeOn;
        q('.orbit-settings-now').disabled = !timeOn;
        q('.time-why').textContent = timeOn
            ? (s.startMs === null ? 'The computer’s clock when the page opened.' : 'Set for this visit; a new visit starts at the computer’s clock.')
            : 'The start time matters only for J₂,₂, the Sun, the Moon and solar radiation pressure' + (page && page.usesStartTime ? ', or for this page’s real-date view' : '') + '.';
        const craft = cowell && (s.forces.drag || s.forces.srp);
        q('.orbit-settings-craft').hidden = !craft;
        const sc = s.spacecraft;
        const fields = { '#orbit-settings-cd': sc.cd, '#orbit-settings-cr': sc.cr, '#orbit-settings-am': sc.areaToMass, '#orbit-settings-solar': sc.solar };
        for (const [sel, value] of Object.entries(fields)) {
            const el = q(sel);
            if (document.activeElement !== el) el.value = String(value);
        }
        // Relative motion: practice always shows CW.
        const exact = !PRACTICE && s.ricModel === 'exact';
        for (const r of overlay.querySelectorAll('input[name="orbit-ric-model"]')) r.checked = r.value === (exact ? 'exact' : 'cw');
        for (const r of overlay.querySelectorAll('input[name="orbit-ric-axes"]')) {
            r.checked = r.value === (exact ? s.ricAxes : 'rectilinear');
            r.disabled = !exact;
        }
        const ov = q('#orbit-settings-cw-overlay');
        ov.checked = exact && s.cwOverlay;
        ov.disabled = !exact;
        q('.ric-why').textContent = exact
            ? 'Curvilinear: x is the difference in radius and y the arc along the target\'s orbit, so a chase on the same orbit keeps a fixed y.'
            : 'Axes and the CW overlay apply to the exact model only.';
        const note = q('.orbit-settings-pagenote');
        note.textContent = cowell && page && page.modelNote ? page.modelNote : '';
        note.hidden = !note.textContent;
        q('.orbit-settings-note.shared').hidden = PRACTICE || !!SITE_BUTTON || !S.isShared();
        q('.orbit-settings-note.bad').hidden = linkState !== 'bad';
    }

    let lastFocus = null;
    function open() {
        lastFocus = document.activeElement;
        overlay.hidden = false;
        document.documentElement.classList.add('orbit-settings-open');
        statusEl.textContent = '';
        q('.orbit-settings-link').hidden = true;
        render();
        const first = overlay.querySelector('input:checked:not(:disabled)') || q('.orbit-settings-close');
        first.focus();
    }
    function close() {
        overlay.hidden = true;
        document.documentElement.classList.remove('orbit-settings-open');
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    badge.addEventListener('click', open);
    q('.orbit-settings-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        // Keep the focus inside the panel while it is open.
        const items = Array.from(card.querySelectorAll('button, input, select')).filter((el) => !el.disabled && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    overlay.addEventListener('change', (e) => {
        const el = e.target;
        if (el.name === 'orbit-constants') S.set({ constants: el.value });
        else if (el.name === 'orbit-propagator') S.set({ propagator: el.value });
        else if (el.id === 'orbit-settings-solver') S.set({ solver: el.value });
        else if (el.name === 'orbit-ric-model') S.set({ ricModel: el.value });
        else if (el.name === 'orbit-ric-axes') S.set({ ricAxes: el.value });
        else if (el.id === 'orbit-settings-cw-overlay') S.set({ cwOverlay: el.checked });
        else if (el.dataset.force) S.set({ forces: { [el.dataset.force]: el.checked } });
        else if (el.id === 'orbit-settings-start') {
            const ms = fromField(el.value);
            if (Number.isFinite(ms)) S.set({ startMs: ms });
            else render();
        } else if (el.closest('.orbit-settings-craft')) {
            const sc = { ...S.get().spacecraft };
            if (el.id === 'orbit-settings-solar') sc.solar = el.value;
            else {
                const key = { 'orbit-settings-cd': 'cd', 'orbit-settings-cr': 'cr', 'orbit-settings-am': 'areaToMass' }[el.id];
                sc[key] = Number(el.value);
            }
            S.set({ spacecraft: sc });
            render();   // a value out of range falls back, and the field shows what is used
        }
    });
    q('.orbit-settings-now').addEventListener('click', () => S.set({ startMs: Date.now() }));
    q('.orbit-settings-reset').addEventListener('click', () => {
        S.reset();
        statusEl.textContent = 'Settings reset to the defaults.';
    });
    q('.orbit-settings-keep').addEventListener('click', () => {
        S.keepShared();
        render();
        statusEl.textContent = 'These settings are now saved in this browser.';
    });
    // The link Share copies: this page with the settings, the start time and the page's options.
    function shareLink() {
        const s = S.get();
        // A page on the computer clock shares the instant it is showing.
        if (s.startMs === null && global.OrbitMath) s.startMs = global.OrbitMath.LOAD_TIME_MS;
        let pageState = null;
        try { pageState = page && page.getShareState ? page.getShareState() : genericState(); }
        catch (err) { console.error(err); }
        const url = new URL(global.location.href);
        url.searchParams.set(PARAM, encodeShare(s, pageState));
        return url.toString();
    }
    q('.orbit-settings-share').addEventListener('click', () => {
        const text = shareLink();
        const showLink = () => {
            const box = q('.orbit-settings-link');
            box.hidden = false;
            const input = q('#orbit-settings-link-text');
            input.value = text;
            input.focus();
            input.select();
            statusEl.textContent = '';
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                () => { statusEl.textContent = 'Link copied. It opens this page with these settings and options.'; },
                showLink
            );
        } else {
            showLink();
        }
    });

    function toast(text) {
        const t = document.createElement('div');
        t.className = 'orbit-settings-toast';
        t.setAttribute('role', 'status');
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 6000);
    }

    S.onChange((settings, changed) => {
        render();
        if (page && page.onSettingsChange) {
            try { page.onSettingsChange(settings, changed); } catch (err) { console.error(err); }
        }
    });

    // In the top bar, between the page title and the links (which phones hide), so it shows everywhere.
    // The home page's own button is already in its nav bar, in the same place and style.
    const navLinks = document.querySelector('.nav-inner > .nav-links');
    if (STATIC_BADGE) { /* in place */ }
    else if (navLinks) navLinks.parentNode.insertBefore(badge, navLinks);
    else (document.querySelector('.nav-inner') || document.body).appendChild(badge);
    document.body.appendChild(overlay);
    render();
    if (linkState === 'bad') toast('This shared link could not be read, so the page opened with your own settings.');
    else if (linkState === 'shared' && !PRACTICE && !SITE_BUTTON) toast('Opened from a shared link. Open the settings to keep these settings.');

    Object.assign(api, { registerPage, genericState, applyGenericState, shareLink, open, close, PRACTICE });
    global.OrbitSettingsPanel = api;
})(typeof window !== 'undefined' ? window : globalThis);
