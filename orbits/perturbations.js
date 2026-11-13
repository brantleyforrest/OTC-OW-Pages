// Perturbations Explorer. Each mode shows one perturbation from the lesson "Perturbations & Orbit Types":
// a gray ghost of the two-body orbit, fixed at its starting state, and a colored orbit that actually changes.
//
//     Mode       Lesson goal   What changes              Where it matters
//     Drag       SOB 1         a and e fall              LEO
//     J2         SOB 2         RAAN and perigee turn     LEO to HEO
//     J2,2       SOB 3         GEO longitude swings      GEO
//     3rd Body   SOB 3         GEO inclination grows     GEO
//     SRP        SOB 3         GEO eccentricity cycles   GEO
//
// All physics is in perturbations-model.js. This file only draws it.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const M = window.PerturbationModel;

    const status = $('status');
    function showStatus(text) {
        status.style.display = 'flex';
        status.textContent = text;
    }

    showStatus('Loading the 3D view.');
    let THREE;
    try {
        THREE = await import(THREE_URL);
    } catch (err) {
        showStatus('The 3D library could not be loaded. This tool needs an internet connection the first time it opens.');
        return;
    }

    const D2R = Math.PI / 180;
    const R2D = 180 / Math.PI;
    const TAU = 2 * Math.PI;
    const ZOOM = { min: 3.5, max: 40 };
    const EARTH_SPIN_RATE = 6; // deg per second of animation, decorative

    /* Colors. CSS variables in perturbations.html match these. */
    const COLOR = {
        drag: '#f87171', j2: '#60a5fa', j22: '#fb923c', moon: '#cbd5e1', sun: '#e3b85a', srp: '#facc15',
        central: '#94a3b8', ghost: '#94a3b8', stable: '#34d399', unstable: '#f87171', perigee: '#a78bfa'
    };
    const hex = (css) => new THREE.Color(css);

    /* Global state. Each mode owns the rest. */
    const state = { mode: 'drag', playing: !Kit.prefersReducedMotion(), speed: 1, showLabels: true, earthDeg: 0 };
    const camView = { az: -90, el: 66, dist: 7.5 };
    const blend = { from: null, to: null, t: 1 };

    /* Renderer */
    const view = $('view');
    const canvas = $('scene');
    const hud = $('hud');
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (err) {
        showStatus('This browser could not start the 3D view. WebGL must be enabled to use this tool.');
        return;
    }
    renderer.setClearColor(0x03060c);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
    scene.add(sunLight);

    const SPHERE_RADIUS = 1;
    const earth = window.EarthScene.addEarth(THREE, renderer, scene);
    const stars = window.EarthScene.addStars(THREE, scene);

    // Earth's spin axis
    scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1.4), new THREE.Vector3(0, 0, 1.4)]),
        new THREE.LineBasicMaterial({ color: 0x94a3b8 })
    ));
    const northPoint = new THREE.Vector3(0, 0, 1.4);
    const layer = new Kit.LabelLayer($('labels'));
    const northLabel = layer.add('<b>N</b>', { rank: 4, optional: true });

    /* ===================================================================================== */
    /* Shared helpers                                                                         */
    /* ===================================================================================== */

    // Heights are compressed: true scale would hide LEO against Earth and push HEO off screen.
    const drawRadius = (hKm) => 1 + 1.6 * Math.pow(Math.max(hKm, 0) / M.RE, 0.6);
    const GEO_DRAW = 2.6;

    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const minus = (s) => String(s).replace(/-/g, '−');
    const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
    const sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');
    function sci(x, digits = 3) {
        if (!isFinite(x) || x === 0) return '0';
        let exp = Math.floor(Math.log10(Math.abs(x)));
        let mant = x / Math.pow(10, exp);
        if (Math.abs(Number(mant.toPrecision(digits))) >= 10) { exp += 1; mant /= 10; }
        return `${minus(mant.toPrecision(digits))} × 10${sup(exp)}`;
    }
    // Fixed decimals with a true minus sign, and never "−0.00".
    function fixed(x, d) {
        const text = x.toFixed(d);
        return /^-0\.?0*$/.test(text) ? text.slice(1) : minus(text);
    }
    const signed = (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d);
    const comma = (x, d = 0) => minus(x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
    function formatDuration(days) {
        if (days < 1) return `${Math.round(days * 24)} h`;
        if (days < 10) return `${days.toFixed(1)} days`;
        if (days < 730) return `${Math.round(days)} days`;
        return `${(days / M.YEAR_DAYS).toFixed(1)} yr`;
    }
    function formatLon(deg) {
        const w = M.wrap180(deg);
        if (Math.abs(w) < 0.05 || Math.abs(Math.abs(w) - 180) < 0.05) return `${Math.abs(w).toFixed(1)}°`;
        return `${Math.abs(w).toFixed(1)}° ${w > 0 ? 'E' : 'W'}`;
    }
    const lonName = (deg) => `${Math.abs(deg)}° ${deg >= 0 ? 'E' : 'W'}`;
    const setText = (el, text) => {
        if (el.textContent !== text) el.textContent = text;
    };
    const setHTML = (el, html) => {
        if (el.innerHTML !== html) el.innerHTML = html;
    };
    function setLabel(label, html) {
        if (label.html !== html) {
            label.html = html;
            label.el.innerHTML = html;
            label.width = 0;
        }
    }
    const work = (sym, val) => `<span class="eq-sym">${sym}</span>${val ? `<span class="eq-val">${val}</span>` : ''}`;

    // A closed curve in the XY plane with perigee on +X, set by a function nu -> scene radius.
    class OrbitCurve extends THREE.Curve {
        constructor() {
            super();
            this.radius = () => 1;
            this.arcLengthDivisions = 400;
        }
        getPoint(t, target = new THREE.Vector3()) {
            const nu = TAU * t;
            const r = this.radius(nu);
            return target.set(r * Math.cos(nu), r * Math.sin(nu), 0);
        }
    }

    function makeOrbitRing({ color = '#ffffff', tube = 0.012, opacity = 1, vertexColors = false }) {
        const curve = new OrbitCurve();
        const material = new THREE.MeshBasicMaterial({
            color: vertexColors ? 0xffffff : hex(color),
            vertexColors,
            transparent: opacity < 1,
            opacity,
            depthWrite: opacity >= 1
        });
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        const ring = { mesh, curve, key: '' };
        ring.setShape = (key, radiusAt) => {
            if (key === ring.key) return false;
            ring.key = key;
            curve.radius = radiusAt;
            curve.updateArcLengths();
            mesh.geometry.dispose();
            mesh.geometry = new THREE.TubeGeometry(curve, 240, tube, 6, true);
            return true;
        };
        return ring;
    }

    // RAAN, inclination, and argument of perigee, without rebuilding geometry.
    // Children of inner are in perifocal coordinates.
    function makeOrbitFrame(parent) {
        const outer = new THREE.Group();
        outer.rotation.order = 'ZXY';
        const inner = new THREE.Group();
        outer.add(inner);
        parent.add(outer);
        return {
            outer, inner,
            place(raanDeg, incDeg, argpDeg) {
                outer.rotation.set(incDeg * D2R, 0, raanDeg * D2R);
                inner.rotation.z = argpDeg * D2R;
            }
        };
    }

    const dotGeometry = new THREE.SphereGeometry(1, 18, 12);
    function makeDot(radius, color, parent) {
        const dot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: hex(color) }));
        dot.scale.setScalar(radius);
        parent.add(dot);
        return dot;
    }

    function makeCircle(radius, color, opacity, parent) {
        const points = [];
        for (let i = 0; i < 180; i++) {
            const a = i / 180 * TAU;
            points.push(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
        }
        const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: hex(color), transparent: true, opacity })
        );
        parent.add(line);
        return line;
    }

    function makeArrow(color, parent) {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, hex(color), 0.12, 0.07);
        parent.add(arrow);
        return arrow;
    }
    function setArrowLength(arrow, length) {
        const head = Math.min(0.13, length * 0.45);
        arrow.setLength(length, head, head * 0.6);
    }

    // Satellite position along an ellipse, in perifocal scene coordinates.
    function satellitePoint(target, anomalyDeg, e, radiusAt) {
        const E = M.solveKepler(M.wrap360(anomalyDeg) * D2R, e);
        const nu = M.trueFromEccentric(E, e);
        const r = radiusAt(nu);
        return target.set(r * Math.cos(nu), r * Math.sin(nu), 0);
    }

    /* Charts: a 2D canvas with a cached base layer. */
    const charts = [];
    let chartsReady = false; // Charts draw only once every mode has built its state.
    function makeChart(boxId, canvasId, drawBase, drawLive) {
        const box = $(boxId);
        const el = $(canvasId);
        const ctx = el.getContext('2d');
        const base = document.createElement('canvas');
        const bctx = base.getContext('2d');
        const chart = { w: 1, h: 1, baseDirty: true, el };
        chart.draw = () => {
            if (!chartsReady) return;
            const { w, h } = chart;
            if (chart.baseDirty) {
                bctx.clearRect(0, 0, w, h);
                drawBase(bctx, w, h);
                chart.baseDirty = false;
            }
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(base, 0, 0, w, h);
            drawLive(ctx, w, h);
        };
        Kit.observeSize(box, (w, h) => {
            chart.w = w;
            chart.h = h;
            Kit.fitCanvas2D(el, ctx, w, h);
            Kit.fitCanvas2D(base, bctx, w, h);
            chart.baseDirty = true;
            chart.draw();
        });
        charts.push(chart);
        return chart;
    }

    const CHART_FONT = '11px Inter, sans-serif';
    const CHART_TEXT = '#94a3b8';
    const CHART_GRID = 'rgba(255, 255, 255, 0.08)';

    // A plot area with linear scales. area: { x0, y0, x1, y1 } in pixels.
    function makePlot(area, xMin, xMax, yMin, yMax) {
        return {
            area,
            X: (v) => area.x0 + (v - xMin) / (xMax - xMin) * (area.x1 - area.x0),
            Y: (v) => area.y1 - (v - yMin) / (yMax - yMin) * (area.y1 - area.y0)
        };
    }
    const defaultArea = (w, h) => ({ x0: 46, y0: 10, x1: w - 10, y1: h - 26 });

    function niceStep(range, count) {
        const raw = range / count;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / mag;
        return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    }
    function ticks(min, max, count) {
        const step = niceStep(max - min, count);
        const out = [];
        for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
        return out;
    }

    // Draws grid lines and tick labels. xTicks and yTicks are arrays of { v, label }.
    function drawGrid(g, plot, xTicks, yTicks, { xTitle = '', yTitle = '' } = {}) {
        const a = plot.area;
        g.save();
        g.font = CHART_FONT;
        g.lineWidth = 1;
        g.strokeStyle = CHART_GRID;
        g.fillStyle = CHART_TEXT;
        g.beginPath();
        for (const t of xTicks) {
            const x = Math.round(plot.X(t.v)) + 0.5;
            g.moveTo(x, a.y0);
            g.lineTo(x, a.y1);
        }
        for (const t of yTicks) {
            const y = Math.round(plot.Y(t.v)) + 0.5;
            g.moveTo(a.x0, y);
            g.lineTo(a.x1, y);
        }
        g.stroke();
        g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        g.strokeRect(a.x0 + 0.5, a.y0 + 0.5, a.x1 - a.x0 - 1, a.y1 - a.y0 - 1);
        g.textAlign = 'center';
        g.textBaseline = 'top';
        for (const t of xTicks) if (t.label) g.fillText(t.label, plot.X(t.v), a.y1 + 4);
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        for (const t of yTicks) if (t.label) g.fillText(t.label, a.x0 - 5, plot.Y(t.v));
        if (xTitle) {
            g.textAlign = 'right';
            g.textBaseline = 'bottom';
            g.fillText(xTitle, a.x1, a.y1 + 26);
        }
        if (yTitle) {
            g.textAlign = 'left';
            g.textBaseline = 'top';
            g.fillText(yTitle, a.x0 + 4, a.y0 + 3);
        }
        g.restore();
    }

    function strokePath(g, points, color, width = 1.6, alpha = 1, dash = null) {
        g.save();
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineJoin = 'round';
        if (dash) g.setLineDash(dash);
        g.beginPath();
        points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.stroke();
        g.restore();
    }
    function fillDot(g, x, y, r, color) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
    }
    function drawCross(g, x, y, r, color) {
        g.save();
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
        g.moveTo(x - r, y + r); g.lineTo(x + r, y - r);
        g.stroke();
        g.restore();
    }
    function cursor(g, plot, x) {
        g.save();
        g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(Math.round(x) + 0.5, plot.area.y0);
        g.lineTo(Math.round(x) + 0.5, plot.area.y1);
        g.stroke();
        g.restore();
    }
    function chartText(g, text, x, y, color = CHART_TEXT, align = 'left', baseline = 'top') {
        g.save();
        g.font = CHART_FONT;
        g.fillStyle = color;
        g.textAlign = align;
        g.textBaseline = baseline;
        g.fillText(text, x, y);
        g.restore();
    }

    /* Labels. A label is hidden when Earth blocks the line of sight to its point. */
    let viewW = 1, viewH = 1;
    const projected = new THREE.Vector3();
    const toPoint = new THREE.Vector3();
    const world = new THREE.Vector3();

    function isBlocked(point) {
        toPoint.copy(point).sub(camera.position);
        const distance = toPoint.length();
        toPoint.divideScalar(distance);
        const along = -camera.position.dot(toPoint);
        const offCenter = camera.position.lengthSq() - along * along;
        if (offCenter >= SPHERE_RADIUS * SPHERE_RADIUS) return false;
        const entry = along - Math.sqrt(SPHERE_RADIUS * SPHERE_RADIUS - offCenter);
        return entry > 0 && entry < distance;
    }
    function showLabel(label, point) {
        if (isBlocked(point)) return;
        projected.copy(point).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        layer.show(label, (projected.x + 1) * 0.5 * viewW, (1 - projected.y) * 0.5 * viewH);
    }
    const showAt = (label, object) => showLabel(label, object.getWorldPosition(world));

    // Called by modes that pause themselves.
    let setPlaying = () => {};

    /* ===================================================================================== */
    /* MODE: DRAG                                                                             */
    /* ===================================================================================== */
    function buildDrag() {
        const group = new THREE.Group();
        const s = { hp: 250, ha: 1200, area: 'nominal', solar: 'mean', t: 0, history: null, done: false, anomaly: 0 };
        const AREA_TEXT = {
            feathered: 'Feathered: panels turned edge-on, A/m = 0.004 m²/kg.',
            nominal: 'Nominal: A/m = 0.01 m²/kg.',
            windmill: 'Windmill: panels face the flow, A/m = 0.03 m²/kg.'
        };
        const SOLAR_TEXT = {
            min: 'Solar minimum: a cooler, thinner atmosphere.',
            mean: 'Mean solar activity.',
            max: 'Solar maximum: the heated atmosphere swells upward.'
        };

        const ghost = makeOrbitRing({ color: COLOR.ghost, tube: 0.007, opacity: 0.45 });
        const real = makeOrbitRing({ vertexColors: true });
        group.add(ghost.mesh, real.mesh);
        makeCircle(drawRadius(120), '#94a3b8', 0.35, group);
        makeCircle(drawRadius(600), '#94a3b8', 0.35, group);
        const perigeeDot = makeDot(0.04, COLOR.drag, group);
        const apogeeDot = makeDot(0.035, '#cbd5e1', group);
        const satellite = makeDot(0.055, '#ffffff', group);
        const perigeeLabel = layer.add('', { rank: 1 });
        const apogeeLabel = layer.add('', { rank: 1 });
        const ring120 = { label: layer.add('<span style="color:#cbd5e1">120 km</span>', { rank: 3, optional: true }), point: new THREE.Vector3(0, -drawRadius(120), 0) };
        const ring600 = { label: layer.add('<span style="color:#cbd5e1">600 km</span>', { rank: 3, optional: true }), point: new THREE.Vector3(0, -drawRadius(600), 0) };

        const RAMP = [hex('#475569'), hex(COLOR.drag), hex('#fff1c2')];
        const tmpColor = new THREE.Color();
        const tmpPoint = new THREE.Vector3();

        const current = () => M.sampleHistory(s.history, s.t);
        const shape = (a, e) => (nu) => drawRadius(M.radiusAt(a, e, nu) - M.RE);

        function colorRing(a, e) {
            const geometry = real.mesh.geometry;
            const count = geometry.attributes.position.count;
            const colors = new Float32Array(count * 3);
            const maxHeat = M.dragHeat(a, e, 0);
            for (let i = 0; i <= 240; i++) {
                real.curve.getPointAt(i / 240, tmpPoint);
                const heat = M.dragHeat(a, e, Math.atan2(tmpPoint.y, tmpPoint.x));
                const x = clamp((heat - (maxHeat - 3)) / 3, 0, 1);
                if (x < 0.6) tmpColor.lerpColors(RAMP[0], RAMP[1], x / 0.6);
                else tmpColor.lerpColors(RAMP[1], RAMP[2], (x - 0.6) / 0.4);
                for (let j = 0; j < 7; j++) colors.set([tmpColor.r, tmpColor.g, tmpColor.b], (i * 7 + j) * 3);
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }

        const mode = {
            id: 'drag', group,
            // Whole-decay playback times, not rates.
            speeds: [{ rate: 48, label: 'Decay in 48 s' }, { rate: 24, label: 'Decay in 24 s' }, { rate: 12, label: 'Decay in 12 s' }],
            home: { az: -90, el: 66, dist: 7.5 },
            aria: 'Earth seen from above the equator. A gray starting orbit and a glowing red orbit that shrinks and rounds out as drag removes energy, brightest near perigee.',
            chartTitle: 'Altitude Over Time',
            lightDirection: () => [0.4, -0.3, 1],
            done: () => s.done,
            rebuild() {
                s.history = M.decayHistory({ hp: s.hp, ha: s.ha, areaToMass: M.AREA[s.area], solar: s.solar });
                s.t = 0;
                s.done = false;
                const first = s.history.samples[0];
                ghost.setShape(`${first.a.toFixed(3)}:${first.e.toFixed(6)}`, shape(first.a, first.e));
                chart.baseDirty = true;
            },
            advance(seconds, rate) {
                if (s.done) return false;
                s.t += seconds * s.history.days / rate;
                s.anomaly += seconds * 150;
                if (s.t >= s.history.days) {
                    s.t = s.history.days;
                    s.done = true;
                    setPlaying(false);
                    state.autoPaused = true;
                }
                return true;
            },
            restart() {
                s.t = 0;
                s.done = false;
            },
            sync() {
                const { a, e } = current();
                const key = `${Math.round(a)}:${Math.round(e / 0.0005)}`;
                if (real.setShape(key, shape(a, e))) colorRing(a, e);
                const radiusAt = real.curve.radius;
                perigeeDot.position.set(radiusAt(0), 0, 0);
                apogeeDot.position.set(-radiusAt(Math.PI), 0, 0);
                apogeeDot.visible = e > 0.001;
                satellite.visible = !s.done;
                satellitePoint(satellite.position, s.anomaly, e, radiusAt);
            },
            labels() {
                const { a, e } = current();
                const alt = M.altitudesFromElements(a, e);
                if (e > 0.001) {
                    setLabel(perigeeLabel, `<b style="color:${COLOR.drag}">Perigee</b><span class="hint">${comma(alt.hp)} km</span>`);
                    setLabel(apogeeLabel, `<b>Apogee</b><span class="hint">${comma(alt.ha)} km</span>`);
                    showAt(apogeeLabel, apogeeDot);
                } else {
                    setLabel(perigeeLabel, `<b style="color:${COLOR.drag}">Circular</b><span class="hint">${comma(alt.hp)} km</span>`);
                }
                showAt(perigeeLabel, perigeeDot);
                showLabel(ring120.label, ring120.point);
                showLabel(ring600.label, ring600.point);
            },
            stats() {
                const { a, e } = current();
                const first = s.history.samples[0];
                const alt = M.altitudesFromElements(a, e);
                const alt0 = M.altitudesFromElements(first.a, first.e);
                const speed = Math.sqrt(M.MU / a), speed0 = Math.sqrt(M.MU / first.a);
                const change = (x) => (Math.abs(x) < 0.5 ? '' : ` (${signed(x, 0)})`);
                const left = s.history.days - s.t;
                return [
                    { label: 'Elapsed', value: formatDuration(s.t) },
                    { label: s.done ? 'Lifetime' : 'Time left in orbit', value: s.history.reentered ? formatDuration(s.done ? s.history.days : left) : `Over ${M.CAP_YEARS} yr` },
                    { label: 'Perigee altitude', value: `${comma(alt.hp)} km${change(alt.hp - alt0.hp)}` },
                    { label: 'Apogee altitude', value: `${comma(alt.ha)} km${change(alt.ha - alt0.ha)}` },
                    { label: 'Decay phase', value: M.dragPhase(e) === 1 ? '1: Circularizing' : '2: Spiral decay' },
                    { label: 'Mean speed, km/s', value: `${speed.toFixed(3)}${Math.abs(speed - speed0) < 0.0005 ? '' : ` (${signed(speed - speed0, 3)})`}` }
                ];
            },
            // Equation-sheet formulas only, applied to the orbit as drag changes it.
            equations() {
                const { a, e } = current();
                const first = s.history.samples[0];
                const ra = a * (1 + e), rp = a * (1 - e);
                const va = M.speedAt(a, ra), va0 = M.speedAt(first.a, first.a * (1 + first.e));
                const period = M.periodSeconds(a) / 60, period0 = M.periodSeconds(first.a) / 60;
                return {
                    title: 'Two-Body Values as Drag Acts',
                    constants: 'μ = 398,600.44 km³/s², R⊕ = 6,378.137 km. Drag removes energy every orbit, so ε, a, e, and the period all fall.',
                    rows: [
                        { name: 'Semi-major axis', result: `${comma(a)} km`, work: work('a = (R<sub>a</sub> + R<sub>p</sub>) / 2', `R<sub>a</sub> = ${comma(ra)}, R<sub>p</sub> = ${comma(rp)}`) },
                        { name: 'Eccentricity', result: e.toFixed(4), work: work('e = (R<sub>a</sub> − R<sub>p</sub>) / (R<sub>a</sub> + R<sub>p</sub>)', `start ${first.e.toFixed(4)}`) },
                        { name: 'Specific mechanical energy', result: `${fixed(-M.MU / (2 * a), 2)} km²/s²`, work: work('ε = −μ / (2a)', `start ${fixed(-M.MU / (2 * first.a), 2)}`) },
                        { name: 'Orbital period', result: `${period.toFixed(1)} min`, work: work('Period = 2π √(a³ / μ)', `start ${period0.toFixed(1)} min`) },
                        { name: 'Speed at apogee', result: `${va.toFixed(3)} km/s`, work: work('V = √(μ (2/R − 1/a))', `R = R<sub>a</sub>, start ${va0.toFixed(3)}`) }
                    ]
                };
            },
            impact: () => 'Drag removes orbital energy. Each pass near perigee lowers apogee, so the orbit shrinks and becomes circular, then spirals down to reentry. The period shortens and the satellite speeds up as it sinks.',
            regime: () => 'Low Earth orbit. Drag is strongest from 120 to 600 km and is the largest non-gravitational force below about 630 km. Below 120 km, reentry follows within hours. Solar activity and area-to-mass ratio set the lifetime.',
            notice: () => 'The glow shows where drag acts: mostly near perigee. Watch apogee fall while perigee barely moves.',
            hud() {
                if (s.done) {
                    return s.history.reentered
                        ? `<span class="key-drag">Reentry</span> after ${formatDuration(s.history.days)}.`
                        : `Still in orbit after ${M.CAP_YEARS} years. Above 600 km, drag has much less effect.`;
                }
                return M.dragPhase(current().e) === 1
                    ? '<span class="key-drag">Phase 1:</span> perigee barely moves while apogee falls.'
                    : '<span class="key-drag">Phase 2:</span> the orbit is nearly circular. Drag now acts all the way around, and altitude falls everywhere.';
            },
            caption: () => `${AREA_TEXT[s.area]} ${SOLAR_TEXT[s.solar]} Heights are compressed. The satellite's motion is slowed.`,
            altitudeMarker() {
                const { a, e } = current();
                const alt = M.altitudesFromElements(a, e);
                return [alt.hp, alt.ha];
            },
            drawChartBase(g, w, h) {
                const p = plotFor(w, h);
                drawGrid(g, p.plot, p.xTicks, p.yTicks, { xTitle: p.unit.name });
                chartText(g, 'km', 4, 2);
                strokeHistory(g, p, s.history.samples.length - 1, 0.35);
                for (const km of [120, 600]) {
                    if (km < p.yMax) strokePath(g, [[p.plot.area.x0, p.plot.Y(km)], [p.plot.area.x1, p.plot.Y(km)]], '#94a3b8', 1, 0.6, [4, 4]);
                }
                chartText(g, 'Apogee', p.plot.area.x1 - 4, p.plot.area.y0 + 3, '#cbd5e1', 'right');
                chartText(g, 'Perigee', p.plot.area.x1 - 4, p.plot.area.y0 + 17, COLOR.drag, 'right');
            },
            drawChartLive(g, w, h) {
                const p = plotFor(w, h);
                let last = 0;
                const samples = s.history.samples;
                while (last < samples.length - 1 && samples[last + 1].t <= s.t) last++;
                strokeHistory(g, p, last, 1, true);
                cursor(g, p.plot, p.plot.X(s.t / p.unit.days));
                const { a, e } = current();
                const alt = M.altitudesFromElements(a, e);
                fillDot(g, p.plot.X(s.t / p.unit.days), p.plot.Y(alt.ha), 3, '#cbd5e1');
                fillDot(g, p.plot.X(s.t / p.unit.days), p.plot.Y(alt.hp), 3, COLOR.drag);
            }
        };

        function plotFor(w, h) {
            const days = Math.max(s.history.days, 1e-3);
            const unit = days < 2 ? { days: 1 / 24, name: 'hours' } : days < 730 ? { days: 1, name: 'days' } : { days: M.YEAR_DAYS, name: 'years' };
            const xMax = days / unit.days;
            const ha0 = M.altitudesFromElements(s.history.samples[0].a, s.history.samples[0].e).ha;
            const yMax = 1.05 * ha0;
            const area = defaultArea(w, h);
            area.y0 = 18; // room for the unit above the plot
            const plot = makePlot(area, 0, xMax, 0, yMax);
            return {
                plot, unit, yMax, ha0,
                xTicks: ticks(0, xMax, 4).map((v) => ({ v, label: comma(v, v % 1 ? 1 : 0) })),
                yTicks: ticks(0, yMax, 4).map((v) => ({ v, label: comma(v) }))
            };
        }
        // Apogee and perigee curves, up to and including sample index last.
        function strokeHistory(g, p, last, alpha, live = false) {
            const samples = s.history.samples;
            const ha = [], hp = [];
            const step = Math.max(1, Math.floor(last / 400));
            for (let i = 0; i <= last; i += step) {
                const alt = M.altitudesFromElements(samples[i].a, samples[i].e);
                const x = p.plot.X(samples[i].t / p.unit.days);
                ha.push([x, p.plot.Y(alt.ha)]);
                hp.push([x, p.plot.Y(alt.hp)]);
            }
            if (live) {
                const { a, e } = current();
                const alt = M.altitudesFromElements(a, e);
                const x = p.plot.X(s.t / p.unit.days);
                ha.push([x, p.plot.Y(alt.ha)]);
                hp.push([x, p.plot.Y(alt.hp)]);
            } else if (last % step) {
                const alt = M.altitudesFromElements(samples[last].a, samples[last].e);
                const x = p.plot.X(samples[last].t / p.unit.days);
                ha.push([x, p.plot.Y(alt.ha)]);
                hp.push([x, p.plot.Y(alt.hp)]);
            }
            strokePath(g, ha, '#cbd5e1', 1.8, alpha);
            strokePath(g, hp, COLOR.drag, 1.8, alpha);
        }

        // Controls
        const hpInput = $('drag-hp'), haInput = $('drag-ha');
        function showValues() {
            setText($('drag-hp-value'), `${comma(s.hp)} km`);
            setText($('drag-ha-value'), `${comma(s.ha)} km`);
        }
        hpInput.addEventListener('input', () => {
            s.hp = Number(hpInput.value);
            if (s.hp > s.ha) { s.ha = s.hp; haInput.value = s.ha; }
            showValues();
            changed();
        });
        haInput.addEventListener('input', () => {
            s.ha = Number(haInput.value);
            if (s.ha < s.hp) { s.hp = s.ha; hpInput.value = s.hp; }
            showValues();
            changed();
        });
        Kit.bindSegmented($('drag-area'), (v) => { s.area = v; changed(); });
        Kit.bindSegmented($('drag-solar'), (v) => { s.solar = v; changed(); });
        showValues();

        let chart; // set once the shared chart exists
        mode.attachChart = (c) => { chart = c; };
        return mode;
    }

    /* ===================================================================================== */
    /* MODE: J2                                                                               */
    /* ===================================================================================== */
    function buildJ2() {
        const group = new THREE.Group();
        const s = { a: M.RE + 500, e: 0, inc: 45, raan0: 40, argp0: 0, preset: 'leo', t: 0, anomaly: 0, rates: null };
        const PRESETS = {
            leo: { hp: 500, ha: 500, inc: 45, argp0: 0, text: 'Lesson Worked Example 1. The node moves west 5.410° per day.' },
            polar: { hp: 800, ha: 800, inc: 90, argp0: 0, text: 'At 90°, cos i is zero, so the node does not move.' },
            sso: { hp: 700, ha: 700, inc: null, argp0: 0, text: 'Slightly retrograde, so the node moves east 0.9856° per day.' },
            molniya: { a: 26560, e: 0.745, inc: 63.4349, argp0: 270, text: 'Lesson Worked Example 2. Perigee is frozen. Now try 55°.' }
        };

        const bulge = new THREE.Mesh(
            new THREE.TorusGeometry(1.0, 0.045, 12, 120),
            new THREE.MeshBasicMaterial({ color: hex(COLOR.j2), transparent: true, opacity: 0.35, depthWrite: false })
        );
        group.add(bulge);
        const bulgeLabel = layer.add(`<span style="color:${COLOR.j2}">Equatorial bulge</span><span class="hint">exaggerated</span>`, { rank: 3, optional: true });
        const bulgePoint = new THREE.Vector3(0, -1.05, 0);

        const ghostFrame = makeOrbitFrame(group);
        const realFrame = makeOrbitFrame(group);
        const ghost = makeOrbitRing({ color: COLOR.ghost, tube: 0.007, opacity: 0.45 });
        const real = makeOrbitRing({ color: COLOR.j2 });
        ghostFrame.inner.add(ghost.mesh);
        realFrame.inner.add(real.mesh);

        const wedge = new THREE.Mesh(
            new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({ color: hex(COLOR.j2), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
        );
        group.add(wedge);
        let wedgeKey = '';

        const nodeDot = makeDot(0.05, COLOR.j2, group);
        const ghostNode = makeDot(0.035, COLOR.ghost, group);
        const perigeeDot = makeDot(0.045, COLOR.perigee, realFrame.inner);
        const ghostPerigee = makeDot(0.03, COLOR.ghost, ghostFrame.inner);
        const satellite = makeDot(0.055, '#ffffff', realFrame.inner);
        const nodeLabel = layer.add('', { rank: 1 });
        const perigeeLabel = layer.add(`<b style="color:${COLOR.perigee}">Perigee</b>`, { rank: 2 });

        const TRAIL = 400;
        const trail = new THREE.Line(
            new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)),
            new THREE.LineBasicMaterial({ color: hex(COLOR.perigee), transparent: true, opacity: 0.7 })
        );
        trail.frustumCulled = false;
        group.add(trail);
        let trailCount = 0;
        const trailLast = new THREE.Vector3();
        const perigeeWorld = new THREE.Vector3();
        function clearTrail() {
            trailCount = 0;
            trail.geometry.setDrawRange(0, 0);
        }
        function addTrail(p) {
            const pos = trail.geometry.attributes.position;
            if (trailCount === TRAIL) {
                pos.array.copyWithin(0, 3);
                trailCount--;
            }
            pos.setXYZ(trailCount, p.x, p.y, p.z);
            trailCount++;
            pos.needsUpdate = true;
            trail.geometry.setDrawRange(0, trailCount);
            trailLast.copy(p);
        }

        const alt = () => M.altitudesFromElements(s.a, s.e);
        const circular = () => s.e < 0.001;
        const raanNow = () => s.raan0 + s.rates.nodeDegDay * s.t;
        const argpNow = () => s.argp0 + s.rates.perigeeDegDay * s.t;
        const shape = (nu) => drawRadius(M.radiusAt(s.a, s.e, nu) - M.RE);

        function nodeText() {
            const dir = M.nodeDirection(s.inc);
            const rate = Math.abs(s.rates.nodeDegDay);
            return dir === 'none' ? 'Fixed' : `${dir === 'west' ? 'West' : 'East'} ${rate.toFixed(rate < 1 ? 3 : 2)}°/day`;
        }

        const mode = {
            id: 'j2', group,
            speeds: [{ rate: 1, label: '1 day/s' }, { rate: 5, label: '5 days/s' }, { rate: 25, label: '25 days/s' }],
            home: { az: 35, el: 24, dist: 8 },
            aria: 'Earth with an exaggerated equatorial bulge. A blue orbit whose plane turns about the spin axis compared with a gray fixed orbit, with a shaded wedge showing how far the node has moved.',
            chartTitle: 'Drift Rate vs. Inclination',
            lightDirection: () => [0.8, 0.3, 0.5],
            rebuild() {
                s.rates = M.j2Rates(s.a, s.e, s.inc);
                s.t = 0;
                const key = `${s.a.toFixed(2)}:${s.e.toFixed(5)}`;
                ghost.setShape(key, shape);
                real.setShape(key, shape);
                const rMax = drawRadius(alt().ha);
                const dist = Math.max(8, 3.6 * rMax);
                if (dist !== mode.home.dist) {
                    mode.home.dist = dist;
                    if (state.mode === 'j2') startBlend(mode.home);
                }
                clearTrail();
                chart.baseDirty = true;
            },
            advance(seconds, rate) {
                s.t += seconds * rate;
                s.anomaly += seconds * 110;
                return true;
            },
            restart() {
                s.t = 0;
                clearTrail();
            },
            sync() {
                const raan = raanNow(), argp = argpNow();
                ghostFrame.place(s.raan0, s.inc, s.argp0);
                realFrame.place(raan, s.inc, argp);
                const rNode = shape(-argp * D2R), rNode0 = shape(-s.argp0 * D2R);
                nodeDot.position.set(rNode * Math.cos(raan * D2R), rNode * Math.sin(raan * D2R), 0);
                ghostNode.position.set(rNode0 * Math.cos(s.raan0 * D2R), rNode0 * Math.sin(s.raan0 * D2R), 0);

                // Node sweep since t = 0, wrapped to one turn, with its sign kept.
                const drift = s.rates.nodeDegDay * s.t;
                const sweep = Math.sign(drift) * (Math.abs(drift) % 360);
                const start = Math.min(s.raan0, s.raan0 + sweep);
                const key = `${start.toFixed(2)}:${Math.abs(sweep).toFixed(2)}:${rNode.toFixed(3)}`;
                if (key !== wedgeKey) {
                    wedgeKey = key;
                    wedge.geometry.dispose();
                    wedge.geometry = Math.abs(sweep) < 0.05 || rNode <= 1.03
                        ? new THREE.BufferGeometry()
                        : new THREE.RingGeometry(1.02, rNode, 72, 1, start * D2R, Math.abs(sweep) * D2R);
                }

                const isCircular = circular();
                perigeeDot.visible = ghostPerigee.visible = trail.visible = !isCircular;
                perigeeDot.position.set(shape(0), 0, 0);
                ghostPerigee.position.set(shape(0), 0, 0);
                satellitePoint(satellite.position, s.anomaly, s.e, shape);
                earth.pivot.rotation.z = state.earthDeg * D2R;

                if (!isCircular) {
                    perigeeDot.getWorldPosition(perigeeWorld);
                    if (trailCount === 0 || perigeeWorld.angleTo(trailLast) > 2 * D2R) addTrail(perigeeWorld);
                }
            },
            labels() {
                setLabel(nodeLabel, `<b style="color:${COLOR.j2}">Node</b><span class="hint">${nodeText()}</span>`);
                showAt(nodeLabel, nodeDot);
                if (!circular()) showAt(perigeeLabel, perigeeDot);
                showLabel(bulgeLabel, bulgePoint);
            },
            stats() {
                const dir = M.perigeeDirection(s.inc);
                return [
                    { label: 'Elapsed', value: formatDuration(s.t) },
                    { label: 'RAAN', value: `${M.wrap360(raanNow()).toFixed(1)}°` },
                    { label: 'Node motion', value: M.nodeDirection(s.inc) === 'none' ? 'None' : nodeText() },
                    { label: 'Argument of perigee', value: circular() ? 'No perigee' : `${M.wrap360(argpNow()).toFixed(1)}°` },
                    { label: 'Perigee motion', value: circular() ? 'No perigee' : dir === 'none' ? 'Frozen' : `${dir === 'forward' ? 'Fwd' : 'Back'} ${Math.abs(s.rates.perigeeDegDay).toFixed(Math.abs(s.rates.perigeeDegDay) < 1 ? 3 : 2)}°/day` },
                    { label: 'Apogee latitude', value: circular() ? 'No apogee' : (() => { const l = M.apogeeLatitude(s.inc, argpNow()); return `${Math.abs(l).toFixed(1)}° ${l >= 0 ? 'N' : 'S'}`; })() }
                ];
            },
            // Equation-sheet formulas only. J2 does not change these, which is the point of showing them.
            equations() {
                const ra = s.a * (1 + s.e), rp = s.a * (1 - s.e);
                const n = M.meanMotion(s.a);
                return {
                    title: 'Two-Body Values J₂ Leaves Alone',
                    constants: 'μ = 398,600.44 km³/s², R⊕ = 6,378.137 km. J₂ turns Ω and ω (rates in Live Values) but leaves a, e, and i unchanged on average, so these values stay fixed.',
                    rows: [
                        { name: 'Perigee radius', result: `${comma(rp)} km`, work: work('R<sub>p</sub> = a(1 − e)', `a = ${comma(s.a)} km, e = ${s.e.toFixed(3)}`) },
                        { name: 'Apogee radius', result: `${comma(ra)} km`, work: work('R<sub>a</sub> = a(1 + e)') },
                        { name: 'Mean motion', result: `${sci(n, 4)} rad/s`, work: work('n = √(μ / a³)') },
                        { name: 'Orbital period', result: `${(M.periodSeconds(s.a) / 60).toFixed(1)} min`, work: work('Period = 2π √(a³ / μ)') }
                    ]
                };
            },
            impact: () => 'The equatorial bulge turns the orbit plane: the ascending node moves west for prograde orbits and east for retrograde ones. It also turns perigee within the plane, unless the inclination is 63.4° or 116.6°. Sun-synchronous and Molniya orbits are built on these two effects.',
            regime: () => 'All Earth orbits, strongest in low orbits, and weaker with altitude. It is the largest perturbation from LEO up to about 33,800 km, above which the Sun and Moon take over.',
            notice: () => 'The shaded wedge shows how far the node has moved from the gray two-body orbit. Try 90° (no node motion) and 63.4° (frozen perigee).',
            hud() {
                const dir = M.nodeDirection(s.inc);
                const node = { west: 'Prograde: the node moves <span class="key-j2">west</span>.', none: 'Polar: the node stays <span class="key-j2">fixed</span>.', east: 'Retrograde: the node moves <span class="key-j2">east</span>.' }[dir];
                if (circular()) return node;
                const p = M.perigeeDirection(s.inc);
                const per = { forward: 'Perigee moves forward.', backward: 'Perigee moves backward.', none: 'Perigee is frozen, but the node still drifts.' }[p];
                return `${node} ${per}`;
            },
            caption: () => `${s.preset ? PRESETS[s.preset].text : 'Custom orbit.'} Heights are compressed. The satellite and Earth's spin are slowed.`,
            altitudeMarker() {
                const h = alt();
                return [h.hp, h.ha];
            },
            drawChartBase(g, w, h) {
                const p = plotFor(w, h);
                drawGrid(g, p.plot, p.xTicks, p.yTicks);
                chartText(g, '°/day', 4, 2);
                strokePath(g, [[p.plot.area.x0, p.plot.Y(0)], [p.plot.area.x1, p.plot.Y(0)]], '#ffffff', 1, 0.3);
                for (const [inc, text] of [[63.4349, '63.4°'], [90, '90°'], [116.5651, '116.6°']]) {
                    const x = p.plot.X(inc);
                    strokePath(g, [[x, p.plot.area.y0], [x, p.plot.area.y1]], '#cbd5e1', 1, 0.5, [3, 3]);
                    chartText(g, text, x + 2, p.plot.area.y1 - 14, '#cbd5e1');
                }
                const node = [], perigee = [];
                for (let i = 0; i <= 180; i += 1) {
                    const r = M.j2Rates(s.a, s.e, i);
                    node.push([p.plot.X(i), p.plot.Y(r.nodeDegDay)]);
                    perigee.push([p.plot.X(i), p.plot.Y(r.perigeeDegDay)]);
                }
                strokePath(g, node, COLOR.j2, 2);
                strokePath(g, perigee, COLOR.perigee, 2);
                chartText(g, 'ω̇ perigee', p.plot.area.x1, 2, COLOR.perigee, 'right');
                chartText(g, 'Ω̇ node', p.plot.area.x1 - 70, 2, COLOR.j2, 'right');
            },
            drawChartLive(g, w, h) {
                const p = plotFor(w, h);
                const x = p.plot.X(s.inc);
                cursor(g, p.plot, x);
                fillDot(g, x, p.plot.Y(s.rates.nodeDegDay), 3.5, COLOR.j2);
                fillDot(g, x, p.plot.Y(s.rates.perigeeDegDay), 3.5, COLOR.perigee);
            }
        };

        function plotFor(w, h) {
            const yMax = 1.1 * M.j2Rates(s.a, s.e, 0).perigeeDegDay;
            const area = defaultArea(w, h);
            area.y0 = 18; // room for the legend above the plot
            area.x1 = w - 16; // room for the "180°" tick label
            const plot = makePlot(area, 0, 180, -yMax, yMax);
            const yt = ticks(-yMax, yMax, 4);
            const digits = niceStep(2 * yMax, 4) < 1 ? (niceStep(2 * yMax, 4) < 0.1 ? 2 : 1) : 0;
            return {
                plot,
                xTicks: [0, 30, 60, 90, 120, 150, 180].map((v) => ({ v, label: `${v}°` })),
                yTicks: yt.map((v) => ({ v, label: fixed(v, digits) }))
            };
        }

        // Controls. a and e are the truth, and the sliders show them.
        const incInput = $('j2-inc'), hpInput = $('j2-hp'), haInput = $('j2-ha');
        const haFromX = (x) => Math.round(200 * Math.pow(225, x / 1000) / 10) * 10;
        const xFromHa = (ha) => Math.round(1000 * Math.log(ha / 200) / Math.log(225));
        let selectPreset = () => {};
        function showValues() {
            const h = alt();
            setText($('j2-inc-value'), `${s.inc.toFixed(1)}°`);
            setText($('j2-hp-value'), `${comma(h.hp)} km`);
            setText($('j2-ha-value'), `${comma(h.ha)} km`);
        }
        function syncSliders() {
            const h = alt();
            incInput.value = s.inc;
            hpInput.value = clamp(Math.round(h.hp / 10) * 10, 200, 2000);
            haInput.value = clamp(xFromHa(Math.max(h.ha, 200)), 0, 1000);
            showValues();
        }
        function clearPreset() {
            s.preset = null;
            for (const b of $('j2-preset').querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
        }
        function setAltitudes(hp, ha) {
            const el = M.elementsFromAltitudes(hp, ha);
            s.a = el.a;
            s.e = el.e;
        }
        incInput.addEventListener('input', () => {
            let v = Number(incInput.value);
            for (const c of [M.CRITICAL_INC[0], 90, M.CRITICAL_INC[1]]) if (Math.abs(v - c) <= 0.25) v = c;
            s.inc = v;
            clearPreset();
            showValues();
            changed();
        });
        hpInput.addEventListener('input', () => {
            const hp = Number(hpInput.value);
            let ha = alt().ha;
            if (ha < hp) { ha = hp; haInput.value = clamp(xFromHa(ha), 0, 1000); }
            setAltitudes(hp, ha);
            clearPreset();
            showValues();
            changed();
        });
        haInput.addEventListener('input', () => {
            const ha = haFromX(Number(haInput.value));
            let hp = alt().hp;
            if (hp > ha) { hp = ha; hpInput.value = clamp(hp, 200, 2000); }
            setAltitudes(hp, ha);
            clearPreset();
            showValues();
            changed();
        });
        selectPreset = Kit.bindSegmented($('j2-preset'), (v) => {
            const p = PRESETS[v];
            s.preset = v;
            if (p.a) { s.a = p.a; s.e = p.e; } else setAltitudes(p.hp, p.ha);
            s.inc = p.inc === null ? M.sunSyncInclination(s.a) : p.inc;
            s.argp0 = p.argp0;
            syncSliders();
            changed();
        });
        syncSliders();

        let chart;
        mode.attachChart = (c) => { chart = c; };
        return mode;
    }

    /* ===================================================================================== */
    /* MODE: J2,2 (Earth-fixed view)                                                          */
    /* ===================================================================================== */
    function buildJ22() {
        const group = new THREE.Group();
        const s = { lon0: 30, sim: { lon: 30 * D2R, rate: 0 }, t: 0, hold: false, dv: 0, offsetMin: 0, offsetMax: 0 };
        const lonVec = (deg, r, target = new THREE.Vector3()) => target.set(r * Math.cos(deg * D2R), r * Math.sin(deg * D2R), 0);

        // Orange slices: mass excess on the long axis, mass deficit on the short axis.
        for (const [center, color] of [[-15, '#fb923c'], [165, '#fb923c'], [75, '#60a5fa'], [-105, '#60a5fa']]) {
            const slice = new THREE.Mesh(
                new THREE.RingGeometry(1.02, GEO_DRAW, 48, 1, (center - 45) * D2R, 90 * D2R),
                new THREE.MeshBasicMaterial({ color: hex(color), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
            );
            group.add(slice);
        }
        const axisLine = (deg, color) => group.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([lonVec(deg, GEO_DRAW * 1.12), lonVec(deg + 180, GEO_DRAW * 1.12)]),
            new THREE.LineBasicMaterial({ color: hex(color), transparent: true, opacity: 0.6 })
        ));
        axisLine(-15, COLOR.j22);
        axisLine(75, '#60a5fa');
        const longLabel = { label: layer.add(`<span style="color:${COLOR.j22}">Long axis</span>`, { rank: 3, optional: true }), point: lonVec(165, GEO_DRAW * 1.12) };
        const shortLabel = { label: layer.add('<span style="color:#60a5fa">Short axis</span>', { rank: 3, optional: true }), point: lonVec(-105, GEO_DRAW * 1.12) };

        const geoRing = new THREE.Mesh(new THREE.TorusGeometry(GEO_DRAW, 0.008, 6, 240), new THREE.MeshBasicMaterial({ color: hex(COLOR.j22), transparent: true, opacity: 0.55 }));
        group.add(geoRing);

        const markers = [];
        for (const lon of M.STABLE_LON) {
            const m = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 32), new THREE.MeshBasicMaterial({ color: hex(COLOR.stable) }));
            lonVec(lon, GEO_DRAW, m.position);
            group.add(m);
            markers.push({ point: m.position, label: layer.add(`<b style="color:${COLOR.stable}">Stable</b><span class="hint">${lonName(lon)}</span>`, { rank: 2, optional: true }) });
        }
        for (const lon of M.UNSTABLE_LON) {
            const x = new THREE.Group();
            for (const angle of [45, -45]) {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: hex(COLOR.unstable) }));
                bar.rotation.z = (lon + angle) * D2R;
                x.add(bar);
            }
            lonVec(lon, GEO_DRAW, x.position);
            group.add(x);
            markers.push({ point: x.position, label: layer.add(`<b style="color:${COLOR.unstable}">Unstable</b><span class="hint">${lonName(lon)}</span>`, { rank: 2, optional: true }) });
        }

        const swing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: hex(COLOR.j22), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        group.add(swing);
        let swingKey = '';
        const startDot = makeDot(0.045, COLOR.ghost, group);
        const startLabel = layer.add('<b style="color:#94a3b8">Two-body</b><span class="hint">would stay here</span>', { rank: 2, optional: true });
        const satellite = makeDot(0.07, '#ffffff', group);
        const satelliteLabel = layer.add('', { rank: 0 });

        // The point on the equator the satellite hovers over, joined to it by a line. In this Earth-fixed
        // view a GEO satellite keeps pace with Earth's spin, so the line shows what it is "parked" over.
        const groundDot = makeDot(0.035, '#ffffff', group);
        const tether = new THREE.Line(
            new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
        );
        tether.frustumCulled = false;
        group.add(tether);

        // A reminder that the satellite still orbits once a day, at the same rate Earth turns.
        const ORBIT_HINT_LON = -150;
        const orbitArrow = makeArrow('#cbd5e1', group);
        lonVec(ORBIT_HINT_LON, GEO_DRAW + 0.12, orbitArrow.position);
        orbitArrow.setDirection(new THREE.Vector3(-Math.sin(ORBIT_HINT_LON * D2R), Math.cos(ORBIT_HINT_LON * D2R), 0));
        setArrowLength(orbitArrow, 0.45);
        const orbitLabel = { label: layer.add('<span style="color:#cbd5e1">Orbits once a day,<br>as Earth turns</span>', { rank: 3, optional: true }), point: lonVec(ORBIT_HINT_LON + 6, GEO_DRAW + 0.12) };

        const accelArrow = makeArrow(COLOR.unstable, group);
        const driftArrow = makeArrow(COLOR.stable, group);
        const accelLabel = layer.add(`<b style="color:${COLOR.unstable}">J₂,₂ push</b>`, { rank: 1 });
        const driftLabel = layer.add(`<b style="color:${COLOR.stable}">Longitude drift</b>`, { rank: 1 });
        const tip = new THREE.Vector3(), dir = new THREE.Vector3();

        const lonDeg = () => s.sim.lon * R2D;
        const sinNow = () => Math.sin(2 * (lonDeg() - M.LON22) * D2R);
        const arrowsShown = () => Math.abs(sinNow()) >= 0.02;
        const startLon = () => {
            for (const u of M.UNSTABLE_LON) if (Math.abs(M.wrap180(s.lon0 - u)) < 0.01) return s.lon0 + 0.05;
            return s.lon0;
        };

        const mode = {
            id: 'j22', group,
            speeds: [{ rate: 30, label: '30 days/s' }, { rate: 100, label: '100 days/s' }, { rate: 300, label: '300 days/s' }],
            home: { az: -90, el: 78, dist: 9 },
            aria: 'Earth seen from above the North Pole and held fixed, with the GEO ring, shaded wedges for the elliptical equator, and a satellite that swings in longitude about a stable point.',
            chartTitle: 'Drift Potential W(λ)',
            lightDirection: () => [0.3, -0.4, 1],
            rebuild() {
                s.sim = { lon: startLon() * D2R, rate: 0 };
                s.t = 0;
                s.dv = 0;
                s.offsetMin = s.offsetMax = 0;
                chart.baseDirty = true;
            },
            advance(seconds, rate) {
                const dt = seconds * rate;
                s.t += dt;
                if (s.hold) {
                    s.dv += M.eastWestDvPerYear(lonDeg()) * dt / M.YEAR_DAYS;
                } else {
                    M.stepLongitude(s.sim, dt);
                    const off = lonDeg() - startLon();
                    s.offsetMin = Math.min(s.offsetMin, off);
                    s.offsetMax = Math.max(s.offsetMax, off);
                }
                return true;
            },
            restart() {
                mode.rebuild();
            },
            sync() {
                earth.pivot.rotation.z = 0;
                const lon = lonDeg();
                lonVec(lon, GEO_DRAW, satellite.position);
                lonVec(lon, 1.0, groundDot.position);
                const tp = tether.geometry.attributes.position;
                tp.setXYZ(0, groundDot.position.x, groundDot.position.y, 0);
                tp.setXYZ(1, satellite.position.x, satellite.position.y, 0);
                tp.needsUpdate = true;
                lonVec(startLon(), GEO_DRAW, startDot.position);
                startDot.visible = Math.abs(M.wrap180(lon - startLon())) > 1;

                const from = startLon() + s.offsetMin, span = s.offsetMax - s.offsetMin;
                const key = `${from.toFixed(1)}:${span.toFixed(1)}`;
                if (key !== swingKey) {
                    swingKey = key;
                    swing.geometry.dispose();
                    swing.geometry = span < 0.2 ? new THREE.BufferGeometry() : new THREE.RingGeometry(GEO_DRAW - 0.035, GEO_DRAW + 0.035, 96, 1, from * D2R, Math.min(span, 360) * D2R);
                }

                const show = arrowsShown();
                accelArrow.visible = driftArrow.visible = show;
                if (show) {
                    const len = 0.15 + 0.5 * Math.abs(sinNow());
                    const east = [-Math.sin(lon * D2R), Math.cos(lon * D2R)];
                    const aSign = Math.sign(M.tangentialAccel(lon));
                    const dSign = Math.sign(M.longitudeAccel(lon));
                    accelArrow.position.copy(lonVec(lon, GEO_DRAW + 0.13, tip));
                    accelArrow.setDirection(dir.set(east[0] * aSign, east[1] * aSign, 0));
                    setArrowLength(accelArrow, len);
                    driftArrow.position.copy(lonVec(lon, GEO_DRAW - 0.13, tip));
                    driftArrow.setDirection(dir.set(east[0] * dSign, east[1] * dSign, 0));
                    setArrowLength(driftArrow, len);
                }
            },
            labels() {
                if (arrowsShown()) {
                    const len = 0.15 + 0.5 * Math.abs(sinNow());
                    for (const [arrow, label] of [[accelArrow, accelLabel], [driftArrow, driftLabel]]) {
                        dir.set(0, 1, 0).applyQuaternion(arrow.quaternion);
                        showLabel(label, tip.copy(arrow.position).addScaledVector(dir, len));
                    }
                }
                setLabel(satelliteLabel, `<b>GEO satellite</b><span class="hint">over ${formatLon(lonDeg())}</span>`);
                showAt(satelliteLabel, satellite);
                for (const m of markers) showLabel(m.label, m.point);
                if (startDot.visible) showAt(startLabel, startDot);
                showLabel(longLabel.label, longLabel.point);
                showLabel(shortLabel.label, shortLabel.point);
                showLabel(orbitLabel.label, orbitLabel.point);
            },
            stats() {
                const lon = lonDeg();
                const rateDay = s.sim.rate * R2D * M.DAY_S;
                const amp = M.nearestStable(startLon()).amplitudeDeg;
                const T = M.librationPeriodDays(amp);
                const off = s.hold ? 0 : M.semiMajorOffsetKm(s.sim.rate);
                return [
                    { label: 'Elapsed', value: formatDuration(s.t) },
                    { label: 'Hovers over', value: formatLon(lon) },
                    { label: 'Longitude drift', value: s.hold || Math.abs(rateDay) < 0.0005 ? '0.000°/day' : `${rateDay > 0 ? 'East' : 'West'} ${Math.abs(rateDay).toFixed(3)}°/day` },
                    { label: 'Height above GEO', value: `${Math.abs(off) < 0.05 ? '0.0' : signed(off, 1)} km` },
                    { label: 'Libration period', value: s.hold ? 'Held' : isFinite(T) ? `${comma(T)} days` : 'Very long' },
                    { label: 'E-W Δv', value: s.hold ? `${s.dv.toFixed(2)} m/s spent` : `${M.eastWestDvPerYear(lon).toFixed(2)} m/s/yr here` }
                ];
            },
            // Equation-sheet formulas only: why being slightly above or below GEO moves the satellite in longitude.
            equations() {
                const off = s.hold ? 0 : M.semiMajorOffsetKm(s.sim.rate);
                const N_GEO = 0.0000729212; // the equation sheet's constant
                const r = Math.cbrt(M.MU / (N_GEO * N_GEO)) + off; // GEO radius that matches it exactly, plus the offset
                const n = M.meanMotion(r);
                const side = Math.abs(off) < 0.05 ? 'equal: it stays put' : off > 0 ? 'smaller: it falls behind (west)' : 'larger: it pulls ahead (east)';
                return {
                    title: 'Why Height Moves Longitude',
                    constants: 'μ = 398,600.44 km³/s², R⊕ = 6,378.137 km. The J₂,₂ push changes a by only kilometers, but that is enough to make n differ from Earth\'s spin.',
                    rows: [
                        { name: 'Orbital radius', result: `${comma(r, 1)} km`, work: work('R = altitude + R⊕', `altitude = ${comma(r - 6378.137, 1)} km`) },
                        { name: 'Mean motion', result: `${sci(n, 6)} rad/s`, work: work('n = √(μ / a³)') },
                        { name: 'GEO mean motion', result: `${sci(N_GEO, 6)} rad/s`, work: work('n<sub>geo</sub> (constant)', `n is ${side}`) },
                        { name: 'Orbital period', result: `${(M.periodSeconds(r) / 3600).toFixed(4)} h`, work: work('Period = 2π √(a³ / μ)', 'sidereal day 23.9345 h') },
                        { name: 'Circular-orbit speed', result: `${Math.sqrt(M.MU / r).toFixed(4)} km/s`, work: work('V = √(μ / R)') }
                    ]
                };
            },
            impact: () => 'Earth\'s equator is slightly elliptical. Its uneven pull pushes a GEO satellite along its orbit, which changes the orbit\'s size by a few kilometers. The satellite then slowly drifts east or west and swings back and forth about 75° E or 105° W, over 2 to 3 years. Holding a slot costs at most 1.715 m/s per year.',
            regime: () => 'Geosynchronous orbits only. A GEO satellite stays over the same longitude, so the same push acts day after day and adds up. In other orbits the satellite passes over every longitude, and the push averages out.',
            notice: () => 'Earth is held still here, as if you rode along with it. A forward push raises the orbit, which makes it slower than Earth\'s spin, so the satellite drifts backward: the drift is opposite the push. The chart shows the same swing as a ball rolling in a valley.',
            hud() {
                if (s.hold) return '<span class="key-j22">Station-keeping</span> keeps the satellite over its slot, at a small yearly cost.';
                if (!arrowsShown()) return 'The J₂,₂ push is zero at this longitude, so the satellite stays over it.';
                return 'Earth-fixed view: the satellite orbits once a day, keeping pace with Earth, so it seems to hover. Over years, J₂,₂ slowly moves the spot it hovers over.';
            },
            caption: () => 'Earth is held still, so a GEO satellite appears to hover. Each swing takes years; the satellite still circles Earth once a day. The ring is not to scale, and the wedges are exaggerated.',
            altitudeMarker: () => [35786, 35786],
            drawChartBase(g, w, h) {
                const p = plotFor(w, h);
                drawGrid(g, p.plot, p.xTicks, []);
                const pts = [];
                for (let l = -180; l <= 180; l += 2) pts.push([p.plot.X(l), p.plot.Y(M.driftPotential(l))]);
                strokePath(g, pts, COLOR.j22, 2);
                for (const l of M.STABLE_LON) {
                    g.strokeStyle = COLOR.stable;
                    g.lineWidth = 2;
                    g.beginPath();
                    g.arc(p.plot.X(l), p.plot.Y(-1), 5, 0, TAU);
                    g.stroke();
                }
                for (const l of M.UNSTABLE_LON) drawCross(g, p.plot.X(l), p.plot.Y(1), 4.5, COLOR.unstable);
                if (!s.hold) {
                    const level = p.plot.Y(M.driftPotential(startLon()));
                    strokePath(g, [[p.plot.area.x0, level], [p.plot.area.x1, level]], '#cbd5e1', 1, 0.7, [4, 4]);
                }
                chartText(g, 'W', p.plot.area.x0 - 5, p.plot.Y(0), CHART_TEXT, 'right', 'middle');
            },
            drawChartLive(g, w, h) {
                const p = plotFor(w, h);
                const l = M.wrap180(lonDeg());
                fillDot(g, p.plot.X(l), p.plot.Y(M.driftPotential(l)) - 5, 5, '#ffffff');
            }
        };
        function plotFor(w, h) {
            const area = defaultArea(w, h);
            area.x0 = 26;
            area.y0 = 16;
            const plot = makePlot(area, -180, 180, -1.15, 1.15);
            return { plot, xTicks: [-180, -120, -60, 0, 60, 120, 180].map((v) => ({ v, label: v === 0 ? '0°' : `${Math.abs(v)}°${v > 0 ? 'E' : 'W'}` })) };
        }

        const lonInput = $('j22-lon');
        const showValue = () => setText($('j22-lon-value'), formatLon(s.lon0));
        lonInput.addEventListener('input', () => {
            s.lon0 = Number(lonInput.value);
            showValue();
            changed();
        });
        $('j22-hold').addEventListener('change', (e) => {
            s.hold = e.target.checked;
            changed();
        });
        showValue();

        let chart;
        mode.attachChart = (c) => { chart = c; };
        return mode;
    }

    /* ===================================================================================== */
    /* MODE: 3RD BODY                                                                         */
    /* ===================================================================================== */
    function buildThird() {
        const group = new THREE.Group();
        const s = { body: 'moon', hold: false, t: 0, anomaly: 0 };
        const BODIES = { moon: { mu: M.MU_MOON, d: M.D_MOON, color: COLOR.moon, name: 'Moon' }, sun: { mu: M.MU_SUN, d: M.D_SUN, color: COLOR.sun, name: 'Sun' } };
        const PEAK = 8.68e-6; // the Moon's peak differential pull at GEO, m/s^2

        const ghost = new THREE.Mesh(new THREE.TorusGeometry(GEO_DRAW, 0.007, 6, 240), new THREE.MeshBasicMaterial({ color: hex(COLOR.ghost), transparent: true, opacity: 0.45 }));
        group.add(ghost);
        const frame = makeOrbitFrame(group);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: hex(COLOR.moon) });
        frame.inner.add(new THREE.Mesh(new THREE.TorusGeometry(GEO_DRAW, 0.012, 6, 240), ringMaterial));
        const satellite = makeDot(0.06, '#ffffff', frame.inner);

        const bodyDir = new THREE.Vector3(...M.BODY_DIRECTION);
        const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), new THREE.MeshLambertMaterial({ color: hex(COLOR.moon), emissive: hex('#333a44') }));
        bodyMesh.position.copy(bodyDir).multiplyScalar(3.6);
        group.add(bodyMesh);
        const bodyLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), bodyMesh.position.clone()]),
            new THREE.LineBasicMaterial({ color: hex(COLOR.moon), transparent: true, opacity: 0.35 })
        );
        group.add(bodyLine);
        const bodyLabel = layer.add('', { rank: 0 });

        const ARROWS = 24;
        const arrows = [];
        for (let k = 0; k < ARROWS; k++) arrows.push(makeArrow(COLOR.moon, group));
        const unit = new THREE.Vector3(), dir = new THREE.Vector3();
        const ascNode = new THREE.Vector3();
        const nodeLabel = layer.add('<b style="color:#cbd5e1">Node</b>', { rank: 2, optional: true });
        const nodeDot = makeDot(0.04, COLOR.moon, group);

        const tilt = () => (s.hold ? { incDeg: 0, nodeDeg: 90 } : M.geoTilt(s.t));
        const body = () => BODIES[s.body];

        const mode = {
            id: 'third', group,
            speeds: [{ rate: 1, label: '1 yr/s' }, { rate: 3, label: '3 yr/s' }, { rate: 10, label: '10 yr/s' }],
            home: { az: 40, el: 12, dist: 9 },
            aria: 'Earth with a gray equatorial GEO ring and a tilting colored GEO ring. Arrows around the ring show how the Moon or Sun pulls differently on each part of the orbit.',
            chartTitle: 'Inclination and Ground Trace',
            lightDirection: () => [0.8, 0.3, 0.5],
            rebuild() {
                const b = body();
                ringMaterial.color.set(b.color);
                bodyMesh.material.color.set(b.color);
                bodyLine.material.color.set(b.color);
                nodeDot.material.color.set(b.color);
                for (const a of arrows) a.setColor(hex(b.color));
                setLabel(bodyLabel, `<b style="color:${b.color}">${b.name}</b><span class="hint">direction only</span>`);
                chart.baseDirty = true;
            },
            advance(seconds, rate) {
                s.t = (s.t + seconds * rate) % M.GEO_TILT_PERIOD;
                s.anomaly += seconds * 90;
                return true;
            },
            restart() {
                s.t = 0;
            },
            sync() {
                const { incDeg, nodeDeg } = tilt();
                frame.place(nodeDeg, incDeg, 0);
                satellite.position.set(GEO_DRAW * Math.cos(s.anomaly * D2R), GEO_DRAW * Math.sin(s.anomaly * D2R), 0);
                earth.pivot.rotation.z = state.earthDeg * D2R;
                ascNode.set(Math.cos(nodeDeg * D2R), Math.sin(nodeDeg * D2R), 0).multiplyScalar(GEO_DRAW);
                nodeDot.position.copy(ascNode);
                nodeDot.visible = incDeg > 0.3;

                const b = body();
                const bodyKm = [bodyDir.x * b.d, bodyDir.y * b.d, bodyDir.z * b.d];
                frame.outer.updateMatrixWorld(true);
                for (let k = 0; k < ARROWS; k++) {
                    const u = k / ARROWS * TAU;
                    unit.set(Math.cos(u), Math.sin(u), 0).applyQuaternion(frame.outer.quaternion);
                    const acc = M.thirdBodyAccel(b.mu, bodyKm, [unit.x * M.R_GEO, unit.y * M.R_GEO, unit.z * M.R_GEO]);
                    const mag = Math.hypot(acc[0], acc[1], acc[2]);
                    const arrow = arrows[k];
                    arrow.position.copy(unit).multiplyScalar(GEO_DRAW);
                    arrow.setDirection(dir.set(acc[0], acc[1], acc[2]).divideScalar(mag));
                    setArrowLength(arrow, Math.max(0.04, mag / PEAK * 0.9));
                }
            },
            labels() {
                showLabel(bodyLabel, bodyMesh.position);
                if (nodeDot.visible) showLabel(nodeLabel, ascNode);
            },
            stats() {
                const { incDeg, nodeDeg } = tilt();
                return [
                    { label: 'Elapsed', value: `${s.t.toFixed(1)} yr` },
                    { label: 'Inclination', value: `${incDeg.toFixed(2)}°` },
                    { label: 'Tilt rate', value: `${s.hold ? '0.000' : fixed(M.geoTiltRate(s.t), 3)}°/yr` },
                    { label: 'Node (RAAN)', value: incDeg < 0.01 ? 'None' : `${M.wrap360(nodeDeg).toFixed(1)}°` },
                    { label: 'N-S Δv budget', value: `${M.NORTH_SOUTH_DV.total} m/s/yr` },
                    { label: 'Δv spent', value: `${s.hold ? comma(M.NORTH_SOUTH_DV.total * s.t, 1) : '0'} m/s` }
                ];
            },
            // Equation-sheet formulas only: the plane change that undoes the tilt.
            equations() {
                const { incDeg } = tilt();
                const v = Math.sqrt(M.MU / M.R_GEO); // km/s
                const planeChange = (deg) => Math.abs(2 * v * Math.sin(deg * D2R / 2)) * 1000; // m/s
                const yearTilt = M.geoTilt(1).incDeg;
                return {
                    title: 'Undoing the Tilt',
                    constants: 'μ = 398,600.44 km³/s². A plane change at the node removes the tilt. The lesson\'s yearly budget, 51.4 m/s, comes from a fuller model.',
                    rows: [
                        { name: 'Circular-orbit speed at GEO', result: `${v.toFixed(3)} km/s`, work: work('V = √(μ / R)', 'R = 42,164 km') },
                        { name: 'Plane change for the tilt now', result: `${comma(planeChange(incDeg), 1)} m/s`, work: work('ΔV<sub>S</sub> = |2V sin(θ / 2)|', s.hold ? 'θ = 0 (held flat)' : `θ = ${incDeg.toFixed(2)}°`) },
                        { name: 'Plane change for one year of tilt', result: `${comma(planeChange(yearTilt), 1)} m/s`, work: work('ΔV<sub>S</sub> = |2V sin(θ / 2)|', `θ = ${yearTilt.toFixed(3)}°`) }
                    ]
                };
            },
            impact: () => 'The Sun and Moon pull harder on the near side of the orbit than on Earth, and harder on Earth than on the far side. Because they sit off the equator, that difference tilts a GEO orbit by about 0.75° to 0.95° per year, to about 15° after 27 years. The ground trace becomes a daily figure-eight. North-south station-keeping costs about 51.4 m/s per year, over 95% of a GEO budget.',
            regime: () => 'High orbits. The effect grows with altitude and passes J₂ above about 33,800 km, so it leads at GEO and beyond. In LEO it is far smaller than J₂ and drag.',
            notice: () => 'Arrows show only the difference from the pull on Earth. The gray ring is the two-body orbit, which would stay on the equator.',
            hud: () => (s.hold
                ? '<span class="key-moon">Station-keeping</span> holds the orbit flat. This is over 95% of station-keeping Δv.'
                : 'The Sun and Moon slowly tilt the orbit out of the equator.'),
            caption: () => 'Ring, arrows, and body distance are not to scale. The body stays at one direction for clarity.',
            altitudeMarker: () => [35786, 35786],
            drawChartBase(g, w, h) {
                const { left } = plotsFor(w, h);
                drawGrid(g, left, [0, 10, 20, 30, 40, 53].map((v) => ({ v, label: `${v}` })), [0, 5, 10, 15].map((v) => ({ v, label: `${v}°` })), { xTitle: 'years' });
                const pts = [];
                for (let t = 0; t <= 53; t += 0.5) pts.push([left.X(t), left.Y(M.geoTilt(t).incDeg)]);
                strokePath(g, pts, body().color, 1.8, s.hold ? 0.3 : 0.4);
            },
            drawChartLive(g, w, h) {
                const { left, area } = plotsFor(w, h);
                const color = body().color;
                const { incDeg } = tilt();
                if (s.hold) {
                    strokePath(g, [[left.X(0), left.Y(0)], [left.X(s.t), left.Y(0)]], color, 2);
                } else {
                    const pts = [];
                    for (let t = 0; t <= s.t; t += 0.25) pts.push([left.X(t), left.Y(M.geoTilt(t).incDeg)]);
                    pts.push([left.X(s.t), left.Y(incDeg)]);
                    strokePath(g, pts, color, 2);
                }
                cursor(g, left, left.X(s.t));
                fillDot(g, left.X(s.t), left.Y(incDeg), 3.5, color);

                // Right: the daily figure-eight seen from the ground, fitted to the current inclination.
                const fig = M.figureEight(incDeg, 120);
                let lonMax = 0;
                for (const f of fig) lonMax = Math.max(lonMax, Math.abs(f.lonOffset));
                const flat = incDeg < 0.02;
                const latR = flat ? 0.2 : Math.max(0.2, incDeg * 1.15);
                const lonR = flat ? 0.2 : Math.max(1e-4, lonMax * 1.15);
                const plot = makePlot(area, -lonR, lonR, -latR, latR);
                g.save();
                g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
                g.strokeRect(area.x0 + 0.5, area.y0 + 0.5, area.x1 - area.x0 - 1, area.y1 - area.y0 - 1);
                g.strokeStyle = CHART_GRID;
                g.beginPath();
                g.moveTo(plot.X(0), area.y0); g.lineTo(plot.X(0), area.y1);
                g.moveTo(area.x0, plot.Y(0)); g.lineTo(area.x1, plot.Y(0));
                g.stroke();
                g.restore();
                if (incDeg > 0.02) strokePath(g, fig.map((f) => [plot.X(f.lonOffset), plot.Y(f.lat)]), color, 1.8);
                fillDot(g, plot.X(0), plot.Y(0), 2.5, '#ffffff');
                chartText(g, `±${incDeg.toFixed(1)}° lat`, area.x0 + 3, area.y0 + 3);
                chartText(g, 'Longitude stretched', (area.x0 + area.x1) / 2, area.y1 + 4, CHART_TEXT, 'center');
            }
        };
        // Left: inclination over the 53-year cycle. Right: the area for the figure-eight.
        function plotsFor(w, h) {
            const split = Math.round(w * 0.62);
            const leftArea = { x0: 40, y0: 10, x1: split - 8, y1: h - 26 };
            const area = { x0: split + 10, y0: 10, x1: w - 10, y1: h - 26 };
            return { left: makePlot(leftArea, 0, 53, 0, 16), area };
        }

        Kit.bindSegmented($('third-body'), (v) => { s.body = v; changed(); });
        $('third-hold').addEventListener('change', (e) => {
            s.hold = e.target.checked;
            s.t = 0;
            changed();
        });

        let chart;
        mode.attachChart = (c) => { chart = c; };
        return mode;
    }

    /* ===================================================================================== */
    /* MODE: SRP                                                                              */
    /* ===================================================================================== */
    function buildSrp() {
        const group = new THREE.Group();
        const s = { area: 'dense', t: 0, anomaly: 0 };
        const DRAWN = { dense: 0.10, arrays: 0.17, foil: 0.28 };
        const SUN_PATH_RADIUS = 4.8;

        const ghost = makeOrbitRing({ color: COLOR.ghost, tube: 0.007, opacity: 0.45 });
        ghost.setShape('circle', () => GEO_DRAW);
        group.add(ghost.mesh);
        const frame = makeOrbitFrame(group);
        const real = makeOrbitRing({ color: COLOR.srp });
        frame.inner.add(real.mesh);
        const perigeeDot = makeDot(0.05, COLOR.srp, frame.inner);
        const perigeeLabel = layer.add(`<b style="color:${COLOR.srp}">Perigee</b>`, { rank: 1 });
        const satellite = makeDot(0.06, '#ffffff', group);
        const arrow = makeArrow(COLOR.srp, group);
        setArrowLength(arrow, 0.5);
        const arrowLabel = layer.add(`<b style="color:${COLOR.srp}">SRP</b>`, { rank: 1 });

        const sunGroup = new THREE.Group();
        group.add(sunGroup);
        const sunBody = new THREE.Mesh(new THREE.SphereGeometry(0.27, 32, 20), new THREE.MeshBasicMaterial({ color: hex('#ffe6a0') }));
        sunBody.position.set(SUN_PATH_RADIUS, 0, 0);
        sunGroup.add(sunBody);
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = glowCanvas.height = 128;
        const gg = glowCanvas.getContext('2d');
        const gradient = gg.createRadialGradient(64, 64, 8, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255, 225, 150, 0.9)');
        gradient.addColorStop(0.35, 'rgba(255, 190, 90, 0.28)');
        gradient.addColorStop(1, 'rgba(255, 170, 60, 0)');
        gg.fillStyle = gradient;
        gg.fillRect(0, 0, 128, 128);
        const glowTexture = new THREE.CanvasTexture(glowCanvas);
        glowTexture.colorSpace = THREE.SRGBColorSpace;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        glow.scale.setScalar(2.2);
        glow.position.copy(sunBody.position);
        sunGroup.add(glow);
        makeCircle(SUN_PATH_RADIUS, '#475569', 1, group);
        const sunLabel = layer.add('<b style="color:#ffe6a0">Sun</b>', { rank: 0 });
        const sunWorld = new THREE.Vector3();
        const Z_AXIS = new THREE.Vector3(0, 0, 1);
        const awayFromSun = new THREE.Vector3();

        const sunAngle = () => M.SUN_RATE * s.t * M.DAY_S;
        const ecc = () => M.srpEccVector(s.t, M.AREA_SRP[s.area]);
        const rE = () => M.srpRadius(M.AREA_SRP[s.area]);
        const drawnE = () => (ecc().e / (2 * rE())) * DRAWN[s.area];
        const shapeFor = (de) => (nu) => GEO_DRAW * (1 - de * de) / (1 + de * Math.cos(nu));

        const mode = {
            id: 'srp', group,
            speeds: [{ rate: 15, label: '15 days/s' }, { rate: 45, label: '45 days/s' }, { rate: 120, label: '120 days/s' }],
            home: { az: -90, el: 62, dist: 14 },
            aria: 'Earth seen from above the equator, with the Sun circling once a year. A gray circular GEO ring and a yellow ring that stretches into an ellipse and back over the year.',
            chartTitle: 'Eccentricity Over One Year',
            lightDirection: () => [Math.cos(sunAngle()), Math.sin(sunAngle()), 0.15],
            rebuild() {
                chart.baseDirty = true;
            },
            advance(seconds, rate) {
                s.t = (s.t + seconds * rate) % M.YEAR_DAYS;
                s.anomaly += seconds * 90;
                return true;
            },
            restart() {
                s.t = 0;
            },
            sync() {
                const de = drawnE();
                const v = ecc();
                const shape = shapeFor(de);
                real.setShape(de.toFixed(4), shape);
                frame.place(0, 0, v.perigeeDeg);
                perigeeDot.position.set(shape(0), 0, 0);
                perigeeDot.visible = de >= 0.005;
                const L = sunAngle();
                sunGroup.rotation.z = L;
                earth.pivot.rotation.z = state.earthDeg * D2R;
                satellitePoint(satellite.position, s.anomaly, de, shape);
                satellite.position.applyAxisAngle(Z_AXIS, v.perigeeDeg * D2R);
                arrow.position.copy(satellite.position);
                arrow.setDirection(awayFromSun.set(-Math.cos(L), -Math.sin(L), 0));
            },
            labels() {
                sunBody.getWorldPosition(sunWorld);
                showLabel(sunLabel, sunWorld);
                if (perigeeDot.visible) showAt(perigeeLabel, perigeeDot);
                showLabel(arrowLabel, sunWorld.set(-Math.cos(sunAngle()), -Math.sin(sunAngle()), 0).multiplyScalar(0.5).add(satellite.position));
            },
            stats() {
                const v = ecc();
                const peak = 2 * rE();
                return [
                    { label: 'Day of year', value: `${Math.floor(s.t)}` },
                    { label: 'Eccentricity', value: v.e < 1e-3 ? sci(v.e, 3) : v.e.toFixed(4) },
                    { label: 'Peak eccentricity', value: peak < 1e-3 ? sci(peak, 3) : peak.toFixed(3) },
                    { label: 'SRP acceleration', value: `${sci(M.srpAccel(M.AREA_SRP[s.area]), 3)} m/s²` },
                    { label: 'Area-to-mass', value: `${M.AREA_SRP[s.area]} m²/kg` },
                    { label: 'Peak perigee dip', value: `${comma(M.srpPerigeeDipKm(peak), peak < 0.01 ? 1 : 0)} km` }
                ];
            },
            // Equation-sheet formulas only, applied to the orbit as sunlight stretches it. a does not change.
            equations() {
                const a = M.R_GEO;
                const { e } = ecc();
                const rp = a * (1 - e), ra = a * (1 + e);
                const eText = e < 1e-3 ? sci(e, 3) : e.toFixed(4);
                const d = rp < a - 100 ? 0 : 1;
                return {
                    title: 'Orbit Shape Under Sunlight',
                    constants: 'μ = 398,600.44 km³/s², R⊕ = 6,378.137 km. Sunlight changes e but not a, so the period stays fixed while perigee dips and apogee rises.',
                    rows: [
                        { name: 'Perigee radius', result: `${comma(rp, d)} km`, work: work('R<sub>p</sub> = a(1 − e)', `a = 42,164 km, e = ${eText}`) },
                        { name: 'Apogee radius', result: `${comma(ra, d)} km`, work: work('R<sub>a</sub> = a(1 + e)') },
                        { name: 'Perigee altitude', result: `${comma(rp - 6378.137, d)} km`, work: work('R = altitude + R⊕', `GEO altitude ${comma(a - 6378.137, d)} km`) },
                        { name: 'Orbital period', result: `${(M.periodSeconds(a) / 3600).toFixed(3)} h`, work: work('Period = 2π √(a³ / μ)', 'unchanged') }
                    ]
                };
            },
            impact: () => 'Sunlight pushes steadily away from the Sun. Over half a year this stretches a circular GEO orbit, and over the next half it rounds out again. A dense satellite\'s perigee dips about 12 km. Light, wide objects such as foil debris act like solar sails, and their perigee drops by thousands of km.',
            regime: () => 'Every orbit in sunlight, with the same strength at any altitude. Above about 630 km it is larger than drag, so it is the main non-gravitational force at GEO. It grows with area-to-mass ratio.',
            notice: () => 'The gray ring is the circular two-body orbit. Watch perigee swing to follow the Sun while the orbit stretches and relaxes.',
            hud: () => (s.area === 'foil'
                ? '<span class="key-srp">Foil debris</span> is pushed so hard that its perigee drops by thousands of km.'
                : 'The orbit <span class="key-srp">stretches</span> for half a year, then rounds out again.'),
            caption: () => 'The shape is exaggerated, so read the true eccentricity in Live Values. The Sun is shown on the equator.',
            altitudeMarker: () => [35786, 35786],
            drawChartBase(g, w, h) {
                const p = plotsFor(w, h);
                drawGrid(g, p.left, [0, 91, 183, 274, 365].map((v) => ({ v, label: `${v}` })), p.yTicks, { xTitle: 'day', yTitle: p.yTitle });
                const pts = [];
                for (let d = 0; d <= 365.25; d += 2) pts.push([p.left.X(d), p.left.Y(M.srpEccVector(d, M.AREA_SRP[s.area]).e / p.scale)]);
                strokePath(g, pts, COLOR.srp, 1.8, 0.35);
                // Right: the yearly circle of the eccentricity vector.
                const a = p.area;
                g.save();
                g.strokeStyle = 'rgba(255, 255, 255, 0.22)';
                g.strokeRect(a.x0 + 0.5, a.y0 + 0.5, a.x1 - a.x0 - 1, a.y1 - a.y0 - 1);
                g.strokeStyle = CHART_GRID;
                g.beginPath();
                g.moveTo(p.ex(0), a.y0); g.lineTo(p.ex(0), a.y1);
                g.moveTo(a.x0, p.ey(0)); g.lineTo(a.x1, p.ey(0));
                g.stroke();
                g.strokeStyle = COLOR.srp;
                g.globalAlpha = 0.6;
                g.lineWidth = 1.5;
                g.beginPath();
                g.arc(p.ex(-p.r), p.ey(0), p.k * p.r, 0, TAU);
                g.stroke();
                g.restore();
                chartText(g, 'e vector', (a.x0 + a.x1) / 2, a.y1 + 4, CHART_TEXT, 'center');
            },
            drawChartLive(g, w, h) {
                const p = plotsFor(w, h);
                const v = ecc();
                const pts = [];
                for (let d = 0; d <= s.t; d += 2) pts.push([p.left.X(d), p.left.Y(M.srpEccVector(d, M.AREA_SRP[s.area]).e / p.scale)]);
                pts.push([p.left.X(s.t), p.left.Y(v.e / p.scale)]);
                strokePath(g, pts, COLOR.srp, 2);
                cursor(g, p.left, p.left.X(s.t));
                fillDot(g, p.left.X(s.t), p.left.Y(v.e / p.scale), 3.5, COLOR.srp);
                strokePath(g, [[p.ex(0), p.ey(0)], [p.ex(v.ex), p.ey(v.ey)]], '#ffffff', 1.4, 0.8);
                fillDot(g, p.ex(v.ex), p.ey(v.ey), 3.5, COLOR.srp);
                fillDot(g, p.ex(0), p.ey(0), 2, '#ffffff');
            }
        };
        function plotsFor(w, h) {
            const r = rE();
            const peak = 2 * r;
            const exp = Math.floor(Math.log10(peak * 1.1));
            const scale = Math.pow(10, exp);
            const yMax = 1.1 * peak / scale;
            const split = Math.round(w * 0.62);
            const left = makePlot({ x0: 40, y0: 10, x1: split - 8, y1: h - 26 }, 0, 365.25, 0, yMax);
            const area = { x0: split + 10, y0: 10, x1: w - 10, y1: h - 26 };
            // Equal scales on both axes: the circle spans x from -2r to 0 and y from -r to r.
            const k = Math.min((area.x1 - area.x0 - 12) / (2.4 * r), (area.y1 - area.y0 - 12) / (2.4 * r));
            const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2;
            return {
                left, area, r, k, scale,
                yTitle: exp === 0 ? 'e' : `e (× 10${sup(exp)})`,
                yTicks: ticks(0, yMax, 3).map((v) => ({ v, label: v.toFixed(niceStep(yMax, 3) < 1 ? 1 : 0) })),
                ex: (x) => cx + (x + r) * k,
                ey: (y) => cy - y * k
            };
        }

        Kit.bindSegmented($('srp-area'), (v) => { s.area = v; changed(); });

        let chart;
        mode.attachChart = (c) => { chart = c; };
        return mode;
    }

    /* ===================================================================================== */
    /* Mode controller                                                                        */
    /* ===================================================================================== */
    let dirty = true;
    let changed = () => { dirty = true; };
    const MODES = {};
    for (const build of [buildDrag, buildJ2, buildJ22, buildThird, buildSrp]) {
        const mode = build();
        mode.group.visible = false;
        scene.add(mode.group);
        MODES[mode.id] = mode;
    }
    const active = () => MODES[state.mode];

    // Every control: update the mode's state, rebuild, redraw.
    changed = () => {
        active().rebuild();
        captionDirty = true;
        dirty = true;
    };
    let captionDirty = true;

    /* "Which Perturbation Leads?" chart, shared by all modes. */
    const LEADS = [
        { key: 'central', name: 'Earth', color: COLOR.central },
        { key: 'j2', name: 'J₂', color: COLOR.j2 },
        { key: 'j22', name: 'J₂,₂', color: COLOR.j22, from: 2000 },
        { key: 'moon', name: 'Moon', color: COLOR.moon },
        { key: 'sun', name: 'Sun', color: COLOR.sun },
        { key: 'srp', name: 'SRP', color: COLOR.srp, dash: [5, 4] },
        { key: 'drag', name: 'Drag', color: COLOR.drag, to: 1000 }
    ];
    const HIGHLIGHT = { drag: ['drag'], j2: ['j2'], j22: ['j22'], third: ['moon', 'sun'], srp: ['srp'] };
    const LEAD_NAMES = { j2: 'J₂', j22: 'J₂,₂', thirdBody: 'Sun and Moon', srp: 'Solar radiation pressure', drag: 'Drag' };
    function leadsPlot(w, h) {
        return makePlot({ x0: 38, y0: 8, x1: w - 12, y1: h - 28 }, Math.log10(200), Math.log10(50000), -10, 1);
    }
    function drawLeadsBase(g, w, h) {
        const p = leadsPlot(w, h);
        const xt = [[200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k'], [50000, '50k']]
            .map(([v, label]) => ({ v: Math.log10(v), label }));
        const yt = [];
        for (let d = -10; d <= 1; d++) yt.push({ v: d, label: (d - 1) % 3 === 0 ? (d === 0 ? '1' : `10${sup(d)}`) : '' });
        drawGrid(g, p, xt, yt, { xTitle: 'altitude, km', yTitle: '' });
        const hi = HIGHLIGHT[state.mode];
        const ends = [];
        for (const c of LEADS) {
            const from = Math.log10(c.from || 200), to = Math.log10(c.to || 50000);
            const pts = [];
            for (let k = 0; k <= 80; k++) {
                const x = from + (to - from) * k / 80;
                const v = M.accelerationsAt(Math.pow(10, x))[c.key];
                if (v) pts.push([p.X(x), p.Y(clamp(Math.log10(v), -10, 1))]);
            }
            const on = hi.includes(c.key);
            strokePath(g, pts, c.color, on ? 2.2 : 1.3, on ? 1 : 0.55, c.dash);
            const last = pts[pts.length - 1];
            ends.push({ name: c.name, color: c.color, x: last[0], y: last[1], on });
        }
        // Labels at each curve's end, nudged apart so they do not overlap.
        ends.sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) {
            if (Math.abs(ends[i].x - ends[i - 1].x) < 40 && ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
        }
        for (const e of ends) {
            g.save();
            g.font = `${e.on ? '600 ' : ''}11px Inter, sans-serif`;
            g.globalAlpha = e.on ? 1 : 0.8;
            g.fillStyle = e.color;
            g.textAlign = 'right';
            g.textBaseline = 'bottom';
            g.strokeStyle = '#0d1726'; // a halo in the panel color keeps labels readable over the curves
            g.lineWidth = 3;
            g.lineJoin = 'round';
            g.strokeText(e.name, e.x - 2, e.y - 1);
            g.fillText(e.name, e.x - 2, e.y - 1);
            g.restore();
        }
        chartText(g, 'm/s²', p.area.x0 + 4, p.area.y1 - 4, CHART_TEXT, 'left', 'bottom');
    }
    function drawLeadsLive(g, w, h) {
        const p = leadsPlot(w, h);
        const [lo, hi] = active().altitudeMarker();
        const x0 = p.X(Math.log10(clamp(lo, 200, 50000))), x1 = p.X(Math.log10(clamp(hi, 200, 50000)));
        if (x1 - x0 > 1) {
            g.fillStyle = 'rgba(255, 255, 255, 0.07)';
            g.fillRect(x0, p.area.y0, x1 - x0, p.area.y1 - p.area.y0);
        }
        g.save();
        g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(Math.round(x0) + 0.5, p.area.y0);
        g.lineTo(Math.round(x0) + 0.5, p.area.y1);
        g.stroke();
        g.restore();
    }
    function leadsText() {
        const h = Math.max(200, active().altitudeMarker()[0]);
        return `Largest at ${comma(h)} km: ${LEAD_NAMES[M.leadingPerturbation(h)]}. Largest non-gravitational: ${LEAD_NAMES[M.leadingNonGravitational(h)]}.`;
    }

    const modeChart = makeChart('chart-box', 'chart', (g, w, h) => active().drawChartBase(g, w, h), (g, w, h) => active().drawChartLive(g, w, h));
    const leadsChart = makeChart('leads-box', 'leads', drawLeadsBase, drawLeadsLive);
    for (const mode of Object.values(MODES)) {
        mode.attachChart(modeChart);
        mode.rebuild();
    }
    chartsReady = true;

    /* Camera */
    function startBlend(target) {
        blend.from = { ...camView };
        blend.to = target;
        blend.t = 0;
    }
    function stepBlend(seconds) {
        if (blend.t >= 1) return false;
        blend.t = Math.min(1, blend.t + seconds / 0.6);
        const t = blend.t, e = t * t * (3 - 2 * t);
        camView.az = blend.from.az + M.wrap180(blend.to.az - blend.from.az) * e;
        camView.el = blend.from.el + (blend.to.el - blend.from.el) * e;
        camView.dist = blend.from.dist + (blend.to.dist - blend.from.dist) * e;
        return true;
    }
    function updateCamera() {
        const fit = Math.min(1, (viewW / viewH) * 0.85);
        const d = camView.dist / fit;
        const el = camView.el * D2R, az = camView.az * D2R;
        camera.position.set(d * Math.cos(el) * Math.cos(az), d * Math.cos(el) * Math.sin(az), d * Math.sin(el));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
    }

    function setMode(id) {
        active().group.visible = false;
        state.mode = id;
        const mode = active();
        mode.group.visible = true;
        for (const el of document.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== id;
        $('speed-value').textContent = mode.speeds[state.speed].label;
        canvas.setAttribute('aria-label', mode.aria);
        setText($('chart-title'), mode.chartTitle);
        modeChart.baseDirty = true;
        leadsChart.baseDirty = true;
        startBlend(mode.home);
        // A finished drag decay pauses itself. Moving to another mode resumes play.
        if (state.autoPaused) setPlaying(true);
        captionDirty = true;
        layer.remeasure();
        dirty = true;
    }

    /* Panels */
    const EQ_ROWS = 5;
    function updatePanels() {
        const mode = active();
        mode.stats().forEach((stat, i) => {
            setText($(`stat-${i}-label`), stat.label);
            setText($(`stat-${i}`), stat.value);
        });
        const eq = mode.equations();
        setText($('eq-title'), eq.title);
        setText($('eq-constants'), eq.constants);
        for (let i = 0; i < EQ_ROWS; i++) {
            const row = eq.rows[i];
            const box = $(`eq-${i}-name`).closest('.eq-row');
            if (box.hidden !== !row) box.hidden = !row;
            if (!row) continue;
            setText($(`eq-${i}-name`), row.name);
            setText($(`eq-${i}-result`), row.result);
            setHTML($(`eq-${i}-work`), row.work);
        }
        setText($('impact'), mode.impact());
        setText($('regime'), mode.regime());
        setText($('notice'), mode.notice());
        const before = hud.innerHTML;
        setHTML(hud, mode.hud());
        if (hud.innerHTML !== before) layer.remeasure();
        setText($('leads-text'), leadsText());
        if (captionDirty) {
            setText($('mode-caption'), mode.caption());
            captionDirty = false;
        }
    }

    function updateLabels() {
        layer.begin();
        if (state.showLabels) {
            showLabel(northLabel, northPoint);
            active().labels();
        }
        layer.place(viewW, viewH, [Kit.overlayBox(hud, view)]);
    }

    function renderFrame() {
        const mode = active();
        mode.sync();
        const l = mode.lightDirection();
        sunLight.position.set(l[0], l[1], l[2]).normalize().multiplyScalar(10);
        updateCamera();
        stars.follow(camera);
        renderer.render(scene, camera);
        updateLabels();
        modeChart.draw();
        leadsChart.draw();
    }

    /* Controls */
    setPlaying = (value) => {
        state.autoPaused = false;
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
    };
    $('play').addEventListener('click', () => {
        const mode = active();
        if (!state.playing && mode.done && mode.done()) mode.restart();
        setPlaying(!state.playing);
        dirty = true;
    });
    $('restart').addEventListener('click', () => {
        active().restart();
        setPlaying(true);
        dirty = true;
    });
    $('reset-view').addEventListener('click', () => startBlend(active().home));
    $('speed').addEventListener('input', (e) => {
        state.speed = Number(e.target.value);
        $('speed-value').textContent = active().speeds[state.speed].label;
    });
    const selectMode = Kit.bindSegmented($('mode'), (value) => {
        if (value !== state.mode || !active().group.visible) setMode(value);
    });
    $('show-labels').addEventListener('change', (e) => {
        state.showLabels = e.target.checked;
        dirty = true;
    });

    // On large screens, reserve the height of the tallest set of mode rows, so that the view does not
    // jump between modes. Not on phones or tablets, where the page scrolls.
    const rowsBox = $('mode-rows');
    const largeScreen = matchMedia('(min-width: 1081px) and (min-height: 600px)');
    function reserveRows() {
        rowsBox.style.minHeight = '';
        if (!largeScreen.matches) return;
        let tallest = 0;
        const rows = [...rowsBox.querySelectorAll('[data-mode]')];
        for (const id of Object.keys(MODES)) {
            for (const el of rows) el.hidden = el.dataset.mode !== id;
            tallest = Math.max(tallest, rowsBox.offsetHeight);
        }
        for (const el of rows) el.hidden = el.dataset.mode !== state.mode;
        rowsBox.style.minHeight = `${tallest}px`;
    }
    let reserveFrame = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(reserveFrame);
        reserveFrame = requestAnimationFrame(reserveRows);
    });

    /* Drag to rotate. Scroll or pinch to zoom. */
    const hint = $('view-hint');
    hint.style.display = '';
    const pointers = new Map();
    let pinchStart = 0, pinchDist = 0;
    const clampZoom = (d) => Math.min(ZOOM.max, Math.max(ZOOM.min, d));
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        blend.t = 1;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
            pinchDist = camView.dist;
        }
        hint.style.display = 'none';
    });
    canvas.addEventListener('pointermove', (e) => {
        const last = pointers.get(e.pointerId);
        if (!last) return;
        if (pointers.size === 1) {
            camView.az -= (e.clientX - last.x) * 0.35;
            camView.el = Math.min(86, Math.max(-86, camView.el + (e.clientY - last.y) * 0.3));
        }
        last.x = e.clientX;
        last.y = e.clientY;
        if (pointers.size === 2 && pinchStart > 0) {
            const [a, b] = [...pointers.values()];
            camView.dist = clampZoom(pinchDist * pinchStart / Math.hypot(a.x - b.x, a.y - b.y));
        }
        dirty = true;
    });
    const endPointer = (e) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        blend.t = 1;
        camView.dist = clampZoom(camView.dist * Math.exp(e.deltaY * 0.0012));
        dirty = true;
    }, { passive: false });

    /* Start */
    selectMode('drag');
    Object.assign(camView, active().home);
    blend.t = 1;
    setPlaying(state.playing);
    reserveRows();
    status.style.display = 'none';

    Kit.observeSize(view, (width, height) => {
        viewW = width;
        viewH = height;
        renderer.setSize(viewW, viewH, false);
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
        layer.remeasure();
        renderFrame(); // Resizing clears the canvas, so draw at once to avoid a blank frame.
    });

    Kit.startLoop((seconds) => {
        if (state.playing) {
            state.earthDeg += seconds * EARTH_SPIN_RATE;
            if (active().advance(seconds, active().speeds[state.speed].rate)) dirty = true;
        }
        if (stepBlend(seconds)) dirty = true;
        if (!dirty) return;
        dirty = false;
        renderFrame();
        updatePanels();
    });
})();
