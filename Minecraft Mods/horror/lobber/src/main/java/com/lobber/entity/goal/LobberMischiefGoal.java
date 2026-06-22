package com.lobber.entity.goal;

import com.lobber.config.LobberConfig;
import com.lobber.entity.LobberEntity;
import net.minecraft.block.BlockState;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.passive.AnimalEntity;
import net.minecraft.item.Items;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import java.util.List;

/**
 * While calm, the Lobber occasionally causes trouble: smashing a block, pocketing one from
 * a player's base, or spiriting away a nearby animal.
 */
public class LobberMischiefGoal extends Goal {
	private final LobberEntity lobber;

	public LobberMischiefGoal(LobberEntity lobber) {
		this.lobber = lobber;
	}

	@Override
	public boolean canStart() {
		if (this.lobber.isProvoked() || this.lobber.hasActiveEvent()
				|| !(this.lobber.getWorld() instanceof ServerWorld)) {
			return false;
		}
		// Bolder (more frequent) as it grows: ~1/400 chance when tiny, ~1/100 once nearly grown.
		int rate = Math.max(80, 400 - this.lobber.getGrowth() * 3);
		return this.lobber.getRandom().nextInt(rate) == 0
				&& this.lobber.getWorld().getClosestPlayer(this.lobber, 24.0) != null;
	}

	@Override
	public boolean shouldContinue() {
		return false; // one-shot mischief per trigger
	}

	@Override
	public void start() {
		boolean canGrief = LobberConfig.INSTANCE.enableGriefing;
		// Young Lobbers are shy and silly - they only pocket the odd block to play with.
		// Bolder, older ones start smashing things and snatching animals.
		if (this.lobber.getGrowth() < 40) {
			if (canGrief) {
				this.stealNearbyBlock();
			}
			return;
		}
		switch (this.lobber.getRandom().nextInt(3)) {
			case 0 -> {
				if (canGrief) {
					this.destroyNearbyBlock();
				}
			}
			case 1 -> {
				if (canGrief) {
					this.stealNearbyBlock();
				}
			}
			default -> {
				if (LobberConfig.INSTANCE.enablePetKilling) {
					this.stealNearbyAnimal();
				}
			}
		}
	}

	private BlockPos findGrabbableBlock() {
		World world = this.lobber.getWorld();
		for (int i = 0; i < 16; i++) {
			BlockPos p = this.lobber.getBlockPos().add(
					this.lobber.getRandom().nextInt(9) - 4,
					this.lobber.getRandom().nextInt(5) - 2,
					this.lobber.getRandom().nextInt(9) - 4);
			BlockState state = world.getBlockState(p);
			if (state.isAir()) {
				continue;
			}
			if (state.getHardness(world, p) < 0.0f) {
				continue;
			}
			if (!state.getFluidState().isEmpty()) {
				continue;
			}
			if (state.getBlock().asItem() == Items.AIR) {
				continue;
			}
			return p;
		}
		return null;
	}

	private void destroyNearbyBlock() {
		BlockPos pos = this.findGrabbableBlock();
		if (pos == null) {
			return;
		}
		this.lobber.getWorld().breakBlock(pos, true); // smashed, drops as rubble
		this.spawnPoof(pos);
	}

	private void stealNearbyBlock() {
		BlockPos pos = this.findGrabbableBlock();
		if (pos == null) {
			return;
		}
		this.lobber.getWorld().breakBlock(pos, false); // pocketed, no drop
		this.spawnPoof(pos);
	}

	private void stealNearbyAnimal() {
		World world = this.lobber.getWorld();
		List<AnimalEntity> animals = world.getEntitiesByClass(
				AnimalEntity.class, this.lobber.getBoundingBox().expand(8.0), AnimalEntity::isAlive);
		if (animals.isEmpty()) {
			return;
		}
		AnimalEntity victim = animals.get(this.lobber.getRandom().nextInt(animals.size()));
		this.spawnPoof(victim.getBlockPos());
		victim.discard(); // spirited away
	}

	private void spawnPoof(BlockPos pos) {
		if (this.lobber.getWorld() instanceof ServerWorld serverWorld) {
			serverWorld.spawnParticles(ParticleTypes.POOF,
					pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5,
					12, 0.3, 0.3, 0.3, 0.02);
			serverWorld.playSound(null, pos, SoundEvents.ENTITY_ENDERMAN_TELEPORT,
					SoundCategory.HOSTILE, 0.6f, 1.4f);
		}
	}
}
