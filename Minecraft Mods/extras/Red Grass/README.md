# Red Grass (Minecraft 1.20.1)

Turns **all grass red** in every biome — grass blocks, short grass, tall grass,
and ferns. Tree leaves stay green (leaves use a separate foliage colormap that
this does not touch).

It works by replacing Minecraft's biome grass colormap,
`assets/minecraft/textures/colormap/grass.png`, with a solid red (`#FF0000`)
256×256 image, so grass is red regardless of biome temperature/humidity. No Java
code is required.

This folder ships **two** ways to use it. Either one works on its own — pick whichever you prefer.

| File | What it is | Where it goes |
| --- | --- | --- |
| `RedGrass-ResourcePack-1.20.1.zip` | Resource pack (no mod loader needed) | `resourcepacks/` folder, then enable in-game |
| `RedGrass-1.20.1-fabric.jar` | Fabric mod | `mods/` folder of a **Fabric** instance |

## Option A — Resource pack (simplest, recommended)

This needs **no Fabric** and is the most reliable option.

1. In **Prism Launcher**, select your instance → **Edit** → **Resource packs**,
   then click **Add** / **View Folder** and drop in
   `RedGrass-ResourcePack-1.20.1.zip` (this is the instance's `resourcepacks/`
   folder).
2. Launch the game → **Options → Resource Packs**, move **Red Grass** to the
   selected (right-hand) side, then **Done**.
3. Load any world — grass is red.

## Option B — Fabric mod

Use this if you specifically want it as a mod.

1. Make sure the instance actually has the **Fabric loader** installed:
   Prism Launcher → instance → **Edit** → **Version** → **Install Fabric**.
   (A plain/vanilla instance ignores `.jar` mods — this is the most common
   reason a mod "does nothing".)
2. Edit → **Mods** → **Add**, and select `RedGrass-1.20.1-fabric.jar`
   (this places it in the instance's `mods/` folder).
3. Launch the Fabric instance and load any world — grass is red.

The mod targets Minecraft **1.20.x** (`>=1.20 <1.21`) and is client-side only.

## Build from source

Everything is reproducible from the `src/` folder:

```sh
cd src

# Fabric mod jar
zip -X -r ../RedGrass-1.20.1-fabric.jar fabric.mod.json assets

# Resource pack
zip -X -r ../RedGrass-ResourcePack-1.20.1.zip pack.mcmeta pack.png assets
```

`src/` layout:

```
src/
  fabric.mod.json                                  # Fabric mod metadata (jar only)
  pack.mcmeta                                       # resource pack metadata (pack only)
  pack.png                                          # resource pack icon
  assets/minecraft/textures/colormap/grass.png     # 256x256 solid red (shared)
```
