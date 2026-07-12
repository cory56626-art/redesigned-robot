import { system } from '@minecraft/server';
import {
	TPS,
	getNum,
	getStr,
	setProp,
	readFutureTick,
	playSoundAt,
	spawnParticleSafe,
	spawnRing,
	setFrozen,
	findGroundY,
	hasLineOfSight,
	findNearestMob,
	findAbilityTarget,
	isValidMobTarget,
	horizontalDir,
	normalizeHorizontal,
	randInt,
	isEntityUsable,
	getEntityById,
} from './util.js';
import { applyBleed } from './bleed.js';

// ---- Ability arbitration --------------------------------------------------
// A single dynamic property "pntmc:ab" on the king entity is the one source of truth for
// "what is the king doing right now". Every ability is a small state machine that moves
// through its own phases purely by comparing system.currentTick against a stored end-tick
// (also on the entity) - never by callbacks/timeouts surviving on their own, so a save/reload
// mid-ability can't leave anything half-wired. Only one ability can be in flight at a time
// (tickKing() returns immediately if ab !== 'idle', and every "start" function re-checks
// ab === 'idle' before doing anything), and starting any ability stamps a short global
// cooldown that blocks the *next* ability too, so the kit reads as punctuated hits rather
// than overlapping spam. Enrage is intentionally exempt from all of this - it is a passive,
// permanent stat/visual layer (see king.behavior.json's pntmc:enrage component group) that
// stacks with whichever ability is active rather than competing for the ab slot.
//
// Every ability targets "any mob" (see util.js#isValidMobTarget) rather than players only:
// normal melee widened at the BP level (nearest_attackable_target), and every ability here
// resolves its target through findNearestMob()/isValidMobTarget() instead of a player-only
// query. A few pieces stay player-specific by nature rather than by restriction - the actionbar
// bleed readout, milk-cure, and input-lock/camera-shake only apply to an actual Player - and
// those all degrade gracefully (try/catch no-ops) when the target isn't one.
//
// Every tryStartX() also accepts an optional {force: true}, which is what backs the
// /scriptevent pntmc:<ability> test commands (see main.js): it skips the chance roll, cooldown,
// range/LOS gates, and cleanly resets any ability already in flight, but it still refuses to
// fire while the king is crawling/crouching/spotted, so a "forced" trigger is still a faithful
// test of the real ability rather than a way to break the state machine's own invariants.
const GLOBAL_COOLDOWN = 5 * TPS;
const GLOBAL_COOLDOWN_ENRAGED = 3 * TPS;
const ENRAGE_COOLDOWN_SCALE = 0.6;
const AB_END_MAX_WINDOW = 10 * TPS;
const COOLDOWN_MAX_WINDOW = 150 * TPS;
const GCD_MAX_WINDOW = 50 * TPS;

const GRAB_CHANCE = 0.25;
const GRAB_COOLDOWN = 30 * TPS;
const GRAB_WINDUP_TICKS = 8;
const GRAB_HOLD_TICKS = 40;
const GRAB_THROW_TICKS = 10;
const GRAB_BITE_TICKS = 12;
const GRAB_BITE_DELAY = 6;
const GRAB_BITE_CHANCE = 0.55;
const GRAB_ANCHOR_DIST = 2.2;
const GRAB_BITE_DAMAGE = 8;
const THROW_HORIZ_STRENGTH = 6.5;
const THROW_VERT_STRENGTH = 1.4;

const POUNCE_MIN_RANGE = 5;
const POUNCE_MAX_RANGE = 20;
const POUNCE_COOLDOWN = 14 * TPS;
const POUNCE_WINDUP_TICKS = 22;
const POUNCE_AIR_MAX_TICKS = 40;
const POUNCE_MIN_AIR_TICKS = 4;
const POUNCE_LAND_RADIUS = 2.5;
const POUNCE_DAMAGE = 6;
const POUNCE_IMPULSE_HORIZ = 2.4;
const POUNCE_IMPULSE_VERT = 0.8;

const SCREECH_RANGE = 15;
const SCREECH_COOLDOWN = 25 * TPS;
const SCREECH_DURATION_TICKS = 50;
const SCREECH_MIN_DIST = 6;
const SCREECH_CHANCE_PER_ROLL = 0.15;

