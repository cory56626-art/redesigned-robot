// Summoner Realms — shared tile collision. Per-axis swept AABB against the grid.
import { TILE, GRAVITY, MAX_FALL } from '../config.js?v=realms-qor-41';

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

  // Vertical
  e.y += e.vy * dt;
  if (world.rectHitsSolid(e.x, e.y, e.w, e.h)) {
    if (e.vy > 0) { e.y = Math.floor((e.y + e.h) / TILE) * TILE - e.h - 0.01; e.onGround = true; }
    else if (e.vy < 0) { e.y = (Math.floor(e.y / TILE) + 1) * TILE + 0.01; }
    e.vy = 0;
  }
}

export function applyGravity(e, dt) {
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
