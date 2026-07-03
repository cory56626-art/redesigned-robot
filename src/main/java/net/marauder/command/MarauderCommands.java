package net.marauder.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.marauder.duel.DuelManager;
import net.marauder.entity.MarauderEntity;
import net.marauder.entity.MarauderStages;
import net.marauder.registry.ModEntities;
import net.marauder.state.MarauderState;
import net.marauder.state.PlayerProgress;
import net.minecraft.command.argument.EntityArgumentType;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.Vec3d;

/**
 * Operator-only test/debug commands under {@code /marauder}. Level 2 (op).
 */
public final class MarauderCommands {

    private MarauderCommands() {
    }

    public static void register(CommandDispatcher<ServerCommandSource> dispatcher) {
        dispatcher.register(CommandManager.literal("marauder")
                .requires(src -> src.hasPermissionLevel(2))

                .then(CommandManager.literal("spawn")
                        .then(CommandManager.argument("stage", IntegerArgumentType.integer(1, 10))
                                .executes(ctx -> spawn(ctx, false))
                                .then(CommandManager.argument("player", EntityArgumentType.player())
                                        .executes(ctx -> spawn(ctx, false)))))

                .then(CommandManager.literal("duel")
                        .then(CommandManager.argument("stage", IntegerArgumentType.integer(1, 10))
                                .executes(ctx -> spawn(ctx, true))
                                .then(CommandManager.argument("player", EntityArgumentType.player())
                                        .executes(ctx -> spawn(ctx, true)))))

                .then(CommandManager.literal("finalwait")
                        .executes(ctx -> finalWait(ctx))
                        .then(CommandManager.argument("player", EntityArgumentType.player())
                                .executes(ctx -> finalWait(ctx))))

                .then(CommandManager.literal("setstage")
                        .then(CommandManager.argument("stage", IntegerArgumentType.integer(1, 10))
                                .executes(ctx -> setStage(ctx))
                                .then(CommandManager.argument("player", EntityArgumentType.player())
                                        .executes(ctx -> setStage(ctx)))))

                .then(CommandManager.literal("stage")
                        .executes(ctx -> queryStage(ctx))
                        .then(CommandManager.argument("player", EntityArgumentType.player())
                                .executes(ctx -> queryStage(ctx))))

                .then(CommandManager.literal("reset")
                        .executes(ctx -> reset(ctx))
                        .then(CommandManager.argument("player", EntityArgumentType.player())
                                .executes(ctx -> reset(ctx))))

                .then(CommandManager.literal("rematch")
                        .executes(ctx -> rematch(ctx))
                        .then(CommandManager.argument("player", EntityArgumentType.player())
                                .executes(ctx -> rematch(ctx))))

                .then(CommandManager.literal("clear")
                        .executes(ctx -> clear(ctx))
                        .then(CommandManager.argument("player", EntityArgumentType.player())
                                .executes(ctx -> clear(ctx)))));
    }

    // ------------------------------------------------------------- handlers

    private static int spawn(CommandContext<ServerCommandSource> ctx, boolean immediate) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        int stage = IntegerArgumentType.getInteger(ctx, "stage");
        ServerWorld world = player.getServerWorld();

        clearActive(player);

        MarauderEntity marauder = ModEntities.MARAUDER.create(world);
        if (marauder == null) {
            ctx.getSource().sendError(Text.literal("Failed to create Marauder."));
            return 0;
        }
        Vec3d spawnPos = findSpawnNear(player, immediate ? 5 : 12);
        marauder.refreshPositionAndAngles(spawnPos.x, spawnPos.y, spawnPos.z, world.random.nextFloat() * 360f, 0f);
        marauder.setAmbushPos(net.minecraft.util.math.BlockPos.ofFloored(spawnPos));
        marauder.initFromStage(stage, player);
        marauder.setIgnoreDayNight(true);
        world.spawnEntity(marauder);
        DuelManager.register(player.getUuid(), marauder);
        if (immediate) {
            marauder.skipToChallenge();
        }

