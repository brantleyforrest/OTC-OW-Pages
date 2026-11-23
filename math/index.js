// index.js
// For Node (the tests): loads the shared math in the order pages must load it, and returns
// OrbitMath. Pages list the same files in their script loaders, in this order (the cache-busting
// test checks). A page's own <page>-math.js comes after them.
//
//   constants/shared.js, course.js, wgs84.js         every number, and the two constant sets
//   propagation/solvers.js                           the solver setting's tableaus
//   settings.js                                      the reader's choices and their store
//   common.js                                        vectors, angles, Kepler's equation, sections
//   time.js, elements.js                             time and the Sun and Moon; elements and r, v
//   propagation/kepler.js, perturbations.js,
//     cowell.js                                      the two propagators and Cowell's forces
//   propagation/propagate.js                         satellites moved by the propagator setting
//   relative-motion/cw.js, exact.js, rpo.js          the two relative motion models, joined
//
// Practice pages load the first five files, then practice-common.js, instead of the rest.
'use strict';

const FILES = [
    'constants/shared.js', 'constants/course.js', 'constants/wgs84.js',
    'propagation/solvers.js', 'settings.js', 'common.js', 'time.js', 'elements.js',
    'propagation/kepler.js', 'propagation/perturbations.js', 'propagation/cowell.js', 'propagation/propagate.js',
    'relative-motion/cw.js', 'relative-motion/exact.js', 'relative-motion/rpo.js'
];
const PRACTICE_FILES = [...FILES.slice(0, 5), 'practice-common.js'];

if (!globalThis.OrbitMath) for (const f of FILES) require('./' + f);
module.exports = globalThis.OrbitMath;
Object.defineProperty(module.exports, 'FILES', { value: Object.freeze(FILES) });
Object.defineProperty(module.exports, 'PRACTICE_FILES', { value: Object.freeze(PRACTICE_FILES) });
