// Compares two snapshots from capture-practice.js (or any JSON). Numbers may differ by a relative
// tolerance (default 1e-12); numbers inside text are compared the same way, so "6778.137 km" and
// "6778.137000000001 km" match. Prints the first differences and exits 1 if any are found.
//   node _tests/golden/compare.js <a.json> <b.json> [relative tolerance]
const fs = require('node:fs');

const [aPath, bPath, tolArg] = process.argv.slice(2);
const tol = tolArg ? Number(tolArg) : 1e-12;
const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));

const diffs = [];
const closeNum = (x, y) => x === y || Math.abs(x - y) <= tol * Math.max(Math.abs(x), Math.abs(y), 1e-300);
const NUM = /-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi;
function closeText(x, y) {
    if (x === y) return true;
    const sx = x.split(NUM), sy = y.split(NUM);
    if (sx.length !== sy.length || sx.some((s, i) => s !== sy[i])) return false;
    const nx = x.match(NUM) || [], ny = y.match(NUM) || [];
    return nx.every((n, i) => closeNum(Number(n), Number(ny[i])));
}
function walk(x, y, where) {
    if (diffs.length > 40) return;
    if (typeof x === 'number' && typeof y === 'number') { if (!closeNum(x, y)) diffs.push(`${where}: ${x} vs ${y}`); return; }
    if (typeof x === 'string' && typeof y === 'string') { if (!closeText(x, y)) diffs.push(`${where}: ${JSON.stringify(x).slice(0, 160)}\n      vs ${JSON.stringify(y).slice(0, 160)}`); return; }
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') { if (x !== y) diffs.push(`${where}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); return; }
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) walk(x[k], y[k], `${where}.${k}`);
}
walk(a, b, '$');
if (diffs.length) {
    console.log(`${diffs.length}${diffs.length > 40 ? '+' : ''} differences:`);
    diffs.slice(0, 40).forEach((d) => console.log('  ' + d));
    process.exit(1);
}
console.log('snapshots match');
