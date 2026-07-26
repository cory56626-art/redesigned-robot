# Claude's Notes

Developer annotations that sit **beside** the GPT stress-test review
(`SummonerRealms_Stress_Test_Review`). For every point the reviewer raised, this
explains whether it was a **real bug** (and how it was fixed), a
**misunderstanding**, or **working as intended** — plus how to test it correctly.

These notes are also available **in-game**: press **Claude's Notes** on the main
menu or in the pause menu. Keep this file in sync with
`js/ui/claude-notes.js` (the in-game copy) when either changes.

> The review was produced by ChatGPT GPT-5.6 using a browser skill. That matters:
> several "bugs" are automation/focus artifacts of driving a canvas game through
> Playwright, not defects in the game. Those are called out below.

Version: **4.1: Quality of Realms · 2026-07**

---

## 4.1 — Quality of Realms

**Bugs**

- **Block placement was impossible for every mined block.** `mat()` defines raw
  materials as `category: 'material'` and `items.js` patches `.place` onto them
  afterwards, but the action dispatch in `player.js` only routed
  `'block'`/`'station'` to `placeSelected`. `canPlaceAt`, the aim ghost and the
  smart cursor all key off `place`, so the ghost rendered **green** and the
  click did nothing. Dispatch now tests `place`.
- **Swords hit through walls.** Melee tested distance and arc only. Hits now
  gate on `World.hasLineOfSight`; weapons opt out with `phasing: true` (the
  Aetheredge Greatblade).
- **Chopping one tree clear-cut its neighbours.** `collapseTree` flood-filled
  leaves with no notion of ownership, and worldgen spaces trunks 2-3 columns
  apart while a canopy spans 7. Leaves are now assigned to the nearest standing
  trunk.
- **Felled trees reverted to the old flat model.** `_drawFallingTrees` used the
  generic tile texture rather than the shaded trunk/canopy art. Masks are baked
  when the tree falls, since the tiles are already cleared by render time.
- **Wheel hotbar scrolling was choppy** — one step per wheel *event*, and
  trackpads emit ~10 per notch. It now accumulates real scroll distance.
- **Hosting always produced a Normal world** — `createServer()` called
  `startNewWorld` with two arguments. The multiplayer panel has a difficulty
  picker now.
- **Grovekeeper's phase-2 leap flew off screen.** A flying charge held its
  launch velocity with no gravity for its full duration. It now arcs, homes
  back toward the player, and is leashed to the arena.

**Cave generation** — rebuilt around the three things that made it read as
noise: density is depth-graded (~11% open in the dirt layer vs ~44% in the
cavern layer, previously flat), caves come in three size classes from separate
noise scales, and a connectivity pass tunnels orphaned pockets into the main
system so ~99% of open space is one explorable network. Tunnels are biased
horizontal, chambers are built from overlapping jittered discs instead of clean
ellipses, and a despeckle pass removes lone tiles and one-tile pillars.

**New systems**

- **Wind** (`js/systems/weather.js`) — sibling to `daynight.js`. Direction may
  only flip while strength passes through calm, so it structurally never blows
  both ways at once. Drives leaf/plant sway, movement resistance above ground,
  particle-free ambient audio, and a HUD chip. Serialized into the save, the
  WELCOME payload and every snapshot.
- **Flora** — meadow grass, wildflowers, ferns, cave moss, glowcaps (light
  emitting). Corruption trees use a new twisted `BLIGHTWOOD` trunk that drifts
  sideways as it climbs.
- **Player animation and armour** — a real walk cycle (swinging arms, leg lift,
  bob, lean, airborne pose), the weapon rotating through the swing behind a
  tapered trail, and equipped helmet/chest/greaves drawn on local and remote
  players.
- **Smart Cursor** rewritten to be tool-dependent, per the actual Terraria
  behaviour: axes target the tree's base, pickaxes dig a walkable passage
  toward the cursor.
- **Zoom** via `+`/`-` or `Ctrl`+scroll, persisted in settings.
- **Transparent pause screen**, so the world stays visible behind it.

**Gravemaw** rebuilt from the supplied design sheet's own modular breakdown —
head, armoured body segment, tail spike and leg, one set per phase, each
rasterised once into a cached offscreen canvas and blitted rotated along the
body chain. The old chain was three nodes sharing one lag constant, so the
creature slid around as a rigid lump; it is now six nodes each chasing the one
ahead with a progressively slower response, so motion travels down the body as
a wave. Two consequences had to be solved: relative chasing compounds error
down the chain (a hard 1.45x-spacing clamp bounds it), and a pure follow chain
has no preferred pose so it settled standing on end after a drop (each node now
blends toward a resting spine). Phase II grows the real hitbox to 78x58 and
re-seats via `_nudgeOutOfTerrain`; size and phase ride the wire so ghosts match,
and `net/sync.js` imports the chain solver rather than keeping a second copy.

