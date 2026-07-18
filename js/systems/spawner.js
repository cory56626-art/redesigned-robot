// Summoner Realms — natural enemy spawning (host only). Biome + day/night aware.
import { TILE, UNDERGROUND_Y, MAX_ENEMIES } from '../config.js';
import { ENEMIES } from '../data/enemies.js';

export class Spawner {
  constructor() { this.timer = 1.5; }

  update(dt, game) {
    if (!game.isHost) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.1;

    const playerCount = [...game.players.values()].filter(p => p.alive).length || 1;
    const cap = Math.min(MAX_ENEMIES, 6 + playerCount * 3);
    const active = game.enemies.filter(e => !e.fromBoss).length;
    if (active >= cap) return;

    const players = [...game.players.values()].filter(p => p.alive);
    if (!players.length) return;
    const p = players[(Math.random() * players.length) | 0];
    const pTileX = Math.floor((p.x + p.w / 2) / TILE);
    const pTileY = Math.floor((p.y + p.h / 2) / TILE);
    const side = Math.random() < 0.5 ? -1 : 1;
    const dist = 22 + ((Math.random() * 8) | 0);
    const sx = Math.max(2, Math.min(game.world.width - 3, pTileX + side * dist));

    const underground = pTileY >= UNDERGROUND_Y;
    const isDay = game.time.isDay;

    let biome, sy;
    if (underground) {
      biome = game.world.biomeAt(sx, pTileY);
      sy = this._findAirNear(game, sx, pTileY);
      if (sy == null) return;
    } else {
      biome = game.world.biomeAt(sx, 0); // forest/corrupt based on x
      sy = game.world.surfaceY(sx) - 1;
      if (game.world.isSolidAt(sx, sy)) return;
    }

    // Build candidate pool.
    const pool = [];
    for (const key in ENEMIES) {
      const d = ENEMIES[key];
      if (!d.biomes.includes(biome)) continue;
      if (d.time === 'night' && isDay) continue;
      pool.push(key);
    }
    if (!pool.length) return;
    // At night on the surface, bias toward night creatures.
    const key = pool[(Math.random() * pool.length) | 0];
    const def = ENEMIES[key];
    game.spawnEnemy(key, sx * TILE, sy * TILE - def.h);
  }

  _findAirNear(game, tx, ty) {
    for (let dy = 0; dy < 12; dy++) {
      for (const yy of [ty - dy, ty + dy]) {
        if (yy > 2 && yy < game.world.height - 2 && !game.world.isSolidAt(tx, yy) && !game.world.isSolidAt(tx, yy + 1) && game.world.isSolidAt(tx, yy + 2)) {
          return yy;
        }
      }
    }
    return null;
  }
}
