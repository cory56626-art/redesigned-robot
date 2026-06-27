#!/usr/bin/env python3
"""Restore ONLY the realistic emissive lava (v1.5.0) into the shader pack.

Rebuilds animated lava_still/lava_flow (color + heightmap + emissive MER) from
the cached CC0 AmbientCG Lava001 material, plus the flipbook + textures_list
entries. Leaves all other blocks vanilla (shader-only pack).
"""
import os, io, json, zipfile
from PIL import Image, ImageEnhance, ImageChops

HERE=os.path.dirname(__file__)
OUT=os.path.join(HERE,"..","RealisticDeferred","textures","blocks")
TEXROOT=os.path.join(HERE,"..","RealisticDeferred","textures")
CACHE="/tmp/claude-0/-home-user-redesigned-robot/23c9e1e2-6dd9-510e-a53f-861852d3ba0e/scratchpad/acg"
RES=256
os.makedirs(OUT,exist_ok=True)
ALL=set(); FLIP=[]

def lava_maps(asset):
    z=zipfile.ZipFile(os.path.join(CACHE,asset+".zip")); names=z.namelist()
    def f(suf):
        for n in names:
            if n.endswith(suf): return n
    def L(n,mode): return Image.open(io.BytesIO(z.read(n))).convert(mode).resize((RES,RES),Image.LANCZOS)
    return {"color":L(f("_Color.jpg"),"RGB"),"disp":L(f("_Displacement.jpg"),"L"),
            "rough":L(f("_Roughness.jpg"),"L"),"emis":L(f("_Emission.jpg"),"L")}

def build_lava(name, asset, frames, scroll_tiles, tpf, emis_boost=1.6):
    m=lava_maps(asset); col=m["color"]; disp=m["disp"]; rough=m["rough"]
    emis=ImageEnhance.Brightness(m["emis"]).enhance(emis_boost)
    rough=ImageChops.subtract(rough, emis.point(lambda v:int(v*0.6)))   # hot = shinier
    cf=[]; hf=[]; mf=[]
    for i in range(frames):
        dy=int((i/frames)*RES*scroll_tiles)
        c=ImageChops.offset(col,0,dy); d=ImageChops.offset(disp,0,dy)
        r=ImageChops.offset(rough,0,dy); e=ImageChops.offset(emis,0,dy)
        cf.append(c.convert("RGBA")); hf.append(Image.merge("RGB",(d,d,d)))
        z0=Image.new("L",(RES,RES),0); mf.append(Image.merge("RGB",(z0,e,r)))
    def strip(suffix,imgs,mode):
        st=Image.new(mode,(RES,RES*frames))
        for i,im in enumerate(imgs): st.paste(im,(0,i*RES))
        st.save(os.path.join(OUT,name+suffix+".png"))
    strip("",cf,"RGBA"); strip("_height",hf,"RGB"); strip("_mer",mf,"RGB")
    json.dump({"format_version":"1.16.100","minecraft:texture_set":{
        "color":name,"metalness_emissive_roughness":name+"_mer","heightmap":name+"_height"}},
        open(os.path.join(OUT,name+".texture_set.json"),"w"),indent=2)
    FLIP.append({"flipbook_texture":"textures/blocks/"+name,"atlas_tile":name,
                 "ticks_per_frame":tpf,"blend_frames":True})
    for s in (name,name+"_mer",name+"_height"): ALL.add("textures/blocks/"+s)
    print("restored",name,"(%d-frame animated emissive)"%frames)

build_lava("lava_still","Lava001",frames=32,scroll_tiles=1.0,tpf=3)
build_lava("lava_flow","Lava001", frames=24,scroll_tiles=1.0,tpf=1)
json.dump(FLIP,open(os.path.join(TEXROOT,"flipbook_textures.json"),"w"),indent=2)
json.dump(sorted(ALL),open(os.path.join(TEXROOT,"textures_list.json"),"w"),indent=2)
print("DONE: lava restored,",len(ALL),"textures listed")
