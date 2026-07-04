# The Marauder — Bedrock Port

A Bedrock Edition port of the Java/Fabric **Marauder** mod: a recurring cursed
flame‑knight rival who hunts each player across ten escalating nights, growing
stronger every time he is defeated until the final *Marauder Ascendant* duel.

This folder is the editable source for the add‑on. A ready‑to‑install package is
built to `../dist/marauderbedrock.mcaddon`.

## v5 Souls-like phase (latest)

The Marauder is now a proper phased boss. As his HP drops he **enrages** — armor
(damage reduction) breaks away while his speed, damage, and **dodge** climb.
Signature moves:

- **Six-Arm Omni-Flurry** — pulls you in, then a synchronized six-strike barrage
  of **true damage** (bypasses armor); near one-combo if you eat the whole thing.
- **Afterimage Dodge** — at low HP he can phase out of a hit, dash away, and leave
  a phantom that sweeps where he stood.
- **Halo Shatter** — at ≤25% HP he kneels, turns invulnerable, and rains **three
  tracking divine strikes** that re-lock onto your current position (moving = chip,
  standing still = death), each igniting + cratering the ground.
- **Unbroken-Core Revive** — the first killing blow is refused; he restores to 30%
  HP for a final berserk stand. The second death is real.

> These four mechanics are all driven from the **stable** `@minecraft/server` API
> (no experiments required). The earlier GLM build wired Dodge and Revive through
> a cancellable damage event that only exists as an experimental API, so they
> never fired — they now run via damage heal-back + an HP monitor instead.

The **boss bar is a live phase readout**: it mirrors his name tag, which the
script updates in real time — *Enraged / Frenzied / Berserk*, *HALO SHATTERED*,
*LAST STAND*, and the Fractured variant's meter. The divine-strike crater only
consumes **natural terrain** (stone, dirt, sand, ores, leaves…) — player builds
are never destroyed.

## The Fractured Marauder (challenge sub-project)

A separate, harder variant (`marauder:fractured_marauder`) with a **low chance
(~12%) of replacing the normal final boss** on any stage-10 night (including
rematches). More HP (340), more damage (17 melee, +25% on abilities), full
knockback immunity — and his own mechanics:

- **Fracture meter** — every successful hit he lands (on players *or* mobs — he
  works with free-for-all and Brawl Stick sandboxing) cracks his facade. As the
  meter climbs his skin **bleaches toward a holy, angelic pallor** in three
  visible steps, shown live on his boss bar.
- **SERAPHIM** — at 100% he transforms: larger, faster, harder-hitting, wreathed
  in light. While transformed the meter **drains**; at 0 he reverts to normal
  and the cycle can begin again.
- **Unrivaled Grit** *(sealed while Seraphim)* — a feint. What looks like an
  ordinary sword swing suddenly becomes a stance-switch and a heavy blow to the
  jaw that **stuns** — the only warnings are the swing itself and a quiet
  stance-shift sound.
- **Might & Skyfall** *(sealed while Seraphim)* — he hurls everyone near him
  back with sheer might, then a **holy beam slams down from the sky** onto the
  shoved target after a short telegraph.
- **Radiant Wing-Sweep** *(Seraphim only)* — his transformation's own signature:
  he flares six wings of light and sweeps a 360° radiant nova, holy fire plus an
  armor-piercing core that launches everything around him up and away.
- He does *not* use the normal boss's mirage, omni-flurry, or halo-shatter —
  the two variants are deliberately their own fights.
- Defeating him counts as completing the ten-night rivalry and drops a richer
  core haul (extra unbroken cores + shards).

```
marauder_bp/   behavior pack  (entity AI, items, script)
marauder_rp/   resource pack  (model, textures, animations, controllers)
```

## What was broken in the original port, and what changed

The original port compiled but the mob barely animated and its AI felt dead.
The fixes below bring the Bedrock version in line with the Java entity’s intent.

### Animations

* **Melee attacks now animate.** Bedrock’s `melee_attack` behavior does not, by
  itself, drive an animation. The script now listens for the marauder’s landed
  hits (`entityHitEntity`) and raises a `marauder:attacking` property that the
  action animation controller responds to — the Bedrock analog of the Java
  entity triggering its `attack` animation on a hit.
* **The `cast` animation is no longer dead.** A separate `marauder:casting`
  property was added; ability wind‑ups now play the two‑armed `cast` pose instead
  of being mislabelled as a normal swing.
* **Locomotion is a clean idle ⇄ walk state machine** (with blend transitions)
  instead of idle and walk being force‑blended every frame.

