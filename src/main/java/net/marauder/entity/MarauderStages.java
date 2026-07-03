package net.marauder.entity;

/**
 * Static balance table for the ten Marauder stages.
 *
 * <p>Index 0 is unused so that {@code data[stage]} lines up with the human-facing
 * stage number (1..10). Values are starting points taken from the design's
 * balance table and lightly tuned for readability in play.</p>
 */
public final class MarauderStages {

    public static final int MIN_STAGE = 1;
    public static final int MAX_STAGE = 10;

    /** Max health per stage (hearts * 2). */
    private static final double[] HEALTH = {
            0, 20, 28, 36, 50, 65, 80, 105, 135, 170, 260
    };

    /** Armor points per stage. */
    private static final double[] ARMOR = {
            0, 2, 3, 5, 7, 8, 10, 12, 14, 16, 20
    };

    /** Base melee attack damage per stage. */
    private static final double[] DAMAGE = {
            0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.5, 14.0
    };

    /** Movement speed attribute per stage. */
    private static final double[] SPEED = {
            0, 0.30, 0.31, 0.31, 0.32, 0.33, 0.34, 0.34, 0.35, 0.36, 0.37
    };

    /** Knockback resistance (0..1). */
    private static final double[] KB_RESIST = {
            0, 0.4, 0.45, 0.5, 0.6, 0.6, 0.7, 0.75, 0.8, 0.85, 0.95
    };

    /** Experience dropped on defeat. */
    private static final int[] XP = {
            0, 12, 18, 26, 40, 55, 70, 95, 120, 160, 250
    };

    private MarauderStages() {
    }

    public static int clamp(int stage) {
        if (stage < MIN_STAGE) return MIN_STAGE;
        if (stage > MAX_STAGE) return MAX_STAGE;
        return stage;
    }

    public static double health(int stage) {
        return HEALTH[clamp(stage)];
    }

    public static double armor(int stage) {
        return ARMOR[clamp(stage)];
    }

    public static double damage(int stage) {
        return DAMAGE[clamp(stage)];
    }

    public static double speed(int stage) {
        return SPEED[clamp(stage)];
    }

    public static double knockbackResistance(int stage) {
        return KB_RESIST[clamp(stage)];
    }

    public static int experience(int stage) {
        return XP[clamp(stage)];
    }

    /** Whether this stage shows a boss bar. */
    public static boolean hasBossBar(int stage) {
        return stage >= 7;
    }

    /** Whether this stage is the final voluntary duel. */
    public static boolean isFinal(int stage) {
        return stage >= MAX_STAGE;
    }

    /** Flavor name shown in messages and the boss bar. */
    public static String title(int stage) {
        switch (clamp(stage)) {
            case 1: return "The Marauder — Rusted Challenger";
            case 2: return "The Marauder — Scarred Pursuer";
            case 3: return "The Marauder — Oathbound Duelist";
            case 4: return "The Marauder — Blacksteel Marauder";
            case 5: return "The Marauder — Ashen Knight";
            case 6: return "The Marauder — Moonlit Executioner";
            case 7: return "The Marauder — Spellscarred Knight";
            case 8: return "The Marauder — Abyss-Touched Marauder";
            case 9: return "The Marauder — The Unbroken";
            case 10: return "The Marauder Ascendant";
            default: return "The Marauder";
        }
    }
}
