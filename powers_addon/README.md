# ⚡ Powers — Minecraft Bedrock Addon

Spawn into the world and receive a **Power Gem**. Use it to unlock **one of 8
random super powers**, each with its own custom item, textures, passive buffs
and active abilities. This is a **Bedrock `.mcaddon`** (not a Java `.jar`/`.zip`).

> Built with the Bedrock Scripting API (`@minecraft/server` 2.0.0). Requires
> Minecraft Bedrock **1.21.70+** with the **Beta APIs** experiment enabled.

---

## 📦 Install

1. Double-click **`Powers.mcaddon`** — Minecraft imports both packs automatically.
2. Create / edit a world and **activate both packs** (Behavior + Resource).
3. In **world settings → Experiments**, enable **Beta APIs** (required for scripts).
4. Join the world — you'll spawn with a **Power Gem**. **Use it** to roll a power.

Every item (the gem + all 8 powers) is also available in the **Creative menu**
under the *Equipment* / *Items* tabs.

### Rebuilding from source
```bash
cd powers_addon
python3 generate_textures.py   # regenerate all PNG textures
python3 generate_items.py      # regenerate item JSON + item_texture.json
python3 build.py               # package -> Powers.mcaddon
```

---

## 🎁 The Power Gem
You spawn holding a **Power Gem**. Right-click (use) it and it's consumed,
granting you a random power item dropped straight into your inventory.
Holding / owning that item grants the power; right-click the item to use its
active ability.

---

## 🦸 The 8 Powers

### 1. 🗡️ God of War — `gow_blade`
- **Passive:** permanent **Strength II**.
- **Apex Rage** *(crit to charge → use to unleash)*: landing **critical hits**
  (attacking while falling) fills your **Apex Rage** bar (+20% per crit). Once
  the bar reaches **80%**, right-click to **teleport to the nearest mob**, snap
  your aim onto it and deal a heavy bonus strike.
- **Blue Inferno** *(2nd ability — unlocks after 20 kills)*: **sneak + use** to
  charge your blade. Your next hit ignites the target in **extremely strong
  blue fire** (custom particle) that keeps burning and dealing damage.

### 2. 👟 As Fast As Sonic — `sonic_boots`
- **Active (toggle):** right-click to switch **Super Speed** on/off (Speed V +
  Haste). While it's on you **automatically vault over obstacles** — instead of
  stopping at a block you're lifted up and over it, so you never lose momentum.
- **Passive:** light Speed even when super-speed is off.

### 3. ❄️ Frost Sovereign — `frost_scepter`
- **Passive:** **fire immunity**; melee hits chill foes with **Slowness + Weakness**.
- **Glacial Nova** *(use)*: freeze every nearby enemy in a radius with heavy
  slowness/weakness and frost damage.

### 4. ⚡ Storm Bringer — `storm_hammer`
- **Passive:** **immune to fall damage**; Haste II; hits have a chance to call lightning.
- **Thunderstrike** *(use)*: summon a **lightning bolt** on the nearest mob (or
  where you aim) for big damage.

### 5. 🪨 Titan — `titan_gauntlet`
- **Passive:** **Resistance II** + bonus hearts (**Health Boost**); hits knock foes back hard.
- **Seismic Slam** *(use, on ground)*: erupt the earth, **launching and damaging**
  every entity around you.

### 6. 🗡️ Phantom — `phantom_dagger`
- **Passive:** Speed; **turn invisible while sneaking**.
- **Shadow Step** *(use)*: blink **behind** the nearest mob, go briefly invisible,
  and your next strike becomes a bonus-damage **Assassinate**.

### 7. 🔥 Phoenix — `phoenix_feather`
- **Passive:** **fire immunity**; **slow-fall (glide) while sneaking**; hits set foes ablaze.
- **Rebirth:** when near death you **burst back to full health**, ignite nearby
  enemies and regenerate (2-minute cooldown).
- **Phoenix Dash** *(use)*: rocket in the direction you look, leaving a fiery
  trail that burns enemies you pass.

### 8. 🌀 Void Walker — `void_eye`
- **Passive:** when hurt, chance to **blink away**; hits can fling foes with Levitation.
- **Void Rift** *(use)*: teleport up to 20 blocks where you aim (ender-pearl
  style), then **pull nearby enemies** toward you and curse them with Levitation.

---

## 🎨 Assets
All artwork is generated procedurally (`generate_textures.py`):
- A **pack icon** showing the gem ringed by all 8 power colors.
- **16×16 item icons** for the gem and every power weapon.
- A custom **blue-fire flipbook particle** (`powers:blue_fire`) used by God of
  War's Blue Inferno.

## 🗂️ Project layout
```
powers_addon/
├── behavior_pack/        # scripts, item definitions, manifest, pack icon
│   ├── items/            # 9 custom items (gem + 8 powers)
│   └── scripts/main.js   # all power logic
├── resource_pack/        # textures, particle, lang, manifest, pack icon
│   ├── textures/items/   # item PNGs + item_texture.json
│   └── particles/        # blue_fire particle
├── generate_textures.py  # build the PNG assets
├── generate_items.py     # build item JSONs
├── build.py              # package -> Powers.mcaddon
└── Powers.mcaddon        # <- import this into Minecraft
```
