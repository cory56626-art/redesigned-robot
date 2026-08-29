import numpy as np, librosa, json
J=json.load(open('clip_grid.json')); T0=J['T0']; DUR=8.0
y,sr=librosa.load('song.mp3',sr=22050,mono=True,offset=T0,duration=DUR); hop=64
S=np.abs(librosa.stft(y,n_fft=2048,hop_length=hop))
f=librosa.fft_frequencies(sr=sr,n_fft=2048); tt=librosa.times_like(S[0],sr=sr,hop_length=hop)
def flux(lo,hi):
    e=np.log1p(S[(f>=lo)&(f<hi)].sum(0)*20); d=np.maximum(0,np.diff(e,prepend=e[0]))
    return (d-d.mean())/d.std()
KICK=flux(20,140)

sig=json.load(open('bobsig5.json')); st=np.array([s[0] for s in sig]); sd=np.array([s[1] for s in sig])
imp=np.array([st[i] for i in range(1,len(sd)-1) if sd[i]>=sd[i-1] and sd[i]>sd[i+1] and sd[i]>-6])
sc=lambda sh: float(np.mean(np.interp(imp+sh,tt,KICK)))
print(f"{len(imp)} strong bob impacts (expect {DUR/J['period']:.1f} at {60/J['period']:.1f} BPM)")
print("\nkick-attack strength sampled AT the bob impacts:")
best=(-9,0)
for ms in range(-200,201,4):
    s=sc(ms/1000)
    if s>best[0]: best=(s,ms)
for ms in range(-160,161,40): print(f"   shift {ms:>5} ms  z={sc(ms/1000):+.3f}")
print(f"\nPEAK z={best[0]:+.3f} at {best[1]:+d} ms      z at 0 ms = {sc(0):+.3f}")
rng=np.random.default_rng(7)
rb=np.array([float(np.mean(np.interp(np.sort(rng.uniform(0,DUR,len(imp))),tt,KICK))) for _ in range(4000)])
print(f"random baseline z={rb.mean():+.3f} (sd {rb.std():.3f})")
print(f"=> impacts sit {(sc(0)-rb.mean())/rb.std():.1f} sd above chance, p={np.mean(rb>=sc(0)):.5f}")
