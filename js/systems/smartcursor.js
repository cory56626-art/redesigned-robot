// Summoner Realms — Smart Cursor.
//
// Terraria's smart cursor stops you pixel-hunting: instead of using whatever
// tile the pointer happens to be over, the game picks the most useful tile in
// that direction. Weapons and throwables keep free aim, because there the
// pointer *is* the intent.
//
// It matters even more on mobile, where the aim stick can't pick out one tile
// among many — and it fixes a real problem there: with the stick untouched, the
// aim point sits close to the player, so mining would target the tile you are
// standing in.
//
// The 4.1 rewrite changed the fundamental approach. The old version scored a
// 9x9 neighbourhood around the raw pointer by distance and alignment and took
// the best — which is why it felt like it "locks onto whatever": a tile behind
// you could win on distance, and dragging along a wall produced a different
// answer every frame as the scores shuffled.
//
// What it does now, matching how Terraria actually behaves:
//
//   Mining  — if the tile under the cursor is minable, use it. Otherwise walk
//             outward *along the ray from the player to the cursor* and take
//             the first minable tile. Ray-first, not radius-first. That is the
//             whole difference: the target is always in the direction you are
//             pointing, so you can steer a tunnel.
//
//   Placing — while the button is held, remember where the last block went and
//             extend that run. Dragging along a row or column fills it in
//             straight and gapless instead of wandering.
//
//   Torches — the darkest reachable spot that has something to sit on, biased
//             ahead of the player, so walking into a dark cave and holding
//             place lights the way forward rather than where you came from.
import { REACH, TILE } from '../config.js?v=snowy-taiga-npc-1';
import { T, tileDef } from '../world/tiles.js?v=snowy-taiga-npc-1';
import { canPlaceAt } from './combat.js?v=snowy-taiga-npc-1';

// How far along the aim ray to search, in half-tile steps. Bounded by reach.
const RAY_STEPS = REACH * 3;
// Fallback neighbourhood radius, used only when the ray finds nothing.
const FALLBACK = 3;

/**
 * Resolve the tile the player should actually act on.
 *
 * @returns {{tx:number, ty:number}|null} null means "no smart target — use the
 *          raw pointer position", which is the correct answer for weapons and
 *          when nothing suitable is in range.
 */
export function smartTarget(game, player, item) {
  if (!item) return null;
  const mode = game.settings ? game.settings.smartCursor : 'off';
  if (mode === 'off') return null;
  if (mode === 'hold' && !game.input.smartHeld) return null;

  const s = game.input.state;
  const pc = player.center();
  const rawTx = Math.floor(s.aimX / TILE), rawTy = Math.floor(s.aimY / TILE);

  if (item.category === 'tool') {
    if (item.tool && item.tool.kind === 'hammer') return findHammerable(game, player, pc, s);
    return findMinable(game, player, item, pc, s, rawTx, rawTy);
  }
  if (item.place != null) {
    if (tileDef(item.place).light) return findLightSpot(game, player, item, rawTx, rawTy);
    return findPlacement(game, player, item, pc, s, rawTx, rawTy);
  }
  return null;
}

function withinReach(player, tx, ty) {
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const dx = tx + 0.5 - pcx, dy = ty + 0.5 - pcy;
  return dx * dx + dy * dy <= REACH * REACH;
}

/**
 * Walk the ray from the player toward the cursor, calling `test` on each tile
 * it crosses, and return the first tile the test accepts.
 *
 * Stepped in half-tile increments and de-duplicated, so it visits every tile
 * the line passes through without visiting any twice.
 */
function alongRay(game, player, pc, aimX, aimY, test) {
  const dx = aimX - pc.x, dy = aimY - pc.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;
  const ux = dx / len, uy = dy / len;
  let lastTx = -1, lastTy = -1;

  for (let i = 0; i <= RAY_STEPS; i++) {
    const d = i * (TILE * 0.5);
    const tx = Math.floor((pc.x + ux * d) / TILE);
    const ty = Math.floor((pc.y + uy * d) / TILE);
    if (tx === lastTx && ty === lastTy) continue;
    lastTx = tx; lastTy = ty;
    if (!game.world.inBounds(tx, ty)) break;
    if (!withinReach(player, tx, ty)) break;
    if (test(tx, ty)) return { tx, ty };
  }
  return null;
}

// Small spiral around a tile, nearest first. Used only when the ray comes up
// empty, so the cursor still does something sensible rather than nothing.
function nearestAround(game, player, cx, cy, test) {
  for (let r = 0; r <= FALLBACK; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (!game.world.inBounds(tx, ty)) continue;
        if (!withinReach(player, tx, ty)) continue;
        if (test(tx, ty)) return { tx, ty };
      }
    }
  }
  return null;
}

