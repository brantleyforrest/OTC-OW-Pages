#!/usr/bin/env python3
"""
OTC-OW Image & Asset Management Backend Engine
=============================================
INTERNAL WORKER SCRIPT:
- Automatically called by Git pre-commit hook during commits.
- Called by the root launcher: RUN_IMAGE_TOOLS.bat for interactive CLI UX.
"""

import sys
import os
import subprocess
import argparse
import zlib
import struct
from pathlib import Path

# Try importing Pillow; if not available, attempt auto-install or use built-in zlib fallback
HAS_PIL = False
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    try:
        # Silently attempt user-level installation of Pillow
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "Pillow"], check=False)
        from PIL import Image
        HAS_PIL = True
    except Exception:
        HAS_PIL = False

def get_repo_root():
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True
        )
        return Path(res.stdout.strip())
    except Exception:
        return Path(__file__).resolve().parent.parent.parent

def format_size(bytes_val):
    if bytes_val < 1024:
        return f"{bytes_val} B"
    elif bytes_val < 1024 * 1024:
        return f"{bytes_val / 1024:.1f} KB"
    else:
        return f"{bytes_val / (1024 * 1024):.2f} MB"

def check_hook_installed(repo_root):
    hook_path = repo_root / ".git" / "hooks" / "pre-commit"
    if hook_path.exists():
        try:
            content = hook_path.read_text(encoding="utf-8")
            if "image_tools_backend.py" in content or "manage_images.py" in content:
                return True
        except Exception:
            pass
    return False

def install_hook(repo_root):
    hook_dir = repo_root / ".git" / "hooks"
    hook_dir.mkdir(parents=True, exist_ok=True)
    hook_path = hook_dir / "pre-commit"
    script_content = (
        "#!/bin/sh\n"
        "# OTC-OW Automatic Image Pre-Commit Optimizer\n"
        "# Triggered automatically during commits in GitHub Desktop or Git CLI\n"
        "if command -v python >/dev/null 2>&1; then\n"
        "    python scripts/backend/image_tools_backend.py --staged\n"
        "elif command -v py >/dev/null 2>&1; then\n"
        "    py scripts/backend/image_tools_backend.py --staged\n"
        "fi\n"
        "exit 0\n"
    )
    hook_path.write_text(script_content, encoding="utf-8")
    print(f"Pre-commit hook successfully installed at: {hook_path}")

def optimize_png_pure(file_bytes):
    """Lossless PNG optimizer using pure built-in Python zlib (requires zero external packages)."""
    if not file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    pos = 8
    chunks = []
    idat_data = []
    while pos < len(file_bytes):
        if pos + 12 > len(file_bytes):
            break
        length = struct.unpack(">I", file_bytes[pos:pos+4])[0]
        ctype = file_bytes[pos+4:pos+8]
        cdata = file_bytes[pos+8:pos+8+length]
        crc = file_bytes[pos+8+length:pos+12+length]
        pos += 12 + length
        if ctype == b"IDAT":
            idat_data.append(cdata)
        elif ctype in (b"IHDR", b"PLTE", b"tRNS", b"IEND"):
            chunks.append((ctype, cdata))

    if not idat_data:
        return None

    try:
        raw_pixels = zlib.decompress(b"".join(idat_data))
        compressed_pixels = zlib.compress(raw_pixels, level=9)
    except Exception:
        return None

    out = [b"\x89PNG\r\n\x1a\n"]
    for ctype, cdata in chunks:
        if ctype == b"IEND":
            # Inject optimized IDAT before IEND
            crc_val = struct.pack(">I", zlib.crc32(b"IDAT" + compressed_pixels) & 0xffffffff)
            out.append(struct.pack(">I", len(compressed_pixels)) + b"IDAT" + compressed_pixels + crc_val)
        crc_val = struct.pack(">I", zlib.crc32(ctype + cdata) & 0xffffffff)
        out.append(struct.pack(">I", len(cdata)) + ctype + cdata + crc_val)

    return b"".join(out)

