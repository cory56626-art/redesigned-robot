/* ==========================================================================
   registry.js — global puzzle registry.
   Each puzzle module calls PZ.register({...}). The engine reads PZ.puzzles.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  PZ.puzzles = PZ.puzzles || [];
  PZ.puzzleMap = PZ.puzzleMap || {};

  PZ.register = function (def) {
    if (!def || !def.id || typeof def.build !== 'function') {
      console.warn('Invalid puzzle definition', def);
      return;
    }
    if (PZ.puzzleMap[def.id]) {
      console.warn('Duplicate puzzle id:', def.id);
      return;
    }
    def.minDifficulty = def.minDifficulty || 1;
    def.tags = def.tags || [];
    PZ.puzzles.push(def);
    PZ.puzzleMap[def.id] = def;
  };
})(window);
