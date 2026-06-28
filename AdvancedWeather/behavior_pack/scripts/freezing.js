// freezing.js — the warmth/freezing meter for snow & omega storms.
import { EntityDamageCause } from "@minecraft/server";
import { DP, MAX_WARMTH, LOOP_TICKS } from "./config.js";
import { clamp, isExposedToSky, isNearHeat, bar } from "./util.js";

const SECONDS_PER_LOOP = LOOP_TICKS / 20;

// Read a player's current warmth, defaulting to full.
function getWarmth(player) {
  const v = player.getDynamicProperty(DP.warmth);
  return typeof v === "number" ? v : MAX_WARMTH;
}

function setWarmth(player, value) {
  player.setDynamicProperty(DP.warmth, clamp(value, 0, MAX_WARMTH));
}

// Reset a player's warmth to full (used when a storm ends).
export function resetWarmth(player) {
  setWarmth(player, MAX_WARMTH);
}

const EFFECT_TICKS = LOOP_TICKS + 10;

function addEffect(player, type, amplifier) {
  try {
    player.addEffect(type, EFFECT_TICKS, { amplifier, showParticles: false });
  } catch { /* invalid effect on this version */ }
}

// Apply one tick of freezing logic for a single player.
// `def` is the active storm-level definition; `level` is 1..4. Returns nothing.
export function updateFreezing(player, def, level = 1) {
  // Storms with no freeze component just keep players topped up.
  if (def.freezePerSec <= 0) {
    setWarmth(player, MAX_WARMTH);
    return;
  }

  let warmth = getWarmth(player);
  const exposed = isExposedToSky(player);
  const warm = isNearHeat(player);

  if (exposed && !warm) {
    warmth -= def.freezePerSec * SECONDS_PER_LOOP;
  } else {
    warmth += def.thawPerSec * SECONDS_PER_LOOP;
  }
  warmth = clamp(warmth, 0, MAX_WARMTH);
  setWarmth(player, warmth);

  const fraction = warmth / MAX_WARMTH;

  // While exposed and cold, the storm itself bites — escalating debuffs by
  // level even before warmth hits zero, so high levels feel brutal immediately.
  if (exposed && !warm && fraction < 0.6) {
    addEffect(player, "slowness", Math.min(3, level - 1));     // L2:1 L3:2 L4:3
    if (level >= 3) addEffect(player, "mining_fatigue", level - 2); // L3:1 L4:2
    if (level >= 4) addEffect(player, "weakness", 1);
  }

  // Frostbite: once warmth is gone, take damage and seize up hard.
  if (warmth <= 0) {
    if (def.damagePerSec > 0) {
      const dmg = Math.max(1, Math.round(def.damagePerSec * SECONDS_PER_LOOP));
      try {
        player.applyDamage(dmg, { cause: EntityDamageCause.freezing });
      } catch { /* dead / invalid */ }
    }
    addEffect(player, "slowness", Math.min(4, level + 1));
    addEffect(player, "weakness", 2);
    if (level >= 4) addEffect(player, "mining_fatigue", 3);
  }

  // Only show the meter while the player is actually losing/regaining warmth
  // in a storm — i.e. not permanently full.
  if (warmth < MAX_WARMTH || exposed) {
    showMeter(player, fraction, exposed && !warm);
  }
}

function showMeter(player, fraction, losing) {
  const icon = losing ? "§b❄" : "§e☀";
  const color = fraction > 0.5 ? "§a" : fraction > 0.25 ? "§e" : "§c";
  const pct = Math.round(fraction * 100);
  player.onScreenDisplay.setActionBar(
    `${icon} §fWarmth ${color}${bar(fraction)} ${pct}%`
  );
}
