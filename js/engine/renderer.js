// Summoner Realms — canvas renderer. Draws sky, walls, world, lighting,
// entities and effects.
import { TILE, UNDERGROUND_Y, CAVERN_Y, WORLD_H } from '../config.js?v=realms-difficulty-22';
import { T, isSolid, isTree, isLeaf, tileDef } from '../world/tiles.js?v=realms-difficulty-22';
import { W, hasWall } from '../world/walls.js?v=realms-difficulty-22';
import { BIOMES } from '../world/biomes.js?v=realms-difficulty-22';
import { Sprites, framingMask, N, E, S, WBIT } from '../art/sprites.js?v=realms-difficulty-22';
import { item as getItem } from '../data/items.js?v=realms-difficulty-22';
import { canPlaceAt } from '../systems/combat.js?v=realms-difficulty-22';
import { clamp } from '../utils.js?v=realms-difficulty-22';

const PROJ_GLOW = {
  thorn: '#7ee08a', seed: '#a7e36f', rock: '#8a7a5a', shock: '#d3b985',
  blight: '#c58bff', crystal: '#df8cff', voidorb: '#b06bff',
  spark: '#9ec3ff', wispbolt: '#9ec3ff', emberball: '#ff8c3b',
  arcwave: '#bfe9ff', diamondSpear: '#dffcff', miniDiamondSpear: '#8be9ff',
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
    // Keep the Diamond Heart's telegraph and beam above the lighting pass so
    // the three warning lanes stay readable in daylight and at night.
    this._drawDiamondBeamTelegraphs(game, ctx);
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
        // Use the same shaded trunk/canopy art a standing tree gets, from the
        // masks baked into the cell when the tree was felled. `getTile` here
        // would fall back to the flat untextured tile — the pre-overhaul look.
        const spr = isTree(c.id) ? Sprites.getTrunk(c.id, c.mask, c.variant)
          : isLeaf(c.id) ? Sprites.getCanopy(c.id, c.mask, c.variant)
            : Sprites.getTile(c.id);
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


  _drawEnemies(game, ctx) {
    for (const e of game.enemies) {
      this._drawEnemyTelegraph(ctx, e);
      switch (e.key) {
        case 'slugling': this._drawSlugling(ctx, e); break;
        case 'boar': this._drawBoar(ctx, e); break;
        case 'husk': this._drawHusk(ctx, e); break;
        case 'duneStalker': this._drawDuneStalker(ctx, e); break;
        case 'rimeWisp': this._drawRimeWisp(ctx, e); break;
        case 'bat': this._drawBat(ctx, e); break;
        case 'crawler': this._drawCrawler(ctx, e); break;
        case 'bonepicker': this._drawBonepicker(ctx, e); break;
        case 'blightcrawler': this._drawBlightcrawler(ctx, e); break;
        case 'blightshade': this._drawBlightshade(ctx, e); break;
        default: this._drawUnknownEnemy(ctx, e); break;
      }
      if (e.hp < e.maxHp) this._miniHp(ctx, e, e.hp / e.maxHp, '#ff6b7d');
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
    if (e.behavior === 'flyer' || e.key === 'rimeWisp' || e.key === 'blightshade') return;
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
      if (m.key === 'diamondHeart') this._drawDiamondHeart(ctx, m);
      else this._blobCreature(ctx, m, m.color, m.color2, m.facing, m.hurtFlash > 0, true);
    }
    // Remote players' minion ghosts.
    for (const p of game.players.values()) {
      if (p.isLocal || !p.remoteMinions) continue;
      for (const rm of p.remoteMinions) {
        if (rm.dead) continue;
        if (rm.key === 'diamondHeart') {
          this._drawDiamondHeart(ctx, Object.assign({
            w: 30, h: 42, color: '#dffcff', color2: '#62c9e8',
            anim: 0, hp: rm.hp, maxHp: rm.maxHp,
          }, rm, { x: rm.x, y: rm.y, facing: rm.f || 1 }));
        } else {
          const spr = { x: rm.x, y: rm.y, w: 14, h: 14 };
          this._blobCreature(ctx, spr, '#9ec3ff', '#cfe6ff', rm.f || 1, false, true);
        }
      }
    }
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

  // ---- The Guide ----
  _drawNpc(game, ctx) {
    const n = game.npc;
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

  _drawGravemaw(ctx, b) {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    ctx.save();
    this._bossAura(ctx, b, b.color2, 42);

    const seg = b.segments || [];
    // Layered stone segments have individual plates and moving seams.
    for (let i = 2; i >= 0; i--) {
      const s = seg[i] || { x: x + 4 + i * 17, y: y + 12 };
      const sw = 25, sh = 29;
      ctx.fillStyle = i === 0 ? '#5d4938' : (i === 1 ? '#705940' : '#806648');
      this._roundRect(ctx, s.x, s.y, sw, sh, 9); ctx.fill();
      ctx.fillStyle = 'rgba(24,18,18,0.28)';
      this._roundRect(ctx, s.x + 2, s.y + 16, sw - 4, 11, 6); ctx.fill();
      ctx.fillStyle = '#b69a6c'; ctx.globalAlpha = 0.58;
      ctx.beginPath();
      ctx.moveTo(s.x + 5, s.y + 7); ctx.lineTo(s.x + 12, s.y + 4); ctx.lineTo(s.x + 18, s.y + 7);
      ctx.lineTo(s.x + 15, s.y + 10); ctx.lineTo(s.x + 7, s.y + 10); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#3c2f2a'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x + 4, s.y + 15); ctx.lineTo(s.x + 20, s.y + 13);
      ctx.moveTo(s.x + 8, s.y + 21); ctx.lineTo(s.x + 17, s.y + 22);
      ctx.stroke();
      // Small spikes make the body read as a living armored tunnel-creature.
      ctx.fillStyle = '#927852';
      ctx.beginPath();
      ctx.moveTo(s.x + 4, s.y + 4); ctx.lineTo(s.x + 1, s.y - 3); ctx.lineTo(s.x + 8, s.y + 3);
      ctx.moveTo(s.x + 17, s.y + 4); ctx.lineTo(s.x + 21, s.y - 2); ctx.lineTo(s.x + 22, s.y + 7);
      ctx.fill();
    }

    const headX = b.facing > 0 ? x + w - 22 : x + 5;
    const headY = y + 13;
    ctx.fillStyle = '#8f734d';
    ctx.beginPath(); ctx.ellipse(headX + (b.facing > 0 ? 3 : 0), headY + 7, 15, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8945e';
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(headX + (b.facing > 0 ? 0 : 5), headY + 1, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Jaw gape is simulation-driven: it opens during the telegraph and snaps
    // shut on release.
    const jaw = b.jaw != null ? b.jaw : 0;
    const mouthX = b.facing > 0 ? x + w - 21 : x + 4;
    ctx.fillStyle = '#1c1720';
    this._roundRect(ctx, mouthX, y + 17 - jaw * 4, 18, 16 + jaw * 8, 7); ctx.fill();
    ctx.fillStyle = '#ead8a5';
    for (let i = 0; i < 4; i++) {
      const tx = b.facing > 0 ? mouthX + 1 + i * 5 : mouthX + 17 - i * 5;
      ctx.beginPath();
      ctx.moveTo(tx, y + 19 - jaw * 3);
      ctx.lineTo(tx + (b.facing > 0 ? 3 : -3), y + 27 - jaw * 3);
      ctx.lineTo(tx + (b.facing > 0 ? 6 : -6), y + 19 - jaw * 3);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = b.telegraph > 0 ? '#ffd28c' : '#ff6b4d';
    ctx.fillRect(b.facing > 0 ? x + w - 30 : x + 13, y + 8, 6, 5);
    ctx.fillStyle = '#25191b';
    ctx.fillRect(b.facing > 0 ? x + w - 28 : x + 14, y + 9, 2, 2);

    // Stone tendrils and feet dig into the ground when it is not airborne.
    ctx.strokeStyle = '#493a32'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 12, y + h - 4); ctx.lineTo(x + 7, y + h + 3);
    ctx.moveTo(x + 27, y + h - 3); ctx.lineTo(x + 30, y + h + 4);
    ctx.moveTo(x + 47, y + h - 4); ctx.lineTo(x + 53, y + h + 2);
    ctx.stroke();
    if (b.telegraph > 0) {
      ctx.strokeStyle = '#d3b985'; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x + w / 2, y + h - 2, 22 + (1 - b.telegraph / (b.telegraphMax || 0.6)) * 10, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.54)'; this._roundRect(ctx, x + 2, y + 7, w - 4, h - 4, 10); ctx.fill(); }
    if (b.invuln > 0) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; this._roundRect(ctx, x + 1, y + 7, w - 2, h - 5, 10); ctx.stroke(); }
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
