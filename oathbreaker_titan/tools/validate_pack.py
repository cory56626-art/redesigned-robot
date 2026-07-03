#!/usr/bin/env python3
"""Cross-reference audit for the Oathbreaker Titan packs.

Checks that:
- every animation alias in client entities points to a defined animation/controller
- every animation referenced by the controller exists as a client-entity alias
- every controller transition target is a defined state
- every bone used in animations exists in the geometry
- every enum value used in controller molang exists in the BP entity property
- lang files parse cleanly (key=value per line)
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
RP = os.path.join(ROOT, "OathbreakerTitan_RP")
BP = os.path.join(ROOT, "OathbreakerTitan_BP")
errors = []


def load(p):
    with open(p) as f:
        return json.load(f)


# ---- gather definitions ----
anims = {}
for fn in os.listdir(os.path.join(RP, "animations")):
    anims.update(load(os.path.join(RP, "animations", fn)).get("animations", {}))

controllers = {}
for fn in os.listdir(os.path.join(RP, "animation_controllers")):
    controllers.update(load(os.path.join(RP, "animation_controllers", fn)).get("animation_controllers", {}))

geos = {}
for fn in os.listdir(os.path.join(RP, "models", "entity")):
    for g in load(os.path.join(RP, "models", "entity", fn)).get("minecraft:geometry", []):
        geos[g["description"]["identifier"]] = {b["name"] for b in g.get("bones", [])}

render_controllers = set()
for fn in os.listdir(os.path.join(RP, "render_controllers")):
    render_controllers.update(load(os.path.join(RP, "render_controllers", fn)).get("render_controllers", {}).keys())
render_controllers.add("controller.render.default")

# BP entity property enum values (all entities), each capped at 16.
# HARD ENGINE LIMIT: Bedrock enum properties allow at most 16 values.
# Exceeding it invalidates the whole property and cascades into broken
# animations, rendering and molang across the entity.
enum_values = set()
for fn in os.listdir(os.path.join(BP, "entities")):
    ent = load(os.path.join(BP, "entities", fn))["minecraft:entity"]
    ident = ent["description"]["identifier"]
    for pname, pdef in ent["description"].get("properties", {}).items():
        if pdef.get("type") == "enum":
            vals = pdef["values"]
            if len(vals) > 16:
                errors.append(f"{ident}: {pname} has {len(vals)} enum values — Bedrock max is 16")
            if len(vals) != len(set(vals)):
                errors.append(f"{ident}: {pname} has duplicate enum values")
            enum_values.update(vals)

# ---- check client entities ----
for fn in os.listdir(os.path.join(RP, "entity")):
    ce = load(os.path.join(RP, "entity", fn))["minecraft:client_entity"]["description"]
    ident = ce["identifier"]
    aliases = ce.get("animations", {})
    for alias, target in aliases.items():
        if target.startswith("animation.") and target not in anims:
            errors.append(f"{ident}: alias '{alias}' -> missing animation '{target}'")
        if target.startswith("controller.") and target not in controllers:
            errors.append(f"{ident}: alias '{alias}' -> missing controller '{target}'")
    for entry in ce.get("scripts", {}).get("animate", []):
        name = entry if isinstance(entry, str) else next(iter(entry))
        if name not in aliases:
            errors.append(f"{ident}: animate entry '{name}' has no alias")
    geo = ce["geometry"]["default"]
    if geo not in geos:
        errors.append(f"{ident}: missing geometry '{geo}'")
    for rc in ce.get("render_controllers", []):
        if rc not in render_controllers:
            errors.append(f"{ident}: missing render controller '{rc}'")
    # animation bones must exist in this geometry
    if geo in geos:
        for alias, target in aliases.items():
            if target in anims:
                for bone in anims[target].get("bones", {}):
                    if bone not in geos[geo]:
                        errors.append(f"{ident}: animation '{target}' uses unknown bone '{bone}'")

# ---- check controllers against the aliases of entities that use them ----
ctrl_aliases = {}  # controller name -> union of alias names from its users
for fn in os.listdir(os.path.join(RP, "entity")):
    ce = load(os.path.join(RP, "entity", fn))["minecraft:client_entity"]["description"]
    for alias, target in ce.get("animations", {}).items():
        if target.startswith("controller."):
            ctrl_aliases.setdefault(target, set()).update(ce["animations"].keys())
for cname, ctrl in controllers.items():
    aliases = ctrl_aliases.get(cname, set())
    if not aliases:
        errors.append(f"{cname}: not referenced by any client entity")
    states = ctrl.get("states", {})
    for sname, state in states.items():
        for a in state.get("animations", []):
            if a not in aliases:
                errors.append(f"{cname}/{sname}: references undefined alias '{a}'")
        for tr in state.get("transitions", []):
            target = next(iter(tr))
            cond = tr[target]
            if target not in states:
                errors.append(f"{cname}/{sname}: transition to undefined state '{target}'")
            for v in re.findall(r"== '(\w+)'|!= '(\w+)'", cond):
                val = v[0] or v[1]
                if val not in enum_values:
                    errors.append(f"{cname}/{sname}: condition uses unknown enum value '{val}'")

# ---- check script uses only defined enum values ----
with open(os.path.join(BP, "scripts", "main.js")) as f:
    js = f.read()
for val in re.findall(r'setAnimState\([^,]+,\s*"(\w+)"\)', js):
    if val not in enum_values:
        errors.append(f"main.js: setAnimState uses unknown enum value '{val}'")
# internal script states (s.state) may be a superset of the visual enum,
# but every internal state must be handled by the tick switch
internal_states = set(re.findall(r's\.state = "(\w+)"', js)) | set(re.findall(r'state: "(\w+)"', js))
switch_cases = set(re.findall(r'case "(\w+)":', js))
for st in internal_states:
    if st != "idle" and st not in switch_cases:
        errors.append(f"main.js: internal state '{st}' has no tick handler")

# ---- lang files ----
for pack in (BP, RP):
    p = os.path.join(pack, "texts", "en_US.lang")
    with open(p, "rb") as f:
        raw = f.read()
    if b"\r" in raw:
        errors.append(f"{p}: contains CR characters")
    for i, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if line.strip() and "=" not in line:
            errors.append(f"{p}:{i}: malformed line '{line}'")

if errors:
    print("AUDIT FAILED:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print(f"audit ok: {len(anims)} animations, {len(controllers)} controllers, "
      f"{len(geos)} geometries, {len(enum_values)} enum states, all cross-references valid")
