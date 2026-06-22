package com.lobber.entity;

import net.minecraft.nbt.NbtCompound;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

/**
 * World-saved continuity for the Lobber. Because a Lobber vanishes when it disengages (and a fresh,
 * angrier one returns later), this carries its grudge (aggression), its memory of you (trust), and
 * who it fixated on across those disappearances.
 */
public class LobberState extends PersistentState {
	public int aggression = 0;
	public int trust = 0;
	public boolean hasBond = false;
	public long bondMost = 0L;
	public long bondLeast = 0L;

	public static LobberState fromNbt(NbtCompound nbt) {
		LobberState state = new LobberState();
		state.aggression = nbt.getInt("Aggression");
		state.trust = nbt.getInt("Trust");
		state.hasBond = nbt.getBoolean("HasBond");
		state.bondMost = nbt.getLong("BondMost");
		state.bondLeast = nbt.getLong("BondLeast");
		return state;
	}

	@Override
	public NbtCompound writeNbt(NbtCompound nbt) {
		nbt.putInt("Aggression", this.aggression);
		nbt.putInt("Trust", this.trust);
		nbt.putBoolean("HasBond", this.hasBond);
		nbt.putLong("BondMost", this.bondMost);
		nbt.putLong("BondLeast", this.bondLeast);
		return nbt;
	}

	public static LobberState get(ServerWorld world) {
		// Store once, globally, on the overworld.
		ServerWorld overworld = world.getServer().getWorld(World.OVERWORLD);
		if (overworld == null) {
			overworld = world;
		}
		return overworld.getPersistentStateManager()
				.getOrCreate(LobberState::fromNbt, LobberState::new, "lobber_state");
	}
}
