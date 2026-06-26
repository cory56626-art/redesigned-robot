#!/usr/bin/env python3
"""Procedural realistic texture generator for the Realistic Deferred pack.

v2: adds cellular (Voronoi) macro-structure + higher contrast so blocks read as
real surfaces (cobbles+mortar, plank boards+grain, pebbly dirt/gravel, mottled
stone, clustered ores) instead of flat noise. Seamless/tiling. Pure-PIL.

Per texture: color + heightmap + MER (R=metalness, G=emissive, B=roughness).
Biome-tinted textures (grass/leaves/tallgrass/fern/double-plant) are authored
light so the in-game multiply-tint yields natural color.
"""
import os, json, math, random
from PIL import Image

RES = 256                     # texture resolution (16x vanilla)
SCALE = RES // 64
OUT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures", "blocks")
TEXROOT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures")
os.makedirs(OUT, exist_ok=True)

# ---------- value noise (tiling) ----------
def make_perm(seed):
    p=list(range(256)); random.Random(seed).shuffle(p); return p+p
def _fade(t): return t*t*t*(t*(t*6-15)+10)
def _lerp(a,b,t): return a+(b-a)*t
def vnoise(p,x,y):
    xi=int(math.floor(x))&255; yi=int(math.floor(y))&255
    xf=x-math.floor(x); yf=y-math.floor(y)
    def val(a,b): return p[(p[a&255]+(b&255))&255]/255.0
    v00=val(xi,yi); v10=val(xi+1,yi); v01=val(xi,yi+1); v11=val(xi+1,yi+1)
    u=_fade(xf); v=_fade(yf)
    return _lerp(_lerp(v00,v10,u),_lerp(v01,v11,u),v)
def fbm(p,x,y,oct=4,scale=8.0,gain=0.5,lac=2.0):
    amp=1.0; freq=1.0/scale; tot=0.0; norm=0.0
    for _ in range(oct):
        tot+=amp*vnoise(p,x*freq,y*freq); norm+=amp; amp*=gain; freq*=lac
    return tot/norm

# ---------- cellular / Voronoi (seamless via cell wrap) ----------
def _ihash(a,b,c):
    n=(a*374761393 + b*668265263 + c*2246822519) & 0xffffffffffffffff
    n=((n ^ (n>>13))*1274126177) & 0xffffffffffffffff
    return n
def voronoi(seed,x,y,ncells):
    cs=RES/float(ncells); gx=x/cs; gy=y/cs
    ix=math.floor(gx); iy=math.floor(gy)
    f1=9e9; f2=9e9; vid=0.0
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            cx=ix+dx; cy=iy+dy
            h=_ihash(cx%ncells, cy%ncells, seed)
            jx=((h)&1023)/1023.0; jy=((h>>10)&1023)/1023.0; rv=((h>>20)&1023)/1023.0
            d=math.hypot((cx+jx)-gx,(cy+jy)-gy)
            if d<f1: f2=f1; f1=d; vid=rv
            elif d<f2: f2=d
    return f1,f2,vid     # distances in cell units

def contrast(v, amt, mid=0.5): return max(0.0,min(1.0, (v-mid)*amt+mid))
def clamp8(v): return max(0,min(255,int(round(v))))
def mix(c1,c2,t):
    t=max(0.0,min(1.0,t)); return tuple(clamp8(c1[i]+(c2[i]-c1[i])*t) for i in range(3))

# ---------- writers ----------
def save_rgba(name,px): Image.new("RGBA",(RES,RES),(0,0,0,0)).putdata(px) or None
def _save(name,mode,px):
    img=Image.new(mode,(RES,RES)); img.putdata(px); img.save(os.path.join(OUT,name+".png"))
def _save_strip(name,frames):
    img=Image.new("RGBA",(RES,RES*len(frames)))
    d=[]; [d.extend(f) for f in frames]; img.putdata(d); img.save(os.path.join(OUT,name+".png"))

