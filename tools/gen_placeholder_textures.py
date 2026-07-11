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


# --- Phase 1 "Crimson Waltz": elegant crimson regalia, ivory mask, bare left arm
P1 = {
    "body":      (107, 15, 26),    # deep crimson regalia
    "cloak":     (63, 10, 18),     # darker maroon cloak
    "head":      (232, 224, 208),  # ivory mask
    "right_arm": (94, 13, 24),     # sleeved sword arm
    "left_arm":  (216, 180, 154),  # the bare arm
    "blade":     (200, 204, 212),  # steel
    "right_leg": (44, 34, 40),
    "left_leg":  (44, 34, 40),
}

# --- Phase 2 "The Frenzy": torn, blood-soaked, glowing mask, beast arm fur
P2 = {
    "body":      (74, 8, 14),
    "cloak":     (38, 5, 9),
    "head":      (190, 175, 160),
    "right_arm": (66, 8, 14),
    "left_arm":  (52, 34, 26),     # beast arm: dark fur
    "blade":     (176, 170, 178),
    "right_leg": (30, 20, 24),
    "left_leg":  (30, 20, 24),
}


def eyes(front_u, front_v, put, color):
    """Stamp a pair of eyes on the head's front face (8-wide at uv+ (8, 8))."""
    for ex in (2, 5):
        put(front_u + ex, front_v + 3, color + (255,))
        put(front_u + ex + 1, front_v + 3, color + (255,))


def decorate_p1(bone, geo, put):
    if bone == "head":
        # dark eye slits in the ivory mask (head cube uv [0,0], size 8x9x8 -> front at 8,8)
        eyes(8, 8, put, (40, 20, 24))
    if bone == "body":
        # gold trim rows across the regalia front (body uv [0,32], sz≈7 -> front at ~7,39)
        d = geo["description"]
        for yy in (42, 48):
            for xx in range(8, 20):
                put(xx, yy, (212, 175, 55, 255))


def decorate_p2(bone, geo, put):
    if bone == "head":
        # glowing red eyes
        eyes(8, 8, put, (255, 40, 40))
    if bone == "body":
        # blood streaks down the torso front
        for xx in (9, 13, 17):
            for yy in range(40, 52):
                put(xx, yy, (140, 10, 16, 255))


paint_geo(os.path.join(ROOT, "RP/models/entity/marauder.geo.json"),
          os.path.join(ROOT, "RP/textures/entity/marauder.png"),
          P1, (90, 20, 30), seed=7, decorate=decorate_p1)

paint_geo(os.path.join(ROOT, "RP/models/entity/marauder_beast.geo.json"),
          os.path.join(ROOT, "RP/textures/entity/marauder_frenzied.png"),
          P2, (60, 12, 18), seed=13, decorate=decorate_p2)
