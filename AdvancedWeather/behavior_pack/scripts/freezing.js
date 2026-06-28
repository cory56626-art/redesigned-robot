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

// Apply one tick of freezing logic for a single player.
// `def` is the active storm-level definition. Returns nothing.
export function updateFreezing(player, def) {
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

  // Frostbite: once warmth is gone, take damage and slow down.
  if (warmth <= 0) {
    if (def.damagePerSec > 0) {
      const dmg = Math.max(1, Math.round(def.damagePerSec * SECONDS_PER_LOOP));
      try {
        player.applyDamage(dmg, { cause: EntityDamageCause.freezing });
      } catch { /* dead / invalid */ }
    }
    player.addEffect("slowness", LOOP_TICKS + 5, { amplifier: 2, showParticles: false });
    player.addEffect("weakness", LOOP_TICKS + 5, { amplifier: 1, showParticles: false });
  } else if (fraction < 0.35) {
    // Getting dangerously cold: mild slowdown.
    player.addEffect("slowness", LOOP_TICKS + 5, { amplifier: 0, showParticles: false });
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
