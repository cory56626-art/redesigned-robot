/*
 * THE KNOCKER — behavior brain
 * ----------------------------------------------------------------------------
 * A psychological-horror stalker for Minecraft Bedrock.
 *
 * It appears at the edge of your vision and vanishes when you look at it.
 * It grows angrier the longer the night goes on. At higher anger it walks up
 * to your door and KNOCKS — then it either leaves (60%) or breaks in (40%),
 * stalks to within 5 blocks, stares, screams, and hunts you down. It can crawl,
 * set your house on fire when you are not looking, and tear through blocks with
 * an iron axe (wood) or iron pickaxe (stone) on a real per-block break timer.
 *
 * The creature NEVER sends chat messages. The only text this script prints is
 * developer/debug feedback from the /scriptevent test commands (clearly tagged).
 *
 * All special behaviour is driven from script. Visual pose state is encoded in
 * minecraft:mark_variant (read by the client animation controller) and switched
 * through entity events, so no experimental toggles are required.
 */

import { world, system, ItemStack } from "@minecraft/server";

const KNOCKER_ID = "knocker:knocker";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const TAG = "§8[§4Knocker§8]§r ";

// ---------------------------------------------------------------------------
// Tunables (ticks unless noted; 20 ticks = 1 second)
// ---------------------------------------------------------------------------
const CFG = {
  MAIN_INTERVAL: 10,      // main think loop cadence
  AUTO_INTERVAL: 200,     // auto-spawn check cadence
  FOLLOW: 64,             // think range to a player
  DESPAWN_FAR: 112,       // if no player this close...
  DESPAWN_AFTER: 1600,    // ...for this many ticks, despawn
  VANISH_CD: 50,          // min ticks between "looked-at" vanishes
  KNOCK_CD: 900,          // min ticks between unprompted knocks
  FIRE_CD: 220,           // min ticks between arson attempts
  SCREAM_CD: 160,
  AMBIENT_CD: 140,
  // anger -> stage thresholds
  ST_CURIOUS: 25,
  ST_HOSTILE: 50,
  ST_ENRAGED: 80,
  REVEAL_DIST: 5,         // "look at the player 5 blocks away" then scream
  AUTO_SPAWN_CHANCE: 0.18 // per AUTO_INTERVAL per eligible player at night
};

// Per-knocker memory, keyed by entity id. Transient (resets on reload, which
// is fine — the creature simply re-reads the world).
const brains = new Map();

function newBrain() {
  return {
    anger: 8,
    stage: 0,
    mode: "stalk",
    crawling: false,
    seq: null,            // active scripted sequence (knock / reveal)
    targetId: null,
    lastVanish: -99999,
    lastKnock: -99999,
    lastFire: -99999,
    lastScream: -99999,
    lastAmbient: -99999,
    lastSeen: 0,          // tick a player was last close
    breakKey: null,
    breakStart: 0,
    breakTool: "axe"
  };
}

function getBrain(id) {
  let b = brains.get(id);
  if (!b) { b = newBrain(); brains.set(id, b); }
  return b;
}

// ---------------------------------------------------------------------------
// Small math / world helpers
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function dist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
function headLoc(ent) {
  const l = ent.location;
  return { x: l.x, y: l.y + 1.9, z: l.z };
}
function blockCenter(b) {
  const l = b.location;
  return { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 };
}
function isNight() {
  try {
    const t = world.getTimeOfDay();
    return t >= 13000 && t <= 23000;
  } catch (e) { return true; }
}
function particle(dim, id, loc) {
  try { dim.spawnParticle(id, loc); } catch (e) { /* unknown id / unloaded */ }
}
function playAt(dim, loc, sound, opts) {
  try { dim.playSound(sound, loc, opts); } catch (e) {}
}
function playFor(player, sound, opts) {
  try { player.playSound(sound, opts); } catch (e) {}
}
function equip(ent, itemId) {
  try {
    const eq = ent.getComponent("minecraft:equippable");
    if (eq) eq.setEquipment("Mainhand", new ItemStack(itemId, 1));
  } catch (e) {}
}
function faceTo(ent, loc) {
  try { ent.teleport(ent.location, { facingLocation: loc }); } catch (e) {}
}
function triggerSafe(ent, ev) {
  try { ent.triggerEvent(ev); } catch (e) {}
}

function getAllKnockers() {
  const out = [];
  for (const id of DIMENSIONS) {
    let dim;
    try { dim = world.getDimension(id); } catch (e) { continue; }
    try {
      for (const e of dim.getEntities({ type: KNOCKER_ID })) out.push(e);
    } catch (e) {}
  }
  return out;
}

function nearestPlayer(ent, maxDist) {
  let best = null, bd = maxDist ?? Infinity;
  let players = [];
  try { players = world.getAllPlayers(); } catch (e) { return null; }
  for (const p of players) {
    try {
      if (p.dimension.id !== ent.dimension.id) continue;
      const d = dist3(p.location, ent.location);
      if (d < bd) { bd = d; best = p; }
    } catch (e) {}
  }
  return best;
}

function nearestKnocker(player, maxDist = 160) {
  let best = null, bd = maxDist;
  for (const k of getAllKnockers()) {
    try {
      if (k.dimension.id !== player.dimension.id) continue;
      const d = dist3(k.location, player.location);
      if (d < bd) { bd = d; best = k; }
    } catch (e) {}
  }
  return best;
}

// ---------------------------------------------------------------------------
// Line of sight / "are you looking at me"
// ---------------------------------------------------------------------------
function hasLineOfSight(dim, from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.001) return true;
  const dir = { x: dx / d, y: dy / d, z: dz / d };
  try {
    const hit = dim.getBlockFromRay(from, dir, {
      maxDistance: d - 0.6,
      includeLiquidBlocks: false,
      includePassableBlocks: false
    });
    return hit === undefined; // nothing solid in the way
  } catch (e) { return true; }
}

