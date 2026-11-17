// Test 2 Practice: the page controller, modeled on test-1-practice.js. A section is one entry in
// SECTIONS plus one problem module (window.Test2<Name>Problems with generate(type) and grade).
// A section that is not built yet is simply not in the list, so it never shows in the selector.
// A module's generate may return an ordinary problem (answer form and walkthrough) or a card
// deck ({ matching: true, title, prompt, deck }), which opens the matching panel instead.
// Practice mode shows the view and the walkthrough; marks say only right or wrong.
// Test mode shows only the problem and the answer form until the answers are graded.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const { math, prose } = window.PracticeMath;
    const V = window.RpoViews;

    // In the order the topics are taught. types: the topic buttons, the first one the default.
    const SECTIONS = [
        { key: 'axes', label: 'RIC Axes', module: window.Test2AxesProblems,
          types: [['random', 'Random'], ['arrows', 'Arrows'], ['cards', 'Cards']] },
        { key: 'motion', label: 'Elements to Motion', module: window.Test2MotionProblems,
          types: [['random', 'Random'], ['perch', 'Perch'], ['linear-drift', 'Drift'], ['stationary-nmc', 'NMC'],
              ['drifting-nmc', 'Drifting NMC'], ['cross-track', 'Cross-Track'], ['drifting-cross-track', 'Drift + Cross-Track'],
              ['nmc-cross-track', 'Cross-Track NMC'], ['corkscrew', 'Corkscrew']] },
        { key: 'concepts', label: 'Concepts', module: window.Test2ConceptsProblems,
          types: [['random', 'Random'], ['assumptions', 'CW Assumptions'], ['rmoe', 'RMOEs'], ['elements', 'Elements'], ['burns', 'Burns']] }
    ].filter(s => s.module);
    const byKey = Object.fromEntries(SECTIONS.map(s => [s.key, s]));

    const MODE_CAPTIONS = {
        practice: 'The view starts with the problem as given, and the walkthrough builds the solution step by step.',
        test: 'Enter your answers and submit. The view and the walkthrough open after grading.'
    };
    const CARD_CAPTIONS = {
        practice: 'Each pair is checked as you make it. A wrong pair lets go, so you can try again.',
        test: 'Pair every card, then submit. Pick a paired card to undo its pair before submitting.'
    };

    const hash = location.hash.slice(1);
    const state = {
        mode: 'practice',
        section: byKey[hash] ? hash : SECTIONS[0].key,
        types: Object.fromEntries(SECTIONS.map(s => [s.key, s.types[0][0]])),
        problem: null,
        submitted: false,
        blankWarned: false,
        active: -1,
        visited: new Set()
    };

    const viz = createViz();
    const cards = window.Test2Matching.create({
        names: $('match-names'), clues: $('match-clues'), score: $('cards-score'), submit: $('cards-submit')
    });

    /* ------------------------------------------------------------------ */
    /* Problems                                                           */
    /* ------------------------------------------------------------------ */
    function generate() {
        const section = byKey[state.section];
        const p = section.module.generate(state.types[state.section]);
        if (p.matching) return p;
        return {
            view: p.model && p.model.kind ? 'scene' : null,
            viewIsGiven: Boolean(p.viewIsGiven),
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            fields: p.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => section.module.grade(field, text, p.answers[field.key].value)
        };
    }

    /* ------------------------------------------------------------------ */
    /* Answer Form                                                        */
    /* ------------------------------------------------------------------ */
    let answerRows = {};
    const PICK_TYPES = ['choice', 'plot', 'sign'];

    function clearMarkOnChange(field) {
        if (state.submitted) return;
        setMark(field.key, '', '');
        setScore('');
        state.blankWarned = false;
    }

    function buildAnswerForm() {
        const fields = state.problem.fields;
        const box = $('answers');
        box.textContent = '';
        answerRows = {};
        box.classList.toggle('check-list', fields.every((f) => f.unitType === 'check'));
        fields.forEach((field, index) => {
            if (field.unitType === 'check') buildCheckRow(field);
            else if (PICK_TYPES.includes(field.unitType)) buildPickRow(field);
            else buildTextRow(field, index);
        });
        setScore('');
    }

    function labelFor(field, forId) {
        const label = document.createElement(forId ? 'label' : 'div');
        label.className = 'answer-label';
        if (forId) label.htmlFor = forId;
        if (field.tex) {
            const symbol = document.createElement('span');
            symbol.className = 'sym';
            symbol.innerHTML = math(field.tex);
            label.appendChild(symbol);
        }
        const name = document.createElement('span');
        name.innerHTML = prose(field.name);
        label.appendChild(name);
        return label;
    }

    function buildTextRow(field, index) {
        const fields = state.problem.fields;
        const row = document.createElement('div');
        row.className = 'answer';
        row.dataset.field = field.key;
        const box = document.createElement('div');
        box.className = 'answer-box';
        const input = document.createElement('input');
        input.id = `answer-${field.key}`;
        input.type = 'text';
        input.inputMode = field.textOk ? 'text' : 'decimal';
        input.spellcheck = false;
        if (field.placeholder) input.placeholder = field.placeholder;
        const unit = document.createElement('span');
        unit.className = 'answer-unit';
        unit.textContent = field.unit || '';
        box.append(input, unit);
        const noteEl = document.createElement('div');
        noteEl.className = 'answer-note';
        row.append(labelFor(field, input.id), box, noteEl);
        $('answers').appendChild(row);
        answerRows[field.key] = { row, input, noteEl, kind: 'text' };
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const next = fields[index + 1];
            if (!next || !answerRows[next.key] || answerRows[next.key].kind !== 'text') return;
            event.preventDefault();
            answerRows[next.key].input.focus();
        });
        input.addEventListener('input', () => clearMarkOnChange(field));
    }

    function buildCheckRow(field) {
        const row = document.createElement('label');
        row.className = 'answer check';
        row.dataset.field = field.key;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `answer-${field.key}`;
        const name = document.createElement('span');
        name.className = 'check-name';
        name.innerHTML = prose(field.name);
        const noteEl = document.createElement('span');
        noteEl.className = 'answer-note';
        row.append(input, name, noteEl);
        $('answers').appendChild(row);
        answerRows[field.key] = { row, input, noteEl, kind: 'check' };
        input.addEventListener('change', () => clearMarkOnChange(field));
    }

    // Radio buttons: words ('choice'), a sign ('sign'), or pairs of small plots ('plot').
    function buildPickRow(field) {
        const row = document.createElement('div');
        row.className = 'answer pick pick-' + field.unitType;
        row.dataset.field = field.key;
        const group = document.createElement('div');
        group.className = 'pick-group';
        group.setAttribute('role', 'radiogroup');
        const options = field.unitType === 'sign'
            ? [{ value: '+', html: '+' }, { value: '-', html: '−' }, { value: '0', html: '0' }]
            : field.options;
        const inputs = [];
        options.forEach((option) => {
            const label = document.createElement('label');
            label.className = 'pick-option';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `answer-${field.key}`;
            input.value = option.value;
            label.appendChild(input);
            if (field.unitType === 'plot') {
                const tag = document.createElement('span');
                tag.className = 'pick-tag';
                tag.textContent = option.value;
                const pair = document.createElement('span');
                pair.className = 'plot-pair';
                option.plots.forEach((spec) => {
                    const cell = document.createElement('span');
                    cell.className = 'plot-cell plot-' + spec.plane;
                    const canvas = document.createElement('canvas');
                    cell.appendChild(canvas);
                    pair.appendChild(cell);
                });
                label.append(tag, pair);
                drawPlotPair(pair, option.plots);
            } else {
                const text = document.createElement('span');
                text.innerHTML = prose(option.html);
                label.appendChild(text);
            }
            input.addEventListener('change', () => clearMarkOnChange(field));
            inputs.push(input);
            group.appendChild(label);
        });
        const noteEl = document.createElement('div');
        noteEl.className = 'answer-note';
        row.append(labelFor(field), group, noteEl);
        $('answers').appendChild(row);
        answerRows[field.key] = { row, inputs, noteEl, kind: 'pick' };
    }

    // The two plots of a pair share one scale, so the same distance looks the same in both.
    function drawPlotPair(pair, plots) {
        const M = window.RpoMath;
        const cells = [...pair.children];
        const paths = plots.map((spec) => spec.path || M.sampleTrajectory(spec.rmoe, spec.n, 0, (spec.revs || 1) * 2 * Math.PI / spec.n, Math.round(120 * (spec.revs || 1)) + 1));
        const draw = () => {
            const panes = cells.map((cell, k) => {
                const pane = V.createRicPlane(cell.firstChild, { plane: plots[k].plane, compact: true });
                pane.resize(cell.clientWidth || 120, cell.clientHeight || 90);
                return pane;
            });
            V.fitPanes(panes, paths, true);
            panes.forEach((pane, k) => {
                const path = paths[k], end = path.length / 3 - 1;
                pane.draw({ trail: path, marker: [path[0], path[1], path[2]], chase: [path[3 * end], path[3 * end + 1], path[3 * end + 2]] });
            });
        };
        let pending = 0;
        Kit.observeSize(pair, () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); });
    }

    // What the student gave: the text typed, '1' for a checked box, or the picked option's value
    function answerText(field) {
        const r = answerRows[field.key];
        if (r.kind === 'check') return r.input.checked ? '1' : '';
        if (r.kind === 'pick') { const on = r.inputs.find((i) => i.checked); return on ? on.value : ''; }
        return r.input.value;
    }

    function setMark(key, result, text) {
        const { row, noteEl } = answerRows[key];
        row.classList.toggle('right', result === 'right');
        row.classList.toggle('wrong', result === 'wrong');
        noteEl.textContent = text;
    }

    function setScore(text, warn) {
        $('score').textContent = text;
        $('score').classList.toggle('warn', Boolean(warn));
    }

    function noteFor(result, answer, isTest, field) {
        if (field.unitType === 'check') {
            if (result === 'right') return '✓';
            return isTest ? `✗ ${answer.value ? 'should be checked' : 'should be empty'}` : '✗';
        }
        const pick = PICK_TYPES.includes(field.unitType);
        if (isTest) return result === 'right' ? `✓ ${answer.text}` : `✗ Correct: ${answer.text}`;
        if (result === 'right') return '✓ Correct';
        if (result === 'blank') return pick ? 'Pick one' : 'Enter a value';
        if (result === 'invalid') return 'Enter a number';
        return pick ? '✗ Not this one' : '✗ Not within the limit';
    }

    function gradeAnswers() {
        const isTest = state.mode === 'test';
        const problem = state.problem;
        const results = problem.fields.map((field) => ({ field, result: problem.grade(field, answerText(field)) }));
        const blanks = results.filter((item) => item.result === 'blank').length;
        if (isTest && blanks && !state.blankWarned) {
            state.blankWarned = true;
            setScore(`${blanks} blank. Submit again to grade anyway.`, true);
            return;
        }
        results.forEach(({ field, result }) => {
            const shown = result === 'right' ? 'right' : (isTest || result === 'wrong' ? 'wrong' : '');
            setMark(field.key, shown, noteFor(result, problem.answers[field.key], isTest, field));
        });
        const correct = results.filter((item) => item.result === 'right').length;
        setScore(`${correct} of ${results.length} correct`);
        const allAttempted = results.every((item) => item.result === 'right' || item.result === 'wrong');
        if (isTest || allAttempted) viz.showAnswers();
        if (isTest) {
            state.submitted = true;
            problem.fields.forEach((field) => {
                const r = answerRows[field.key];
                if (r.kind === 'pick') r.inputs.forEach((i) => { i.disabled = true; });
                else if (r.kind === 'check') r.input.disabled = true;
                else r.input.readOnly = true;
            });
            problem.steps.forEach((step, index) => state.visited.add(index));
            applyLayout();
            refreshSteps();
            viz.resize();
        }
    }

    $('answer-form').addEventListener('submit', (event) => {
        event.preventDefault();
        if (!state.submitted) gradeAnswers();
    });

    /* ------------------------------------------------------------------ */
    /* Walkthrough                                                        */
    /* ------------------------------------------------------------------ */
    const stepRows = [];

    function makeButton(text, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = text;
        button.addEventListener('click', onClick);
        return button;
    }

    function methodTabs(step, work) {
        const tabs = document.createElement('div');
        tabs.className = 'segmented methods';
        tabs.setAttribute('role', 'group');
        tabs.setAttribute('aria-label', 'Choose a method');
        step.methods.forEach((method, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.value = String(index);
            button.setAttribute('aria-pressed', String(index === 0));
            button.textContent = method.name;
            tabs.appendChild(button);
        });
        Kit.bindSegmented(tabs, (value) => { work.innerHTML = step.methods[Number(value)].html; });
        return tabs;
    }

    function buildStepRow(step, index, total) {
        const item = document.createElement('li');
        item.className = 'step';
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'step-head';
        head.innerHTML = `<span class="step-num">${index + 1}</span><span class="step-title">${step.title}</span><span class="step-result"></span>`;
        head.addEventListener('click', () => goToStep(state.active === index ? -1 : index));
        const body = document.createElement('div');
        body.className = 'step-body';
        body.hidden = true;
        const work = document.createElement('div');
        work.innerHTML = step.methods[0].html;
        if (step.methods.length > 1) body.appendChild(methodTabs(step, work));
        body.appendChild(work);
        const nav = document.createElement('div');
        nav.className = 'step-nav';
        if (index > 0) nav.appendChild(makeButton('Back', () => goToStep(index - 1)));
        if (index < total - 1) nav.appendChild(makeButton('Next', () => goToStep(index + 1)));
        body.appendChild(nav);
        item.append(head, body);
        return { item, head, body, resultEl: head.querySelector('.step-result') };
    }

    function buildSteps() {
        const list = $('steps');
        list.textContent = '';
        stepRows.length = 0;
        state.problem.steps.forEach((step, index) => {
            const row = buildStepRow(step, index, state.problem.steps.length);
            stepRows.push(row);
            list.appendChild(row.item);
        });
        refreshSteps();
    }

    function refreshSteps() {
        stepRows.forEach((row, index) => {
            const open = index === state.active;
            row.item.classList.toggle('active', open);
            row.body.hidden = !open;
            row.head.setAttribute('aria-expanded', String(open));
            row.resultEl.innerHTML = state.visited.has(index) ? prose(state.problem.steps[index].result || '') : '';
        });
        $('walk-start').hidden = state.active !== -1;
    }

    function goToStep(index) {
        state.active = index;
        if (index >= 0) state.visited.add(index);
        refreshSteps();
        const step = state.problem.steps[index];
        viz.setStage(step ? step.key : 'given', step ? step.caption : state.problem.overviewCaption);
        if (index >= 0) stepRows[index].head.scrollIntoView({ block: 'nearest' });
    }

    $('walk-start').addEventListener('click', () => goToStep(0));

    /* ------------------------------------------------------------------ */
    /* Modes, Sections, and Problems                                      */
    /* ------------------------------------------------------------------ */
    function applyLayout() {
        const onCards = Boolean(state.problem && state.problem.matching);
        document.body.classList.toggle('cards-only', onCards);
        document.body.classList.toggle('no-view', !onCards && Boolean(state.problem) && !state.problem.view);
        $('cards-panel').hidden = !onCards;
        $('problem-panel').hidden = onCards;
        $('mode-caption').textContent = (onCards ? CARD_CAPTIONS : MODE_CAPTIONS)[state.mode];
        if (onCards) {
            document.body.classList.remove('answers-only');
            $('walk-panel').hidden = true;
            $('new-problem').classList.toggle('primary', cards.isDone());
            return;
        }
        const ungraded = state.mode === 'test' && !state.submitted;
        const answersOnly = ungraded && !state.problem.viewIsGiven;
        document.body.classList.toggle('answers-only', answersOnly);
        $('walk-panel').hidden = ungraded;
        $('check').hidden = state.submitted;
        $('check').textContent = state.mode === 'test' ? 'Submit Answers' : 'Check Answers';
        $('new-problem').classList.toggle('primary', state.submitted);
    }

    function newProblem() {
        state.problem = generate();
        state.submitted = false;
        state.blankWarned = false;
        state.active = -1;
        state.visited = new Set();
        if (state.problem.matching) {
            $('cards-title').textContent = state.problem.title;
            $('cards-prompt').innerHTML = prose(state.problem.prompt);
            cards.deal({ mode: state.mode, deck: state.problem.deck });
            applyLayout();
            return;
        }
        $('problem-title').textContent = state.problem.title;
        $('problem-prompt').innerHTML = state.problem.prompt;
        $('given').innerHTML = state.problem.statement;
        $('given').hidden = !state.problem.statement;
        $('answer-limits').innerHTML = state.problem.limitsHtml;
        buildAnswerForm();
        buildSteps();
        applyLayout();
        viz.setProblem(state.problem);
        viz.setStage('given', state.problem.overviewCaption);
    }

    function buildSelectors() {
        const sectionGroup = $('section');
        sectionGroup.textContent = '';
        SECTIONS.forEach((s) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.value = s.key;
            b.textContent = s.label;
            b.setAttribute('aria-pressed', String(s.key === state.section));
            sectionGroup.appendChild(b);
        });
        sectionGroup.style.setProperty('--section-count', String(SECTIONS.length));
        Kit.bindSegmented(sectionGroup, (key) => {
            state.section = key;
            history.replaceState(null, '', `#${key}`);
            showTopics();
            newProblem();
        });
        showTopics();
    }

    function showTopics() {
        const group = $('topic');
        group.textContent = '';
        const section = byKey[state.section];
        section.types.forEach(([value, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.value = value;
            b.textContent = label;
            b.setAttribute('aria-pressed', String(value === state.types[state.section]));
            group.appendChild(b);
        });
        Kit.bindSegmented(group, (value) => {
            state.types[state.section] = value;
            newProblem();
        });
    }

    Kit.bindSegmented($('mode'), (mode) => {
        state.mode = mode;
        newProblem();
    });

    $('cards-panel').addEventListener('click', () => {
        if (state.problem && state.problem.matching) $('new-problem').classList.toggle('primary', cards.isDone());
    });
    $('cards-submit').addEventListener('click', () => cards.submit());
    $('new-problem').addEventListener('click', newProblem);

    /* ------------------------------------------------------------------ */
    /* View                                                               */
    /* ------------------------------------------------------------------ */
    // The scene is made once the 3D library has loaded (or failed to load); until then the
    // latest problem and step wait in `pending`. The flat drawings and RIC panes work without it.
    function createViz() {
        const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
        const statusEl = $('status');
        const hud = $('hud');
        const pending = { problem: null, stage: 'given', answersShown: false };
        let scene = null;

        function showStatus(text) {
            statusEl.style.display = text ? 'flex' : 'none';
            statusEl.textContent = text;
        }

        (async () => {
            showStatus('Loading the 3D view...');
            let THREE = null;
            try { THREE = await import(THREE_URL); } catch (err) { THREE = null; }
            showStatus('');
            scene = window.Test2Scene.create({ container: $('view'), THREE });
            if (pending.problem && pending.problem.view) {
                scene.setProblem(pending.problem.source);
                scene.setAnswersShown(pending.answersShown);
                scene.setStage(pending.stage);
            }
        })();

        return {
            setProblem(problem) {
                pending.problem = problem;
                pending.answersShown = false;
                pending.stage = 'given';
                if (scene && problem.view) scene.setProblem(problem.source);
            },
            setStage(stage, caption) {
                pending.stage = stage;
                hud.innerHTML = caption || '';
                if (scene && pending.problem && pending.problem.view) scene.setStage(stage);
            },
            showAnswers() {
                pending.answersShown = true;
                if (scene && pending.problem && pending.problem.view) scene.setAnswersShown(true);
            },
            resize() { if (scene) scene.resize(); }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Start                                                              */
    /* ------------------------------------------------------------------ */
    buildSelectors();
    newProblem();

    // For checks in the browser console.
    window.test2Practice = { state, newProblem, sections: SECTIONS.map(s => s.key) };
})();
