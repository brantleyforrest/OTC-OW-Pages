// Records the first problems of every Test 1 and Test 2 Practice section, with a fixed seed, so a
// change to the math can be checked for changed answers.
//   node _tests/golden/capture-practice.js <out.json> [site root]   write a snapshot
//   node _tests/golden/compare.js <a.json> <b.json>                   compare two snapshots
// The site root defaults to this checkout; pass another folder to snapshot an older copy.
// Loading follows the practice pages: whatever math files they load are loaded here first.
const fs = require('node:fs');
const path = require('node:path');

const out = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..', '..'));
if (!out) { console.error('usage: capture-practice.js <out.json> [site root]'); process.exit(2); }

globalThis.window = globalThis;
const COUNT = 60;

// Load the scripts a practice page lists, in order, skipping drawing-only files.
function pageScripts(html) {
    const text = fs.readFileSync(path.join(root, html), 'utf8');
    const list = [...text.matchAll(/'([A-Za-z0-9_./-]+\.js)'/g)].map((m) => m[1]);
    return list.filter((f) => !/vendor|tool-kit|earth-land|earth-scene|scene\.js$|views\.js$|practice\.js$|release\.js$|matching\.js$/.test(f) || /law-matching/.test(f))
        .map((f) => path.join(root, path.dirname(html), f));
}

function seedRandom(s) {
    let seed = s;
    Math.random = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clean(value) {
    return JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'function' ? undefined : v)));
}

const snapshot = {};
function record(name, make) {
    seedRandom(20261119);
    const list = [];
    for (let k = 0; k < COUNT; k++) {
        try { list.push(clean(make(k))); } catch (err) { list.push({ error: String(err.message || err) }); }
    }
    snapshot[name] = list;
}

for (const html of ['practice/test-1-practice.html', 'practice/test-2-practice.html']) {
    for (const file of pageScripts(html)) require(file);
}
const G = globalThis;

// Test 1
record('rv-coe', () => G.RvCoeProblems.generate());
record('coe-box', () => G.Test1CoeBoxProblems.generate());
record('maneuver', (k) => G.Test1ManeuverProblems.generate(G.Test1ManeuverProblems.types[k % G.Test1ManeuverProblems.types.length]));
record('rendezvous', (k) => G.Test1RendezvousProblems.generate(G.Test1RendezvousProblems.types[k % G.Test1RendezvousProblems.types.length]));
record('tof', (k) => G.Test1TofProblems.generate(G.Test1TofProblems.types[k % G.Test1TofProblems.types.length]));
record('ground-track', (k) => G.Test1GroundTrackProblems.generate(G.Test1GroundTrackProblems.types[k % G.Test1GroundTrackProblems.types.length]));
record('propulsion', (k) => G.Test1PropulsionProblems.generate(null, G.Test1PropulsionProblems.templates[k % G.Test1PropulsionProblems.templates.length]));
record('laws', () => G.Test1LawMatching.laws);

// Test 2
const T2 = (name) => G[name];
record('t2-coeric', (k) => T2('Test2CoericProblems').generate(['in-plane', 'cross', 'both', 'random'][k % 4]));
record('t2-vis-state', (k) => T2('Test2VisStateProblems').generate(['in-plane', 'cross', 'random'][k % 3]));
record('t2-vis-rmoe', (k) => T2('Test2VisRmoeProblems').generate(['in-plane', 'cross', 'random'][k % 3]));
record('t2-rmoe', (k) => T2('Test2RmoeProblems').generate(k % 2 ? 'forward' : 'reverse'));
record('t2-burns', (k) => T2('Test2BurnsProblems').generate(k % 2 ? 'drawing' : 'burn'));

fs.writeFileSync(out, JSON.stringify(snapshot));
const total = Object.values(snapshot).reduce((s, l) => s + l.length, 0);
const errors = Object.values(snapshot).flat().filter((p) => p && p.error).length;
console.log(`wrote ${Object.keys(snapshot).length} sections, ${total} problems, ${errors} errors -> ${out}`);
