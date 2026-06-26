#!/usr/bin/env python3
"""Port the Bedrock pack's CC0 textures to a Java 1.20.1 resource pack (.zip).

- Renames Bedrock texture names -> Java names, Bedrock textures/blocks -> Java
  textures/block, manifest.json -> pack.mcmeta (pack_format 15 = 1.20.1).
- Converts heightmap -> LabPBR `_n` (normal in RG, AO in B, height in A) and
  MER -> LabPBR `_s` (R smoothness, G F0/metal, B porosity, A emission) so the
  blocks gain depth/reflectivity/emission under Iris + a LabPBR shaderpack.
- Ports animated lava and waving plants to Java `.mcmeta` frame animation.

NOTE: the Bedrock Vibrant Visuals shader (lighting/water/sky/fog) has no Java
resource-pack equivalent; that look comes from a GLSL shaderpack (Iris). These
LabPBR maps are built for exactly that. See the README written into the zip.
"""
import os, io, json, math, zipfile, shutil
from PIL import Image

HERE=os.path.dirname(__file__)
SRC=os.path.join(HERE,"..","RealisticDeferred","textures","blocks")
STAGE=os.path.join(HERE,"..","dist_java")
OUTB=os.path.join(STAGE,"assets","minecraft","textures","block")
if os.path.exists(STAGE): shutil.rmtree(STAGE)
os.makedirs(OUTB,exist_ok=True)

def load(name,mode="RGBA"):
    p=os.path.join(SRC,name+".png")
    return Image.open(p).convert(mode) if os.path.exists(p) else None

# ---------- LabPBR conversions ----------
def normal_from_height(h, strength=2.2):
    """height L image -> LabPBR _n RGBA (R,G normal, B AO=255, A=height). Tiling."""
    w,ht=h.size; px=h.load(); out=Image.new("RGBA",(w,ht)); o=out.load()
    for y in range(ht):
        for x in range(w):
            hl=px[(x-1)%w,y]; hr=px[(x+1)%w,y]; hu=px[x,(y-1)%ht]; hd=px[x,(y+1)%ht]
            dx=(hr-hl)/255.0*strength; dy=(hd-hu)/255.0*strength
            nx,ny,nz=-dx,-dy,1.0; L=math.sqrt(nx*nx+ny*ny+nz*nz)
            o[x,y]=(int((nx/L*0.5+0.5)*255),int((ny/L*0.5+0.5)*255),255,px[x,y])
    return out

def specular_from_mer(mer):
    """MER (R=metal,G=emissive,B=rough) -> LabPBR _s RGBA."""
    w,ht=mer.size; px=mer.load(); out=Image.new("RGBA",(w,ht)); o=out.load()
    for y in range(ht):
        for x in range(w):
            metal,emis,rough=px[x,y][:3]
            smooth=int((1.0-math.sqrt(rough/255.0))*255)        # perceptual smoothness
            g=230 if metal>100 else 8                            # metal index vs dielectric F0
            a=255 if emis<8 else min(254,emis)                   # 255 = no emission (LabPBR)
            o[x,y]=(smooth,g,0,a)
    return out

def save(name,img): img.save(os.path.join(OUTB,name+".png"))

def emit_solid(java, bedrock):
    c=load(bedrock,"RGBA"); h=load(bedrock+"_height","L"); m=load(bedrock+"_mer","RGBA")
    if c is None: print("  miss",bedrock); return
    save(java,c)
    if h is not None: save(java+"_n", normal_from_height(h))
    if m is not None: save(java+"_s", specular_from_mer(m))
    print("  ->",java)

# ---------- solid blocks (bedrock name -> java name) ----------
print("solid blocks + LabPBR...")
SOLID={"stone":"stone","cobblestone":"cobblestone","dirt":"dirt","sand":"sand","gravel":"gravel",
       "oak_planks":"planks_oak","oak_log":"log_oak","oak_log_top":"log_oak_top",
       "coal_ore":"coal_ore","iron_ore":"iron_ore","gold_ore":"gold_ore","copper_ore":"copper_ore",
       "diamond_ore":"diamond_ore","emerald_ore":"emerald_ore","lapis_ore":"lapis_ore","redstone_ore":"redstone_ore"}
for java,bed in SOLID.items(): emit_solid(java,bed)

# grass: top (tinted by Java), side composite + suppress vanilla overlay
emit_solid("grass_block_top","grass_top")
emit_solid("grass_block_side","grass_side")
Image.new("RGBA",(16,16),(0,0,0,0)).save(os.path.join(OUTB,"grass_block_side_overlay.png"))
print("  -> grass_block_top/side (+ transparent overlay)")

# ---------- animated lava (color + LabPBR, vertical strip + mcmeta) ----------
def strip_frames(img):
    w,ht=img.size; n=ht//w
    return [img.crop((0,i*w,w,(i+1)*w)) for i in range(n)]
