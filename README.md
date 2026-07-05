# Organic Forgery & The Harvester

A **biopunk / dark-survival add-on for Minecraft Bedrock Edition**. Harvest flesh
from weakened livestock, grind carcasses in a mechanical Harvester, forge *living*
gear whose stats shift as it rots, and watch your slaughterhouse corrupt the land
around it.

> **This is Part 1 — Module 1 (the Core Loop).** It is a complete, playable base.
> Modules 2–4 (living weapons & armour, homunculus mutations, amalgamated bosses)
> are planned follow-ups — see the roadmap at the bottom.

Built the way marketplace add-ons actually are: thin JSON registration shells with
**all behaviour driven by the `@minecraft/server` Script API** (custom components +
system loops).

---

## Install

1. Double-click **`dist/Organic-Forgery.mcaddon`** — Minecraft imports both the
   behavior and resource packs automatically.
   - *Fallback:* if the combined file ever misbehaves, import
     **`dist/of_bp.mcpack`** and **`dist/of_rp.mcpack`** individually instead.
2. Create or edit a world and **add both packs** (Behavior + Resource). Make sure
   the **resource pack is activated** too, or you'll get missing textures.
3. **No experimental toggles are required** — this add-on targets the **stable**
   Script API. (You may leave all Experiments off.)
4. Load the world. You'll see `[Organic Forgery] Module 1 (v2) loaded` in the
   content log (Settings → Creator → enable "Content Log" to view it).

> **Version note:** the manifest targets stable `@minecraft/server 2.0.0`
> (`min_engine_version` 1.21.80), which covers Minecraft 1.21.80 through current
> (1.21.130+). If the pack ever reports an *invalid module version*, open
> `behavior_packs/of_bp/manifest.json`, set the two `version` strings to the
> number your game's content log lists (e.g. `2.4.0`), and re-run
> `node tools/build.mjs`.

---

## The gameplay loop

1. **Craft a Butcher's Knife** (crafting table): 2 iron + 1 bone.
2. **Weaken a farm animal** (cow, pig, sheep, chicken) to under 30% health, then
   **right-click it with the knife** → it's rendered down into a **Raw Carcass**
   with a spray of blood and a bone-crack.
3. **Craft the Harvester** (iron, pistons, hopper, redstone block) and place it.
   Right-click to open its panel. Insert **coal/charcoal** as fuel and a
   **carcass** as input. Over ~10 seconds it grinds — venting dark smoke — and
   outputs **Sinew**, **Dense Bone**, and sometimes **Marrow** or **Cured Hide**.
4. **Craft the Organic Forgery** and use it as a crafting station (its recipes
   are tagged `organic_forging`). Forge the **Organic Cleaver** from marrow,
   dense bone, and sinew.
5. **Wield the Cleaver** and watch the **Rot Tier** system:
   - **Fresh** (durability > 66%) — agile: +Speed, +Haste.
   - **Fermented** (33–66%) — juggernaut: +Resistance, −Movement, heavy knockback on hit.
   - **Putrid** (< 33%) — necrotic: +Strength, and hits inflict **Poison + Wither**.
6. **Maintain your gear** two ways:
   - **Combat siphon** — killing mobs while wielding organic gear restores it.
   - **Feeding** — right-click while holding the gear to consume a piece of raw
     meat from your pack and heal it back toward Fresh.
7. **Consequences** — every carcass ground raises the world **Chum score**. Past a
   threshold, the ground near your Harvester rots into **Flesh Moss**. (This is the
   hook Module 4's amalgamated creatures will later spawn from.)

---

## What's in this build

**Blocks:** `custom:harvester`, `custom:organic_forgery`, `custom:flesh_moss`
**Items:** `custom:butchers_knife`, `custom:raw_carcass`, `custom:sinew`,
`custom:dense_bone`, `custom:marrow`, `custom:cured_hide`, `custom:organic_cleaver`
(demo gear that exercises the Rot engine).

**Systems (all JavaScript):**
- Butcher's Knife interact-to-harvest (`items/butchersKnife.js`)
- Harvester fuel + timed processing over a companion-entity inventory
  (`machines/harvester.js`, `ui/harvesterUI.js`)
- Rot Tier lifecycle engine — generic, tag-driven (`systems/rot.js`)
- Gear maintenance: combat siphon + feeding (`systems/gearMaintenance.js`, `rot.js`)
- Chum score + Flesh Moss corruption spread (`systems/chum.js`)

---

## Project layout

```
behavior_packs/of_bp/    manifest, block/item/recipe JSON, loot, entity, scripts/
resource_packs/of_rp/    manifest, geometry, textures, particles, lang
tools/gen_textures.py    procedural placeholder-texture generator (Pillow)
tools/validate.mjs       reference-integrity linter
tools/smoke.mjs + stubs/ load-time script smoke test (no game required)
tools/build.mjs          validate + smoke + package (asserts archive layout)
dist/Organic-Forgery.mcaddon   +   dist/of_bp.mcpack   +   dist/of_rp.mcpack
```

## Build from source

```bash
python3 tools/gen_textures.py   # regenerate placeholder PNGs (needs Pillow)
node tools/validate.mjs         # reference-integrity linter (icons/textures/geometry)
node tools/smoke.mjs            # load scripts against @minecraft stubs (no game needed)
node tools/build.mjs            # runs the above, then packages dist/*.mcaddon + *.mcpack
# or: npm run package
```

### Built so it can't silently break

Because this can't be tested inside a live game here, the build enforces the
things that broke the first prototype:
- **Archive layout is asserted** — pack folders must sit at the archive root
  (`of_bp/`, `of_rp/`); a nested wrapper fails the build.
- **`tools/validate.mjs`** fails the build on any dangling icon / texture /
  geometry / particle reference.
- **`tools/smoke.mjs`** imports the whole script graph against no-op
  `@minecraft/*` stubs to catch load-time errors before shipping.
- **Content is decoupled from scripts** — blocks/items carry no
  `custom_components`, so even a script fault can't make them fail to load.
  Every behaviour is a stable world-event subscription.

---

## Honest limitations (Part 1)

- **Placeholder art.** Block geometry is hand-authored detailed cube models;
  item icons and block textures are procedurally generated placeholders. Every
  texture is a standalone PNG you can replace without touching code.
- **Sounds** use stable vanilla sound events (skeleton death, slime squelch,
  anvil) so audio works with zero shipped `.ogg` files. To use custom audio,
  add `sounds/sound_definitions.json` mapping `of.*` events to your `.ogg`s and
  point `CONFIG.sounds` (in `scripts/core/config.js`) back at them.
- **Held items render as 2D icons** (no 3D attachable models yet).
- The Harvester panel is a **button-based form**, not drag-and-drop — custom
  blocks can't expose a native container UI, so deposits/collections move the
  item in your main hand to/from the machine.

## Roadmap

- **Module 2** — Vertebrae Flail, Bile-Spitter, Ocular Crown, Ribcage Carapace,
  Sinew Greaves, Flesh-Anchor, Adrenaline Gland (all inherit the Rot engine).
- **Module 3** — Homunculus wards & mutations, Harvester enzyme catalysts,
  Rot-Sync full-set synergies.
- **Module 4** — Chum amalgamations (Grafted Stalker, Marrow-Ghast, the Devourer
  boss), Spined Barricades, Pheromone Decoy Vents.
