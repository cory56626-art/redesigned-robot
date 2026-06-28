#!/usr/bin/env python3
"""Generate all pixel-art textures for the Powers addon.

Produces 16x16 item icons, a blue-fire particle sheet and 256x256 pack icons.
Everything is drawn procedurally with Pillow so the pack is fully self contained.
"""
import os
import math
import random
from PIL import Image, ImageDraw

RP = os.path.join(os.path.dirname(__file__), "resource_pack")
BP = os.path.join(os.path.dirname(__file__), "behavior_pack")
ITEMS = os.path.join(RP, "textures", "items")
PART = os.path.join(RP, "textures", "particle")

T = (0, 0, 0, 0)  # transparent


def new(size=16):
    return Image.new("RGBA", (size, size), T)


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def outline(img, color=(20, 18, 28, 255)):
    """Add a dark outline around every opaque cluster of pixels."""
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    for y in range(h):
        for x in range(w):
            if src[x, y][3] == 0:
                solid = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] > 180:
                        solid = True
                        break
                if solid:
                    dst[x, y] = color
    return out


def shade(c, f):
    return (max(0, min(255, int(c[0] * f))),
            max(0, min(255, int(c[1] * f))),
            max(0, min(255, int(c[2] * f))),
            c[3] if len(c) == 4 else 255)


def save(img, path):
    img.save(path)
    print("wrote", path)


# ---------------------------------------------------------------- Power Gem
def gem():
    img = new()
    body = (180, 90, 255, 255)
    light = (225, 170, 255, 255)
    dark = (110, 40, 190, 255)
    shape = [
        (7, 1), (8, 1),
        (6, 2), (7, 2), (8, 2), (9, 2),
        (5, 3), (6, 3), (7, 3), (8, 3), (9, 3), (10, 3),
        (5, 4), (6, 4), (7, 4), (8, 4), (9, 4), (10, 4),
        (5, 5), (6, 5), (7, 5), (8, 5), (9, 5), (10, 5),
        (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6),
        (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7),
        (6, 8), (7, 8), (8, 8), (9, 8),
        (6, 9), (7, 9), (8, 9), (9, 9),
        (7, 10), (8, 10),
        (7, 11), (8, 11),
    ]
    for x, y in shape:
        px(img, x, y, body)
    for x, y in [(6, 2), (6, 3), (7, 2), (5, 4), (5, 5), (7, 4)]:
        px(img, x, y, light)
    for x, y in [(9, 6), (9, 7), (10, 6), (8, 8), (9, 8), (8, 9), (7, 10), (8, 10)]:
        px(img, x, y, dark)
    return outline(img)


# ---------------------------------------------------------------- God of War relic (war helm)
def god_of_war():
    img = new()
    bronze = (205, 150, 60, 255)
    bl = (240, 205, 115, 255)
    bd = (150, 100, 30, 255)
    red = (200, 45, 38, 255)
    redl = (240, 95, 70, 255)
    dark = (28, 20, 16, 255)
    # crest plume (mohawk) across the top
    for x, y in [(7, 0), (8, 0),
                 (6, 1), (7, 1), (8, 1), (9, 1),
                 (5, 2), (6, 2), (7, 2), (8, 2), (9, 2), (10, 2)]:
        px(img, x, y, red)
    for x, y in [(7, 0), (6, 1), (5, 2)]:
        px(img, x, y, redl)
    # helm dome
    for y in range(3, 8):
        for x in range(4, 12):
            px(img, x, y, bronze)
    # cheek guards (slightly narrower)
    for y in range(8, 13):
        for x in range(5, 11):
            px(img, x, y, bronze)
    # highlights / shadows for shape
    for x, y in [(4, 3), (4, 4), (5, 3)]:
        px(img, x, y, bl)
    for x, y in [(11, 6), (11, 7), (10, 12), (10, 11), (9, 12)]:
        px(img, x, y, bd)
    # T-shaped face opening (eye slit + nose guard gap)
    for x in range(6, 10):
        px(img, x, 8, dark)
    for y in range(9, 12):
        px(img, 7, y, dark)
        px(img, 8, y, dark)
    return outline(img)


# ---------------------------------------------------------------- Sonic boots
def sonic_boots():
    img = new()
    boot = (40, 90, 230, 255)
    boot_l = (90, 150, 255, 255)
    sole = (235, 230, 60, 255)
    white = (240, 245, 255, 255)
    shape = [
        (5, 3), (6, 3), (7, 3),
        (5, 4), (6, 4), (7, 4),
        (5, 5), (6, 5), (7, 5),
        (5, 6), (6, 6), (7, 6),
        (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7),
        (5, 8), (6, 8), (7, 8), (8, 8), (9, 8), (10, 8), (11, 8),
        (5, 9), (6, 9), (7, 9), (8, 9), (9, 9), (10, 9), (11, 9),
    ]
    for x, y in shape:
        px(img, x, y, boot)
    for x, y in [(5, 3), (5, 4), (5, 5), (5, 6), (5, 7), (5, 8)]:
        px(img, x, y, boot_l)
    # lightning bolt accent
    for x, y in [(8, 4), (7, 5), (8, 5), (9, 5), (8, 6)]:
        px(img, x, y, white)
    # sole
    for x in range(4, 13):
        px(img, x, 10, sole)
        px(img, x, 11, sole)
    return outline(img)


