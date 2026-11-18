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

check('_template/tool-template.html sets up cache-busting for all new pages', () => {
    const tpl = fs.readFileSync(path.join(rootDir, '_template/tool-template.html'), 'utf8');
    assert.ok(tpl.includes('Date.now()'), 'Template must use Date.now() cache-busting loader');
    assert.ok(tpl.includes('http-equiv="Cache-Control"'), 'Template must include Cache-Control meta');
});

check('_template/README.md documents the cache-busting rule for new tools', () => {
    const readme = fs.readFileSync(path.join(rootDir, '_template/README.md'), 'utf8');
    assert.ok(readme.includes('cache-busting'), 'README must mention cache-busting');
});

check('IMPLEMENTATION-GUIDE-SITE.md documents the cache-busting rule for all pages', () => {
    const guide = fs.readFileSync(path.join(rootDir, 'IMPLEMENTATION-GUIDE-SITE.md'), 'utf8');
    assert.ok(guide.includes('cache-busting loader'), 'Guide must document cache-busting loader');
});

console.log(`\nCache busting verification: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
