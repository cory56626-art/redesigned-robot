// Entity Verity — scripted horror behavior layer.
//
// The base mob (jitter-sprint chase + scream + melee) is data-driven via the
// "verity:hunting" component group. This script owns everything that happens
// BEFORE/AROUND the chase and cannot be expressed in JSON:
//
//   1. Long-distance stalk -> bone-cracking transformation -> charge.
//   2. House-breach: crawl to the nearest door, open it, crawl in, stare,
//      snap upright, chase.
//   3. Mineshaft ambush: wait silently above the player, lean, then chase.
//   4. Movement-mirror mode (copies the player with a slight delay).
//   5. "!" chat commands.
//
// Animation is surfaced to the model through the int property "verity:anim":
//   0 idle  1 alert  2 chase  3 climb  4 crawl  5 phase
//   6 transform  7 mirror  8 stare  9 snap
// Sound only plays in chase (the scream is on the hunting group) and the
// scripted bone-crack; every other stage is silent, as specified.
//
// Note: the "smile" in the stalk can't be shown without editing the texture
// (which is on the do-not-change list), so the menace is carried by the
// head-tilt / crouch pose instead.

import { world, system } from "@minecraft/server";

const VERITY = "verity:entity_verity";
const A = { IDLE: 0, ALERT: 1, CHASE: 2, CLIMB: 3, CRAWL: 4, PHASE: 5, TRANSFORM: 6, MIRROR: 7, STARE: 8, SNAP: 9 };

// tuning (blocks / ticks; 20 ticks = 1s)
const SCAN = 4;
const STALK_NEAR = 14, CHASE_NEAR = 6;
const MIRROR_MIN = 10, MIRROR_MAX = 18;
const STARE_TIME = 60, TRANSFORM_TIME = 45;
const LOOKAWAY_LIMIT = 20;       // ticks of not-looking before mirror resolves
const MIRROR_TIME_MIN = 70, MIRROR_TIME_MAX = 150;  // mirror this long, then flip a coin
const HIDE_TIME = 120;           // ticks Verity stays vanished after fleeing
const STUCK_LIMIT = 18;          // ticks of "can't get closer" before a breach (~0.9s)
const BREACH_RANGE = 26, WINDOW_RADIUS = 12, WINDOW_VRADIUS = 4, DOOR_RADIUS = 12;
const BREACH_COOLDOWN = 140, CLIMB_DY = 1.2;

const S = new Map();             // entity id -> behavioral record
const busy = new Set();          // entity id -> running a one-shot sequence
const cooldown = new Map();      // entity id -> earliest next auto-breach tick
const pHist = new Map();         // player id -> [last positions]
const enclosed = new Map();      // player id -> ticks roofed

function valid(e) { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (_) { return false; } }
function rec(id) {
  let r = S.get(id);
  if (!r) { r = { mode: "idle", t0: system.currentTick, lookAway: 0, forced: null, crouch: false }; S.set(id, r); }
  return r;
}
function dist2(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
function center(l, y) { return { x: l.x + 0.5, y: y !== undefined ? y : l.y, z: l.z + 0.5 }; }

function nearestPlayer(entity) {
  let best = null, bd = Infinity;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== entity.dimension.id) continue;
    const d = dist2(entity.location, p.location);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { player: best, d: Math.sqrt(bd) } : null;
}
function setAnim(e, n) { try { if (e.getProperty("verity:anim") !== n) e.setProperty("verity:anim", n); } catch (_) {} }
function faceTo(e, loc) { try { e.teleport(e.location, { facingLocation: loc }); } catch (_) {} }
function freeze(e, t) { try { e.addEffect("slowness", t, { amplifier: 250, showParticles: false }); } catch (_) {} }
function unfreeze(e) { try { e.removeEffect("slowness"); } catch (_) {} }

function isGlass(b) { try { return b && b.typeId && b.typeId.includes("glass"); } catch (_) { return false; } }
function isDoor(b) { try { return b && b.typeId && b.typeId.includes("door") && !b.typeId.includes("trapdoor"); } catch (_) { return false; } }
function isSolid(b) {
  if (!b) return false;
  try { if (b.isAir) return false; } catch (_) {}
  try { if (b.isLiquid) return false; } catch (_) {}
  return true;
}

