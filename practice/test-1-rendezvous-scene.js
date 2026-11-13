// The 3D view for rendezvous problems on the Test 1 Practice page. It is the view from the
// Inertial Rendezvous tool (../orbits/inertial-rendezvous-scene.js), driven by the walkthrough.
// It starts with only the given orbits, the two spacecraft at their given positions (theta from
// I-hat), and phi_0. Each step adds what it finds and animates it: an angle sweeps in, or the
// mission timeline plays the part of the rendezvous the step explains.
//
// The steps follow the lesson's order, not the mission's, so the timeline sometimes has to go
// back. Going forward, a step carries on from where the last one stopped. Going back, the view
// fades out and in rather than jumping. Playback moves at an even pace set by the orbits: a
// lap of a coast takes about the same time in every step, and long coasts are sped up to fit.
// Computed values are labeled only after the answers are graded; from then on, every part is
// drawn.
// Load as a classic script, after inertial-rendezvous-scene.js.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;

    const LAP_SECONDS = 3.6;        // One lap of a coast
    const FLIGHT_MIN = 1.8;         // The shortest a transfer or phasing orbit plays (half a lap)
    const BURN_SECONDS = 1.0;       // A burn's velocity arrows growing
    const TOGETHER_SECONDS = 0.8;   // The two spacecraft flying together at the end
    const PLAY_MIN = 1.2;           // The shortest any play lasts
    const PLAY_MAX = 9;             // The longest a step plays; coasts are sped up to fit
    const TOTAL_MAX = 12;           // The same, for a step that plays the whole mission
    const RAMP = 0.12;              // Share of a play spent speeding up, and slowing down
    const SWEEP_SECONDS = 0.9;      // An angle sweeping in
    const START_DELAY = 0.5;        // Pause before a step animates, after a fade or camera move
    const FADE_SECONDS = 0.22;      // Each half of the fade when the timeline goes back

    // The parts of the solution drawn at each step (see `reveal` in inertial-rendezvous-scene.js)
    // The spacecraft positions are given, not phi_0, so the view starts with each one's theta
    // from I-hat, and phi_0's value is labeled from the first step on, where it is found.
    const GIVEN = { thetas: true };
    const COPLANAR_REVEAL = {
        phase: { phi0: true, thetas: true },
        motions: { phi0: true },
        synodic: { phi0: true },
        transfer: { phi0: true, transfer: true, burns: true },
        travel: { phi0: true, transfer: true, burns: true, nu: true },
        desired: { phi0: true, transfer: true, burns: true, nu: true, desired: true },
        wait: { phi0: true, transfer: true, burns: true, nu: true, desired: true },
        total: { phi0: true, transfer: true, burns: true, nu: true, desired: true }
    };
    const COORBITAL_REVEAL = {
        phase: { phi0: true, thetas: true },
        nu: { phi0: true, nu: true },
        period: { phi0: true, nu: true, phasing: true, burns: true },
        size: { phi0: true, nu: true, phasing: true, burns: true },
        perigee: { phi0: true, nu: true, phasing: true, burns: true, perigee: true },
        burn: { phi0: true, nu: true, phasing: true, burns: true, perigee: true }
    };

    // Position along a play of length 1 at time s (0 to 1): speeds up over the first RAMP,
    // moves at an even pace, and slows down over the last RAMP
    function profile(s) {
        const v = 1 / (1 - RAMP);
        if (s <= 0) return 0;
        if (s >= 1) return 1;
        if (s < RAMP) return (v * s * s) / (2 * RAMP);
        if (s > 1 - RAMP) return 1 - (v * (1 - s) * (1 - s)) / (2 * RAMP);
        return v * (s - RAMP / 2);
    }

    function create(THREE, dom, constants) {
        const Scene = global.RendezvousScene;
        if (!Scene) return null;
        const view = Scene.create(THREE, dom, constants);
        if (!view) return null;

        let model = null;
        let stage = 'given';
        let answersShown = false;
        let tlNow = 0;          // Where the timeline is now
        let focus = 'overview'; // What the camera frames
        let opacity = 1;        // The view's opacity, during a fade
        let grown = {};         // Parts sweeping in, and how far (see setGrow in the scene)
        let tasks = [];         // The animation queue for the current step, run in order

        function setTl(tl) {
            tlNow = tl;
            view.setTime(tl);
        }

        function setOpacity(o) {
            opacity = o;
            if (dom.canvas) dom.canvas.style.opacity = String(o);
            if (dom.labels) dom.labels.style.opacity = String(o);
        }

        function setGrown(parts) {
            grown = answersShown ? {} : parts;
            view.setGrow(grown);
        }

        // A point in a part of the mission: f = 0 at its start, 1 at its end. The end of a part
        // stays just inside it: at the end of the wait, the phase angle has reached phi_desired.
        function at(key, f) {
            const seg = Scene.segments(model).find((s) => s.key === key);
            if (!seg) return 0;
            const tl = seg.from + f * (seg.to - seg.from);
            return f >= 1 ? Math.max(seg.from, tl - 1e-4) : tl;
        }

        /* -------------------------------------------------------------- */
        /* Pace                                                           */
        /* -------------------------------------------------------------- */
        // Natural playing time of a whole part of the mission
        function partSeconds(seg) {
            const span = seg.t1 - seg.t0;
            if (seg.key.startsWith('burn')) return BURN_SECONDS;
            if (seg.key === 'together') return TOGETHER_SECONDS;
            if (seg.key === 'wait') return (span * model.n_chase / (2 * Math.PI)) * LAP_SECONDS;
            if (seg.key === 'transfer') return Math.max(FLIGHT_MIN, (span / (2 * model.TOF)) * LAP_SECONDS);
            if (seg.key === 'phasing') return Math.max(FLIGHT_MIN * model.k, (span / model.Period_phasing) * LAP_SECONDS);
            return 1;
        }

        // The timeline from a to b, split into legs that each play at their own even pace.
        // Burns and the end keep their time; coasts and flights share what is left of `max`.
        function legsFor(a, b, max) {
            const legs = [];
            for (const seg of Scene.segments(model)) {
                const lo = Math.max(a, seg.from), hi = Math.min(b, seg.to);
                if (hi - lo < 1e-9) continue;
                const share = (hi - lo) / Math.max(1e-9, seg.to - seg.from);
                const fixed = seg.key.startsWith('burn') || seg.key === 'together';
                legs.push({ a: lo, b: hi, seconds: share * partSeconds(seg), fixed });
            }
            const fixedTime = legs.reduce((sum, l) => sum + (l.fixed ? l.seconds : 0), 0);
            const freeTime = legs.reduce((sum, l) => sum + (l.fixed ? 0 : l.seconds), 0);
            if (freeTime > 0 && fixedTime + freeTime > max) {
                const scale = Math.max(0.1, (max - fixedTime) / freeTime);
                legs.forEach((l) => { if (!l.fixed) l.seconds *= scale; });
            }
            const total = legs.reduce((sum, l) => sum + l.seconds, 0);
            if (total > 0 && total < PLAY_MIN) legs.forEach((l) => { l.seconds *= PLAY_MIN / total; });
            return legs;
        }

        /* -------------------------------------------------------------- */
        /* Tasks                                                          */
        /* -------------------------------------------------------------- */
        const call = (fn) => ({ seconds: 0, update: fn });
        const pause = (seconds) => ({ seconds, update() {} });

        function fade(to) {
            const task = {
                seconds: FADE_SECONDS,
                start() { task.from = opacity; task.seconds = FADE_SECONDS * Math.abs(to - opacity); },
                update(f) { setOpacity(task.from + (to - task.from) * f); }
            };
            return task;
        }

        function sweep(part) {
            return {
                seconds: SWEEP_SECONDS,
                update(f) { setGrown({ ...grown, [part]: f * f * (3 - 2 * f) }); }
            };
        }

        function play(from, to, max) {
            const task = {
                seconds: 0,
                start() {
                    task.legs = legsFor(from, to, max);
                    task.seconds = task.legs.reduce((sum, l) => sum + l.seconds, 0);
                },
                update(f) {
                    let left = profile(f) * task.seconds;
                    for (const leg of task.legs) {
                        if (left <= leg.seconds || leg === task.legs[task.legs.length - 1]) {
                            const k = leg.seconds > 0 ? Math.min(1, left / leg.seconds) : 1;
                            setTl(leg.a + (leg.b - leg.a) * k);
                            return;
                        }
                        left -= leg.seconds;
                    }
                }
            };
            return task;
        }

        // startLoop already caps a frame at 0.1 s, so a tab coming back from the background
        // does not skip ahead
        Kit.startLoop((seconds) => {
            let budget = seconds;
            while (tasks.length) {
                const task = tasks[0];
                if (!task.started) {
                    task.started = true;
                    task.clock = 0;
                    if (task.start) task.start();
                }
                if (!(task.seconds > 0)) {
                    task.update(1);
                    tasks.shift();
                    continue;
                }
                task.clock += budget;
                budget = 0;
                const f = Math.min(1, task.clock / task.seconds);
                task.update(f);
                if (f < 1) break;
                budget = task.clock - task.seconds;
                tasks.shift();
            }
        });

        /* -------------------------------------------------------------- */
        /* Steps                                                          */
        /* -------------------------------------------------------------- */
        // What each step does:
        //   at        hold the timeline here, or
        //   from, to  play from one point to another
        //   follow    carry on from where the timeline already is, if it is between this and `to`
        //   sweep     parts that sweep in, in order (before the play, or after it with `after`)
        //   trace     the target travel arc follows the target through the transfer
        //   focus     the camera frames a burn up close; anything else frames the whole scene
        function planFor(name) {
            if (model.mode === 'coplanar') {
                // About one lap of the chase, enough to watch phi change at the drift rate, but
                // never more than half the wait, so the synodic step has the rest to play
                const lap = Math.min(0.5, (2 * Math.PI) / (model.n_chase * model.WT));
                const departure = at('wait', 1);
                switch (name) {
                    case 'phase': return { at: 0, sweep: ['thetas', 'phi'] };
                    case 'motions': return { from: 0, to: at('wait', lap), follow: 0 };
                    // On through the wait, to the first opportunity
                    case 'synodic': return { from: at('wait', lap), to: departure, follow: 0 };
                    // The departure burn, then the flight to the far end of the transfer
                    case 'transfer': return { from: at('burn1', 0), to: at('transfer', 1), follow: departure };
                    // The transfer again, with the target's travel drawn as it goes
                    case 'travel': return { from: at('burn1', 0), to: at('transfer', 1), trace: true };
                    case 'desired': return { at: departure, sweep: ['desired'] };
                    case 'wait': return { from: 0, to: departure };
                    // The whole mission: wait, burn, transfer, burn, together
                    case 'total': return { from: 0, to: 1, max: TOTAL_MAX };
                    default: return { at: 0 };
                }
            }
            // Co-orbital. Halfway around the first phasing orbit, the chase is at the point
            // farthest from the burn: perigee when it is behind, apogee when it is ahead. When
            // it is ahead, perigee is the burn point, reached at the end of that orbit.
            const p0 = at('phasing', 0), p1 = at('phasing', 1);
            const half = p0 + (p1 - p0) / (2 * model.k);
            const firstLap = Math.min(p1, p0 + (p1 - p0) / model.k);
            switch (name) {
                case 'phase': return { at: 0, sweep: ['thetas', 'phi'] };
                case 'nu': return { at: 0, sweep: ['nu'] };
                // The first burn, every phasing orbit, and the burn back onto the circle
                case 'period': return { from: 0, to: 1, follow: 0, max: TOTAL_MAX };
                // Out to the point farthest from the burn
                case 'size': return { from: 0, to: half };
                case 'perigee': return model.isBehind
                    ? { at: half, sweep: ['perigee'] }
                    : { from: half, to: firstLap, follow: half, sweep: ['perigee'], after: true };
                // The first burn grows from the old velocity to the new one
                case 'burn': return { from: at('burn1', 0), to: at('burn1', 1), focus: 'burn1' };
                default: return { at: 0 };
            }
        }

        function applyReveal() {
            const table = model && model.mode === 'coplanar' ? COPLANAR_REVEAL : COORBITAL_REVEAL;
            view.setShown({ values: answersShown, reveal: answersShown ? null : (table[stage] || GIVEN) });
        }

        function setProblem(problem) {
            if (!problem || !problem.model) return;
            model = problem.model;
            stage = 'given';
            answersShown = false;
            tasks = [];
            setOpacity(1);
            applyReveal();
            view.setShown({ traceNu: false, perigee: true });
            setGrown({});
            view.setFrame(problem.positions ? problem.positions.chase : null);
            view.setModel(model);
            setTl(0);
            focus = 'overview';
            view.setFocus(focus, true);
        }

        function setStage(next) {
            if (!model) return;
            stage = next;
            const plan = planFor(next);
            const holding = plan.at !== undefined;
            const end = holding ? plan.at : plan.to;
            const follows = plan.follow !== undefined && tlNow >= plan.follow - 1e-6 && tlNow < end - 1e-6;
            const begin = holding ? plan.at : (follows ? tlNow : plan.from);
            const sweeps = answersShown ? [] : (plan.sweep || []);

            // The camera moves only when what it frames changes, so a view the student has
            // turned stays put from step to step
            const nextFocus = plan.focus || 'overview';
            const refocus = nextFocus !== focus;
            if (refocus) {
                focus = nextFocus;
                view.setFocus(focus);
            }

            const enter = () => {
                applyReveal();
                view.setShown({ traceNu: Boolean(plan.trace) });
                setGrown(Object.fromEntries(sweeps.map((part) => [part, 0])));
                setTl(begin);
            };

            if (Kit.prefersReducedMotion()) {
                tasks = [];
                enter();
                setGrown({});
                setTl(end);
                setOpacity(1);
                return;
            }

            const cut = Math.abs(tlNow - begin) > 1e-6;
            const queue = [];
            if (cut) queue.push(fade(0));
            queue.push(call(enter));
            if (cut || opacity < 1) queue.push(fade(1));
            // Settle only after a fade or a camera move; otherwise an arc that is about to
            // sweep in again would sit hidden
            queue.push(pause(cut || refocus ? START_DELAY : 0.1));
            const sweepTasks = sweeps.map(sweep);
            const playTask = end > begin + 1e-6 ? [play(begin, end, plan.max || PLAY_MAX)] : [];
            queue.push(...(plan.after ? playTask.concat(sweepTasks) : sweepTasks.concat(playTask)));
            tasks = queue;
        }

        function setAnswersShown(shown) {
            answersShown = Boolean(shown);
            applyReveal();
            if (answersShown) setGrown({});
        }

        return { setProblem, setStage, setAnswersShown, resize: view.resize };
    }

    global.Test1RendezvousScene = { create };
})(window);
