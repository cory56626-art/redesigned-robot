import numpy as np, cv2, json, subprocess, glob

J=json.load(open('grid16.json')); PER=J['period']; PH=J['phase']
FPS, DUR = 60, 16.0
T0 = PH + round((11.8841-PH)/PER)*PER
N  = int(DUR*FPS); BAR = 4*PER
frames=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
H,W=frames[0].shape[:2]; NSRC=len(frames)
rng=np.random.default_rng(7)

BASE_Z   = 1.035        # headroom so shake/punch never expose an edge
Z_KICK, Z_BAR = 0.024, 0.013
SHAKE_PX = 2.0
RGB_PX   = 1.2          # a quick hit, not a permanent fringe
GRAIN    = 0.017
VIGNETTE = 0.58

def imp(t, per, tau):
    dt = t - round(t/per)*per
    return float(np.exp(-(dt/tau)**2))

def hit(t, per, tau_out, tau_in=0.018):
    # asymmetric: an impact should not anticipate itself
    dt = t - round(t/per)*per
    return float(np.exp(-(dt/(tau_in if dt<0 else tau_out))**2))

# vignette (precomputed)
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
nx=(xx-W/2)/(W/2); ny=(yy-H/2)/(H/2)
rad=np.sqrt(nx*nx*0.92+ny*ny*0.82)
VIG=(1.0-VIGNETTE*np.clip((rad-0.28)/1.05,0,1)**1.6)[...,None].astype(np.float32)

def grade(x):
    x=np.clip((x-0.038)/0.962,0,1)           # crush the blacks
    x=x**1.20                                # pull the mids down: moody, not hazy
    x=np.clip((x-0.48)*1.24+0.45,0,1)        # contrast, biased darker
    L=x.mean(2,keepdims=True)
    s=(1-L[...,0])
    x[...,0]*= (1+0.105*s)                   # B up in shadows   (BGR: 0=B)
    x[...,1]*= (1-0.030*s)                   # G down  -> purple cast
    x[...,2]*= (1+0.045*s)                   # R up a little
    g=x.mean(2,keepdims=True)
    x=np.clip(g+(x-g)*1.12,0,1)
    hi=np.clip((x.mean(2,keepdims=True)-0.80)/0.20,0,1)*x
    x=np.clip(x+cv2.GaussianBlur(hi,(0,0),12)*0.14,0,1)  # restrained bloom
    return x

def chroma(x,d):
    if d<0.08: return x
    out=x.copy()
    for ch,s in ((2,d),(0,-d)):                          # R right, B left
        M=np.float32([[1,0,s],[0,1,0]])
        out[...,ch]=cv2.warpAffine(x[...,ch],M,(W,H),flags=cv2.INTER_LINEAR,
                                   borderMode=cv2.BORDER_REPLICATE)
    return out

p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}',
    '-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','15','-pix_fmt','yuv420p',
    '-profile:v','high','video20.mp4'],stdin=subprocess.PIPE)

for i in range(N):
    t=i/FPS
    tau=t-np.floor(t/PER)*PER
    src=min(int(round(tau*FPS)),NSRC-1)
    ramp=0.78+0.40*(t/DUR)                    # effects escalate slightly; the song is flat
    k=imp(t,PER,0.090); kb=imp(t,BAR,0.100)
    ks=hit(t,PER,0.055); kc=hit(t,PER,0.060)
    kidx=int(round(t/PER))

    z=BASE_Z+(Z_KICK*k+Z_BAR*kb)*ramp
    dy=SHAKE_PX*ks*ramp                       # frame drops with the head snap
    dx=SHAKE_PX*0.45*ks*ramp*(1 if kidx%2 else -1)
    M=cv2.getRotationMatrix2D((W/2,H/2-10),0,z); M[0,2]+=dx; M[1,2]+=dy
    x=cv2.warpAffine(frames[src].astype(np.float32)/255.0,M,(W,H),
                     flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    x=grade(x)
    x=chroma(x,RGB_PX*kc*ramp)
    x=x*VIG
    g=rng.normal(0,1,(H//2,W//2,1)).astype(np.float32)
    x=np.clip(x+cv2.resize(g,(W,H),interpolation=cv2.INTER_LINEAR)[...,None]*GRAIN,0,1)
    p.stdin.write((x*255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait()
print("wrote video20.mp4")
