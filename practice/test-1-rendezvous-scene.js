// The 3D view for rendezvous problems on the Test 1 Practice page. It is the view from the
// Inertial Rendezvous tool (../orbits/inertial-rendezvous-scene.js), driven by the walkthrough.
// It starts with only the given orbits, the two spacecraft at their given positions (theta from
// I-hat), and phi_0. Each step adds what it
// finds, moves the mission timeline to the part of the rendezvous it explains, and plays that
// part when the step is about motion. Computed values are labeled only after the answers are
// graded; from then on, every part is drawn.
// Load as a classic script, after inertial-rendezvous-scene.js.
(function (global) {
    'use strict';

    const Kit = global.ToolKit;
    const smooth = (t) => t * t * (3 - 2 * t);

    const START_DELAY = 0.6;    // A step starts playing this long after the camera starts moving

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
        perigee: { phi0: true, nu: true, phasing: true, burns: true },
        burn: { phi0: true, nu: true, phasing: true, burns: true }
    };

    function create(THREE, dom, constants) {
        const Scene = global.RendezvousScene;
        if (!Scene) return null;
        const view = Scene.create(THREE, dom, constants);
        if (!view) return null;

        let model = null;
        let stage = 'given';
        let answersShown = false;
        let play = null;    // { from, to, clock, seconds }: the timeline playing toward `to`

        // A point in a part of the mission: f = 0 at its start, 1 at its end. The end of a part
        // stays just inside it: at the end of the wait, the phase angle has reached phi_desired.
        function at(key, f) {
            const seg = Scene.segments(model).find((s) => s.key === key);
            if (!seg) return 0;
            const tl = seg.from + f * (seg.to - seg.from);
            return f >= 1 ? Math.max(seg.from, tl - 1e-4) : tl;
        }

        // Playing time for the wait: longer when the chase coasts more laps, so each lap
        // stays slow enough to follow
        function waitSeconds() {
            const laps = (model.n_chase * model.WT) / (2 * Math.PI);
            return Math.min(7, 2.4 + 0.8 * laps);
        }

        // Where each step puts the timeline: a fixed point, or a span it plays through. `focus`
        // is the part the camera frames (anything but a burn frames the whole scene).
        function planFor(name) {
            if (model.mode === 'coplanar') {
                // About one lap of the chase: enough to watch phi change at the drift rate
                const lap = Math.min(1, (2 * Math.PI) / (model.n_chase * model.WT));
                switch (name) {
                    case 'motions': return { from: 0, to: at('wait', lap), focus: 'overview', seconds: 2.8 };
                    // The departure burn, then the flight to the far end of the transfer
                    case 'transfer':
                    case 'travel': return { from: at('burn1', 0), to: at('transfer', 1), focus: 'transfer', seconds: 3.4 };
                    case 'desired': return { to: at('wait', 1), focus: 'wait' };
                    case 'wait': return { from: 0, to: at('wait', 1), focus: 'wait', seconds: waitSeconds() };
                    // The whole mission: wait, burn, transfer, burn, together
                    case 'total': return { from: 0, to: 1, focus: 'together', seconds: waitSeconds() + 3.6 };
                    default: return { to: 0, focus: 'overview' };
                }
            }
            // Co-orbital. Halfway around the first phasing orbit, the chase is at the point
            // farthest from the burn: perigee when it is behind, apogee when it is ahead.
            const half = at('phasing', 0) + (at('phasing', 1) - at('phasing', 0)) / (2 * model.k);
            switch (name) {
                // The first burn, every phasing orbit, and the burn back onto the circle
                case 'period': return { from: 0, to: 1, focus: 'phasing', seconds: 2.8 + 0.8 * model.k };
                case 'size':
                case 'perigee': return { to: half, focus: 'phasing' };
                // The first burn grows from the old velocity to the new one
                case 'burn': return { from: at('burn1', 0), to: at('burn1', 1), focus: 'burn1', seconds: 1.6 };
                default: return { to: 0, focus: 'overview' };
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
            play = null;
            applyReveal();
            view.setFrame(problem.positions ? problem.positions.chase : null);
            view.setModel(model);
            view.setTime(0);
            view.setFocus('overview', true);
        }

        function setStage(next) {
            if (!model) return;
            stage = next;
            applyReveal();
            const plan = planFor(next);
            view.setFocus(plan.focus);
            if (plan.from === undefined || Kit.prefersReducedMotion()) {
                play = null;
                view.setTime(plan.to);
                return;
            }
            view.setTime(plan.from);
            play = { from: plan.from, to: plan.to, clock: -START_DELAY, seconds: plan.seconds };
        }

        function setAnswersShown(shown) {
            answersShown = Boolean(shown);
            applyReveal();
        }

        Kit.startLoop((seconds) => {
            if (!play) return;
            play.clock += seconds;
            const k = Math.max(0, Math.min(1, play.clock / play.seconds));
            view.setTime(play.from + (play.to - play.from) * smooth(k));
            if (k >= 1) play = null;
        });

        return { setProblem, setStage, setAnswersShown, resize: view.resize };
    }

    global.Test1RendezvousScene = { create };
})(window);
