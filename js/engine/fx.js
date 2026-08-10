// Summoner Realms — visual effects: particles, trails, telegraph rings and
// screen shake.
//
// Particle emission used to live inline in main.js as a couple of one-off
// helpers. Collecting it here gives every system one vocabulary to draw with, so
// a bomb, a boss slam and an ember-axe swing all read as part of the same game.
//
// A particle is a plain object so it stays cheap to allocate in bulk:
//   { x, y, vx, vy, life, max, size, color, gravity, drag, glow, shrink, spin }
import { MAX_PARTICLES } from '../config.js?v=realms-qor-49';

export class Fx {
  constructor(game) {
    this.game = game;
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.shakeDur = 1;
    this._shakeSeed = Math.random() * 1000;
  }

  update(dt) {
    if (this.shakeTime > 0) this.shakeTime -= dt;
    this._shakeSeed += dt * 47;
  }

  // Request a camera shake. Stacking picks the stronger of the two rather than
  // summing, so a burst of explosions can't fling the view off-screen.
  shake(mag, dur = 0.35) {
    if (this.game.settings && this.game.settings.screenShake === false) return;
    if (mag > this.shakeMag * this.shakeFalloff()) {
      this.shakeMag = mag;
      this.shakeDur = dur;
      this.shakeTime = dur;
    }
  }

  shakeFalloff() {
    return this.shakeTime > 0 ? this.shakeTime / this.shakeDur : 0;
  }

  // Current camera offset in world pixels. Two decorrelated sine stacks give a
  // shudder rather than a periodic wobble.
  offset() {
    const k = this.shakeFalloff();
    if (k <= 0) return { x: 0, y: 0 };
    const m = this.shakeMag * k * k;
    const t = this._shakeSeed;
    return {
      x: (Math.sin(t * 1.7) + Math.sin(t * 3.9)) * 0.5 * m,
      y: (Math.cos(t * 2.3) + Math.sin(t * 5.1)) * 0.5 * m,
    };
  }

  // ---- Emitters ----

  push(p) {
    const list = this.game.particles;
    list.push(p);
    if (list.length > MAX_PARTICLES) list.splice(0, list.length - MAX_PARTICLES);
  }

