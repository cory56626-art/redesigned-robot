#!/usr/bin/env python3
"""
Generator for the FPS-Optimized Bedrock resource pack.

Produces flat solid-color block textures, disables animated textures, makes glass
clear, leaves/foliage opaque, and particles invisible -- the cheapest possible
render path for Minecraft Bedrock, aimed at 60+ FPS.

Pure standard library only (no Pillow / ImageMagick). PNGs are written with a tiny
hand-rolled encoder built on zlib. The final .mcpack is produced with `zip`.
"""

import os
import struct
import zlib
import json
import shutil
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.join(ROOT, "FPS-Optimized-Pack")
TEX = os.path.join(PACK, "textures")
BLOCKS_DIR = os.path.join(TEX, "blocks")
PARTICLE_DIR = os.path.join(TEX, "particle")
MCPACK = os.path.join(ROOT, "FPS-Optimized-Pack.mcpack")

# Stable UUIDs so the manifest does not churn on every rebuild.
HEADER_UUID = "a1f3c2e4-5b6d-4e8a-9c0b-1d2e3f4a5b6c"
MODULE_UUID = "b2e4d3f5-6c7e-4f9b-8d1c-2e3f4a5b6c7d"


# --------------------------------------------------------------------------- #
# Minimal PNG encoder (RGBA, 8-bit, single filter type 0)
# --------------------------------------------------------------------------- #
def _png_bytes(width, height, pixels):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        raw.extend(pixels[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def solid_png(path, rgba, size=16):
    r, g, b, a = rgba
    pixel = bytes((r, g, b, a))
    pixels = pixel * (size * size)
    with open(path, "wb") as f:
        f.write(_png_bytes(size, size, pixels))


# --------------------------------------------------------------------------- #
# Color helpers
# --------------------------------------------------------------------------- #
def op(rgb):
    """Opaque color tuple."""
    return (rgb[0], rgb[1], rgb[2], 255)


# 16 Minecraft dye colors (silver = light gray)
DYES = {
    "white": (233, 236, 236), "orange": (240, 118, 19), "magenta": (199, 78, 189),
    "light_blue": (58, 175, 217), "yellow": (248, 198, 39), "lime": (112, 185, 25),
    "pink": (237, 141, 172), "gray": (62, 68, 71), "silver": (142, 142, 134),
    "cyan": (21, 119, 136), "purple": (121, 42, 172), "blue": (53, 57, 157),
    "brown": (114, 71, 40), "green": (84, 109, 27), "red": (160, 39, 34),
    "black": (20, 21, 25),
}

# --------------------------------------------------------------------------- #
# Block texture key -> RGBA color. Keys are vanilla terrain_texture data keys;
# unmatched keys are harmless, matched ones replace the block's look.
# --------------------------------------------------------------------------- #
BLOCKS = {}

# ---- Stone / earth ----
BLOCKS.update({
    "stone": op((125, 125, 125)),
    "smooth_stone": op((158, 158, 158)),
    "cobblestone": op((122, 122, 122)),
    "cobblestone_mossy": op((110, 120, 100)),
    "stonebrick": op((122, 122, 122)),
    "stone_granite": op((149, 103, 85)),
    "stone_granite_smooth": op((154, 107, 89)),
    "stone_diorite": op((188, 188, 189)),
    "stone_diorite_smooth": op((192, 192, 194)),
    "stone_andesite": op((136, 138, 138)),
    "stone_andesite_smooth": op((140, 142, 142)),
    "deepslate": op((83, 83, 88)),
    "cobbled_deepslate": op((77, 77, 82)),
    "polished_deepslate": op((72, 72, 77)),
    "deepslate_bricks": op((70, 70, 75)),
    "deepslate_tiles": op((57, 57, 61)),
    "chiseled_deepslate": op((68, 68, 73)),
    "blackstone": op((42, 38, 45)),
    "polished_blackstone": op((52, 49, 57)),
    "polished_blackstone_bricks": op((48, 45, 52)),
    "gilded_blackstone": op((58, 48, 45)),
    "tuff": op((108, 110, 102)),
    "calcite": op((223, 224, 220)),
    "dripstone_block": op((134, 107, 92)),
    "bedrock": op((85, 85, 85)),
    "gravel": op((131, 127, 126)),
    "sand": op((219, 207, 163)),
    "red_sand": op((190, 102, 33)),
    "sandstone_normal": op((219, 207, 163)),
    "sandstone_top": op((223, 213, 168)),
    "sandstone_bottom": op((215, 202, 157)),
    "sandstone_carved": op((221, 209, 165)),
    "sandstone_smooth": op((224, 213, 168)),
    "red_sandstone_normal": op((184, 98, 28)),
    "red_sandstone_top": op((190, 102, 33)),
    "red_sandstone_carved": op((181, 97, 28)),
    "red_sandstone_smooth": op((187, 100, 30)),
    "dirt": op((134, 96, 67)),
    "coarse_dirt": op((119, 85, 59)),
    "podzol_top": op((91, 68, 33)),
    "podzol_side": op((105, 78, 47)),
    "rooted_dirt": op((144, 103, 76)),
    "mud": op((60, 56, 57)),
    "packed_mud": op((142, 105, 77)),
    "mud_bricks": op((137, 103, 78)),
    "clay": op((159, 164, 177)),
    "grass_top": op((121, 168, 75)),
    "grass_side": op((110, 150, 70)),
    "grass_side_snowed": op((230, 240, 245)),
    "mycelium_top": op((111, 99, 105)),
    "mycelium_side": op((125, 110, 110)),
    "grass_path_top": op((148, 124, 70)),
    "grass_path_side": op((131, 105, 60)),
    "snow": op((241, 250, 250)),
    "ice": op((125, 173, 255)),
    "ice_packed": op((141, 180, 250)),
    "blue_ice": op((116, 168, 252)),
    "frosted_ice_0": op((140, 180, 250)),
    "obsidian": op((20, 18, 30)),
    "crying_obsidian": op((32, 18, 56)),
    "netherrack": op((97, 38, 38)),
    "soul_sand": op((81, 62, 50)),
    "soul_soil": op((75, 57, 46)),
    "basalt_top": op((73, 73, 79)),
    "basalt_side": op((80, 80, 86)),
    "polished_basalt_top": op((86, 86, 92)),
    "polished_basalt_side": op((90, 90, 96)),
    "end_stone": op((219, 222, 158)),
    "end_bricks": op((219, 224, 158)),
    "moss_block": op((89, 109, 45)),
    "magma": op((142, 65, 35)),
    "netherrack_warped": op((44, 70, 70)),
})

# ---- Ores ----
ORE_COLORS = {
    "coal_ore": (52, 52, 52), "iron_ore": (175, 142, 116), "gold_ore": (200, 178, 90),
    "redstone_ore": (151, 75, 75), "lapis_ore": (75, 100, 151), "diamond_ore": (95, 200, 195),
    "emerald_ore": (70, 190, 110), "quartz_ore": (140, 100, 95), "nether_gold_ore": (160, 80, 55),
    "copper_ore": (150, 120, 95),
}
for k, c in ORE_COLORS.items():
    BLOCKS[k] = op(c)
    BLOCKS["deepslate_" + k] = op((max(c[0] - 50, 0), max(c[1] - 50, 0), max(c[2] - 45, 0)))
BLOCKS["ancient_debris_top"] = op((95, 70, 62))
BLOCKS["ancient_debris_side"] = op((88, 64, 57))

# ---- Mineral / metal blocks ----
BLOCKS.update({
    "coal_block": op((16, 16, 16)),
    "iron_block": op((220, 220, 220)),
    "gold_block": op((246, 208, 61)),
    "diamond_block": op((98, 219, 214)),
    "emerald_block": op((42, 203, 87)),
    "lapis_block": op((30, 67, 140)),
    "redstone_block": op((175, 24, 5)),
    "netherite_block": op((66, 61, 64)),
    "raw_iron_block": op((166, 134, 107)),
    "raw_gold_block": op((221, 169, 46)),
    "raw_copper_block": op((154, 105, 79)),
    "copper_block": op((192, 107, 79)),
    "exposed_copper": op((161, 125, 99)),
    "weathered_copper": op((108, 153, 109)),
    "oxidized_copper": op((82, 162, 132)),
    "cut_copper": op((189, 105, 79)),
    "exposed_cut_copper": op((158, 123, 98)),
    "weathered_cut_copper": op((106, 150, 107)),
    "oxidized_cut_copper": op((80, 159, 130)),
    "quartz_block_top": op((235, 229, 222)),
    "quartz_block_side": op((236, 231, 224)),
    "quartz_block_bottom": op((232, 226, 219)),
    "quartz_block_chiseled": op((233, 227, 220)),
    "quartz_block_chiseled_top": op((235, 229, 222)),
    "quartz_block_lines": op((235, 230, 223)),
    "quartz_block_lines_top": op((236, 231, 224)),
    "quartz_bricks": op((233, 227, 220)),
    "smooth_quartz": op((236, 231, 224)),
})

# ---- Wood: logs, planks, opaque leaves ----
WOODS = {
    "oak":     {"log": (109, 86, 51),  "log_top": (175, 144, 91), "planks": (162, 130, 78), "leaf": (60, 100, 35)},
    "spruce":  {"log": (58, 39, 18),   "log_top": (122, 96, 57),  "planks": (114, 84, 48),  "leaf": (48, 75, 48)},
    "birch":   {"log": (215, 213, 207),"log_top": (197, 180, 145),"planks": (196, 178, 123),"leaf": (110, 140, 75)},
    "jungle":  {"log": (87, 67, 26),   "log_top": (151, 119, 82), "planks": (160, 115, 81),  "leaf": (53, 105, 25)},
    "acacia":  {"log": (104, 97, 88),  "log_top": (172, 92, 56),  "planks": (168, 90, 50),  "leaf": (84, 109, 27)},
    "big_oak": {"log": (60, 47, 26),   "log_top": (76, 60, 36),   "planks": (66, 43, 20),   "leaf": (50, 85, 30)},
}
for name, c in WOODS.items():
    BLOCKS["log_" + name] = op(c["log"])
    BLOCKS["log_" + name + "_top"] = op(c["log_top"])
    BLOCKS["planks_" + name] = op(c["planks"])
    BLOCKS["stripped_" + name + "_log"] = op(c["log_top"])
    BLOCKS["stripped_" + name + "_log_top"] = op(c["log_top"])
    BLOCKS["leaves_" + name] = op(c["leaf"])          # opaque leaves
    BLOCKS["leaves_" + name + "_opaque"] = op(c["leaf"])

# Newer woods (mangrove, cherry, bamboo, crimson, warped)
BLOCKS.update({
    "mangrove_log_side": op((104, 51, 41)), "mangrove_log_top": op((121, 88, 60)),
    "mangrove_planks": op((117, 60, 49)), "mangrove_leaves": op((92, 134, 45)),
    "stripped_mangrove_log_side": op((125, 71, 54)), "stripped_mangrove_log_top": op((125, 71, 54)),
    "cherry_log_side": op((52, 31, 41)), "cherry_log_top": op((216, 180, 178)),
    "cherry_planks": op((227, 181, 178)), "cherry_leaves": op((227, 160, 197)),
    "stripped_cherry_log_side": op((227, 181, 178)), "stripped_cherry_log_top": op((227, 181, 178)),
    "bamboo_block": op((155, 160, 60)), "bamboo_block_top": op((167, 172, 70)),
    "bamboo_planks": op((197, 178, 92)), "bamboo_mosaic": op((193, 174, 88)),
    "crimson_log_side": op((92, 25, 51)), "crimson_log_top": op((86, 20, 46)),
    "crimson_planks": op((101, 49, 71)), "stripped_crimson_stem_side": op((148, 62, 90)),
    "warped_log_side": op((58, 100, 100)), "warped_log_top": op((43, 70, 70)),
    "warped_planks": op((43, 99, 99)), "stripped_warped_stem_side": op((60, 110, 110)),
    "azalea_leaves": op((78, 110, 40)), "azalea_leaves_flowered": op((96, 120, 60)),
    "nether_wart_block": op((114, 6, 6)), "warped_wart_block": op((22, 119, 118)),
    "shroomlight": op((242, 155, 78)),
})

# ---- 16-color sets: wool, terracotta, concrete, concrete powder ----
for name, c in DYES.items():
    BLOCKS["wool_colored_" + name] = op(c)
    BLOCKS["concrete_" + name] = op(c)
    # concrete powder is a touch lighter / desaturated
    BLOCKS["concretePowder_" + name] = op((min(c[0] + 25, 255), min(c[1] + 25, 255), min(c[2] + 25, 255)))
    # stained terracotta = muted earthy version of the dye
    BLOCKS["hardened_clay_stained_" + name] = op(
        ((c[0] + 150) // 2, (c[1] + 110) // 2, (c[2] + 90) // 2))
BLOCKS["hardened_clay"] = op((150, 92, 66))           # plain terracotta
BLOCKS["white_terracotta"] = op((209, 178, 161))

# ---- Glass: clear (fully transparent) for zero render cost ----
GLASS_KEYS = ["glass"] + ["glass_" + n for n in DYES]
for k in GLASS_KEYS:
    BLOCKS[k] = (255, 255, 255, 0)                    # fully transparent

# ---- Misc decorative / utility blocks ----
BLOCKS.update({
    "glowstone": op((171, 131, 84)),
    "sea_lantern": op((175, 196, 191)),
    "redstone_lamp_off": op((95, 60, 32)),
    "redstone_lamp_on": op((216, 160, 92)),
    "bookshelf": op((118, 92, 56)),
    "crafting_table_top": op((124, 84, 50)),
    "crafting_table_side": op((110, 74, 44)),
    "crafting_table_front": op((116, 78, 47)),
    "furnace_top": op((107, 107, 107)),
    "furnace_side": op((116, 116, 116)),
    "furnace_front_off": op((96, 96, 96)),
    "furnace_front_on": op((120, 96, 70)),
    "tnt_top": op((164, 60, 49)),
    "tnt_side": op((148, 52, 44)),
    "tnt_bottom": op((90, 75, 50)),
    "pumpkin_top": op((196, 145, 41)),
    "pumpkin_side": op((197, 124, 40)),
    "pumpkin_face_off": op((202, 130, 30)),
    "melon_top": op((116, 134, 39)),
    "melon_side": op((110, 128, 41)),
    "hay_block_top": op((201, 165, 33)),
    "hay_block_side": op((167, 134, 24)),
    "sponge": op((197, 190, 79)),
    "sponge_wet": op((164, 165, 64)),
    "slime": op((120, 195, 105)),                     # opaque (avoids translucency)
    "honey_top": op((251, 184, 48)),
    "honey_side": op((247, 168, 49)),
    "honeycomb": op((229, 148, 39)),
    "purpur_block": op((169, 125, 169)),
    "purpur_pillar": op((171, 128, 171)),
    "purpur_pillar_top": op((174, 132, 174)),
    "prismarine_rough": op((99, 156, 151)),
    "prismarine_dark": op((51, 91, 75)),
    "prismarine_bricks": op((99, 171, 158)),
    "nether_brick": op((44, 22, 26)),
    "red_nether_brick": op((68, 6, 9)),
    "brick": op((150, 97, 83)),
    "bone_block_top": op((222, 219, 201)),
    "bone_block_side": op((229, 226, 208)),
    "target": op((221, 187, 174)),
    "amethyst_block": op((133, 97, 191)),
    "budding_amethyst": op((140, 104, 198)),
    "tinted_glass": (90, 80, 95, 0),
    "mushroom_red": op((198, 42, 41)),
    "mushroom_brown": op((151, 118, 90)),
    "mushroom_block_skin_stem": op((203, 196, 178)),
    "smooth_stone_slab_side": op((158, 158, 158)),
    "chiseled_stone_bricks": op((120, 120, 120)),
    "cracked_stone_bricks": op((118, 118, 118)),
    "mossy_stone_bricks": op((110, 118, 100)),
    "lodestone_side": op((130, 131, 135)),
    "lodestone_top": op((136, 137, 141)),
    "dried_kelp_top": op((50, 56, 38)),
    "dried_kelp_side": op((61, 63, 45)),
})

# ---- Foliage (opaque, no cutout/translucency) ----
BLOCKS.update({
    "vine": op((58, 92, 32)),
    "waterlily": op((32, 102, 32)),
    "fern": op((85, 125, 55)),
    "tallgrass": op((104, 148, 64)),
    "double_plant_grass_top": op((104, 148, 64)),
    "double_plant_grass_bottom": op((104, 148, 64)),
})

# --------------------------------------------------------------------------- #
# Animated textures -> static single frame (neutralized via flipbook override)
# --------------------------------------------------------------------------- #
ANIMATED = {
    "water_still": (49, 84, 156, 200),   # keep a little transparency so water reads as liquid
    "water_flow": (53, 90, 162, 200),
    "lava_still": op((207, 92, 26)),
    "lava_flow": op((217, 102, 30)),
    "fire_0": op((216, 122, 34)),
    "fire_1": op((221, 132, 40)),
    "soul_fire_0": op((58, 152, 173)),
    "soul_fire_1": op((66, 162, 183)),
    "portal": op((92, 38, 168)),
    "nether_portal": op((92, 38, 168)),
    "sea_lantern": op((182, 200, 196)),
    "magma": op((142, 65, 35)),
    "prismarine_rough": op((99, 156, 151)),
    "campfire_fire": op((216, 122, 34)),
    "soul_campfire_fire": op((66, 162, 183)),
    "stonecutter_saw": op((150, 150, 150)),
}


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build():
    if os.path.exists(PACK):
        shutil.rmtree(PACK)
    os.makedirs(BLOCKS_DIR)
    os.makedirs(PARTICLE_DIR)

    # 1) all flat block textures
    written = 0
    for key, rgba in BLOCKS.items():
        solid_png(os.path.join(BLOCKS_DIR, key + ".png"), rgba)
        written += 1

    # 2) static frames for animated textures
    for key, rgba in ANIMATED.items():
        solid_png(os.path.join(BLOCKS_DIR, key + ".png"), rgba)
        written += 1

    # 3) terrain_texture.json (maps every key to its png)
    texture_data = {}
    for key in list(BLOCKS) + list(ANIMATED):
        texture_data[key] = {"textures": "textures/blocks/" + key}
    terrain = {
        "resource_pack_name": "fps_optimized",
        "texture_name": "atlas.terrain",
        "padding": 8,
        "num_mip_levels": 2,           # low mips = cheaper sampling
        "texture_data": texture_data,
    }
    with open(os.path.join(TEX, "terrain_texture.json"), "w") as f:
        json.dump(terrain, f, indent=2)

    # 4) flipbook override -> single static frame, effectively no animation
    flipbook = []
    for key in ANIMATED:
        flipbook.append({
            "flipbook_texture": "textures/blocks/" + key,
            "atlas_tile": key,
            "ticks_per_frame": 2000000000,
            "frames": [0],
        })
    with open(os.path.join(TEX, "flipbook_textures.json"), "w") as f:
        json.dump(flipbook, f, indent=2)

    # 5) fully transparent particle atlas -> particles render as nothing
    transparent = bytes((0, 0, 0, 0)) * (256 * 256)
    with open(os.path.join(PARTICLE_DIR, "particles.png"), "wb") as f:
        f.write(_png_bytes(256, 256, transparent))

    # 6) pack icon (128x128 flat green)
    solid_png(os.path.join(PACK, "pack_icon.png"), op((84, 150, 60)), size=128)

    # 7) manifest
    manifest = {
        "format_version": 2,
        "header": {
            "name": "FPS Optimized Pack",
            "description": "Flat textures, no animations, clear glass, no particles. Built for 60+ FPS.",
            "uuid": HEADER_UUID,
            "version": [1, 0, 0],
            "min_engine_version": [1, 21, 0],
        },
        "modules": [
            {
                "type": "resources",
                "description": "FPS optimized resources",
                "uuid": MODULE_UUID,
                "version": [1, 0, 0],
            }
        ],
    }
    with open(os.path.join(PACK, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    # 8) zip into .mcpack (manifest.json must be at the archive root)
    if os.path.exists(MCPACK):
        os.remove(MCPACK)
    subprocess.run(["zip", "-r", "-X", "-q", MCPACK, "."], cwd=PACK, check=True)

    print(f"Block textures written : {written}")
    print(f"terrain_texture entries: {len(texture_data)}")
    print(f"flipbook overrides     : {len(flipbook)}")
    print(f"Pack source            : {PACK}")
    print(f"Package                : {MCPACK}")


if __name__ == "__main__":
    build()
