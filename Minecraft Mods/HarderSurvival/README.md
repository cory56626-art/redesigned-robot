# Harder Survival — Minecraft Bedrock Add-On

Makes vanilla **Bedrock survival much harder**, now with a full **thirst / water-purification system**. No experimental toggles required.

## Download

➡️ **[`HarderSurvival.mcaddon`](./HarderSurvival.mcaddon)** — download this file and open it; Minecraft imports it automatically.

> On the GitHub web UI, open the file and click **Download** (or **View raw**).

## What it does

**Thirst & water (NEW)**
- You now have a **Water bar** shown on the action bar (`Water ▮▮▮▮▮▯▯▯▯▯ 50%`). It drains over time — **faster when sprinting and in the Nether**.
- Filling a glass bottle from any water (lake/river/ocean) gives **Murky Water**. Drinking it **poisons** you (poison + nausea, sometimes hunger) and barely hydrates.
- **Smelt Murky Water in a furnace** to get **Purified Water**, which is safe and restores a lot of thirst.
- Juicy foods (melon, apple, berries, milk, …) give minor hydration.
- Running low on water hurts: **30%** → slowness, **15%** → weakness + slowness, **0%** → you take damage until you drink.

**Mobs are deadlier**
- Every hostile mob is buffed the instant it spawns: **Strength II, Speed, Regeneration, Resistance, and Fire Resistance**. They hit harder, chase faster, tank more, heal themselves, and laugh at your lava traps.
- Works on every monster family (including modded monsters via the `monster` type family) across the Overworld, Nether, and End.

**The world is more crowded**
- Zombies, skeletons, creepers, and spiders spawn in **larger herds** and at **higher weights**, both on the surface and underground.
- Zombies have a chance to spawn as zombie villagers.

**Nights are brutal**
- After dusk in the Overworld you suffer **Weakness**, **Mining Fatigue**, and a slow **Hunger** drain — camping the night away is no longer free.
- The Nether and End apply constant **Weakness**.

**Survival is scarcer**
- Natural healing is throttled (saturation is kept low) so you can't passively regen your way out of trouble.
- Food and farm drops are nerfed: cows, pigs, chickens, and sheep drop **at most one** food item.

## Install

### Mobile / Console / Win10 (recommended)
1. Download `HarderSurvival.mcaddon`.
2. Open it — Minecraft launches and imports the pack automatically.
3. Create/Edit a world → **Behavior Packs** → **Activate** "Harder Survival" (the matching resource pack auto-activates for the water-bottle textures; if not, also activate "Harder Survival Resources" under **Resource Packs**).
4. Make sure **Difficulty** is Normal or Hard for the full effect. Hardcore mode pairs nicely.

### Manual
1. Rename `HarderSurvival.mcaddon` to `.zip` and extract.
2. Copy the `HarderSurvival_BP` folder into
   `…/com.mojang/development_behavior_packs/`.
3. Activate it on your world as above.

## Notes / Compatibility
- Requires **min engine version 1.20.10+** and the stable `@minecraft/server` scripting module (ships with the game, no experiments).
- The Water bar is drawn on the **action bar** (Bedrock has no API to add a true extra HUD gauge without fragile UI hacks); other add-ons that write to the action bar may flicker against it.
- Spawn-rule files intentionally override the vanilla zombie/skeleton/creeper/spider spawn rules; other spawn-rule add-ons for those mobs may conflict.
- Loot-table files override the vanilla cow/pig/chicken/sheep tables.
- Filling a glass bottle that's part of a **stack** may leave a plain (inert) water bottle; fill bottles one at a time for guaranteed Murky Water.

Source for the packs lives in [`src/HarderSurvival_BP/`](./src/HarderSurvival_BP) (behavior) and [`src/HarderSurvival_RP/`](./src/HarderSurvival_RP) (resources). Rebuild the `.mcaddon` with `build.sh`.
