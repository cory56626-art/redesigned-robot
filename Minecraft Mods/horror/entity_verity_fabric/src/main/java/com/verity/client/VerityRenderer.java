package com.verity.client;

import com.verity.VerityEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import software.bernie.geckolib.renderer.GeoEntityRenderer;

public class VerityRenderer extends GeoEntityRenderer<VerityEntity> {
    public VerityRenderer(EntityRendererFactory.Context context) {
        super(context, new VerityModel());
    }
}
