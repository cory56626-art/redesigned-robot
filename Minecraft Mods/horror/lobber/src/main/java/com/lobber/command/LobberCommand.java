package com.lobber.command;

import com.lobber.config.LobberConfig;
import com.lobber.entity.LobberEntity;
import com.lobber.entity.ModEntities;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.entity.SpawnReason;
import net.minecraft.server.command.CommandManager;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.math.Vec3d;

import java.util.Comparator;
import java.util.List;

/**
 * Test/debug commands: {@code /lobber age|trust|event|spawn|info|reload}. Requires op (level 2).
 */
public final class LobberCommand {
	private static final String[] EVENTS = {
			"knock", "shatter", "breakin", "stare", "killpet", "arson", "villager"
	};

	private LobberCommand() {
	}

	public static void register(CommandDispatcher<ServerCommandSource> dispatcher) {
		dispatcher.register(CommandManager.literal("lobber")
				.requires(source -> source.hasPermissionLevel(2))
				.then(CommandManager.literal("age")
						.then(CommandManager.argument("value", IntegerArgumentType.integer(0, 100))
								.executes(ctx -> setAge(ctx, IntegerArgumentType.getInteger(ctx, "value")))))
				.then(CommandManager.literal("trust")
						.then(CommandManager.argument("value", IntegerArgumentType.integer(0, 100))
								.executes(ctx -> setTrust(ctx, IntegerArgumentType.getInteger(ctx, "value")))))
				.then(CommandManager.literal("event")
						.then(CommandManager.argument("type", StringArgumentType.word())
								.suggests((ctx, builder) -> {
									for (String e : EVENTS) {
										builder.suggest(e);
									}
									return builder.buildFuture();
								})
								.executes(ctx -> doEvent(ctx, StringArgumentType.getString(ctx, "type")))))
				.then(CommandManager.literal("spawn").executes(LobberCommand::spawn))
				.then(CommandManager.literal("info").executes(LobberCommand::info))
				.then(CommandManager.literal("reload").executes(LobberCommand::reload)));
	}

	private static LobberEntity nearest(ServerCommandSource source) throws CommandSyntaxException {
		ServerPlayerEntity player = source.getPlayerOrThrow();
		ServerWorld world = source.getWorld();
		List<LobberEntity> lobbers = world.getEntitiesByClass(
				LobberEntity.class, player.getBoundingBox().expand(64.0), e -> true);
		return lobbers.stream()
				.min(Comparator.comparingDouble(e -> e.squaredDistanceTo(player)))
				.orElse(null);
	}

	private static int setAge(CommandContext<ServerCommandSource> ctx, int value) throws CommandSyntaxException {
		LobberEntity lobber = nearest(ctx.getSource());
		if (lobber == null) {
			ctx.getSource().sendError(Text.literal("No Lobber within 64 blocks."));
			return 0;
		}
		lobber.debugSetGrowth(value);
		ctx.getSource().sendFeedback(() -> Text.literal("Set Lobber age (growth) to " + value + "%."), false);
		return 1;
	}

	private static int setTrust(CommandContext<ServerCommandSource> ctx, int value) throws CommandSyntaxException {
		LobberEntity lobber = nearest(ctx.getSource());
		if (lobber == null) {
			ctx.getSource().sendError(Text.literal("No Lobber within 64 blocks."));
			return 0;
		}
		lobber.setBondedPlayer(ctx.getSource().getPlayerOrThrow().getUuid());
		lobber.setTrust(value);
		ctx.getSource().sendFeedback(() -> Text.literal("Set Lobber trust to " + value + "."), false);
		return 1;
	}

	private static int doEvent(CommandContext<ServerCommandSource> ctx, String type) throws CommandSyntaxException {
		LobberEntity lobber = nearest(ctx.getSource());
		if (lobber == null) {
			ctx.getSource().sendError(Text.literal("No Lobber within 64 blocks."));
			return 0;
		}
		if (lobber.triggerEvent(type)) {
			ctx.getSource().sendFeedback(() -> Text.literal("Triggered Lobber event: " + type), false);
			return 1;
		}
		ctx.getSource().sendError(Text.literal("Unknown event '" + type + "'. Try: knock, shatter, breakin, stare, killpet, arson, villager."));
		return 0;
	}

	private static int spawn(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
		ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
		ServerWorld world = ctx.getSource().getWorld();
		LobberEntity lobber = ModEntities.LOBBER.create(world);
		if (lobber == null) {
			return 0;
		}
		Vec3d pos = player.getPos().add(player.getRotationVector().multiply(4.0));
		lobber.refreshPositionAndAngles(pos.x, pos.y, pos.z, player.getYaw() + 180.0f, 0.0f);
		lobber.initialize(world, world.getLocalDifficulty(lobber.getBlockPos()), SpawnReason.COMMAND, null, null);
		world.spawnEntity(lobber);
		ctx.getSource().sendFeedback(() -> Text.literal("Spawned a baby Lobber."), false);
		return 1;
	}

	private static int info(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
		LobberEntity lobber = nearest(ctx.getSource());
		if (lobber == null) {
			ctx.getSource().sendError(Text.literal("No Lobber within 64 blocks."));
			return 0;
		}
		String stage = lobber.isMature() ? (lobber.isFriendly() ? "mature (in trust grace)" : "mature")
				: (lobber.isFriendly() ? "young (befriended)" : "young");
		String msg = String.format(
				"Lobber: health %.0f/%.0f, age %d%%, trust %d, %s%s",
				lobber.getHealth(), lobber.getMaxHealth(), lobber.getGrowth(), lobber.getTrust(), stage,
				lobber.isProvoked() ? " [PROVOKED]" : "");
		ctx.getSource().sendFeedback(() -> Text.literal(msg), false);
		return 1;
	}

	private static int reload(CommandContext<ServerCommandSource> ctx) {
		LobberConfig.load();
		ctx.getSource().sendFeedback(() -> Text.literal("Reloaded config/lobber.json."), false);
		return 1;
	}
}
