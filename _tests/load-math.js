// Loads all of the site's math for a test, as the pages would: the shared files (math/index.js),
// the practice math (math/practice-common.js), and every page's own math file, found by the page
// folder rule: <folder>/<folder>-math.js. Returns OrbitMath; the practice math is
// globalThis.TestReviewMath.
//   const OM = require('./load-math.js');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OM = require('../math/index.js');
require('../math/practice-common.js');

// Page folders are anywhere under tools/ and study/: tools/inertial-frame/ground-track/,
// study/test-1-practice/, ... The template (tools/_template/) is skipped.
const PAGE_MATH = [];
function scan(dir) {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        if (!entry.isDirectory() || /^[._]/.test(entry.name)) continue;
        const sub = `${dir}/${entry.name}`;
        if (fs.existsSync(path.join(ROOT, sub, `${entry.name}-math.js`))) PAGE_MATH.push(`${sub}/${entry.name}-math.js`);
        scan(sub);
    }
}
scan('tools');
scan('study');
for (const file of PAGE_MATH) require(path.join(ROOT, file));

Object.defineProperty(OM, 'PAGE_MATH', { value: Object.freeze(PAGE_MATH) });
module.exports = OM;
