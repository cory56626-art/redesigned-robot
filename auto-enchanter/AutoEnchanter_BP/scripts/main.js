import { world, system, EnchantmentType, ItemComponentTypes } from "@minecraft/server";

/*
 * Auto Enchanter
 * --------------
 * Two custom items, each with a PER-ITEM curated, vanilla-max enchantment set:
 *   ae:enchanter_tools  -> utility / mining / movement
 *   ae:enchanter_pvp    -> combat / protection
 *
 * Triggers (Bedrock can't "use" an off-hand item and won't let gear go off-hand):
 *   1) ITEM    - hold the Enchanter in your MAIN hand, right-click. Enchants the
 *                first enchantable gear in your hotbar/inventory, consumes one.
 *   2) COMMAND - hold the gear and run /scriptevent ae:tools  (or ae:pvp). Free.
 */

const ENCHANTER_TOOLS = "ae:enchanter_tools";
const ENCHANTER_PVP = "ae:enchanter_pvp";

const E = (id, level) => ({ id, level });
const DUR = [E("unbreaking", 3), E("mending", 1)]; // durability tail for most gear

// ---- Per-item loadouts -----------------------------------------------------
// Each list is tuned for that item + role. canAddEnchantment() is still used as a
// safety net so anything illegal on the running version is skipped automatically.

const TOOLS = {
  pickaxe: [E("efficiency", 5), E("fortune", 3), ...DUR],
  shovel: [E("efficiency", 5), E("fortune", 3), ...DUR],
  axe: [E("efficiency", 5), E("fortune", 3), ...DUR], // axe-as-TOOL
  hoe: [E("efficiency", 5), ...DUR],
  shears: [E("efficiency", 5), ...DUR],
  fishing_rod: [E("lure", 3), E("luck_of_the_sea", 3), ...DUR],
  flint_and_steel: [...DUR],
  sword: [E("looting", 3), ...DUR], // utility take on a sword
  spear: [E("lunge", 3), E("looting", 3), ...DUR], // Lunge = the mobility/utility pick
  mace: [...DUR],
  bow: [E("infinity", 1), E("unbreaking", 3)],
  crossbow: [E("quick_charge", 3), ...DUR],
  trident: [E("riptide", 3), E("unbreaking", 3), E("mending", 1)],
  helmet: [E("respiration", 3), E("aqua_affinity", 1), ...DUR],
  chest: [...DUR],
  leggings: [E("swift_sneak", 3), ...DUR],
  boots: [E("feather_falling", 4), E("depth_strider", 3), E("soul_speed", 3), ...DUR],
  elytra: [...DUR],
  shield: [...DUR],
  other: [...DUR],
};

const PVP = {
  sword: [E("sharpness", 5), E("fire_aspect", 2), E("looting", 3), E("knockback", 2), ...DUR],
  axe: [E("sharpness", 5), ...DUR], // axe-as-WEAPON
  // Spear (Mounts of Mayhem update) + its exclusive Lunge enchant.
  spear: [E("sharpness", 5), E("lunge", 3), E("fire_aspect", 2), E("looting", 3), E("knockback", 2), ...DUR],
  mace: [E("density", 5), E("breach", 4), E("wind_burst", 3), ...DUR], // heavy weapon
  pickaxe: [...DUR],
  shovel: [...DUR],
  hoe: [...DUR],
  shears: [...DUR],
  flint_and_steel: [...DUR],
  fishing_rod: [E("lure", 3), E("luck_of_the_sea", 3), ...DUR],
  bow: [E("power", 5), E("flame", 1), E("punch", 2), E("infinity", 1), E("unbreaking", 3)],
  crossbow: [E("multishot", 1), E("piercing", 4), E("quick_charge", 3), ...DUR],
  trident: [E("impaling", 5), E("loyalty", 3), E("channeling", 1), ...DUR],
  helmet: [E("protection", 4), E("respiration", 3), E("aqua_affinity", 1), E("thorns", 3), ...DUR],
  chest: [E("protection", 4), E("thorns", 3), ...DUR],
  leggings: [E("protection", 4), E("thorns", 3), E("swift_sneak", 3), ...DUR],
  boots: [E("protection", 4), E("thorns", 3), E("feather_falling", 4), E("depth_strider", 3), ...DUR],
  elytra: [...DUR],
  shield: [...DUR],
  other: [...DUR],
};

/** Classify an item by its typeId into a loadout category. */
function categoryOf(typeId) {
  const id = typeId.replace(/^.*:/, "");
  if (id === "mace") return "mace";
  if (id === "bow") return "bow";
  if (id === "crossbow") return "crossbow";
  if (id === "trident") return "trident";
  if (id === "fishing_rod") return "fishing_rod";
  if (id === "shears") return "shears";
  if (id === "flint_and_steel") return "flint_and_steel";
  if (id === "elytra") return "elytra";
  if (id === "shield") return "shield";
  if (id.includes("spear") || id.includes("javelin")) return "spear";
  if (id.endsWith("_sword")) return "sword";
  if (id.endsWith("_pickaxe")) return "pickaxe";
  if (id.endsWith("_axe")) return "axe";
  if (id.endsWith("_shovel")) return "shovel";
  if (id.endsWith("_hoe")) return "hoe";
  if (id === "turtle_helmet" || id.endsWith("_helmet") || id.endsWith("_cap")) return "helmet";
  if (id.endsWith("_chestplate")) return "chest";
  if (id.endsWith("_leggings")) return "leggings";
  if (id.endsWith("_boots")) return "boots";
  return "other";
}

