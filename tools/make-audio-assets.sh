#!/usr/bin/env bash
set -euo pipefail

out="assets/audio"
mkdir -p "$out"

encode() {
  local name="$1"
  shift
  ffmpeg -hide_banner -loglevel error -y "$@" -ar 44100 -ac 1 -c:a libvorbis -q:a 5 "$out/$name.ogg"
}

# Short, authored sample assets. They are deliberately layered from transients,
# filtered noise, and pitched material so they read as physical sounds in-game.
encode pickaxe \
  -f lavfi -i "sine=frequency=125:duration=0.18" \
  -f lavfi -i "anoisesrc=color=white:duration=0.18:amplitude=0.32" \
  -filter_complex "[0:a]afade=t=out:st=0.025:d=0.155,volume=0.9[a];[1:a]highpass=f=900,lowpass=f=5200,afade=t=out:st=0.002:d=0.17,volume=0.75[b];[a][b]amix=inputs=2:duration=shortest,alimiter=limit=0.95" \
  -t 0.18

encode axe \
  -f lavfi -i "sine=frequency=92:duration=0.22" \
  -f lavfi -i "anoisesrc=color=pink:duration=0.22:amplitude=0.36" \
  -filter_complex "[0:a]afade=t=out:st=0.035:d=0.185,volume=1.0[a];[1:a]bandpass=f=700:w=1.2,afade=t=out:st=0.003:d=0.21,volume=0.8[b];[a][b]amix=inputs=2:duration=shortest,alimiter=limit=0.95" \
  -t 0.22

encode sword \
  -f lavfi -i "anoisesrc=color=white:duration=0.2:amplitude=0.24" \
  -f lavfi -i "sine=frequency=980:duration=0.2" \
  -filter_complex "[0:a]bandpass=f=2500:w=1.1,afade=t=out:st=0.015:d=0.18,volume=0.8[a];[1:a]afade=t=out:st=0.025:d=0.175,volume=0.22[b];[a][b]amix=inputs=2:duration=shortest,alimiter=limit=0.95" \
  -t 0.2

encode enemy-hurt \
  -f lavfi -i "sine=frequency=210:duration=0.13" \
  -f lavfi -i "sine=frequency=315:duration=0.09" \
  -filter_complex "[0:a]afade=t=out:st=0.015:d=0.115,volume=0.7[a];[1:a]adelay=18|18,afade=t=out:st=0.015:d=0.075,volume=0.35[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.13

encode enemy-death \
  -f lavfi -i "sine=frequency=294:duration=0.32" \
  -f lavfi -i "sine=frequency=233:duration=0.32" \
  -f lavfi -i "anoisesrc=color=brown:duration=0.32:amplitude=0.2" \
  -filter_complex "[0:a]afade=t=out:st=0.12:d=0.2,volume=0.55[a];[1:a]adelay=75|75,afade=t=out:st=0.12:d=0.2,volume=0.48[b];[2:a]lowpass=f=900,afade=t=out:st=0.02:d=0.3,volume=0.6[c];[a][b][c]amix=inputs=3:duration=longest,alimiter=limit=0.95" \
  -t 0.32

encode player-hurt \
  -f lavfi -i "sine=frequency=145:duration=0.24" \
  -f lavfi -i "anoisesrc=color=pink:duration=0.18:amplitude=0.28" \
  -filter_complex "[0:a]afade=t=out:st=0.035:d=0.205,volume=0.9[a];[1:a]lowpass=f=1200,afade=t=out:st=0.015:d=0.165,volume=0.7[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.24

encode jump \
  -f lavfi -i "sine=frequency=240:duration=0.24" \
  -f lavfi -i "sine=frequency=360:duration=0.18" \
  -filter_complex "[0:a]afade=t=in:st=0:d=0.015,afade=t=out:st=0.12:d=0.12,volume=0.6[a];[1:a]adelay=35|35,afade=t=out:st=0.08:d=0.1,volume=0.34[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.24

encode pickup \
  -f lavfi -i "sine=frequency=523:duration=0.22" \
  -f lavfi -i "sine=frequency=659:duration=0.18" \
  -filter_complex "[0:a]afade=t=out:st=0.08:d=0.14,volume=0.55[a];[1:a]adelay=70|70,afade=t=out:st=0.07:d=0.11,volume=0.5[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.25

encode coin \
  -f lavfi -i "sine=frequency=988:duration=0.2" \
  -f lavfi -i "sine=frequency=1319:duration=0.16" \
  -filter_complex "[0:a]afade=t=out:st=0.08:d=0.12,volume=0.6[a];[1:a]adelay=65|65,afade=t=out:st=0.06:d=0.1,volume=0.5[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.23

encode ui-click \
  -f lavfi -i "sine=frequency=392:duration=0.065" \
  -f lavfi -i "sine=frequency=523:duration=0.04" \
  -filter_complex "[0:a]afade=t=out:st=0.015:d=0.05,volume=0.45[a];[1:a]adelay=12|12,afade=t=out:st=0.01:d=0.03,volume=0.3[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 0.08

encode block-place \
  -f lavfi -i "sine=frequency=170:duration=0.16" \
  -f lavfi -i "anoisesrc=color=pink:duration=0.13:amplitude=0.22" \
  -filter_complex "[0:a]afade=t=out:st=0.035:d=0.125,volume=0.7[a];[1:a]lowpass=f=900,afade=t=out:st=0.01:d=0.12,volume=0.55[b];[a][b]amix=inputs=2:duration=shortest,alimiter=limit=0.95" \
  -t 0.16

encode block-break \
  -f lavfi -i "anoisesrc=color=white:duration=0.18:amplitude=0.3" \
  -f lavfi -i "sine=frequency=120:duration=0.18" \
  -filter_complex "[0:a]bandpass=f=1500:w=1.2,afade=t=out:st=0.02:d=0.16,volume=0.7[a];[1:a]afade=t=out:st=0.03:d=0.15,volume=0.6[b];[a][b]amix=inputs=2:duration=shortest,alimiter=limit=0.95" \
  -t 0.18

# Looped beds: these are intentionally sparse so they can sit under gameplay.
encode forest \
  -f lavfi -i "anoisesrc=color=pink:duration=10:amplitude=0.08" \
  -f lavfi -i "sine=frequency=196:duration=10" \
  -filter_complex "[0:a]bandpass=f=900:w=0.8,volume=0.32[a];[1:a]volume=0.025,aphaser=in_gain=0.6:out_gain=0.6:delay=2:decay=0.4:speed=0.25[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 10

encode cave \
  -f lavfi -i "anoisesrc=color=brown:duration=10:amplitude=0.07" \
  -f lavfi -i "sine=frequency=73.4:duration=10" \
  -filter_complex "[0:a]lowpass=f=420,volume=0.5[a];[1:a]volume=0.06,afade=t=in:st=0:d=1,afade=t=out:st=9:d=1[b];[a][b]amix=inputs=2:duration=longest,alimiter=limit=0.95" \
  -t 10

encode wind \
  -f lavfi -i "anoisesrc=color=pink:duration=10:amplitude=0.09" \
  -filter_complex "[0:a]bandpass=f=850:w=0.55,tremolo=f=0.13:d=0.65,volume=0.42,alimiter=limit=0.95" \
  -t 10
