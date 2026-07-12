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
	markLostTarget,
	markFoundTarget,
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

	// The king takes a melee hit from anything: remembering the attacker lets
	// abilities.js#tickKing treat it as a valid target for the rest of the kit, not just plain
	// melee retaliation (hurt_by_target already handles that by itself) - see
	// util.js#findAbilityTarget. entityHitEntity only fires for an actual melee swing connecting
	// though, so this alone would miss anything that hurts the king by any other means (a
	// command, a projectile, another mod's own applyDamage() call) - see the entityHurt listener
	// below for the broader net.
	if (victim && victim.typeId === 'pntmc:king' && isValidMobTarget(attacker)) {
		markProvoked(victim, attacker, system.currentTick);
	}
});

// Broader than entityHitEntity above: fires for *any* damage the king takes, regardless of how it
// was dealt (melee, projectile, /damage command, another pack's own scripted applyDamage() call).
// A third-party "make mobs fight" tool is far more likely to deal damage this way than through an
// actual simulated melee swing, so this is the net that actually catches it.
world.afterEvents.entityHurt.subscribe((ev) => {
	const victim = ev.hurtEntity;
	if (!victim || victim.typeId !== 'pntmc:king') return;
	let attacker;
	try {
		attacker = ev.damageSource && ev.damageSource.damagingEntity;
	} catch (e) {}
	if (attacker && isValidMobTarget(attacker)) {
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

		// Internal signal from controller.animation.king_disappear_akp_PNTMC (see
		// king_dweller_animation_controllers.json), not a user-facing test command. Sent as a
		// plain /scriptevent from the entity's own on_entry/on_exit rather than a vanilla flag
		// component, precisely so it can't have any side effect on the king's actual AI/movement.
		if (ev.id === 'pntmc:losttarget' || ev.id === 'pntmc:foundtarget') {
			let king = ev.sourceEntity && ev.sourceEntity.typeId === 'pntmc:king' ? ev.sourceEntity : undefined;
			if (!king) king = findActingKing(ev.sourceEntity);
			if (!king) return;
			if (ev.id === 'pntmc:losttarget') markLostTarget(king, system.currentTick);
			else markFoundTarget(king);
			return;
		}

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
