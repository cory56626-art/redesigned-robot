// Summoner Realms — enemy entity. Simulated on the host; replicated to clients.
//
// Each enemy runs the same loop: perceive (do I know where the player is?),
// decide (idle / approach / attack / retreat), then act. Perception, pathing and
// steering live in systems/ai.js so every creature reasons the same way.
import { TILE, normalizeDifficulty, ENEMY_DIFFICULTY_TUNING } from '../config.js?v=prehardmode-weapons-1';
import { ENEMIES } from '../data/enemies.js?v=prehardmode-weapons-1';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=prehardmode-weapons-1';
import { aabb } from '../utils.js?v=prehardmode-weapons-1';
import { Projectile } from './projectile.js?v=prehardmode-weapons-1';
import * as AI from '../systems/ai.js?v=prehardmode-weapons-1';

export class Enemy {
  constructor(key, x, y, netId, difficulty = 'normal') {
    const source = ENEMIES[key];
    const tuning = ENEMY_DIFFICULTY_TUNING[normalizeDifficulty(difficulty)] || ENEMY_DIFFICULTY_TUNING.normal;
    const projectile = source.projectile
      ? {
        ...source.projectile,
        damage: Math.max(1, Math.round((source.projectile.damage || 0) * tuning.projectile)),
        speed: (source.projectile.speed || 0) * tuning.projectile,
      }
      : source.projectile;
    const d = {
      ...source,
      hp: Math.max(1, Math.round(source.hp * tuning.hp)),
      damage: Math.max(1, Math.round(source.damage * tuning.damage)),
      speed: source.speed * tuning.speed,
      aggroRange: source.aggroRange * tuning.aggro,
      loseRange: source.loseRange * tuning.aggro,
      memory: source.memory * tuning.memory,
      telegraph: source.telegraph != null ? source.telegraph * tuning.telegraph : source.telegraph,
      fireRate: source.fireRate != null ? source.fireRate * tuning.cooldown : source.fireRate,
      projectile,
    };
    this.key = key;
    this.def = d;
    this.tuning = tuning;
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
    // Ground enemies use the same auto step-up the player gets, so ordinary
    // one-tile terrain never needs a hop at all.
    this.stepHeight = d.behavior === 'flyer' ? 0 : TILE + 2;
    this.iframes = 0;
    this.attackCd = 0;
    this.fireCd = Math.random() * 1.2 * tuning.cooldown;
    this.jumpCd = 0;
    this.dashCd = (1 + Math.random() * 2) * tuning.cooldown;
    this.contactCooldown = 0.6 * tuning.cooldown;
    // Perception state (see systems/ai.js).
    this.aware = false;
    this.awareTimer = 0;
    this.lastSeen = null;
    this.aiTargetPoint = null;   // debug overlay
    this.replanTimer = Math.random() * AI.REPLAN_INTERVAL;
    this.plannedDir = 0;
    // Wind-up before committing to an attack, so the player can react.
    this.telegraph = 0;
    this.telegraphMax = d.telegraph || 0.4;
    this.pendingAttack = null;
    this.dead = false;
    this.hurtFlash = 0;
    this.freezeT = 0;
    this.walkAnim = 0;
    this.animTime = Math.random() * Math.PI * 2;
    this.fromBoss = false;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  update(dt, game) {
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.freezeT > 0) {
      this.freezeT = Math.max(0, this.freezeT - dt);
      this.vx = 0;
      this.vy = 0;
      this.animTime += dt;
      return;
    }
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.jumpCd > 0) this.jumpCd -= dt;
    this.walkAnim += Math.abs(this.vx) * dt * 0.1;
    this.animTime += dt;

    const d = this.def;
    const goal = AI.perceive(this, game, dt, {
      aggroRange: d.aggroRange, loseRange: d.loseRange, memory: d.memory,
    });
    this.aiTargetPoint = goal;

    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;

    if (!goal) {
      this._idle(dt, game);
    } else {
      const dx = goal.x - cx, dy = goal.y - cy;
      this.facing = dx < 0 ? -1 : 1;
      this._hunt(dt, game, goal, dx, dy);
    }

    clampToWorld(this, game.world);
    this._contactDamage(game);

