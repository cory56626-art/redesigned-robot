package com.lobber.client;

import com.lobber.entity.LobberEntity;
import com.lobber.entity.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.entity.FlyingItemEntityRenderer;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.minecraft.util.hit.EntityHitResult;
import org.lwjgl.glfw.GLFW;

import java.util.Comparator;
import java.util.List;

public class LobberClient implements ClientModInitializer {
	private static KeyBinding infoKey;

	@Override
	public void onInitializeClient() {
		EntityModelLayerRegistry.registerModelLayer(ModModelLayers.LOBBER, LobberModel::getTexturedModelData);
		EntityRendererRegistry.register(ModEntities.LOBBER, LobberRenderer::new);
		EntityRendererRegistry.register(ModEntities.LOBBED_BLOCK, FlyingItemEntityRenderer::new);

		infoKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.lobber.info", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_R, "key.categories.lobber"));

		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (infoKey.wasPressed()) {
				openInfoScreen(client);
			}
		});
	}

	private static void openInfoScreen(MinecraftClient client) {
		if (client.player == null || client.world == null || client.currentScreen != null) {
			return;
		}
		LobberEntity target = findTarget(client);
		if (target == null) {
			client.player.sendMessage(Text.translatable("message.lobber.none"), true);
			return;
		}
		if (target.getTrust() < LobberEntity.TRUST_FRIENDLY) {
			client.player.sendMessage(Text.translatable("message.lobber.untrusting"), true);
			return;
		}
		client.setScreen(new LobberInfoScreen(target));
	}

	private static LobberEntity findTarget(MinecraftClient client) {
		// Prefer whatever the crosshair is on.
		if (client.crosshairTarget instanceof EntityHitResult hit
				&& hit.getEntity() instanceof LobberEntity looked) {
			return looked;
		}
		// Otherwise the closest Lobber within reach.
		List<LobberEntity> nearby = client.world.getEntitiesByClass(
				LobberEntity.class, client.player.getBoundingBox().expand(8.0), e -> true);
		return nearby.stream()
				.min(Comparator.comparingDouble(e -> e.squaredDistanceTo(client.player)))
				.orElse(null);
	}
}