// crude line-of-sight: sample blocks between the two eye points
function losClear(dim, a, b) {
  const ax = a.x, ay = a.y + 2.4, az = a.z;
  const bx = b.x, by = b.y + 1.5, bz = b.z;
  const steps = Math.max(2, Math.floor(Math.hypot(bx - ax, by - ay, bz - az)));
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const loc = { x: Math.floor(ax + (bx - ax) * f), y: Math.floor(ay + (by - ay) * f), z: Math.floor(az + (bz - az) * f) };
    let blk; try { blk = dim.getBlock(loc); } catch (_) { return false; }
    if (isSolid(blk) && !isGlass(blk)) return false;
  }
  return true;
}
function playerLooking(player, entity) {
  try {
    const v = player.getViewDirection();
    const to = { x: entity.location.x - player.location.x, y: 0, z: entity.location.z - player.location.z };
    const len = Math.hypot(to.x, to.z) || 1;
    return (v.x * to.x + v.z * to.z) / len > 0.55;
  } catch (_) { return false; }
}

function startChase(e) {
  const r = rec(e.id);
  r.mode = "chase"; r.forced = null; r.prevDist = undefined; r.stuck = 0;
  unfreeze(e);
  try { e.triggerEvent("verity:begin_hunt"); } catch (_) {}
}

// 1) STALK -> bone-cracking TRANSFORM -> charge
function doTransform(e, player) {
  const id = e.id; busy.add(id); rec(id).mode = "transform";
  freeze(e, TRANSFORM_TIME + 10);
  setAnim(e, A.TRANSFORM);
  faceTo(e, player.location);
  for (const at of [0, 10, 18, 26, 34]) {
    system.runTimeout(() => { if (valid(e)) { try { e.dimension.playSound("mob.entity_verity.bonecrack", e.location); } catch (_) {} } }, at);
  }
  system.runTimeout(() => { busy.delete(id); if (valid(e)) startChase(e); }, TRANSFORM_TIME);
}

// quick "snap upright / lean" then charge (mineshaft + house-breach finisher)
function doSnap(e) {
  const id = e.id; busy.add(id);
  freeze(e, 16); setAnim(e, A.SNAP);
  system.runTimeout(() => { busy.delete(id); if (valid(e)) startChase(e); }, 12);
}

// 2) HOUSE BREACH via the nearest door
function findDoor(dim, player) {
  const px = Math.floor(player.location.x), py = Math.floor(player.location.y), pz = Math.floor(player.location.z);
  let best = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -DOOR_RADIUS; dx <= DOOR_RADIUS; dx++) for (let dz = -DOOR_RADIUS; dz <= DOOR_RADIUS; dz++) {
    const loc = { x: px + dx, y: py + dy, z: pz + dz };
    let b; try { b = dim.getBlock(loc); } catch (_) { continue; }
    if (!isDoor(b)) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = { x: loc.x, y: loc.y, z: loc.z }; }
  }
  return best;
}
function openDoor(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (isDoor(b)) b.setPermutation(b.permutation.withState("open_bit", true));
  } catch (_) {}
}
function doDoorBreach(e, player) {
  const dim = e.dimension;
  const door = findDoor(dim, player);
  if (!door) { try { player.sendMessage("§7Verity finds no door…"); } catch (_) {} return; }
  const id = e.id; busy.add(id); rec(id).mode = "door";
  cooldown.set(id, system.currentTick + BREACH_COOLDOWN);

  const toIn = { x: player.location.x - (door.x + 0.5), z: player.location.z - (door.z + 0.5) };
  const len = Math.hypot(toIn.x, toIn.z) || 1;
  const ix = Math.round(toIn.x / len), iz = Math.round(toIn.z / len);
  const outside = { x: door.x - ix, y: door.y, z: door.z - iz };
  const inside = { x: door.x + ix, y: door.y, z: door.z + iz };
  const standoff = { x: player.location.x - ix * 3, y: player.location.y, z: player.location.z - iz * 3 };

  freeze(e, 150);
  try { e.triggerEvent("verity:start_crawl"); } catch (_) {} // low spider crawl (anim 4)

  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.teleport(center(outside, outside.y), { dimension: dim, facingLocation: center(door, door.y + 1) }); freeze(e, 120); } catch (_) {} }, 30);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); openDoor(dim, door); openDoor(dim, { x: door.x, y: door.y + 1, z: door.z }); try { dim.playSound("open.wooden_door", door); } catch (_) {} }, 45);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.teleport(center(inside, inside.y), { dimension: dim, facingLocation: player.location }); } catch (_) {} }, 60);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.teleport(center({ x: Math.floor(standoff.x), y: Math.floor(standoff.y), z: Math.floor(standoff.z) }, standoff.y), { dimension: dim, facingLocation: player.location }); e.triggerEvent("verity:stop_crawl"); setAnim(e, A.STARE); freeze(e, 60); } catch (_) {} }, 80);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); setAnim(e, A.SNAP); freeze(e, 18); }, 120);
  system.runTimeout(() => { busy.delete(id); if (valid(e)) startChase(e); }, 138);
}

