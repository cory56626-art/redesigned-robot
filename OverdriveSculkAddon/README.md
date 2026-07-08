# Overdrive Sculk

A Minecraft **Bedrock** add-on whose entire gameplay is driven by the
**Script API (JavaScript)**. Place a single **Overdrive Sculk** block and an
unstoppable corruption begins — it grows **forever** with **no radius limit and
no distance cap**. Only two things govern it: **spread speed** and **total block
count**, exactly as specified.

The whole thing ships as one importable file: **`dist/OverdriveSculk.mcaddon`**.

---

## Install

1. Build (or use the pre-built file in `dist/`):
   ```bash
   python3 tools/build.py
   ```
   This regenerates the textures and writes `dist/OverdriveSculk.mcaddon`.
2. On a device with Minecraft Bedrock installed, open
   `OverdriveSculk.mcaddon`. Minecraft imports both packs automatically.
3. Create/edit a world and enable **both** packs (enabling the behavior pack
   will prompt to add the resource pack). **Beta APIs are *not* required** — the
   add-on only uses stable `@minecraft/server`.
4. Place the **Overdrive Sculk** block (creative inventory → Nature) to trigger
   Level 1.

> Requires Minecraft Bedrock `1.21.0`+ with the default *"Custom"* / scripting
> capabilities enabled for the world (the manifest declares the script module,
> so this happens automatically on import).

---

## How the infection works

The corruption is modelled as a rolling **frontier** — the set of sculk blocks
that still have room to grow. Each spread cycle picks random frontier blocks and
converts a neighbouring block into Overdrive Sculk, so the mass keeps expanding
outward with no bounds. The frontier is capped **only** for performance (it is
the growing *edge*, not the whole mass); the corruption itself is unlimited.

* **Trigger:** placing the block (Level 1) or reaching a block-count threshold.
* **Spread speed** and **spread amount** come purely from the current level.
* Water is only consumed from **Level 12+**; lava and protected blocks
  (bedrock, command blocks, etc.) are never consumed.

### The 15 levels

| Lvl | Trigger (blocks) | Interval | Spread amount | Unlocks |
|----:|-----------------:|:--------:|:-------------:|---------|
| 1  | placement | 15 s   | 5–8   | — |
| 2  | 100  | 12 s   | 8–12  | Vine Grab (25%), Infected Sculked Zombies |
| 3  | 200  | 10 s   | 10–15 | Tentacles attack mobs |
| 4  | 300  | 9 s    | 12–18 | Burst spreads (20–25), tentacles more often |
| 5  | 400  | 8 s    | 15–20 | Vine Grab → 30% |
| 6  | 500  | 7 s    | 18–25 | Infected Skeletons |
| 7  | 600  | 6 s    | 20–28 | Infected Creepers |
| 8  | 700  | 5 s    | 22–30 | Tentacles gain longer reach |
| 9  | 800  | 4 s    | 25–35 | Vine Grab → 35% |
| 10 | 900  | 3.5 s  | 28–40 | Rumbling sounds |
| 11 | 1000 | 3 s    | 30–45 | 5–10% chance to spawn a Warden |
| 12 | 1200 | 2.5 s  | 35–50 | Spreads through water |
| 13 | 1500 | 2 s    | 40–55 | Overdrive Nodes (mini hearts) |
| 14 | 1800 | 1.5 s  | 45–60 | Overdrive Fog (visual tint) |
| 15 | 2000 | 1 s    | 50–70 | Maximum aggression — all behaviors active |

### Vine Grab & energy (Level 2+)

Once per second, any mob standing on Overdrive Sculk can be seized:

* An **Overdrive Vine** entity erupts (grab animation), drags the mob **1–2
  blocks down**, then kills it normally.