def stack(frames,mode):
    w=frames[0].size[0]; out=Image.new(mode,(w,w*len(frames)))
    for i,f in enumerate(frames): out.paste(f,(0,i*w))
    return out
def emit_lava():
    c=load("lava_still","RGBA"); h=load("lava_still_height","L"); m=load("lava_still_mer","RGBA")
    if c is None: print("  no lava"); return
    cf=strip_frames(c); hf=strip_frames(h); mf=strip_frames(m); n=len(cf)
    save("lava_still", stack(cf,"RGBA"))
    save("lava_still_n", stack([normal_from_height(f) for f in hf],"RGBA"))
    save("lava_still_s", stack([specular_from_mer(f) for f in mf],"RGBA"))
    mc=json.dumps({"animation":{"frametime":3}})
    for suf in ("","_n","_s"):
        open(os.path.join(OUTB,"lava_still%s.png.mcmeta"%suf),"w").write(mc)
    print("  -> lava_still (%d-frame animated + LabPBR)"%n)
print("lava (animated emissive)...")
emit_lava()

# ---------- waving plants -> Java names + .mcmeta animation ----------
PLANTS={"grass":"tallgrass","dandelion":"flower_dandelion","poppy":"flower_rose",
        "oxeye_daisy":"flower_oxeye_daisy","allium":"flower_allium","blue_orchid":"flower_blue_orchid",
        "red_tulip":"flower_tulip_red","orange_tulip":"flower_tulip_orange","white_tulip":"flower_tulip_white",
        "pink_tulip":"flower_tulip_pink","azure_bluet":"flower_houstonia","cornflower":"flower_cornflower",
        "lily_of_the_valley":"flower_lily_of_the_valley","oak_sapling":"sapling_oak","birch_sapling":"sapling_birch",
        "spruce_sapling":"sapling_spruce","jungle_sapling":"sapling_jungle","acacia_sapling":"sapling_acacia",
        "dark_oak_sapling":"sapling_roofed_oak"}
PLANTS.update({"wheat_stage%d"%s:"wheat_stage_%d"%s for s in range(8)})
print("waving plants -> Java animation...")
mc=json.dumps({"animation":{"frametime":3}})
cnt=0
for java,bed in PLANTS.items():
    im=load(bed,"RGBA")
    if im is None: continue
    save(java,im)                                  # already a vertical sway strip
    open(os.path.join(OUTB,java+".png.mcmeta"),"w").write(mc)
    cnt+=1
print("  ->",cnt,"animated plants")

# ---------- pack.mcmeta + icon + readme ----------
json.dump({"pack":{"pack_format":15,
    "description":"§bRealistic Deferred§r (Java 1.20.1) — CC0 photo-PBR + LabPBR + waving.\n§7Use with Iris + a LabPBR shaderpack for the realistic look."}},
    open(os.path.join(STAGE,"pack.mcmeta"),"w"),indent=2)
icon=os.path.join(HERE,"..","RealisticDeferred","pack_icon.png")
if os.path.exists(icon): shutil.copy(icon, os.path.join(STAGE,"pack.png"))
open(os.path.join(STAGE,"README.txt"),"w").write(
"""Realistic Deferred — Java 1.20.1 resource pack
================================================
Real CC0 (AmbientCG) photo textures for common blocks + ores + animated lava,
with LabPBR _n (normal/height) and _s (smoothness/metal/emission) maps, plus
waving grass/flowers/saplings/wheat (frame animation).

INSTALL
1. Put this .zip in  .minecraft/resourcepacks/  and enable it in
   Options > Resource Packs.

FOR THE REALISTIC LOOK (lighting, water, reflections, bloom, real waving):
   Java needs a GLSL shaderpack — the Bedrock 'Vibrant Visuals' shader does NOT
   port. Install:
     - Fabric 1.20.1 + Sodium + Iris  (or OptiFine)
     - A LabPBR shaderpack, e.g. Complementary Reimagined, Complementary
       Shaders, or BSL  (enable its PBR / SpecularMap + NormalMap option)
   Then enable this resource pack ABOVE others. The _n/_s maps above feed the
   shaderpack's PBR so blocks get depth, reflectivity and lava glow.

Texture credit: AmbientCG (CC0). Plant/lava animation derived from vanilla art.
""")

# ---------- zip ----------
os.makedirs(os.path.join(HERE,"..","dist"),exist_ok=True)
outzip=os.path.join(HERE,"..","dist","RealisticDeferred-Java-1.20.1.zip")
if os.path.exists(outzip): os.remove(outzip)
with zipfile.ZipFile(outzip,"w",zipfile.ZIP_DEFLATED) as z:
    for r,_,fs in os.walk(STAGE):
        for fn in fs: z.write(os.path.join(r,fn),os.path.relpath(os.path.join(r,fn),STAGE))
print("BUILT",outzip, os.path.getsize(outzip)//1024//1024,"MB")
