package com.lobber.entity;

import com.lobber.LobberMod;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModEntities {
	public static EntityType<LobberEntity> LOBBER;
	public static EntityType<LobbedBlockEntity> LOBBED_BLOCK;

	public static void registerEntities() {
		LOBBER = Registry.register(
				Registries.ENTITY_TYPE,
				new Identifier(LobberMod.MOD_ID, "lobber"),
				EntityType.Builder.create(LobberEntity::new, SpawnGroup.MONSTER)
						.setDimensions(0.6f, 1.8f)
						.maxTrackingRange(10)
						.build("lobber"));

		LOBBED_BLOCK = Registry.register(
				Registries.ENTITY_TYPE,
				new Identifier(LobberMod.MOD_ID, "lobbed_block"),
				EntityType.Builder.<LobbedBlockEntity>create(LobbedBlockEntity::new, SpawnGroup.MISC)
						.setDimensions(0.4f, 0.4f)
						.maxTrackingRange(64)
						.trackingTickInterval(2)
						.build("lobbed_block"));

		FabricDefaultAttributeRegistry.register(LOBBER, LobberEntity.createLobberAttributes());
	}
}
