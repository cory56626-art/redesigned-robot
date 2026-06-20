package com.verity;

import com.mojang.brigadier.CommandDispatcher;
import net.minecraft.entity.Entity;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.math.Vec3d;

import java.util.List;

import static net.minecraft.server.command.CommandManager.literal;

public final class VerityCommands {

    public static void register(CommandDispatcher<ServerCommandSource> d) {
        d.register(literal("verity")
                .then(literal("spawn").executes(c -> run(c.getSource(), "spawn")))
                .then(literal("come").executes(c -> run(c.getSource(), "come")))
                .then(literal("chase").executes(c -> run(c.getSource(), "chase")))
                .then(literal("stop").executes(c -> run(c.getSource(), "stop")))
                .then(literal("door").executes(c -> run(c.getSource(), "door")))
                .then(literal("glass").executes(c -> run(c.getSource(), "glass"))));
    }

    private static int run(ServerCommandSource src, String action) {
        Entity ent = src.getEntity();
        if (!(ent instanceof ServerPlayerEntity p)) return 0;

        if (action.equals("spawn")) {
            spawnAway(p);
            src.sendFeedback(() -> Text.literal("§cVerity has spawned…"), false);
            return 1;
        }

        VerityEntity e = nearest(p);
        if (e == null) { spawnAway(p); e = nearest(p); }
        if (e == null) return 0;

        switch (action) {
            case "come": e.cmdCome(); break;
            case "chase": e.cmdChase(); break;
            case "stop": e.cmdStop(); break;
            case "door": e.cmdDoor(p); break;
            case "glass": e.cmdGlass(p); break;
            default: return 0;
        }
        return 1;
    }

    private static void spawnAway(ServerPlayerEntity p) {
        ServerWorld world = (ServerWorld) p.getWorld();
        double ang = p.getRandom().nextDouble() * Math.PI * 2;
        double x = p.getX() + Math.cos(ang) * 20;
        double z = p.getZ() + Math.sin(ang) * 20;
        double y = p.getY() + 1;
        VerityEntity e = EntityVerityMod.VERITY.create(world);
        if (e != null) {
            e.refreshPositionAndAngles(x, y, z, 0, 0);
            world.spawnEntity(e);
        }
    }

    private static VerityEntity nearest(ServerPlayerEntity p) {
        ServerWorld world = (ServerWorld) p.getWorld();
        List<VerityEntity> list = world.getEntitiesByClass(VerityEntity.class,
                p.getBoundingBox().expand(80.0), e -> true);
        VerityEntity best = null;
        double bd = Double.MAX_VALUE;
        Vec3d pos = p.getPos();
        for (VerityEntity e : list) {
            double dd = e.squaredDistanceTo(pos);
            if (dd < bd) { bd = dd; best = e; }
        }
        return best;
    }

    private VerityCommands() {}
}
