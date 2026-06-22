package com.lobber.spawn;

import com.lobber.entity.LobberEntity;
import com.lobber.entity.ModEntities;
import net.minecraft.entity.Entity;
import net.minecraft.entity.SpawnReason;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;
import net.minecraft.world.LightType;
import net.minecraft.world.World;

import java.util.List;

/**
 * Custom spawning for the Lobber. It only appears:
 *   - from the very first night onward (it then matures over time),
 *   - at night,
 *   - to a player who is completely alone,
 *   - in low light, out near (but not on top of) that player,
 *   - and only ever ONE at a time across the whole world.
 */
public class LobberSpawner {
	private static final long FIRST_SPAWN_DAY = 0;       // arrives on night one as a hatchling
	private static final int CHECK_INTERVAL = 200;       // attempt every 10 seconds
	private static final double SOLITUDE_RADIUS_SQ = 48.0 * 48.0;
	private static final int MAX_BLOCK_LIGHT = 7;

	public static void tick(ServerWorld world) {
		if (world.getRegistryKey() != World.OVERWORLD) {
			return;
		}
		if (world.getTime() % CHECK_INTERVAL != 0L) {
			return;
		}
		if (world.getTime() / 24000L < FIRST_SPAWN_DAY) {
			return;
		}

		long timeOfDay = world.getTimeOfDay() % 24000L;
		boolean night = timeOfDay >= 13000L && timeOfDay <= 23000L;
		if (!night) {
			return;
		}

		if (countLobbers(world) > 0) {
			return; // singleton: only one Lobber may exist at a time
		}

		List<ServerPlayerEntity> players = world.getPlayers();
		for (ServerPlayerEntity player : players) {
			if (player.isSpectator() || player.isCreative()) {
				continue;
			}
			if (!isAlone(world, player)) {
				continue;
			}
			if (trySpawnNear(world, player)) {
				return; // one spawn, then stop for this pass
			}
		}
	}

	private static int countLobbers(ServerWorld world) {
		int count = 0;
		for (Entity entity : world.iterateEntities()) {
			if (entity.getType() == ModEntities.LOBBER) {
				count++;
			}
		}
		return count;
	}

	private static boolean isAlone(ServerWorld world, ServerPlayerEntity player) {
		for (ServerPlayerEntity other : world.getPlayers()) {
			if (other != player && other.squaredDistanceTo(player) < SOLITUDE_RADIUS_SQ) {
				return false;
			}
		}
		return true;
	}

	private static boolean trySpawnNear(ServerWorld world, ServerPlayerEntity player) {
		for (int attempt = 0; attempt < 20; attempt++) {
			double angle = world.random.nextDouble() * Math.PI * 2.0;
			double distance = 24.0 + world.random.nextDouble() * 16.0; // 24-40 blocks out
			int x = MathHelper.floor(player.getX() + Math.cos(angle) * distance);
			int z = MathHelper.floor(player.getZ() + Math.sin(angle) * distance);
			int py = MathHelper.floor(player.getY());

			for (int y = py + 4; y >= py - 6; y--) {
				BlockPos foot = new BlockPos(x, y, z);
				if (world.getBlockState(foot).blocksMovement()) {
					continue;
				}
				BlockPos head = foot.up();
				if (world.getBlockState(head).blocksMovement()) {
					continue;
				}
				BlockPos ground = foot.down();
				if (!world.getBlockState(ground).blocksMovement()) {
					continue;
				}
				if (world.getLightLevel(LightType.BLOCK, foot) > MAX_BLOCK_LIGHT) {
					continue;
				}
				spawn(world, foot);
				return true;
			}
		}
		return false;
	}

	private static void spawn(ServerWorld world, BlockPos pos) {
		LobberEntity lobber = ModEntities.LOBBER.create(world);
		if (lobber == null) {
			return;
		}
		lobber.refreshPositionAndAngles(
				pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5,
				world.random.nextFloat() * 360.0f, 0.0f);
		lobber.initialize(world, world.getLocalDifficulty(pos), SpawnReason.NATURAL, null, null);

		// Carry over its grudge and its memory of the player from previous encounters.
		com.lobber.entity.LobberState state = com.lobber.entity.LobberState.get(world);
		java.util.UUID bond = state.hasBond ? new java.util.UUID(state.bondMost, state.bondLeast) : null;
		lobber.applyContinuity(state.aggression, state.trust, bond);

		world.spawnEntity(lobber);
	}
}
