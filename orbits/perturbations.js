// OUTLINE ONLY. This file contains no code yet. Replace each comment block with the code it describes.
//
// WHAT THIS TOOL TEACHES
// One idea across the whole Perturbations lesson: a perturbation makes an orbit depart from two-body motion,
// and each perturbation changes a different element. Every mode keeps a gray "ghost" of the two-body orbit,
// fixed at its starting state, and a colored orbit that actually changes. The reader sees the gap grow.
//
//     Mode       Lesson goal   What changes              Where it matters
//     Drag       SOB 1         a and e fall              LEO
//     J2         SOB 2         RAAN and perigee turn     LEO to HEO
//     J2,2       SOB 3         GEO longitude swings      GEO
//     3rd Body   SOB 3         GEO inclination grows     GEO
//     SRP        SOB 3         GEO eccentricity cycles   GEO
//
// OUT OF SCOPE. Do not add: unexpected thrusting, the common orbit types section, a full numerical propagator,
// real Sun and Moon positions, or short-period J2 effects.
// sun-synchronous.html already teaches SSO in depth, so this tool has only one SSO preset.
//
// BUILD ORDER. Each step must work before the next starts.
//     1. perturbations-model.js. Pass its check table in Node.
//     2. perturbations.html, sections A to F below, and the J2 mode. J2 uses most of the shared parts.
//     3. Drag.   4. J2,2.   5. 3rd Body.   6. SRP.
//     7. Section Z, final checks and registration.
//     While building, the page may open on J2. The finished tool opens on Drag, the lesson's first topic.
//
// Shape of the file: one async IIFE, as in _template/tool-template-3d.js. Use PerturbationModel as M.


// ===========================================================================================
// A. STARTUP AND RENDERER
// ===========================================================================================
// Copy these parts from _template/tool-template-3d.js unchanged: THREE import and failure messages, showStatus,
// the WebGLRenderer block, the PerspectiveCamera with camera.up = (0, 0, 1), EarthScene.addEarth and addStars,
// drag-to-rotate and pinch-to-zoom, isBlocked, and showLabel.
//     ZOOM = { min: 3.5, max: 40 }. Use FOV 38 and far plane 200, as in the template.
//     Ambient light 0.2. One DirectionalLight, positioned by each mode (see C).
//     canvas.style.touchAction = 'none' on the 3D canvas only. Charts must not block page scrolling.
//
// Shared objects, added once:
//     Spin axis line and "N" label, as in sun-synchronous.js.
//     const layer = new Kit.LabelLayer($('labels')). All modes share it. A label not shown this frame is hidden.
//
// COLOR. One color per perturbation, in CSS and as hex, matching the lesson figure as closely as a dark page allows:
//     drag '#f87171'   j2 '#60a5fa'   j22 '#fb923c'   moon '#cbd5e1'   sun '#e3b85a'   srp '#facc15' (draw dashed)
//     central '#94a3b8'   ghost '#94a3b8' at 0.45 opacity   stable '#34d399'   unstable '#f87171'
//
// Global state: { mode, playing: !Kit.prefersReducedMotion(), speed: 1, showLabels: true }.
// Each mode owns the rest of its state, which persists when the reader switches away and back.


