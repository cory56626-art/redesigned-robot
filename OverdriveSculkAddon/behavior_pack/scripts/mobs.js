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
  BLOCK_ID, MOB_ZOMBIE, MOB_SKELETON, MOB_CREEPER, TENTACLE_ID,
  INFECTED_MOBS, ALL_OVERDRIVE_ENTITIES, hasFlag, isAlive, distSq, randInt,
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

function effCap(type, level) {
  const base = CAPS[type] ?? 3;
  if (type === "minecraft:warden" || type === "minecraft:wither") return base;
  // Ramp from ~1 at low levels to the full cap by Level 12.
  return Math.max(1, Math.min(base, Math.ceil((base * level) / 12)));
}

function countType(dim, type) {
  try { return dim.getEntities({ type }).length; } catch { return 0; }
}

// Per-tentacle strike cooldown (tick when each may attack again) so a tentacle
// bites periodically instead of draining you every single second.
const tentacleNextStrike = new Map();
const TENTACLE_COOLDOWN_TICKS = 30; // 1.5s

// Players in creative or spectator are never valid targets — they're testing.
function creativeAndSpectatorIds() {
  const ids = new Set();
  for (const p of world.getAllPlayers()) {
    let gm;
    try { gm = p.getGameMode(); } catch { /* older API */ }
    if (gm === undefined) {
      try {
        if (p.matches({ gameMode: "creative" })) gm = "creative";
        else if (p.matches({ gameMode: "spectator" })) gm = "spectator";
      } catch { /* ignore */ }
    }
    if (gm === "creative" || gm === "spectator") ids.add(p.id);
  }
  return ids;
}

// ------------------------------------------------------------------------- //
//  Spawn placement                                                          //
//  Look for real Overdrive Sculk with air above, in a ring around a random   //
//  player. Tying spawns to the player + actual infected blocks means the     //
//  corruption's army reliably appears wherever it has reached you.           //
// ------------------------------------------------------------------------- //
function findSpawnSpot() {
  const players = world.getAllPlayers();
  if (players.length === 0) return null;
  const p = players[randInt(0, players.length - 1)];
  const dim = p.dimension;
  const px = Math.floor(p.location.x);
  const py = Math.floor(p.location.y);
  const pz = Math.floor(p.location.z);

  for (let i = 0; i < 24; i++) {
    // A ring 4–24 blocks out so mobs erupt near you, not on top of you.
    const ang = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 20;
    const bx = px + Math.round(Math.cos(ang) * r);
    const bz = pz + Math.round(Math.sin(ang) * r);
    for (let oy = 8; oy >= -8; oy--) {
      const y = py + oy;
      let base, a1, a2;
      try {
        base = dim.getBlock({ x: bx, y, z: bz });
        a1 = dim.getBlock({ x: bx, y: y + 1, z: bz });
        a2 = dim.getBlock({ x: bx, y: y + 2, z: bz });
      } catch { continue; }
      if (base && a1 && a2 && base.typeId === BLOCK_ID && a1.isAir && a2.isAir) {
        return { dim, loc: { x: bx + 0.5, y: y + 1, z: bz + 0.5 } };
      }
    }
  }
  return null;
}

function trySpawn(infection, type, probability) {
  if (Math.random() > probability) return;
  const spot = findSpawnSpot();
  if (!spot) return;
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
  const spot = findSpawnSpot();
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
  if (infection.level < 11) return false;
  const spot = findSpawnSpot();
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
  // Melee reach only — you have to be right next to a tentacle. It grows a
  // little at Level 8 ("longer reach") but never becomes a ranged sniper.
  const reach = infection.level >= 8 ? 2.8 : infection.level >= 4 ? 2.3 : 1.9;
  const dmg = infection.level >= 15 ? 8 : infection.level >= 8 ? 5 : infection.level >= 4 ? 4 : 3;

  const protectedPlayers = creativeAndSpectatorIds();
  const now = system.currentTick;
  if (tentacleNextStrike.size > 256) tentacleNextStrike.clear(); // bound memory

  const handled = new Set();
  for (const player of world.getAllPlayers()) {
    let tentacles;
    try {
      tentacles = player.dimension.getEntities({ type: TENTACLE_ID, location: player.location, maxDistance: 80 });
    } catch { continue; }

    for (const t of tentacles) {
      if (!isAlive(t) || handled.has(t.id)) continue;
      handled.add(t.id);
      // Respect the per-tentacle cooldown so it bites, not drains.
      if ((tentacleNextStrike.get(t.id) ?? 0) > now) continue;

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
        if (protectedPlayers.has(v.id)) continue; // never touch creative/spectator
        try {
          v.applyDamage(dmg, { cause: "entityAttack", damagingEntity: t });
          struck = true;
        } catch {
          try { v.applyDamage(dmg); struck = true; } catch { /* ignore */ }
        }
        // Note: deliberately NO pull-toward knockback — it trapped players
        // against the immovable tentacle. You can always walk away now.
      }

      try { t.setProperty("overdrive:striking", struck); } catch { /* ignore */ }
      if (struck) {
        tentacleNextStrike.set(t.id, now + TENTACLE_COOLDOWN_TICKS);
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
