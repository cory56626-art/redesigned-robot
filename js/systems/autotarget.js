// Summoner Realms — auto-target / lock-on (client-side aiming aid).
//
// Modelled on Terraria's console/mobile lock-on: a single "current target" that
// weapons auto-aim toward. Two ways to acquire it — press the target button (a
// hard lock you can cycle through enemies with), or simply aim near an enemy
// while facing it (a soft lock). Either way the nearest *valid* enemy becomes the
// target, and four rotating arrows mark it (see renderer).
//
// Two hard rules keep it from ever fighting the player:
//   1. It only bends a shot when you're already aiming roughly at the target
//      (a wide cone for a deliberate hard lock, a narrow one for a soft lock).
//      Aim clearly elsewhere and the shot goes exactly where you point.
//   2. It never targets through terrain — a target must have line of sight, and
//      no weapon here can actually fire through solid tiles, so summons (which
//      have their own AI) are ignored entirely.
import {
  TILE, TARGET_RANGE, TARGET_CURSOR_TILES, TARGET_SOFT_CONE, TARGET_HARD_CONE,
} from '../config.js';
import { dist2, angleTo } from '../utils.js';

const RANGE_PX = TARGET_RANGE * TILE;

function center(t) { return { x: t.x + t.w / 2, y: t.y + t.h / 2 }; }

// Smallest absolute angle between two headings (0..PI).
function angDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// A weapon whose aim the lock-on should assist (never summons; they auto-fight).
function benefits(item) {
  return !!item && item.category === 'weapon' &&
    (item.weaponClass === 'melee' || item.weaponClass === 'ranged' || item.weaponClass === 'mage');
}

// Still a live, targetable entity this frame?
function isAlive(game, t) {
  if (!t || t.dead) return false;
  return game.enemies.includes(t) || game.bosses.includes(t);
}

function hasLOS(game, px, py, t) {
  const c = center(t);
  return game.world.hasLineOfSight(px, py, c.x, c.y);
}

// Nearest valid target with line of sight, within range. opts.exclude skips one
// (for cycling); opts.nearCursor also requires the cursor to be near the enemy
// and the player to face its general direction (the soft-lock trigger).
function acquireNearest(game, player, opts = {}) {
  const pc = player.center();
  const s = game.input.state;
  let best = null, bestD = Infinity;
  const consider = (t) => {
    if (t === opts.exclude || t.dead) return;
    const c = center(t);
    const d = dist2(pc.x, pc.y, c.x, c.y);
    if (d > RANGE_PX * RANGE_PX || d >= bestD) return;
    if (!hasLOS(game, pc.x, pc.y, t)) return;
    if (opts.nearCursor) {
      const pad = TARGET_CURSOR_TILES * TILE;
      if (s.aimX < t.x - pad || s.aimX > t.x + t.w + pad ||
          s.aimY < t.y - pad || s.aimY > t.y + t.h + pad) return;
      const dx = c.x - pc.x;
      if (Math.abs(dx) > TILE && Math.sign(dx) !== player.facing) return; // not facing it
    }
    bestD = d; best = t;
  };
  for (const e of game.enemies) consider(e);
  for (const b of game.bosses) consider(b);
  return best;
}

