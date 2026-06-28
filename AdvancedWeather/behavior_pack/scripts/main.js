// main.js — entry point for the Advanced Weather System.
// Wires the per-second loop together and registers the command handlers.
import { world, system } from "@minecraft/server";
import { LOOP_TICKS, ACCUMULATION_EVERY, SNOW_STORMS, WIND_STORMS } from "./config.js";
import { getStorm, isExpired, clearStorm } from "./state.js";
import { updateFreezing, resetWarmth } from "./freezing.js";
import { applyWind, advanceWind } from "./wind.js";
import { accumulate } from "./accumulation.js";
import {
  applyEnvironment, clearEnvironment, maybeLightning, announce,
} from "./storms.js";
import { registerCommands } from "./commands.js";

registerCommands();

// Confirm load on the next tick (version-agnostic; avoids the renamed
// worldInitialize/worldLoad event entirely).
system.run(() => console.log("[AdvancedWeather] loaded."));

// Tracks the last storm signature so we only announce / clean up on changes.
let lastKey = "";
let iteration = 0;

system.runInterval(() => {
  iteration++;
  const players = world.getAllPlayers();
  let storm = getStorm();

  // ---- Storm lifetime: fade out once its rolled duration elapses ----
  if (isExpired(storm)) {
    clearStorm();
    storm = null;
  }

  const key = storm ? `${storm.type}:${storm.level}` : "";

  // ---- Handle transitions (storm started / changed / ended) ----
  if (key !== lastKey) {
    if (storm) {
      const banner = announce(storm.label, storm.level);
      for (const p of players) {
        try {
          p.onScreenDisplay.setTitle(banner.title, {
            subtitle: banner.subtitle,
            fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20,
          });
        } catch { /* player gone */ }
      }
    } else if (lastKey) {
      // Storm just ended: announce, clear fog/weather and thaw everyone out.
      clearEnvironment(players, world.getDimension("overworld"));
      for (const p of players) {
        resetWarmth(p);
        try {
          p.onScreenDisplay.setTitle("§f§oThe storm has passed.", {
            fadeInDuration: 10, stayDuration: 40, fadeOutDuration: 20,
          });
        } catch { /* player gone */ }
      }
    }
    lastKey = key;
  }

  if (!storm) return;

  // ---- Environment (fog + vanilla weather) per dimension that has players ----
  const dims = new Set(players.map((p) => p.dimension));
  for (const dim of dims) {
    const inDim = players.filter((p) => p.dimension === dim);
    applyEnvironment(inDim, storm, dim);
  }

  // ---- Wind ----
  if (WIND_STORMS.has(storm.type)) {
    advanceWind();
    for (const p of players) applyWind(p, storm.def.wind);
  }

  // ---- Freezing meter ----
  if (SNOW_STORMS.has(storm.type)) {
    for (const p of players) {
      try { updateFreezing(p, storm.def, storm.level); } catch { /* player gone */ }
    }
  }

  // ---- Snow accumulation (scattered across the loaded area, throttled) ----
  // L1's budget is 0 so it no-ops; L2+ dust/pile/bury at increasing scale.
  if (SNOW_STORMS.has(storm.type) && iteration % ACCUMULATION_EVERY === 0) {
    for (const p of players) {
      try { accumulate(p, storm.level); } catch { /* unloaded chunk */ }
    }
  }

  // ---- Lightning ----
  maybeLightning(players, storm);
}, LOOP_TICKS);