// ===========================================================================================
// B. SHARED DRAWING HELPERS
// ===========================================================================================
// drawRadius(hKm) = 1 + 1.6 * pow(max(h, 0) / M.RE, 0.6).
//     Earth's radius is 1 in the scene. True scale would hide LEO against Earth and push HEO off screen.
//     This keeps altitude order while fitting both. 250 km -> 1.23, 1200 km -> 1.59, 40,000 km -> 5.81.
//     The caption of every mode that uses it must say heights are compressed.
// GEO_DRAW = 2.6. Used as a fixed ring radius in the three GEO modes, also labeled not to scale.
//
// makeOrbitRing({ color, tube, opacity, vertexColors }) returns an object holding a Mesh and its curve.
// ring.setShape(radiusAt): rebuild from a function nu -> scene radius.
//     Curve: a THREE.Curve subclass, closed, in the XY plane, with perigee on +X.
//     Set curve.arcLengthDivisions = 400 and call updateArcLengths() before each rebuild. See orbital-elements.js:556.
//     Geometry: new THREE.TubeGeometry(curve, 240, tube, 6, true). Dispose the old geometry first.
//     Use a key string of the rounded inputs, as updateWedge does in sun-synchronous.js, and skip unchanged rebuilds.
//     Real orbit tube radius 0.012. Ghost 0.007.
//
// placeOrbit: put each ring in two nested groups so that RAAN, i, and perigee drift never need a geometry rebuild.
//     outer.rotation.order = 'ZXY'; outer.rotation.set(inc, 0, raan);  inner.rotation.z = argp;
//     Children of inner are in perifocal coordinates, which makes the satellite and perigee markers one line each.
//
// Satellite motion is decorative. Advance mean anomaly at a slowed rate and use M.solveKepler, so the
// satellite visibly speeds up at perigee. Its rate is independent of the speed slider, and the caption must say so.
// Earth spin is also decorative, 6 deg/s, except in J2,2, where Earth does not rotate in the Earth-fixed view.
//
// Rule from _template/README.md: do not blend ring points in a straight line. When a preset changes, jump to it.
//
// makeChart(boxId, canvasId, drawBase, drawLive): 2D canvas with a cached base layer.
//     Size with Kit.observeSize and Kit.fitCanvas2D. Redraw at once inside the resize callback.
//     Base layer: an offscreen canvas, drawn only on resize or chart.baseDirty = true. See ground-track.js:607.
//     Each render: clear, drawImage(base, 0, 0, w, h), then drawLive.
//     Plot margins: left 46, right 10, top 10, bottom 26. Text: 11px Inter, '#94a3b8'. Grid: 'rgba(255,255,255,0.08)'.
//
// Formatting: setText (only write when changed), formatDuration(days) ("18 h" below 1 day, "241 days" below
// 730 days, otherwise "2.3 yr"), formatLon(deg) ("75.0° E"), and exponent text such as "5.54 × 10⁻⁸".


// ===========================================================================================
// C. MODE CONTRACT
// ===========================================================================================
// Each entry of MODES has exactly these members. Controller code never tests which mode is active.
//     id, group                   THREE.Group added to scene, visible only while active
//     speeds                      three entries of { rate, label }, indexed by state.speed
//     home                        { az, el, dist }
//     lightDirection()            [x, y, z] for the DirectionalLight, multiplied by 10
//     enter()                     Sets captions and the aria-label, and marks the chart base dirty
//     rebuild()                   Recomputes derived values after any control changes. Not called per frame.
//     advance(seconds, rate)      Moves the mode's clock. Returns true if anything changed.
//     restart()                   Returns the clock to zero
//     sync()                      Places all objects for the current state. No allocation.
//     labels()                    Calls showLabel for this mode's labels
//     stats()                     Six { label, value } objects
//     equations()                 { title, constants, rows }, with five rows of { name, result, work }
//     notice()                    Text for "What to Notice"
//     hud()                       HTML for #hud. Must be short and change as the state changes.
//     caption()                   Text for #mode-caption, including its scale statement
//     chartTitle                  Text for #chart-title
//     drawChartBase(g, w, h), drawChartLive(g, w, h)
//     altitudeMarker()            [lowKm, highKm] for the Leads chart
//
// All control listeners do the same three things: update the mode's state, call rebuild(), set dirty = true.


// ===========================================================================================
// D. MODE CONTROLLER
// ===========================================================================================
// setMode(id):
//     Hide the old group, show the new one. Toggle the hidden attribute of every [data-mode] element.
//     Update #speed-value. Mark both chart bases dirty. Call mode.enter(), then remeasure labels.
//     Start a camera blend: 0.6 s, eased with t * t * (3 - 2 * t), wrap180 on azimuth. A pointer drag cancels it.
//     Blend from the current camera to mode.home. Restore home whenever a mode is entered.
// #restart calls mode.restart() and resumes playing.
// #reset-view restores mode.home.


