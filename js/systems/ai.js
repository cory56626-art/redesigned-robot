// Summoner Realms — shared AI: perception, navigation and steering.
//
// Enemies previously called game.nearestPlayer() every frame and walked straight
// at the result. That made them omniscient (they always knew exactly where you
// were, through any amount of rock) and blind at the same time (they walked off
// cliffs, ground into walls, and stacked into one pixel).
//
// This module gives them:
//   · perception — an aggro radius, line of sight, and a memory of where the
//     target was last seen, so losing you actually means losing you
//   · navigation — ledge and gap awareness, plus a small breadth-first search
//     over the local tile window when the direct route is blocked
//   · steering  — separation, so a pack spreads out instead of overlapping
//   · aiming    — lead the target rather than firing at where it used to be
import { TILE } from '../config.js?v=vespera-surface-5';

// The BFS only ever looks at a window this size around the enemy. Big enough to
// route around ordinary terrain, small enough to run many times a second.
const PATH_W = 25, PATH_H = 17;
// Re-plan at 5 Hz. Terrain and targets don't change fast enough to need more,
// and this keeps a screen full of enemies cheap.
export const REPLAN_INTERVAL = 0.2;

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

/**
 * Update an entity's awareness of the nearest player.
 *
 * Sets on `e`: aware, target, lastSeen {x,y}, awareTimer.
 * Returns the point the entity should currently be heading for, or null.
 *
 * Awareness is sticky: once alerted, an enemy keeps hunting your last known
 * position for `memory` seconds after losing sight, then gives up. Being hit
 * always alerts, so you can never plink something to death from cover.
 */
export function perceive(e, game, dt, opts = {}) {
  const aggro = (opts.aggroRange || 18) * TILE;
  const lose = (opts.loseRange || 34) * TILE;
  const memory = opts.memory || 4;

  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  // Enemies can aggro a player, any living world NPC, or the living Diamond Heart. Pick
  // the nearest living target so a hostile that reaches either ally actually
  // turns on it instead of remaining locked to the player.
  const candidates = [];
  const npcs = game.npcs || (game.npc ? [game.npc] : []);
  for (const p of game.players.values()) if (p.alive) candidates.push(p);
  for (const npc of npcs) {
    if (npc && npc.alive !== false && !npc.dead) candidates.push(npc);
  }
  for (const m of (game.minions || [])) {
    if (m.alive !== false && !m.dead && m.maxHp != null) candidates.push(m);
  }

  let p = null, nearest = Infinity;
  const playerPriorityRadius = 240;
  let nearestPlayer = null, nearestPlayerDist2 = Infinity;
  let nearestNpc = null, nearestNpcDist2 = Infinity;
  for (const candidate of candidates) {
    if (npcs.includes(candidate)) {
      const cc = candidate.center ? candidate.center() : {
        x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2,
      };
      const d2 = (cc.x - cx) * (cc.x - cx) + (cc.y - cy) * (cc.y - cy);
      if (d2 < nearestNpcDist2) {
        nearestNpcDist2 = d2;
        nearestNpc = candidate;
      }
    } else if (!candidate.isMinion) {
      const cc = candidate.center ? candidate.center() : {
        x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2,
      };
      const d2 = (cc.x - cx) * (cc.x - cx) + (cc.y - cy) * (cc.y - cy);
      if (d2 < nearestPlayerDist2) {
        nearestPlayerDist2 = d2;
        nearestPlayer = candidate;
      }
    }
  }

  // Keep the player as the priority target when they are close enough to be an
  // immediate threat, unless a living NPC is even closer. That makes Nivara
  // genuinely targetable while preserving the normal player-first feel.
  const npcTargetRange = e.aware ? lose : aggro;
  const npcIsCloser = nearestNpc && nearestNpcDist2 < nearestPlayerDist2 &&
    nearestNpcDist2 <= npcTargetRange * npcTargetRange &&
    game.world.hasLineOfSight(cx, cy, nearestNpc.x + nearestNpc.w / 2, nearestNpc.y + nearestNpc.h / 2);
  if (npcIsCloser) {
    p = nearestNpc;
    nearest = nearestNpcDist2;
  } else if (nearestPlayer && nearestPlayerDist2 <= playerPriorityRadius * playerPriorityRadius) {
    p = nearestPlayer;
    nearest = nearestPlayerDist2;
  } else {
    const heart = candidates.find((candidate) =>
      candidate.isMinion && candidate.key === 'diamondHeart'
    );
    if (heart) {
      const hc = heart.center ? heart.center() : {
        x: heart.x + heart.w / 2, y: heart.y + heart.h / 2,
      };
      const hdx = hc.x - cx, hdy = hc.y - cy;
      const hdist2 = hdx * hdx + hdy * hdy;
      const hLos = game.world.hasLineOfSight(cx, cy, hc.x, hc.y);
      const hRange = e.aware ? lose : aggro;
      if (hdist2 <= hRange * hRange && hLos) {
        p = heart;
        nearest = hdist2;
      }
    }
  }

  if (!p) {
    for (const candidate of candidates) {
      const cc = candidate.center ? candidate.center() : {
        x: candidate.x + candidate.w / 2, y: candidate.y + candidate.h / 2,
      };
      const d2 = (cc.x - cx) * (cc.x - cx) + (cc.y - cy) * (cc.y - cy);
      if (d2 < nearest) { nearest = d2; p = candidate; }
    }
  }

  e.target = p || null;
  if (!p) { e.aware = false; e.lastSeen = null; return null; }

  const tc = p.center ? p.center() : { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  const d = Math.hypot(tc.x - cx, tc.y - cy);
  const los = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);

  if (e.awareTimer == null) e.awareTimer = 0;
  if (d <= aggro && los) {
    // In sight and in range: full awareness, memory refreshed.
    e.aware = true;
    e.awareTimer = memory;
    e.lastSeen = { x: tc.x, y: tc.y };
  } else if (e.aware) {
    e.awareTimer -= dt;
    // Losing sight or straying too far starts the clock; running right out of
    // range drops aggro immediately.
    if (e.awareTimer <= 0 || d > lose) { e.aware = false; e.lastSeen = null; }
  }
  return e.aware ? (e.lastSeen || tc) : null;
}

