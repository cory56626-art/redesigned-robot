/**
 * Organic Forgery & The Harvester — Part 1 / Module 1 entry point.
 *
 * Registers all custom block/item components during the engine startup event,
 * then wires up the background systems (Harvester processing, Rot Tier scan,
 * combat siphon, Chum corruption, Butcher's Knife harvesting).
 *
 * Everything gameplay-facing is JavaScript; the JSON files are thin
 * registration shells the engine requires for content to exist.
 *
 * @module main
 */
import { system, world } from "@minecraft/server";

import { harvesterBlockComponent, startHarvesterProcessing } from "./machines/harvester.js";
import { openHarvesterUI } from "./ui/harvesterUI.js";
import { butchersKnifeComponent, startButcherInteractions } from "./items/butchersKnife.js";
import { organicGearComponent, startRotScan } from "./systems/rot.js";
import { startCombatSiphon } from "./systems/gearMaintenance.js";
import { fleshMossBlockComponent, startChumCorruption } from "./systems/chum.js";

/* -------------------------------------------------- custom component registration */

system.beforeEvents.startup.subscribe(({ blockComponentRegistry, itemComponentRegistry }) => {
  // Blocks
  blockComponentRegistry.registerCustomComponent(
    "of:harvester",
    harvesterBlockComponent(openHarvesterUI)
  );
  blockComponentRegistry.registerCustomComponent("of:flesh_moss", fleshMossBlockComponent());

  // Items
  itemComponentRegistry.registerCustomComponent("of:butchers_knife", butchersKnifeComponent());
  itemComponentRegistry.registerCustomComponent("of:organic_gear", organicGearComponent());
});

/* -------------------------------------------------- background systems */

startHarvesterProcessing(); // grind loop over every Harvester
startRotScan(); // keep organic gear tiers + buffs current
startCombatSiphon(); // lifesteal-for-durability on kills
startButcherInteractions(); // interact-to-harvest weakened farm mobs
startChumCorruption(); // spread flesh moss as the world rots

/* -------------------------------------------------- boot banner */

world.afterEvents.worldLoad.subscribe(() => {
  console.warn("[Organic Forgery] Module 1 loaded — the meat remembers.");
});
