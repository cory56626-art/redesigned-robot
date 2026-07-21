// Seedable deterministic RNG (mulberry32) with helpers.

export function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed = Date.now()) {
    this.seed(seed);
  }
  seed(seed) {
    this._s = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1;
    return this;
  }
  /** float [0,1) */
  next() {
    let t = (this._s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** float [min,max) */
  range(min, max) {
    return min + this.next() * (max - min);
  }
  /** int [min,max] inclusive */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }
  /** true with probability p */
  chance(p) {
    return this.next() < p;
  }
  /** pick a random element */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** pick weighted: entries [{item, weight}] */
  weighted(entries) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let r = this.next() * total;
    for (const e of entries) {
      r -= e.weight;
      if (r <= 0) return e.item;
    }
    return entries[entries.length - 1].item;
  }
  /** shuffle in place (Fisher-Yates) */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** approximate normal distribution via sum of uniforms, clamped */
  gaussian(mean = 0, stdev = 1) {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return mean + (s - 3) * stdev;
  }
}

/** A shared, non-deterministic RNG for UI/cosmetic randomness. */
export const rng = new RNG(Date.now());
