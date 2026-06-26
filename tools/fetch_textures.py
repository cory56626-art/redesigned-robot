#!/usr/bin/env python3
"""Build real photo-based PBR block textures from CC0 AmbientCG materials.

Downloads CC0 (public-domain) photographic PBR materials, maps Color/Displacement/
Roughness onto the common Minecraft blocks as Bedrock texture sets (color +
heightmap + MER), composites ores onto the real rock, and builds a grass side.
CC0 = legal to redistribute inside the pack. Run: python3 tools/fetch_textures.py
"""
import os, io, json, zipfile, math, random, subprocess
from PIL import Image, ImageEnhance

HERE=os.path.dirname(__file__)
OUT=os.path.join(HERE,"..","RealisticDeferred","textures","blocks")
TEXROOT=os.path.join(HERE,"..","RealisticDeferred","textures")
CACHE=os.path.join(HERE,"..","..","scratchpad_cache")  # may not exist; fallback below
CACHE=os.environ.get("ACG_CACHE", "/tmp/claude-0/-home-user-redesigned-robot/23c9e1e2-6dd9-510e-a53f-861852d3ba0e/scratchpad/acg")
os.makedirs(OUT,exist_ok=True); os.makedirs(CACHE,exist_ok=True)
RES=256
ALL=set()

def _valid(z):
    if not os.path.exists(z) or os.path.getsize(z)<50000: return False
    try:
        zf=zipfile.ZipFile(z); return zf.testzip() is None
    except Exception: return False
def download(asset):
    z=os.path.join(CACHE,asset+".zip")
    for attempt in range(4):
        if _valid(z): return zipfile.ZipFile(z)
        url="https://ambientcg.com/get?file=%s_1K-JPG.zip"%asset
        print("  downloading",asset,"(try %d)"%(attempt+1))
        subprocess.run(["curl","-sL","-m","180","--retry","3","-A","Mozilla/5.0",url,"-o",z],check=False)
    if not _valid(z): raise RuntimeError("download failed: "+asset)
    return zipfile.ZipFile(z)

def maps(asset):
    """return dict of resized PIL images: color(RGB), disp(L), rough(L)."""
    z=download(asset); names=z.namelist()
    def find(suffix):
        for n in names:
            if n.endswith(suffix): return n
        return None
    def load(n,mode):
        im=Image.open(io.BytesIO(z.read(n))).convert(mode)
        return im.resize((RES,RES),Image.LANCZOS)
    out={"color":load(find("_Color.jpg"),"RGB"),
         "disp":load(find("_Displacement.jpg"),"L"),
         "rough":load(find("_Roughness.jpg"),"L")}
    return out