### AI

* **`minecraft:follow_range` set to 64.** This is the key fix — without it the
  entity used the default (~16 blocks) and abandoned pursuit the moment the
  player stepped back, which read as “broken.” 64 matches the Java follow range.
* **Removed the constant scripted knockback‑lunge** that flung the mob around
  every 1.5 s. Movement is now handled by pathfinding; abilities are deliberate.
* **Telegraphed abilities**, gated by stage and range and mirroring the Java
  roster (shockwave, guard‑break, lunge, cinder cone, brand debuff, flash‑step
  teleport, blade beam). Each has a wind‑up (particles + sound + `cast` pose)
  before it resolves.
* Added `hurt_by_target`, fire/lava/magic **immunity** (flame knight),
  `persistent` + script leash cleanup, and matched the Java collision box (0.6).
* Made the script **load‑safe on modern engines** — removed the deprecated
  `worldInitialize` subscription that can abort script initialisation (and with
  it every scripted behavior, including spawning) on current Bedrock versions.

### Content parity

* Ported the full **loot set** from the Java mod (dark scrap, blacksteel &
  rune & abyss fragments, ashen/moon shards, unbroken core, trophy, ashen
  remnant) with their original textures, so the ten‑night reward loop is intact.
* The **Ashen Remnant** re‑arms the final rematch when used after completion.
* The **Blacksteel Blade** keeps its night‑time curse (glow + lifesteal on hit).

## Install

1. Open `dist/marauderbedrock.mcaddon` with Minecraft (or import both packs).
2. Enable **The Marauder (Behavior)** and **The Marauder (Resources)** on a world.
3. In the behavior pack’s world settings, enable the **Beta APIs**
   experiment (required for the `@minecraft/server` script module).

## Testing (`/scriptevent`)

| Command | Effect |
| --- | --- |
| `/scriptevent marauder:duel 5` | Spawn a stage‑5 marauder right now |
| `/scriptevent marauder:spawn` | Spawn at your current progress stage |
| `/scriptevent marauder:setstage 8` | Set your rivalry stage |
| `/scriptevent marauder:stage` | Print your stage / completion |
| `/scriptevent marauder:reset` | Reset rivalry to stage 1 |
| `/scriptevent marauder:rematch` | Arm the Ascendant rematch |
| `/scriptevent marauder:clear` | Remove your active marauder(s) |
| `/scriptevent marauder:omni` | Force the Six-Arm Omni-Flurry |
| `/scriptevent marauder:halo` | Force the Halo Shatter phase |
| `/scriptevent marauder:revive` | Set him to 1 HP + clear the flag (hit him once more to see the revive) |
| `/scriptevent marauder:enrage` | Print HP / tier / dmg-reduction / speed / dodge |
| `/scriptevent marauder:fractured` | Spawn the Fractured Marauder right now |
| `/scriptevent marauder:fracture 90` | Report or set his Fracture meter (0–100) |
| `/scriptevent marauder:grit` | Force Unrivaled Grit (the feint) |
| `/scriptevent marauder:skyfall` | Force the Might Shove + Sky Beam |
| `/scriptevent marauder:wingsweep` | Force the Seraphim wing-sweep (transform him first) |
| `/scriptevent marauder:ping` | Confirm the script loaded (lists registered subscriptions) |
| `/scriptevent marauder:help` | List every command |
| `/scriptevent marauder:freeforall on` | Testing: make marauders attack **any** mob — melee *and* abilities target whatever he's fighting, and he retaliates against anything. `off` reverts; no argument flips it. Applies to active + future marauders. |

Otherwise he appears on his own at night (survival/adventure, overworld).

## Fighting other mobs / mod compatibility (Brawl Stick etc.)

By default the Marauder hunts **players**, but he now **retaliates against
anything that damages him** (`hurt_by_target` with no family restriction). That
makes him work with mods built on the standard "attribute a hit to the
aggressor" trick — including **Brawl Stick**, whose `poke()` does exactly
`victim.applyDamage(1, { damagingEntity: aggressor })`:

* Tag the Marauder and another mob with the Brawl Stick → the poke lands, his
  retaliation AI turns on, and he fights that mob. His **abilities follow the
  mob too**, because ability targeting reads his actual AI target
  (`entity.target`) rather than assuming a player.
* This is why he previously *couldn't* be goaded onto mobs: his retaliation was
  restricted to players, so a mob's poke was ignored. That restriction is gone.

For proactive mob-hunting (no external mod needed), use
`/scriptevent marauder:freeforall on`.
