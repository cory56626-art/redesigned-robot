import numpy as np, cv2
# Smooth Laplace (membrane) fill via a pyramid — far better than TELEA on the
# smooth ceiling/wall above Morty's head, which is where reveals are visible.
img = cv2.imread('frames/f001.png').astype(np.float32)
m   = (cv2.imread('mask_final.png',0)>0).astype(np.uint8)
ell = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))
hole = cv2.dilate(m, ell(9))

def laplace_fill(im, hole, levels=6, iters=140):
    pyr_i=[im]; pyr_h=[hole.astype(np.float32)]
    for _ in range(levels):
        pyr_i.append(cv2.pyrDown(pyr_i[-1]))
        pyr_h.append(cv2.pyrDown(pyr_h[-1]))
    cur=None
    for lv in range(levels,-1,-1):
        I=pyr_i[lv].copy(); Hm=(pyr_h[lv]>0.02)
        if cur is None:
            fillv=I[~Hm].mean(0) if (~Hm).any() else np.zeros(3,np.float32)
            cur=np.where(Hm[...,None], fillv, I)
        else:
            cur=cv2.resize(cur,(I.shape[1],I.shape[0]),interpolation=cv2.INTER_LINEAR)
            cur=np.where(Hm[...,None], cur, I)
        for _ in range(iters):
            sm=cv2.blur(cur,(3,3))
            cur=np.where(Hm[...,None], sm, I)
    return cur

lap = laplace_fill(img, hole)
tel = cv2.imread('plate.png').astype(np.float32)
# smooth membrane up top (ceiling/wall), TELEA's structure lower down (desks)
yy=np.mgrid[0:img.shape[0],0:img.shape[1]][0].astype(np.float32)
w=np.clip((yy-235.0)/95.0,0,1)[...,None]
plate=lap*(1-w)+tel*w
keep=hole==0; plate[keep]=img[keep]
cv2.imwrite('plate_v2.png', plate.astype(np.uint8))
cv2.imwrite('plate_cmp.png', np.hstack([cv2.imread('plate.png'), plate.astype(np.uint8)])[80:300,:])
print("plate_v2 written")
