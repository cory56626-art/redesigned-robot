// Summoner Realms — canvas renderer. Draws sky, walls, world, lighting,
// entities and effects.
import { TILE, UNDERGROUND_Y, CAVERN_Y, WORLD_H, LIQUID_MAX } from '../config.js?v=prehardmode-weapons-1';
import { T, isSolid, isTree, isLeaf, tileDef, swayWeight, floraAnchor } from '../world/tiles.js?v=prehardmode-weapons-1';
import { SH } from '../world/shapes.js?v=prehardmode-weapons-1';
import { W, hasWall } from '../world/walls.js?v=prehardmode-weapons-1';
import { BIOMES } from '../world/biomes.js?v=prehardmode-weapons-1';
import { Sprites, framingMask, N, E, S, WBIT } from '../art/sprites.js?v=prehardmode-weapons-1';
import { item as getItem } from '../data/items.js?v=prehardmode-weapons-1';
import { canPlaceAt } from '../systems/combat.js?v=prehardmode-weapons-1';
import { clamp } from '../utils.js?v=prehardmode-weapons-1';
import { drawAidan, drawAidanEffects } from '../entities/aidan.js?v=prehardmode-weapons-1';

// Fallback appearance for players without a character record (remote players
// on an older client, or a world loaded before characters existed).
const DEFAULT_LOOK = {
  skin: '#f0c9a0', hair: '#4a3a2a', hairStyle: 'short',
  shirt: '#7ee0c0', pants: '#2a2f45', eyes: '#222222',
};

const PROJ_GLOW = {
  thorn: '#7ee08a', seed: '#a7e36f', rock: '#8a7a5a', shock: '#d3b985',
  blight: '#c58bff', crystal: '#df8cff', voidorb: '#b06bff',
  spark: '#9ec3ff', sparkBolt: '#cfe6ff', wispbolt: '#9ec3ff', emberball: '#ff8c3b',
  saplingArrow: '#b9eb82', amberArrow: '#ffe08a', slingStone: '#b7bec8',
  stormBolt: '#fff8a8', tideBolt: '#9defff', tideshard: '#9defff',
  seedBloom: '#b8f58a', shadowOrb: '#d7a5ff', shadowmote: '#d7a5ff',
  poisonDart: '#9be871', aurora: '#b9ffe8',
  arcwave: '#bfe9ff', frostbolt: '#9cecff', diamondSpear: '#dffcff', miniDiamondSpear: '#8be9ff', aidanPulse: '#8feaff', aidanNova: '#d8a7ff', aidanFreeze: '#61eaff',
  mechMissile: '#ffad55', mechPlasma: '#78e9ff', mechShock: '#ffd36d',
};