  // Generic radial burst. Used for hits, block breaks and pickups.
  burst(x, y, color, count = 6, opts = {}) {
    const speed = opts.speed || 80;
    const life = opts.life || 0.45;
    for (let i = 0; i < count; i++) {
      const a = opts.angle != null
        ? opts.angle + (Math.random() - 0.5) * (opts.spread || Math.PI * 2)
        : Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      const l = life * (0.6 + Math.random() * 0.6);
      this.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.lift || 20),
        life: l, max: l,
        size: (opts.size || 2) * (0.6 + Math.random() * 0.8),
        color: Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color,
        gravity: opts.gravity != null ? opts.gravity : 200,
        drag: opts.drag || 0,
        glow: !!opts.glow,
        shrink: opts.shrink !== false,
      });
    }
  }

  // Smoke: slow, rising, drag-heavy, fading.
  smoke(x, y, color = '#8b8b94', count = 5, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const sp = 12 + Math.random() * 28;
      const l = 0.6 + Math.random() * 0.7;
      this.push({
        x: x + (Math.random() - 0.5) * (opts.jitter || 6),
        y: y + (Math.random() - 0.5) * (opts.jitter || 6),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: l, max: l,
        size: 2 + Math.random() * 3,
        color, gravity: -14, drag: 2.6, glow: false, shrink: false,
      });
    }
  }

  // A short-lived sliver along a direction: sparks, muzzle flash debris, gleam.
  streak(x, y, angle, color, count = 4, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * (opts.spread || 0.5);
      const sp = (opts.speed || 220) * (0.5 + Math.random() * 0.8);
      const l = (opts.life || 0.18) * (0.6 + Math.random() * 0.8);
      this.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: l, max: l,
        size: opts.size || 2,
        color, gravity: opts.gravity || 0, drag: opts.drag || 3,
        glow: opts.glow !== false, shrink: true,
      });
    }
  }

  // One trailing mote dropped behind a moving projectile.
  trail(x, y, color, opts = {}) {
    const l = opts.life || 0.24;
    this.push({
      x: x + (Math.random() - 0.5) * 2, y: y + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * (opts.drift || 12),
      vy: (Math.random() - 0.5) * (opts.drift || 12) - (opts.lift || 0),
      life: l, max: l,
      size: opts.size || 2,
      color, gravity: opts.gravity || 0, drag: 1.5,
      glow: opts.glow !== false, shrink: true,
    });
  }

  // Muzzle flash for guns: a bright cone plus smoke plus a shell.
  muzzle(x, y, angle, color = '#ffcf6b') {
    this.streak(x, y, angle, color, 7, { speed: 300, spread: 0.55, life: 0.14, size: 2.5 });
    this.streak(x, y, angle, '#fff6d8', 3, { speed: 380, spread: 0.22, life: 0.09, size: 2 });
    this.smoke(x, y, '#5d5a58', 3, { jitter: 3 });
    // Ejected casing, thrown perpendicular and falling.
    const perp = angle - Math.PI / 2;
    this.push({
      x, y, vx: Math.cos(perp) * 90, vy: Math.sin(perp) * 90 - 40,
      life: 0.5, max: 0.5, size: 2, color: '#c9a24a', gravity: 420, drag: 0, glow: false, shrink: false,
    });
  }

  // An expanding ring, drawn by the renderer rather than as particles so it stays
  // crisp. Used for boss telegraphs and explosion shockwaves.
  ring(x, y, color, radius, opts = {}) {
    if (!this.game.rings) this.game.rings = [];
    this.game.rings.push({
      x, y, color,
      r0: opts.from != null ? opts.from : 0,
      r1: radius,
      life: opts.life || 0.4,
      max: opts.life || 0.4,
      width: opts.width || 2,
      fill: !!opts.fill,
    });
    if (this.game.rings.length > 40) this.game.rings.shift();
  }

  // A short-lived light source fed into the world light map, so a blast actually
  // illuminates the cave it just carved instead of glowing behind the darkness.
  flash(x, y, level = 0.9, life = 0.35) {
    if (!this.game.flashes) this.game.flashes = [];
    this.game.flashes.push({ x, y, level, life, max: life });
    if (this.game.flashes.length > 12) this.game.flashes.shift();
  }

  // The full explosion package: flash, fireball, sparks, smoke, shockwave, shake.
  explosion(x, y, radiusPx, opts = {}) {
    const hot = opts.hot || ['#fff2c0', '#ffcf6b', '#ff8c3b'];
    const scale = radiusPx / 48;
    this.flash(x, y, 1, 0.45);
    this.ring(x, y, opts.ringColor || '#ffd08a', radiusPx, { life: 0.32, width: 3 });
    this.ring(x, y, 'rgba(255,255,255,0.5)', radiusPx * 0.55, { life: 0.16, width: 6 });
    this.burst(x, y, hot, Math.round(26 * scale), {
      speed: 180 * scale, life: 0.55, size: 3, gravity: 120, glow: true, lift: 30,
    });
    this.burst(x, y, opts.debris || '#6b5a48', Math.round(14 * scale), {
      speed: 150 * scale, life: 0.8, size: 2, gravity: 420,
    });
    this.smoke(x, y, '#4a4640', Math.round(10 * scale), { jitter: radiusPx * 0.4 });
    this.shake(opts.shake != null ? opts.shake : 5 * scale, 0.4);
  }

  // Per-frame integration for particles and rings. Called from the game step so
  // effects run at the simulation rate, not the render rate.
  step(dt) {
    const g = this.game;
    for (const p of g.particles) {
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    g.particles = g.particles.filter(p => p.life > 0);
    if (g.particles.length > MAX_PARTICLES) g.particles.splice(0, g.particles.length - MAX_PARTICLES);

    if (g.rings && g.rings.length) {
      for (const r of g.rings) r.life -= dt;
      g.rings = g.rings.filter(r => r.life > 0);
    }
    if (g.flashes && g.flashes.length) {
      for (const f of g.flashes) f.life -= dt;
      g.flashes = g.flashes.filter(f => f.life > 0);
    }
    this.update(dt);
  }
}
