import numpy as np, cv2
img=cv2.imread('spidey.png'); m=(cv2.imread('sp_mask0.png',0)>0).astype(np.uint8)
ell=lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))
m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,ell(3))
# erode 1px then feather: kills the thin light halo picked up from the sky
a=cv2.GaussianBlur((cv2.erode(m,ell(3))*255).astype(np.float32),(0,0),0.8)
ys,xs=np.nonzero(m); x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max()
rgb=img[y0:y1+1,x0:x1+1]; al=a[y0:y1+1,x0:x1+1]
print("sprite bbox",rgb.shape, "aspect w/h", rgb.shape[1]/rgb.shape[0])
np.save('sp_rgb.npy',rgb); np.save('sp_a.npy',al)
cv2.imwrite('sp_rgb.png',rgb); cv2.imwrite('sp_a.png',al.astype(np.uint8))

# static placement test on the classroom frame
base=cv2.imread('frames/f001.png').astype(np.float32)
H,W=base.shape[:2]
def place(bs,h_target,cx,base_y):
    w=int(round(rgb.shape[1]*h_target/rgb.shape[0]))
    r=cv2.resize(rgb,(w,h_target),interpolation=cv2.INTER_AREA).astype(np.float32)
    aa=cv2.resize(al,(w,h_target),interpolation=cv2.INTER_AREA)[...,None]/255.0
    x=int(round(cx-w/2)); y=int(round(base_y-h_target))
    out=bs.copy()
    xs0,xs1=max(0,x),min(W,x+w); ys0,ys1=max(0,y),min(H,y+h_target)
    sx0,sy0=xs0-x,ys0-y
    sl_a=aa[sy0:sy0+ys1-ys0, sx0:sx0+xs1-xs0]
    sl_r=r [sy0:sy0+ys1-ys0, sx0:sx0+xs1-xs0]
    out[ys0:ys1,xs0:xs1]=out[ys0:ys1,xs0:xs1]*(1-sl_a)+sl_r*sl_a
    return out,w
tests=[]
for h,cx,by in ((250,108,506),(275,112,510),(300,118,512)):
    o,w=place(base,h,cx,by); tests.append(o); print(f"h={h} w={w} cx={cx} base_y={by}")
cv2.imwrite('sp_place.png', np.hstack([np.clip(t,0,255).astype(np.uint8) for t in tests]))
