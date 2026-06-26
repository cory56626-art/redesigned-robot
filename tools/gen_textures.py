#!/usr/bin/env python3
"""Procedural realistic texture generator for the Realistic Deferred pack.

Outputs custom HD (64px) color/heightmap/MER maps + texture_set JSON for solid
blocks, and gently-waving flipbook animations for foliage. Pure-PIL, deterministic.

MER channel convention (Bedrock): R = metalness, G = emissive, B = roughness.
Biome-tinted textures (grass/leaves/tallgrass/ferns/double-plant) are authored
light/desaturated so the in-game multiply tint produces natural color.
"""
import os, json, math, random
from PIL import Image

RES = 256                     # texture resolution (16x vanilla)
SCALE = RES // 64             # brush/relief scale factor vs the 64px baseline
OUT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures", "blocks")
TEXROOT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures")
os.makedirs(OUT, exist_ok=True)

# ---------- noise ----------
def make_perm(seed):
    p = list(range(256)); random.Random(seed).shuffle(p); return p + p
def _fade(t): return t*t*t*(t*(t*6-15)+10)
def _lerp(a,b,t): return a+(b-a)*t
def vnoise(p, x, y):
    xi=int(math.floor(x))&255; yi=int(math.floor(y))&255
    xf=x-math.floor(x); yf=y-math.floor(y)
    def val(a,b): return p[(p[a&255]+(b&255))&255]/255.0
    v00=val(xi,yi); v10=val(xi+1,yi); v01=val(xi,yi+1); v11=val(xi+1,yi+1)
    u=_fade(xf); v=_fade(yf)
    return _lerp(_lerp(v00,v10,u),_lerp(v01,v11,u),v)
def fbm(p, x, y, oct=4, scale=8.0, gain=0.5, lac=2.0):
    amp=1.0; freq=1.0/scale; tot=0.0; norm=0.0
    for _ in range(oct):
        tot+=amp*vnoise(p, x*freq, y*freq); norm+=amp; amp*=gain; freq*=lac
    return tot/norm

def clamp8(v): return max(0,min(255,int(round(v))))
def mix(c1,c2,t): return tuple(clamp8(c1[i]+(c2[i]-c1[i])*t) for i in range(3))

# ---------- writers ----------
def save_rgba(name, pixels):
    img=Image.new("RGBA",(RES,RES)); img.putdata(pixels); img.save(os.path.join(OUT,name+".png"))
def save_strip(name, frames):
    h=RES*len(frames); img=Image.new("RGBA",(RES,h))
    data=[]; [data.extend(f) for f in frames]; img.putdata(data); img.save(os.path.join(OUT,name+".png"))

TEXTURE_SETS=[]; FLIPBOOKS=[]; ALL_TEX=set()

