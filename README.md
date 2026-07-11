# The King Dweller — Boss Upgrade

Personal-use modification of *The King Dweller by PnTMC* (credits to PnTMC and Flamc04 for the
original add-on — kept intact in both manifests). Two changes on top of the original pack:

1. The King is now ~2x its previous visual size.
2. It has a six-ability combat kit that turns it into a real boss fight.

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
- **Trigger:** on a landed king melee hit (`world.afterEvents.entityHitEntity`), 25% chance, own
  30s cooldown.
- **Flow:** `grab_windup` (0.4s, arms raise) → `grab_hold` (2s: player is teleport-anchored to a
  fixed point in front of the king every tick, with movement input locked where available — the
  king stands still) → **either** `grab_throw` **or** `grab_bite` (55%/45% split, rolled once the
  hold ends).
- **Throw:** velocity is set with `applyKnockback` (strength tuned for a 10+ block arc); actual
  injury comes from vanilla fall damage on landing, not a direct hit.

### 2. Grab & Bite → Bleed
- Same grab entry point as above; the 55% branch. The main head/neck/jaw (the un-suffixed
  `head`/`neck`/`jaw` bones — the front-facing one) lunges and snaps shut ~0.3s into the animation,
  dealing 8 damage and applying Bleed.
- **Bleed:** 10s duration, 2 damage every 2s (5 pulses, 10 potential damage). Re-biting a bleeding
  player **refreshes** the 10s window instead of stacking — it can never run two DoT sources at
  once or extend past 10s from the moment of the freshest bite. **Cannot kill on its own** — each
  tick's damage is clamped so health never drops below 1; it can put a player on the edge for a
  follow-up hit to finish, but the tick itself never does. Cured by drinking milk, or by the 10s
  timeout, or implicitly by death. Visible as red dust particles trailing the player plus an
  actionbar countdown. Dynamic properties persist through a same-session relog, so disconnecting
  doesn't stop the clock or cure it; a full world/server restart resets the tick counter and the
  now-stale end time gets clamped away by the same safety net that stops any stuck state from
  surviving a reload (see below) — not a realistic exploit, since it needs restarting the world.

### 3. Pounce
- **Trigger:** target 5–15 blocks away, 15% chance rolled once a second, 14s cooldown.
- **Flow:** `pounce_windup` (1.1s crouch-coil — long enough to sidestep) → leap
  (`applyImpulse`, not `applyKnockback` — see above) → land on ground contact (min 0.2s airtime,
  hard 1.5s cap so it can never get stuck mid-air) → 2.5-block AOE damage/knockback/slowness.
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

## Edge cases

- **Player disconnects mid-grab:** the per-tick anchor loop detects the missing entity within one
  tick-loop pass (≤2 ticks) and both releases the player-side lock and ends the ability immediately
  — it doesn't wait out the phase timer.
- **King dies or transforms (flees) mid-ability:** an `entityDie` listener releases any held player
  immediately as a fast path; a `reconcileGrabbedPlayers()` pass every tick loop is the guaranteed
  backstop that catches every other disappearance cause (transform, admin `/kill`, etc.) within a
  couple of ticks regardless of what caused it.
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

```
# 1. Size / hit detection / tunnel crawl
/summon pntmc:king ~ ~ ~5
# hit it — registers at the new ~2x visual size. Dig a 1-block-tall, 1-wide tunnel and run
# through it while chased; the king should still crawl through after you.

# 2 & 3. Grab -> Throw or Bite -> Bleed
# Let the king melee you repeatedly (or reduce GRAB_CHANCE friction with /effect on yourself to
# stay alive) until it grabs you - you'll be teleport-pinned in front of it for ~2s, then either
# thrown (fly 10+ blocks, take fall damage on landing) or bitten (8 damage + Bleed: red particles
# trail you, actionbar counts down, periodic damage). Try /effect @s milk_bucket... there's no
# such effect - actually drink a milk bucket to confirm the cure:
/give @s milk_bucket

# 4. Pounce
# Stand 5-15 blocks from the king while it has a target. Watch for the ~1.1s crouch wind-up and
# sidestep - the leap should whiff. Stand still through one to feel the landing AOE.

# 5. Screech
# Get the king's attention, then break line of sight for several seconds (round a corner / duck
# behind a wall) while staying within its long follow range, then step back within ~15 blocks.
# It should stop, rear back, and screech - blindness/darkness/nausea + camera shake, and the king
# holds still (hit it during the screech to confirm it's not invulnerable).

# 6. Burrow Ambush
# Break line of sight or run more than ~22 blocks away and hold that for a few seconds - it should
# dig down (particles + the disappear sound), vanish, then erupt near you shortly after with a
# particle burst and a lunge. Confirm afterwards that /summon pntmc:king again still respects the
# one-king rule (the old one should already be gone / the new one takes over cleanly), and that
# tunnel-crawling still works.

# 7. Enrage
/summon pntmc:king ~ ~ ~5
/damage @e[type=pntmc:king,c=1] 145
# health should now be <= 60/200 (30%) - the king should visibly enrage (flame aura, faster,
# hits harder, abilities more frequent) and stay that way through a crawl/crouch cycle.

# 8/9. Disconnect / death mid-ability and reload recovery
# Get grabbed, then log off before the throw/bite resolves; log back in and confirm you're not
# stuck. Kill the king (or let a player kill it) mid-grab and confirm the held player is freed
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
   module (fake entities, dimension, world, and system objects) driving `tickKing` tick-by-tick
   through complete Grab→Throw, Grab→Bite→Bleed (including the cannot-kill damage clamp), Pounce,
   Screech, and full Burrow (dig → under → erupt, including the invisibility/resistance toggle)
   sequences, plus targeted checks for: mutual exclusion (a second ability can't clobber one in
   progress), crawl/crouch/spotted locking out new abilities, `pntmc:king_trigger` being
   structurally unable to trigger any ability, the global cooldown blocking a *different* ability
   right after one ends, the reload safety clamp resolving a stale far-future timestamp instead of
   getting stuck, and a player being freed within one tick-loop pass if the king they're grabbed by
   becomes invalid. All of the above passed. This does not replace an in-game playtest — animation
   timing/feel, particle appearance, and exact knockback distances should still be sanity-checked
   in a real world.
