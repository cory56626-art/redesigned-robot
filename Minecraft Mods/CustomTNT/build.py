#!/usr/bin/env python3
"""
Ultimate TNT - Bedrock Add-on builder.

Generates a full behavior pack + resource pack (custom textures, blocks,
primed entities, scripting) for a set of custom TNTs, then zips everything
into a ready-to-import `.mcaddon` file.

Run:  python3 build.py
Out:  ./UltimateTNT.mcaddon  (+ src/ tree for inspection)
"""

import json
import os
import random
import shutil
import uuid
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
BP = os.path.join(SRC, "UltimateTNT_BP")
RP = os.path.join(SRC, "UltimateTNT_RP")

# Deterministic UUIDs so re-builds keep the same identity (safe to re-import).
RNG = random.Random(0xC0FFEE)
def stable_uuid():
    return str(uuid.UUID(int=RNG.getrandbits(128)))

BP_HEADER_UUID   = stable_uuid()
BP_DATA_UUID     = stable_uuid()
BP_SCRIPT_UUID   = stable_uuid()
RP_HEADER_UUID   = stable_uuid()
RP_RES_UUID      = stable_uuid()

MIN_ENGINE = [1, 21, 0]
SERVER_API = "1.11.0"   # @minecraft/server stable

# ---------------------------------------------------------------------------
# TNT definitions
# ---------------------------------------------------------------------------
# radius   -> custom explosion radius (vanilla TNT is 3)
# fuse     -> ticks before detonation (20 ticks = 1s)
# fire     -> whether the blast starts fires
# effect   -> special behaviour handled in scripts/main.js
# palette  -> (dark, mid, light, accent) RGB tuples for texture generation
TNTS = {
    "radioactive_tnt": {
        "name": "Radioactive TNT", "radius": 6, "fuse": 80, "fire": False,
        "effect": "radioactive",
        "palette": [(18, 38, 18), (52, 150, 40), (140, 230, 80), (210, 255, 120)],
    },
    "chain_tnt": {
        "name": "Chain TNT", "radius": 3, "fuse": 60, "fire": False,
        "effect": "chain",
        "palette": [(58, 30, 12), (190, 92, 28), (240, 150, 60), (190, 190, 200)],
    },
    "mini_tnt": {
        "name": "Mini TNT", "radius": 2, "fuse": 25, "fire": False,
        "effect": "none",
        "palette": [(48, 48, 54), (118, 118, 130), (180, 180, 192), (225, 120, 80)],
    },
    "nuke_tnt": {
        "name": "Nuclear TNT", "radius": 18, "fuse": 120, "fire": True,
        "effect": "nuke",
        "palette": [(28, 28, 18), (232, 200, 36), (255, 232, 80), (16, 16, 16)],
    },
    "lightning_tnt": {
        "name": "Lightning TNT", "radius": 4, "fuse": 70, "fire": False,
        "effect": "lightning",
        "palette": [(18, 28, 60), (58, 120, 220), (120, 200, 255), (255, 255, 255)],
    },
    "ender_tnt": {
        "name": "Ender TNT", "radius": 4, "fuse": 70, "fire": False,
        "effect": "ender",
        "palette": [(24, 10, 40), (92, 40, 140), (160, 90, 220), (34, 230, 200)],
    },
    "rainbow_tnt": {
        "name": "Rainbow TNT", "radius": 5, "fuse": 70, "fire": False,
        "effect": "rainbow",
        "palette": [(40, 20, 50), (230, 60, 60), (90, 200, 90), (70, 120, 255)],
    },
}

# ---------------------------------------------------------------------------
# Texture generation
# ---------------------------------------------------------------------------
RAINBOW_BANDS = [
    (228, 60, 60), (235, 140, 40), (240, 220, 50),
    (70, 200, 80), (60, 130, 240), (140, 70, 220),
]

def _px(img, x, y, c):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), c + (255,) if len(c) == 3 else c)

def _shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c)