function isLookingAt(player, ent) {
  try {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const tl = ent.location;
    const target = { x: tl.x, y: tl.y + 1.2, z: tl.z }; // aim at the chest
    const dx = target.x - head.x, dy = target.y - head.y, dz = target.z - head.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return true;
    const dot = (dx / d) * view.x + (dy / d) * view.y + (dz / d) * view.z;
    const threshold = d < 6 ? 0.84 : d < 16 ? 0.94 : 0.975; // tighter cone at range
    if (dot < threshold) return false;
    return hasLineOfSight(player.dimension, head, target);
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// Spawn-spot finding
// ---------------------------------------------------------------------------
function solidish(b) {
  return b && !b.isAir && !b.isLiquid;
}
function groundSpot(dim, x, z, yTop) {
  for (let y = yTop; y > yTop - 28; y--) {
    let here, below, above;
    try {
      here = dim.getBlock({ x, y, z });
      below = dim.getBlock({ x, y: y - 1, z });
      above = dim.getBlock({ x, y: y + 1, z });
    } catch (e) { return null; }
    if (here && below && above && here.isAir && above.isAir && solidish(below)) {
      return { x: x + 0.5, y, z: z + 0.5 };
    }
  }
  return null;
}
function findSpawnSpot(player, minR, maxR) {
  const dim = player.dimension, base = player.location;
  for (let i = 0; i < 26; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    const x = Math.floor(base.x + Math.cos(ang) * r);
    const z = Math.floor(base.z + Math.sin(ang) * r);
    const spot = groundSpot(dim, x, z, Math.floor(base.y) + 4);
    if (spot) return spot;
  }
  return null;
}
function findHiddenSpot(player, minR, maxR) {
  const dim = player.dimension, base = player.location;
  let view;
  try { view = player.getViewDirection(); } catch (e) { view = { x: 0, y: 0, z: 1 }; }
  for (let i = 0; i < 30; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    if (dx * view.x + dz * view.z > 0.2) continue; // skip spots in front of the player
    const r = minR + Math.random() * (maxR - minR);
    const x = Math.floor(base.x + dx * r);
    const z = Math.floor(base.z + dz * r);
    const spot = groundSpot(dim, x, z, Math.floor(base.y) + 4);
    if (spot) return spot;
  }
  return findSpawnSpot(player, minR, maxR);
}

function spawnKnocker(player, minR, maxR) {
  const spot = findHiddenSpot(player, minR, maxR) || findSpawnSpot(player, minR, maxR);
  if (!spot) return null;
  let ent;
  try { ent = player.dimension.spawnEntity(KNOCKER_ID, spot); } catch (e) { return null; }
  const b = getBrain(ent.id);
  b.mode = "stalk";
  b.lastSeen = system.currentTick;
  equip(ent, "minecraft:iron_axe");
  faceTo(ent, player.location);
  return ent;
}

// ---------------------------------------------------------------------------
// Stage / anger
// ---------------------------------------------------------------------------
function stageFromAnger(a) {
  if (a >= CFG.ST_ENRAGED) return 3;
  if (a >= CFG.ST_HOSTILE) return 2;
  if (a >= CFG.ST_CURIOUS) return 1;
  return 0;
}
const STAGE_EVENT = ["knocker:set_calm", "knocker:set_curious", "knocker:set_hostile", "knocker:set_enraged"];
const STAGE_NAME = ["CALM", "CURIOUS", "HOSTILE", "ENRAGED"];

function applyStage(ent, brain, force) {
  const s = stageFromAnger(brain.anger);
  if (s !== brain.stage || force) {
    brain.stage = s;
    triggerSafe(ent, STAGE_EVENT[s]);
  }
}
function setStageDirect(ent, brain, s) {
  brain.stage = s;
  brain.anger = clamp(brain.anger, [0, CFG.ST_CURIOUS, CFG.ST_HOSTILE, CFG.ST_ENRAGED][s] + 1, 100);
  triggerSafe(ent, STAGE_EVENT[s]);
}

// ---------------------------------------------------------------------------
// Pose / crawl
// ---------------------------------------------------------------------------
function setPose(ent, ev) { triggerSafe(ent, ev); }
function startCrawl(ent, brain) {
  if (brain.crawling) return;
  brain.crawling = true;
  triggerSafe(ent, "knocker:start_crawl");
  try { ent.addEffect("slowness", 200, { amplifier: 1, showParticles: false }); } catch (e) {}
}
function stopCrawl(ent, brain) {
  if (!brain.crawling) return;
  brain.crawling = false;
  triggerSafe(ent, "knocker:stop_crawl");
  try { ent.removeEffect("slowness"); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Block breaking (iron axe = wood, iron pickaxe = stone), with real timers
// ---------------------------------------------------------------------------
const STONE_HINTS = ["stone", "cobble", "deepslate", "brick", "_ore", "concrete", "terracotta",
  "sandstone", "blackstone", "tuff", "granite", "diorite", "andesite", "prismarine", "basalt",
  "quartz_block", "netherrack", "calcite", "amethyst", "copper_block", "iron_block", "froglight"];
const WOOD_HINTS = ["plank", "log", "_wood", "door", "fence", "wool", "carpet", "leaves",
  "bookshelf", "ladder", "scaffolding", "bamboo", "trapdoor", "stairs", "slab", "sign", "barrel",
  "chest", "crafting", "shelf", "hay"];
const TOO_HARD = ["bedrock", "barrier", "command_block", "structure_block", "jigsaw",
  "obsidian", "reinforced_deepslate", "end_portal", "respawn_anchor"];

function isBreakable(b) {
  if (!solidish(b)) return false;
  const id = b.typeId;
  for (const h of TOO_HARD) if (id.includes(h)) return false;
  return true;
}
function toolFor(b) {
  const id = b.typeId;
  for (const h of WOOD_HINTS) if (id.includes(h)) return "axe";
  for (const h of STONE_HINTS) if (id.includes(h)) return "pickaxe";
  return "axe";
}
function breakTicksFor(b, tool) {
  const id = b.typeId;
  const wood = WOOD_HINTS.some(h => id.includes(h));
  const stone = STONE_HINTS.some(h => id.includes(h));
  if (id.includes("door")) return tool === "axe" ? 12 : 26;          // ~0.6s w/ axe
  if (wood) return tool === "axe" ? 10 : 26;                          // ~0.5s w/ axe
  if (stone) return tool === "pickaxe" ? 22 : 70;                     // ~1.1s w/ pick, slow w/ axe
  return tool === "pickaxe" ? 24 : 24;
}

function tryBreakObstacle(ent, player, brain, now) {
  const dim = ent.dimension;
  const from = ent.location;
  let dx = player.location.x - from.x, dz = player.location.z - from.z;
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  const fx = from.x + dx * 0.85, fz = from.z + dz * 0.85;
  const feetY = Math.floor(from.y + 0.2);
  let target = null;
  for (const yy of [feetY, feetY + 1]) {
    let b;
    try { b = dim.getBlock({ x: Math.floor(fx), y: yy, z: Math.floor(fz) }); } catch (e) { continue; }
    if (isBreakable(b)) { target = b; break; }
  }
  if (!target) { brain.breakKey = null; return false; }

  const key = `${target.x},${target.y},${target.z}`;
  const tool = toolFor(target);
  if (brain.breakKey !== key) {
    brain.breakKey = key;
    brain.breakStart = now;
    brain.breakTool = tool;
    equip(ent, tool === "pickaxe" ? "minecraft:iron_pickaxe" : "minecraft:iron_axe");
    playAt(dim, blockCenter(target), "knocker.break", { volume: 0.6, pitch: tool === "pickaxe" ? 0.8 : 1.0 });
  }
  if (now % 5 === 0) particle(dim, "minecraft:basic_smoke_particle", blockCenter(target));

  if (now - brain.breakStart >= breakTicksFor(target, tool)) {
    try { target.setType("minecraft:air"); } catch (e) {}
    playAt(dim, blockCenter(target), "knocker.break", { volume: 0.9, pitch: tool === "pickaxe" ? 0.7 : 1.15 });
    particle(dim, "minecraft:large_smoke_particle", blockCenter(target));
    brain.breakKey = null;
    brain.anger = clamp(brain.anger + 2, 0, 100); // barricading only makes it worse
    equip(ent, "minecraft:iron_axe");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Doors & arson
// ---------------------------------------------------------------------------
function findDoorNear(ent, radius = 2) {
  const dim = ent.dimension;
  const o = ent.location;
  const bx = Math.floor(o.x), by = Math.floor(o.y), bz = Math.floor(o.z);
  for (let dxi = -radius; dxi <= radius; dxi++)
    for (let dyi = 0; dyi <= 1; dyi++)
      for (let dzi = -radius; dzi <= radius; dzi++) {
        let b;
        try { b = dim.getBlock({ x: bx + dxi, y: by + dyi, z: bz + dzi }); } catch (e) { continue; }
        if (b && b.typeId.includes("_door") && !b.typeId.includes("trap")) return b;
      }
  return null;
}
function nearestDoorToPlayer(player, radius = 6) {
  const dim = player.dimension;
  const o = player.location;
  const bx = Math.floor(o.x), by = Math.floor(o.y), bz = Math.floor(o.z);
  let best = null, bd = Infinity;
  for (let dxi = -radius; dxi <= radius; dxi++)
    for (let dyi = -2; dyi <= 3; dyi++)
      for (let dzi = -radius; dzi <= radius; dzi++) {
        let b;
        try { b = dim.getBlock({ x: bx + dxi, y: by + dyi, z: bz + dzi }); } catch (e) { continue; }
        if (b && b.typeId.includes("_door") && !b.typeId.includes("trap")) {
          const d = dist3(blockCenter(b), o);
          if (d < bd) { bd = d; best = b; }
        }
      }
  return best;
}

const FLAMMABLE_HINTS = ["plank", "log", "_wood", "wool", "carpet", "leaves", "bookshelf",
  "ladder", "scaffolding", "bamboo", "hay", "bed", "banner", "vine", "wood_door", "fence_gate"];
function isFlammable(b) {
  if (!b || b.isAir) return false;
  const id = b.typeId;
  return FLAMMABLE_HINTS.some(h => id.includes(h));
}
function findIgnitableNear(dim, center, radius) {
  const bx = Math.floor(center.x), by = Math.floor(center.y), bz = Math.floor(center.z);
  const offsets = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (let i = 0; i < 60; i++) {
    const x = bx + (Math.floor(Math.random() * (radius * 2 + 1)) - radius);
    const y = by + (Math.floor(Math.random() * (radius + 2)) - 1);
    const z = bz + (Math.floor(Math.random() * (radius * 2 + 1)) - radius);
    let b;
    try { b = dim.getBlock({ x, y, z }); } catch (e) { continue; }
    if (!isFlammable(b)) continue;
    for (const [ox, oy, oz] of offsets) {
      let air;
      try { air = dim.getBlock({ x: x + ox, y: y + oy, z: z + oz }); } catch (e) { continue; }
      if (air && air.isAir) return air;
    }
  }
  return null;
}
function tryBurn(ent, player, brain, now) {
  if (now - brain.lastFire < CFG.FIRE_CD) return false;
  const air = findIgnitableNear(ent.dimension, player.location, 6);
  if (!air) return false;
  try { air.setType("minecraft:fire"); } catch (e) { return false; }
  brain.lastFire = now;
  brain.anger = clamp(brain.anger + 3, 0, 100);
  particle(ent.dimension, "minecraft:large_smoke_particle", blockCenter(air));
  playAt(ent.dimension, blockCenter(air), "knocker.break", { volume: 0.4, pitch: 0.6 });
  return true;
}

// ---------------------------------------------------------------------------
// The scream
// ---------------------------------------------------------------------------
function doScream(ent, player, brain, now) {
  brain.lastScream = now;
  setPose(ent, "knocker:pose_scream_on");
  faceTo(ent, player.getHeadLocation());
  playFor(player, "knocker.scream", { volume: 1.0, pitch: 1.0 });       // very loud, to the victim
  playAt(ent.dimension, headLoc(ent), "knocker.scream", { volume: 1.0, pitch: 1.0 });
  try { player.addEffect("darkness", 90, { amplifier: 0, showParticles: false }); } catch (e) {}
  try { player.addEffect("nausea", 140, { amplifier: 1, showParticles: true }); } catch (e) {}
  try { player.addEffect("weakness", 110, { amplifier: 0, showParticles: false }); } catch (e) {}
  particle(ent.dimension, "minecraft:large_smoke_particle", headLoc(ent));
  const id = ent.id;
  system.runTimeout(() => {
    for (const k of getAllKnockers()) if (k.id === id) setPose(k, "knocker:pose_reset");
  }, 34);
}

// ---------------------------------------------------------------------------
// Scripted sequences: KNOCK and REVEAL
// ---------------------------------------------------------------------------
function beginKnock(ent, player, door) {
  const brain = getBrain(ent.id);
  if (door) {
    // stand just outside the door, on the far side from the player
    const c = blockCenter(door);
    let dx = c.x - player.location.x, dz = c.z - player.location.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const spot = groundSpot(ent.dimension, Math.floor(c.x + dx * 1), Math.floor(c.z + dz * 1), Math.floor(c.y) + 2)
      || { x: c.x + dx, y: door.location.y, z: c.z + dz };
    try { ent.teleport(spot, { facingLocation: c }); } catch (e) {}
  }
  setStageDirect(ent, brain, 0);          // freeze: calm has no targeting
  setPose(ent, "knocker:pose_knock_on");
  const door2 = door || findDoorNear(ent, 3);
  brain.seq = {
    kind: "knock",
    phase: 0,
    until: system.currentTick + 16,
    knocks: 0,
    door: door2 ? { x: door2.location.x, y: door2.location.y, z: door2.location.z, id: door2.typeId } : null,
    playerId: player.id,
    started: system.currentTick
  };
  brain.lastKnock = system.currentTick;
}

function beginReveal(ent, player) {
  const brain = getBrain(ent.id);
  setStageDirect(ent, brain, 0);
  setPose(ent, "knocker:pose_reset");
  faceTo(ent, player.getHeadLocation());
  brain.seq = { kind: "reveal", phase: 0, until: system.currentTick + 30, playerId: player.id, started: system.currentTick };
}

function runSequence(ent, brain, now) {
  const seq = brain.seq;
  if (!seq) return false;
  let player = null;
  try { player = world.getEntity ? world.getEntity(seq.playerId) : null; } catch (e) {}
  if (!player) player = nearestPlayer(ent, 96);
  if (!player) { brain.seq = null; return false; }

  // hard timeout so a sequence can never wedge the creature
  if (now - seq.started > 1200) { brain.seq = null; setPose(ent, "knocker:pose_reset"); return false; }

  if (seq.kind === "knock") {
    if (seq.phase === 0) {                       // knocking
      faceTo(ent, player.getHeadLocation());
      if (now >= seq.until && seq.knocks < 3) {
        playAt(ent.dimension, headLoc(ent), "knocker.knock", { volume: 1.0, pitch: 0.95 + Math.random() * 0.1 });
        seq.knocks++;
        seq.until = now + 11;
        if (seq.knocks >= 3) { seq.phase = 1; seq.until = now + 26; } // dread pause
      }
      return true;
    }
    if (seq.phase === 1) {                        // the choice: 60% leave / 40% break in
      if (now < seq.until) return true;
      setPose(ent, "knocker:pose_reset");
      if (Math.random() < 0.60) {                 // 60% — it leaves
        brain.anger = clamp(brain.anger - 6, 0, 100);
        brain.seq = null;
        vanish(ent, player, brain, now);
        return true;
      }
      // 40% — break in
      const d = seq.door;
      if (d) {
        try {
          const blk = ent.dimension.getBlock({ x: d.x, y: d.y, z: d.z });
          if (blk) blk.setType("minecraft:air");
          const up = ent.dimension.getBlock({ x: d.x, y: d.y + 1, z: d.z });
          if (up && up.typeId.includes("_door")) up.setType("minecraft:air");
        } catch (e) {}
        playAt(ent.dimension, { x: d.x + 0.5, y: d.y + 0.5, z: d.z + 0.5 }, "knocker.break", { volume: 1.0, pitch: 0.9 });
        particle(ent.dimension, "minecraft:large_smoke_particle", { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 });
      }
      brain.anger = clamp(brain.anger + 18, 0, 100);
      setStageDirect(ent, brain, 2);              // hostile: it now hunts inside
      seq.phase = 2;
      return true;
    }
    if (seq.phase === 2) {                        // entering — close to 5 blocks w/ line of sight
      const dd = dist3(ent.location, player.location);
      if (!tryBreakObstacle(ent, player, brain, now)) {
        // path clear; vanilla AI walks it toward the target
      }
      const see = hasLineOfSight(ent.dimension, headLoc(ent), player.getHeadLocation());
      if (dd <= CFG.REVEAL_DIST + 0.5 && see) {
        setStageDirect(ent, brain, 0);            // freeze and stare
        faceTo(ent, player.getHeadLocation());
        playFor(player, "knocker.heartbeat", { volume: 1.0 });
        seq.phase = 3;
        seq.until = now + 30;                      // ~1.5s of dread
      }
      return true;
    }
    if (seq.phase === 3) {                        // stare -> SCREAM -> chase
      faceTo(ent, player.getHeadLocation());
      if (now >= seq.until) {
        doScream(ent, player, brain, now);
        setStageDirect(ent, brain, 3);            // enraged hunt
        brain.mode = "chase";
        brain.seq = null;
      }
      return true;
    }
  }

  if (seq.kind === "reveal") {
    if (seq.phase === 0) {
      faceTo(ent, player.getHeadLocation());
      if (now - seq.started === 0 || now % 10 === 0) playFor(player, "knocker.heartbeat", { volume: 1.0 });
      if (now >= seq.until) {
        doScream(ent, player, brain, now);
        setStageDirect(ent, brain, 3);
        brain.mode = "chase";
        brain.seq = null;
      }
      return true;
    }
  }

  brain.seq = null;
  return false;
}

// ---------------------------------------------------------------------------
// Vanish ("disappears when you look")
// ---------------------------------------------------------------------------
function vanish(ent, player, brain, now) {
  brain.lastVanish = now;
  stopCrawl(ent, brain);
  particle(ent.dimension, "minecraft:large_smoke_particle", headLoc(ent));
  playAt(ent.dimension, ent.location, "knocker.whisper", { volume: 0.5, pitch: 0.7 });
  const spot = findHiddenSpot(player, 14, 26);
  if (spot) {
    try { ent.teleport(spot, { facingLocation: player.location }); } catch (e) {}
    brain.mode = "stalk";
  } else {
    try { ent.remove(); } catch (e) {}
    brains.delete(ent.id);
  }
}

// ---------------------------------------------------------------------------
// Per-knocker think
// ---------------------------------------------------------------------------
function tickKnocker(ent, now) {
  const brain = getBrain(ent.id);
  const player = nearestPlayer(ent, CFG.FOLLOW);

  if (!player) {
    // nobody near; consider despawn after a while
    if (now - brain.lastSeen > CFG.DESPAWN_AFTER) {
      try { ent.remove(); } catch (e) {}
      brains.delete(ent.id);
    }
    return;
  }

  const d = dist3(ent.location, player.location);
  if (d < CFG.DESPAWN_FAR) brain.lastSeen = now;
  const looked = isLookingAt(player, ent);

  // ---- anger drift (per main interval) ----
  const night = isNight();
  let da = 0;
  if (!night && d > 16) da -= 0.5;
  if (d < 28) da += night ? 0.5 : 0.18;
  if (d < 8) da += 0.5;
  if (looked && brain.stage <= 1) da += 0.35;     // being watched unsettles it
  if (night) da += 0.22;
  brain.anger = clamp(brain.anger + da, 0, 100);
  if (!brain.seq) applyStage(ent, brain);

  // ---- active scripted sequence takes priority ----
  if (runSequence(ent, brain, now)) return;

  // ---- ambient dread sounds ----
  if (now - brain.lastAmbient > CFG.AMBIENT_CD && d < 30 && Math.random() < 0.5) {
    brain.lastAmbient = now;
    if (brain.stage >= 2 && d < 16) playFor(player, "knocker.heartbeat", { volume: 0.7 });
    else if (d < 18 && !looked) playFor(player, "knocker.whisper", { volume: 0.6 });
    else playAt(ent.dimension, ent.location, "knocker.ambient", { volume: 0.8 });
  }

  // ---- CALM / CURIOUS: stalk & vanish-when-looked-at ----
  if (brain.stage <= 1) {
    if (looked && d > CFG.REVEAL_DIST && now - brain.lastVanish > CFG.VANISH_CD) {
      vanish(ent, player, brain, now);
      return;
    }
    if (looked && d <= CFG.REVEAL_DIST) {
      // caught it up close — it lurches into hostility
      brain.anger = clamp(brain.anger + 9, 0, 100);
    }
    // curious creature drifts toward your door and may knock
    if (brain.stage === 1 && d < 26 && now - brain.lastKnock > CFG.KNOCK_CD) {
      const door = findDoorNear(ent, 2) || nearestDoorToPlayer(player, 4);
      if (door) { beginKnock(ent, player, door); return; }
    }
    // occasional creepy crawl while stalking close
    if (d < 11 && !brain.crawling && Math.random() < 0.05) startCrawl(ent, brain);
    else if (brain.crawling && (d > 14 || Math.random() < 0.04)) stopCrawl(ent, brain);
  }

  // ---- HOSTILE / ENRAGED: hunt ----
  if (brain.stage >= 2) {
    // it no longer hides; vanilla targeting/melee drives the chase
    brain.mode = "chase";
    tryBreakObstacle(ent, player, brain, now);
    // crawl when right on top of you for the under-the-bed horror
    if (d < 5 && !brain.crawling && Math.random() < 0.06) startCrawl(ent, brain);
    else if (brain.crawling && d > 7) stopCrawl(ent, brain);
    // a fresh chase gets one opening scream
    if (now - brain.lastScream > CFG.SCREAM_CD && d < 6 &&
        hasLineOfSight(ent.dimension, headLoc(ent), player.getHeadLocation()) && Math.random() < 0.10) {
      doScream(ent, player, brain, now);
    }
  }

  // ---- arson: burn the house when nearby and NOT being looked at ----
  if (brain.stage >= 1 && d < 14 && !looked) {
    tryBurn(ent, player, brain, now);
  }
}

// ---------------------------------------------------------------------------
// Main loops
// ---------------------------------------------------------------------------
system.runInterval(() => {
  const now = system.currentTick;
  for (const ent of getAllKnockers()) {
    try { tickKnocker(ent, now); } catch (e) { /* entity may have unloaded mid-loop */ }
  }
}, CFG.MAIN_INTERVAL);

function autoSpawnEnabled() {
  try {
    const v = world.getDynamicProperty("knocker:autospawn");
    return v === undefined ? true : !!v;
  } catch (e) { return true; }
}
system.runInterval(() => {
  if (!autoSpawnEnabled()) return;
  if (!isNight()) return;
  let players = [];
  try { players = world.getAllPlayers(); } catch (e) { return; }
  const knockers = getAllKnockers();
  if (knockers.length >= Math.max(1, players.length)) return;
  for (const p of players) {
    try {
      if (p.dimension.id !== "minecraft:overworld") continue;
      const near = knockers.some(k => k.dimension.id === p.dimension.id && dist3(k.location, p.location) < 90);
      if (near) continue;
      if (Math.random() < CFG.AUTO_SPAWN_CHANCE) spawnKnocker(p, 18, 30);
    } catch (e) {}
  }
}, CFG.AUTO_INTERVAL);

// react to being attacked — it remembers, and it gets angry fast
try {
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (!e || e.typeId !== KNOCKER_ID) return;
    const brain = getBrain(e.id);
    brain.anger = clamp(brain.anger + 24, 0, 100);
    applyStage(e, brain, true);
    const src = ev.damageSource && ev.damageSource.damagingEntity;
    if (src && src.typeId === "minecraft:player" && Math.random() < 0.5) {
      // blink behind the attacker
      const spot = findHiddenSpot(src, 4, 8);
      if (spot) { try { e.teleport(spot, { facingLocation: src.location }); } catch (er) {} }
      particle(e.dimension, "minecraft:large_smoke_particle", headLoc(e));
    }
  });
} catch (e) {}

// ===========================================================================
// /scriptevent test + control commands
// ===========================================================================
function dbg(msg) { try { world.sendMessage(TAG + msg); } catch (e) {} }

function getCtxPlayer(ev) {
  const e = ev.sourceEntity;
  if (e && e.typeId === "minecraft:player") return e;
  let loc = null, dimId = null;
  if (e) { loc = e.location; dimId = e.dimension.id; }
  else if (ev.sourceBlock) { loc = ev.sourceBlock.location; dimId = ev.sourceBlock.dimension.id; }
  let players = [];
  try { players = world.getAllPlayers(); } catch (er) {}
  if (!players.length) return undefined;
  if (!loc) return players[0];
  let best = players[0], bd = Infinity;
  for (const p of players) {
    if (dimId && p.dimension.id !== dimId) continue;
    const dd = dist3(p.location, loc);
    if (dd < bd) { bd = dd; best = p; }
  }
  return best;
}
function ensureKnocker(player, minR = 8, maxR = 14) {
  return nearestKnocker(player, 160) || spawnKnocker(player, minR, maxR);
}

const HELP = [
  "§4=== The Knocker — test commands ===§r  (run with §e/scriptevent§r)",
  "§eknocker:help§7 — this list",
  "§eknocker:spawn [dist]§7 — spawn one, stalking, near you",
  "§eknocker:despawn§7 — remove all knockers",
  "§eknocker:status§7 — report anger/stage/mode/distance",
  "§eknocker:stage <0-3|calm|curious|hostile|enraged>§7 — force anger stage",
  "§eknocker:anger <0-100|+n|-n>§7 — set/adjust anger",
  "§eknocker:knock§7 — walk to your nearest door and knock (60% leave / 40% break in)",
  "§eknocker:peek§7 — appear 5 blocks away, stare, then scream + chase",
  "§eknocker:scream§7 — scream at you now",
  "§eknocker:chase§7 / §erage§7 — go enraged and hunt you",
  "§ecrawl <on|off>§7 — toggle crawling  →  §eknocker:crawl on",
  "§eknocker:burn§7 — try to set nearby flammable blocks alight",
  "§eknocker:break§7 — break the block you are looking at (axe/pick by material)",
  "§eknocker:vanish§7 — disappear and reposition out of sight",
  "§eknocker:come§7 — teleport the nearest knocker to you",
  "§eknocker:stalk§7 — reset it to passive stalking mode",
  "§eknocker:ambient §7/ §ewhisper §7/ §eheartbeat§7 — play a sound",
  "§eknocker:autospawn <on|off>§7 — toggle nightly auto-spawn (default on)",
  "§eknocker:night§7 — set time to night (testing helper)",
  "§eknocker:demo§7 — run a guided showcase of every feature"
];

function handleCommand(ev) {
  const id = ev.id;                    // e.g. "knocker:spawn"
  const arg = (ev.message || "").trim();
  const player = getCtxPlayer(ev);
  const cmd = id.split(":")[1];

  if (cmd === "help") { for (const l of HELP) dbg(l); return; }
  if (!player) { dbg("§cNo player found to act on."); return; }

  switch (cmd) {
    case "spawn": {
      const dd = Math.max(4, parseFloat(arg) || 12);
      const e = spawnKnocker(player, dd, dd + 4);
      dbg(e ? `Spawned a Knocker ~${dd} blocks away. It is watching.` : "§cCould not find a spot to spawn.");
      break;
    }
    case "despawn": case "remove": case "clear": {
      let n = 0;
      for (const k of getAllKnockers()) { try { k.remove(); n++; } catch (e) {} }
      brains.clear();
      dbg(`Removed ${n} knocker(s).`);
      break;
    }
    case "status": {
      const ks = getAllKnockers();
      if (!ks.length) { dbg("No knockers exist."); break; }
      dbg(`§7${ks.length} knocker(s):`);
      for (const k of ks) {
        const b = getBrain(k.id);
        const p = nearestPlayer(k, 256);
        const dd = p ? dist3(k.location, p.location).toFixed(1) : "∞";
        dbg(`§7• ${STAGE_NAME[b.stage]} anger=${b.anger.toFixed(0)} mode=${b.mode}${b.crawling ? " crawling" : ""} dist=${dd}`);
      }
      break;
    }
    case "stage": {
      const k = ensureKnocker(player);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id);
      const map = { calm: 0, curious: 1, hostile: 2, enraged: 3 };
      let s = map[arg.toLowerCase()];
      if (s === undefined) s = clamp(parseInt(arg, 10) || 0, 0, 3);
      setStageDirect(k, b, s);
      if (s >= 2) b.mode = "chase";
      dbg(`Stage set to ${STAGE_NAME[s]} (anger=${b.anger.toFixed(0)}).`);
      break;
    }
    case "anger": {
      const k = ensureKnocker(player);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id);
      if (arg.startsWith("+") || arg.startsWith("-")) b.anger = clamp(b.anger + parseFloat(arg), 0, 100);
      else b.anger = clamp(parseFloat(arg) || 0, 0, 100);
      applyStage(k, b, true);
      dbg(`Anger = ${b.anger.toFixed(0)} (${STAGE_NAME[b.stage]}).`);
      break;
    }
    case "knock": case "door": {
      const k = ensureKnocker(player, 10, 16);
      if (!k) { dbg("§cNo knocker."); break; }
      const door = nearestDoorToPlayer(player, 8);
      if (!door) { dbg("§cNo door found near you. Place a door and try again."); break; }
      const b = getBrain(k.id); b.anger = Math.max(b.anger, CFG.ST_CURIOUS + 2); applyStage(k, b, true);
      beginKnock(k, player, door);
      dbg("It approaches your door...");
      break;
    }
    case "peek": {
      let k = nearestKnocker(player, 160);
      const view = (() => { try { return player.getViewDirection(); } catch (e) { return { x: 0, y: 0, z: 1 }; } })();
      const base = player.location;
      const fx = Math.floor(base.x + view.x * CFG.REVEAL_DIST);
      const fz = Math.floor(base.z + view.z * CFG.REVEAL_DIST);
      const spot = groundSpot(player.dimension, fx, fz, Math.floor(base.y) + 3) ||
        { x: base.x + view.x * CFG.REVEAL_DIST, y: base.y, z: base.z + view.z * CFG.REVEAL_DIST };
      if (!k) { try { k = player.dimension.spawnEntity(KNOCKER_ID, spot); } catch (e) {} }
      else { try { k.teleport(spot, { facingLocation: player.getHeadLocation() }); } catch (e) {} }
      if (!k) { dbg("§cCould not place the knocker."); break; }
      equip(k, "minecraft:iron_axe");
      beginReveal(k, player);
      dbg("It is standing 5 blocks away, watching you...");
      break;
    }
    case "scream": {
      const k = ensureKnocker(player, 5, 7);
      if (!k) { dbg("§cNo knocker."); break; }
      doScream(k, player, getBrain(k.id), system.currentTick);
      dbg("§4AAAAAH!");
      break;
    }
    case "chase": case "rage": {
      const k = ensureKnocker(player, 8, 12);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id);
      setStageDirect(k, b, 3); b.mode = "chase";
      dbg("It is enraged and hunting you.");
      break;
    }
    case "crawl": {
      const k = ensureKnocker(player);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id);
      if (arg.toLowerCase() === "off") { stopCrawl(k, b); dbg("Crawl off."); }
      else { startCrawl(k, b); dbg("Crawl on."); }
      break;
    }
    case "burn": {
      const k = ensureKnocker(player, 6, 10);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id); b.lastFire = -99999;
      const ok = tryBurn(k, player, b, system.currentTick);
      dbg(ok ? "It set something near you alight." : "§cNo flammable blocks found nearby.");
      break;
    }
    case "break": {
      const k = ensureKnocker(player, 4, 7);
      if (!k) { dbg("§cNo knocker."); break; }
      let hit;
      try {
        hit = player.getBlockFromViewDirection({ maxDistance: 7, includeLiquidBlocks: false, includePassableBlocks: false });
      } catch (e) {}
      const blk = hit && hit.block;
      if (!blk || !isBreakable(blk)) { dbg("§cLook at a breakable block within 7 blocks and retry."); break; }
      const tool = toolFor(blk);
      const c = blockCenter(blk);
      const spot = groundSpot(k.dimension, Math.floor(c.x), Math.floor(c.z), Math.floor(c.y) + 2) || c;
      try { k.teleport(spot, { facingLocation: c }); } catch (e) {}
      equip(k, tool === "pickaxe" ? "minecraft:iron_pickaxe" : "minecraft:iron_axe");
      playAt(k.dimension, c, "knocker.break", { volume: 0.7, pitch: tool === "pickaxe" ? 0.8 : 1.0 });
      const ticks = breakTicksFor(blk, tool);
      dbg(`Breaking ${blk.typeId.replace("minecraft:", "")} with iron ${tool} (~${(ticks / 20).toFixed(1)}s)...`);
      const pos = { x: blk.location.x, y: blk.location.y, z: blk.location.z };
      const dimId = k.dimension.id;
      system.runTimeout(() => {
        try {
          const b2 = world.getDimension(dimId).getBlock(pos);
          if (b2) b2.setType("minecraft:air");
          particle(world.getDimension(dimId), "minecraft:large_smoke_particle", c);
          playAt(world.getDimension(dimId), c, "knocker.break", { volume: 0.9, pitch: tool === "pickaxe" ? 0.7 : 1.15 });
        } catch (e) {}
        try { equip(k, "minecraft:iron_axe"); } catch (e) {}
      }, ticks);
      break;
    }
    case "vanish": {
      const k = nearestKnocker(player, 160);
      if (!k) { dbg("§cNo knocker to vanish."); break; }
      const b = getBrain(k.id); b.lastVanish = -99999;
      vanish(k, player, b, system.currentTick);
      dbg("Gone.");
      break;
    }
    case "come": case "here": {
      const k = ensureKnocker(player, 6, 10);
      if (!k) { dbg("§cNo knocker."); break; }
      const view = (() => { try { return player.getViewDirection(); } catch (e) { return { x: 0, y: 0, z: 1 }; } })();
      const base = player.location;
      const spot = groundSpot(player.dimension, Math.floor(base.x + view.x * 3), Math.floor(base.z + view.z * 3), Math.floor(base.y) + 3) || base;
      try { k.teleport(spot, { facingLocation: base }); } catch (e) {}
      dbg("It is right next to you.");
      break;
    }
    case "stalk": {
      const k = ensureKnocker(player, 12, 18);
      if (!k) { dbg("§cNo knocker."); break; }
      const b = getBrain(k.id);
      b.anger = 10; b.mode = "stalk"; b.seq = null; applyStage(k, b, true);
      dbg("Back to stalking. Try looking at it.");
      break;
    }
    case "ambient": { playFor(player, "knocker.ambient", { volume: 1.0 }); dbg("(ambient)"); break; }
    case "whisper": { playFor(player, "knocker.whisper", { volume: 1.0 }); dbg("(whisper)"); break; }
    case "heartbeat": { playFor(player, "knocker.heartbeat", { volume: 1.0 }); dbg("(heartbeat)"); break; }
    case "autospawn": {
      const on = !(arg.toLowerCase() === "off" || arg === "0" || arg.toLowerCase() === "false");
      try { world.setDynamicProperty("knocker:autospawn", on); } catch (e) {}
      dbg(`Nightly auto-spawn ${on ? "§aON" : "§cOFF"}§r.`);
      break;
    }
    case "night": {
      try { player.runCommand("time set night"); } catch (e) {}
      dbg("Time set to night. It grows bolder in the dark.");
      break;
    }
    case "demo": { runDemo(player); break; }
    default: dbg(`§cUnknown command '${cmd}'. Try §eknocker:help§c.`);
  }
}

