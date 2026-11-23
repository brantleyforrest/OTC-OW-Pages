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

* **[Reference Frame Observatory](tools/frames-and-time/frame-observatory/):** An animated 3D view of one Earth and two spacecraft, seen from the ECI, ECEF, and RIC reference frames.
* **[Solar vs. Sidereal Day Visualizer](tools/frames-and-time/solar-sidereal-day/):** A view from above the North Pole showing why a solar day is longer than a sidereal day.
* **[Orbital Equation Explorer](tools/inertial-frame/orbit-equation/):** A 3D view of an orbit around Earth, with each parameter of the orbit equation set by hand or animated through its range.
* **[Ground Track Visualizer](tools/inertial-frame/ground-track/):** A split view of an orbit in 3D and its ground track on a world map.
* **[Sun-Synchronous Orbit](tools/inertial-frame/sun-synchronous/):** A 3D view of a year of orbit motion, comparing a sun-synchronous orbit with a polar orbit.
* **[Perturbations Explorer](tools/inertial-frame/perturbations/):** A 3D view of drag, J₂, J₂,₂, third-body gravity, and solar radiation pressure, each compared with the two-body orbit it started from.
* **[Orbital Maneuvers](tools/inertial-frame/orbital-maneuvers/):** An interactive 3D visualizer of Hohmann transfers, simple plane changes, and combined maneuvers with live equations and a delta-V budget (loads KaTeX from a CDN).
* **[Inertial Rendezvous](tools/inertial-frame/inertial-rendezvous/):** An interactive 3D visualizer for coplanar and co-orbital orbital rendezvous in the inertial (ECI) frame with live equations and a trade panel (loads KaTeX from a CDN).
* **[Relative Motion Explorer](tools/relative-frame/relative-motion-explorer/):** Replaces Relative Motion: Two Views and the RMOE Explorer. Sets relative motion two ways (three ways in dev mode at `?dev`: classical orbital elements with the exact model), the six RMOEs (the course model, with sliders), or chase's RIC position and velocity (with each RMOE worked from it), and switching keeps the motion (`OrbitMath.rpo.rmoeFromCoes` and its inverse `OrbitMath.rpo.coesFromRmoe`). Its presets and slider ranges are data tables at the top of `tools/relative-frame/relative-motion-explorer/relative-motion-explorer.js`.
* **[RIC Burn Sandbox](tools/relative-frame/burn-sandbox/):** Fire radial, in-track, and cross-track burns at chase (from rest at the target, a perch, or an NMC), coast to the next corner or plane crossing, and see the RMOEs before and after each burn with the rule of thumb that applies, the four basic burns side by side, and natural against forced motion with costs worked out from the CW equations.

The Study tab links to:
* **[Test 1 Practice](study/test-1-practice/):** Generated practice problems in several sections, classical orbital elements from state vectors, COE box problems (check all of 14 boxes, such as polar orbit, s/c on the j axis only, or s/c at apogee, that fit a set of COEs), orbital maneuvers (Hohmann transfers, simple plane changes, and combined plane changes), coplanar and co-orbital rendezvous, time of flight with D = RT (time to sweep an angle, or position after a time), and ground tracks (the period, semi-major axis, eccentricity, inclination, argument of perigee, and true anomaly read from the ground track of a standard orbit on a world map), with answer checking and a 3D walkthrough in which the satellite moves along with the steps. A fifth section matches Kepler's three laws and Newton's four laws to their statements or equations on cards.
* **[Test 2 Practice](study/test-2-practice/):** Homework-style relative motion problems in the RIC frame: the signs of chase's position and velocity from two element sets, picturing the motion from a position and velocity or from RMOEs (drawn on paper, then checked against the answer), converting between position and velocity and RMOEs, and the motion after a +R, −R, +I, or −I burn. Two extra sections, Visualize from COEs and RMOE Propagation, go beyond the six test topics. Practice mode walks through the steps beside the picture; Test mode accepts answers only, then shows the solution. Each section is a problem module, `study/test-2-practice/test-2-<section>-problems.js`; `node _tests/test-2-problems.test.js` checks 200 problems per section. The public page shows the sections listed in `study/test-2-practice/test-2-release.js` (all of them); `study/test-2-practice/?dev` shows every built section.

---

## Technical Architecture

* **Folders Mirror the Site:** The tools are in `tools/`, one folder per lesson as the index groups them (`relative-frame/`, `inertial-frame/`, `frames-and-time/`), and the practice tests are in `study/`. Each page is a folder, such as `tools/inertial-frame/ground-track/`, holding `index.html`, the page script (`ground-track.js`) and its own math (`ground-track-math.js`). Files that pages in more than one section share are in `assets/` (scripts and styles) and `math/` (formulas); `study/answer-check.js` is shared by the practice tests only. Browser check pages are in `_tests/`, and the template for a new tool in `tools/_template/`.

* **Framework-Free:** Built using clean, native client-side web technologies (HTML5, responsive CSS, WebGL/Canvas, and vanilla JavaScript). The fonts and KaTeX are hosted with the site in `vendor/`, each with its license. Three.js loads from `vendor/three/` when it exists and from a CDN otherwise; to work offline, run `python scripts/fetch_vendor.py` once to download it.
* **Where the Math Lives:** Every orbital constant is in `math/constants/` (`course.js`, `wgs84.js` and `shared.js`). Math that several pages use is in `math/` (`window.OrbitMath`): vectors, angles and Kepler's equation in `common.js`, the two propagators, the solvers and the forces in `math/motion/`, and the two relative-motion models in `math/relative/`; `math/index.js` lists the files in load order. Math that only one page uses is in that page's folder, in `<page>-math.js`, and moves to `math/` once a second page needs it. Page scripts only draw. Every satellite is stored as a position and velocity and moved by `OrbitMath.propagate`. The Settings button in the home page's nav bar, and the Model badge in each tool's top bar, open the same settings popup: the constants (course values by default, or WGS-84), the propagator (Kepler two-body by default, or Cowell's method with a choice of four integrators and seven forces: J₂, J₃ and J₄, J₂,₂, drag, the Sun, the Moon and solar radiation pressure), the start date and time, and the relative-motion model (the linear CW equations by default, or the exact difference of the two orbits, in rectilinear or curvilinear axes). Settings are kept in the browser, and Share copies a link that opens a page with the same settings and options. The practice pages always use the course material, with their own math (`math/practice-common.js` and each practice page's `<page>-math.js`); the tests in `_tests/` check the practice math and the tools' math against each other.
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
python scripts/image_tools_backend.py --install-hook
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
