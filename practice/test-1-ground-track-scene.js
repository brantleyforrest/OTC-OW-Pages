// The map view for ground track problems on the Test 1 Practice page. A flat world map with one
// period of the track, from ascending node 1 to node 2, arrows for the direction of travel, dots
// at equal steps of time, the two labeled ascending nodes, and the satellite. Latitude lines
// every 15° let the peaks be read. Each walkthrough step adds what it reads: the node shift, the
// peak latitudes, the time dots, perigee and apogee, and the arc u from the node to the
// satellite. The peaks, perigee, and apogee are labeled only by those steps, or after the
// answers are graded, since finding them is part of the problem.
// The view is drawn on a 2D canvas, so it does not need the 3D library.
// Load as a classic script, after test-1-ground-track-problems.js and earth-land.js.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const Problems = global.Test1GroundTrackProblems;

    const COLORS = {
        ocean: '#123258',
        land: '#5f8a70',
        grid: 'rgba(255, 255, 255, 0.2)',
        gridText: '#e2e8f0',
        track: '#ffe08a',
        node: '#38bdf8',
        descending: '#bae6fd',
        perigee: '#f472b6',
        apogee: '#ff8a3d',
        shift: '#ff8a3d',
        peak: '#34d399',
        nu: '#c4a1ff',
        sat: '#ffffff',
        ink: '#060b14'
    };
    const SAMPLES_PER_ORBIT = 1440;
    const DOTS_PER_ORBIT = 24;
    const ARROWS_PER_ORBIT = 8;

    function create(dom) {
        const { view, canvas } = dom;
        const g = canvas.getContext('2d');
        let viewW = 1, viewH = 1;
        const plot = { x: 0, y: 0, w: 1, h: 1 };
        let problem = null;
        let stage = 'given';
        let answersShown = false;

        const mapX = (lon) => plot.x + ((lon + 180) / 360) * plot.w;
        const mapY = (lat) => plot.y + ((90 - lat) / 180) * plot.h;
        const mono = () => getComputedStyle(document.documentElement).getPropertyValue('--font-mono') || 'monospace';

        /* Map ------------------------------------------------------------- */
        // The axis labels sit outside the map: latitudes on the left, longitudes below.
        const AXIS = { left: 46, right: 14, top: 12, bottom: 28 };

        function layout() {
            const w = Math.min(viewW - AXIS.left - AXIS.right, (viewH - AXIS.top - AXIS.bottom) * 2);
            plot.w = Math.max(10, w);
            plot.h = plot.w / 2;
            plot.x = AXIS.left + (viewW - AXIS.left - AXIS.right - plot.w) / 2;
            plot.y = AXIS.top + Math.max(0, (viewH - AXIS.top - AXIS.bottom - plot.h) / 2);
        }

        function drawBase() {
            g.fillStyle = '#03060c';
            g.fillRect(0, 0, viewW, viewH);
            g.save();
            g.beginPath();
            g.rect(plot.x, plot.y, plot.w, plot.h);
            g.clip();
            g.fillStyle = COLORS.ocean;
            g.fillRect(plot.x, plot.y, plot.w, plot.h);
            g.fillStyle = COLORS.land;
            g.beginPath();
            for (const ring of global.EARTH_LAND || []) {
                for (const shift of [-360, 0, 360]) {
                    g.moveTo(mapX(ring[0] + shift), mapY(ring[1]));
                    for (let k = 2; k < ring.length; k += 2) g.lineTo(mapX(ring[k] + shift), mapY(ring[k + 1]));
                    g.closePath();
                }
            }
            g.fill();

            g.strokeStyle = COLORS.grid;
            g.lineWidth = 1;
            g.beginPath();
            // Every angle in a problem falls on this 15° grid. The prime meridian and the
            // equator are drawn brighter, as references.
            for (let lon = -165; lon <= 165; lon += 15) {
                g.moveTo(mapX(lon), plot.y);
                g.lineTo(mapX(lon), plot.y + plot.h);
            }
            for (let lat = -75; lat <= 75; lat += 15) {
                g.moveTo(plot.x, mapY(lat));
                g.lineTo(plot.x + plot.w, mapY(lat));
            }
            g.stroke();
            g.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            g.beginPath();
            g.moveTo(plot.x, mapY(0));
            g.lineTo(plot.x + plot.w, mapY(0));
            g.moveTo(mapX(0), plot.y);
            g.lineTo(mapX(0), plot.y + plot.h);
            g.stroke();
            g.restore();
            g.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            g.lineWidth = 1;
            g.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);
            drawAxes();
        }

        // Axis labels outside the map, large enough to read, on every grid line that has room.
        function drawAxes() {
            const size = plot.w < 420 ? 11 : 12.5;
            g.font = `500 ${size}px ${mono()}`;
            g.fillStyle = COLORS.gridText;
            g.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            g.lineWidth = 1;

            // Longitudes: every 15° when there is room for a label, else every 30° or 60°.
            const lonStep = [15, 30, 60].find((step) => (step / 360) * plot.w >= size * 4.2) || 90;
            g.textAlign = 'center';
            g.textBaseline = 'top';
            for (let lon = -180; lon <= 180; lon += lonStep) {
                const x = mapX(lon);
                g.beginPath();
                g.moveTo(x, plot.y + plot.h);
                g.lineTo(x, plot.y + plot.h + 4);
                g.stroke();
                const name = lon === 0 ? '0°' : Math.abs(lon) === 180 ? '180°' : `${Math.abs(lon)}°${lon < 0 ? 'W' : 'E'}`;
                g.fillText(name, x, plot.y + plot.h + 6);
            }

            // Latitudes: every 15° when there is room, else every 30°.
            const latStep = (15 / 180) * plot.h >= size * 1.3 ? 15 : 30;
            g.textAlign = 'right';
            g.textBaseline = 'middle';
            for (let lat = -90; lat <= 90; lat += latStep) {
                const y = mapY(lat);
                g.beginPath();
                g.moveTo(plot.x - 4, y);
                g.lineTo(plot.x, y);
                g.stroke();
                const name = lat === 0 ? '0°' : `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`;
                g.fillText(name, plot.x - 6, Math.max(plot.y + size / 2, Math.min(plot.y + plot.h - size / 2, y)));
            }
        }

        /* Track ----------------------------------------------------------- */
        const at = (t) => Problems.trackPoint(problem.model, t);

        // Strokes the track from t0 to t1. Where it crosses the map's edge at 180°, the line runs
        // to that edge and continues from the other one. Over a pole, longitude flips by half a
        // turn in one step, so the line stops there and restarts on the far side.
        function strokeTrack(t0, t1) {
            const m = problem.model;
            const count = Math.max(2, Math.ceil(((t1 - t0) / m.period) * SAMPLES_PER_ORBIT));
            g.beginPath();
            let last = at(t0);
            g.moveTo(mapX(last.lon), mapY(last.lat));
            for (let k = 1; k <= count; k++) {
                const p = at(t0 + ((t1 - t0) * k) / count);
                const jump = p.lon - last.lon;
                const crossesEdge = Math.abs(jump) > 180;
                const overPole = (crossesEdge ? 360 - Math.abs(jump) : Math.abs(jump)) > 150;
                if (overPole) {
                    g.moveTo(mapX(p.lon), mapY(p.lat));
                } else {
                    if (crossesEdge) {
                        const edge = jump > 0 ? -180 : 180;
                        const share = (edge - last.lon) / (jump - Math.sign(jump) * 360);
                        const edgeLat = last.lat + share * (p.lat - last.lat);
                        g.lineTo(mapX(edge), mapY(edgeLat));
                        g.moveTo(mapX(-edge), mapY(edgeLat));
                    }
                    g.lineTo(mapX(p.lon), mapY(p.lat));
                }
                last = p;
            }
            g.stroke();
        }

        // Arrows are spaced by distance on the map, so that they do not pile up where the
        // satellite dwells near apogee.
        function drawArrows() {
            const m = problem.model;
            const spacing = Math.max(70, plot.w / ARROWS_PER_ORBIT);
            const count = Math.ceil(((m.tEnd - m.tStart) / m.period) * SAMPLES_PER_ORBIT);
            const dt = (m.tEnd - m.tStart) / count;
            const times = [];
            let run = spacing / 2;
            let last = at(m.tStart);
            for (let k = 1; k < count; k++) {
                const t = m.tStart + k * dt;
                const p = at(t);
                if (Math.abs(p.lon - last.lon) < 90) run += Math.hypot(mapX(p.lon) - mapX(last.lon), mapY(p.lat) - mapY(last.lat));
                last = p;
                if (run >= spacing) {
                    times.push(t);
                    run = 0;
                }
            }
            g.fillStyle = COLORS.track;
            for (const t of times) {
                const p = at(t), q = at(t + m.period / 400);
                let dx = mapX(q.lon) - mapX(p.lon);
                const dy = mapY(q.lat) - mapY(p.lat);
                if (Math.abs(q.lon - p.lon) > 90) continue;
                if (Math.abs(p.lat) > 82) continue;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                dx /= len;
                const ux = dx, uy = dy / len;
                const x = mapX(p.lon), y = mapY(p.lat), s = 7;
                g.beginPath();
                g.moveTo(x + ux * s, y + uy * s);
                g.lineTo(x - ux * s * 0.6 - uy * s * 0.6, y - uy * s * 0.6 + ux * s * 0.6);
                g.lineTo(x - ux * s * 0.6 + uy * s * 0.6, y - uy * s * 0.6 - ux * s * 0.6);
                g.closePath();
                g.fill();
                g.lineWidth = 1;
                g.strokeStyle = COLORS.ink;
                g.stroke();
            }
        }

        function drawTimeDots(big) {
            const m = problem.model;
            const step = m.period / DOTS_PER_ORBIT;
            g.fillStyle = big ? '#ffffff' : COLORS.track;
            for (let t = Math.ceil(m.tStart / step) * step; t <= m.tEnd; t += step) {
                const p = at(t);
                g.beginPath();
                g.arc(mapX(p.lon), mapY(p.lat), big ? 3.2 : 2.1, 0, 2 * Math.PI);
                g.fill();
            }
        }

        /* Marks and labels ------------------------------------------------ */
        function triangle(x, y, up, color) {
            const r = 6.5 * (up ? 1 : -1);
            g.beginPath();
            g.moveTo(x, y - r);
            g.lineTo(x + 0.866 * r, y + 0.5 * r);
            g.lineTo(x - 0.866 * r, y + 0.5 * r);
            g.closePath();
            g.fillStyle = color;
            g.fill();
            g.lineWidth = 1.3;
            g.strokeStyle = COLORS.ink;
            g.stroke();
        }

        function circle(x, y, r, color) {
            g.beginPath();
            g.arc(x, y, r, 0, 2 * Math.PI);
            g.fillStyle = color;
            g.fill();
            g.lineWidth = 1.5;
            g.strokeStyle = COLORS.ink;
            g.stroke();
        }

        function diamond(x, y, color) {
            const r = 6;
            g.beginPath();
            g.moveTo(x, y - r);
            g.lineTo(x + r, y);
            g.lineTo(x, y + r);
            g.lineTo(x - r, y);
            g.closePath();
            g.fillStyle = color;
            g.fill();
            g.lineWidth = 1.3;
            g.strokeStyle = COLORS.ink;
            g.stroke();
        }

        // A text tag on a dark plate, offset from its point by (dx, dy) and kept on the map.
        function tag(text, x, y, color, dx = 8, dy = -12) {
            const size = plot.w < 420 ? 10 : 11.5;
            g.font = `600 ${size}px ${mono()}`;
            const w = g.measureText(text).width + 10;
            const h = size + 8;
            let left = dx >= 0 ? x + dx : x + dx - w;
            if (dx === 0) left = x - w / 2;
            let top = y + dy - h / 2;
            left = Math.max(plot.x + 2, Math.min(plot.x + plot.w - w - 2, left));
            top = Math.max(plot.y + 2, Math.min(plot.y + plot.h - h - 2, top));
            g.fillStyle = 'rgba(6, 11, 20, 0.86)';
            g.strokeStyle = color;
            g.lineWidth = 1;
            g.beginPath();
            if (g.roundRect) g.roundRect(left, top, w, h, 4);
            else g.rect(left, top, w, h);
            g.fill();
            g.stroke();
            g.fillStyle = color;
            g.textAlign = 'left';
            g.textBaseline = 'middle';
            g.fillText(text, left + 5, top + h / 2 + 0.5);
        }

        const lonText = (lon) => {
            const w = ((lon + 540) % 360) - 180;
            const n = Math.abs(w);
            const s = Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1);
            if (n < 1e-9) return '0°';
            if (Math.abs(n - 180) < 1e-9) return '180°';
            return `${s}°${w < 0 ? 'W' : 'E'}`;
        };
        const deg = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

        // The node shift, as a band from node 1 west to node 2.
        function drawShift() {
            const m = problem.model;
            const width = (Math.min(m.shift, 360) / 360) * plot.w;
            const x = mapX(m.lambda1) - width;
            g.save();
            g.beginPath();
            g.rect(plot.x, plot.y, plot.w, plot.h);
            g.clip();
            g.fillStyle = COLORS.shift;
            g.globalAlpha = 0.18;
            for (const s of [-plot.w, 0, plot.w]) g.fillRect(x + s, plot.y, width, plot.h);
            g.globalAlpha = 1;
            g.fillStyle = COLORS.shift;
            for (const s of [-plot.w, 0, plot.w]) g.fillRect(x + s, mapY(0) - 2, width, 4);
            g.restore();
            const mid = m.shift >= 360 ? m.lambda1 - 180 : m.lambda1 - m.shift / 2;
            const midW = ((mid + 540) % 360) - 180;
            tag(`ΔN = ${deg(m.shift)}° west`, mapX(midW), mapY(0), COLORS.shift, 0, 22);
        }

        function drawPeaks() {
            const m = problem.model;
            g.save();
            g.setLineDash([6, 5]);
            g.strokeStyle = COLORS.peak;
            g.lineWidth = 1.4;
            for (const lat of [m.peak, -m.peak]) {
                g.beginPath();
                g.moveTo(plot.x, mapY(lat));
                g.lineTo(plot.x + plot.w, mapY(lat));
                g.stroke();
            }
            g.restore();
        }

        function highlight(t0, t1, color) {
            g.save();
            g.beginPath();
            g.rect(plot.x, plot.y, plot.w, plot.h);
            g.clip();
            g.strokeStyle = color;
            g.lineWidth = 4;
            g.lineJoin = 'round';
            g.lineCap = 'round';
            strokeTrack(t0, t1);
            g.restore();
        }

        function apsides(labelled) {
            const m = problem.model;
            if (!m.elliptical) return;
            const per = at(m.tPerigeeAfterNode);
            const apo = at(m.tApogeeAfterNode);
            circle(mapX(per.lon), mapY(per.lat), 5, COLORS.perigee);
            diamond(mapX(apo.lon), mapY(apo.lat), COLORS.apogee);
            if (labelled) {
                tag('Perigee', mapX(per.lon), mapY(per.lat), COLORS.perigee, 10, per.lat < 0 ? -14 : 14);
                tag('Apogee', mapX(apo.lon), mapY(apo.lat), COLORS.apogee, 10, apo.lat < 0 ? -14 : 14);
            }
        }

        /* Frame ----------------------------------------------------------- */
        function draw() {
            if (canvas.hidden) return;
            layout();
            drawBase();
            if (!problem) return;
            const m = problem.model;

            if ((stage === 'period' || stage === 'sma') && !m.equatorial) drawShift();
            if (stage === 'inc' && !m.equatorial) drawPeaks();

            g.save();
            g.beginPath();
            g.rect(plot.x, plot.y, plot.w, plot.h);
            g.clip();
            g.strokeStyle = COLORS.track;
            g.lineJoin = 'round';
            g.lineWidth = 2;
            strokeTrack(m.tStart, m.tEnd);
            g.restore();

            if (stage === 'argp' && m.elliptical) highlight(0, m.tPerigeeAfterNode, COLORS.perigee);
            // The true anomaly: the arc from the ascending node to the satellite is u, and
            // nu = u - omega.
            if (stage === 'nu' && !m.equatorial && m.satU > 0) highlight(0, m.tSat, COLORS.nu);

            drawTimeDots(stage === 'ecc');
            drawArrows();

            // The two ascending nodes, and the descending node between them. They are read from
            // the grid, so they are marked only by the period steps or after grading. An
            // equatorial track has no nodes.
            if (!m.equatorial && (stage === 'period' || stage === 'sma' || answersShown)) {
                const node1 = { x: mapX(m.lambda1), y: mapY(0) };
                const node2 = { x: mapX(m.lambda2), y: mapY(0) };
                const desc = at(m.tDescending);
                triangle(mapX(desc.lon), mapY(0), false, COLORS.descending);
                triangle(node2.x, node2.y, true, COLORS.node);
                triangle(node1.x, node1.y, true, COLORS.node);
                if (m.shift >= 360) {
                    tag(`Asc. node 1, 2: ${lonText(m.lambda1)}`, node1.x, node1.y, COLORS.node, 10, -16);
                } else {
                    tag(`1: ${lonText(m.lambda1)}`, node1.x, node1.y, COLORS.node, 9, -16);
                    tag(`2: ${lonText(m.lambda2)}`, node2.x, node2.y, COLORS.node, -9, -16);
                }
            }

            // The latitude peaks are read from the grid, so they are labeled only by their step
            // or after grading.
            if (!m.equatorial && (stage === 'inc' || answersShown)) {
                const north = at(m.tNorth), south = at(m.tSouth);
                const peakText = deg(m.peak);
                tag(`${peakText}°N`, mapX(north.lon), mapY(north.lat), COLORS.peak, -9, -14);
                tag(`${peakText}°S`, mapX(south.lon), mapY(south.lat), COLORS.peak, -9, 14);
            }

            if (stage === 'argp' || stage === 'nu' || answersShown) apsides(stage === 'argp' || stage === 'nu');
            if (stage === 'argp' && m.elliptical) {
                const mid = at(m.tPerigeeAfterNode / 2);
                tag(`ω = ${m.argp}°`, mapX(mid.lon), mapY(mid.lat), COLORS.perigee, 10, 0);
            }
            if (stage === 'nu' && !m.equatorial && m.satU > 0) {
                const mid = at(m.tSat / 2);
                tag(`u = ${m.satU}°`, mapX(mid.lon), mapY(mid.lat), COLORS.nu, 10, 0);
            }

            const sat = at(m.tSat);
            circle(mapX(sat.lon), mapY(sat.lat), 6, COLORS.sat);
            // Node tags sit above the equator, so on the equator the satellite's tag goes below.
            tag('Satellite', mapX(sat.lon), mapY(sat.lat), COLORS.sat, -10, sat.lat < -1 ? -18 : 18);
        }

        function setProblem(source) {
            problem = source;
            answersShown = false;
            draw();
        }

        function setStage(next) {
            stage = next;
            draw();
        }

        function setAnswersShown(shown) {
            answersShown = shown;
            draw();
        }

        function resize() {
            viewW = Math.max(1, view.clientWidth);
            viewH = Math.max(1, view.clientHeight);
            Kit.fitCanvas2D(canvas, g, viewW, viewH);
            draw();
        }

        Kit.observeSize(view, resize);
        return { setProblem, setStage, setAnswersShown, resize };
    }

    global.Test1GroundTrackScene = { create };
})(window);
