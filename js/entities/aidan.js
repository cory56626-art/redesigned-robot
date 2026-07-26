// Summoner Realms — Aidan summon controller and pixel-tech presentation.
// Aidan is intentionally kept in its own module: his multi-stage portal and
// railgun states are too specific to safely squeeze into the generic minion AI.
import { TILE } from '../config.js?v=aidan-summon-8';
import { Projectile } from './projectile.js?v=aidan-summon-8';

const TAU = Math.PI * 2;
const PORTAL_BLUE = '#2e9cff';
const PORTAL_CYAN = '#8feaff';
const PORTAL_GOLD = '#ffd05a';
const RAIL_PURPLE = '#c46cff';
const RAIL_CORE = '#f1c4ff';
const RADIOACTIVE = '#baff6b';

function centerOf(entity) {
  return entity.center ? entity.center() : {
    x: entity.x + entity.w / 2,
    y: entity.y + entity.h / 2,
  };
}

function aliveTarget(target) {
  return !!target && !target.dead && target.alive !== false &&
    target.hp != null && target.hp > 0;
}

function trackedTarget(game, target) {
  return !!target &&
    ((game.enemies || []).includes(target) || (game.bosses || []).includes(target));
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function approachAngle(from, to, amount) {
  let delta = (to - from + Math.PI) % TAU - Math.PI;
  if (delta < -Math.PI) delta += TAU;
  return from + clamp(delta, -amount, amount);
}

function nearestTarget(game, x, y, range) {
  let best = null;
  let bestD = range * range;
  const consider = (target) => {
    if (!aliveTarget(target)) return;
    const c = centerOf(target);
    const dx = c.x - x, dy = c.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = target; }
  };
  for (const e of game.enemies || []) consider(e);
  for (const b of game.bosses || []) consider(b);
  return best;
}

function syncGroundPose(m) {
  const speed = Math.max(1, m.def.speed || 180);
  m.moveAmount = clamp(Math.abs(m.vx) / speed, 0, 1);
  if (!m.poseTimer && !m.portalState &&
      m.pose !== 'railgunCharge' && m.pose !== 'railgunFire') {
    m.pose = m.moveAmount > 0.05 ? 'move' : 'idle';
  }
}

function pathDirection(m, game, tx, ty) {
  const world = game.world;
  const c = centerOf(m);
  if ((m.replanTimer || 0) <= 0) {
    m.replanTimer = AI.REPLAN_INTERVAL;
    const direct = world.hasLineOfSight(c.x, c.y, tx, ty);
    m.plannedDir = direct
      ? Math.sign(tx - c.x)
      : (AI.planDirection(m, world, tx, ty) ?? Math.sign(tx - c.x));
  }
  return m.plannedDir || Math.sign(tx - c.x) || m.facing || 1;
}

function walkAidanTo(m, game, tx, ty, dt, stopDistance = 8) {
  const world = game.world;
  const c = centerOf(m);
  let dir = 0;
  if (Math.abs(tx - c.x) > stopDistance) {
    dir = pathDirection(m, game, tx, ty);
    if (m.onGround && dir && !AI.safeAhead(m, world, dir) && ty - c.y < 40) {
      const gap = AI.gapWidth(m, world, dir);
      if (gap > 3) dir = 0;
    }
    if (m.onGround && dir && AI.shouldJump(m, world, dir) && (m.jumpCd || 0) <= 0) {
      m.vy = -300;
      m.jumpCd = 0.55;
    }
  } else {
    m.plannedDir = 0;
  }

  const speed = m.def.speed || 180;
  m.vx = dir * speed;
  applyGravity(m, dt);
  moveAndCollide(m, world, dt);
  clampToWorld(m, world);
  m.walkCycle = (m.walkCycle || 0) + Math.abs(m.vx) * dt * 0.055;
  syncGroundPose(m);
}

function walkAidanToRange(m, game, target, desired, dt) {
  const tc = centerOf(target);
  const c = centerOf(m);
  let side = Math.sign(c.x - tc.x);
  if (!side) side = m.facing < 0 ? -1 : 1;
  walkAidanTo(m, game, tc.x + side * desired, tc.y, dt, 8);
}

function settleAidan(m, game, dt) {
  m.vx = 0;
  applyGravity(m, dt);
  moveAndCollide(m, game.world, dt);
  clampToWorld(m, game.world);
  syncGroundPose(m);
}

