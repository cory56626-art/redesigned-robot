// Summoner Realms — global tuning constants.
// Central place for numbers so gameplay is easy to tune.

// Single build stamp for every cache-busted module import. Bump this once per
// release instead of editing per-module `?build=` strings (which drifted out of
// sync and could ship a half-updated module graph).
export const BUILD = 'prehardmode-ores-1';

// Release identity, surfaced on the main menu and in Claude's Notes.
export const VERSION = '4.1';
export const VERSION_TITLE = 'Quality of Realms';

export const WORLD_DIFFICULTIES = Object.freeze([
  { key: 'normal', label: 'Normal', tier: 'Buffed baseline', hint: 'Enemies are tougher than the old baseline, but attacks stay readable.' },
  { key: 'hard', label: 'Hard', tier: 'Aggressive patterns', hint: 'Enemies hit harder and move more aggressively.' },
  { key: 'master', label: 'Master', tier: 'Punishing mastery', hint: 'Denser enemy pressure and tighter attack windows.' },
  { key: 'masochist', label: 'Masochist', tier: 'Brutal but clearable', hint: 'The highest hostile pressure for a demanding pre-Hardmode run.' },
]);

export function normalizeDifficulty(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return WORLD_DIFFICULTIES.some(d => d.key === key) ? key : 'normal';
}
export function difficultyForIndex(index) {
  const i = Math.max(0, Math.min(WORLD_DIFFICULTIES.length - 1, Number(index) || 0));
  return WORLD_DIFFICULTIES[i];
}
export function difficultyInfo(value) {
  const key = normalizeDifficulty(value);
  return WORLD_DIFFICULTIES.find(d => d.key === key) || WORLD_DIFFICULTIES[0];
}

// Enemy pressure rises with the world mode, but the curve is deliberately
// gentler than boss HP scaling so the opening biome remains playable.
export const ENEMY_DIFFICULTY_TUNING = Object.freeze({
  normal: {
    hp: 1.08, damage: 1.08, speed: 1.03, projectile: 1.04, cooldown: 0.96,
    telegraph: 1.00, aggro: 1.04, memory: 1.05,
    spawnInterval: 3.40, spawnChance: 0.50, globalCapBonus: 0, localCapBonus: 0,
  },
  hard: {
    hp: 1.16, damage: 1.16, speed: 1.06, projectile: 1.09, cooldown: 0.91,
    telegraph: 0.96, aggro: 1.08, memory: 1.10,
    spawnInterval: 3.20, spawnChance: 0.54, globalCapBonus: 1, localCapBonus: 1,
  },
  master: {
    hp: 1.26, damage: 1.26, speed: 1.09, projectile: 1.14, cooldown: 0.86,
    telegraph: 0.92, aggro: 1.12, memory: 1.16,
    spawnInterval: 3.00, spawnChance: 0.58, globalCapBonus: 2, localCapBonus: 1,
  },
  masochist: {
    hp: 1.38, damage: 1.36, speed: 1.12, projectile: 1.19, cooldown: 0.81,
    telegraph: 0.88, aggro: 1.16, memory: 1.22,
    spawnInterval: 2.80, spawnChance: 0.62, globalCapBonus: 3, localCapBonus: 2,
  },
});

export const TILE = 16; // world pixels per tile

export const WORLD_W = 700; // tiles wide
export const WORLD_H = 260; // tiles tall

// Vertical layout of the generated world (in tiles).
export const SURFACE_Y = 78;      // average surface height
export const UNDERGROUND_Y = 112; // below this depth counts as the Underground biome
export const CAVERN_Y = 175;      // deep caverns (tougher spawns, deepstone)

// Physics (units are world-pixels and seconds).
export const GRAVITY = 1500;
export const MAX_FALL = 900;
export const MOVE_SPEED = 150;
export const JUMP_VELOCITY = 430;
export const PLAYER_W = 12;
export const PLAYER_H = 26;

// Simulation.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// Day / night cycle (seconds for a full cycle).
export const DAY_LENGTH = 180; // 3 minutes per full day/night loop

// Combat / entity caps for smoothness.
export const MAX_ENEMIES = 40;
export const MAX_PROJECTILES = 250;
export const MAX_PARTICLES = 600;
export const MAX_DROPS = 200;
export const MAX_THROWN = 40;

// Mining reach in tiles.
export const REACH = 6;

// Inventory sizes.
export const HOTBAR_SIZE = 10;
export const INV_ROWS = 4;      // additional inventory rows beyond hotbar
export const INV_COLS = 10;
export const ACCESSORY_SLOTS = 3;

