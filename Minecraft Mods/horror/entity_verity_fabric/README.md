# Entity Verity — Fabric mod (Minecraft Java 1.20.1)

A Java port of the Verity horror mob (originally a Bedrock add-on). Built with
**Fabric** + **GeckoLib** (which reuses the same Bedrock model/animation/texture).

## Install (players)
Drop these three jars into your `.minecraft/mods/` folder (Fabric loader for 1.20.1):
1. **Entity_Verity-fabric-1.20.1.jar** (this mod)
2. **Fabric API** (1.20.1) — https://modrinth.com/mod/fabric-api
3. **GeckoLib 4.4.x** (1.20.1 Fabric) — https://modrinth.com/mod/geckolib

Then launch the Fabric 1.20.1 profile.

## What it does
- Tall yellow humanoid; spawns at night in the dark; 4-heart fast melee; loud scream while chasing; fire/knockback immune; 120 HP.
- Stalk → bone-cracking transform → charge when you're within ~14 blocks with line of sight.
- Window/door breach (rolls a die) when it can't reach a hiding player; climbs walls; mineshaft ambush.

## Commands
`/verity spawn` · `/verity come` · `/verity chase` · `/verity stop` · `/verity door` · `/verity glass`
(only `spawn` always spawns; the rest control the nearest Verity, spawning one 20 blocks away if none exists.)

## Build from source
```
./gradlew build      # uses the bundled Gradle 8.8 wrapper + Loom 1.7.4
```
Output: `build/libs/entity_verity-1.0.0.jar`.

> The smile from the stalk is not rendered — it would require editing the texture/model.
