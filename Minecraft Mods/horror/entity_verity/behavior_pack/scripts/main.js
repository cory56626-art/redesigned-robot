// Entity Verity — scripted horror behavior layer.
//
// The base mob (idle / 1s freeze / jitter-sprint chase / scream / melee) is
// fully data-driven and works without this script. This module adds:
//
//   * window breach: while chasing, if the target hides near glass, Verity
//     vanishes, reappears OUTSIDE the nearest window, breaks it "with its
//     face", then crawls through. Deliberately slow + telegraphed so the
//     player actually watches it happen. Verity is frozen in place for the
//     whole routine so its chase AI can't drag it off the mark.
//   * a real wall-climb (Bedrock can_climb only does ladders): when the
//     target is above and Verity is against a wall, it is lifted up the wall
//     while the climb animation plays.
//
// Animation state is surfaced to the model through the int entity property
// "verity:anim": 0 idle, 1 alert, 2 chase, 3 climb, 4 crawl, 5 phase.
//
// World access is wrapped in try/catch: blocks in unloaded chunks throw and
// entities can despawn between scheduled steps.

import { world, system } from "@minecraft/server";

const VERITY = "verity:entity_verity";
const ANIM = { IDLE: 0, ALERT: 1, CHASE: 2, CLIMB: 3, CRAWL: 4, PHASE: 5 };

// tuning
const SCAN_INTERVAL = 6;        // ticks between scans
const BREACH_RANGE = 22;        // entity must be within this of the target
const WINDOW_RADIUS = 6;        // search box around the player for glass
const WINDOW_VRADIUS = 3;
const BREACH_COOLDOWN = 500;    // ticks (~25s) between breaches per entity
const CLIMB_DY = 1.2;           // target this much higher => climb

const busy = new Set();         // entity ids mid-breach
const cooldown = new Map();     // entity id -> earliest next-breach tick

function valid(e) {
  try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; }
  catch (_) { return false; }
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

function setAnim(entity, n) {
  try { if (entity.getProperty("verity:anim") !== n) entity.setProperty("verity:anim", n); }
  catch (_) {}
}

function isGlass(block) {
  try { return block && block.typeId && block.typeId.includes("glass"); }
  catch (_) { return false; }
}

function isSolid(block) {
  if (!block) return false;
  try { if (block.isAir) return false; } catch (_) {}
  try { if (block.isLiquid) return false; } catch (_) {}
  return true;
}

function center(loc, y) {
  return { x: loc.x + 0.5, y: y !== undefined ? y : loc.y, z: loc.z + 0.5 };
}

function freeze(entity, ticks) {
  try { entity.addEffect("slowness", ticks, { amplifier: 250, showParticles: false }); }
  catch (_) {}
}
function unfreeze(entity) {
  try { entity.removeEffect("slowness"); } catch (_) {}
}

// Find a glass block near the player, preferring the one nearest the entity.
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

// Slow, telegraphed window-breach sequence. Times are in ticks (20 = 1s).
function startBreach(entity, windowLoc, player) {
  const id = entity.id;
  busy.add(id);
  cooldown.set(id, system.currentTick + BREACH_COOLDOWN);
  const dim = entity.dimension;

  const toInside = {
    x: player.location.x - (windowLoc.x + 0.5),
    z: player.location.z - (windowLoc.z + 0.5),
  };
  const len = Math.hypot(toInside.x, toInside.z) || 1;
  const ix = Math.round(toInside.x / len);
  const iz = Math.round(toInside.z / len);
  const outsideLoc = { x: windowLoc.x - ix, y: windowLoc.y, z: windowLoc.z - iz };
  const insideLoc = { x: windowLoc.x + ix, y: windowLoc.y, z: windowLoc.z + iz };

  // keep it pinned for the whole show (~9s)
  freeze(entity, 190);

  // Step 1 (t=0) — vanish in place.
  try {
    setAnim(entity, ANIM.PHASE);
    entity.addEffect("invisibility", 200, { showParticles: false });
    dim.spawnParticle("minecraft:large_explosion", center(entity.location, entity.location.y + 1));
    dim.playSound("mob.endermen.portal", entity.location);
  } catch (_) {}

  // Step 2 (t=40, 2s) — reappear OUTSIDE the window, facing it, and just stand.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      entity.teleport(center(outsideLoc, outsideLoc.y), {
        dimension: dim,
        facingLocation: center(windowLoc, windowLoc.y + 0.5),
      });
      entity.removeEffect("invisibility");
      freeze(entity, 150);
      setAnim(entity, ANIM.PHASE);
      dim.playSound("mob.endermen.portal", outsideLoc);
      dim.playSound("mob.endermen.stare", outsideLoc);
    } catch (_) {}
  }, 40);

  // Step 3 (t=90, ~4.5s) — slam the glass: top pane first, with cracks.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      const top = { x: windowLoc.x, y: windowLoc.y + 1, z: windowLoc.z };
      const b = dim.getBlock(top);
      dim.spawnParticle("minecraft:knockback_roar_particle", center(top, top.y + 0.3));
      if (isGlass(b)) b.setType("minecraft:air");
      dim.playSound("random.glass", top);
    } catch (_) {}
  }, 90);

  // Step 4 (t=110, ~5.5s) — break the main pane.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      const b = dim.getBlock(windowLoc);
      dim.spawnParticle("minecraft:knockback_roar_particle", center(windowLoc, windowLoc.y + 0.3));
      if (isGlass(b)) b.setType("minecraft:air");
      dim.playSound("random.glass", windowLoc);
      dim.playSound("random.glass", windowLoc);
    } catch (_) {}
  }, 110);

  // Step 5 (t=135, ~6.75s) — crawl through to the inside, slowly.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      entity.triggerEvent("verity:start_crawl");
      freeze(entity, 70);
      entity.teleport(center(windowLoc, windowLoc.y), {
        dimension: dim,
        facingLocation: player.location,
      });
    } catch (_) {}
  }, 135);

  // Step 6 (t=165, ~8.25s) — finish crawling inside.
  system.runTimeout(() => {
    if (!valid(entity)) { busy.delete(id); return; }
    try {
      entity.teleport(center(insideLoc, windowLoc.y), {
        dimension: dim,
        facingLocation: player.location,
      });
    } catch (_) {}
  }, 165);

  // Step 7 (t=190, ~9.5s) — stand up and resume the chase.
  system.runTimeout(() => {
    busy.delete(id);
    if (!valid(entity)) return;
    try { entity.triggerEvent("verity:stop_crawl"); unfreeze(entity); } catch (_) {}
  }, 190);
}

