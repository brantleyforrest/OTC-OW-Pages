/* Loads third-party libraries from vendor/ when present, otherwise from the CDN.
 * Run scripts/fetch_vendor.py to download the local copies.
 * Keep versions in sync with that script and with the <head> links on each page.
 *
 *   const THREE = await Vendor.three();   // ES module, local first
 *   Vendor.script('katex').then(...);     // classic script, local first
 */
(function (global) {
    'use strict';

    // vendor/ sits next to assets/, so resolve it from this file's own URL.
    const self = document.currentScript && document.currentScript.src;
    const VENDOR = new URL('../vendor/', self || global.location.href).href;

    const LIBS = {
        three: {
            local: VENDOR + 'three/three.module.min.js',
            cdn: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js'
        },
        katex: {
            local: VENDOR + 'katex/katex.min.js',
            cdn: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
            integrity: 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg'
        }
    };

    const modules = {};
    function importModule(name) {
        const lib = LIBS[name];
        if (!modules[name]) {
            modules[name] = import(lib.local).catch(function () { return import(lib.cdn); });
        }
        return modules[name];
    }

    function addScript(src, integrity) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // Always resolves, so pages carry on (with their plain-text fallbacks) when offline.
    const scripts = {};
    function script(name) {
        const lib = LIBS[name];
        if (!scripts[name]) {
            scripts[name] = addScript(lib.local)
                .catch(function () { return addScript(lib.cdn, lib.integrity); })
                .catch(function () { console.warn('Could not load ' + name + ' locally or from the CDN.'); });
        }
        return scripts[name];
    }

    global.Vendor = {
        three: function () { return importModule('three'); },
        importModule: importModule,
        script: script
    };
})(window);
