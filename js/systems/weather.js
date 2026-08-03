// Summoner Realms — weather. Currently one phenomenon: wind.
//
// Wind blows from exactly one side at a time — never both — and is re-rolled on
// a slow, seeded cadence so a day has calm stretches and gales rather than
// constant noise. It sways foliage, drives the ambient wind loop, and applies a
// deliberately gentle drag to surface movement.
//
// It stops at the surface. Underground there is no wind at all, which is both
// physically obvious and the thing that keeps the effect from becoming
// irritating during the part of the game where precision matters most.
import {
  WIND_MIN_INTERVAL, WIND_MAX_INTERVAL, WIND_SHIFT_TIME,
  WIND_GUST_RATE, WIND_GUST_AMOUNT, WIND_DEPTH_FADE, TILE,
} from '../config.js?v=prehardmode-ores-1';
import { mulberry32, clamp, lerp, smoothstep } from '../utils.js?v=prehardmode-ores-1';

// Named bands for the HUD readout, from the absolute wind strength.
const BANDS = [
  { at: 0.06, label: 'Calm', icon: '·' },
  { at: 0.28, label: 'Light breeze', icon: '≈' },
  { at: 0.55, label: 'Breezy', icon: '≋' },
  { at: 0.80, label: 'Strong wind', icon: '⋙' },
  { at: 1.01, label: 'Gale', icon: '⫸' },
];

export class Weather {
  constructor(seed, saved) {
    this.rand = mulberry32(((seed >>> 0) ^ 0x1dea77) >>> 0);
    this.t = 0;
    // Wind is interpolated from `from` to `to` over `shift` seconds, then held
    // until `timer` expires and a new target is rolled.
    this.from = 0;
    this.to = 0;
    this.shift = 0;
    this.shiftT = 0;
    this.timer = 4;
    this.wind = 0;      // signed: negative blows left, positive blows right
    if (saved) this.deserialize(saved);
  }

  update(dt) {
    this.t += dt;
    this.timer -= dt;

    if (this.shiftT < this.shift) {
      this.shiftT = Math.min(this.shift, this.shiftT + dt);
      const k = smoothstep(0, 1, this.shift > 0 ? this.shiftT / this.shift : 1);
      this.wind = lerp(this.from, this.to, k);
    } else {
      this.wind = this.to;
    }

    if (this.timer <= 0) this._roll();
  }

  _roll() {
    const r = this.rand;
    // Direction is a coin flip, but a calm spell is allowed to keep the side it
    // had — reversing direction every single time reads as mechanical.
    const strength = this._rollStrength(r);
    let dir = r() < 0.5 ? -1 : 1;
    if (Math.abs(this.to) > 0.15 && r() < 0.45) dir = Math.sign(this.to) || dir;

    this.from = this.wind;
    this.to = dir * strength;
    this.shift = WIND_SHIFT_TIME * (0.6 + r() * 0.8);
    this.shiftT = 0;
    this.timer = WIND_MIN_INTERVAL + r() * (WIND_MAX_INTERVAL - WIND_MIN_INTERVAL);
  }

  // Weighted so most of the day is light and gales are an event.
  _rollStrength(r) {
    const roll = r();
    if (roll < 0.28) return r() * 0.10;          // near calm
    if (roll < 0.70) return 0.12 + r() * 0.28;   // breeze
    if (roll < 0.92) return 0.42 + r() * 0.28;   // strong
    return 0.72 + r() * 0.28;                    // gale
  }

  // Base signed wind including the gust oscillation, before any depth fade.
  // Gusts ride on top of the base so wind pulses instead of sitting still.
  get gusted() {
    const gust = Math.sin(this.t * Math.PI * 2 * WIND_GUST_RATE) *
      Math.sin(this.t * Math.PI * 2 * WIND_GUST_RATE * 0.37 + 1.7);
    return clamp(this.wind * (1 + gust * WIND_GUST_AMOUNT), -1, 1);
  }

  /**
   * Signed wind at a world position, faded to nothing underground.
   *
   * @param world  the World, for its surface line
   * @param wx     world pixel x
   * @param wy     world pixel y
   */
  windAt(world, wx, wy) {
    if (!world) return this.gusted;
    const tx = clamp(Math.floor(wx / TILE), 0, world.width - 1);
    const ty = Math.floor(wy / TILE);
    const depth = ty - world.surfaceY(tx);
    if (depth >= WIND_DEPTH_FADE) return 0;
    // Fade over the last few tiles rather than switching off at a line, so
    // stepping into a cave mouth doesn't snap the foliage still.
    const fade = depth <= 0 ? 1 : 1 - depth / WIND_DEPTH_FADE;
    return this.gusted * fade;
  }

  // Wind for tile-space effects (foliage sway), which only need the column.
  windAtTile(world, tx, ty) {
    return this.windAt(world, tx * TILE, ty * TILE);
  }

  strength() { return Math.abs(this.gusted); }
  direction() { return Math.sign(this.gusted) || 0; }

  label() {
    const s = this.strength();
    const band = BANDS.find(b => s < b.at) || BANDS[BANDS.length - 1];
    if (s < BANDS[0].at) return band.icon + ' ' + band.label;
    const arrow = this.direction() < 0 ? '←' : '→';
    return `${band.icon} ${band.label} ${arrow}`;
  }

  serialize() {
    return { t: this.t, from: this.from, to: this.to, shift: this.shift, shiftT: this.shiftT, timer: this.timer, wind: this.wind };
  }
  deserialize(s) {
    if (!s) return;
    this.t = Number(s.t) || 0;
    this.from = Number(s.from) || 0;
    this.to = Number(s.to) || 0;
    this.shift = Number(s.shift) || 0;
    this.shiftT = Number(s.shiftT) || 0;
    this.timer = Number(s.timer) || 4;
    this.wind = Number(s.wind) || 0;
  }
}
