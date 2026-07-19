/* ==========================================================================
   storage.js — localStorage persistence with graceful fallback
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const KEY = 'puzzlelab.save.v1';

  const mem = {}; // fallback if localStorage unavailable (e.g. strict privacy mode)
  let usable = true;
  try {
    const t = '__pz_test__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
  } catch (e) { usable = false; }

  function rawGet(k) {
    try { return usable ? localStorage.getItem(k) : (mem[k] || null); }
    catch (e) { return mem[k] || null; }
  }
  function rawSet(k, v) {
    try { if (usable) localStorage.setItem(k, v); else mem[k] = v; }
    catch (e) { mem[k] = v; }
  }
  function rawDel(k) {
    try { if (usable) localStorage.removeItem(k); else delete mem[k]; }
    catch (e) { delete mem[k]; }
  }

  const Storage = {
    load() {
      const raw = rawGet(KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    save(obj) { rawSet(KEY, JSON.stringify(obj)); },
    clear() { rawDel(KEY); },
    available: usable,
  };

  PZ.Storage = Storage;
})(window);
