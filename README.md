# OTC-OW: Interactive Astrodynamics & Orbital Mechanics Tools

An open collection of interactive 3D visualizers, coordinate reference frame simulators, and astrodynamics calculators designed to reinforce spatial intuition and mathematical foundations in orbital mechanics.

---

## Live Deployment

The interactive tools and 3D visualizers are accessible via GitHub Pages:
**[https://brantleyforrest.github.io/OTC-OW-Pages/](https://brantleyforrest.github.io/OTC-OW-Pages/)**

---

## Overview

Three-dimensional orbital motion, celestial geometry, and rotating reference frames can be challenging to visualize using equations and static 2D diagrams alone. This suite provides lightweight, interactive web tools to simulate spatial geometry, manipulate parameters in real time, and bridge mathematical theory with physical intuition.

---

## Current Status

The web portal is established at `index.html`. The following tools are available:

* **[Reference Frame Observatory](frames/frame-observatory.html):** An animated 3D view of one Earth and two spacecraft, seen from the ECI, ECEF, and RIC reference frames.
* **[Solar vs. Sidereal Day Visualizer](time/solar-sidereal-day.html):** A view from above the North Pole showing why a solar day is longer than a sidereal day.
* **[Orbital Equation Explorer](orbits/orbit-equation.html):** A 3D view of an orbit around Earth, with each parameter of the orbit equation set by hand or animated through its range.
* **[Ground Track Visualizer](orbits/ground-track.html):** A split view of an orbit in 3D and its ground track on a world map.
* **[Sun-Synchronous Orbit](orbits/sun-synchronous.html):** A 3D view of a year of orbit motion, comparing a sun-synchronous orbit with a polar orbit.
* **[Perturbations Explorer](orbits/perturbations.html):** A 3D view of drag, J₂, J₂,₂, third-body gravity, and solar radiation pressure, each compared with the two-body orbit it started from.
* **[Orbital Maneuvers](orbits/orbital-maneuvers.html):** An interactive 3D visualizer of Hohmann transfers, simple plane changes, and combined maneuvers with live equations and a delta-V budget (loads KaTeX from a CDN).
* **[Inertial Rendezvous](orbits/inertial-rendezvous.html):** An interactive 3D visualizer for coplanar and co-orbital orbital rendezvous in the inertial (ECI) frame with live equations and a trade panel (loads KaTeX from a CDN).
* **[Relative Motion Explorer](rpo/relative-motion-explorer.html):** Replaces Relative Motion: Two Views and the RMOE Explorer (their old addresses, `rpo/two-views.html` and `rpo/rmoe-explorer.html`, now redirect here). Sets relative motion two ways (three ways in dev mode at `?dev`: classical orbital elements with the exact model), the six RMOEs (the course model, with sliders), or chase's RIC position and velocity (with each RMOE worked from it), and switching keeps the motion (`OrbitMath.rpo.rmoeFromCoes` and its inverse `OrbitMath.rpo.coesFromRmoe`). Its presets and slider ranges are data tables at the top of `rpo/relative-motion-explorer.js`.
* **[RIC Burn Sandbox](rpo/burn-sandbox.html):** Fire radial, in-track, and cross-track burns at chase (from rest at the target, a perch, or an NMC), coast to the next corner or plane crossing, and see the RMOEs before and after each burn with the rule of thumb that applies, the four basic burns side by side, and natural against forced motion with costs worked out from the CW equations.

The Study tab links to:
* **[Test 1 Practice](practice/test-1-practice.html):** Generated practice problems in several sections, classical orbital elements from state vectors, COE box problems (check all of 14 boxes, such as polar orbit, s/c on the j axis only, or s/c at apogee, that fit a set of COEs), orbital maneuvers (Hohmann transfers, simple plane changes, and combined plane changes), coplanar and co-orbital rendezvous, time of flight with D = RT (time to sweep an angle, or position after a time), and ground tracks (the period, semi-major axis, eccentricity, inclination, argument of perigee, and true anomaly read from the ground track of a standard orbit on a world map), with answer checking and a 3D walkthrough in which the satellite moves along with the steps. A fifth section matches Kepler's three laws and Newton's four laws to their statements or equations on cards.
* **[Test 2 Practice](practice/test-2-practice.html):** Generated practice problems on relative motion: naming the RIC axes in a drawing of the target's orbit, the relative motion (and the pair of RIC plots) that follows from the orbital elements of a target and a chase, and the assumptions behind the CW equations, with card-matching drills for the RIC frame, the RMOEs, element differences, and burn directions. Each section is one problem module, `practice/test-2-<section>-problems.js`; `node _tests/test-2-problems.test.js` checks 200 problems per section. The public page shows only the sections listed in `practice/test-2-release.js`; `test-2-practice.html?dev` (what the index opens in dev mode) shows every built section.

---

## Technical Architecture

* **Framework-Free:** Built using clean, native client-side web technologies (HTML5, responsive CSS, WebGL/Canvas, and vanilla JavaScript). Three.js, KaTeX, and the fonts load from `vendor/` when it exists and from a CDN otherwise. To work offline, run `python scripts/fetch_vendor.py` once to download them.
* **One Place for the Math:** Every orbital constant is in `assets/orbit-constants.js` and every formula the tools use is in `assets/orbit-math.js` (`window.OrbitMath`); page scripts only draw. Every satellite is stored as a position and velocity and moved by `OrbitMath.propagate`. The Settings button in the home page's nav bar, and the Model badge in each tool's top bar, open the same settings popup: the constants (course values by default, or WGS-84), the propagator (Kepler two-body by default, or Cowell's method with a choice of four integrators and seven forces: J₂, J₃ and J₄, J₂,₂, drag, the Sun, the Moon and solar radiation pressure), the start date and time, and the relative-motion model (the linear CW equations by default, or the exact difference of the two orbits, in rectilinear or curvilinear axes). Settings are kept in the browser, and Share copies a link that opens a page with the same settings and options. The practice pages always use the course material, with their own math in `practice/test-review-math.js`; the tests in `_tests/` check the two math files against each other.
* **Fast & Self-Contained:** Runs entirely in any standard modern web browser without requiring node build pipelines, backend servers, or external logins.
* **Local Execution:** To run locally, simply clone the repository and open `index.html` in a web browser:
  ```bash
  git clone https://github.com/brantleyforrest/OTC-OW-Pages.git
  cd OTC-OW-Pages
  # Open index.html in your preferred browser
  ```

---

## Contributing

Before your first commit, install the image pre-commit hook. Git does not copy hooks when a repository is cloned, so each contributor must run this once per clone. Python 3 is required.

```bash
python scripts/backend/image_tools_backend.py --install-hook
```

After that, each commit automatically compresses any staged PNG, JPEG, or WebP images and stages the smaller versions, including commits made in GitHub Desktop. The hook never blocks a commit. If the Pillow image library is missing, the script tries to install it with `pip`.

On Windows, `scripts\RUN_IMAGE_TOOLS.bat` opens a menu with the other image tools, where option 4 shows whether the hook is active. The menu's prune option rewrites Git history, so do not use it unless a maintainer has asked you to.

---

## Data Credits

Land outlines in `assets/earth-land.js` are derived from [Natural Earth](https://www.naturalearthdata.com/) 1:110m data, which is in the public domain.

---

## Disclaimer

These tools are developed strictly for academic, educational, and coursework study purposes.

---

## License

Copyright (C) 2026 Brantley Forrest and Grant Nehls

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU General Public License](LICENSE) for more details.
