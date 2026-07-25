// Summoner Realms — minion entity. Owned by a player; the owner's client
// simulates it and reports damage to the host. Remote players' minions are
// drawn as lightweight ghosts (see renderer).
import { minionDef } from '../data/minions.js?v=realms-diamond-1';
import { dist2, aabb, angleTo } from '../utils.js?v=realms-2';
import { Projectile } from './projectile.js?v=realms-diamond-3';
import * as AI from '../systems/ai.js?v=realms-diamond-1';

let MINION_SEQ = 1;

// Beyond this distance from the owner (px) a minion snaps home — it never
// wanders off to chase something across the map and never gets marooned.
const LEASH = 560;
// How long a minion may fail to reach/hit its target before it gives it up
// (returns to the owner and re-scans) — prevents grinding a wall forever.
const GIVE_UP = 2.6;
// How long stuck (barely moving, far from owner) before it teleports home.
const STUCK_TELEPORT = 3.0;
const DIAMOND_LEASH = 780;
// Diamond Heart keeps a real air lane around threats instead of hovering in
// melee range. It may cross this lane only during its deliberate dash.
const DIAMOND_SAFE_RADIUS = 235;

export class Minion {
  constructor(key, ownerId, x, y) {
    const d = minionDef(key);
    this.key = key;
    this.def = d;
    this.ownerId = ownerId;
    this.id = MINION_SEQ++;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.w = d.w; this.h = d.h;
    this.color = d.color; this.color2 = d.color2;
    this.facing = 1;
    this.cd = 0;
    this.anim = Math.random() * 6;
    this.dead = false;
    this.alive = true;
    this.isMinion = true;
    this.maxHp = d.maxHp != null ? d.maxHp : null;
    this.hp = this.maxHp;
    this.iframes = 0;
    this.hurtFlash = 0;
    this.attackPulse = 0;
    this.slotOffset = (MINION_SEQ % 5) - 2;
    // Diamond Heart combat state. The other minions continue using the compact
    // generic state machine below.
    // Let the endgame summon demonstrate its kit quickly, then respect the
    // full cooldowns after the opening exchange.
    this.spearCd = d.behavior === 'diamondHeart' ? 0.35 : (d.spearRate || 0);
    this.dashCd = d.behavior === 'diamondHeart' ? 0.45 : (d.dashRate || 0.9);
    this.spearWindup = 0;
    this.spearTarget = null;
    this.spearAngle = 0;
    this.spearPulse = 0;
    this.dashTime = 0;
    this.dashAngle = 0;
    this.dashTarget = null;
    this.dashHits = new Set();
    this.dashTrailTimer = 0;
    this.target = null;
    this.swordAngle = 0;
    this.diamondRetreat = 0;
    // AI bookkeeping.
    this.unreachTimer = 0;   // time spent unable to reach the current target
    this.returnTimer = 0;    // while >0, ignore targets and regroup on the owner
    this.stuckTimer = 0;
    this._lx = x; this._ly = y;
    // Flying minions (wisp/raven/emberling) may pass over terrain; grounded ones
    // (beetle/sentinel) should respect it more strictly.
    this.flying = !!d.flying || d.behavior === 'homing' || d.behavior === 'shooter' || d.behavior === 'dive';
  }

  update(dt, game) {
    if (this.dead) return;
    this.anim += dt * (this.def.behavior === 'diamondHeart' ? 3.8 : 6);
    this._world = game.world; // used by grounded steering
    if (this.cd > 0) this.cd -= dt;
    if (this.returnTimer > 0) this.returnTimer -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackPulse > 0) this.attackPulse -= dt;
    if (this.spearPulse > 0) this.spearPulse -= dt;
    const owner = game.players.get(this.ownerId);
    if (!owner || !owner.alive) { this.dead = true; this.alive = false; return; }
    const oc = owner.center();

    if (this.def.behavior === 'diamondHeart') {
      this._updateDiamondHeart(dt, game, owner, oc);
      return;
    }
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;

    // Leash + stuck safety: snap home if we've strayed or wedged in terrain.
    const ownerDist = Math.hypot(cx - oc.x, cy - oc.y);
    const moved = Math.hypot(this.x - this._lx, this.y - this._ly);
    this._lx = this.x; this._ly = this.y;
    if (moved < 0.6 && ownerDist > 60) this.stuckTimer += dt; else this.stuckTimer = 0;
    if (ownerDist > LEASH || this.stuckTimer > STUCK_TELEPORT) { this._teleportToOwner(game, oc); return; }

