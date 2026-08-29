import numpy as np, librosa, json
T0=11.8841; DUR=16.0
y,sr=librosa.load('song.mp3',sr=22050,mono=True); hop=64
S=np.abs(librosa.stft(y,n_fft=2048,hop_length=hop)); f=librosa.fft_frequencies(sr=sr,n_fft=2048)
tt=librosa.times_like(S[0],sr=sr,hop_length=hop)
e=np.log1p(S[f<140].sum(0)*20); d=np.maximum(0,np.diff(e,prepend=e[0])); K=(d-d.mean())/d.std()
np.save('K_kick.npy',K); np.save('K_t.npy',tt)

def fit(t0,t1):
    best=None
    for per in np.arange(0.5600,0.5760,0.00002):
        for ph in np.linspace(0,per,700,endpoint=False):
            g=np.arange(np.ceil((t0-ph)/per),(t1-ph)/per)*per+ph
            s=float(np.mean(np.interp(g,tt,K)))
            if best is None or s>best[0]: best=(s,per,ph)
    return best
s,PER,PH=fit(T0-1.0, T0+DUR+1.0)
print(f"rigid grid over the 16s window: period={PER:.5f}s ({60/PER:.2f} BPM) phase={PH:.4f}  z={s:+.3f}")
s8,_,_=fit(T0-1.0,T0+9.0); print(f"  (first 8s alone would fit z={s8:+.3f})")

# per-beat error against the nearest real kick attack
beats=np.array([PH+k*PER for k in range(2000)]); beats=beats[(beats>=T0)&(beats<T0+DUR)]
pk=librosa.util.peak_pick(K,pre_max=10,post_max=10,pre_avg=24,post_avg=24,delta=0.6,wait=12)
kt=tt[pk]
err=np.array([kt[np.argmin(np.abs(kt-b))]-b for b in beats])*1000
print(f"\n{len(beats)} beats in window; rigid-grid error vs nearest kick attack:")
print("  ms:", np.round(err,0).astype(int).tolist())
print(f"  mean {err.mean():+.1f} ms, |err| max {np.abs(err).max():.0f} ms, "
      f">25ms off: {(np.abs(err)>25).sum()}/{len(err)}")
json.dump({'period':PER,'phase':PH,'T0':T0,'DUR':DUR},open('grid16.json','w'))
