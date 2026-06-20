package com.lobber.client;

import com.lobber.entity.LobberEntity;
import net.minecraft.client.model.Dilation;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.BipedEntityModel;

/**
 * A standard humanoid (biped) rig, reused so the limbs animate for free. The Lobber is made to
 * read as a short, skinny enderman-cousin via a small hitbox and a down-scale in the renderer.
 */
public class LobberModel extends BipedEntityModel<LobberEntity> {

	public LobberModel(ModelPart root) {
		super(root);
		// The Lobber has no hood/hat overlay.
		this.hat.visible = false;
	}

	public static TexturedModelData getTexturedModelData() {
		ModelData modelData = BipedEntityModel.getModelData(Dilation.NONE, 0.0f);
		return TexturedModelData.of(modelData, 64, 64);
	}
}