**Minimap** — fog of war, revealed by travelling. One bit per tile (~22KB raw,
~30KB base64 in the save) and a 1px-per-tile raster repainted per 32x32 chunk,
so editing a tile repaints one chunk instead of 182,000 cells. `World.set` gained
an `onTileChanged` hook — there was no change notification before. `M` expands
the map; drag to pan, scroll or pinch to zoom (the first pinch handling in the
codebase). The expanded map registers as a blocking modal, so it stops movement
and mining while the world keeps simulating.

**New harness invariants** — cave depth grading, cave connectivity, and the
"no floating trunks" check relaxed to accept diagonal support so leaning
corruption trunks are legal.

---

## Overhaul pass — what changed

A large pass across terrain, rendering, AI, combat, controls and UI. Highlights:

- **Terrain rebuilt.** Seeded biome bands (Dunes / Verdant Reach / Frostpine
  Hollow / Corrupted Lands) with blended, dithered seams, replacing the hard
  vertical cut at one x coordinate. A 4-octave fBm heightmap terraced into
  plateaus and blurred, with the ±1 slope clamp demoted to a safety net rather
  than the primary shaping tool. Layered fill down through a speckled dirt/stone
  band to deepstone. Caves from ridged 2D noise smoothed by three
  cellular-automata passes, joined by worm tunnels, with entrance shafts that
  visibly break the surface. World grew to 700×260.
- **Background walls.** A second layer behind every naturally-solid tile.
  Carving a cave leaves the wall, and walls block daylight — which is what makes
  the underground read as underground rather than as holes into the sky. The top
  three rows carry no wall, so a shallow trench stays daylit.
- **Neighbour-aware tile framing.** Each tile picks its sprite from its
  neighbours: lit top and left faces, shadowed underside and right face, notched
  inner corners, grass fringing down onto the tile below in its own colour. Ore
  merges into its host rock instead of looking stuck on.
- **Tree shading.** Trunks get a light-to-dark ramp so they read as cylinders,
  flare into roots, cap at the top and grow branch stubs; canopies light from the
  upper left, self-shadow where enclosed, and take a ragged silhouette.
- **Gradual cave background.** The sky is sampled per screen edge from the world
  depth that edge looks at and drawn as one gradient. No thresholds anywhere in
  the descent.
- **AI.** `systems/ai.js` gives every creature perception (aggro radius gated on
  line of sight, plus decaying memory of your last known position), navigation
  (ledge and gap detection, a local BFS to route around terrain), separation
  steering and predictive aim. Enemies idle when unaware, telegraph attacks, and
  no longer shoot or fly through rock.
- **Bosses.** A single state machine — reposition → telegraph → attack →
  recover — with weighted attack choice. Burrow and teleport hide the boss, mark
  where it will surface, and stop dealing contact damage from an invisible spot.
  Flying bosses collide with terrain. Kiting one enrages it, then makes it leave.
- **Throwables and explosions.** Six throwables that arc, bounce and (for the
  explosive ones) destroy tiles and walls gated on a per-tile blast resistance —
  and hurt the thrower.
- **Weapon effects** on selected weapons only, so the ones that flash, burn or
  throw an arc feel like an upgrade.
- **Smart Cursor** for PC (hold Ctrl) and mobile (◎), plus playing normally with
  the inventory open, a rebuilt non-overflowing inventory with drag-and-drop, and
  a Settings panel.
- **An enforced respawn timer**, longer during a boss fight, which also ends the
  encounter.
- **Vesper Thane, the Guide**, who explains any item you carry using its own
  definition cross-referenced with recipes and loot tables.
- **Drop-in music** from `assets/music/` — see that folder's README.

### Bugs found and fixed along the way

- Enemy `iframes` were assigned on every hit and never checked.
- Projectiles tested tile collision only at their end point once per step, so a
  ~15px/frame shot passed through one-tile walls. Now swept.
- Burrowing bosses re-set `invuln` every frame (permanently invulnerable) while
  still dealing contact damage from a position the player couldn't see.
