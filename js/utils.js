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

// 2D value noise on a hashed lattice, smoothstep-interpolated. Deterministic
// from the seed and free of any allocation, so worldgen can sample it densely.
export function makeValueNoise2D(seed) {
  const s = seed >>> 0;
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + s) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

// Fractal Brownian motion: several octaves of value noise summed with falling
// amplitude. This is what gives terrain large landforms *and* fine detail
// instead of one frequency's worth of bumpiness.
export function makeFbm1D(seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  const layers = [];
  for (let i = 0; i < octaves; i++) layers.push(makeValueNoise((seed + Math.imul(i, 0x9e3779b1)) >>> 0));
  return function (x, weights) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < layers.length; i++) {
      const w = weights && i > 0 ? weights : 1;
      sum += layers[i](x * freq) * amp * w;
      norm += amp * w;
      amp *= gain; freq *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0.5;
  };
}

export function makeFbm2D(seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  const layers = [];
  for (let i = 0; i < octaves; i++) layers.push(makeValueNoise2D((seed + Math.imul(i, 0x9e3779b1)) >>> 0));
  return function (x, y) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < layers.length; i++) {
      sum += layers[i](x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(a, b, t) {
  const x = clamp((t - a) / (b - a || 1), 0, 1);
  return x * x * (3 - 2 * x);
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

/**
 * Shortest distance from a point to a line segment. Used to pick which of a
 * formation's strands is nearest the player, so an attack that runs along a
 * line can aim with the geometry it actually has.
 */
export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
