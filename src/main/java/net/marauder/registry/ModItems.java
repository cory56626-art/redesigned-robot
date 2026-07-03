package net.marauder.registry;

import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.marauder.Marauder;
import net.marauder.item.AshenRemnantItem;
import net.marauder.item.BlacksteelBladeItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

/**
 * Reward and crafting-material items granted across the ten nights.
 */
public final class ModItems {

    // Progression crafting materials.
    public static Item DARK_SCRAP;
    public static Item BLACKSTEEL_FRAGMENT;
    public static Item ASHEN_SHARD;
    public static Item MOON_SHARD;
    public static Item RUNE_FRAGMENT;
    public static Item ABYSS_FRAGMENT;
    public static Item UNBROKEN_CORE;
    public static Item MARAUDER_TROPHY;

    // Special items.
    public static BlacksteelBladeItem BLACKSTEEL_BLADE;
    public static AshenRemnantItem ASHEN_REMNANT;

    private ModItems() {
    }

    public static void register() {
        DARK_SCRAP = simple("dark_scrap");
        BLACKSTEEL_FRAGMENT = simple("blacksteel_fragment");
        ASHEN_SHARD = simple("ashen_shard");
        MOON_SHARD = simple("moon_shard");
        RUNE_FRAGMENT = simple("rune_fragment");
        ABYSS_FRAGMENT = simple("abyss_fragment");
        UNBROKEN_CORE = simple("unbroken_core");
        MARAUDER_TROPHY = simple("marauder_trophy");

        BLACKSTEEL_BLADE = (BlacksteelBladeItem) Registry.register(
                Registries.ITEM,
                new Identifier(Marauder.MOD_ID, "blacksteel_blade"),
                new BlacksteelBladeItem(new Item.Settings().maxCount(1).maxDamage(1561).fireproof()));

        ASHEN_REMNANT = (AshenRemnantItem) Registry.register(
                Registries.ITEM,
                new Identifier(Marauder.MOD_ID, "ashen_remnant"),
                new AshenRemnantItem(new Item.Settings().maxCount(1).rarity(net.minecraft.util.Rarity.EPIC)));

        // Surface everything in the creative combat/ingredients tabs for testing and crafting.
        ItemGroupEvents.modifyEntriesEvent(ItemGroups.COMBAT).register(entries -> {
            entries.add(BLACKSTEEL_BLADE);
        });
        ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS).register(entries -> {
            entries.add(DARK_SCRAP);
            entries.add(BLACKSTEEL_FRAGMENT);
            entries.add(ASHEN_SHARD);
            entries.add(MOON_SHARD);
            entries.add(RUNE_FRAGMENT);
            entries.add(ABYSS_FRAGMENT);
            entries.add(UNBROKEN_CORE);
            entries.add(MARAUDER_TROPHY);
            entries.add(ASHEN_REMNANT);
        });
    }

    private static Item simple(String name) {
        return Registry.register(
                Registries.ITEM,
                new Identifier(Marauder.MOD_ID, name),
                new Item(new Item.Settings()));
    }
}
