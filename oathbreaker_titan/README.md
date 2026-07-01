# ⚔ Oathbreaker Titan — Minecraft Bedrock Boss Addon

A Kratos-inspired (non-horror) boss fight for Minecraft Bedrock 1.21+.
A towering molten-core warrior with a greatsword, phase changes, a parry
that punishes button-mashing, and a final stand you can interrupt by
striking his glowing chest core.

## Install

Open `Oathbreaker_Titan.mcaddon` with Minecraft (double-tap/click it), then
enable **both** packs on your world:

- `Oathbreaker Titan [BP]` (behavior pack — requires **Beta APIs OFF**, uses stable Script API)
- `Oathbreaker Titan [RP]` (resource pack)

## Summoning the Titan

1. Craft a **Molten Heart** block: 8 × magma block around 1 × gold block.
2. Craft a **Forged Oath**: gold ingots + iron ingots around paper, with
   blaze powder on top.
3. Build a **stone arena** — a floor of stone-family blocks (stone,
   cobblestone, deepslate, bricks, blackstone…) around the placed
   Molten Heart.
4. Use the Forged Oath on the Molten Heart. The heart burns out, and the
   **Oathbreaker Titan** rises.

You can also spawn him from the creative spawn egg for testing.

## The Fight

| Move | Trigger | Counterplay |
|---|---|---|
| **Titan Cleave** | You're within ~6 blocks | Back off, or block with a shield (crouch) — reduced damage, but the force staggers you |
| **Earthsplitter Leap** | Every ~13s, mid range | He tracks you in the air, but the landing point locks shortly before impact — sprint sideways at the last moment, then **dodge the shockwave line** sideways or jump it |
| **Oathbound Parry** | 3 hits on him within 1.5s | Don't spam — pace your attacks or he parries and instantly counters |
| **Rage Phase** | 50% HP | He speeds up, hits harder, gains a **fiery dash**, and the arena cracks with flame |
| **Final Judgment** | 10% HP | 6-second charge — **strike the glowing chest core (from the front!)** to interrupt and stun him. Fail, and a massive blast follows |

- 300 hearts, boss bar, immune to fire/lava/fall/drowning, knockback-proof.
- Shockwave and Final Judgment explosion do **not** break blocks (arena-safe).

## Drops

- **Titan Core** ×1–2 — repairs the blade
- **Oathbreaker Blade** — greatsword, +11 damage, enchantable
- **Titan Crest** — trophy
- 500 XP

## Repo layout

- `OathbreakerTitan_BP/` — behavior pack (entity, items, block, recipes, loot, boss AI script)
- `OathbreakerTitan_RP/` — resource pack (model, textures, animations)
- `tools/generate_textures.py` — regenerates all textures/icons (needs Pillow)
- `tools/build_mcaddon.sh` — rebuilds `Oathbreaker_Titan.mcaddon`