function groundedCenterY(game, target, x, m) {
  const world = game.world;
  const tx = Math.max(0, Math.min(world.width - 1, Math.floor(x / TILE)));
  const targetBottom = target.y + target.h;
  const start = Math.max(0, Math.floor(targetBottom / TILE) - 2);
  const end = Math.min(world.height - 2, start + 18);
  for (let ty = start; ty <= end; ty++) {
    if (!world.isSolidAt(tx, ty) || !world.isSolidAt(tx, ty + 1)) continue;
    const top = (ty + 1) * TILE - m.h - 0.01;
    if (!world.rectHitsSolid(x - m.w / 2, top, m.w, m.h)) {
      return top + m.h / 2;
    }
  }
  return targetBottom - m.h / 2;
}

function clearShotEnd(game, sx, sy, angle, maxDistance) {
  const step = Math.max(6, TILE * 0.5);
  const start = 18;
  for (let d = start; d <= maxDistance; d += step) {
    const x = sx + Math.cos(angle) * d;
    const y = sy + Math.sin(angle) * d;
    if (game.world.isSolidAt(Math.floor(x / TILE), Math.floor(y / TILE))) {
      const safe = Math.max(start, d - step);
      return { x: sx + Math.cos(angle) * safe, y: sy + Math.sin(angle) * safe };
    }
  }
  return {
    x: sx + Math.cos(angle) * maxDistance,
    y: sy + Math.sin(angle) * maxDistance,
  };
}

function beamHits(game, sx, sy, ex, ey) {
  const vx = ex - sx, vy = ey - sy;
  const len2 = vx * vx + vy * vy;
  const hits = [];
  const consider = (target) => {
    if (!aliveTarget(target)) return;
    const tc = centerOf(target);
    const along = clamp(((tc.x - sx) * vx + (tc.y - sy) * vy) / Math.max(len2, 1), 0, 1);
    const px = sx + vx * along, py = sy + vy * along;
    const radius = Math.max(15, Math.max(target.w || 16, target.h || 16) * 0.58);
    if (Math.hypot(tc.x - px, tc.y - py) <= radius) hits.push(target);
  };
  for (const e of game.enemies || []) consider(e);
  for (const b of game.bosses || []) consider(b);
  return hits;
}

function tickRadioactive(m, game, dt) {
  if (!m.radioactiveTargets) return;
  for (const [target, state] of m.radioactiveTargets) {
    if (!aliveTarget(target) || !trackedTarget(game, target)) {
      m.radioactiveTargets.delete(target);
      continue;
    }
    state.remaining -= dt;
    state.nextTick -= dt;
    while (state.nextTick <= 0 && state.remaining > 0) {
      state.nextTick += m.def.radioTick || 0.5;
      game.hurtEnemyOrBoss(target, m.def.radioDamage || 5, 0, m.ownerId, false);
      const tc = centerOf(target);
      game.fx?.trail(tc.x + (Math.random() - 0.5) * 12, tc.y + (Math.random() - 0.5) * 12,
        RADIOACTIVE, { size: 2, life: 0.24, drift: 10 });
    }
    if (state.remaining <= 0) m.radioactiveTargets.delete(target);
  }
}

function applyRadioactive(m, game, target) {
  if (!aliveTarget(target)) return;
  m.radioactiveTargets.set(target, {
    remaining: m.def.radioDuration || 20,
    nextTick: m.def.radioTick || 0.5,
  });
  const tc = centerOf(target);
  game.floatText?.(tc.x, target.y - 7, 'RADIOACTIVE', RADIOACTIVE);
  game.fx?.ring(tc.x, tc.y, RADIOACTIVE, Math.max(target.w, target.h) * 0.8, {
    life: 0.45, width: 2,
  });
  game.fx?.burst(tc.x, tc.y, [RADIOACTIVE, '#e7ffb8', RAIL_PURPLE], 10, {
    speed: 90, life: 0.38, gravity: -20, glow: true, size: 2,
  });
}

function fireRailgun(m, game, owner) {
  const c = centerOf(m);
  const angle = m.railgunAngle || 0;
  const origin = {
    x: c.x + Math.cos(angle) * 17,
    y: c.y + Math.sin(angle) * 17,
  };
  const end = clearShotEnd(game, origin.x, origin.y, angle, m.def.railgunRange || 1500);
  m.railgunOrigin = origin;
  m.railgunBeamEnd = end;
  m.railgunActive = 0.38;
  m.railgunWindup = 0;
  m.railgunTarget = null;
  m.railgunCooldown = m.def.railgunCooldown || 14;
  m.pose = 'railgunFire';
  m.poseTimer = 0.30;
  m.recoil = 1;

  const damage = (m.def.railgunDamage || 75) *
    ((owner.stats && owner.stats.summonMul) || 1);
  const hits = beamHits(game, origin.x, origin.y, end.x, end.y);
  for (const target of hits) {
    game.hurtEnemyOrBoss(target, damage, Math.sign(Math.cos(angle)) * 3, m.ownerId, false);
    applyRadioactive(m, game, target);
  }

  game.fx?.flash(origin.x, origin.y, 1, 0.34);
  game.fx?.flash(end.x, end.y, 0.85, 0.26);
  game.fx?.streak(origin.x, origin.y, angle, RAIL_CORE, 18, {
    speed: 420, spread: 0.18, life: 0.28, size: 2.5, glow: true,
  });
  game.fx?.ring(origin.x, origin.y, RAIL_PURPLE, 38, { life: 0.28, width: 3 });
  game.fx?.ring(end.x, end.y, RAIL_CORE, 20, { life: 0.18, width: 2 });
  game.fx?.shake(5, 0.34);
}

