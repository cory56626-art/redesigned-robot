import { GameMode } from "@minecraft/server";
import * as CFG from "../config.js";
import { peekState, transformedStates } from "../state.js";

/**
 * Ability 2 - Decoy. Spawns one autonomous fake Dweller near the real one.
 * While unwatched it trolls (wander/sprint/ambient noise/door-stare). The
 * instant it has a clear line of sight to a survivor (or vice versa - we
 * treat unobstructed visibility as symmetric, see README "Decoy") it
 * screams and, for a few seconds, marks every nearby survivor with a
 * particle column only the real Dweller can see.
 *
 * Per-Dweller runtime data that doesn't belong on the shared DwellerState
 * shape lives in state.decoyRuntime, created in startDecoy() and discarded
 * in removeDecoy().
 */

function freshRuntime(currentTick) {
  return {
    frozen: false,
    frozenUntilTick: 0,
    screaming: false,
    highlightUntilTick: 0,
    nextAmbientAtTick: currentTick + randInt(CFG.DECOY_AMBIENT_MIN_INTERVAL_TICKS, CFG.DECOY_AMBIENT_MAX_INTERVAL_TICKS),
    sprintUntilTick: 0,
  };
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function findSpawnLocation(player) {
  const dim = player.dimension;
  for (let i = 0; i < 8; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 5;
    const x = Math.floor(player.location.x + Math.cos(angle) * dist);
    const z = Math.floor(player.location.z + Math.sin(angle) * dist);
    for (let dy = 3; dy >= -3; dy--) {
      const y = Math.floor(player.location.y) + dy;
      try {
        const ground = dim.getBlock({ x, y: y - 1, z });
        const feet = dim.getBlock({ x, y, z });
        const head = dim.getBlock({ x, y: y + 1, z });
        if (!ground || !feet || !head) continue;
        const gId = ground.typeId;
        if (gId === "minecraft:air" || gId === "minecraft:water" || gId === "minecraft:lava") continue;
        if (feet.typeId !== "minecraft:air" || head.typeId !== "minecraft:air") continue;
        return { x: x + 0.5, y, z: z + 0.5 };
      } catch {
        continue;
      }
    }
  }
  return { x: player.location.x, y: player.location.y, z: player.location.z };
}

export function startDecoy(state, currentTick) {
  removeDecoy(state); // only one at a time - recast resets it
  const player = state.player;
  const loc = findSpawnLocation(player);
  const decoy = player.dimension.spawnEntity(CFG.DECOY_ID, loc);
  decoy.nameTag = "";
  try {
    decoy.triggerEvent("dwl:spawn_init");
  } catch {
    /* ignore */
  }
  state.decoyEntity = decoy;
  state.decoyExpiresAtTick = currentTick + CFG.DECOY_LIFETIME_TICKS;
  state.decoyReadyAtTick = currentTick + CFG.DECOY_RECAST_COOLDOWN_TICKS;
  state.decoyRuntime = freshRuntime(currentTick);
}

export function removeDecoy(state) {
  if (state.decoyEntity) {
    try {
      if (state.decoyEntity.isValid()) state.decoyEntity.remove();
    } catch {
      /* already gone */
    }
  }
  state.decoyEntity = undefined;
  state.decoyRuntime = undefined;
}

function nearbySurvivors(location, dimension, radius) {
  let players;
  try {
    players = dimension.getPlayers({ location, maxDistance: radius });
  } catch {
    return [];
  }
  return players.filter((p) => {
    const s = peekState(p.id);
    if (s && s.transformed) return false; // other Dwellers never count as "IT"
    const mode = p.getGameMode();
    if (mode === GameMode.creative || mode === GameMode.spectator) return false;
    return true;
  });
}

function canSee(fromLoc, toLoc, dimension) {
  const dx = toLoc.x - fromLoc.x;
  const dy = toLoc.y - fromLoc.y;
  const dz = toLoc.z - fromLoc.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 0.5) return true;
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  let hit;
  try {
    hit = dimension.getBlockFromRay(fromLoc, dir, { maxDistance: Math.max(0.1, dist - 0.4) });
  } catch {
    return false;
  }
  return !hit;
}

function eyeLocation(entity) {
  try {
    return entity.getHeadLocation();
  } catch {
    return { x: entity.location.x, y: entity.location.y + 1.6, z: entity.location.z };
  }
}

function startScream(state, decoy, survivor, currentTick) {
  const rt = state.decoyRuntime;
  rt.screaming = true;
  rt.highlightUntilTick = currentTick + CFG.DECOY_HIGHLIGHT_DURATION_TICKS;
  freeze(state, decoy, currentTick, CFG.DECOY_HIGHLIGHT_DURATION_TICKS);

  try {
    const dir = {
      x: survivor.location.x - decoy.location.x,
      z: survivor.location.z - decoy.location.z,
    };
    const yaw = (Math.atan2(-dir.x, dir.z) * 180) / Math.PI;
    decoy.teleport(decoy.location, { rotation: { x: 0, y: yaw } });
  } catch {
    /* ignore */
  }

  try {
    decoy.setProperty("dwl:action_state", "spine_twist");
  } catch {
    /* ignore */
  }
  try {
    decoy.dimension.playSound("dwl.scream", decoy.location, { volume: 1.0 });
  } catch {
    /* ignore */
  }
}

