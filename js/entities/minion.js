// Summoner Realms — minion entity. Owned by a player; the owner's client
// simulates it and reports damage to the host. Remote players' minions are
// drawn as lightweight ghosts (see renderer).
import { minionDef } from '../data/minions.js';
import { dist2, aabb, angleTo } from '../utils.js';
import { Projectile } from './projectile.js';

let MINION_SEQ = 1;

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
  }

  update(dt, game) {
    this.anim += dt * 6;
    if (this.cd > 0) this.cd -= dt;
    const owner = game.players.get(this.ownerId);
    if (!owner || !owner.alive) { this.dead = true; return; }
    const oc = owner.center();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;

    // Acquire nearest target within range.
    const target = game.nearestEnemyOrBoss(cx, cy, this.def.range);

    const dmgMul = (owner.stats ? owner.stats.summonMul : 1) || 1;
    const damage = this.def.damage * dmgMul;

    if (!target) {
      // Idle: hover near the owner.
      const hx = oc.x + this.slotOffset * 26;
      const hy = oc.y - 34 + Math.sin(this.anim) * 4;
      this._steer(hx, hy, this.def.speed * 0.7, dt);
      return;
    }
    const tc = target.center ? target.center() : { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    this.facing = tc.x < cx ? -1 : 1;

    switch (this.def.behavior) {
      case 'homing':
      case 'shooter': {
        // Hover at range and fire.
        const desiredX = tc.x - Math.sign(tc.x - oc.x) * 120;
        const desiredY = tc.y - 70 + Math.sin(this.anim) * 6;
        this._steer(desiredX, desiredY, this.def.speed, dt);
        if (this.cd <= 0) {
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
        // Stay near owner, lash nearby enemies.
        const hx = oc.x + this.slotOffset * 22;
        this._steer(hx, oc.y, this.def.speed, dt, true);
        if (this.cd <= 0 && dist2(cx, cy, tc.x, tc.y) < this.def.range * this.def.range) {
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

  _steer(tx, ty, speed, dt, groundish = false) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    let dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const accel = speed;
    this.vx += (dx / len) * accel * dt * 6;
    this.vy += (dy / len) * accel * dt * 6;
    // damping
    this.vx *= 0.86; this.vy *= 0.86;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > speed) { this.vx = this.vx / sp * speed; this.vy = this.vy / sp * speed; }
    this.x += this.vx * dt; this.y += this.vy * dt;
  }

  netInfo() { return { key: this.key, x: Math.round(this.x), y: Math.round(this.y), f: this.facing }; }
}