function updateRailgun(m, game, owner, dt) {
  const target = aliveTarget(m.railgunTarget) ? m.railgunTarget : null;
  const c = centerOf(m);
  if (target) {
    const tc = centerOf(target);
    const desired = Math.atan2(tc.y - c.y, tc.x - c.x);
    // Aidan tracks deliberately, but only slightly behind the target: readable
    // counterplay without making the five-second charge miss by default.
    m.railgunAngle = approachAngle(m.railgunAngle || desired, desired, dt * 3.4);
    m.facing = Math.cos(m.railgunAngle) < 0 ? -1 : 1;
  }
  m.railgunWindup -= dt;
  m.railgunProgress = 1 - clamp(m.railgunWindup / (m.def.railgunCharge || 5), 0, 1);
  const origin = {
    x: c.x + Math.cos(m.railgunAngle || 0) * 17,
    y: c.y + Math.sin(m.railgunAngle || 0) * 17,
  };
  m.railgunOrigin = origin;
  m.railgunBeamEnd = clearShotEnd(game, origin.x, origin.y, m.railgunAngle || 0,
    m.def.railgunRange || 1500);
  settleAidan(m, game, dt);
  m.moveAmount = 0;
  m.pose = 'railgunCharge';
  if (m.railgunWindup <= 0) fireRailgun(m, game, owner);
}

function beginPortal(m, game, target) {
  const c = centerOf(m);
  const tc = centerOf(target);
  const angle = Math.atan2(tc.y - c.y, tc.x - c.x);
  const horizontal = Math.sign(tc.x - c.x) || m.facing || 1;
  const source = {
    x: c.x + horizontal * (m.def.portalSourceDistance || TILE * 4),
    y: c.y,
  };
  const side = tc.x >= c.x ? -1 : 1;
  const exitDistance = m.def.portalExitDistance || TILE * 5;
  const exit = {
    x: tc.x + side * exitDistance,
    y: groundedCenterY(game, target, tc.x + side * exitDistance, m),
  };
  m.portalState = {
    time: 0,
    start: { x: m.x, y: m.y },
    source,
    exit,
    side,
    target,
    entered: false,
    exited: false,
  };
  m.portalGunAngle = angle;
  m.facing = Math.cos(angle) < 0 ? -1 : 1;
  m.vx = 0; m.vy = 0;
  m.moveAmount = 0;
  m.pose = 'portalAim';
  m.poseTimer = 0;
  game.fx?.ring(source.x, source.y, PORTAL_BLUE, 30, { life: 0.34, width: 2 });
  game.fx?.burst(source.x, source.y, [PORTAL_BLUE, PORTAL_CYAN, PORTAL_GOLD], 12, {
    speed: 95, life: 0.45, gravity: -15, glow: true, size: 2,
  });
}

