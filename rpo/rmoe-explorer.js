// RMOE Explorer, Set RMOEs mode. The six relative motion orbital elements are the inputs; the
// course model (RpoMath.stateFromRmoe, the CW solution) gives chase's motion, which is drawn in the
// view from the left, a second RIC view (behind, above, or the 3D box), and an inertial view.
// Annotations mark what each RMOE controls. The Set Position and Velocity mode comes in a later
// stage; the page is laid out so it can be added beside this one.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = id => document.getElementById(id);
    const Kit = window.ToolKit, M = window.RpoMath, V = window.RpoViews;

    /* ---------- Data tables ----------
     * TARGETS: the three target orbits. RANGES: slider [min, max, step] per target; distances in km,
     * angles in degrees. PRESETS: name, the RMOEs that are not zero, an optional second view, and
     * the What to Notice text. Add a preset by adding one row. */
    const TARGETS = {
        geo: { a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 },
        gps: { a: 26562, e: 0, i: 55, raan: 30, argp: 0, nu: 0 },
        leo: { a: 7000, e: 0, i: 51.6, raan: 30, argp: 0, nu: 0 }
    };
    const RANGES = {
        geo: { xc: [-10, 10, 0.5], yc0: [-100, 100, 1], C: [0, 30, 0.5], M0: [0, 355, 5], zmax: [0, 30, 0.5], dM0: [0, 355, 5] },
        gps: { xc: [-5, 5, 0.25], yc0: [-50, 50, 0.5], C: [0, 15, 0.25], M0: [0, 355, 5], zmax: [0, 15, 0.25], dM0: [0, 355, 5] },
        leo: { xc: [-3, 3, 0.1], yc0: [-30, 30, 0.5], C: [0, 10, 0.25], M0: [0, 355, 5], zmax: [0, 10, 0.25], dM0: [0, 355, 5] }
    };
    const ROWS = [
        { key: 'xc', sym: 'x<small>C</small>', unit: 'km', meaning: 'Height of the NMC center; it sets the drift',
          notice: 'x_C moves the ellipse up or down and sets how fast it drifts. Above the target it drifts backward; below, forward.' },
        { key: 'yc0', sym: 'y<small>C0</small>', unit: 'km', meaning: 'Where the NMC center is along the track at epoch',
          notice: 'y_C0 slides the ellipse along the track.' },
        { key: 'C', sym: 'C', unit: 'km', meaning: 'Size of the NMC: radial semi-axis C, in-track semi-axis 2C',
          notice: 'C sets the ellipse’s size. It is always 2C long and C tall on each side of its center.' },
        { key: 'M0', sym: 'M<small>0</small>', unit: '°', meaning: 'Where chase is on the NMC: 0° bottom, 90° front, 180° top, 270° back',
          notice: 'M_0 moves chase around the ellipse without changing the ellipse.' },
        { key: 'zmax', sym: 'z<small>max</small>', unit: 'km', meaning: 'How far chase swings left and right of the target’s plane',
          notice: 'z_max sets how far chase swings left and right. It shows in the view from behind and from above, not from the left.' },
        { key: 'dM0', sym: 'ΔM<small>0</small>', unit: '°', meaning: 'Where chase is in the swing: 0° +P.C., 90° far left, 180° −P.C., 270° far right',
          notice: 'ΔM_0 sets where in the swing chase is, so it decides which point on the ellipse is farthest left. Turn on Cross-Track Points to see it.' }
    ];
    const PRESETS = [
        { name: 'Perch', rmoe: { yc0: -20 }, notice: 'Every RMOE but y_C0 is zero: chase sits still 20 km behind the target. A perch.' },
        { name: 'Drift', rmoe: { xc: 2, yc0: 40 }, notice: 'No ellipse (C = 0), only a center 2 km above the target: chase slides straight backward along the track, about 19 km each rev. Make x_C negative and it drifts forward.' },
        { name: 'NMC', rmoe: { C: 10 }, notice: 'C = 10 km and nothing else: a 2-by-1 ellipse, 20 km tall and 40 km long, centered on the target. It does not drift because x_C = 0. Move y_C0 to slide it along the track.' },
        { name: 'Drifting NMC', rmoe: { xc: 2, C: 6, yc0: 40 }, notice: 'An NMC whose center is 2 km above the target, so the loops walk backward about 19 km each rev. Below the target they walk forward.' },
        { name: 'Cross-Track', rmoe: { yc0: -20, zmax: 10 }, notice: 'A perch 20 km behind that swings 10 km left and right once per rev. Watch the view from behind.' },
        { name: 'Cross-Track NMC', rmoe: { C: 10, zmax: 10 }, second: 'box',
          notice: 'The NMC from before, plus a 10 km swing left and right once per rev. The ellipse tilts out of the target’s plane but still closes on itself, because x_C = 0. ΔM_0 sets which way it tilts.' },
        { name: 'Corkscrew', rmoe: { xc: -1.5, C: 5, zmax: 5, yc0: -40, dM0: 270 }, second: 'box',
          notice: 'Drift, ellipse, and swing together: a corkscrew. In the 3D box, ΔM_0 decides which part of each loop is farthest to the side.' }
    ];
    const DEFAULT_PRESET = 'Drifting NMC';
    const ZERO = { xc: 0, yc0: 0, C: 0, M0: 0, zmax: 0, dM0: 0 };
    const POINTS_PER_REV = 240;
    const TINY = 1e-9;
    const MAX_REVS = 10;

    /* ---------- State ---------- */
    const state = {
        preset: PRESETS.findIndex(p => p.name === DEFAULT_PRESET),
        target: 'geo',
        rmoe: { ...ZERO },
        t: 0, revs: 2, playing: !Kit.prefersReducedMotion(), speed: 0.05,
        second: 'behind',
        annot: { center: true, size: false, corners: false, cross: false },
        hot: null, lastRow: null,
        frame: 'ECI', camera: 'earth', mag: 'auto', inertialTrail: true, carried: true, backdrop: true, inset: false, orbit3d: true, labels: true
    };
    let sim = null, dirty = true;

    /* ---------- Stage ---------- */
    let THREE = null;
    try { THREE = await import(THREE_URL); } catch (err) { THREE = null; }
    const view = $('view');
    const stage = V.createDualStage(view, { THREE, second: 'behind', onResize: () => { if (sim) { refit(true); dirty = true; } } });

    // Drag a flat pane to slide it, wheel or pinch to zoom; both flat panes move together.
    // Fit Views, a new preset, or a slider puts them back.
    const flatPanes = () => [stage.left, stage.secondPlane()].filter(Boolean);
    V.attachPanZoom(view.querySelector('.rpo-left canvas'), { plane: () => stage.left, linked: flatPanes, onChange: () => { dirty = true; } });
    V.attachPanZoom(view.querySelector('.rpo-second canvas.c2d'), { plane: () => stage.secondPlane() || stage.left, linked: flatPanes, onChange: () => { dirty = true; } });

    const targetCoe = () => TARGETS[state.target];
    // The RMOEs the math uses: M_0 and ΔM_0 are undefined when C or z_max is zero.
    function mathRmoe() {
        const r = state.rmoe;
        return { ...r, M0: r.C > TINY ? r.M0 : null, dM0: r.zmax > TINY ? r.dM0 : null };
    }

    function rebuild() {
        const coe = targetCoe();
        const n = M.meanMotion(coe.a), P = 2 * Math.PI / n;
        const spanT = state.revs * P;
        const count = Math.round(POINTS_PER_REV * state.revs) + 1;
        const rmoe = mathRmoe();
        const times = new Float64Array(count);
        for (let k = 0; k < count; k++) times[k] = spanT * k / (count - 1);
        const path = M.sampleTrajectory(rmoe, n, 0, spanT, count);
        sim = { coe, n, P, spanT, count, rmoe, path, frame: V.framePath(coe, times, path) };
        if (stage.inertial) {
            stage.inertial.setOrbit(coe);
            stage.inertial.setChaseOrbit(null);
            stage.inertial.setPath(sim.frame);
        }
        dirty = true;
    }

    /* ---------- Fitting ---------- */
    // grow: only zoom out (used while a slider is dragged, so the picture does not jump in and out).
    function refit(full) {
        if (!sim) return;
        const planes = [stage.left, stage.behind, stage.above];
        const visible = stage.visiblePlanes();
        const before = visible.map(p => p.kmPerPx());
        const fit = V.fitPanes(visible.length ? visible : planes, [sim.path], true);
        if (!full && visible.length && visible.every((p, k) => p.kmPerPx() <= before[k] + 1e-12) && sim.fitted) {
            // The new fit is a zoom in: keep the old scale, recentered.
            visible.forEach((p, k) => p.setScale(1 / before[k], p.boxCenter(fit.box)));
        }
        planes.filter(p => visible.indexOf(p) < 0).forEach(p => V.fitPanes([p], [sim.path], true));
        if (stage.box) {
            const b = fit.box;
            stage.box.setExtent(Math.max.apply(null, [0, 1, 2].map(k => Math.max(Math.abs(b.min[k]), Math.abs(b.max[k])))));
        }
        sim.fitted = true;
    }

    /* ---------- Annotations on the flat panes ---------- */
    const COLORS = { line: 'rgba(224, 182, 79, 0.85)', text: '#e8edf5', hot: '#ffffff', dim: 'rgba(207, 220, 236, 0.75)', cross: '#c4a1ff' };
    function annotate(pane, now, rNow) {
        const ctx = pane.canvas.getContext('2d');
        const plane = V.PLANES[pane.plane];
        const P = p => pane.toPx(p[plane.h], p[plane.v]);
        const hot = state.hot;
        const label = (text, q, color, dx, dy) => {
            ctx.font = '600 11px Inter, sans-serif';
            const w = ctx.measureText(text).width + 6;
            // Keep the label inside the pane, so a label near an edge is never cut off.
            const cw = pane.canvas.clientWidth, ch = pane.canvas.clientHeight;
            const x = Math.max(3, Math.min(cw - w, q[0] + (dx || 8)));
            const y = Math.max(9, Math.min(ch - 9, q[1] + (dy || -8)));
            ctx.fillStyle = 'rgba(6, 11, 20, 0.75)';
            ctx.fillRect(x - 3, y - 8, w, 16);
            ctx.fillStyle = color;
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y);
        };
        const dot = (q, color, r) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q[0], q[1], r || 3.5, 0, 2 * Math.PI); ctx.fill(); };
        const line = (a, b, color, width, dash) => {
            ctx.strokeStyle = color; ctx.lineWidth = width || 1.2; ctx.setLineDash(dash || []);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
        };
        const { xc, C, zmax } = rNow;
        const yc = rNow.yc0;
        const center = [xc, yc, 0];
        const inPlane = pane.plane !== 'behind';
        const showsR = pane.plane !== 'above';

        if (state.annot.center || hot === 'xc' || hot === 'yc0') {
            const c = hot === 'xc' || hot === 'yc0' ? COLORS.hot : COLORS.line;
            const q = P(center);
            if (inPlane) label('center', q, c, 8, 12);
            if (hot === 'xc' && showsR) { const q0 = P([0, yc, 0]); line(q0, q, COLORS.hot, 2); label('x_C = ' + fmt(xc, 2) + ' km', q, COLORS.hot, 8, -14); }
            if (hot === 'yc0' && inPlane) { const q0 = P([xc, 0, 0]); line(q0, q, COLORS.hot, 2); label('y_C = ' + fmt(yc, 1) + ' km', q, COLORS.hot, 8, -14); }
        }
        if ((state.annot.size || hot === 'C') && C > TINY) {
            const c = hot === 'C' ? COLORS.hot : COLORS.line;
            const q = P(center);
            if (showsR) { const top = P([xc + C, yc, 0]); line(q, top, c, 1.5, [4, 3]); label('C', [(q[0] + top[0]) / 2, (q[1] + top[1]) / 2], c, 6, 0); }
            if (inPlane) { const front = P([xc, yc + 2 * C, 0]); line(q, front, c, 1.5, [4, 3]); label('2C', [(q[0] + front[0]) / 2, (q[1] + front[1]) / 2], c, -10, 12); }
        }
        if ((state.annot.corners || hot === 'M0') && C > TINY && inPlane) {
            const c = hot === 'M0' ? COLORS.hot : COLORS.line;
            [['Bottom 0°', [xc - C, yc, 0], 0, 14], ['Front 90°', [xc, yc + 2 * C, 0], -70, -12], ['Top 180°', [xc + C, yc, 0], 0, -16], ['Back 270°', [xc, yc - 2 * C, 0], 8, -12]]
                .forEach(([text, p, dx, dy]) => {
                    if (!showsR && (text.startsWith('Top') || text.startsWith('Bottom'))) return;
                    const q = P(p); dot(q, c); label(text, q, c, dx, dy);
                });
        }
        if ((state.annot.cross || hot === 'zmax' || hot === 'dM0') && zmax > TINY) {
            const c = hot === 'zmax' || hot === 'dM0' ? COLORS.hot : COLORS.cross;
            // Where chase will be at each cross-track point within the next rev.
            const dmNow = rNow.dM0;
            [['+P.C. 0°', 0], ['Left 90°', 90], ['−P.C. 180°', 180], ['Right 270°', 270]].forEach(([text, ang]) => {
                const dt = M.timeToAngle(dmNow, ang, sim.n);
                const s = M.stateFromRmoe(rNow, sim.n, dt);
                const q = P(s);
                dot(q, c, 3);
                if (pane.plane !== 'left' || hot === 'dM0' || state.annot.cross) label(text, q, c, 7, -9);
            });
        }
        if (hot === 'M0' && C > TINY) {
            const q = P(now);
            ctx.strokeStyle = COLORS.hot; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(q[0], q[1], 11, 0, 2 * Math.PI); ctx.stroke();
        }
    }

    /* ---------- Drawing ---------- */
    function sampleIndex(t) {
        return Math.max(0, Math.min(sim.count - 1, Math.round(t / sim.spanT * (sim.count - 1))));
    }
    function drawAll() {
        if (!sim) return;
        const t = state.t;
        const now = M.stateFromRmoe(sim.rmoe, sim.n, t);
        const rNow = M.rmoeAt(sim.rmoe, sim.n, t);
        const k = sampleIndex(t);
        const trail = sim.path.subarray(0, 3 * (k + 1));
        const data = {
            chase: now, trail, ghosts: [sim.path],
            rmoe: state.annot.center || state.hot === 'xc' || state.hot === 'yc0' ? rNow : null,
            showNmc: state.annot.size || state.annot.corners
        };
        const panes = [stage.left].concat(stage.secondPlane() ? [stage.secondPlane()] : []);
        panes.forEach(p => { p.draw(data); annotate(p, now, rNow); });
        const basis = M.ricBasis(sim.coe, t);
        if (stage.box && stage.second() === 'box') {
            stage.box.setBackdrop(state.backdrop);
            stage.box.setInset(state.inset);
            stage.box.setOrbit(state.orbit3d);
            // Chase's ECI state from the course model: r = rT + rho, v = vT + omega x rho + rho dot.
            const w = basis.omega;
            const rho = M.ricToEci(now, basis);
            const dv = M.ricToEci([now[3] - w * now[1], now[4] + w * now[0], now[5]], basis);
            const chaseRv = { r: basis.r.map((x, k) => x + rho[k]), v: basis.v.map((x, k) => x + dv[k]) };
            stage.box.update({ chase: now, trail, ghost: sim.path, basis, rT: basis.r, t, targetCoe: sim.coe, chaseRv });
        }
        if (stage.inertial) {
            // ghost: the whole two-rev path is drawn faintly from the start, so the carried trail never
            // vanishes when the clock wraps back to epoch.
            stage.inertial.update({ t, rho: now, basis, rT: basis.r, from: 0, to: k, ghost: true });
        }
        updateLive(now, rNow);
    }

    /* ---------- Panels ---------- */
    const fmt = (v, d) => {
        const s = Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : v.toFixed(d);
        return s.replace(/^-/, '−');
    };
    const fmtAngle = v => (v === null ? 'undefined' : fmt(v, 0) + '°');
    const rowEls = {};

    function buildTable() {
        const table = $('rm-table');
        ROWS.forEach(row => {
            const wrap = document.createElement('div');
            wrap.className = 'rm-row';
            wrap.dataset.key = row.key;
            wrap.innerHTML =
                `<span class="rm-sym">${row.sym}</span>` +
                `<input type="range" aria-label="${row.key} slider">` +
                `<input type="number" step="any" aria-label="${row.key} value">` +
                `<span class="rm-now"></span>` +
                `<span class="rm-mean">${row.meaning} (${row.unit})</span>`;
            table.appendChild(wrap);
            const [range, num] = wrap.querySelectorAll('input');
            rowEls[row.key] = { wrap, range, num, now: wrap.querySelector('.rm-now') };
            const set = (value, final) => {
                if (!Number.isFinite(value)) return;
                if ((row.key === 'C' || row.key === 'zmax') && value < 0) value = 0;
                if (row.unit === '°') value = M.wrap360(value);
                state.rmoe[row.key] = value;
                state.lastRow = row.key;
                rebuild();
                refit(final);
                updateInputs(row.key);
                updateStatic();
            };
            range.addEventListener('input', () => set(Number(range.value), false));
            range.addEventListener('change', () => { refit(true); dirty = true; });
            num.addEventListener('change', () => set(Number(num.value), true));
            // Hovering or focusing a row highlights what it controls.
            const hotOn = () => { state.hot = row.key; wrap.classList.add('hot'); dirty = true; };
            const hotOff = () => { if (state.hot === row.key) state.hot = null; wrap.classList.remove('hot'); dirty = true; };
            [range, num].forEach(el => { el.addEventListener('focus', hotOn); el.addEventListener('blur', hotOff); });
            wrap.querySelectorAll('span, input').forEach(el => { el.addEventListener('mouseenter', hotOn); el.addEventListener('mouseleave', hotOff); });
        });
    }

    function updateInputs(skip) {
        const ranges = RANGES[state.target];
        ROWS.forEach(row => {
            const els = rowEls[row.key], [lo, hi, step] = ranges[row.key];
            els.range.min = lo; els.range.max = hi; els.range.step = step;
            els.range.value = String(Math.min(hi, Math.max(lo, state.rmoe[row.key])));
            if (row.key !== skip || document.activeElement !== els.num) els.num.value = String(Number(state.rmoe[row.key].toFixed(4)));
            const undef = (row.key === 'M0' && state.rmoe.C <= TINY) || (row.key === 'dM0' && state.rmoe.zmax <= TINY);
            els.range.disabled = undef;
            els.num.classList.toggle('rm-undef', undef);
        });
    }

    function updateStatic() {
        const r = mathRmoe(), n = sim.n;
        const s = M.stateFromRmoe(r, n, 0);
        $('s-x').textContent = fmt(s[0], 3); $('s-y').textContent = fmt(s[1], 3); $('s-z').textContent = fmt(s[2], 3);
        $('s-vx').textContent = fmt(s[3] * 1000, 4); $('s-vy').textContent = fmt(s[4] * 1000, 4); $('s-vz').textContent = fmt(s[5] * 1000, 4);
        $('motion').textContent = M.classifyMotion(r).label;
        const drift = M.driftRate(r, n, sim.coe.a);
        $('drift-read').textContent = Math.abs(r.xc) > TINY
            ? `Drift ${fmt(drift.kmPerRev, 2)} km/rev (${fmt(drift.degPerRev, 4)}°/rev), ${drift.kmPerRev < 0 ? 'backward' : 'forward'}.`
            : 'No drift: x_C = 0.';
        const aChase = sim.coe.a + r.xc;
        $('co-da').textContent = fmt(r.xc, 2) + ' km';
        $('co-e').textContent = (r.C / aChase).toExponential(3);
        $('co-th').textContent = fmt(r.zmax / sim.coe.a * M.R2D, 5) + '°';
        const P = sim.P;
        $('co-p').textContent = P > 7200 ? (P / 3600).toFixed(3) + ' h' : (P / 60).toFixed(2) + ' min';
        const row = ROWS.find(x => x.key === state.lastRow);
        const preset = PRESETS[state.preset];
        $('notice').textContent = row ? row.notice : preset ? preset.notice : '';
    }

    function updateLive(now, rNow) {
        const r = mathRmoe();
        ROWS.forEach(row => {
            const v = rNow[row.key];
            const els = rowEls[row.key];
            els.now.textContent = row.unit === '°' ? fmtAngle(v) : fmt(v, row.key === 'yc0' ? 1 : 2);
            if (row.unit === '°' && r[row.key] === null) els.num.title = 'Undefined while ' + (row.key === 'M0' ? 'C' : 'z_max') + ' is zero';
        });
        $('time-read').textContent = (state.t / sim.P).toFixed(2) + ' rev';
        $('scrubber').max = String(Math.round(state.revs * 1000));
        $('scrubber').value = String(Math.round(state.t / sim.P * 1000));
        // Boundary tables at this time, the row nearest chase marked.
        const bt = M.boundaryTable(rNow, sim.n);
        const nearIn = rNow.M0 === null ? -1 : Math.round(M.wrap360(rNow.M0) / 90) % 4;
        const nearCross = rNow.dM0 === null ? -1 : Math.round(M.wrap360(rNow.dM0) / 90) % 4;
        const v = x => fmt(x * 1000, 3);
        $('bt-plane').innerHTML = '<tr><th>Point</th><th>M</th><th>x km</th><th>y km</th><th>ẋ m/s</th><th>ẏ m/s</th></tr>' +
            bt.inPlane.map((p, k) => `<tr class="${k === nearIn ? 'near' : ''}"><td>${p.name}</td><td>${p.angle}°</td><td>${fmt(p.x, 2)}</td><td>${fmt(p.y, 2)}</td><td>${v(p.vx)}</td><td>${v(p.vy)}</td></tr>`).join('');
        $('bt-cross').innerHTML = '<tr><th>Point</th><th>ΔM</th><th>z km</th><th>ż m/s</th></tr>' +
            bt.cross.map((p, k) => `<tr class="${k === nearCross ? 'near' : ''}"><td>${p.name}</td><td>${p.angle}°</td><td>${fmt(p.z, 2)}</td><td>${v(p.vz)}</td></tr>`).join('');
    }

    /* ---------- Presets and target ---------- */
    function fillPresets() {
        const sel = $('preset');
        sel.innerHTML = PRESETS.map((p, k) => `<option value="${k}">${p.name}</option>`).join('');
        sel.addEventListener('change', () => loadPreset(Number(sel.value)));
        $('reset-preset').addEventListener('click', () => loadPreset(state.preset));
    }
    // Preset distances are for GEO; at GPS-type they are halved and at LEO scaled to the LEO ranges.
    const SCALE = { geo: 1, gps: 0.5, leo: 0.3 };
    function loadPreset(index) {
        const p = PRESETS[index];
        state.preset = index;
        $('preset').value = String(index);
        const s = SCALE[state.target];
        state.rmoe = { ...ZERO };
        Object.entries(p.rmoe).forEach(([key, value]) => { state.rmoe[key] = key === 'M0' || key === 'dM0' ? value : value * s; });
        state.lastRow = null;
        state.t = 0; state.revs = 2;
        selectSecond(p.second || 'behind');
        rebuild();
        refit(true);
        updateInputs();
        updateStatic();
    }
    const selectTarget = Kit.bindSegmented($('target-pick'), key => {
        const old = SCALE[state.target];
        state.target = key;
        ['xc', 'yc0', 'C', 'zmax'].forEach(k => { state.rmoe[k] *= SCALE[key] / old; });
        if (key !== 'geo' && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); }
        state.t = 0; state.revs = 2;
        rebuild();
        applyViewOptions();
        if (stage.inertial) stage.inertial.resetView();
        refit(true);
        updateInputs();
        updateStatic();
    });

    /* ---------- Time ---------- */
    function setPlaying(on) { state.playing = on; $('play').textContent = on ? 'Pause' : 'Play'; }
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('scrubber').addEventListener('input', e => { state.t = Number(e.target.value) / 1000 * sim.P; setPlaying(false); dirty = true; });
    Kit.bindSegmented($('speed'), v => { state.speed = Number(v); });
    document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
        state.t += Number(b.dataset.jump) * sim.P;
        if (state.t > MAX_REVS * sim.P) state.t = MAX_REVS * sim.P;
        const needed = Math.max(2, Math.ceil(state.t / sim.P - 1e-9));
        if (needed !== state.revs) { state.revs = needed; rebuild(); refit(true); }
        setPlaying(false);
        dirty = true;
    }));
    $('epoch').addEventListener('click', () => {
        state.t = 0;
        if (state.revs !== 2) { state.revs = 2; rebuild(); refit(true); }
        setPlaying(false);
        dirty = true;
    });
    $('fit-views').addEventListener('click', () => { refit(true); dirty = true; });

    /* ---------- View options ---------- */
    const selectSecond = Kit.bindSegmented($('second-pick'), v => {
        state.second = v;
        stage.setSecond(v);
        refit(true);
        dirty = true;
    });
    [['an-center', 'center'], ['an-size', 'size'], ['an-corners', 'corners'], ['an-cross', 'cross']].forEach(([id, key]) => {
        $(id).addEventListener('change', e => { state.annot[key] = e.target.checked; dirty = true; });
    });
    function autoK() { return stage.inertial ? stage.inertial.autoMagnification() : 1; }
    function magFromSlider(f) { return Math.exp(f * Math.log(4 * Math.max(autoK(), 1))); }
    function sliderFromMag(k) { const top = Math.log(4 * Math.max(autoK(), 1)); return top > 0 ? Math.log(k) / top : 0; }
    function currentMag() { return state.mag === 'auto' ? autoK() : Math.min(4 * autoK(), Math.max(1, state.mag)); }
    function updateMagRead() {
        const k = currentMag();
        $('mag').value = String(Math.round(sliderFromMag(k) * 1000));
        $('mag-read').textContent = k === 1 ? '1×' : (k >= 10 ? Math.round(k).toLocaleString('en-US') : k.toFixed(1)) + '×';
    }
    function applyViewOptions() {
        stage.setBadge(state.frame);
        const inertial = stage.inertial;
        if (!inertial) return;
        inertial.setMagnification(state.mag === 'auto' ? 'auto' : currentMag());
        inertial.setFrame(state.frame);
        inertial.setCamera(state.camera);
        inertial.setTrails({ inertial: state.inertialTrail, carried: state.carried });
        inertial.setExtras({ axes: false, equator: false, orbits: true });
        inertial.setLabels(state.labels);
        updateMagRead();
    }
    $('mag').addEventListener('input', e => { state.mag = magFromSlider(Number(e.target.value) / 1000); applyViewOptions(); dirty = true; });
    const selectFrame = Kit.bindSegmented($('frame-pick'), v => {
        state.frame = v === 'ECEF' && state.target === 'geo' ? 'ECEF' : 'ECI';
        if (state.frame !== v) selectFrame(state.frame);
        applyViewOptions();
        dirty = true;
    });
    Kit.bindSegmented($('camera-pick'), v => { state.camera = v; applyViewOptions(); dirty = true; });
    [['opt-inertial', 'inertialTrail'], ['opt-carried', 'carried'], ['opt-backdrop', 'backdrop'], ['opt-inset', 'inset'], ['opt-orbit3d', 'orbit3d'], ['opt-labels', 'labels']].forEach(([id, key]) => {
        $(id).addEventListener('change', e => { state[key] = e.target.checked; applyViewOptions(); dirty = true; });
    });

    /* ---------- Start ---------- */
    buildTable();
    fillPresets();
    loadPreset(state.preset);
    applyViewOptions();
    setPlaying(state.playing);

    Kit.startLoop(seconds => {
        if (state.playing && sim) {
            state.t += seconds * state.speed * sim.P;
            if (state.t >= sim.spanT) state.t = 0;
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        drawAll();
    });

    // For checks in the browser console.
    window.rmoeExplorer = {
        state, sim: () => sim, stage, presets: PRESETS, loadPreset, drawNow: drawAll,
        set(values) { Object.assign(state.rmoe, values); rebuild(); refit(true); updateInputs(); updateStatic(); drawAll(); }
    };
})();
