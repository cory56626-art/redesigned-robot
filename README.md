# The King Dweller — Boss Upgrade

Personal-use modification of *The King Dweller by PnTMC* (credits to PnTMC and Flamc04 for the
original add-on — kept intact in both manifests). On top of the original pack:

1. The King is now ~2x its previous visual size.
2. It has a six-ability combat kit that turns it into a real boss fight.
3. Every ability and its normal melee attack can be used on **any mob that attacks the king**,
   not just players — the king still only *hunts* players on its own.
4. Every ability has a `/scriptevent pntmc:<ability>` command to trigger it on demand for testing.

Both packs keep their original UUIDs (so this updates in place over the original install) and
were bumped to version `1.1.0`. The BP gained a `script` module; nothing else about how the pack
loads changed, and `min_engine_version` stays `1.21.0`.

## Size (Requirement 1)

- RP `scripts.scale` on `pntmc:king`, `pntmc:king_trigger`, `pntmc:king_flee` went from `1.25` →
  `2.5` (exactly 2x the old value, applied identically to all three so the trigger→king→flee
  transformations never pop). `pntmc:king_ambient` is a separate invisible sound-effect prop, not
  part of that transformation chain, so it was left alone.
- `minecraft:collision_box` (0.5×0.9) is **unchanged on purpose** — it's what lets the king path
  through a 1-block gap, and the crawl/crouch tick function's block checks assume it. Scaling it
  would break tunnel-chasing.
- `minecraft:custom_hit_test` doubled (1.0×2.0 → 2.0×4.0, pivot raised to match) on `king` and
  `king_trigger`, and was newly added to `king_flee` (which had none before, and would have looked
  more wrong at 2x scale than at the old one). This scales the *clickable* hitbox in step with the
  visual without touching physical collision.
- `melee_attack.reach_multiplier` doubled (3 → 6) so the king's swing visually reaches as far as
  its now-2x-longer arms look like they should, without changing its (still tiny) collision box.

## Ability arbitration (designed before any individual ability)

Every `pntmc:king` entity carries a dynamic property `pntmc:ab` — the single source of truth for
"what is this king doing right now" (`idle`, or one phase of one ability). Rules, enforced in
`scripts/abilities.js`:

- Every ability is a tiny state machine that advances by comparing `system.currentTick` against a
  stored end-tick, also stored on the entity — never a bare `setTimeout`-style callback that could
  outlive a reload.
- A new ability can only start when `pntmc:ab === 'idle'`. Nothing can interrupt an ability in
  progress, and nothing else can start while one is running.
- Starting *any* ability stamps a short global cooldown (5s, 3s enraged) that blocks the *next*
  ability too, on top of that ability's own longer per-ability cooldown. That's what keeps the kit
  feeling punctuated instead of spammy.
- No ability can start while `is_ignited` (crawling), `is_sheared` (crouching), or `is_saddled`
  (spotted-stare) is present, and every code path is gated on `typeId === 'pntmc:king'` — the
  trigger/flee/ambient variants never touch this system at all.
- Enrage is the one exception: it's a passive, *permanent* stat/visual layer, not a phase, so it
  intentionally sits outside the `ab` state machine and stacks with whatever ability is active.

**Why script-driven state instead of another flag component or an entity-properties format bump:**
the pack already spends its few free vanilla boolean flags (`is_ignited`/`is_sheared`/`is_saddled`)
on crawl/crouch/spotted, and six more abilities would either exhaust the remaining ones or need
entity properties, which need `format_version` ≥ 1.19.70 on a 2019-era behavior file that a lot of
other logic depends on. Since a script had to be added anyway (see below — it's the only way to
set player velocity), all six abilities keep their state in **script-side dynamic properties**
instead, which need no format bump and don't touch the vanilla flags at all. The one exception is
Enrage, which reuses the same proven flag-hijack pattern as the existing crawl/crouch/spotted code
(`minecraft:is_charged`, otherwise completely unused by this pack) because it's BP-native,
permanent, binary, and needed no script involvement to detect at all (see Enrage below).

