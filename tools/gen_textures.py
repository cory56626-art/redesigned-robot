#!/usr/bin/env python3
"""Procedural realistic texture generator for the Realistic Deferred pack.

v3 ("anti-playdoh"): multi-scale detail — macro Voronoi structure + mid fbm +
sharp micro-grit + ridged cracks — baked into BOTH color and a high-contrast
heightmap, plus per-pixel roughness variation, so surfaces catch light with real
micro-relief instead of reading as smooth clay. Adds animated emissive LAVA.

Maps: color (RGBA) + heightmap (RGB grayscale) + MER (R=metalness,G=emissive,
B=roughness). Biome-tinted tiles authored light. Seamless/tiling. Pure-PIL.
"""
import os, json, math, random
from PIL import Image

RES = 256
SCALE = RES // 64
OUT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures", "blocks")
TEXROOT = os.path.join(os.path.dirname(__file__), "..", "RealisticDeferred", "textures")
os.makedirs(OUT, exist_ok=True)

# ---------- noise ----------
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
def fbm(p,x,y,oct=5,scale=8.0,gain=0.5,lac=2.0):
    amp=1.0; freq=1.0/scale; tot=0.0; norm=0.0
    for _ in range(oct):
        tot+=amp*vnoise(p,x*freq,y*freq); norm+=amp; amp*=gain; freq*=lac
    return tot/norm
def ridged(p,x,y,oct=4,scale=10.0):
    """0..1, sharp ridges at 1 — used for crack networks."""
    amp=1.0; freq=1.0/scale; tot=0.0; norm=0.0
    for _ in range(oct):
        n=1.0-abs(2.0*vnoise(p,x*freq,y*freq)-1.0); tot+=amp*n*n; norm+=amp; amp*=0.5; freq*=2.0
    return tot/norm
def fine(p,x,y): return vnoise(p,x*1.7,y*1.7)            # ~1-2px grit

# ---------- cellular ----------
def _ihash(a,b,c):
    n=(a*374761393+b*668265263+c*2246822519)&0xffffffffffffffff
    n=((n^(n>>13))*1274126177)&0xffffffffffffffff; return n
def voronoi(seed,x,y,ncells):
    cs=RES/float(ncells); gx=x/cs; gy=y/cs; ix=math.floor(gx); iy=math.floor(gy)
    f1=9e9; f2=9e9; vid=0.0
    for dy in (-1,0,1):
        for dx in (-1,0,1):
            cx=ix+dx; cy=iy+dy; h=_ihash(cx%ncells,cy%ncells,seed)
            jx=((h)&1023)/1023.0; jy=((h>>10)&1023)/1023.0; rv=((h>>20)&1023)/1023.0
            d=math.hypot((cx+jx)-gx,(cy+jy)-gy)
            if d<f1: f2=f1; f1=d; vid=rv
            elif d<f2: f2=d
    return f1,f2,vid

def cont(v,amt,mid=0.5): return max(0.0,min(1.0,(v-mid)*amt+mid))
def c8(v): return max(0,min(255,int(round(v))))
def mix(a,b,t):
    t=max(0.0,min(1.0,t)); return tuple(c8(a[i]+(b[i]-a[i])*t) for i in range(3))

# ---------- writers ----------
def _save(name,mode,px):
    im=Image.new(mode,(RES,RES)); im.putdata(px); im.save(os.path.join(OUT,name+".png"))
def _strip(name,frames):
    im=Image.new("RGBA",(RES,RES*len(frames))); d=[]; [d.extend(f) for f in frames]
    im.putdata(d); im.save(os.path.join(OUT,name+".png"))
