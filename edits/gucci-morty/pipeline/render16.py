import numpy as np, cv2, json, subprocess, glob

J=json.load(open('grid16.json')); PER=J['period']; PH=J['phase']
FPS, DUR = 60, 16.0
T0 = PH + round((11.8841-PH)/PER)*PER          # clip start, exactly on a kick
N  = int(DUR*FPS)

# Morty's own bob curve, measured from his 29 frames (face travel, px).
# 0 = lowest (just after the snap), 1 = fully lifted.
MORTY_DY = np.array([0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-10,-11,-12,-13,-13,-14,-14,
                     -14,-14,-14,-14,-14,-14,-14,-14,-14,-14,-14], float)
CURVE = -MORTY_DY/14.0

frames=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
H,W = frames[0].shape[:2]; NSRC=len(frames)

# --- Spider-Man sprite ---
SP_H, SP_CX, SP_BASE_Y = 275, 112, 510
T_ENTER = PH + np.ceil((T0+6.0-PH)/PER)*PER - T0      # first kick at/after 6s
rgb=np.load('sp_rgb.npy'); al=np.load('sp_a.npy')
sw=int(round(rgb.shape[1]*SP_H/rgb.shape[0]))
_r=cv2.resize(rgb,(sw,SP_H),interpolation=cv2.INTER_AREA).astype(np.float32)
_a=cv2.resize(al ,(sw,SP_H),interpolation=cv2.INTER_AREA).astype(np.float32)/255.0
# Pad the canvas: the entry pop scales him UP about his planted base, so without
# headroom the top of his head is clipped off on the pop frames.
PAD_T, PAD_X = 64, 32
CH, CW = SP_H+PAD_T, sw+2*PAD_X
SP_RGB=np.zeros((CH,CW,3),np.float32); SP_A=np.zeros((CH,CW),np.float32)
SP_RGB[PAD_T:,PAD_X:PAD_X+sw]=_r; SP_A[PAD_T:,PAD_X:PAD_X+sw]=_a
SP_AMP = 0.040*SP_H                      # same bob fraction of height as Morty's
sy,sx = np.mgrid[0:CH,0:CW].astype(np.float32)
PROF = np.clip((CH-1-sy)/(SP_H-1),0,1)**1.4
print(f"T0={T0:.4f}s  spidey enters {T_ENTER:.4f}s (frame {int(round(T_ENTER*FPS))})  sprite {sw}x{SP_H} canvas {CW}x{CH}  amp {SP_AMP:.1f}px")

def spidey(dn, pop):
    # remap samples the SOURCE: to push content DOWN by dn, sample from above (y-dn)
    ys = sy - dn*PROF
    ys = sy - dn*(np.clip((CH-1-ys)/(SP_H-1),0,1)**1.4)
    xs = (sx-CW/2)/pop + CW/2
    ys = (ys-(CH-1))/pop + (CH-1)         # pop scales about the planted base
    xs=np.ascontiguousarray(xs,np.float32); ys=np.ascontiguousarray(ys,np.float32)
    r=cv2.remap(SP_RGB,xs,ys,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0))
    a=cv2.remap(SP_A ,xs,ys,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
    return r, np.clip(a,0,1)[...,None]

p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
    '-s',f'{W}x{H}','-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','slow',
    '-crf','16','-pix_fmt','yuv420p','-profile:v','high','video16.mp4'],stdin=subprocess.PIPE)

x0=int(round(SP_CX-CW/2)); y0=SP_BASE_Y-CH
FE=int(round(T_ENTER*FPS))   # entry snaps to the nearest frame
for i in range(N):
    t=i/FPS
    tau=t-np.floor(t/PER)*PER
    src=min(int(round(tau*FPS)), NSRC-1)
    out=frames[src].astype(np.float32)
    if i>=FE:
        te=(i-FE)/FPS
        pop=1.0+0.13*np.exp(-(te/0.060)**2)
        r,a=spidey(SP_AMP*(1.0-CURVE[src]), pop)
        xs0,xs1=max(0,x0),min(W,x0+CW); ys0,ys1=max(0,y0),min(H,y0+CH)
        sa=a[ys0-y0:ys1-y0, xs0-x0:xs1-x0]; sr=r[ys0-y0:ys1-y0, xs0-x0:xs1-x0]
        out[ys0:ys1,xs0:xs1]=out[ys0:ys1,xs0:xs1]*(1-sa)+sr*sa
    p.stdin.write(np.clip(out,0,255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait()
json.dump({'T0':T0,'PER':PER,'T_ENTER':T_ENTER,'DUR':DUR},open('render16.json','w'))
print("wrote video16.mp4;", N, "frames")