// Background colour anchors by depth, in tile rows. `colorAtDepth` interpolates
// between them, so descending from daylight to the deep caverns is one
// continuous fade instead of two hard switches at fixed thresholds.
const DEPTH_STOPS = [
  { rel: -58, c: [0, 0, 0], sky: 'top' },   // high sky   (filled from the biome)
  { rel: -4, c: [0, 0, 0], sky: 'bot' },    // horizon    (filled from the biome)
  { rel: 10, c: [58, 42, 30] },             // dirt layer, just under the surface
  { abs: UNDERGROUND_Y + 14, c: [38, 42, 55] },  // stone layer
  { abs: CAVERN_Y + 16, c: [26, 21, 36] },       // caverns
  { abs: WORLD_H - 12, c: [11, 8, 18] },         // the deep
];

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.lightCanvas = document.createElement('canvas');
    this.lightCtx = this.lightCanvas.getContext('2d');
  }

  draw(game) {
    const ctx = this.ctx;
    const W2 = this.canvas.width, H = this.canvas.height;
    const cam = this.camera;
    ctx.imageSmoothingEnabled = false;

    // Screen shake displaces the camera for this frame only, so nothing in the
    // simulation has to know about it.
    const shake = game.fx ? game.fx.offset() : { x: 0, y: 0 };
    const camX = cam.x + shake.x, camY = cam.y + shake.y;

    this._drawSky(game, W2, H, camX, camY);

    ctx.save();
    ctx.translate(W2 / 2 - camX * cam.scale, H / 2 - camY * cam.scale);
    ctx.scale(cam.scale, cam.scale);

    // Visible tile range.
    const tx0 = Math.max(0, Math.floor((camX - cam.vw / 2) / TILE) - 1);
    const ty0 = Math.max(0, Math.floor((camY - cam.vh / 2) / TILE) - 1);
    const tx1 = Math.min(game.world.width - 1, Math.ceil((camX + cam.vw / 2) / TILE) + 1);
    const ty1 = Math.min(game.world.height - 1, Math.ceil((camY + cam.vh / 2) / TILE) + 1);

    this._drawWalls(game, ctx, tx0, ty0, tx1, ty1);
    this._drawTiles(game, ctx, tx0, ty0, tx1, ty1);
    this._drawDartTrapTelegraphs(game, ctx, tx0, ty0, tx1, ty1);
    this._drawLiquid(game, ctx, tx0, ty0, tx1, ty1);
    this._drawFallingTrees(game, ctx);
    this._drawDrops(game, ctx);
    this._drawCritters(game, ctx);
    this._drawNpc(game, ctx);
    this._drawMinions(game, ctx);
    this._drawEnemies(game, ctx);
    this._drawBosses(game, ctx);
    this._drawThrown(game, ctx);
    this._drawProjectiles(game, ctx);
    this._drawPlayers(game, ctx);
    this._drawFishingLines(game, ctx);
    this._drawAimHighlight(game, ctx);
    // Ordinary particles sit under the lighting; glowing ones are drawn after it
    // (see below) because they are light, and shouldn't be dimmed by darkness.
    this._drawParticles(game, ctx, false);
    const dbg = game.debug;
    if (dbg && (dbg.collision || dbg.ai || dbg.spawn || dbg.caves || dbg.walls)) {
      this._drawDebugWorld(game, ctx, tx0, ty0, tx1, ty1);
    }

    ctx.restore();

    // Lighting overlay (screen-space, smooth). Skipped for the collision/cave
    // debug views so the outlines stay readable.
    if (!(dbg && (dbg.collision || dbg.caves))) this._drawLighting(game, tx0, ty0, tx1, ty1, W2, H, camX, camY);

    // Emissive pass, over the darkness: sparks, embers, explosions, shockwaves.
    ctx.save();
    ctx.translate(W2 / 2 - camX * cam.scale, H / 2 - camY * cam.scale);
    ctx.scale(cam.scale, cam.scale);
    // Keep the Diamond Heart's telegraph and beam above the lighting pass so
    // the three warning lanes stay readable in daylight and at night.
    this._drawDiamondBeamTelegraphs(game, ctx);
    drawAidanEffects(game, ctx);
    this._drawParticles(game, ctx, true);
    this._drawRings(game, ctx);
    ctx.restore();

    // Float texts (screen space via camera projection).
    this._drawFloatTexts(game, W2, H);
    if (dbg && dbg.biome) this._drawBiomeLabel(game, W2, H);
  }

  _drawDebugWorld(game, ctx, tx0, ty0, tx1, ty1) {
    const world = game.world;
    // Cave voids: tint air below the surface line.
    if (game.debug.caves) {
      ctx.fillStyle = 'rgba(90,200,255,0.16)';
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (world.get(tx, ty) === T.AIR && ty > world.surfaceY(tx)) ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    // Walls: tint every tile that has a background wall behind it.
    if (game.debug.walls) {
      ctx.fillStyle = 'rgba(255,180,90,0.22)';
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (world.hasWallAt(tx, ty)) ctx.fillRect(tx * TILE + 3, ty * TILE + 3, TILE - 6, TILE - 6);
      }
    }
    // Collision: outline solid tiles + entity hitboxes.
    if (game.debug.collision) {
      ctx.strokeStyle = 'rgba(255,80,110,0.5)'; ctx.lineWidth = 0.5;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (isSolid(world.get(tx, ty))) ctx.strokeRect(tx * TILE + 0.25, ty * TILE + 0.25, TILE - 0.5, TILE - 0.5);
      }
      ctx.lineWidth = 1; ctx.strokeStyle = '#ffcf6b';
      const box = (e) => ctx.strokeRect(e.x, e.y, e.w, e.h);
      for (const e of game.enemies) box(e);
      for (const b of game.bosses) box(b);
      ctx.strokeStyle = '#7ee0c0'; for (const p of game.players.values()) if (p.alive) box(p);
      ctx.strokeStyle = '#c58bff'; for (const m of game.minions) box(m);
      for (const n of game.npcs || (game.npc ? [game.npc] : [])) {
        ctx.strokeStyle = n.kind === 'snowkeeper' ? '#b9f4ff' : '#ffd9a0';
        box(n);
      }
    }
    // Spawn validity: sample floor tiles in view for a standard-size enemy.
    if (game.debug.spawn) {
      const W16 = 16, H24 = 24;
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          if (!isSolid(world.get(tx, ty)) || isSolid(world.get(tx, ty - 1))) continue; // want a floor top
          const x = tx * TILE, y = ty * TILE - H24;
          const clear = !world.rectHitsSolid(x, y, W16, H24);
          const farEnough = game.localPlayer ? Math.hypot((x + 8) - (game.localPlayer.x + game.localPlayer.w / 2), (y + 12) - (game.localPlayer.y + game.localPlayer.h / 2)) > 13 * TILE : true;
          ctx.fillStyle = clear && farEnough ? 'rgba(126,224,138,0.5)' : 'rgba(255,107,125,0.45)';
          ctx.fillRect(x + 6, y - 3, 4, 4);
        }
      }
    }
    // AI: target lines, plus each enemy's awareness state.
    if (game.debug.ai) {
      ctx.lineWidth = 1;
      for (const e of game.enemies) {
        const t = e.aiTargetPoint || null;
        if (t) {
          ctx.strokeStyle = e.aware ? 'rgba(255,107,125,0.75)' : 'rgba(255,207,107,0.35)';
          ctx.beginPath(); ctx.moveTo(e.x + e.w / 2, e.y + e.h / 2); ctx.lineTo(t.x, t.y); ctx.stroke();
        }
        if (e.telegraph > 0) {
          ctx.strokeStyle = '#ffcf6b';
          ctx.strokeRect(e.x - 2, e.y - 2, e.w + 4, e.h + 4);
        }
      }
      for (const m of game.minions) {
        const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
        const t = game.nearestReachableEnemyOrBoss(cx, cy, m.def.range);
        const owner = game.players.get(m.ownerId);
        const dest = t || owner;
        if (!dest) continue;
        ctx.strokeStyle = t ? 'rgba(126,224,138,0.8)' : 'rgba(255,207,107,0.6)';
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dest.x + dest.w / 2, dest.y + dest.h / 2); ctx.stroke();
      }
      for (const b of game.bosses) {
        if (b.aiState) {
          ctx.font = '7px monospace'; ctx.fillStyle = '#ffcf6b'; ctx.textAlign = 'center';
          ctx.fillText(b.aiState, b.x + b.w / 2, b.y - 8);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  _drawBiomeLabel(game, W2, H) {
    const p = game.localPlayer; if (!p) return;
    const tx = Math.floor((p.x + p.w / 2) / TILE), ty = Math.floor((p.y + p.h / 2) / TILE);
    const biome = game.world.biomeAt(tx, ty);
    const label = (BIOMES[biome] && BIOMES[biome].label) || biome;
    const ctx = this.ctx;
    const text = `${label} (${biome})  tile ${tx},${ty}`;
    ctx.font = 'bold 16px Trebuchet MS, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(text, W2 / 2 + 1, 111);
    ctx.fillStyle = '#7ee0c0'; ctx.fillText(text, W2 / 2, 110);
    ctx.textAlign = 'left';
  }

  // ---- Background ----

  // The background colour is sampled per screen edge from the world depth that
  // edge is looking at, then drawn as one gradient between them. Because both
  // ends move continuously with the camera, there is no threshold anywhere in
  // the path: the sky fades into the dirt layer, then stone, then the caverns.
  _drawSky(game, W2, H, camX, camY) {
    const ctx = this.ctx;
    const cam = this.camera;
    const world = game.world;
    const camTx = Math.floor(camX / TILE);
    const surfRow = this._blendedSurfaceRow(world, camTx);
    const sky = this._skyColors(game, camTx);

    const topWorldTy = (camY - H / (2 * cam.scale)) / TILE;
    const botWorldTy = (camY + H / (2 * cam.scale)) / TILE;
    const top = this._colorAtDepth(topWorldTy, surfRow, sky);
    const bot = this._colorAtDepth(botWorldTy, surfRow, sky);

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H);

    // How far below the surface line the view is, 0 at ground level, 1 well
    // underground. Drives stars fading out and the cave backdrop fading in.
    const depthT = clamp((botWorldTy - surfRow) / 34, 0, 1);

    if (depthT < 0.8) this._drawStars(game, W2, H, camX, depthT);
    if (depthT > 0.15) {
      // Clip the backdrop to the part of the screen that is actually below
      // ground, otherwise the parallax rock shows through the sky whenever the
      // bottom of the view is underground — which is most of the time.
      const horizonY = (surfRow * TILE - camY) * cam.scale + H / 2;
      if (horizonY < H) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, Math.max(0, horizonY), W2, H - Math.max(0, horizonY));
        ctx.clip();
        this._drawCaveBackdrop(ctx, W2, H, camX, camY, cam.scale, depthT);
        ctx.restore();
      }
    }
  }

  // Average the surface height around the camera so the sky/ground boundary
  // glides as you walk instead of stepping column by column.
  _blendedSurfaceRow(world, camTx) {
    let sum = 0, n = 0;
    for (let dx = -20; dx <= 20; dx += 5) { sum += world.surfaceY(camTx + dx); n++; }
    return sum / n;
  }

  // Sky colours for the biome under the camera, cross-faded with its neighbours
  // so walking from forest into corruption tints the sky gradually.
  _skyColors(game, camTx) {
    const world = game.world;
    const b = game.time.brightness;
    const t = clamp((b - 0.12) / 0.88, 0, 1);
    let top = [0, 0, 0], bot = [0, 0, 0], n = 0;
    for (let dx = -30; dx <= 30; dx += 15) {
      const def = BIOMES[world.surfaceBiomeAt(camTx + dx)] || BIOMES.forest;
      const day = def.skyDay, night = def.skyNight;
      const dTop = hexToRgb(day[0]), dBot = hexToRgb(day[1]);
      const nTop = hexToRgb(night[0]), nBot = hexToRgb(night[1]);
      for (let i = 0; i < 3; i++) {
        top[i] += nTop[i] + (dTop[i] - nTop[i]) * t;
        bot[i] += nBot[i] + (dBot[i] - nBot[i]) * t;
      }
      n++;
    }
    return { top: top.map(v => v / n), bot: bot.map(v => v / n) };
  }

  // Interpolate the depth stop list at a given tile row.
  _colorAtDepth(ty, surfRow, sky) {
    const stops = [];
    for (const s of DEPTH_STOPS) {
      const at = s.abs != null ? s.abs : surfRow + s.rel;
      const c = s.sky === 'top' ? sky.top : s.sky === 'bot' ? sky.bot : s.c;
      stops.push({ at, c });
    }
    if (ty <= stops[0].at) return rgb(stops[0].c);
    for (let i = 1; i < stops.length; i++) {
      if (ty <= stops[i].at) {
        const a = stops[i - 1], b = stops[i];
        const k = (ty - a.at) / Math.max(0.001, b.at - a.at);
        return rgb([
          a.c[0] + (b.c[0] - a.c[0]) * k,
          a.c[1] + (b.c[1] - a.c[1]) * k,
          a.c[2] + (b.c[2] - a.c[2]) * k,
        ]);
      }
    }
    return rgb(stops[stops.length - 1].c);
  }

  _drawStars(game, W2, H, camX, depthT) {
    const b = game.time.brightness;
    if (b >= 0.45) return;
    const ctx = this.ctx;
    const alpha = (0.45 - b) * 1.6 * (1 - depthT / 0.8);
    if (alpha <= 0.01) return;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    for (let i = 0; i < 60; i++) {
      const sx = (i * 137.5 - camX * 0.2) % W2;
      const sy = (i * 89.3) % (H * 0.6);
      ctx.fillRect((sx + W2) % W2, sy, 2, 2);
    }
  }

  // Slow-parallax rock silhouettes behind the tiles, so caves have visible depth
  // behind the wall layer rather than reading as flat colour.
  _drawCaveBackdrop(ctx, W2, H, camX, camY, scale, depthT) {
    const px = -camX * 0.32, py = -camY * 0.32;
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, depthT * 0.5);
    const span = 260;
    const i0 = Math.floor((-px) / span) - 1;
    const i1 = Math.ceil((W2 - px) / span) + 1;
    const j0 = Math.floor((-py) / span) - 1;
    const j1 = Math.ceil((H - py) / span) + 1;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // Unsigned shifts throughout: `>>` would coerce the hash to int32 and go
        // negative for half of all inputs, which produces a negative radius.
        const h = hash2(i, j);
        const x = px + i * span + (h % 90);
        const y = py + j * span + ((h >>> 7) % 90);
        const r = 60 + ((h >>> 13) % 90);
        ctx.fillStyle = (h & 1) ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * 0.62, ((h >>> 3) % 30) / 30, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---- Terrain ----

  // Background walls, drawn only where the foreground tile isn't solid — a wall
  // behind a solid block is never visible, so there is no point paying for it.
  _drawWalls(game, ctx, tx0, ty0, tx1, ty1) {
    const world = game.world;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const wid = world.getWall(tx, ty);
        if (!hasWall(wid)) continue;
        if (isSolid(world.get(tx, ty))) continue;
        let mask = 0;
        if (hasWall(world.getWall(tx, ty - 1))) mask |= N;
        if (hasWall(world.getWall(tx + 1, ty))) mask |= E;
        if (hasWall(world.getWall(tx, ty + 1))) mask |= S;
        if (hasWall(world.getWall(tx - 1, ty))) mask |= WBIT;
        const spr = Sprites.getWall(wid, mask);
        if (spr) ctx.drawImage(spr, tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }

  _drawTiles(game, ctx, tx0, ty0, tx1, ty1) {
    const world = game.world;
    const t = game.time ? game.time.t : 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = world.get(tx, ty);
        if (id === T.AIR) continue;
        const spr = this._tileSprite(world, tx, ty, id);
        if (spr) {
          const shape = world.getShape(tx, ty);
          const sway = swayWeight(id);
          if (sway > 0) this._drawSwaying(game, ctx, spr, tx, ty, id, sway, t);
          else if (shape !== SH.FULL) this._drawShaped(ctx, spr, tx, ty, shape);
          else ctx.drawImage(spr, tx * TILE, ty * TILE, TILE, TILE);
        }
        // Mining cracks.
        const ratio = world.miningRatio(tx, ty);
        if (ratio > 0.01) {
          ctx.fillStyle = `rgba(0,0,0,${0.15 + ratio * 0.4})`;
          const n = Math.ceil(ratio * 3);
          for (let i = 0; i < n; i++) ctx.fillRect(tx * TILE + 2 + i * 4, ty * TILE + 3 + (i % 2) * 6, 2, 6);
        }
      }
    }
  }

  _drawDartTrapTelegraphs(game, ctx, tx0, ty0, tx1, ty1) {
    const traps = game.world && game.world.dartTraps;
    if (!traps || !traps.size) return;
    for (const trap of traps.values()) {
      if (!(trap.charge > 0) || trap.tx < tx0 || trap.tx > tx1 || trap.ty < ty0 || trap.ty > ty1) continue;
      const k = 1 - trap.charge / 0.42;
      const cx = (trap.tx + 0.5) * TILE, cy = (trap.ty + 0.5) * TILE;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32 + k * 0.5;
      ctx.strokeStyle = '#b8f482'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + trap.dir * 5, cy);
      ctx.lineTo(cx + trap.dir * (12 + k * 18), cy);
      ctx.stroke();
      ctx.fillStyle = '#d8ffb0';
      ctx.beginPath(); ctx.arc(cx + trap.dir * 5, cy, 1.5 + k * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Foliage bending in the wind.
  //
  // The tile is sheared around its anchored edge rather than translated, so the
  // rooted end stays put and only the free end moves — which is the difference
  // between a plant bending and a sprite sliding sideways.
  //
  // The phase comes from the tile's own coordinates, so neighbouring tiles of
  // one canopy move together as a mass while a plant twenty tiles away is out
  // of step. Without that, either everything moves in lockstep (which reads as
  // the whole world sliding) or every tile is independent (which reads as
  // static).
  _drawSwaying(game, ctx, spr, tx, ty, id, sway, t) {
    const wind = game.weather ? game.weather.windAtTile(game.world, tx, ty) : 0;
    const x = tx * TILE, y = ty * TILE;
    if (Math.abs(wind) < 0.005) { ctx.drawImage(spr, x, y, TILE, TILE); return; }

    // Base lean from the wind, plus a rustle that runs across the world as a
    // travelling wave so gusts visibly move through foliage.
    const phase = tx * 0.42 + ty * 0.19;
    const rustle = Math.sin(t * 2.6 + phase) * 0.35 + Math.sin(t * 4.7 + phase * 1.7) * 0.15;
    const lean = wind * (1 + rustle) * sway * 3.2;

    const anchor = floraAnchor(id);
    // Hanging things pivot at the top, everything else at its roots.
    const pivotY = anchor === 'ceiling' ? y : y + TILE;
    const dir = anchor === 'ceiling' ? 1 : -1;

    ctx.save();
    ctx.translate(x + TILE / 2, pivotY);
    // A shear rather than a rotation: it keeps the tile grid-aligned, so a
    // canopy of many tiles bends as one sheet instead of coming apart at the
    // seams the way independent rotations would.
    ctx.transform(1, 0, (lean / TILE) * dir, 1, 0, 0);
    ctx.drawImage(spr, -TILE / 2, pivotY === y ? 0 : -TILE, TILE, TILE);
    ctx.restore();
  }

  // A hammered tile: draw the full sprite clipped to its shape.
  _drawShaped(ctx, spr, tx, ty, shape) {
    const x = tx * TILE, y = ty * TILE;
    ctx.save();
    ctx.beginPath();
    switch (shape) {
      case SH.HALF_BOTTOM: ctx.rect(x, y + TILE / 2, TILE, TILE / 2); break;
      case SH.HALF_TOP: ctx.rect(x, y, TILE, TILE / 2); break;
      case SH.SLOPE_NE: ctx.moveTo(x, y + TILE); ctx.lineTo(x + TILE, y); ctx.lineTo(x + TILE, y + TILE); break;
      case SH.SLOPE_NW: ctx.moveTo(x, y); ctx.lineTo(x + TILE, y + TILE); ctx.lineTo(x, y + TILE); break;
      case SH.SLOPE_SE: ctx.moveTo(x, y); ctx.lineTo(x + TILE, y); ctx.lineTo(x + TILE, y + TILE); break;
      case SH.SLOPE_SW: ctx.moveTo(x, y); ctx.lineTo(x + TILE, y); ctx.lineTo(x, y + TILE); break;
      default: ctx.rect(x, y, TILE, TILE);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(spr, x, y, TILE, TILE);
    ctx.restore();
  }

  // Pick the right variant for a tile from its neighbours: trunks and canopies
  // get their own shading, terrain gets edge framing, decor stays as-is.
  _tileSprite(world, tx, ty, id) {
    if (isTree(id)) {
      let mask = 0;
      if (isTree(world.get(tx, ty - 1))) mask |= N;
      if (isTree(world.get(tx, ty + 1))) mask |= S;
      return Sprites.getTrunk(id, mask, hash2(tx, ty) & 3);
    }
    if (isLeaf(id)) {
      let mask = 0;
      if (isLeaf(world.get(tx, ty - 1))) mask |= N;
      if (isLeaf(world.get(tx + 1, ty))) mask |= E;
      if (isLeaf(world.get(tx, ty + 1))) mask |= S;
      if (isLeaf(world.get(tx - 1, ty))) mask |= WBIT;
      return Sprites.getCanopy(id, mask, hash2(tx, ty) & 3);
    }
    const def = tileDef(id);
    if (def.decor || !def.mat) return Sprites.getTile(id);
    const mask = framingMask(world, tx, ty, id);
    // Grass fringes down onto the tile below it, in its own colour.
    const aboveId = world.get(tx, ty - 1);
    const above = tileDef(aboveId);
    const grassAbove = (above.grass && !def.grass) ? aboveId : 0;
    return Sprites.getFramed(id, mask, grassAbove);
  }

  _drawAimHighlight(game, ctx) {
    const p = game.localPlayer; if (!p || !p.alive) return;
    const sel = p.inventory.selectedItem();
    const s = game.input.state;
    const smart = game.smartTarget;
    const tx = smart ? smart.tx : Math.floor(s.aimX / TILE);
    const ty = smart ? smart.ty : Math.floor(s.aimY / TILE);

    if (sel && (sel.place != null)) {
      // Ghost preview: green = can place here, red = cannot, with the block's
      // own icon shown faintly so you see exactly what/where you'll build.
      const valid = canPlaceAt(game, p, tx, ty, sel).ok;
      const icon = Sprites.getIcon(sel);
      if (icon) { ctx.globalAlpha = valid ? 0.5 : 0.28; ctx.drawImage(icon, tx * TILE, ty * TILE, TILE, TILE); ctx.globalAlpha = 1; }
      ctx.strokeStyle = valid ? 'rgba(126,224,138,0.95)' : 'rgba(255,107,125,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx * TILE + 0.75, ty * TILE + 0.75, TILE - 1.5, TILE - 1.5);
    } else if (sel && (sel.category === 'tool')) {
      ctx.strokeStyle = 'rgba(255,207,107,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }

    // Smart Cursor draws corner brackets on its chosen tile so it is obvious the
    // game picked the target rather than the pointer.
    if (smart) {
      const x = tx * TILE, y = ty * TILE, c = 4;
      ctx.strokeStyle = 'rgba(126,224,192,0.95)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
      ctx.moveTo(x + TILE - c, y); ctx.lineTo(x + TILE, y); ctx.lineTo(x + TILE, y + c);
      ctx.moveTo(x + TILE, y + TILE - c); ctx.lineTo(x + TILE, y + TILE); ctx.lineTo(x + TILE - c, y + TILE);
      ctx.moveTo(x + c, y + TILE); ctx.lineTo(x, y + TILE); ctx.lineTo(x, y + TILE - c);
      ctx.stroke();
    }

    // Mobile radial aim marker at the actual aim point, rather than making the
    // player aim at an empty fixed-distance ring.
    if (game.input.aimMode === 'dir' && !smart) {
      ctx.save();
      ctx.fillStyle = 'rgba(255,207,107,0.9)';
      ctx.beginPath(); ctx.arc(s.aimX, s.aimY, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,245,190,0.95)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(s.aimX, s.aimY, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // Water, drawn over the terrain and under everything that moves.
  //
  // Each cell is filled to its level, so a partly-filled tile shows a real
  // surface rather than a full block of blue. The topmost cell of a body gets a
  // travelling wave and a brighter rim, which is what makes still water read as
  // a liquid instead of a flat coloured rectangle.
  _drawLiquid(game, ctx, tx0, ty0, tx1, ty1) {
    const liq = game.world.liquid;
    if (!liq) return;
    const t = game.time ? game.time.t : 0;

    ctx.save();
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const level = liq.get(tx, ty);
        if (!level) continue;
        const fill = level / LIQUID_MAX;
        // Water below more water is full-height: only the top of a body has a
        // free surface.
        const covered = liq.get(tx, ty - 1) > 0;
        const h = covered ? TILE : TILE * fill;
        const x = tx * TILE, y = ty * TILE + (TILE - h);

        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#2f6fbf';
        ctx.fillRect(x, y, TILE, h);

        if (!covered) {
          // Surface wave: two out-of-phase sines so it never reads as a single
          // scrolling sawtooth.
          const wave = Math.sin(t * 2.2 + tx * 0.55) * 0.8 + Math.sin(t * 1.3 + tx * 0.21) * 0.5;
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#7ec2f0';
          ctx.fillRect(x, y + wave - 1, TILE, 1.4);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#bfe4ff';
          ctx.fillRect(x, y + wave, TILE, 0.6);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A toppling tree keeps the exact sprites it had while standing — the shaded
  // trunk and the self-shadowed canopy — because the felling code captured each
  // cell's neighbour mask and variant before clearing the tiles. Drawing
  // `Sprites.getTile` here instead is what used to make a felled tree visibly
  // snap back to a flat, older-looking model halfway through the fall.
  _drawFallingTrees(game, ctx) {
    if (!game.fallingTrees || !game.fallingTrees.length) return;
    for (const ft of game.fallingTrees) {
      ctx.save();
      ctx.translate(ft.px, ft.py);
      ctx.rotate(ft.angle);
      ctx.globalAlpha = Math.max(0, 1 - (ft.t / ft.dur) * 0.55);
      for (const c of ft.cells) {
        const spr = isTree(c.id) ? Sprites.getTrunk(c.id, c.mask || 0, c.variant || 0)
          : isLeaf(c.id) ? Sprites.getCanopy(c.id, c.mask || 0, c.variant || 0)
            : Sprites.getTile(c.id);
        if (spr) ctx.drawImage(spr, c.dx * TILE - TILE / 2, c.dy * TILE - TILE, TILE, TILE);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // Wildlife. Every animal is a few shapes with a walk bob, but the bob is what
  // matters: a static rectangle standing in a field reads as a prop, and the
  // same rectangle breathing and stepping reads as alive.
  _drawCritters(game, ctx) {
    if (!game.critters || !game.critters.length) return;
    for (const c of game.critters) {
      if (c.dead) continue;
      ctx.save();
      const step = Math.sin(c.anim * 9) * (Math.abs(c.vx) > 4 ? 1 : 0);
      const breathe = Math.sin(c.anim * 2.2) * 0.4;
      ctx.translate(c.x + c.w / 2, c.y + c.h);
      ctx.scale(c.facing, 1);
      ctx.translate(-c.w / 2, -c.h);

      if (c.kind === 'bug') this._drawBug(ctx, c, step);
      else this._drawAnimal(ctx, c, step, breathe);

      if (c.hurtFlash > 0) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.w, c.h);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  _drawAnimal(ctx, c, step, breathe) {
    const w = c.w, h = c.h;
    // Shadow, so animals sit on the ground instead of hovering over it.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(w / 2, h, w * 0.42, 1.6, 0, 0, Math.PI * 2); ctx.fill();

    // Legs, contra-swinging.
    ctx.fillStyle = this._shade(c.color2, -0.15);
    const legH = Math.max(3, h * 0.3);
    ctx.fillRect(w * 0.18, h - legH + step, 2, legH - step);
    ctx.fillRect(w * 0.68, h - legH - step, 2, legH + step);

    // Body.
    ctx.fillStyle = c.color;
    this._roundRect(ctx, 1, h * 0.22 + breathe, w - 2, h * 0.58, Math.min(5, h * 0.3));
    ctx.fill();
    // Underside shading gives the body volume.
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    this._roundRect(ctx, 2, h * 0.55, w - 4, h * 0.24, 3); ctx.fill();

    // Head, forward and slightly higher than the body.
    const hs = Math.max(4, w * 0.3);
    ctx.fillStyle = c.color;
    this._roundRect(ctx, w - hs - 0.5, h * 0.1 + breathe, hs, hs, 2.5); ctx.fill();

    // Species markers: horns, snout, ears, comb — a handful of pixels each,
    // but enough that a cow is not just a big rabbit.
    ctx.fillStyle = c.color2;
    if (c.key === 'cow') {
      ctx.fillRect(w - hs - 1, h * 0.06 + breathe, 2, 2);       // horn
      ctx.fillRect(1, h * 0.3, w * 0.35, h * 0.22);              // hide patch
    } else if (c.key === 'pig') {
      ctx.fillRect(w - 2, h * 0.28 + breathe, 2, 2.5);           // snout
    } else if (c.key === 'sheep') {
      ctx.fillStyle = this._shade(c.color, -0.1);
      for (let i = 0; i < 4; i++) ctx.fillRect(2 + i * (w - 5) / 3, h * 0.2 + breathe, 3, 3);
      ctx.fillStyle = c.color2;
    } else if (c.key === 'rabbit') {
      ctx.fillRect(w - hs + 1, h * 0.1 + breathe - 4, 1.5, 5);   // ears
      ctx.fillRect(w - hs + 3, h * 0.1 + breathe - 4, 1.5, 5);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(1.5, h * 0.5, 2, 0, Math.PI * 2); ctx.fill(); // tail
    } else if (c.key === 'chicken') {
      ctx.fillRect(w - hs * 0.6, h * 0.02 + breathe, 3, 2.5);    // comb
      ctx.fillStyle = '#e8a33a';
      ctx.fillRect(w - 1.5, h * 0.24 + breathe, 2, 1.5);         // beak
    } else if (c.key === 'frog') {
      ctx.fillStyle = '#2a3a24';
      ctx.fillRect(w - hs + 1, h * 0.06 + breathe, 1.5, 1.5);    // bulging eye
    }

    // Eye.
    ctx.fillStyle = '#20242c';
    ctx.fillRect(w - hs * 0.45, h * 0.22 + breathe, 1.4, 1.4);
  }

  _drawBug(ctx, c, step) {
    const w = c.w, h = c.h;
    // Fliers glow faintly, which is most of how you spot one at night.
    if (c.def.light) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 9);
      g.addColorStop(0, c.color2);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.5 + Math.sin(c.anim * 4) * 0.18;
      ctx.fillStyle = g;
      ctx.fillRect(w / 2 - 9, h / 2 - 9, 18, 18);
      ctx.restore();
    }
    ctx.fillStyle = c.color;
    this._roundRect(ctx, 0, h * 0.15, w, h * 0.7, 2); ctx.fill();
    ctx.fillStyle = c.color2;
    if (c.def.behavior === 'flutter') {
      // Wings beat fast enough to blur into two arcs.
      const beat = Math.abs(Math.sin(c.anim * 26));
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.ellipse(w * 0.35, h * 0.2, w * 0.45, 1 + beat * 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      // Segments, offset by the crawl cycle.
      for (let i = 0; i < 3; i++) ctx.fillRect(1 + i * (w - 2) / 3, h * 0.3 + (i % 2 ? step * 0.4 : 0), 1.5, h * 0.4);
    }
  }

  _drawDrops(game, ctx) {
    for (const d of game.drops) {
      const icon = Sprites.getIcon(getItem(d.itemId));
      const yo = Math.sin(d.bob || 0) * 2;
      if (icon) ctx.drawImage(icon, d.x - 3, d.y - 3 + yo, 14, 14);
    }
  }

  _drawThrown(game, ctx) {
    if (!game.thrown) return;
    for (const t of game.thrown) t.draw(ctx, Sprites);
  }

  _drawProjectiles(game, ctx) {
    for (const pr of game.projectiles) {
      const glow = PROJ_GLOW[pr.kind] || pr.color;
      const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(pr.rot);

      // Active player weapons and the new pre-Hardmode minions keep a readable,
      // themed silhouette in flight. Before this branch, bows and staff shots
      // fell through to the generic four-pixel bolt even though their icons and
      // casting effects were already distinct.
      if (pr.kind === 'saplingArrow' || pr.kind === 'amberArrow') {
        const amber = pr.kind === 'amberArrow';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = amber ? 0.30 : 0.18;
        ctx.fillStyle = amber ? '#ffe79b' : '#b9eb82';
        ctx.fillRect(-11, -3, 20, 6);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = amber ? '#9b642c' : '#56753b';
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(7, 0); ctx.stroke();
        ctx.fillStyle = amber ? '#fff7ca' : '#e8ffc9';
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = amber ? '#ffc85d' : '#a5d364';
        ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-11, -3); ctx.lineTo(-9, 0); ctx.lineTo(-11, 3); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'slingStone') {
        const pulse = 1 + Math.sin(performance.now() * 0.017 + pr.x * 0.06) * 0.1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = '#d6dce4'; ctx.beginPath(); ctx.arc(0, 0, 8 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#6e7480'; ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#bfc6d0'; ctx.beginPath(); ctx.arc(-1.3, -1.4, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4b515d'; ctx.fillRect(1, 1, 2, 1.5);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'sparkBolt' || pr.kind === 'wispbolt') {
        const wisp = pr.kind === 'wispbolt';
        const pulse = 1 + Math.sin(performance.now() * 0.02 + pr.y * 0.05) * 0.14;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = wisp ? '#9ec3ff' : '#dff4ff'; ctx.beginPath(); ctx.arc(0, 0, 9 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = wisp ? '#8fb8ff' : '#a7d8ff';
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(0, -4); ctx.lineTo(-7, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f2fdff'; ctx.fillRect(-1.5, -1.5, 4, 3);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'emberball') {
        const pulse = 1 + Math.sin(performance.now() * 0.022 + pr.x * 0.04) * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 * pulse;
        ctx.fillStyle = '#ff8c3b'; ctx.beginPath(); ctx.arc(0, 0, 10 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#d7492e'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(1, -1, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff2b0'; ctx.fillRect(1, -2, 2, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'stormBolt') {
        const pulse = 1 + Math.sin(performance.now() * 0.032 + pr.x * 0.06) * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.26 * pulse;
        ctx.fillStyle = '#fff8a8'; ctx.fillRect(-11, -7, 22, 14);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#fff2a0'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-10, -2); ctx.lineTo(-4, 2); ctx.lineTo(-1, -4); ctx.lineTo(4, 1); ctx.lineTo(10, -1); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(-3, 1); ctx.lineTo(0, -3); ctx.lineTo(5, 0); ctx.lineTo(9, -1); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'tideBolt' || pr.kind === 'tideshard') {
        const shard = pr.kind === 'tideshard';
        const pulse = 1 + Math.sin(performance.now() * 0.018 + pr.y * 0.04) * 0.1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = '#9defff'; ctx.beginPath(); ctx.arc(0, 0, (shard ? 8 : 10) * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = shard ? '#69c7df' : '#46a7c9';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.quadraticCurveTo(0, -6, -6, 0); ctx.quadraticCurveTo(0, 6, 8, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e9ffff'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.quadraticCurveTo(0, -2.5, -2, 0); ctx.quadraticCurveTo(0, 2.5, 5, 0); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'seedBloom') {
        const pulse = 1 + Math.sin(performance.now() * 0.018 + pr.x * 0.03) * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.18 * pulse;
        ctx.fillStyle = '#b8f58a'; ctx.beginPath(); ctx.arc(0, 0, 11 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#65b957';
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI * 0.5 + performance.now() * 0.003;
          ctx.beginPath(); ctx.ellipse(Math.cos(a) * 3, Math.sin(a) * 3, 3.5, 2, a, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#e8ffb4'; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'shadowOrb' || pr.kind === 'shadowmote') {
        const mote = pr.kind === 'shadowmote';
        const pulse = 1 + Math.sin(performance.now() * 0.021 + pr.y * 0.04) * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = '#b56ee0'; ctx.beginPath(); ctx.arc(0, 0, (mote ? 9 : 12) * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#24172e'; ctx.beginPath(); ctx.arc(0, 0, mote ? 4.2 : 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c990f0'; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(0, -3); ctx.lineTo(-4, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f0d9ff'; ctx.fillRect(-1, -1, 2, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'frostbolt') {
        const pulse = 1 + Math.sin((pr.x + pr.y) * 0.025 + performance.now() * 0.012) * 0.12;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = '#71ddff';
        ctx.beginPath(); ctx.arc(0, 0, 10 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#dffcff';
        ctx.beginPath();
        ctx.moveTo(9, 0); ctx.lineTo(2, -4); ctx.lineTo(-7, -2);
        ctx.lineTo(-3, 0); ctx.lineTo(-7, 2); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#63d9ff';
        ctx.fillRect(-3, -1, 8, 2);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'aidanNova') {
        const pulse = 1 + Math.sin((pr.x + pr.y) * 0.018 + performance.now() * 0.014) * 0.16;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = '#a86bff';
        ctx.beginPath(); ctx.arc(0, 0, 12 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f2ddff';
        ctx.beginPath();
        ctx.moveTo(8, 0); ctx.lineTo(2, -2); ctx.lineTo(0, -8);
        ctx.lineTo(-2, -2); ctx.lineTo(-8, 0); ctx.lineTo(-2, 2);
        ctx.lineTo(0, 8); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b879ff'; ctx.fillRect(-2, -2, 4, 4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'aidanPulse') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#2e9cff';
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#d9fbff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = pr.color || '#8feaff';
        ctx.fillRect(-2, -2, 4, 4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'aidanFreeze') {
        const pulse = 1 + Math.sin((pr.x + pr.y) * 0.02 + performance.now() * 0.01) * 0.10;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.24 * pulse;
        ctx.fillStyle = '#31cfff';
        ctx.beginPath(); ctx.arc(0, 0, 11 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#217bd2';
        ctx.beginPath();
        ctx.moveTo(-10, 0); ctx.lineTo(-3, -3); ctx.lineTo(2, -7);
        ctx.lineTo(9, -3); ctx.lineTo(13, 0); ctx.lineTo(8, 3);
        ctx.lineTo(2, 7); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#9ef7ff';
        ctx.beginPath();
        ctx.moveTo(-8, 0); ctx.lineTo(-1, -2); ctx.lineTo(7, 0);
        ctx.lineTo(-1, 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f1ffff';
        ctx.fillRect(-3, -1, 7, 2);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = '#62eaff';
        for (let i = 0; i < 3; i++) {
          const x = -13 - i * 5;
          ctx.fillRect(x, -1 + i % 2, 3, 2);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'mechMissile') {
        const fuse = pr.burstTimer != null ? Math.max(0, pr.burstTimer) : 0;
        const blink = fuse < 1.2 ? (Math.sin(performance.now() * 0.03) > 0 ? 1 : 0.22) : 0.75;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.20 + blink * 0.16;
        ctx.fillStyle = '#ff9f4a';
        ctx.beginPath(); ctx.arc(-6, 0, 11 + blink * 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.82;
        ctx.fillStyle = '#ffd77e';
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(-5, -3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#273445';
        this._roundRect(ctx, -6, -4, 12, 8, 2); ctx.fill();
        ctx.fillStyle = '#61738a'; ctx.fillRect(-4, -3, 7, 2);
        ctx.fillStyle = '#d7e6ed';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -4); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#394b61';
        ctx.beginPath(); ctx.moveTo(-2, -4); ctx.lineTo(-5, -8); ctx.lineTo(2, -4); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-2, 4); ctx.lineTo(-5, 8); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = blink ? '#fff7c2' : '#ff7d46'; ctx.fillRect(-1, -2, 3, 3);
        ctx.restore();
        continue;
      }

      if (pr.kind === 'mechPlasma') {
        const pulse = 1 + Math.sin(performance.now() * 0.018 + pr.x * 0.04) * 0.16;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * pulse;
        ctx.fillStyle = pr.color || '#78e9ff';
        ctx.beginPath(); ctx.arc(0, 0, 11 * pulse, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = pr.color || '#78e9ff';
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -5); ctx.lineTo(-7, 0); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e9ffff'; ctx.fillRect(-1, -2, 5, 4);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'mechShock') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.20;
        ctx.fillStyle = '#ffd36d'; ctx.fillRect(-10, -6, 20, 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#c48543';
        ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(-3, -4); ctx.lineTo(7, -5); ctx.lineTo(11, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff2a8';
        ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(0, -2); ctx.lineTo(6, -2); ctx.lineTo(8, 2); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'poisonDart') {
        ctx.globalAlpha = 0.24;
        ctx.fillStyle = '#8be06f'; ctx.fillRect(-7, -3, 14, 6);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#d9ead0'; ctx.fillRect(-5, -1, 9, 2);
        ctx.fillStyle = '#799d4a'; ctx.fillRect(-5, -3, 2, 6);
        ctx.fillStyle = '#cde97d';
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.closePath(); ctx.fill();
        ctx.restore();
        continue;
      }

      if (pr.kind === 'aurora') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#8dffe0'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#58c9b4';
        ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -5); ctx.lineTo(6, 0); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ebfff8'; ctx.fillRect(-1, -2, 3, 3);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
        continue;
      }

      if (pr.kind === 'diamondSpear' || pr.kind === 'miniDiamondSpear') {
        const mini = pr.kind === 'miniDiamondSpear';
        const len = mini ? 8 : 25;
        const shaft = mini ? 1.4 : 2.4;
        ctx.globalAlpha = mini ? 0.25 : 0.38;
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, mini ? 5 : 13, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mini ? '#baf4ff' : '#f4ffff';
        ctx.lineWidth = shaft;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-len * 0.64, 0); ctx.lineTo(len * 0.55, 0); ctx.stroke();
        ctx.strokeStyle = mini ? '#4387a3' : '#2f6681';
        ctx.lineWidth = Math.max(1, shaft * 0.55);
        ctx.beginPath(); ctx.moveTo(-len * 0.65, 0); ctx.lineTo(-len * 0.25, 0); ctx.stroke();
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.moveTo(len * 0.62, 0);
        ctx.lineTo(len * 0.18, -len * (mini ? 0.28 : 0.24));
        ctx.lineTo(len * 0.30, 0);
        ctx.lineTo(len * 0.18, len * (mini ? 0.28 : 0.24));
        ctx.closePath(); ctx.fill();
        if (!mini) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.moveTo(-len * 0.58, 0); ctx.lineTo(-len * 0.78, -2.5); ctx.lineTo(-len * 0.78, 2.5); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        continue;
      }

      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(-6, -3, 12, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pr.color;
      if (pr.kind === 'arcwave') {
        // The greatblade's projected arc: a crescent rather than a bolt.
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = pr.color; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(0, 0, 11, -0.9, 0.9); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 11, -0.6, 0.6); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (pr.kind === 'arrow' || pr.kind === 'bolt' || pr.rangedKind === 'bow') {
        ctx.fillRect(-4, -1, 9, 2);
      } else {
        ctx.fillRect(-2, -2, 4, 4); ctx.fillStyle = '#fff'; ctx.fillRect(-1, -1, 2, 2);
      }
      ctx.restore();
    }
  }


  _drawFreezeOverlay(ctx, entity) {
    if (!entity || !(entity.freezeT > 0)) return;
    const cx = entity.x + entity.w / 2;
    const cy = entity.y + entity.h / 2;
    const t = entity.animTime != null ? entity.animTime : (entity.bob || 0);
    const pulse = 1 + Math.sin(t * 9) * 0.08;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#63eaff';
    ctx.fillRect(-entity.w * 0.55, -entity.h * 0.56, entity.w * 1.1, entity.h * 1.12);
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#bffcff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, (Math.max(entity.w, entity.h) * 0.72 + 5) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#2b9df2';
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(0, 0, (Math.max(entity.w, entity.h) * 0.88 + 8) * pulse, t * 2, t * 2 + Math.PI * 1.45);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = t * 1.3 + i * Math.PI / 3;
      const r = Math.max(entity.w, entity.h) * 0.74 + 4;
      const tip = r + 6 + Math.sin(t * 5 + i) * 1.5;
      ctx.fillStyle = i % 2 ? '#bffcff' : '#3ed8ff';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2));
      ctx.lineTo(Math.cos(a + 0.16) * tip, Math.sin(a + 0.16) * tip);
      ctx.lineTo(Math.cos(a - 0.12) * (r - 2), Math.sin(a - 0.12) * (r - 2));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  _drawEnemies(game, ctx) {
    for (const e of game.enemies) {
      // A malformed replicated enemy must not abort the whole canvas frame.
      // Keep the context isolated so a failed glow/gradient cannot brighten
      // the rest of the scene or hide the player.
      ctx.save();
      try {
      this._drawEnemyTelegraph(ctx, e);
      switch (e.key) {
        case 'slugling': this._drawSlugling(ctx, e); break;
        case 'boar': this._drawBoar(ctx, e); break;
        case 'husk': this._drawHusk(ctx, e); break;
        case 'duneStalker': this._drawDuneStalker(ctx, e); break;
        case 'rimeWisp': this._drawRimeWisp(ctx, e); break;
        case 'borealLynx': this._drawBorealLynx(ctx, e); break;
        case 'auroraWisp': this._drawAuroraWisp(ctx, e); break;
        case 'bat': this._drawBat(ctx, e); break;
        case 'crawler': this._drawCrawler(ctx, e); break;
        case 'bonepicker': this._drawBonepicker(ctx, e); break;
        case 'blightcrawler': this._drawBlightcrawler(ctx, e); break;
        case 'blightshade': this._drawBlightshade(ctx, e); break;
        default: this._drawUnknownEnemy(ctx, e); break;
      }
      if (e.hp < e.maxHp) this._miniHp(ctx, e, e.hp / e.maxHp, '#ff6b7d');
      if (e.freezeT > 0) this._drawFreezeOverlay(ctx, e);
      } catch (err) {
        if (e && !e._renderFaultReported) {
          e._renderFaultReported = true;
          console.warn('[Summoner Realms] skipped malformed enemy render', e.key, err);
        }
      } finally {
        // Never leak a glow blend mode into the rest of the scene.
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      }
    }
  }

  _enemyFrame(e, rate = 1) {
    const base = e.animTime != null ? e.animTime : (e.walkAnim || 0);
    const t = base * rate + ((e.netId || 0) % 31) * 0.37;
    const moving = Math.min(1, Math.abs(e.vx || 0) / Math.max(1, e.speed || 1));
    const charge = e.telegraph > 0 ? 1 - e.telegraph / (e.telegraphMax || 0.4) : 0;
    return {
      t,
      moving,
      charge,
      step: Math.sin(t * 8) * moving,
      bob: Math.sin(t * 2.3) * 1.2,
      airborne: !e.onGround || Math.abs(e.vy || 0) > 35,
    };
  }

  _enemyPose(ctx, e, draw) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(e.facing < 0 ? -1 : 1, 1);
    draw();
    ctx.restore();
  }

  _enemyShadow(ctx, e, scale = 1) {
    if (e.behavior === 'flyer' || e.key === 'rimeWisp' || e.key === 'auroraWisp' || e.key === 'blightshade') return;
    const air = Math.min(1, Math.abs(e.vy || 0) / 360);
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - air);
    ctx.fillStyle = '#08101a';
    ctx.beginPath();
    ctx.ellipse(e.x + e.w / 2, e.y + e.h + 2 + air * 5, Math.max(2, e.w * 0.48 * scale), Math.max(1, e.h * 0.11 * scale), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _enemyGlow(ctx, x, y, radius, color, alpha = 0.18) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * 0.65;
    ctx.beginPath(); ctx.arc(x, y, radius * 0.58, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _enemyFlashLocal(ctx, e, w, h, radius = 4) {
    if (e.hurtFlash <= 0) return;
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    this._roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(radius, w / 3)); ctx.fill();
  }

  _drawEnemyTelegraph(ctx, e) {
    if (!(e.telegraph > 0)) return;
    const k = 1 - e.telegraph / (e.telegraphMax || 0.4);
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.24 * Math.sin(k * Math.PI * 10);
    ctx.strokeStyle = e.color2 || '#ffcf6b';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(e.w, e.h) * 0.58 + k * 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = '#ffcf6b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 4 - k * 4, e.y - 4); ctx.lineTo(cx + 4 + k * 4, e.y - 4);
    ctx.stroke();
    ctx.restore();
  }

  _drawSlugling(ctx, e) {
    const f = this._enemyFrame(e, 1);
    this._enemyShadow(ctx, e, 0.85);
    this._enemyPose(ctx, e, () => {
      const jump = Math.max(0, Math.min(1, -(e.vy || 0) / 420));
      const squash = e.onGround ? 1 + Math.sin(f.t * 8) * 0.06 : 0.9;
      const stretch = e.onGround ? 1 : 1 + jump * 0.18;
      ctx.save();
      ctx.translate(0, 2 - jump * 2);
      ctx.scale(1 / squash, stretch);
      const w = 16, h = 12;
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 3);
      ctx.quadraticCurveTo(-w / 2 + 1, -4, -3, -5);
      ctx.quadraticCurveTo(1, -8, 5, -4);
      ctx.quadraticCurveTo(w / 2, -3, w / 2, 3);
      ctx.quadraticCurveTo(3, 7, -w / 2, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = e.color2;
      ctx.globalAlpha = 0.68;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 1, 3);
      ctx.quadraticCurveTo(0, 0, w / 2 - 1, 2);
      ctx.lineTo(w / 2 - 2, 5);
      ctx.quadraticCurveTo(0, 8, -w / 2 + 1, 4);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#b7df72';
      ctx.fillRect(-4, -4, 3, 2);
      ctx.fillStyle = '#f6f4d8';
      ctx.fillRect(2, -3, 3, 3);
      ctx.fillStyle = '#172216';
      ctx.fillRect(3, -2, 2, 2);
      ctx.strokeStyle = '#26351c';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(4, 2); ctx.quadraticCurveTo(1, 4, -1, 2); ctx.stroke();
      ctx.fillStyle = '#e9f1c2';
      ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(3, 5); ctx.lineTo(4, 2); ctx.closePath(); ctx.fill();
      this._enemyFlashLocal(ctx, e, 16, 12, 5);
      ctx.restore();
    });
  }

  _drawBoar(ctx, e) {
    const f = this._enemyFrame(e, 1);
    this._enemyShadow(ctx, e, 1);
    this._enemyPose(ctx, e, () => {
      const gait = f.step * 2.2;
      ctx.save();
      ctx.translate(0, f.bob * 0.35);
      ctx.strokeStyle = '#4a2b1d';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const leg of [[-7, 5, gait], [1, 5, -gait]]) {
        ctx.beginPath(); ctx.moveTo(leg[0], leg[1]); ctx.lineTo(leg[0] - 1, 9 + leg[2]); ctx.stroke();
      }
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.ellipse(-1, 0, 11, 7, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a96d42';
      ctx.beginPath(); ctx.ellipse(7, -1, 7, 5.5, -0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6d3f28';
      ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-6, -8); ctx.lineTo(-3, -4); ctx.lineTo(1, -7); ctx.lineTo(4, -3); ctx.stroke();
      ctx.fillStyle = '#6e3f27';
      ctx.beginPath(); ctx.moveTo(7, -5); ctx.lineTo(8, -9); ctx.lineTo(11, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8bd76';
      ctx.beginPath(); ctx.ellipse(13, 0, 3.2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#302016';
      ctx.fillRect(8, -3, 2, 2); ctx.fillRect(13, -1, 1, 1);
      ctx.strokeStyle = '#f3dfae';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(13, 4); ctx.stroke();
      ctx.strokeStyle = '#3f251b';
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(-15, -4, -12, -6); ctx.stroke();
      if (f.charge > 0) {
        ctx.strokeStyle = '#ff8c57';
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(-14, -7); ctx.lineTo(-18, -7); ctx.moveTo(-14, -3); ctx.lineTo(-19, -1); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffcf6b'; ctx.fillRect(8, -3, 2, 2);
      }
      this._enemyFlashLocal(ctx, e, 24, 16, 6);
      ctx.restore();
    });
  }

  _drawHusk(ctx, e) {
    const f = this._enemyFrame(e, 0.9);
    this._enemyShadow(ctx, e, 0.9);
    this._enemyPose(ctx, e, () => {
      const swing = f.step * 2.5;
      ctx.save();
      ctx.translate(0, f.bob * 0.25);
      ctx.strokeStyle = '#263021';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-3, 5); ctx.lineTo(-4 - swing, 11);
      ctx.moveTo(3, 5); ctx.lineTo(4 + swing, 11);
      ctx.moveTo(-5, -1); ctx.lineTo(-9 - swing * 0.5, 5);
      ctx.moveTo(5, -1); ctx.lineTo(9 + swing * 0.5, 5);
      ctx.stroke();
      ctx.fillStyle = '#4a5a3b';
      ctx.beginPath();
      ctx.moveTo(-6, -2); ctx.lineTo(-5, 9); ctx.lineTo(0, 12); ctx.lineTo(6, 9); ctx.lineTo(6, -2); ctx.lineTo(3, -6); ctx.lineTo(-3, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#78865b';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(-3, -3, 2, 10); ctx.fillRect(2, -2, 2, 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#a5a88e';
      ctx.beginPath(); ctx.arc(0, -8, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5a6249';
      ctx.fillRect(-5, -12, 10, 3);
      ctx.fillStyle = '#172017';
      ctx.fillRect(1, -9, 2, 2); ctx.fillRect(4, -9, 1, 2);
      ctx.strokeStyle = '#d4d2b8';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-3, -4); ctx.lineTo(3, -4); ctx.moveTo(-3, -1); ctx.lineTo(3, -1); ctx.stroke();
      if (f.charge > 0) {
        ctx.strokeStyle = '#bdcf7a';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-9, 5); ctx.lineTo(-11, 9); ctx.moveTo(9, 5); ctx.lineTo(11, 9); ctx.stroke();
      }
      this._enemyFlashLocal(ctx, e, 14, 24, 5);
      ctx.restore();
    });
  }

  _drawDuneStalker(ctx, e) {
    const f = this._enemyFrame(e, 1.1);
    this._enemyShadow(ctx, e, 0.95);
    this._enemyPose(ctx, e, () => {
      const gait = f.step * 1.8;
      ctx.save();
      ctx.translate(0, f.bob * 0.3);
      ctx.strokeStyle = '#6e542f';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (const leg of [[-6, 4, -gait], [-1, 5, gait], [4, 4, -gait]]) {
        ctx.beginPath(); ctx.moveTo(leg[0], leg[1]); ctx.lineTo(leg[0] - 2, 8 + leg[2]); ctx.lineTo(leg[0] + 1, 9 + leg[2]); ctx.stroke();
      }
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(-9, 3); ctx.lineTo(-5, -5); ctx.lineTo(3, -6); ctx.lineTo(9, -1); ctx.lineTo(6, 5); ctx.lineTo(-3, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = e.color2;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(-6, 1); ctx.lineTo(-3, -3); ctx.lineTo(4, -3); ctx.lineTo(6, 0); ctx.lineTo(2, 3); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#e5c57a';
      ctx.beginPath(); ctx.moveTo(5, -4); ctx.lineTo(10, -2); ctx.lineTo(7, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#25302a';
      ctx.fillRect(7, -2, 2, 2);
      ctx.fillStyle = '#d9ad5d';
      ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-4, -9); ctx.lineTo(-2, -5); ctx.moveTo(0, -5); ctx.lineTo(2, -9); ctx.lineTo(4, -5); ctx.fill();
      ctx.strokeStyle = '#d9ad5d';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-8, 2); ctx.lineTo(-12, 4); ctx.stroke();
      if (f.charge > 0) {
        ctx.fillStyle = 'rgba(255,207,107,0.45)';
        ctx.beginPath(); ctx.arc(0, 0, 12 + f.charge * 4, 0, Math.PI * 2); ctx.fill();
      }
      this._enemyFlashLocal(ctx, e, 18, 18, 6);
      ctx.restore();
    });
  }

  _drawRimeWisp(ctx, e) {
    const f = this._enemyFrame(e, 1);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + f.bob;
    this._enemyGlow(ctx, cx, cy, 13, '#bfe9ff', 0.15);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(f.t * 1.6) * 0.15);
    ctx.strokeStyle = '#8bd4ec';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, 5); ctx.quadraticCurveTo(-8, 11 + Math.sin(f.t) * 2, -3, 15);
    ctx.moveTo(2, 5); ctx.quadraticCurveTo(8, 11 - Math.sin(f.t) * 2, 3, 15);
    ctx.stroke();
    ctx.fillStyle = e.color2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 0); ctx.lineTo(0, 8); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 0); ctx.lineTo(0, 5); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e9fbff';
    ctx.fillRect(1, -2, 3, 3);
    ctx.fillStyle = '#47748a';
    ctx.fillRect(2, -1, 1, 2);
    ctx.strokeStyle = '#d4f7ff';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = f.t * 1.7 + i * Math.PI * 2 / 3;
      const r = 11;
      const sx = Math.cos(a) * r, sy = Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(sx, sy - 3); ctx.lineTo(sx + 3, sy); ctx.lineTo(sx, sy + 3); ctx.lineTo(sx - 3, sy); ctx.closePath(); ctx.stroke();
    }
    if (f.charge > 0) {
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.5 + f.charge * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, 11 + f.charge * 5, 0, Math.PI * 2); ctx.stroke();
    }
    this._enemyFlashLocal(ctx, e, 14, 16, 6);
    ctx.restore();
  }

  _drawBorealLynx(ctx, e) {
    const f = this._enemyFrame(e, 1.2);
    this._enemyShadow(ctx, e, 0.95);
    this._enemyPose(ctx, e, () => {
      const gait = f.step * 1.7;
      ctx.strokeStyle = '#5f7480'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-6, 4); ctx.lineTo(-7, 9 + gait);
      ctx.moveTo(-1, 5); ctx.lineTo(0, 9 - gait);
      ctx.moveTo(5, 4); ctx.lineTo(6, 9 + gait);
      ctx.stroke();
      // Long curled tail makes the silhouette immediately different from the
      // squat boar and dune stalker.
      ctx.strokeStyle = '#7698a8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-8, 1); ctx.quadraticCurveTo(-14, -3 - gait, -12, -8); ctx.stroke();
      ctx.strokeStyle = '#e6f4f5'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-9, 1); ctx.quadraticCurveTo(-13, -3 - gait, -12, -7); ctx.stroke();
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.ellipse(-1, 1, 9, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f5fdff'; ctx.beginPath(); ctx.ellipse(-1, 3, 6.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.color2;
      ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(8, -9); ctx.lineTo(10, -2); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(3, -9); ctx.lineTo(5, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b7d5dd'; ctx.fillRect(7, -5, 1, 2); ctx.fillRect(2, -5, 1, 2);
      ctx.fillStyle = '#203e44'; ctx.fillRect(8, -1, 2, 2);
      ctx.fillStyle = '#9be871'; ctx.fillRect(9, -1, 1, 1);
      ctx.strokeStyle = '#6e95a8'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-2, -3); ctx.moveTo(-6, 1); ctx.lineTo(-2, 0); ctx.stroke();
      if (f.charge > 0) {
        ctx.strokeStyle = '#d9fbff'; ctx.globalAlpha = 0.72;
        ctx.beginPath(); ctx.arc(0, 0, 12 + f.charge * 4, 0, Math.PI * 2); ctx.stroke();
      }
      this._enemyFlashLocal(ctx, e, 22, 16, 6);
    });
  }

  _drawAuroraWisp(ctx, e) {
    const f = this._enemyFrame(e, 1);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + f.bob;
    this._enemyGlow(ctx, cx, cy, 15, '#9dffe0', 0.16);
    ctx.save();
    ctx.translate(cx, cy);
    const sway = Math.sin(f.t * 2.2) * 1.4;
    ctx.strokeStyle = '#55c6b4'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, 4); ctx.quadraticCurveTo(-10, 8 + sway, -7, 15);
    ctx.moveTo(3, 4); ctx.quadraticCurveTo(10, 8 - sway, 7, 15);
    ctx.stroke();
    ctx.fillStyle = e.color2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, -1); ctx.lineTo(4, 9); ctx.lineTo(-4, 9); ctx.lineTo(-8, -1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, -1); ctx.lineTo(2, 6); ctx.lineTo(-3, 6); ctx.lineTo(-5, -1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#edfff8'; ctx.fillRect(1, -2, 2, 2);
    ctx.strokeStyle = '#c6ffec'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = f.t * 1.8 + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke();
    }
    if (f.charge > 0) {
      ctx.strokeStyle = '#e7fff6'; ctx.globalAlpha = 0.78;
      ctx.beginPath(); ctx.arc(0, 0, 12 + f.charge * 5, 0, Math.PI * 2); ctx.stroke();
    }
    this._enemyFlashLocal(ctx, e, 14, 18, 6);
    ctx.restore();
  }

  _drawBat(ctx, e) {
    const f = this._enemyFrame(e, 1);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + f.bob;
    const flap = Math.sin(f.t * 12) * 0.85;
    this._enemyGlow(ctx, cx, cy, 7, '#886eaa', 0.08);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = e.color2;
    ctx.beginPath();
    ctx.moveTo(-2, -1); ctx.lineTo(-11, -6 - flap * 4); ctx.lineTo(-7, 3 - flap * 2); ctx.lineTo(-2, 4); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2, -1); ctx.lineTo(11, -6 - flap * 4); ctx.lineTo(7, 3 - flap * 2); ctx.lineTo(2, 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, 0); ctx.lineTo(-8, -4 - flap * 4); ctx.moveTo(2, 0); ctx.lineTo(8, -4 - flap * 4); ctx.stroke();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.ellipse(2, 0, 4.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#342840';
    ctx.beginPath(); ctx.moveTo(-1, -4); ctx.lineTo(1, -9); ctx.lineTo(3, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e4b9ff';
    ctx.fillRect(4, -2, 2, 2);
    ctx.fillStyle = '#1b1424';
    ctx.fillRect(4, -2, 1, 1);
    ctx.fillStyle = '#f5e7ff';
    ctx.beginPath(); ctx.moveTo(3, 4); ctx.lineTo(5, 7); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
    this._enemyFlashLocal(ctx, e, 16, 10, 5);
    ctx.restore();
  }

  _drawCrawler(ctx, e) {
    const f = this._enemyFrame(e, 0.9);
    this._enemyShadow(ctx, e, 0.95);
    this._enemyPose(ctx, e, () => {
      const gait = f.step * 2;
      ctx.save();
      ctx.translate(0, f.bob * 0.25);
      ctx.strokeStyle = '#343946';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      for (const leg of [[-7, 3, -gait], [-2, 4, gait], [4, 3, -gait], [8, 2, gait]]) {
        ctx.beginPath(); ctx.moveTo(leg[0], leg[1]); ctx.lineTo(leg[0] - 2, 8 + leg[2]); ctx.lineTo(leg[0] + 1, 9 + leg[2]); ctx.stroke();
      }
      ctx.fillStyle = e.color2;
      ctx.beginPath(); ctx.ellipse(0, 0, 9.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = e.color;
      ctx.beginPath(); ctx.moveTo(-8, 1); ctx.lineTo(-5, -5); ctx.lineTo(0, -7); ctx.lineTo(6, -4); ctx.lineTo(9, 2); ctx.lineTo(4, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#aeb4c3';
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(0, -6); ctx.lineTo(2, -3); ctx.lineTo(-1, -1); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#343946';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(-1, 3); ctx.moveTo(3, -5); ctx.lineTo(4, 2); ctx.stroke();
      ctx.fillStyle = '#d9e6ff';
      ctx.fillRect(7, -2, 2, 2);
      ctx.fillStyle = '#1a2028';
      ctx.fillRect(8, -2, 1, 1);
      ctx.strokeStyle = '#b6c2d2';
      ctx.beginPath(); ctx.moveTo(9, 2); ctx.lineTo(11, 4); ctx.stroke();
      this._enemyFlashLocal(ctx, e, 20, 14, 6);
      ctx.restore();
    });
  }

  _drawBonepicker(ctx, e) {
    const f = this._enemyFrame(e, 0.85);
    this._enemyShadow(ctx, e, 0.9);
    this._enemyPose(ctx, e, () => {
      const swing = f.step * 2;
      ctx.save();
      ctx.translate(0, f.bob * 0.25);
      ctx.strokeStyle = '#bdbba8';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-3, 1); ctx.lineTo(-5 - swing, 10);
      ctx.moveTo(3, 1); ctx.lineTo(5 + swing, 10);
      ctx.moveTo(-5, -1); ctx.lineTo(-9 - swing, 4);
      ctx.moveTo(5, -1); ctx.lineTo(9 + swing, 4);
      ctx.stroke();
      ctx.fillStyle = '#d8d4c2';
      ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(-5, 5); ctx.lineTo(0, 8); ctx.lineTo(5, 5); ctx.lineTo(4, -1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#8c887a';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-3, 1); ctx.quadraticCurveTo(0, 3, 3, 1); ctx.moveTo(-3, 4); ctx.quadraticCurveTo(0, 6, 3, 4); ctx.stroke();
      ctx.fillStyle = '#ece7d8';
      ctx.beginPath(); ctx.arc(0, -7, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#656054';
      ctx.fillRect(-4, -11, 8, 2);
      ctx.fillStyle = '#302c27';
      ctx.fillRect(1, -8, 2, 2); ctx.fillRect(4, -8, 1, 2);
      ctx.strokeStyle = '#ece7d8';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(11, -6); ctx.moveTo(9, -8); ctx.lineTo(13, -4); ctx.stroke();
      if (f.charge > 0) {
        ctx.strokeStyle = '#ffcf6b';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(7, -1); ctx.lineTo(12, -7); ctx.stroke();
      }
      this._enemyFlashLocal(ctx, e, 16, 24, 5);
      ctx.restore();
    });
  }

  _drawBlightcrawler(ctx, e) {
    const f = this._enemyFrame(e, 1);
    this._enemyShadow(ctx, e, 1);
    this._enemyGlow(ctx, e.x + e.w / 2, e.y + e.h / 2, 11, '#b45de0', 0.12);
    this._enemyPose(ctx, e, () => {
      const gait = f.step * 1.7;
      ctx.save();
      ctx.translate(0, f.bob * 0.25);
      ctx.strokeStyle = '#3a2050';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const leg of [[-8, 3, -gait], [-4, 5, gait], [1, 5, -gait], [6, 3, gait]]) {
        ctx.beginPath(); ctx.moveTo(leg[0], leg[1]); ctx.lineTo(leg[0] - 2, 9 + leg[2]); ctx.lineTo(leg[0] + 1, 10 + leg[2]); ctx.stroke();
      }
      for (const seg of [[-6, 1, 6], [0, 0, 7], [6, -1, 6]]) {
        ctx.fillStyle = seg[2] > 6 ? e.color : e.color2;
        ctx.beginPath(); ctx.ellipse(seg[0], seg[1], seg[2], 4.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(245,190,255,0.35)';
        ctx.fillRect(seg[0] - 1, seg[1] - 3, 2, 2);
      }
      ctx.fillStyle = '#d879ef';
      ctx.beginPath(); ctx.ellipse(9, -1, 5, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe6ff';
      ctx.fillRect(10, -3, 2, 2);
      ctx.fillStyle = '#2b123b';
      ctx.fillRect(11, -3, 1, 1);
      ctx.strokeStyle = '#e6a2ff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(11, 1); ctx.lineTo(14, 3); ctx.moveTo(10, 1); ctx.lineTo(8, 4); ctx.stroke();
      ctx.strokeStyle = '#7a3a9b';
      ctx.beginPath();
      ctx.moveTo(-9, 0); ctx.quadraticCurveTo(-14, -5, -10, -8);
      ctx.moveTo(-7, 2); ctx.quadraticCurveTo(-13, 5, -10, 8);
      ctx.stroke();
      if (f.charge > 0) {
        ctx.strokeStyle = '#df8cff';
        ctx.globalAlpha = 0.75;
        ctx.beginPath(); ctx.arc(0, 0, 11 + f.charge * 5, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      this._enemyFlashLocal(ctx, e, 22, 16, 6);
      ctx.restore();
    });
  }

  _drawBlightshade(ctx, e) {
    const f = this._enemyFrame(e, 1);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2 + f.bob;
    this._enemyGlow(ctx, cx, cy, 16, '#c58bff', 0.16);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(e.facing < 0 ? -1 : 1, 1);
    const sway = Math.sin(f.t * 2) * 1.4;
    ctx.strokeStyle = '#5a2f7a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, 5); ctx.quadraticCurveTo(-10 + sway, 12, -7, 17);
    ctx.moveTo(4, 5); ctx.quadraticCurveTo(10 - sway, 12, 7, 17);
    ctx.stroke();
    ctx.fillStyle = e.color2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, -2); ctx.lineTo(6, 8); ctx.lineTo(0, 11); ctx.lineTo(-6, 8); ctx.lineTo(-8, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = e.color;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, -2); ctx.lineTo(4, 6); ctx.lineTo(0, 8); ctx.lineTo(-4, 6); ctx.lineTo(-5, -2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#201229';
    ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(7, 0, 0, 4); ctx.quadraticCurveTo(-7, 0, 0, -3); ctx.fill();
    ctx.fillStyle = '#f1b6ff';
    ctx.fillRect(1, -1, 2, 2);
    ctx.fillStyle = '#fff0ff';
    const pulse = 2 + Math.sin(f.t * 3) * 0.4 + f.charge * 1.2;
    ctx.beginPath(); ctx.arc(0, 5, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b45de0';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = f.t * 1.5 + i * Math.PI * 2 / 3;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8); ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.stroke();
    }
    if (f.charge > 0) {
      ctx.strokeStyle = '#f0baff'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, 12 + f.charge * 5, 0, Math.PI * 2); ctx.stroke();
    }
    this._enemyFlashLocal(ctx, e, 16, 22, 6);
    ctx.restore();
  }

  _drawUnknownEnemy(ctx, e) {
    const f = this._enemyFrame(e, 1);
    this._enemyShadow(ctx, e, 1);
    this._enemyPose(ctx, e, () => {
      ctx.fillStyle = e.color || '#8899aa';
      this._roundRect(ctx, -e.w / 2, -e.h / 2 + f.bob, e.w, e.h, 4); ctx.fill();
      ctx.fillStyle = e.color2 || '#445566';
      ctx.fillRect(-e.w / 2 + 2, 0, e.w - 4, e.h / 2 - 2);
      ctx.fillStyle = '#fff';
      ctx.fillRect(2, -2, 2, 2);
      this._enemyFlashLocal(ctx, e, e.w, e.h, 5);
    });
  }
  _drawDiamondBeamTelegraphs(game, ctx) {
    for (const m of game.minions) {
      if (m.dead || m.key !== 'diamondHeart' ||
          (!m.beamWindup && !m.beamActive) ||
          !m.beamLines?.length) continue;

      const active = m.beamActive > 0;
      const flash = m.beamFlash > 0;
      const color = active ? '#fff4b0' : flash ? '#ffd34e' : '#05070b';
      const y0 = m.beamY0 || 0;
      const y1 = m.beamY1 || 0;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const x of m.beamLines) {
        if (active) {
          // A broad glow plus a bright core keeps the full channel visibly
          // continuous instead of turning it into another telegraph flash.
          ctx.globalAlpha = 0.22;
          ctx.strokeStyle = '#ffe98a';
          ctx.lineWidth = 13;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        } else {
          // The telegraph is black, then turns yellow for 0.1s at each
          // 0.3s mark. It returns to black between flashes.
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = flash ? 0.96 : 0.9;
          ctx.strokeStyle = color;
          ctx.lineWidth = flash ? 3 : 2.5;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
          ctx.globalAlpha = flash ? 0.35 : 0.2;
          ctx.lineWidth = flash ? 10 : 6;
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  _drawMinions(game, ctx) {
    for (const m of game.minions) {
      if (m.dead) continue;
      if (m.key === 'aidan') drawAidan(ctx, m);
      else if (m.key === 'diamondHeart') this._drawDiamondHeart(ctx, m);
      else if (m.key === 'tideSprite' || m.key === 'verdantSprout' || m.key === 'shadowmoth') this._drawPrehardMinion(ctx, m);
      else this._blobCreature(ctx, m, m.color, m.color2, m.facing, m.hurtFlash > 0, true);
    }
    // Remote players' minion ghosts.
    for (const p of game.players.values()) {
      if (p.isLocal || !p.remoteMinions) continue;
      for (const rm of p.remoteMinions) {
        if (rm.dead) continue;
        if (rm.key === 'aidan') {
          drawAidan(ctx, Object.assign({
            w: 12, h: 26, color: '#c88b2e', color2: '#5a341d',
            anim: performance.now() / 1000 * 4.4, pose: rm.pose || 'idle', moveAmount: rm.mv || 0,
            hp: rm.hp, maxHp: rm.maxHp,
          }, rm, { x: rm.x, y: rm.y, facing: rm.f || 1 }));
        } else if (rm.key === 'diamondHeart') {
          this._drawDiamondHeart(ctx, Object.assign({
            w: 30, h: 42, color: '#dffcff', color2: '#62c9e8',
            anim: 0, hp: rm.hp, maxHp: rm.maxHp,
          }, rm, { x: rm.x, y: rm.y, facing: rm.f || 1 }));
        } else if (rm.key === 'tideSprite' || rm.key === 'verdantSprout' || rm.key === 'shadowmoth') {
          const remoteDef = rm.key === 'tideSprite'
            ? { w: 12, h: 12, color: '#4eb5d2', color2: '#9defff' }
            : rm.key === 'verdantSprout'
              ? { w: 16, h: 18, color: '#65b957', color2: '#b8f58a' }
              : { w: 16, h: 12, color: '#6f3d91', color2: '#d7a5ff' };
          this._drawPrehardMinion(ctx, Object.assign(remoteDef, rm, { x: rm.x, y: rm.y, facing: rm.f || 1 }));
        } else {
          const spr = { x: rm.x, y: rm.y, w: 14, h: 14 };
          this._blobCreature(ctx, spr, '#9ec3ff', '#cfe6ff', rm.f || 1, false, true);
        }
      }
    }
  }

  _drawPrehardMinion(ctx, m) {
    const x = m.x, y = m.y, w = m.w || 14, h = m.h || 14;
    const cx = x + w / 2, cy = y + h / 2;
    const t = m.anim || 0;
    const hurt = m.hurtFlash > 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = m.key === 'shadowmoth' ? '#b56ee0' : m.color2;
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(w, h) * 0.9 + Math.sin(t * 2) * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    if (m.key === 'tideSprite') {
      const bob = Math.sin(t * 2.4) * 2;
      ctx.translate(cx, cy + bob);
      ctx.fillStyle = '#1d607d';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, -2); ctx.lineTo(5, 6); ctx.lineTo(0, 9); ctx.lineTo(-5, 6); ctx.lineTo(-7, -2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4eb5d2';
      ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(5, -1); ctx.lineTo(3, 5); ctx.lineTo(0, 7); ctx.lineTo(-3, 5); ctx.lineTo(-5, -1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d9fbff'; ctx.fillRect(m.facing < 0 ? -4 : 2, -1, 2, 2);
      ctx.strokeStyle = '#9defff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 10, t % (Math.PI * 2), t % (Math.PI * 2) + 1.2); ctx.stroke();
    } else if (m.key === 'verdantSprout') {
      ctx.translate(cx, cy);
      ctx.fillStyle = '#3c6d37'; ctx.beginPath(); ctx.moveTo(-7, 8); ctx.lineTo(-5, -3); ctx.lineTo(0, -8); ctx.lineTo(5, -3); ctx.lineTo(7, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#65b957'; ctx.fillRect(-5, -2, 10, 10);
      ctx.fillStyle = '#b8f58a'; ctx.fillRect(-3, -1, 2, 2); ctx.fillRect(2, -1, 2, 2);
      ctx.strokeStyle = '#9fe875'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-11, -6); ctx.moveTo(5, 0); ctx.lineTo(11, -6); ctx.stroke();
      ctx.fillStyle = '#e1ffad'; ctx.fillRect(-12, -7, 3, 2); ctx.fillRect(9, -7, 3, 2);
      ctx.fillStyle = '#47713a'; ctx.fillRect(-8, 8, 16, 3);
    } else {
      const flap = Math.sin(t * 3.2) * 3;
      ctx.translate(cx, cy);
      ctx.fillStyle = '#6f3d91';
      ctx.beginPath(); ctx.moveTo(-2, -1); ctx.quadraticCurveTo(-13, -10 - flap, -9, 4); ctx.quadraticCurveTo(-5, 2, -1, 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, -1); ctx.quadraticCurveTo(13, -10 + flap, 9, 4); ctx.quadraticCurveTo(5, 2, 1, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d7a5ff'; ctx.fillRect(-7, -4, 4, 5); ctx.fillRect(3, -4, 4, 5);
      ctx.fillStyle = '#2c153b'; ctx.fillRect(-2, -5, 4, 10); ctx.fillStyle = '#f0cfff'; ctx.fillRect(m.facing < 0 ? -3 : 1, -2, 2, 2);
    }
    if (hurt) {
      ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(w, h) * 0.72, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (m.maxHp != null && m.hp != null) this._miniHp(ctx, m, m.hp / m.maxHp, m.color2 || '#7ee0c0');
  }

  _drawDiamondHeart(ctx, m) {
    const x = m.x, y = m.y, w = m.w || 30, h = m.h || 42;
    const cx = x + w / 2, cy = y + h / 2;
    const t = m.anim || 0;
    const flap = Math.sin(t * 2.6) * 3 + (m.dashTime > 0 ? 3 : 0);
    const swordAngle = m.dashTime > 0
      ? (m.dashAngle || 0)
      : (m.swordAngle != null ? m.swordAngle : (m.facing < 0 ? Math.PI : 0));

    // A small contact shadow and cool halo establish that it is airborne.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#081522';
    ctx.beginPath(); ctx.ellipse(cx, y + h + 13, 18, 3.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.12 + 0.04 * Math.sin(t * 2);
    ctx.fillStyle = '#62c9e8';
    ctx.beginPath(); ctx.arc(cx, cy, 34 + Math.sin(t * 1.7) * 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Faceted wings sit behind the body and flap on their own rhythm.
    ctx.save();
    ctx.translate(cx, cy - 4);
    for (const side of [-1, 1]) {
      const lift = flap * side;
      ctx.fillStyle = side < 0 ? '#6bc8e1' : '#7fe2f0';
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.moveTo(side * 7, 1);
      ctx.quadraticCurveTo(side * (18 + lift), -13, side * (31 + lift), -17);
      ctx.quadraticCurveTo(side * (27 + lift), -2, side * (18 + lift * 0.45), 9);
      ctx.lineTo(side * 7, 10);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#c9fbff'; ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(side * 9, 2); ctx.lineTo(side * (25 + lift), -12);
      ctx.moveTo(side * 11, 6); ctx.lineTo(side * (23 + lift), 0);
      ctx.stroke();
      ctx.fillStyle = '#dffcff';
      ctx.globalAlpha = 0.62;
      ctx.beginPath();
      ctx.moveTo(side * (21 + lift), -13);
      ctx.lineTo(side * (31 + lift), -17);
      ctx.lineTo(side * (26 + lift), -4);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // The great sword is intentionally oversized, but its facets keep it legible
    // instead of reading as a random rectangle.
    ctx.save();
    ctx.translate(cx + Math.cos(swordAngle) * 5, cy + Math.sin(swordAngle) * 5);
    ctx.rotate(swordAngle);
    const blade = m.dashTime > 0 ? 38 : 31;
    ctx.strokeStyle = 'rgba(20,48,65,0.7)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(blade, 0); ctx.stroke();
    ctx.fillStyle = '#dffcff';
    ctx.beginPath();
    ctx.moveTo(3, -3.2); ctx.lineTo(blade, 0); ctx.lineTo(3, 3.2);
    ctx.lineTo(9, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#7ccfe4';
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(blade, 0); ctx.lineTo(3, 3.2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f8ffff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(8, -1.3); ctx.lineTo(blade - 3, 0); ctx.stroke();
    ctx.strokeStyle = '#d5a95e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(1, -7); ctx.lineTo(1, 7); ctx.stroke();
    ctx.strokeStyle = '#6e4729'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(2, 0); ctx.stroke();
    ctx.restore();

    // Dash after-images make the move readable before the hit lands.
    if (m.dashTime > 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(m.dashAngle || 0);
      ctx.strokeStyle = m.dashVariant ? '#ffd86b' : '#8be9ff';
      ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.moveTo(-i * 10, -5 - i); ctx.lineTo(-i * 20, -5 - i); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-i * 10, 5 + i); ctx.lineTo(-i * 20, 5 + i); ctx.stroke();
      }
      ctx.restore();
    }

    // Spear wind-up: a compact, strongly aimed telegraph held in front of the
    // Heart, followed by the actual large projectile.
    if (m.spearWindup > 0 || m.spearPulse > 0) {
      const a = m.spearAngle || 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const k = m.spearWindup > 0 ? 1 - m.spearWindup / 0.3 : 0.55;
      ctx.globalAlpha = 0.3 + k * 0.45;
      ctx.strokeStyle = '#dffcff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(22 + k * 7, 0); ctx.stroke();
      ctx.fillStyle = '#dffcff';
      ctx.beginPath(); ctx.moveTo(28 + k * 7, 0); ctx.lineTo(20 + k * 7, -3); ctx.lineTo(20 + k * 7, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Crystal body and crown mask.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#17364c';
    ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(15, -4); ctx.lineTo(9, 19); ctx.lineTo(0, 23); ctx.lineTo(-9, 19); ctx.lineTo(-15, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#76d5e9';
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(11, -3); ctx.lineTo(6, 15); ctx.lineTo(0, 18); ctx.lineTo(-6, 15); ctx.lineTo(-11, -3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c9fbff'; ctx.globalAlpha = 0.78;
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(4, -3); ctx.lineTo(0, 13); ctx.lineTo(-3, -3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3b8fb0'; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(4, -3); ctx.lineTo(11, -3); ctx.lineTo(6, 15); ctx.lineTo(0, 18); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    // A small visor/face makes the silhouette read as a diamond version of the
    // player rather than as an unanimated gem.
    ctx.fillStyle = '#102538';
    ctx.beginPath(); ctx.moveTo(-7, -5); ctx.lineTo(7, -5); ctx.lineTo(5, 3); ctx.lineTo(-5, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(m.facing < 0 ? -5 : 2, -2, 2, 2);
    ctx.fillStyle = '#baf5ff';
    ctx.beginPath(); ctx.moveTo(-7, -17); ctx.lineTo(0, -24); ctx.lineTo(7, -17); ctx.lineTo(4, -14); ctx.lineTo(0, -19); ctx.lineTo(-4, -14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#4da7c2'; ctx.fillRect(-1, -20, 2, 6);
    ctx.restore();

    if (m.maxHp != null && m.hp != null) this._miniHp(ctx, m, m.hp / m.maxHp, '#7ee0c0');
    if (m.hurtFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.68)';
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  _blobCreature(ctx, e, color, color2, facing, flash, sparkle) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    ctx.fillStyle = color;
    this._roundRect(ctx, x, y, w, h, Math.min(5, w / 3));
    ctx.fill();
    ctx.fillStyle = color2 || '#000';
    ctx.globalAlpha = 0.35;
    this._roundRect(ctx, x + 1, y + h * 0.55, w - 2, h * 0.45, 3); ctx.fill();
    ctx.globalAlpha = 1;
    // eyes
    const ex = facing > 0 ? x + w * 0.58 : x + w * 0.22;
    ctx.fillStyle = '#fff'; ctx.fillRect(ex, y + h * 0.25, Math.max(2, w * 0.14), Math.max(2, h * 0.18));
    ctx.fillStyle = '#111'; ctx.fillRect(ex + (facing > 0 ? 1 : 0), y + h * 0.3, 2, 2);
    if (sparkle) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 1, y + 1, 2, 2); }
    if (flash) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; this._roundRect(ctx, x, y, w, h, 4); ctx.fill(); }
  }

  // ---- Friendly NPCs ----
  _drawNpc(game, ctx) {
    const npcs = game.npcs || (game.npc ? [game.npc] : []);
    for (const n of npcs) {
      if (!n || !n.alive) continue;
      if (n.kind === 'snowkeeper') this._drawSnowkeeper(game, ctx, n);
      else this._drawGuide(game, ctx, n);
    }
  }

  _drawGuide(game, ctx, n) {
    if (!n || !n.alive) return;
    const x = n.x, y = n.y + Math.sin(n.bob) * 0.7, w = n.w, h = n.h;
    const legSwing = Math.sin(n.walkAnim) * 3;
    // legs
    ctx.fillStyle = '#3a2f4a';
    ctx.fillRect(x + 1, y + h - 8 + Math.max(0, legSwing), 4, 8 - Math.max(0, legSwing));
    ctx.fillRect(x + w - 5, y + h - 8 + Math.max(0, -legSwing), 4, 8 - Math.max(0, -legSwing));
    // robe
    ctx.fillStyle = '#5b4a7a';
    this._roundRect(ctx, x - 1, y + 8, w + 2, h - 13, 3); ctx.fill();
    ctx.fillStyle = '#7a67a0';
    ctx.fillRect(x + w / 2 - 1, y + 9, 2, h - 15);
    // satchel strap
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(x - 1, y + 12, w + 2, 2);
    // head + hood
    ctx.fillStyle = '#e8c6a2';
    ctx.fillRect(x + 1, y + 1, w - 2, 8);
    ctx.fillStyle = '#463a63';
    ctx.fillRect(x, y - 1, w, 4);
    ctx.fillRect(n.facing > 0 ? x : x + w - 2, y - 1, 2, 7);
    // eye + a slow blink
    if (n.blink > 0) {
      ctx.fillStyle = '#2b2338';
      ctx.fillRect(n.facing > 0 ? x + w - 5 : x + 3, y + 4, 2, 2);
    }
    // beard
    ctx.fillStyle = '#d8d2e4';
    ctx.fillRect(x + 2, y + 8, w - 4, 3);

    // Draw the Guide's weak bow only during the wind-up. The bow and nocked
    // arrow rotate toward the live target, making the attack readable.
    if (n.shootWindup > 0) {
      const hx = x + w / 2 + Math.cos(n.shootAngle) * 4;
      const hy = y + 14 + Math.sin(n.shootAngle) * 4;
      const drawProgress = 1 - n.shootWindup / n.shootWindupMax;
      const pull = 2 + drawProgress * 3;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(n.shootAngle);
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 7, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.strokeStyle = '#e8e0cf';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, 7);
      ctx.stroke();
      ctx.strokeStyle = '#c9c0ae';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-pull, 0);
      ctx.lineTo(9, 0);
      ctx.stroke();
      ctx.fillStyle = '#e9e2c8';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(6, -1.3);
      ctx.lineTo(6, 1.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (n.hp < n.maxHp) this._miniHp(ctx, n, n.hp / n.maxHp, '#ff6b7d');
    if (n.hurtFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      this._roundRect(ctx, x, y, w, h, 4); ctx.fill();
    }

    // Talk prompt when the local player is close enough.
    const p = game.localPlayer;
    if (p && n.canTalkTo(p) && !(game.ui.npcDialog && game.ui.npcDialog.isOpen())) {
      const t = Math.sin(n.bob * 2) * 1.2;
      ctx.fillStyle = 'rgba(10,14,28,0.82)';
      this._roundRect(ctx, x + w / 2 - 13, y - 18 + t, 26, 11, 3); ctx.fill();
      ctx.strokeStyle = '#7ee0c0'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = '#7ee0c0';
      ctx.font = 'bold 7px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(game.controlMode === 'mobile' ? 'Talk' : 'F  Talk', x + w / 2, y - 10 + t);
      ctx.textAlign = 'left';
    }
  }

  _drawSnowkeeper(game, ctx, n) {
    const x = n.x, y = n.y + Math.sin(n.bob) * 0.65, w = n.w, h = n.h;
    const dir = n.facing < 0 ? -1 : 1;
    const cx = x + w / 2;
    const legSwing = Math.sin(n.walkAnim) * 2.6;
    const pulse = Math.sin(n.auraPulse || 0);

    // The old sprite was a few flat rectangles. Nivara now has a readable
    // silhouette: hood, fur trim, layered coat, scarf, satchel, gloves and a
    // lantern with a moving cold-light core. It stays pixel-crisp at native
    // world resolution, just like the rest of the game.
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = '#102238';
    ctx.beginPath(); ctx.ellipse(cx, y + h + 1, 10, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // A small pulse around her feet tells the player exactly when the passive
    // Hearthlight aura is active, without turning the whole biome into a ring.
    if (n.auraActive) {
      ctx.save();
      ctx.globalAlpha = 0.22 + pulse * 0.04;
      ctx.strokeStyle = '#b9f4ff'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.ellipse(cx, y + h - 1, 11 + pulse * 1.2, 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // A small pool of cold light makes the Hearthkeeper readable against white
    // snow without turning her into a full light source for the cave system.
    const lanternX = dir > 0 ? x + w + 4 : x - 4;
    const lanternY = y + 18;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.13 + pulse * 0.025;
    ctx.fillStyle = '#81eaff';
    ctx.beginPath(); ctx.arc(lanternX, lanternY + 1, 15 + pulse * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Back satchel and scarf tail give the profile a second layer when she
    // turns, so she does not read as a recoloured player placeholder.
    const packX = dir > 0 ? x - 2 : x + w - 4;
    ctx.fillStyle = '#183149';
    this._roundRect(ctx, packX, y + 13, 6, 12, 2); ctx.fill();
    ctx.fillStyle = '#6f9db5'; ctx.fillRect(packX + 1, y + 15, 4, 2);
    ctx.fillStyle = '#d8f8ff';
    const scarfTailX = dir > 0 ? x - 2 : x + w - 2;
    ctx.beginPath();
    ctx.moveTo(scarfTailX, y + 11);
    ctx.lineTo(scarfTailX + (dir > 0 ? -4 : 4), y + 18 + pulse * 1.1);
    ctx.lineTo(scarfTailX + (dir > 0 ? 1 : -1), y + 21);
    ctx.lineTo(scarfTailX + (dir > 0 ? 2 : -2), y + 12);
    ctx.closePath(); ctx.fill();

    // Boots and articulated legs.
    ctx.fillStyle = '#142337';
    ctx.fillRect(x + 3, y + h - 9 + Math.max(0, legSwing), 5, 8 - Math.max(0, legSwing));
    ctx.fillRect(x + w - 8, y + h - 9 + Math.max(0, -legSwing), 5, 8 - Math.max(0, -legSwing));
    ctx.fillStyle = '#314e68';
    ctx.fillRect(x + 2, y + h - 3, 7, 3);
    ctx.fillRect(x + w - 9, y + h - 3, 7, 3);

    // Dark coat silhouette followed by two blue panels and a pale fur hem.
    ctx.fillStyle = '#172a43';
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 12); ctx.lineTo(x + w - 3, y + 12);
    ctx.lineTo(x + w + 1, y + h - 8); ctx.lineTo(x + w - 2, y + h - 5);
    ctx.lineTo(x + 2, y + h - 5); ctx.lineTo(x - 1, y + h - 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#315e7f';
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 13); ctx.lineTo(cx, y + 15); ctx.lineTo(cx - 1, y + h - 7);
    ctx.lineTo(x + 2, y + h - 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3f7898';
    ctx.beginPath();
    ctx.moveTo(cx, y + 15); ctx.lineTo(x + w - 4, y + 13); ctx.lineTo(x + w + 0, y + h - 8);
    ctx.lineTo(cx + 1, y + h - 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b9e9f2';
    ctx.beginPath();
    ctx.moveTo(x + 1, y + h - 8); ctx.lineTo(x + w - 1, y + h - 8);
    ctx.lineTo(x + w - 3, y + h - 5); ctx.lineTo(x + 2, y + h - 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b3853'; ctx.fillRect(cx - 1, y + 16, 2, h - 23);
    ctx.fillStyle = '#d8f8ff'; ctx.fillRect(x + 4, y + 20, w - 8, 1);

    // Belt, buckle and the two mittened arms.
    ctx.fillStyle = '#8fb6c4'; ctx.fillRect(x + 2, y + 23, w - 4, 2);
    ctx.fillStyle = '#f1d37d'; ctx.fillRect(cx - 2, y + 22, 4, 4);
    ctx.fillStyle = '#21445f';
    this._roundRect(ctx, x - 3, y + 14, 5, 10, 2); ctx.fill();
    this._roundRect(ctx, x + w - 2, y + 14, 5, 10, 2); ctx.fill();
    ctx.fillStyle = '#d8f8ff';
    ctx.fillRect(dir > 0 ? x + w - 1 : x - 2, y + 22, 4, 3);

    // Face framed by a deep hood and a thick, irregular fur trim.
    ctx.fillStyle = '#1c334e';
    this._roundRect(ctx, x + 1, y - 1, w - 2, 16, 5); ctx.fill();
    ctx.fillStyle = '#315d79';
    this._roundRect(ctx, x + 3, y + 1, w - 6, 12, 4); ctx.fill();
    ctx.fillStyle = '#ead5bd';
    this._roundRect(ctx, x + 5, y + 4, w - 10, 10, 3); ctx.fill();
    ctx.fillStyle = '#7e9db0';
    ctx.fillRect(x + 3, y + 10, w - 6, 3);
    ctx.fillStyle = '#edfaff';
    ctx.fillRect(x + 2, y + 11, 4, 2); ctx.fillRect(x + w - 6, y + 11, 4, 2);
    // Hair, brow, eye and a tiny nose point toward the player's side.
    ctx.fillStyle = '#5d4758';
    ctx.fillRect(dir > 0 ? x + 5 : x + w - 8, y + 4, 3, 5);
    ctx.fillStyle = '#344259';
    const eyeX = dir > 0 ? x + w - 8 : x + 6;
    ctx.fillRect(eyeX, y + 7, 3, 1);
    if (n.blink > 0) { ctx.fillStyle = '#18253a'; ctx.fillRect(eyeX + (dir > 0 ? 1 : 0), y + 8, 2, 2); }
    ctx.fillStyle = '#d09d88'; ctx.fillRect(dir > 0 ? x + w - 5 : x + 3, y + 9, 2, 2);
    ctx.fillStyle = '#d28b98'; ctx.fillRect(dir > 0 ? x + w - 8 : x + 5, y + 11, 2, 1);

    // Frost-star brooch and crystal trim make her role legible even when the
    // player is not close enough to read her name.
    ctx.fillStyle = '#e8ffff';
    ctx.fillRect(cx - 1, y + 17, 2, 7); ctx.fillRect(cx - 3, y + 19, 6, 2);
    ctx.fillStyle = '#76dced'; ctx.fillRect(cx - 1, y + 19, 2, 2);

    // The signature hearth-lantern: handle, metal frame, four bright panes and
    // an animated core that matches the aura.
    ctx.strokeStyle = '#b9f4ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(lanternX, lanternY - 4, 4, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = '#2d6680';
    this._roundRect(ctx, lanternX - 4, lanternY - 1, 8, 10, 2); ctx.fill();
    ctx.fillStyle = '#79ddf2'; ctx.fillRect(lanternX - 3, lanternY, 6, 7);
    ctx.fillStyle = '#efffff'; ctx.fillRect(lanternX - 1, lanternY + 1, 2, 5);
    ctx.fillStyle = '#9cecff'; ctx.fillRect(lanternX - 4, lanternY + 7, 8, 2);
    ctx.fillStyle = '#173149'; ctx.fillRect(lanternX - 1, lanternY - 3, 2, 2);

    // Three tiny motes orbit the lantern. They are deterministic, cheap, and
    // give the sprite life even while she is standing still.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = (n.auraPulse || 0) + i * 2.1;
      const mx = lanternX + Math.cos(a) * (7 + i * 1.5);
      const my = lanternY + Math.sin(a) * (5 + i);
      ctx.globalAlpha = 0.38 + i * 0.12;
      ctx.fillStyle = i === 1 ? '#ffffff' : '#9cecff';
      ctx.fillRect(mx - 1, my - 1, 2, 2);
    }
    ctx.restore();

    // When Nivara answers a threat, the lantern unfolds into a small frost
    // focus. Showing the wind-up makes it obvious that she is defending herself
    // rather than silently dealing damage from an invisible source.
    if (n.shootWindup > 0) {
      const progress = 1 - n.shootWindup / Math.max(0.01, n.shootWindupMax);
      const focusX = cx + Math.cos(n.shootAngle) * 5;
      const focusY = y + 18 + Math.sin(n.shootAngle) * 5;
      ctx.save();
      ctx.translate(focusX, focusY);
      ctx.rotate(n.shootAngle);
      ctx.strokeStyle = '#b9f4ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(-3, 7); ctx.stroke();
      ctx.fillStyle = '#2d6680'; ctx.fillRect(-5, 3, 4, 5);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + progress * 0.35;
      ctx.fillStyle = '#dffcff';
      ctx.beginPath(); ctx.arc(1, 0, 3 + progress * 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#76dced'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(1, 0, 5 + progress * 4, -0.8, 0.8); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }

    if (n.hp < n.maxHp) this._miniHp(ctx, n, n.hp / n.maxHp, '#ff6b7d');
    if (n.hurtFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      this._roundRect(ctx, x, y, w, h, 4); ctx.fill();
    }

    const p = game.localPlayer;
    if (p && n.canTalkTo(p) && !(game.ui.npcDialog && game.ui.npcDialog.isOpen())) {
      const t = Math.sin(n.bob * 2) * 1.2;
      ctx.fillStyle = 'rgba(10,14,28,0.86)';
      this._roundRect(ctx, x + w / 2 - 20, y - 18 + t, 40, 11, 3); ctx.fill();
      ctx.strokeStyle = '#b9f4ff'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = '#b9f4ff';
      ctx.font = 'bold 7px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(game.controlMode === 'mobile' ? 'Talk' : 'F  Talk', x + w / 2, y - 10 + t);
      ctx.textAlign = 'left';
    }
  }

  _drawBosses(game, ctx) {
    for (const b of game.bosses) {
      // A boss underground or mid-teleport is hidden; only its tells show.
      if (b.hidden) { this._drawBossWarning(ctx, b); continue; }
      ctx.save();
      // Anticipation: squash while winding up, stretch while committing.
      const sx = b.squashX != null ? b.squashX : 1;
      const sy = b.squashY != null ? b.squashY : 1;
      if (sx !== 1 || sy !== 1) {
        const cx = b.x + b.w / 2, cy = b.y + b.h;
        ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-cx, -cy);
      }
      if (b.key === 'theMech') this._drawTheMech(ctx, b);
      else if (b.key === 'grovekeeper') this._drawGrovekeeper(ctx, b);
      else if (b.key === 'gravemaw') this._drawGravemaw(ctx, b);
      else this._drawBlightSovereign(ctx, b);
      ctx.restore();
      if (b.freezeT > 0) this._drawFreezeOverlay(ctx, b);
      this._drawBossWarning(ctx, b);
    }
  }

  // The marker that appears where a boss is about to emerge, so a burrow or
  // teleport is something the player can react to rather than a random ambush.
  _drawBossWarning(ctx, b) {
    if (!b.warnAt || b.warnTime <= 0) return;
    const k = 1 - b.warnTime / (b.warnMax || 0.6);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * Math.sin(k * Math.PI * 8);
    ctx.strokeStyle = b.color2 || '#ffcf6b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.warnAt.x, b.warnAt.y, 10 + k * 22, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.warnAt.x - 7, b.warnAt.y - 7); ctx.lineTo(b.warnAt.x + 7, b.warnAt.y + 7);
    ctx.moveTo(b.warnAt.x + 7, b.warnAt.y - 7); ctx.lineTo(b.warnAt.x - 7, b.warnAt.y + 7);
    ctx.stroke();
    ctx.restore();
  }

  _bossAura(ctx, b, color, radius) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.13 + 0.06 * Math.sin(b.bob * 2);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // Charging tell: a ring that tightens onto the boss during the wind-up.
    if (b.telegraph > 0) {
      const k = b.telegraph / (b.telegraphMax || 0.6);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35 + 0.4 * (1 - k);
      ctx.lineWidth = 2 + (1 - k) * 2;
      ctx.beginPath(); ctx.arc(cx, cy, radius + k * 34, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.attackPulse > 0) {
      ctx.strokeStyle = color; ctx.globalAlpha = b.attackPulse / 0.22;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, radius + (0.22 - b.attackPulse) * 30, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // The Mech — an enormous, grounded siege machine. Its body is deliberately
  // broad and heavy; the only free-tracking silhouette during Plasma Ray is
  // the pair of arms plus their shared cannon.
  _drawTheMech(ctx, b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const cx = x + w / 2;
    const f = b.facing === -1 ? -1 : 1;
    const walk = b.walkCycle || b.bob || 0;
    const heat = clamp(b.mechHeat || 0, 0, 1);
    const phaseTwo = heat > 0.3 || b.phaseName === 'Overdrive';
    const coreColor = phaseTwo ? '#ffb35d' : '#72ddff';
    const coreBright = phaseTwo ? '#fff0b3' : '#e7ffff';
    const charge = b.telegraph > 0 ? 1 - b.telegraph / (b.telegraphMax || 0.6) : 0;
    const ray = b.mechRay;

    ctx.save();
    this._bossAura(ctx, b, phaseTwo ? '#ffbd68' : '#72ddff', 76);

    // Anchoring shadow and overdrive exhaust.
    ctx.fillStyle = 'rgba(5,10,16,0.30)';
    ctx.beginPath(); ctx.ellipse(cx, y + h + 3, w * 0.47, 7, 0, 0, Math.PI * 2); ctx.fill();
    if (phaseTwo) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + Math.sin(b.bob * 8) * 0.04;
      ctx.fillStyle = '#ff8d4c';
      ctx.beginPath(); ctx.arc(cx, y + 47, 51, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Pistoned legs sit behind the torso. Opposite stride offsets make the
    // machine read as walking even at its intentionally slow pace.
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const stride = Math.sin(walk + i * Math.PI) * 5.5;
      const hipX = cx + side * 28;
      const hipY = y + 73;
      const kneeX = hipX + side * 5 + stride * 0.45;
      const kneeY = y + 91 - Math.max(0, stride) * 0.28;
      const footX = hipX + stride;
      const footY = y + h - 5;
      ctx.strokeStyle = '#1f2a37'; ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
      ctx.strokeStyle = '#50677a'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke();
      ctx.strokeStyle = '#a9c1cf'; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hipX - side, hipY + 2); ctx.lineTo(kneeX - side, kneeY - 1); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#263442'; this._roundRect(ctx, footX - 14, footY - 4, 28, 9, 3); ctx.fill();
      ctx.fillStyle = '#8097a7'; this._roundRect(ctx, footX - 11, footY - 4, 18, 3, 1); ctx.fill();
      ctx.fillStyle = '#b8d2db'; ctx.beginPath(); ctx.arc(kneeX, kneeY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#334353'; ctx.beginPath(); ctx.arc(kneeX, kneeY, 2, 0, Math.PI * 2); ctx.fill();
    }

    // Back vents, shoulder pylons, and the large arm sockets.
    ctx.fillStyle = '#1f2d3a'; this._roundRect(ctx, x + 8, y + 28, w - 16, 57, 15); ctx.fill();
    ctx.fillStyle = '#3d5366'; this._roundRect(ctx, x + 11, y + 25, w - 22, 58, 13); ctx.fill();
    ctx.fillStyle = '#6b8494'; this._roundRect(ctx, x + 16, y + 28, w - 32, 15, 7); ctx.fill();
    ctx.fillStyle = 'rgba(219,242,246,0.44)'; this._roundRect(ctx, x + 20, y + 30, w - 41, 4, 2); ctx.fill();
    for (const side of [-1, 1]) {
      const sx = cx + side * 47;
      ctx.fillStyle = '#23313f'; this._roundRect(ctx, sx - 11, y + 34, 22, 31, 6); ctx.fill();
      ctx.fillStyle = '#60788a'; this._roundRect(ctx, sx - 8, y + 37, 16, 22, 4); ctx.fill();
      ctx.fillStyle = phaseTwo ? '#ff9e57' : '#69cce7'; ctx.fillRect(sx - 3, y + 40, 6, 3);
    }

    // Central armor, chest plate and glowing reactor.
    ctx.fillStyle = '#314556'; this._roundRect(ctx, x + 25, y + 39, w - 50, 47, 10); ctx.fill();
    ctx.fillStyle = '#536b7b'; this._roundRect(ctx, x + 29, y + 43, w - 58, 38, 8); ctx.fill();
    ctx.fillStyle = '#273744'; this._roundRect(ctx, cx - 18, y + 50, 36, 27, 6); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 + charge * 0.20 + heat * 0.10;
    ctx.fillStyle = coreColor; ctx.beginPath(); ctx.arc(cx, y + 63, 21 + charge * 6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = coreColor; ctx.beginPath(); ctx.arc(cx, y + 63, 10 + Math.sin(b.bob * 6) * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = coreBright; ctx.beginPath(); ctx.arc(cx - 3, y + 60, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#14222d'; ctx.fillRect(cx - 2, y + 60, 4, 7);
    ctx.fillStyle = '#b3cbd7'; ctx.fillRect(x + 32, y + 48, 11, 2); ctx.fillRect(x + w - 43, y + 48, 11, 2);
    ctx.fillStyle = '#20313f'; ctx.fillRect(x + 34, y + 75, 13, 3); ctx.fillRect(x + w - 47, y + 75, 13, 3);

    // Cockpit / head is a fixed armored crown; the bright visor is the best
    // long-distance read on the machine's current facing.
    ctx.save();
    ctx.translate(cx, y + 28); ctx.scale(f, 1);
    ctx.fillStyle = '#202f3c'; this._roundRect(ctx, -25, -15, 50, 26, 9); ctx.fill();
    ctx.fillStyle = '#627b8d'; this._roundRect(ctx, -21, -13, 42, 13, 6); ctx.fill();
    ctx.fillStyle = '#a8c3cf'; this._roundRect(ctx, -16, -11, 27, 4, 2); ctx.fill();
    ctx.fillStyle = '#162430'; this._roundRect(ctx, -15, -4, 30, 8, 3); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.30 + charge * 0.35;
    ctx.fillStyle = coreColor; ctx.fillRect(1, -6, 22, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = coreBright; ctx.fillRect(5, -3, 13, 3);
    ctx.fillStyle = '#20303c'; ctx.fillRect(13, -3, 3, 3);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // A missile pod only opens on the leading arm. Its split hatch is a
    // direct animation tell before the homing missile launches.
    const podOpen = clamp(b.mechArmOpen || 0, 0, 1);
    ctx.save();
    ctx.translate(cx + f * 46, y + 47); ctx.scale(f, 1);
    ctx.fillStyle = '#1d2a35'; this._roundRect(ctx, -10, -11, 25, 22, 5); ctx.fill();
    ctx.fillStyle = '#587083'; this._roundRect(ctx, -7, -8, 19, 16, 3); ctx.fill();
    if (podOpen > 0.04) {
      ctx.save(); ctx.translate(4, -5); ctx.rotate(-podOpen * 0.95); ctx.fillStyle = '#2d4050'; this._roundRect(ctx, -4, -13, 12, 8, 2); ctx.fill(); ctx.restore();
      ctx.save(); ctx.translate(4, 5); ctx.rotate(podOpen * 0.95); ctx.fillStyle = '#2d4050'; this._roundRect(ctx, -4, 5, 12, 8, 2); ctx.fill(); ctx.restore();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.30 + podOpen * 0.35; ctx.fillStyle = '#ffad55'; ctx.beginPath(); ctx.arc(8, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffb15a'; ctx.fillRect(3, -3, 9, 6); ctx.fillStyle = '#fff0bd'; ctx.fillRect(9, -2, 3, 3);
    } else {
      ctx.fillStyle = '#9bb5c1'; ctx.fillRect(4, -5, 7, 3); ctx.fillRect(4, 2, 7, 3);
    }
    ctx.restore();

    if (ray) {
      // Both arms move as a linked mount. The chassis above stays still while
      // the wrists, cannon and muzzle sweep toward the player's position.
      const a = ray.angle || 0;
      const wristX = cx + Math.cos(a) * 23;
      const wristY = y + 43 + Math.sin(a) * 23;
      for (const side of [-1, 1]) {
        const sx = cx + side * 37, sy = y + 43;
        ctx.strokeStyle = '#1c2935'; ctx.lineWidth = 12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wristX, wristY); ctx.stroke();
        ctx.strokeStyle = '#7490a2'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(wristX, wristY); ctx.stroke();
        ctx.fillStyle = '#d1e2e5'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(cx + Math.cos(a) * 34, y + 43 + Math.sin(a) * 34); ctx.rotate(a);
      ctx.fillStyle = '#172531'; this._roundRect(ctx, -12, -9, 43, 18, 5); ctx.fill();
      ctx.fillStyle = '#5f8195'; this._roundRect(ctx, -8, -6, 32, 12, 3); ctx.fill();
      ctx.fillStyle = '#b2d5df'; ctx.fillRect(-5, -5, 19, 3);
      ctx.fillStyle = '#20313d'; this._roundRect(ctx, 21, -12, 14, 24, 3); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + (b.mechRayCharge || 0) * 0.35; ctx.fillStyle = '#75e8ff'; ctx.beginPath(); ctx.arc(32, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#e9ffff'; ctx.fillRect(28, -3, 7, 6); ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      // Stowed hands retain a visible silhouette outside of the ray attack.
      for (const side of [-1, 1]) {
        const sx = cx + side * 39, sy = y + 55;
        ctx.strokeStyle = '#22313e'; ctx.lineWidth = 10; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, y + 43); ctx.lineTo(sx + side * 7, sy); ctx.stroke();
        ctx.strokeStyle = '#7892a3'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(sx, y + 43); ctx.lineTo(sx + side * 7, sy); ctx.stroke();
        ctx.fillStyle = '#bcced4'; ctx.beginPath(); ctx.arc(sx + side * 7, sy, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Every major move has a local, readable tell: braced feet for the leap,
    // bright pod for missiles, and a charged core/cannon for the Plasma Ray.
    if (b.mechJumpCharge > 0.06) {
      const k = b.mechJumpCharge;
      ctx.strokeStyle = '#ffd36d'; ctx.globalAlpha = 0.35 + k * 0.45; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, y + h - 1, 37 + k * 20, 8 + k * 4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.mechLanding > 0.02) {
      ctx.strokeStyle = '#ffdf8d'; ctx.globalAlpha = b.mechLanding * 0.8; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cx, y + h, 54 - b.mechLanding * 12, 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.hurtFlash > 0) {
      ctx.globalAlpha = 0.36 + b.hurtFlash * 2;
      ctx.fillStyle = '#ffffff'; this._roundRect(ctx, x + 8, y + 13, w - 16, h - 17, 15); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (b.invuln > 0) {
      ctx.strokeStyle = '#e9ffff'; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      this._roundRect(ctx, x + 4, y + 5, w - 8, h - 3, 17); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }


  _drawGrovekeeper(ctx, b) {
    const lean = clamp((b.vx || 0) / 260, -0.5, 0.5);
    const sway = Math.sin(b.bob * 1.25) * 2.2;
    const x = b.x, y = b.y + Math.sin(b.bob) * 3, w = b.w, h = b.h;
    const cx = x + w / 2;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 40);

    // Roots and the moving shadow anchor the floating tree to the world.
    ctx.fillStyle = 'rgba(8,16,12,0.24)';
    ctx.beginPath(); ctx.ellipse(cx, y + h + 5, 21, 4, 0, 0, Math.PI * 2); ctx.fill();

    // Branch arms sit behind the body and sway independently from the canopy.
    ctx.save();
    ctx.translate(cx, y + 27);
    ctx.rotate(-lean * 0.34);
    ctx.translate(-cx, -(y + 27));
    ctx.strokeStyle = '#263f28';
    ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, y + 30); ctx.lineTo(cx - 14, y + 12); ctx.lineTo(cx - 21, y + 5);
    ctx.moveTo(cx, y + 25); ctx.lineTo(cx + 15, y + 10); ctx.lineTo(cx + 23, y + 1);
    ctx.moveTo(cx - 13, y + 13); ctx.lineTo(cx - 22, y + 15);
    ctx.moveTo(cx + 14, y + 11); ctx.lineTo(cx + 23, y + 12);
    ctx.stroke();
    ctx.strokeStyle = '#6d9d4c'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 1, y + 28); ctx.lineTo(cx - 14, y + 13);
    ctx.moveTo(cx + 1, y + 25); ctx.lineTo(cx + 15, y + 11);
    ctx.stroke();
    ctx.restore();

    // Layered canopy clusters give the boss a readable silhouette at a distance.
    const leaves = [
      [cx - 20 + sway, y + 3, 11, '#3e8740'],
      [cx + 20 + sway * 0.5, y + 2, 12, '#4b9b45'],
      [cx - 8 + sway * 0.7, y - 2, 14, '#5fae4a'],
      [cx + 8 - sway * 0.4, y - 3, 14, '#6fbf55'],
      [cx + sway, y - 9, 10, '#78c85b'],
    ];
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      ctx.fillStyle = leaf[3];
      ctx.beginPath(); ctx.ellipse(leaf[0], leaf[1], leaf[2], leaf[2] * 0.82, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(24,54,28,0.26)';
      ctx.beginPath(); ctx.ellipse(leaf[0] + 3, leaf[1] + 4, leaf[2] * 0.7, leaf[2] * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(193,235,126,0.48)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(leaf[0] - leaf[2] * 0.45, leaf[1] - 1); ctx.lineTo(leaf[0] + leaf[2] * 0.35, leaf[1] - 3); ctx.stroke();
    }

    // Hanging vines react to motion and to the attack wind-up.
    ctx.strokeStyle = '#3b773d'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const vx = cx - 20 + i * 13;
      const length = 7 + (i % 2) * 4 + (b.telegraph > 0 ? 3 : 0);
      ctx.beginPath();
      ctx.moveTo(vx, y + 7);
      ctx.quadraticCurveTo(vx + Math.sin(b.bob + i) * 3, y + 11, vx + sway * (i % 2 ? -0.4 : 0.4), y + length);
      ctx.stroke();
    }

    // Carved trunk, bark plates, knots, and roots.
    ctx.fillStyle = '#4d3024';
    ctx.beginPath();
    ctx.moveTo(cx - 13, y + 17); ctx.lineTo(cx - 10, y + h - 8);
    ctx.quadraticCurveTo(cx, y + h - 3, cx + 11, y + h - 8);
    ctx.lineTo(cx + 13, y + 17); ctx.quadraticCurveTo(cx, y + 12, cx - 13, y + 17); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#815236';
    ctx.beginPath();
    ctx.moveTo(cx - 6, y + 18); ctx.quadraticCurveTo(cx - 2, y + 27, cx - 4, y + h - 10);
    ctx.lineTo(cx + 1, y + h - 7); ctx.lineTo(cx + 2, y + 20); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#b17a46'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - 9, y + 25); ctx.quadraticCurveTo(cx - 4, y + 23, cx - 7, y + 19);
    ctx.moveTo(cx + 7, y + 35); ctx.quadraticCurveTo(cx + 2, y + 38, cx + 6, y + 44);
    ctx.stroke();
    ctx.fillStyle = '#281d19';
    ctx.beginPath(); ctx.ellipse(cx - 4, y + 31, 2.5, 3, -0.2, 0, Math.PI * 2); ctx.fill();

    // Eyes brighten during every attack tell.
    const eye = b.telegraph > 0 ? '#fff4b0' : '#ffcf6b';
    ctx.fillStyle = '#1b271c';
    ctx.fillRect(cx - 11, y + 28, 8, 6); ctx.fillRect(cx + 3, y + 28, 8, 6);
    ctx.fillStyle = eye;
    ctx.fillRect(cx - 9, y + 29, 4, 3); ctx.fillRect(cx + 5, y + 29, 4, 3);
    ctx.fillStyle = '#273620';
    ctx.fillRect(cx - 7, y + 30, 2, 2); ctx.fillRect(cx + 5, y + 30, 2, 2);

    ctx.strokeStyle = '#264f2b'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 13, y + h - 7); ctx.quadraticCurveTo(cx - 19, y + h - 2, cx - 24, y + h - 4);
    ctx.moveTo(cx + 13, y + h - 7); ctx.quadraticCurveTo(cx + 19, y + h - 2, cx + 24, y + h - 4);
    ctx.stroke();

    if (b.telegraph > 0) {
      const k = 1 - b.telegraph / (b.telegraphMax || 0.6);
      ctx.strokeStyle = '#d7f58a'; ctx.globalAlpha = 0.45 + k * 0.45; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, y + 28, 18 + k * 10, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
      ctx.fillStyle = 'rgba(167,227,111,0.26)';
      ctx.beginPath(); ctx.arc(cx, y + 25, 24 + k * 5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.52)'; this._roundRect(ctx, x + 6, y + 13, w - 12, h - 10, 8); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; this._roundRect(ctx, x + 4, y + 1, w - 8, h - 2, 10); ctx.stroke(); }
    ctx.restore();
  }

  // The Gravemaw — a burrowing armoured tunnel-worm.
  //
  // Rebuilt in 4.1. The old drawing placed the head from the bounding box while
  // the body segments came from a separately-simulated trail, so head and body
  // visibly came apart whenever it moved. Everything is now drawn *from the
  // chain* (boss._updateAnim), tail first, so the creature is one connected
  // animal by construction. Each segment is oriented along its own link, which
  // is what lets the body arc through a leap instead of sliding sideways.
  _drawGravemaw(ctx, b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 42);

    const seg = b.segments || [];
    const headX = b.headX != null ? b.headX : x + w / 2;
    const headY = b.headY != null ? b.headY : y + 20;
    const crouch = b.crouch || 0;

    // Ground shadow, tightening as it lands.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h + 1, w * 0.42, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // ---- Body, tail first so each segment overlaps the one behind it ----
    for (let i = seg.length - 1; i >= 0; i--) {
      const s = seg[i];
      // Segments taper toward the tail.
      const r = 13 - i * 2.2;
      const shade = i === 0 ? '#806648' : i === 1 ? '#705940' : '#5d4938';
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle || 0);

      // Plate.
      ctx.fillStyle = shade;
      this._roundRect(ctx, -r, -r * 0.92, r * 2, r * 1.84, r * 0.55); ctx.fill();
      // Underside shadow gives the segment volume.
      ctx.fillStyle = 'rgba(24,18,18,0.30)';
      this._roundRect(ctx, -r + 2, r * 0.1, r * 2 - 4, r * 0.72, r * 0.4); ctx.fill();
      // Top highlight where the light would catch the ridge.
      ctx.fillStyle = 'rgba(200,175,130,0.35)';
      this._roundRect(ctx, -r + 3, -r * 0.85, r * 2 - 6, r * 0.45, r * 0.3); ctx.fill();
      // Seam rings between plates.
      ctx.strokeStyle = '#3c2f2a'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r + 1, -r * 0.2); ctx.lineTo(r - 1, -r * 0.2);
      ctx.stroke();
      // Dorsal spines, shrinking down the body.
      ctx.fillStyle = '#927852';
      ctx.beginPath();
      ctx.moveTo(-3, -r * 0.9); ctx.lineTo(0, -r * 1.5); ctx.lineTo(3, -r * 0.9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ---- Head, anchored to the front of the chain ----
    ctx.save();
    ctx.translate(headX, headY + crouch * 2);
    ctx.scale(b.facing, 1);
    // Landing squash reaches the head too.
    ctx.scale(b.squashX || 1, b.squashY || 1);

    // Skull: heavier and blockier than the body, so the front of the animal
    // reads as the dangerous end.
    ctx.fillStyle = '#8f734d';
    this._roundRect(ctx, -14, -15, 30, 28, 9); ctx.fill();
    ctx.fillStyle = 'rgba(200,175,130,0.4)';
    this._roundRect(ctx, -11, -14, 24, 8, 5); ctx.fill();
    ctx.fillStyle = 'rgba(30,22,18,0.25)';
    this._roundRect(ctx, -12, 4, 26, 8, 4); ctx.fill();
    // Brow ridge.
    ctx.fillStyle = '#6d5537';
    ctx.beginPath();
    ctx.moveTo(-12, -8); ctx.lineTo(2, -15); ctx.lineTo(16, -7); ctx.lineTo(14, -3); ctx.lineTo(-10, -3);
    ctx.closePath(); ctx.fill();

    // Jaw. It gapes through the wind-up and snaps shut on release, hinged at
    // the back of the skull so it swings rather than sliding open.
    const jaw = b.jaw != null ? b.jaw : 0;
    ctx.save();
    ctx.translate(-10, 2);
    ctx.rotate(jaw * 0.65);
    ctx.fillStyle = '#1c1720';
    this._roundRect(ctx, 0, 0, 26, 13, 5); ctx.fill();
    ctx.fillStyle = '#ead8a5';
    for (let i = 0; i < 5; i++) {
      const tx = 2 + i * 5;
      ctx.beginPath();
      ctx.moveTo(tx, 1); ctx.lineTo(tx + 2, 7); ctx.lineTo(tx + 4, 1);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // Upper fangs, fixed to the skull.
    ctx.fillStyle = '#f2e3b8';
    for (let i = 0; i < 4; i++) {
      const tx = -8 + i * 6;
      ctx.beginPath();
      ctx.moveTo(tx, 2); ctx.lineTo(tx + 2, 8); ctx.lineTo(tx + 4, 2);
      ctx.closePath(); ctx.fill();
    }

    // Eye, glowing hotter as an attack charges.
    const charge = b.telegraph > 0 ? 1 - b.telegraph / (b.telegraphMax || 0.6) : 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(7, -7, 0, 7, -7, 9 + charge * 6);
    g.addColorStop(0, charge > 0 ? '#ffd28c' : '#ff6b4d');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5 + charge * 0.5;
    ctx.fillStyle = g;
    ctx.fillRect(-4, -18, 24, 24);
    ctx.restore();
    ctx.fillStyle = charge > 0 ? '#ffd28c' : '#ff6b4d';
    ctx.fillRect(5, -9, 6, 5);
    ctx.fillStyle = '#25191b';
    ctx.fillRect(7, -8, 2, 3);
    ctx.restore();

    // Stone tendrils gripping the ground, splayed wider during a wind-up as it
    // braces for the leap.
    if (b.onGround) {
      ctx.strokeStyle = '#493a32'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const s of seg) {
        const spread = 5 + crouch * 4;
        ctx.moveTo(s.x - 4, s.y + 10); ctx.lineTo(s.x - spread, s.y + 18);
        ctx.moveTo(s.x + 4, s.y + 10); ctx.lineTo(s.x + spread, s.y + 18);
      }
      ctx.stroke();
    }

    if (b.telegraph > 0) {
      ctx.strokeStyle = '#d3b985'; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x + w / 2, y + h - 2, 22 + charge * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.hurtFlash > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      for (const s of seg) { ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(headX, headY, 15, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (b.invuln > 0) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(headX, headY, 16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  _drawBlightSovereign(ctx, b) {
    const x = b.x, y = b.y + Math.sin(b.bob) * 4, w = b.w, h = b.h;
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 48);

    // High-speed after-images make teleporting and dashes readable.
    const speed = Math.hypot(b.vx || 0, b.vy || 0);
    if (speed > 90 && b.ghostTrail) {
      for (let i = 0; i < b.ghostTrail.length; i++) {
        const gt = b.ghostTrail[i];
        ctx.globalAlpha = 0.045 + 0.045 * (i / Math.max(1, b.ghostTrail.length));
        ctx.fillStyle = b.color2;
        ctx.beginPath();
        ctx.moveTo(gt.x + w / 2, gt.y + 3); ctx.lineTo(gt.x + w - 3, gt.y + h / 2);
        ctx.lineTo(gt.x + w / 2, gt.y + h - 3); ctx.lineTo(gt.x + 3, gt.y + h / 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const spin = b.shardSpin != null ? b.shardSpin : b.bob * 0.7;
    const tight = b.telegraph > 0 ? (1 - b.telegraph / (b.telegraphMax || 0.6)) : 0;
    // A thin void halo and four independently faceted crown shards.
    ctx.strokeStyle = '#8b4bb8'; ctx.globalAlpha = 0.42; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, 33 + Math.sin(b.bob) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      const a = spin + i * Math.PI / 2;
      const rad = 31 - tight * 10;
      const sx = cx + Math.cos(a) * rad, sy = cy + Math.sin(a) * rad;
      const shard = 6 + tight * 2;
      ctx.fillStyle = i % 2 ? '#b45de0' : '#df8cff';
      ctx.beginPath();
      ctx.moveTo(sx, sy - shard); ctx.lineTo(sx + shard * 0.78, sy);
      ctx.lineTo(sx, sy + shard); ctx.lineTo(sx - shard * 0.78, sy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f0baff'; ctx.globalAlpha = 0.65;
      ctx.beginPath(); ctx.moveTo(sx, sy - shard + 1); ctx.lineTo(sx + 2, sy); ctx.lineTo(sx, sy + 2); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Layered diamond armor, shoulder hooks, and a torn lower cloak.
    ctx.fillStyle = '#321746';
    ctx.beginPath();
    ctx.moveTo(cx, y + 1); ctx.lineTo(x + w - 2, cy); ctx.lineTo(cx, y + h - 2);
    ctx.lineTo(x + 2, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5d2b79';
    ctx.beginPath();
    ctx.moveTo(cx, y + 7); ctx.lineTo(x + w - 10, cy); ctx.lineTo(cx, y + h - 9);
    ctx.lineTo(x + 10, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a65ad1';
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(cx, y + 11); ctx.lineTo(x + 15, cy); ctx.lineTo(cx, y + h - 13); ctx.lineTo(cx - 5, cy); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#df8cff'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx, y + 8); ctx.lineTo(x + w - 12, cy); ctx.lineTo(cx, y + h - 10);
    ctx.stroke();

    // The eye has a bright iris, a dark pupil, and a charge-reactive core.
    const core = 6.5 + Math.sin(b.bob * 2) * 1.2 + tight * 3;
    ctx.fillStyle = '#fff0ff';
    ctx.beginPath(); ctx.arc(cx, cy, core + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.telegraph > 0 ? '#f7c5ff' : '#d996ff';
    ctx.beginPath(); ctx.arc(cx, cy, core, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3b174d';
    ctx.beginPath(); ctx.arc(cx + (b.facing > 0 ? 2 : -2), cy, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 2, cy - 3, 2, 2);

    // Clawed shoulder hooks and three trailing void ribbons.
    ctx.strokeStyle = '#8b4bb8'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 11, cy - 8); ctx.quadraticCurveTo(x + 3, cy - 15, x + 7, cy - 22);
    ctx.moveTo(x + w - 11, cy - 8); ctx.quadraticCurveTo(x + w - 3, cy - 15, x + w - 7, cy - 22);
    ctx.stroke();
    const drag = clamp(-(b.vx || 0) / 200, -1, 1) * 7;
    ctx.strokeStyle = '#8b4bb8'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const from = cx - 13 + i * 13;
      ctx.beginPath();
      ctx.moveTo(from, y + h - 5);
      ctx.quadraticCurveTo(from - 10 + drag, y + h + 11, from - 2 + drag * 1.4, y + h + 21);
      ctx.stroke();
    }

    if (b.telegraph > 0) {
      ctx.strokeStyle = '#f0baff'; ctx.globalAlpha = 0.55 + tight * 0.45; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 36 - tight * 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(223,140,255,0.14)';
      ctx.beginPath(); ctx.arc(cx, cy, 26 + tight * 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.52)'; ctx.beginPath(); ctx.arc(cx, cy, 25, 0, Math.PI * 2); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  _drawPlayers(game, ctx) {
    for (const p of game.players.values()) {
      if (!p.alive) continue; // hidden while dead
      this._drawPlayer(ctx, p, game);
    }
  }

  // The player.
  //
  // Rebuilt in 4.1 around a *pose*: a small set of numbers derived from what the
  // player is doing (walk cycle, airborne, swimming, swinging) that every body
  // part reads from. The old version drew a fixed stack of rectangles with one
  // leg offset, so the character never looked like it was doing anything.
  //
  // Equipment is drawn as layers over the body using each armor item's own
  // colour, which is what finally makes armor visible on the character instead
  // of being a number in a panel.
  _drawPlayer(ctx, p, game) {
    const x = p.x, y = p.y, w = p.w, h = p.h;
    const app = p.appearance || DEFAULT_LOOK;
    const eq = p.inventory ? p.inventory.equip : null;

    const pose = this._playerPose(p);
    ctx.save();
    ctx.translate(x + w / 2, y + h);
    ctx.scale(p.facing, 1);
    ctx.translate(-w / 2, -h);
    // Whole-body bob: the torso rises and falls through the stride, and
    // breathes slowly when idle.
    ctx.translate(0, pose.bodyY);

    this._drawPlayerLegs(ctx, p, pose, app, eq);
    this._drawPlayerTorso(ctx, p, pose, app, eq);
    this._drawPlayerArms(ctx, p, pose, app, eq, game);
    this._drawPlayerHead(ctx, p, pose, app, eq);

    ctx.restore();

    // The swing trail is drawn in world space, unflipped, because its arc is
    // already expressed as a world angle.
    if (p.swing) this._drawSwing(ctx, p);

    // name + hp for remote players
    if (!p.isLocal || game.net) {
      ctx.font = '5px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.name, x + w / 2, y - 6);
      if (!p.isLocal) this._miniHp(ctx, p, p.hp / p.maxHp, p.color);
    }
    ctx.textAlign = 'left';
  }

  // Derive every animation number from the player's actual state, once.
  _playerPose(p) {
    const moving = Math.abs(p.vx) > 5;
    const airborne = !p.onGround && !p.submerged;
    const t = p.walkAnim;
    const idleT = (performance.now() / 1000) * 1.6 + (p.x * 0.01);

    if (p.submerged) {
      // Swimming: legs kick, arms sweep, body tips forward.
      const k = Math.sin(idleT * 4);
      return {
        legFront: k * 5, legBack: -k * 5, armFront: -k * 0.5, armBack: k * 0.5,
        bodyY: Math.sin(idleT * 3) * 0.6, lean: 0.25, crouch: 0, swim: true,
      };
    }
    if (airborne) {
      // Rising: legs tucked. Falling: legs reaching for the ground.
      const rising = p.vy < 0;
      return {
        legFront: rising ? -3 : 2.5, legBack: rising ? 2 : -1.5,
        armFront: rising ? -0.9 : -0.35, armBack: rising ? 0.5 : 0.7,
        bodyY: 0, lean: rising ? -0.1 : 0.08, crouch: rising ? 1 : 0, swim: false,
      };
    }
    if (moving) {
      // Walk cycle: legs and arms counter-swing, torso bobs at twice the
      // stride frequency (once per footfall, not once per cycle).
      return {
        legFront: Math.sin(t) * 4.2, legBack: Math.sin(t + Math.PI) * 4.2,
        armFront: Math.sin(t + Math.PI) * 0.75, armBack: Math.sin(t) * 0.75,
        bodyY: -Math.abs(Math.sin(t)) * 1.1, lean: 0.06, crouch: 0, swim: false,
      };
    }
    // Idle: a slow breath, nothing else.
    return {
      legFront: 0, legBack: 0,
      armFront: Math.sin(idleT) * 0.1, armBack: -Math.sin(idleT) * 0.1,
      bodyY: Math.sin(idleT) * 0.35, lean: 0, crouch: 0, swim: false,
    };
  }

  // Colour for an equipment slot, falling back to the body's own colour when
  // nothing is worn there.
  _gearColor(eq, slot, fallback) {
    const ref = eq && eq[slot];
    if (!ref) return null;
    const def = getItem(ref.id);
    return (def && def.color) || fallback;
  }

  _drawPlayerLegs(ctx, p, pose, app, eq) {
    const w = p.w, h = p.h;
    const legs = this._gearColor(eq, 'legs');
    const col = legs || app.pants;
    const boot = legs ? this._shade(legs, -0.28) : this._shade(app.pants, -0.35);
    const top = h - 9;

    for (const [dx, swing, shadeAmt] of [[w - 5.5, pose.legFront, 0], [1, pose.legBack, -0.12]]) {
      const lift = Math.max(0, swing);
      ctx.fillStyle = this._shade(col, shadeAmt);
      ctx.fillRect(dx, top + lift, 4, 9 - lift);
      ctx.fillStyle = boot;
      ctx.fillRect(dx - 0.5, h - 2 + lift * 0.2, 5, 2);
      // Armored legs get a knee plate, so a full set is readable at a glance.
      if (legs) {
        ctx.fillStyle = this._shade(legs, 0.25);
        ctx.fillRect(dx, top + lift + 2, 4, 1.5);
      }
    }
  }

  _drawPlayerTorso(ctx, p, pose, app, eq) {
    const w = p.w, h = p.h;
    const chest = this._gearColor(eq, 'chest');
    const col = chest || app.shirt;
    const top = 8, bottom = h - 9;

    ctx.save();
    // A slight forward lean while moving, pivoting at the hips.
    ctx.translate(w / 2, bottom);
    ctx.rotate(pose.lean * 0.35);
    ctx.translate(-w / 2, -bottom);

    ctx.fillStyle = col;
    this._roundRect(ctx, 0, top, w, bottom - top + 1, 2); ctx.fill();
    // Lit from the upper left, shadowed toward the back — the same light the
    // terrain uses, so the character sits in the same world.
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    this._roundRect(ctx, 0.5, top + 0.5, w - 4, bottom - top - 2, 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(w - 3, top + 1, 3, bottom - top - 1);

    if (chest) {
      // Chest plate: a raised collar and a centre seam.
      ctx.fillStyle = this._shade(chest, 0.3);
      ctx.fillRect(1, top, w - 2, 2);
      ctx.fillStyle = this._shade(chest, -0.3);
      ctx.fillRect(w / 2 - 0.5, top + 2, 1, bottom - top - 2);
      // Shoulder pauldrons.
      ctx.fillStyle = this._shade(chest, 0.18);
      this._roundRect(ctx, -1, top + 0.5, 4, 3.5, 1.5); ctx.fill();
      this._roundRect(ctx, w - 3, top + 0.5, 4, 3.5, 1.5); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(0, bottom - 1, w, 2); // belt
    }
    ctx.restore();
  }

  _drawPlayerArms(ctx, p, pose, app, eq, game) {
    const w = p.w, h = p.h;
    const chest = this._gearColor(eq, 'chest');
    const sleeve = chest ? this._shade(chest, -0.1) : app.shirt;
    const shoulderY = 11;

    // Back arm, behind the torso.
    ctx.save();
    ctx.translate(2, shoulderY);
    ctx.rotate(pose.armBack);
    ctx.fillStyle = this._shade(sleeve, -0.22);
    ctx.fillRect(-1.5, 0, 3, 8);
    ctx.fillStyle = this._shade(app.skin, -0.15);
    ctx.fillRect(-1.5, 7, 3, 2.5);
    ctx.restore();

    // Front arm holds whatever is selected. During a swing the arm follows the
    // weapon rather than the walk cycle, which is what makes the swing read as
    // a swing and not as the character waving while a sprite spins nearby.
    const sel = p.isLocal ? (p.inventory && p.inventory.selectedItem()) : (p.selectedId ? getItem(p.selectedId) : null);
    let armAngle = pose.armFront;
    if (p.swing) {
      const k = this._swingProgress(p);
      // Local angle relative to the (already flipped) body.
      armAngle = -1.1 + k * 2.2;
    } else if (p.fishing) {
      armAngle = -0.5;
    }

    ctx.save();
    ctx.translate(w - 2, shoulderY);
    ctx.rotate(armAngle);
    ctx.fillStyle = sleeve;
    ctx.fillRect(-1.5, 0, 3, 8);
    ctx.fillStyle = app.skin;
    ctx.fillRect(-1.5, 7, 3, 2.5);
    // Held item, in the hand, rotating with the arm.
    if (sel) {
      const icon = Sprites.getIcon(sel);
      if (icon) {
        ctx.save();
        ctx.translate(0, 9);
        ctx.rotate(p.swing ? 0.5 : 0.9);
        ctx.drawImage(icon, -6, -11, 12, 12);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  _drawPlayerHead(ctx, p, pose, app, eq) {
    const w = p.w;
    const head = this._gearColor(eq, 'head');
    // Head bobs a touch behind the torso, which is what stops the character
    // reading as one rigid block.
    const hy = pose.crouch ? 0.5 : 0;

    ctx.fillStyle = app.skin;
    ctx.fillRect(1, hy, w - 2, 9);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(w - 3, hy, 2, 9);

    if (head) {
      // Helmet over the hair: a dome plus a brow band and a nose guard.
      ctx.fillStyle = head;
      this._roundRect(ctx, 0.5, hy - 0.5, w - 1, 6, 2); ctx.fill();
      ctx.fillStyle = this._shade(head, 0.28);
      ctx.fillRect(1, hy, w - 2, 1.5);
      ctx.fillStyle = this._shade(head, -0.3);
      ctx.fillRect(w - 4, hy + 3.5, 3, 3);   // nose guard, on the facing side
      ctx.fillRect(0.5, hy + 4.5, w - 1, 1); // brow band
    } else {
      // Hair.
      ctx.fillStyle = app.hair;
      ctx.fillRect(1, hy, w - 2, 3);
      if (app.hairStyle === 'long') ctx.fillRect(1, hy, 2.5, 8);
      else if (app.hairStyle === 'spiky') {
        for (let i = 0; i < 3; i++) ctx.fillRect(2 + i * 3, hy - 1.5, 2, 2);
      }
    }

    // Eye, on the facing side.
    ctx.fillStyle = app.eyes;
    ctx.fillRect(w - 5, hy + 4.5, 2, 2);
  }

  // 0..1 through the current swing.
  _swingProgress(p) {
    if (!p.swing) return 0;
    return Math.max(0, Math.min(1, p.swing.time / p.swing.dur));
  }

  // A real swing: the arc sweeps from wind-up to follow-through, with a tapered
  // trail behind the leading edge. The shape depends on the weapon — a sword
  // sweeps, a spear thrusts, a heavy weapon takes a slow wide arc — so the
  // weapon classes finally look as different as they play.
  _drawSwing(ctx, p) {
    const def = getItem(p.swing.item);
    const kind = (def && def.meleeKind) || 'sword';
    const k = this._swingProgress(p);
    const reach = p.swing.reach || 26;
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2 - 2;
    const base = p.swing.angle;

    ctx.save();
    ctx.lineCap = 'round';

    if (kind === 'spear') {
      // A thrust: out fast, back slower, with a straight streak.
      const ext = Math.sin(Math.min(1, k * 1.35) * Math.PI) * reach;
      const tipX = cx + Math.cos(base) * ext, tipY = cy + Math.sin(base) * ext;
      const grad = ctx.createLinearGradient(cx, cy, tipX, tipY);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, p.swing.color || 'rgba(255,255,255,0.8)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tipX, tipY); ctx.stroke();
    } else {
      // Sweep. Heavy weapons cover more arc and lag behind the input.
      const span = kind === 'heavy' ? 2.5 : 1.9;
      const eased = kind === 'heavy' ? k * k * (3 - 2 * k) : k;
      const a = base + (eased - 0.5) * span * p.facing;
      // Trail: several arcs fading behind the leading edge.
      const steps = 5;
      for (let i = steps; i >= 1; i--) {
        const back = a - (i / steps) * 0.55 * p.facing;
        ctx.globalAlpha = (1 - i / steps) * 0.5 * (1 - k * 0.5);
        ctx.strokeStyle = p.swing.color || 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3 - (i / steps) * 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, reach * (0.75 + 0.25 * (1 - i / steps)), back - 0.12, back + 0.12);
        ctx.stroke();
      }
      // Leading edge.
      ctx.globalAlpha = 1 - k * 0.35;
      ctx.strokeStyle = p.swing.color || 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, reach, a - 0.3, a + 0.18); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The cast line and its bobber. The bobber rides the water's own wave when
  // nothing is happening and dips sharply on a bite, so the tell is unmissable
  // without needing a UI prompt.
  _drawFishingLines(game, ctx) {
    for (const p of game.players.values()) {
      const line = p.fishing;
      if (!line) continue;
      const rodTipX = p.x + p.w / 2 + p.facing * 9;
      const rodTipY = p.y + 8;

      const bite = line.biting;
      const bob = bite
        ? Math.sin(line.bob * 26) * 2.2 + 2.5
        : Math.sin(line.bob * 2.2 + line.tx * 0.55) * 0.8;
      const bx = line.x, by = line.y + bob;

      // Line, sagging between rod tip and bobber.
      ctx.strokeStyle = 'rgba(235,240,250,0.55)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(rodTipX, rodTipY);
      ctx.quadraticCurveTo((rodTipX + bx) / 2, Math.max(rodTipY, by) + 6, bx, by);
      ctx.stroke();

      // Bobber.
      ctx.fillStyle = bite ? '#ff6b7d' : '#e8e4da';
      ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bite ? '#ffd0d6' : '#c04a4a';
      ctx.beginPath(); ctx.arc(bx, by - 1, 1.2, 0, Math.PI * 2); ctx.fill();

      // Ripples spreading from the bite.
      if (bite) {
        ctx.strokeStyle = 'rgba(255,224,138,0.7)';
        ctx.lineWidth = 0.7;
        const r = 3 + (1 - line.biteTimer / 0.9) * 7;
        ctx.beginPath(); ctx.arc(bx, line.y, r, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  _miniHp(ctx, e, ratio, color) {
    const w = e.w, x = e.x, y = e.y - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y, w + 2, 3);
    ctx.fillStyle = color; ctx.fillRect(x, y + 0.5, w * Math.max(0, ratio), 2);
  }

  // `emissive` selects which half of the particle list to draw: the dull ones
  // (dust, debris, smoke) below the lighting overlay, the glowing ones above it.
  _drawParticles(game, ctx, emissive) {
    if (emissive) ctx.globalCompositeOperation = 'lighter';
    for (const pt of game.particles) {
      if (!!pt.glow !== !!emissive) continue;
      const k = Math.max(0, pt.life / pt.max);
      ctx.globalAlpha = k;
      ctx.fillStyle = pt.color;
      const s = pt.shrink === false ? pt.size : pt.size * (0.35 + k * 0.65);
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _drawRings(game, ctx) {
    if (!game.rings || !game.rings.length) return;
    for (const r of game.rings) {
      const k = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * k;
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
      if (r.fill) {
        ctx.fillStyle = r.color;
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width * (1 - k * 0.6);
        ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawFloatTexts(game, W2, H) {
    const ctx = this.ctx; const cam = this.camera;
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    for (const ft of game.floatTexts) {
      const s = cam.worldToScreen(ft.x, ft.y, W2, H);
      ctx.globalAlpha = Math.max(0, ft.life / ft.max);
      ctx.fillStyle = '#000'; ctx.fillText(ft.text, s.x + 1, s.y + 1);
      ctx.fillStyle = ft.color; ctx.fillText(ft.text, s.x, s.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  _drawLighting(game, tx0, ty0, tx1, ty1, W2, H, camX, camY) {
    const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
    if (cols <= 0 || rows <= 0) return;
    const extra = [];
    const p = game.localPlayer;
    if (p) extra.push({ tx: Math.floor((p.x + p.w / 2) / TILE), ty: Math.floor((p.y + p.h / 2) / TILE), level: 0.5 });
    for (const pl of game.players.values()) if (!pl.isLocal) extra.push({ tx: Math.floor((pl.x + pl.w / 2) / TILE), ty: Math.floor((pl.y + pl.h / 2) / TILE), level: 0.35 });
    // Live explosives light the room they're about to redecorate.
    if (game.thrown) {
      for (const t of game.thrown) {
        if (!t.light) continue;
        extra.push({ tx: Math.floor(t.x / TILE), ty: Math.floor(t.y / TILE), level: t.light });
      }
    }
    // Glowing bugs. A drifting glowmoth is often the only thing lighting a deep
    // cave before you have torches, which is exactly why it is worth catching.
    if (game.critters) {
      for (const c of game.critters) {
        if (!c.def || !c.def.light) continue;
        extra.push({ tx: Math.floor((c.x + c.w / 2) / TILE), ty: Math.floor((c.y + c.h / 2) / TILE), level: c.def.light });
      }
    }
    // Explosion flashes, fading out over their life.
    if (game.flashes) {
      for (const f of game.flashes) {
        extra.push({ tx: Math.floor(f.x / TILE), ty: Math.floor(f.y / TILE), level: f.level * (f.life / f.max) });
      }
    }
    const buf = game.world.computeLightWindow(tx0, ty0, cols, rows, game.time.brightness, extra);

    if (this.lightCanvas.width !== cols || this.lightCanvas.height !== rows) {
      this.lightCanvas.width = cols; this.lightCanvas.height = rows;
    }
    const img = this.lightCtx.createImageData(cols, rows);
    for (let i = 0; i < buf.length; i++) {
      const a = Math.round((1 - buf[i]) * 255);
      img.data[i * 4] = 6; img.data[i * 4 + 1] = 8; img.data[i * 4 + 2] = 20; img.data[i * 4 + 3] = a;
    }
    this.lightCtx.putImageData(img, 0, 0);

    const ctx = this.ctx; const cam = this.camera;
    ctx.imageSmoothingEnabled = true;
    const sx = (tx0 * TILE - camX) * cam.scale + W2 / 2;
    const sy = (ty0 * TILE - camY) * cam.scale + H / 2;
    ctx.drawImage(this.lightCanvas, sx, sy, cols * TILE * cam.scale, rows * TILE * cam.scale);
    ctx.imageSmoothingEnabled = false;
  }

  _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _shade(hex, amt) {
    const h = hex.replace('#', '');
    let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    r = Math.max(0, Math.min(255, r + amt * 255)); g = Math.max(0, Math.min(255, g + amt * 255)); b = Math.max(0, Math.min(255, b + amt * 255));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
}

function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function rgb(c) { return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

// Stable per-tile hash for picking sprite variants, so a tree looks the same
// every frame and after a reload.
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
