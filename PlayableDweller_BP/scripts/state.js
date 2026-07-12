/**
 * Single authoritative, server-side state store: one DwellerState per player
 * who has ever transformed this session. Everything ability code needs to
 * know about a Dweller lives here so there is exactly one source of truth.
 *
 * Lifetime: created lazily, cleared on playerLeave. Transformation itself is
 * intentionally NOT persisted across disconnect/world restart (see README -
 * "Persistence" section) so this map only ever needs to describe the
 * current session.
 */

/** @typedef {"idle"|"super_run"|"grabbing"|"broadcast"} AbilityPhase */

export class DwellerState {
  constructor(playerId, player) {
    this.playerId = playerId;
    /** Live Player reference, refreshed on every getState() call. */
    this.player = player;

    this.transformed = false;
    /** @type {import("@minecraft/server").Entity|undefined} */
    this.puppet = undefined;

    /** @type {AbilityPhase} */
    this.phase = "idle";

    // Cooldown bookkeeping (ticks; compare against system.currentTick).
    this.superRunReadyAtTick = 0;
    this.decoyReadyAtTick = 0;
    this.broadcastReadyAtTick = 0;

    // Active-ability runtime payloads (null when not running).
    this.superRun = null; // { endsAtTick }
    this.hold = null; // { victimId, isPlayer, releaseAtTick }
    this.broadcast = null; // { endsAtTick, affected: Set<string> }

    // Decoy ownership (a Dweller may own at most one).
    /** @type {import("@minecraft/server").Entity|undefined} */
    this.decoyEntity = undefined;
    this.decoyExpiresAtTick = 0;
    /** Trolling/scream/highlight bookkeeping for the current decoy, if any. */
    this.decoyRuntime = undefined;

    // Animation/HUD bookkeeping.
    this.lastMoveState = "idle";
    this.lastActionState = "none";
    this.lastActionUntilTick = 0;
  }

  isAbilityLocked() {
    return this.phase !== "idle";
  }

  /** One shared gate every ability start-path (and the item-use dispatcher) checks. */
  canStartAbility(currentTick, readyAtTick) {
    return this.transformed && this.phase === "idle" && currentTick >= readyAtTick;
  }
}

/** @type {Map<string, DwellerState>} */
export const dwellerStates = new Map();

/** @param {import("@minecraft/server").Player} player */
export function getState(player) {
  let s = dwellerStates.get(player.id);
  if (!s) {
    s = new DwellerState(player.id, player);
    dwellerStates.set(player.id, s);
  } else {
    s.player = player; // keep reference fresh
  }
  return s;
}

export function peekState(playerId) {
  return dwellerStates.get(playerId);
}

export function clearState(playerId) {
  dwellerStates.delete(playerId);
}

/** All currently-transformed Dweller states. */
export function transformedStates() {
  const out = [];
  for (const s of dwellerStates.values()) {
    if (s.transformed) out.push(s);
  }
  return out;
}
