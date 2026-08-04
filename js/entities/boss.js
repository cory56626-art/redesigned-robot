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
import { TILE, normalizeDifficulty } from '../config.js?v=worm-surface-2';
import { BOSSES } from '../data/bosses.js?v=worm-surface-2';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=worm-surface-2';
import { aabb, angleTo, randRange, clamp } from '../utils.js?v=worm-surface-2';
import { Projectile } from './projectile.js?v=worm-surface-2';
import * as AI from '../systems/ai.js?v=worm-surface-2';

const PROJ_COLOR = {
  thorn: '#7ee08a', rock: '#8a7a5a', blight: '#c58bff', voidorb: '#b06bff',
  mechMissile: '#ffad55', mechPlasma: '#78e9ff', mechShock: '#ffd36d',
  wormSpit: '#ca8cff', wormQuake: '#d8a6ff',
};

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
      if (out.blastDamage != null && out.blastDamage > 0) out.blastDamage = Math.max(1, Math.round(out.blastDamage * tuning.damage));
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
    this.stepHeight = d.stepHeight || 0;
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
    // The Worm is visibly large but still fights in natural cave geometry.
    // These timers turn a bad wall collision or a player hiding behind stone
    // into a telegraphed burrow rather than a free, stuck target.
    this.wormBlockedTime = 0;
    this.wormNoSightTime = 0;
    this.wormBurrowCooldown = 0;
    // A target that seals itself into a one-tile bunker has no body-sized
    // pocket for the Worm to emerge from. In that specific situation it uses
    // a warned seismic strike instead of endlessly failing a burrow attempt.
    this.wormBreach = null;
    this.wormBreachSeen = false;
    this.warnKind = null;

    // ---- Enrage / leash ----
    this.awayTimer = 0;
    this.enraged = false;

    // ---- Animation ----
    this.squashX = 1; this.squashY = 1;
    this.jaw = 0;
    this.shardSpin = 0;
    this.segments = [];
    const segmentCount = Math.max(0, d.segmentCount != null ? d.segmentCount : 3);
    const segmentLength = d.segmentLength || 17;
    for (let i = 0; i < segmentCount; i++) this.segments.push({ x: x + 4 + i * segmentLength, y: y + 12 });
    this.ghostTrail = [];
    this._trailTimer = 0;
    // The Mech animation state lives here with the other boss state, so its
    // feet, hatches, arms and cannon look the same at every frame rate.
    this.walkCycle = 0;
    this.mechArmOpen = 0;
    this.mechRayCharge = 0;
    this.mechJumpCharge = 0;
    this.mechHeat = 0;
    this.mechLanding = 0;
    this.mechRay = null;
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
      // Phase changes are a clean reset, never a surprise continuation of a
      // ray or leap that was chosen under the old pattern.
      this.charge = null;
      this.mechRay = null;
      game.toast(`${this.name}: ${this.phase().name}!`, 'bad');
      const c = this.center();
      game.fx.ring(c.x, c.y, this.color2, 90, { life: 0.55, width: 4 });
      game.fx.burst(c.x, c.y, this.color2, 28, { speed: 200, glow: true, life: 0.6 });
      game.fx.shake(6, 0.5);
    }
  }

  update(dt, game) {
    // Death is resolved by the game loop after this frame. Never let a zero-HP
    // boss enter a new phase or fire one more attack during that short gap.
    if (this.dead) return;
    this.spawnTime += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackPulse > 0) this.attackPulse -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.freezeT > 0) {
      this.freezeT = Math.max(0, this.freezeT - dt);
      this.vx = 0;
      this.vy = 0;
      this._updateAnim(dt, game);
      return;
    }
    this.bob += dt * 3;
    for (const [k, v] of this.cooldowns) if (v > 0) this.cooldowns.set(k, v - dt);
    if (this.movement === 'worm' && this.wormBurrowCooldown > 0) {
      this.wormBurrowCooldown = Math.max(0, this.wormBurrowCooldown - dt);
    }
    this._updatePhase(game);

    const target = game.nearestHostileTarget
      ? game.nearestHostileTarget(this.x + this.w / 2, this.y + this.h / 2)
      : game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    this._updateLeash(dt, game, target);
    if (this.dead) return; // fled

    if (this.hidden) { this._updateHidden(dt, game, target); this._updateAnim(dt, game); return; }
    if (!target) { this._drift(dt, game); this._updateAnim(dt, game); return; }

    const ph = this.phase();
    const speedMul = this.enraged ? this.tuning.enrageMove : 1;
    const tc = target.center();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    // Plasma Ray locks the chassis in place. Its two hands and cannon are the
    // only parts that sweep toward the target, which keeps the tell legible.
    if (!this.mechRay) this.facing = tc.x < cx ? -1 : 1;

    // A committed charge or leap overrides everything until it expires.
    if (this.charge) {
      if (this.charge.kind === 'mechJump') {
        this._updateMechJump(dt, game, target, ph);
        clampToWorld(this, game.world);
        this._updateAnim(dt, game);
        this._contactDamage(game, ph);
        return;
      }
      this.charge.time -= dt;
      if (this.movement === 'gravemaw' || this.movement === 'worm') {
        applyGravity(this, dt);
        const requestedVx = this.charge.vx;
        this.vx = requestedVx;
        this._move(game, dt);
        if (this._tryWormTunnelRecovery(dt, game, target, requestedVx)) {
          clampToWorld(this, game.world);
          this._updateAnim(dt, game);
          return;
        }
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
      if (this.charge.time <= 0) {
        const recover = this.charge.recover != null ? this.charge.recover : 0.4;
        this.charge = null; this.aiState = 'recover'; this.recover = recover;
      }
      this._updateAnim(dt, game);
      this._contactDamage(game, ph);
      return;
    }

    // During the Plasma Ray, the chassis stays planted and facing its original
    // direction. Only the two arms and their cannon track the player.
    if (this.mechRay) {
      this._updateMechRay(dt, game, target, ph);
      clampToWorld(this, game.world);
      this._updateAnim(dt, game);
      this._contactDamage(game, ph);
      return;
    }

    this.stateTime += dt;
    switch (this.aiState) {
      case 'telegraph': {
        // Wind-up: slow to a hover so the tell is readable, then commit.
        if (this._moveToward(dt, game, target, ph, speedMul * 0.35)) break;
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
        if (this._moveToward(dt, game, target, ph, speedMul * 0.6)) break;
        this.recover -= dt;
        if (this.recover <= 0) { this.aiState = 'reposition'; this.stateTime = 0; }
        break;
      }
      default: { // reposition
        this.aiState = 'reposition';
        if (this._moveToward(dt, game, target, ph, speedMul)) break;
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
    this._updateAnim(dt, game);
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
        this.movement === 'gravemaw' ? '#8a7358' : this.movement === 'worm' ? '#513463' : this.color2,
        2, { speed: 40, life: 0.4, gravity: 90 });
    }
    if (this.warnTime <= 0) {
      if (this.movement === 'worm' && this.wormBreach) this._resolveWormBreach(game);
      else this._emerge(game, target);
    }
  }

  _emerge(game, target) {
    const at = this.warnAt || (target ? { x: target.x, y: target.y - 40 } : { x: this.x, y: this.y });
    const before = { x: this.x, y: this.y };
    this.x = at.x - this.w / 2;
    this.y = at.y - this.h / 2;
    // Never surface inside rock.
    const escaped = this._nudgeOutOfTerrain(game.world);
    if (!escaped && game.world.rectHitsSolid(this.x, this.y, this.w, this.h) && this.movement === 'worm') {
      // Terrain can change between the warning and the emergence. Keep the
      // Worm hidden and show a fresh marker instead of popping into a wall.
      const retry = this._findWormBurrowSpot(game.world, target, this.facing || 1, 156);
      if (retry) {
        this.x = before.x; this.y = before.y;
        this.warnAt = retry;
        this.warnKind = 'emerge';
        this.warnMax = 0.58;
        this.warnTime = this.warnMax;
        return;
      }
      // A fully sealed cave should never turn the boss into a permanent
      // statue. Return to its last known position and give the player another
      // warning while it tries again on the next emerge frame.
      this.x = before.x; this.y = before.y;
      this.warnAt = { x: before.x + this.w / 2, y: before.y + this.h / 2 };
      this.warnKind = 'emerge';
      this.warnMax = 0.5;
      this.warnTime = this.warnMax;
      return;
    }
    this.hidden = false;
    this.warnAt = null;
    this.warnTime = 0;
    this.warnKind = null;
    this.wormBreach = null;
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
    if (!world.rectHitsSolid(this.x, this.y, this.w, this.h)) return true;
    for (let r = 1; r <= 12; r++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1]]) {
        const nx = this.x + dx * r * TILE, ny = this.y + dy * r * TILE;
        if (!world.rectHitsSolid(nx, ny, this.w, this.h)) { this.x = nx; this.y = ny; return true; }
      }
    }
    return false;
  }

  // No player alive: hover in place rather than freezing mid-animation.
  _drift(dt, game) {
    if (this.movement === 'gravemaw' || this.movement === 'worm' || this.movement === 'mech') { applyGravity(this, dt); this.vx *= 0.9; this._move(game, dt); }
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
    } else if (this.movement === 'mech') {
      // The Mech has a slow, weighty stride. It keeps a little standoff room
      // for its arm weapons rather than permanently sitting on the player.
      applyGravity(this, dt);
      const distX = Math.abs(dx);
      const dir = Math.sign(dx) || this.facing;
      const standOff = this.phaseIndex > 0 ? 86 : 102;
      if (distX > standOff) this.vx = dir * speed;
      else if (distX < 54) this.vx = -dir * speed * 0.32;
      else this.vx = 0;
      if (this.onGround && this.vx && AI.shouldJump(this, game.world, Math.sign(this.vx))) this.vy = -345;
      this._move(game, dt);
    } else if (this.movement === 'worm') {
      // The Worm still walks and jumps in an open tunnel, but it does not
      // remain a harmless wall ornament if natural cave geometry blocks it.
      applyGravity(this, dt);
      const dir = Math.sign(dx) || this.facing || 1;
      const requestedVx = dir * speed;
      this.vx = requestedVx;
      if (this.onGround && AI.shouldJump(this, game.world, dir)) this.vy = -370;
      this._move(game, dt);
      return this._tryWormTunnelRecovery(dt, game, target, requestedVx);
    } else {
      // Gravemaw is grounded: it commits to the floor, hops ledges and gaps.
      applyGravity(this, dt);
      this.vx = Math.sign(dx) * speed;
      if (this.onGround && AI.shouldJump(this, game.world, Math.sign(dx) || this.facing)) this.vy = -340;
      this._move(game, dt);
    }
    return false;
  }

  _move(game, dt) { moveAndCollide(this, game.world, dt); }

  // A worm should be dangerous in caves, not immobilised by them. A short wall
  // collision or sustained lack of sight starts a visibly warned reposition;
  // the cooldown prevents it from chain-burrowing with no player response.
  _tryWormTunnelRecovery(dt, game, target, requestedVx = 0) {
    if (this.movement !== 'worm' || this.hidden || !target) return false;
    const c = this.center();
    const tc = target.center();
    const dist = Math.hypot(tc.x - c.x, tc.y - c.y);
    const blocked = this.hitWallX && Math.abs(requestedVx) > 12 && Math.abs(tc.x - c.x) > 42;
    const hasLos = game.world.hasLineOfSight(c.x, c.y, tc.x, tc.y);
    this.wormBlockedTime = blocked ? this.wormBlockedTime + dt : Math.max(0, this.wormBlockedTime - dt * 2.4);
    this.wormNoSightTime = !hasLos && dist > 96
      ? this.wormNoSightTime + dt
      : Math.max(0, this.wormNoSightTime - dt * 2);
    if (this.wormBurrowCooldown > 0) return false;

    let reason = null;
    if (this.wormBlockedTime >= 0.46) reason = 'blocked';
    else if (this.wormNoSightTime >= 1.35) reason = 'hidden';
    if (!reason) return false;

    // Being unable to see the player is no longer a safe bunker strategy.
    // The strike locks onto the warned *location*, not the player, so stepping
    // or mining out before it erupts is a real dodge. It deliberately does
    // not delete blocks or force the Worm's large collision body into a tiny
    // player tunnel.
    if (reason === 'hidden') {
      return this._beginWormBreach(game, target, {
        warnTime: this.phaseIndex > 0 ? 0.78 : 0.96,
        cooldown: this.phaseIndex > 0 ? 3.05 : 3.45,
        damage: this.phaseIndex > 0 ? 22 : 18,
      });
    }

    const side = Math.sign(tc.x - c.x) || this.facing || 1;
    return this._beginWormBurrow(game, target, {
      side,
      preferredDistance: 132,
      warnTime: 0.78,
      cooldown: 2.25,
    });
  }

  // Find a body-sized air pocket near the target. Grounded spots are scored
  // first so the Worm emerges into a real fight instead of falling forever,
  // but a clear mid-air pocket remains a safe fallback in rough cave layouts.
  _findWormBurrowSpot(world, target, side = 1, preferredDistance = 156) {
    if (!target) return null;
    const tc = target.center();
    const primary = Math.sign(side) || 1;
    const directions = [primary, -primary];
    const distances = [...new Set([preferredDistance, 112, 156, 204, 252, 300, 348, 396, 460, 524])];
    const yOffsets = [-TILE * 5, -TILE * 3, -TILE, 0, TILE * 2, TILE * 4, TILE * 6];
    const minCenterX = this.w / 2 + 2;
    const maxCenterX = world.width * TILE - this.w / 2 - 2;
    let grounded = null;
    let airborne = null;

    for (const dir of directions) {
      for (const distance of distances) {
        const centerX = clamp(tc.x + dir * distance, minCenterX, maxCenterX);
        const x = Math.round(centerX - this.w / 2);
        for (const yOffset of yOffsets) {
          const y = Math.round(tc.y - this.h / 2 + yOffset);
          if (world.rectHitsSolid(x, y, this.w, this.h)) continue;
          const floorGap = this._wormFloorGap(world, x, y);
          const score = Math.abs(distance - preferredDistance) * 0.24 + Math.abs(yOffset) * 0.68
            + (dir === primary ? 0 : 28) + (Number.isFinite(floorGap) ? floorGap * 0.4 : 180);
          const candidate = { x: centerX, y: y + this.h / 2, score };
          if (Number.isFinite(floorGap) && floorGap <= TILE * 4) {
            if (!grounded || candidate.score < grounded.score) grounded = candidate;
          } else if (!airborne || candidate.score < airborne.score) {
            airborne = candidate;
          }
        }
      }
    }
    const chosen = grounded || airborne;
    return chosen ? { x: chosen.x, y: chosen.y } : null;
  }

  _wormFloorGap(world, x, y) {
    for (let gap = 0; gap <= TILE * 5; gap += 4) {
      if (world.rectHitsSolid(x, y + this.h + gap, this.w, 4)) return gap;
    }
    return Infinity;
  }

  _beginWormBurrow(game, target, options = {}) {
    const c = this.center();
    const tc = target && target.center ? target.center() : c;
    const side = options.side || Math.sign(tc.x - c.x) || this.facing || 1;
    const at = this._findWormBurrowSpot(game.world, target, side, options.preferredDistance || 156);
    if (!at) return false;
    this.hidden = true;
    this.charge = null;
    this.telegraph = 0;
    this.vx = 0; this.vy = 0;
    this.warnAt = at;
    this.warnKind = 'emerge';
    this.warnMax = options.warnTime || 0.92;
    this.warnTime = this.warnMax;
    this.wormBreach = null;
    this.wormBurrowCooldown = options.cooldown != null ? options.cooldown : 1.35;
    this.wormBlockedTime = 0;
    this.wormNoSightTime = 0;
    this.aiState = 'recover';
    this.stateTime = 0;
    this.recover = options.recover != null ? options.recover : 0.5;
    game.fx.burst(c.x, this.y + this.h, '#513463', 20, { speed: 130, gravity: 400 });
    game.fx.shake(3, 0.3);
    return true;
  }

  // The anti-bunker answer. The marker is deliberately placed on the current
  // target location and remains fixed during the warning, which means an open
  // player can step away while a 1x1 hideout is no longer free damage.
  _beginWormBreach(game, target, options = {}) {
    if (!target || !target.center) return false;
    const c = this.center();
    const tc = target.center();
    const at = { x: tc.x, y: tc.y };
    this.hidden = true;
    this.charge = null;
    this.telegraph = 0;
    this.vx = 0; this.vy = 0;
    this.warnAt = at;
    this.warnKind = 'wormBreach';
    this.warnMax = options.warnTime || 0.96;
    this.warnTime = this.warnMax;
    this.wormBreach = {
      x: at.x,
      y: at.y,
      damage: Math.max(1, Math.round(options.damage || (this.phaseIndex > 0 ? 22 : 18))),
    };
    this.wormBurrowCooldown = options.cooldown != null ? options.cooldown : 3.35;
    this.wormBlockedTime = 0;
    this.wormNoSightTime = 0;
    this.aiState = 'recover';
    this.stateTime = 0;
    this.recover = options.recover != null ? options.recover : 0.7;
    if (!this.wormBreachSeen) {
      game.toast?.('The Worm senses you through the stone!', 'bad');
      this.wormBreachSeen = true;
    }
    game.fx.ring(at.x, at.y, '#dba8ff', 36, { life: this.warnMax, from: 14, width: 2.5 });
    game.fx.burst(c.x, this.y + this.h, '#513463', 16, { speed: 118, gravity: 400 });
    game.fx.shake(2.6, 0.22);
    return true;
  }

  _resolveWormBreach(game) {
    const breach = this.wormBreach;
    if (!breach) return;
    // This is a short-lived, terrain-ignoring hitbox. It exists only at the
    // warned fissure, so it cannot chase or hit a player who escaped the mark.
    game.addProjectile(new Projectile({
      x: breach.x - 18, y: breach.y - 23,
      vx: 0, vy: 0, w: 36, h: 46,
      damage: breach.damage, ownerType: 'boss', kind: 'wormFissure', color: '#e8c7ff',
      life: 0.16, knockback: 0, ignoreTerrain: true,
    }), true);
    game.fx.ring(breach.x, breach.y, '#efd5ff', 48, { life: 0.3, width: 3 });
    game.fx.burst(breach.x, breach.y, ['#e8c7ff', '#a75edb', '#45245b'], 22, {
      speed: 165, life: 0.44, size: 2.4, glow: true,
    });
    game.fx.shake(4.4, 0.28);
    this.hidden = false;
    this.warnAt = null;
    this.warnTime = 0;
    this.warnKind = null;
    this.wormBreach = null;
    this.aiState = 'recover';
    this.recover = Math.max(this.recover || 0, 0.72);
    this.vx = 0; this.vy = 0;
  }

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
      if (a.when === 'airOrFar') {
        const airborne = target.onGround === false || Math.abs(target.vy || 0) > 95;
        if (!airborne && dist < (a.triggerRange || 240)) continue;
      }
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
  _updateAnim(dt, game) {
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

    // Gravemaw.
    //
    // The head is now the *first link of the chain* rather than a separate
    // thing drawn from the bounding box, and each following segment is pulled
    // toward its predecessor and then constrained to a fixed link length. That
    // constraint is the whole difference: without it the segments merely eased
    // toward offsets computed from the box, so the body slid around
    // independently of the head and the creature came apart whenever it moved.
    if (this.movement === 'gravemaw' || this.movement === 'worm') {
      this.headX = this.x + (this.facing > 0 ? this.w - 20 : 20);
      this.headY = this.y + 20;

      const LINK = this.def.segmentLength || 15;
      const lagK = 1 - Math.pow(0.0006, dt);
      let px = this.headX, py = this.headY;
      for (let i = 0; i < this.segments.length; i++) {
        const s = this.segments[i];
        // Follow the previous link...
        s.x += (px - s.x) * lagK;
        s.y += (py - s.y) * lagK;
        // ...then hold the link length exactly, so the body can arc behind a
        // leap and swing through a turn without ever detaching.
        const dx = s.x - px, dy = s.y - py;
        const d = Math.hypot(dx, dy) || 1;
        s.x = px + (dx / d) * LINK;
        s.y = py + (dy / d) * LINK;
        // A gentle undulation along the body, strongest at the tail.
        s.y += Math.sin(this.bob * 1.6 + i * 1.1) * (0.5 + i * 0.35);
        s.angle = Math.atan2(s.y - py, s.x - px);
        px = s.x; py = s.y;
      }

      // Anticipation and impact. The jaw snaps shut rather than easing, and
      // landing squashes the body — a heavy creature has to look heavy.
      const jawTarget = this.telegraph > 0 ? 1 : 0;
      if (jawTarget > this.jaw) {
        this.jaw += (jawTarget - this.jaw) * (1 - Math.pow(0.02, dt)); // gape open
      } else {
        this.jaw = Math.max(0, this.jaw - dt * 9);                      // snap shut
      }

      // Crouch during a wind-up, so the leap has a visible gather before it.
      const crouchTarget = this.telegraph > 0 ? 1 : 0;
      this.crouch = (this.crouch || 0) + (crouchTarget - (this.crouch || 0)) * (1 - Math.pow(0.02, dt));

      const wasAir = this._wasAirborne;
      this._wasAirborne = !this.onGround;
      if (wasAir && this.onGround) {
        // Landing: squash, shake and a burst of dust at the feet.
        this.squashX = 1.35; this.squashY = 0.68;
        game?.fx?.shake?.(2.4, 0.16);
        game?.fx?.burst?.(this.x + this.w / 2, this.y + this.h,
          this.movement === 'worm' ? '#513463' : '#8a7358', 12, { speed: 120, life: 0.5, size: 2.4, gravity: 220 });
      }
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

    if (this.movement === 'mech') {
      const moving = Math.abs(this.vx || 0) > 5 && this.onGround;
      this.walkCycle += dt * (moving ? 5.2 : 0.65);
      const telegraphType = this.chosen && this.chosen.type;
      const ease = 1 - Math.pow(0.01, dt);
      const armTarget = (this.telegraph > 0 && telegraphType === 'mechMissile') ? 1 : 0;
      const rayTarget = this.mechRay ? 1 : (this.telegraph > 0 && telegraphType === 'plasmaRay' ? 0.72 : 0);
      const jumpTarget = (this.telegraph > 0 && telegraphType === 'mechJump') ? 1 : 0;
      this.mechArmOpen += (armTarget - this.mechArmOpen) * ease;
      this.mechRayCharge += (rayTarget - this.mechRayCharge) * ease;
      this.mechJumpCharge += (jumpTarget - this.mechJumpCharge) * ease;
      this.mechHeat += ((this.phaseIndex > 0 ? 1 : 0) - this.mechHeat) * (1 - Math.pow(0.12, dt));
      this.mechLanding = Math.max(0, this.mechLanding - dt * 2.8);
    }
  }

  _mechMissileMuzzle() {
    const f = this.facing || 1;
    return { x: this.x + this.w / 2 + f * 47, y: this.y + 37 };
  }

  _mechRayMuzzle(angle) {
    const cx = this.x + this.w / 2;
    const cy = this.y + 42;
    return { x: cx + Math.cos(angle) * 45, y: cy + Math.sin(angle) * 45 };
  }

  _updateMechJump(dt, game, target, ph) {
    const jump = this.charge;
    jump.elapsed = (jump.elapsed || 0) + dt;
    const tc = target.center();
    const cx = this.x + this.w / 2;
    // A slight steer in the air makes it land near a jumping/far target while
    // preserving a real ballistic arc. It never gains lift after launch.
    const desired = clamp((tc.x - cx) * 1.35, -jump.speed, jump.speed);
    this.vx += (desired - this.vx) * Math.min(1, dt * 3.1);
    applyGravity(this, dt);
    this._move(game, dt);

    const landed = jump.airborne && this.onGround && jump.elapsed > 0.18;
    if (!landed) return;
    jump.airborne = false;
    this.mechLanding = 1;
    const impactX = this.x + this.w / 2;
    const impactY = this.y + this.h;
    game.fx.ring(impactX, impactY, '#ffd36d', 96, { life: 0.38, width: 4 });
    game.fx.burst(impactX, impactY, ['#8a9aab', '#ffbd66', '#72ddff'], 30, {
      speed: 210, life: 0.62, size: 2.5, gravity: 580, glow: true,
    });
    game.fx.shake(8, 0.48);
    // Overdrive gets one extra readable punishment: low ground shockwaves.
    // They travel on the floor and leave time to jump them.
    if (this.phaseIndex > 0) {
      for (const dir of [-1, 1]) {
        game.addProjectile(new Projectile({
          x: impactX, y: impactY - 7, vx: dir * 225, vy: 0, w: 16, h: 7,
          damage: Math.max(1, Math.round(ph.contact * 0.5)), ownerType: 'boss',
          kind: 'mechShock', color: '#ffd36d', life: 1.5, trail: '#ffca70',
        }), true);
      }
    }
    this.charge = null;
    this.aiState = 'recover';
    this.recover = Math.max(0.62, jump.recover || 0.8);
  }

  _updateMechRay(dt, game, target, ph) {
    const ray = this.mechRay;
    ray.time -= dt;
    // The body remains grounded and does not re-face while the arms sweep.
    this.vx = 0;
    applyGravity(this, dt);
    this._move(game, dt);

    const origin = this._mechRayMuzzle(ray.angle);
    const tc = target.center();
    const desired = angleTo(origin.x, origin.y, tc.x, tc.y);
    let diff = desired - ray.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ray.angle += clamp(diff, -ray.turnRate * dt, ray.turnRate * dt);

    ray.fireT -= dt;
    while (ray.fireT <= 0 && ray.time > 0) {
      ray.fireT += ray.fireInterval;
      const muzzle = this._mechRayMuzzle(ray.angle);
      game.addProjectile(new Projectile({
        x: muzzle.x - 5, y: muzzle.y - 3,
        vx: Math.cos(ray.angle) * ray.projSpeed, vy: Math.sin(ray.angle) * ray.projSpeed,
        w: 10, h: 6, damage: ray.damage, ownerType: 'boss', kind: 'mechPlasma',
        color: '#78e9ff', life: 1.55, trail: '#79eaff', knockback: 4,
      }), true);
      game.fx.streak(muzzle.x, muzzle.y, ray.angle, '#d9fbff', 3, { speed: 280, life: 0.10, size: 1.6 });
    }

    if (ray.time > 0) return;
    this.mechRay = null;
    this.aiState = 'recover';
    this.recover = ray.recover;
  }

  _contactDamage(game, ph) {
    if (this.hidden) return; // can't be hit by something that isn't there
    const targets = [...game.players.values()];
    for (const npc of (game.npcs || (game.npc ? [game.npc] : []))) {
      if (npc && npc.alive) targets.push(npc);
    }
    for (const m of (game.minions || [])) {
      if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);
    }
    for (const p of targets) {
      if (p.alive !== false && !p.dead && aabb(this, p)) {
        const knockback = Math.sign(p.x - this.x) * 6;
        const dodged = p.isMinion && p.tryDodgeContact?.(game, this);
        if (!dodged && (p.kind || p.isMinion)) p.takeDamage(ph.contact, knockback, game, this.name);
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
      case 'wormCharge': {
        const dir = Math.sign(tc.x - cx) || this.facing || 1;
        this.charge = {
          kind: 'wormCharge', time: atk.duration || 0.78, vx: dir * (atk.speed || 340), vy: 0,
          recover: atk.recover != null ? atk.recover : 0.78,
        };
        this.vx = this.charge.vx;
        game.fx.burst(cx, this.y + this.h - 4, ['#4c315e', '#b776f2', '#efceff'], 16, {
          speed: 150, life: 0.46, gravity: 460, size: 2.1, glow: true,
        });
        game.fx.shake(3.2, 0.2);
        break;
      }
      case 'wormSpit': {
        const mouth = { x: cx + (this.facing || 1) * 34, y: this.y + 23 };
        const base = angleTo(mouth.x, mouth.y, tc.x, tc.y);
        const n = atk.count || 3;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * ((atk.spread || 0.45) / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: mouth.x - 5, y: mouth.y - 5,
            vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed - 72,
            w: 10, h: 10, damage: atk.damage, ownerType: 'boss', kind: 'wormSpit',
            color: '#ca8cff', gravity: true, life: 2.8, trail: '#b96cf0', knockback: 4,
            effect: { poison: atk.poison || 1.8 },
          }), true);
        }
        game.fx.ring(mouth.x, mouth.y, '#dba8ff', 28, { life: 0.22, width: 2 });
        game.fx.burst(mouth.x, mouth.y, ['#e5bdff', '#a85de3', '#4a2c5d'], 10, { speed: 112, life: 0.36, glow: true });
        break;
      }
      case 'burrow': {
        const side = Math.random() < 0.5 ? -1 : 1;
        if (this.movement === 'worm') {
          this._beginWormBurrow(game, target, {
            side,
            preferredDistance: atk.burrowOffset || 120,
            warnTime: atk.burrowTime || 1.0,
            cooldown: 1.2,
            recover: atk.recover != null ? atk.recover : 0.5,
          });
        } else {
          this.hidden = true;
          this.warnAt = { x: tc.x + side * (atk.burrowOffset || 80), y: tc.y + (atk.burrowY || 10) };
          this.warnMax = atk.burrowTime || 1.0; this.warnTime = this.warnMax;
          game.fx.burst(cx, this.y + this.h, '#8a7358', 20, { speed: 130, gravity: 400 });
          game.fx.shake(3, 0.3);
        }
        break;
      }
      case 'wormQuake': {
        const y = this.y + this.h - 7;
        for (const dir of [-1, 1]) {
          game.addProjectile(new Projectile({
            x: cx, y, vx: dir * atk.projSpeed, vy: 0, w: 18, h: 9,
            damage: atk.damage, ownerType: 'boss', kind: 'wormQuake', color: '#d8a6ff',
            life: 2.0, trail: '#a75edb', knockback: 5,
          }), true);
        }
        game.fx.ring(cx, y, '#d8a6ff', 64, { life: 0.34, width: 3 });
        game.fx.burst(cx, y, ['#4b315d', '#c383ff', '#e8ccff'], 18, { speed: 145, life: 0.45, gravity: 420, glow: true });
        game.fx.shake(4.2, 0.3);
        break;
      }
      case 'spawnAdds': {
        game.spawnBossAdds(atk.enemy, atk.addCount, this.x, this.y);
        break;
      }
      case 'mechMissile': {
        const n = atk.count || 1;
        const muzzle = this._mechMissileMuzzle();
        const base = angleTo(muzzle.x, muzzle.y, tc.x, tc.y);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * 0.16;
          game.addProjectile(new Projectile({
            x: muzzle.x - 7, y: muzzle.y - 4,
            vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            w: 14, h: 8, damage: atk.damage, ownerType: 'boss', kind: 'mechMissile',
            color: '#ffad55', life: 5.1, homing: true, homingTargetId: target.id || target.netId || null,
            homingStrength: atk.homingStrength || 1.8, destructible: true, trail: '#ffbf62',
            burstDelay: 5, blastRadius: atk.blastRadius || 46, blastDamage: atk.blastDamage || 24,
          }), true);
        }
        this.mechArmOpen = 1;
        game.fx.burst(muzzle.x, muzzle.y, ['#ffca78', '#fff2c2', '#5f7896'], 10, { speed: 150, life: 0.35, glow: true });
        break;
      }
      case 'mechJump': {
        const dir = Math.sign(tc.x - cx) || this.facing;
        this.charge = {
          kind: 'mechJump', airborne: true, elapsed: 0, speed: atk.speed || 270,
          recover: atk.recover || 0.8,
        };
        this.vx = dir * Math.min(atk.speed || 270, 180);
        this.vy = -820;
        game.audio?.bossAttack?.('leap');
        game.fx.burst(cx, this.y + this.h, ['#8092a6', '#ffbf69'], 18, { speed: 170, life: 0.5, gravity: 520, size: 2.2 });
        game.fx.shake(4, 0.24);
        break;
      }
      case 'plasmaRay': {
        const a = angleTo(cx, this.y + 42, tc.x, tc.y);
        this.mechRay = {
          time: atk.duration || 1.55,
          recover: atk.recover || 0.8,
          angle: a,
          turnRate: atk.turnRate || 1.4,
          fireInterval: atk.fireInterval || 0.14,
          fireT: 0.08,
          damage: atk.damage,
          projSpeed: atk.projSpeed,
        };
        break;
      }
      case 'mechVolley': {
        const f = this.facing || 1;
        const shoulder = { x: cx + f * 30, y: this.y + 25 };
        const base = angleTo(shoulder.x, shoulder.y, tc.x, tc.y);
        const n = atk.count || 5;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * ((atk.spread || 0.5) / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: shoulder.x - 4, y: shoulder.y - 4,
            vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            w: 8, h: 8, damage: atk.damage, ownerType: 'boss', kind: 'mechPlasma',
            color: '#ffcf72', life: 1.6, trail: '#ffcf72', knockback: 3.5,
          }), true);
        }
        game.fx.ring(shoulder.x, shoulder.y, '#ffcf72', 34, { life: 0.24, width: 2 });
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
    if (this.movement === 'mech') {
      game.fx.ring(c.x, c.y, '#72ddff', 220, { life: 0.85, width: 4 });
      game.fx.burst(c.x, c.y, ['#72ddff', '#ffbf69', '#dcecff'], 46, { speed: 290, life: 1.05, glow: true, gravity: 110, size: 2.8 });
      game.fx.smoke(c.x, c.y, '#27313c', 24, { jitter: 42 });
    }
    if (this.movement === 'worm') {
      game.fx.ring(c.x, c.y, '#c383ff', 205, { life: 0.82, width: 4 });
      game.fx.burst(c.x, c.y, ['#c383ff', '#efceff', '#4a2c5d'], 52, { speed: 275, life: 1.0, glow: true, gravity: 150, size: 2.8 });
      game.fx.smoke(c.x, c.y, '#211728', 24, { jitter: 40 });
    }
    game.fx.shake(9, 0.8);
    game.fx.ring(c.x, c.y, '#ffffff', 140, { life: 0.5, width: 5 });
    game.fx.ring(c.x, c.y, this.color2, 190, { life: 0.75, width: 3 });
    game.fx.burst(c.x, c.y, [this.color2, '#ffffff', this.color], 60, { speed: 260, life: 0.9, glow: true, gravity: 90 });
    game.fx.smoke(c.x, c.y, '#3a3340', 14, { jitter: 30 });
  }

  netState() {
    const warn = this.warnAt && this.warnTime > 0
      ? {
          x: Math.round(this.warnAt.x), y: Math.round(this.warnAt.y),
          t: Math.round(this.warnTime * 100) / 100,
          m: Math.round(this.warnMax * 100) / 100,
          k: this.warnKind || null,
        }
      : null;
    return {
      key: this.key, name: this.name, difficulty: this.difficulty, x: Math.round(this.x), y: Math.round(this.y),
      hp: Math.round(this.hp), maxHp: this.maxHp, phase: this.phaseIndex, facing: this.facing,
      state: this.aiState, hidden: this.hidden ? 1 : 0, tel: this.telegraph > 0 ? 1 : 0, frz: Math.round((this.freezeT || 0) * 100) / 100,
      mr: this.mechRay ? { a: Math.round(this.mechRay.angle * 1000) / 1000, t: Math.round(this.mechRay.time * 100) / 100 } : null,
      warn,
    };
  }
}
