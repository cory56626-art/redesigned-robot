// state.js — persistent storm state stored on the world via dynamic properties.
import { world } from "@minecraft/server";
import { DP, STORMS } from "./config.js";

// Returns { type, level, def } for the active storm, or null when clear.
export function getStorm() {
  const type = world.getDynamicProperty(DP.type);
  const level = world.getDynamicProperty(DP.level);
  if (!type || !level || level < 1) return null;
  const storm = STORMS[type];
  if (!storm) return null;
  const def = storm.levels[level];
  if (!def) return null;
  return { type, level, def, label: storm.label };
}

// Activate a storm. Returns true on success, false for invalid args.
export function setStorm(type, level) {
  const storm = STORMS[type];
  if (!storm) return false;
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 4) return false;
  world.setDynamicProperty(DP.type, type);
  world.setDynamicProperty(DP.level, lvl);
  return true;
}

// Clear any active storm.
export function clearStorm() {
  world.setDynamicProperty(DP.type, "");
  world.setDynamicProperty(DP.level, 0);
}
