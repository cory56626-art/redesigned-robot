package net.marauder.state;

import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.world.PersistentState;
import net.minecraft.world.PersistentStateManager;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Server-authoritative persistent store of every player's Marauder rivalry.
 *
 * <p>Stored on the overworld's {@link PersistentStateManager} so it survives world
 * reloads and server restarts. Keyed by player UUID so multiplayer players each keep
 * an independent stage.</p>
 */
public class MarauderState extends PersistentState {

    private static final String KEY = "marauder_progress";

    private final Map<UUID, PlayerProgress> players = new HashMap<>();

    public static MarauderState get(MinecraftServer server) {
        ServerWorld overworld = server.getOverworld();
        PersistentStateManager manager = overworld.getPersistentStateManager();
        MarauderState state = manager.getOrCreate(
                MarauderState::createFromNbt,
                MarauderState::new,
                KEY);
        return state;
    }

    public PlayerProgress getOrCreate(UUID uuid) {
        return players.computeIfAbsent(uuid, u -> new PlayerProgress());
    }

    public PlayerProgress peek(UUID uuid) {
        return players.get(uuid);
    }

    @Override
    public NbtCompound writeNbt(NbtCompound nbt) {
        NbtList list = new NbtList();
        for (Map.Entry<UUID, PlayerProgress> e : players.entrySet()) {
            NbtCompound entry = e.getValue().writeNbt();
            entry.putUuid("uuid", e.getKey());
            list.add(entry);
        }
        nbt.put("players", list);
        return nbt;
    }

    public static MarauderState createFromNbt(NbtCompound nbt) {
        MarauderState state = new MarauderState();
        NbtList list = nbt.getList("players", NbtElement.COMPOUND_TYPE);
        for (int i = 0; i < list.size(); i++) {
            NbtCompound entry = list.getCompound(i);
            if (!entry.containsUuid("uuid")) {
                continue;
            }
            UUID uuid = entry.getUuid("uuid");
            state.players.put(uuid, PlayerProgress.fromNbt(entry));
        }
        return state;
    }
}
