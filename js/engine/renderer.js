// Summoner Realms — canvas renderer. Draws world, lighting, entities, effects.
import { TILE, UNDERGROUND_Y, CAVERN_Y, CORRUPT_X } from '../config.js';
import { T, isSolid } from '../world/tiles.js';
import { Sprites } from '../art/sprites.js';
import { item as getItem } from '../data/items.js';
import { canPlaceAt } from '../systems/combat.js';
import { resolveMineTarget, resolvePlaceTarget } from '../systems/smartcursor.js';
import { currentTarget } from '../systems/autotarget.js';

const PROJ_GLOW = { thorn: '#7ee08a', rock: '#8a7a5a', blight: '#c58bff', voidorb: '#b06bff', spark: '#9ec3ff', wispbolt: '#9ec3ff', emberball: '#ff8c3b' };

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
    const W = this.canvas.width, H = this.canvas.height;
    const cam = this.camera;
    ctx.imageSmoothingEnabled = false;

    this._drawSky(game, W, H);

    ctx.save();
    ctx.translate(W / 2 - cam.x * cam.scale, H / 2 - cam.y * cam.scale);
    ctx.scale(cam.scale, cam.scale);

    // Visible tile range.
    const tx0 = Math.max(0, Math.floor((cam.x - cam.vw / 2) / TILE) - 1);
    const ty0 = Math.max(0, Math.floor((cam.y - cam.vh / 2) / TILE) - 1);
    const tx1 = Math.min(game.world.width - 1, Math.ceil((cam.x + cam.vw / 2) / TILE) + 1);
    const ty1 = Math.min(game.world.height - 1, Math.ceil((cam.y + cam.vh / 2) / TILE) + 1);

    this._drawTiles(game, ctx, tx0, ty0, tx1, ty1);
    this._drawFallingTrees(game, ctx);
    this._drawDrops(game, ctx);
    this._drawMinions(game, ctx);
    this._drawEnemies(game, ctx);
    this._drawBosses(game, ctx);
    this._drawProjectiles(game, ctx);
    this._drawPlayers(game, ctx);
    this._drawAimHighlight(game, ctx);
    this._drawParticles(game, ctx);
    const dbg = game.debug;
    if (dbg && (dbg.collision || dbg.ai || dbg.spawn || dbg.caves)) this._drawDebugWorld(game, ctx, tx0, ty0, tx1, ty1);

    ctx.restore();

    // Lighting overlay (screen-space, smooth). Skipped for the collision/cave
    // debug views so the outlines stay readable.
    if (!(dbg && (dbg.collision || dbg.caves))) this._drawLighting(game, tx0, ty0, tx1, ty1, W, H);

    // Float texts (screen space via camera projection).
    this._drawFloatTexts(game, W, H);
    // Auto-target reticle (screen space, above lighting so it's always visible).
    this._drawTargetReticle(game, W, H);
    if (dbg && dbg.biome) this._drawBiomeLabel(game, W, H);
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
    // AI targets: lines from enemies to players and minions to their targets.
    if (game.debug.ai) {
      ctx.lineWidth = 1;
      for (const e of game.enemies) {
        const t = game.nearestPlayer(e.x + e.w / 2, e.y + e.h / 2);
        if (!t) continue;
        ctx.strokeStyle = 'rgba(255,107,125,0.7)';
        ctx.beginPath(); ctx.moveTo(e.x + e.w / 2, e.y + e.h / 2); ctx.lineTo(t.x + t.w / 2, t.y + t.h / 2); ctx.stroke();
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
    }
  }

  _drawBiomeLabel(game, W, H) {
    const p = game.localPlayer; if (!p) return;
    const tx = Math.floor((p.x + p.w / 2) / TILE), ty = Math.floor((p.y + p.h / 2) / TILE);
    const biome = game.world.biomeAt(tx, ty);
    const ctx = this.ctx;
    ctx.font = 'bold 16px Trebuchet MS, sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText('Biome: ' + biome + '  (tile ' + tx + ',' + ty + ')', W / 2 + 1, 110 + 1);
    ctx.fillStyle = '#7ee0c0'; ctx.fillText('Biome: ' + biome + '  (tile ' + tx + ',' + ty + ')', W / 2, 110);
    ctx.textAlign = 'left';
  }

  _drawSky(game, W, H) {
    const ctx = this.ctx;
    const b = game.time.brightness;
    const player = game.localPlayer;
    const deep = player ? (player.y / TILE > UNDERGROUND_Y) : false;
    // Which surface biome are we over? Tints the sky so biomes read distinctly.
    const corrupt = player ? game.world.biomeAt(Math.floor((player.x + player.w / 2) / TILE), 0) === 'corrupt' : false;
    let top, bot;
    if (deep) {
      const cavern = player && player.y / TILE > CAVERN_Y;
      top = cavern ? '#160a1c' : '#14121c'; bot = cavern ? '#0a0410' : '#08060c';
    } else {
      // Sky colour from brightness; corrupted lands get a sickly violet cast.
      const day = corrupt ? ['#4a2f5a', '#7a5a86'] : ['#3a6ea5', '#8fc0e8'];
      const night = corrupt ? ['#14081e', '#2a1436'] : ['#0a0e22', '#1a1d3a'];
      const mix = (a, b2, t) => a.map((v, i) => Math.round(v + (b2[i] - v) * t));
      const toRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const t = Math.max(0, Math.min(1, (b - 0.12) / 0.88));
      top = `rgb(${mix(toRgb(night[0]), toRgb(day[0]), t).join(',')})`;
      bot = `rgb(${mix(toRgb(night[1]), toRgb(day[1]), t).join(',')})`;
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Stars at night on the surface.
    if (!deep && b < 0.45) {
      ctx.fillStyle = `rgba(255,255,255,${(0.45 - b) * 1.6})`;
      const cam = this.camera;
      for (let i = 0; i < 60; i++) {
        const sx = (i * 137.5 - cam.x * 0.2) % W; const sy = (i * 89.3) % (H * 0.6);
        ctx.fillRect((sx + W) % W, sy, 2, 2);
      }
    }
  }

  _drawTiles(game, ctx, tx0, ty0, tx1, ty1) {
    const world = game.world;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = world.get(tx, ty);
        if (id === T.AIR) continue;
        const spr = Sprites.getTile(id);
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

  _drawAimHighlight(game, ctx) {
    const p = game.localPlayer; if (!p || !p.alive) return;
    const sel = p.inventory.selectedItem();
    const s = game.input.state;
    if (sel && (sel.place != null)) {
      // Ghost preview at the smart-snapped spot: green = can place, red = cannot,
      // with the block's own icon shown faintly so you see what/where you'll build.
      const { tx, ty } = resolvePlaceTarget(game, p, sel);
      const valid = canPlaceAt(game, p, tx, ty, sel).ok;
      const icon = Sprites.getIcon(sel);
      if (icon) { ctx.globalAlpha = valid ? 0.5 : 0.28; ctx.drawImage(icon, tx * TILE, ty * TILE, TILE, TILE); ctx.globalAlpha = 1; }
      ctx.strokeStyle = valid ? 'rgba(126,224,138,0.95)' : 'rgba(255,107,125,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx * TILE + 0.75, ty * TILE + 0.75, TILE - 1.5, TILE - 1.5);
      return;
    }
    // Mining reticle at the tile the smart cursor will actually break — shown for
    // a held tool or whenever the dedicated mine button is down.
    if ((sel && sel.category === 'tool') || s.mineHeld) {
      const tgt = resolveMineTarget(game, p);
      if (tgt) {
        ctx.strokeStyle = 'rgba(255,207,107,0.7)'; ctx.lineWidth = 1;
        ctx.strokeRect(tgt.tx * TILE + 0.5, tgt.ty * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }
  }

  // Four small yellow arrows around the locked enemy that slowly rotate and pulse
  // in size, so the current auto-target is obvious without being distracting.
  // Drawn in screen space (after lighting) so it stays crisp and readable in caves.
  _drawTargetReticle(game, W, H) {
    const p = game.localPlayer; if (!p || !p.alive) return;
    const t = currentTarget(game, p); if (!t) return;
    const cam = this.camera, ctx = this.ctx;
    const sc = cam.worldToScreen(t.x + t.w / 2, t.y + t.h / 2, W, H);
    const s = cam.scale;
    const now = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(now * 3.0);        // smooth 0..1
    const half = Math.max(t.w, t.h) * 0.5 * s;
    const radius = half + (7 + pulse * 4) * s;             // breathing gap
    const arm = (4.5 + pulse * 1.8) * s;                   // arrow size, also pulses
    const rot = now * 0.9;                                 // slow rotation
    ctx.save();
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, s * 0.5);
    for (let i = 0; i < 4; i++) {
      const a = rot + i * (Math.PI / 2);
      ctx.save();
      ctx.translate(sc.x + Math.cos(a) * radius, sc.y + Math.sin(a) * radius);
      ctx.rotate(a);                     // local +x points outward from the enemy
      ctx.beginPath();
      ctx.moveTo(-arm, 0);               // tip toward the enemy centre
      ctx.lineTo(arm * 0.72, -arm * 0.82);
      ctx.lineTo(arm * 0.72, arm * 0.82);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
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
      if (pr.kind === 'arrow' || pr.kind === 'bolt' || pr.rangedKind === 'bow') { ctx.fillRect(-4, -1, 9, 2); }
      else { ctx.fillRect(-2, -2, 4, 4); ctx.fillStyle = '#fff'; ctx.fillRect(-1, -1, 2, 2); }
      ctx.restore();
    }
  }

  _drawEnemies(game, ctx) {
    for (const e of game.enemies) {
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

  _drawBosses(game, ctx) {
    for (const b of game.bosses) {
      const x = b.x, y = b.y, w = b.w, h = b.h;
      const bob = Math.sin(b.bob) * 3;
      ctx.save();
      ctx.translate(0, bob);
      // aura
      ctx.fillStyle = b.color2; ctx.globalAlpha = 0.18 + 0.1 * Math.sin(b.bob * 2);
      this._roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 10); ctx.fill();
      ctx.globalAlpha = 1;
      // body
      ctx.fillStyle = b.color;
      this._roundRect(ctx, x, y, w, h, 8); ctx.fill();
      ctx.fillStyle = b.color2; ctx.globalAlpha = 0.4;
      this._roundRect(ctx, x + 3, y + h * 0.5, w - 6, h * 0.5, 6); ctx.fill();
      ctx.globalAlpha = 1;
      // eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + w * 0.28, y + h * 0.28, w * 0.12, h * 0.1);
      ctx.fillRect(x + w * 0.6, y + h * 0.28, w * 0.12, h * 0.1);
      ctx.fillStyle = '#ff3b5d';
      ctx.fillRect(x + w * 0.31 + (b.facing > 0 ? 3 : 0), y + h * 0.3, 3, 3);
      ctx.fillRect(x + w * 0.63 + (b.facing > 0 ? 3 : 0), y + h * 0.3, 3, 3);
      if (b.hurtFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; this._roundRect(ctx, x, y, w, h, 8); ctx.fill(); }
      if (b.invuln > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; this._roundRect(ctx, x, y, w, h, 8); ctx.stroke(); }
      ctx.restore();
    }
  }

  _drawPlayers(game, ctx) {
    for (const p of game.players.values()) {
      if (!p.alive && p.isLocal) continue; // hidden while dead
      if (!p.alive) continue;
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
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
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

  _drawParticles(game, ctx) {
    for (const pt of game.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  _drawFloatTexts(game, W, H) {
    const ctx = this.ctx; const cam = this.camera;
    ctx.font = 'bold 13px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    for (const ft of game.floatTexts) {
      const s = cam.worldToScreen(ft.x, ft.y, W, H);
      ctx.globalAlpha = Math.max(0, ft.life / ft.max);
      ctx.fillStyle = '#000'; ctx.fillText(ft.text, s.x + 1, s.y + 1);
      ctx.fillStyle = ft.color; ctx.fillText(ft.text, s.x, s.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  _drawLighting(game, tx0, ty0, tx1, ty1, W, H) {
    const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
    if (cols <= 0 || rows <= 0) return;
    const extra = [];
    const p = game.localPlayer;
    if (p) extra.push({ tx: Math.floor((p.x + p.w / 2) / TILE), ty: Math.floor((p.y + p.h / 2) / TILE), level: 0.5 });
    for (const pl of game.players.values()) if (!pl.isLocal) extra.push({ tx: Math.floor((pl.x + pl.w / 2) / TILE), ty: Math.floor((pl.y + pl.h / 2) / TILE), level: 0.35 });
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
    const sx = (tx0 * TILE - cam.x) * cam.scale + W / 2;
    const sy = (ty0 * TILE - cam.y) * cam.scale + H / 2;
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
