import numpy as np, json, os, shutil
J=json.load(open('clip_grid.json')); BEAT=J['period']; T0=J['T0']
FPS, DUR = 60, 8.0
N=int(DUR*FPS); NSRC=29
os.path.exists('loop') and shutil.rmtree('loop'); os.makedirs('loop')
# Play the ORIGINAL 29 frames at native 60fps starting on each kick, then hold the
# last frame (already at rest) until the next kick. The 29->1 snap lands on the beat.
counts={}
for i in range(N):
    t=i/FPS
    tau=t-np.floor(t/BEAT)*BEAT
    src=min(int(round(tau*FPS)), NSRC-1)
    counts[src]=counts.get(src,0)+1
    os.symlink(os.path.abspath(f'frames/f{src+1:03d}.png'), f'loop/l{i:04d}.png')
print(f"{N} frames, {DUR/BEAT:.2f} bob cycles @ {60/BEAT:.2f} BPM")
print(f"cycle = {BEAT*FPS:.1f} frames: 29 animated + {BEAT*FPS-29:.1f} held on the settled frame")
print("held frame 29 appears", counts[28], "times total;", "other frames appear",
      sorted({v for k,v in counts.items() if k!=28}), "times each")
