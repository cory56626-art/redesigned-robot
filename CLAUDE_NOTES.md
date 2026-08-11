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

Version: **4.2 — The Deep and the Divided · 2026-08**

---

## 4.2 — The Deep and the Divided

Three things: the oceans were a flat blue slab, the Mesh was an empty shelf next
to the Corruption's thickets, and slot five was missing. All three turned out to
have the same shape of cause — a system that was *described* but never given the
parts that make it read.

### The oceans

The ocean was one flat rectangle of `#2f6fbf` at 72% alpha with a one-pixel
highlight on the top row. Two separate faults, one in the generator and one in
the renderer:

- **The sea had no single level.** `fillOceans` chose a per-column water top of
  `s - 10 - ((x * 3) % 4)` — a four-column sawtooth. The surface stepped up and
  down three tiles every few columns, so any depth-based shading reset at every
  step and the whole body read as vertical stripes. Each ocean band now floods
  to one flat row, chosen from the shallowest seabed in that band.
- **Columns were missing entirely.** The old support test walked down from a
  cell and bailed on the *first non-air tile*, so any column with a reed or a
  shrub standing on the seabed was left completely dry — a wall of water with
  slices cut out of it. Support is now decided by whether the column reaches
  solid seabed at all, and submerged ground cover is cleared so the column
  floods cleanly.

With the terrain fixed, the water is drawn as a body of water
(`js/engine/water.js`): columns scanned into runs and filled with a depth ramp
keyed to each column's own free surface; a wavy crest with sheen and foam that
appears on the tops of the swell; god rays cast from a world-space lattice
wherever open water actually sits under open sky, leaning with the sun and
drifting on their own cycles; caustics on the seabed; suspended motes and rising
bubbles from a hash rather than stored particles; shoreline foam; and a
screen-space cast, vignette and shimmer while submerged.

One deliberate design note on the rays: the first version emitted from *every*
open column, which at noon produced evenly spaced vertical bars. Light has to
arrive from somewhere — "everywhere at once, straight down" reads as striping,
not as sun. They now sit on a sparse lattice and always keep a standing tilt.

### The Mesh

The Mesh was rust and scrap: bare plating, two kinds of ground cover, four
enemies that were re-coloured cave mobs, and none of them with any art of their
own — every one fell through to the generic "rounded box with a white pixel for
an eye" fallback. That is what "no custom enemies" meant literally.

It is now the *living* evil, the Corruption's opposite number rather than its
poor relation: muscle grown over machinery.

- **A real find.** Surface undergrowth is gated on a whitelist of ground tiles
  and Mesh Membrane was not in it, so every Mesh column rolled its ground cover,
  looked at the wrong ground tile and grew nothing. That single missing entry is
  most of why the biome looked bare.
- **New tissue.** Mesh Flesh as the sub-layer, Raw Sinew and Sinew Clumps on the
  floor, Gut Strands off every ceiling, and Mesh Pods — the biome's only natural
  light, so a Mesh cave is navigable before you spend torches on it. Ground
  cover now runs as dense as the Jungle's.
- **Six creatures, all with their own art**: Sinew Crawler, Spore Drone, Gristle
  Husk, Wire Serpent, Strand Spitter and — post-Vespera — the Mesh Brute. They
  share one grammar so they belong to each other: dark wet meat, one bone-pale
  mechanical remnant, and a hot core that brightens on the wind-up. All of them
  drop Mesh Sinew, so the biome funds its own boss.

### Slot five: a fork, not a step

A realm generates exactly one evil biome, so slot five is two encounters that
are alternatives rather than a chain. Neither lists the other as a prerequisite;
both sit behind Vespera and behind their own biome. The gate enforces itself
through ingredients — Blightstone only exists in a Corruption world and Mesh
Sinew only in a Mesh world — so nothing has to check a flag to know which fight
your realm can reach.

