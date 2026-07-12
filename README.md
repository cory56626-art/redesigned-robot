# Playable Dweller

An asymmetric horror add-on for Minecraft Bedrock: one player uses a Totem to
become **The Dweller** — tall, unnaturally thin, wide-smiling, with sunken
black eyes — and hunts the other players on the world. Everyone else plays
normal survivors. Built for stable **Minecraft Bedrock 1.21.70+**, no
experimental toggles.

Namespace: `dwl:`. Ships as two packs, zipped together into
`PlayableDweller.mcaddon` at the repo root — double-click it (or import it
from Minecraft) to install both.

## Table of contents

- [Version pin and why](#version-pin-and-why)
- [The Totem](#the-totem)
- [The transformation](#the-transformation)
- [Ability 1 — Super Run](#ability-1--super-run)
- [Ability 2 — Decoy](#ability-2--decoy)
- [Ability 3 — Horror Broadcast](#ability-3--horror-broadcast)
- [Global robustness](#global-robustness)
- [Replacing the placeholder art and sound](#replacing-the-placeholder-art-and-sound)
- [What I could and couldn't verify](#what-i-could-and-couldnt-verify)

## Version pin and why

| | Pinned | Reasoning |
|---|---|---|
| `min_engine_version` | `1.21.70` | See below |
| `@minecraft/server` | `1.18.0` | Matches 1.21.70 per Microsoft's [module→product version table](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/versioning) |
| All content `format_version`s | `1.21.70` | Uniform across the pack for simplicity; every feature used needs at most `1.20.60`-ish, so this has headroom |

Every API this pack relies on (entity properties, `applyImpulse`/
`applyKnockback`, `playMusic`/`stopMusic`, raycasting, dynamic properties, all
the lifecycle events) has been on the **stable, non-experimental** track
since `@minecraft/server 1.11.0` (Minecraft 1.21.0) — verified against the
real `.d.ts` shipped in each npm package, not from memory. The one feature
that forced a newer floor is `Player.spawnParticle()`, which the Decoy's
survivor-highlight needs so the marker is visible **only** to the Dweller.
That method doesn't exist on `Player` before `@minecraft/server 1.18.0`
(`1.17.0` only has it on `Dimension`, which is world-visible to everyone —
useless for a hidden marker). Since the highlight is one of the explicitly
tested behaviors, the pack targets `1.21.70+` rather than staying on `1.21.0`
for a lesser HUD-text fallback. If you need to support pre-`1.21.70` worlds,
see [Replacing the placeholder art and sound](#replacing-the-placeholder-art-and-sound)-adjacent
note in `decoy.js` — swap the `dweller.spawnParticle(...)` block for an
`onScreenDisplay.setActionBar()` readout and drop the version floor back to
`1.21.0` / `@minecraft/server 1.11.0`.

## The Totem

- `dwl:totem` is a plain data-driven item with **no recipe, no loot table
  entry, and no trade entry anywhere in the pack** — that omission is what
  makes it creative-only; there is nothing else to gate. It still appears in
  the creative inventory (`menu_category` category `equipment`) so a
  creative player can hand it to a survivor.
- Using it **toggles** the transformation; it is never consumed.
- **Two Dwellers**: fully independent. Each has their own puppet, cooldowns
  and abilities. They cannot grab each other with Super Run, don't count as
  survivors for each other's Decoy/Broadcast, and are simply skipped by both.
- **Death while transformed**: reverts to normal (see
  [Global robustness](#global-robustness) for exactly what "revert" tears
  down). Because the Totem is creative-only, permanently losing it to a
  death-loot drop would soft-lock that player out of the mode forever — so
  on death the world is swept for a couple of ticks to remove any dropped
  Totem/ability items, and a fresh Totem is handed back on respawn
  (`deathCleanup.js`). Ability items are **not** restored; they only ever
  exist while transformed. Known minor edge case: on a world with the
  `keepInventory` gamerule on, the original Totem never actually drops, so
  the respawn hand-back can leave a player holding two - harmless (Totems do
  nothing extra by existing twice), just not perfectly tidy.
- **Totem dropped/lost while transformed** (thrown away, put in a chest,
  `/clear`'d, given away, etc.): rather than hook every possible way an item
  can leave an inventory, the pack polls once a second — any transformed
  player who no longer has a Totem anywhere in their inventory or offhand
  reverts immediately (`transform.js#checkTotemPresence`). This uniformly
  covers every removal path, not just a few anticipated ones.

## The transformation

Bedrock has no player-morph API, so three known techniques exist, each with
a real weakness:

1. **Conditional `player.entity.json` geometry** — global to the resource
   pack, no supported way to switch it per-player, and it clobbers any other
   pack that also edits the player model. Ruled out.
2. **Attachable/equipment visual** while the real player is invisible —
   attachables are bound to attachment bones and their animation state
   machine is far more limited than a full custom entity's; getting a
   convincing walk/run/grab/spine-twist rig out of one is a fight against
   the format.
3. **Invisible player puppeteering a separate mob entity**, teleported to
   them every tick — the one this pack uses.

**Why (3):** it's the only option that gives a real, independently-animated
custom entity (`dwl:dweller_puppet`) with its own geometry, render
controller and full animation-controller state machine, while the actual
player keeps normal collision, fall damage, and hitbox semantics. The stated
weaknesses are handled directly:

- *Hitbox/nametag desync* — the puppet has a near-zero collision box and
  `has_collision:false`; it is purely a visual, teleported to the real
  player's exact location and rotation **every tick** (not on a timer), so
  there's no perceptible lag even during a 5× Super Run. No `minecraft:nameable`
  is ever set on it, so it never grows a floating name. The real player is
  given the vanilla `invisibility` effect for the whole duration of the
  transformation (`transform.js#applyBuffs`, re-applied every ~5s alongside
  the passive speed/health buffs from requirement 8 so it never lapses) -
  this hides their actual skin and their real nametag from every client,
  including their own. Critically, invisibility is a per-entity effect: it
  does **not**
  affect the puppet, which is a completely separate entity standing in the
  same spot - so what everyone (including the Dweller, in third person)
  actually sees at that location is the puppet, not a see-through gap or a
  double-render of the real skin underneath it.
- *Real player is still "a player" mechanically* — invisible or not, the
  real entity still has a normal hitbox and is a member of `family: player`,
  so raycasts/targeting that specifically hunt for players (rather than
  rendering) can still find them, and vanilla hostile mobs can still
  (rarely, per vanilla's own reduced-detection-of-invisible-entities rules)
  aggro onto them. This is accepted as normal vanilla behavior for an
  invisible player and not specially overridden.
- *Hostile mobs targeting the puppet* — the puppet's `minecraft:type_family`
  is `["dwl_puppet", "dwl_no_target"]`, deliberately **excluding** `player`
  (and `mob`), so vanilla `minecraft:behavior.nearest_attackable_target`
  filters (which key off `is_family: player`) never match it.
- *Conflicts with other packs* — nothing in this pack touches
  `player.entity.json`, so there is nothing to conflict with.

**Feedback to the Dweller themselves**: the puppet is a normal, fully-visible
entity to everyone including its owner, so switching to third-person (F5)
naturally shows the monster body where the player is standing. For a subtle,
non-third-person-dependent cue, the transformed player also gets a
persistent one-line actionbar HUD (refreshed once a second) showing
`THE DWELLER` plus each ability's ready/cooldown state — see
`transform.js#updateHud`. A one-shot title/subtitle also plays on the moment
of transformation.

**The model**: `models/entity/dweller.geo.json`, ~3.6 blocks tall
(legs 0–26px, waist 26–36px, chest 36–46px, head 46–58px at 16px/block),
exaggeratedly thin 2×2px arms reaching to knee height, a 12×12×12px oversized
head. The 64×64 skin (`textures/entity/dwl/dweller.png`) and all four item
icons are **procedurally generated placeholders** (see
[Replacing the placeholder art](#replacing-the-placeholder-art-and-sound)) —
pale, sickly, dark sunken eye sockets, a wide unsettling mouth — built with a
small Python/Pillow script, not copied from anything. Five animations exist
(`idle`, `walk`, `sprint`, `grab`, `spine_twist`) driven by two layered
animation controllers reading `dwl:move_state` / `dwl:action_state` — both
are real, `client_sync` **Entity Properties** set from script every time
they change (not every tick), which is the standard, stable way to drive
render-side state from server-side script state.

## Ability 1 — Super Run

Trigger: `dwl:ability_super_run` (granted only while transformed, see
[Global robustness](#global-robustness) for the "can't be lost on death"
mechanism).

- **~5× speed for 10s**, then a 20s lockout (30s total — matches the item's
  own `minecraft:cooldown` duration, which drives the client-side cooldown
  swirl; the server keeps its own authoritative timestamp too, so the swirl
  is a UX nicety, not the actual gate).
- **Block breaking**: every tick, probes a small box (±1 block either side,
  4 blocks tall, up to 2 blocks ahead of the player's current velocity/view
  direction) and instantly sets matching blocks to air — **capped at 6
  blocks per tick** regardless of how many are in range, so a Dweller can
  never spike server load by charging into a huge structure at once.
  **No item drops**, by design — it's cheap (no item-entity spam while
  charging) and it isn't a resource-farming exploit. An explicit unbreakable
  list covers bedrock/barriers/portals/command &structure blocks, plus (a
  deliberate extension beyond the minimum) all containers, furnaces,
  hoppers, dispensers and the beacon/spawner/ender chest, so a charge can't
  grief someone's storage room. Liquids are never targeted (charging into
  water/lava just applies normal swim/burn physics — no special immunity).
- **Collision grab**: closing to within ~1.7 blocks of any player or
  non-player living entity ends the run and grabs them (excluding: the
  Dweller's own puppet/decoy, other transformed Dwellers, and creative/
  spectator players — none of those are "victims"). The victim is
  re-teleported in front of the Dweller for 1.2s (a visible "hold"), then
  thrown.
- **Throw physics**: the pack uses `Player.applyKnockback(dirX, dirZ,
  horizontalStrength, verticalStrength)` for player victims and
  `Entity.applyImpulse({x,y,z})` for everything else. What's confirmed
  directly from the real `.d.ts`: both methods are declared once on the base
  `Entity` class and `Player` doesn't override either, so both are *typed*
  as available on a `Player`. What's **not** independently verifiable
  without a live client: long-standing, widely-reported Bedrock scripting
  behavior holds that `applyImpulse` is unreliable on an actual `Player`
  instance (player movement is more client-authoritative than mob movement),
  while `applyKnockback` has always been the dependable path for players —
  which is exactly the split the task brief flagged. The code follows that
  split and wraps both calls in `try/catch` as a safety net either way.
  The launch constants (`THROW_HORIZONTAL_STRENGTH` / `THROW_VERTICAL_STRENGTH`
  in `config.js`) are tuned from standard Minecraft motion constants
  (~0.08 gravity, ~0.98 per-tick drag) to land a roughly 50-block arc, but
  there is no way to fully verify the real in-game trajectory without a live
  client — **these two constants are meant to be tweaked to taste**;
  turning `THROW_VERTICAL_STRENGTH` down gives a flatter, shorter, less
  damaging throw.
- **Fall damage is intentional and not suppressed.** A ~50-block arc throw
  is typically lethal from full health. That's the point — being grabbed is
  meant to be genuinely dangerous, not a gag. Document this for your players.
- **Edge cases**: grabbing another Dweller never happens (filtered out
  above — they just collide like normal entities). A creative/spectator
  bystander is never grabbed. Running into the void or water applies
  whatever vanilla physics normally would — no special-casing. If the
  victim disconnects mid-hold, the hold loop detects the invalid reference
  next tick and releases cleanly with **no throw** (see `superRun.js#tickHold`).

## Ability 2 — Decoy

Trigger: `dwl:ability_decoy`, a real `dwl:decoy` entity sharing the Dweller's
model. Only one may exist per Dweller — casting again despawns the old one
first. It expires after 60s on its own.

- **Trolling** (while unwatched): vanilla `minecraft:behavior.random_stroll`
  handles wandering; script layers in occasional short sprint bursts
  (~8%/check), ambient footstep/knock/distant-ambience sounds on a random
  5–15s cadence, and a rare (~5%/check) "freeze and stare at the nearest
  door within 6 blocks" beat, all via `world.playSound`/property/
  component-group toggles. **It is entirely non-destructive** — it has no
  door-opening behavior, no attack, no block interaction of any kind. That
  is a deliberate scope decision: the decoy is atmosphere, not a second
  physical threat.
- **Visibility check**: rather than modeling "the decoy sees a survivor" and
  "a survivor sees the decoy" as two different systems, the pack treats
  unobstructed line-of-sight as symmetric — one raycast
  (`Dimension.getBlockFromRay`) per nearby survivor per check, gated to
  every 5 ticks and a 24-block radius so it stays cheap. The same result
  answers both "should it stop trolling because it's watched" and "should
  it scream because it can see someone."
- **On sighting**: turns to face the survivor, plays the `spine_twist`
  animation + `dwl.scream` sound (audible to everyone nearby, not hidden),
  and for the next 7 seconds marks every survivor within radius of the
  decoy with a short particle column (`minecraft:soul_particle`) spawned via
  **`Player.spawnParticle()` called only on the real Dweller's `Player`
  object** — a genuinely per-player call, so survivors never see their own
  marker (this is why the pack needs `@minecraft/server 1.18.0`+, see
  [Version pin](#version-pin-and-why)).
- **Never confused with the real Dweller**: the Horror Broadcast distance
  counter, and every "who counts as a survivor" filter, reads
  `state.player` (the real Dweller) exclusively. The decoy is a completely
  separate entity identifier (`dwl:decoy` vs `dwl:dweller_puppet`) that
  nothing else in the codebase treats as "IT".
- **Owner disconnects**: `playerLeave` reverts the Dweller, which despawns
  their decoy immediately (see [Global robustness](#global-robustness)).

## Ability 3 — Horror Broadcast

Trigger: `dwl:ability_broadcast`. Long cooldown (25s effect + 75s lockout =
100s total, matching the item's own cooldown component).

- **Scope decision**: hits every survivor **sharing the Dweller's current
  dimension** at the moment of activation (not a radius — distance across
  dimensions is meaningless anyway, and a radius number would arbitrarily
  exclude people for no good reason on a small map). It's a snapshot: a
  player who changes dimension mid-broadcast has their effect cleanly ended
  early (distance no longer makes sense for them); a player who joins the
  dimension after the cast is **not** retroactively added.
- **Darkness, not Blindness** — both read as "scary" per the brief; Darkness
  was chosen because it's the Warden/Deep-Dark signature effect (thematically
  the closer match to this concept) and impairs vision without the fully
  disorienting white-out some players find frustrating rather than scary.
  Swapping to `"blindness"` in `broadcast.js` is a one-line change if you
  prefer it.
- **Display surface**: a one-shot `title`/`subtitle` ("HIDE" / "It has
  awoken...") fires once at the start for dramatic weight, then the
  continuously-updating distance counter moves to the **actionbar**
  (updated every 10 ticks / 0.5s, not every tick) specifically because
  re-issuing a `title` at high frequency flickers and steals focus —
  `setActionBar` is the surface built for frequent updates. The counter is
  rounded to the nearest block (`Math.round`) — raw decimals were explicitly
  flagged as immersion-breaking.
- **The Dweller gets none of this** — no darkness, no HIDE text, no counter;
  the loop only ever iterates the `affected` survivor set, which never
  includes the Dweller or any other transformed player.
- **The signature flourish**: once at cast time, the Dweller's puppet plays
  the `spine_twist` animation and a `dwl.bone_crack` sound plays audibly
  near the Dweller (a normal dimension-wide `playSound`, not per-player —
  this one *should* be heard by anyone nearby).
- **Cleanup is centralized** in one `forceEndBroadcast()` used by both the
  natural 25s timeout and every early-abort path (Dweller reverts, dies, or
  disconnects) — removes the effect, calls `stopMusic()`, and clears the
  actionbar with an empty string, for every still-valid survivor in the set.
  A survivor who disconnects mid-broadcast is pruned from the set on the
  next update tick rather than erroring. As a last line of defense, every
  player who joins/respawns gets a one-time defensive `removeEffect("darkness")`
  + `stopMusic()` on `playerSpawn`, in case a disconnect ever raced the
  per-player cleanup.
- **Music**, not looped `playSound`: `Player.playMusic(id, {loop:true})` /
  `Player.stopMusic()` is the API built specifically for a start/stop-once
  looping track, which is exactly what "stuck music must never survive a
  cleanup bug" needs — one call ends it, full stop, versus manually
  re-triggering a sound event that keeps re-scheduling itself.

## Global robustness

- **One state object per player** (`DwellerState` in `state.js`):
  `transformed` (bool) and `phase` (`idle | super_run | grabbing |
  broadcast`). `DwellerState.canStartAbility()` is the single gate every
  ability's start path and the item-use dispatcher call — nothing can start
  unless transformed **and** `phase === "idle"` **and** its own cooldown has
  elapsed. All cooldowns are stored as absolute tick numbers compared
  against `system.currentTick`, so nothing depends on wall-clock time.
- **Dweller disconnects mid-anything**: `playerLeave` calls the same
  `revertPlayer()` used by the manual toggle — it force-ends Super Run
  (releasing any held victim in place, no throw), force-ends Broadcast
  (cleaning up every affected survivor), despawns the decoy, and despawns
  the puppet, all before the in-memory state is discarded. On reconnect
  they are a normal survivor (see persistence decision below) — no zombie
  puppets, no permanently-held victims.
- **Survivor disconnects while grabbed**: the hold loop revalidates the
  victim reference every tick (`try { victim.isValid() }`) and releases
  cleanly with no throw the moment it goes invalid.
- **Survivor disconnects while highlighted/broadcast-affected**: the
  Decoy's highlight target list is re-queried fresh every check (a
  disconnected player simply stops appearing), and the Broadcast's affected
  `Set` is pruned of invalid entries on every update tick.
- **World restart / persistence**: transformation state is **deliberately
  not persisted**. On every `playerSpawn` the pack does a defensive reset
  (strip stray ability items, clear `darkness`, stop music) rather than try
  to reconstruct puppets/decoys/timers from a cold dynamic property after a
  restart — those runtime entities wouldn't survive a raw restart in a
  valid state anyway. A returning Dweller keeps their Totem and just uses it
  again. The one thing that *is* persisted is a tiny dynamic property
  (`dwl:pending_totem_return`) marking "give this player back a Totem next
  spawn" — set only when a transformed death swept their Totem out of the
  world, and deliberately durable across a disconnect that happens to land
  between death and respawn.
- **Performance budgets** (all in `config.js`): puppet teleport/rotation
  sync is the only truly per-tick, per-Dweller cost (and it's O(number of
  active Dwellers), which is small). Block-breaking is capped at 6/tick.
  Decoy AI and Horror Broadcast counters run every 5–10 ticks, not every
  tick, and only ever scan players within an explicit radius via
  `getEntities`/`getPlayers` filters rather than scanning the whole world.

## Replacing the placeholder art and sound

Everything visual and audible in this pack is original but programmatically
generated, exactly as the brief allows, and is structured so it's a drop-in
swap:

- `PlayableDweller_RP/textures/entity/dwl/dweller.png` — 64×64, standard
  box-UV layout matching `models/entity/dweller.geo.json` (head at UV 0,0;
  lower torso at 0,24; upper torso at 24,24; arm at 48,0; leg at 48,34).
  Replace with hand-painted art at the same resolution/UV layout and nothing
  else needs to change.
- `PlayableDweller_RP/textures/items/*.png` — 16×16 icons, swap freely.
- `PlayableDweller_RP/sounds/dwl/*.ogg` — synthesized tones/noise (see
  generation notes in the repo's build scripts), wired correctly through
  `sound_definitions.json`. Replace the six files (scream, bone_crack,
  footstep, knock, ambience, hunt_theme) with your own or freely-licensed
  `.ogg` audio of a similar rough length; no JSON changes needed as long as
  filenames match.

## What I could and couldn't verify

This was built and validated without a live Minecraft client:

- Every JSON file parses (validated programmatically).
- Every JS file is syntactically valid and the **entire local module graph
  actually links** against a structural mock of `@minecraft/server` (Node's
  ES module linker verifies every cross-file `import`/`export` name is
  real — this catches typos with certainty, not just by inspection).
- Every cross-reference between scripts and content — item/entity
  identifiers, entity property names and enum values, entity event names,
  sound event names and file paths, animation/controller/geometry/texture
  identifiers, item icon keys, and the BP↔RP manifest UUID dependency — was
  checked programmatically against the actual files, not by memory.
- All API signatures (`applyImpulse`/`applyKnockback`, `playMusic`,
  `spawnParticle`, raycasting, entity properties, cooldown components, item
  menu categories, etc.) were verified against the real `.d.ts` shipped in
  the pinned `@minecraft/server` npm package and Microsoft's official
  reference docs, not recalled from training.

What I **couldn't** do without a live two-player Bedrock session: confirm
the exact feel of the 5× speed / throw arc, watch the content log during
actual import, or run the seven acceptance tests end to end. Please run
those before trusting this in front of friends — start with #1 (Totem
transforms/reverts and the model/animations render correctly on a second
client) and #7 (clean content log), since those two would surface any
remaining JSON/asset mistake fastest.
