import zlib, struct, os

def write_png(path, w, h, px):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            r, g, b, a = px[y][x]
            raw += bytes((r, g, b, a))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    out = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(out)

TRANSPARENT = (0, 0, 0, 0)
SKIN = (38, 24, 51, 255)        # dark blackish-purple body
SKIN_DARK = (26, 16, 38, 255)   # shadow shading
EYE = (138, 255, 116, 255)      # mischievous glowing green
EYE_CORE = (220, 255, 200, 255) # bright eye core
MOUTH = (150, 235, 120, 255)    # grin

def base_texture():
    w = h = 64
    px = [[TRANSPARENT for _ in range(w)] for _ in range(h)]

    def fill(x0, y0, x1, y1, col):
        for y in range(y0, y1):
            for x in range(x0, x1):
                if 0 <= x < w and 0 <= y < h:
                    px[y][x] = col

    # Standard biped (Steve) UV layout, base layer only.
    # Head: texOffset (0,0), 8x8x8 cube -> all six faces in the 0..32 x 0..16 region.
    fill(8, 0, 24, 8, SKIN)     # head top/bottom strip
    fill(0, 8, 32, 16, SKIN)    # head sides/front/back strip
    # Body: texOffset (16,16), 8x12x4
    fill(16, 16, 40, 20, SKIN)  # body top/bottom
    fill(16, 20, 40, 32, SKIN)  # body sides
    # Right arm: texOffset (40,16), 4x12x4
    fill(40, 16, 56, 20, SKIN_DARK)
    fill(40, 20, 56, 32, SKIN_DARK)
    # Left arm: texOffset (32,48)
    fill(32, 48, 48, 52, SKIN_DARK)
    fill(32, 52, 48, 64, SKIN_DARK)
    # Right leg: texOffset (0,16)
    fill(0, 16, 16, 20, SKIN_DARK)
    fill(0, 20, 16, 32, SKIN_DARK)
    # Left leg: texOffset (16,48)
    fill(16, 48, 32, 52, SKIN_DARK)
    fill(16, 52, 32, 64, SKIN_DARK)

    # ---- Face details on the head FRONT face: u[8..16), v[8..16) ----
    def p(x, y, col):
        px[y][x] = col

    # Eyes (angled, mischievous)
    for (ex, ey) in [(9, 10), (10, 10), (13, 10), (14, 10)]:
        p(ex, ey, EYE)
    p(10, 9, EYE)    # raised inner brow
    p(13, 9, EYE)
    p(10, 10, EYE_CORE)
    p(13, 10, EYE_CORE)

    # Wide toothy grin
    for gx in range(9, 15):
        p(gx, 13, MOUTH)
    p(9, 12, MOUTH)
    p(14, 12, MOUTH)
    p(10, 14, MOUTH)
    p(13, 14, MOUTH)

    return w, h, px

def icon_texture():
    # Simple 64x64 icon: dark background with the green grinning face.
    w = h = 64
    bg = (20, 12, 28, 255)
    px = [[bg for _ in range(w)] for _ in range(h)]
    def block(cx, cy, s, col):
        for y in range(cy, cy + s):
            for x in range(cx, cx + s):
                if 0 <= x < w and 0 <= y < h:
                    px[y][x] = col
    # head silhouette
    for y in range(14, 50):
        for x in range(14, 50):
            px[y][x] = SKIN
    # eyes
    block(20, 24, 6, EYE)
    block(38, 24, 6, EYE)
    block(22, 26, 2, EYE_CORE)
    block(40, 26, 2, EYE_CORE)
    # grin
    for x in range(20, 44):
        px[38][x] = MOUTH
        px[39][x] = MOUTH
    block(20, 34, 3, MOUTH)
    block(41, 34, 3, MOUTH)
    return w, h, px

here = os.path.dirname(os.path.abspath(__file__))
tex_dir = os.path.join(here, "src/main/resources/assets/lobber/textures/entity")
asset_dir = os.path.join(here, "src/main/resources/assets/lobber")

w, h, px = base_texture()
write_png(os.path.join(tex_dir, "lobber.png"), w, h, px)
print("wrote lobber.png")

w, h, px = icon_texture()
write_png(os.path.join(asset_dir, "icon.png"), w, h, px)
print("wrote icon.png")
