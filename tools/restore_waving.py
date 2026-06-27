#!/usr/bin/env python3
"""Restore the waving foliage (grass/flowers/ferns/saplings/wheat) that was
accidentally removed in 1.6.0. Rebuilds vanilla-derived gentle-sway flipbooks
and MERGES them into flipbook_textures.json / textures_list.json alongside lava.
Leaves real blocks vanilla.
"""
import os, json, math, subprocess
from PIL import Image, ImageChops

HERE=os.path.dirname(__file__)
OUT=os.path.join(HERE,"..","RealisticDeferred","textures","blocks")
TEXROOT=os.path.join(HERE,"..","RealisticDeferred","textures")
CACHE="/tmp/claude-0/-home-user-redesigned-robot/23c9e1e2-6dd9-510e-a53f-861852d3ba0e/scratchpad/acg"
VANILLA="https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/textures/blocks/"
os.makedirs(OUT,exist_ok=True); os.makedirs(CACHE,exist_ok=True)
UP=128; FRAMES=16; TPF=4
NEWFLIP=[]; NEWTEX=[]

def get_vanilla(fn):
    p=os.path.join(CACHE,"vanilla_"+fn+".png")
    def ok(path):
        try:
            im=Image.open(path); im.load()
            return im if (im.width>=12 and im.height>=12) else None
        except Exception: return None
    im=ok(p)
    if im is None:
        subprocess.run(["curl","-sL","-m","40","-A","Mozilla/5.0",VANILLA+fn+".png","-o",p],check=False)
        im=ok(p)
    return im.convert("RGBA") if im else None

def wave(fn, amp_px=2.4, anchored=True):
    im=get_vanilla(fn)
    if im is None: print("   skip (missing)",fn); return
    src=im.resize((UP,UP),Image.NEAREST); amp=amp_px*(UP//64)
    strip=Image.new("RGBA",(UP,UP*FRAMES))
    for f in range(FRAMES):
        sh=amp*math.sin(2*math.pi*f/FRAMES)
        if anchored:
            frame=src.transform((UP,UP),Image.AFFINE,(1,sh/UP,-sh,0,1,0),resample=Image.NEAREST)
        else:
            frame=ImageChops.offset(src,int(round(sh)),0)
        strip.paste(frame,(0,f*UP))
    strip.save(os.path.join(OUT,fn+".png"))
    NEWFLIP.append({"flipbook_texture":"textures/blocks/"+fn,"atlas_tile":fn,
                    "ticks_per_frame":TPF,"blend_frames":True})
    NEWTEX.append("textures/blocks/"+fn)
    print("   waving:",fn)

print("restoring waving foliage...")
plants=["tallgrass","fern","double_plant_grass_carried","double_plant_fern_carried",
        "flower_dandelion","flower_rose","flower_oxeye_daisy","flower_allium","flower_blue_orchid",
        "flower_tulip_red","flower_tulip_orange","flower_tulip_white","flower_tulip_pink",
        "flower_houstonia","flower_cornflower","flower_lily_of_the_valley",
        "sapling_oak","sapling_birch","sapling_spruce","sapling_jungle","sapling_acacia","sapling_roofed_oak"]
for fn in plants: wave(fn)
for s in range(8): wave("wheat_stage_%d"%s, amp_px=2.0)

# ---- merge with existing (lava) flipbook + textures_list ----
fp=os.path.join(TEXROOT,"flipbook_textures.json")
cur=json.load(open(fp)) if os.path.exists(fp) else []
have={e["atlas_tile"] for e in cur}
for e in NEWFLIP:
    if e["atlas_tile"] not in have: cur.append(e)
json.dump(cur,open(fp,"w"),indent=2)

tp=os.path.join(TEXROOT,"textures_list.json")
tl=set(json.load(open(tp))) if os.path.exists(tp) else set()
tl.update(NEWTEX)
json.dump(sorted(tl),open(tp,"w"),indent=2)
print("DONE: restored %d waving plants; flipbook now has %d entries"%(len(NEWFLIP),len(cur)))
