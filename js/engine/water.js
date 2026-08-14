// Summoner Realms — water rendering.
//
// Water used to be drawn one cell at a time as a flat 72%-alpha rectangle with
// a one-pixel highlight on the top row. That is why the oceans read as a solid
// blue wall: a body of water has no *depth*, no light entering it, and no
// surface worth looking at unless the renderer models those three things
// explicitly.
//
// This module draws a body of water as a body:
//
//   1. Columns are scanned into contiguous runs, so a 40-tile-deep ocean is a
//      handful of gradient fills instead of hundreds of rectangles. The colour
//      ramp is keyed to depth *below that column's own free surface*, which is
//      what makes the shallows read as shallow next to a drop-off.
//   2. The free surface is a wavy band drawn across the whole run of columns —
//      a crest, a bright sheen under it, and foam where the wave peaks — rather
//      than a flat line per tile.
//   3. God rays fall from the surface wherever daylight can actually reach it,
//      slanted by the sun's position, drifting slowly, and clipped to the water
//      body so they never leak onto the sky or the seabed.
//   4. Caustics ripple across the seafloor and along the underside of the
//      surface.
//   5. Suspended motes drift and bubbles rise, both from a cheap hash so
//      nothing is allocated per frame.
//
// Everything is deterministic from (tile, index, time): no per-particle state,
// no allocation in the draw path, and identical output on every client.
import { TILE, LIQUID_MAX, UNDERGROUND_Y } from '../config.js?v=tides-1';
import { celestialLean } from './sky.js?v=tides-1';

// Depth ramps, in tiles below the free surface, per water flavour. Inland pools
// borrow the ocean ramp but never get deep enough to reach its floor colour.
const PALETTES = {
  ocean: {
    shallow: [122, 214, 236], mid: [34, 108, 172], deep: [8, 34, 68],
    ray: [214, 246, 255], foam: [226, 248, 255], caustic: [168, 230, 255],
  },
  infestedOcean: {
    shallow: [186, 128, 224], mid: [92, 46, 134], deep: [24, 10, 42],
    ray: [232, 206, 255], foam: [236, 214, 255], caustic: [206, 156, 255],
  },
  whirringOcean: {
    shallow: [206, 146, 106], mid: [110, 62, 62], deep: [30, 16, 24],
    ray: [255, 216, 178], foam: [246, 220, 196], caustic: [255, 176, 128],
  },
};

// How deep, in tiles, the ramp takes to reach the "deep" colour.
const MID_DEPTH = 7;
const DEEP_DEPTH = 26;

// Above this the water is treated as open sea for lighting purposes; below it
// no god ray is cast no matter what sits overhead.
const RAY_MAX_DEPTH = 34;

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}

