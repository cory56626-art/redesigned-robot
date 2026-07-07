// =========================================================================
//  Overdrive Sculk — entry point.
//
//  Wires the block-placement trigger, the master half-second tick loop, and
//  the admin/test /scriptevent commands.  Everything else lives in the
//  modules imported below; this file just orchestrates them.
//
//  Run /scriptevent overdrive:help in chat for the full command list.
// =========================================================================

import { world, system } from "@minecraft/server";
import {
  BLOCK_ID, NODE_ID, MOB_ZOMBIE, MOB_SKELETON, MOB_CREEPER, TENTACLE_ID, VINE_ID,
} from "./config.js";
import { Infection } from "./infection.js";
import * as effects from "./effects.js";
import { runVineGrab } from "./vinegrab.js";
import {
  spawnTick, tentacleAttackTick, infectedGroundTick, spawnInfectedWither,
  spawnAt, spawnTestWither, clearOverdriveMobs,
} from "./mobs.js";

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
    if (thresholds > 0 && infection.level >= 11 && Math.random() < 0.5) {
      try { spawnInfectedWither(infection); } catch { /* ignore */ }
    }

    try { tentacleAttackTick(infection); } catch (e) { console.warn("[Overdrive] tentacle: " + e); }
    try { infectedGroundTick(infection); } catch (e) { console.warn("[Overdrive] ground: " + e); }
    try { effects.updateFog(infection); } catch { /* ignore */ }
    try { effects.rumble(infection.level); } catch { /* ignore */ }

    // ---- Slow cadence (~10s): mob spawning + node growth --------------- //
    if (baseTicks % 20 === 0) {
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
//  Admin / test commands                                                    //
// ------------------------------------------------------------------------- //
const HELP = [
  "§3§l== Overdrive Sculk commands ==",
  "§bstatus §7- live infection stats",
  "§breset §7- wipe the infection",
  "§blevel <1-15> §7- jump to a level",
  "§benergy <n> §7- set energy",
  "§baddblocks <n> §7- add to the block count (test level triggers)",
  "§bspread [n] §7- force n spread cycles now (default 1)",
  "§bseedhere §7- plant sculk under every player",
  "§bspawn <zombie|skeleton|creeper|tentacle|vine|wither|warden> §7- spawn at you",
  "§bgrab §7- force a Vine Grab on the nearest mob",
  "§bnode §7- place an Overdrive Node at you",
  "§bfog <on|off> §7- toggle Overdrive Fog",
  "§brumble §7- play the rumble now",
  "§bclearmobs §7- remove all Overdrive mobs (fixes over-spawn)",
];

const SPAWN_ALIASES = {
  zombie: MOB_ZOMBIE, skeleton: MOB_SKELETON, creeper: MOB_CREEPER,
  tentacle: TENTACLE_ID, vine: VINE_ID, warden: "minecraft:warden",
};

function actorOf(ev) {
  return ev.sourceEntity ?? world.getAllPlayers()[0];
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("overdrive:")) return;
  boot();
  const cmd = ev.id.slice("overdrive:".length);
  const arg = (ev.message ?? "").trim();
  const actor = actorOf(ev);

  switch (cmd) {
    case "help":
      for (const line of HELP) world.sendMessage(line);
      break;

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

    case "addblocks": {
      const n = parseInt(arg, 10);
      if (!Number.isNaN(n)) {
        infection.active = true;
        infection.blockCount = Math.max(0, infection.blockCount + n);
        announceAll(infection.checkLevelUp());
        infection.save();
        world.sendMessage(`§b[Overdrive] §3Block count is now §b${infection.blockCount}§3.`);
      }
      break;
    }

    case "spread": {
      const n = Math.max(1, Math.min(50, parseInt(arg, 10) || 1));
      infection.active = true;
      if (infection.frontier.length === 0 && actor) {
        // Nothing to grow from yet — plant a seed under the actor first.
        const loc = { x: Math.floor(actor.location.x), y: Math.floor(actor.location.y) - 1, z: Math.floor(actor.location.z) };
        try { const b = actor.dimension.getBlock(loc); if (b) { b.setType(BLOCK_ID); infection.seed(b); } } catch { /* ignore */ }
      }
      for (let i = 0; i < n; i++) announceAll(infection.spreadStep());
      infection.save();
      world.sendMessage(`§b[Overdrive] §3Forced §b${n}§3 spread cycles. Blocks: §b${infection.blockCount}§3.`);
      break;
    }

    case "seedhere": {
      for (const p of world.getAllPlayers()) {
        const loc = { x: Math.floor(p.location.x), y: Math.floor(p.location.y) - 1, z: Math.floor(p.location.z) };
        try { const b = p.dimension.getBlock(loc); if (b) { b.setType(BLOCK_ID); infection.seed(b); } } catch { /* ignore */ }
      }
      infection.active = true;
      infection.save();
      effects.announceLevel(infection.level);
      world.sendMessage("§b[Overdrive] §3Sculk planted under every player.");
      break;
    }

    case "spawn": {
      if (!actor) break;
      const key = arg.toLowerCase();
      const loc = { x: actor.location.x, y: actor.location.y, z: actor.location.z };
      if (key === "wither") {
        spawnTestWither(actor.dimension, loc);
      } else if (SPAWN_ALIASES[key]) {
        const e = spawnAt(actor.dimension, loc, SPAWN_ALIASES[key]);
        world.sendMessage(e ? `§b[Overdrive] §3Spawned §b${key}§3.` : `§c[Overdrive] Failed to spawn ${key}.`);
      } else {
        world.sendMessage("§c[Overdrive] Unknown type. Try: zombie, skeleton, creeper, tentacle, vine, wither, warden.");
      }
      break;
    }

    case "grab": {
      infection.active = true;
      const before = infection.energy;
      try { runVineGrab(infection); } catch { /* ignore */ }
      world.sendMessage(`§b[Overdrive] §3Vine Grab pass ran. Energy: §b${before}§3 → §b${infection.energy}§3.`);
      break;
    }

    case "node": {
      if (!actor) break;
      const above = { x: Math.floor(actor.location.x), y: Math.floor(actor.location.y), z: Math.floor(actor.location.z) };
      try { const b = actor.dimension.getBlock(above); if (b) b.setType(NODE_ID); } catch { /* ignore */ }
      world.sendMessage("§b[Overdrive] §3Placed an Overdrive Node.");
      break;
    }

    case "fog": {
      if (arg.toLowerCase() === "off") {
        effects.clearAllFog();
        world.sendMessage("§b[Overdrive] §3Fog cleared.");
      } else {
        for (const p of world.getAllPlayers()) {
          try { p.runCommand("fog @s push overdrive:overdrive_fog overdrive_fog"); } catch { /* ignore */ }
        }
        world.sendMessage("§b[Overdrive] §3Fog pushed to all players.");
      }
      break;
    }

    case "rumble":
      try { effects.rumble(Math.max(10, infection.level)); } catch { /* ignore */ }
      break;

    case "clearmobs": {
      const n = clearOverdriveMobs();
      world.sendMessage(`§b[Overdrive] §3Removed §b${n}§3 Overdrive mobs.`);
      break;
    }

    default:
      world.sendMessage("§c[Overdrive] Unknown command. Run §b/scriptevent overdrive:help§c.");
      break;
  }
});

console.warn("[Overdrive Sculk] Script API loaded. Place Overdrive Sculk to begin the infection.");
