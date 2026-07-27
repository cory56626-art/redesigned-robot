// Summoner Realms — boss entity. Host-authoritative, multi-phase.
//
// Bosses used to run every attack off its own independent timer, which meant
// several could fire on the same frame with no warning and no relationship to
// where the boss was. They now run a single state machine:
//
//   reposition -> telegraph -> attack -> recover -> reposition
//
// Only one attack is ever in flight, every attack is preceded by a visible
// wind-up the player can react to, and the choice of attack is weighted by
// distance, phase and line of sight. Animation fields (squash, jaw, segment
// lag, shard spin) are updated here rather than in the renderer, so they are
// driven by the simulation and stay frame-rate independent.
import { TILE, normalizeDifficulty } from '../config.js?v=quality-of-realms-1';
import { BOSSES } from '../data/bosses.js?v=quality-of-realms-1';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=quality-of-realms-1';
import { aabb, angleTo, randRange, clamp } from '../utils.js?v=quality-of-realms-1';
import { Projectile } from './projectile.js?v=quality-of-realms-1';
import * as AI from '../systems/ai.js?v=quality-of-realms-1';

const PROJ_COLOR = { thorn: '#7ee08a', rock: '#8a7a5a', blight: '#c58bff', voidorb: '#b06bff' };

// Beyond this distance from every player the boss is being kited out of its
// arena; past the grace period it enrages, then leaves.
const ARENA_TILES = 46;
const ENRAGE_GRACE = 5;
const FLEE_AFTER = 14;

const BOSS_DIFFICULTY_TUNING = {
  // Normal is still a real step up from the original 520 HP baseline, but
  // keeps enough attack/recovery time for a first clear.
  normal:    { hp: 1.12, damage: 1.10, move: 1.03, projectile: 1.05, cooldown: 0.98, telegraph: 0.98, recover: 0.98, extraProjectiles: 0, extraAdds: 0, enrageGrace: 6.0, enrageMove: 1.28, enrageCooldown: 0.84 },
  hard:      { hp: 1.30, damage: 1.22, move: 1.07, projectile: 1.10, cooldown: 0.92, telegraph: 0.94, recover: 0.92, extraProjectiles: 0, extraAdds: 0, enrageGrace: 5.5, enrageMove: 1.38, enrageCooldown: 0.74 },
  master:    { hp: 1.52, damage: 1.38, move: 1.11, projectile: 1.16, cooldown: 0.86, telegraph: 0.90, recover: 0.86, extraProjectiles: 1, extraAdds: 1, enrageGrace: 5.0, enrageMove: 1.48, enrageCooldown: 0.66 },
  masochist: { hp: 1.82, damage: 1.58, move: 1.15, projectile: 1.22, cooldown: 0.80, telegraph: 0.86, recover: 0.80, extraProjectiles: 1, extraAdds: 1, enrageGrace: 4.6, enrageMove: 1.58, enrageCooldown: 0.58 },
};

function scaledBossDef(source, tuning) {
  const def = { ...source };
  def.maxHp = Math.max(1, Math.round(source.maxHp * tuning.hp));
  def.contactBase = Math.max(1, Math.round((source.contactBase || 1) * tuning.damage));
  def.phases = source.phases.map(phase => ({
    ...phase,
    contact: Math.max(1, Math.round((phase.contact ?? source.contactBase ?? 1) * tuning.damage)),
    speed: (phase.speed || 0) * tuning.move,
    attacks: phase.attacks.map(attack => {
      const out = { ...attack };
      if (out.damage != null && out.damage > 0) out.damage = Math.max(1, Math.round(out.damage * tuning.damage));
      if (out.speed != null) out.speed *= tuning.move;
      if (out.projSpeed != null) out.projSpeed *= tuning.projectile;
      if (out.cooldown != null) out.cooldown = Math.max(0.32, out.cooldown * tuning.cooldown);
      if (out.telegraph != null) out.telegraph = Math.max(0.20, out.telegraph * tuning.telegraph);
      if (out.recover != null) out.recover = Math.max(0.12, out.recover * tuning.recover);
      if (out.count != null) out.count = Math.max(1, out.count + tuning.extraProjectiles);
      if (out.addCount != null) out.addCount = Math.max(1, out.addCount + tuning.extraAdds);
      if (out.homingStrength != null) out.homingStrength *= tuning.projectile;
      return out;
    }),
  }));
  return def;
}

