# Entity Verity — Minecraft Bedrock Add-On

A single hostile horror mob. No items, no drops, no taming, no evolution, no
dialogue, no extra systems — just **Verity**.

> Identifier: `verity:entity_verity`

## What it does

| Spec | Implementation |
|------|----------------|
| **Appearance** | Tall (≈2.9 blocks), thin, yellow humanoid with long limbs and a blank/distorted dark face. Custom geometry + texture. |
| **Idle movement** | Stands still with small random twitches (`idle_twitch` animation). |
| **On detection** | Freezes in place and shakes violently for ~1 second (`detect_shake` animation), staring at the player, then launches into the chase. |
| **Chase movement** | Jitter-sprint — very fast movement with jerky micro-offset "teleport burst" jitter (`jitter_sprint` animation + high movement speed). |
| **Behavior** | Always knows the player's location (`nearest_attackable_target` with `must_see: false`, 256-block range). Constantly hunts. No retreat, no wandering, no panic behaviors. |
| **Audio** | Silent when idle. Loud, continuous, distorted scream while chasing (`ambient` event looped at 0s interval). Volume rises as he gets closer via normal 3D distance attenuation. |
| **Combat** | Melee damage of **4 hearts** (8 damage). Fast attack rate (0.25s cooldown). |
| **No weaknesses** | Fire/lava immune, immune to drowning & suffocation, full knockback resistance, tanky health. |
| **Spawning** | Spawns naturally at night in dark areas (surface, light level 0–4). |

## Structure

```
entity_verity/
├── behavior_pack/        (server logic)
│   ├── manifest.json
│   ├── entities/entity_verity.json
│   └── spawn_rules/entity_verity.json
└── resource_pack/        (appearance + audio)
    ├── manifest.json
    ├── entity/entity_verity.json
    ├── models/entity/entity_verity.geo.json
    ├── render_controllers/entity_verity.render_controllers.json
    ├── animations/entity_verity.animation.json
    ├── animation_controllers/entity_verity.animation_controllers.json
    ├── textures/entity/entity_verity.png
    ├── sounds.json
    ├── sounds/sound_definitions.json
    └── texts/en_US.lang
```

## Installation

**Easiest:** double-click `Entity_Verity.mcaddon` to import both packs into
Minecraft, then enable them on your world.

**Manual:** copy `behavior_pack/` into your world's `behavior_packs/` folder and
`resource_pack/` into `resource_packs/`, then enable **both** packs (the
behavior pack depends on the resource pack).

The chase scream (`scream.ogg`) is bundled. To use your own, replace
`resource_pack/sounds/mob/entity_verity/scream.ogg` with any `.ogg` file.
