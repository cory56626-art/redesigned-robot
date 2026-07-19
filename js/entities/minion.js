// Summoner Realms — minion entity. Owned by a player; the owner's client
// simulates it and reports damage to the host. Remote players' minions are
// drawn as lightweight ghosts (see renderer).
import { minionDef } from '../data/minions.js';
import { dist2, aabb, angleTo } from '../utils.js';
import { Projectile } from './projectile.js';

let MINION_SEQ = 1;

// Beyond this distance from the owner (px) a minion snaps home — it never
// wanders off to chase something across the map and never gets marooned.
const LEASH = 560;
// How long a minion may fail to reach/hit its target before it gives it up
// (returns to the owner and re-scans) — prevents grinding a wall forever.
const GIVE_UP = 2.6;
// How long stuck (barely moving, far from owner) before it teleports home.
const STUCK_TELEPORT = 3.0;

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
    this.slotOffset = (MINION_SEQ % 5) - 2;
    // AI bookkeeping.
    this.unreachTimer = 0;   // time spent unable to reach the current target
    this.returnTimer = 0;    // while >0, ignore targets and regroup on the owner
    this.stuckTimer = 0;
    this._lx = x; this._ly = y;
    // Flying minions (wisp/raven/emberling) may pass over terrain; grounded ones
    // (beetle/sentinel) should respect it more strictly.
    this.flying = d.behavior === 'homing' || d.behavior === 'shooter' || d.behavior === 'dive';
  }

  update(dt, game) {
    this.anim += dt * 6;
    this._world = game.world; // used by grounded steering
    if (this.cd > 0) this.cd -= dt;
    if (this.returnTimer > 0) this.returnTimer -= dt;
    const owner = game.players.get(this.ownerId);
    if (!owner || !owner.alive) { this.dead = true; return; }
    const oc = owner.center();
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

  netInfo() { return { key: this.key, x: Math.round(this.x), y: Math.round(this.y), f: this.facing }; }
}
