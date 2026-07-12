import { system, world } from "@minecraft/server";
import * as CFG from "./config.js";
import { getState, transformedStates } from "./state.js";
import {
  transformPlayer,
  revertPlayer,
  checkTotemPresence,
  refreshBuffs,
  updateHud,
} from "./transform.js";
import { tickPuppetSync } from "./puppet.js";
import { startSuperRun, tickSuperRun } from "./abilities/superRun.js";
import { startDecoy, tickDecoys } from "./abilities/decoy.js";
import { startBroadcast, tickBroadcast } from "./abilities/broadcast.js";
import { handlePlayerLeave, handlePlayerSpawn } from "./playerLifecycle.js";
import { handleEntityDie } from "./deathCleanup.js";

// ---------------------------------------------------------------------------
// The Totem: toggles transformation. Every other item is server-gated - see
// DwellerState.canStartAbility(), which refuses to run anything unless the
// player is transformed and no other ability is already in progress.
// ---------------------------------------------------------------------------
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const typeId = event.itemStack.typeId;

  if (typeId === CFG.TOTEM_ID) {
    const state = getState(player);
    if (state.transformed) {
      revertPlayer(state);
    } else {
      transformPlayer(player);
    }
    return;
  }

  if (!CFG.ABILITY_ITEM_IDS.includes(typeId)) return;

  const state = getState(player);
  const currentTick = system.currentTick;

  switch (typeId) {
    case CFG.ABILITY_SUPER_RUN_ID:
      if (state.canStartAbility(currentTick, state.superRunReadyAtTick)) {
        startSuperRun(state, currentTick);
      }
      break;
    case CFG.ABILITY_DECOY_ID:
      if (state.canStartAbility(currentTick, state.decoyReadyAtTick)) {
        startDecoy(state, currentTick);
      }
      break;
    case CFG.ABILITY_BROADCAST_ID:
      if (state.canStartAbility(currentTick, state.broadcastReadyAtTick)) {
        startBroadcast(state, currentTick);
      }
      break;
  }
});

world.afterEvents.playerLeave.subscribe(handlePlayerLeave);
world.afterEvents.playerSpawn.subscribe(handlePlayerSpawn);
world.afterEvents.entityDie.subscribe(handleEntityDie);

// ---------------------------------------------------------------------------
// Single per-tick loop. Every subsystem gates its own frequency internally
// (see config.js) so this stays cheap: puppet sync must run every tick for
// smooth motion, everything else is checked every few ticks at most and
// only ever iterates the (small) set of currently-transformed Dwellers.
// ---------------------------------------------------------------------------
system.runInterval(() => {
  const currentTick = system.currentTick;

  for (const state of transformedStates()) {
    if (currentTick % CFG.TOTEM_PRESENCE_CHECK_INTERVAL_TICKS === 0) {
      checkTotemPresence(state);
      if (!state.transformed) continue; // just reverted - nothing left to tick
    }

    tickPuppetSync(state, currentTick);
    tickSuperRun(state, currentTick);
    tickBroadcast(state, currentTick);

    if (currentTick % CFG.BUFF_REFRESH_INTERVAL_TICKS === 0) refreshBuffs(state);
    if (currentTick % CFG.HUD_REFRESH_INTERVAL_TICKS === 0) updateHud(state, currentTick);
  }

  if (currentTick % CFG.DECOY_AI_INTERVAL_TICKS === 0) tickDecoys(currentTick);
}, 1);
