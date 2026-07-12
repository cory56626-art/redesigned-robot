/**
 * Central tunables for Playable Dweller. Every "decide and document" number
 * from the design lives here so behavior can be retuned without hunting
 * through ability logic.
 */

export const TOTEM_ID = "dwl:totem";
export const ABILITY_SUPER_RUN_ID = "dwl:ability_super_run";
export const ABILITY_DECOY_ID = "dwl:ability_decoy";
export const ABILITY_BROADCAST_ID = "dwl:ability_broadcast";
export const ABILITY_ITEM_IDS = [ABILITY_SUPER_RUN_ID, ABILITY_DECOY_ID, ABILITY_BROADCAST_ID];

export const PUPPET_ID = "dwl:dweller_puppet";
export const DECOY_ID = "dwl:decoy";

const TPS = 20;
export const SEC = (s) => Math.round(s * TPS);

// ---- Passive Dweller buffs (acceptance test 8: extra speed & HP) ----------
export const DWELLER_SPEED_AMPLIFIER = 1; // Speed II, ~+40% base walk speed
export const DWELLER_HEALTH_BOOST_AMPLIFIER = 3; // Health Boost IV, +8 hearts
export const BUFF_REFRESH_INTERVAL_TICKS = SEC(5);
export const BUFF_EFFECT_DURATION_TICKS = SEC(7); // > refresh interval, never gaps

// ---- Totem / transform bookkeeping ----------------------------------------
export const TOTEM_PRESENCE_CHECK_INTERVAL_TICKS = SEC(1);
export const HUD_REFRESH_INTERVAL_TICKS = SEC(1);

// ---- Ability 1: Super Run ---------------------------------------------------
export const SUPER_RUN_DURATION_TICKS = SEC(10);
// Item minecraft:cooldown duration (30s) = run duration + this post-run lockout.
export const SUPER_RUN_COOLDOWN_AFTER_TICKS = SEC(20);
export const SUPER_RUN_SPEED_AMPLIFIER = 19; // ~5x walk speed (1 + 0.2*(amp+1))
export const SUPER_RUN_BREAK_SIDE_RADIUS = 1; // blocks either side of the path
export const SUPER_RUN_BREAK_AHEAD = 2; // blocks probed ahead of the feet
export const SUPER_RUN_BREAK_HEIGHT = 4; // tunnel height in blocks (feet..feet+3)
export const SUPER_RUN_BLOCK_BUDGET_PER_TICK = 6; // hard per-tick server load cap
export const SUPER_RUN_GRAB_RADIUS = 1.7; // "into or very near" a victim
export const HOLD_DURATION_TICKS = SEC(1.2);
export const THROW_HORIZONTAL_STRENGTH = 1.15; // blocks/tick, decays ~2% per tick
export const THROW_VERTICAL_STRENGTH = 1.85; // blocks/tick launch arc height

// ---- Ability 2: Decoy -------------------------------------------------------
export const DECOY_LIFETIME_TICKS = SEC(60);
export const DECOY_RECAST_COOLDOWN_TICKS = SEC(5);
export const DECOY_AI_INTERVAL_TICKS = 5;
export const DECOY_LOS_RADIUS = 24;
export const DECOY_HIGHLIGHT_DURATION_TICKS = SEC(7);
export const DECOY_AMBIENT_MIN_INTERVAL_TICKS = SEC(5);
export const DECOY_AMBIENT_MAX_INTERVAL_TICKS = SEC(15);
export const DECOY_SPRINT_CHANCE_PER_CHECK = 0.08;
export const DECOY_SPRINT_DURATION_TICKS = SEC(2);
export const DECOY_STARE_DOOR_RADIUS = 6;
export const DECOY_STARE_DURATION_TICKS = SEC(2.5);
export const DECOY_STARE_CHANCE_PER_CHECK = 0.05;

// ---- Ability 3: Horror Broadcast --------------------------------------------
export const BROADCAST_DURATION_TICKS = SEC(25);
export const BROADCAST_COOLDOWN_AFTER_TICKS = SEC(75);
// Item minecraft:cooldown duration (100s) = duration + this post-broadcast lockout.
export const BROADCAST_UPDATE_INTERVAL_TICKS = SEC(0.5);
export const BROADCAST_SPINE_TWIST_TICKS = SEC(1.2);

// ---- Misc -------------------------------------------------------------------
export const DYNPROP_PENDING_TOTEM_RETURN = "dwl:pending_totem_return";

/** Block types Super Run must never destroy, beyond the obvious structural ones. */
const UNBREAKABLE_EXACT = new Set([
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:end_portal_frame",
  "minecraft:end_gateway",
  "minecraft:light_block",
  "minecraft:moving_block",
  "minecraft:reinforced_deepslate",
  "minecraft:air",
  "minecraft:water",
  "minecraft:lava",
  "minecraft:bubble_column",
  "minecraft:beacon",
  "minecraft:spawner",
  "minecraft:ender_chest",
  "minecraft:hopper",
  "minecraft:dispenser",
  "minecraft:dropper",
  "minecraft:furnace",
  "minecraft:lit_furnace",
  "minecraft:blast_furnace",
  "minecraft:lit_blast_furnace",
  "minecraft:smoker",
  "minecraft:lit_smoker",
]);
// Substring matches so we don't have to enumerate every color/variant.
const UNBREAKABLE_SUBSTRINGS = [
  "command_block",
  "structure_block",
  "portal",
  "chest",
  "shulker_box",
  "flowing_",
];

export function isProtectedBlock(typeId) {
  if (UNBREAKABLE_EXACT.has(typeId)) return true;
  for (const s of UNBREAKABLE_SUBSTRINGS) {
    if (typeId.includes(s)) return true;
  }
  return false;
}
