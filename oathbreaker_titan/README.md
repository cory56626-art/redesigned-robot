# ⚔ Oathbreaker Titan — Minecraft Bedrock Boss Addon

A Kratos-inspired (non-horror) boss fight for Minecraft Bedrock 1.21+.
A human-sized, fast molten-core warrior with a greatsword, phase changes,
a parry that punishes button-mashing, a shield-breaker that punishes
turtling, a grapple with a whiff-punish window, and a final stand you can
interrupt by striking his glowing chest core.

## Install

**If you had an older version installed, clean it out first** — stale pack
copies cause broken animations/missing textures: in Minecraft go to
*Settings → Storage → Cached Data / Resource Packs / Behavior Packs* and
delete every old "Oathbreaker Titan" entry, and remove them from the world's
pack lists. Then:

Open `Oathbreaker_Titan.mcaddon` with Minecraft (double-tap/click it), then
enable **both** packs on your world:

- `Oathbreaker Titan v2 [BP]` (behavior pack — requires **Beta APIs OFF**, uses stable Script API)
- `Oathbreaker Titan v2 [RP]` (resource pack)

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
| **Skybreaker** | You spend too much time airborne (jump-spam, towers, elytra) | The leap becomes a snatch: he rips you out of the air, slams you down, **drags you across the ground for 5 seconds**, then pins you and lands **three 5-damage punches** before discarding you — 35 damage total if you eat all of it. Stay grounded, or dodge the landing |
| **Aegis Return** | 3 projectile hits within 6s | He parries **any projectile** — arrows, tridents, wither skulls, fireballs, shulker bullets — and returns fire at the shooter with **5× the source projectile's damage** (a returned trident hits for 40). Stop shooting when he braces, or reposition fast |
| **Oathbound Parry** | 3 hits on him within 1.5s | Don't spam — pace your attacks or he parries and instantly counters |
| **Groundbreaker Throw** | You stay at range | He rips a boulder from the arena floor and hurls it (with lead) — strafe, or block it with your shield |
| **Core Minis** | Every ~28s | He splinters his core into small grounded ember-titans (vex-like, can't fly, expire after 45s, die with him) — cut them down fast |
| **Oathcrusher Smash** | Turtling behind a shield near him | He raises the greatsword and slams it down — **2× damage and a stun if your shield is up**. Drop guard and dodge instead |
| **Titan Grapple** | Mid-close range | He lunges to grab you: connect = hoisted and slammed into the ground (ignores shields). If he **misses, he stumbles** — free punish window, and your hits land 50% harder |
| **Molten Explosion** | You linger in his face | ~0.7s charge (flames spiral into his core), then an eruption: **15 damage in 6 blocks, sets everything on fire**, hurls chunks of the arena into the sky. Sprint out when you hear the fuse |
| **Skyhurl Rush** | Mid range | He charges forward; if he catches you he hoists you overhead, **throws you sky-high, then spikes you back into the earth** (~18 damage + grab). Sidestep the charge — he skids past |
| **Rage Phase** | 50% HP | He speeds up, gains the **fiery dash**, the arena cracks with flame, and **every ability hits 30% harder** (Molten Explosion ~20, Titan Cleave ~16...) |
| **Final Judgment** | 10% HP | 6-second charge — **strike the glowing chest core (from the front!)** to interrupt and stun him. Fail, and a massive blast follows |

## 👑 The Final Form: The Obsidian Overlord

Killing the Titan doesn't end the fight — **he refuses death**. The corpse
vanishes in ash and thunder, and the **Obsidian Overlord** rises: jagged
black obsidian armor veined with pulsing blue lava, two wings of ash and
blue fire, and a single fused greatsword dripping liquid blue flame that
trails behind him as he moves. 350 hearts, second boss bar, darkened sky,
and **immune to his own Hellfire Clone explosions**.
**All drops and the big XP come from killing the final form.**

| Mythic Ability | What it does | Counterplay |
|---|---|---|
| **World-Ender Meteor** | Roars skyward and vanishes; smoke and a shrinking flame ring mark the impact | ~2s to sprint out of the ring before he crashes down like a tactical nuke (up to 30 damage, screen-shaking, block-safe) |
| **The Gravity Well** | Slams the greatsword down and opens a vortex that drags everything within 12 blocks toward him, pinning whatever reaches the center | Sprint-jump against the pull at the rim; the trapped get detonated by the follow-up burst (18 + fire) |
| **Hellfire Clones** | Summons 3–4 sprinting magma duplicates that explode on contact (14 + fire, no block damage) | Kill them at range (30 HP) or kite them into each other |
| **The Executioner's Chain** | Fires a burning chain; if it wraps you, it **reels you toward him** (he stays fully mobile) for an unblockable 25-damage execution slash | Sidestep the chain — or once hooked, **spam jump 5 times** to shatter it and stagger him |
| **Cataclysmic Eruption** | Passive aura: the ground around him constantly fractures — smoke marks a spot, then a fire/magma pillar erupts (8 + ignite) | Watch your feet; approaching him is a minefield |
| **Hellrush Abduction** | Once per Overlord: a **50-block charge**. Caught = pinned for **nine punches (75 damage)**, then **everyone within 30 blocks is dragged to the Nether** (safe arrival: slow fall + fire resistance) where he ascends: **3× damage, restored to 750 HP** | Sidestep the charge — it flies dead straight and slams into walls |

## 🌋 Phase 3: The Volcanic Awakening & The Molten God

**The Overlord cannot die either.** Right as he takes fatal damage the
**volcano erupts**, the arena shatters, and he channels the volcanic energy —
becoming **invulnerable** while the **Blue Leviathan** (a huge blue molten
sea-beast, ~225 hearts) rises from the magma. Slay the Leviathan before he
finishes absorbing, or fight both at once. When it falls, the Titan sheds
his blade entirely and emerges as **THE MOLTEN GOD** — blinding white molten
energy, hyper-fast bare fists, 400 hearts, darkened sky. **This is the true
final boss; all loot and 1200 XP drop here.**

| Divine Ability | What it does | Counterplay |
|---|---|---|
| **Internal Fusion Grab** | Teleports *behind* you, punches clean inside — injects white molten energy: a **slow-burn death** (damage over ~10s) plus massive **Weakness** | Don't get cornered; heal/milk off the burn |
| **Solar Beam Clones** | 4 clones manifest and each fire concentrated white beams **4 times, then vanish** (no explosion) | Break line-of-sight and keep moving between beams |
| **Suffer** (2 variants) | *Homing:* 20 white crystals home in and explode on impact. *Sentinels:* 10–15 stationary crystals live 60s, charging then firing beams at the nearest enemy | Strafe the homing swarm; **destroy the sentinels** (6 HP) before they charge |
| **White Pillars** | 4 towering pillars rise that continuously spawn homing crystals **and heal the God** | **Tear the pillars down** (60 HP) fast — they out-heal your DPS otherwise |
| **Starfire Rain** (special) | Fire falls from the heavens, igniting the **entire battlefield except him** | No shelter — keep HP topped and ride it out near cover |
| **Divine Chaos Blades** (ultimate, 75% HP) | Two heaven-blades orbit him; he switches from fists to **high-speed long-range chain slashes** with heavy AoE | Respect his reach (22 blocks) — the safe zone is gone |

## 🛠 Debug commands (cheats on)

```
/scriptevent ob:help                  list commands
/scriptevent ob:spawn god             also: titan|overlord|leviathan|mini|clone|crystal|pillar
/scriptevent ob:move starfire         force nearest boss's move (see ob:help)
/scriptevent ob:hp 60                 set nearest boss HP
/scriptevent ob:rage                  trigger Titan rage phase
/scriptevent ob:buff                  apply Overlord hell ascension
/scriptevent ob:catalyst              trigger the Volcanic Awakening (phase 3)
/scriptevent ob:ultimate              summon the God's Divine Chaos Blades
/scriptevent ob:kill                  remove every addon entity
```

- Human-sized (~2.1 blocks) and fast, like the Ghost of Sparta himself.
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
