# Warden Zombie Companion

A Minecraft **Bedrock** add-on that adds a genuinely smart, loyal **Guardian Zombie**
you summon with a custom **Warden Staff**. It is your friend: it fights what you
fight, defends you, blocks arrows with its shield, walls itself in when shot, and
times jumps to land critical hits — all on top of upgraded vanilla mob pathfinding.

- **Engine:** Minecraft Bedrock **1.21.0+**
- **Scripting:** `@minecraft/server` **1.13.0** (stable — **no experiments need to be enabled**)
- **Packs:** one behavior pack + one resource pack (both required)

---

## What you get

| Item | ID | How to obtain |
|------|----|----|
| Warden Staff (summons a guardian) | `wac:warden_staff` | Craft, or `/give @s wac:warden_staff` |
| Stamping Sword (the guardian's weapon — you can wield it too) | `wac:stamping_sword` | Craft, or `/give @s wac:stamping_sword` |
| Guardian Zombie | `wac:guardian_zombie` | Summoned by the Warden Staff |

### Crafting

**Warden Staff** (vertical):

```
[ Echo Shard ]
[   Stick    ]
[ Iron Ingot ]
```

**Stamping Sword** (vertical):

```
[ Iron Block ]
[ Iron Block ]
[   Stick    ]
```

---

## How to use

1. Install both packs (see below) and apply them to your world.
2. Get a Warden Staff (craft it or `/give @s wac:warden_staff`).
3. **Use** the staff (right-click on PC / hold-to-use on touch / left-trigger on
   controller). A fully-armored Guardian Zombie rises in front of you and is bound
   to you as its owner.
4. It now follows you, fights whatever you fight, and defends you automatically.

You can summon up to **3** guardians at once (configurable). The staff has a short
4-second cooldown between summons.

---

## What makes it "smart"

This is not "vanilla zombie + a couple of tweaks." The base entity keeps **normal
mob pathfinding but upgraded**, and a script layer adds real tactical behavior.

**Upgraded pathfinding / movement (entity components)**
- Faster move speed, large 48-block follow range, opens doors, paths over water,
  climbs, avoids damage blocks.
- **Stuck-hop assist (script):** if it has a goal but stops making progress, it
  hops to clear steps/obstacles instead of grinding against a wall.
- **Teleport-to-owner failsafe (script):** if it isn't fighting and falls more
  than 26 blocks behind (or you change dimension), it snaps back to you — it never
  gets permanently lost.

**Friendly target selection**
- Attack something and your guardians instantly focus that target ("attack whoever
  you attack").
- Hit *you* and the attacker is marked for every guardian to swarm.
- Hurt a guardian and it retaliates.
- Owners are permanently flagged so a guardian **can never be turned against its
  owner or another guardian** — friendly fire is impossible.
- Targets are acquired with an upgraded `nearest_attackable_target` that reads a
  dynamic "enemy" tag, so the vanilla pathfinder does the actual chasing/reaching.

**Shield blocking (script, every tick)**
- Scans for incoming projectiles (arrows, tridents, fireballs, snowballs, shulker
  bullets, llama spit, …) and intercepts any that are **actually heading at it and
  inside its frontal arc**, destroying them with a shield-block sound + spark.
- Shots from the side or behind get through, so positioning matters — and your own
  arrows fired from behind it are never blocked. It's a real shield, not blanket
  immunity.

**Reactive walls (script)**
- When it takes ranged damage it figures out the shooter's direction and **rapidly
  stacks a 3-wide, 3-tall cobblestone wall** between itself and the threat (placed a
  few blocks per tick so it goes up fast rather than popping in instantly).
- Walls only replace **air** (never your builds) and **auto-remove after 12 seconds**,
  so there's no griefing or block litter.

**Jump-crits (script)**
- When closing on a target it will sometimes **leap**, then the descending strike
  deals bonus **critical** damage with crit particles and an anvil "crunch" — the
  same idea as a player jump-crit, made deliberate.

**Stamping Sword**
- Its iron-tier weapon (you can use it too): every hit delivers a heavy **stagger** —
  extra knockback plus brief slowness — so enemies get stomped back.

**Survivability**
- 40 HP, full iron armor, high knockback resistance, takes lava damage like a real
  mob, and **slowly self-heals** when out of danger. Tamed, so it persists and
  doesn't despawn.

---

## Installation

### Option A — import the `.mcaddon` (easiest)
1. Run `./package.sh` to build `WardenZombieCompanion.mcaddon` (or download it if
   provided).
2. Open the file with Minecraft (double-click on PC, or "Open with Minecraft" on
   mobile). It imports both packs automatically.
3. Create/edit a world → **Behavior Packs** → activate "Warden Zombie Companion BP"
   (the resource pack is pulled in automatically; activate it too if prompted).
4. No experimental toggles are required.

### Option B — manual (development folders)
Copy the two folders into your Bedrock `development_*` packs directories:

- `behavior_pack/` → `development_behavior_packs/WardenZombieCompanion_BP`
- `resource_pack/` → `development_resource_packs/WardenZombieCompanion_RP`

Then enable both packs on your world.

---

## Tuning

All gameplay constants live at the top of
`behavior_pack/scripts/main.js` — e.g. `MAX_PER_OWNER`, `ENEMY_DURATION`,
`WALL_LIFETIME`, `WALL_COOLDOWN`, `CRIT_CHANCE`, `CRIT_COOLDOWN`, `REGEN_INTERVAL`.
Entity stats (health, speed, damage, follow range, navigation flags) live in
`behavior_pack/entities/guardian_zombie.json`.

---

## Notes & limitations

- **Rendering:** the guardian uses `runtime_identifier: "minecraft:zombie"`, so it
  renders as a normal zombie and its **iron armor and Stamping Sword show in-world**,
  fully animated.
- **Shield model:** the shield is equipped in the off-hand and its blocking is fully
  functional, but Bedrock does not reliably render an off-hand shield on a *mob's*
  body, so the block is communicated with a shield-block sound + spark rather than a
  visible raised shield. The mechanic works regardless.
- Built and verified against `@minecraft/server` **1.13.0** (Bedrock 1.21). If you're
  on a newer engine and the script logs a module-version error, bump the version in
  `behavior_pack/manifest.json` to the matching `@minecraft/server` version.
