// Run with: node _tests/settings.test.js
// The settings store (math/settings.js), OrbitMath following it, and the share-link
// encoding (assets/orbit-settings-panel.js).
const assert = require('node:assert');

// A browser-like global with a storage the test can read.
const stored = new Map();
globalThis.window = globalThis;
globalThis.document = { createElement() { return {}; } };
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem: (k) => (stored.has(k) ? stored.get(k) : null),
        setItem: (k, v) => stored.set(k, String(v)),
        removeItem: (k) => stored.delete(k)
    }
});
const OM = require('./load-math.js');
const OC = OM.OC;
delete globalThis.document;   // the panel file loads its encoding only, as in Node
const Panel = require('../assets/orbit-settings-panel.js');
globalThis.document = { createElement() { return {}; } };
const S = OC.Settings;
const KEY = OC.STORAGE_KEY;

let passed = 0;
let failed = 0;
function check(name, fn) {
    try { fn(); passed++; console.log('ok    ' + name); }
    catch (err) { failed++; console.log('FAIL  ' + name + '\n      ' + err.message); }
}
const saved = () => (stored.has(KEY) ? JSON.parse(stored.get(KEY)) : null);

check('starts on the defaults: course constants, Kepler, PD78, no forces, CW, rectilinear, clock time', () => {
    const s = S.get();
    assert.strictEqual(s.constants, 'course');
    assert.strictEqual(s.propagator, 'kepler');
    assert.strictEqual(s.solver, 'PD78');
    assert.deepStrictEqual(s.forces, { j2: false, j34: false, j22: false, drag: false, sun: false, moon: false, srp: false });
    assert.strictEqual(s.ricModel, 'cw');
    assert.strictEqual(s.ricAxes, 'rectilinear');
    assert.strictEqual(s.cwOverlay, false);
    assert.strictEqual(s.ricAxesOther, false);
    assert.strictEqual(s.startMs, null);
    assert.strictEqual(S.active(), OC.SETS.course);
    assert.ok(S.isDefault());
});

check('unknown or damaged values fall back to the defaults', () => {
    const n = S.normalize({ constants: 'moon', propagator: 7, solver: 'RK9', forces: { j2: 'yes', drag: true, bogus: true }, ricModel: null, startMs: 'not a date' });
    assert.strictEqual(n.constants, 'course');
    assert.strictEqual(n.propagator, 'kepler');
    assert.strictEqual(n.solver, 'PD78');
    assert.strictEqual(n.forces.j2, false);
    assert.strictEqual(n.forces.drag, true);
    assert.ok(!('bogus' in n.forces));
    assert.strictEqual(n.ricModel, 'cw');
    assert.strictEqual(n.startMs, null);
    assert.deepStrictEqual(S.normalize(null), S.normalize({}));
    assert.strictEqual(S.normalize({ startMs: '2026-11-19T12:00:00Z' }).startMs, Date.UTC(2026, 10, 19, 12));
});

check('set saves to storage, tells listeners which keys changed, and never saves the start time', () => {
    const calls = [];
    const off = S.onChange((s, changed) => calls.push(changed));
    S.set({ constants: 'wgs84', startMs: 1e12 });
    off();
    assert.deepStrictEqual(calls, [['constants', 'startMs']]);
    assert.strictEqual(saved().constants, 'wgs84');
    assert.ok(!('startMs' in saved()));
    assert.strictEqual(S.active(), OC.SETS.wgs84);
    assert.ok(!S.isDefault());
    S.set({ constants: 'wgs84' });   // no change: no call
    assert.strictEqual(calls.length, 1);
});

check('OrbitMath follows the constants setting', () => {
    assert.strictEqual(OM.constants.mu, OC.SETS.wgs84.mu);
    assert.strictEqual(OM.rpo.MU, OC.SETS.wgs84.mu);
    S.set({ constants: 'course' });
    assert.strictEqual(OM.constants.mu, OC.SETS.course.mu);
    assert.strictEqual(OM.rpo.MU, OC.SETS.course.mu);
    assert.strictEqual(OM.frames.GEO_RADIUS, Math.cbrt(OC.SETS.course.mu / OC.SETS.course.omegaE ** 2));
});

check('forces merge one at a time', () => {
    S.set({ forces: { drag: true } });
    S.set({ forces: { sun: true } });
    assert.strictEqual(S.get().forces.drag, true);
    assert.strictEqual(S.get().forces.sun, true);
    S.reset();
    assert.ok(S.isDefault());
    assert.strictEqual(saved().forces.drag, false);
});

check('a shared link applies for the visit only, until the reader keeps it', () => {
    S.reset();
    const before = stored.get(KEY);
    S.useShared({ constants: 'wgs84', ricModel: 'exact', startMs: 1.7e12 });
    assert.ok(S.isShared());
    assert.strictEqual(S.get().constants, 'wgs84');
    assert.strictEqual(S.get().ricModel, 'exact');
    assert.strictEqual(S.startMs(), 1.7e12);
    assert.strictEqual(stored.get(KEY), before, 'storage untouched');
    S.set({ solver: 'RK4' });
    assert.strictEqual(stored.get(KEY), before, 'still untouched while shared');
    S.keepShared();
    assert.ok(!S.isShared());
    assert.strictEqual(saved().constants, 'wgs84');
    assert.strictEqual(saved().solver, 'RK4');
    S.reset();
});

check('share links round-trip settings and page options, including non-ASCII text', () => {
    const settings = { ...S.get(), constants: 'wgs84', startMs: 1795152000000 };
    const page = { a: '26000', e: '0.3', label: 'Δv → 5 m/s', on: true };
    const code = Panel.encodeShare(settings, page);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(code), 'URL-safe characters only');
    const back = Panel.decodeShare(code);
    assert.deepStrictEqual(back.settings, settings);
    assert.deepStrictEqual(back.page, page);
    assert.deepStrictEqual(Panel.decodeShare(Panel.encodeShare(settings, null)).page, null);
});

check('damaged or old links are refused, so the page falls back to its own settings', () => {
    assert.throws(() => Panel.decodeShare('not-base64-json'));
    assert.throws(() => Panel.decodeShare(''));
    const old = Buffer.from(JSON.stringify({ v: 0, s: {}, p: {} })).toString('base64url');
    assert.throws(() => Panel.decodeShare(old), /version/);
    // A link with nonsense values decodes, and the store cleans it up.
    const odd = Panel.decodeShare(Buffer.from(JSON.stringify({ v: Panel.VERSION, s: { constants: 'mars' }, p: null })).toString('base64url'));
    assert.strictEqual(S.normalize(odd.settings).constants, 'course');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