def save_pbr(name, color_rgb, disp_L, rough_L, metal=0, emissive_L=None, alpha=None):
    col=color_rgb.convert("RGBA")
    if alpha is not None: col.putalpha(alpha)
    col.save(os.path.join(OUT,name+".png"))
    Image.merge("RGB",(disp_L,disp_L,disp_L)).save(os.path.join(OUT,name+"_height.png"))
    R=Image.new("L",(RES,RES),metal); G=emissive_L or Image.new("L",(RES,RES),0)
    Image.merge("RGB",(R,G,rough_L)).save(os.path.join(OUT,name+"_mer.png"))
    json.dump({"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}},
        open(os.path.join(OUT,name+".texture_set.json"),"w"),indent=2)
    for s in (name,name+"_mer",name+"_height"): ALL.add("textures/blocks/"+s)

def block(name, asset, metal=0, brighten=1.0, saturate=1.0):
    m=maps(asset); c=m["color"]
    if brighten!=1.0: c=ImageEnhance.Brightness(c).enhance(brighten)
    if saturate!=1.0: c=ImageEnhance.Color(c).enhance(saturate)
    save_pbr(name,c,m["disp"],m["rough"],metal=metal)
    print("  ->",name,"from",asset)
    return m

# ---------- material -> block mapping ----------
print("solid blocks (real CC0 photo PBR)...")
stone_m = block("stone","Rock030")
block("cobblestone","PavingStones128", saturate=0.65, brighten=0.95)
dirt_m  = block("dirt","Ground037")
block("sand","Ground080", brighten=1.05)
block("gravel","Gravel022")
block("planks_oak","WoodFloor043")
block("log_oak","Bark012")
# oak log top: reuse planks-like end grain
block("log_oak_top","WoodFloor043", brighten=0.95)

# ---------- grass top (biome-tinted -> author lighter) ----------
gm=maps("Grass005")
gc=ImageEnhance.Brightness(gm["color"]).enhance(1.18)
gc=ImageEnhance.Color(gc).enhance(0.82)               # desaturate a touch so tint reads
save_pbr("grass_top",gc,gm["disp"],gm["rough"])
print("  -> grass_top from Grass005")

# ---------- grass side: dirt photo + grassy fringe from grass photo ----------
def make_grass_side(dirt_m, grass_color):
    dc=dirt_m["color"].convert("RGBA"); dd=dirt_m["disp"]; dr=dirt_m["rough"]
    gc=ImageEnhance.Brightness(grass_color).enhance(1.12).convert("RGBA")
    rnd=random.Random(7)
    # irregular top fringe mask
    base=int(RES*0.34); px=dc.load(); gpx=gc.load()
    dpx=dd.load(); rpx=dr.load()
    # simple value-noise edge
    def edge(x):
        return base + int(28*math.sin(x*0.10)+18*math.sin(x*0.37+1.3)+10*math.sin(x*0.9))
    for x in range(RES):
        e=edge(x)
        for y in range(RES):
            if y< e + rnd.randint(-4,4):
                px[x,y]=gpx[x,y]
                dpx[x,y]=min(255,dpx[x,y]+30); rpx[x,y]=235
    save_pbr("grass_side", dc.convert("RGB"), dd, dr)
    print("  -> grass_side (dirt+grass composite)")
make_grass_side(dirt_m, gm["color"])

# ---------- ores: real rock base + mineral nodes ----------
def ihash(a,b,c):
    n=(a*374761393+b*668265263+c*2246822519)&0xffffffffffffffff
    return ((n^(n>>13))*1274126177)&0xffffffffffffffff
def perm(s):
    p=list(range(256)); random.Random(s).shuffle(p); return p+p
def vn(p,x,y):
    import math
    xi=int(math.floor(x))&255; yi=int(math.floor(y))&255
    xf=x-math.floor(x); yf=y-math.floor(y)
    def f(t): return t*t*t*(t*(t*6-15)+10)
    def val(a,b): return p[(p[a&255]+(b&255))&255]/255.0
    v00=val(xi,yi);v10=val(xi+1,yi);v01=val(xi,yi+1);v11=val(xi+1,yi+1)
    u=f(xf);v=f(yf)
    return (v00+(v10-v00)*u)+((v01+(v11-v01)*u)-(v00+(v10-v00)*u))*v
def ore(name, mineral, seed, metal=0, rough_min=70, emis=0, nodes=10, sparkle=False):
    col=stone_m["color"].convert("RGBA").copy(); disp=stone_m["disp"].copy(); rough=stone_m["rough"].copy()
    px=col.load(); dpx=disp.load(); rpx=rough.load()
    em=Image.new("L",(RES,RES),0); epx=em.load()
    rnd=random.Random(seed); ps=perm(seed+23); pe=perm(seed+13)
    cen=[(rnd.randint(0,RES-1),rnd.randint(0,RES-1),rnd.uniform(RES*0.05,RES*0.11)) for _ in range(nodes)]
    md=tuple(int(c*0.5) for c in mineral)
    for y in range(RES):
        for x in range(RES):
            best=9.9
            for (cx,cy,r) in cen: best=min(best,math.hypot(x-cx,y-cy)/r)
            e=vn(pe,x/8.0,y/8.0); m=(1.0-best)+(e-0.5)*0.5
            if m>0.0:
                t=max(0.0,min(1.0,m)); o=px[x,y]
                base=tuple(int(o[i]*(1-0.9*t)+ (md[i]*(1-t)+mineral[i]*t)*0.9*t/max(t,0.001)) for i in range(3))
                base=tuple(int(o[i]+(mineral[i]-o[i])*0.85*t) for i in range(3))
                if sparkle and t>0.5 and vn(ps,x/3.0,y/3.0)>0.84:
                    base=tuple(min(255,int(base[i]*0.4+255*0.6)) for i in range(3))
                px[x,y]=base+(255,)
                rpx[x,y]=int(rpx[x,y]*(1-t)+rough_min*t)
                if emis: epx[x,y]=int(emis*t)
    save_pbr(name, col.convert("RGB"), disp, rough, metal=metal, emissive_L=em)
    print("  ->",name)
print("ores (on real rock)...")
ore("coal_ore",(34,34,36),40, rough_min=200)
ore("iron_ore",(200,166,134),41, metal=190, rough_min=90)
ore("gold_ore",(248,208,94),42, metal=220, rough_min=60, sparkle=True)
ore("copper_ore",(200,122,88),43, metal=200, rough_min=80)
ore("diamond_ore",(124,228,226),44, rough_min=46, emis=120, sparkle=True)
ore("emerald_ore",(74,204,114),45, rough_min=52, sparkle=True)
ore("lapis_ore",(46,88,184),46, rough_min=68, sparkle=True)
ore("redstone_ore",(204,44,34),47, rough_min=86, emis=150)

json.dump(sorted(ALL),open(os.path.join(TEXROOT,"textures_list.json"),"w"),indent=2)
# no flipbook waving in this pass
json.dump([],open(os.path.join(TEXROOT,"flipbook_textures.json"),"w"),indent=2)
print("DONE:",len(ALL),"textures listed")
