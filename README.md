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

---

## Technical Architecture

* **Framework-Free:** Built using clean, native client-side web technologies (HTML5, responsive CSS, WebGL/Canvas, and vanilla JavaScript). The 3D tool loads Three.js from a CDN, so it needs an internet connection.
* **Fast & Self-Contained:** Runs entirely in any standard modern web browser without requiring node build pipelines, backend servers, or external logins.
* **Local Execution:** To run locally, simply clone the repository and open `index.html` in a web browser:
  ```bash
  git clone https://github.com/brantleyforrest/OTC-OW-Pages.git
  cd OTC-OW-Pages
  # Open index.html in your preferred browser
  ```

---

## Data Credits

Land outlines in `assets/earth-land.js` are derived from [Natural Earth](https://www.naturalearthdata.com/) 1:110m data, which is in the public domain.

---

## Disclaimer

These tools are developed strictly for academic, educational, and coursework study purposes.
