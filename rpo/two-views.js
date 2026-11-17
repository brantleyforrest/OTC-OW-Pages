// Relative Motion: Two Views. One simulation, five views: both spacecraft are propagated on
// their own two-body orbits (the exact model in RpoMath.relativeState), and every pane shows
// that same relative position at the same time. No pane draws a path from a formula for
// relative motion; the dashed course-model path is an overlay only.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = id => document.getElementById(id);
    const Kit = window.ToolKit, M = window.RpoMath, V = window.RpoViews;

    /* ---------- Data tables ----------
     * To add a preset, add one row to PRESETS: group (the <optgroup>), name, target (a key of
     * TARGETS), diff (only the differences that are not zero: da in km, de, and di, draan, dargp,
     * dnu in degrees, always chase minus target), span in target revs, range ('small' or
     * 'large', which slider ranges open), scale ('mag' or 'true'), model (Course Model on or
     * off), and notice (the What to Notice text). The page treats every preset the same way. */
    const TARGETS = {
        geo: { a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 },
        gps: { a: 26562, e: 0, i: 55, raan: 30, argp: 0, nu: 0 },
        leo: { a: 7000, e: 0, i: 51.6, raan: 30, argp: 0, nu: 0 },
        gpsEccentric: { a: 26562, e: 0.3, i: 55, raan: 30, argp: 0, nu: 0 }
    };
    const SHORTCUTS = ['geo', 'gps', 'leo'];

    const PRESETS = [
        { group: 'Small', name: 'Position only', target: 'geo', diff: { dnu: 0.05 }, span: 2, range: 'small', scale: 'mag', model: false,
          notice: 'Same orbit, 37 km ahead. Only the position differs, so the gap never changes. In RIC chase sits still: a perch.' },
        { group: 'Small', name: 'Size only', target: 'geo', diff: { da: 5 }, span: 3, range: 'small', scale: 'mag', model: false,
          notice: 'A larger orbit takes longer to go around (15 s per rev here), so chase falls about 47 km farther behind every rev: a linear drift backward. A smaller orbit drifts forward.' },
        { group: 'Small', name: 'Shape only', target: 'geo', diff: { de: 0.0003 }, span: 2, range: 'small', scale: 'mag', model: false,
          notice: 'Same period, different shape. Chase dips below and speeds up at perigee, then rises and slows at apogee. In RIC that is a 2-by-1 ellipse that stays put: a stationary NMC.' },
        { group: 'Small', name: 'Tilt only', target: 'geo', diff: { di: 0.02 }, span: 2, range: 'small', scale: 'mag', model: false,
          notice: 'The two orbit planes cross twice per rev. Chase swings left and right of the target’s plane once per rev.' },
        { group: 'Small', name: 'Twist only', target: 'gps', diff: { draan: 0.03 }, span: 2, range: 'small', scale: 'mag', model: false,
          notice: 'Turning the plane about Earth’s axis also makes the planes cross twice per rev, and shifts chase along the orbit.' },
        { group: 'Small', name: 'Size and shape', target: 'geo', diff: { da: -2, de: 0.0003 }, span: 3, range: 'small', scale: 'mag', model: false,
          notice: 'The ellipse and the drift happen together: loops that walk forward. A drifting NMC.' },
        { group: 'Small', name: 'Size, shape, and tilt', target: 'geo', diff: { da: -2, de: 0.0003, di: 0.02 }, span: 3, range: 'small', scale: 'mag', model: false,
          notice: 'Loops, drift, and side-to-side swing together: a corkscrew. Turn the 3D box to see it.' },
        { group: 'Small', name: 'Twist and size', target: 'gps', diff: { draan: 0.03, da: 3 }, span: 3, range: 'small', scale: 'mag', model: false,
          notice: 'A side-to-side swing that drifts backward.' },
        { group: 'Large', name: 'Lower orbit', target: 'leo', diff: { da: -200 }, span: 3, range: 'large', scale: 'true', model: false,
          notice: 'Chase’s orbit is smaller, so each rev takes about 4 minutes less. Around Earth it pulls a little farther ahead every lap. In RIC that is the same fact: below the target and moving forward.' },
        { group: 'Large', name: 'Stretched orbit', target: 'leo', diff: { de: 0.03 }, span: 2, range: 'large', scale: 'true', model: false,
          notice: 'Same period, but chase is 210 km below the target’s altitude at perigee and 210 km above it at apogee, running ahead and falling behind as its speed changes. In RIC: the 2-by-1 ellipse, large enough to see where it comes from.' },
        { group: 'Large', name: 'Tilted orbit', target: 'leo', diff: { di: 10 }, span: 2, range: 'large', scale: 'true', model: false,
          notice: 'Same size and shape, tilted plane. The orbits cross twice per rev. Between crossings chase is up to about 1,200 km to one side.' },
        { group: 'Large', name: 'All three', target: 'leo', diff: { da: 300, de: 0.04, di: 8 }, span: 3, range: 'large', scale: 'true', model: false,
          notice: 'Larger, stretched, and tilted: chase falls behind, loops, and swings side to side at once. This is the corkscrew at a scale where both orbits are plain to see.' },
        { group: 'Limits', name: 'Far ahead', target: 'leo', diff: { dnu: 3 }, span: 2, range: 'large', scale: 'true', model: true,
          notice: 'Same orbit, 3° ahead: a perch. The course model puts a perch on the in-track axis. The orbit curves, so chase is really about 10 km below that line. The hollow marker is the course model. Close in, the gap vanishes.' },
        { group: 'Limits', name: 'Eccentric target', target: 'gpsEccentric', diff: { dnu: 1 }, span: 2, range: 'large', scale: 'mag', model: false,
          notice: 'Both spacecraft share one eccentric orbit, 1° apart at perigee. On a circular orbit that would be a perch. Here the gap swings between about 175 and 325 km every rev, because both speed up near perigee and slow near apogee. This is why the course model needs a circular target.' }
    ];
    const DEFAULT_PRESET = 'Shape only';

    // Slider ranges for the Difference column: [min, max, step].
    const SMALL = {
        geo: { da: [-50, 50, 1], de: [0, 0.001, 0.00005], di: [-0.05, 0.05, 0.005], draan: [-0.05, 0.05, 0.005], dargp: [-180, 180, 5], dnu: [-0.1, 0.1, 0.005] },
        gps: { da: [-30, 30, 1], de: [0, 0.001, 0.00005], di: [-0.05, 0.05, 0.005], draan: [-0.05, 0.05, 0.005], dargp: [-180, 180, 5], dnu: [-0.1, 0.1, 0.005] },
        leo: { da: [-10, 10, 0.5], de: [0, 0.002, 0.0001], di: [-0.1, 0.1, 0.01], draan: [-0.1, 0.1, 0.01], dargp: [-180, 180, 5], dnu: [-0.2, 0.2, 0.01] }
    };
    const LARGE = { da: [-1000, 1000, 10], de: [0, 0.3, 0.005], di: [-30, 30, 0.5], draan: [-30, 30, 0.5], dargp: [-180, 180, 5], dnu: [-30, 30, 0.5] };
    const TARGET_LIMITS = { a: [6500, 50000], e: [0, 0.9], i: [0, 180], raan: [0, 360], argp: [0, 360], nu: [0, 360] };
    const ROWS = [
        { key: 'a', d: 'da', name: 'a', unit: 'km', digits: 3 },
        { key: 'e', d: 'de', name: 'e', unit: '', digits: 6 },
        { key: 'i', d: 'di', name: 'i', unit: 'deg', digits: 4 },
        { key: 'raan', d: 'draan', name: 'Ω', unit: 'deg', digits: 4 },
        { key: 'argp', d: 'dargp', name: 'ω', unit: 'deg', digits: 4 },
        { key: 'nu', d: 'dnu', name: 'ν', unit: 'deg', digits: 4 }
    ];
    const ZERO_DIFF = { da: 0, de: 0, di: 0, draan: 0, dargp: 0, dnu: 0 };
    const POINTS_PER_REV = 360;
    const MESSAGES = {
        a: 'The semi-major axis must be positive.',
        e: 'Eccentricity must be at least 0 and below 0.95.',
        perigee: 'That orbit would pass within 100 km of Earth’s surface.'
    };

    /* ---------- State ---------- */
    const state = {
        preset: PRESETS.findIndex(p => p.name === DEFAULT_PRESET),
        target: null, diff: null,
        range: 'small', span: 2,
        t: 0, playing: true, speed: 0.1,
        trail: 'full', roll: 1, stepSize: 0.0625,
        scale: 'mag', mag: 'auto',
        frame: 'ECI', camera: 'earth',
        axes: false, equator: false, orbits: true, carried: true, shadows: true, labels: true, model: false, shared: true
    };
    let sim = null;          // everything derived from the inputs; rebuilt only when they change
    let dirty = true;

    /* ---------- Stage ---------- */
    let THREE = null;
    try { THREE = await import(THREE_URL); } catch (err) { THREE = null; }
    const view = $('view');
    const stage = V.createFiveViewStage(view, { THREE, onResize: () => { if (sim) { refit(); drawAll(); } } });
    const planeNames = ['left', 'behind', 'above'];
    const note = document.createElement('div');
    note.className = 'rpo-note';
    note.style.display = 'none';
    view.querySelector('.rpo-inertial').appendChild(note);

    /* ---------- Derived values ---------- */
    const isCircular = coe => coe.e < 1e-6;
    function chaseOf(target, diff) { return M.coeFromDifference(target, diff); }
    function isGeoTarget() { const t = state.target; return Math.abs(t.a - M.GEO_A) < 0.5 && t.i < 1e-6 && t.e < 1e-6; }

    function rebuild() {
        const target = state.target, chase = chaseOf(target, state.diff);
        const PT = M.period(target.a), PC = M.period(chase.a), n = M.meanMotion(target.a);
        const spanT = state.span * PT;
        const count = Math.round(POINTS_PER_REV * state.span) + 1;
        const times = new Float64Array(count);
        for (let k = 0; k < count; k++) times[k] = spanT * k / (count - 1);
        const rho = M.sampleRelative(target, chase, 0, spanT, count);
        const path = V.framePath(target, times, rho);
        const circular = isCircular(target);
        const rmoe = circular ? M.rmoeFromCoes(target, chase) : null;
        const modelPath = circular ? M.sampleTrajectory(rmoe, n, 0, spanT, count) : null;
        sim = { target, chase, PT, PC, n, spanT, count, times, rho, path, circular, rmoe, modelPath, maxRange: path.maxRho };
        if (stage.inertial) {
            stage.inertial.setOrbit(target);
            stage.inertial.setChaseOrbit(chase);
            stage.inertial.setPath(path);
        }
        state.t = Math.min(state.t, spanT);
        applyViewOptions();
        refit();
        updateStaticPanels();
        dirty = true;
    }

    /* ---------- Fitting the RIC panes ---------- */
    function fitPaths() {
        const paths = [sim.rho];
        if (state.model && sim.modelPath) paths.push(sim.modelPath);
        return paths;
    }
    function refit() {
        if (!sim) return;
        const planes = stage.visiblePlanes();
        const fit = planes.length ? V.fitPanes(planes, fitPaths(), state.shared) : { box: V.boundingBox(fitPaths()) };
        // Panes that are hidden now still get the shared scale, so they are right when shown.
        planeNames.map(n => stage[n]).filter(p => planes.indexOf(p) < 0).forEach(p => V.fitPanes([p], fitPaths(), true));
        if (stage.box) {
            const b = fit.box;
            stage.box.setExtent(Math.max.apply(null, [0, 1, 2].map(k => Math.max(Math.abs(b.min[k]), Math.abs(b.max[k])))));
        }
    }

    // Wheel or pinch on a flat pane zooms it about the pointer; with Shared Scale on, all RIC panes zoom.
    function zoomPlane(plane, f, px, py) {
        const [w, h] = plane.size();
        const s0 = 1 / plane.kmPerPx(), s1 = s0 * f;
        const anchor = px === undefined ? plane.toKm(w / 2, h / 2) : plane.toKm(px, py);
        const ax = px === undefined ? w / 2 : px, ay = py === undefined ? h / 2 : py;
        plane.setScale(s1, [anchor[0] + (ax - w / 2) / s1, anchor[1] + (ay - h / 2) / s1]);
    }
    planeNames.forEach(name => {
        const canvas = view.querySelector('.rpo-' + name + ' canvas');
        canvas.style.touchAction = 'none';
        const pts = new Map();
        let pinch = null;
        function zoom(f, px, py) {
            const plane = stage[name];
            if (state.shared) planeNames.forEach(n => zoomPlane(stage[n], f, n === name ? px : undefined, n === name ? py : undefined));
            else zoomPlane(plane, f, px, py);
            dirty = true;
        }
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const r = canvas.getBoundingClientRect();
            zoom(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
        });
        canvas.addEventListener('pointermove', e => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pts.size === 2 && pinch) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                const r = canvas.getBoundingClientRect();
                zoom(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
                pinch = d;
            }
        });
        const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    });

    /* ---------- Drawing ---------- */
    function sampleIndex(t) {
        return Math.max(0, Math.min(sim.count - 1, Math.floor(t / sim.spanT * (sim.count - 1) + 1e-9)));
    }
    function trailRange() {
        const to = sampleIndex(state.t);
        if (state.trail === 'off') return [to, to];
        if (state.trail === 'rolling') return [sampleIndex(Math.max(0, state.t - state.roll * sim.PT)), to];
        return [0, to];
    }

    function drawAll() {
        if (!sim) return;
        const rel = M.relativeState(sim.target, sim.chase, state.t);
        const [from, to] = trailRange();
        const trail = to > from ? sim.rho.subarray(3 * from, 3 * (to + 1)) : null;
        const showModel = state.model && sim.circular;
        const modelNow = showModel ? M.stateFromRmoe(sim.rmoe, sim.n, state.t) : null;
        const data = {
            chase: rel.rho,
            trail,
            ghosts: state.trail === 'off' ? [] : [sim.rho],
            model: showModel ? sim.modelPath : null,
            modelChase: modelNow,
            rmoe: showModel ? M.rmoeAt(sim.rmoe, sim.n, state.t) : null,
            n: sim.n
        };
        planeNames.forEach(n => stage[n].draw(data));
        if (stage.box) {
            stage.box.setShadows(state.shadows);
            stage.box.update({ chase: rel.rho, trail, ghost: state.trail === 'off' ? null : sim.rho, model: showModel ? sim.modelPath : null });
        }
        if (stage.inertial) stage.inertial.update({ t: state.t, rho: rel.rho, basis: rel.basis, rT: rel.rT, from, to, ghost: state.trail !== 'off' });
        updateLive(rel);
        updateTime();
    }

    /* ---------- Panels ---------- */
    const fmtNum = (v, digits) => String(Number(v.toFixed(digits)));
    const signed = (v, digits) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);
    function hm(seconds) {
        const h = Math.floor(seconds / 3600), m = Math.floor((seconds - 3600 * h) / 60);
        return h + ' h ' + String(m).padStart(2, '0') + ' min';
    }
    function updateTime() {
        const revs = state.t / sim.PT;
        $('time-read').textContent = revs.toFixed(2) + ' rev · ' + hm(state.t);
        $('scrubber').value = String(Math.round(state.t / sim.spanT * 1000));
        $('lv-time').textContent = revs.toFixed(3) + ' rev';
    }
    function kmText(v) { return M.fmt.km(Math.abs(v) < 5e-7 ? 0 : v); }
    function updateLive(rel) {
        $('lv-x').textContent = kmText(rel.rho[0]);
        $('lv-y').textContent = kmText(rel.rho[1]);
        $('lv-z').textContent = kmText(rel.rho[2]);
        $('lv-range').textContent = kmText(rel.range);
        $('lv-vx').textContent = M.fmt.ms(Math.abs(rel.rhoDot[0]) < 5e-10 ? 0 : rel.rhoDot[0]);
        $('lv-vy').textContent = M.fmt.ms(Math.abs(rel.rhoDot[1]) < 5e-10 ? 0 : rel.rhoDot[1]);
        $('lv-vz').textContent = M.fmt.ms(Math.abs(rel.rhoDot[2]) < 5e-10 ? 0 : rel.rhoDot[2]);
    }
    function updateStaticPanels() {
        $('lv-pt').textContent = sim.PT.toFixed(1) + ' s';
        $('lv-pc').textContent = sim.PC.toFixed(1) + ' s';
        $('lv-dp').textContent = signed(sim.PC - sim.PT, 1) + ' s';
        $('lv-model').style.display = sim.circular ? '' : 'none';
        $('lv-nomodel').style.display = sim.circular ? 'none' : '';
        if (sim.circular) {
            const e = sim.rmoe;
            const zero = v => (Math.abs(v) < 5e-7 ? 0 : v);
            $('lv-motion').textContent = M.classifyMotion(e).label;
            $('lv-xc').textContent = M.fmt.km(zero(e.xc));
            $('lv-yc0').textContent = M.fmt.km(zero(e.yc0));
            $('lv-c').textContent = M.fmt.km(zero(e.C));
            $('lv-m0').textContent = e.M0 === null ? 'undefined' : M.fmt.deg(e.M0) + '°';
            $('lv-zmax').textContent = M.fmt.km(zero(e.zmax));
            $('lv-dm0').textContent = e.dM0 === null ? 'undefined' : M.fmt.deg(e.dM0) + '°';
            const drift = M.driftRate(e, sim.n, sim.target.a).kmPerRev;
            $('lv-drift').textContent = M.fmt.km(zero(drift));
        }
        const fit = M.modelFit(sim.target, sim.maxRange);
        const words = { good: 'Good', fair: 'Fair', poor: 'Poor', na: 'Does Not Apply' };
        const pct = 100 * sim.maxRange / sim.target.a;
        $('lv-fit').innerHTML = '<span class="fit-' + fit + '">' + words[fit] + '</span>' +
            (fit === 'na' ? '' : ' <span style="color: var(--text-muted); font-weight: 400;">(largest range ' + (pct < 0.01 ? pct.toExponential(1) : pct.toFixed(pct < 1 ? 3 : 2)) + '% of a)</span>');
        $('opt-model').disabled = !sim.circular;
        $('opt-model').closest('label').classList.toggle('ctl-off', !sim.circular);
        updateNotes();
        updateMagRead();
        // True scale with orbits that differ by less than a pixel.
        const tiny = state.scale === 'true' && sim.maxRange < 0.005 * sim.target.a;
        note.textContent = 'At true scale these two orbits differ by less than a pixel. Switch to Magnified.';
        note.style.display = tiny && stage.inertial ? '' : 'none';
    }
    function updateNotes() {
        const t = state.target, c = sim.chase, notes = [];
        if (t.e < 1e-6 || c.e < 1e-6) notes.push('For a circular orbit only ω + ν matters: together they are the position along the orbit.');
        if (t.i < 1 && Math.abs(state.diff.draan) > 1e-9) notes.push('At zero inclination, turning the node only moves chase along the orbit.');
        if (t.e > 1e-6) notes.push('The target’s orbit is not circular, so the course model does not apply.');
        if (Math.abs(state.diff.dnu) > 1e-12 && (t.e > 1e-6 || c.e > 1e-6 || Math.abs(state.diff.da) > 1e-9))
            notes.push('A difference in ν is a fixed distance along the track only when both orbits are circular and the same size.');
        $('el-notes').innerHTML = notes.map(s => '<li>' + s + '</li>').join('');
        const show = isCircular(t) && c.e > 1e-9;
        $('starts-row').style.display = show ? '' : 'none';
        if (show) {
            const Mc = M.wrap360(M.meanFromTrue(c.nu, c.e) * M.R2D);
            $('starts').querySelectorAll('button').forEach(b => {
                const d = Math.abs(M.wrap180(Mc - Number(b.dataset.value)));
                b.setAttribute('aria-pressed', String(d < 0.05));
            });
        }
        $('target-pick').querySelectorAll('button').forEach(b => {
            const s = TARGETS[b.dataset.value];
            b.setAttribute('aria-pressed', String(Math.abs(t.a - s.a) < 1e-9 && Math.abs(t.i - s.i) < 1e-9 && Math.abs(t.raan - s.raan) < 1e-9 && t.e < 1e-12));
        });
        const geo = isGeoTarget();
        $('frame-pick').querySelector('[data-value="ECEF"]').disabled = !geo;
    }

    /* ---------- The element table ---------- */
    const table = $('el-table');
    const cells = {};
    function buildTable() {
        let html = '<span></span><span class="el-head">Target</span><span class="el-head">Difference</span><span class="el-head">Chase</span>';
        ROWS.forEach(r => {
            html += '<span class="el-name">' + r.name + (r.unit ? ' <small>' + r.unit + '</small>' : '') + '</span>' +
                '<span class="col-target"><input type="number" step="any" data-col="target" data-key="' + r.key + '" aria-label="Target ' + r.name + '"></span>' +
                '<span class="el-diff"><input type="number" step="any" data-col="diff" data-key="' + r.key + '" aria-label="Difference in ' + r.name + '">' +
                '<input type="range" data-col="slider" data-key="' + r.key + '" aria-label="Difference in ' + r.name + ' slider"></span>' +
                '<span class="col-chase"><input type="number" step="any" data-col="chase" data-key="' + r.key + '" aria-label="Chase ' + r.name + '"></span>';
        });
        table.innerHTML = html;
        ROWS.forEach(r => {
            cells[r.key] = {
                target: table.querySelector('[data-col="target"][data-key="' + r.key + '"]'),
                diff: table.querySelector('[data-col="diff"][data-key="' + r.key + '"]'),
                slider: table.querySelector('[data-col="slider"][data-key="' + r.key + '"]'),
                chase: table.querySelector('[data-col="chase"][data-key="' + r.key + '"]')
            };
        });
    }
    function sliderRanges() {
        if (state.range === 'large') return LARGE;
        const near = SHORTCUTS.slice().sort((p, q) => Math.abs(TARGETS[p].a - state.target.a) - Math.abs(TARGETS[q].a - state.target.a))[0];
        return SMALL[near];
    }
    function fillTable(skip) {
        const chase = chaseOf(state.target, state.diff);
        const ranges = sliderRanges();
        ROWS.forEach(r => {
            const c = cells[r.key];
            let [lo, hi, step] = ranges[r.d];
            if (r.key === 'e' && state.target.e > 1e-6) lo = -state.target.e;
            c.slider.min = lo; c.slider.max = hi; c.slider.step = step;
            c.slider.value = String(Math.min(hi, Math.max(lo, state.diff[r.d])));
            if (c.target !== skip) c.target.value = fmtNum(state.target[r.key], r.digits);
            if (c.diff !== skip) c.diff.value = fmtNum(state.diff[r.d], r.digits);
            if (c.chase !== skip) c.chase.value = fmtNum(chase[r.key], r.digits);
        });
    }
    function clearBad() {
        table.querySelectorAll('input.bad').forEach(i => i.classList.remove('bad'));
        $('el-msg').textContent = '';
    }
    // Try new orbits; keep the last valid ones on screen if either orbit is not allowed.
    function commit(target, diff, field) {
        const chase = chaseOf(target, diff);
        const problem = M.orbitProblem(target) || M.orbitProblem(chase);
        if (problem) {
            if (field) field.classList.add('bad');
            $('el-msg').textContent = MESSAGES[problem];
            return false;
        }
        clearBad();
        state.target = target;
        state.diff = diff;
        rebuild();
        fillTable(field && field.type === 'number' ? field : null);
        return true;
    }
    table.addEventListener('input', e => {
        const el = e.target;
        if (el.dataset.col !== 'slider') return;
        const row = ROWS.find(r => r.key === el.dataset.key);
        commit({ ...state.target }, { ...state.diff, [row.d]: Number(el.value) }, el);
    });
    table.addEventListener('change', e => {
        const el = e.target;
        const row = ROWS.find(r => r.key === el.dataset.key);
        if (!row || el.dataset.col === 'slider') return;
        const v = Number(el.value);
        if (el.value.trim() === '' || !isFinite(v)) { fillTable(); return; }
        if (el.dataset.col === 'target') {
            const [lo, hi] = TARGET_LIMITS[row.key];
            const target = { ...state.target, [row.key]: Math.min(hi, Math.max(lo, v)) };
            if (commit(target, { ...state.diff }, el)) fillTable();
        } else if (el.dataset.col === 'diff') {
            if (commit({ ...state.target }, { ...state.diff, [row.d]: v }, el)) fillTable();
        } else {
            const chase = { ...chaseOf(state.target, state.diff), [row.key]: v };
            if (commit({ ...state.target }, M.coeDifference(state.target, chase), el)) fillTable();
        }
    });

    /* ---------- Presets ---------- */
    function loadPreset(index) {
        const p = PRESETS[index];
        state.preset = index;
        state.target = { ...TARGETS[p.target] };
        state.diff = { ...ZERO_DIFF, ...p.diff };
        state.range = p.range;
        state.span = p.span;
        state.scale = p.scale;
        state.mag = 'auto';
        state.model = p.model;
        state.t = 0;
        if (!isGeoTarget()) state.frame = 'ECI';
        selectRange(state.range);
        $('span').value = String(state.span);
        $('opt-model').checked = state.model;
        selectScale(state.scale);
        selectFrame(state.frame);
        $('notice').textContent = p.notice;
        $('preset').value = String(index);
        clearBad();
        rebuild();
        fillTable();
        if (stage.inertial) stage.inertial.resetView();
        setPlaying(state.playing);
    }
    (function buildPresetSelect() {
        const select = $('preset');
        const groups = {};
        PRESETS.forEach((p, k) => {
            if (!groups[p.group]) { groups[p.group] = document.createElement('optgroup'); groups[p.group].label = p.group; select.appendChild(groups[p.group]); }
            groups[p.group].appendChild(new Option(p.name, String(k)));
        });
        select.addEventListener('change', () => loadPreset(Number(select.value)));
    })();
    $('reset-preset').addEventListener('click', () => loadPreset(state.preset));

    const selectTargetPick = Kit.bindSegmented($('target-pick'), key => {
        const s = TARGETS[key];
        commit({ ...state.target, a: s.a, e: 0, i: s.i, raan: s.raan, argp: 0, nu: 0 }, { ...state.diff }, null);
        if (!isGeoTarget() && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); applyViewOptions(); }
        fillTable();
        updateNotes();
    });
    const selectRange = Kit.bindSegmented($('range-pick'), value => { state.range = value; if (state.target) fillTable(); });
    Kit.bindSegmented($('starts'), value => {
        const chase = chaseOf(state.target, state.diff);
        const Mstar = Number(value);
        const Mc = M.meanFromTrue(chase.nu, chase.e) * M.R2D;
        chase.argp = M.wrap360(chase.argp + Mc - Mstar);
        chase.nu = M.trueFromMean(Mstar * M.D2R, chase.e);
        commit({ ...state.target }, M.coeDifference(state.target, chase), null);
        fillTable();
    });

    /* ---------- Playback ---------- */
    function setPlaying(on) {
        state.playing = on;
        $('play').textContent = on ? 'Pause' : 'Play';
    }
    $('play').addEventListener('click', () => {
        setPlaying(!state.playing);
        dirty = true;
    });
    $('restart').addEventListener('click', () => { state.t = 0; dirty = true; });
    function step(sign) {
        state.t = Math.min(sim.spanT, Math.max(0, state.t + sign * state.stepSize * sim.PT));
        setPlaying(false);
        dirty = true;
    }
    $('step-back').addEventListener('click', () => step(-1));
    $('step-fwd').addEventListener('click', () => step(1));
    $('scrubber').addEventListener('input', e => { state.t = Number(e.target.value) / 1000 * sim.spanT; dirty = true; });
    Kit.bindSegmented($('speed'), v => { state.speed = Number(v); });
    $('span').addEventListener('change', e => { state.span = Number(e.target.value); rebuild(); });
    Kit.bindSegmented($('trail'), v => {
        state.trail = v;
        $('roll-wrap').classList.toggle('ctl-off', v !== 'rolling');
        $('roll').disabled = v !== 'rolling';
        dirty = true;
    });
    $('roll').addEventListener('input', e => {
        state.roll = Number(e.target.value);
        $('roll-read').textContent = state.roll + (state.roll === 1 ? ' rev' : ' revs');
        dirty = true;
    });
    $('step-size').addEventListener('change', e => { state.stepSize = Number(e.target.value); });
    $('fit-views').addEventListener('click', () => { refit(); dirty = true; });
    $('reset-view').addEventListener('click', () => {
        if (stage.box) { stage.box.resetView(); stage.selectBoxView('3d'); }
        if (stage.inertial) stage.inertial.resetView();
        dirty = true;
    });

    /* ---------- View options ---------- */
    function autoK() { return stage.inertial ? stage.inertial.autoMagnification() : 1; }
    function magFromSlider(f) { return Math.exp(f * Math.log(4 * Math.max(autoK(), 1))); }
    function sliderFromMag(k) { const top = Math.log(4 * Math.max(autoK(), 1)); return top > 0 ? Math.log(k) / top : 0; }
    function currentMag() {
        if (state.scale === 'true') return 1;
        if (state.mag === 'auto') return autoK();
        return Math.min(4 * autoK(), Math.max(1, state.mag));
    }
    function updateMagRead() {
        const k = currentMag();
        $('mag').value = String(Math.round(sliderFromMag(k) * 1000));
        $('mag-read').textContent = k === 1 ? '1×' : (k >= 10 ? Math.round(k).toLocaleString('en-US') : k.toFixed(1)) + '×';
        $('mag-row').classList.toggle('ctl-off', state.scale === 'true');
        $('mag').disabled = state.scale === 'true';
    }
    function applyViewOptions() {
        const inertial = stage.inertial;
        stage.setBadge(state.frame);
        if (!inertial) return;
        inertial.setMagnification(state.scale === 'true' ? 1 : state.mag === 'auto' ? 'auto' : currentMag());
        inertial.setFrame(state.frame);
        inertial.setCamera(state.camera);
        inertial.setTrails({ inertial: true, carried: state.carried });
        inertial.setExtras({ axes: state.axes, equator: state.equator, orbits: state.orbits });
        inertial.setLabels(state.labels);
    }
    const selectScale = Kit.bindSegmented($('scale-pick'), v => {
        state.scale = v;
        applyViewOptions();
        if (sim) { updateStaticPanels(); if (stage.inertial) stage.inertial.resetView(); }
        dirty = true;
    });
    $('mag').addEventListener('input', e => {
        state.mag = magFromSlider(Number(e.target.value) / 1000);
        applyViewOptions();
        updateMagRead();
        dirty = true;
    });
    const selectFrame = Kit.bindSegmented($('frame-pick'), v => {
        state.frame = v === 'ECEF' && isGeoTarget() ? 'ECEF' : 'ECI';
        applyViewOptions();
        dirty = true;
    });
    Kit.bindSegmented($('camera-pick'), v => { state.camera = v; applyViewOptions(); dirty = true; });
    [['opt-axes', 'axes'], ['opt-equator', 'equator'], ['opt-orbits', 'orbits'], ['opt-carried', 'carried'],
     ['opt-shadows', 'shadows'], ['opt-labels', 'labels']].forEach(([id, key]) => {
        $(id).addEventListener('change', e => { state[key] = e.target.checked; applyViewOptions(); dirty = true; });
    });
    $('opt-model').addEventListener('change', e => { state.model = e.target.checked; refit(); dirty = true; });
    $('opt-shared').addEventListener('change', e => { state.shared = e.target.checked; refit(); dirty = true; });

    /* ---------- Start ---------- */
    buildTable();
    loadPreset(state.preset);

    Kit.startLoop(seconds => {
        if (state.playing && sim) {
            state.t += seconds * state.speed * sim.PT;
            // Playback never stops by itself: at the end of the span it starts over.
            if (state.t >= sim.spanT) state.t = 0;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        drawAll();
    });

    // For checks in the browser console.
    window.twoViews = {
        state, sim: () => sim, stage, loadPreset, presets: PRESETS, redraw: () => { dirty = true; }, drawNow: drawAll,
        setOrbits(target, diff) { const ok = commit({ ...target }, { ...ZERO_DIFF, ...diff }, null); fillTable(); return ok; }
    };
})();
