// config.js — tunable parameters for the Advanced Weather System.
// All gameplay numbers live here so the storm logic stays readable.

export const TICKS_PER_SECOND = 20;

// How often the main weather loop runs (in ticks). 20 = once per second.
export const LOOP_TICKS = 20;

// How often heavy world edits (snow accumulation) run, in main-loop iterations.
// 4 means "every 4 seconds" when LOOP_TICKS is 20.
export const ACCUMULATION_EVERY = 4;

// Max block writes per player per accumulation pass (performance guard).
export const MAX_BLOCKS_PER_PASS = {
  1: 0,
  2: 0,
  3: 24,
  4: 80,
};

// Horizontal radius around each player that snow accumulation/cave-fill scans.
export const ACCUMULATION_RADIUS = {
  3: 4,
  4: 7,
};

// Storm definitions. Each storm has 4 levels (1..4).
// freezePerSec: warmth lost per second while exposed (snow/omega only).
// thawPerSec: warmth gained per second while sheltered or warm.
// damagePerSec: damage applied per second once warmth hits 0 (frostbite).
// wind: horizontal knockback strength applied to exposed entities.
// fog: id of the fog definition (resource pack) pushed via /fog.
export const STORMS = {
  snowstorm: {
    label: "Snowstorm",
    levels: {
      1: { freezePerSec: 0, thawPerSec: 6, damagePerSec: 0, wind: 0,
           fog: "aw:snow_1", lightning: false, weather: "snow" },
      2: { freezePerSec: 6, thawPerSec: 8, damagePerSec: 1, wind: 0,
           fog: "aw:snow_2", lightning: false, weather: "snow" },
      3: { freezePerSec: 14, thawPerSec: 6, damagePerSec: 2, wind: 0.4,
           fog: "aw:snow_3", lightning: false, weather: "snow" },
      4: { freezePerSec: 34, thawPerSec: 4, damagePerSec: 6, wind: 0.7,
           fog: "aw:snow_4", lightning: false, weather: "snow" },
    },
  },
  hurricane: {
    label: "Hurricane",
    levels: {
      1: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 0, wind: 0.3,
           fog: "aw:wind_1", lightning: false, weather: "rain" },
      2: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 0, wind: 0.7,
           fog: "aw:wind_2", lightning: false, weather: "rain" },
      3: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 1, wind: 1.2,
           fog: "aw:wind_3", lightning: true, weather: "thunder" },
      4: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 3, wind: 2.0,
           fog: "aw:wind_4", lightning: true, weather: "thunder" },
    },
  },
  omega: {
    // Omega = snowstorm + hurricane combined, scaled up.
    label: "Omega Storm",
    levels: {
      1: { freezePerSec: 6, thawPerSec: 6, damagePerSec: 1, wind: 0.5,
           fog: "aw:omega_1", lightning: false, weather: "thunder" },
      2: { freezePerSec: 14, thawPerSec: 5, damagePerSec: 2, wind: 1.0,
           fog: "aw:omega_2", lightning: true, weather: "thunder" },
      3: { freezePerSec: 26, thawPerSec: 4, damagePerSec: 4, wind: 1.6,
           fog: "aw:omega_3", lightning: true, weather: "thunder" },
      4: { freezePerSec: 50, thawPerSec: 3, damagePerSec: 10, wind: 2.6,
           fog: "aw:omega_4", lightning: true, weather: "thunder" },
    },
  },
};

// Snow accumulation applies to these storms only.
export const SNOW_STORMS = new Set(["snowstorm", "omega"]);
// Wind applies to these storms only.
export const WIND_STORMS = new Set(["hurricane", "omega"]);

// Warmth bar starts full at this value.
export const MAX_WARMTH = 100;

// Block ids treated as warmth sources within HEAT_RADIUS of the player.
export const HEAT_BLOCKS = new Set([
  "minecraft:fire", "minecraft:soul_fire", "minecraft:lava",
  "minecraft:flowing_lava", "minecraft:campfire", "minecraft:soul_campfire",
  "minecraft:lit_furnace", "minecraft:lit_blast_furnace", "minecraft:lit_smoker",
  "minecraft:torch", "minecraft:lantern", "minecraft:magma",
  "minecraft:glowstone", "minecraft:lit_pumpkin",
]);
export const HEAT_RADIUS = 4;

// How far up we scan to decide if a player is exposed to the open sky.
export const SKY_SCAN_HEIGHT = 64;

// Dynamic property keys.
export const DP = {
  type: "aw:type",     // current storm type ("snowstorm"|"hurricane"|"omega"|"")
  level: "aw:level",   // current level (0 = clear)
  warmth: "aw:warmth", // per-player remaining warmth
};