export class Boss {
  constructor(key, x, y, difficulty = 'normal') {
    const source = BOSSES[key];
    this.difficulty = normalizeDifficulty(difficulty);
    this.tuning = BOSS_DIFFICULTY_TUNING[this.difficulty] || BOSS_DIFFICULTY_TUNING.normal;
    const d = scaledBossDef(source, this.tuning);
    this.key = key;
    this.def = d;
    this.name = d.name;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.w = d.w; this.h = d.h;
    this.maxHp = d.maxHp; this.hp = d.maxHp;
    this.color = d.color; this.color2 = d.color2;
    this.movement = d.movement;
    this.facing = 1;
    this.onGround = false;
    this.phaseIndex = 0;
    this.dead = false;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.bob = Math.random() * 6;
    this.spawnTime = 0;
    this.attackPulse = 0;
    this.freezeT = 0;

    // ---- State machine ----
    this.aiState = 'reposition';
    this.stateTime = 0;
    this.chosen = null;        // the attack being wound up / executed
    this.telegraph = 0;
    this.telegraphMax = 0.6;
    this.recover = 0;
    this.cooldowns = new Map(); // attack type -> seconds until reusable
    this._seedCooldowns();

    // ---- Special states ----
    this.hidden = false;       // burrowed or mid-teleport: not drawn, not hittable
    this.warnAt = null;        // where it is about to reappear
    this.warnTime = 0;
    this.warnMax = 0.6;
    this.charge = null;        // { time, vx, vy }

    // ---- Enrage / leash ----
    this.awayTimer = 0;
    this.enraged = false;

    // ---- Animation ----
    this.squashX = 1; this.squashY = 1;
    this.jaw = 0;
    this.shardSpin = 0;
    this.segments = [];
    for (let i = 0; i < 3; i++) this.segments.push({ x: x + 4 + i * 17, y: y + 12 });
    this.ghostTrail = [];
    this._trailTimer = 0;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }
  phase() { return this.def.phases[this.phaseIndex]; }

  _seedCooldowns() {
    this.cooldowns = new Map();
    for (const a of this.phase().attacks) {
      this.cooldowns.set(a.type, a.cooldown * (0.2 + Math.random() * 0.4));
    }
  }

  _updatePhase(game) {
    const ratio = this.hp / this.maxHp;
    let idx = 0;
    for (let i = 0; i < this.def.phases.length; i++) if (ratio <= this.def.phases[i].at) idx = i;
    if (idx !== this.phaseIndex) {
      this.phaseIndex = idx;
      this._seedCooldowns();
      this.invuln = 0.6;
      this.aiState = 'reposition';
      this.stateTime = 0;
      this.chosen = null; this.telegraph = 0;
      game.toast(`${this.name}: ${this.phase().name}!`, 'bad');
      const c = this.center();
      game.fx.ring(c.x, c.y, this.color2, 90, { life: 0.55, width: 4 });
      game.fx.burst(c.x, c.y, this.color2, 28, { speed: 200, glow: true, life: 0.6 });
      game.fx.shake(6, 0.5);
    }
  }

