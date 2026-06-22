package com.lobber.client;

import com.lobber.LobberMod;
import com.lobber.entity.LobberEntity;
import com.lobber.entity.ModEntities;
import com.mojang.blaze3d.systems.RenderSystem;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.entity.FlyingItemEntityRenderer;
import net.minecraft.client.util.InputUtil;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import net.minecraft.util.hit.EntityHitResult;
import org.lwjgl.glfw.GLFW;

import java.util.Comparator;
import java.util.List;

public class LobberClient implements ClientModInitializer {
	private static final Identifier FACE_OVERLAY =
			new Identifier(LobberMod.MOD_ID, "textures/gui/lobber_face.png");
	private static final double FACE_RANGE = 30.0;

	private static KeyBinding infoKey;

	@Override
	public void onInitializeClient() {
		EntityModelLayerRegistry.registerModelLayer(ModModelLayers.LOBBER, LobberModel::getTexturedModelData);
		EntityModelLayerRegistry.registerModelLayer(ModModelLayers.LOBBER_ADULT, LobberAdultModel::getTexturedModelData);
		EntityRendererRegistry.register(ModEntities.LOBBER, LobberRenderer::new);
		EntityRendererRegistry.register(ModEntities.LOBBED_BLOCK, FlyingItemEntityRenderer::new);

		infoKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
				"key.lobber.info", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_R, "key.categories.lobber"));

		ClientTickEvents.END_CLIENT_TICK.register(client -> {
			while (infoKey.wasPressed()) {
				openInfoScreen(client);
			}
		});

		// The pale face creeps onto the screen as a hunting adult closes in.
		HudRenderCallback.EVENT.register(this::renderFaceOverlay);
	}

	private void renderFaceOverlay(DrawContext context, float tickDelta) {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client.player == null || client.world == null || client.options.hudHidden) {
			return;
		}
		LobberEntity hunter = client.world.getEntitiesByClass(LobberEntity.class,
						client.player.getBoundingBox().expand(FACE_RANGE),
						e -> e.isMature() && e.isProvoked()).stream()
				.min(Comparator.comparingDouble(e -> e.squaredDistanceTo(client.player)))
				.orElse(null);
		if (hunter == null) {
			return;
		}
		double distance = Math.sqrt(hunter.squaredDistanceTo(client.player));
		float alpha = (float) Math.max(0.0, Math.min(0.65, (FACE_RANGE - distance) / FACE_RANGE * 0.8));
		if (alpha <= 0.02f) {
			return;
		}

		int sw = context.getScaledWindowWidth();
		int sh = context.getScaledWindowHeight();
		int size = (int) (sh * 0.85);
		int x = (sw - size) / 2;
		int y = (sh - size) / 2;

		RenderSystem.enableBlend();
		RenderSystem.defaultBlendFunc();
		RenderSystem.setShaderColor(1.0f, 1.0f, 1.0f, alpha);
		context.drawTexture(FACE_OVERLAY, x, y, 0.0f, 0.0f, size, size, size, size);
		RenderSystem.setShaderColor(1.0f, 1.0f, 1.0f, 1.0f);
		RenderSystem.disableBlend();
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
		if (target.getTrust() < LobberEntity.TRUST_FRIENDLY && !target.isWorker()) {
			client.player.sendMessage(Text.translatable("message.lobber.untrusting"), true);
			return;
		}
		client.setScreen(new LobberInfoScreen(target));
	}

	private static LobberEntity findTarget(MinecraftClient client) {
		if (client.crosshairTarget instanceof EntityHitResult hit
				&& hit.getEntity() instanceof LobberEntity looked) {
			return looked;
		}
		List<LobberEntity> nearby = client.world.getEntitiesByClass(
				LobberEntity.class, client.player.getBoundingBox().expand(8.0), e -> true);
		return nearby.stream()
				.min(Comparator.comparingDouble(e -> e.squaredDistanceTo(client.player)))
				.orElse(null);
	}
}
