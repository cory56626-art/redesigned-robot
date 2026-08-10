// Summoner Realms — animated main-menu backdrop and title.
//
// The menu used to sit on a flat radial gradient with a blank game canvas
// behind it, because the render loop only draws when a world is loaded. This
// draws a small diorama onto that same canvas instead: layered ridges, a slow
// dusk-to-night wash, and a foreground bank built from the game's *own* tile
// and tree sprites, so the menu looks like the world you are about to enter
// rather than like a settings page.
//
// It is not a generated world. Full worldgen is ~2s and ~450KB of typed arrays,
// which is far too much to spend before the player has pressed a button; the
// ridges here are a couple of layered sine sums over a seeded hash.
import { TILE } from '../config.js?v=realms-qor-49';
import { T } from '../world/tiles.js?v=realms-qor-49';
import { Sprites, framingMask, N, E, S, WBIT } from '../art/sprites.js?v=realms-qor-49';
import { mulberry32 } from '../utils.js?v=realms-qor-49';

// One full dawn→dusk→night cycle behind the menu, in seconds. Slow enough that
// it reads as ambience rather than as a clock.
const DAY_SECONDS = 90;
const SCROLL = 5.5;            // px/sec the foreground bank drifts
const STAR_COUNT = 130;
const MOTE_COUNT = 34;
// Dirt below the top few rows of the bank is uniform and fully enclosed, so it
// is a flat fill rather than hundreds of identical tile blits.
const DEEP_DIRT = '#5b3f24';

// Sky anchors, sampled from the forest and corruption biome palettes so the
// menu is unmistakably the same world.
const SKY = [
  { t: 0.00, top: '#14081e', bot: '#2a1436' }, // deep night
  { t: 0.18, top: '#2a1c46', bot: '#6a4a72' }, // first light
  { t: 0.34, top: '#3d5a8c', bot: '#8fa7c4' }, // morning
  { t: 0.55, top: '#4a6fa8', bot: '#a8c4d8' }, // day
  { t: 0.74, top: '#4a2f5a', bot: '#c47b6a' }, // dusk
  { t: 0.88, top: '#1b1436', bot: '#4a2f5a' }, // last light
  { t: 1.00, top: '#14081e', bot: '#2a1436' },
];