ALL_TEX=set(); FLIPBOOKS=[]
def emit_pbr(name,color,height,mer):
    _save(name,"RGBA",color); _save(name+"_height","RGB",height); _save(name+"_mer","RGB",mer)
    json.dump({"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}},
        open(os.path.join(OUT,name+".texture_set.json"),"w"),indent=2)
    for s in (name,name+"_mer",name+"_height"): ALL_TEX.add("textures/blocks/"+s)

def emit_flipbook(name,base,anchored=True,amp=1.6,frames=16,tpf=4):
    amp*=SCALE; out=[]
    for f in range(frames):
        phase=math.sin(2*math.pi*f/frames); fr=[(0,0,0,0)]*(RES*RES)
        for y in range(RES):
            rowf=(1.0-y/(RES-1)) if anchored else 1.0; sh=amp*phase*rowf
            for x in range(RES):
                xi=int(round(x-sh))
                fr[y*RES+x]=(base[y*RES+xi] if 0<=xi<RES else (0,0,0,0)) if anchored else base[y*RES+(xi%RES)]
        out.append(fr)
    _save_strip(name,out)
    FLIPBOOKS.append({"flipbook_texture":"textures/blocks/"+name,"atlas_tile":name,
                      "ticks_per_frame":tpf,"blend_frames":True}); ALL_TEX.add("textures/blocks/"+name)

# ================= SOLID RECIPES (structured) =================
def stone(seed, base=(132,132,137), rough=210, metal=0):
    p=make_perm(seed); pg=make_perm(seed+5); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,6)             # broad mottled regions
            patch=(vid-0.5)*30
            grain=(fbm(p,x,y,5,7.0)-0.5)*36
            speck=(vnoise(pg,x*0.9,y*0.9)-0.5)*22
            lum=base[0]+patch+grain+speck
            edge=f2-f1
            crack = 1.0 if (edge<0.03 and vnoise(p,x*0.3,y*0.3)>0.55) else 0.0
            c=(clamp8(lum+(base[1]-base[0])),)  # placeholder
            col=(clamp8(lum), clamp8(lum*0.99+ (base[1]-base[0])), clamp8(lum*0.99+(base[2]-base[0])))
            if crack: col=mix(col,(54,54,58),0.7)
            color.append(col+(255,))
            h=clamp8(150+patch*1.4+grain*1.2 - crack*95); height.append((h,h,h))
            mer.append((metal,0,clamp8(rough+grain*0.3)))
    return color,height,mer

def cobblestone(seed):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,5)             # ~5 cobbles across
            edge=f2-f1
            grain=(fbm(p,x,y,4,6.0)-0.5)
            if edge<0.07:                             # mortar gap
                base=mix((58,58,62),(78,78,82),grain+0.5); h=70+grain*20
                col=base; rough=235
            else:
                shade=96+vid*70                        # per-cobble value
                dome=1.0-min(1.0,f1*1.5)               # rounded highlight
                lum=shade+dome*38+grain*28
                col=(clamp8(lum),clamp8(lum),clamp8(lum+4))
                h=120+dome*110+grain*18; rough=205
            color.append(col+(255,))
            hh=clamp8(h); height.append((hh,hh,hh))
            mer.append((0,0,clamp8(rough)))
    return color,height,mer

def pebbles(seed, palette, ncells, rough=224, gap=(60,52,44), relief=120, gapw=0.06):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,ncells)
            edge=f2-f1; grain=(fbm(p,x,y,4,5.0)-0.5)
            if edge<gapw:
                col=mix(gap,(gap[0]-12,gap[1]-12,gap[2]-12),grain+0.5); h=70; rough2=rough+12
            else:
                base=palette[int(vid*len(palette))%len(palette)]
                dome=1.0-min(1.0,f1*1.7)
                col=mix((base[0]-30,base[1]-30,base[2]-28),(base[0]+22,base[1]+22,base[2]+20),dome*0.8+grain*0.4)
                h=110+dome*relief+grain*22; rough2=rough
            color.append(col+(255,))
            hh=clamp8(h); height.append((hh,hh,hh))
            mer.append((0,0,clamp8(rough2)))
    return color,height,mer