**The Hollowed Choir** (Corruption) — 12,000 HP, 12 defense, 33 contact. Phase
one is one hulking mass: Reaching Grasp (arms that stretch out of the mound
toward where you are standing), Choir Wail (a ring of spores with real gaps in
it), and Lurch Charge (a committed dash that smears corrupted ground behind it).
At 55% it comes apart into three husks — separate bodies sharing one health bar
— that bite, pop for spore damage when they die, and *re-fuse and heal* if two
of them are left huddled together for three seconds. That last rule is the whole
fight: focus one husk down while the other two regroup and you lose ground.

**The Weave** (Mesh) — 12,000 HP, 12 defense, 33 contact. Four geared nodes in a
diamond joined by tissue strands. Strand Lash snaps a strand taut, Node Pulse
bursts from every node at once, and Reform pulls any node below a quarter of its
share back into the formation to knit itself up — so focus fire is the slowest
way to kill it. At 50% a node is absorbed (its health moves into the survivors,
never wasted) and the remaining three go faster, sweep their tendrils in a
rotating arc, and add homing spores to every pulse.

### Balance, measured rather than guessed

The brief quoted movement in tiles per second (1.8 / 2.5 / 3.0). Taken literally
that is 29–48 px/s against a player who runs at ~150, which would make both
fights pure kiting, so the *tiers* were kept and mapped onto this engine's
scale. Three findings from instrumented playtests drove the rest:

- **The Weave could not hit a grounded player at all.** Both of its phase-one
  attacks are close-range by design, and the formation was hovering 108 px up
  and 146 px to the side — out of reach of both. It now comes down onto you.
- **Strand Lash landed on nothing.** A taut line between two fixed points is a
  line the player is almost never standing on. A whip does not stay between its
  ends: the strand now bows *through* the point it is aimed at when the target
  is within its capture radius, and the drawn curve is exactly the path that was
  tested for damage.
- **A grounded boss can be walked away from forever.** The Choir's arms reach
  further than its body can travel, its wail outruns a sprint, its smear takes
  the lane away rather than chasing, and it declares a tighter 26-tile arena so
  the standoff where nothing reaches you is also where it starts to enrage.

Measured against a stationary player in full Royal Chitin (28 defense), damage
taken per second: **Vespera 5.5**, **The Weave 19.9**, **The Hollowed Choir
29.5**. A player who moves and reads the wind-ups takes a small fraction of
that — at a 220 px engagement the Choir landed two hits in fifty seconds, but
either of them was half a health bar. Both fights run about two and a half
minutes on tier-11 gear.

One consequence worth recording: flat defense subtracts before the hit lands, so
Vespera's 13–16 damage projectiles do **1** to a player in her own drop set.
These two are the first bosses whose projectiles are worth dodging.

### Drops

The Choir gives Choir Remnants, the Hollowed Plate set and **The Hollow** (the
tier-12 mage weapon). The Weave gives Woven Tissue, the Frayed Plate set and
**The Mesh** (tier-12 ranged). The two armour sets are deliberately not the same
armour in two colours: Hollowed Plate completes into raw survivability
(+6 defense, +20 max health) and Frayed Plate into reach and footwork
(+10% ranged, +14% speed, an extra jump). Which evil your world rolled changes
how you fight, not just what colour you are.

---

## 4.1 — Quality of Realms

A patch pass driven by player feedback. The headline items were four bugs that
blocked play outright, and a cave generator that read as noise.

### Bugs that blocked play

- **Blocks could not be placed at all.** Placement was gated on the item's
  *category*, but every raw material that doubles as a block — dirt, stone,
  wood, sand, clay, snow, ice, sandstone, deepstone, blightstone — is category
  `material` carrying a `place` tile. So the blocks you actually mine were
  exactly the ones you could never place. It now gates on whether the item
  *has* a tile to place, which is what `canPlaceAt` and the Smart Cursor
  already did; all three finally agree.
- **Swords hit through solid rock.** The melee hit test was a pure
  radius-and-arc check with no terrain test at all. Melee now requires line of
  sight, sampled across several points of large targets so a boss leaning out
  of cover is still hittable. Two arcane blades declare `phasing` and may cut
  through stone — a stated weapon perk rather than an oversight.
