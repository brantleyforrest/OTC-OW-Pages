// Run with: node _tests/relative-motion-explorer.test.js
// Tests that changing 'a' in Relative Motion Explorer updates all calculations,
// equations, element tables, and views immediately across all modes (RMOE, PV, COE).

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
let failed = 0;
function check(name, fn) {
    try {
        fn();
        passed++;
        console.log('ok    ' + name);
    } catch (err) {
        failed++;
        console.log('FAIL  ' + name + '\n      ' + err.message);
    }
}
function near(got, want, tol, what) {
    assert.ok(Math.abs(got - want) <= tol, `${what || 'value'}: got ${got}, want ${want} (tolerance ${tol})`);
}

// Lightweight DOM mock for relative-motion-explorer.js
class MockElement {
    constructor(id = '', tag = 'div') {
        this.id = id;
        this.tagName = tag.toUpperCase();
        this.className = '';
        this.classList = {
            add: (c) => { if (!this.className.includes(c)) this.className = (this.className + ' ' + c).trim(); },
            remove: (c) => { this.className = this.className.replace(new RegExp('\\b' + c + '\\b', 'g'), '').trim(); },
            toggle: (c, force) => {
                const has = this.className.includes(c);
                const add = force !== undefined ? force : !has;
                if (add) this.classList.add(c); else this.classList.remove(c);
            },
            contains: (c) => this.className.includes(c)
        };
        this.children = [];
        this.dataset = {};
        this.listeners = {};
        this.value = '';
        this.textContent = '';
        this._innerHTML = '';
        this.style = {};
        this.title = '';
        this.disabled = false;
        this.readOnly = false;
        this.hidden = false;
    }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
    }
    dispatchEvent(evt) {
        const type = typeof evt === 'string' ? evt : evt.type;
        const fns = this.listeners[type] || [];
        for (const fn of fns) fn(typeof evt === 'string' ? { target: this, type } : evt);
    }
    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
        const res = [];
        const check = (el) => {
            if (sel.startsWith('.')) {
                if (el.className && el.className.includes(sel.slice(1))) res.push(el);
            } else if (sel.startsWith('#')) {
                if (el.id === sel.slice(1)) res.push(el);
            } else if (sel.includes('[')) {
                const m = sel.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
                if (m) {
                    const attr = m[1].replace('data-', '');
                    if (el.dataset && el.dataset[attr] !== undefined) {
                        if (!m[2] || el.dataset[attr] === m[2]) res.push(el);
                    }
                }
            } else if (el.tagName.toLowerCase() === sel.toLowerCase()) {
                res.push(el);
            }
            for (const child of el.children) check(child);
        };
        check(this);
        return res;
    }
    setAttribute(name, val) {
        if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(val);
        this[name] = val;
    }
    getAttribute(name) {
        if (name.startsWith('data-')) return this.dataset[name.slice(5)];
        return this[name];
    }
    focus() {}
    select() {}
    blur() {}
    getContext() {
        return {
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
            measureText: () => ({ width: 50 }),
            fillRect: () => {}, fillText: () => {}, beginPath: () => {},
            arc: () => {}, fill: () => {}, stroke: () => {},
            moveTo: () => {}, lineTo: () => {}, setLineDash: () => {}
        };
    }
    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>(?:(.*?)<\/\1>)?/gs;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tag = match[1];
            const attrs = match[2];
            const content = match[3] || '';
            const child = new MockElement('', tag);
            const classMatch = attrs.match(/class="([^"]+)"/);
            if (classMatch) child.className = classMatch[1];
            const typeMatch = attrs.match(/type="([^"]+)"/);
            if (typeMatch) child.type = typeMatch[1];
            const idMatch = attrs.match(/id="([^"]+)"/);
            if (idMatch) child.id = idMatch[1];
            const dataMatches = attrs.matchAll(/data-([a-zA-Z0-9_-]+)="([^"]*)"/g);
            for (const dm of dataMatches) {
                child.dataset[dm[1]] = dm[2];
            }
            if (content && content.includes('<')) {
                child.innerHTML = content;
            } else {
                child.textContent = content;
            }
            this.children.push(child);
        }
    }
    get innerHTML() { return this._innerHTML; }
}

const elements = new Map();
function getOrCreate(id, tag = 'div') {
    if (!elements.has(id)) {
        elements.set(id, new MockElement(id, tag));
    }
    return elements.get(id);
}

const mockDoc = {
    getElementById: (id) => getOrCreate(id),
    createElement: (tag) => new MockElement('', tag),
    body: new MockElement('body', 'body'),
    activeElement: null,
    querySelector: () => null,   // the mock has no Advanced switch button: the page sets the class itself
    querySelectorAll: (sel) => {
        const res = [];
        for (const el of elements.values()) {
            res.push(...el.querySelectorAll(sel));
        }
        return res;
    }
};

