#!/usr/bin/env python3
"""Validate JSON and package the Auto Enchanter add-on into a .mcaddon (and .zip)."""
import json
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKS = ["AutoEnchanter_BP", "AutoEnchanter_RP"]
DIST = os.path.join(ROOT, "dist")
os.makedirs(DIST, exist_ok=True)

# 1) Validate every JSON file parses.
bad = 0
for pack in PACKS:
    for dirpath, _, files in os.walk(os.path.join(ROOT, pack)):
        for f in files:
            if f.endswith(".json"):
                p = os.path.join(dirpath, f)
                try:
                    with open(p) as fh:
                        json.load(fh)
                except Exception as e:
                    bad += 1
                    print("INVALID JSON:", p, "->", e)
if bad:
    raise SystemExit(f"{bad} invalid JSON file(s); aborting.")
print("All JSON valid.")

# 2) Package. A .mcaddon is just a zip with each pack folder at the top level.
out = os.path.join(DIST, "AutoEnchanter.mcaddon")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for pack in PACKS:
        base = os.path.join(ROOT, pack)
        for dirpath, _, files in os.walk(base):
            for f in files:
                full = os.path.join(dirpath, f)
                arc = os.path.relpath(full, ROOT)  # keep pack folder as top-level dir
                z.write(full, arc)

# Also a plain .zip copy (some users prefer importing packs manually).
import shutil
shutil.copyfile(out, os.path.join(DIST, "AutoEnchanter.zip"))

size = os.path.getsize(out)
print(f"Built {out} ({size} bytes)")
with zipfile.ZipFile(out) as z:
    for n in z.namelist():
        print("  ", n)
