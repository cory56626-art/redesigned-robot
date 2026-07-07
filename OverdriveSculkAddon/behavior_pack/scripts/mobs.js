// =========================================================================
//  Overdrive Sculk — custom mob spawning & JavaScript-driven behaviors.
//
//  Populations are deliberately SMALL and level-scaled (a swarm of weak mobs
//  is annoying, not scary).  Tentacle attacks and the infected mobs' ground
//  seeding are both driven here in script so they can react to the player and
//  to the infection level.
// =========================================================================

import { world, system } from "@minecraft/server";
import {
  MOB_ZOMBIE, MOB_SKELETON, MOB_CREEPER, TENTACLE_ID,
  INFECTED_MOBS, ALL_OVERDRIVE_ENTITIES, hasFlag, isAlive, distSq,
} from "./config.js";

// Hard per-dimension caps. Kept low on purpose; scaled DOWN further at low
// levels by effCap() so early game is sparse and tense rather than swarmed.
const CAPS = {
  [MOB_ZOMBIE]: 6,
  [MOB_SKELETON]: 4,
  [MOB_CREEPER]: 3,
  [TENTACLE_ID]: 6,
  "minecraft:warden": 1,
  "minecraft:wither": 1,
};

// A mob only spawns if a player is within this range of the chosen spot, so
// the corruption's army appears where it matters and never piles up off-screen.
const SPAWN_PLAYER_RANGE = 100;

function effCap(type, level) {
  const base = CAPS[type] ?? 3;
  if (type === "minecraft:warden" || type === "minecraft:wither") return base;
  // Ramp from ~1 at low levels to the full cap by Level 12.
  return Math.max(1, Math.min(base, Math.ceil((base * level) / 12)));
}

function countType(dim, type) {
  try { return dim.getEntities({ type }).length; } catch { return 0; }
}

function playerNear(dim, loc, range) {
  const r2 = range * range;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== dim.id) continue;
    if (distSq(p.location, loc) <= r2) return true;
  }
  return false;
}

// ------------------------------------------------------------------------- //
//  Spawn placement                                                          //
// ------------------------------------------------------------------------- //
function findSpawnSpot(infection) {
  for (let tries = 0; tries < 8; tries++) {
    const f = infection.randomFrontier();
    if (!f) return null;
    let dim;
    try { dim = world.getDimension(f.d); } catch { continue; }
    let b1, b2;
    try {
      b1 = dim.getBlock({ x: f.x, y: f.y + 1, z: f.z });
      b2 = dim.getBlock({ x: f.x, y: f.y + 2, z: f.z });
    } catch { continue; }
    if (b1 && b2 && b1.isAir && b2.isAir) {
      return { dim, loc: { x: f.x + 0.5, y: f.y + 1, z: f.z + 0.5 } };
    }
  }
  return null;
}

