# Summoner Realms — CLAUDE.md

Guidance for Claude Code when working in this repo. For player-facing docs
(controls, lore, content lists), see `README.md`. For a running log of
bug-triage decisions (real bug vs. intended behavior vs. misunderstanding),
see `CLAUDE_NOTES.md` — keep it in sync with `js/ui/claude-notes.js` (the
in-game copy) whenever either changes.

## What this is

A 2D sandbox-survival game (Terraria-like genre, entirely original assets,
names, and mechanics) that runs in the browser: vanilla JS + Canvas 2D, ES
modules, no bundler, no framework. Multiplayer is a small Node/Socket.IO
relay in `server/`. Current version lives in `js/config.js` as `VERSION` /
`VERSION_TITLE`.

## Running it

ES modules don't load from `file://`, so it must be served over HTTP:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or
npm run serve                     # http-server on :8899 (used by the smoke test)
```

Multiplayer backend (optional, separate Node project):

```bash
cd server && npm install && npm start   # http://localhost:10000, /health check
```
Then load the frontend with `?server=http://localhost:10000`.

## Checks (run these before calling a change done)

```bash
npm run check            # = check:worldgen + check:build
npm run check:worldgen   # node tools/worldgen-check.mjs [seedCount] — pure node, DOM-free, fast
npm run check:build      # tools/stamp-build.mjs --check — every module stamped with current BUILD
npm run check:smoke      # tools/smoke-test.mjs — Playwright, needs `npm run serve` running first
```

- `worldgen-check.mjs` imports `js/world/worldgen.js` directly in plain Node
  (worldgen has no DOM dependency) and asserts invariants across many seeds:
  spawn safety, walkable slopes, biome contiguity, wall coverage, valid ore
  placement, connected trees, cave shape (no isolated pockets, horizontal
  elongation, surface reachability, increasing depth profile), and water
  never inside rock or unsupported. A failure prints the seed for repro via
  `/debugcaves` in-game.
- `smoke-test.mjs` boots the real game in headless Chromium and drives every
  system through the **actual input path** (mouse position + button), not by
  calling internals directly — several fixed bugs lived specifically in the
  dispatch between an input and an action, so calling actions directly would
  have passed against a broken build. Requires the static server on :8899
  first.
- `window.__game` is exposed in the browser console as a test/debug hook.

## The build stamp (read before touching any `js/` file)

There's no bundler. Every relative ES-module import is cache-busted with a
`?v=` suffix driven by the single `BUILD` constant in `js/config.js`. If you
change any module graph in a way that should invalidate old cached copies,
bump `BUILD` and run:

```bash
npm run stamp        # applies the current BUILD to every import
npm run check:build  # verifies nothing was missed
```

Skipping this can ship a half-updated module graph (old cached module A
importing new module B or vice versa). This is the single most common way to
silently break a deploy.

## Architecture

```
index.html            markup + all UI overlays
css/styles.css         theme + responsive/mobile layout
vendor/socket.io.min.js  vendored Socket.IO client
server/                Node + Express + Socket.IO multiplayer backend (deploy target: Render)
js/
  config.js  utils.js  global tuning constants, BUILD stamp, VERSION, difficulty tuning
  engine/    game loop, camera, input (PC + mobile), renderer, audio, music, fx, water
  art/       procedural sprite generation — no image assets; all art is generated at runtime
  world/     tiles, walls, biomes, seeded worldgen, runtime world state + lighting, liquid
  data/      items, recipes, enemies, minions, bosses, fauna, guide dialogue — pure data, no logic
  entities/  player, enemy, minion, boss, npc, projectile, thrown item, dropped item, physics
  systems/   combat, ai, explosions, smart cursor, inventory, crafting, progression,
             spawner, day/night, achievements, fishing, weather
  ui/        HUD, menus, NPC dialogue, controls-mode, minimap, titlescreen, claude-notes
  net/       protocol.js (message shapes), net.js (Socket.IO transport), sync.js (host-authoritative sync)
  commands.js  Demo Commands console (/give, /spawn, /teleport, …)
  save.js    localStorage save/load (world seed, block diffs, inventory, position, achievements)
  main.js    orchestrator + game loop entry point
tools/
  worldgen-check.mjs   headless worldgen invariant test (node, no deps)
  stamp-build.mjs      applies/checks the BUILD cache-bust stamp
  smoke-test.mjs        Playwright end-to-end smoke test
  make-audio-assets.sh  regenerates assets/audio/*.ogg
assets/
  audio/   sound effect .ogg files
  music/   optional soundtrack — empty by default; see its README for filenames/fallback rules
```

## Conventions and gotchas

- **All art is procedural.** Sprites are generated at runtime in `js/art/`
  — there are no image/sprite files to edit. Keep it that way; it's a
  stated project goal (no external/copied assets).
- **Multiplayer is host-authoritative.** The host's browser simulates the
  world, enemies, and drops; each client owns its own inventory and sends
  actions. `server/` only relays messages and tracks room rosters — it does
  not run game logic. Don't add gameplay-affecting state to `server/`, and
  don't have clients assume authority over shared world state in `js/net/`
  or `js/entities/`.
- **`js/data/` is pure data.** Items, recipes, enemies, minions, bosses,
  fauna, and guide dialogue live here as plain objects/arrays with no
  behavior — logic that acts on them belongs in `js/systems/` or
  `js/entities/`.
- **Difficulty and biome tuning live in `js/config.js`** (`WORLD_DIFFICULTIES`,
  `ENEMY_DIFFICULTY_TUNING`, `TILE`, `WORLD_W`/`WORLD_H`, etc.) — check there
  before hardcoding a tuning number elsewhere.
- Root `package.json` is mostly a delegator so Render can build/start
  `server/` even if a service's Root Directory is left at the repo root;
  it does not affect the static GitHub Pages frontend.
- GitHub Pages deploys automatically via `.github/workflows/pages.yml` on
  push to `main` and a fixed allowlist of `claude/*` branches (this branch
  included) — no build step, it uploads the repo root as-is.
- Don't commit `node_modules/`, `.env`, or `*.log` (see `.gitignore`).

## Before finishing a task

1. Run `npm run check` (worldgen + build stamp). Run `npm run check:smoke`
   too if you touched input handling, UI, or anything dispatch-related.
2. If you changed the module graph, bump `BUILD` in `js/config.js` and run
   `npm run stamp`.
3. If you resolved a reported "bug" that turned out to be intended
   behavior or a misunderstanding, log it in `CLAUDE_NOTES.md` (and its
   in-game mirror `js/ui/claude-notes.js`) the way existing entries do.
