// Entity Verity — scripted horror behavior layer.
//
// The base mob (idle / 1s freeze / jitter-sprint chase / scream / melee) is
// fully data-driven and works without this script. This module adds the
// extras that the JSON entity system cannot express:
//
//   * window breach: while chasing, if the target hides in a building with
//     glass, Verity vanishes and reappears outside the nearest window, breaks
//     it "with its face", and crawls through the opening.
//   * climb / crawl animation states, surfaced to the client via the
//     "verity:state" entity property.
//
// All world access is wrapped in try/catch because blocks in unloaded chunks
// throw, and entities can despawn between scheduled steps.

import { world, system } from "@minecraft/server";

const VERITY = "verity:entity_verity";

// tuning
const SCAN_INTERVAL = 8;        // ticks between heavy scans
const BREACH_RANGE = 22;        // entity must be within this of the target
const WINDOW_RADIUS = 6;        // how far around the player we look for glass
const WINDOW_VRADIUS = 3;
const BREACH_COOLDOWN = 200;    // ticks (~10s) between breaches per entity
const CLIMB_DY = 2.5;           // target this much higher => play climb anim

const busy = new Set();         // entity ids mid-breach
const cooldown = new Map();     // entity id -> tick the next breach is allowed

function valid(e) {
  try {
    return typeof e.isValid === "function" ? e.isValid() : !!e.isValid;
  } catch (_) {
    return false;
  }
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function nearestPlayer(entity) {
  let best = null, bestD = Infinity;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== entity.dimension.id) continue;
    const d = dist2(entity.location, p.location);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? { player: best, d2: bestD } : null;
}

function setState(entity, state) {
  try {
    if (entity.getProperty("verity:state") !== state) {
      entity.setProperty("verity:state", state);
    }
  } catch (_) {}
}

function isGlass(block) {
  try {
    return block && block.typeId && block.typeId.includes("glass");
  } catch (_) {
    return false;
  }
}

// Find a glass block near the player, preferring the one closest to the entity.
function findWindow(entity, player) {
  const dim = entity.dimension;
  const px = Math.floor(player.location.x);
  const py = Math.floor(player.location.y);
  const pz = Math.floor(player.location.z);
  let best = null, bestD = Infinity;
  for (let dy = -WINDOW_VRADIUS; dy <= WINDOW_VRADIUS; dy++) {
    for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx++) {
      for (let dz = -WINDOW_RADIUS; dz <= WINDOW_RADIUS; dz++) {
        const loc = { x: px + dx, y: py + dy, z: pz + dz };
        let block;
        try { block = dim.getBlock(loc); } catch (_) { continue; }
        if (!isGlass(block)) continue;
        const d = dist2(entity.location, loc);
        if (d < bestD) { bestD = d; best = { x: loc.x, y: loc.y, z: loc.z }; }
      }
    }
  }
  return best;
}

function center(loc, y) {
  return { x: loc.x + 0.5, y: y !== undefined ? y : loc.y, z: loc.z + 0.5 };
}

// The multi-step breach sequence, scheduled with runTimeout so each beat lines
// up with the animation states.
function startBreach(entity, windowLoc, player) {
  const id = entity.id;
  busy.add(id);
  cooldown.set(id, system.currentTick + BREACH_COOLDOWN);
  const dim = entity.dimension;

  // direction from the window toward the player (the "inside")
  const toInside = {
    x: player.location.x - (windowLoc.x + 0.5),
    z: player.location.z - (windowLoc.z + 0.5),
  };
  const len = Math.hypot(toInside.x, toInside.z) || 1;
  const ix = Math.round(toInside.x / len);
  const iz = Math.round(toInside.z / len);
  const outsideLoc = { x: windowLoc.x - ix, y: windowLoc.y, z: windowLoc.z - iz };
  const insideLoc = { x: windowLoc.x + ix, y: windowLoc.y, z: windowLoc.z + iz };

  // Step 1 — vanish.
  try {
    setState(entity, "phase");
    entity.addEffect("invisibility", 50, { showParticles: false });
    dim.spawnParticle("minecraft:large_explosion", center(entity.location, entity.location.y + 1));
    dim.playSound("mob.endermen.portal", entity.location);
  } catch (_) {}

  // Step 2 — reappear outside the window, facing it.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      entity.teleport(center(outsideLoc, outsideLoc.y), {
        dimension: dim,
        facingLocation: center(windowLoc, windowLoc.y + 0.5),
      });
      entity.removeEffect("invisibility");
      setState(entity, "phase");
      dim.playSound("mob.endermen.portal", outsideLoc);
    } catch (_) {}
  }, 14);

  // Step 3 — break the glass "with its face".
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      for (const oy of [0, 1]) {
        const loc = { x: windowLoc.x, y: windowLoc.y + oy, z: windowLoc.z };
        const b = dim.getBlock(loc);
        if (isGlass(b)) {
          dim.spawnParticle("minecraft:knockback_roar_particle", center(loc, loc.y + 0.5));
          b.setType("minecraft:air");
        }
      }
      dim.playSound("random.glass", windowLoc);
      dim.playSound("random.glass", windowLoc);
    } catch (_) {}
  }, 26);

  // Step 4 — crawl through to the inside.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      entity.triggerEvent("verity:start_crawl");
      entity.teleport(center(insideLoc, windowLoc.y), {
        dimension: dim,
        facingLocation: player.location,
      });
    } catch (_) {}
  }, 34);

  // Step 5 — stand back up and resume the chase.
  system.runTimeout(() => {
    busy.delete(id);
    if (!valid(entity)) return;
    try { entity.triggerEvent("verity:stop_crawl"); } catch (_) {}
  }, 58);
}

let tick = 0;
system.runInterval(() => {
  tick++;
  if (tick % SCAN_INTERVAL !== 0) return;

  let entities;
  try { entities = world.getDimension("overworld").getEntities({ type: VERITY }); }
  catch (_) { return; }
  // also sweep nether/end in case it wanders dimensions
  for (const dimId of ["nether", "the_end"]) {
    try { entities = entities.concat(world.getDimension(dimId).getEntities({ type: VERITY })); }
    catch (_) {}
  }

  for (const entity of entities) {
    if (!valid(entity) || busy.has(entity.id)) continue;

    let state;
    try { state = entity.getProperty("verity:state"); } catch (_) { continue; }
    if (state !== "chase" && state !== "climb") continue;

    const near = nearestPlayer(entity);
    if (!near) continue;
    const { player } = near;
    const dy = player.location.y - entity.location.y;
    const horiz2 = dist2(
      { x: entity.location.x, y: 0, z: entity.location.z },
      { x: player.location.x, y: 0, z: player.location.z }
    );

    // climb anim: target is well above and we're up against it
    if (dy > CLIMB_DY && horiz2 < 6.25) {
      setState(entity, "climb");
      continue;
    } else if (state === "climb") {
      setState(entity, "chase");
    }

    // window breach
    if (near.d2 > BREACH_RANGE * BREACH_RANGE) continue;
    const cd = cooldown.get(entity.id) ?? 0;
    if (system.currentTick < cd) continue;
    const windowLoc = findWindow(entity, player);
    if (windowLoc) startBreach(entity, windowLoc, player);
  }
});
