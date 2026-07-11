import { world } from '@minecraft/server';
import { TPS, getNum, setProp, trySetActionBar, spawnParticleSafe, getEntityById, isEntityUsable } from './util.js';

// Bleed design (documented per task requirement):
// - Works on any mob, not just players (see the "any mob" ability generalization) - damage,
//   particles and the cannot-kill clamp all operate on generic Entity/health-component state.
//   The actionbar countdown only makes sense for a player, and quietly no-ops (via
//   trySetActionBar's own try/catch) when the bleeding entity isn't one.
// - Lasts 10s (200 ticks), refreshed to a fresh 10s on every re-bite - it never stacks or extends
//   past that cap, so repeated bites can't build an ever-growing DoT.
// - Ticks 2 damage every 2s (5 pulses => 10 potential damage over the full duration).
// - Cannot kill by itself: damage is clamped so it never drops the victim below 1 HP. It can
//   soften a target to the brink and combo with a follow-up hit/fall, but the bleed tick alone
//   never delivers the kill.
// - Cured by drinking milk (instant clear, players only) or by the 10s timeout. Also cleared on
//   death so a respawn doesn't inherit a stale actionbar/particle.
// - Dynamic properties persist through a relog within the same session, so disconnecting and
//   reconnecting does NOT stop the clock or cure it - not an escape route. A full world/server
//   restart resets the in-memory tracking set below (and, within a session, the stale end tick
//   would also get clamped away by the same kind of sanity window used elsewhere) - restarting
//   the world is not a realistic mid-fight exploit, so this tradeoff favors "never stuck" instead.
export const BLEED_DURATION_TICKS = 10 * TPS;
export const BLEED_TICK_INTERVAL = 2 * TPS;
export const BLEED_DAMAGE_PER_PULSE = 2;
const BLEED_MAX_WINDOW = BLEED_DURATION_TICKS + 40;

// Bleed can be active on any number of different mobs at once (unlike grab, which is exclusive
// to one target at a time), so tracking is a set of ids rather than a single pointer. This lets
// tickBleeds() only ever visit entities that are actually bleeding instead of scanning every
// entity in the world every pass.
const bleedingIds = new Set();

export function applyBleed(target, now) {
	setProp(target, 'pntmc:bleedEnd', now + BLEED_DURATION_TICKS);
	setProp(target, 'pntmc:bleedNext', now + BLEED_TICK_INTERVAL);
	bleedingIds.add(target.id);
}

export function isBleeding(target, now) {
	const end = getNum(target, 'pntmc:bleedEnd', 0);
	return end > now && end - now <= BLEED_MAX_WINDOW;
}

export function clearBleed(target) {
	setProp(target, 'pntmc:bleedEnd', 0);
	setProp(target, 'pntmc:bleedNext', 0);
	if (target) bleedingIds.delete(target.id);
}

export function tickBleeds(now) {
	for (const id of Array.from(bleedingIds)) {
		const target = getEntityById(id);
		if (!isEntityUsable(target)) {
			bleedingIds.delete(id);
			continue;
		}

		const end = getNum(target, 'pntmc:bleedEnd', 0);
		if (end <= 0) {
			bleedingIds.delete(id);
			continue;
		}
		if (end <= now || end - now > BLEED_MAX_WINDOW) {
			clearBleed(target);
			continue;
		}

		const loc = target.location;
		spawnParticleSafe(target.dimension, 'minecraft:redstone_wire_dust_particle', {
			x: loc.x + (Math.random() - 0.5) * 0.6,
			y: loc.y + 1 + Math.random() * 0.5,
			z: loc.z + (Math.random() - 0.5) * 0.6,
		});
		const remainingSec = Math.ceil((end - now) / TPS);
		trySetActionBar(target, `§c🩸 Bleeding §7(${remainingSec}s)`);

		const next = getNum(target, 'pntmc:bleedNext', 0);
		if (now >= next) {
			setProp(target, 'pntmc:bleedNext', now + BLEED_TICK_INTERVAL);
			let cur = 20;
			try {
				const health = target.getComponent('minecraft:health');
				if (health) cur = health.currentValue;
			} catch (e) {}
			const dmg = Math.min(BLEED_DAMAGE_PER_PULSE, Math.max(0, cur - 1));
			if (dmg > 0) {
				try {
					target.applyDamage(dmg);
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
			if (dead) clearBleed(dead);
		} catch (e) {}
	});
}