// window breach (kept from before; used in chase + by !verityglass)
function findWindow(dim, entity, player) {
  const px = Math.floor(player.location.x), py = Math.floor(player.location.y), pz = Math.floor(player.location.z);
  let best = null, bd = Infinity;
  for (let dy = -WINDOW_VRADIUS; dy <= WINDOW_VRADIUS; dy++) for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx++) for (let dz = -WINDOW_RADIUS; dz <= WINDOW_RADIUS; dz++) {
    const loc = { x: px + dx, y: py + dy, z: pz + dz };
    let b; try { b = dim.getBlock(loc); } catch (_) { continue; }
    if (!isGlass(b)) continue;
    const d = dist2(entity.location, loc);
    if (d < bd) { bd = d; best = { x: loc.x, y: loc.y, z: loc.z }; }
  }
  return best;
}
function startWindowBreach(e, win, player) {
  const id = e.id; busy.add(id); rec(id).mode = "glass";
  cooldown.set(id, system.currentTick + BREACH_COOLDOWN);
  const dim = e.dimension;
  const toIn = { x: player.location.x - (win.x + 0.5), z: player.location.z - (win.z + 0.5) };
  const len = Math.hypot(toIn.x, toIn.z) || 1;
  const ix = Math.round(toIn.x / len), iz = Math.round(toIn.z / len);
  const outside = { x: win.x - ix, y: win.y, z: win.z - iz };
  const inside = { x: win.x + ix, y: win.y, z: win.z + iz };

  freeze(e, 95);
  try { setAnim(e, A.PHASE); e.addEffect("invisibility", 60, { showParticles: false }); dim.spawnParticle("minecraft:large_explosion", center(e.location, e.location.y + 1)); dim.playSound("mob.endermen.portal", e.location); } catch (_) {}
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.teleport(center(outside, outside.y), { dimension: dim, facingLocation: center(win, win.y + 0.5) }); e.removeEffect("invisibility"); freeze(e, 75); setAnim(e, A.PHASE); dim.playSound("mob.endermen.stare", outside); } catch (_) {} }, 20);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { const t = { x: win.x, y: win.y + 1, z: win.z }; const b = dim.getBlock(t); dim.spawnParticle("minecraft:knockback_roar_particle", center(t, t.y + 0.3)); if (isGlass(b)) b.setType("minecraft:air"); dim.playSound("random.glass", t); } catch (_) {} }, 40);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { const b = dim.getBlock(win); dim.spawnParticle("minecraft:knockback_roar_particle", center(win, win.y + 0.3)); if (isGlass(b)) b.setType("minecraft:air"); dim.playSound("random.glass", win); } catch (_) {} }, 52);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.triggerEvent("verity:start_crawl"); freeze(e, 32); e.teleport(center(win, win.y), { dimension: dim, facingLocation: player.location }); } catch (_) {} }, 64);
  system.runTimeout(() => { if (!valid(e)) return busy.delete(id); try { e.teleport(center(inside, win.y), { dimension: dim, facingLocation: player.location }); } catch (_) {} }, 78);
  system.runTimeout(() => { busy.delete(id); if (valid(e)) { try { e.triggerEvent("verity:stop_crawl"); unfreeze(e); } catch (_) {} } }, 88);
}