- The parallax cave backdrop passed a negative radius to `ellipse()` for half of
  all hash inputs — a signed shift where an unsigned one was meant.
- The save indicator and net status rebuilt `className` from scratch, throwing
  away shared chip styling.
- `respawnTimer` was set but never enforced; `mineTarget` was written every frame
  and never read; a duplicated `alive` guard sat in the player draw loop;
  `quitToMenu` poked the mobile controls' DOM directly instead of going through
  `applyControlMode`.
- Per-module `?build=` cache-busters had drifted out of sync, so a release could
  ship a half-updated module graph. `tools/stamp-build.mjs` now stamps every
  module from the single `BUILD` constant in `js/config.js`.

### Tests

- `npm run check:worldgen` — headless, dependency-free harness asserting the
  generator's invariants across many seeds: spawn safety, walkable slopes, biome
  contiguity, cave density and surface connectivity, wall coverage, ore banding,
  and no floating trunks or orphaned leaves.
- `npm run check:build` — verifies every module is stamped with the current
  `BUILD`.

---

## Priority bugs (the review's own top-10)

### 1. Horizontal movement "did not reliably move the player"
**Real bug — fixed.** The player had *no auto step-up*. Walking into any 1-tile
terrain bump — which natural ground is full of — stopped horizontal movement
while jumping still worked. Because spawn terrain frequently has a step on one
side, one direction would "work" and the other would jam, producing the exact
"reliable one way / broken the other" symptom the reviewer saw.

- Fix: `physics.moveAndCollide` now auto-climbs ledges up to an entity's
  `stepHeight` (the player uses ~18px ≈ 1 tile) while grounded. Enemies already
  hopped ledges through their own AI (`enemy._climb`), which is why *they* moved
  fine and the player didn't.
- Verified with automation: the player now travels the full ~150 px/s in **both**
  directions over stepped terrain (previously right-movement stopped after ~20px).
- Testing note: keyboard drives movement in **every** control mode. Automated
  tests must (a) give the canvas focus and (b) use *held* keys
  (`keyboard.down('d')` … `keyboard.up('d')`). A/D and ←/→ move; W/Space/↑ jump.

### 2. Runtime state leaking across new-world / load / death / respawn
**Fixed / mostly already handled.**
- New World and Load already call `_resetEntities()` (clears bosses, enemies,
  projectiles, drops, minions, particles) before the world starts, so a boss
  cannot survive **world creation**.
- What *could* leak was a boss surviving **death/respawn**. Now, in single-player,
  dying despawns the active boss (plus its adds and projectiles), and respawn
  wipes combat state. See `onLocalDeath` / `resetCombatState` in `main.js`.
