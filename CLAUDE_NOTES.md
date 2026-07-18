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

Version: **Stress-test pass #2 · 2026-07**

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
