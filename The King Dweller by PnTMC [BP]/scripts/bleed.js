import { world } from '@minecraft/server';
import { TPS, getNum, setProp, trySetActionBar, spawnParticleSafe } from './util.js';

// Bleed design (documented per task requirement):
// - Lasts 10s (200 ticks), refreshed to a fresh 10s on every re-bite - it never stacks or extends
//   past that cap, so repeated bites can't build an ever-growing DoT.
// - Ticks 2 damage every 2s (5 pulses => 10 potential damage over the full duration).
// - Cannot kill by itself: damage is clamped so it never drops the victim below 1 HP. It can
//   soften a player to the brink and combo with a follow-up hit/fall, but the bleed tick alone
//   never delivers the kill.
// - Cured by drinking milk (instant clear) or by the 10s timeout. Also cleared on death so a
//   respawn doesn't inherit a stale actionbar/particle.
// - Dynamic properties persist through a relog within the same session, so disconnecting and
//   reconnecting does NOT stop the clock or cure it - not an escape route. A full world/server
//   restart resets system.currentTick, and the stale future timestamp then looks unreasonably
//   far away and gets clamped to "expired" by readFutureTick's sanity window - restarting the
//   world is not a realistic mid-fight exploit, so this tradeoff favors "never stuck" instead.
export const BLEED_DURATION_TICKS = 10 * TPS;
export const BLEED_TICK_INTERVAL = 2 * TPS;
export const BLEED_DAMAGE_PER_PULSE = 2;
const BLEED_MAX_WINDOW = BLEED_DURATION_TICKS + 40;

export function applyBleed(player, now) {
	setProp(player, 'pntmc:bleedEnd', now + BLEED_DURATION_TICKS);
	setProp(player, 'pntmc:bleedNext', now + BLEED_TICK_INTERVAL);
}

export function isBleeding(player, now) {
	const end = getNum(player, 'pntmc:bleedEnd', 0);
	return end > now && end - now <= BLEED_MAX_WINDOW;
}

export function clearBleed(player) {
	setProp(player, 'pntmc:bleedEnd', 0);
	setProp(player, 'pntmc:bleedNext', 0);
}

export function tickBleeds(now) {
	for (const player of world.getPlayers()) {
		let end;
		try {
			end = getNum(player, 'pntmc:bleedEnd', 0);
		} catch (e) {
			continue;
		}
		if (end <= 0) continue;
		if (end <= now || end - now > BLEED_MAX_WINDOW) {
			clearBleed(player);
			continue;
		}

		const loc = player.location;
		spawnParticleSafe(player.dimension, 'minecraft:redstone_wire_dust_particle', {
			x: loc.x + (Math.random() - 0.5) * 0.6,
			y: loc.y + 1 + Math.random() * 0.5,
			z: loc.z + (Math.random() - 0.5) * 0.6,
		});
		const remainingSec = Math.ceil((end - now) / TPS);
		trySetActionBar(player, `§c🩸 Bleeding §7(${remainingSec}s)`);

		const next = getNum(player, 'pntmc:bleedNext', 0);
		if (now >= next) {
			setProp(player, 'pntmc:bleedNext', now + BLEED_TICK_INTERVAL);
			let cur = 20;
			try {
				const health = player.getComponent('minecraft:health');
				if (health) cur = health.currentValue;
			} catch (e) {}
			const dmg = Math.min(BLEED_DAMAGE_PER_PULSE, Math.max(0, cur - 1));
			if (dmg > 0) {
				try {
					player.applyDamage(dmg, { cause: 'magic' });
				} catch (e) {}
			}
		}
	}
}

export function registerBleedCureHooks() {
	world.afterEvents.itemCompleteUse.subscribe((ev) => {
		try {
			if (ev.itemStack && ev.itemStack.typeId === 'minecraft:milk_bucket') {
				const player = ev.source;
				if (player && player.isValid() && getNum(player, 'pntmc:bleedEnd', 0) > 0) {
					clearBleed(player);
					trySetActionBar(player, '§aBleeding cured.');
				}
			}
		} catch (e) {}
	});

	world.afterEvents.entityDie.subscribe((ev) => {
		try {
			const dead = ev.deadEntity;
			if (dead && dead.typeId === 'minecraft:player') {
				clearBleed(dead);
			}
		} catch (e) {}
	});
}
