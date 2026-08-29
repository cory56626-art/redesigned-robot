import numpy as np, librosa, json
y,sr=librosa.load('song.mp3',sr=22050,mono=True); hop=64
S=np.abs(librosa.stft(y,n_fft=2048,hop_length=hop))
f=librosa.fft_frequencies(sr=sr,n_fft=2048); tt=librosa.times_like(S[0],sr=sr,hop_length=hop)
def flux(lo,hi):
    e=np.log1p(S[(f>=lo)&(f<hi)].sum(0)*20); d=np.maximum(0,np.diff(e,prepend=e[0]))
    return (d-d.mean())/d.std()
KICK=flux(20,140); CLAP=flux(200,2200)
FIT0,FIT1 = 10.0, 22.5                      # local span around the intended clip

def fit(feat,t0,t1):
    best=None
    for per in np.arange(0.5600,0.5740,0.00002):
        for ph in np.linspace(0,per,700,endpoint=False):
            g=np.arange(np.ceil((t0-ph)/per),(t1-ph)/per)*per+ph
            s=float(np.mean(np.interp(g,tt,feat)))
            if best is None or s>best[0]: best=(s,per,ph)
    s,per,ph=best
    b2=None
    for p2 in np.linspace(0,per,6000,endpoint=False):
        g=np.arange(np.ceil((t0-p2)/per),(t1-p2)/per)*per+p2
        v=float(np.mean(np.interp(g,tt,feat)))
        if b2 is None or v>b2[0]: b2=(v,p2)
    return b2[0],per,b2[1]

zK,PER,PHK = fit(KICK,FIT0,FIT1)
print(f"LOCAL kick grid : period={PER:.5f}s ({60/PER:.2f} BPM)  phase={PHK:.4f}s  z={zK:+.3f}")
zC=None
best=None
for ph in np.linspace(0,PER,6000,endpoint=False):
    g=np.arange(np.ceil((FIT0-ph)/PER),(FIT1-ph)/PER)*PER+ph
    v=float(np.mean(np.interp(g,tt,CLAP)))
    if best is None or v>best[0]: best=(v,ph)
zC,PHC=best
print(f"LOCAL clap grid : phase={PHC:.4f}s  z={zC:+.3f}   (clap {((PHC-PHK)%PER)*1000:.0f} ms after kick)")

T0=min([PHK+k*PER for k in range(0,60) if 10.5<PHK+k*PER<13.5], key=lambda c:abs(c-11.94))
print(f"\nT0={T0:.4f}s")
print("kick phase sweep at the clip (z):")
for off in np.arange(-0.12,0.121,0.02):
    g=np.array([T0+off+k*PER for k in range(14)])
    print(f"   {off*1000:+6.0f} ms  z={np.mean(np.interp(g,tt,KICK)):+.3f}")
json.dump({'period':PER,'kick_phase':PHK,'clap_off':float((PHC-PHK)%PER),'T0':T0},open('clip_grid.json','w'))
