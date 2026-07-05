/**
 * Organic Forgery — central tuning table.
 * Every gameplay constant lives here so balancing never means hunting through logic.
 * @module core/config
 */

export const CONFIG = {
  /* ---------------------------------------------------------------- Butcher's Knife */
  knife: {
    // Fraction of max health at or below which a farm mob can be "harvested".
    weakHealthFraction: 0.3,
    // Farm mobs the knife can render down.
    harvestableTypes: [
      "minecraft:cow",
      "minecraft:mooshroom",
      "minecraft:pig",
      "minecraft:sheep",
      "minecraft:chicken",
    ],
    carcassItem: "custom:raw_carcass",
    carcassCount: 1,
    // Extra durability spent when a harvest succeeds.
    harvestDurabilityCost: 2,
  },

  /* ---------------------------------------------------------------- Harvester machine */
  harvester: {
    // Ticks of "grinding" needed to convert one input into components.
    processTicks: 200, // 10 seconds
    // How often (ticks) the central processing loop advances every machine.
    tickInterval: 10,
    // Ticks of burn granted per unit of fuel consumed (1 coal ~= 8 items).
    fuelTicksPerUnit: 1600,
    fuelItems: ["minecraft:coal", "minecraft:charcoal"],
    // Slot layout inside the companion inventory entity.
    slots: {
      FUEL: 0,
      CATALYST: 1,
      INPUT: 2,
      OUT_SINEW: 3,
      OUT_BONE: 4,
      OUT_BYPRODUCT: 5,
    },
    // Guaranteed outputs per processed carcass.
    outputs: {
      sinew: { item: "custom:sinew", count: 1 },
      bone: { item: "custom:dense_bone", count: 1 },
    },
    // Random bonus in the byproduct slot.
    byproduct: {
      chance: 0.55,
      pool: [
        { item: "custom:marrow", count: 1, weight: 3 },
        { item: "custom:cured_hide", count: 1, weight: 2 },
      ],
    },
    chumPerProcess: 4,
    logicEntity: "custom:harvester_logic",
    activeState: "custom:active",
  },

  /* ---------------------------------------------------------------- Rot Tier engine */
  rot: {
    // Wellness = remaining durability / max durability.
    tiers: {
      FRESH: { min: 0.66, id: "fresh" },
      FERMENTED: { min: 0.33, id: "fermented" },
      PUTRID: { min: 0.0, id: "putrid" },
    },
    // Effect refresh window (ticks) — slightly longer than the scan interval so
    // buffs persist smoothly while gear is equipped and lapse when it is not.
    effectDuration: 60,
    scanInterval: 20,
    // Feeding raw meat repairs this many durability points per feed.
    feedRepair: 40,
    feedMeatTags: ["custom:meat"],
    feedMeatItems: [
      "minecraft:beef",
      "minecraft:porkchop",
      "minecraft:mutton",
      "minecraft:chicken",
      "minecraft:rabbit",
      "minecraft:rotten_flesh",
      "custom:raw_carcass",
    ],
    // Combat siphon: durability restored to organic gear on a kill.
    siphonRepair: 12,
  },

  /* ---------------------------------------------------------------- Chum / corruption */
  chum: {
    scoreProperty: "custom:chum_score",
    spreadInterval: 100, // ticks between corruption sweeps
    spreadRadius: 6,
    // Chum needed before corruption begins; spread chance scales past it.
    spreadThreshold: 8,
    maxSpreadPerSweep: 2,
    corruptedBlock: "custom:flesh_moss",
    corruptibleBlocks: [
      "minecraft:grass_block",
      "minecraft:dirt",
      "minecraft:podzol",
      "minecraft:moss_block",
      "minecraft:mud",
      "minecraft:coarse_dirt",
    ],
  },

  /* ---------------------------------------------------------------- Shared identifiers */
  tags: {
    organicGear: "custom:organic_gear",
    rotWeapon: "custom:rot_weapon",
    harvesterInput: "custom:harvester_input",
    meat: "custom:meat",
  },

  // Vanilla sound *event* ids — guaranteed to exist, so audio works without
  // shipping .ogg files. Swap these for custom `of.*` events once a sound
  // designer supplies audio + a sound_definitions.json (see README).
  sounds: {
    boneBreak: "mob.skeleton.death",
    grind: "mob.slime.big",
    squish: "mob.slime.small",
    forgeReady: "random.anvil_land",
  },

  particles: {
    blood: "of:blood",
    darkSmoke: "of:dark_smoke",
    ichor: "of:ichor",
    corruption: "of:corruption",
  },
};

export const DIMENSION_IDS = ["overworld", "nether", "the_end"];
