package com.verity;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.item.SpawnEggItem;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.sound.SoundEvent;
import net.minecraft.util.Identifier;
import net.minecraft.world.Heightmap;
import net.minecraft.entity.SpawnRestriction;

public class EntityVerityMod implements ModInitializer {
    public static final String MOD_ID = "verity";

    public static final EntityType<VerityEntity> VERITY = Registry.register(
            Registries.ENTITY_TYPE,
            new Identifier(MOD_ID, "entity_verity"),
            EntityType.Builder.create(VerityEntity::new, SpawnGroup.MONSTER)
                    .setDimensions(0.6f, 2.9f)
                    .maxTrackingRange(12)
                    .build("entity_verity"));

    public static final SoundEvent SCREAM = registerSound("entity.verity.scream");
    public static final SoundEvent BONECRACK = registerSound("entity.verity.bonecrack");

    public static final Item SPAWN_EGG = Registry.register(
            Registries.ITEM,
            new Identifier(MOD_ID, "verity_spawn_egg"),
            new SpawnEggItem(VERITY, 0xCAB84A, 0x1A1A1A, new Item.Settings()));

    private static SoundEvent registerSound(String path) {
        Identifier id = new Identifier(MOD_ID, path);
        return Registry.register(Registries.SOUND_EVENT, id, SoundEvent.of(id));
    }

    @Override
    public void onInitialize() {
        FabricDefaultAttributeRegistry.register(VERITY, VerityEntity.createAttributes());

        SpawnRestriction.register(VERITY, SpawnRestriction.Location.ON_GROUND,
                Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, HostileEntity::canSpawnInDark);

        // natural night spawning across the overworld
        BiomeModifications.addSpawn(BiomeSelectors.foundInOverworld(),
                SpawnGroup.MONSTER, VERITY, 8, 1, 1);

        // put the spawn egg in the Spawn Eggs creative tab
        ItemGroupEvents.modifyEntriesEvent(ItemGroups.SPAWN_EGGS).register(entries -> entries.add(SPAWN_EGG));

        // commands: /verity <spawn|come|chase|stop|door|glass>
        CommandRegistrationCallback.EVENT.register((dispatcher, access, env) ->
                VerityCommands.register(dispatcher));
    }
}
