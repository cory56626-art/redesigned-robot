// Summoner Realms — in-world sky and night lighting.
//
// The sky is infinitely far away. Sun, moon and clouds live in *screen space*
// and never read the camera's Y, so jumping does not bounce the heavens.
// Horizontal parallax is reserved for stars and a whisper of cloud drift.
//
// Night lighting is built to match the reference still: a large crescent moon,
// bleached canopy crowns, long ground shadows, and a warm torch puddle.
// Spawn tables still key off DayNight.isDay; this file is visual only.
import { TILE, MOON_LEVEL } from '../config.js?v=tides-1';
import { clamp } from '../utils.js?v=tides-1';
import { isLeaf, isSolid, isTree } from '../world/tiles.js?v=tides-1';

const TAU = Math.PI * 2;

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

export function celestialLean(game) {
  const phase = game.time ? game.time.phase : 0.25;
  const swing = Math.sin((phase - 0.25) * Math.PI * 2);
  return 0.30 * Math.sign(swing || 1) + swing * 0.42;
}

/**
 * Screen-space sky snapshot. Positions do not depend on camera Y or the
 * terrain horizon — those were what made the sun leap when the player jumped.
 */
export function celestialState(game, screenW, screenH) {
  const time = game.time;
  const phase = time ? time.phase : 0.25;
  const brightness = time ? time.brightness : 1;
  const nightAmount = time ? time.nightAmount : 0;
  const sunAlt = time ? time.sunAltitude : 1;
  const moonAlt = time ? time.moonAltitude : -1;
  const lean = celestialLean(game);

  // Tall ellipse: zenith near the top, rise/set at the *bottom* of the
  // screen, then the body continues below and out of view. That is what
  // stops the moon popping in on the opposite side while the sun is
  // still up — at twilight the other body is still under the horizon.
  const place = (angleOffset) => {
    const ang = (phase - 0.25) * TAU + angleOffset;
    const cx = screenW * 0.5;
    const cy = screenH * 0.90;
    const rx = screenW * 0.46;
    const ry = screenH * 0.78;
    const x = cx + Math.sin(ang) * rx;
    const y = cy - Math.cos(ang) * ry;
    const altitude = Math.cos(ang);
    const fade = clamp((cy - 8 - y) / (screenH * 0.22), 0, 1);
    return { x, y, up: y < screenH + 48, altitude, fade };
  };

  const sunP = place(0);
  const moonP = place(Math.PI);

  const dusk = clamp(1 - Math.min(Math.abs(sunAlt), Math.abs(moonAlt)) / 0.42, 0, 1);
  const sunWarm = clamp(1 - Math.max(0, sunAlt), 0, 1);
  const sunCore = mix([255, 246, 208], [255, 157, 74], sunWarm * 0.85);
  const moonCore = [214, 232, 255];

  let ambientDark;
  if (nightAmount > 0.55) {
    ambientDark = mix([28, 16, 36], [6, 12, 42], clamp((nightAmount - 0.55) / 0.45, 0, 1));
  } else if (nightAmount > 0.15) {
    ambientDark = mix([12, 14, 22], mix([48, 20, 24], [28, 16, 36], dusk), clamp((nightAmount - 0.15) / 0.4, 0, 1));
  } else {
    ambientDark = [12, 14, 22];
  }

  const moonLevel = MOON_LEVEL * clamp(moonAlt, 0, 1);

  return {
    phase, brightness, nightAmount, lean, dusk,
    sun: { ...sunP, color: sunCore, glow: 0.55 + sunWarm * 0.25 },
    moon: { ...moonP, color: moonCore, glow: 0.85 + nightAmount * 0.15 },
    ambientDark,
    moonLevel,
    sunWarmth: sunWarm,
    screenW, screenH,
  };
}

export function skyVisible(depthT) {
  return clamp(1 - depthT, 0, 1);
}

