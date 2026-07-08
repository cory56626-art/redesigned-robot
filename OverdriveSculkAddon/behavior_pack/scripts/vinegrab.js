// =========================================================================
//  Overdrive Sculk — Vine Grab system (Level 2+).
//
//  When something stands on Overdrive Sculk it can be seized:
//   - MOBS are dragged down and killed (they feed the infection).
//   - PLAYERS are ROOTED in a struggle: slowed, slowly damaged, and must
//     SPAM JUMP to tear free. It never instantly kills you.
// =========================================================================

import { world, system } from "@minecraft/server";
import {
  VINE_ID, BLOCK_ID, ENERGY_PER_GRAB, vineChanceForLevel, randInt, isAlive,
} from "./config.js";

// Mobs we never grab: players, projectiles, drops, and the corruption's own.
const SCAN_OPTIONS = {
  excludeTypes: [
    "minecraft:player", "minecraft:item", "minecraft:xp_orb",
    "minecraft:arrow", "minecraft:thrown_trident", "minecraft:area_effect_cloud",
    "minecraft:eye_of_ender_signal", "minecraft:fireball",
  ],
  excludeFamilies: ["overdrive", "inanimate", "projectile"],
};

const MAX_GRABS_PER_SECOND = 6;

// Players currently held: id -> { jumpsLeft, prevVY, nextDamageTick, releaseTick }.
const grabbedPlayers = new Map();

// ------------------------------------------------------------------------- //
//  Once-per-second grab roll                                                //
// ------------------------------------------------------------------------- //
export function runVineGrab(infection) {
  if (!infection.active || infection.level < 2) return 0;
  const chance = vineChanceForLevel(infection.level);
  if (chance <= 0) return 0;

  let thresholds = 0;

  // --- Players: rooted struggle (NOT an instant kill) ------------------- //
  for (const p of world.getAllPlayers()) {
    if (grabbedPlayers.has(p.id) || isProtectedPlayer(p)) continue;
    if (!isStandingOnSculk(p.dimension, p)) continue;
    if (Math.random() < chance) {
      grabPlayer(p, infection);
      thresholds += infection.addEnergy(ENERGY_PER_GRAB);
    }
  }

  // --- Mobs: quick grab + kill ------------------------------------------ //
  const seen = new Set();
  let grabs = 0;
  for (const player of world.getAllPlayers()) {
    if (grabs >= MAX_GRABS_PER_SECOND) break;
    const dim = player.dimension;
    let candidates;
    try {
      candidates = dim.getEntities({ location: player.location, maxDistance: 48, ...SCAN_OPTIONS });
    } catch { continue; }

    for (const mob of candidates) {
      if (grabs >= MAX_GRABS_PER_SECOND) break;
      if (!isAlive(mob) || seen.has(mob.id)) continue;
      seen.add(mob.id);
      if (mob.typeId === "minecraft:player") continue; // backstop
      if (!isStandingOnSculk(dim, mob)) continue;
      if (Math.random() >= chance) continue;

      grabMob(dim, mob);
      grabs++;
      thresholds += infection.addEnergy(ENERGY_PER_GRAB);
    }
  }
  return thresholds;
}

function isStandingOnSculk(dim, entity) {
  const loc = entity.location;
  const support = { x: Math.floor(loc.x), y: Math.floor(loc.y) - 1, z: Math.floor(loc.z) };
  let below;
  try { below = dim.getBlock(support); } catch { return false; }
  return !!below && below.typeId === BLOCK_ID;
}

function isProtectedPlayer(p) {
  let gm;
  try { gm = p.getGameMode(); } catch { /* older API */ }
  if (gm === undefined) {
    try {
      if (p.matches({ gameMode: "creative" })) gm = "creative";
      else if (p.matches({ gameMode: "spectator" })) gm = "spectator";
    } catch { /* ignore */ }
  }
  return gm === "creative" || gm === "spectator";
}

// ------------------------------------------------------------------------- //
//  Mob grab: drag down and kill                                             //
// ------------------------------------------------------------------------- //
function grabMob(dim, mob) {
  const loc = mob.location;
  const feet = { x: Math.floor(loc.x) + 0.5, y: loc.y, z: Math.floor(loc.z) + 0.5 };

  try { dim.spawnEntity(VINE_ID, feet); } catch { /* ignore */ }
  try { dim.playSound("mob.warden.tendril_clicks", feet, { volume: 0.9, pitch: 0.7 }); } catch { /* ignore */ }
  try { dim.spawnParticle("minecraft:sculk_charge_pop_particle", { x: feet.x, y: loc.y + 0.5, z: feet.z }); } catch { /* ignore */ }

  const drop = randInt(1, 2);
  try { mob.addEffect("slowness", 40, { amplifier: 4, showParticles: false }); } catch { /* ignore */ }
  system.runTimeout(() => {
    try { if (isAlive(mob)) mob.teleport({ x: loc.x, y: loc.y - drop, z: loc.z }); } catch { /* ignore */ }
  }, 4);
  system.runTimeout(() => {
    try { if (isAlive(mob)) mob.kill(); } catch { /* ignore */ }
  }, 12);
}