ALL=set(); FLIP=[]
def emit_pbr(name,color,height,mer):
    _save(name,"RGBA",color); _save(name+"_height","RGB",height); _save(name+"_mer","RGB",mer)
    json.dump({"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}},
        open(os.path.join(OUT,name+".texture_set.json"),"w"),indent=2)
    for s in (name,name+"_mer",name+"_height"): ALL.add("textures/blocks/"+s)
def emit_flip(name,base,anchored=True,amp=1.6,frames=16,tpf=4):
    amp*=SCALE; out=[]
    for f in range(frames):
        ph=math.sin(2*math.pi*f/frames); fr=[(0,0,0,0)]*(RES*RES)
        for y in range(RES):
            rf=(1.0-y/(RES-1)) if anchored else 1.0; sh=amp*ph*rf
            for x in range(RES):
                xi=int(round(x-sh))
                fr[y*RES+x]=(base[y*RES+xi] if 0<=xi<RES else (0,0,0,0)) if anchored else base[y*RES+(xi%RES)]
        out.append(fr)
    _strip(name,out); FLIP.append({"flipbook_texture":"textures/blocks/"+name,"atlas_tile":name,
        "ticks_per_frame":tpf,"blend_frames":True}); ALL.add("textures/blocks/"+name)

# ================= detailed solid recipes =================
def rock(seed, base, warmth=(0,0,0), coolness=(0,0,0), rough=210, metal=0,
         crack_amt=0.012, crack_oct=4, crack_scale=14.0, pore=0.0, regions=6):
    """generic detailed stone/rock."""
    p=make_perm(seed); pg=make_perm(seed+5); pc=make_perm(seed+9); pp=make_perm(seed+17)
    col=[]; hgt=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,regions)
            region = warmth if vid>0.5 else coolness
            meso=(fbm(p,x,y,5,9.0)-0.5)
            grit=(fine(pg,x,y)-0.5)
            lum=meso*30+grit*20
            r=ridged(pc,x,y,crack_oct,crack_scale)
            crack = 1.0 if r>(1.0-crack_amt*55) else 0.0
            pr = 1.0 if (pore and vnoise(pp,x*1.3,y*1.3)>(1.0-pore)) else 0.0
            c=(c8(base[0]+region[0]+lum), c8(base[1]+region[1]+lum), c8(base[2]+region[2]+lum))
            if crack: c=mix(c,(c[0]-70,c[1]-70,c[2]-68),0.85)
            if pr:    c=mix(c,(c[0]-55,c[1]-55,c[2]-54),0.8)
            col.append(c+(255,))
            h=c8(150+meso*70+grit*55 - crack*120 - pr*60); hgt.append((h,h,h))
            mer.append((metal,0,c8(rough+(0.5-grit)*30+crack*25)))
    return col,hgt,mer

def soil(seed, browns, pebble=(150,138,120), dark=(46,32,20), rough=234,
         npeb=14, grit_amt=26):
    p=make_perm(seed); pg=make_perm(seed+5); pd=make_perm(seed+11)
    col=[]; hgt=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,npeb)
            base=browns[int(vid*len(browns))%len(browns)]
            meso=(fbm(p,x,y,5,5.0)-0.5); grit=(fine(pg,x,y)-0.5)
            dome=1.0-min(1.0,f1*1.7)
            c=mix((base[0]-26,base[1]-22,base[2]-18),(base[0]+18,base[1]+16,base[2]+14),dome*0.7+0.5+grit*0.5)
            c=(c8(c[0]+meso*16),c8(c[1]+meso*14),c8(c[2]+meso*12))
            # organic dark crumbs + light grit
            spk=vnoise(pd,x*2.1,y*2.1)
            if spk>0.86: c=mix(c,dark,0.7); dh=-40
            elif spk<0.08: c=mix(c,pebble,0.55); dh=30
            else: dh=0
            c=(c8(c[0]+grit*grit_amt),c8(c[1]+grit*grit_amt),c8(c[2]+grit*grit_amt))
            col.append(c+(255,))
            h=c8(120+dome*70+meso*30+grit*40+dh); hgt.append((h,h,h))
            mer.append((0,0,c8(rough+(0.5-grit)*20)))
    return col,hgt,mer

def cobblestone(seed):
    p=make_perm(seed); pg=make_perm(seed+5); pc=make_perm(seed+9)
    col=[]; hgt=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(seed,x,y,5); edge=f2-f1
            grit=(fine(pg,x,y)-0.5); meso=(fbm(p,x,y,4,6.0)-0.5)
            if edge<0.07:
                base=mix((54,54,58),(74,74,78),0.5+meso+grit*0.4); c=base; h=66+grit*16; rough=236
            else:
                shade=92+vid*78; dome=1.0-min(1.0,f1*1.5)
                lum=shade+dome*34+meso*22+grit*26
                # micro-cracks on cobbles
                cr=ridged(pc,x,y,3,9.0);
                if cr>0.86: lum-=46
                c=(c8(lum),c8(lum),c8(lum+4)); h=118+dome*108+grit*26 - (40 if cr>0.86 else 0); rough=206
            col.append(c+(255,)); hh=c8(h); hgt.append((hh,hh,hh)); mer.append((0,0,c8(rough)))
    return col,hgt,mer

