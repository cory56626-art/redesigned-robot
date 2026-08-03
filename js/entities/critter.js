// Summoner Realms — passive wildlife entity.
//
// A critter has three jobs: wander plausibly, run away when you get close, and
// die into useful materials. It never attacks and never chases, so none of the
// hostile AI machinery applies — but it reuses the same ledge and gap checks so
// it doesn't walk off cliffs or grind into walls, which is most of what makes
// idle movement read as alive rather than as a sprite sliding around.
//
// Bugs are the same entity with `kind: 'bug'`: smaller, flightier, and caught by
// clicking them rather than by killing them.
import { TILE, GRAVITY } from '../config.js?v=first-world-no-ore-boss-1';
import { FAUNA } from '../data/fauna.js?v=first-world-no-ore-boss-1';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=first-world-no-ore-boss-1';
import { dist2 } from '../utils.js?v=first-world-no-ore-boss-1';

export class Critter {
  constructor(key, x, y, netId) {
    const def = FAUNA[key];
    this.key = key;
    this.def = def;
    this.netId = netId;
    this.name = def.name;
    this.kind = def.kind;
    this.x = x; this.y = y;
    this.w = def.w; this.h = def.h;
    this.vx = 0; this.vy = 0;
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.onGround = false;
    this.stepHeight = TILE + 2;
    this.hp = def.hp || 6;
    this.maxHp = this.hp;
    this.dead = false;
    this.hurtFlash = 0;
    this.color = def.color;
    this.color2 = def.color2;

    // Behaviour state.
    this.state = 'idle';     // idle | wander | flee
    this.stateTimer = 1 + Math.random() * 2;
    this.dir = this.facing;
    this.hopTimer = 0;
    this.anim = Math.random() * 10;
    this.flutterPhase = Math.random() * Math.PI * 2;
    // Flyers hold a target altitude so they bob around a level rather than
    // drifting to the ceiling.
    this.hoverY = y;
    this.despawnTimer = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    this.anim += dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    const player = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    const def = this.def;

    // Flee when a player (or anything hostile) gets inside the skittish radius.
    // Wildlife that ignores you walking up to it reads as scenery.
    let threat = null;
    if (player) {
      const d = dist2(this.x + this.w / 2, this.y + this.h / 2,
        player.x + player.w / 2, player.y + player.h / 2);
      const r = (def.skittish || 6) * TILE;
      if (d < r * r) threat = player;
    }

    if (threat) {
      this.state = 'flee';
      this.stateTimer = 1.2;
      this.dir = (this.x + this.w / 2) < (threat.x + threat.w / 2) ? -1 : 1;
    } else {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this._pickIdleState();
    }

    if (def.behavior === 'flutter') this._flutter(dt, game);
    else this._walk(dt, game);

    this._despawnIfForgotten(dt, game);
  }

  _pickIdleState() {
    const r = Math.random();
    if (r < 0.45) { this.state = 'idle'; this.stateTimer = 1 + Math.random() * 2.5; }
    else {
      this.state = 'wander';
      this.stateTimer = 1 + Math.random() * 2.5;
      if (Math.random() < 0.5) this.dir = -this.dir;
    }
  }

  _walk(dt, game) {
    const def = this.def;
    const speed = def.speed * (this.state === 'flee' ? 1.7 : 1);
    const moving = this.state !== 'idle';

    if (def.behavior === 'hopper') {
      // Hoppers travel in discrete bounds rather than sliding, which is most of
      // what sells a rabbit as a rabbit.
      this.hopTimer -= dt;
      if (moving && this.onGround && this.hopTimer <= 0) {
        this.vy = -(this.state === 'flee' ? 210 : 150);
        this.vx = this.dir * speed;
        this.hopTimer = this.state === 'flee' ? 0.35 : 0.7 + Math.random() * 0.6;
      } else if (this.onGround) {
        this.vx *= 0.7;
      }
    } else {
      this.vx = moving ? this.dir * speed : this.vx * 0.8;
    }

    // Don't walk off a ledge or into a wall: turn around instead. Without this
    // wildlife marches off every cliff in the world and drowns in every pool.
    if (moving && this.onGround) {
      const aheadX = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
      const footTy = Math.floor((this.y + this.h + 2) / TILE);
      const aheadTx = Math.floor(aheadX / TILE);
      const wall = game.world.isSolidAt(aheadTx, Math.floor((this.y + this.h / 2) / TILE));
      const gap = !game.world.isSolidAt(aheadTx, footTy);
      const water = game.world.liquid && game.world.liquid.get(aheadTx, footTy - 1) > 0;
      if (wall || gap || water) { this.dir = -this.dir; this.vx = 0; }
    }

    if (this.vx < -1) this.facing = -1; else if (this.vx > 1) this.facing = 1;
    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
  }

  _flutter(dt, game) {
    const def = this.def;
    const speed = def.speed * (this.state === 'flee' ? 1.8 : 1);
    this.flutterPhase += dt * 3.4;
    this.vx = this.state === 'idle' ? this.vx * 0.9 : this.dir * speed;
    // Bob around a held altitude and drift gently back to it.
    this.vy = Math.sin(this.flutterPhase) * 26 + (this.hoverY - this.y) * 1.6;
    if (this.state === 'flee') this.hoverY -= 14 * dt * 4;

    if (this.vx < -1) this.facing = -1; else if (this.vx > 1) this.facing = 1;
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
    // Bounce off whatever it bumped into rather than grinding against it.
    if (this.hitWallX) { this.dir = -this.dir; }
    if (this.onGround || this.vy === 0) this.hoverY = this.y - 6;
  }

  // Wildlife far from every player is removed so the world can repopulate
  // around wherever the player actually is.
  _despawnIfForgotten(dt, game) {
    const d = game.minDistToAnyPlayer(this.x + this.w / 2, this.y + this.h / 2);
    if (d > (90 * TILE) * (90 * TILE)) {
      this.despawnTimer += dt;
      if (this.despawnTimer > 4) this.dead = true;
    } else {
      this.despawnTimer = 0;
    }
  }

  takeDamage(amount, kbx, kby, game) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtFlash = 0.12;
    this.vx = kbx || 0;
    this.vy = -110;
    // Being hit is a very good reason to run.
    this.state = 'flee';
    this.stateTimer = 3;
    this.dir = kbx >= 0 ? 1 : -1;
    game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, this.color, 5);
    if (this.hp <= 0) { this.dead = true; game.onCritterDeath(this); }
  }

  netState() {
    return {
      netId: this.netId, key: this.key,
      x: Math.round(this.x), y: Math.round(this.y), facing: this.facing,
    };
  }
}
