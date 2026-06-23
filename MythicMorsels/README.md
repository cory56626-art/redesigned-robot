# Mythic Morsels — Minecraft Bedrock Add-On

A small fantasy add-on of magical food & relics. Built by Claude + Groq as coding buddies
(concept and content brainstormed with the Groq Llama 3.3 70B model; technical JSON validated
and textures rendered by Claude).

**Tested target:** Minecraft Bedrock **1.21+** (`@minecraft/server` 1.14.0).

## What it adds

| Content | Type | Effect |
|---|---|---|
| **Fae Feather** (`mm:fae_feather`) | Crafting material | Found/given — the key ingredient for everything below |
| **Mythic Cookie** (`mm:mythic_cookie`) | Food | Restores hunger + **Night Vision** for 30s on eat |
| **Mooncheese** (`mm:mooncheese`) | Food | Restores hunger + **Speed II (20s)** & a regen burst on eat |
| **Glimmerstone** (`mm:glimmerstone`) | Block | Decorative block that emits light (level 12) |

## Recipes (crafting table, shapeless)

- **Mooncheese** ×2 = 2× Milk Bucket + 1× Fae Feather + 1× Sugar
- **Mythic Cookie** ×2 = 2× Wheat + 1× Fae Feather + 1× Cocoa Beans
- **Glimmerstone** ×4 = 4× Stone + 1× Fae Feather + 1× Glowstone Dust

> Fae Feather isn't craftable by design. Give yourself one to start: `/give @s mm:fae_feather`

## Install

1. Zip the two folders into `.mcpack` files (or the whole thing into a `.mcaddon`):
   - `behavior_pack/` → `MythicMorsels_BP.mcpack`
   - `resource_pack/` → `MythicMorsels_RP.mcpack`
2. Open each file with Minecraft (it imports automatically), or copy the folders into
   `development_behavior_packs/` and `development_resource_packs/` in your
   `com.mojang` directory.
3. In your world settings, enable **both** packs. Under **Experiments**, make sure
   **Beta APIs** is ON (required for the script that grants the eating effects).

## Notes

- Hunger restoration works purely from the item JSON; the bonus potion effects come from
  `behavior_pack/scripts/main.js` via the Script API, so the behavior pack must be active.
- Identifiers use the `mm:` namespace.
