import { world, system, EnchantmentType, ItemComponentTypes } from "@minecraft/server";

/*
 * Auto Enchanter
 * --------------
 * ae:enchanter_tools  -> utility-leaning maximal enchants
 * ae:enchanter_pvp    -> combat-leaning maximal enchants
 *
 * Both enchanters fully max out EVERY enchantable item; the only differences are
 * the genuine either/or picks (bow: Infinity vs Mending, crossbow: Multishot vs
 * Piercing, trident: Loyalty+Channeling vs Riptide). Enchantments are applied with
 * a direct addEnchantment() in a try/catch (NOT canAddEnchantment, which returns
 * false-negatives on current versions) so anything legal for the item actually lands
 * and anything illegal is silently skipped.
 *
 * Triggers:
 *   1) ITEM    - hold the Enchanter in your MAIN hand, right-click. Enchants the
 *                first enchantable gear in your hotbar/inventory; consumes one.
 *   2) COMMAND - hold the gear and run  /scriptevent ae:tools  (or ae:pvp). Free.
 */

const ENCHANTER_TOOLS = "ae:enchanter_tools";
const ENCHANTER_PVP = "ae:enchanter_pvp";

const E = (id, level) => ({ id, level });
const DUR = [E("unbreaking", 3), E("mending", 1)];

// Armor sets are shared by both enchanters (every piece maxed).
const ARMOR = {
  helmet: [E("protection", 4), E("respiration", 3), E("aqua_affinity", 1), E("thorns", 3), ...DUR],
  chest: [E("protection", 4), E("thorns", 3), ...DUR],
  leggings: [E("protection", 4), E("thorns", 3), E("swift_sneak", 3), ...DUR],
  boots: [
    E("protection", 4), E("thorns", 3), E("feather_falling", 4),
    E("depth_strider", 3), E("frost_walker", 2), E("soul_speed", 3), ...DUR,
  ],
};

// Big ordered super-set for unknown / modded enchantable items. Conflicts are
// resolved by order (first wins; the conflicting one throws and is skipped).
const ALL = [
  E("sharpness", 5), E("impaling", 5), E("density", 5),
  E("efficiency", 5), E("fortune", 3),
  E("power", 5), E("flame", 1), E("punch", 2), E("infinity", 1),
  E("multishot", 1), E("piercing", 4), E("quick_charge", 3),
  E("breach", 4), E("wind_burst", 3),
  E("fire_aspect", 2), E("looting", 3), E("knockback", 2), E("lunge", 3),
  E("loyalty", 3), E("channeling", 1),
  E("lure", 3), E("luck_of_the_sea", 3),
  E("protection", 4), E("thorns", 3), E("respiration", 3), E("aqua_affinity", 1),
  E("feather_falling", 4), E("depth_strider", 3), E("frost_walker", 2),
  E("soul_speed", 3), E("swift_sneak", 3),
  E("unbreaking", 3), E("mending", 1),
];

const TOOLS = {
  pickaxe: [E("efficiency", 5), E("fortune", 3), ...DUR],
  shovel: [E("efficiency", 5), E("fortune", 3), ...DUR],
  axe: [E("efficiency", 5), E("fortune", 3), E("sharpness", 5), ...DUR], // tool + bite
  hoe: [E("efficiency", 5), E("fortune", 3), ...DUR],
  shears: [E("efficiency", 5), ...DUR],
  flint_and_steel: [...DUR],
  fishing_rod: [E("lure", 3), E("luck_of_the_sea", 3), ...DUR],
  sword: [E("sharpness", 5), E("looting", 3), E("fire_aspect", 2), E("knockback", 2), ...DUR],
  spear: [E("lunge", 3), E("sharpness", 5), E("looting", 3), E("fire_aspect", 2), E("knockback", 2), ...DUR],
  mace: [E("density", 5), E("breach", 4), E("wind_burst", 3), E("fire_aspect", 2), ...DUR],
  bow: [E("power", 5), E("flame", 1), E("punch", 2), ...DUR], // Tools -> Mending
  crossbow: [E("piercing", 4), E("quick_charge", 3), ...DUR], // Tools -> Piercing
  trident: [E("impaling", 5), E("riptide", 3), ...DUR], // Tools -> Riptide
  ...ARMOR,
  elytra: [...DUR], // game limit: elytra only takes Unbreaking + Mending
  shield: [...DUR], // game limit: shield only takes Unbreaking + Mending
  other: ALL,
};