- **Chopping one tree stripped its neighbour's canopy.** The leaf flood took
  every 8-connected leaf, so two trees whose canopies touched were one blob.
  The flood is now bounded to the felled trunk's own canopy footprint and
  rejects leaves held up by a different standing trunk.
- **A falling tree reverted to an older-looking model.** The topple animation
  drew `Sprites.getTile` — the flat fallback — instead of the neighbour-aware
  shaded trunk and canopy. Each cell's sprite selectors are now captured
  *before* the tiles are cleared.
- **Dropping items.** One at a time, and it flew straight back into the bag.
  You can now drop one, a chosen amount, or the whole stack, and a drop you
  threw refuses re-collection *by you* for a moment — anyone else can still
  take it, so passing items in co-op works.
- **Choppy hotbar scrolling.** Any wheel delta collapsed to ±1, so a mouse
  notch moved one slot but a trackpad flick moved fifteen. Deltas are now
  normalised to notches (handling `deltaMode`) and accumulated.

### Cave generation, rebuilt

The old generator sampled two ridged noise fields at the *same* frequency on
both axes, smoothed the result with a symmetric cellular automaton, and OR-ed
in fixed-radius worms. Isotropic noise has no reason to prefer horizontal
shapes, so it produced a chaotic field of bubbles; symmetric smoothing then
pinched off the narrow links between them; and nothing guaranteed the
survivors connected to anything. It read as "janky and all over the place"
because structurally that is what it was.

The rewrite is built around the qualities that make a cave system read as one:

- **Horizontally elongated, domain-warped noise.** x is sampled ~3× coarser
  than y and the sample point is displaced by a low-frequency warp field, so
  cavities come out as long bending ribbons rather than round blobs.
- **Depth profiles anchored to the surface line.** Three profiles — dirt,
  stone, cavern — interpolated by depth *below the grass*, so the shallow layer
  stays tight and the cavern layer opens up, with no row where the style
  visibly changes.
- **A wide smoothing kernel.** 5×3 rather than 3×3, so a horizontal corridor
  survives smoothing and only vertical speckle dissolves.
- **Tunnels with momentum.** Angular *velocity* with damping and a restoring
  pull toward horizontal, plus a radius that pinches and swells, so a passage
  commits to a direction instead of jittering.
- **Chamber clusters** built by walking a short path stamping overlapping
  discs, so rooms have lumpy organic outlines.
- **Sinkhole entrances** with a tapered throat, rather than 2-wide vertical
  shafts that read as mineshafts.
- **A connectivity pass** that fills isolated bubbles back in and bores
  meandering links between what remains.

Two subtle bugs worth recording, because both produced obviously artificial
output: vertical is an *unstable* fixed point of the horizontal restoring
torque (`sin(2a)` is zero there), so any tunnel launched straight down felt no
correction and bored a pin-straight shaft hundreds of tiles deep; and a
straight-line bore between two components is instantly readable as machine-made
next to organic passages.

Measured across 40 seeds: **13.7% / 29.1% / 34.5%** open by layer, **1.43×**
wider than tall, **100%** of underground air reachable from the surface,
**zero** sealed pockets.

### New systems

- **Flowing water.** A per-tile level with an active-set simulation, so a
  settled world costs nothing per frame. Pools are *found* rather than placed:
  flood-fill each enclosed basin from its floor and stop where it would spill.
  Mine into one and it drains. Swimming, and pails to carry it.
- **Fishing.** One button casts and reels. Rod tier, bait grade and pool size
  decide the loot table — a puddle is not a lake. Crates open into a rolled
  reward.
- **Wildlife.** Cows, pigs, sheep, rabbits, chickens and frogs graze and bolt;
  grubs, worms, crickets, beetles, emberflies and glowmoths are *caught* by
  clicking and serve as fishing bait. Glowing bugs are real light sources.
  Meat cooks at a Smeltery into food that heals and buffs.
