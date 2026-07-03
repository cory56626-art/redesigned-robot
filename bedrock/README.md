# The Marauder — Bedrock Edition (.mcaddon)

A Bedrock port of the Marauder mod: the same ten-night cursed **flame-knight**
rivalry, rebuilt as a Bedrock **behavior + resource pack** driven by the
`@minecraft/server` Script API. The flame-knight model, staged textures and
animations are shared with the Java version.

> This is an offshoot of the Java/Fabric mod in the repo root. It is a separate
> engine and a separate codebase — it does **not** share any Java code.

## Requirements

- **Minecraft Bedrock 1.20.60+** (the script module targets `@minecraft/server`
  `1.8.0`; see "Version compatibility" below).
- No experimental toggles are required for the stable script API, but you must
  **add both packs to your world**.

## Install

1. Open `marauder-bedrock.mcaddon` with Minecraft (or import it in the app). It
   installs both the behavior pack and the resource pack.
2. Create/edit a world → **Behavior Packs**: add *The Marauder (Behavior)*. The
   resource pack is applied automatically (it's a dependency); if not, add *The
   Marauder (Resources)* under **Resource Packs**.
3. Play. The hunt begins at dusk.

## How it plays

- At night in the Overworld, a staged Marauder spawns near you and hunts you
  (native `nearest_attackable_target` + `melee_attack`), with scripted,
  telegraphed abilities: a **flame shockwave**, a **beam** (stage 5+), and
  **lunges**. Defeating it advances your stage for the next night; one attempt
  per night. Stages 7–10 show a **boss bar**.
- Progress is stored **per player** via dynamic properties and persists across
  reloads. Health/damage/speed scale by stage via component groups.
- The knight evolves visually: the **spiked crown** appears at stage 4, the
  **fiery halo** and a second arm-pair at 6, a third arm-pair at 8 — the full
  **six-armed crowned form** at Night 10 — with the molten glow intensifying each
  stage (driven by the synced `marauder:stage` entity property in the render
  controller).
- Night 10 drops **Marauder's Blacksteel Blade** (a custom item).

## Testing commands

Bedrock has no custom slash commands, so tests are exposed as **script events**.
Run these in chat (cheats on):

| Command | Effect |
| --- | --- |
| `/scriptevent marauder:duel <1-10>` | Spawn a Marauder of that stage that fights immediately |
| `/scriptevent marauder:spawn <1-10>` | Spawn one that hunts you |
| `/scriptevent marauder:setstage <1-10>` | Set your persistent stage |
| `/scriptevent marauder:stage` | Print your progress |
| `/scriptevent marauder:reset` | Reset to Stage 1 |
| `/scriptevent marauder:rematch` | Arm a Night-10 rematch |
| `/scriptevent marauder:clear` | Remove your active Marauder |

There is also a **spawn egg** in the creative inventory.

## Version compatibility

Bedrock ties the script module version to the game version. This pack declares
`@minecraft/server` `1.8.0` (Bedrock ~1.20.60–1.20.71) in
`behavior_packs/marauder_bp/manifest.json`. If you run a newer Bedrock version and
the pack reports a script API error, bump that dependency `version` to the one
your game ships (e.g. `1.9.0`, `1.10.0`, …) and re-import.

## Repackaging

The addon is `marauder-bedrock.mcaddon` (a zip of the two pack folders). To rebuild
after edits:

```bash
cd bedrock
python3 tools/gen_entity.py   # regenerate the staged entity JSON, if changed
# then zip the two pack folders (marauder_bp, marauder_rp) at the archive root
```

## Notes / limits

- This was authored and JSON/'script-syntax'-validated, but **could not be
  runtime-tested** in this environment (no Bedrock client/server here). Please try
  `/scriptevent marauder:duel 3` in-game and report anything off.
- The stalk/ambush nuance of the Java version is approximated: the Bedrock entity
  hunts the nearest player natively while the script drives spawning, staging,
  abilities and progression.
