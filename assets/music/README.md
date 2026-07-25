# Music / OST

Drop audio files in this folder and the game picks them up automatically. No
code changes, no rebuild — the music system probes for each filename the first
time that context comes up, remembers what it found, and never asks again.

**Nothing here is required.** With this folder empty the game runs exactly as it
did before, on its procedural ambience. Add one file and that one context gets a
track; add all of them and the whole game is scored.

## Filenames

Name a file after the context it should play in. `.mp4` is checked first, then
`.m4a`, `.ogg`, `.mp3` — MP4/M4A is AAC audio, which every current browser
decodes, so an MP4 with no video track is a perfectly good music file.

| File | Plays during |
| --- | --- |
| `menu.mp4` | the main menu |
| `forest-day.mp4` | the Verdant Reach in daylight |
| `forest-night.mp4` | the Verdant Reach after dark |
| `dunes.mp4` | the Sunken Dunes |
| `frostpine.mp4` | Frostpine Hollow |
| `corruption.mp4` | the Corrupted Lands |
| `underground.mp4` | underground, below the dirt line |
| `cavern.mp4` | the deep caverns |
| `boss-grovekeeper.mp4` | the Grovekeeper fight |
| `boss-gravemaw.mp4` | the Gravemaw fight |
| `boss-sovereign.mp4` | the Blight Sovereign fight |
| `boss.mp4` | any boss fight without its own track |

Anything missing falls back sensibly: a biome with no track uses `forest-day`,
the caverns fall back to `underground`, and a boss without its own theme uses
`boss`. If the fallback is missing too, whatever is already playing keeps
going.

## Notes

- Tracks **loop**, so pick something that loops cleanly, or at least fades in
  and out at the same level.
- Switching contexts **crossfades** over about 1.6 seconds, and the game waits a
  second before acting on a change so walking back and forth across a biome
  boundary doesn't strobe the soundtrack.
- Volume lives under **Settings → Audio → Music** and is saved with the rest of
  your settings.
- Browsers won't start audio before the player interacts with the page. The
  first click or key press unlocks it; that's a browser rule, not a bug.
- Keep the files reasonably small — this is a static site, and every visitor
  downloads whatever is here.
- With this folder empty the game gives up looking after a few misses, so it
  doesn't spend the session asking for files that aren't there. Add a track and
  run `/music rescan` in the Demo Commands console (or just reload) to pick it
  up without restarting.
- `/music <context>` forces a specific track, `/music off` stops it, and
  `/music status` reports what was found.