// ===========================================================================================
// E. "WHICH PERTURBATION LEADS?" CHART (shared by all modes)
// ===========================================================================================
// Reproduces the lesson figure, so that the reader can connect the two.
//     x: log10 altitude, 200 to 50,000 km. Ticks: 200, 500, 1,000, 2,000, 5,000, 10,000, 20,000, 50,000.
//     y: log10 acceleration, 1e-10 to 1e1 m/s^2, one tick per decade, labeled every third decade to save space.
//     Curves from M.accelerationsAt, 80 log-spaced samples: central, j2, j22 (from 2,000 km only), moon, sun,
//     srp (dashed), drag (ends at 1,000 km). Label each at its right end, or at its end for drag.
//     Base layer: all curves at 0.55 alpha. The active mode's curve is drawn at full alpha, 2.2 px.
//         3rd Body highlights both moon and sun.
// Live layer: a vertical line at altitudeMarker()[0], and a shaded band out to altitudeMarker()[1] when elliptical.
// #leads-text, two short sentences: "Largest at 247 km: J₂. Largest non-gravitational: Drag."
//     Use the low end of altitudeMarker() and M.leadingPerturbation / M.leadingNonGravitational.
//     Display thirdBody as "Sun and Moon". This is intentional: the lesson compares their combined pull with J2.


// ===========================================================================================
// F. FRAME LOOP
// ===========================================================================================
// renderFrame(): mode.sync(), updateCamera(), stars.follow(camera), renderer.render(), updateLabels(), draw both charts.
// updatePanels(): stats, equations, hud, and #notice, each through setText or a changed-only innerHTML write.
// Kit.startLoop: if playing and mode.advance(seconds, mode.speeds[state.speed].rate), dirty = true.
// Step the camera blend. If not dirty, return without drawing. Otherwise render and update panels.
// Kit.observeSize on #view: same as the template, including the immediate renderFrame().


// ===========================================================================================
// MODE: DRAG (speeds are whole-decay playback times, not rates)
// ===========================================================================================
// speeds: [48, 24, 12] seconds for the whole decay. Labels: "48 s", "24 s", "12 s".
// home: { az: -90, el: 66, dist: 7.5 }.  lightDirection: [0.4, -0.3, 1].
// State: { hp: 250, ha: 1200, area: 'nominal', solar: 'mean', t: 0, history, done: false, anomaly: 0 }.
// Geometry is equatorial with perigee on +X, seen from above.
// Controls: if hp is raised above ha, set ha = hp. If ha is lowered below hp, set hp = ha.
// rebuild(): history = M.decayHistory(...) on every input. It is fast enough without a debounce. t = 0, done = false.
// advance: t += seconds * history.days / rate. At t >= history.days, clamp, set done, and pause. Pressing Play when done restarts.
//
// Scene:
//     Ghost ring: starting orbit. Real ring: M.sampleHistory(history, t), radius = drawRadius(r - RE).
//     Real ring has vertex colors from M.dragHeat, set for each of the tube's 241 cross-sections (7 vertices each).
//         TubeGeometry samples by arc length, so get each section's angle from the curve: P = curve.getPointAt(i / 240), nu = atan2(P.y, P.x).
//         Normalize: clamp((heat - (maxHeat - 3)) / 3, 0, 1), with maxHeat the value at this orbit's perigee.
//         Ramp: '#475569' at 0, drag color at 0.6, '#fff1c2' at 1. A circular orbit glows evenly, which is correct.
//         Rebuild only when a or e has changed enough for the key to change. Round a to 1 km and e to 0.0005.
//     Perigee and apogee dots, labels "Perigee 247 km", "Apogee 1,063 km".
//     Two thin in-plane circles at 120 km and 600 km, labels "120 km" and "600 km", optional, rank 3.
//     Satellite: mean anomaly 150 deg/s. Hide it when done.
//
// stats: Elapsed, Perigee, Apogee, Eccentricity, Period, Mean speed sqrt(mu / a).
//     Show perigee, apogee, period, and speed with their change since the start, e.g. "1,063 km (−137)".
//     Mean speed must visibly rise. That is the drag paradox from the lesson.
// equations: title "Drag at This Moment". constants: "C_D = 2.2. Density: mean atmosphere, scaled for solar activity."
//     Drag at perigee     a = 1/2 ρ v² (C_D A / m)     m/s²
//     Ballistic coeff.    BC = m / (C_D A)             kg/m²
//     Orbital energy      E = −μ / (2a)                km²/s²
//     Decay phase         "Phase 1: Circularizing" for e > 0.05, otherwise "Phase 2: Spiral Decay"; work shows e
//     Predicted lifetime  formatDuration, or "Over 200 yr" if not reentered; work shows the regime, e.g. "Active drag: 120 to 600 km"
//
// Chart "Altitude Over Time":
//     x: 0 to history.days, label in formatDuration units. y: 0 to 1.05 * starting ha.
//     Base: h_a and h_p curves at 0.35 alpha, and dashed lines at 120 and 600 km.
//     Live: the played part of both curves at full alpha, and a vertical cursor.
//
// notice: "Drag acts mostly near perigee, shown by the glow. Each pass lowers apogee, so the orbit shrinks and rounds out. The satellite speeds up as it sinks."
// hud:
//     Phase 1: "Perigee barely moves while apogee falls."
//     Phase 2: "The orbit is nearly circular. Drag now acts all the way around, and altitude falls everywhere."
//     Done and reentered: "Reentry after <duration>."
//     Done, not reentered: "Still in orbit after 200 years. Above 600 km, drag has much less effect."
// caption: one sentence on the current area or solar setting, then "Heights are compressed. The satellite's motion is slowed."


