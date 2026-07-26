// Summoner Realms — minimap UI.
//
// Two views over the same raster: a small always-on corner widget, and a
// fullscreen map you can pan and zoom. Both draw the cached offscreen canvas
// owned by systems/minimap.js and overlay live markers on top.
//
// The HUD root is `pointer-events: none`, so anything interactive here has to
// opt back in — same as `.icon-btn` and `.hotbar` already do.
import { TILE } from '../config.js?v=realms-qor-41';

const WIDGET_W = 168, WIDGET_H = 104;
// Zoom limits for the expanded view, in screen pixels per world tile.
const ZOOM_MIN = 0.6, ZOOM_MAX = 6;

export class MinimapUI {
  constructor(game) {
    this.game = game;
    this.widget = document.getElementById('minimapWidget');
    this.big = document.getElementById('minimapBig');
    this.wctx = this.widget ? this.widget.getContext('2d') : null;
    this.bctx = this.big ? this.big.getContext('2d') : null;

    // Expanded-view camera, in tile space.
    this.zoom = 2;
    this.panX = 0;
    this.panY = 0;
    this.follow = true; // recentre on the player until the map is dragged

    if (this.widget) {
      this.widget.width = WIDGET_W;
      this.widget.height = WIDGET_H;
      this.widget.addEventListener('click', () => this.open());
    }
    this._bindBig();
    const btn = document.getElementById('mbMap');
    if (btn) btn.addEventListener('click', () => this.toggle());
  }

  isOpen() { return this.big && !this.big.parentElement.classList.contains('hidden'); }
  open() {
    if (!this.big) return;
    this.follow = true;
    this.game.ui.menus.show('minimapDialog');
    this._resizeBig();
  }
  close() { if (this.big) this.game.ui.menus.hide('minimapDialog'); }
  toggle() { this.isOpen() ? this.close() : this.open(); }

  _resizeBig() {
    if (!this.big) return;
    const r = this.big.getBoundingClientRect();
    this.big.width = Math.max(64, Math.round(r.width));
    this.big.height = Math.max(64, Math.round(r.height));
  }

  // Drag to pan, wheel or pinch to zoom. The single-pointer half mirrors the
  // pointer-capture pattern the touch joysticks use; the two-pointer half is
  // new, since nothing in the game pinched before.
  _bindBig() {
    const el = this.big;
    if (!el) return;
    const active = new Map(); // pointerId -> {x, y}
    let pinchDist = 0;

    const spread = () => {
      const [a, b] = [...active.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2) pinchDist = spread();
      this.follow = false;
    });

    el.addEventListener('pointermove', (e) => {
      const prev = active.get(e.pointerId);
      if (!prev) return;
      if (active.size === 1) {
        // Pan by the pointer delta, converted from screen px to tiles.
        this.panX -= (e.clientX - prev.x) / this.zoom;
        this.panY -= (e.clientY - prev.y) / this.zoom;
        this._clampPan();
      }
      prev.x = e.clientX; prev.y = e.clientY;
      if (active.size === 2 && pinchDist > 0) {
        const d = spread();
        if (d > 0) { this.setZoom(this.zoom * (d / pinchDist)); pinchDist = d; }
      }
    });

    const up = (e) => {
      active.delete(e.pointerId);
      if (active.size < 2) pinchDist = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    // Scoped to the map surface, so it never fights the hotbar's wheel binding.
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY > 0 ? 0.88 : 1.14));
    }, { passive: false });
  }

  setZoom(z) {
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    this._clampPan();
  }

  _clampPan() {
    const mm = this.game.minimap;
    if (!mm) return;
    this.panX = Math.max(0, Math.min(mm.width, this.panX));
    this.panY = Math.max(0, Math.min(mm.height, this.panY));
  }

  draw() {
    const mm = this.game.minimap;
    if (!mm || !mm.canvas) return;
    const p = this.game.localPlayer;
    if (this.follow && p) {
      this.panX = (p.x + p.w / 2) / TILE;
      this.panY = (p.y + p.h / 2) / TILE;
    }
    if (this.wctx) this._drawView(this.wctx, WIDGET_W, WIDGET_H, 2.2, true);
    if (this.isOpen() && this.bctx) {
      if (this.big.width !== this.big.clientWidth) this._resizeBig();
      this._drawView(this.bctx, this.big.width, this.big.height, this.zoom, false);
    }
  }

  // Shared renderer for both views. `zoom` is screen pixels per world tile.
  _drawView(ctx, w, h, zoom, compact) {
    const game = this.game, mm = game.minimap;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#070a13';
    ctx.fillRect(0, 0, w, h);

    // Centre of the view in tile space.
    const cx = this.panX, cy = this.panY;
    const sx = w / 2 - cx * zoom;
    const sy = h / 2 - cy * zoom;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mm.canvas, sx, sy, mm.width * zoom, mm.height * zoom);

    const toScreen = (wx, wy) => ({ x: sx + (wx / TILE) * zoom, y: sy + (wy / TILE) * zoom });

    // The slice of world the camera is actually showing.
    const cam = game.camera;
    const v0 = toScreen(cam.x - cam.vw / 2, cam.y - cam.vh / 2);
    const v1 = toScreen(cam.x + cam.vw / 2, cam.y + cam.vh / 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);

    // Markers. Bosses and the Guide are worth finding again.
    const dot = (wx, wy, color, r) => {
      const s = toScreen(wx, wy);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    };
    if (game.npc && game.npc.alive) dot(game.npc.x, game.npc.y, '#7ee0c0', compact ? 2 : 3);
    for (const b of game.bosses) if (!b.hidden) dot(b.x, b.y, '#ff6b7d', compact ? 3 : 5);
    for (const pl of game.players.values()) {
      if (!pl.alive) continue;
      const me = pl === game.localPlayer;
      dot(pl.x, pl.y, me ? '#ffcf6b' : pl.color, compact ? 2.5 : 4);
      if (me) {
        const s = toScreen(pl.x, pl.y);
        ctx.strokeStyle = '#ffcf6b';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, compact ? 5 : 8, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();

    // Depth readout, so the map doubles as a depth gauge.
    if (!compact && this.game.localPlayer) {
      const depth = Math.round(this.game.localPlayer.y / TILE);
      ctx.fillStyle = 'rgba(10,14,28,0.8)';
      ctx.fillRect(8, h - 26, 116, 18);
      ctx.fillStyle = '#98a3cf';
      ctx.font = 'bold 11px Trebuchet MS, sans-serif';
      ctx.fillText(`depth ${depth}  ·  zoom ${this.zoom.toFixed(1)}x`, 14, h - 13);
    }
  }
}
