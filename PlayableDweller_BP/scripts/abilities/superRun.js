import { Player, GameMode } from "@minecraft/server";
import * as CFG from "../config.js";
import { peekState } from "../state.js";
import { directionFromYaw } from "../util/mathUtil.js";
import { setPuppetAction } from "../puppet.js";

/**
 * Ability 1 - Super Run. ~5x speed for a fixed duration, budgeted tunnel
 * carving along the path, and a collision-grab -> brief hold -> ~50 block
 * arc throw. See README "Super Run" section for the full design writeup
 * (unbreakable list, no-drop policy, fall-damage decision, edge cases).
 */

export function startSuperRun(state, currentTick) {
  const player = state.player;
  state.phase = "super_run";
  state.superRun = { endsAtTick: currentTick + CFG.SUPER_RUN_DURATION_TICKS };
  state.superRunReadyAtTick =
    currentTick + CFG.SUPER_RUN_DURATION_TICKS + CFG.SUPER_RUN_COOLDOWN_AFTER_TICKS;
  player.addEffect("speed", CFG.SUPER_RUN_DURATION_TICKS + 5, {
    amplifier: CFG.SUPER_RUN_SPEED_AMPLIFIER,
    showParticles: false,
  });
}

/** Dispatched every tick by main.js for any Dweller mid-run or mid-grab. */
export function tickSuperRun(state, currentTick) {
  if (state.phase === "super_run") {
    const player = state.player;
    if (!player || !player.isValid || !player.isValid()) {
      forceEndSuperRun(state);
      return;
    }
    if (currentTick >= state.superRun.endsAtTick) {
      endSuperRunNaturally(state);
      return;
    }
    breakPathAhead(player);
    const victim = findGrabVictim(player, state);
    if (victim) beginHold(state, player, victim, currentTick);
  } else if (state.phase === "grabbing") {
    tickHold(state, currentTick);
  }
}

function endSuperRunNaturally(state) {
  state.phase = "idle";
  state.superRun = null;
  // Speed effect's own duration already matches the run length, so it
  // expires on its own; the passive Dweller speed buff resumes on the
  // next periodic refresh (within BUFF_REFRESH_INTERVAL_TICKS).
}

/** Carves a small, budgeted tunnel in the Dweller's current direction of travel. */
function breakPathAhead(player) {
  const v = player.getVelocity();
  let dirX = v.x;
  let dirZ = v.z;
  if (Math.sqrt(dirX * dirX + dirZ * dirZ) < 0.02) {
    const view = player.getViewDirection();
    dirX = view.x;
    dirZ = view.z;
  }
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
  dirX /= len;
  dirZ /= len;
  const perpX = -dirZ;
  const perpZ = dirX;

  const feet = player.location;
  const dim = player.dimension;
  const baseX = feet.x;
  const baseY = Math.floor(feet.y);
  const baseZ = feet.z;

  let budget = CFG.SUPER_RUN_BLOCK_BUDGET_PER_TICK;
  for (let ahead = 0; ahead <= CFG.SUPER_RUN_BREAK_AHEAD && budget > 0; ahead++) {
    for (
      let side = -CFG.SUPER_RUN_BREAK_SIDE_RADIUS;
      side <= CFG.SUPER_RUN_BREAK_SIDE_RADIUS && budget > 0;
      side++
    ) {
      const bx = Math.floor(baseX + dirX * ahead + perpX * side);
      const bz = Math.floor(baseZ + dirZ * ahead + perpZ * side);
      for (let h = 0; h < CFG.SUPER_RUN_BREAK_HEIGHT && budget > 0; h++) {
        const by = baseY + h;
        let block;
        try {
          block = dim.getBlock({ x: bx, y: by, z: bz });
        } catch {
          continue;
        }
        if (!block) continue;
        const typeId = block.typeId;
        if (typeId === "minecraft:air") continue;
        if (CFG.isProtectedBlock(typeId)) continue;
        // No drops by design: keeps this from becoming a resource farm and
        // avoids spawning a pile of item entities while charging (perf).
        try {
          block.setType("minecraft:air");
        } catch {
          continue;
        }
        budget--;
      }
    }
  }
}

