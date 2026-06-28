#!/usr/bin/env python3
"""Package the behaviour + resource packs into a distributable .mcaddon file.

A .mcaddon is simply a zip archive containing one folder per pack, each with
its own manifest.json. Double-clicking the result imports both packs into
Minecraft Bedrock.
"""
import os
import zipfile

ROOT = os.path.dirname(__file__)
OUT = os.path.join(ROOT, "Powers.mcaddon")
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
    size = os.path.getsize(OUT)
    print(f"Built {OUT} ({size/1024:.1f} KiB)")
    with zipfile.ZipFile(OUT) as z:
        print(f"{len(z.namelist())} files packaged")


if __name__ == "__main__":
    main()
