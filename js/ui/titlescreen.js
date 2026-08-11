// Summoner Realms — animated title screen.
//
// A living pixel-art vista behind the main menu: floating islands with
// waterfalls, a castle on the ridge, a lantern-lit cottage, a cave mouth, and
// the summoner and their familiars gathered on a forest ledge.
//
// Everything here is procedural — there is no image asset. The scene is drawn
// into a low-resolution backing buffer (roughly 300 rows tall) that CSS blows
// up with `image-rendering: pixelated`, which is what gives the chunky pixel
// look instead of a smooth vector one.
//
// Two ideas do most of the work:
//
//   * A full day/night cycle. One `phase` value (0 = midnight, 0.5 = noon)
//     drives the sky gradient, the sun and moon arcs, star and nebula opacity,
//     the warm horizon bloom, and — via `_lit()` — the colour of every single
//     thing on the ground. Windows, crystals and the cave only glow once it is
//     dark enough for the glow to read.
//
//   * Wind. A slow multi-sine `wind` value plus occasional gusts sways tree
//     canopies, grass, bushes, vines, hanging lanterns and the summoner's
//     cloak, with each object carrying its own phase so nothing moves in
//     lockstep. Sway scales with height above the anchor point, so trunks stay
//     put while crowns lean.
//
// The module is deliberately self-contained: it owns one canvas, one rAF loop,
// and touches no game state. `start()` / `stop()` are the whole API.
import { mulberry32, clamp, lerp } from '../utils.js?v=deep-and-divided-1';

const F = Math.floor;
const TAU = Math.PI * 2;

/* ===================================================================
   Colour helpers
   =================================================================== */

function hx(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c) {
  return `rgb(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0})`;
}
function rgba(c, a) {
  return `rgba(${clamp(c[0], 0, 255) | 0},${clamp(c[1], 0, 255) | 0},${clamp(c[2], 0, 255) | 0},${a})`;
}

/* ===================================================================
   Day / night keyframes
   0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.

   a..d are the sky gradient stops from zenith to horizon. `light` multiplies
   every ground colour, `amb` / `ambAmt` tint them toward the ambient light of
   the hour (cold blue at night, rose at dusk), and `star` fades the starfield.
   =================================================================== */
const SKY = [
  { p: 0.00, a: '#05060f', b: '#0a0e24', c: '#141a3a', d: '#1e2149', light: 0.30, star: 1.00, amb: '#2a3a80', ambAmt: 0.46 },
  { p: 0.17, a: '#06081a', b: '#0d1230', c: '#1a1f48', d: '#2b2456', light: 0.32, star: 1.00, amb: '#2a3a80', ambAmt: 0.44 },
  { p: 0.23, a: '#0d1332', b: '#241a50', c: '#4c2a60', d: '#8c4459', light: 0.40, star: 0.72, amb: '#5c4482', ambAmt: 0.38 },
  { p: 0.28, a: '#1c2a60', b: '#4d3b7a', c: '#a25c74', d: '#f4975f', light: 0.60, star: 0.20, amb: '#ac6f6c', ambAmt: 0.30 },
  { p: 0.34, a: '#2a4f98', b: '#5b88c6', c: '#aabadd', d: '#ffd096', light: 0.84, star: 0.00, amb: '#cbb2a2', ambAmt: 0.14 },
  { p: 0.42, a: '#2f6fc0', b: '#64a6e2', c: '#a0cef2', d: '#dbeefc', light: 0.99, star: 0.00, amb: '#e0eaf6', ambAmt: 0.05 },
  { p: 0.50, a: '#2b76c8', b: '#6ab1ea', c: '#abdaf8', d: '#e8f5ff', light: 1.06, star: 0.00, amb: '#eaf3ff', ambAmt: 0.03 },
  { p: 0.60, a: '#2e70be', b: '#64a3df', c: '#a7ceee', d: '#e5f0fc', light: 0.99, star: 0.00, amb: '#e2eaf6', ambAmt: 0.05 },
  { p: 0.68, a: '#2a509c', b: '#5b70b0', c: '#c28185', d: '#ffb875', light: 0.82, star: 0.02, amb: '#d29c7a', ambAmt: 0.16 },
  { p: 0.74, a: '#182258', b: '#3b2a70', c: '#8a4070', d: '#ff9452', light: 0.62, star: 0.32, amb: '#b26c72', ambAmt: 0.28 },
  { p: 0.81, a: '#0e1440', b: '#241a58', c: '#5c2a66', d: '#e0764e', light: 0.46, star: 0.74, amb: '#7c4c7c', ambAmt: 0.36 },
  { p: 0.90, a: '#080c28', b: '#171040', c: '#33194c', d: '#6a3350', light: 0.36, star: 0.94, amb: '#4c3c7a', ambAmt: 0.42 },
  { p: 1.00, a: '#05060f', b: '#0a0e24', c: '#141a3a', d: '#1e2149', light: 0.30, star: 1.00, amb: '#2a3a80', ambAmt: 0.46 },
];
// Pre-parse the hex stops once.
for (const k of SKY) { k.A = hx(k.a); k.B = hx(k.b); k.C = hx(k.c); k.D = hx(k.d); k.AMB = hx(k.amb); }

function sampleSky(p) {
  p = ((p % 1) + 1) % 1;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1].p <= p) i++;
  const k0 = SKY[i], k1 = SKY[i + 1];
  const t = (p - k0.p) / Math.max(1e-6, k1.p - k0.p);
  return {
    A: mix(k0.A, k1.A, t), B: mix(k0.B, k1.B, t),
    C: mix(k0.C, k1.C, t), D: mix(k0.D, k1.D, t),
    AMB: mix(k0.AMB, k1.AMB, t),
    light: lerp(k0.light, k1.light, t),
    star: lerp(k0.star, k1.star, t),
    ambAmt: lerp(k0.ambAmt, k1.ambAmt, t),
  };
}

/* ===================================================================
   Scene layout, in fractions of the backing buffer.
   =================================================================== */

// Surface height of the ground, as [x, y] fractions. Cosine-interpolated, so
// the terrain reads as rolling hills rather than a polyline.
// The horizon sits high enough that the cast standing on the ledge clears the
// menu column beneath it — the same relationship the key art has, adjusted for
// a menu with more entries in it.
const HORIZON = 0.470;

const GROUND = [
  [0.00, 0.500], [0.05, 0.473], [0.11, 0.463], [0.17, 0.473], [0.22, 0.497],
  [0.26, 0.537], [0.30, 0.577], [0.35, 0.601], [0.41, 0.612], [0.49, 0.617],
  [0.57, 0.615], [0.63, 0.602], [0.69, 0.579], [0.75, 0.556], [0.81, 0.545],
  [0.87, 0.557], [0.93, 0.577], [1.00, 0.595],
];

const CAVE = { x: 0.246, r: 0.052, top: 0.566, bot: 0.722 };

// Palette. Ground colours all pass through _lit(); glow colours never do.
const P = {
  grassLit: '#8fe36a', grass: '#59bf46', grassDark: '#2f8a3c', grassDeep: '#1d5c31',
  dirt: '#6f4a30', dirtLit: '#835838', dirtDark: '#553824',
  stone: '#3b4160', stoneLit: '#4b5378', stoneDark: '#2a2e48',
  root: '#4a3222',
  bark: '#5a3d2b', barkDark: '#3d2a1e', barkLit: '#71513a',
  leaf: '#3f9e46', leafLit: '#67c85c', leafDark: '#256b39', leafDeep: '#17492c',
  pine: '#2f8250', pineLit: '#46a75f', pineDark: '#1c5b3d',
  farHill: '#3b3168', farHill2: '#2c2554',
  mtn: '#33295c', mtnLit: '#453a74', mtnDark: '#221a42',
  castle: '#241b46', castleLit: '#31264f', castleDark: '#170f2e',
  roof: '#7c3a3f', roofLit: '#9a4c4c', roofDark: '#54262d',
  wood: '#8a5f3c', woodLit: '#a8794e', woodDark: '#5f4028',
  water: '#4fc7e8', waterLit: '#a8f0ff', waterDark: '#2b83c4',
  robe: '#3b3aa0', robeLit: '#5a58cf', robeDark: '#252463',
  skin: '#e7b48b', skinDark: '#b8815e',
  bone: '#e3e2cf', boneDark: '#a9a894',
  cloth: '#c9c3e8',
};

// Glow colours (never dimmed by _lit()).
const GLOW = {
  window: '#ffbe63', cave: '#5fe4ff', crystal: '#7ef0e6', orb: '#a8e8ff',
  rune: '#c58bff', fire: '#ff9a4a', fly: '#c8ff8a', spark: '#9fe9ff',
};

/* ===================================================================
   Small drawing helpers
   =================================================================== */

