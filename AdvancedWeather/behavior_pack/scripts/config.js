// config.js — tunable parameters for the Advanced Weather System.
// All gameplay numbers live here so the storm logic stays readable.

export const TICKS_PER_SECOND = 20;

// How often the main weather loop runs (in ticks). 20 = once per second.
export const LOOP_TICKS = 20;

// Horizontal radius (blocks) snow covers around each player. EVERY storm and
// level uses this single maxed-out radius — the whole disc is buried at once
// when the storm hits (see accumulation.js / system.runJob), not over time.
// 110 covers a 220-block-wide area; columns in unloaded chunks are skipped.
export const MAX_ACCUMULATION_RADIUS = 110;

// How often (in main-loop seconds) the full-area snow coverage re-runs, so it
// follows players as they move and catches newly loaded chunks.
export const COVERAGE_REFRESH_SECONDS = 8;

// Per-level snow behaviour.
//   depth      : how many blocks deep snow piles on every column (0 = none).
//   caveDepth  : how deep below the surface to bury cave pockets (0 = none).
//   caveChance : per-column probability of attempting a cave fill.
export const ACCUMULATION_TUNING = {
  1: { depth: 0, caveDepth: 0, caveChance: 0 },
  2: { depth: 1, caveDepth: 0, caveChance: 0 },
  3: { depth: 3, caveDepth: 10, caveChance: 0.35 },
  4: { depth: 6, caveDepth: 20, caveChance: 0.7 },
};

// Storm definitions. Each storm has 4 levels (1..4).
// freezePerSec: warmth lost per second while exposed (snow/omega only).
// thawPerSec: warmth gained per second while sheltered or warm.
// damagePerSec: damage applied per second once warmth hits 0 (frostbite).
// wind: horizontal knockback strength applied to exposed entities.
// fog: id of the fog definition (resource pack) pushed via /fog.
// durationSec: [min, max] real-time length; a random value in range is rolled
//   when the storm starts, after which it fades on its own.
export const STORMS = {
  snowstorm: {
    label: "Snowstorm",
    levels: {
      // L1: calm winter. No freezing, just snow & light fog.
      1: { freezePerSec: 0, thawPerSec: 8, damagePerSec: 0, wind: 0,
           fog: "aw:snow_1", lightning: false, weather: "snow",
           durationSec: [360, 600] },
      // L2: real cold. Warmth drains in ~9s exposed, then frostbite + slowdown.
      2: { freezePerSec: 11, thawPerSec: 5, damagePerSec: 2, wind: 0.2,
           fog: "aw:snow_2", lightning: false, weather: "snow",
           durationSec: [300, 480] },
      // L3: brutal. Warmth gone in ~4s; snow starts burying caves & doorways.
      3: { freezePerSec: 24, thawPerSec: 4, damagePerSec: 5, wind: 0.6,
           fog: "aw:snow_3", lightning: false, weather: "snow",
           durationSec: [240, 360] },
      // L4: Fimbulwinter. Death within seconds outside; everything buries.
      4: { freezePerSec: 60, thawPerSec: 3, damagePerSec: 12, wind: 1.0,
           fog: "aw:snow_4", lightning: false, weather: "snow",
           durationSec: [180, 300] },
    },
  },
  hurricane: {
    label: "Hurricane",
    levels: {
      1: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 0, wind: 0.4,
           fog: "aw:wind_1", lightning: false, weather: "rain",
           durationSec: [240, 420] },
      2: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 0, wind: 0.9,
           fog: "aw:wind_2", lightning: false, weather: "rain",
           durationSec: [240, 360] },
      3: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 1, wind: 1.4,
           fog: "aw:wind_3", lightning: true, weather: "thunder",
           durationSec: [180, 300] },
      4: { freezePerSec: 0, thawPerSec: 0, damagePerSec: 3, wind: 2.3,
           fog: "aw:wind_4", lightning: true, weather: "thunder",
           durationSec: [120, 240] },
    },
  },
  omega: {
    // Omega = snowstorm + hurricane combined, scaled up.
    label: "Omega Storm",
    levels: {
      1: { freezePerSec: 11, thawPerSec: 5, damagePerSec: 2, wind: 0.6,
           fog: "aw:omega_1", lightning: false, weather: "thunder",
           durationSec: [180, 360] },
      2: { freezePerSec: 22, thawPerSec: 4, damagePerSec: 4, wind: 1.2,
           fog: "aw:omega_2", lightning: true, weather: "thunder",
           durationSec: [180, 300] },
      3: { freezePerSec: 40, thawPerSec: 3, damagePerSec: 7, wind: 1.9,
           fog: "aw:omega_3", lightning: true, weather: "thunder",
           durationSec: [150, 240] },
      4: { freezePerSec: 75, thawPerSec: 2, damagePerSec: 15, wind: 2.8,
           fog: "aw:omega_4", lightning: true, weather: "thunder",
           durationSec: [120, 210] },
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
// Deliberately ONLY strong heat — a torch or lantern is not enough to keep you
// warm in a blizzard, so base lighting no longer cancels the freeze.
export const HEAT_BLOCKS = new Set([
  "minecraft:fire", "minecraft:soul_fire", "minecraft:lava",
  "minecraft:flowing_lava", "minecraft:campfire", "minecraft:soul_campfire",
  "minecraft:lit_furnace", "minecraft:lit_blast_furnace", "minecraft:lit_smoker",
  "minecraft:magma",
]);
export const HEAT_RADIUS = 3;

// How far up we scan to decide if a player is exposed to the open sky.
export const SKY_SCAN_HEIGHT = 64;

// Dynamic property keys.
export const DP = {
  type: "aw:type",       // current storm type ("snowstorm"|"hurricane"|"omega"|"")
  level: "aw:level",     // current level (0 = clear)
  warmth: "aw:warmth",   // per-player remaining warmth
  endTick: "aw:endTick", // system tick at which the storm fades (0 = never)
};