    const dmgMul = (owner.stats ? owner.stats.summonMul : 1) || 1;
    const damage = this.def.damage * dmgMul;

    // Only chase reachable targets (line-of-sight from the minion). Grounded
    // minions also require LOS from the owner so they don't dive into caves the
    // owner can't follow into.
    let target = this.returnTimer > 0 ? null : game.nearestReachableEnemyOrBoss(cx, cy, this.def.range);

    if (!target) {
      // No reachable target: regroup and hover near the owner.
      this._idle(game, oc, dt);
      this.unreachTimer = 0;
      return;
    }

    const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const los = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);
    this.facing = tc.x < cx ? -1 : 1;

    // Track inability to close the gap; give the target up after a while.
    const inAttackRange = dist2(cx, cy, tc.x, tc.y) < (this.def.range * this.def.range);
    if (!los) { this.unreachTimer += dt; if (this.unreachTimer > GIVE_UP) { this.returnTimer = 1.4; this.unreachTimer = 0; this._idle(game, oc, dt); return; } }
    else this.unreachTimer = Math.max(0, this.unreachTimer - dt);

    switch (this.def.behavior) {
      case 'homing':
      case 'shooter': {
        // Hover at range and fire — but only when there's a clear shot.
        const desiredX = tc.x - Math.sign(tc.x - oc.x) * 110;
        const desiredY = tc.y - 70 + Math.sin(this.anim) * 6;
        this._steer(desiredX, desiredY, this.def.speed, dt);
        if (this.cd <= 0 && los) {
          this.cd = this.def.fireRate || 0.8;
          const pj = this.def.projectile;
          const a = angleTo(cx, cy, tc.x, tc.y);
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * pj.speed, vy: Math.sin(a) * pj.speed,
            damage, ownerType: 'minion', ownerId: this.ownerId, kind: pj.kind, color: pj.color,
            homing: !!pj.homing, effect: pj.effect || null, life: 2.5,
          }), true);
        }
        break;
      }
      case 'guard': {
        // Stay tethered to the owner, lashing enemies that stray close.
        const hx = oc.x + this.slotOffset * 22;
        this._steer(hx, oc.y, this.def.speed, dt);
        if (this.cd <= 0 && inAttackRange && los) {
          this.cd = this.def.attackRate || 0.5;
          game.hurtEnemyOrBoss(target, damage, this.facing * 3, this.ownerId);
          game.addHitParticles(tc.x, tc.y, this.color, 4);
        }
        break;
      }
      default: { // charge / dive / fastmelee -> rush target and contact-damage
        this._steer(tc.x, tc.y, this.def.speed, dt);
        if (this.cd <= 0 && aabb(this, target)) {
          this.cd = this.def.attackRate || 0.5;
          game.hurtEnemyOrBoss(target, damage, this.facing * 4, this.ownerId);
          game.addHitParticles(tc.x, tc.y, this.color, 5);
        }
        break;
      }
    }
  }

  _findDiamondTarget(game, cx, cy) {
    let best = null;
    let bestHp = -Infinity;
    let bestMaxHp = -Infinity;
    let bestDist = Infinity;
    const consider = (t) => {
      if (!t || t.dead || t.alive === false || t.hp == null || t.hp <= 0) return;
      const tc = t.center ? t.center() : { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const hp = Number(t.hp) || 0;
      const maxHp = Number(t.maxHp) || hp;
      const d = dist2(cx, cy, tc.x, tc.y);
      // Current HP is the primary key: the Heart helps finish the most
      // important surviving target instead of randomly swapping between foes.
      if (hp > bestHp || (hp === bestHp && (maxHp > bestMaxHp || (maxHp === bestMaxHp && d < bestDist)))) {
        best = t; bestHp = hp; bestMaxHp = maxHp; bestDist = d;
      }
    };
    for (const e of game.enemies) consider(e);
    for (const b of game.bosses) consider(b);
    return best;
  }

  _updateDiamondHeart(dt, game, owner, oc) {
    this.spearCd -= dt;
    this.dashCd -= dt;
    this.dashTrailTimer -= dt;
    this.diamondRetreat = Math.max(0, this.diamondRetreat - dt);

    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const ownerDist = Math.hypot(cx - oc.x, cy - oc.y);
    if (ownerDist > DIAMOND_LEASH) {
      this._teleportToOwner(game, oc);
      return;
    }

    if (this.dashTime > 0) {
      this._updateDiamondDash(dt, game);
      return;
    }

    let target = this.target;
    if (!target || target.dead || target.alive === false || target.hp <= 0) {
      target = this._findDiamondTarget(game, cx, cy);
    }
    this.target = target;

    if (this.spearWindup > 0) {
      const live = this.spearTarget && !this.spearTarget.dead && this.spearTarget.alive !== false && this.spearTarget.hp > 0
        ? this.spearTarget : target;
      if (!live) {
        this.spearWindup = 0;
        this.spearTarget = null;
      } else {
        const tc = live.center();
        this.spearAngle = AI.leadShot(cx, cy, live, 520);
        this.swordAngle = this.spearAngle;
        this.facing = tc.x < cx ? -1 : 1;
        this._diamondHover(game, owner, live, dt, this.diamondRetreat > 0);
        this.spearWindup -= dt;
        if (this.spearWindup <= 0) this._fireDiamondSpear(game);
        return;
      }
    }

    if (!target) {
      this._diamondRegroup(game, oc, dt);
      return;
    }

    const tc = target.center();
    const dx = tc.x - cx, dy = tc.y - cy;
    const distance = Math.hypot(dx, dy);
    const los = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);
    this.facing = dx < 0 ? -1 : 1;
    this.swordAngle = Math.atan2(dy, dx);

    this._diamondHover(game, owner, target, dt, this.diamondRetreat > 0);

    // Dash through a nearby target when the line is clear. The cooldown and
    // single-hit-per-dash rule keep this a skill move, not contact-DPS spam.
    if (this.diamondRetreat <= 0 && this.dashCd <= 0 && los && distance > 118 && distance < 212) {
      this._beginDiamondDash(game, target);
      return;
    }

    // At range, the Heart charges one readable spear before releasing it.
    if (this.diamondRetreat <= 0 && this.spearCd <= 0 && los && distance > 220) {
      this._beginDiamondSpear(game, target);
    }
  }

  _diamondHover(game, owner, target, dt, retreat = false) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const tc = target.center();
    const orbit = this.anim * 0.72 + this.id * 0.9;
    // Keep a real combat lane around melee enemies. The Heart only closes for
    // its deliberate dash; otherwise it fights from a wide, readable orbit.
    const radius = retreat
      ? 300 + Math.sin(this.anim * 0.43) * 18
      : DIAMOND_SAFE_RADIUS + Math.sin(this.anim * 0.43) * 20;
    const dodge = this._diamondDodge(game, cx, cy);
    const threat = this._diamondThreatVector(game, cx, cy);
    const pushScale = retreat ? 220 : 165;
    let desiredX = tc.x + Math.cos(orbit) * radius + dodge.x * (retreat ? 170 : 135) + threat.x * pushScale;
    let desiredY = tc.y - 58 + Math.sin(orbit * 1.15) * (retreat ? 48 : 60) + dodge.y * (retreat ? 170 : 135) + threat.y * pushScale;

    // Correct aggressively if any enemy closes the gap between steering
    // updates. This uses every nearby threat, not just the Heart's current
    // highest-HP target, so a second slime cannot sneak into contact range.
    const gapX = cx - tc.x, gapY = cy - tc.y;
    const gap = Math.hypot(gapX, gapY);
    const minGap = retreat ? 290 : 220;
    if (gap < minGap) {
      const len = gap || 1;
      desiredX = tc.x + (gapX / len) * (retreat ? 340 : 270) + threat.x * 80;
      desiredY = tc.y + (gapY / len) * (retreat ? 340 : 270) + threat.y * 80;
    }

    this._steer(desiredX, desiredY, this.def.speed, dt);
  }

  _diamondRegroup(game, oc, dt) {
    const dodge = this._diamondDodge(game, this.x + this.w / 2, this.y + this.h / 2);
    const desiredX = oc.x + this.slotOffset * 30 + dodge.x * 90;
    const desiredY = oc.y - 92 + Math.sin(this.anim * 0.8) * 12 + dodge.y * 90;
    this.swordAngle = this.facing > 0 ? 0.15 : Math.PI - 0.15;
    this._steer(desiredX, desiredY, this.def.speed * 0.82, dt);
  }

  _diamondThreatVector(game, cx, cy) {
    let pushX = 0, pushY = 0;
    const consider = (t) => {
      if (!t || t.dead || t.alive === false || t.hp <= 0) return;
      const tc = t.center ? t.center() : { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const dx = cx - tc.x, dy = cy - tc.y;
      const distance = Math.hypot(dx, dy);
      const safe = t === this.target ? DIAMOND_SAFE_RADIUS + 24 : DIAMOND_SAFE_RADIUS;
      if (distance >= safe) return;
      const urgency = (safe - distance) / safe;
      const weight = t === this.target ? 0.9 : 1.25;
      pushX += (dx / (distance || 1)) * urgency * weight;
      pushY += (dy / (distance || 1)) * urgency * weight;
    };
    for (const e of game.enemies) consider(e);
    for (const b of game.bosses) consider(b);
    const len = Math.hypot(pushX, pushY);
    return len > 1 ? { x: pushX / len, y: pushY / len } : { x: pushX, y: pushY };
  }

  _diamondDodge(game, cx, cy) {
    let pushX = 0, pushY = 0;
    for (const pr of game.projectiles) {
      if (!pr || pr.dead || (pr.ownerType !== 'enemy' && pr.ownerType !== 'boss')) continue;
      const px = pr.x + pr.w / 2, py = pr.y + pr.h / 2;
      const vx = pr.vx || 0, vy = pr.vy || 0;
      const speed2 = vx * vx + vy * vy;
      if (speed2 < 100) continue;
      const rx = cx - px, ry = cy - py;
      const t = Math.max(0, Math.min(0.7, (rx * vx + ry * vy) / speed2));
      const nx = px + vx * t, ny = py + vy * t;
      const dd = Math.hypot(cx - nx, cy - ny);
      const danger = 52 + Math.max(pr.w, pr.h) * 0.6;
      if (dd >= danger) continue;
      const away = Math.max(0.1, danger - dd) / danger;
      pushX += (cx - nx) / Math.max(1, dd) * away;
      pushY += (cy - ny) / Math.max(1, dd) * away;
      const sp = Math.sqrt(speed2);
      const side = (this.id & 1) ? 1 : -1;
      pushX += (-vy / sp) * away * side * 0.7;
      pushY += (vx / sp) * away * side * 0.7;
    }
    const len = Math.hypot(pushX, pushY);
    return len > 1 ? { x: pushX / len, y: pushY / len } : { x: pushX, y: pushY };
  }

  _beginDiamondSpear(game, target) {
    this.spearTarget = target;
    this.spearWindup = 0.3;
    this.spearPulse = 0.3;
    this.spearCd = this.def.spearRate || 3.8;
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    this.spearAngle = AI.leadShot(c, d, target, 520);
    this.swordAngle = this.spearAngle;
    game.fx?.ring(c, d, '#dffcff', 34, { life: 0.3, width: 2 });
    game.fx?.streak(c, d, this.spearAngle, '#dffcff', 7, { speed: 90, spread: 0.24, life: 0.24, size: 2, glow: true });
  }

  _fireDiamondSpear(game) {
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    const a = this.spearAngle;
    const speed = 520;
    game.addProjectile(new Projectile({
      x: c + Math.cos(a) * 18 - 9, y: d + Math.sin(a) * 18 - 3,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      w: 18, h: 6,
      damage: this.def.spearDamage || 16,
      ownerType: 'minion', ownerId: this.ownerId,
      kind: 'diamondSpear', color: '#dffcff',
      life: 2.4, knockback: 5, trail: '#8be9ff',
      burstCount: 20, burstDamage: 5, burstKind: 'miniDiamondSpear',
      burstColor: '#8be9ff', burstSpeed: 230, burstLife: 1.35,
      burstDelay: 0.3, burstHoming: true, burstHomingStrength: 2.4,
    }), true);
    game.audio?.magicCast?.();
    game.fx?.streak(c, d, a, '#dffcff', 10, { speed: 220, spread: 0.34, life: 0.3, size: 2, glow: true });
    this.spearPulse = 0.18;
    this.spearWindup = 0;
    this.spearTarget = null;
    this.lastAttack = 'spear';
  }

  _beginDiamondDash(game, target) {
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    const tc = target.center();
    this.dashAngle = Math.atan2(tc.y - d, tc.x - c);
    this.dashTime = this.def.dashDuration || 0.34;
    this.diamondRetreat = 0.52;
    this.dashCd = this.def.dashRate || 2.6;
    this.dashTarget = target;
    this.dashHits = new Set();
    this.attackPulse = this.dashTime;
    this.swordAngle = this.dashAngle;
    this.vx = Math.cos(this.dashAngle) * (this.def.dashSpeed || 760);
    this.vy = Math.sin(this.dashAngle) * (this.def.dashSpeed || 760);
    game.fx?.ring(c, d, '#ffffff', 32, { life: 0.22, width: 2 });
    game.fx?.streak(c, d, this.dashAngle, '#8be9ff', 12, { speed: 210, spread: 0.22, life: 0.28, size: 3, glow: true });
    this.lastAttack = 'dash';
  }

  _updateDiamondDash(dt, game) {
    const ox = this.x, oy = this.y;
    const speed = this.def.dashSpeed || 760;
    this.x += Math.cos(this.dashAngle) * speed * dt;
    this.y += Math.sin(this.dashAngle) * speed * dt;
    if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
      this.x = ox; this.y = oy; this.dashTime = 0;
    }

    const sweep = {
      x: Math.min(ox, this.x) - 5,
      y: Math.min(oy, this.y) - 5,
      w: Math.abs(this.x - ox) + this.w + 10,
      h: Math.abs(this.y - oy) + this.h + 10,
    };
    const damage = this.def.dashDamage || 20;
    const hit = (target) => {
      if (!target || target.dead || target.alive === false || this.dashHits.has(target)) return;
      if (!aabb(sweep, target)) return;
      this.dashHits.add(target);
      game.hurtEnemyOrBoss(target, damage, Math.sign(this.vx) * 7, this.ownerId);
      const tc = target.center();
      game.addHitParticles(tc.x, tc.y, '#dffcff', 10);
      game.fx?.ring(tc.x, tc.y, '#dffcff', 26, { life: 0.2, width: 2 });
    };
    for (const e of game.enemies) hit(e);
    for (const b of game.bosses) hit(b);

    if (this.dashTrailTimer <= 0) {
      this.dashTrailTimer = 0.035;
      game.fx?.trail(this.x + this.w / 2, this.y + this.h / 2, '#8be9ff', { size: 4, life: 0.24 });
    }
    this.dashTime -= dt;
    if (this.dashTime <= 0) {
      this.dashTime = 0;
      this.dashTarget = null;
      this.vx *= 0.25; this.vy *= 0.25;
      game.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 10, { speed: 100, life: 0.35, glow: true });
    }
  }

  _idle(game, oc, dt) {
    const hx = oc.x + this.slotOffset * 26;
    const hy = oc.y - 34 + Math.sin(this.anim) * 4;
    this._steer(hx, hy, this.def.speed * 0.8, dt);
  }

  _teleportToOwner(game, oc) {
    this.x = oc.x + this.slotOffset * 18 - this.w / 2;
    this.y = oc.y - 30 - this.h / 2;
    this.vx = 0; this.vy = 0;
    this.stuckTimer = 0; this.unreachTimer = 0; this.returnTimer = 0.4;
    if (game.addHitParticles) game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color, 6);
  }

  _steer(tx, ty, speed, dt) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    let dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const accel = speed;
    this.vx += (dx / len) * accel * dt * 6;
    this.vy += (dy / len) * accel * dt * 6;
    this.vx *= 0.86; this.vy *= 0.86;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > speed) { this.vx = this.vx / sp * speed; this.vy = this.vy / sp * speed; }
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    // Grounded minions won't tunnel through solid terrain; flyers may.
    const w = this._world;
    if (this.flying || !w) { this.x = nx; this.y = ny; }
    else {
      if (!w.rectHitsSolid(nx, this.y, this.w, this.h)) this.x = nx; else this.vx = 0;
      if (!w.rectHitsSolid(this.x, ny, this.w, this.h)) this.y = ny; else this.vy = 0;
    }
  }

  takeDamage(amount, knockbackX, game, srcName) {
    if (this.dead || !this.isMinion || this.maxHp == null || this.iframes > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 0.28;
    this.hurtFlash = 0.16;
    this.vx += (knockbackX || 0) * 5;
    if (this.def.behavior === 'diamondHeart') {
      // A hit is an immediate reposition command: cancel a wind-up, break
      // contact, and spend a short window in the wider retreat orbit.
      this.spearWindup = 0;
      this.spearTarget = null;
      this.diamondRetreat = Math.max(this.diamondRetreat, 0.9);
      const escape = game?._diamondThreatVector(
        game, this.x + this.w / 2, this.y + this.h / 2
      );
      if (escape) {
        this.vx = escape.x * this.def.speed;
        this.vy = escape.y * this.def.speed;
      }
    }
    game?.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 7);
    game?.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#dffcff');
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dead = true;
      game?.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 46, { life: 0.35, width: 3 });
      game?.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#8be9ff', 24, { speed: 170, life: 0.7, glow: true });
      game?.toast?.('Diamond Heart shattered.', 'bad');
    }
  }

  netInfo() {
    return {
      key: this.key, x: Math.round(this.x), y: Math.round(this.y), f: this.facing,
      hp: this.maxHp != null ? Math.round(this.hp) : null,
      maxHp: this.maxHp,
      dead: this.dead ? 1 : 0,
    };
  }
}
