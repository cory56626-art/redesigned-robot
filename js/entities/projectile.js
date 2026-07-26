// Summoner Realms — projectiles for ranged/mage weapons, minions, enemies, bosses.
import { GRAVITY, TILE } from '../config.js?v=realms-qor-45';
import { aabb, dist2 } from '../utils.js?v=realms-qor-45';

export class Projectile {
  constructor(opts) {
    this.x = opts.x; this.y = opts.y;
    this.vx = opts.vx; this.vy = opts.vy;
    this.w = opts.w || 6; this.h = opts.h || 6;
    this.damage = opts.damage || 0;
    this.ownerId = opts.ownerId || null;
    this.ownerType = opts.ownerType || 'player'; // player | minion | npc | enemy | boss | fx
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
    // Impact burst metadata is used by the Diamond Heart's large spear. Keeping
    // it on the projectile makes wall hits, enemy hits, and timeout hits behave
    // consistently without special-casing the main loop.
    this.burstCount = opts.burstCount || 0;
    this.burstDamage = opts.burstDamage || 0;
    this.burstKind = opts.burstKind || null;
    this.burstColor = opts.burstColor || null;
    this.burstSpeed = opts.burstSpeed || 220;
    this.burstLife = opts.burstLife || 1.25;
    this.burstGravity = !!opts.burstGravity;
    this.burstDone = false;
    // Timed fuse metadata is used by the Diamond Heart spear. A fuse projectile
    // always releases its burst on schedule instead of detonating on contact.
    this.burstDelay = opts.burstDelay != null ? Math.max(0, opts.burstDelay) : null;
    this.burstTimer = this.burstDelay;
    this.burstHoming = !!opts.burstHoming;
    this.burstHomingStrength = opts.burstHomingStrength || 2.2;
    this.fuseAnchored = false;
    this.visualOnly = !!opts.visualOnly;
    this.dead = false;
    this.hitSet = new Set();
    this.crit = !!opts.crit;
    this.trail = opts.trail || null; // colour of the trailing streak, if any
    this.rot = Math.atan2(this.vy, this.vx);
  }

