// Summoner Realms — ambient atmosphere: night insects and wildlife calls.
//
// Visual motes are *not* fauna. Emberflies are catchable bait; these orbs
// cannot be clicked, do not drop, and do not count against the critter cap.
// They exist so a night forest is not an empty dark slab.
//
// Audio is occasional short bursts of the authored bird / grasshopper beds,
// never a loop. Underground is silent. Volumes stay well under the existing
// forest/cave/wind beds.
import {
  TILE, MAX_AMBIENT_MOTES, FIREFLY_MAX,
  AMBIENT_BURST_GAIN, AMBIENT_BURST_MIN, AMBIENT_BURST_MAX,
} from '../config.js?v=tides-1';
import { clamp } from '../utils.js?v=tides-1';
import { isSolid } from '../world/tiles.js?v=tides-1';

// Real fireflies are warm yellow-green. A rare cool one is fine; a sky full
// of neon orbs is not.
const FLY_PALETTE = [
  { rgb: [255, 224, 110], hex: '#ffe06e', w: 48 },
  { rgb: [210, 255, 120], hex: '#d2ff78', w: 28 },
  { rgb: [255, 196, 80], hex: '#ffc450', w: 16 },
  { rgb: [180, 230, 255], hex: '#b4e6ff', w: 8 },
];

function pickPalette(rand) {
  let t = rand() * FLY_PALETTE.reduce((s, p) => s + p.w, 0);
  for (const p of FLY_PALETTE) {
    t -= p.w;
    if (t <= 0) return p;
  }
  return FLY_PALETTE[0];
}

export class Ambiance {
  constructor(game) {
    this.game = game;
    this.motes = [];
    this.burstIn = 10 + Math.random() * 12;
    this._bursting = false;
    this._spawnIn = 2 + Math.random() * 2;
  }

  get enabled() {
    return !(this.game.settings && this.game.settings.atmosphere === false);
  }

  update(dt) {
    if (!this.enabled) {
      this.motes.length = 0;
      return;
    }
    this._stepMotes(dt);
    this._scheduleBurst(dt);
  }

  // Tiny lights for the closest fireflies, so a cluster actually glows.
  // Capped so the flood-fill buffer does not grow by dozens of sources.
  extraLights() {
    if (!this.enabled || !this.motes.length) return null;
    const night = this.game.time ? this.game.time.nightAmount : 0;
    if (night < 0.35) return null;
    const list = [];
    const lit = this.motes.filter(m => m.kind === 'fly' && m.blink > 0.45);
    for (let i = 0; i < Math.min(2, lit.length); i++) {
      const m = lit[i];
      list.push({
        tx: Math.floor(m.x / TILE),
        ty: Math.floor(m.y / TILE),
        level: 0.08 + m.blink * 0.04,
      });
    }
    return list;
  }

  glowSources() {
    if (!this.enabled) return [];
    const out = [];
    for (const m of this.motes) {
      if (m.kind !== 'fly' || m.blink < 0.35) continue;
      out.push({
        x: m.x, y: m.y,
        level: m.blink * m.fade,
        rgb: m.rgb,
        radius: 10,
        alpha: 0.12,
      });
    }
    return out;
  }

