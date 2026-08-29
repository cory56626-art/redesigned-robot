# Gucci Morty — 16s beat-synced edit

`gucci_morty_spidey_16s.mp4` — 16.000s, 60fps, 480x518, H.264 + AAC.

Morty's original 29-frame animation is used **exactly as authored** — no warping,
resampling or frame blending. The only edit is *when* each frame is shown.
Spider-Man is cut out of a rooftop photo and drops in at 6.25s, bobbing on the
same beats.

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

Window: 11.8860s -> 27.8860s, starting on a kick. Over the 16s span a single
rigid grid (0.56824s, 105.59 BPM) puts 27 of 29 beats within 7ms of a real kick
attack, so no per-beat snapping is needed — and snapping would have *hurt*, since
the two outliers are beats where the kick is displaced or absent rather than where
the grid is wrong.

## How it is assembled

One bob per beat, 29 bobs across the 16s. A beat is 0.5682s = 34.1 frames at
60fps; the source animation is 29 frames. `render16.py` plays frames 1..29 at
native speed starting on each kick, then **holds frame 29** for the remaining ~5
frames until the next kick, where it snaps back to frame 1.

Holding is invisible because frame 29 is already at rest, and it means the
animation itself is never stretched or resampled — every frame the source
contains is shown at its authored duration.

## Spider-Man

Cut out with GrabCut from a single rect, which got the figure in one pass
including the gaps under the extended arm and between the legs. The matte is
eroded 1px before feathering, which removes the thin bright halo picked up from
the sky behind him.

He is composited at 275px tall with his base on Morty's floor line, so both sit on
the same ground plane. Because he is a fresh cutout laid over the classroom, there
is no old pose to erase and no background plate is needed.

His bob is driven by **Morty's own measured curve** (`CURVE` in `render16.py`,
normalised from the 14px face travel above), so the two are locked together — the
head tracks of the two characters correlate at **r=+0.966**. The warp is
base-anchored and height-weighted (`u^1.4`), amplitude 4% of his height (11px),
matching Morty's 14px-on-391px proportion.

He enters on the first kick at or after 6s (6.2506s) with a short scale pop.

Two bugs worth remembering, both caught by measuring the output rather than
eyeballing it:

- `cv2.remap` samples the *source*, so pushing content **down** means sampling
  from `y - d`, not `y + d`. The sign was inverted at first, which made Spider-Man
  bob *up* on the kick — exactly out of phase with Morty.
- The pop scales him up about his planted base, so the sprite canvas needs
  headroom. Without padding, the top of his head was clipped on the pop frames.

## Verification

`qa16.py` samples kick-attack strength at the snap instants and sweeps the offset.
Across all 29 snaps in the 16s it peaks at **+0ms, z=+4.54, 25.1 sd above a
random-placement baseline** (p<0.00001). It also tracks both characters' heads in
the rendered output to confirm they move together.

Two earlier checks were misleading and are worth not repeating: nearest-transient
matching looks good for any timing, because the low band has ~183 transients in
8s; and ranking "strongest kicks" is meaningless here, since their magnitudes are
near-identical (p50 0.0996 vs p99 0.133) and the top ones cluster in a bass roll.

## Rebuilding

Needs `ffmpeg`, `numpy`, `opencv-python-headless`, `librosa`, plus `morty.mp4`
and `song.mp3`:

    ffmpeg -i morty.mp4 -vsync 0 frames/f%03d.png
    python3 grid16.py                        # fit the kick grid to the 16s window
    python3 sp_matte.py && python3 sp_prep.py  # cut Spider-Man out, build the sprite
    python3 render16.py                      # -> video16.mp4
    ffmpeg -y -ss 11.8860 -t 16.05 -i song.mp3 \
      -af "afade=t=in:st=0:d=0.03,afade=t=out:st=15.9:d=0.1,apad" -t 16.0 \
      -ar 44100 -ac 2 -c:a aac -b:a 192k audio16.m4a
    ffmpeg -y -i video16.mp4 -i audio16.m4a -frames:v 960 -c:v copy -c:a copy \
      -movflags +faststart gucci_morty_spidey_16s.mp4
    python3 qa16.py                          # verify

`track.py` reproduces the motion measurements above. `restore.py` and
`localfit.py` build the earlier Morty-only 8s cut.

## Note

An earlier version replaced the source motion with a procedurally generated bob
(matte + inpainted plate + feet-anchored mesh warp). It removed the snap, which
is the whole character of the original bob, and was rejected. It remains in git
history at commit `1ada5a3` if any of that machinery is ever wanted.