const BURROW_TRIGGER_TICKS = 4 * TPS;
const BURROW_FAR_DIST = 22;
const BURROW_COOLDOWN = 30 * TPS;
const BURROW_DIG_TICKS = 20;
const BURROW_UNDER_MIN = 30;
const BURROW_UNDER_MAX = 60;
const BURROW_ERUPT_TICKS = 10;
const BURROW_EMERGE_MAX = 6;
const BURROW_ERUPT_DAMAGE = 5;

// The BP's own controller.animation.king_disappear_akp_PNTMC is the only thing that can see
// query.has_target (script can't - Entity.target needs API 2.10-beta, far past this pack's
// 1.11.0 floor). It now reports that transition to script with a plain /scriptevent
// (pntmc:losttarget / pntmc:foundtarget, wired up in main.js) instead of toggling a vanilla flag
// component - an earlier version of this used minecraft:is_stunned for that signal, which was a
// mistake: unlike is_ignited/is_sheared/is_saddled/is_charged (all inert flags this pack already
// safely repurposes), "stunned" is plausibly an engine-level state that can suspend a mob's own
// behaviors (it's what Wardens/Ravagers use to actually freeze up), so it risked telling the game
// to stop the king's AI rather than just marking a fact for script to read. markLostTarget() /
// markFoundTarget() below just stamp plain dynamic properties, which have zero effect on AI or
// rendering, then tickLostTargetGrace() (called every tickKing pass) is the one applying the
// actual 30-second grace countdown before giving up for real.
const LOST_TARGET_GRACE_TICKS = 30 * TPS;

// Currently-grabbed target ids, mapped to the id of the king holding them. Grab is exclusive to
// one target at a time (only one king can ever exist), so this normally holds 0-1 entries. Kept
// as a map (not a single pointer) so reconcileGrabs() below never depends on any king actually
// existing at the time it runs.
const grabbedTargets = new Map();

function isEnraged(king) {
	try {
		return king.hasComponent('minecraft:is_charged');
	} catch (e) {
		return false;
	}
}

function isLocked(king) {
	try {
		return king.hasComponent('minecraft:is_ignited') || king.hasComponent('minecraft:is_sheared') || king.hasComponent('minecraft:is_saddled');
	} catch (e) {
		return true;
	}
}

function scaleCooldown(king, base) {
	return isEnraged(king) ? Math.round(base * ENRAGE_COOLDOWN_SCALE) : base;
}

function getAb(king) {
	return getStr(king, 'pntmc:ab', 'idle');
}

function setAb(king, ab) {
	setProp(king, 'pntmc:ab', ab);
}

function beginAbility(king, now, ab, phaseTicks) {
	setAb(king, ab);
	setProp(king, 'pntmc:abEnd', now + phaseTicks);
}

function endAbility(king, now) {
	setAb(king, 'idle');
	setProp(king, 'pntmc:abEnd', 0);
}

function getAbEnd(king, now) {
	return readFutureTick(king, 'pntmc:abEnd', now, AB_END_MAX_WINDOW);
}

function gcdReady(king, now) {
	return readFutureTick(king, 'pntmc:gcd', now, GCD_MAX_WINDOW) === 0;
}

function startGcd(king, now) {
	setProp(king, 'pntmc:gcd', now + (isEnraged(king) ? GLOBAL_COOLDOWN_ENRAGED : GLOBAL_COOLDOWN));
}

function cooldownReady(king, name, now) {
	return readFutureTick(king, 'pntmc:cd' + name, now, COOLDOWN_MAX_WINDOW) === 0;
}

function startCooldown(king, name, now, base) {
	setProp(king, 'pntmc:cd' + name, now + scaleCooldown(king, base));
}

function freeze(king, ticks) {
	try {
		king.addEffect('slowness', ticks, { amplifier: 255, showParticles: false });
	} catch (e) {}
}

function playAnim(king, name, blendOut) {
	try {
		king.playAnimation('animation.pntmc_king.' + name, { blendOutTime: blendOut });
	} catch (e) {}
}

// Cleanly resets the king to idle (releasing any grab in progress) so a forced/debug ability
// trigger always starts from a known-good state instead of fighting whatever was already
// running.
function forceIdle(king, now) {
	const ab = getAb(king);
	if (ab === 'grab_wind' || ab === 'grab_hold') releaseGrab(king);
	if (ab !== 'idle') endAbility(king, now);
}

// ---- Grab & Throw / Grab & Bite -------------------------------------------

