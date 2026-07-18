// Summoner Realms — small dependency-free helpers.

// Deterministic PRNG (mulberry32). Returns a function -> float in [0,1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string to a 32-bit integer (for seeds from text).
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 1D value noise built on a seeded PRNG. Smooth interpolation of random points.
export function makeValueNoise(seed) {
  const rand = mulberry32(seed);
  const table = new Float32Array(1024);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (i) => table[((i % table.length) + table.length) % table.length];
  return function (x) {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f); // smoothstep
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

// Axis-aligned bounding-box overlap test. Boxes are {x,y,w,h} (top-left origin).
export function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

export function randRange(rand, lo, hi) {
  return lo + rand() * (hi - lo);
}

export function randInt(rand, lo, hi) {
  return Math.floor(lo + rand() * (hi - lo + 1));
}

export function choice(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

// Short human-friendly id for rooms/players.
export function shortId(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function now() {
  return performance.now() / 1000;
}

// Angle helpers
export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}
