/**
 * No-op stub of `@minecraft/server` for the load-time smoke test.
 * It exposes exactly the shapes the add-on's scripts touch at module load —
 * enough to import main.js and run its `start*()` wiring without a game.
 * Intervals/callbacks are stored but never executed, so no world is needed.
 */
const eventHub = new Proxy(
  {},
  { get: () => ({ subscribe: () => {}, unsubscribe: () => {} }) }
);

const dimensionStub = {
  getEntities: () => [],
  getBlock: () => undefined,
  spawnEntity: () => undefined,
  spawnItem: () => undefined,
  spawnParticle: () => {},
  playSound: () => {},
};

export const world = {
  afterEvents: eventHub,
  beforeEvents: eventHub,
  getAllPlayers: () => [],
  getDimension: () => dimensionStub,
  getDynamicProperty: () => undefined,
  setDynamicProperty: () => {},
};

export const system = {
  run: () => {},
  runInterval: () => 1,
  runTimeout: () => 1,
  clearRun: () => {},
  beforeEvents: eventHub,
  afterEvents: eventHub,
};

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
    this.maxAmount = 64;
  }
  getTags() {
    return [];
  }
  setLore() {}
  getComponent() {
    return undefined;
  }
}

export const EquipmentSlot = {
  Mainhand: "Mainhand",
  Offhand: "Offhand",
  Head: "Head",
  Chest: "Chest",
  Legs: "Legs",
  Feet: "Feet",
};

export const EntityComponentTypes = {
  Equippable: "minecraft:equippable",
  Inventory: "minecraft:inventory",
  Health: "minecraft:health",
  Durability: "minecraft:durability",
};

export const ItemComponentTypes = { Durability: "minecraft:durability" };
export const BlockComponentTypes = {};
export const GameMode = { survival: "survival", creative: "creative" };
export class BlockPermutation {}
