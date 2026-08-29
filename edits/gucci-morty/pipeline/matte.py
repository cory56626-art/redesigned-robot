import numpy as np, cv2
img = cv2.imread('frames/f001.png')
H,W = img.shape[:2]
print("img", img.shape)

# GrabCut init: rect around Morty (from earlier analysis he spans ~x205-365, y100-510)
mask = np.zeros((H,W), np.uint8)
rect = (196, 96, 178, 418)   # x,y,w,h
bgd = np.zeros((1,65), np.float64); fgd = np.zeros((1,65), np.float64)
cv2.grabCut(img, mask, rect, bgd, fgd, 8, cv2.GC_INIT_WITH_RECT)
m = np.where((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
print("grabcut fg px:", (m>0).sum())

# keep largest connected component
n, lab, stats, cent = cv2.connectedComponentsWithStats((m>0).astype(np.uint8), 8)
if n>1:
    big = 1+np.argmax(stats[1:, cv2.CC_STAT_AREA])
    m = np.where(lab==big, 255, 0).astype(np.uint8)
    print("largest cc px:", (m>0).sum(), "bbox", stats[big][:4])
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5,5),np.uint8))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
cv2.imwrite('mask_gc.png', m)

# visualize overlay
ov = img.copy()
ov[m>0] = (0.45*ov[m>0] + 0.55*np.array([0,0,255])).astype(np.uint8)
cv2.imwrite('overlay_gc.png', ov)
ys,xs = np.nonzero(m)
print("mask bbox x", xs.min(), xs.max(), "y", ys.min(), ys.max())
