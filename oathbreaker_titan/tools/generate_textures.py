#!/usr/bin/env python3
"""Procedurally generates all textures for the Oathbreaker Titan addon."""
import random
import os
from PIL import Image, ImageDraw

random.seed(41)

ROOT = os.path.join(os.path.dirname(__file__), "..")
RP = os.path.join(ROOT, "OathbreakerTitan_RP")
BP = os.path.join(ROOT, "OathbreakerTitan_BP")

# ----------------------------------------------------------------------
# Box-UV regions of the titan geometry: name -> (u, v, w, h, d)
# painted rect is (u, v, u + 2*(w+d), v + d + h)
# ----------------------------------------------------------------------
REGIONS = {
    "head":       (0, 0, 10, 10, 10),
    "body":       (0, 32, 18, 16, 10),
    "arm_r":      (64, 0, 6, 24, 7),
    "arm_l":      (90, 0, 6, 24, 7),
    "pauldron_r": (0, 64, 10, 9, 11),
    "pauldron_l": (42, 64, 10, 9, 11),
    "core":       (80, 40, 6, 7, 2),
    "blade":      (104, 40, 3, 36, 2),
    "hilt":       (80, 75, 2, 10, 2),
    "guard":      (96, 80, 8, 3, 5),
    "horn_r":     (64, 90, 2, 7, 3),
    "horn_l":     (80, 90, 2, 7, 3),
    "leg_r":      (0, 90, 8, 30, 8),
    "leg_l":      (32, 90, 8, 30, 8),
}


def region_rect(name):
    u, v, w, h, d = REGIONS[name]
    return (u, v, u + 2 * (w + d), v + d + h)


def clamp(x):
    return max(0, min(255, int(x)))


def noisy_fill(px, rect, base, jitter=12):
    x0, y0, x1, y1 = rect
    for x in range(x0, x1):
        for y in range(y0, y1):
            j = random.randint(-jitter, jitter)
            px[x, y] = (clamp(base[0] + j), clamp(base[1] + j), clamp(base[2] + j), 255)


def crack_veins(px, rect, count, hot=False):
    """Molten crack veins: random walks in ember orange."""
    x0, y0, x1, y1 = rect
    for _ in range(count):
        x = random.randint(x0, x1 - 1)
        y = random.randint(y0, y1 - 1)
        length = random.randint(4, 12)
        for _ in range(length):
            heat = random.random()
            if hot or heat > 0.55:
                c = (255, random.randint(150, 220), random.randint(20, 60), 255)
            else:
                c = (220, random.randint(70, 110), 15, 255)
            if x0 <= x < x1 and y0 <= y < y1:
                px[x, y] = c
            x += random.choice((-1, 0, 1))
            y += random.choice((-1, 0, 1))
            x = max(x0, min(x1 - 1, x))
            y = max(y0, min(y1 - 1, y))


