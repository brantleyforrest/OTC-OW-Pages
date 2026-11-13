// Mechanical Energy: a spacecraft on an ellipse beside bars for its specific kinetic,
// potential, and mechanical energy. Drawn on a 2D canvas. See _template/README.md.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;

    /* Constants and settings */
    const MU = 398600.44;      // km^3/s^2, Earth's gravitational parameter
    const RE = 6378;           // km, Earth's equatorial radius
    const ALT_MIN = 100;       // km
    const ALT_MAX = 100000;    // km
    const COLORS = {
        ke: '#34d399',
        pe: '#60a5fa',
        total: '#e0b64f',
        orbit: '#3a5a8c',
        dim: '#64748b',
        text: '#f0f4fa',
        muted: '#94a3b8'
    };
    // Seconds of animation for one orbit. The motion follows Kepler's second law, so the
    // spacecraft still moves fastest at perigee.
    const SPEEDS = [
        { period: 24, label: 'Slow' },
        { period: 12, label: 'Normal' },
        { period: 6, label: 'Fast' }
    ];
    const PRESETS = {
        gto: { hp: 300, ha: 35786 },      // Transfer orbit to geostationary altitude
        molniya: { hp: 600, ha: 39700 },  // A 12-hour, highly elliptical orbit
        lesson: { hp: 500, ha: 1500 },    // The worked example in the 2-Body Motion lesson
        circular: { hp: 1000, ha: 1000 }
    };
    const DEFAULT_PRESET = 'gto';

    /* State */
    const state = {
        hp: PRESETS[DEFAULT_PRESET].hp,
        ha: PRESETS[DEFAULT_PRESET].ha,
        preset: DEFAULT_PRESET,
        M: 0,               // Mean anomaly, rad
        playing: !Kit.prefersReducedMotion(),
        speed: 1,
        showVelocity: true,
        showLabels: true
    };

    /* Orbit math */
    function orbit() {
        const Rp = RE + state.hp;
        const Ra = RE + state.ha;
        const a = (Ra + Rp) / 2;
        const e = (Ra - Rp) / (Ra + Rp);
        const p = a * (1 - e * e);
        const eps = -MU / (2 * a);
        const period = 2 * Math.PI * Math.sqrt(a * a * a / MU);
        const speedAt = (R) => Math.sqrt(2 * (MU / R + eps));
        return { Rp, Ra, a, e, p, eps, period, Vp: speedAt(Rp), Va: speedAt(Ra), speedAt };
    }

    // Kepler's equation, M = E - e sin E, solved for E by Newton's method.
    function eccentricAnomaly(M, e) {
        let E = e > 0.8 ? Math.PI : M;
        for (let i = 0; i < 30; i++) {
            const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= step;
            if (Math.abs(step) < 1e-12) break;
        }
        return E;
    }

    function trueFromMean(M, e) {
        const E = eccentricAnomaly(M, e);
        const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        return wrap(nu);
    }

    function meanFromTrue(nu, e) {
        const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
        return wrap(E - e * Math.sin(E));
    }

    function wrap(angle) {
        const t = 2 * Math.PI;
        return ((angle % t) + t) % t;
    }

    // The spacecraft's state at true anomaly nu, in the orbit plane with perigee along +x.
    function pointAt(o, nu) {
        const R = o.p / (1 + o.e * Math.cos(nu));
        const vScale = Math.sqrt(MU / o.p);
        const V = o.speedAt(R);
        return {
            nu, R, V,
            x: R * Math.cos(nu),
            y: R * Math.sin(nu),
            vx: -vScale * Math.sin(nu),
            vy: vScale * (o.e + Math.cos(nu)),
            ke: V * V / 2,
            pe: -MU / R
        };
    }

    /* Number formatting. Negative numbers use a true minus sign. */
    const fixed = (value, digits) => (value < 0 ? '−' : '') + Math.abs(value).toFixed(digits);
    const comma = (value) => Math.round(value).toLocaleString('en-US');

    /* View */
    const view = $('view');
    const canvas = $('scene');
    const ctx = canvas.getContext('2d');
    const hud = $('hud');
    const layer = new Kit.LabelLayer($('labels'));
    const labels = {
        craft: layer.add('', { rank: 0 }),
        perigee: layer.add('<b>Perigee</b><span class="hint">fastest</span>', { rank: 1 }),
        apogee: layer.add('<b>Apogee</b><span class="hint">slowest</span>', { rank: 1 }),
        earth: layer.add('<b>Earth</b>', { rank: 3, optional: true })
    };
    let craftLabelText = '';
    let W = 1, H = 1;
    let dirty = true;

    function setCraftLabel(text) {
        if (text === craftLabelText) return;
        craftLabelText = text;
        labels.craft.el.innerHTML = text;
        labels.craft.width = 0; // Measure again, because the text changed
    }

    // Splits the view into the orbit area and the energy chart. Wide views put the chart on
    // the right, and tall views put it below. The status box is kept clear of both.
    function layout() {
        const hudBox = Kit.overlayBox(hud, view);
        const reserveTop = (x0, x1) => {
            if (!hudBox) return 0;
            const overlaps = hudBox.x < x1 && hudBox.x + hudBox.w > x0;
            return overlaps ? hudBox.y + hudBox.h + 4 : 0;
        };
        if (W >= H * 1.05) {
            const chartW = Math.min(320, Math.max(200, W * 0.32));
            const orbitBox = { x: 0, y: 0, w: W - chartW, h: H };
            const chartBox = { x: W - chartW, y: 0, w: chartW, h: H };
            orbitBox.top = reserveTop(orbitBox.x, orbitBox.x + orbitBox.w);
            chartBox.top = reserveTop(chartBox.x, chartBox.x + chartBox.w);
            return { orbitBox, chartBox, wide: true };
        }
        const chartH = Math.min(260, Math.max(150, H * 0.4));
        const orbitBox = { x: 0, y: 0, w: W, h: H - chartH };
        const chartBox = { x: 0, y: H - chartH, w: W, h: chartH };
        orbitBox.top = reserveTop(0, W);
        chartBox.top = 0;
        return { orbitBox, chartBox, wide: false };
    }

    function arrow(x0, y0, x1, y1, color, width) {
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1) return;
        const ux = dx / len, uy = dy / len;
        const head = Math.min(10, len * 0.45);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1 - ux * head * 0.8, y1 - uy * head * 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
        ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
        ctx.closePath();
        ctx.fill();
    }

    function drawOrbit(o, now, box) {
        const margin = 34;
        const top = box.y + Math.max(box.top, 0);
        const h = box.h - (top - box.y);
        const b = o.a * Math.sqrt(1 - o.e * o.e);
        const s = Math.max(1e-6, Math.min((box.w - 2 * margin) / (2 * o.a), (h - 2 * margin) / (2 * b)));
        const centerX = box.x + box.w / 2;
        const centerY = top + h / 2;
        // Earth sits at the focus, which is a*e from the ellipse's center toward perigee.
        const fx = centerX + s * o.a * o.e;
        const fy = centerY;
        const toScreen = (x, y) => [fx + s * x, fy - s * y];

        // Earth
        const earthR = Math.max(3, s * RE);
        const glow = ctx.createRadialGradient(fx - earthR * 0.3, fy - earthR * 0.3, earthR * 0.1, fx, fy, earthR);
        glow.addColorStop(0, '#3b82f6');
        glow.addColorStop(1, '#1e3a8a');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(fx, fy, earthR, 0, 2 * Math.PI);
        ctx.fill();

        // Line of apsides
        const [px, py] = toScreen(o.Rp, 0);
        const [ax, ay] = toScreen(-o.Ra, 0);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);

        // Orbit path
        ctx.strokeStyle = COLORS.orbit;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, s * o.a, s * b, 0, 0, 2 * Math.PI);
        ctx.stroke();

        // Velocity arrows. The perigee arrow sets the scale, so arrow lengths compare speeds.
        const maxArrow = Math.max(24, Math.min(box.w, h) * 0.2);
        const arrowFor = (pt) => {
            const [sx, sy] = toScreen(pt.x, pt.y);
            const len = maxArrow * pt.V / o.Vp;
            const vlen = Math.hypot(pt.vx, pt.vy);
            return [sx, sy, sx + len * pt.vx / vlen, sy - len * pt.vy / vlen];
        };
        if (state.showVelocity && o.e > 0.0005) {
            for (const nu of [0, Math.PI]) {
                const [x0, y0, x1, y1] = arrowFor(pointAt(o, nu));
                arrow(x0, y0, x1, y1, 'rgba(52, 211, 153, 0.35)', 1.5);
            }
        }

        // Apse markers
        for (const [x, y, color] of [[px, py, COLORS.ke], [ax, ay, COLORS.pe]]) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        }

        // Radius line and spacecraft
        const [cx, cy] = toScreen(now.x, now.y);
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);

        if (state.showVelocity) {
            const [x0, y0, x1, y1] = arrowFor(now);
            arrow(x0, y0, x1, y1, COLORS.ke, 2.5);
        }

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#03060c';
        ctx.lineWidth = 2;
        ctx.stroke();

        return {
            craft: [cx, cy], perigee: [px, py], apogee: [ax, ay], earth: [fx, fy - earthR],
            earthBox: { x: fx - earthR, y: fy - earthR, w: 2 * earthR, h: 2 * earthR }
        };
    }

    function drawChart(o, now, box) {
        const pad = 14;
        const top = box.y + Math.max(box.top, 0) + 12;
        const titleH = 22;
        const footH = 40;
        const plotTop = top + titleH;
        const plotBottom = box.y + box.h - footH;
        const plotH = Math.max(20, plotBottom - plotTop);
        const left = box.x + pad;
        const right = box.x + box.w - pad;

        // Divider between the orbit and the chart
        ctx.strokeStyle = 'rgba(28, 46, 74, 0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (box.x > 0) {
            ctx.moveTo(box.x + 0.5, box.y + 10);
            ctx.lineTo(box.x + 0.5, box.y + box.h - 10);
        } else {
            ctx.moveTo(box.x + 10, box.y + 0.5);
            ctx.lineTo(box.x + box.w - 10, box.y + 0.5);
        }
        ctx.stroke();

        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Specific energy (km²/s²)', left, top + 12);

        // The scale runs from the perigee kinetic energy down to the perigee potential energy,
        // the largest values on this orbit.
        const keMax = o.Vp * o.Vp / 2;
        const peMin = -MU / o.Rp;
        const yOf = (value) => plotTop + (keMax - value) / (keMax - peMin) * plotH;
        const y0 = yOf(0);

        const columns = [
            { key: 'ke', name: 'sKE', value: now.ke, color: COLORS.ke, perigee: o.Vp * o.Vp / 2, apogee: o.Va * o.Va / 2 },
            { key: 'pe', name: 'sPE', value: now.pe, color: COLORS.pe, perigee: -MU / o.Rp, apogee: -MU / o.Ra },
            { key: 'total', name: 'ε', value: o.eps, color: COLORS.total }
        ];
        const slot = (right - left) / columns.length;
        const barW = Math.min(46, slot * 0.46);

        // Zero line
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y0);
        ctx.lineTo(right, y0);
        ctx.stroke();
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = COLORS.dim;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('0', right, y0 - 2);

        // The total stays fixed, so its level is drawn across the whole chart.
        const yEps = yOf(o.eps);
        ctx.strokeStyle = 'rgba(224, 182, 79, 0.55)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(left, yEps);
        ctx.lineTo(right, yEps);
        ctx.stroke();
        ctx.setLineDash([]);

        columns.forEach((col, i) => {
            const cx = left + slot * (i + 0.5);
            const x = cx - barW / 2;

            // The range swept between perigee and apogee
            if (col.perigee !== undefined) {
                const yA = yOf(col.apogee), yP = yOf(col.perigee);
                ctx.fillStyle = 'rgba(148, 163, 184, 0.07)';
                ctx.fillRect(x - 6, Math.min(yA, yP), barW + 12, Math.abs(yP - yA));
            }

            const yV = yOf(col.value);
            ctx.fillStyle = col.color;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(x, Math.min(y0, yV), barW, Math.max(1, Math.abs(yV - y0)));
            ctx.globalAlpha = 1;

            // Perigee and apogee marks
            if (col.perigee !== undefined && o.e > 0.0005) {
                ctx.font = '600 10px Inter, sans-serif';
                ctx.textBaseline = 'middle';
                for (const [value, tag] of [[col.perigee, 'P'], [col.apogee, 'A']]) {
                    const y = yOf(value);
                    ctx.strokeStyle = '#cbd5e1';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x - 6, y);
                    ctx.lineTo(x + barW + 6, y);
                    ctx.stroke();
                    ctx.fillStyle = '#cbd5e1';
                    ctx.textAlign = 'left';
                    ctx.fillText(tag, x + barW + 9, y);
                }
            }

            // Name and value beneath the plot
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '600 12px "JetBrains Mono", monospace';
            ctx.fillStyle = col.color;
            ctx.fillText(col.name, cx, plotBottom + 17);
            ctx.font = '12px "JetBrains Mono", monospace';
            ctx.fillStyle = COLORS.text;
            ctx.fillText(fixed(col.value, 2), cx, plotBottom + 33);
        });

        // Plus and equals signs between the columns, read as sKE + sPE = ε
        ctx.font = '600 13px Inter, sans-serif';
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'center';
        ctx.fillText('+', left + slot, plotBottom + 17);
        ctx.fillText('=', left + slot * 2, plotBottom + 17);
    }

    function draw() {
        const o = orbit();
        const now = pointAt(o, trueFromMean(state.M, o.e));

        ctx.fillStyle = '#03060c';
        ctx.fillRect(0, 0, W, H);

        const { orbitBox, chartBox } = layout();
        const spots = drawOrbit(o, now, orbitBox);
        drawChart(o, now, chartBox);

        setCraftLabel(`<b>V</b> ${now.V.toFixed(2)} km/s`);
        layer.begin();
        if (state.showLabels) {
            layer.show(labels.craft, ...spots.craft);
            if (o.e > 0.0005) {
                layer.show(labels.perigee, ...spots.perigee);
                layer.show(labels.apogee, ...spots.apogee);
            }
            layer.show(labels.earth, ...spots.earth);
        }
        // Labels keep off the chart, and off Earth, which nearly touches perigee on low orbits.
        layer.place(W, H, [Kit.overlayBox(hud, view), spots.earthBox, chartBox]);

        updatePanels(o, now);
    }

    /* Panels */
    function updatePanels(o, now) {
        const peri = pointAt(o, 0);
        const apo = pointAt(o, Math.PI);
        const rows = [
            ['r', (pt) => comma(pt.R)],
            ['v', (pt) => pt.V.toFixed(2)],
            ['ke', (pt) => fixed(pt.ke, 2)],
            ['pe', (pt) => fixed(pt.pe, 2)],
            ['e', () => fixed(o.eps, 2)]
        ];
        for (const [key, format] of rows) {
            $(`c-${key}-p`).textContent = format(peri);
            $(`c-${key}-n`).textContent = format(now);
            $(`c-${key}-a`).textContent = format(apo);
        }

        $('r-ke').textContent = `${fixed(now.ke, 2)} km²/s²`;
        $('w-ke-v').textContent = now.V.toFixed(2);
        $('r-pe').textContent = `${fixed(now.pe, 2)} km²/s²`;
        $('w-pe-r').textContent = comma(now.R);
        $('r-eps1').textContent = `${fixed(now.ke + now.pe, 2)} km²/s²`;
        $('w-eps-ke').textContent = fixed(now.ke, 2);
        $('w-eps-pe').textContent = fixed(now.pe, 2);
        $('r-a').textContent = `${comma(o.a)} km`;
        $('w-a-ra').textContent = comma(o.Ra);
        $('w-a-rp').textContent = comma(o.Rp);
        $('r-eps2').textContent = `${fixed(o.eps, 2)} km²/s²`;
        $('w-eps-a').textContent = comma(o.a);
        $('r-v').textContent = `${now.V.toFixed(2)} km/s`;
        $('w-v-r').textContent = comma(now.R);
        $('w-v-eps').textContent = fixed(o.eps, 2);

        const nuDeg = now.nu * 180 / Math.PI;
        $('nu-value').textContent = `${Math.round(nuDeg) % 360}°`;
        if (document.activeElement !== $('nu-range')) $('nu-range').value = Math.round(nuDeg) % 360;

        updateHud(o, nuDeg);
    }

    let hudText = '';
    function updateHud(o, nuDeg) {
        let text;
        if (o.e <= 0.0005) {
            text = '<b>Circular orbit:</b> R never changes, so sPE, sKE, and speed stay the same all the way around.';
        } else if (nuDeg < 4 || nuDeg > 356) {
            text = '<b>At perigee:</b> closest and fastest. sPE is at its lowest and sKE at its highest.';
        } else if (Math.abs(nuDeg - 180) < 4) {
            text = '<b>At apogee:</b> farthest and slowest. sPE is at its highest and sKE at its lowest.';
        } else if (nuDeg < 180) {
            text = '<b>Climbing toward apogee:</b> R grows, so sPE rises. sKE drops by the same amount, so the spacecraft slows.';
        } else {
            text = '<b>Falling toward perigee:</b> R shrinks, so sPE drops. sKE gains what sPE loses, so the spacecraft speeds up.';
        }
        if (text !== hudText) {
            hudText = text;
            hud.innerHTML = text;
        }
    }

    /* Controls */
    // The altitude sliders use a logarithmic scale, so low orbits get as much travel as high ones.
    const altFromSlider = (value) => ALT_MIN * Math.pow(ALT_MAX / ALT_MIN, value / 1000);
    const sliderFromAlt = (alt) => Math.round(1000 * Math.log(alt / ALT_MIN) / Math.log(ALT_MAX / ALT_MIN));
    const roundAlt = (alt) => alt < 2000 ? Math.round(alt / 10) * 10 : Math.round(alt / 100) * 100;

    const altControls = {
        hp: { number: $('hp-number'), range: $('hp-range') },
        ha: { number: $('ha-number'), range: $('ha-range') }
    };

    function showAltitudes() {
        for (const key of ['hp', 'ha']) {
            const control = altControls[key];
            if (document.activeElement !== control.number) control.number.value = state[key];
            control.number.setAttribute('aria-invalid', 'false');
            control.range.value = sliderFromAlt(state[key]);
        }
    }

    // Changing the orbit keeps the spacecraft at the same true anomaly.
    function setAltitude(key, value) {
        const nu = trueFromMean(state.M, orbit().e);
        state[key] = value;
        if (key === 'hp' && state.ha < value) state.ha = value;
        if (key === 'ha' && state.hp > value) state.hp = value;
        state.M = meanFromTrue(nu, orbit().e);
        markPreset(null);
        dirty = true;
    }

    for (const key of ['hp', 'ha']) {
        const control = altControls[key];
        control.range.addEventListener('input', () => {
            setAltitude(key, roundAlt(altFromSlider(Number(control.range.value))));
            showAltitudes();
        });
        control.number.addEventListener('input', () => {
            const value = Number(control.number.value);
            const valid = control.number.value !== '' && value >= ALT_MIN && value <= ALT_MAX;
            control.number.setAttribute('aria-invalid', String(!valid));
            if (!valid) return;
            setAltitude(key, value);
            const other = altControls[key === 'hp' ? 'ha' : 'hp'];
            other.number.value = state[key === 'hp' ? 'ha' : 'hp'];
            for (const k of ['hp', 'ha']) altControls[k].range.value = sliderFromAlt(state[k]);
        });
        const finish = () => showAltitudes();
        control.number.addEventListener('change', finish);
        control.number.addEventListener('blur', finish);
        control.number.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') control.number.blur();
        });
    }

    const presetButtons = [...$('preset').querySelectorAll('button')];
    function markPreset(name) {
        state.preset = name;
        for (const button of presetButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.value === name));
        }
    }
    function applyPreset(name) {
        const nu = trueFromMean(state.M, orbit().e);
        state.hp = PRESETS[name].hp;
        state.ha = PRESETS[name].ha;
        state.M = meanFromTrue(nu, orbit().e);
        markPreset(name);
        showAltitudes();
        dirty = true;
    }
    for (const button of presetButtons) {
        button.addEventListener('click', () => applyPreset(button.dataset.value));
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : 'Play';
    }

    function goTo(nuDeg) {
        setPlaying(false);
        state.M = meanFromTrue(nuDeg * Math.PI / 180, orbit().e);
        dirty = true;
    }

    $('nu-range').addEventListener('input', (event) => goTo(Number(event.target.value)));
    $('go-perigee').addEventListener('click', () => goTo(0));
    $('go-apogee').addEventListener('click', () => goTo(180));

    $('play').addEventListener('click', () => setPlaying(!state.playing));
    $('reset').addEventListener('click', () => {
        state.M = 0;
        applyPreset(DEFAULT_PRESET);
        setPlaying(!Kit.prefersReducedMotion());
    });
    $('speed').addEventListener('input', (event) => {
        state.speed = Number(event.target.value);
        $('speed-value').textContent = SPEEDS[state.speed].label;
    });
    $('show-velocity').addEventListener('change', (event) => {
        state.showVelocity = event.target.checked;
        dirty = true;
    });
    $('show-labels').addEventListener('change', (event) => {
        state.showLabels = event.target.checked;
        dirty = true;
    });

    /* Start */
    $('speed-value').textContent = SPEEDS[state.speed].label;
    showAltitudes();
    setPlaying(state.playing);

    Kit.observeSize(view, (width, height) => {
        W = width;
        H = height;
        Kit.fitCanvas2D(canvas, ctx, W, H);
        layer.remeasure();
        draw(); // Resizing clears the canvas, so draw at once to avoid a blank frame.
    });

    Kit.startLoop((seconds) => {
        if (state.playing) {
            state.M = wrap(state.M + 2 * Math.PI * seconds / SPEEDS[state.speed].period);
            dirty = true;
        }
        if (!dirty) return;
        dirty = false;
        draw();
    });
})();
