// Test 2 Practice: the view beside each problem. The dual stage from RpoViews (the view from the
// left, a second RIC view, and the inertial view) for problems whose model holds a target and a
// chase (model.kind 'motion'), or only RMOEs and the target's a (model.kind 'rel', the course
// model alone).
// API: create({ container, THREE }) -> { setProblem(source), setStage(key), setAnswersShown(bool),
// resize() }. THREE may be null; the RIC panes still work without it.
(function (global) {
    'use strict';

    const M = global.TestReviewMath.rpo;
    const V = global.RpoViews;
    const Kit = global.ToolKit;
    const PLAY_SECONDS_PER_REV = 5;
    const POINTS_PER_REV = 240;

    function create(options) {
        const container = options.container;
        const dualHost = document.createElement('div');
        dualHost.className = 't2-host';
        container.appendChild(dualHost);

        let stage = null;
        let problem = null, kind = null, stageKey = 'given', answersShown = false;
        let sim = null, t = 0;

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
            // Every pane uses the course model (CW from the RMOEs), the inertial one included, so the
            // panes always agree; the chase's own orbit is not drawn, since CW only approximates it.
            const course = M.sampleTrajectory(model.rmoe, n, 0, spanT, count);
            sim = { model, n, spanT, count, course };
            if (stage.inertial) {
                stage.inertial.setOrbit(model.target);
                stage.inertial.setChaseOrbit(null);
                stage.inertial.setPath(V.framePath(model.target, times, course));
            }
            t = 0;
            refit();
        }

        /* ---------- zoom ----------
         * Fitting the panes to the whole motion would give the answer away (its size sets the
         * zoom). Until the motion or the solution shows, the panes fit only what the problem gives:
         * the target, chase's start, and any path that is part of the question, never closer than
         * DEFAULT_HALF_KM around the target. When the answer shows, the zoom eases out (or in) to
         * the whole motion over ZOOM_SECONDS. */
        const DEFAULT_HALF_KM = 5;
        const ZOOM_SECONDS = 0.9;
        let tween = null;
        const planesNow = () => [stage.left, stage.secondPlane()].filter(Boolean);

        // What the panes may fit before the answer shows.
        function givenPaths() {
            const d = DEFAULT_HALF_KM;
            const pts = [0, 0, 0, d, 0, 0, -d, 0, 0, 0, d, 0, 0, -d, 0, 0, 0, d, 0, 0, -d];
            if (sim.rel && (sim.model.showStart || sim.model.before)) pts.push(sim.start[0], sim.start[1], sim.start[2]);
            return [new Float64Array(pts)].concat(sim.rel && sim.before ? [sim.before] : []);
        }
        // The whole motion, shown with the answer or the solution steps. While a step before the
        // motion draws the course (the walkthrough's middle steps), it is part of the solution too.
        function revealed() {
            if (motionShown()) return true;
            if (!sim.rel || stageKey === 'given') return false;
            return !(sim.model.before && stageKey === 'burn');
        }
        const fitPathsNow = () => (revealed() ? sim.fitPaths || [sim.course] : givenPaths());

        function applyFit(paths) {
            const planes = planesNow();
            // Share one scale among the panes on screen only: a pane hidden by the small-stage
            // switch has no size, and its scale would zoom the visible pane far out.
            const visible = stage.visiblePlanes().filter(p => planes.indexOf(p) >= 0);
            V.fitPanes(visible.length ? visible : planes, paths, true);
            planes.filter(p => visible.indexOf(p) < 0).forEach(p => V.fitPanes([p], paths, true));
        }
        // Jump to the fit for what is shown now (a new problem, a resize).
        function refit() {
            if (!sim || !stage) return;
            tween = null;
            applyFit(fitPathsNow());
        }
        // Ease from the current zoom to the fit for what is shown now.
        function refitSmooth() {
            if (!sim || !stage) return;
            if (Kit.prefersReducedMotion()) { refit(); return; }
            const planes = planesNow();
            const from = planes.map(p => ({ s: 1 / p.kmPerPx(), c: p.center().slice() }));
            applyFit(fitPathsNow());
            const to = planes.map(p => ({ s: 1 / p.kmPerPx(), c: p.center().slice() }));
            planes.forEach((p, k) => p.setScale(from[k].s, from[k].c));
            const moves = to.some((q, k) => Math.abs(Math.log(q.s / from[k].s)) > 1e-3 || q.c.some((v, j) => Math.abs(v - from[k].c[j]) * q.s > 0.5));
            tween = moves ? { planes, from, to, time: 0 } : null;
        }
        function stepTween(dt) {
            tween.time += dt;
            const u = Math.min(1, tween.time / ZOOM_SECONDS);
            const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;   // ease in and out
            tween.planes.forEach((p, k) => {
                const a = tween.from[k], b = tween.to[k];
                p.setScale(a.s * Math.pow(b.s / a.s, e), [a.c[0] + (b.c[0] - a.c[0]) * e, a.c[1] + (b.c[1] - a.c[1]) * e]);
            });
            if (u >= 1) tween = null;
        }

        /* ---------- rel: course-model motion from RMOEs alone ----------
         * model: { a, n, rmoe, revs, showStart?, start?, before?, dv?, dvGiven? }.
         * The target is on a circular equatorial orbit of radius a. start: chase's state before a burn
         * (default: the epoch state of rmoe); before: the RMOEs before that burn, drawn faintly until
         * the answer; dv: the burn, its arrow shown at the 'burn' step, or from the start when
         * dvGiven. */
        function buildRel(model) {
            const n = model.n, revs = model.revs || 2;
            const spanT = revs * 2 * Math.PI / n;
            const count = Math.round(POINTS_PER_REV * revs) + 1;
            const times = new Float64Array(count);
            for (let k = 0; k < count; k++) times[k] = spanT * k / (count - 1);
            const coe = { a: model.a, e: 0, i: 0, raan: 0, argp: 0, nu: 0 };
            const course = M.sampleTrajectory(model.rmoe, n, 0, spanT, count);
            const before = model.before ? M.sampleTrajectory(model.before, n, 0, spanT, count) : null;
            const start = model.start || M.stateFromRmoe(model.rmoe, n, 0);
            const loop = M.nmcLoop(model.rmoe);
            sim = { model, n, spanT, count, course, before, start, loop, coe, rel: true, fitPaths: [course, loop].concat(before ? [before] : []) };
            if (stage.inertial) {
                stage.inertial.setOrbit(coe);
                stage.inertial.setChaseOrbit(null);
                stage.inertial.setPath(V.framePath(coe, times, course));
            }
            t = 0;
            refit();
        }

        // The motion is shown once the walkthrough reaches the answer, or once answers are graded.
        const motionShown = () => stageKey === 'answer' || answersShown;

        function drawRel() {
            const shown = motionShown();
            const m = sim.model;
            const tt = shown ? t : 0;
            const k = Math.max(0, Math.min(sim.count - 1, Math.round(tt / sim.spanT * (sim.count - 1))));
            let data, rho;
            if (shown) {
                rho = M.stateFromRmoe(m.rmoe, sim.n, tt);
                data = { chase: rho, trail: sim.course.subarray(0, 3 * (k + 1)), ghosts: [sim.course], rmoe: stageKey === 'answer' ? M.rmoeAt(m.rmoe, sim.n, tt) : null };
            } else {
                rho = sim.start;
                const early = stageKey === 'given' || stageKey === 'burn';
                if (m.before && early) {
                    data = { chase: sim.start, ghosts: [sim.before] };
                    if ((stageKey === 'burn' || m.dvGiven) && m.dv) data.burns = [{ at: sim.start, dv: m.dv }];
                }
                else if (stageKey === 'given') data = m.showStart ? { chase: sim.start } : {};
                else data = { chase: m.showStart ? sim.start : M.stateFromRmoe(m.rmoe, sim.n, 0), ghosts: [sim.course], rmoe: m.rmoe, showNmc: true };
            }
            const panes = [stage.left, stage.secondPlane()].filter(Boolean);
            panes.forEach(pane => pane.draw(data));
            if (stage.inertial) {
                const basis = M.ricBasis(sim.coe, tt);
                stage.inertial.update({ t: tt, rho, basis, rT: basis.r, from: 0, to: shown ? k : 0 });
            }
        }

        function draw() {
            if (!sim || !stage) return;
            if (sim.rel) { drawRel(); return; }
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
                const basis = M.ricBasis(sim.model.target, tt);
                stage.inertial.update({ t: tt, rho: now, basis, rT: basis.r, from: 0, to: shown ? k : 0 });
            }
        }

        /* ---------- shared ---------- */
        function show(which) {
            dualHost.style.display = which === 'motion' || which === 'rel' ? '' : 'none';
        }

        // Playback: only while the motion is shown, looping over the revs in the model.
        Kit.startLoop(dt => {
            if ((kind !== 'motion' && kind !== 'rel') || !sim) return;
            if (tween) { stepTween(dt); if (!motionShown()) draw(); }
            if (!motionShown()) return;
            if (Kit.prefersReducedMotion()) {
                if (t !== sim.spanT) { t = sim.spanT; draw(); }
                return;
            }
            const revs = sim.model.revs || 2;
            t += dt * sim.spanT / ((sim.model.secondsPerRev || PLAY_SECONDS_PER_REV) * revs);
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
                if (kind === 'rel') { ensureStage(); buildRel(source.model); draw(); }
            },
            setStage(key) {
                stageKey = key || 'given';
                if (kind === 'motion' || kind === 'rel') { if (!motionShown()) t = 0; refitSmooth(); draw(); }
            },
            setAnswersShown(value) {
                answersShown = Boolean(value);
                if (kind === 'motion' || kind === 'rel') { refitSmooth(); draw(); }
            },
            resize() {
                if (kind === 'motion' || kind === 'rel') { refit(); draw(); }
            }
        };
    }

    global.Test2Scene = { create };
})(window);
