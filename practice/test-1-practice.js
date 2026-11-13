// Test 1 Practice: five problem sections on one page, the R-V problems, the orbital maneuver
// problems, the rendezvous problems, the time of flight problems, and the propulsion problems,
// with the same two modes, answer form, and walkthrough for all of them.
// Practice mode shows the view from the start and lets the student walk through the steps.
// Test mode shows only the problem and the answer form until the answers are graded.
// Problem types supply the numbers and the worked steps. See rv-coe-problems.js,
// test-1-maneuver-problems.js, test-1-rendezvous-problems.js, and test-1-tof-problems.js.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const Check = window.AnswerCheck;
    const { math, prose } = window.PracticeMath;
    const RvCoe = window.RvCoeProblems;
    const Maneuvers = window.Test1ManeuverProblems;
    const Rendezvous = window.Test1RendezvousProblems;
    const Tof = window.Test1TofProblems;
    const Propulsion = window.Test1PropulsionProblems;

    // The R-V problems keep the satellite at least 1.5 Earth radii from Earth's center, so that
    // the orbit has room in the view.
    const RV_MIN_RADIUS = 9600;

    const MODE_CAPTIONS = {
        practice: 'The view starts with the problem as given, and the walkthrough builds the solution step by step.',
        test: 'Enter your answers and submit. The view and the walkthrough open after grading.'
    };

    // Kepler's and Newton's laws are matched on cards, with no view or walkthrough.
    const LAWS_CAPTIONS = {
        practice: 'Each pair is checked as you make it. A wrong pair lets go, so you can try again.',
        test: 'Pair every card, then submit. Pick a paired card to undo its pair before submitting.'
    };

    // The page has six sections. The first five have their own problems, and the last is the
    // laws matching drill. A link can open any one (#rv, #maneuvers, #rendezvous, #tof,
    // #propulsion, or #laws). The propulsion problems have no 3D view.
    const SECTIONS = ['rv', 'maneuvers', 'rendezvous', 'tof', 'propulsion', 'laws'];
    const state = {
        mode: 'practice',
        section: SECTIONS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'rv',
        maneuverType: 'random',  // In the maneuvers section: one kind of maneuver, or any of them
        rendezvousType: 'random', // In the rendezvous section: coplanar, co-orbital, or either
        tofType: 'random',      // In the time of flight section: find the time, the position, or either
        propulsionType: 'random', // In the propulsion section: one difficulty level, or any level
        problem: null,
        submitted: false,
        blankWarned: false,
        active: -1,             // Index of the open walkthrough step, or -1 for none
        visited: new Set()      // Steps whose results may be shown
    };

    const viz = createViz();
    const laws = window.Test1LawMatching.create({
        names: $('match-names'),
        clues: $('match-clues'),
        score: $('laws-score'),
        submit: $('laws-submit')
    });
    const lawOptions = { deck: 'all', clue: 'statement' };

    /* ------------------------------------------------------------------ */
    /* Problems                                                           */
    /* ------------------------------------------------------------------ */
    // Each problem type is turned into the same form: its text, its answer fields, its steps,
    // which view draws it, and how a typed answer is graded.
    function rvProblem() {
        const p = RvCoe.generate({ minRadius: RV_MIN_RADIUS });
        return {
            view: 'rv',
            title: RvCoe.title,
            prompt: prose(RvCoe.prompt),
            limitsHtml: RvCoe.limitsHtml,
            overviewCaption: RvCoe.overviewCaption,
            fields: RvCoe.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => Check.grade(field.tolerance, text, p.answers[field.key].value)
        };
    }

    function maneuverProblem(type) {
        const p = Maneuvers.generate(type);
        return {
            view: 'maneuver',
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            fields: p.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => Maneuvers.grade(field.tolerance, text, p.answers[field.key].value, field.unitType)
        };
    }

    function rendezvousProblem(type) {
        const p = Rendezvous.generate(type);
        return {
            view: 'rendezvous',
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            fields: p.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => Rendezvous.grade(field.tolerance, text, p.answers[field.key].value, field.unitType)
        };
    }

    function tofProblem(type) {
        const p = Tof.generate(type);
        return {
            view: 'tof',
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            fields: p.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => Tof.grade(field.tolerance, text, p.answers[field.key].value, field.unitType)
        };
    }

    // No view: the page shows only the answer form and the walkthrough.
    function propulsionProblem(type) {
        const p = Propulsion.generate(type);
        return {
            view: null,
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            fields: p.fields,
            statement: p.statement,
            answers: p.answers,
            steps: p.steps,
            source: p,
            grade: (field, text) => Propulsion.grade(field.tolerance, text, p.answers[field.key].value, field.unitType)
        };
    }

    function generate() {
        if (state.section === 'rv') return rvProblem();
        if (state.section === 'propulsion') return propulsionProblem(state.propulsionType);
        if (state.section === 'rendezvous') return rendezvousProblem(state.rendezvousType);
        if (state.section === 'tof') return tofProblem(state.tofType);
        const types = Maneuvers.types;
        const type = state.maneuverType === 'random' ? types[Math.floor(Math.random() * types.length)] : state.maneuverType;
        return maneuverProblem(type);
    }

    /* ------------------------------------------------------------------ */
    /* Answer Form                                                        */
    /* ------------------------------------------------------------------ */
    let answerRows = {};

    function buildAnswerForm() {
        const fields = state.problem.fields;
        $('answers').textContent = '';
        answerRows = {};

        fields.forEach((field, index) => {
            const row = document.createElement('div');
            row.className = 'answer';
            row.dataset.field = field.key;

            const label = document.createElement('label');
            label.htmlFor = `answer-${field.key}`;
            const symbol = document.createElement('span');
            symbol.className = 'sym';
            symbol.innerHTML = math(field.tex);
            const name = document.createElement('span');
            name.innerHTML = prose(field.name);
            label.append(symbol, name);

            const box = document.createElement('div');
            box.className = 'answer-box';
            const input = document.createElement('input');
            input.id = `answer-${field.key}`;
            input.type = 'text';
            // A yes/no answer needs letters; every other answer is a number.
            input.inputMode = field.unitType === 'yesno' ? 'text' : 'decimal';
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
                const next = fields[index + 1];
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
        setScore('');
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
        const problem = state.problem;
        const results = problem.fields.map((field) => ({
            field,
            result: problem.grade(field, answerRows[field.key].input.value)
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
            setMark(field.key, shown, noteFor(result, problem.answers[field.key], isTest));
        });

        const correct = results.filter((item) => item.result === 'right').length;
        setScore(`${correct} of ${results.length} correct`);

        // The view labels computed values only once every field holds an answer.
        const allAttempted = results.every((item) => item.result === 'right' || item.result === 'wrong');
        if (isTest || allAttempted) viz.showAnswers();

        if (isTest) {
            state.submitted = true;
            problem.fields.forEach((field) => { answerRows[field.key].input.readOnly = true; });
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
            row.resultEl.innerHTML = state.visited.has(index) ? state.problem.steps[index].result : '';
        });
        $('walk-start').hidden = state.active !== -1;
    }

    function goToStep(index) {
        state.active = index;
        if (index >= 0) state.visited.add(index);
        refreshSteps();
        const step = state.problem.steps[index];
        viz.setStage(step ? step.key : 'given', step ? step.caption : state.problem.overviewCaption);
        if (index >= 0) stepRows[index].head.scrollIntoView({ block: 'start' });
    }

    $('walk-start').addEventListener('click', () => goToStep(0));

    /* ------------------------------------------------------------------ */
    /* Modes and Problems                                                 */
    /* ------------------------------------------------------------------ */
    function applyLayout() {
        const onLaws = state.section === 'laws';
        document.body.classList.toggle('laws-only', onLaws);
        document.body.classList.toggle('no-view', !onLaws && Boolean(state.problem) && !state.problem.view);
        $('laws-panel').hidden = !onLaws;
        $('problem-panel').hidden = onLaws;
        $('mode-caption').textContent = (onLaws ? LAWS_CAPTIONS : MODE_CAPTIONS)[state.mode];
        $('new-problem').textContent = onLaws ? 'Shuffle' : 'New Problem';
        if (onLaws) {
            document.body.classList.remove('answers-only');
            $('walk-panel').hidden = true;
            $('new-problem').classList.toggle('primary', laws.isDone());
            return;
        }

        const answersOnly = state.mode === 'test' && !state.submitted;
        document.body.classList.toggle('answers-only', answersOnly);
        $('walk-panel').hidden = answersOnly;
        $('check').hidden = state.submitted;
        $('check').textContent = state.mode === 'test' ? 'Submit Answers' : 'Check Answers';
        $('new-problem').classList.toggle('primary', state.submitted);
    }

    function dealLaws() {
        laws.deal({ mode: state.mode, ...lawOptions });
        applyLayout();
    }

    function newProblem() {
        if (state.section === 'laws') {
            dealLaws();
            return;
        }
        state.problem = generate();
        state.submitted = false;
        state.blankWarned = false;
        state.active = -1;
        state.visited = new Set();

        $('problem-title').textContent = state.problem.title;
        $('problem-prompt').innerHTML = state.problem.prompt;
        $('given').innerHTML = state.problem.statement;
        $('answer-limits').innerHTML = state.problem.limitsHtml;
        buildAnswerForm();
        buildSteps();
        applyLayout();
        viz.setProblem(state.problem);
        viz.setStage('given', state.problem.overviewCaption);
    }

    function showSection() {
        $('topic').hidden = state.section !== 'maneuvers';
        $('rendezvous-topic').hidden = state.section !== 'rendezvous';
        $('tof-topic').hidden = state.section !== 'tof';
        $('propulsion-topic').hidden = state.section !== 'propulsion';
        for (const button of $('section').querySelectorAll('button')) {
            button.setAttribute('aria-pressed', String(button.dataset.value === state.section));
        }
    }

    Kit.bindSegmented($('section'), (section) => {
        state.section = section;
        history.replaceState(null, '', `#${section}`);
        showSection();
        newProblem();
    });

    Kit.bindSegmented($('topic'), (type) => {
        state.maneuverType = type;
        newProblem();
    });

    Kit.bindSegmented($('rendezvous-topic'), (type) => {
        state.rendezvousType = type;
        newProblem();
    });

    Kit.bindSegmented($('tof-topic'), (type) => {
        state.tofType = type;
        newProblem();
    });

    Kit.bindSegmented($('propulsion-topic'), (type) => {
        state.propulsionType = type;
        newProblem();
    });

    Kit.bindSegmented($('mode'), (mode) => {
        state.mode = mode;
        newProblem();
    });

    Kit.bindSegmented($('laws-deck'), (deck) => {
        lawOptions.deck = deck;
        dealLaws();
    });

    Kit.bindSegmented($('laws-clue'), (clue) => {
        lawOptions.clue = clue;
        dealLaws();
    });

    // A pick can finish the drill, which makes Shuffle the next thing to press.
    $('laws-panel').addEventListener('click', () => {
        if (state.section === 'laws') $('new-problem').classList.toggle('primary', laws.isDone());
    });

    $('laws-submit').addEventListener('click', () => laws.submit());

    $('new-problem').addEventListener('click', newProblem);

    /* ------------------------------------------------------------------ */
    /* 3D View                                                            */
    /* ------------------------------------------------------------------ */
    // Each problem type has its own view, with its own canvas and labels. Only the view for the
    // current problem is shown. The answer form and the walkthrough do not depend on either.
    // If the 3D library cannot be loaded, the view reports that, and the rest of the page still works.
    function createViz() {
        const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
        const statusEl = $('status');
        const hud = $('hud');
        const views = {
            rv: { make: () => window.RvCoeScene, canvas: $('scene-rv'), labels: $('labels-rv'), constants: RvCoe.constants, live: null },
            maneuver: { make: () => window.Test1ManeuverScene, canvas: $('scene-maneuver'), labels: $('labels-maneuver'), constants: Maneuvers.constants, live: null },
            rendezvous: { make: () => window.Test1RendezvousScene, canvas: $('scene-rendezvous'), labels: $('labels-rendezvous'), constants: Rendezvous.constants, live: null },
            tof: { make: () => window.Test1TofScene, canvas: $('scene-tof'), labels: $('labels-tof'), constants: Tof.constants, live: null }
        };
        const pending = { view: 'rv', problem: null, stage: 'given', answersShown: false };

        function showStatus(text) {
            statusEl.style.display = 'flex';
            statusEl.textContent = text;
        }

        // A problem with no view (view: null) leaves every canvas hidden.
        function current() {
            const v = views[pending.view];
            return v ? v.live : null;
        }

        function showView(name) {
            for (const [key, v] of Object.entries(views)) {
                v.canvas.hidden = key !== name;
                v.labels.hidden = key !== name;
            }
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
            for (const v of Object.values(views)) {
                v.live = v.make().create(THREE, {
                    view: $('view'),
                    canvas: v.canvas,
                    labels: v.labels,
                    hint: $('view-hint'),
                    reset: $('reset-view'),
                    showStatus
                }, v.constants, { moveSatellite: true });
            }
            if (!Object.values(views).some((v) => v.live)) return;
            statusEl.style.display = 'none';
            const live = current();
            if (!live || !pending.problem) return;
            live.setProblem(pending.problem.source);
            if (live.setAnswersShown) live.setAnswersShown(pending.answersShown);
            live.setStage(pending.stage);
        })();

        return {
            setProblem(problem) {
                pending.view = problem.view;
                pending.problem = problem;
                pending.answersShown = false;
                showView(problem.view);
                const live = current();
                if (live) live.setProblem(problem.source);
            },
            setStage(stage, caption) {
                pending.stage = stage;
                hud.innerHTML = caption;
                const live = current();
                if (live) live.setStage(stage);
            },
            showAnswers() {
                pending.answersShown = true;
                const live = current();
                if (live && live.setAnswersShown) live.setAnswersShown(true);
            },
            resize() {
                const live = current();
                if (live) live.resize();
            }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Start                                                              */
    /* ------------------------------------------------------------------ */
    $('mode-caption').textContent = MODE_CAPTIONS[state.mode];
    showSection();
    newProblem();
})();
