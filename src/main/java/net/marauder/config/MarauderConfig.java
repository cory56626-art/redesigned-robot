package net.marauder.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import net.marauder.Marauder;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Simple Gson-backed config at {@code config/marauder.json}. Loaded once on
 * startup; all fields have sane defaults that preserve the intended ten-night
 * rivalry without any editing.
 */
public class MarauderConfig {

    private static MarauderConfig INSTANCE = new MarauderConfig();

    // --- Encounter control ---
    /** Master switch for nightly ambushes. */
    public boolean enabled = true;
    /** Per-check (every 2s) probability of beginning an ambush once eligible. */
    public float spawnChance = 0.10f;
    /** Minimum whole nights between encounters (0 = every eligible night). */
    public int minNightsBetween = 0;
    /** Skip spawning if another Marauder is already within this radius. */
    public int maxConcurrentRadius = 40;

    // --- Combat feel ---
    /** Global multiplier on stage health. */
    public float healthMultiplier = 1.0f;
    /** Global multiplier on stage damage. */
    public float damageMultiplier = 1.0f;
    /** Seconds the Marauder observes from a distance before closing in. */
    public int stalkObserveSeconds = 4;
    /** Distance at which stalking flips into the challenge/duel. */
    public double challengeRadius = 14.0;

    // --- Presentation / rules ---
    /** Lowest stage that shows a boss bar. */
    public int bossBarMinStage = 7;
    /** Whether the Ashen Remnant rematch path is allowed. */
    public boolean rematchesEnabled = true;
    /** Whether the Night 10 final duel may set up near the player's base/respawn. */
    public boolean arenaNearBase = true;

    public static MarauderConfig get() {
        return INSTANCE;
    }

    private static Path path() {
        return FabricLoader.getInstance().getConfigDir().resolve("marauder.json");
    }

    /** Load from disk, writing a default file if none exists. */
    public static void load() {
        Gson gson = new GsonBuilder().setPrettyPrinting().create();
        Path file = path();
        try {
            if (Files.exists(file)) {
                String json = Files.readString(file);
                MarauderConfig loaded = gson.fromJson(json, MarauderConfig.class);
                if (loaded != null) {
                    INSTANCE = loaded;
                }
            }
            // Always (re)write so new fields appear for the user.
            Files.writeString(file, gson.toJson(INSTANCE));
        } catch (IOException | RuntimeException e) {
            Marauder.LOGGER.warn("Failed to load marauder config, using defaults", e);
            INSTANCE = new MarauderConfig();
        }
    }
}
