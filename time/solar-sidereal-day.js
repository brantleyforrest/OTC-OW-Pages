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

    const SPEED_FACTORS = [
        { factor: 0.5, label: 'Slow' },
        { factor: 1.0, label: 'Normal' },
        { factor: 2.0, label: 'Fast' },
        { factor: 4.0, label: 'Very fast' }
    ];

    const state = {
        rotations: 10,      // number of rotations to observe (1 to 30)
        speedStop: 1,
        playing: false,
        pauses: true,
        rotation: 0,        // degrees of rotation since the current sequence began
        step: 1,            // 1 start/running, 2 reached N sidereal days, 3 reached N solar days
        dayStartOrbit: -48, // Earth's orbital angle when this sequence began, degrees
        dayStartSpin: 132,  // direction of the marked point when this sequence began, degrees
        totalRotation: 0,   // rotation accumulated in earlier sequences
        totalOrbit: 0       // orbital travel accumulated in earlier sequences
    };

    function siderealTarget() {
        return state.rotations * 360;
    }

    function solarRotation() {
        // Rotation for the marked point to face the Sun again across state.rotations solar days.
        const oneSolar = 360 * SPIN_RATE / (SPIN_RATE - REAL_ORBIT_RATE);
        return state.rotations * oneSolar;
    }

    function clockTime() {
        return state.rotation / SPIN_RATE;
    }

    function orbitTravelToday() {
        return REAL_ORBIT_RATE * clockTime();
    }

    function formatDuration(seconds) {
        const total = Math.round(seconds);
        const d = Math.floor(total / 86400);
        const rem = total % 86400;
        const h = Math.floor(rem / 3600);
        const m = Math.floor((rem % 3600) / 60);
        const s = rem % 60;
        if (d > 0) {
            return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
        }
        return `${String(h).padStart(2, '0')} h ${String(m).padStart(2, '0')} m ${String(s).padStart(2, '0')} s`;
    }

    function formatShortDuration(seconds) {
        const total = Math.round(seconds);
        const d = Math.floor(total / 86400);
        const rem = total % 86400;
        const h = Math.floor(rem / 3600);
        const m = Math.floor((rem % 3600) / 60);
        const s = rem % 60;
        if (d > 0) {
            if (h > 0) return `${d}d ${h}h ${m}m`;
            return `${d}d ${m}m`;
        }
        if (h > 0) return `${h} h ${String(m).padStart(2, '0')} m ${String(s).padStart(2, '0')} s`;
        return `${m} m ${String(s).padStart(2, '0')} s`;
    }

    function formatGaugeTime(seconds) {
        const total = Math.round(seconds);
        const d = Math.floor(total / 86400);
        const rem = total % 86400;
        const h = Math.floor(rem / 3600);
        const m = Math.floor((rem % 3600) / 60);
        if (d > 0) {
            return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
        }
        const s = rem % 60;
        return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }

    /* ------------------------------------------------------------------ */
    /* Simulation                                                          */
    /* ------------------------------------------------------------------ */

    function beginNextCycle() {
        const finished = solarRotation();
        state.totalRotation += finished;
        state.totalOrbit += REAL_ORBIT_RATE * (finished / SPIN_RATE);
        state.dayStartSpin += finished;
        state.dayStartOrbit += REAL_ORBIT_RATE * (finished / SPIN_RATE);
        state.rotation -= finished;
        if (state.rotation < 0) state.rotation = 0;
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

    function getCruiseRate() {
        const n = state.rotations;
        const baseDuration = 5.5 + 0.32 * (n - 1);
        const baseRate = (n * 360) / baseDuration;
        return baseRate * SPEED_FACTORS[state.speedStop].factor;
    }

    // Rotation rate in degrees per viewing second, slowed near the milestones so
    // that the small extra rotation can be followed.
    function rotationRate() {
        const cruise = getCruiseRate();
        if (!state.pauses) return cruise;
        const siderealEnd = siderealTarget();
        const solarEnd = solarRotation();
        const extraSpan = solarEnd - siderealEnd;
        const slow = Math.max(extraSpan / 2.5, 0.35);
        const r = state.rotation;

        if (r < 15) return slow + (cruise - slow) * Math.min(1, r / 15);
        const approachDist = Math.min(90, siderealEnd * 0.12);
        if (r > siderealEnd - approachDist && r < siderealEnd) {
            const frac = (siderealEnd - r) / approachDist;
            return slow + (cruise - slow) * frac;
        }
        if (r >= siderealEnd) return slow;
        return cruise;
    }

    function advance(dt) {
        let remaining = dt;
        while (remaining > 0 && state.playing) {
            if (state.step === 3) {
                beginNextCycle();
            }
            const rate = rotationRate();
            const siderealEnd = siderealTarget();
            const solarEnd = solarRotation();
            let next = state.rotation + rate * remaining;

            if (state.pauses && state.step === 1 && state.rotation < siderealEnd && next >= siderealEnd) {
                state.rotation = siderealEnd;
                state.step = 2;
                setPlaying(false);
                return;
            }
            if (state.pauses && next >= solarEnd) {
                state.rotation = solarEnd;
                state.step = 3;
                setPlaying(false);
                return;
            }
            if (!state.pauses) {
                // Without pauses, cross cycles continuously.
                if (next >= solarEnd) {
                    const used = (solarEnd - state.rotation) / rate;
                    state.rotation = solarEnd;
                    state.step = 3;
                    beginNextCycle();
                    remaining -= used;
                    continue;
                }
                state.step = next >= siderealEnd ? 2 : 1;
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

        let goldLabel = null;
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
                goldLabel = { x: cx + (arcR + 22) * dirX(mid), y: cy + (arcR + 14) * dirY(mid) };
                label(`${travel.toFixed(1)}°`, goldLabel.x, goldLabel.y, COLORS.gold, 'center', 600);
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
                const redX = ex + (arcR + 26) * dirX(mid);
                let redY = ey + (arcR + 16) * dirY(mid);
                // Move this label clear of the gold label when the two meet.
                if (goldLabel && Math.abs(redX - goldLabel.x) < 50 && Math.abs(redY - goldLabel.y) < 17) {
                    redY = goldLabel.y + (redY < goldLabel.y ? -17 : 17);
                }
                label(`${extra.toFixed(1)}°`, redX, redY, COLORS.extra, 'center', 600);
            }
        }

        /* The marked point: an arrow fixed to Earth */
        const siderealEnd = siderealTarget();
        const facing = state.step === 3
            ? COLORS.solar
            : (state.step === 2 && Math.abs(state.rotation - siderealEnd) < 1e-4 ? COLORS.sidereal : '#ffffff');
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
            label('Gold: Earth\'s travel along its orbit', 14, keyY - 19, COLORS.gold);
            label('Red: the extra rotation', 14, keyY, COLORS.extra);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Interface                                                           */
    /* ------------------------------------------------------------------ */

    const stepItems = [...$('steps').children];

    function gaugePlacement() {
        const siderealEnd = siderealTarget();
        const end = solarRotation();
        const span = end - siderealEnd;
        const margin = Math.max(span * 0.42, 0.5);
        const lo = siderealEnd - margin, hi = end + margin;
        return { lo, hi, siderealEnd, end, toPercent: (v) => Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) };
    }

    function updatePanels() {
        const end = solarRotation();
        const siderealEnd = siderealTarget();
        const t = clockTime();
        $('clock').textContent = formatDuration(t);
        const currentRev = state.rotation / 360;
        $('rotation').textContent = `${state.rotation.toFixed(1)}° (${currentRev.toFixed(2)} rev)`;
        $('orbit-travel').textContent = `${orbitTravelToday().toFixed(3)}°`;
        $('needed').textContent = `${end.toFixed(3)}°`;

        stepItems.forEach((item, i) => item.classList.toggle('current', i + 1 === state.step));

        const g = gaugePlacement();
        const place = (el, v) => { el.style.left = `${g.toPercent(v)}%`; };
        place($('tick-sidereal'), siderealEnd);
        place($('tick-solar'), end);
        place($('gauge-pointer'), state.rotation);
        const extraEl = $('gauge-extra');
        extraEl.style.left = `${g.toPercent(siderealEnd)}%`;
        extraEl.style.width = `${Math.max(0, g.toPercent(end) - g.toPercent(siderealEnd))}%`;
        $('text-sidereal-deg').textContent = `${siderealEnd.toLocaleString()}°`;
        $('text-solar-deg').textContent = `${end.toFixed(1)}°`;
        $('text-sidereal-time').textContent = formatGaugeTime(state.rotations * SIDEREAL_DAY);
        $('text-solar-time').textContent = formatGaugeTime(state.rotations * SOLAR_DAY);

        const starsCount = (state.totalRotation + state.rotation) / 360;
        const orbitTotal = state.totalOrbit + orbitTravelToday();
        const sunCount = (state.totalRotation + state.rotation - orbitTotal) / 360;
        $('count-stars').textContent = starsCount.toFixed(3);
        $('count-sun').textContent = sunCount.toFixed(3);
        $('count-diff').textContent = (starsCount - sunCount).toFixed(3);
        $('count-orbits').textContent = (orbitTotal / 360).toFixed(3);
    }

    function updateComparison() {
        const n = state.rotations;
        const oneSolarRot = 360 * SPIN_RATE / (SPIN_RATE - REAL_ORBIT_RATE);
        const oneSolarSec = oneSolarRot / SPIN_RATE;
        const oneExtraDeg = oneSolarRot - 360;

        const totalSiderealSec = n * SIDEREAL_DAY;
        const totalSolarSec = n * oneSolarSec;
        const totalExtraDeg = n * oneExtraDeg;

        $('single-sidereal').textContent = formatDuration(SIDEREAL_DAY);
        $('total-sidereal').textContent = formatDuration(totalSiderealSec);
        $('single-solar').textContent = formatDuration(oneSolarSec);
        $('total-solar').textContent = formatDuration(totalSolarSec);
        $('single-diff').textContent = formatShortDuration(oneSolarSec - SIDEREAL_DAY);
        $('total-diff').textContent = formatShortDuration(totalSolarSec - totalSiderealSec);
        $('single-extra').textContent = `${oneExtraDeg.toFixed(3)}°`;
        $('total-extra').textContent = `${totalExtraDeg.toFixed(3)}°`;

        $('th-accumulated').textContent = n === 1 ? 'Total (1 Day)' : `Total (${n} Days)`;
        $('rotations-value').textContent = n === 1 ? '1 rotation (1 day)' : `${n} rotations (${n} days)`;
        $('btn-toggle-rotations').textContent = n === 1 ? 'Default (10 Rotations)' : 'Single Rotation (1 Day)';

        $('steps-title').textContent = n === 1 ? 'This Day, Step by Step' : `${n} Rotations, Step by Step`;
        $('step-1-title').textContent = n === 1 ? 'Start of the day' : 'Start of day 1';
        $('step-1-text').textContent = 'The marked point faces the Sun, and a distant star lies in the same direction.';

        if (n === 1) {
            $('step-2-title').textContent = 'One sidereal day: 360° of rotation';
            $('step-2-text').textContent = 'The point faces the star again. Earth has moved about 1° along its orbit, so the point does not yet face the Sun.';
            $('step-3-title').textContent = 'One solar day: about 361° of rotation';
            $('step-3-text').textContent = 'After an extra 0.986° rotation (3 m 56 s), the point faces the Sun again. A new day begins.';
        } else {
            $('step-2-title').textContent = `${n} sidereal days: ${n} full rotations (${(n * 360).toLocaleString()}°)`;
            $('step-2-text').textContent = `Earth completes ${n} full 360° spins facing the distant star. Along its orbit, Earth has traveled ${totalExtraDeg.toFixed(1)}°, falling behind the Sun.`;
            $('step-3-title').textContent = `${n} solar days: ${n} full days (${Math.round(totalSolarSec / 3600)} h)`;
            $('step-3-text').textContent = `After an accumulated ${totalExtraDeg.toFixed(1)}° extra rotation (${formatShortDuration(totalSolarSec - totalSiderealSec)}), the point faces the Sun again.`;
        }

        $('scale-badge').innerHTML = n === 1
            ? '<strong>Real Earth values.</strong> 1 rotation (1 day). The extra rotation per day is 0.986°.'
            : `<strong>${n} rotations (${n} days).</strong> Real Earth physics throughout; no exaggerated orbit rate.`;
        $('rotations-help').textContent = n === 1
            ? 'In 1 day, Earth moves about 1° along its orbit, creating the 3 m 56 s difference.'
            : `Over ${n} rotations, Earth travels ${totalExtraDeg.toFixed(1)}° along its orbit, accumulating a ${totalExtraDeg.toFixed(1)}° (${formatShortDuration(totalSolarSec - totalSiderealSec)}) difference between star and Sun alignment.`;
    }

    function setPlaying(value) {
        state.playing = value;
        $('play').textContent = value ? 'Pause' : (state.step === 1 && state.rotation === 0 ? 'Play' : 'Continue');
    }

    function setRotations(n) {
        state.rotations = Math.max(1, Math.min(30, n));
        $('rotations').value = state.rotations;
        restart();
        setPlaying(false);
        updateComparison();
        refresh();
    }

    function refresh() {
        updatePanels();
        draw();
    }

    function resize() {
        W = Math.max(1, stage.clientWidth);
        H = Math.max(1, stage.clientHeight);
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        refresh();
    }

    $('play').addEventListener('click', () => {
        if (!state.playing && state.step === 3) beginNextCycle();
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
        $('speed-value').textContent = SPEED_FACTORS[state.speedStop].label;
    });
    $('pause-milestones').addEventListener('change', (e) => {
        state.pauses = e.target.checked;
        if (state.step === 3) beginNextCycle();
        refresh();
    });
    $('rotations').addEventListener('input', (e) => setRotations(Number(e.target.value)));
    $('btn-toggle-rotations').addEventListener('click', () => {
        setRotations(state.rotations === 1 ? 10 : 1);
    });

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

    $('speed-value').textContent = SPEED_FACTORS[state.speedStop].label;
    updateComparison();
    resize();
    setPlaying(false);
    requestAnimationFrame(loop);

    // Redraw once the page fonts are ready, because the canvas labels use them.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
})();
