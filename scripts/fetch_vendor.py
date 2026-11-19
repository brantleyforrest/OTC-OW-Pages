#!/usr/bin/env python3
"""Download the site's third-party libraries into vendor/ so pages work offline.

Run from anywhere:
    python scripts/fetch_vendor.py

Pages look for these files first and fall back to the CDN when they are missing,
so running this script is optional. Delete the vendor/ folder to go back to the CDN.

What it downloads (keep in sync with assets/vendor.js and the page <head> links):
    vendor/three/  Three.js module build (plus any files it imports)
    vendor/katex/  KaTeX script, stylesheet, and the fonts the stylesheet uses
    vendor/fonts/  Inter and JetBrains Mono from Google Fonts, rewritten to local files
"""

import base64
import hashlib
import json
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"

THREE_VERSION = "0.170.0"
KATEX_VERSION = "0.16.11"

THREE_BASE = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/build/"
THREE_ENTRY = "three.module.min.js"

KATEX_BASE = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist/"
# Subresource-integrity hashes the pages already use for the CDN copies.
KATEX_FILES = {
    "katex.min.js": "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg",
    "katex.min.css": "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+",
}

GOOGLE_FONTS_CSS = (
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700"
    "&family=JetBrains+Mono:wght@400;600&display=swap"
)
# Google serves woff2 with unicode-range subsets only to modern browsers.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)


def fetch(url, user_agent="otc-ow-vendor-fetch"):
    req = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"  {path.parent.name}/{path.name}  ({len(data) / 1024:.0f} KB)")


def sri(data):
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()


def fetch_three(out):
    print(f"Three.js {THREE_VERSION}")
    # Follow relative imports (newer Three.js builds split into several files).
    pending, seen = [THREE_ENTRY], set()
    import_re = re.compile(rb"""(?:from|import)\s*\(?\s*["'](\./[^"']+)["']""")
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        data = fetch(THREE_BASE + name)
        save(out / "three" / name, data)
        for m in import_re.finditer(data):
            pending.append(m.group(1).decode()[2:])


def fetch_katex(out):
    print(f"KaTeX {KATEX_VERSION}")
    for name, expected in KATEX_FILES.items():
        data = fetch(KATEX_BASE + name)
        if sri(data) != expected:
            raise RuntimeError(f"{name} does not match its integrity hash; refusing to save it.")
        save(out / "katex" / name, data)
        if name.endswith(".css"):
            fonts = sorted(set(re.findall(r"url\((fonts/[^)\"']+)\)", data.decode("utf-8"))))
            for font in fonts:
                save(out / "katex" / font, fetch(KATEX_BASE + font))


def fetch_google_fonts(out):
    print("Google Fonts (Inter, JetBrains Mono)")
    css = fetch(GOOGLE_FONTS_CSS, BROWSER_UA).decode("utf-8")

    saved = set()

    def localize(match):
        url = match.group(1).strip("'\"")
        parts = urllib.parse.urlparse(url).path.strip("/").split("/")
        # e.g. /s/inter/v18/UcC73Fw....woff2 -> files/inter-v18-UcC73Fw....woff2
        name = "-".join(parts[1:]) if parts and parts[0] == "s" else "-".join(parts)
        if name not in saved:  # variable fonts reuse one file for every weight
            save(out / "fonts" / "files" / name, fetch(url, BROWSER_UA))
            saved.add(name)
        return f"url(files/{name})"

    css = re.sub(r"url\(([^)]+)\)", localize, css)
    save(out / "fonts" / "fonts.css", css.encode("utf-8"))


def main():
    # Build in a temporary folder and swap it in only if everything succeeded,
    # so a failed run never leaves a half-filled vendor/ that pages would trust.
    tmp = Path(tempfile.mkdtemp(prefix="vendor-", dir=ROOT))
    try:
        fetch_three(tmp)
        fetch_katex(tmp)
        fetch_google_fonts(tmp)
        manifest = {
            "three": THREE_VERSION,
            "katex": KATEX_VERSION,
            "fonts": GOOGLE_FONTS_CSS,
            "downloaded": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        (tmp / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if VENDOR.exists():
            shutil.rmtree(VENDOR)
        tmp.rename(VENDOR)
    except Exception as err:
        shutil.rmtree(tmp, ignore_errors=True)
        print(f"\nFailed: {err}\nvendor/ was left unchanged.", file=sys.stderr)
        return 1
    print(f"\nDone. Local copies are in {VENDOR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