function findGrabVictim(player, state) {
  let nearby;
  try {
    nearby = player.dimension.getEntities({
      location: player.location,
      maxDistance: CFG.SUPER_RUN_GRAB_RADIUS,
    });
  } catch {
    return undefined;
  }
  for (const e of nearby) {
    if (!e || e.id === player.id) continue;
    if (e.typeId && e.typeId.startsWith("dwl:")) continue; // never our own puppets/decoys
    if (e instanceof Player) {
      const otherState = peekState(e.id);
      if (otherState && otherState.transformed) continue; // two Dwellers just collide, no grab
      const mode = e.getGameMode();
      if (mode === GameMode.creative || mode === GameMode.spectator) continue;
    } else if (!e.getComponent("minecraft:health")) {
      continue; // only living things are worth grabbing
    }
    return e;
  }
  return undefined;
}

function beginHold(state, player, victim, currentTick) {
  state.phase = "grabbing";
  state.superRun = null;
  try {
    player.removeEffect("speed");
  } catch {
    /* ignore */
  }
  // Restore the passive (non-burst) Dweller speed immediately so movement
  // doesn't feel like it suddenly dropped to normal-human pace mid-scene.
  try {
    player.addEffect("speed", CFG.BUFF_EFFECT_DURATION_TICKS, {
      amplifier: CFG.DWELLER_SPEED_AMPLIFIER,
      showParticles: false,
    });
  } catch {
    /* ignore */
  }
  const isPlayer = victim instanceof Player;
  state.hold = { victim, isPlayer, releaseAtTick: currentTick + CFG.HOLD_DURATION_TICKS };
  setPuppetAction(state, "grab", CFG.HOLD_DURATION_TICKS + 10);
}

function tickHold(state, currentTick) {
  const player = state.player;
  const hold = state.hold;
  if (!hold || !player || !player.isValid || !player.isValid()) {
    endHold(state);
    return;
  }

  let victimValid = false;
  try {
    victimValid = !!hold.victim && hold.victim.isValid();
  } catch {
    victimValid = false;
  }
  if (!victimValid) {
    // Victim disconnected/died/unloaded mid-hold - release cleanly, no throw.
    endHold(state);
    return;
  }

  if (currentTick >= hold.releaseAtTick) {
    throwVictim(player, hold.victim, hold.isPlayer);
    endHold(state);
    return;
  }

  const rot = player.getRotation();
  const dir = directionFromYaw(rot.y);
  const holdPos = {
    x: player.location.x + dir.x * 1.4,
    y: player.location.y + 1.0,
    z: player.location.z + dir.z * 1.4,
  };
  try {
    hold.victim.teleport(holdPos, { rotation: { x: 0, y: rot.y + 180 } });
  } catch {
    endHold(state);
  }
}

function throwVictim(player, victim, isPlayer) {
  const rot = player.getRotation();
  const dir = directionFromYaw(rot.y);
  if (isPlayer) {
    // Players and non-player entities take different velocity APIs on
    // Bedrock: Player only reliably supports applyKnockback.
    try {
      victim.applyKnockback(
        dir.x,
        dir.z,
        CFG.THROW_HORIZONTAL_STRENGTH,
        CFG.THROW_VERTICAL_STRENGTH
      );
    } catch {
      /* victim may have just left */
    }
  } else {
    // Non-player entities support the more precise 3D applyImpulse.
    try {
      victim.clearVelocity();
      victim.applyImpulse({
        x: dir.x * CFG.THROW_HORIZONTAL_STRENGTH,
        y: CFG.THROW_VERTICAL_STRENGTH,
        z: dir.z * CFG.THROW_HORIZONTAL_STRENGTH,
      });
    } catch {
      /* victim may have just been removed */
    }
  }
  // NOTE: a ~50 block arc lands with real (and often lethal) vanilla fall
  // damage. That is intentional - see README "Super Run" - the throw is
  // meant to be a genuine finishing move, not a harmless gag.
}

function endHold(state) {
  state.hold = null;
  state.phase = "idle";
  setPuppetAction(state, "none", 0);
}

/** Used by transform.js on revert/death/disconnect - never leaves a victim stuck. */
export function forceEndSuperRun(state) {
  const wasActive = state.phase === "super_run" || state.phase === "grabbing";
  if (!wasActive) return;
  const player = state.player;
  if (player && player.isValid && player.isValid()) {
    try {
      player.removeEffect("speed");
    } catch {
      /* ignore */
    }
  }
  state.superRun = null;
  state.hold = null; // victim is simply no longer re-teleported; they stay put, no throw
  state.phase = "idle";
  setPuppetAction(state, "none", 0);
}
