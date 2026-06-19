# Red Grass (Minecraft 1.20.1, Fabric)

A tiny resource-only Fabric mod that turns **all grass red** in every biome — grass blocks,
short grass, tall grass, ferns, etc. Tree leaves stay green (they use a separate foliage
colormap that this mod leaves untouched).

## How it works

Minecraft tints all grass at render time using a single biome colormap,
`assets/minecraft/textures/colormap/grass.png`. This mod replaces that file with a solid
red (`#FF0000`) image, so grass is red regardless of biome temperature/humidity. No Java
code is required — Fabric automatically loads the mod's bundled resources.

## Install

1. Install **Fabric Loader** for Minecraft **1.20.1** (https://fabricmc.net/use/installer/).
2. Drop `RedGrass-1.20.1-fabric.jar` into your `.minecraft/mods/` folder.
3. Launch the 1.20.1 Fabric profile and load any world — grass will be red.

## Build from source

From the `redgrass/` folder:

```sh
zip -r "../RedGrass-1.20.1-fabric.jar" fabric.mod.json assets
```

Contents:

```
redgrass/
  fabric.mod.json
  assets/minecraft/textures/colormap/grass.png   (256x256 solid red)
```
