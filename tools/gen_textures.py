#!/usr/bin/env python3
"""
Procedural placeholder-texture generator for the Organic Forgery add-on.

These are deliberately simple, deterministic PNGs so the mod loads and reads
clearly in-game. Swap any file under resource_packs/of_rp/textures/ for real
art without touching code — the paths are the contract.

Run:  python3 tools/gen_textures.py
"""
import os
import math
import random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "resource_packs", "of_rp")
BP = os.path.join(ROOT, "behavior_packs", "of_bp")

BLOCKS = os.path.join(RP, "textures", "of", "blocks")
ITEMS = os.path.join(RP, "textures", "of", "items")
ENTITY = os.path.join(RP, "textures", "of", "entity")
PARTICLE = os.path.join(RP, "textures", "particle")

for d in (BLOCKS, ITEMS, ENTITY, PARTICLE):
    os.makedirs(d, exist_ok=True)


def save(img, path):
    img.save(path)
    print("  wrote", os.path.relpath(path, ROOT))


def jitter(c, amt, rnd):
    return tuple(max(0, min(255, ch + rnd.randint(-amt, amt))) for ch in c)


# ---------------------------------------------------------------- block textures (64px)

def noisy_block(base, size=64, amt=18, seed=0):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    px = img.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = jitter(base, amt, rnd) + (255,)
    return img, rnd


def make_harvester():
    img, rnd = noisy_block((74, 77, 84), amt=14, seed=11)
    d = ImageDraw.Draw(img)
    # Panel seams.
    for gx in range(0, 64, 16):
        d.line([(gx, 0), (gx, 63)], fill=(40, 42, 47, 255))
    for gy in range(0, 64, 16):
        d.line([(0, gy), (63, gy)], fill=(40, 42, 47, 255))
    # Rivets + rust flecks.
    for gx in range(8, 64, 16):
        for gy in range(8, 64, 16):
            d.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=(150, 152, 158, 255))
            d.point((gx, gy), fill=(200, 202, 208, 255))
    for _ in range(60):
        x, y = rnd.randint(0, 63), rnd.randint(0, 63)
        d.point((x, y), fill=(96, 52, 40, 255))
    save(img, os.path.join(BLOCKS, "harvester.png"))


def make_organic_forgery():
    img, rnd = noisy_block((120, 58, 62), amt=20, seed=22)
    d = ImageDraw.Draw(img)
    # Veins.
    for _ in range(10):
        x, y = rnd.randint(0, 63), rnd.randint(0, 63)
        for _ in range(rnd.randint(6, 14)):
            d.point((x, y), fill=(168, 40, 52, 255))
            x = max(0, min(63, x + rnd.randint(-1, 1)))
            y = max(0, min(63, y + rnd.randint(-1, 1)))
    # Bone streaks.
    for _ in range(40):
        x, y = rnd.randint(0, 63), rnd.randint(0, 63)
        d.point((x, y), fill=jitter((222, 214, 196), 14, rnd) + (255,))
    save(img, os.path.join(BLOCKS, "organic_forgery.png"))


def make_flesh_moss():
    img, rnd = noisy_block((104, 40, 50), amt=22, seed=33)
    d = ImageDraw.Draw(img)
    for _ in range(90):
        x, y = rnd.randint(0, 63), rnd.randint(0, 63)
        d.point((x, y), fill=(150, 66, 78, 255))
    for _ in range(40):
        x, y = rnd.randint(0, 63), rnd.randint(0, 63)
        d.point((x, y), fill=(58, 18, 26, 255))
    for _ in range(14):
        x, y = rnd.randint(2, 61), rnd.randint(2, 61)
        d.ellipse([x - 1, y - 1, x + 1, y + 1], fill=(196, 96, 110, 255))
    save(img, os.path.join(BLOCKS, "flesh_moss.png"))


# ---------------------------------------------------------------- item textures (16px)

def canvas16():
    return Image.new("RGBA", (16, 16), (0, 0, 0, 0))


def px_set(img, points, color):
    p = img.load()
    for (x, y) in points:
        if 0 <= x < 16 and 0 <= y < 16:
            p[x, y] = color


def outline(img, color=(20, 12, 12, 255)):
    """Add a 1px dark outline around opaque pixels."""
    p = img.load()
    src = img.copy().load()
    for y in range(16):
        for x in range(16):
            if src[x, y][3] == 0:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < 16 and 0 <= ny < 16 and src[nx, ny][3] > 0:
                        p[x, y] = color
                        break


def make_butchers_knife():
    img = canvas16()
    d = ImageDraw.Draw(img)
    # Handle (bottom-left, bone).
    d.line([(3, 13), (6, 10)], fill=(210, 202, 180, 255), width=2)
    # Blade (upper-right, steel).
    d.polygon([(6, 10), (8, 8), (13, 3), (14, 5), (9, 10)], fill=(198, 202, 210, 255))
    d.line([(8, 9), (13, 4)], fill=(240, 244, 250, 255))
    outline(img)
    save(img, os.path.join(ITEMS, "butchers_knife.png"))