// Networking.
export const NET_SNAPSHOT_HZ = 15; // authoritative snapshots per second
export const NET_INPUT_HZ = 30;    // client input sends per second

// Player base stats.
export const BASE_HP = 100;
export const BASE_MANA = 60;       // "Aether"
export const MANA_REGEN = 6;       // per second (idle)
export const HP_REGEN = 1.5;       // per second out of combat

// ---- Cooldowns (seconds). One place to tune resource pacing. ----
// Healing / consumable cooldowns. A single healing item triggers a shared
// cooldown that cannot be bypassed by clicking fast, switching slots, or dying.
export const HEAL_COOLDOWN = 9;        // after any HP-restoring item
export const MANA_POTION_COOLDOWN = 7; // after any Aether-restoring item
export const POTION_BUFF_COOLDOWN = 3; // after a buff potion
// Mana regen is throttled briefly after each cast so magic has real upkeep.
export const CAST_REGEN_DELAY = 1.4;   // seconds of throttled regen after a cast
export const CAST_REGEN_MULT = 0.2;    // regen multiplier during that window

// ---- Death / respawn ----
// Dying during a boss fight costs real time, so you can't trade your life for a
// free reset. Bosses despawn on death, so the fight must be re-summoned.
export const RESPAWN_DELAY = 3;        // normal death
export const RESPAWN_DELAY_BOSS = 12;  // a boss was active when you died

export const SAVE_PREFIX = 'summonerRealms.save.';
export const SAVE_INDEX_KEY = 'summonerRealms.saves';
export const SETTINGS_KEY = 'summonerRealms.settings';
export const AUTOSAVE_INTERVAL = 30; // seconds
export const SAVE_VERSION = 4;
// Width of the v1 world, needed to decode legacy flat-index tile diffs.
export const LEGACY_WORLD_W = 420;

// ---- Characters (4.1) ----
// Characters are saved separately from worlds, Terraria-style: a character
// carries its own appearance, inventory, equipment and achievements, and can be
// taken into any world. World saves keep only world state.
export const CHAR_PREFIX = 'summonerRealms.char.';
export const CHAR_INDEX_KEY = 'summonerRealms.characters';
export const CHAR_VERSION = 1;
export const LAST_CHAR_KEY = 'summonerRealms.lastCharacter';

// Rendering: target number of tiles visible vertically (drives zoom).
export const TARGET_TILES_V = 22;
// Player-adjustable zoom multiplier on top of that (Terraria-style).
// Larger zoom = fewer tiles on screen = closer in.
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.0;
export const ZOOM_DEFAULT = 1.0;
export const ZOOM_STEP = 0.1;

// ---- Wind / weather (4.1) ----
// Wind blows from one side only and is re-rolled on a slow cadence. It sways
// foliage and applies a deliberately mild drag to surface movement; it never
// reaches underground.
export const WIND_MIN_INTERVAL = 22;   // seconds before the wind may change again
export const WIND_MAX_INTERVAL = 70;
export const WIND_SHIFT_TIME = 6;      // seconds to ease from one state to the next
export const WIND_GUST_RATE = 0.23;    // gust oscillation speed
export const WIND_GUST_AMOUNT = 0.22;  // how much of the strength a gust can add
// Fraction of MOVE_SPEED a full gale can push the player by. Kept small on
// purpose: strong enough to feel, never strong enough to fight.
export const WIND_PLAYER_PUSH = 0.12;
// Tiles below the surface line at which wind has fully died away.
export const WIND_DEPTH_FADE = 6;

// ---- Liquids (4.1) ----
// Water is stored as a per-tile level 0..LIQUID_MAX and simulated with an
// active set, so a settled world costs nothing per frame.
export const LIQUID_MAX = 8;
export const LIQUID_TICK = 1 / 12;     // seconds between flow updates
export const LIQUID_BUDGET = 3000;     // max cells processed per flow update
export const SWIM_GRAVITY = 0.28;      // gravity multiplier while submerged
export const SWIM_MAX_FALL = 110;      // terminal velocity in water
export const SWIM_DRAG = 0.62;         // horizontal speed multiplier in water
export const SWIM_STROKE = 150;        // upward impulse from jumping in water

// ---- Fishing (4.1) ----
export const FISH_MIN_WAIT = 3.0;      // seconds before the earliest possible bite
export const FISH_MAX_WAIT = 16.0;
export const FISH_HOOK_WINDOW = 0.9;   // seconds to react once the bobber dips
export const FISH_MIN_POOL = 12;       // water tiles needed around the bobber