def titan_texture(rage=False):
    img = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    px = img.load()

    basalt = (48, 42, 45)
    basalt_hot = (58, 44, 40)
    steel = (118, 118, 130)
    bone = (72, 62, 58)
    molten = (255, 150, 30)

    body_regions = ["head", "body", "arm_r", "arm_l", "pauldron_r",
                    "pauldron_l", "leg_r", "leg_l"]
    for name in body_regions:
        r = region_rect(name)
        noisy_fill(px, r, basalt_hot if rage else basalt, jitter=10)
        area = (r[2] - r[0]) * (r[3] - r[1])
        crack_veins(px, r, max(2, area // (40 if rage else 90)), hot=rage)

    # horns: charred bone
    for name in ("horn_r", "horn_l"):
        noisy_fill(px, region_rect(name), bone, jitter=8)

    # hilt: dark leather wrap
    noisy_fill(px, region_rect("hilt"), (52, 36, 26), jitter=8)
    # guard: bronze
    noisy_fill(px, region_rect("guard"), (140, 96, 40), jitter=10)

    # blade: steel with a molten edge running along it
    br = region_rect("blade")
    noisy_fill(px, br, steel, jitter=10)
    u, v, w, h, d = REGIONS["blade"]
    # box UV: front face at (u+d, v+d) size (w, h); edge columns of every face
    for face_u in (u + d, u + d + w + d):  # front and back faces
        for y in range(v + d, v + d + h):
            glow = random.random()
            edge = (255, clamp(140 + glow * 100), 20, 255)
            if face_u < 128:
                px[face_u, y] = edge  # molten edge column
            if face_u + w - 1 < 128:
                px[face_u + w - 1, y] = (200, 200, 215, 255)  # honed edge

    # chest core: white-hot center fading to ember
    cr = region_rect("core")
    cx = (cr[0] + cr[2]) / 2
    cy = (cr[1] + cr[3]) / 2
    for x in range(cr[0], cr[2]):
        for y in range(cr[1], cr[3]):
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            t = min(1.0, dist / 6.0)
            r_ = clamp(255)
            g = clamp(240 - t * 130)
            b = clamp(180 - t * 160)
            px[x, y] = (r_, g, b, 255)

    # glowing eyes on the head front face
    u, v, w, h, d = REGIONS["head"]
    fu, fv = u + d, v + d
    eye = (255, 40, 20, 255) if rage else (255, 170, 40, 255)
    for ex in (fu + 2, fu + 3, fu + 6, fu + 7):
        for ey in (fv + 4, fv + 5):
            px[ex, ey] = eye

    # jaw shadow
    for x in range(fu + 2, fu + 8):
        px[x, fv + 8] = (25, 20, 22, 255)

    return img


def item_base():
    return Image.new("RGBA", (16, 16), (0, 0, 0, 0))


def tex_titan_core():
    img = item_base()
    px = img.load()
    for x in range(16):
        for y in range(16):
            dx, dy = x - 7.5, y - 7.5
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < 6.5:
                t = dist / 6.5
                px[x, y] = (255, clamp(235 - t * 150), clamp(160 - t * 150), 255)
            elif dist < 7.4:
                px[x, y] = (60, 45, 48, 255)
    # dark crust flecks
    for _ in range(10):
        x, y = random.randint(3, 12), random.randint(3, 12)
        if px[x, y][3]:
            px[x, y] = (70, 45, 40, 255)
    return img


def tex_forged_oath():
    img = item_base()
    px = img.load()
    # rolled scroll
    for x in range(3, 13):
        for y in range(1, 15):
            px[x, y] = (222, 202, 160, 255)
    for y in range(1, 15):  # rolled ends
        px[3, y] = (180, 158, 118, 255)
        px[12, y] = (180, 158, 118, 255)
    # oath script lines
    for y in (4, 6, 8):
        for x in range(5, 11):
            if random.random() > 0.3:
                px[x, y] = (90, 70, 50, 255)
    # molten wax seal
    for x in range(6, 11):
        for y in range(10, 15):
            dx, dy = x - 8, y - 12
            if dx * dx + dy * dy <= 5:
                px[x, y] = (200, 40, 30, 255)
    px[8, 12] = (255, 160, 40, 255)
    return img


def tex_titan_crest():
    img = item_base()
    px = img.load()
    # shield-crest shape
    for y in range(1, 15):
        half = 6 if y < 9 else max(1, 6 - (y - 9))
        for x in range(8 - half, 8 + half):
            px[x, y] = (190, 150, 50, 255)
    # border
    for y in range(1, 15):
        half = 6 if y < 9 else max(1, 6 - (y - 9))
        px[8 - half, y] = (120, 90, 30, 255)
        px[8 + half - 1, y] = (120, 90, 30, 255)
    # molten sigil (broken chain V)
    for i in range(4):
        px[5 + i, 4 + i] = (230, 60, 30, 255)
        px[10 - i, 4 + i] = (230, 60, 30, 255)
    px[7, 8] = (255, 160, 40, 255)
    px[8, 8] = (255, 160, 40, 255)
    return img


def tex_oathbreaker_blade():
    img = item_base()
    px = img.load()
    # diagonal greatsword: blade from bottom-left grip to top-right tip
    for i in range(9):
        x, y = 6 + i, 9 - i
        # 2-px wide dark steel blade
        for off in ((0, 0), (1, 0), (0, -1)):
            xx, yy = x + off[0], y + off[1]
            if 0 <= xx < 16 and 0 <= yy < 16:
                px[xx, yy] = (95, 95, 110, 255)
        # molten edge
        if 0 <= x - 1 < 16 and 0 <= y + 1 < 16:
            px[x - 1, y + 1] = (255, 140, 25, 255)
    px[15, 0] = (230, 230, 240, 255)  # tip glint
    # crossguard
    for off in range(-1, 3):
        if 0 <= 5 + off < 16 and 0 <= 11 - off < 16:
            px[4 + off, 10 - off] = (150, 100, 40, 255)
            px[5 + off, 11 - off] = (150, 100, 40, 255)
    # grip
    for i in range(3):
        px[3 - i, 12 + i] = (60, 40, 28, 255)
        px[4 - i, 13 + i] = (60, 40, 28, 255) if 13 + i < 16 else px[0, 15]
    px[1, 15] = (255, 150, 30, 255)  # pommel ember
    return img


def tex_molten_heart():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 255))
    px = img.load()
    for x in range(16):
        for y in range(16):
            j = random.randint(-8, 8)
            px[x, y] = (clamp(45 + j), clamp(38 + j), clamp(40 + j), 255)
    # lava cracks
    crack_veins(px, (0, 0, 16, 16), 6, hot=True)
    # glowing heart in the center
    heart = [
        (7, 5), (8, 5), (10, 5), (11, 5),
        (6, 6), (9, 6), (12, 6),
        (6, 7), (12, 7),
        (7, 8), (11, 8),
        (8, 9), (10, 9),
        (9, 10),
    ]
    for x, y in heart:
        px[x, y] = (255, 60, 30, 255)
    inner = [(8, 6), (10, 6), (7, 7), (8, 7), (9, 7), (10, 7), (11, 7),
             (8, 8), (9, 8), (10, 8), (9, 9)]
    for x, y in inner:
        px[x, y] = (255, 190, 60, 255)
    return img