  update(dt, game) {
    this.life -= dt;
    if (this.burstTimer != null) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this._burst(game);
        this.dead = true;
        return;
      }
    }
    if (this.life <= 0) {
      if (this.burstTimer == null) {
        this._burst(game);
        this.dead = true;
        return;
      }
      // A timed fuse is authoritative; keep the projectile alive until it
      // reaches its promised detonation time.
      this.life = 0.05;
    }

    if (this.gravity) this.vy += GRAVITY * 0.5 * dt;

    if (this.homing) this._homeIn(dt, game);

    // Swept movement. Testing only the end point once per step let fast
    // projectiles (the rifle is ~15 px/frame) pass straight through one-tile
    // walls; stepping in sub-tile increments makes that impossible.
    if (!this.fuseAnchored) {
      const dist = Math.hypot(this.vx, this.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / (TILE * 0.5)));
      const sdt = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.x += this.vx * sdt;
        this.y += this.vy * sdt;
        const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
        if (game.world.isSolidAt(Math.floor(cx / TILE), Math.floor(cy / TILE))) {
          if (this.burstTimer != null) {
            // Stick to the wall, but honor the full fuse instead of detonating
            // on the first collision.
            this.vx = 0;
            this.vy = 0;
            this.fuseAnchored = true;
            break;
          }
          this._burst(game, cx, cy);
          this.dead = true;
          game.addHitParticles(cx, cy, this.color, 4);
          return;
        }
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
    if (cx2 < 0 || cx2 > game.world.width * TILE || cy2 > game.world.height * TILE) {
      if (this.burstTimer == null) {
        this._burst(game, cx2, cy2);
        this.dead = true;
        return;
      }
      this.vx = 0;
      this.vy = 0;
      this.fuseAnchored = true;
    }

    if (this.visualOnly) return;

    if (this.ownerType === 'player' || this.ownerType === 'minion' || this.ownerType === 'npc') {
      this._cutBossProjectiles(game);
    }

    if (this.ownerType === 'player' || this.ownerType === 'minion' || this.ownerType === 'npc') this._hitEnemies(game);
    else if (this.ownerType === 'enemy' || this.ownerType === 'boss') this._hitPlayers(game);
  }

  _homeIn(dt, game) {
    let target = null, best = Infinity;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (this.ownerType === 'player' || this.ownerType === 'minion') {
      for (const e of game.enemies) { const d = dist2(cx, cy, e.x + e.w / 2, e.y + e.h / 2); if (d < best) { best = d; target = e; } }
      for (const b of game.bosses) { const d = dist2(cx, cy, b.x + b.w / 2, b.y + b.h / 2); if (d < best) { best = d; target = b; } }
    } else {
      const targets = [...game.players.values()];
      if (game.npc && game.npc.alive) targets.push(game.npc);
      for (const m of (game.minions || [])) if (m.alive !== false && !m.dead) targets.push(m);
      for (const p of targets) {
        const d = dist2(cx, cy, p.x + p.w / 2, p.y + p.h / 2);
        if (d < best) { best = d; target = p; }
      }
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
        if (this.pierce-- <= 0 && this.burstDelay == null) {
          this._burst(game, this.x + this.w / 2, this.y + this.h / 2);
          this.dead = true;
          return;
        }
      }
    }
    for (const b of game.bosses) {
      if (this.hitSet.has(b)) continue;
      if (aabb(box, b)) {
        this.hitSet.add(b);
        game.hurtBoss(b, this.damage, this.ownerId, this.crit);
        game.addHitParticles(this.x, this.y, this.color, 4);
        if (this.pierce-- <= 0 && this.burstDelay == null) {
          this._burst(game, this.x + this.w / 2, this.y + this.h / 2);
          this.dead = true;
          return;
        }
      }
    }
  }

  _burst(game, x = this.x + this.w / 2, y = this.y + this.h / 2) {
    if (this.burstDone || !this.burstCount || !this.burstKind || !game) return;
    this.burstDone = true;
    const color = this.burstColor || this.color;
    const n = Math.max(1, Math.floor(this.burstCount));
    const phase = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      const speed = this.burstSpeed * (0.86 + Math.random() * 0.22);
      game.addProjectile(new Projectile({
        x: x - 4, y: y - 2,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        w: 8, h: 4,
        damage: this.burstDamage,
        ownerType: this.ownerType,
        ownerId: this.ownerId,
        kind: this.burstKind,
        color,
        gravity: this.burstGravity,
        knockback: 2.5,
        life: this.burstLife,
        homing: this.burstHoming,
        homingStrength: this.burstHomingStrength,
        trail: color,
      }), true);
    }
    game.fx?.ring(x, y, color, 40, { life: 0.28, width: 2 });
    game.fx?.burst(x, y, color, 20, { speed: 150, life: 0.5, size: 2, glow: true });
    game.shake?.(1.5, 0.12);
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
    const targets = [...game.players.values()];
    if (game.npc && game.npc.alive) targets.push(game.npc);
    for (const m of (game.minions || [])) {
      if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);
    }

    for (const p of targets) {
      if (p.alive === false || p.dead) continue;
      const hitId = p.id || p.netId || p;
      if (this.hitSet.has(hitId)) continue;
      if (aabb(box, p)) {
        this.hitSet.add(hitId);
        const knockback = Math.sign(this.vx) * this.knockback;
        if (p.isMinion && p.tryDodgeProjectile?.(game)) {
          this.dead = true;
          return;
        }
        if (p === game.npc || p.isMinion) p.takeDamage(this.damage, knockback, game, 'enemy');
        else game.applyEnemyDamageToPlayer(p, this.damage, knockback);
        this.dead = true;
        return;
      }
    }
  }
}