function computeGrabAnchor(king) {
	let view;
	try {
		view = king.getViewDirection();
	} catch (e) {
		view = { x: 0, z: 1 };
	}
	const horiz = normalizeHorizontal({ x: view.x, z: view.z });
	const loc = king.location;
	return { x: loc.x + horiz.x * GRAB_ANCHOR_DIST, y: loc.y + 1.6, z: loc.z + horiz.z * GRAB_ANCHOR_DIST };
}

function trackGrab(kingId, targetId) {
	grabbedTargets.set(targetId, kingId);
}

function untrackGrab(targetId) {
	if (targetId) grabbedTargets.delete(targetId);
}

function startGrab(king, victim, now) {
	beginAbility(king, now, 'grab_wind', GRAB_WINDUP_TICKS);
	startGcd(king, now);
	startCooldown(king, 'Grab', now, GRAB_COOLDOWN);
	freeze(king, GRAB_WINDUP_TICKS + GRAB_HOLD_TICKS + GRAB_THROW_TICKS + GRAB_BITE_TICKS + 20);

	const anchor = computeGrabAnchor(king);
	setProp(victim, 'pntmc:grabbedBy', king.id);
	setProp(victim, 'pntmc:grabAnchor', anchor);
	setProp(king, 'pntmc:grabId', victim.id);
	setFrozen(victim, true);
	trackGrab(king.id, victim.id);
	try {
		victim.teleport(anchor, { facingLocation: king.getHeadLocation() });
		victim.clearVelocity();
	} catch (e) {}

	playAnim(king, 'grab_windup', 0.15);
	playSoundAt(king, 'pntmc:king_spotted', 1.3, 1.15);
}

export function tryStartGrabOnHit(king, victim, now, opts = {}) {
	if (!isEntityUsable(king) || king.typeId !== 'pntmc:king' || !isValidMobTarget(victim)) return false;
	if (isLocked(king)) return false;
	const force = !!opts.force;
	if (!force) {
		if (getAb(king) !== 'idle') return false;
		if (!gcdReady(king, now) || !cooldownReady(king, 'Grab', now)) return false;
		if (Math.random() > GRAB_CHANCE) return false;
	} else {
		forceIdle(king, now);
	}
	startGrab(king, victim, now);
	return true;
}

function pinGrabbedTarget(king, now) {
	const id = getStr(king, 'pntmc:grabId', '');
	const target = getEntityById(id);
	if (!target) {
		releaseGrab(king);
		endAbility(king, now);
		return;
	}
	let anchor;
	try {
		anchor = target.getDynamicProperty('pntmc:grabAnchor');
	} catch (e) {}
	if (anchor) {
		try {
			target.teleport(anchor, { facingLocation: king.getHeadLocation() });
			target.clearVelocity();
		} catch (e) {}
	}
}

function releaseGrabTarget(target) {
	if (!target) return;
	setFrozen(target, false);
	setProp(target, 'pntmc:grabbedBy', '');
	untrackGrab(target.id);
}

export function releaseGrab(king) {
	const id = getStr(king, 'pntmc:grabId', '');
	setProp(king, 'pntmc:grabId', '');
	untrackGrab(id);
	const target = getEntityById(id);
	releaseGrabTarget(target);
}

function resolveGrabOutcome(king, now) {
	const id = getStr(king, 'pntmc:grabId', '');
	setProp(king, 'pntmc:grabId', '');
	untrackGrab(id);
	const target = getEntityById(id);
	if (!target) {
		endAbility(king, now);
		return;
	}
	const forced = getStr(king, 'pntmc:forcedGrabOutcome', '');
	if (forced) setProp(king, 'pntmc:forcedGrabOutcome', '');
	const bite = forced === 'bite' ? true : forced === 'throw' ? false : Math.random() < GRAB_BITE_CHANCE;
	if (bite) doBite(king, target, now);
	else doThrow(king, target, now);
}

function doThrow(king, victim, now) {
	beginAbility(king, now, 'grab_throw', GRAB_THROW_TICKS);
	playAnim(king, 'grab_throw', 0.2);
	playSoundAt(king, 'pntmc:king_chase4', 1.0, 1.0);
	spawnParticleSafe(king.dimension, 'minecraft:knockback_roar_particle', king.getHeadLocation());

	const dir = horizontalDir(king.location, victim.location);
	releaseGrabTarget(victim);
	try {
		victim.clearVelocity();
		victim.applyKnockback(dir.x, dir.z, THROW_HORIZ_STRENGTH, THROW_VERT_STRENGTH);
	} catch (e) {}
}