- **Wind.** Blows from one side at a time on a slow seeded cadence. Foliage is
  sheared around its anchored edge — roots for a plant, the ceiling for a vine
  — so only the free end moves, phased by tile position so gusts travel across
  the world. Pushes the player gently on the surface; stops underground.
- **Flora.** Ten new plants with per-biome mixes. Corruption trees grow
  twisted, lurching side to side with bare branch stubs.
- **Characters.** Split out of worlds. A summoner owns its appearance,
  inventory and achievements and can be taken into any realm. Pre-4.1 saves
  migrate quietly: the newest world's embedded player becomes your first
  character, and the world saves keep their copy so rolling back loses nothing.
- **Achievements.** 22, stored per character.
- **Hammers.** A per-tile shape layer with real collision — half blocks and
  four slope orientations you can genuinely walk up — plus stripping walls.

### Feel and interface

- **Player animation.** One static pose became a walk cycle, jump and fall
  poses, a swim kick and an idle breath, all derived from actual state.
  **Armour is finally drawn on the character** in each piece's own colour.
- **Sword swings** sweep from wind-up to follow-through with a tapered trail,
  and the arc differs by weapon class: swords sweep, spears thrust, heavy
  weapons take a slow wide arc.
- **Gravemaw.** Its head was positioned from the bounding box while the body
  came from a separately-simulated trail, so the two came apart whenever it
  moved. The head is now the first link of the chain with fixed link lengths,
  plus anticipation before a leap, squash and dust on landing, and a jaw that
  snaps rather than eases.
- **Smart Cursor.** It "locked onto whatever" because it scored a 9×9
  neighbourhood around the pointer — a tile *behind* you could win on distance,
  and dragging gave a different answer every frame. It now walks the ray from
  the player to the cursor and takes the first useful tile, and while place is
  held it continues the run you are building, so dragging lays a straight
  gapless line.
- **Minimap.** Three sizes, draggable to pan, pinch or wheel to zoom, working
  identically under touch. Explored tiles are saved with the world.
- **Zoom.** `+` / `−`, Ctrl+wheel, pinch, or a settings slider — so the
  Grovekeeper flying off in phase two stays on screen.
- **Transparent pause.** A translucent side panel; the world keeps running and
  you can still move, mine and build.
- **Multiplayer.** The host panel gained the difficulty slider it never had — a
  hosted world silently inherited whatever the host was playing — plus world
  name and seed, a character preview, and a two-card layout.

### Tests

- `npm run check:worldgen` gained invariants for the new cave qualities: no
  isolated pockets, horizontal elongation, surface reachability, the depth
  profile, and that water is never inside rock or unsupported. The tree
  invariant became a *connectivity* test, because twisted trees have bare
  branch stubs and a branch legitimately has air under it.
- `npm run check:smoke` is new: it boots the real game in a headless browser
  and drives each system through the **actual input path** — mouse position and
  the primary button — rather than by calling internals. That distinction is
  the point. Every bug fixed above lived in the dispatch between an input and
  an action, so a test that called the action directly would have passed
  against the broken build. Writing it immediately caught that placement, the
  hammer, melee and casting were all still unreachable from a real click.

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
- 4.1: `/spawnfauna <animal> [n]`, `/water [r]`, `/dryup [r]`, `/wind [-1..1]`,
  `/achievements`, `/unlockall`

Content ids:

- Enemies: `slugling`, `husk`, `bonepicker`, `crawler`, `boar`, `blightshade`
  (aliases: slime→slugling, zombie→husk, skeleton→bonepicker, spider→crawler,
  pig→boar, ghost/caster→blightshade)
- Bosses: `grovekeeper` (Forest), `gravemaw` (Underground),
  `blightSovereign` (Corrupted Lands)
- Wildlife: `cow`, `pig`, `sheep`, `rabbit`, `chicken`, `frog`
- Bugs (fishing bait): `worm`, `grub`, `cricket`, `beetle`, `firefly`,
  `glowmoth`