const lerp = (a, b, t) => a + (b - a) * t;
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
function skyAt(phase) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i], b = SKY[i + 1];
    if (phase >= a.t && phase <= b.t) {
      const t = (phase - a.t) / (b.t - a.t);
      return { top: mixHex(a.top, b.top, t), bot: mixHex(a.bot, b.bot, t) };
    }
  }
  return { top: SKY[0].top, bot: SKY[0].bot };
}
// 0 at midnight, 1 at midday — drives the star fade and the ridge contrast.
function daylight(phase) {
  return Math.max(0, Math.min(1, Math.sin((phase - 0.08) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5));
}

// Smooth 1-D value noise over a seeded hash — enough for a ridge line, and far
// cheaper than running the real terrain generator.
function ridgeHeight(x, seed, scale, amp) {
  const i = Math.floor(x / scale);
  const f = (x / scale) - i;
  const h = (n) => {
    let v = Math.imul(n ^ seed, 2654435761) >>> 0;
    v ^= v >>> 15;
    return ((v >>> 0) % 1000) / 1000;
  };
  const s = f * f * (3 - 2 * f); // smoothstep
  return lerp(h(i), h(i + 1), s) * amp;
}

export class MenuScene {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.time = 18;             // start near dusk — the most flattering light
    this.active = false;
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const rand = mulberry32(0x5e11a1);
    this.stars = Array.from({ length: STAR_COUNT }, () => ({
      x: rand(), y: rand() * 0.55, r: 0.6 + rand() * 1.1, tw: rand() * Math.PI * 2, depth: 0.3 + rand() * 0.7,
    }));
    this.motes = Array.from({ length: MOTE_COUNT }, () => ({
      x: rand(), y: rand(), vx: 4 + rand() * 12, vy: 3 + rand() * 9,
      r: 0.8 + rand() * 1.6, ph: rand() * Math.PI * 2, leaf: rand() < 0.3,
    }));
    // Where the foreground trees stand, in bank-tile columns.
    this.trees = [];
    for (let i = 0; i < 14; i++) {
      this.trees.push({ col: Math.floor(rand() * 120), h: 5 + Math.floor(rand() * 4), variant: Math.floor(rand() * 4) });
    }
    this.title = new MenuTitle();
    this.tagline = new Tagline();
  }

  start() { this.active = true; this.tagline.reset(); }
  stop() { this.active = false; }

  update(dt) {
    if (!this.active) return;
    if (!this.reduced) this.time += dt;
    this.draw();
    this.title.draw(this.time, this.reduced);
    if (!this.reduced) this.tagline.update(dt);
  }

  draw() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    const phase = (this.time / DAY_SECONDS) % 1;
    const sky = skyAt(phase);
    const day = daylight(phase);
    ctx.imageSmoothingEnabled = false;

    // 1. Sky.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 2. Moon, riding the far side of the cycle from the sun.
    this._drawMoon(ctx, W, H, phase, day);

    // 3. Stars, gone by full day.
    const starA = Math.max(0, 1 - day * 1.5);
    if (starA > 0.01) {
      for (const s of this.stars) {
        const tw = 0.55 + Math.sin(this.time * 1.7 + s.tw) * 0.45;
        ctx.globalAlpha = starA * tw * s.depth;
        ctx.fillStyle = '#dfe8ff';
        const sx = (s.x * W - this.time * SCROLL * 0.06 * s.depth) % W;
        ctx.fillRect((sx + W) % W, s.y * H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    // 4. Two ridge silhouettes at different parallax rates. Both are tinted
    //    toward the sky so distance reads as haze — but only part-way, or they
    //    wash out completely at midday and the horizon goes flat.
    const horizon = H * 0.72;
    // The tints are deliberately kept well below the sky's luminance. Mixing
    // far enough toward `sky.bot` to look like real atmospheric haze put both
    // ridges within a few points of the midday sky and the horizon vanished.
    // The bank's highest possible ground line — nothing below it is ever seen.
    const bankFloor = horizon + H * 0.13;
    this._ridge(ctx, W, H, horizon + H * 0.04, 0.18, 0x9a71, 260, H * 0.16, mixHex('#241f4a', sky.bot, 0.18 + day * 0.12), bankFloor);
    this._ridge(ctx, W, H, horizon + H * 0.02, 0.42, 0x3f12, 170, H * 0.19, mixHex('#0f0d24', sky.bot, 0.06 + day * 0.06), bankFloor);

    // 5. Foreground bank, built from the real tile and tree sprites.
    this._bank(ctx, W, H, horizon, day);

    // 6. Drifting motes.
    this._motes(ctx, W, H, day);

    // 7. A vignette, so the panel always has contrast to sit on whatever the
    //    sky is doing. Baked once per size and blitted: evaluating a
    //    full-screen radial gradient every frame was the single most expensive
    //    thing in the scene.
    ctx.drawImage(this._vignette(W, H), 0, 0);
  }

  _vignette(W, H) {
    if (this._vig && this._vig.width === W && this._vig.height === H) return this._vig;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const v = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.22, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    v.addColorStop(0, 'rgba(6,9,20,0)');
    v.addColorStop(1, 'rgba(6,9,20,0.82)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    this._vig = c;
    return c;
  }

  _drawMoon(ctx, W, H, phase, day) {
    // Visible through the night half, arcing across the upper sky.
    const nightT = phase < 0.2 ? phase / 0.2 * 0.5 + 0.5 : (phase > 0.8 ? (phase - 0.8) / 0.2 * 0.5 : -1);
    if (nightT < 0) return;
    const a = Math.max(0, 1 - day * 1.4);
    if (a < 0.02) return;
    const x = W * (0.14 + nightT * 0.72);
    const y = H * (0.30 - Math.sin(nightT * Math.PI) * 0.16);
    const r = Math.max(14, Math.min(W, H) * 0.035);
    ctx.globalAlpha = a * 0.35;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    glow.addColorStop(0, 'rgba(198,214,255,0.55)');
    glow.addColorStop(1, 'rgba(198,214,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = a;
    ctx.fillStyle = '#dce6ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,166,210,0.5)';
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.26, r * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // `floorY` stops the polygon short of the bottom of the screen: the bank is
  // drawn over everything below it anyway, and filling the whole lower half
  // twice per frame is pure overdraw.
  _ridge(ctx, W, H, baseY, speed, seed, scale, amp, color, floorY) {
    const off = this.time * SCROLL * speed;
    const bottom = Math.min(H, floorY);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    const step = 6;
    for (let x = 0; x <= W + step; x += step) {
      const wx = x + off;
      const y = baseY - ridgeHeight(wx, seed, scale, amp) - ridgeHeight(wx, seed ^ 0x77, scale * 0.37, amp * 0.34);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, bottom);
    ctx.closePath();
    ctx.fill();
  }

  // The near bank: real grass/dirt tile sprites with real trunk and canopy
  // sprites standing on them. This is the layer that makes the menu read as
  // *this* game rather than as a generic parallax background.
  _bank(ctx, W, H, horizon, day) {
    const off = this.time * SCROLL;
    const cols = Math.ceil(W / TILE) + 2;
    const startCol = Math.floor(off / TILE);
    // Two octaves: long swells plus a tile or two of local roughness, so the
    // bank has hills rather than one flat shelf with occasional bumps.
    const topOf = (col) => {
      const wx = col * TILE;
      return horizon + H * 0.13 - ridgeHeight(wx, 0x1234, 330, 74) - ridgeHeight(wx, 0x99, 96, 26);
    };
    // Ground row per visible column, resolved once. topOf costs four hashes and
    // the framing pass below asks for its neighbours eight times per tile.
    const rowOf = [];
    for (let i = -2; i <= cols + 1; i++) rowOf[i + 2] = Math.round(topOf(startCol + i) / TILE);
    const rowAt = (i) => rowOf[i + 2];

    ctx.save();
    ctx.translate(-(off % TILE), 0);

    // Trees first, so the bank's grass line overlaps their roots.
    for (const t of this.trees) {
      const col = t.col + Math.floor(startCol / 120) * 120;
      for (const c of [col, col + 120]) {
        const sx = (c - startCol) * TILE;
        if (sx < -TILE * 4 || sx > W + TILE * 4) continue;
        this._tree(ctx, sx, Math.round(topOf(c) / TILE) * TILE, t);
      }
    }

    // Ground. Only the top three rows are drawn as sprites: below that every
    // tile is fully enclosed dirt, identical to its neighbours, so the rest of
    // the bank is a flat fill. Drawing all ~14 rows per column cost the entire
    // frame budget at 1600x900 and bought nothing anybody can see.
    const SPRITE_ROWS = 3;
    // Stand-in world for the framing pass, so the bank gets the same lit top
    // and shadowed sides the real terrain has.
    const fake = {
      get: (tx, ty) => {
        const top = rowAt(tx);
        if (top == null || ty < top) return T.AIR;
        return ty === top ? T.GRASS : T.DIRT;
      },
    };
    ctx.fillStyle = DEEP_DIRT;
    for (let i = -1; i < cols; i++) {
      const sx = i * TILE, ty0 = rowAt(i);
      for (let r = 0; r < SPRITE_ROWS; r++) {
        const ty = ty0 + r;
        const id = r === 0 ? T.GRASS : T.DIRT;
        const spr = Sprites.getFramed(id, framingMask(fake, i, ty, id), r === 1 ? T.GRASS : 0);
        if (spr) ctx.drawImage(spr, sx, ty * TILE, TILE, TILE);
      }
      // The undifferentiated mass below this column, as one rect.
      ctx.fillRect(sx, (ty0 + SPRITE_ROWS) * TILE, TILE, H);
    }
    ctx.restore();

    // Night dims the bank. As a gradient rather than a flat rect: a hard-edged
    // overlay drew a visible seam straight across the hillside at midday.
    const shade = ctx.createLinearGradient(0, horizon - H * 0.16, 0, H);
    const dim = 0.66 - day * 0.52;
    shade.addColorStop(0, `rgba(8,11,22,0)`);
    shade.addColorStop(0.35, `rgba(8,11,22,${dim * 0.7})`);
    shade.addColorStop(1, `rgba(8,11,22,${dim})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, horizon - H * 0.16, W, H - horizon + H * 0.16);
  }

  _tree(ctx, sx, groundY, t) {
    for (let i = 0; i < t.h; i++) {
      let mask = 0;
      if (i < t.h - 1) mask |= N;
      if (i > 0) mask |= S;
      const spr = Sprites.getTrunk(T.WOOD, mask, t.variant);
      if (spr) ctx.drawImage(spr, sx, groundY - (i + 1) * TILE, TILE, TILE);
    }
    // A round canopy, framed so the interior leaves self-shadow.
    const topY = groundY - t.h * TILE;
    const cells = [];
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy === -2 || dy === 1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) cells.push([dx, dy]);
    }
    const has = (dx, dy) => cells.some(c => c[0] === dx && c[1] === dy);
    for (const [dx, dy] of cells) {
      let mask = 0;
      if (has(dx, dy - 1)) mask |= N;
      if (has(dx + 1, dy)) mask |= E;
      if (has(dx, dy + 1)) mask |= S;
      if (has(dx - 1, dy)) mask |= WBIT;
      const spr = Sprites.getCanopy(T.LEAVES, mask, (dx + dy + 4) & 3);
      if (spr) ctx.drawImage(spr, sx + dx * TILE, topY + dy * TILE, TILE, TILE);
    }
  }

  _motes(ctx, W, H, day) {
    for (const m of this.motes) {
      const x = ((m.x * W + this.time * m.vx) % (W + 40)) - 20;
      const y = ((m.y * H + this.time * m.vy) % (H + 40)) - 20;
      const sway = Math.sin(this.time * 0.9 + m.ph) * 6;
      ctx.globalAlpha = 0.16 + Math.sin(this.time * 1.4 + m.ph) * 0.1 + day * 0.06;
      ctx.fillStyle = m.leaf ? '#5fae4a' : '#9fd8ff';
      ctx.fillRect(x + sway, y, m.r * (m.leaf ? 2.2 : 1), m.r * (m.leaf ? 1.4 : 1));
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Rotating line under the title
// ---------------------------------------------------------------------------
// Written from inside the world rather than about the game, so the menu has a
// voice before you have pressed anything.
const LINES_OF_LORE = [
  'The caves were here first.',
  'Vesper Thane is still waiting at your spawn.',
  'Every realm is a seed. No two hold the same dark.',
  'Something under the stone remembers being fed.',
  'The blight does not spread. It arrives.',
  'Bring a torch. Bring two.',
  'Wood, then stone, then whatever the deep gives up.',
  'A hammer makes a hill walkable.',
  'The Grovekeeper wakes for anyone holding an effigy.',
  'Nothing down there has ever seen the sky.',
];
const LINE_HOLD = 7.0;   // seconds a line stays up
const LINE_FADE = 0.55;  // matches the CSS transition

class Tagline {
  constructor() {
    this.el = document.getElementById('menuTagline');
    this.i = Math.floor(Math.random() * LINES_OF_LORE.length);
    this.t = 0;
    this.swapped = false;
    if (this.el) this.el.textContent = LINES_OF_LORE[this.i];
  }

  reset() { this.t = 0; this.swapped = false; }

  update(dt) {
    if (!this.el) return;
    this.t += dt;
    if (!this.swapped && this.t >= LINE_HOLD) {
      this.el.classList.add('fading');
      this.swapped = true;
    } else if (this.swapped && this.t >= LINE_HOLD + LINE_FADE) {
      this.i = (this.i + 1) % LINES_OF_LORE.length;
      this.el.textContent = LINES_OF_LORE[this.i];
      this.el.classList.remove('fading');
      this.t = 0;
      this.swapped = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------
// Original 5x7 bitmap lettering, drawn block by block. The repo ships no font
// files and its whole premise is that nothing is imported, so the title is
// built the same way every other piece of art in the game is.
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['....#', '....#', '....#', '....#', '#...#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  "'": ['#....', '#....', '#....', '.....', '.....', '.....', '.....'],
};
const GLYPH_W = 5, GLYPH_H = 7;
// The apostrophe is one pixel wide; giving it a full 5-cell advance leaves a
// hole in the middle of SUMMONER'S.
const ADVANCE = (ch) => (ch === "'" ? 2 : GLYPH_W);

const LINES = ["SUMMONER'S", 'REALMS'];

export class MenuTitle {
  constructor() {
    this.canvas = document.getElementById('menuTitle');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
  }

  draw(time, reduced) {
    const c = this.canvas, ctx = this.ctx;
    if (!c || !ctx) return;
    const cssW = c.clientWidth || 380;
    // Pick the block size that makes the longer line fill the panel width.
    const widest = Math.max(...LINES.map(l => this._lineWidth(l)));
    const px = Math.max(3, Math.floor((cssW - 8) / widest));
    const totalW = widest * px;
    const lineH = (GLYPH_H + 3) * px;
    const totalH = lineH * LINES.length + px * 3;

    if (c.width !== totalW + px * 4 || c.height !== totalH) {
      c.width = totalW + px * 4;
      c.height = totalH;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;

    LINES.forEach((line, li) => {
      const w = this._lineWidth(line) * px;
      let x = Math.round((c.width - w) / 2);
      const baseY = li * lineH + px * 2;
      let gi = 0;
      for (const ch of line) {
        // Each letter bobs a beat behind the one before it, so the title
        // ripples left to right the way a hanging sign settles.
        const bob = reduced ? 0 : Math.sin(time * 1.9 - (gi + li * 4) * 0.42) * px * 0.85;
        this._glyph(ctx, ch, x, Math.round(baseY + bob), px, li);
        x += (ADVANCE(ch) + 1) * px;
        gi++;
      }
    });
  }

  _lineWidth(line) {
    let w = 0;
    for (const ch of line) w += ADVANCE(ch) + 1;
    return w - 1;
  }

  _glyph(ctx, ch, x, y, px, li) {
    const rows = GLYPHS[ch];
    if (!rows) return;
    // Hard drop shadow first, then the lit face over it — the same two-pass
    // treatment the tile sprites use for their edges.
    for (let pass = 0; pass < 2; pass++) {
      const dy = pass === 0 ? px : 0;
      for (let r = 0; r < GLYPH_H; r++) {
        for (let col = 0; col < GLYPH_W; col++) {
          if (rows[r][col] !== '#') continue;
          if (pass === 0) ctx.fillStyle = li === 0 ? '#0a3a30' : '#3a1a5a';
          else {
            // Teal at the top of the letter running to violet at its foot, so
            // the two words share one continuous ramp.
            const t = (li * GLYPH_H + r) / (GLYPH_H * 2 - 1);
            ctx.fillStyle = mixHex('#7ee0c0', '#c58bff', t);
          }
          ctx.fillRect(x + col * px, y + r * px + dy, px, px);
        }
      }
    }
  }
}
