// Summoner Realms — natural enemy spawning (host only). Biome + day/night aware.
import { TILE, UNDERGROUND_Y, MAX_ENEMIES } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { aabb } from '../utils.js';

// Keep spawns off-screen-ish but not so far they never arrive (tiles).
const MIN_SPAWN_DIST = 13;
const MAX_SPAWN_DIST = 30;

export class Spawner {
  constructor() { this.timer = 1.5; }

  update(dt, game) {
    if (!game.isHost) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.1;

    const players = [...game.players.values()].filter(p => p.alive);
    if (!players.length) return;
    const cap = Math.min(MAX_ENEMIES, 6 + players.length * 3);
    const active = game.enemies.filter(e => !e.fromBoss).length;
    if (active >= cap) return;

    const p = players[(Math.random() * players.length) | 0];
    const pTileX = Math.floor((p.x + p.w / 2) / TILE);
    const pTileY = Math.floor((p.y + p.h / 2) / TILE);
    const underground = pTileY >= UNDERGROUND_Y;
    const isDay = game.time.isDay;

    // Try several candidate spots; only spawn where the whole hitbox fits.
    for (let attempt = 0; attempt < 8; attempt++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const dist = MIN_SPAWN_DIST + ((Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST)) | 0);
      const sx = Math.max(3, Math.min(game.world.width - 4, pTileX + side * dist));

      let biome, footTy;
      if (underground) {
        biome = game.world.biomeAt(sx, pTileY);
        footTy = this._findFloorNear(game, sx, pTileY);
        if (footTy == null) continue;
      } else {
        biome = game.world.biomeAt(sx, 0);
        footTy = game.world.surfaceY(sx); // first solid tile (ground)
      }

      const pool = [];
      for (const key in ENEMIES) {
        const d = ENEMIES[key];
        if (!d.biomes.includes(biome)) continue;
        if (d.time === 'night' && isDay) continue;
        pool.push(key);
      }
      if (!pool.length) continue;
      const key = pool[(Math.random() * pool.length) | 0];
      const def = ENEMIES[key];

      // Position so the enemy's feet rest on the floor tile.
      const x = sx * TILE, y = footTy * TILE - def.h;
      if (!this._fits(game, x, y, def, players)) continue;
      game.spawnEnemy(key, x, y);
      return;
    }
  }

  // The entire hitbox must be clear of solids, standing on ground, a safe
  // distance from every player, and not overlapping any player.
  _fits(game, x, y, def, players) {
    const box = { x, y, w: def.w, h: def.h };
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

  // Find a floor tile near ty at column tx where an enemy can stand (air above a
  // solid). Returns the solid floor tile's y, or null.
  _findFloorNear(game, tx, ty) {
    const w = game.world;
    for (let dy = 0; dy < 14; dy++) {
      for (const yy of dy === 0 ? [ty] : [ty - dy, ty + dy]) {
        if (yy <= 2 || yy >= w.height - 2) continue;
        // yy is a solid floor with two air tiles above it.
        if (w.isSolidAt(tx, yy) && !w.isSolidAt(tx, yy - 1) && !w.isSolidAt(tx, yy - 2)) return yy;
      }
    }
    return null;
  }
}
