package com.lobber.client;

import com.lobber.entity.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.render.entity.FlyingItemEntityRenderer;

public class LobberClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		EntityModelLayerRegistry.registerModelLayer(ModModelLayers.LOBBER, LobberModel::getTexturedModelData);
		EntityRendererRegistry.register(ModEntities.LOBBER, LobberRenderer::new);
		EntityRendererRegistry.register(ModEntities.LOBBED_BLOCK, FlyingItemEntityRenderer::new);
	}
}
