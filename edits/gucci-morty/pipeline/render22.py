import numpy as np, cv2, json, subprocess, glob

J=json.load(open('grid16.json')); PER=J['period']; PH=J['phase']
FPS,DUR=60,16.0; T0=PH+round((11.8841-PH)/PER)*PER
N=int(DUR*FPS); BAR=4*PER
frames=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
mattes=np.load('mattes.npy'); NSRC=len(frames); H,W=frames[0].shape[:2]
rng=np.random.default_rng(7)

# ---- sprite: shared crop box across all frames so placement stays consistent ----
U=(mattes.max(0)>0); ys,xs=np.nonzero(U)
X0,X1,Y0,Y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
SW,SH=X1-X0,Y1-Y0
FEET_Y, CTR_X = 500.0, 283.0            # his ground point / centre, in frame coords
ax, ay = CTR_X-X0, FEET_Y-Y0            # anchor inside the sprite
print(f"sprite crop {SW}x{SH} at ({X0},{Y0}); anchor ({ax:.0f},{ay:.0f})")

# ---- crowd layout: perspective, vanishing point ~ (300,250) ----
VP_Y=250.0
scale_of=lambda fy:(fy-VP_Y)/(FEET_Y-VP_Y)
SLOTS=[  # (appear_bar, centre_x, feet_y) -- receding rows, widening with depth
 (1,128,500),(1,438,500),                          # row 1, full size, flanking him
 (2,200,448),(2,325,448),                          # row 2 inner
 (3, 74,448),(3,451,448),                          # row 2 outer
 (4,155,412),(4,355,412),                          # row 3
 (5, 55,412),(5,255,412),(5,455,412),
 (6,105,388),(6,283,388),(6,460,388),              # row 4, furthest
]
SLOTS.sort(key=lambda s:s[2])           # back to front
print(f"{len(SLOTS)} copies + the original = {len(SLOTS)+1} Mortys by the end")

SC=sorted({round(scale_of(fy),3) for _,_,fy in SLOTS}|{1.0})
sprites={}
for si,s in enumerate(SC):
    w,h=max(2,int(round(SW*s))),max(2,int(round(SH*s)))
    for k in range(NSRC):
        rgb=frames[k][Y0:Y1,X0:X1].astype(np.float32)
        a=cv2.GaussianBlur(mattes[k][Y0:Y1,X0:X1].astype(np.float32)*255,(0,0),0.8)/255.0
        r=cv2.resize(rgb,(w,h),interpolation=cv2.INTER_AREA)
        aa=cv2.resize(a,(w,h),interpolation=cv2.INTER_AREA)[...,None]
        if s<0.999:                      # atmospheric haze: distance lifts and flattens
            hz=(1.0-s)*0.22
            r=r*(1-hz)+np.float32([168,168,162])*hz
        sprites[(si,k)]=(r,np.clip(aa,0,1))
print("pre-rendered", len(sprites), "sprite variants")

def paste(dst,rgb,a,cx,fy):
    h,w=a.shape[:2]; s=w/SW
    x=int(round(cx-ax*s)); y=int(round(fy-ay*s))
    x0,x1=max(0,x),min(W,x+w); y0,y1=max(0,y),min(H,y+h)
    if x0>=x1 or y0>=y1: return
    sa=a[y0-y:y1-y,x0-x:x1-x]; sr=rgb[y0-y:y1-y,x0-x:x1-x]
    dst[y0:y1,x0:x1]=dst[y0:y1,x0:x1]*(1-sa)+sr*sa

# ---- phonk grade / effects (unchanged from render20) ----
BASE_Z=1.035; Z_KICK,Z_BAR=0.024,0.013; SHAKE_PX=2.0; RGB_PX=1.2; GRAIN=0.017; VIGN=0.58
def imp(t,per,tau):
    dt=t-round(t/per)*per; return float(np.exp(-(dt/tau)**2))
def hit(t,per,to,ti=0.018):
    dt=t-round(t/per)*per; return float(np.exp(-(dt/(ti if dt<0 else to))**2))
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
nx=(xx-W/2)/(W/2); ny=(yy-H/2)/(H/2); rad=np.sqrt(nx*nx*0.92+ny*ny*0.82)
VIG=(1.0-VIGN*np.clip((rad-0.28)/1.05,0,1)**1.6)[...,None].astype(np.float32)
def grade(x):
    x=np.clip((x-0.038)/0.962,0,1); x=x**1.20; x=np.clip((x-0.48)*1.24+0.45,0,1)
    L=x.mean(2,keepdims=True); sh=(1-L[...,0])
    x[...,0]*=(1+0.105*sh); x[...,1]*=(1-0.030*sh); x[...,2]*=(1+0.045*sh)
    g=x.mean(2,keepdims=True); x=np.clip(g+(x-g)*1.12,0,1)
    hi=np.clip((x.mean(2,keepdims=True)-0.80)/0.20,0,1)*x
    return np.clip(x+cv2.GaussianBlur(hi,(0,0),12)*0.14,0,1)
def chroma(x,d):
    if d<0.08: return x
    o=x.copy()
    for ch,s in ((2,d),(0,-d)):
        o[...,ch]=cv2.warpAffine(x[...,ch],np.float32([[1,0,s],[0,1,0]]),(W,H),
                                 flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
    return o

p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}',
  '-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','15','-pix_fmt','yuv420p',
  '-profile:v','high','video22.mp4'],stdin=subprocess.PIPE)
sidx={round(s,3):i for i,s in enumerate(SC)}
for i in range(N):
    t=i/FPS; tau=t-np.floor(t/PER)*PER
    src=min(int(round(tau*FPS)),NSRC-1)
    out=frames[src].astype(np.float32)
    for bar,cx,fy in SLOTS:                      # back to front
        te=t-bar*BAR
        if te<-1e-9: continue
        s=round(scale_of(fy),3)
        rgb,a=sprites[(sidx[s],src)]
        pop=1.0+0.18*np.exp(-(te/0.055)**2)
        if pop>1.004:
            h2,w2=max(2,int(round(a.shape[0]*pop))),max(2,int(round(a.shape[1]*pop)))
            rgb=cv2.resize(rgb,(w2,h2),interpolation=cv2.INTER_LINEAR)
            a=cv2.resize(a[...,0],(w2,h2),interpolation=cv2.INTER_LINEAR)[...,None]
        paste(out,rgb,a,cx,fy)
    rgb,a=sprites[(sidx[1.0],src)]               # the real Morty stays frontmost
    paste(out,rgb,a,CTR_X,FEET_Y)

    ramp=0.78+0.40*(t/DUR)
    z=BASE_Z+(Z_KICK*imp(t,PER,0.090)+Z_BAR*imp(t,BAR,0.100))*ramp
    ks=hit(t,PER,0.055); kc=hit(t,PER,0.060)
    M=cv2.getRotationMatrix2D((W/2,H/2-10),0,z)
    M[0,2]+=SHAKE_PX*0.45*ks*ramp*(1 if int(round(t/PER))%2 else -1); M[1,2]+=SHAKE_PX*ks*ramp
    x=cv2.warpAffine(out/255.0,M,(W,H),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    x=chroma(grade(x),RGB_PX*kc*ramp)*VIG
    g=rng.normal(0,1,(H//2,W//2,1)).astype(np.float32)
    x=np.clip(x+cv2.resize(g,(W,H),interpolation=cv2.INTER_LINEAR)[...,None]*GRAIN,0,1)
    p.stdin.write((x*255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait(); print("wrote video22.mp4")
