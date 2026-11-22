#!/usr/bin/env python3
"""Download the site's third-party files into vendor/.

Run from anywhere:
    python scripts/fetch_vendor.py           # Three.js only (vendor/three/, git-ignored)
    python scripts/fetch_vendor.py --all     # also refresh the fonts and KaTeX (committed)

The site hosts everything itself except Three.js:
    vendor/fonts/  Inter, JetBrains Mono, and Roboto Condensed, with their licenses. Committed.
    vendor/katex/  KaTeX script, stylesheet, fonts, and license. Committed.
    vendor/three/  Three.js module build. Git-ignored: pages load it from here when it exists
                   and from the CDN otherwise (see assets/vendor.js).

Keep versions in sync with assets/vendor.js. After --all, commit the changes under vendor/fonts
and vendor/katex.
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
KATEX_LICENSE = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/LICENSE"
# Subresource-integrity hashes of the published files.
KATEX_FILES = {
    "katex.min.js": "sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg",
    "katex.min.css": "sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+",
}

# Body and code text may swap in once loaded. The header font blocks instead, so the top bar
# never redraws in a stand-in font as a page opens.
GOOGLE_FONTS_CSS = [
    "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700"
    "&family=JetBrains+Mono:wght@400;600&display=swap",
    "https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@500;600;700&display=block",
]
# Each font's license, from the Google Fonts repository.
FONT_LICENSES = {
    "LICENSE-Inter.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt",
    "LICENSE-JetBrainsMono.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt",
    "LICENSE-RobotoCondensed.txt": "https://raw.githubusercontent.com/google/fonts/main/ofl/robotocondensed/OFL.txt",
}
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
        save(out / name, data)
        for m in import_re.finditer(data):
            pending.append(m.group(1).decode()[2:])


def fetch_katex(out):
    print(f"KaTeX {KATEX_VERSION}")
    for name, expected in KATEX_FILES.items():
        data = fetch(KATEX_BASE + name)
        if sri(data) != expected:
            raise RuntimeError(f"{name} does not match its integrity hash; refusing to save it.")
        save(out / name, data)
        if name.endswith(".css"):
            fonts = sorted(set(re.findall(r"url\((fonts/[^)\"']+)\)", data.decode("utf-8"))))
            for font in fonts:
                save(out / font, fetch(KATEX_BASE + font))
    save(out / "LICENSE", fetch(KATEX_LICENSE))


def fetch_google_fonts(out):
    print("Fonts (Inter, JetBrains Mono, Roboto Condensed)")
    saved = set()

    def localize(match):
        url = match.group(1).strip("'\"")
        parts = urllib.parse.urlparse(url).path.strip("/").split("/")
        # e.g. /s/inter/v18/UcC73Fw....woff2 -> files/inter-v18-UcC73Fw....woff2
        name = "-".join(parts[1:]) if parts and parts[0] == "s" else "-".join(parts)
        if name not in saved:  # variable fonts reuse one file for every weight
            save(out / "files" / name, fetch(url, BROWSER_UA))
            saved.add(name)
        return f"url(files/{name})"

    css = "".join(re.sub(r"url\(([^)]+)\)", localize, fetch(u, BROWSER_UA).decode("utf-8"))
                  for u in GOOGLE_FONTS_CSS)
    save(out / "fonts.css", css.encode("utf-8"))
    for name, url in FONT_LICENSES.items():
        save(out / name, fetch(url))


def replace_folder(name, fill):
    """Build vendor/<name> in a temporary folder and swap it in only if everything succeeded,
    so a failed run never leaves a half-filled folder that pages would trust."""
    VENDOR.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f"{name}-", dir=VENDOR))
    try:
        fill(tmp)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    target = VENDOR / name
    if target.exists():
        shutil.rmtree(target)
    tmp.rename(target)


def main():
    everything = "--all" in sys.argv[1:]
    try:
        replace_folder("three", fetch_three)
        if everything:
            replace_folder("katex", fetch_katex)
            replace_folder("fonts", fetch_google_fonts)
            manifest = {
                "katex": KATEX_VERSION,
                "fonts": GOOGLE_FONTS_CSS,
                "downloaded": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            (VENDOR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    except Exception as err:
        print(f"\nFailed: {err}\nThe folder being fetched was left unchanged.", file=sys.stderr)
        return 1
    print(f"\nDone. Local copies are in {VENDOR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
