// Canvas2D fallback renderer (top-down). Used when WebGL is unavailable. Reads the same
// match state as the 3D renderer.
import { PITCH } from '../sim/const.js';

export class Scene2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'broadcast';
  }
  setMode() {}
  resize() {}
  dispose() {}

  render(state) {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (c.clientWidth || 800) * dpr, h = (c.clientHeight || 500) * dpr;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);

    // fit pitch (rotated so length is horizontal) with margin
    const pad = 24 * dpr;
    const availW = c.width - pad * 2, availH = c.height - pad * 2;
    const scale = Math.min(availW / PITCH.L, availH / PITCH.W);
    const fieldW = PITCH.L * scale, fieldH = PITCH.W * scale;
    const ox = (c.width - fieldW) / 2, oy = (c.height - fieldH) / 2;
    // sim(x:0..W across, y:0..L length). Draw length horizontally: X = y, Y = x.
    const SX = (px, py) => ox + py * scale;
    const SY = (px, py) => oy + px * scale;

    // grass
    g.fillStyle = '#2f9e46'; g.fillRect(ox, oy, fieldW, fieldH);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2 * dpr;
    g.strokeRect(ox, oy, fieldW, fieldH);
    // halfway
    g.beginPath(); g.moveTo(ox + fieldW / 2, oy); g.lineTo(ox + fieldW / 2, oy + fieldH); g.stroke();
    g.beginPath(); g.arc(ox + fieldW / 2, oy + fieldH / 2, 9.15 * scale, 0, Math.PI * 2); g.stroke();
    // boxes
    for (const end of [0, 1]) {
      const bx = end === 0 ? ox : ox + fieldW - 16.5 * scale;
      g.strokeRect(bx, oy + fieldH / 2 - 20.15 * scale, 16.5 * scale, 40.3 * scale);
    }

    // players
    for (const p of state.players) {
      const x = SX(p.pos.x, p.pos.y), y = SY(p.pos.x, p.pos.y);
      g.beginPath(); g.arc(x, y, 6 * dpr, 0, Math.PI * 2);
      g.fillStyle = state.teams[p.team].colors[0];
      g.fill();
      g.lineWidth = 1.5 * dpr; g.strokeStyle = p.isGK ? '#ffd23f' : 'rgba(0,0,0,0.5)'; g.stroke();
    }
    // ball
    const bx = SX(state.ball.x, state.ball.y), by = SY(state.ball.x, state.ball.y);
    g.beginPath(); g.arc(bx, by, 4 * dpr, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 1 * dpr; g.stroke();
  }
}