// ===========================================================================================
// MODE: J2
// ===========================================================================================
// speeds: 1, 5, 25 days/s.  home: { az: 35, el: 24, dist: 8 }.  lightDirection: [0.8, 0.3, 0.5].
// State: { a, e, inc, raan0: 40, argp0: 0, preset: 'leo', t: 0, anomaly: 0 }. a and e are the truth, and sliders are views.
//
// PRESETS. Selecting one sets state directly, then moves the sliders to the nearest positions.
//     leo:     500 x 500 km, i = 45, argp0 = 0     "Lesson Worked Example 1. The node moves west 5.410° per day."
//     polar:   800 x 800 km, i = 90, argp0 = 0     "At 90°, cos i is zero, so the node does not move."
//     sso:     700 x 700 km, i = M.sunSyncInclination(a), argp0 = 0     "Slightly retrograde, so the node moves east 0.9856° per day."
//     molniya: a = 26560, e = 0.745, i = 63.4349, argp0 = 270           "Lesson Worked Example 2. Perigee is frozen. Now try 55°."
// Slider behavior:
//     Any slider change clears the preset highlight (set aria-pressed false directly) and sets t = 0.
//     #j2-inc snaps to exactly 63.4349, 90, or 116.5651 within 0.25 deg. Do not allow 0 or 180, because the node is undefined there.
//     #j2-ha position x maps to ha = 200 * pow(225, x / 1000), rounded to 10 km.
//     Keep ha >= hp in both directions.
// rebuild(): rates = M.j2Rates(a, e, inc). rMax = drawRadius(ha). home.dist = max(8, 3.6 * rMax), so Molniya fits. Apply it through the camera blend.
// circular = e < 0.001. When circular, hide all perigee objects and show "No perigee".
//
// Scene:
//     Ghost ring at raan0, argp0. Real ring at raan0 + rate * t, argp0 + rate * t. Geometry rebuilds only in rebuild().
//     Equatorial bulge: translucent TorusGeometry(1.0, 0.045, 12, 120), label "Equatorial bulge (exaggerated)", optional.
//     Node sweep: a wedge on the equatorial plane from raan0 to the current node, using updateWedge from sun-synchronous.js.
//         Sweep is the drift since t = 0, wrapped to one turn, with its sign preserved. Inner radius 1.02, outer at the ring's radius at the node.
//     Node dot, ghost node dot. Label "Node: West 5.41°/day" (or East, or "Node fixed").
//     Perigee dot in the inner group, ghost perigee dot in the ghost's inner group. Label "Perigee".
//     Perigee trail: a pre-allocated THREE.Line, 400 points, world positions, one point per 2 deg of perigee movement. Clear on rebuild or restart.
//     Satellite: mean anomaly 110 deg/s.
//
// stats: Elapsed, RAAN (wrap360), Argument of perigee (wrap360), Node motion, Perigee motion, Apogee latitude.
//     Node motion: "West 5.41°/day", "East 0.99°/day", or "None".
//     Perigee motion: "Forward", "Backward", "None", or "No perigee".
// equations: title "J₂ Drift Rates". constants: "J₂ = 1.08263 × 10⁻³, Rₑ = 6,378.14 km, μ = 398,600.44 km³/s²."
//     Semi-latus rectum   p = a(1 − e²)                          km
//     Mean motion         n = √(μ / a³)                          mrad/s
//     Node drift          Ω̇ = −1.5 J₂ (Rₑ/p)² n cos i            °/day
//     Perigee drift       ω̇ = 0.75 J₂ (Rₑ/p)² n (5 cos² i − 1)   °/day
//     Full node circuit   T = 360° / |Ω̇|                         days, or "Never" at i = 90
//
// Chart "Drift Rate vs. Inclination":
//     x: 0 to 180 deg, ticks every 30. y: symmetric, +/- 1.1 * M.j2Rates(a, e, 0).perigeeDegDay. The largest rate on the chart occurs at i = 0.
//     Base: Ω̇ curve in j2 color, ω̇ curve in '#a78bfa', vertical dashed lines at 63.4, 90, 116.6 with short labels, a zero line.
//     Live: vertical line at inc, a dot on each curve.
//
// notice: "The bulge's pull turns the orbit's plane like a torque on a gyroscope. Inclination sets the direction: west below 90°, east above it. Perigee also turns, unless the orbit is at a critical inclination."
// hud, built from two parts:
//     Node part: "Prograde: the node moves west." / "Polar: the node stays fixed." / "Retrograde: the node moves east."
//     Perigee part, only if not circular: "Perigee moves forward." / "Perigee moves backward." / "Perigee is frozen, but the node still drifts."
// caption: the preset text, then "Heights are compressed. The satellite and Earth's spin are slowed."


