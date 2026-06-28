#!/usr/bin/env python3
"""Generate behaviour-pack item JSONs and the resource-pack item_texture.json."""
import json
import os

BP = os.path.join(os.path.dirname(__file__), "behavior_pack")
RP = os.path.join(os.path.dirname(__file__), "resource_pack")

# id, texture(shortname), display name (with colour codes), damage, is the gem?
ITEMS = [
    ("power_gem",      "power_gem",      "§dPower Gem",                0, True),
    ("god_of_war",     "god_of_war",     "§6God of War: §cApex Rage",  0, False),
    ("blue_inferno",   "blue_inferno",   "§6God of War: §9Blue Inferno",0, False),
    ("sonic_boots",    "sonic_boots",    "§bAs Fast As Sonic",  3, False),
    ("frost_scepter",  "frost_scepter",  "§bFrost Sovereign",   5, False),
    ("storm_hammer",   "storm_hammer",   "§eStorm Bringer",     6, False),
    ("titan_gauntlet", "titan_gauntlet", "§2Titan",             6, False),
    ("phantom_dagger", "phantom_dagger", "§5Phantom",           5, False),
    ("phoenix_feather","phoenix_feather","§6Phoenix",           5, False),
    ("void_eye",       "void_eye",       "§5Void Walker",       6, False),
]


def make_item(idn, tex, name, dmg, is_gem):
    components = {
        "minecraft:icon": tex,
        "minecraft:display_name": {"value": name},
        "minecraft:max_stack_size": 16 if is_gem else 1,
    }
    # Relics are power tokens you keep in your inventory; they buff whatever
    # weapon you actually fight with rather than being a weapon themselves.
    RELICS = {"god_of_war", "blue_inferno"}
    if is_gem or idn in RELICS:
        category = "items"
    else:
        category = "equipment"
        components["minecraft:hand_equipped"] = True
        components["minecraft:damage"] = dmg
        components["minecraft:durability"] = {"max_durability": 2000}
    return {
        "format_version": "1.21.0",
        "minecraft:item": {
            "description": {
                "identifier": f"powers:{idn}",
                "menu_category": {"category": category},
            },
            "components": components,
        },
    }


def main():
    os.makedirs(os.path.join(BP, "items"), exist_ok=True)
    for idn, tex, name, dmg, is_gem in ITEMS:
        path = os.path.join(BP, "items", f"{idn}.json")
        with open(path, "w") as f:
            json.dump(make_item(idn, tex, name, dmg, is_gem), f, indent=2)
        print("wrote", path)

    texture_data = {tex: {"textures": f"textures/items/{tex}"} for _, tex, *_ in ITEMS}
    item_texture = {
        "resource_pack_name": "powers",
        "texture_name": "atlas.items",
        "texture_data": texture_data,
    }
    path = os.path.join(RP, "textures", "item_texture.json")
    with open(path, "w") as f:
        json.dump(item_texture, f, indent=2)
    print("wrote", path)


if __name__ == "__main__":
    main()
