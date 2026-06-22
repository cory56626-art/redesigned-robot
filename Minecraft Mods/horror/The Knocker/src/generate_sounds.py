#!/usr/bin/env python3
"""
Original sound synthesis for The Knocker.

Every sound here is generated procedurally (a source-filter vocal model for the
scream, physical-ish models for the knock/heartbeat/etc). Nothing is sampled or
copied from any existing recording, so the scream is genuinely new and unique.

Outputs OGG/Vorbis (the format Bedrock resource packs use) into
Knocker_RP/sounds/custom/.

Requires: numpy, soundfile (libsndfile with Vorbis).
"""
import os
import numpy as np
import soundfile as sf

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "Knocker_RP", "sounds", "custom")
os.makedirs(OUT, exist_ok=True)
RNG = np.random.default_rng(20260622)  # fixed seed -> reproducible build


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def smooth_noise(n, scale):
    """Low-passed white noise (smooth random contour) of length n."""
    raw = RNG.standard_normal(n)
    k = max(1, int(scale))
    win = np.hanning(k * 2 + 1)
    win /= win.sum()
    return np.convolve(raw, win, mode="same")


def formant_shape(x, formants, hp=120.0, floor=0.04, tilt=0.0):
    """Apply a fixed magnitude response (sum of Gaussian formant peaks) via FFT."""
    N = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(N, 1.0 / SR)
    mag = np.full_like(f, floor)
    for fc, bw, g in formants:
        mag += g * np.exp(-0.5 * ((f - fc) / bw) ** 2)
    hpmask = 1.0 / (1.0 + (hp / np.maximum(f, 1.0)) ** 4)        # remove rumble
    if tilt:
        mag *= (np.maximum(f, 1.0) / 1000.0) ** tilt            # spectral tilt
    resp = mag * hpmask
    resp /= resp.max()
    return np.fft.irfft(X * resp, n=N)


def reverb(x, taps, wet=0.3):
    y = x.copy()
    for d, g in taps:
        n = int(d * SR)
        if n < len(x):
            y[n:] += g * x[: len(x) - n]
    return (1 - wet) * x + wet * y


def normit(x, peak=0.97):
    x = x - np.mean(x)
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def fades(x, fi=0.004, fo=0.02):
    n = len(x)
    ai, ao = int(fi * SR), int(fo * SR)
    if ai:
        x[:ai] *= np.linspace(0, 1, ai)
    if ao:
        x[-ao:] *= np.linspace(1, 0, ao)
    return x


def save(name, x):
    x = np.clip(x, -1.0, 1.0).astype(np.float32)
    path = os.path.join(OUT, name)
    sf.write(path, x, SR, format="OGG", subtype="VORBIS")
    print(f"  wrote {name}  ({len(x)/SR:.2f}s)")


