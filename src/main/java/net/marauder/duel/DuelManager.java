package net.marauder.duel;

import net.marauder.entity.MarauderEntity;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Lightweight server-side registry mapping each player to their single active
 * Marauder, so the night manager never spawns two rivals for one player and so
 * ownership of a duel is unambiguous.
 */
public final class DuelManager {

    private static final Map<UUID, MarauderEntity> ACTIVE = new HashMap<>();

    private DuelManager() {
    }

    public static boolean hasActive(UUID player) {
        MarauderEntity e = ACTIVE.get(player);
        if (e != null && (e.isRemoved() || !e.isAlive())) {
            ACTIVE.remove(player);
            return false;
        }
        return e != null;
    }

    public static MarauderEntity get(UUID player) {
        return ACTIVE.get(player);
    }

    public static void register(UUID player, MarauderEntity marauder) {
        ACTIVE.put(player, marauder);
    }

    public static void clear(UUID player, MarauderEntity marauder) {
        MarauderEntity current = ACTIVE.get(player);
        if (current == marauder) {
            ACTIVE.remove(player);
        }
    }
}
