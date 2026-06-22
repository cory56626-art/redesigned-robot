package com.lobber;

import com.lobber.config.LobberConfig;
import com.lobber.entity.ModEntities;
import com.lobber.spawn.LobberSpawner;
import com.lobber.world.ModWorldGen;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class LobberMod implements ModInitializer {
	public static final String MOD_ID = "lobber";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		LobberConfig.load();
		ModEntities.registerEntities();
		ModWorldGen.register();

		// Drives the custom, single-Lobber-per-world spawning rules.
		ServerTickEvents.END_WORLD_TICK.register(LobberSpawner::tick);

		LOGGER.info("The Lobber is lurking...");
	}
}