def sand(seed):
    p=make_perm(seed); pr=make_perm(seed+3); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            ripple=math.sin((x*0.10)+fbm(p,x,y,3,9.0)*4.0)*0.5+0.5
            grain=(vnoise(pr,x*1.6,y*1.6)-0.5)
            lum=206+ripple*16+grain*30
            col=(clamp8(lum),clamp8(lum-12),clamp8(lum-46))
            color.append(col+(255,))
            h=clamp8(120+ripple*40+grain*22); height.append((h,h,h))
            mer.append((0,0,clamp8(236)))
    return color,height,mer

def planks(seed, light, dark, rough=198):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    nb=4; bh=RES/nb
    for y in range(RES):
        bi=int(y//bh); within=(y-bi*bh)/bh
        bo=_ihash(bi,7,seed); btone=((bo&255)/255.0-0.5)*26
        joint=int(((bo>>8)&255)/255.0*RES)              # staggered end joint per board
        hseam = within<0.04 or within>0.96
        for x in range(RES):
            grain=fbm(p,x*0.35, (y%int(bh))*3.0+bi*40, 4, 9.0)   # stretched horizontal grain
            streak=math.sin(grain*9.0+x*0.02)*0.5+0.5
            lum=light[0]+btone + (dark[0]-light[0])*(0.35+streak*0.5)
            col=(clamp8(lum),clamp8(lum*(light[1]/light[0])),clamp8(lum*(light[2]/light[0])))
            vseam = abs(((x-joint)%RES)) < 2*SCALE
            if hseam or vseam: col=mix(col,(50,34,18),0.75)
            # occasional knot
            kx=(bo>>16)%RES; ky=int(bh*0.5+bi*bh)
            if math.hypot(x-kx,y-ky)< 4*SCALE: col=mix(col,(60,40,22),0.6)
            color.append(col+(255,))
            h=clamp8(150+streak*40 - (95 if (hseam or vseam) else 0)); height.append((h,h,h))
            mer.append((0,0,clamp8(rough+streak*18)))
    return color,height,mer

def log_side(seed, bark, barkd, rough=224):
    p=make_perm(seed); color=[]; height=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            warp=fbm(p,x,y,4,16.0)
            ridge=abs(math.sin(x*0.16*SCALE + warp*5.0))
            ridge=contrast(ridge,1.5)
            c=mix(barkd,bark,ridge)
            color.append(c+(255,))
            h=clamp8(70+ridge*170); height.append((h,h,h))
            mer.append((0,0,clamp8(rough+(ridge-0.5)*24)))
    return color,height,mer

def log_top(seed, ring, ringd, core, rough=205):
    p=make_perm(seed); color=[]; height=[]; mer=[]; cx=cy=RES/2
    for y in range(RES):
        for x in range(RES):
            d=math.hypot(x-cx,y-cy)+fbm(p,x,y,3,10.0)*6
            r=contrast((math.sin(d*0.32*SCALE)+1)/2, 1.4)
            c=mix(ringd,ring,r)
            if d<7*SCALE: c=mix(c,core,0.6)
            color.append(c+(255,))
            h=clamp8(140+r*70); height.append((h,h,h))
            mer.append((0,0,clamp8(rough)))
    return color,height,mer

def dirt_base(seed):
    return pebbles(seed,[(108,80,55),(96,70,47),(120,92,62),(86,62,40)],ncells=11,
                   rough=232,gap=(70,52,36),relief=70,gapw=0.05)

def grass_top():
    p=make_perm(31); pg=make_perm(77); color=[]; height=[]; mer=[]
    light=(196,206,168); dark=(150,168,118)                  # tintable, contrasty
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(31,x,y,9)                       # clumps
            streak=fbm(p,x*0.6,y*1.8,4,6.0)                   # bladey streaks
            fleck=vnoise(pg,x*2.2,y*2.2)
            t=contrast(0.45*vid+0.4*streak+0.15*fleck,1.4)
            c=mix(dark,light,t)
            if fleck>0.82: c=mix(c,(120,140,86),0.5)          # dark blade flecks
            color.append(c+(255,))
            h=clamp8(120+t*90); height.append((h,h,h))
            mer.append((0,0,clamp8(240)))
    return color,height,mer

def grass_side():
    color,height,mer=dirt_base(42)
    p=make_perm(88); fringe=int(RES*0.34)
    for x in range(RES):
        blade=int(fringe*(0.45+fbm(p,x*1.3,0,3,8.0)*0.9))
        for y in range(blade):
            i=y*RES+x
            t=1.0-y/max(1,blade)
            gc=mix((120,150,80),(168,190,108), t*0.7+vnoise(p,x*2.0,y*2.0)*0.3)  # tintable-ish
            color[i]=gc+(255,)
            hh=clamp8(150+t*80); height[i]=(hh,hh,hh); mer[i]=(0,0,240)
    return color,height,mer

def ore(seed, mineral, metal, rough_min, rough_base=210, emissive=0, nodes=9):
    color,height,mer=stone(seed,(128,128,133),rough_base)
    rnd=random.Random(seed+7); pe=make_perm(seed+13)
    centers=[(rnd.randint(0,RES-1),rnd.randint(0,RES-1),rnd.uniform(RES*0.05,RES*0.11)) for _ in range(nodes)]
    md=mix(mineral,(0,0,0),0.45)
    for y in range(RES):
        for x in range(RES):
            best=9.9
            for (cxc,cyc,r) in centers: best=min(best,math.hypot(x-cxc,y-cyc)/r)
            edge=fbm(pe,x,y,3,4.0); m=(1.0-best)+(edge-0.5)*0.55
            if m>0.0:
                t=max(0.0,min(1.0,m)); i=y*RES+x
                c=mix(mix((color[i][0],color[i][1],color[i][2]),md,0.9),mineral,t)
                color[i]=c+(255,)
                hgt=clamp8(135+t*100); height[i]=(hgt,hgt,hgt)
                mer[i]=(clamp8(metal*t),clamp8(emissive*t),clamp8(rough_base+(rough_min-rough_base)*t))
    return color,height,mer

# ---------- foliage sprites (unchanged, contrast-boosted leaves) ----------
def blades_sprite(seed,col1,col2,density=0.5,height_frac=0.95,thick=2):
    px=[(0,0,0,0)]*(RES*RES); thick=max(1,thick*SCALE); rnd=random.Random(seed)
    for _ in range(int(RES*density)):
        bx=rnd.randint(2,RES-3); top=int(RES*(1-height_frac*rnd.uniform(0.6,1.0))); sway=rnd.uniform(-0.12,0.12)
        col=mix(col1,col2,rnd.random())
        for y in range(top,RES):
            xx=int(bx+sway*(RES-y))
            for w in range(-thick//2,thick//2+1):
                X=xx+w
                if 0<=X<RES:
                    sh=mix(col,(col[0]-30,col[1]-30,col[2]-25),(y-top)/max(1,RES-top)); px[y*RES+X]=sh+(255,)
    return px
def leaves_sprite(seed,c1,c2):
    p=make_perm(seed); px=[]
    for y in range(RES):
        for x in range(RES):
            n=contrast(fbm(p,x,y,4,5.0),1.5); hole=vnoise(make_perm(seed+5),x/2.3,y/2.3)
            px.append((0,0,0,0) if hole<0.30 else mix(c1,c2,n)+(255,))
    return px
def flower_sprite(seed,stem,petal,center):
    px=[(0,0,0,0)]*(RES*RES); cx=RES//2
    for y in range(RES//2,RES):
        for w in (-1,0,1):
            X=cx+w+int(math.sin(y*0.2)*1.5*SCALE)
            if 0<=X<RES: px[y*RES+X]=stem+(255,)
    cy=RES//3
    for y in range(RES):
        for x in range(RES):
            d=math.hypot(x-cx,y-cy)
            if d<RES*0.20: px[y*RES+x]=(petal if d>RES*0.07 else center)+(255,)
    return px
def sapling_sprite(seed):
    px=blades_sprite(seed,(96,150,70),(70,120,50),0.25,0.55,2); rnd=random.Random(seed+3)
    cx=RES//2; cy=int(RES*0.4)
    for y in range(RES):
        for x in range(RES):
            if math.hypot(x-cx,y-cy)<RES*0.18 and rnd.random()<0.7: px[y*RES+x]=mix((104,150,72),(76,120,52),rnd.random())+(255,)
    return px
def wheat_sprite(seed,stage):
    t=stage/7.0; col1=mix((150,170,90),(204,172,72),t); col2=mix((120,140,70),(172,142,56),t)
    return blades_sprite(seed,col1,col2,0.55,0.4+0.55*t,2)

# ================= GENERATE =================
print("solid blocks...")
emit_pbr("stone",*stone(1))
emit_pbr("cobblestone",*cobblestone(2))
emit_pbr("dirt",*dirt_base(3))
emit_pbr("sand",*sand(4))
emit_pbr("gravel",*pebbles(5,[(126,122,118),(98,94,90),(140,128,116),(86,84,86)],ncells=9,rough=222,gap=(64,60,58),relief=120,gapw=0.07))
emit_pbr("planks_oak",*planks(10,(170,134,86),(120,90,52)))
emit_pbr("planks_birch",*planks(11,(206,188,140),(168,148,104)))
emit_pbr("planks_spruce",*planks(12,(124,94,58),(86,62,38)))
emit_pbr("log_oak",*log_side(20,(126,96,60),(74,54,34)))
emit_pbr("log_birch",*log_side(21,(222,220,212),(120,120,112)))
emit_pbr("log_spruce",*log_side(22,(92,68,44),(54,38,24)))
emit_pbr("log_oak_top",*log_top(30,(172,138,88),(120,92,56),(150,116,72)))
emit_pbr("log_birch_top",*log_top(31,(212,200,164),(168,156,120),(196,182,150)))
emit_pbr("log_spruce_top",*log_top(32,(132,100,64),(92,68,42),(112,86,54)))
emit_pbr("grass_top",*grass_top())
emit_pbr("grass_side",*grass_side())
print("ores...")
emit_pbr("coal_ore",*ore(40,(36,36,38),0,200))
emit_pbr("iron_ore",*ore(41,(198,164,132),190,90))
emit_pbr("gold_ore",*ore(42,(246,206,92),220,60))
emit_pbr("copper_ore",*ore(43,(198,120,86),200,80))
emit_pbr("diamond_ore",*ore(44,(122,226,224),0,50,emissive=30))
emit_pbr("emerald_ore",*ore(45,(72,202,112),0,55))
emit_pbr("lapis_ore",*ore(46,(46,86,182),0,70))
emit_pbr("redstone_ore",*ore(47,(202,42,32),0,90,emissive=70))
print("foliage (waving)...")
G=dict(amp=1.4,frames=16,tpf=4)
emit_flipbook("tallgrass",blades_sprite(50,(184,202,122),(150,176,96),0.6),**G)
emit_flipbook("fern",blades_sprite(51,(172,196,118),(140,170,92),0.5,thick=1),**G)
emit_flipbook("double_plant_grass_top",blades_sprite(52,(186,204,124),(152,180,100),0.7),**G)
emit_flipbook("double_plant_grass_bottom",blades_sprite(53,(178,196,116),(146,172,94),0.7,1.0),**G)
emit_flipbook("flower_dandelion",flower_sprite(60,(96,150,70),(248,216,70),(252,238,140)),**G)
emit_flipbook("flower_rose",flower_sprite(61,(96,150,70),(206,52,44),(60,40,30)),**G)
emit_flipbook("sapling_oak",sapling_sprite(62),**G)
emit_flipbook("leaves_oak",leaves_sprite(70,(150,182,104),(96,138,68)),anchored=False,**G)
emit_flipbook("leaves_birch",leaves_sprite(71,(168,194,120),(118,156,82)),anchored=False,**G)
emit_flipbook("leaves_spruce",leaves_sprite(72,(120,150,96),(74,108,64)),anchored=False,**G)
for s in range(8): emit_flipbook("wheat_stage_%d"%s,wheat_sprite(80+s,s),**G)

json.dump(FLIPBOOKS,open(os.path.join(TEXROOT,"flipbook_textures.json"),"w"),indent=2)
json.dump(sorted(ALL_TEX),open(os.path.join(TEXROOT,"textures_list.json"),"w"),indent=2)
print("DONE: %d files, %d flipbooks, %d textures listed"%(len(os.listdir(OUT)),len(FLIPBOOKS),len(ALL_TEX)))
