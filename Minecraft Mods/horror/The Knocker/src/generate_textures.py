#!/usr/bin/env python3
"""
Generate The Knocker's entity skin (64x64) and the two pack icons.

The model uses the standard humanoid UV layout, so the entity texture is a
"skin": the whole body is near-black cloth (the robe/shirt) and only the HEAD
FRONT FACE carries the pale, gaunt, screaming face — exactly the brief:
white face, pale black body, face visible.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(__file__)
RP = os.path.join(HERE, "..", "Knocker_RP")
BP = os.path.join(HERE, "..", "Knocker_BP")
RNG = np.random.default_rng(7)

ROBE = (12, 12, 14)          # near-black cloth
ROBE_HI = (24, 24, 28)
PALE = (228, 226, 219)       # pale face
PALE_SHADOW = (150, 150, 146)
DARK = (10, 8, 9)            # eye sockets / mouth
BLOOD = (96, 20, 20)


def make_entity_texture():
    W = H = 64
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()

    # Fill every used skin region with cloth + subtle vertical streaks.
    # (Painting the whole sheet is simplest and safe — unused texels are hidden.)
    for y in range(H):
        for x in range(W):
            streak = int(6 * np.sin(x * 1.7) + 4 * (RNG.random() - 0.5))
            base = ROBE[0] + streak
            px[x, y] = (max(2, base), max(2, base), max(4, base + 2), 255)

    # ---- HEAD FRONT FACE: texels (8..15, 8..15) ----
    fx0, fy0 = 8, 8

    def face(lx, ly, color):
        px[fx0 + lx, fy0 + ly] = color + (255,)

    # pale base with a little vertical shading (gaunt cheeks at the sides)
    for ly in range(8):
        for lx in range(8):
            shade = 0
            if lx in (0, 7):
                shade = 55
            elif lx in (1, 6):
                shade = 18
            c = tuple(max(0, v - shade) for v in PALE)
            face(lx, ly, c)

    # hooded brow shadow across the top
    for lx in range(8):
        face(lx, 0, tuple(max(0, v - 90) for v in PALE))
    for lx in range(8):
        face(lx, 1, tuple(max(0, v - 40) for v in PALE))

    # eyes: deep black sunken sockets with a faint cold highlight
    for lx in (1, 2):
        face(lx, 3, DARK)
        face(lx, 4, DARK)
    for lx in (5, 6):
        face(lx, 3, DARK)
        face(lx, 4, DARK)
    face(2, 3, (40, 44, 52))   # tiny glint
    face(5, 3, (40, 44, 52))
    # under-eye hollows
    for lx in (1, 2, 5, 6):
        face(lx, 5, PALE_SHADOW)

    # nose ridge
    face(3, 4, tuple(max(0, v - 35) for v in PALE))
    face(4, 4, tuple(max(0, v - 20) for v in PALE))
    face(3, 5, tuple(max(0, v - 45) for v in PALE))

    # agape screaming mouth (dark) with a hint of blood at the corners
    for lx in (2, 3, 4, 5):
        face(lx, 6, DARK)
    for lx in (3, 4):
        face(lx, 7, DARK)
    face(2, 7, BLOOD)
    face(5, 7, BLOOD)

    img.save(os.path.join(RP, "textures", "entity", "knocker.png"))
    print("  wrote textures/entity/knocker.png (64x64)")


def make_pack_icon(path, subtitle):
    S = 256
    img = Image.new("RGBA", (S, S), (8, 8, 10, 255))
    d = ImageDraw.Draw(img)

    # vignette
    for r in range(S, 0, -2):
        a = int(60 * (r / S))
        d.ellipse([S/2 - r/2, S/2 - r/2, S/2 + r/2, S/2 + r/2], outline=(0, 0, 0, a))

    # pale gaunt face emerging from the dark
    cx, cy = S // 2, S // 2 - 8
    face = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(face)
    fd.ellipse([cx - 78, cy - 96, cx + 78, cy + 104], fill=(225, 223, 216, 255))
    face = face.filter(ImageFilter.GaussianBlur(6))
    img.alpha_composite(face)
    d = ImageDraw.Draw(img)

    # sunken eyes
    for ex in (cx - 34, cx + 34):
        d.ellipse([ex - 20, cy - 34, ex + 20, cy + 6], fill=(10, 9, 11, 255))
        d.ellipse([ex - 8, cy - 20, ex + 6, cy - 4], fill=(120, 20, 22, 255))   # red glint
        d.ellipse([ex - 4, cy - 16, ex + 0, cy - 10], fill=(220, 80, 80, 255))
    # screaming mouth
    d.ellipse([cx - 22, cy + 26, cx + 22, cy + 86], fill=(8, 7, 9, 255))
    d.ellipse([cx - 22, cy + 26, cx + 22, cy + 40], fill=(70, 16, 18, 255))

    # title
    try:
        d.text((14, 14), "THE", fill=(150, 20, 20, 255))
        d.text((14, 30), "KNOCKER", fill=(190, 30, 30, 255))
        d.text((14, S - 26), subtitle, fill=(120, 120, 124, 255))
    except Exception:
        pass

    img.save(path)
    print(f"  wrote {os.path.relpath(path, HERE)}")


if __name__ == "__main__":
    print("Generating textures:")
    os.makedirs(os.path.join(RP, "textures", "entity"), exist_ok=True)
    make_entity_texture()
    make_pack_icon(os.path.join(BP, "pack_icon.png"), "Behavior")
    make_pack_icon(os.path.join(RP, "pack_icon.png"), "Resources")
    print("Done.")
