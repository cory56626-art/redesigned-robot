import { world, system } from '@minecraft/server';

export const TPS = 20;

export function sub(a, b) {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function length(v) {
	return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function distance(a, b) {
	return length(sub(a, b));
}

export function normalizeHorizontal(v) {
	const len = Math.sqrt(v.x * v.x + v.z * v.z);
	if (len < 1e-6) return { x: 1, z: 0 };
	return { x: v.x / len, z: v.z / len };
}

export function horizontalDir(from, to) {
	return normalizeHorizontal({ x: to.x - from.x, z: to.z - from.z });
}

export function randInt(min, max) {
	return Math.floor(min + Math.random() * (max - min + 1));
}

export function getDimensions() {
	return ['overworld', 'nether', 'the_end'].map((id) => world.getDimension(id));
}

export function isEntityUsable(entity) {
	try {
		return !!entity && entity.isValid();
	} catch (e) {
		return false;
	}
}

export function getEntityById(id) {
	if (!id) return undefined;
	try {
		const e = world.getEntity(id);
		return isEntityUsable(e) ? e : undefined;
	} catch (e) {
		return undefined;
	}
}

export function getNum(entity, key, fallback) {
	try {
		const v = entity.getDynamicProperty(key);
		return typeof v === 'number' ? v : fallback;
	} catch (e) {
		return fallback;
	}
}

export function getStr(entity, key, fallback) {
	try {
		const v = entity.getDynamicProperty(key);
		return typeof v === 'string' ? v : fallback;
	} catch (e) {
		return fallback;
	}
}

export function setProp(entity, key, value) {
	try {
		entity.setDynamicProperty(key, value);
	} catch (e) {}
}

// Ability-phase and cooldown timestamps are stored as absolute system.currentTick values.
// If the world/server process restarts, currentTick resets to a small number, which would
// otherwise make old stale timestamps look "far in the future" (permanently on cooldown) or
// leave an in-progress ability phase stuck (its end time never arrives). Reading every such
// value through this clamp means a reload always self-heals within one tick-loop pass instead
// of requiring a dedicated world-load hook.
export function readFutureTick(entity, key, now, maxWindowTicks) {
	const v = getNum(entity, key, 0);
	if (v <= now) return 0;
	if (v - now > maxWindowTicks) return 0;
	return v;
}

export function trySetActionBar(player, text) {
	try {
		player.onScreenDisplay.setActionBar(text);
	} catch (e) {}
}

export function playSoundAt(entity, soundId, volume, pitch) {
	try {
		entity.dimension.playSound(soundId, entity.location, { volume, pitch });
	} catch (e) {}
}

export function spawnParticleSafe(dimension, particleId, location) {
	try {
		dimension.spawnParticle(particleId, location);
	} catch (e) {}
}

export function spawnRing(entity, particleId, radius, steps = 10) {
	const loc = entity.location;
	for (let i = 0; i < steps; i++) {
		const ang = (i / steps) * Math.PI * 2;
		spawnParticleSafe(entity.dimension, particleId, {
			x: loc.x + Math.cos(ang) * radius,
			y: loc.y + 0.1,
			z: loc.z + Math.sin(ang) * radius,
		});
	}
}

export function setFrozen(player, frozen) {
	try {
		if (player.inputPermissions) {
			player.inputPermissions.movementEnabled = !frozen;
		}
	} catch (e) {}
}

// Manual ground scan instead of Dimension.getTopmostBlock, which needs @minecraft/server 1.13.0
// (Minecraft 1.21.20) - this pack's floor is 1.11.0 (Minecraft 1.21.0), so that API can't be
// relied on to exist yet.
export function findGroundY(dimension, x, z, startY) {
	let y = Math.min(Math.floor(startY) + 8, 319);
	const bottom = -64;
	for (let i = 0; i < 128 && y > bottom; i++, y--) {
		let block;
		try {
			block = dimension.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
		} catch (e) {
			continue;
		}
		if (block && !block.isAir && !block.isLiquid) return y + 1;
	}
	return Math.floor(startY);
}

export function hasLineOfSight(king, target) {
	try {
		const from = king.getHeadLocation();
		const to = target.getHeadLocation();
		const dist = distance(from, to);
		if (dist < 0.5) return true;
		const dir = { x: (to.x - from.x) / dist, y: (to.y - from.y) / dist, z: (to.z - from.z) / dist };
		const hit = king.dimension.getBlockFromRay(from, dir, {
			maxDistance: Math.max(0.1, dist - 0.3),
			includeLiquidBlocks: false,
			includePassableBlocks: false,
		});
		return !hit;
	} catch (e) {
		return true;
	}
}

// Every pntmc:king/king_trigger/king_flee/king_ambient shares the "pntmc" type_family, but that's
// only readable through a component lookup on a *live* entity. Hardcoding the four identifiers
// here is simpler and just as reliable, and lets isValidMobTarget() work purely off typeId.
export const PNTMC_TYPE_IDS = new Set(['pntmc:king', 'pntmc:king_trigger', 'pntmc:king_flee', 'pntmc:king_ambient']);

// "Any mob" candidacy check shared by targeting and every AOE ability. minecraft:health is the
// one component every actual creature/player has and inert entities (item drops, XP orbs,
// arrows, boats, minecarts, paintings, item frames, end crystals, TNT, falling blocks...) don't,
// so it's a robust way to mean "a living thing" without having to enumerate every vanilla
// is_family tag (which isn't universal across mob types) or guess at ones that don't exist.
export function isValidMobTarget(entity) {
	if (!isEntityUsable(entity)) return false;
	if (PNTMC_TYPE_IDS.has(entity.typeId)) return false;
	try {
		if (!entity.hasComponent('minecraft:health')) return false;
	} catch (e) {
		return false;
	}
	if (entity.typeId === 'minecraft:player') {
		try {
			const mode = entity.getGameMode();
			if (mode === 'creative' || mode === 'spectator') return false;
		} catch (e) {}
	}
	return true;
}

// Only used by the /scriptevent debug triggers (main.js), which are explicitly bypassing normal
// gating anyway - "any nearby mob" is the right pool for a manual test command. The real
// automatic ability triggering in abilities.js#tickKing uses findAbilityTarget() below instead,
// which is deliberately more restrictive.
export function findNearestMob(entity, maxDistance) {
	let best;
	let bestDist = Infinity;
	let candidates;
	try {
		candidates = entity.dimension.getEntities({ location: entity.location, maxDistance });
	} catch (e) {
		return undefined;
	}
	for (const c of candidates) {
		if (c.id === entity.id) continue;
		if (!isValidMobTarget(c)) continue;
		const d = distance(entity.location, c.location);
		if (d < bestDist) {
			bestDist = d;
			best = c;
		}
	}
	return best ? { mob: best, dist: bestDist } : undefined;
}

// The king still only *hunts* players proactively (see king.behavior.json's
// nearest_attackable_target, back to a player-only filter) - it must not go out of its way to
// pounce on/screech at/burrow-ambush a cow that never did anything to it. But it should still be
// able to bring its full kit to bear against any mob that attacks it first, not just retaliate
// with plain melee (minecraft:behavior.hurt_by_target already handles melee retaliation against
// any attacker on its own, since that behavior has no entity_types filter).
//
// markProvoked() is called from main.js whenever anything lands a hit on the king; it remembers
// that attacker for PROVOKE_DURATION_TICKS. findAbilityTarget() is what abilities.js#tickKing
// polls each pass to decide who's eligible for automatic ability triggering: any nearby player
// (the normal hunting behavior), plus the currently-remembered attacker even when it isn't a
// player. A mob that never attacked the king is never a candidate here, no matter how close it
// stands.
const PROVOKE_DURATION_TICKS = 15 * TPS;
const PROVOKE_MAX_WINDOW = PROVOKE_DURATION_TICKS + 20;

export function markProvoked(king, attacker, now) {
	setProp(king, 'pntmc:provokedId', attacker.id);
	setProp(king, 'pntmc:provokedUntil', now + PROVOKE_DURATION_TICKS);
}

export function findAbilityTarget(king, maxDistance, now) {
	let best;
	let bestDist = Infinity;

	let players = [];
	try {
		players = king.dimension.getPlayers({ location: king.location, maxDistance });
	} catch (e) {}
	for (const p of players) {
		if (!isValidMobTarget(p)) continue;
		const d = distance(king.location, p.location);
		if (d < bestDist) {
			bestDist = d;
			best = p;
		}
	}

	if (readFutureTick(king, 'pntmc:provokedUntil', now, PROVOKE_MAX_WINDOW) > 0) {
		const attacker = getEntityById(getStr(king, 'pntmc:provokedId', ''));
		if (attacker && isValidMobTarget(attacker)) {
			const d = distance(king.location, attacker.location);
			if (d <= maxDistance && d < bestDist) {
				bestDist = d;
				best = attacker;
			}
		}
	}

	return best ? { mob: best, dist: bestDist } : undefined;
}

export const currentTick = () => system.currentTick;
