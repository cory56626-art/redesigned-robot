// commands.js — /scriptevent handlers that drive & test the weather system.
//
// Core:
//   /scriptevent aw:set <snowstorm|hurricane|omega> <1-4>
//   /scriptevent aw:clear
//   /scriptevent aw:info
//   /scriptevent aw:help
//
// Shortcuts (level defaults to 1 if omitted):
//   /scriptevent aw:snow <1-4>
//   /scriptevent aw:hurricane <1-4>
//   /scriptevent aw:omega <1-4>
//   /scriptevent aw:level <1-4>      -> change level of the current storm
//   /scriptevent aw:next             -> bump the current storm up one level
//
// Testing helpers:
//   /scriptevent aw:demo             -> auto-cycle every level of every storm
//   /scriptevent aw:warmth           -> print your current warmth value
import { system, world } from "@minecraft/server";
import { setStorm, clearStorm, getStorm } from "./state.js";
import { STORMS, DP, MAX_WARMTH } from "./config.js";

function reply(source, message) {
  if (source && typeof source.sendMessage === "function") source.sendMessage(message);
  else world.sendMessage(message);
}

function start(source, type, levelRaw) {
  const level = levelRaw === undefined || levelRaw === "" ? 1 : parseInt(levelRaw, 10);
  if (setStorm(type, level)) {
    reply(source, `§aStarted §b${STORMS[type].label} §aLevel ${level}/4.`);
  } else {
    reply(source, "§cLevel must be a whole number from 1 to 4.");
  }
}

function helpText() {
  return [
    "§b=== Advanced Weather: test commands ===",
    "§e/scriptevent aw:snow <1-4>§7 — start a snowstorm",
    "§e/scriptevent aw:hurricane <1-4>§7 — start a hurricane",
    "§e/scriptevent aw:omega <1-4>§7 — start an omega storm",
    "§e/scriptevent aw:level <1-4>§7 — change current level",
    "§e/scriptevent aw:next§7 — step current storm up a level",
    "§e/scriptevent aw:clear§7 — stop the storm",
    "§e/scriptevent aw:info§7 — show the active storm",
    "§e/scriptevent aw:warmth§7 — show your warmth meter",
    "§e/scriptevent aw:demo§7 — auto-cycle every storm & level",
  ].join("\n");
}

// Demo: walk through all 12 storm/level combos, ~10s each.
let demoHandle = null;
function runDemo(source) {
  if (demoHandle !== null) {
    system.clearRun(demoHandle);
    demoHandle = null;
    reply(source, "§eDemo stopped.");
    return;
  }
  const combos = [];
  for (const type of Object.keys(STORMS)) {
    for (let lvl = 1; lvl <= 4; lvl++) combos.push([type, lvl]);
  }
  let i = 0;
  reply(source, "§aDemo started — cycling all storms (run aw:demo again to stop).");
  const step = () => {
    if (i >= combos.length) {
      clearStorm();
      system.clearRun(demoHandle);
      demoHandle = null;
      reply(source, "§aDemo complete.");
      return;
    }
    const [type, lvl] = combos[i++];
    setStorm(type, lvl);
    world.sendMessage(`§7[demo] §b${STORMS[type].label} §7Level ${lvl}/4`);
    demoHandle = system.runTimeout(step, 200); // 10 seconds
  };
  step();
}

export function registerCommands() {
  system.afterEvents.scriptEventReceive.subscribe((event) => {
    const { id, message, sourceEntity } = event;
    if (!id.startsWith("aw:")) return;
    const s = sourceEntity;
    const sub = id.slice(3);
    const arg = (message || "").trim().split(/\s+/);

    switch (sub) {
      case "set": {
        const type = (arg[0] || "").toLowerCase();
        if (!STORMS[type]) {
          reply(s, "§cUsage: /scriptevent aw:set <snowstorm|hurricane|omega> <1-4>");
          return;
        }
        start(s, type, arg[1]);
        break;
      }
      case "snow":
        start(s, "snowstorm", arg[0]);
        break;
      case "hurricane":
        start(s, "hurricane", arg[0]);
        break;
      case "omega":
        start(s, "omega", arg[0]);
        break;
      case "level": {
        const storm = getStorm();
        if (!storm) { reply(s, "§cNo storm active. Start one first."); return; }
        start(s, storm.type, arg[0]);
        break;
      }
      case "next": {
        const storm = getStorm();
        if (!storm) { reply(s, "§cNo storm active. Start one first."); return; }
        const nextLevel = Math.min(4, storm.level + 1);
        start(s, storm.type, nextLevel);
        break;
      }
      case "clear":
        clearStorm();
        reply(s, "§aWeather cleared.");
        break;
      case "info": {
        const storm = getStorm();
        reply(s, storm
          ? `§bActive: ${storm.label} (Level ${storm.level}/4)`
          : "§7No storm active.");
        break;
      }
      case "warmth": {
        if (!s) { reply(s, "§cRun this as a player."); return; }
        const w = s.getDynamicProperty(DP.warmth);
        const val = typeof w === "number" ? Math.round(w) : MAX_WARMTH;
        reply(s, `§bWarmth: ${val}/${MAX_WARMTH}`);
        break;
      }
      case "demo":
        runDemo(s);
        break;
      case "help":
        reply(s, helpText());
        break;
      default:
        reply(s, "§cUnknown command. Try §e/scriptevent aw:help");
    }
  });
}
