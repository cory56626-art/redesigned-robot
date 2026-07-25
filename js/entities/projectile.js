// Summoner Realms — projectiles for ranged/mage weapons, minions, enemies, bosses.
import { GRAVITY, TILE } from '../config.js?v=realms-2';
import { aabb, dist2 } from '../utils.js?v=realms-2';

export class Projectile {
  constructor(opts) {
    this.x = opts.x; this.y = opts.y;
    this.vx = opts.vx; this.vy = opts.vy;
    this.w = opts.w || 6; this.h = opts.h || 6;
    this.damage = opts.damage || 0;
    this.ownerId = opts.ownerId || null;
    this.ownerType = opts.ownerType || 'player'; // player | minion | enemy | boss | fx
    this.kind = opts.kind || 'spark';
    this.color = opts.color || '#ffffff';
    this.pierce = opts.pierce || 0;
    this.gravity = !!opts.gravity;
    this.effect = opts.effect || null;
    this.knockback = opts.knockback != null ? opts.knockback : 3;
    this.life = opts.life || 3;
    this.homing = !!opts.homing;
    this.homingStrength = opts.homingStrength || 3.5;
    this.destructible = !!opts.destructible;
    this.visualOnly = !!opts.visualOnly;
    this.dead = false;
    this.hitSet = new Set();
    this.crit = !!opts.crit;
    this.trail = opts.trail || null; // colour of the trailing streak, if any
    this.rot = Math.atan2(this.vy, this.vx);
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }

    if (this.gravity) this.vy += GRAVITY * 0.5 * dt;

    if (this.homing) this._homeIn(dt, game);

    // Swept movement. Testing only the end point once per step let fast
    // projectiles (the rifle is ~15 px/frame) pass straight through one-tile
    // walls; stepping in sub-tile increments makes that impossible.
    const dist = Math.hypot(this.vx, this.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / (TILE * 0.5)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.x += this.vx * sdt;
      this.y += this.vy * sdt;
      const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
      if (game.world.isSolidAt(Math.floor(cx / TILE), Math.floor(cy / TILE))) {
        this.dead = true;
        game.addHitParticles(cx, cy, this.color, 4);
        return;
      }
    }
    this.rot = Math.atan2(this.vy, this.vx);

    // A trailing streak for the weapons that declare one.
    if (this.trail) {
      this._trailT = (this._trailT || 0) - dt;
      if (this._trailT <= 0) {
        this._trailT = 0.02;
        game.fx.trail(this.x + this.w / 2, this.y + this.h / 2, this.trail, { size: 2, life: 0.2 });
      }
    }

    // Out of world.
    const cx2 = this.x + this.w / 2, cy2 = this.y + this.h / 2;
    if (cx2 < 0 || cx2 > game.world.width * TILE || cy2 > game.world.height * TILE) { this.dead = true; return; }

    if (this.visualOnly) return;

    if (this.ownerType === 'player' || this.ownerType === 'minion') {
      this._cutBossProjectiles(game);
    }

    if (this.ownerType === 'player' || this.ownerType === 'minion') this._hitEnemies(game);
    else if (this.ownerType === 'enemy' || this.ownerType === 'boss') this._hitPlayers(game);
  }

  _homeIn(dt, game) {
    let target = null, best = Infinity;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (this.ownerType === 'player' || this.ownerType === 'minion') {
      for (const e of game.enemies) { const d = dist2(cx, cy, e.x + e.w / 2, e.y + e.h / 2); if (d < best) { best = d; target = e; } }
      for (const b of game.bosses) { const d = dist2(cx, cy, b.x + b.w / 2, b.y + b.h / 2); if (d < best) { best = d; target = b; } }
    } else {
      for (const p of game.players.values()) { if (!p.alive) continue; const d = dist2(cx, cy, p.x + p.w / 2, p.y + p.h / 2); if (d < best) { best = d; target = p; } }
    }
    if (target) {
      const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
      const ang = Math.atan2(ty - cy, tx - cx);
      const spd = Math.hypot(this.vx, this.vy);
      const steer = this.homingStrength * dt;
      let cur = Math.atan2(this.vy, this.vx);
      let diff = ang - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      cur += Math.max(-steer, Math.min(steer, diff));
      this.vx = Math.cos(cur) * spd;
      this.vy = Math.sin(cur) * spd;
    }
  }

  _hitEnemies(game) {
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    for (const e of game.enemies) {
      if (this.hitSet.has(e.netId || e)) continue;
      if (aabb(box, e)) {
        this.hitSet.add(e.netId || e);
        game.hurtEnemy(e, this.damage, Math.sign(this.vx) * this.knockback, -1, this.effect, this.ownerId, this.crit);
        game.addHitParticles(this.x, this.y, this.color, 4);
        if (this.pierce-- <= 0) { this.dead = true; return; }
      }
    }
    for (const b of game.bosses) {
      if (this.hitSet.has(b)) continue;
      if (aabb(box, b)) {
        this.hitSet.add(b);
        game.hurtBoss(b, this.damage, this.ownerId, this.crit);
        game.addHitParticles(this.x, this.y, this.color, 4);
        if (this.pierce-- <= 0) { this.dead = true; return; }
      }
    }
  }

  _cutBossProjectiles(game) {
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    for (const other of game.projectiles) {
      if (other === this || other.dead || other.ownerType !== 'boss' || !other.destructible) continue;
      if (aabb(box, other)) {
        other.dead = true;
        game.addHitParticles(other.x + other.w / 2, other.y + other.h / 2, other.color, 6);
        if (this.pierce <= 0) { this.dead = true; return; }
        this.pierce--;
      }
    }
  }

  _hitPlayers(game) {
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    for (const p of game.players.values()) {
      if (!p.alive) continue;
      if (this.hitSet.has(p.id)) continue;
      if (aabb(box, p)) {
        this.hitSet.add(p.id);
        game.applyEnemyDamageToPlayer(p, this.damage, Math.sign(this.vx) * this.knockback);
        this.dead = true;
        return;
      }
    }
  }
}
