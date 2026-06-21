# 🪄 Mob Summoner Staff

A Minecraft **Bedrock** add-on. Craft a magic staff that summons loyal mobs to
fight for you. Your minions look like the vanilla mobs but are **friendly to you**
and automatically attack **whatever you attack** (wolf-style loyalty).

> ✅ **Ready to install:** grab **`MobSummonerStaff.mcaddon`** in this folder,
> open it, and Minecraft imports both packs for you.

---

## 📥 Install

1. Download **`MobSummonerStaff.mcaddon`**.
2. Open it (double-click on PC, or tap it on mobile) → Minecraft imports it.
3. Create / edit a world:
   - **Behavior Packs** → add *Mob Summoner Staff BP*
   - The matching **Resource Pack** is added automatically.
4. Turn on **`Beta APIs` (Experiments)** if your version asks for it — the staff
   uses the Script API.
5. Play!

## 🛠️ Crafting

```
[ Eye of Ender ]
[   Diamond    ]
[  Blaze Rod   ]
```
(Vertical, in any column of the crafting table.) → **1× Mob Summoner Staff**

## 🎮 Controls

| Action | What it does |
| --- | --- |
| **Use / Interact** (right-click / tap-hold) | Summon the selected minion |
| **Look at one of your minions + Use** | Recall (dismiss) that minion |
| **Sneak + Use** | Switch to the next ability / minion type |

The selected ability is shown on your action bar. You can have up to **12**
minions out at once (summoning past the cap removes your oldest one).

## 👹 Minions & abilities

| Minion | Ability |
| --- | --- |
| 🧟 **Zombie Brute** | Tanky melee bruiser that swarms your targets |
| 💀 **Skeleton Archer** | Rains arrows on whoever you attack |
| ☠️ **Wither Knight** | Heavy melee that inflicts the **Wither** effect |
| 🕷️ **Spider Stalker** | Fast, wall-climbing flanker |
| 💥 **Creeper Sapper** | Charges enemies and detonates — **no block damage** |
| 🟪 **Enderman Reaper** | Teleports to targets and hits very hard |
| 🛡️ **Iron Guardian** | Huge tank with massive knockback (slow) |

All minions:
- Are **tamed to you** — they never attack you.
- **Target whatever you attack**, and **defend you** when something hits you.
- **Guard** on their own: they’ll engage nearby hostile monsters.
- **Follow you** around like wolves.

## 🧩 How it works (for the curious)

- The minions are **custom entities** that reuse the vanilla mob models, textures
  and animations (so they look exactly like the real thing) but have their own
  friendly AI.
- The "attack whatever you attack" magic is the same engine behaviour wolves use
  (`minecraft:behavior.owner_hurt_target` / `owner_hurt_by_target`). When the
  staff summons a minion, a script tames it to you so those behaviours kick in.
- The Creeper's friendly-safe explosion is handled by the script, so it never
  damages you, your other minions, or the terrain.

## 📁 Project layout

```
MobSummonerStaff/
├─ MobSummonerStaff.mcaddon      ← install this
├─ MobSummonerStaffBP/           ← behavior pack (items, entities, recipe, script)
└─ MobSummonerStaffRP/           ← resource pack (staff texture, mob renders, icon)
```

To rebuild the `.mcaddon` after editing the source, just zip the two pack folders
together and rename the archive to `MobSummonerStaff.mcaddon`.
