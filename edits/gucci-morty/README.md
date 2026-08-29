# Gucci Morty — 8s beat-synced edit

`gucci_morty_8s.mp4` — 8.000s, 60fps, 480x518, H.264 + AAC.

## What the source was

The original clip was **0.483s** (29 frames @ 60fps). Measuring it frame by frame,
the character's motion was a monotonic drift — the skin centroid slid from
(307, 269) to (316, 276) over the whole clip, with no oscillation. There were no
headbobs to sync; they had to be built. The classroom background is completely
static (mean frame-to-frame difference outside x 220-360 is ~1.3/765, i.e. codec
noise), so Morty is a cutout layer over a still.

## Timing

The track is **105.53 BPM** with the kick on every beat and the clap on the
offbeat eighth, ~295ms later.

Tempo estimation needed care in two places:

1. A global beat-tracker returns 107.67 BPM, but the low-band onsets sit on a
   0.284s pulse — the eighth, not the beat. Kick attacks (20-140 Hz flux) land on
   even eighths; clap/hat attacks (200-2200 Hz) land on odd ones.
2. The groove has real jitter, so a grid fitted across the whole track is a poor
   *local* fit — locally-fitted phases score z≈+4.1 against kick attacks versus
   z≈+2.2 for the best global grid, and the global grid was ~40ms off over the
   window used here. The grid is therefore fitted to the clip's own span
   (`localfit.py`), not to the whole song.

The window is 11.8841s -> 19.8841s, starting on a kick.

## Animation

Morty **floats up between hits and slams down onto the kick**, with a small
accent on the clap. The impact pose is the original frame, so he only ever
stretches above his source silhouette and almost no background is ever revealed.
Motion is a feet-anchored mesh warp weighted by height (`u^1.5`), so the feet stay
planted and the head travels most — a nod, not a rigid slide. Head displacement
runs -17.9px (lifted) to +3.0px (impact overshoot, which drives the squash).

Also applied: squash-and-stretch on the horizontal axis, a 16ms head lag for
secondary motion, a slow sway and tilt, and a beat-synced zoom punch.

## Compositing

Morty is matted out and the background is repaired only where needed. Compositing
is `original -> plate where the old pose is uncovered -> warped sprite on top`, so
real pixels survive everywhere the new pose still covers the old one — the gap
between the legs keeps its actual desk and floor rather than inpaint.

Matte notes: GrabCut drops the white eyes, the GUCCI logo and the sneakers, and
Morty's left eye bulges *outside* the head outline and leaks to the background
through a break in the linework. It's recovered with an outline-bounded flood fill
clipped to the head's convex hull. Morphology is region-dependent so the gap
between the legs stays open. Below y=430 the frame crossfades back to the
untouched original, where motion is ~0 anyway.

The background plate uses a pyramid Laplace (membrane) fill up top, where the
smooth ceiling is what a reveal would expose, and blends to TELEA lower down.

## Verification

`finalqa5.py` samples kick-attack strength at the bob impact instants and sweeps
the offset. The final render peaks at **+0ms**, z=+3.87, **14.4 sd above a
random-placement baseline** (p<0.00001), falling to +0.13 by 40ms.

Two earlier checks were misleading and are worth not repeating: nearest-transient
matching looks good for any timing, because the low band has ~183 transients in
8s; and ranking "strongest kicks" is meaningless here, since their magnitudes are
near-identical (p50 0.0996 vs p99 0.133) and the top ones cluster in a bass roll.

## Rebuilding

Needs `ffmpeg`, `numpy`, `opencv-python-headless`, `librosa`, and the two source
files. From a directory holding `morty.mp4` and `song.mp3`:

    ffmpeg -i morty.mp4 -vsync 0 frames/f%03d.png
    python3 matte.py && python3 build_assets.py && python3 plate2.py
    python3 localfit.py && python3 render5.py && python3 finalqa5.py

`assets/` holds the derived matte, alpha, plate and fitted grid so a re-render
doesn't need the segmentation steps.
