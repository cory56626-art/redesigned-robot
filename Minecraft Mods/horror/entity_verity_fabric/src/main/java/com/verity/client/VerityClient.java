package com.verity.client;

import com.verity.EntityVerityMod;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

public class VerityClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        EntityRendererRegistry.register(EntityVerityMod.VERITY, VerityRenderer::new);
    }
}
