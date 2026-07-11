#!/usr/bin/env python3
"""Generate placeholder textures for The Marauder, painted per-bone from the
geometry's box-UV layout so every face of the model gets a sensible color.

No dependencies (hand-rolled PNG writer). Rerun after changing the geo files:
    python3 tools/gen_placeholder_textures.py
Replace the output PNGs with hand-painted art whenever you're ready — these
are just so the boss never renders as missing-texture magenta/black.
"""
import json
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def write_png(path, width, height, pixels):
    """pixels: list of rows, each row a bytearray of RGBA."""
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def noise(x, y, seed):
    """Deterministic per-pixel hash noise in [0, 1)."""
    n = (x * 374761393 + y * 668265263 + seed * 987654323) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65536.0


def shade(color, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in color)


# face rectangles of a standard Bedrock box unwrap: (dx, dy, w, h, light)
def box_faces(sx, sy, sz):
    return [
        (sz, 0, sx, sz, 1.15),                 # top (lit)
        (sz + sx, 0, sx, sz, 0.70),            # bottom (shadow)
        (0, sz, sz, sy, 0.90),                 # right
        (sz, sz, sx, sy, 1.00),                # front
        (sz + sx, sz, sz, sy, 0.90),           # left
        (sz + sx + sz, sz, sx, sy, 0.82),      # back
    ]


def paint_geo(geo_path, out_path, palette, default_color, seed, decorate=None):
    geo = json.load(open(geo_path))["minecraft:geometry"][0]
    desc = geo["description"]
    W, H = desc["texture_width"], desc["texture_height"]
    px = [bytearray([0, 0, 0, 0] * W) for _ in range(H)]

    def put(x, y, rgba):
        if 0 <= x < W and 0 <= y < H:
            px[y][x * 4:x * 4 + 4] = bytes(rgba)

    for bone in geo["bones"]:
        base = palette.get(bone["name"], default_color)
        for cube in bone.get("cubes", []):
            u, v = (int(round(c)) for c in cube["uv"])
            sx, sy, sz = (max(1, int(round(c))) for c in cube["size"])
            for dx, dy, w, h, light in box_faces(sx, sy, sz):
                for yy in range(h):
                    for xx in range(w):
                        X, Y = u + dx + xx, v + dy + yy
                        f = light * (0.92 + 0.16 * noise(X, Y, seed))
                        # darken face borders a touch for cube definition
                        if xx == 0 or yy == 0 or xx == w - 1 or yy == h - 1:
                            f *= 0.82
                        put(X, Y, shade(base, f) + (255,))
        if decorate:
            decorate(bone["name"], geo, put)

    write_png(out_path, W, H, px)
    print("wrote", os.path.relpath(out_path, ROOT))


# --- Phase 1 "Crimson Waltz": Boreal-Dancer look — aged gold armor, ash-blue
#     flowing veil, dark steel helm under a crown, long ember-steel blade
P1 = {
    "body":      (146, 116, 58),   # aged engraved gold armor
    "cloak":     (128, 142, 164),  # ash-blue cape veil
    "veil":      (168, 180, 198),  # paler head veil
    "head":      (58, 54, 62),     # dark steel helm
    "crown":     (212, 175, 96),   # gold crown
    "right_arm": (110, 84, 48),    # bronze sword arm
    "left_arm":  (110, 84, 48),
    "blade":     (222, 150, 70),   # ember-lit steel
    "right_leg": (52, 48, 56),     # dark steel greaves
    "left_leg":  (52, 48, 56),
}

# --- Phase 2 "The Frenzy": Soul-of-Cinder look — charred armor, fire crown,
#     molten blade, ash veil, Watcher's parry dagger
P2 = {
    "body":      (46, 38, 34),
    "cloak":     (30, 22, 20),
    "veil":      (90, 82, 78),
    "head":      (40, 34, 32),
    "crown":     (255, 120, 30),   # crown of cinders
    "right_arm": (52, 40, 34),
    "left_arm":  (52, 40, 34),
    "blade":     (255, 140, 50),   # molten
    "dagger":    (180, 175, 180),  # steel parry dagger
    "right_leg": (36, 30, 28),
    "left_leg":  (36, 30, 28),
}


def visor(put, color):
    """Slit across the helm's front face (head cube uv [0,0], 8x8x8 -> front at 8,8)."""
    for ex in range(1, 7):
        put(8 + ex, 11, color + (255,))


def decorate_p1(bone, geo, put):
    if bone == "head":
        visor(put, (20, 16, 24))  # dark visor slit
    if bone == "body":
        # engraved trim lines across the gold cuirass (body uv [0,32], front at 6,38 w12 h20)
        for yy in (44, 50):
            for xx in range(7, 17):
                put(xx, yy, (96, 74, 34, 255))


def decorate_p2(bone, geo, put):
    if bone == "head":
        visor(put, (255, 70, 20))  # the visor burns
    if bone == "body":
        # ember cracks down the charred cuirass
        for xx, y0, y1 in ((8, 42, 50), (11, 40, 54), (14, 44, 52), (16, 41, 48)):
            for yy in range(y0, y1):
                put(xx, yy, (255, 100, 20, 255))


paint_geo(os.path.join(ROOT, "RP/models/entity/marauder.geo.json"),
          os.path.join(ROOT, "RP/textures/entity/marauder.png"),
          P1, (90, 80, 70), seed=7, decorate=decorate_p1)

paint_geo(os.path.join(ROOT, "RP/models/entity/marauder_beast.geo.json"),
          os.path.join(ROOT, "RP/textures/entity/marauder_frenzied.png"),
          P2, (50, 42, 38), seed=13, decorate=decorate_p2)
