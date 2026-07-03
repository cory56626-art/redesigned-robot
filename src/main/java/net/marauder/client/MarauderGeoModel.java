package net.marauder.client;

import net.marauder.Marauder;
import net.marauder.entity.MarauderEntity;
import net.minecraft.util.Identifier;
import software.bernie.geckolib.model.GeoModel;

/**
 * Resolves the shared geometry/animation and the per-stage texture for the
 * Marauder's GeckoLib model.
 */
public class MarauderGeoModel extends GeoModel<MarauderEntity> {

    private static final Identifier MODEL = new Identifier(Marauder.MOD_ID, "geo/marauder.geo.json");
    private static final Identifier ANIMATION = new Identifier(Marauder.MOD_ID, "animations/marauder.animation.json");
    private static final Identifier[] TEXTURES = new Identifier[11];

    static {
        for (int stage = 1; stage <= 10; stage++) {
            TEXTURES[stage] = new Identifier(Marauder.MOD_ID, "textures/entity/marauder_" + stage + ".png");
        }
    }

    @Override
    public Identifier getModelResource(MarauderEntity animatable) {
        return MODEL;
    }

    @Override
    public Identifier getTextureResource(MarauderEntity animatable) {
        int stage = Math.max(1, Math.min(10, animatable.getStage()));
        return TEXTURES[stage];
    }

    @Override
    public Identifier getAnimationResource(MarauderEntity animatable) {
        return ANIMATION;
    }
}
