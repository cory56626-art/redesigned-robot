// Summoner Realms — Smart Cursor.
//
// Terraria's smart cursor stops you pixel-hunting: instead of using whatever
// tile the pointer happens to be over, the game picks the most useful tile in
// that direction. Holding a pickaxe targets the nearest tile actually worth
// mining; holding a block snaps to the nearest legal placement that completes
// what you're building; holding a torch finds a wall-backed spot that needs
// light. Weapons and throwables keep free aim, because there the pointer *is*
// the intent.
//
// It matters even more on mobile, where the aim stick can't pick out one tile
// among many — and it fixes a real bug there: with the stick untouched, the aim
// point sits exactly on the player, so mining used to target the tile you are
// standing in.
import { REACH, TILE } from '../config.js?v=realms-qor-45';
import { T, tileDef } from '../world/tiles.js?v=realms-qor-45';
import { canPlaceAt } from './combat.js?v=realms-qor-45';

// Search radius around the raw aim point, in tiles.
const SEARCH = 4;

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
  const dirX = s.aimX - pc.x, dirY = s.aimY - pc.y;

  if (item.category === 'tool') return findMinable(game, player, item, rawTx, rawTy, dirX, dirY);
  if (item.place != null) {
    if (tileDef(item.place).light) return findLightSpot(game, player, item, rawTx, rawTy);
    return findPlacement(game, player, item, rawTx, rawTy, dirX, dirY);
  }
  return null;
}

function withinReach(player, tx, ty) {
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const dx = tx + 0.5 - pcx, dy = ty + 0.5 - pcy;
  return dx * dx + dy * dy <= REACH * REACH;
}

// Ranked search over the neighbourhood of the raw aim point. `score` returns a
// number (lower is better) or null to reject the candidate.
function best(game, player, cx, cy, score) {
  let bestTile = null, bestScore = Infinity;
  for (let dy = -SEARCH; dy <= SEARCH; dy++) {
    for (let dx = -SEARCH; dx <= SEARCH; dx++) {
      const tx = cx + dx, ty = cy + dy;
      if (!game.world.inBounds(tx, ty)) continue;
      if (!withinReach(player, tx, ty)) continue;
      const v = score(tx, ty, Math.hypot(dx, dy));
      if (v == null) continue;
      if (v < bestScore) { bestScore = v; bestTile = { tx, ty }; }
    }
  }
  return bestTile;
}

// Pickaxe/axe. Terraria's smart cursor is tool-dependent, and that is most of
// what makes it feel smart rather than arbitrary: an axe targets the *base* of
// the tree nearest the cursor, and a pickaxe digs a walkable passage in the
// direction you are pointing. The old version blended distance, tool match and
// aim alignment into one score across a +/-4 box, so a tile well off your aim
// could still win on the distance term — which is what read as "it just locks
// onto whatever".
function findMinable(game, player, item, rawTx, rawTy, dirX, dirY) {
  const world = game.world;
  const kind = item.tool && item.tool.kind;
  if (kind === 'axe') {
    const trunk = findTreeBase(game, player, rawTx, rawTy);
    if (trunk) return trunk;
  }
  const tunnel = findTunnelTile(game, player, item, rawTx, rawTy);
  if (tunnel) return tunnel;

  // Nothing in the way along the aim line: fall back to the nearest tile this
  // tool actually works on.
  return best(game, player, rawTx, rawTy, (tx, ty, d) => {
    const id = world.get(tx, ty);
    if (id === T.AIR) return null;
    const def = tileDef(id);
    if (!def.hardness) return null;
    // Strongly prefer tiles this tool is meant for, but never refuse outright —
    // a pickaxe should still be able to clear a vine that's in the way.
    const rightTool = !def.toolType || def.toolType === kind;
    return d + (rightTool ? 0 : 8);
  });
}

