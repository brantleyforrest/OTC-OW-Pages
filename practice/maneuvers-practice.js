// Orbital Maneuvers Practice controller:
// Coordinates problems, answer forms, test/practice modes, math walkthroughs, and 3D visualizer.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const { math, prose } = window.PracticeMath;
    const Problems = window.ManeuversProblems;

    const MODE_CAPTIONS = {
        practice: 'Practice Mode: The 3D view shows the orbits and vectors immediately. ΔV values appear once your answers are checked. Step through the walkthrough to see every formula and calculation.',
        test: 'Test Mode: Solve the problem from the given values alone. Submit your answers to grade them, then inspect the full 3D visual and solution.'
    };

    const state = {
        mode: 'practice',
        category: 'all',
        problem: null,
        submitted: false,
        blankWarned: false,
        active: -1,             // Index of open walkthrough step (-1 for none)
        visited: new Set(),
        playing: true,
        speed: 1.0
    };

    const viz = createViz();

    /* ------------------------------------------------------------------ */
    /* Answer Form Management                                             */
    /* ------------------------------------------------------------------ */
    let answerRows = {};

    function rebuildAnswerForm() {
        const container = $('answers');
        container.textContent = '';
        answerRows = {};

        state.problem.fields.forEach((field, index) => {
            const row = document.createElement('div');
            row.className = 'answer';
            row.dataset.field = field.key;

            const label = document.createElement('label');
            label.htmlFor = `ans-${field.key}`;
            const symbol = document.createElement('span');
            symbol.className = 'sym';
            symbol.innerHTML = math(field.tex);
            const fieldName = document.createElement('span');
            fieldName.innerHTML = prose(field.name);
            label.append(symbol, fieldName);

            const box = document.createElement('div');
            box.className = 'answer-box';
            const input = document.createElement('input');
            input.id = `ans-${field.key}`;
            input.type = 'text';
            input.inputMode = 'decimal';
            input.spellcheck = false;
            input.placeholder = field.unit ? `e.g. 0.00` : '';

            const unit = document.createElement('span');
            unit.className = 'answer-unit';
            unit.textContent = field.unit;
            box.append(input, unit);

            const noteEl = document.createElement('div');
            noteEl.className = 'answer-note';

            row.append(label, box, noteEl);
            container.appendChild(row);
            answerRows[field.key] = { row, input, noteEl, field };

            // Enter key advances to next field or submits
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                const nextField = state.problem.fields[index + 1];
                if (nextField && answerRows[nextField.key]) {
                    e.preventDefault();
                    answerRows[nextField.key].input.focus();
                }
            });

            // Input clearing in practice mode
            input.addEventListener('input', () => {
                if (state.submitted) return;
                setMark(field.key, '', '');
                $('score').textContent = '';
                state.blankWarned = false;
            });
        });
    }

    function setMark(key, result, text) {
        if (!answerRows[key]) return;
        const { row, noteEl } = answerRows[key];
        row.classList.toggle('right', result === 'right');
        row.classList.toggle('wrong', result === 'wrong');
        noteEl.textContent = text;
    }

    function resetAnswers() {
        state.problem.fields.forEach((field) => {
            if (answerRows[field.key]) {
                answerRows[field.key].input.value = '';
                answerRows[field.key].input.readOnly = false;
                setMark(field.key, '', '');
            }
        });
        $('score').textContent = '';
        $('score').classList.remove('warn');
    }

    function setScore(text, warn) {
        $('score').textContent = text;
        $('score').classList.toggle('warn', Boolean(warn));
    }

    function noteFor(result, answerObj, isTest) {
        const blank = result === 'blank' || result === 'invalid';
        if (isTest) {
            if (result === 'right') return `✓ ${answerObj.text}`;
            return `✗ Correct: ${answerObj.text}`;
        }
        if (result === 'right') return '✓ Correct';
        if (blank) return result === 'blank' ? 'Enter a value' : 'Enter a number';
        return '✗ Not within the tolerance limit';
    }

    function gradeAnswers() {
        const isTest = state.mode === 'test';
        const results = state.problem.fields.map((field) => {
            const raw = answerRows[field.key].input.value;
            const truth = state.problem.answers[field.key].value;
            const result = Problems.customGrade(field.tolerance, raw, truth, field.unitType);
            return { field, result };
        });

        const blanks = results.filter((r) => r.result === 'blank').length;
        if (isTest && blanks && !state.blankWarned) {
            state.blankWarned = true;
            setScore(`${blanks} blank. Submit again to grade anyway.`, true);
            return;
        }

        results.forEach(({ field, result }) => {
            const shown = result === 'right' ? 'right' : (isTest || result === 'wrong' ? 'wrong' : '');
            setMark(field.key, shown, noteFor(result, state.problem.answers[field.key], isTest));
        });

        const correct = results.filter((r) => r.result === 'right').length;
        setScore(`${correct} of ${results.length} correct`);

        // In practice mode, every field must hold an answer before the ΔV values are revealed.
        const allAttempted = results.every((r) => r.result === 'right' || r.result === 'wrong');
        if (isTest || allAttempted) viz.showAnswers();

        if (isTest) {
            state.submitted = true;
            state.problem.fields.forEach((field) => {
                if (answerRows[field.key]) answerRows[field.key].input.readOnly = true;
            });
            state.problem.steps.forEach((_, idx) => state.visited.add(idx));
            applyLayout();
            refreshSteps();
            viz.resize();
        }
    }

    $('answer-form').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!state.submitted) gradeAnswers();
    });

    /* ------------------------------------------------------------------ */
    /* Walkthrough Construction                                           */
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
        viz.setStage(step ? step.key : 'given', step ? step.caption : `<b>Overview:</b> Maneuver trajectory and impulse vectors.`);
        if (index >= 0 && stepRows[index]) {
            stepRows[index].head.scrollIntoView({ block: 'nearest' });
        }
    }

    $('walk-start').addEventListener('click', () => goToStep(0));

    /* ------------------------------------------------------------------ */
    /* Layout & Mode Handling                                             */
    /* ------------------------------------------------------------------ */
    function applyLayout() {
        const answersOnly = state.mode === 'test' && !state.submitted;
        document.body.classList.toggle('answers-only', answersOnly);
        $('walk-panel').hidden = answersOnly;
        $('check').hidden = state.submitted;
        $('check').textContent = state.mode === 'test' ? 'Submit Answers' : 'Check Answers';
        $('new-problem').classList.toggle('primary', state.submitted);
    }

    function loadProblem(prob) {
        state.problem = prob;
        state.submitted = false;
        state.blankWarned = false;
        state.active = -1;
        state.visited = new Set();

        $('problem-title').textContent = state.problem.title;
        $('problem-prompt').innerHTML = prose(state.problem.prompt);
        $('given').innerHTML = prose(state.problem.statement);
        $('answer-limits').innerHTML = prose(state.problem.limitsHtml);

        rebuildAnswerForm();
        resetAnswers();
        buildSteps();
        applyLayout();
        viz.setProblem(state.problem);
        viz.setStage('given', `<b>Overview:</b> Maneuver trajectory and impulse vectors.`);
    }

    function newProblem() {
        const prob = Problems.generate(state.category);
        loadProblem(prob);
    }

    // Category Selector
    Kit.bindSegmented($('maneuver-type'), (cat) => {
        state.category = cat;
        newProblem();
    });

    // Mode Selector
    Kit.bindSegmented($('mode'), (m) => {
        state.mode = m;
        $('mode-caption').textContent = MODE_CAPTIONS[m];
        newProblem();
    });

    $('new-problem').addEventListener('click', newProblem);

    // Preset Buttons
    $('preset-slide1').addEventListener('click', () => {
        loadProblem(Problems.PRESETS.slide1());
    });

    $('preset-slide2').addEventListener('click', () => {
        loadProblem(Problems.PRESETS.slide2());
    });

    $('preset-combined').addEventListener('click', () => {
        loadProblem(Problems.PRESETS.combined());
    });

    /* ------------------------------------------------------------------ */
    /* 3D Scene Controller                                                */
    /* ------------------------------------------------------------------ */
    function createViz() {
        const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
        const statusEl = $('status');
        const hud = $('hud');
        const pending = { problem: null, stage: 'given', answersShown: false };
        let live = null;

        function showStatus(text) {
            statusEl.style.display = 'flex';
            statusEl.textContent = text;
        }

        // Animation playback controls
        const btnPlay = $('btn-play');
        const iconPlay = $('icon-play');
        const btnRewind = $('btn-rewind');
        const scrub = $('anim-scrub');
        const btnSpeed = $('btn-speed');

        btnPlay.addEventListener('click', () => {
            state.playing = !state.playing;
            iconPlay.innerHTML = state.playing
                ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>'
                : '<polygon points="6 4 20 12 6 20 6 4"></polygon>';
            if (live) live.setPlayState(state.playing);
        });

        btnRewind.addEventListener('click', () => {
            if (live) live.setProgress(0);
            scrub.value = 0;
        });

        scrub.addEventListener('input', (e) => {
            if (live) live.setProgress(Number(e.target.value) / 100);
        });

        // Hold the animation still while the slider is being dragged.
        let scrubbing = false;
        const setScrubbing = (held) => {
            scrubbing = held;
            if (live) live.setHeld(held);
        };
        scrub.addEventListener('pointerdown', () => setScrubbing(true));
        window.addEventListener('pointerup', () => setScrubbing(false));
        window.addEventListener('pointercancel', () => setScrubbing(false));

        const speeds = [0.5, 1.0, 2.0];
        let speedIdx = 1;
        btnSpeed.addEventListener('click', () => {
            speedIdx = (speedIdx + 1) % speeds.length;
            state.speed = speeds[speedIdx];
            btnSpeed.textContent = `${state.speed}x`;
            if (live) live.setSpeed(state.speed);
        });

        (async () => {
            showStatus('Loading 3D Engine...');
            let THREE;
            try {
                THREE = await import(THREE_URL);
            } catch (err) {
                showStatus('The 3D library could not be loaded. Please check your internet connection. Answer checks and math walkthrough still work.');
                return;
            }
            live = window.ManeuversScene.create(THREE, {
                view: $('view'),
                canvas: $('scene'),
                labels: $('labels'),
                hint: $('view-hint'),
                reset: $('reset-view'),
                showStatus,
                onProgress(progress) {
                    if (!scrubbing) scrub.value = progress * 100;
                }
            }, Problems.constants);

            if (!live) return;
            statusEl.style.display = 'none';
            if (pending.problem) live.setProblem(pending.problem);
            live.setAnswersShown(pending.answersShown);
            live.setStage(pending.stage);
        })();

        return {
            setProblem(problem) {
                pending.problem = problem;
                pending.answersShown = false;
                if (live) live.setProblem(problem);
            },
            showAnswers() {
                pending.answersShown = true;
                if (live) live.setAnswersShown(true);
            },
            setStage(stage, caption) {
                pending.stage = stage;
                hud.innerHTML = prose(caption);
                if (live) live.setStage(stage);
            },
            resize() {
                if (live) live.resize();
            }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Start Initialization                                               */
    /* ------------------------------------------------------------------ */
    $('mode-caption').textContent = MODE_CAPTIONS[state.mode];
    // Start with Slide #2 Hohmann Example so the student sees the familiar problem right away
    loadProblem(Problems.PRESETS.slide2());
})();
