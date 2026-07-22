// Summoner Realms — enemy entity. Simulated on the host; replicated to clients.
import { TILE } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js';
import { dist2, aabb } from '../utils.js';
import { Projectile } from './projectile.js';

export class Enemy {
  constructor(key, x, y, netId) {
    const d = ENEMIES[key];
    this.key = key;
    this.def = d;
    this.netId = netId;
    this.name = d.name;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.w = d.w; this.h = d.h;
    this.hp = d.hp; this.maxHp = d.hp;
    this.damage = d.damage;
    this.speed = d.speed;
    this.behavior = d.behavior;
    this.color = d.color; this.color2 = d.color2;
    this.facing = 1;
    this.onGround = false;
    this.iframes = 0;
    this.attackCd = 0;
    this.fireCd = Math.random() * 1.2;
    this.jumpCd = 0;
    this.climbCd = 0;
    this.dashCd = 1 + Math.random() * 2;
    // Stuck detection / detour routing for ground navigation.
    this._lastX = x;
    this.stuckTimer = 0;
    this.detourDir = 0;
    this.detourTimer = 0;
    this.dead = false;
    this.hurtFlash = 0;
    this.walkAnim = 0;
    this.fromBoss = false;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  update(dt, game) {
    if (this.iframes > 0) this.iframes -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    this.walkAnim += Math.abs(this.vx) * dt * 0.1;

    const target = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    if (!target) { applyGravity(this, dt); moveAndCollide(this, game.world, dt); return; }
    const tc = target.center ? target.center() : { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const dx = tc.x - cx, dy = tc.y - cy;
    this.facing = dx < 0 ? -1 : 1;

    // Ground navigation: if we're pinned against terrain making no progress,
    // briefly route the other way instead of walking into the same block forever.
    const moveDir = this._navDir(dt, dx);

    switch (this.behavior) {
      case 'flyer': {
        // Flying enemies ignore terrain but nudge out if they clip into it.
        const len = Math.hypot(dx, dy) || 1;
        this.vx = (dx / len) * this.speed;
        this.vy = (dy / len) * this.speed;
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) { this.x -= this.vx * dt; this.y -= this.vy * dt * 1.2; this.y -= 6; }
        break;
      }
      case 'hopper': {
        applyGravity(this, dt);
        if (this.onGround) {
          this.jumpCd -= dt;
          this.vx = 0;
          if (this.jumpCd <= 0) { this.vy = -300; this.vx = moveDir * this.speed * 3; this.jumpCd = 1.1; }
        }
        moveAndCollide(this, game.world, dt);
        break;
      }
      case 'charger': {
        applyGravity(this, dt);
        this.dashCd -= dt;
        if (this.dashCd <= 0 && Math.abs(dy) < 60 && Math.abs(dx) < 240 && this.detourTimer <= 0) { this.dashVel = Math.sign(dx) * this.speed * 3.2; this.dashTime = 0.5; this.dashCd = 2.5; }
        if (this.dashTime > 0) { this.dashTime -= dt; this.vx = this.dashVel; }
        else this.vx = moveDir * this.speed;
        this._climb(game, dt, moveDir);
        moveAndCollide(this, game.world, dt);
        break;
      }
      case 'caster': {
        applyGravity(this, dt);
        const d = Math.hypot(dx, dy);
        if (d < 150) this.vx = -Math.sign(dx) * this.speed;
        else if (d > 240) this.vx = moveDir * this.speed;
        else this.vx = 0;
        this._climb(game, dt, Math.sign(this.vx));
        moveAndCollide(this, game.world, dt);
        this.fireCd -= dt;
        if (this.fireCd <= 0 && d < 380) {
          this.fireCd = 2.0;
          const pj = this.def.projectile;
          const len = Math.hypot(dx, dy) || 1;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: (dx / len) * pj.speed, vy: (dy / len) * pj.speed,
            damage: pj.damage, ownerType: 'enemy', ownerId: this.netId, kind: pj.kind, color: pj.color, life: 4,
          }), true);
        }
        break;
      }
      default: { // walker
        applyGravity(this, dt);
        this.vx = moveDir * this.speed;
        this._climb(game, dt, moveDir);
        moveAndCollide(this, game.world, dt);
      }
    }
    clampToWorld(this, game.world);

    // Contact damage vs all players (host-authoritative).
    if (this.attackCd <= 0) {
      for (const p of game.players.values()) {
        if (p.alive && aabb(this, p)) {
          game.applyEnemyDamageToPlayer(p, this.damage, Math.sign(p.x - this.x) * 4 + this.facing * 2);
          this.attackCd = 0.6;
          break;
        }
      }
    }

    // Despawn if far from every player.
    if (game.minDistToAnyPlayer(cx, cy) > 1700 * 1700) this.dead = true;
  }

  // Decide which horizontal direction to walk, taking a temporary detour when
  // stuck against terrain so the enemy doesn't grind into one block forever.
  _navDir(dt, dx) {
    const desired = Math.sign(dx) || this.facing;
    const moved = Math.abs(this.x - this._lastX);
    // Count as "stuck" only while actively pushing into a wall on the ground.
    if (this.onGround && Math.abs(this.vx) > 1 && this.hitWallX && moved < 0.4) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    this._lastX = this.x;
    if (this.detourTimer > 0) this.detourTimer -= dt;
    if (this.stuckTimer > 0.9 && this.detourTimer <= 0) {
      this.detourDir = -desired;   // back off and try the other way
      this.detourTimer = 0.7;
      this.stuckTimer = 0;
      this.climbCd = 0;            // allow an immediate hop attempt
    }
    return this.detourTimer > 0 ? this.detourDir : desired;
  }

  // Hop small ledges when blocked — but only with headroom (never headbutt a
  // ceiling) and on a cooldown (so ground enemies don't jump constantly).
  _climb(game, dt, dir) {
    if (this.climbCd > 0) this.climbCd -= dt;
    if (!this.onGround || !this.hitWallX || this.climbCd > 0) return;
    dir = dir || this.facing;
    const w = game.world;
    const headTy = Math.floor((this.y - 2) / TILE);
    const cxTile = Math.floor((this.x + this.w / 2) / TILE);
    const aheadTile = cxTile + (dir >= 0 ? 1 : -1);
    // Require clear space above our head and above the obstacle we're hopping.
    const headClear = !w.isSolidAt(cxTile, headTy);
    const ledgeTopClear = !w.isSolidAt(aheadTile, headTy) && !w.isSolidAt(aheadTile, headTy + 1);
    if (headClear && ledgeTopClear) { this.vy = -300; this.climbCd = 0.5; }
  }

  takeDamage(amount, kbx, kby, game, effect, crit) {
    if (this.dead) return;
    const kbResist = 1 - (this.def.kbResist || 0);
    this.hp -= amount;
    game?.audio?.enemyHurt();
    this.hurtFlash = 0.12;
    this.iframes = 0.05;
    this.vx += kbx * 24 * kbResist;
    if (kby) this.vy += kby * 40 * kbResist; else this.vy -= 40 * kbResist;
    if (effect) this._applyEffect(effect);
    if (game) game.floatText(this.x + this.w / 2, this.y, Math.round(amount) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      game?.audio?.enemyDeath();
      if (game) game.onEnemyDeath(this);
    }
  }

  _applyEffect(effect) {
    if (effect.burn) { this.burn = { time: effect.burn, dps: 4 }; }
    if (effect.poison) { this.poison = { time: effect.poison, dps: 3 }; }
    if (effect.slow) { this.slowT = effect.slow; }
  }

  tickEffects(dt, game) {
    if (this.burn) { this.hp -= this.burn.dps * dt; this.burn.time -= dt; if (this.burn.time <= 0) this.burn = null; if (this.hp <= 0 && !this.dead) { this.dead = true; game.onEnemyDeath(this); } }
    if (this.poison) { this.hp -= this.poison.dps * dt; this.poison.time -= dt; if (this.poison.time <= 0) this.poison = null; if (this.hp <= 0 && !this.dead) { this.dead = true; game.onEnemyDeath(this); } }
    if (this.slowT > 0) { this.slowT -= dt; }
  }

  netState() {
    return { netId: this.netId, key: this.key, x: Math.round(this.x), y: Math.round(this.y), hp: Math.round(this.hp), facing: this.facing, f: this.hurtFlash > 0 ? 1 : 0 };
  }
}
