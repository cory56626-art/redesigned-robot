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

export function hasLineOfSight(king, player) {
	try {
		const from = king.getHeadLocation();
		const to = player.getHeadLocation();
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

export function findNearestPlayer(entity, maxDistance) {
	let best;
	let bestDist = Infinity;
	let players;
	try {
		players = entity.dimension.getPlayers({ location: entity.location, maxDistance });
	} catch (e) {
		return undefined;
	}
	for (const p of players) {
		if (!isEntityUsable(p)) continue;
		try {
			if (p.getGameMode() === 'creative' || p.getGameMode() === 'spectator') continue;
		} catch (e) {}
		const d = distance(entity.location, p.location);
		if (d < bestDist) {
			bestDist = d;
			best = p;
		}
	}
	return best ? { player: best, dist: bestDist } : undefined;
}

export const currentTick = () => system.currentTick;