function doBite(king, victim, now) {
	beginAbility(king, now, 'grab_bite', GRAB_BITE_TICKS);
	playAnim(king, 'grab_bite', 0.2);
	playSoundAt(king, 'pntmc:king_chase3', 1.0, 1.0);
	const victimId = victim.id;
	const kingId = king.id;

	system.runTimeout(() => {
		const v = getEntityById(victimId);
		releaseGrabTarget(v);
		const k = getEntityById(kingId);
		if (!v || !k) return;
		try {
			v.applyDamage(GRAB_BITE_DAMAGE, { damagingEntity: k });
		} catch (e) {}
		applyBleed(v, system.currentTick);
		spawnParticleSafe(v.dimension, 'minecraft:critical_hit_emitter', v.getHeadLocation());
	}, GRAB_BITE_DELAY);
}

// ---- Pounce -----------------------------------------------------------------

function tryStartPounce(king, now, target, opts = {}) {
	if (!target) return false;
	if (isLocked(king)) return false;
	const force = !!opts.force;
	if (!force) {
		if (!gcdReady(king, now) || !cooldownReady(king, 'Pounce', now)) return false;
		if (target.dist < POUNCE_MIN_RANGE || target.dist > POUNCE_MAX_RANGE) return false;
	} else {
		forceIdle(king, now);
	}

	beginAbility(king, now, 'pounce_wind', POUNCE_WINDUP_TICKS);
	startGcd(king, now);
	startCooldown(king, 'Pounce', now, POUNCE_COOLDOWN);
	freeze(king, POUNCE_WINDUP_TICKS + 4);
	setProp(king, 'pntmc:pounceTargetId', target.mob.id);

	playAnim(king, 'pounce_windup', 0.15);
	playSoundAt(king, 'pntmc:king_chase1', 0.7, 0.75);
	return true;
}

function launchPounce(king, now) {
	const target = getEntityById(getStr(king, 'pntmc:pounceTargetId', ''));
	if (!target) {
		endAbility(king, now);
		return;
	}

	beginAbility(king, now, 'pounce_air', POUNCE_AIR_MAX_TICKS);
	setProp(king, 'pntmc:pounceAirStart', now);
	try {
		king.removeEffect('slowness');
	} catch (e) {}

	const dir = horizontalDir(king.location, target.location);
	try {
		king.clearVelocity();
		king.applyImpulse({ x: dir.x * POUNCE_IMPULSE_HORIZ, y: POUNCE_IMPULSE_VERT, z: dir.z * POUNCE_IMPULSE_HORIZ });
	} catch (e) {}
	playAnim(king, 'pounce_leap', 0.1);
	playSoundAt(king, 'pntmc:king_chase4', 0.9, 1.1);
}

function checkPounceLanding(king, now) {
	const start = getNum(king, 'pntmc:pounceAirStart', now);
	if (now - start < POUNCE_MIN_AIR_TICKS) return;
	let onGround = false;
	try {
		onGround = king.isOnGround;
	} catch (e) {}
	if (onGround) landPounce(king, now);
}

function landPounce(king, now) {
	beginAbility(king, now, 'pounce_land', 8);
	try {
		king.clearVelocity();
	} catch (e) {}

	let fizzle = false;
	try {
		const block = king.dimension.getBlock(king.location);
		if (block && (block.typeId === 'minecraft:water' || block.typeId === 'minecraft:lava')) fizzle = true;
	} catch (e) {}
	if (fizzle) return;

	spawnParticleSafe(king.dimension, 'minecraft:knockback_roar_particle', king.location);
	spawnRing(king, 'minecraft:falling_dust_gravel_particle', POUNCE_LAND_RADIUS, 8);
	playSoundAt(king, 'pntmc:king_chase4', 1.0, 0.8);

	let victims = [];
	try {
		victims = king.dimension.getEntities({ location: king.location, maxDistance: POUNCE_LAND_RADIUS });
	} catch (e) {}
	for (const v of victims) {
		if (!isValidMobTarget(v)) continue;
		try {
			v.applyDamage(POUNCE_DAMAGE, { damagingEntity: king });
			const kd = horizontalDir(king.location, v.location);
			v.applyKnockback(kd.x, kd.z, 0.6, 0.4);
			v.addEffect('slowness', 30, { amplifier: 1, showParticles: false });
		} catch (e) {}
	}
}

