import numpy as np, cv2, glob
ell=lambda k: cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(k,k))
MORTY_DY=np.array([0,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-10,-11,-12,-13,-13,-14,-14,
                   -14,-14,-14,-14,-14,-14,-14,-14,-14,-14,-14],float)
CURVE=-MORTY_DY/14.0
m1=(cv2.imread('mask_final.png',0)>0).astype(np.float32)
plate=cv2.imread('plate_v2.png').astype(np.int16)
H,W=m1.shape
# Morty's measured deformation, frame 1 -> 29, as a per-row displacement
YS=[109,225,245,280,330,400,470,517]
DXS=[ 14, 14,  -1,  -3,  -6, -10,  -9,  -7]
DYS=[-14,-14,  -4,  -2,   0,   0,   0,   0]
rows=np.arange(H,dtype=np.float32)
DXr=np.interp(rows,YS,DXS).astype(np.float32)
DYr=np.interp(rows,YS,DYS).astype(np.float32)
yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
region0=cv2.dilate((m1>0).astype(np.uint8),ell(41))>0
files=sorted(glob.glob('frames/f*.png'))
mats=[]
for i,fp in enumerate(files):
    c=CURVE[i]
    mx=np.ascontiguousarray(xx-(DXr*c)[:,None],np.float32)
    my=np.ascontiguousarray(yy-(DYr*c)[:,None],np.float32)
    prior=cv2.remap(m1,mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
    pri=cv2.dilate((prior>0.4).astype(np.uint8),ell(9))>0
    f=cv2.imread(fp).astype(np.int16)
    D=np.abs(f-plate).max(2).astype(np.uint8)
    b=(((D>34)&region0)|(prior>0.6)).astype(np.uint8)   # literal silhouette, union the prior core
    b=(b&pri.astype(np.uint8))                          # prior kills the inpaint-edge spurs
    b=cv2.morphologyEx(b,cv2.MORPH_CLOSE,ell(5))
    n,lab,st,_=cv2.connectedComponentsWithStats(b,8)
    if n>1: b=(lab==1+np.argmax(st[1:,cv2.CC_STAT_AREA])).astype(np.uint8)
    ff=b.copy(); pad=np.zeros((H+2,W+2),np.uint8); cv2.floodFill(ff,pad,(0,0),2)
    for sx,sy in [(295-10*c,430),(293-10*c,460),(296-10*c,400)]:
        sx=int(round(sx))
        if b[sy,sx]==0 and ff[sy,sx]!=2: cv2.floodFill(ff,pad,(sx,sy),2)
    b[(ff!=2)&(b==0)]=1
    b=cv2.morphologyEx(b,cv2.MORPH_OPEN,ell(3))
    mats.append(b)
mats=np.array(mats,np.uint8); np.save('mattes.npy',mats)
a=np.array([int(m.sum()) for m in mats])
print("matte area per frame:", a[::4].tolist())
print(f"area spread across frames: {(a.max()-a.min())/a.mean()*100:.1f}%  (GrabCut-per-frame was 38.3%)")
print("frame1 vs hand-built mask_final IoU:", round(float(((mats[0]>0)&(m1>0)).sum()/((mats[0]>0)|(m1>0)).sum()),4))
for i in (0,14,28):
    ys,xs=np.nonzero(mats[i]); c=CURVE[i]
    print(f"  frame {i+1:>2}: bbox x{xs.min()}-{xs.max()} y{ys.min()}-{ys.max()}  leggap open: {not bool(mats[i][430,int(round(295-10*c))])}")
ov=cv2.imread('frames/f029.png').copy(); s=mats[28]>0
ov[s]=(0.45*ov[s]+0.55*np.array([0,0,255])).astype(np.uint8)
cv2.imwrite('permatte4_check.png', np.hstack([cv2.imread('frames/f029.png'),ov]))
