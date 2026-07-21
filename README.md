# ⚽ Goalverse — 3D Football Management & Simulation

A polished **3D football (soccer) management & simulation** game that runs entirely in the
browser. Open packs, collect footballers, build your squad, set tactics, and then **watch
fully AI‑simulated AI‑vs‑AI matches** in real 3D on your road from the fourth division to the
**World Cup**.

You never control the players directly — you're the manager. Build the club, pick the tactics,
then watch it all unfold.

**No build tools. No frameworks. No external libraries. No CDN.** Pure HTML, CSS and
JavaScript (ES modules) with a hand‑written WebGL renderer — so it deploys to GitHub Pages as‑is
and works offline.

## ▶ Play

- **Online:** enable GitHub Pages for this repo (Settings → Pages → deploy from this branch,
  root folder). The game goes live at your Pages URL.
- **Locally:** serve the folder over HTTP and open it, e.g. `python3 -m http.server 8080`
  then visit `http://localhost:8080`. (ES modules require HTTP, not `file://`.)
- **Mobile & desktop:** fully responsive and touch‑friendly.

Progress saves automatically to `localStorage`.

## ✨ Features

### Collect & build
- **Player packs** with an exciting walkout reveal — flags, positions, rarity glows and flashes.
- **Outfield rarities:** Common · Rare · Epic · Legendary · Mythic · Superhuman.
- **Goalkeeper rarities:** Common · Rare · Epic · SuperSight · Extreme Reflex · Cat‑Like Reflexes.
- **Special cards** that overlay on top of rarity: Prime · Icon · GOAT · World Cup Winner · Prime Icon
  (e.g. *Mythic GOAT*, *Superhuman Prime Icon*).
- **Deep player model:** OVR, ~22 detailed attributes (Pace, Acceleration, Finishing, Vision,
  Dribbling, Strength, Composure…), goalkeeper‑specific stats (Reflexes, Diving, Handling,
  One‑on‑One…), positions, preferred foot, age, nationality, club, potential, a **playstyle**
  and **traits**. Two players with the same OVR feel different because the underlying stats and
  playstyles differ — and the match AI reads them.
- **Advanced rating page** per player with face stats, a radar chart, full attribute breakdown,
  training, and quick‑sell.

### Manage
- **Squad builder** on an interactive formation pitch, with position‑fit colours, team rating
  and chemistry.
- **Formation editor** (8 formations) and **tactics**: mentality, style of play, pressing,
  tempo, width and defensive line — your AI team plays exactly how you set it up.
- **Club management:** level up, upgrade the stadium, training centre, scouting and medical
  facilities, and fill your trophy cabinet.
- **Career progression:** climb four league divisions, win domestic and continental cups, and
  finally lift the **World Cup**.

### Watch
- **Full 3D match simulation** rendered with a custom WebGL engine — stadium, mown pitch,
  animated player figures, ball physics and a broadcast follow‑camera (broadcast / high / end
  cameras).
- **Intelligent match AI:** players build attacks, pass and shoot from good positions, cross,
  dribble, defend, press, intercept, track runners, counter‑attack, respect offside, and
  goalkeepers make realistic saves and distribution decisions — all according to their
  attributes and your tactics.
- **Live match controls:** pause, slow down, speed up (0.5×–4×), switch cameras, view live match
  statistics, skip to the result, and goal replays with a skip button.
- Automatic 2D top‑down fallback if WebGL is unavailable.

## 🗂 Project structure

```
index.html                 entry point (loads src/main.js as an ES module)
assets/css/main.css         all styling (dark, responsive, mobile‑first)
src/
  core/       util, seeded rng, event bus, state store + localStorage persistence
  data/       nations, name pools, clubs, rarities, playstyles/traits, formations
  game/       ratings, player generation, packs, squad, economy, progression, new‑career
  sim/        const, tactics, ai (decision‑making), match‑engine (physics/state)
  render/     glmath, geometry, pitch textures, scene3d (WebGL), scene2d (fallback)
  ui/         app shell + one module per screen, reusable components, pack opening, match viewer
  main.js     boot: load save or run the new‑career flow, then mount the app
```

The simulation engine is fully decoupled from rendering: it produces match state that either
renderer draws, which also makes the football logic testable on its own.

## 🔧 Tech notes

- Everything is vanilla ES modules — no transpiler, no bundler, no dependencies.
- The 3D is a compact hand‑written WebGL renderer (matrix math, geometry, shaders, textures)
  so there is **zero runtime dependency on any CDN or library**.
- `package.json` only exists so the simulation can be unit‑run under Node during development;
  the browser and GitHub Pages ignore it.
