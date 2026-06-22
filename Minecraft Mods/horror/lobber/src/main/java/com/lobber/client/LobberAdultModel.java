package com.lobber.client;

import com.lobber.entity.LobberEntity;
import net.minecraft.client.model.Dilation;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.SinglePartEntityModel;
import net.minecraft.util.math.MathHelper;

/**
 * A fully custom model for the matured Lobber: tall, gaunt, hunched, with a small skull-like head,
 * a thin ribbed chest, and long spindly limbs - built after the reference of an emaciated forest
 * humanoid. Stalker poses (lean / stare / hunt) re-shape it on the fly.
 */
public class LobberAdultModel extends SinglePartEntityModel<LobberEntity> {
	private static final float DEG = (float) Math.PI / 180.0f;

	private final ModelPart root;
	private final ModelPart body;
	private final ModelPart head;
	private final ModelPart rightArm;
	private final ModelPart leftArm;
	private final ModelPart rightLeg;
	private final ModelPart leftLeg;

	public LobberAdultModel(ModelPart root) {
		this.root = root;
		this.body = root.getChild("body");
		this.head = this.body.getChild("head");
		this.rightArm = this.body.getChild("right_arm");
		this.leftArm = this.body.getChild("left_arm");
		this.rightLeg = this.body.getChild("right_leg");
		this.leftLeg = this.body.getChild("left_leg");
	}

	public static TexturedModelData getTexturedModelData() {
		ModelData modelData = new ModelData();
		ModelPartData root = modelData.getRoot();

		// Torso: a short hip block and a long, thin ribbed chest. y=0 is the hip line, +y is down.
		ModelPartData body = root.addChild("body",
				ModelPartBuilder.create()
						.uv(0, 0).cuboid(-3.0f, -2.0f, -1.5f, 6.0f, 4.0f, 3.0f)      // hips
						.uv(0, 8).cuboid(-3.0f, -14.0f, -1.5f, 6.0f, 12.0f, 3.0f),   // ribcage
				ModelTransform.pivot(0.0f, 0.0f, 0.0f));

		// Head: thin neck + small skull, attached at the top of the chest.
		body.addChild("head",
				ModelPartBuilder.create()
						.uv(40, 0).cuboid(-1.5f, -3.0f, -1.5f, 3.0f, 3.0f, 3.0f)     // neck
						.uv(20, 0).cuboid(-2.5f, -8.0f, -2.5f, 5.0f, 5.0f, 5.0f),    // skull
				ModelTransform.pivot(0.0f, -14.0f, 0.0f));

		// Long spindly arms hanging from high, narrow shoulders.
		body.addChild("right_arm",
				ModelPartBuilder.create()
						.uv(0, 24).cuboid(-1.5f, 0.0f, -1.0f, 2.0f, 18.0f, 2.0f),
				ModelTransform.pivot(-3.5f, -12.0f, 0.0f));
		body.addChild("left_arm",
				ModelPartBuilder.create().mirrored()
						.uv(16, 24).cuboid(-0.5f, 0.0f, -1.0f, 2.0f, 18.0f, 2.0f),
				ModelTransform.pivot(3.5f, -12.0f, 0.0f));

		// Long thin legs reaching the ground.
		body.addChild("right_leg",
				ModelPartBuilder.create()
						.uv(32, 24).cuboid(-1.5f, 0.0f, -1.5f, 3.0f, 22.0f, 3.0f),
				ModelTransform.pivot(-1.5f, 2.0f, 0.0f));
		body.addChild("left_leg",
				ModelPartBuilder.create().mirrored()
						.uv(48, 24).cuboid(-1.5f, 0.0f, -1.5f, 3.0f, 22.0f, 3.0f),
				ModelTransform.pivot(1.5f, 2.0f, 0.0f));

		return TexturedModelData.of(modelData, 64, 64);
	}

	@Override
	public ModelPart getPart() {
		return this.root;
	}

	@Override
	public void setAngles(LobberEntity entity, float limbAngle, float limbDistance,
						  float animationProgress, float headYaw, float headPitch) {
		// Default gaunt hunch.
		this.body.pitch = 0.12f;
		this.body.roll = MathHelper.sin(animationProgress * 0.05f) * 0.04f; // slow idle sway
		this.head.yaw = headYaw * DEG;
		this.head.pitch = headPitch * DEG + 0.10f;
		this.head.roll = 0.0f;

		// Loping limb swing.
		float swing = MathHelper.cos(limbAngle * 0.5f) * limbDistance;
		this.rightLeg.pitch = swing;
		this.leftLeg.pitch = -swing;
		this.rightArm.pitch = -swing * 0.6f;
		this.leftArm.pitch = swing * 0.6f;
		this.rightArm.roll = 0.05f;
		this.leftArm.roll = -0.05f;

		switch (entity.getStalkPose()) {
			case LobberEntity.POSE_HUNT -> {
				// Crouched, reaching forward as it closes in.
				this.body.pitch = 0.32f;
				this.head.pitch += 0.25f;
				this.rightArm.pitch -= 0.6f;
				this.leftArm.pitch -= 0.6f;
			}
			case LobberEntity.POSE_LEAN -> {
				// Leaning sideways, peering out from behind a tree.
				this.body.roll += 0.55f;
				this.body.pitch = 0.05f;
				this.head.yaw += 0.35f;
			}
			case LobberEntity.POSE_STARE -> {
				// Bolt upright, head tilted, a slow distant stare.
				this.body.pitch = -0.02f;
				this.head.pitch = -0.18f;
				this.head.roll = 0.12f;
			}
			default -> this.head.roll = 0.0f;
		}
	}
}