// The base of the tree nearest the cursor. When the true base is out of range
// this keeps the lowest trunk tile that is still reachable, matching Terraria's
// "targets branches when the base is out of range".
function findTreeBase(game, player, rawTx, rawTy) {
  const world = game.world;
  const isTrunk = (tx, ty) => {
    const d = tileDef(world.get(tx, ty));
    return !!(d && d.tree);
  };
  const found = best(game, player, rawTx, rawTy, (tx, ty, d) => (isTrunk(tx, ty) ? d : null));
  if (!found) return null;
  let tx = found.tx, ty = found.ty;
  let lowest = { tx, ty };
  for (let i = 0; i < 24; i++) {
    // Corruption trunks lean, so follow the column down diagonally too.
    let nx = null;
    for (const dx of [0, -1, 1]) if (isTrunk(tx + dx, ty + 1)) { nx = tx + dx; break; }
    if (nx == null) break;
    tx = nx; ty += 1;
    if (withinReach(player, tx, ty)) lowest = { tx, ty };
  }
  return lowest;
}

// March from the player toward the aim point and return the first tile in the
// way — a passage goes where you point it. Because the passage has to be
// walkable, a solid tile at head height is taken before the one at foot
// height, otherwise you carve a slot you cannot actually walk into.
function findTunnelTile(game, player, item, rawTx, rawTy) {
  const world = game.world;
  const kind = item.tool && item.tool.kind;
  const minable = (tx, ty) => {
    if (!world.inBounds(tx, ty)) return false;
    const id = world.get(tx, ty);
    if (id === T.AIR) return false;
    const def = tileDef(id);
    if (!def.hardness) return false;
    if (kind === 'pickaxe' && def.tree) return false; // trees are the axe's job
    return true;
  };

  const pc = player.center();
  const fromX = pc.x / TILE, fromY = pc.y / TILE;
  const dx = (rawTx + 0.5) - fromX, dy = (rawTy + 0.5) - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return null;
  const ux = dx / dist, uy = dy / dist;

  const limit = Math.min(dist, REACH);
  let lastTx = -1, lastTy = -1;
  for (let t = 0.4; t <= limit; t += 0.4) {
    const tx = Math.floor(fromX + ux * t);
    const ty = Math.floor(fromY + uy * t);
    if (tx === lastTx && ty === lastTy) continue;
    lastTx = tx; lastTy = ty;
    if (!world.inBounds(tx, ty)) break;
    if (!withinReach(player, tx, ty)) break;
    if (!minable(tx, ty)) continue;
    // Clear headroom first on a roughly horizontal dig.
    if (Math.abs(uy) < 0.7 && minable(tx, ty - 1) && withinReach(player, tx, ty - 1)) {
      return { tx, ty: ty - 1 };
    }
    return { tx, ty };
  }
  return null;
}

// Blocks: the nearest legal placement, biased toward extending what is already
// there, so dragging along a wall fills it in instead of leaving gaps.
function findPlacement(game, player, item, rawTx, rawTy, dirX, dirY) {
  const world = game.world;
  return best(game, player, rawTx, rawTy, (tx, ty, d) => {
    if (world.get(tx, ty) !== T.AIR) return null;
    if (!canPlaceAt(game, player, tx, ty, item).ok) return null;
    // Count solid neighbours: more support means a more "obvious" placement.
    let support = 0;
    if (world.isSolidAt(tx - 1, ty)) support++;
    if (world.isSolidAt(tx + 1, ty)) support++;
    if (world.isSolidAt(tx, ty - 1)) support++;
    if (world.isSolidAt(tx, ty + 1)) support++;
    return d - support * 0.6;
  });
}

// Torches: the darkest reachable spot with something behind or beside it, which
// is where a torch is actually useful.
function findLightSpot(game, player, item, rawTx, rawTy) {
  const world = game.world;
  return best(game, player, rawTx, rawTy, (tx, ty, d) => {
    if (world.get(tx, ty) !== T.AIR) return null;
    if (!canPlaceAt(game, player, tx, ty, item).ok) return null;
    const backed = world.hasWallAt(tx, ty);
    const floor = world.isSolidAt(tx, ty + 1);
    const wall = world.isSolidAt(tx - 1, ty) || world.isSolidAt(tx + 1, ty);
    if (!floor && !wall) return null;      // torches want something to sit on
    // Don't stack torches on top of each other.
    for (let ddy = -2; ddy <= 2; ddy++) {
      for (let ddx = -2; ddx <= 2; ddx++) {
        if (world.get(tx + ddx, ty + ddy) === T.TORCH) return null;
      }
    }
    return d - (backed ? 1.5 : 0) - (floor ? 0.8 : 0);
  });
}