# --------------------------------------------------------------------------- #
# THE SCREAM  — the signature sound
# --------------------------------------------------------------------------- #
def make_scream():
    dur = 2.7
    n = int(dur * SR)
    t = np.linspace(0, dur, n, endpoint=False)
    p = t / dur  # 0..1 progress

    # --- f0 contour: panic rise, wavering hold, then a breaking fall ---
    f0 = np.empty(n)
    rise = p < 0.30
    hold = (p >= 0.30) & (p < 0.68)
    fall = p >= 0.68
    f0[rise] = 250 + (640 - 250) * (p[rise] / 0.30) ** 0.7
    f0[hold] = 640 + 70 * ((p[hold] - 0.30) / 0.38)
    f0[fall] = 710 - (710 - 300) * ((p[fall] - 0.68) / 0.32) ** 1.4
    vibrato = 1.0 + 0.05 * np.sin(2 * np.pi * 6.5 * t) * np.clip((p - 0.15) * 3, 0, 1)
    jitter = 1.0 + 0.06 * smooth_noise(n, 240)        # vocal roughness
    f0 = f0 * vibrato * jitter

    # --- glottal source: detuned saws + a growling sub-harmonic ---
    def saw(freq):
        ph = np.cumsum(freq) * (2 * np.pi / SR)
        return 2.0 * np.mod(ph / (2 * np.pi), 1.0) - 1.0

    src = 0.62 * saw(f0) + 0.30 * saw(f0 * 1.006) + 0.30 * saw(f0 * 0.5)
    # chaotic rasp grows toward the climax (the voice tearing)
    rasp = smooth_noise(n, 12) * np.clip((p - 0.4) * 2.2, 0, 1) * 0.5
    src = src * (1 + rasp)

    # breath / air noise, stronger as the scream breaks apart
    breath = RNG.standard_normal(n) * (0.18 + 0.5 * np.clip(p - 0.6, 0, 1))
    voice = src + breath

    # --- vocal tract: an enraged "AAAH" with strong, piercing upper formants ---
    voice = formant_shape(
        voice,
        formants=[(720, 90, 1.0), (1180, 120, 0.9), (2650, 200, 0.85), (3700, 260, 0.6)],
        hp=130, floor=0.05, tilt=0.15,
    )

    # --- nonlinear distortion (harshness ramps up) ---
    drive = 2.5 + 4.0 * p
    voice = np.tanh(drive * voice) / np.tanh(drive)

    # --- amplitude envelope with tremor and a couple of voice "cracks" ---
    env = np.ones(n)
    atk = int(0.025 * SR)
    env[:atk] = np.linspace(0, 1, atk)
    rel = int(0.45 * SR)
    env[-rel:] *= np.linspace(1, 0.0, rel) ** 1.6
    env *= 1.0 + 0.18 * np.sin(2 * np.pi * 7.5 * t)            # tremor
    for cpos in (0.50, 0.74):                                  # brief breaks
        ci = int(cpos * n)
        w = int(0.012 * SR)
        env[ci - w:ci + w] *= np.linspace(1, 0.2, 2 * w) ** 2
    voice *= env

    # --- a final high shriek-tail layer ---
    tail = np.zeros(n)
    ts = int(0.62 * n)
    tn = n - ts
    tnoise = RNG.standard_normal(tn)
    tail[ts:] = formant_shape(tnoise, [(3200, 500, 1.0), (4800, 600, 0.7)], hp=2000)
    tail[ts:] *= np.linspace(1, 0, tn) ** 1.3 * 0.5
    voice = voice + tail

    voice = reverb(voice, [(0.017, 0.45), (0.033, 0.34), (0.058, 0.24), (0.091, 0.16)], wet=0.32)
    return fades(normit(voice, 0.98), fi=0.002, fo=0.05)


# --------------------------------------------------------------------------- #
# KNOCK  — three heavy raps on a wooden door
# --------------------------------------------------------------------------- #
def make_knock():
    gap = 0.19
    dur = gap * 3 + 0.25
    n = int(dur * SR)
    out = np.zeros(n)
    for i in range(3):
        start = int((0.04 + i * gap) * SR)
        ln = int(0.16 * SR)
        seg = np.zeros(ln)
        tt = np.linspace(0, 0.16, ln, endpoint=False)
        # low wooden body (resonant, fast decay)
        body = (np.sin(2 * np.pi * 150 * tt) + 0.6 * np.sin(2 * np.pi * 95 * tt)) * np.exp(-tt * 38)
        # the sharp contact transient
        knock = RNG.standard_normal(ln) * np.exp(-tt * 120)
        knock = formant_shape(knock, [(900, 400, 1.0), (1900, 700, 0.6)], hp=200)
        seg = 0.7 * body + 0.9 * knock
        out[start:start + ln] += seg
    out = reverb(out, [(0.021, 0.3), (0.043, 0.2), (0.07, 0.12)], wet=0.25)
    return fades(normit(out, 0.95))


