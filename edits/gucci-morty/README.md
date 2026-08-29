# Gucci Morty — 8s beat-synced edit

`gucci_morty_8s.mp4` — 8.000s, 60fps, 480x518, H.264 + AAC.

The original 29-frame animation is used **exactly as authored** — no warping,
resampling or frame blending. The only edit is *when* each frame is shown.

## What the source animation actually does

The source is 0.483s (29 frames @ 60fps) over a completely static background, so
Morty is a cutout layer over a still. Template-tracking real features across the
29 frames (`track.py`) gives the motion unambiguously:

| tracked patch      | vertical travel |
|--------------------|-----------------|
| face (eyes + nose) | **-14 px**      |
| GUCCI logo (torso) | -4 px           |
| hands              | ~0 px           |
| shoes              | 0 px            |
| background desk    | 0 px (control)  |

Head moves most, torso follows slightly, hands and feet planted — a head bob.
The head eases upward and decelerates to rest by frame ~17 (frame 28->29 differs
by only 0.04/255), then the loop point snaps it back down (frame 29->1 differs by
9.37/255, ~9x a normal inter-frame step).

**So the bob is: hard snap DOWN, ease back up, settle.** The snap is the accent —
that is what has to land on the beat.

## Timing

The track is **105.53 BPM**, kick on every beat, clap on the offbeat eighth
(~295ms later). Two things needed care:

1. A global beat-tracker returns 107.67 BPM, but the low-band onsets sit on a
   0.284s pulse — the eighth, not the beat. Kick attacks (20-140 Hz flux) land on
   even eighths; clap/hat attacks (200-2200 Hz) land on odd ones.
2. The groove has real jitter, so a grid fitted across the whole track is a poor
   *local* fit — locally-fitted phases score z≈+4.1 against kick attacks versus
   z≈+2.2 for the best global grid, and the global grid was ~40ms off over the
   window used here. The grid is fitted to the clip's own span (`localfit.py`).

Window: 11.8841s -> 19.8841s, starting on a kick.

## How it is assembled

One bob per beat. A beat is 0.5685s = 34.1 frames at 60fps; the source animation
is 29 frames. `restore.py` plays frames 1..29 at native speed starting on each
kick, then **holds frame 29** for the remaining ~5 frames until the next kick,
where it snaps back to frame 1.

Holding is invisible because frame 29 is already at rest, and it means the
animation itself is never stretched or resampled — every frame the source
contains is shown at its authored duration.

## Verification

`restore.py`'s companion check samples kick-attack strength at the snap instants
and sweeps the offset. It peaks at **+0ms, z=+4.62, 17.9 sd above a
random-placement baseline** (p<0.00001), falling to +0.08 by 40ms.

Two earlier checks were misleading and are worth not repeating: nearest-transient
matching looks good for any timing, because the low band has ~183 transients in
8s; and ranking "strongest kicks" is meaningless here, since their magnitudes are
near-identical (p50 0.0996 vs p99 0.133) and the top ones cluster in a bass roll.

## Rebuilding

Needs `ffmpeg`, `numpy`, `opencv-python-headless`, `librosa`, plus `morty.mp4`
and `song.mp3`:

    ffmpeg -i morty.mp4 -vsync 0 frames/f%03d.png
    python3 localfit.py            # fit the kick grid to the clip window
    python3 restore.py             # build the beat-locked frame sequence
    ffmpeg -y -ss 11.8841 -t 8.05 -i song.mp3 \
      -af "afade=t=in:st=0:d=0.03,afade=t=out:st=7.9:d=0.1,apad" -t 8.0 \
      -ar 44100 -ac 2 -c:a aac -b:a 192k final_audio.m4a
    ffmpeg -y -framerate 60 -i loop/l%04d.png -i final_audio.m4a -frames:v 480 \
      -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart \
      -c:a copy gucci_morty_8s.mp4

`track.py` reproduces the motion measurements above.

## Note

An earlier version replaced the source motion with a procedurally generated bob
(matte + inpainted plate + feet-anchored mesh warp). It removed the snap, which
is the whole character of the original bob, and was rejected. It remains in git
history at commit `1ada5a3` if any of that machinery is ever wanted.
