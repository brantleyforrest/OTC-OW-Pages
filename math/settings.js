// settings.js
// The reader's choices for the whole site (constant set, propagator, solver, forces, RIC model and
// axes, start time, spacecraft), their defaults, and the store that keeps them in the browser.
// OrbitMath follows it (math/common.js); the settings panel (assets/orbit-settings-panel.js) edits it.
// No DOM needed. Load after the constant files and math/motion/solvers.js.
(function (global) {
    'use strict';

    const OC = global.OrbitConstants;
    if (!OC || !OC.SOLVER_IDS) throw new Error('settings.js: load math/constants/*.js and math/motion/solvers.js first');
    const { SETS, ATMOSPHERE, SOLVER_IDS } = OC;

    /* 10. Spacecraft and setting defaults ------------------------------------- */
    const SPACECRAFT = { cd: 2.2, cr: 1.3, areaToMass: 0.01, solar: 'mean' };
    const FORCE_IDS = ['j2', 'j34', 'j22', 'drag', 'sun', 'moon', 'srp'];
    const DEFAULTS = {
        constants: 'course',
        propagator: 'kepler',
        solver: 'PD78',
        forces: { j2: false, j34: false, j22: false, drag: false, sun: false, moon: false, srp: false },
        ricModel: 'cw',
        ricAxes: 'rectilinear',
        cwOverlay: false
    };
    const STORAGE_KEY = 'otc-orbit-settings';
    // The choices each setting allows; anything else read from storage or a link falls back to the default.
    const CHOICES = {
        constants: Object.keys(SETS),
        propagator: ['kepler', 'cowell'],
        solver: SOLVER_IDS,
        ricModel: ['cw', 'exact'],
        ricAxes: ['rectilinear', 'curvilinear']
    };

    /* 11. The settings store ---------------------------------------------------- */
    // One copy of the reader's choices for the whole site, saved in browser storage. A page opened
    // from a shared link uses the link's choices for that visit only: nothing is saved until the
    // reader keeps them. The start time is never saved: each visit starts at the computer clock
    // (null) unless one is typed or comes from a link.
    function normalizeSettings(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const out = {};
        for (const [key, allowed] of Object.entries(CHOICES)) {
            out[key] = allowed.includes(src[key]) ? src[key] : DEFAULTS[key];
        }
        const forces = src.forces && typeof src.forces === 'object' ? src.forces : {};
        out.forces = {};
        for (const id of FORCE_IDS) out.forces[id] = forces[id] === true;
        out.cwOverlay = src.cwOverlay === true;
        const ms = typeof src.startMs === 'number' ? src.startMs : Date.parse(src.startMs);
        out.startMs = Number.isFinite(ms) ? ms : null;
        // Spacecraft properties for drag and solar radiation pressure, used by every satellite on the
        // page that has none of its own. Like the start time, they last for the visit (or come from a
        // link) and are not saved.
        const sc = src.spacecraft && typeof src.spacecraft === 'object' ? src.spacecraft : {};
        const within = (x, lo, hi, fallback) => (typeof x === 'number' && x >= lo && x <= hi ? x : fallback);
        out.spacecraft = {
            cd: within(sc.cd, 0.5, 5, SPACECRAFT.cd),
            cr: within(sc.cr, 1, 2, SPACECRAFT.cr),
            areaToMass: within(sc.areaToMass, 1e-4, 1, SPACECRAFT.areaToMass),
            solar: sc.solar in ATMOSPHERE.SOLAR ? sc.solar : SPACECRAFT.solar
        };
        return out;
    }
    const sameSettings = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const Settings = (function () {
        const listeners = [];
        let shared = false;
        function storage() {
            // Browsers only: Node has no page to remember settings for.
            if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
            try { return global.localStorage || null; } catch (err) { return null; }
        }
        function load() {
            try {
                const s = storage();
                const text = s && s.getItem(STORAGE_KEY);
                return normalizeSettings(text ? JSON.parse(text) : null);
            } catch (err) { return normalizeSettings(null); }
        }
        function save() {
            if (shared) return;
            try {
                const s = storage();
                if (!s) return;
                const { startMs, spacecraft, ...kept } = current;   // the start time and spacecraft are never saved
                s.setItem(STORAGE_KEY, JSON.stringify(kept));
            } catch (err) { /* storage blocked: the choice lasts for this visit */ }
        }
        let current = load();

        // Calls each listener with (settings, changedKeys).
        function emit(before) {
            const changed = Object.keys(current).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(before[k]));
            if (!changed.length) return;
            const copy = get();
            for (const fn of listeners.slice()) {
                try { fn(copy, changed); } catch (err) { console.error(err); }
            }
        }
        function get() { return JSON.parse(JSON.stringify(current)); }
        function set(patch) {
            const before = current;
            const forces = { ...current.forces, ...((patch && patch.forces) || {}) };
            current = normalizeSettings({ ...current, ...patch, forces });
            save();
            emit(before);
        }
        function reset() {
            const before = current;
            current = normalizeSettings({ ...DEFAULTS, startMs: null });
            save();
            emit(before);
        }
        function onChange(fn) {
            listeners.push(fn);
            return () => { const k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); };
        }
        // A shared link's settings, for this visit only.
        function useShared(raw) {
            const before = current;
            shared = true;
            current = normalizeSettings(raw);
            emit(before);
        }
        function keepShared() { shared = false; save(); }
        const isShared = () => shared;
        const isDefault = () => sameSettings(normalizeSettings({ ...DEFAULTS, startMs: current.startMs }), current);
        const active = () => SETS[current.constants];
        const startMs = () => current.startMs;
        return { get, set, reset, onChange, useShared, keepShared, isShared, isDefault, active, startMs, normalize: normalizeSettings };
    })();

    Object.assign(OC, { SPACECRAFT, FORCE_IDS, DEFAULTS, STORAGE_KEY, CHOICES, Settings, active: Settings.active });
})(typeof window !== 'undefined' ? window : globalThis);