function freeze(state, decoy, currentTick, durationTicks) {
  const rt = state.decoyRuntime;
  const wasFrozen = rt.frozen && currentTick < rt.frozenUntilTick;
  rt.frozen = true;
  rt.frozenUntilTick = Math.max(rt.frozenUntilTick, currentTick + durationTicks);
  if (!wasFrozen) {
    try {
      decoy.triggerEvent("dwl:start_stare");
    } catch {
      /* ignore */
    }
  }
}

function unfreeze(state, decoy) {
  const rt = state.decoyRuntime;
  rt.frozen = false;
  try {
    decoy.triggerEvent("dwl:stop_stare");
  } catch {
    /* ignore */
  }
  try {
    decoy.setProperty("dwl:action_state", "none");
  } catch {
    /* ignore */
  }
}

function tryDoorStare(state, decoy, currentTick) {
  if (Math.random() > CFG.DECOY_STARE_CHANCE_PER_CHECK) return;
  const dim = decoy.dimension;
  const base = decoy.location;
  const r = CFG.DECOY_STARE_DOOR_RADIUS;
  for (let attempts = 0; attempts < 10; attempts++) {
    const dx = Math.floor((Math.random() * 2 - 1) * r);
    const dz = Math.floor((Math.random() * 2 - 1) * r);
    const dy = Math.floor(Math.random() * 3) - 1;
    try {
      const block = dim.getBlock({
        x: Math.floor(base.x) + dx,
        y: Math.floor(base.y) + dy,
        z: Math.floor(base.z) + dz,
      });
      if (block && block.typeId.includes("door")) {
        const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
        decoy.teleport(decoy.location, { rotation: { x: 0, y: yaw } });
        freeze(state, decoy, currentTick, CFG.DECOY_STARE_DURATION_TICKS);
        return;
      }
    } catch {
      continue;
    }
  }
}

function trySprintBurst(state, decoy, currentTick) {
  if (Math.random() > CFG.DECOY_SPRINT_CHANCE_PER_CHECK) return;
  state.decoyRuntime.sprintUntilTick = currentTick + CFG.DECOY_SPRINT_DURATION_TICKS;
  try {
    decoy.setProperty("dwl:move_state", "sprint");
  } catch {
    /* ignore */
  }
}

function playAmbient(decoy) {
  const roll = Math.random();
  const sound = roll < 0.45 ? "dwl.footstep" : roll < 0.85 ? "dwl.knock" : "dwl.ambience";
  try {
    decoy.dimension.playSound(sound, decoy.location, { volume: 0.9 });
  } catch {
    /* ignore */
  }
}

function updateOneDecoy(state, currentTick) {
  const decoy = state.decoyEntity;
  if (!decoy || !decoy.isValid || !decoy.isValid()) {
    removeDecoy(state);
    return;
  }
  if (currentTick >= state.decoyExpiresAtTick) {
    removeDecoy(state);
    return;
  }

  const rt = state.decoyRuntime;
  const dweller = state.player;

  // Un-freeze once the hold window (stare or scream) has elapsed.
  if (rt.frozen && currentTick >= rt.frozenUntilTick) {
    unfreeze(state, decoy);
    if (rt.screaming) rt.screaming = false;
  }
  if (rt.sprintUntilTick && currentTick >= rt.sprintUntilTick) {
    rt.sprintUntilTick = 0;
    try {
      decoy.setProperty("dwl:move_state", "idle");
    } catch {
      /* ignore */
    }
  }

  const survivors = nearbySurvivors(decoy.location, decoy.dimension, CFG.DECOY_LOS_RADIUS);
  const decoyEye = eyeLocation(decoy);

  if (!rt.screaming) {
    let seenSurvivor;
    for (const s of survivors) {
      if (canSee(decoyEye, eyeLocation(s), decoy.dimension)) {
        seenSurvivor = s;
        break;
      }
    }
    if (seenSurvivor) {
      startScream(state, decoy, seenSurvivor, currentTick);
    } else if (!rt.frozen) {
      // Not seen, not screaming: idle trolling.
      if (currentTick >= rt.nextAmbientAtTick) {
        playAmbient(decoy);
        rt.nextAmbientAtTick =
          currentTick +
          randInt(CFG.DECOY_AMBIENT_MIN_INTERVAL_TICKS, CFG.DECOY_AMBIENT_MAX_INTERVAL_TICKS);
      }
      trySprintBurst(state, decoy, currentTick);
      tryDoorStare(state, decoy, currentTick);
    }
  }

  // While the highlight window is open, mark every nearby survivor for the
  // real Dweller only. dweller.spawnParticle() is a per-player call - the
  // survivors never see it (requires @minecraft/server 1.18.0+, see README).
  if (currentTick < rt.highlightUntilTick && dweller && dweller.isValid && dweller.isValid()) {
    for (const survivor of survivors) {
      const base = survivor.location;
      for (let i = 0; i < 6; i++) {
        try {
          dweller.spawnParticle("minecraft:soul_particle", {
            x: base.x,
            y: base.y + 0.2 + i * 0.4,
            z: base.z,
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** Dispatched by main.js on a fixed cadence for every transformed Dweller. */
export function tickDecoys(currentTick) {
  for (const state of transformedStates()) {
    if (state.decoyEntity) updateOneDecoy(state, currentTick);
  }
}