// ---- Petrifying Screech -------------------------------------------------------

function tryStartScreech(king, now, target, opts = {}) {
	if (isLocked(king)) return false;
	const force = !!opts.force;
	if (!force) {
		if (!target) return false;
		if (now % TPS !== 0) return false;
		if (!gcdReady(king, now) || !cooldownReady(king, 'Screech', now)) return false;
		if (target.dist < SCREECH_MIN_DIST) return false;
		if (Math.random() > SCREECH_CHANCE_PER_ROLL) return false;
	} else {
		forceIdle(king, now);
	}

	beginAbility(king, now, 'screech', SCREECH_DURATION_TICKS);
	startGcd(king, now);
	startCooldown(king, 'Screech', now, SCREECH_COOLDOWN);
	freeze(king, SCREECH_DURATION_TICKS + 10);

	playAnim(king, 'screech', 0.3);
	playSoundAt(king, 'pntmc:king_spotted', 1.3, 0.85);
	doScreechBurst(king);
	return true;
}

function doScreechBurst(king) {
	let victims = [];
	try {
		victims = king.dimension.getEntities({ location: king.location, maxDistance: SCREECH_RANGE });
	} catch (e) {}
	for (const v of victims) {
		if (!isValidMobTarget(v)) continue;
		try {
			v.addEffect('blindness', 70, { amplifier: 0, showParticles: false });
			v.addEffect('darkness', 80, { amplifier: 0, showParticles: false });
			v.addEffect('nausea', 90, { amplifier: 1, showParticles: false });
			v.addEffect('slowness', 40, { amplifier: 1, showParticles: false });
			if (v.typeId === 'minecraft:player') v.runCommand('camerashake add @s 0.4 2 positional');
		} catch (e) {}
	}
	spawnRing(king, 'minecraft:knockback_roar_particle', 1.5, 6);
}

// ---- Burrow Ambush --------------------------------------------------------
// Two traps this pack specifically sets for a naive burrow implementation:
//  1) controller.animation.king_disappear_* (BP animation controllers) despawns the king off
//     query.life_time once it has no target for a while. Burrowing keeps the same entity
//     instance and never clears its AI target (must_see:false already lets the vanilla
//     nearest_attackable_target behavior hold the target through the LOS break), so
//     query.has_target stays true and that timer never arms.
//  2) pntmc_runInterval_king.mcfunction despawns any pntmc:king that doesn't hold the
//     "spawnonlyone" tag. Never summon a stand-in for the burrow - teleport this exact
//     entity - so that tag is never at risk and the re-emerged king can't be killed by its
//     own housekeeping function.

function updateBurrowTracking(king, target) {
	if (!target) return;
	const los = target.dist <= BURROW_FAR_DIST && hasLineOfSight(king, target.mob);
	if (los) {
		setProp(king, 'pntmc:noLos', 0);
	} else {
		setProp(king, 'pntmc:noLos', getNum(king, 'pntmc:noLos', 0) + 2);
	}
}

function tryStartBurrow(king, now, target, opts = {}) {
	if (isLocked(king)) return false;
	const force = !!opts.force;
	if (!force) {
		if (!target) return false;
		if (!gcdReady(king, now) || !cooldownReady(king, 'Burrow', now)) return false;
		if (getNum(king, 'pntmc:noLos', 0) < BURROW_TRIGGER_TICKS) return false;
	} else {
		forceIdle(king, now);
	}

	setProp(king, 'pntmc:noLos', 0);
	beginAbility(king, now, 'burrow_dig', BURROW_DIG_TICKS);
	startGcd(king, now);
	startCooldown(king, 'Burrow', now, BURROW_COOLDOWN);
	freeze(king, BURROW_DIG_TICKS + 5);
	setProp(king, 'pntmc:burrowTargetId', target ? target.mob.id : '');

	playAnim(king, 'burrow_dig', 0.2);
	playSoundAt(king, 'pntmc:king_disappear', 2.0, 1.0);
	spawnRing(king, 'minecraft:falling_dust_gravel_particle', 1.5, 8);
	return true;
}

