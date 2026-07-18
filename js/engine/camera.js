// Summoner Realms — camera. Follows a target, clamps to world, computes zoom.
import { TILE, WORLD_W, WORLD_H, TARGET_TILES_V } from '../config.js';
import { clamp, lerp } from '../utils.js';

export class Camera {
  constructor() {
    this.x = 0; // world px at centre of view
    this.y = 0;
    this.scale = 3; // world px -> screen px
    this.vw = 0; // view width in world px
    this.vh = 0;
  }

  resize(screenW, screenH) {
    // Choose a scale so ~TARGET_TILES_V tiles are visible vertically.
    this.scale = Math.max(1.5, screenH / (TARGET_TILES_V * TILE));
    this.vw = screenW / this.scale;
    this.vh = screenH / this.scale;
  }

  follow(target, dt, snap = false) {
    const worldPxW = WORLD_W * TILE;
    const worldPxH = WORLD_H * TILE;
    let tx = target.x + target.w / 2;
    let ty = target.y + target.h / 2;
    // Clamp so we never show outside the world.
    tx = clamp(tx, this.vw / 2, worldPxW - this.vw / 2);
    ty = clamp(ty, this.vh / 2, worldPxH - this.vh / 2);
    if (this.vw >= worldPxW) tx = worldPxW / 2;
    if (this.vh >= worldPxH) ty = worldPxH / 2;
    if (snap) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = 1 - Math.pow(0.0001, dt); // smooth follow
      this.x = lerp(this.x, tx, k);
      this.y = lerp(this.y, ty, k);
    }
  }

  // Screen -> world coordinates.
  screenToWorld(sx, sy, screenW, screenH) {
    return {
      x: this.x + (sx - screenW / 2) / this.scale,
      y: this.y + (sy - screenH / 2) / this.scale,
    };
  }

  // World -> screen coordinates.
  worldToScreen(wx, wy, screenW, screenH) {
    return {
      x: (wx - this.x) * this.scale + screenW / 2,
      y: (wy - this.y) * this.scale + screenH / 2,
    };
  }
}