def make_side(name, cfg, seed):
    """16x16 dynamite-bundle style side face, themed by palette."""
    dark, mid, light, accent = cfg["palette"]
    rng = random.Random(seed)
    img = Image.new("RGBA", (16, 16), dark + (255,))
    for x in range(16):
        for y in range(16):
            if name == "rainbow_tnt":
                base = RAINBOW_BANDS[y % len(RAINBOW_BANDS)]
            else:
                # vertical "sticks": alternate mid / lighter columns
                base = light if (x // 2) % 2 == 0 else mid
            # top & bottom binding caps
            if y <= 1 or y >= 14:
                base = _shade(dark, 1.2)
            # central label band
            elif 6 <= y <= 9:
                base = accent if name != "rainbow_tnt" else (245, 245, 245)
            n = rng.randint(-12, 12)
            _px(img, x, y, _shade(base, 1 + n / 255))
    # rivets on the caps
    for x in (2, 7, 13):
        _px(img, x, 0, _shade(accent, 1.1))
        _px(img, x, 15, _shade(accent, 1.1))
    return img

def make_top(name, cfg, seed):
    dark, mid, light, accent = cfg["palette"]
    rng = random.Random(seed + 1)
    img = Image.new("RGBA", (16, 16), _shade(dark, 1.1) + (255,))
    for x in range(16):
        for y in range(16):
            if 1 <= x <= 14 and 1 <= y <= 14:
                if name == "rainbow_tnt":
                    c = RAINBOW_BANDS[(x + y) % len(RAINBOW_BANDS)]
                else:
                    # concentric: outer mid, inner light, core accent
                    d = max(abs(x - 7.5), abs(y - 7.5))
                    c = accent if d < 3 else (light if d < 5.5 else mid)
                _px(img, x, y, _shade(c, 1 + rng.randint(-10, 10) / 255))
    return img

def make_bottom(name, cfg, seed):
    dark, mid, light, accent = cfg["palette"]
    rng = random.Random(seed + 2)
    img = Image.new("RGBA", (16, 16), dark + (255,))
    for x in range(16):
        for y in range(16):
            base = _shade(mid, 0.6)
            _px(img, x, y, _shade(base, 1 + rng.randint(-8, 8) / 255))
    return img

def make_entity_net(side, top, bottom):
    """Compose a 64x32 cube-net texture matching geometry.tnt_mod_cube box-uv."""
    net = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    net.paste(top, (16, 0))
    net.paste(bottom, (32, 0))
    for i, x in enumerate((0, 16, 32, 48)):  # east, north, west, south
        net.paste(side, (x, 16))
    return net

def make_pack_icon(path):
    cfg = TNTS["nuke_tnt"]
    side = make_side("nuke_tnt", cfg, 99)
    side.resize((256, 256), Image.NEAREST).save(path)

# ---------------------------------------------------------------------------
# Filesystem helpers
# ---------------------------------------------------------------------------
def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)

# ---------------------------------------------------------------------------
# Build behavior pack
# ---------------------------------------------------------------------------
def build_bp():
    write_json(os.path.join(BP, "manifest.json"), {
        "format_version": 2,
        "header": {
            "name": "Ultimate TNT [Behavior]",
            "description": "7 custom TNTs: radioactive, chain, mini, nuke, lightning, ender, rainbow.",
            "uuid": BP_HEADER_UUID,
            "version": [1, 0, 0],
            "min_engine_version": MIN_ENGINE,
        },
        "modules": [
            {"type": "data", "uuid": BP_DATA_UUID, "version": [1, 0, 0]},
            {"type": "script", "language": "javascript", "uuid": BP_SCRIPT_UUID,
             "version": [1, 0, 0], "entry": "scripts/main.js"},
        ],
        "dependencies": [
            {"module_name": "@minecraft/server", "version": SERVER_API},
            {"uuid": RP_HEADER_UUID, "version": [1, 0, 0]},
        ],
    })

    # Blocks
    for name, cfg in TNTS.items():
        color = "#%02x%02x%02x" % cfg["palette"][2]
        write_json(os.path.join(BP, "blocks", f"{name}.json"), {
            "format_version": "1.21.0",
            "minecraft:block": {
                "description": {
                    "identifier": f"tnt_mod:{name}",
                    "menu_category": {"category": "construction",
                                      "group": "itemGroup.name.tnt"},
                },
                "components": {
                    "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.4},
                    "minecraft:destructible_by_explosion": {"explosion_resistance": 0},
                    "minecraft:friction": 0.6,
                    "minecraft:map_color": color,
                    "minecraft:light_dampening": 0,
                    "minecraft:material_instances": {
                        "*": {"texture": f"{name}_side", "render_method": "opaque"},
                        "up": {"texture": f"{name}_top", "render_method": "opaque"},
                        "down": {"texture": f"{name}_bottom", "render_method": "opaque"},
                    },
                },
            },
        })

    # Primed entities (server)
    for name, cfg in TNTS.items():
        write_json(os.path.join(BP, "entities", f"primed_{name}.json"), {
            "format_version": "1.21.0",
            "minecraft:entity": {
                "description": {
                    "identifier": f"tnt_mod:primed_{name}",
                    "is_spawnable": False,
                    "is_summonable": True,
                    "is_experimental": False,
                },
                "components": {
                    "minecraft:type_family": {"family": ["tnt_mod", "primed_tnt"]},
                    "minecraft:physics": {},
                    "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
                    "minecraft:collision_box": {"width": 0.98, "height": 0.98},
                    "minecraft:fire_immune": True,
                    "minecraft:health": {"value": 1, "max": 1},
                    "minecraft:knockback_resistance": {"value": 0.0},
                    "minecraft:conditional_bandwidth_optimization": {},
                    "minecraft:damage_sensor": {
                        "triggers": [{"cause": "all", "deals_damage": False}]
                    },
                },
            },
        })

    # Crafting recipes (nice-to-have; failures are silent in game)
    recipes = {
        "radioactive_tnt": ["minecraft:tnt", "minecraft:poisonous_potato",
                            "minecraft:poisonous_potato", "minecraft:slime_ball"],
        "chain_tnt":       ["minecraft:tnt", "minecraft:chain", "minecraft:chain"],
        "mini_tnt":        ["minecraft:tnt", "minecraft:gunpowder"],
        "nuke_tnt":        ["minecraft:tnt", "minecraft:gunpowder", "minecraft:gunpowder",
                            "minecraft:gunpowder", "minecraft:gunpowder", "minecraft:blaze_powder"],
        "lightning_tnt":   ["minecraft:tnt", "minecraft:lightning_rod", "minecraft:copper_ingot"],
        "ender_tnt":       ["minecraft:tnt", "minecraft:ender_pearl", "minecraft:ender_pearl"],
        "rainbow_tnt":     ["minecraft:tnt", "minecraft:red_dye", "minecraft:green_dye",
                            "minecraft:blue_dye", "minecraft:yellow_dye"],
    }
    for name, ingredients in recipes.items():
        write_json(os.path.join(BP, "recipes", f"{name}.json"), {
            "format_version": "1.20.10",
            "minecraft:recipe_shapeless": {
                "description": {"identifier": f"tnt_mod:{name}"},
                "tags": ["crafting_table"],
                "ingredients": [{"item": it} for it in ingredients],
                "result": {"item": f"tnt_mod:{name}", "count": 1},
            },
        })

    write_text(os.path.join(BP, "scripts", "main.js"), MAIN_JS)
    make_pack_icon(os.path.join(BP, "pack_icon.png"))