function updatePortal(m, game, dt) {
  const ps = m.portalState;
  if (!ps) return;
  ps.time += dt;
  const target = aliveTarget(ps.target) ? ps.target : null;
  if (target && ps.time < 0.58) {
    const tc = centerOf(target);
    ps.exit.x = tc.x + ps.side * (m.def.portalExitDistance || TILE * 5);
    ps.exit.y = groundedCenterY(game, target, ps.exit.x, m);
  }

  // 0.00–0.32: the armored summon visibly moves into the portal it fired.
  if (ps.time < 0.32) {
    m.pose = 'portalStep';
    m.moveAmount = 1;
    const q = clamp(ps.time / 0.32, 0, 1);
    m.x = ps.start.x + (ps.source.x - m.w / 2 - ps.start.x) * q;
    m.y = ps.start.y + (ps.source.y - m.h / 2 - ps.start.y) * q;
    m.hidden = false;
    m.vx = 0; m.vy = 0;
    if (ps.time > 0.10) {
      game.fx?.trail(ps.source.x, ps.source.y, PORTAL_CYAN, { size: 2, life: 0.18, drift: 12 });
    }
    return;
  }

  if (!ps.entered) {
    ps.entered = true;
    m.pose = 'portalTravel';
    m.hidden = true;
    game.fx?.burst(ps.source.x, ps.source.y, [PORTAL_BLUE, PORTAL_GOLD], 20, {
      speed: 150, life: 0.5, gravity: -10, glow: true, size: 2,
    });
  }

  // 0.32–0.60: both portals stay open while the travel is readable.
  if (ps.time < 0.60) {
    m.vx = 0; m.vy = 0;
    return;
  }

  if (!ps.exited) {
    ps.exited = true;
    m.pose = 'portalExit';
    m.poseTimer = 0.34;
    m.x = ps.exit.x - m.w / 2;
    m.y = ps.exit.y - m.h / 2;
    m.hidden = false;
    m.facing = target ? (centerOf(target).x < centerOf(m).x ? -1 : 1) : m.facing;
    game.fx?.burst(ps.exit.x, ps.exit.y, [PORTAL_CYAN, PORTAL_GOLD, '#ffffff'], 24, {
      speed: 170, life: 0.58, gravity: -18, glow: true, size: 2.5,
    });
    game.fx?.ring(ps.exit.x, ps.exit.y, PORTAL_CYAN, 42, { life: 0.38, width: 3 });
  }

  // 0.60–0.98: hold the exact five-tile exit distance while the
  // armored summon finishes its landing/recoil animation.
  if (ps.time < 0.98) {
    m.pose = 'portalExit';
    m.x = ps.exit.x - m.w / 2;
    m.y = ps.exit.y - m.h / 2;
    m.vx = 0; m.vy = 0;
    m.onGround = true;
    m.recoil = 1;
    return;
  }

  m.hidden = false;
  m.portalState = null;
  m.pose = 'idle';
  m.poseTimer = 0;
  m.moveAmount = 0;
  m.portalCooldown = m.def.portalCooldown || 2.2;
  m.targetScanCd = 0;
}

function fireBasicPulse(m, game, owner, target) {
  const c = centerOf(m), tc = centerOf(target);
  const angle = Math.atan2(tc.y - c.y, tc.x - c.x);
  const damage = (m.def.basicDamage || 26) *
    ((owner.stats && owner.stats.summonMul) || 1);
  game.addProjectile(new Projectile({
    x: c.x + Math.cos(angle) * 14,
    y: c.y + Math.sin(angle) * 14,
    vx: Math.cos(angle) * (m.def.basicSpeed || 720),
    vy: Math.sin(angle) * (m.def.basicSpeed || 720),
    w: 9, h: 9, damage, ownerType: 'minion', ownerId: m.ownerId,
    kind: 'aidanPulse', color: PORTAL_CYAN, life: 2.4,
    knockback: 3, trail: PORTAL_BLUE,
  }), true);
  m.basicCooldown = m.def.basicRate || 1.05;
  m.attackPulse = 0.2;
  m.pose = 'pulse';
  m.poseTimer = 0.24;
  m.pulseAngle = angle;
  m.recoil = 1;
  game.fx?.streak(c.x + Math.cos(angle) * 12, c.y + Math.sin(angle) * 12,
    angle, PORTAL_CYAN, 8, { speed: 240, spread: 0.32, life: 0.16, size: 2, glow: true });
}

