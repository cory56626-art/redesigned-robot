// Summoner Realms — smart cursor: Terraria-style forgiving tile targeting.
//
// The goal is how Terraria *feels*, not how it looks: you rarely need pixel
// precision. When the exact tile you point at is already a valid interaction the
// smart cursor leaves it alone (so a careful aim is never overridden), but when
// it isn't — you're pointing at empty air next to a vein, or at a block hidden
// behind terrain — it snaps to the tile you most likely meant.
//
// The one rule the raw cursor never enforced: you can't interact *through* solid
// walls. Every candidate tile must have line-of-sight from the player, so aiming
// at ore behind a stone wall targets the wall in front of it instead of reaching
// through it.
import { TILE, REACH, SMART_SNAP_RADIUS } from '../config.js';
import { T, tileDef, isSolid } from '../world/tiles.js';
import { canPlaceAt } from './combat.js';

function withinReach(player, tx, ty) {
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const dx = tx + 0.5 - pcx, dy = ty + 0.5 - pcy;
  return dx * dx + dy * dy <= REACH * REACH;
}

// True if a clear (solid-free) line runs from the player's eye point (ex,ey, in
// world px) to tile (tx,ty), stopping *at* that tile. The target tile itself is
// allowed to be solid (that's what you're mining); any solid tile encountered
// before it counts as terrain in the way, so this returns false.
export function tileVisible(world, ex, ey, tx, ty) {
  const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
  const dx = cx - ex, dy = cy - ey;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const steps = Math.max(2, Math.ceil(d / (TILE * 0.4)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const stx = Math.floor((ex + dx * t) / TILE);
    const sty = Math.floor((ey + dy * t) / TILE);
    if (stx === tx && sty === ty) return true; // reached the target — path was clear
    if (world.isSolidAt(stx, sty)) return false; // blocked by terrain in front
  }
  return true;
}

// Can a block be reached to be *placed* at air tile (tx,ty) without building
// through a wall? Either the tile itself is visible, or an open (air) face of it
// is — the latter lets you extend bridges/walls outward from a block you're
// standing beside while still refusing to place deep inside untouched terrain.
export function placeReachable(world, ex, ey, tx, ty) {
  if (tileVisible(world, ex, ey, tx, ty)) return true;
  const nbrs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dx, dy] of nbrs) {
    const nx = tx + dx, ny = ty + dy;
    if (!world.isSolidAt(nx, ny) && tileVisible(world, ex, ey, nx, ny)) return true;
  }
  return false;
}

function isMineable(world, tx, ty) {
  const id = world.get(tx, ty);
  if (id === T.AIR) return false;
  const def = tileDef(id);
  return !!def.hardness;
}

// The tile the player is most likely trying to mine. Prefers the exact aim tile
// when it is mineable, in reach and visible; otherwise snaps to the nearest such
// tile around the cursor. Returns {tx,ty} or null when nothing valid is nearby.
export function resolveMineTarget(game, player) {
  const s = game.input.state;
  const world = game.world;
  const eye = player.center();
  const aimTx = Math.floor(s.aimX / TILE), aimTy = Math.floor(s.aimY / TILE);

  const ok = (tx, ty) =>
    withinReach(player, tx, ty) && isMineable(world, tx, ty) &&
    tileVisible(world, eye.x, eye.y, tx, ty);

  if (ok(aimTx, aimTy)) return { tx: aimTx, ty: aimTy };

  // Search outward ring by ring so the closest ring wins, then pick the tile in
  // that ring whose centre is nearest the actual cursor point (predictable).
  for (let r = 1; r <= SMART_SNAP_RADIUS; r++) {
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const tx = aimTx + dx, ty = aimTy + dy;
        if (!ok(tx, ty)) continue;
        const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
        const dd = (cx - s.aimX) ** 2 + (cy - s.aimY) ** 2;
        if (dd < bestD) { bestD = dd; best = { tx, ty }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// Count solid orthogonal neighbours — used to favour building onto existing
// structures rather than floating tiles in open space.
function connectivity(world, tx, ty) {
  let n = 0;
  if (world.isSolidAt(tx - 1, ty)) n++;
  if (world.isSolidAt(tx + 1, ty)) n++;
  if (world.isSolidAt(tx, ty - 1)) n++;
  if (world.isSolidAt(tx, ty + 1)) n++;
  return n;
}

// The tile a placeable block should snap to. Keeps the exact aim tile when it is
// already a legal placement; otherwise scores nearby legal tiles, favouring ones
// that connect to existing blocks and sit close to the cursor. Returns {tx,ty};
// falls back to the raw aim tile (so the caller/ghost shows why it's blocked).
export function resolvePlaceTarget(game, player, sel) {
  const s = game.input.state;
  const world = game.world;
  const aimTx = Math.floor(s.aimX / TILE), aimTy = Math.floor(s.aimY / TILE);

  if (canPlaceAt(game, player, aimTx, aimTy, sel).ok) return { tx: aimTx, ty: aimTy };

  let best = null, bestScore = -Infinity;
  for (let dy = -SMART_SNAP_RADIUS; dy <= SMART_SNAP_RADIUS; dy++) {
    for (let dx = -SMART_SNAP_RADIUS; dx <= SMART_SNAP_RADIUS; dx++) {
      const tx = aimTx + dx, ty = aimTy + dy;
      if (dx === 0 && dy === 0) continue;
      if (!canPlaceAt(game, player, tx, ty, sel).ok) continue;
      const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
      const distTiles = Math.hypot(cx - s.aimX, cy - s.aimY) / TILE;
      // Prefer connected + near the cursor; heavier weight on connectivity so
      // placement "grows" naturally from what's already there.
      const score = connectivity(world, tx, ty) * 3 - distTiles;
      if (score > bestScore) { bestScore = score; best = { tx, ty }; }
    }
  }
  return best || { tx: aimTx, ty: aimTy };
}