* Each grab feeds **energy** into the infection.
* **Every 10 energy:** spread interval **−0.5 s** (floored at 1 s, the global
  minimum) and spread amount minimum **+2** (never above the level's max).
* Energy milestones can birth an **Infected Wither** (Level 11+, rare, capped).

Vine Grab chance ramps at the specified breakpoints: **25%** (L2), **30%** (L5),
**35%** (L9), **40%** (L15).

**Mobs** caught by a grab are dragged down and killed. **Players** are instead
**rooted in a struggle**: slowed, slowly damaged (2–3/s), and must **spam jump
to tear free** (4–8 jumps depending on level). It never instantly kills you, and
creative/spectator players are never grabbed.

### Custom mobs (JavaScript behaviors)

* **Infected Sculked Zombie**, **Infected Skeleton**, **Infected Creeper** —
  custom entities spawned near the player on real sculk, with corrupted skins.
* **Tentacle** — anchored to the sculk; melee-only attacks driven **in script**
  (reach 1.9–2.8, grows slightly at L8), on a 1.5s cooldown.
* **Overdrive Vine** — the self-cleaning grab entity.

> **Wither and Warden are never summoned** by the infection.

### Visuals & audio

* **Pulsing sculk** via a 4-frame animated flipbook and animated veins baked
  into the block texture.
* **Tentacle idle + attack** animations (attack state toggled by a
  script-set entity property).
* **Rumbling** (Level 10+) and **Overdrive Fog** (Level 14+), plus level-up
  titles/sounds — all reusing vanilla audio through the Script API (no binary
  sound files shipped).

---

## Admin / test commands

Run these in chat (cheats on). `/scriptevent overdrive:help` prints the list
in-game.

| Command | Effect |
|---------|--------|
| `/scriptevent overdrive:help` | List every command |
| `/scriptevent overdrive:status` | Print live stats (level, blocks, energy, interval, frontier) |
| `/scriptevent overdrive:reset` | Wipe the infection state |
| `/scriptevent overdrive:level <1-15>` | Jump straight to a level |
| `/scriptevent overdrive:energy <n>` | Set the energy value |
| `/scriptevent overdrive:addblocks <n>` | Add to the block count (test level triggers instantly) |
| `/scriptevent overdrive:spread [n]` | Force `n` spread cycles right now (default 1) |
| `/scriptevent overdrive:seedhere` | Plant sculk under every player (quick start) |
| `/scriptevent overdrive:spawn <type>` | Spawn `zombie`/`skeleton`/`creeper`/`tentacle`/`vine`/`wither`/`warden` at you |
| `/scriptevent overdrive:grab` | Force a Vine Grab pass on nearby mobs |
| `/scriptevent overdrive:node` | Place an Overdrive Node at you |
| `/scriptevent overdrive:fog <on\|off>` | Toggle the Overdrive Fog |
| `/scriptevent overdrive:rumble` | Play the rumble now |
| `/scriptevent overdrive:clearmobs` | Remove all Overdrive mobs (use if a test over-spawned) |

State (level, block count, energy, frontier) is persisted in world dynamic
properties, so an infection resumes after the world reloads.

### Tuning notes (v1.2)

* **Growth spreads freely in every direction** (fully random), burrowing
  underground and creeping outward — the full 50–70 blocks/second at Level 15.
* **Mobs spawn on real sculk near you.** The spawner scans a 4–24 block ring
  around a player for Overdrive Sculk with air above, so the army reliably
  erupts wherever the corruption has reached you (fixes the "L15 spawns
  nothing" case). Populations stay small and level-scaled — caps ~1 early,
  reaching their low maximums by Level 12.
* **Tentacles are melee only.** Attack reach is 1.9–2.8 blocks (grows slightly
  at Level 8), so you must be right next to one — no more cross-room hits.
  Creative/spectator players are never targeted.
* **Infected mobs seed the ground** as they roam — much more aggressively when
  no player is close — so the corruption keeps taking territory while away.
* **All custom mobs are animated** via custom geometry + Molang walk/idle
  animations (legs/arms swing when moving, subtle idle sway when still).

---

## Project layout

```
OverdriveSculkAddon/
├── behavior_pack/           # data + JavaScript (the brain)
│   ├── blocks/              # Overdrive Sculk & Overdrive Node
│   ├── entities/            # custom mob behavior definitions
│   └── scripts/             # Script API modules (main, infection, mobs, vinegrab, effects, config)
├── resource_pack/           # textures, models, animations, fog, lang
├── tools/
│   ├── gen_assets.py        # procedural texture/icon generator (pure Python, no deps)
│   └── build.py             # zips everything into dist/OverdriveSculk.mcaddon
└── dist/OverdriveSculk.mcaddon
```

### Notes on interpretation

The spec's energy rule says the interval must never drop "below level minimum"
and the amount must never exceed "level max." Those are implemented as: interval
is floored at the global minimum of **1 s** (the Level 15 speed), and the
per-roll minimum is raised toward — but never past — the current level's maximum
spread amount.
