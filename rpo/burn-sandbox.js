// RIC Burn Sandbox. Chase starts at rest at the target, on a perch, or on an NMC; each burn adds
// a velocity change in R, I, or C at the current time, and the motion after it is the course
// model (the CW closed form, RpoMath.cwPropagate) from the state just after the burn. The page
// shows the RMOEs just before and after the last burn, the rule of thumb that applies with its
// numbers, four basic burns side by side, and natural against forced motion with real costs
// (RpoMath.transferVelocity).
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = id => document.getElementById(id);
    const Kit = window.ToolKit, M = window.RpoMath, V = window.RpoViews;

    /* ================================================================== */
    /* RELATIVE MOTION MATH                                               */
    /* Course model (CW equations, from rpo-math.js) about a circular     */
    /* target with mean motion n. RIC state [x, y, z, vx, vy, vz] in km   */
    /* and km/s; times in s; angles in degrees.                           */
    /* ================================================================== */

    // Chase's state at t = 0: at rest at the target, on a perch 10 km behind, or on an NMC
    // with C = 5 km starting at the given corner (M0).
    function initialState(start, corner, n) {
        if (start === 'perch') return [0, -10, 0, 0, 0, 0];
        if (start === 'nmc') return M.stateFromRmoe({ xc: 0, yc0: 0, C: 5, M0: corner, zmax: 0, dM0: null }, n, 0);
        return [0, 0, 0, 0, 0, 0];
    }

    // State at time t: the CW coast from the last burn at or before t. Each burn is
    // { t, after } with `after` the state just after it.
    function chaseStateAt(t, start, corner, burns, n) {
        let base = initialState(start, corner, n), tb = 0;
        for (const b of burns) { if (b.t <= t + 1e-9) { base = b.after; tb = b.t; } }
        return M.cwPropagate(base, n, t - tb);
    }

    // Time to coast until the next corner (M = stop) or, for stop = 'pc', the next plane
    // crossing (dM = 0 or 180). null when that angle is undefined. Never less than a sliver.
    function timeToCoastStop(rmoe, stop, n) {
        const P = 2 * Math.PI / n;
        const next = (now, ang) => { let dt = M.timeToAngle(now, ang, n); if (dt < 1e-4 * P) dt += P; return dt; };
        if (stop === 'pc') return rmoe.dM0 === null ? null : Math.min(next(rmoe.dM0, 0), next(rmoe.dM0, 180));
        return rmoe.M0 === null ? null : next(rmoe.M0, Number(stop));
    }

    // Positions along a CW coast from s0 for time T, count + 1 samples, pushed onto out.
    function coastPath(s0, n, T, count, out) {
        for (let k = 0; k <= count; k++) { const s = M.cwPropagate(s0, n, T * k / count); out.push([s[0], s[1], s[2]]); }
        return out;
    }

    // Natural motion: an NMC with C = 5 km, entered from a perch 10 km behind with one
    // radial burn, dV = -(n/2) dy_C.
    function naturalNmc(n) {
        const rmoe = { xc: 0, yc0: 0, C: 5, M0: 270, zmax: 0, dM0: null };
        return {
            path: coastPath(M.stateFromRmoe(rmoe, n, 0), n, 2 * Math.PI / n, 120, []),
            from: [0, -10, 0],
            dv: [M.rule.recenter(n, 10), 0, 0]
        };
    }

    // Forced motion: a circle of the given radius in the R-I plane, flown as `count` CW legs
    // between waypoints, one lap in lapTime. Each burn turns the arrival velocity into the
    // next leg's departure velocity.
    function forcedCircle(n, radius, count, lapTime) {
        const Tc = lapTime / count, pts = [];
        for (let k = 0; k < count; k++) { const f = 2 * Math.PI * k / count; pts.push([-radius * Math.cos(f), radius * Math.sin(f), 0]); }
        const path = [], burns = [];
        let lapDv = 0;
        for (let k = 0; k < count; k++) {
            const prev = pts[(k + count - 1) % count], cur = pts[k], next = pts[(k + 1) % count];
            const vin = M.transferVelocity(prev, cur, n, Tc);
            const arrive = M.cwPropagate([...prev, ...vin], n, Tc);
            const vout = M.transferVelocity(cur, next, n, Tc);
            const dv = [vout[0] - arrive[3], vout[1] - arrive[4], vout[2] - arrive[5]];
            lapDv += Math.hypot(dv[0], dv[1], dv[2]);
            burns.push({ at: cur, dv });
            coastPath([...cur, ...vout], n, Tc, 20, path);
        }
        return { path, burns, lapDv };
    }

    // Forced motion: a teardrop hold at r0, back at r0 after each cycle by one burn there.
    function teardropHold(n, r0, cycle) {
        const v0 = M.transferVelocity(r0, r0, n, cycle);
        const end = M.cwPropagate([...r0, ...v0], n, cycle);
        const dv = [v0[0] - end[3], v0[1] - end[4], v0[2] - end[5]];
        return { path: coastPath([...r0, ...v0], n, cycle, 90, []), dv, cost: Math.hypot(dv[0], dv[1], dv[2]) };
    }

    /* ================================================================== */
    /* RENDERING AND CONTROLS                                             */
    /* ================================================================== */

    /* ---------- Data ---------- */
    const DIRS = {
        '+R': { axis: 0, sign: 1, name: '+R (up)' }, '-R': { axis: 0, sign: -1, name: '−R (down)' },
        '+I': { axis: 1, sign: 1, name: '+I (forward)' }, '-I': { axis: 1, sign: -1, name: '−I (backward)' },
        '+C': { axis: 2, sign: 1, name: '+C (left)' }, '-C': { axis: 2, sign: -1, name: '−C (right)' }
    };
    const NOTICE = {
        none: 'A burn does not send you where it points. Pick a direction, press Burn Now, and watch the view from the left.',
        0: 'A radial burn slides the NMC center forward or backward along the track. It does not change x_C, so it starts no drift: the new path closes on itself.',
        1: 'An in-track burn moves the NMC center up or down, and that starts or stops a drift. Burn forward and chase rises, then falls behind: above the target it drifts backward.',
        2: 'A cross-track burn only changes the side-to-side swing. The view from the left does not change at all; look at the view from behind.'
    };
    const MAX_BURNS = 6;
    const PER_REV = 240;           // path samples per target rev
    const TRAIL_REVS = 2, AHEAD_REVS = 2, WINDOW_AHEAD = 4;
    const COAST_SECONDS = 2.5;     // a coast never takes longer than this on screen
    const FAST = 0.05;             // revs per second, the Fast speed
    const TINY = 1e-9;

    /* ---------- State ---------- */
    const state = {
        orbit: 'geo', start: 'rest', corner: 0, dir: '+R', burns: [],
        t: 0, playing: !Kit.prefersReducedMotion(), speed: 0.02, coastEnd: null, coastSpeed: FAST,
        second: 'behind', frame: 'ECI', mag: 'auto', orbits: true, nmcTrace: true, ghost: true
    };
    let coe, n, P, win = null, dirty = true, fitted = false;

    function setTarget(key) {
        const o = M.ORBITS[key];
        state.orbit = key;
        coe = { a: o.a, e: 0, i: o.i, raan: o.raan, argp: 0, nu: 0 };
        n = M.meanMotion(o.a);
        P = 2 * Math.PI / n;
    }
    setTarget('geo');
    // n × 2 km in m/s to two significant figures: 0.15 at GEO, 0.29 at MEO, 2.2 at LEO.
    const defaultMag = () => Number((n * 2 * 1000).toPrecision(2));

    /* ---------- Stage ---------- */
    let THREE = null;
    try { THREE = await import(THREE_URL); } catch (err) { THREE = null; }
    const view = $('view');
    const stage = V.createDualStage(view, { THREE, second: 'behind', onResize: () => { if (win) { refit(); drawAll(); } } });
    ['left', 'second'].forEach(name => {
        const canvas = view.querySelector('.rpo-' + name + ' canvas');
        V.attachPanZoom(canvas, { plane: () => (name === 'left' ? stage.left : stage.secondPlane() || stage.left), linked: () => stage.visiblePlanes(), onChange: () => { dirty = true; } });
    });

    /* ---------- The motion ---------- */
    function chaseState(t) { return chaseStateAt(t, state.start, state.corner, state.burns, n); }
    function lastBurn() { return state.burns.length ? state.burns[state.burns.length - 1] : null; }

    // The sampled path: from two revs before now to WINDOW_AHEAD revs after, rebuilt when the
    // prediction reaches its end, after every burn, and on every restart.
    function buildWindow() {
        const t0 = Math.max(0, state.t - TRAIL_REVS * P), t1 = state.t + WINDOW_AHEAD * P;
        const count = Math.round(PER_REV * (t1 - t0) / P) + 1;
        const times = new Float64Array(count), path = new Float64Array(3 * count);
        for (let k = 0; k < count; k++) {
            const t = t0 + (t1 - t0) * k / (count - 1);
            times[k] = t;
            const s = chaseState(t);
            path[3 * k] = s[0]; path[3 * k + 1] = s[1]; path[3 * k + 2] = s[2];
        }
        // The old path: where chase would have gone without the last burn, two revs from it.
        let ghost = null;
        const b = lastBurn();
        if (b && b.t + AHEAD_REVS * P > t0) {
            const gc = Math.round(PER_REV * AHEAD_REVS) + 1;
            ghost = new Float64Array(3 * gc);
            for (let k = 0; k < gc; k++) {
                const s = M.cwPropagate(b.before, n, AHEAD_REVS * P * k / (gc - 1));
                ghost[3 * k] = s[0]; ghost[3 * k + 1] = s[1]; ghost[3 * k + 2] = s[2];
            }
        }
        win = { t0, t1, count, times, path, ghost, frame: V.framePath(coe, times, path) };
        if (stage.inertial) { stage.inertial.setOrbit(coe); stage.inertial.setPath(win.frame); }
        updateMagRead();
    }
    const indexAt = t => Math.max(0, Math.min(win.count - 1, Math.round((t - win.t0) / (win.t1 - win.t0) * (win.count - 1))));

    /* ---------- Fitting ---------- */
    // Fit to the whole window (trail and prediction) and the old path. Refit only when those
    // change, or when chase leaves the view, never on every frame.
    function refit() {
        if (!win) return;
        // The trail and the prediction around now, not the whole buffer.
        const k0 = indexAt(state.t - TRAIL_REVS * P), k1 = indexAt(state.t + AHEAD_REVS * P);
        const paths = [win.path.subarray(3 * k0, 3 * (k1 + 1))];
        if (win.ghost && state.ghost) paths.push(win.ghost);
        const visible = stage.visiblePlanes();
        const fit = V.fitPanes(visible.length ? visible : [stage.left], paths, true);
        [stage.left, stage.behind, stage.above].filter(p => visible.indexOf(p) < 0).forEach(p => V.fitPanes([p], paths, true));
        if (stage.box) {
            const bx = fit.box;
            stage.box.setExtent(Math.max.apply(null, [0, 1, 2].map(k => Math.max(Math.abs(bx.min[k]), Math.abs(bx.max[k])))));
        }
        fitted = true;
    }
    function chaseOutside(point) {
        return stage.visiblePlanes().some(p => {
            const [w, h] = p.size();
            const q = p.toPx(point[p.axes[0]], point[p.axes[1]]);
            return q[0] < 4 || q[0] > w - 4 || q[1] < 4 || q[1] > h - 4;
        });
    }

    /* ---------- Drawing ---------- */
    function drawAll() {
        if (!win) return;
        const t = state.t;
        if (t + AHEAD_REVS * P > win.t1 + 1e-6) { buildWindow(); refit(); }
        const now = chaseState(t);
        // While playing, a chase that drifts out of view brings the views back to it.
        if (state.playing && chaseOutside(now)) refit();
        const k = indexAt(t);
        const kTrail = indexAt(t - TRAIL_REVS * P), kAhead = indexAt(t + AHEAD_REVS * P);
        const trail = win.path.subarray(3 * kTrail, 3 * (k + 1));
        const predicted = win.path.subarray(3 * k, 3 * (kAhead + 1));
        const rNow = M.rmoeFromState(now, n);
        const nmcLoop = state.nmcTrace && rNow.C > 1e-6 ? M.nmcLoop(rNow) : null;
        const inWindow = state.burns.filter(b => b.t >= win.t0 - 1e-9 && b.t <= t + 1e-9);
        const ghosts = win.ghost && state.ghost ? [win.ghost] : [];
        const data = {
            chase: now, trail, predicted, ghosts, nmcLoop, rmoe: rNow,
            burns: inWindow.map(b => ({ at: b.after, dv: b.dv }))
        };
        stage.visiblePlanes().forEach(p => p.draw(data));
        const basis = M.ricBasis(coe, t);
        if (stage.box && stage.second() === 'box') {
            const chaseRv = M.chaseRvFromRic(now, basis);
            stage.box.update({ chase: now, trail, nmcLoop, ghost: win.path, basis, rT: basis.r, t, targetCoe: coe, chaseRv });
        }
        if (stage.inertial) {
            stage.inertial.update({
                t, rho: now, basis, rT: basis.r, from: kTrail, to: k, ghost: true,
                burns: inWindow.map(b => ({ t: b.t, rho: b.after, dv: b.dv, basis: M.ricBasis(coe, b.t) }))
            });
        }
        updateLive(now, rNow);
    }

    /* ---------- Formatting ---------- */
    const fmt = (v, d) => {
        const s = Math.abs(v) < 0.5 * Math.pow(10, -d) ? (0).toFixed(d) : v.toFixed(d);
        return s.replace(/^-/, '−');
    };
    const fmtNum = (v, d) => String(Number(v.toFixed(d)));
    const angle = v => (v === null ? 'undefined' : fmt(v, 1) + '°');
    function timeText(t) {
        const s = Math.round(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        return (t / P).toFixed(2) + ' rev · ' + (h ? h + ' h ' + String(m).padStart(2, '0') + ' min' : m + ' min');
    }
    const tex = s => (window.katex ? window.katex.renderToString(s, { throwOnError: false }) : '<code class="tex-source">' + s.replace(/</g, '&lt;') + '</code>');
    const tnum = (v, d) => { const s = (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d); return s.startsWith('-') ? '(' + s + ')' : s; };
    const tres = (v, d) => (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
    const tsci = v => { const [m, e] = v.toExponential(4).split('e'); return m + '\\times10^{' + Number(e) + '}'; };

    /* ---------- Panels ---------- */
    function updateLive(now, rNow) {
        $('time-read').textContent = timeText(state.t);
        $('motion').textContent = 'Now: ' + M.classifyMotion(rNow).label;
        // Coast To: a corner needs an NMC (C > 0); a plane crossing needs cross-track motion.
        const hasC = rNow.M0 !== null, hasZ = rNow.dM0 !== null;
        $('coast').querySelectorAll('button').forEach(b => { b.disabled = b.dataset.value === 'pc' ? !hasZ : !hasC; });
    }

    function updateBurnPanel() {
        const list = $('burn-list');
        list.innerHTML = state.burns.map((b, j) => {
            const d = DIRS[b.dir];
            return '<li>' + (j + 1) + '. ' + d.name + ' ' + fmtNum(b.mag, 4) + ' m/s <span class="muted">at ' + (b.t / P).toFixed(3) + ' rev</span></li>';
        }).join('');
        const total = state.burns.reduce((s, b) => s + b.mag, 0);
        $('burn-total').textContent = state.burns.length ? 'Total ΔV ' + fmtNum(total, 4) + ' m/s in ' + state.burns.length + (state.burns.length === 1 ? ' burn' : ' burns') + '.' : '';
        $('undo').disabled = !state.burns.length;
        $('burn-now').disabled = state.burns.length >= MAX_BURNS;
        $('burn-msg').textContent = state.burns.length >= MAX_BURNS ? 'Six burns is the most in one chain. Undo a burn or Restart.' : '';
        const b = lastBurn();
        const noticeEl = $('notice');
        if (noticeEl) noticeEl.textContent = b ? NOTICE[DIRS[b.dir].axis] : NOTICE.none;
        updateBeforeAfter();
    }

    // The RMOEs just before and just after the last burn, then the rule of thumb with numbers.
    function updateBeforeAfter() {
        const b = lastBurn();
        if (!b) { $('ba-body').innerHTML = '<p class="ba-empty">Burn to see the RMOEs just before and just after it.</p>'; return; }
        const r0 = M.rmoeFromState(b.before, n), r1 = M.rmoeFromState(b.after, n);
        const d0 = M.driftRate(r0, n, coe.a).kmPerRev, d1 = M.driftRate(r1, n, coe.a).kmPerRev;
        const rows = [
            ['x<sub>C</sub> km', r0.xc, r1.xc, 'km'], ['y<sub>C</sub> km', r0.yc0, r1.yc0, 'km'], ['C km', r0.C, r1.C, 'km'],
            ['M', r0.M0, r1.M0, 'deg'], ['z<sub>max</sub> km', r0.zmax, r1.zmax, 'km'], ['ΔM', r0.dM0, r1.dM0, 'deg'],
            ['Drift km/rev', d0, d1, 'km']
        ];
        const body = rows.map(([name, a, c, kind]) => {
            let change, changed;
            if (kind === 'deg') {
                if (a === null && c === null) { change = '—'; changed = false; }
                else if (a === null || c === null) { change = c === null ? 'now undefined' : 'now defined'; changed = true; }
                else { const dd = M.wrap180(c - a); change = (dd > 0 ? '+' : '') + fmt(dd, 1) + '°'; changed = Math.abs(dd) > 0.05; }
                return `<tr class="${changed ? 'hl' : ''}"><td>${name}</td><td>${angle(a)}</td><td>${angle(c)}</td><td class="${changed ? 'changed' : ''}">${change}</td></tr>`;
            }
            const dd = c - a;
            changed = Math.abs(dd) > 5e-4;
            change = changed ? (dd > 0 ? '+' : '') + fmt(dd, 3) : '0';
            return `<tr class="${changed ? 'hl' : ''}"><td>${name}</td><td>${fmt(a, 3)}</td><td>${fmt(c, 3)}</td><td class="${changed ? 'changed' : ''}">${change}</td></tr>`;
        }).join('');
        $('ba-body').innerHTML =
            '<div class="table-wrap"><table class="rpo-table"><tr><th>RMOE</th><th>Before</th><th>After</th><th>Change</th></tr>' + body + '</table></div>' +
            '<p class="rule-note">y<sub>C</sub>, M, and ΔM are at the instant of the burn, ' + (b.t / P).toFixed(3) + ' rev.</p>' +
            '<div class="rule-box">' + ruleHtml(b, r0, r1) + '</div>';
    }

    function ruleHtml(b, r0, r1) {
        const axis = DIRS[b.dir].axis;
        const dvMs = b.dv[axis] * 1000;
        const nT = tsci(n);
        const dvT = tnum(dvMs, 4) + '/1000';
        const eq = s => '<div class="rule-eq">' + tex(s) + '</div>';
        const note = s => '<p class="rule-note">' + s + '</p>';
        const out = [];
        if (axis === 0) {
            out.push(eq(`\\Delta V_x = -\\tfrac{n}{2}\\,\\Delta y_C \\;\\Rightarrow\\; \\Delta y_C = -\\frac{2\\,\\Delta V_x}{n} = -\\frac{2\\,${dvT}}{${nT}} = ${tres(-2 * b.dv[0] / n, 3)}\\ \\text{km}`));
            out.push(note('The center slides along the track; x<sub>C</sub> and the drift do not change.'));
            // At the front or back (x = x_C), the same burn changes C by the least ΔV.
            const atSide = r0.C > 1e-6 && Math.abs(b.before[0] - r0.xc) < 0.02 * r0.C;
            if (atSide) {
                const sx = b.before[3] < 0 ? -1 : 1;
                out.push(eq(`\\Delta V_x = \\operatorname{sign}(\\dot x)\\, n\\, \\Delta C \\;\\Rightarrow\\; \\Delta C = \\frac{${sx < 0 ? '-' : ''}${dvT}}{${nT}} = ${tres(sx * b.dv[0] / n, 3)}\\ \\text{km}`));
                out.push(note('Chase was at the ' + (sx > 0 ? 'front' : 'back') + ' of the NMC (x = x<sub>C</sub>), where a radial burn changes C the most for its size.'));
            }
        } else if (axis === 1) {
            const dxc = 2 * b.dv[1] / n;
            out.push(eq(`\\Delta V_y = \\tfrac{n}{2}\\,\\Delta x_C \\;\\Rightarrow\\; \\Delta x_C = \\frac{2\\,\\Delta V_y}{n} = \\frac{2\\,${dvT}}{${nT}} = ${tres(dxc, 3)}\\ \\text{km}`));
            out.push(eq(`\\Delta \\dot y_C = -3\\pi\\,\\Delta x_C = -3\\pi\\,${tnum(dxc, 3)} = ${tres(-3 * Math.PI * dxc, 3)}\\ \\text{km/rev}`));
            out.push(note(dxc > 0 ? 'The center moves up, so chase now drifts backward (or more slowly forward).' : 'The center moves down, so chase now drifts forward (or more slowly backward).'));
        } else {
            const z = b.before[2], zd0 = b.before[5], zd1 = b.after[5];
            const atCrossing = Math.abs(z) < 1e-3 * Math.max(r0.zmax, 1e-3) || r0.zmax < 1e-6;
            if (atCrossing && r0.zmax > 1e-6) {
                const s = zd0 < 0 ? -1 : 1;
                out.push(eq(`\\Delta V_z = \\operatorname{sign}(\\dot z)\\, n\\, \\Delta z_{max} \\;\\Rightarrow\\; \\Delta z_{max} = \\frac{${s < 0 ? '-' : ''}${dvT}}{${nT}} = ${tres(s * b.dv[2] / n, 3)}\\ \\text{km}`));
                out.push(note('Chase was at a plane crossing (z = 0), where a cross-track burn changes z<sub>max</sub> the most for its size.'));
            } else if (atCrossing) {
                out.push(eq(`z_{max} = \\frac{|\\Delta V_z|}{n} = \\frac{${tnum(Math.abs(dvMs), 4)}/1000}{${nT}} = ${tres(r1.zmax, 3)}\\ \\text{km}`));
                out.push(note('From no cross-track motion, the burn point becomes a plane crossing: ΔM = ' + (b.dv[2] > 0 ? '0° (moving left)' : '180° (moving right)') + '.'));
            } else {
                out.push(eq(`z_{max} = \\sqrt{z^2 + (\\dot z / n)^2} = \\sqrt{${tnum(z, 3)}^2 + \\left(\\frac{${tnum(zd1 * 1000, 4)}/1000}{${nT}}\\right)^2} = ${tres(r1.zmax, 3)}\\ \\text{km}`));
                out.push(note('Away from a plane crossing, part of the burn is spent where it does least. Coast to a plane crossing to change z<sub>max</sub> for the least ΔV.'));
            }
            out.push(note('The in-plane RMOEs (x<sub>C</sub>, y<sub>C</sub>, C, M) do not change.'));
        }
        return out.join('');
    }

    /* ---------- Actions ---------- */
    function readMag() {
        const el = $('dv-mag'), v = Number(el.value);
        const ok = el.value.trim() !== '' && Number.isFinite(v) && v > 0;
        el.classList.toggle('bad', !ok);
        return ok ? v : null;
    }
    function burnNow(dirKey, magMs) {
        if (state.burns.length >= MAX_BURNS) return false;
        const d = DIRS[dirKey];
        const mag = magMs === undefined ? readMag() : magMs;
        if (!d || !mag) return false;
        state.coastEnd = null;
        const before = chaseState(state.t);
        const dv = [0, 0, 0];
        dv[d.axis] = d.sign * mag / 1000;
        const after = M.applyBurn(before, dv);
        state.burns.push({ t: state.t, dir: dirKey, mag, dv, before, after });
        restartWindow();
        updateBurnPanel();
        return true;
    }
    function restartWindow() {
        buildWindow();
        refit();
        dirty = true;
    }
    function undo() {
        const b = state.burns.pop();
        if (!b) return;
        state.t = b.t;
        state.coastEnd = null;
        setPlaying(false);
        restartWindow();
        updateBurnPanel();
    }
    function restart() {
        state.burns = [];
        state.t = 0;
        state.coastEnd = null;
        restartWindow();
        updateBurnPanel();
    }
    // Coast to the next corner (M = 0, 90, 180, 270) or the next plane crossing (ΔM = 0 or 180).
    function coast(value) {
        const dt = timeToCoastStop(M.rmoeFromState(chaseState(state.t), n), value, n);
        if (dt === null) return;
        state.coastEnd = state.t + dt;
        state.coastSpeed = Math.max(FAST, dt / P / COAST_SECONDS);
        setPlaying(true);
    }

    /* ---------- Controls ---------- */
    function setPlaying(on) { state.playing = on; $('play').textContent = on ? 'Pause' : 'Play'; }
    $('play').addEventListener('click', () => { state.coastEnd = null; setPlaying(!state.playing); });
    Kit.bindSegmented($('speed'), v => { state.speed = Number(v); });
    $('fit-views').addEventListener('click', () => { refit(); dirty = true; });
    $('coast').addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) coast(b.dataset.value); });
    $('coast').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));

    Kit.bindSegmented($('start-pick'), v => { state.start = v; $('corner-row').hidden = v !== 'nmc'; restart(); });
    Kit.bindSegmented($('corner-pick'), v => { state.corner = Number(v); restart(); });
    $('dir-pick').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        state.dir = b.dataset.value;
        $('dir-pick').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    $('burn-now').addEventListener('click', () => burnNow(state.dir));
    $('dv-mag').addEventListener('input', () => { if (readMag()) drawCompare(); });
    $('undo').addEventListener('click', undo);
    $('restart').addEventListener('click', restart);
    function setMagDefault() {
        const m = defaultMag();
        $('dv-mag').value = String(m);
        $('dv-mag').step = String(Number((m / 3).toPrecision(2)));
        $('dv-mag').classList.remove('bad');
    }

    Kit.bindSegmented($('target-pick'), key => {
        setTarget(key);
        if (key !== 'geo' && state.frame === 'ECEF') { state.frame = 'ECI'; selectFrame('ECI'); }
        $('frame-pick').querySelector('[data-value="ECEF"]').disabled = key !== 'geo';
        setMagDefault();
        if (stage.inertial) stage.inertial.resetView();
        restart();
        applyViewOptions();
        drawCompare();
    });
    Kit.bindSegmented($('second-pick'), v => {
        state.second = v;
        stage.setSecond(v);
        refit();
        dirty = true;
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
        inertial.setCamera('earth');
        inertial.setTrails({ inertial: true, carried: true });
        inertial.setExtras({ axes: false, equator: false, orbits: state.orbits });
        inertial.setLabels(true);
        updateMagRead();
    }
    $('mag').addEventListener('input', e => { state.mag = magFromSlider(Number(e.target.value) / 1000); applyViewOptions(); dirty = true; });
    const selectFrame = Kit.bindSegmented($('frame-pick'), v => {
        state.frame = v === 'ECEF' && state.orbit === 'geo' ? 'ECEF' : 'ECI';
        if (state.frame !== v) selectFrame(state.frame);
        applyViewOptions();
        dirty = true;
    });
    $('opt-orbits').addEventListener('change', e => { state.orbits = e.target.checked; applyViewOptions(); dirty = true; });
    $('opt-nmc').addEventListener('change', e => { state.nmcTrace = e.target.checked; dirty = true; });
    $('opt-ghost').addEventListener('change', e => { state.ghost = e.target.checked; refit(); dirty = true; });

    /* ---------- Compare: the four basic burns from rest ---------- */
    function drawCompare() {
        const typed = Number($('dv-mag').value);
        const mag = typed > 0 && Number.isFinite(typed) ? typed : defaultMag();
        const canvases = [...$('compare').querySelectorAll('canvas')];
        const specs = canvases.map(c => {
            const d = DIRS[c.dataset.dir];
            const s = [0, 0, 0, 0, 0, 0];
            s[3 + d.axis] = d.sign * mag / 1000;
            const rmoe = M.rmoeFromState(s, n);
            return { canvas: c, rmoe, path: M.sampleTrajectory(rmoe, n, 0, 2 * P, 240) };
        });
        // Let each canvas take its grid cell's size again before it is measured.
        canvases.forEach(c => { c.style.width = ''; c.style.height = ''; });
        // The radial pair share one scale and the in-track pair another: the in-track burns drift
        // several times farther in two revs, which would shrink the radial ellipses to dots.
        const pair = d => specs.filter(s => s.canvas.dataset.dir[1] === d).map(s => s.path);
        specs.forEach(s => V.drawThumbnail(s.canvas, { path: s.path, plane: 'left', compact: true, fitPaths: pair(s.canvas.dataset.dir[1]) }));
    }
    Kit.observeSize($('compare'), () => drawCompare());

    /* ---------- Natural vs. forced motion, at GEO ---------- */
    const geoN = M.meanMotion(M.GEO_A), geoP = M.period(M.GEO_A);
    function buildForced() {
        const nmc = naturalNmc(geoN);
        const nmcPath = nmc.path, nmcDv = nmc.dv[0];
        // A circle of radius 5 km, eight burns, one lap per half rev, clockwise in the view
        // from the left (bottom, front, top, back).
        const circle = forcedCircle(geoN, 5, 8, 0.5 * geoP);
        const circlePath = circle.path, circleBurns = circle.burns, lap = circle.lapDv;
        // A teardrop hold 2 km below the target, back at the same point every quarter rev.
        const Tt = geoP / 4, r0 = [-2, 0, 0];
        const tear = teardropHold(geoN, r0, Tt);
        const tearPath = tear.path, tearDv = tear.dv, tearCost = tear.cost;
        const ms = v => fmtNum(v * 1000, 4) + ' m/s';
        $('nf-nmc-text').innerHTML = '<b>Natural: an NMC</b> with C = 5 km. One radial burn of <span class="cost">' + ms(Math.abs(nmcDv)) + '</span> from a perch 10 km behind, then it repeats every rev for free. Natural motion is slow, cheap, and predictable.';
        $('nf-circle-text').innerHTML = '<b>Forced: a circle</b> of radius 5 km, one lap per half rev, eight burns per lap: <span class="cost">' + ms(lap) + '</span> per lap, ' + ms(2 * lap) + ' per rev. Forced motion is fast and flexible, but it pays for every lap.';
        $('nf-tear-text').innerHTML = '<b>Forced: a teardrop</b> hold 2 km below the target, back at the same point every quarter rev: <span class="cost">' + ms(tearCost) + '</span> per cycle, ' + ms(4 * tearCost) + ' per rev. Holding still off the in-track axis costs ΔV every cycle.';
        return [
            { canvas: $('nf-nmc'), path: nmcPath, cycle: geoP, burns: [{ at: [0, -10, 0], dv: [nmcDv, 0, 0] }] },
            { canvas: $('nf-circle'), path: circlePath, cycle: 0.5 * geoP, burns: circleBurns },
            { canvas: $('nf-tear'), path: tearPath, cycle: Tt, burns: [{ at: r0, dv: tearDv }] }
        ].map(f => Object.assign(f, { pane: V.createRicPlane(f.canvas, { plane: 'left', compact: true }), fit: false }));
    }
    let forcedClock = 0;
    const forced = buildForced();
    forced.forEach(f => Kit.observeSize(f.canvas.parentElement, (w, h) => { f.pane.resize(w, h); V.fitPanes([f.pane], [f.path.concat(f.burns.map(b => b.at))], true); f.fit = true; drawForced(f); }));
    function drawForced(f) {
        if (!f.fit) return;
        const frac = ((forcedClock * 0.1 * geoP) % f.cycle) / f.cycle;
        const k = Math.min(f.path.length - 1, Math.round(frac * (f.path.length - 1)));
        f.pane.draw({ ghosts: [f.path], trail: f.path.slice(0, k + 1), chase: f.path[k], burns: f.burns });
    }

    /* ---------- Start ---------- */
    setMagDefault();
    applyViewOptions();
    $('frame-pick').querySelector('[data-value="ECEF"]').disabled = false;
    setPlaying(state.playing);
    restart();
    drawCompare();

    const animateForced = !Kit.prefersReducedMotion();
    Kit.startLoop(seconds => {
        if (animateForced) { forcedClock += seconds; forced.forEach(drawForced); }
        if (state.playing && win) {
            const speed = state.coastEnd !== null ? state.coastSpeed : state.speed;
            state.t += seconds * speed * P;
            if (state.coastEnd !== null && state.t >= state.coastEnd) { state.t = state.coastEnd; state.coastEnd = null; setPlaying(false); }
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        drawAll();
    });

    // For checks in the browser console.
    window.burnSandbox = {
        state, chaseState, burn: burnNow, coast, undo, restart, drawNow: drawAll,
        n: () => n, P: () => P,
        rmoeNow: () => M.rmoeFromState(chaseState(state.t), n),
        setTime(t) { state.t = t; state.coastEnd = null; setPlaying(false); restartWindow(); },
        forced
    };
})();
