#!/usr/bin/env python3
"""Generate all PNG textures for the Copper Crusader add-on (no external deps)."""
import os, struct, zlib, math, random

RP = os.path.join(os.path.dirname(__file__), "..", "resource_pack")

# Copper palette
BASE   = (184, 115,  51, 255)
LIGHT  = (224, 151,  90, 255)
DARK   = (122,  74,  32, 255)
DARKER = ( 84,  50,  20, 255)
OXID   = ( 95, 211, 107, 255)
OXID2  = ( 79, 184, 122, 255)
GLINT  = (255, 224, 160, 255)
CLEAR  = (0, 0, 0, 0)


class Img:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = [[CLEAR for _ in range(w)] for _ in range(h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def save(self, path):
        raw = bytearray()
        for row in self.px:
            raw.append(0)
            for (r, g, b, a) in row:
                raw += bytes((r, g, b, a))
        comp = zlib.compress(bytes(raw), 9)

        def chunk(tag, data):
            return (struct.pack(">I", len(data)) + tag + data +
                    struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

        ihdr = struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + \
            chunk(b"IDAT", comp) + chunk(b"IEND", b"")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(png)
        print("wrote", os.path.relpath(path))


def shade(img, jitter=True):
    """Add light/dark copper speckle to opaque pixels for a metallic look."""
    random.seed(7)
    for y in range(img.h):
        for x in range(img.w):
            if img.px[y][x][3] == 0:
                continue
            if jitter and random.random() < 0.18:
                img.px[y][x] = LIGHT if random.random() < 0.5 else DARK


# ---------- item icons (16x16) ----------

def sword():
    im = Img(16, 16)
    # blade along anti-diagonal
    for i in range(10):
        x, y = 4 + i, 11 - i
        im.set(x, y, LIGHT)
        im.set(x + 1, y, BASE)
        im.set(x, y + 1, BASE)
        im.set(x + 1, y + 1, DARK)
    # tip
    im.set(14, 1, LIGHT); im.set(15, 1, LIGHT); im.set(15, 0, LIGHT)
    # crossguard
    im.rect(2, 11, 6, 12, DARK)
    im.set(3, 10, OXID); im.set(5, 13, OXID2)
    # handle
    im.rect(2, 12, 4, 14, DARKER)
    im.set(2, 14, BASE)
    return im


def helmet():
    im = Img(16, 16)
    im.rect(3, 3, 12, 9, BASE)
    im.rect(3, 3, 12, 4, LIGHT)
    im.rect(3, 10, 4, 12, BASE)
    im.rect(11, 10, 12, 12, BASE)
    im.rect(6, 6, 9, 8, DARKER)  # visor
    im.set(4, 4, OXID); im.set(11, 8, OXID2); im.set(7, 10, OXID)
    return im


def chestplate():
    im = Img(16, 16)
    im.rect(3, 3, 12, 13, BASE)
    im.rect(3, 3, 12, 3, LIGHT)
    im.rect(5, 3, 10, 5, DARK)   # collar
    im.rect(1, 4, 2, 9, BASE)    # shoulders
    im.rect(13, 4, 14, 9, BASE)
    im.set(8, 8, DARKER)
    im.set(4, 5, OXID); im.set(11, 11, OXID2); im.set(7, 12, OXID)
    return im


def leggings():
    im = Img(16, 16)
    im.rect(3, 2, 12, 4, BASE)
    im.rect(3, 5, 7, 14, BASE)
    im.rect(8, 5, 12, 14, BASE)
    im.rect(3, 2, 12, 2, LIGHT)
    im.set(5, 7, OXID); im.set(10, 11, OXID2); im.set(4, 13, OXID)
    return im


def boots():
    im = Img(16, 16)
    im.rect(3, 5, 6, 13, BASE)
    im.rect(9, 5, 12, 13, BASE)
    im.rect(3, 12, 7, 14, DARK)
    im.rect(9, 12, 13, 14, DARK)
    im.set(4, 7, OXID); im.set(10, 9, OXID2)
    return im


# ---------- entity textures ----------

def statue_tex():
    im = Img(64, 64)
    im.rect(0, 0, 63, 63, BASE)
    # oxidation streaks
    random.seed(3)
    for _ in range(120):
        x = random.randint(0, 63); y = random.randint(0, 63)
        im.set(x, y, OXID if random.random() < 0.5 else OXID2)
    for _ in range(160):
        x = random.randint(0, 63); y = random.randint(0, 63)
        im.set(x, y, DARK if random.random() < 0.5 else LIGHT)
    return im


def shard_tex():
    im = Img(16, 16)
    im.rect(0, 0, 15, 15, BASE)
    for y in range(16):
        for x in range(16):
            if (x + y) % 4 == 0:
                im.set(x, y, LIGHT)
            elif (x + y) % 5 == 0:
                im.set(x, y, OXID)
    return im


# ---------- armor layers (64x32) ----------

def armor_layer():
    im = Img(64, 32)
    im.rect(0, 0, 63, 31, BASE)
    random.seed(11)
    for _ in range(220):
        x = random.randint(0, 63); y = random.randint(0, 31)
        r = random.random()
        im.set(x, y, OXID if r < 0.15 else (LIGHT if r < 0.55 else DARK))
    return im


def pack_icon():
    im = Img(128, 128)
    im.rect(0, 0, 127, 127, DARKER)
    im.rect(8, 8, 119, 119, BASE)
    # simple sword
    for i in range(70):
        x = 28 + i; y = 96 - i
        im.rect(x, y, x + 6, y + 6, LIGHT)
    im.rect(20, 84, 44, 96, DARK)
    random.seed(5)
    for _ in range(400):
        x = random.randint(8, 119); y = random.randint(8, 119)
        if im.px[y][x][3]:
            im.set(x, y, OXID if random.random() < 0.2 else im.px[y][x])
    return im


def main():
    sh = sword();      shade(sh);  sh.save(os.path.join(RP, "textures/items/copper_crusader_sword.png"))
    for name, fn in [("helmet", helmet), ("chestplate", chestplate),
                     ("leggings", leggings), ("boots", boots)]:
        im = fn(); shade(im)
        im.save(os.path.join(RP, f"textures/items/copper_crusader_{name}.png"))

    statue_tex().save(os.path.join(RP, "textures/entity/relic_statue.png"))
    shard_tex().save(os.path.join(RP, "textures/entity/copper_shard.png"))

    armor_layer().save(os.path.join(RP, "textures/models/armor/copper_crusader_layer_1.png"))
    armor_layer().save(os.path.join(RP, "textures/models/armor/copper_crusader_layer_2.png"))

    pack_icon().save(os.path.join(RP, "pack_icon.png"))
    # behavior pack icon (same image)
    bp = os.path.join(RP, "..", "behavior_pack", "pack_icon.png")
    pack_icon().save(bp)


if __name__ == "__main__":
    main()
