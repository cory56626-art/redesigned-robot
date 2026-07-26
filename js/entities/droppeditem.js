// Summoner Realms — dropped ground item. Host-authoritative physics + pickup.
import { GRAVITY, TILE } from '../config.js?v=realms-qor-45';
import { dist2 } from '../utils.js?v=realms-qor-45';

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
    this.dead = false;
    this.bob = Math.random() * 6;
  }

  update(dt, game) {
    this.age += dt;
    this.bob += dt * 4;
    if (this.pickupDelay > 0) this.pickupDelay -= dt;

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

    // Attract to / pickup by the nearest eligible player.
    if (this.pickupDelay > 0) return;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    let nearest = null, nd = Infinity;
    for (const p of game.players.values()) {
      if (!p.alive) continue;
      const d = dist2(cx, cy, p.x + p.w / 2, p.y + p.h / 2);
      if (d < nd) { nd = d; nearest = p; }
    }
    if (!nearest) return;
    const px = nearest.x + nearest.w / 2, py = nearest.y + nearest.h / 2;
    if (nd < 60 * 60) {
      // magnet
      const a = Math.atan2(py - cy, px - cx);
      this.x += Math.cos(a) * 220 * dt;
      this.y += Math.sin(a) * 220 * dt;
    }
    if (nd < 20 * 20) game.pickupDrop(this, nearest);
  }

  netState() { return { netId: this.netId, itemId: this.itemId, count: this.count, x: Math.round(this.x), y: Math.round(this.y) }; }
}
