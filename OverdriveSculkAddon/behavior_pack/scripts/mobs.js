// =========================================================================
//  Overdrive Sculk — custom mob spawning & JavaScript-driven behaviors.
//
//  Infected mobs, tentacles, the Warden and the Infected Wither are all
//  seeded from the growing frontier.  Tentacle attacking is handled here in
//  script (not entity AI) so its reach can scale with the infection level.
// =========================================================================

import { world, system } from "@minecraft/server";
import {
  MOB_ZOMBIE, MOB_SKELETON, MOB_CREEPER, TENTACLE_ID, hasFlag,
} from "./config.js";

// Soft population caps (per dimension) so the corruption's army never lags.
const CAPS = {
  [MOB_ZOMBIE]: 14,
  [MOB_SKELETON]: 9,
  [MOB_CREEPER]: 7,
  [TENTACLE_ID]: 24,
  "minecraft:warden": 2,
  "minecraft:wither": 1,
};

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

function countType(dim, type) {
  try { return dim.getEntities({ type }).length; } catch { return 0; }
}

function trySpawn(infection, type, probability) {
  if (Math.random() > probability) return;
  const spot = findSpawnSpot(infection);
  if (!spot) return;
  if (countType(spot.dim, type) >= (CAPS[type] ?? 8)) return;
  try {
    const e = spot.dim.spawnEntity(type, spot.loc);
    if (type !== TENTACLE_ID) {
      try { e.addEffect("speed", 1000000, { amplifier: 0, showParticles: false }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ------------------------------------------------------------------------- //
//  Periodic spawning (called on the slow ~5s cadence)                       //
// ------------------------------------------------------------------------- //
export function spawnTick(infection) {
  if (!infection.active) return;
  const lvl = infection.level;

  if (hasFlag(lvl, "spawnZombie")) trySpawn(infection, MOB_ZOMBIE, 0.9);
  if (hasFlag(lvl, "spawnSkeleton")) trySpawn(infection, MOB_SKELETON, 0.7);
  if (hasFlag(lvl, "spawnCreeper")) trySpawn(infection, MOB_CREEPER, 0.6);

  if (hasFlag(lvl, "tentacles")) {
    const often = hasFlag(lvl, "tentaclesOften");
    trySpawn(infection, TENTACLE_ID, often ? 0.9 : 0.5);
    if (often && lvl >= 8) trySpawn(infection, TENTACLE_ID, 0.5); // a second, longer-reach one
  }

  // Level 11+: 5–10% chance to raise a Warden.
  if (hasFlag(lvl, "wardenChance") && Math.random() < (0.05 + Math.min(0.05, (lvl - 11) * 0.01))) {
    trySpawnWarden(infection);
  }
}

function trySpawnWarden(infection) {
  const spot = findSpawnSpot(infection);
  if (!spot) return;
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
  if (infection.level < 11) return false; // only once the corruption is potent
  const spot = findSpawnSpot(infection);
  if (!spot) return false;
  if (countType(spot.dim, "minecraft:wither") >= CAPS["minecraft:wither"]) return false;
  try {
    const w = spot.dim.spawnEntity("minecraft:wither", { x: spot.loc.x, y: spot.loc.y + 1.5, z: spot.loc.z });
    w.addTag("overdrive_infected");
    try { w.nameTag = "§3§lInfected Wither"; } catch { /* ignore */ }
    try { w.addEffect("strength", 1000000, { amplifier: 1, showParticles: false }); } catch { /* ignore */ }
    try { w.addEffect("resistance", 1000000, { amplifier: 1, showParticles: false }); } catch { /* ignore */ }
    try { w.addEffect("regeneration", 1000000, { amplifier: 0, showParticles: false }); } catch { /* ignore */ }
    world.sendMessage("§3§l» §r§bThe corruption gives birth to an §lInfected Wither§r§b!");
    try { spot.dim.playSound("mob.wither.spawn", spot.loc); } catch { /* ignore */ }
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------------- //
//  Tentacle attacks (JavaScript behavior, once per second)                  //
//  Reach grows at Level 8+; targets mobs, and players too at Level 15.      //
// ------------------------------------------------------------------------- //
export function tentacleAttackTick(infection) {
  if (!infection.active) return;
  const reach = infection.level >= 8 ? 5.0 : infection.level >= 4 ? 3.8 : 3.0;
  const dmg = infection.level >= 15 ? 7 : infection.level >= 8 ? 5 : 4;

  const excludeFamilies = ["overdrive", "inanimate"];
  if (infection.level < 15) excludeFamilies.push("player"); // players only at max aggression

  const handled = new Set();
  for (const player of world.getAllPlayers()) {
    let tentacles;
    try {
      tentacles = player.dimension.getEntities({
        type: TENTACLE_ID, location: player.location, maxDistance: 72,
      });
    } catch { continue; }

    for (const t of tentacles) {
      if (!t.isValid || handled.has(t.id)) continue;
      handled.add(t.id);

      let victims;
      try {
        victims = t.dimension.getEntities({
          location: t.location, maxDistance: reach,
          excludeFamilies,
          excludeTypes: [TENTACLE_ID, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
        });
      } catch { continue; }

      let struck = false;
      for (const v of victims) {
        if (!v.isValid) continue;
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
          v.applyKnockback(dx, dz, 0.35, 0.15);
        } catch { /* ignore */ }
      }

      try { t.setProperty("overdrive:striking", struck); } catch { /* ignore */ }
      if (struck) {
        try { t.dimension.playSound("mob.warden.attack_impact", t.location, { volume: 0.6, pitch: 0.8 }); } catch { /* ignore */ }
        system.runTimeout(() => {
          try { if (t.isValid) t.setProperty("overdrive:striking", false); } catch { /* ignore */ }
        }, 8);
      }
    }
  }
}