# ---------------------------------------------------------------------------
# Build resource pack
# ---------------------------------------------------------------------------
def build_rp():
    write_json(os.path.join(RP, "manifest.json"), {
        "format_version": 2,
        "header": {
            "name": "Ultimate TNT [Resources]",
            "description": "Textures & models for Ultimate TNT.",
            "uuid": RP_HEADER_UUID,
            "version": [1, 0, 0],
            "min_engine_version": MIN_ENGINE,
        },
        "modules": [
            {"type": "resources", "uuid": RP_RES_UUID, "version": [1, 0, 0]},
        ],
        "dependencies": [
            {"uuid": BP_HEADER_UUID, "version": [1, 0, 0]},
        ],
    })

    # Textures + terrain_texture mapping
    terrain = {}
    for i, (name, cfg) in enumerate(TNTS.items()):
        seed = 1000 + i * 7
        side = make_side(name, cfg, seed)
        top = make_top(name, cfg, seed)
        bottom = make_bottom(name, cfg, seed)
        block_dir = os.path.join(RP, "textures", "blocks")
        os.makedirs(block_dir, exist_ok=True)
        side.save(os.path.join(block_dir, f"{name}_side.png"))
        top.save(os.path.join(block_dir, f"{name}_top.png"))
        bottom.save(os.path.join(block_dir, f"{name}_bottom.png"))
        for face in ("side", "top", "bottom"):
            terrain[f"{name}_{face}"] = {
                "textures": f"textures/blocks/{name}_{face}"}
        # entity net texture
        ent_dir = os.path.join(RP, "textures", "entity", "tnt")
        os.makedirs(ent_dir, exist_ok=True)
        make_entity_net(side, top, bottom).save(
            os.path.join(ent_dir, f"primed_{name}.png"))

    write_json(os.path.join(RP, "textures", "terrain_texture.json"), {
        "resource_pack_name": "ultimate_tnt",
        "texture_name": "atlas.terrain",
        "padding": 8,
        "num_mip_levels": 4,
        "texture_data": terrain,
    })

    # Shared cube geometry for primed entities
    write_json(os.path.join(RP, "models", "entity", "tnt_cube.geo.json"), {
        "format_version": "1.16.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": "geometry.tnt_mod_cube",
                "texture_width": 64, "texture_height": 32,
                "visible_bounds_width": 2, "visible_bounds_height": 2.5,
                "visible_bounds_offset": [0, 0.75, 0],
            },
            "bones": [{
                "name": "body", "pivot": [0, 0, 0],
                "cubes": [{"origin": [-8, 0, -8], "size": [16, 16, 16], "uv": [0, 0]}],
            }],
        }],
    })

    # Client entity definitions
    for name in TNTS:
        write_json(os.path.join(RP, "entity", f"primed_{name}.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"tnt_mod:primed_{name}",
                    "materials": {"default": "entity_alphatest"},
                    "textures": {"default": f"textures/entity/tnt/primed_{name}"},
                    "geometry": {"default": "geometry.tnt_mod_cube"},
                    "render_controllers": ["controller.render.default"],
                    "spawn_egg": {"texture": f"{name}_side"},
                },
            },
        })

    # Language file
    lines = ["## Ultimate TNT"]
    for name, cfg in TNTS.items():
        lines.append(f"tile.tnt_mod:{name}.name={cfg['name']}")
    write_text(os.path.join(RP, "texts", "en_US.lang"), "\n".join(lines) + "\n")
    write_json(os.path.join(RP, "texts", "languages.json"), ["en_US"])

    make_pack_icon(os.path.join(RP, "pack_icon.png"))

