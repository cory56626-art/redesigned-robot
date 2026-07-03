package net.marauder.client;

import net.marauder.Marauder;
import net.marauder.entity.MarauderEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.client.render.entity.feature.HeldItemFeatureRenderer;
import net.minecraft.client.render.entity.model.EntityModelLayers;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.util.Identifier;

/**
 * Renders the Marauder as a dark humanoid knight using the vanilla player model,
 * with a staged texture and its held blade. The evolving look across the ten
 * nights comes from the per-stage texture variants.
 */
public class MarauderEntityRenderer extends MobEntityRenderer<MarauderEntity, PlayerEntityModel<MarauderEntity>> {

    private static final Identifier[] TEXTURES = new Identifier[11];

    static {
        for (int stage = 1; stage <= 10; stage++) {
            TEXTURES[stage] = new Identifier(Marauder.MOD_ID, "textures/entity/marauder_" + stage + ".png");
        }
    }

    public MarauderEntityRenderer(EntityRendererFactory.Context ctx) {
        super(ctx, new PlayerEntityModel<>(ctx.getPart(EntityModelLayers.PLAYER), false), 0.5f);
        this.addFeature(new HeldItemFeatureRenderer<>(this, ctx.getHeldItemRenderer()));
    }

    @Override
    public Identifier getTexture(MarauderEntity entity) {
        int stage = Math.max(1, Math.min(10, entity.getStage()));
        return TEXTURES[stage];
    }
}