    // Despawn if far from every player.
    if (game.minDistToAnyPlayer(cx, cy) > 1700 * 1700) this.dead = true;
  }

  // Unaware: mill about. Flyers drift, everything else strolls and turns at
  // ledges instead of walking into a pit.
  _idle(dt, game) {
    if (this.behavior === 'flyer') {
      this.vx *= 0.94;
      this.vy = Math.sin(this.walkAnim * 2 + this.netId) * 18;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
        this.x -= this.vx * dt; this.y -= this.vy * dt; this.vx = -this.vx;
      }
      return;
    }
    const dir = AI.wander(this, game, dt);
    if (dir) this.facing = dir;
    this.vx = dir * this.speed * 0.45;
    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
  }

  _hunt(dt, game, goal, dx, dy) {
    const world = game.world;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;

    // A wind-up in progress owns the entity: hold still, then strike.
    if (this.telegraph > 0) {
      this.telegraph -= dt;
      if (this.behavior !== 'flyer') { this.vx *= 0.6; applyGravity(this, dt); moveAndCollide(this, world, dt); }
      if (this.telegraph <= 0) this._commitAttack(game, goal);
      return;
    }

    if (this.behavior === 'flyer') { this._flyer(dt, game, goal); return; }

    // Ground routing: re-plan a few times a second, and only when the direct
    // line is actually blocked — walking straight is right most of the time.
    this.replanTimer -= dt;
    if (this.replanTimer <= 0) {
      this.replanTimer = AI.REPLAN_INTERVAL;
      const direct = world.hasLineOfSight(cx, cy, goal.x, goal.y);
      this.plannedDir = direct ? Math.sign(dx) : (AI.planDirection(this, world, goal.x, goal.y) ?? Math.sign(dx));
    }
    let dir = this.plannedDir || Math.sign(dx) || this.facing;

    // Don't step off a drop unless the target is genuinely below us.
    if (this.onGround && !AI.safeAhead(this, world, dir) && dy < 40) {
      const gap = AI.gapWidth(this, world, dir);
      if (gap > 3) dir = 0;
    }
    // Spread out from the pack so a group doesn't stack into one silhouette.
    const sep = AI.separation(this, game.enemies) * 0.5;

    switch (this.behavior) {
      case 'hopper': {
        applyGravity(this, dt);
        if (this.onGround) {
          this.vx *= 0.7;
          if (this.jumpCd <= 0) {
            // Hop height scales with distance: little shuffles up close, real
            // leaps when closing a gap.
            const far = Math.min(1, Math.abs(dx) / 160);
            this.vy = -220 - far * 130;
            this.vx = (dir + sep) * this.speed * (2 + far * 1.6);
            this.jumpCd = 0.75 + Math.random() * 0.4;
          }
        }
        moveAndCollide(this, world, dt);
        break;
      }
      case 'charger': {
        applyGravity(this, dt);
        this.dashCd -= dt;
        if (this.dashTime > 0) {
          this.dashTime -= dt;
          this.vx = this.dashVel;
          // A charge that hits a wall ends in a stagger, not a grind.
          if (this.hitWallX) { this.dashTime = 0; this.attackCd = 0.9; game.fx.burst(cx, cy + this.h / 2, '#c9b18a', 5, { speed: 60 }); }
        } else if (this.dashCd <= 0 && Math.abs(dy) < 60 && Math.abs(dx) < 260 &&
                   world.hasLineOfSight(cx, cy, goal.x, goal.y)) {
          // Telegraph the charge: paw the ground, then commit.
          this._beginAttack(game, 'charge');
          return;
        } else {
          this.vx = (dir + sep) * this.speed;
        }
        if (AI.shouldJump(this, world, dir) && this.jumpCd <= 0) { this.vy = -300; this.jumpCd = 0.5; }
        moveAndCollide(this, world, dt);
        break;
      }
      case 'caster': {
        applyGravity(this, dt);
        const dist = Math.hypot(dx, dy);
        const los = world.hasLineOfSight(cx, cy, goal.x, goal.y);
        // Hold a firing lane: back off when crowded, close in when out of range,
        // and strafe rather than stand still at the ideal distance.
        if (dist < 130) this.vx = (-Math.sign(dx) + sep) * this.speed;
        else if (dist > 250 || !los) this.vx = (dir + sep) * this.speed;
        else this.vx = Math.sin(this.walkAnim * 0.6 + this.netId) * this.speed * 0.5;
        if (AI.shouldJump(this, world, Math.sign(this.vx) || dir) && this.jumpCd <= 0) { this.vy = -300; this.jumpCd = 0.6; }
        moveAndCollide(this, world, dt);

        this.fireCd -= dt;
        // Only shoot when there is genuinely a clear shot — casters used to fire
        // straight through solid rock.
        if (this.fireCd <= 0 && dist < 380 && los && this.attackCd <= 0) {
          this._beginAttack(game, 'cast');
        }
        break;
      }
      default: { // walker
        applyGravity(this, dt);
        this.vx = (dir + sep) * this.speed;
        if (AI.shouldJump(this, world, dir) && this.jumpCd <= 0) { this.vy = -300; this.jumpCd = 0.5; }
        moveAndCollide(this, world, dt);
      }
    }
  }

  _flyer(dt, game, goal) {
    const world = game.world;
    // Swoop: orbit slightly above the target rather than grinding into its box.
    const bob = Math.sin(this.walkAnim * 1.4 + this.netId) * 22;
    const steer = AI.flySteer(this, world, goal.x, goal.y + bob - 14, this.speed);
    const sep = AI.separation(this, game.enemies, 26);
    this.vx = steer.vx + sep * 30;
    this.vy = steer.vy;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    // Respect terrain instead of tunnelling through it and popping back out.
    if (!world.rectHitsSolid(nx, this.y, this.w, this.h)) this.x = nx; else this.vx = 0;
    if (!world.rectHitsSolid(this.x, ny, this.w, this.h)) this.y = ny; else this.vy = 0;
  }

  // Start a wind-up. The renderer draws the flash; the attack lands when the
  // telegraph expires.
  _beginAttack(game, kind) {
    this.telegraph = this.telegraphMax;
    this.pendingAttack = kind;
    this.vx *= 0.3;
    game.fx.burst(this.x + this.w / 2, this.y + this.h / 2, '#ffcf6b', 4, { speed: 40, life: 0.3, glow: true });
  }

  _commitAttack(game, goal) {
    const kind = this.pendingAttack;
    this.pendingAttack = null;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (kind === 'charge') {
      this.dashVel = Math.sign(goal.x - cx) * this.speed * 3.4;
      this.dashTime = 0.5;
      this.dashCd = 2.6 * this.tuning.cooldown;
      game.fx.streak(cx, cy, this.dashVel > 0 ? 0 : Math.PI, this.color2 || this.color, 5, { speed: 130 });
    } else if (kind === 'cast') {
      this.fireCd = this.def.fireRate || 2.0;
      this.attackCd = 0.4;
      const pj = this.def.projectile;
      const target = this.target;
      // Lead the shot so a moving player actually has to dodge.
      const a = target ? AI.leadShot(cx, cy, target, pj.speed) : Math.atan2(goal.y - cy, goal.x - cx);
      game.addProjectile(new Projectile({
        x: cx, y: cy, vx: Math.cos(a) * pj.speed, vy: Math.sin(a) * pj.speed,
        damage: pj.damage, ownerType: 'enemy', ownerId: this.netId, kind: pj.kind, color: pj.color, life: 4,
      }), true);
      game.fx.streak(cx, cy, a, pj.color, 5, { speed: 90, life: 0.2, glow: true });
    }
  }

  _contactDamage(game) {
    if (this.attackCd > 0) return;
    const targets = [...game.players.values()];
    for (const npc of (game.npcs || (game.npc ? [game.npc] : []))) {
      if (npc && npc.alive) targets.push(npc);
    }
    for (const m of (game.minions || [])) {
      if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);
    }
    for (const p of targets) {
      if (p.alive !== false && !p.dead && aabb(this, p)) {
        const knockback = Math.sign(p.x - this.x) * 4 + this.facing * 2;
        const dodged = p.isMinion && p.tryDodgeContact?.(game, this);
        if (!dodged && (p.kind || p.isMinion)) p.takeDamage(this.damage, knockback, game, this.name);
        else if (!dodged) game.applyEnemyDamageToPlayer(p, this.damage, knockback);
        this.attackCd = this.contactCooldown;
        break;
      }
    }
  }

  applyFreeze(duration = 5, game) {
    const wasFrozen = this.freezeT > 0;
    this.freezeT = Math.max(this.freezeT || 0, duration);
    this.vx = 0;
    this.vy = 0;
    this.telegraph = 0;
    this.pendingAttack = null;
    this.dashTime = 0;
    if (!wasFrozen) {
      const c = this.center();
      game?.fx?.ring(c.x, c.y, '#61eaff', Math.max(this.w, this.h) * 0.9, { life: 0.35, width: 2 });
      game?.fx?.burst(c.x, c.y, ['#dffcff', '#61eaff', '#2b8fff'], 14, {
        speed: 80, life: 0.45, gravity: -10, glow: true, size: 2,
      });
      game?.floatText?.(c.x, this.y - 6, 'FROZEN', '#bffcff');
    }
  }

  takeDamage(amount, kbx, kby, game, effect, crit) {
    if (this.dead) return;
    // A short window of invulnerability after a hit, so several projectiles
    // landing in one frame can't all register.
    if (this.iframes > 0) return;
    const kbResist = 1 - (this.def.kbResist || 0);
    this.hp -= amount;
    game?.audio?.enemyHurt();
    this.hurtFlash = 0.12;
    this.iframes = 0.05;
    this.vx += kbx * 24 * kbResist;
    if (kby) this.vy += kby * 40 * kbResist; else this.vy -= 40 * kbResist;
    if (effect) this._applyEffect(effect);
    // Being hit gives away the attacker's position even without line of sight.
    if (game && game.localPlayer) {
      const p = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
      if (p) AI.alert(this, p.x + p.w / 2, p.y + p.h / 2, this.def.memory || 5);
    }
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
    if (effect.freeze) this.applyFreeze(effect.freeze);
  }

  tickEffects(dt, game) {
    if (this.burn) { this.hp -= this.burn.dps * dt; this.burn.time -= dt; if (this.burn.time <= 0) this.burn = null; if (this.hp <= 0 && !this.dead) { this.dead = true; game.onEnemyDeath(this); } }
    if (this.poison) { this.hp -= this.poison.dps * dt; this.poison.time -= dt; if (this.poison.time <= 0) this.poison = null; if (this.hp <= 0 && !this.dead) { this.dead = true; game.onEnemyDeath(this); } }
    if (this.slowT > 0) { this.slowT -= dt; }
  }

  netState() {
    return { netId: this.netId, key: this.key, x: Math.round(this.x), y: Math.round(this.y), hp: Math.round(this.hp), facing: this.facing, f: this.hurtFlash > 0 ? 1 : 0, frz: Math.round((this.freezeT || 0) * 100) / 100 };
  }
}
