// Summoner Realms — dropped ground item. Host-authoritative physics + pickup.
import { GRAVITY, TILE } from '../config.js?v=worm-surface-1';
import { dist2 } from '../utils.js?v=worm-surface-1';

// How close a player has to be before a drop starts flying toward them, and how
// close before it is collected.
const MAGNET_RANGE = 60;
const PICKUP_RANGE = 20;

export class DropItem {
  constructor(netId, itemId, count, x, y) {
    this.netId = netId;
    this.itemId = itemId;
    this.count = count;
    this.x = x; this.y = y;
    this.vx = (Math.random() - 0.5) * 60;
    this.vy = -120 - Math.random() * 60;
    this.w = 10; this.h = 10;
    this.onGround = false;
    this.age = 0;
    this.pickupDelay = 0.4;
    // Set when a player deliberately threw this away. Until the timer runs out
    // that player cannot pick it back up — anyone else still can, so tossing an
    // item to a friend in co-op works. Without this, dropping something put it
    // straight back in your bag, which made the drop action useless.
    this.ownerId = null;
    this.ownerImmunity = 0;
    this.dead = false;
    this.bob = Math.random() * 6;
  }

  // Give the drop a deliberate outward toss and a window during which the
  // player who dropped it cannot re-collect it.
  throwFrom(player, facing) {
    this.ownerId = player.id;
    this.ownerImmunity = 1.4;
    this.pickupDelay = 0.35;
    const dir = facing || player.facing || 1;
    this.vx = dir * (95 + Math.random() * 35);
    this.vy = -150 - Math.random() * 40;
    return this;
  }

  update(dt, game) {
    this.age += dt;
    this.bob += dt * 4;
    if (this.pickupDelay > 0) this.pickupDelay -= dt;
    if (this.ownerImmunity > 0) {
      this.ownerImmunity -= dt;
      if (this.ownerImmunity <= 0) this.ownerId = null;
    }

    // Simple gravity + tile collision.
    this.vy += GRAVITY * 0.5 * dt;
    this.x += this.vx * dt;
    if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) { this.x -= this.vx * dt; this.vx = 0; }
    this.y += this.vy * dt;
    if (game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
      if (this.vy > 0) { this.y = Math.floor((this.y + this.h) / TILE) * TILE - this.h - 0.01; this.onGround = true; }
      this.vy = 0;
    }
    this.vx *= 0.9;

    // Attract to / pickup by the nearest *eligible* player. A player still
    // inside their own drop's immunity window is not eligible, so a freshly
    // dropped stack is not dragged back out of the world by the magnet.
    if (this.pickupDelay > 0) return;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    let nearest = null, nd = Infinity;
    for (const p of game.players.values()) {
      if (!p.alive) continue;
      if (!this.canBePickedUpBy(p)) continue;
      const d = dist2(cx, cy, p.x + p.w / 2, p.y + p.h / 2);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (!nearest) return;
    const px = nearest.x + nearest.w / 2, py = nearest.y + nearest.h / 2;
    if (nd < MAGNET_RANGE * MAGNET_RANGE) {
      // magnet
      const a = Math.atan2(py - cy, px - cx);
      this.x += Math.cos(a) * 220 * dt;
      this.y += Math.sin(a) * 220 * dt;
    }
    if (nd < PICKUP_RANGE * PICKUP_RANGE) game.pickupDrop(this, nearest);
  }

  canBePickedUpBy(player) {
    if (this.pickupDelay > 0) return false;
    return !(this.ownerImmunity > 0 && this.ownerId === player.id);
  }

  netState() { return { netId: this.netId, itemId: this.itemId, count: this.count, x: Math.round(this.x), y: Math.round(this.y) }; }
}
