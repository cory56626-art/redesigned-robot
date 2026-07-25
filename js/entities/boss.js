// Summoner Realms — boss entity. Multi-phase AI, host-authoritative.
import { TILE } from '../config.js';
import { BOSSES } from '../data/bosses.js';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js';
import { aabb, angleTo, randRange } from '../utils.js';
import { Projectile } from './projectile.js';

const PROJ_COLOR = { thorn: '#7ee08a', rock: '#8a7a5a', blight: '#c58bff', voidorb: '#b06bff' };

export class Boss {
  constructor(key, x, y) {
    const d = BOSSES[key];
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
    this.attackTimers = [];
    this._initPhaseTimers();
    this.dead = false;
    this.hurtFlash = 0;
    this.state = null; // {type:'charge'|'burrow', time, ...}
    this.invuln = 0;
    this.bob = Math.random() * 6;
    this.spawnTime = 0;
    this.attackPulse = 0;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }
  phase() { return this.def.phases[this.phaseIndex]; }

  _initPhaseTimers() {
    const ph = this.def.phases[this.phaseIndex];
    this.attackTimers = ph.attacks.map(a => a.cooldown * (0.4 + Math.random() * 0.5));
  }

  _updatePhase(game) {
    const ratio = this.hp / this.maxHp;
    let idx = 0;
    for (let i = 0; i < this.def.phases.length; i++) if (ratio <= this.def.phases[i].at) idx = i;
    if (idx !== this.phaseIndex) {
      this.phaseIndex = idx;
      this._initPhaseTimers();
      this.invuln = 0.6;
      game.toast(`${this.name}: ${this.phase().name}!`, 'bad');
      game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color2, 20);
    }
  }

  update(dt, game) {
    this.spawnTime += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.attackPulse > 0) this.attackPulse -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    this.bob += dt * 3;
    this._updatePhase(game);

    const ph = this.phase();
    const target = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;

    // Special states override normal movement.
    if (this.state && this.state.type === 'charge') {
      this.state.time -= dt;
      if (this.movement === 'ground' || this.movement === 'gravemaw') applyGravity(this, dt);
      this.vx = this.state.vx;
      if (this.movement !== 'ground' && this.movement !== 'gravemaw') this.vy = this.state.vy;
      this._move(game, dt);
      if (this.state.time <= 0) this.state = null;
    } else if (this.state && this.state.type === 'burrow') {
      this.state.time -= dt;
      this.invuln = 0.2;
      if (this.state.time <= 0) {
        // Re-emerge near target with a clear warning burst.
        if (target) { this.x = target.x + (Math.random() < 0.5 ? -80 : 80); this.y = target.y - 40; }
        this.state = null;
        game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color2, 22);
      }
    } else if (this.state && this.state.type === 'teleport') {
      this.state.time -= dt;
      this.invuln = 0.5;
      if (this.state.time <= 0) {
        if (target) {
          this.x = target.x + (Math.random() < 0.5 ? -185 : 185);
          this.y = target.y - (this.def.floatHeight || 120) - 10;
        }
        this.state = null;
        game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color2, 26);
      }
    } else if (target) {
      const tc = target.center();
      const dx = tc.x - cx;
      this.facing = dx < 0 ? -1 : 1;
      if (this.movement === 'grovekeeper') {
        // The Grovekeeper circles the player through the air instead of
        // tracking in a straight line. Its vertical sway makes the seed rain
        // readable and gives melee players windows to approach.
        const desiredY = tc.y - (this.def.floatHeight || 105) + Math.sin(this.spawnTime * 1.7) * 28;
        const dy = desiredY - cy;
        const orbitX = Math.sin(this.spawnTime * 0.85) * 34;
        this.vx = Math.max(-ph.speed, Math.min(ph.speed, dx * 0.65 + orbitX));
        this.vy = Math.max(-ph.speed, Math.min(ph.speed, dy * 0.8));
        this.x += this.vx * dt; this.y += this.vy * dt;
      } else if (this.movement === 'sovereign') {
        // The Sovereign keeps a moving orbit around the player and teleports
        // between attack cycles. It periodically dips into melee range so the
        // fight has a real close-range answer instead of being airborne-only.
        const orbit = this.spawnTime * 0.9;
        const dive = Math.sin(orbit * 1.7) > 0.35;
        const desiredX = tc.x + Math.cos(orbit) * (dive ? 72 : 108);
        const desiredY = tc.y - (dive ? 42 : (this.def.floatHeight || 72)) + Math.sin(orbit * 1.7) * (dive ? 18 : 32);
        this.vx = Math.max(-ph.speed, Math.min(ph.speed, (desiredX - cx) * 0.9));
        this.vy = Math.max(-ph.speed, Math.min(ph.speed, (desiredY - cy) * 0.9));
        this.x += this.vx * dt; this.y += this.vy * dt;
      } else {
        // Gravemaw is the grounded boss. It commits to the floor, hops over
        // ledges, and uses shockwaves and leaps to punish staying grounded.
        applyGravity(this, dt);
        this.vx = Math.sign(dx) * ph.speed;
        if (this.onGround && this.hitWallX) this.vy = -320;
        this._move(game, dt);
      }
      // Run attacks.
      for (let i = 0; i < ph.attacks.length; i++) {
        this.attackTimers[i] -= dt;
        if (this.attackTimers[i] <= 0) {
          this.attackTimers[i] = ph.attacks[i].cooldown;
          this._performAttack(ph.attacks[i], game, target);
        }
      }
    }
    clampToWorld(this, game.world);

    // Contact damage.
    for (const p of game.players.values()) {
      if (p.alive && aabb(this, p)) {
        game.applyEnemyDamageToPlayer(p, ph.contact, Math.sign(p.x - this.x) * 6);
      }
    }
  }

  _move(game, dt) {
    moveAndCollide(this, game.world, dt);
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
            w: 5, h: 10,
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
        this.state = { type: 'teleport', time: 0.62 };
        game.addHitParticles(cx, cy, this.color2, 20);
        break;
      }
      case 'leap': {
        const dir = Math.sign(tc.x - cx) || this.facing;
        this.state = { type: 'charge', time: 0.78, vx: dir * atk.speed, vy: -390 };
        break;
      }
      case 'volley': {
        const base = angleTo(cx, cy, tc.x, tc.y);
        const n = atk.count;
        for (let i = 0; i < n; i++) {
          const a = base + (i - (n - 1) / 2) * (atk.spread / Math.max(1, n - 1));
          game.addProjectile(new Projectile({
            x: cx, y: cy, vx: Math.cos(a) * atk.projSpeed, vy: Math.sin(a) * atk.projSpeed,
            damage: atk.damage, ownerType: 'boss', kind: atk.projKind, color, life: 5,
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
            homingStrength: 1.8, destructible: true,
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
        this.state = { type: 'charge', time: 0.55, vx: Math.cos(a) * atk.speed, vy: Math.sin(a) * atk.speed };
        break;
      }
      case 'burrow': {
        this.state = { type: 'burrow', time: 1.4 };
        game.addHitParticles(cx, cy, this.color2, 14);
        break;
      }
      case 'spawnAdds': {
        game.spawnBossAdds(atk.enemy, atk.addCount, this.x, this.y);
        break;
      }
    }
  }

  takeDamage(amount, game, crit) {
    if (this.dead || this.invuln > 0) return;
    this.hp -= amount;
    this.hurtFlash = 0.1;
    if (game) game.floatText(this.x + this.w / 2, this.y, Math.round(amount) + (crit ? '!' : ''), crit ? '#ffcf6b' : '#ffffff');
    if (this.hp <= 0) { this.hp = 0; this.dead = true; if (game) game.onBossDeath(this); }
  }

  netState() {
    return { key: this.key, name: this.name, x: Math.round(this.x), y: Math.round(this.y), hp: Math.round(this.hp), maxHp: this.maxHp, phase: this.phaseIndex, facing: this.facing, state: this.state ? this.state.type : null };
  }
}