**How the king plays a special-move animation without any new client-visible state:** each ability
animation is triggered directly with `entity.playAnimation()` at the moment it's needed. A
script-triggered animation overrides the entity's regular locomotion controller for as long as it
plays, then hands control back — so none of the RP animation controllers needed new states or new
Molang queries, and the client never needs to be told "which ability" is happening at all.

## Any mob that attacks the king (not automatic, not players-only)

The king must **not** go out of its way to pounce on/screech at/burrow-ambush a cow or a zombie
that never did anything to it — it should keep hunting only players on its own, exactly like the
original pack, but be able to bring its *full kit* to bear (not just a melee swing) against
whatever actually attacks it. Three pieces make that true:

- **BP (normal melee hunting): unchanged from the original pack.**
  `minecraft:behavior.nearest_attackable_target`'s filter is back to `is_family == player` — the
  king only proactively searches for and chases players, same as before this mod.
- **BP (melee retaliation): already unrestricted, untouched.** `minecraft:behavior.hurt_by_target`
  has no `entity_types` filter, so it was *always* the case — even in the original pack — that the
  king would swing back at whatever damaged it, mob or player. That behavior alone already
  satisfies "fight back if provoked" for plain melee; nothing needed to change there.
- **Script (the ability kit): a short-lived "provoked" memory, fed by two listeners.**
  `util.js#markProvoked(king, attacker, now)` remembers an attacker for 15 seconds, and
  `util.js#findAbilityTarget(king, maxDistance, now)` is what `abilities.js#tickKing` polls every
  pass to decide who's eligible for automatic Pounce/Screech/Burrow triggering: any nearby player
  (unchanged hunting behavior) **plus** the currently-remembered attacker, even when it isn't a
  player. A mob that never landed a hit on the king is never a candidate here, no matter how close
  it stands or how long it's watched. Two separate `main.js` listeners feed `markProvoked`, on
  purpose:
  - `world.afterEvents.entityHitEntity` fires when the *king* is the one hit by an actual melee
    swing connecting.
  - `world.afterEvents.entityHurt` fires for **any** damage the king takes, however it was dealt —
    melee, projectile, a `/damage` command, or another mod's own scripted `applyDamage()` call.
    This one was added because `entityHitEntity` alone turned out to be too narrow: a third-party
    "make mobs fight" tool is far more likely to deal damage straight through `applyDamage()`/a
    command than to simulate an actual melee-swing connection, so relying on `entityHitEntity`
    alone meant the king could take real damage from such a mod and never register it as an
    attacker worth fighting back against — no provocation was ever recorded, so
    `findAbilityTarget` kept returning nothing for that mob and the king had nothing to do but
    stand there. Both listeners funnel into the exact same `markProvoked` call, so whichever one
    fires first wins and neither is required on its own.

  `isValidMobTarget(entity)` (reject the pack's own four typeIds, then require
  `hasComponent('minecraft:health')` — the one thing every real creature has that item
  drops/projectiles/boats/minecarts/etc. don't) is still the underlying "is this even a legitimate
  creature" sanity check on both listeners, now just gated behind provocation for anything
  non-player. Grab doesn't need any of this — it only ever triggers off a melee hit the king
  already landed, which by the two BP behaviors above is already correctly scoped to
  players-it's-hunting or attackers-it's-retaliating-against.
- AOE splash (pounce landing, screech burst, burrow erupt) still hits *any* valid mob caught in
  the blast radius, not just the primary target — that's an incidental side effect of an ability
  that was already legitimately triggered against a real target, the same way a ground-slam would
  catch bystanders in any other game, not the king independently deciding to attack them.
- A few pieces stay player-specific **by nature**, not by restriction, and degrade gracefully
  (existing try/catch no-ops) when the target isn't a player: the actionbar Bleed readout, the
  milk-bucket cure, `inputPermissions` movement-locking during a grab, and `/camerashake` during a
  screech. None of those exist on a generic mob, but none of them are load-bearing for the
  mechanic to still work on one either — a grabbed, provoking zombie is still teleport-anchored and
  thrown or bitten identically to a player, it just never gets an actionbar message.
- Grab tracking is a small in-memory `Map<targetId, kingId>` (`abilities.js`'s `grabbedTargets`)
  populated on grab-start and consulted by `reconcileGrabs()`, rather than scanning
  `world.getPlayers()` every tick, since the held target can now be any entity, not only a player.
- The `/scriptevent` test commands (below) deliberately **bypass** the provoked requirement, the
  same way they bypass chance/cooldown/range — they use the broader `findNearestMob` (any valid
  mob nearby) rather than `findAbilityTarget`, since a manual test command shouldn't require first
  provoking a mob just to verify an ability still works. They still refuse to fire while the king
  is crawling/crouching/spotted.

## Script API version

Commands cannot set an entity's velocity in Bedrock (no `/tp` delta, no velocity NBT command), so
the throw, the pounce leap, and all knockback in this pack go through `@minecraft/server`
(`Entity.applyKnockback` / `Entity.applyImpulse`). The module version is pinned to `1.11.0`,
which is the exact stable version shipped with Minecraft **1.21.0** — the pack's own floor — so it
resolves correctly across the entire `1.21.0 – 1.21.100+` range the pack advertises (Minecraft
keeps older stable-track API versions working on newer game versions). Every API call in
`scripts/` was checked against that specific floor, not just "some version":

- `Entity.applyKnockback(directionX, directionZ, horizontalStrength, verticalStrength)` — the
  4-number form. It's replaced by a `(VectorXZ, verticalStrength)` form starting at API `2.0.0`,
  which is still beta as of `1.21.70` previews and nowhere near this pack's floor.
- `Entity.isValid()` is a **method** at this version (`entity.isValid()`), not the property it
  becomes at API `2.0.0`.
- `Player.inputPermissions` doesn't exist until API `1.12.0` (Minecraft 1.21.10) — ten patch
  versions above this pack's floor. It's feature-detected (`if (player.inputPermissions)`) and
  used only as an enhancement; the actual "player can't walk away" guarantee during a grab is a
  per-tick teleport anchor, which works on every version in range.
- `Dimension.getTopmostBlock` needs API `1.13.0` (Minecraft 1.21.20) — also above the floor — so
  burrow's ground-finding is a manual downward block scan instead (`util.js#findGroundY`).
- Camera shake for the screech uses the stable `/camerashake` command via `Entity.runCommand`, not
  the scripted `Camera.addShake`, which is still in `2.10.0-beta` territory.
- The king applies its own pounce-leap velocity with `applyImpulse`, not `applyKnockback` — the
  king has `knockback_resistance: 1` so players can't stagger it, and impulse is the one that isn't
  documented as going through that resistance calculation.

All of the above (plus the whole ability state machine) was run against a mocked
`@minecraft/server` module outside of Minecraft to exercise every phase transition end-to-end
before packaging — see the "Testing performed" section at the bottom.

## The six abilities

All cooldowns shorten to ~60% and the global cooldown drops from 5s to 3s once enraged.

### 1. Grab & Throw
- **Trigger:** on a landed king melee hit against any valid mob target (`world.afterEvents.entityHitEntity`,
  filtered through `isValidMobTarget` — see "Any mob that attacks the king" below), 25% chance, own
  30s cooldown.
- **Flow:** `grab_windup` (0.4s, arms raise) → `grab_hold` (2s: the target is teleport-anchored to
  a fixed point in front of the king every tick, with movement input locked where the target is a
  player — the king stands still) → **either** `grab_throw` **or** `grab_bite` (55%/45% split,
  rolled once the hold ends).
- **Throw:** velocity is set with `applyKnockback` (strength tuned for a ~18+ block arc, up from an
  initial tune that turned out to be a "gentle tap" in practice — `THROW_HORIZ_STRENGTH`/
  `THROW_VERT_STRENGTH` in `abilities.js`); actual
  injury comes from vanilla fall damage on landing, not a direct hit — works identically whether
  the target is a player or any other mob.

### 2. Grab & Bite → Bleed
- Same grab entry point as above; the 55% branch. The main head/neck/jaw (the un-suffixed
  `head`/`neck`/`jaw` bones — the front-facing one) lunges and snaps shut ~0.3s into the animation,
  dealing 8 damage and applying Bleed.
- **Bleed:** works on any mob (see below), not just players. 10s duration, 2 damage every 2s (5
  pulses, 10 potential damage). Re-biting a bleeding target **refreshes** the 10s window instead of
  stacking — it can never run two DoT sources at once or extend past 10s from the moment of the
  freshest bite. **Cannot kill on its own** — each tick's damage is clamped so health never drops
  below 1; it can put a target on the edge for a follow-up hit to finish, but the tick itself never
  does. Cured by drinking milk (players only, obviously), or by the 10s timeout, or implicitly by
  death. Visible as red dust particles trailing the target plus an actionbar countdown when the
  target is a player. Dynamic properties persist through a same-session relog, so disconnecting
  doesn't stop the clock or cure it; a full world/server restart resets the tick counter and the
  now-stale end time gets clamped away by the same safety net that stops any stuck state from
  surviving a reload (see below) — not a realistic exploit, since it needs restarting the world.

### 3. Pounce
- **Trigger:** target 5–20 blocks away, 15% chance rolled once a second, 14s cooldown.
- **Flow:** `pounce_windup` (1.1s crouch-coil — long enough to sidestep) → leap
  (`applyImpulse`, not `applyKnockback` — see above; strengthened alongside the throw, since the
  same "impulse strength doesn't map to distance the way you'd guess" surprise applied here too)
  → land on ground contact (min 0.2s airtime, hard 2s cap so it can never get stuck mid-air) →
  2.5-block AOE damage/knockback/slowness.
- Landing in water/lava fizzles (no AOE) rather than looking silly; landing near nobody just does
  nothing extra — both are the "expected" outcomes, not special-cased failure states.

### 4. Petrifying Screech
- **Trigger:** target ≥6 blocks away (never point-blank), 15% chance rolled once a second, 25s
  cooldown.
- **Flow:** 2.5s animation, all three heads rear back and roar. Everyone within 15 blocks gets
  blindness, darkness, nausea, a short slowness, and `/camerashake`. The king is frozen (`slowness`
  amplifier 255, same idiom the pack already uses for the spotted-stare freeze) but **not**
  invulnerable — it's a trade, not a free hit.

### 5. Burrow Ambush
- **Trigger:** target out of line-of-sight or beyond 22 blocks continuously for 4s, 30s cooldown.
  LOS is a manual raycast (`Dimension.getBlockFromRay`) between head positions, since
  `must_see: false` means the vanilla AI keeps its target through a broken LOS and `has_target`
  alone can't detect it.
- **Flow:** `burrow_dig` (1s, particles + the existing disappear sound) → `burrow_under`
  (invisible + `resistance` amplifier 255, i.e. unseen and untouchable, for a randomized 1.5–3s) →
  teleport near the target and `burrow_erupt` (particle burst + roar + a short lunge hit).
- **Both of this pack's specific traps were designed around, not just avoided by luck:** the same
  king entity instance is teleported the whole time — never despawned, resummoned, or transformed.
  That means `query.life_time` (which the disappear-timer animation controllers key off) is never
  reset, and the `spawnonlyone` tag from `pntmc_runInterval_king.mcfunction` is never dropped, so
  the re-emerged king can't be killed by its own one-instance housekeeping. The AI target is never
  cleared either, so `has_target` stays true and the unrelated life_time-based disappear controllers
  don't fire mid-burrow.

### 6. Enrage
- **Trigger:** BP-native `minecraft:environment_sensor` filter (`actor_health <= 60`, i.e. 30% of
  200 max HP) — no script polling needed to detect it at all.
- **Effect:** adds component group `pntmc:enrage` — `minecraft:is_charged` (repurposed exactly
  like `is_ignited`/`is_sheared`/`is_saddled` already are; this component has no built-in visual
  effect on a custom render controller, so it's a free permanent flag) plus movement 0.56→0.75 and
  attack damage 6→10, all through the vanilla component-group system. Nothing ever removes this
  group, so it's permanent for the fight and untouched by the crawl/crouch groups toggling on and
  off (no flicker). Script reads the same flag to shorten cooldowns and to drive a periodic flame
  particle aura plus a one-time announce burst/sound — both are independent of the RP animation
  state, so they don't care whether the king is currently crawling, crouching, or mid-ability.

## Fixed: king takes damage but doesn't actually fight back

This is the one that actually matters for "why won't it fight" — a grace period (below) only
changes how long the king survives with nothing to do; it can't by itself make the king do
anything. Two separate bugs combined to produce the "jumpscare, stand still, go invisible, never
attacks" symptom, and both had to be fixed for damage from something other than a player to
actually turn into a fight:

1. **Provocation detection was melee-swing-only.** The only signal that told the king "something
   just attacked you" was `world.afterEvents.entityHitEntity`, which fires strictly for an actual
   melee swing connecting. Damage delivered any other way — a `/damage` command, a projectile, or
   (most likely, for a "make mobs fight" tool) another mod's own scripted `Entity#applyDamage()`
   call — never fires it, so `markProvoked` was never called, the attacker was never remembered,
   and `findAbilityTarget` kept returning nothing for it no matter how much damage the king took.
   No provocation means no valid target means no ability, no matter how many times it gets hit.
   **Fixed** by adding a second, broader `world.afterEvents.entityHurt` listener in `main.js` that
   fires for *any* damage the king takes and also calls `markProvoked` — see "Any mob that attacks
   the king" above for both listeners together.
2. **The previous lost-target fix risked suspending the king's own AI.** The grace-period signal
   (see below) was originally implemented by toggling `minecraft:is_stunned` on the king. That was
   picked by analogy to the pack's other harmless flag components
   (`is_ignited`/`is_sheared`/`is_saddled`/`is_charged`, all reused elsewhere in this pack purely
   as inert markers) — but `is_stunned` is not obviously inert. It's plausibly the same
   engine-level state Wardens and Ravagers use to actually freeze in place, which would mean
   *this pack's own previous fix* could have been the direct cause of "stands still and does
   nothing" — flagging the king as stunned the instant it lost `has_target`, independent of
   whether it had just been provoked by something worth fighting. **Fixed** by removing
   `is_stunned` entirely; see below for what replaced it. Nothing in the current pack sets or
   reads `minecraft:is_stunned` anywhere.

Neither fix can be verified against a specific third-party mod without an actual in-game test —
there's no way to run Minecraft in this environment — but both are aimed squarely at the mechanism
a script-driven "make mobs fight" tool would actually exercise (damage via `applyDamage()`, not a
melee swing) and at removing the one component change in this pack's own history that could have
been actively fighting against that goal.

## Fixed: near-instant despawn when no player is around

Separately from the above — this one only controls how *long the king waits* before giving up,
not whether it fights in the meantime. The original pack's
`controller.animation.king_disappear_akp_PNTMC` despawned the king the moment `query.has_target`
went false (after an initial 5-second grace from spawn) — fine in normal play, since a player is
essentially always available to be re-acquired as a target, but with no player anywhere nearby
(e.g. testing mob-vs-mob combat), the instant whatever provoked the king was gone, `has_target` had
nothing left to fall back to and the king vanished almost immediately.

Fix doesn't literally despawn on losing a target anymore - it starts a real 30-second grace period
first, signaled with a plain `/scriptevent` rather than any vanilla component:

- The animation controller still detects the `has_target` transition (only Molang can see that;
  script can't without API 2.10-beta), but now reports it to script with a bare
  `/scriptevent pntmc:losttarget -` / `/scriptevent pntmc:foundtarget -` fired from its own
  `on_entry`/`on_exit` (wired up in `main.js`) instead of touching any component at all.
- `main.js` routes those two events to `abilities.js#markLostTarget` / `#markFoundTarget`, which
  just stamp plain dynamic properties (`pntmc:hasNoTarget`, `pntmc:noTargetSince`) — inert data,
  nothing the engine or any AI behavior reads or reacts to. `abilities.js#tickLostTargetGrace`
  (script-side, called every `tickKing` pass) watches those properties and counts the real 30
  seconds itself using the same dynamic-property/`system.currentTick` approach as everything else,
  firing `pntmc:vanish` (which still runs the original `king_disappear_pntmc` cleanup function)
  only if the king truly never re-engages anything for the whole window. Re-acquiring any target
  within the 30s - a player wandering by, or anything landing a hit and getting remembered as
  provoked - clears it and cancels the countdown, no despawn.
- `minecraft:timer` was deliberately avoided for this countdown - crawl/crouch already drive that
  single shared timer slot every tick they're active, so a long grace timer sharing it would get
  reset to their 1-tick value constantly whenever the king lost its target while also
  crawling/crouching (a very plausible combination). Dynamic properties don't have that problem
  since each key is independent.
- This only touches `king_disappear_akp_PNTMC`; the other one (`king_disappear_timer_PNTMC`, an
  unconditional ~100-second-of-existence check) was left exactly as it was, since it isn't what's
  responsible for the reported near-instant vanish and touching it wasn't necessary to fix that.

## Edge cases

- **Target disconnects (if a player) or is otherwise removed mid-grab:** the per-tick anchor loop
  detects the missing entity within one tick-loop pass (≤2 ticks) and both releases the lock and
  ends the ability immediately — it doesn't wait out the phase timer.
- **King dies or transforms (flees) mid-ability:** an `entityDie` listener releases any held target
  immediately as a fast path; a `reconcileGrabs()` pass every tick loop is the guaranteed backstop
  that catches every other disappearance cause (transform, admin `/kill`, etc.) within a couple of
  ticks regardless of what caused it — it works off the tracked `{targetId → kingId}` pair directly
  rather than scanning the world, so it doesn't depend on the target being a player either.
- **World/server reload mid-ability:** every stored tick timestamp (`abEnd`, per-ability
  cooldowns, the global cooldown) is read through a sanity clamp that treats a value unreasonably
  far in the future as already-expired. `system.currentTick` resets on a process restart, which
  would otherwise either strand an in-progress phase forever or leave abilities looking
  permanently on cooldown; this makes both self-heal within one tick-loop pass with no dedicated
  world-load hook needed. Burrow's invisibility/resistance are also always applied with a bounded
  duration slightly longer than the phase itself, so even in a worst case they expire on their own.

## Known scope decisions

- Bleed's particle trail and the enrage aura use vanilla built-in particle effects
  (`minecraft:redstone_wire_dust_particle`, `minecraft:basic_flame_particle`,
  `minecraft:knockback_roar_particle`, `minecraft:huge_explosion_emitter`,
  `minecraft:falling_dust_gravel_particle`, `minecraft:critical_hit_emitter`) rather than new
  custom particle JSON, to avoid the risk of a hand-authored particle file being subtly malformed.
- All six abilities reuse the pack's existing sound events rather than adding new audio assets
  (none were supplied to add, and the task explicitly allows this).
- Fixed a pre-existing bug while in `sounds.json`: the hurt sound event was wired to
  `pntmc:king_hurt`, which nothing defines — `sound_definitions.json` only defines
  `pntmc:dweller_hurt` (matching the `dweller_hurt_*.ogg` files). Retargeted to the sound that
  actually exists, so the king's hurt sound plays at all now.

## Test commands

### Instant, on-demand: `/scriptevent`

Requires cheats enabled (same requirement as `/scriptevent` in general). Each command finds the
`pntmc:king` nearest to whoever ran it (or any king in the world if run from a command block) and
forces that specific ability through its **real** state machine and timing — the same windup,
animation, sound, and payoff as the real thing, just without waiting on chance/cooldown/range. It
still refuses to fire while the king is crawling/crouching/spotted, since a forced trigger is
meant to be a faithful test, not a way to break the arbitration system's own rules. Targets
whichever valid mob is nearest the king (any mob, not just players — see above), and replies in
chat if run by a player.

```
/summon pntmc:king ~ ~ ~5

/scriptevent pntmc:grab      # grab -> random throw or bite (55% bite / 45% throw), like the real thing
/scriptevent pntmc:throw     # grab, forced to resolve as a throw specifically
/scriptevent pntmc:bite      # grab, forced to resolve as a bite (+ Bleed) specifically
/scriptevent pntmc:bleed     # apply Bleed directly, no grab needed - isolates the DoT for testing
/scriptevent pntmc:pounce    # forced pounce, ignoring the normal 5-15 block range gate
/scriptevent pntmc:screech   # forced screech, ignoring the once-a-second chance roll
/scriptevent pntmc:burrow    # forced burrow, ignoring the 4s line-of-sight-loss requirement
/scriptevent pntmc:enrage    # fires the real pntmc:enrage BP event directly (same path as the HP trigger)
/scriptevent pntmc:help      # lists all of the above in chat
```

### Natural triggers (to verify the real gating, not just the forced path)

```
# 1. Size / hit detection / tunnel crawl
/summon pntmc:king ~ ~ ~5
# hit it — registers at the new ~2x visual size. Dig a 1-block-tall, 1-wide tunnel and run
# through it while chased; the king should still crawl through after you.

# Any mob that attacks the king (not automatic)
/summon minecraft:cow ~5 ~ ~
# the cow should be completely ignored - the king keeps hunting players only, exactly like the
# original pack, and should never wander off to bother it.
/summon minecraft:zombie ~5 ~ ~
# left alone, likewise ignored. But if it (or you, riding/commanding it, or just naturally as
# zombies do) hits the king first, the king should turn and fight back - not just a melee swing,
# the full kit (pounce/screech/burrow/grab) should be able to engage it for about 15s after that
# hit, then it drops out of contention again if it stops attacking and nothing re-triggers it.

# Any mob that damages the king WITHOUT a melee swing (this is the specific case a script-driven
# "make mobs fight" mod exercises, and the one entityHitEntity alone used to miss):
/damage @e[type=pntmc:king,c=1] 5 entity_attack @e[type=minecraft:zombie,c=1]
# the king never got hit by an actual swing here - the damage came from the command instead - but
# it should still turn and fight the zombie exactly as if it had been hit normally.

# 2 & 3. Grab -> Throw or Bite -> Bleed (natural trigger)
# Let the king melee you (or a mob) repeatedly until it grabs - held ~2s, then either thrown
# (10+ blocks, fall damage) or bitten (8 damage + Bleed: red particles trail the victim, actionbar
# counts down if it's a player, periodic damage). Drink a milk bucket to confirm the cure:
/give @s milk_bucket

# 4. Pounce (natural trigger)
# Stand 5-15 blocks from the king while it has a target. Watch for the ~1.1s crouch wind-up and
# sidestep - the leap should whiff. Stand still through one to feel the landing AOE.

# 5. Screech (natural trigger)
# Get the king's attention, then break line of sight for several seconds (round a corner / duck
# behind a wall) while staying within its long follow range, then step back within ~15 blocks.
# It should stop, rear back, and screech - blindness/darkness/nausea + camera shake, and the king
# holds still (hit it during the screech to confirm it's not invulnerable).

# 6. Burrow Ambush (natural trigger)
# Break line of sight or run more than ~22 blocks away and hold that for a few seconds - it should
# dig down (particles + the disappear sound), vanish, then erupt near you shortly after with a
# particle burst and a lunge. Confirm afterwards that /summon pntmc:king again still respects the
# one-king rule (the old one should already be gone / the new one takes over cleanly), and that
# tunnel-crawling still works.

# 7. Enrage (natural trigger)
/summon pntmc:king ~ ~ ~5
/damage @e[type=pntmc:king,c=1] 145
# health should now be <= 60/200 (30%) - the king should visibly enrage (flame aura, faster,
# hits harder, abilities more frequent) and stay that way through a crawl/crouch cycle.

# 8/9. Disconnect / death mid-ability and reload recovery
# Get grabbed, then log off before the throw/bite resolves; log back in and confirm you're not
# stuck. Kill the king (or let a player kill it) mid-grab and confirm the held target is freed
# within a couple of seconds. Reload the world mid-fight and confirm nothing is left frozen,
# invisible, or stuck underground.

# Misc
/kill @e[type=pntmc:king]
/kill @e[type=pntmc:king_trigger]
/kill @e[type=pntmc:king_flee]
```

## Testing performed

Minecraft Bedrock itself isn't available in this environment, so verification took two forms:

1. **Static:** every JSON file in both packs (22 total) was parsed and validated, including a full
   zip → extract → re-validate round trip on the packaged `.mcaddon` to rule out packaging
   corruption. All script files were syntax-checked with `node --check`.
2. **Behavioral simulation:** `scripts/*.js` were exercised against a mocked `@minecraft/server`
   module (fake entities, dimension, world, and system objects, including a fake
   `system.afterEvents.scriptEventReceive` that can fire synthetic `/scriptevent` calls) driving
   `tickKing` tick-by-tick through complete Grab→Throw, Grab→Bite→Bleed (including the cannot-kill
   damage clamp), Pounce, Screech, and full Burrow (dig → under → erupt, including the
   invisibility/resistance toggle) sequences, plus targeted checks for: mutual exclusion (a second
   ability can't clobber one in progress), crawl/crouch/spotted locking out new abilities,
   `pntmc:king_trigger` being structurally unable to trigger any ability, the global cooldown
   blocking a *different* ability right after one ends, the reload safety clamp resolving a stale
   far-future timestamp instead of getting stuck, and a target being freed within one tick-loop
   pass if the king holding it becomes invalid. A third round specifically covers this update:
   `isValidMobTarget` accepting a zombie/cow/villager/player alike while rejecting the pack's own
   `pntmc:king_trigger`, all eight `/scriptevent pntmc:*` commands end-to-end (including a forced
   grab actually resolving to the specifically-forced throw/bite outcome once real time is
   advanced through `tickKing`, not just the property being set), forced triggers still refusing
   to fire while the king is locked, the namespace filter silently ignoring non-`pntmc` script
   events, and a test command still working with no `sourceEntity` (command-block invocation).
   A fourth round covers the provoked-vs-automatic correction specifically: an unprovoked mob
   standing right next to the king is never picked up by `findAbilityTarget` and `tickKing` never
   fires an ability at it even across 60 ticks with every chance roll forced to succeed; calling
   `markProvoked` after a simulated hit immediately makes that same mob a valid target and
   `tickKing` does fire on the very next pass; the provocation expires on its own once the
   remembered window elapses; and a nearby player remains a valid target with no provocation
   needed at all, confirming the original hunting behavior is untouched. A fifth round covers the
   lost-target grace period in isolation (`markLostTarget`/`markFoundTarget`/
   `tickLostTargetGrace` in `abilities.js`, driven directly - no `main.js` wiring involved): never
   calling `markLostTarget` means the grace timer never starts and `pntmc:vanish` never fires even
   well past the 30s window; calling it once stamps the start tick and holds steady on later ticks
   rather than drifting (matching the animation controller's `on_entry` firing once per
   transition, not every tick); `markFoundTarget` before 30s cancels it with no vanish; a full,
   uninterrupted 30s does fire `pntmc:vanish` (and not a tick before); a stale future-dated
   timestamp (simulating a post-reload `system.currentTick` discontinuity) gets corrected instead
   of blocking the timer forever; and calling `markFoundTarget` with nothing lost is a safe no-op.
   A sixth round covers `main.js`'s event *wiring* specifically, going through the real subscribed
   handlers (`__fireEntityHurt`/`__fireEntityHitEntity`/`__fireScriptEvent` on the mock module)
   rather than calling the underlying helpers directly, since the bug report this round was about
   behavior that only main.js's subscriptions - not the helpers - could be responsible for: a
   non-melee `entityHurt` alone (no `entityHitEntity`) is enough to mark provocation, matching what
   a script-driven "make mobs fight" mod would actually trigger; a bare damage source with no
   attacking entity doesn't crash and marks nothing; an attacker that fails `isValidMobTarget` is
   ignored; `entityHitEntity` still independently marks provocation too (additive, not replaced);
   the king landing a real melee hit still starts a grab through the actual subscription; and the
   `pntmc:losttarget`/`pntmc:foundtarget` scriptevents reach `markLostTarget`/`markFoundTarget`
   through `main.js`'s real dispatch. All of the above passed — 94 checks across six simulation
   files. Throw/pounce strength and range were tuned directly per feedback that the previous values
   were far weaker in practice than the in-code physics estimate suggested, without re-running the
   simulation harness (nothing about the state machine changed, only magnitude constants) - this
   does not replace an in-game playtest — animation timing/feel, particle appearance, and exact
   knockback distances should still be sanity-checked in a real world. The provocation-widening and
   `is_stunned`-removal fixes in this round likewise can't be verified against any specific
   third-party mod without a live game to test against.
