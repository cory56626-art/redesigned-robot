import struct, zlib, random, math

def png(path, w, h, px):
    # px: list of (r,g,b,a) length w*h
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r,g,b,a = px[y*w+x]
            raw += bytes((r,g,b,a))
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ+data) & 0xffffffff)
        return c
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path,"wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

def blank(w,h): return [(0,0,0,0) for _ in range(w*h)]
def setpx(px,w,x,y,c):
    if 0<=x<w and 0<=y<len(px)//w: px[y*w+x]=c
def fill(px,w,x0,y0,x1,y1,base,shade=0):
    for y in range(y0,y1):
        for x in range(x0,x1):
            n = random.randint(-8,8)
            r=max(0,min(255,base[0]+n-shade)); g=max(0,min(255,base[1]+n-shade)); b=max(0,min(255,base[2]+n-shade))
            setpx(px,w,x,y,(r,g,b,255))

# ---- main entity texture 128x128 ----
W=H=128
random.seed(7)
px=blank(W,H)
SKIN=(226,221,213)
# regions (bounding boxes of each cube's box-uv footprint)
fill(px,W,0,0,32,16,SKIN)        # head
fill(px,W,0,20,24,44,(214,209,201))  # body (taller)
fill(px,W,40,0,52,27,SKIN,4)     # right arm (longer)
fill(px,W,56,0,68,27,SKIN,4)     # left arm
fill(px,W,72,0,84,27,(210,205,198),6) # right leg
fill(px,W,88,0,100,27,(210,205,198),6) # left leg

# head front face region: x8..16, y8..16
# dark hollow eyes
for (ex) in (9,10):
    for ey in range(10,13): setpx(px,W,ex,ey,(18,12,12,255))
for (ex) in (13,14):
    for ey in range(10,13): setpx(px,W,ex,ey,(18,12,12,255))
# faint eye sockets
for ex in (8,11,12,15):
    for ey in range(10,12): setpx(px,W,ex,ey,(150,140,135,255))
# wide unnatural smile across x8..16, y~13-14, curving up at ends
mouth=(120,20,20)
for x in range(8,16):
    yy = 14 - (1 if x in (8,15) else 0)
    setpx(px,W,x,yy,(*mouth,255))
    setpx(px,W,x,yy+1,(60,8,8,255))
# teeth highlights
for x in range(9,15,2):
    setpx(px,W,x,14,(235,232,225,255))
png("addon/SmilingMan_RP/textures/entity/smiling_man.png", W, H, px)

# ---- pack icons 64x64: dark bg, pale floating face with smile ----
def make_icon(path):
    w=h=64
    p=[(8,8,10,255) for _ in range(w*h)]
    def s(x,y,c):
        if 0<=x<w and 0<=y<h: p[y*w+x]=c
    # pale oval face
    cx,cy=32,30; rx,ry=14,18
    for y in range(h):
        for x in range(w):
            if ((x-cx)/rx)**2+((y-cy)/ry)**2<=1:
                n=random.randint(-6,6)
                s(x,y,(226+n if 226+n<256 else 255,221+n if 221+n<256 else 255,213+n if 213+n<256 else 255,255))
    # eyes
    for ex in (26,27,37,38):
        for ey in range(24,30): s(ex,ey,(12,8,8,255))
    # wide smile
    for x in range(24,41):
        yy=int(38+3*math.sin((x-24)/16*math.pi))
        s(x,yy,(120,18,18,255)); s(x,yy+1,(50,6,6,255))
    png(path,w,h,p)
make_icon("addon/SmilingMan_RP/pack_icon.png")
make_icon("addon/SmilingMan_BP/pack_icon.png")
print("textures written")
