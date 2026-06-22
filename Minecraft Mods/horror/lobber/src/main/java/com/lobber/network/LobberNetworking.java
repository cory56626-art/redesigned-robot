package com.lobber.network;

import com.lobber.LobberMod;
import com.lobber.entity.LobberEntity;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.entity.Entity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.Identifier;

/**
 * Tiny C2S channel for the worker menu: the client tells the server which resource the Lobber should
 * gather, or asks it to hand over its satchel / tool.
 */
public final class LobberNetworking {
	public static final Identifier ACTION = new Identifier(LobberMod.MOD_ID, "action");

	public static final int ACTION_SET_WORK = 0;
	public static final int ACTION_COLLECT = 1;
	public static final int ACTION_TAKE_TOOL = 2;

	private LobberNetworking() {
	}

	public static void registerServer() {
		ServerPlayNetworking.registerGlobalReceiver(ACTION, (server, player, handler, buf, sender) -> {
			int entityId = buf.readInt();
			int action = buf.readInt();
			int value = buf.readInt();
			server.execute(() -> handle(player, entityId, action, value));
		});
	}

	private static void handle(ServerPlayerEntity player, int entityId, int action, int value) {
		Entity entity = player.getServerWorld().getEntityById(entityId);
		if (!(entity instanceof LobberEntity lobber)) {
			return;
		}
		if (lobber.squaredDistanceTo(player) > 144.0) {
			return; // must be near it
		}
		switch (action) {
			case ACTION_SET_WORK -> lobber.setWorkType(value);
			case ACTION_COLLECT -> lobber.retrieveItems(player, false);
			case ACTION_TAKE_TOOL -> lobber.retrieveItems(player, true);
			default -> {
			}
		}
	}
}