// ===========================================================================================
// MODE: J2,2 (Earth-fixed view)
// ===========================================================================================
// speeds: 30, 100, 300 days/s.  home: { az: -90, el: 78, dist: 9 }.  lightDirection: [0.3, -0.4, 1].
// earth.pivot.rotation.z = 0, so longitude L is at (cos L, sin L, 0) with no offset.
// State: { lon0: 30, s: { lon, rate }, t: 0, hold: false, dv: 0, offsetMin: 0, offsetMax: 0 }.
// rebuild(), on any slider or hold change:
//     s = { lon: lon0, rate: 0 }, t = 0, dv = 0, offsets = 0.
//     If lon0 is within 0.01 deg of an unstable longitude, start 0.05 deg east of it.
//     Exactly on a ridge, the satellite would never move, which hides the instability the lesson describes.
// advance: when held, keep lon fixed and add M.eastWestDvPerYear(lon) * dt / 365.25 to dv. Otherwise use M.stepLongitude.
//     Track offsetMin and offsetMax from lon0, using unwrapped values.
//
// Scene:
//     Four "orange slice" wedges at r = 1.02 to GEO_DRAW, translucent RingGeometry, built once. Each spans 90 deg.
//         Centered on -15 and 165: mass excess, warm tint. Centered on 75 and -105: mass deficit, cool tint.
//     Long axis and short axis: thin lines through Earth's center. Labels "Long axis", "Short axis".
//     GEO ring at GEO_DRAW.
//     Stable markers (green rings) and unstable markers (red X, two crossed thin boxes). Labels "Stable 75° E" and so on.
//     Swing arc: thin RingGeometry band on the GEO ring from lon0 + offsetMin to lon0 + offsetMax.
//     Satellite dot.
//     Two ArrowHelpers at the satellite, tangent to the ring. East tangent is (-sin L, cos L, 0).
//         "Acceleration" (unstable color): sign of M.tangentialAccel(lon).
//         "Drift" (stable color): sign of M.longitudeAccel(lon), which is always opposite.
//         Length 0.15 + 0.5 * |sin(2 * (lon - LON22))|. Hide both when |sin| < 0.02.
//         Labels at arrow tips, rank 1. This pair is the main teaching point of the mode.
//
// stats: Elapsed, Longitude, Drift rate (°/day), Offset from GEO (km, from M.semiMajorOffsetKm), Libration period, E-W Δv.
//     E-W Δv reads "<cost> m/s/yr here" when free, and "<dv> m/s spent" when held.
// equations: title "Longitude Drift at GEO". constants: "J₂,₂ = 1.8 × 10⁻⁶, long axis at 15° W, r = 42,164 km."
//     Tangential accel.   a_λ = −6 μ Rₑ² J₂,₂ / r⁴ · sin 2(λ − λ₂,₂)     m/s²
//     Longitude response  λ̈ = −3 a_λ / r                                 deg/day²
//     Nearest stable      Short axis                                     formatLon
//     Libration period    Depends on swing size                          days, with years in the work line
//     E-W station-keeping Δv = 1.715 |sin 2(λ − λ₂,₂)|                   m/s/yr
//
// Chart "Drift Potential W(λ)":
//     x: -180 to 180 deg, ticks every 60. y: M.driftPotential, no numeric ticks.
//     Base: the curve, green circles at wells, red X at ridges, a dashed horizontal line at W(lon0).
//         The dashed line shows the level the swing cannot rise above. Skip it when held.
//     Live: a ball on the curve at the wrapped longitude.
//     Do not label W as energy. The lesson warns against that.
//
// notice: "The equator is slightly elliptical. A push along the orbit raises it, which slows the satellite's motion in longitude, so it drifts the opposite way. Satellites collect on the short axis, not over extra mass."
// hud:
//     Held: "Station-keeping holds this slot, at a small yearly cost."
//     Arrows hidden: "This is an equilibrium point. Acceleration here is zero."
//     Otherwise: "Acceleration points toward the long axis. The drift goes the other way."
// caption: "The ring is not to scale, and the wedges are exaggerated. Earth is shown fixed, so longitude can be read directly."


