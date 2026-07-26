// Summoner Realms — thrown items: bombs, dynamite, shurikens, knives, flasks.
//
// Everything thrown follows the same physics: launched along the aim direction
// at a fixed speed, pulled down by gravity into a natural arc, and bounced off
// terrain with restitution and friction. What differs is what happens on
// contact — explode on a fuse, stick and then explode, or damage and drop as a
// recoverable pickup.
import { GRAVITY, TILE } from '../config.js?v=realms-difficulty-22';
import { aabb } from '../utils.js?v=realms-difficulty-22';
import { explode } from '../systems/explosions.js?v=realms-difficulty-22';
import { Sprites } from '../art/sprites.js?v=realms-difficulty-22';
import { item as getItem } from '../data/items.js?v=realms-difficulty-22';

export class ThrownItem {
  /**
   * @param def   the item definition (see data/items.js `throwable` entries)
   * @param x,y   world pixel spawn point
   * @param vx,vy launch velocity
   * @param ownerId who threw it
   */
  constructor(def, x, y, vx, vy, ownerId) {
    this.def = def;
    this.itemId = def.id;
    this.throwKind = def.throwKind || 'bomb';
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.w = def.throwSize || 8;
    this.h = def.throwSize || 8;
    this.ownerId = ownerId;
    this.dead = false;
    this.onGround = false;
    this.stuck = false;
    this.age = 0;
    this.rot = 0;
    // Shurikens and knives spin fast and flat; heavy explosives tumble.
    this.spin = def.spin != null ? def.spin : (this.throwKind === 'bomb' ? 6 : 22);
    this.gravityScale = def.gravityScale != null ? def.gravityScale : 1;
    this.bounce = def.bounce != null ? def.bounce : 0.45;
    this.friction = def.friction != null ? def.friction : 0.72;
    this.fuse = def.fuse != null ? def.fuse : null;
    this.hitSet = new Set();
    this.pierce = def.pierce || 0;
    // Live explosives glow, and the renderer feeds this into the light map.
    this.light = def.explode ? 0.45 : 0;
  }

  update(dt, game) {
    this.age += dt;
    const world = game.world;

    if (this.fuse != null) {
      this.fuse -= dt;
      // Faster sparks and a brighter glow as the fuse runs out.
      const urgency = this.def.fuse ? 1 - Math.max(0, this.fuse) / this.def.fuse : 1;
      this.light = 0.35 + urgency * 0.45;
      if (Math.random() < 0.35 + urgency * 0.5) {
        game.fx.trail(this.x + this.w / 2, this.y, urgency > 0.7 ? '#fff2c0' : '#ffcf6b',
          { life: 0.22, size: 2, lift: 30, glow: true });
      }
      if (this.fuse <= 0) { this._detonate(game); return; }
    }

    if (!this.stuck) {
      this.vy += GRAVITY * 0.55 * this.gravityScale * dt;
      this.rot += this.spin * dt * (this.vx >= 0 ? 1 : -1);
      this._moveAndBounce(dt, world, game);
    }

    // Damage on contact, for anything that isn't purely an explosive.
    if (this.def.contactDamage) this._hitCreatures(game);

    // Out of the world, or simply too old to matter.
    if (this.y > world.height * TILE + 200 || this.age > (this.def.maxLife || 12)) {
      if (this.def.explode) this._detonate(game); else this._expire(game);
    }
  }

