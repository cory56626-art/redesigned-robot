package net.marauder.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.marauder.registry.ModEntities;

public class MarauderClient implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        EntityRendererRegistry.register(ModEntities.MARAUDER, MarauderGeoRenderer::new);
    }
}
