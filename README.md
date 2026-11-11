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
* **[Orbital Maneuvers](orbits/orbital-maneuvers.html):** An interactive 3D visualizer of Hohmann transfers, simple plane changes, and combined maneuvers with live equations and a delta-V budget (loads KaTeX from a CDN).

The Study tab links to:
* **[Test 1 Practice](practice/test-1-practice.html):** Generated practice problems in two sections, classical orbital elements from state vectors and orbital maneuvers (Hohmann transfers, simple plane changes, and combined plane changes), with answer checking and a 3D walkthrough in which the satellite moves along with the steps.

---

## Technical Architecture

* **Framework-Free:** Built using clean, native client-side web technologies (HTML5, responsive CSS, WebGL/Canvas, and vanilla JavaScript). The 3D tool loads Three.js from a CDN, so it needs an internet connection. Test 1 Practice also loads KaTeX from a CDN to render its math.
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
