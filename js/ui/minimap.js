// Summoner Realms — minimap.
//
// Three sizes: a corner badge, a medium panel, and fullscreen. The corner badge
// follows the player; the larger ones can be dragged to pan and pinched or
// wheeled to zoom, so a big world is actually navigable rather than being a
// thumbnail you squint at.
//
// Only tiles the player has been near are drawn. Exploration is stored as a bit
// per tile in a Uint8Array and saved with the world, so the map you uncovered
// is still uncovered when you come back.
//
// Everything is pointer-event driven rather than mouse-specific, so drag, pan
// and pinch all work under touch without a second code path.
import { TILE, UNDERGROUND_Y, CAVERN_Y } from '../config.js?v=snowy-taiga-combat-aidan-1';
import { T, isSolid, tileDef } from '../world/tiles.js?v=snowy-taiga-combat-aidan-1';
import { hasWall } from '../world/walls.js?v=snowy-taiga-combat-aidan-1';

// Radius around the player, in tiles, that counts as explored.
const REVEAL_RADIUS = 26;
// How often to fold the player's surroundings into the explored set. Every
// frame would be wasted work — the player cannot outrun this.
const REVEAL_INTERVAL = 0.25;

const MODES = ['corner', 'panel', 'full'];

// Colours are deliberately flatter and more saturated than the tile art: a map
// has to be readable at one pixel per tile, where texture is noise.
const MAP_COLORS = {
  [T.DIRT]: '#6b4a2b', [T.GRASS]: '#4a8f3c', [T.STONE]: '#6f7484',
  [T.CLAY]: '#9a5b45', [T.SAND]: '#d8c98a', [T.SANDSTONE]: '#bfa367',
  [T.SNOW]: '#dfe8f4', [T.ICE]: '#a8cfe4', [T.DEEPSTONE]: '#4e4a59',
  [T.BLIGHTGRASS]: '#6d3f8a', [T.BLIGHTSTONE]: '#4a2f66',
  [T.WOOD]: '#7a5228', [T.FROSTWOOD]: '#6a5b4c',
  [T.LEAVES]: '#3e7a34', [T.FROSTLEAVES]: '#2f5c4a',
  [T.PLANKS]: '#a67c46', [T.STONEBRICK]: '#7c8296',
  // Ores are drawn bright: finding one on the map is the point.
  [T.CUPRITE]: '#e08a5a', [T.IRONVEIN]: '#c0c6d2', [T.GLIMMER]: '#ffe08a',
  [T.AETHERITE]: '#8ad9ff', [T.BLIGHTORE]: '#c58bff',
  [T.TORCH]: '#ffb347', [T.BENCH]: '#8a6a3a', [T.SMELTERY]: '#ff9a4a',
  [T.FORGE]: '#ff7a3b', [T.ALTAR]: '#7aa2ff',
};

export class Minimap {
  constructor(game) {
    this.game = game;
    this.mode = 'corner';
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.wrap = document.getElementById('minimapWrap');
    this.explored = null;
    this.world = null;
    this._revealT = 0;
    // Pan offset in tiles, relative to the player. Reset whenever the map is
    // recentred, so opening it always shows you first.
    this.panX = 0; this.panY = 0;
    this.scale = 2;           // screen pixels per tile
    this._drag = null;
    this._pointers = new Map();
    this._pinch = 0;
    this._wire();
  }

