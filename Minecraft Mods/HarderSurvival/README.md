# Harder Survival — Minecraft Bedrock Add-On

Makes vanilla **Bedrock survival much harder**. No experimental toggles required.

## Download

➡️ **[`HarderSurvival.mcaddon`](./HarderSurvival.mcaddon)** — download this file and open it; Minecraft imports it automatically.

> On the GitHub web UI, open the file and click **Download** (or **View raw**).

## What it does

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
3. Create/Edit a world → **Behavior Packs** → **Activate** "Harder Survival".
4. Make sure **Difficulty** is Normal or Hard for the full effect. Hardcore mode pairs nicely.

### Manual
1. Rename `HarderSurvival.mcaddon` to `.zip` and extract.
2. Copy the `HarderSurvival_BP` folder into
   `…/com.mojang/development_behavior_packs/`.
3. Activate it on your world as above.

## Notes / Compatibility
- Requires **min engine version 1.20.0+** and the stable `@minecraft/server` scripting module (ships with the game, no experiments).
- Spawn-rule files intentionally override the vanilla zombie/skeleton/creeper/spider spawn rules; other spawn-rule add-ons for those mobs may conflict.
- Loot-table files override the vanilla cow/pig/chicken/sheep tables.

Source for the pack lives in [`src/HarderSurvival_BP/`](./src/HarderSurvival_BP). Rebuild the `.mcaddon` by zipping that folder (see `build.sh`).
