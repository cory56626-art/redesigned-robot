package com.lobber.client;

import com.lobber.LobberMod;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.util.Identifier;

public class ModModelLayers {
	public static final EntityModelLayer LOBBER =
			new EntityModelLayer(new Identifier(LobberMod.MOD_ID, "lobber"), "main");
}
