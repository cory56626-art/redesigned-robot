import { ItemStack, Player, system } from "@minecraft/server";
import * as CFG from "./config.js";
import { peekState } from "./state.js";
import { revertPlayer } from "./transform.js";

const DYNPROP = CFG.DYNPROP_PENDING_TOTEM_RETURN;

/**
 * Death handling for a transformed Dweller (recommended rule: revert to
 * normal on death - see README "The Totem").
 *
 * The Totem is creative-only, so permanently losing it to a death-loot
 * drop would soft-lock that player out of the mode for the rest of the
 * game. We sweep the dropped Totem/ability items out of the world within
 * a couple of ticks of death, then hand a fresh Totem back on respawn.
 * Ability items are NOT restored on respawn - they only ever exist while
 * transformed, same as any other transform.
 */
export function handleEntityDie(event) {
  const dead = event.deadEntity;
  if (!(dead instanceof Player)) return;

  const state = peekState(dead.id);
  if (!state || !state.transformed) return;

  const hadTotem = true; // transformed implies they held a Totem at time of death
  revertPlayer(state, { silent: true });

  if (hadTotem) {
    try {
      dead.setDynamicProperty(DYNPROP, true);
    } catch {
      /* ignore */
    }
  }

  sweepDeathDrops(dead.location, dead.dimension);
}

function sweepDeathDrops(location, dimension) {
  const idsToRemove = new Set([CFG.TOTEM_ID, ...CFG.ABILITY_ITEM_IDS]);
  const sweep = () => {
    let items;
    try {
      items = dimension.getEntities({ location, maxDistance: 4, type: "minecraft:item" });
    } catch {
      return;
    }
    for (const itemEntity of items) {
      let stack;
      try {
        stack = itemEntity.getComponent("minecraft:item")?.itemStack;
      } catch {
        continue;
      }
      if (stack && idsToRemove.has(stack.typeId)) {
        try {
          itemEntity.remove();
        } catch {
          /* ignore */
        }
      }
    }
  };
  // Drops can land a tick or two after the death event, so sweep a few times.
  sweep();
  system.runTimeout(sweep, 2);
  system.runTimeout(sweep, 6);
}

/** Subscribed to playerSpawn - hands back a Totem lost to sweepDeathDrops(). */
export function restorePendingTotem(player) {
  let pending = false;
  try {
    pending = player.getDynamicProperty(DYNPROP) === true;
  } catch {
    pending = false;
  }
  if (!pending) return;

  try {
    player.setDynamicProperty(DYNPROP, false);
  } catch {
    /* ignore */
  }

  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;
  const leftover = container.addItem(new ItemStack(CFG.TOTEM_ID, 1));
  if (leftover) {
    try {
      player.dimension.spawnItem(leftover, player.location);
    } catch {
      /* ignore */
    }
  }
}