  // Swept per-axis movement so a fast throw can't tunnel through a wall.
  _moveAndBounce(dt, world, game) {
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) * dt / (TILE * 0.5)));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + this.vx * sdt;
      if (world.rectHitsSolid(nx, this.y, this.w, this.h)) {
        this._onImpact(game, 'x');
        if (this.dead || this.stuck) return;
        this.vx = -this.vx * this.bounce;
        this.vy *= this.friction;
      } else this.x = nx;

      const ny = this.y + this.vy * sdt;
      if (world.rectHitsSolid(this.x, ny, this.w, this.h)) {
        const landing = this.vy > 0;
        this._onImpact(game, 'y');
        if (this.dead || this.stuck) return;
        this.vy = -this.vy * this.bounce;
        this.vx *= this.friction;
        if (landing && Math.abs(this.vy) < 40) { this.vy = 0; this.onGround = true; }
      } else { this.y = ny; this.onGround = false; }
    }
  }

  _onImpact(game, axis) {
    const speed = Math.hypot(this.vx, this.vy);
    if (this.def.explodeOnImpact && speed > 60) { this._detonate(game); return; }
    if (this.def.sticky) {
      // Sticky bombs latch onto whatever they hit and finish their fuse there.
      this.stuck = true;
      this.vx = 0; this.vy = 0;
      game.fx.burst(this.x + this.w / 2, this.y + this.h / 2, '#8bd39a', 5, { speed: 50, life: 0.3 });
      return;
    }
    if (this.def.breakOnImpact) { this._expire(game, true); return; }
    if (speed > 90) {
      game.audio?.thrownBounce?.();
      game.fx.burst(this.x + this.w / 2, this.y + this.h / 2, this.def.color, 3, { speed: 50, life: 0.25 });
    }
    void axis;
  }

  _hitCreatures(game) {
    const box = { x: this.x, y: this.y, w: this.w, h: this.h };
    const dmg = this.def.contactDamage;
    for (const e of game.enemies) {
      if (this.hitSet.has(e.netId || e)) continue;
      if (!aabb(box, e)) continue;
      this.hitSet.add(e.netId || e);
      game.hurtEnemy(e, dmg, Math.sign(this.vx) * (this.def.knockback || 4), -1, this.def.effect, this.ownerId, false);
      game.fx.burst(this.x, this.y, this.def.color, 5, { speed: 90 });
      if (this.pierce-- <= 0) { this._expire(game, true); return; }
    }
    for (const b of game.bosses) {
      if (this.hitSet.has(b)) continue;
      if (!aabb(box, b)) continue;
      this.hitSet.add(b);
      game.hurtBoss(b, dmg, this.ownerId, false);
      game.fx.burst(this.x, this.y, this.def.color, 5, { speed: 90 });
      if (this.pierce-- <= 0) { this._expire(game, true); return; }
    }
  }

  _detonate(game) {
    if (this.dead) return;
    this.dead = true;
    explode(game, this.x + this.w / 2, this.y + this.h / 2, {
      power: this.def.blastPower != null ? this.def.blastPower : 1,
      radius: this.def.blastRadius != null ? this.def.blastRadius : 3,
      damage: this.def.blastDamage != null ? this.def.blastDamage : 45,
      owner: this.ownerId,
      breakTiles: this.def.breaksBlocks !== false,
      hot: this.def.blastColors,
    });
  }

  // Ran out of road without exploding. Some throwables can be picked back up.
  _expire(game, onHit) {
    if (this.dead) return;
    this.dead = true;
    const recover = this.def.recoverChance || 0;
    if (recover > 0 && Math.random() < recover) {
      game.spawnDrop(this.x, this.y, this.itemId, 1);
    }
    if (onHit) game.fx.burst(this.x + this.w / 2, this.y + this.h / 2, this.def.color, 4, { speed: 70, life: 0.25 });
  }

  draw(ctx, sprites) {
    const icon = (sprites || Sprites).getIcon(getItem(this.itemId));
    ctx.save();
    ctx.translate(this.x + this.w / 2, this.y + this.h / 2);
    ctx.rotate(this.rot);
    if (icon) ctx.drawImage(icon, -6, -6, 12, 12);
    ctx.restore();
    // A fuse close to burning out pulses, so the danger is legible at a glance.
    if (this.fuse != null && this.fuse < 0.7) {
      const k = Math.abs(Math.sin(this.age * 22));
      ctx.globalAlpha = 0.35 + k * 0.5;
      ctx.fillStyle = '#ffd08a';
      ctx.beginPath();
      ctx.arc(this.x + this.w / 2, this.y + this.h / 2, 8 + k * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  netState() {
    return {
      id: this.itemId, x: Math.round(this.x), y: Math.round(this.y),
      vx: Math.round(this.vx), vy: Math.round(this.vy),
    };
  }
}
