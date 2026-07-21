// Generates the pitch texture (mown grass stripes + white line markings) and a crowd texture
// on 2D canvases, for use as WebGL textures. Keeps the field looking real without art assets.
import { PITCH } from '../sim/const.js';

export function makePitchTexture() {
  const cw = 544, ch = Math.round((PITCH.L / PITCH.W) * 544); // ~840
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d');
  const sx = cw / PITCH.W, sy = ch / PITCH.L;
  const X = (x) => x * sx, Y = (y) => y * sy;

  // Mown stripes.
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f9e46' : '#37ab4f';
    g.fillRect(0, (i / stripes) * ch, cw, (ch / stripes) + 1);
  }
  // Vignette-ish darkening at edges for depth.
  const grad = g.createRadialGradient(cw / 2, ch / 2, ch * 0.2, cw / 2, ch / 2, ch * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad; g.fillRect(0, 0, cw, ch);

  // Line markings.
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(2, sx * 0.28);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  const m = 3; // touchline inset (m)
  // outer boundary
  g.strokeRect(X(m), Y(m), X(PITCH.W - 2 * m) - X(0), Y(PITCH.L - 2 * m) - Y(0));
  // halfway line
  line(g, X(m), Y(PITCH.L / 2), X(PITCH.W - m), Y(PITCH.L / 2));
  // centre circle + spot
  circle(g, X(PITCH.W / 2), Y(PITCH.L / 2), 9.15 * sx, false);
  circle(g, X(PITCH.W / 2), Y(PITCH.L / 2), sx * 0.5, true);
  // penalty + goal areas, both ends
  for (const end of [0, 1]) {
    const gy = end === 0 ? m : PITCH.L - m;
    const dir = end === 0 ? 1 : -1;
    // penalty area 40.3 wide, 16.5 deep
    rect(g, X(PITCH.W / 2 - 20.15), Y(gy), X(40.3) - X(0), (Y(16.5) - Y(0)) * dir);
    // goal area 18.32 wide, 5.5 deep
    rect(g, X(PITCH.W / 2 - 9.16), Y(gy), X(18.32) - X(0), (Y(5.5) - Y(0)) * dir);
    // penalty spot
    circle(g, X(PITCH.W / 2), Y(gy + dir * 11), sx * 0.5, true);
    // penalty arc
    arc(g, X(PITCH.W / 2), Y(gy + dir * 11), 9.15 * sx, dir);
  }
  return c;
}

function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function circle(g, cx, cy, r, fill) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); fill ? g.fill() : g.stroke(); }
function rect(g, x, y, w, h) { g.beginPath(); g.rect(x, y, w, h); g.stroke(); }
function arc(g, cx, cy, r, dir) {
  g.beginPath();
  if (dir > 0) g.arc(cx, cy, r, 0.28 * Math.PI, 0.72 * Math.PI);
  else g.arc(cx, cy, r, 1.28 * Math.PI, 1.72 * Math.PI);
  g.stroke();
}

export function makeCrowdTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#20242e'; g.fillRect(0, 0, 128, 128);
  const cols = ['#e8e8ef', '#c94b4b', '#4b74c9', '#e0b24b', '#3fae6a', '#b0b6c2', '#d98a3d'];
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.globalAlpha = 0.5 + Math.random() * 0.5;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2.4, 2.4);
  }
  g.globalAlpha = 1;
  return c;
}
