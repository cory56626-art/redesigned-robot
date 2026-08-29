import numpy as np, cv2, os, json

FPS, DUR = 60, 8.0
# Timing fitted to the track: kick on every beat (105.82 BPM), clap on the offbeat.
T0        = 11.8841            # clip start: on a kick, grid fitted to this window
BEAT      = 0.56854
CLAP_OFF  = 0.2955   # clap lands this long after each kick

# Morty floats UP between hits and slams DOWN onto the beat. The impact pose is the
# ORIGINAL frame, so he only ever stretches above his source silhouette -> almost
# nothing of the background is ever revealed.
REST_LIFT  = 19.0     # px he hangs above rest between hits (at the head top)
A_STRONG   = 22.0     # quarter-note beat: lands 2.5px past rest -> impact squash
A_WEAK     = 7.5      # offbeat eighth: a small nudge
SIG_IN, SIG_OUT = 0.050, 0.115
Y_ANCH, Y_TOP, Y_NECK = 500.0, 109.0, 232.0
PROFILE_P, CX = 1.50, 283.0
SQUASH_K, SWAY_PX, TILT_RAD = 0.065, 2.0, 0.015
HEAD_LAG  = 0.016     # head trails the torso slightly (secondary motion)
P_BEAT, P_BAR, BASE_ZOOM = 0.010, 0.024, 1.014

img   = cv2.imread('frames/f001.png').astype(np.float32)
plate = cv2.imread('plate_v2.png').astype(np.float32)
alpha = cv2.imread('alpha_final.png',0).astype(np.float32)/255.0
H,W = alpha.shape
ell = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))
erase_src = cv2.GaussianBlur(cv2.dilate((alpha>0.35).astype(np.uint8),ell(5)).astype(np.float32),(0,0),1.1)

yy,xx = np.mgrid[0:H,0:W].astype(np.float32)
prof  = lambda y: np.clip((Y_ANCH-y)/(Y_ANCH-Y_TOP),0,1)**PROFILE_P
hwf   = lambda y: np.clip((Y_NECK+40.0-y)/120.0,0,1)**2

hits=[]; k=-3
while k*BEAT < DUR+1.0:
    hits.append((k*BEAT, A_STRONG))                 # kick  -> full nod
    hits.append((k*BEAT+CLAP_OFF, A_WEAK))          # clap  -> small accent
    k+=1
hits.sort()

def D(t):
    d=0.0
    for ht,a in hits:
        dt=t-ht
        if -0.26<dt<0.46:
            d += a*np.exp(-(dt/(SIG_IN if dt<0 else SIG_OUT))**2)
    return d-REST_LIFT

def punch(t):
    p=0.0
    for per,amp,s in ((BEAT,P_BEAT,0.070),(4*BEAT,P_BAR,0.090)):
        dt=t-round(t/per)*per
        p+=amp*np.exp(-(dt/s)**2)
    return p

wb=np.clip((yy-430.0)/45.0,0,1); wb=wb*wb*(3-2*wb); wb3=np.dstack([wb]*3)
os.makedirs('render5',exist_ok=True)
N=int(DUR*FPS); sig=[]
for i in range(N):
    t=i/FPS
    db, dh = D(t), D(t-HEAD_LAG)
    sig.append((t,db))
    dn = db/A_STRONG
    sway = SWAY_PX*np.sin(2*np.pi*t/(2*BEAT))
    tilt = TILT_RAD*np.sin(2*np.pi*t/(2*BEAT)+0.7)

    def field(y):
        hw=hwf(y); return (db*(1-hw)+dh*hw)*prof(y)
    ys = yy - field(yy); ys = yy - field(ys)
    p  = prof(ys)
    wscale = 1.0 + SQUASH_K*dn*p
    xs = CX + (xx-CX-sway*p)/np.maximum(wscale,1e-3)
    head = np.clip((Y_NECK-ys)/(Y_NECK-Y_TOP),0,1)**1.5
    xs = xs + tilt*(ys-Y_NECK)*head
    xs=np.ascontiguousarray(xs,np.float32); ys=np.ascontiguousarray(ys,np.float32)

    w_rgb=cv2.remap(img,xs,ys,cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    w_a=np.clip(cv2.remap(alpha,xs,ys,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0),0,1)[...,None]
    er=np.clip(erase_src[...,None]-w_a,0,1)
    out=(img*(1-er)+plate*er)*(1-w_a)+w_rgb*w_a
    out=out*(1-wb3)+img*wb3
    z=BASE_ZOOM+punch(t)
    M=cv2.getRotationMatrix2D((W/2,H/2-12),0,z)
    out=cv2.warpAffine(out,M,(W,H),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
    cv2.imwrite(f'render5/r{i:04d}.png',np.clip(out,0,255).astype(np.uint8))

json.dump(sig,open('bobsig5.json','w'))
d=np.array([s[1] for s in sig])
print(f"rendered {N} frames; head displacement {d.min():.2f}..{d.max():.2f} px (neg = lifted)")
