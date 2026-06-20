# Entity Verity — Minecraft Bedrock Add-On

A single hostile horror mob. No items, no drops, no taming, no evolution, no
dialogue, no extra systems — just **Verity**.

> Identifier: `verity:entity_verity`

## What it does

| Spec | Implementation |
|------|----------------|
| **Appearance** | Tall (≈3 blocks), thin, smooth ochre humanoid: small bowed egg-shaped head with a blank face, narrow sloped shoulders, long slightly-bent hanging arms, long thin legs. Custom geometry + texture. |
| **Idle movement** | Stands still with small random twitches and the occasional sharp head jerk (`idle_twitch`). |
| **On detection** | Freezes in place and shakes violently for ~1 second (`detect_shake`), staring at the player, then snaps into the chase. |
| **Chase movement** | Snappy jitter-sprint — very fast, jerky micro-offset "teleport burst" jitter (`jitter_sprint`, instant state blends). |
| **Climb** | `can_climb` lets it scale ladders/walls; when the target is well above, it plays a wall-`climb` animation (script-driven state). |
| **Window breach** | While chasing, if you hide in a building with glass, Verity **vanishes**, reappears **outside the nearest window**, **breaks it "with its face"**, then **crawls through** the opening (`crawl`). Scripted via `@minecraft/server`. |
| **Behavior** | Always knows the player's location (`nearest_attackable_target`, `must_see: false`, 256-block range). Constantly hunts. No retreat, wandering, or panic. |
| **Audio** | Silent when idle/alert. Loud, continuous, distorted scream while chasing; volume rises with proximity via 3D attenuation. |
| **Combat** | Melee **4 hearts** (8 damage), snappy attack rate (0.18s cooldown), fast movement (0.55). |
| **No weaknesses** | Fire/lava immune, immune to drowning & suffocation, full knockback resistance, tanky. |
| **Spawning** | Spawns naturally at night in dark areas (surface, light 0–4). |

### Scripted behavior modes

The base mob is pure data (jitter-sprint chase + scream + melee) and runs
without scripts. Everything around the chase is added by
`behavior_pack/scripts/main.js` using the **`@minecraft/server`** Script API.
Animation is exposed to the model through the int property `verity:anim`
(0 idle, 1 alert, 2 chase, 3 climb, 4 crawl, 5 phase, 6 transform, 7 mirror,
8 stare, 9 snap).

| Mode | What happens |
|------|--------------|
| **Stalk → transform → charge** | Detected at ≤14 blocks with line-of-sight: Verity stares (silent) ~3s, then **bone-cracks** while it twists its spine and folds into a crouch, then charges. |
| **House breach** | While chasing, if Verity can't close the distance (you're walled in), it crawls to the nearest **door**, opens it, crawls in, stops a few blocks away, stares ~3s, snaps upright, and chases. |
| **Window breach** | While chasing near glass: vanish → reappear outside → smash the pane "with its face" → crawl in (~4.4s). |
| **Mineshaft ambush** | When Verity is above you with an open exit overhead, it waits silently, then leans/snaps and charges when you get close. |
| **Climb** | Real scripted wall-climb (Bedrock `can_climb` only does ladders), via a refreshed levitation while against a wall. |

### Commands (`/scriptevent`)

Run these from chat or a command block:

| Command | Effect |
|---------|--------|
| `/scriptevent verity:spawn` | Spawn Verity 20 blocks away. |
| `/scriptevent verity:come` | Make the nearest Verity creep toward you. |
| `/scriptevent verity:chase` | Force instant chase. |
| `/scriptevent verity:stop` | Freeze it until it detects you again. |
| `/scriptevent verity:door` | Run the door house-breach now. |
| `/scriptevent verity:glass` | Run the window breach on the nearest glass. |

Only `spawn`/`come`/`chase` spawn; the rest act on the nearest existing Verity
(spawning one 20 blocks away only if none exists). The matching `!verity…` chat
commands also work on game versions that support chat scripting.

> The manifest depends on `@minecraft/server` version `1.11.0`. If a future
> Minecraft version rejects that, bump the version in
> `behavior_pack/manifest.json` to the one your game ships. Scripts also must be
> allowed on the world (default for normal Bedrock worlds).

## Structure

```
entity_verity/
├── behavior_pack/        (server logic)
│   ├── manifest.json
│   ├── entities/entity_verity.json
│   ├── spawn_rules/entity_verity.json
│   └── scripts/main.js   (window breach / climb / crawl)
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
