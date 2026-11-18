/* Drawing shared by the RIC tools and Test 2 Practice. It never owns time or state:
 * the page works out the motion and passes it in.
 *
 * Contents: the three flat RIC views (createRicPlane), the rule that fits several views to
 * one scale (fitPanes), small static plots (drawThumbnail), the 3D RIC box (createRicBox),
 * the inertial pane (createInertialView, with framePath to feed it), and the two stages
 * that arrange them (createFiveViewStage for Tool 1, createDualStage for the others).
 *
 * The three views, fixed everywhere (RIC state is x = R up, y = I forward, z = C left):
 *   from the left    screen up +R, screen left +I    px = cx - y s,  py = cy - x s
 *   from behind      screen up +R, screen left +C    px = cx - z s,  py = cy - x s
 *   from above       screen up +I, screen left +C    px = cx - z s,  py = cy - y s
 * Each is a real viewpoint, not a mirror image. Do not flip an axis to "fix" a picture.
 */
(function () {
    'use strict';

    const COLORS = {
        chase: '#e0b64f',
        target: '#34d399',
        ric: '#f87171',
        grid: 'rgba(148, 163, 184, 0.14)',
        axis: 'rgba(148, 163, 184, 0.45)',
        text: '#94a3b8',
        ghost: 'rgba(224, 182, 79, 0.28)',
        model: 'rgba(240, 244, 250, 0.6)',
        nmc: 'rgba(224, 182, 79, 0.8)',
        keepOut: 'rgba(248, 113, 113, 0.7)'
    };

    // For each view: which state index runs across (h, positive to the LEFT) and which runs up (v).
    const PLANES = {
        left: { h: 1, v: 0, badge: 'RIC · from the left', hLabel: '+I', vLabel: '+R' },
        behind: { h: 2, v: 0, badge: 'RIC · from behind', hLabel: '+C', vLabel: '+R' },
        above: { h: 2, v: 1, badge: 'RIC · from above', hLabel: '+C', vLabel: '+I' }
    };

    // A path is a Float64Array of x, y, z triples, or an array of [x, y, z].
    function pathLength(path) {
        if (!path) return 0;
        return ArrayBuffer.isView(path) ? Math.floor(path.length / 3) : path.length;
    }
    function pathPoint(path, k, out) {
        if (ArrayBuffer.isView(path)) {
            out[0] = path[3 * k]; out[1] = path[3 * k + 1]; out[2] = path[3 * k + 2];
        } else {
            out[0] = path[k][0]; out[1] = path[k][1]; out[2] = path[k][2];
        }
        return out;
    }

    // Grid step from the 1-2-5 series that gives 4 to 8 lines across a span.
    function gridStep(spanKm) {
        const raw = spanKm / 6;
        const pow = Math.pow(10, Math.floor(Math.log10(raw)));
        const m = raw / pow;
        return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
    }
    // The smallest value of the 1-2-5 series that is at least x.
    function niceAtLeast(x) {
        const pow = Math.pow(10, Math.floor(Math.log10(x)));
        const m = x / pow;
        return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
    }
    // A distance in km as people read it: 0.5, 20, 1,500.
    function kmText(v) {
        if (v >= 1) return Math.round(v).toLocaleString('en-US');
        return String(Number(v.toPrecision(1)));
    }
    // An HTML scale bar laid over a pane: a bar of a given pixel length, with its distance under it.
    function scaleBarEl(host, side) {
        const el = document.createElement('div');
        el.className = 'rpo-scalebar' + (side === 'left' ? ' left' : '');
        el.innerHTML = '<div class="bar"></div><div class="txt"></div>';
        host.appendChild(el);
        return {
            el,
            set(px, text) {
                el.style.display = px > 0 ? '' : 'none';
                el.firstChild.style.width = Math.round(px) + 'px';
                el.lastChild.innerHTML = text;
            }
        };
    }
    function stepText(step) {
        return step >= 1 ? String(Math.round(step)) : String(Number(step.toPrecision(1)));
    }

    function createRicPlane(canvas, options) {
        const plane = PLANES[(options && options.plane) || 'left'];
        const planeName = (options && options.plane) || 'left';
        // compact: a small answer-choice plot, with a one-line axis key and no grid size or badge.
        const compact = Boolean(options && options.compact);
        const ctx = canvas.getContext('2d');
        let w = 300, h = 150;
        let scale = 10;                 // pixels per km, the same on both axes, always
        let center = [0, 0];            // km at the middle of the pane: [across, up]
        const p = [0, 0, 0];

        function toPx(a, b) {           // a = km across (positive left), b = km up
            return [w / 2 - (a - center[0]) * scale, h / 2 - (b - center[1]) * scale];
        }
        function toKm(px, py) {
            return [center[0] - (px - w / 2) / scale, center[1] - (py - h / 2) / scale];
        }
        function project(point) { return toPx(point[plane.h], point[plane.v]); }

        function resize(width, height) {
            w = Math.max(1, width); h = Math.max(1, height);
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // halfWidthKm is half of the pane's smaller side, so that distance fits in every direction.
        function setExtent(extent) {
            scale = Math.min(w, h) / 2 / Math.max(extent.halfWidthKm, 1e-6);
            if (extent.centerKm) center = [extent.centerKm[0], extent.centerKm[1]];
        }
        function setScale(pxPerKm, centerKm) {
            scale = pxPerKm;
            if (centerKm) center = [centerKm[0], centerKm[1]];
        }
        // The largest pixels-per-km at which a box { min: [x,y,z], max: [x,y,z] } fits this pane.
        function fitScale(box) {
            const dh = Math.max(box.max[plane.h] - box.min[plane.h], 1e-6);
            const dv = Math.max(box.max[plane.v] - box.min[plane.v], 1e-6);
            return Math.min(w / dh, h / dv);
        }
        function boxCenter(box) {
            return [(box.max[plane.h] + box.min[plane.h]) / 2, (box.max[plane.v] + box.min[plane.v]) / 2];
        }

        function strokePath(path, style, width, dash) {
            const count = pathLength(path);
            if (count < 2) return;
            ctx.beginPath();
            for (let k = 0; k < count; k++) {
                const q = project(pathPoint(path, k, p));
                if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
            }
            ctx.strokeStyle = style;
            ctx.lineWidth = width;
            ctx.setLineDash(dash || []);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        function arrow(x0, y0, x1, y1, style, width) {
            const ang = Math.atan2(y1 - y0, x1 - x0);
            const head = 6;
            ctx.strokeStyle = style; ctx.fillStyle = style; ctx.lineWidth = width || 1.5;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
            ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
            ctx.closePath(); ctx.fill();
        }

        function drawGrid() {
            const lo = toKm(w, h), hi = toKm(0, 0);          // lo: right and bottom edges; hi: left and top
            const step = gridStep(Math.max(hi[0] - lo[0], 1e-6));
            ctx.lineWidth = 1;
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.fillStyle = COLORS.text;
            for (let a = Math.ceil(lo[0] / step) * step; a <= hi[0]; a += step) {
                const x = Math.round(toPx(a, 0)[0]) + 0.5;
                ctx.strokeStyle = Math.abs(a) < step / 2 ? COLORS.axis : COLORS.grid;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
            }
            for (let b = Math.ceil(lo[1] / step) * step; b <= hi[1]; b += step) {
                const y = Math.round(toPx(0, b)[1]) + 0.5;
                ctx.strokeStyle = Math.abs(b) < step / 2 ? COLORS.axis : COLORS.grid;
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
            }
            if (compact) return;
            drawScaleBar(step);
        }

        // A bar one grid square long (or a longer 1-2-5 length if a square is under 30 px),
        // labeled with its length, in the bottom right corner.
        function drawScaleBar(step) {
            const km = step * scale >= 30 ? step : niceAtLeast(30 / scale);
            const len = km * scale;
            const text = kmText(km) + ' km';
            ctx.font = '600 10px "JetBrains Mono", monospace';
            const tw = ctx.measureText(text).width;
            const boxW = Math.max(len, tw) + 10;
            const x1 = w - 6 - (boxW - len) / 2, x0 = x1 - len, y = h - 18;
            ctx.fillStyle = 'rgba(6, 11, 20, 0.72)';
            ctx.fillRect(w - 6 - boxW, y - 7, boxW, 24);
            ctx.strokeStyle = '#f0f4fa'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 4);
            ctx.stroke();
            ctx.fillStyle = '#e8edf5';
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(text, (x0 + x1) / 2, y + 2);
        }

        function drawFrameLabels() {
            if (compact) {
                ctx.font = '600 9px Inter, sans-serif';
                ctx.textAlign = 'left'; ctx.textBaseline = 'top';
                ctx.fillStyle = COLORS.ric;
                ctx.fillText(plane.vLabel.split(' ')[0] + '↑ ' + plane.hLabel.split(' ')[0] + '←', 4, 3);
                return;
            }
            ctx.font = '600 11px Inter, sans-serif';
            ctx.fillStyle = COLORS.ric;
            // The badge sits in the top left corner, and the axis arrows just below it, always
            // pointing the way the axes run: left and up.
            ctx.textAlign = 'left'; ctx.textBaseline = 'top';
            const bw = ctx.measureText(plane.badge).width;
            ctx.fillStyle = 'rgba(6, 11, 20, 0.72)';
            ctx.fillRect(4, 4, bw + 8, 16);
            ctx.fillStyle = COLORS.ric;
            ctx.fillText(plane.badge, 8, 6);
            // On a small pane the axis key shrinks, so it does not cover the picture.
            const small = Math.min(w, h) < 220;
            const L = small ? 16 : 26, ox = small ? 26 : 40, oy = small ? 42 : 58;
            if (small) ctx.font = '600 10px Inter, sans-serif';
            arrow(ox, oy, ox - L, oy, COLORS.ric, 1.5);
            arrow(ox, oy, ox, oy - L, COLORS.ric, 1.5);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(plane.vLabel, ox + 5, oy - L + 6);
            ctx.textBaseline = 'top';
            ctx.fillText(plane.hLabel, ox - L, oy + 4);
            if (planeName === 'left' && w >= 230) {
                ctx.fillStyle = COLORS.text; ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText('To Earth ↓', 8, h - 5);
            }
        }

        function drawTarget() {
            const q = toPx(0, 0);
            ctx.fillStyle = COLORS.target;
            ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10);
        }
        function drawChase(point) {
            const q = project(point);
            ctx.fillStyle = COLORS.chase;
            ctx.beginPath();
            ctx.moveTo(q[0], q[1] - 7); ctx.lineTo(q[0] + 6.5, q[1] + 5); ctx.lineTo(q[0] - 6.5, q[1] + 5);
            ctx.closePath(); ctx.fill();
        }

        // The NMC center (a cross), its drift (an arrow), and the outline of the NMC at this instant.
        function drawNmc(data) {
            const e = data.rmoe;
            if (!e) return;
            const c3 = [e.xc, e.yc0, 0];
            const q = project(c3);
            ctx.strokeStyle = COLORS.chase; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(q[0] - 4, q[1]); ctx.lineTo(q[0] + 4, q[1]);
            ctx.moveTo(q[0], q[1] - 4); ctx.lineTo(q[0], q[1] + 4); ctx.stroke();
            if (planeName !== 'behind' && Math.abs(e.xc) > 1e-9) {
                const dir = e.xc > 0 ? -1 : 1;                       // above the target drifts backward
                const tip = project([e.xc, e.yc0 + dir * 22 / scale, 0]);
                arrow(q[0], q[1], tip[0], tip[1], COLORS.chase, 1.2);
            }
            if (data.showNmc && e.C > 1e-9) {
                const outline = [];
                for (let k = 0; k <= 72; k++) {
                    const m = k * Math.PI / 36;
                    outline.push([e.xc - e.C * Math.cos(m), e.yc0 + 2 * e.C * Math.sin(m), 0]);
                }
                if (planeName !== 'behind') strokePath(outline, COLORS.ghost, 1, [3, 3]);
            }
        }

        function draw(data) {
            data = data || {};
            ctx.clearRect(0, 0, w, h);
            drawGrid();
            if (data.keepOutKm > 0) {
                const q = toPx(0, 0);
                ctx.strokeStyle = COLORS.keepOut; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.arc(q[0], q[1], data.keepOutKm * scale, 0, 2 * Math.PI); ctx.stroke();
                ctx.setLineDash([]);
            }
            (data.ghosts || []).forEach(g => strokePath(g, COLORS.ghost, 2));
            strokePath(data.model, COLORS.model, 1, [5, 4]);
            strokePath(data.predicted, COLORS.chase, 1.2, [4, 4]);
            strokePath(data.trail, COLORS.chase, 3);
            // The whole NMC chase is on now, dotted; it moves with chase as the center drifts.
            ctx.lineCap = 'round';
            strokePath(data.nmcLoop, COLORS.nmc, 1.6, [0.1, 4.5]);
            ctx.lineCap = 'butt';
            drawNmc(data);
            (data.burns || []).forEach(b => {
                const from = project(b.at);
                const len = Math.hypot(b.dv[plane.h], b.dv[plane.v]);
                if (len < 1e-12) return;
                // A burn arrow has a fixed length on screen; it shows direction, not size.
                const ux = -b.dv[plane.h] / len, uy = -b.dv[plane.v] / len;
                arrow(from[0], from[1], from[0] + ux * 26, from[1] + uy * 26, '#f0f4fa', 1.8);
            });
            drawTarget();
            if (data.marker) {
                const q = project(data.marker);
                ctx.strokeStyle = '#f0f4fa'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, 2 * Math.PI); ctx.stroke();
            }
            if (data.modelChase) {
                // Where the course model puts chase now: a hollow triangle.
                const q = project(data.modelChase);
                ctx.strokeStyle = COLORS.model; ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(q[0], q[1] - 8); ctx.lineTo(q[0] + 7.5, q[1] + 5.5); ctx.lineTo(q[0] - 7.5, q[1] + 5.5);
                ctx.closePath(); ctx.stroke();
            }
            if (data.chase) drawChase(data.chase);
            drawFrameLabels();
        }

        return {
            plane: planeName, canvas, resize, setExtent, setScale, fitScale, boxCenter, draw, toKm, toPx,
            axes: [plane.h, plane.v],
            center: () => center.slice(),
            kmPerPx: () => 1 / scale,
            size: () => [w, h]
        };
    }

    // The bounding box of the origin and every path given, padded by 15 percent.
    function boundingBox(paths) {
        const min = [0, 0, 0], max = [0, 0, 0], p = [0, 0, 0];
        (paths || []).forEach(path => {
            for (let k = 0, count = pathLength(path); k < count; k++) {
                pathPoint(path, k, p);
                for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
            }
        });
        for (let a = 0; a < 3; a++) {
            const pad = Math.max(0.15 * (max[a] - min[a]) / 2, 0);
            const least = 0.05;                                // never zoom in past a 0.05 km half-width
            const half = Math.max((max[a] - min[a]) / 2 + pad, least);
            const mid = (max[a] + min[a]) / 2;
            min[a] = mid - half; max[a] = mid + half;
        }
        return { min, max };
    }

    // Fit several flat panes to the same paths. With shared = true (the default) every pane uses
    // the smallest of the panes' own scales, so one distance looks the same in all of them.
    // Call this when the inputs or the time span change, never during playback.
    function fitPanes(panes, paths, shared) {
        const box = boundingBox(paths);
        const scales = panes.map(pane => pane.fitScale(box));
        const common = Math.min.apply(null, scales);
        panes.forEach((pane, k) => pane.setScale(shared === false ? scales[k] : common, pane.boxCenter(box)));
        return { box, scale: common };
    }

    // Drag to slide and wheel or pinch to zoom a flat pane.
    // options: plane() -> the pane this canvas shows now; linked() -> every pane that moves with it
    // (sliding moves each linked pane along the RIC axes it shares; zooming keeps one scale);
    // onChange() after every move. Fit Views (fitPanes) puts the panes back.
    function attachPanZoom(canvas, options) {
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        const pts = new Map();
        let pinch = null;
        const linked = () => { const l = options.linked ? options.linked() : []; return l.length ? l : [options.plane()]; };
        function zoomPane(pane, f, px, py) {
            const [w, h] = pane.size();
            const s1 = f / pane.kmPerPx();
            const ax = px === undefined ? w / 2 : px, ay = py === undefined ? h / 2 : py;
            const anchor = pane.toKm(ax, ay);
            pane.setScale(s1, [anchor[0] + (ax - w / 2) / s1, anchor[1] + (ay - h / 2) / s1]);
        }
        function zoom(f, px, py) {
            const self = options.plane();
            zoomPane(self, f, px, py);
            // The other panes zoom about their middles, then take the zoomed pane's center on every
            // axis they share with it, so a shared axis (R in the views from the left and from
            // behind) stays lined up: the target sits at the same height in both.
            const c = self.center(), at = [null, null, null];
            at[self.axes[0]] = c[0]; at[self.axes[1]] = c[1];
            linked().forEach(p => {
                if (p === self) return;
                zoomPane(p, f);
                const q = p.center();
                p.setScale(1 / p.kmPerPx(), [at[p.axes[0]] !== null ? at[p.axes[0]] : q[0], at[p.axes[1]] !== null ? at[p.axes[1]] : q[1]]);
            });
            if (options.onChange) options.onChange();
        }
        function slide(dx, dy) {
            const self = options.plane();
            const d = [0, 0, 0], k = self.kmPerPx();
            d[self.axes[0]] = dx * k;          // dragging right moves the picture right
            d[self.axes[1]] = dy * k;          // dragging down moves the picture down
            const moved = [false, false, false];
            moved[self.axes[0]] = moved[self.axes[1]] = true;
            linked().forEach(p => {
                const c = p.center();
                p.setScale(1 / p.kmPerPx(), [c[0] + (moved[p.axes[0]] ? d[p.axes[0]] : 0), c[1] + (moved[p.axes[1]] ? d[p.axes[1]] : 0)]);
            });
            if (options.onChange) options.onChange();
        }
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const r = canvas.getBoundingClientRect();
            zoom(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            canvas.style.cursor = 'grabbing';
            if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
        });
        canvas.addEventListener('pointermove', e => {
            const last = pts.get(e.pointerId);
            if (!last) return;
            const dx = e.clientX - last.x, dy = e.clientY - last.y;
            last.x = e.clientX; last.y = e.clientY;
            if (pts.size === 1) { if (dx || dy) slide(dx, dy); return; }
            if (pts.size === 2 && pinch) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                const r = canvas.getBoundingClientRect();
                zoom(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
                pinch = d;
            }
        });
        const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) canvas.style.cursor = 'grab'; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
    }

    // A small static plot of one path with a direction arrow, for answer choices.
    function drawThumbnail(canvas, spec) {
        const M = window.RpoMath;
        const pane = createRicPlane(canvas, { plane: spec.plane || 'left' });
        pane.resize(canvas.clientWidth || 160, canvas.clientHeight || 110);
        // spec.path (a sampled path) draws a picture no set of RMOEs can make, such as a wrong answer.
        let path = spec.path;
        if (!path) {
            const tEnd = (spec.revs || 1) * 2 * Math.PI / spec.n;
            path = M.sampleTrajectory(spec.rmoe, spec.n, 0, tEnd, Math.max(60, Math.round(120 * (spec.revs || 1))));
        }
        const end = pathLength(path) - 1;
        fitPanes([pane], [path], true);
        // A ring marks the start and the triangle the end, so the direction of travel can be read.
        pane.draw({ trail: path, marker: [path[0], path[1], path[2]], chase: [path[3 * end], path[3 * end + 1], path[3 * end + 2]] });
        return pane;
    }

    // ---------- the 3D RIC box ----------
    // Scene axes: X = I, Y = C, Z = R, with camera.up = +Z so R stays up. A RIC point
    // [x, y, z] = [R, I, C] is therefore drawn at scene (y, z, x). The camera is orthographic,
    // so facing an axis reproduces the matching flat view exactly.
    const BOX_VIEWS = {
        '3d': { az: 125, el: 22 },
        left: { az: 90, el: 0 },        // +R up, +I left
        behind: { az: 180, el: 0 },     // +R up, +C left
        above: { az: 180, el: 89.9 }    // +I up, +C left
    };

    // A line a few pixels wide (WebGL draws ordinary lines 1 pixel wide on most systems). Each
    // segment is a quad widened in screen space; a segment that runs behind the camera is cut at
    // the near plane. setPoints(points, count) takes a flat array of count x, y, z (loop joins the
    // last point to the first); setResolution(w, h) takes the viewport size before each render.
    const TRACE_PX = 2.5;
    function createFatLine(THREE, color, opacity, loop, widthPx) {
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(color) }, opacity: { value: opacity },
                width: { value: widthPx || TRACE_PX }, resolution: { value: new THREE.Vector2(1, 1) }
            },
            // The logdepthbuf chunks matter in the inertial pane, whose renderer has a logarithmic
            // depth buffer: without them the traces' depth is not comparable with Earth's, and Earth
            // hides every part of a trace, even the parts in front of it.
            vertexShader: [
                '#include <common>',
                '#include <logdepthbuf_pars_vertex>',
                'uniform float width;',
                'uniform vec2 resolution;',
                'attribute vec3 end;',
                'attribute vec2 corner;',
                'void main() {',
                '    vec4 s = modelViewMatrix * vec4(position, 1.0);',
                '    vec4 e = modelViewMatrix * vec4(end, 1.0);',
                '    bool persp = projectionMatrix[3][3] < 0.5;',
                '    float nz = persp ? -0.5 * projectionMatrix[3][2] / projectionMatrix[2][2] : 1e30;',
                '    if (persp && s.z > nz && e.z > nz) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }',
                '    if (persp) {',
                '        float cut = (nz - s.z) / (e.z - s.z);',
                '        if (s.z > nz) s.xyz = mix(s.xyz, e.xyz, cut);',
                '        else if (e.z > nz) e.xyz = mix(s.xyz, e.xyz, cut);',
                '    }',
                '    vec4 cs = projectionMatrix * s;',
                '    vec4 ce = projectionMatrix * e;',
                '    vec2 d = (ce.xy / ce.w - cs.xy / cs.w) * resolution;',
                '    float l = length(d);',
                '    vec2 nrm = l > 1e-6 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);',
                '    vec4 c = corner.x < 0.5 ? cs : ce;',
                '    c.xy += nrm * corner.y * width / resolution * c.w;',
                '    gl_Position = c;',
                '    #include <logdepthbuf_vertex>',
                '}'
            ].join('\n'),
            fragmentShader: [
                '#include <logdepthbuf_pars_fragment>',
                'uniform vec3 color;',
                'uniform float opacity;',
                'void main() {',
                '    #include <logdepthbuf_fragment>',
                '    gl_FragColor = vec4(color, opacity);',
                '    #include <colorspace_fragment>',
                '}'
            ].join('\n'),
            transparent: true, depthWrite: false, side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.userData.ready = false;
        let cap = 0, startArr = null, endArr = null;
        mesh.setPoints = (pts, count) => {
            const segs = count < 2 ? 0 : loop ? count : count - 1;
            if (segs > cap) {
                cap = Math.max(segs, Math.ceil(cap * 1.5));
                startArr = new Float32Array(cap * 12);
                endArr = new Float32Array(cap * 12);
                const corner = new Float32Array(cap * 8), index = new Uint32Array(cap * 6);
                for (let k = 0; k < cap; k++) {
                    corner.set([0, -1, 0, 1, 1, -1, 1, 1], 8 * k);
                    const v = 4 * k;
                    index.set([v, v + 2, v + 1, v + 2, v + 3, v + 1], 6 * k);
                }
                mesh.geometry.dispose();
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(startArr, 3));
                g.setAttribute('end', new THREE.BufferAttribute(endArr, 3));
                g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
                g.setIndex(new THREE.BufferAttribute(index, 1));
                mesh.geometry = g;
            }
            for (let k = 0; k < segs; k++) {
                const a = 3 * k, b = 3 * ((k + 1) % count);
                for (let j = 0; j < 4; j++) {
                    const o = 12 * k + 3 * j;
                    startArr[o] = pts[a]; startArr[o + 1] = pts[a + 1]; startArr[o + 2] = pts[a + 2];
                    endArr[o] = pts[b]; endArr[o + 1] = pts[b + 1]; endArr[o + 2] = pts[b + 2];
                }
            }
            if (cap) {
                mesh.geometry.getAttribute('position').needsUpdate = true;
                mesh.geometry.getAttribute('end').needsUpdate = true;
                mesh.geometry.setDrawRange(0, segs * 6);
            }
            mesh.userData.ready = segs > 0;
        };
        mesh.setResolution = (wd, ht) => mat.uniforms.resolution.value.set(Math.max(1, wd), Math.max(1, ht));
        return mesh;
    }

    function createRicBox(THREE, canvas) {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
        camera.up.set(0, 0, 1);
        let w = 300, h = 150, half = 1, zoom = 1, shadows = false;
        const view = { az: BOX_VIEWS['3d'].az, el: BOX_VIEWS['3d'].el };
        let turn = null;

        // Backdrop: Earth and the stars where they truly are around the target, at true scale, as
        // the Reference Frame Observatory draws its RIC view. It is a second scene in Earth radii.
        // The world group turns inertial vectors into the box axes (X = I, Y = C, Z = R), so Earth's
        // center sits one orbit radius straight down -R and the stars stay fixed in inertial space.
        // A 38 degree perspective camera looks at the target along the box camera's line of sight,
        // from just far enough back that the target's depth has the box's km per pixel. So at LEO
        // Earth's surface fills the lower view, and at GEO Earth is too far below to appear except
        // when looking down at the target.
        const BG_FOV = 38;
        let backdropOn = true, insetOn = false, orbitOn = true, haveBasis = false, orbitR = 1;
        // The farthest any drawn orbit ring gets from Earth's center (its apogee), in Earth radii.
        // The cameras' far planes must reach across Earth to it, or the far side of the ring is cut
        // off when looking down toward Earth (a GEO ring is 13 Earth radii across).
        const ringReach = { target: 0, chase: 0 };
        const reach = () => Math.max(orbitR, ringReach.target, ringReach.chase);
        const bg = (() => {
            if (!window.EarthScene || !window.RpoMath) return null;
            const bgScene = new THREE.Scene();
            const bgCamera = new THREE.PerspectiveCamera(60, 2, 1e-4, 1e4);
            const world = new THREE.Group();
            world.matrixAutoUpdate = false;
            bgScene.add(world);
            const holder = new THREE.Group();
            world.add(holder);
            const earth = window.EarthScene.addEarth(THREE, renderer, holder);
            const stars = window.EarthScene.addStars(THREE, bgScene);
            world.add(new THREE.AmbientLight(0xffffff, 0.5));
            const sun = new THREE.DirectionalLight(0xffffff, 2.1);
            sun.position.set(6000, 2000, 5000);         // the inertial pane's sun direction, far off
            world.add(sun);
            // The inset: the same scene from far enough back to hold Earth and the target, with a
            // marker on the target and a line down -R to Earth's center. Both show only in the inset.
            const insetCamera = new THREE.PerspectiveCamera(BG_FOV, 1.25, 0.05, 100);
            insetCamera.up.set(0, 0, 1);
            const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color: COLORS.target, sizeAttenuation: false, depthTest: false }));
            marker.scale.setScalar(0.05);
            marker.renderOrder = 5;
            const radial = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
                new THREE.LineBasicMaterial({ color: COLORS.ric, transparent: true, opacity: 0.6 }));
            marker.visible = radial.visible = false;
            bgScene.add(marker, radial);
            // The target's whole orbit, in ECI inside the world group, so it passes through the
            // target and curves down around Earth as the frame turns.
            const orbit = createFatLine(THREE, COLORS.target, 0.6, true);
            world.add(orbit);
            // The chase's whole orbit, the same way, from its position and velocity now.
            const chaseOrbit = createFatLine(THREE, COLORS.chase, 0.6, true);
            world.add(chaseOrbit);
            return { scene: bgScene, camera: bgCamera, world, holder, earth, stars, insetCamera, marker, radial, orbit, chaseOrbit };
        })();
        // The inset's outline and caption, laid over the canvas (the picture itself is drawn in WebGL).
        const insetEl = bg && canvas.parentElement ? (() => {
            const el = document.createElement('div');
            el.className = 'rpo-earthinset';
            el.innerHTML = '<span>Earth, zoomed out</span>';
            el.style.display = 'none';
            canvas.parentElement.appendChild(el);
            return el;
        })() : null;
        const INSET_TOP = 30, INSET_RIGHT = 6;
        // True when some of Earth's disk is inside the backdrop camera's view.
        function earthInView() {
            if (!bg.holder.visible) return false;
            bg.camera.updateMatrixWorld();
            const v = new THREE.Vector3(0, 0, -orbitR).applyMatrix4(bg.camera.matrixWorldInverse);
            const depth = -v.z;
            if (depth < -1) return false;
            const tanV = Math.tan(BG_FOV * Math.PI / 360), tanH = tanV * bg.camera.aspect;
            const reach = Math.max(depth, 0);
            return Math.abs(v.x) - 1 <= reach * tanH && Math.abs(v.y) - 1 <= reach * tanV;
        }
        function renderInset() {
            // A narrow pane (the RMOE Explorer's second view) gives the inset half its width.
            const iw = Math.round(Math.max(84, Math.min(170, w * (w < 300 ? 0.5 : 0.28)))), ih = Math.round(iw * 0.8);
            const show = insetOn && w >= 140 && h >= 170 && !earthInView();
            if (insetEl) insetEl.style.display = show ? '' : 'none';
            if (!show) return;
            if (insetEl) {
                insetEl.style.width = iw + 'px'; insetEl.style.height = ih + 'px';
                insetEl.style.top = INSET_TOP + 'px'; insetEl.style.right = INSET_RIGHT + 'px';
            }
            // Seen from the box camera's side, a little above the target's level, so the target and
            // Earth stay apart on screen; aimed between them.
            const az = view.az * Math.PI / 180, el = 12 * Math.PI / 180;
            const mid = -orbitR / 2, dist = Math.max(4.4, (orbitR + 1.5) * 1.75);
            const ic = bg.insetCamera;
            ic.position.set(dist * Math.cos(el) * Math.cos(az), dist * Math.cos(el) * Math.sin(az), mid + dist * Math.sin(el));
            ic.lookAt(0, 0, mid);
            ic.aspect = iw / ih;
            ic.near = dist * 0.05;
            ic.far = (dist + orbitR / 2 + reach() + 1) * 1.1;
            ic.updateProjectionMatrix();
            const wasHolder = bg.holder.visible;
            bg.holder.visible = true;
            bg.radial.scale.set(1, 1, orbitR);
            bg.marker.visible = bg.radial.visible = true;
            bg.stars.follow(ic);
            const x = w - INSET_RIGHT - iw, y = h - INSET_TOP - ih;
            renderer.setScissorTest(true);
            renderer.setViewport(x, y, iw, ih);
            renderer.setScissor(x, y, iw, ih);
            renderer.setClearColor(0x03060c, 1);
            renderer.clear();
            bg.orbit.setResolution(iw, ih); bg.chaseOrbit.setResolution(iw, ih);
            renderer.render(bg.scene, ic);
            renderer.setClearColor(0x000000, 0);
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, w, h);
            bg.marker.visible = bg.radial.visible = false;
            bg.holder.visible = wasHolder;
        }
        // An orbit as an ECI ring in Earth radii, from an ECI position (km) and velocity (km/s). The
        // ring starts at that point, so it passes exactly through the spacecraft; rebuilt every
        // update. (A ring sampled once from the elements cuts inside the orbit between samples, by
        // up to 0.4 km at GEO, so the target seemed to shake against it as it moved.)
        const RING = 1440;
        const targetRing = new Float32Array(RING * 3), chaseRing = new Float32Array(RING * 3);
        function setRing(mesh, arr, rv, key) {
            ringReach[key] = 0;
            const M = window.RpoMath, RE = M.RE, MU = M.MU;
            const ok = rv && rv.r && rv.v;
            const r = ok ? rv.r : null, v = ok ? rv.v : null;
            const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            const len = a => Math.hypot(a[0], a[1], a[2]);
            const h = ok ? cross(r, v) : null;
            const hn = ok ? len(h) : 0, rn = ok ? len(r) : 0;
            const ev = ok ? cross(v, h).map((x, k) => x / MU - r[k] / rn) : null;
            const e = ok ? len(ev) : 1;
            if (!ok || hn === 0 || e >= 0.99) { mesh.visible = false; mesh.userData.ready = false; return; }
            const hHat = h.map(x => x / hn);
            const P = e > 1e-9 ? ev.map(x => x / e) : r.map(x => x / rn);
            const Q = cross(hHat, P);
            const p = hn * hn / MU;
            const nu0 = Math.atan2(r[0] * Q[0] + r[1] * Q[1] + r[2] * Q[2], r[0] * P[0] + r[1] * P[1] + r[2] * P[2]);
            for (let k = 0; k < RING; k++) {
                const nu = nu0 + 2 * Math.PI * k / RING;
                const rr = p / (1 + e * Math.cos(nu)) / RE, c = Math.cos(nu), sn = Math.sin(nu);
                for (let a = 0; a < 3; a++) arr[3 * k + a] = rr * (c * P[a] + sn * Q[a]);
            }
            mesh.setPoints(arr, RING);
            mesh.userData.ready = true;        // so turning the traces off and on again brings it back
            mesh.visible = orbitOn;
            ringReach[key] = p / (1 - e) / RE;
        }
        // The target's ring needs its velocity (basis.v) as well as rT.
        function setOrbit(rv) { if (bg) setRing(bg.orbit, targetRing, rv, 'target'); }
        function setChaseOrbit(rv) { if (bg) setRing(bg.chaseOrbit, chaseRing, rv, 'chase'); }
        function setBackdropFrame(basis, rT, t) {
            if (!bg || !basis || !rT) { haveBasis = false; return; }
            const M = window.RpoMath, RE = M.RE;
            const n = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
            const I = n(basis.I), C = n(basis.C), R = n(basis.R);
            bg.world.matrix.set(
                I[0], I[1], I[2], 0,
                C[0], C[1], C[2], 0,
                R[0], R[1], R[2], 0,
                0, 0, 0, 1);
            bg.world.matrixWorldNeedsUpdate = true;
            bg.stars.quaternion.setFromRotationMatrix(bg.world.matrix);
            bg.holder.position.set(-rT[0] / RE, -rT[1] / RE, -rT[2] / RE);
            bg.orbit.position.copy(bg.holder.position);       // the rings are centered on Earth
            bg.chaseOrbit.position.copy(bg.holder.position);
            orbitR = Math.hypot(rT[0], rT[1], rT[2]) / RE;
            bg.earth.pivot.rotation.z = M.OMEGA_E * (t || 0);
            haveBasis = true;
        }

        function spriteFrom(drawFn, size) {
            const c = document.createElement('canvas');
            c.width = c.height = size;
            drawFn(c.getContext('2d'), size);
            const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true });
            const sprite = new THREE.Sprite(material);
            sprite.renderOrder = 10;
            return sprite;
        }
        function textSprite(text) {
            const sprite = spriteFrom((g, size) => {
                g.font = '600 26px Inter, sans-serif'; g.fillStyle = COLORS.ric;
                g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, size / 2, size / 2);
            }, 128);
            sprite.userData.px = 64;
            return sprite;
        }
        const target = spriteFrom((g, s) => { g.fillStyle = COLORS.target; g.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6); }, 64);
        target.userData.px = 16;
        const chase = spriteFrom((g, s) => {
            g.fillStyle = COLORS.chase; g.beginPath();
            g.moveTo(s / 2, s * 0.12); g.lineTo(s * 0.9, s * 0.85); g.lineTo(s * 0.1, s * 0.85); g.closePath(); g.fill();
        }, 64);
        chase.userData.px = 18;
        const sprites = [target, chase];

        // Everything sized by the half-width lives in this group, built at half-width 1 and scaled.
        const frame = new THREE.Group();
        scene.add(frame);
        const lineOf = (points, color, opacity) => new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points.map(q => new THREE.Vector3(q[0], q[1], q[2]))),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
        [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(a => frame.add(lineOf([a.map(v => -v), a], COLORS.ric, 0.7)));
        frame.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)),
            new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.25 })));
        [['+I', [1.1, 0, 0]], ['+C', [0, 1.1, 0]], ['+R', [0, 0, 1.1]]].forEach(([text, at]) => {
            const s = textSprite(text);
            s.userData.at = at;
            sprites.push(s);
            scene.add(s);
        });
        scene.add(target, chase);

        // Trail, course-model path, and the three shadows of the trail on the box walls.
        function makeLine(color, opacity, dashed) {
            const material = dashed
                ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1, gapSize: 1 })
                : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
            const line = new THREE.Line(new THREE.BufferGeometry(), material);
            line.frustumCulled = false;
            scene.add(line);
            return line;
        }
        // Ticks at the grid step on each axis, in km, rebuilt when the half-width changes.
        const ticks = new THREE.LineSegments(new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: COLORS.ric, transparent: true, opacity: 0.55 }));
        ticks.frustumCulled = false;
        scene.add(ticks);
        function buildTicks() {
            const step = gridStep(2 * half), len = half * 0.035, pts = [];
            for (let k = Math.ceil(-half / step); k * step <= half + 1e-9; k++) {
                if (k === 0) continue;
                const v = k * step;
                pts.push(v, 0, -len, v, 0, len);          // I axis (scene X), tick along R
                pts.push(0, v, -len, 0, v, len);          // C axis (scene Y), tick along R
                pts.push(-len, 0, v, len, 0, v);          // R axis (scene Z), tick along I
            }
            ticks.geometry.dispose();
            ticks.geometry = new THREE.BufferGeometry();
            ticks.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        }

        // The trail and the faint whole path are drawn a few pixels wide; a plain WebGL line is 1 pixel.
        const fatLines = [];
        function makeFat(color, opacity, widthPx) {
            const line = createFatLine(THREE, color, opacity, false, widthPx);
            scene.add(line);
            fatLines.push(line);
            return line;
        }
        const ghostLine = makeFat(COLORS.chase, 0.35, 2);
        const trailLine = makeFat(COLORS.chase, 1, 3);
        const modelLine = makeLine(0xf0f4fa, 0.6, true);
        const nmcLine = makeLine(COLORS.chase, 0.8, true);       // the current NMC, dotted
        const shadowLines = [makeLine(COLORS.chase, 0.3), makeLine(COLORS.chase, 0.3), makeLine(COLORS.chase, 0.3)];
        const p = [0, 0, 0];

        // flatten: null, or [scene axis index, value] that pins one scene coordinate to a wall.
        function fill(line, path, flatten) {
            const count = pathLength(path);
            const arr = new Float32Array(count * 3);
            for (let k = 0; k < count; k++) {
                pathPoint(path, k, p);
                arr[3 * k] = p[1]; arr[3 * k + 1] = p[2]; arr[3 * k + 2] = p[0];
                if (flatten) arr[3 * k + flatten[0]] = flatten[1];
            }
            if (line.setPoints) { line.setPoints(arr, count); line.visible = count > 1; return; }
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry();
            line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            if (line.material.isLineDashedMaterial) {
                line.material.dashSize = line.material.gapSize = half / 25;
                line.computeLineDistances();
            }
            line.visible = count > 1;
        }

        // Scale bar, bottom left: a length on screen for a line that faces the viewer, the same as
        // the tick spacing on the axes when that is long enough to see.
        const bar = canvas.parentElement ? scaleBarEl(canvas.parentElement, 'left') : null;
        // The first frame that shows Earth costs the GPU a one-time setup (about 18 ms, a visible
        // hitch the first time the user looks down). Pay it up front: once, before the first
        // backdrop frame, draw the backdrop with a camera aimed straight at Earth. The real
        // frame drawn right after clears and covers it, so it is never seen.
        let earthWarm = false;
        const bgFwd = new THREE.Vector3(), bgLat = new THREE.Vector3(), bgToEci = new THREE.Matrix4();
        function warmUpEarth() {
            if (earthWarm || !bg) return;
            earthWarm = true;
            const cam = new THREE.PerspectiveCamera(BG_FOV, w / h, 0.05, 100);
            const center = new THREE.Vector3(0, 0, -orbitR);
            cam.position.set(0, 0, -orbitR + 4);
            cam.up.set(0, 1, 0);
            cam.lookAt(center);
            cam.updateMatrixWorld();
            const wasHolder = bg.holder.visible;
            bg.holder.visible = true;
            bg.stars.follow(cam);
            bg.orbit.setResolution(w, h); bg.chaseOrbit.setResolution(w, h);
            renderer.render(bg.scene, cam);
            bg.holder.visible = wasHolder;
        }
        function render() {
            fatLines.forEach(l => l.setResolution(w, h));
            const az = view.az * Math.PI / 180, el = view.el * Math.PI / 180;
            const d = half * 10;
            camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
            camera.lookAt(0, 0, 0);
            // Half of the visible height in km. 1.8 half-widths keeps the whole cube in view at any
            // angle; a pane that is taller than it is wide is fitted by its width instead.
            const halfH = half * 1.8 / zoom * Math.max(1, h / w);
            const halfW = halfH * w / h;
            camera.left = -halfW; camera.right = halfW;
            camera.top = halfH; camera.bottom = -halfH;
            camera.near = -d * 4; camera.far = d * 4;
            camera.updateProjectionMatrix();
            const kmPerPx = 2 * halfH / h;
            if (bar) {
                const step = gridStep(2 * half);
                const km = step / kmPerPx >= 30 ? step : niceAtLeast(30 * kmPerPx);
                bar.set(canvas.clientWidth ? km / kmPerPx : 0, kmText(km) + ' km' + (km === step ? ' <span>· tick spacing</span>' : ''));
            }
            sprites.forEach(s => {
                s.scale.setScalar(s.userData.px * kmPerPx);
                if (s.userData.at) s.position.set(s.userData.at[0] * half, s.userData.at[1] * half, s.userData.at[2] * half);
            });
            if (bg && backdropOn && haveBasis) {
                warmUpEarth();
                // Look the same way as the box camera, at the target, from the distance at which the
                // target's depth has the box's scale.
                const RE = window.RpoMath.RE;
                const D = halfH / Math.tan(BG_FOV * Math.PI / 360) / RE;
                bg.camera.position.copy(camera.position).normalize().multiplyScalar(D);
                bg.camera.quaternion.copy(camera.quaternion);
                bg.camera.fov = BG_FOV;
                bg.camera.aspect = w / h;
                bg.camera.near = D * 0.2;
                bg.camera.far = D + orbitR + reach() + 3;
                bg.camera.updateProjectionMatrix();
                // The box is flat (orthographic) and the backdrop is in perspective, so a point nearer
                // or farther than the target lands a little apart in the two. Slide chase's ring
                // sideways (by a fraction of chase's offset, a few km at most) so its point at chase
                // lands exactly on the chase marker. The slide is worked out in the box axes, but the
                // ring's position is in the world group's ECI axes, so it is turned into ECI first
                // (the world matrix is a pure rotation, so its transpose undoes it). Without that the
                // ring slid the wrong way, missing chase most when chase was far along the line of
                // sight, such as at the front and back of an NMC.
                bg.chaseOrbit.position.copy(bg.holder.position);
                if (chase.visible) {
                    const f = bgFwd.copy(bg.camera.position).normalize().negate();
                    const v = bgLat.copy(chase.position).divideScalar(RE);
                    const along = v.dot(f);
                    v.addScaledVector(f, -along).multiplyScalar(along / D);
                    v.applyMatrix4(bgToEci.copy(bg.world.matrix).transpose());
                    bg.chaseOrbit.position.add(v);
                }
                // A camera set back below Earth's surface (a big box seen from below at LEO) would be
                // inside the globe: leave Earth out then rather than draw it inside out.
                const pc = bg.camera.position;
                const inside = Math.hypot(pc.x, pc.y, pc.z + orbitR) < 1.04;
                bg.holder.visible = !inside;
                bg.stars.follow(bg.camera);
                renderer.autoClear = false;
                renderer.clear();
                bg.orbit.setResolution(w, h); bg.chaseOrbit.setResolution(w, h);
                renderer.render(bg.scene, bg.camera);
                renderer.clearDepth();
                renderer.render(scene, camera);
                renderInset();
                renderer.autoClear = true;
            } else {
                if (insetEl) insetEl.style.display = 'none';
                renderer.render(scene, camera);
            }
        }

        function animate(now) {
            if (!turn) return;
            const f = Math.min(1, (now - turn.start) / 400);
            const ease = f * f * (3 - 2 * f);
            view.az = turn.az0 + turn.dAz * ease;
            view.el = turn.el0 + (turn.el1 - turn.el0) * ease;
            render();
            if (f < 1) requestAnimationFrame(animate); else turn = null;
        }

        function setView(name, instant) {
            const goal = BOX_VIEWS[name] || BOX_VIEWS['3d'];
            const dAz = ((goal.az - view.az + 540) % 360) - 180;          // the short way around
            if (instant) { view.az += dAz; view.el = goal.el; turn = null; render(); return; }
            turn = { start: performance.now(), az0: view.az, dAz, el0: view.el, el1: goal.el };
            requestAnimationFrame(animate);
        }

        // Drag to turn, wheel or pinch to zoom. No panning.
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        const pointers = new Map();
        let pinch = null;
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            turn = null;
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
            }
        });
        canvas.addEventListener('pointermove', e => {
            const last = pointers.get(e.pointerId);
            if (!last) return;
            if (pointers.size === 1) {
                view.az -= (e.clientX - last.x) * 0.5;
                view.el = Math.max(-89.9, Math.min(89.9, view.el + (e.clientY - last.y) * 0.5));
            }
            last.x = e.clientX; last.y = e.clientY;
            if (pointers.size === 2 && pinch && pinch.d > 0) {
                const [a, b] = [...pointers.values()];
                zoom = Math.max(0.5, Math.min(4, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
            }
            render();
        });
        const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.001)));
            render();
        }, { passive: false });
        buildTicks();

        return {
            resize(width, height) {
                w = Math.max(1, width); h = Math.max(1, height);
                renderer.setSize(w, h, false);
                canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
                render();
            },
            setExtent(halfWidthKm) {
                const next = Math.max(halfWidthKm, 1e-6);
                if (Math.abs(next - half) > 1e-12 * next) { half = next; frame.scale.setScalar(half); buildTicks(); }
                render();
            },
            view: () => ({ az: view.az, el: view.el }),
            setView,
            setShadows(on) { shadows = !!on; shadowLines.forEach(l => { l.visible = shadows && l.visible; }); render(); },
            resetView() { zoom = 1; setView('3d', true); },
            // Earth and stars behind the box (on by default). They need basis, rT, and t in update().
            setBackdrop(on) { if (backdropOn !== !!on) { backdropOn = !!on; render(); } },
            // The zoomed-out Earth inset (off by default); it shows only with the backdrop on.
            setInset(on) { if (insetOn !== !!on) { insetOn = !!on; render(); } },
            // The target's and chase's orbits traced through the backdrop (on by default); they need
            // targetCoe and chaseRv ({ r, v } in ECI, km and km/s) in update().
            setOrbit(on) { if (orbitOn !== !!on) { orbitOn = !!on; if (bg) { bg.orbit.visible = orbitOn && bg.orbit.userData.ready; bg.chaseOrbit.visible = orbitOn && bg.chaseOrbit.userData.ready; } render(); } },
            chaseOrbitShown: () => !!(bg && bg.chaseOrbit.visible),
            orbitShown: () => !!(bg && bg.orbit.visible),
            hasBackdrop: () => !!(bg && backdropOn && haveBasis),
            // For tests: where an ECI-relative point (km from the target, in box axes) lands in the backdrop.
            backdropToScreen(xyzKm) {
                if (!bg) return null;
                const RE = window.RpoMath.RE;
                const v = new THREE.Vector3(xyzKm[0] / RE, xyzKm[1] / RE, xyzKm[2] / RE).project(bg.camera);
                return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z];
            },
            // For tests: where the chase ring's point at chase (its first sample, slid with the ring) lands.
            chaseTraceToScreen() {
                if (!bg) return null;
                const RE = window.RpoMath.RE;
                // The slide is in the world group's ECI axes; the world matrix turns it into box axes.
                const slide = bg.chaseOrbit.position.clone().sub(bg.holder.position).applyMatrix4(bg.world.matrix);
                const v = chase.position.clone().divideScalar(RE).add(slide).project(bg.camera);
                return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
            },
            backdropEarthShown: () => !!(bg && bg.holder.visible),
            insetShown: () => !!(insetEl && insetEl.style.display !== 'none'),
            // chase: [x, y, z]; trail, ghost (the whole path, drawn faintly), model, and nmcLoop (the
            // NMC chase is on now, dotted): paths in RIC km.
            // basis ({R, I, C} unit vectors in ECI), rT (the target's ECI position in km), and t (s)
            // place Earth and the stars behind the box.
            update(data) {
                setBackdropFrame(data.basis, data.rT, data.t);
                setOrbit(data.targetCoe && data.basis && data.basis.v && data.rT ? { r: data.rT, v: data.basis.v } : null);
                setChaseOrbit(data.chaseRv || null);
                fill(ghostLine, data.ghost || null, null);
                fill(trailLine, data.trail, null);
                fill(modelLine, data.model, null);
                fill(nmcLine, data.nmcLoop || null, null);
                nmcLine.material.dashSize = half / 80; nmcLine.material.gapSize = half / 35;
                // Walls: C = -half is the view from the left; I = +half the view from behind; R = -half the view from above.
                // The shadows are of the whole path when it is given, as the flat panes show it.
                const shade = shadows ? (data.ghost || data.trail) : null;
                fill(shadowLines[0], shade, [1, -half]);
                fill(shadowLines[1], shade, [0, half]);
                fill(shadowLines[2], shade, [2, -half]);
                chase.visible = !!data.chase;
                if (data.chase) chase.position.set(data.chase[1], data.chase[2], data.chase[0]);
                render();
            },
            // For tests: where a RIC point lands on screen, in CSS pixels.
            toScreen(rho) {
                const v = new THREE.Vector3(rho[1], rho[2], rho[0]).project(camera);
                return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
            }
        };
    }

    // ---------- the inertial pane ----------

    // The target's position and RIC axes at each time, to go with a sampled relative path.
    // Returns { times, rho, rT, R, I, C, maxRho, box }: Float64Arrays of triples in km, plus the
    // largest |rho| and the RIC bounding box of the path (unpadded), for magnification and drawing.
    function framePath(targetCoe, times, rho) {
        const M = window.RpoMath;
        const count = times.length;
        const rT = new Float64Array(count * 3), R = new Float64Array(count * 3);
        const I = new Float64Array(count * 3), C = new Float64Array(count * 3);
        let maxRho = 0;
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < count; k++) {
            const b = M.ricBasis(targetCoe, times[k]);
            for (let a = 0; a < 3; a++) {
                rT[3 * k + a] = b.r[a]; R[3 * k + a] = b.R[a]; I[3 * k + a] = b.I[a]; C[3 * k + a] = b.C[a];
                const v = rho[3 * k + a];
                if (v < min[a]) min[a] = v;
                if (v > max[a]) max[a] = v;
            }
            maxRho = Math.max(maxRho, Math.hypot(rho[3 * k], rho[3 * k + 1], rho[3 * k + 2]));
        }
        if (!count) { min.fill(0); max.fill(0); }
        return { times, rho, rT, R, I, C, maxRho, box: { min, max } };
    }

    // The 3D view of Earth with both spacecraft (section 5.10 of the build notes). One motion
    // drives it: the page passes the same rho(t) the RIC panes draw. Positions are in km and
    // the scene unit is Earth's radius. Only the offset from the target is ever magnified.
    function createInertialView(THREE, canvas, options) {
        const M = window.RpoMath, Kit = window.ToolKit;
        options = options || {};
        const RE = M.RE;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
        renderer.setClearColor(0x03060c);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, 1, 1e-5, 5000);
        camera.up.set(0, 0, 1);
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const sun = new THREE.DirectionalLight(0xffffff, 2.1);
        sun.position.set(6, 2, 5);
        scene.add(sun);
        const earth = window.EarthScene.addEarth(THREE, renderer, scene);
        const stars = window.EarthScene.addStars(THREE, scene);

        const s = {
            target: null, chaseOrbit: null, frame: 'ECI', cam: 'earth', mag: 'auto',
            trails: { inertial: true, carried: true }, extras: { axes: false, equator: false, orbits: true },
            labels: true, path: null, t: 0, from: 0, to: -1, rFar: M.GEO_A
        };
        const camView = { az: -60, el: 24, dist: 24 };
        let ride = 1;                        // zoom factor for the ride-along camera
        let w = 300, h = 150;

        function spriteMarker(draw) {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            draw(c.getContext('2d'), 64);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: new THREE.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true
            }));
            sprite.renderOrder = 20;
            return sprite;
        }
        const targetMark = spriteMarker((g, z) => { g.fillStyle = COLORS.target; g.fillRect(z * 0.2, z * 0.2, z * 0.6, z * 0.6); });
        const chaseMark = spriteMarker((g, z) => {
            g.fillStyle = COLORS.chase; g.beginPath();
            g.moveTo(z / 2, z * 0.12); g.lineTo(z * 0.9, z * 0.85); g.lineTo(z * 0.1, z * 0.85); g.closePath(); g.fill();
        });
        scene.add(targetMark, chaseMark);

        function makeLine(color, opacity, loop) {
            const line = new (loop ? THREE.LineLoop : THREE.Line)(new THREE.BufferGeometry(),
                new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
            line.frustumCulled = false;
            scene.add(line);
            return line;
        }
        // The orbit traces (rings, trails, ghosts) are drawn a few pixels wide.
        const fatLines = [];
        function makeTrace(color, opacity, loop, widthPx) {
            const line = createFatLine(THREE, color, opacity, loop, widthPx);
            scene.add(line);
            fatLines.push(line);
            return line;
        }
        function renderScene() {
            fatLines.forEach(l => l.setResolution(w, h));
            renderer.render(scene, camera);
        }
        function setPoints(line, arr, count) {
            if (line.setPoints) { line.setPoints(arr, count); line.visible = count > 1; return; }
            if (!line.geometry.attributes.position || line.geometry.attributes.position.array.length < arr.length) {
                line.geometry.dispose();
                line.geometry = new THREE.BufferGeometry();
                line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(arr.length, 3)), 3));
            }
            const pos = line.geometry.attributes.position;
            pos.array.set(arr.subarray ? arr.subarray(0, count * 3) : arr.slice(0, count * 3));
            pos.needsUpdate = true;
            line.geometry.setDrawRange(0, count);
            line.visible = count > 1;
        }
        const targetRing = makeTrace(COLORS.target, 0.55, true, 2);
        const chaseRing = makeTrace(COLORS.chase, 0.45, true, 2);
        const inertialGhost = makeTrace(COLORS.chase, 0.3, false, 2);
        const carriedGhost = makeTrace(COLORS.ric, 0.3, false, 2);
        const inertialTrail = makeTrace(COLORS.chase, 0.95, false, 2.5);
        const carriedTrail = makeTrace(COLORS.ric, 0.95, false, 2.5);
        let trailBuf = new Float32Array(3), carriedBuf = new Float32Array(3);
        let ghostBuf = new Float32Array(3), carriedGhostBuf = new Float32Array(3);

        // The translucent rectangle in the R-I plane that the carried trail is drawn on.
        const plate = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
            color: COLORS.ric, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false
        }));
        plate.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
        plate.geometry.setIndex([0, 1, 2, 0, 2, 3]);
        plate.frustumCulled = false;
        scene.add(plate);
        const plateEdge = makeLine(COLORS.ric, 0.35, true);

        // The RIC triad on the target; its length is set each frame so it keeps one size on screen.
        const triad = ['R', 'I', 'C'].map(() => {
            const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, COLORS.ric, 0.25, 0.12);
            a.line.material.depthTest = false; a.cone.material.depthTest = false;
            a.renderOrder = 15;
            scene.add(a);
            return a;
        });

        // ECI axes from Earth's center. They never turn with Earth's texture.
        const eciAxes = new THREE.Group();
        const eciDirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        eciDirs.forEach(d => eciAxes.add(new THREE.ArrowHelper(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(), 1, 0x60a5fa, 0.06, 0.03)));
        scene.add(eciAxes);
        const equator = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({
            color: 0x60a5fa, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false
        }));
        scene.add(equator);

        // Distance rings in the equatorial plane, centered on Earth, in place of a scale bar (a bar
        // is true at only one depth in a perspective view). The step is the largest of 1,000,
        // 2,000, 5,000, 10,000, or 20,000 km that still gives three rings outside Earth, out to
        // 1.2 times the farthest orbit radius. Rings inside Earth are not drawn.
        const RING_MAX = 8;
        const ringCircle = new THREE.BufferGeometry().setFromPoints(
            Array.from({ length: 192 }, (_, j) => new THREE.Vector3(Math.cos(2 * Math.PI * j / 192), Math.sin(2 * Math.PI * j / 192), 0)));
        const distRings = Array.from({ length: RING_MAX }, () => {
            const ring = new THREE.LineLoop(ringCircle, new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.32 }));
            ring.visible = false;
            scene.add(ring);
            return ring;
        });
        let ringRadii = [];
        function buildDistRings() {
            const outer = 1.2 * s.rFar, inner = 1.02 * RE;
            const radii = step => { const out = []; for (let r = step; r <= outer && out.length < RING_MAX; r += step) if (r > inner) out.push(r); return out; };
            const steps = [20000, 10000, 5000, 2000, 1000];
            const step = steps.find(st => radii(st).length >= 3) || steps[steps.length - 1];
            ringRadii = radii(step);
            distRings.forEach((ring, j) => {
                ring.visible = j < ringRadii.length;
                if (ring.visible) ring.scale.setScalar(ringRadii[j] / RE);
            });
        }

        const layer = options.labels && Kit ? new Kit.LabelLayer(options.labels) : null;
        const triadLabels = layer ? ['R', 'I', 'C'].map(n => layer.add('<b style="color:#f87171">' + n + '</b>', { rank: 1 })) : [];
        const eciLabels = layer ? ['Î', 'Ĵ', 'K̂'].map(n => layer.add('<b style="color:#60a5fa">' + n + '</b>', { rank: 2, optional: true })) : [];

        // ---------- frames and magnification ----------
        function isGeo() { return s.target && Math.abs(s.target.a - M.GEO_A) < 1 && s.target.i < 0.01 && s.target.e < 1e-6; }
        function theta(t) {
            if (s.frame !== 'ECEF') return 0;
            return isGeo() ? M.meanMotion(s.target.a) * t : M.OMEGA_E * t;
        }
        function magnification() {
            if (s.mag !== 'auto') return Math.max(1, s.mag);
            return autoMagnification();
        }
        function autoMagnification() {
            if (!s.path || !s.target || s.path.maxRho < 1e-9) return 1;
            // The largest offset is drawn at 30 percent of the orbit radius, so the motion is easy to see.
            let k = 0.3 * s.target.a / s.path.maxRho;
            // Keep the magnified path clear of Earth: its lowest point, the target's perigee radius plus
            // k times the most negative R, stays at or above 1.06 Earth radii (just outside the
            // atmosphere shell). This matters for low orbits, where 30 percent of a is more than the altitude.
            const down = -s.path.box.min[0];
            if (down > 1e-9) k = Math.min(k, (s.target.a * (1 - s.target.e) - 1.06 * RE) / down);
            return Math.max(1, k);
        }
        // Rotate (x, y) by -th about Z, scale km to scene units, write into out at index k.
        function put(out, k, x, y, z, th) {
            const c = Math.cos(th), sn = Math.sin(th);
            out[3 * k] = (c * x + sn * y) / RE;
            out[3 * k + 1] = (-sn * x + c * y) / RE;
            out[3 * k + 2] = z / RE;
        }
        function ringPoints(coe) {
            const out = new Float32Array(360 * 3);
            for (let k = 0; k < 360; k++) {
                const r = M.coesToRv({ a: coe.a, e: coe.e, i: coe.i, raan: coe.raan, argp: coe.argp, nu: k }).r;
                put(out, k, r[0], r[1], r[2], 0);
            }
            return out;
        }
        function apogee(coe) { return coe ? coe.a * (1 + coe.e) : 0; }
        function refreshFar() {
            s.rFar = Math.max(apogee(s.target), s.mag === 1 ? apogee(s.chaseOrbit) : 0, RE * 1.2);
            eciAxes.scale.setScalar(1.25 * s.rFar / RE);
            equator.scale.setScalar(1.25 * s.rFar / RE);
            buildDistRings();
        }

        // ---------- camera ----------
        function homeDist() { return 3.6 * s.rFar / RE; }
        const tmp = new THREE.Vector3(), tPos = new THREE.Vector3();
        const basisNow = { R: new THREE.Vector3(), I: new THREE.Vector3(), C: new THREE.Vector3() };
        function updateCamera() {
            if (s.cam === 'ride') {
                const k = magnification();
                const reach = Math.max(k * (s.path ? s.path.maxRho : 0) / RE, 0.02);
                const d = 3.2 * reach / ride;
                tmp.set(0, 0, 0).addScaledVector(basisNow.R, 0.35).addScaledVector(basisNow.I, -0.25).addScaledVector(basisNow.C, 0.9).normalize();
                camera.position.copy(tPos).addScaledVector(tmp, d);
                camera.up.copy(basisNow.R);
                camera.lookAt(tPos);
            } else {
                const fit = Math.min(1, (w / h) * 0.85);
                const d = camView.dist / fit;
                const el = camView.el * Math.PI / 180, az = camView.az * Math.PI / 180;
                camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
                camera.up.set(0, 0, 1);
                camera.lookAt(0, 0, 0);
            }
            camera.updateMatrixWorld();
        }

        // Labels are hidden when Earth blocks the line of sight.
        const projected = new THREE.Vector3(), toPoint = new THREE.Vector3();
        function blocked(point) {
            toPoint.copy(point).sub(camera.position);
            const dist = toPoint.length();
            toPoint.divideScalar(dist);
            const along = -camera.position.dot(toPoint);
            const off = camera.position.lengthSq() - along * along;
            if (off >= 1) return false;
            const entry = along - Math.sqrt(1 - off);
            return entry > 0 && entry < dist;
        }
        function showLabel(label, point) {
            if (blocked(point)) return;
            projected.copy(point).project(camera);
            if (projected.z < -1 || projected.z > 1) return;
            layer.show(label, (projected.x + 1) * 0.5 * w, (1 - projected.y) * 0.5 * h);
        }

        // ---------- drawing ----------
        function markerScale(px) { return px / h * 2 * Math.tan(camera.fov * Math.PI / 360); }

        function render(data) {
            if (data) {
                s.t = data.t;
                if (data.from !== undefined) { s.from = data.from; s.to = data.to; }
                s.ghost = !!data.ghost;
                s.now = data;
            }
            const now = s.now;
            if (!now || !s.target) { updateCamera(); stars.follow(camera); renderScene(); return; }
            const k = magnification();
            const th = theta(s.t);
            const b = now.basis, rT = now.rT || b.r, rho = now.rho;
            // The target, its RIC axes, and chase, all at this instant.
            const tmpA = [0, 0, 0];
            put(tmpA, 0, rT[0], rT[1], rT[2], th); tPos.set(tmpA[0], tmpA[1], tmpA[2]);
            // put() scales km to scene units (÷ R_E); the axes must be unit vectors again, because
            // ArrowHelper.setDirection and the label offsets assume length 1.
            ['R', 'I', 'C'].forEach(n => { put(tmpA, 0, b[n][0], b[n][1], b[n][2], th); basisNow[n].set(tmpA[0], tmpA[1], tmpA[2]).normalize(); });
            const off = [rho[0] * k, rho[1] * k, rho[2] * k];
            const cx = rT[0] + off[0] * b.R[0] + off[1] * b.I[0] + off[2] * b.C[0];
            const cy = rT[1] + off[0] * b.R[1] + off[1] * b.I[1] + off[2] * b.C[1];
            const cz = rT[2] + off[0] * b.R[2] + off[1] * b.I[2] + off[2] * b.C[2];
            put(tmpA, 0, cx, cy, cz, th);
            targetMark.position.copy(tPos);
            chaseMark.position.set(tmpA[0], tmpA[1], tmpA[2]);

            // Earth turns in ECI; in ECEF it is the frame, so it stays put.
            earth.pivot.rotation.z = s.frame === 'ECI' ? M.OMEGA_E * s.t : 0;
            eciAxes.visible = s.extras.axes;
            eciAxes.rotation.z = -th;
            equator.visible = s.extras.equator;
            targetRing.visible = s.frame === 'ECI' && s.extras.orbits;
            chaseRing.visible = s.frame === 'ECI' && s.extras.orbits && !!s.chaseOrbit && k === 1;

            const P = s.path;
            const from = Math.max(0, s.from), to = Math.min(P ? P.times.length - 1 : -1, s.to);
            const count = P && to >= from ? to - from + 1 : 0;
            // Chase's own path around Earth (magnified offsets keep it a valid orbit shape), samples from..from+n-1.
            function inertialPoints(buf, from, n) {
                if (buf.length < n * 3) buf = new Float32Array(n * 3);
                for (let j = 0; j < n; j++) {
                    const q = from + j, a = 3 * q;
                    const x = P.rho[a] * k, y = P.rho[a + 1] * k, z = P.rho[a + 2] * k;
                    put(buf, j,
                        P.rT[a] + x * P.R[a] + y * P.I[a] + z * P.C[a],
                        P.rT[a + 1] + x * P.R[a + 1] + y * P.I[a + 1] + z * P.C[a + 1],
                        P.rT[a + 2] + x * P.R[a + 2] + y * P.I[a + 2] + z * P.C[a + 2], theta(P.times[q]));
                }
                return buf;
            }
            // The RIC picture, drawn with this instant's axes where the target is now.
            function carriedPoints(buf, from, n) {
                if (buf.length < n * 3) buf = new Float32Array(n * 3);
                for (let j = 0; j < n; j++) {
                    const a = 3 * (from + j);
                    const x = P.rho[a] * k, y = P.rho[a + 1] * k, z = P.rho[a + 2] * k;
                    put(buf, j, rT[0] + x * b.R[0] + y * b.I[0] + z * b.C[0],
                        rT[1] + x * b.R[1] + y * b.I[1] + z * b.C[1], rT[2] + x * b.R[2] + y * b.I[2] + z * b.C[2], th);
                }
                return buf;
            }
            const all = P ? P.times.length : 0;
            const ghost = s.ghost && all > 1;
            if (s.trails.inertial && count > 1) { trailBuf = inertialPoints(trailBuf, from, count); setPoints(inertialTrail, trailBuf, count); }
            else inertialTrail.visible = false;
            if (s.trails.inertial && ghost) { ghostBuf = inertialPoints(ghostBuf, 0, all); setPoints(inertialGhost, ghostBuf, all); }
            else inertialGhost.visible = false;
            const carried = s.trails.carried && P && k > 1;
            if (carried && count > 1) { carriedBuf = carriedPoints(carriedBuf, from, count); setPoints(carriedTrail, carriedBuf, count); }
            else carriedTrail.visible = false;
            if (carried && ghost) { carriedGhostBuf = carriedPoints(carriedGhostBuf, 0, all); setPoints(carriedGhost, carriedGhostBuf, all); }
            else carriedGhost.visible = false;
            plate.visible = plateEdge.visible = !!carried && P.maxRho > 1e-9;
            if (plate.visible) {
                const bx = P.box, pad = 0.12;
                const r0 = bx.min[0] - pad * (bx.max[0] - bx.min[0]) - 0.02 * P.maxRho, r1 = bx.max[0] + pad * (bx.max[0] - bx.min[0]) + 0.02 * P.maxRho;
                const i0 = bx.min[1] - pad * (bx.max[1] - bx.min[1]) - 0.02 * P.maxRho, i1 = bx.max[1] + pad * (bx.max[1] - bx.min[1]) + 0.02 * P.maxRho;
                const corners = [[Math.min(r0, 0), Math.min(i0, 0)], [Math.max(r1, 0), Math.min(i0, 0)], [Math.max(r1, 0), Math.max(i1, 0)], [Math.min(r0, 0), Math.max(i1, 0)]];
                const arr = plate.geometry.attributes.position.array;
                corners.forEach((c, j) => put(arr, j,
                    rT[0] + k * (c[0] * b.R[0] + c[1] * b.I[0]), rT[1] + k * (c[0] * b.R[1] + c[1] * b.I[1]),
                    rT[2] + k * (c[0] * b.R[2] + c[1] * b.I[2]), th));
                plate.geometry.attributes.position.needsUpdate = true;
                setPoints(plateEdge, arr, 4);
            }

            updateCamera();
            const camDist = camera.position.distanceTo(tPos);
            const len = camDist * 0.09;
            triad.forEach((arrow, j) => {
                const dir = basisNow[['R', 'I', 'C'][j]];
                arrow.position.copy(tPos);
                arrow.setDirection(dir);
                arrow.setLength(len, len * 0.22, len * 0.11);
            });
            targetMark.scale.setScalar(markerScale(13));
            chaseMark.scale.setScalar(markerScale(15));
            stars.follow(camera);
            renderScene();

            if (layer) {
                layer.begin();
                if (s.labels) {
                    triad.forEach((arrow, j) => showLabel(triadLabels[j], tmp.copy(tPos).addScaledVector(basisNow[['R', 'I', 'C'][j]], len * 1.15)));
                    if (s.extras.axes) eciDirs.forEach((d, j) => {
                        const L = 1.3 * s.rFar / RE, c = Math.cos(-th), sn = Math.sin(-th);
                        showLabel(eciLabels[j], tmp.set((c * d[0] - sn * d[1]) * L, (sn * d[0] + c * d[1]) * L, d[2] * L));
                    });
                }
                layer.place(w, h, options.avoid ? options.avoid() : []);
            }
            if (options.scaleLabel) options.scaleLabel.textContent = k === 1 ? 'True scale' : 'Offsets magnified ' + formatMag(k) + '×';
        }
        function formatMag(k) {
            if (k >= 1000) return Math.round(k).toLocaleString('en-US');
            return k >= 10 ? String(Math.round(k)) : k.toFixed(1);
        }

        // Drag to turn, wheel or pinch to zoom (Earth camera); wheel or pinch zooms the ride-along camera.
        canvas.style.touchAction = 'none';
        canvas.style.cursor = 'grab';
        const pointers = new Map();
        let pinch = null;
        const clampDist = d => Math.min(8 * s.rFar / RE, Math.max(1.5 * s.rFar / RE, d));
        function zoomBy(f) {
            if (s.cam === 'ride') ride = Math.min(20, Math.max(0.2, ride / f));
            else camView.dist = clampDist(camView.dist * f);
            render();
        }
        canvas.addEventListener('pointerdown', e => {
            canvas.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: camView.dist, ride };
            }
            if (options.onInteract) options.onInteract();
        });
        canvas.addEventListener('pointermove', e => {
            const last = pointers.get(e.pointerId);
            if (!last) return;
            if (pointers.size === 1 && s.cam === 'earth') {
                camView.az -= (e.clientX - last.x) * 0.35;
                camView.el = Math.min(86, Math.max(-86, camView.el + (e.clientY - last.y) * 0.3));
            }
            last.x = e.clientX; last.y = e.clientY;
            if (pointers.size === 2 && pinch && pinch.d > 0) {
                const [a, b] = [...pointers.values()];
                const f = pinch.d / Math.hypot(a.x - b.x, a.y - b.y);
                if (s.cam === 'ride') ride = Math.min(20, Math.max(0.2, pinch.ride / f));
                else camView.dist = clampDist(pinch.dist * f);
            }
            render();
        });
        const endPointer = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('wheel', e => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

        function resetView() {
            camView.az = -60; camView.el = 24; camView.dist = homeDist(); ride = 1;
            render();
        }

        return {
            setOrbit(coe) {
                s.target = coe;
                setPoints(targetRing, ringPoints(coe), 360);
                refreshFar();
                camView.dist = clampDist(camView.dist);
            },
            setChaseOrbit(coe) {
                s.chaseOrbit = coe || null;
                if (coe) setPoints(chaseRing, ringPoints(coe), 360);
                refreshFar();
            },
            setFrame(f) { s.frame = f === 'ECEF' ? 'ECEF' : 'ECI'; },
            setCamera(c) { s.cam = c === 'ride' ? 'ride' : 'earth'; },
            setMagnification(k) { s.mag = k === 'auto' ? 'auto' : Math.max(1, Number(k) || 1); refreshFar(); },
            magnification, autoMagnification,
            // For checks in the browser console: the camera, the RIC triad arrows, and the target's place.
            debug: () => ({ camera, triad, basisNow, tPos, earth }),
            setTrails(t) { Object.assign(s.trails, t); },
            setExtras(x) { Object.assign(s.extras, x); },
            setLabels(on) { s.labels = !!on; },
            setPath(path) { s.path = path; },
            update: render,
            redraw() { render(); },
            resize(width, height) {
                w = Math.max(1, width); h = Math.max(1, height);
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
                if (layer) layer.remeasure();
                render();
            },
            resetView,
            homeDistance: homeDist,
            // For checks: where a point in scene units lands on screen.
            toScreen(v) { const p = new THREE.Vector3(v[0], v[1], v[2]).project(camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; },
            markers: () => ({ target: targetMark.position.toArray(), chase: chaseMark.position.toArray() })
        };
    }

    // ---------- stages ----------

    function paneHtml(cls, badge, extra) {
        return '<div class="rpo-pane ' + cls + '"><canvas></canvas><div class="tool-labels"></div>' +
            (badge ? '<div class="rpo-badge ' + badge[0] + '">' + badge[1] + '</div>' : '') + (extra || '') + '</div>';
    }
    function segmentedHtml(cls, label, items) {
        return '<div class="' + cls + ' segmented" role="group" aria-label="' + label + '">' +
            items.map((it, k) => '<button type="button" data-value="' + it[0] + '" aria-pressed="' + (k === 0) + '">' + it[1] + '</button>').join('') + '</div>';
    }
    function selectIn(group, value) {
        group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === value)));
    }
    function watch(el, fn) {
        if (window.ToolKit) window.ToolKit.observeSize(el, fn);
        else fn(el.clientWidth, el.clientHeight);
    }
    function inertialPane(THREE, el) {
        const canvas = el.querySelector('canvas');
        const status = el.querySelector('.tool-status');
        if (!THREE) {
            status.style.display = 'flex';
            status.textContent = 'The 3D view could not be loaded. It needs an internet connection the first time it opens. The RIC views still work.';
            return null;
        }
        try {
            return createInertialView(THREE, canvas, {
                labels: el.querySelector('.tool-labels'),
                scaleLabel: el.querySelector('.rpo-scale'),
                avoid: () => [el.querySelector('.rpo-badge'), el.querySelector('.rpo-scale')].filter(Boolean).map(o => window.ToolKit.overlayBox(o, el))
            });
        } catch (err) {
            status.style.display = 'flex';
            status.textContent = 'This browser could not start the 3D view. WebGL must be enabled for it.';
            return null;
        }
    }
    const INERTIAL_EXTRA = '<div class="rpo-scale"></div><div class="tool-status" style="display: none;"></div>';

    // Tool 1's stage: the inertial pane, the 3D RIC box, and the three flat views.
    // options: { THREE (or null), onResize(name) }. Pane builders own their own drawing.
    function createFiveViewStage(container, options) {
        options = options || {};
        container.classList.add('rpo-host');
        const root = document.createElement('div');
        root.className = 'rpo-stage rpo-five';
        root.dataset.show = 'left';
        root.innerHTML =
            paneHtml('rpo-inertial', ['eci', 'ECI'], INERTIAL_EXTRA) +
            '<div class="rpo-ricside">' +
                paneHtml('rpo-box', ['ric', 'RIC · 3D'], segmentedHtml('rpo-viewbuttons', 'Turn the 3D box', [['3d', '3D'], ['left', 'Left'], ['behind', 'Behind'], ['above', 'Above']]) + '<div class="tool-status" style="display: none;"></div>') +
                '<div class="rpo-planes">' + paneHtml('rpo-left') + paneHtml('rpo-behind') + paneHtml('rpo-above') + '</div>' +
            '</div>' +
            segmentedHtml('rpo-switch', 'Choose the RIC view', [['3d', '3D'], ['left', 'Left'], ['behind', 'Behind'], ['above', 'Above']]);
        container.appendChild(root);
        const el = name => root.querySelector('.rpo-' + name);

        const stage = { root };
        ['left', 'behind', 'above'].forEach(name => { stage[name] = createRicPlane(el(name).querySelector('canvas'), { plane: name }); });
        stage.planes = [stage.left, stage.behind, stage.above];
        stage.inertial = inertialPane(options.THREE, el('inertial'));
        stage.box = null;
        if (options.THREE) {
            try { stage.box = createRicBox(options.THREE, el('box').querySelector('canvas')); } catch (err) { stage.box = null; }
        }
        if (!stage.box) {
            const st = el('box').querySelector('.tool-status');
            st.style.display = 'flex';
            st.textContent = 'The 3D box needs the 3D library, which did not load.';
        }
        const buttons = root.querySelector('.rpo-viewbuttons');
        buttons.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b || !stage.box) return;
            selectIn(buttons, b.dataset.value);
            stage.box.setView(b.dataset.value);
        });
        const sw = root.querySelector('.rpo-switch');
        sw.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            stage.setLayout(b.dataset.value);
        });
        stage.setLayout = value => { root.dataset.show = value; selectIn(sw, value); };
        stage.selectBoxView = value => { selectIn(buttons, value); if (stage.box) stage.box.setView(value); };
        stage.setBadge = text => {
            const badge = el('inertial').querySelector('.rpo-badge');
            badge.textContent = text;
            badge.className = 'rpo-badge ' + (text === 'ECEF' ? 'ecef' : 'eci');
        };
        // Flat panes that are on screen now (a hidden pane must not shrink the shared scale).
        stage.visiblePlanes = () => ['left', 'behind', 'above'].filter(n => el(n).clientWidth > 2 && el(n).clientHeight > 2).map(n => stage[n]);
        stage.boxVisible = () => el('box').clientWidth > 2 && el('box').clientHeight > 2;
        stage.isSmall = () => getComputedStyle(sw).display !== 'none';

        ['left', 'behind', 'above'].forEach(name => watch(el(name), (wd, ht) => { stage[name].resize(wd, ht); if (options.onResize) options.onResize(name); }));
        watch(el('box'), (wd, ht) => { if (stage.box) stage.box.resize(wd, ht); if (options.onResize) options.onResize('box'); });
        watch(el('inertial'), (wd, ht) => { if (stage.inertial) stage.inertial.resize(wd, ht); if (options.onResize) options.onResize('inertial'); });
        return stage;
    }

    // The standard stage for Tools 2 to 4 and the practice page: the view from the left, a second
    // RIC pane (behind, above, or the 3D box), and the inertial pane.
    // options: { THREE, second: 'behind' | 'above' | 'box', inertial: true, onResize(name) }.
    function createDualStage(container, options) {
        options = options || {};
        container.classList.add('rpo-host');
        const root = document.createElement('div');
        root.className = 'rpo-stage rpo-dual' + (options.inertial === false ? ' rpo-noinertial' : '');
        root.dataset.show = 'left';
        root.innerHTML =
            '<div class="rpo-ric">' +
                paneHtml('rpo-left') +
                '<div class="rpo-pane rpo-second"><canvas class="c2d"></canvas><canvas class="c3d rpo-hidden"></canvas><div class="tool-labels"></div>' +
                    '<div class="rpo-badge ric rpo-boxbadge" style="display: none;">RIC · 3D</div>' +
                    segmentedHtml('rpo-viewbuttons', 'Turn the 3D box', [['3d', '3D'], ['left', 'Left'], ['behind', 'Behind'], ['above', 'Above']]) +
                '</div>' +
            '</div>' +
            paneHtml('rpo-inertial', ['eci', 'ECI'], INERTIAL_EXTRA) +
            segmentedHtml('rpo-switch', 'Choose the RIC view', [['left', 'Left'], ['second', 'Behind']]);
        container.appendChild(root);
        const el = name => root.querySelector('.rpo-' + name);
        const second = el('second');
        const c2d = second.querySelector('.c2d'), c3d = second.querySelector('.c3d');
        const buttons = second.querySelector('.rpo-viewbuttons');

        const stage = { root };
        stage.left = createRicPlane(el('left').querySelector('canvas'), { plane: 'left' });
        stage.behind = createRicPlane(c2d, { plane: 'behind' });
        stage.above = createRicPlane(c2d, { plane: 'above' });
        stage.inertial = options.inertial === false ? null : inertialPane(options.THREE, el('inertial'));
        stage.box = null;
        if (options.THREE) { try { stage.box = createRicBox(options.THREE, c3d); } catch (err) { stage.box = null; } }
        let secondName = 'behind';
        stage.second = () => secondName;
        stage.secondPlane = () => (secondName === 'box' ? null : stage[secondName]);
        stage.setSecond = value => {
            secondName = value === 'box' && stage.box ? 'box' : value === 'above' ? 'above' : 'behind';
            const box = secondName === 'box';
            c2d.classList.toggle('rpo-hidden', box);
            c3d.classList.toggle('rpo-hidden', !box);
            buttons.style.display = box ? '' : 'none';
            second.querySelector('.rpo-boxbadge').style.display = box ? '' : 'none';
            root.querySelector('.rpo-switch button[data-value="second"]').textContent = box ? '3D' : secondName === 'above' ? 'Above' : 'Behind';
            resizeSecond();
            if (options.onResize) options.onResize('second');
        };
        buttons.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b || !stage.box) return;
            selectIn(buttons, b.dataset.value);
            stage.box.setView(b.dataset.value);
        });
        const sw = root.querySelector('.rpo-switch');
        sw.addEventListener('click', e => {
            const b = e.target.closest('button');
            if (b) stage.setLayout(b.dataset.value);
        });
        stage.setLayout = value => { root.dataset.show = value; selectIn(sw, value); };
        stage.setBadge = text => {
            const badge = el('inertial').querySelector('.rpo-badge');
            badge.textContent = text;
            badge.className = 'rpo-badge ' + (text === 'ECEF' ? 'ecef' : 'eci');
        };
        stage.visiblePlanes = () => {
            const out = [];
            if (el('left').clientWidth > 2) out.push(stage.left);
            if (second.clientWidth > 2 && secondName !== 'box') out.push(stage[secondName]);
            return out;
        };
        let secondSize = [1, 1];
        function resizeSecond() {
            const [wd, ht] = secondSize;
            if (secondName === 'box') { if (stage.box) stage.box.resize(wd, ht); }
            else stage[secondName].resize(wd, ht);
        }
        watch(el('left'), (wd, ht) => { stage.left.resize(wd, ht); if (options.onResize) options.onResize('left'); });
        watch(second, (wd, ht) => { secondSize = [wd, ht]; resizeSecond(); if (options.onResize) options.onResize('second'); });
        if (stage.inertial) watch(el('inertial'), (wd, ht) => { stage.inertial.resize(wd, ht); if (options.onResize) options.onResize('inertial'); });
        buttons.style.display = 'none';
        stage.setSecond(options.second || 'behind');
        return stage;
    }

    // The Advanced switch (a button.mode-switch in the page). Off, the default, the page shows only
    // the views and the main adjustments: tool-theme.css hides everything marked data-advanced
    // until body has the class advanced-on. The choice is remembered per page in this browser.
    function setupAdvancedSwitch(button) {
        const key = 'otc-advanced:' + location.pathname;
        let on = false;
        try { on = localStorage.getItem(key) === '1'; } catch (e) { /* storage blocked: stay off */ }
        function apply() {
            document.body.classList.toggle('advanced-on', on);
            button.setAttribute('aria-checked', String(on));
        }
        button.setAttribute('role', 'switch');
        button.addEventListener('click', () => {
            on = !on;
            apply();
            try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { /* not remembered */ }
        });
        apply();
    }
    if (typeof document !== 'undefined') document.querySelectorAll('.mode-switch').forEach(setupAdvancedSwitch);

    const RpoViews = {
        COLORS, PLANES, BOX_VIEWS, createRicPlane, createRicBox, boundingBox, fitPanes, drawThumbnail, gridStep, attachPanZoom,
        framePath, createInertialView, createFiveViewStage, createDualStage, setupAdvancedSwitch
    };
    if (typeof window !== 'undefined') window.RpoViews = RpoViews;
    if (typeof module !== 'undefined' && module.exports) module.exports = RpoViews;
})();
