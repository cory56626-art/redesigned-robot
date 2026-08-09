// Summoner Realms — projectiles for ranged/mage weapons, minions, enemies, bosses.
import { GRAVITY, TILE } from '../config.js?v=boss-redesign-1';
import { aabb, dist2 } from '../utils.js?v=boss-redesign-1';

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
    // A boss missile can be locked to the player it selected when fired. This
    // keeps a co-op barrage fair: it will not silently swap to a nearby ally.
    this.homingTargetId = opts.homingTargetId || null;
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
    this.burstEffect = opts.burstEffect || null;
    // A timed blast can deal its damage directly in a radius, independently
    // from the older shrapnel burst used by the Diamond Heart spear.
    this.blastRadius = Math.max(0, Number(opts.blastRadius) || 0);
    this.blastDamage = Math.max(0, Number(opts.blastDamage) || 0);
    this.fuseAnchored = false;
    this.visualOnly = !!opts.visualOnly;
    // A short arming delay supports deliberately paced follow-up hits (such
    // as Mandible Edge's second slash) without losing them to an enemy's
    // same-frame damage iframe.
    this.armingDelay = Math.max(0, Number(opts.armingDelay) || 0);
    // Some boss tells deliberately erupt through stone at a previously marked
    // point. They must not disappear one frame early just because that point is
    // inside a player-built hideout.
    this.ignoreTerrain = !!opts.ignoreTerrain;
    // A timed boss pod can turn into an encounter hazard or hatch adds. This
    // remains generic projectile metadata so its terrain collision, fuse, and
    // cleanup all use the existing projectile lifecycle.
    this.spawnOnBurst = opts.spawnOnBurst || null;
    // Persistent areas (for example Vespera's venom pools) need to stay in the
    // world after the first hit, while still respecting a per-target cadence.
    this.persistent = !!opts.persistent;
    this.hitCooldown = Math.max(0.05, Number(opts.hitCooldown) || 0.55);
    this.hitCooldowns = new Map();
    this.dead = false;
    this.hitSet = new Set();
    this.crit = !!opts.crit;
    this.trail = opts.trail || null; // colour of the trailing streak, if any
    this.rot = Math.atan2(this.vy, this.vx);
  }

  update(dt, game) {
    if (this.armingDelay > 0) this.armingDelay = Math.max(0, this.armingDelay - dt);
    if (this.persistent && this.hitCooldowns.size) {
      for (const [id, time] of this.hitCooldowns) {
        const next = time - dt;
        if (next <= 0) this.hitCooldowns.delete(id);
        else this.hitCooldowns.set(id, next);
      }
    }
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
        if (!this.ignoreTerrain && game.world.isSolidAt(Math.floor(cx / TILE), Math.floor(cy / TILE))) {
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

    if (this.visualOnly || this.armingDelay > 0) return;

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
      for (const npc of (game.npcs || (game.npc ? [game.npc] : []))) {
        if (npc && npc.alive) targets.push(npc);
      }
      for (const m of (game.minions || [])) if (m.alive !== false && !m.dead) targets.push(m);
      for (const p of targets) {
        if (this.homingTargetId != null && (p.id === this.homingTargetId || p.netId === this.homingTargetId)) {
          target = p;
          break;
        }
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
        if (this.damage <= 0 && this.effect?.freeze) {
          e.applyFreeze?.(this.effect.freeze, game);
        } else {
          game.hurtEnemy(e, this.damage, Math.sign(this.vx) * this.knockback, -1, this.effect, this.ownerId, this.crit);
        }
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
        if (this.damage <= 0 && this.effect?.freeze) {
          b.applyFreeze?.(this.effect.freeze, game);
        } else {
          game.hurtBoss(b, this.damage, this.ownerId, this.crit);
        }
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
    if (this.burstDone || !game) return;
    const hasShrapnel = this.burstCount > 0 && !!this.burstKind;
    const hasBlast = this.blastRadius > 0 && this.blastDamage > 0;
    const hasSpawn = !!this.spawnOnBurst;
    if (!hasShrapnel && !hasBlast && !hasSpawn) return;
    this.burstDone = true;
    const color = this.burstColor || this.color;
    if (hasSpawn) this._spawnOnBurst(game, x, y);
    if (hasBlast) this._blastTargets(game, x, y);
    if (hasShrapnel) {
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
          effect: this.burstEffect || this.effect || null,
          trail: color,
        }), true);
      }
    }
    const radius = Math.max(40, this.blastRadius || 0);
    game.fx?.ring(x, y, color, radius, { life: 0.28, width: 2 });
    game.fx?.burst(x, y, color, hasBlast ? 26 : 20, { speed: 150, life: 0.5, size: 2, glow: true });
    game.fx?.shake?.(hasBlast ? 3.2 : 1.5, hasBlast ? 0.22 : 0.12);
  }

  _spawnOnBurst(game, x, y) {
    const spec = this.spawnOnBurst;
    if (!spec) return;
    if (spec.hazard) {
      const h = spec.hazard;
      const w = h.w || 80, height = h.h || 32;
      game.addProjectile(new Projectile({
        x: x - w / 2, y: y - height / 2,
        vx: 0, vy: 0, w, h: height,
        damage: h.damage || 6, ownerType: this.ownerType, kind: h.kind || 'venomZone',
        color: h.color || '#b9e86e', life: h.life || 4,
        persistent: true, hitCooldown: h.hitCooldown || 0.55, ignoreTerrain: true,
        effect: { poison: h.poison || 2.2 }, knockback: h.knockback || 1.5,
      }), true);
    }
    if (spec.adds && game.spawnBossAdds) {
      const adds = spec.adds;
      game.spawnBossAdds(adds.key, adds.count || 1, x, y, { lifetime: adds.lifetime });
    }
  }

  _blastTargets(game, x, y) {
    const friendly = this.ownerType === 'player' || this.ownerType === 'minion' || this.ownerType === 'npc';
    const targets = friendly
      ? [...(game.enemies || []), ...(game.bosses || [])]
      : [
          ...game.players.values(),
          ...(game.npcs || (game.npc ? [game.npc] : [])),
          ...(game.minions || []).filter(m => m.alive !== false && !m.dead && m.maxHp != null),
        ];
    for (const target of targets) {
      if (!target || target.dead || target.alive === false) continue;
      const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
      const distance = Math.hypot(tx - x, ty - y);
      if (distance > this.blastRadius) continue;
      const amount = Math.max(1, Math.round(this.blastDamage * (1 - distance / this.blastRadius)));
      const knockback = Math.sign(tx - x) * this.knockback;
      if (friendly) {
        if (target.key && target.maxHp != null && (game.bosses || []).includes(target)) game.hurtBoss(target, amount, this.ownerId, this.crit);
        else game.hurtEnemy(target, amount, knockback, -1, this.effect, this.ownerId, this.crit);
      } else if (target.kind || target.isMinion) {
        target.takeDamage(amount, knockback, game, 'explosion');
      } else {
        game.applyEnemyDamageToPlayer(target, amount, knockback, this.effect);
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
    // A fused missile is intentionally harmless on touch: it keeps tracking
    // its selected target until the five-second fuse resolves (or a player
    // shoots it down). Without this guard a 0-damage collision would still
    // delete the missile before its promised explosion.
    if (this.burstTimer != null && this.damage <= 0) return;
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    const targets = [...game.players.values()];
    for (const npc of (game.npcs || (game.npc ? [game.npc] : []))) {
      if (npc && npc.alive) targets.push(npc);
    }
    for (const m of (game.minions || [])) {
      if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);
    }

    for (const p of targets) {
      if (p.alive === false || p.dead) continue;
      const hitId = p.id || p.netId || p;
      if (!this.persistent && this.hitSet.has(hitId)) continue;
      if (this.persistent && (this.hitCooldowns.get(hitId) || 0) > 0) continue;
      if (aabb(box, p)) {
        if (!this.persistent) this.hitSet.add(hitId);
        const knockback = Math.sign(this.vx) * this.knockback;
        if (p.isMinion && p.tryDodgeProjectile?.(game)) {
          if (!this.persistent) { this.dead = true; return; }
          this.hitCooldowns.set(hitId, this.hitCooldown);
          continue;
        }
        if (p.kind || p.isMinion) p.takeDamage(this.damage, knockback, game, 'enemy');
        else game.applyEnemyDamageToPlayer(p, this.damage, knockback, this.effect);
        if (this.persistent) {
          this.hitCooldowns.set(hitId, this.hitCooldown);
          continue;
        }
        if (this.burstTimer == null) this.dead = true;
        return;
      }
    }
  }
}