def emit_pbr(name, color, height, mer):
    """color:list rgba, height/mer:list rgb -> writes 3 pngs + texture_set json"""
    save_rgba(name, color)
    hi=Image.new("RGB",(RES,RES)); hi.putdata(height); hi.save(os.path.join(OUT,name+"_height.png"))
    me=Image.new("RGB",(RES,RES)); me.putdata(mer);   me.save(os.path.join(OUT,name+"_mer.png"))
    ts={"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}}
    json.dump(ts, open(os.path.join(OUT,name+".texture_set.json"),"w"), indent=2)
    for s in (name,name+"_mer",name+"_height"): ALL_TEX.add("textures/blocks/"+s)

def emit_flipbook(name, base_rgba, anchored=True, amp=1.6, frames=16, tpf=4):
    """base_rgba: list of RES*RES rgba. Generate gentle-sway vertical strip + flipbook entry."""
    src=base_rgba; out=[]; amp=amp*SCALE
    for f in range(frames):
        phase=math.sin(2*math.pi*f/frames)
        frame=[(0,0,0,0)]*(RES*RES)
        for y in range(RES):
            rowf=(1.0-y/(RES-1)) if anchored else 1.0     # rooted: top sways most
            shift=amp*phase*rowf
            for x in range(RES):
                sx=x-shift
                if anchored:
                    xi=int(round(sx))
                    px=src[y*RES+xi] if 0<=xi<RES else (0,0,0,0)
                else:                                       # leaves: wrap, no holes
                    xi=int(round(sx))%RES
                    px=src[y*RES+xi]
                frame[y*RES+x]=px
        out.append(frame)
    save_strip(name,out)
    FLIPBOOKS.append({"flipbook_texture":"textures/blocks/"+name,"atlas_tile":name,
                      "ticks_per_frame":tpf,"blend_frames":True})
    ALL_TEX.add("textures/blocks/"+name)

# ---------- solid block recipes ----------
def stone_like(seed, base, var, rough, crack=0.0, metal=0):
    p=make_perm(seed); pc=make_perm(seed+99)
    color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            n=fbm(p,x,y,4,9.0)
            d=fbm(pc,x,y,3,4.0)
            c=mix(base, var, n*0.7+d*0.3)
            cr=0.0
            if crack:
                cv=abs(vnoise(p,x/5.0+10,y/5.0+10)-0.5)
                cr=1.0 if cv<crack else 0.0
                if cr: c=mix(c,(40,40,42),0.6)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(120+n*110 - cr*90); height.append((h,h,h))
            mer.append((metal, 0, clamp8(rough+ (n-0.5)*30)))
    return color,height,mer

def grain(seed, base, var, rough, relief=70):
    p=make_perm(seed)
    color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            n=fbm(p,x,y,4,3.0); g=vnoise(make_perm(seed+1),x*1.7,y*1.7)
            c=mix(base,var,n*0.6+g*0.4)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(110+ (n*0.6+g*0.4)*relief); height.append((h,h,h))
            mer.append((0,0,clamp8(rough+(n-0.5)*20)))
    return color,height,mer

def planks(seed, base, dark, rough=200):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    plankh=RES//4
    for y in range(RES):
        seam = (y % plankh==0) or (y%plankh==plankh-1)
        for x in range(RES):
            grainv=fbm(p,x*0.5,y*3.0,3,6.0)
            c=mix(base,dark,grainv*0.5)
            if seam: c=mix(c,(60,42,24),0.7)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(150+grainv*70 - (90 if seam else 0)); height.append((h,h,h))
            mer.append((0,0,clamp8(rough+(grainv-0.5)*25)))
    return color,height,mer

def log_side(seed, bark, barkd, rough=225):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            ridge=abs(math.sin(x*0.9 + fbm(p,x,y,3,7.0)*3.0))
            c=mix(barkd,bark,ridge)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(90+ridge*150); height.append((h,h,h))
            mer.append((0,0,clamp8(rough+(ridge-0.5)*20)))
    return color,height,mer

def log_top(seed, ring, ringd, core, rough=205):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    cx=cy=RES/2
    for y in range(RES):
        for x in range(RES):
            d=math.hypot(x-cx,y-cy)+fbm(p,x,y,2,6.0)*3
            r=(math.sin(d*1.4)+1)/2
            c=mix(ringd,ring,r)
            if d<5: c=mix(c,core,0.5)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(150+r*60); height.append((h,h,h))
            mer.append((0,0,clamp8(rough)))
    return color,height,mer

def ore(seed, mineral, metal, rough_min, rough_base=210, emissive=0, nodes=9):
    # stone base + a few discrete mineral nodes (blobs, not confetti)
    color,height,mer=stone_like(seed,(122,122,126),(94,94,99),rough_base,crack=0.02)
    rnd=random.Random(seed+7); p=make_perm(seed+13)
    centers=[(rnd.randint(0,RES-1),rnd.randint(0,RES-1),rnd.uniform(RES*0.05,RES*0.11))
             for _ in range(nodes)]
    md=mix(mineral,(0,0,0),0.45)   # darker mineral shade for depth
    for y in range(RES):
        for x in range(RES):
            best=9.9
            for (cxc,cyc,r) in centers:
                best=min(best, math.hypot(x-cxc,y-cyc)/r)
            edge=fbm(p,x,y,3,4.0)
            m=(1.0-best)+(edge-0.5)*0.55
            if m>0.0:
                t=max(0.0,min(1.0,m)); i=y*RES+x
                c=mix(mix((color[i][0],color[i][1],color[i][2]),md,0.9), mineral, t)
                color[i]=(c[0],c[1],c[2],255)
                hgt=clamp8(135+t*100); height[i]=(hgt,hgt,hgt)
                mer[i]=(clamp8(metal*t),clamp8(emissive*t),clamp8(rough_base+(rough_min-rough_base)*t))
    return color,height,mer

# ---------- grass block ----------
def grass_top():
    p=make_perm(31); color=[]; height=[]; mer=[]
    base=(196,205,168); var=(170,186,140)   # light/tintable
    for y in range(RES):
        for x in range(RES):
            n=fbm(p,x,y,4,4.0); blade=vnoise(make_perm(99),x*2.2,y*2.2)
            c=mix(base,var,n*0.6+blade*0.4)
            color.append((c[0],c[1],c[2],255))
            h=clamp8(120+blade*80); height.append((h,h,h))
            mer.append((0,0,clamp8(238+(n-0.5)*10)))
    return color,height,mer

def grass_side():
    # dirt body + light-green grassy fringe along the top
    dcolor,dheight,dmer=grain(42,(101,75,52),(74,54,38),232,relief=60)
    p=make_perm(77); fringe=int(RES*0.32)
    for y in range(fringe):
        for x in range(RES):
            edge=fbm(p,x,y,3,5.0)
            cut = y/fringe + (edge-0.5)*0.5
            if cut < 0.9:
                i=y*RES+x
                gc=mix((150,178,96),(120,150,72),edge)   # tintable-ish green
                dcolor[i]=(gc[0],gc[1],gc[2],255)
                hh=clamp8(150+edge*70); dheight[i]=(hh,hh,hh)
                dmer[i]=(0,0,240)
    return dcolor,dheight,dmer

# ---------- foliage sprites (RGBA with transparency) ----------
def blades_sprite(seed, col1, col2, density=0.5, height_frac=0.95, thick=2):
    """upright blades rooted at bottom, transparent elsewhere."""
    p=make_perm(seed); px=[(0,0,0,0)]*(RES*RES)
    nblades=int(RES*density); thick=max(1, thick*SCALE)
    rnd=random.Random(seed)
    for _ in range(nblades):
        bx=rnd.randint(2,RES-3); top=int(RES*(1-height_frac*rnd.uniform(0.6,1.0)))
        sway=rnd.uniform(-0.12,0.12)
        col=mix(col1,col2,rnd.random())
        for y in range(top,RES):
            xx=int(bx+ sway*(RES-y))
            for w in range(-thick//2, thick//2+1):
                X=xx+w
                if 0<=X<RES:
                    shade=mix(col,(col[0]-30,col[1]-30,col[2]-25), (y-top)/max(1,RES-top))
                    px[y*RES+X]=(shade[0],shade[1],shade[2],255)
    return px

def leaves_sprite(seed, col1, col2):
    p=make_perm(seed); px=[]
    for y in range(RES):
        for x in range(RES):
            n=fbm(p,x,y,4,5.0); hole=vnoise(make_perm(seed+5),x/2.5,y/2.5)
            if hole<0.30:
                px.append((0,0,0,0))
            else:
                c=mix(col1,col2,n)
                px.append((c[0],c[1],c[2],255))
    return px

def flower_sprite(seed, stem, petal, center):
    rnd=random.Random(seed); px=[(0,0,0,0)]*(RES*RES)
    cx=RES//2
    # stem
    for y in range(RES//2,RES):
        for w in (-1,0,1):
            X=cx+w+int(math.sin(y*0.2)*1.5)
            if 0<=X<RES: px[y*RES+X]=(stem[0],stem[1],stem[2],255)
    # blossom
    cy=RES//3
    for y in range(RES):
        for x in range(RES):
            d=math.hypot(x-cx,y-cy)
            if d< RES*0.20:
                c=petal if d>RES*0.07 else center
                px[y*RES+x]=(c[0],c[1],c[2],255)
    return px

def sapling_sprite(seed):
    px=blades_sprite(seed,(96,150,70),(70,120,50),density=0.25,height_frac=0.55,thick=2)
    # little canopy
    rnd=random.Random(seed+3); cx=RES//2; cy=int(RES*0.4)
    for y in range(RES):
        for x in range(RES):
            if math.hypot(x-cx,y-cy)<RES*0.18 and rnd.random()<0.7:
                c=mix((104,150,72),(76,120,52),rnd.random()); px[y*RES+x]=(c[0],c[1],c[2],255)
    return px

def wheat_sprite(seed, stage):
    t=stage/7.0
    grn=(150,170,90); gold=(200,170,70)
    col1=mix(grn,gold,t); col2=mix((120,140,70),(170,140,55),t)
    return blades_sprite(seed,col1,col2,density=0.55,height_frac=0.4+0.55*t,thick=2)

# ================= GENERATE =================
print("solid blocks...")
emit_pbr("stone", *stone_like(1,(126,126,129),(104,104,109),212,crack=0.018))
emit_pbr("cobblestone", *stone_like(2,(120,120,123),(70,70,74),216,crack=0.10))
emit_pbr("dirt", *grain(3,(101,75,52),(74,54,38),232,relief=55))
emit_pbr("sand", *grain(4,(214,201,156),(196,182,138),236,relief=35))
emit_pbr("gravel", *stone_like(5,(120,116,114),(80,76,74),222,crack=0.12))
emit_pbr("planks_oak", *planks(10,(162,128,82),(120,92,56)))
emit_pbr("planks_birch", *planks(11,(196,178,130),(160,142,98)))
emit_pbr("planks_spruce", *planks(12,(118,90,56),(88,66,40)))
emit_pbr("log_oak", *log_side(20,(120,92,58),(78,58,36)))
emit_pbr("log_birch", *log_side(21,(212,210,202),(150,150,142)))
emit_pbr("log_spruce", *log_side(22,(86,64,42),(58,42,26)))
emit_pbr("log_oak_top", *log_top(30,(168,134,86),(120,92,56),(150,116,72)))
emit_pbr("log_birch_top", *log_top(31,(208,196,160),(168,156,120),(196,182,150)))
emit_pbr("log_spruce_top", *log_top(32,(128,98,62),(92,68,42),(112,86,54)))
emit_pbr("grass_top", *grass_top())
emit_pbr("grass_side", *grass_side())

print("ores...")
emit_pbr("coal_ore",     *ore(40,(38,38,40),  0, 200, emissive=0))
emit_pbr("iron_ore",     *ore(41,(196,162,130),190, 90))
emit_pbr("gold_ore",     *ore(42,(245,205,90), 220, 60))
emit_pbr("copper_ore",   *ore(43,(196,118,84), 200, 80))
emit_pbr("diamond_ore",  *ore(44,(120,224,222),0, 50, emissive=30))
emit_pbr("emerald_ore",  *ore(45,(70,200,110), 0, 55))
emit_pbr("lapis_ore",    *ore(46,(46,84,180),  0, 70))
emit_pbr("redstone_ore", *ore(47,(200,40,30),  0, 90, emissive=70))

print("foliage (waving)...")
GENTLE=dict(amp=1.4, frames=16, tpf=4)
emit_flipbook("tallgrass",                blades_sprite(50,(180,200,120),(150,176,96),density=0.6), **GENTLE)
emit_flipbook("fern",                     blades_sprite(51,(170,196,118),(140,170,92),density=0.5,thick=1), **GENTLE)
emit_flipbook("double_plant_grass_top",   blades_sprite(52,(184,204,124),(152,180,100),density=0.7), **GENTLE)
emit_flipbook("double_plant_grass_bottom",blades_sprite(53,(176,196,116),(146,172,94),density=0.7,height_frac=1.0), **GENTLE)
emit_flipbook("flower_dandelion",         flower_sprite(60,(96,150,70),(248,216,70),(252,238,140)), **GENTLE)
emit_flipbook("flower_rose",              flower_sprite(61,(96,150,70),(206,52,44),(60,40,30)), **GENTLE)
emit_flipbook("sapling_oak",              sapling_sprite(62), **GENTLE)
emit_flipbook("leaves_oak",    leaves_sprite(70,(150,182,104),(110,150,78)), anchored=False, **GENTLE)
emit_flipbook("leaves_birch",  leaves_sprite(71,(168,194,120),(130,164,90)), anchored=False, **GENTLE)
emit_flipbook("leaves_spruce", leaves_sprite(72,(120,150,96),(86,118,72)),  anchored=False, **GENTLE)
for s in range(8):
    emit_flipbook("wheat_stage_%d"%s, wheat_sprite(80+s,s), **GENTLE)

# ---------- manifests ----------
json.dump(FLIPBOOKS, open(os.path.join(TEXROOT,"flipbook_textures.json"),"w"), indent=2)
json.dump(sorted(ALL_TEX), open(os.path.join(TEXROOT,"textures_list.json"),"w"), indent=2)
print("DONE: %d texture_sets via emit_pbr, %d flipbooks, %d textures listed"
      % (len(os.listdir(OUT))//1, len(FLIPBOOKS), len(ALL_TEX)))
