// Test 1 Practice, Laws section: a card-matching drill for Kepler's three laws and Newton's
// four laws (his three laws of motion and his law of universal gravitation). The wording and
// equations follow the lesson "Inertial Frame 2-Body Motion".
// The student picks a law's name, then the card that describes it (or the other way round).
// Practice mode marks each pair at once and lets a wrong pair go, so the student can try again.
// Test mode lets the student pair every card, change pairs freely, and grades them on submit.
(function (global) {
    'use strict';

    const { math, prose } = global.PracticeMath;

    // Vectors are written as in the lesson: a bar and bold type.
    const vec = (letter) => `\\bar{\\mathbf{${letter}}}`;
    const R = vec('R');
    const V = vec('V');
    const F = vec('F');

    const LAWS = [
        {
            key: 'k1',
            group: 'kepler',
            name: "Kepler's First Law",
            statement: 'The orbit is an ellipse (more generally, a conic section), with the central body at one of its two foci.',
            equation: 'R = \\dfrac{p}{1 + e\\cos\\nu}'
        },
        {
            key: 'k2',
            group: 'kepler',
            name: "Kepler's Second Law",
            statement: 'A line from the central body to the orbiting body sweeps out equal areas in equal intervals of time.',
            equation: `\\dfrac{dA}{dt} = \\tfrac{1}{2}\\,\\|${R} \\times ${V}\\| = \\dfrac{h}{2} = \\text{constant}`
        },
        {
            key: 'k3',
            group: 'kepler',
            name: "Kepler's Third Law",
            statement: "The square of the orbital period is proportional to the cube of the orbit's semi-major axis.",
            equation: '\\mathbb{P}^2 = \\dfrac{4\\pi^2}{\\mu}\\,a^3'
        },
        {
            key: 'n1',
            group: 'newton',
            name: "Newton's First Law",
            statement: 'A body remains at rest or in constant, straight-line motion unless an external force acts on it.',
            equation: `\\Sigma${F} = \\bar{\\mathbf{0}} \\implies ${V} = \\text{constant}`
        },
        {
            key: 'n2',
            group: 'newton',
            name: "Newton's Second Law",
            statement: "The net applied force equals the rate of change of the body's linear momentum, which is mass times acceleration when the mass is constant.",
            equation: `\\Sigma${F}_{\\text{app}} = \\dfrac{d}{dt}(m${V}) = m${vec('a')}`
        },
        {
            key: 'n3',
            group: 'newton',
            name: "Newton's Third Law",
            statement: 'Forces come in interaction pairs: for every action, there is an equal and opposite reaction.',
            equation: `${F}_{g\\text{ 1on2}} = -${F}_{g\\text{ 2on1}}`
        },
        {
            key: 'n4',
            group: 'newton',
            name: "Newton's Law of Universal Gravitation",
            statement: 'The force between two bodies is proportional to the product of their masses and inversely proportional to the square of the distance between them.',
            equation: `${F}_{g\\text{ 2on1}} = -\\dfrac{G\\,m_{\\oplus}\\,m_{\\text{sat}}}{R^2}\\,\\hat{\\mathbf{R}}`
        }
    ];

    const TAGS = 'ABCDEFG';
    const WRONG_FLASH_MS = 750;

    function shuffled(list) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    // els: { names, clues, score, submit }. The page owns the mode, deck, and clue controls and
    // calls deal() whenever one of them changes.
    function create(els) {
        const state = {
            mode: 'practice',
            deck: 'all',            // all, kepler, or newton
            clue: 'statement',      // statement or equation
            laws: [],               // The laws in this deal, in name-column order
            pairs: new Map(),       // name key -> clue key the student paired with it
            selected: null,         // { side: 'name' | 'clue', key }
            misses: 0,
            submitted: false,
            blankWarned: false,
            flashTimer: 0
        };
        let nameCards = {};
        let clueCards = {};

        function makeCard(side, law, index) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = `match-card ${side}`;
            card.dataset.key = law.key;

            const tag = document.createElement('span');
            tag.className = 'match-tag';
            if (side === 'name') tag.textContent = TAGS[index];

            const body = document.createElement('span');
            body.className = 'match-body';
            if (side === 'name') body.textContent = law.name;
            else if (state.clue === 'equation') body.innerHTML = math(law.equation);
            else body.innerHTML = prose(law.statement);

            const note = document.createElement('span');
            note.className = 'match-note';

            card.append(tag, body, note);
            card.addEventListener('click', () => pick(side, law.key));
            return card;
        }

        function deal(options) {
            Object.assign(state, options);
            clearTimeout(state.flashTimer);
            state.laws = LAWS.filter((law) => state.deck === 'all' || law.group === state.deck);
            state.pairs = new Map();
            state.selected = null;
            state.misses = 0;
            state.submitted = false;
            state.blankWarned = false;

            els.names.textContent = '';
            els.clues.textContent = '';
            nameCards = {};
            clueCards = {};
            state.laws.forEach((law, index) => {
                nameCards[law.key] = makeCard('name', law, index);
                els.names.appendChild(nameCards[law.key]);
            });
            shuffled(state.laws).forEach((law) => {
                clueCards[law.key] = makeCard('clue', law);
                els.clues.appendChild(clueCards[law.key]);
            });
            els.submit.hidden = state.mode !== 'test';
            render();
        }

        const tagOf = (nameKey) => TAGS[state.laws.findIndex((law) => law.key === nameKey)];
        const nameFor = (clueKey) => [...state.pairs].find(([, c]) => c === clueKey)?.[0] ?? null;
        const isMatched = (side, key) => (side === 'name' ? state.pairs.has(key) : nameFor(key) !== null);

        function pick(side, key) {
            if (state.submitted) return;
            const card = side === 'name' ? nameCards[key] : clueCards[key];
            if (card.classList.contains('flash-wrong')) return;

            // Practice mode: a matched pair is final.
            if (state.mode === 'practice' && isMatched(side, key)) return;

            // Test mode: picking a paired card breaks its pair, so it can be paired again.
            if (state.mode === 'test' && isMatched(side, key)) {
                if (side === 'name') state.pairs.delete(key);
                else state.pairs.delete(nameFor(key));
                state.blankWarned = false;
            }

            const sel = state.selected;
            if (!sel || sel.side === side) {
                // Nothing chosen on the other side yet: choose this card, or unchoose it.
                state.selected = sel && sel.key === key && sel.side === side ? null : { side, key };
                render();
                return;
            }

            const nameKey = side === 'name' ? key : sel.key;
            const clueKey = side === 'clue' ? key : sel.key;
            state.selected = null;

            if (state.mode === 'test' || nameKey === clueKey) {
                state.pairs.set(nameKey, clueKey);
                render();
                return;
            }

            // A wrong pair in practice mode shows red for a moment, then lets go.
            state.misses += 1;
            const pair = [nameCards[nameKey], clueCards[clueKey]];
            pair.forEach((c) => c.classList.add('flash-wrong'));
            render();
            state.flashTimer = setTimeout(() => {
                pair.forEach((c) => c.classList.remove('flash-wrong'));
            }, WRONG_FLASH_MS);
        }

        function submit() {
            if (state.mode !== 'test' || state.submitted) return;
            const open = state.laws.length - state.pairs.size;
            if (open && !state.blankWarned) {
                state.blankWarned = true;
                setScore(`${open} unpaired. Submit again to grade anyway.`, true);
                return;
            }
            state.submitted = true;
            state.selected = null;
            render();
        }

        function setScore(text, warn) {
            els.score.textContent = text;
            els.score.classList.toggle('warn', Boolean(warn));
        }

        function render() {
            const total = state.laws.length;
            const graded = state.submitted;

            for (const law of state.laws) {
                const nameCard = nameCards[law.key];
                const clueCard = clueCards[law.key];
                const pairedClue = state.pairs.get(law.key) ?? null;
                const pairedName = nameFor(law.key);

                for (const [card, side] of [[nameCard, 'name'], [clueCard, 'clue']]) {
                    const sel = state.selected;
                    card.classList.toggle('selected', Boolean(sel && sel.side === side && sel.key === law.key));
                    card.setAttribute('aria-pressed', String(card.classList.contains('selected')));
                }

                // The clue card carries the letter of the name it is paired with.
                clueCard.querySelector('.match-tag').textContent = pairedName ? tagOf(pairedName) : '';

                const nameRight = pairedClue === law.key;
                const clueRight = pairedName === law.key;
                const practice = state.mode === 'practice';

                nameCard.classList.toggle('paired', pairedClue !== null && !graded && !practice);
                clueCard.classList.toggle('paired', pairedName !== null && !graded && !practice);
                nameCard.classList.toggle('right', (practice && nameRight) || (graded && nameRight));
                clueCard.classList.toggle('right', (practice && clueRight) || (graded && clueRight));
                nameCard.classList.toggle('wrong', graded && !nameRight);
                clueCard.classList.toggle('wrong', graded && !clueRight);

                const locked = graded || (practice && nameRight);
                nameCard.disabled = locked;
                clueCard.disabled = graded || (practice && clueRight);

                // After grading, a wrong clue names the law it belongs to.
                const note = clueCard.querySelector('.match-note');
                note.textContent = graded && !clueRight ? `✗ ${tagOf(law.key)}: ${law.name}` : '';
            }

            const right = state.laws.filter((law) => state.pairs.get(law.key) === law.key).length;
            if (state.mode === 'practice') {
                const misses = `${state.misses} ${state.misses === 1 ? 'miss' : 'misses'}`;
                setScore(right === total
                    ? `All ${total} matched with ${misses}.`
                    : `${right} of ${total} matched · ${misses}`);
            } else if (graded) {
                setScore(`${right} of ${total} correct`);
            } else if (!state.blankWarned) {
                setScore(`${state.pairs.size} of ${total} paired`);
            }
            els.submit.hidden = state.mode !== 'test' || graded;
        }

        // Done: every pair is matched in practice mode, or the answers are graded in test mode.
        const isDone = () => state.submitted
            || (state.mode === 'practice' && state.laws.every((law) => state.pairs.get(law.key) === law.key));

        return { deal, submit, isDone };
    }

    global.Test1LawMatching = { laws: LAWS, create };
})(window);
