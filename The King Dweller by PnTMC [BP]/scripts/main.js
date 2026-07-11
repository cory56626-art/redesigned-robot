import { world, system } from '@minecraft/server';
import { tickKing, tryStartGrabOnHit, reconcileGrabbedPlayers, releaseGrab } from './abilities.js';
import { tickBleeds, registerBleedCureHooks } from './bleed.js';
import { getDimensions, isEntityUsable } from './util.js';

const TICK_INTERVAL = 2;

function getKings() {
	const kings = [];
	for (const dim of getDimensions()) {
		let found;
		try {
			found = dim.getEntities({ type: 'pntmc:king' });
		} catch (e) {
			continue;
		}
		for (const e of found) {
			if (isEntityUsable(e)) kings.push(e);
		}
	}
	return kings;
}

world.afterEvents.entityHitEntity.subscribe((ev) => {
	const attacker = ev.damagingEntity;
	const victim = ev.hitEntity;
	if (!attacker || attacker.typeId !== 'pntmc:king') return;
	if (!victim || victim.typeId !== 'minecraft:player') return;
	tryStartGrabOnHit(attacker, victim, system.currentTick);
});

world.afterEvents.entityDie.subscribe((ev) => {
	try {
		const dead = ev.deadEntity;
		if (dead && dead.typeId === 'pntmc:king') releaseGrab(dead);
	} catch (e) {}
});

registerBleedCureHooks();

system.runInterval(() => {
	const now = system.currentTick;
	for (const king of getKings()) {
		try {
			tickKing(king, now);
		} catch (e) {
			console.warn('pntmc:king tick error: ' + e);
		}
	}
	reconcileGrabbedPlayers();
	tickBleeds(now);
}, TICK_INTERVAL);
