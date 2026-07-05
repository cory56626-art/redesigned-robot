/**
 * Reference-integrity validator.
 *
 * Cross-checks the behaviour and resource packs for the *dangling reference*
 * bugs that don't show up as JSON syntax errors but do make content silently
 * fail in-game (blank icons, missing textures, unresolved geometry). Run inside
 * the build; a non-zero exit blocks packaging.
 *
 * Run:  node tools/validate.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BP = join(ROOT, "behavior_packs", "of_bp");
const RP = join(ROOT, "resource_packs", "of_rp");

const errors = [];
const err = (m) => errors.push(m);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const rel = (p) => p.replace(ROOT + "/", "");

/* ------------------------------------------------ texture atlases */

let itemKeys = {};
let terrainKeys = {};
const itemTexPath = join(RP, "textures", "item_texture.json");
const terrainTexPath = join(RP, "textures", "terrain_texture.json");

if (!existsSync(itemTexPath)) err("Missing textures/item_texture.json");
else itemKeys = readJson(itemTexPath).texture_data ?? {};
if (!existsSync(terrainTexPath)) err("Missing textures/terrain_texture.json");
else terrainKeys = readJson(terrainTexPath).texture_data ?? {};

// Every atlas entry must point at a real PNG.
function checkAtlas(keys, label) {
  for (const [key, def] of Object.entries(keys)) {
    const textures = def.textures;
    const paths = Array.isArray(textures) ? textures : [textures];
    for (const t of paths) {
      const png = join(RP, `${t}.png`);
      if (!existsSync(png)) err(`${label} key "${key}" → missing ${t}.png`);
    }
  }
}
checkAtlas(itemKeys, "item_texture");
checkAtlas(terrainKeys, "terrain_texture");

/* ------------------------------------------------ geometry identifiers */

const geoIds = new Set();
for (const f of walk(join(RP, "models"))) {
  if (!f.endsWith(".json")) continue;
  const data = readJson(f);
  for (const g of data["minecraft:geometry"] ?? []) {
    const id = g.description?.identifier;
    if (id) geoIds.add(id);
  }
}

/* ------------------------------------------------ items → icon shortnames */

for (const f of walk(join(BP, "items"))) {
  if (!f.endsWith(".json")) continue;
  const comp = readJson(f)["minecraft:item"]?.components ?? {};
  const icon = comp["minecraft:icon"];
  if (icon === undefined) {
    err(`${rel(f)}: no minecraft:icon`);
    continue;
  }
  const shortname = typeof icon === "string" ? icon : icon.texture ?? icon?.textures?.default;
  if (!shortname) err(`${rel(f)}: unreadable minecraft:icon`);
  else if (!(shortname in itemKeys)) err(`${rel(f)}: icon "${shortname}" not in item_texture.json`);
}

/* ------------------------------------------------ blocks → texture keys + geometry */

for (const f of walk(join(BP, "blocks"))) {
  if (!f.endsWith(".json")) continue;
  const block = readJson(f)["minecraft:block"];
  const comp = block?.components ?? {};

  const mats = comp["minecraft:material_instances"];
  if (mats) {
    for (const [face, inst] of Object.entries(mats)) {
      const tex = inst.texture;
      if (tex && !(tex in terrainKeys)) {
        err(`${rel(f)}: material "${face}" texture "${tex}" not in terrain_texture.json`);
      }
    }
  }
  const geo = comp["minecraft:geometry"];
  const geoId = typeof geo === "string" ? geo : geo?.identifier;
  if (geoId && !geoIds.has(geoId)) err(`${rel(f)}: geometry "${geoId}" not found in models/`);
}

/* ------------------------------------------------ client entities */

for (const f of walk(join(RP, "entity"))) {
  if (!f.endsWith(".json")) continue;
  const desc = readJson(f)["minecraft:client_entity"]?.description ?? {};
  for (const [name, path] of Object.entries(desc.textures ?? {})) {
    if (!existsSync(join(RP, `${path}.png`)) && !existsSync(join(RP, path))) {
      err(`${rel(f)}: texture "${name}" → missing ${path}.png`);
    }
  }
  for (const [name, id] of Object.entries(desc.geometry ?? {})) {
    if (!geoIds.has(id)) err(`${rel(f)}: geometry "${name}" → "${id}" not found`);
  }
}

/* ------------------------------------------------ particles referenced in config */

const particleIds = new Set();
for (const f of walk(join(RP, "particles"))) {
  if (!f.endsWith(".json")) continue;
  const id = readJson(f).particle_effect?.description?.identifier;
  if (id) particleIds.add(id);
}
const configSrc = readFileSync(join(BP, "scripts", "core", "config.js"), "utf8");
for (const m of configSrc.matchAll(/"(of:[a-z_]+)"/g)) {
  if (!particleIds.has(m[1])) err(`config.js references particle "${m[1]}" with no particle JSON`);
}

/* ------------------------------------------------ manifests */

for (const [label, base] of [["BP", BP], ["RP", RP]]) {
  const mf = join(base, "manifest.json");
  if (!existsSync(mf)) {
    err(`${label}: missing manifest.json`);
    continue;
  }
  const m = readJson(mf);
  if (!m.header?.uuid) err(`${label}: manifest header.uuid missing`);
  if (label === "BP") {
    const deps = (m.dependencies ?? []).map((d) => `${d.module_name ?? ""}@${d.version ?? ""}`);
    for (const need of ["@minecraft/server", "@minecraft/server-ui"]) {
      const dep = deps.find((d) => d.startsWith(need + "@"));
      if (!dep) err(`BP: manifest missing dependency ${need}`);
      else if (dep.includes("-beta")) err(`BP: ${dep} is a beta version (use stable)`);
    }
  }
}

/* ------------------------------------------------ report */

if (errors.length) {
  console.error(`✗ validate: ${errors.length} reference problem(s):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✔ validate: all icon / texture / geometry / particle / manifest references resolve");