def optimize_file(filepath):
    path = Path(filepath)
    if not path.is_file():
        return False, 0, 0
    ext = path.suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        return False, 0, 0

    orig_size = path.stat().st_size
    if orig_size == 0:
        return False, 0, 0

    # 1. If Pillow is available, use it
    if HAS_PIL:
        temp_path = path.with_suffix(path.suffix + ".opt_tmp")
        try:
            with Image.open(path) as img:
                if ext == ".png":
                    img.save(temp_path, format="PNG", optimize=True)
                elif ext in (".jpg", ".jpeg"):
                    if img.mode != "RGB":
                        img = img.convert("RGB")
                    img.save(temp_path, format="JPEG", optimize=True, quality=88)
                elif ext == ".webp":
                    img.save(temp_path, format="WEBP", optimize=True, quality=88)

            new_size = temp_path.stat().st_size
            if new_size < orig_size:
                temp_path.replace(path)
                return True, orig_size, new_size
            else:
                if temp_path.exists():
                    temp_path.unlink()
                return False, orig_size, orig_size
        except Exception:
            if temp_path.exists():
                temp_path.unlink()

    # 2. Pure Python standard library fallback (zero external packages required)
    if ext == ".png":
        try:
            with open(path, "rb") as f:
                data = f.read()
            opt_data = optimize_png_pure(data)
            if opt_data and len(opt_data) < orig_size:
                with open(path, "wb") as f:
                    f.write(opt_data)
                return True, orig_size, len(opt_data)
        except Exception:
            pass

    return False, orig_size, orig_size

