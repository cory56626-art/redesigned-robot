import numpy as np, cv2, glob
fs=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
def charmask(f):
    b,g,r=[f[:,:,c].astype(int) for c in range(3)]
    mx=f.max(2).astype(int); mn=f.min(2).astype(int)
    skin=(r>200)&(g>160)&(g<225)&(b>130)&(b<200)&(r-b>40)&(r-b<95)
    hair=(r>60)&(r<160)&(r-b>10)&(mx<170)
    shirt=(mx<75)
    jeans=(b>130)&(b-r>45)&(g>80)&(g<190)
    shoe=(mn>150)&((mx-mn)<45)
    m=np.zeros(f.shape[:2],bool)
    m|=skin; m|=jeans
    m[220:360]|=shirt[220:360]; m[100:240]|=hair[100:240]; m[478:]|=shoe[478:]
    m[:, :205]=False; m[:,365:]=False; m[:100]=False
    return m
m0=charmask(fs[0]); m1=charmask(fs[-1])
print("per-row horizontal centroid shift, frame1 -> frame29")
print(f"{'row':>5} {'cx_f1':>8} {'cx_f29':>8} {'dx':>7} {'n1':>5}")
rows=[]
for y in range(110,510,15):
    a=np.nonzero(m0[y:y+15].any(0)==False)  # placeholder
    xa=np.nonzero(m0[y:y+15])[1]; xb=np.nonzero(m1[y:y+15])[1]
    if len(xa)<40 or len(xb)<40: continue
    ca,cb=xa.mean(),xb.mean()
    rows.append((y+7,ca,cb,cb-ca,len(xa)))
    print(f"{y+7:>5} {ca:>8.2f} {cb:>8.2f} {cb-ca:>7.2f} {len(xa):>5}")
r=np.array(rows)
np.save('rowdx.npy', r)
print("\ndx by region:")
for lo,hi,nm in ((110,225,'HEAD'),(225,300,'torso/shoulders'),(300,380,'hips'),(380,470,'legs'),(470,510,'feet')):
    s=r[(r[:,0]>=lo)&(r[:,0]<hi)]
    if len(s): print(f"  {nm:<18} y{lo}-{hi}: mean dx {s[:,3].mean():+6.2f}")