function updateAidan(m, game, owner, ownerCenter, dt) {
  const d = m.def;
  m.portalCooldown = Math.max(0, (m.portalCooldown || 0) - dt);
  m.poseTimer = Math.max(0, (m.poseTimer || 0) - dt);
  m.recoil = Math.max(0, (m.recoil || 0) - dt * 7);
  if (m.poseTimer <= 0 && (m.pose === 'pulse' || m.pose === 'railgunFire' || m.pose === 'portalExit')) m.pose = 'idle';
  m.railgunCooldown = Math.max(0, (m.railgunCooldown || 0) - dt);
  m.basicCooldown = Math.max(0, (m.basicCooldown || 0) - dt);
  m.jumpCd = Math.max(0, (m.jumpCd || 0) - dt);
  m.replanTimer = Math.max(0, (m.replanTimer || 0) - dt);
  m.railgunActive = Math.max(0, (m.railgunActive || 0) - dt);
  m.targetScanCd = Math.max(0, (m.targetScanCd || 0) - dt);
  tickRadioactive(m, game, dt);

  if (m.portalState) { updatePortal(m, game, dt); return; }
  if (m.railgunWindup > 0) { updateRailgun(m, game, owner, dt); return; }

  const c = centerOf(m);
  if (!trackedTarget(game, m.target) || !aliveTarget(m.target) || m.targetScanCd <= 0) {
    m.target = nearestTarget(game, c.x, c.y, d.range || 1500);
    m.targetScanCd = 0.22;
  }
  const target = m.target;
  if (!target) {
    walkAidanTo(m, game, ownerCenter.x + owner.facing * -48, ownerCenter.y, dt, 8);
    return;
  }

  const tc = centerOf(target);
  const distance = Math.hypot(tc.x - c.x, tc.y - c.y);
  m.facing = tc.x < c.x ? -1 : 1;

  // Portal Pursuit is a movement tool, never an offensive hitbox. It always
  // fires the source portal four tiles away, then exits beside the target.
  if (distance > (d.portalTrigger || TILE * 20) && m.portalCooldown <= 0) {
    beginPortal(m, game, target);
    return;
  }

  const los = game.world.hasLineOfSight(c.x, c.y, tc.x, tc.y);
  if (m.railgunCooldown <= 0 && distance >= (d.railgunMinRange || TILE * 12) && los) {
    m.railgunTarget = target;
    m.railgunAngle = Math.atan2(tc.y - c.y, tc.x - c.x);
    m.railgunWindup = d.railgunCharge || 5;
    m.railgunProgress = 0;
    m.vx = 0; m.vy = 0;
    game.fx?.ring(c.x, c.y, RAIL_PURPLE, 34, { life: d.railgunCharge || 5, from: 48, width: 2 });
    game.fx?.burst(c.x + Math.cos(m.railgunAngle) * 12, c.y + Math.sin(m.railgunAngle) * 12,
      RAIL_PURPLE, 7, { speed: 55, life: 0.6, gravity: -20, glow: true, size: 2 });
    return;
  }

  walkAidanToRange(m, game, target, Math.max(128, Math.min(176, (d.basicRange || 352) * 0.5)), dt);
  if (los && distance <= (d.basicRange || TILE * 22) && m.basicCooldown <= 0) {
    fireBasicPulse(m, game, owner, target);
  }
}

export function initAidanState(m) {
  m.portalState = null;
  m.portalCooldown = 0;
  m.portalGunAngle = 0;
  m.railgunCooldown = 1.2;
  m.railgunWindup = 0;
  m.railgunProgress = 0;
  m.railgunActive = 0;
  m.railgunAngle = 0;
  m.railgunOrigin = null;
  m.railgunBeamEnd = null;
  m.railgunTarget = null;
  m.basicCooldown = 0.35;
  m.pose = 'idle';
  m.poseTimer = 0;
  m.moveAmount = 0;
  m.recoil = 0;
  m.pulseAngle = 0;
  m.onGround = false;
  m.stepHeight = TILE + 2;
  m.jumpCd = 0;
  m.replanTimer = 0;
  m.plannedDir = 0;
  m.pathTargetX = null;
  m.pathTargetY = null;
  m.walkCycle = 0;
  m.radioactiveTargets = new Map();
  m.hidden = false;
}

export function updateAidanState(m, game, owner, ownerCenter, dt) {
  updateAidan(m, game, owner, ownerCenter, dt);
}

