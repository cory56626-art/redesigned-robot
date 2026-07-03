package net.marauder;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.marauder.night.NightManager;
import net.marauder.registry.ModEntities;
import net.marauder.registry.ModItems;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class Marauder implements ModInitializer {

    public static final String MOD_ID = "marauder";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModEntities.register();
        ModItems.register();

        // Server-authoritative night controller drives eligibility, spawning and cleanup.
        ServerTickEvents.END_SERVER_TICK.register(NightManager::tick);

        LOGGER.info("The Marauder awakens. The hunt begins at dusk.");
    }
}
