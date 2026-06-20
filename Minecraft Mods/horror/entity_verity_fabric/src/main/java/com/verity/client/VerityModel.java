package com.verity.client;

import com.verity.VerityEntity;
import net.minecraft.util.Identifier;
import software.bernie.geckolib.model.GeoModel;

public class VerityModel extends GeoModel<VerityEntity> {
    @Override
    public Identifier getModelResource(VerityEntity object) {
        return new Identifier("verity", "geo/entity_verity.geo.json");
    }

    @Override
    public Identifier getTextureResource(VerityEntity object) {
        return new Identifier("verity", "textures/entity/entity_verity.png");
    }

    @Override
    public Identifier getAnimationResource(VerityEntity object) {
        return new Identifier("verity", "animations/entity_verity.animation.json");
    }
}
