# What the Settings Screen Changes on Each Page

The Settings screen (`assets/orbit-settings-panel.js`) edits the reader's choices, which `math/settings.js` stores. This file lists every page that loads the screen and says what each setting does there.

## The settings

| Setting | Choices (default first) | Saved in the browser? |
|---|---|---|
| Constants | Course constants, WGS-84 | Yes |
| Propagation | Kepler (two-body), Cowell (numerical) | Yes |
| Solver (Cowell only) | PD78 and RK4 from `propagation/solvers.js`. DP45 and RKF45 stay in the code but are hidden for now (`HIDDEN_SOLVERS` in settings.js) | Yes |
| Forces (Cowell only) | J2; J2,2; drag; Sun; Moon; solar radiation pressure. All off by default. J3 and J4 stay in the code but are hidden for now (`HIDDEN_FORCES` in settings.js) | Yes |
| Start date and time (UTC) | The computer's clock when the page opened, or a typed time | No: each visit starts at the computer's clock |
| Spacecraft (Cowell with drag or SRP on) | C<sub>D</sub> 2.2, C<sub>R</sub> 1.3, area to mass 0.01 m²/kg, average solar activity | No: lasts for the visit |
| Relative motion (RIC) | CW (linear), Exact difference | Yes |
| Axes (Exact only) | Rectilinear, Curvilinear | Yes |
| Also show the CW path (Exact only) | Off, on | Yes |

The two constant sets differ in μ, J2, Earth's spin rate ω<sub>E</sub>, g<sub>0</sub> and the J2,2 term (size and longitude). Earth's radius is 6378.137 km in both. No page uses g<sub>0</sub> today. The differences are small, so most readouts change only in their last digits.

## How a change reaches a page

1. The screen calls `Settings.set()`, which saves the choice and tells every listener.
2. A constants change rebuilds every `OrbitMath` section with the new set (`math/common.js`).
3. The page's `onSettingsChange` (given to `OrbitSettingsPanel.registerPage`) re-reads `OrbitMath` and redraws.
4. Moving satellites go through `math/propagation/propagate.js`, which follows the propagator, solver, forces, start time and spacecraft. Relative motion goes through `math/relative-motion/rpo.js`, which follows the RIC model.

The settings never change the formulas a page prints. Where a page shows two-body or CW results, those stay two-body or CW; Cowell and the exact model change only what is flown and drawn moving. When Cowell is chosen, the screen shows the page's own note saying this (its `modelNote`, quoted below).

## Page by page

Legend: **Yes** = the setting changes what the page shows. **—** = no effect.

| Page | Constants | Propagation, solver, forces | Start time | Spacecraft | RIC model, axes, CW path |
|---|---|---|---|---|---|
| Home (`index.html`) | Sets it | Sets it | Sets it | Sets it | Sets it |
| Frame Observatory | Yes | Yes | With Cowell | With Cowell + drag/SRP | — |
| Solar vs. Sidereal Day | — | — | — | — | — |
| Ground Track | Yes | Moving satellite only | Yes, with Cowell or the page's Start date view | With Cowell + drag/SRP | — |
| Inertial Rendezvous | Yes | Chase flies the plan | With Cowell | With Cowell + drag/SRP | — |
| Mechanical Energy | Yes | Satellite and its readouts | With Cowell | With Cowell + drag/SRP | — |
| Orbit Equation | Yes | Satellite and its r, v | With Cowell | With Cowell + drag/SRP | — |
| Orbital Elements | Yes | Satellite and the elements read back | With Cowell | With Cowell + drag/SRP | — |
| Orbital Maneuvers | Yes | Transfer flown after burn 1 | With Cowell | With Cowell + drag/SRP | — |
| Perturbations | Yes | — | — | — | — |
| Sun-Synchronous | Yes | — | — | — | — |
| Burn Sandbox | Yes | Target always; chase with Exact | With Cowell | With Cowell + drag/SRP | Yes |
| Relative Motion Explorer | Yes | With Exact, and in COE mode | With Cowell | With Cowell + drag/SRP | Yes |
| Test 1 Practice | — | — | — | — | — |
| Test 2 Practice | — | — | — | — | — |

### Home page

`index.html` has a Settings button in its nav bar (marked `data-orbit-settings`). It opens the same screen and changes the settings every tool reads. It has no Share button, since there is no page state to share.

### Frames and Time

**Frame Observatory** (`tools/frames-and-time/frame-observatory/`)
- Constants: μ, Earth's radius and ω<sub>E</sub> feed the orbits and the ECEF rotation. The scenario is rebuilt on any change.
- Cowell: both spacecraft move under the chosen forces from their starting r and v.
- Note shown: "With Cowell, both spacecraft move under the chosen forces from their starting r and v."

**Solar vs. Sidereal Day** (`tools/frames-and-time/solar-sidereal-day/`)
- No setting changes this page. Its math uses only the shared time constants (day length and tropical year), which are the same in both sets.
- Note shown: "This page has no satellite, and its day and year lengths are the same under both constant sets, so no setting changes it."

### Inertial Frame

