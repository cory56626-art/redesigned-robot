import cv2, numpy as np, json, librosa
J=json.load(open('render17.json')); PER=J['PER']; T0=J['T0']; DUR=J['DUR']; TE=J['T_ENTER']
cap=cv2.VideoCapture('out/gucci_morty_spidey_16s.mp4')
fs=[]
while True:
    ok,f=cap.read()
    if not ok: break
    fs.append(f)
cap.release(); print("frames:",len(fs))
tpl=fs[380][140:215,232:300]           # morty face patch, after spidey has entered
mo=[]; sp=[]
for f in fs:
    sr=f[126:229,218:314]
    r=cv2.matchTemplate(sr,tpl,cv2.TM_CCOEFF_NORMED); _,_,_,ml=cv2.minMaxLoc(r)
    mo.append(ml[1])
    b,g,rr=[f[:,:,c].astype(int) for c in range(3)]
    red=(rr>110)&(rr-g>45)&(rr-b>40); red[:,240:]=False; red[:150,:]=False
    ys,_=np.nonzero(red); sp.append(ys.min() if len(ys) else np.nan)
mo=np.array(mo,float); sp=np.array(sp,float)
seg=slice(int(TE*60)+20, 960)
m=mo[seg]; s=sp[seg]; ok=~np.isnan(s)
print(f"morty  face travel {m.max()-m.min():.0f}px   spidey head travel {np.nanmax(s)-np.nanmin(s):.0f}px")
print(f"correlation of the two head tracks after entry: r={np.corrcoef(m[ok],s[ok])[0,1]:+.3f}  (should be strongly +)")

# snaps vs kick attacks over the WHOLE 16s
y,sr_=librosa.load('song.mp3',sr=22050,mono=True,offset=T0,duration=DUR); hop=64
S=np.abs(librosa.stft(y,n_fft=2048,hop_length=hop)); f_=librosa.fft_frequencies(sr=sr_,n_fft=2048)
tt=librosa.times_like(S[0],sr=sr_,hop_length=hop)
e=np.log1p(S[f_<140].sum(0)*20); d=np.maximum(0,np.diff(e,prepend=e[0])); K=(d-d.mean())/d.std()
snaps=np.array([k*PER for k in range(200) if k*PER<DUR])
sc=lambda sh: float(np.mean(np.interp(snaps+sh,tt,K)))
best=max(((sc(ms/1000),ms) for ms in range(-200,201,4)))
print(f"\n{len(snaps)} snaps over 16s -> PEAK z={best[0]:+.3f} at {best[1]:+d} ms ; z at 0 ms = {sc(0):+.3f}")
rng=np.random.default_rng(11)
rb=np.array([float(np.mean(np.interp(np.sort(rng.uniform(0,DUR,len(snaps))),tt,K))) for _ in range(4000)])
print(f"random baseline {rb.mean():+.3f} (sd {rb.std():.3f}) -> {(sc(0)-rb.mean())/rb.std():.1f} sd above chance, p={np.mean(rb>=sc(0)):.5f}")
print(f"\nspidey enters at {TE:.4f}s (frame {int(round(TE*60))}); requested 6s, nearest kick is {TE-6.0:+.3f}s away")