function ellipse(ctx, x, y, rx, ry, color, alpha = 1, width = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPortal(ctx, portal, time, scale = 1) {
  if (!portal) return;
  const pulse = 1 + Math.sin(time * 11) * 0.06;
  ctx.save();
  ctx.translate(portal.x, portal.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.17;
  ctx.fillStyle = PORTAL_BLUE;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16 * scale * pulse, 28 * scale * pulse, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ellipse(ctx, 0, 0, 14 * scale * pulse, 27 * scale, PORTAL_BLUE, 0.9, 3);
  ellipse(ctx, 0, 0, 9 * scale, 22 * scale, PORTAL_CYAN, 0.9, 2);
  ellipse(ctx, 0, 0, 4 * scale, 17 * scale, PORTAL_GOLD, 0.75, 1.2);
  ctx.strokeStyle = PORTAL_GOLD;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.82;
  for (let i = 0; i < 4; i++) {
    const a = time * 4 + i * Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 15 * scale, Math.sin(a) * 23 * scale);
    ctx.lineTo(Math.cos(a + 0.16) * 20 * scale, Math.sin(a + 0.16) * 30 * scale);
    ctx.stroke();
  }
  ctx.restore();
}


function drawAidanLeg(ctx, x, y, stride, lift = 0) {
  ctx.save();
  ctx.translate(x + stride * 0.6, y - lift);
  ctx.rotate(stride * 0.12);
  ctx.fillStyle = '#4b2d1b';
  ctx.fillRect(-2, 0, 4, 9);
  ctx.fillStyle = '#9d6128';
  ctx.fillRect(-2, 1, 4, 6);
  ctx.fillStyle = '#e1aa3a';
  ctx.fillRect(-2, 2, 3, 2);
  ctx.fillStyle = '#33231d';
  ctx.fillRect(-3, 7, 6, 3);
  ctx.fillStyle = '#d99c32';
  ctx.fillRect(-2, 7, 4, 1);
  ctx.fillStyle = '#f0c44f';
  ctx.fillRect(-3, 4, 1, 2);
  ctx.restore();
}

function drawAidanArm(ctx, x, y, angle, length = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#4b2d1b';
  ctx.fillRect(-2, 0, 4, 7 * length);
  ctx.fillStyle = '#a96729';
  ctx.fillRect(-1, 1, 3, 5 * length);
  ctx.fillStyle = '#e3ad3d';
  ctx.fillRect(-1, 2, 2, 2);
  ctx.translate(0, 7 * length);
  ctx.fillStyle = '#3a271d';
  ctx.fillRect(-2, -1, 5, 4);
  ctx.fillStyle = '#e4ad3d';
  ctx.fillRect(-1, -1, 3, 2);
  ctx.restore();
}

function armorPolygon(ctx, points, fill, stroke = null) {
  if (!points || points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawPortalGun(ctx, angle, recoil = 0) {
  ctx.save();
  ctx.rotate(angle);
  ctx.translate(-recoil * 2.5, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = PORTAL_CYAN;
  ctx.fillRect(0, -4, 24, 8);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#1b2d48';
  ctx.fillRect(0, -3, 20, 6);
  ctx.fillStyle = '#e9b941';
  ctx.fillRect(1, -5, 14, 2);
  ctx.fillRect(14, -6, 7, 12);
  ctx.fillStyle = '#3d89d2';
  ctx.fillRect(4, -2, 11, 2);
  ctx.fillStyle = PORTAL_CYAN;
  ctx.fillRect(17, -2, 5, 4);
  ctx.fillStyle = '#f5cb58';
  ctx.fillRect(21, -4, 3, 8);
  ctx.fillStyle = '#192333';
  ctx.beginPath();
  ctx.moveTo(3, 3); ctx.lineTo(9, 3); ctx.lineTo(12, 12); ctx.lineTo(7, 13); ctx.lineTo(2, 6);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#65c7ff';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(7, 7, 4, 0.2, 2.8); ctx.stroke();
  ctx.restore();
}

function drawRailgun(ctx, angle, charge, recoil = 0) {
  ctx.save();
  ctx.rotate(angle);
  ctx.translate(-recoil * 3, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = RAIL_PURPLE;
  ctx.fillRect(0, -5, 37, 10);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#171928';
  ctx.fillRect(0, -4, 33, 8);
  ctx.fillStyle = '#493b55';
  ctx.fillRect(4, -7, 21, 3);
  ctx.fillStyle = PORTAL_GOLD;
  ctx.fillRect(4, -6, 7, 2);
  ctx.fillStyle = RAIL_PURPLE;
  ctx.fillRect(8, -1, 23, 3);
  ctx.fillStyle = '#efb8ff';
  ctx.fillRect(10, 0, Math.max(2, 20 * charge), 1);
  ctx.fillStyle = '#b68cff';
  ctx.fillRect(25, -6, 8, 3);
  ctx.fillStyle = '#25243a';
  ctx.beginPath();
  ctx.moveTo(8, 4); ctx.lineTo(17, 4); ctx.lineTo(15, 12); ctx.lineTo(8, 10);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PORTAL_GOLD;
  ctx.fillRect(30, -4, 4, 2);
  ctx.restore();
}

function localAimAngle(face, worldAngle) {
  const raw = face > 0 ? worldAngle : Math.PI - worldAngle;
  return Math.atan2(Math.sin(raw), Math.cos(raw));
}

export function drawAidan(ctx, m) {
  if (!m || m.dead || m.hidden) return;

  // The hitbox is deliberately player-sized (12x26). Weapons may extend beyond
  // it, just like a player holding a large tool, but the armored body does not.
  const x = m.x, y = m.y, w = m.w || 12, h = m.h || 26;
  const cx = x + w / 2, cy = y + h / 2;
  const t = m.anim || 0;
  const face = m.facing < 0 ? -1 : 1;
  const pose = m.pose || ((m.moveAmount || 0) > 0.08 ? 'move' : 'idle');
  const grounded = m.onGround !== false;
  const moving = grounded && (m.moveAmount || 0) > 0.06 &&
    pose !== 'railgunCharge' && pose !== 'railgunFire';
  const walkPhase = m.walkCycle != null ? m.walkCycle : t * 2.35;
  const gait = Math.sin(walkPhase);
  const stride = moving ? gait * 3.0 : Math.sin(t * 1.8) * 0.16;
  const lift = moving ? Math.max(0, gait) * 1.25 : 0;
  const otherLift = moving ? Math.max(0, -gait) * 1.25 : 0;
  const walkBob = moving ? Math.abs(gait) * 0.48 : 0;
  const breathing = Math.sin(t * 2.25) * 0.22;
  const chargeCrouch = pose === 'railgunCharge' ? 0.9 + Math.sin(t * 13) * 0.18 : 0;
  const fireKick = pose === 'railgunFire' ? -0.75 : 0;
  const bodyY = breathing + walkBob + chargeCrouch + fireKick;
  const recoil = Math.max(0, Math.min(1, m.recoil || 0));
  const railPose = pose === 'railgunCharge' || pose === 'railgunFire' ||
    m.railgunWindup > 0 || m.railgunActive > 0;
  const portalPose = pose === 'portalAim' || pose === 'portalStep' ||
    pose === 'portalExit' || !!m.portalState;
  const pulsePose = pose === 'pulse' || (m.attackPulse || 0) > 0;
  const worldAim = railPose ? (m.railgunAngle || 0)
    : portalPose ? (m.portalGunAngle || 0)
    : (m.pulseAngle || (m.facing < 0 ? Math.PI : 0));
  const aim = localAimAngle(face, worldAim);
  const aimArm = aim - Math.PI / 2;

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#261b27';
  ctx.beginPath();
  ctx.ellipse(cx, y + h + 4, 8 + (moving ? 1 : 0), 2.2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy + bodyY);
  ctx.scale(face, 1);

  // Short-lived state feedback is tied to the pose, not to a scale change.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = railPose ? 0.14 + (m.railgunProgress || 0) * 0.12 : 0.07;
  ctx.fillStyle = railPose ? RAIL_PURPLE : PORTAL_CYAN;
  ctx.beginPath();
  ctx.arc(0, -1, 10.5 + Math.sin(t * 4) * 0.7, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Back-mounted nanotech pack and cyan exhaust pixels.
  ctx.fillStyle = '#2a1d1a';
  ctx.fillRect(-7, -5, 3, 12);
  ctx.fillStyle = '#a96b28';
  ctx.fillRect(-8, -4, 2, 9);
  ctx.fillStyle = PORTAL_BLUE;
  ctx.fillRect(-9, -3, 1, 3);
  ctx.fillRect(-9, 3, 1, 3);

  // Animated legs: every stride changes the knee/boot placement.
  drawAidanLeg(ctx, -3, 6, stride, lift);
  drawAidanLeg(ctx, 3, 6, -stride, otherLift);

  // Rear arm swings opposite the front leg while walking.
  const swing = moving ? stride * 0.18 : Math.sin(t * 1.8) * 0.04;
  drawAidanArm(ctx, -5, -4 + bodyY * 0.1, -0.18 - swing, 0.88);

  // Compact brown-and-gold chest plate.
  armorPolygon(ctx, [[-5, -7], [5, -7], [5, 5], [2, 7], [-2, 7], [-5, 5]], '#70421f', '#2a1b18');
  armorPolygon(ctx, [[-3.5, -6], [0, -7], [3.5, -6], [3, 3], [0, 5], [-3, 3]], '#b87828');
  ctx.fillStyle = '#edbb46';
  ctx.fillRect(-3, -5, 6, 2);
  ctx.fillStyle = '#ffd965';
  ctx.fillRect(-2, -5, 3, 1);
  ctx.fillStyle = '#56331c';
  ctx.fillRect(-3, 1, 6, 2);
  ctx.fillStyle = PORTAL_BLUE;
  ctx.fillRect(-1, -1, 2, 2);

  // Shoulder caps keep the silhouette readable at player scale.
  ctx.fillStyle = '#b97c2d';
  ctx.beginPath(); ctx.arc(-5, -5, 2.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(5, -5, 2.5, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f0c44f';
  ctx.fillRect(-6, -6, 2, 1);
  ctx.fillRect(4, -6, 2, 1);

  // Closed knight helmet: always on, with no face or weapon swap.
  armorPolygon(ctx, [[-4, -14], [2, -14], [5, -11], [4, -6], [-4, -6], [-5, -9]], '#805025', '#2a1b18');
  armorPolygon(ctx, [[-3, -13], [2, -13], [3.5, -10], [3, -7], [-3, -7]], '#c88d2e');
  ctx.fillStyle = '#f3c64d';
  ctx.fillRect(-2, -13, 4, 1.5);
  ctx.fillStyle = '#151b23';
  ctx.fillRect(-3, -10, 7, 2.4);
  ctx.fillStyle = '#83d8ef';
  ctx.fillRect(-2, -9.5, 5, 0.9);
  ctx.fillStyle = '#f5ce5c';
  ctx.fillRect(3, -11, 1, 4);
  ctx.fillStyle = '#3d251b';
  ctx.fillRect(-3, -7, 6, 1.5);

  if (railPose) {
    // Railgun wind-up uses a two-arm braced stance; the charge pulse jitters
    // only the weapon, while the body stays readable and player-sized.
    drawAidanArm(ctx, 4.5, -4, aimArm + 0.02, 0.92);
    drawAidanArm(ctx, -4, -3, aimArm + 0.34, 0.82);
    ctx.save();
    ctx.translate(4, -2.5);
    drawRailgun(ctx, aim, m.railgunProgress || 0, recoil);
    ctx.restore();
    if (pose === 'railgunFire') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = RAIL_CORE;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(5, -2, 5 + (1 - recoil) * 7, -0.8, 0.8);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  } else if (portalPose) {
    // Portal Pursuit visibly aims the gun, steps toward the source portal, then
    // exits with a backward recoil. The portal itself remains a separate effect.
    drawAidanArm(ctx, 4.5, -4, aimArm, 0.94);
    drawAidanArm(ctx, -4, -3, -0.16 - swing, 0.82);
    ctx.save();
    ctx.translate(4.5, -3);
    drawPortalGun(ctx, aim, recoil);
    ctx.restore();
  } else if (pulsePose) {
    // Nanobot pulse: the front gauntlet thrusts forward and contracts on release.
    drawAidanArm(ctx, 4.5, -4, aimArm, 1.0);
    drawAidanArm(ctx, -4, -3, -0.16 - swing, 0.82);
    ctx.save();
    ctx.translate(10, -4);
    ctx.rotate(aim);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = PORTAL_CYAN;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5 + (1 - recoil) * 4, -0.9, 0.9);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else {
    // Idle and locomotion have opposing arm/leg motion instead of a rigid pose.
    drawAidanArm(ctx, 5, -4, 0.18 - swing, 0.88);
  }

  if (m.hurtFlash > 0) {
    ctx.globalAlpha = Math.min(0.75, Math.max(0, m.hurtFlash / 0.12));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-6, -15, 12, 29);
  }
  ctx.restore();
}

function drawRailgunBeam(ctx, m) {
  // The charge is a weapon pose and reticle only. The damaging beam and its
  // rings exist for the short post-charge firing window, never during wind-up.
  if (!(m.railgunActive > 0) || m.railgunWindup > 0 ||
      !m.railgunOrigin || !m.railgunBeamEnd) return;
  const a = m.railgunAngle || 0;
  const o = m.railgunOrigin, e = m.railgunBeamEnd;
  const length = Math.hypot(e.x - o.x, e.y - o.y);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = RAIL_PURPLE;
  ctx.lineWidth = 24;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = RAIL_CORE;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  const spacing = TILE * 3;
  for (let d = spacing; d < length - 8; d += spacing) {
    const x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
    ctx.strokeStyle = RAIL_CORE;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.78;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.72;
    ctx.beginPath(); ctx.arc(x, y, 6.6, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = RAIL_CORE;
  ctx.beginPath(); ctx.arc(e.x, e.y, 10, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawRadioactive(ctx, m, target) {
  if (!aliveTarget(target)) return;
  const tc = centerOf(target);
  const state = m.radioactiveTargets.get(target);
  const pulse = 1 + Math.sin((m.anim + (state ? state.remaining : 0)) * 4) * 0.12;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.78;
  ctx.strokeStyle = RADIOACTIVE;
  ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(tc.x, tc.y, (Math.max(target.w, target.h) * 0.62 + 7) * pulse, 0, TAU); ctx.stroke();
  ctx.strokeStyle = RAIL_PURPLE;
  ctx.globalAlpha = 0.66;
  ctx.beginPath(); ctx.arc(tc.x, tc.y, (Math.max(target.w, target.h) * 0.72 + 11) * pulse,
    m.anim * 1.8, m.anim * 1.8 + 2.0); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = m.anim * 2.2 + i * TAU / 3;
    ctx.fillStyle = i % 2 ? RADIOACTIVE : '#e7ffb8';
    ctx.globalAlpha = 0.75;
    ctx.beginPath(); ctx.arc(tc.x + Math.cos(a) * 13, tc.y + Math.sin(a) * 13, 2, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawAidanEffects(game, ctx) {
  for (const m of game.minions || []) {
    if (!m || m.dead || m.key !== 'aidan') continue;
    const ps = m.portalState;
    if (ps) {
      drawPortal(ctx, ps.source, m.anim, 1);
      drawPortal(ctx, ps.exit, m.anim + 0.45, 1);
    }
    drawRailgunBeam(ctx, m);
    if (m.radioactiveTargets) {
      for (const target of m.radioactiveTargets.keys()) drawRadioactive(ctx, m, target);
    }
  }
}
