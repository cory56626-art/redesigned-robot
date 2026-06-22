package com.lobber.world;

import com.lobber.LobberMod;
import com.lobber.config.LobberConfig;
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.util.Identifier;
import net.minecraft.world.gen.GenerationStep;
import net.minecraft.world.gen.feature.DefaultFeatureConfig;
import net.minecraft.world.gen.feature.Feature;
import net.minecraft.world.gen.feature.PlacedFeature;

public class ModWorldGen {
	public static final Feature<DefaultFeatureConfig> LOBBER_SHRINE =
			new LobberShrineFeature(DefaultFeatureConfig.CODEC);

	private static final RegistryKey<PlacedFeature> LOBBER_SHRINE_PLACED =
			RegistryKey.of(RegistryKeys.PLACED_FEATURE, new Identifier(LobberMod.MOD_ID, "lobber_shrine"));

	public static void register() {
		Registry.register(Registries.FEATURE, new Identifier(LobberMod.MOD_ID, "lobber_shrine"), LOBBER_SHRINE);

		if (LobberConfig.INSTANCE.generateShrines) {
			// The placed/configured features themselves live in the bundled datapack JSONs.
			BiomeModifications.addFeature(
					BiomeSelectors.foundInOverworld(),
					GenerationStep.Feature.UNDERGROUND_DECORATION,
					LOBBER_SHRINE_PLACED);
		}
	}
}
