// Summoner Realms — illumination.
//
// The first atmosphere pass treated lighting as a dark fog plus a glow blob
// glued to the player. That is why daytime looked like a flashlight was
// taped to the summoner. This module is a cheap stand-in for a shader pack:
//
//   1. A per-tile illumination *colour* (not just "how black").
//   2. Drawn with multiply, so white = unchanged and colour = light.
//   3. Sky light is cool or warm from the time of day.
//   4. Block light (torches, held Emberlight, explosions) is warm and
//      only exists where those things actually are.
//   5. A little ambient occlusion in corners and under solids.
//
// The player is not a light source. Holding a torch is.
import { TILE } from '../config.js?v=tides-1';
import { clamp } from '../utils.js?v=tides-1';
import { tileLight, tileDef, isSolid, isLeaf } from '../world/tiles.js?v=tides-1';
import { item as getItem } from '../data/items.js?v=tides-1';

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function heldItem(player) {
  if (!player) return null;
  if (player.inventory && player.inventory.selectedItem) return player.inventory.selectedItem();
  if (player.selectedId) return getItem(player.selectedId);
  return null;
}

/** 0 if the player is not holding a light-emitting item. */
export function heldLightLevel(player) {
  const it = heldItem(player);
  if (!it || it.place == null) return 0;
  const L = tileLight(it.place);
  return L >= 0.35 ? L : 0;
}

function heldLightColor(player) {
  const it = heldItem(player);
  if (!it) return [255, 196, 120];
  const def = it.place != null ? tileDef(it.place) : null;
  const hex = (def && def.color) || it.color || '#ffc878';
  if (hex[0] !== '#' || hex.length < 7) return [255, 196, 120];
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/**
 * Extra flood-fill seeds and the visual glow list. The player only appears
 * here when they are actually holding a light.
 */
export function collectLightSources(game, tx0, ty0, tx1, ty1) {
  const extra = [];
  const glows = [];
  const warmSeeds = [];

  const addWarm = (wx, wy, level, rgb, radius, alpha) => {
    extra.push({ tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE), level });
    warmSeeds.push({ tx: Math.floor(wx / TILE), ty: Math.floor(wy / TILE), level });
    glows.push({ x: wx, y: wy, level, rgb, radius, alpha });
  };

  for (const pl of game.players.values()) {
    if (!pl.alive) continue;
    const held = heldLightLevel(pl);
    if (held > 0) {
      const rgb = heldLightColor(pl);
      addWarm(pl.x + pl.w / 2, pl.y + pl.h * 0.55, held, rgb, 34 + held * 22, 0.22);
    }
  }

  if (game.thrown) {
    for (const t of game.thrown) {
      if (!t.light) continue;
      addWarm(t.x, t.y, t.light, [255, 190, 90], 40, 0.24);
    }
  }
  if (game.critters) {
    for (const c of game.critters) {
      if (!c.def || !c.def.light) continue;
      extra.push({
        tx: Math.floor((c.x + c.w / 2) / TILE),
        ty: Math.floor((c.y + c.h / 2) / TILE),
        level: c.def.light,
      });
      glows.push({
        x: c.x + c.w / 2, y: c.y + c.h / 2, level: c.def.light,
        rgb: hexRgb(c.color2 || c.color || '#ffb347'), radius: 22, alpha: 0.18,
      });
    }
  }
  if (game.flashes) {
    for (const f of game.flashes) {
      const L = f.level * (f.life / f.max);
      addWarm(f.x, f.y, L, [255, 236, 190], 58, 0.3);
    }
  }

  const world = game.world;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const lit = tileLight(world.get(tx, ty));
      if (lit < 0.2) continue;
      const def = tileDef(world.get(tx, ty));
      warmSeeds.push({ tx, ty, level: lit });
      glows.push({
        x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, level: lit,
        rgb: hexRgb(def.color || '#ffc878'),
        radius: 18 + lit * 26, alpha: 0.2,
      });
    }
  }

  if (game.ambiance) {
    const more = game.ambiance.extraLights();
    if (more) for (const L of more) extra.push(L);
    const fly = game.ambiance.glowSources();
    for (const g of fly) glows.push(g);
  }

  return { extra, glows, warmSeeds };
}

