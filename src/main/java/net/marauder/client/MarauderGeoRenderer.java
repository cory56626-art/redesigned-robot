package net.marauder.client;

import net.marauder.entity.MarauderEntity;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.item.ItemStack;
import software.bernie.geckolib.cache.object.BakedGeoModel;
import software.bernie.geckolib.cache.object.GeoBone;
import software.bernie.geckolib.renderer.GeoEntityRenderer;
import software.bernie.geckolib.renderer.layer.BlockAndItemGeoLayer;

/**
 * Renders the Marauder's flame-knight model. Extra arms, the spiked crown and the
 * fiery halo are hidden at lower stages and revealed as the curse consumes him,
 * culminating in the full six-armed crowned form at Night 10. The primary hand
 * renders the currently-held blade.
 */
public class MarauderGeoRenderer extends GeoEntityRenderer<MarauderEntity> {

    public MarauderGeoRenderer(EntityRendererFactory.Context ctx) {
        super(ctx, new MarauderGeoModel());
        this.shadowRadius = 0.6f;

        // Render the held blade at the primary right hand bone.
        this.addRenderLayer(new BlockAndItemGeoLayer<>(this,
                (bone, entity) -> "right_hand".equals(bone.getName()) ? entity.getMainHandStack() : ItemStack.EMPTY,
                (bone, entity) -> null));
    }

    @Override
    public void preRender(MatrixStack poseStack, MarauderEntity animatable, BakedGeoModel model,
                          VertexConsumerProvider bufferSource, VertexConsumer buffer, boolean isReRender,
                          float partialTick, int packedLight, int packedOverlay,
                          float red, float green, float blue, float alpha) {
        int stage = animatable.getStage();
        setHidden(model, "crown", stage < 4);
        setHidden(model, "halo", stage < 6);
        setHidden(model, "arm_right_2", stage < 6);
        setHidden(model, "arm_left_2", stage < 6);
        setHidden(model, "arm_right_3", stage < 8);
        setHidden(model, "arm_left_3", stage < 8);
        super.preRender(poseStack, animatable, model, bufferSource, buffer, isReRender, partialTick,
                packedLight, packedOverlay, red, green, blue, alpha);
    }

    private static void setHidden(BakedGeoModel model, String bone, boolean hidden) {
        model.getBone(bone).ifPresent(b -> {
            b.setHidden(hidden);
            b.setChildrenHidden(hidden);
        });
    }

    @Override
    public net.minecraft.util.Identifier getTextureLocation(MarauderEntity animatable) {
        return getGeoModel().getTextureResource(animatable);
    }
}
