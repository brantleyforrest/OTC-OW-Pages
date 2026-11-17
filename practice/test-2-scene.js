// Test 2 Practice: the view beside each problem. Two kinds of drawing share one view box.
//  - The dual stage from RpoViews (the view from the left, a second RIC view, and the inertial
//    view) for problems whose model holds a target and a chase (model.kind 'motion').
//  - A flat 2D canvas, with no 3D library, for the RIC Axes pictures (model.kind 'axes').
// API: create({ container, THREE }) -> { setProblem(source), setStage(key), setAnswersShown(bool),
// resize() }. THREE may be null; the RIC panes and the flat drawing still work without it.
(function (global) {
    'use strict';

    const M = global.RpoMath;
    const V = global.RpoViews;
    const Kit = global.ToolKit;
    const PLAY_SECONDS_PER_REV = 5;
    const POINTS_PER_REV = 240;

    function create(options) {
        const container = options.container;
        const dualHost = document.createElement('div');
        dualHost.className = 't2-host';
        const flatHost = document.createElement('div');
        flatHost.className = 't2-host t2-flat';
        const flatCanvas = document.createElement('canvas');
        flatHost.appendChild(flatCanvas);
        container.append(dualHost, flatHost);

        let stage = null;
        let problem = null, kind = null, stageKey = 'given', answersShown = false;
        let sim = null, t = 0, playing = false;
        let flatSize = [1, 1];

        /* ---------- motion: the dual stage ---------- */
        function ensureStage() {
            if (stage) return stage;
            stage = V.createDualStage(dualHost, {
                THREE: options.THREE, second: 'behind',
                onResize: () => { if (sim) { refit(); draw(); } }
            });
            return stage;
        }

        function buildMotion(model) {
            const n = model.n, revs = model.revs || 2;
            const spanT = revs * 2 * Math.PI / n;
            const count = Math.round(POINTS_PER_REV * revs) + 1;
            const times = new Float64Array(count);
            for (let k = 0; k < count; k++) times[k] = spanT * k / (count - 1);
            const course = M.sampleTrajectory(model.rmoe, n, 0, spanT, count);
            const exact = M.sampleRelative(model.target, model.chase, 0, spanT, count);
            sim = { model, n, spanT, count, course, exact };
            if (stage.inertial) {
                stage.inertial.setOrbit(model.target);
                stage.inertial.setChaseOrbit(model.chase);
                stage.inertial.setPath(V.framePath(model.target, times, exact));
            }
            t = 0;
            refit();
        }

        function refit() {
            if (!sim || !stage) return;
            const planes = [stage.left, stage.secondPlane()].filter(Boolean);
            // Share one scale among the panes on screen only: a pane hidden by the small-stage
            // switch has no size, and its scale would zoom the visible pane far out.
            const visible = stage.visiblePlanes().filter(p => planes.indexOf(p) >= 0);
            V.fitPanes(visible.length ? visible : planes, [sim.course], true);
            planes.filter(p => visible.indexOf(p) < 0).forEach(p => V.fitPanes([p], [sim.course], true));
        }

        // The motion is shown once the walkthrough reaches the answer, or once answers are graded.
        const motionShown = () => stageKey === 'answer' || answersShown;

        function draw() {
            if (!sim || !stage) return;
            const shown = motionShown();
            const tt = shown ? t : 0;
            const k = Math.max(0, Math.min(sim.count - 1, Math.round(tt / sim.spanT * (sim.count - 1))));
            const now = M.stateFromRmoe(sim.model.rmoe, sim.n, tt);
            const data = shown
                ? { chase: now, trail: sim.course.subarray(0, 3 * (k + 1)), ghosts: [sim.course], rmoe: stageKey === 'answer' ? M.rmoeAt(sim.model.rmoe, sim.n, tt) : null }
                : {};
            stage.left.draw(data);
            const second = stage.secondPlane();
            if (second) second.draw(data);
            if (stage.inertial) {
                const rel = M.relativeState(sim.model.target, sim.model.chase, tt);
                stage.inertial.update({ t: tt, rho: rel.rho, basis: rel.basis, rT: rel.rT, from: 0, to: shown ? k : 0 });
            }
        }

        /* ---------- axes: the flat drawing ---------- */
        const AXIS_COLOR = { R: '#f87171', I: '#f87171', C: '#f87171' };
        const AXIS_VEC = u => ({
            R: [Math.cos(u), Math.sin(u), 0],
            I: [-Math.sin(u), Math.cos(u), 0],
            C: [0, 0, 1]
        });
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        function cameraFor(view, u) {
            const ax = AXIS_VEC(u);
            const neg = v => v.map(x => -x);
            const unit = v => { const m = Math.hypot(v[0], v[1], v[2]); return v.map(x => x / m); };
            const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            // right, up, and toward (from the scene to the viewer); right x up = toward.
            if (view === 'left') return { right: neg(ax.I), up: ax.R, toward: ax.C, center: 'target' };
            if (view === 'behind') return { right: neg(ax.C), up: ax.R, toward: neg(ax.I), center: 'target' };
            if (view === 'above') return { right: neg(ax.C), up: ax.I, toward: ax.R, center: 'target' };
            if (view === 'north') return { right: [1, 0, 0], up: [0, 1, 0], toward: [0, 0, 1], center: 'earth' };
            // Oblique: from above the orbit plane, behind and to the left of the target.
            const toward = unit([0.55 * ax.R[0] - 0.6 * ax.I[0], 0.55 * ax.R[1] - 0.6 * ax.I[1], 0.75]);
            const right = unit(cross([0, 0, 1], toward).map((x, i) => x || 0));
            const r2 = Math.hypot(right[0], right[1], right[2]) > 1e-6 ? right : [1, 0, 0];
            const up = cross(toward, r2);
            return { right: r2, up, toward, center: 'mid' };
        }

        function arrowHead(ctx, x0, y0, x1, y1, size) {
            const a = Math.atan2(y1 - y0, x1 - x0);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - size * Math.cos(a - 0.45), y1 - size * Math.sin(a - 0.45));
            ctx.lineTo(x1 - size * Math.cos(a + 0.45), y1 - size * Math.sin(a + 0.45));
            ctx.closePath();
            ctx.fill();
        }

        function drawFlat() {
            const canvas = flatCanvas, [w, h] = flatSize;
            const dpr = global.devicePixelRatio || 1;
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
            canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            if (!problem || kind !== 'axes') return;
            const m = problem.model;
            const u = m.u * Math.PI / 180;
            const cam = cameraFor(m.view, u);
            const ax = AXIS_VEC(u);
            const target = [Math.cos(u), Math.sin(u), 0];
            const earthR = 0.32;
            const centerPt = cam.center === 'earth' ? [0, 0, 0] : cam.center === 'mid' ? target.map(x => x * 0.55) : target.map(x => x * 0.55);
            const span = cam.center === 'earth' ? 1.35 : 0.95;
            const scale = Math.min(w, h) / 2 / span;
            const P = p => {
                const d = [p[0] - centerPt[0], p[1] - centerPt[1], p[2] - centerPt[2]];
                return [w / 2 + dot(d, cam.right) * scale, h / 2 - dot(d, cam.up) * scale];
            };
            const depth = p => dot(p, cam.toward);
            // The orbit: points in front of Earth's center solid, behind it faint.
            const orbitPt = k => [Math.cos(k), Math.sin(k), 0];
            const drawOrbit = front => {
                ctx.strokeStyle = front ? 'rgba(52, 211, 153, 0.85)' : 'rgba(52, 211, 153, 0.3)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                let open = false;
                for (let k = 0; k <= 360; k++) {
                    const p = orbitPt(k * Math.PI / 180);
                    const inFront = depth(p) >= -1e-9;
                    if (inFront === front) {
                        const q = P(p);
                        if (open) ctx.lineTo(q[0], q[1]); else { ctx.moveTo(q[0], q[1]); open = true; }
                    } else open = false;
                }
                ctx.stroke();
            };
            drawOrbit(false);
            // Earth: a disc, with its outline.
            const e = P([0, 0, 0]);
            const grad = ctx.createRadialGradient(e[0] - earthR * scale * 0.3, e[1] - earthR * scale * 0.3, earthR * scale * 0.1, e[0], e[1], earthR * scale);
            grad.addColorStop(0, '#2f6fb3'); grad.addColorStop(1, '#123a66');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(e[0], e[1], earthR * scale, 0, 2 * Math.PI); ctx.fill();
            ctx.strokeStyle = 'rgba(147, 197, 253, 0.5)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = 'rgba(207, 220, 236, 0.85)';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('Earth', e[0], e[1]);
            drawOrbit(true);
            // Direction of travel: an arrowhead on the orbit a little ahead of the target.
            const ahead = orbitPt(u + 0.35), ahead2 = orbitPt(u + 0.42);
            const qa = P(ahead), qb = P(ahead2);
            if (Math.hypot(qb[0] - qa[0], qb[1] - qa[1]) > 2) {
                ctx.fillStyle = 'rgba(52, 211, 153, 0.95)';
                arrowHead(ctx, qa[0], qa[1], qb[0], qb[1], 10);
            }
            // The target, a green square.
            const q = P(target);
            ctx.fillStyle = '#34d399';
            ctx.fillRect(q[0] - 6, q[1] - 6, 12, 12);
            // The three numbered arrows.
            const len = 0.42 * scale;
            ctx.font = '600 14px Inter, sans-serif';
            m.arrows.forEach((axis, idx) => {
                const v = ax[axis];
                const sx = dot(v, cam.right), sy = dot(v, cam.up), toward = dot(v, cam.toward);
                const reveal = answersShown || stageKey === axis;
                ctx.strokeStyle = reveal ? AXIS_COLOR[axis] : '#f0f4fa';
                ctx.fillStyle = ctx.strokeStyle;
                ctx.lineWidth = 2.2;
                let lx, ly;
                if (Math.hypot(sx, sy) < 0.25) {
                    // Along the line of sight: a dot in a circle points at the viewer, a cross away.
                    const off = [[-1, 0.9], [1, 0.9], [0, -1.2]][idx];
                    const cx = q[0] + off[0] * 30, cy = q[1] + off[1] * 30;
                    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 2 * Math.PI); ctx.stroke();
                    if (toward > 0) { ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, 2 * Math.PI); ctx.fill(); }
                    else {
                        ctx.beginPath(); ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6);
                        ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6); ctx.stroke();
                    }
                    lx = cx + 16; ly = cy - 12;
                } else {
                    const x1 = q[0] + sx * len, y1 = q[1] - sy * len;
                    ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(x1, y1); ctx.stroke();
                    arrowHead(ctx, q[0], q[1], x1, y1, 11);
                    const n = Math.hypot(sx, sy);
                    lx = x1 + sx / n * 14; ly = y1 - sy / n * 14;
                }
                const text = String(idx + 1) + (reveal ? ' = ' + axis : '');
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const tw = ctx.measureText(text).width + 8;
                ctx.fillStyle = 'rgba(6, 11, 20, 0.8)';
                ctx.fillRect(lx - tw / 2, ly - 10, tw, 20);
                ctx.fillStyle = reveal ? AXIS_COLOR[axis] : '#ffffff';
                ctx.fillText(text, lx, ly);
            });
            // The name of the view, top left.
            ctx.font = '600 12px Inter, sans-serif';
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            ctx.fillStyle = 'rgba(207, 220, 236, 0.9)';
            ctx.fillText(m.viewName, 10, 10);
        }

        /* ---------- shared ---------- */
        function show(which) {
            dualHost.style.display = which === 'motion' ? '' : 'none';
            flatHost.style.display = which === 'axes' ? '' : 'none';
        }
        Kit.observeSize(flatHost, (w, h) => { flatSize = [w, h]; drawFlat(); });

        // Playback: only while the motion is shown, looping over the revs in the model.
        Kit.startLoop(dt => {
            if (kind !== 'motion' || !sim || !motionShown()) return;
            if (Kit.prefersReducedMotion()) {
                if (t !== sim.spanT) { t = sim.spanT; draw(); }
                return;
            }
            const revs = sim.model.revs || 2;
            t += dt * sim.spanT / (PLAY_SECONDS_PER_REV * revs);
            if (t > sim.spanT) t = 0;
            draw();
        });

        return {
            setProblem(source) {
                problem = source;
                kind = source && source.model ? source.model.kind : null;
                answersShown = false;
                stageKey = 'given';
                show(kind);
                if (kind === 'motion') { ensureStage(); buildMotion(source.model); draw(); }
                if (kind === 'axes') drawFlat();
            },
            setStage(key) {
                stageKey = key || 'given';
                if (kind === 'motion') { if (!motionShown()) t = 0; draw(); }
                if (kind === 'axes') drawFlat();
            },
            setAnswersShown(value) {
                answersShown = Boolean(value);
                if (kind === 'motion') draw();
                if (kind === 'axes') drawFlat();
            },
            resize() {
                if (kind === 'motion') { refit(); draw(); }
                if (kind === 'axes') drawFlat();
            }
        };
    }

    global.Test2Scene = { create };
})(window);
