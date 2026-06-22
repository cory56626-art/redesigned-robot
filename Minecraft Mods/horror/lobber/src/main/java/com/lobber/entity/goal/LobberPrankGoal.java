package com.lobber.entity.goal;

import com.lobber.config.LobberConfig;
import com.lobber.entity.LobberEntity;
import net.minecraft.block.Blocks;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.item.ItemStack;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;

/**
 * A young, untrusting Lobber is a little menace. It plays devious pranks: walling a miner into their
 * own tunnel, or snatching whatever the player is holding and tossing it just out of reach.
 * Earn its trust and the pranks stop.
 */
public class LobberPrankGoal extends Goal {
	private final LobberEntity lobber;

	public LobberPrankGoal(LobberEntity lobber) {
		this.lobber = lobber;
	}

	@Override
	public boolean canStart() {
		if (this.lobber.isProvoked() || this.lobber.isMature() || this.lobber.isFriendly()
				|| this.lobber.hasActiveEvent() || !LobberConfig.INSTANCE.enableGriefing
				|| !(this.lobber.getWorld() instanceof ServerWorld)) {
			return false;
		}
		// Bolder as it grows toward maturity, but always an occasional nuisance.
		int rate = Math.max(120, 500 - this.lobber.getGrowth() * 3);
		return this.lobber.getRandom().nextInt(rate) == 0
				&& this.lobber.getWorld().getClosestPlayer(this.lobber, 12.0) != null;
	}

	@Override
	public boolean shouldContinue() {
		return false; // one-shot prank
	}

	@Override
	public void start() {
		PlayerEntity player = this.lobber.getWorld().getClosestPlayer(this.lobber, 12.0);
		if (player == null) {
			return;
		}
		ServerWorld world = (ServerWorld) this.lobber.getWorld();

		// Underground? Try to wall the miner in. Otherwise, pickpocket them.
		boolean underground = !world.isSkyVisible(player.getBlockPos());
		if (underground && this.lobber.getRandom().nextBoolean()) {
			this.sealTunnel(world, player);
		} else {
			this.snatchFromHands(world, player);
		}
	}

	/** Drops a little wall of cobblestone in front of the player to block their dig. */
	private void sealTunnel(ServerWorld world, PlayerEntity player) {
		Direction facing = player.getHorizontalFacing();
		BlockPos base = player.getBlockPos().offset(facing, 2);
		boolean placedAny = false;
		for (int dy = 0; dy <= 1; dy++) {
			BlockPos pos = base.up(dy);
			if (world.getBlockState(pos).isReplaceable()
					&& !world.getBlockState(pos.down()).isAir()) {
				world.setBlockState(pos, Blocks.COBBLESTONE.getDefaultState());
				placedAny = true;
			}
		}
		if (placedAny) {
			world.playSound(null, base, SoundEvents.BLOCK_STONE_PLACE, SoundCategory.HOSTILE, 0.8f, 0.8f);
			world.spawnParticles(ParticleTypes.SMOKE,
					base.getX() + 0.5, base.getY() + 0.5, base.getZ() + 0.5, 6, 0.3, 0.3, 0.3, 0.01);
		}
	}

	/** Grabs whatever the player is holding and flings it a few blocks away. */
	private void snatchFromHands(ServerWorld world, PlayerEntity player) {
		if (this.lobber.squaredDistanceTo(player) > 16.0 || player.isCreative()) {
			return;
		}
		ItemStack held = player.getMainHandStack();
		if (held.isEmpty()) {
			return;
		}
		ItemStack stolen = held.copy();
		player.setStackInHand(Hand.MAIN_HAND, ItemStack.EMPTY);

		// Toss it a short, recoverable distance away from the player.
		double angle = this.lobber.getRandom().nextDouble() * Math.PI * 2.0;
		ItemEntity drop = new ItemEntity(world,
				player.getX() + Math.cos(angle) * 3.0,
				player.getY() + 0.5,
				player.getZ() + Math.sin(angle) * 3.0,
				stolen);
		drop.setVelocity(Math.cos(angle) * 0.2, 0.2, Math.sin(angle) * 0.2);
		drop.setPickupDelay(20);
		world.spawnEntity(drop);

		world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_FOX_SCREECH, SoundCategory.HOSTILE, 0.7f, 1.6f);
		world.spawnParticles(ParticleTypes.SMOKE,
				this.lobber.getX(), this.lobber.getEyeY(), this.lobber.getZ(), 6, 0.2, 0.2, 0.2, 0.01);
	}
}
