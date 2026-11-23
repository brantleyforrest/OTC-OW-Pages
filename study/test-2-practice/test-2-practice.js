// Test 2 Practice: the page controller, modeled on test-1-practice.js. A section is one entry in
// SECTIONS plus one problem module (window.Test2<Name>Problems with generate(type) and grade).
// A section that is not built yet is simply not in the list, so it never shows in the selector.
// Each section is one kind of homework problem: generate makes a new one, grade checks an answer.
// Practice mode shows the view and the walkthrough; marks say only right or wrong.
// Test mode shows only the problem and the answer form until the answers are graded.
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const { math, prose } = window.PracticeMath;
    const V = window.RpoViews;

    // The dev version (?dev, opened from the index while dev mode is on) shows every built
    // section; the public page shows only the ones published in test-2-release.js.
    const DEV = new URLSearchParams(location.search).has('dev');
    const PUBLISHED = (window.Test2Release && window.Test2Release.published) || [];
    document.documentElement.classList.toggle('dev-version', DEV);

    // The Test 2 topics, in the order taught. types: the topic buttons, the first one the default
    // (a section with one kind of problem shows no topic buttons).
    const Rmoe = window.Test2RmoeProblems;
    const SECTIONS = [
        { key: 'coeric', label: 'COE to RIC Signs', module: window.Test2CoericProblems,
          types: [['random', 'Random'], ['in-plane', 'In-Plane'], ['cross', 'Cross-Track'], ['both', 'Both']] },
        { key: 'vis-state', label: 'Visualize from $\\bar\\rho,\\ \\dot{\\bar\\rho}$', module: window.Test2VisStateProblems,
          types: [['random', 'Random'], ['in-plane', 'In-Plane'], ['cross', 'With Cross-Track']] },
        { key: 'vis-rmoe', label: 'Visualize from RMOEs', module: window.Test2VisRmoeProblems,
          types: [['random', 'Random'], ['in-plane', 'In-Plane'], ['cross', 'With Cross-Track']] },
        { key: 'rmoe', label: '$\\bar\\rho,\\ \\dot{\\bar\\rho}$ to RMOEs', module: Rmoe && { generate: () => Rmoe.generate('forward'), grade: Rmoe.grade },
          types: [['forward', 'State to RMOEs']] },
        { key: 'state', label: 'RMOEs to $\\bar\\rho,\\ \\dot{\\bar\\rho}$', module: Rmoe && { generate: () => Rmoe.generate('reverse'), grade: Rmoe.grade },
          types: [['reverse', 'RMOEs to State']] },
        { key: 'burns', label: 'Burn Trajectories', module: window.Test2BurnsProblems,
          types: [['random', 'Random'], ['+R', '+R'], ['-R', '−R'], ['+I', '+I'], ['-I', '−I']] },
        // Extra practice beyond the six test topics, kept at the end of the list.
        { key: 'vis-coe', label: 'Visualize from COEs', extra: true, module: window.Test2VisCoeProblems,
          types: [['random', 'Random'], ['in-plane', 'In-Plane'], ['cross', 'Cross-Track'], ['both', 'Both']] },
        { key: 'later', label: 'RMOE Propagation', extra: true, module: Rmoe && { generate: () => Rmoe.generate('later'), grade: Rmoe.grade },
          types: [['later', 'RMOE Propagation']] }
    ].filter(s => s.module && (DEV || PUBLISHED.includes(s.key)));
    const byKey = Object.fromEntries(SECTIONS.map(s => [s.key, s]));

    // Nothing is published yet and this is not the dev version: say so instead of a problem.
    if (!SECTIONS.length) {
        document.querySelector('.tool-stage-col').style.display = 'none';
        document.querySelector('.mode-row').closest('.panel').style.display = 'none';
        ['given', 'answer-form', 'answer-limits', 'walk-panel']
            .forEach((id) => { $(id).style.display = 'none'; });
        $('problem-title').textContent = 'Coming soon';
        $('problem-prompt').textContent = 'The Test 2 sections are still being built. Check back as the topics are taught.';
        return;
    }


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

    /* ------------------------------------------------------------------ */
    /* Problems                                                           */
    /* ------------------------------------------------------------------ */
    function generate() {
        const section = byKey[state.section];
        const p = section.module.generate(state.types[state.section]);
        return {
            view: p.model && p.model.kind ? 'scene' : null,
            viewIsGiven: Boolean(p.viewIsGiven),
            title: p.title,
            prompt: p.prompt,
            limitsHtml: p.limitsHtml,
            overviewCaption: p.overviewCaption,
            gridHeads: p.gridHeads || null,
            // selfCheck: nothing to grade; the student draws on paper, then shows the answer.
            selfCheck: Boolean(p.selfCheck),
            revealHtml: p.revealHtml || '',
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
    const PICK_TYPES = ['choice', 'sign'];

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
        // A sign grid: the fields fill the two columns row by row, under these column heads (TeX).
        const heads = state.problem.gridHeads;
        box.classList.toggle('sign-grid', Boolean(heads));
        (heads || []).forEach((text) => {
            const head = document.createElement('div');
            head.className = 'grid-head';
            head.innerHTML = math(text);
            box.appendChild(head);
        });
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
        // allowUndefined: an "undefined" box beside the field. Checked, the answer is the word
        // 'undefined', which is right only when the true value is undefined (null).
        let undef = null;
        if (field.allowUndefined) {
            const tick = document.createElement('label');
            tick.className = 'answer-undef';
            undef = document.createElement('input');
            undef.type = 'checkbox';
            tick.append(undef, document.createTextNode('undefined'));
            box.appendChild(tick);
            undef.addEventListener('change', () => {
                input.disabled = undef.checked;
                clearMarkOnChange(field);
            });
        }
        const noteEl = document.createElement('div');
        noteEl.className = 'answer-note';
        row.append(labelFor(field, input.id), box, noteEl);
        $('answers').appendChild(row);
        answerRows[field.key] = { row, input, undef, noteEl, kind: 'text' };
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

    // Radio buttons: words ('choice') or a sign ('sign').
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
            const text = document.createElement('span');
            text.innerHTML = prose(option.html);
            label.appendChild(text);
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

    // What the student gave: the text typed, '1' for a checked box, or the picked option's value
    function answerText(field) {
        const r = answerRows[field.key];
        if (r.kind === 'check') return r.input.checked ? '1' : '';
        if (r.kind === 'pick') { const on = r.inputs.find((i) => i.checked); return on ? on.value : ''; }
        if (r.undef && r.undef.checked) return 'undefined';
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
        $('score').classList.remove('reveal');
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

    // A sketch-and-check problem: show the answer (the motion in the view, its name, and the
    // walkthrough) so the student can check the drawing.
    function revealAnswer() {
        state.submitted = true;
        $('score').innerHTML = state.problem.revealHtml;
        $('score').classList.remove('warn');
        $('score').classList.add('reveal');
        viz.showAnswers();
        state.problem.steps.forEach((step, index) => state.visited.add(index));
        applyLayout();
        refreshSteps();
        viz.resize();
    }

    function gradeAnswers() {
        const isTest = state.mode === 'test';
        const problem = state.problem;
        if (problem.selfCheck) { revealAnswer(); return; }
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
                else { r.input.readOnly = true; if (r.undef) r.undef.disabled = true; }
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
        document.body.classList.toggle('no-view', Boolean(state.problem) && !state.problem.view);
        const ungraded = state.mode === 'test' && !state.submitted;
        const answersOnly = ungraded && !state.problem.viewIsGiven;
        document.body.classList.toggle('answers-only', answersOnly);
        $('walk-panel').hidden = ungraded;
        $('check').hidden = state.submitted;
        $('check').textContent = state.problem.selfCheck ? 'Show the Answer' : state.mode === 'test' ? 'Submit Answers' : 'Check Answers';
        $('new-problem').classList.toggle('primary', state.submitted);
    }

    function newProblem() {
        state.problem = generate();
        state.submitted = false;
        state.blankWarned = false;
        state.active = -1;
        state.visited = new Set();
        $('problem-title').innerHTML = prose(state.problem.title);   // titles and labels may hold TeX
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
            // extra: a kind of problem beyond the six test topics, tagged on its button.
            b.innerHTML = prose(s.label) + (s.extra ? '<span class="extra-tag">Extra</span>' : '');
            if (s.extra) b.classList.add('extra');
            const notes = [];
            if (s.extra) notes.push('Extra practice beyond the six test topics');
            if (!PUBLISHED.includes(s.key)) {
                b.classList.add('unpublished');
                notes.push('Not published: shows only in the dev version');
            }
            if (notes.length) b.title = notes.join('. ');
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
        group.hidden = section.types.length < 2;
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

    $('new-problem').addEventListener('click', newProblem);

    /* ------------------------------------------------------------------ */
    /* View                                                               */
    /* ------------------------------------------------------------------ */
    // The scene is made once the 3D library has loaded (or failed to load); until then the
    // latest problem and step wait in `pending`. The flat drawings and RIC panes work without it.
    function createViz() {
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
            try { THREE = await Vendor.three(); } catch (err) { THREE = null; }
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
