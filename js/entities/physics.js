// Summoner Realms — shared tile collision. Per-axis swept AABB against the grid.
//
// Collision is shape-aware (see world/shapes.js): half-blocks and the four
// hammer slopes present a real surface, so a ramp you can see is a ramp you can
// walk up rather than a wall you bump into. Full blocks — everything natural
// terrain generates — take the same fast path they always did.
import { TILE, GRAVITY, MAX_FALL, SWIM_GRAVITY, SWIM_MAX_FALL } from '../config.js?v=hivewrought-1';
import { SH } from '../world/shapes.js?v=hivewrought-1';

// Slopes are climbed by snapping to their surface rather than by the ledge
// step-up, so the motion is continuous instead of a stair of 2px hops.
const SLOPE_SNAP = TILE + 2;

export function moveAndCollide(e, world, dt) {
  const wasGrounded = e.onGround;
  e.onGround = false;

  // Horizontal
  e.x += e.vx * dt;
  if (world.rectHitsSolid(e.x, e.y, e.w, e.h)) {
    // Auto step-up: entities with a `stepHeight` (the player) automatically
    // climb ledges up to that many pixels tall while walking on the ground, so
    // ordinary 1-tile terrain bumps never jam horizontal movement. Without this
    // the player gets stuck on every natural terrace and movement feels broken.
    const step = e.stepHeight || 0;
    let stepped = false;
    if (step > 0 && e.vx !== 0 && wasGrounded) {
      for (let lift = 1; lift <= step; lift += 1) {
        if (!world.rectHitsSolid(e.x, e.y - lift, e.w, e.h)) { e.y -= lift; stepped = true; break; }
      }
    }
    if (stepped) {
      e.hitWallX = false;
      e.onGround = true; // stay grounded so we keep stepping up a staircase
    } else {
      if (e.vx > 0) e.x = Math.floor((e.x + e.w) / TILE) * TILE - e.w - 0.01;
      else if (e.vx < 0) e.x = (Math.floor(e.x / TILE) + 1) * TILE + 0.01;
      e.vx = 0;
      e.hitWallX = true;
    }
  } else e.hitWallX = false;

  // Vertical
  e.y += e.vy * dt;
  if (world.rectHitsSolid(e.x, e.y, e.w, e.h)) {
    if (e.vy > 0) { e.y = _restOnFloor(e, world); e.onGround = true; }
    else if (e.vy < 0) { e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01; }
    e.vy = 0;
  } else if (e.vy >= 0) {
    // Walking down a slope: without this the entity leaves the ramp on every
    // step and falls the rest of the way, which reads as juddering.
    const snapped = _snapDownToSlope(e, world, wasGrounded);
    if (snapped != null) { e.y = snapped; e.onGround = true; e.vy = 0; }
  }
}

// Highest walkable surface under the entity's feet, in world pixels, expressed
// as the y its top edge should sit at. Falls back to the tile grid line when
// every candidate tile is a plain full block.
function _restOnFloor(e, world) {
  const feetY = e.y + e.h;
  const ty = Math.floor(feetY / TILE);
  const tx0 = Math.floor(e.x / TILE), tx1 = Math.floor((e.x + e.w - 0.001) / TILE);
  let best = null;
  for (let tx = tx0; tx <= tx1; tx++) {
    // The entity's contact point with this column is whichever of its edges
    // actually overlaps the column.
    const contactX = Math.min(Math.max(e.x + e.w / 2, tx * TILE), (tx + 1) * TILE);
    for (const cand of [ty, ty + 1]) {
      const sy = world.surfaceYAt(tx, cand, contactX);
      if (sy == null) continue;
      if (sy + 0.01 < e.y) continue;          // above us: that's a ceiling, not a floor
      if (best == null || sy < best) best = sy;
    }
  }
  if (best == null) return Math.floor(feetY / TILE) * TILE - e.h - 0.01;
  return best - e.h - 0.01;
}

// While grounded and moving, follow a descending *sculpted* surface instead of
// stepping off its edge. Deliberately limited to non-full shapes: natural
// terrain keeps falling off ledges exactly as it always has, and only hammered
// slopes and half-blocks get the smooth descent. Returns the y to sit at, or
// null to keep falling normally.
function _snapDownToSlope(e, world, wasGrounded) {
  if (!wasGrounded || e.vx === 0) return null;
  const feetY = e.y + e.h;
  const tyStart = Math.floor(feetY / TILE);
  const tx0 = Math.floor(e.x / TILE), tx1 = Math.floor((e.x + e.w - 0.001) / TILE);
  let best = null;
  for (let tx = tx0; tx <= tx1; tx++) {
    const contactX = Math.min(Math.max(e.x + e.w / 2, tx * TILE), (tx + 1) * TILE);
    for (let ty = tyStart; ty <= tyStart + 1; ty++) {
      if (world.getShape(tx, ty) === SH.FULL) continue; // natural terrain: don't cling
      const sy = world.surfaceYAt(tx, ty, contactX);
      if (sy == null) continue;
      const drop = sy - feetY;
      if (drop < -0.5 || drop > SLOPE_SNAP) continue;
      if (best == null || sy < best) best = sy;
    }
  }
  if (best == null) return null;
  return best - e.h - 0.01;
}

export function applyGravity(e, dt, submerged) {
  if (submerged) {
    e.vy += GRAVITY * SWIM_GRAVITY * dt;
    if (e.vy > SWIM_MAX_FALL) e.vy = SWIM_MAX_FALL;
    return;
  }
  e.vy += GRAVITY * dt;
  if (e.vy > MAX_FALL) e.vy = MAX_FALL;
}

// Keep an entity inside the world horizontally.
export function clampToWorld(e, world) {
  const maxX = world.width * TILE - e.w;
  const maxY = world.height * TILE - e.h;
  if (e.x < 0) { e.x = 0; e.vx = 0; }
  if (e.x > maxX) { e.x = maxX; e.vx = 0; }
  if (e.y > maxY + 400) { e.y = maxY; } // fell out of world safety
}