export function drawSkyDecor(game, ctx, W, H, camX, depthT, sky) {
  const vis = skyVisible(depthT);
  if (vis <= 0.02) return;
  const atmosphere = !(game.settings && game.settings.atmosphere === false);

  drawStars(game, ctx, W, H, camX, sky, vis);
  if (sky.moon.up && sky.moon.fade > 0.02) drawMoon(ctx, sky.moon, H, vis * sky.moon.fade, sky);
  if (sky.sun.up && sky.sun.fade > 0.02) drawSun(ctx, sky.sun, H, vis * sky.sun.fade, sky);
  drawHorizonBloom(ctx, W, H, sky, vis);
  drawClouds(game, ctx, W, H, camX, sky, vis);
  if (atmosphere) drawFarRays(game, ctx, W, H, depthT, sky, vis);
}

function drawStars(game, ctx, W, H, camX, sky, vis) {
  const night = sky.nightAmount;
  if (night <= 0.04) return;
  const alpha = night * vis;
  const t = game.time ? game.time.t : 0;
  ctx.save();
  for (let i = 0; i < 110; i++) {
    const sx = ((i * 137.5 - camX * 0.12) % W + W) % W;
    const sy = (i * 89.3) % (H * 0.55);
    const tw = 0.45 + 0.55 * Math.sin(t * (0.7 + (i % 7) * 0.13) + i * 1.7);
    const size = (i % 11 === 0) ? 2 : 1;
    ctx.globalAlpha = alpha * (0.3 + tw * 0.7) * (0.55 + (i % 5) * 0.09);
    ctx.fillStyle = (i % 13 === 0) ? '#cfe4ff' : (i % 17 === 0) ? '#ffe9c8' : '#ffffff';
    ctx.fillRect(sx, sy, size, size);
    if (size > 1 && tw > 0.78) {
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(sx - 1, sy, 4, 1);
      ctx.fillRect(sx, sy - 1, 1, 4);
    }
  }
  ctx.restore();
}

