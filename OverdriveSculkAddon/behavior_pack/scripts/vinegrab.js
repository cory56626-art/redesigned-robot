// =========================================================================
//  Overdrive Sculk — Vine Grab system (Level 2+).
//
//  Once per second, any mob standing on Overdrive Sculk can be seized: a
//  living Overdrive Vine erupts, drags it 1–2 blocks down, kills it, and
//  feeds "energy" back into the infection.
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

/**
 * Run one Vine Grab pass. Returns the number of fresh 10-energy thresholds
 * crossed this second (so the caller can trigger the Infected Wither payoff).
 */
export function runVineGrab(infection) {
  if (!infection.active || infection.level < 2) return 0;
  const chance = vineChanceForLevel(infection.level);
  if (chance <= 0) return 0;

  const seen = new Set();
  let grabs = 0;
  let thresholds = 0;

  for (const player of world.getAllPlayers()) {
    if (grabs >= MAX_GRABS_PER_SECOND) break;
    const dim = player.dimension;
    let candidates;
    try {
      candidates = dim.getEntities({
        location: player.location,
        maxDistance: 48,
        ...SCAN_OPTIONS,
      });
    } catch { continue; }

    for (const mob of candidates) {
      if (grabs >= MAX_GRABS_PER_SECOND) break;
      if (!isAlive(mob) || seen.has(mob.id)) continue;
      seen.add(mob.id);

      // Never grab players (the excludeTypes query already skips them; this is
      // an explicit backstop so a player can never be dragged/suffocated).
      if (mob.typeId === "minecraft:player") continue;
      if (!isStandingOnSculk(dim, mob)) continue;
      if (Math.random() >= chance) continue;

      grab(dim, mob, infection);
      grabs++;
      thresholds += infection.addEnergy(ENERGY_PER_GRAB);
    }
  }
  return thresholds;
}

function isStandingOnSculk(dim, mob) {
  const loc = mob.location;
  const support = { x: Math.floor(loc.x), y: Math.floor(loc.y) - 1, z: Math.floor(loc.z) };
  let below;
  try { below = dim.getBlock(support); } catch { return false; }
  return !!below && below.typeId === BLOCK_ID;
}

function grab(dim, mob, infection) {
  const loc = mob.location;
  const feet = { x: Math.floor(loc.x) + 0.5, y: loc.y, z: Math.floor(loc.z) + 0.5 };

  // Erupt the grabbing vine.
  try { dim.spawnEntity(VINE_ID, feet); } catch { /* ignore */ }
  try { dim.playSound("cauldron.explode", feet, { volume: 0.5, pitch: 0.4 }); } catch { /* ignore */ }
  try { dim.playSound("mob.warden.tendril_clicks", feet, { volume: 0.9, pitch: 0.7 }); } catch { /* ignore */ }
  try {
    dim.spawnParticle("minecraft:sculk_charge_pop_particle", { x: feet.x, y: loc.y + 0.5, z: feet.z });
  } catch { /* ignore */ }

  // Drag the victim 1–2 blocks down, then kill it normally after the yank.
  const drop = randInt(1, 2);
  try { mob.addEffect("slowness", 40, { amplifier: 4, showParticles: false }); } catch { /* ignore */ }
  system.runTimeout(() => {
    try {
      if (!isAlive(mob)) return;
      mob.teleport({ x: loc.x, y: loc.y - drop, z: loc.z });
    } catch { /* ignore */ }
  }, 4);
  system.runTimeout(() => {
    try { if (isAlive(mob)) mob.kill(); } catch { /* ignore */ }
  }, 12);
}