const PVP = {
  sword: [E("sharpness", 5), E("fire_aspect", 2), E("looting", 3), E("knockback", 2), ...DUR],
  spear: [E("sharpness", 5), E("lunge", 3), E("fire_aspect", 2), E("looting", 3), E("knockback", 2), ...DUR],
  axe: [E("sharpness", 5), E("efficiency", 5), E("fortune", 3), ...DUR], // weapon + tool
  mace: [E("density", 5), E("breach", 4), E("wind_burst", 3), E("fire_aspect", 2), ...DUR],
  pickaxe: [E("efficiency", 5), E("fortune", 3), ...DUR],
  shovel: [E("efficiency", 5), E("fortune", 3), ...DUR],
  hoe: [E("efficiency", 5), E("fortune", 3), ...DUR],
  shears: [E("efficiency", 5), ...DUR],
  flint_and_steel: [...DUR],
  fishing_rod: [E("lure", 3), E("luck_of_the_sea", 3), ...DUR],
  bow: [E("power", 5), E("flame", 1), E("punch", 2), E("infinity", 1), E("unbreaking", 3)], // PVP -> Infinity
  crossbow: [E("multishot", 1), E("quick_charge", 3), ...DUR], // PVP -> Multishot
  trident: [E("impaling", 5), E("loyalty", 3), E("channeling", 1), ...DUR], // PVP -> Loyalty/Channeling
  ...ARMOR,
  elytra: [...DUR],
  shield: [...DUR],
  other: ALL,
};

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

/**
 * Enchant the stack in place. Returns the list of enchantments actually present
 * afterwards ([] if none / not enchantable).
 */
function enchantItem(itemStack, loadout) {
  const ench = itemStack.getComponent(ItemComponentTypes.Enchantable);
  if (!ench) return [];

  try {
    ench.removeAllEnchantments();
  } catch (e) {}

  for (const { id, level } of loadout) {
    try {
      ench.addEnchantment({ type: new EnchantmentType(id), level });
    } catch (e) {
      // illegal for this item / conflict / unknown id on this version -> skip
    }
  }

  try {
    return ench.getEnchantments().map((e) => ({ id: e.type.id, level: e.level }));
  } catch (e) {
    return [];
  }
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = (n) => ROMAN[n] ?? String(n);

function pretty(idLike) {
  return idLike
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
  for (let i = 0; i < Math.min(9, total); i++) order.push(i);
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

function success(player, isTools, name, list) {
  const flavour = isTools ? "§bTools" : "§cPVP";
  const n = list.length;
  const names = list.map((e) => `§b${pretty(e.id)} ${roman(e.level)}`).join("§7, ");
  try {
    player.onScreenDisplay.setActionBar(
      `§a✦ ${flavour} §aenchanted §e${name} §awith §b${n} §aenchantment${n === 1 ? "" : "s"}!`
    );
    player.sendMessage(`§a✦ §e${name}§a: §7${names}`);
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

  const list = enchantItem(target.item, getLoadout(target.item.typeId, isTools));
  if (list.length === 0) {
    fail(player, `§e${pretty(target.item.typeId)} §ccan't take any enchantments.`);
    return;
  }

  container.setItem(target.slot, target.item);
  if (consume) consumeOne(container, heldSlot);
  success(player, isTools, pretty(target.item.typeId), list);
}

world.afterEvents.itemUse.subscribe((event) => {
  const player = event.source;
  const used = event.itemStack;
  if (!player || !used) return;
  if (used.typeId !== ENCHANTER_TOOLS && used.typeId !== ENCHANTER_PVP) return;
  runEnchant(player, used.typeId === ENCHANTER_TOOLS, { consume: true, preferHeld: false });
});

system.afterEvents.scriptEventReceive.subscribe((event) => {
  if (event.id !== "ae:tools" && event.id !== "ae:pvp") return;
  const player = event.sourceEntity;
  if (!player || player.typeId !== "minecraft:player") return;
  runEnchant(player, event.id === "ae:tools", { consume: false, preferHeld: true });
});

console.log("[Auto Enchanter] v3 loaded (direct addEnchantment, per-item maxed sets).");