function hexRgb(h) {
  if (!h || h[0] !== '#' || h.length < 7) return [255, 190, 110];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function aoAt(world, tx, ty) {
  let solids = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (isSolid(world.get(tx + dx, ty + dy))) solids++;
    }
  }
  const above = world.get(tx, ty - 1);
  const under = isSolid(above) || isLeaf(above);
  return clamp(1 - solids * 0.045 - (under ? 0.12 : 0), 0.55, 1);
}

function floodWarm(cols, rows, tx0, ty0, seeds) {
  const n = cols * rows;
  const buf = new Float32Array(n);
  if (!seeds || !seeds.length) return buf;
  for (const s of seeds) {
    const ii = s.tx - tx0, j = s.ty - ty0;
    if (ii < 0 || ii >= cols || j < 0 || j >= rows) continue;
    const k = j * cols + ii;
    if (s.level > buf[k]) buf[k] = s.level;
  }
  for (let p = 0; p < 4; p++) {
    const fwd = p % 2 === 0;
    for (let s = 0; s < n; s++) {
      const k = fwd ? s : (n - 1 - s);
      const j = (k / cols) | 0, ii = k - j * cols;
      const att = 0.16;
      let l = buf[k];
      if (ii > 0) l = Math.max(l, buf[k - 1] - att);
      if (ii < cols - 1) l = Math.max(l, buf[k + 1] - att);
      if (j > 0) l = Math.max(l, buf[k - cols] - att);
      if (j < rows - 1) l = Math.max(l, buf[k + cols] - att);
      buf[k] = l;
    }
  }
  return buf;
}

function skyLitColor(sky) {
  const night = sky ? sky.nightAmount : 0;
  const dusk = sky ? sky.dusk : 0;
  const day = mix([255, 250, 240], [255, 214, 176], dusk * (1 - night));
  const moon = [186, 206, 236];
  return mix(day, moon, night);
}

function shadowColor(sky) {
  const night = sky ? sky.nightAmount : 0;
  return mix([28, 26, 32], [10, 14, 32], night);
}

/**
 * Paint the multiply illumination map and any true light glows.
 */
export function drawIllumination(renderer, game, lightBuf, sources, tx0, ty0, cols, rows, W2, H, camX, camY) {
  const world = game.world;
  const sky = renderer._celestial && renderer._celestial.sky;
  const warm = floodWarm(cols, rows, tx0, ty0, sources.warmSeeds);
  const litCol = skyLitColor(sky);
  const shCol = shadowColor(sky);
  const torchCol = [255, 188, 108];

  if (renderer.lightCanvas.width !== cols || renderer.lightCanvas.height !== rows) {
    renderer.lightCanvas.width = cols;
    renderer.lightCanvas.height = rows;
  }
  const img = renderer.lightCtx.createImageData(cols, rows);
  const data = img.data;
  for (let i = 0; i < lightBuf.length; i++) {
    const j = (i / cols) | 0, ii = i - j * cols;
    const tx = tx0 + ii, ty = ty0 + j;
    const L = Math.pow(clamp(lightBuf[i], 0, 1), 0.82);
    const w = clamp(warm[i], 0, 1);
    const ao = aoAt(world, tx, ty);
    let c = mix(shCol, litCol, L);
    if (w > 0.02) c = mix(c, torchCol, w * 0.78);
    c[0] *= ao; c[1] *= ao; c[2] *= ao;
    const o = i * 4;
    data[o] = c[0] | 0;
    data[o + 1] = c[1] | 0;
    data[o + 2] = c[2] | 0;
    data[o + 3] = 255;
  }
  renderer.lightCtx.putImageData(img, 0, 0);

  const ctx = renderer.ctx;
  const cam = renderer.camera;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'multiply';
  const sx = (tx0 * TILE - camX) * cam.scale + W2 / 2;
  const sy = (ty0 * TILE - camY) * cam.scale + H / 2;
  ctx.drawImage(renderer.lightCanvas, sx, sy, cols * TILE * cam.scale, rows * TILE * cam.scale);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;
}