# ---------------------------------------------------------------------------
# scripts/main.js (the brains)
# ---------------------------------------------------------------------------
MAIN_JS = r"""
import { world, system } from "@minecraft/server";

// --- TNT registry (mirrors build.py) -------------------------------------
const TNT = {
  "tnt_mod:radioactive_tnt": { primed: "tnt_mod:primed_radioactive_tnt", radius: 6,  fuse: 80,  fire: false, effect: "radioactive" },
  "tnt_mod:chain_tnt":       { primed: "tnt_mod:primed_chain_tnt",       radius: 3,  fuse: 60,  fire: false, effect: "chain" },
  "tnt_mod:mini_tnt":        { primed: "tnt_mod:primed_mini_tnt",        radius: 2,  fuse: 25,  fire: false, effect: "none" },
  "tnt_mod:nuke_tnt":        { primed: "tnt_mod:primed_nuke_tnt",        radius: 18, fuse: 120, fire: true,  effect: "nuke" },
  "tnt_mod:lightning_tnt":   { primed: "tnt_mod:primed_lightning_tnt",   radius: 4,  fuse: 70,  fire: false, effect: "lightning" },
  "tnt_mod:ender_tnt":       { primed: "tnt_mod:primed_ender_tnt",       radius: 4,  fuse: 70,  fire: false, effect: "ender" },
  "tnt_mod:rainbow_tnt":     { primed: "tnt_mod:primed_rainbow_tnt",     radius: 5,  fuse: 70,  fire: false, effect: "rainbow" },
};

const rand = (a, b) => a + Math.random() * (b - a);

// Spawn a primed TNT entity and schedule its detonation.
function ignite(dimension, blockPos, cfg, fuse, impulse) {
  const center = {
    x: Math.floor(blockPos.x) + 0.5,
    y: Math.floor(blockPos.y) + 0.5,
    z: Math.floor(blockPos.z) + 0.5,
  };
  let entity;
  try { entity = dimension.spawnEntity(cfg.primed, center); }
  catch (e) { return; }
  if (impulse) { try { entity.applyImpulse(impulse); } catch (e) {} }
  const ticks = fuse ?? cfg.fuse;
  system.runTimeout(() => detonate(entity, cfg), ticks);
}

// Ignite any of our placed TNT blocks within range -> chain reactions.
function igniteNearby(dimension, loc, radius) {
  const r = Math.min(Math.ceil(radius), 6);
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++) {
        const pos = { x: Math.floor(loc.x) + x, y: Math.floor(loc.y) + y, z: Math.floor(loc.z) + z };
        let block;
        try { block = dimension.getBlock(pos); } catch (e) { continue; }
        if (!block) continue;
        const cfg = TNT[block.typeId];
        if (cfg) {
          try { block.setType("minecraft:air"); } catch (e) {}
          ignite(dimension, pos, cfg, 5 + Math.floor(rand(0, 16)));
        }
      }
}

function detonate(entity, cfg) {
  let loc, dim;
  try { loc = entity.location; dim = entity.dimension; }
  catch (e) { return; }          // entity already gone
  try { entity.remove(); } catch (e) {}

  igniteNearby(dim, loc, cfg.radius);
  applyEffect(dim, loc, cfg);

  try {
    dim.createExplosion(loc, cfg.radius, {
      breaksBlocks: true,
      causesFire: cfg.fire,
      allowUnderwater: true,
    });
  } catch (e) {}
}

function applyEffect(dim, loc, cfg) {
  switch (cfg.effect) {
    case "radioactive": {
      poisonWave(dim, loc, cfg.radius + 4, 4);    // lingering toxic cloud
      break;
    }
    case "chain": {
      const mini = TNT["tnt_mod:mini_tnt"];
      for (let i = 0; i < 5; i++) {
        const off = { x: loc.x + rand(-2, 2), y: loc.y + 0.5, z: loc.z + rand(-2, 2) };
        const vel = { x: rand(-0.3, 0.3), y: rand(0.4, 0.7), z: rand(-0.3, 0.3) };
        ignite(dim, off, mini, 15 + Math.floor(rand(0, 25)), vel);
      }
      break;
    }
    case "lightning": {
      try { dim.spawnEntity("minecraft:lightning_bolt", loc); } catch (e) {}
      for (let i = 0; i < 3; i++) {
        const off = { x: loc.x + rand(-5, 5), y: loc.y, z: loc.z + rand(-5, 5) };
        try { dim.spawnEntity("minecraft:lightning_bolt", off); } catch (e) {}
      }
      break;
    }
    case "ender": {
      let mobs = [];
      try { mobs = dim.getEntities({ location: loc, maxDistance: cfg.radius + 6 }); } catch (e) {}
      for (const m of mobs) {
        if (m.typeId === "minecraft:item") continue;
        try {
          m.teleport({ x: loc.x + rand(-15, 15), y: loc.y + rand(0, 6), z: loc.z + rand(-15, 15) });
        } catch (e) {}
      }
      try { dim.spawnParticle("minecraft:knockback_roar_particle", loc); } catch (e) {}
      break;
    }
    case "rainbow": {
      // burst of coloured smoke around the blast
      for (let i = 0; i < 24; i++) {
        const off = { x: loc.x + rand(-cfg.radius, cfg.radius), y: loc.y + rand(0, 3), z: loc.z + rand(-cfg.radius, cfg.radius) };
        try { dim.spawnParticle("minecraft:colored_flame_particle", off); } catch (e) {}
      }
      break;
    }
    case "nuke": {
      // mushroom ring of secondary blasts
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const off = { x: loc.x + Math.cos(a) * cfg.radius * 0.6, y: loc.y, z: loc.z + Math.sin(a) * cfg.radius * 0.6 };
        try { dim.createExplosion(off, cfg.radius * 0.5, { breaksBlocks: true, causesFire: true, allowUnderwater: true }); } catch (e) {}
      }
      poisonWave(dim, loc, cfg.radius, 6);
      break;
    }
  }
}

// Apply poison/wither to nearby living entities over several ticks.
function poisonWave(dim, loc, range, waves) {
  let n = 0;
  const id = system.runInterval(() => {
    let mobs = [];
    try { mobs = dim.getEntities({ location: loc, maxDistance: range }); } catch (e) {}
    for (const m of mobs) {
      try {
        m.addEffect("poison", 120, { amplifier: 2, showParticles: true });
        m.addEffect("wither", 80, { amplifier: 1, showParticles: true });
        m.addEffect("nausea", 120, { amplifier: 0, showParticles: true });
      } catch (e) {}
    }
    try { dim.spawnParticle("minecraft:wither_boss_invulnerable_particle", loc); } catch (e) {}
    if (++n >= waves) system.clearRun(id);
  }, 10);
}

// --- Ignition: right-click any custom TNT with flint & steel --------------
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || item.typeId !== "minecraft:flint_and_steel") return;
  const cfg = TNT[ev.block?.typeId];
  if (!cfg) return;
  const dim = ev.block.dimension;
  const pos = ev.block.location;
  try { ev.block.setType("minecraft:air"); } catch (e) {}
  ignite(dim, pos, cfg);
});

world.afterEvents.worldInitialize?.subscribe?.(() => {});
"""

# ---------------------------------------------------------------------------
# Package
# ---------------------------------------------------------------------------
def package():
    out = os.path.join(HERE, "UltimateTNT.mcaddon")
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(SRC):
            for fn in files:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, SRC)
                z.write(full, rel)
    return out

def main():
    if os.path.exists(SRC):
        shutil.rmtree(SRC)
    build_bp()
    build_rp()
    out = package()
    size = os.path.getsize(out)
    print(f"Built {out} ({size} bytes)")
    print(f"  Behavior pack: {BP}")
    print(f"  Resource pack: {RP}")

if __name__ == "__main__":
    main()
