// Summoner Realms — natural enemy spawning (host only). Biome + day/night aware.
import { TILE, UNDERGROUND_Y, MAX_ENEMIES } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { aabb, dist2 } from '../utils.js';

// Keep spawns off-screen-ish but not so far they never arrive (tiles).
const MIN_SPAWN_DIST = 13;
const MAX_SPAWN_DIST = 30;
const SPAWN_INTERVAL = 1.05;
const LOCAL_ACTIVITY_RADIUS = 58 * TILE;

export class Spawner {
  constructor() { this.timer = 1.5; }

  update(dt, game) {
    if (!game.isHost) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = SPAWN_INTERVAL;

    const players = [...game.players.values()].filter(p => p.alive);
    if (!players.length) return;

    // Keep the overall limit high enough for a healthy single-player world, but
    // reserve room for every active player instead of letting one distant group
    // consume the entire budget.
    const globalCap = Math.min(MAX_ENEMIES, 10 + players.length * 4);
    const active = game.enemies.filter(e => !e.fromBoss && !e.dead).length;
    if (active >= globalCap) return;

    // Try the least-populated player first. This prevents enemies far away from
    // one player from blocking spawns around another player in co-op.
    const candidates = players
      .map(p => ({
        p,
        nearby: game.enemies.filter(e => !e.fromBoss && !e.dead &&
          dist2(e.x + e.w / 2, e.y + e.h / 2, p.x + p.w / 2, p.y + p.h / 2) <= LOCAL_ACTIVITY_RADIUS * LOCAL_ACTIVITY_RADIUS
        ).length,
      }))
      .sort((a, b) => a.nearby - b.nearby);

    const localCap = Math.min(globalCap, 8 + players.length * 2);
    for (const { p, nearby } of candidates) {
      if (nearby >= localCap) continue;
      if (this._trySpawnAround(game, p, players)) return;
    }
  }

  _trySpawnAround(game, p, players) {
    const pTileX = Math.floor((p.x + p.w / 2) / TILE);
    const pTileY = Math.floor((p.y + p.h / 2) / TILE);
    const underground = pTileY >= UNDERGROUND_Y;
    const isDay = game.time.isDay;

    // More attempts matter in caves, where most random columns are solid or
    // lack enough headroom. This is still tiny work: it runs once per second.
    for (let attempt = 0; attempt < 14; attempt++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = MIN_SPAWN_DIST + ((Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST + 1)) | 0);
      const sx = Math.max(3, Math.min(game.world.width - 4, pTileX + side * dist));

      const biome = underground
        ? game.world.biomeAt(sx, pTileY)
        : game.world.biomeAt(sx, 0);
      const pool = this._poolForBiome(biome, isDay);
      if (!pool.length) continue;

      const key = pool[(Math.random() * pool.length) | 0];
      const def = ENEMIES[key];

      let x, y;
      if (def.behavior === 'flyer') {
        const spot = this._findOpenAirNear(game, sx, underground ? pTileY : game.world.surfaceY(sx) - 4, def);
        if (!spot) continue;
        x = spot.x; y = spot.y;
      } else {
        const footTy = underground
          ? this._findFloorNear(game, sx, pTileY)
          : game.world.surfaceY(sx);
        if (footTy == null) continue;
        x = sx * TILE;
        y = footTy * TILE - def.h;
      }

      if (!this._fits(game, x, y, def, players)) continue;
      game.spawnEnemy(key, x, y);
      return true;
    }
    return false;
  }

  _poolForBiome(biome, isDay) {
    const pool = [];
    for (const key in ENEMIES) {
      const d = ENEMIES[key];
      if (!d.biomes.includes(biome)) continue;
      // Preserve intentional time-gating: night-only creatures stay night-only,
      // and any future day-only creatures stay out after dark.
      if (d.time === 'night' && isDay) continue;
      if (d.time === 'day' && !isDay) continue;
      pool.push(key);
    }
    return pool;
  }

  // The entire hitbox must be clear of solids, standing on ground, a safe
  // distance from every player, and not overlapping any player.
  _fits(game, x, y, def, players) {
    const box = { x, y, w: def.w, h: def.h };
    if (x < TILE * 2 || y < TILE * 2 || x + def.w >= game.world.width * TILE - TILE * 2) return false;
    if (game.world.rectHitsSolid(x, y, def.w, def.h)) return false;

    // Ground support just beneath the feet (flyers excepted).
    if (def.behavior !== 'flyer') {
      const footTx0 = Math.floor(x / TILE), footTx1 = Math.floor((x + def.w - 1) / TILE);
      const belowTy = Math.floor((y + def.h) / TILE);
      let supported = false;
      for (let tx = footTx0; tx <= footTx1; tx++) if (game.world.isSolidAt(tx, belowTy)) supported = true;
      if (!supported) return false;
    }

    for (const p of players) {
      const dxp = (x + def.w / 2) - (p.x + p.w / 2);
      const dyp = (y + def.h / 2) - (p.y + p.h / 2);
      if (Math.hypot(dxp, dyp) < MIN_SPAWN_DIST * TILE) return false;
      if (aabb(box, p)) return false;
    }
    return true;
  }

  // Find an open-air position for flyers inside a cave or near the surface.
  _findOpenAirNear(game, tx, ty, def) {
    const w = game.world;
    for (let dy = 0; dy < 18; dy++) {
      for (const yy of dy === 0 ? [ty] : [ty - dy, ty + dy]) {
        if (yy <= 2 || yy >= w.height - 3) continue;
        for (const dx of [-1, 0, 1]) {
          const xTile = Math.max(3, Math.min(w.width - 4, tx + dx));
          const y = yy * TILE + Math.max(0, (TILE - def.h) / 2);
          if (!w.rectHitsSolid(xTile * TILE, y, def.w, def.h)) return { x: xTile * TILE, y };
        }
      }
    }
    return null;
  }

  // Find a floor tile near ty at column tx where an enemy can stand (air above a
  // solid). Returns the solid floor tile's y, or null.
  _findFloorNear(game, tx, ty) {
    const w = game.world;
    for (let dy = 0; dy < 18; dy++) {
      for (const yy of dy === 0 ? [ty] : [ty - dy, ty + dy]) {
        if (yy <= 2 || yy >= w.height - 2) continue;
        // yy is a solid floor with two air tiles above it.
        if (w.isSolidAt(tx, yy) && !w.isSolidAt(tx, yy - 1) && !w.isSolidAt(tx, yy - 2)) return yy;
      }
    }
    return null;
  }
}
