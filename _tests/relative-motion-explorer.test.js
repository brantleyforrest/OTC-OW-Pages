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
globalThis.MutationObserver = class { observe() {} disconnect() {} };

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
// The dialog asked before leaving COEs with an eccentric target.
const eDialogMock = getOrCreate('e-dialog', 'dialog');
eDialogMock.open = false;
eDialogMock.showModal = () => { eDialogMock.open = true; };
eDialogMock.close = () => { if (!eDialogMock.open) return; eDialogMock.open = false; eDialogMock.dispatchEvent('close'); };

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

        // Check element differences updated
        near(rme.state.diff.da, 2, 1e-6, 'diff.da = xc');
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
        const same = (a, b, tol, what) => KEYS.forEach(k => near(a[k], b[k], tol, what + ' ' + k));
        const fromCoes = () => {
            const R = globalThis.OrbitMath.rpo;
            const r = R.rmoeFromCoes(rme.state.target, R.coeFromDifference(rme.state.target, rme.state.diff));
            return { ...r, M0: r.M0 === null ? 0 : r.M0, dM0: r.dM0 === null ? 0 : r.dM0 };
        };
        const combos = [
            { ricModel: 'cw', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'rectilinear' },
            { ricModel: 'exact', ricAxes: 'curvilinear', propagator: 'cowell' }
        ];
        for (const combo of combos) for (const preset of [0, 3, 6]) {
            S.set({ constants: TEST_SET.id, propagator: 'kepler', ...combo });
            rme.selectMode('rmoe');
            rme.loadPreset(preset);
            const r0 = { ...rme.state.rmoe };
            rme.selectMode('coe');
            same(rme.state.rmoe, r0, 1e-9, 'RMOEs to COEs');
            same(fromCoes(), rme.state.rmoe, 1e-6, 'COEs give the RMOEs');
            // A settings change in COE mode: the COEs and RMOEs must still agree.
            S.set({ constants: TEST_SET.id === 'course' ? 'wgs84' : 'course' });
            same(fromCoes(), rme.state.rmoe, 1e-6, 'after a constants change, COEs give the RMOEs');
            const r1 = { ...rme.state.rmoe };
            rme.selectMode('pv');
            rme.selectMode('rmoe');
            same(rme.state.rmoe, r1, 1e-6, 'COEs to position and velocity to RMOEs');
            rme.selectMode('coe');
            same(rme.state.rmoe, r1, 1e-6, 'and back to COEs');
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
            S.set({ constants: TEST_SET.id, propagator: 'kepler', ...combo });
            rme.selectMode('rmoe');
            rme.loadPreset(preset);
            const path0 = Float64Array.from(rme.sim().path);
            for (const mode of ['coe', 'pv', 'rmoe', 'coe']) {
                rme.selectMode(mode);
                const what = combo.ricModel + '/' + combo.ricAxes + ' preset ' + preset + ' in ' + mode;
                assert.strictEqual(rme.sim().path.length, path0.length, what + ': path length');
                assert.ok(gap(rme.sim().path, path0) < 1e-6, what + ': path moved ' + gap(rme.sim().path, path0) + ' km');
            }
        }
        S.set(start);
        rme.selectMode('rmoe');
    });

    check('Leaving COEs with an eccentric target asks first: stay keeps everything, set makes e 0', () => {
        const S = globalThis.OrbitConstants.Settings, start = S.get();
        S.set({ constants: TEST_SET.id, ricModel: 'exact' });
        mockDoc.body.classList.add('advanced-on');
        rme.selectMode('coe');
        assert.ok(rme.setOrbits({ a: 7000, e: 0.01, i: 30, raan: 0, argp: 0, nu: 0 }, { da: 1, de: 0.001 }), 'eccentric target set');
        const path0 = Float64Array.from(rme.sim().path);
        for (const mode of ['rmoe', 'pv']) {
            rme.selectMode(mode);
            assert.ok(eDialogMock.open, mode + ': the dialog opens');
            assert.strictEqual(rme.state.mode, 'coe', mode + ': still in COEs while asking');
            getOrCreate('e-dialog-stay').dispatchEvent('click');
            assert.ok(!eDialogMock.open, mode + ': Stay closes the dialog');
            assert.strictEqual(rme.state.mode, 'coe', mode + ': Stay keeps COEs');
            near(rme.state.target.e, 0.01, 1e-12, mode + ': Stay keeps e');
            assert.ok(rme.sim().path.every((x, k) => x === path0[k]), mode + ': Stay keeps the motion');
        }
        // Escape (a close without Set) also stays.
        rme.selectMode('rmoe');
        eDialogMock.close();
        assert.strictEqual(rme.state.mode, 'coe', 'Escape keeps COEs');
        rme.selectMode('rmoe');
        getOrCreate('e-dialog-set').dispatchEvent('click');
        assert.ok(!eDialogMock.open, 'Set closes the dialog');
        assert.strictEqual(rme.state.mode, 'rmoe', 'Set switches to RMOEs');
        assert.strictEqual(rme.state.target.e, 0, 'Set makes the target circular');
        // A circular target switches without asking.
        rme.selectMode('coe');
        rme.selectMode('pv');
        assert.ok(!eDialogMock.open && rme.state.mode === 'pv', 'circular target: no dialog');
        mockDoc.body.classList.remove('advanced-on');
        S.set(start);
        rme.selectMode('rmoe');
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
