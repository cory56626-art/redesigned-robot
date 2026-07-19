# 🧩 Puzzle Lab

A polished, **mouse-only** 2D puzzle adventure that runs entirely in the browser —
pure HTML, CSS and JavaScript. **No backend, no build tools, no external libraries.**
Just open `index.html` and play.

Designed to challenge both **humans and AI agents**: every interaction works with
clicking, dragging, drawing, or rotating — **no keyboard is ever required** — and every
puzzle shows everything you need to solve it on screen.

## ▶ Play

- **Online:** enable GitHub Pages for this repo (Settings → Pages → deploy from
  `main`/branch, root folder). The game will be live at your Pages URL.
- **Locally:** just double-click `index.html` — it works straight from the file system.
- **Mobile:** fully touch-compatible (tap replaces click, drag works with a finger).

## ✨ Features

- **23 distinct puzzle mechanics**, each with randomized, seeded layouts —
  thousands of unique configurations, and difficulty that ramps up as you go.
- **Mouse / touch only.** Click, drag, draw paths, rotate mirrors & gears, mix colors.
- **Progress saved automatically** to `localStorage` (seed, current room, lifetime stats).
- **Statistics:** rooms cleared, puzzles solved, accuracy, mistakes, time, and score.
- **Test / Demo menu** (⚙ in-game): jump to any room, force a specific puzzle type,
  set a random seed, reset, replay, skip, or roll a brand-new random puzzle.
  Seeds are deterministic — the same seed + room always reproduces the same puzzle.

## 🧠 Puzzle types

Arithmetic · Number sequences · Pattern matrix · Sequence prediction · Logic (odd-one-out) ·
Code breaking (Mastermind) · Memory match · Maze path drawing · Wire matching ·
Untangle (graph planarity) · Pipe / water flow · Laser mirrors · Gears · Sliding blocks ·
Jigsaw · Graph traversal · Shape fitting · Logic circuits · Weight balancing ·
Color mixing · Spot the difference · Drag-to-sort ordering · Reflex / quick-tap.

## 🗂 Project structure

```
index.html            entry point (loads everything as classic scripts)
assets/style.css      all styling (dark "lab" theme, responsive, light-weight)
src/
  util.js             DOM/SVG helpers, pointer utilities
  rng.js              seedable deterministic RNG (mulberry32)
  storage.js          localStorage save/load with graceful fallback
  registry.js         puzzle registration
  stats.js            statistics model
  puzzle-kit.js       shared puzzle UI helpers
  engine.js           run controller: rooms, scoring, HUD, saving
  puzzles-quiz.js     arithmetic / sequences / patterns / logic / codebreak / memory
  puzzles-spatial.js  maze / connect / untangle / pipes / mirrors / gears
  puzzles-more.js     sliding / jigsaw / graph / shapefit
  puzzles-mechanic.js circuit / weight / color / spot-the-difference / order / quick-tap
  main.js             app shell: title, stats, help, test menu, boot
```

Everything is vanilla ES5+/DOM — no dependencies, no transpiler, no bundler.

## 🔧 Adding a puzzle

Call `PZ.register({ id, name, category, hue, minDifficulty, build(ctx) })`.
Inside `build`, use `ctx.rng` (seeded), `ctx.difficulty`, render into `ctx.root`,
and call `ctx.solve()` on success or `ctx.fail()` on a mistake. It automatically
joins the room rotation and the test menu.