  update(dt, game) {
    this.spawnTime += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackPulse > 0) this.attackPulse -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.freezeT > 0) {
      this.freezeT = Math.max(0, this.freezeT - dt);
      this.vx = 0;
      this.vy = 0;
      this._updateAnim(dt);
      return;
    }
    this.bob += dt * 3;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - dt);
    this._updatePhase(game);

    const target = game.nearestHostileTarget
      ? game.nearestHostileTarget(this.x + this.w / 2, this.y + this.h / 2)
      : game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    this._updateLeash(dt, game, target);
    if (this.dead) return; // fled

    if (this.hidden) { this._updateHidden(dt, game, target); this._updateAnim(dt); return; }
    if (!target) { this._drift(dt, game); this._updateAnim(dt); return; }

    const ph = this.phase();
    const speedMul = this.enraged ? this.tuning.enrageMove : 1;
    const tc = target.center();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    this.facing = tc.x < cx ? -1 : 1;

    // A committed charge or leap overrides everything until it expires.
    if (this.charge) {
      this.charge.time -= dt;
      if (this.movement === 'gravemaw') {
        applyGravity(this, dt);
        this.vx = this.charge.vx;
        this._move(game, dt);
        // Landing from a leap slams the ground.
        if (this.onGround && this.charge.airborne) {
          this.charge.airborne = false;
          game.fx.ring(cx, this.y + this.h, this.color2, 60, { life: 0.3, width: 3 });
          game.fx.burst(cx, this.y + this.h, '#a08a68', 16, { speed: 150, life: 0.5, gravity: 500 });
          game.fx.shake(5, 0.35);
        }
      } else {
        this.vx = this.charge.vx; this.vy = this.charge.vy;
        this._flyMove(game, dt);
      }
      if (this.charge.time <= 0) { this.charge = null; this.aiState = 'recover'; this.recover = 0.4; }
      this._updateAnim(dt);
      this._contactDamage(game, ph);
      return;
    }

    this.stateTime += dt;
    switch (this.aiState) {
      case 'telegraph': {
        // Wind-up: slow to a hover so the tell is readable, then commit.
        this._moveToward(dt, game, target, ph, speedMul * 0.35);
        this.telegraph -= dt;
        if (this.telegraph <= 0) {
          this._performAttack(this.chosen, game, target);
          this.cooldowns.set(this.chosen.type, this.chosen.cooldown * (this.enraged ? this.tuning.enrageCooldown : 1));
          this.recover = this.chosen.recover != null ? this.chosen.recover : 0.45;
          this.aiState = 'recover';
          this.stateTime = 0;
        }
        break;
      }
      case 'recover': {
        // A beat of vulnerability after every attack — the player's window.
        this._moveToward(dt, game, target, ph, speedMul * 0.6);
        this.recover -= dt;
        if (this.recover <= 0) { this.aiState = 'reposition'; this.stateTime = 0; }
        break;
      }
      default: { // reposition
        this.aiState = 'reposition';
        this._moveToward(dt, game, target, ph, speedMul);
        // Pick an attack as soon as one is off cooldown and appropriate here.
        const atk = this._chooseAttack(game, target);
        if (atk) {
          this.chosen = atk;
          this.telegraphMax = atk.telegraph != null ? atk.telegraph : 0.6;
          this.telegraph = this.telegraphMax;
          this.aiState = 'telegraph';
          this.stateTime = 0;
          game.audio?.bossTelegraph?.();
          game.fx.ring(cx, cy, this.color2, 46, { life: this.telegraphMax, from: 70, width: 2 });
        }
        break;
      }
    }

    clampToWorld(this, game.world);
    this._updateAnim(dt);
    this._contactDamage(game, ph);
  }

  // Kiting a boss out of its arena no longer works: it speeds up, then leaves,
  // so the fight has to be re-summoned.
  _updateLeash(dt, game, target) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const far = !target || Math.hypot(target.x - cx, target.y - cy) > ARENA_TILES * TILE;
    if (far) {
      this.awayTimer += dt;
      if (!this.enraged && this.awayTimer > this.tuning.enrageGrace) {
        this.enraged = true;
        game.toast(this.name + ' is enraged!', 'bad');
        game.fx.ring(cx, cy, '#ff6b7d', 120, { life: 0.6, width: 4 });
      }
      if (this.awayTimer > FLEE_AFTER) {
        game.toast(this.name + ' loses interest and departs…', 'info');
        game.fx.burst(cx, cy, this.color2, 30, { speed: 160, glow: true });
        this.dead = true;
        this.fled = true;
      }
    } else if (this.awayTimer > 0) {
      this.awayTimer = Math.max(0, this.awayTimer - dt * 2);
      if (this.enraged && this.awayTimer <= 0) this.enraged = false;
    }
  }

  // Burrowed / mid-teleport: invisible, untouchable, and — unlike before — not
  // dealing contact damage from a spot the player can't even see.
  _updateHidden(dt, game, target) {
    this.invuln = Math.max(this.invuln, 0.05);
    this.warnTime -= dt;
    // Dust boiling up from where it will surface, so the marker has weight.
    if (this.warnAt && Math.random() < 0.4) {
      game.fx.burst(this.warnAt.x + randRange(Math.random, -10, 10), this.warnAt.y + 8,
        this.movement === 'gravemaw' ? '#8a7358' : this.color2, 2, { speed: 40, life: 0.4, gravity: 90 });
    }
    if (this.warnTime <= 0) this._emerge(game, target);
  }

  _emerge(game, target) {
    const at = this.warnAt || (target ? { x: target.x, y: target.y - 40 } : { x: this.x, y: this.y });
    this.x = at.x - this.w / 2;
    this.y = at.y - this.h / 2;
    // Never surface inside rock.
    this._nudgeOutOfTerrain(game.world);
    this.hidden = false;
    this.warnAt = null;
    this.warnTime = 0;
    this.aiState = 'recover';
    this.recover = 0.5;
    this.vx = 0; this.vy = 0;
    const c = this.center();
    game.fx.ring(c.x, c.y, this.color2, 70, { life: 0.35, width: 3 });
    game.fx.burst(c.x, c.y, this.color2, 24, { speed: 170, glow: true, life: 0.5 });
    game.fx.shake(4, 0.3);
  }

  // Slide out of any solid tiles we ended up inside, preferring up.
  _nudgeOutOfTerrain(world) {
    if (!world.rectHitsSolid(this.x, this.y, this.w, this.h)) return;
    for (let r = 1; r <= 12; r++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]]) {
        const nx = this.x + dx * r * TILE, ny = this.y + dy * r * TILE;
        if (!world.rectHitsSolid(nx, ny, this.w, this.h)) { this.x = nx; this.y = ny; return; }
      }
    }
  }

  // No player alive: hover in place rather than freezing mid-animation.
  _drift(dt, game) {
    if (this.movement === 'gravemaw') { applyGravity(this, dt); this.vx *= 0.9; this._move(game, dt); }
    else { this.vy = Math.sin(this.spawnTime) * 12; this.y += this.vy * dt; }
  }

  _moveToward(dt, game, target, ph, speedMul) {
    const tc = target.center();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const dx = tc.x - cx;
    const speed = ph.speed * speedMul;

    if (this.movement === 'grovekeeper') {
      // Circles the player through the air, swaying vertically. The sway makes
      // the seed rain readable and gives melee players windows to close.
      const desiredY = tc.y - (this.def.floatHeight || 105) + Math.sin(this.spawnTime * 1.7) * 28;
      const orbitX = Math.sin(this.spawnTime * 0.85) * 34;
      this.vx = clamp(dx * 0.65 + orbitX, -speed, speed);
      this.vy = clamp((desiredY - cy) * 0.8, -speed, speed);
      this._flyMove(game, dt);
    } else if (this.movement === 'sovereign') {
      // Orbits, periodically dipping into melee range so the fight has a real
      // close-range answer instead of being airborne-only.
      const orbit = this.spawnTime * 0.9;
      const dive = Math.sin(orbit * 1.7) > 0.35;
      const desiredX = tc.x + Math.cos(orbit) * (dive ? 72 : 108);
      const desiredY = tc.y - (dive ? 42 : (this.def.floatHeight || 72)) + Math.sin(orbit * 1.7) * (dive ? 18 : 32);
      this.vx = clamp((desiredX - cx) * 0.9, -speed, speed);
      this.vy = clamp((desiredY - cy) * 0.9, -speed, speed);
      this._flyMove(game, dt);
    } else {
      // Gravemaw is grounded: it commits to the floor, hops ledges and gaps.
      applyGravity(this, dt);
      this.vx = Math.sign(dx) * speed;
      if (this.onGround && AI.shouldJump(this, game.world, Math.sign(dx) || this.facing)) this.vy = -340;
      this._move(game, dt);
    }
  }

  _move(game, dt) { moveAndCollide(this, game.world, dt); }

  // Flying bosses used to integrate position directly with no collision at all,
  // so they swam through solid rock. They now refuse a move that would embed
  // them and climb out of whatever they are pressed against.
  _flyMove(game, dt) {
    const world = game.world;
    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const blockedX = world.rectHitsSolid(nx, this.y, this.w, this.h);
    const blockedY = world.rectHitsSolid(this.x, ny, this.w, this.h);
    if (!blockedX) this.x = nx;
    if (!blockedY) this.y = ny;
    if (blockedX || blockedY) {
      this.vy = Math.min(this.vy, -40);
      const upY = this.y + this.vy * dt;
      if (!world.rectHitsSolid(this.x, upY, this.w, this.h)) this.y = upY;
      else this._nudgeOutOfTerrain(world);
    }
  }

  // Weighted choice among the phase's attacks: only ones off cooldown, in range,
  // and (for aimed attacks) with a clear shot.
  _chooseAttack(game, target) {
    const ph = this.phase();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const tc = target.center();
    const dist = Math.hypot(tc.x - cx, tc.y - cy);
    const los = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);

    const options = [];
    for (const a of ph.attacks) {
      if ((this.cooldowns.get(a.type) || 0) > 0) continue;
      if (a.minRange != null && dist < a.minRange) continue;
      if (a.maxRange != null && dist > a.maxRange) continue;
      if (a.needsLos && !los) continue;
      options.push(a);
    }
    if (!options.length) return null;
    let total = 0;
    for (const a of options) total += a.weight || 1;
    let r = Math.random() * total;
    for (const a of options) { r -= (a.weight || 1); if (r <= 0) return a; }
    return options[0];
  }

  // Per-frame animation state. Living here rather than in the renderer keeps it
  // tied to the simulation clock, so it looks the same at any frame rate.
  _updateAnim(dt) {
    // Squash while winding up, stretch on release, spring back to rest.
    let targetX = 1, targetY = 1;
    if (this.telegraph > 0) {
      const k = 1 - this.telegraph / (this.telegraphMax || 0.6);
      targetX = 1 + k * 0.14; targetY = 1 - k * 0.12;
    } else if (this.attackPulse > 0) {
      const k = this.attackPulse / 0.22;
      targetX = 1 - k * 0.10; targetY = 1 + k * 0.14;
    }
    const spring = 1 - Math.pow(0.0001, dt);
    this.squashX += (targetX - this.squashX) * spring;
    this.squashY += (targetY - this.squashY) * spring;

    // Gravemaw: segments trail the head with lag, so the body follows through a
    // leap instead of every piece bobbing independently. The jaw gapes on the
    // wind-up and closes on release.
    if (this.movement === 'gravemaw') {
      const headX = this.x + (this.facing > 0 ? this.w - 29 : 4);
      const headY = this.y + 12;
      const lagK = 1 - Math.pow(0.02, dt);
      const order = this.facing > 0 ? [2, 1, 0] : [0, 1, 2];
      for (let i = 0; i < 3; i++) {
        const s = this.segments[order[i]];
        const tx = headX - this.facing * i * 17;
        const ty = headY + Math.sin(this.bob + i * 0.9) * 2;
        s.x += (tx - s.x) * lagK;
        s.y += (ty - s.y) * lagK;
      }
      const jawTarget = this.telegraph > 0 ? 1 : 0;
      this.jaw += (jawTarget - this.jaw) * (1 - Math.pow(0.005, dt));
    }

    // Sovereign: shards spin up as an attack charges, and it smears at speed.
    if (this.movement === 'sovereign') {
      const rate = this.telegraph > 0 ? 5.5 : 0.7;
      this.shardSpin += dt * rate;
      this._trailTimer -= dt;
      const fast = Math.hypot(this.vx, this.vy) > 90;
      if (fast && this._trailTimer <= 0) {
        this._trailTimer = 0.05;
        this.ghostTrail.push({ x: this.x, y: this.y });
        if (this.ghostTrail.length > 5) this.ghostTrail.shift();
      } else if (!fast && this.ghostTrail.length) {
        this.ghostTrail.shift();
      }
    }
  }

  _contactDamage(game, ph) {
    if (this.hidden) return; // can't be hit by something that isn't there
    const targets = [...game.players.values()];
    for (const m of (game.minions || [])) {
      if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);
    }
    for (const p of targets) {
      if (p.alive !== false && !p.dead && aabb(this, p)) {
        const knockback = Math.sign(p.x - this.x) * 6;
        const dodged = p.isMinion && p.tryDodgeContact?.(game, this);
        if (!dodged && p.isMinion) p.takeDamage(ph.contact, knockback, game, this.name);
        else if (!dodged) game.applyEnemyDamageToPlayer(p, ph.contact, knockback);
      }
    }
  }

  _performAttack(atk, game, target) {
    this.attackPulse = 0.22;
    game.audio?.bossAttack?.(atk.type);
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const tc = target.center();
    const color = PROJ_COLOR[atk.projKind] || '#ffffff';
    switch (atk.type) {
      case 'seedRain': {
        const n = atk.count || 3;
        for (let i = 0; i < n; i++) {
          const x = tc.x + (i - (n - 1) / 2) * (atk.spread || 42);
          game.addProjectile(new Projectile({
            x, y: tc.y - 170 - Math.random() * 35, vx: 0, vy: atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5,
            w: 5, h: 10, trail: color,
          }), true);
        }
        break;
      }
      case 'vineBurst': {
        const n = atk.count || 5;
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 4,
          }), true);
        }
        game.fx.ring(cx, cy, color, 50, { life: 0.3, width: 2 });
        break;
      }
      case 'shockwave': {
        const y = this.y + this.h - 7;
        for (const dir of [-1, 1]) {
          game.addProjectile(new Projectile({
            x: cx, y, vx: dir * atk.speed, vy: 0, w: 14, h: 6,
            damage: atk.damage, ownerType: 'boss', kind: 'shock', color: '#d3b985', life: 3,
          }), true);
        }
        game.fx.ring(cx, y, '#d3b985', 54, { life: 0.3, width: 3 });
        game.fx.burst(cx, y, '#a08a68', 14, { speed: 140, gravity: 480 });
        game.fx.shake(4, 0.3);
        break;
      }
      case 'crystalRing': {
        const n = atk.count || 8;
        const offset = this.spawnTime * 0.7;
        for (let i = 0; i < n; i++) {
          const a = offset + (i / n) * Math.PI * 2;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5,
            w: 7, h: 7, destructible: true,
          }), true);
        }
        break;
      }
      case 'teleport': {
        // Vanish, mark the destination, then arrive. The marker is the whole
        // point: a teleport you cannot see coming is not a mechanic.
        this.hidden = true;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.warnAt = {
          x: tc.x + side * 185,
          y: tc.y - (this.def.floatHeight || 120) - 10 + this.h / 2,
        };
        this.warnMax = 0.62; this.warnTime = 0.62;
        game.fx.burst(cx, cy, this.color2, 22, { speed: 150, glow: true });
        break;
      }
      case 'leap': {
        const dir = Math.sign(tc.x - cx) || this.facing;
        this.charge = { time: 0.78, vx: dir * atk.speed, vy: -390, airborne: true };
        this.vy = -390;
        game.fx.burst(cx, this.y + this.h, '#a08a68', 12, { speed: 120, gravity: 420 });
        break;
      }
      case 'volley': {
        const base = angleTo(cx, cy, tc.x, tc.y);
        const n = atk.count;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * (atk.spread / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5, trail: color,
          }), true);
        }
        break;
      }
      case 'sweep': {
        const n = atk.count;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5,
          }), true);
        }
        break;
      }
      case 'homingBarrage': {
        for (let i = 0; i < atk.count; i++) {
          const a = angleTo(cx, cy, tc.x, tc.y) + randRange(Math.random, -0.8, 0.8);
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5, homing: true,
            homingStrength: 1.8, destructible: true, trail: color,
          }), true);
        }
        break;
      }
      case 'rockthrow': {
        const n = atk.count || 1;
        for (let i = 0; i < n; i++) {
          const spread = (atk.spread || 0);
          const a = angleTo(cx, cy, tc.x, tc.y) - 0.4 + (i - (n - 1) / 2) * spread;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed - 120,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, gravity: true, life: 6,
          }), true);
        }
        break;
      }
      case 'charge': {
        const a = angleTo(cx, cy, tc.x, tc.y);
        this.charge = { time: 0.55, vx: Math.cos(a) * atk.speed, vy: Math.sin(a) * atk.speed };
        break;
      }
      case 'burrow': {
        this.hidden = true;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.warnAt = { x: tc.x + side * 80, y: tc.y + 10 };
        this.warnMax = 1.0; this.warnTime = 1.0;
        game.fx.burst(cx, this.y + this.h, '#8a7358', 20, { speed: 130, gravity: 400 });
        game.fx.shake(3, 0.3);
        break;
      }
      case 'spawnAdds': {
        game.spawnBossAdds(atk.enemy, atk.addCount, this.x, this.y);
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
    this.chosen = null;
    this.charge = null;
    this.aiState = 'recover';
    this.recover = 0.35;
    if (!wasFrozen) {
      const c = this.center();
      game?.fx?.ring(c.x, c.y, '#61eaff', Math.max(this.w, this.h) * 0.75, { life: 0.4, width: 3 });
      game?.fx?.burst(c.x, c.y, ['#dffcff', '#61eaff', '#2b8fff'], 22, {
        speed: 120, life: 0.55, gravity: -20, glow: true, size: 2,
      });
      game?.floatText?.(c.x, this.y - 10, 'FROZEN', '#bffcff');
    }
  }

  takeDamage(amount, game, crit) {
    if (this.dead || this.invuln > 0 || this.hidden) return;
    this.hp -= amount;
    this.hurtFlash = 0.1;
    if (game) game.floatText(this.x + this.w / 2, this.y, Math.round(amount) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      if (game) { this._deathThroes(game); game.onBossDeath(this); }
    }
  }

  // A boss should not simply blink out of existence.
  _deathThroes(game) {
    const c = this.center();
    game.fx.shake(9, 0.8);
    game.fx.ring(c.x, c.y, '#ffffff', 140, { life: 0.5, width: 5 });
    game.fx.ring(c.x, c.y, this.color2, 190, { life: 0.75, width: 3 });
    game.fx.burst(c.x, c.y, [this.color2, '#ffffff', this.color], 60, { speed: 260, life: 0.9, glow: true, gravity: 90 });
    game.fx.smoke(c.x, c.y, '#3a3340', 14, { jitter: 30 });
  }

  netState() {
    return {
      key: this.key, name: this.name, difficulty: this.difficulty, x: Math.round(this.x), y: Math.round(this.y),
      hp: Math.round(this.hp), maxHp: this.maxHp, phase: this.phaseIndex, facing: this.facing,
      state: this.aiState, hidden: this.hidden ? 1 : 0, tel: this.telegraph > 0 ? 1 : 0, frz: Math.round((this.freezeT || 0) * 100) / 100,
    };
  }
}
