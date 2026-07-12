import { GameMode } from "@minecraft/server";
import * as CFG from "../config.js";
import { peekState } from "../state.js";
import { dist3 } from "../util/mathUtil.js";
import { setPuppetAction } from "../puppet.js";

/**
 * Ability 3 - Horror Broadcast. The signature move: every survivor sharing
 * the Dweller's dimension at cast time gets Darkness, a one-shot red "HIDE"
 * title, and a continuously-updating actionbar counter tracking the REAL
 * Dweller (never a decoy). See README "Horror Broadcast" for the scope,
 * Darkness-vs-Blindness and actionbar-vs-title reasoning.
 */

function cleanupSurvivor(player) {
  try {
    player.removeEffect("darkness");
  } catch {
    /* ignore */
  }
  try {
    player.stopMusic();
  } catch {
    /* ignore */
  }
  try {
    player.onScreenDisplay.setActionBar("");
  } catch {
    /* ignore */
  }
}

export function startBroadcast(state, currentTick) {
  const dweller = state.player;
  state.phase = "broadcast";
  state.broadcastReadyAtTick =
    currentTick + CFG.BROADCAST_DURATION_TICKS + CFG.BROADCAST_COOLDOWN_AFTER_TICKS;

  setPuppetAction(state, "spine_twist", CFG.BROADCAST_SPINE_TWIST_TICKS);
  try {
    dweller.dimension.playSound("dwl.bone_crack", dweller.location, { volume: 1.0 });
  } catch {
    /* ignore */
  }

  let candidates = [];
  try {
    candidates = dweller.dimension.getPlayers();
  } catch {
    /* ignore */
  }

  const affected = new Set();
  for (const p of candidates) {
    if (p.id === dweller.id) continue;
    const s = peekState(p.id);
    if (s && s.transformed) continue; // other Dwellers are exempt
    const mode = p.getGameMode();
    if (mode === GameMode.creative || mode === GameMode.spectator) continue;

    affected.add(p);
    try {
      p.addEffect("darkness", CFG.BROADCAST_DURATION_TICKS + 10, {
        amplifier: 0,
        showParticles: false,
      });
    } catch {
      /* ignore */
    }
    try {
      p.onScreenDisplay.setTitle("§4§lHIDE", {
        subtitle: "§7It has awoken.",
        fadeInDuration: 6,
        stayDuration: 30,
        fadeOutDuration: 10,
      });
    } catch {
      /* ignore */
    }
    try {
      p.playMusic("dwl.hunt_theme", { loop: true, volume: 1.0 });
    } catch {
      /* ignore */
    }
  }

  state.broadcast = { endsAtTick: currentTick + CFG.BROADCAST_DURATION_TICKS, affected };
}

/** Dispatched every tick by main.js for any Dweller mid-broadcast. */
export function tickBroadcast(state, currentTick) {
  if (state.phase !== "broadcast" || !state.broadcast) return;
  const b = state.broadcast;
  const dweller = state.player;
  let dwellerValid = false;
  try {
    dwellerValid = !!dweller && dweller.isValid();
  } catch {
    dwellerValid = false;
  }

  if (!dwellerValid || currentTick >= b.endsAtTick) {
    forceEndBroadcast(state);
    return;
  }

  if (currentTick % CFG.BROADCAST_UPDATE_INTERVAL_TICKS !== 0) return;

  for (const survivor of Array.from(b.affected)) {
    let valid = false;
    try {
      valid = survivor.isValid();
    } catch {
      valid = false;
    }
    if (!valid) {
      b.affected.delete(survivor);
      continue;
    }
    if (survivor.dimension.id !== dweller.dimension.id) {
      // Distance across dimensions is meaningless - end their effect early
      // rather than show a stale or nonsensical counter.
      cleanupSurvivor(survivor);
      b.affected.delete(survivor);
      continue;
    }
    const distance = Math.round(dist3(survivor.location, dweller.location));
    try {
      survivor.onScreenDisplay.setActionBar(`§4§lHIDE  §r§cIT is ${distance} blocks away`);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Single cleanup path used by natural timeout AND every early-abort case
 * (Dweller reverts, dies, or disconnects). Always safe to call even if no
 * broadcast is active.
 */
export function forceEndBroadcast(state) {
  const b = state.broadcast;
  if (b) {
    for (const survivor of b.affected) {
      let valid = false;
      try {
        valid = survivor.isValid();
      } catch {
        valid = false;
      }
      if (valid) cleanupSurvivor(survivor);
    }
  }
  state.broadcast = null;
  if (state.phase === "broadcast") state.phase = "idle";
}
