package com.lobber.entity.goal;

import com.lobber.entity.LobberEntity;
import net.fabricmc.fabric.api.tag.convention.v1.ConventionalBlockTags;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.particle.BlockStateParticleEffect;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

import java.util.EnumSet;
import java.util.List;

/**
 * A young Lobber given a tool becomes a little helper. Tell it what to gather in its menu and it will
 * fan out near you, mine matching blocks into a small satchel, and bring the haul back when it's full.
 */
public class LobberWorkGoal extends Goal {
	private static final int SEARCH_RADIUS = 12;

	private final LobberEntity lobber;
	private BlockPos target;
	private int digTimer;
	private int searchCooldown;

	public LobberWorkGoal(LobberEntity lobber) {
		this.lobber = lobber;
		this.setControls(EnumSet.of(Control.MOVE, Control.LOOK));
	}

	@Override
	public boolean canStart() {
		if (this.lobber.isProvoked() || this.lobber.isMature() || !this.lobber.isWorker()
				|| this.lobber.getWorkType() == LobberEntity.WORK_NONE
				|| !(this.lobber.getWorld() instanceof ServerWorld)) {
			return false;
		}
		return this.lobber.getWorld().getClosestPlayer(this.lobber, 24.0) != null;
	}

	@Override
	public boolean shouldContinue() {
		return this.canStart();
	}

	@Override
	public boolean shouldRunEveryTick() {
		return true;
	}

	@Override
	public void stop() {
		this.target = null;
		this.digTimer = 0;
		this.lobber.getNavigation().stop();
	}

	@Override
	public void tick() {
		ServerWorld world = (ServerWorld) this.lobber.getWorld();

		// Full satchel: bring the goods home.
		if (this.lobber.isWorkerFull()) {
			this.returnToPlayer(world);
			return;
		}

		if (this.target == null || !this.matches(world.getBlockState(this.target))) {
			this.target = null;
			if (--this.searchCooldown <= 0) {
				this.searchCooldown = 20;
				this.target = this.findBlock(world);
			}
		}

		if (this.target == null) {
			// Nothing to mine right now: idle near the player.
			PlayerEntity player = world.getClosestPlayer(this.lobber, 24.0);
			if (player != null && this.lobber.squaredDistanceTo(player) > 36.0) {
				this.lobber.getNavigation().startMovingTo(player, 0.9);
			}
			return;
		}

		Vec3d center = Vec3d.ofCenter(this.target);
		this.lobber.getLookControl().lookAt(center.x, center.y, center.z);
		if (this.lobber.squaredDistanceTo(center) > 5.5) {
			this.lobber.getNavigation().startMovingTo(center.x, this.target.getY(), center.z, 1.0);
			this.digTimer = 0;
			return;
		}

		// In reach: chip away at it.
		this.lobber.getNavigation().stop();
		this.digTimer++;
		BlockState state = world.getBlockState(this.target);
		if (this.digTimer % 6 == 0) {
			world.playSound(null, this.target, state.getSoundGroup().getHitSound(),
					SoundCategory.BLOCKS, 0.6f, 0.9f);
			world.spawnParticles(new BlockStateParticleEffect(ParticleTypes.BLOCK, state),
					center.x, center.y, center.z, 6, 0.2, 0.2, 0.2, 0.0);
		}
		if (this.digTimer >= this.digTime(world, state)) {
			this.mine(world, this.target, state);
			this.target = null;
			this.digTimer = 0;
		}
	}

	private void returnToPlayer(ServerWorld world) {
		PlayerEntity player = world.getClosestPlayer(this.lobber, 32.0);
		if (player == null) {
			return;
		}
		if (this.lobber.squaredDistanceTo(player) > 4.0) {
			this.lobber.getNavigation().startMovingTo(player, 1.1);
		} else {
			this.lobber.depositToPlayer(player);
		}
	}

	private int digTime(ServerWorld world, BlockState state) {
		float hardness = state.getHardness(world, BlockPos.ORIGIN);
		return Math.max(12, (int) (hardness * 16.0f));
	}

	private void mine(ServerWorld world, BlockPos pos, BlockState state) {
		List<ItemStack> drops = Block.getDroppedStacks(
				state, world, pos, world.getBlockEntity(pos), this.lobber, this.lobber.getWorkTool());
		world.breakBlock(pos, false);
		world.playSound(null, pos, state.getSoundGroup().getBreakSound(), SoundCategory.BLOCKS, 0.8f, 0.9f);
		for (ItemStack drop : drops) {
			if (!this.lobber.addToSatchel(drop) && !drop.isEmpty()) {
				Block.dropStack(world, this.lobber.getBlockPos(), drop);
			}
		}
	}

	private BlockPos findBlock(ServerWorld world) {
		BlockPos origin = this.lobber.getBlockPos();
		BlockPos best = null;
		double bestDistance = Double.MAX_VALUE;
		for (BlockPos pos : BlockPos.iterate(
				origin.add(-SEARCH_RADIUS, -SEARCH_RADIUS, -SEARCH_RADIUS),
				origin.add(SEARCH_RADIUS, SEARCH_RADIUS, SEARCH_RADIUS))) {
			BlockState state = world.getBlockState(pos);
			if (!this.matches(state) || state.getHardness(world, pos) < 0.0f) {
				continue;
			}
			double distance = pos.getSquaredDistance(origin);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = pos.toImmutable();
			}
		}
		return best;
	}

	private boolean matches(BlockState state) {
		return switch (this.lobber.getWorkType()) {
			case LobberEntity.WORK_ORES -> state.isIn(ConventionalBlockTags.ORES);
			case LobberEntity.WORK_WOOD -> state.isIn(BlockTags.LOGS);
			case LobberEntity.WORK_STONE -> state.isIn(BlockTags.BASE_STONE_OVERWORLD);
			default -> false;
		};
	}
}
