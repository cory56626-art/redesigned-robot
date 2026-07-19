/* ==========================================================================
   puzzles-quiz.js — knowledge / reasoning puzzles:
   arithmetic, number sequences, matrix patterns, sequence prediction,
   logic (odd-one-out), code breaking (mastermind), memory match.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, svg, kit } = PZ;

  /* ---- shared: draw a small symbol into an SVG group ------------------- */
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'hex'];
  function drawSymbol(cx, cy, r, shape, color, count) {
    count = count || 1;
    const g = svg('g', {});
    const positions = layout(count, cx, cy, r);
    const sr = count > 1 ? r * 0.42 : r;
    positions.forEach(p => g.appendChild(oneShape(p.x, p.y, sr, shape, color)));
    return g;
  }
  function layout(n, cx, cy, r) {
    if (n === 1) return [{ x: cx, y: cy }];
    const out = [], d = r * 0.75;
    const grid = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]];
    for (let i = 0; i < n; i++) out.push({ x: cx + grid[i][0] * d, y: cy + grid[i][1] * d });
    return out;
  }
  function oneShape(cx, cy, r, shape, color) {
    switch (shape) {
      case 'square': return svg('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, rx: r * 0.18, fill: color });
      case 'triangle': return svg('polygon', { points: pts([[cx, cy - r], [cx + r * 0.92, cy + r * 0.8], [cx - r * 0.92, cy + r * 0.8]]), fill: color });
      case 'diamond': return svg('polygon', { points: pts([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]]), fill: color });
      case 'star': return svg('polygon', { points: starPts(cx, cy, r, r * 0.45, 5), fill: color });
      case 'hex': return svg('polygon', { points: polyPts(cx, cy, r, 6, -Math.PI / 2), fill: color });
      default: return svg('circle', { cx, cy, r, fill: color });
    }
  }
  const pts = (a) => a.map(p => p[0] + ',' + p[1]).join(' ');
  function polyPts(cx, cy, r, n, rot) {
    let s = [];
    for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; s.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts(s);
  }
  function starPts(cx, cy, R, r, n) {
    let s = [];
    for (let i = 0; i < n * 2; i++) {
      const rad = i % 2 ? r : R; const a = -Math.PI / 2 + i * Math.PI / n;
      s.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    return pts(s);
  }
  const PALETTE = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#c77dff', '#ff8c42'];

  /* ====================================================================== */
  /* 1. ARITHMETIC                                                          */
  /* ====================================================================== */
  PZ.register({
    id: 'arithmetic', name: 'Arithmetic Core', category: 'arithmetic', hue: 45, minDifficulty: 1,
    build(ctx) {
      const d = ctx.difficulty, r = ctx.rng;
      const maxN = 8 + d * 6;
      const ops = d >= 4 ? ['+', '-', '×', '÷'] : d >= 2 ? ['+', '-', '×'] : ['+', '-'];
      let terms = 2 + (d >= 3 ? 1 : 0) + (d >= 6 ? 1 : 0);
      let expr, answer;
      for (let tries = 0; tries < 60; tries++) {
        const built = buildExpr(terms, ops, maxN, r);
        if (built && Number.isInteger(built.value) && built.value >= 0 && built.value <= 9999) {
          expr = built.text; answer = built.value; break;
        }
      }
      if (expr == null) { expr = '3 + 4'; answer = 7; }

      ctx.setPrompt('Solve the equation. Tap the correct answer.');
      const eq = el('div', { class: 'equation', html: expr + ' <span class="eq-q">= ?</span>' });

      // Build distractors.
      const set = new Set([answer]);
      const opts = [{ v: answer, correct: true }];
      let guard = 0;
      while (opts.length < 4 && guard++ < 100) {
        const delta = r.int(1, Math.max(3, Math.round(answer * 0.3) + d));
        const cand = r.chance(0.5) ? answer + delta : answer - delta;
        if (cand < 0 || set.has(cand)) continue;
        set.add(cand); opts.push({ v: cand, correct: false });
      }
      const choices = kit.choices(ctx, r.shuffle(opts).map(o => ({ label: String(o.v), correct: o.correct })), { columns: 2 });
      ctx.root.appendChild(kit.panel([eq, choices], 'quiz'));
    },
  });

  function buildExpr(terms, ops, maxN, r) {
    // Left-to-right evaluation shown with explicit parentheses-free order via value tracking.
    let value = r.int(1, maxN);
    let text = String(value);
    for (let i = 1; i < terms; i++) {
      const op = r.pick(ops);
      let n = r.int(1, maxN);
      if (op === '÷') {
        // ensure divisible
        const divisors = [];
        for (let k = 2; k <= 9; k++) if (value % k === 0) divisors.push(k);
        if (!divisors.length) return null;
        n = r.pick(divisors);
        value = value / n;
      } else if (op === '×') {
        n = r.int(2, Math.min(9, maxN)); value = value * n;
      } else if (op === '+') { value = value + n; }
      else { if (n > value) n = r.int(1, value); value = value - n; }
      text += ' ' + op + ' ' + n;
    }
    return { text, value };
  }

  /* ====================================================================== */
  /* 2. NUMBER SEQUENCE                                                     */
  /* ====================================================================== */
  PZ.register({
    id: 'sequence', name: 'Number Sequence', category: 'sequences', hue: 200, minDifficulty: 1,
    build(ctx) {
      const d = ctx.difficulty, r = ctx.rng;
      const kinds = d >= 3 ? ['arith', 'geo', 'fib', 'square', 'alt'] : ['arith', 'geo', 'alt'];
      const kind = r.pick(kinds);
      const len = 5;
      let seq = [], rule = '';
      if (kind === 'arith') {
        const start = r.int(1, 12), step = r.int(2, 3 + d);
        for (let i = 0; i < len + 1; i++) seq.push(start + step * i);
        rule = 'Add ' + step + ' each step';
      } else if (kind === 'geo') {
        const start = r.int(1, 4), ratio = r.int(2, 3);
        for (let i = 0; i < len + 1; i++) seq.push(start * Math.pow(ratio, i));
        rule = 'Multiply by ' + ratio + ' each step';
      } else if (kind === 'fib') {
        let a = r.int(1, 4), b = r.int(2, 6);
        seq = [a, b]; for (let i = 2; i < len + 1; i++) seq.push(seq[i - 1] + seq[i - 2]);
        rule = 'Each number is the sum of the previous two';
      } else if (kind === 'square') {
        const off = r.int(0, 3);
        for (let i = 1; i < len + 2; i++) seq.push((i + off) * (i + off));
        rule = 'Perfect squares';
      } else { // alternating add
        const start = r.int(2, 9), s1 = r.int(2, 5), s2 = r.int(3, 7);
        let v = start; seq.push(v);
        for (let i = 0; i < len; i++) { v += (i % 2 ? s2 : s1); seq.push(v); }
        rule = 'Alternately add ' + s1 + ' and ' + s2;
      }
      const answer = seq[len];
      const shown = seq.slice(0, len);

      ctx.setPrompt('What number comes next in the sequence?');
      ctx.setHint('Rule: ' + rule);
      const row = el('div', { class: 'seq-row' });
      shown.forEach(n => row.appendChild(el('div', { class: 'seq-cell', text: n })));
      row.appendChild(el('div', { class: 'seq-cell seq-q', text: '?' }));

      const set = new Set([answer]); const opts = [{ v: answer, correct: true }];
      let guard = 0;
      while (opts.length < 4 && guard++ < 80) {
        const cand = answer + r.int(-Math.max(4, d * 3), Math.max(4, d * 3)) * (r.chance(0.5) ? 1 : 2);
        if (cand <= 0 || set.has(cand)) continue; set.add(cand); opts.push({ v: cand, correct: false });
      }
      const choices = kit.choices(ctx, r.shuffle(opts).map(o => ({ label: String(o.v), correct: o.correct })), { columns: 2 });
      ctx.root.appendChild(kit.panel([row, choices], 'quiz'));
    },
  });

  /* ====================================================================== */
  /* 3. MATRIX PATTERN (Raven-style)                                        */
  /* ====================================================================== */
  PZ.register({
    id: 'matrix', name: 'Pattern Matrix', category: 'pattern', hue: 280, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const N = 3;
      const shapeByRow = r.shuffle(SHAPES).slice(0, N);
      const colorByCol = r.shuffle(PALETTE).slice(0, N);
      const countMode = r.pick(['row', 'col', 'diag']);
      function attrs(row, col) {
        let count;
        if (countMode === 'row') count = row + 1;
        else if (countMode === 'col') count = col + 1;
        else count = ((row + col) % 3) + 1;
        return { shape: shapeByRow[row], color: colorByCol[col], count };
      }
      ctx.setPrompt('Study the grid. Which tile completes the pattern (bottom-right)?');

      const cell = 78, gap = 8, boardW = N * cell + (N + 1) * gap;
      const board = kit.board(boardW, boardW, 'matrix-board');
      for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
        const x = gap + col * (cell + gap), y = gap + row * (cell + gap);
        board.appendChild(svg('rect', { x, y, width: cell, height: cell, rx: 10, class: 'mx-cell' }));
        if (row === N - 1 && col === N - 1) {
          board.appendChild(svg('text', { x: x + cell / 2, y: y + cell / 2 + 12, 'text-anchor': 'middle', class: 'mx-q', text: '?' }));
        } else {
          const a = attrs(row, col);
          board.appendChild(drawSymbol(x + cell / 2, y + cell / 2, cell * 0.3, a.shape, a.color, a.count));
        }
      }
      const ans = attrs(N - 1, N - 1);

      // Options
      const optDefs = [Object.assign({ correct: true }, ans)];
      const seen = new Set([ans.shape + ans.color + ans.count]);
      let guard = 0;
      while (optDefs.length < 4 && guard++ < 60) {
        const variant = Object.assign({}, ans);
        const which = r.int(0, 2);
        if (which === 0) variant.shape = r.pick(SHAPES);
        else if (which === 1) variant.color = r.pick(PALETTE);
        else variant.count = r.int(1, 3);
        const key = variant.shape + variant.color + variant.count;
        if (seen.has(key)) continue; seen.add(key); optDefs.push(Object.assign({ correct: false }, variant));
      }
      const opts = r.shuffle(optDefs).map(o => {
        const s = kit.board(70, 70, 'opt-sym');
        s.appendChild(drawSymbol(35, 35, 21, o.shape, o.color, o.count));
        return { node: s, correct: o.correct };
      });
      const choices = kit.choices(ctx, opts, { columns: 4 });
      ctx.root.appendChild(kit.panel([board, choices], 'quiz'));
    },
  });

  /* ====================================================================== */
  /* 4. SEQUENCE PREDICTION (icon rule)                                     */
  /* ====================================================================== */
  PZ.register({
    id: 'predict', name: 'Sequence Prediction', category: 'sequence-predict', hue: 160, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const shapes = r.shuffle(SHAPES);
      const color = r.pick(PALETTE);
      const mode = r.pick(['rotate', 'grow', 'cycle']);
      const len = 4;
      let items = [], nextItem, rule;
      if (mode === 'rotate') {
        const base = r.int(0, 5);
        for (let i = 0; i <= len; i++) items.push({ shape: shapes[(base + i) % shapes.length], color });
        rule = 'Shapes advance one step each frame';
      } else if (mode === 'grow') {
        for (let i = 0; i <= len; i++) items.push({ shape: shapes[0], color, count: (i % 3) + 1 });
        rule = 'The count cycles 1 → 2 → 3';
      } else {
        const cols = r.shuffle(PALETTE).slice(0, 3);
        for (let i = 0; i <= len; i++) items.push({ shape: shapes[0], color: cols[i % 3] });
        rule = 'The color cycles through three values';
      }
      nextItem = items[len]; items = items.slice(0, len);

      ctx.setPrompt('What comes next in the sequence?');
      ctx.setHint('Rule: ' + rule);
      const row = el('div', { class: 'seq-row' });
      items.forEach(it => {
        const s = kit.board(64, 64);
        s.appendChild(drawSymbol(32, 32, 20, it.shape, it.color, it.count || 1));
        const c = el('div', { class: 'seq-cell seq-img' }); c.appendChild(s); row.appendChild(c);
      });
      row.appendChild(el('div', { class: 'seq-cell seq-q', text: '?' }));

      const optDefs = [Object.assign({ correct: true }, nextItem)];
      const seen = new Set([JSON.stringify(nextItem)]);
      let guard = 0;
      while (optDefs.length < 4 && guard++ < 60) {
        const v = Object.assign({}, nextItem);
        if (mode === 'grow') v.count = r.int(1, 3);
        else if (mode === 'cycle') v.color = r.pick(PALETTE);
        else v.shape = r.pick(SHAPES);
        const key = JSON.stringify({ shape: v.shape, color: v.color, count: v.count });
        if (seen.has(key)) continue; seen.add(key); optDefs.push(Object.assign({ correct: false }, v));
      }
      const opts = r.shuffle(optDefs).map(o => {
        const s = kit.board(70, 70, 'opt-sym'); s.appendChild(drawSymbol(35, 35, 21, o.shape, o.color, o.count || 1));
        return { node: s, correct: o.correct };
      });
      ctx.root.appendChild(kit.panel([row, kit.choices(ctx, opts, { columns: 4 })], 'quiz'));
    },
  });

  /* ====================================================================== */
  /* 5. LOGIC — odd one out                                                 */
  /* ====================================================================== */
  PZ.register({
    id: 'oddoneout', name: 'Odd One Out', category: 'logic', hue: 320, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const count = d >= 4 ? 6 : 4;
      const rule = r.pick(['shape', 'color', 'count']);
      const baseShape = r.pick(SHAPES), baseColor = r.pick(PALETTE), baseCount = r.int(1, 3);
      const items = [];
      for (let i = 0; i < count; i++) items.push({ shape: baseShape, color: baseColor, count: baseCount });
      const oddIdx = r.int(0, count - 1);
      if (rule === 'shape') { let s; do { s = r.pick(SHAPES); } while (s === baseShape); items[oddIdx].shape = s; }
      else if (rule === 'color') { let c; do { c = r.pick(PALETTE); } while (c === baseColor); items[oddIdx].color = c; }
      else { let n; do { n = r.int(1, 3); } while (n === baseCount); items[oddIdx].count = n; }

      ctx.setPrompt('One tile breaks the pattern. Tap the odd one out.');
      const opts = items.map((it, i) => {
        const s = kit.board(84, 84, 'opt-sym'); s.appendChild(drawSymbol(42, 42, 26, it.shape, it.color, it.count));
        return { node: s, correct: i === oddIdx };
      });
      ctx.root.appendChild(kit.panel([kit.choices(ctx, opts, { columns: count === 6 ? 3 : 2 })], 'quiz'));
    },
  });

  /* ====================================================================== */
  /* 6. CODE BREAKING — mastermind                                          */
  /* ====================================================================== */
  PZ.register({
    id: 'codebreak', name: 'Code Breaker', category: 'code breaking', hue: 20, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const len = d >= 5 ? 5 : d >= 3 ? 4 : 3;
      const nColors = Math.min(6, 4 + Math.floor(d / 2));
      const cols = PALETTE.slice(0, nColors);
      const secret = PZ.range(len).map(() => r.int(0, nColors - 1));
      const maxRows = Math.max(8, len + 6);

      ctx.setPrompt('Crack the hidden code. Tap a peg to cycle its color, then Check.');
      ctx.setHint('● = right color & position · ○ = right color, wrong position');

      const wrap = el('div', { class: 'mm-wrap' });
      const legend = el('div', { class: 'mm-legend' },
        cols.map((c, i) => el('span', { class: 'mm-swatch', style: { background: c }, title: 'color ' + (i + 1) })));
      const rows = el('div', { class: 'mm-rows' });
      wrap.appendChild(legend); wrap.appendChild(rows);

      let rowCount = 0;
      let cur = PZ.range(len).map(() => 0);
      let rowEl, pegEls;
      function newRow() {
        rowEl = el('div', { class: 'mm-row' });
        pegEls = [];
        cur = PZ.range(len).map(() => 0);
        for (let i = 0; i < len; i++) {
          const peg = el('button', { class: 'mm-peg', style: { background: cols[0] } });
          peg.addEventListener('click', () => {
            cur[i] = (cur[i] + 1) % nColors;
            peg.style.background = cols[cur[i]];
          });
          pegEls.push(peg); rowEl.appendChild(peg);
        }
        const check = el('button', { class: 'btn btn-small', text: 'Check', onClick: submit });
        rowEl.appendChild(check);
        rowEl.appendChild(el('div', { class: 'mm-feedback' }));
        rows.appendChild(rowEl);
        rows.scrollTop = rows.scrollHeight;
      }
      function submit() {
        const guess = cur.slice();
        let black = 0, white = 0;
        const sUsed = Array(len).fill(false), gUsed = Array(len).fill(false);
        for (let i = 0; i < len; i++) if (guess[i] === secret[i]) { black++; sUsed[i] = gUsed[i] = true; }
        for (let i = 0; i < len; i++) {
          if (gUsed[i]) continue;
          for (let j = 0; j < len; j++) {
            if (!sUsed[j] && guess[i] === secret[j]) { white++; sUsed[j] = true; break; }
          }
        }
        const fb = rowEl.querySelector('.mm-feedback');
        fb.innerHTML = '';
        for (let i = 0; i < black; i++) fb.appendChild(el('span', { class: 'fb-dot black' }));
        for (let i = 0; i < white; i++) fb.appendChild(el('span', { class: 'fb-dot white' }));
        Array.from(rowEl.querySelectorAll('.mm-peg, .btn-small')).forEach(e => e.disabled = true);
        rowEl.classList.add('locked');
        if (black === len) { kit.flashOk(wrap); ctx.good(); setTimeout(() => ctx.solve(), 500); return; }
        ctx.fail();
        rowCount++;
        if (rowCount >= maxRows) {
          // reveal & reset (still solvable — no dead ends)
          ctx.toast('Out of rows — new code', 'bad');
          for (let i = 0; i < len; i++) secret[i] = r.int(0, nColors - 1);
          rowCount = 0; PZ.clear(rows); newRow();
        } else newRow();
      }
      newRow();
      ctx.root.appendChild(wrap);
    },
  });

  /* ====================================================================== */
  /* 7. MEMORY MATCH                                                        */
  /* ====================================================================== */
  PZ.register({
    id: 'memory', name: 'Memory Grid', category: 'memory', hue: 250, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const pairs = Math.min(10, 4 + d);
      const cols = pairs <= 6 ? 4 : pairs <= 8 ? 4 : 5;
      const glyphs = r.shuffle(kit.glyphs).slice(0, pairs);
      const colors = r.shuffle(kit.symbolColors);
      let deck = [];
      glyphs.forEach((g, i) => { deck.push({ g, c: colors[i % colors.length], id: i }); deck.push({ g, c: colors[i % colors.length], id: i }); });
      deck = r.shuffle(deck);

      ctx.setPrompt('Flip cards to find all matching pairs.');
      const grid = el('div', { class: 'mem-grid' });
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
      let first = null, lock = false, matched = 0;
      deck.forEach((card) => {
        const face = el('span', { class: 'mem-face', text: card.g, style: { color: card.c } });
        const c = el('button', { class: 'mem-card' }, [
          el('span', { class: 'mem-back', html: '?' }), face,
        ]);
        c.addEventListener('click', () => {
          if (lock || c.classList.contains('open') || c.classList.contains('done')) return;
          c.classList.add('open');
          if (!first) { first = { c, card }; return; }
          if (first.card.id === card.id) {
            first.c.classList.add('done'); c.classList.add('done');
            first = null; matched++; ctx.good();
            kit.flashOk(c);
            if (matched === pairs) setTimeout(() => ctx.solve(), 350);
          } else {
            lock = true; ctx.fail();
            const a = first.c, b = c;
            setTimeout(() => { a.classList.remove('open'); b.classList.remove('open'); first = null; lock = false; }, 720);
          }
        });
        grid.appendChild(c);
      });
      ctx.root.appendChild(grid);
    },
  });

  PZ._drawSymbol = drawSymbol; // exported for reuse
  PZ._SHAPES = SHAPES;
  PZ._PALETTE = PALETTE;
})(window);