globalThis.window = globalThis;
globalThis.document = mockDoc;
globalThis.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
globalThis.matchMedia = () => ({ matches: false });
// The page watches the body's classes (Advanced on or off); fireMutations() runs its callbacks.
const mutationCallbacks = [];
globalThis.MutationObserver = class { constructor(cb) { mutationCallbacks.push(cb); } observe() {} disconnect() {} };
const fireMutations = () => mutationCallbacks.forEach(cb => cb([]));

const OM = require('./load-math.js');
// Tool math runs on the set named by CONSTANTS (course by default): CONSTANTS=wgs84 node <test>.
const TEST_SET = globalThis.OrbitConstants.SETS[process.env.CONSTANTS || 'course'];
if (!TEST_SET) throw new Error('Unknown CONSTANTS set: ' + process.env.CONSTANTS);
const M = OM.bind(TEST_SET).rpo;
// The page reads OrbitMath.rpo, which follows the settings: put them on the same set.
globalThis.OrbitConstants.Settings.set({ constants: TEST_SET.id });
// The settings panel, reduced to what the page needs: its onSettingsChange runs on every change.
globalThis.OrbitSettingsPanel = {
    registerPage(page) { globalThis.OrbitConstants.Settings.onChange((s, changed) => page.onSettingsChange(s, changed)); }
};

globalThis.ToolKit = {
    startLoop: () => {},
    prefersReducedMotion: () => false,
    bindSegmented: (group, onChange) => {
        const buttons = group.querySelectorAll('button');
        buttons.forEach(b => {
            b.addEventListener('click', () => {
                buttons.forEach(other => other.setAttribute('aria-pressed', String(other === b)));
                onChange(b.dataset.value);
            });
        });
        return (val) => {
            buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === val)));
            onChange(val);
        };
    }
};

const makeMockPane = (name, plane) => ({
    name, plane,
    canvas: new MockElement('canvas', 'canvas'),
    draw: () => {},
    toPx: () => [100, 100],
    kmPerPx: () => 0.05,
    setScale: () => {},
    boxCenter: () => [0, 0]
});

globalThis.RpoViews = {
    useMath: () => {},
    PLANES: {
        left: { h: 1, v: 0 },
        behind: { h: 2, v: 0 },
        above: { h: 2, v: 1 }
    },
    fitPanes: () => ({ box: { min: [-10, -10, -10], max: [10, 10, 10] } }),
    framePath: (coe, times, path) => ({ times, path, maxRho: 10 }),
    attachPanZoom: () => {},
    createFiveViewStage: (container, opts) => {
        const left = makeMockPane('left', 'left');
        const behind = makeMockPane('behind', 'behind');
        const above = makeMockPane('above', 'above');
        return {
            left, behind, above,
            visiblePlanes: () => [left, behind, above],
            boxVisible: () => false,
            selectBoxView: () => {},
            setBadge: () => {},
            inertial: {
                setOrbit: () => {},
                setChaseOrbit: () => {},
                setPath: () => {},
                update: () => {},
                resetView: () => {},
                autoMagnification: () => 1,
                setMagnification: () => {},
                setFrame: () => {},
                setCamera: () => {},
                setTrails: () => {},
                setExtras: () => {},
                setLabels: () => {}
            }
        };
    }
};

// Populate UI buttons before running script
const tp = getOrCreate('target-pick');
['geo', 'gps', 'leo', 'custom'].forEach(v => {
    const b = new MockElement('', 'button');
    b.dataset.value = v;
    tp.appendChild(b);
});
const fp = getOrCreate('frame-pick');
['ECI', 'ECEF'].forEach(v => {
    const b = new MockElement('', 'button');
    b.dataset.value = v;
    fp.appendChild(b);
});
const mp = getOrCreate('mode-pick');
['coe', 'rmoe', 'pv'].forEach(v => {
    const b = new MockElement('', 'button');
    b.dataset.value = v;
    mp.appendChild(b);
});
const starts = getOrCreate('starts');
['0', '90', '180', '270'].forEach(v => {
    const b = new MockElement('', 'button');
    b.dataset.value = v;
    starts.appendChild(b);
});
const speed = getOrCreate('speed');
const spSpeed = getOrCreate('sp-speed');
['1', '2', '5'].forEach(v => {
    const b = new MockElement('', 'button');
    b.dataset.value = v;
    speed.appendChild(b);
    spSpeed.appendChild(b);
});
// The dialog that asks before a change that breaks an assumption. close() alone is Escape.
const choiceMock = getOrCreate('choice-dialog', 'dialog');
choiceMock.open = false;
choiceMock.showModal = () => { choiceMock.open = true; };
choiceMock.close = () => { if (!choiceMock.open) return; choiceMock.open = false; choiceMock.dispatchEvent('close'); };
const choiceLabels = () => getOrCreate('choice-buttons').children.map(b => b.textContent);
const dialogTitle = () => getOrCreate('choice-title').textContent;
function choose(label) {
    assert.ok(choiceMock.open, 'the dialog should be open to choose "' + label + '"');
    const b = getOrCreate('choice-buttons').children.find(x => x.textContent === label);
    assert.ok(b, 'no "' + label + '" button; the buttons are: ' + choiceLabels().join(', '));
    b.dispatchEvent('click');
    assert.ok(!choiceMock.open, 'choosing "' + label + '" closes the dialog');
}