def make_organic_cleaver():
    img = canvas16()
    d = ImageDraw.Draw(img)
    # Bone haft.
    d.line([(3, 13), (7, 9)], fill=(206, 198, 176, 255), width=2)
    # Fleshy broad blade.
    d.polygon([(6, 10), (7, 5), (13, 3), (14, 8), (10, 11)], fill=(150, 60, 66, 255))
    d.polygon([(8, 6), (12, 5), (13, 7)], fill=(190, 78, 86, 255))
    d.line([(7, 9), (12, 5)], fill=(214, 206, 188, 255))
    outline(img)
    save(img, os.path.join(ITEMS, "organic_cleaver.png"))


def blob_item(path, base, accent, seed):
    rnd = random.Random(seed)
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([3, 4, 12, 13], fill=base + (255,))
    for _ in range(18):
        x, y = rnd.randint(3, 12), rnd.randint(4, 13)
        if (x - 7.5) ** 2 + (y - 8.5) ** 2 <= 20:
            d.point((x, y), fill=accent + (255,))
    outline(img)
    save(img, path)


def make_raw_carcass():
    blob_item(os.path.join(ITEMS, "raw_carcass.png"), (150, 46, 52), (196, 78, 84), 41)


def make_sinew():
    img = canvas16()
    d = ImageDraw.Draw(img)
    rnd = random.Random(42)
    for _ in range(5):
        x, y = rnd.randint(4, 6), 3
        while y < 13:
            d.point((x, y), fill=(214, 150, 156, 255))
            d.point((x + 1, y), fill=(232, 176, 182, 255))
            x = max(3, min(12, x + rnd.randint(-1, 1)))
            y += 1
    outline(img)
    save(img, os.path.join(ITEMS, "sinew.png"))


def make_dense_bone():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.line([(5, 12), (11, 4)], fill=(226, 220, 202, 255), width=3)
    for cx, cy in ((5, 12), (11, 4)):
        d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(238, 232, 214, 255))
    outline(img)
    save(img, os.path.join(ITEMS, "dense_bone.png"))


def make_marrow():
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 12, 12], fill=(228, 222, 204, 255))
    d.ellipse([6, 6, 10, 10], fill=(170, 48, 58, 255))
    d.ellipse([7, 7, 9, 9], fill=(206, 84, 92, 255))
    outline(img)
    save(img, os.path.join(ITEMS, "marrow.png"))


def make_cured_hide():
    rnd = random.Random(44)
    img = canvas16()
    d = ImageDraw.Draw(img)
    d.polygon([(3, 5), (12, 3), (13, 12), (4, 13)], fill=(120, 82, 54, 255))
    for _ in range(16):
        x, y = rnd.randint(4, 12), rnd.randint(4, 12)
        d.point((x, y), fill=(92, 60, 38, 255))
    outline(img)
    save(img, os.path.join(ITEMS, "cured_hide.png"))


# ---------------------------------------------------------------- misc

def make_mote():
    """Soft radial white dot for custom particles (tinted per-effect in JSON)."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    p = img.load()
    for y in range(16):
        for x in range(16):
            dist = math.hypot(x - 7.5, y - 7.5) / 8.0
            a = max(0.0, 1.0 - dist)
            p[x, y] = (255, 255, 255, int((a ** 1.5) * 255))
    save(img, os.path.join(PARTICLE, "of_mote.png"))


def make_empty():
    save(Image.new("RGBA", (16, 16), (0, 0, 0, 0)), os.path.join(ENTITY, "empty.png"))


def make_pack_icon(path, seed):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 255))
    p = img.load()
    for y in range(128):
        for x in range(128):
            t = y / 127.0
            base = (int(46 + 34 * t), int(12 + 8 * t), int(16 + 10 * t))
            p[x, y] = jitter(base, 8, rnd) + (255,)
    d = ImageDraw.Draw(img)
    # Grinder silhouette.
    d.rectangle([34, 60, 94, 104], fill=(58, 60, 66, 255))
    d.rectangle([28, 52, 100, 62], fill=(70, 72, 80, 255))
    d.polygon([(44, 40), (84, 40), (94, 52), (34, 52)], fill=(48, 50, 56, 255))
    # Bone crossing.
    d.line([(40, 100), (88, 44)], fill=(220, 214, 196, 255), width=5)
    for cx, cy in ((40, 100), (88, 44)):
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(232, 226, 208, 255))
    # Blood drips.
    for _ in range(40):
        x, y = rnd.randint(0, 127), rnd.randint(0, 127)
        d.point((x, y), fill=(150, 24, 30, 255))
    save(img, path)


def main():
    print("Generating placeholder textures...")
    make_harvester()
    make_organic_forgery()
    make_flesh_moss()
    make_butchers_knife()
    make_organic_cleaver()
    make_raw_carcass()
    make_sinew()
    make_dense_bone()
    make_marrow()
    make_cured_hide()
    make_mote()
    make_empty()
    make_pack_icon(os.path.join(BP, "pack_icon.png"), 101)
    make_pack_icon(os.path.join(RP, "pack_icon.png"), 202)
    print("Done.")


if __name__ == "__main__":
    main()