function trySpawn(infection, type, probability) {
  if (Math.random() > probability) return;
  const spot = findSpawnSpot(infection);
  if (!spot) return;
  if (!playerNear(spot.dim, spot.loc, SPAWN_PLAYER_RANGE)) return;
  if (countType(spot.dim, type) >= effCap(type, infection.level)) return;
  try {
    const e = spot.dim.spawnEntity(type, spot.loc);
    if (type !== TENTACLE_ID) {
      try { e.addEffect("speed", 1000000, { amplifier: 0, showParticles: false }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------------- //
//  Periodic spawning (called on the slow ~10s cadence)                      //
// ------------------------------------------------------------------------- //
export function spawnTick(infection) {
  if (!infection.active) return;
  const lvl = infection.level;

  if (hasFlag(lvl, "spawnZombie")) trySpawn(infection, MOB_ZOMBIE, 0.5);
  if (hasFlag(lvl, "spawnSkeleton")) trySpawn(infection, MOB_SKELETON, 0.4);
  if (hasFlag(lvl, "spawnCreeper")) trySpawn(infection, MOB_CREEPER, 0.35);

  if (hasFlag(lvl, "tentacles")) {
    trySpawn(infection, TENTACLE_ID, hasFlag(lvl, "tentaclesOften") ? 0.6 : 0.4);
  }

  // Level 11+: 5–10% chance to raise a Warden.
  if (hasFlag(lvl, "wardenChance") && Math.random() < (0.05 + Math.min(0.05, (lvl - 11) * 0.01))) {
    trySpawnWarden(infection);
  }
}

function trySpawnWarden(infection) {
  const spot = findSpawnSpot(infection);
  if (!spot) return;
  if (!playerNear(spot.dim, spot.loc, SPAWN_PLAYER_RANGE)) return;
  if (countType(spot.dim, "minecraft:warden") >= CAPS["minecraft:warden"]) return;
  try {
    spot.dim.spawnEntity("minecraft:warden", spot.loc);
    world.sendMessage("§3A §bWarden §3claws its way out of the Overdrive Sculk...");
    try { spot.dim.playSound("mob.warden.emerge", spot.loc); } catch { /* ignore */ }
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------------- //
//  Infected Wither — the energy payoff boss                                 //
// ------------------------------------------------------------------------- //
export function spawnInfectedWither(infection) {
  if (infection.level < 11) return false;
  const spot = findSpawnSpot(infection);
  if (!spot) return false;
  if (countType(spot.dim, "minecraft:wither") >= CAPS["minecraft:wither"]) return false;
  return buffAsInfectedWither(spot.dim, { x: spot.loc.x, y: spot.loc.y + 1.5, z: spot.loc.z });
}

function buffAsInfectedWither(dim, loc) {
  try {
    const w = dim.spawnEntity("minecraft:wither", loc);
    w.addTag("overdrive_infected");
    try { w.nameTag = "§3§lInfected Wither"; } catch { /* ignore */ }
    try { w.addEffect("strength", 1000000, { amplifier: 1, showParticles: false }); } catch { /* ignore */ }
    try { w.addEffect("resistance", 1000000, { amplifier: 1, showParticles: false }); } catch { /* ignore */ }
    try { w.addEffect("regeneration", 1000000, { amplifier: 0, showParticles: false }); } catch { /* ignore */ }
    world.sendMessage("§3§l» §r§bThe corruption gives birth to an §lInfected Wither§r§b!");
    try { dim.playSound("mob.wither.spawn", loc); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------------- //
//  Tentacle attacks (JavaScript behavior, once per second)                  //
//  Lashes at any nearby mob AND player; reach + damage grow with level.     //
// ------------------------------------------------------------------------- //
export function tentacleAttackTick(infection) {
  if (!infection.active) return;
  const reach = infection.level >= 8 ? 6.0 : infection.level >= 4 ? 4.5 : 3.8;
  const dmg = infection.level >= 15 ? 8 : infection.level >= 8 ? 5 : infection.level >= 4 ? 4 : 3;

  const handled = new Set();
  for (const player of world.getAllPlayers()) {
    let tentacles;
    try {
      tentacles = player.dimension.getEntities({ type: TENTACLE_ID, location: player.location, maxDistance: 80 });
    } catch { continue; }

    for (const t of tentacles) {
      if (!isAlive(t) || handled.has(t.id)) continue;
      handled.add(t.id);

      let victims;
      try {
        victims = t.dimension.getEntities({
          location: t.location, maxDistance: reach,
          excludeFamilies: ["overdrive", "inanimate"],
          excludeTypes: [TENTACLE_ID, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
        });
      } catch { continue; }

      let struck = false;
      for (const v of victims) {
        if (!isAlive(v)) continue;
        try {
          v.applyDamage(dmg, { cause: "entityAttack", damagingEntity: t });
          struck = true;
        } catch {
          try { v.applyDamage(dmg); struck = true; } catch { /* ignore */ }
        }
        // Yank the victim toward the tentacle (best-effort across API versions).
        try {
          const dx = t.location.x - v.location.x;
          const dz = t.location.z - v.location.z;
          v.applyKnockback(dx, dz, 0.5, 0.25);
        } catch { /* ignore */ }
      }

      try { t.setProperty("overdrive:striking", struck); } catch { /* ignore */ }
      if (struck) {
        try { t.dimension.playSound("mob.warden.attack_impact", t.location, { volume: 0.7, pitch: 0.7 }); } catch { /* ignore */ }
        try { t.dimension.spawnParticle("minecraft:sculk_charge_pop_particle", t.location); } catch { /* ignore */ }
        system.runTimeout(() => {
          try { if (isAlive(t)) t.setProperty("overdrive:striking", false); } catch { /* ignore */ }
        }, 8);
      }
    }
  }
}

// ------------------------------------------------------------------------- //
//  Infected mobs seed the ground (once per second)                          //
//  They spread the corruption as they roam — far more likely when no player  //
//  is close, so the infection keeps taking ground even while you're away.    //
// ------------------------------------------------------------------------- //
export function infectedGroundTick(infection) {
  if (!infection.active) return;

  const handled = new Set();
  for (const player of world.getAllPlayers()) {
    let mobs;
    try {
      mobs = player.dimension.getEntities({ families: ["overdrive"], location: player.location, maxDistance: 96 });
    } catch { continue; }

    for (const m of mobs) {
      if (!isAlive(m) || handled.has(m.id)) continue;
      handled.add(m.id);
      if (!INFECTED_MOBS.includes(m.typeId)) continue;

      const near = distSq(m.location, player.location) < 16 * 16;
      const chance = near ? 0.12 : 0.45; // aggressive ground-take when unattended
      if (Math.random() > chance) continue;

      const loc = m.location;
      infection.convertAt(m.dimension, Math.floor(loc.x), Math.floor(loc.y) - 1, Math.floor(loc.z));
    }
  }
}

// ------------------------------------------------------------------------- //
//  Test / admin helpers                                                     //
// ------------------------------------------------------------------------- //
export function spawnAt(dim, loc, type) {
  try { return dim.spawnEntity(type, loc); } catch { return undefined; }
}

export function spawnTestWither(dim, loc) {
  return buffAsInfectedWither(dim, { x: loc.x, y: loc.y + 2, z: loc.z });
}

export function clearOverdriveMobs() {
  let removed = 0;
  const done = new Set();
  for (const p of world.getAllPlayers()) {
    if (done.has(p.dimension.id)) continue;
    done.add(p.dimension.id);
    for (const type of ALL_OVERDRIVE_ENTITIES) {
      let ents;
      try { ents = p.dimension.getEntities({ type }); } catch { continue; }
      for (const e of ents) {
        try { e.remove(); removed++; } catch {
          try { e.kill(); removed++; } catch { /* ignore */ }
        }
      }
    }
  }
  return removed;
}