# ---------------------------------------------------------------- Frost scepter
def frost_scepter():
    img = new()
    ice = (150, 225, 255, 255)
    ice_l = (215, 245, 255, 255)
    ice_d = (80, 160, 220, 255)
    rod = (120, 130, 160, 255)
    # rod
    for i in range(8):
        px(img, 5 + i, 10 - i, rod)
        px(img, 4 + i, 11 - i, shade(rod, 0.7))
    # crystal head (snowflake-ish)
    head = [(11, 1), (12, 1), (10, 2), (11, 2), (12, 2), (13, 2),
            (10, 3), (11, 3), (12, 3), (13, 3), (11, 4), (12, 4),
            (9, 2), (14, 2), (11, 0), (12, 0)]
    for x, y in head:
        px(img, x, y, ice)
    for x, y in [(11, 1), (10, 2), (11, 0)]:
        px(img, x, y, ice_l)
    for x, y in [(13, 3), (12, 4), (14, 2)]:
        px(img, x, y, ice_d)
    return outline(img)


# ---------------------------------------------------------------- Storm hammer
def storm_hammer():
    img = new()
    metal = (110, 120, 150, 255)
    metal_l = (170, 185, 215, 255)
    metal_d = (60, 70, 95, 255)
    spark = (255, 240, 120, 255)
    wood = (120, 80, 45, 255)
    # head block
    for y in range(2, 7):
        for x in range(4, 12):
            c = metal
            if x in (4, 5):
                c = metal_l
            if x in (10, 11) or y == 6:
                c = metal_d
            px(img, x, y, c)
    # electric sparks on the head
    for x, y in [(6, 3), (7, 4), (8, 3), (9, 4), (7, 2)]:
        px(img, x, y, spark)
    # handle
    for i in range(8):
        px(img, 7 + (i // 4), 7 + i, wood)
        px(img, 8 + (i // 4), 7 + i, shade(wood, 0.7))
    return outline(img)


# ---------------------------------------------------------------- Titan gauntlet
def titan_gauntlet():
    img = new()
    stone = (140, 110, 80, 255)
    stone_l = (190, 160, 120, 255)
    stone_d = (90, 70, 50, 255)
    glow = (120, 230, 140, 255)
    shape = [
        (5, 4), (6, 4), (7, 4), (8, 4), (9, 4),
        (4, 5), (5, 5), (6, 5), (7, 5), (8, 5), (9, 5), (10, 5),
        (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6),
        (4, 7), (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7),
        (5, 8), (6, 8), (7, 8), (8, 8), (9, 8),
        (5, 9), (6, 9), (8, 9), (9, 9),
        (5, 10), (6, 10), (8, 10), (9, 10),
    ]
    for x, y in shape:
        px(img, x, y, stone)
    for x, y in [(5, 4), (4, 5), (4, 6), (5, 5)]:
        px(img, x, y, stone_l)
    for x, y in [(10, 5), (10, 6), (10, 7), (9, 8), (9, 10)]:
        px(img, x, y, stone_d)
    # glowing core
    for x, y in [(7, 6), (6, 6), (7, 5)]:
        px(img, x, y, glow)
    return outline(img)


# ---------------------------------------------------------------- Phantom dagger
def phantom_dagger():
    img = new()
    blade = (90, 70, 130, 255)
    blade_l = (150, 130, 200, 255)
    blade_d = (50, 35, 80, 255)
    edge = (190, 175, 230, 255)
    grip = (35, 30, 45, 255)
    for i in range(8):
        x = 5 + i
        y = 9 - i
        px(img, x, y, blade)
        px(img, x, y - 1, edge)
        px(img, x + 1, y, blade_d)
        px(img, x - 1, y, blade_l)
    px(img, 13, 1, edge)
    # guard + grip
    for x, y in [(4, 9), (4, 10), (5, 10)]:
        px(img, x, y, blade_d)
    for i in range(3):
        px(img, 3 - i, 10 + i, grip)
        px(img, 4 - i, 11 + i, shade(grip, 1.5))
    return outline(img)


# ---------------------------------------------------------------- Phoenix feather
def phoenix_feather():
    img = new()
    o1 = (255, 150, 30, 255)
    o2 = (255, 210, 60, 255)
    r1 = (235, 70, 30, 255)
    spine = (255, 245, 200, 255)
    for i in range(12):
        x = 4 + i
        y = 13 - i
        px(img, x, y, spine)
    barbs = [
        (5, 11, r1), (4, 12, r1), (7, 10, o1), (5, 12, o1),
        (9, 8, o2), (7, 11, o2), (11, 6, o1), (9, 9, o1),
        (13, 4, o2), (11, 7, o2), (14, 3, r1), (12, 5, r1),
        (6, 9, o1), (8, 7, o2), (10, 5, o1),
    ]
    for x, y, c in barbs:
        px(img, x, y, c)
    px(img, 15, 1, o2)
    px(img, 15, 2, o1)
    return outline(img)


# ---------------------------------------------------------------- Void eye
def void_eye():
    img = new()
    sclera = (40, 20, 70, 255)
    iris = (130, 60, 220, 255)
    iris_l = (180, 120, 255, 255)
    pupil = (15, 5, 25, 255)
    glow = (90, 220, 200, 255)
    eye = [
        (6, 4), (7, 4), (8, 4), (9, 4),
        (4, 5), (5, 5), (6, 5), (7, 5), (8, 5), (9, 5), (10, 5), (11, 5),
        (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (11, 6), (12, 6),
        (3, 7), (4, 7), (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7), (11, 7), (12, 7),
        (4, 8), (5, 8), (6, 8), (7, 8), (8, 8), (9, 8), (10, 8), (11, 8),
        (6, 9), (7, 9), (8, 9), (9, 9),
    ]
    for x, y in eye:
        px(img, x, y, sclera)
    for x, y in [(6, 6), (7, 6), (8, 6), (9, 6), (6, 7), (7, 7), (8, 7), (9, 7)]:
        px(img, x, y, iris)
    px(img, 6, 6, iris_l)
    px(img, 6, 7, iris_l)
    for x, y in [(7, 6), (8, 6), (7, 7), (8, 7)]:
        px(img, x, y, pupil)
    px(img, 10, 6, glow)
    px(img, 5, 8, glow)
    return outline(img)


# ---------------------------------------------------------------- Blue fire particle
def blue_fire(size=16):
    """8 frame flipbook of blue flame, laid out horizontally => 128x16."""
    frames = 8
    sheet = Image.new("RGBA", (size * frames, size), T)
    core = (210, 245, 255, 255)
    mid = (90, 180, 255, 255)
    edge = (40, 90, 235, 255)
    deep = (20, 40, 160, 255)
    rng = random.Random(7)
    for f in range(frames):
        fr = new(size)
        cx = size / 2
        for y in range(size):
            ny = y / size  # 0 top .. 1 bottom
            width = (1.0 - abs(ny - 0.62)) * 7 + 2 + math.sin(f + y) * 0.8
            flick = math.sin(f * 0.9 + y * 0.7) * 1.4
            for x in range(size):
                d = abs(x - (cx + flick))
                if d < width:
                    t = d / max(width, 0.001)
                    h = 1.0 - ny
                    if t < 0.25 and h > 0.45:
                        c = core
                    elif t < 0.55:
                        c = mid
                    elif t < 0.8:
                        c = edge
                    else:
                        c = deep
                    if ny < 0.12 and rng.random() < 0.4:
                        continue
                    fr.putpixel((x, y), c)
        sheet.paste(fr, (f * size, 0))
    return sheet


# ---------------------------------------------------------------- pack icon
def pack_icon():
    size = 256
    img = Image.new("RGBA", (size, size), (18, 12, 30, 255))
    d = ImageDraw.Draw(img)
    # radial-ish glow background
    for r in range(size, 0, -2):
        t = r / size
        col = (int(20 + 120 * (1 - t)), int(10 + 40 * (1 - t)), int(40 + 160 * (1 - t)), 255)
        d.ellipse([size / 2 - r / 2, size / 2 - r / 2, size / 2 + r / 2, size / 2 + r / 2], fill=col)
    # central gem (scaled up version)
    g = gem().resize((140, 140), Image.NEAREST)
    img.alpha_composite(g, (58, 50))
    # eight radiating spark dots for the 8 powers
    colors = [(220, 60, 50), (40, 120, 255), (150, 225, 255), (255, 240, 120),
              (140, 110, 80), (150, 130, 200), (255, 150, 30), (130, 60, 220)]
    cx = cy = size / 2
    for i, c in enumerate(colors):
        a = i / 8 * math.tau - math.pi / 2
        x = cx + math.cos(a) * 100
        y = cy + math.sin(a) * 100
        d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=c + (255,))
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 255, 255, 255))
    return img


def main():
    os.makedirs(ITEMS, exist_ok=True)
    os.makedirs(PART, exist_ok=True)
    items = {
        "power_gem": gem(),
        "god_of_war": god_of_war(),
        "sonic_boots": sonic_boots(),
        "frost_scepter": frost_scepter(),
        "storm_hammer": storm_hammer(),
        "titan_gauntlet": titan_gauntlet(),
        "phantom_dagger": phantom_dagger(),
        "phoenix_feather": phoenix_feather(),
        "void_eye": void_eye(),
    }
    for name, im in items.items():
        save(im, os.path.join(ITEMS, name + ".png"))
    save(blue_fire(), os.path.join(PART, "blue_fire.png"))
    icon = pack_icon()
    save(icon, os.path.join(BP, "pack_icon.png"))
    save(icon, os.path.join(RP, "pack_icon.png"))


if __name__ == "__main__":
    main()
