# Copper Crusader — Minecraft Bedrock Add-On

A copper evolution weapon with a fall-based power meter and an oxidation combat
system. Behavior Pack + Resource Pack, packaged as `CopperCrusader.mcaddon`.

## Install

1. Double-tap / open `build/CopperCrusader.mcaddon` with Minecraft Bedrock
   (Win10/11, mobile, console via import). Both packs import automatically.
2. Create/edit a world → **Behavior Packs** → activate **Copper Crusader [BP]**
   (the resource pack is added as a dependency).
3. **Enable the "Beta APIs" / Scripting experiment** is *not* required for the
   stable `@minecraft/server 1.16.0` module, but make sure the world allows
   add-ons (Education/cheats settings do not matter).

Craft the sword: 2 Copper Blocks over a Stick. Armor: copper ingots in the
standard armor patterns. (All are also in the Creative equipment tab.)

## Controls

| Input | Action |
|-------|--------|
| **Use** (right-click / long-press) with sword | Activate current ability |
| **Sneak + Use** | Cycle ability 1 → 2 → 3 → 1 |

The action bar always shows the selected ability and the **Fall Power** meter.
Fall Power builds while you descend holding the sword and is **spent (reset)
each time an ability fires** — higher falls = stronger abilities.

## Abilities

1. **Skybreak Ascension** — Use to launch up with slow-fall control. Use again
   mid-air to dive; on landing you deal a copper slam (`10 + fallPower×0.6`
   damage) with an explosion burst, knockback shockwave, and copper particles.
2. **Copper Corruption Rush** — Forward dash that hits everything in its path
   with the **Copper Effect**.
3. **Copper Relic Summon** — Spawns a copper statue clone (~40 HP, copper glow
   pulses) for 6 s or until destroyed. Only one statue at a time. On break it
   bursts into homing copper shards: **early kill = tight, strong burst**;
   **natural expiry = wider, weaker burst**. Count/speed/damage scale with the
   Fall Power stored when it was summoned.

## Copper Crusader Spear

A faster, harder-thrusting companion weapon (`copper_crusader:spear`, 6 base
damage). Same control scheme: *Use* activates, *Sneak + Use* cycles its three
abilities. It shares the Fall Power meter (abilities scale with it and reset it).

Craft: Copper Block over Copper Ingot over Stick.

1. **Copper Slipstream** — Activate to launch into elytra-style directional
   flight: you fly wherever you look at high speed with Speed III, for ~5 s, and
   land safely (no fall damage). Reactivate to refresh.
2. **Skewer Lunge** — A fast forward lance thrust that pierces and damages
   everything in its path (`6 + fallPower×0.4`), knocks them back, and applies
   the Copper Effect.
3. **Copper Thunderlance** — Strikes the block you're aiming at (up to 24 m)
   with a copper lightning blast: AoE damage (`8 + fallPower×0.5`), knockback,
   heavy Copper Effect, plus a homing copper-shard scatter. Everything scales
   with stored Fall Power.

## Copper Effect (oxidation)

Stages **Normal → Exposed → Weathered → Fully Oxidized** progress over time and
stack Slowness + Weakness (slower movement, reduced damage). **Counter:** if the
Copper Crusader user is hit, all oxidation progression pauses for 5 s.

## Passives

- **Copper Walk** — copper block states never slow the holder (vanilla copper
  has no slowdown, so this holds natively).
- **Armor Set Bonus** — each equipped Copper Crusader piece grants Absorption
  (≈ extra max HP), Regeneration near copper blocks, and a **full set** grants
  immunity to the Copper Effect.

## Implementation notes / Bedrock approximations

- Bedrock players have no script-settable max-HP, so "increased max HP per
  piece" is modeled with stacking **Absorption** (amplifier = pieces − 1).
- Player launches/dashes use `applyKnockback` (with an `applyImpulse` fallback)
  since `applyImpulse` is unsupported on players in several engine builds.
- Particles use copper-themed vanilla IDs (`electric_spark_particle`,
  `huge_explosion_emitter`, `knockback_roar_particle`); all particle/sound calls
  are wrapped so an unsupported ID never breaks gameplay logic.
- All gameplay state is stored via dynamic properties; the oxidation manager
  scans loaded entities once per second.

## Rebuild

```bash
python3 tools/gen_textures.py          # regenerate PNG textures
cd .. && bash CopperCrusader/build.sh  # see repo build step / zip the two pack folders
```

Targets `@minecraft/server 1.16.0`, `min_engine_version 1.21.60`.
