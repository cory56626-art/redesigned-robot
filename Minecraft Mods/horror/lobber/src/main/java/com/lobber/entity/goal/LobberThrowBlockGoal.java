package com.lobber.entity.goal;

import com.lobber.entity.LobbedBlockEntity;
import com.lobber.entity.LobberEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.item.ItemStack;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.math.Vec3d;

import java.util.EnumSet;

/**
 * When provoked, the Lobber keeps its distance, snatches a nearby block and lobs it at its target.
 */
public class LobberThrowBlockGoal extends Goal {
	private static final double KEEP_DISTANCE = 6.0;
	private static final double KEEP_DISTANCE_SQ = KEEP_DISTANCE * KEEP_DISTANCE;
	private static final double MAX_RANGE_SQ = 18.0 * 18.0;

	private final LobberEntity lobber;
	private int throwCooldown;

	public LobberThrowBlockGoal(LobberEntity lobber) {
		this.lobber = lobber;
		this.setControls(EnumSet.of(Control.MOVE, Control.LOOK));
	}

	@Override
	public boolean canStart() {
		LivingEntity target = this.lobber.getTarget();
		return this.lobber.isProvoked() && target != null && target.isAlive();
	}

	@Override
	public boolean shouldContinue() {
		return this.canStart();
	}

	@Override
	public void start() {
		this.throwCooldown = 20;
	}

	@Override
	public void stop() {
		this.lobber.getNavigation().stop();
	}

	@Override
	public boolean shouldRunEveryTick() {
		return true;
	}

	@Override
	public void tick() {
		LivingEntity target = this.lobber.getTarget();
		if (target == null) {
			return;
		}

		this.lobber.getLookControl().lookAt(target, 30.0f, 30.0f);
		double distanceSq = this.lobber.squaredDistanceTo(target);

		if (distanceSq > 13.0 * 13.0) {
			// Close the gap until in throwing range.
			this.lobber.getNavigation().startMovingTo(target, 1.0);
		} else if (distanceSq < KEEP_DISTANCE_SQ) {
			// Too close for comfort; back away to keep lobbing.
			Vec3d away = this.lobber.getPos().subtract(target.getPos()).normalize().multiply(5.0);
			Vec3d retreat = this.lobber.getPos().add(away);
			this.lobber.getNavigation().startMovingTo(retreat.x, retreat.y, retreat.z, 1.1);
		} else {
			this.lobber.getNavigation().stop();
		}

		if (this.throwCooldown > 0) {
			this.throwCooldown--;
		}

		if (this.throwCooldown <= 0 && distanceSq < MAX_RANGE_SQ && this.lobber.canSee(target)) {
			this.throwBlockAt(target);
			this.throwCooldown = 40 + this.lobber.getRandom().nextInt(30);
		}
	}

	private void throwBlockAt(LivingEntity target) {
		ItemStack ammo = this.lobber.grabAmmo();
		LobbedBlockEntity projectile = new LobbedBlockEntity(this.lobber.getWorld(), this.lobber, ammo);

		double startY = this.lobber.getEyeY() - 0.1;
		projectile.setPosition(this.lobber.getX(), startY, this.lobber.getZ());

		double dx = target.getX() - this.lobber.getX();
		double dz = target.getZ() - this.lobber.getZ();
		double dy = target.getBodyY(0.5) - startY;
		double horizontal = Math.sqrt(dx * dx + dz * dz);

		// Add a little arc so the throw feels lobbed rather than fired flat.
		projectile.setVelocity(dx, dy + horizontal * 0.15, dz, 1.3f, 4.0f);

		this.lobber.getWorld().spawnEntity(projectile);
		this.lobber.getWorld().playSound(null, this.lobber.getX(), this.lobber.getY(), this.lobber.getZ(),
				SoundEvents.ENTITY_SNOWBALL_THROW, SoundCategory.HOSTILE, 1.0f, 0.6f);
		this.lobber.swingHand(net.minecraft.util.Hand.MAIN_HAND);
	}
}
