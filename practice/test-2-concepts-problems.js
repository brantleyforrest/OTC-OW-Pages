// Test 2 Practice, Concepts (#concepts). One check-all problem (the assumptions the CW equations
// need) and three card decks: what each RMOE means, what each element difference does, and what
// each burn direction changes. No DOM access. Load after test-2-common.js and practice-math.js.
(function (global) {
    'use strict';

    const C2 = global.Test2Common;
    const { prose, rule, note } = global.PracticeMath;

    const ASSUMPTIONS = {
        right: [
            { key: 'circular', text: 'The target’s orbit is circular', why: 'The RIC frame turns at the constant rate n only if the target’s orbit is circular.' },
            { key: 'twobody', text: 'Only two-body gravity acts, with no perturbations', why: 'The equations come from two-body gravity alone; drag, $J_2$, and the like are left out.' },
            { key: 'close', text: 'Chase stays close to the target compared with the orbit radius', why: 'The gravity difference is linearized, which holds only while the range is small next to the orbit radius.' }
        ],
        wrong: [
            { key: 'chasecirc', text: 'Chase’s orbit is circular', why: 'Chase’s orbit may be elliptical; that is what makes an NMC.' },
            { key: 'mass', text: 'Both spacecraft have the same mass', why: 'Mass does not appear: both fall the same way in gravity.' },
            { key: 'equatorial', text: 'The target’s orbit is equatorial', why: 'Any inclination works; the RIC frame is built from the target’s own orbit plane.' },
            { key: 'coplanar', text: 'Chase and target are in the same orbit plane', why: 'A small plane difference is allowed; it gives the cross-track motion.' },
            { key: 'geo', text: 'The target is geostationary', why: 'Any circular orbit works, at any altitude.' },
            { key: 'rotate', text: 'Earth does not rotate', why: 'Earth’s rotation plays no part in two-body motion, so nothing needs to be assumed about it.' }
        ]
    };

    const DECKS = {
        rmoe: {
            title: 'What Each RMOE Means',
            prompt: 'Match each relative motion orbital element (RMOE) to what it describes.',
            cards: [
                { key: 'xc', name: '$x_C$', clue: 'Radial position of the NMC center; it sets the drift' },
                { key: 'yc0', name: '$y_{C0}$', clue: 'In-track position of the NMC center at epoch' },
                { key: 'C', name: '$C$', clue: 'Size of the NMC: its radial semi-axis (the in-track semi-axis is $2C$)' },
                { key: 'M0', name: '$M_0$', clue: 'Where chase is on the NMC at epoch: 0° bottom, 90° front, 180° top, 270° back' },
                { key: 'zmax', name: '$z_{max}$', clue: 'Largest cross-track distance' },
                { key: 'dM0', name: '$\\Delta M_0$', clue: 'Where chase is in the cross-track cycle: 0° +P.C., 90° far left' }
            ]
        },
        elements: {
            title: 'Element Differences',
            prompt: 'Match each difference between chase’s and the target’s orbital elements to the relative motion it gives.',
            cards: [
                { key: 'nu', name: 'Only $\\nu$ differs', clue: 'A fixed point ahead or behind: a perch' },
                { key: 'a', name: 'Only $a$ differs', clue: 'A steady slide along the track with no ellipse: drift' },
                { key: 'e', name: 'Only $e$ differs', clue: 'A 2-by-1 ellipse that stays put: NMC' },
                { key: 'i', name: 'Only $i$ or $\\Omega$ differs', clue: 'Side-to-side oscillation: cross-track motion' },
                { key: 'ae', name: '$a$ and $e$ differ', clue: 'Loops that drift: drifting NMC' },
                { key: 'aei', name: '$a$, $e$, and $i$ differ', clue: 'Drifting loops that also swing side to side: corkscrew' },
                { key: 'ai', name: '$a$ and $\\Omega$ differ', clue: 'Side-to-side swing plus a drift: drift with cross-track motion' }
            ]
        },
        burns: {
            title: 'What Each Burn Changes',
            prompt: 'Match each burn to what it does to the relative motion.',
            cards: [
                { key: 'x', name: 'Radial burn, $\\Delta V_x$', clue: 'Shifts the NMC center forward or backward and changes $C$ and $M$; the drift stays the same' },
                { key: 'y', name: 'In-track burn, $\\Delta V_y$', clue: 'Shifts the NMC center up or down, so it starts, stops, or changes the drift' },
                { key: 'z', name: 'Cross-track burn, $\\Delta V_z$', clue: 'Changes only the side-to-side swing: $z_{max}$ and $\\Delta M$' },
                { key: 'pR', name: '+R burn from rest', clue: 'A closed 2-by-1 ellipse centered behind the target' },
                { key: 'pI', name: '+I burn from rest', clue: 'Loops that walk backward, each ending behind where it started' }
            ]
        }
    };

    function assumptionsProblem() {
        const wrong = C2.shuffle(ASSUMPTIONS.wrong).slice(0, 4);
        const items = C2.shuffle(ASSUMPTIONS.right.concat(wrong));
        const fields = items.map(it => ({ key: it.key, tex: '', name: it.text, unitType: 'check' }));
        const answers = {};
        items.forEach(it => {
            const needed = ASSUMPTIONS.right.includes(it);
            answers[it.key] = { value: needed ? 1 : 0, text: needed ? 'Needed' : 'Not needed' };
        });
        const needed = ASSUMPTIONS.right.map(it => rule('<b>' + it.text + '.</b> ' + it.why)).join('');
        const notNeeded = wrong.map(it => rule('<b>' + it.text + ':</b> not needed. ' + it.why)).join('');
        return {
            type: 'assumptions',
            model: null,
            title: 'CW Assumptions',
            prompt: prose('Which assumptions do the Clohessy-Wiltshire (CW) equations need? Check every one that applies.'),
            statement: '',
            overviewCaption: '',
            limitsHtml: 'Each box is graded on its own.',
            fields,
            answers,
            steps: [
                { key: 'needed', title: 'The three assumptions', result: '3 boxes', caption: '',
                  methods: [{ name: 'Needed', html: needed }] },
                { key: 'others', title: 'Why the others are not needed', result: '', caption: '',
                  methods: [{ name: 'Not needed', html: notNeeded + note('So the CW equations need a circular target orbit, two-body gravity only, and a chase that stays close.') }] }
            ]
        };
    }

    function deckProblem(name) {
        const d = DECKS[name];
        return { type: name, matching: true, title: d.title, prompt: d.prompt, deck: d.cards.map(c => ({ ...c })) };
    }

    const TYPES = ['assumptions', 'rmoe', 'elements', 'burns'];
    function generate(type) {
        const t = TYPES.includes(type) ? type : C2.pick(TYPES);
        return t === 'assumptions' ? assumptionsProblem() : deckProblem(t);
    }

    function grade(field, text, truth) {
        return (String(text) === '1' ? 1 : 0) === Number(truth) ? 'right' : 'wrong';
    }

    global.Test2ConceptsProblems = { generate, grade, types: TYPES, decks: DECKS, assumptions: ASSUMPTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.Test2ConceptsProblems;