  draw(ctx) {
    if (!this.enabled || !this.motes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const a = m.blink * m.fade;
      if (a < 0.03) continue;
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 3.2);
      g.addColorStop(0, m.hex);
      g.addColorStop(0.4, m.hex);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#fff8d0';
      ctx.fillRect(m.x - 0.5, m.y - 0.5, 1.1, 1.1);
    }
    ctx.restore();
  }

  _stepMotes(dt) {
    const game = this.game;
    const p = game.localPlayer;
    const world = game.world;
    if (!p || !world) { this.motes.length = 0; return; }

    const cam = game.camera;
    const night = game.time ? game.time.nightAmount : 0;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const tx = Math.floor(cx / TILE), ty = Math.floor(cy / TILE);
    const surf = world.surfaceY(tx);
    const underground = ty > surf + 4;
    const target = (!underground && night > 0.38)
      ? Math.round(FIREFLY_MAX * clamp((night - 0.38) / 0.35, 0, 1))
      : 0;

    const margin = 40;
    const left = cam.x - cam.vw / 2 - margin;
    const right = cam.x + cam.vw / 2 + margin;
    const top = cam.y - cam.vh / 2 - margin;
    const bot = cam.y + cam.vh / 2 + margin;

    const wind = game.weather ? game.weather.windAt(world, cx, cy) : 0;
    const t = game.time ? game.time.t : 0;

    for (const m of this.motes) {
      m.age += dt;
      m.ph += dt * m.sp;
      // Hover around a home point — a slow figure-eight, not a dart.
      m.x = m.homeX + Math.sin(m.ph) * m.amp + Math.sin(m.ph * 0.37) * m.amp * 0.35;
      m.y = m.homeY + Math.cos(m.ph * 0.9) * m.amp * 0.45;
      m.homeX += wind * 4 * dt;
      if (target > 0) m.fade = clamp(m.fade + dt / 1.6, 0, 1);
      else m.fade = clamp(m.fade - dt / 1.1, 0, 1);
      // Firefly flash: mostly dark, a short warm pulse.
      const cycle = ((t * m.blinkSp + m.blinkPh) % 1 + 1) % 1;
      const on = cycle < m.duty;
      m.blink = on ? Math.sin((cycle / m.duty) * Math.PI) : 0;
    }

    this.motes = this.motes.filter(m => (
      m.fade > 0.02 && m.x > left && m.x < right && m.y > top && m.y < bot
    ));

    this._spawnIn -= dt;
    if (this._spawnIn <= 0 && this.motes.length < Math.min(MAX_AMBIENT_MOTES, target)) {
      const mote = this._spawn(cam, world);
      if (mote) this.motes.push(mote);
      this._spawnIn = 1.8 + Math.random() * 2.2;
    } else if (target <= 0) {
      this._spawnIn = 2;
    }
  }

  _spawn(cam, world) {
    const x = cam.x + (Math.random() - 0.5) * cam.vw * 0.85;
    const y = cam.y + (Math.random() - 0.55) * cam.vh * 0.55;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (!world.inBounds(tx, ty)) return null;
    if (isSolid(world.get(tx, ty))) return null;
    if (ty > world.surfaceY(tx) + 1) return null;
    if (world.hasWallAt && world.hasWallAt(tx, ty)) return null;
    const pal = pickPalette(Math.random);
    return {
      homeX: x, homeY: y, x, y,
      ph: Math.random() * Math.PI * 2,
      sp: 0.35 + Math.random() * 0.45,
      amp: 4 + Math.random() * 5,
      size: 0.9 + Math.random() * 0.5,
      hex: pal.hex,
      rgb: pal.rgb,
      kind: 'fly',
      fade: 0,
      age: 0,
      blink: 0,
      blinkSp: 0.22 + Math.random() * 0.18,
      blinkPh: Math.random(),
      duty: 0.16 + Math.random() * 0.1,
    };
  }

  _scheduleBurst(dt) {
    const game = this.game;
    if (!game.audio || !game.localPlayer || !game.world) return;
    this.burstIn -= dt;
    if (this.burstIn > 0) return;

    const p = game.localPlayer;
    const tx = Math.floor((p.x + p.w / 2) / TILE);
    const ty = Math.floor((p.y + p.h / 2) / TILE);
    const underground = ty > game.world.surfaceY(tx) + 3;
    const night = game.time ? game.time.nightAmount : 0;
    const isDay = game.time ? game.time.isDay : true;
    const biome = game.world.biomeAt(tx, ty);

    this.burstIn = AMBIENT_BURST_MIN + Math.random() * (AMBIENT_BURST_MAX - AMBIENT_BURST_MIN);

    if (underground) return;
    // Birds belong to living surface biomes by day; grasshoppers to any
    // open surface at night. Deserts still get a quieter, rarer chirp.
    let key = null;
    if (isDay && night < 0.35) {
      const leafy = biome === 'forest' || biome === 'jungle' || biome === 'frostpine' || biome === 'snowyTaiga';
      if (leafy || Math.random() < 0.25) key = 'birds';
    } else if (night > 0.45) {
      key = 'grasshoppers';
    }
    if (!key) return;

    const dur = 4 + Math.random() * 5;
    const gain = key === 'grasshoppers' ? AMBIENT_BURST_GAIN * 0.7 : AMBIENT_BURST_GAIN;
    if (game.audio.playAmbienceBurst(key, dur, gain)) {
      this.burstIn += dur * 0.6;
    }
  }
}