async function runTests() {
    const code = fs.readFileSync(path.join(__dirname, '../tools/relative-frame/relative-motion-explorer/relative-motion-explorer.js'), 'utf8');
    eval(code);
    await new Promise(r => setTimeout(r, 150));

    const rme = globalThis.relativeMotionExplorer;
    assert.ok(rme, 'relativeMotionExplorer should be exported on globalThis');

    check('initialization state', () => {
        assert.strictEqual(rme.state.target.a, 42164);
        near(rme.sim().n, M.meanMotion(42164), 1e-12);
        near(rme.sim().P, M.period(42164), 1e-6);
    });

    check('RMOE mode: setTargetA updates n, P, drift rate, period, and boundary tables immediately', () => {
        rme.selectMode('rmoe');
        rme.set({ xc: 2, C: 10, yc0: 0, zmax: 5 });

        // Update target a to LEO (8000 km)
        rme.setTargetA(8000);

        near(rme.state.target.a, 8000, 1e-9, 'target.a');
        const wantN = M.meanMotion(8000);
        const wantP = M.period(8000);
        near(rme.sim().n, wantN, 1e-12, 'sim.n');
        near(rme.sim().P, wantP, 1e-6, 'sim.P');

        // Check period readout
        const pRead = getOrCreate('co-p').textContent;
        near(parseFloat(pRead), wantP / 60, 0.1, 'co-p period in min');

        // Check drift readout
        const driftText = getOrCreate('drift-read').textContent;
        const wantDrift = M.driftRate(rme.state.rmoe, wantN, 8000);
        assert.ok(driftText.includes(Math.abs(wantDrift.kmPerRev).toFixed(2)), 'drift text kmPerRev');

        // Check element differences updated. CW starts from chase's position and velocity, so the
        // course's element formulas (Δa = x_C, ...) hold only approximately.
        near(rme.state.diff.da, 2, 0.01, 'diff.da ≈ xc');
        near(rme.state.diff.de, 10 / 8000, 1e-5, 'diff.de = C/a');
        near(rme.state.diff.di, (5 / 8000) * M.R2D, 1e-4, 'diff.di = zmax/a');

        // Check boundary table updated
        const btPlane = getOrCreate('bt-plane').innerHTML;
        assert.ok(btPlane.includes('<tr><th>Point</th>'), 'boundary table rendered');
    });

    check('PV mode: setTargetA preserves user typed velocities and recomputes RMOEs', () => {
        rme.selectMode('pv');

        // Set explicit inputs: x0 = 0, y0 = -10, z0 = 5, vx = 0, vy = 2.0 m/s, vz = 1.0 m/s
        getOrCreate('pv-x').value = '0';
        getOrCreate('pv-y').value = '-10';
        getOrCreate('pv-z').value = '5';
        getOrCreate('pv-vx').value = '0';
        getOrCreate('pv-vy').value = '2.0';
        getOrCreate('pv-vz').value = '1.0';

        // Trigger change on pv-vy to commit initial state at a = 8000
        getOrCreate('pv-vy').dispatchEvent('change');

        const n8000 = M.meanMotion(8000);
        near(rme.state.rmoe.xc, 4 * 0 + 2 * (2.0 / 1000) / n8000, 1e-4, 'initial xc at 8000');

        // Now change a to 26562 (GPS)
        rme.setTargetA(26562);

        // Verify typed velocities were NOT overwritten
        near(Number(getOrCreate('pv-x').value), 0, 1e-4, 'pv-x preserved');
        near(Number(getOrCreate('pv-y').value), -10, 1e-4, 'pv-y preserved');
        near(Number(getOrCreate('pv-z').value), 5, 1e-4, 'pv-z preserved');
        near(Number(getOrCreate('pv-vx').value), 0, 1e-4, 'pv-vx preserved');
        near(Number(getOrCreate('pv-vy').value), 2.0, 1e-4, 'pv-vy preserved');
        near(Number(getOrCreate('pv-vz').value), 1.0, 1e-4, 'pv-vz preserved');

        // Verify RMOEs recomputed with new nGPS
        const nGPS = M.meanMotion(26562);
        const expectedXc = 4 * 0 + 2 * (2.0 / 1000) / nGPS;
        near(rme.state.rmoe.xc, expectedXc, 1e-4, 'xc recomputed from vy and new n');

        const expectedZmax = Math.sqrt(5 * 5 + Math.pow((1.0 / 1000) / nGPS, 2));
        near(rme.state.rmoe.zmax, expectedZmax, 1e-4, 'zmax recomputed from vz and new n');

        // Verify equations container updated with new a and n
        const eqsHtml = getOrCreate('pv-eqs').innerHTML;
        assert.ok(eqsHtml.includes('26562'), 'equations include new a');
        assert.ok(eqsHtml.includes(expectedXc.toFixed(3)), 'equations include new xc');
    });

    check('Orbital phase (revolution fraction) is preserved when a changes', () => {
        rme.selectMode('rmoe');
        rme.setTargetA(42164);
        const pGeo = rme.sim().P;

        // Set time to 0.75 revs
        rme.state.t = 0.75 * pGeo;

        // Change a to 8000
        rme.setTargetA(8000);

        const pLeo = rme.sim().P;
        const revAfter = rme.state.t / pLeo;
        near(revAfter, 0.75, 1e-6, 'revolution fraction preserved across period change');

        const timeRead = getOrCreate('time-read').textContent;
        assert.strictEqual(timeRead, '0.75 rev', 'time-read matches preserved phase');
    });

    check('COE mode is open to everyone', () => {
        rme.selectMode('rmoe');
        assert.strictEqual(rme.state.mode, 'rmoe');
        rme.selectMode('coe');
        assert.strictEqual(rme.state.mode, 'coe', 'COE mode must be allowed without dev mode');
    });

    check('COE mode: changing a updates chase orbit, n, P, and DOM a-field', () => {
        rme.selectMode('coe');
        // Initial GEO
        rme.setOrbits({ a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, { da: 5, de: 0.0002, di: 0.01, draan: 0, dargp: 0, dnu: 0 });

        near(rme.sim().coe.a, 42164, 1e-6);
        near(rme.sim().chase.a, 42169, 1e-6);

        // Update target a to 10000 km
        rme.setOrbits({ a: 10000, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, { da: 5, de: 0.0002, di: 0.01, draan: 0, dargp: 0, dnu: 0 });

        near(rme.state.target.a, 10000, 1e-6, 'target a');
        near(rme.sim().chase.a, 10005, 1e-6, 'chase a = target a + da');
        near(rme.sim().n, M.meanMotion(10000), 1e-12, 'sim n');
        near(Number(getOrCreate('target-a').value), 10000, 1e-3, 'target-a input updated');
    });

    check('Live typing in target-a input updates calculations immediately', () => {
        rme.selectMode('rmoe');
        const targetAEl = getOrCreate('target-a');

        // Simulate typing 12000
        targetAEl.value = '12000';
        targetAEl.dispatchEvent('input');

        near(rme.state.target.a, 12000, 1e-6, 'target.a updated on input event');
        near(rme.sim().n, M.meanMotion(12000), 1e-12, 'sim.n updated on input event');

        // Simulate typing a half-typed number like "120" (< 6500)
        targetAEl.value = '120';
        targetAEl.dispatchEvent('input');

        // Must keep the last valid target a (12000)
        near(rme.state.target.a, 12000, 1e-6, 'target.a not corrupted by out-of-range typing');
    });

    check('Switching COEs, RMOEs, and position and velocity keeps the RMOEs, across settings changes too', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        const KEYS = ['xc', 'yc0', 'C', 'zmax', 'M0', 'dM0'];
        // Angles compared around the circle (359.9999999 is 0).
        const same = (a, b, tol, what) => KEYS.forEach(k => (k === 'M0' || k === 'dM0'
            ? near(((a[k] - b[k]) % 360 + 540) % 360 - 180, 0, tol, what + ' ' + k)
            : near(a[k], b[k], tol, what + ' ' + k)));
        // The RMOEs the orbits give: CW started from chase's position and velocity on straight axes.
        const fromCoes = () => {
            const R = globalThis.OrbitMath.rpo, t = rme.state.target;
            const rel = R.relativeStateSats(R.targetSat(t), R.targetSat(R.coeFromDifference(t, rme.state.diff)), 0, 'rectilinear');
            const r = R.rmoeFromState([...rel.rho, ...rel.rhoDot], R.meanMotion(t.a));
            return { ...r, M0: r.M0 === null ? 0 : r.M0, dM0: r.dM0 === null ? 0 : r.dM0 };
        };
        const combos = [
            { ricModel: 'cw', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'curvilinear', propagator: 'cowell' }
        ];
        for (const combo of combos) for (const preset of [0, 3, 6]) {
            const exact = combo.ricModel === 'exact';
            rme.selectMode('coe');   // COEs work with either model, so the settings change asks nothing
            S.set({ constants: TEST_SET.id, propagator: 'kepler', ...combo });
            rme.selectMode(exact ? 'pv' : 'rmoe');   // RMOEs exist only with CW
            rme.loadPreset(preset);
            const r0 = { ...rme.state.rmoe };
            rme.selectMode('coe');
            same(rme.state.rmoe, r0, 1e-9, 'to COEs');
            same(fromCoes(), rme.state.rmoe, 1e-6, 'COEs give the RMOEs');
            // A settings change in COE mode: the COEs and RMOEs must still agree.
            S.set({ constants: TEST_SET.id === 'course' ? 'wgs84' : 'course' });
            same(fromCoes(), rme.state.rmoe, 1e-6, 'after a constants change, COEs give the RMOEs');
            const r1 = { ...rme.state.rmoe };
            rme.selectMode('pv');
            if (!exact) rme.selectMode('rmoe');
            same(rme.state.rmoe, r1, 1e-6, 'COEs to position and velocity' + (exact ? '' : ' to RMOEs'));
            rme.selectMode('coe');
            same(rme.state.rmoe, r1, 1e-6, 'and back to COEs');
            assert.ok(!choiceMock.open, 'nothing was asked');
        }
        S.set(start);
        rme.selectMode('rmoe');
    });

    check('Switching modes never changes the motion, with CW or the exact model', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        const gap = (a, b) => { let g = 0; for (let k = 0; k < a.length; k++) g = Math.max(g, Math.abs(a[k] - b[k])); return g; };
        const combos = [
            { ricModel: 'cw', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'curvilinear' }
        ];
        for (const combo of combos) for (const preset of [1, 4, 7]) {
            const exact = combo.ricModel === 'exact';
            rme.selectMode('coe');
            S.set({ constants: TEST_SET.id, propagator: 'kepler', ...combo });
            rme.loadPreset(preset);
            const path0 = Float64Array.from(rme.sim().path);
            for (const mode of exact ? ['pv', 'coe', 'pv', 'coe'] : ['rmoe', 'pv', 'coe', 'rmoe', 'coe']) {
                rme.selectMode(mode);
                const what = combo.ricModel + '/' + combo.ricAxes + ' preset ' + preset + ' in ' + mode;
                assert.strictEqual(rme.sim().path.length, path0.length, what + ': path length');
                assert.ok(gap(rme.sim().path, path0) < 1e-6, what + ': path moved ' + gap(rme.sim().path, path0) + ' km');
            }
        }
        S.set(start);
        rme.selectMode('rmoe');
    });

    check('The CW overlay starts from chase\'s exact relative state, so rectilinear CW drifts off a perch', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        const R = globalThis.OrbitMath.rpo;
        // The largest distance between the exact path and the CW overlay over the span shown.
        const worst = () => {
            const a = rme.sim().path, b = rme.sim().cwPath;
            let w = 0;
            for (let k = 0; k < a.length; k += 3) w = Math.max(w, Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]));
            return w;
        };
        rme.selectMode('coe');
        S.set({ constants: TEST_SET.id, propagator: 'kepler', ricModel: 'exact', ricAxes: 'rectilinear', cwOverlay: true });
        rme.loadPreset(0);   // Perch: 20 km behind
        assert.ok(rme.sim().cwPath, 'the overlay is drawn');
        const p = rme.sim().path, c = rme.sim().cwPath;
        assert.ok(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 1e-9, 'the overlay starts where chase is');
        // The rectilinear start is a little above the target's orbit, so CW sees a drift the real chase lacks.
        assert.ok(worst() > 0.1, 'rectilinear: CW drifts off the exact perch (worst ' + worst() + ' km)');
        S.set({ ricAxes: 'curvilinear' });
        assert.ok(worst() < 0.01, 'curvilinear: CW holds the perch (worst ' + worst() + ' km)');
        // The table and readouts use the same CW start as the overlay.
        ['xc', 'yc0', 'C', 'zmax'].forEach(k => near(rme.sim().rmoe[k], rme.sim().cwRmoe[k], 1e-12, 'table RMOEs ' + k));
        // With the overlay off, the RMOEs are still CW's start from position and velocity.
        S.set({ cwOverlay: false, ricAxes: 'rectilinear' });
        assert.ok(!rme.sim().cwPath, 'no overlay drawn');
        const rel = R.relativeStateSats(rme.sim().tSat, rme.sim().cSat, 0, 'rectilinear');
        const want = R.rmoeFromState([...rel.rho, ...rel.rhoDot], rme.sim().n);
        ['xc', 'yc0'].forEach(k => near(rme.sim().rmoe[k], want[k], 1e-12, 'rectilinear start ' + k));
        assert.ok(rme.sim().maxGap > 0.1, 'the largest gap is measured with the overlay off too');
        S.set(start);
        rme.selectMode('rmoe');
    });

    check('CW starts from position and velocity: RMOEs and orbits agree that way in every mode', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        const R = globalThis.OrbitMath.rpo;
        S.set({ constants: TEST_SET.id, propagator: 'kepler', ricModel: 'cw', ricAxes: 'rectilinear', cwOverlay: false });
        rme.selectMode('rmoe');
        rme.loadPreset(1);   // Drift: x_C 2 km at GEO
        const t = rme.state.target, chase = R.coeFromDifference(t, rme.state.diff);
        // Chase sits exactly at the CW position and velocity on straight axes.
        const rel = R.relativeStateSats(R.targetSat(t), R.targetSat(chase), 0, 'rectilinear');
        const cw = R.stateFromRmoe({ ...rme.state.rmoe, M0: null, dM0: null }, R.meanMotion(t.a), 0);
        [...rel.rho, ...rel.rhoDot].forEach((v, k) => near(v, cw[k], 1e-9, 'state ' + k));
        // So Δa differs a little from the course's x_C = Δa.
        assert.ok(Math.abs(rme.state.diff.da - rme.state.rmoe.xc) > 1e-4, 'Δa is not exactly x_C: ' + rme.state.diff.da);
        S.set(start);
        rme.selectMode('rmoe');
    });

    check('The CW checks rate the assumptions', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        rme.selectMode('coe');
        S.set({ constants: TEST_SET.id, propagator: 'cowell', forces: { j2: true }, ricModel: 'cw', ricAxes: 'curvilinear' });
        let checks = getOrCreate('cw-checks-list').innerHTML;
        assert.ok(/stretched[^]*Two-body motion/.test(checks), 'CW with J2 on: two-body stretched');
        assert.ok(getOrCreate('cw-gap').hidden, 'CW: no gap line');
        S.set({ ricModel: 'exact' });
        assert.ok(/Curvilinear axes/.test(getOrCreate('cw-checks-list').innerHTML), 'exact, curvilinear: straight axes taken out');
        S.set({ propagator: 'kepler', forces: { j2: false }, ricAxes: 'rectilinear' });
        rme.loadPreset(0);
        rme.setTargetA(8000);
        checks = getOrCreate('cw-checks-list').innerHTML;
        assert.ok(/class="ok"[^]*Circular target/.test(checks), 'circular target holds');
        S.set(start);
        rme.selectMode('rmoe');
    });

    /* ---------- Conflicts: asked about, never changed quietly ---------- */
    const S = globalThis.OrbitConstants.Settings, START = S.get();
    const ricModelNow = () => S.get().ricModel;
    const snap = () => JSON.parse(JSON.stringify({ target: rme.state.target, diff: rme.state.diff, rmoe: rme.state.rmoe }));
    function setAdvanced(on) {
        if (on) mockDoc.body.classList.add('advanced-on'); else mockDoc.body.classList.remove('advanced-on');
        fireMutations();
    }
    // Exact difference, Advanced on, in COEs, with an eccentric target.
    function eccentricExact() {
        rme.selectMode('coe');
        S.set({ constants: TEST_SET.id, propagator: 'kepler', ricModel: 'exact', ricAxes: 'rectilinear' });
        setAdvanced(true);
        assert.ok(rme.setOrbits({ a: 7000, e: 0.01, i: 30, raan: 20, argp: 40, nu: 10 }, { da: 1, de: 0.001, di: 0.01, dnu: 0.02 }), 'eccentric target set');
        assert.ok(!choiceMock.open, 'nothing asked yet');
    }
    // Back to the page's defaults, whatever a test left.
    function home() {
        if (choiceMock.open) choiceMock.close();
        rme.selectMode('coe');
        if (rme.state.target.e > 0) rme.setOrbits({ ...rme.state.target, e: 0 }, { ...rme.state.diff, de: Math.max(0, rme.state.diff.de) });
        setAdvanced(false);
        S.set(START);
        rme.selectMode('rmoe');
        assert.ok(!choiceMock.open, 'home: nothing left open');
    }

    check('RMOEs picked with Exact difference: asks; Stay or Escape keep everything, Use CW switches', () => {
        rme.selectMode('coe');
        S.set({ constants: TEST_SET.id, ricModel: 'exact' });
        const s0 = snap();
        rme.selectMode('rmoe');
        assert.ok(choiceMock.open, 'the dialog opens');
        assert.strictEqual(dialogTitle(), 'RMOEs need the CW model');
        assert.strictEqual(rme.state.mode, 'coe', 'still in COEs while asking');
        choose('Stay in COEs');
        assert.strictEqual(rme.state.mode, 'coe', 'Stay keeps COEs');
        assert.strictEqual(ricModelNow(), 'exact', 'Stay keeps Exact difference');
        rme.selectMode('rmoe');
        choiceMock.close();
        assert.strictEqual(rme.state.mode, 'coe', 'Escape keeps COEs');
        assert.deepStrictEqual(snap(), s0, 'nothing changed');
        rme.selectMode('rmoe');
        choose('Use CW');
        assert.strictEqual(rme.state.mode, 'rmoe', 'Use CW switches to RMOEs');
        assert.strictEqual(ricModelNow(), 'cw', 'and sets Relative motion to CW');
        assert.ok(!rme.sim().exact, 'the page draws CW');
        assert.deepStrictEqual(snap(), s0, 'the numbers stay the same');
        home();
    });

    check('Exact difference chosen in RMOEs: asks; Keep CW or Escape put CW back, Use COEs or P&V switch', () => {
        rme.selectMode('rmoe');
        const s0 = snap();
        for (const keep of ['button', 'escape']) {
            S.set({ ricModel: 'exact' });
            assert.ok(choiceMock.open, keep + ': the dialog opens');
            assert.strictEqual(dialogTitle(), 'RMOEs need the CW model');
            if (keep === 'button') choose('Keep CW'); else choiceMock.close();
            assert.strictEqual(ricModelNow(), 'cw', keep + ': CW is back');
            assert.strictEqual(rme.state.mode, 'rmoe', keep + ': still in RMOEs');
            assert.ok(!rme.sim().exact, keep + ': the page draws CW');
        }
        for (const [label, mode] of [['Use Position and Velocity', 'pv'], ['Use COEs', 'coe']]) {
            rme.selectMode('coe'); S.set({ ricModel: 'cw' }); rme.selectMode('rmoe');
            S.set({ ricModel: 'exact' });
            choose(label);
            assert.strictEqual(rme.state.mode, mode, label + ': switched');
            assert.strictEqual(ricModelNow(), 'exact', label + ': Exact difference kept');
            assert.ok(rme.sim().exact, label + ': the page draws the exact model');
            assert.deepStrictEqual(snap(), s0, label + ': the numbers stay the same');
        }
        home();
    });

    check('Position and Velocity with Exact difference works for an eccentric target, and keeps the typed state', () => {
        eccentricExact();
        const s0 = snap();
        const path0 = Float64Array.from(rme.sim().path);
        rme.selectMode('pv');
        assert.ok(!choiceMock.open, 'no dialog: position and velocity need no RMOEs');
        assert.strictEqual(rme.state.mode, 'pv');
        assert.deepStrictEqual(snap(), s0, 'switching changed nothing');
        assert.ok(rme.sim().path.every((x, k) => x === path0[k]), 'the motion is the same');
        // The fields show chase's exact relative state at epoch.
        const rel = M.relativeStateSats(rme.sim().tSat, rme.sim().cSat, 0, 'rectilinear');
        near(Number(getOrCreate('pv-x').value), rel.rho[0], 1e-4, 'x0');
        near(Number(getOrCreate('pv-vy').value), rel.rhoDot[1] * 1000, 1e-6, 'vy0 in m/s');
        // Typing a state: chase flies the orbit it gives, the target keeps its e.
        const field = getOrCreate('pv-y');
        const typed = Number(field.value) + 1.5;
        field.value = String(typed);
        field.dispatchEvent('change');
        near(rme.state.target.e, 0.01, 1e-15, 'the target keeps its e');
        const rel2 = M.relativeStateSats(rme.sim().tSat, rme.sim().cSat, 0, 'rectilinear');
        near(rel2.rho[1], typed, 1e-6, 'chase starts at the typed y');
        near(rel2.rho[0], rel.rho[0], 1e-6, 'and the same x');
        // A new target a keeps the typed relative state and the target's e.
        const before = [...rel2.rho, ...rel2.rhoDot];
        rme.setTargetA(7100);
        near(rme.state.target.a, 7100, 1e-9, 'a changed');
        near(rme.state.target.e, 0.01, 1e-15, 'e kept');
        const rel3 = M.relativeStateSats(rme.sim().tSat, rme.sim().cSat, 0, 'rectilinear');
        [...rel3.rho, ...rel3.rhoDot].forEach((x, k) => near(x, before[k], 1e-6, 'relative state ' + k + ' kept'));
        // Back to COEs and Position and Velocity again: nothing moves.
        const s1 = snap();
        rme.selectMode('coe'); rme.selectMode('pv'); rme.selectMode('coe');
        assert.deepStrictEqual(snap(), s1, 'switching changed nothing');
        home();
    });

    check('CW chosen with an eccentric target: asks; Keep or Escape put Exact back, Set e to 0 switches', () => {
        eccentricExact();
        for (const mode of ['coe', 'pv']) {
            rme.selectMode(mode);
            const s0 = snap();
            for (const keep of ['button', 'escape']) {
                S.set({ ricModel: 'cw' });
                assert.ok(choiceMock.open, mode + ' ' + keep + ': the dialog opens');
                assert.strictEqual(dialogTitle(), 'CW needs a circular target');
                if (keep === 'button') choose('Keep Exact difference'); else choiceMock.close();
                assert.strictEqual(ricModelNow(), 'exact', mode + ' ' + keep + ': Exact difference is back');
                assert.deepStrictEqual(snap(), s0, mode + ' ' + keep + ': nothing changed');
                assert.ok(rme.sim().exact, mode + ' ' + keep + ': the page draws the exact model');
            }
        }
        S.set({ ricModel: 'cw' });
        choose('Set e to 0');
        assert.strictEqual(ricModelNow(), 'cw', 'CW kept');
        assert.strictEqual(rme.state.target.e, 0, 'the target is circular');
        assert.ok(!rme.sim().exact, 'the page draws CW');
        home();
    });

    check('Advanced off or a preset with an eccentric target: asks; keeping changes nothing', () => {
        eccentricExact();
        const s0 = snap();
        setAdvanced(false);
        assert.ok(choiceMock.open, 'Advanced off: the dialog opens');
        assert.strictEqual(dialogTitle(), 'An eccentric target needs Advanced');
        choose('Keep Advanced on');
        fireMutations();
        assert.ok(mockDoc.body.classList.contains('advanced-on'), 'Advanced is back on');
        assert.deepStrictEqual(snap(), s0, 'nothing changed');
        setAdvanced(false);
        choiceMock.close();
        fireMutations();
        assert.ok(mockDoc.body.classList.contains('advanced-on'), 'Escape: Advanced is back on');
        // A preset (or Reset Preset) on an eccentric target.
        const presetBefore = rme.state.preset;
        rme.loadPreset(2);
        assert.ok(choiceMock.open, 'preset: the dialog opens');
        assert.strictEqual(dialogTitle(), 'Presets need a circular target');
        choose('Cancel');
        assert.deepStrictEqual(snap(), s0, 'Cancel: nothing changed');
        assert.strictEqual(rme.state.preset, presetBefore, 'Cancel: the preset is the same');
        rme.loadPreset(2);
        choose('Set e to 0 and load');
        assert.strictEqual(rme.state.target.e, 0, 'the target is circular');
        assert.strictEqual(rme.state.preset, 2, 'the preset loaded');
        // Advanced off with a circular target asks nothing.
        setAdvanced(false);
        assert.ok(!choiceMock.open, 'circular target: Advanced off asks nothing');
        // Advanced off with an eccentric target, Set e to 0.
        setAdvanced(true);
        assert.ok(rme.setOrbits({ ...rme.state.target, e: 0.02 }, rme.state.diff), 'eccentric again');
        setAdvanced(false);
        choose('Set e to 0');
        assert.strictEqual(rme.state.target.e, 0, 'Set e to 0: circular');
        assert.ok(!mockDoc.body.classList.contains('advanced-on'), 'and Advanced stays off');
        home();
    });

    check('Randomized: switching between COEs, RMOEs, and position and velocity never changes a number', () => {
        let seed = 12345;
        const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const pick = arr => arr[Math.floor(rand() * arr.length)];
        const between = (lo, hi) => lo + (hi - lo) * rand();
        let tried = 0;
        for (let k = 0; k < 60; k++) {
            const model = pick(['cw', 'exact']);
            rme.selectMode('coe');
            if (rme.state.target.e > 0) rme.setOrbits({ ...rme.state.target, e: 0 }, { ...rme.state.diff, de: 0 });
            S.set({ constants: TEST_SET.id, propagator: 'kepler', ricModel: model, ricAxes: pick(['rectilinear', 'curvilinear']) });
            setAdvanced(model === 'exact');
            const eccentric = model === 'exact' && rand() < 0.4;
            const start = model === 'cw' ? pick(['coe', 'rmoe']) : 'coe';
            if (start === 'coe') {
                const target = { a: between(6900, 42200), e: eccentric ? between(0.001, 0.05) : 0, i: pick([0, between(0, 120)]),
                    raan: between(0, 360), argp: between(0, 360), nu: between(0, 360) };
                const diff = { da: between(-3, 3), de: pick([0, between(0, 0.0008)]), di: pick([0, between(-0.05, 0.05)]),
                    draan: pick([0, between(-0.05, 0.05)]), dargp: pick([0, between(-2, 2)]), dnu: pick([0, between(-2, 2)]) };
                if (!rme.setOrbits(target, diff)) continue;
            } else {
                rme.selectMode('rmoe');
                rme.set({ xc: between(-3, 3), yc0: between(-50, 50), C: pick([0, between(0, 10)]), zmax: pick([0, between(0, 10)]),
                    M0: between(0, 360), dM0: between(0, 360) });
            }
            tried++;
            const s0 = snap(), path0 = Float64Array.from(rme.sim().path);
            const modes = model === 'cw' ? ['coe', 'rmoe', 'pv'] : ['coe', 'pv'];
            for (let j = 0; j < 6; j++) rme.selectMode(pick(modes));
            rme.selectMode(start);
            assert.ok(!choiceMock.open, 'case ' + k + ': nothing was asked');
            assert.deepStrictEqual(snap(), s0, 'case ' + k + ' (' + model + (eccentric ? ', eccentric' : '') + ', from ' + start + '): numbers changed');
            assert.ok(rme.sim().path.every((x, i) => x === path0[i]), 'case ' + k + ': the motion changed');
        }
        assert.ok(tried > 40, 'enough cases ran: ' + tried);
        home();
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
