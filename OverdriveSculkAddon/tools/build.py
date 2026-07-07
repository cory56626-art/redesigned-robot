#!/usr/bin/env python3
"""
Build the Overdrive Sculk addon into a single distributable .mcaddon file.

A .mcaddon is just a zip archive containing the behavior pack and resource
pack folders side by side; Minecraft imports every pack it finds inside.

Usage:
    python3 tools/build.py
"""

import os
import zipfile

import gen_assets  # regenerate textures/icons so the build is reproducible

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
BP = os.path.join(ROOT, "behavior_pack")
RP = os.path.join(ROOT, "resource_pack")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "OverdriveSculk.mcaddon")

# Never ship editor cruft.
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
SKIP_EXT = {".pyc"}


def add_tree(zf, src_dir, arc_prefix):
    count = 0
    for base, _dirs, files in os.walk(src_dir):
        for name in files:
            if name in SKIP_NAMES or os.path.splitext(name)[1] in SKIP_EXT:
                continue
            full = os.path.join(base, name)
            rel = os.path.relpath(full, src_dir)
            arcname = os.path.join(arc_prefix, rel).replace(os.sep, "/")
            zf.write(full, arcname)
            count += 1
    return count


def main():
    print("Regenerating assets...")
    gen_assets.main()

    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)

    print(f"Packaging -> {OUT}")
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        n_bp = add_tree(zf, BP, "OverdriveSculkBP")
        n_rp = add_tree(zf, RP, "OverdriveSculkRP")

    size = os.path.getsize(OUT)
    print(f"Done. {n_bp} behavior-pack files + {n_rp} resource-pack files, {size} bytes.")


if __name__ == "__main__":
    main()
