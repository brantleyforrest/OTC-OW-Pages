// Test 1 Practice: the two modes, the answer form, and the walkthrough.
// Practice mode shows the view from the start and lets the student walk through the steps.
// Test mode shows only the problem and the answer form until the answers are graded.
// Problem types supply the numbers and the worked steps. See rv-coe-problems.js.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const Check = window.AnswerCheck;
    const { math } = window.PracticeMath;
    const problemType = window.RvCoeProblems;

    const MODE_CAPTIONS = {
        practice: 'The view starts with the problem as given, and the walkthrough builds the orbit step by step.',
        test: 'Enter your answers and submit. The view and the walkthrough open after grading.'
    };

    const state = {
        mode: 'practice',
        problem: null,
        submitted: false,
        blankWarned: false,
        active: -1,             // Index of the open walkthrough step, or -1 for none
        visited: new Set()      // Steps whose results may be shown
    };

    const viz = createViz();

    /* ------------------------------------------------------------------ */
    /* Answer Form                                                        */
    /* ------------------------------------------------------------------ */
    const answerRows = {};

    problemType.fields.forEach((field, index) => {
        const row = document.createElement('div');
        row.className = 'answer';
        row.dataset.field = field.key;

        const label = document.createElement('label');
        label.htmlFor = `answer-${field.key}`;
        const symbol = document.createElement('span');
        symbol.className = 'sym';
        symbol.innerHTML = math(field.tex);
        label.append(symbol, document.createTextNode(field.name));

        const box = document.createElement('div');
        box.className = 'answer-box';
        const input = document.createElement('input');
        input.id = `answer-${field.key}`;
        input.type = 'text';
        input.inputMode = 'decimal';
        input.spellcheck = false;
        const unit = document.createElement('span');
        unit.className = 'answer-unit';
        unit.textContent = field.unit;
        box.append(input, unit);

        const noteEl = document.createElement('div');
        noteEl.className = 'answer-note';

        row.append(label, box, noteEl);
        $('answers').appendChild(row);
        answerRows[field.key] = { row, input, noteEl };

        // Enter moves to the next box. In the last box, it submits the form.
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const next = problemType.fields[index + 1];
            if (!next) return;
            event.preventDefault();
            answerRows[next.key].input.focus();
        });

        // In practice mode, changing an answer clears its old mark.
        input.addEventListener('input', () => {
            if (state.submitted) return;
            setMark(field.key, '', '');
            $('score').textContent = '';
            state.blankWarned = false;
        });
    });

    function setMark(key, result, text) {
        const { row, noteEl } = answerRows[key];
        row.classList.toggle('right', result === 'right');
        row.classList.toggle('wrong', result === 'wrong');
        noteEl.textContent = text;
    }

    function resetAnswers() {
        problemType.fields.forEach((field) => {
            answerRows[field.key].input.value = '';
            answerRows[field.key].input.readOnly = false;
            setMark(field.key, '', '');
        });
        $('score').textContent = '';
        $('score').classList.remove('warn');
    }

    function setScore(text, warn) {
        $('score').textContent = text;
        $('score').classList.toggle('warn', Boolean(warn));
    }

    // In practice mode, a mark says only right or wrong, so the student can try again.
    // In test mode, grading is final, so a mark also gives the correct value.
    function noteFor(result, answer, isTest) {
        const blank = result === 'blank' || result === 'invalid';
        if (isTest) {
            if (result === 'right') return `✓ ${answer.text}`;
            return `✗ Correct: ${answer.text}`;
        }
        if (result === 'right') return '✓ Correct';
        if (blank) return result === 'blank' ? 'Enter a value' : 'Enter a number';
        return '✗ Not within the limit';
    }

    function gradeAnswers() {
        const isTest = state.mode === 'test';
        const results = problemType.fields.map((field) => ({
            field,
            result: Check.grade(field.tolerance, answerRows[field.key].input.value, state.problem.answers[field.key].value)
        }));

        const blanks = results.filter((item) => item.result === 'blank').length;
        if (isTest && blanks && !state.blankWarned) {
            state.blankWarned = true;
            setScore(`${blanks} blank. Submit again to grade anyway.`, true);
            return;
        }

        results.forEach(({ field, result }) => {
            // In test mode, anything that is not right is marked wrong, including a blank.
            const shown = result === 'right' ? 'right' : (isTest || result === 'wrong' ? 'wrong' : '');
            setMark(field.key, shown, noteFor(result, state.problem.answers[field.key], isTest));
        });

        const correct = results.filter((item) => item.result === 'right').length;
        setScore(`${correct} of ${results.length} correct`);

        if (isTest) {
            state.submitted = true;
            problemType.fields.forEach((field) => { answerRows[field.key].input.readOnly = true; });
            state.problem.steps.forEach((step, index) => state.visited.add(index));
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
            row.resultEl.innerHTML = state.visited.has(index) ? state.problem.steps[index].result : '';
        });
        $('walk-start').hidden = state.active !== -1;
    }

    function goToStep(index) {
        state.active = index;
        if (index >= 0) state.visited.add(index);
        refreshSteps();
        const step = state.problem.steps[index];
        viz.setStage(step ? step.key : 'given', step ? step.caption : problemType.overviewCaption);
        if (index >= 0) stepRows[index].head.scrollIntoView({ block: 'start' });
    }

    $('walk-start').addEventListener('click', () => goToStep(0));

    /* ------------------------------------------------------------------ */
    /* Modes and Problems                                                 */
    /* ------------------------------------------------------------------ */
    function applyLayout() {
        const answersOnly = state.mode === 'test' && !state.submitted;
        document.body.classList.toggle('answers-only', answersOnly);
        $('walk-panel').hidden = answersOnly;
        $('check').hidden = state.submitted;
        $('check').textContent = state.mode === 'test' ? 'Submit Answers' : 'Check Answers';
        $('new-problem').classList.toggle('primary', state.submitted);
    }

    function newProblem() {
        state.problem = problemType.generate();
        state.submitted = false;
        state.blankWarned = false;
        state.active = -1;
        state.visited = new Set();

        $('given').innerHTML = state.problem.statement;
        resetAnswers();
        buildSteps();
        applyLayout();
        viz.setProblem(state.problem);
        viz.setStage('given', problemType.overviewCaption);
    }

    Kit.bindSegmented($('mode'), (mode) => {
        state.mode = mode;
        $('mode-caption').textContent = MODE_CAPTIONS[mode];
        newProblem();
    });

    $('new-problem').addEventListener('click', newProblem);

    /* ------------------------------------------------------------------ */
    /* 3D View                                                            */
    /* ------------------------------------------------------------------ */
    // The answer form and the walkthrough do not depend on this. If the 3D library cannot be
    // loaded, the view reports that, and the rest of the page still works.
    function createViz() {
        const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
        const statusEl = $('status');
        const hud = $('hud');
        const pending = { problem: null, stage: 'given' };
        let live = null;

        function showStatus(text) {
            statusEl.style.display = 'flex';
            statusEl.textContent = text;
        }

        (async () => {
            showStatus('Loading the 3D view...');
            let THREE;
            try {
                THREE = await import(THREE_URL);
            } catch (err) {
                showStatus('The 3D library could not be loaded. The view needs an internet connection the first time it opens. The answers and walkthrough still work.');
                return;
            }
            live = window.RvCoeScene.create(THREE, {
                view: $('view'),
                canvas: $('scene'),
                labels: $('labels'),
                hint: $('view-hint'),
                reset: $('reset-view'),
                showStatus
            }, problemType.constants);
            if (!live) return;
            statusEl.style.display = 'none';
            if (pending.problem) live.setProblem(pending.problem);
            live.setStage(pending.stage);
        })();

        return {
            setProblem(problem) {
                pending.problem = problem;
                if (live) live.setProblem(problem);
            },
            setStage(stage, caption) {
                pending.stage = stage;
                hud.innerHTML = caption;
                if (live) live.setStage(stage);
            },
            resize() {
                if (live) live.resize();
            }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Start                                                              */
    /* ------------------------------------------------------------------ */
    $('problem-title').textContent = problemType.title;
    $('problem-prompt').textContent = problemType.prompt;
    $('answer-limits').innerHTML = problemType.limitsHtml;
    $('mode-caption').textContent = MODE_CAPTIONS[state.mode];
    newProblem();
})();
