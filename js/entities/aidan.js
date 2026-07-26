// Summoner Realms — Aidan summon controller and pixel-tech presentation.
// Aidan is intentionally kept in its own module: his multi-stage portal and
// railgun states are too specific to safely squeeze into the generic minion AI.
import { TILE } from '../config.js?v=aidan-summon-1';
import { Projectile } from './projectile.js?v=aidan-summon-1';

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

function moveAidan(m, x, y, speed, dt, stopDistance = 0) {
  const c = centerOf(m);
  const dx = x - c.x, dy = y - c.y;
  const d = Math.hypot(dx, dy);
  let vx = 0, vy = 0;
  if (d > stopDistance + 2) {
    const scale = speed / Math.max(d, 0.001);
    vx = dx * scale; vy = dy * scale;
  }
  m.vx = vx; m.vy = vy;
  m.x += vx * dt; m.y += vy * dt;
  if (Math.abs(vx) > 2) m.facing = vx < 0 ? -1 : 1;
}

function orbitTarget(m, target, owner, dt) {
  const tc = centerOf(target);
  const oc = centerOf(owner);
  const c = centerOf(m);
  const dx = tc.x - c.x, dy = tc.y - c.y;
  const distance = Math.hypot(dx, dy);
  const preferred = 218;
  let radial = 0;
  if (distance > preferred + 30) radial = 1;
  else if (distance < preferred - 34) radial = -1;
  const inv = 1 / Math.max(distance, 1);
  const tangent = { x: -dy * inv, y: dx * inv };
  const side = Math.sin(m.anim * 0.65) > 0 ? 1 : -1;
  const speed = m.def.speed || 250;
  const vx = (dx * inv * radial + tangent.x * 0.24 * side) * speed;
  const vy = (dy * inv * radial + tangent.y * 0.24 * side) * speed;
  m.vx = vx; m.vy = vy;
  m.x += vx * dt; m.y += vy * dt;
  if (Math.abs(vx) > 2) m.facing = vx < 0 ? -1 : 1;

  // If the target is far from the owner but not far enough to trigger a portal,
  // bias Aidan back toward the owner so the summon never drifts off alone.
  if (Math.hypot(c.x - oc.x, c.y - oc.y) > 520) {
    moveAidan(m, oc.x + owner.facing * -80, oc.y - 42, speed, dt);
  }

  // Aidan is airborne, but never allowed to sink into the terrain while
  // orbiting a boss that is flying or hovering. Keeping his boots above the
  // owner's head makes the permanent armor silhouette readable and prevents
  // the summon from becoming an invisible damage source below the ground.
  const flightFloor = owner.y - (m.h || 54) - 10;
  if (m.y > flightFloor) {
    m.y = flightFloor;
    if (m.vy > 0) m.vy = 0;
  }
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
    if (!aliveTarget(target)) {
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
  m.vx = 0; m.vy = 0;
  if (m.railgunWindup <= 0) fireRailgun(m, game, owner);
}

function beginPortal(m, game, target) {
  const c = centerOf(m);
  const tc = centerOf(target);
  const angle = Math.atan2(tc.y - c.y, tc.x - c.x);
  const source = {
    x: c.x + Math.cos(angle) * (m.def.portalSourceDistance || TILE * 4),
    y: c.y + Math.sin(angle) * (m.def.portalSourceDistance || TILE * 4),
  };
  const side = tc.x >= c.x ? -1 : 1;
  const exit = {
    x: tc.x + side * (m.def.portalExitDistance || TILE * 3),
    y: tc.y - 8,
  };
  m.portalState = {
    time: 0,
    start: { x: m.x, y: m.y },
    source,
    exit,
    target,
    entered: false,
    exited: false,
  };
  m.portalGunAngle = angle;
  m.facing = Math.cos(angle) < 0 ? -1 : 1;
  m.vx = 0; m.vy = 0;
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
    const side = tc.x >= centerOf(m).x ? -1 : 1;
    ps.exit.x = tc.x + side * (m.def.portalExitDistance || TILE * 3);
    ps.exit.y = tc.y - 8;
  }

  // 0.00–0.32: the armored summon visibly moves into the portal it fired.
  if (ps.time < 0.32) {
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
    m.x = ps.exit.x - m.w / 2;
    m.y = ps.exit.y - m.h / 2;
    m.hidden = false;
    m.facing = target ? (centerOf(target).x < centerOf(m).x ? -1 : 1) : m.facing;
    game.fx?.burst(ps.exit.x, ps.exit.y, [PORTAL_CYAN, PORTAL_GOLD, '#ffffff'], 24, {
      speed: 170, life: 0.58, gravity: -18, glow: true, size: 2.5,
    });
    game.fx?.ring(ps.exit.x, ps.exit.y, PORTAL_CYAN, 42, { life: 0.38, width: 3 });
  }

  // 0.60–0.98: give the exit animation a beat before returning to combat.
  if (ps.time < 0.98) {
    const away = target ? centerOf(target) : centerOf(m);
    const dir = Math.sign(m.x + m.w / 2 - away.x) || m.facing;
    m.x += dir * 20 * dt;
    m.vx = dir * 20; m.vy = 0;
    return;
  }

  m.hidden = false;
  m.portalState = null;
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
  game.fx?.streak(c.x + Math.cos(angle) * 12, c.y + Math.sin(angle) * 12,
    angle, PORTAL_CYAN, 8, { speed: 240, spread: 0.32, life: 0.16, size: 2, glow: true });
}

