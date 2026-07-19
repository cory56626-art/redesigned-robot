/* ==========================================================================
   main.js — App controller: screens, title, stats, test/demo menu, boot.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, clear } = PZ;

  const App = {
    root: null,
    screens: {},
    testOpen: false,

    init() {
      this.root = document.getElementById('app');
      // load save
      const saved = PZ.Storage.load();
      PZ.Stats.init(saved && saved.stats);
      this.savedRun = saved && saved.run ? saved.run : null;

      this.screens.title = el('div', { class: 'screen screen-title' });
      this.screens.game = el('div', { class: 'screen screen-game' });
      this.screens.stats = el('div', { class: 'screen screen-stats' });
      this.testPanel = el('div', { class: 'test-panel hidden' });
      clear(this.root);
      this.root.appendChild(this.screens.title);
      this.root.appendChild(this.screens.game);
      this.root.appendChild(this.screens.stats);
      this.root.appendChild(this.testPanel);

      PZ.Engine.init(this.screens.game, this);
      this.buildTitle();
      this.buildTestPanel();
      this.showTitle();
    },

    /* ----- persistence ----- */
    write() {
      const run = PZ.Engine.run ? { seed: PZ.Engine.run.seed, room: PZ.Engine.run.room } : this.savedRun;
      PZ.Storage.save({ run, stats: PZ.Stats.snapshot() });
      this.savedRun = run;
    },
    persist() { this.write(); },
    persistStats() { this.write(); },

    /* ----- screen switching ----- */
    show(name) {
      for (const k in this.screens) this.screens[k].classList.toggle('active', k === name);
      if (name !== 'game') this.closeTestMenu();
    },
    showTitle() {
      this.refreshTitle();
      this.show('title');
    },
    showStats() { this.buildStats(); this.show('stats'); },

    startNewRun() {
      PZ.Engine.startRun({ seed: PZ.randomSeed(), room: 1 });
      this.show('game');
    },
    continueRun() {
      if (this.savedRun) { PZ.Engine.continueRun(this.savedRun); this.show('game'); }
      else this.startNewRun();
    },

    /* ----- title screen ----- */
    buildTitle() {
      const inner = el('div', { class: 'title-inner' });
      inner.appendChild(el('div', { class: 'logo' }, [
        el('span', { class: 'logo-mark', html: logoSvg() }),
        el('h1', { class: 'title-h1', text: 'PUZZLE LAB' }),
        el('p', { class: 'title-sub', text: 'A mouse-only puzzle adventure for humans & machines' }),
      ]));
      this.titleButtons = el('div', { class: 'title-buttons' });
      inner.appendChild(this.titleButtons);
      inner.appendChild(el('div', { class: 'title-foot' }, [
        el('p', { html: 'Every room is a fresh puzzle. ' + PZ.puzzles.length + ' puzzle mechanics · endless layouts · progress saved automatically.' }),
        el('p', { class: 'title-hint', html: 'Tip: open the <b>⚙ Test Menu</b> in-game to jump to any puzzle, reroll seeds, or replay.' }),
      ]));
      clear(this.screens.title).appendChild(inner);
    },
    refreshTitle() {
      const b = clear(this.titleButtons);
      if (this.savedRun && this.savedRun.room > 1) {
        b.appendChild(el('button', { class: 'btn btn-primary btn-big', text: 'Continue — Room ' + this.savedRun.room, onClick: () => this.continueRun() }));
        b.appendChild(el('button', { class: 'btn btn-ghost btn-big', text: 'New Run', onClick: () => this.confirmNew() }));
      } else {
        b.appendChild(el('button', { class: 'btn btn-primary btn-big', text: 'Play', onClick: () => this.startNewRun() }));
      }
      b.appendChild(el('button', { class: 'btn btn-ghost btn-big', text: 'Statistics', onClick: () => this.showStats() }));
      b.appendChild(el('button', { class: 'btn btn-ghost btn-big', text: 'How to Play', onClick: () => this.showHelp() }));
    },
    confirmNew() {
      if (confirm('Start a new run? Your current room progress will be replaced (statistics are kept).')) this.startNewRun();
    },

    showHelp() {
      const rows = [
        ['Goal', 'Clear one puzzle per room. Each room is randomly generated — solve it to advance. Difficulty rises as you go.'],
        ['Controls', 'Mouse only (or touch on mobile): click, drag, draw, and rotate. No keyboard is ever required.'],
        ['Everything is visible', 'Rules, equations and hints are always shown on screen — nothing needed to solve is hidden.'],
        ['Saving', 'Your seed, current room and lifetime statistics are stored in your browser automatically.'],
        ['Test Menu', 'The ⚙ button in-game lets you jump to any room, pick a puzzle type, reroll the seed, reset, replay or skip.'],
      ];
      const overlay = el('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) overlay.remove(); } }, [
        el('div', { class: 'modal' }, [
          el('h2', { text: 'How to Play' }),
          el('div', { class: 'help-rows' }, rows.map(([h, t]) => el('div', { class: 'help-row' }, [el('h3', { text: h }), el('p', { text: t })]))),
          el('button', { class: 'btn btn-primary', text: 'Got it', onClick: () => overlay.remove() }),
        ]),
      ]);
      this.root.appendChild(overlay);
    },

    /* ----- stats screen ----- */
    buildStats() {
      const d = PZ.Stats.data;
      const items = [
        ['Rooms cleared', d.roomsCleared],
        ['Puzzles solved', d.puzzlesSolved],
        ['Accuracy', PZ.Stats.accuracy() + '%'],
        ['Mistakes', d.mistakes],
        ['Total score', d.score.toLocaleString()],
        ['Best score', d.bestScore.toLocaleString()],
        ['Deepest room', d.bestRoom],
        ['Runs started', d.plays],
      ];
      const grid = el('div', { class: 'stats-grid' }, items.map(([k, v]) =>
        el('div', { class: 'stat-card' }, [el('div', { class: 'stat-val', text: String(v) }), el('div', { class: 'stat-key', text: k })])));
      const inner = el('div', { class: 'stats-inner' }, [
        el('h2', { text: 'Statistics' }),
        grid,
        el('div', { class: 'stats-actions' }, [
          el('button', { class: 'btn btn-primary', text: '← Back', onClick: () => this.showTitle() }),
          el('button', { class: 'btn btn-danger', text: 'Reset stats', onClick: () => { if (confirm('Erase all statistics?')) { PZ.Stats.reset(); this.write(); this.buildStats(); } } }),
        ]),
      ]);
      clear(this.screens.stats).appendChild(inner);
    },

    /* ----- test / demo menu ----- */
    buildTestPanel() {
      const p = this.testPanel;
      const seedInput = el('input', { class: 'test-input', type: 'text', placeholder: 'seed' });
      const roomInput = el('input', { class: 'test-input', type: 'number', min: '1', value: '1' });
      const typeSelect = el('select', { class: 'test-input' });
      typeSelect.appendChild(el('option', { value: '', text: '— random per room —' }));
      PZ.puzzles.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(pz =>
        typeSelect.appendChild(el('option', { value: pz.id, text: pz.name })));

      this.testEls = { seedInput, roomInput, typeSelect };
      const idReadout = el('div', { class: 'test-id', text: '' });
      this.testEls.idReadout = idReadout;

      const field = (label, node) => el('div', { class: 'test-field' }, [el('label', { text: label }), node]);
      const btn = (label, cls, fn) => el('button', { class: 'btn btn-small ' + (cls || 'btn-ghost'), text: label, onClick: fn });

      p.appendChild(el('div', { class: 'test-head' }, [
        el('span', { text: '⚙ Test / Demo Menu' }),
        el('button', { class: 'icon-btn', html: '&times;', onClick: () => this.closeTestMenu() }),
      ]));
      p.appendChild(field('Current puzzle', idReadout));
      p.appendChild(field('Random seed', el('div', { class: 'test-inline' }, [
        seedInput,
        btn('Set', 'btn-primary', () => { PZ.Engine.setSeed(seedInput.value || PZ.randomSeed()); this.refreshTestMenu(); }),
        btn('🎲', '', () => { seedInput.value = PZ.randomSeed(); PZ.Engine.setSeed(seedInput.value); this.refreshTestMenu(); }),
      ])));
      p.appendChild(field('Jump to room', el('div', { class: 'test-inline' }, [
        roomInput,
        btn('Go', 'btn-primary', () => { PZ.Engine.jumpToRoom(parseInt(roomInput.value, 10) || 1); this.refreshTestMenu(); }),
      ])));
      p.appendChild(field('Force puzzle type', el('div', { class: 'test-inline' }, [
        typeSelect,
        btn('Load', 'btn-primary', () => { if (typeSelect.value) { PZ.Engine.forcePuzzleType(typeSelect.value); this.refreshTestMenu(); } }),
      ])));
      p.appendChild(el('div', { class: 'test-actions' }, [
        btn('🎲 Random puzzle', '', () => { PZ.Engine.randomPuzzle(); this.refreshTestMenu(); }),
        btn('↻ Reset', '', () => { PZ.Engine.resetPuzzle(); this.refreshTestMenu(); }),
        btn('⟳ Replay', '', () => { PZ.Engine.replayPuzzle(); this.refreshTestMenu(); }),
        btn('⏭ Skip', '', () => { PZ.Engine.skipPuzzle(); this.refreshTestMenu(); }),
      ]));
      p.appendChild(el('div', { class: 'test-note', text: 'Seeds are deterministic: the same seed + room always produces the same puzzle.' }));
    },
    toggleTestMenu() { this.testOpen ? this.closeTestMenu() : this.openTestMenu(); },
    openTestMenu() { this.testOpen = true; this.testPanel.classList.remove('hidden'); this.refreshTestMenu(); },
    closeTestMenu() { this.testOpen = false; this.testPanel.classList.add('hidden'); },
    refreshTestMenu() {
      if (!this.testOpen || !PZ.Engine.run) return;
      const def = PZ.Engine.currentDef();
      this.testEls.seedInput.value = PZ.Engine.run.seed;
      this.testEls.roomInput.value = PZ.Engine.run.room;
      this.testEls.typeSelect.value = PZ.Engine.run.forcedPuzzleId || '';
      this.testEls.idReadout.innerHTML = '<b>' + (def ? def.name : '') + '</b> · ' +
        PZ.Engine.instanceId(PZ.Engine.run.seed, PZ.Engine.run.room) +
        ' · <span class="mono">' + (def ? def.id : '') + '</span>';
    },
  };

  function logoSvg() {
    return '<svg viewBox="0 0 64 64" width="64" height="64">' +
      '<rect x="6" y="6" width="24" height="24" rx="5" fill="#4cc9f0"/>' +
      '<rect x="34" y="6" width="24" height="24" rx="5" fill="#f72585"/>' +
      '<rect x="6" y="34" width="24" height="24" rx="5" fill="#ffd166"/>' +
      '<circle cx="46" cy="46" r="13" fill="#06d6a0"/></svg>';
  }

  function boot() { App.init(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  PZ.App = App;
})(window);