function drawSun(ctx, sun, H, vis, sky) {
  const r = Math.max(8, H * 0.032);
  const core = sun.color;
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, r * 8);
  halo.addColorStop(0, rgba(core, 0.58 * sun.glow));
  halo.addColorStop(0.28, rgba(mix(core, [255, 122, 58], 0.45), 0.2));
  halo.addColorStop(1, 'rgba(255,140,70,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(sun.x, sun.y, r * 8, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  disc(ctx, sun.x, sun.y, r, rgba(core, 1));
  disc(ctx, sun.x, sun.y, r * 0.62, '#fffdf0');
  if (sky.dusk > 0.35 && sun.altitude < 0.35) {
    ctx.globalAlpha = vis * sky.dusk * 0.45;
    ctx.strokeStyle = 'rgba(190, 214, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sun.x, sun.y, r * 1.05, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

let _moonBuf = null;

function drawMoon(ctx, moon, H, vis, sky) {
  const r = Math.max(10, H * 0.055);
  ctx.save();
  ctx.globalAlpha = vis;

  // Wide cool atmosphere — this is most of the "there is a moon" read.
  ctx.globalCompositeOperation = 'lighter';
  const atmo = ctx.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, r * 11);
  atmo.addColorStop(0, rgba([186, 214, 255], 0.38 * moon.glow));
  atmo.addColorStop(0.22, rgba([120, 168, 255], 0.16));
  atmo.addColorStop(0.55, rgba([70, 110, 200], 0.05));
  atmo.addColorStop(1, 'rgba(50,80,160,0)');
  ctx.fillStyle = atmo;
  ctx.beginPath(); ctx.arc(moon.x, moon.y, r * 11, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Unlit body, so the crescent sits on a visible sphere like the reference.
  ctx.globalAlpha = vis * 0.55;
  disc(ctx, moon.x, moon.y, r, '#1b2a44');
  ctx.globalAlpha = vis;

  const s = Math.ceil(r * 2 + 6);
  if (!_moonBuf || _moonBuf.width !== s) {
    _moonBuf = document.createElement('canvas');
    _moonBuf.width = s;
    _moonBuf.height = s;
  }
  const mg = _moonBuf.getContext('2d');
  mg.clearRect(0, 0, s, s);
  mg.fillStyle = '#e8f3ff';
  mg.beginPath(); mg.arc(s / 2, s / 2, r, 0, TAU); mg.fill();
  mg.fillStyle = '#c5dcf5';
  mg.beginPath(); mg.arc(s / 2 - r * 0.18, s / 2 - r * 0.06, r * 0.28, 0, TAU); mg.fill();
  mg.globalCompositeOperation = 'destination-out';
  mg.fillStyle = '#000';
  mg.beginPath();
  mg.arc(s / 2 - r * 0.50, s / 2 - r * 0.08, r * 0.94, 0, TAU);
  mg.fill();
  mg.globalCompositeOperation = 'source-over';
  ctx.drawImage(_moonBuf, moon.x - s / 2, moon.y - s / 2);

  if (sky.dusk > 0.4 && sky.sun.up) {
    ctx.globalAlpha = vis * sky.dusk * 0.45;
    ctx.strokeStyle = 'rgba(255, 196, 140, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(moon.x, moon.y, r * 1.04, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

function disc(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

function drawHorizonBloom(ctx, W, H, sky, vis) {
  // Fixed screen band — not the world horizon — so dusk glow does not jump.
  const bandY = H * 0.38;
  const low = sky.sun.up && sky.sun.altitude < 0.42;
  const moonLow = sky.moon.up && sky.moon.altitude < 0.28 && sky.nightAmount > 0.4;
  if (!low && !moonLow) return;
  ctx.save();
  if (low) {
    const a = clamp(1 - sky.sun.altitude / 0.42, 0, 1) * 0.5 * vis;
    const g = ctx.createRadialGradient(sky.sun.x, bandY, 0, sky.sun.x, bandY, H * 0.7);
    g.addColorStop(0, `rgba(255,168,86,${a})`);
    g.addColorStop(0.45, `rgba(255,110,80,${a * 0.32})`);
    g.addColorStop(1, 'rgba(255,90,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.55);
  }
  if (moonLow) {
    const a = clamp(1 - sky.moon.altitude / 0.28, 0, 1) * 0.28 * vis;
    const g = ctx.createRadialGradient(sky.moon.x, bandY, 0, sky.moon.x, bandY, H * 0.55);
    g.addColorStop(0, `rgba(140,180,255,${a})`);
    g.addColorStop(1, 'rgba(80,120,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.5);
  }
  ctx.restore();
}

function drawClouds(game, ctx, W, H, camX, sky, vis) {
  if (vis < 0.2) return;
  const t = game.time ? game.time.t : 0;
  const night = sky.nightAmount;
  const body = mix(
    mix([230, 236, 244], [255, 228, 196], sky.sunWarmth * (1 - night)),
    [48, 58, 86],
    night * 0.72,
  );
  // Horizontal drift only. Y is a screen fraction — jumping cannot move it.
  const scroll = camX * 0.025 + t * 3.2;
  ctx.save();
  ctx.globalAlpha = vis * (0.22 + 0.18 * (1 - night));
  for (let i = 0; i < 5; i++) {
    const seed = i * 97.1;
    const x = ((scroll * (0.6 + i * 0.08) + seed * 40) % (W + 220)) - 110;
    const y = H * (0.20 + (i % 3) * 0.055);
    const s = 28 + (i % 3) * 14;
    ctx.fillStyle = rgba(body, 0.55);
    puff(ctx, x, y, s);
    puff(ctx, x + s * 0.7, y + 4, s * 0.75);
    puff(ctx, x - s * 0.55, y + 6, s * 0.62);
  }
  ctx.restore();
}

function puff(ctx, x, y, r) {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.48, 0, 0, TAU);
  ctx.fill();
}

function drawFarRays(game, ctx, W, H, depthT, sky, vis) {
  const body = pickRayBody(sky);
  if (!body) return;
  const cover = canopyCover(game);
  const open = 1 - cover * 0.55;
  const lowBoost = clamp(1 - Math.abs(body.altitude - 0.2) / 0.55, 0, 1);
  const base = (sky.sun.up ? 0.06 : 0.09) * vis * open * (0.5 + 0.5 * lowBoost);
  if (base < 0.008) return;

  const t = game.time ? game.time.t : 0;
  const lean = sky.lean;
  const color = sky.sun.up ? [255, 226, 170] : [186, 214, 255];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = 8;
  for (let i = 0; i < n; i++) {
    const seed = i * 1.618;
    const drift = Math.sin(t * (0.09 + seed * 0.03) + seed * 4) * 18;
    const ang = lean * 0.55 + (i - n / 2) * 0.055 + drift * 0.002;
    const topW = 8 + (i % 3) * 5;
    const len = H * (0.6 + (i % 4) * 0.08);
    const pulse = 0.55 + 0.45 * Math.sin(t * (0.4 + seed * 0.2) + seed * 6);
    const a = base * pulse * (0.55 + (i % 3) * 0.15);
    const x0 = body.x + (i - n / 2) * 16 + drift;
    const y0 = body.y;
    const x1 = x0 + Math.sin(ang) * len;
    const y1 = y0 + Math.cos(ang * 0.15) * len;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(color, a * 1.25));
    g.addColorStop(0.4, rgba(color, a * 0.55));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - topW / 2, y0);
    ctx.lineTo(x0 + topW / 2, y0);
    ctx.lineTo(x1 + topW * 1.8, y1);
    ctx.lineTo(x1 - topW * 1.8, y1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  void depthT;
}

function pickRayBody(sky) {
  if (sky.sun.up && sky.sun.altitude > 0.02) return sky.sun;
  if (sky.moon.up && sky.moon.altitude > 0.02) return sky.moon;
  return null;
}

function canopyCover(game) {
  const world = game.world;
  const p = game.localPlayer;
  if (!world || !p) return 0;
  const col = Math.floor((p.x + p.w / 2) / TILE);
  let hits = 0, n = 0;
  for (let dx = -10; dx <= 10; dx += 2) {
    const tx = col + dx;
    const ty = world.surfaceY(tx) - 1;
    n++;
    const id = world.get(tx, ty);
    if (isLeaf(id) || isSolid(id)) hits++;
  }
  return n ? hits / n : 0;
}

export function drawNearBloom(ctx, W, H, sky, vis, atmosphere) {
  if (!atmosphere || vis < 0.12) return;
  const body = pickRayBody(sky);
  if (!body) return;
  const col = sky.sun.up ? [255, 220, 160] : [170, 204, 255];
  const a = (sky.sun.up ? 0.05 : 0.08) * vis;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(body.x, body.y, 0, body.x, body.y, Math.max(W, H) * 0.38);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(0.4, rgba(col, a * 0.22));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/**
 * Cool highlight on anything the moon can actually see: canopy crowns first,
 * then the top of exposed ground. Drawn in world space after the darkness
 * overlay so the bleach stays bright — that is the reference still.
 */
export function drawMoonlightCatch(game, ctx, tx0, ty0, tx1, ty1, sky) {
  const night = sky.nightAmount;
  const sun = sky.sun.up ? clamp(sky.sun.altitude, 0, 1) : 0;
  const moon = sky.moon.up ? clamp(sky.moon.altitude, 0, 1) : 0;
  const k = night * moon * 0.55 + (1 - night) * sun * 0.18;
  if (k < 0.04) return;
  const world = game.world;
  if (!world) return;
  const col = night > 0.35 ? '#c5d6ee' : '#fff4dc';

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const id = world.get(tx, ty);
      if (!id) continue;
      const surf = world.surfaceY(tx);
      const above = world.get(tx, ty - 1);
      const x = tx * TILE, y = ty * TILE;

      if (isLeaf(id)) {
        const crown = !isLeaf(above);
        ctx.globalAlpha = k * (crown ? 0.38 : 0.10);
        ctx.fillStyle = col;
        ctx.fillRect(x, y, TILE, crown ? 5 : 3);
        continue;
      }

      if (ty > surf + 1) continue;
      if (!isSolid(id) || isSolid(above)) continue;
      ctx.globalAlpha = k * 0.12;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, TILE, 3);
    }
  }
  ctx.restore();
}

/**
 * Long ground shadows from trees and the player, thrown away from the moon.
 * World space, after the overlay, so they stay readable.
 */
export function drawMoonShadows(game, ctx, tx0, ty0, tx1, ty1, sky, cam, screenW) {
  const night = sky.nightAmount;
  if (night < 0.22 || !sky.moon.up) return;
  const world = game.world;
  if (!world) return;
  const k = night * clamp(sky.moon.altitude, 0.15, 1);

  ctx.save();
  ctx.fillStyle = `rgba(4, 8, 22,${0.18 * k})`;

  for (let tx = tx0; tx <= tx1; tx++) {
    let top = null, bot = null;
    for (let ty = ty0; ty <= ty1; ty++) {
      const id = world.get(tx, ty);
      if (isLeaf(id) || isTree(id)) {
        if (top == null) top = ty;
        bot = ty;
      }
    }
    if (top == null) continue;
    const surf = world.surfaceY(tx);
    const cx = (tx + 0.5) * TILE;
    const gy = surf * TILE;
    const height = Math.max(TILE * 2, (bot - top + 1) * TILE);
    const treeScreenX = (cx - cam.x) * cam.scale + screenW / 2;
    const away = treeScreenX >= sky.moon.x ? 1 : -1;
    const stretch = height * (0.85 + Math.min(0.7, Math.abs(treeScreenX - sky.moon.x) / Math.max(1, screenW)) * 0.8);
    ctx.beginPath();
    ctx.moveTo(cx - 5, gy);
    ctx.lineTo(cx + 5, gy);
    ctx.lineTo(cx + 5 + away * stretch, gy + 3);
    ctx.lineTo(cx - 3 + away * stretch * 0.92, gy + 6);
    ctx.closePath();
    ctx.fill();
  }

  const p = game.localPlayer;
  if (p && p.alive) {
    const cx = p.x + p.w / 2;
    const gy = p.y + p.h;
    const pScreenX = (cx - cam.x) * cam.scale + screenW / 2;
    const away = pScreenX >= sky.moon.x ? 1 : -1;
    const stretch = 22 + Math.min(28, Math.abs(pScreenX - sky.moon.x) * 0.04);
    ctx.fillStyle = `rgba(4, 8, 22,${0.22 * k})`;
    ctx.beginPath();
    ctx.moveTo(cx - 5, gy);
    ctx.lineTo(cx + 5, gy);
    ctx.lineTo(cx + 4 + away * stretch, gy + 2);
    ctx.lineTo(cx - 2 + away * stretch * 0.9, gy + 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawLightGlows(ctx, cam, screenW, screenH, glows) {
  if (!glows || !glows.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const g of glows) {
    const s = cam.worldToScreen(g.x, g.y, screenW, screenH);
    const r = (g.radius || 40) * cam.scale;
    const a = (g.alpha != null ? g.alpha : 0.22) * g.level;
    if (a < 0.01 || r < 4) continue;
    const col = g.rgb || [255, 190, 110];
    if (g.ground) {
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grd.addColorStop(0, rgba(col, a));
      grd.addColorStop(0.45, rgba(col, a * 0.4));
      grd.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.38, 0, 0, TAU);
      ctx.fill();
    } else {
      const grd = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grd.addColorStop(0, rgba(col, a));
      grd.addColorStop(0.4, rgba(col, a * 0.38));
      grd.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grd;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

function hexToRgb(h) {
  if (!h || h[0] !== '#' || h.length < 7) return [255, 190, 110];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function glowColorFromHex(h) {
  return hexToRgb(h);
}
