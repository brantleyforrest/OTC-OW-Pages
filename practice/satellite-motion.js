// Moves a satellite through a walkthrough. The satellite's place on its path is one number, tau,
// measured in the path's own time units, so that moving at a steady rate in tau looks like real
// orbital motion: faster near perigee, slower near apogee. Each step gives the satellite a plan:
// places to move to, conditions to wait for, and, last, a stretch to keep going around.
(function (global) {
    'use strict';

    const REWIND_SECONDS = 0.6;     // Going back along the path is quick
    const MAX_LEG_SECONDS = 4;      // A long coast forward is sped up to take no longer than this
    const TWO_PI = 2 * Math.PI;

    const smooth = (t) => t * t * (3 - 2 * t);

    // secondsPerUnit: how many seconds on screen one unit of tau takes at the natural rate.
    function create(secondsPerUnit) {
        const m = { tau: 0, steps: [], leg: null, loop: null };

        // A forward leg can name its own `seconds`, to slow it down for the reader.
        function startLeg(to, seconds) {
            const span = to - m.tau;
            if (Math.abs(span) < 1e-9) return;
            const natural = seconds === undefined ? Math.min(MAX_LEG_SECONDS, span * secondsPerUnit) : seconds;
            const duration = span < 0 ? REWIND_SECONDS : natural;
            m.leg = { from: m.tau, to, duration, clock: 0, eased: span < 0 };
        }

        return {
            get tau() { return m.tau; },

            // Puts the satellite at tau with nothing to do.
            reset(tau) {
                m.tau = tau;
                m.steps = [];
                m.leg = null;
                m.loop = null;
            },

            // steps: { to } moves to that tau ({ to, seconds } takes that long going forward); { wait } holds until wait() returns true.
            // loop: [from, to] keeps the satellite going around that stretch after the last step.
            plan(steps, loop = null) {
                m.steps = steps.slice();
                m.leg = null;
                m.loop = loop;
            },

            // Skips to where the plan ends, for reduced motion.
            finish() {
                for (const step of m.steps) if (step.to !== undefined) m.tau = step.to;
                m.steps = [];
                m.leg = null;
            },

            // Returns true if the satellite moved. With `still`, it does not keep going around.
            advance(seconds, still = false) {
                let left = seconds;
                let moved = false;
                while (left > 0) {
                    if (!m.leg) {
                        const step = m.steps[0];
                        if (!step) break;
                        if (step.wait && !step.wait()) break;
                        m.steps.shift();
                        if (step.to !== undefined) startLeg(step.to, step.seconds);
                        continue;
                    }
                    const leg = m.leg;
                    const used = Math.min(left, leg.duration - leg.clock);
                    leg.clock += used;
                    left -= used;
                    const k = leg.clock / leg.duration;
                    m.tau = leg.from + (leg.to - leg.from) * (leg.eased ? smooth(k) : k);
                    if (leg.clock >= leg.duration - 1e-9) {
                        m.tau = leg.to;
                        m.leg = null;
                    }
                    moved = true;
                }
                if (!m.leg && !m.steps.length && m.loop && !still && left > 0) {
                    const [from, to] = m.loop;
                    m.tau += left / secondsPerUnit;
                    if (m.tau >= to) m.tau = from + ((m.tau - from) % (to - from));
                    moved = true;
                }
                return moved;
            }
        };
    }

    // Kepler's equation, for an ellipse with eccentricity e. Both keep track of whole turns, so
    // that the angle keeps growing as the satellite goes around again.
    function trueFromMean(M, e) {
        const turns = Math.round(M / TWO_PI);
        const Mr = M - turns * TWO_PI;
        let E = e < 0.8 ? Mr : Math.PI * Math.sign(Mr || 1);
        for (let k = 0; k < 30; k++) {
            const step = (E - e * Math.sin(E) - Mr) / (1 - e * Math.cos(E));
            E -= step;
            if (Math.abs(step) < 1e-12) break;
        }
        const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
        return nu + turns * TWO_PI;
    }

    function meanFromTrue(nu, e) {
        const turns = Math.round(nu / TWO_PI);
        const nr = nu - turns * TWO_PI;
        const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nr / 2), Math.sqrt(1 + e) * Math.cos(nr / 2));
        return E - e * Math.sin(E) + turns * TWO_PI;
    }

    // How far along a curve, by length, the curve's own parameter t is. A tube is drawn by
    // length, so this keeps a drawn path's end on a satellite that moves by time.
    function lengthFraction(curve, t) {
        const lengths = curve.getLengths();
        const n = lengths.length - 1;
        const x = Math.max(0, Math.min(1, t)) * n;
        const i = Math.min(n - 1, Math.floor(x));
        const value = lengths[i] + (lengths[i + 1] - lengths[i]) * (x - i);
        return lengths[n] > 0 ? value / lengths[n] : 0;
    }

    global.SatelliteMotion = { create, trueFromMean, meanFromTrue, lengthFraction };
})(window);
