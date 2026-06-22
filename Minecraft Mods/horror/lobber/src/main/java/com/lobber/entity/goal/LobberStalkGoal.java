package com.lobber.entity.goal;

import com.lobber.entity.LobberEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Vec3d;

import java.util.EnumSet;

/**
 * While calm, the Lobber shadows the nearest lone player from a wary distance instead of attacking.
 */
public class LobberStalkGoal extends Goal {
	private static final double NEAR_SQ = 8.0 * 8.0;
	private static final double FAR_SQ = 16.0 * 16.0;

	private final LobberEntity lobber;
	private PlayerEntity stalked;

	public LobberStalkGoal(LobberEntity lobber) {
		this.lobber = lobber;
		this.setControls(EnumSet.of(Control.MOVE, Control.LOOK));
	}

	@Override
	public boolean canStart() {
		if (this.lobber.isProvoked() || this.lobber.hasActiveEvent()) {
			return false;
		}
		this.stalked = this.lobber.getWorld().getClosestPlayer(this.lobber, 32.0);
		return this.stalked != null && this.stalked.isAlive() && !this.stalked.isCreative() && !this.stalked.isSpectator();
	}

	@Override
	public boolean shouldContinue() {
		return !this.lobber.isProvoked()
				&& !this.lobber.hasActiveEvent()
				&& this.stalked != null
				&& this.stalked.isAlive()
				&& this.lobber.squaredDistanceTo(this.stalked) < 48.0 * 48.0;
	}

	@Override
	public void stop() {
		this.stalked = null;
		this.lobber.getNavigation().stop();
	}

	@Override
	public void tick() {
		if (this.stalked == null) {
			return;
		}
		this.lobber.getLookControl().lookAt(this.stalked, 30.0f, 30.0f);
		double distanceSq = this.lobber.squaredDistanceTo(this.stalked);

		if (distanceSq > FAR_SQ) {
			this.lobber.getNavigation().startMovingTo(this.stalked, 0.9);
		} else if (distanceSq < NEAR_SQ) {
			Vec3d away = this.lobber.getPos().subtract(this.stalked.getPos()).normalize().multiply(6.0);
			Vec3d retreat = this.lobber.getPos().add(away);
			this.lobber.getNavigation().startMovingTo(retreat.x, retreat.y, retreat.z, 0.9);
		} else {
			this.lobber.getNavigation().stop();
		}
	}
}
