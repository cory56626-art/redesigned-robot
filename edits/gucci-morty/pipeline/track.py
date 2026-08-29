import numpy as np, cv2, glob
files=sorted(glob.glob('frames/f*.png'))
f0=cv2.imread(files[0])
# distinctive patches on frame 1
patches={'face(eyes+nose)':(232,300,140,215),'GUCCI logo':(255,320,225,300),
         'left hand':(238,268,330,375),'right hand':(330,360,325,372),
         'left shoe':(255,300,485,515),'bg desk (control)':(60,140,300,360)}
print(f"{'patch':<18} {'dx':>6} {'dy':>6}   per-frame dy trajectory")
res={}
for name,(x0,x1,y0,y1) in patches.items():
    tpl=f0[y0:y1,x0:x1]
    traj=[]
    for fp in files:
        im=cv2.imread(fp)
        pad=14
        sr=im[max(0,y0-pad):y1+pad, max(0,x0-pad):x1+pad]
        r=cv2.matchTemplate(sr,tpl,cv2.TM_CCOEFF_NORMED)
        _,_,_,ml=cv2.minMaxLoc(r)
        traj.append((ml[0]-pad, ml[1]-pad))
    traj=np.array(traj); res[name]=traj
    dy=traj[:,1]
    print(f"{name:<18} {traj[-1,0]-traj[0,0]:>6} {traj[-1,1]-traj[0,1]:>6}   {dy.tolist()}")
np.save('track.npy', np.array([res[k] for k in patches]))