def pack_icon(bg, accent):
    img = Image.new("RGBA", (256, 256), bg)
    d = ImageDraw.Draw(img)
    px = img.load()
    for x in range(0, 256, 4):
        for y in range(0, 256, 4):
            j = random.randint(-10, 10)
            for xx in range(x, min(256, x + 4)):
                for yy in range(y, min(256, y + 4)):
                    r, g, b, a = px[xx, yy]
                    px[xx, yy] = (clamp(r + j), clamp(g + j), clamp(b + j), 255)
    # greatsword silhouette
    d.polygon([(128, 20), (144, 40), (140, 160), (116, 160), (112, 40)], fill=(70, 70, 82))
    d.polygon([(128, 20), (144, 40), (140, 160), (128, 160)], fill=(95, 95, 110))
    d.line([(128, 24), (128, 158)], fill=accent, width=6)
    d.rectangle([84, 160, 172, 176], fill=(140, 96, 40))
    d.rectangle([120, 176, 136, 224], fill=(60, 40, 28))
    d.ellipse([116, 222, 140, 246], fill=accent)
    # ember specks
    for _ in range(60):
        x, y = random.randint(8, 247), random.randint(8, 247)
        c = (255, random.randint(120, 200), 30, 255)
        d.ellipse([x, y, x + 2, y + 2], fill=c)
    return img


def save(img, *path):
    p = os.path.join(*path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)
    print("wrote", os.path.relpath(p, ROOT))


save(titan_texture(False), RP, "textures/entity/oathbreaker_titan.png")
save(titan_texture(True), RP, "textures/entity/oathbreaker_titan_rage.png")
save(tex_titan_core(), RP, "textures/items/titan_core.png")
save(tex_forged_oath(), RP, "textures/items/forged_oath.png")
save(tex_titan_crest(), RP, "textures/items/titan_crest.png")
save(tex_oathbreaker_blade(), RP, "textures/items/oathbreaker_blade.png")
save(tex_molten_heart(), RP, "textures/blocks/molten_heart.png")
save(pack_icon((28, 20, 24, 255), (255, 120, 20, 255)), BP, "pack_icon.png")
save(pack_icon((20, 24, 32, 255), (255, 160, 40, 255)), RP, "pack_icon.png")
print("done")
