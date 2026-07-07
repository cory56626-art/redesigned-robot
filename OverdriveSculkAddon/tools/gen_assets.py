#!/usr/bin/env python3
"""
Procedural texture generator for the Overdrive Sculk addon.

No third-party libraries required - a tiny pure-Python PNG encoder is used so
the addon can be built in any environment that ships CPython.

Every texture is deliberately abstract "corrupted sculk" noise.  This maps
cleanly onto the reused vanilla humanoid/creeper geometry (the creatures read
as sculk-infested rather than needing a hand-painted skin map) and gives the
custom block an animated, pulsing flipbook.
"""

import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.normpath(os.path.join(HERE, "..", "resource_pack"))
BP = os.path.normpath(os.path.join(HERE, "..", "behavior_pack"))


# --------------------------------------------------------------------------- #
#  Minimal PNG writer (RGBA, 8-bit)                                            #
# --------------------------------------------------------------------------- #
def write_png(path, width, height, pixels):
    """pixels: flat list of (r, g, b, a) tuples, length width*height."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) for each scanline
        row = pixels[y * width:(y + 1) * width]
        for (r, g, b, a) in row:
            raw += bytes((r & 255, g & 255, b & 255, a & 255))

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return out + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


# --------------------------------------------------------------------------- #
#  Tiny deterministic value-noise helpers                                     #
# --------------------------------------------------------------------------- #
def _rng(seed):
    state = seed & 0xFFFFFFFF

    def nxt():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        return state / 0x7FFFFFFF

    return nxt


def clamp(v, lo=0, hi=255):
    return max(lo, min(hi, int(v)))


def lerp(a, b, t):
    return a + (b - a) * t


def value_noise(seed, size):
    """Smoothed value noise in [0,1] on a size*size grid."""
    r = _rng(seed)
    cells = 4
    grid = [[r() for _ in range(cells + 2)] for _ in range(cells + 2)]
    out = [[0.0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            fx = x / size * cells
            fy = y / size * cells
            x0, y0 = int(fx), int(fy)
            tx, ty = fx - x0, fy - y0
            # smoothstep
            tx = tx * tx * (3 - 2 * tx)
            ty = ty * ty * (3 - 2 * ty)
            v00, v10 = grid[y0][x0], grid[y0][x0 + 1]
            v01, v11 = grid[y0 + 1][x0], grid[y0 + 1][x0 + 1]
            out[y][x] = lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
    return out


# --------------------------------------------------------------------------- #
#  Sculk texture builder                                                       #
# --------------------------------------------------------------------------- #
def sculk_texture(size, seed, base, mid, vein, glow, frames=1, vein_density=1.0):
    """
    Build a (size wide) x (size*frames tall) sculk texture.

    The base noise and veins are identical across every flipbook frame; only the
    glow speckles pulse, which produces a clean breathing / pulsing animation.
    """
    noise = value_noise(seed, size)
    detail = value_noise(seed * 7 + 13, size)

    # Persistent glow speckle centres.
    r = _rng(seed * 31 + 5)
    speckles = []
    n_speck = max(3, int(size * size * 0.02 * vein_density))
    for _ in range(n_speck):
        speckles.append((int(r() * size), int(r() * size), 0.5 + r()))

    # Vein paths - a few random walks that get drawn bright.
    veins = set()
    n_veins = max(2, int(size / 4 * vein_density))
    for _ in range(n_veins):
        x, y = int(r() * size), int(r() * size)
        length = int(size * (0.6 + r()))
        ang = r() * math.tau
        for _ in range(length):
            veins.add((x % size, y % size))
            ang += (r() - 0.5) * 1.2
            x += int(round(math.cos(ang)))
            y += int(round(math.sin(ang)))

    pixels = []
    for f in range(frames):
        pulse = 0.5 + 0.5 * math.sin(f / max(1, frames) * math.tau)
        for y in range(size):
            for x in range(size):
                n = noise[y][x]
                d = detail[y][x]
                t = 0.65 * n + 0.35 * d
                col = [lerp(base[c], mid[c], t) for c in range(3)]

                if (x, y) in veins:
                    vg = 0.55 + 0.45 * pulse
                    col = [lerp(col[c], vein[c], vg) for c in range(3)]

                # glow speckles
                best = 0.0
                for (sx, sy, si) in speckles:
                    dist = math.hypot(x - sx, y - sy)
                    if dist < 2.2:
                        best = max(best, (1 - dist / 2.2) * si)
                if best > 0:
                    g = min(1.0, best * (0.35 + 0.65 * pulse))
                    col = [lerp(col[c], glow[c], g) for c in range(3)]

                pixels.append((clamp(col[0]), clamp(col[1]), clamp(col[2]), 255))
    return pixels


# --------------------------------------------------------------------------- #
#  Palettes                                                                    #
# --------------------------------------------------------------------------- #
DARK = (7, 24, 30)
TEAL = (14, 74, 87)
CYAN = (28, 224, 208)
GLOW = (150, 255, 242)

GREEN_MID = (26, 78, 40)
GREEN_VEIN = (60, 230, 120)

BONE_MID = (120, 150, 150)
BONE_VEIN = (140, 255, 240)

CREEP_MID = (20, 90, 44)
CREEP_VEIN = (40, 245, 130)

PURPLE_MID = (48, 22, 74)
PURPLE_VEIN = (150, 60, 245)


def solid_glow_block(size, seed, core, edge, glow):
    """The Overdrive Node - a small pulsing 'heart' block."""
    noise = value_noise(seed, size)
    pixels = []
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            dist = math.hypot(x - c, y - c) / (size / 2)
            n = noise[y][x]
            if dist < 0.35 + 0.1 * n:
                col = glow
            elif dist < 0.7:
                col = [lerp(core[i], glow[i], 1 - dist) for i in range(3)]
            else:
                col = [lerp(edge[i], core[i], n) for i in range(3)]
            pixels.append((clamp(col[0]), clamp(col[1]), clamp(col[2]), 255))
    return pixels


def pack_icon(size, seed):
    noise = value_noise(seed, size)
    detail = value_noise(seed * 3 + 1, size)
    r = _rng(seed * 17)
    speck = [(int(r() * size), int(r() * size)) for _ in range(size // 3)]
    pixels = []
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            dist = math.hypot(x - c, y - c) / (size / 2)
            t = 0.6 * noise[y][x] + 0.4 * detail[y][x]
            col = [lerp(DARK[i], TEAL[i], t) for i in range(3)]
            col = [lerp(col[i], DARK[i], min(1, dist)) for i in range(3)]
            for (sx, sy) in speck:
                if math.hypot(x - sx, y - sy) < 1.6:
                    col = [lerp(col[i], GLOW[i], 0.8) for i in range(3)]
            pixels.append((clamp(col[0]), clamp(col[1]), clamp(col[2]), 255))
    return pixels


# --------------------------------------------------------------------------- #
#  Emit all assets                                                             #
# --------------------------------------------------------------------------- #
def main():
    # Animated block (4-frame pulsing flipbook, stacked vertically).
    write_png(os.path.join(RP, "textures/blocks/overdrive_sculk.png"),
              16, 64, sculk_texture(16, 101, DARK, TEAL, CYAN, GLOW, frames=4, vein_density=1.4))

    # Overdrive node "mini heart" block.
    write_png(os.path.join(RP, "textures/blocks/overdrive_node.png"),
              16, 16, solid_glow_block(16, 202, (120, 12, 44), DARK, (255, 70, 120)))

    # Entity textures (abstract corrupted-sculk skins over reused geometry).
    write_png(os.path.join(RP, "textures/entity/infected_zombie.png"),
              64, 64, sculk_texture(64, 301, DARK, GREEN_MID, GREEN_VEIN, GLOW, vein_density=1.1))
    write_png(os.path.join(RP, "textures/entity/infected_skeleton.png"),
              64, 64, sculk_texture(64, 302, (18, 30, 34), BONE_MID, BONE_VEIN, GLOW, vein_density=1.1))
    write_png(os.path.join(RP, "textures/entity/infected_creeper.png"),
              64, 32, sculk_texture(64, 303, DARK, CREEP_MID, CREEP_VEIN, GLOW, vein_density=1.2))
    write_png(os.path.join(RP, "textures/entity/overdrive_tentacle.png"),
              32, 32, sculk_texture(32, 404, DARK, PURPLE_MID, PURPLE_VEIN, GLOW, vein_density=1.6))
    # 16 wide x 32 tall: two stacked frames give exactly 512 px for the 16x32 PNG.
    write_png(os.path.join(RP, "textures/entity/overdrive_vine.png"),
              16, 32, sculk_texture(16, 505, DARK, TEAL, CYAN, GLOW, frames=2, vein_density=2.0))

    # Pack icons.
    icon = pack_icon(128, 900)
    write_png(os.path.join(RP, "pack_icon.png"), 128, 128, icon)
    write_png(os.path.join(BP, "pack_icon.png"), 128, 128, icon)

    print("Generated all textures and pack icons.")


if __name__ == "__main__":
    main()
