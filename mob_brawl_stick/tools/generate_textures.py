#!/usr/bin/env python3
"""Generates the Brawl Stick item texture and pack icons."""
import os
import random
from PIL import Image, ImageDraw

random.seed(7)
ROOT = os.path.join(os.path.dirname(__file__), "..")
BP = os.path.join(ROOT, "BrawlStick_BP")
RP = os.path.join(ROOT, "BrawlStick_RP")


def clamp(x):
    return max(0, min(255, int(x)))


def tex_brawl_stick():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    # diagonal stick from bottom-left to top-right, vanilla-stick style
    wood = (104, 78, 47, 255)
    wood_hi = (137, 103, 63, 255)
    for i in range(11):
        x, y = 2 + i, 13 - i
        px[x, y] = wood
        if x + 1 < 16:
            px[x + 1, y] = wood_hi
    # red "fighting" tip (top 3 segments) with an ember point
    for i in range(8, 11):
        x, y = 2 + i, 13 - i
        px[x, y] = (200, 40, 30, 255)
        if x + 1 < 16:
            px[x + 1, y] = (240, 70, 40, 255)
    px[13, 2] = (255, 170, 60, 255)
    px[14, 2] = (255, 220, 120, 255)
    # gold binding band mid-stick
    for i in (5, 6):
        x, y = 2 + i, 13 - i
        px[x, y] = (212, 175, 55, 255)
        if x + 1 < 16:
            px[x + 1, y] = (240, 205, 90, 255)
    # grip wrap at the base
    px[2, 13] = (60, 40, 28, 255)
    px[3, 13] = (60, 40, 28, 255)
    px[3, 12] = (60, 40, 28, 255)
    return img


def tex_riot_stick():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    # diagonal stick, but angrier: charred wood, crimson head, spark burst
    wood = (70, 50, 34, 255)
    wood_hi = (96, 68, 44, 255)
    for i in range(11):
        x, y = 2 + i, 13 - i
        px[x, y] = wood
        if x + 1 < 16:
            px[x + 1, y] = wood_hi
    # long crimson riot head (top 5 segments)
    for i in range(6, 11):
        x, y = 2 + i, 13 - i
        px[x, y] = (160, 20, 20, 255)
        if x + 1 < 16:
            px[x + 1, y] = (210, 40, 30, 255)
    # spark burst at the tip
    for dx, dy in ((0, 0), (1, -1), (-1, -1), (1, 1), (-1, 0), (0, -2)):
        x, y = 13 + dx, 2 + dy
        if 0 <= x < 16 and 0 <= y < 16:
            px[x, y] = (255, 170, 60, 255)
    px[13, 2] = (255, 240, 160, 255)
    # gunpowder-gray band mid-stick
    for i in (4, 5):
        x, y = 2 + i, 13 - i
        px[x, y] = (110, 110, 115, 255)
        if x + 1 < 16:
            px[x + 1, y] = (140, 140, 145, 255)
    # grip wrap at the base
    px[2, 13] = (45, 30, 22, 255)
    px[3, 13] = (45, 30, 22, 255)
    px[3, 12] = (45, 30, 22, 255)
    return img


def pack_icon(bg):
    img = Image.new("RGBA", (256, 256), bg)
    d = ImageDraw.Draw(img)
    px = img.load()
    for x in range(0, 256, 4):
        for y in range(0, 256, 4):
            j = random.randint(-8, 8)
            for xx in range(x, x + 4):
                for yy in range(y, y + 4):
                    r, g, b, a = px[xx, yy]
                    px[xx, yy] = (clamp(r + j), clamp(g + j), clamp(b + j), 255)
    # two crossed sticks
    d.line([(48, 208), (208, 48)], fill=(137, 103, 63), width=18)
    d.line([(208, 208), (48, 48)], fill=(104, 78, 47), width=18)
    # red tips
    d.line([(180, 76), (208, 48)], fill=(230, 60, 40), width=18)
    d.line([(76, 76), (48, 48)], fill=(230, 60, 40), width=18)
    # angry spark in the middle
    d.ellipse([116, 116, 140, 140], fill=(255, 200, 60))
    d.ellipse([122, 122, 134, 134], fill=(255, 80, 40))
    return img


def save(img, *path):
    p = os.path.join(*path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    print("wrote", os.path.relpath(p, ROOT))


save(tex_brawl_stick(), RP, "textures/items/brawl_stick.png")
save(tex_riot_stick(), RP, "textures/items/riot_stick.png")
save(pack_icon((44, 30, 26, 255)), BP, "pack_icon.png")
save(pack_icon((30, 26, 44, 255)), RP, "pack_icon.png")
print("done")
