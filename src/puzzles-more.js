/* ==========================================================================
   puzzles-more.js — sliding blocks, jigsaw, graph traversal, shape fitting.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, svg, kit } = PZ;

  /* ====================================================================== */
  /* SLIDING BLOCK (n-puzzle)                                               */
  /* ====================================================================== */
  PZ.register({
    id: 'sliding', name: 'Slide Puzzle', category: 'sliding', hue: 210, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const n = d >= 5 ? 4 : 3;
      const N = n * n;
      let tiles = PZ.range(N).map(i => (i + 1) % N); // 1..N-1,0
      let blank = N - 1;
      const legal = () => {
        const bx = blank % n, by = Math.floor(blank / n), m = [];
        if (bx > 0) m.push(blank - 1); if (bx < n - 1) m.push(blank + 1);
        if (by > 0) m.push(blank - n); if (by < n - 1) m.push(blank + n);
        return m;
      };
      // scramble by random legal moves
      let prev = -1;
      for (let i = 0; i < 60 + d * 20; i++) {
        const m = legal().filter(x => x !== prev); const pick = r.pick(m);
        tiles[blank] = tiles[pick]; tiles[pick] = 0; prev = blank; blank = pick;
      }
      if (isSolved()) { const m = legal(); const p = m[0]; tiles[blank] = tiles[p]; tiles[p] = 0; blank = p; }

      function isSolved() { for (let i = 0; i < N - 1; i++) if (tiles[i] !== i + 1) return false; return tiles[N - 1] === 0; }

      ctx.setPrompt('Tap a tile next to the gap to slide it. Arrange the numbers in order.');
      const grid = el('div', { class: 'slide-grid' });
      grid.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
      const cellEls = [];
      for (let i = 0; i < N; i++) {
        const c = el('button', { class: 'slide-tile' });
        c.addEventListener('click', () => move(i));
        cellEls.push(c); grid.appendChild(c);
      }
      function render() {
        for (let i = 0; i < N; i++) {
          const v = tiles[i];
          cellEls[i].textContent = v === 0 ? '' : v;
          cellEls[i].className = 'slide-tile' + (v === 0 ? ' blank' : '') + (v !== 0 && v === i + 1 ? ' home' : '');
        }
      }
      function move(i) {
        if (legal().indexOf(i) === -1) { if (tiles[i] !== 0) ctx.fail(); return; }
        tiles[blank] = tiles[i]; tiles[i] = 0; blank = i; ctx.good(); render();
        if (isSolved()) { kit.flashOk(grid); setTimeout(() => ctx.solve(), 300); }
      }
      render();
      ctx.root.appendChild(grid);
    },
  });

  /* ====================================================================== */
  /* JIGSAW — swap tiles to restore the picture                             */
  /* ====================================================================== */
  PZ.register({
    id: 'jigsaw', name: 'Jigsaw', category: 'jigsaw', hue: 120, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const g = Math.min(4, 2 + Math.floor(d / 2));
      const SZ = 300, cell = SZ / g;
      const motif = makeMotif(r, SZ);

      ctx.setPrompt('Drag tiles to swap them and rebuild the picture.');
      const ref = svg('svg', { viewBox: '0 0 ' + SZ + ' ' + SZ, class: 'jig-ref' });
      renderMotif(motif, ref, 0, 0);
      const refBox = el('div', { class: 'jig-refbox' }, [el('span', { class: 'jig-reflabel', text: 'Target' }), ref]);

      const boardEl = el('div', { class: 'jig-board' });
      boardEl.style.width = SZ + 'px'; boardEl.style.height = SZ + 'px';
      boardEl.style.gridTemplateColumns = 'repeat(' + g + ', 1fr)';
      const slots = []; let inSlot = PZ.range(g * g); // pieceInSlot[slot] = pieceId
      inSlot = r.shuffle(inSlot);
      if (inSlot.every((p, i) => p === i)) inSlot = r.shuffle(PZ.range(g * g).reverse());

      function pieceSvg(pieceId) {
        const px = (pieceId % g) * cell, py = Math.floor(pieceId / g) * cell;
        const s = svg('svg', { viewBox: px + ' ' + py + ' ' + cell + ' ' + cell, class: 'jig-piece-svg' });
        renderMotif(motif, s, 0, 0);
        return s;
      }
      for (let i = 0; i < g * g; i++) {
        const slot = el('div', { class: 'jig-slot', dataset: { slot: i } });
        slots.push(slot); boardEl.appendChild(slot);
      }
      function render() {
        for (let i = 0; i < g * g; i++) { PZ.clear(slots[i]); slots[i].appendChild(pieceSvg(inSlot[i])); slots[i].classList.toggle('correct', inSlot[i] === i); }
      }
      render();

      let dragSrc = -1, ghost = null;
      function slotUnder(clientX, clientY) {
        const b = boardEl.getBoundingClientRect();
        if (clientX < b.left || clientY < b.top || clientX > b.right || clientY > b.bottom) return -1;
        const col = Math.floor((clientX - b.left) / (b.width / g)), row = Math.floor((clientY - b.top) / (b.height / g));
        return row * g + col;
      }
      function down(ev) {
        const s = slotUnder(ev.clientX, ev.clientY); if (s < 0) return;
        ev.preventDefault(); dragSrc = s;
        slots[s].classList.add('lifting');
        ghost = el('div', { class: 'jig-ghost' }); ghost.style.width = cell + 'px'; ghost.style.height = cell + 'px';
        ghost.appendChild(pieceSvg(inSlot[s])); document.body.appendChild(ghost);
        moveGhost(ev);
        boardEl.setPointerCapture && boardEl.setPointerCapture(ev.pointerId);
      }
      function moveGhost(ev) { if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; } }
      function move(ev) { if (dragSrc < 0) return; ev.preventDefault(); moveGhost(ev); }
      function up(ev) {
        if (dragSrc < 0) return; ev.preventDefault();
        const tgt = slotUnder(ev.clientX, ev.clientY);
        slots[dragSrc].classList.remove('lifting');
        if (ghost) { ghost.remove(); ghost = null; }
        if (tgt >= 0 && tgt !== dragSrc) {
          const tmp = inSlot[dragSrc]; inSlot[dragSrc] = inSlot[tgt]; inSlot[tgt] = tmp; ctx.good(); render();
          if (inSlot.every((p, i) => p === i)) { kit.flashOk(boardEl); setTimeout(() => ctx.solve(), 300); }
        }
        dragSrc = -1;
      }
      boardEl.style.touchAction = 'none';
      boardEl.addEventListener('pointerdown', down);
      boardEl.addEventListener('pointermove', move);
      boardEl.addEventListener('pointerup', up);
      boardEl.addEventListener('pointercancel', up);
      ctx.onCleanup(() => { if (ghost) ghost.remove(); });

      ctx.root.appendChild(el('div', { class: 'jig-wrap' }, [boardEl, refBox]));
    },
  });

  // Build a deterministic abstract motif (array of shape descriptors).
  function makeMotif(r, SZ) {
    const cols = PZ.shuffle(['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#c77dff', '#ff8c42', '#43aa8b', '#f9c74f'], r);
    const shapes = [{ t: 'bg', c: cols[0] }];
    const count = 7;
    for (let i = 0; i < count; i++) {
      const t = r.pick(['circle', 'rect', 'tri', 'band']);
      shapes.push({ t, c: cols[(i + 1) % cols.length], x: r.float(0, SZ), y: r.float(0, SZ), s: r.float(SZ * 0.12, SZ * 0.4), a: r.float(0, 360) });
    }
    shapes.SZ = SZ;
    return shapes;
  }
  function renderMotif(shapes, svgEl, ox, oy) {
    const SZ = shapes.SZ;
    shapes.forEach(sh => {
      if (sh.t === 'bg') { svgEl.appendChild(svg('rect', { x: 0, y: 0, width: SZ, height: SZ, fill: sh.c })); return; }
      if (sh.t === 'circle') svgEl.appendChild(svg('circle', { cx: sh.x, cy: sh.y, r: sh.s, fill: sh.c, opacity: 0.85 }));
      else if (sh.t === 'rect') svgEl.appendChild(svg('rect', { x: sh.x - sh.s, y: sh.y - sh.s, width: sh.s * 2, height: sh.s * 2, fill: sh.c, opacity: 0.85, transform: 'rotate(' + sh.a + ' ' + sh.x + ' ' + sh.y + ')' }));
      else if (sh.t === 'tri') svgEl.appendChild(svg('polygon', { points: (sh.x) + ',' + (sh.y - sh.s) + ' ' + (sh.x + sh.s) + ',' + (sh.y + sh.s) + ' ' + (sh.x - sh.s) + ',' + (sh.y + sh.s), fill: sh.c, opacity: 0.85, transform: 'rotate(' + sh.a + ' ' + sh.x + ' ' + sh.y + ')' }));
      else if (sh.t === 'band') svgEl.appendChild(svg('rect', { x: sh.x - sh.s, y: sh.y - sh.s * 0.28, width: sh.s * 2, height: sh.s * 0.56, fill: sh.c, opacity: 0.9, transform: 'rotate(' + sh.a + ' ' + sh.x + ' ' + sh.y + ')' }));
    });
  }

  /* ====================================================================== */
  /* GRAPH TRAVERSAL — visit every node once                                */
  /* ====================================================================== */
  PZ.register({
    id: 'graph', name: 'Grid Route', category: 'graph traversal', hue: 260, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const n = Math.min(12, 6 + d);
      const W = 380, H = 320;
      // positions: jittered grid so it looks clean
      const cols = Math.ceil(Math.sqrt(n * 1.3)), rows = Math.ceil(n / cols);
      const posAll = [];
      for (let i = 0; i < rows * cols; i++) { const cx = i % cols, cy = Math.floor(i / cols); posAll.push({ x: 40 + cx * ((W - 80) / Math.max(1, cols - 1)), y: 40 + cy * ((H - 80) / Math.max(1, rows - 1)) }); }
      const chosen = PZ.shuffle(posAll, r).slice(0, n);
      chosen.forEach(p => { p.x += r.float(-14, 14); p.y += r.float(-14, 14); });
      // Hamiltonian path in a random order + extra edges
      const order = PZ.shuffle(PZ.range(n), r);
      const edgeSet = new Set(); const edges = [];
      function addEdge(a, b) { const k = Math.min(a, b) + '-' + Math.max(a, b); if (edgeSet.has(k)) return; edgeSet.add(k); edges.push([a, b]); }
      for (let i = 0; i < n - 1; i++) addEdge(order[i], order[i + 1]);
      const extra = Math.min(n, 2 + d);
      for (let i = 0; i < extra; i++) { const a = r.int(0, n - 1), b = r.int(0, n - 1); if (a !== b) addEdge(a, b); }
      const adj = PZ.range(n).map(() => []);
      edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
      const start = order[0];

      ctx.setPrompt('Start at the ringed node. Click connected nodes to visit every node exactly once.');
      const board = kit.board(W, H, 'graph-board');
      const edgeG = svg('g', {}); board.appendChild(edgeG);
      edges.forEach(([a, b]) => edgeG.appendChild(svg('line', { x1: chosen[a].x, y1: chosen[a].y, x2: chosen[b].x, y2: chosen[b].y, class: 'gr-edge' })));
      const routeEl = svg('polyline', { class: 'gr-route', points: '' }); board.appendChild(routeEl);
      const nodeEls = chosen.map((p, i) => {
        const c = svg('circle', { cx: p.x, cy: p.y, r: 14, class: 'gr-node' + (i === start ? ' start' : '') });
        c.addEventListener('click', () => clickNode(i));
        board.appendChild(c);
        board.appendChild(svg('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle', class: 'gr-num', text: '' }));
        return c;
      });
      let route = [start]; const visited = new Set([start]);
      function redraw() {
        routeEl.setAttribute('points', route.map(i => chosen[i].x + ',' + chosen[i].y).join(' '));
        nodeEls.forEach((c, i) => c.classList.toggle('visited', visited.has(i)));
        nodeEls.forEach((c, i) => c.classList.toggle('head', i === route[route.length - 1]));
      }
      function clickNode(i) {
        const head = route[route.length - 1];
        if (i === head) return;
        if (route.length >= 2 && route[route.length - 2] === i) { visited.delete(head); route.pop(); redraw(); return; }
        if (adj[head].indexOf(i) === -1) { ctx.fail(); ctx.toast('Not connected', 'bad'); return; }
        if (visited.has(i)) { ctx.fail(); ctx.toast('Already visited', 'bad'); return; }
        route.push(i); visited.add(i); ctx.good(); redraw();
        if (visited.size === n) { kit.flashOk(board); setTimeout(() => ctx.solve(), 300); }
      }
      const controls = el('div', { class: 'stage-inline-controls' }, [
        el('button', { class: 'btn btn-small btn-ghost', text: 'Undo', onClick: () => { if (route.length > 1) { visited.delete(route[route.length - 1]); route.pop(); redraw(); } } }),
        el('button', { class: 'btn btn-small btn-ghost', text: 'Clear route', onClick: () => { route = [start]; visited.clear(); visited.add(start); redraw(); } }),
      ]);
      redraw();
      ctx.root.appendChild(el('div', { class: 'graph-wrap' }, [board, controls]));
    },
  });

  /* ====================================================================== */
  /* SHAPE FITTING — drag polyomino pieces to fill the grid                 */
  /* ====================================================================== */
  PZ.register({
    id: 'shapefit', name: 'Shape Fit', category: 'shape fitting', hue: 90, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const C = Math.min(6, 4 + Math.floor(d / 3)), R = Math.min(6, 3 + Math.floor(d / 3));
      const owner = []; for (let y = 0; y < R; y++) { owner.push([]); for (let x = 0; x < C; x++) owner[y].push(-1); }
      const pieces = [];
      const colors = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#c77dff', '#ff8c42', '#43aa8b', '#f9844a', '#90be6d', '#577590'];
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
        if (owner[y][x] !== -1) continue;
        const id = pieces.length; const target = r.int(1, 4); const cells = [[x, y]]; owner[y][x] = id;
        while (cells.length < target) {
          const frontier = [];
          cells.forEach(([cx, cy]) => { [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const nx = cx + dx, ny = cy + dy; if (nx >= 0 && ny >= 0 && nx < C && ny < R && owner[ny][nx] === -1) frontier.push([nx, ny]); }); });
          if (!frontier.length) break;
          const [nx, ny] = r.pick(frontier); owner[ny][nx] = id; cells.push([nx, ny]);
        }
        const minx = Math.min(...cells.map(c => c[0])), miny = Math.min(...cells.map(c => c[1]));
        pieces.push({ id, cells: cells.map(([cx, cy]) => [cx - minx, cy - miny]), color: colors[id % colors.length], placed: false });
      }
      // reset owner (player must refill)
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) owner[y][x] = -1;

      ctx.setPrompt('Drag every piece from the tray into the grid so it is completely filled — no gaps, no overlaps.');
      const cellPx = 46;
      const grid = el('div', { class: 'fit-grid' });
      grid.style.width = C * cellPx + 'px'; grid.style.height = R * cellPx + 'px';
      const gridSvg = svg('svg', { viewBox: '0 0 ' + (C * cellPx) + ' ' + (R * cellPx), class: 'fit-svg' });
      for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) gridSvg.appendChild(svg('rect', { x: x * cellPx + 1, y: y * cellPx + 1, width: cellPx - 2, height: cellPx - 2, rx: 5, class: 'fit-cell' }));
      const fillG = svg('g', {}); gridSvg.appendChild(fillG);
      grid.appendChild(gridSvg);

      const tray = el('div', { class: 'fit-tray' });
      function pieceMini(p) {
        const w = Math.max(...p.cells.map(c => c[0])) + 1, h = Math.max(...p.cells.map(c => c[1])) + 1;
        const mini = 30;
        const s = svg('svg', { viewBox: '0 0 ' + (w * mini) + ' ' + (h * mini), class: 'fit-piece', width: w * mini, height: h * mini });
        p.cells.forEach(([cx, cy]) => s.appendChild(svg('rect', { x: cx * mini + 1, y: cy * mini + 1, width: mini - 2, height: mini - 2, rx: 4, fill: p.color })));
        s.dataset.pid = p.id;
        return s;
      }
      function renderTray() {
        PZ.clear(tray);
        pieces.filter(p => !p.placed).forEach(p => { const m = pieceMini(p); m.style.touchAction = 'none'; m.addEventListener('pointerdown', (ev) => startDrag(ev, p)); tray.appendChild(m); });
        if (pieces.every(p => p.placed)) { /* solved handled elsewhere */ }
      }
      function renderFill() {
        PZ.clear(fillG);
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const o = owner[y][x];
          if (o >= 0) { const rect = svg('rect', { x: x * cellPx + 1, y: y * cellPx + 1, width: cellPx - 2, height: cellPx - 2, rx: 5, fill: pieces[o].color, class: 'fit-filled' }); rect.addEventListener('click', () => removePiece(o)); fillG.appendChild(rect); }
        }
      }
      function canPlace(p, gx, gy) {
        for (const [dx, dy] of p.cells) { const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= C || y >= R || owner[y][x] !== -1) return false; }
        return true;
      }
      function place(p, gx, gy) { p.cells.forEach(([dx, dy]) => { owner[gy + dy][gx + dx] = p.id; }); p.placed = true; p.at = [gx, gy]; ctx.good(); renderFill(); renderTray(); checkWin(); }
      function removePiece(id) { const p = pieces[id]; if (!p.placed) return; for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (owner[y][x] === id) owner[y][x] = -1; p.placed = false; renderFill(); renderTray(); }
      function checkWin() { for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (owner[y][x] === -1) return; kit.flashOk(grid); setTimeout(() => ctx.solve(), 300); }

      let drag = null, ghost = null;
      function startDrag(ev, p) {
        ev.preventDefault(); drag = p;
        ghost = pieceMini(p); ghost.classList.add('fit-ghost'); document.body.appendChild(ghost);
        moveGhost(ev);
        const move = (e) => { e.preventDefault(); moveGhost(e); };
        const up = (e) => {
          e.preventDefault();
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          if (ghost) { ghost.remove(); ghost = null; }
          const b = gridSvg.getBoundingClientRect();
          const gx = Math.round((e.clientX - b.left) / (b.width / C) - 0.5);
          const gy = Math.round((e.clientY - b.top) / (b.height / R) - 0.5);
          if (e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom) {
            if (canPlace(drag, gx, gy)) place(drag, gx, gy); else { ctx.fail(); ctx.toast("Doesn't fit here", 'bad'); }
          }
          drag = null;
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }
      function moveGhost(ev) { if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; } }
      ctx.onCleanup(() => { if (ghost) ghost.remove(); });

      renderFill(); renderTray();
      ctx.root.appendChild(el('div', { class: 'fit-wrap' }, [grid, el('div', { class: 'fit-tray-box' }, [el('span', { class: 'fit-tray-label', text: 'Pieces' }), tray])]));
    },
  });
})(window);
