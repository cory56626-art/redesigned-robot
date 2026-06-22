package com.lobber.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.lobber.LobberMod;
import net.fabricmc.loader.api.FabricLoader;

import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Simple JSON config so players can dial back the Lobber's most destructive habits.
 * Lives at {@code config/lobber.json}.
 */
public class LobberConfig {
	// --- Tunables (all default to the full, fearsome experience) ---

	/** Stealing / smashing blocks and shattering windows. */
	public boolean enableGriefing = true;
	/** Setting fire to your base while you are away. */
	public boolean enableArson = true;
	/** Killing pets and animals left outside. */
	public boolean enablePetKilling = true;
	/** Hunting villagers out of jealousy. */
	public boolean enableVillagerHunting = true;
	/** Whether the underground lore shrines generate. */
	public boolean generateShrines = true;
	/** How many in-game days the Lobber takes to fully mature. */
	public int daysToMature = 6;

	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	public static LobberConfig INSTANCE = new LobberConfig();

	public static void load() {
		try {
			Path path = FabricLoader.getInstance().getConfigDir().resolve("lobber.json");
			// The config directory may not exist yet on a fresh instance; make sure it does
			// before we try to read or write, otherwise the file silently never gets created.
			Files.createDirectories(path.getParent());

			if (Files.exists(path)) {
				try (Reader reader = Files.newBufferedReader(path)) {
					LobberConfig loaded = GSON.fromJson(reader, LobberConfig.class);
					if (loaded != null) {
						INSTANCE = loaded;
					}
				} catch (Exception parseError) {
					LobberMod.LOGGER.warn("Lobber config was malformed, regenerating defaults", parseError);
					INSTANCE = new LobberConfig();
				}
			}
			if (INSTANCE.daysToMature < 1) {
				INSTANCE.daysToMature = 1;
			}
			// (Re)write so new/missing keys get sensible defaults filled in and a corrupt file self-heals.
			try (Writer writer = Files.newBufferedWriter(path)) {
				GSON.toJson(INSTANCE, writer);
			}
			LobberMod.LOGGER.info(
					"Lobber config loaded: griefing={}, arson={}, petKilling={}, villagerHunting={}, shrines={}, daysToMature={}",
					INSTANCE.enableGriefing, INSTANCE.enableArson, INSTANCE.enablePetKilling,
					INSTANCE.enableVillagerHunting, INSTANCE.generateShrines, INSTANCE.daysToMature);
		} catch (Exception e) {
			LobberMod.LOGGER.warn("Could not load Lobber config, using defaults", e);
			INSTANCE = new LobberConfig();
		}
	}
}
