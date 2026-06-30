#!/usr/bin/env python3
"""Generate the Auto Enchanter item textures and pack icons (no external assets)."""
import os
from PIL import Image, ImageDraw

RP = os.path.join(os.path.dirname(__file__), "AutoEnchanter_RP")
BP = os.path.join(os.path.dirname(__file__), "AutoEnchanter_BP")
ITEMS = os.path.join(RP, "textures", "items")
os.makedirs(ITEMS, exist_ok=True)


def px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c)


def book_base(cover, cover_dark, cover_light):
    """A 16x16 enchanted tome facing the viewer. Returns an RGBA image."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    page = (242, 235, 211, 255)
    page_dark = (197, 186, 156, 255)
    outline = (24, 18, 30, 255)

    # Cover body
    for y in range(2, 14):
        for x in range(3, 13):
            img.putpixel((x, y), cover)
    # Shading: left highlight column, right shadow column
    for y in range(2, 14):
        px(img, 3, y, cover_light)
        px(img, 12, y, cover_dark)
    # Top/bottom edge shading
    for x in range(3, 13):
        px(img, x, 2, cover_light)
        px(img, x, 13, cover_dark)

    # Page block peeking on the right
    for y in range(3, 13):
        px(img, 13, y, page)
        px(img, 14, y, page_dark)
    # page lines
    for y in (4, 6, 8, 10):
        px(img, 13, y, page_dark)

    # Spine band on the left
    for y in range(2, 14):
        px(img, 4, y, cover_dark)

    # Outline
    for x in range(3, 15):
        px(img, x, 1, outline)
        px(img, x, 14, outline)
    for y in range(1, 15):
        px(img, 2, y, outline)
        px(img, 15, y, outline)
    px(img, 2, 1, outline)
    return img


def add_sparkles(img):
    star = (235, 225, 255, 255)
    glow = (170, 120, 235, 255)
    for (sx, sy) in [(1, 3), (14, 1), (0, 9), (15, 11)]:
        px(img, sx, sy, star)
        px(img, sx + 1, sy, glow)
        px(img, sx, sy + 1, glow)


def emblem_pickaxe(img):
    """Tools emblem: a small pickaxe."""
    head = (210, 214, 222, 255)
    head_d = (150, 156, 168, 255)
    handle = (120, 78, 40, 255)
    handle_d = (90, 56, 28, 255)
    # pick head (curved bar near top)
    for (x, y) in [(6, 4), (7, 4), (8, 4), (9, 4), (5, 5), (10, 5)]:
        px(img, x, y, head)
    px(img, 5, 5, head_d)
    px(img, 10, 5, head_d)
    # handle diagonal
    for i, (x, y) in enumerate([(8, 5), (8, 6), (7, 7), (7, 8), (6, 9), (6, 10), (5, 11)]):
        px(img, x, y, handle if i % 2 == 0 else handle_d)


def emblem_sword(img):
    """PVP emblem: a vertical sword."""
    blade = (224, 228, 236, 255)
    blade_d = (158, 164, 178, 255)
    guard = (196, 150, 60, 255)
    grip = (108, 70, 36, 255)
    # blade
    for y in range(3, 9):
        px(img, 8, y, blade)
        px(img, 9, y, blade_d)
    px(img, 8, 3, (245, 248, 255, 255))  # tip shine
    # crossguard
    for x in range(6, 12):
        px(img, x, 9, guard)
    # grip
    px(img, 8, 10, grip)
    px(img, 9, 10, grip)
    px(img, 8, 11, grip)
    px(img, 9, 11, grip)
    px(img, 8, 12, (60, 60, 70, 255))  # pommel


# ---- Tools: blue tome + pickaxe ----
tools = book_base((46, 102, 178, 255), (28, 64, 120, 255), (96, 158, 224, 255))
emblem_pickaxe(tools)
add_sparkles(tools)
tools.save(os.path.join(ITEMS, "enchanter_tools.png"))

# ---- PVP: red tome + sword ----
pvp = book_base((176, 46, 52, 255), (118, 26, 32, 255), (224, 96, 96, 255))
emblem_sword(pvp)
add_sparkles(pvp)
pvp.save(os.path.join(ITEMS, "enchanter_pvp.png"))


def pack_icon(path, bg_top, bg_bot):
    """128x128 icon: gradient background with both tomes scaled up."""
    size = 128
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    d = ImageDraw.Draw(icon)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(bg_top[i] * (1 - t) + bg_bot[i] * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))
    # subtle enchant sparkles in the background
    for (sx, sy, s) in [(18, 22, 2), (104, 16, 2), (22, 100, 2), (110, 96, 3), (64, 12, 2)]:
        d.rectangle([sx, sy, sx + s, sy + s], fill=(220, 205, 255, 255))
    # paste the two tomes, scaled (nearest = crisp pixels)
    big_t = tools.resize((56, 56), Image.NEAREST)
    big_p = pvp.resize((56, 56), Image.NEAREST)
    icon.alpha_composite(big_t, (12, 36))
    icon.alpha_composite(big_p, (60, 36))
    icon.convert("RGBA").save(path)


pack_icon(os.path.join(BP, "pack_icon.png"), (58, 32, 96), (20, 14, 40))
pack_icon(os.path.join(RP, "pack_icon.png"), (58, 32, 96), (20, 14, 40))

print("Textures + icons written:")
for p in [
    os.path.join(ITEMS, "enchanter_tools.png"),
    os.path.join(ITEMS, "enchanter_pvp.png"),
    os.path.join(BP, "pack_icon.png"),
    os.path.join(RP, "pack_icon.png"),
]:
    print(" -", p, os.path.getsize(p), "bytes")
