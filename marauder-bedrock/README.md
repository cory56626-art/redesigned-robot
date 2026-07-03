# The Marauder — Bedrock Port

A Bedrock Edition port of the Java/Fabric **Marauder** mod: a recurring cursed
flame‑knight rival who hunts each player across ten escalating nights, growing
stronger every time he is defeated until the final *Marauder Ascendant* duel.

This folder is the editable source for the add‑on. A ready‑to‑install package is
built to `../dist/marauderbedrock.mcaddon`.

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

Otherwise he appears on his own at night (survival/adventure, overworld).
