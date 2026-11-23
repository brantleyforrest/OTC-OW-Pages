// Run with: node _tests/cache-busting.test.js
// Verifies that all HTML pages across the website have Cache-Control headers
// and do not load local scripts without cache busting.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
    let files = [];
    for (const f of fs.readdirSync(dir)) {
        if (f === 'node_modules' || f === '.git') continue;
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) files = files.concat(walk(full));
        else if (f.endsWith('.html')) files.push(full);
    }
    return files;
}

const rootDir = path.join(__dirname, '..');
const htmlFiles = walk(rootDir);

let passed = 0;
let failed = 0;

function check(name, fn) {
    try {
        fn();
        passed++;
        console.log('ok    ' + name);
    } catch (err) {
        failed++;
        console.log('FAIL  ' + name + '\n      ' + err.message);
    }
}

for (const file of htmlFiles) {
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');

    check(`${rel} has Cache-Control meta tag in head`, () => {
        assert.ok(content.includes('http-equiv="Cache-Control"'), 'Missing http-equiv="Cache-Control"');
        assert.ok(content.includes('http-equiv="Pragma"'), 'Missing http-equiv="Pragma"');
        assert.ok(content.includes('http-equiv="Expires"'), 'Missing http-equiv="Expires"');
    });

    check(`${rel} does not contain static un-busted local script tags`, () => {
        const matches = content.match(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>/gi) || [];
        for (const tag of matches) {
            const srcMatch = tag.match(/src=["']([^"']+)["']/i);
            if (!srcMatch) continue;
            const src = srcMatch[1];
            // External CDN scripts are allowed
            if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')) {
                continue;
            }
            // If local script, it must have ?t=
            assert.ok(src.includes('?t='), `Found un-busted local script tag: ${tag}`);
        }
    });
}

check('tools/_template/tool-template/index.html sets up cache-busting for all new pages', () => {
    const tpl = fs.readFileSync(path.join(rootDir, 'tools/_template/tool-template/index.html'), 'utf8');
    assert.ok(tpl.includes('Date.now()'), 'Template must use Date.now() cache-busting loader');
    assert.ok(tpl.includes('http-equiv="Cache-Control"'), 'Template must include Cache-Control meta');
});

check('tools/_template/README.md documents the cache-busting rule for new tools', () => {
    const readme = fs.readFileSync(path.join(rootDir, 'tools/_template/README.md'), 'utf8');
    assert.ok(readme.includes('cache-busting'), 'README must mention cache-busting');
});

// The site guide is a local file that is not committed, so a fresh clone skips this check.
const guidePath = path.join(rootDir, 'IMPLEMENTATION-GUIDE-SITE.md');
if (fs.existsSync(guidePath)) {
    check('The local site guide documents the cache-busting rule for all pages', () => {
        const guide = fs.readFileSync(guidePath, 'utf8');
        assert.ok(guide.includes('cache-busting loader'), 'Guide must document cache-busting loader');
    });
}

// Every page that loads math loads it in the order math/index.js gives (the practice pages the
// shorter practice list), each file once, and then its own <folder>-math.js if it has one.
const MATH = require('../math/index.js');
for (const file of htmlFiles) {
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    const listed = [...content.matchAll(/['"]((?:\.\.\/)*)math\/([\w/-]+\.js)(?:\?t=)?['"]/g)].map((m) => m[2]);
    if (!listed.length) continue;
    check(`${rel} loads the math files in order`, () => {
        const want = listed.includes('practice-common.js') ? MATH.PRACTICE_FILES
            : listed.includes('common.js') ? MATH.FILES : MATH.PRACTICE_FILES.slice(0, 5);
        assert.deepStrictEqual(listed, [...want], 'math files out of order or missing');
        const folder = path.basename(path.dirname(file));
        const own = `${folder}-math.js`;
        if (fs.existsSync(path.join(path.dirname(file), own))) {
            const at = content.indexOf(`'${own}'`);
            assert.ok(at > 0, `${own} is not loaded`);
            assert.ok(at > content.lastIndexOf(`math/${want[want.length - 1]}`), `${own} loads before the shared math`);
        }
    });
}

console.log(`\nCache busting verification: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