        final int fStage = stage;
        ctx.getSource().sendFeedback(() -> Text.literal("Spawned " + MarauderStages.title(fStage)
                + (immediate ? " (dueling " : " (stalking ") + player.getName().getString() + ").")
                .formatted(Formatting.DARK_RED), true);
        return 1;
    }

    private static int finalWait(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        ServerWorld world = player.getServerWorld();
        clearActive(player);

        MarauderEntity marauder = ModEntities.MARAUDER.create(world);
        if (marauder == null) {
            ctx.getSource().sendError(Text.literal("Failed to create Marauder."));
            return 0;
        }
        Vec3d spawnPos = findSpawnNear(player, 10);
        marauder.refreshPositionAndAngles(spawnPos.x, spawnPos.y, spawnPos.z, 0f, 0f);
        marauder.setAmbushPos(net.minecraft.util.math.BlockPos.ofFloored(spawnPos));
        marauder.initFromStage(10, player);
        marauder.setIgnoreDayNight(true);
        world.spawnEntity(marauder);
        DuelManager.register(player.getUuid(), marauder);

        ctx.getSource().sendFeedback(() -> Text.literal("The Marauder Ascendant waits nearby. Approach to begin.")
                .formatted(Formatting.LIGHT_PURPLE), true);
        return 1;
    }

    private static int setStage(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        int stage = MarauderStages.clamp(IntegerArgumentType.getInteger(ctx, "stage"));
        MarauderState state = MarauderState.get(player.getServer());
        PlayerProgress p = state.getOrCreate(player.getUuid());
        p.stage = stage;
        p.finalComplete = false;
        p.lastAttemptDay = -1;
        state.markDirty();
        ctx.getSource().sendFeedback(() -> Text.literal(player.getName().getString()
                + " is now on Marauder stage " + stage + ".").formatted(Formatting.GOLD), true);
        return 1;
    }

    private static int queryStage(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        PlayerProgress p = MarauderState.get(player.getServer()).getOrCreate(player.getUuid());
        ctx.getSource().sendFeedback(() -> Text.literal(player.getName().getString()
                + " — stage " + p.stage + ", highest defeated " + p.highestDefeated
                + ", final complete: " + p.finalComplete + ", rematch armed: " + p.rematchArmed)
                .formatted(Formatting.GRAY), false);
        return 1;
    }

    private static int reset(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        MarauderState state = MarauderState.get(player.getServer());
        PlayerProgress p = state.getOrCreate(player.getUuid());
        p.stage = 1;
        p.highestDefeated = 0;
        p.lastAttemptDay = -1;
        p.lastDefeatDay = -1;
        p.finalComplete = false;
        p.rematchUnlocked = false;
        p.rematchArmed = false;
        p.resetProfile();
        state.markDirty();
        clearActive(player);
        ctx.getSource().sendFeedback(() -> Text.literal(player.getName().getString()
                + "'s Marauder rivalry has been reset to Stage 1.").formatted(Formatting.YELLOW), true);
        return 1;
    }

    private static int rematch(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        MarauderState state = MarauderState.get(player.getServer());
        PlayerProgress p = state.getOrCreate(player.getUuid());
        p.rematchUnlocked = true;
        p.rematchArmed = true;
        p.stage = 10;
        p.lastAttemptDay = -1;
        state.markDirty();
        ctx.getSource().sendFeedback(() -> Text.literal("Rematch armed for " + player.getName().getString()
                + ". The Marauder Ascendant returns next night.").formatted(Formatting.DARK_PURPLE), true);
        return 1;
    }

    private static int clear(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = playerOrSelf(ctx);
        boolean removed = clearActive(player);
        ctx.getSource().sendFeedback(() -> Text.literal(removed
                ? "Removed " + player.getName().getString() + "'s active Marauder."
                : "No active Marauder for " + player.getName().getString() + ".")
                .formatted(Formatting.GRAY), false);
        return 1;
    }

    // ------------------------------------------------------------- helpers

    private static boolean clearActive(ServerPlayerEntity player) {
        MarauderEntity existing = DuelManager.get(player.getUuid());
        if (existing != null && !existing.isRemoved()) {
            existing.discard();
            return true;
        }
        return false;
    }

    private static Vec3d findSpawnNear(ServerPlayerEntity player, double distance) {
        ServerWorld world = player.getServerWorld();
        Vec3d base = player.getPos();
        for (int i = 0; i < 12; i++) {
            double angle = world.random.nextDouble() * Math.PI * 2;
            int x = (int) Math.floor(base.x + Math.cos(angle) * distance);
            int z = (int) Math.floor(base.z + Math.sin(angle) * distance);
            int y = world.getTopY(net.minecraft.world.Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
            net.minecraft.util.math.BlockPos feet = new net.minecraft.util.math.BlockPos(x, y, z);
            if (world.getBlockState(feet).getCollisionShape(world, feet).isEmpty()
                    && world.getBlockState(feet.up()).getCollisionShape(world, feet.up()).isEmpty()
                    && !world.getBlockState(feet.down()).getCollisionShape(world, feet.down()).isEmpty()) {
                return new Vec3d(x + 0.5, y, z + 0.5);
            }
        }
        // Fallback: just next to the player at their feet height.
        return base.add(distance * 0.5, 0, 0);
    }

    private static ServerPlayerEntity playerOrSelf(CommandContext<ServerCommandSource> ctx)
            throws CommandSyntaxException {
        try {
            return EntityArgumentType.getPlayer(ctx, "player");
        } catch (IllegalArgumentException noArg) {
            return ctx.getSource().getPlayerOrThrow();
        }
    }
}
