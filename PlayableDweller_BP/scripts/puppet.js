import { system } from "@minecraft/server";
import * as CFG from "./config.js";

/**
 * Everything about the invisible-player-puppeteers-a-visible-mob technique
 * lives here so both transform.js and the ability modules can drive the
 * puppet's pose without creating a circular import between them.
 */

export function spawnPuppet(state) {
  const player = state.player;
  const puppet = player.dimension.spawnEntity(CFG.PUPPET_ID, player.location);
  puppet.nameTag = "";
  state.puppet = puppet;
  state.lastMoveState = "idle";
  state.lastActionState = "none";
  state.lastActionUntilTick = 0;
  return puppet;
}

export function despawnPuppet(state) {
  if (state.puppet) {
    try {
      if (state.puppet.isValid()) state.puppet.remove();
    } catch {
      /* already gone */
    }
    state.puppet = undefined;
  }
}

/** Called once per tick for every currently-transformed Dweller. */
export function tickPuppetSync(state, currentTick) {
  const player = state.player;
  if (!player || !player.isValid || !player.isValid()) return;
  if (!state.puppet || !state.puppet.isValid()) {
    spawnPuppet(state);
  }
  const puppet = state.puppet;
  const rot = player.getRotation();

  try {
    if (puppet.dimension.id !== player.dimension.id) {
      puppet.teleport(player.location, { dimension: player.dimension, rotation: rot });
    } else {
      puppet.teleport(player.location, { rotation: rot });
    }
  } catch {
    return;
  }

  const v = player.getVelocity();
  const speed = Math.sqrt(v.x * v.x + v.z * v.z);
  let moveState;
  if (state.phase === "super_run") {
    moveState = "sprint";
  } else if (speed < 0.02) {
    moveState = "idle";
  } else if (player.isSprinting || speed > 0.19) {
    moveState = "sprint";
  } else {
    moveState = "walk";
  }
  if (moveState !== state.lastMoveState) {
    state.lastMoveState = moveState;
    try {
      puppet.setProperty("dwl:move_state", moveState);
    } catch {
      /* puppet mid-despawn */
    }
  }

  if (state.lastActionState !== "none" && currentTick >= state.lastActionUntilTick) {
    setPuppetAction(state, "none", 0);
  }
}

/** Plays a one-shot/held action pose (grab, spine_twist) on top of locomotion. */
export function setPuppetAction(state, actionState, holdTicks) {
  state.lastActionState = actionState;
  state.lastActionUntilTick = system.currentTick + holdTicks;
  if (state.puppet && state.puppet.isValid()) {
    try {
      state.puppet.setProperty("dwl:action_state", actionState);
    } catch {
      /* puppet mid-despawn */
    }
  }
}