function enterBurrowUnder(king, now) {
	const target = getEntityById(getStr(king, 'pntmc:burrowTargetId', ''));
	const anchor = target ? target.location : king.location;
	const underTicks = randInt(BURROW_UNDER_MIN, BURROW_UNDER_MAX);
	beginAbility(king, now, 'burrow_under', underTicks);

	const ex = anchor.x + (Math.random() * 2 - 1) * BURROW_EMERGE_MAX;
	const ez = anchor.z + (Math.random() * 2 - 1) * BURROW_EMERGE_MAX;
	setProp(king, 'pntmc:emergeSpot', { x: ex, y: anchor.y, z: ez });

	const groundY = findGroundY(king.dimension, ex, ez, anchor.y);
	const underDuration = underTicks + BURROW_ERUPT_TICKS + 20;
	try {
		king.addEffect('invisibility', underDuration, { amplifier: 0, showParticles: false });
		king.addEffect('resistance', underDuration, { amplifier: 255, showParticles: false });
	} catch (e) {}
	try {
		king.teleport({ x: ex, y: groundY - 4, z: ez });
	} catch (e) {}
}

function eruptBurrow(king, now) {
	let spot;
	try {
		spot = king.getDynamicProperty('pntmc:emergeSpot');
	} catch (e) {}
	if (!spot) spot = king.location;
	const groundY = findGroundY(king.dimension, spot.x, spot.z, spot.y + 4);

	beginAbility(king, now, 'burrow_erupt', BURROW_ERUPT_TICKS);
	try {
		king.removeEffect('invisibility');
		king.removeEffect('resistance');
	} catch (e) {}

	const target = getEntityById(getStr(king, 'pntmc:burrowTargetId', ''));
	try {
		king.teleport({ x: spot.x, y: groundY, z: spot.z }, target ? { facingLocation: target.location } : undefined);
	} catch (e) {}

	playAnim(king, 'burrow_erupt', 0.2);
	playSoundAt(king, 'pntmc:king_chase2', 1.2, 0.9);
	spawnParticleSafe(king.dimension, 'minecraft:huge_explosion_emitter', { x: spot.x, y: groundY, z: spot.z });
	spawnRing(king, 'minecraft:falling_dust_gravel_particle', 2, 10);

	let victims = [];
	try {
		victims = king.dimension.getEntities({ location: king.location, maxDistance: 3 });
	} catch (e) {}
	for (const v of victims) {
		if (!isValidMobTarget(v)) continue;
		try {
			v.applyDamage(BURROW_ERUPT_DAMAGE, { damagingEntity: king });
			const kd = horizontalDir(king.location, v.location);
			v.applyKnockback(kd.x, kd.z, 0.5, 0.3);
		} catch (e) {}
	}
}

// ---- Enrage (visual/aura upkeep only - the buff itself is BP-native) ------------

function tickEnrageAura(king, now) {
	if (!isEnraged(king)) return;

	let announced = false;
	try {
		announced = !!king.getDynamicProperty('pntmc:enrageAnnounced');
	} catch (e) {}
	if (!announced) {
		setProp(king, 'pntmc:enrageAnnounced', true);
		playSoundAt(king, 'pntmc:dweller_hurt', 1.5, 0.7);
		spawnRing(king, 'minecraft:critical_hit_emitter', 2.5, 10);
	}

	if (now % 12 !== 0) return;
	let loc;
	try {
		loc = king.getHeadLocation();
	} catch (e) {
		return;
	}
	for (let i = 0; i < 2; i++) {
		spawnParticleSafe(king.dimension, 'minecraft:basic_flame_particle', {
			x: loc.x + (Math.random() - 0.5) * 2.5,
			y: loc.y + (Math.random() - 0.5) * 3,
			z: loc.z + (Math.random() - 0.5) * 2.5,
		});
	}
}

// ---- Lost-target grace period (see the LOST_TARGET_GRACE_TICKS comment above) --------------

// Called from main.js when the /scriptevent pntmc:losttarget signal arrives (fired by the
// animation controller the instant query.has_target goes false).
export function markLostTarget(king, now) {
	setProp(king, 'pntmc:hasNoTarget', true);
	if (getNum(king, 'pntmc:noTargetSince', 0) <= 0) {
		setProp(king, 'pntmc:noTargetSince', now);
	}
}

// Called from main.js when /scriptevent pntmc:foundtarget arrives (query.has_target true again) -
// cancels the grace countdown entirely, no partial credit.
export function markFoundTarget(king) {
	setProp(king, 'pntmc:hasNoTarget', false);
	setProp(king, 'pntmc:noTargetSince', 0);
}

