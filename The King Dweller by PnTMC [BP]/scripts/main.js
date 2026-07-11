import { world, system } from '@minecraft/server';
import {
	tickKing,
	tryStartGrabOnHit,
	reconcileGrabs,
	releaseGrab,
	debugTriggerGrab,
	debugTriggerPounce,
	debugTriggerScreech,
	debugTriggerBurrow,
	debugTriggerBleed,
	debugTriggerEnrage,
} from './abilities.js';
import { tickBleeds, registerBleedCureHooks } from './bleed.js';
import { getDimensions, isEntityUsable, isValidMobTarget, distance, markProvoked } from './util.js';

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

	// The king lands a melee hit: it only ever swings at what its AI actually targeted, which
	// is players (nearest_attackable_target) or whatever provoked it
	// (minecraft:behavior.hurt_by_target, unrestricted by design) - so victim is already
	// correctly scoped without re-checking who "should" be attackable here. This is the entry
	// point for a possible Grab.
	if (attacker && attacker.typeId === 'pntmc:king' && isValidMobTarget(victim)) {
		tryStartGrabOnHit(attacker, victim, system.currentTick);
	}

	// The king takes a hit from anything: the king still only *hunts* players on its own, but
	// remembering whoever just attacked it lets abilities.js#tickKing also treat that attacker
	// as a valid target for the rest of the kit (not just plain melee retaliation, which
	// hurt_by_target already handles by itself) for a little while - see
	// util.js#findAbilityTarget.
	if (victim && victim.typeId === 'pntmc:king' && isValidMobTarget(attacker)) {
		markProvoked(victim, attacker, system.currentTick);
	}
});

world.afterEvents.entityDie.subscribe((ev) => {
	try {
		const dead = ev.deadEntity;
		if (dead && dead.typeId === 'pntmc:king') releaseGrab(dead);
	} catch (e) {}
});

registerBleedCureHooks();

// ---- /scriptevent pntmc:<ability> manual test commands --------------------
// Requires cheats enabled (same as /scriptevent generally). Picks the pntmc:king nearest to
// whoever ran the command (falls back to any king in the world if run from a command block/
// console), then forces that one ability through its real state machine - see the
// debugTriggerX() functions and the {force:true} path in abilities.js for exactly what "forced"
// skips (chance/cooldown/range) versus what it still respects (crawling/crouching/spotted).
const TEST_COMMAND_LIST =
	'pntmc:grab, pntmc:throw, pntmc:bite, pntmc:bleed, pntmc:pounce, pntmc:screech, pntmc:burrow, pntmc:enrage, pntmc:help';

function findActingKing(sourceEntity) {
	const kings = getKings();
	if (kings.length === 0) return undefined;
	if (!sourceEntity) return kings[0];
	let best = kings[0];
	let bestDist = Infinity;
	for (const k of kings) {
		let d = Infinity;
		try {
			d = distance(k.location, sourceEntity.location);
		} catch (e) {}
		if (d < bestDist) {
			bestDist = d;
			best = k;
		}
	}
	return best;
}

function replyTo(sourceEntity, msg) {
	try {
		if (sourceEntity && sourceEntity.typeId === 'minecraft:player') sourceEntity.sendMessage(msg);
	} catch (e) {}
}

system.afterEvents.scriptEventReceive.subscribe(
	(ev) => {
		if (!ev.id || !ev.id.startsWith('pntmc:')) return;

		if (ev.id === 'pntmc:help') {
			replyTo(ev.sourceEntity, `§e[King Dweller] Test commands: ${TEST_COMMAND_LIST}`);
			return;
		}

		const king = findActingKing(ev.sourceEntity);
		if (!king) {
			replyTo(ev.sourceEntity, '§c[King Dweller] No pntmc:king found in the world to test on.');
			return;
		}

		const now = system.currentTick;
		let ok = false;
		switch (ev.id) {
			case 'pntmc:grab':
				ok = debugTriggerGrab(king, now);
				break;
			case 'pntmc:throw':
				ok = debugTriggerGrab(king, now, 'throw');
				break;
			case 'pntmc:bite':
				ok = debugTriggerGrab(king, now, 'bite');
				break;
			case 'pntmc:bleed':
				ok = debugTriggerBleed(king, now);
				break;
			case 'pntmc:pounce':
				ok = debugTriggerPounce(king, now);
				break;
			case 'pntmc:screech':
				ok = debugTriggerScreech(king, now);
				break;
			case 'pntmc:burrow':
				ok = debugTriggerBurrow(king, now);
				break;
			case 'pntmc:enrage':
				ok = debugTriggerEnrage(king);
				break;
			default:
				replyTo(ev.sourceEntity, `§c[King Dweller] Unknown test command "${ev.id}". Try: ${TEST_COMMAND_LIST}`);
				return;
		}

		replyTo(
			ev.sourceEntity,
			ok
				? `§a[King Dweller] Forced: ${ev.id}`
				: `§c[King Dweller] Could not force ${ev.id} - no valid mob target nearby, or the king is crawling/crouching/spotted right now.`
		);
	},
	{ namespaces: ['pntmc'] }
);

system.runInterval(() => {
	const now = system.currentTick;
	for (const king of getKings()) {
		try {
			tickKing(king, now);
		} catch (e) {
			console.warn('pntmc:king tick error: ' + e);
		}
	}
	reconcileGrabs();
	tickBleeds(now);
}, TICK_INTERVAL);
