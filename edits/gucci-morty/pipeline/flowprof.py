import numpy as np, cv2, glob
fs=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
m=(cv2.imread('mask_final.png',0)>0)
a=cv2.cvtColor(fs[0],cv2.COLOR_BGR2GRAY); b=cv2.cvtColor(fs[-1],cv2.COLOR_BGR2GRAY)
fl=cv2.calcOpticalFlowFarneback(a,b,None,0.5,5,31,5,7,1.5,cv2.OPTFLOW_FARNEBACK_GAUSSIAN)
gx=cv2.Sobel(a,cv2.CV_32F,1,0,3); gy=cv2.Sobel(a,cv2.CV_32F,0,1,3)
tex=cv2.GaussianBlur(np.hypot(gx,gy),(0,0),2)      # trust only textured pixels
good=m&(tex>12)
print(f"{'y band':>12} {'dx':>7} {'dy':>7} {'n':>6}")
rows=[]
for y0 in range(105,505,20):
    y1=y0+20
    sel=np.zeros_like(good); sel[y0:y1]=good[y0:y1]
    n=int(sel.sum())
    if n<150: 
        print(f"{y0:>5}-{y1:<6} {'-':>7} {'-':>7} {n:>6}"); continue
    dx=float(np.median(fl[...,0][sel])); dy=float(np.median(fl[...,1][sel]))
    rows.append((( y0+y1)/2,dx,dy,n))
    print(f"{y0:>5}-{y1:<6} {dx:>7.2f} {dy:>7.2f} {n:>6}")
r=np.array(rows)
peak=r[np.argmax(np.abs(r[:,2])),2]
print(f"\npeak dy = {peak:+.2f}px at y={r[np.argmax(np.abs(r[:,2])),0]:.0f}")
print("\nnormalised vertical-motion profile (1.0 = max):")
for yy,dx,dy,n in r:
    bar='#'*int(abs(dy/peak)*40)
    print(f"   y={yy:5.0f}  {dy/peak:+.3f}  dx={dx:+5.2f}  {bar}")
np.save('flow_profile.npy', r)
