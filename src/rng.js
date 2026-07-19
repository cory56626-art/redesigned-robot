/* ==========================================================================
   rng.js — deterministic, seedable pseudo-random generator (mulberry32)
   A given seed always reproduces the same puzzle stream, so puzzle IDs and
   random seeds in the test menu are fully reproducible.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;

  // Hash an arbitrary string/number into a 32-bit seed.
  function hashSeed(str) {
    str = String(str);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  // Returns a function that yields floats in [0,1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    const fn = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Convenience helpers bound to the stream:
    fn.int = (lo, hi) => lo + Math.floor(fn() * (hi - lo + 1));      // inclusive
    fn.float = (lo, hi) => lo + fn() * (hi - lo);
    fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
    fn.chance = (p) => fn() < p;
    fn.shuffle = (arr) => PZ.shuffle(arr, fn);
    return fn;
  }

  function makeRng(seed) {
    return mulberry32(typeof seed === 'number' ? (seed >>> 0) : hashSeed(seed));
  }

  // Generate a fresh random human-friendly seed string.
  function randomSeed() {
    const words = ['nova', 'echo', 'flux', 'orbit', 'pixel', 'zephyr', 'quartz',
      'cobalt', 'ember', 'lumen', 'vertex', 'raven', 'onyx', 'delta', 'gamma',
      'helix', 'pulse', 'cipher', 'prism', 'aurora'];
    const a = words[Math.floor(Math.random() * words.length)];
    const b = words[Math.floor(Math.random() * words.length)];
    const n = Math.floor(Math.random() * 9000) + 1000;
    return a + '-' + b + '-' + n;
  }

  PZ.makeRng = makeRng;
  PZ.hashSeed = hashSeed;
  PZ.randomSeed = randomSeed;
})(window);
