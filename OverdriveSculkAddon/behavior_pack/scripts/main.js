// =========================================================================
//  Overdrive Sculk — entry point.
//
//  Wires the block-placement trigger, the master half-second tick loop, and
//  the admin /scriptevent commands.  Everything else lives in the modules
//  imported below; this file just orchestrates them.
//
//  Admin commands (run in chat):
//    /scriptevent overdrive:status        - print live infection stats
//    /scriptevent overdrive:reset          - wipe the infection state
//    /scriptevent overdrive:level <1-15>   - jump to a level
//    /scriptevent overdrive:energy <n>     - set energy
//    /scriptevent overdrive:seedhere       - plant sculk under every player
// =========================================================================

import { world, system } from "@minecraft/server";
import { BLOCK_ID } from "./config.js";
import { Infection } from "./infection.js";
import * as effects from "./effects.js";
import { runVineGrab } from "./vinegrab.js";
import { spawnTick, tentacleAttackTick, spawnInfectedWither } from "./mobs.js";

const infection = new Infection();

const BASE_TICK_TICKS = 10; // master loop cadence: 10 ticks = 0.5s
const BASE_TICK_SEC = 0.5;

let booted = false;
let spreadAccumulator = 0; // seconds elapsed toward the next spread
let baseTicks = 0;         // count of half-second base ticks

function boot() {
  if (booted) return;
  booted = true;
  try { infection.load(); } catch (e) { console.warn("[Overdrive] load failed: " + e); }
}

function announceAll(levels) {
  for (const lv of levels) effects.announceLevel(lv);
}

// ------------------------------------------------------------------------- //
//  Trigger: placing Overdrive Sculk                                         //
// ------------------------------------------------------------------------- //
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try {
    const b = ev.block;
    if (!b || b.typeId !== BLOCK_ID) return;
    boot();
    const firstEver = infection.seed(b);
    const reached = infection.checkLevelUp();
    if (firstEver) {
      world.sendMessage("§3§l» §r§bThe Overdrive Sculk has been planted. It grows forever now.");
      effects.announceLevel(1);
    }
    announceAll(reached);
    infection.save();
  } catch (e) { console.warn("[Overdrive] place handler: " + e); }
});

// ------------------------------------------------------------------------- //
//  Master loop — every half second                                          //
// ------------------------------------------------------------------------- //
system.runInterval(() => {
  boot();
  if (!infection.active) return;

  baseTicks++;
  spreadAccumulator += BASE_TICK_SEC;

  // ---- Spread on the level/energy-derived interval --------------------- //
  const interval = infection.effectiveIntervalSec();
  if (spreadAccumulator >= interval) {
    spreadAccumulator = 0;
    try { announceAll(infection.spreadStep()); } catch (e) { console.warn("[Overdrive] spread: " + e); }
    try { effects.pulse(infection); } catch { /* ignore */ }
  }

  // ---- Once-per-second systems (every other base tick) ----------------- //
  if (baseTicks % 2 === 0) {
    let thresholds = 0;
    try { thresholds = runVineGrab(infection); } catch (e) { console.warn("[Overdrive] vine: " + e); }
    // Energy milestones can birth the Infected Wither (rare, capped at 1).
    if (thresholds > 0 && infection.level >= 11 && Math.random() < 0.5) {
      try { spawnInfectedWither(infection); } catch { /* ignore */ }
    }

    try { tentacleAttackTick(infection); } catch (e) { console.warn("[Overdrive] tentacle: " + e); }
    try { effects.updateFog(infection); } catch { /* ignore */ }
    try { effects.rumble(infection.level); } catch { /* ignore */ }

    // ---- Slow cadence (~5s): mob spawning + node growth ---------------- //
    if (baseTicks % 10 === 0) {
      try { spawnTick(infection); } catch (e) { console.warn("[Overdrive] spawn: " + e); }
      try { effects.tryPlaceNode(infection); } catch { /* ignore */ }
    }
  }

  // ---- Periodic persistence (~every 10s) ------------------------------- //
  if (baseTicks % 20 === 0) {
    try { infection.save(); } catch { /* ignore */ }
  }
}, BASE_TICK_TICKS);

// ------------------------------------------------------------------------- //
//  Admin / debug commands                                                   //
// ------------------------------------------------------------------------- //
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("overdrive:")) return;
  boot();
  const cmd = ev.id.slice("overdrive:".length);
  const arg = (ev.message ?? "").trim();

  switch (cmd) {
    case "status":
      world.sendMessage(
        `§b[Overdrive] §3active:§b${infection.active} §3level:§b${infection.level} ` +
        `§3blocks:§b${infection.blockCount} §3energy:§b${infection.energy} ` +
        `§3interval:§b${infection.effectiveIntervalSec().toFixed(1)}s §3frontier:§b${infection.frontier.length}`
      );
      break;

    case "reset":
      infection.reset();
      effects.clearAllFog();
      spreadAccumulator = 0;
      world.sendMessage("§b[Overdrive] §3Infection reset.");
      break;

    case "level": {
      const n = parseInt(arg, 10);
      if (!Number.isNaN(n)) {
        infection.active = true;
        infection.level = Math.max(1, Math.min(15, n));
        infection.save();
        effects.announceLevel(infection.level);
      }
      break;
    }

    case "energy": {
      const n = parseInt(arg, 10);
      if (!Number.isNaN(n)) {
        infection.energy = Math.max(0, n);
        infection.save();
        world.sendMessage(`§b[Overdrive] §3Energy set to §b${infection.energy}§3.`);
      }
      break;
    }

    case "seedhere": {
      for (const p of world.getAllPlayers()) {
        const loc = { x: Math.floor(p.location.x), y: Math.floor(p.location.y) - 1, z: Math.floor(p.location.z) };
        try {
          const b = p.dimension.getBlock(loc);
          if (b) { b.setType(BLOCK_ID); infection.seed(b); }
        } catch { /* ignore */ }
      }
      infection.active = true;
      infection.save();
      effects.announceLevel(infection.level);
      world.sendMessage("§b[Overdrive] §3Sculk planted under every player.");
      break;
    }

    default:
      break;
  }
});

console.warn("[Overdrive Sculk] Script API loaded. Place Overdrive Sculk to begin the infection.");