// A guided showcase. Uses timeouts so each beat is readable. The text here is
// developer narration for the tester — the creature itself stays silent.
function runDemo(player) {
  dbg("§4Demo starting.§r Stand still and watch. ~45s.");
  const steps = [
    [10, () => { dbg("§71/8 — It spawns and stalks. Turn to look at it; it vanishes."); spawnKnocker(player, 9, 12); }],
    [120, () => {
      dbg("§72/8 — Crawling toward you.");
      const k = nearestKnocker(player, 64) || spawnKnocker(player, 7, 9);
      if (k) startCrawl(k, getBrain(k.id));
    }],
    [200, () => {
      dbg("§73/8 — It knocks on your nearest door (60% leave / 40% break in).");
      const k = nearestKnocker(player, 64) || spawnKnocker(player, 8, 12);
      const door = nearestDoorToPlayer(player, 8);
      if (k && door) beginKnock(k, player, door);
      else dbg("§8(no door nearby — skipping knock; place a door to see it)");
    }],
    [320, () => {
      dbg("§74/8 — Tool-based breaking: it tears through a block with axe/pickaxe.");
      const k = nearestKnocker(player, 64) || spawnKnocker(player, 6, 8);
      if (k) { const b = getBrain(k.id); b.anger = 60; applyStage(k, b, true); b.mode = "chase"; }
    }],
    [400, () => {
      dbg("§75/8 — Arson: it lights nearby flammable blocks while you look away.");
      const k = nearestKnocker(player, 64) || spawnKnocker(player, 6, 8);
      if (k) { const b = getBrain(k.id); b.lastFire = -99999; tryBurn(k, player, b, system.currentTick); }
    }],
    [470, () => {
      dbg("§76/8 — The reveal: it appears 5 blocks away and stares.");
      const view = (() => { try { return player.getViewDirection(); } catch (e) { return { x: 0, y: 0, z: 1 }; } })();
      const base = player.location;
      const spot = groundSpot(player.dimension, Math.floor(base.x + view.x * 5), Math.floor(base.z + view.z * 5), Math.floor(base.y) + 3) || base;
      let k = nearestKnocker(player, 64);
      if (!k) { try { k = player.dimension.spawnEntity(KNOCKER_ID, spot); } catch (e) {} }
      else { try { k.teleport(spot, { facingLocation: player.getHeadLocation() }); } catch (e) {} }
      if (k) beginReveal(k, player);
    }],
    [560, () => { dbg("§77/8 — ...and it SCREAMS and chases. (happens automatically)"); }],
    [760, () => {
      dbg("§78/8 — Demo over. Use §eknocker:despawn§7 to clear it, or run.");
    }]
  ];
  for (const [delay, fn] of steps) system.runTimeout(() => { try { fn(); } catch (e) {} }, delay);
}

try {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    try { handleCommand(ev); } catch (e) { dbg("§cError: " + e); }
  }, { namespaces: ["knocker"] });
} catch (e) {
  // older API fallback: no namespace filter
  try {
    system.afterEvents.scriptEventReceive.subscribe((ev) => {
      if (ev.id && ev.id.startsWith("knocker:")) { try { handleCommand(ev); } catch (er) {} }
    });
  } catch (er) {}
}

// announce readiness once a player joins (debug only; not the creature talking)
try {
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn) dbg("§7The Knocker is loaded. Type §e/scriptevent knocker:help§7 for tests.");
  });
} catch (e) {}