  _wire() {
    if (!this.canvas) return;
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      if (this.mode === 'corner') { this.cycle(); return; }
      c.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) this._drag = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      else if (this._pointers.size === 2) this._pinch = this._pinchDist();
      e.preventDefault();
    });

    c.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size >= 2) {
        const d = this._pinchDist();
        if (this._pinch > 0) {
          const ratio = d / this._pinch;
          if (ratio > 1.15) { this.zoom(1); this._pinch = d; }
          else if (ratio < 0.87) { this.zoom(-1); this._pinch = d; }
        }
        return;
      }
      if (!this._drag) return;
      this.panX = this._drag.panX - (e.clientX - this._drag.x) / this.scale;
      this.panY = this._drag.panY - (e.clientY - this._drag.y) / this.scale;
    });

    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = 0;
      if (this._pointers.size === 0) this._drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    c.addEventListener('wheel', (e) => {
      if (this.mode === 'corner') return;
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? -1 : 1);
    }, { passive: false });

    const btn = document.getElementById('minimapToggle');
    if (btn) btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.cycle(); });
    const close = document.getElementById('minimapClose');
    if (close) close.addEventListener('pointerdown', (e) => { e.preventDefault(); this.setMode('corner'); });
  }

  _pinchDist() {
    const p = [...this._pointers.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }

  cycle() {
    this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
  }

  setMode(mode) {
    this.mode = mode;
    this.panX = 0; this.panY = 0;
    this.scale = mode === 'corner' ? 1.5 : mode === 'panel' ? 2.5 : 3.5;
    if (this.wrap) {
      this.wrap.classList.remove('corner', 'panel', 'full');
      this.wrap.classList.add(mode);
    }
    this._resize();
  }

  zoom(dir) {
    this.scale = Math.max(1, Math.min(8, this.scale * (dir > 0 ? 1.25 : 0.8)));
  }

  _resize() {
    if (!this.canvas || !this.wrap) return;
    const r = this.wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  // Fold the player's surroundings into the explored set.
  reveal(dt) {
    const g = this.game;
    if (!g.world || !g.localPlayer) return;
    if (this.world !== g.world) {
      this.world = g.world;
      this.explored = new Uint8Array(g.world.width * g.world.height);
    }
    this._revealT -= dt;
    if (this._revealT > 0) return;
    this._revealT = REVEAL_INTERVAL;

    const p = g.localPlayer;
    const cx = Math.floor((p.x + p.w / 2) / TILE), cy = Math.floor((p.y + p.h / 2) / TILE);
    this.revealAround(cx, cy, REVEAL_RADIUS);
  }

  // Reveal a landmark-sized circle without moving the player. NPCs and other
  // future waymarks can call this to make exploration tools feel useful while
  // keeping the normal player-radius reveal unchanged.
  revealAround(cx, cy, radius = REVEAL_RADIUS) {
    const g = this.game;
    if (!g.world) return;
    if (this.world !== g.world || !this.explored || this.explored.length !== g.world.width * g.world.height) {
      this.world = g.world;
      this.explored = new Uint8Array(g.world.width * g.world.height);
    }
    const centerX = Math.floor(Number(cx) || 0), centerY = Math.floor(Number(cy) || 0);
    const r = Math.max(1, Math.floor(Number(radius) || REVEAL_RADIUS));
    const r2 = r * r;
    const W = g.world.width, H = g.world.height;
    for (let dy = -r; dy <= r; dy++) {
      const ty = centerY + dy;
      if (ty < 0 || ty >= H) continue;
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = centerX + dx;
        if (tx < 0 || tx >= W) continue;
        this.explored[ty * W + tx] = 1;
      }
    }
  }

  draw() {
    if (!this.ctx || !this.game.world || !this.game.localPlayer) return;
    if (this.wrap && this.wrap.classList.contains('hidden')) return;
    this._resize();

    const g = this.game, world = g.world, ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    const s = this.scale;
    const p = g.localPlayer;

    // Centre on the player plus whatever the player has panned to.
    const cx = (p.x + p.w / 2) / TILE + this.panX;
    const cy = (p.y + p.h / 2) / TILE + this.panY;
    const tx0 = Math.max(0, Math.floor(cx - cw / (2 * s)));
    const ty0 = Math.max(0, Math.floor(cy - ch / (2 * s)));
    const tx1 = Math.min(world.width - 1, Math.ceil(cx + cw / (2 * s)));
    const ty1 = Math.min(world.height - 1, Math.ceil(cy + ch / (2 * s)));

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, cw, ch);

    const toScreenX = (tx) => (tx - cx) * s + cw / 2;
    const toScreenY = (ty) => (ty - cy) * s + ch / 2;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.explored || !this.explored[ty * world.width + tx]) continue;
        const id = world.get(tx, ty);
        let col;
        if (id === T.AIR) {
          const lvl = world.liquid ? world.liquid.get(tx, ty) : 0;
          if (lvl > 0) col = '#2f6fbf';
          else if (hasWall(world.getWall(tx, ty))) col = '#241d2e';   // walled cave
          else if (ty < world.surfaceY(tx)) col = '#1d2b40';          // open sky
          else col = '#141019';
        } else {
          col = MAP_COLORS[id];
          if (!col) col = tileDef(id).color || '#555';
        }
        ctx.fillStyle = col;
        ctx.fillRect(Math.floor(toScreenX(tx)), Math.floor(toScreenY(ty)), Math.ceil(s), Math.ceil(s));
      }
    }

    // Depth guides, so you can tell at a glance which layer you are looking at.
    if (this.mode !== 'corner') {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const [row, label] of [[UNDERGROUND_Y, 'Underground'], [CAVERN_Y, 'Caverns']]) {
        const y = Math.floor(toScreenY(row)) + 0.5;
        if (y < 0 || y > ch) continue;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.32)';
        ctx.font = '9px Trebuchet MS, sans-serif';
        ctx.fillText(label, 4, y - 3);
        ctx.setLineDash([4, 4]);
      }
      ctx.setLineDash([]);
    }

    // Markers, largest and least important first.
    const marker = (wx, wy, color, size, ring) => {
      const mx = toScreenX(wx / TILE), my = toScreenY(wy / TILE);
      if (mx < -8 || my < -8 || mx > cw + 8 || my > ch + 8) return;
      if (ring) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(mx, my, size + 2.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(mx, my, size, 0, Math.PI * 2); ctx.fill();
    };

    for (const npc of g.npcs || (g.npc ? [g.npc] : [])) {
      if (!npc || !npc.alive) continue;
      marker(npc.x + npc.w / 2, npc.y, npc.kind === 'snowkeeper' ? '#b9f4ff' : '#7aa2ff', 2.2);
    }
    for (const c of g.critters || []) marker(c.x + c.w / 2, c.y, '#9ee07e', 1.4);
    for (const e of g.enemies) marker(e.x + e.w / 2, e.y, '#ff6b7d', 1.8);
    for (const b of g.bosses) marker(b.x + b.w / 2, b.y, '#ff3b5d', 4, true);
    for (const pl of g.players.values()) {
      if (pl === p) continue;
      marker(pl.x + pl.w / 2, pl.y, pl.color, 2.4);
    }
    // The local player last, so nothing ever covers it.
    marker(p.x + p.w / 2, p.y + p.h / 2, '#ffffff', 2.6, true);

    // When the view has been panned away, show where the player actually is.
    if (this.panX !== 0 || this.panY !== 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px Trebuchet MS, sans-serif';
      ctx.fillText('drag to pan · double-tap to recentre', 6, ch - 6);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, cw - 1, ch - 1);
  }

  recentre() { this.panX = 0; this.panY = 0; }

  // ---- Save/load ----
  // Stored as a run-length encoding of the explored bitmap: a world is 182,000
  // tiles and exploration is extremely clustered, so RLE turns a 182KB array
  // into a few hundred numbers.
  serialize() {
    if (!this.explored) return [];
    const out = [];
    let cur = this.explored[0], run = 1;
    for (let i = 1; i < this.explored.length; i++) {
      if (this.explored[i] === cur) { run++; continue; }
      out.push(cur, run);
      cur = this.explored[i]; run = 1;
    }
    out.push(cur, run);
    return out;
  }

  deserialize(arr, world) {
    this.world = world;
    this.explored = new Uint8Array(world.width * world.height);
    if (!Array.isArray(arr) || !arr.length) return;
    let i = 0;
    for (let k = 0; k + 1 < arr.length; k += 2) {
      const v = arr[k], n = arr[k + 1];
      if (v) this.explored.fill(1, i, Math.min(this.explored.length, i + n));
      i += n;
      if (i >= this.explored.length) break;
    }
  }
}
