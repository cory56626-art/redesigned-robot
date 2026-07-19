/* ==========================================================================
   engine.js — run controller: rooms, puzzle selection, HUD, scoring, saving.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, clear, fmtTime } = PZ;

  const DIFF_EVERY = 3;     // rooms per difficulty step
  const MAX_DIFF = 8;

  function difficultyForRoom(room) {
    return Math.min(MAX_DIFF, 1 + Math.floor((room - 1) / DIFF_EVERY));
  }

  const Engine = {
    mount: null,        // DOM container for the game screen
    hostApp: null,      // reference to App (for screen switches)
    run: null,          // { seed, room, difficulty, forcedPuzzleId }
    ctx: null,
    cleanupFns: [],
    timer: null,
    puzzleStartAt: 0,
    elapsedAtStart: 0,  // accumulated time before this puzzle (for total)
    solved: false,
    els: {},

    init(mount, app) {
      this.mount = mount;
      this.hostApp = app;
      this.buildChrome();
    },

    /* ----- persistent run --------------------------------------------- */
    startRun(run) {
      this.run = Object.assign({ seed: PZ.randomSeed(), room: 1 }, run || {});
      PZ.Stats.data.plays++;
      this.saveProgress();
      this.loadRoom(this.run.room);
    },

    continueRun(saved) {
      this.run = { seed: saved.seed, room: saved.room || 1 };
      this.loadRoom(this.run.room);
    },

    saveProgress() {
      const app = this.hostApp;
      app.persist({ run: { seed: this.run.seed, room: this.run.room } });
    },

    /* ----- puzzle selection ------------------------------------------- */
    pickPuzzle(seed, room) {
      if (this.run && this.run.forcedPuzzleId && room === this.run.room) {
        const forced = PZ.puzzleMap[this.run.forcedPuzzleId];
        if (forced) return forced;
      }
      const level = difficultyForRoom(room);
      const pool = PZ.puzzles.filter(p => p.minDifficulty <= level);
      const use = pool.length ? pool : PZ.puzzles;
      const selRng = PZ.makeRng(seed + '::sel::' + room);
      let idx = selRng.int(0, use.length - 1);
      // Avoid an immediate repeat of the previous room's puzzle.
      if (this._lastPuzzleId && use.length > 1 && use[idx].id === this._lastPuzzleId) {
        idx = (idx + 1 + selRng.int(0, use.length - 2)) % use.length;
      }
      return use[idx];
    },

    instanceId(seed, room) { return seed + ' #' + room; },

    /* ----- loading a room --------------------------------------------- */
    loadRoom(room) {
      this.teardownPuzzle();
      this.run.room = room;
      this.solved = false;
      const difficulty = difficultyForRoom(room);
      this.run.difficulty = difficulty;

      const def = this.pickPuzzle(this.run.seed, room);
      this._currentDef = def;
      this._lastPuzzleId = def.id;

      const instanceSeed = this.run.seed + '::' + room + '::' + def.id;
      const rng = PZ.makeRng(instanceSeed);

      // HUD
      this.els.room.textContent = room;
      this.els.diff.textContent = difficulty;
      this.els.puzzleName.textContent = def.name;
      this.els.puzzleId.textContent = this.instanceId(this.run.seed, room);
      this.els.prompt.innerHTML = '';
      this.els.hint.innerHTML = '';
      this.els.hint.style.display = 'none';
      this.els.category.textContent = def.category || 'puzzle';
      this.els.category.style.setProperty('--cat-hue', String(def.hue || 200));

      clear(this.els.stage);
      this.els.stage.className = 'stage stage-' + def.id;

      this.cleanupFns = [];
      const self = this;
      const ctx = {
        root: this.els.stage,
        rng,
        difficulty,
        seedLabel: this.run.seed,
        room,
        solve() { self.onSolved(); },
        fail(n) { self.onFail(n || 1); },
        good(n) { PZ.Stats.data.correctActions += (n || 1); },
        setPrompt(html) { self.els.prompt.innerHTML = html; },
        setHint(html) {
          self.els.hint.innerHTML = html;
          self.els.hint.style.display = html ? '' : 'none';
        },
        onCleanup(fn) { self.cleanupFns.push(fn); },
        toast(msg, kind) { self.toast(msg, kind); },
      };
      this.ctx = ctx;

      try {
        def.build(ctx);
      } catch (e) {
        console.error('Puzzle build failed:', def.id, e);
        this.els.prompt.innerHTML = 'This puzzle failed to load. Skipping…';
        setTimeout(() => this.nextRoom(), 900);
        return;
      }

      this.startTimer();
      this.saveProgress();
      if (this.hostApp.refreshTestMenu) this.hostApp.refreshTestMenu();
    },

    /* ----- outcomes --------------------------------------------------- */
    onSolved() {
      if (this.solved) return;
      this.solved = true;
      this.stopTimer();

      PZ.Stats.data.puzzlesSolved++;
      PZ.Stats.data.correctActions++;
      PZ.Stats.data.roomsCleared++;

      // Scoring: base by difficulty + speed bonus.
      const secs = (Date.now() - this.puzzleStartAt) / 1000;
      const base = 100 * this.run.difficulty;
      const speedBonus = Math.max(0, Math.round(120 - secs * 2));
      const gained = base + speedBonus;
      PZ.Stats.data.score += gained;
      if (PZ.Stats.data.score > PZ.Stats.data.bestScore) PZ.Stats.data.bestScore = PZ.Stats.data.score;
      if (this.run.room > PZ.Stats.data.bestRoom) PZ.Stats.data.bestRoom = this.run.room;

      this.updateHud();
      this.hostApp.persistStats();
      this.celebrate(gained);
    },

    onFail(n) {
      PZ.Stats.data.mistakes += n;
      this.updateHud();
      this.hostApp.persistStats();
      this.els.stage.classList.remove('shake');
      void this.els.stage.offsetWidth;
      this.els.stage.classList.add('shake');
      this.toast('Mistake', 'bad');
    },

    celebrate(gained) {
      const overlay = el('div', { class: 'solve-overlay' }, [
        el('div', { class: 'solve-card' }, [
          el('div', { class: 'solve-check', html: '&#10003;' }),
          el('div', { class: 'solve-title', text: 'Room Cleared' }),
          el('div', { class: 'solve-points', text: '+' + gained + ' pts' }),
          el('button', {
            class: 'btn btn-primary solve-next',
            text: 'Next Room  →',
            onClick: () => this.nextRoom(),
          }),
        ]),
      ]);
      this.els.stage.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      spawnConfetti(overlay);
      // Auto-advance if left idle.
      this._autoNext = setTimeout(() => this.nextRoom(), 4200);
    },

    nextRoom() {
      if (this._autoNext) { clearTimeout(this._autoNext); this._autoNext = null; }
      if (this.run.forcedPuzzleId) this.run.forcedPuzzleId = null;
      this.loadRoom(this.run.room + 1);
    },

    /* ----- test-menu operations --------------------------------------- */
    resetPuzzle() { this.loadRoom(this.run.room); },
    replayPuzzle() { this.loadRoom(this.run.room); },
    skipPuzzle() {
      if (this._autoNext) { clearTimeout(this._autoNext); this._autoNext = null; }
      this.run.forcedPuzzleId = null;
      this.loadRoom(this.run.room + 1);
    },
    jumpToRoom(room) {
      room = Math.max(1, Math.floor(room) || 1);
      this.run.forcedPuzzleId = null;
      this.loadRoom(room);
    },
    setSeed(seed) {
      this.run.seed = String(seed || PZ.randomSeed()).trim() || PZ.randomSeed();
      this._lastPuzzleId = null;
      this.loadRoom(this.run.room);
    },
    randomPuzzle() {
      this.run.seed = PZ.randomSeed();
      this._lastPuzzleId = null;
      this.run.forcedPuzzleId = null;
      this.loadRoom(this.run.room);
    },
    forcePuzzleType(id) {
      if (!PZ.puzzleMap[id]) return;
      this.run.forcedPuzzleId = id;
      this.loadRoom(this.run.room);
    },
    currentDef() { return this._currentDef; },

    /* ----- timer / hud ------------------------------------------------- */
    startTimer() {
      this.puzzleStartAt = Date.now();
      this.stopTimer();
      this.timer = setInterval(() => this.tickTimer(), 250);
      this.tickTimer();
    },
    stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
    tickTimer() {
      const cur = Date.now() - this.puzzleStartAt;
      this.els.timer.textContent = fmtTime(cur);
    },

    updateHud() {
      const d = PZ.Stats.data;
      this.els.score.textContent = d.score.toLocaleString();
      this.els.mistakes.textContent = d.mistakes;
      this.els.accuracy.textContent = PZ.Stats.accuracy() + '%';
    },

    teardownPuzzle() {
      this.stopTimer();
      if (this._autoNext) { clearTimeout(this._autoNext); this._autoNext = null; }
      for (const fn of this.cleanupFns) { try { fn(); } catch (e) { /* ignore */ } }
      this.cleanupFns = [];
    },

    /* ----- feedback toast --------------------------------------------- */
    toast(msg, kind) {
      const t = el('div', { class: 'toast ' + (kind || '') , text: msg });
      this.els.toasts.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 300);
      }, 1100);
    },

    /* ----- chrome (built once) ---------------------------------------- */
    buildChrome() {
      const E = {};
      const hud = el('div', { class: 'hud' }, [
        el('div', { class: 'hud-left' }, [
          el('button', { class: 'icon-btn', title: 'Menu', html: '&#9776;',
            onClick: () => this.hostApp.showTitle() }),
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Room' }),
            (E.room = el('span', { class: 'hud-value', text: '1' })),
          ]),
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Level' }),
            (E.diff = el('span', { class: 'hud-value', text: '1' })),
          ]),
        ]),
        el('div', { class: 'hud-mid' }, [
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Score' }),
            (E.score = el('span', { class: 'hud-value', text: '0' })),
          ]),
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Accuracy' }),
            (E.accuracy = el('span', { class: 'hud-value', text: '100%' })),
          ]),
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Mistakes' }),
            (E.mistakes = el('span', { class: 'hud-value', text: '0' })),
          ]),
          el('div', { class: 'hud-stat' }, [
            el('span', { class: 'hud-label', text: 'Time' }),
            (E.timer = el('span', { class: 'hud-value', text: '0:00' })),
          ]),
        ]),
        el('div', { class: 'hud-right' }, [
          el('button', { class: 'icon-btn', title: 'Test / Demo menu', html: '&#9881;',
            onClick: () => this.hostApp.toggleTestMenu() }),
        ]),
      ]);

      const infobar = el('div', { class: 'infobar' }, [
        (E.category = el('span', { class: 'cat-chip', text: 'puzzle' })),
        (E.puzzleName = el('span', { class: 'puzzle-name', text: '' })),
        el('span', { class: 'spacer' }),
        el('span', { class: 'id-label', text: 'ID' }),
        (E.puzzleId = el('span', { class: 'puzzle-id', text: '' })),
      ]);

      E.prompt = el('div', { class: 'prompt' });
      E.hint = el('div', { class: 'hint', style: { display: 'none' } });
      E.stage = el('div', { class: 'stage' });
      E.toasts = el('div', { class: 'toast-layer' });

      const controls = el('div', { class: 'stage-controls' }, [
        el('button', { class: 'btn btn-ghost', text: 'Reset',
          onClick: () => this.resetPuzzle() }),
        el('button', { class: 'btn btn-ghost', text: 'Skip →',
          onClick: () => this.skipPuzzle() }),
      ]);

      const wrap = el('div', { class: 'game-wrap' }, [
        hud,
        infobar,
        E.prompt,
        E.hint,
        el('div', { class: 'stage-frame' }, [E.stage, E.toasts]),
        controls,
      ]);

      clear(this.mount).appendChild(wrap);
      this.els = E;
      this.updateHud();
    },
  };

  /* confetti — pure DOM, no libs */
  function spawnConfetti(host) {
    const colors = ['#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#b5179e', '#7bdff2'];
    for (let i = 0; i < 26; i++) {
      const c = el('div', { class: 'confetti' });
      c.style.left = (10 + Math.random() * 80) + '%';
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDelay = (Math.random() * 0.3) + 's';
      c.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      host.appendChild(c);
      setTimeout(() => c.remove(), 2200);
    }
  }

  Engine.difficultyForRoom = difficultyForRoom;
  PZ.Engine = Engine;
})(window);
