// Summoner Realms — camera. Follows a target, clamps to world, computes zoom.
import {
  TILE, WORLD_W, WORLD_H, TARGET_TILES_V,
  ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT, ZOOM_STEP, ZOOM_LERP,
} from '../config.js?v=tides-1';
import { clamp, lerp } from '../utils.js?v=tides-1';

export class Camera {
  constructor() {
    this.x = 0; // world px at centre of view
    this.y = 0;
    this.scale = 3; // world px -> screen px
    this.vw = 0; // view width in world px
    this.vh = 0;
    // Player-controlled zoom on top of the screen-derived base scale. Zooming
    // out is what makes a boss that flies far away (the Grovekeeper in phase
    // two) stay on screen instead of leaving the player guessing.
    //
    // `zoom` is what is on screen; `zoomTarget` is what the player asked for.
    // Input writes the target and update() eases toward it, so a wheel flick
    // or a +/- tap is a glide instead of a staircase.
    this.zoom = ZOOM_DEFAULT;
    this.zoomTarget = ZOOM_DEFAULT;
    this._screenW = 0;
    this._screenH = 0;
  }

  resize(screenW, screenH) {
    this._screenW = screenW; this._screenH = screenH;
    // Choose a scale so ~TARGET_TILES_V tiles are visible vertically, then
    // apply the player's zoom multiplier.
    this.scale = Math.max(1.5, screenH / (TARGET_TILES_V * TILE)) * this.zoom;
    this.vw = screenW / this.scale;
    this.vh = screenH / this.scale;
  }

  // Ease the displayed zoom toward the target. Called from the render path so
  // a frozen sim (debug console) or a held settings slider still glides.
  update(dt) {
    const dest = this.zoomTarget;
    const err = dest - this.zoom;
    if (Math.abs(err) < 0.00015) {
      if (this.zoom !== dest) {
        this.zoom = dest;
        if (this._screenW) this.resize(this._screenW, this._screenH);
      }
      return false;
    }
    const k = 1 - Math.exp(-ZOOM_LERP * Math.max(0, dt || 0));
    this.zoom = this.zoom + err * k;
    if (this._screenW) this.resize(this._screenW, this._screenH);
    return true;
  }

  setZoom(z) {
    const next = clamp(z, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(next - this.zoomTarget) < 0.0001) return false;
    this.zoomTarget = next;
    return true;
  }

  // Jump both the target and the displayed zoom. Used on load so a saved 150%
  // does not animate in from the default.
  snapZoom(z) {
    const next = clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.zoomTarget = next;
    this.zoom = next;
    if (this._screenW) this.resize(this._screenW, this._screenH);
    return true;
  }

  zoomBy(delta) {
    return this.setZoom(this.zoomTarget + delta);
  }

  // dir > 0 zooms in, dir < 0 zooms out. Keys still step; the view eases.
  nudgeZoom(dir) {
    return this.zoomBy(dir * ZOOM_STEP);
  }
  zoomPercent() { return Math.round(this.zoomTarget * 100); }

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