# --------------------------------------------------------------------------- #
# HEARTBEAT  — a loopable lub-dub
# --------------------------------------------------------------------------- #
def make_heartbeat():
    dur = 1.05
    n = int(dur * SR)
    out = np.zeros(n)

    def thump(at, freq, amp, dec):
        s = int(at * SR)
        ln = int(0.28 * SR)
        tt = np.linspace(0, 0.28, ln, endpoint=False)
        sweep = freq * np.exp(-tt * 6) + 28
        ph = np.cumsum(sweep) * (2 * np.pi / SR)
        beat = np.sin(ph) * np.exp(-tt * dec) * amp
        e = min(s + ln, n)
        out[s:e] += beat[: e - s]

    thump(0.04, 78, 0.95, 26)    # lub
    thump(0.22, 64, 0.7, 30)     # dub
    return fades(normit(out, 0.9), fi=0.005, fo=0.05)


# --------------------------------------------------------------------------- #
# AMBIENT  — a low, dread drone (wordless)
# --------------------------------------------------------------------------- #
def make_ambient():
    dur = 6.0
    n = int(dur * SR)
    t = np.linspace(0, dur, n, endpoint=False)
    drone = (
        0.5 * np.sin(2 * np.pi * 42 * t)
        + 0.35 * np.sin(2 * np.pi * 63.3 * t)
        + 0.25 * np.sin(2 * np.pi * 88.0 * t + 0.4 * np.sin(2 * np.pi * 0.2 * t))
    )
    drone *= 1.0 + 0.25 * np.sin(2 * np.pi * 0.13 * t)        # slow swell
    wind = formant_shape(RNG.standard_normal(n), [(300, 250, 1.0), (650, 400, 0.5)], hp=120) * 0.25
    wind *= 0.6 + 0.4 * smooth_noise(n, 4000)
    groan = np.sin(2 * np.pi * (70 + 18 * smooth_noise(n, 9000)) * t) * 0.12
    out = drone * 0.5 + wind + groan
    return fades(normit(out, 0.82), fi=0.4, fo=0.6)


# --------------------------------------------------------------------------- #
# WHISPER  — breathy, unvoiced (no words)
# --------------------------------------------------------------------------- #
def make_whisper():
    dur = 1.7
    n = int(dur * SR)
    air = RNG.standard_normal(n)
    # slowly moving band emphasis suggests breath/voice without intelligible words
    out = formant_shape(air, [(1100, 350, 1.0), (2200, 500, 0.7), (3200, 600, 0.4)], hp=400)
    env = (0.5 + 0.5 * np.sin(2 * np.pi * 1.7 * np.linspace(0, 1, n))) * (0.4 + 0.6 * smooth_noise(n, 1500))
    out *= env
    return fades(normit(out, 0.7), fi=0.05, fo=0.1)


# --------------------------------------------------------------------------- #
# BREAK  — a wood/stone crack for block destruction
# --------------------------------------------------------------------------- #
def make_break():
    dur = 0.45
    n = int(dur * SR)
    tt = np.linspace(0, dur, n, endpoint=False)
    crack = RNG.standard_normal(n) * np.exp(-tt * 26)
    crack = formant_shape(crack, [(700, 500, 1.0), (1600, 800, 0.7), (3000, 900, 0.4)], hp=250)
    snap = (np.sin(2 * np.pi * 180 * tt) + 0.5 * np.sin(2 * np.pi * 120 * tt)) * np.exp(-tt * 40) * 0.6
    debris = RNG.standard_normal(n) * np.exp(-tt * 9) * 0.15
    out = crack + snap + debris
    return fades(normit(out, 0.92))


if __name__ == "__main__":
    print("Synthesising The Knocker's sounds:")
    save("knocker_scream.ogg", make_scream())
    save("knocker_knock.ogg", make_knock())
    save("knocker_heartbeat.ogg", make_heartbeat())
    save("knocker_ambient.ogg", make_ambient())
    save("knocker_whisper.ogg", make_whisper())
    save("knocker_break.ogg", make_break())
    print("Done.")
