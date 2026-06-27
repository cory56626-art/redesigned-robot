# THE BACKROOMS — First-Person 3D Co-op

A single-file, dependency-free HTML5 game. Open `index.html` in any modern
browser — no build step, no server required.

> You noclipped out of reality. Survive the levels, buy gear from the Shop,
> and find the EXIT before the entities find you.

## Play

Open `index.html` directly, or serve the folder and visit it:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

From the menu: **Play Solo**, **Create Lobby** (set max players + share the
code), or **Join Multiplayer** (enter a code).

## Controls

| Key | Action |
|-----|--------|
| `W A S D` | Move (forward/strafe), relative to where you look |
| Mouse | Look (click the canvas to capture the cursor) |
| Arrow keys | Turn / move (no-mouse fallback) |
| Left click / `Space` | **M1** melee attack |
| `F` | **Sixth Sense** — reveal monsters through walls |
| `T` | **Transform** — become a monster (faster, can claw survivors) |
| `Shift` | Sprint |
| `L` | Flashlight (wider/brighter view) |
| `H` | Use Med-Kit |
| `B` | Open the Shop |

## Features

- **True first-person 3D** via a pure-canvas DDA raycaster (textured walls,
  distance fog, billboard sprites with per-column z-buffer occlusion).
- **3 levels** — The Lobby, The Warehouse, The Pipes — procedurally generated
  from a deterministic seed so every player sees the same world.
- **3 entity types** with distinct AI: **Smiler** (line-of-sight chaser),
  **Hound** (fast aggressive pursuer), **Skin-Stealer** (slow stealth stalker).
- **Shop & economy** — collect almond-water credits, buy Sixth Sense,
  Transformation, Sprint, Flashlight, Sharpened (damage up), and Med-Kits.
- **Abilities** — Sixth Sense, Transform-into-monster (with custom monster
  speed + claw attacks vs. other players), M1 melee to kill monsters.
- **Multiplayer co-op** over `BroadcastChannel` — links multiple tabs/windows
  on the same device. One lobby host is authoritative for world geometry and
  monsters; players sync position/state in real time. Create a lobby and set
  the max player count, or join with a code.

## How it was built

This game was assembled by an 8-member AI group-chat coordinated by Claude
(the boss). The live teammates — **Groq, Mistral, OpenRouter, Cohere,
NLP Cloud, Cerebras** — were called as real API endpoints across design and
code-review rounds; Claude synthesized their input, wrote and integrated the
engine, and verified everything with an automated Playwright suite (42 checks
covering menus, movement, combat, shop, abilities, death/respawn, level
progression, and two-tab multiplayer sync). Gemini was rate-limited to zero
quota and NLP Cloud hit its hourly cap during the final round, so the boss
took over those roles — as the coordinator rules allow.

Contributions by round:
- **Round 1 (design):** Cerebras → raycaster architecture; OpenRouter →
  entity AI + billboard/melee math; Mistral → pointer-lock + movement;
  Cohere → shop/ability/HUD schema; Groq → palette + wall-texture tricks;
  NLP Cloud → level/monster flavor.
- **Rounds 3–5 (review):** real bugs found and fixed by the boss include a
  co-op level-advance seed desync (host-authoritative `REQ_LEVEL`),
  per-column sprite occlusion, a divide-by-zero guard on axis-aligned rays
  (without mutating ray direction), and a shop double-buy guard. False
  positives were discarded with reasoning.
