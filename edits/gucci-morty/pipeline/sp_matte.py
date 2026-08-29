import numpy as np, cv2
img=cv2.imread('spidey.png'); H,W=img.shape[:2]
mask=np.zeros((H,W),np.uint8)
rect=(70,25,420,470)
bgd=np.zeros((1,65),np.float64); fgd=np.zeros((1,65),np.float64)
cv2.grabCut(img,mask,rect,bgd,fgd,10,cv2.GC_INIT_WITH_RECT)
m=np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD),1,0).astype(np.uint8)
n,lab,stats,_=cv2.connectedComponentsWithStats(m,8)
if n>1:
    m=(lab==1+np.argmax(stats[1:,cv2.CC_STAT_AREA])).astype(np.uint8)
print("grabcut fg px:",int(m.sum()))
ys,xs=np.nonzero(m); print("bbox x",xs.min(),xs.max(),"y",ys.min(),ys.max())
cv2.imwrite('sp_mask0.png',m*255)
ov=img.copy(); s=m>0; ov[s]=(0.45*ov[s]+0.55*np.array([0,255,0])).astype(np.uint8)
cv2.imwrite('sp_check0.png',np.hstack([img,ov]))
