// Relative Motion Explorer. Three ways to set the same motion of chase relative to the target:
//  - Set COEs: the target's classical orbital elements and chase's differences from them. Both
//    spacecraft fly their own two-body orbits (the exact model, OrbitMath.rpo.relativeState), so the
//    target's orbit may be eccentric (Advanced only).
//  - Set RMOEs: the six relative motion orbital elements, with sliders (the course model, the CW
//    solution in OrbitMath.rpo.stateFromRmoe; needs a circular target).
//  - Set Position and Velocity: chase's RIC state at epoch, with each RMOE worked from it.
// Switching modes keeps the motion: COEs to RMOEs by OrbitMath.rpo.rmoeFromCoes, RMOEs to COEs by its
// inverse, OrbitMath.rpo.coesFromRmoe. The motion is drawn in the three flat RIC views (from the left,
// from behind, from above), the 3D RIC box, and an inertial view, with annotations for what each
// RMOE controls. Built from the RMOE Explorer and Relative Motion: Two Views.
(async function () {
    'use strict';

    const $ = id => document.getElementById(id);
    // Relative-motion math from ../assets/orbit-math.js (section rpo), on the constants the site's
    // settings choose; RpoViews reads OrbitMath.rpo itself.
    const Kit = window.ToolKit, V = window.RpoViews;
    let M = window.OrbitMath.rpo;
    // Read the math again after the constants setting changes.
    function rebindMath() { M = window.OrbitMath.rpo; }

    /* ---------- Data tables ----------
     * TARGETS: the three target orbits (the Target buttons). RANGES: RMOE slider [min, max, step]
     * per target; distances in km, angles in degrees. SMALL: COE difference slider ranges per
     * target. PRESETS: name, the RMOEs that are not zero (rmoe, for Set RMOEs and Set Position and
     * Velocity), the element differences that are not zero (diff, for Set COEs: da in km, de, and
     * di, draan, dargp, dnu in degrees, chase minus target), span in revs, and the What to Notice
     * text for each (notice, coeNotice). Preset numbers are for GEO; the other targets scale them.
     * Add a preset by adding one row. */
    const TARGETS = {
        geo: { a: window.OrbitConstants.LESSON.rGeo, e: 0, i: 0, raan: 0, argp: 0, nu: 0 },
        gps: { a: 26562, e: 0, i: 55, raan: 30, argp: 0, nu: 0 },
        leo: { a: 8000, e: 0, i: 51.6, raan: 30, argp: 0, nu: 0 }
    };
    const SHORTCUTS = ['geo', 'gps', 'leo'];
    const RANGES = {
        geo: { xc: [-10, 10, 0.5], yc0: [-100, 100, 1], C: [0, 30, 0.5], M0: [0, 355, 5], zmax: [0, 30, 0.5], dM0: [0, 355, 5] },
        gps: { xc: [-5, 5, 0.25], yc0: [-50, 50, 0.5], C: [0, 15, 0.25], M0: [0, 355, 5], zmax: [0, 15, 0.25], dM0: [0, 355, 5] },
        leo: { xc: [-3, 3, 0.1], yc0: [-30, 30, 0.5], C: [0, 10, 0.25], M0: [0, 355, 5], zmax: [0, 10, 0.25], dM0: [0, 355, 5] }
    };
    // Δω matches Δν: on a near-circular orbit both just slide chase along the track (u = ω + ν).
    const SMALL = {
        geo: { da: [-10, 10, 0.1], de: [0, 0.0004, 0.000005], di: [-0.03, 0.03, 0.0005], draan: [-0.03, 0.03, 0.0005], dargp: [-0.06, 0.06, 0.0005], dnu: [-0.06, 0.06, 0.0005] },
        gps: { da: [-6, 6, 0.1], de: [0, 0.0004, 0.000005], di: [-0.03, 0.03, 0.0005], draan: [-0.03, 0.03, 0.0005], dargp: [-0.06, 0.06, 0.0005], dnu: [-0.06, 0.06, 0.0005] },
        leo: { da: [-2, 2, 0.02], de: [0, 0.0008, 0.00001], di: [-0.04, 0.04, 0.001], draan: [-0.04, 0.04, 0.001], dargp: [-0.08, 0.08, 0.001], dnu: [-0.08, 0.08, 0.001] }
    };
    const TARGET_LIMITS = { a: [6500, 50000], e: [0, 0.9], i: [0, 180], raan: [0, 360], argp: [0, 360], nu: [0, 360] };
    const EL_ROWS = [
        { key: 'a', d: 'da', name: 'a', unit: 'km', digits: 3 },
        { key: 'e', d: 'de', name: 'e', unit: '', digits: 6 },
        { key: 'i', d: 'di', name: 'i', unit: 'deg', digits: 4 },
        { key: 'raan', d: 'draan', name: 'Ω', unit: 'deg', digits: 4 },
        { key: 'argp', d: 'dargp', name: 'ω', unit: 'deg', digits: 4 },
        { key: 'nu', d: 'dnu', name: 'ν', unit: 'deg', digits: 4 }
    ];
    const MESSAGES = {
        a: 'The semi-major axis must be positive.',
        e: 'Eccentricity must be at least 0 and below 0.95.',
        perigee: 'That orbit would pass within 100 km of Earth’s surface.'
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
        { group: 'Simple', name: 'Perch', rmoe: { yc0: -20 }, diff: { dnu: 0.05 }, span: 2,
          notice: 'Every RMOE but y_C0 is zero: chase sits still 20 km behind the target. A perch.',
          coeNotice: 'Same orbit, 37 km ahead. Only the position differs, so the gap never changes. In RIC chase sits still: a perch.' },
        { group: 'Simple', name: 'Drift', rmoe: { xc: 2, yc0: 40 }, diff: { da: 5 }, span: 3,
          notice: 'No ellipse (C = 0), only a center 2 km above the target: chase slides straight backward along the track, about 19 km each rev. Make x_C negative and it drifts forward.',
          coeNotice: 'A larger orbit takes longer to go around, so chase falls about 47 km farther behind every rev: a drift backward. A smaller orbit drifts forward.' },
        { group: 'Simple', name: 'NMC', rmoe: { C: 10 }, diff: { de: 0.0003 }, span: 2,
          notice: 'C = 10 km and nothing else: a 2-by-1 ellipse, 20 km tall and 40 km long, centered on the target. It does not drift because x_C = 0. Move y_C0 to slide it along the track.',
          coeNotice: 'Same period, different shape. Chase dips below and speeds up at perigee, then rises and slows at apogee. In RIC that is a 2-by-1 ellipse that stays put: an NMC.' },
        { group: 'Simple', name: 'Cross-Track', rmoe: { yc0: -20, zmax: 10 }, diff: { di: 0.02 }, span: 2,
          notice: 'A perch 20 km behind that swings 10 km left and right once per rev. Watch the view from behind.',
          coeNotice: 'Only the tilt differs. The two orbit planes cross twice per rev, so chase swings left and right of the target’s plane once per rev. Watch the view from behind.' },
        { group: 'Two-Component', name: 'Drifting NMC', rmoe: { xc: 2, C: 6, yc0: 40 }, diff: { da: -2, de: 0.0003 }, span: 3,
          notice: 'An NMC whose center is 2 km above the target, so the loops walk backward about 19 km each rev. Below the target they walk forward.',
          coeNotice: 'Size and shape both differ: the NMC ellipse and the drift happen together, so the loops walk forward. A drifting NMC.' },
        { group: 'Two-Component', name: 'Cross-Track NMC', rmoe: { C: 10, zmax: 10 }, diff: { de: 0.0003, di: 0.02 }, span: 2,
          notice: 'The NMC from before, plus a 10 km swing left and right once per rev. The ellipse tilts out of the target’s plane but still closes on itself, because x_C = 0. ΔM_0 sets which way it tilts.',
          coeNotice: 'Same period, but shape and tilt both differ: the NMC ellipse also swings left and right once per rev. The loop tilts out of the target’s plane but still closes on itself, so it never drifts. A cross-track NMC.' },
        { group: 'Two-Component', name: 'Snake', rmoe: { xc: -1.5, zmax: 10, yc0: -40 }, diff: { da: -2, di: 0.02 }, span: 3,
          notice: 'A drift and a swing with no ellipse: x_C = −1.5 km walks chase forward about 14 km each rev while it swings 10 km left and right. From above the path winds like a snake.',
          coeNotice: 'Size and tilt differ, shape does not: chase drifts forward along the track while it swings left and right once per rev. Seen from above, the path winds like a snake.' },
        { group: 'Three-Component', name: 'Corkscrew', rmoe: { xc: -1.5, C: 5, zmax: 5, yc0: -40, dM0: 270 }, diff: { da: -2, de: 0.0003, di: 0.02 }, span: 3,
          notice: 'Drift, ellipse, and swing together: a corkscrew. In the 3D box, ΔM_0 decides which part of each loop is farthest to the side.',
          coeNotice: 'Size, shape, and tilt all differ: a drifting NMC that also swings side to side. A corkscrew. Turn the 3D box to see it.' }
    ];
    const DEFAULT_PRESET = 'Drifting NMC';
    const ZERO = { xc: 0, yc0: 0, C: 0, M0: 0, zmax: 0, dM0: 0 };
    const ZERO_DIFF = { da: 0, de: 0, di: 0, draan: 0, dargp: 0, dnu: 0 };
    // Preset distances are for GEO; at GPS they are halved and at LEO scaled to the LEO ranges.
    const SCALE = { geo: 1, gps: 0.5, leo: 0.3 };
    const POINTS_PER_REV = 240;
    const TINY = 1e-9;
    const MAX_REVS = 10;
    const TITLES = { coe: 'Classical Orbital Elements', rmoe: 'RMOEs', pv: 'Position and Velocity' };

    /* ---------- State ---------- */
    const state = {
        preset: PRESETS.findIndex(p => p.name === DEFAULT_PRESET),
        target: { ...TARGETS.geo },   // the target's elements; circular except in Set COEs with Advanced on
        diff: { ...ZERO_DIFF },       // Set COEs: chase minus target
        mode: 'rmoe',
        rmoe: { ...ZERO },            // undefined angles are kept as 0; mathRmoe() turns them into null
        modeNote: '',
        presetCustom: false,          // the user changed the numbers: the preset list reads Custom
        customTarget: false,          // Custom picked (or a typed): the target's a is the typed one
        t: 0, revs: 2, playing: !Kit.prefersReducedMotion(), speed: 0.02,
        annot: { center: true, size: false, corners: false, cross: false },
        hot: null, lastRow: null,
        frame: 'ECI', camera: 'earth', mag: 'auto', inertialTrail: true, carried: true, orbits: true, backdrop: true, inset: false, orbit3d: true, nmcTrace: true, labels: true
    };
    let sim = null, dirty = true;

    /* ---------- Stage ---------- */
    let THREE = null;
    try { THREE = await Vendor.three(); } catch (err) { THREE = null; }
    const view = $('view');
    const stage = V.createFiveViewStage(view, { THREE, onResize: () => { if (sim) { refit(true); dirty = true; } } });
    const PLANE_NAMES = ['left', 'behind', 'above'];

    // Drag a flat pane to slide it, wheel or pinch to zoom; the three flat panes move together.
    // Fit Views, a new preset, or a slider puts them back.
    const flatPanes = () => stage.visiblePlanes();
    PLANE_NAMES.forEach(name => {
        V.attachPanZoom(view.querySelector('.rpo-' + name + ' canvas'), { plane: () => stage[name], linked: flatPanes, onChange: () => { dirty = true; } });
    });

    /* ---------- Derived values ---------- */
    const isDev = () => {
        try {
            if (typeof window !== 'undefined' && window.__DEV__ !== undefined) return Boolean(window.__DEV__);
            if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev')) return true;
            if (typeof localStorage !== 'undefined' && localStorage.getItem('otc-dev-mode') === '1') return true;
            if (typeof document !== 'undefined' && document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('dev-mode')) return true;
            if (typeof location === 'undefined') return true;
        } catch (e) {}
        return false;
    };
    const isCircular = () => state.target.e < 1e-6;
    const isAdvanced = () => document.body.classList.contains('advanced-on');
    const chaseCoe = () => M.coeFromDifference(state.target, state.diff);
    function isGeoTarget() { const t = state.target; return Math.abs(t.a - M.GEO_A) < 0.5 && t.i < 1e-6 && t.e < 1e-6; }
    // The nearest of the three target buttons, by size: picks the slider ranges and preset scale.
    const nearestKey = () => SHORTCUTS.slice().sort((p, q) => Math.abs(TARGETS[p].a - state.target.a) - Math.abs(TARGETS[q].a - state.target.a))[0];
    // The RMOEs the math uses: M_0 and ΔM_0 are undefined when C or z_max is zero.
    function mathRmoe() {
        const r = state.rmoe;
        return { ...r, M0: r.C > TINY ? r.M0 : null, dM0: r.zmax > TINY ? r.dM0 : null };
    }
    const stored = r => ({ xc: r.xc, yc0: r.yc0, C: r.C, zmax: r.zmax, M0: r.M0 === null ? 0 : r.M0, dM0: r.dM0 === null ? 0 : r.dM0 });
    // Set COEs keeps state.rmoe equal to the RMOEs the elements give (for a circular target).
    function syncRmoeFromCoes() { if (isCircular()) state.rmoe = stored(M.rmoeFromCoes(state.target, chaseCoe())); }

    // The RIC model setting (site settings): in the RMOE mode, CW (default) or the exact model, in
    // which chase starts from the RMOEs' relative state and both spacecraft fly their own orbits.
    // The COE mode is always exact. Either way the RIC axes are rectilinear or curvilinear.
    const ricModel = () => window.OrbitConstants.Settings.get();
    function rebuild() {
        const oldP = sim ? sim.P : 0;
        const settings = ricModel();
        const axes = settings.ricAxes;
        const rev = oldP > 0 ? state.t / oldP : 0;
        const coe = { ...state.target };
        const n = M.meanMotion(coe.a), P = 2 * Math.PI / n;
        const spanT = state.revs * P;
        const count = Math.round(POINTS_PER_REV * state.revs) + 1;
        const times = new Float64Array(count);
        for (let k = 0; k < count; k++) times[k] = spanT * k / (count - 1);
        const circular = isCircular();
        if (state.mode === 'coe') {
            // The exact model: both orbits, stored as r and v and propagated on their own.
            const chase = chaseCoe();
            const tSat = M.targetSat(coe), cSat = M.targetSat(chase);
            const s = M.sampleRelativeSats(tSat, cSat, 0, spanT, count, axes);
            const frame = V.framePath(coe, times, s.rect);
            const rmoe = circular ? M.rmoeFromCoes(coe, chase) : null;
            sim = { exact: true, coe, chase, circular, n, P, spanT, count, path: s.path, frame,
                rmoe, tSat, cSat, axes, cwPath: rmoe && settings.cwOverlay ? M.sampleTrajectory(rmoe, n, 0, spanT, count) : null };
        } else if (settings.ricModel === 'exact') {
            // The exact model from the RMOEs: chase starts at their relative state.
            const rmoe = mathRmoe();
            const tSat = M.targetSat(coe);
            const cSat = M.chaseSatFromRic(M.stateFromRmoe(rmoe, n, 0), tSat, 0, axes);
            const s = M.sampleRelativeSats(tSat, cSat, 0, spanT, count, axes);
            const frame = V.framePath(coe, times, s.rect);
            sim = { exact: true, fromRmoe: true, coe, chase: null, circular: true, n, P, spanT, count, rmoe, path: s.path, frame,
                tSat, cSat, axes, cwPath: settings.cwOverlay ? M.sampleTrajectory(rmoe, n, 0, spanT, count) : null };
        } else {
            const rmoe = mathRmoe();
            const path = M.sampleTrajectory(rmoe, n, 0, spanT, count);
            sim = { exact: false, coe, chase: null, circular: true, n, P, spanT, count, rmoe, path, frame: V.framePath(coe, times, path) };
        }
        if (stage.inertial) {
            stage.inertial.setOrbit(coe);
            stage.inertial.setChaseOrbit(sim.chase);
            stage.inertial.setPath(sim.frame);
        }
        state.t = Math.min(rev, state.revs) * P;
        dirty = true;
    }

    /* ---------- Fitting ---------- */
    // full false: only zoom out (used while a slider is dragged, so the picture does not jump in and out).
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
            // The cross-track points on the NMC chase is on now (drift held still), the same ellipse
            // as the dotted NMC trace and the corner points.
            const dmNow = rNow.dM0;
            const still = Object.assign({}, rNow, { xc: 0 });
            [['+P.C. 0°', 0], ['Left 90°', 90], ['−P.C. 180°', 180], ['Right 270°', 270]].forEach(([text, ang]) => {
                const dt = M.timeToAngle(dmNow, ang, sim.n);
                const s = M.stateFromRmoe(still, sim.n, dt);
                s[0] += rNow.xc;
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
        let now, basis, chaseRv, rDraw, rTable;
        let rectNow;
        if (sim.exact) {
            const rel = M.relativeStateSats(sim.tSat, sim.cSat, t, sim.axes);
            now = rel.rho;
            rectNow = rel.rect.rho;
            basis = rel.basis;
            chaseRv = rel.chase;   // the chase's own r and v, propagated
            // Drawn from chase's true relative state, so the NMC trace always passes through chase.
            // The table's Now column: from the RMOEs, the instantaneous RMOEs fitted to the exact
            // state; from COEs, the epoch RMOEs moved on by CW, so it agrees with the Epoch column.
            rDraw = sim.circular ? M.rmoeFromState([...rel.rho, ...rel.rhoDot], sim.n) : null;
            rTable = sim.fromRmoe ? rDraw : (sim.circular ? M.rmoeAt(sim.rmoe, sim.n, t) : null);
        } else {
            now = M.stateFromRmoe(sim.rmoe, sim.n, t);
            rDraw = rTable = M.rmoeAt(sim.rmoe, sim.n, t);
            basis = M.ricBasis(sim.coe, t);
            chaseRv = M.chaseRvFromRic(now, basis);   // the course model's chase, in ECI
            rectNow = now;
        }
        const k = sampleIndex(t);
        const trail = sim.path.subarray(0, 3 * (k + 1));
        const nmcLoop = state.nmcTrace && rDraw ? M.nmcLoop(rDraw) : null;   // the whole NMC chase is on now, dotted
        // The CW overlay: the course model's path, drawn faintly beside the exact one.
        const ghosts = sim.cwPath ? [sim.path, sim.cwPath] : [sim.path];
        const data = {
            chase: now, trail, ghosts, nmcLoop,
            rmoe: rDraw && (state.annot.center || state.hot === 'xc' || state.hot === 'yc0') ? rDraw : null,
            showNmc: state.annot.size || state.annot.corners
        };
        stage.visiblePlanes().forEach(p => { p.draw(data); if (rDraw) annotate(p, now, rDraw); });
        if (stage.box && stage.boxVisible()) {
            stage.box.setBackdrop(state.backdrop);
            stage.box.setInset(state.inset);
            stage.box.setOrbit(state.orbit3d);
            stage.box.update({ chase: now, trail, nmcLoop, ghost: sim.path, basis, rT: basis.r, t, targetCoe: sim.coe, chaseRv });
        }
        if (stage.inertial) {
            // ghost: the whole path is drawn faintly from the start, so the carried trail never
            // vanishes when the clock wraps back to epoch.
            stage.inertial.update({ t, rho: rectNow, basis, rT: basis.r, from: 0, to: k, ghost: true });
        }
        updateLive(rTable);
        updateModelLabels(now, t);
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
                if (!Number.isFinite(value) || state.mode !== 'rmoe') return;
                if ((row.key === 'C' || row.key === 'zmax') && value < 0) value = 0;
                if (row.unit === '°') value = M.wrap360(value);
                markCustom();
                state.rmoe[row.key] = value;
                state.lastRow = row.key;
                if (isCircular()) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
                rebuild();
                refit(final);
                updateInputs(row.key);
                updateStatic();
                fillElTable();
                drawAll();
            };
            range.addEventListener('input', () => set(Number(range.value), false));
            range.addEventListener('change', () => { refit(true); dirty = true; });
            // Live while typing (a half-typed value such as "-" is skipped); Enter or leaving the
            // field rewrites it and fits the views.
            num.addEventListener('input', () => { if (num.value.trim() !== '') set(Number(num.value), false); });
            num.addEventListener('change', () => set(Number(num.value), true));
            // Hovering or focusing a row highlights what it controls.
            const hotOn = () => { state.hot = row.key; wrap.classList.add('hot'); dirty = true; };
            const hotOff = () => { if (state.hot === row.key) state.hot = null; wrap.classList.remove('hot'); dirty = true; };
            [range, num].forEach(el => { el.addEventListener('focus', hotOn); el.addEventListener('blur', hotOff); });
            wrap.querySelectorAll('span, input').forEach(el => { el.addEventListener('mouseenter', hotOn); el.addEventListener('mouseleave', hotOff); });
        });
    }

    function updateInputs(skip) {
        const ranges = RANGES[nearestKey()];
        ROWS.forEach(row => {
            const els = rowEls[row.key], [lo, hi, step] = ranges[row.key];
            els.range.min = lo; els.range.max = hi; els.range.step = step;
            els.range.value = String(Math.min(hi, Math.max(lo, state.rmoe[row.key])));
            if (row.key !== skip || document.activeElement !== els.num) els.num.value = String(Number(state.rmoe[row.key].toFixed(4)));
            const undef = (row.key === 'M0' && state.rmoe.C <= TINY) || (row.key === 'dM0' && state.rmoe.zmax <= TINY);
            els.range.disabled = undef;
            els.num.classList.toggle('rm-undef', undef);
            els.num.readOnly = state.mode !== 'rmoe';
            els.num.tabIndex = state.mode === 'rmoe' ? 0 : -1;
        });
    }

    function updateStatic() {
        const hasRmoe = Boolean(sim.rmoe);
        document.body.classList.toggle('no-rmoe', !hasRmoe);
        $('model-line').innerHTML = (sim.exact
            ? '<b>Exact model:</b> both spacecraft fly their own orbits.' + (hasRmoe ? '' : ' The target’s orbit is not circular, so there are no RMOEs.')
            : '<b>Course model:</b> the linear (CW) equations, for a circular target.') + (state.modeNote ? ' ' + state.modeNote : '');
        showTargetPick();
        $('frame-pick').querySelector('[data-value="ECEF"]').disabled = !isGeoTarget();
        if (document.activeElement !== $('target-a')) { $('target-a').value = fmtNum(state.target.a, 3); $('target-a').classList.remove('bad'); }
        if (hasRmoe) {
            const r = sim.rmoe, n = sim.n;
            const s = M.stateFromRmoe(r, n, 0);
            $('s-x').textContent = fmt(s[0], 3); $('s-y').textContent = fmt(s[1], 3); $('s-z').textContent = fmt(s[2], 3);
            $('s-vx').textContent = fmt(s[3] * 1000, 4); $('s-vy').textContent = fmt(s[4] * 1000, 4); $('s-vz').textContent = fmt(s[5] * 1000, 4);
            $('motion').textContent = M.classifyMotion(r).label;
            const drift = M.driftRate(r, n, sim.coe.a);
            // A drift that rounds to 0.00 km/rev (typed velocities a digit short of exact) reads as none.
            $('drift-read').textContent = Math.abs(drift.kmPerRev) >= 0.005
                ? `Drift ${fmt(drift.kmPerRev, 2)} km/rev (${fmt(drift.degPerRev, 4)}°/rev), ${drift.kmPerRev < 0 ? 'backward' : 'forward'}.`
                : 'No drift: x_C = 0.';
            const aChase = sim.coe.a + r.xc;
            $('co-da').textContent = fmt(r.xc, 2) + ' km';
            $('co-e').textContent = (r.C / aChase).toExponential(3);
            $('co-th').textContent = fmt(r.zmax / sim.coe.a * M.R2D, 5) + '°';
        }
        const P = sim.P;
        $('co-p').textContent = P > 7200 ? (P / 3600).toFixed(3) + ' h' : (P / 60).toFixed(2) + ' min';
        const row = state.mode === 'rmoe' ? ROWS.find(x => x.key === state.lastRow) : null;
        const preset = state.presetCustom ? null : PRESETS[state.preset];
        const noticeEl = $('notice');
        if (noticeEl) {
            noticeEl.textContent = row ? row.notice : preset ? (state.mode === 'coe' ? preset.coeNotice : preset.notice)
                : state.presetCustom ? 'These are your own numbers, not a preset’s. Reset Preset puts back ' + PRESETS[state.preset].name + '.' : '';
        }
        updatePv();
        updateNotes();
    }

    // GEO, GPS, or LEO when the target is that orbit and Custom was not picked; otherwise Custom.
    function showTargetPick() {
        const t = state.target;
        const match = SHORTCUTS.find(k => { const s = TARGETS[k]; return Math.abs(t.a - s.a) < 1e-9 && Math.abs(t.i - s.i) < 1e-9 && Math.abs(t.raan - s.raan) < 1e-9 && t.e < 1e-12; });
        const pick = state.customTarget || !match ? 'custom' : match;
        $('target-pick').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === pick)));
    }

    /* ---------- Set COEs: the element table ---------- */
    const elTable = $('el-table');
    const cells = {};
    const fmtNum = (v, digits) => String(Number(v.toFixed(digits)));
    function buildElTable() {
        let html = '<span></span><span class="el-head">Target</span><span class="el-head">Difference</span><span class="el-head">Chase</span>';
        EL_ROWS.forEach(r => {
            html += '<span class="el-name">' + r.name + (r.unit ? ' <small>' + r.unit + '</small>' : '') + '</span>' +
                '<span class="col-target"><input type="number" step="any" data-col="target" data-key="' + r.key + '" aria-label="Target ' + r.name + '"></span>' +
                '<span class="el-diff"><input type="number" step="any" data-col="diff" data-key="' + r.key + '" aria-label="Difference in ' + r.name + '">' +
                '<input type="range" data-col="slider" data-key="' + r.key + '" aria-label="Difference in ' + r.name + ' slider"></span>' +
                '<span class="col-chase"><input type="number" step="any" data-col="chase" data-key="' + r.key + '" aria-label="Chase ' + r.name + '"></span>';
        });
        elTable.innerHTML = html;
        EL_ROWS.forEach(r => {
            cells[r.key] = {
                target: elTable.querySelector('[data-col="target"][data-key="' + r.key + '"]'),
                diff: elTable.querySelector('[data-col="diff"][data-key="' + r.key + '"]'),
                slider: elTable.querySelector('[data-col="slider"][data-key="' + r.key + '"]'),
                chase: elTable.querySelector('[data-col="chase"][data-key="' + r.key + '"]')
            };
        });
    }
    function fillElTable(skip) {
        const chase = chaseCoe();
        const ranges = SMALL[nearestKey()];
        EL_ROWS.forEach(r => {
            const c = cells[r.key];
            let [lo, hi, step] = ranges[r.d];
            if (r.key === 'e' && state.target.e > 1e-6) lo = -state.target.e;
            c.slider.min = lo; c.slider.max = hi; c.slider.step = step;
            c.slider.value = String(Math.min(hi, Math.max(lo, state.diff[r.d])));
            if (c.target !== skip) c.target.value = fmtNum(state.target[r.key], r.digits);
            if (c.diff !== skip) c.diff.value = fmtNum(state.diff[r.d], r.digits);
            if (c.chase !== skip) c.chase.value = fmtNum(chase[r.key], r.digits);
        });
        // An eccentric target only with Advanced on.
        const eOk = isAdvanced();
        cells.e.target.disabled = !eOk;
        cells.e.target.title = eOk ? 'The target’s eccentricity. Above 0 the course model (RMOEs) does not apply.' : 'Turn on Advanced to give the target an eccentric orbit.';
    }
    function clearBad() {
        elTable.querySelectorAll('input.bad').forEach(i => i.classList.remove('bad'));
        $('el-msg').textContent = '';
    }
    // Try new orbits; keep the last valid ones on screen if either orbit is not allowed.
    // A change the user made in the table: the numbers are no longer the preset's.
    function userCommit(...args) { const ok = commit(...args); if (ok) markCustom(); return ok; }
    // quiet: a value still being typed; if it is not allowed, wait without an error.
    function commit(target, diff, field, final, quiet) {
        const chase = M.coeFromDifference(target, diff);
        const problem = M.orbitProblem(target) || M.orbitProblem(chase);
        if (problem && quiet) return false;
        if (problem) {
            if (field) field.classList.add('bad');
            $('el-msg').textContent = MESSAGES[problem];
            return false;
        }
        clearBad();
        state.target = target;
        state.diff = diff;
        state.modeNote = '';
        syncRmoeFromCoes();
        if (!isGeoTarget() && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); applyViewOptions(); }
        rebuild();
        refit(final !== false);
        updateInputs();
        updateStatic();
        fillElTable(field && field.type === 'number' ? field : null);
        drawAll();
        return true;
    }
    elTable.addEventListener('input', e => {
        const el = e.target;
        const row = EL_ROWS.find(r => r.key === el.dataset.key);
        if (!row) return;
        if (el.dataset.col === 'slider') { userCommit({ ...state.target }, { ...state.diff, [row.d]: Number(el.value) }, el, false); return; }
        // A number field, live while typing: skip a half-typed value or one outside the limits,
        // and leave the field as typed (the change event below tidies it).
        const v = Number(el.value);
        if (el.value.trim() === '' || !isFinite(v)) return;
        if (el.dataset.col === 'target') {
            if (row.key === 'a') { state.customTarget = true; showTargetPick(); }   // typing the target's a picks Custom
            const [lo, hi] = TARGET_LIMITS[row.key];
            if (v < lo || v > hi || (row.key === 'e' && !isAdvanced())) return;
            userCommit({ ...state.target, [row.key]: v }, { ...state.diff }, el, false, true);
        } else if (el.dataset.col === 'diff') {
            userCommit({ ...state.target }, { ...state.diff, [row.d]: v }, el, false, true);
        } else {
            userCommit({ ...state.target }, M.coeDifference(state.target, { ...chaseCoe(), [row.key]: v }), el, false, true);
        }
    });
    elTable.addEventListener('change', e => {
        const el = e.target;
        const row = EL_ROWS.find(r => r.key === el.dataset.key);
        if (!row) return;
        if (el.dataset.col === 'slider') { refit(true); dirty = true; return; }
        const v = Number(el.value);
        if (el.value.trim() === '' || !isFinite(v)) { fillElTable(); return; }
        if (el.dataset.col === 'target') {
            const [lo, hi] = TARGET_LIMITS[row.key];
            const target = { ...state.target, [row.key]: Math.min(hi, Math.max(lo, v)) };
            if (row.key === 'e' && !isAdvanced()) target.e = 0;
            if (userCommit(target, { ...state.diff }, el)) fillElTable();
        } else if (el.dataset.col === 'diff') {
            if (userCommit({ ...state.target }, { ...state.diff, [row.d]: v }, el)) fillElTable();
        } else {
            const chase = { ...chaseCoe(), [row.key]: v };
            if (userCommit({ ...state.target }, M.coeDifference(state.target, chase), el)) fillElTable();
        }
    });
    Kit.bindSegmented($('starts'), value => {
        const chase = chaseCoe();
        const Mstar = Number(value);
        const Mc = M.meanFromTrue(chase.nu, chase.e) * M.R2D;
        chase.argp = M.wrap360(chase.argp + Mc - Mstar);
        chase.nu = M.trueFromMean(Mstar * M.D2R, chase.e);
        userCommit({ ...state.target }, M.coeDifference(state.target, chase), null);
    });
    function updateNotes() {
        if (state.mode !== 'coe') return;
        const t = state.target, c = chaseCoe(), notes = [];
        if (t.e < 1e-6 || c.e < 1e-6) notes.push('For a circular orbit only ω + ν matters: together they are the position along the orbit.');
        if (t.i < 1 && Math.abs(state.diff.draan) > 1e-9) notes.push('At zero inclination, turning the node only moves chase along the orbit.');
        if (t.e > 1e-6) notes.push('The target’s orbit is not circular, so the course model (RMOEs) does not apply. Switching to RMOEs makes it circular.');
        if (Math.abs(state.diff.dnu) > 1e-12 && (t.e > 1e-6 || c.e > 1e-6 || Math.abs(state.diff.da) > 1e-9))
            notes.push('A difference in ν is a fixed distance along the track only when both orbits are circular and the same size.');
        $('el-notes').innerHTML = notes.map(s => '<li>' + s + '</li>').join('');
        const show = isCircular() && c.e > 1e-9;
        $('starts-row').style.display = show ? '' : 'none';
        if (show) {
            const Mc = M.wrap360(M.meanFromTrue(c.nu, c.e) * M.R2D);
            $('starts').querySelectorAll('button').forEach(b => {
                const d = Math.abs(M.wrap180(Mc - Number(b.dataset.value)));
                b.setAttribute('aria-pressed', String(d < 0.05));
            });
        }
    }
    // Advanced off: an eccentric target goes back to circular.
    new MutationObserver(() => {
        // The Frame toggle shows only with Advanced on, so turning Advanced off goes back to ECI.
        if (!isAdvanced() && state.frame !== 'ECI') { state.frame = 'ECI'; selectFrame('ECI'); }
        if (!isAdvanced() && state.target.e > 0) commit({ ...state.target, e: 0 }, { ...state.diff, de: Math.max(0, state.diff.de) }, null);
        else fillElTable();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* ---------- Set Position and Velocity ---------- */
    // Fields hold km and m/s; the state array holds km and km/s.
    const PV_IDS = ['pv-x', 'pv-y', 'pv-z', 'pv-vx', 'pv-vy', 'pv-vz'];
    const pvState = () => M.stateFromRmoe(mathRmoe(), sim.n, 0);
    function currentPvInputs() {
        return PV_IDS.map((id, k) => {
            const el = $(id);
            const val = el ? Number(el.value) : NaN;
            if (Number.isFinite(val)) return k < 3 ? val : val / 1000;
            const s = pvState();
            return s[k];
        });
    }
    function buildPv() {
        PV_IDS.forEach((id, k) => {
            // final: Enter or leaving the field (fit the views, put back a bad entry); otherwise live
            // while typing, skipping a half-typed value.
            const apply = final => {
                const text = $(id).value.trim();
                const value = Number(text);
                if (!text || !Number.isFinite(value)) { if (final) updatePv(); return; }
                const s = currentPvInputs();
                s[k] = k < 3 ? value : value / 1000;
                markCustom();
                state.rmoe = stored(M.rmoeFromState(s, sim.n));
                state.lastRow = null;
                if (isCircular()) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
                rebuild();
                refit(final);
                updateInputs();
                updateStatic();
                fillElTable();
                drawAll();
            };
            $(id).addEventListener('input', () => apply(false));
            $(id).addEventListener('change', () => apply(true));
        });
    }
    // KaTeX when it loaded, else the TeX source, so the numbers can still be read.
    const tex = s => (window.katex ? window.katex.renderToString(s, { throwOnError: false }) : '<code class="tex-source">' + s.replace(/</g, '&lt;') + '</code>');
    const tnum = (v, d) => { const s = (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const tres = (v, d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);   // a result: no parentheses
    const tsci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };
    function updatePv() {
        if (!sim || state.mode !== 'pv') return;
        const s = pvState();
        PV_IDS.forEach((id, k) => {
            if (document.activeElement === $(id)) return;
            $(id).value = String(Number((k < 3 ? s[k] : s[k] * 1000).toFixed(k < 3 ? 4 : 6)));
        });
        const n = sim.n, a = sim.coe.a;
        const [x0, y0, z0, vx, vy, vz] = s;
        const r = M.rmoeFromState(s, n);
        const ms = v => tnum(v * 1000, 6) + '/1000';     // a velocity typed in m/s, put into km/s
        const nT = tsci(n);
        const rows = [];
        rows.push({ key: null, eq: `n = \\sqrt{\\mu / a^3} = \\sqrt{${fmtNum(M.MU, 2)} / ${fmtNum(a, 3)}^3} = ${nT}\\ \\text{rad/s}` });
        rows.push({ key: 'xc', eq: `x_C = 4x_0 + \\frac{2\\dot y_0}{n} = 4${tnum(x0, 4)} + \\frac{2\\,${ms(vy)}}{${nT}} = ${tres(r.xc, 3)}\\ \\text{km}` });
        rows.push({ key: 'yc0', eq: `y_{C0} = y_0 - \\frac{2\\dot x_0}{n} = ${tnum(y0, 4)} - \\frac{2\\,${ms(vx)}}{${nT}} = ${tres(r.yc0, 3)}\\ \\text{km}` });
        rows.push({ key: 'C', eq: `C = \\sqrt{(x_C - x_0)^2 + \\left(\\frac{y_{C0} - y_0}{2}\\right)^2} = \\sqrt{${tnum(r.xc - x0, 3)}^2 + ${tnum((r.yc0 - y0) / 2, 3)}^2} = ${tres(r.C, 3)}\\ \\text{km}` });
        rows.push({ key: 'zmax', eq: `z_{max} = \\sqrt{z_0^2 + (\\dot z_0 / n)^2} = \\sqrt{${tnum(z0, 4)}^2 + ${tnum(vz / n, 3)}^2} = ${tres(r.zmax, 3)}\\ \\text{km}` });
        // M_0 and ΔM_0: the inverse cosine or sine has two angles that fit, and the sign of the
        // matching rate picks one. Shown as: the fraction with its numbers, the two angles, which
        // one and why, then the answer on its own line.
        const mps = v => tres(v * 1000, 4) + '\\ \\text{m/s}';
        const deg = v => tres(v, 1) + '^\\circ';
        const STILL = 1e-12;
        if (r.M0 === null) rows.push({ key: 'M0', eq: 'M_0 = \\text{undefined}', why: tex('C = 0') + ': there is no ellipse, so there is no place on it.' });
        else {
            const base = Math.acos(Math.max(-1, Math.min(1, (r.xc - x0) / r.C))) * M.R2D;
            const other = 360 - base;
            const why = Math.abs(vx) < STILL
                ? `${tex('\\dot x_0 = 0')}: chase is at the bottom or top of the NMC, which ${tex('\\cos^{-1}')} gives directly.`
                : `Two angles have this cosine: ${tex(deg(base))} and ${tex(`360^\\circ - ${deg(base)} = ${deg(other)}`)}. ` +
                  (vx < 0 ? `${tex(`\\dot x_0 = ${mps(vx)}`)} is negative, so ${tex('\\sin M_0 < 0')}: ${tex('M_0')} is between 180° and 360°.`
                      : `${tex(`\\dot x_0 = ${mps(vx)}`)} is positive, so ${tex('\\sin M_0 > 0')}: ${tex('M_0')} is between 0° and 180°.`);
            rows.push({ key: 'M0', eq: `M_0 = \\cos^{-1}\\dfrac{x_C - x_0}{C} = \\cos^{-1}\\dfrac{${tnum(r.xc - x0, 3)}}{${tres(r.C, 3)}}`, why,
                result: `M_0 = ${deg(r.M0)}` });
        }
        if (r.dM0 === null) rows.push({ key: 'dM0', eq: '\\Delta M_0 = \\text{undefined}', why: tex('z_{max} = 0') + ': there is no swing, so there is no place in it.' });
        else {
            const base = Math.asin(Math.max(-1, Math.min(1, z0 / r.zmax))) * M.R2D;
            const other = 180 - base;
            let why;
            if (Math.abs(vz) < STILL) why = `${tex('\\dot z_0 = 0')}: chase is at the far left or far right, which ${tex('\\sin^{-1}')} gives directly` + (base < 0 ? `; ${tex(deg(base))} is ${tex(deg(r.dM0))}.` : '.');
            else {
                why = `Two angles have this sine: ${tex(deg(base))} and ${tex(`180^\\circ - ${tnum(base, 1)}^\\circ = ${deg(other)}`)}. `;
                if (vz < 0) why += `${tex(`\\dot z_0 = ${mps(vz)}`)} is negative, so ${tex('\\cos \\Delta M_0 < 0')}: ${tex('\\Delta M_0')} is between 90° and 270°.`;
                else why += `${tex(`\\dot z_0 = ${mps(vz)}`)} is positive, so ${tex('\\cos \\Delta M_0 > 0')}: ${tex('\\Delta M_0')} is between −90° and 90°` +
                    (base < 0 ? `, so it is ${tex(deg(base))}, the same as ${tex(deg(r.dM0))}.` : '.');
            }
            rows.push({ key: 'dM0', eq: `\\Delta M_0 = \\sin^{-1}\\dfrac{z_0}{z_{max}} = \\sin^{-1}\\dfrac{${tnum(z0, 3)}}{${tres(r.zmax, 3)}}`, why,
                result: `\\Delta M_0 = ${deg(r.dM0)}` });
        }
        const drift = M.driftRate(r, n, a);
        rows.push({ key: 'xc', eq: `\\dot y_C = -\\tfrac{3}{2} n x_C = ${tres(drift.kmPerSec * 1000, 4)}\\ \\text{m/s} = -3\\pi x_C = ${tres(drift.kmPerRev, 3)}\\ \\text{km/rev}` });
        const box = $('pv-eqs');
        box.innerHTML = rows.map(row => `<div class="pv-eq"${row.key ? ` data-key="${row.key}"` : ''}>${tex(row.eq)}${row.why ? `<div class="pv-why">${row.why}</div>` : ''}${row.result ? `<div class="pv-result">${tex(row.result)}</div>` : ''}</div>`).join('');
        box.querySelectorAll('.pv-eq[data-key]').forEach(el => {
            const key = el.dataset.key;
            el.addEventListener('mouseenter', () => { state.hot = key; el.classList.add('hot'); dirty = true; });
            el.addEventListener('mouseleave', () => { if (state.hot === key) state.hot = null; el.classList.remove('hot'); dirty = true; });
        });
    }

    /* ---------- What you set ---------- */
    // Switching keeps the motion. To COEs: chase's elements from the RMOEs (coesFromRmoe). From
    // COEs: the RMOEs the elements give (rmoeFromCoes); an eccentric target is made circular first.
    function applyMode(mode) {
        if (mode === 'coe' && !isDev()) return;
        const from = state.mode;
        state.modeNote = '';
        if (mode === 'coe' && from !== 'coe') {
            state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
            clearBad();
        } else if (mode !== 'coe' && from === 'coe') {
            if (!isCircular()) {
                state.target = { ...state.target, e: 0 };
                state.diff = { ...state.diff, de: Math.max(0, state.diff.de) };
                state.modeNote = 'RMOEs need a circular target, so the target’s e is now 0.';
            }
            syncRmoeFromCoes();
        }
        state.mode = mode;
        state.lastRow = null;
        ['coe', 'rmoe', 'pv'].forEach(m => document.body.classList.toggle('mode-' + m, m === mode));
        $('pv-block').hidden = mode !== 'pv';
        $('set-title').textContent = TITLES[mode];
        rebuild();
        refit(true);
        updateInputs();
        updateStatic();
        if (mode === 'coe') fillElTable();
        drawAll();
    }
    const selectMode = Kit.bindSegmented($('mode-pick'), mode => {
        if (mode === 'coe' && !isDev()) return;
        if (mode !== state.mode) applyMode(mode === 'coe' || mode === 'pv' ? mode : 'rmoe');
    });

    // Labels that say which model the readouts come from, and the CW overlay's live gap.
    function updateModelLabels(now, t) {
        const head = $('rm-now-head');
        if (head) head.textContent = sim.fromRmoe ? 'Now (instantaneous, exact)' : 'Now (CW)';
        const gapEl = $('cw-gap');
        if (!gapEl) return;
        gapEl.hidden = !sim.cwPath;
        if (sim.cwPath) {
            const c = M.stateFromRmoe(sim.rmoe, sim.n, t);
            const g = Math.hypot(now[0] - c[0], now[1] - c[1], now[2] - c[2]);
            gapEl.textContent = 'Exact minus CW now: ' + (g < 1 ? fmt(g * 1000, 1) + ' m' : fmt(g, 3) + ' km') + ' (faint path: CW)';
        }
    }

    function updateLive(rNow) {
        $('time-read').textContent = (state.t / sim.P).toFixed(2) + ' rev';
        $('sp-span').textContent = state.revs + (state.revs === 1 ? ' rev' : ' revs');
        $('sp-back').disabled = state.revs <= 1;
        $('sp-fwd').disabled = state.revs >= MAX_REVS;
        $('scrubber').max = String(Math.round(state.revs * 1000));
        $('scrubber').value = String(Math.round(state.t / sim.P * 1000));
        if (!rNow) return;
        const r = mathRmoe();
        ROWS.forEach(row => {
            const v = rNow[row.key];
            const els = rowEls[row.key];
            els.now.textContent = row.unit === '°' ? fmtAngle(v) : fmt(v, row.key === 'yc0' ? 1 : 2);
            els.num.title = row.unit === '°' && r[row.key] === null ? 'Undefined while ' + (row.key === 'M0' ? 'C' : 'z_max') + ' is zero' : '';
        });
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
    // Any number the user changes (RMOEs, position and velocity, the element table, Chase Starts
    // At) turns the preset list to Custom. Reset Preset still loads the last preset picked. Target
    // buttons and a do not: a preset is the same motion at every target.
    function markCustom() {
        if (state.presetCustom) return;
        state.presetCustom = true;
        $('preset').value = 'custom';
    }
    function fillPresets() {
        const sel = $('preset');
        // Presets with a group go in an <optgroup> of that name, in the order the groups first appear.
        const groups = {};
        PRESETS.forEach((p, k) => {
            if (!p.group) { sel.appendChild(new Option(p.name, String(k))); return; }
            if (!groups[p.group]) { groups[p.group] = document.createElement('optgroup'); groups[p.group].label = p.group; sel.appendChild(groups[p.group]); }
            groups[p.group].appendChild(new Option(p.name, String(k)));
        });
        // Custom: shown when the user changes any number; it cannot be picked from the list.
        const custom = new Option('Custom', 'custom');
        custom.hidden = true;
        sel.appendChild(custom);
        sel.addEventListener('change', () => { if (sel.value !== 'custom') loadPreset(Number(sel.value)); });
        $('reset-preset').addEventListener('click', () => loadPreset(state.preset));
    }
    // A preset in the current mode, on the nearest target button's orbit (made circular).
    function loadPreset(index) {
        const p = PRESETS[index];
        const key = nearestKey();
        const s = SCALE[key];
        state.preset = index;
        state.presetCustom = false;
        $('preset').value = String(index);
        // Custom keeps the typed orbit (made circular); the presets scale by the nearest button.
        state.target = state.customTarget ? { ...state.target, e: 0 } : { ...TARGETS[key] };
        state.rmoe = { ...ZERO };
        Object.entries(p.rmoe).forEach(([k, value]) => { state.rmoe[k] = k === 'M0' || k === 'dM0' ? value : value * s; });
        // Element differences: km scale like the RMOEs; e and angles also by a_GEO / a, so the
        // motion is the same number of km at every target.
        const sAng = s * M.GEO_A / state.target.a;
        state.diff = { ...ZERO_DIFF };
        Object.entries(p.diff).forEach(([k, value]) => { state.diff[k] = value * (k === 'da' ? s : sAng); });
        if (state.mode === 'coe') syncRmoeFromCoes();
        state.modeNote = '';
        state.lastRow = null;
        state.t = 0; state.revs = p.span || 2;
        if (!isGeoTarget() && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); }
        clearBad();
        stage.selectBoxView('3d');
        rebuild();
        applyViewOptions();
        refit(true);
        updateInputs();
        updateStatic();
        fillElTable();
        drawAll();
    }
    // A target button keeps the motion's shape, scaled to the new target, as presets are.
    // Custom changes nothing by itself: it points to the a field, where typing sets the orbit.
    Kit.bindSegmented($('target-pick'), key => {
        if (key === 'custom') {
            state.customTarget = true;
            showTargetPick();
            const field = state.mode === 'coe' ? cells.a.target : $('target-a');
            field.focus(); field.select();
            return;
        }
        state.customTarget = false;
        // A button always fills in a, even if the a field still has the cursor in it.
        if (document.activeElement === $('target-a')) $('target-a').blur();
        if (cells.a && document.activeElement === cells.a.target) cells.a.target.blur();
        const ratio = SCALE[key] / SCALE[nearestKey()];
        const circular = isCircular();
        const r = mathRmoe();
        ['xc', 'yc0', 'C', 'zmax'].forEach(k => { r[k] *= ratio; });
        state.target = { ...TARGETS[key] };
        state.modeNote = '';
        if (state.mode === 'coe') {
            if (circular) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, r));
            else state.diff = { ...state.diff, de: Math.max(0, state.diff.de) };
            syncRmoeFromCoes();
        } else state.rmoe = stored(r);
        if (key !== 'geo' && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); }
        state.t = 0;
        clearBad();
        rebuild();
        applyViewOptions();
        if (stage.inertial) stage.inertial.resetView();
        refit(true);
        updateInputs();
        updateStatic();
        fillElTable();
        drawAll();
    });

    // A typed target a (Set RMOEs and Set Position and Velocity; Set COEs has its own table). Only the
    // size changes: the plane stays and the RMOEs keep their km, so the motion keeps its shape while
    // n, the period, and the drift rate follow a. Live while typing; a value outside the limits
    // waits, and on Enter or leaving the field it is marked and put back.
    const A_TITLE = $('target-a').title;
    function setTargetA(final) {
        const el = $('target-a'), [lo, hi] = TARGET_LIMITS.a;
        const v = Number(el.value);
        const ok = el.value.trim() !== '' && Number.isFinite(v) && v >= lo && v <= hi;
        el.classList.toggle('bad', !ok && final);
        if (!ok) {
            if (final) { el.title = 'Use a value from ' + lo + ' to ' + hi + ' km.'; el.value = fmtNum(state.target.a, 3); }
            return;
        }
        el.title = A_TITLE;
        if (Math.abs(v - state.target.a) < 1e-9 && !final) return;
        state.target = { ...state.target, a: v, e: 0 };
        state.modeNote = '';
        if (state.mode === 'pv') {
            const s = currentPvInputs();
            state.rmoe = stored(M.rmoeFromState(s, M.meanMotion(v)));
            if (isCircular()) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
        } else if (state.mode === 'rmoe') {
            if (isCircular()) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
        } else if (state.mode === 'coe') {
            syncRmoeFromCoes();
        }
        if (!isGeoTarget() && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); }
        rebuild();
        applyViewOptions();
        refit(final);
        updateInputs();
        updateStatic();
        fillElTable();
        drawAll();
        if (final) el.value = fmtNum(state.target.a, 3);
    }
    // Typing in a picks Custom.
    $('target-a').addEventListener('input', () => { state.customTarget = true; showTargetPick(); setTargetA(false); });
    $('target-a').addEventListener('change', () => setTargetA(true));

    /* ---------- Time ---------- */
    // The full controls (Advanced) and the simple playback bar share one clock and one speed.
    function setPlaying(on) { state.playing = on; $('play').textContent = $('sp-play').textContent = on ? 'Pause' : 'Play'; }
    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('sp-play').addEventListener('click', () => setPlaying(!state.playing));
    $('scrubber').addEventListener('input', e => { state.t = Number(e.target.value) / 1000 * sim.P; setPlaying(false); dirty = true; });
    const showSpeed = (group, v) => group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
    Kit.bindSegmented($('speed'), v => { state.speed = Number(v); showSpeed($('sp-speed'), v); });
    Kit.bindSegmented($('sp-speed'), v => { state.speed = Number(v); showSpeed($('speed'), v); });
    // Move the clock by some revs; the drawn span grows to hold it (up to MAX_REVS).
    function jump(revs) {
        state.t = Math.min(MAX_REVS * sim.P, Math.max(0, state.t + revs * sim.P));
        const needed = Math.max(2, Math.ceil(state.t / sim.P - 1e-9));
        if (needed > state.revs) { const t = state.t; state.revs = needed; rebuild(); state.t = t; refit(true); }
        setPlaying(false);
        dirty = true;
    }
    document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => jump(Number(b.dataset.jump))));
    // The simple bar's buttons change how many revs of the path are drawn (1 to MAX_REVS), not the
    // time; playback keeps running and starts over at the end of the new span.
    function setSpan(revs) {
        revs = Math.max(1, Math.min(MAX_REVS, revs));
        if (revs === state.revs) return;
        const t = state.t;
        state.revs = revs;
        rebuild();
        state.t = Math.min(t, sim.spanT);
        refit(true);
        dirty = true;
    }
    $('sp-fwd').addEventListener('click', () => setSpan(state.revs + 1));
    $('sp-back').addEventListener('click', () => setSpan(state.revs - 1));
    $('epoch').addEventListener('click', () => {
        state.t = 0;
        if (state.revs !== 2) { state.revs = 2; rebuild(); refit(true); }
        setPlaying(false);
        dirty = true;
    });
    $('fit-views').addEventListener('click', () => { refit(true); dirty = true; });

    /* ---------- View options ---------- */
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
        inertial.setExtras({ axes: false, equator: false, orbits: state.orbits });
        inertial.setLabels(state.labels);
        updateMagRead();
    }
    $('mag').addEventListener('input', e => { state.mag = magFromSlider(Number(e.target.value) / 1000); applyViewOptions(); dirty = true; });
    const selectFrame = Kit.bindSegmented($('frame-pick'), v => {
        state.frame = v === 'ECEF' && isGeoTarget() ? 'ECEF' : 'ECI';
        if (state.frame !== v) selectFrame(state.frame);
        applyViewOptions();
        dirty = true;
    });
    [['opt-orbits', 'orbits'], ['opt-inertial', 'inertialTrail'], ['opt-carried', 'carried'], ['opt-backdrop', 'backdrop'], ['opt-inset', 'inset'], ['opt-orbit3d', 'orbit3d'], ['opt-nmc', 'nmcTrace'], ['opt-labels', 'labels']].forEach(([id, key]) => {
        $(id).addEventListener('change', e => { state[key] = e.target.checked; applyViewOptions(); dirty = true; });
    });

    /* ---------- Start ---------- */
    buildTable();
    buildElTable();
    buildPv();
    fillPresets();
    if (state.mode === 'coe' && !isDev()) state.mode = 'rmoe';
    document.body.classList.add('mode-' + state.mode);
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
    window.relativeMotionExplorer = {
        state, sim: () => sim, stage, presets: PRESETS, loadPreset, drawNow: drawAll,
        selectMode,
        isDev,
        setTargetA: v => { $('target-a').value = String(v); setTargetA(true); },
        set(values) {
            Object.assign(state.rmoe, values);
            if (isCircular()) state.diff = M.coeDifference(state.target, M.coesFromRmoe(state.target, mathRmoe()));
            rebuild(); refit(true); updateInputs(); updateStatic(); fillElTable(); drawAll();
        },
        setOrbits(target, diff) { return commit({ ...target }, { ...ZERO_DIFF, ...diff }, null); }
    };

    // The model settings panel (../assets/orbit-settings-panel.js): redraw on a settings change.
    if (window.OrbitSettingsPanel) window.OrbitSettingsPanel.registerPage({
        // Shown in the settings panel when Cowell is chosen.
        modelNote: "With Cowell, the target and chase move under the chosen forces. The RMOE mode follows the RIC model setting (CW, or the exact difference); the COE mode always subtracts the two propagated orbits.",
        onSettingsChange() {
            rebindMath();
            rebuild();
            refit(true);
            updateInputs();
            updateStatic();
            fillElTable();
            dirty = true;
        }
    });
})();
