/* ==========================================================================
   puzzles-spatial.js — mouse/drag interactive puzzles:
   maze, wire-match (connect symbols), untangle, pipes (water/tile rotation),
   laser mirrors, gears.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, svg, kit } = PZ;

  const DIR = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const DIRNAMES = ['N', 'E', 'S', 'W'];
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const CW = { N: 'E', E: 'S', S: 'W', W: 'N' };

  /* ====================================================================== */
  /* MAZE — draw a path                                                     */
  /* ====================================================================== */
  PZ.register({
    id: 'maze', name: 'Maze Runner', category: 'maze', hue: 190, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const n = Math.min(12, 5 + d);
      // walls[y][x] = {N,E,S,W} true=wall
      const walls = [], visited = [];
      for (let y = 0; y < n; y++) { walls.push([]); visited.push([]); for (let x = 0; x < n; x++) { walls[y][x] = { N: true, E: true, S: true, W: true }; visited[y][x] = false; } }
      // recursive backtracker (iterative)
      const stack = [[0, 0]]; visited[0][0] = true;
      while (stack.length) {
        const [x, y] = stack[stack.length - 1];
        const opts = [];
        for (const dn of DIRNAMES) {
          const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < n && ny < n && !visited[ny][nx]) opts.push(dn);
        }
        if (!opts.length) { stack.pop(); continue; }
        const dn = r.pick(opts); const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy;
        walls[y][x][dn] = false; walls[ny][nx][OPP[dn]] = false;
        visited[ny][nx] = true; stack.push([nx, ny]);
      }

      const pad = 14, cell = 40, W = n * cell + pad * 2;
      const board = kit.board(W, W, 'maze-board');
      ctx.setPrompt('Drag from the green start to the red goal, following open corridors.');
      // walls
      const wallG = svg('g', { class: 'maze-walls' });
      const cx = (x) => pad + x * cell, cy = (y) => pad + y * cell;
      // outer + inner walls
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const w = walls[y][x];
        if (w.N) wallG.appendChild(line(cx(x), cy(y), cx(x + 1), cy(y)));
        if (w.W) wallG.appendChild(line(cx(x), cy(y), cx(x), cy(y + 1)));
        if (x === n - 1 && w.E) wallG.appendChild(line(cx(x + 1), cy(y), cx(x + 1), cy(y + 1)));
        if (y === n - 1 && w.S) wallG.appendChild(line(cx(x), cy(y + 1), cx(x + 1), cy(y + 1)));
      }
      const mid = (x) => pad + x * cell + cell / 2;
      board.appendChild(svg('circle', { cx: mid(0), cy: mid(0), r: cell * 0.28, class: 'maze-start' }));
      board.appendChild(svg('circle', { cx: mid(n - 1), cy: mid(n - 1), r: cell * 0.28, class: 'maze-goal' }));
      const pathEl = svg('polyline', { class: 'maze-path', points: '' });
      const headEl = svg('circle', { r: cell * 0.18, class: 'maze-head', cx: mid(0), cy: mid(0) });
      board.appendChild(pathEl); board.appendChild(headEl); board.appendChild(wallG);

      let path = [[0, 0]];
      function redraw() {
        pathEl.setAttribute('points', path.map(([x, y]) => mid(x) + ',' + mid(y)).join(' '));
        const h = path[path.length - 1];
        headEl.setAttribute('cx', mid(h[0])); headEl.setAttribute('cy', mid(h[1]));
      }
      function cellAt(p) {
        const x = Math.floor((p.x - pad) / cell), y = Math.floor((p.y - pad) / cell);
        if (x < 0 || y < 0 || x >= n || y >= n) return null; return [x, y];
      }
      function tryExtend(c) {
        if (!c) return;
        const h = path[path.length - 1];
        if (c[0] === h[0] && c[1] === h[1]) return;
        // backtrack
        if (path.length >= 2) { const p = path[path.length - 2]; if (p[0] === c[0] && p[1] === c[1]) { path.pop(); redraw(); return; } }
        const dx = c[0] - h[0], dy = c[1] - h[1];
        if (Math.abs(dx) + Math.abs(dy) !== 1) return; // must be adjacent
        const dn = dx === 1 ? 'E' : dx === -1 ? 'W' : dy === 1 ? 'S' : 'N';
        if (walls[h[1]][h[0]][dn]) return; // wall blocks
        if (path.some(([px, py]) => px === c[0] && py === c[1])) return; // no revisits
        path.push(c); redraw();
        if (c[0] === n - 1 && c[1] === n - 1) { kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 250); }
      }
      const off = kit.drag(board, {
        down: (p) => tryExtend(cellAt(p)),
        move: (p) => tryExtend(cellAt(p)),
      }, (ev) => PZ.svgPoint(board, ev));
      ctx.onCleanup(off);
      ctx.root.appendChild(board);
      redraw();
    },
  });
  function line(x1, y1, x2, y2) { return svg('line', { x1, y1, x2, y2, class: 'wall-line' }); }

  /* ====================================================================== */
  /* WIRE MATCH — connect matching symbols                                  */
  /* ====================================================================== */
  PZ.register({
    id: 'connect', name: 'Wire Match', category: 'connect', hue: 150, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const k = Math.min(7, 3 + d);
      const glyphs = r.shuffle(kit.glyphs).slice(0, k);
      const colors = r.shuffle(kit.symbolColors);
      const items = glyphs.map((g, i) => ({ id: i, g, c: colors[i % colors.length] }));
      const leftOrder = r.shuffle(items.slice());
      const rightOrder = r.shuffle(items.slice());

      ctx.setPrompt('Drag a wire from each left symbol to its identical partner on the right.');
      const W = 380, H = Math.max(240, 60 + k * 46);
      const board = kit.board(W, H, 'wire-board');
      const lx = 70, rx = W - 70;
      const yOf = (i) => 40 + i * ((H - 80) / (k - 1 || 1));
      const nodePos = { left: {}, right: {} };
      const wiresG = svg('g', {}); board.appendChild(wiresG);
      const live = svg('path', { class: 'wire live', d: '' }); board.appendChild(live);

      function node(side, item, i) {
        const x = side === 'left' ? lx : rx, y = yOf(i);
        nodePos[side][item.id] = { x, y };
        const g = svg('g', { class: 'wire-node', 'data-side': side, 'data-id': item.id });
        g.appendChild(svg('circle', { cx: x, cy: y, r: 20, fill: '#141b2e', stroke: item.c, 'stroke-width': 3 }));
        g.appendChild(svg('text', { x, y: y + 8, 'text-anchor': 'middle', class: 'wire-glyph', fill: item.c, text: item.g }));
        board.appendChild(g);
      }
      leftOrder.forEach((it, i) => node('left', it, i));
      rightOrder.forEach((it, i) => node('right', it, i));

      const done = {}; let matched = 0, drag = null;
      function pathD(a, b) {
        const mx = (a.x + b.x) / 2;
        return 'M' + a.x + ',' + a.y + ' C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + b.x + ',' + b.y;
      }
      function nodeUnder(p) {
        let best = null, bd = 26;
        for (const side of ['left', 'right']) for (const id in nodePos[side]) {
          const q = nodePos[side][id]; const dd = PZ.dist(p.x, p.y, q.x, q.y);
          if (dd < bd) { bd = dd; best = { side, id: +id }; }
        }
        return best;
      }
      const off = kit.drag(board, {
        down: (p) => { const nd = nodeUnder(p); if (nd && !done[nd.side + nd.id]) drag = nd; },
        move: (p) => { if (!drag) return; const a = nodePos[drag.side][drag.id]; live.setAttribute('d', pathD(a, p)); },
        up: (p) => {
          if (!drag) return; live.setAttribute('d', '');
          const nd = nodeUnder(p);
          if (nd && nd.side !== drag.side && nd.id === drag.id && !done[nd.side + nd.id]) {
            const a = nodePos[drag.side][drag.id], b = nodePos[nd.side][nd.id];
            const w = svg('path', { class: 'wire done', d: pathD(a, b), stroke: items[drag.id].c });
            wiresG.appendChild(w);
            done[drag.side + drag.id] = done[nd.side + nd.id] = true; matched++; ctx.good();
            if (matched === k) { kit.flashOk(board); setTimeout(() => ctx.solve(), 300); }
          } else if (nd && nd.side !== drag.side && nd.id !== drag.id) { ctx.fail(); }
          drag = null;
        },
      }, (ev) => PZ.svgPoint(board, ev));
      ctx.onCleanup(off);
      ctx.root.appendChild(board);
    },
  });

  /* ====================================================================== */
  /* UNTANGLE — drag nodes so no wires cross (graph/planarity)              */
  /* ====================================================================== */
  PZ.register({
    id: 'untangle', name: 'Untangle', category: 'graph', hue: 275, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const n = Math.min(11, 5 + d);
      const W = 380, H = 340, cxp = W / 2, cyp = H / 2, R = 130;
      // home ring positions (a simple polygon, guaranteed untangle-able)
      const home = PZ.range(n).map(i => ({ x: cxp + R * Math.cos(i / n * 2 * Math.PI), y: cyp + R * Math.sin(i / n * 2 * Math.PI) }));
      const edges = [];
      for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
      // add a couple of safe (non-crossing under ring) chords
      const chords = Math.min(n - 3, 1 + Math.floor(d / 3));
      for (let c = 0; c < chords; c++) { const i = r.int(0, n - 1); const j = (i + 2) % n; if (!edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i))) edges.push([i, j]); }
      // scramble positions
      const pos = PZ.range(n).map(() => ({ x: 40 + r.float(0, W - 80), y: 40 + r.float(0, H - 80) }));

      ctx.setPrompt('Drag the nodes so that no two wires cross. Crossing wires glow red.');
      const board = kit.board(W, H, 'untangle-board');
      const edgeG = svg('g', {}); board.appendChild(edgeG);
      const nodeG = svg('g', {}); board.appendChild(nodeG);
      const edgeEls = edges.map(() => { const l = svg('line', { class: 'ut-edge' }); edgeG.appendChild(l); return l; });
      const nodeEls = pos.map((p, i) => { const c = svg('circle', { r: 12, class: 'ut-node', 'data-i': i }); nodeG.appendChild(c); return c; });

      function cross(a, b, c, e) {
        // segments ab, ce ; ignore shared endpoints
        function o(p, q, r2) { return Math.sign((q.x - p.x) * (r2.y - p.y) - (q.y - p.y) * (r2.x - p.x)); }
        const o1 = o(a, b, c), o2 = o(a, b, e), o3 = o(c, e, a), o4 = o(c, e, b);
        return o1 !== o2 && o3 !== o4;
      }
      function update() {
        edges.forEach((ed, i) => { const a = pos[ed[0]], b = pos[ed[1]]; edgeEls[i].setAttribute('x1', a.x); edgeEls[i].setAttribute('y1', a.y); edgeEls[i].setAttribute('x2', b.x); edgeEls[i].setAttribute('y2', b.y); edgeEls[i].classList.remove('bad'); });
        nodeEls.forEach((el2, i) => { el2.setAttribute('cx', pos[i].x); el2.setAttribute('cy', pos[i].y); });
        let crossings = 0;
        for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
          const e1 = edges[i], e2 = edges[j];
          if (e1[0] === e2[0] || e1[0] === e2[1] || e1[1] === e2[0] || e1[1] === e2[1]) continue;
          if (cross(pos[e1[0]], pos[e1[1]], pos[e2[0]], pos[e2[1]])) { crossings++; edgeEls[i].classList.add('bad'); edgeEls[j].classList.add('bad'); }
        }
        return crossings;
      }
      let dragI = -1, solved = false;
      function pick(p) { let best = -1, bd = 22; pos.forEach((q, i) => { const dd = PZ.dist(p.x, p.y, q.x, q.y); if (dd < bd) { bd = dd; best = i; } }); return best; }
      const off = kit.drag(board, {
        down: (p) => { dragI = pick(p); },
        move: (p) => { if (dragI < 0) return; pos[dragI].x = PZ.clamp(p.x, 16, W - 16); pos[dragI].y = PZ.clamp(p.y, 16, H - 16); update(); },
        up: () => {
          if (dragI >= 0 && !solved && update() === 0) { solved = true; kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 300); }
          dragI = -1;
        },
      }, (ev) => PZ.svgPoint(board, ev));
      ctx.onCleanup(off);
      ctx.root.appendChild(board);
      // guarantee it starts tangled
      if (update() === 0) { pos[0].x = W / 2; pos[0].y = H / 2; pos[Math.floor(n / 2)].x = W / 2 + 4; update(); }
    },
  });

  /* ====================================================================== */
  /* PIPES — rotate pipe tiles so water flows source→drain (no leaks)       */
  /* ====================================================================== */
  PZ.register({
    id: 'pipes', name: 'Pipe Flow', category: 'pipes / water', hue: 195, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const size = Math.min(6, 3 + Math.floor(d / 2) + 1);
      const R = size, C = size;
      // spanning tree over grid (DFS)
      const base = []; for (let y = 0; y < R; y++) { base.push([]); for (let x = 0; x < C; x++) base[y].push({ N: false, E: false, S: false, W: false }); }
      const vis = []; for (let y = 0; y < R; y++) { vis.push([]); for (let x = 0; x < C; x++) vis[y].push(false); }
      const stack = [[0, 0]]; vis[0][0] = true;
      while (stack.length) {
        const [x, y] = stack[stack.length - 1]; const opts = [];
        for (const dn of DIRNAMES) { const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < C && ny < R && !vis[ny][nx]) opts.push(dn); }
        if (!opts.length) { stack.pop(); continue; }
        const dn = r.pick(opts); const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy;
        base[y][x][dn] = true; base[ny][nx][OPP[dn]] = true; vis[ny][nx] = true; stack.push([nx, ny]);
      }
      const source = [0, 0], sink = [C - 1, R - 1];
      // rotation state per cell (0..3), random but not fully solved
      const rot = []; for (let y = 0; y < R; y++) { rot.push([]); for (let x = 0; x < C; x++) rot[y].push(r.int(0, 3)); }

      function rotatedOpen(x, y) {
        const b = base[y][x]; const t = rot[y][x]; const out = { N: false, E: false, S: false, W: false };
        for (const dn of DIRNAMES) if (b[dn]) { let d2 = dn; for (let i = 0; i < t; i++) d2 = CW[d2]; out[d2] = true; }
        return out;
      }
      function evaluate() {
        // leaks + connectivity from source
        let leak = false;
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const o = rotatedOpen(x, y);
          for (const dn of DIRNAMES) if (o[dn]) { const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= C || ny >= R || !rotatedOpen(nx, ny)[OPP[dn]]) leak = true; }
        }
        // flood from source
        const seen = []; for (let y = 0; y < R; y++) { seen.push([]); for (let x = 0; x < C; x++) seen[y].push(false); }
        const q = [source]; seen[source[1]][source[0]] = true;
        while (q.length) { const [x, y] = q.shift(); const o = rotatedOpen(x, y); for (const dn of DIRNAMES) if (o[dn]) { const [dx, dy] = DIR[dn]; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < C && ny < R && rotatedOpen(nx, ny)[OPP[dn]] && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); } } }
        return { leak, seen, connected: seen[sink[1]][sink[0]] };
      }

      ctx.setPrompt('Tap pipes to rotate them. Connect the pump to the drain with no leaks.');
      const cell = 62, pad = 8, WD = C * cell + pad * 2, HT = R * cell + pad * 2;
      const board = kit.board(WD, HT, 'pipe-board');
      const cellsG = svg('g', {}); board.appendChild(cellsG);
      const tileEls = [];
      for (let y = 0; y < R; y++) { tileEls.push([]); for (let x = 0; x < C; x++) {
        const g = svg('g', { class: 'pipe-tile' });
        g.addEventListener('click', () => { rot[y][x] = (rot[y][x] + 1) % 4; render(); });
        cellsG.appendChild(g); tileEls[y].push(g);
      } }
      function render() {
        const st = evaluate();
        for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
          const g = tileEls[y][x]; PZ.clear(g);
          const ox = pad + x * cell, oy = pad + y * cell, mcx = ox + cell / 2, mcy = oy + cell / 2;
          g.appendChild(svg('rect', { x: ox + 2, y: oy + 2, width: cell - 4, height: cell - 4, rx: 8, class: 'pipe-bg' }));
          const o = rotatedOpen(x, y); const filled = st.seen[y][x];
          const cls = 'pipe-seg' + (filled ? ' water' : '');
          for (const dn of DIRNAMES) if (o[dn]) { const [dx, dy] = DIR[dn]; g.appendChild(svg('line', { x1: mcx, y1: mcy, x2: mcx + dx * cell / 2, y2: mcy + dy * cell / 2, class: cls })); }
          g.appendChild(svg('circle', { cx: mcx, cy: mcy, r: 7, class: 'pipe-hub' + (filled ? ' water' : '') }));
          if (x === source[0] && y === source[1]) g.appendChild(svg('circle', { cx: mcx, cy: mcy, r: 13, class: 'pipe-source' }));
          if (x === sink[0] && y === sink[1]) g.appendChild(svg('circle', { cx: mcx, cy: mcy, r: 13, class: 'pipe-sink' }));
        }
        if (!st.leak && st.connected) { kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 350); }
      }
      // avoid an accidental already-solved start
      if (!evaluate().leak && evaluate().connected) { rot[0][0] = (rot[0][0] + 1) % 4; }
      if (window.__PZ_TEST__) ctx.root.__solve = () => { for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) rot[y][x] = 0; render(); };
      render();
      ctx.root.appendChild(board);
    },
  });

  /* ====================================================================== */
  /* MIRRORS — rotate mirrors to reflect the laser onto the target          */
  /* ====================================================================== */
  PZ.register({
    id: 'mirrors', name: 'Laser Lab', category: 'laser mirrors', hue: 340, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const n = Math.min(9, 5 + Math.floor(d / 2));
      const key = (x, y) => x + ',' + y;
      const startY = r.int(1, n - 2);
      const emitter = { x: 0, y: startY, dir: 'E' };

      function reflect(dr, orient) {
        if (orient === '/') return { E: 'N', N: 'E', W: 'S', S: 'W' }[dr];
        return { E: 'S', S: 'E', W: 'N', N: 'W' }[dr];
      }
      // Trace the beam using an orientation lookup; also collect every visited cell.
      function traceWith(orientOf, tgt) {
        let cx = emitter.x, cy = emitter.y, dr = emitter.dir;
        const cells = [{ x: cx, y: cy }], cellSet = new Set([key(cx, cy)]); let hit = false;
        for (let s = 0; s < n * n * 4; s++) {
          const [ddx, ddy] = DIR[dr]; const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) break;
          cx = nx; cy = ny; cells.push({ x: cx, y: cy }); cellSet.add(key(cx, cy));
          if (cx === tgt.x && cy === tgt.y) { hit = true; break; }
          const o = orientOf(cx, cy); if (o) dr = reflect(dr, o);
        }
        return { cells, hit, cellSet };
      }

      // Generate a guaranteed-solvable layout: the solution beam is validated,
      // and decoys are only placed on cells the solution beam never touches.
      let mirrors = null, target = null, solutionOrient = null;
      for (let attempt = 0; attempt < 40 && !mirrors; attempt++) {
        const so = {}; let pos = { x: 0, y: startY }, dir = 'E', good = true;
        const turns = Math.min(5, 2 + Math.floor(d / 2));
        for (let t = 0; t < turns; t++) {
          const step = r.int(1, Math.max(1, n - 2));
          const [dx, dy] = DIR[dir];
          const nx = PZ.clamp(pos.x + dx * step, 0, n - 1), ny = PZ.clamp(pos.y + dy * step, 0, n - 1);
          if (nx === pos.x && ny === pos.y) continue;
          pos = { x: nx, y: ny };
          const nd = r.pick(dir === 'E' || dir === 'W' ? ['N', 'S'] : ['E', 'W']);
          const orient = mirrorFor(dir, nd);
          if (!orient) { good = false; break; }
          so[key(pos.x, pos.y)] = orient; dir = nd;
        }
        if (!good) continue;
        const [dx, dy] = DIR[dir];
        let step = r.int(1, Math.max(1, n - 2));
        let tx = PZ.clamp(pos.x + dx * step, 0, n - 1), ty = PZ.clamp(pos.y + dy * step, 0, n - 1);
        if (tx === pos.x && ty === pos.y) { tx = PZ.clamp(pos.x + dx, 0, n - 1); ty = PZ.clamp(pos.y + dy, 0, n - 1); }
        const tgt = { x: tx, y: ty };
        if (so[key(tx, ty)]) delete so[key(tx, ty)];
        if ((tx === 0 && ty === startY) || Object.keys(so).length === 0) continue;
        const tr = traceWith((x, y) => so[key(x, y)], tgt);
        if (!tr.hit) continue;
        const m = {};
        for (const kk in so) m[kk] = { orient: r.chance(0.5) ? '/' : '\\', onPath: true };
        const decoys = Math.min(4, 1 + Math.floor(d / 2));
        for (let i = 0; i < decoys; i++) {
          const x = r.int(0, n - 1), y = r.int(0, n - 1), kk = key(x, y);
          if (tr.cellSet.has(kk) || m[kk]) continue;
          m[kk] = { orient: r.chance(0.5) ? '/' : '\\', onPath: false };
        }
        mirrors = m; target = tgt; solutionOrient = so;
      }
      if (!mirrors) { // trivial fallback (a single elbow) — always solvable
        const mx = n - 2; solutionOrient = {}; solutionOrient[key(mx, startY)] = '\\';
        mirrors = {}; mirrors[key(mx, startY)] = { orient: '/', onPath: true };
        target = { x: mx, y: n - 1 };
      }

      function trace() { return traceWith((x, y) => (mirrors[key(x, y)] ? mirrors[key(x, y)].orient : null), target); }
      if (trace().hit) { const k0 = Object.keys(solutionOrient)[0]; if (k0 && mirrors[k0]) mirrors[k0].orient = mirrors[k0].orient === '/' ? '\\' : '/'; }

      ctx.setPrompt('Tap the mirrors to rotate them and steer the beam into the target.');
      const cell = 46, pad = 10, WD = n * cell + pad * 2;
      const board = kit.board(WD, WD, 'mirror-board');
      const gridG = svg('g', {}); board.appendChild(gridG);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) gridG.appendChild(svg('rect', { x: pad + x * cell, y: pad + y * cell, width: cell, height: cell, class: 'mir-cell' }));
      const mid = (v) => pad + v * cell + cell / 2;
      const beamEl = svg('polyline', { class: 'beam', points: '' }); board.appendChild(beamEl);
      // emitter marker
      board.appendChild(svg('circle', { cx: pad + emitter.x * cell + cell / 2, cy: mid(emitter.y), r: cell * 0.26, class: 'mir-emitter' }));
      board.appendChild(svg('circle', { cx: mid(target.x), cy: mid(target.y), r: cell * 0.3, class: 'mir-target' }));
      board.appendChild(svg('circle', { cx: mid(target.x), cy: mid(target.y), r: cell * 0.15, class: 'mir-target-core' }));
      const mirG = svg('g', {}); board.appendChild(mirG);
      const mirEls = {};
      for (const kk in mirrors) {
        const [x, y] = kk.split(',').map(Number);
        const l = svg('line', { class: 'mirror', 'data-k': kk });
        l.addEventListener('click', () => { mirrors[kk].orient = mirrors[kk].orient === '/' ? '\\' : '/'; render(); });
        mirG.appendChild(l); mirEls[kk] = l;
      }
      function render() {
        for (const kk in mirEls) {
          const [x, y] = kk.split(',').map(Number); const m = mirrors[kk]; const mx = mid(x), my = mid(y); const rr = cell * 0.34;
          const l = mirEls[kk];
          if (m.orient === '/') { l.setAttribute('x1', mx - rr); l.setAttribute('y1', my + rr); l.setAttribute('x2', mx + rr); l.setAttribute('y2', my - rr); }
          else { l.setAttribute('x1', mx - rr); l.setAttribute('y1', my - rr); l.setAttribute('x2', mx + rr); l.setAttribute('y2', my + rr); }
        }
        const tr = trace();
        beamEl.setAttribute('points', tr.cells.map(c => mid(c.x) + ',' + mid(c.y)).join(' '));
        beamEl.classList.toggle('beam-hit', tr.hit);
        if (tr.hit) { kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 400); }
      }
      if (window.__PZ_TEST__) ctx.root.__solve = () => { for (const kk in solutionOrient) if (mirrors[kk]) mirrors[kk].orient = solutionOrient[kk]; render(); };
      render();
      ctx.root.appendChild(board);
    },
  });
  function mirrorFor(inDir, outDir) {
    // orient that maps inDir -> outDir
    for (const o of ['/', '\\']) {
      const map = o === '/' ? { E: 'N', N: 'E', W: 'S', S: 'W' } : { E: 'S', S: 'E', W: 'N', N: 'W' };
      if (map[inDir] === outDir) return o;
    }
    return null;
  }

  /* ====================================================================== */
  /* GEARS — spin the drive gear to align the output pointer                */
  /* ====================================================================== */
  PZ.register({
    id: 'gears', name: 'Gear Works', category: 'gears', hue: 30, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const count = Math.min(4, 2 + Math.floor(d / 3));
      const teeth = []; for (let i = 0; i < count; i++) teeth.push(r.int(8, 14));
      const colors = ['#ffca3a', '#8ac926', '#4cc9f0', '#ff595e'];
      const W = 400, H = 300;
      // lay gears left→right, meshing (touching). radius ~ teeth*3
      const gears = []; let x = 70;
      for (let i = 0; i < count; i++) {
        const rad = 22 + teeth[i] * 2.4;
        if (i > 0) x += gears[i - 1].rad + rad - 6;
        gears.push({ x, y: H / 2, rad, teeth: teeth[i], color: colors[i % colors.length] });
      }
      // scale to fit
      const totalW = gears[count - 1].x + gears[count - 1].rad + 40;
      const scale = Math.min(1, (W - 20) / totalW);
      gears.forEach(g => { g.x *= scale; g.rad *= scale; });

      let driveAngle = r.float(0, Math.PI * 2);
      const last = count - 1;
      // cumulative gear ratio from the drive gear to gear i
      function cumulativeRatio(i) { let ratio = 1; for (let k = 1; k <= i; k++) ratio *= teeth[k - 1] / teeth[k]; return ratio; }
      function outAngle() { return driveAngle * cumulativeRatio(last) * (last % 2 ? -1 : 1); }

      // target wedge on last gear
      const targetCenter = r.float(0, Math.PI * 2);
      const tol = (26 - d * 1.2) * Math.PI / 180; // radians half-width
      const tolC = Math.max(0.16, tol);

      ctx.setPrompt('Drag the glowing drive gear. Line the output pointer up with the green zone, then Lock In.');
      const board = kit.board(W, H, 'gear-board');
      const gearEls = gears.map((g, i) => {
        const grp = svg('g', {});
        grp.appendChild(cog(g.x, g.y, g.rad, g.teeth, g.color, i === 0));
        const ptr = svg('line', { x1: g.x, y1: g.y, x2: g.x, y2: g.y - g.rad + 6, class: 'gear-ptr' });
        grp.appendChild(ptr);
        board.appendChild(grp);
        return { grp, ptr, g };
      });
      // target wedge drawn on last gear
      const lg = gears[last];
      const wedge = svg('path', { class: 'gear-target' });
      board.insertBefore(wedge, gearEls[0].grp);
      function wedgePath() {
        const a0 = targetCenter - tolC - Math.PI / 2, a1 = targetCenter + tolC - Math.PI / 2, R2 = lg.rad + 2;
        const x0 = lg.x + R2 * Math.cos(a0), y0 = lg.y + R2 * Math.sin(a0);
        const x1 = lg.x + R2 * Math.cos(a1), y1 = lg.y + R2 * Math.sin(a1);
        return 'M' + lg.x + ',' + lg.y + ' L' + x0 + ',' + y0 + ' A' + R2 + ',' + R2 + ' 0 0 1 ' + x1 + ',' + y1 + ' Z';
      }
      wedge.setAttribute('d', wedgePath());

      const lockBtn = el('button', { class: 'btn btn-primary gear-lock', text: 'Lock In', disabled: true });
      function angDiff(a, b) { let dd = (a - b) % (Math.PI * 2); if (dd > Math.PI) dd -= Math.PI * 2; if (dd < -Math.PI) dd += Math.PI * 2; return Math.abs(dd); }
      function render() {
        gearEls.forEach((ge, i) => { const a = i % 2 ? -driveAngle * cumulativeRatio(i) : driveAngle * cumulativeRatio(i); ge.grp.setAttribute('transform', 'rotate(' + (a * 180 / Math.PI) + ' ' + ge.g.x + ' ' + ge.g.y + ')'); });
        const aligned = angDiff(normalize(outAngle()), normalize(targetCenter)) <= tolC;
        lockBtn.disabled = !aligned;
        lockBtn.classList.toggle('ready', aligned);
      }
      function normalize(a) { a %= Math.PI * 2; if (a < 0) a += Math.PI * 2; return a; }
      lockBtn.addEventListener('click', () => {
        if (lockBtn.disabled) return;
        if (angDiff(normalize(outAngle()), normalize(targetCenter)) <= tolC) { kit.flashOk(board); ctx.good(); ctx.solve(); }
      });

      // drag on drive gear
      let lastAng = 0, dragging = false;
      const dg = gears[0];
      function pAng(p) { return Math.atan2(p.y - dg.y, p.x - dg.x); }
      const off = kit.drag(board, {
        down: (p) => { if (PZ.dist(p.x, p.y, dg.x, dg.y) <= dg.rad + 10) { dragging = true; lastAng = pAng(p); } },
        move: (p) => { if (!dragging) return; const a = pAng(p); let dd = a - lastAng; if (dd > Math.PI) dd -= Math.PI * 2; if (dd < -Math.PI) dd += Math.PI * 2; driveAngle += dd; lastAng = a; render(); },
        up: () => { dragging = false; },
      }, (ev) => PZ.svgPoint(board, ev));
      ctx.onCleanup(off);

      const wrap = el('div', { class: 'gear-wrap' }, [board, lockBtn]);
      ctx.root.appendChild(wrap);
      render();
    },
  });
  function cog(cx, cy, r, teeth, color, drive) {
    const g = svg('g', { class: 'cog' + (drive ? ' drive' : '') });
    const inner = r * 0.7, tW = Math.PI / teeth * 0.6;
    let pth = '';
    for (let i = 0; i < teeth; i++) {
      const a = i / teeth * Math.PI * 2;
      const a1 = a - tW, a2 = a + tW, a3 = a + Math.PI / teeth - tW, a4 = a + Math.PI / teeth + tW;
      pth += (i === 0 ? 'M' : 'L') + pt(cx, cy, r, a1) + ' L' + pt(cx, cy, r, a2) + ' L' + pt(cx, cy, inner, a3) + ' L' + pt(cx, cy, inner, a4) + ' ';
    }
    pth += 'Z';
    g.appendChild(svg('path', { d: pth, fill: color, class: 'cog-body' }));
    g.appendChild(svg('circle', { cx, cy, r: r * 0.28, class: 'cog-hub' }));
    if (drive) g.appendChild(svg('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'cog-drive-label', text: 'DRIVE' }));
    return g;
  }
  function pt(cx, cy, r, a) { return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1); }
})(window);