// Maintain the local player's lock each tick (client-side). Call only for the
// local player while it can act.
export function updateAutoTarget(game, player, dt) {
  const s = game.input.state;
  const pc = player.center();
  const sel = player.inventory.selectedItem();

  // --- Explicit button: hard-lock the nearest, or cycle to the next target. ---
  if (s.autoTargetPressed) {
    const next = (player.targetHard && player.targetEnemy)
      ? (acquireNearest(game, player, { exclude: player.targetEnemy }) || player.targetEnemy)
      : acquireNearest(game, player, {});
    if (next) {
      player.targetEnemy = next; player.targetHard = true;
      player._targetLostT = 0; player._targetIdleT = 0; player._targetLOS = true;
      game.floatText(next.x + next.w / 2, next.y - 6, 'Locked', '#ffd23f');
    } else {
      player.targetEnemy = null; player.targetHard = false;
      game.toast('No target in range', 'info');
    }
  }

  // Throttle scans/LOS to ~10 Hz — cheap even with a full screen of enemies.
  player._targetScanCd = (player._targetScanCd || 0) - dt;
  const doScan = player._targetScanCd <= 0;
  if (doScan) player._targetScanCd = 0.1;

  // --- Validate / maintain the current target. ---
  let t = player.targetEnemy;
  if (t) {
    if (!isAlive(game, t)) {
      player.targetEnemy = null; player.targetHard = false; t = null;
    } else {
      const c = center(t);
      const inRange = dist2(pc.x, pc.y, c.x, c.y) <= RANGE_PX * RANGE_PX;
      if (doScan) player._targetLOS = hasLOS(game, pc.x, pc.y, t);
      if (!inRange) {
        player._targetLostT = (player._targetLostT || 0) + dt;
        if (player._targetLostT > (player.targetHard ? 0.8 : 0.2)) {
          player.targetEnemy = null; player.targetHard = false; t = null;
        }
      } else if (!player._targetLOS) {
        // Lost sight: hold briefly (walks behind a pillar), then switch smoothly
        // to whatever is now visible, or drop if there's nothing.
        player._targetLostT = (player._targetLostT || 0) + dt;
        if (player._targetLostT > (player.targetHard ? 1.2 : 0.4)) {
          const re = acquireNearest(game, player, {});
          if (re) { player.targetEnemy = re; player._targetLostT = 0; player._targetLOS = true; }
          else if (!player.targetHard) { player.targetEnemy = null; t = null; }
        }
      } else {
        player._targetLostT = 0;
      }
    }
  }

  // --- Soft lock: point near an enemy (facing it) to target it; hovering a
  // different enemy switches. Only while holding a weapon that aims. ---
  if (doScan && !player.targetHard && benefits(sel)) {
    const soft = acquireNearest(game, player, { nearCursor: true });
    if (soft && soft !== player.targetEnemy) {
      player.targetEnemy = soft; player.targetHard = false;
      player._targetLOS = true; player._targetIdleT = 0;
    } else if (soft) {
      player._targetIdleT = 0;
    }
  }

  // A soft target you stop aiming at (cursor pointing well away) fades out so the
  // reticle never lingers on something you've moved on from.
  if (player.targetEnemy && !player.targetHard) {
    const c = center(player.targetEnemy);
    const off = angDiff(angleTo(pc.x, pc.y, s.aimX, s.aimY), angleTo(pc.x, pc.y, c.x, c.y));
    player._targetIdleT = off > TARGET_SOFT_CONE * 1.6 ? (player._targetIdleT || 0) + dt : 0;
    if (player._targetIdleT > 2.5) player.targetEnemy = null;
  }
}

// Where a weapon should actually aim: the locked target (when you're pointing
// roughly at it and it's visible) or the raw cursor. Never redirects summons.
export function effectiveAim(game, player, item, ox, oy) {
  const s = game.input.state;
  const raw = { x: s.aimX, y: s.aimY };
  if (!benefits(item)) return raw;
  const t = player.targetEnemy;
  if (!t || !isAlive(game, t) || !player._targetLOS) return raw;
  const c = center(t);
  const cone = player.targetHard ? TARGET_HARD_CONE : TARGET_SOFT_CONE;
  if (angDiff(angleTo(ox, oy, s.aimX, s.aimY), angleTo(ox, oy, c.x, c.y)) <= cone) {
    return { x: c.x, y: c.y };
  }
  return raw; // aiming clearly elsewhere — respect the player's manual aim
}

// The entity the reticle should mark, or null.
export function currentTarget(game, player) {
  const t = player && player.targetEnemy;
  return t && isAlive(game, t) ? t : null;
}

// Drop any lock (death, respawn, world reset).
export function clearTarget(player) {
  player.targetEnemy = null;
  player.targetHard = false;
  player._targetLostT = 0;
  player._targetIdleT = 0;
  player._targetLOS = false;
}