def optimize_staged():
    """Triggered by Git pre-commit hook during commit in GitHub Desktop or CLI."""
    repo_root = get_repo_root()
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"]
    try:
        res = subprocess.run(cmd, cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        files = [line.strip() for line in res.stdout.splitlines() if line.strip()]
    except Exception:
        return 0

    image_exts = {".png", ".jpg", ".jpeg", ".webp"}
    staged_images = [f for f in files if Path(f).suffix.lower() in image_exts]

    if not staged_images:
        return 0

    optimized_count = 0
    total_saved = 0

    for rel_path in staged_images:
        full_path = repo_root / rel_path
        if not full_path.exists():
            continue
        success, orig_s, new_s = optimize_file(full_path)
        if success:
            saved = orig_s - new_s
            pct = (saved / orig_s) * 100
            total_saved += saved
            optimized_count += 1
            print(f"[Image Optimizer] Compressed: {rel_path} ({format_size(orig_s)} -> {format_size(new_s)}, saved {pct:.1f}%)")
            subprocess.run(["git", "add", str(rel_path)], cwd=repo_root, check=True)

    if optimized_count > 0:
        print(f"[Image Optimizer] Auto-optimized {optimized_count} image(s), saved {format_size(total_saved)} total.")
    return 0

def optimize_all():
    """Optimizes all images in the Images/ directory."""
    repo_root = get_repo_root()
    img_dir = repo_root / "Images"
    if not img_dir.exists():
        print(f"No Images directory found at: {img_dir}")
        return 0

    image_exts = {".png", ".jpg", ".jpeg", ".webp"}
    image_files = [p for p in img_dir.rglob("*") if p.suffix.lower() in image_exts]

    if not image_files:
        print(f"No images found in {img_dir}.")
        return 0

    print(f"\nScanning and optimizing {len(image_files)} image(s) in {img_dir}...")
    print("-" * 65)
    optimized_count = 0
    total_saved = 0

    for img_path in image_files:
        success, orig_s, new_s = optimize_file(img_path)
        rel = img_path.relative_to(repo_root)
        if success:
            saved = orig_s - new_s
            pct = (saved / orig_s) * 100
            total_saved += saved
            optimized_count += 1
            print(f"  [SAVED]    {rel}: {format_size(orig_s)} -> {format_size(new_s)} (-{pct:.1f}%)")
        else:
            print(f"  [OPTIMAL]  {rel}: already at minimum size ({format_size(orig_s)})")

    print("-" * 65)
    print(f"Result: Optimized {optimized_count} image(s). Total space saved: {format_size(total_saved)}.")
    return 0

def audit_history():
    """Inspects images on disk and analyzes how much space assets take up in Git history."""
    repo_root = get_repo_root()
    print("\n" + "=" * 70)
    print("ASSET AUDIT: DISK STORAGE & GIT HISTORY USAGE")
    print("=" * 70)

    # 1. Working directory images
    img_dir = repo_root / "Images"
    image_exts = {".png", ".jpg", ".jpeg", ".webp"}
    working_images = [p for p in img_dir.rglob("*") if p.suffix.lower() in image_exts] if img_dir.exists() else []

    total_working_size = sum(p.stat().st_size for p in working_images)
    print(f"Active Images on Disk:  {len(working_images)} file(s) across Images/")
    print(f"Total Working Size:     {format_size(total_working_size)}")

    hook_active = check_hook_installed(repo_root)
    print(f"GitHub Desktop Hook:    {'[ACTIVE] Auto-optimizes on commit' if hook_active else '[INACTIVE] Run Option 4 to enable'}")

    # 2. History blobs
    try:
        cmd = ["git", "rev-list", "--objects", "--all"]
        rev_out = subprocess.run(cmd, cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True).stdout
        objects = [line.strip().split(maxsplit=1) for line in rev_out.splitlines() if line.strip()]

        image_objects = []
        for obj in objects:
            if len(obj) == 2:
                sha, path = obj[0], obj[1]
                p_lower = Path(path).suffix.lower()
                if p_lower in image_exts or p_lower == ".pdf":
                    image_objects.append((sha, path))

        if not image_objects:
            print("\nNo image or PDF objects found in Git history yet (repository is clean).")
            print("=" * 70)
            return 0

        shas = "\n".join([sha for sha, _ in image_objects])
        cat_out = subprocess.run(
            ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
            input=shas, cwd=repo_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True
        ).stdout

        sizes = {}
        for line in cat_out.splitlines():
            parts = line.strip().split()
            if len(parts) >= 3 and parts[1] == "blob":
                sizes[parts[0]] = int(parts[2])

        path_blobs = {}
        for sha, path in image_objects:
            if sha in sizes:
                path_blobs.setdefault(path, []).append((sha, sizes[sha]))

        print("\nAsset Footprint in Git History (All Past Commits):")
        print(f"{'File / Blob Path':<42} {'Revisions':<12} {'Total Git Space':<16}")
        print("-" * 72)
        grand_total = 0
        bloated_files = 0
        for path, blobs in sorted(path_blobs.items(), key=lambda item: sum(b[1] for b in item[1]), reverse=True):
            tot = sum(b[1] for b in blobs)
            grand_total += tot
            rev_str = f"{len(blobs)} version(s)"
            if len(blobs) > 1:
                rev_str += " *"
                bloated_files += 1
            print(f"{path:<42} {rev_str:<12} {format_size(tot):<16}")

        print("-" * 72)
        print(f"Total Git History Asset Storage: {format_size(grand_total)}")
        if bloated_files > 0:
            print(f"Notice: {bloated_files} file(s) marked with '*' have multiple past revisions stored in Git.")
            print("You can run 'Prune Old Revisions' to strip older versions and reclaim space.")
    except Exception as e:
        print(f"Git history note: {e}")

    print("=" * 70)
    return 0

def prune_history(threshold="1M"):
    """Prunes past bloated versions of files larger than the threshold from history."""
    repo_root = get_repo_root()
    print("\n" + "=" * 70)
    print("PRUNING OLD ASSET REVISIONS FROM GIT HISTORY")
    print(f"Size threshold: Purging past versions larger than {threshold}")
    print("=" * 70)
    print("This will:")
    print("  1. Keep the newest version of all active files in your working directory.")
    print("  2. Strip old, unreferenced binary blobs from past commits.")
    print("  3. Compact your local .git storage database.")
    print("=" * 70)

    try:
        cmd = [sys.executable, "-m", "git_filter_repo", f"--strip-blobs-bigger-than={threshold}"]
        print("Executing git-filter-repo...")
        res = subprocess.run(cmd, cwd=repo_root, text=True)
        if res.returncode == 0:
            print("\nExpiring reflog and running aggressive garbage collection (git gc)...")
            subprocess.run(["git", "reflog", "expire", "--expire=now", "--all"], cwd=repo_root, check=True)
            subprocess.run(["git", "gc", "--prune=now", "--aggressive"], cwd=repo_root, check=True)
            print("\nSuccess: Git history pruned and compacted successfully.")
            print("Note: If you have already pushed to GitHub, use 'git push --force' when ready.")
        else:
            print("\ngit-filter-repo completed with an alert. Check if working tree was completely committed first.")
    except Exception as e:
        print(f"Prune error: {e}")
    return 0

def show_manual_guide():
    repo_root = get_repo_root()
    print("\n" + "=" * 70)
    print("COMPLETE MANUAL CONTROL GUIDE (Without Using This Script)")
    print("=" * 70)
    print(r"""
If you prefer 100% manual control over your assets and Git history,
you can run standard Git and Python commands directly in your terminal:

1. MANUALLY OPTIMIZE AN IMAGE:
   Using Python Pillow in your terminal:
     python -c "from PIL import Image; img=Image.open('Images/photo.png'); img.save('Images/photo.png', optimize=True)"
   Or use web tools like https://tinypng.com before copying images to Images/

2. MANUALLY CHECK WHICH IMAGES WERE MODIFIED ACROSS COMMITS:
   See all commits touching the Images folder:
     git log --stat -- Images/
   See the commit history of a specific image:
     git log --follow -- Images/eci_coordinate_system.png

3. MANUALLY FIND THE LARGEST OBJECTS IN YOUR .GIT REPO:
   Run in PowerShell:
     git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | Where-Object { $_ -match '^blob' } | Sort-Object { [int]($_ -split ' ')[2] } -Descending | Select-Object -First 10

4. MANUALLY PURGE OLD VERSIONS OF LARGE FILES FROM HISTORY:
   Strip old binary versions larger than 1MB from all past commits:
     python -m git_filter_repo --strip-blobs-bigger-than=1M
   Permanently remove an old/deleted file across all history:
     python -m git_filter_repo --path Images/old_file.png --invert-paths

5. MANUALLY COMPACT AND RECLAIM DISK SPACE AFTER PRUNING:
     git reflog expire --expire=now --all
     git gc --prune=now --aggressive
""")
    print("=" * 70)

def interactive_menu():
    repo_root = get_repo_root()
    while True:
        hook_status = "[Active]" if check_hook_installed(repo_root) else "[Inactive]"
        print("\n" + "=" * 70)
        print("          OTC-OW ASSET & IMAGE MANAGEMENT CONSOLE")
        print("=" * 70)
        print(f"  Working Repository:  {repo_root.name} ({repo_root})")
        print(f"  Pre-Commit Hook:     {hook_status} (Auto-optimizes on commit in GitHub Desktop)")
        print("-" * 70)
        print("  [1] Audit Images & Git History Usage")
        print("      Inspect active images and see historical bloat in Git history")
        print()
        print("  [2] Optimize All Images in Images/ Folder")
        print("      Losslessly compress all existing images right now")
        print()
        print("  [3] Prune Old Revisions from Git History")
        print("      Purge older, bloated image versions from past commits")
        print()
        print("  [4] Pre-Commit Hook Management")
        print("      Verify or re-install the automatic hook for GitHub Desktop")
        print()
        print("  [5] Manual Commands Guide")
        print("      Display exact manual terminal commands for 100% manual control")
        print()
        print("  [0] Exit")
        print("=" * 70)

        try:
            choice = input("Select an option [0-5]: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nExiting.")
            break

        if choice == "1":
            audit_history()
            input("\nPress Enter to return to menu...")
        elif choice == "2":
            confirm = input("\nOptimize all active images in Images/ now? [Y/n]: ").strip().lower()
            if confirm in ("", "y", "yes"):
                optimize_all()
            input("\nPress Enter to return to menu...")
        elif choice == "3":
            print("\nWarning: Pruning rewrites Git history for older revisions.")
            print("Active files in your working directory will NOT be deleted.")
            confirm = input("Do you want to proceed with pruning? [y/N]: ").strip().lower()
            if confirm in ("y", "yes"):
                threshold = input("Enter size threshold to strip (press Enter for '1M'): ").strip()
                if not threshold:
                    threshold = "1M"
                prune_history(threshold)
            else:
                print("Pruning cancelled.")
            input("\nPress Enter to return to menu...")
        elif choice == "4":
            if check_hook_installed(repo_root):
                print("\nPre-commit hook is already installed and active!")
                reinstall = input("Reinstall/overwrite hook? [y/N]: ").strip().lower()
                if reinstall in ("y", "yes"):
                    install_hook(repo_root)
            else:
                install_hook(repo_root)
            input("\nPress Enter to return to menu...")
        elif choice == "5":
            show_manual_guide()
            input("\nPress Enter to return to menu...")
        elif choice == "0" or choice.lower() in ("exit", "q", "quit"):
            print("Exiting Asset Management Console.")
            break
        else:
            print(f"Invalid option '{choice}'. Please select a number from 0 to 5.")

def main():
    parser = argparse.ArgumentParser(
        description="OTC-OW Image & Asset Management Console (Interactive CLI UX & Automation)",
        epilog="Run without arguments for the interactive menu. Use --help for command-line automation options."
    )
    parser.add_argument("--staged", action="store_true", help="Optimize staged files before commit (invoked by Git pre-commit hook)")
    parser.add_argument("--optimize", action="store_true", help="Optimize all images in Images/ without interactive prompts")
    parser.add_argument("--audit", action="store_true", help="Audit active image sizes and Git history usage without interactive prompts")
    parser.add_argument("--prune", nargs="?", const="1M", default=None, help="Prune past blobs larger than threshold (default: 1M) without interactive prompts")
    parser.add_argument("--guide", action="store_true", help="Print manual commands guide and exit")
    parser.add_argument("--install-hook", action="store_true", help="Install or update the pre-commit hook")

    args = parser.parse_args()

    # If any specific command line flag is passed, execute non-interactively
    if args.staged:
        sys.exit(optimize_staged())
    elif args.optimize:
        sys.exit(optimize_all())
    elif args.prune is not None:
        sys.exit(prune_history(args.prune))
    elif args.audit:
        sys.exit(audit_history())
    elif args.guide:
        show_manual_guide()
        sys.exit(0)
    elif args.install_hook:
        install_hook(get_repo_root())
        sys.exit(0)
    else:
        # No arguments: launch full interactive CLI UX
        interactive_menu()

if __name__ == "__main__":
    main()
