import numpy as np, cv2, json, subprocess, glob

J=json.load(open('grid16.json')); PER=J['period']; PH=J['phase']
FPS, DUR = 60, 16.0
T0 = PH + round((11.8841-PH)/PER)*PER
N  = int(DUR*FPS)
MORTY_DY = np.array([0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-10,-11,-12,-13,-13,-14,-14,
                     -14,-14,-14,-14,-14,-14,-14,-14,-14,-14,-14], float)
CURVE = -MORTY_DY/14.0                    # 0 = snapped-down pose, 1 = lifted pose

frames=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
H,W=frames[0].shape[:2]; NSRC=len(frames)

# ---- Morty's measured bob, frame 1 (down) -> frame 29 (up) ----
#   head  : +14 px right, -14 px up      (a diagonal swing, not a vertical bob)
#   body  : -10 px left  (counter-slide)     shoes: -7 px left
#   sharp cliff at the neck: below it the body barely moves vertically
M_HEAD, M_BODY, M_HEADH = 14.0, 10.0, 123.0
SP_H, SP_CX, SP_BASE_Y = 275, 112, 510
SP_HEAD_SRC, SP_SPRITE_SRC = 84.0, 450.0          # his head / full height, source px
sp_headh = SP_HEAD_SRC*SP_H/SP_SPRITE_SRC          # his head height once scaled
A_H  = M_HEAD*(sp_headh/M_HEADH)*1.45              # same fraction of head height, +45% so it reads at his size
A_B  = A_H*(M_BODY/M_HEAD)

rgb=np.load('sp_rgb.npy'); al=np.load('sp_a.npy')
sw=int(round(rgb.shape[1]*SP_H/rgb.shape[0]))
_r=cv2.resize(rgb,(sw,SP_H),interpolation=cv2.INTER_AREA).astype(np.float32)
_a=cv2.resize(al ,(sw,SP_H),interpolation=cv2.INTER_AREA).astype(np.float32)/255.0
PAD_T,PAD_X=64,48
CH,CW=SP_H+PAD_T, sw+2*PAD_X
SP_RGB=np.zeros((CH,CW,3),np.float32); SP_A=np.zeros((CH,CW),np.float32)
SP_RGB[PAD_T:,PAD_X:PAD_X+sw]=_r; SP_A[PAD_T:,PAD_X:PAD_X+sw]=_a

yl = np.arange(CH,dtype=np.float32)-PAD_T          # sprite-local row
neck_top, neck_bot = sp_headh*0.93, sp_headh*1.19
wh = np.clip((neck_bot-yl)/(neck_bot-neck_top),0,1); wh=wh*wh*(3-2*wh)   # 1 head, 0 body
v  = np.clip((yl-neck_bot)/(SP_H-neck_bot),0,1)
# body profile sampled from Morty (fractions of his head displacement)
bx = np.interp(v,[0.0,0.14,0.35,0.61,0.80,1.00],[0.0,0.21,0.45,0.71,0.65,0.50])
by = np.interp(v,[0.0,0.15,0.35,1.00],[0.30,0.14,0.0,0.0])
# displacement of the SNAPPED-DOWN pose relative to the photo (= his lifted pose)
DX = wh*(-A_H) + (1-wh)*( A_B*bx)
DY = wh*( A_H) + (1-wh)*( A_H*by)
print(f"head amp {A_H:.1f}px (head {sp_headh:.0f}px tall), body slide {A_B:.1f}px, neck {neck_top:.0f}-{neck_bot:.0f}")

sy,sx=np.mgrid[0:CH,0:CW].astype(np.float32)
def spidey(k, pop):
    dx=(DX*k)[:,None]; dy=(DY*k)[:,None]
    xs=sx-dx; ys=sy-dy                       # remap samples the source
    xs=(xs-CW/2)/pop+CW/2; ys=(ys-(CH-1))/pop+(CH-1)
    xs=np.ascontiguousarray(xs,np.float32); ys=np.ascontiguousarray(ys,np.float32)
    r=cv2.remap(SP_RGB,xs,ys,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(0,0,0))
    a=cv2.remap(SP_A ,xs,ys,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
    return r,np.clip(a,0,1)[...,None]

T_ENTER = PH + np.ceil((T0+6.0-PH)/PER)*PER - T0
FE=int(round(T_ENTER*FPS))
x0=int(round(SP_CX-CW/2)); y0=SP_BASE_Y-CH
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}',
    '-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p',
    '-profile:v','high','video17.mp4'],stdin=subprocess.PIPE)
for i in range(N):
    t=i/FPS
    tau=t-np.floor(t/PER)*PER
    src=min(int(round(tau*FPS)),NSRC-1)
    out=frames[src].astype(np.float32)
    if i>=FE:
        pop=1.0+0.13*np.exp(-(((i-FE)/FPS)/0.060)**2)
        r,a=spidey(1.0-CURVE[src], pop)
        xs0,xs1=max(0,x0),min(W,x0+CW); ys0,ys1=max(0,y0),min(H,y0+CH)
        sa=a[ys0-y0:ys1-y0,xs0-x0:xs1-x0]; sr=r[ys0-y0:ys1-y0,xs0-x0:xs1-x0]
        out[ys0:ys1,xs0:xs1]=out[ys0:ys1,xs0:xs1]*(1-sa)+sr*sa
    p.stdin.write(np.clip(out,0,255).astype(np.uint8).tobytes())
p.stdin.close(); p.wait()
json.dump({'T0':T0,'PER':PER,'T_ENTER':T_ENTER,'DUR':DUR,'A_H':A_H,'A_B':A_B},open('render17.json','w'))
print("wrote video17.mp4")
