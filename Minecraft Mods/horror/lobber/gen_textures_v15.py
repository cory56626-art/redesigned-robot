import zlib, struct, os, math

def write_png(path, w, h, px):
    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw += bytes(px[y][x])
    out = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(out)

here = os.path.dirname(os.path.abspath(__file__))
ent = os.path.join(here, "src/main/resources/assets/lobber/textures/entity")
gui = os.path.join(here, "src/main/resources/assets/lobber/textures/gui")

# ---------------------------------------------------------------- adult skin
def adult():
    w = h = 64
    BASE = (165, 120, 120, 255)
    SHADE = (120, 85, 85, 255)
    RIB = (95, 62, 62, 255)
    DARK = (16, 9, 9, 255)
    LIGHT = (188, 142, 142, 255)
    px = [[BASE for _ in range(w)] for _ in range(h)]

    def setp(x, y, c):
        if 0 <= x < w and 0 <= y < h:
            px[y][x] = c

    # subtle vertical shading down the limb columns (arms x0-24, legs x32-60, rows 24-49)
    for y in range(24, 50):
        for x in range(0, 64):
            if px[y][x] == BASE and (x % 4 == 0):
                setp(x, y, SHADE)

    # ribcage front face: ribcage uv (0,8), size 6x12x3 -> front u3..8, v11..22
    for v in range(11, 23):
        for u in range(3, 9):
            setp(u, v, BASE if (v % 2 == 0) else LIGHT)
    for v in range(12, 23, 2):           # rib bones
        for u in range(3, 9):
            setp(u, v, RIB)

    # skull front face: skull uv (20,0), size 5x5x5 -> front u25..29, v5..9
    # sunken eyes
    for (ex, ey) in [(26, 6), (28, 6)]:
        setp(ex, ey, DARK)
        setp(ex, ey + 1, DARK)
    # wide grin
    for u in range(25, 30):
        setp(u, 8, DARK)
    setp(25, 7, DARK)
    setp(29, 7, DARK)
    # hollow temples / shading on skull sides
    for u in (20, 21, 38, 39):
        for v in range(5, 10):
            setp(u, v, SHADE)

    write_png(os.path.join(ent, "lobber_adult.png"), w, h, px)
    print("wrote lobber_adult.png")

# ---------------------------------------------------------------- face overlay
def face():
    w = h = 128
    px = [[(0, 0, 0, 0) for _ in range(w)] for _ in range(h)]

    PALE = (206, 205, 198)
    PALE_SHADE = (150, 150, 145)
    DARK = (10, 10, 13)

    cx, cy, rx, ry = 52.0, 64.0, 44.0, 60.0
    for y in range(h):
        for x in range(w):
            nx = (x - cx) / rx
            ny = (y - cy) / ry
            d = nx * nx + ny * ny
            if d <= 1.0:
                # right side fades into shadow (half-lit, like the reference)
                shade = max(0.0, min(1.0, (cx + rx - x) / (2 * rx)))
                edge = 1.0 - d
                a = int(255 * min(1.0, edge * 3.0) * (0.35 + 0.65 * shade))
                base = tuple(int(PALE[i] * (0.55 + 0.45 * shade)) for i in range(3))
                px[y][x] = (base[0], base[1], base[2], a)

    def blob(ccx, ccy, rrx, rry, color):
        for y in range(h):
            for x in range(w):
                nx = (x - ccx) / rrx
                ny = (y - ccy) / rry
                if nx * nx + ny * ny <= 1.0 and px[y][x][3] > 0:
                    px[y][x] = (color[0], color[1], color[2], 255)

    # hollow eyes
    blob(38, 50, 10, 13, DARK)
    blob(70, 50, 9, 12, DARK)
    # long thin nose shadow
    blob(52, 74, 4, 12, (60, 58, 58))
    # wide unsettling grin (crescent built from a big dark ellipse minus an upper one)
    for y in range(h):
        for x in range(w):
            if px[y][x][3] == 0:
                continue
            nx = (x - 52) / 34.0
            ny = (y - 92) / 20.0
            inside = nx * nx + ny * ny <= 1.0
            nx2 = (x - 52) / 34.0
            ny2 = (y - 84) / 18.0
            cut = nx2 * nx2 + ny2 * ny2 <= 1.0
            if inside and not cut:
                px[y][x] = (DARK[0], DARK[1], DARK[2], 255)

    write_png(os.path.join(gui, "lobber_face.png"), w, h, px)
    print("wrote lobber_face.png")

adult()
face()
