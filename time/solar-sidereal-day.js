// Solar vs. Sidereal Day Visualizer. Runs on a 2D canvas with no outside libraries.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const D2R = Math.PI / 180;

    /* Physical values */
    const SOLAR_DAY = 86400;                     // average solar day, s
    const TROPICAL_YEAR = 365.2422 * SOLAR_DAY;  // s
    const REAL_ORBIT_RATE = 360 / TROPICAL_YEAR; // degrees per second
    const SIDEREAL_DAY = 360 / (360 / SOLAR_DAY + REAL_ORBIT_RATE); // s
    const SPIN_RATE = 360 / SIDEREAL_DAY;        // degrees per second

    const COLORS = {
        sidereal: '#60a5fa',
        solar: '#fb923c',
        extra: '#f87171',
        gold: '#c59b3c',
        sun: '#ffd76a',
        text: '#f0f4fa',
        muted: '#94a3b8',
        dim: '#64748b',
        orbit: '#27405f'
    };

    const SPEEDS = [
        { rate: 30, label: 'Slow' },
        { rate: 60, label: 'Normal' },
        { rate: 120, label: 'Fast' },
        { rate: 240, label: 'Very fast' }
    ];

    const state = {
        exaggeration: 20,
        orbitRate: 20 * REAL_ORBIT_RATE,
        speedStop: 1,
        playing: false,
        pauses: true,
        rotation: 0,        // degrees of rotation since the current day began
        step: 1,            // 1 start or first part of day, 2 past sidereal day, 3 solar day complete
        dayStartOrbit: -48, // Earth's orbital angle when this day began, degrees
        dayStartSpin: 132,  // direction of the marked point when this day began, degrees
        totalRotation: 0,   // rotation accumulated in earlier days
        totalOrbit: 0       // orbital travel accumulated in earlier days
    };

    function solarRotation() {
        // Rotation for the marked point to face the Sun again, for the current orbit rate.
        return 360 * SPIN_RATE / (SPIN_RATE - state.orbitRate);
    }

    function clockTime() {
        return state.rotation / SPIN_RATE;
    }

    function orbitTravelToday() {
        return state.orbitRate * clockTime();
    }

    function formatDuration(seconds) {
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor(total / 60) % 60;
        const s = total % 60;
        return `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} m ${String(s).padStart(2, '0')} s`;
    }

    function formatShortDuration(seconds) {
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor(total / 60) % 60;
        const s = total % 60;
        if (h > 0) return `${h} h ${String(m).padStart(2, '0')} m ${String(s).padStart(2, '0')} s`;
        return `${m} m ${String(s).padStart(2, '0')} s`;
    }

    /* ------------------------------------------------------------------ */
    /* Simulation                                                          */
    /* ------------------------------------------------------------------ */

    function beginNextDay() {
        const finished = solarRotation();
        state.totalRotation += finished;
        state.totalOrbit += state.orbitRate * finished / SPIN_RATE;
        state.dayStartSpin += finished;
        state.dayStartOrbit += state.orbitRate * finished / SPIN_RATE;
        state.rotation -= finished;
        state.step = 1;
    }

    function restart() {
        state.rotation = 0;
        state.step = 1;
        state.dayStartOrbit = -48;
        state.dayStartSpin = 132;
        state.totalRotation = 0;
        state.totalOrbit = 0;
    }

    // Rotation rate in degrees per viewing second, slowed near the milestones so
    // that the small extra rotation can be followed.
    function rotationRate() {
        const cruise = SPEEDS[state.speedStop].rate;
        if (!state.pauses) return cruise;
        const end = solarRotation();
        const slow = Math.max((end - 360) / 3.5, 0.28);
        const r = state.rotation;
        if (r < 12) return slow + (cruise - slow) * Math.min(1, r / 12 + 0.25);
        if (r < 335) return cruise;
        if (r < 358) return slow + (cruise - slow) * (358 - r) / 23;
        return slow;
    }

    function advance(dt) {
        let remaining = dt;
        while (remaining > 0 && state.playing) {
            if (state.step === 3) {
                beginNextDay();
            }
            const rate = rotationRate();
            const end = solarRotation();
            let next = state.rotation + rate * remaining;

            if (state.pauses && state.step === 1 && state.rotation < 360 && next >= 360) {
                state.rotation = 360;
                state.step = 2;
                setPlaying(false);
                return;
            }
            if (state.pauses && next >= end) {
                state.rotation = end;
                state.step = 3;
                setPlaying(false);
                return;
            }
            if (!state.pauses) {
                // Without pauses, cross days continuously.
                if (next >= end) {
                    const used = (end - state.rotation) / rate;
                    state.rotation = end;
                    state.step = 3;
                    beginNextDay();
                    remaining -= used;
                    continue;
                }
                state.step = next >= 360 ? 2 : 1;
            }
            state.rotation = next;
            remaining = 0;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Drawing                                                             */
    /* ------------------------------------------------------------------ */

    const stage = $('stage');
    const canvas = $('view');
    const ctx = canvas.getContext('2d');
    let W = 1, H = 1, dpr = 1;

    // Pre-rendered Northern Hemisphere, as seen from above the North Pole.
    const EARTH_SPRITE_SIZE = 512;
    const earthSprite = document.createElement('canvas');
    (function buildEarthSprite() {
        earthSprite.width = earthSprite.height = EARTH_SPRITE_SIZE;
        const g = earthSprite.getContext('2d');
        const c = EARTH_SPRITE_SIZE / 2;
        const R = c - 1;
        g.beginPath();
        g.arc(c, c, R, 0, 2 * Math.PI);
        g.closePath();
        g.clip();
        g.fillStyle = '#16406f';
        g.fillRect(0, 0, EARTH_SPRITE_SIZE, EARTH_SPRITE_SIZE);
        g.fillStyle = '#5f8a70';
        g.beginPath();
        for (const ring of window.EARTH_LAND) {
            let sum = 0;
            for (let i = 1; i < ring.length; i += 2) sum += ring[i];
            if (sum / (ring.length / 2) < -55) continue; // Antarctica lies outside this view.
            for (let i = 0; i < ring.length; i += 2) {
                const rho = (90 - ring[i + 1]) / 90 * R;
                const a = ring[i] * D2R;
                const x = c + rho * Math.cos(a);
                const y = c - rho * Math.sin(a);
                if (i === 0) g.moveTo(x, y);
                else g.lineTo(x, y);
            }
            g.closePath();
        }
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.lineWidth = 1;
        for (const lat of [30, 60]) {
            g.beginPath();
            g.arc(c, c, (90 - lat) / 90 * R, 0, 2 * Math.PI);
            g.stroke();
        }
        for (let lon = 0; lon < 180; lon += 30) {
            const a = lon * D2R;
            g.beginPath();
            g.moveTo(c - R * Math.cos(a), c + R * Math.sin(a));
            g.lineTo(c + R * Math.cos(a), c - R * Math.sin(a));
            g.stroke();
        }
    })();

    // Fixed background stars, in normalized canvas coordinates.
    const background = [];
    (function buildBackground() {
        let seed = 4242;
        const rand = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        for (let i = 0; i < 260; i++) {
            background.push({ x: rand(), y: rand(), r: 0.4 + rand() * 0.8, a: 0.2 + 0.6 * rand() * rand() });
        }
    })();

    // Converts a math angle (counterclockwise, degrees) to a canvas direction.
    const dirX = (deg) => Math.cos(deg * D2R);
    const dirY = (deg) => -Math.sin(deg * D2R);

    function arrow(x0, y0, x1, y1, color, width, head) {
        const a = Math.atan2(y1 - y0, x1 - x0);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1 - Math.cos(a) * head * 0.7, y1 - Math.sin(a) * head * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - Math.cos(a - 0.42) * head, y1 - Math.sin(a - 0.42) * head);
        ctx.lineTo(x1 - Math.cos(a + 0.42) * head, y1 - Math.sin(a + 0.42) * head);
        ctx.closePath();
        ctx.fill();
    }

    function label(text, x, y, color, align, weight) {
        ctx.font = `${weight || 500} 13px Inter, 'Segoe UI', Roboto, sans-serif`;
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(3, 6, 12, 0.9)';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }

    function starShape(x, y, r, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const rad = i % 2 === 0 ? r : r * 0.42;
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const px = x + rad * Math.cos(a);
            const py = y + rad * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    // Finds where a ray from (x, y) along a canvas direction leaves the visible area.
    function rayToEdge(x, y, dx, dy, margin) {
        let t = Infinity;
        if (dx > 1e-6) t = Math.min(t, (W - margin - x) / dx);
        if (dx < -1e-6) t = Math.min(t, (margin - x) / dx);
        if (dy > 1e-6) t = Math.min(t, (H - margin - y) / dy);
        if (dy < -1e-6) t = Math.min(t, (margin - y) / dy);
        return Math.max(0, t);
    }

    function draw() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#03060c';
        ctx.fillRect(0, 0, W, H);

        for (const s of background) {
            ctx.fillStyle = `rgba(255,255,255,${s.a})`;
            ctx.beginPath();
            ctx.arc(s.x * W, s.y * H, s.r, 0, 2 * Math.PI);
            ctx.fill();
        }

        const minDim = Math.min(W, H);
        const cx = W / 2;
        const cy = H / 2 + (W < 640 ? 10 : 0);
        const orbitR = minDim * 0.335;
        const earthR = Math.max(26, minDim * 0.082);
        const sunR = Math.max(18, minDim * 0.05);

        const orbitNow = state.dayStartOrbit + orbitTravelToday();
        const spinNow = state.dayStartSpin + state.rotation;
        const ex = cx + orbitR * dirX(orbitNow);
        const ey = cy + orbitR * dirY(orbitNow);
        const startX = cx + orbitR * dirX(state.dayStartOrbit);
        const startY = cy + orbitR * dirY(state.dayStartOrbit);

        // Direction to the Sun from Earth, and the fixed direction to today's star.
        const sunDir = orbitNow + 180;
        const starDir = state.dayStartSpin;
        const arrowLen = earthR * 1.75;

        /* Orbit and the day's travel along it */
        ctx.strokeStyle = COLORS.orbit;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cx, cy, orbitR, 0, 2 * Math.PI);
        ctx.stroke();

        const travel = orbitTravelToday();
        if (travel > 0.02) {
            ctx.strokeStyle = COLORS.gold;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, orbitR, -state.dayStartOrbit * D2R, -orbitNow * D2R, true);
            ctx.stroke();
        }

        /* Sight lines from the start of the day and from now */
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(startX, startY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(251, 146, 60, 0.75)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        /* Angle at the Sun: Earth's travel along its orbit */
        if (travel > 0.3) {
            const arcR = sunR * 2.1;
            ctx.strokeStyle = COLORS.gold;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, arcR, -state.dayStartOrbit * D2R, -orbitNow * D2R, true);
            ctx.stroke();
            if (travel > 3) {
                const mid = state.dayStartOrbit + travel / 2;
                label(`${travel.toFixed(1)}°`, cx + (arcR + 22) * dirX(mid), cy + (arcR + 14) * dirY(mid), COLORS.gold, 'center', 600);
            }
        }

        /* Sun */
        const glow = ctx.createRadialGradient(cx, cy, sunR * 0.4, cx, cy, sunR * 2.6);
        glow.addColorStop(0, 'rgba(255, 215, 106, 0.55)');
        glow.addColorStop(1, 'rgba(255, 215, 106, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, sunR * 2.6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = COLORS.sun;
        ctx.beginPath();
        ctx.arc(cx, cy, sunR, 0, 2 * Math.PI);
        ctx.fill();
        label('Sun', cx, cy + sunR + 13, COLORS.sun, 'center', 600);

        /* Earth at the start of the day, as an outline */
        if (travel > 1) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.65)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(startX, startY, earthR, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            arrow(startX, startY, startX + arrowLen * 0.85 * dirX(starDir), startY + arrowLen * 0.85 * dirY(starDir), 'rgba(148, 163, 184, 0.75)', 1.6, 8);
        }

        /* Direction to the distant star: parallel from anywhere along the orbit */
        const sx = dirX(starDir), sy = dirY(starDir);
        const reach = rayToEdge(ex, ey, sx, sy, 26);
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.75)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + sx * reach, ey + sy * reach);
        ctx.stroke();
        ctx.setLineDash([]);
        const starX = ex + sx * reach, starY = ey + sy * reach;
        starShape(starX, starY, 11, COLORS.sidereal);
        const starLabelLeft = starX > W * 0.62;
        label('Toward a distant star', starX + (starLabelLeft ? -16 : 16), starY + (starY < 40 ? 12 : -2), COLORS.sidereal, starLabelLeft ? 'right' : 'left', 600);

        /* Earth, rotated to its current angle */
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(-spinNow * D2R);
        ctx.drawImage(earthSprite, -earthR, -earthR, earthR * 2, earthR * 2);
        ctx.restore();

        /* Night side: the half facing away from the Sun */
        ctx.fillStyle = 'rgba(2, 5, 12, 0.6)';
        ctx.beginPath();
        ctx.arc(ex, ey, earthR, (-sunDir + 90) * D2R, (-sunDir + 270) * D2R);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 197, 255, 0.55)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(ex, ey, earthR, 0, 2 * Math.PI);
        ctx.stroke();

        /* Extra rotation still needed, or completed */
        const extra = ((sunDir - starDir) % 360 + 360) % 360;
        if (extra > 0.3) {
            const arcR = earthR * 1.28;
            ctx.strokeStyle = COLORS.extra;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(ex, ey, arcR, -starDir * D2R, -sunDir * D2R, true);
            ctx.stroke();
            if (extra > 4) {
                const mid = starDir + extra / 2;
                label(`${extra.toFixed(1)}°`, ex + (arcR + 26) * dirX(mid), ey + (arcR + 16) * dirY(mid), COLORS.extra, 'center', 600);
            }
        }

        /* The marked point: an arrow fixed to Earth */
        const facing = state.step === 3 ? COLORS.solar : (state.step === 2 && Math.abs(state.rotation - 360) < 1e-6 ? COLORS.sidereal : '#ffffff');
        arrow(ex, ey, ex + arrowLen * dirX(spinNow), ey + arrowLen * dirY(spinNow), facing, 3, 13);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, 2 * Math.PI);
        ctx.fill();

        // Name the arrow on the side away from the Sun, where it does not cover the sight lines.
        const away = orbitNow;
        label('Earth', ex + (earthR + 34) * dirX(away), ey + (earthR + 18) * dirY(away), COLORS.muted, 'center', 600);

        /* Direction of orbital travel */
        const ahead = orbitNow + Math.max(16, 280 / orbitR * 10);
        const a0 = ahead + 6, a1 = a0 + 10;
        arrow(cx + orbitR * dirX(a0), cy + orbitR * dirY(a0), cx + orbitR * dirX(a1), cy + orbitR * dirY(a1), COLORS.dim, 1.6, 8);

        /* Key */
        const keyY = H - 16;
        const small = W < 640;
        if (!small) {
            label('White arrow: a point fixed to Earth', 14, keyY - 38, COLORS.text);
            label('Gold: Earth\'s travel along its orbit this day', 14, keyY - 19, COLORS.gold);
            label('Red: the extra rotation', 14, keyY, COLORS.extra);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Interface                                                           */
    /* ------------------------------------------------------------------ */

    const stepItems = [...$('steps').children];

    function gaugePlacement() {
        const end = solarRotation();
        const span = end - 360;
        const margin = Math.max(span * 0.42, 0.5);
        const lo = 360 - margin, hi = end + margin;
        return { lo, hi, end, toPercent: (v) => Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) };
    }

    function updatePanels() {
        const end = solarRotation();
        const t = clockTime();
        $('clock').textContent = formatDuration(t);
        $('rotation').textContent = `${state.rotation.toFixed(3)}°`;
        $('orbit-travel').textContent = `${orbitTravelToday().toFixed(3)}°`;
        $('needed').textContent = `${end.toFixed(3)}°`;

        stepItems.forEach((item, i) => item.classList.toggle('current', i + 1 === state.step));

        const g = gaugePlacement();
        const place = (el, v) => { el.style.left = `${g.toPercent(v)}%`; };
        place($('tick-sidereal'), 360);
        place($('tick-solar'), end);
        place($('text-sidereal-deg'), 360);
        place($('text-sidereal-time'), 360);
        place($('text-solar-deg'), end);
        place($('text-solar-time'), end);
        place($('gauge-pointer'), state.rotation);
        const extraEl = $('gauge-extra');
        extraEl.style.left = `${g.toPercent(360)}%`;
        extraEl.style.width = `${g.toPercent(end) - g.toPercent(360)}%`;
        $('text-sidereal-deg').textContent = '360°';
        $('text-solar-deg').textContent = `${end.toFixed(3)}°`;
        $('text-sidereal-time').textContent = formatDuration(SIDEREAL_DAY);
        $('text-solar-time').textContent = formatDuration(end / SPIN_RATE);

        const starsCount = (state.totalRotation + state.rotation) / 360;
        const orbitTotal = state.totalOrbit + orbitTravelToday();
        const sunCount = (state.totalRotation + state.rotation - orbitTotal) / 360;
        $('count-stars').textContent = starsCount.toFixed(3);
        $('count-sun').textContent = sunCount.toFixed(3);
        $('count-diff').textContent = (starsCount - sunCount).toFixed(3);
        $('count-orbits').textContent = (orbitTotal / 360).toFixed(3);
    }

    function updateComparison() {
        const realEnd = 360 * SPIN_RATE / (SPIN_RATE - REAL_ORBIT_RATE);
        const drawnEnd = solarRotation();
        const realSolar = realEnd / SPIN_RATE;
        const drawnSolar = drawnEnd / SPIN_RATE;
        $('real-sidereal').textContent = formatDuration(SIDEREAL_DAY);
        $('drawn-sidereal').textContent = formatDuration(SIDEREAL_DAY);
        $('real-solar').textContent = formatDuration(realSolar);
        $('drawn-solar').textContent = formatDuration(drawnSolar);
        $('real-diff').textContent = formatShortDuration(realSolar - SIDEREAL_DAY);
        $('drawn-diff').textContent = formatShortDuration(drawnSolar - SIDEREAL_DAY);
        $('real-extra').textContent = `${(realEnd - 360).toFixed(3)}°`;
        $('drawn-extra').textContent = `${(drawnEnd - 360).toFixed(3)}°`;

        const k = state.exaggeration;
        $('exaggeration-value').textContent = k === 1 ? 'Real Earth' : `${k} times real`;
        $('scale-badge').innerHTML = k === 1
            ? '<strong>Real Earth values.</strong> The extra rotation is too small to see here. Use the magnified scale.'
            : `<strong>Orbital motion exaggerated ${k} times.</strong> Earth's rotation rate is unchanged.`;
        $('exaggeration-help').textContent = k === 1
            ? 'Earth moves about 1° along its orbit each day. At this true scale, the magnified scale in the side panel shows the difference.'
            : `Earth really moves about 1° along its orbit each day. This view uses about ${(drawnEnd - 360).toFixed(0)}° per day so that the geometry is visible, which also makes the drawn solar day longer than 24 hours.`;
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : (state.step === 1 && state.rotation === 0 ? 'Play' : 'Continue');
    }

    function setExaggeration(k) {
        state.exaggeration = k;
        state.orbitRate = k * REAL_ORBIT_RATE;
        $('exaggeration').value = k;
        restart();
        setPlaying(state.playing);
        updateComparison();
        refresh();
    }

    function refresh() {
        updatePanels();
        draw();
    }

    function resize() {
        const rect = stage.getBoundingClientRect();
        W = Math.max(1, Math.floor(rect.width));
        H = Math.max(1, Math.floor(rect.height));
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        refresh();
    }

    $('play').addEventListener('click', () => {
        if (!state.playing && state.step === 3) beginNextDay();
        setPlaying(!state.playing);
        refresh();
    });
    $('restart').addEventListener('click', () => {
        restart();
        setPlaying(false);
        refresh();
    });
    $('speed').addEventListener('input', (e) => {
        state.speedStop = Number(e.target.value);
        $('speed-value').textContent = SPEEDS[state.speedStop].label;
    });
    $('pause-milestones').addEventListener('change', (e) => {
        state.pauses = e.target.checked;
        if (state.step === 3) beginNextDay();
        refresh();
    });
    $('exaggeration').addEventListener('input', (e) => setExaggeration(Number(e.target.value)));
    $('real-earth').addEventListener('click', () => setExaggeration(1));

    new ResizeObserver(resize).observe(stage);

    let last = performance.now();
    function loop(now) {
        requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (!state.playing) return;
        advance(dt);
        refresh();
    }

    $('speed-value').textContent = SPEEDS[state.speedStop].label;
    updateComparison();
    resize();
    setPlaying(false);
    requestAnimationFrame(loop);

    // Redraw once the page fonts are ready, because the canvas labels use them.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
