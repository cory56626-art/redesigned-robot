/**
 * The Harvester — a script-driven meat grinder.
 *
 * A custom block can't hold a native multi-slot container, so each placed
 * Harvester owns an invisible companion entity (`custom:harvester_logic`) whose
 * 6-slot inventory is the machine's storage. Behaviour is wired through stable
 * world events (place / interact / break) plus one central grind loop — no
 * custom block component, so the block itself always loads.
 *
 * @module machines/harvester
 */
import { world, system } from "@minecraft/server";
import { CONFIG } from "../core/config.js";
import { blockCenter, safe, weightedPick } from "../core/util.js";
import { addChum } from "../systems/chum.js";
import { openHarvesterUI } from "../ui/harvesterUI.js";
import {
  H,
  SLOTS,
  logicAt,
  ensureLogic,
  invOf,
  isValidInput,
  isFuel,
  slotAccepts,
  addToSlot,
  decrement,
  dropContents,
} from "./harvesterCore.js";

const BLOCK_ID = "custom:harvester";

/* ------------------------------------------------------------------ processing */

function canProduceMain(container) {
  return (
    slotAccepts(container, SLOTS.OUT_SINEW, H.outputs.sinew.item, H.outputs.sinew.count) &&
    slotAccepts(container, SLOTS.OUT_BONE, H.outputs.bone.item, H.outputs.bone.count)
  );
}

function produce(container) {
  addToSlot(container, SLOTS.OUT_SINEW, H.outputs.sinew.item, H.outputs.sinew.count);
  addToSlot(container, SLOTS.OUT_BONE, H.outputs.bone.item, H.outputs.bone.count);
  if (Math.random() < H.byproduct.chance) {
    const pick = weightedPick(H.byproduct.pool);
    addToSlot(container, SLOTS.OUT_BYPRODUCT, pick.item, pick.count);
  }
}

function setActive(block, active) {
  if (safe(() => block.permutation.getState(H.activeState)) === active) return;
  safe(() => block.setPermutation(block.permutation.withState(H.activeState, active)));
}

function emitWorkFx(dimension, blockLoc) {
  const c = blockCenter(blockLoc);
  if (Math.random() < 0.5) {
    safe(() => dimension.spawnParticle(CONFIG.particles.darkSmoke, { x: c.x, y: c.y + 0.9, z: c.z }));
  }
  if (Math.random() < 0.25) {
    safe(() => dimension.playSound(CONFIG.sounds.grind, c, { volume: 0.6 }));
  }
}

/** Advance one machine by one loop step. */
function processMachine(entity) {
  const dimension = entity.dimension;
  const blockLoc = {
    x: Math.floor(entity.location.x),
    y: Math.floor(entity.location.y),
    z: Math.floor(entity.location.z),
  };
  const block = safe(() => dimension.getBlock(blockLoc));

  // Orphaned companion (block gone) — dump its contents and vanish.
  if (!block || block.typeId !== BLOCK_ID) {
    dropContents(entity);
    safe(() => entity.remove());
    return;
  }

  const container = invOf(entity);
  if (!container) return;

  const dt = H.tickInterval;
  let progress = Number(entity.getDynamicProperty("of:progress") ?? 0);
  let fuel = Number(entity.getDynamicProperty("of:fuel") ?? 0);

  const input = container.getItem(SLOTS.INPUT);
  const runnable = isValidInput(input) && canProduceMain(container);
  let active = false;

  if (runnable) {
    if (fuel < dt && isFuel(container.getItem(SLOTS.FUEL))) {
      decrement(container, SLOTS.FUEL, 1);
      fuel += H.fuelTicksPerUnit;
    }
    if (fuel >= dt) {
      fuel -= dt;
      progress += dt;
      active = true;
      emitWorkFx(dimension, blockLoc);
      if (progress >= H.processTicks) {
        progress = 0;
        produce(container);
        decrement(container, SLOTS.INPUT, 1);
        safe(() => dimension.playSound(CONFIG.sounds.squish, blockCenter(blockLoc)));
        addChum(dimension, blockLoc, H.chumPerProcess);
      }
    }
  } else if (progress > 0) {
    progress = Math.max(0, progress - dt);
  }

  entity.setDynamicProperty("of:progress", progress);
  entity.setDynamicProperty("of:fuel", fuel);
  setActive(block, active);
}

/* ------------------------------------------------------------------ wiring */

export function startHarvester() {
  // Placing a Harvester spawns its companion inventory entity.
  world.afterEvents.playerPlaceBlock.subscribe((e) => {
    if (e.block?.typeId !== BLOCK_ID) return;
    const loc = e.block.location;
    const dim = e.block.dimension;
    system.run(() => ensureLogic(dim, loc));
  });

  // Right-click opens the machine panel (sneak-click still lets you build).
  world.beforeEvents.playerInteractWithBlock.subscribe((e) => {
    const { block, player } = e;
    if (!block || block.typeId !== BLOCK_ID) return;
    if (player?.isSneaking) return; // allow placing/building against it
    e.cancel = true; // stop the held item from being used/placed
    const loc = block.location;
    const dim = block.dimension;
    system.run(() => {
      const entity = ensureLogic(dim, loc);
      if (entity) openHarvesterUI(player, entity, block);
    });
  });

  // Breaking a Harvester spills its contents and removes the companion.
  world.afterEvents.playerBreakBlock.subscribe((e) => {
    if (e.brokenBlockPermutation?.type?.id !== BLOCK_ID) return;
    const entity = logicAt(e.dimension, e.block.location);
    if (entity) {
      dropContents(entity);
      safe(() => entity.remove());
    }
  });

  // One loop drives every Harvester in the world.
  system.runInterval(() => {
    for (const dimId of ["overworld", "nether", "the_end"]) {
      let dim;
      try {
        dim = world.getDimension(dimId);
      } catch {
        continue;
      }
      const machines = safe(() => dim.getEntities({ type: H.logicEntity })) || [];
      for (const ent of machines) processMachine(ent);
    }
  }, H.tickInterval);
}
