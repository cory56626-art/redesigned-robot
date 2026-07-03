package net.marauder.entity;

/**
 * The Marauder's high-level AI state. Ordinals are synced to the client via the
 * data tracker so the renderer can vary particles and glow per state.
 */
public enum Behavior {
    IDLE_DORMANT,
    STALKING,
    AMBUSH_WAIT,
    CHALLENGE,
    DUELING,
    REPOSITIONING,
    RETREATING,
    DEFEATED,
    FINAL_WAIT,
    FINAL_DUEL;

    private static final Behavior[] VALUES = values();

    public static Behavior byId(int id) {
        if (id < 0 || id >= VALUES.length) {
            return IDLE_DORMANT;
        }
        return VALUES[id];
    }

    public boolean isCombat() {
        return this == DUELING || this == FINAL_DUEL || this == REPOSITIONING;
    }
}