// Pickaxe/axe: the first tile along the aim ray that this tool can work on.
function findMinable(game, player, item, pc, s, rawTx, rawTy) {
  const world = game.world;
  const kind = item.tool && item.tool.kind;

  const rightTool = (tx, ty) => {
    const id = world.get(tx, ty);
    if (id === T.AIR) return false;
    const def = tileDef(id);
    if (!def.hardness) return false;
    return !def.toolType || def.toolType === kind;
  };
  const anyMinable = (tx, ty) => {
    const id = world.get(tx, ty);
    if (id === T.AIR) return false;
    return !!tileDef(id).hardness;
  };

  // The tile actually under the cursor wins outright if this tool suits it —
  // the player pointed at it, and second-guessing that is what made the old
  // cursor feel like it had a mind of its own.
  if (withinReach(player, rawTx, rawTy) && rightTool(rawTx, rawTy)) return { tx: rawTx, ty: rawTy };

  // Otherwise the first suitable tile along the ray, then the first minable
  // tile of any kind (so a pickaxe can still clear a vine that is in the way).
  return alongRay(game, player, pc, s.aimX, s.aimY, rightTool)
    || alongRay(game, player, pc, s.aimX, s.aimY, anyMinable)
    || nearestAround(game, player, rawTx, rawTy, rightTool);
}

// Hammers work on solid blocks, or on a background wall where there is no block.
function findHammerable(game, player, pc, s) {
  const world = game.world;
  const rawTx = Math.floor(s.aimX / TILE), rawTy = Math.floor(s.aimY / TILE);
  const solid = (tx, ty) => world.isSolidAt(tx, ty);
  if (withinReach(player, rawTx, rawTy) && solid(rawTx, rawTy)) return { tx: rawTx, ty: rawTy };
  return alongRay(game, player, pc, s.aimX, s.aimY, solid)
    || nearestAround(game, player, rawTx, rawTy, (tx, ty) => world.hasWallAt(tx, ty));
}

/**
 * Blocks: continue the run you are already building.
 *
 * While the place button is held, `game.smartRun` remembers the last tile that
 * was placed. The next target is the next tile along the dominant axis toward
 * the cursor, so dragging a floor or a wall lays a straight, gapless line —
 * the single most useful thing smart placement does, and the thing the old
 * scored-neighbourhood version could not do at all.
 */
function findPlacement(game, player, item, pc, s, rawTx, rawTy) {
  const world = game.world;
  const legal = (tx, ty) => world.get(tx, ty) === T.AIR && canPlaceAt(game, player, tx, ty, item).ok;

  const run = game.smartRun;
  const holding = s.primaryHeld || s.placeHeld;
  if (run && holding && run.item === item.id) {
    const dx = rawTx - run.tx, dy = rawTy - run.ty;
    if (dx !== 0 || dy !== 0) {
      // Lock to the dominant axis, so a slightly-off drag still lays straight.
      const stepX = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
      const stepY = stepX === 0 ? Math.sign(dy) : 0;
      const nx = run.tx + stepX, ny = run.ty + stepY;
      if (withinReach(player, nx, ny) && legal(nx, ny)) return { tx: nx, ty: ny };
    }
    // Cursor hasn't moved off the last block yet: hold position rather than
    // jumping elsewhere and leaving a gap.
    if (legal(run.tx, run.ty)) return { tx: run.tx, ty: run.ty };
  }

  // Not continuing a run: the cursor tile if it is legal, else the first legal
  // tile along the ray, else the nearest legal tile.
  if (withinReach(player, rawTx, rawTy) && legal(rawTx, rawTy)) return { tx: rawTx, ty: rawTy };
  return alongRay(game, player, pc, s.aimX, s.aimY, legal)
    || nearestAround(game, player, rawTx, rawTy, legal);
}

// Torches: the darkest reachable spot with something behind or beside it.
function findLightSpot(game, player, item, rawTx, rawTy) {
  const world = game.world;
  const pcx = (player.x + player.w / 2) / TILE;
  const facing = player.facing || 1;

  let best = null, bestScore = Infinity;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const tx = rawTx + dx, ty = rawTy + dy;
      if (!world.inBounds(tx, ty) || !withinReach(player, tx, ty)) continue;
      if (world.get(tx, ty) !== T.AIR) continue;
      if (!canPlaceAt(game, player, tx, ty, item).ok) continue;
      const floor = world.isSolidAt(tx, ty + 1);
      const wall = world.isSolidAt(tx - 1, ty) || world.isSolidAt(tx + 1, ty);
      if (!floor && !wall) continue;      // torches want something to sit on
      // Don't stack torches on top of each other.
      let crowded = false;
      for (let ddy = -2; ddy <= 2 && !crowded; ddy++) {
        for (let ddx = -2; ddx <= 2; ddx++) {
          if (world.get(tx + ddx, ty + ddy) === T.TORCH) { crowded = true; break; }
        }
      }
      if (crowded) continue;
      const d = Math.hypot(dx, dy);
      const ahead = Math.sign(tx + 0.5 - pcx) === facing ? -1.2 : 0;
      const score = d - (world.hasWallAt(tx, ty) ? 1.5 : 0) - (floor ? 0.8 : 0) + ahead;
      if (score < bestScore) { bestScore = score; best = { tx, ty }; }
    }
  }
  return best;
}
