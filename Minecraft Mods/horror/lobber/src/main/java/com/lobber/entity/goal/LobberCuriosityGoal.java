package com.lobber.entity.goal;

import com.lobber.entity.LobberEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.Vec3d;

import java.util.EnumSet;

/**
 * A young Lobber is curious rather than aggressive: it edges closer to its chosen player and watches
 * them. The more it trusts the player, the closer it dares to come.
 */
public class LobberCuriosityGoal extends Goal {
	private final LobberEntity lobber;
	private PlayerEntity target;
	private int playTimer;

	public LobberCuriosityGoal(LobberEntity lobber) {
		this.lobber = lobber;
		this.setControls(EnumSet.of(Control.MOVE, Control.LOOK));
	}

	@Override
	public boolean canStart() {
		if (this.lobber.isProvoked() || this.lobber.isMature() || this.lobber.hasActiveEvent()) {
			return false;
		}
		this.target = this.lobber.getWorld().getClosestPlayer(this.lobber, 24.0);
		return this.target != null && this.target.isAlive()
				&& !this.target.isCreative() && !this.target.isSpectator();
	}

	@Override
	public boolean shouldContinue() {
		return !this.lobber.isProvoked() && !this.lobber.isMature() && !this.lobber.hasActiveEvent()
				&& this.target != null && this.target.isAlive()
				&& this.lobber.squaredDistanceTo(this.target) < 32.0 * 32.0;
	}

	@Override
	public void stop() {
		this.target = null;
		this.lobber.getNavigation().stop();
	}

	@Override
	public void tick() {
		if (this.target == null) {
			return;
		}
		this.lobber.getLookControl().lookAt(this.target, 30.0f, 30.0f);

		// Braver the more it trusts you: comes within ~2 blocks when friendly, hangs back when wary.
		double approach = this.lobber.isFriendly() ? 2.0 : 4.0;
		double distanceSq = this.lobber.squaredDistanceTo(this.target);

		if (distanceSq > (approach + 1.0) * (approach + 1.0)) {
			this.lobber.getNavigation().startMovingTo(this.target, this.lobber.isFriendly() ? 0.9 : 0.7);
		} else if (distanceSq < (approach - 1.0) * (approach - 1.0)) {
			// A little too close - shuffle back, still watching.
			Vec3d away = this.lobber.getPos().subtract(this.target.getPos()).normalize().multiply(2.0);
			Vec3d retreat = this.lobber.getPos().add(away);
			this.lobber.getNavigation().startMovingTo(retreat.x, retreat.y, retreat.z, 0.6);
		} else {
			this.lobber.getNavigation().stop();
		}

		// Occasional playful particle puff when it's close and comfortable.
		if (--this.playTimer <= 0 && distanceSq < 25.0
				&& this.lobber.getWorld() instanceof ServerWorld serverWorld) {
			this.playTimer = 40 + this.lobber.getRandom().nextInt(40);
			serverWorld.spawnParticles(
					this.lobber.isFriendly() ? ParticleTypes.HEART : ParticleTypes.HAPPY_VILLAGER,
					this.lobber.getX(), this.lobber.getEyeY() + 0.3, this.lobber.getZ(),
					1, 0.2, 0.2, 0.2, 0.0);
		}
	}
}
