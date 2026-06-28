# Cheat Feather Menu — Minecraft Bedrock Addon

You get a **Cheat Feather**. Use it to open a cheat menu whose toggles **actually work**.
Designed for your own worlds / private realms and trolling friends.

## Cheats (all functional)
| Toggle | What it really does |
|---|---|
| Aimbot | Snaps your view onto the nearest player or mob every 0.1s |
| Bow Aimbot | Same, locked to the nearest player (PvP) |
| Trigger Bot | Auto-damages whatever your crosshair is on |
| Auto Clicker | Faster auto-damage on your crosshair target |
| Kill Aura | Damages every entity within range, no aiming needed |
| Reach | Extends combat/trigger range from 4 → 7 blocks |
| Velocity (Anti-Knockback) | Cancels knockback the instant you're hit |
| Fly | Grants creative-style flight (`mayfly`) |
| No Fall Damage | Instantly heals any fall damage |
| ESP / Radar | Lists nearby players & mobs (through walls) with distance + direction in the action bar |

## Settings menu
Open the menu → **⚙ Settings** to tune:
- **Reach / attack distance** (2–8 blocks) — trigger bot defaults to a realistic 4.
- **Attacks per second (CPS)** (1–20) — how fast trigger bot / auto clicker / kill aura hit.
- **Aimbot lock-on range** (5–32 blocks).
- **Aimbot targets** — Mobs + Players / Mobs only / Players only. Aimbot locks onto **mobs**.

## Flight
Fly uses effects (no `/ability` needed, works on any world): **look up to rise, look level to
hover, look down to descend.** You never take fall damage while flying.

## Honest limitations of the Bedrock Script API
- **ESP can't draw boxes/outlines through walls** — the API has no rendering access, so it's a
  live **text radar** instead. That's as close as an addon can get.
- **Aimbot moves your real camera** (it sets your rotation) — you'll see your view snap.
- This addon only runs in a **world where it's installed**. It cannot be injected into servers
  you don't host, and won't work against people who aren't in your world.

## Install
1. Open **`Cheat Feather Menu.mcaddon`** on a device with Minecraft Bedrock — it imports itself.
2. Create/edit a world → **Behavior Packs** → activate **Cheat Feather Menu**.
3. In world settings turn **ON**:
   - **Beta APIs** (Experiments) — required, the cheats use the Script API.
4. Play. You're handed a Cheat Feather on spawn. Lost it? Type `!feather` in chat or
   `/give @s fcm:cheat_feather`.

## Notes
- Requires Bedrock **1.21.0+** with the **Beta APIs** experiment.
- Ships a resource pack so the feather has its own texture and the pack has an icon. Enabling
  the behavior pack auto-pulls the resource pack (it's listed as a dependency).
- Script modules: `@minecraft/server 1.11.0`, `@minecraft/server-ui 1.2.0`. Bump these in
  `CheatFeatherBP/manifest.json` if a newer Minecraft rejects them.