def sand(seed):
    pg=make_perm(seed+5); pd=make_perm(seed+11); p=make_perm(seed)
    base=(212,198,158); col=[]; hgt=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            grit=fine(pg,x,y); micro=vnoise(pd,x*3.1,y*3.1); dune=(fbm(p,x,y,3,22.0)-0.5)
            lum= grit*34 + micro*22 + dune*10 - 18
            c=(c8(base[0]+lum),c8(base[1]+lum-8),c8(base[2]+lum-30))
            if micro>0.9: c=mix(c,(150,134,98),0.5)      # occasional darker grain
            col.append(c+(255,))
            h=c8(120+grit*46+micro*26+dune*16); hgt.append((h,h,h))
            mer.append((0,0,c8(238)))
    return col,hgt,mer

def planks(seed, light, dark, rough=196):
    p=make_perm(seed); pg=make_perm(seed+5); pr=make_perm(seed+9)
    col=[]; hgt=[]; mer=[]; nb=4; bh=RES/nb
    for y in range(RES):
        bi=int(y//bh); within=(y-bi*bh)/bh; bo=_ihash(bi,7,seed)
        btone=((bo&255)/255.0-0.5)*30; joint=int(((bo>>8)&255)/255.0*RES)
        hseam = within<0.035 or within>0.965
        for x in range(RES):
            grain=fbm(p,(x+bi*53)*0.45,(y%int(bh))*4.5,4,11.0)        # crisp stretched grain
            line=ridged(pr,(x+bi*31)*0.5,(y%int(bh))*5.0,3,12.0)      # dark grain lines
            grit=(fine(pg,x,y)-0.5)
            lum=light[0]+btone+(dark[0]-light[0])*(0.30+grain*0.55)
            if line>0.72: lum-=34
            lum+=grit*14
            c=(c8(lum),c8(lum*light[1]/light[0]),c8(lum*light[2]/light[0]))
            vseam=abs(((x-joint)%RES))<2*SCALE
            if hseam or vseam: c=mix(c,(48,32,16),0.78)
            kx=(bo>>16)%RES; ky=int(bh*0.5+bi*bh)
            if math.hypot(x-kx,y-ky)<4*SCALE: c=mix(c,(58,38,20),0.6)
            col.append(c+(255,))
            h=c8(150+grain*46 - (line>0.72)*30 - (hseam or vseam)*100 + grit*16); hgt.append((h,h,h))
            mer.append((0,0,c8(rough+grain*18+(line>0.72)*14)))
    return col,hgt,mer

def log_side(seed, bark, barkd, crev=(40,28,16), rough=224):
    p=make_perm(seed); pc=make_perm(seed+9); pg=make_perm(seed+5); col=[]; hgt=[]; mer=[]
    for y in range(RES):
        for x in range(RES):
            warp=fbm(p,x,y,4,16.0); ridge=cont(abs(math.sin(x*0.16*SCALE+warp*5.0)),1.6)
            crack=ridged(pc,x*0.7,y*0.25,3,9.0); grit=(fine(pg,x,y)-0.5)
            c=mix(barkd,bark,ridge); c=(c8(c[0]+grit*16),c8(c[1]+grit*15),c8(c[2]+grit*13))
            if crack>0.8: c=mix(c,crev,0.8)
            col.append(c+(255,))
            h=c8(70+ridge*160+grit*30 - (crack>0.8)*70); hgt.append((h,h,h))
            mer.append((0,0,c8(rough+(ridge-0.5)*24)))
    return col,hgt,mer

def log_top(seed, ring, ringd, core, rough=205):
    p=make_perm(seed); pr=make_perm(seed+9); pg=make_perm(seed+5)
    col=[]; hgt=[]; mer=[]; cx=cy=RES/2
    for y in range(RES):
        for x in range(RES):
            d=math.hypot(x-cx,y-cy)+fbm(p,x,y,3,10.0)*6
            r=cont((math.sin(d*0.32*SCALE)+1)/2,1.5); grit=(fine(pg,x,y)-0.5)
            rad=ridged(pr,x*0.4,y*0.4,2,18.0)                 # radial-ish cracks
            c=mix(ringd,ring,r); c=(c8(c[0]+grit*14),c8(c[1]+grit*13),c8(c[2]+grit*11))
            if d<7*SCALE: c=mix(c,core,0.6)
            if rad>0.85: c=mix(c,(60,42,24),0.6)
            col.append(c+(255,))
            h=c8(140+r*64+grit*24 - (rad>0.85)*40); hgt.append((h,h,h))
            mer.append((0,0,c8(rough)))
    return col,hgt,mer

def grass_top():
    p=make_perm(31); pb=make_perm(77); pg=make_perm(91); col=[]; hgt=[]; mer=[]
    light=(198,208,168); dark=(138,158,104)
    for y in range(RES):
        for x in range(RES):
            f1,f2,vid=voronoi(31,x,y,10)
            blade=fbm(p,x*0.7,y*2.2,4,5.0); fleck=fine(pg,x,y); grit=(fine(pb,x,y)-0.5)
            t=cont(0.4*vid+0.45*blade+0.15*fleck,1.5)
            c=mix(dark,light,t); c=(c8(c[0]+grit*16),c8(c[1]+grit*16),c8(c[2]+grit*13))
            if fleck>0.85: c=mix(c,(110,132,78),0.55)        # dark blade tips
            if vid<0.07: c=mix(c,(120,104,72),0.4)           # tiny soil showing
            col.append(c+(255,))
            h=c8(118+t*86+grit*30); hgt.append((h,h,h)); mer.append((0,0,240))
    return col,hgt,mer

def grass_side():
    col,hgt,mer=soil(42,[(104,78,52),(92,68,46),(118,90,60),(82,60,40)],npeb=12)
    p=make_perm(88); fr=int(RES*0.36)
    for x in range(RES):
        blade=int(fr*(0.4+fbm(p,x*1.4,0,3,7.0)*1.0))
        for y in range(blade):
            i=y*RES+x; t=1.0-y/max(1,blade)
            gc=mix((118,148,80),(176,196,116),t*0.7+vnoise(p,x*2.2,y*2.2)*0.3)
            col[i]=gc+(255,); hh=c8(150+t*82); hgt[i]=(hh,hh,hh); mer[i]=(0,0,240)
    return col,hgt,mer

def ore(seed, mineral, metal, rmin, rbase=210, emis=0, nodes=9, sparkle=False):
    col,hgt,mer=rock(seed,(126,126,131),(8,4,-2),(-6,-4,6),rbase,crack_amt=0.010)
    rnd=random.Random(seed+7); pe=make_perm(seed+13); ps=make_perm(seed+23)
    cen=[(rnd.randint(0,RES-1),rnd.randint(0,RES-1),rnd.uniform(RES*0.05,RES*0.11)) for _ in range(nodes)]
    md=mix(mineral,(0,0,0),0.5)
    for y in range(RES):
        for x in range(RES):
            best=9.9
            for (cxc,cyc,r) in cen: best=min(best,math.hypot(x-cxc,y-cyc)/r)
            edge=fbm(pe,x,y,3,4.0); m=(1.0-best)+(edge-0.5)*0.55
            if m>0.0:
                t=max(0.0,min(1.0,m)); i=y*RES+x
                c=mix(mix((col[i][0],col[i][1],col[i][2]),md,0.9),mineral,t)
                spark=0
                if sparkle and t>0.5 and vnoise(ps,x*2.4,y*2.4)>0.84:
                    c=mix(c,(255,255,255),0.5); spark=40
                col[i]=c+(255,)
                hh=c8(135+t*100+spark); hgt[i]=(hh,hh,hh)
                mer[i]=(c8(metal*t),c8(emis*t),c8(rbase+(rmin-rbase)*t))
    return col,hgt,mer

# ---------- animated emissive LAVA ----------
def lava_frame(seed, f, frames, flow=False):
    p=make_perm(seed); pc=make_perm(seed+9); pg=make_perm(seed+5)
    t=f/frames
    oy = (t* RES) if flow else 0.0                     # scroll downward for flow
    ph = t*2*math.pi
    crust=(52,22,12); crustd=(22,9,7)                  # dark basalt
    col=[(0,0,0,0)]*(RES*RES); hgt=[(0,0,0)]*(RES*RES); mer=[(0,0,0)]*(RES*RES)
    for y in range(RES):
        for x in range(RES):
            yy=y+oy
            base=fbm(p, x+math.sin(ph)*4, yy+math.cos(ph)*4, 4, 30.0)
            crk=ridged(pc, x+math.sin(ph)*3, yy+math.cos(ph)*3, 4, 34.0)
            glow=cont(crk*0.92+base*0.18, 2.1)          # thin glowing crack network
            grit=(fine(pg,x,yy)-0.5)
            if glow<0.5:                                # cooled crust dominates
                c=mix(crustd,crust,base+grit*0.4+0.25); e=c8(glow*55)   # faint red seep
                h=c8(150+grit*42); rough=188
            else:                                       # glowing molten seam
                hot=(glow-0.5)/0.5
                c=mix((214,62,16),(255,244,198),cont(hot,1.25))         # orange -> white-hot
                e=c8(150+hot*105)                       # strong emissive -> bloom
                h=c8(95-hot*44+grit*18); rough=70
            col[y*RES+x]=c+(255,); hgt[y*RES+x]=(h,h,h); mer[y*RES+x]=(0,e,c8(rough))
    return col,hgt,mer

def emit_lava(name, flow, frames=16, tpf=3):
    cf=[]; hf=[]; mf=[]
    for f in range(frames):
        c,h,m=lava_frame(700 if not flow else 701, f, frames, flow); cf.append(c); hf.append(h); mf.append(m)
    _strip(name,cf)                 # animated RGBA color strip
    _stripRGB(name+"_height",hf)
    _stripRGB(name+"_mer",mf)
    json.dump({"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}},
        open(os.path.join(OUT,name+".texture_set.json"),"w"),indent=2)
    FLIP.append({"flipbook_texture":"textures/blocks/"+name,"atlas_tile":name,
                 "ticks_per_frame":tpf,"blend_frames":True})
    for s in (name,name+"_mer",name+"_height"): ALL.add("textures/blocks/"+s)
def _stripRGB(name,frames):
    im=Image.new("RGB",(RES,RES*len(frames))); d=[]; [d.extend(f) for f in frames]
    im.putdata(d); im.save(os.path.join(OUT,name+".png"))

# ---------- foliage sprites ----------
def blades(seed,c1,c2,density=0.5,hf=0.95,thick=2):
    px=[(0,0,0,0)]*(RES*RES); thick=max(1,thick*SCALE); rnd=random.Random(seed)
    for _ in range(int(RES*density)):
        bx=rnd.randint(2,RES-3); top=int(RES*(1-hf*rnd.uniform(0.6,1.0))); sway=rnd.uniform(-0.12,0.12)
        col=mix(c1,c2,rnd.random())
        for y in range(top,RES):
            xx=int(bx+sway*(RES-y))
            for w in range(-thick//2,thick//2+1):
                X=xx+w
                if 0<=X<RES:
                    sh=mix(col,(col[0]-34,col[1]-34,col[2]-28),(y-top)/max(1,RES-top)); px[y*RES+X]=sh+(255,)
    return px
def leaves(seed,c1,c2):
    p=make_perm(seed); pg=make_perm(seed+5); px=[]
    for y in range(RES):
        for x in range(RES):
            n=cont(fbm(p,x,y,4,5.0),1.6); grit=(fine(pg,x,y)-0.5); hole=vnoise(make_perm(seed+5),x/2.3,y/2.3)
            if hole<0.30: px.append((0,0,0,0))
            else: c=mix(c1,c2,n); px.append((c8(c[0]+grit*22),c8(c[1]+grit*22),c8(c[2]+grit*18),255))
    return px
def flower(seed,stem,petal,center):
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
def sapling(seed):
    px=blades(seed,(96,150,70),(70,120,50),0.25,0.55,2); rnd=random.Random(seed+3)
    cx=RES//2; cy=int(RES*0.4)
    for y in range(RES):
        for x in range(RES):
            if math.hypot(x-cx,y-cy)<RES*0.18 and rnd.random()<0.7: px[y*RES+x]=mix((104,150,72),(76,120,52),rnd.random())+(255,)
    return px
def wheat(seed,stage):
    t=stage/7.0; return blades(seed,mix((150,170,90),(206,172,70),t),mix((118,138,68),(172,142,54),t),0.55,0.4+0.55*t,2)

# ================= GENERATE =================
print("solid blocks...")
emit_pbr("stone",*rock(1,(128,128,132),(7,4,-2),(-6,-4,7),212,crack_amt=0.012,pore=0.015))
emit_pbr("cobblestone",*cobblestone(2))
emit_pbr("dirt",*soil(3,[(106,80,53),(94,70,47),(120,92,62),(84,62,41)]))
emit_pbr("sand",*sand(4))
emit_pbr("gravel",*soil(5,[(128,124,118),(150,140,128),(98,96,98),(112,88,68)],pebble=(176,170,160),dark=(60,58,58),npeb=10,rough=222))
emit_pbr("planks_oak",*planks(10,(172,136,86),(118,88,50)))
emit_pbr("planks_birch",*planks(11,(208,190,142),(166,146,102)))
emit_pbr("planks_spruce",*planks(12,(124,94,58),(84,60,36)))
emit_pbr("log_oak",*log_side(20,(128,98,62),(72,52,32)))
emit_pbr("log_birch",*log_side(21,(224,222,214),(120,120,112),crev=(70,70,66)))
emit_pbr("log_spruce",*log_side(22,(94,70,46),(52,36,22)))
emit_pbr("log_oak_top",*log_top(30,(174,140,90),(120,92,56),(150,116,72)))
emit_pbr("log_birch_top",*log_top(31,(214,202,166),(168,156,120),(196,182,150)))
emit_pbr("log_spruce_top",*log_top(32,(134,102,66),(92,68,42),(112,86,54)))
emit_pbr("grass_top",*grass_top())
emit_pbr("grass_side",*grass_side())
print("ores...")
emit_pbr("coal_ore",*ore(40,(34,34,36),0,200))
emit_pbr("iron_ore",*ore(41,(200,166,134),190,90))
emit_pbr("gold_ore",*ore(42,(248,208,94),220,60,sparkle=True))
emit_pbr("copper_ore",*ore(43,(200,122,88),200,80))
emit_pbr("diamond_ore",*ore(44,(124,228,226),0,46,emis=34,sparkle=True))
emit_pbr("emerald_ore",*ore(45,(74,204,114),0,52,sparkle=True))
emit_pbr("lapis_ore",*ore(46,(46,88,184),0,68,sparkle=True))
emit_pbr("redstone_ore",*ore(47,(204,44,34),0,86,emis=80))
print("lava...")
emit_lava("lava_still", flow=False, frames=16, tpf=3)
emit_lava("lava_flow",  flow=True,  frames=16, tpf=2)
print("foliage (waving)...")
G=dict(amp=1.4,frames=16,tpf=4)
emit_flip("tallgrass",blades(50,(184,202,122),(148,174,94),0.6),**G)
emit_flip("fern",blades(51,(172,196,118),(138,168,90),0.5,thick=1),**G)
emit_flip("double_plant_grass_top",blades(52,(186,204,124),(150,178,98),0.7),**G)
emit_flip("double_plant_grass_bottom",blades(53,(178,196,116),(144,170,92),0.7,1.0),**G)
emit_flip("flower_dandelion",flower(60,(96,150,70),(248,216,70),(252,238,140)),**G)
emit_flip("flower_rose",flower(61,(96,150,70),(206,52,44),(60,40,30)),**G)
emit_flip("sapling_oak",sapling(62),**G)
emit_flip("leaves_oak",leaves(70,(150,182,104),(92,134,66)),anchored=False,**G)
emit_flip("leaves_birch",leaves(71,(168,194,120),(114,152,80)),anchored=False,**G)
emit_flip("leaves_spruce",leaves(72,(120,150,96),(72,106,62)),anchored=False,**G)
for s in range(8): emit_flip("wheat_stage_%d"%s,wheat(80+s,s),**G)

json.dump(FLIP,open(os.path.join(TEXROOT,"flipbook_textures.json"),"w"),indent=2)
json.dump(sorted(ALL),open(os.path.join(TEXROOT,"textures_list.json"),"w"),indent=2)
print("DONE: %d files, %d flipbooks, %d listed"%(len(os.listdir(OUT)),len(FLIP),len(ALL)))
