/* ==========================================================================
   stats.js — persistent + session statistics
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;

  function blank() {
    return {
      roomsCleared: 0,
      puzzlesSolved: 0,
      mistakes: 0,
      correctActions: 0,   // for accuracy: correct / (correct + mistakes)
      totalTimeMs: 0,
      score: 0,
      bestScore: 0,
      bestRoom: 0,
      plays: 0,            // number of runs started
    };
  }

  const Stats = {
    data: blank(),

    init(saved) {
      this.data = Object.assign(blank(), saved || {});
    },
    reset() { this.data = blank(); },

    accuracy() {
      const d = this.data;
      const denom = d.correctActions + d.mistakes;
      return denom === 0 ? 100 : Math.round((d.correctActions / denom) * 100);
    },

    snapshot() { return Object.assign({}, this.data); },
  };

  PZ.Stats = Stats;
  PZ.blankStats = blank;
})(window);