function updateAidan(m, game, owner, ownerCenter, dt) {
  const d = m.def;
  m.portalCooldown = Math.max(0, (m.portalCooldown || 0) - dt);
  m.railgunCooldown = Math.max(0, (m.railgunCooldown || 0) - dt);
  m.basicCooldown = Math.max(0, (m.basicCooldown || 0) - dt);
  m.railgunActive = Math.max(0, (m.railgunActive || 0) - dt);
  m.targetScanCd = Math.max(0, (m.targetScanCd || 0) - dt);
  tickRadioactive(m, game, dt);

  if (m.portalState) { updatePortal(m, game, dt); return; }
  if (m.railgunWindup > 0) { updateRailgun(m, game, owner, dt); return; }

  const c = centerOf(m);
  if (!aliveTarget(m.target) || m.targetScanCd <= 0) {
    m.target = nearestTarget(game, c.x, c.y, d.range || 1500);
    m.targetScanCd = 0.22;
  }
  const target = m.target;
  if (!target) {
    moveAidan(m, ownerCenter.x + owner.facing * -84, ownerCenter.y - 50, d.speed || 250, dt, 4);
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

  orbitTarget(m, target, owner, dt);
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

function drawPortalGun(ctx, angle) {
  ctx.save();
  ctx.rotate(angle);
  ctx.fillStyle = '#173151';
  ctx.fillRect(2, -4, 25, 8);
  ctx.fillStyle = '#e8b63e';
  ctx.fillRect(3, -6, 19, 3);
  ctx.fillRect(19, -7, 8, 14);
  ctx.fillStyle = '#377dc5';
  ctx.fillRect(6, -3, 14, 3);
  ctx.fillStyle = '#8feaff';
  ctx.fillRect(22, -3, 5, 6);
  ctx.fillStyle = '#ffd967';
  ctx.fillRect(27, -5, 4, 10);
  ctx.fillStyle = '#1a2738';
  ctx.beginPath();
  ctx.moveTo(5, 4); ctx.lineTo(12, 4); ctx.lineTo(15, 16); ctx.lineTo(9, 18); ctx.lineTo(4, 8);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#61b9ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(9, 9, 5, 0.2, 2.8); ctx.stroke();
  ctx.restore();
}

function drawRailgun(ctx, angle, charge) {
  ctx.save();
  ctx.rotate(angle);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = RAIL_PURPLE;
  ctx.fillRect(2, -5, 47, 10);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#171928';
  ctx.fillRect(0, -5, 42, 10);
  ctx.fillStyle = '#3c334d';
  ctx.fillRect(6, -8, 27, 3);
  ctx.fillStyle = PORTAL_GOLD;
  ctx.fillRect(5, -7, 8, 2);
  ctx.fillStyle = RAIL_PURPLE;
  ctx.fillRect(11, -2, 28, 3);
  ctx.fillStyle = '#efb8ff';
  ctx.fillRect(13, -1, Math.max(2, 25 * charge), 1);
  ctx.fillStyle = '#b68cff';
  ctx.fillRect(34, -7, 9, 3);
  ctx.fillStyle = '#24243a';
  ctx.beginPath();
  ctx.moveTo(11, 5); ctx.lineTo(22, 5); ctx.lineTo(19, 15); ctx.lineTo(10, 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = PORTAL_GOLD;
  ctx.fillRect(39, -5, 5, 2);
  ctx.restore();
}

function armorPolygon(ctx, points, fill, stroke = null) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

export function drawAidan(ctx, m) {
  if (!m || m.dead || m.hidden) return;
  const x = m.x, y = m.y, w = m.w || 34, h = m.h || 54;
  const cx = x + w / 2, cy = y + h / 2;
  const t = m.anim || 0;
  const bob = Math.sin(t * 1.7) * 1.2;
  const face = m.facing < 0 ? -1 : 1;
  const weaponAngle = m.railgunWindup > 0 || m.railgunActive > 0
    ? (m.railgunAngle || 0) * face
    : (m.portalState ? (m.portalGunAngle || 0) * face : 0);

  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#261b27';
  ctx.beginPath(); ctx.ellipse(cx, y + h + 8, 19, 3.5, 0, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.scale(face, 1);

  // A small warm/cyan halo separates the fixed brown-and-gold armor silhouette
  // from the background without making it look like a floating blob.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = PORTAL_CYAN;
  ctx.beginPath(); ctx.arc(0, -2, 29 + Math.sin(t * 2) * 1.5, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Rear tech pack and exhaust fins.
  ctx.fillStyle = '#2a1d1a';
  ctx.fillRect(-15, -11, 5, 22);
  ctx.fillStyle = '#b8792b';
  ctx.fillRect(-17, -9, 3, 17);
  ctx.fillStyle = PORTAL_BLUE;
  ctx.fillRect(-18, -5, 2, 5); ctx.fillRect(-18, 3, 2, 5);

  // Greaves and plated boots; the armor never swaps off during any state.
  armorPolygon(ctx, [[-11, 8], [-2, 8], [-3, 24], [-11, 24], [-14, 20]], '#71431f', '#2a1b18');
  armorPolygon(ctx, [[2, 8], [11, 8], [14, 20], [11, 24], [3, 24]], '#71431f', '#2a1b18');
  ctx.fillStyle = '#c78a2d';
  ctx.fillRect(-10, 11, 7, 4); ctx.fillRect(3, 11, 7, 4);
  ctx.fillStyle = '#f4c956';
  ctx.fillRect(-9, 12, 5, 2); ctx.fillRect(4, 12, 5, 2);
  ctx.fillStyle = '#4b2d1b';
  ctx.fillRect(-13, 21, 12, 4); ctx.fillRect(1, 21, 12, 4);
  ctx.fillStyle = '#e2a83b';
  ctx.fillRect(-11, 21, 8, 2); ctx.fillRect(3, 21, 8, 2);

  // Torso/chest plate with the reference's broad warm metal planes.
  armorPolygon(ctx, [[-13, -12], [13, -12], [11, 9], [5, 13], [-5, 13], [-11, 9]], '#70421f', '#2a1b18');
  armorPolygon(ctx, [[-9, -10], [0, -13], [9, -10], [7, 5], [0, 9], [-7, 5]], '#b87727');
  ctx.fillStyle = '#e9b83f';
  ctx.fillRect(-6, -8, 12, 4);
  ctx.fillStyle = '#ffd965';
  ctx.fillRect(-4, -8, 5, 2);
  ctx.fillStyle = '#57341c';
  ctx.fillRect(-8, 1, 16, 3);
  ctx.fillStyle = PORTAL_BLUE;
  ctx.fillRect(-2, -2, 4, 4);
  ctx.fillStyle = '#b9f3ff';
  ctx.fillRect(-1, -2, 2, 2);

  // Shoulder plates and armored arms.
  ctx.fillStyle = '#b8792b';
  ctx.beginPath(); ctx.ellipse(-14, -9, 6, 6, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(14, -9, 6, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#f0c44f';
  ctx.fillRect(-16, -11, 4, 2); ctx.fillRect(12, -11, 4, 2);
  armorPolygon(ctx, [[-17, -5], [-12, -4], [-13, 8], [-18, 7], [-20, 2]], '#865025', '#2a1b18');
  armorPolygon(ctx, [[12, -4], [17, -5], [20, 2], [18, 7], [13, 8]], '#865025', '#2a1b18');
  ctx.fillStyle = '#d59b35';
  ctx.fillRect(-18, 3, 5, 3); ctx.fillRect(13, 3, 5, 3);

  // Helmet: a closed knight visor with the gold silhouette from the reference.
  armorPolygon(ctx, [[-11, -27], [-5, -33], [7, -32], [12, -25], [10, -14], [4, -10], [-9, -13]], '#805025', '#2a1b18');
  armorPolygon(ctx, [[-7, -29], [3, -30], [8, -25], [7, -16], [0, -13], [-7, -16]], '#c88d2e');
  ctx.fillStyle = '#f3c64d';
  ctx.fillRect(-5, -29, 7, 3);
  ctx.fillStyle = '#ffd967';
  ctx.fillRect(-3, -29, 4, 2);
  ctx.fillStyle = '#151b23';
  ctx.fillRect(-6, -22, 14, 5);
  ctx.fillStyle = '#5b6f77';
  ctx.fillRect(-4, -21, 10, 2);
  ctx.fillStyle = '#f5ce5c';
  ctx.fillRect(7, -23, 3, 8);
  ctx.fillStyle = '#3d251b';
  ctx.fillRect(-9, -15, 15, 3);

  // Technology held in-hand: the railgun or portal gun, never a sword.
  if (m.railgunWindup > 0 || m.railgunActive > 0) {
    drawRailgun(ctx, weaponAngle, m.railgunProgress || 0);
  } else if (m.portalState) {
    drawPortalGun(ctx, weaponAngle);
  } else if (m.attackPulse > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = PORTAL_CYAN;
    ctx.globalAlpha = m.attackPulse / 0.2;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(16, 3, 7 + (0.2 - m.attackPulse) * 16, -0.8, 0.8); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (m.hurtFlash > 0) {
    ctx.globalAlpha = clamp(m.hurtFlash / 0.12, 0, 1) * 0.65;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-18, -34, 36, 60);
  }
  ctx.restore();
}

function drawRailgunBeam(ctx, m) {
  if ((!m.railgunWindup && !m.railgunActive) || !m.railgunOrigin || !m.railgunBeamEnd) return;
  const a = m.railgunAngle || 0;
  const o = m.railgunOrigin, e = m.railgunBeamEnd;
  const charging = m.railgunWindup > 0;
  const progress = m.railgunProgress || 0;
  const length = Math.hypot(e.x - o.x, e.y - o.y);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.globalAlpha = charging ? 0.16 + progress * 0.18 : 0.45;
  ctx.strokeStyle = RAIL_PURPLE;
  ctx.lineWidth = charging ? 8 + progress * 5 : 24;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  ctx.globalAlpha = charging ? 0.8 : 1;
  ctx.strokeStyle = charging ? RAIL_PURPLE : RAIL_CORE;
  ctx.lineWidth = charging ? 1.4 + progress * 1.2 : 7;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  if (!charging) {
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
  }
  ctx.globalAlpha = 0.78;
  const spacing = TILE * 3;
  for (let d = spacing; d < length - 8; d += spacing) {
    const x = o.x + Math.cos(a) * d, y = o.y + Math.sin(a) * d;
    const radius = charging ? 8 + progress * 3 : 12;
    ctx.strokeStyle = charging ? RAIL_PURPLE : RAIL_CORE;
    ctx.lineWidth = charging ? 1.5 : 2.5;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.stroke();
    ctx.globalAlpha = charging ? 0.34 : 0.72;
    ctx.beginPath(); ctx.arc(x, y, radius * 0.55, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.78;
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = RAIL_CORE;
  ctx.beginPath(); ctx.arc(e.x, e.y, charging ? 4 + progress * 5 : 10, 0, TAU); ctx.fill();
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
