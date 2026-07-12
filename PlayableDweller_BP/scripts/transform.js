import { EquipmentSlot, ItemStack } from "@minecraft/server";
import * as CFG from "./config.js";
import { getState } from "./state.js";
import { spawnPuppet, despawnPuppet } from "./puppet.js";
import { forceEndSuperRun } from "./abilities/superRun.js";
import { removeDecoy } from "./abilities/decoy.js";
import { forceEndBroadcast } from "./abilities/broadcast.js";

function container(player) {
  return player.getComponent("minecraft:inventory")?.container;
}

export function hasTotem(player) {
  const c = container(player);
  if (c) {
    for (let i = 0; i < c.size; i++) {
      const item = c.getItem(i);
      if (item && item.typeId === CFG.TOTEM_ID) return true;
    }
  }
  const equip = player.getComponent("minecraft:equippable");
  if (equip) {
    const off = equip.getEquipment(EquipmentSlot.Offhand);
    if (off && off.typeId === CFG.TOTEM_ID) return true;
  }
  return false;
}

function grantAbilityItems(player) {
  const c = container(player);
  if (!c) return;
  for (const id of CFG.ABILITY_ITEM_IDS) {
    const leftover = c.addItem(new ItemStack(id, 1));
    if (leftover) {
      // Inventory was completely full - don't silently eat the ability.
      player.dimension.spawnItem(leftover, player.location);
    }
  }
}

export function removeAbilityItems(player) {
  const c = container(player);
  if (!c) return;
  for (let i = 0; i < c.size; i++) {
    const item = c.getItem(i);
    if (item && CFG.ABILITY_ITEM_IDS.includes(item.typeId)) {
      c.setItem(i, undefined);
    }
  }
}

/**
 * Invisibility on the REAL player is what makes the puppet technique work:
 * it hides the player's actual skin + nametag from everyone (including
 * their own third-person camera), while the separately-rendered puppet -
 * unaffected by an effect applied to a different entity - is what shows up
 * in that exact spot instead. Without this, survivors would see both the
 * player's real skin AND the puppet overlapping. Refreshed on the same
 * cadence as the passive speed/health boost so it never visibly lapses.
 */
function applyBuffs(player) {
  player.addEffect("invisibility", CFG.BUFF_EFFECT_DURATION_TICKS, {
    showParticles: false,
  });
  player.addEffect("speed", CFG.BUFF_EFFECT_DURATION_TICKS, {
    amplifier: CFG.DWELLER_SPEED_AMPLIFIER,
    showParticles: false,
  });
  player.addEffect("health_boost", CFG.BUFF_EFFECT_DURATION_TICKS, {
    amplifier: CFG.DWELLER_HEALTH_BOOST_AMPLIFIER,
    showParticles: false,
  });
}

function clearBuffs(player) {
  try {
    player.removeEffect("invisibility");
  } catch {
    /* player may already be gone */
  }
  try {
    player.removeEffect("speed");
  } catch {
    /* player may already be gone */
  }
  try {
    player.removeEffect("health_boost");
  } catch {
    /* player may already be gone */
  }
}

export function transformPlayer(player) {
  const state = getState(player);
  if (state.transformed) return;

  state.transformed = true;
  state.phase = "idle";
  spawnPuppet(state);
  grantAbilityItems(player);
  applyBuffs(player);

  player.onScreenDisplay.setTitle("§4§lTHE DWELLER", {
    subtitle: "§7You have become the hunter.",
    fadeInDuration: 8,
    stayDuration: 40,
    fadeOutDuration: 16,
  });
}

/**
 * Reverts a Dweller back to a normal survivor, cleanly tearing down every
 * subsystem regardless of why the revert happened (manual toggle, death,
 * lost totem, or disconnect).
 */
export function revertPlayer(state, { silent = false } = {}) {
  if (!state.transformed) return;
  state.transformed = false;
  state.phase = "idle";

  // Cancel any in-flight ability before anything else so victims/timers
  // don't outlive the transformation.
  forceEndSuperRun(state);
  forceEndBroadcast(state);
  removeDecoy(state);
  despawnPuppet(state);

  const player = state.player;
  const stillHere = player && player.isValid && player.isValid();
  if (stillHere) {
    removeAbilityItems(player);
    clearBuffs(player);
    if (!silent) {
      player.onScreenDisplay.setActionBar("§7You feel human again.");
    }
  }
}

/** Every ~1s: a transformed Dweller who no longer holds a Totem reverts. */
export function checkTotemPresence(state) {
  const player = state.player;
  if (!player || !player.isValid || !player.isValid()) return;
  if (!hasTotem(player)) {
    revertPlayer(state);
    try {
      player.onScreenDisplay.setActionBar("§7The Totem is gone. You are yourself again.");
    } catch {
      /* ignore */
    }
  }
}

/** Every ~5s: keep the passive speed/health boost topped up. */
export function refreshBuffs(state) {
  const player = state.player;
  if (!player || !player.isValid || !player.isValid()) return;
  applyBuffs(player);
}

/** Every ~1s: subtle status line only the Dweller themselves can see. */
export function updateHud(state, currentTick) {
  const player = state.player;
  if (!player || !player.isValid || !player.isValid()) return;

  const fmt = (readyAtTick, label) => {
    if (currentTick >= readyAtTick) return `§a${label}: Ready`;
    const secs = Math.max(0, Math.ceil((readyAtTick - currentTick) / 20));
    return `§8${label}: ${secs}s`;
  };

  const line =
    `§4§lTHE DWELLER  §r` +
    `${fmt(state.superRunReadyAtTick, "Run")}  ` +
    `${fmt(state.decoyReadyAtTick, "Decoy")}  ` +
    `${fmt(state.broadcastReadyAtTick, "Broadcast")}`;
  try {
    player.onScreenDisplay.setActionBar(line);
  } catch {
    /* ignore */
  }
}