// scripted wall climb (chase only) — see notes in entity JSON
function tryClimb(e, player) {
  const dy = player.location.y - e.location.y;
  if (dy < CLIMB_DY) { try { e.removeEffect("levitation"); } catch (_) {} return false; }
  const dim = e.dimension, ex = e.location.x, ey = e.location.y, ez = e.location.z;
  const dx = player.location.x - ex, dz = player.location.z - ez;
  if (dx * dx + dz * dz > 6.25) { try { e.removeEffect("levitation"); } catch (_) {} return false; }
  const l = Math.hypot(dx, dz) || 1, sx = Math.round(dx / l), sz = Math.round(dz / l);
  let front; try { front = dim.getBlock({ x: Math.floor(ex) + sx, y: Math.floor(ey) + 1, z: Math.floor(ez) + sz }); } catch (_) { return false; }
  if (!isSolid(front)) { try { e.removeEffect("levitation"); } catch (_) {} return false; }
  setAnim(e, A.CLIMB);
  let head; try { head = dim.getBlock({ x: Math.floor(ex), y: Math.floor(ey) + 3, z: Math.floor(ez) }); } catch (_) {}
  if (!isSolid(head)) { try { e.addEffect("levitation", 12, { amplifier: 1, showParticles: false }); } catch (_) {} }
  else { try { e.removeEffect("levitation"); } catch (_) {} }
  return true;
}

// mineshaft check: Verity above the player with an open exit overhead
function mineshaft(e, player) {
  const dy = e.location.y - player.location.y;
  if (dy < 4) return false;
  const dim = e.dimension;
  let above; try { above = dim.getBlock({ x: Math.floor(e.location.x), y: Math.floor(e.location.y) + 3, z: Math.floor(e.location.z) }); } catch (_) { return false; }
  if (isSolid(above)) return false;
  const dx = e.location.x - player.location.x, dz = e.location.z - player.location.z;
  return dx * dx + dz * dz < 16;   // roughly stacked above the shaft
}

// movement mirror: copy the player's delayed horizontal step
function mirrorMove(e, player) {
  const h = pHist.get(player.id);
  if (!h || h.length < 3) { faceTo(e, player.location); return; }
  const a = h[h.length - 2], b = h[h.length - 1];   // ~1 scan (0.2s) behind
  let vx = b.x - a.x, vz = b.z - a.z;
  const sp = Math.hypot(vx, vz);
  if (sp > 1.2) { vx *= 1.2 / sp; vz *= 1.2 / sp; }  // clamp teleport jumps
  const r = rec(e.id);
  try {
    if (player.isSneaking && !r.crouch) { e.triggerEvent("verity:start_crawl"); r.crouch = true; }
    else if (!player.isSneaking && r.crouch) { e.triggerEvent("verity:stop_crawl"); r.crouch = false; }
  } catch (_) {}
  setAnim(e, r.crouch ? A.CRAWL : A.MIRROR);
  try {
    let vy = 0;
    const pv = player.getVelocity();
    if (pv && pv.y > 0.25) vy = 0.55;               // distorted hop mirrors a jump
    e.teleport({ x: e.location.x + vx, y: e.location.y + vy, z: e.location.z + vz }, { dimension: e.dimension, facingLocation: player.location });
  } catch (_) {}
}

// slow creep toward the player (after losing eye contact, and !veritycome)
function approach(e, player) {
  setAnim(e, A.CRAWL);
  const dx = player.location.x - e.location.x, dz = player.location.z - e.location.z;
  const l = Math.hypot(dx, dz) || 1;
  try { e.teleport({ x: e.location.x + (dx / l) * 0.16, y: e.location.y, z: e.location.z + (dz / l) * 0.16 }, { dimension: e.dimension, facingLocation: player.location }); } catch (_) {}
}

