# The Math Folder

This folder holds the math that more than one page uses. Math that only one page uses lives in that page's folder, in `<page>-math.js`, and moves here once a second page needs it. Nothing here touches the page, so the tests in `_tests/` run every file in Node.

## Files

| File | What it is for |
|---|---|
| `index.js` | Loads the shared files for Node, in the order pages must load them. Each page lists the same files in its script loader, and a test checks that the order matches. |
| `settings.js` | The reader's choices for the whole site: constant set, propagator, solver, forces, RIC model, start time and spacecraft. It sets their defaults and saves them in the browser. |
| `common.js` | Vector helpers, angle conversions and Kepler's equation. It also builds every math section (`OrbitMath.<section>`) and rebuilds them all when the reader switches constant sets. |
| `time.js` | Julian dates, sidereal time, and the positions of the Sun and Moon. |
| `elements.js` | Converts classical orbital elements to position and velocity, and back. |
| `practice-common.js` | The math that Test 1 and Test 2 Practice share, written as the course teaches it. It keeps its own copy of each equation and always uses the course constants, so the tests can check it against the tools' math. |

## Folders

### `constants/`

Every number the math uses, each with its source.

| File | What it is for |
|---|---|
| `course.js` | The course constant set, used by default: the values on the equation sheet and in the lessons. |
| `wgs84.js` | The WGS-84 constant set, the alternative the reader can choose in Settings. |
| `shared.js` | The numbers that stay the same under either set: time, the gravity terms beyond J2, the Sun and Moon, the atmosphere, the rounded figures the lessons print, and limits. |

### `motion/`

Moving a satellite through time.

| File | What it is for |
|---|---|
| `kepler.js` | The default propagator: exact two-body motion. |
| `cowell.js` | The alternative propagator, Cowell's method, which steps the orbit forward with whatever perturbations are turned on. |
| `solvers.js` | The four Runge-Kutta solvers Cowell's method can use, as coefficient tables, each with its source. |
| `perturbations.js` | The seven perturbing forces Cowell's method can include: J2, J3 and J4, J2,2, drag, the Sun, the Moon and solar radiation pressure. All are off by default. |
| `propagate.js` | Moves a satellite with the propagator the reader chose. Every page that draws a moving satellite uses it. |

### `relative/`

One spacecraft's motion as seen from another, in the target's RIC frame.

| File | What it is for |
|---|---|
| `cw.js` | The default model, the Clohessy-Wiltshire equations, with the relative motion orbital elements (RMOEs) and the burn rules of thumb. |
| `exact.js` | The exact model: both spacecraft propagated on their own and their difference turned into RIC. |
| `rpo.js` | Joins the two models into `OrbitMath.rpo`, the section pages use, and adds the RMOEs from two element sets, the example orbits and number formatting. |