**Ground Track** (`tools/inertial-frame/ground-track/`)
- Constants: μ and ω<sub>E</sub> change the drawn track, its nodes and Δλ. The track is two-body, so J2 does not move it.
- Cowell: only the moving satellite follows the chosen forces and can drift from the drawn track. The track, nodes and Δλ stay two-body.
- Start time: the only page that uses it without Cowell. When Earth is turned to the start date, the start time sets Earth's angle (GMST) and the date label, and the screen shows the time field.
- Note shown: "The drawn track, its nodes and Δλ are the two-body track the lesson uses. With Cowell, the moving satellite follows the chosen forces and can drift from that track."

**Inertial Rendezvous** (`tools/inertial-frame/inertial-rendezvous/`)
- Constants: μ changes the plans and timings.
- Cowell: plans are still solved two-body. The chase flies the plan under the chosen forces, and the page shows how far it misses at arrival.
- Note shown: "Plans are solved two-body. With Cowell and forces on, the chase flies the plan under those forces, and the page shows how far it misses at arrival."

**Mechanical Energy** (`tools/inertial-frame/mechanical-energy/`)
- Constants: μ changes the energy values.
- Cowell: the satellite and its readouts follow its own motion, so drag shows energy draining away. The drawn orbit stays two-body.
- Note shown: "The energy formulas are two-body. With Cowell, the satellite and its readouts follow its own motion, so drag shows energy draining away; the drawn orbit stays the two-body one."

**Orbit Equation** (`tools/inertial-frame/orbit-equation/`)
- Constants: μ changes the speeds and period.
- Cowell: the satellite can drift off the drawn ellipse, and r and v are read from its own motion.
- Note shown: "The equations on this page are two-body. With Cowell, the satellite moves under the chosen forces and can drift off the drawn ellipse; r and v are read from its own motion."

**Orbital Elements** (`tools/inertial-frame/orbital-elements/`)
- Constants: μ changes the speeds and period; ω<sub>E</sub> changes Earth's turning.
- Cowell: the sliders set the starting orbit; the elements read back from r and v change as the satellite moves under the forces.
- Note shown: "The sliders set the orbit at the start. With Cowell, the satellite moves under the chosen forces, and the elements read back from r and v change as it does."

**Orbital Maneuvers** (`tools/inertial-frame/orbital-maneuvers/`)
- Constants: μ changes the Δv values and transfer times.
- Cowell: the Δv values stay two-body. The transfer is flown under the forces after burn 1 and can arrive a little off the target orbit.
- Note shown: "The Δv values are the two-body solutions. With Cowell, the transfer is flown under the chosen forces after burn 1, so it can arrive a little off the target orbit."

**Perturbations** (`tools/inertial-frame/perturbations/`)
- Constants: μ, J2 and the J2,2 size and longitude change the averaged (secular) rates and charts. Every mode is rebuilt on a change.
- Propagation: no effect. The page shows the averaged formulas.
- Note shown: "This page shows the averaged (secular) formulas the lesson teaches. The propagator setting does not change them."

**Sun-Synchronous** (`tools/inertial-frame/sun-synchronous/`)
- Constants: μ and J2 change the nodal rate, the sun-synchronous inclination and the node time.
- Propagation: no effect.
- Note shown: "This page shows the J₂ formulas the lesson teaches: nodal rate, inclination and node time. The propagator setting does not change them."

### Relative Frame

**Burn Sandbox** (`tools/relative-frame/burn-sandbox/`)
- Constants: μ changes the target's mean motion and so every CW path.
- Cowell: the target moves under the chosen forces.
- RIC model: with CW, the chase's relative motion is the CW model. With Exact, the chase is flown too, its burns included, and the difference is drawn in the chosen axes (rectilinear or curvilinear). The CW path can be drawn alongside.
- Any change clears the stored burn results and restarts the time window.
- Note shown: "With Cowell, the target moves under the chosen forces. With the exact RIC model the chase does too, and its burns are flown; with CW the relative motion is the CW model."

**Relative Motion Explorer** (`tools/relative-frame/relative-motion-explorer/`)
- Constants: μ changes the mean motion and so the CW path and the RMOEs.
- RIC model: with CW, the path comes from the CW equations and Cowell does nothing. With Exact, both spacecraft are flown and their difference drawn in the chosen axes, with the CW path alongside if asked for.
- COE mode always uses the exact model, so Cowell changes it whatever the RIC setting.
- Note shown: "Cowell changes this page only when Relative motion is set to Exact difference: then both spacecraft fly under these forces. With CW, the path comes from the CW equations, so these settings do not change it."

### Study

**Test 1 Practice** and **Test 2 Practice** (`study/test-1-practice/`, `study/test-2-practice/`)
- No setting changes these pages. They do not load `OrbitMath`; they use `math/practice-common.js`, which always uses the course constants, two-body motion and CW.
- The screen opens greyed out with the note: "Test 1 and Test 2 Practice always use the course material: course constants, two-body motion, and CW."
- A shared link opened here does not apply its settings.

## Share links

On every tool page, Copy share link stores all of the settings above (the start time included, as the instant the page is showing) plus the page's own options. Opening the link applies them for that visit only, until the reader presses Keep these settings. Frame Observatory, Inertial Rendezvous and Orbital Maneuvers save their own page options; every other page saves its inputs and button groups.

## Keeping this file current

Update this file when a page is added, when a page's `onSettingsChange` or `modelNote` changes, or when a setting is added to `math/settings.js`.
