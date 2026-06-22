package com.lobber.client;

import com.lobber.LobberMod;
import com.lobber.entity.LobberEntity;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;

public class LobberRenderer extends MobEntityRenderer<LobberEntity, EntityModel<LobberEntity>> {
	private static final Identifier TEXTURE_BABY =
			new Identifier(LobberMod.MOD_ID, "textures/entity/lobber.png");
	private static final Identifier TEXTURE_ADULT =
			new Identifier(LobberMod.MOD_ID, "textures/entity/lobber_adult.png");

	private final EntityModel<LobberEntity> babyModel;
	private final EntityModel<LobberEntity> adultModel;

	public LobberRenderer(EntityRendererFactory.Context context) {
		super(context, new LobberModel(context.getPart(ModModelLayers.LOBBER)), 0.4f);
		this.babyModel = this.getModel();
		this.adultModel = new LobberAdultModel(context.getPart(ModModelLayers.LOBBER_ADULT));
	}

	@Override
	public void render(LobberEntity entity, float yaw, float tickDelta, MatrixStack matrices,
					   VertexConsumerProvider vertexConsumers, int light) {
		// Swap to the gaunt custom model once it has matured.
		this.model = entity.isMature() ? this.adultModel : this.babyModel;
		super.render(entity, yaw, tickDelta, matrices, vertexConsumers, light);
	}

	@Override
	protected void scale(LobberEntity entity, MatrixStack matrices, float amount) {
		float s = entity.getGrowthScale();
		matrices.scale(s, s, s);
	}

	@Override
	public Identifier getTexture(LobberEntity entity) {
		return entity.isMature() ? TEXTURE_ADULT : TEXTURE_BABY;
	}
}
