// =========================================================================
//  Overdrive Sculk — audio / visual feedback.
//
//  All sounds and particles reuse vanilla assets played through the Script
//  API, so the pack ships no binary audio.  Every call is guarded because an
//  unknown id or unloaded chunk must never break the infection loop.
// =========================================================================

import { world } from "@minecraft/server";
import { NODE_ID, hasFlag } from "./config.js";

function safePlay(dim, id, loc, opts) {
  try { dim.playSound(id, loc, opts); } catch { /* ignore bad id / unloaded */ }
}

function safeParticle(dim, id, loc) {
  try { dim.spawnParticle(id, loc); } catch { /* ignore */ }
}

// Fog is a *push* stack, so we remember who already has it to avoid re-pushing.
const foggedPlayers = new Set();

// ------------------------------------------------------------------------- //
//  Level-up announcement                                                    //
// ------------------------------------------------------------------------- //
export function announceLevel(level) {
  const msg = `§3§l» §r§bOverdrive Sculk reached §lLevel ${level}§r§b.`;
  world.sendMessage(msg);
  for (const p of world.getAllPlayers()) {
    try {
      p.onScreenDisplay.setTitle("§3OVERDRIVE SCULK", {
        stayDuration: 30,
        fadeInDuration: 8,
        fadeOutDuration: 12,
        subtitle: `§bLevel ${level}`,
      });
    } catch { /* ignore */ }
    safePlay(p.dimension, level >= 11 ? "mob.warden.roar" : "mob.warden.angry", p.location);
    safePlay(p.dimension, "block.beacon.power", p.location, { pitch: 0.6, volume: 0.6 });
  }
}

// ------------------------------------------------------------------------- //
//  Rumbling (Level 10+)                                                     //
// ------------------------------------------------------------------------- //
export function rumble(level) {
  if (!hasFlag(level, "rumbling")) return;
  const intensity = Math.min(1.4, 0.6 + (level - 10) * 0.1);
  for (const p of world.getAllPlayers()) {
    safePlay(p.dimension, "mob.warden.heartbeat", p.location, { volume: intensity, pitch: 0.7 });
    if (Math.random() < 0.4) {
      safePlay(p.dimension, "ambient.cave", p.location, { volume: intensity, pitch: 0.5 });
    }
    if (level >= 15 && Math.random() < 0.3) {
      safePlay(p.dimension, "mob.warden.nearby_close", p.location, { volume: 1.0, pitch: 0.6 });
    }
  }
}

// ------------------------------------------------------------------------- //
//  Overdrive Fog (Level 14+)                                                //
// ------------------------------------------------------------------------- //
export function updateFog(infection) {
  const on = hasFlag(infection.level, "fog");
  for (const p of world.getAllPlayers()) {
    const has = foggedPlayers.has(p.id);
    if (on && !has) {
      try {
        p.runCommand("fog @s push overdrive:overdrive_fog overdrive_fog");
        foggedPlayers.add(p.id);
      } catch { /* ignore */ }
    } else if (!on && has) {
      clearFog(p);
    }
  }
}

export function clearFog(player) {
  try { player.runCommand("fog @s remove overdrive_fog"); } catch { /* ignore */ }
  foggedPlayers.delete(player.id);
}

export function clearAllFog() {
  for (const p of world.getAllPlayers()) clearFog(p);
  foggedPlayers.clear();
}

// ------------------------------------------------------------------------- //
//  Pulsing / vein particles                                                 //
// ------------------------------------------------------------------------- //
export function pulse(infection) {
  const f = infection.randomFrontier();
  if (!f) return;
  let dim;
  try { dim = world.getDimension(f.d); } catch { return; }
  safeParticle(dim, "minecraft:sculk_charge_pop_particle", { x: f.x + 0.5, y: f.y + 1.1, z: f.z + 0.5 });
}

// ------------------------------------------------------------------------- //
//  Overdrive Nodes — "mini hearts" (Level 13+)                              //
// ------------------------------------------------------------------------- //
export function tryPlaceNode(infection) {
  if (!hasFlag(infection.level, "nodes")) return;
  const f = infection.randomFrontier();
  if (!f) return;
  let dim;
  try { dim = world.getDimension(f.d); } catch { return; }
  const above = { x: f.x, y: f.y + 1, z: f.z };
  let b;
  try { b = dim.getBlock(above); } catch { return; }
  if (b && b.isAir) {
    try {
      b.setType(NODE_ID);
      safePlay(dim, "block.sculk_catalyst.bloom", above, { volume: 0.7 });
      safeParticle(dim, "minecraft:sculk_charge_pop_particle", { x: above.x + 0.5, y: above.y + 0.5, z: above.z + 0.5 });
    } catch { /* ignore */ }
  }
}
