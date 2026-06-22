package com.lobber.client;

import com.lobber.LobberMod;
import com.lobber.entity.LobberEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;

public class LobberRenderer extends MobEntityRenderer<LobberEntity, LobberModel> {
	private static final Identifier TEXTURE =
			new Identifier(LobberMod.MOD_ID, "textures/entity/lobber.png");

	public LobberRenderer(EntityRendererFactory.Context context) {
		super(context, new LobberModel(context.getPart(ModModelLayers.LOBBER)), 0.4f);
	}

	@Override
	protected void scale(LobberEntity entity, MatrixStack matrices, float amount) {
		// Grows from a small goblin to a full-size stalker as it matures.
		float s = entity.getGrowthScale();
		matrices.scale(s, s, s);
	}

	@Override
	public Identifier getTexture(LobberEntity entity) {
		return TEXTURE;
	}
}
