// Summoner Realms — enemy entity. Simulated on the host; replicated to clients.
//
// AI is reactive steering plus jump heuristics — the same lightweight approach
// Terraria itself uses (no per-frame pathfinding), so it stays cheap with a full
// screen of enemies. What makes it *feel* smarter:
//   • Each enemy gets a little personality (pace, timing, aggression) so a pack
//     doesn't move in lockstep.
//   • Ground enemies hop ledges AND leap real gaps (but not into bottomless
//     pits), and take a detour when genuinely wedged, so they rarely get stuck.
//   • Every behaviour reads distinctly: slimes vary their hops, chargers wind up
//     before a dash, bats weave, casters keep their distance / strafe / blink and
//     only fire when they can actually see you.
//   • Expensive line-of-sight is sampled a few times a second, not every frame.
import { TILE } from '../config.js';
import { ENEMIES } from '../data/enemies.js';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js';
import { aabb } from '../utils.js';
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
    this.jumpCd = Math.random() * 0.6;
    this.climbCd = 0;
    this.dashCd = 1 + Math.random() * 2;
    this.dashTime = 0; this.dashVel = 0; this.windup = 0;
    // Stuck detection / detour routing for ground navigation.
    this._lastX = x;
    this.stuckTimer = 0;
    this.detourDir = 0;
    this.detourTimer = 0;
    // Per-enemy personality so encounters don't feel uniform.
    this.speedVar = 0.85 + Math.random() * 0.3;     // ±15% pace
    this.aggression = 0.8 + Math.random() * 0.4;     // eagerness to dash / rarity of pauses
    this.wobblePhase = Math.random() * Math.PI * 2;  // flyer weave / caster strafe phase
    this.pauseTimer = 0;                             // brief walker hesitations
    this.blinkCd = 2 + Math.random() * 2;            // caster teleport cooldown
    // Throttled awareness (line of sight to the target), refreshed a few times/sec.
    this.senseCd = Math.random() * 0.2;
    this.hasLOS = false;
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
    if (this.behavior !== 'charger' || (this.windup <= 0 && this.dashTime <= 0)) {
      this.facing = dx < 0 ? -1 : 1;
    }

    // Refresh line of sight on a stagger so it's cheap across many enemies.
    this.senseCd -= dt;
    if (this.senseCd <= 0) {
      this.senseCd = 0.18 + Math.random() * 0.08;
      this.hasLOS = game.world.hasLineOfSight(cx, cy, tc.x, tc.y);
    }

    // Chilled enemies (frost weapons) actually move slower now.
    const spd = this.speed * this.speedVar * (this.slowT > 0 ? 0.55 : 1);
    // Ground navigation: if pinned against terrain making no progress, route the
    // other way briefly instead of grinding into the same block forever.
    const moveDir = this._navDir(dt, dx);

    switch (this.behavior) {
      case 'flyer': {
        // Weaving pursuit: heading toward the player plus a sideways flutter and a
        // gentle bob, eased in so bats flit rather than track in a dead-straight line.
        this.wobblePhase += dt * 6;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len, ny = dy / len;
        const weave = Math.sin(this.wobblePhase) * 0.6;      // perpendicular flutter
        const bob = Math.cos(this.wobblePhase * 0.5) * 0.15;
        const vxT = (nx + -ny * weave) * spd;
        const vyT = (ny + nx * weave + bob) * spd;
        const k = Math.min(1, dt * 4);
        this.vx += (vxT - this.vx) * k;
        this.vy += (vyT - this.vy) * k;
        this.x += this.vx * dt; this.y += this.vy * dt;
        if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
          this.x -= this.vx * dt; this.y -= this.vy * dt;
          this.vx *= -0.4; this.vy -= 40; this.y -= 2; // peel off the wall it clipped
        }
        break;
      }
      case 'hopper': {
        applyGravity(this, dt);
        if (this.onGround) {
          this.vx *= 0.7; // settle between hops
          this.jumpCd -= dt;
          if (this.jumpCd <= 0) {
            // Vary cadence and height; bigger leap to reach a player above or far off.
            const big = dy < -20 || (Math.abs(dx) > 120 && Math.random() < 0.4);
            this.vy = big ? -430 : -240 - Math.random() * 90;
            this.vx = moveDir * spd * (big ? 3.4 : 2.4);
            this.jumpCd = (big ? 1.3 : 0.85) + Math.random() * 0.5 / this.aggression;
          }
        }
        moveAndCollide(this, game.world, dt);
        break;
      }
      case 'charger': {
        applyGravity(this, dt);
        this.dashCd -= dt;
        if (this.windup > 0) {
          // Telegraph: plant, face the target, then launch — readable and fair.
          this.windup -= dt; this.vx = 0;
          if (this.windup <= 0) { this.dashVel = this.facing * spd * 3.4; this.dashTime = 0.45; }
        } else if (this.dashTime > 0) {
          this.dashTime -= dt; this.vx = this.dashVel;
        } else {
          this.vx = moveDir * spd;
          if (this.dashCd <= 0 && this.hasLOS && Math.abs(dy) < 60 && Math.abs(dx) < 260 && this.detourTimer <= 0) {
            this.windup = 0.35; this.dashCd = 2.6 + Math.random() * 1.5 / this.aggression;
            this.facing = dx < 0 ? -1 : 1;
            game.addHitParticles(cx, cy, this.color2 || this.color, 4);
          }
          this._climb(game, dt, moveDir);
        }
        moveAndCollide(this, game.world, dt);
        break;
      }
      case 'caster': {
        applyGravity(this, dt);
        this.blinkCd -= dt;
        const d = Math.hypot(dx, dy);
        if (d < 140) this.vx = -Math.sign(dx) * spd;        // too close: give ground
        else if (d > 260) this.vx = moveDir * spd;          // too far: close in
        else { this.wobblePhase += dt * 2; this.vx = Math.sin(this.wobblePhase) * spd * 0.85; } // strafe
        this._climb(game, dt, Math.sign(this.vx) || moveDir);
        moveAndCollide(this, game.world, dt);
        // Blink out if cornered or sight has been blocked while pursuing.
        if (this.blinkCd <= 0 && (d < 90 || (!this.hasLOS && d < 340))) {
          this._blink(game, tc);
          this.blinkCd = 3.5 + Math.random() * 2;
        }
        this.fireCd -= dt;
        if (this.fireCd <= 0 && d < 360 && this.hasLOS) {   // only shoot with a clear line
          this.fireCd = 1.7 + Math.random() * 0.6;
          const pj = this.def.projectile;
          const len = Math.hypot(dx, dy) || 1;
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: (dx / len) * pj.speed, vy: (dy / len) * pj.speed,
            damage: pj.damage, ownerType: 'enemy', ownerId: this.netId, kind: pj.kind, color: pj.color, life: 4,
          }), true);
        }
        break;
      }
      default: { // walker (fighter): press toward the player, hop terrain, hesitate rarely
        applyGravity(this, dt);
        if (this.pauseTimer > 0) { this.pauseTimer -= dt; this.vx = 0; }
        else {
          this.vx = moveDir * spd;
          // Only hesitate at a distance (never freeze mid-melee); high aggression pauses less.
          if (this.onGround && Math.abs(dx) > 80 && Math.random() < 0.004 * (2 - this.aggression)) {
            this.pauseTimer = 0.3 + Math.random() * 0.4;
          }
          this._climb(game, dt, moveDir);
        }
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

  // Hop ledges/obstacles (up to 2 tiles) AND leap crossable gaps while on the
  // ground — with headroom to rise and land (never headbutt a ceiling), never
  // into a bottomless pit, and on a short cooldown so enemies don't pogo. Taller
  // walls are left to the stuck-detour logic. A firm horizontal carry is applied
  // so even slow enemies actually clear what they jump.
  _climb(game, dt, dir) {
    if (this.climbCd > 0) this.climbCd -= dt;
    if (!this.onGround || this.climbCd > 0) return;
    dir = dir || this.facing;
    const w = game.world;
    const cxTile = Math.floor((this.x + this.w / 2) / TILE);
    const footTy = Math.floor((this.y + this.h + 1) / TILE); // solid floor row underfoot
    const aheadTile = cxTile + (dir >= 0 ? 1 : -1);
    const bodyTiles = Math.max(1, Math.round(this.h / TILE));

    // How tall is the obstacle right ahead (blocks stacked at foot level)?
    let obH = 0;
    while (obH < 3 && w.isSolidAt(aheadTile, footTy - 1 - obH)) obH++;
    const wantHop = obH > 0 || this.hitWallX;
    if (obH >= 3) return; // unclimbable here — the detour will route around it

    // A gap to leap: no floor in the next column, but ground resumes within reach.
    const gap = !w.isSolidAt(aheadTile, footTy) && !w.isSolidAt(aheadTile, footTy - 1);
    let landing = false;
    if (gap) for (let k = 2; k <= 3; k++) if (w.isSolidAt(cxTile + (dir >= 0 ? k : -k), footTy)) { landing = true; break; }

    if (!wantHop && !(gap && landing)) return;

    if (wantHop) {
      // Need clear air to rise where we are and to land on top of the obstacle.
      const topRow = footTy - obH;            // surface we'd land on
      for (let r = 1; r <= bodyTiles; r++) {
        if (w.isSolidAt(cxTile, footTy - bodyTiles - r + 1)) return; // no headroom to rise
        if (w.isSolidAt(aheadTile, topRow - r)) return;              // landing blocked
      }
    }

    this.vy = obH >= 2 ? -400 : -320;
    this.vx = dir * Math.max(80, this.speed * this.speedVar);
    this.climbCd = 0.5;
  }

  // Corruption blink: reappear a short way off, level with the target and with a
  // clear line to it. Gives casters an evasive, distinct feel.
  _blink(game, tc) {
    const w = game.world;
    const tyRow = Math.floor(tc.y / TILE);
    for (let i = 0; i < 8; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const tx = Math.floor((tc.x + side * (120 + Math.random() * 130)) / TILE);
      for (let ty = tyRow - 2; ty <= tyRow + 3; ty++) {
        if (w.isSolidAt(tx, ty) || w.isSolidAt(tx, ty - 1) || !w.isSolidAt(tx, ty + 1)) continue;
        const nx = tx * TILE + (TILE - this.w) / 2, ny = ty * TILE - this.h + (TILE - 1);
        if (w.rectHitsSolid(nx, ny, this.w, this.h)) continue;
        if (!w.hasLineOfSight(nx + this.w / 2, ny + this.h / 2, tc.x, tc.y)) continue;
        game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color2 || this.color, 10);
        this.x = nx; this.y = ny; this.vx = 0; this.vy = 0;
        game.addHitParticles(nx + this.w / 2, ny + this.h / 2, this.color2 || this.color, 10);
        return;
      }
    }
  }

  takeDamage(amount, kbx, kby, game, effect, crit) {
    if (this.dead) return;
    const kbResist = 1 - (this.def.kbResist || 0);
    this.hp -= amount;
    this.hurtFlash = 0.12;
    this.iframes = 0.05;
    this.vx += kbx * 24 * kbResist;
    if (kby) this.vy += kby * 40 * kbResist; else this.vy -= 40 * kbResist;
    if (effect) this._applyEffect(effect);
    if (game) game.floatText(this.x + this.w / 2, this.y, Math.round(amount) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; if (game) game.onEnemyDeath(this); }
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
