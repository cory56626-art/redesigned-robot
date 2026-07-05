/**
 * Harvester management panel.
 *
 * Custom blocks can't expose a native drag-and-drop container, so the Harvester
 * uses a script ActionForm: it shows live status and offers deposit / collect
 * buttons that shuttle items between the player's main hand and the machine's
 * companion inventory. Robust, and works entirely from the Script API.
 *
 * @module ui/harvesterUI
 */
import { system, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { CONFIG } from "../core/config.js";
import { safe } from "../core/util.js";
import { invOf, isFuel, isValidInput } from "../machines/harvester.js";
import { getChumScore } from "../systems/chum.js";

const S = CONFIG.harvester.slots;

function heldItem(player) {
  const equip = safe(() =>
    player.getComponent(EntityComponentTypes.Equippable ?? "minecraft:equippable")
  );
  return equip ? { equip, item: equip.getEquipment(EquipmentSlot.Mainhand) } : { equip: null, item: null };
}

function slotSummary(container, slot, label) {
  const it = container.getItem(slot);
  const name = it ? `${it.typeId.replace("custom:", "").replace("minecraft:", "")} x${it.amount}` : "§8empty";
  return `§7${label}: §f${name}`;
}

/** Deposit the player's held stack into a machine slot (validated + stacking). */
function depositHeld(player, container, slot, validator) {
  const { equip, item } = heldItem(player);
  if (!equip || !item) {
    safe(() => player.onScreenDisplay.setActionBar("§cHold an item to insert."));
    return;
  }
  if (validator && !validator(item)) {
    safe(() => player.onScreenDisplay.setActionBar("§cThat doesn't belong in this slot."));
    return;
  }
  const existing = container.getItem(slot);
  if (!existing) {
    container.setItem(slot, item);
    equip.setEquipment(EquipmentSlot.Mainhand, undefined);
  } else if (existing.typeId === item.typeId) {
    const space = existing.maxAmount - existing.amount;
    const moved = Math.min(space, item.amount);
    existing.amount += moved;
    container.setItem(slot, existing);
    if (item.amount - moved > 0) {
      item.amount -= moved;
      equip.setEquipment(EquipmentSlot.Mainhand, item);
    } else {
      equip.setEquipment(EquipmentSlot.Mainhand, undefined);
    }
  } else {
    // Swap.
    container.setItem(slot, item);
    equip.setEquipment(EquipmentSlot.Mainhand, existing);
  }
}

/** Collect a machine output slot into the player's inventory. */
function collect(player, container, slot) {
  const it = container.getItem(slot);
  if (!it) {
    safe(() => player.onScreenDisplay.setActionBar("§7Nothing to collect."));
    return;
  }
  const inv = safe(() =>
    player.getComponent(EntityComponentTypes.Inventory ?? "minecraft:inventory")
  );
  if (!inv) return;
  const leftover = inv.container.addItem(it);
  container.setItem(slot, leftover); // undefined if fully collected
}

export function openHarvesterUI(player, entity, block) {
  const container = invOf(entity);
  if (!container) return;

  const progress = Number(entity.getDynamicProperty("of:progress") ?? 0);
  const fuel = Number(entity.getDynamicProperty("of:fuel") ?? 0);
  const pct = Math.floor((progress / CONFIG.harvester.processTicks) * 100);
  const fuelSecs = (fuel / 20).toFixed(0);

  const body = [
    `§8» §4T H E   H A R V E S T E R §8«`,
    ``,
    `§7Grind progress: §c${pct}%`,
    `§7Fuel remaining: §6${fuelSecs}s`,
    `§7Local chum: §2${getChumScore()}`,
    ``,
    slotSummary(container, S.FUEL, "Fuel"),
    slotSummary(container, S.INPUT, "Carcass"),
    slotSummary(container, S.CATALYST, "Catalyst"),
    slotSummary(container, S.OUT_SINEW, "Sinew"),
    slotSummary(container, S.OUT_BONE, "Bone"),
    slotSummary(container, S.OUT_BYPRODUCT, "Byproduct"),
  ].join("\n");

  const form = new ActionFormData()
    .title("The Harvester")
    .body(body)
    .button("Insert Fuel §8(held)", "textures/items/coal")
    .button("Insert Carcass §8(held)", "textures/of/items/raw_carcass")
    .button("Insert Catalyst §8(held)")
    .button("Collect Sinew", "textures/of/items/sinew")
    .button("Collect Bone", "textures/of/items/dense_bone")
    .button("Collect Byproduct")
    .button("§7Refresh");

  form.show(player).then((res) => {
    if (res.canceled) return;
    switch (res.selection) {
      case 0:
        depositHeld(player, container, S.FUEL, isFuel);
        break;
      case 1:
        depositHeld(player, container, S.INPUT, isValidInput);
        break;
      case 2:
        depositHeld(player, container, S.CATALYST, null);
        break;
      case 3:
        collect(player, container, S.OUT_SINEW);
        break;
      case 4:
        collect(player, container, S.OUT_BONE);
        break;
      case 5:
        collect(player, container, S.OUT_BYPRODUCT);
        break;
      case 6:
      default:
        break;
    }
    // Re-open next tick so the panel reflects the change and stays live.
    system.run(() => safe(() => openHarvesterUI(player, entity, block)));
  });
}