// find the ground (top of first solid block) under x,z
function groundY(dim, x, z, yStart) {
  const ix = Math.floor(x), iz = Math.floor(z);
  for (let y = Math.floor(yStart); y > yStart - 18; y--) {
    let b; try { b = dim.getBlock({ x: ix, y, z: iz }); } catch (_) { return yStart; }
    if (isSolid(b)) return y + 1;
  }
  return yStart;
}
// a spot ~dist away from the player, on the far side of Verity, behind cover if possible
function findHidden(e, player) {
  const base = Math.atan2(e.location.z - player.location.z, e.location.x - player.location.x);
  for (const dd of [10, 8, 12, 14]) {
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
      const a = base + off;
      const x = player.location.x + Math.cos(a) * dd, z = player.location.z + Math.sin(a) * dd;
      const spot = { x, y: groundY(e.dimension, x, z, player.location.y + 6), z };
      if (!losClear(e.dimension, spot, player.location)) return spot; // blocked = behind cover
    }
  }
  let dx = e.location.x - player.location.x, dz = e.location.z - player.location.z;
  const l = Math.hypot(dx, dz) || 1;
  const x = e.location.x + (dx / l) * 10, z = e.location.z + (dz / l) * 10;
  return { x, y: groundY(e.dimension, x, z, e.location.y + 4), z };
}
// "tails" — bolt behind cover and vanish for a while
function enterHidden(e, player) {
  const dim = e.dimension, r = rec(e.id);
  try { dim.spawnParticle("minecraft:large_explosion", center(e.location, e.location.y + 1)); dim.playSound("mob.endermen.portal", e.location); } catch (_) {}
  const spot = findHidden(e, player);
  try { e.teleport(spot, { dimension: dim, facingLocation: player.location }); } catch (_) {}
  try { e.addEffect("invisibility", HIDE_TIME + 20, { showParticles: false }); } catch (_) {}
  try { e.triggerEvent("verity:go_dormant"); } catch (_) {}
  setAnim(e, A.IDLE);
  r.mode = "hidden"; r.forced = null; r.t0 = system.currentTick;
}

// ---- commands (shared by /scriptevent and, if available, "!" chat) ----
function spawnAway(player) {
  const ang = Math.random() * Math.PI * 2;
  const loc = { x: player.location.x + Math.cos(ang) * 20, y: player.location.y + 1, z: player.location.z + Math.sin(ang) * 20 };
  try { return player.dimension.spawnEntity(VERITY, loc); } catch (_) { return undefined; }
}
function ensureVerity(player) {
  let best = null, bd = Infinity;
  try {
    for (const e of player.dimension.getEntities({ type: VERITY })) {
      const d = dist2(e.location, player.location);
      if (d < bd) { bd = d; best = e; }
    }
  } catch (_) {}
  return best || spawnAway(player);
}
// action is one of: spawn come chase stop mirror door glass
function handleCommand(action, player) {
  if (!player || !valid(player)) return;
  if (action === "spawn") { spawnAway(player); try { player.sendMessage("§cVerity has spawned…"); } catch (_) {} return; }
  const e = ensureVerity(player);
  if (!e || !valid(e)) return;
  const r = rec(e.id);
  if (busy.has(e.id) && action !== "stop") return;
  switch (action) {
    case "come": r.mode = "approach"; r.forced = "come"; unfreeze(e); try { e.triggerEvent("verity:start_crawl"); } catch (_) {} break;
    case "chase": startChase(e); break;
    case "stop": r.mode = "stop"; r.forced = "stop"; try { e.triggerEvent("verity:go_dormant"); } catch (_) {} setAnim(e, A.IDLE); freeze(e, 200); break;
    case "door": doDoorBreach(e, player); break;
    case "glass": { const w = findWindow(e.dimension, e, player); if (w) startWindowBreach(e, w, player); else { try { player.sendMessage("§7No glass near you."); } catch (_) {} } break; }
  }
}