// Integer-snapped rect. Everything in the scene goes through this so the whole
// picture lands on the pixel grid, which is what keeps the art crisp.
function R(ctx, x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = c;
  ctx.fillRect(F(x), F(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
// Filled pixel disc, drawn as scanline rects so it stays blocky.
function Disc(ctx, cx, cy, r, c) {
  ctx.fillStyle = c;
  const ri = Math.max(1, Math.round(r));
  for (let dy = -ri; dy <= ri; dy++) {
    const w = Math.floor(Math.sqrt(Math.max(0, ri * ri - dy * dy)) + 0.35);
    if (w <= 0) continue;
    ctx.fillRect(F(cx - w), F(cy + dy), w * 2, 1);
  }
}
// Filled pixel ellipse.
function Ell(ctx, cx, cy, rx, ry, c) {
  ctx.fillStyle = c;
  const rY = Math.max(1, Math.round(ry));
  for (let dy = -rY; dy <= rY; dy++) {
    const k = 1 - (dy * dy) / (rY * rY);
    if (k <= 0) continue;
    const w = Math.floor(rx * Math.sqrt(k) + 0.4);
    if (w <= 0) continue;
    ctx.fillRect(F(cx - w), F(cy + dy), w * 2, 1);
  }
}
// Soft additive glow. Everything that emits light in the scene uses this
// rather than a flat disc, which is the difference between "lit" and "a
// translucent circle pasted over the art".
function Glow(ctx, cx, cy, r, color, alpha, falloff = 0.35) {
  if (alpha <= 0.004 || r <= 0.5) return;
  const c = typeof color === 'string' ? hx(color) : color;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(c, alpha));
  g.addColorStop(falloff, rgba(c, alpha * 0.30));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
}

// Isoceles triangle pointing up — pines, roofs, mountain caps.
function Tri(ctx, cx, top, halfW, h, c) {
  ctx.fillStyle = c;
  const H = Math.max(1, Math.round(h));
  for (let i = 0; i < H; i++) {
    const w = Math.max(1, Math.round(halfW * (i / H)));
    ctx.fillRect(F(cx - w), F(top + i), w * 2, 1);
  }
}

/* ===================================================================
   TitleScreen
   =================================================================== */

export class TitleScreen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.running = false;
    this.time = 0;                  // seconds since start, for animation
    this.dayLength = 96;            // seconds for a full day/night revolution
    this.phase = 0.805;             // start at dusk — the key-art hour
    this.bw = 0; this.bh = 0;
    this._litCache = new Map();
    this._raf = 0;
    this._last = 0;
    this._frame = this._frame.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.bw) this._layout();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._frame);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  // Human-readable time of day, for the readout in the corner.
  get label() {
    const p = this.phase;
    if (p < 0.21) return 'Midnight';
    if (p < 0.27) return 'Dawn';
    if (p < 0.34) return 'Sunrise';
    if (p < 0.45) return 'Morning';
    if (p < 0.58) return 'Midday';
    if (p < 0.68) return 'Afternoon';
    if (p < 0.76) return 'Sunset';
    if (p < 0.86) return 'Dusk';
    return 'Night';
  }

  // Jump to the next interesting hour. Six stops around the clock, so repeated
  // presses walk dawn → morning → midday → sunset → dusk → midnight.
  skipTime() {
    const stops = [0.00, 0.27, 0.42, 0.52, 0.74, 0.83];
    const p = this.phase;
    for (const s of stops) if (s > p + 0.012) { this.phase = s; return; }
    this.phase = stops[0];
  }

  _onVisibility() {
    // Don't bank up elapsed time while the tab is hidden, or the sky snaps
    // forward by however long the player was away.
    if (!document.hidden) this._last = performance.now();
  }

  _onResize() {
    clearTimeout(this._resizeT);
    this._resizeT = setTimeout(() => this._layout(), 120);
  }

  /* ---------------- buffer sizing + scene generation ---------------- */

  _layout() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    // Aim for ~300 buffer rows, but never let the scene get so narrow (on a
    // portrait phone) that the composition falls apart — widen the buffer
    // instead, which zooms the whole vista out.
    const scale = clamp(Math.min(vh / 300, vw / 470), 1, 4.2);
    const bw = Math.max(240, Math.round(vw / scale));
    const bh = Math.max(200, Math.round(vh / scale));
    if (bw === this.bw && bh === this.bh) return;
    this.bw = bw; this.bh = bh;
    this.canvas.width = bw;
    this.canvas.height = bh;
    this.ctx.imageSmoothingEnabled = false;
    this._build();
  }

  // Ground surface height in pixels for a buffer-space x.
  gy(x) {
    const nx = clamp(x / this.bw, 0, 1);
    let i = 0;
    while (i < GROUND.length - 2 && GROUND[i + 1][0] <= nx) i++;
    const [x0, y0] = GROUND[i], [x1, y1] = GROUND[i + 1];
    const t = (nx - x0) / Math.max(1e-6, x1 - x0);
    const s = 0.5 - 0.5 * Math.cos(clamp(t, 0, 1) * Math.PI); // cosine ease
    return (y0 + (y1 - y0) * s) * this.bh;
  }

  _build() {
    const { bw, bh } = this;
    const rand = mulberry32(0xC0FFEE);
    this.rand = rand;
    this._layerCache = {};

    // Cached ground profile, one entry per column.
    this.ground = new Float32Array(bw);
    for (let x = 0; x < bw; x++) this.ground[x] = this.gy(x);

    this.cave = {
      x: CAVE.x * bw, r: Math.max(10, CAVE.r * bw),
      top: CAVE.top * bh, bot: CAVE.bot * bh,
    };

    this._buildStars();
    this._buildClouds();
    this._buildIslands();
    this._bakeRidge();
    this._buildWaterfalls();   // before the bake: the falls carve their channels
    this._bakeLand();
    this._buildFlora();
    this._buildCottage();
    this._buildCreatures();
    this._buildParticles();
  }

  /* ---------------- sky contents ---------------- */

  _buildStars() {
    const { bw, bh } = this;
    const rand = mulberry32(0x57A25);
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const g = c.getContext('2d');

    // Nebula band — a soft diagonal wash of violet and rose across the upper
    // right, which is what sells "this sky has depth" more than the stars do.
    const skyH = bh * (HORIZON + 0.06);
    g.save();
    g.translate(bw * 0.62, bh * 0.20);
    g.rotate(-0.42);
    for (const [rx, ry, col, al] of [
      [bw * 0.52, bh * 0.115, '#7a4fd0', 0.30],
      [bw * 0.40, bh * 0.075, '#b45fd6', 0.22],
      [bw * 0.26, bh * 0.045, '#e07fb0', 0.16],
    ]) {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0, `rgba(${hx(col).join(',')},${al})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.save(); g.scale(1, ry / rx); g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
    }
    g.restore();

    // Star field. Density falls off toward the horizon so the sky reads as a
    // dome rather than a flat sheet.
    const n = Math.round(bw * bh / 900) + 120;
    for (let i = 0; i < n; i++) {
      const x = rand() * bw;
      const y = Math.pow(rand(), 1.5) * skyH;
      const fade = 1 - clamp(y / skyH, 0, 1) * 0.75;
      if (rand() > fade) continue;
      const b = rand();
      const col = b > 0.93 ? '#ffe9b8' : b > 0.82 ? '#bfe2ff' : '#ffffff';
      const a = 0.30 + rand() * 0.70;
      g.fillStyle = `rgba(${hx(col).join(',')},${a * fade})`;
      g.fillRect(F(x), F(y), 1, 1);
      if (b > 0.965) { // a few big ones get a cross flare
        g.fillRect(F(x) - 1, F(y), 3, 1);
        g.fillRect(F(x), F(y) - 1, 1, 3);
      }
    }
    this.starCanvas = c;

    // The handful of stars that visibly twinkle are drawn live on top.
    this.twinkle = [];
    for (let i = 0; i < 34; i++) {
      this.twinkle.push({
        x: rand() * bw, y: Math.pow(rand(), 1.6) * skyH * 0.9,
        sp: 0.4 + rand() * 1.5, ph: rand() * TAU, big: rand() > 0.7,
      });
    }
    this.shooting = null;
    this.shootT = 4 + rand() * 10;
  }

  _buildClouds() {
    const { bw, bh } = this;
    const rand = mulberry32(0xC10D5);
    // Long, low, streaky banks rather than cauliflower puffs — the shape a
    // sunset sky makes, and what the key art has along its horizon. Each bank
    // is a stack of rows that narrow upward over a flat base.
    this.clouds = [];
    for (let i = 0; i < 11; i++) {
      const rows = [];
      const width = 26 + rand() * 74;
      const nRows = 2 + F(rand() * 3);
      for (let r = 0; r < nRows; r++) {
        const shrink = Math.pow(0.62, r);
        const segs = [];
        const n = 2 + F(rand() * 3);
        let px = -width * shrink * 0.5;
        for (let j = 0; j < n; j++) {
          const w = (width * shrink) / n * (0.7 + rand() * 0.7);
          segs.push({ x: px + w * 0.5, w, h: 1.2 + rand() * 1.4 });
          px += w * 0.86;
        }
        rows.push({ y: -r * 2.1, segs, off: (rand() - 0.5) * width * 0.12 });
      }
      this.clouds.push({
        x: rand() * bw * 1.4 - bw * 0.2,
        y: bh * (0.06 + Math.pow(rand(), 0.8) * 0.34),
        sp: 1.1 + rand() * 2.6,
        a: 0.24 + rand() * 0.36,
        w: width,
        rows,
      });
    }
  }

  _buildIslands() {
    const { bw, bh } = this;
    // Floating islands in the upper left, each with its own bob so they drift
    // out of sync. `tree`/`house` decide what rides on top.
    this.islands = [
      { x: 0.075 * bw, y: 0.150 * bh, w: 0.105 * bw, h: 0.052 * bh, ph: 0.0, house: true, fall: 0.36 * bh },
      { x: 0.196 * bw, y: 0.268 * bh, w: 0.072 * bw, h: 0.040 * bh, ph: 1.9, tree: 1, fall: 0.20 * bh },
      { x: 0.150 * bw, y: 0.075 * bh, w: 0.040 * bw, h: 0.024 * bh, ph: 3.4, tree: 0.6, fall: 0 },
      { x: 0.283 * bw, y: 0.170 * bh, w: 0.030 * bw, h: 0.018 * bh, ph: 4.6, tree: 0, fall: 0 },
    ];
  }

  /* ---------------- baked layers ---------------- */

  // Distant ridge + castle + crystal spire. Static, so it is drawn once and
  // re-tinted per frame with a single composite pass.
  _bakeRidge() {
    const { bw, bh } = this;
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const g = c.getContext('2d');

    const base = bh * 0.66;

    // -- far, hazy hill line behind everything, with a suggestion of forest
    // along its crest so it does not read as a bare blob.
    const crest = [];
    g.beginPath();
    g.moveTo(0, base);
    for (let x = 0; x <= bw; x += 2) {
      const n = Math.sin(x * 0.017) * 0.5 + Math.sin(x * 0.0061 + 1.3) * 0.5 + Math.sin(x * 0.031 + 2.2) * 0.18;
      const y = bh * (HORIZON - 0.035) - n * bh * 0.050;
      crest.push([x, y]);
      g.lineTo(x, y);
    }
    g.lineTo(bw, base); g.closePath();
    g.fillStyle = P.farHill2; g.fill();
    // A ragged tree line along the crest — overlapping and irregular, so it
    // reads as distant forest rather than as a row of pickets.
    for (let i = 1; i < crest.length; i++) {
      const [x, y] = crest[i];
      const n = (Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.61) * 0.5);
      if (n < -0.15) continue;
      const h = 1.2 + (n + 1) * 1.7;
      Tri(g, x, y - h, 1.4 + n * 0.8, h + 2.5, P.farHill);
    }
    // Soften the crest into the sky so the hill is not a hard cut-out.
    {
      const hz = g.createLinearGradient(0, bh * (HORIZON - 0.075), 0, bh * (HORIZON + 0.03));
      hz.addColorStop(0, 'rgba(120,100,170,0.30)');
      hz.addColorStop(1, 'rgba(120,100,170,0)');
      g.save(); g.globalCompositeOperation = 'source-atop';
      g.fillStyle = hz; g.fillRect(0, 0, bw, bh); g.restore();
    }

    // -- mountain range on the right, the one the castle sits on.
    // Drawn as a jagged ridge polygon rather than a triangle: the summit sits
    // off-centre, the flanks kink, and the west face catches the low sun. That
    // asymmetry is what reads as "mountain" instead of "tent".
    const mtnBase = bh * (HORIZON + 0.035);
    const peaks = [
      { x: 0.560, w: 0.130, h: 0.140, skew: -0.18, dark: true },
      { x: 0.665, w: 0.150, h: 0.195, skew: 0.22 },
      { x: 0.848, w: 0.205, h: 0.290, skew: -0.12 },
      { x: 0.988, w: 0.145, h: 0.215, skew: 0.16 },
    ];
    for (const pk of peaks) {
      const cx = pk.x * bw, hw = pk.w * bw, h = pk.h * bh;
      const sum = cx + hw * pk.skew;              // summit, offset from centre
      const top = mtnBase - h;
      const body = pk.dark ? P.mtnDark : P.mtn;

      // Ridge profile: left base → summit → right base, kinked by two sine
      // terms so each flank steps rather than running straight.
      const pts = [[cx - hw, mtnBase]];
      const STEPS = 20;
      for (let i = 1; i < STEPS; i++) {
        const t = i / STEPS;
        const px2 = cx - hw + t * hw * 2;
        const d = Math.abs(px2 - sum) / hw;
        let y = mtnBase - h * Math.max(0, 1 - Math.pow(clamp(d, 0, 1), 1.25));
        y += (Math.sin(i * 2.1 + pk.x * 40) * 0.6 + Math.sin(i * 4.7) * 0.4) * h * 0.055;
        pts.push([px2, Math.min(y, mtnBase)]);
      }
      pts.push([cx + hw, mtnBase]);

      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineTo(cx + hw, mtnBase + bh * 0.16);
      g.lineTo(cx - hw, mtnBase + bh * 0.16);
      g.closePath();
      g.fillStyle = body;
      g.fill();

      // West face, clipped to the same silhouette.
      g.save();
      g.clip();
      g.fillStyle = pk.dark ? P.mtn : P.mtnLit;
      g.beginPath();
      g.moveTo(sum, top - h * 0.1);
      g.lineTo(cx - hw - 2, mtnBase + bh * 0.18);
      g.lineTo(sum - hw * 0.18, mtnBase + bh * 0.18);
      g.closePath();
      g.fill();
      // A couple of shadowed gullies down the east flank.
      g.fillStyle = P.mtnDark;
      for (let k = 0; k < 3; k++) {
        const gx = sum + hw * (0.18 + k * 0.24);
        g.beginPath();
        g.moveTo(gx, top + h * (0.12 + k * 0.08));
        g.lineTo(gx + hw * 0.10, mtnBase + bh * 0.18);
        g.lineTo(gx - hw * 0.03, mtnBase + bh * 0.18);
        g.closePath();
        g.fill();
      }
      g.restore();

      // Snow on the summit, following the ridge rather than sitting on it as
      // a separate triangle.
      g.save();
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineTo(cx + hw, mtnBase + bh * 0.16);
      g.lineTo(cx - hw, mtnBase + bh * 0.16);
      g.closePath();
      g.clip();
      g.fillStyle = '#8d84bb';
      g.beginPath();
      g.moveTo(sum - hw * 0.34, top + h * 0.26);
      g.lineTo(sum, top - 1);
      g.lineTo(sum + hw * 0.30, top + h * 0.24);
      g.lineTo(sum + hw * 0.16, top + h * 0.20);
      g.lineTo(sum + hw * 0.04, top + h * 0.30);
      g.lineTo(sum - hw * 0.12, top + h * 0.18);
      g.closePath();
      g.fill();
      g.restore();
    }

    // -- castle on the tallest peak
    this.castleWindows = [];
    this._drawCastle(g, 0.855 * bw, bh * 0.245, bh * 0.20);

    // -- crystal spire beside it
    this._drawSpire(g, 0.941 * bw, bh * 0.380, bh * 0.245);

    // Baked-in warm rim on the ridge line so the silhouette does not read flat.
    g.globalCompositeOperation = 'source-atop';
    const grd = g.createLinearGradient(0, bh * 0.28, 0, bh * 0.56);
    grd.addColorStop(0, 'rgba(255,180,120,0.00)');
    grd.addColorStop(1, 'rgba(255,150,90,0.10)');
    g.fillStyle = grd; g.fillRect(0, 0, bw, bh);
    g.globalCompositeOperation = 'source-over';

    this.ridgeCanvas = c;

    // Window rectangles get their glow drawn live, at night only.
    // (populated by _drawCastle / _buildCottage)
  }

  _drawCastle(g, cx, baseY, h) {
    const { bh } = this;
    const u = Math.max(2, h / 14);          // one "block" of castle
    this.castleWindows = this.castleWindows || [];
    const wins = this.castleWindows;

    const tower = (x, w, top, spire, flag) => {
      const bot = baseY;
      R(g, x, top, w, bot - top, P.castle);
      R(g, x, top, Math.max(1, w * 0.28), bot - top, P.castleLit);
      R(g, x + w - Math.max(1, w * 0.22), top, Math.max(1, w * 0.22), bot - top, P.castleDark);
      // battlements
      for (let bx = x; bx < x + w - 1; bx += Math.max(2, u * 0.9)) {
        R(g, bx, top - u * 0.55, Math.max(1, u * 0.5), u * 0.6, P.castle);
      }
      if (spire) {
        Tri(g, x + w / 2, top - u * 3.2, w * 0.62, u * 3.4, P.castleDark);
        Tri(g, x + w / 2 - w * 0.1, top - u * 3.0, w * 0.34, u * 3.0, '#3a2c5e');
        if (flag) {
          R(g, x + w / 2, top - u * 4.6, 1, u * 1.6, '#2a2148');
          R(g, x + w / 2 + 1, top - u * 4.5, u * 1.5, u * 0.9, '#7a3550');
        }
      }
      // lit windows, remembered for the night pass
      const rows = Math.max(1, Math.floor((bot - top) / (u * 2.6)));
      for (let r = 0; r < rows; r++) {
        const wy = top + u * 1.5 + r * u * 2.6;
        if (wy > bot - u) break;
        const ww = Math.max(1, u * 0.55), wh = Math.max(1, u * 0.95);
        const wx = x + w / 2 - ww / 2;
        R(g, wx, wy, ww, wh, '#120d24');
        wins.push({ x: wx, y: wy, w: ww, h: wh, ph: wins.length * 1.7 });
      }
    };

    // rocky plinth so the castle is not floating on the peak
    R(g, cx - h * 0.52, baseY, h * 1.04, bh * 0.10, P.mtnDark);
    Ell(g, cx, baseY + 1, h * 0.55, u * 1.1, P.mtnDark);

    tower(cx - h * 0.46, u * 2.0, baseY - h * 0.62, true, false);
    tower(cx - h * 0.22, u * 2.6, baseY - h * 0.86, true, true);
    R(g, cx - h * 0.30, baseY - h * 0.50, h * 0.62, h * 0.50, P.castle);       // keep body
    R(g, cx - h * 0.30, baseY - h * 0.50, h * 0.10, h * 0.50, P.castleLit);
    for (let bx = cx - h * 0.30; bx < cx + h * 0.30; bx += u * 1.1) R(g, bx, baseY - h * 0.55, u * 0.6, u * 0.6, P.castle);
    tower(cx + h * 0.16, u * 3.0, baseY - h * 1.02, true, true);
    tower(cx + h * 0.44, u * 1.8, baseY - h * 0.58, true, false);

    // gate
    const gw = u * 1.8;
    R(g, cx - gw / 2, baseY - u * 3.0, gw, u * 3.0, '#100b20');
    Tri(g, cx, baseY - u * 4.0, gw / 2 + 0.5, u * 1.2, '#100b20');
    wins.push({ x: cx - gw / 2 + 0.5, y: baseY - u * 2.2, w: gw - 1, h: u * 2.2, ph: 0.4, warm: true });
  }

  _drawSpire(g, cx, baseY, h) {
    // A shard of arcane crystal breaking out of the ridge. Facets are just three
    // vertical bands of increasing lightness.
    const w = h * 0.20;
    const pts = [[cx, baseY - h], [cx + w * 0.55, baseY - h * 0.55], [cx + w * 0.36, baseY], [cx - w * 0.40, baseY], [cx - w * 0.58, baseY - h * 0.5]];
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = '#2f8fa6'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#54c6d6'; g.fillRect(F(cx - w * 0.6), F(baseY - h), F(w * 0.55), F(h));
    g.fillStyle = '#8bf0e4'; g.fillRect(F(cx - w * 0.16), F(baseY - h), F(w * 0.20), F(h));
    g.fillStyle = '#1e6b86'; g.fillRect(F(cx + w * 0.18), F(baseY - h), F(w * 0.5), F(h));
    g.restore();
    // smaller shards at the base
    Tri(g, cx - w * 0.75, baseY - h * 0.30, w * 0.24, h * 0.30, '#3fa6bb');
    Tri(g, cx + w * 0.62, baseY - h * 0.22, w * 0.20, h * 0.22, '#3fa6bb');
    this.spire = { x: cx, y: baseY - h * 0.55, h };
  }

  // Foreground land: grass, dirt, strata, ore and the cave, written straight
  // into an ImageData buffer. Per-pixel noise here is what gives the terrain
  // its texture, and doing it as pixels rather than thousands of fillRects is
  // the difference between 1 ms and 200 ms.
  _bakeLand() {
    const { bw, bh } = this;
    const c = document.createElement('canvas');
    c.width = bw; c.height = bh;
    const g = c.getContext('2d');
    const img = g.createImageData(bw, bh);
    const d = img.data;
    const rnd = mulberry32(0x1AD);

    // A cheap tileable value noise for the strata speckle.
    const nz = new Float32Array(4096);
    for (let i = 0; i < nz.length; i++) nz[i] = rnd();
    const N = (x, y) => nz[((x * 73 + y * 179) & 4095)];

    const put = (i, col, a = 255) => { d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a; };

    const C = {
      gL: hx(P.grassLit), g0: hx(P.grass), gD: hx(P.grassDark), gP: hx(P.grassDeep),
      dL: hx(P.dirtLit), d0: hx(P.dirt), dD: hx(P.dirtDark),
      sL: hx(P.stoneLit), s0: hx(P.stone), sD: hx(P.stoneDark),
      ore1: hx('#5fd6c0'), ore2: hx('#c58bff'), ore3: hx('#d8a24a'),
      caveIn: hx('#0b1024'), caveEdge: hx('#1a2140'),
    };

    const cave = this.cave;
    const caveInside = (x, y) => {
      if (y < cave.top || y > cave.bot) return false;
      const dx = Math.abs(x - cave.x);
      // Jagged arch: a semicircular top with the radius wobbled per column.
      const wob = 1 + (N(x * 3, 7) - 0.5) * 0.16;
      const r = cave.r * wob;
      if (dx > r) return false;
      const archTop = cave.top + (r - Math.sqrt(Math.max(0, r * r - dx * dx))) * 0.95;
      return y > archTop;
    };

    // Which waterfall, if any, owns this pixel — and how far across it is.
    const channelAt = (x, y) => {
      for (const f of this.falls) {
        if (y < f.top - 3 || y > f.bot + f.w * 1.6) continue;
        const dx = Math.abs(x - f.x);
        const half = f.w * (0.85 + (y - f.top) / Math.max(1, f.bot - f.top) * 0.5) + 2.5;
        if (dx <= half) return { f, dx, half };
      }
      return null;
    };

    for (let x = 0; x < bw; x++) {
      const gyv = this.ground[x];
      const dirtDepth = 26 + N(x, 3) * 12 + Math.sin(x * 0.03) * 6;
      for (let y = F(gyv) - 4; y < bh; y++) {
        if (y < 0) continue;
        const i = (y * bw + x) * 4;
        const dep = y - gyv;

        const ch = channelAt(x, y);
        if (ch && dep > -3) {
          // Wet rock walls flanking a recessed channel; the animated column of
          // water is drawn over the middle each frame.
          const edge = ch.dx > ch.half - 2.6;
          put(i, edge ? hx('#2c3550') : hx('#16324e'));
          continue;
        }
        if (dep < 0) continue;

        if (caveInside(x, y)) {
          const near = caveInside(x, y - 2) && caveInside(x - 2, y) && caveInside(x + 2, y);
          if (!near) { put(i, C.caveEdge); continue; }
          // Interior falls off to black toward the top of the arch.
          const t = clamp((y - cave.top) / Math.max(1, cave.bot - cave.top), 0, 1);
          put(i, mix(hx('#070a18'), hx('#12203f'), t * t));
          continue;
        }

        let col;
        if (dep < 1) col = C.gL;
        else if (dep < 4) col = N(x, y) > 0.72 ? C.gL : C.g0;
        else if (dep < 7.5) col = N(x, y) > 0.55 ? C.g0 : C.gD;
        else if (dep < 10) col = C.gP;
        else if (dep < dirtDepth) {
          const n = N(x, y);
          col = n > 0.80 ? C.dL : n > 0.28 ? C.d0 : C.dD;
          if (n > 0.972) col = C.sD;                    // pebbles
        } else {
          const n = N(x, y);
          // Horizontal strata, gently warped, so the rock reads as bedded
          // layers instead of uniform static.
          const band = Math.sin(y * 0.085 + Math.sin(x * 0.014) * 1.6);
          const base = band > 0.45 ? C.sL : band < -0.5 ? C.sD : C.s0;
          col = n > 0.86 ? C.sL : n > 0.2 ? base : C.sD;
          // Ore: organic low-frequency pockets, speckled inside so they read as
          // veins rather than polka dots.
          const of1 = Math.sin(x * 0.031 + Math.sin(y * 0.019) * 2.6) * Math.cos(y * 0.026 + Math.sin(x * 0.015) * 2.2);
          if (of1 > 0.90 && n > 0.52) col = dep > bh * 0.13 ? C.ore2 : C.ore1;
          else if (of1 < -0.955 && n > 0.6) col = C.ore3;
        }
        put(i, col);
      }
    }
    g.putImageData(img, 0, 0);

    // Boulders bedded into the rock face, then the cave's stone rim and its
    // stalactites — all cheaper and cleaner as shapes than as per-pixel rules.
    const rb = mulberry32(0x80D5);
    for (let k = 0; k < Math.round(bw / 26); k++) {
      const x = rb() * bw;
      const gY = this.ground[F(clamp(x, 0, bw - 1))];
      const y = gY + 24 + rb() * (bh - gY - 24);
      if (y > bh - 2 || caveInside(F(x), F(y))) continue;
      const r = 3 + rb() * 6;
      Ell(g, x, y, r, r * 0.78, P.stoneDark);
      Ell(g, x - r * 0.25, y - r * 0.25, r * 0.55, r * 0.42, P.stone);
    }
    // cave rim
    for (let a = -Math.PI * 0.5; a <= Math.PI * 0.5; a += 0.03) {
      const rx = cave.x + Math.sin(a) * cave.r * (1 + (N(F(a * 60), 9) - 0.5) * 0.16);
      const ry = cave.top + cave.r - Math.cos(a) * cave.r * 0.95;
      if (ry > cave.bot) continue;
      R(g, rx - 1, ry - 2, 3, 3, P.stoneLit);
      R(g, rx - 1, ry - 4, 2, 2, P.stone);
    }
    for (let k = 0; k < 7; k++) {
      const sx = cave.x - cave.r * 0.75 + (k / 6) * cave.r * 1.5;
      const dy = Math.abs(sx - cave.x) / cave.r;
      const sy = cave.top + (cave.r - Math.sqrt(Math.max(0, cave.r * cave.r - (sx - cave.x) ** 2))) * 0.95;
      const h = 3 + (1 - dy) * 6;
      for (let i = 0; i < h; i++) R(g, sx, sy + i, Math.max(1, 2 - i / 3), 1, P.stoneDark);
    }

    // Roots dangling from the grass line into the dirt.
    const rr = mulberry32(0x120075);
    for (let k = 0; k < Math.round(bw / 14); k++) {
      const x = rr() * bw;
      if (caveInside(F(x), F(this.ground[F(clamp(x, 0, bw - 1))]) + 14)) continue;
      const y0 = this.ground[F(clamp(x, 0, bw - 1))] + 9;
      const len = 6 + rr() * 20;
      let cx2 = x;
      for (let i = 0; i < len; i++) {
        cx2 += (rr() - 0.5) * 1.2;
        R(g, cx2, y0 + i, 1, 1, P.root);
        if (i > 4 && i % 9 === 0) R(g, cx2 + (rr() > 0.5 ? 1 : -2), y0 + i + 1, 2, 1, P.root);
      }
    }

    // Hollow pockets down in the bedrock — small voids with a rimmed edge.
    // Without them the bottom third of the frame is a flat slab, and the frame
    // is mostly ground once the terrain sits this high.
    this.pockets = [];
    const pk = mulberry32(0x9011E);
    for (let k = 0; k < Math.round(bw / 160) + 1; k++) {
      const x = 20 + pk() * (bw - 40);
      const gY = this.ground[F(clamp(x, 0, bw - 1))];
      const y = gY + 40 + pk() * Math.max(10, bh - gY - 58);
      const rx = 7 + pk() * 13, ry = rx * (0.5 + pk() * 0.32);
      if (y + ry > bh - 3 || Math.abs(x - cave.x) < cave.r * 2.4) continue;
      Ell(g, x, y, rx + 2, ry + 2, P.stoneDark);
      Ell(g, x, y, rx, ry, '#161d33');
      Ell(g, x, y - ry * 0.40, rx * 0.86, ry * 0.34, '#1e2740');
      for (let i = 0; i < 5; i++) {          // stalactites in the pocket
        const sx = x - rx * 0.7 + (i / 4) * rx * 1.4;
        const h = 2 + pk() * 4;
        for (let j = 0; j < h; j++) R(g, sx, y - ry + j, 1, 1, P.stoneDark);
      }
      this.pockets.push({ x, y, rx, ry, ph: pk() * TAU, gem: pk() > 0.45 });
    }

    this.landCanvas = c;
  }

  /* ---------------- flora ---------------- */

  _buildFlora() {
    const { bw, bh } = this;
    const rand = mulberry32(0xF10A);
    this.trees = [];
    this.bushes = [];
    this.shrooms = [];
    this.flowers = [];
    this.grassTufts = [];
    this.crystals = [];
    this.vines = [];

    const onCave = (x) => Math.abs(x - this.cave.x) < this.cave.r * 1.35;

    // Background pine wall — darker, smaller, no sway detail. Gives the forest
    // depth behind the hero trees.
    for (let i = 0; i < Math.round(bw / 14); i++) {
      const x = rand() * bw;
      if (x > bw * 0.30 && x < bw * 0.62) continue;      // keep the stage clear
      const h = bh * (0.075 + rand() * 0.075);
      this.trees.push({ x, y: this.gy(x) + 3, h, w: h * 0.36, kind: 'pine', back: true, ph: rand() * TAU, sp: 0.5 + rand() * 0.5 });
    }

    // Hero trees.
    const hero = [
      { x: 0.048, h: 0.235, kind: 'round' },
      { x: 0.108, h: 0.150, kind: 'pine' },
      { x: 0.152, h: 0.185, kind: 'round' },
      { x: 0.196, h: 0.140, kind: 'pine' },
      { x: 0.228, h: 0.115, kind: 'round' },
      { x: 0.643, h: 0.140, kind: 'pine' },
      { x: 0.686, h: 0.185, kind: 'pine' },
      { x: 0.735, h: 0.130, kind: 'round' },
      { x: 0.778, h: 0.205, kind: 'pine' },
      { x: 0.815, h: 0.120, kind: 'pine' },
      { x: 0.955, h: 0.165, kind: 'round' },
      { x: 0.336, h: 0.100, kind: 'round' },
    ];
    for (const t of hero) {
      const x = t.x * bw, h = t.h * bh;
      this.trees.push({
        x, y: this.gy(x) + 3, h, w: h * (t.kind === 'pine' ? 0.40 : 0.60),
        kind: t.kind, back: false, ph: rand() * TAU, sp: 0.45 + rand() * 0.4,
        lantern: t.kind === 'round' && rand() > 0.55,
      });
    }
    this.trees.sort((a, b) => (a.back === b.back ? a.h - b.h : (a.back ? -1 : 1)));

    // Ground cover.
    for (let i = 0; i < Math.round(bw / 9); i++) {
      const x = rand() * bw;
      if (onCave(x)) continue;
      this.bushes.push({ x, y: this.gy(x) + 2, r: 3 + rand() * 6, ph: rand() * TAU, sp: 0.7 + rand() * 0.8, berry: rand() > 0.7 });
    }
    for (let i = 0; i < Math.round(bw / 16); i++) {
      const x = rand() * bw;
      if (onCave(x)) continue;
      this.shrooms.push({ x, y: this.gy(x) + 2, s: 2 + rand() * 3, red: rand() > 0.42, ph: rand() * TAU, glow: rand() > 0.75 });
    }
    for (let i = 0; i < Math.round(bw / 13); i++) {
      const x = rand() * bw;
      if (onCave(x)) continue;
      this.flowers.push({
        x, y: this.gy(x) + 2, h: 3 + rand() * 4, ph: rand() * TAU,
        c: ['#ff8fb8', '#ffd76b', '#b78bff', '#ffffff', '#ff7a6b'][F(rand() * 5)],
      });
    }
    for (let i = 0; i < Math.round(bw / 3.2); i++) {
      const x = rand() * bw;
      if (onCave(x)) continue;
      this.grassTufts.push({ x, y: this.gy(x) + 1, h: 2 + rand() * 5, ph: rand() * TAU, dark: rand() > 0.6 });
    }
    // Arcane crystals sprouting near the cave mouth…
    for (let i = 0; i < 14; i++) {
      const x = this.cave.x + (rand() - 0.5) * this.cave.r * 5.2;
      if (x < 4 || x > bw - 4) continue;
      const y = this.gy(x) + 4 + rand() * bh * 0.10;
      this.crystals.push({ x, y, h: 3 + rand() * 7, ph: rand() * TAU, c: rand() > 0.5 ? GLOW.cave : GLOW.rune });
    }
    // …and clusters seeded through the bedrock, which is what keeps the lower
    // third of the frame alive once the terrain sits this high.
    this.deepGems = [];
    for (let i = 0; i < Math.round(bw / 15); i++) {
      const x = 6 + rand() * (bw - 12);
      const gY = this.gy(x);
      const y = gY + 34 + rand() * Math.max(8, bh - gY - 42);
      if (y > bh - 4) continue;
      const c = rand();
      this.deepGems.push({
        x, y, n: 2 + F(rand() * 3), h: 2 + rand() * 4, ph: rand() * TAU,
        c: c > 0.62 ? GLOW.rune : c > 0.28 ? GLOW.cave : '#ffd76b',
      });
    }
    // Vines off the ledge lip, wherever the ground drops away steeply.
    for (let x = 4; x < bw - 4; x += 5) {
      const slope = this.ground[x + 3] - this.ground[x - 3];
      if (slope > 5 && rand() > 0.45) {
        this.vines.push({ x, y: this.gy(x) + 7, len: 8 + rand() * 22, ph: rand() * TAU, sp: 0.5 + rand() * 0.6 });
      }
    }
    // Near-black foliage across the very bottom edge. A framing device: it
    // gives the composition a foreground plane and stops the ground from
    // ending in a flat cut at the frame edge.
    // Kept to the left and right edges so it frames the picture rather than
    // fencing it off along the bottom.
    this.foreLeaves = [];
    for (let i = 0; i < Math.round(bw / 9); i++) {
      const side = rand() > 0.5;
      const t = Math.pow(rand(), 1.7);                 // crowd toward the edge
      const x = side ? bw * (1 - t * 0.30) : bw * t * 0.30;
      this.foreLeaves.push({
        x, h: bh * (0.05 + Math.pow(rand(), 0.7) * 0.12),
        w: 4 + rand() * 9, ph: rand() * TAU, sp: 0.5 + rand() * 0.7,
        fern: rand() > 0.35, lean: (side ? -1 : 1) * (0.4 + rand() * 0.9),
      });
    }
  }

  _buildCottage() {
    const { bw, bh } = this;
    const x = 0.873 * bw;
    this.cottage = {
      x, y: this.gy(x) + 2,
      w: Math.max(22, bh * 0.115), h: Math.max(16, bh * 0.088),
      smoke: [],
      smokeT: 0,
    };
    this.cottageWin = null; // filled while drawing so the glow lines up
  }

  _buildWaterfalls() {
    const { bw, bh } = this;
    // Two falls cut through the terrain — one down the left plateau into a
    // pool, one off the right shoulder toward the bottom of the frame. Their
    // channels are carved into the land bake so the water reads as running
    // *through* the hillside rather than painted onto it.
    const mk = (nx, wf, botN, pool) => {
      const x = nx * bw;
      return { x, w: Math.max(3, bw * wf), top: this.gy(x) + 1, bot: botN * bh, pool };
    };
    this.falls = [mk(0.132, 0.013, 0.662, true), mk(0.962, 0.011, 1.02, false)];
    this.splash = [];
  }

  /* ---------------- creatures ---------------- */

  _buildCreatures() {
    const { bw, bh } = this;
    const u = bh / 300;                     // one design unit ≈ 1px at 300 rows
    this.u = u;
    const at = (nx) => ({ x: nx * bw, y: this.gy(nx * bw) });

    // Spread wider than the key art's grouping so the menu column, which is
    // taller here than the five items in the reference, never sits on top of
    // the whole cast at once.
    this.cast = {
      imp: at(0.186), slime: at(0.232), skeleton: at(0.288), golem: at(0.336),
      wisp: at(0.386), cat: at(0.428), summoner: at(0.472), book: at(0.536),
      bat: at(0.606), mandrake: at(0.678), eye: at(0.300),
    };
    // Motes that orbit the staff orb.
    this.motes = [];
    const rand = mulberry32(0x50A);
    for (let i = 0; i < 10; i++) this.motes.push({ a: rand() * TAU, r: 4 + rand() * 9, sp: 0.6 + rand() * 1.4, rise: rand() });
  }

  _buildParticles() {
    const { bw, bh } = this;
    const rand = mulberry32(0xF17E);
    this.fireflies = [];
    for (let i = 0; i < 34; i++) {
      this.fireflies.push({
        x: rand() * bw, y: bh * (0.48 + rand() * 0.42),
        ph: rand() * TAU, sp: 0.25 + rand() * 0.7, r: 5 + rand() * 16,
        blink: rand() * TAU, home: rand() * bw,
      });
    }
    this.leaves = [];
    for (let i = 0; i < 16; i++) {
      this.leaves.push({
        x: rand() * bw, y: rand() * bh * 0.7, ph: rand() * TAU,
        sp: 6 + rand() * 12, fall: 4 + rand() * 9,
        c: rand() > 0.5 ? P.leafLit : P.leaf, spin: rand() * TAU,
      });
    }
    this.embers = [];
  }

  /* ===================================================================
     Frame
     =================================================================== */

  _frame(ts) {
    if (!this.running) return;
    let dt = (ts - this._last) / 1000;
    this._last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;           // a tab-switch must not fast-forward the sky

    this.time += dt;
    this.phase = (this.phase + dt / this.dayLength) % 1;

    try { this._draw(dt); } catch (err) {
      // A broken title screen must never take the menu (and therefore the game)
      // down with it.
      console.error('[title screen]', err);
      this.stop();
      return;
    }
    this._raf = requestAnimationFrame(this._frame);
  }

  // Ground-colour lighting. Every non-glowing colour in the scene goes through
  // this, which is what makes the whole vista respond to the time of day from
  // one place.
  _lit(hex, extra = 1) {
    const key = extra === 1 ? hex : hex + extra;
    const hit = this._litCache.get(key);
    if (hit) return hit;
    const e = this.env;
    const b = hx(hex);
    const gl = e.groundLight * extra;
    let c = [b[0] * gl, b[1] * gl, b[2] * gl];
    c = mix(c, [e.AMB[0] * 0.55, e.AMB[1] * 0.55, e.AMB[2] * 0.62], e.ambAmt);
    const out = css(c);
    this._litCache.set(key, out);
    return out;
  }

  _draw(dt) {
    const { ctx, bw, bh } = this;
    const p = this.phase;
    const sky = sampleSky(p);
    this._litCache.clear();

    // Sun / moon positions. The sun crosses right-to-left so its glow sets over
    // the left cliff, and the moon leads it by enough to already be up at dusk —
    // the composition the key art asks for.
    const sunT = (p - 0.25) / 0.5;
    const sunUp = p > 0.25 && p < 0.75;
    const sunEl = Math.sin((p - 0.25) * TAU);
    // The moon leads the sun by enough that it is already well up on the right
    // at dusk — the arrangement the key art asks for — and it fades rather
    // than vanishing once the sky brightens.
    const mp = (p + 0.565) % 1;
    const moonUp = mp > 0.25 && mp < 0.75;
    const moonT = (mp - 0.25) / 0.5;
    const moonEl = Math.sin((mp - 0.25) * TAU);

    const horizon = bh * HORIZON;
    const night = clamp((0.62 - sky.light) / 0.38, 0, 1);   // 0 by day, 1 deep night

    // Ground light never falls all the way to the sky's light level: pixel art
    // that crushes to black after dusk stops reading as art. Night comes across
    // through the ambient tint and the glows instead.
    this.env = { ...sky, night, sunEl, sunUp, groundLight: 0.34 + clamp(sky.light, 0, 1.06) * 0.66 };

    // Wind: two slow sines plus a gust envelope, shared by everything that sways.
    const gust = Math.max(0, Math.sin(this.time * 0.13) * Math.sin(this.time * 0.047 + 1.1));
    this.wind = (Math.sin(this.time * 0.42) * 0.55 + Math.sin(this.time * 0.19 + 2.1) * 0.45) * (0.55 + gust * 1.15);

    /* ---- sky ---- */
    const grd = ctx.createLinearGradient(0, 0, 0, horizon + bh * 0.06);
    grd.addColorStop(0.00, css(sky.A));
    grd.addColorStop(0.46, css(sky.B));
    grd.addColorStop(0.82, css(sky.C));
    grd.addColorStop(1.00, css(sky.D));
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, bw, F(horizon + bh * 0.06) + 1);
    ctx.fillStyle = css(sky.D);
    ctx.fillRect(0, F(horizon + bh * 0.06), bw, bh);

    if (sky.star > 0.01) this._drawStars(dt, sky.star);
    if (moonUp) this._drawMoon(bw * (1.02 - 0.95 * moonT), horizon - moonEl * bh * 0.62, sky.star);
    if (sunUp) this._drawSun(bw * (1.06 - 1.12 * sunT), horizon - sunEl * bh * 0.44, sunEl);

    // Warm bloom where the sun meets the horizon.
    if (sunUp && sunEl < 0.42) {
      const a = clamp(1 - sunEl / 0.42, 0, 1) * 0.55;
      const sx = bw * (1.06 - 1.12 * sunT);
      const bg = ctx.createRadialGradient(sx, horizon, 0, sx, horizon, bh * 0.85);
      bg.addColorStop(0, `rgba(255,168,86,${a})`);
      bg.addColorStop(0.45, `rgba(255,110,80,${a * 0.32})`);
      bg.addColorStop(1, 'rgba(255,90,90,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, bw, F(horizon + bh * 0.1));
    }

    this._drawClouds(dt, sky, sunUp ? sunEl : -1);
    if (night > 0.55) this._drawAurora(night);

    /* ---- distant ridge, castle, spire ---- */
    this._drawLayer('ridge', this.ridgeCanvas);
    this._drawCastleGlow(night);
    this._drawSpireGlow();

    /* ---- floating islands ---- */
    this._drawIslands(dt, night);

    /* ---- ground ---- */
    this._drawLayer('land', this.landCanvas);
    this._drawDeep();
    this._drawCaveGlow(night);
    this._drawCrystals();

    /* ---- flora ---- */
    for (const t of this.trees) if (t.back) this._drawTree(t, true);
    this._drawVines();
    for (const t of this.trees) if (!t.back) this._drawTree(t, false);
    this._drawBushes();
    this._drawGrass();
    this._drawShrooms(night);
    this._drawFlowers();

    /* ---- buildings & water ---- */
    this._drawCottage(dt, night);
    this._drawFalls(dt);

    /* ---- the cast ---- */
    this._drawCast(dt, night);

    /* ---- atmosphere ---- */
    this._drawLeaves(dt);
    if (night > 0.25) this._drawFireflies(dt, night);
    this._drawForeground();
    this._drawVignette(night);
  }

  /* ---------------- sky pieces ---------------- */

  _drawStars(dt, amt) {
    const { ctx, bw, bh } = this;
    ctx.save();
    ctx.globalAlpha = amt;
    ctx.drawImage(this.starCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.twinkle) {
      const tw = 0.5 + 0.5 * Math.sin(this.time * s.sp + s.ph);
      ctx.globalAlpha = amt * (0.25 + tw * 0.75);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(F(s.x), F(s.y), 1, 1);
      if (s.big && tw > 0.75) {
        ctx.fillRect(F(s.x) - 1, F(s.y), 3, 1);
        ctx.fillRect(F(s.x), F(s.y) - 1, 1, 3);
      }
    }
    ctx.restore();

    // Occasional shooting star, night only.
    this.shootT -= dt;
    if (!this.shooting && this.shootT <= 0 && amt > 0.6) {
      this.shooting = {
        x: bw * (0.15 + Math.random() * 0.7), y: bh * (0.03 + Math.random() * 0.22),
        vx: -(60 + Math.random() * 90), vy: 34 + Math.random() * 46, life: 1,
      };
      this.shootT = 7 + Math.random() * 16;
    }
    if (this.shooting) {
      const s = this.shooting;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt * 0.85;
      if (s.life <= 0 || s.y > bh * 0.5) { this.shooting = null; }
      else {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) {
          const a = (1 - i / 12) * s.life * amt;
          ctx.globalAlpha = a;
          ctx.fillStyle = i < 3 ? '#ffffff' : '#9fd8ff';
          ctx.fillRect(F(s.x - s.vx * dt * i * 0.9), F(s.y - s.vy * dt * i * 0.9), 1, 1);
        }
        ctx.restore();
      }
    }
  }

  _drawMoon(x, y, starAmt) {
    const { ctx, bh } = this;
    const r = Math.max(5, bh * 0.030);
    const vis = 0.22 + 0.78 * starAmt;
    ctx.save();
    ctx.globalAlpha = vis;
    // halo
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5.5);
    g.addColorStop(0, 'rgba(190,215,255,0.30)');
    g.addColorStop(0.35, 'rgba(150,180,255,0.10)');
    g.addColorStop(1, 'rgba(120,150,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 5.5, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // crescent, cut on an offscreen buffer so the bite is a true hole
    const s = Math.ceil(r * 2 + 4);
    if (!this._moonBuf || this._moonBuf.width !== s) {
      this._moonBuf = document.createElement('canvas');
      this._moonBuf.width = s; this._moonBuf.height = s;
    }
    const mg = this._moonBuf.getContext('2d');
    mg.clearRect(0, 0, s, s);
    Disc(mg, s / 2, s / 2, r, '#f4f1e0');
    Disc(mg, s / 2 - r * 0.30, s / 2 - r * 0.10, r * 0.82, '#e2ddc6');   // maria
    mg.globalCompositeOperation = 'destination-out';
    Disc(mg, s / 2 + r * 0.52, s / 2 - r * 0.30, r * 0.92, '#000');
    mg.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._moonBuf, F(x - s / 2), F(y - s / 2));
    ctx.restore();
  }

  _drawSun(x, y, el) {
    const { ctx, bh } = this;
    const r = Math.max(5, bh * 0.030);
    const warm = clamp(1 - el, 0, 1);
    const core = mix(hx('#fff6d0'), hx('#ff9d4a'), warm * 0.85);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
    g.addColorStop(0, rgba(core, 0.55));
    g.addColorStop(0.3, rgba(mix(core, hx('#ff7a3a'), 0.5), 0.20));
    g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r * 7, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    Disc(ctx, x, y, r, css(core));
    Disc(ctx, x, y, r * 0.66, '#fffdf0');
    ctx.restore();
  }

  _drawClouds(dt, sky, sunEl) {
    const { ctx, bw } = this;
    // Clouds pick up the sky's own horizon colour, so they warm at dusk and go
    // blue-grey at night without a separate palette.
    // Cloud colour is derived from the sky's own stops, so banks warm at dusk
    // and go blue-grey at night without needing a palette of their own.
    const shade = mix(mix(sky.B, sky.C, 0.5), [255, 255, 255], 0.16);
    const body = mix(mix(sky.C, sky.D, 0.45), [255, 255, 255], 0.30);
    const rim = mix(sky.D, [255, 240, 210], sunEl > -0.4 ? 0.5 : 0.14);
    for (const c of this.clouds) {
      c.x += (c.sp + this.wind * 1.4) * dt;
      if (c.x - c.w > bw + 30) c.x = -c.w - 30 - Math.random() * 90;
      const fade = 0.5 + sky.light * 0.5;
      for (let r = c.rows.length - 1; r >= 0; r--) {
        const row = c.rows[r];
        // The lowest row catches the light; rows above it fall into shade.
        ctx.globalAlpha = c.a * fade * (r === 0 ? 1 : 0.82);
        const col = r === 0 ? body : shade;
        for (const s of row.segs) Ell(ctx, c.x + s.x + row.off, c.y + row.y, s.w * 0.5, s.h, css(col));
      }
      // Lit underside along the flat base.
      ctx.globalAlpha = c.a * fade * 0.85;
      for (const s of c.rows[0].segs) {
        Ell(ctx, c.x + s.x + c.rows[0].off, c.y + c.rows[0].y + 0.9, s.w * 0.44, s.h * 0.5, css(rim));
      }
      ctx.globalAlpha = 1;
    }
  }

  _drawAurora(night) {
    const { ctx, bw, bh } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const base = (night - 0.55) / 0.45;
    for (let b = 0; b < 3; b++) {
      const off = b * 2.1;
      const hue = b === 0 ? [90, 230, 170] : b === 1 ? [110, 170, 240] : [180, 130, 235];
      for (let x = 0; x < bw; x += 2) {
        const w = Math.sin(x * 0.012 + this.time * 0.16 + off) * 0.5 + Math.sin(x * 0.027 - this.time * 0.11 + off) * 0.5;
        const top = bh * (0.06 + b * 0.035) + w * bh * 0.05;
        const h = bh * (0.13 + 0.06 * Math.sin(x * 0.02 + this.time * 0.2 + off));
        const a = base * 0.10 * (0.45 + 0.55 * Math.sin(x * 0.008 + this.time * 0.25 + off));
        if (a <= 0.002) continue;
        const g = ctx.createLinearGradient(0, top, 0, top + h);
        g.addColorStop(0, `rgba(${hue.join(',')},0)`);
        g.addColorStop(0.4, `rgba(${hue.join(',')},${a})`);
        g.addColorStop(1, `rgba(${hue.join(',')},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x, top, 2, h);
      }
    }
    ctx.restore();
  }

  /* ---------------- tinting the baked layers ---------------- */

  // Baked layers (the ridge and the ground) are drawn once in daylight colours
  // and re-lit here, so they respond to the hour exactly the way `_lit()` re-
  // lights everything drawn live: multiply by the light level, then tint toward
  // the ambient. Doing it on an offscreen copy is what keeps the wash off the
  // sky — compositing straight onto the main canvas would tint every pixel
  // already drawn, sky included.
  //
  // The result is cached against a quantised description of the hour, so a
  // 96-second day only rebuilds it a few dozen times instead of 60×/second.
  _drawLayer(kind, src) {
    const { ctx, bw, bh } = this;
    const e = this.env;
    const q = (v, n) => Math.round(v * n);
    const key = [
      kind, q(e.groundLight, 36), q(e.ambAmt, 36),
      q(e.AMB[0], 0.2), q(e.AMB[1], 0.2), q(e.AMB[2], 0.2),
      kind === 'ridge' ? [q(e.C[0], 0.15), q(e.C[1], 0.15), q(e.D[0], 0.15), q(e.D[2], 0.15)].join(',') : q(e.sunUp ? e.sunEl : -1, 16),
    ].join('|');

    let slot = this._layerCache[kind];
    if (!slot || slot.c.width !== bw || slot.c.height !== bh) {
      const c = document.createElement('canvas');
      c.width = bw; c.height = bh;
      slot = this._layerCache[kind] = { c, g: c.getContext('2d'), key: '' };
    }

    if (slot.key !== key) {
      slot.key = key;
      const g = slot.g;
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, bw, bh);
      g.drawImage(src, 0, 0);

      const lv = clamp(e.groundLight, 0, 1);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = css([255 * lv, 255 * lv, 255 * lv]);
      g.fillRect(0, 0, bw, bh);
      // `multiply` also paints the transparent sky area, so mask it back out.
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(src, 0, 0);

      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba([e.AMB[0] * 0.55, e.AMB[1] * 0.55, e.AMB[2] * 0.62], e.ambAmt);
      g.fillRect(0, 0, bw, bh);

      if (kind === 'ridge') {
        // Distance haze — the ridge breathes the same air as the sky behind it.
        g.fillStyle = rgba(mix(e.C, e.D, 0.45), 0.34);
        g.fillRect(0, 0, bw, bh);
      } else if (e.sunUp && e.sunEl < 0.55) {
        // Low sun rakes across the land from the west.
        const amt = clamp(1 - e.sunEl / 0.55, 0, 1) * 0.20;
        const gg = g.createLinearGradient(bw, 0, 0, 0);
        gg.addColorStop(0, 'rgba(255,150,70,0)');
        gg.addColorStop(0.55, `rgba(255,150,70,${amt * 0.35})`);
        gg.addColorStop(1, `rgba(255,168,86,${amt})`);
        g.fillStyle = gg;
        g.fillRect(0, 0, bw, bh);
      }
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(slot.c, 0, 0);
  }

  /* ---------------- glow passes ---------------- */

  _drawCastleGlow(night) {
    if (night < 0.06) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const w of this.castleWindows || []) {
      const fl = 0.78 + 0.22 * Math.sin(this.time * 2.1 + w.ph) * Math.sin(this.time * 0.7 + w.ph * 2);
      ctx.globalAlpha = night * fl * 0.95;
      ctx.fillStyle = GLOW.window;
      ctx.fillRect(F(w.x), F(w.y), Math.max(1, Math.round(w.w)), Math.max(1, Math.round(w.h)));
      ctx.globalAlpha = night * fl * 0.28;
      ctx.fillRect(F(w.x) - 1, F(w.y) - 1, Math.max(1, Math.round(w.w)) + 2, Math.max(1, Math.round(w.h)) + 2);
    }
    ctx.restore();
  }

  _drawSpireGlow() {
    const s = this.spire;
    if (!s) return;
    const { ctx, bh } = this;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 1.15);
    const amt = 0.30 + this.env.night * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.h * 1.5);
    g.addColorStop(0, `rgba(140,255,240,${0.34 * amt * pulse})`);
    g.addColorStop(0.4, `rgba(80,200,230,${0.14 * amt * pulse})`);
    g.addColorStop(1, 'rgba(60,180,220,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.h * 1.5, 0, TAU); ctx.fill();
    ctx.restore();
    void bh;
  }

  _drawCaveGlow(night) {
    const { ctx, bh } = this;
    const cave = this.cave;
    const pulse = 0.80 + 0.20 * Math.sin(this.time * 0.9) + 0.06 * Math.sin(this.time * 3.3);
    const cy = cave.top + (cave.bot - cave.top) * 0.88;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // A pool of arcane light down in the throat of the cave, not a haze over
    // the whole hillside — keep the radius close to the mouth.
    const rad = cave.r * 1.35;
    const g = ctx.createRadialGradient(cave.x, cy, 0, cave.x, cy, rad);
    const a = (0.30 + night * 0.40) * pulse;
    g.addColorStop(0, `rgba(150,240,255,${a})`);
    g.addColorStop(0.3, `rgba(70,190,255,${a * 0.55})`);
    g.addColorStop(1, 'rgba(50,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cave.x, cy, rad, 0, TAU); ctx.fill();

    // Motes drifting out of the mouth.
    ctx.fillStyle = GLOW.cave;
    for (let i = 0; i < 7; i++) {
      const t = (this.time * (0.20 + i * 0.035) + i * 0.7) % 1;
      const x = cave.x + Math.sin(this.time * 0.7 + i * 2.1) * cave.r * 0.55;
      const y = cave.bot - 4 - t * (cave.bot - cave.top) * 1.15;
      ctx.globalAlpha = (1 - t) * 0.85 * pulse;
      ctx.fillRect(F(x), F(y), 1, 1);
    }
    ctx.restore();
    void bh;
  }

  // Gem clusters and hollow pockets down in the bedrock.
  _drawDeep() {
    const { ctx } = this;
    const night = this.env.night;
    for (const p of this.pockets || []) {
      if (!p.gem) continue;
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 0.8 + p.ph);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Glow(ctx, p.x, p.y, p.rx * 2.4, GLOW.cave, (0.12 + night * 0.14) * pulse);
      ctx.restore();
      R(ctx, p.x - 1, p.y + p.ry * 0.35, 2, 2, this._lit('#3aa6c8'));
    }
    for (const gm of this.deepGems || []) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 1.1 + gm.ph);
      const dark = gm.c === GLOW.rune ? '#5f38a8' : gm.c === GLOW.cave ? '#2b7ea0' : '#a87a2c';
      for (let i = 0; i < gm.n; i++) {
        const ox = (i - (gm.n - 1) / 2) * 2.4;
        const h = gm.h * (i === F(gm.n / 2) ? 1 : 0.7);
        Tri(ctx, gm.x + ox, gm.y - h, Math.max(1, h * 0.34), h, this._lit(dark));
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Glow(ctx, gm.x, gm.y - gm.h * 0.5, gm.h * 4.5, gm.c, (0.14 + night * 0.20) * pulse);
      ctx.restore();
    }
  }

  // Silhouetted fronds along the bottom edge — the nearest plane in the scene,
  // so they sway hardest and stay nearly black at every hour.
  _drawForeground() {
    const { ctx, bh } = this;
    const col = this._lit('#0d1a1c', 0.5);
    for (const f of this.foreLeaves) {
      const base = bh + 1;
      const lean = f.lean * (2.2 + Math.sin(this.time * f.sp + f.ph) * this.wind * 3.4);
      if (f.fern) {
        // A broad frond — a curving spine with dense paired leaflets that
        // shorten toward the tip. Solid enough to read as foliage rather than
        // as a bare twig.
        for (let i = 0; i < f.h; i++) {
          const rel = i / f.h;
          const x = f.x + lean * rel * rel;
          R(ctx, x - 1, base - i, Math.max(2, 3.4 - rel * 2), 1, col);
          const sp = f.w * (1 - rel * 0.7) * (0.75 + 0.25 * Math.sin(i * 0.9));
          R(ctx, x - sp, base - i, sp, 1, col);
          R(ctx, x + 1, base - i, sp, 1, col);
        }
      } else {
        // A clump of tall grass blades from one root.
        for (let b = -2; b <= 2; b++) {
          const spread = b * f.w * 0.32;
          const h = f.h * (1 - Math.abs(b) * 0.16);
          for (let i = 0; i < h; i++) {
            const rel = i / h;
            const x = f.x + spread * rel + lean * rel * rel * 1.5;
            R(ctx, x, base - i, Math.max(1, 2.6 - rel * 2), 1, col);
          }
        }
      }
    }
  }

  _drawCrystals() {
    const { ctx } = this;
    const night = this.env.night;
    for (const c of this.crystals) {
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 1.4 + c.ph);
      Tri(ctx, c.x, c.y - c.h, Math.max(1, c.h * 0.28), c.h, this._lit(c.c === GLOW.cave ? '#3aa6c8' : '#7a4fc0'));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.25 + night * 0.5) * pulse;
      Tri(ctx, c.x, c.y - c.h + 1, Math.max(1, c.h * 0.18), c.h * 0.8, c.c);
      ctx.globalAlpha = 1;
      Glow(ctx, c.x, c.y - c.h * 0.5, c.h * 3.6, c.c, (0.16 + night * 0.30) * pulse);
      ctx.restore();
    }
  }

  /* ---------------- islands ---------------- */

  _drawIslands(dt, night) {
    const { ctx, bh } = this;
    for (const is of this.islands) {
      const bob = Math.sin(this.time * 0.36 + is.ph) * bh * 0.006;
      const y = is.y + bob;
      // grass cap
      Ell(ctx, is.x, y, is.w * 0.5, Math.max(2, is.h * 0.30), this._lit(P.grass));
      Ell(ctx, is.x, y - 1, is.w * 0.44, Math.max(1, is.h * 0.22), this._lit(P.grassLit));
      // tapering underside
      const depth = is.h * 2.5;
      for (let i = 0; i < depth; i++) {
        const t = i / depth;
        const w = is.w * 0.5 * (1 - t * t * 0.92);
        if (w < 0.6) break;
        const col = t < 0.16 ? P.grassDeep : t < 0.62 ? P.dirt : P.stone;
        R(ctx, is.x - w, y + is.h * 0.28 + i, w * 2, 1, this._lit(col, 1 - t * 0.25));
      }
      // roots
      R(ctx, is.x - is.w * 0.22, y + is.h * 0.28 + depth * 0.55, 1, depth * 0.30, this._lit(P.root));
      R(ctx, is.x + is.w * 0.18, y + is.h * 0.28 + depth * 0.42, 1, depth * 0.36, this._lit(P.root));

      if (is.tree) this._drawTree({ x: is.x + is.w * 0.10, y: y - 1, h: is.h * 3.4 * is.tree, w: is.h * 2.0 * is.tree, kind: 'round', ph: is.ph, sp: 0.6 }, false);
      if (is.house) this._drawIslandHouse(is.x - is.w * 0.14, y - 1, is.w * 0.52, is.h * 1.15, night);

      // waterfall pouring off the underside, fading into mist
      if (is.fall > 0) this._drawIslandFall(is.x - is.w * 0.30, y + is.h * 0.4, is.fall, is.ph);
    }
  }

  _drawIslandHouse(x, baseY, w, h, night) {
    const { ctx } = this;
    w = Math.max(7, w); h = Math.max(6, h);
    R(ctx, x - w / 2, baseY - h, w, h, this._lit(P.wood));
    R(ctx, x - w / 2, baseY - h, Math.max(1, w * 0.25), h, this._lit(P.woodLit));
    // roof
    Tri(ctx, x, baseY - h - h * 0.75, w * 0.72, h * 0.78, this._lit(P.roof));
    R(ctx, x - w * 0.72, baseY - h - 1, w * 1.44, Math.max(1, h * 0.14), this._lit(P.roofDark));
    // window
    const wx = x - Math.max(1, w * 0.12), wy = baseY - h * 0.62, ww = Math.max(1, w * 0.26), wh = Math.max(1, h * 0.3);
    R(ctx, wx, wy, ww, wh, '#2a1c30');
    if (night > 0.05) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = night * (0.85 + 0.15 * Math.sin(this.time * 2.4));
      R(ctx, wx, wy, ww, wh, GLOW.window);
      ctx.globalAlpha = 1;
      Glow(ctx, wx + ww / 2, wy + wh / 2, Math.max(7, w * 2.0), GLOW.window, night * 0.34);
      ctx.restore();
    }
  }

  _drawIslandFall(x, y, len, ph) {
    const { ctx } = this;
    const w = 2;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const a = (1 - t) * 0.9;
      const sway = Math.sin(this.time * 0.7 + ph + t * 2) * t * 3;
      ctx.globalAlpha = a;
      const flick = ((i + F(this.time * 42)) % 7 < 3);
      R(ctx, x + sway, y + i, w, 1, this._lit(flick ? P.waterLit : P.water));
      ctx.globalAlpha = 1;
    }
    // mist puff at the tail
    ctx.save();
    ctx.globalAlpha = 0.22;
    Ell(ctx, x + Math.sin(this.time * 0.7 + ph + 2) * 3, y + len, 4, 2, this._lit(P.waterLit));
    ctx.restore();
  }

  /* ---------------- flora drawing ---------------- */

  // Sway offset for something rooted at `y0`, `h` tall, at height `hh` up the
  // trunk. Motion scales with the square of relative height so the base is
  // planted and the crown moves.
  _sway(ph, sp, rel, amp) {
    return Math.sin(this.time * sp * 0.9 + ph + this.wind * 0.6) * this.wind * amp * rel * rel;
  }

  _drawTree(t, back) {
    const { ctx } = this;
    const dim = back ? 0.62 : 1;
    const trunkH = t.kind === 'pine' ? t.h * 0.30 : t.h * 0.44;
    const tw0 = Math.max(1.5, t.h * (t.kind === 'pine' ? 0.085 : 0.135));
    const amp = t.kind === 'pine' ? 2.0 : 3.4;

    // Trunk, tapering as it rises and leaning with the wind. A pair of branch
    // stubs on the taller round trees keeps the silhouette from reading as a
    // lollipop stick.
    for (let i = 0; i < trunkH; i++) {
      const rel = i / Math.max(1, trunkH);
      const tw = tw0 * (1 - rel * 0.34);
      const dx = this._sway(t.ph, t.sp, rel * 0.55, amp);
      R(ctx, t.x - tw / 2 + dx, t.y - i, tw, 1, this._lit(i % 5 === 2 ? P.barkDark : P.bark, dim));
      if (tw > 2) R(ctx, t.x - tw / 2 + dx, t.y - i, Math.max(1, tw * 0.3), 1, this._lit(P.barkLit, dim));
    }
    if (t.kind === 'round' && trunkH > 12) {
      for (const [side, at] of [[-1, 0.62], [1, 0.78]]) {
        const rel = at;
        const dx = this._sway(t.ph, t.sp, rel * 0.6, amp);
        const by = t.y - trunkH * at;
        const len = t.h * 0.16;
        for (let i = 0; i < len; i++) {
          R(ctx, t.x + dx + side * i, by - i * 0.75, Math.max(1, tw0 * 0.35), 1, this._lit(P.barkDark, dim));
        }
      }
    }

    if (t.kind === 'pine') {
      const layers = 5;
      const canopyH = t.h - trunkH;
      for (let l = 0; l < layers; l++) {
        const lt = l / layers;
        const yTop = t.y - trunkH - canopyH * (1 - lt) - canopyH * 0.12;
        const rel = 0.35 + (1 - lt) * 0.65;
        const dx = this._sway(t.ph, t.sp, rel, amp);
        const hw = t.w * 0.5 * (0.42 + lt * 0.62);
        const lh = canopyH * 0.34;
        Tri(ctx, t.x + dx, yTop, hw, lh, this._lit(P.pineDark, dim));
        Tri(ctx, t.x + dx - hw * 0.14, yTop + 1, hw * 0.72, lh * 0.86, this._lit(l % 2 ? P.pine : P.pineLit, dim));
      }
    } else {
      // Round canopy: overlapping blobs laid out in three tiers — a shadowed
      // underside, a broad mid mass and a lit crown — so the crown has volume
      // instead of being one flat lump.
      const cy = t.y - trunkH - t.h * 0.20;
      const dx = this._sway(t.ph, t.sp, 1, amp);
      const R0 = t.w * 0.5;
      const blobs = [
        // underside / shadow
        [-0.30, 0.52, 0.62, P.leafDeep], [0.34, 0.50, 0.60, P.leafDeep], [0.02, 0.62, 0.54, P.leafDeep],
        // body
        [0, 0.10, 1.00, P.leafDark], [-0.66, 0.16, 0.66, P.leafDark], [0.68, 0.14, 0.64, P.leafDark],
        [-0.34, -0.10, 0.78, P.leaf], [0.38, -0.08, 0.74, P.leaf], [0.02, -0.14, 0.82, P.leaf],
        // crown, catching the light
        [-0.30, -0.52, 0.56, P.leafLit], [0.24, -0.50, 0.50, P.leafLit], [-0.02, -0.66, 0.42, P.leafLit],
      ];
      for (const [ox, oy, s, col] of blobs) {
        Disc(ctx, t.x + dx + ox * R0 * 0.92, cy + oy * R0 * 0.82, R0 * s * 0.56, this._lit(col, dim));
      }
      // Specular pop on the upper left, matching the low sun.
      Disc(ctx, t.x + dx - R0 * 0.34, cy - R0 * 0.56, R0 * 0.22, this._lit(P.leafLit, dim * 1.18));

      if (t.lantern && !back) {
        const lx = t.x + dx + R0 * 0.62, ly = cy + R0 * 0.55;
        const swing = Math.sin(this.time * 1.4 + t.ph) * this.wind * 1.6;
        R(ctx, lx + swing, ly, 1, 3, this._lit(P.barkDark));
        R(ctx, lx - 1 + swing, ly + 3, 3, 3, this._lit('#6b5a3a'));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const n = 0.25 + this.env.night * 0.75;
        ctx.globalAlpha = n * (0.8 + 0.2 * Math.sin(this.time * 5 + t.ph));
        R(ctx, lx + swing, ly + 4, 1, 1, GLOW.fire);
        ctx.globalAlpha = 1;
        Glow(ctx, lx + swing, ly + 4, 13, GLOW.fire, n * 0.42);
        ctx.restore();
      }
    }
  }

  _drawBushes() {
    const { ctx } = this;
    for (const b of this.bushes) {
      const dx = Math.sin(this.time * b.sp + b.ph) * this.wind * 1.5;
      Disc(ctx, b.x + dx, b.y - b.r * 0.5, b.r, this._lit(P.leafDark));
      Disc(ctx, b.x + dx - b.r * 0.4, b.y - b.r * 0.8, b.r * 0.62, this._lit(P.leaf));
      Disc(ctx, b.x + dx + b.r * 0.45, b.y - b.r * 0.55, b.r * 0.5, this._lit(P.leafDeep));
      if (b.berry) {
        R(ctx, b.x + dx - b.r * 0.3, b.y - b.r * 0.9, 1, 1, this._lit('#ff5f7a'));
        R(ctx, b.x + dx + b.r * 0.4, b.y - b.r * 0.5, 1, 1, this._lit('#ff5f7a'));
      }
    }
  }

  _drawGrass() {
    const { ctx } = this;
    for (const g of this.grassTufts) {
      const dx = Math.sin(this.time * 1.1 + g.ph) * this.wind * 1.7;
      const col = this._lit(g.dark ? P.grassDark : P.grass);
      for (let i = 0; i < g.h; i++) {
        const rel = i / g.h;
        R(ctx, g.x + dx * rel * rel, g.y - i, 1, 1, col);
      }
    }
  }

  _drawShrooms(night) {
    const { ctx } = this;
    for (const s of this.shrooms) {
      const cap = s.red ? '#e0473f' : '#7fd0e8';
      const stem = s.red ? '#f0e4d0' : '#cfe6f0';
      const wob = Math.sin(this.time * 0.9 + s.ph) * this.wind * 0.5;
      R(ctx, s.x + wob, s.y - s.s * 1.4, Math.max(1, s.s * 0.5), s.s * 1.4, this._lit(stem));
      Ell(ctx, s.x + wob, s.y - s.s * 1.5, s.s * 1.1, Math.max(1, s.s * 0.62), this._lit(cap));
      R(ctx, s.x + wob - s.s * 0.3, s.y - s.s * 1.7, 1, 1, this._lit('#ffffff'));
      if (s.glow && night > 0.1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        Glow(ctx, s.x + wob, s.y - s.s * 1.5, s.s * 5.5, s.red ? '#ff8a6a' : GLOW.cave,
          night * 0.5 * (0.7 + 0.3 * Math.sin(this.time * 1.6 + s.ph)));
        ctx.restore();
      }
    }
  }

  _drawFlowers() {
    const { ctx } = this;
    for (const f of this.flowers) {
      const dx = Math.sin(this.time * 1.3 + f.ph) * this.wind * 1.9;
      for (let i = 0; i < f.h; i++) {
        const rel = i / f.h;
        R(ctx, f.x + dx * rel * rel, f.y - i, 1, 1, this._lit(P.grassDark));
      }
      const hx2 = f.x + dx, hy = f.y - f.h;
      R(ctx, hx2, hy - 1, 1, 1, this._lit(f.c));
      R(ctx, hx2 - 1, hy, 1, 1, this._lit(f.c));
      R(ctx, hx2 + 1, hy, 1, 1, this._lit(f.c));
      R(ctx, hx2, hy, 1, 1, this._lit('#ffe9a0'));
    }
  }

  _drawVines() {
    const { ctx } = this;
    for (const v of this.vines) {
      for (let i = 0; i < v.len; i++) {
        const rel = i / v.len;
        const dx = Math.sin(this.time * v.sp + v.ph + rel * 1.6) * this.wind * 1.4 * rel;
        R(ctx, v.x + dx, v.y + i, 1, 1, this._lit(i % 4 === 0 ? P.leafDark : P.leafDeep));
        if (i % 6 === 3) R(ctx, v.x + dx + 1, v.y + i, 1, 1, this._lit(P.leaf));
      }
    }
  }

  /* ---------------- cottage ---------------- */

  _drawCottage(dt, night) {
    const { ctx } = this;
    const c = this.cottage;
    const w = c.w, h = c.h, x = c.x, y = c.y;

    // body
    R(ctx, x - w / 2, y - h, w, h, this._lit(P.wood));
    R(ctx, x - w / 2, y - h, Math.max(1, w * 0.18), h, this._lit(P.woodLit));
    R(ctx, x + w / 2 - Math.max(1, w * 0.14), y - h, Math.max(1, w * 0.14), h, this._lit(P.woodDark));
    // beams
    for (let i = 1; i < 3; i++) R(ctx, x - w / 2, y - h * (i / 3), w, 1, this._lit(P.woodDark));

    // roof
    const rh = h * 0.72;
    Tri(ctx, x, y - h - rh, w * 0.66, rh, this._lit(P.roof));
    Tri(ctx, x - w * 0.10, y - h - rh + 1, w * 0.42, rh * 0.9, this._lit(P.roofLit));
    R(ctx, x - w * 0.68, y - h - 1, w * 1.36, Math.max(1, h * 0.10), this._lit(P.roofDark));

    // door
    const dw = Math.max(3, w * 0.22), dh = Math.max(5, h * 0.55);
    R(ctx, x - dw / 2 + w * 0.22, y - dh, dw, dh, this._lit('#4a3220'));
    R(ctx, x + w * 0.22 + dw * 0.28, y - dh * 0.5, 1, 1, this._lit('#e0c070'));

    // window
    const ww = Math.max(3, w * 0.26), wh = Math.max(3, h * 0.30);
    const wx = x - w * 0.26 - ww / 2, wy = y - h * 0.72;
    R(ctx, wx - 1, wy - 1, ww + 2, wh + 2, this._lit(P.woodDark));
    R(ctx, wx, wy, ww, wh, '#2c2038');
    if (night > 0.03) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fl = 0.86 + 0.14 * Math.sin(this.time * 3.1) * Math.sin(this.time * 1.3);
      ctx.globalAlpha = night * fl;
      R(ctx, wx, wy, ww, wh, GLOW.window);
      ctx.globalAlpha = 1;
      Glow(ctx, wx + ww / 2, wy + wh / 2, w * 2.4, GLOW.window, night * 0.30 * fl);
      ctx.restore();
      // cross bar reads as a frame once the pane is lit
      R(ctx, wx + F(ww / 2), wy, 1, wh, this._lit(P.woodDark));
    }

    // chimney + smoke
    const chx = x + w * 0.30, chy = y - h - rh * 0.45;
    R(ctx, chx, chy, Math.max(2, w * 0.11), Math.max(3, rh * 0.7), this._lit('#6a5a58'));
    R(ctx, chx - 1, chy - 1, Math.max(3, w * 0.14), 2, this._lit('#7d6c68'));

    c.smokeT -= dt;
    if (c.smokeT <= 0) {
      c.smokeT = 0.42 + Math.random() * 0.3;
      c.smoke.push({ x: chx + 1, y: chy - 2, r: 1.2, life: 1, vx: 0.6 + Math.random() * 0.5, ph: Math.random() * TAU });
    }
    for (let i = c.smoke.length - 1; i >= 0; i--) {
      const s = c.smoke[i];
      s.life -= dt * 0.20;
      s.y -= (5 + s.r) * dt;
      s.x += (s.vx + this.wind * 2.2) * dt * 3;
      s.r += dt * 2.4;
      if (s.life <= 0) { c.smoke.splice(i, 1); continue; }
      ctx.globalAlpha = s.life * 0.32;
      Disc(ctx, s.x + Math.sin(this.time * 1.1 + s.ph) * 1.5, s.y, s.r, this._lit('#cfd6e4'));
      ctx.globalAlpha = 1;
    }

    // a small fenced patch and a lantern post, to fill the right foreground
    for (let i = 0; i < 5; i++) {
      const fx = x - w * 1.5 + i * 4;
      R(ctx, fx, this.gy(fx) - 5, 1, 5, this._lit(P.woodDark));
    }
    R(ctx, x - w * 1.5, this.gy(x - w * 1.5) - 4, 17, 1, this._lit(P.woodDark));
  }

  /* ---------------- water ---------------- */

  _drawFalls(dt) {
    const { ctx, bh } = this;
    for (const f of this.falls) {
      const len = f.bot - f.top;
      // Lip where the stream tips over the edge.
      R(ctx, f.x - f.w * 1.1, f.top - 2, f.w * 2.2, 2, this._lit(P.water));
      R(ctx, f.x - f.w * 0.9, f.top - 3, f.w * 1.8, 1, this._lit(P.waterLit));

      // The column itself. Two independent scrolling streaks per column of
      // pixels, each with its own speed and offset, so the water reads as
      // falling rather than as a striped bar.
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const wob = Math.sin(i * 0.28 + this.time * 2.4) * 0.7;
        const w = f.w * (1 + t * 0.5);
        R(ctx, f.x - w / 2 + wob, f.top + i, w, 1, this._lit(P.waterDark));
        for (let k = 0; k < 3; k++) {
          const speed = 120 + k * 46;
          const sx = f.x + wob + (k - 1) * f.w * 0.34;
          const phase = ((i + this.time * speed + k * 13) % 26) / 26;
          if (phase < 0.42) {
            R(ctx, sx, f.top + i, Math.max(1, f.w * 0.28), 1,
              this._lit(phase < 0.16 ? P.waterLit : P.water));
          }
        }
      }
      // Spray haze thickening toward the base.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hz = ctx.createLinearGradient(0, f.top, 0, f.bot);
      hz.addColorStop(0, 'rgba(160,240,255,0.03)');
      hz.addColorStop(1, 'rgba(160,240,255,0.16)');
      ctx.fillStyle = hz;
      ctx.fillRect(F(f.x - f.w * 1.7), F(f.top), Math.ceil(f.w * 3.4), Math.ceil(len));
      ctx.restore();

      if (f.pool) {
        // splash pool + ripples
        const py = f.bot;
        Ell(ctx, f.x, py, f.w * 2.4, Math.max(2, f.w * 0.7), this._lit(P.waterDark));
        Ell(ctx, f.x, py - 1, f.w * 1.8, Math.max(1, f.w * 0.45), this._lit(P.water));
        for (let i = 0; i < 3; i++) {
          const t = ((this.time * 0.8 + i / 3) % 1);
          ctx.globalAlpha = (1 - t) * 0.5;
          const rx = f.w * (1 + t * 3.2);
          Ell(ctx, f.x, py - 1, rx, Math.max(1, rx * 0.26), this._lit(P.waterLit));
          ctx.globalAlpha = 1;
        }
      }

      // splash particles
      if (Math.random() < 0.55) {
        this.splash.push({ x: f.x + (Math.random() - 0.5) * f.w * 2, y: f.bot - 1, vx: (Math.random() - 0.5) * 22, vy: -(8 + Math.random() * 24), life: 1 });
      }
    }
    for (let i = this.splash.length - 1; i >= 0; i--) {
      const s = this.splash[i];
      s.life -= dt * 1.5;
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt;
      if (s.life <= 0) { this.splash.splice(i, 1); continue; }
      ctx.globalAlpha = s.life * 0.9;
      R(ctx, s.x, s.y, 1, 1, this._lit(P.waterLit));
      ctx.globalAlpha = 1;
    }
    void bh;
  }

  /* ===================================================================
     The cast — the summoner and their familiars
     =================================================================== */

  _drawCast(dt, night) {
    const c = this.cast;
    // One design unit. The cast is drawn a little larger than the key art's
    // proportions so it still reads at the resolution the scene renders at.
    const u = Math.max(1, this.bh / 300) * 1.62;
    this._drawGolem(c.golem.x, c.golem.y, u, night);
    this._drawImp(c.imp.x, c.imp.y, u);
    this._drawSlime(c.slime.x, c.slime.y, u, night);
    this._drawSkeleton(c.skeleton.x, c.skeleton.y, u);
    this._drawEye(c.eye.x, c.eye.y - 33 * u, u, night);
    this._drawWisp(c.wisp.x, c.wisp.y, u, night);
    this._drawCat(c.cat.x, c.cat.y, u, night);
    this._drawSummoner(c.summoner.x, c.summoner.y, u, night, dt);
    this._drawBook(c.book.x, c.book.y - 26 * u, u, night);
    this._drawBat(c.bat.x, c.bat.y - 34 * u, u);
    this._drawMandrake(c.mandrake.x, c.mandrake.y, u);
  }

  // Shared contact shadow so the whole group sits on the ground.
  _shadow(x, y, w, a = 0.30) {
    const { ctx } = this;
    ctx.globalAlpha = a * (0.45 + this.env.light * 0.55);
    Ell(ctx, x, y - 1, w, Math.max(1, w * 0.32), '#0a0c1c');
    ctx.globalAlpha = 1;
  }

  _drawSummoner(x, y, u, night, dt) {
    const { ctx } = this;
    const bob = Math.sin(this.time * 1.5) * 0.8 * u;
    const by = y + bob;
    const L = (c, e) => this._lit(c, e);
    this._shadow(x, y, 9 * u, 0.34);

    const cloakSway = this.wind * 1.6 + Math.sin(this.time * 0.9) * 0.6;

    // Cloak billowing behind, drawn first so the body reads in front of it.
    for (let i = 0; i < 24 * u; i++) {
      const t = i / (24 * u);
      const w = (2.4 + t * 6.4) * u;
      const dx = -cloakSway * (0.6 + t * t * 2.6) - 1.6 * u;
      R(ctx, x - w + dx, by - i, w * 1.3, 1, L(P.robeDark));
    }

    // Robe: a trapezoid flaring to the hem, with a lit edge down the west side
    // to match the low sun.
    for (let i = 0; i < 25 * u; i++) {
      const t = i / (25 * u);
      const w = (3.0 + t * 4.8) * u;
      const dx = -cloakSway * t * t * 0.9;
      R(ctx, x - w + dx, by - i, w * 2, 1, L(t > 0.74 ? P.robeDark : P.robe));
      R(ctx, x - w + dx, by - i, Math.max(1, u), 1, L(P.robeLit));
      if (t > 0.3 && t < 0.72) R(ctx, x - u * 0.5 + dx, by - i, Math.max(1, u), 1, L('#2c2b78'));
    }
    // Hem trim and the two boots under it.
    R(ctx, x - 7.8 * u, by - 1, 15.6 * u, Math.max(1, u * 1.2), L('#e8bc58'));
    R(ctx, x - 3.4 * u, by, 2.6 * u, Math.max(1, u * 1.2), L('#2a1e3e'));
    R(ctx, x + 0.9 * u, by, 2.6 * u, Math.max(1, u * 1.2), L('#2a1e3e'));

    // Shoulder mantle.
    const hy = by - 26 * u;
    Ell(ctx, x, hy + 3.0 * u, 7.4 * u, 2.9 * u, L(P.robeDark));
    Ell(ctx, x, hy + 2.2 * u, 6.8 * u, 2.2 * u, L(P.robe));
    R(ctx, x - 6.6 * u, hy + 4.0 * u, 13.2 * u, Math.max(1, u), L('#e8bc58'));

    // Hood: a peaked cowl rather than a ball, with the face sunk in shadow.
    Ell(ctx, x, hy - 2.6 * u, 5.2 * u, 5.0 * u, L(P.robe));
    Tri(ctx, x + 0.6 * u, hy - 9.4 * u, 3.0 * u, 4.4 * u, L(P.robe));
    Ell(ctx, x - 1.2 * u, hy - 3.6 * u, 3.8 * u, 3.6 * u, L(P.robeLit));
    Ell(ctx, x + 0.3 * u, hy - 1.9 * u, 3.4 * u, 3.0 * u, L('#171636'));
    Ell(ctx, x + 0.6 * u, hy - 1.6 * u, 2.4 * u, 2.2 * u, L(P.skinDark));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 + night * 0.55;
    R(ctx, x - 0.8 * u, hy - 2.2 * u, Math.max(1, u), Math.max(1, u), '#9fe8ff');
    R(ctx, x + 1.4 * u, hy - 2.2 * u, Math.max(1, u), Math.max(1, u), '#9fe8ff');
    ctx.restore();

    // Staff, held out to the west in a raised hand.
    const sx = x - 8.5 * u;
    const lean = Math.sin(this.time * 0.8) * 0.4 * u;
    for (let i = 0; i < 34 * u; i++) {
      R(ctx, sx + lean * (i / (34 * u)), by - i, Math.max(1, u * 1.3), 1, L(i % 7 === 3 ? P.barkDark : P.wood));
    }
    // Sleeve and hand reaching for it.
    R(ctx, x - 7.6 * u, hy + 3.4 * u, 5.4 * u, Math.max(1, u * 2.2), L(P.robe));
    R(ctx, sx - 0.6 * u, hy + 3.2 * u, 2.4 * u, Math.max(1, u * 2.4), L(P.skinDark));
    // orb
    const ox = sx + lean, oy = by - 35 * u;
    const pulse = 0.68 + 0.32 * Math.sin(this.time * 2.2);
    Disc(ctx, ox, oy, 3.0 * u, L('#2a4a8a'));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + night * 0.45;
    Disc(ctx, ox, oy, 2.4 * u * pulse, GLOW.orb);
    ctx.globalAlpha = 1;
    Glow(ctx, ox, oy, 16 * u, GLOW.orb, (0.34 + night * 0.44) * pulse);
    Glow(ctx, ox, oy, 34 * u, GLOW.spark, (0.12 + night * 0.20) * pulse, 0.25);
    ctx.restore();

    // motes orbiting the orb
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      m.a += dt * m.sp;
      m.rise = (m.rise + dt * 0.22) % 1;
      const mx = ox + Math.cos(m.a) * m.r * u * 0.9;
      const my = oy + Math.sin(m.a) * m.r * u * 0.45 - m.rise * 10 * u;
      ctx.globalAlpha = (1 - m.rise) * (0.5 + night * 0.5);
      ctx.fillStyle = GLOW.spark;
      ctx.fillRect(F(mx), F(my), 1, 1);
    }
    ctx.restore();
  }

  _drawBook(x, y, u, night) {
    const { ctx } = this;
    const bob = Math.sin(this.time * 1.1 + 1.2) * 1.4 * u;
    const by = y + bob;
    const flap = Math.sin(this.time * 2.6) * 1.2 * u;
    const L = (c) => this._lit(c);
    // Covers, splayed open — each half is a stack of rows that steps outward,
    // so the book reads as two angled boards meeting at a spine.
    for (let i = 0; i < 10 * u; i++) {
      const t = i / (10 * u);
      const lift = t * 1.6 * u;
      R(ctx, x - 7.4 * u - lift, by + i, 7.4 * u + lift, 1, L('#5e2a52'));
      R(ctx, x, by + i, 7.4 * u + lift, 1, L('#71355f'));
    }
    // Pages, one of them mid-turn.
    for (let i = 0; i < 8.4 * u; i++) {
      const t = i / (8.4 * u);
      const lift = t * 1.3 * u;
      R(ctx, x - 6.4 * u - lift, by + 0.7 * u + i, 6.2 * u + lift, 1, L('#e6dcc2'));
      R(ctx, x + 0.5 * u, by + 0.7 * u + i, 6.2 * u + lift + flap * 0.3, 1, L('#f6eeda'));
    }
    // Spine and a ribbon marker.
    R(ctx, x - Math.max(1, u * 0.7), by - 0.6 * u, Math.max(1, u * 1.4), 10.6 * u, L('#3f1c3a'));
    R(ctx, x - Math.max(1, u * 0.4), by + 9.4 * u, Math.max(1, u), 3.4 * u, L('#c04a5a'));
    // Text lines.
    for (let i = 1; i < 5; i++) {
      R(ctx, x - 5.6 * u, by + 1.8 * u + i * 1.5 * u, 4.4 * u, Math.max(1, u * 0.5), L('#a8977f'));
      R(ctx, x + 1.4 * u, by + 1.8 * u + i * 1.5 * u, 4.4 * u, Math.max(1, u * 0.5), L('#a8977f'));
    }
    // rising glyphs
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const t = ((this.time * 0.35 + i * 0.2) % 1);
      ctx.globalAlpha = (1 - t) * (0.45 + night * 0.55);
      ctx.fillStyle = GLOW.rune;
      const gx = x - 3 * u + Math.sin(this.time + i * 2) * 4 * u;
      ctx.fillRect(F(gx), F(by - t * 16 * u), Math.max(1, F(u)), Math.max(1, F(u)));
    }
    ctx.globalAlpha = 1;
    Glow(ctx, x, by + 4 * u, 22 * u, GLOW.rune, 0.24 + night * 0.34);
    ctx.restore();
  }

  _drawSlime(x, y, u, night) {
    const { ctx } = this;
    // hop cycle: squash on land, stretch in the air
    const c = (this.time * 0.75) % 1;
    const air = Math.max(0, Math.sin(c * Math.PI));
    const hop = air * 7 * u;
    const sq = 1 + air * 0.22 - (c > 0.92 || c < 0.08 ? 0.20 : 0);
    const w = 9 * u / sq, h = 7 * u * sq;
    const by = y - hop;
    this._shadow(x, y, w * (1 - air * 0.4), 0.28);
    Ell(ctx, x, by - h * 0.5, w, h * 0.5, this._lit('#3fbf6a'));
    Ell(ctx, x, by - h * 0.62, w * 0.82, h * 0.36, this._lit('#63e08a'));
    Ell(ctx, x - w * 0.32, by - h * 0.75, w * 0.24, h * 0.16, this._lit('#c8ffd8'));
    R(ctx, x - w * 0.34, by - h * 0.55, Math.max(1, u), Math.max(1, u * 1.4), '#10301e');
    R(ctx, x + w * 0.22, by - h * 0.55, Math.max(1, u), Math.max(1, u * 1.4), '#10301e');
    R(ctx, x - w * 0.10, by - h * 0.3, Math.max(1, u * 2), Math.max(1, u * 0.6), '#10301e');
    if (night > 0.2) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      Glow(ctx, x, by - h * 0.5, w * 2.6, '#63e08a', night * 0.24);
      ctx.restore();
    }
  }

  _drawSkeleton(x, y, u) {
    const { ctx } = this;
    const bob = Math.sin(this.time * 1.2 + 0.6) * 0.7 * u;
    const by = y + bob;
    this._shadow(x, y, 5 * u, 0.26);
    const L = (c) => this._lit(c);
    // Legs, with knee and foot joints so they are not two sticks.
    for (const lx of [-2.4, 1.4]) {
      R(ctx, x + lx * u, by - 7.5 * u, Math.max(1, u * 1.1), 7.5 * u, L(P.boneDark));
      R(ctx, x + lx * u - 0.4 * u, by - 4 * u, Math.max(1, u * 1.8), Math.max(1, u), L(P.bone));
      R(ctx, x + lx * u - 0.6 * u, by - 1 * u, Math.max(1, u * 2.4), Math.max(1, u), L(P.bone));
    }
    // Pelvis, spine and a curved ribcage.
    R(ctx, x - 3 * u, by - 9 * u, 6 * u, 2 * u, L(P.boneDark));
    R(ctx, x - 0.5 * u, by - 17 * u, Math.max(1, u), 8 * u, L(P.bone));
    for (let i = 0; i < 4; i++) {
      const w = (3.4 - i * 0.35) * u;
      const ry = by - 16 * u + i * 1.9 * u;
      R(ctx, x - w, ry, w * 2, Math.max(1, u * 0.9), L(i % 2 ? P.bone : '#cbc9b4'));
      R(ctx, x - w, ry, Math.max(1, u), Math.max(1, u * 0.9), L(P.boneDark));
      R(ctx, x + w - u, ry, Math.max(1, u), Math.max(1, u * 0.9), L(P.boneDark));
    }
    // Collar and skull.
    R(ctx, x - 2.6 * u, by - 18.4 * u, 5.2 * u, Math.max(1, u), L(P.boneDark));
    Ell(ctx, x, by - 21 * u, 3.4 * u, 3.0 * u, L(P.bone));
    R(ctx, x - 2.4 * u, by - 20.4 * u, 4.8 * u, Math.max(1, u * 0.9), L('#cbc9b4'));   // jaw line
    R(ctx, x - 2.1 * u, by - 22.2 * u, Math.max(1, u * 1.3), Math.max(1, u * 1.4), '#120e1e');
    R(ctx, x + 0.9 * u, by - 22.2 * u, Math.max(1, u * 1.3), Math.max(1, u * 1.4), '#120e1e');
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 + this.env.night * 0.55;
    R(ctx, x - 2.1 * u, by - 22.2 * u, Math.max(1, u * 1.3), Math.max(1, u * 1.4), '#ff7a4a');
    R(ctx, x + 0.9 * u, by - 22.2 * u, Math.max(1, u * 1.3), Math.max(1, u * 1.4), '#ff7a4a');
    ctx.globalAlpha = 1;
    Glow(ctx, x, by - 21.6 * u, 8 * u, '#ff8a4a', 0.12 + this.env.night * 0.22);
    ctx.restore();
    // Bow held out to the east, arm reaching for the string.
    const bx = x + 5.2 * u, byy = by - 14 * u;
    R(ctx, x + 2.4 * u, by - 15 * u, 3.4 * u, Math.max(1, u * 1.1), L(P.bone));
    for (let i = -8; i <= 8; i++) {
      const t = i / 8;
      R(ctx, bx + (1 - t * t) * 2.6 * u, byy + i * u, Math.max(1, u * 1.2), Math.max(1, u), L('#7a5a34'));
    }
    for (let i = -8; i <= 8; i++) R(ctx, bx, byy + i * u, Math.max(1, u * 0.7), Math.max(1, u), L('#ded6be'));
  }

  _drawGolem(x, y, u, night) {
    const { ctx } = this;
    const breathe = Math.sin(this.time * 0.9) * 0.6 * u;
    const by = y + breathe;
    this._shadow(x, y, 8 * u, 0.34);
    const L = (c) => this._lit(c);
    // legs
    R(ctx, x - 5 * u, by - 8 * u, 3.5 * u, 8 * u, L('#4a5266'));
    R(ctx, x + 1.5 * u, by - 8 * u, 3.5 * u, 8 * u, L('#4a5266'));
    // torso
    R(ctx, x - 6 * u, by - 21 * u, 12 * u, 13 * u, L('#5a6478'));
    R(ctx, x - 6 * u, by - 21 * u, 3 * u, 13 * u, L('#6d7890'));
    R(ctx, x + 3.5 * u, by - 21 * u, 2.5 * u, 13 * u, L('#3d4558'));
    // arms
    R(ctx, x - 9 * u, by - 20 * u, 3 * u, 10 * u, L('#525b70'));
    R(ctx, x + 6 * u, by - 20 * u, 3 * u, 10 * u, L('#525b70'));
    // head
    R(ctx, x - 4 * u, by - 27 * u, 8 * u, 6.5 * u, L('#636d84'));
    R(ctx, x - 4 * u, by - 27 * u, 2 * u, 6.5 * u, L('#79839c'));
    // glowing core + eyes
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 1.7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.55 + night * 0.45) * pulse;
    R(ctx, x - 1.6 * u, by - 16.5 * u, 3.4 * u, 3.4 * u, '#7bff9c');
    R(ctx, x - 2.6 * u, by - 25 * u, 1.6 * u, 1.6 * u, '#7bff9c');
    R(ctx, x + 1.2 * u, by - 25 * u, 1.6 * u, 1.6 * u, '#7bff9c');
    ctx.globalAlpha = 1;
    Glow(ctx, x, by - 15 * u, 13 * u, '#7bff9c', (0.16 + night * 0.24) * pulse);
    ctx.restore();
  }

  _drawImp(x, y, u) {
    const { ctx } = this;
    const bob = Math.sin(this.time * 2.0 + 2.4) * 0.9 * u;
    const by = y + bob;
    this._shadow(x, y, 4 * u, 0.24);
    const L = (c) => this._lit(c);
    R(ctx, x - 2.4 * u, by - 6 * u, 4.8 * u, 6 * u, L('#39304e'));    // body
    Ell(ctx, x, by - 9 * u, 3.4 * u, 3.2 * u, L('#463a5e'));          // head
    Tri(ctx, x - 2.4 * u, by - 14 * u, 1.1 * u, 2.6 * u, L('#463a5e'));
    Tri(ctx, x + 2.4 * u, by - 14 * u, 1.1 * u, 2.6 * u, L('#463a5e'));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + this.env.night * 0.5;
    R(ctx, x - 1.6 * u, by - 9.6 * u, Math.max(1, u), Math.max(1, u), '#ffd24a');
    R(ctx, x + 0.8 * u, by - 9.6 * u, Math.max(1, u), Math.max(1, u), '#ffd24a');
    ctx.restore();
    R(ctx, x - 3.4 * u, by - 4 * u, Math.max(1, u), 3 * u, L('#39304e'));
    R(ctx, x + 2.6 * u, by - 4 * u, Math.max(1, u), 3 * u, L('#39304e'));
  }

  _drawWisp(x, y, u, night) {
    const { ctx } = this;
    const by = y - 12 * u + Math.sin(this.time * 1.9) * 2.4 * u;
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 4.1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // body
    ctx.globalAlpha = 0.75 + night * 0.25;
    Ell(ctx, x, by, 3.6 * u, 4.4 * u, '#9fe4ff');
    Ell(ctx, x, by - 0.6 * u, 2.2 * u, 2.8 * u, '#ffffff');
    // arcing sparks
    ctx.globalAlpha = (0.55 + night * 0.45) * pulse;
    for (let i = 0; i < 7; i++) {
      const a = this.time * 3.4 + i * (TAU / 7);
      const rr = (5 + Math.sin(this.time * 6 + i) * 2.2) * u;
      ctx.fillStyle = '#d8f4ff';
      ctx.fillRect(F(x + Math.cos(a) * rr), F(by + Math.sin(a) * rr * 0.8), 1, 1);
    }
    ctx.globalAlpha = 1;
    Glow(ctx, x, by, 15 * u, GLOW.spark, (0.24 + night * 0.34) * pulse);
    ctx.restore();
    // tiny arms/legs so it reads as a creature, not a light
    R(ctx, x - 4.6 * u, by, Math.max(1, u), 2 * u, this._lit('#8fd8f0'));
    R(ctx, x + 3.6 * u, by, Math.max(1, u), 2 * u, this._lit('#8fd8f0'));
  }

  _drawCat(x, y, u, night) {
    const { ctx } = this;
    const by = y - 18 * u + Math.sin(this.time * 1.3 + 0.8) * 2.2 * u;
    const a = 0.72 + 0.10 * Math.sin(this.time * 2.0);
    ctx.save();
    ctx.globalAlpha = a;
    const L = (c) => this._lit(c, 1.3);
    // A spirit cat: no hind legs, the body tapering off into a wisp of tail,
    // front paws tucked, ears up.
    Ell(ctx, x, by, 4.6 * u, 3.4 * u, L('#dfe9fb'));
    Ell(ctx, x - 0.8 * u, by - 0.9 * u, 3.8 * u, 2.5 * u, L('#f0f7ff'));
    Ell(ctx, x - 3.0 * u, by - 2.9 * u, 3.2 * u, 2.9 * u, L('#f4faff'));   // head
    Tri(ctx, x - 4.5 * u, by - 7.1 * u, 1.2 * u, 2.4 * u, L('#eef5ff'));   // ears
    Tri(ctx, x - 1.7 * u, by - 7.1 * u, 1.2 * u, 2.4 * u, L('#eef5ff'));
    R(ctx, x - 4.2 * u, by - 6.3 * u, Math.max(1, u), Math.max(1, u), L('#d3a8dc'));
    R(ctx, x - 1.9 * u, by - 6.3 * u, Math.max(1, u), Math.max(1, u), L('#d3a8dc'));
    R(ctx, x - 3.4 * u, by + 2.2 * u, 1.8 * u, Math.max(1, u * 1.3), L('#f4faff'));  // paws
    R(ctx, x - 0.9 * u, by + 2.4 * u, 1.8 * u, Math.max(1, u * 1.3), L('#f4faff'));
    // Tail: curls upward and dissolves at the tip.
    for (let i = 0; i < 13; i++) {
      const t = i / 13;
      const tx = x + 3.6 * u + Math.sin(this.time * 1.6 + t * 2.4) * 1.1 * u + i * 0.60 * u;
      const ty = by + 1.0 * u - Math.sin(this.time * 2.2 + t * 3.0) * 3.2 * u * t - t * t * 5.2 * u;
      ctx.globalAlpha = a * (1 - t * 0.85);
      R(ctx, tx, ty, Math.max(1, u * (1.5 - t)), Math.max(1, u * (1.5 - t)), L('#f4faff'));
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + night * 0.5;
    R(ctx, x - 4.0 * u, by - 3.2 * u, Math.max(1, u), Math.max(1, u * 1.3), '#7ee8ff');
    R(ctx, x - 2.0 * u, by - 3.2 * u, Math.max(1, u), Math.max(1, u * 1.3), '#7ee8ff');
    ctx.globalAlpha = 1;
    Glow(ctx, x - 1 * u, by - 1 * u, 13 * u, '#a8e8ff', 0.14 + night * 0.22);
    ctx.restore();
  }

  _drawEye(x, y, u, night) {
    const { ctx } = this;
    const by = y + Math.sin(this.time * 1.05) * 3.0 * u;
    const bx = x + Math.sin(this.time * 0.42) * 5 * u;
    const flap = Math.sin(this.time * 9) * 2.4 * u;
    const L = (c) => this._lit(c);
    // bat wings
    Tri(ctx, bx - 5.4 * u, by - 2 * u + flap, 3.0 * u, 4.5 * u, L('#6b3f6e'));
    Tri(ctx, bx + 5.4 * u, by - 2 * u - flap, 3.0 * u, 4.5 * u, L('#6b3f6e'));
    // eyeball
    Disc(ctx, bx, by, 4.0 * u, L('#f2f0e4'));
    Disc(ctx, bx, by, 3.2 * u, L('#ffffff'));
    const look = Math.sin(this.time * 0.6) * 1.4 * u;
    Disc(ctx, bx + look, by, 1.8 * u, this._lit('#c03040'));
    Disc(ctx, bx + look, by, 0.9 * u, '#180a12');
    // blink
    const bl = (this.time * 0.42) % 1;
    if (bl > 0.965) R(ctx, bx - 4 * u, by - 4 * u, 8 * u, 8 * u, L('#c08a70'));
    if (night > 0.2) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1;
      Glow(ctx, bx, by, 18 * u, '#ff6a7a', night * 0.26);
      ctx.restore();
    }
  }

  _drawBat(x, y, u) {
    const { ctx } = this;
    const t = this.time;
    const bx = x + Math.sin(t * 0.62) * 9 * u;
    const by = y + Math.sin(t * 1.15 + 1.0) * 4 * u;
    const flap = Math.sin(t * 11) * 3.2 * u;
    const L = (c) => this._lit(c);
    // wings
    Tri(ctx, bx - 6 * u, by - 1 * u + flap, 3.6 * u, 5 * u, L('#4a2f56'));
    Tri(ctx, bx + 6 * u, by - 1 * u - flap, 3.6 * u, 5 * u, L('#4a2f56'));
    R(ctx, bx - 8 * u, by + flap, 4 * u, Math.max(1, u), L('#5c3a68'));
    R(ctx, bx + 4 * u, by - flap, 4 * u, Math.max(1, u), L('#5c3a68'));
    // body + head
    Ell(ctx, bx, by, 2.6 * u, 3.0 * u, L('#5c3a68'));
    Tri(ctx, bx - 1.6 * u, by - 5.4 * u, 1.0 * u, 2.0 * u, L('#5c3a68'));
    Tri(ctx, bx + 1.6 * u, by - 5.4 * u, 1.0 * u, 2.0 * u, L('#5c3a68'));
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 + this.env.night * 0.55;
    R(ctx, bx - 1.4 * u, by - 1.4 * u, Math.max(1, u), Math.max(1, u), '#ffcf6b');
    R(ctx, bx + 0.6 * u, by - 1.4 * u, Math.max(1, u), Math.max(1, u), '#ffcf6b');
    ctx.restore();
  }

  _drawMandrake(x, y, u) {
    const { ctx } = this;
    const wob = Math.sin(this.time * 1.35) * 1.1 * u;
    const step = Math.abs(Math.sin(this.time * 1.35));
    const by = y - step * 1.2 * u;
    this._shadow(x, y, 8 * u, 0.30);
    const L = (c) => this._lit(c);
    // legs
    R(ctx, x - 3.4 * u, by - 5 * u, 1.6 * u, 5 * u, L('#8a6a3a'));
    R(ctx, x + 1.8 * u, by - 5 * u, 1.6 * u, 5 * u, L('#8a6a3a'));
    // tuber body
    Ell(ctx, x + wob * 0.3, by - 14 * u, 7.2 * u, 9.5 * u, L('#a37a44'));
    Ell(ctx, x - 2.2 * u + wob * 0.3, by - 16 * u, 4.0 * u, 6.0 * u, L('#bc9055'));
    // face
    R(ctx, x - 2.6 * u + wob * 0.3, by - 16 * u, 1.6 * u, 2.0 * u, '#2a1c10');
    R(ctx, x + 1.4 * u + wob * 0.3, by - 16 * u, 1.6 * u, 2.0 * u, '#2a1c10');
    Ell(ctx, x - 0.4 * u + wob * 0.3, by - 11.5 * u, 2.6 * u, 1.8 * u, '#2a1c10');
    // leaf sprout, swaying with the wind like everything else
    const lean = wob + this.wind * 1.8;
    R(ctx, x + wob * 0.3, by - 24 * u, Math.max(1, u), 5 * u, L('#4a8a3a'));
    Ell(ctx, x - 3.2 * u + lean, by - 25.5 * u, 3.6 * u, 1.8 * u, L('#5fbf4a'));
    Ell(ctx, x + 3.2 * u + lean, by - 25.0 * u, 3.2 * u, 1.6 * u, L('#4fa842'));
    Ell(ctx, x + 0.4 * u + lean * 1.2, by - 27.5 * u, 2.2 * u, 2.6 * u, L('#6fd45a'));
    // arms
    R(ctx, x - 8 * u + wob * 0.3, by - 15 * u, 2 * u, Math.max(1, u * 1.4), L('#8a6a3a'));
    R(ctx, x + 6 * u + wob * 0.3, by - 15 * u, 2 * u, Math.max(1, u * 1.4), L('#8a6a3a'));
  }

  /* ---------------- atmosphere ---------------- */

  _drawLeaves(dt) {
    const { ctx, bw, bh } = this;
    for (const l of this.leaves) {
      l.x += (l.sp * 0.35 + this.wind * 9) * dt;
      l.y += l.fall * dt;
      l.spin += dt * 3;
      if (l.y > bh * 0.9) { l.y = -4; l.x = Math.random() * bw; }
      if (l.x > bw + 6) l.x = -6;
      if (l.x < -6) l.x = bw + 6;
      const w = 1 + Math.abs(Math.cos(l.spin)) * 2;
      ctx.globalAlpha = 0.8;
      R(ctx, l.x + Math.sin(l.y * 0.09 + l.ph) * 3, l.y, w, 1, this._lit(l.c));
      ctx.globalAlpha = 1;
    }
  }

  _drawFireflies(dt, night) {
    const { ctx, bw } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fireflies) {
      f.ph += dt * f.sp;
      const x = f.home + Math.sin(f.ph) * f.r * 2.4 + Math.sin(f.ph * 0.37) * f.r;
      const y = f.y + Math.cos(f.ph * 1.31) * f.r * 0.7;
      const blink = Math.sin(this.time * 2.4 + f.blink);
      const a = clamp(blink, 0, 1) * night * 0.95;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = GLOW.fly;
      ctx.fillRect(F(x), F(y), 1, 1);
      ctx.globalAlpha = 1;
      Glow(ctx, x, y, 7, GLOW.fly, a * 0.34);
    }
    ctx.restore();
    void bw;
  }

  _drawVignette(night) {
    const { ctx, bw, bh } = this;
    // Darkens the corners so the title and menu type always has contrast under
    // it, and deepens after dark.
    const g = ctx.createRadialGradient(bw * 0.5, bh * 0.46, bh * 0.28, bw * 0.5, bh * 0.5, bh * 0.95);
    g.addColorStop(0, 'rgba(4,5,14,0)');
    g.addColorStop(1, `rgba(4,5,14,${0.34 + night * 0.20})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, bw, bh);

    // A gentle darkening band behind the menu column.
    const b = ctx.createLinearGradient(0, bh * 0.55, 0, bh);
    b.addColorStop(0, 'rgba(6,7,18,0)');
    b.addColorStop(1, `rgba(6,7,18,${0.22 + night * 0.14})`);
    ctx.fillStyle = b;
    ctx.fillRect(0, F(bh * 0.55), bw, bh);
  }
}
