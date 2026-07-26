// Summoner Realms — shared tile collision. Per-axis swept AABB against the grid.
import { TILE, GRAVITY, MAX_FALL } from '../config.js?v=realms-qor-46';

// How far an entity is lifted to walk onto a hammered slope or half block.
// A full tile, so even a 45-degree slope is climbed regardless of `stepHeight`
// — the whole point of a slope is that everything walks up it.
const SHAPE_STEP = TILE;
// And how far it is allowed to be pulled back down onto shaped ground when
// walking *off* a slope, so descending glides instead of hopping.
const SLOPE_GLIDE = 12;

export function moveAndCollide(e, world, dt) {
  const wasGrounded = e.onGround;
  e.onGround = false;

  // Horizontal. Platforms are never solid sideways, so no opts here: you walk
  // straight through the edge of a walkway rather than bumping into it.
  e.x += e.vx * dt;
  if (world.rectHitsSolid(e.x, e.y, e.w, e.h)) {
    // Auto step-up: entities with a `stepHeight` (the player) automatically
    // climb ledges up to that many pixels tall while walking on the ground, so
    // ordinary 1-tile terrain bumps never jam horizontal movement. Without this
    // the player gets stuck on every natural terrace and movement feels broken.
    let step = e.stepHeight || 0;
    if (world.boxTouchesShaped(e.x, e.y, e.w, e.h)) step = Math.max(step, SHAPE_STEP);
    let stepped = false;
    if (step > 0 && e.vx !== 0 && wasGrounded) {
      for (let lift = 2; lift <= step; lift += 2) {
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

  // Vertical. `prevBottom` is where the feet were before the move, which is
  // what lets a platform catch a fall without also catching a jump from below.
  const prevBottom = e.y + e.h;
  e.y += e.vy * dt;
  const opts = (e.vy > 0 && !e.dropThrough)
    ? { platformsSolid: true, prevBottom }
    : undefined;
  if (world.rectHitsSolid(e.x, e.y, e.w, e.h, opts)) {
    if (e.vy > 0) {
      const surf = world.landingSurfaceY(e.x, e.y, e.w, e.h, opts);
      e.y = (surf != null ? surf : Math.floor((e.y + e.h) / TILE) * TILE) - e.h - 0.01;
      e.onGround = true;
    } else if (e.vy < 0) {
      const ceil = world.ceilingSurfaceY(e.x, e.y, e.w, e.h);
      e.y = (ceil != null ? ceil : (Math.floor(e.y / TILE) + 1) * TILE) + 0.01;
    }
    e.vy = 0;
  } else if (!e.onGround && wasGrounded && e.vy >= 0 && !e.dropThrough) {
    // Walking downhill: nothing is under the feet any more, but if shaped
    // ground is within a few pixels, settle onto it instead of stepping off
    // into a little airborne hop every tile. Ordinary ledges are left alone —
    // only slopes and half blocks pull you back down.
    const probe = { platformsSolid: true, prevBottom: e.y + e.h };
    for (let d = 1; d <= SLOPE_GLIDE; d++) {
      if (!world.rectHitsSolid(e.x, e.y + d, e.w, e.h, probe)) continue;
      if (world.boxTouchesShaped(e.x, e.y + d, e.w, e.h)) {
        const surf = world.landingSurfaceY(e.x, e.y + d, e.w, e.h, probe);
        if (surf != null) { e.y = surf - e.h - 0.01; e.onGround = true; e.vy = 0; }
      }
      break;
    }
  }
}

export function applyGravity(e, dt) {
  e.vy += GRAVITY * dt;
  if (e.vy > MAX_FALL) e.vy = MAX_FALL;
}

// Water is still — there is no flow simulation. What it does is change how you
// move through it: you sink slowly instead of falling, drag bleeds off speed,
// and holding jump swims upward. No drowning; a pool is an obstacle and a
// fishing spot, not a death trap.
export const SWIM_GRAVITY = 0.28;   // fraction of normal gravity while submerged
export const SWIM_DRAG = 3.4;       // per-second velocity damping
export const SWIM_MAX_SINK = 90;    // terminal sink speed
export const SWIM_RISE = -150;      // upward velocity from a swim stroke

// True when the entity's midpoint sits in liquid.
export function inLiquid(e, world) {
  return world.isLiquidAt(
    Math.floor((e.x + e.w / 2) / TILE),
    Math.floor((e.y + e.h * 0.55) / TILE),
  );
}

export function applyLiquidPhysics(e, dt) {
  e.vy += GRAVITY * SWIM_GRAVITY * dt;
  const drag = Math.max(0, 1 - SWIM_DRAG * dt);
  e.vx *= drag;
  e.vy *= drag;
  if (e.vy > SWIM_MAX_SINK) e.vy = SWIM_MAX_SINK;
}

// Keep an entity inside the world horizontally.
export function clampToWorld(e, world) {
  const maxX = world.width * TILE - e.w;
  const maxY = world.height * TILE - e.h;
  if (e.x < 0) { e.x = 0; e.vx = 0; }
  if (e.x > maxX) { e.x = maxX; e.vx = 0; }
  if (e.y > maxY + 400) { e.y = maxY; } // fell out of world safety
}
