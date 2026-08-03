// Summoner Realms — explosions.
//
// A blast does four things: it removes tiles and walls it is strong enough to
// break, it damages every creature in radius with falloff (including the player
// who threw it), it throws debris, and it shakes the screen.
//
// Tile destruction is gated on each tile's `blastResist` — dirt and sand go up
// with anything, stone needs a bomb, high-tier ore is immune — so explosives are
// a tool for shaping the world without becoming a way to strip-mine the endgame.
import { TILE } from '../config.js?v=prehardmode-weapons-1';
import { T, tileDef, blastResist } from '../world/tiles.js?v=prehardmode-weapons-1';
import { wallBlastResist } from '../world/walls.js?v=prehardmode-weapons-1';
import { W } from '../world/walls.js?v=prehardmode-weapons-1';

/**
 * Detonate at world pixel (x, y).
 *
 *   power     blast strength; compared against tile/wall blastResist
 *   radius    destruction radius in tiles
 *   damage    peak damage at the centre, falling off to zero at the edge
 *   hurtRadius damage radius in tiles (defaults to radius + 1)
 *   owner     the player who set it off, for friendly-fire attribution
 *   breakTiles set false for a purely cosmetic bang
 */
export function explode(game, x, y, opts = {}) {
  const power = opts.power != null ? opts.power : 1;
  const radius = opts.radius != null ? opts.radius : 3;
  const damage = opts.damage != null ? opts.damage : 40;
  const hurtR = (opts.hurtRadius != null ? opts.hurtRadius : radius + 1) * TILE;
  const breakTiles = opts.breakTiles !== false;

  game.audio?.explosion?.();
  game.fx.explosion(x, y, radius * TILE, {
    hot: opts.hot,
    debris: opts.debris,
    shake: 4 + radius * 1.6,
  });

  if (breakTiles && (game.isHost || !game.net)) {
    carve(game, x, y, radius, power);
  }

  damageEntities(game, x, y, hurtR, damage, opts.owner);
  return true;
}

// Remove everything in radius the blast is strong enough to break. Tiles are
// removed without dropping items — that is the trade for the convenience.
function carve(game, x, y, radius, power) {
  const world = game.world;
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  const r2 = radius * radius;
  for (let ty = cy - radius; ty <= cy + radius; ty++) {
    for (let tx = cx - radius; tx <= cx + radius; tx++) {
      const dx = tx - cx, dy = ty - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (!world.inBounds(tx, ty)) continue;
      // Ragged edge: tiles near the rim survive more often than the core.
      const edge = d2 / r2;
      if (edge > 0.55 && Math.random() < (edge - 0.55) * 1.6) continue;

      const id = world.get(tx, ty);
      if (id !== T.AIR && blastResist(id) <= power) {
        const def = tileDef(id);
        world.set(tx, ty, T.AIR);
        game.netEditTile(tx, ty, T.AIR);
        if (def.color && Math.random() < 0.3) {
          game.fx.burst(tx * TILE + 8, ty * TILE + 8, def.color, 2, { speed: 120, gravity: 460, life: 0.6 });
        }
      }
      // Walls go too, but only nearer the centre — a blast scours the face of a
      // cave rather than punching a clean hole through the background.
      if (edge < 0.6) {
        const wid = world.getWall(tx, ty);
        if (wid !== W.NONE && wallBlastResist(wid) <= power) {
          world.setWall(tx, ty, W.NONE);
          game.netEditWall(tx, ty, W.NONE);
        }
      }
    }
  }
  game.markDirty();
}

// Linear falloff from the centre. Everything in range is hit, including the
// thrower — standing next to your own dynamite is supposed to hurt.
function damageEntities(game, x, y, hurtR, damage, owner) {
  const hit = (e, dmg, kbx) => {
    if (e.takeDamage) {
      if (game.bosses.includes(e)) game.hurtBoss(e, dmg, owner, false);
      else game.hurtEnemy(e, dmg, kbx, -2, null, owner, false);
    }
  };

  for (const e of game.enemies) {
    const d = Math.hypot(e.x + e.w / 2 - x, e.y + e.h / 2 - y);
    if (d > hurtR) continue;
    const k = 1 - d / hurtR;
    hit(e, damage * k, Math.sign(e.x + e.w / 2 - x) * 8 * k);
  }
  for (const b of game.bosses) {
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d > hurtR) continue;
    game.hurtBoss(b, damage * (1 - d / hurtR), owner, false);
  }
  for (const p of game.players.values()) {
    if (!p.alive || !p.isLocal) continue;
    const d = Math.hypot(p.x + p.w / 2 - x, p.y + p.h / 2 - y);
    if (d > hurtR) continue;
    const k = 1 - d / hurtR;
    // Self-damage is reduced so a well-placed bomb isn't instant suicide, but it
    // is never zero.
    p.takeDamage(Math.max(1, damage * k * 0.45), Math.sign(p.x + p.w / 2 - x) * 90 * k, game, 'explosion');
  }
}