// ===========================================================================================
// MODE: 3RD BODY
// ===========================================================================================
// speeds: 1, 3, 10 years/s.  home: { az: 20, el: 12, dist: 9 }.  lightDirection: [0.8, 0.3, 0.5].
// State: { body: 'moon', hold: false, t: 0 (years) }. Wrap t at 53.
// sync: tilt = hold ? { incDeg: 0, nodeDeg: 90 } : M.geoTilt(t).
//
// Scene:
//     Ghost ring: equatorial at GEO_DRAW. Real ring: outer.rotation.set(inc, 0, node), as in section B.
//     Body marker at BODY_DIRECTION * 4.6, with a label ("Moon" or "Sun", plus "direction only"). Moon color or Sun color.
//     Differential arrows: 24 ArrowHelpers, pre-allocated, evenly spaced around the real ring.
//         For each point: unit position in the ring's plane. Evaluate M.thirdBodyAccel using true R_GEO and the true body distance.
//         Place at unit * GEO_DRAW. Direction from the result. Length = |a| / 8.68e-6 * 0.9.
//         That fixed divisor is the Moon's peak, so the Sun's arrows are visibly shorter. Do not normalize per body.
//     Satellite on the ring, 90 deg/s, decorative.
//
// stats: Elapsed, Inclination, Tilt rate (deg/yr, or 0 when held), Node, N-S Δv budget (51.4 m/s/yr), Δv spent (51.4 * years when held, otherwise 0).
// equations: title "Sun and Moon at GEO". constants: "Budgets from SMAD, for i = 0."
//     Moon's differential pull   a ≈ 2 μ r / d³          from accelerationsAt(35786).moon
//     Sun's differential pull    a ≈ 2 μ r / d³          from accelerationsAt(35786).sun
//     Combined vs. J₂            1.06 × 10⁻⁵ > 8.33 × 10⁻⁶ m/s²
//     N-S budget                 36.9 + 14.5             51.4 m/s/yr
//     Share of station-keeping   51.4 / (51.4 + 1.715)   96.8%
//
// Chart "Inclination and Ground Trace", split into two plots at 62% of the width:
//     Left: i(t) from 0 to 53 yr, 0 to 16 deg. Live: cursor and dot. When held, a flat line at 0.
//     Right: M.figureEight(i, 120), lat vs lonOffset. Fit both axes to the current i, with a minimum half-range of 0.2 deg.
//         Label "Longitude stretched". Redraw this plot in the live layer, because it changes with i.
//
// notice: "Sun and Moon pull harder on the near side of the orbit than on Earth, and harder on Earth than on the far side. Because they sit off the equator, those differences tilt a GEO orbit by nearly 1° per year."
// hud: "Arrows show only the difference from the pull on Earth." When held: "Station-keeping holds the orbit flat. This is over 95% of station-keeping Δv."
// caption: "Ring, arrows, and body distance are not to scale. The body stays at one direction for clarity."


