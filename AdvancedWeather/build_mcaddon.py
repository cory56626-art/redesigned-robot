#!/usr/bin/env python3
"""Package the behavior + resource packs into AdvancedWeather.mcaddon.
An .mcaddon is just a zip containing the pack folders, each with its manifest."""
import os, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "AdvancedWeather.mcaddon")
PACKS = ["behavior_pack", "resource_pack"]

def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for pack in PACKS:
            base = os.path.join(ROOT, pack)
            for dirpath, _, files in os.walk(base):
                for name in files:
                    full = os.path.join(dirpath, name)
                    arc = os.path.relpath(full, ROOT)
                    z.write(full, arc)
    print(f"Built {OUT} ({os.path.getsize(OUT)} bytes)")

if __name__ == "__main__":
    main()
