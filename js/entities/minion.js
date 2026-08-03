// Summoner Realms — minion entity. Owned by a player; the owner's client
// simulates it and reports damage to the host. Remote players' minions are
// drawn as lightweight ghosts (see renderer).
import { minionDef } from '../data/minions.js?v=prehardmode-classes-1';
import { initAidanState, updateAidanState } from './aidan.js?v=prehardmode-classes-1';
import { dist2, aabb, angleTo } from '../utils.js?v=prehardmode-classes-1';
import { TILE } from '../config.js?v=prehardmode-classes-1';
import { Projectile } from './projectile.js?v=prehardmode-classes-1';
import * as AI from '../systems/ai.js?v=prehardmode-classes-1';

let MINION_SEQ = 1;

// Beyond this distance from the owner (px) a minion snaps home — it never
// wanders off to chase something across the map and never gets marooned.
const LEASH = 560;
// How long a minion may fail to reach/hit its target before it gives it up
// (returns to the owner and re-scans) — prevents grinding a wall forever.
const GIVE_UP = 2.6;
// How long stuck (barely moving, far from owner) before it teleports home.
const STUCK_TELEPORT = 3.0;
const DIAMOND_LEASH = 780;
// Diamond Heart keeps a real air lane around threats instead of hovering in
// melee range. It may cross this lane only during its deliberate dash.
const DIAMOND_SAFE_RADIUS = 300;
// Keep the Heart in a clear air lane above the generated surface. Its flying
// movement intentionally ignores collision, so the AI must enforce this ceiling.
const DIAMOND_AIR_CLEARANCE = 24;
const DIAMOND_GROUND_SAMPLE = 1;

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
    this.alive = true;
    this.isMinion = true;
    this.maxHp = d.maxHp != null ? d.maxHp : null;
    this.hp = this.maxHp;
    this.iframes = 0;
    this.hurtFlash = 0;
    this.attackPulse = 0;
    this.pose = 'idle';
    this.poseTimer = 0;
    this.moveAmount = 0;
    this.recoil = 0;
    this.pulseAngle = 0;
    this.slotOffset = (MINION_SEQ % 5) - 2;
    // Diamond Heart combat state. The other minions continue using the compact
    // generic state machine below.
    // Let the endgame summon demonstrate its kit quickly, then respect the
    // full cooldowns after the opening exchange.
    // Diamond Heart uses a deliberate rotation instead of repeatedly
    // selecting the first ranged move that comes off cooldown.
    this.spearCd = d.behavior === 'diamondHeart' ? 0.55 : (d.spearRate || 0);
    this.dashCd = d.behavior === 'diamondHeart' ? 0.65 : (d.dashRate || 0.9);
    this.beamCd = d.behavior === 'diamondHeart' ? 1.25 : 0;
    this.spearWindup = 0;
    this.spearTarget = null;
    this.spearAngle = 0;
    this.spearPulse = 0;
    this.dashTime = 0;
    this.dashAngle = 0;
    this.dashTarget = null;
    this.dashHits = new Set();
    this.dashTrailTimer = 0;
    this.dashChainRemaining = 0;
    this.dashRecovery = 0;
    this.dashVariant = false;
    this.dodgeTime = 0;
    this.dodgeAngle = 0;
    this.dodgeCd = 0;
    this.beamWindup = 0;
    this.beamActive = 0;
    this.beamTimer = 0;
    this.beamTickTimer = 0;
    this.beamBlinkCount = 0;
    this.beamFlash = 0;
    this.beamTarget = null;
    this.beamLines = [];
    this.beamY0 = 0;
    this.beamY1 = 0;
    this.beamHit = false;
    this.target = null;
    this.targetScanCd = 0;
    this.swordAngle = 0;
    this.diamondRetreat = 0;
    // AI bookkeeping.
    this.unreachTimer = 0;   // time spent unable to reach the current target
    this.returnTimer = 0;    // while >0, ignore targets and regroup on the owner
    this.stuckTimer = 0;
    this._lx = x; this._ly = y;
    // Flying minions (wisp/raven/emberling) may pass over terrain; grounded ones
    // (beetle/sentinel) should respect it more strictly.
    this.flying = !!d.flying || d.behavior === 'homing' || d.behavior === 'shooter' || d.behavior === 'dive';
    if (d.behavior === 'aidan') initAidanState(this);
  }

  // Enemies and bosses share a target interface. Diamond Heart is a minion,
  // but it must still provide a center point when a boss retargets it.
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  update(dt, game) {
    if (this.dead) return;
    this.anim += dt * (this.def.behavior === 'diamondHeart' ? 3.8 : this.def.behavior === 'aidan' ? 4.4 : 6);
    this._world = game.world; // used by grounded steering
    if (this.cd > 0) this.cd -= dt;
    if (this.returnTimer > 0) this.returnTimer -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackPulse > 0) this.attackPulse -= dt;
    if (this.spearPulse > 0) this.spearPulse -= dt;
    const owner = game.players.get(this.ownerId);
    if (!owner || !owner.alive) { this.dead = true; this.alive = false; return; }
    const oc = owner.center();

    if (this.def.behavior === 'diamondHeart') {
      this._updateDiamondHeart(dt, game, owner, oc);
      return;
    }
    if (this.def.behavior === 'aidan') {
      updateAidanState(this, game, owner, oc, dt);
      return;
    }
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

  _findDiamondTarget(game, cx, cy) {
    let best = null;
    let bestHp = -Infinity;
    let bestMaxHp = -Infinity;
    let bestDist = Infinity;
    const consider = (t) => {
      if (!t || t.dead || t.alive === false || t.hp == null || t.hp <= 0) return;
      const tc = t.center ? t.center() : { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const hp = Number(t.hp) || 0;
      const maxHp = Number(t.maxHp) || hp;
      const d = dist2(cx, cy, tc.x, tc.y);
      // Current HP is the primary key: the Heart helps finish the most
      // important surviving target instead of randomly swapping between foes.
      if (hp > bestHp || (hp === bestHp && (maxHp > bestMaxHp || (maxHp === bestMaxHp && d < bestDist)))) {
        best = t; bestHp = hp; bestMaxHp = maxHp; bestDist = d;
      }
    };
    for (const e of game.enemies) consider(e);
    for (const b of game.bosses) consider(b);
    return best;
  }

  _diamondAirCeiling(game, x) {
    const world = game.world;
    const tx = Math.floor(x / TILE);
    let highestSurface = world.surfaceY(tx);
    for (let dx = -DIAMOND_GROUND_SAMPLE; dx <= DIAMOND_GROUND_SAMPLE; dx++) {
      highestSurface = Math.min(highestSurface, world.surfaceY(tx + dx));
    }
    return highestSurface * TILE - this.h - DIAMOND_AIR_CLEARANCE;
  }

  _keepDiamondAboveSurface(game) {
    const ceiling = this._diamondAirCeiling(game, this.x + this.w / 2);
    if (this.y > ceiling) {
      this.y = ceiling;
      this.vy = Math.min(this.vy, -Math.max(80, this.def.speed * 0.45));
      this.diamondRetreat = Math.max(this.diamondRetreat, 0.28);
    }
  }

  _updateDiamondHeart(dt, game, owner, oc) {
    this.spearCd -= dt;
    this.dashCd -= dt;
    this.beamCd -= dt;
    this.dashTrailTimer -= dt;
    this.dashRecovery = Math.max(0, this.dashRecovery - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.beamFlash = Math.max(0, this.beamFlash - dt);
    this.diamondRetreat = Math.max(0, this.diamondRetreat - dt);

    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const ownerDist = Math.hypot(cx - oc.x, cy - oc.y);
    if (ownerDist > DIAMOND_LEASH) {
      this._teleportToOwner(game, oc);
      return;
    }

    // Recover to the air lane before evaluating LOS or choosing an attack.
    this._keepDiamondAboveSurface(game);

    if (this.dashTime > 0) {
      this._updateDiamondDash(dt, game);
      return;
    }

    this.targetScanCd -= dt;
    let target = this.target;
    const invalidTarget = !target || target.dead || target.alive === false || target.hp <= 0;
    if (invalidTarget || this.targetScanCd <= 0) {
      const highest = this._findDiamondTarget(game, cx, cy);
      // Re-scan often enough to notice a boss arriving after the Heart was
      // summoned, while keeping the target stable during a committed move.
      if (invalidTarget || !target || !highest || highest === target ||
          Number(highest.hp) >= Number(target.hp) || game.bosses.includes(highest)) {
        target = highest;
      }
      this.targetScanCd = 0.25;
    }
    this.target = target;

    // A dash chain and the beam telegraph own the Heart until their short
    // recovery windows finish. This prevents the spear branch from interrupting
    // either move.
    if (this.beamWindup > 0 || this.beamActive > 0) {
      this._updateDiamondBeam(dt, game, owner, target);
      return;
    }

    // A projectile that is on a real collision course gets an actual evasive
    // burst, not just a small orbit adjustment. The cooldown keeps this
    // skillful instead of making the Heart permanently untouchable.
    if (this.dodgeTime > 0) {
      this._updateDiamondEvasion(dt, game);
      return;
    }
    const dodge = this._diamondDodge(game, cx, cy);
    if (this.dodgeCd <= 0 && dodge.urgency >= 0.72) {
      this._beginDiamondEvasion(game, dodge);
      return;
    }

    if (this.dashRecovery > 0) {
      if (target) this._diamondHover(game, owner, target, dt, true);
      return;
    }
    if (this.dashChainRemaining > 0) {
      if (target) {
        this._beginDiamondDash(game, target, true);
        return;
      }
      this.dashChainRemaining = 0;
      this.dashVariant = false;
    }

    if (this.spearWindup > 0) {
      const live = this.spearTarget && !this.spearTarget.dead && this.spearTarget.alive !== false && this.spearTarget.hp > 0
        ? this.spearTarget : target;
      if (!live) {
        this.spearWindup = 0;
        this.spearTarget = null;
      } else {
        const tc = live.center();
        this.spearAngle = AI.leadShot(cx, cy, live, 520);
        this.swordAngle = this.spearAngle;
        this.facing = tc.x < cx ? -1 : 1;
        this._diamondHover(game, owner, live, dt, this.diamondRetreat > 0);
        this.spearWindup -= dt;
        if (this.spearWindup <= 0) this._fireDiamondSpear(game);
        return;
      }
    }

    if (!target) {
      this._diamondRegroup(game, oc, dt);
      return;
    }

    const tc = target.center();
    const dx = tc.x - cx, dy = tc.y - cy;
    const distance = Math.hypot(dx, dy);
    const los = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);
    const targetIsBoss = game.bosses.includes(target);
    this.facing = dx < 0 ? -1 : 1;
    this.swordAngle = Math.atan2(dy, dx);

    this._diamondHover(game, owner, target, dt, this.diamondRetreat > 0);

    // Use the spear between beam casts. The longer setup range and a real
    // cooldown make it a regular part of the rotation without turning it into
    // a spam button.
    if (this.diamondRetreat <= 0 && this.spearCd <= 0 && this.beamCd > 0 &&
        (los || targetIsBoss) && distance > 260) {
      this._beginDiamondSpear(game, target);
      return;
    }

    // The sky-beam is a deliberate rotation anchor. Once it is ready, use it
    // from the Heart's flight lane instead of waiting for an unusually long
    // line of sight; this guarantees the new move actually appears in play.
    if (this.diamondRetreat <= 0 && this.beamCd <= 0 && distance > 190) {
      this._beginDiamondBeam(game, target);
      return;
    }

    // Close the lane deliberately and dash from a real approach distance.
    // The Heart now commits whenever it is in the broad approach window, so it
    // cannot orbit forever without performing the melee part of its kit.
    if (this.diamondRetreat <= 0 && this.dashCd <= 0 && (los || targetIsBoss) &&
        distance > 105 && distance < 360) {
      this._beginDiamondDash(game, target);
      return;
    }
  }

  _updateDiamondBeam(dt, game, owner, fallbackTarget) {
    const target = this.beamTarget && !this.beamTarget.dead &&
      this.beamTarget.alive !== false && this.beamTarget.hp > 0
      ? this.beamTarget
      : fallbackTarget;

    if (target) this._diamondHover(game, owner, target, dt, true);
    else this._diamondRegroup(game, game.players.get(this.ownerId)?.center() || { x: this.x, y: this.y }, dt);

    if (this.beamWindup > 0) {
      this.beamTimer += dt;
      const blinkInterval = this.def.beamBlinkInterval || 0.3;
      const nextBlink = Math.min(2, Math.floor(this.beamTimer / blinkInterval));
      if (nextBlink > this.beamBlinkCount) {
        this.beamBlinkCount = nextBlink;
        this.beamFlash = this.def.beamFlashDuration || 0.1;
        for (const x of this.beamLines) {
          game.fx?.ring(x, this.beamY1, '#ffd34e', 16, { life: 0.1, width: 2 });
          game.fx?.streak(x, this.beamY1, -Math.PI / 2, '#ffe27a', 3, {
            speed: 110, spread: 0.16, life: 0.1, size: 2, glow: true,
          });
        }
      }
      // Two yellow flashes at 0.3s and 0.6s. The final beam starts only
      // after the second flash has returned to black.
      if (this.beamTimer >= (this.def.beamWindup || 0.7)) this._fireDiamondBeam(game);
      return;
    }

    if (this.beamActive > 0) {
      this.beamTickTimer -= dt;
      while (this.beamActive > 0 && this.beamTickTimer <= 0) {
        this.beamTickTimer += this.def.beamTick || 0.1;
        this._tickDiamondBeam(game);
      }
      this.beamActive = Math.max(0, this.beamActive - dt);
      if (this.beamActive <= 0) {
        this.beamTarget = null;
        this.beamLines = [];
        this.beamHit = false;
        this.beamTickTimer = 0;
        this.diamondRetreat = 0.45;
      }
    }
  }

  _beginDiamondBeam(game, target) {
    const tc = target.center();
    this.beamTarget = target;
    this.beamLines = [tc.x - 42, tc.x, tc.x + 42];
    this.beamY0 = tc.y - 620;
    this.beamY1 = tc.y + 620;
    this.beamTimer = 0;
    this.beamTickTimer = 0;
    this.beamBlinkCount = 0;
    this.beamFlash = 0;
    this.beamWindup = this.def.beamWindup || 0.7;
    this.beamActive = 0;
    this.beamHit = false;
    this.beamCd = this.def.beamRate || 5.2;
    this.spearWindup = 0;
    this.spearTarget = null;
    this.dashChainRemaining = 0;
    this.dashRecovery = 0;
    this.dashVariant = false;
    this.lastAttack = 'beam';

    // The telegraph itself is rendered as three dark lines. The only color
    // changes before impact are the two short yellow flashes above.

  }

  _fireDiamondBeam(game) {
    const target = this.beamTarget;
    this.beamWindup = 0;
    this.beamActive = this.def.beamDuration || 2.5;
    this.beamTickTimer = 0;
    this.beamHit = true;

    if (target && !target.dead && target.alive !== false && target.hp > 0) {
      const tc = target.center();
      for (const x of this.beamLines) {
        game.fx?.ring(x, tc.y, '#fff4b0', 16, { life: 0.12, width: 1.5 });
      }
      game.fx?.ring(tc.x, tc.y, '#fff4b0', 28, { life: 0.16, width: 2 });
      game.shake?.(2, 0.08);
    }
    this.lastAttack = 'beamFire';
  }

  _diamondBeamHitsTarget(target) {
    const top = Math.min(this.beamY0, this.beamY1);
    const bottom = Math.max(this.beamY0, this.beamY1);
    if (target.y > bottom || target.y + target.h < top) return false;

    const halfWidth = (this.def.beamHitWidth || 18) / 2;
    return this.beamLines.some((lineX) =>
      target.x <= lineX + halfWidth &&
      target.x + target.w >= lineX - halfWidth
    );
  }

  _tickDiamondBeam(game) {
    // The beam is a real three-column hazard. It can hit any enemy or boss
    // whose hitbox overlaps a column, but cannot damage a target that moved
    // outside all three visible lines.
    const targets = [...game.enemies, ...game.bosses];
    for (const target of targets) {
      if (!target || target.dead || target.alive === false || target.hp <= 0) continue;
      if (!this._diamondBeamHitsTarget(target)) continue;
      game.hurtEnemyOrBoss(target, this.def.beamDamage || 3, 0, this.ownerId);
    }
  }

  _diamondHover(game, owner, target, dt, retreat = false) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const tc = target.center();
    const orbit = this.anim * 0.72 + this.id * 0.9;
    // Keep a real combat lane around melee enemies. The Heart only closes for
    // its deliberate dash; otherwise it fights from a wide, readable orbit.
    const radius = retreat
      ? 300 + Math.sin(this.anim * 0.43) * 18
      : DIAMOND_SAFE_RADIUS + Math.sin(this.anim * 0.43) * 20;
    const dodge = this._diamondDodge(game, cx, cy);
    const threat = this._diamondThreatVector(game, cx, cy);
    const pushScale = retreat ? 220 : 165;
    const dodgeScale = retreat ? 260 : 220;
    let desiredX = tc.x + Math.cos(orbit) * radius + dodge.x * dodgeScale + threat.x * pushScale;
    let desiredY = tc.y - 58 + Math.sin(orbit * 1.15) * (retreat ? 48 : 60) + dodge.y * dodgeScale + threat.y * pushScale;

    // Correct aggressively if any enemy closes the gap between steering
    // updates. This uses every nearby threat, not just the Heart's current
    // highest-HP target, so a second slime cannot sneak into contact range.
    const gapX = cx - tc.x, gapY = cy - tc.y;
    const gap = Math.hypot(gapX, gapY);
    const minGap = retreat ? 340 : 265;
    if (gap < minGap) {
      const len = gap || 1;
      desiredX = tc.x + (gapX / len) * (retreat ? 390 : 315) + threat.x * 80;
      desiredY = tc.y + (gapY / len) * (retreat ? 390 : 315) + threat.y * 80;
    }

    // The orbit/dodge offsets can otherwise aim below a hill or surface ledge.
    // Clamp the requested position before steering so LOS is evaluated from air.
    desiredY = Math.min(desiredY, this._diamondAirCeiling(game, desiredX));
    this._steer(desiredX, desiredY, this.def.speed, dt);
  }

  _diamondRegroup(game, oc, dt) {
    const dodge = this._diamondDodge(game, this.x + this.w / 2, this.y + this.h / 2);
    const desiredX = oc.x + this.slotOffset * 30 + dodge.x * 90;
    let desiredY = oc.y - 92 + Math.sin(this.anim * 0.8) * 12 + dodge.y * 90;
    desiredY = Math.min(desiredY, this._diamondAirCeiling(game, desiredX));
    this.swordAngle = this.facing > 0 ? 0.15 : Math.PI - 0.15;
    this._steer(desiredX, desiredY, this.def.speed * 0.82, dt);
  }

  _diamondThreatVector(game, cx, cy) {
    let pushX = 0, pushY = 0;
    const consider = (t) => {
      if (!t || t.dead || t.alive === false || t.hp <= 0) return;
      const tc = t.center ? t.center() : { x: t.x + t.w / 2, y: t.y + t.h / 2 };
      const dx = cx - tc.x, dy = cy - tc.y;
      const distance = Math.hypot(dx, dy);
      const safe = t === this.target ? DIAMOND_SAFE_RADIUS + 24 : DIAMOND_SAFE_RADIUS;
      if (distance >= safe) return;
      const urgency = (safe - distance) / safe;
      const weight = t === this.target ? 0.9 : 1.25;
      pushX += (dx / (distance || 1)) * urgency * weight;
      pushY += (dy / (distance || 1)) * urgency * weight;
    };
    for (const e of game.enemies) consider(e);
    for (const b of game.bosses) consider(b);
    const len = Math.hypot(pushX, pushY);
    return len > 1 ? { x: pushX / len, y: pushY / len } : { x: pushX, y: pushY };
  }

  _diamondDodge(game, cx, cy) {
    let pushX = 0, pushY = 0;
    let urgency = 0;
    const predictionWindow = 1.0;

    for (const pr of game.projectiles) {
      if (!pr || pr.dead || (pr.ownerType !== 'enemy' && pr.ownerType !== 'boss')) continue;
      const px = pr.x + pr.w / 2, py = pr.y + pr.h / 2;
      const vx = pr.vx || 0, vy = pr.vy || 0;
      const speed2 = vx * vx + vy * vy;
      if (speed2 < 100) continue;

      const rx = cx - px, ry = cy - py;
      const t = Math.max(0, Math.min(predictionWindow, (rx * vx + ry * vy) / speed2));
      const nx = px + vx * t, ny = py + vy * t;
      const dd = Math.hypot(cx - nx, cy - ny);
      const danger = 175 + Math.max(pr.w, pr.h) * 0.8;
      if (dd >= danger) continue;

      const proximity = Math.max(0.1, danger - dd) / danger;
      const timePressure = 1 - t / predictionWindow;
      const threat = proximity * (0.58 + timePressure * 0.42);
      urgency = Math.max(urgency, threat);

      pushX += (cx - nx) / Math.max(1, dd) * threat;
      pushY += (cy - ny) / Math.max(1, dd) * threat;

      // Bias the dodge sideways so a projectile's predicted path does not
      // keep intersecting the Heart while it retreats directly backward.
      const sp = Math.sqrt(speed2);
      const side = (this.id & 1) ? 1 : -1;
      pushX += (-vy / sp) * threat * side * 0.9;
      pushY += (vx / sp) * threat * side * 0.9;
    }

    // Contact attacks and committed charges do not necessarily create a
    // projectile. Read the hostile entity's live attack state as well, so a
    // telegraphed leap or a fast enemy closing the last few pixels can trigger
    // the same limited sidestep.
    const attack = this._diamondAttackThreat(game, cx, cy);
    if (attack.urgency > urgency) {
      pushX += attack.x * attack.urgency;
      pushY += attack.y * attack.urgency;
      urgency = attack.urgency;
    }

    const len = Math.hypot(pushX, pushY);
    return len > 1
      ? { x: pushX / len, y: pushY / len, urgency }
      : { x: 0, y: 0, urgency: 0 };
  }

  _diamondAttackThreat(game, cx, cy) {
    let pushX = 0, pushY = 0, urgency = 0;
    const consider = (source) => {
      if (!source || source.dead || source.alive === false || source.hp <= 0) return;
      const sc = source.center ? source.center() : { x: source.x + source.w / 2, y: source.y + source.h / 2 };
      const dx = cx - sc.x, dy = cy - sc.y;
      const distance = Math.hypot(dx, dy);
      const pending = source.pendingAttack || source.chosen?.type;
      const committed = !!source.charge || (source.dashTime || 0) > 0;
      const telegraphing = source.telegraph > 0 && (pending === 'charge' || pending === 'leap');
      const dangerRange = committed ? 260 : telegraphing ? 210 : 96;
      if (distance >= dangerRange) return;

      let threat = (dangerRange - distance) / dangerRange;
      const toward = (source.vx || 0) * dx + (source.vy || 0) * dy > 0;
      if (toward) threat += 0.18;
      if (committed) threat = Math.max(threat, 0.86);
      else if (telegraphing) threat = Math.max(threat, 0.76);
      threat = Math.min(1, threat);
      urgency = Math.max(urgency, threat);

      const len = distance || 1;
      const awayX = distance > 0 ? dx / len : -Math.sign(source.facing || 1);
      const awayY = distance > 0 ? dy / len : 0;
      pushX += awayX * threat;
      pushY += awayY * threat;

      const speed = Math.hypot(source.vx || 0, source.vy || 0);
      if (speed > 20) {
        const side = (this.id & 1) ? 1 : -1;
        pushX += (-source.vy / speed) * threat * side * 0.65;
        pushY += (source.vx / speed) * threat * side * 0.65;
      }
    };
    for (const e of game.enemies) consider(e);
    for (const b of game.bosses) consider(b);

    const len = Math.hypot(pushX, pushY);
    return len > 1
      ? { x: pushX / len, y: pushY / len, urgency }
      : { x: pushX, y: pushY, urgency };
  }

  // Last-moment projectile guard. The predictive routine normally moves first;
  // this fallback covers a projectile that crosses the hitbox later in the
  // same fixed-timestep update. One dodge consumes the shared cooldown.
  tryDodgeProjectile(game) {
    if (this.def.behavior !== 'diamondHeart') return false;
    if (this.dodgeTime > 0) return true;
    if (this.dodgeCd > 0) return false;
    const dodge = this._diamondDodge(game, this.x + this.w / 2, this.y + this.h / 2);
    const direction = dodge.urgency > 0 ? dodge : { x: this.facing || 1, y: -0.35 };
    this._beginDiamondEvasion(game, { ...direction, urgency: 1 });
    return true;
  }

  // Contact guard used by enemies and bosses before they apply melee damage.
  // It is intentionally cooldown-limited: if the Heart has already spent its
  // sidestep recently, the attack still lands normally.
  tryDodgeContact(game, source) {
    if (this.def.behavior !== 'diamondHeart') return false;
    if (this.dodgeTime > 0) return true;
    if (this.dodgeCd > 0) return false;

    const c = this.center();
    const s = source.center ? source.center() : { x: source.x + source.w / 2, y: source.y + source.h / 2 };
    const dx = c.x - s.x, dy = c.y - s.y;
    const distance = Math.hypot(dx, dy) || 1;
    let x = dx / distance, y = dy / distance;
    const speed = Math.hypot(source.vx || 0, source.vy || 0);
    if (speed > 20) {
      const side = (this.id & 1) ? 1 : -1;
      x += (-source.vy / speed) * side * 0.7;
      y += (source.vx / speed) * side * 0.7;
    }
    const len = Math.hypot(x, y) || 1;
    this._beginDiamondEvasion(game, { x: x / len, y: y / len, urgency: 1 });
    return true;
  }

  _beginDiamondEvasion(game, dodge) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    const len = Math.hypot(dodge.x, dodge.y) || 1;
    const speed = this.def.dodgeSpeed || 720;

    this.dodgeAngle = Math.atan2(dodge.y, dodge.x);
    this.dodgeTime = this.def.dodgeDuration || 0.22;
    this.dodgeCd = this.def.dodgeRate || 1.0;
    this.diamondRetreat = Math.max(this.diamondRetreat, 0.6);
    this.spearWindup = 0;
    this.spearTarget = null;
    this.vx = (dodge.x / len) * speed;
    this.vy = (dodge.y / len) * speed;
    this.attackPulse = this.dodgeTime;

    game.fx?.ring(cx, cy, '#dffcff', 30, { life: 0.16, width: 2 });
    game.fx?.streak(cx, cy, this.dodgeAngle, '#8be9ff', 8, {
      speed: 220, spread: 0.2, life: 0.24, size: 2.5, glow: true,
    });
  }

  _updateDiamondEvasion(dt, game) {
    const ox = this.x, oy = this.y;
    const speed = this.def.dodgeSpeed || 720;
    this.x += Math.cos(this.dodgeAngle) * speed * dt;
    this.y += Math.sin(this.dodgeAngle) * speed * dt;
    if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
      this.x = ox;
      this.y = oy;
      this.vx *= -0.35;
      this.vy *= -0.35;
    }
    this._keepDiamondAboveSurface(game);

    if (this.dashTrailTimer <= 0) {
      this.dashTrailTimer = 0.035;
      game.fx?.trail(this.x + this.w / 2, this.y + this.h / 2, '#8be9ff', { size: 4, life: 0.2 });
    }

    this.dodgeTime -= dt;
    if (this.dodgeTime <= 0) {
      this.dodgeTime = 0;
      this.vx *= 0.25;
      this.vy *= 0.25;
      game.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 8, {
        speed: 90, life: 0.25, glow: true,
      });
    }
  }

  _beginDiamondSpear(game, target) {
    this.spearTarget = target;
    this.spearWindup = 0.3;
    this.spearPulse = 0.3;
    this.spearCd = this.def.spearRate || 3.8;
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    this.spearAngle = AI.leadShot(c, d, target, 520);
    this.swordAngle = this.spearAngle;
    game.fx?.ring(c, d, '#dffcff', 34, { life: 0.3, width: 2 });
    game.fx?.streak(c, d, this.spearAngle, '#dffcff', 7, { speed: 90, spread: 0.24, life: 0.24, size: 2, glow: true });
  }

  _fireDiamondSpear(game) {
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    const a = this.spearAngle;
    const speed = 520;
    game.addProjectile(new Projectile({
      x: c + Math.cos(a) * 18 - 9, y: d + Math.sin(a) * 18 - 3,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      w: 18, h: 6,
      damage: this.def.spearDamage || 16,
      ownerType: 'minion', ownerId: this.ownerId,
      kind: 'diamondSpear', color: '#dffcff',
      life: 2.4, knockback: 5, trail: '#8be9ff',
      burstCount: 20, burstDamage: 5, burstKind: 'miniDiamondSpear',
      burstColor: '#8be9ff', burstSpeed: 230, burstLife: 1.35,
      burstDelay: 0.3, burstHoming: true, burstHomingStrength: 2.4,
    }), true);
    game.audio?.magicCast?.();
    game.fx?.streak(c, d, a, '#dffcff', 10, { speed: 220, spread: 0.34, life: 0.3, size: 2, glow: true });
    this.spearPulse = 0.18;
    this.spearWindup = 0;
    this.spearTarget = null;
    this.lastAttack = 'spear';
  }

  _beginDiamondDash(game, target, continuing = false) {
    const c = this.x + this.w / 2, d = this.y + this.h / 2;
    const tc = target.center();
    const safeTargetY = Math.min(
      tc.y,
      this._diamondAirCeiling(game, tc.x) + this.h / 2
    );

    if (!continuing) {
      this.dashChainRemaining = Math.random() < (this.def.dashTripleChance || 0.34) ? 3 : 1;
      this.dashVariant = this.dashChainRemaining === 3;
      this.dashCd = this.def.dashRate || 1.85;
      this.lastAttack = this.dashVariant ? 'tripleDash' : 'dash';
    }

    this.dashAngle = Math.atan2(safeTargetY - d, tc.x - c);
    this.dashTime = this.def.dashDuration || 0.3;
    this.diamondRetreat = continuing ? 0 : 0.18;
    this.dashTarget = target;
    this.dashHits = new Set();
    this.attackPulse = this.dashTime;
    this.swordAngle = this.dashAngle;
    this.vx = Math.cos(this.dashAngle) * (this.def.dashSpeed || 820);
    this.vy = Math.sin(this.dashAngle) * (this.def.dashSpeed || 820);
    game.fx?.ring(c, d, this.dashVariant ? '#ffd86b' : '#ffffff', this.dashVariant ? 44 : 32, { life: 0.22, width: 2 });
    game.fx?.streak(c, d, this.dashAngle, this.dashVariant ? '#ffd86b' : '#8be9ff', 12, {
      speed: 230, spread: 0.22, life: 0.28, size: 3, glow: true,
    });
  }

  _updateDiamondDash(dt, game) {
    const ox = this.x, oy = this.y;
    const speed = this.def.dashSpeed || 760;
    this.x += Math.cos(this.dashAngle) * speed * dt;
    this.y += Math.sin(this.dashAngle) * speed * dt;
    if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
      this.x = ox; this.y = oy; this.dashTime = 0;
    }
    this._keepDiamondAboveSurface(game);

    const sweep = {
      x: Math.min(ox, this.x) - 5,
      y: Math.min(oy, this.y) - 5,
      w: Math.abs(this.x - ox) + this.w + 10,
      h: Math.abs(this.y - oy) + this.h + 10,
    };
    const damage = this.def.dashDamage || 20;
    const hit = (target) => {
      if (!target || target.dead || target.alive === false || this.dashHits.has(target)) return;
      if (!aabb(sweep, target)) return;
      this.dashHits.add(target);
      game.hurtEnemyOrBoss(target, damage, Math.sign(this.vx) * 7, this.ownerId);
      const tc = target.center();
      game.addHitParticles(tc.x, tc.y, '#dffcff', 10);
      game.fx?.ring(tc.x, tc.y, '#dffcff', 26, { life: 0.2, width: 2 });
    };
    for (const e of game.enemies) hit(e);
    for (const b of game.bosses) hit(b);

    if (this.dashTrailTimer <= 0) {
      this.dashTrailTimer = 0.035;
      game.fx?.trail(this.x + this.w / 2, this.y + this.h / 2, '#8be9ff', { size: 4, life: 0.24 });
    }
    this.dashTime -= dt;
    if (this.dashTime <= 0) {
      this.dashTime = 0;
      this.dashChainRemaining = Math.max(0, this.dashChainRemaining - 1);
      this.vx *= 0.25; this.vy *= 0.25;
      game.fx?.burst(
        this.x + this.w / 2, this.y + this.h / 2,
        this.dashVariant ? '#ffd86b' : '#dffcff',
        this.dashVariant ? 14 : 10,
        { speed: 100, life: 0.35, glow: true }
      );
      if (this.dashChainRemaining > 0) {
        this.dashRecovery = 0.12;
        this.diamondRetreat = 0.04;
        game.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#ffd86b', 28, {
          life: 0.16, width: 2,
        });
      } else {
        this.dashTarget = null;
        this.dashVariant = false;
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
    if (this.def.behavior === 'diamondHeart') this._keepDiamondAboveSurface(game);
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

  takeDamage(amount, knockbackX, game, srcName) {
    if (this.dead || !this.isMinion || this.maxHp == null || this.iframes > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = this.def.behavior === 'diamondHeart' ? 0.85 : 0.28;
    this.hurtFlash = 0.16;
    this.vx += (knockbackX || 0) * 5;
    if (this.key === 'aidan' && game && dmg > 0 &&
        !(this.freezeWindup > 0 || this.freezeActive > 0)) {
      // A single poke should not pull out the freeze gun. Build pressure over
      // a short rolling window, then queue one response only after sustained
      // aggression. The controller consumes this pending response after any
      // active move has finished.
      const triggerWindow = this.def.freezeTriggerWindow || 2.5;
      this.freezeDefenseWindow = Math.max(this.freezeDefenseWindow || 0, triggerWindow);
      this.freezeDefenseHitCount = (this.freezeDefenseHitCount || 0) + 1;
      this.freezeDefenseDamage = (this.freezeDefenseDamage || 0) + dmg;
      const triggerHits = this.def.freezeTriggerHits || 3;
      const triggerDamage = this.def.freezeTriggerDamage || 24;
      const enoughPressure = this.freezeDefenseHitCount >= triggerHits ||
        (this.freezeDefenseHitCount >= 2 && this.freezeDefenseDamage >= triggerDamage);
      if (!this.freezeDefensePending && (this.freezeCooldown || 0) <= 0 && enoughPressure) {
        const threat = game.nearestEnemyOrBoss?.(
          this.x + this.w / 2, this.y + this.h / 2, this.def.freezeRange || 900
        );
        if (threat) {
          this.freezeTarget = threat;
          this.freezeDefensePending = true;
        }
      }
    }
    if (this.def.behavior === 'diamondHeart') {
      // A hit is an immediate reposition command: cancel a wind-up, break
      // contact, and spend a short window in the wider retreat orbit.
      this.spearWindup = 0;
      this.spearTarget = null;
      this.diamondRetreat = Math.max(this.diamondRetreat, 1.35);
      const escape = this._diamondThreatVector(
        game, this.x + this.w / 2, this.y + this.h / 2
      );
      if (escape) {
        this.vx = escape.x * this.def.speed;
        this.vy = escape.y * this.def.speed;
      }
    }
    game?.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 7);
    game?.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#dffcff');
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dead = true;
      game?.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#dffcff', 46, { life: 0.35, width: 3 });
      game?.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#8be9ff', 24, { speed: 170, life: 0.7, glow: true });
      game?.toast?.('Diamond Heart shattered.', 'bad');
    }
  }

  netInfo() {
    return {
      key: this.key, x: Math.round(this.x), y: Math.round(this.y), f: this.facing,
      hp: this.maxHp != null ? Math.round(this.hp) : null,
      maxHp: this.maxHp,
      dead: this.dead ? 1 : 0,
      pose: this.key === 'aidan' ? this.pose : undefined,
      mv: this.key === 'aidan' ? Math.round((this.moveAmount || 0) * 100) / 100 : undefined,
      frz: this.key === 'aidan' ? Math.round((this.freezeWindup || 0) * 100) / 100 : undefined,
    };
  }
}
