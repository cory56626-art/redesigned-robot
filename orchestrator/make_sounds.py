import numpy as np, struct, subprocess, os, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
SR = 44100
OUT = "addon/SmilingMan_RP/sounds/smiling_man"
os.makedirs(OUT, exist_ok=True)

def norm(x, peak=0.95):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak

def saw(phase):  # phase already accumulated radians
    return 2.0 * (phase / (2*np.pi) % 1.0) - 1.0

def reverb(x, decay=0.3, mix=0.25):
    n = int(SR*decay)
    ir = (np.random.randn(n) * np.exp(-np.linspace(0, 6, n))).astype(np.float32)
    ir[0] = 1.0
    wet = np.convolve(x, ir)[:len(x)]
    return norm((1-mix)*x + mix*norm(wet))

def write_wav(name, x):
    x = norm(x)
    pcm = (x * 32767).astype('<i2').tobytes()
    path = f"/tmp/{name}.wav"
    with open(path, "wb") as f:
        f.write(b"RIFF"); f.write(struct.pack("<I", 36+len(pcm))); f.write(b"WAVE")
        f.write(b"fmt "); f.write(struct.pack("<IHHIIHH", 16,1,1,SR,SR*2,2,16))
        f.write(b"data"); f.write(struct.pack("<I", len(pcm))); f.write(pcm)
    return path

def to_ogg(name, x):
    wav = write_wav(name, x)
    ogg = f"{OUT}/{name}.ogg"
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "6", ogg], check=True)
    print("wrote", ogg, os.path.getsize(ogg), "bytes")

# ---------------- DEMONIC SCREAM ----------------
def scream(dur=2.7):
    t = np.linspace(0, dur, int(SR*dur), endpoint=False)
    # pitch contour: snap up, hold w/ vibrato, fall (a human scream shape)
    f0 = np.interp(t, [0, .12, .5, dur*0.7, dur], [260, 540, 480, 360, 150])
    vib = 1 + 0.04*np.sin(2*np.pi*7*t)            # vocal vibrato
    f0 = f0*vib
    ph  = np.cumsum(2*np.pi*f0/SR)
    # glottal-ish rich source + sub octave (demon weight) + detune (rasp)
    src = (saw(ph)*0.7 + saw(ph*0.5)*0.7 + saw(ph*1.007)*0.4 + saw(ph*2.0)*0.25)
    # rasp / grit
    rasp = (np.random.randn(len(t)) * (0.4 + 0.6*np.abs(np.sin(ph))))
    mix  = src + 0.5*rasp
    # heavy waveshaping -> demonic growl
    mix  = np.tanh(mix*6.0)
    # amplitude envelope: fast attack, ragged sustain, tail
    env = np.interp(t, [0, .03, .15, dur*0.75, dur], [0, 1, .9, .8, 0])
    env *= (0.8 + 0.2*np.sin(2*np.pi*11*t))        # screamy tremor
    mix *= env
    # faint octave-up shriek layer
    sh = np.tanh(saw(ph*2.0)*3)*np.interp(t,[0,.2,dur],[0,.35,0])
    out = mix*0.9 + sh*0.4
    return reverb(norm(out), decay=0.35, mix=0.22)

# ---------------- WINDOW BANG (organic thud, NOT metallic) ----------------
def bang(dur=0.32):
    t = np.linspace(0, dur, int(SR*dur), endpoint=False)
    thud = np.sin(2*np.pi*68*t) * np.exp(-t*22)
    body = np.sin(2*np.pi*130*t) * np.exp(-t*30) * 0.5
    knock = np.random.randn(len(t)) * np.exp(-t*60) * 0.7      # impact transient
    crack = (np.random.randn(len(t)) * np.exp(-t*120)) * 0.4
    out = np.tanh((thud+body+knock+crack)*1.8)
    return norm(out)

# ---------------- LOOKDOWN STING (new, unsettling) ----------------
def lookdown(dur=1.5):
    t = np.linspace(0, dur, int(SR*dur), endpoint=False)
    # dissonant low cluster swell
    cluster = (np.sin(2*np.pi*55*t)+np.sin(2*np.pi*58.2*t)+np.sin(2*np.pi*73.4*t))
    swell = np.interp(t, [0, dur*0.7, dur*0.78, dur], [0, 0.5, 1.0, 0.2])
    noise = np.random.randn(len(t)) * np.interp(t,[0,dur*0.75,dur],[0,0.3,0])
    base = (cluster*0.4 + noise) * swell
    # short shriek burst near the end (the "gotcha")
    sh = scream(0.5)
    burst = np.zeros(len(t))
    start = int(SR*0.78)
    burst[start:start+len(sh)] = sh[:len(burst)-start]
    out = np.tanh((base + burst*1.1)*2.0)
    return reverb(norm(out), decay=0.3, mix=0.2)

# ---------------- LOW DEMONIC BREATH ----------------
def breath(dur=2.0):
    t = np.linspace(0, dur, int(SR*dur), endpoint=False)
    nz = np.random.randn(len(t))
    # low-pass via cumulative smoothing
    k = 220
    nz = np.convolve(nz, np.ones(k)/k, mode='same')
    am = (np.sin(2*np.pi*(1.0/dur)*t - np.pi/2)*0.5+0.5)**2   # one slow in/out
    tone = np.sin(2*np.pi*60*t)*0.15
    out = (nz*am + tone*am)
    return norm(np.tanh(out*2.5)*0.8)

np.random.seed(13)
to_ogg("sm_scream", scream())
to_ogg("sm_bang", bang())
to_ogg("sm_lookdown", lookdown())
to_ogg("sm_breath", breath())
print("done")
