# Auto Enchanter — Minecraft Bedrock Add-on

Instant, no-XP, no-waiting enchanting. Two custom items drop a full Java-style
"best in slot" enchantment set onto **any** enchantable gear in one click.

- **Enchanter (Tools)** — utility / mining / movement enchantments
- **Enchanter (PVP)** — combat / protection enchantments

> Built for Bedrock but balanced like Java: the loadouts are split by *role*, so an
> axe enchanted with the **Tools** Enchanter becomes a tool (Efficiency / Fortune),
> while the same axe with the **PVP** Enchanter becomes a weapon (Sharpness).

---

## Install

1. Download **`dist/AutoEnchanter.mcaddon`**.
2. Open it — Minecraft imports both packs automatically.
3. Create/enable on a world with these **Experiments ON**: **Beta APIs** (a.k.a.
   *Holiday Creator Features* / *Custom Items* on older versions).
4. Both packs (Behavior + Resources) must be active. The behavior pack lists the
   resource pack as a dependency, so enabling the behavior pack pulls in both.

The two items appear in the **Creative inventory → Equipment** tab (search
"Enchanter").

---

## How to use it

Because of Bedrock limitations (you can't *use* an item from the off-hand, and gear
can't be placed in the off-hand slot), there are two triggers:

### 1) The item (consumed per use)
- Hold an **Enchanter** in your **main hand**.
- Keep the gear you want to enchant in your **hotbar** (or inventory).
- **Right-click / use.** The first enchantable item found is enchanted and **one
  Enchanter is consumed**. Hotbar is scanned left→right, so keep just the piece you
  want next to the Enchanter for predictable results.

### 2) The command (free, no item needed)
- **Hold the gear** you want to enchant in your main hand.
- Run one of:
  - `/scriptevent ae:tools`
  - `/scriptevent ae:pvp`
- The held item (or first hotbar gear) is enchanted. Nothing is consumed.

You get an action-bar message, a level-up sound, and particles on success.

---

## What gets applied (vanilla-max levels)

Each item type gets its **own** hand-tuned loadout (not one generic set). A
`canAddEnchantment()` safety net then drops anything illegal on your version, so it
works for **every** enchantable thing — including the **Mace** and any **spear**
added by another pack.

### Enchanter (Tools) — utility
| Gear | Enchantments |
|------|--------------|
| Pickaxe / Shovel / Axe (as tool) | Efficiency V, Fortune III, Unbreaking III, Mending |
| Hoe / Shears | Efficiency V, Unbreaking III, Mending |
| Fishing rod | Lure III, Luck of the Sea III, Unbreaking III, Mending |
| Sword | Looting III, Unbreaking III, Mending |
| Bow | Infinity, Unbreaking III |
| Crossbow | Quick Charge III, Unbreaking III, Mending |
| Trident | Riptide III, Unbreaking III, Mending |
| Helmet | Respiration III, Aqua Affinity, Unbreaking III, Mending |
| Chestplate | Unbreaking III, Mending |
| Leggings | Swift Sneak III, Unbreaking III, Mending |
| Boots | Feather Falling IV, Depth Strider III, Soul Speed III, Unbreaking III, Mending |

### Enchanter (PVP) — combat
| Gear | Enchantments |
|------|--------------|
| Sword | Sharpness V, Fire Aspect II, Looting III, Knockback II, Unbreaking III, Mending |
| Axe (as weapon) | Sharpness V, Unbreaking III, Mending |
| **Mace** | **Density V, Breach IV, Wind Burst III, Unbreaking III, Mending** |
| **Spear** | **Sharpness V, Lunge III, Fire Aspect II, Looting III, Knockback II, Unbreaking III, Mending** |
| Bow | Power V, Flame, Punch II, Infinity, Unbreaking III |
| Crossbow | Multishot, Piercing IV, Quick Charge III, Unbreaking III, Mending |
| Trident | Impaling V, Loyalty III, Channeling, Unbreaking III, Mending |
| Helmet | Protection IV, Respiration III, Aqua Affinity, Thorns III, Unbreaking III, Mending |
| Chestplate | Protection IV, Thorns III, Unbreaking III, Mending |
| Leggings | Protection IV, Thorns III, Swift Sneak III, Unbreaking III, Mending |
| Boots | Protection IV, Thorns III, Feather Falling IV, Depth Strider III, Unbreaking III, Mending |

> Only enchantments that exist on your running version and are legal for the item are
> applied. The **Spear** (Mounts of Mayhem update) and its exclusive **Lunge** enchant
> are fully supported; the Tools Enchanter puts **Lunge III** on a spear for mobility.

---

## Project layout

```
auto-enchanter/
├── AutoEnchanter_BP/            # Behavior pack
│   ├── manifest.json            # data + script modules, @minecraft/server dep
│   ├── pack_icon.png
│   ├── items/
│   │   ├── enchanter_tools.json
│   │   └── enchanter_pvp.json
│   └── scripts/main.js          # all the logic (item + command triggers)
├── AutoEnchanter_RP/            # Resource pack
│   ├── manifest.json
│   ├── pack_icon.png
│   ├── textures/
│   │   ├── item_texture.json
│   │   └── items/{enchanter_tools,enchanter_pvp}.png
│   └── texts/{en_US.lang,languages.json}
├── make_textures.py             # regenerates the PNG art
├── build.py                     # validates JSON + packs the .mcaddon
└── dist/
    ├── AutoEnchanter.mcaddon     # <- import this
    └── AutoEnchanter.zip
```

## Rebuild

```bash
python3 make_textures.py   # regenerate textures/icons (needs Pillow)
python3 build.py           # validate JSON + repack dist/AutoEnchanter.mcaddon
```

## Notes & limitations
- Requires the **Beta APIs** experiment (the scripting + enchantable API).
- The Enchanter is **Creative-only** by design (no crafting recipe).
- Script-module dependency is pinned to `@minecraft/server 1.16.0`. If a future
  Bedrock version drops that module line, bump the version in
  `AutoEnchanter_BP/manifest.json`.
