package net.marauder.night;

import net.marauder.duel.DuelManager;
import net.marauder.entity.MarauderEntity;
import net.marauder.entity.MarauderStages;
import net.marauder.registry.ModEntities;
import net.marauder.state.MarauderState;
import net.marauder.state.PlayerProgress;
import net.minecraft.entity.EntityType;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.Difficulty;
import net.minecraft.world.Heightmap;
import net.minecraft.world.World;

import java.util.List;
import java.util.Random;

/**
 * Server-authoritative controller for the nightly hunt: it checks eligibility,
 * finds fair ambush positions, spawns or stages the Marauder, and prevents
 * duplicate same-night encounters. All decisions are made server-side.
 */
public final class NightManager {

    /** How often (in ticks) to evaluate the world. */
    private static final int CHECK_INTERVAL = 40;

    private static final Random RANDOM = new Random();

    private NightManager() {
    }

    public static void tick(MinecraftServer server) {
        if (server.getTicks() % CHECK_INTERVAL != 0) {
            return;
        }
        if (!net.marauder.config.MarauderConfig.get().enabled) {
            return;
        }
        ServerWorld overworld = server.getOverworld();
        if (overworld.getDifficulty() == Difficulty.PEACEFUL) {
            return;
        }
        if (!isNight(overworld)) {
            return;
        }

        MarauderState state = MarauderState.get(server);
        long day = overworld.getTimeOfDay() / 24000L;

        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            tryEncounter(player, overworld, state, day);
        }
    }

    private static void tryEncounter(ServerPlayerEntity player, ServerWorld overworld,
                                     MarauderState state, long day) {
        // Overworld only, valid game mode, alive.
        if (player.getWorld() != overworld || player.isCreative() || player.isSpectator() || !player.isAlive()) {
            return;
        }
        if (DuelManager.hasActive(player.getUuid())) {
            return;
        }

        PlayerProgress progress = state.getOrCreate(player.getUuid());

        // Rivalry finished, unless the player armed a rematch.
        if (progress.finalComplete && !progress.rematchArmed) {
            return;
        }
        net.marauder.config.MarauderConfig cfg = net.marauder.config.MarauderConfig.get();

        // One attempt per eligible night, plus an optional minimum gap between nights.
        if (progress.lastAttemptDay == day) {
            return;
        }
        if (progress.lastAttemptDay >= 0 && day - progress.lastAttemptDay <= cfg.minNightsBetween) {
            return;
        }
        // Avoid two overlapping Marauders in a small area.
        if (marauderNearby(overworld, player.getBlockPos(), cfg.maxConcurrentRadius)) {
            return;
        }

        int stage = MarauderStages.clamp(progress.stage);

        if (MarauderStages.isFinal(stage)) {
            spawnFinalWait(player, overworld, progress, state, day);
            return;
        }

        if (RANDOM.nextFloat() > cfg.spawnChance) {
            return;
        }
        BlockPos ambush = findAmbush(overworld, player);
        if (ambush == null) {
            // No fair spot found; retry on a later check this same night.
            return;
        }
        spawnStalker(player, overworld, stage, ambush, progress, state, day);
    }

    private static void spawnStalker(ServerPlayerEntity player, ServerWorld world, int stage,
                                     BlockPos pos, PlayerProgress progress, MarauderState state, long day) {
        MarauderEntity marauder = create(world);
        if (marauder == null) {
            return;
        }
        marauder.refreshPositionAndAngles(pos.getX() + 0.5, pos.getY(), pos.getZ() + 0.5,
                world.random.nextFloat() * 360f, 0f);
        marauder.setAmbushPos(pos);
        marauder.initFromStage(stage, player);
        world.spawnEntity(marauder);
        DuelManager.register(player.getUuid(), marauder);

        // Soft lock this night: one ambush attempt regardless of outcome.
        progress.lastAttemptDay = day;
        state.markDirty();
    }

    private static void spawnFinalWait(ServerPlayerEntity player, ServerWorld world,
                                       PlayerProgress progress, MarauderState state, long day) {
        BlockPos anchor = resolveHomeAnchor(player, world);
        if (anchor == null) {
            return;
        }
        MarauderEntity marauder = create(world);
        if (marauder == null) {
            return;
        }
        marauder.refreshPositionAndAngles(anchor.getX() + 0.5, anchor.getY(), anchor.getZ() + 0.5, 0f, 0f);
        marauder.setAmbushPos(anchor);
        marauder.initFromStage(10, player);
        world.spawnEntity(marauder);
        DuelManager.register(player.getUuid(), marauder);

        progress.lastAttemptDay = day;
        state.markDirty();
    }

    // --------------------------------------------------------------- helpers

    private static MarauderEntity create(ServerWorld world) {
        EntityType<MarauderEntity> type = ModEntities.MARAUDER;
        return type.create(world);
    }

    /** True during the actual night window (not merely dark from weather). */
    public static boolean isNight(World world) {
        long t = world.getTimeOfDay() % 24000L;
        return t >= 13000L && t < 23000L;
    }

    private static boolean marauderNearby(ServerWorld world, BlockPos center, double radius) {
        List<MarauderEntity> list = world.getEntitiesByClass(MarauderEntity.class,
                new net.minecraft.util.math.Box(center).expand(radius), e -> true);
        return !list.isEmpty();
    }

    /**
     * Picks an ambush point 24-48 blocks from the player, on valid outdoor ground,
     * preferring positions outside the player's current view.
     */
    private static BlockPos findAmbush(ServerWorld world, ServerPlayerEntity player) {
        Vec3d eye = player.getPos();
        Vec3d look = player.getRotationVec(1.0f);

        BlockPos fallback = null;
        for (int attempt = 0; attempt < 16; attempt++) {
            double angle = RANDOM.nextDouble() * Math.PI * 2;
            double distance = 24 + RANDOM.nextDouble() * 24;
            double dx = Math.cos(angle) * distance;
            double dz = Math.sin(angle) * distance;
            int x = (int) Math.floor(eye.x + dx);
            int z = (int) Math.floor(eye.z + dz);

            int y = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
            BlockPos feet = new BlockPos(x, y, z);

            if (!isFairSpawn(world, feet)) {
                continue;
            }

            // Prefer spots behind the player / out of immediate view and under open sky.
            Vec3d to = new Vec3d(dx, 0, dz).normalize();
            boolean outOfView = look.dotProduct(to) < 0.3;
            boolean openSky = world.isSkyVisible(feet);

            if (outOfView && openSky) {
                return feet;
            }
            if (fallback == null && openSky) {
                fallback = feet;
            } else if (fallback == null) {
                fallback = feet;
            }
        }
        return fallback;
    }

    private static boolean isFairSpawn(ServerWorld world, BlockPos feet) {
        if (world.getBottomY() + 2 >= feet.getY()) {
            return false;
        }
        boolean feetClear = world.getBlockState(feet).getCollisionShape(world, feet).isEmpty();
        boolean headClear = world.getBlockState(feet.up()).getCollisionShape(world, feet.up()).isEmpty();
        boolean groundSolid = !world.getBlockState(feet.down()).getCollisionShape(world, feet.down()).isEmpty();
        boolean dryFeet = world.getFluidState(feet).isEmpty();
        boolean dryGround = world.getFluidState(feet.down()).isEmpty(); // avoid lava / water surface
        return feetClear && headClear && groundSolid && dryFeet && dryGround;
    }

    private static BlockPos resolveHomeAnchor(ServerPlayerEntity player, ServerWorld world) {
        if (net.marauder.config.MarauderConfig.get().arenaNearBase) {
            BlockPos spawn = player.getSpawnPointPosition();
            if (spawn != null && player.getSpawnPointDimension() == World.OVERWORLD) {
                BlockPos near = findStandNear(world, spawn, 6);
                if (near != null) {
                    return near;
                }
            }
        }
        // Fall back to a safe outdoor spot a short distance from the player.
        return findAmbushClose(world, player);
    }

    private static BlockPos findAmbushClose(ServerWorld world, ServerPlayerEntity player) {
        Vec3d pos = player.getPos();
        for (int attempt = 0; attempt < 12; attempt++) {
            double angle = RANDOM.nextDouble() * Math.PI * 2;
            double distance = 8 + RANDOM.nextDouble() * 6;
            int x = (int) Math.floor(pos.x + Math.cos(angle) * distance);
            int z = (int) Math.floor(pos.z + Math.sin(angle) * distance);
            int y = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
            BlockPos feet = new BlockPos(x, y, z);
            if (isFairSpawn(world, feet)) {
                return feet;
            }
        }
        return null;
    }

    private static BlockPos findStandNear(ServerWorld world, BlockPos center, int radius) {
        for (int attempt = 0; attempt < 16; attempt++) {
            int x = center.getX() + RANDOM.nextInt(radius * 2 + 1) - radius;
            int z = center.getZ() + RANDOM.nextInt(radius * 2 + 1) - radius;
            int y = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
            BlockPos feet = new BlockPos(x, y, z);
            if (isFairSpawn(world, feet)) {
                return feet;
            }
        }
        return null;
    }
}
