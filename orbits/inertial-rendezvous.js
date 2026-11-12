// orbits/inertial-rendezvous.js
// Controller, UI bindings, equations rendering, trade panel, and state management
// for the Inertial Rendezvous tool.
// Note: Noncoplanar and Gauss modes were removed per user instruction as they are not useful for this project.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const RM = window.RendezvousMath;
    const MathRenderer = window.PracticeMath || { math: (s) => s, column: (p) => p.join(', ') };
    const math = (tex) => MathRenderer.math(tex);

    const statusEl = $('status');
    function showStatus(text) {
        if (!statusEl) return;
        statusEl.style.display = 'flex';
        statusEl.textContent = text;
    }

    let THREE;
    try {
        THREE = await import(THREE_URL);
    } catch (err) {
        showStatus('The 3D library could not be loaded. Sliders, values, and equations remain functional.');
    }

    const MU = (RM && RM.constants && RM.constants.MU) || 398600.4418;
    const R_EARTH = (RM && RM.constants && RM.constants.R_EARTH) || 6378.137;
    const MIN_ALT = (RM && RM.constants && RM.constants.MIN_ALT) || 100;
    const R2D = 180 / Math.PI;

    // The lesson's worked examples use these rounded constants
    const LESSON_MU = 398600.44;
    const LESSON_R_EARTH = 6378.0;

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */
    const MINUS = '−';
    const group = (v, d = 0) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const fmtKm = (v) => `${group(v)} km`;
    const fmtKms = (v) => `${Number(v).toFixed(3)} km/s`;
    const fmtMs = (v) => `${group(Math.abs(v) * 1000)} m/s`;
    const fmtDeg = (v) => `${Number(v).toFixed(1)}°`;
    const signText = (v) => (v < 0 ? MINUS : '+');

    // TeX versions: {,} keeps KaTeX from spacing the thousands comma
    const texNum = (v, d = 0) => group(v, d).replace(/,/g, '{,}');
    const texSigned = (v, d = 3) => `${v < 0 ? '-' : '+'}${texNum(Math.abs(v), d)}`;
    const sci = (v, d = 5) => {
        const [mant, exp] = Number(v).toExponential(d).split('e');
        return `${mant} \\times 10^{${Number(exp)}}`;
    };
    const kmTex = (v) => `${texNum(v)}\\text{ km}`;
    const kmsTex = (v) => `${Number(v).toFixed(3)}\\text{ km/s}`;
    const degTex = (v, d = 2) => `${Number(v).toFixed(d)}^\\circ`;
    const radTex = (v) => `${Number(v).toFixed(4)}\\text{ rad}`;
    const secTex = (v) => `${texNum(v, 1)}\\text{ s}`;
    const MU_TEX = '398{,}600.44';

    function formatHms(seconds) {
        if (!Number.isFinite(seconds)) return '∞';
        return RM.formatHms(seconds);
    }
    const hmsTex = (v) => `\\text{${formatHms(v)}}`;

    const speedHtml = (kms) => `<b>${fmtKms(kms)}</b> <span class="unit-sub">(${fmtMs(kms)})</span>`;
    const signedSpeedHtml = (kms) => `<b>${signText(kms)}${fmtKms(Math.abs(kms))}</b> <span class="unit-sub">(${signText(kms)}${fmtMs(kms)})</span>`;

    function phaseAngleHint(deg) {
        const d = ((deg % 360) + 360) % 360;
        if (d === 0) return 'together';
        if (d <= 180) return 'chase ahead of target';
        return 'chase behind target';
    }

    /* ------------------------------------------------------------------ */
    /* State Configuration & Defaults                                     */
    /* ------------------------------------------------------------------ */
    // Note: Noncoplanar and Gauss modes were removed per user instruction as they are not useful for this project.
    const DEFAULTS = {
        coplanar: { Rchase: 9600, Rtarget: 24000, phi0: 240 },
        coorbital: { Rchase: 20000, phi0: 315, k: 1 }
    };

    const LESSON_EXAMPLES = {
        coplanar: { values: { Rchase: 6900, Rtarget: 7000, phi0: 180 }, name: 'Lesson Example 1' },
        coorbital: { values: { Rchase: 7000, phi0: 20, k: 1 }, name: 'Lesson Practice Problem' }
    };

    const state = {
        mode: 'coplanar',
        values: JSON.parse(JSON.stringify(DEFAULTS)),
        lessonExample: { coplanar: false, coorbital: false },
        step: 0,
        anim: null,
        speedIndex: 1,
        speeds: [{ rate: 0.5, label: 'Slow' }, { rate: 1, label: 'Normal' }, { rate: 2, label: 'Fast' }],
        timeline: 0,
        activePhase: '',
        shown: {
            vectors: true,
            angles: true,
            labels: true
        }
    };

    // Color tokens (match the 3D view)
    const C_O1 = '#e0b64f';
    const C_O2 = '#34d399';
    const C_TX = '#ff8a3d';
    const C_PH = '#a3e635';
    const C_DV = '#f87171';
    const C_TH = '#38bdf8';
    const C_TM = '#c4a1ff';
    const col = (c, tex) => `\\textcolor{${c}}{${tex}}`;

    // Symbols used in cards, HUD, and notes
    const S = {
        nC: col(C_O1, 'n_{\\text{chase}}'),
        nT: col(C_O2, 'n_{\\text{target}}'),
        RC: col(C_O1, 'R_{\\text{chase}}'),
        RT: col(C_O2, 'R_{\\text{target}}'),
        aTx: col(C_TX, 'a_{\\text{transfer}}'),
        TOF: col(C_TM, '\\text{TOF}'),
        nu: col(C_TM, '\\nu_{\\text{travel}}'),
        phiD: col(C_TH, '\\phi_{\\text{desired}}'),
        phi0: col(C_TH, '\\phi_0'),
        phi: col(C_TH, '\\phi'),
        WT: col(C_TH, '\\text{WT}'),
        Tsyn: col(C_TH, 'T_{\\text{syn}}'),
        dV1: col(C_DV, '\\Delta V_1'),
        dV2: col(C_DV, '\\Delta V_2'),
        dVt: col(C_DV, '\\Delta V_{\\text{total}}'),
        Pph: col(C_PH, '\\text{Period}_{\\text{phasing}}'),
        aPh: col(C_PH, 'a_{\\text{phasing}}'),
        VPh: col(C_PH, 'V_{\\text{phasing}}'),
        VC: col(C_O1, 'V_{\\text{chase}}'),
        VT: col(C_O2, 'V_{\\text{target}}'),
        Vtx1: col(C_TX, 'V_{\\text{transfer},1}'),
        Vtx2: col(C_TX, 'V_{\\text{transfer},2}')
    };

    /* ------------------------------------------------------------------ */
    /* Solvers Integration                                                */
    /* ------------------------------------------------------------------ */
    function solveCurrent() {
        const mode = state.mode;
        const vals = state.values[mode] || state.values.coplanar;
        const isEx = state.lessonExample[mode];
        const mu = isEx ? LESSON_MU : MU;
        const rEarth = isEx ? LESSON_R_EARTH : R_EARTH;

        let model = null;
        if (mode === 'coplanar') model = RM.solveCoplanar({ ...vals, mu, rEarth });
        if (mode === 'coorbital') model = RM.solveCoOrbital({ ...vals, mu, rEarth });
        if (model) model.lessonExample = isEx ? LESSON_EXAMPLES[mode].name : '';
        return model;
    }

    const isSameOrbit = (m) => m.mode === 'coplanar' && m.status.warnings.includes('same-orbit');

    /* ------------------------------------------------------------------ */
    /* UI Elements                                                        */
    /* ------------------------------------------------------------------ */
    const viewEl = $('view');
    const sceneCanvas = $('scene');
    const resetViewBtn = $('reset-view');
    const missionClockEl = $('mission-clock');
    const hudEl = $('hud');
    const modeButtons = document.querySelectorAll('#rendezvous-mode button');
    const btnLessonExample = $('btn-lesson-example');
    const btnResetValues = $('btn-reset-values');

    const btnBack = $('btn-back');
    const btnNext = $('btn-next');
    const btnRewind = $('btn-rewind');
    const timelineSlider = $('timeline-slider');
    const timelineValueEl = $('timeline-value');
    const speedSlider = $('speed');
    const speedValueEl = $('speed-value');

    const slidersContainer = $('sliders-container');
    const checkVectors = $('check-vectors');
    const checkAngles = $('check-angles');
    const checkLabels = $('check-labels');

    const equationCardsEl = $('equation-cards');
    const liveValuesGrid = $('live-values-grid');
    const constraintChipsEl = $('constraint-chips');
    const tradeContentEl = $('trade-content');
    const whatToNoticeText = $('what-to-notice-text');

    /* ------------------------------------------------------------------ */
    /* 3D Scene Initialization                                            */
    /* ------------------------------------------------------------------ */
    let sceneController = null;
    if (THREE && window.RendezvousScene) {
        sceneController = window.RendezvousScene.create(THREE, {
            view: viewEl,
            canvas: sceneCanvas,
            hint: $('view-hint'),
            reset: resetViewBtn,
            labels: $('labels'),
            showStatus
        }, { R_EARTH, MU });
    }

    /* ------------------------------------------------------------------ */
    /* Sliders Building                                                   */
    /* ------------------------------------------------------------------ */
    function phaseValueHtml(deg) {
        return `${fmtDeg(deg)} <span class="control-hint">(${phaseAngleHint(deg)})</span>`;
    }

    function updateLessonButton() {
        if (!btnLessonExample) return;
        const on = Boolean(state.lessonExample[state.mode]);
        btnLessonExample.setAttribute('aria-pressed', on ? 'true' : 'false');
        btnLessonExample.title = `Load the lesson's ${state.mode === 'coplanar' ? 'Example 1 (coplanar)' : 'Practice Problem (co-orbital)'}`;
    }

    // Any slider move leaves the lesson example (and its rounded constants)
    function leaveLessonExample() {
        if (!state.lessonExample[state.mode]) return;
        state.lessonExample[state.mode] = false;
        updateLessonButton();
    }

    function bindSlider(id, valueId, apply, format) {
        const input = $(id);
        input.addEventListener('input', (e) => {
            const v = Number(e.target.value);
            apply(v);
            $(valueId).innerHTML = format(v);
            leaveLessonExample();
            scheduleUpdate();
        });
    }

    function buildSlidersHtml() {
        const mode = state.mode;
        const vals = state.values[mode] || state.values.coplanar;
        updateLessonButton();

        if (mode === 'coplanar') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r-chase">Chase orbit radius (R<sub>chase</sub>)</label>
                            <span class="control-value" id="val-r-chase">${fmtKm(vals.Rchase)}</span>
                        </div>
                        <input type="range" id="sl-r-chase" min="6700" max="45000" step="100" value="${vals.Rchase}">
                        <span class="earth-radius-hint">Earth surface: 6,378 km</span>
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r-target">Target orbit radius (R<sub>target</sub>)</label>
                            <span class="control-value" id="val-r-target">${fmtKm(vals.Rtarget)}</span>
                        </div>
                        <input type="range" id="sl-r-target" min="6700" max="45000" step="100" value="${vals.Rtarget}">
                        <div class="slider-presets">
                            <button type="button" class="btn-preset-pill" id="btn-pre-leo-geo">Preset: LEO to GEO</button>
                            <button type="button" class="btn-preset-pill" id="btn-pre-lower">Preset: Lowering</button>
                        </div>
                    </div>
                    <div class="slider-field slider-wide">
                        <div class="control-label">
                            <label for="sl-phi0">Initial phase angle (φ<sub>0</sub>)</label>
                            <span class="control-value" id="val-phi0">${phaseValueHtml(vals.phi0)}</span>
                        </div>
                        <input type="range" id="sl-phi0" min="0" max="359" step="1" value="${vals.phi0}">
                    </div>
                </div>
            `;

            bindSlider('sl-r-chase', 'val-r-chase', (v) => { vals.Rchase = v; }, fmtKm);
            bindSlider('sl-r-target', 'val-r-target', (v) => { vals.Rtarget = v; }, fmtKm);
            bindSlider('sl-phi0', 'val-phi0', (v) => { vals.phi0 = v; }, phaseValueHtml);

            const preset = (rc, rt, phi0) => {
                Object.assign(vals, { Rchase: rc, Rtarget: rt, phi0 });
                state.lessonExample.coplanar = false;
                buildSlidersHtml();
                updateAll();
                goToStep(0);
            };
            $('btn-pre-leo-geo').addEventListener('click', () => preset(6700, 42200, 0));
            $('btn-pre-lower').addEventListener('click', () => preset(24000, 9600, 60));

        } else if (mode === 'coorbital') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-co-r">Orbit radius, both craft (R)</label>
                            <span class="control-value" id="val-co-r">${fmtKm(vals.Rchase)}</span>
                        </div>
                        <input type="range" id="sl-co-r" min="6700" max="45000" step="100" value="${vals.Rchase}">
                        <span class="earth-radius-hint">R<sub>chase</sub> = R<sub>target</sub>. Earth surface: 6,378 km</span>
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-co-k">Phasing orbits (k)</label>
                            <span class="control-value" id="val-co-k">${vals.k}</span>
                        </div>
                        <input type="range" id="sl-co-k" min="1" max="5" step="1" value="${vals.k}">
                    </div>
                    <div class="slider-field slider-wide">
                        <div class="control-label">
                            <label for="sl-co-phi0">Initial phase angle (φ<sub>0</sub>)</label>
                            <span class="control-value" id="val-co-phi0">${phaseValueHtml(vals.phi0)}</span>
                        </div>
                        <input type="range" id="sl-co-phi0" min="0" max="359" step="1" value="${vals.phi0}">
                    </div>
                </div>
            `;

            bindSlider('sl-co-r', 'val-co-r', (v) => { vals.Rchase = v; }, fmtKm);
            bindSlider('sl-co-k', 'val-co-k', (v) => { vals.k = v; }, String);
            bindSlider('sl-co-phi0', 'val-co-phi0', (v) => { vals.phi0 = v; }, phaseValueHtml);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Equations & Timeline Synchronization                               */
    /* ------------------------------------------------------------------ */
    // Each card jumps the timeline to the part of the rendezvous it describes
    const CARD_PART = {
        coplanar: {
            mean_motions: 'wait', synodic: 'wait', desired_phase: 'wait', wait_time: 'wait',
            transfer_orbit: 'transfer', tof: 'transfer', travel_angle: 'transfer',
            burns: 'burn1', total_time: 'together'
        },
        coorbital: {
            target_motion: 'phasing', nu_travel: 'phasing', phasing_period: 'phasing', tof: 'phasing',
            orbit_sizing: 'phasing', velocities: 'burn1', delta_v: 'burn1', perigee_check: 'phasing'
        }
    };

    // The card highlighted for each part of the timeline
    const PART_CARD = {
        coplanar: { wait: 'wait_time', burn1: 'burns', transfer: 'travel_angle', burn2: 'burns', together: 'total_time' },
        coorbital: { burn1: 'delta_v', phasing: 'phasing_period', burn2: 'delta_v', together: 'tof' }
    };

    function timeForCard(m, cardKey) {
        const part = (CARD_PART[m.mode] || {})[cardKey];
        const list = window.RendezvousScene ? window.RendezvousScene.segments(m) : [];
        const seg = list.find((x) => x.key === part) || list[0];
        if (!seg) return 0;
        return seg.key.startsWith('burn') ? seg.to - 1e-4 : seg.from + (seg.to - seg.from) * 0.5;
    }

    function card(model, key, title, lines, note = '') {
        const body = lines.map(([kind, tex]) => `<div class="eq-${kind}">${math(tex)}</div>`).join('');
        return `
            <div class="equation-card ${state.activePhase === key ? 'active' : ''}" data-key="${key}" data-target-t="${timeForCard(model, key)}">
                <div class="eq-title">${title}</div>
                ${body}
                ${note ? `<div class="eq-note">${note}</div>` : ''}
            </div>
        `;
    }

    function coplanarCards(m) {
        const { Rchase, Rtarget, n_chase, n_target, omega_drift, a_transfer, TOF, nu_travel, nu_travel_deg, phi_desired, phi_desired_deg, WT, k_val, TOF_total, dv1, dv2, dv_total, T_syn, V_chase, V_target, V_tx1, V_tx2 } = m;
        let html = '';

        html += card(m, 'mean_motions', 'Mean Motions', [
            ['sym', `${S.nC} = \\sqrt{\\frac{\\mu}{${S.RC}^3}} = \\sqrt{\\frac{${MU_TEX}}{${col(C_O1, texNum(Rchase))}^3}}`],
            ['res', `= ${col(C_O1, `${sci(n_chase)}\\text{ rad/s}`)} \\; (${(n_chase * R2D).toFixed(6)}^\\circ\\text{/s})`],
            ['sym', `${S.nT} = \\sqrt{\\frac{\\mu}{${S.RT}^3}} = \\sqrt{\\frac{${MU_TEX}}{${col(C_O2, texNum(Rtarget))}^3}}`],
            ['res', `= ${col(C_O2, `${sci(n_target)}\\text{ rad/s}`)} \\; (${(n_target * R2D).toFixed(6)}^\\circ\\text{/s})`]
        ]);

        html += card(m, 'synodic', 'Synodic Period', [
            ['sym', `${S.Tsyn} = \\frac{2\\pi}{|${S.nC} - ${S.nT}|}`],
            ['num', `= \\frac{2\\pi}{|${sci(n_chase)} - ${sci(n_target)}|\\text{ rad/s}}`],
            ['res', `= ${col(C_TH, secTex(T_syn))} \\; (${hmsTex(T_syn)})`]
        ], 'The time between rendezvous opportunities.');

        html += card(m, 'transfer_orbit', 'Transfer Orbit', [
            ['sym', `${S.aTx} = \\frac{${S.RC} + ${S.RT}}{2}`],
            ['num', `= \\frac{${col(C_O1, texNum(Rchase))} + ${col(C_O2, texNum(Rtarget))}}{2}`],
            ['res', `= ${col(C_TX, kmTex(a_transfer))}`]
        ]);

        html += card(m, 'tof', 'Time of Flight', [
            ['sym', `${S.TOF} = \\pi\\sqrt{\\frac{${S.aTx}^3}{\\mu}}`],
            ['num', `= \\pi\\sqrt{\\frac{${col(C_TX, texNum(a_transfer))}^3}{${MU_TEX}}}`],
            ['res', `= ${col(C_TM, secTex(TOF))} \\; (${hmsTex(TOF)})`]
        ]);

        html += card(m, 'travel_angle', 'Target Angular Travel', [
            ['sym', `${S.nu} = ${S.nT} \\cdot ${S.TOF}`],
            ['num', `= (${sci(n_target)}\\text{ rad/s})(${secTex(TOF)})`],
            ['res', `= ${col(C_TM, radTex(nu_travel))} \\; (${degTex(nu_travel_deg)})`]
        ], 'How far the target moves while the chase flies the transfer.');

        const rawPhiD = nu_travel_deg - 180;
        const wraps = Math.round((phi_desired_deg - rawPhiD) / 360);
        const wrapTex = wraps === 0 ? '' : ` ${wraps > 0 ? '+' : '-'} ${Math.abs(wraps) === 1 ? '' : Math.abs(wraps)}360^\\circ`;
        const leadDeg = 360 - phi_desired_deg;
        html += card(m, 'desired_phase', 'Desired Phase Angle', [
            ['sym', `${S.phiD} = ${S.nu} - 180^\\circ`],
            ['num', `= ${degTex(nu_travel_deg)} - 180^\\circ${wrapTex ? ` = ${degTex(rawPhiD)}${wrapTex}` : ''}`],
            ['res', `= ${col(C_TH, degTex(phi_desired_deg))} \\; (${radTex(phi_desired)})`]
        ], `The phase angle the chase needs at the departure burn. Lead angle (chase to target) = 180° ${MINUS} ν<sub>travel</sub> = ${(leadDeg >= 360 ? 0 : leadDeg).toFixed(2)}°.`);

        const lapTex = k_val === 0 ? '' : ` ${k_val > 0 ? '+' : '-'} ${Math.abs(k_val) === 1 ? '' : Math.abs(k_val)}(2\\pi)`;
        const kNote = k_val === 0
            ? 'First opportunity (k = 0).'
            : `First opportunity: k = ${Math.abs(k_val)}, so ${Math.abs(k_val) === 1 ? 'one 360° lap is' : `${Math.abs(k_val)} laps are`} ${k_val > 0 ? 'added' : 'subtracted'} to keep WT positive.`;
        html += card(m, 'wait_time', 'Wait Time', [
            ['sym', `${S.WT} = \\frac{${S.phiD} - ${S.phi0} \\pm k(2\\pi)}{${S.nC} - ${S.nT}}`],
            ['num', `= \\frac{${phi_desired.toFixed(4)} - ${(m.phi0_rad).toFixed(4)}${lapTex}}{${sci(omega_drift)}\\text{ rad/s}}`],
            ['res', `= ${col(C_TH, secTex(WT))} \\; (${hmsTex(WT)})`]
        ], `${kNote} Angles in radians, rates in rad/s.`);

        html += card(m, 'total_time', 'Total Mission Time', [
            ['sym', `\\text{TOF}_{\\text{total}} = ${S.WT} + ${S.TOF}`],
            ['num', `= ${secTex(WT)} + ${secTex(TOF)}`],
            ['res', `= ${secTex(TOF_total)} \\; (${hmsTex(TOF_total)})`]
        ]);

        const dir = (v) => (v >= 0 ? 'posigrade' : 'retrograde');
        html += card(m, 'burns', 'Transfer Burns (Hohmann)', [
            ['sym', `${S.dV1} = ${S.Vtx1} - ${S.VC}`],
            ['num', `= ${col(C_TX, V_tx1.toFixed(3))} - ${col(C_O1, V_chase.toFixed(3))}`],
            ['res', `= ${col(C_DV, `${texSigned(dv1)}\\text{ km/s}`)} \\; (\\text{${dir(dv1)}})`],
            ['sym', `${S.dV2} = ${S.VT} - ${S.Vtx2}`],
            ['num', `= ${col(C_O2, V_target.toFixed(3))} - ${col(C_TX, V_tx2.toFixed(3))}`],
            ['res', `= ${col(C_DV, `${texSigned(dv2)}\\text{ km/s}`)} \\; (\\text{${dir(dv2)}})`],
            ['res', `${S.dVt} = |${S.dV1}| + |${S.dV2}| = ${col(C_DV, kmsTex(dv_total))}`]
        ], 'From the Orbital Maneuvers lesson. Waiting changes when the burns happen, not their size.');

        return html;
    }

    function coorbitalCards(m) {
        const { Rchase, n_target, T_target, nu_travel, nu_travel_deg, phi_eff_deg, Period_phasing, TOF_rendezvous, a_phasing, V_chase, V_phasing, dv1, dv_total, r_p, r_a, h_p, isBehind, k } = m;
        const rEarth = m.constants.R_EARTH;
        let html = '';

        if (m.phi0 === 0) {
            return card(m, 'target_motion', 'No Phasing Needed', [
                ['sym', `${S.phi0} = 0^\\circ`]
            ], 'The chase and target are already together.');
        }

        html += card(m, 'target_motion', 'Target Mean Motion', [
            ['sym', `${S.nT} = \\sqrt{\\frac{\\mu}{R^3}} = \\sqrt{\\frac{${MU_TEX}}{${texNum(Rchase)}^3}}`],
            ['res', `= ${col(C_O2, `${sci(n_target)}\\text{ rad/s}`)} \\; (${(n_target * R2D).toFixed(6)}^\\circ\\text{/s})`],
            ['sym', `\\text{Period}_{\\text{target}} = \\frac{2\\pi}{${S.nT}} = ${col(C_O2, secTex(T_target))}`]
        ]);

        const ruleNote = isBehind
            ? `Rule of Thumb: φ<sub>0</sub> = ${m.phi0}° is over 180°, so use the negative angle, ${MINUS}${360 - m.phi0}°. The chase is behind.`
            : `The chase is ahead (φ<sub>0</sub> ≤ 180°), so the target travels more than one full lap.`;
        html += card(m, 'nu_travel', 'Target Angular Travel (per phasing orbit)', [
            ['sym', `${S.nu} = 360^\\circ + \\frac{${S.phi0}}{k}`],
            ['num', `= 360^\\circ + \\frac{${phi_eff_deg < 0 ? '-' : ''}${Math.abs(phi_eff_deg).toFixed(0)}^\\circ}{${k}}`],
            ['res', `= ${col(C_TM, degTex(nu_travel_deg))} \\; (${radTex(nu_travel)})`]
        ], ruleNote);

        html += card(m, 'phasing_period', 'Phasing Period', [
            ['sym', `${S.Pph} = \\frac{${S.nu}}{${S.nT}}`],
            ['num', `= \\frac{${radTex(nu_travel)}}{${sci(n_target)}\\text{ rad/s}}`],
            ['res', `= ${col(C_PH, secTex(Period_phasing))} \\; (${hmsTex(Period_phasing)})`]
        ], 'Angles in radians, rates in rad/s.');

        html += card(m, 'tof', 'Time of Flight', [
            ['sym', `\\text{TOF}_{\\text{rendezvous}} = k \\cdot ${S.Pph}`],
            ['num', `= (${k})(${secTex(Period_phasing)})`],
            ['res', `= ${secTex(TOF_rendezvous)} \\; (${hmsTex(TOF_rendezvous)})`]
        ]);

        html += card(m, 'orbit_sizing', 'Phasing Orbit Size', [
            ['sym', `${S.aPh} = \\sqrt[3]{\\mu\\left(\\frac{${S.Pph}}{2\\pi}\\right)^2}`],
            ['num', `= \\sqrt[3]{${MU_TEX}\\left(\\frac{${texNum(Period_phasing, 1)}}{2\\pi}\\right)^2}`],
            ['res', `= ${col(C_PH, kmTex(a_phasing))}`]
        ]);

        html += card(m, 'velocities', 'Speeds at the Burn Point', [
            ['sym', `${S.VC} = \\sqrt{\\frac{\\mu}{R}} = ${col(C_O1, kmsTex(V_chase))}`],
            ['sym', `${S.VPh} = \\sqrt{\\mu\\left(\\frac{2}{R} - \\frac{1}{${S.aPh}}\\right)}`],
            ['num', `= \\sqrt{${MU_TEX}\\left(\\frac{2}{${texNum(Rchase)}} - \\frac{1}{${texNum(a_phasing)}}\\right)}`],
            ['res', `= ${col(C_PH, kmsTex(V_phasing))}`]
        ]);

        html += card(m, 'delta_v', 'Phasing Delta-V', [
            ['sym', `${S.dV1} = ${S.VPh} - ${S.VC} = -${S.dV2}`],
            ['num', `= ${col(C_PH, V_phasing.toFixed(4))} - ${col(C_O1, V_chase.toFixed(4))}`],
            ['res', `= ${col(C_DV, `${texSigned(dv1 * 1000, 2)}\\text{ m/s}`)} \\; (\\text{${dv1 >= 0 ? 'posigrade' : 'retrograde'}})`],
            ['res', `${S.dVt} = 2|${S.dV1}| = ${col(C_DV, `${texNum(dv_total * 1000, 2)}\\text{ m/s}`)}`]
        ], dv1 >= 0 ? 'Posigrade: climb higher and slower so the target catches up.' : 'Retrograde: drop lower and faster to catch the target.');

        const minR = rEarth + MIN_ALT;
        const fail = r_p <= minR;
        const verdict = r_p <= rEarth ? 'below Earth’s surface' : fail ? `below ${texNum(MIN_ALT)} km altitude` : `above ${texNum(MIN_ALT)} km altitude`;
        html += card(m, 'perigee_check', 'Perigee Check', isBehind ? [
            ['sym', `r_p = 2${S.aPh} - R = 2(${texNum(a_phasing)}) - ${texNum(Rchase)}`],
            ['res', `= ${kmTex(r_p)}`],
            ['sym', `h_p = r_p - R_\\oplus = ${texNum(r_p)} - ${texNum(rEarth)} = ${col(fail ? C_DV : C_O2, kmTex(h_p))}`]
        ] : [
            ['sym', `r_p = R = ${kmTex(r_p)}, \\quad r_a = 2${S.aPh} - R = ${kmTex(r_a)}`],
            ['sym', `h_p = r_p - R_\\oplus = ${col(fail ? C_DV : C_O2, kmTex(h_p))}`]
        ], `<span class="${fail ? 'note-warn' : 'note-ok'}">Perigee is ${verdict.replace(/\{,\}/g, ',')}.</span> Check that perigee radius is not too low!`);

        return html;
    }

    function renderEquations(model) {
        if (!equationCardsEl) return;
        let html = '';
        if (isSameOrbit(model)) {
            html = card(model, 'mean_motions', 'Same Orbit', [
                ['sym', `${S.RC} = ${S.RT} \\;\\Rightarrow\\; ${S.nC} = ${S.nT}`]
            ], 'Equal mean motions never change the phase angle, so there is no synodic period and no wait time. Use Co-orbital mode.');
        } else if (model.mode === 'coplanar') {
            html = coplanarCards(model);
        } else if (model.mode === 'coorbital') {
            html = coorbitalCards(model);
        }
        equationCardsEl.innerHTML = html;
    }

    // Card clicks jump the timeline to the part that card describes (one listener)
    if (equationCardsEl) {
        equationCardsEl.addEventListener('click', (e) => {
            const cardEl = e.target.closest('.equation-card');
            if (!cardEl) return;
            const t = Number(cardEl.dataset.targetT || 0);
            goToStep(stepForTime(t), { at: t });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Live Values & Constraint Chips                                     */
    /* ------------------------------------------------------------------ */
    function renderLiveValues(model) {
        if (!liveValuesGrid || !constraintChipsEl) return;

        let chipsHtml = '';
        let statsHtml = '';
        const stat = (label, valHtml) => `
            <div class="stat-item">
                <div class="stat-label">${label}</div>
                <div class="stat-val">${valHtml}</div>
            </div>
        `;

        if (model.lessonExample) {
            chipsHtml += `<span class="constraint-chip info">${model.lessonExample}: μ = 398,600.44, R⊕ = 6,378 km</span>`;
        }

        if (model.mode === 'coplanar') {
            if (isSameOrbit(model)) {
                chipsHtml += '<span class="constraint-chip warn">Same orbit: use Co-orbital</span>';
                statsHtml += stat('Initial phase angle (φ<sub>0</sub>)', `${fmtDeg(model.phi0)}`);
                statsHtml += stat('Synodic period', 'none (no drift)');
            } else {
                statsHtml += stat('Initial phase angle (φ<sub>0</sub>)', `${fmtDeg(model.phi0)} <span class="unit-sub">(${phaseAngleHint(model.phi0)})</span>`);
                statsHtml += stat('Desired phase angle (φ<sub>desired</sub>)', fmtDeg(model.phi_desired_deg));
                statsHtml += stat('Target travel (ν<sub>travel</sub>)', fmtDeg(model.nu_travel_deg));
                statsHtml += stat('Wait time (WT)', formatHms(model.WT));
                statsHtml += stat('Time of flight (TOF)', formatHms(model.TOF));
                statsHtml += stat('Total mission time', formatHms(model.TOF_total));
                statsHtml += stat('Synodic period (T<sub>syn</sub>)', formatHms(model.T_syn));
                statsHtml += stat('Total ΔV', speedHtml(model.dv_total));
            }
        } else if (model.mode === 'coorbital') {
            const h = Math.round(model.h_p);
            if (model.phi0 === 0) {
                chipsHtml += '<span class="constraint-chip ok">Already together</span>';
            } else if (model.r_p <= model.constants.R_EARTH) {
                chipsHtml += `<span class="constraint-chip warn">Phasing orbit hits Earth (h<sub>p</sub> = ${group(h)} km)</span>`;
            } else if (model.h_p <= MIN_ALT) {
                chipsHtml += `<span class="constraint-chip warn">Perigee below 100 km (${group(h)} km)</span>`;
            } else {
                chipsHtml += '<span class="constraint-chip ok">Perigee above 100 km</span>';
            }

            statsHtml += stat('Chase position', model.phi0 === 0 ? 'with the target' : model.isBehind ? 'behind the target' : 'ahead of the target');
            statsHtml += stat('Target travel (ν<sub>travel</sub>)', `${fmtDeg(model.nu_travel_deg)} <span class="unit-sub">per orbit</span>`);
            statsHtml += stat('Phasing period', formatHms(model.Period_phasing));
            statsHtml += stat('Phasing a', fmtKm(model.a_phasing));
            statsHtml += stat('Perigee altitude (h<sub>p</sub>)', `${group(h)} km`);
            statsHtml += stat('Burn 1 (ΔV<sub>1</sub>)', signedSpeedHtml(model.dv1));
            statsHtml += stat('Total ΔV', speedHtml(model.dv_total));
            statsHtml += stat(`Time of flight (k = ${model.k})`, formatHms(model.TOF_rendezvous));
        }

        constraintChipsEl.innerHTML = chipsHtml;
        constraintChipsEl.hidden = !chipsHtml;
        liveValuesGrid.innerHTML = statsHtml;
    }

    /* ------------------------------------------------------------------ */
    /* Trade Panel Rendering                                              */
    /* ------------------------------------------------------------------ */
    function renderTrade(model) {
        if (!tradeContentEl) return;

        if (model.mode === 'coplanar') {
            if (isSameOrbit(model)) {
                tradeContentEl.innerHTML = '<p class="trade-note">The orbits never drift apart, so a Hohmann rendezvous has no window. Use Co-orbital mode.</p>';
                return;
            }
            const wtPct = (Math.min(1, model.WT / model.T_syn) * 100).toFixed(1);
            const rows = [0, 1, 2].map((i) => `
                <div class="trade-row ${i === 0 ? 'active' : ''}">
                    <span>${['First', 'Second', 'Third'][i]} opportunity${i ? ` (WT + ${i === 1 ? '' : '2'}T<sub>syn</sub>)` : ' (WT)'}</span>
                    <span class="trade-time">${formatHms(model.WT + i * model.T_syn)}</span>
                </div>`).join('');
            tradeContentEl.innerHTML = `
                <div class="trade-caption">Wait within one synodic period (${formatHms(model.T_syn)})</div>
                <div class="trade-bar-track">
                    <div class="trade-bar-fill wait" style="width: ${wtPct}%;"></div>
                    <div class="trade-bar-marker" style="left: ${wtPct}%;"></div>
                </div>
                <div class="trade-bar-scale"><span>0</span><span>WT ${formatHms(model.WT)}</span><span>T<sub>syn</sub></span></div>
                <div class="trade-row-list">${rows}</div>
                <p class="trade-note">Every opportunity costs the same ΔV (${fmtKms(model.dv_total)}). Waiting costs time, not ΔV.</p>
            `;

        } else if (model.mode === 'coorbital') {
            if (model.phi0 === 0) {
                tradeContentEl.innerHTML = '<p class="trade-note">With φ<sub>0</sub> = 0° there is nothing to trade: no burns, no wait.</p>';
                return;
            }
            const sols = [1, 2, 3, 4, 5].map((k) => RM.solveCoOrbital({
                Rchase: model.Rchase,
                phi0: model.phi0,
                k,
                mu: model.constants.MU,
                rEarth: model.constants.R_EARTH
            }));
            const maxDv = Math.max(...sols.map((s) => s.dv_total));
            const rowsHtml = sols.map((s) => {
                const fail = s.h_p <= MIN_ALT;
                return `
                    <button type="button" class="trade-row ${s.k === model.k ? 'active' : ''} ${fail ? 'warn' : ''}" data-k="${s.k}" aria-pressed="${s.k === model.k}">
                        <span class="trade-k">k = ${s.k}</span>
                        <span class="trade-dv">
                            <span class="trade-mini-track"><span class="trade-mini-fill" style="width:${(100 * s.dv_total / maxDv).toFixed(1)}%"></span></span>
                            <span class="trade-dv-val">${group(s.dv_total * 1000)} m/s${fail ? ' <span class="trade-flag">perigee low</span>' : ''}</span>
                        </span>
                        <span class="trade-time">${formatHms(s.TOF_rendezvous)}</span>
                    </button>
                `;
            }).join('');
            tradeContentEl.innerHTML = `
                <div class="trade-head"><span>Orbits</span><span>Total ΔV</span><span>Time of flight</span></div>
                <div class="trade-row-list">${rowsHtml}</div>
                <p class="trade-note">More phasing orbits: less ΔV, more time. Click a row to fly it.</p>
            `;
        }
    }

    if (tradeContentEl) {
        tradeContentEl.addEventListener('click', (e) => {
            const row = e.target.closest('.trade-row[data-k]');
            if (!row || state.mode !== 'coorbital') return;
            state.values.coorbital.k = Number(row.dataset.k);
            buildSlidersHtml();
            updateAll();
        });
    }

    /* ------------------------------------------------------------------ */
    /* What to Notice                                                     */
    /* ------------------------------------------------------------------ */
    function renderWhatToNotice(model) {
        if (!whatToNoticeText) return;
        if (model.mode === 'coplanar') {
            whatToNoticeText.innerHTML = `Timing is crucial. The chase waits until ${math(S.phi)} reaches ${math(S.phiD)}, so both arrive at the same place at the same time. Waiting costs time, not ΔV.`;
        } else if (model.mode === 'coorbital') {
            whatToNoticeText.innerHTML = 'To speed up angularly, you must drop into a lower orbit; to slow down, you must climb higher. More phasing orbits cost less ΔV but take longer.';
        }
    }

    /* ------------------------------------------------------------------ */
    /* HUD and Highlights                                                 */
    /* ------------------------------------------------------------------ */
    let lastHud = '';

    function hudFor(m, p, t) {
        if (isSameOrbit(m)) {
            return `<b>The orbits are the same.</b> Their phase angle never changes, so use Co-orbital. <button type="button" class="btn btn-sm hud-btn" id="btn-switch-coorbital">Switch to Co-orbital</button>`;
        }
        const n = stepList().length;
        if (state.step === 0) {
            const ex = m.lessonExample ? ` <span class="hud-tag">${m.lessonExample}</span>` : '';
            if (m.mode === 'coplanar') {
                return `<b>Overview.</b> Wait ${formatHms(m.WT)} for ${math(S.phi)} to reach ${math(S.phiD)}, then fly a ${formatHms(m.TOF)} Hohmann transfer. ${n} steps: press Next.${ex}`;
            }
            if (m.phi0 === 0) return `<b>Overview.</b> The chase and target are already together.${ex}`;
            return `<b>Overview.</b> The chase flies ${m.k === 1 ? 'one phasing orbit' : `${m.k} phasing orbits`} of ${formatHms(m.Period_phasing)}, then returns to the circle as the target arrives. Press Next.${ex}`;
        }

        const dir = (v) => (v >= 0 ? 'posigrade' : 'retrograde');
        const dv = (sym, v) => `${math(sym)} = ${signText(v)}${fmtKms(Math.abs(v))}`;
        switch (p.key) {
            case 'wait': {
                const phiNow = RM.wrap2Pi(m.phi0_rad + m.omega_drift * t) * R2D;
                return `Waiting for ${math(S.phiD)} = ${fmtDeg(m.phi_desired_deg)}. Now ${math(S.phi)} = ${fmtDeg(phiNow)}.`;
            }
            case 'burn1':
                if (m.mode === 'coorbital') {
                    return `Burn into the phasing orbit: ${dv(S.dV1, m.dv1)}, ${dir(m.dv1)}. ${m.dv1 < 0 ? 'Drop lower and faster to catch up.' : 'Climb higher and slower to let the target catch up.'}`;
                }
                return `Departure burn: ${dv(S.dV1, m.dv1)}, ${dir(m.dv1)}, onto the transfer orbit.`;
            case 'transfer':
                return `The chase travels 180°; the target travels ${math(S.nu)} = ${fmtDeg(m.nu_travel_deg)}.`;
            case 'phasing': {
                const i = Math.min(m.k, Math.floor(t / m.Period_phasing) + 1);
                return `Phasing orbit ${i} of ${m.k}. The target travels ${math(S.nu)} = ${fmtDeg(m.nu_travel_deg)} per phasing orbit.`;
            }
            case 'burn2':
                return m.mode === 'coorbital'
                    ? `Burn back onto the circle: ${dv(S.dV2, m.dv2)}, ${dir(m.dv2)}.`
                    : `Arrival burn: ${dv(S.dV2, m.dv2)}, ${dir(m.dv2)}, matching the target's speed.`;
            case 'together':
                return '<b>Rendezvous:</b> same place, same time, same velocity.';
            default:
                return '';
        }
    }

    function updateHudAndHighlight() {
        if (!currentSolved) return;
        const m = currentSolved;
        const RS = window.RendezvousScene;
        const p = RS ? RS.phaseAt(m, state.timeline) : { key: 'overview', k: 0 };
        const t = RS ? RS.clockAt(m, state.timeline) : 0;

        if (missionClockEl) missionClockEl.textContent = `t = ${formatHms(t)}`;

        const hudText = hudFor(m, p, t);
        if (hudEl && hudText !== lastHud) {
            hudEl.innerHTML = hudText;
            lastHud = hudText;
        }

        // Highlight the card for the current part (none in the overview)
        const activeKey = state.step === 0 ? '' : ((PART_CARD[m.mode] || {})[p.key] || '');
        state.activePhase = activeKey;
        if (equationCardsEl) {
            equationCardsEl.querySelectorAll('.equation-card').forEach((c) => {
                c.classList.toggle('active', c.dataset.key === activeKey);
            });
        }

        if (timelineValueEl) {
            const n = stepList().length;
            timelineValueEl.textContent = state.step === 0 ? 'Overview' : `Step ${state.step} of ${n}`;
        }
    }

    // Delegated click on the HUD's "Switch to Co-orbital" button
    if (hudEl) {
        hudEl.addEventListener('click', (e) => {
            if (!e.target || e.target.id !== 'btn-switch-coorbital' || !currentSolved) return;
            state.values.coorbital.Rchase = currentSolved.Rchase;
            state.values.coorbital.phi0 = currentSolved.phi0;
            state.lessonExample.coorbital = false;
            setMode('coorbital');
        });
    }

    /* ------------------------------------------------------------------ */
    /* Update Dispatcher                                                  */
    /* ------------------------------------------------------------------ */
    let currentSolved = null;

    function updateAll() {
        currentSolved = solveCurrent();
        if (!currentSolved) return;

        renderEquations(currentSolved);
        renderLiveValues(currentSolved);
        renderTrade(currentSolved);
        renderWhatToNotice(currentSolved);

        const list = stepList();
        if (state.step > list.length) {
            state.step = list.length;
            state.anim = null;
        }

        if (sceneController) {
            sceneController.setModel(currentSolved);
            sceneController.setTime(state.timeline);
        }

        updateStepButtons();
        updateHudAndHighlight();
    }

    /* ------------------------------------------------------------------ */
    /* Animation Loop & Steps (copied from orbital-maneuvers.js)          */
    /* ------------------------------------------------------------------ */
    const CYCLE_SECONDS = 14;
    const MIN_STEP_SECONDS = 1;

    function stepList() {
        return currentSolved && window.RendezvousScene ? window.RendezvousScene.segments(currentSolved) : [];
    }

    function stepForTime(t) {
        const list = stepList();
        if (!list.length || t <= 0) return 0;
        const index = list.findIndex((seg) => t < seg.to);
        return (index < 0 ? list.length - 1 : index) + 1;
    }

    function stepEnd(step) {
        const list = stepList();
        if (step <= 0 || !list.length) return 0;
        if (step >= list.length) return 1;
        return list[step - 1].to - 1e-4;
    }

    function setTimeline(t) {
        state.timeline = Math.max(0, Math.min(1, t));
        if (timelineSlider) timelineSlider.value = Math.round(state.timeline * 1000);
        if (sceneController) sceneController.setTime(state.timeline);
        updateHudAndHighlight();
    }

    function focusStep() {
        if (!sceneController) return;
        const list = stepList();
        const key = state.step === 0 || !list[state.step - 1] ? 'start' : list[state.step - 1].key;
        sceneController.setFocus(key);
    }

    function goToStep(step, { animate = false, at = null } = {}) {
        const list = stepList();
        step = Math.max(0, Math.min(list.length, step));
        const changed = step !== state.step;
        state.step = step;
        state.anim = null;

        if (step > 0 && animate && !(Kit && Kit.prefersReducedMotion && Kit.prefersReducedMotion())) {
            const seg = list[step - 1];
            state.anim = { from: seg.from, to: stepEnd(step), clock: 0 };
            setTimeline(seg.from);
        } else {
            setTimeline(at === null ? stepEnd(step) : at);
        }

        if (changed || animate) focusStep();
        updateStepButtons();
    }

    function updateStepButtons() {
        const n = stepList().length;
        if (btnBack) btnBack.disabled = state.step <= 0;
        const last = state.step >= n;
        if (btnNext) {
            btnNext.disabled = last && !state.anim;
            btnNext.textContent = last ? 'Done' : 'Next';
        }
    }

    let updatePending = false;
    function scheduleUpdate() {
        updatePending = true;
    }

    if (Kit && Kit.startLoop) {
        Kit.startLoop((dt) => {
            if (updatePending) {
                updatePending = false;
                updateAll();
            }
            const anim = state.anim;
            if (!anim) return;
            const rate = state.speeds[state.speedIndex].rate;
            const seconds = Math.max(MIN_STEP_SECONDS, ((anim.to - anim.from) * CYCLE_SECONDS) / rate);
            anim.clock += dt;
            const k = Math.min(1, anim.clock / seconds);
            setTimeline(anim.from + (anim.to - anim.from) * k);
            if (k >= 1) {
                state.anim = null;
                updateStepButtons();
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* UI Event Bindings                                                  */
    /* ------------------------------------------------------------------ */
    function setMode(mode) {
        if (!DEFAULTS[mode]) return;
        modeButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false'));
        state.mode = mode;
        buildSlidersHtml();
        state.step = 0;
        state.anim = null;
        state.timeline = 0;
        updateAll();
        goToStep(0);
        if (sceneController) sceneController.resetView();
    }

    modeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.mode !== state.mode) setMode(btn.dataset.mode);
        });
    });

    if (btnResetValues) {
        btnResetValues.addEventListener('click', () => {
            state.values[state.mode] = JSON.parse(JSON.stringify(DEFAULTS[state.mode]));
            state.lessonExample[state.mode] = false;
            buildSlidersHtml();
            updateAll();
            goToStep(0);
            if (sceneController) sceneController.resetView();
        });
    }

    if (btnLessonExample) {
        btnLessonExample.addEventListener('click', () => {
            const ex = LESSON_EXAMPLES[state.mode];
            if (!ex) return;
            Object.assign(state.values[state.mode], ex.values);
            state.lessonExample[state.mode] = true;
            buildSlidersHtml();
            updateAll();
            goToStep(0);
            if (sceneController) sceneController.resetView();
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (state.step >= stepList().length) {
                if (state.anim) goToStep(state.step);
                return;
            }
            goToStep(state.step + 1, { animate: true });
        });
    }

    if (btnBack) {
        btnBack.addEventListener('click', () => {
            goToStep(state.step - 1);
        });
    }

    if (btnRewind) {
        btnRewind.addEventListener('click', () => {
            goToStep(0);
            focusStep();
        });
    }

    if (timelineSlider) {
        timelineSlider.addEventListener('input', (e) => {
            const t = Number(e.target.value) / 1000;
            goToStep(stepForTime(t), { at: t });
        });
    }

    if (speedSlider && speedValueEl) {
        speedSlider.addEventListener('input', () => {
            state.speedIndex = Number(speedSlider.value);
            speedValueEl.textContent = state.speeds[state.speedIndex].label;
        });
    }

    const updateShown = () => {
        state.shown.vectors = checkVectors ? checkVectors.checked : true;
        state.shown.angles = checkAngles ? checkAngles.checked : true;
        state.shown.labels = checkLabels ? checkLabels.checked : true;
        if (sceneController) sceneController.setShown(state.shown);
    };

    if (checkVectors) checkVectors.addEventListener('change', updateShown);
    if (checkAngles) checkAngles.addEventListener('change', updateShown);
    if (checkLabels) checkLabels.addEventListener('change', updateShown);

    /* ------------------------------------------------------------------ */
    /* Initial Boot                                                       */
    /* ------------------------------------------------------------------ */
    buildSlidersHtml();
    updateAll();
    updateShown();
    goToStep(0);

})();
