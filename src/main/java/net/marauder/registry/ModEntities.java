package net.marauder.registry;

import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.marauder.Marauder;
import net.marauder.entity.MarauderEntity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public final class ModEntities {

    public static EntityType<MarauderEntity> MARAUDER;

    private ModEntities() {
    }

    public static void register() {
        MARAUDER = Registry.register(
                Registries.ENTITY_TYPE,
                new Identifier(Marauder.MOD_ID, "marauder"),
                EntityType.Builder.<MarauderEntity>create(MarauderEntity::new, SpawnGroup.MONSTER)
                        .setDimensions(0.6f, 1.95f)
                        .maxTrackingRange(80)
                        .trackingTickInterval(2)
                        .build("marauder"));

        FabricDefaultAttributeRegistry.register(MARAUDER, MarauderEntity.createMarauderAttributes());
    }
}