// ---- main per-tick logic ----
function tickLoop() {
  tk++;
  if (tk % SCAN !== 0) return;
  const now = system.currentTick;

  // track player position history + enclosure
  for (const p of world.getAllPlayers()) {
    try {
      let h = pHist.get(p.id); if (!h) { h = []; pHist.set(p.id, h); }
      h.push({ x: p.location.x, y: p.location.y, z: p.location.z }); if (h.length > 8) h.shift();
      let roof = false; try { roof = isSolid(p.dimension.getBlock({ x: Math.floor(p.location.x), y: Math.floor(p.location.y) + 3, z: Math.floor(p.location.z) })); } catch (_) {}
      enclosed.set(p.id, roof ? (enclosed.get(p.id) ?? 0) + SCAN : 0);
    } catch (_) {}
  }

  let ents = [];
  for (const d of ["overworld", "nether", "the_end"]) { try { ents = ents.concat(world.getDimension(d).getEntities({ type: VERITY })); } catch (_) {} }

  for (const e of ents) {
    try {
      if (!valid(e) || busy.has(e.id)) continue;
      const r = rec(e.id);
      const near = nearestPlayer(e);
      if (!near) { setAnim(e, A.IDLE); continue; }
      const { player, d } = near;
      const los = losClear(e.dimension, e.location, player.location);
      const looking = playerLooking(player, e);

      switch (r.mode) {
        case "stop":
          freeze(e, 12); setAnim(e, A.IDLE);
          if (d <= STALK_NEAR && los) { r.mode = "idle"; r.forced = null; }   // detects player again
          break;

        case "chase": {
          if (tryClimb(e, player)) break;
          setAnim(e, A.CHASE);
          // "can't reach you" detector: if the gap stops closing, you're hiding
          if (r.prevDist === undefined) { r.prevDist = d; r.stuck = 0; }
          if (d < r.prevDist - 0.05) r.stuck = 0; else r.stuck += SCAN;
          r.prevDist = d;
          if (now >= (cooldown.get(e.id) ?? 0) && d > CHASE_NEAR && d <= BREACH_RANGE && r.stuck >= STUCK_LIMIT) {
            r.stuck = 0; r.prevDist = undefined;
            const door = findDoor(e.dimension, player);
            const w = findWindow(e.dimension, e, player);
            // both available -> roll a die (favor the window); else use whichever exists
            if (door && w) {
              if (Math.random() < 0.6) startWindowBreach(e, w, player); else doDoorBreach(e, player);
              break;
            }
            if (w) { startWindowBreach(e, w, player); break; }
            if (door) { doDoorBreach(e, player); break; }
          }
          break;
        }

        case "stare":
          faceTo(e, player.location); setAnim(e, A.STARE); freeze(e, 12);
          if (d <= CHASE_NEAR) { startChase(e); break; }
          if (now - r.t0 >= STARE_TIME) doTransform(e, player);
          break;

        case "approach":
          if (d <= CHASE_NEAR) { startChase(e); break; }
          approach(e, player);
          break;

        default: { // "idle" — decide what to do
          if (mineshaft(e, player)) { faceTo(e, player.location); setAnim(e, A.STARE); freeze(e, 12); if (d <= CHASE_NEAR + 1) doSnap(e); break; }
          if (d <= CHASE_NEAR) { startChase(e); break; }
          if (d <= STALK_NEAR && los) { r.mode = "stare"; r.t0 = now; break; }
          if (d <= 40) { startChase(e); break; }   // baseline: it always knows where you are
          setAnim(e, A.IDLE);
        }
      }
    } catch (_) {}
  }
}

// ---- registrations ----
// The loop is registered FIRST and wrapped, so nothing below can stop it.
let tk = 0;
system.runInterval(() => { try { tickLoop(); } catch (_) {} }, 1);

// player attacks Verity -> instant chase
try {
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (!e || e.typeId !== VERITY) return;
    const src = ev.damageSource && ev.damageSource.damagingEntity;
    if (src && src.typeId === "minecraft:player" && !busy.has(e.id)) startChase(e);
  });
} catch (_) {}

// commands via:  /scriptevent verity:spawn|come|chase|stop|mirror|door|glass
try {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    const id = ev.id || "";
    if (!id.startsWith("verity:")) return;
    const action = id.slice(7);
    let player = ev.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") player = world.getAllPlayers()[0];
    if (player) system.run(() => handleCommand(action, player));
  });
} catch (_) {}

// optional: "!" chat commands (silently skipped if chatSend is unavailable)
try {
  const map = { "!verity": "spawn", "!veritycome": "come", "!veritychase": "chase", "!veritystop": "stop", "!veritydoor": "door", "!verityglass": "glass" };
  world.beforeEvents.chatSend.subscribe((ev) => {
    const action = map[(ev.message || "").trim().toLowerCase().split(/\s+/)[0]];
    if (!action) return;
    ev.cancel = true;
    const player = ev.sender;
    system.run(() => handleCommand(action, player));
  });
} catch (_) {}