function getLoadout(typeId, isTools) {
  const table = isTools ? TOOLS : PVP;
  return table[categoryOf(typeId)] ?? table.other;
}

/** Apply a loadout to an item stack. Returns count actually applied. */
function enchantItem(itemStack, loadout) {
  const enchantable = itemStack.getComponent(ItemComponentTypes.Enchantable);
  if (!enchantable) return 0;

  try {
    enchantable.removeAllEnchantments(); // always rebuild to the full max set
  } catch (e) {}

  let applied = 0;
  for (const entry of loadout) {
    try {
      const enchantment = { type: new EnchantmentType(entry.id), level: entry.level };
      if (enchantable.canAddEnchantment(enchantment)) {
        enchantable.addEnchantment(enchantment);
        applied++;
      }
    } catch (e) {
      // unknown id / conflict / bad level on this version: skip
    }
  }
  return applied;
}

function prettyName(typeId) {
  return typeId
    .replace(/^.*:/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getSelectedSlot(player) {
  return player.selectedSlotIndex ?? player.selectedSlot ?? 0;
}

const isEnchanter = (item) =>
  item && (item.typeId === ENCHANTER_TOOLS || item.typeId === ENCHANTER_PVP);

function findTarget(container, heldSlot, preferHeld) {
  const total = container.size;
  const order = [];
  if (preferHeld) order.push(heldSlot);
  for (let i = 0; i < Math.min(9, total); i++) order.push(i); // hotbar first
  for (let i = 9; i < total; i++) order.push(i);

  for (const i of order) {
    if (!preferHeld && i === heldSlot) continue;
    const item = container.getItem(i);
    if (!item || isEnchanter(item)) continue;
    if (!item.getComponent(ItemComponentTypes.Enchantable)) continue;
    return { item, slot: i };
  }
  return null;
}

function consumeOne(container, slot) {
  const held = container.getItem(slot);
  if (!held) return;
  if (held.amount > 1) {
    held.amount -= 1;
    container.setItem(slot, held);
  } else {
    container.setItem(slot);
  }
}

function fail(player, msg) {
  try {
    player.onScreenDisplay.setActionBar(msg);
    player.playSound("note.bass", { pitch: 0.7 });
  } catch (e) {}
}

function success(player, isTools, name, count) {
  const flavour = isTools ? "§bTools" : "§cPVP";
  try {
    player.onScreenDisplay.setActionBar(
      `§a✦ ${flavour} §aenchanted §e${name} §awith §b${count} §aenchantment${count === 1 ? "" : "s"}!`
    );
    player.playSound("random.levelup", { pitch: 1.0, volume: 0.8 });
    player.dimension.spawnParticle("minecraft:villager_happy", {
      x: player.location.x,
      y: player.location.y + 1.2,
      z: player.location.z,
    });
  } catch (e) {}
}

function runEnchant(player, isTools, { consume, preferHeld }) {
  const container = player.getComponent("minecraft:inventory")?.container;
  if (!container) return;

  const heldSlot = getSelectedSlot(player);
  const target = findTarget(container, heldSlot, preferHeld);
  if (!target) {
    fail(player, "§cNo enchantable gear found. §7Hold or hotbar the item you want to enchant.");
    return;
  }

  const count = enchantItem(target.item, getLoadout(target.item.typeId, isTools));
  if (count === 0) {
    fail(player, `§e${prettyName(target.item.typeId)} §ccan't take these enchantments.`);
    return;
  }

  container.setItem(target.slot, target.item);
  if (consume) consumeOne(container, heldSlot);
  success(player, isTools, prettyName(target.item.typeId), count);
}

// Item: hold Enchanter in main hand, right-click (consumes one).
world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack;
  if (!player || !used) return;
  if (used.typeId !== ENCHANTER_TOOLS && used.typeId !== ENCHANTER_PVP) return;
  runEnchant(player, used.typeId === ENCHANTER_TOOLS, { consume: true, preferHeld: false });
});

// Command: /scriptevent ae:tools | ae:pvp  (hold the gear; free, nothing consumed).
system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "ae:tools" && event.id !== "ae:pvp") return;
  const player = event.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") return;
  runEnchant(player, event.id === "ae:tools", { consume: false, preferHeld: true });
});

console.log("[Auto Enchanter] v2 loaded (@minecraft/server 2.x). Items + /scriptevent ae:tools|ae:pvp");
