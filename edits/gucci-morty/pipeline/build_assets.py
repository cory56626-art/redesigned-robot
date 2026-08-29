import numpy as np, cv2
img = cv2.imread('frames/f001.png'); H,W = img.shape[:2]
ell = lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))
base = (cv2.imread('mask_v3.png',0)>0).astype(np.uint8)   # clean body, leg gap open, no shoes
mxc = img.max(2).astype(int); dark = mxc < 115

# --- left eye: flood its interior, clipped to the head's convex hull ---
mnc = img.min(2).astype(int); sat = mxc-mnc
free = (~dark).astype(np.uint8)
ffm = np.ones((H+2,W+2), np.uint8); ffm[1:H+1,1:W+1] = 1-free
ffm[1:143,:]=1; ffm[191:,:]=1; ffm[:,1:207]=1; ffm[:,253:]=1
tmp=np.zeros((H,W),np.uint8)
cv2.floodFill(tmp, ffm, (237,166), 255, 0,0, 4|cv2.FLOODFILL_MASK_ONLY|(255<<8))
eye = (ffm[1:H+1,1:W+1]==255)
hb=np.zeros((H,W),np.uint8); hb[100:245]=base[100:245]
cs,_=cv2.findContours(hb,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
hull=np.zeros((H,W),np.uint8)
cv2.drawContours(hull,[cv2.convexHull(max(cs,key=cv2.contourArea))],-1,1,-1)
m = (base | (eye & (hull>0))).astype(np.uint8)
m[100:245] = cv2.morphologyEx(m[100:245], cv2.MORPH_CLOSE, ell(7))
# tiny dilate on the head only, to swallow the 2px eye-rim crescent
hd=np.zeros((H,W),np.uint8); hd[100:250]=m[100:250]
m = (m | (cv2.dilate(hd, ell(5))&(np.arange(H)[:,None]<250))).astype(np.uint8)
ff=m.copy(); pad=np.zeros((H+2,W+2),np.uint8); cv2.floodFill(ff,pad,(0,0),2)
for sd in [(295,430),(293,460),(296,400)]:
    if m[sd[1],sd[0]]==0 and ff[sd[1],sd[0]]!=2: cv2.floodFill(ff,pad,sd,2)
m[(ff!=2)&(m==0)]=1
n,lab,stats,_=cv2.connectedComponentsWithStats(m,8)
m=(lab==1+np.argmax(stats[1:,cv2.CC_STAT_AREA])).astype(np.uint8)
ys,xs=np.nonzero(m); print("SPRITE mask px",m.sum(),"bbox x",xs.min(),xs.max(),"y",ys.min(),ys.max())
cv2.imwrite('mask_final.png', m*255)

# --- feathered alpha for compositing ---
alpha = cv2.GaussianBlur(m.astype(np.float32)*255, (0,0), 0.9)
cv2.imwrite('alpha_final.png', alpha.astype(np.uint8))

# --- clean background plate: inpaint the body silhouette only ---
hole = cv2.dilate(m, ell(9))                 # cover the anti-aliased rim
plate = cv2.inpaint(img, hole, 7, cv2.INPAINT_TELEA)
# second pass with NS for a slightly better structure guess, blend the two
plate2 = cv2.inpaint(img, hole, 7, cv2.INPAINT_NS)
plate = cv2.addWeighted(plate,0.5,plate2,0.5,0)
# keep true pixels everywhere outside the hole
keep = hole==0
plate[keep] = img[keep]
cv2.imwrite('plate.png', plate)
print("plate written; inpainted px:", int((hole>0).sum()))
cv2.imwrite('plate_check.png', np.hstack([img, plate]))