// Something hurt this entity: it knows roughly where the attack came from even
// if it never saw it.
export function alert(e, x, y, memory = 5) {
  e.aware = true;
  e.awareTimer = memory;
  e.lastSeen = { x, y };
}

// Idle wander: amble, pause, turn around at ledges. Returns a move direction.
export function wander(e, game, dt) {
  if (e.wanderTimer == null) { e.wanderTimer = Math.random() * 2; e.wanderDir = 0; }
  e.wanderTimer -= dt;
  if (e.wanderTimer <= 0) {
    e.wanderDir = Math.random() < 0.45 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    e.wanderTimer = 1 + Math.random() * 2.5;
  }
  if (e.wanderDir !== 0 && e.onGround && !safeAhead(e, game.world, e.wanderDir)) {
    e.wanderDir = -e.wanderDir;
  }
  return e.wanderDir;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

// Is there ground to land on if we keep walking this way? Looks a couple of
// tiles ahead and a few tiles down. Used so enemies stop marching off cliffs.
export function safeAhead(e, world, dir, lookDown = 4) {
  const footY = Math.floor((e.y + e.h + 2) / TILE);
  const aheadX = Math.floor((e.x + e.w / 2 + dir * (e.w / 2 + TILE * 0.6)) / TILE);
  for (let dy = 0; dy <= lookDown; dy++) if (world.isSolidAt(aheadX, footY + dy)) return true;
  return false;
}

// Width in tiles of the hole directly ahead, or 0 if the ground continues.
export function gapWidth(e, world, dir, max = 5) {
  const footY = Math.floor((e.y + e.h + 2) / TILE);
  const startX = Math.floor((e.x + e.w / 2) / TILE);
  let n = 0;
  for (let i = 1; i <= max; i++) {
    const tx = startX + dir * i;
    let grounded = false;
    for (let dy = 0; dy <= 3; dy++) if (world.isSolidAt(tx, footY + dy)) { grounded = true; break; }
    if (grounded) return n;
    n++;
  }
  return n;
}

// Should this entity jump right now to keep making progress? True when a
// climbable ledge blocks it, or a crossable gap is directly ahead.
export function shouldJump(e, world, dir) {
  if (!e.onGround) return false;
  const headTy = Math.floor((e.y - 2) / TILE);
  const midTy = Math.floor((e.y + e.h / 2) / TILE);
  const footTy = Math.floor((e.y + e.h - 2) / TILE);
  const aheadTx = Math.floor((e.x + e.w / 2 + dir * (e.w / 2 + 3)) / TILE);

  // A ledge one or two tiles tall with clear air above it.
  const blockedLow = world.isSolidAt(aheadTx, footTy) || world.isSolidAt(aheadTx, midTy);
  const clearAbove = !world.isSolidAt(aheadTx, headTy) && !world.isSolidAt(aheadTx, headTy - 1);
  const headroom = !world.isSolidAt(Math.floor((e.x + e.w / 2) / TILE), headTy - 1);
  if (blockedLow && clearAbove && headroom) return true;

  // A gap narrow enough to clear in one jump.
  const gap = gapWidth(e, world, dir);
  if (gap > 0 && gap <= 3) return true;
  return false;
}

/**
 * Plan a route around terrain with a breadth-first search over the local tile
 * window, treating a tile as walkable if it has floor beneath and headroom
 * above. Returns the direction to move (-1, 0, 1), or null if no route exists —
 * in which case the caller should fall back to heading straight at the target.
 *
 * This is deliberately small and cheap: it is a "get me around this wall"
 * helper, not a global pathfinder.
 */
export function planDirection(e, world, tx, ty) {
  const sx = Math.floor((e.x + e.w / 2) / TILE);
  const sy = Math.floor((e.y + e.h - 1) / TILE);
  const gx = Math.floor(tx / TILE), gy = Math.floor(ty / TILE);

  const x0 = sx - (PATH_W >> 1), y0 = sy - (PATH_H >> 1);
  const inWin = (x, y) => x >= x0 && y >= y0 && x < x0 + PATH_W && y < y0 + PATH_H;
  if (!inWin(gx, gy)) {
    // Target is outside the window: aim at the window edge nearest to it.
    return Math.sign(gx - sx) || 0;
  }

  const idx = (x, y) => (y - y0) * PATH_W + (x - x0);
  const walkable = (x, y) => {
    if (world.isSolidAt(x, y) || world.isSolidAt(x, y - 1)) return false; // needs headroom
    // Standable: floor directly below, or within two tiles (a short drop).
    return world.isSolidAt(x, y + 1) || world.isSolidAt(x, y + 2);
  };

  const prev = new Int32Array(PATH_W * PATH_H).fill(-1);
  const seen = new Uint8Array(PATH_W * PATH_H);
  const queue = [idx(sx, sy)];
  seen[idx(sx, sy)] = 1;
  let found = -1;
  // Steps allow one tile of climb or two of drop, matching what the entity can
  // physically do with a jump and a fall.
  const moves = [[1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1], [1, 2], [-1, 2]];

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cy2 = ((cur / PATH_W) | 0) + y0;
    const cx2 = (cur % PATH_W) + x0;
    if (cx2 === gx && Math.abs(cy2 - gy) <= 1) { found = cur; break; }
    for (const [dx, dy] of moves) {
      const nx = cx2 + dx, ny = cy2 + dy;
      if (!inWin(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      if (!walkable(nx, ny)) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (found < 0) return null;

  // Walk the chain back to the first step out of the start tile.
  let node = found, parent = prev[node];
  if (parent < 0) return 0;
  while (prev[parent] >= 0) { node = parent; parent = prev[parent]; }
  const stepX = (node % PATH_W) + x0;
  return Math.sign(stepX - sx) || 0;
}

// ---------------------------------------------------------------------------
// Steering & aiming
// ---------------------------------------------------------------------------

// Push apart from nearby same-type entities so a group spreads into a line
// instead of collapsing into one overlapping blob.
export function separation(e, others, radius = 22) {
  let push = 0, n = 0;
  for (const o of others) {
    if (o === e || o.dead) continue;
    const dx = (e.x + e.w / 2) - (o.x + o.w / 2);
    const dy = (e.y + e.h / 2) - (o.y + o.h / 2);
    if (Math.abs(dy) > radius) continue;
    const d = Math.abs(dx);
    if (d > radius) continue;
    push += (dx === 0 ? (Math.random() - 0.5) : Math.sign(dx)) * (1 - d / radius);
    n++;
    if (n >= 6) break; // enough of a sample; don't scan a whole swarm
  }
  return n ? push / n : 0;
}

// Aim where the target is going to be, not where it is. Solves the intercept
// approximately by iterating twice, which is plenty at projectile speeds.
export function leadShot(fromX, fromY, target, speed) {
  const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
  const vx = target.vx || 0, vy = target.vy || 0;
  let t = Math.hypot(tx - fromX, ty - fromY) / Math.max(1, speed);
  for (let i = 0; i < 2; i++) {
    const px = tx + vx * t, py = ty + vy * t;
    t = Math.hypot(px - fromX, py - fromY) / Math.max(1, speed);
  }
  return Math.atan2((ty + vy * t) - fromY, (tx + vx * t) - fromX);
}

// Steer a flying entity toward a point while avoiding terrain: probe a few
// headings around the direct one and take the first that is clear.
export function flySteer(e, world, tx, ty, speed) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  const direct = Math.atan2(ty - cy, tx - cx);
  const probe = Math.max(e.w, e.h) + TILE * 1.5;
  const clear = (a) => {
    const px = cx + Math.cos(a) * probe, py = cy + Math.sin(a) * probe;
    return !world.rectHitsSolid(px - e.w / 2, py - e.h / 2, e.w, e.h);
  };
  if (clear(direct)) return { vx: Math.cos(direct) * speed, vy: Math.sin(direct) * speed };
  // Fan outward, alternating sides, and take the first clear heading.
  for (let i = 1; i <= 6; i++) {
    const off = i * 0.42;
    for (const a of [direct - off, direct + off]) {
      if (clear(a)) return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
    }
  }
  // Fully boxed in: rise, which is almost always the way out of a pocket.
  return { vx: 0, vy: -speed * 0.6 };
}