- Also added explicit commands (see #6): `/clearboss`, `/resetcombat`,
  `/resetworldstate`.

### 3. "Black rendering / canvas corruption" after placement + dark caves
**Not corruption — it was the lighting model, and it was too dark.**
- Enclosed/underground tiles fell to a near-black floor (0.05), so caves and the
  undersides of tree canopies read as solid black. Placing a block that roofs an
  area correctly casts shadow below it — which looks like "corruption" in a still.
- Fix: the ambient light floor is raised to **0.14** and solid tiles attenuate
  light slightly less, so terrain everywhere stays dimly **readable**. Torches
  (light 0.95) and the player's own glow are still clearly brighter, so lighting
  the dark still matters. The canvas is fully redrawn each frame — there is no
  stale/corrupt buffer.

### 4. Block placement didn't confirm success/failure
**Fixed.** The aim tile shows a **green** ghost of the block when placement is
valid and a **red** ghost when it isn't (`renderer._drawAimHighlight` +
`combat.canPlaceAt`). A successful place pops "&lt;block&gt; placed"; a blocked
place pops the reason ("Too far away", "Needs a solid neighbour", "Can't place on
a player", "Space is occupied"). Placement rules: empty tile, within 6-tile reach,
touching a solid tile **or** within 3 tiles of you, and no solid block inside a
player.

### 5. Resource gathering feedback "weak"
**Working as intended — already present.** Mining/chopping pops a floating
"+N &lt;item&gt;" at the tile and updates the hotbar/inventory count immediately.
Felling a tree collapses the whole trunk+canopy and pops "+N Wood". Where pickups
seemed not to register, the blocker was movement/targeting (see #1), not the
pickup. Right-click (PC) auto-selects the correct tool for the target tile.

### 6. Command identifiers (`/spawn slime`, `/give plantfiber`)
- `/spawn slime` **already works** — there is no creature literally named "slime";
  the slime-like foe is the **Slugling**, and `slime`/`slimes`/`slug` alias to it.
- `/give plantfiber` **fixed** — the item id is `fiber` (display name "Plant
  Fiber"). The resolver is now space/punctuation-insensitive, so `plantfiber`,
  `plant fiber`, `fiber`, `craftingbench`, etc. all resolve. Tab-autocomplete
  lists the exact ids.
- Capacity messages: `/give` reports "(N didn't fit)" on stack overflow — that
  *is* the remaining-capacity feedback. Stacks: 99 most materials, 30 potions,
  200 ammo.

### 7. Menu clipping / responsiveness
**Fixed.** The title is size-capped and now wraps cleanly to "Summoner" /
"Realms" on very narrow screens (via a `<wbr>` + `inline-block` span) instead of
overflowing the panel or the viewport.

### 8. Debug/pause panels should reliably pause & close
**Fixed for single-player.** Opening the Demo Commands console or the inventory
now **freezes the world simulation** (`_simFrozen` gate in `_loop`) — enemies and
bosses stop while you're in those panels. A networked world can't be frozen
unilaterally, so it keeps running there. Escape order is deliberate: console →
How-to → Claude's Notes → confirm → inventory → other dialogs → then pause. So
Escape with the bag open *closes the bag*; it does not also pause.

### 9. Boss damage / HP reduction / phases hard to see
**Mostly perception — improved.** Bosses have large HP (600 / 1100 / 1800) and
short invulnerability windows on phase changes and while burrowing, so early chip
damage moves the bar slowly. Damage *was* applying (floating numbers confirm it).
Added: the boss bar now shows an exact **"HP / max (percent)"** readout so the
reduction is unmistakable. Phase changes still toast and flash.

### 10. Explicit combat/world reset commands
**Added.** `/clearboss` (boss + adds + boss shots), `/resetcombat` (projectiles,
particles, combat state), `/resetworldstate` (all bosses + enemies + projectiles,
terrain kept). `/killall` still targets only regular enemies (so you can clear
adds mid-fight) and now says so when a boss is present.

---

## Smaller review points

- **Floating spawn.** Fixed — `world.spawnPixelY` seats the player on the surface
  instead of a few tiles above it.
- **Hotbar numbers "duplicated / out of order".** Not a bug: each slot shows its
  *select key* (1–9 then 0) in the corner and its *stack count* separately. Two
  different numbers, not duplicates.
- **Mobile joystick "didn't move".** Real bug — fixed. The stick released itself
  when the knob was dragged past its own bounds (a `pointerout` reset). It now
  uses pointer capture and only releases on `pointerup`/`pointercancel`. Keyboard
  also works in mobile mode.
- **Escape closed inventory *and* paused.** It doesn't (see #8) — Escape resolves
  one layer at a time.
- **"Playwright button clicks didn't activate the button".** A harness/focus/
  timing artifact, not a game bug — the buttons are plain `<button onclick>`. For
  automation, prefer the `window.__game` hook or click by visible coordinates
  after the overlay settles.

---

## Testing crib sheet (for GPT)

`window.__game` is the live game object. Useful entry points:

```js
__game.startNewWorld('Name', 'seed');   // skip the menu
__game.teleportBiome('underground');    // forest | underground | corrupt | cavern
__game.localPlayer;                      // hp, mana, x, y, inventory, cheats
__game.bosses; __game.enemies;           // live entity arrays
```

Commands (open with `/` in-game, or the Demo Commands panel):

- Items: `/giveall`, `/give <item> <n>`, `/clearinventory`
- Enemies: `/spawn <enemy> <n>`, `/killall`
- Bosses: `/spawnboss <boss>`, `/summonitem <boss>`, `/clearboss`
- Reset: `/resetcombat`, `/resetworldstate`, `/resetcooldowns`, `/resetdemo`
- Cheats/util: `/godmode`, `/fly`, `/heal`, `/mana`, `/time day|night`, `/save`
- Debug overlays: `/debugcaves`, `/debugcollision`, `/debugai`, `/debugspawn`,
  `/debugbiome`

Content ids:

- Enemies: `slugling`, `husk`, `bonepicker`, `crawler`, `boar`, `blightshade`
  (aliases: slime→slugling, zombie→husk, skeleton→bonepicker, spider→crawler,
  pig→boar, ghost/caster→blightshade)
- Bosses: `grovekeeper` (Forest), `gravemaw` (Underground),
  `blightSovereign` (Corrupted Lands)