// ------------------------------------------------------------------------- //
//  Player grab: rooted struggle — spam jump to escape                       //
// ------------------------------------------------------------------------- //
function grabPlayer(player, infection) {
  const feet = { x: Math.floor(player.location.x) + 0.5, y: player.location.y, z: Math.floor(player.location.z) + 0.5 };
  try { player.dimension.spawnEntity(VINE_ID, feet); } catch { /* ignore */ }
  try { player.dimension.playSound("cauldron.explode", feet, { volume: 0.6, pitch: 0.4 }); } catch { /* ignore */ }
  try { player.dimension.playSound("mob.warden.tendril_clicks", feet, { volume: 1.0, pitch: 0.6 }); } catch { /* ignore */ }

  const jumps = infection.level >= 15 ? 8 : infection.level >= 9 ? 6 : infection.level >= 5 ? 5 : 4;
  grabbedPlayers.set(player.id, {
    jumpsLeft: jumps,
    prevVY: 0,
    nextDamageTick: system.currentTick + 20,
    releaseTick: system.currentTick + 240, // 12s hard safety release
  });
  try { player.onScreenDisplay.setActionBar("§c§lThe Overdrive Sculk has you! §r§eSPAM JUMP to break free!"); } catch { /* ignore */ }
}

/**
 * Fast tick (call every couple of ticks) that maintains the rooted state,
 * counts jumps, and applies the slow damage. Returns immediately when nobody
 * is grabbed.
 */
export function updatePlayerGrabs(infection) {
  if (grabbedPlayers.size === 0) return;
  const now = system.currentTick;

  const players = new Map();
  for (const p of world.getAllPlayers()) players.set(p.id, p);

  for (const [id, st] of grabbedPlayers) {
    const p = players.get(id);
    if (!p || !isAlive(p)) { grabbedPlayers.delete(id); continue; }

    // Hard-release conditions.
    if (now > st.releaseTick || !infection.active || isProtectedPlayer(p)) {
      releasePlayer(p, false);
      continue;
    }

    // Keep the player rooted (re-applied on a short duration so it self-clears
    // the moment we stop, ~0.5s after release).
    try { p.addEffect("slowness", 10, { amplifier: 200, showParticles: false }); } catch { /* ignore */ }
    try { p.addEffect("weakness", 10, { amplifier: 2, showParticles: false }); } catch { /* ignore */ }

    // Detect a jump as a rising edge in vertical velocity.
    let vy = 0;
    try { vy = p.getVelocity().y; } catch { /* ignore */ }
    if (st.prevVY <= 0.08 && vy > 0.30) {
      st.jumpsLeft--;
      try { p.dimension.playSound("mob.warden.tendril_clicks", p.location, { volume: 0.7, pitch: 1.3 }); } catch { /* ignore */ }
      if (st.jumpsLeft > 0) {
        try { p.onScreenDisplay.setActionBar(`§eTearing free... §c${st.jumpsLeft}§e more jump${st.jumpsLeft === 1 ? "" : "s"}!`); } catch { /* ignore */ }
      }
    }
    st.prevVY = vy;

    // Slow, steady damage while held.
    if (now >= st.nextDamageTick) {
      st.nextDamageTick = now + 20;
      const dmg = infection.level >= 15 ? 3 : 2;
      try { p.applyDamage(dmg, { cause: "magic" }); } catch { try { p.applyDamage(dmg); } catch { /* ignore */ } }
      try { p.dimension.spawnParticle("minecraft:sculk_charge_pop_particle", { x: p.location.x, y: p.location.y + 0.6, z: p.location.z }); } catch { /* ignore */ }
    }

    if (st.jumpsLeft <= 0) releasePlayer(p, true);
  }
}

function releasePlayer(p, freed) {
  grabbedPlayers.delete(p.id);
  // Stop re-applying slowness/weakness — they expire within ~0.5s on their own.
  try { p.applyKnockback(0, 0, 0, 0.45); } catch { /* ignore */ } // small pop as you tear loose
  if (freed) {
    try { p.onScreenDisplay.setActionBar("§aYou tore free of the sculk!"); } catch { /* ignore */ }
    try { p.dimension.playSound("random.pop", p.location, { volume: 0.9, pitch: 1.2 }); } catch { /* ignore */ }
  }
}
