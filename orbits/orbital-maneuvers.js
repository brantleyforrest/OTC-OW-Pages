// Orbital Maneuvers Visualizer
// Controller, UI event bindings, state management, equations rendering, and live budget.
(async function () {
    'use strict';

    const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
    const $ = (id) => document.getElementById(id);
    const Kit = window.ToolKit;
    const MP = window.ManeuversProblems;
    const MathRenderer = window.PracticeMath || { math: (s) => s };

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

    const MU = (MP && MP.constants && MP.constants.MU) || 398600.4418;
    const R_EARTH = (MP && MP.constants && MP.constants.R_EARTH) || 6378.137;
    const D2R = Math.PI / 180;

    // Formatting helpers
    const fmtKm = (v) => `${Math.round(v).toLocaleString('en-US')} km`;
    const fmtKms = (v) => `${Number(v).toFixed(3)} km/s`;
    const fmtMs = (v) => `${Math.round(Number(v) * 1000).toLocaleString('en-US')} m/s`;
    const fmtDeg = (v) => `${Number(v).toFixed(1)}°`;
    // The same, for use inside TeX, where units are upright text
    const kmsTex = (v) => `${Number(v).toFixed(3)}\\text{ km/s}`;
    const msTex = (v) => `${Math.round(Number(v) * 1000).toLocaleString('en-US')}\\text{ m/s}`;
    const degTex = (v) => `${Number(v).toFixed(1)}°`;

    function formatHms(seconds) {
        const total = Math.max(0, Math.round(seconds));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Speeds with m/s subtext
    const speedHtml = (kms) => `<b>${fmtKms(kms)}</b> <span class="unit-sub">(${fmtMs(kms)})</span>`;

    /* ------------------------------------------------------------------ */
    /* State Configuration & Defaults                                     */
    /* ------------------------------------------------------------------ */
    const DEFAULTS = {
        hohmann: { R1: 9600, R2: 24000 },
        inclination: { r: 12000, i1: 28.5, i2: 55.0, raan: 45, u_sc: 270 },
        polar_raan: { r: 12000, i: 90, raan1: 30, raan2: 60, u_sc: 30 },
        combined: { R1: 9600, R2: 24000, i1: 28.5, i2: 0.0, location: 'higher' }
    };

    const state = {
        type: 'hohmann',
        values: JSON.parse(JSON.stringify(DEFAULTS)),
        step: 0,          // 0 is the overview; each later step is one part of the maneuver
        anim: null,       // The part that is playing, if any
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

    /* ------------------------------------------------------------------ */
    /* Physics Solvers Integration                                        */
    /* ------------------------------------------------------------------ */
    function solveCurrent() {
        const type = state.type;
        const vals = state.values[type];

        if (type === 'hohmann') {
            const res = MP.solveHohmann(vals.R1, vals.R2);
            return { ...res, type };
        }

        if (type === 'inclination') {
            const alt = vals.r - R_EARTH;
            const res = MP.solveInclinationChange(alt, vals.i1, vals.i2, vals.raan, vals.u_sc);
            return { ...res, type, r: vals.r };
        }

        if (type === 'polar_raan') {
            const alt = vals.r - R_EARTH;
            const res = MP.solvePolarRaanChange(alt, vals.raan1, vals.raan2, vals.u_sc);
            return { ...res, type, r: vals.r, i: 90 };
        }

        if (type === 'combined') {
            const baseCombined = MP.solveCombined(vals.R1, vals.R2, vals.i1, vals.i2);
            const { R1, R2, i1, i2, isRaise, v1, v_tx1, v_tx2, v2, delta_theta } = baseCombined;
            const theta = delta_theta * D2R;

            // Compute Lower orbit burn option
            let dv1_lower, dv2_lower, dv_total_lower;
            if (isRaise) {
                // Lower orbit is R1: burn 1 carries plane change
                dv1_lower = Math.sqrt(v1 * v1 + v_tx1 * v_tx1 - 2 * v1 * v_tx1 * Math.cos(theta));
                dv2_lower = Math.abs(v2 - v_tx2);
                dv_total_lower = dv1_lower + dv2_lower;
            } else {
                // Lower orbit is R2: burn 2 carries plane change
                dv1_lower = Math.abs(v_tx1 - v1);
                dv2_lower = Math.sqrt(v_tx2 * v_tx2 + v2 * v2 - 2 * v_tx2 * v2 * Math.cos(theta));
                dv_total_lower = dv1_lower + dv2_lower;
            }

            // Separate burn option: Hohmann + separate pure plane change at higher orbit
            const dv_higher_plain = isRaise ? Math.abs(v2 - v_tx2) : Math.abs(v1 - v_tx1);
            const v_higher = isRaise ? v2 : v1;
            const dv_plane_separate = 2 * v_higher * Math.sin(theta / 2);
            const dv_total_separate = baseCombined.dv_separate + (isRaise ? baseCombined.dv1 : baseCombined.dv2);

            // Active choice
            let activeDv1 = baseCombined.dv1;
            let activeDv2 = baseCombined.dv2;
            let activeTotal = baseCombined.dv_total;

            if (vals.location === 'lower') {
                activeDv1 = dv1_lower;
                activeDv2 = dv2_lower;
                activeTotal = dv_total_lower;
            } else if (vals.location === 'separate') {
                activeDv1 = baseCombined.dv1;
                activeDv2 = baseCombined.dv2;
                activeTotal = dv_total_separate;
            }

            return {
                ...baseCombined,
                type,
                planeChangeLocation: vals.location,
                dv1: activeDv1,
                dv2: activeDv2,
                dv_total: activeTotal,
                dv_higher_total: baseCombined.dv_total,
                dv_lower_total: dv_total_lower,
                dv_separate_total: dv_total_separate,
                dv1_lower,
                dv2_lower
            };
        }
        return null;
    }

    /* ------------------------------------------------------------------ */
    /* Scene Setup                                                        */
    /* ------------------------------------------------------------------ */
    let sceneController = null;
    if (THREE && window.ManeuverScene) {
        sceneController = window.ManeuverScene.create(
            THREE,
            {
                view: $('view'),
                canvas: $('scene'),
                hint: $('view-hint'),
                reset: $('reset-view'),
                labels: $('labels'),
                showStatus
            },
            { MU, R_EARTH }
        );
    }

    /* ------------------------------------------------------------------ */
    /* DOM Element Caches                                                 */
    /* ------------------------------------------------------------------ */
    const typeButtons = document.querySelectorAll('#maneuver-type button');
    const btnBack = $('btn-back');
    const btnNext = $('btn-next');
    const btnRewind = $('btn-rewind');
    const timelineSlider = $('timeline-slider');
    const timelineValueEl = $('timeline-value');
    const speedSlider = $('speed');
    const speedValueEl = $('speed-value');
    const btnResetValues = $('btn-reset-values');
    const slidersContainer = $('sliders-container');

    const checkVectors = $('check-vectors');
    const checkAngles = $('check-angles');
    const checkLabels = $('check-labels');

    const hudEl = $('hud');
    const equationCardsEl = $('equation-cards');
    const liveValuesGridEl = $('live-values-grid');
    const dvBudgetContentEl = $('dv-budget-content');
    const whatToNoticeTextEl = $('what-to-notice-text');

    /* ------------------------------------------------------------------ */
    /* Maneuver Input Controls Building                                   */
    /* ------------------------------------------------------------------ */
    function buildSlidersHtml() {
        const type = state.type;
        const vals = state.values[type];

        if (type === 'hohmann') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r1">Initial Radius (R₁)</label>
                            <span class="control-value" id="val-r1">${fmtKm(vals.R1)}</span>
                        </div>
                        <input type="range" id="sl-r1" min="6700" max="45000" step="100" value="${vals.R1}" aria-label="Initial orbit radius R1">
                        <span class="earth-radius-hint">Earth surface: 6,378 km</span>
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r2">Target Radius (R₂)</label>
                            <span class="control-value" id="val-r2">${fmtKm(vals.R2)}</span>
                        </div>
                        <input type="range" id="sl-r2" min="6700" max="45000" step="100" value="${vals.R2}" aria-label="Target orbit radius R2">
                        <div class="slider-presets">
                            <button type="button" class="btn-preset-pill" id="btn-leo-geo">Preset: LEO to GEO</button>
                        </div>
                    </div>
                </div>
            `;
            $('sl-r1').addEventListener('input', (e) => {
                vals.R1 = Number(e.target.value);
                $('val-r1').textContent = fmtKm(vals.R1);
                scheduleUpdate();
            });
            $('sl-r2').addEventListener('input', (e) => {
                vals.R2 = Number(e.target.value);
                $('val-r2').textContent = fmtKm(vals.R2);
                scheduleUpdate();
            });
            const leoGeoBtn = $('btn-leo-geo');
            if (leoGeoBtn) {
                leoGeoBtn.addEventListener('click', () => {
                    vals.R1 = 6678;
                    vals.R2 = 42164;
                    $('sl-r1').value = vals.R1;
                    $('sl-r2').value = vals.R2;
                    $('val-r1').textContent = fmtKm(vals.R1);
                    $('val-r2').textContent = fmtKm(vals.R2);
                    updateAll();
                });
            }
        } else if (type === 'inclination') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r">Orbit Radius (r)</label>
                            <span class="control-value" id="val-r">${fmtKm(vals.r)}</span>
                        </div>
                        <input type="range" id="sl-r" min="6700" max="45000" step="100" value="${vals.r}" aria-label="Orbit radius">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-i1">Initial Inclination (i₁)</label>
                            <span class="control-value" id="val-i1">${fmtDeg(vals.i1)}</span>
                        </div>
                        <input type="range" id="sl-i1" min="0" max="90" step="0.5" value="${vals.i1}" aria-label="Initial inclination">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-i2">Target Inclination (i₂)</label>
                            <span class="control-value" id="val-i2">${fmtDeg(vals.i2)}</span>
                        </div>
                        <input type="range" id="sl-i2" min="0" max="90" step="0.5" value="${vals.i2}" aria-label="Target inclination">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-raan">RAAN (Ω)</label>
                            <span class="control-value" id="val-raan">${fmtDeg(vals.raan)}</span>
                        </div>
                        <input type="range" id="sl-raan" min="0" max="355" step="5" value="${vals.raan}" aria-label="RAAN">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-u">Spacecraft Position (u)</label>
                            <span class="control-value" id="val-u">${fmtDeg(vals.u_sc)}</span>
                        </div>
                        <input type="range" id="sl-u" min="0" max="355" step="5" value="${vals.u_sc}" aria-label="Argument of latitude">
                    </div>
                </div>
            `;
            const bind = (id, valId, key, fmt) => {
                $(id).addEventListener('input', (e) => {
                    vals[key] = Number(e.target.value);
                    $(valId).textContent = fmt(vals[key]);
                    scheduleUpdate();
                });
            };
            bind('sl-r', 'val-r', 'r', fmtKm);
            bind('sl-i1', 'val-i1', 'i1', fmtDeg);
            bind('sl-i2', 'val-i2', 'i2', fmtDeg);
            bind('sl-raan', 'val-raan', 'raan', fmtDeg);
            bind('sl-u', 'val-u', 'u_sc', fmtDeg);

        } else if (type === 'polar_raan') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r">Orbit Radius (r)</label>
                            <span class="control-value" id="val-r">${fmtKm(vals.r)}</span>
                        </div>
                        <input type="range" id="sl-r" min="6700" max="45000" step="100" value="${vals.r}" aria-label="Orbit radius">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <span>Inclination (i)</span>
                            <span class="control-value fixed-badge">90.0° (Polar)</span>
                        </div>
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-raan1">Initial RAAN (Ω₁)</label>
                            <span class="control-value" id="val-raan1">${fmtDeg(vals.raan1)}</span>
                        </div>
                        <input type="range" id="sl-raan1" min="0" max="180" step="5" value="${vals.raan1}" aria-label="Initial RAAN">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-raan2">Target RAAN (Ω₂)</label>
                            <span class="control-value" id="val-raan2">${fmtDeg(vals.raan2)}</span>
                        </div>
                        <input type="range" id="sl-raan2" min="0" max="180" step="5" value="${vals.raan2}" aria-label="Target RAAN">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-u">Spacecraft Position (u)</label>
                            <span class="control-value" id="val-u">${fmtDeg(vals.u_sc)}</span>
                        </div>
                        <input type="range" id="sl-u" min="0" max="355" step="5" value="${vals.u_sc}" aria-label="Argument of latitude">
                    </div>
                </div>
            `;
            const bind = (id, valId, key, fmt) => {
                $(id).addEventListener('input', (e) => {
                    vals[key] = Number(e.target.value);
                    $(valId).textContent = fmt(vals[key]);
                    scheduleUpdate();
                });
            };
            bind('sl-r', 'val-r', 'r', fmtKm);
            bind('sl-raan1', 'val-raan1', 'raan1', fmtDeg);
            bind('sl-raan2', 'val-raan2', 'raan2', fmtDeg);
            bind('sl-u', 'val-u', 'u_sc', fmtDeg);

        } else if (type === 'combined') {
            slidersContainer.innerHTML = `
                <div class="sliders-grid">
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r1">Initial Radius (R₁)</label>
                            <span class="control-value" id="val-r1">${fmtKm(vals.R1)}</span>
                        </div>
                        <input type="range" id="sl-r1" min="6700" max="45000" step="100" value="${vals.R1}" aria-label="Initial radius R1">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-r2">Target Radius (R₂)</label>
                            <span class="control-value" id="val-r2">${fmtKm(vals.R2)}</span>
                        </div>
                        <input type="range" id="sl-r2" min="6700" max="45000" step="100" value="${vals.R2}" aria-label="Target radius R2">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-i1">Initial Inclination (i₁)</label>
                            <span class="control-value" id="val-i1">${fmtDeg(vals.i1)}</span>
                        </div>
                        <input type="range" id="sl-i1" min="0" max="90" step="0.5" value="${vals.i1}" aria-label="Initial inclination i1">
                    </div>
                    <div class="slider-field">
                        <div class="control-label">
                            <label for="sl-i2">Target Inclination (i₂)</label>
                            <span class="control-value" id="val-i2">${fmtDeg(vals.i2)}</span>
                        </div>
                        <input type="range" id="sl-i2" min="0" max="90" step="0.5" value="${vals.i2}" aria-label="Target inclination i2">
                    </div>
                </div>
                <div class="combined-location-row">
                    <span class="ctl-label-inline">Plane change at:</span>
                    <div class="segmented compact" id="combined-location" role="group" aria-label="Plane change burn location">
                        <button type="button" data-loc="higher" aria-pressed="${vals.location === 'higher'}">Higher orbit</button>
                        <button type="button" data-loc="lower" aria-pressed="${vals.location === 'lower'}">Lower orbit</button>
                        <button type="button" data-loc="separate" aria-pressed="${vals.location === 'separate'}">Separate burn</button>
                    </div>
                </div>
            `;
            const bind = (id, valId, key, fmt) => {
                $(id).addEventListener('input', (e) => {
                    vals[key] = Number(e.target.value);
                    $(valId).textContent = fmt(vals[key]);
                    scheduleUpdate();
                });
            };
            bind('sl-r1', 'val-r1', 'R1', fmtKm);
            bind('sl-r2', 'val-r2', 'R2', fmtKm);
            bind('sl-i1', 'val-i1', 'i1', fmtDeg);
            bind('sl-i2', 'val-i2', 'i2', fmtDeg);

            const locBtns = document.querySelectorAll('#combined-location button');
            locBtns.forEach((btn) => {
                btn.addEventListener('click', () => {
                    locBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
                    btn.setAttribute('aria-pressed', 'true');
                    vals.location = btn.dataset.loc;
                    updateAll();
                });
            });
        }
    }

    /* ------------------------------------------------------------------ */
    /* Equations Panel Rendering                                          */
    /* ------------------------------------------------------------------ */
    const C_O1 = '#e0b64f';
    const C_O2 = '#34d399';
    const C_TX = '#ff8a3d';
    const C_DV = '#f87171';
    const C_TH = '#38bdf8';
    const C_TM = '#c4a1ff';

    function renderEquations(model) {
        if (!equationCardsEl) return;
        const type = model.type;
        const math = MathRenderer.math;

        const card = (key, title, sym, num, res) => `
            <div class="equation-card ${state.activePhase === key ? 'active' : ''}" data-key="${key}" data-target-t="${timeForCard(model, key)}">
                <div class="eq-title">${title}</div>
                <div class="eq-sym">${math(sym)}</div>
                <div class="eq-num">${math(num)}</div>
                <div class="eq-res">${math(res)}</div>
            </div>
        `;

        let html = '';

        if (type === 'hohmann') {
            const { R1, R2, a_tx, v1, v2, v_tx1, v_tx2, dv1, dv2, dv_total, tof_s, tof_min, isRaise } = model;
            const hms = formatHms(tof_s);

            html += card(
                'atx',
                'Semi-Major Axis',
                `\\textcolor{${C_TX}}{a_{\\text{tx}}} = \\frac{\\textcolor{${C_O1}}{R_1} + \\textcolor{${C_O2}}{R_2}}{2}`,
                `= \\frac{\\textcolor{${C_O1}}{${Math.round(R1).toLocaleString('en-US')}} + \\textcolor{${C_O2}}{${Math.round(R2).toLocaleString('en-US')}}}{2}`,
                `= \\textcolor{${C_TX}}{${Math.round(a_tx).toLocaleString('en-US')}\\text{ km}}`,
                0.0
            );

            html += card(
                'v_circ',
                'Circular Speeds',
                `\\textcolor{${C_O1}}{V_1} = \\sqrt{\\frac{\\mu}{\\textcolor{${C_O1}}{R_1}}}, \\quad \\textcolor{${C_O2}}{V_2} = \\sqrt{\\frac{\\mu}{\\textcolor{${C_O2}}{R_2}}}`,
                `= \\sqrt{\\frac{398{,}600.44}{\\textcolor{${C_O1}}{${Math.round(R1).toLocaleString('en-US')}}}}, \\quad \\sqrt{\\frac{398{,}600.44}{\\textcolor{${C_O2}}{${Math.round(R2).toLocaleString('en-US')}}}}`,
                `= \\textcolor{${C_O1}}{${kmsTex(v1)}}, \\quad \\textcolor{${C_O2}}{${kmsTex(v2)}}`,
                0.0
            );

            html += card(
                'v_tx',
                'Transfer Speeds (Vis-Viva)',
                `\\textcolor{${C_TX}}{V_{\\text{tx}_1}} = \\sqrt{\\mu\\left(\\frac{2}{\\textcolor{${C_O1}}{R_1}} - \\frac{1}{\\textcolor{${C_TX}}{a_{\\text{tx}}}}\\right)}, \\quad \\textcolor{${C_TX}}{V_{\\text{tx}_2}} = \\sqrt{\\mu\\left(\\frac{2}{\\textcolor{${C_O2}}{R_2}} - \\frac{1}{\\textcolor{${C_TX}}{a_{\\text{tx}}}}\\right)}`,
                `= \\sqrt{398{,}600.44\\left(\\frac{2}{${Math.round(R1).toLocaleString('en-US')}} - \\frac{1}{${Math.round(a_tx).toLocaleString('en-US')}}\\right)}, \\; \\dots`,
                `= \\textcolor{${C_TX}}{${kmsTex(v_tx1)}}, \\quad \\textcolor{${C_TX}}{${kmsTex(v_tx2)}}`,
                0.22
            );

            html += card(
                'dv1',
                'Burn 1 Impulse (ΔV₁)',
                `\\textcolor{${C_DV}}{\\Delta V_1} = |\\textcolor{${C_TX}}{V_{\\text{tx}_1}} - \\textcolor{${C_O1}}{V_1}|`,
                `= |\\textcolor{${C_TX}}{${v_tx1.toFixed(3)}} - \\textcolor{${C_O1}}{${v1.toFixed(3)}}|`,
                `= \\textcolor{${C_DV}}{${kmsTex(dv1)}} \\; (${msTex(dv1)})`,
                0.22
            );

            html += card(
                'dv2',
                'Burn 2 Impulse (ΔV₂)',
                `\\textcolor{${C_DV}}{\\Delta V_2} = |\\textcolor{${C_O2}}{V_2} - \\textcolor{${C_TX}}{V_{\\text{tx}_2}}|`,
                `= |\\textcolor{${C_O2}}{${v2.toFixed(3)}} - \\textcolor{${C_TX}}{${v_tx2.toFixed(3)}}|`,
                `= \\textcolor{${C_DV}}{${kmsTex(dv2)}} \\; (${msTex(dv2)})`,
                0.77
            );

            html += card(
                'dv_total',
                'Total Maneuver Delta-V',
                `\\textcolor{${C_DV}}{\\Delta V_{\\text{total}}} = \\textcolor{${C_DV}}{\\Delta V_1} + \\textcolor{${C_DV}}{\\Delta V_2}`,
                `= \\textcolor{${C_DV}}{${dv1.toFixed(3)}} + \\textcolor{${C_DV}}{${dv2.toFixed(3)}}`,
                `= \\textcolor{${C_DV}}{${kmsTex(dv_total)}} \\; (${msTex(dv_total)})`,
                0.85
            );

            html += card(
                'tof',
                'Transfer Time of Flight',
                `\\textcolor{${C_TM}}{\\text{TOF}} = \\pi \\sqrt{\\frac{\\textcolor{${C_TX}}{a_{\\text{tx}}}^3}{\\mu}}`,
                `= \\pi \\sqrt{\\frac{\\textcolor{${C_TX}}{${Math.round(a_tx).toLocaleString('en-US')}}^3}{398{,}600.44}}`,
                `= \\textcolor{${C_TM}}{${tof_min.toFixed(1)}\\text{ min}} \\; (${hms})`,
                0.5
            );

        } else if (type === 'inclination' || type === 'polar_raan') {
            const isPolar = type === 'polar_raan';
            const { r, v, delta_theta, dv, period_min, u_sc, u_burn, next_node, next_pole, delta_u_to_node, delta_u_to_pole, time_to_burn_min } = model;
            const deltaU = isPolar ? delta_u_to_pole : delta_u_to_node;
            const burnSite = isPolar ? next_pole : next_node;

            html += card(
                'v_circ',
                'Circular Orbital Speed',
                `\\textcolor{${C_O1}}{V} = \\sqrt{\\frac{\\mu}{\\textcolor{${C_O1}}{r}}}`,
                `= \\sqrt{\\frac{398{,}600.44}{\\textcolor{${C_O1}}{${Math.round(r).toLocaleString('en-US')}}}}`,
                `= \\textcolor{${C_O1}}{${kmsTex(v)}}`,
                0.0
            );

            html += card(
                'angle',
                'Plane Change Angle (Δθ)',
                isPolar ? `\\textcolor{${C_TH}}{\\Delta \\theta} = |\\textcolor{${C_O2}}{\\Omega_2} - \\textcolor{${C_O1}}{\\Omega_1}|` : `\\textcolor{${C_TH}}{\\Delta \\theta} = |\\textcolor{${C_O2}}{i_2} - \\textcolor{${C_O1}}{i_1}|`,
                isPolar ? `= |\\textcolor{${C_O2}}{${model.raan2.toFixed(1)}^\\circ} - \\textcolor{${C_O1}}{${model.raan1.toFixed(1)}^\\circ}|` : `= |\\textcolor{${C_O2}}{${model.i2.toFixed(1)}^\\circ} - \\textcolor{${C_O1}}{${model.i1.toFixed(1)}^\\circ}|`,
                `= \\textcolor{${C_TH}}{${degTex(delta_theta)}}`,
                0.0
            );

            html += card(
                'dv',
                'Required Delta-V Impulse',
                `\\textcolor{${C_DV}}{\\Delta V} = 2 \\textcolor{${C_O1}}{V} \\sin\\left(\\frac{\\textcolor{${C_TH}}{\\Delta \\theta}}{2}\\right)`,
                `= 2 (\\textcolor{${C_O1}}{${v.toFixed(3)}}) \\sin\\left(\\frac{\\textcolor{${C_TH}}{${delta_theta.toFixed(1)}^\\circ}}{2}\\right)`,
                `= \\textcolor{${C_DV}}{${kmsTex(dv)}} \\; (${msTex(dv)})`,
                0.48
            );

            html += card(
                'location',
                'Burn Location & Timing',
                `\\text{Target: } \\textcolor{${C_TH}}{\\text{${burnSite}}}, \\quad \\textcolor{${C_TM}}{\\Delta u} = \\textcolor{${C_TH}}{u_{\\text{burn}}} - u_{\\text{sc}}`,
                `= \\textcolor{${C_TM}}{${Math.round(deltaU)}^\\circ} \\text{ travel angle}`,
                `\\textcolor{${C_TM}}{t_{\\text{burn}}} = \\left(\\frac{\\textcolor{${C_TM}}{${Math.round(deltaU)}^\\circ}}{360^\\circ}\\right)(${period_min.toFixed(1)}\\text{ min}) = \\textcolor{${C_TM}}{${time_to_burn_min.toFixed(1)}\\text{ min}}`,
                0.0
            );

        } else if (type === 'combined') {
            const { R1, R2, a_tx, v1, v2, v_tx1, v_tx2, dv1, dv2, dv_total, delta_theta, tof_s, tof_min, isRaise, planeChangeLocation } = model;
            const theta = delta_theta.toFixed(1);
            const hms = formatHms(tof_s);

            html += card(
                'atx',
                'Transfer Semi-Major Axis',
                `\\textcolor{${C_TX}}{a_{\\text{tx}}} = \\frac{\\textcolor{${C_O1}}{R_1} + \\textcolor{${C_O2}}{R_2}}{2}`,
                `= \\frac{\\textcolor{${C_O1}}{${Math.round(R1).toLocaleString('en-US')}} + \\textcolor{${C_O2}}{${Math.round(R2).toLocaleString('en-US')}}}{2}`,
                `= \\textcolor{${C_TX}}{${Math.round(a_tx).toLocaleString('en-US')}\\text{ km}}`,
                0.0
            );

            // Speeds
            html += card(
                'speeds',
                'Orbital & Transfer Speeds',
                `\\textcolor{${C_O1}}{V_1}, \\; \\textcolor{${C_TX}}{V_{\\text{tx}_1}}, \\; \\textcolor{${C_TX}}{V_{\\text{tx}_2}}, \\; \\textcolor{${C_O2}}{V_2}`,
                `\\textcolor{${C_O1}}{V_1} = ${v1.toFixed(3)}, \\; \\textcolor{${C_TX}}{V_{\\text{tx}_1}} = ${v_tx1.toFixed(3)}, \\; \\textcolor{${C_TX}}{V_{\\text{tx}_2}} = ${v_tx2.toFixed(3)}, \\; \\textcolor{${C_O2}}{V_2} = ${v2.toFixed(3)}`,
                `\\textcolor{${C_TH}}{\\Delta \\theta} = |\\textcolor{${C_O2}}{i_2} - \\textcolor{${C_O1}}{i_1}| = \\textcolor{${C_TH}}{${theta}^\\circ}`,
                0.0
            );

            // Speeds before and after each burn
            const burnSpeeds = { 1: [v1, v_tx1, 'V_1', 'V_{tx_1}'], 2: [v_tx2, v2, 'V_{tx_2}', 'V_2'] };
            const plainCard = (n, value) => {
                const [vi, vf, si, sf] = burnSpeeds[n];
                html += card(
                    `plain_burn_${n}`,
                    `Burn ${n}, Same Plane (ΔV${n === 1 ? '₁' : '₂'})`,
                    `\\textcolor{${C_DV}}{\\Delta V_${n}} = |${sf} - ${si}|`,
                    `= |${vf.toFixed(3)} - ${vi.toFixed(3)}|`,
                    `= \\textcolor{${C_DV}}{${kmsTex(value)}} \\; (${msTex(value)})`
                );
            };

            if (planeChangeLocation === 'separate') {
                // A Hohmann transfer, then a simple plane change at the higher orbit
                const vHigh = isRaise ? v2 : v1;
                const dv3 = 2 * vHigh * Math.sin((delta_theta / 2) * D2R);
                plainCard(1, dv1);
                plainCard(2, dv2);
                html += card(
                    'comb_burn',
                    'Plane Change at the Higher Orbit (ΔV₃)',
                    `\\textcolor{${C_DV}}{\\Delta V_3} = 2 V \\sin\\left(\\frac{\\textcolor{${C_TH}}{\\Delta \\theta}}{2}\\right)`,
                    `= 2 (${vHigh.toFixed(3)}) \\sin\\left(\\frac{\\textcolor{${C_TH}}{${theta}^\\circ}}{2}\\right)`,
                    `= \\textcolor{${C_DV}}{${kmsTex(dv3)}} \\; (${msTex(dv3)})`
                );
                html += card(
                    'dv_total',
                    'Total Maneuver Delta-V',
                    `\\textcolor{${C_DV}}{\\Delta V_{\\text{total}}} = \\textcolor{${C_DV}}{\\Delta V_1} + \\textcolor{${C_DV}}{\\Delta V_2} + \\textcolor{${C_DV}}{\\Delta V_3}`,
                    `= ${dv1.toFixed(3)} + ${dv2.toFixed(3)} + ${dv3.toFixed(3)}`,
                    `= \\textcolor{${C_DV}}{${kmsTex(dv_total)}} \\; (${msTex(dv_total)})`
                );
            } else {
                // The burn that also turns the plane uses the law of cosines.
                const combBurnNum = planeChangeLocation === 'lower' ? (isRaise ? 1 : 2) : (isRaise ? 2 : 1);
                const [vi, vf, si, sf] = burnSpeeds[combBurnNum];
                const combValue = combBurnNum === 1 ? dv1 : dv2;
                html += card(
                    'comb_burn',
                    `Burn ${combBurnNum}, Combined (ΔV${combBurnNum === 1 ? '₁' : '₂'})`,
                    `\\textcolor{${C_DV}}{\\Delta V_${combBurnNum}} = \\sqrt{${si}^2 + ${sf}^2 - 2 ${si} ${sf} \\cos\\textcolor{${C_TH}}{\\Delta\\theta}}`,
                    `= \\sqrt{(${vi.toFixed(3)})^2 + (${vf.toFixed(3)})^2 - 2(${vi.toFixed(3)})(${vf.toFixed(3)})\\cos(\\textcolor{${C_TH}}{${theta}^\\circ})}`,
                    `= \\textcolor{${C_DV}}{${kmsTex(combValue)}} \\; (${msTex(combValue)})`
                );
                const plainNum = combBurnNum === 1 ? 2 : 1;
                plainCard(plainNum, plainNum === 1 ? dv1 : dv2);
                html += card(
                    'dv_total',
                    'Total Maneuver Delta-V',
                    `\\textcolor{${C_DV}}{\\Delta V_{\\text{total}}} = \\textcolor{${C_DV}}{\\Delta V_1} + \\textcolor{${C_DV}}{\\Delta V_2}`,
                    `= \\textcolor{${C_DV}}{${dv1.toFixed(3)}} + \\textcolor{${C_DV}}{${dv2.toFixed(3)}}`,
                    `= \\textcolor{${C_DV}}{${kmsTex(dv_total)}} \\; (${msTex(dv_total)})`
                );
            }

            html += card(
                'tof',
                'Transfer Time of Flight',
                `\\textcolor{${C_TM}}{\\text{TOF}} = \\pi \\sqrt{\\frac{\\textcolor{${C_TX}}{a_{\\text{tx}}}^3}{\\mu}}`,
                `= \\pi \\sqrt{\\frac{\\textcolor{${C_TX}}{${Math.round(a_tx).toLocaleString('en-US')}}^3}{398{,}600.44}}`,
                `= \\textcolor{${C_TM}}{${tof_min.toFixed(1)}\\text{ min}} \\; (${hms})`,
                0.5
            );
        }

        equationCardsEl.innerHTML = html;

        // Card click jumpers
        equationCardsEl.querySelectorAll('.equation-card').forEach((cardEl) => {
            cardEl.addEventListener('click', () => {
                // Moves to the step this equation describes.
                const t = Number(cardEl.dataset.targetT || 0);
                goToStep(stepForTime(t), { at: t });
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Live Values Panel Rendering                                        */
    /* ------------------------------------------------------------------ */
    function renderLiveValues(model) {
        if (!liveValuesGridEl) return;
        const type = model.type;

        let items = [];

        if (type === 'hohmann') {
            items = [
                { label: 'Semi-major axis, a_tx', val: fmtKm(model.a_tx) },
                { label: 'Initial speed, V₁', val: speedHtml(model.v1) },
                { label: 'Target speed, V₂', val: speedHtml(model.v2) },
                { label: 'Burn 1 ΔV₁', val: speedHtml(model.dv1) },
                { label: 'Burn 2 ΔV₂', val: speedHtml(model.dv2) },
                { label: 'Total ΔV_total', val: speedHtml(model.dv_total) },
                { label: 'Transfer time (TOF)', val: `${model.tof_min.toFixed(1)} min (${formatHms(model.tof_s)})` }
            ];
        } else if (type === 'inclination' || type === 'polar_raan') {
            const isPolar = type === 'polar_raan';
            items = [
                { label: 'Circular speed, V', val: speedHtml(model.v) },
                { label: 'Turn angle, Δθ', val: fmtDeg(model.delta_theta) },
                { label: 'Required impulse, ΔV', val: speedHtml(model.dv) },
                { label: 'Orbit period, P', val: `${model.period_min.toFixed(1)} min` },
                { label: isPolar ? 'Next pole crossing' : 'Next node', val: isPolar ? model.next_pole : model.next_node },
                { label: 'Travel angle, Δu', val: fmtDeg(isPolar ? model.delta_u_to_pole : model.delta_u_to_node) },
                { label: 'Time to burn', val: `${model.time_to_burn_min.toFixed(1)} min` }
            ];
        } else if (type === 'combined') {
            items = [
                { label: 'Transfer semi-major axis', val: fmtKm(model.a_tx) },
                { label: 'Burn 1 ΔV₁', val: speedHtml(model.dv1) },
                { label: 'Burn 2 ΔV₂', val: speedHtml(model.dv2) },
                { label: 'Plane change angle, Δθ', val: fmtDeg(model.delta_theta) },
                { label: 'Total ΔV (active)', val: speedHtml(model.dv_total) },
                { label: 'Transfer time (TOF)', val: `${model.tof_min.toFixed(1)} min (${formatHms(model.tof_s)})` }
            ];
        }

        liveValuesGridEl.innerHTML = items.map((it) => `
            <div class="stat-item">
                <span class="stat-label">${it.label}</span>
                <span class="stat-value">${it.val}</span>
            </div>
        `).join('');
    }

    /* ------------------------------------------------------------------ */
    /* Delta-V Budget Panel Rendering                                     */
    /* ------------------------------------------------------------------ */
    function renderDvBudget(model) {
        if (!dvBudgetContentEl) return;
        const type = model.type;

        let html = '';

        if (type === 'hohmann') {
            const tot = Math.max(1e-4, model.dv_total);
            const p1 = (model.dv1 / tot) * 100;
            const p2 = (model.dv2 / tot) * 100;

            html = `
                <div class="dv-budget-box">
                    <div class="dv-bar-header">
                        <span>Burn 1 (${p1.toFixed(1)}%)</span>
                        <span>Burn 2 (${p2.toFixed(1)}%)</span>
                    </div>
                    <div class="dv-bar-track">
                        <div class="dv-bar-fill b1" style="width: ${p1}%" title="Burn 1: ${fmtKms(model.dv1)}"></div>
                        <div class="dv-bar-fill b2" style="width: ${p2}%" title="Burn 2: ${fmtKms(model.dv2)}"></div>
                    </div>
                    <div class="dv-legend">
                        <span><span class="dv-dot b1"></span>ΔV₁: <b>${fmtKms(model.dv1)}</b></span>
                        <span><span class="dv-dot b2"></span>ΔV₂: <b>${fmtKms(model.dv2)}</b></span>
                        <span class="dv-total-tag">Total: <b>${fmtKms(model.dv_total)}</b></span>
                    </div>
                </div>
            `;
        } else if (type === 'inclination' || type === 'polar_raan') {
            const share = (model.dv / Math.max(1e-4, model.v)) * 100;
            html = `
                <div class="dv-budget-box">
                    <div class="dv-bar-header">
                        <span>ΔV Cost relative to orbital speed V</span>
                        <span><b>${share.toFixed(1)}%</b> of V</span>
                    </div>
                    <div class="dv-bar-track">
                        <div class="dv-bar-fill b1" style="width: ${Math.min(100, share)}%"></div>
                    </div>
                    <div class="dv-legend">
                        <span>ΔV: <b>${fmtKms(model.dv)}</b></span>
                        <span>Orbit V: <b>${fmtKms(model.v)}</b></span>
                    </div>
                    <div class="dv-curve-container">
                        <canvas id="dv-curve-canvas" width="280" height="110"></canvas>
                    </div>
                </div>
            `;
        } else if (type === 'combined') {
            const maxVal = Math.max(model.dv_higher_total, model.dv_lower_total, model.dv_separate_total, 1e-4);
            const wHigh = (model.dv_higher_total / maxVal) * 100;
            const wLow = (model.dv_lower_total / maxVal) * 100;
            const wSep = (model.dv_separate_total / maxVal) * 100;

            const loc = model.planeChangeLocation;

            html = `
                <div class="dv-compare-list">
                    <div class="dv-compare-row ${loc === 'higher' ? 'selected' : ''}">
                        <div class="dv-bar-header">
                            <span><b>Higher orbit burn</b> (Standard)</span>
                            <span><b>${fmtKms(model.dv_higher_total)}</b></span>
                        </div>
                        <div class="dv-bar-track">
                            <div class="dv-bar-fill b1" style="width: ${wHigh}%"></div>
                        </div>
                    </div>

                    <div class="dv-compare-row ${loc === 'lower' ? 'selected' : ''}">
                        <div class="dv-bar-header">
                            <span><b>Lower orbit burn</b></span>
                            <span><b>${fmtKms(model.dv_lower_total)}</b></span>
                        </div>
                        <div class="dv-bar-track">
                            <div class="dv-bar-fill b2" style="width: ${wLow}%"></div>
                        </div>
                    </div>

                    <div class="dv-compare-row ${loc === 'separate' ? 'selected' : ''}">
                        <div class="dv-bar-header">
                            <span><b>Separate burns</b> (Hohmann + Pure Plane)</span>
                            <span><b>${fmtKms(model.dv_separate_total)}</b></span>
                        </div>
                        <div class="dv-bar-track">
                            <div class="dv-bar-fill b3" style="width: ${wSep}%"></div>
                        </div>
                    </div>
                </div>
            `;
        }

        dvBudgetContentEl.innerHTML = html;

        // Render curve if present
        const curveCanvas = $('dv-curve-canvas');
        if (curveCanvas) {
            drawDvCurve(curveCanvas, model.v, model.delta_theta, model.dv);
        }
    }

    function drawDvCurve(canvas, v, currentTheta, currentDv) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        const padL = 36;
        const padR = 15;
        const padT = 15;
        const padB = 25;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;

        // Max ΔV for 90 deg is 2 * V * sin(45) = 1.414 * V
        const maxDv = 2 * v * Math.sin(45 * D2R);

        // Axes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, padT + plotH);
        ctx.lineTo(padL + plotW, padT + plotH);
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('0', padL - 4, padT + plotH);
        ctx.fillText(fmtKms(maxDv).split(' ')[0], padL - 4, padT + 8);

        ctx.textAlign = 'center';
        ctx.fillText('0°', padL, padT + plotH + 14);
        ctx.fillText('45°', padL + plotW / 2, padT + plotH + 14);
        ctx.fillText('90°', padL + plotW, padT + plotH + 14);

        // Curve: ΔV(θ) = 2 V sin(θ / 2)
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let th = 0; th <= 90; th += 1) {
            const dv = 2 * v * Math.sin((th / 2) * D2R);
            const x = padL + (th / 90) * plotW;
            const y = padT + plotH - (dv / maxDv) * plotH;
            if (th === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Current point marker
        if (currentTheta <= 90) {
            const ptX = padL + (currentTheta / 90) * plotW;
            const ptY = padT + plotH - (currentDv / maxDv) * plotH;
            ctx.fillStyle = '#f87171';
            ctx.beginPath();
            ctx.arc(ptX, ptY, 4.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    /* ------------------------------------------------------------------ */
    /* What to Notice                                                     */
    /* ------------------------------------------------------------------ */
    function renderWhatToNotice(model) {
        if (!whatToNoticeTextEl) return;
        const type = model.type;
        if (type === 'hohmann') {
            whatToNoticeTextEl.textContent = 'The two burns are on opposite sides of Earth. The transfer takes half a lap of the transfer orbit.';
        } else if (type === 'inclination' || type === 'polar_raan') {
            whatToNoticeTextEl.textContent = 'The burn turns the velocity without changing its speed. The faster the orbit, the more that turn costs.';
        } else if (type === 'combined') {
            whatToNoticeTextEl.textContent = 'Turning the plane where the spacecraft is slowest costs least. Combining the plane change with the higher-orbit burn saves substantial delta-V compared to executing them separately.';
        }
    }

    /* ------------------------------------------------------------------ */
    /* HUD & Active Phase Highlighting                                    */
    /* ------------------------------------------------------------------ */
    // The timeline is shared with the scene, so that the caption and the picture agree.
    const Timeline = window.ManeuverScene;

    const PHASE_NAMES = {
        transfer: { coast1: 'Initial orbit', burn1: 'Burn 1', transfer: 'Transfer', burn2: 'Burn 2', burn3: 'Plane change', coast2: 'Target orbit' },
        plane: { coast1: 'Coast to burn', burn: 'Burn', coast2: 'New orbit' }
    };

    function phaseName(m, key) {
        if (m.type === 'hohmann' && m.R1 === m.R2) return 'Initial orbit';
        if ((m.type === 'inclination' || m.type === 'polar_raan') && m.delta_theta < 0.01) return 'Coast';
        const family = m.type === 'hohmann' || m.type === 'combined' ? 'transfer' : 'plane';
        return PHASE_NAMES[family][key] || '';
    }

    function speedChange(raise, where) {
        return raise
            ? `A prograde burn at ${where} speeds the spacecraft up.`
            : `A retrograde burn at ${where} slows the spacecraft down.`;
    }

    // The caption under the view, and the equation that goes with it, for the current phase.
    function phaseText(m, key) {
        if (m.type === 'hohmann' || m.type === 'combined') {
            if (m.R1 === m.R2) return { hud: 'R₁ and R₂ are the same, so no transfer is needed.', card: 'atx' };
            const combined = m.type === 'combined';
            const turn = Timeline.planeBurn(m);
            switch (key) {
                case 'coast1': return { hud: `<b>Initial orbit.</b> The spacecraft coasts on R₁${combined ? ' at i₁' : ''} toward the first burn.`, card: combined ? 'speeds' : 'v_circ' };
                case 'burn1': return turn === 'burn1'
                    ? { hud: '<b>Burn 1, combined.</b> This burn also turns the velocity into the new plane.', card: 'comb_burn' }
                    : { hud: `<b>Burn 1.</b> ${speedChange(m.isRaise, 'R₁')}`, card: combined ? 'plain_burn_1' : 'dv1' };
                case 'transfer': return { hud: '<b>Transfer.</b> The spacecraft flies half of the transfer ellipse. It moves fastest near perigee.', card: 'tof' };
                case 'burn2': return turn === 'burn2'
                    ? { hud: '<b>Burn 2, combined.</b> This burn also turns the velocity into the new plane.', card: 'comb_burn' }
                    : { hud: `<b>Burn 2.</b> ${speedChange(m.isRaise, 'R₂')}`, card: combined ? 'plain_burn_2' : 'dv2' };
                case 'burn3': return { hud: '<b>Plane change.</b> A separate burn at the higher orbit turns the velocity into the new plane.', card: 'comb_burn' };
                default: return { hud: `<b>Target orbit.</b> The spacecraft is now on R₂${combined ? ' at i₂' : ''}.`, card: 'dv_total' };
            }
        }
        const polar = m.type === 'polar_raan';
        if (m.delta_theta < 0.01) return { hud: 'The planes match, so no burn is needed.', card: 'angle' };
        const site = polar ? 'pole' : 'node';
        const du = Math.round(polar ? m.delta_u_to_pole : m.delta_u_to_node);
        switch (key) {
            case 'coast1': return { hud: `<b>Coast.</b> The spacecraft travels Δu = ${du}° to the next ${site}, where the two orbits cross.`, card: 'location' };
            case 'burn': return { hud: '<b>Burn.</b> The velocity turns by Δθ into the new plane. Its length does not change.', card: 'dv' };
            default: return { hud: `<b>New orbit.</b> The spacecraft continues in the new plane, at the same speed.`, card: 'angle' };
        }
    }

    // A time on the timeline that shows the given equation card.
    function timeForCard(m, cardKey) {
        const list = Timeline.segments(m);
        const at = (seg, k = 0.5) => {
            const s = list.find((x) => x.key === seg);
            return s ? s.from + (s.to - s.from) * k : 0;
        };
        const turn = Timeline.planeBurn(m);
        switch (cardKey) {
            case 'v_circ': case 'speeds': case 'location': return at('coast1', 0.4);
            case 'atx': case 'tof': return at('transfer');
            case 'v_tx': case 'dv1': case 'plain_burn_1': return at('burn1', 0.9);
            case 'dv2': case 'plain_burn_2': return at('burn2', 0.9);
            case 'comb_burn': return at(turn || 'burn2', 0.9);
            case 'angle': case 'dv': return at('burn', 0.9);
            case 'dv_total': return at('coast2', 0.3);
            default: return 0;
        }
    }

    function updateHudAndHighlight() {
        if (!currentSolved) return;
        const m = currentSolved;
        const phase = Timeline.phaseAt(m, state.timeline);
        const n = Timeline.segments(m).length;
        const overview = state.step === 0;
        const text = overview
            ? { hud: n === 1 ? '<b>Overview.</b> Press Next to play it.' : `<b>Overview.</b> The whole maneuver, in ${n} steps. Press Next to step through it.`, card: '' }
            : phaseText(m, phase.key);
        if (hudEl && hudEl.innerHTML !== text.hud) hudEl.innerHTML = text.hud;
        if (timelineValueEl) {
            timelineValueEl.textContent = overview ? 'Overview' : `Step ${state.step} of ${n}: ${phaseName(m, phase.key)}`;
        }
        if (state.activePhase !== text.card) {
            state.activePhase = text.card;
            if (equationCardsEl) {
                equationCardsEl.querySelectorAll('.equation-card').forEach((card) => {
                    card.classList.toggle('active', card.dataset.key === text.card);
                });
            }
        }
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
        renderDvBudget(currentSolved);
        renderWhatToNotice(currentSolved);

        // The parts of a maneuver can change with the sliders (a plane change before or after
        // the transfer, or no transfer at all), so the step is kept within the new list.
        const list = Timeline.segments(currentSolved);
        if (state.step > list.length) {
            state.step = list.length;
            state.anim = null;
        }
        if (!state.anim && stepForTime(state.timeline) !== state.step) state.timeline = stepEnd(state.step);
        if (sceneController) {
            sceneController.setModel(currentSolved);
            sceneController.setTime(state.timeline);
            const key = state.step === 0 ? 'start' : list[state.step - 1].key;
            if (key !== state.focusKey) focusStep();
        }
        updateStepButtons();
        updateHudAndHighlight();
    }

    /* ------------------------------------------------------------------ */
    /* Steps & Animation Loop                                             */
    /* ------------------------------------------------------------------ */
    // Step 0 is an overview of the whole maneuver. Each later step plays one part of it (a
    // coast, a burn, or the transfer) and then stops, and the camera moves to frame that part.
    const CYCLE_SECONDS = 14;   // The whole maneuver at Normal speed
    const MIN_STEP_SECONDS = 1;

    function stepList() {
        return currentSolved ? Timeline.segments(currentSolved) : [];
    }

    // The step whose part of the maneuver includes time t.
    function stepForTime(t) {
        const list = stepList();
        if (!list.length) return 0;
        const index = list.findIndex((seg) => t < seg.to);
        return (index < 0 ? list.length - 1 : index) + 1;
    }

    // Where a step stops: the end of its part, kept just inside it so the caption matches.
    function stepEnd(step) {
        const list = stepList();
        if (step <= 0 || !list.length) return 0;
        if (step >= list.length) return 1;
        return list[step - 1].to - 1e-4;
    }

    function setTimeline(t) {
        state.timeline = Math.max(0, Math.min(1, t));
        timelineSlider.value = Math.round(state.timeline * 1000);
        if (sceneController) sceneController.setTime(state.timeline);
        updateHudAndHighlight();
    }

    function focusStep() {
        if (!sceneController) return;
        const list = stepList();
        state.focusKey = state.step === 0 ? 'start' : list[state.step - 1].key;
        sceneController.setFocus(state.focusKey);
    }

    // Shows a step. With `animate`, its part of the maneuver plays from the start; otherwise it
    // jumps straight to `at`, or to where the step ends.
    function goToStep(step, { animate = false, at = null } = {}) {
        const list = stepList();
        step = Math.max(0, Math.min(list.length, step));
        const changed = step !== state.step;
        state.step = step;
        state.anim = null;
        if (step > 0 && animate && !Kit.prefersReducedMotion()) {
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
        btnBack.disabled = state.step <= 0;
        // On the last step, Next becomes Done and greys out.
        const last = state.step >= n;
        btnNext.disabled = last && !state.anim;
        btnNext.textContent = last ? 'Done' : 'Next';
    }

    // Slider changes are applied once per frame, because the equations are slow to redraw.
    let updatePending = false;
    function scheduleUpdate() {
        updatePending = true;
    }

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

    /* ------------------------------------------------------------------ */
    /* UI Event Bindings                                                  */
    /* ------------------------------------------------------------------ */
    // Maneuver type selection. The scene frames the overview of a new type on its own.
    typeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            typeButtons.forEach((b) => b.setAttribute('aria-pressed', 'false'));
            btn.setAttribute('aria-pressed', 'true');
            state.type = btn.dataset.type;
            buildSlidersHtml();
            state.step = 0;
            state.anim = null;
            state.timeline = 0;
            updateAll();
            goToStep(0);
        });
    });

    // Reset values to default for current type
    btnResetValues.addEventListener('click', () => {
        state.values[state.type] = JSON.parse(JSON.stringify(DEFAULTS[state.type]));
        buildSlidersHtml();
        updateAll();
        goToStep(0);
        focusStep();
    });

    // Next finishes the part that is playing, if any, and plays the next one.
    btnNext.addEventListener('click', () => {
        if (state.step >= stepList().length) {
            if (state.anim) goToStep(state.step);
            return;
        }
        goToStep(state.step + 1, { animate: true });
    });

    // Back shows the end of the step before.
    btnBack.addEventListener('click', () => {
        goToStep(state.step - 1);
    });

    btnRewind.addEventListener('click', () => {
        goToStep(0);
        focusStep();
    });

    // Scrubbing stops the step that is playing and moves to whichever step holds the new time.
    timelineSlider.addEventListener('input', (e) => {
        const t = Number(e.target.value) / 1000;
        goToStep(t <= 0 ? 0 : stepForTime(t), { at: t });
    });

    speedSlider.addEventListener('input', () => {
        state.speedIndex = Number(speedSlider.value);
        speedValueEl.textContent = state.speeds[state.speedIndex].label;
    });

    // Checkboxes
    const updateShown = () => {
        state.shown.vectors = checkVectors.checked;
        state.shown.angles = checkAngles.checked;
        state.shown.labels = checkLabels.checked;
        if (sceneController) sceneController.setShown(state.shown);
    };

    checkVectors.addEventListener('change', updateShown);
    checkAngles.addEventListener('change', updateShown);
    checkLabels.addEventListener('change', updateShown);

    /* ------------------------------------------------------------------ */
    /* Initial Boot                                                       */
    /* ------------------------------------------------------------------ */
    buildSlidersHtml();
    updateAll();
    updateShown();
    goToStep(0);
})();