// Cheap deterministic hash -> 0..1. Used for mote/bubble placement so the same
// column always carries the same specks without storing any of them.
function hash01(a, b) {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177 | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// The free surface of a column: the topmost water row of the run containing ty.
// Walks up from the visible top so a surface just off-screen still shades the
// visible part correctly.
function surfaceRowOf(liq, tx, ty, limit = 120) {
  let y = ty;
  for (let i = 0; i < limit; i++) {
    if (liq.get(tx, y - 1) <= 0) break;
    y--;
  }
  return y;
}

/**
 * The water flavour at a column, from the surface biome band. Inland pools use
 * the plain ocean palette; the two evil oceans have their own.
 */
function paletteAt(world, tx) {
  const key = world.surfaceBiomeAt ? world.surfaceBiomeAt(tx) : 'ocean';
  return PALETTES[key] || PALETTES.ocean;
}

export class WaterRenderer {
  constructor() {
    // Per-frame scratch, reused so the draw path allocates nothing.
    this._runs = [];
    this._runCount = 0;
  }

  _pushRun(tx, top, bottom, topFill, openTop) {
    const runs = this._runs;
    let r = runs[this._runCount];
    if (!r) { r = { tx: 0, top: 0, bottom: 0, topFill: 1, openTop: false }; runs[this._runCount] = r; }
    r.tx = tx; r.top = top; r.bottom = bottom; r.topFill = topFill; r.openTop = openTop;
    this._runCount++;
  }

  // Collect every contiguous vertical run of water in the visible tile range.
  _scan(game, tx0, ty0, tx1, ty1) {
    const liq = game.world.liquid;
    this._runCount = 0;
    for (let tx = tx0; tx <= tx1; tx++) {
      let ty = ty0;
      while (ty <= ty1) {
        if (liq.get(tx, ty) <= 0) { ty++; continue; }
        const start = ty;
        while (ty <= ty1 && liq.get(tx, ty) > 0) ty++;
        const end = ty - 1;
        // A run whose top cell is full and has water above it is a slice of a
        // deeper body: its real surface is somewhere off-screen.
        const openTop = liq.get(tx, start - 1) <= 0;
        const topFill = openTop ? liq.get(tx, start) / LIQUID_MAX : 1;
        this._pushRun(tx, start, end, topFill, openTop);
      }
    }
    return this._runCount;
  }

  /**
   * Main water pass. Draws under every moving entity, over the terrain.
   */
  draw(game, ctx, tx0, ty0, tx1, ty1) {
    const world = game.world;
    const liq = world.liquid;
    if (!liq) return;
    const n = this._scan(game, tx0, ty0, tx1, ty1);
    if (!n) return;

    const t = game.time ? game.time.t : 0;
    const bright = game.time ? game.time.brightness : 1;
    // Daylight is what makes a sea legible. At night the body keeps its shape
    // but loses its rays, its sheen and most of its saturation.
    const day = Math.max(0, Math.min(1, (bright - 0.42) / 0.5));

    ctx.save();
    this._drawBodies(game, ctx, t, day);
    this._drawSurface(game, ctx, t, day);
    // Rays, caustics and motes are all *inside* the water, so they share one
    // clip built from the run rectangles.
    ctx.save();
    this._clipToWater(ctx);
    this._drawGodRays(game, ctx, t, day);
    this._drawCaustics(game, ctx, t, day);
    this._drawMotes(game, ctx, t, day);
    ctx.restore();
    this._drawShoreFoam(game, ctx, t, day);
    ctx.restore();
  }

  _clipToWater(ctx) {
    ctx.beginPath();
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      const x = r.tx * TILE;
      const top = r.top * TILE + (r.openTop ? TILE * (1 - r.topFill) : 0);
      ctx.rect(x, top, TILE, (r.bottom + 1) * TILE - top);
    }
    ctx.clip();
  }

  // The body itself: one vertical gradient per run, ramped by true depth under
  // that column's free surface.
  _drawBodies(game, ctx, t, day) {
    const world = game.world;
    const liq = world.liquid;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      const pal = paletteAt(world, r.tx);
      const surfRow = r.openTop ? r.top : surfaceRowOf(liq, r.tx, r.top);
      const x = r.tx * TILE;
      const top = r.top * TILE + (r.openTop ? TILE * (1 - r.topFill) : 0);
      const bottom = (r.bottom + 1) * TILE;

      const cTop = this._depthColor(pal, r.top - surfRow, day);
      const cBot = this._depthColor(pal, r.bottom + 1 - surfRow, day);
      // A one-tile puddle does not need a gradient object.
      if (bottom - top <= TILE * 1.2) {
        ctx.fillStyle = rgba(cTop, 0.78);
      } else {
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        g.addColorStop(0, rgba(cTop, 0.74));
        g.addColorStop(1, rgba(cBot, 0.88));
        ctx.fillStyle = g;
      }
      ctx.fillRect(x, top, TILE, bottom - top);
    }
  }

  _depthColor(pal, depthTiles, day) {
    const d = Math.max(0, depthTiles);
    let c;
    if (d <= MID_DEPTH) c = mix(pal.shallow, pal.mid, d / MID_DEPTH);
    else c = mix(pal.mid, pal.deep, Math.min(1, (d - MID_DEPTH) / (DEEP_DEPTH - MID_DEPTH)));
    // Night drains the water toward its own deep colour rather than toward
    // black, so the sea still reads as water under moonlight.
    const nightMix = 0.62 * (1 - day);
    return mix(c, pal.deep, nightMix);
  }

  // The free surface, drawn across each unbroken span of open-topped columns as
  // one wavy band. Two out-of-phase travelling waves plus a slow swell, so it
  // never reads as a single scrolling sawtooth.
  _drawSurface(game, ctx, t, day) {
    const world = game.world;
    const pal0 = PALETTES.ocean;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      if (!r.openTop) continue;
      const pal = paletteAt(world, r.tx) || pal0;
      const x = r.tx * TILE;
      const base = r.top * TILE + TILE * (1 - r.topFill);
      const wave = this._waveAt(r.tx, t);
      const y = base + wave;

      // Sheen: a soft band of brighter water hanging under the surface, which
      // is what sells "light is entering here".
      const sheenH = 9;
      const g = ctx.createLinearGradient(0, y, 0, y + sheenH);
      g.addColorStop(0, rgba(pal.shallow, 0.34 + 0.26 * day));
      g.addColorStop(1, rgba(pal.shallow, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, TILE, sheenH);

      // Crest: the bright line the eye reads as "the top of the water".
      ctx.fillStyle = rgba(pal.foam, 0.52 + 0.34 * day);
      ctx.fillRect(x, y - 1, TILE, 1.5);
      // A darker lip immediately under the crest gives the surface thickness.
      ctx.fillStyle = rgba(pal.deep, 0.28);
      ctx.fillRect(x, y + 0.6, TILE, 1);

      // Specular: a travelling gleam that leans with the sun/moon so the
      // new lighting actually reads on the water, not just in the sky.
      const phase = game.time ? game.time.phase : 0.25;
      const shine = game.time
        ? Math.max(0, game.time.sunAltitude, game.time.moonAltitude * 0.55)
        : 0.6;
      if (shine > 0.08) {
        const gleam = Math.sin(r.tx * 0.22 - (phase - 0.25) * Math.PI * 8 + t * 0.35);
        if (gleam > 0.45) {
          const a = (gleam - 0.45) / 0.55;
          ctx.fillStyle = rgba([255, 252, 240], (0.22 + 0.38 * day) * a * shine);
          ctx.fillRect(x + 2, y - 2, 7, 1.6);
          ctx.fillStyle = rgba(pal.foam, 0.18 * a * shine);
          ctx.fillRect(x + 1, y - 1, 10, 1);
        }
      }

      // Foam speckles ride the crests of the travelling wave only, so foam
      // appears and dissolves as the swell passes instead of sitting still.
      const crest = this._waveCrest(r.tx, t);
      if (crest > 0.62) {
        const a = (crest - 0.62) / 0.38;
        ctx.fillStyle = rgba(pal.foam, 0.42 * a * (0.45 + 0.55 * day));
        const fx = x + hash01(r.tx, 7) * (TILE - 3);
        ctx.fillRect(fx, y - 2.2, 2, 1.4);
        ctx.fillRect(fx + 3.5, y - 1.2, 1.4, 1.2);
      }
    }
    ctx.restore();
  }

  // Surface displacement in pixels for a column.
  _waveAt(tx, t) {
    return Math.sin(t * 1.55 + tx * 0.42) * 1.35
      + Math.sin(t * 0.83 + tx * 0.17) * 0.95
      + Math.sin(t * 0.31 + tx * 0.06) * 0.7;
  }

  // 0..1 crest strength, used to place foam only on the tops of waves.
  _waveCrest(tx, t) {
    const s = Math.sin(t * 1.55 + tx * 0.42) * 0.6 + Math.sin(t * 0.83 + tx * 0.17) * 0.4;
    return (s + 1) * 0.5;
  }

  // Shafts of daylight falling into the water. They are cast from columns whose
  // surface is genuinely open to the sky — a flooded cave gets no god rays,
  // which is exactly the distinction that makes them mean something.
  //
  // Shafts are placed on a fixed world-space lattice rather than per column.
  // Emitting from every column produced evenly spaced vertical bars — light
  // has to arrive from somewhere, and "everywhere at once, straight down" reads
  // as striping, not as sun.
  _drawGodRays(game, ctx, t, day) {
    if (day <= 0.02) return;
    const world = game.world;
    const liq = world.liquid;
    // Shared with air shafts so the sea and the sky agree on the sun.
    const lean = celestialLean(game);

    // Visible span, from the runs we already scanned.
    let minTx = Infinity, maxTx = -Infinity;
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      if (r.tx < minTx) minTx = r.tx;
      if (r.tx > maxTx) maxTx = r.tx;
    }
    if (!Number.isFinite(minTx)) return;

    const SPACING = 9; // tiles between shaft slots
    const s0 = Math.floor(minTx / SPACING) - 1;
    const s1 = Math.ceil(maxTx / SPACING) + 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let s = s0; s <= s1; s++) {
      const seed = hash01(s, 17);
      const seed2 = hash01(s, 43);
      // Each shaft drifts along its own slow cycle, so the light moves with the
      // swell instead of hanging in fixed slots.
      const drift = Math.sin(t * (0.10 + seed * 0.09) + seed * 6.28) * TILE * 3.4;
      const worldX = s * SPACING * TILE + seed2 * SPACING * TILE * 0.7 + drift;
      const tx = Math.floor(worldX / TILE);

      // The shaft only exists if there is open water below open sky here.
      const top = this._surfaceRowAt(world, liq, tx);
      if (top == null) continue;
      if (top > UNDERGROUND_Y) continue;
      if (world.isSolidAt(tx, top - 1) || world.hasWallAt(tx, top - 1)) continue;

      const pal = paletteAt(world, tx);
      const fill = liq.get(tx, top) / LIQUID_MAX;
      const surfaceY = top * TILE + TILE * (1 - fill) + this._waveAt(tx, t);
      // How far down the water actually goes here, so a shaft never overshoots
      // into the seabed.
      let depthTiles = 0;
      while (depthTiles < RAY_MAX_DEPTH && liq.get(tx, top + depthTiles + 1) > 0) depthTiles++;
      if (depthTiles < 3) continue;

      const len = depthTiles * TILE * (0.78 + seed * 0.28);
      const topW = TILE * (0.9 + seed * 0.8);
      const botW = topW * (2.6 + seed2 * 2.0);
      const dx = lean * len;
      // Pulse so the shafts breathe rather than sitting frozen.
      const pulse = 0.55 + 0.45 * Math.sin(t * (0.5 + seed * 0.6) + seed * 9.4);
      const alpha = 0.115 * day * (0.4 + 0.6 * pulse);

      const g = ctx.createLinearGradient(worldX, surfaceY, worldX + dx, surfaceY + len);
      g.addColorStop(0, rgba(pal.ray, alpha * 1.35));
      g.addColorStop(0.35, rgba(pal.ray, alpha * 0.8));
      g.addColorStop(1, rgba(pal.ray, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(worldX - topW / 2, surfaceY);
      ctx.lineTo(worldX + topW / 2, surfaceY);
      ctx.lineTo(worldX + dx + botW / 2, surfaceY + len);
      ctx.lineTo(worldX + dx - botW / 2, surfaceY + len);
      ctx.closePath();
      ctx.fill();

      // A brighter, narrower core inside each shaft: real crepuscular rays are
      // not one flat wedge.
      const cg = ctx.createLinearGradient(worldX, surfaceY, worldX + dx * 0.8, surfaceY + len * 0.8);
      cg.addColorStop(0, rgba(pal.ray, alpha * 1.1));
      cg.addColorStop(1, rgba(pal.ray, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(worldX - topW * 0.22, surfaceY);
      ctx.lineTo(worldX + topW * 0.22, surfaceY);
      ctx.lineTo(worldX + dx * 0.8 + botW * 0.24, surfaceY + len * 0.8);
      ctx.lineTo(worldX + dx * 0.8 - botW * 0.24, surfaceY + len * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Topmost water row of the body in a column, searching down from the terrain
  // surface. Returns null if the column holds no water near the surface.
  _surfaceRowAt(world, liq, tx) {
    if (tx < 0 || tx >= world.width) return null;
    const s = world.surfaceY(tx);
    for (let y = Math.max(1, s - 26); y <= s + 4; y++) {
      if (liq.get(tx, y) > 0) return y;
    }
    return null;
  }

  // Caustics: the moving net of focused light that a wavy surface throws onto
  // whatever is under it. Drawn on the seabed and, fainter, under the surface.
  _drawCaustics(game, ctx, t, day) {
    if (day <= 0.04) return;
    const world = game.world;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      const pal = paletteAt(world, r.tx);
      const x = r.tx * TILE;
      const depthTiles = r.bottom - r.top;
      // Light does not reach the floor of a deep trench.
      const reach = Math.max(0, 1 - depthTiles / 30);
      if (reach <= 0.02) continue;
      const floorY = (r.bottom + 1) * TILE;

      for (let k = 0; k < 2; k++) {
        const p = t * (0.9 + k * 0.45) + r.tx * (0.5 + k * 0.23);
        const s = Math.sin(p) * Math.sin(p * 0.47 + 1.3);
        if (s <= 0.25) continue;
        const a = (s - 0.25) / 0.75 * 0.16 * day * reach;
        ctx.fillStyle = rgba(pal.caustic, a);
        const yOff = 2 + k * 3 + Math.sin(p * 1.7) * 1.5;
        ctx.fillRect(x, floorY - yOff, TILE, 1.6);
      }
    }
    ctx.restore();
  }

  // Suspended motes drifting in the current, and bubbles rising to the surface.
  // Both are positioned by hash, so they cost nothing to keep alive.
  _drawMotes(game, ctx, t, day) {
    const world = game.world;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      const depthTiles = r.bottom - r.top;
      if (depthTiles < 2) continue;
      const pal = paletteAt(world, r.tx);
      const x = r.tx * TILE;
      const top = r.top * TILE;
      const height = (depthTiles + 1) * TILE;

      // Two motes per column, drifting sideways and sinking very slowly.
      for (let k = 0; k < 2; k++) {
        const sx = hash01(r.tx, k * 17 + 1);
        const sy = hash01(r.tx, k * 17 + 2);
        const mx = x + sx * TILE + Math.sin(t * (0.3 + sx * 0.4) + sy * 6.3) * 3.5;
        const my = top + ((sy * height + t * (5 + sx * 6)) % height);
        ctx.fillStyle = rgba(pal.caustic, 0.10 + 0.14 * day);
        ctx.fillRect(mx, my, 1.2, 1.2);
      }

      // One rising bubble per few columns, so the sea has vertical motion.
      if (hash01(r.tx, 91) < 0.34) {
        const sb = hash01(r.tx, 92);
        const speed = 16 + sb * 22;
        const bx = x + sb * TILE + Math.sin(t * 2.1 + sb * 6.3) * 2.2;
        const by = (r.bottom + 1) * TILE - ((t * speed + sb * height) % height);
        ctx.fillStyle = rgba(pal.foam, 0.30);
        ctx.beginPath();
        ctx.arc(bx, by, 0.9 + sb * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // Foam where the sea meets land: the run's top cell has a solid neighbour at
  // the same height. Drawn outside the clip so it can spill onto the sand.
  _drawShoreFoam(game, ctx, t, day) {
    const world = game.world;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < this._runCount; i++) {
      const r = this._runs[i];
      if (!r.openTop) continue;
      const leftSolid = world.isSolidAt(r.tx - 1, r.top);
      const rightSolid = world.isSolidAt(r.tx + 1, r.top);
      if (!leftSolid && !rightSolid) continue;
      const pal = paletteAt(world, r.tx);
      const y = r.top * TILE + TILE * (1 - r.topFill) + this._waveAt(r.tx, t);
      // The surge runs up the beach and back on the swell.
      const surge = (this._waveCrest(r.tx, t * 0.6) - 0.5) * 5;
      const x = r.tx * TILE + (leftSolid ? -3 + surge : TILE - 2 - surge);
      ctx.fillStyle = rgba(pal.foam, 0.34 + 0.22 * day);
      ctx.fillRect(x, y - 1.5, 5, 2.4);
      ctx.fillStyle = rgba(pal.foam, 0.18);
      ctx.fillRect(x - 1, y + 1, 7, 1.4);
    }
    ctx.restore();
  }

  /**
   * Screen-space pass for a submerged camera: colour cast, depth vignette and a
   * slow caustic shimmer. Runs after the lighting overlay, because being
   * underwater changes what you see, not how bright the world is.
   */
  drawSubmergedOverlay(game, ctx, W, H) {
    const p = game.localPlayer;
    if (!p || !p.submerged) return;
    const world = game.world;
    const liq = world.liquid;
    if (!liq) return;
    const tx = Math.floor((p.x + p.w / 2) / TILE);
    const ty = Math.floor((p.y + p.h / 2) / TILE);
    const pal = paletteAt(world, tx);
    const surfRow = surfaceRowOf(liq, tx, ty);
    const depth = Math.max(0, ty - surfRow);
    const t = game.time ? game.time.t : 0;
    const day = game.time ? Math.max(0, Math.min(1, (game.time.brightness - 0.42) / 0.5)) : 1;
    // The cast deepens with depth: near the surface it is a tint, twenty tiles
    // down it is most of what you can see.
    const k = Math.min(1, depth / 22);
    const cast = mix(pal.mid, pal.deep, k);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(cast, 0.16 + 0.30 * k);
    ctx.fillRect(0, 0, W, H);

    // Vignette, tighter the deeper you go.
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.30 - 0.12 * k), W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, rgba(pal.deep, 0));
    g.addColorStop(1, rgba(pal.deep, 0.34 + 0.28 * k));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Surface shimmer: a few soft bands of light sweeping the top of the view,
    // strongest just under the surface and gone in the deep.
    const shimmer = (1 - k) * day;
    if (shimmer > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const a = 0.05 * shimmer * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.9));
        const y = (H * 0.10 + i * H * 0.13 + Math.sin(t * 0.6 + i) * 18);
        const lg = ctx.createLinearGradient(0, y - 26, 0, y + 26);
        lg.addColorStop(0, rgba(pal.ray, 0));
        lg.addColorStop(0.5, rgba(pal.ray, a));
        lg.addColorStop(1, rgba(pal.ray, 0));
        ctx.fillStyle = lg;
        ctx.fillRect(0, y - 26, W, 52);
      }
    }
    ctx.restore();
  }
}
