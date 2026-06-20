package com.lobber.entity.goal;

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
		// Rare, so it nibbles at a base over time rather than leveling it instantly.
		return !this.lobber.isProvoked()
				&& this.lobber.getWorld() instanceof ServerWorld
				&& this.lobber.getRandom().nextInt(200) == 0
				&& this.lobber.getWorld().getClosestPlayer(this.lobber, 24.0) != null;
	}

	@Override
	public boolean shouldContinue() {
		return false; // one-shot mischief per trigger
	}

	@Override
	public void start() {
		switch (this.lobber.getRandom().nextInt(3)) {
			case 0 -> this.destroyNearbyBlock();
			case 1 -> this.stealNearbyBlock();
			default -> this.stealNearbyAnimal();
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
