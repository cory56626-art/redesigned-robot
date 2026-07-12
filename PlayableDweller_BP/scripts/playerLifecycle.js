import { peekState, clearState } from "./state.js";
import { revertPlayer, removeAbilityItems } from "./transform.js";
import { restorePendingTotem } from "./deathCleanup.js";

/**
 * Disconnect/reconnect handling (see README "Global robustness" for the
 * full rundown of what happens to victims/decoys/broadcasts/puppets).
 *
 * Transformation itself is intentionally NOT persisted across a disconnect
 * or world restart - a returning Dweller is a normal survivor again and
 * simply uses their Totem to re-transform. This keeps every other stateful
 * subsystem (puppet, decoy, held victim, broadcast) trivially consistent:
 * there is never a "resume mid-ability after reconnect" case to get wrong.
 */
export function handlePlayerLeave(event) {
  const playerId = event.playerId;
  const state = peekState(playerId);
  if (state && state.transformed) {
    // Tears down puppet/decoy/broadcast and releases any held victim.
    revertPlayer(state, { silent: true });
  }
  clearState(playerId);
}

export function handlePlayerSpawn(event) {
  const player = event.player;

  // Covers both "died while transformed" (see deathCleanup.js) and "died
  // while transformed, then disconnected before respawning" - the pending
  // flag lives in a dynamic property specifically so it survives that gap.
  restorePendingTotem(player);

  if (event.initialSpawn) {
    // Defensive reset for a fresh join/rejoin: strip any stray ability
    // items and effects that could theoretically survive a disconnect
    // that happened mid-ability (belt-and-suspenders alongside the
    // cleanup already done in handlePlayerLeave/forceEndBroadcast).
    removeAbilityItems(player);
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
  }
}