function tickLostTargetGrace(king, now) {
	let hasNoTarget = false;
	try {
		hasNoTarget = !!king.getDynamicProperty('pntmc:hasNoTarget');
	} catch (e) {}

	if (!hasNoTarget) {
		setProp(king, 'pntmc:noTargetSince', 0);
		return;
	}

	let since = getNum(king, 'pntmc:noTargetSince', 0);
	if (since <= 0 || since > now) {
		since = now;
		setProp(king, 'pntmc:noTargetSince', since);
	}

	if (now - since >= LOST_TARGET_GRACE_TICKS) {
		try {
			king.triggerEvent('pntmc:vanish');
		} catch (e) {}
	}
}

// ---- Phase resolution + main per-king tick --------------------------------

function resolveExpiredPhase(king, ab, now) {
	switch (ab) {
		case 'grab_wind':
			beginAbility(king, now, 'grab_hold', GRAB_HOLD_TICKS);
			playAnim(king, 'grab_hold', 0.2);
			break;
		case 'grab_hold':
			resolveGrabOutcome(king, now);
			break;
		case 'grab_throw':
		case 'grab_bite':
			endAbility(king, now);
			break;
		case 'pounce_wind':
			launchPounce(king, now);
			break;
		case 'pounce_air':
			landPounce(king, now);
			break;
		case 'pounce_land':
			endAbility(king, now);
			break;
		case 'screech':
			endAbility(king, now);
			break;
		case 'burrow_dig':
			enterBurrowUnder(king, now);
			break;
		case 'burrow_under':
			eruptBurrow(king, now);
			break;
		case 'burrow_erupt':
			endAbility(king, now);
			break;
		default:
			endAbility(king, now);
	}
}

export function tickKing(king, now) {
	if (!isEntityUsable(king) || king.typeId !== 'pntmc:king') return;
	const ab = getAb(king);

	if (ab === 'grab_wind' || ab === 'grab_hold') pinGrabbedTarget(king, now);
	if (ab === 'pounce_air') checkPounceLanding(king, now);

	tickEnrageAura(king, now);
	tickLostTargetGrace(king, now);

	const target = findAbilityTarget(king, 40, now);
	updateBurrowTracking(king, target);

	if (ab !== 'idle') {
		if (getAbEnd(king, now) === 0) resolveExpiredPhase(king, ab, now);
		return;
	}

	if (isLocked(king)) return;

	if (tryStartBurrow(king, now, target)) return;
	if (tryStartScreech(king, now, target)) return;
	tryStartPounce(king, now, target);
}

export function reconcileGrabs() {
	for (const [targetId, kingId] of Array.from(grabbedTargets.entries())) {
		const king = getEntityById(kingId);
		const stillHeld =
			king &&
			king.typeId === 'pntmc:king' &&
			(getAb(king) === 'grab_wind' || getAb(king) === 'grab_hold') &&
			getStr(king, 'pntmc:grabId', '') === targetId;
		if (!stillHeld) {
			releaseGrabTarget(getEntityById(targetId));
			grabbedTargets.delete(targetId);
		}
	}
}

// ---- /scriptevent pntmc:<ability> test hooks (see main.js) ---------------

export function debugTriggerGrab(king, now, forcedOutcome) {
	const target = findNearestMob(king, 48);
	if (!target) return false;
	if (forcedOutcome === 'throw' || forcedOutcome === 'bite') setProp(king, 'pntmc:forcedGrabOutcome', forcedOutcome);
	return tryStartGrabOnHit(king, target.mob, now, { force: true });
}

export function debugTriggerPounce(king, now) {
	const target = findNearestMob(king, 48);
	if (!target) return false;
	return tryStartPounce(king, now, target, { force: true });
}

export function debugTriggerScreech(king, now) {
	const target = findNearestMob(king, 48);
	return tryStartScreech(king, now, target, { force: true });
}

export function debugTriggerBurrow(king, now) {
	const target = findNearestMob(king, 48);
	return tryStartBurrow(king, now, target, { force: true });
}

export function debugTriggerBleed(king, now) {
	const target = findNearestMob(king, 48);
	if (!target) return false;
	applyBleed(target.mob, now);
	try {
		spawnParticleSafe(target.mob.dimension, 'minecraft:critical_hit_emitter', target.mob.getHeadLocation());
	} catch (e) {}
	return true;
}

export function debugTriggerEnrage(king) {
	try {
		king.triggerEvent('pntmc:enrage');
		return true;
	} catch (e) {
		return false;
	}
}
