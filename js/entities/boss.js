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
import { TILE, normalizeDifficulty } from '../config.js?v=deep-and-divided-1';
import { BOSSES } from '../data/bosses.js?v=deep-and-divided-1';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=deep-and-divided-1';
import { aabb, angleTo, randRange, clamp, pointSegmentDistance } from '../utils.js?v=deep-and-divided-1';
import { Projectile } from './projectile.js?v=deep-and-divided-1';
import * as AI from '../systems/ai.js?v=deep-and-divided-1';

const PROJ_COLOR = {
  thorn: '#7ee08a', rock: '#8a7a5a', blight: '#c58bff', voidorb: '#b06bff',
  mechMissile: '#ffad55', mechPlasma: '#78e9ff', mechShock: '#ffd36d',
  wormSpit: '#ca8cff', wormQuake: '#d8a6ff',
  venomInjector: '#f0c56b', venomStinger: '#f6d172', vesperaShard: '#ffe089',
  choirSpore: '#c9e07a', choirGrasp: '#a86ac0', choirRot: '#7b4a8e',
  weaveLash: '#8fd8e8', weavePulse: '#ffd36d', weaveSpore: '#b9e86e',
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
      if (out.trailDamage != null && out.trailDamage > 0) out.trailDamage = Math.max(1, Math.round(out.trailDamage * tuning.damage));
      if (out.sporeDamage != null && out.sporeDamage > 0) out.sporeDamage = Math.max(1, Math.round(out.sporeDamage * tuning.damage));
      // Ring and node-pulse counts are geometry, not difficulty: adding a
      // projectile to an evenly spaced ring closes the gap the player is meant
      // to walk through. Only aimed fans take the extra shot.
      if (out.count != null && out.type !== 'choirWail') out.count = Math.max(1, out.count + tuning.extraProjectiles);
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
    // The name the HUD shows for the whole fight. A husk is called a husk in
    // the world but the bar above it is still The Hollowed Choir's bar.
    this.encounterName = d.parentBoss && BOSSES[d.parentBoss] ? BOSSES[d.parentBoss].name : d.name;
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

    // Vespera carries a few encounter-local states on the boss rather than in
    // the renderer. That makes dives, phase debris, denial trails and Frenzy
    // deterministic, frame-rate independent, and safe to clear with the rest
    // of the boss state on death/reset.
    this.vesperaDive = null;
    this.vesperaTransition = null;
    this.vesperaTrail = null;
    this.vesperaFrenzy = false;
    this.vesperaFrenzyArmed = false;
    this.vesperaFrenzyCycle = 10;
    this.vesperaFrenzyTime = 0;
    this.vesperaWingBeat = Math.random() * Math.PI * 2;
    this.vesperaMandible = 0;

    // ---- The Hollowed Choir ----
    // Arms are simulation state, not decoration: the renderer draws exactly the
    // reach the hitboxes used, so a limb you can see is a limb that can hit you.
    this.choirArms = [];
    this.choirTrail = null;
    this.choirSplit = false;
    // Husks remember how long they have been huddled next to a sibling, which
    // is the whole of the re-fuse mechanic.
    this.huskFuseTimer = 0;
    this.huskFuseCooldown = 0;
    this.huskBite = 0;

    // ---- The Weave ----
    this.nodes = [];
    this.weaveSpin = Math.random() * Math.PI * 2;
    this.weaveLash = null;      // { a, b, time, max, stage }
    this.weaveSweep = null;     // { time, max, angle }
    this.weavePulse = 0;
    this.weaveHitCooldowns = new Map();
    if (this.movement === 'weave') this._initWeaveNodes();
  }

  // ---- The Weave: node bookkeeping -------------------------------------
  //
  // The boss's HP *is* the sum of its nodes. Every hit is attributed to the
  // node nearest the blow, which is what makes "spread your damage" a real
  // instruction rather than flavour text: focus one node and it retracts and
  // heals, and the total barely moves.
  _initWeaveNodes() {
    const count = Math.max(1, this.def.nodeCount || 4);
    const share = this.maxHp / count;
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      this.nodes.push({
        i,
        hp: share, maxHp: share,
        x: this.x + this.w / 2, y: this.y + this.h / 2,
        // Each node wanders on its own phase so the formation breathes.
        driftSeed: Math.random() * Math.PI * 2,
        retract: 0,       // 0..1, how far it has pulled toward the centre
        regenLeft: 0,     // seconds of Reform regeneration remaining
        regenRate: 0,
        reformCd: 0,
        hurtFlash: 0,
        pulse: 0,
      });
    }
  }

  liveNodes() { return this.nodes.filter(n => !n.dead); }

  // Formation slots for the live nodes: a diamond at four, a tighter triangle
  // at three. Returned in local offsets from the boss centre.
  _weaveSlot(index, count, phase) {
    const rx = this.w * 0.36, ry = this.h * 0.38;
    if (count >= 4) {
      const a = -Math.PI / 2 + index * (Math.PI * 2 / 4);
      return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
    }
    // Frayed: three nodes, pulled in tighter and spun a little faster.
    const a = -Math.PI / 2 + index * (Math.PI * 2 / Math.max(1, count));
    return { x: Math.cos(a) * rx * 0.82, y: Math.sin(a) * ry * 0.82 };
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
    const prior = this.phaseIndex;
    let idx = 0;
    for (let i = 0; i < this.def.phases.length; i++) if (ratio <= this.def.phases[i].at) idx = i;
    if (idx !== this.phaseIndex) {
      this.phaseIndex = idx;
      this._seedCooldowns();
      const vesperaTransition = this.movement === 'vespera' && idx > prior;
      this.invuln = vesperaTransition ? 4 : 0.6;
      this.aiState = 'reposition';
      this.stateTime = 0;
      this.chosen = null; this.telegraph = 0;
      // Phase changes are a clean reset, never a surprise continuation of a
      // ray or leap that was chosen under the old pattern.
      this.charge = null;
      this.mechRay = null;
      this.vesperaDive = null;
      game.toast(`${this.name}: ${this.phase().name}!`, 'bad');
      const c = this.center();
      game.fx.ring(c.x, c.y, this.color2, 90, { life: 0.55, width: 4 });
      game.fx.burst(c.x, c.y, this.color2, 28, { speed: 200, glow: true, life: 0.6 });
      game.fx.shake(6, 0.5);
      if (vesperaTransition) this._beginVesperaTransition(game);
      if (this.def.splitInto && idx > prior) this._unravel(game);
      else if (this.movement === 'weave' && idx > prior) this._frayWeave(game);
    }
  }

  // The Choir comes apart. The parent is removed without going through
  // onBossDeath — it was not killed, it stopped being one thing — and its
  // remaining health is divided between the husks that replace it.
  _unravel(game) {
    if (this.choirSplit) return;
    this.choirSplit = true;
    const count = Math.max(1, this.def.splitCount || 3);
    const c = this.center();
    const share = Math.max(1, Math.round(this.hp / count));
    game.toast('The Choir comes apart!', 'bad');
    game.audio?.bossTelegraph?.();
    game.fx.ring(c.x, c.y, this.color2, 180, { life: 0.8, width: 5 });
    game.fx.burst(c.x, c.y, ['#f062a8', '#b9d16a', '#4a2f52'], 54, {
      speed: 260, life: 0.9, glow: true, gravity: 120, size: 2.8,
    });
    game.fx.smoke(c.x, c.y, '#2b1a31', 20, { jitter: 46 });
    game.fx.shake(9, 0.7);
    game.spawnChoirHusks?.(this, this.def.splitInto, count, share);
    // Leave the arena cleanly: no lingering arms, trail or hitboxes.
    this.choirArms.length = 0;
    this.choirTrail = null;
    this.dead = true;
    this.replaced = true;
  }

  // The Weave loses a node at half health. The lost node is *absorbed*, not
  // destroyed — its remaining health moves into the survivors, so the split
  // never hands the player free damage.
  _frayWeave(game) {
    const live = this.liveNodes();
    const target = this.def.phases[this.phaseIndex].nodes || (live.length - 1);
    if (live.length <= target) return;
    const c = this.center();
    while (this.liveNodes().length > target) {
      const alive = this.liveNodes();
      // The weakest node is the one the formation gives up.
      let weakest = alive[0];
      for (const n of alive) if (n.hp < weakest.hp) weakest = n;
      weakest.dead = true;
      const rest = this.liveNodes();
      if (rest.length) {
        const each = weakest.hp / rest.length;
        for (const n of rest) { n.hp += each; n.maxHp += each; }
      }
      weakest.hp = 0;
      game.fx.burst(weakest.x, weakest.y, ['#8fd8e8', '#c47b4a', '#2b1c18'], 30, {
        speed: 210, life: 0.75, glow: true, size: 2.4,
      });
    }
    this.weaveLash = null;
    this.weaveSweep = null;
    game.fx.ring(c.x, c.y, '#8fd8e8', 150, { life: 0.7, width: 4 });
    game.audio?.bossTelegraph?.();
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

    if (this.movement === 'vespera') {
      this._updateVesperaFrenzy(dt, game);
      // The phase change intentionally owns Vespera for four seconds: she
      // climbs, sheds debris, and repositions while invulnerable instead of
      // immediately snapping into an untelegraphed phase-two attack.
      if (this.vesperaTransition) {
        this._updateVesperaTransition(dt, game, target);
        clampToWorld(this, game.world);
        this._updateAnim(dt, game);
        return;
      }
    }

    // The Choir's ground trail and its arms keep running while it chooses its
    // next move: the smear it left is a hazard you have to walk around, not a
    // thing that politely expires when the attack ends.
    if (this.movement === 'choir') this._updateChoirTrail(dt, game);
    if (this.choirArms.length) this._updateChoirArms(dt, game);
    if (this.movement === 'husk') this._updateHuskFusion(dt, game);
    if (this.movement === 'weave') {
      this._updateWeaveNodes(dt, game);
      if (this.weaveSweep) {
        this._updateWeaveSweep(dt, game);
        clampToWorld(this, game.world);
        this._updateAnim(dt, game);
        this._contactDamage(game, this.phase());
        return;
      }
      if (this.weaveLash) this._updateWeaveLash(dt, game);
    }

    if (this.hidden) { this._updateHidden(dt, game, target); this._updateAnim(dt, game); return; }
    if (!target) { this._drift(dt, game); this._updateAnim(dt, game); return; }

    const ph = this.phase();
    const speedMul = (this.enraged ? this.tuning.enrageMove : 1) *
      (this.movement === 'vespera' && this.vesperaFrenzy ? 1.46 : 1);
    const tc = target.center();
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    // Plasma Ray locks the chassis in place. Its two hands and cannon are the
    // only parts that sweep toward the target, which keeps the tell legible.
    if (!this.mechRay) this.facing = tc.x < cx ? -1 : 1;

    if (this.movement === 'vespera') {
      // Trails keep ticking while she chooses and performs later attacks. This
      // is the deliberate phase-two overlap: the lane restriction remains
      // readable, but players cannot reset the fight by merely waiting out one
      // isolated move.
      this._updateVesperaTrails(dt, game);
      if (this.vesperaDive) {
        this._updateVesperaDive(dt, game, target, ph, speedMul);
        clampToWorld(this, game.world);
        this._updateAnim(dt, game);
        this._contactDamage(game, ph);
        return;
      }
    }

    // A committed charge or leap overrides everything until it expires.
    if (this.charge) {
      if (this.charge.kind === 'lurchCharge') {
        this._updateLurchCharge(dt, game, ph);
        clampToWorld(this, game.world);
        this._updateAnim(dt, game);
        this._contactDamage(game, ph, this.charge ? this.charge.damage : null);
        return;
      }
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
          if (this.movement === 'vespera' && (atk.type === 'apexDive' || atk.type === 'executionDive')) {
            game.audio?.mandibleClick?.();
          }
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
    // Slow grounded encounters declare a tighter arena, because the default is
    // wide enough that a player can simply stand outside every attack's reach.
    const arena = (this.def.arenaTiles || ARENA_TILES) * TILE;
    const far = !target || Math.hypot(target.x - cx, target.y - cy) > arena;
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
    } else if (this.movement === 'vespera') {
      // Vespera never has a calm hover. She circles just outside contact range
      // and continuously corrects toward the player, which creates aerial
      // pressure without turning the boss into a permanent hitbox on top of
      // them. Attacks temporarily override this movement with committed dives.
      const orbit = this.spawnTime * (this.vesperaFrenzy ? 1.42 : 0.92);
      const side = Math.sin(orbit * 0.62) >= 0 ? 1 : -1;
      const standoff = this.phaseIndex > 0 ? 150 : 170;
      const desiredX = tc.x + side * standoff + Math.sin(orbit * 1.75) * 48;
      const desiredY = tc.y - (this.def.floatHeight || 142) + Math.cos(orbit * 1.28) * 38;
      this.vx = clamp((desiredX - cx) * 1.32, -speed, speed);
      this.vy = clamp((desiredY - cy) * 1.22, -speed, speed);
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
    } else if (this.movement === 'choir' || this.movement === 'husk') {
      // Grounded and relentless. The Choir drags itself along at a lurch; a
      // husk moves like something that used to be several people running.
      applyGravity(this, dt);
      const dir = Math.sign(dx) || this.facing || 1;
      // The mass shambles: its speed oscillates instead of being a constant
      // slide, which is what makes it read as dragging itself forward.
      const shamble = this.movement === 'choir'
        ? 0.72 + 0.28 * Math.max(0, Math.sin(this.spawnTime * 3.1))
        : 0.86 + 0.14 * Math.max(0, Math.sin(this.spawnTime * 6.4));
      // A husk that is re-fusing with a sibling stops trying to reach you.
      const holding = this.movement === 'husk' && this.huskFuseTimer > 0.6 ? 0.35 : 1;
      this.vx = dir * speed * shamble * holding;
      if (this.onGround && AI.shouldJump(this, game.world, dir)) this.vy = -330;
      this._move(game, dt);
    } else if (this.movement === 'weave') {
      // The formation hangs just above the player and corrects toward them
      // continuously; the nodes do the drifting inside it. The standoff is
      // small on purpose — see the note on floatHeight in data/bosses.js.
      const float = ph.floatHeight || 46;
      const orbit = this.spawnTime * (this.phaseIndex > 0 ? 1.15 : 0.78);
      const side = Math.sin(orbit * 0.5) >= 0 ? 1 : -1;
      const standoff = this.phaseIndex > 0 ? 58 : 76;
      const desiredX = tc.x + side * standoff + Math.sin(orbit * 1.4) * 34;
      const desiredY = tc.y - float + Math.cos(orbit * 1.1) * 26;
      this.vx = clamp((desiredX - cx) * 1.25, -speed, speed);
      this.vy = clamp((desiredY - cy) * 1.18, -speed, speed);
      this._flyMove(game, dt);
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

  // ---- Vespera: phase transition, sustained denial, and chained dives ----

  _beginVesperaTransition(game) {
    const c = this.center();
    this.vesperaTransition = { time: 4, debrisT: 0.02 };
    this.vesperaDive = null;
    this.vesperaTrail = null;
    this.charge = null;
    this.vx = 0;
    this.vy = -220;
    game.toast('Vespera fractures her crown!', 'bad');
    game.audio?.vesperaScream?.();
    game.fx.ring(c.x, c.y, '#ffd56f', 112, { life: 0.72, width: 4 });
    game.fx.burst(c.x, c.y, ['#fff0b2', '#efbb57', '#493341'], 34, {
      speed: 220, life: 0.72, glow: true, size: 2.5,
    });
  }

  _updateVesperaTransition(dt, game, target) {
    const transition = this.vesperaTransition;
    if (!transition) return;
    transition.time -= dt;
    this.invuln = Math.max(this.invuln, transition.time);
    const c = this.center();
    const tc = target && target.center ? target.center() : c;
    // Rise hard at first, then hold a high lateral position over the arena so
    // the debris rain is visible and there is no hidden contact hitbox.
    const rise = Math.max(0, Math.min(1, transition.time / 1.25));
    const desiredX = tc.x + Math.sin(this.spawnTime * 1.5) * 142;
    const desiredY = tc.y - 230 - rise * 120;
    this.vx = clamp((desiredX - c.x) * 1.18, -285, 285);
    this.vy = clamp((desiredY - c.y) * 1.36, -330, 220);
    this._flyMove(game, dt);

    transition.debrisT -= dt;
    while (transition.debrisT <= 0) {
      transition.debrisT += 0.14;
      const spreadX = tc.x + randRange(Math.random, -310, 310);
      const spawnY = Math.min(c.y - 24, tc.y - 220 - Math.random() * 96);
      game.addProjectile(new Projectile({
        x: spreadX - 3, y: spawnY - 5,
        vx: randRange(Math.random, -84, 84), vy: 108 + Math.random() * 100,
        w: 6, h: 10, damage: 9, ownerType: 'boss', kind: 'vesperaShard',
        color: '#ffd778', gravity: true, life: 2.35, trail: '#efbb57', knockback: 2.5,
      }), true);
    }

    if (transition.time > 0) return;
    this.vesperaTransition = null;
    this.invuln = Math.max(this.invuln, 0.16);
    this.aiState = 'recover';
    this.recover = 0.42;
    game.fx.ring(this.x + this.w / 2, this.y + this.h / 2, '#f5cb68', 86, { life: 0.36, width: 3 });
  }

  _updateVesperaFrenzy(dt, game) {
    if (this.phaseIndex < 1 || this.hp / this.maxHp > 0.20) {
      this.vesperaFrenzy = false;
      this.vesperaFrenzyArmed = false;
      this.vesperaFrenzyCycle = 10;
      return;
    }
    if (!this.vesperaFrenzyArmed) {
      this.vesperaFrenzyArmed = true;
      this.vesperaFrenzyCycle = 10;
      game.toast('Vespera is nearing a frenzy!', 'bad');
    }
    this.vesperaFrenzyCycle -= dt;
    if (this.vesperaFrenzy) {
      this.vesperaFrenzyTime -= dt;
      if (this.vesperaFrenzyTime <= 0) {
        this.vesperaFrenzy = false;
        game.toast('Vespera relents for a moment.', 'info');
      }
      return;
    }
    if (this.vesperaFrenzyCycle > 0) return;
    this.vesperaFrenzy = true;
    this.vesperaFrenzyTime = 6;
    this.vesperaFrenzyCycle = 10;
    const c = this.center();
    game.toast('VESPERA: FRENZY!', 'bad');
    game.fx.ring(c.x, c.y, '#ffe07a', 122, { life: 0.48, width: 4 });
    game.fx.burst(c.x, c.y, ['#fff4bd', '#efbb57', '#9be76d'], 28, { speed: 180, glow: true, life: 0.55 });
  }

  _spawnVesperaVenomZone(game, x, y, opts = {}) {
    const w = opts.w || 82;
    const h = opts.h || 34;
    game.addProjectile(new Projectile({
      x: x - w / 2, y: y - h / 2,
      vx: 0, vy: 0, w, h,
      damage: opts.damage != null ? opts.damage : 7,
      ownerType: 'boss', kind: 'venomZone', color: '#b9e86e', life: opts.life || 4.1,
      persistent: true, hitCooldown: opts.hitCooldown || 0.58, ignoreTerrain: true,
      effect: { poison: opts.poison || 2.2 }, knockback: 1.5,
    }), true);
  }

  _updateVesperaTrails(dt, game) {
    const trail = this.vesperaTrail;
    if (!trail) return;
    trail.time -= dt;
    trail.emit -= dt;
    while (trail.emit <= 0 && trail.time > 0) {
      trail.emit += trail.interval;
      const c = this.center();
      this._spawnVesperaVenomZone(game, c.x - (this.facing || 1) * 18, c.y + this.h * 0.22, {
        w: 76, h: 30, life: 3.85, damage: 6, poison: 2.1,
      });
    }
    if (trail.time <= 0) this.vesperaTrail = null;
  }

  _startVesperaDive(atk, game, target) {
    const c = this.center();
    const tc = target.center();
    const kind = atk.type;
    this.vesperaDive = {
      kind,
      stage: 'orbit',
      time: atk.orbitTime || 0.56,
      maxTime: atk.orbitTime || 0.56,
      pass: 0,
      count: Math.max(1, atk.dives || 1),
      speed: atk.diveSpeed || 650,
      duration: atk.diveDuration || 0.34,
      recover: atk.recover != null ? atk.recover : 0.5,
      seed: angleTo(tc.x, tc.y, c.x, c.y) + randRange(Math.random, -0.45, 0.45),
      direction: Math.random() < 0.5 ? -1 : 1,
      radius: kind === 'executionDive' ? 178 : 154,
    };
    game.fx.ring(c.x, c.y, '#efbb57', 54, { life: 0.3, width: 2.5 });
  }

  _launchVesperaDivePass(dive, game, target) {
    const c = this.center();
    const tc = target.center();
    const isFinal = dive.pass === dive.count - 1;
    const frenzy = this.vesperaFrenzy ? 1.30 : 1;
    const executionFinal = dive.kind === 'executionDive' && isFinal;
    const speed = dive.speed * frenzy * (executionFinal ? 1.18 : 1);
    // Lock the line at launch. The target can still dodge, while late steering
    // would turn the attack into a homing body hit with no fair escape lane.
    const lead = executionFinal ? 0.04 : 0.12;
    const tx = tc.x + (target.vx || 0) * lead;
    const ty = tc.y + (target.vy || 0) * lead;
    const a = angleTo(c.x, c.y, tx, ty);
    dive.stage = 'lunge';
    dive.angle = a;
    dive.speedNow = speed;
    dive.time = Math.max(0.18, Math.min(dive.duration + (executionFinal ? -0.07 : 0), 0.46));
    this.facing = Math.cos(a) < 0 ? -1 : 1;
    game.fx.streak(c.x, c.y, a, executionFinal ? '#fff0a8' : '#efbb57', 8, {
      speed: speed * 0.52, spread: 0.24, life: 0.22, size: 2.1, glow: true,
    });
  }

  _updateVesperaDive(dt, game, target) {
    const dive = this.vesperaDive;
    if (!dive || !target) {
      this.vesperaDive = null;
      this.aiState = 'recover';
      this.recover = 0.38;
      return;
    }
    const c = this.center();
    const tc = target.center();
    if (dive.stage === 'lunge') {
      dive.time -= dt;
      this.vx = Math.cos(dive.angle) * dive.speedNow;
      this.vy = Math.sin(dive.angle) * dive.speedNow;
      this._flyMove(game, dt);
      if (dive.time > 0) return;
      dive.pass++;
      if (dive.pass >= dive.count) {
        this.vesperaDive = null;
        this.aiState = 'recover';
        this.recover = dive.recover;
        return;
      }
      dive.stage = 'setup';
      const finalPass = dive.pass === dive.count - 1;
      dive.maxTime = finalPass && dive.kind === 'executionDive' ? 0.035 : (dive.kind === 'executionDive' ? 0.14 : 0.22);
      dive.time = dive.maxTime;
      return;
    }

    const progress = 1 - dive.time / Math.max(0.001, dive.maxTime);
    const turn = dive.stage === 'orbit' ? progress * Math.PI * 2 : 0;
    const a = dive.seed + dive.direction * (turn + dive.pass * Math.PI * 2 / dive.count);
    const desiredX = tc.x + Math.cos(a) * dive.radius;
    const desiredY = tc.y + Math.sin(a) * dive.radius * 0.64 - 30;
    const setupSpeed = dive.kind === 'executionDive' ? 520 : 390;
    this.vx = clamp((desiredX - c.x) * 2.0, -setupSpeed, setupSpeed);
    this.vy = clamp((desiredY - c.y) * 2.0, -setupSpeed, setupSpeed);
    this._flyMove(game, dt);
    dive.time -= dt;
    if (dive.time <= 0) this._launchVesperaDivePass(dive, game, target);
  }

  // ---- Shared: damage along a line ------------------------------------
  //
  // Reaching arms, snapping strands and sweeping tendrils are all *lines*, and
  // an axis-aligned box is a poor stand-in for one. This walks the segment,
  // stops at the first solid tile (so a limb cannot reach through rock) and
  // damages anything whose box the surviving part of the line crosses. Each
  // call keeps its own hit set, so one lash hits a target once.
  _lineDamage(game, x0, y0, angle, length, damage, opts = {}) {
    const world = game.world;
    const step = opts.step || 9;
    const half = (opts.thickness || 16) / 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let reached = length;
    if (!opts.phasing) {
      for (let d = 0; d <= length; d += 6) {
        const px = x0 + cos * d, py = y0 + sin * d;
        if (world.isSolidAt(Math.floor(px / TILE), Math.floor(py / TILE))) { reached = d; break; }
      }
    }
    const hit = opts.hitSet || new Set();
    const targets = [...game.players.values()];
    for (const npc of (game.npcs || [])) if (npc && npc.alive) targets.push(npc);
    for (const m of (game.minions || [])) if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);

    for (let d = 0; d <= reached; d += step) {
      const px = x0 + cos * d, py = y0 + sin * d;
      for (const p of targets) {
        if (hit.has(p) || p.alive === false || p.dead) continue;
        if (px < p.x - half || px > p.x + p.w + half) continue;
        if (py < p.y - half || py > p.y + p.h + half) continue;
        hit.add(p);
        const kb = Math.sign(px - (this.x + this.w / 2)) * (opts.knockback || 5);
        if (p.kind || p.isMinion) p.takeDamage(damage, kb, game, this.name);
        else game.applyEnemyDamageToPlayer(p, damage, kb);
      }
    }
    return { reached, hit };
  }

  // ---- The Hollowed Choir ---------------------------------------------

  // Arms live for a fraction of a second and are drawn from this state, so the
  // limb you see reaching for you is the exact segment that was tested.
  _spawnChoirArms(atk, game, target) {
    const c = this.center();
    const tc = target.center();
    const n = Math.max(1, Math.min(3, atk.count || 3));
    const base = angleTo(c.x, c.y, tc.x, tc.y);
    const reach = atk.reach || 200;
    const damage = atk.damage || 60;
    const hit = new Set();
    for (let i = 0; i < n; i++) {
      // The arms fan slightly so a player standing still is caught, while
      // stepping out of the line still clears all three.
      const a = base + (i - (n - 1) / 2) * 0.30;
      const origin = { x: c.x, y: c.y - 6 + (i - (n - 1) / 2) * 12 };
      const res = this._lineDamage(game, origin.x, origin.y, a, reach, damage, {
        thickness: 20, knockback: 7, hitSet: hit,
      });
      this.choirArms.push({
        x: origin.x - this.x, y: origin.y - this.y, // stored relative: the mass moves
        angle: a, len: res.reached, t: 0, life: 0.55,
      });
      game.fx.streak(origin.x, origin.y, a, '#c98adf', 5, {
        speed: 260, spread: 0.18, life: 0.24, size: 2.2, glow: true,
      });
    }
    game.fx.shake(4.5, 0.24);
  }

  _updateChoirArms(dt, game) {
    for (const arm of this.choirArms) arm.t += dt;
    // Retract slowly, which is the readable half of the animation.
    for (let i = this.choirArms.length - 1; i >= 0; i--) {
      if (this.choirArms[i].t >= this.choirArms[i].life) this.choirArms.splice(i, 1);
    }
  }

  _updateLurchCharge(dt, game, ph) {
    const lurch = this.charge;
    lurch.time -= dt;
    applyGravity(this, dt);
    this.vx = lurch.vx;
    this._move(game, dt);
    // The smear is laid down by the body as it travels, so its length is
    // exactly how far the lurch actually got.
    lurch.emit -= dt;
    while (lurch.emit <= 0 && lurch.time > 0) {
      lurch.emit += lurch.interval;
      this._spawnRotZone(game, this.x + this.w / 2, this.y + this.h - 6, lurch.trailDamage, lurch.trailLife);
    }
    if (lurch.time > 0 && !this.hitWallX) return;
    const c = this.center();
    game.fx.burst(c.x, this.y + this.h, ['#7b4a8e', '#c9e07a', '#2b1a31'], 18, {
      speed: 150, life: 0.5, gravity: 420, size: 2.3,
    });
    this.charge = null;
    this.aiState = 'recover';
    this.recover = lurch.recover != null ? lurch.recover : 0.75;
  }

  // A patch of corrupted ground. Persistent, terrain-ignoring and on a hit
  // cooldown, so standing in it ticks while running through it costs one tick.
  _spawnRotZone(game, x, y, damage, life) {
    game.addProjectile(new Projectile({
      x: x - 30, y: y - 10, vx: 0, vy: 0, w: 60, h: 20,
      damage: Math.max(1, damage || 3), ownerType: 'boss', kind: 'choirRot',
      color: '#7b4a8e', life: life || 2, persistent: true, hitCooldown: 0.5,
      ignoreTerrain: true, knockback: 0,
    }), true);
  }

  _updateChoirTrail(dt, game) {
    const trail = this.choirTrail;
    if (!trail) return;
    trail.time -= dt;
    if (trail.time <= 0) this.choirTrail = null;
  }

  // Husks that huddle together start knitting back into one thing. The heal is
  // deliberately loud — toast, ring, particles — because the counterplay is to
  // notice it and break them apart.
  _updateHuskFusion(dt, game) {
    if (this.huskFuseCooldown > 0) this.huskFuseCooldown = Math.max(0, this.huskFuseCooldown - dt);
    const siblings = (game.bosses || []).filter(b =>
      b !== this && !b.dead && b.key === this.key && b.hp > 0);
    if (!siblings.length) { this.huskFuseTimer = 0; return; }
    const c = this.center();
    let near = null;
    for (const s of siblings) {
      const sc = s.center();
      if (Math.hypot(sc.x - c.x, sc.y - c.y) <= 96) { near = s; break; }
    }
    if (!near) { this.huskFuseTimer = Math.max(0, this.huskFuseTimer - dt * 1.6); return; }
    this.huskFuseTimer += dt;
    // Both halves of the pair show the same tell while it builds.
    if (Math.random() < dt * 14) {
      const sc = near.center();
      game.fx.burst((c.x + sc.x) / 2, (c.y + sc.y) / 2, '#b9d16a', 1, {
        speed: 60, life: 0.4, glow: true,
      });
    }
    if (this.huskFuseTimer < 3 || this.huskFuseCooldown > 0) return;

    const pooled = this.hp + near.hp;
    const heal = pooled * 0.05;
    this.hp = Math.min(this.maxHp, this.hp + heal / 2);
    near.hp = Math.min(near.maxHp, near.hp + heal / 2);
    this.huskFuseTimer = 0; near.huskFuseTimer = 0;
    this.huskFuseCooldown = 4; near.huskFuseCooldown = 4;
    const mid = { x: (c.x + near.center().x) / 2, y: (c.y + near.center().y) / 2 };
    game.toast('The husks knit back together!', 'bad');
    game.fx.ring(mid.x, mid.y, '#b9d16a', 92, { life: 0.5, width: 3 });
    game.fx.burst(mid.x, mid.y, ['#b9d16a', '#f062a8', '#4a2f52'], 24, {
      speed: 170, life: 0.6, glow: true,
    });
    game.floatText?.(mid.x, mid.y - 16, '+' + Math.round(heal), '#b9d16a');
  }

  // Killing a husk in melee range costs you: it pops.
  _huskSporeBurst(game) {
    const c = this.center();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random() * 0.4;
      game.addProjectile(new Projectile({
        x: c.x - 5, y: c.y - 5,
        vx: Math.cos(a) * 128, vy: Math.sin(a) * 128 - 40,
        w: 10, h: 10, damage: 30, ownerType: 'boss', kind: 'choirSpore',
        color: '#c9e07a', life: 1.5, gravity: true, trail: '#9fbb52', knockback: 4,
      }), true);
    }
    game.fx.ring(c.x, c.y, '#c9e07a', 62, { life: 0.4, width: 3 });
  }

  // ---- The Weave -------------------------------------------------------

  _updateWeaveNodes(dt, game) {
    const live = this.liveNodes();
    if (!live.length) return;
    const ph = this.phase();
    const c = this.center();
    this.weaveSpin += dt * (this.phaseIndex > 0 ? 0.85 : 0.5);
    const drift = ph.nodeDrift != null ? ph.nodeDrift : 24;

    live.forEach((n, i) => {
      const slot = this._weaveSlot(i, live.length, ph);
      const a = this.weaveSpin;
      // Rotate the slot with the formation, then let the node wander around it.
      let ox = slot.x * Math.cos(a) - slot.y * Math.sin(a);
      let oy = slot.x * Math.sin(a) + slot.y * Math.cos(a);
      ox += Math.sin(this.spawnTime * 1.4 + n.driftSeed) * drift;
      oy += Math.cos(this.spawnTime * 1.1 + n.driftSeed * 1.7) * drift * 0.7;
      // Reform pulls the node in toward its siblings, which is what makes it
      // genuinely harder to keep hitting.
      const pull = 1 - n.retract * 0.72;
      n.x = c.x + ox * pull;
      n.y = c.y + oy * pull;
      if (n.hurtFlash > 0) n.hurtFlash -= dt;
      if (n.pulse > 0) n.pulse -= dt;
      if (n.reformCd > 0) n.reformCd -= dt;

      if (n.regenLeft > 0) {
        n.regenLeft -= dt;
        n.hp = Math.min(n.maxHp, n.hp + n.regenRate * dt);
        n.retract = Math.min(1, n.retract + dt * 3);
        if (n.regenLeft <= 0) n.retract = 0;
      } else if (n.retract > 0) {
        n.retract = Math.max(0, n.retract - dt * 2);
      }
    });
    this._syncWeaveHp();
    this._tryWeaveReform(game);
  }

  _syncWeaveHp() {
    let total = 0;
    for (const n of this.nodes) if (!n.dead) total += Math.max(0, n.hp);
    this.hp = Math.min(this.maxHp, total);
  }

  // Reform: a node below a quarter of its own share retracts into the
  // formation and knits itself back up. Its internal cooldown means focus fire
  // still eventually wins — it just costs far more time than spreading damage.
  _tryWeaveReform(game) {
    const ph = this.phase();
    const atk = ph.attacks.find(a => a.type === 'reform');
    if (!atk) return;
    for (const n of this.liveNodes()) {
      if (n.regenLeft > 0 || n.reformCd > 0) continue;
      if (n.hp / n.maxHp > (atk.threshold || 0.25)) continue;
      const time = atk.regenTime || 3;
      n.regenLeft = time;
      n.regenRate = (n.maxHp * (atk.regen || 0.03)) / time;
      n.reformCd = atk.cooldown || 15;
      game.fx.ring(n.x, n.y, '#8fd8e8', 46, { life: 0.45, width: 2.5 });
      game.floatText?.(n.x, n.y - 14, 'REFORM', '#8fd8e8');
    }
  }

  // Strand Lash: two adjacent nodes pull the tissue between them taut, then
  // snap it. The wind-up glows along the whole strand, so the dodge is to be
  // off the line rather than away from either node.
  _startWeaveLash(atk, game, target) {
    const live = this.liveNodes();
    if (live.length < 2) return;
    const tc = target.center();
    // Pick the adjacent pair whose strand passes closest to the player: the
    // Weave aims with the geometry it has rather than firing at random.
    let best = null, bestD = Infinity;
    for (let i = 0; i < live.length; i++) {
      const a = live[i], b = live[(i + 1) % live.length];
      const d = pointSegmentDistance(tc.x, tc.y, a.x, a.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    if (!best) return;
    const [n0, n1] = best;
    // A taut strand between two fixed points is a line the player is almost
    // never standing on, which made the Weave's signature attack land on
    // nothing. A whip does not stay between its ends: the strand snaps *out*,
    // bowing through the space it is aimed at. If the target is within the
    // capture radius of the strand, the lash bulges through them; further away
    // than that and it cracks straight, and stepping off the line is still the
    // dodge the 0.5s wind-up is there to allow.
    const CAPTURE = 96;
    const bulge = bestD <= CAPTURE ? { x: tc.x, y: tc.y } : null;
    const ang = angleTo(n0.x, n0.y, n1.x, n1.y);
    const len = Math.hypot(n1.x - n0.x, n1.y - n0.y);
    const over = len * 0.34;
    this.weaveLash = {
      a: n0, b: n1, stage: 'fire',
      time: atk.lashLife || 0.22, max: atk.lashLife || 0.22,
      damage: atk.damage || 55,
      over, bulge,
      hit: new Set(),
    };
    const opts = { thickness: 24, knockback: 8, hitSet: this.weaveLash.hit, phasing: true, step: 8 };
    if (bulge) {
      // Two legs: out to the crack point and back to the far node.
      const a0 = angleTo(n0.x, n0.y, bulge.x, bulge.y);
      const l0 = Math.hypot(bulge.x - n0.x, bulge.y - n0.y);
      this._lineDamage(game, n0.x, n0.y, a0, l0 + 18, this.weaveLash.damage, opts);
      const a1 = angleTo(bulge.x, bulge.y, n1.x, n1.y);
      const l1 = Math.hypot(n1.x - bulge.x, n1.y - bulge.y);
      this._lineDamage(game, bulge.x, bulge.y, a1, l1 + 18, this.weaveLash.damage, opts);
    } else {
      this._lineDamage(game, n0.x - Math.cos(ang) * over, n0.y - Math.sin(ang) * over,
        ang, len + over * 2, this.weaveLash.damage, opts);
    }
    game.fx.streak(n0.x, n0.y, ang, '#d6f6ff', 8, { speed: 300, spread: 0.1, life: 0.2, size: 2, glow: true });
    game.fx.shake(3.4, 0.18);
  }

  _updateWeaveLash(dt, game) {
    const lash = this.weaveLash;
    lash.time -= dt;
    if (lash.time <= 0) this.weaveLash = null;
  }

  // Node Pulse: every node releases a radial shockwave at once. Phase two adds
  // four homing spores per node so the burst has follow-through at range.
  _weaveNodePulse(atk, game, target) {
    const live = this.liveNodes();
    const radius = atk.radius || 74;
    const tc = target.center();
    for (const n of live) {
      n.pulse = 0.4;
      game.addProjectile(new Projectile({
        x: n.x - radius / 2, y: n.y - radius / 2, vx: 0, vy: 0,
        w: radius, h: radius,
        damage: atk.damage || 35, ownerType: 'boss', kind: 'weavePulse',
        color: '#ffd36d', life: 0.22, ignoreTerrain: true, knockback: 6,
      }), true);
      game.fx.ring(n.x, n.y, '#ffd36d', radius, { life: 0.34, width: 3 });
      if (!atk.spores) continue;
      for (let i = 0; i < atk.spores; i++) {
        const a = angleTo(n.x, n.y, tc.x, tc.y) + (i - (atk.spores - 1) / 2) * 0.34;
        game.addProjectile(new Projectile({
          x: n.x - 5, y: n.y - 5,
          vx: Math.cos(a) * (atk.projSpeed || 210), vy: Math.sin(a) * (atk.projSpeed || 210),
          w: 10, h: 10, damage: atk.sporeDamage || 22, ownerType: 'boss', kind: 'weaveSpore',
          color: '#b9e86e', life: 2.4, homing: true,
          homingTargetId: target.id || target.netId || null,
          homingStrength: atk.homingStrength || 1.5, trail: '#8fd44e', knockback: 3,
        }), true);
      }
    }
    game.fx.shake(4, 0.24);
  }

  // Tendril Sweep: the formation spins and every strand extends into a rotating
  // blade for a second and a half. The gaps between the strands are the dodge.
  _startWeaveSweep(atk, game) {
    this.weaveSweep = {
      time: atk.duration || 1.5,
      max: atk.duration || 1.5,
      angle: Math.random() * Math.PI * 2,
      speed: atk.sweepSpeed || 3.4,
      reach: atk.reach || 132,
      damage: atk.damage || 50,
      recover: atk.recover != null ? atk.recover : 0.7,
      tick: 0,
    };
    this.weaveHitCooldowns.clear();
    const c = this.center();
    game.fx.ring(c.x, c.y, '#8fd8e8', atk.reach || 132, { life: 0.4, width: 3 });
  }

  _updateWeaveSweep(dt, game) {
    const sweep = this.weaveSweep;
    sweep.time -= dt;
    sweep.angle += sweep.speed * dt;
    // The formation keeps drifting during the sweep, so it is not a safe
    // "stand still and it passes" moment — but it moves slowly enough to run.
    this.vx *= 0.9; this.vy *= 0.9;
    this._flyMove(game, dt);

    for (const [k, v] of this.weaveHitCooldowns) {
      if (v <= dt) this.weaveHitCooldowns.delete(k); else this.weaveHitCooldowns.set(k, v - dt);
    }

    // Damage is sampled a few times a second rather than every frame, so the
    // sweep cannot shred a target that clips one strand for two frames.
    sweep.tick -= dt;
    if (sweep.tick <= 0) {
      sweep.tick = 0.12;
      const live = this.liveNodes();
      const c = this.center();
      const hit = new Set();
      for (let i = 0; i < live.length; i++) {
        const a = sweep.angle + (i / Math.max(1, live.length)) * Math.PI * 2;
        this._lineDamage(game, c.x, c.y, a, sweep.reach, sweep.damage, {
          thickness: 16, knockback: 7, hitSet: hit, phasing: true, step: 10,
        });
      }
      // Per-target pacing on top of the shared hit set.
      for (const p of hit) this.weaveHitCooldowns.set(p, 0.4);
    }

    if (sweep.time > 0) return;
    this.weaveSweep = null;
    this.aiState = 'recover';
    this.recover = sweep.recover;
  }

  // Contact for a formation: near a node, or across one of its strands.
  _weaveContactDamage(game, contact) {
    const live = this.liveNodes();
    if (!live.length) return;
    const targets = [...game.players.values()];
    for (const npc of (game.npcs || [])) if (npc && npc.alive) targets.push(npc);
    for (const m of (game.minions || [])) if (m.alive !== false && !m.dead && m.maxHp != null) targets.push(m);

    for (const p of targets) {
      if (p.alive === false || p.dead) continue;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      let touching = false;
      for (const n of live) {
        if (Math.hypot(n.x - px, n.y - py) <= 26 + Math.max(p.w, p.h) * 0.4) { touching = true; break; }
      }
      if (!touching) {
        for (let i = 0; i < live.length && !touching; i++) {
          const a = live[i], b2 = live[(i + 1) % live.length];
          if (live.length === 2 && i === 1) break;
          if (pointSegmentDistance(px, py, a.x, a.y, b2.x, b2.y) <= 10 + Math.max(p.w, p.h) * 0.3) touching = true;
        }
      }
      if (!touching) continue;
      const knockback = Math.sign(px - (this.x + this.w / 2)) * 6;
      const dodged = p.isMinion && p.tryDodgeContact?.(game, this);
      if (!dodged && (p.kind || p.isMinion)) p.takeDamage(contact, knockback, game, this.name);
      else if (!dodged) game.applyEnemyDamageToPlayer(p, contact, knockback);
    }
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

    if (this.movement === 'vespera') {
      const diveActive = !!this.vesperaDive;
      const beatRate = this.vesperaFrenzy ? 20 : diveActive ? 15 : 10;
      this.vesperaWingBeat += dt * beatRate;
      const mandibleTarget = this.telegraph > 0 || diveActive ? 1 : 0;
      this.vesperaMandible += (mandibleTarget - this.vesperaMandible) * (1 - Math.pow(0.008, dt));
    }

    // The Choir. The mass breathes constantly and the faces across it strain
    // during a wind-up; the arms are already simulated, so only the body's own
    // swell is animated here.
    if (this.movement === 'choir') {
      const charge = this.telegraph > 0 ? 1 - this.telegraph / (this.telegraphMax || 0.6) : 0;
      this.choirSwell = (this.choirSwell || 0) + (charge - (this.choirSwell || 0)) * (1 - Math.pow(0.02, dt));
      this.walkCycle = (this.walkCycle || 0) + dt * (Math.abs(this.vx) > 6 ? 2.6 : 0.8);
      const wasAir = this._wasAirborne;
      this._wasAirborne = !this.onGround;
      if (wasAir && this.onGround) {
        this.squashX = 1.2; this.squashY = 0.82;
        game?.fx?.burst?.(this.x + this.w / 2, this.y + this.h, '#4a2f52', 10,
          { speed: 110, life: 0.5, size: 2.2, gravity: 240 });
      }
    }
    if (this.movement === 'husk') {
      this.walkCycle = (this.walkCycle || 0) + dt * (Math.abs(this.vx) > 6 ? 6.5 : 1.2);
      if (this.huskBite > 0) this.huskBite = Math.max(0, this.huskBite - dt);
      const jawTarget = this.telegraph > 0 ? 1 : 0;
      if (jawTarget > this.jaw) this.jaw += (jawTarget - this.jaw) * (1 - Math.pow(0.02, dt));
      else this.jaw = Math.max(0, this.jaw - dt * 10);
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

  // `override` lets a committed move (the Choir's lurch) hit for its own
  // damage while it is travelling, instead of the phase's normal contact.
  _contactDamage(game, ph, override = null) {
    if (this.hidden) return; // can't be hit by something that isn't there
    const contact = Math.max(1, Math.round(override != null ? override : ph.contact));
    // A formation is its nodes and the strands between them, not the empty air
    // inside the diamond. Using the bounding box here would make standing in
    // the middle of The Weave — the one place with nothing in it — the most
    // punishing spot on the screen.
    if (this.nodes.length) { this._weaveContactDamage(game, contact); return; }
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
        if (!dodged && (p.kind || p.isMinion)) p.takeDamage(contact, knockback, game, this.name);
        else if (!dodged) game.applyEnemyDamageToPlayer(p, contact, knockback);
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
      case 'apexDive':
      case 'executionDive': {
        this._startVesperaDive(atk, game, target);
        break;
      }
      case 'injectorBurst': {
        const n = this.vesperaFrenzy ? (atk.frenzyCount || 11) : (atk.count || 9);
        const base = angleTo(cx, cy, tc.x, tc.y);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * ((atk.spread || 1.4) / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: cx - 5, y: cy - 3,
            vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            w: 11, h: 5, damage: atk.damage, ownerType: 'boss', kind: 'venomInjector',
            color: '#f0c56b', life: 2.0, homing: true,
            homingTargetId: target.id || target.netId || null,
            homingStrength: atk.homingStrength || 0.72,
            effect: { poison: atk.poison || 2.2 }, trail: '#d7a34c', knockback: 3,
          }), true);
        }
        game.fx.ring(cx, cy, '#f5cd6d', 52, { life: 0.28, width: 2.5 });
        game.fx.burst(cx, cy, ['#f5de91', '#d89b41', '#403042'], 14, { speed: 130, life: 0.38, glow: true });
        break;
      }
      case 'broodDrop': {
        const n = this.vesperaFrenzy ? (atk.frenzyCount || 4) : (atk.count || 2);
        const fuse = this.vesperaFrenzy ? (atk.frenzyFuse || 0.58) : (atk.podFuse || 1.12);
        for (let i = 0; i < n; i++) {
          const offset = (i - (n - 1) / 2) * 58 + randRange(Math.random, -16, 16);
          const px = tc.x + offset;
          const py = Math.min(cy + 20, tc.y - 150 - Math.random() * 36);
          game.addProjectile(new Projectile({
            x: px - 8, y: py - 8,
            vx: randRange(Math.random, -30, 30), vy: 105 + Math.random() * 38,
            w: 16, h: 16, damage: 0, ownerType: 'boss', kind: 'broodPod', color: '#b9e86e',
            gravity: true, life: fuse + 0.35, burstDelay: fuse, trail: '#b9e86e',
            spawnOnBurst: {
              adds: { key: 'swarmling', count: 2, lifetime: 10.5 },
              hazard: { w: 88, h: 34, damage: atk.damage || 7, life: 4.2, hitCooldown: 0.56, poison: 2.4 },
            },
          }), true);
        }
        game.fx.burst(cx, cy + 12, ['#d7a34c', '#b9e86e', '#342637'], 12, { speed: 110, life: 0.36, glow: true });
        break;
      }
      case 'wingPressure': {
        // The gust applies a short control-disrupting push, then the five
        // stingers chase the displaced lane. It never deals unavoidable direct
        // damage itself, so the player still has time to recover and dodge.
        for (const p of game.players.values()) {
          if (!p || p.alive === false || p.dead) continue;
          const pc = p.center ? p.center() : { x: p.x + p.w / 2, y: p.y + p.h / 2 };
          const dir = Math.sign(pc.x - cx) || this.facing || 1;
          p.vx = dir * (atk.gustSpeed || 240);
          p.vy = Math.min(p.vy || 0, -(atk.gustLift || 145));
          p.kbTimer = Math.max(p.kbTimer || 0, 0.18);
        }
        const n = atk.count || 5;
        const base = angleTo(cx, cy, tc.x, tc.y);
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * (0.84 / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: cx - 5, y: cy - 4,
            vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            w: 10, h: 5, damage: atk.damage, ownerType: 'boss', kind: 'venomStinger',
            color: '#f6d172', life: 2.7, homing: true,
            homingTargetId: target.id || target.netId || null,
            homingStrength: atk.homingStrength || 1.15,
            effect: { poison: atk.poison || 1.8 }, trail: '#efbb57', knockback: 3.5,
          }), true);
        }
        for (let i = 0; i < 7; i++) {
          const a = base + (i - 3) * 0.17;
          game.fx.streak(cx, cy, a, '#f6d172', 2, { speed: 185, life: 0.22, size: 1.3, glow: true });
        }
        break;
      }
      case 'swarmCall': {
        const min = atk.addMin != null ? atk.addMin : 3;
        const max = atk.addMax != null ? atk.addMax : 5;
        let count = min + ((Math.random() * (max - min + 1)) | 0);
        if (this.vesperaFrenzy) count *= 2;
        game.spawnBossAdds('broodDrone', count, cx, cy, { lifetime: this.vesperaFrenzy ? 13.5 : 11.5 });
        game.fx.ring(cx, cy, '#b9e86e', 72, { life: 0.32, width: 2 });
        game.fx.burst(cx, cy, ['#b9e86e', '#efbb57', '#382c40'], 16, { speed: 138, life: 0.46, glow: true });
        break;
      }
      case 'hiveTrails': {
        this.vesperaTrail = {
          time: atk.duration || 2.4,
          emit: 0.01,
          interval: atk.interval || 0.30,
        };
        break;
      }
      case 'spawnAdds': {
        game.spawnBossAdds(atk.enemy, atk.addCount, this.x, this.y);
        break;
      }

      // ---- The Hollowed Choir ----
      case 'reachingGrasp': {
        this._spawnChoirArms(atk, game, target);
        break;
      }
      case 'choirWail': {
        // A ring with even spacing and slow projectiles: the gaps between the
        // spores are wide enough to walk through, which is the point.
        const n = atk.count || 8;
        const offset = this.spawnTime * 0.4;
        for (let i = 0; i < n; i++) {
          const a = offset + (i / n) * Math.PI * 2;
          game.addProjectile(new Projectile({
            x: cx - 7, y: cy - 7,
            vx: Math.cos(a) * (atk.projSpeed || 132), vy: Math.sin(a) * (atk.projSpeed || 132),
            w: 14, h: 14, damage: atk.damage, ownerType: 'boss', kind: 'choirSpore',
            color: '#c9e07a', life: 4.2, trail: '#9fbb52', knockback: 5, destructible: true,
          }), true);
        }
        game.audio?.vesperaScream?.();
        game.fx.ring(cx, cy, '#f062a8', 130, { life: 0.5, width: 4 });
        game.fx.burst(cx, cy, ['#c9e07a', '#f062a8', '#2b1a31'], 26, {
          speed: 190, life: 0.6, glow: true, size: 2.4,
        });
        game.fx.shake(7.5, 0.5);
        break;
      }
      case 'lurchCharge': {
        const dir = Math.sign(tc.x - cx) || this.facing || 1;
        this.charge = {
          kind: 'lurchCharge',
          time: atk.duration || 0.62,
          vx: dir * (atk.speed || 300), vy: 0,
          damage: atk.damage || 70,
          trailDamage: atk.trailDamage || 3,
          trailLife: atk.trailLife || 2,
          interval: atk.trailInterval || 0.09,
          emit: 0,
          recover: atk.recover != null ? atk.recover : 0.75,
        };
        this.vx = this.charge.vx;
        game.fx.burst(cx, this.y + this.h - 4, ['#7b4a8e', '#c9e07a'], 18, {
          speed: 160, life: 0.5, gravity: 460, size: 2.2, glow: true,
        });
        game.fx.shake(4, 0.22);
        break;
      }
      case 'unravel': {
        // Reaching this phase is what splits the mass; the attack entry only
        // exists so the phase has something legal to select.
        this._unravel(game);
        break;
      }
      case 'snapBite': {
        const a = angleTo(cx, cy, tc.x, tc.y);
        this.huskBite = 0.28;
        this._lineDamage(game, cx, cy, a, atk.maxRange || 92, atk.damage || 45, {
          thickness: 18, knockback: atk.knockback || 6,
        });
        game.fx.streak(cx, cy, a, '#b9d16a', 4, { speed: 220, spread: 0.3, life: 0.18, size: 1.8, glow: true });
        break;
      }

      // ---- The Weave ----
      case 'strandLash': {
        this._startWeaveLash(atk, game, target);
        break;
      }
      case 'nodePulse': {
        this._weaveNodePulse(atk, game, target);
        break;
      }
      case 'tendrilSweep': {
        this._startWeaveSweep(atk, game);
        break;
      }
      case 'reform': {
        // Driven by node health in _tryWeaveReform, never by the attack roll.
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

  // `hx`/`hy` are the point the blow landed, when the caller knows it. The
  // Weave uses it to decide which node took the hit; every other boss ignores
  // it, so passing it is optional at every call site.
  takeDamage(amount, game, crit, hx = null, hy = null) {
    if (this.dead || this.invuln > 0 || this.hidden) return;
    // Defense is flat mitigation with a floor, the same shape the player's own
    // defense uses, so a fast weak weapon is weakened rather than nullified.
    const armor = this.def.defense || 0;
    const dealt = armor > 0 ? Math.max(1, amount - armor * 0.5) : amount;

    if (this.nodes.length) {
      const node = this._nodeNearest(hx, hy);
      if (node) {
        node.hp = Math.max(0, node.hp - dealt);
        node.hurtFlash = 0.12;
        this._syncWeaveHp();
        if (game) game.floatText(node.x, node.y - 10, Math.round(dealt) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
      }
    } else {
      this.hp -= dealt;
      if (game) game.floatText(this.x + this.w / 2, this.y, Math.round(dealt) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
    }
    this.hurtFlash = 0.1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      if (game) { this._deathThroes(game); game.onBossDeath(this); }
    }
  }

  // The node closest to where the hit landed. With no hit point (an effect that
  // does not report one) the formation's lead node takes it, so damage is never
  // silently discarded.
  _nodeNearest(hx, hy) {
    const live = this.liveNodes();
    if (!live.length) return null;
    if (hx == null || hy == null) {
      // Prefer a node that is not mid-Reform, so a positionless tick cannot
      // undo the retract mechanic for free.
      return live.find(n => n.regenLeft <= 0) || live[0];
    }
    let best = live[0], bestD = Infinity;
    for (const n of live) {
      const d = (n.x - hx) * (n.x - hx) + (n.y - hy) * (n.y - hy);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
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
    if (this.movement === 'vespera') {
      game.fx.ring(c.x, c.y, '#efbb57', 230, { life: 0.90, width: 4 });
      game.fx.burst(c.x, c.y, ['#fff0b2', '#efbb57', '#211923', '#b9e86e'], 64, {
        speed: 300, life: 1.08, glow: true, gravity: 120, size: 2.7,
      });
      game.fx.smoke(c.x, c.y, '#17121b', 28, { jitter: 44 });
    }
    if (this.movement === 'choir') {
      game.fx.ring(c.x, c.y, '#f062a8', 210, { life: 0.86, width: 4 });
      game.fx.burst(c.x, c.y, ['#f062a8', '#c9e07a', '#2b1a31'], 58, {
        speed: 280, life: 1.0, glow: true, gravity: 140, size: 2.8,
      });
      game.fx.smoke(c.x, c.y, '#241429', 26, { jitter: 44 });
    }
    if (this.movement === 'husk') {
      // Spores on death are a real hitbox — killing the last husk while stood
      // on top of it should cost something.
      this._huskSporeBurst(game);
      game.fx.smoke(c.x, c.y, '#241429', 12, { jitter: 26 });
    }
    if (this.movement === 'weave') {
      // The strands go slack and the nodes drift apart rather than popping.
      for (const n of this.nodes) {
        game.fx.burst(n.x, n.y, ['#8fd8e8', '#ffd36d', '#3d2a26'], 22, {
          speed: 150, life: 1.1, glow: true, gravity: 26, size: 2.3,
        });
      }
      game.fx.ring(c.x, c.y, '#8fd8e8', 220, { life: 0.9, width: 4 });
      game.fx.smoke(c.x, c.y, '#17110f', 20, { jitter: 40 });
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
      vf: this.vesperaFrenzy ? 1 : 0,
      vt: this.vesperaTransition ? Math.round(this.vesperaTransition.time * 100) / 100 : 0,
      // The Weave's nodes and the Choir's arms are the creature, not decoration,
      // so a joined client has to receive them or it sees an empty box swinging
      // at people. Both are rounded hard: they change every frame.
      nd: this.nodes.length
        ? this.nodes.filter(n => !n.dead).map(n => [
            Math.round(n.x), Math.round(n.y),
            Math.round((n.hp / Math.max(1, n.maxHp)) * 100),
            Math.round(n.retract * 100),
          ])
        : null,
      ar: this.choirArms.length
        ? this.choirArms.map(a => [
            Math.round(this.x + a.x), Math.round(this.y + a.y),
            Math.round(a.angle * 100) / 100, Math.round(a.len),
            Math.round((1 - a.t / a.life) * 100),
          ])
        : null,
      sw: this.weaveSweep ? Math.round(this.weaveSweep.angle * 100) / 100 : null,
      warn,
    };
  }
}
