// Summoner Realms — canvas renderer. Draws sky, walls, world, lighting,
// entities and effects.
import { TILE, UNDERGROUND_Y, CAVERN_Y, WORLD_H } from '../config.js?v=realms-2';
import { T, isSolid, isTree, isLeaf, tileDef } from '../world/tiles.js?v=realms-2';
import { W, hasWall } from '../world/walls.js?v=realms-2';
import { BIOMES } from '../world/biomes.js?v=realms-2';
import { Sprites, framingMask, N, E, S, WBIT } from '../art/sprites.js?v=realms-2';
import { item as getItem } from '../data/items.js?v=realms-2';
import { canPlaceAt } from '../systems/combat.js?v=realms-2';
import { clamp } from '../utils.js?v=realms-2';

const PROJ_GLOW = { thorn: '#7ee08a', seed: '#a7e36f', rock: '#8a7a5a', shock: '#d3b985', blight: '#c58bff', crystal: '#df8cff', voidorb: '#b06bff', spark: '#9ec3ff', wispbolt: '#9ec3ff', emberball: '#ff8c3b', arcwave: '#bfe9ff' };

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
    this._drawFallingTrees(game, ctx);
    this._drawDrops(game, ctx);
    this._drawNpc(game, ctx);
    this._drawMinions(game, ctx);
    this._drawEnemies(game, ctx);
    this._drawBosses(game, ctx);
    this._drawThrown(game, ctx);
    this._drawProjectiles(game, ctx);
    this._drawPlayers(game, ctx);
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
      if (game.npc) { ctx.strokeStyle = '#ffd9a0'; box(game.npc); }
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
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = world.get(tx, ty);
        if (id === T.AIR) continue;
        const spr = this._tileSprite(world, tx, ty, id);
        if (spr) ctx.drawImage(spr, tx * TILE, ty * TILE, TILE, TILE);
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

  _drawFallingTrees(game, ctx) {
    if (!game.fallingTrees || !game.fallingTrees.length) return;
    for (const ft of game.fallingTrees) {
      ctx.save();
      ctx.translate(ft.px, ft.py);
      ctx.rotate(ft.angle);
      ctx.globalAlpha = Math.max(0, 1 - (ft.t / ft.dur) * 0.55);
      for (const c of ft.cells) {
        const spr = Sprites.getTile(c.id);
        if (spr) ctx.drawImage(spr, c.dx * TILE - TILE / 2, c.dy * TILE - TILE, TILE, TILE);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
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

  _drawEnemies(game, ctx) {
    for (const e of game.enemies) {
      // Wind-up tell: the enemy swells and flashes just before it commits.
      const tel = e.telegraph > 0 ? e.telegraph / (e.telegraphMax || 0.4) : 0;
      if (tel > 0) {
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.35 * Math.sin(tel * Math.PI * 6);
        ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 1.5;
        this._roundRect(ctx, e.x - 2, e.y - 2, e.w + 4, e.h + 4, 4); ctx.stroke();
        ctx.restore();
      }
      this._blobCreature(ctx, e, e.color, e.color2, e.facing, e.hurtFlash > 0);
      if (e.hp < e.maxHp) this._miniHp(ctx, e, e.hp / e.maxHp, '#ff6b7d');
    }
  }

  _drawMinions(game, ctx) {
    for (const m of game.minions) this._blobCreature(ctx, m, m.color, m.color2, m.facing, false, true);
    // Remote players' minion ghosts.
    for (const p of game.players.values()) {
      if (p.isLocal || !p.remoteMinions) continue;
      for (const rm of p.remoteMinions) {
        const spr = { x: rm.x, y: rm.y, w: 14, h: 14 };
        this._blobCreature(ctx, spr, '#9ec3ff', '#cfe6ff', rm.f || 1, false, true);
      }
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

  // ---- The Guide ----
  _drawNpc(game, ctx) {
    const n = game.npc;
    if (!n) return;
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
      if (b.key === 'grovekeeper') this._drawGrovekeeper(ctx, b);
      else if (b.key === 'gravemaw') this._drawGravemaw(ctx, b);
      else this._drawBlightSovereign(ctx, b);
      ctx.restore();
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

  _drawGrovekeeper(ctx, b) {
    // Canopy leans against the direction of travel, which turns the orbit from
    // a slide into something that looks like it has weight.
    const lean = clamp((b.vx || 0) / 260, -0.5, 0.5);
    const x = b.x, y = b.y + Math.sin(b.bob) * 3, w = b.w, h = b.h;
    const cx = x + w / 2;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 36);

    ctx.save();
    ctx.translate(cx, y + 26); ctx.rotate(-lean * 0.35); ctx.translate(-cx, -(y + 26));
    ctx.strokeStyle = '#264f2b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, y + 25); ctx.lineTo(cx - 13, y + 9);
    ctx.moveTo(cx, y + 22); ctx.lineTo(cx + 14, y + 7);
    ctx.moveTo(cx - 10, y + 14); ctx.lineTo(cx - 18, y + 4);
    ctx.moveTo(cx + 11, y + 13); ctx.lineTo(cx + 19, y + 2);
    ctx.stroke();
    for (const leaf of [[cx - 18, y + 4, 9], [cx + 18, y + 3, 10], [cx - 7, y + 5, 12], [cx + 7, y + 5, 12]]) {
      const sway = Math.sin(b.bob * 1.3 + leaf[0] * 0.1) * 1.6;
      ctx.fillStyle = leaf[2] > 10 ? '#6fbf55' : '#4b9b45';
      ctx.beginPath(); ctx.arc(leaf[0] + sway, leaf[1], leaf[2], 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath(); ctx.arc(leaf[0] + sway + 2, leaf[1] + 3, leaf[2] * 0.72, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#6b442d';
    this._roundRect(ctx, x + 9, y + 16, w - 18, h - 17, 8); ctx.fill();
    ctx.fillStyle = '#a36b3c';
    ctx.fillRect(cx - 3, y + 19, 4, h - 22);
    // Eyes brighten as an attack charges.
    const glow = b.telegraph > 0 ? '#fff2b0' : '#ffcf6b';
    ctx.fillStyle = glow;
    ctx.fillRect(x + 16, y + 28, 4, 4); ctx.fillRect(x + w - 20, y + 28, 4, 4);
    ctx.fillStyle = '#1a2419';
    ctx.fillRect(x + 17, y + 29, 2, 2); ctx.fillRect(x + w - 19, y + 29, 2, 2);
    ctx.fillStyle = '#264f2b';
    ctx.fillRect(x + 4, y + h - 6, 14, 5); ctx.fillRect(x + w - 18, y + h - 6, 14, 5);
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; this._roundRect(ctx, x + 8, y + 15, w - 16, h - 15, 7); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; this._roundRect(ctx, x + 5, y + 1, w - 10, h - 2, 8); ctx.stroke(); }
    ctx.restore();
  }

  _drawGravemaw(ctx, b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 39);

    // Segments trail the head with spring lag (see Boss._updateAnim), so the
    // body follows through a leap instead of every piece bobbing on its own.
    const seg = b.segments || [];
    for (let i = 2; i >= 0; i--) {
      const s = seg[i] || { x: x + 4 + i * 17, y: y + 12 };
      ctx.fillStyle = i === 0 ? '#5f4b3b' : '#75624b';
      this._roundRect(ctx, s.x, s.y, 25, 27, 9); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      this._roundRect(ctx, s.x + 2, s.y + 15, 21, 11, 6); ctx.fill();
      ctx.fillStyle = '#b69a6c'; ctx.globalAlpha = 0.55;
      ctx.fillRect(s.x + 5, s.y + 5, 8, 3); ctx.globalAlpha = 1;
    }
    // Open jaw at the facing end. `jaw` is how wide it is gaping right now.
    const jaw = b.jaw != null ? b.jaw : 0;
    const mouthX = b.facing > 0 ? x + w - 19 : x + 4;
    ctx.fillStyle = '#211923';
    this._roundRect(ctx, mouthX, y + 18 - jaw * 3, 17, 17 + jaw * 6, 6); ctx.fill();
    ctx.fillStyle = '#e8d6a6';
    for (let i = 0; i < 3; i++) {
      const tx = b.facing > 0 ? mouthX + 2 + i * 5 : mouthX + 12 - i * 5;
      ctx.beginPath();
      ctx.moveTo(tx, y + 21 - jaw * 3);
      ctx.lineTo(tx + (b.facing > 0 ? 3 : -3), y + 28 - jaw * 3);
      ctx.lineTo(tx + (b.facing > 0 ? 6 : -6), y + 21 - jaw * 3);
      ctx.fill();
    }
    ctx.fillStyle = b.telegraph > 0 ? '#ffb37d' : '#ff6b4d';
    ctx.fillRect(x + (b.facing > 0 ? w - 26 : 11), y + 9, 5, 4);
    ctx.fillStyle = '#1d1818';
    ctx.fillRect(x + (b.facing > 0 ? w - 24 : 12), y + 10, 2, 2);
    ctx.fillStyle = '#493b34';
    ctx.fillRect(x + 2, y + h - 5, 22, 5); ctx.fillRect(x + w - 24, y + h - 5, 22, 5);
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; this._roundRect(ctx, x + 3, y + 10, w - 6, h - 10, 8); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; this._roundRect(ctx, x + 1, y + 8, w - 2, h - 8, 9); ctx.stroke(); }
    ctx.restore();
  }

  _drawBlightSovereign(ctx, b) {
    const x = b.x, y = b.y + Math.sin(b.bob) * 4, w = b.w, h = b.h;
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 45);

    // After-images at speed: the Sovereign smears when it moves fast.
    const speed = Math.hypot(b.vx || 0, b.vy || 0);
    if (speed > 90 && b.ghostTrail) {
      for (let i = 0; i < b.ghostTrail.length; i++) {
        const gt = b.ghostTrail[i];
        ctx.globalAlpha = 0.06 + 0.05 * (i / b.ghostTrail.length);
        ctx.fillStyle = b.color2;
        ctx.beginPath();
        ctx.moveTo(gt.x + w / 2, gt.y + 2); ctx.lineTo(gt.x + w - 4, gt.y + h / 2);
        ctx.lineTo(gt.x + w / 2, gt.y + h - 2); ctx.lineTo(gt.x + 4, gt.y + h / 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Crown shards orbit, easing faster while an attack charges.
    const spin = b.shardSpin != null ? b.shardSpin : b.bob * 0.7;
    ctx.strokeStyle = '#8b4bb8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = spin + i * Math.PI / 2;
      const rad = 31 - (b.telegraph > 0 ? (1 - b.telegraph / (b.telegraphMax || 0.6)) * 10 : 0);
      const sx = cx + Math.cos(a) * rad, sy = cy + Math.sin(a) * rad;
      ctx.fillStyle = i % 2 ? '#b45de0' : '#df8cff';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 6, sy); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 6, sy); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#512572';
    ctx.beginPath();
    ctx.moveTo(cx, y + 2); ctx.lineTo(x + w - 4, cy); ctx.lineTo(cx, y + h - 2); ctx.lineTo(x + 4, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d996ff';
    ctx.beginPath();
    ctx.moveTo(cx, y + 10); ctx.lineTo(x + w - 13, cy); ctx.lineTo(cx, y + h - 10); ctx.lineTo(x + 13, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff0ff';
    const core = 7 + Math.sin(b.bob * 2) * 1.5 + (b.telegraph > 0 ? 3 : 0);
    ctx.beginPath(); ctx.arc(cx, cy, core, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5b237d';
    ctx.beginPath(); ctx.arc(cx + (b.facing > 0 ? 2 : -2), cy, 3, 0, Math.PI * 2); ctx.fill();
    // Trailing void ribbons, drifting with velocity.
    const drag = clamp(-(b.vx || 0) / 200, -1, 1) * 6;
    ctx.strokeStyle = '#8b4bb8'; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx - 12 + i * 12, y + h - 4);
      ctx.quadraticCurveTo(cx - 22 + i * 20 + drag, y + h + 12, cx - 14 + i * 14 + drag * 1.6, y + h + 19); ctx.stroke();
    }
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 31, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }

  _drawPlayers(game, ctx) {
    for (const p of game.players.values()) {
      if (!p.alive) continue; // hidden while dead
      this._drawPlayer(ctx, p, game);
    }
  }

  _drawPlayer(ctx, p, game) {
    const x = p.x, y = p.y, w = p.w, h = p.h;
    const legSwing = Math.sin(p.walkAnim) * 3;
    // legs
    ctx.fillStyle = '#2a2f45';
    ctx.fillRect(x + 1, y + h - 8 + Math.max(0, legSwing), 4, 8 - Math.max(0, legSwing));
    ctx.fillRect(x + w - 5, y + h - 8 + Math.max(0, -legSwing), 4, 8 - Math.max(0, -legSwing));
    // torso (player colour)
    ctx.fillStyle = p.color;
    this._roundRect(ctx, x, y + 8, w, h - 14, 2); ctx.fill();
    // belt/legs armor accent
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x, y + h - 8, w, 2);
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x + 1, y, w - 2, 9);
    // hair/cap
    ctx.fillStyle = this._shade(p.color, -0.3);
    ctx.fillRect(x + 1, y, w - 2, 3);
    // eyes
    ctx.fillStyle = '#222';
    ctx.fillRect(p.facing > 0 ? x + w - 5 : x + 3, y + 4, 2, 2);
    // held item toward aim
    const sel = p.isLocal ? p.inventory.selectedItem() : (p.selectedId ? getItem(p.selectedId) : null);
    if (sel) {
      const icon = Sprites.getIcon(sel);
      if (icon) {
        const hx = x + w / 2, hy = y + 14;
        ctx.save();
        ctx.translate(hx, hy);
        ctx.scale(p.facing, 1);
        ctx.drawImage(icon, 0, -6, 12, 12);
        ctx.restore();
      }
    }
    // melee swing arc
    if (p.swing) {
      const prog = p.swing.time / p.swing.dur;
      const a = p.swing.angle + (prog - 0.5) * 1.8 * (p.facing);
      const r = (p.swing.reach || 26);
      const cx = x + w / 2, cy = y + h / 2;
      ctx.strokeStyle = p.swing.color || 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, r, a - 0.5, a + 0.5); ctx.stroke();
    }
    // name + hp for remote players
    if (!p.isLocal || game.net) {
      ctx.font = '5px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.name, x + w / 2, y - 6);
      if (!p.isLocal) this._miniHp(ctx, p, p.hp / p.maxHp, p.color);
    }
    ctx.textAlign = 'left';
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
