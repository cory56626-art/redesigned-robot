#!/usr/bin/env python3
"""Generates the Bedrock server-entity JSON with per-stage stat component groups
and events, so the Marauder's health/damage/speed scale across the ten nights."""
import json, os

HEALTH = [20, 28, 36, 50, 65, 80, 105, 135, 170, 260]
DAMAGE = [4, 5, 6, 7, 8, 9, 10, 11, 13, 14]
SPEED = [0.30, 0.31, 0.31, 0.32, 0.33, 0.34, 0.34, 0.35, 0.36, 0.37]
KB = [0.4, 0.45, 0.5, 0.6, 0.6, 0.7, 0.75, 0.8, 0.85, 0.95]

stage_groups = {}
for i in range(10):
    stage = i + 1
    stage_groups[f"marauder:stage_{stage}"] = {
        "minecraft:health": {"value": HEALTH[i], "max": HEALTH[i]},
        "minecraft:attack": {"damage": DAMAGE[i]},
        "minecraft:movement": {"value": SPEED[i]},
        "minecraft:knockback_resistance": {"value": KB[i]}
    }

component_groups = dict(stage_groups)
component_groups["marauder:boss"] = {
    "minecraft:boss": {"should_darken_sky": False, "hud_range": 55, "name": "The Marauder"}
}

all_stage_groups = [f"marauder:stage_{s}" for s in range(1, 11)]
events = {}
for stage in range(1, 11):
    events[f"marauder:set_stage_{stage}"] = {
        "remove": {"component_groups": all_stage_groups},
        "add": {"component_groups": [f"marauder:stage_{stage}"]}
    }
events["marauder:become_boss"] = {"add": {"component_groups": ["marauder:boss"]}}
events["marauder:clear_boss"] = {"remove": {"component_groups": ["marauder:boss"]}}

entity = {
    "format_version": "1.20.60",
    "minecraft:entity": {
        "description": {
            "identifier": "marauder:marauder",
            "is_spawnable": True,
            "is_summonable": True,
            "is_experimental": False,
            "properties": {
                "marauder:stage": {"type": "int", "range": [1, 10], "default": 1, "client_sync": True},
                "marauder:attacking": {"type": "bool", "default": False, "client_sync": True}
            }
        },
        "component_groups": component_groups,
        "components": {
            "minecraft:type_family": {"family": ["marauder", "monster", "mob"]},
            "minecraft:health": {"value": 20, "max": 20},
            "minecraft:movement": {"value": 0.3},
            "minecraft:knockback_resistance": {"value": 0.4},
            "minecraft:attack": {"damage": 4},
            "minecraft:collision_box": {"width": 0.8, "height": 1.95},
            "minecraft:physics": {},
            "minecraft:jump.static": {},
            "minecraft:movement.basic": {},
            "minecraft:navigation.walk": {
                "can_path_over_water": True, "avoid_water": False,
                "can_pass_doors": True, "can_open_doors": False
            },
            "minecraft:can_climb": {},
            "minecraft:despawn": {"despawn_from_distance": {"max_distance": 128}},
            "minecraft:behavior.float": {"priority": 0},
            "minecraft:behavior.melee_attack": {
                "priority": 3, "speed_multiplier": 1.25, "track_target": True, "reach_multiplier": 1.6
            },
            "minecraft:behavior.nearest_attackable_target": {
                "priority": 2, "must_see": False, "must_reach": False, "reselect_targets": True,
                "within_radius": 64,
                "entity_types": [{
                    "filters": {"test": "is_family", "subject": "other", "value": "player"},
                    "max_dist": 64
                }]
            },
            "minecraft:behavior.look_at_player": {"priority": 7, "look_distance": 24},
            "minecraft:behavior.random_look_around": {"priority": 8}
        },
        "events": events
    }
}

out = os.path.join(os.path.dirname(__file__), "..", "behavior_packs", "marauder_bp", "entities", "marauder.json")
with open(out, "w") as f:
    json.dump(entity, f, indent=2)
print("wrote", os.path.normpath(out))
