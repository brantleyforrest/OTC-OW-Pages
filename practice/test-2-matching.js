// Test 2 Practice: a card-matching drill for any deck of { key, name, clue } cards. The clue is
// text that may hold math between dollar signs. Modeled on the Test 1 laws drill.
// Practice mode marks each pair at once and lets a wrong pair go, so the student can try again.
// Test mode lets the student pair every card, change pairs freely, and grades them on submit.
(function (global) {
    'use strict';

    const { prose } = global.PracticeMath;
    const TAGS = 'ABCDEFGHIJKL';
    const WRONG_FLASH_MS = 750;

    function shuffled(list) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    }

    // els: { names, clues, score, submit }. The page calls deal({ mode, deck }) for each new drill.
    function create(els) {
        const state = {
            mode: 'practice', cards: [], pairs: new Map(), selected: null,
            misses: 0, submitted: false, blankWarned: false, flashTimer: 0
        };
        let nameCards = {}, clueCards = {};

        function makeCard(side, card, index) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'match-card ' + side;
            el.dataset.key = card.key;
            const tag = document.createElement('span');
            tag.className = 'match-tag';
            if (side === 'name') tag.textContent = TAGS[index];
            const body = document.createElement('span');
            body.className = 'match-body';
            body.innerHTML = prose(side === 'name' ? card.name : card.clue);
            const note = document.createElement('span');
            note.className = 'match-note';
            el.append(tag, body, note);
            el.addEventListener('click', () => pick(side, card.key));
            return el;
        }

        function deal(options) {
            clearTimeout(state.flashTimer);
            state.mode = options.mode;
            state.cards = shuffled(options.deck);
            state.pairs = new Map();
            state.selected = null;
            state.misses = 0;
            state.submitted = false;
            state.blankWarned = false;
            els.names.textContent = '';
            els.clues.textContent = '';
            nameCards = {}; clueCards = {};
            state.cards.forEach((card, index) => {
                nameCards[card.key] = makeCard('name', card, index);
                els.names.appendChild(nameCards[card.key]);
            });
            shuffled(state.cards).forEach(card => {
                clueCards[card.key] = makeCard('clue', card);
                els.clues.appendChild(clueCards[card.key]);
            });
            els.submit.hidden = state.mode !== 'test';
            render();
        }

        const tagOf = key => TAGS[state.cards.findIndex(c => c.key === key)];
        const nameFor = clueKey => { for (const [n, c] of state.pairs) if (c === clueKey) return n; return null; };
        const isMatched = (side, key) => (side === 'name' ? state.pairs.has(key) : nameFor(key) !== null);

        function pick(side, key) {
            if (state.submitted) return;
            const card = side === 'name' ? nameCards[key] : clueCards[key];
            if (card.classList.contains('flash-wrong')) return;
            if (state.mode === 'practice' && isMatched(side, key)) return;
            if (state.mode === 'test' && isMatched(side, key)) {
                if (side === 'name') state.pairs.delete(key); else state.pairs.delete(nameFor(key));
                state.blankWarned = false;
            }
            const sel = state.selected;
            if (!sel || sel.side === side) {
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
            state.misses += 1;
            const pair = [nameCards[nameKey], clueCards[clueKey]];
            pair.forEach(c => c.classList.add('flash-wrong'));
            render();
            state.flashTimer = setTimeout(() => pair.forEach(c => c.classList.remove('flash-wrong')), WRONG_FLASH_MS);
        }

        function submit() {
            if (state.mode !== 'test' || state.submitted) return;
            const open = state.cards.length - state.pairs.size;
            if (open && !state.blankWarned) {
                state.blankWarned = true;
                setScore(open + ' unpaired. Submit again to grade anyway.', true);
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
            const total = state.cards.length, graded = state.submitted, practice = state.mode === 'practice';
            for (const card of state.cards) {
                const nameCard = nameCards[card.key], clueCard = clueCards[card.key];
                const pairedClue = state.pairs.has(card.key) ? state.pairs.get(card.key) : null;
                const pairedName = nameFor(card.key);
                for (const [el, side] of [[nameCard, 'name'], [clueCard, 'clue']]) {
                    const sel = state.selected;
                    el.classList.toggle('selected', Boolean(sel && sel.side === side && sel.key === card.key));
                    el.setAttribute('aria-pressed', String(el.classList.contains('selected')));
                }
                clueCard.querySelector('.match-tag').textContent = pairedName ? tagOf(pairedName) : '';
                const nameRight = pairedClue === card.key, clueRight = pairedName === card.key;
                nameCard.classList.toggle('paired', pairedClue !== null && !graded && !practice);
                clueCard.classList.toggle('paired', pairedName !== null && !graded && !practice);
                nameCard.classList.toggle('right', (practice || graded) && nameRight);
                clueCard.classList.toggle('right', (practice || graded) && clueRight);
                nameCard.classList.toggle('wrong', graded && !nameRight);
                clueCard.classList.toggle('wrong', graded && !clueRight);
                nameCard.disabled = graded || (practice && nameRight);
                clueCard.disabled = graded || (practice && clueRight);
                const note = clueCard.querySelector('.match-note');
                note.textContent = graded && !clueRight ? '✗ ' + tagOf(card.key) + ': ' + card.name.replace(/\$/g, '') : '';
            }
            const right = state.cards.filter(c => state.pairs.get(c.key) === c.key).length;
            if (practice) {
                const misses = state.misses + (state.misses === 1 ? ' miss' : ' misses');
                setScore(right === total ? 'All ' + total + ' matched with ' + misses + '.' : right + ' of ' + total + ' matched · ' + misses);
            } else if (graded) setScore(right + ' of ' + total + ' correct');
            else if (!state.blankWarned) setScore(state.pairs.size + ' of ' + total + ' paired');
            els.submit.hidden = state.mode !== 'test' || graded;
        }

        const isDone = () => state.submitted || (state.mode === 'practice' && state.cards.every(c => state.pairs.get(c.key) === c.key));
        return { deal, submit, isDone };
    }

    global.Test2Matching = { create };
})(window);
