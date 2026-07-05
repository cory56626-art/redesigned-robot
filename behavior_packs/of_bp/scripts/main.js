/**
 * Organic Forgery & The Harvester — Part 1 / Module 1 entry point.
 *
 * ARCHITECTURE (v2): behaviour is wired entirely through **stable world events**
 * and `system.runInterval` — no custom-component registration and no startup
 * event. That decoupling is deliberate: the blocks and items are pure data that
 * always load, so a script problem can never make the Harvester or the knife
 * "disappear" (the failure mode of v1). Everything here targets the stable
 * `@minecraft/server` 2.x API and needs no experimental toggles.
 *
 * @module main
 */
import { world } from "@minecraft/server";

import { startHarvester } from "./machines/harvester.js";
import { startButcherKnife } from "./items/butchersKnife.js";
import { startRotEngine } from "./systems/rot.js";
import { startCombatSiphon } from "./systems/gearMaintenance.js";
import { startChumCorruption } from "./systems/chum.js";

// Each start* function subscribes its own world events / intervals. They are
// safe to call at module load — subscribing never touches world state.
startHarvester(); // place / interact / break + central grind loop
startButcherKnife(); // interact-to-harvest weakened farm mobs
startRotEngine(); // rot tier scan, on-hit effects, feeding
startCombatSiphon(); // lifesteal-for-durability on kills
startChumCorruption(); // spread flesh moss as the world rots

world.afterEvents.worldLoad.subscribe(() => {
  console.warn("[Organic Forgery] Module 1 (v2) loaded — the meat remembers.");
});