function stopClimb(entity) {
  try { entity.removeEffect("levitation"); } catch (_) {}
}

// Scripted wall climb. Returns true if Verity is climbing this tick.
// Bedrock has no data-driven wall climb, and plain gravity would cancel a
// teleport-based lift between scans, so we drive it with a refreshed
// levitation effect that only runs while a wall is right in front.
function tryClimb(entity, player) {
  const dy = player.location.y - entity.location.y;
  if (dy < CLIMB_DY) { stopClimb(entity); return false; }

  const dim = entity.dimension;
  const ex = entity.location.x, ey = entity.location.y, ez = entity.location.z;
  const dx = player.location.x - ex, dz = player.location.z - ez;
  const len = Math.hypot(dx, dz) || 1;
  const sx = Math.round(dx / len), sz = Math.round(dz / len);

  // is there a wall right in front, at chest height, and are we up against it?
  const horiz2 = dx * dx + dz * dz;
  if (horiz2 > 6.25) { stopClimb(entity); return false; }
  const frontLoc = { x: Math.floor(ex) + sx, y: Math.floor(ey) + 1, z: Math.floor(ez) + sz };
  let front;
  try { front = dim.getBlock(frontLoc); } catch (_) { stopClimb(entity); return false; }
  if (!isSolid(front)) { stopClimb(entity); return false; }

  setAnim(entity, ANIM.CLIMB);

  // rise up the wall while there is headroom, otherwise let it mount the top
  const headLoc = { x: Math.floor(ex), y: Math.floor(ey) + 3, z: Math.floor(ez) };
  let head;
  try { head = dim.getBlock(headLoc); } catch (_) { head = undefined; }
  if (!isSolid(head)) {
    // levitation lifts it steadily and survives the gap between scans
    try { entity.addEffect("levitation", 12, { amplifier: 1, showParticles: false }); }
    catch (_) {}
  } else {
    stopClimb(entity);
  }
  return true;
}

let tick = 0;
system.runInterval(() => {
  tick++;
  if (tick % SCAN_INTERVAL !== 0) return;

  let entities = [];
  for (const dimId of ["overworld", "nether", "the_end"]) {
    try { entities = entities.concat(world.getDimension(dimId).getEntities({ type: VERITY })); }
    catch (_) {}
  }

  for (const entity of entities) {
    if (!valid(entity) || busy.has(entity.id)) continue;

    let state;
    try { state = entity.getProperty("verity:anim"); } catch (_) { continue; }
    if (state !== ANIM.CHASE && state !== ANIM.CLIMB) continue;

    const near = nearestPlayer(entity);
    if (!near) continue;
    const { player } = near;

    // 1) climbing takes priority over breaching
    if (tryClimb(entity, player)) continue;
    if (state === ANIM.CLIMB) setAnim(entity, ANIM.CHASE);

    // 2) window breach
    if (near.d2 > BREACH_RANGE * BREACH_RANGE) continue;
    const cd = cooldown.get(entity.id) ?? 0;
    if (system.currentTick < cd) continue;
    const windowLoc = findWindow(entity, player);
    if (windowLoc) startBreach(entity, windowLoc, player);
  }
});
