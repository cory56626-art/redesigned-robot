import numpy as np, cv2, json, subprocess, glob
J=json.load(open('grid16.json')); PER=J['period']; PH=J['phase']
FPS, DUR = 60, 16.0
T0 = PH + round((11.8841-PH)/PER)*PER
N  = int(DUR*FPS)
frames=[cv2.imread(p) for p in sorted(glob.glob('frames/f*.png'))]
H,W=frames[0].shape[:2]; NSRC=len(frames)
# Morty only: his original 29 frames at native speed from each kick, holding the
# settled last frame until the next kick, where it snaps back to frame 1.
p=subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{W}x{H}',
    '-r','60','-i','pipe:0','-an','-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p',
    '-profile:v','high','video18.mp4'],stdin=subprocess.PIPE)
for i in range(N):
    t=i/FPS
    tau=t-np.floor(t/PER)*PER
    src=min(int(round(tau*FPS)),NSRC-1)
    p.stdin.write(frames[src].tobytes())
p.stdin.close(); p.wait()
print(f"{N} frames, {DUR/PER:.2f} bob cycles @ {60/PER:.2f} BPM, T0={T0:.4f}s")
