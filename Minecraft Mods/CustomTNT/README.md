# Ultimate TNT — Bedrock Add-on

A custom TNT pack for **Minecraft Bedrock Edition** featuring 7 unique TNTs,
each with its own **custom texture**, **custom ID**, **custom explosion radius**,
and **special effects**. Built as a behavior pack + resource pack and bundled
into a ready-to-import `.mcaddon`.

## ⬇️ Install

1. Download **`UltimateTNT.mcaddon`** (in this folder).
2. Open it — Minecraft imports both packs automatically.
3. Create/edit a world → enable **Ultimate TNT** behavior + resource packs.
   - Make sure **"Beta APIs / Scripting"** is enabled in the world's
     *Experiments* (some versions require this for `@minecraft/server`).
4. Find the TNTs in the Creative inventory next to vanilla TNT, or craft them.

## 🧨 How to use

Place a TNT block, then **right-click it with Flint & Steel** to light the fuse.
Explosions also chain-react: a blast re-ignites any custom TNT blocks nearby.

## The TNTs

| TNT | ID | Radius | Fuse | Effect |
|-----|----|-------:|-----:|--------|
| ☢️ Radioactive | `tnt_mod:radioactive_tnt` | 6 | 4.0s | Leaves a lingering toxic cloud (poison + wither + nausea) |
| ⛓️ Chain | `tnt_mod:chain_tnt` | 3 | 3.0s | Throws out **5 mini-TNTs** that scatter and explode |
| 🔸 Mini | `tnt_mod:mini_tnt` | 2 | 1.25s | Small, quick blast (used by Chain TNT) |
| ☢️ Nuclear | `tnt_mod:nuke_tnt` | 18 | 6.0s | Massive blast + ring of secondary explosions + fire |
| ⚡ Lightning | `tnt_mod:lightning_tnt` | 4 | 3.5s | Calls down lightning bolts on impact |
| 🟣 Ender | `tnt_mod:ender_tnt` | 4 | 3.5s | Randomly teleports every nearby entity |
| 🌈 Rainbow | `tnt_mod:rainbow_tnt` | 5 | 3.5s | Colourful blast with coloured-flame particles |

> Vanilla TNT has a radius of 3, for reference.

## Crafting

Each TNT has a shapeless recipe (vanilla TNT + a themed ingredient), e.g.
Lightning TNT = TNT + Lightning Rod + Copper Ingot, Ender TNT = TNT + Ender Pearls.

## Project layout

```
src/
  UltimateTNT_BP/   behavior pack (blocks, primed entities, recipes, scripts)
  UltimateTNT_RP/   resource pack (textures, models, entity defs, lang)
build.py            regenerates every asset + repacks the .mcaddon
UltimateTNT.mcaddon the importable add-on
```

## Rebuilding

```bash
pip install pillow
python3 build.py
```

This regenerates all textures and JSON from scratch and rewrites
`UltimateTNT.mcaddon`. Tweak the `TNTS` table in `build.py` to change radii,
fuses, colours, or add new TNTs.

## Notes / compatibility

- Targets `min_engine_version` **1.21.0** and `@minecraft/server` **1.11.0**.
  If a future Bedrock version rejects the script module, bump the
  `@minecraft/server` version in `build.py` (`SERVER_API`) and rebuild.
- Custom explosion radius is the `radius` value passed to the scripted
  `dimension.createExplosion()` call — fully tunable per TNT.