// ===========================================================================================
// MODE: SRP
// ===========================================================================================
// speeds: 15, 45, 120 days/s.  home: { az: -90, el: 62, dist: 14 }.  lightDirection: toward the Sun, updating.
// State: { area: 'dense', t: 0 (days) }. Wrap t at 365.25.
// Orbit is equatorial. The Sun is at (cos L, sin L, 0), L = M.SUN_RATE * t * 86400.
//
// DISPLAY OF ECCENTRICITY. True e is too small to see, so normalize it, and print the true value.
//     drawnE = (e / (2 * rE)) * { dense: 0.10, arrays: 0.17, foil: 0.28 }[area]
//     The ring's radius function: GEO_DRAW * (1 - drawnE^2) / (1 + drawnE * cos(nu)). Do not use drawRadius here.
//
// Scene:
//     Ghost ring, circular at GEO_DRAW. Real ring, argp = perigeeDeg from M.srpEccVector.
//     Sun sphere, glow sprite, and path at radius 4.8, copied from sun-synchronous.js.
//     Satellite, 90 deg/s, decorative. An ArrowHelper at the satellite pointing directly away from the Sun, labeled "SRP".
//     Perigee dot, label "Perigee". Hide the perigee dot and its label when drawnE < 0.005, because the direction is not meaningful there.
//
// stats: Day of year, Eccentricity, Peak eccentricity, SRP accel, Perigee dip now, Peak perigee dip.
// equations: title "Sunlight on a GEO Satellite". constants: "P = 4.54 × 10⁻⁶ N/m², C_R = 1.3. Circular start, no eclipses."
//     SRP acceleration    a = P C_R (A / m)
//     Yearly circle       r_e = 3a / (2 V Ω_sun)
//     Peak eccentricity   e_max = 2 r_e
//     Perigee dip         Δr = a_orbit · e           km
//     Area-to-mass        A / m                      m²/kg
//
// Chart "Eccentricity Over One Year", split at 62%:
//     Left: e(t), 0 to 365 days, y from 0 to 1.1 * peak. Live: cursor and dot.
//     Right: the circle of the (ex, ey) vector. Live: a dot and a line from the origin.
//
// notice: "Sunlight pushes steadily away from the Sun. Over half a year this stretches the orbit, and over the next half it undoes the stretch. High area-to-mass objects behave like solar sails."
// hud: at foil: "Foil debris is pushed so hard that its perigee drops by thousands of km." Otherwise: "The orbit stretches for half a year, then rounds out again."
// caption: "The shape is exaggerated, so read the true eccentricity in Live Values. The Sun is shown on the equator."


// ===========================================================================================
// Z. FINAL CHECKS AND REGISTRATION
// ===========================================================================================
// Test (see "Before You Finish" in _template/README.md):
//     Run the "pages" server in .claude/launch.json (port 8765) and also open the page from a local file.
//     Sizes: 1920x1080, 1536x730, 1366x768, 1366x650, 1100x800, 820x1180, 390x844, 844x390.
//     Use every control in every mode. Restart, zoom, resize, and switch modes during playback.
//     Check for console errors, sideways scrolling, cut-off text, and overlapping labels.
//     Check the displayed J2 numbers against the lesson's two worked examples, using the presets.
//     Search the page and scripts for the division symbol, and replace any with a slash.
//     Confirm the page contains no identifying information about any person.
//
// Register, only after the tool works. Other work may be under way in index.html and
// README.md, so re-read each one, add only your own lines, and do not reformat. The guide in
// _template/README.md refers to AGENTS.md section 6, but that file is not in this repository, so follow this list:
//     Add a .tool-card to index.html, after the Sun-Synchronous Orbit card, copying its markup.
//         Title: Perturbations Explorer
//         Text:  "Watch drag, J₂, J₂,₂, the Sun and Moon, and sunlight change an orbit, each compared with the two-body orbit it started from."
//         href:  orbits/perturbations.html
//         data-tags: "perturbations drag decay ballistic coefficient solar cycle j2 oblateness nodal precession raan argument of perigee critical inclination molniya j22 geo longitude drift libration station-keeping third body sun moon inclination srp solar radiation pressure eccentricity 3d orbit"
//     Add one line to the tool list in README.md.
//     In the separate OTC-OW-LaTeX repository, add an interactivebox to "Perturbations & Orbit Types.tex", in the
//     style used in "Reference Frames & Time.tex". Ask before making this change, because it is in another repository.
