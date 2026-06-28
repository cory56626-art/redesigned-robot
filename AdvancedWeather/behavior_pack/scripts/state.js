// state.js — persistent storm state stored on the world via dynamic properties.
import { world, system } from "@minecraft/server";
import { DP, STORMS, TICKS_PER_SECOND } from "./config.js";

// Returns { type, level, def, endTick } for the active storm, or null when clear.
export function getStorm() {
  const type = world.getDynamicProperty(DP.type);
  const level = world.getDynamicProperty(DP.level);
  if (!type || !level || level < 1) return null;
  const storm = STORMS[type];
  if (!storm) return null;
  const def = storm.levels[level];
  if (!def) return null;
  const endTick = world.getDynamicProperty(DP.endTick) || 0;
  return { type, level, def, label: storm.label, endTick };
}

function rollDuration(def, durationSec) {
  // Explicit 0 -> infinite. Explicit positive -> that many seconds.
  if (durationSec === 0) return 0;
  if (typeof durationSec === "number" && durationSec > 0) {
    return system.currentTick + Math.round(durationSec * TICKS_PER_SECOND);
  }
  // Otherwise roll a random length from the level's configured range.
  const [min, max] = def.durationSec || [180, 300];
  const secs = min + Math.random() * (max - min);
  return system.currentTick + Math.round(secs * TICKS_PER_SECOND);
}

// Activate a storm. `durationSec` is optional: undefined = random from config,
// 0 = infinite, positive number = that many seconds. Returns true on success.
export function setStorm(type, level, durationSec) {
  const storm = STORMS[type];
  if (!storm) return false;
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) return false;
  world.setDynamicProperty(DP.type, type);
  world.setDynamicProperty(DP.level, lvl);
  world.setDynamicProperty(DP.endTick, rollDuration(storm.levels[lvl], durationSec));
  return true;
}

// Clear any active storm.
export function clearStorm() {
  world.setDynamicProperty(DP.type, "");
  world.setDynamicProperty(DP.level, 0);
  world.setDynamicProperty(DP.endTick, 0);
}

// True if the storm's lifetime has elapsed (endTick > 0 and reached).
export function isExpired(storm) {
  return !!storm && storm.endTick > 0 && system.currentTick >= storm.endTick;
}

// Seconds remaining for the active storm, or null if none/infinite.
export function remainingSeconds(storm) {
  if (!storm || storm.endTick <= 0) return null;
  return Math.max(0, Math.ceil((storm.endTick - system.currentTick) / TICKS_PER_SECOND));
}
