# The Smiling Man — Minecraft Bedrock Add-On

A slow-burn psychological-horror stalking entity that watches the player over
multiple in-game nights, escalating from distant observation to limited hunts.

## Install
1. Double-click `The_Smiling_Man.mcaddon` (it imports the behavior + resource pack).
2. Create/edit a world. In **Behavior Packs** and **Resource Packs**, activate
   "The Smiling Man".
3. Enable the experimental toggle **Beta APIs** (the entity AI uses the
   `@minecraft/server` scripting API).
4. Enter the world. The script logs `[SmilingMan] loaded` to the content log.

## How it plays
The entity (`sm:smiling_man`) spawns rarely at night, 60–150 blocks away in
forests/hills/village edges. It **freezes the instant you look at it** and only
moves while unobserved. Surviving nights advances the phase automatically:

| Nights survived | Phase | Behavior |
|---|---|---|
| 0–1 | 1 Distant observation | far away, vanishes before contact |
| 2–3 | 2 Stalking | spawns closer, breathing/whispers |
| 4–5 | 3 House manipulation | opens doors, appears indoors |
| 6–7 | 4 Scare events | doorburst, back-spawns, bed scares |
| 8+  | 5 Final hunt | aggressive, breaks weak blocks, chases |

## Developer commands
Run with `/function <name>` (cheats on). They dispatch to the script via
`scriptevent`.

**Control:** `sm_spawn`, `sm_despawn`, `sm_reset`
**Phase:** `sm_phase_1` … `sm_phase_4`, `sm_phase_final`
**Scares:** `sm_event_doorburst`, `sm_event_windowwatch`, `sm_event_backspawn`,
`sm_event_backspawnlookdown`, `sm_event_windowmurder`
**Speed:** `sm_speed_slow`, `sm_speed_normal`, `sm_speed_fast`, `sm_speed_scare`
**Blocks:** `sm_break_test`, `sm_no_break`, `sm_allow_break`, `sm_open_door_test`
**Debug:** `sm_debug_on`, `sm_debug_off`, `sm_lock_ai`, `sm_unlock_ai`

## Notes / limitations
- Targets **Bedrock 1.21** / `@minecraft/server` 1.13. If your version differs,
  bump the module version in `SmilingMan_BP/manifest.json`.
- Sounds map to existing **vanilla** sound events (no custom audio shipped).
- The texture/model are functional procedural placeholders (pale, tall, hunched,
  wide smile); swap `textures/entity/smiling_man.png` for custom art anytime.
- Movement in phases 1–4 is script-driven (teleport stepping) so the look-freeze
  is exact; phase 5 uses vanilla pathfinding for real chasing.
- Built and reviewed across 7 model endpoints; **not yet play-tested inside a
  live Bedrock client** — verify in-game and tune timings to taste.
