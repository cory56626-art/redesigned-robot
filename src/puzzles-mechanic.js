/* ==========================================================================
   puzzles-mechanic.js — logic circuit, weight balance, color mixing,
   spot the difference, drag ordering, quick actions under pressure.
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, svg, kit } = PZ;

  /* ====================================================================== */
  /* CIRCUIT — toggle inputs so the lamp matches the goal                   */
  /* ====================================================================== */
  const GATES = {
    AND: (a, b) => a && b, OR: (a, b) => a || b, XOR: (a, b) => a !== b,
    NAND: (a, b) => !(a && b), NOR: (a, b) => !(a || b), NOT: (a) => !a,
  };
  PZ.register({
    id: 'circuit', name: 'Logic Circuit', category: 'circuit', hue: 55, minDifficulty: 2,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const k = Math.min(4, 2 + Math.floor(d / 2));
      const nodes = [];
      function add(node) { node.id = nodes.length; nodes.push(node); return node.id; }
      const inputs = [];
      for (let i = 0; i < k; i++) inputs.push(add({ type: 'in', value: r.chance(0.5), label: 'IN' + (i + 1) }));
      let pool = inputs.slice();
      const gateTypes = d >= 4 ? ['AND', 'OR', 'XOR', 'NAND', 'NOR'] : ['AND', 'OR', 'XOR'];
      while (pool.length > 1) {
        const ai = r.int(0, pool.length - 1); const a = pool.splice(ai, 1)[0];
        const bi = r.int(0, pool.length - 1); const b = pool.splice(bi, 1)[0];
        const g = r.pick(gateTypes);
        pool.push(add({ type: 'gate', gate: g, inputs: [a, b] }));
      }
      let outId = pool[0];
      if (d >= 3 && r.chance(0.5)) outId = add({ type: 'gate', gate: 'NOT', inputs: [outId] });
      nodes[outId].isOutput = true;

      function evalAll() {
        for (const nd of nodes) {
          if (nd.type === 'in') continue;
          if (nd.gate === 'NOT') nd.value = GATES.NOT(nodes[nd.inputs[0]].value);
          else nd.value = GATES[nd.gate](nodes[nd.inputs[0]].value, nodes[nd.inputs[1]].value);
        }
      }
      evalAll();
      const target = nodes[outId].value; // reachable by construction (current assignment)

      // depth layout
      function depth(id) { const nd = nodes[id]; if (nd.type === 'in') return 0; return 1 + Math.max(...nd.inputs.map(depth)); }
      const maxDepth = depth(outId);
      const cols = {}; nodes.forEach(nd => { const dep = nd.type === 'in' ? 0 : depth(nd.id); (cols[dep] = cols[dep] || []).push(nd); });
      const W = 420, H = Math.max(230, (Math.max(...Object.values(cols).map(c => c.length))) * 66 + 40);
      const colCount = maxDepth + 1;
      nodes.forEach(nd => {
        const dep = nd.type === 'in' ? 0 : depth(nd.id);
        const list = cols[dep]; const idx = list.indexOf(nd);
        nd.x = 40 + dep * ((W - 90) / Math.max(1, colCount - 1));
        nd.y = (H / (list.length + 1)) * (idx + 1);
      });

      ctx.setPrompt('Click the input switches so the lamp matches the goal.');
      ctx.setHint('Goal: lamp = <b>' + (target ? 'ON' : 'OFF') + '</b>');
      const board = kit.board(W, H, 'circuit-board');
      const wireG = svg('g', {}); board.appendChild(wireG);
      const wireEls = [];
      nodes.forEach(nd => { if (nd.inputs) nd.inputs.forEach(src => { const l = svg('path', { class: 'ckt-wire' }); wireG.appendChild(l); wireEls.push({ l, src, dst: nd.id }); }); });
      const nodeG = svg('g', {}); board.appendChild(nodeG);
      const lamp = { el: null };
      nodes.forEach(nd => {
        if (nd.type === 'in') {
          const g = svg('g', { class: 'ckt-in' });
          const c = svg('circle', { cx: nd.x, cy: nd.y, r: 16, class: 'ckt-switch' });
          g.appendChild(c);
          g.appendChild(svg('text', { x: nd.x, y: nd.y + 5, 'text-anchor': 'middle', class: 'ckt-inlabel', text: nd.label }));
          g.addEventListener('click', () => { nd.value = !nd.value; evalAll(); render(); ctx.good(); });
          nodeG.appendChild(g); nd.dom = c;
        } else if (nd.isOutput) {
          nd.dom = svg('circle', { cx: nd.x, cy: nd.y, r: 18, class: 'ckt-lamp' });
          nodeG.appendChild(nd.dom);
          nodeG.appendChild(svg('text', { x: nd.x, y: nd.y - 26, 'text-anchor': 'middle', class: 'ckt-gatelabel', text: nd.gate }));
        } else {
          const w = 46, h = 30;
          nd.dom = svg('rect', { x: nd.x - w / 2, y: nd.y - h / 2, width: w, height: h, rx: 6, class: 'ckt-gate' });
          nodeG.appendChild(nd.dom);
          nodeG.appendChild(svg('text', { x: nd.x, y: nd.y + 5, 'text-anchor': 'middle', class: 'ckt-gatetext', text: nd.gate }));
        }
      });
      function render() {
        wireEls.forEach(w => { const a = nodes[w.src], b = nodes[w.dst]; const mx = (a.x + b.x) / 2; w.l.setAttribute('d', 'M' + (a.x + 18) + ',' + a.y + ' C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + (b.x - 24) + ',' + b.y); w.l.classList.toggle('live', nodes[w.src].value); });
        nodes.forEach(nd => { if (nd.dom) { nd.dom.classList.toggle('on', !!nd.value); } });
        if (nodes[outId].value === target) { kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 400); }
      }
      // ensure the puzzle does NOT start already solved: find any assignment
      // whose output differs from the goal (guaranteed to exist for these trees).
      if (nodes[outId].value === target) {
        const combos = 1 << k;
        for (let c = 0; c < combos; c++) {
          inputs.forEach((id, bi) => { nodes[id].value = !!(c & (1 << bi)); });
          evalAll();
          if (nodes[outId].value !== target) break;
        }
      }
      if (window.__PZ_TEST__) ctx.root.__solve = () => { const combos = 1 << k; for (let c = 0; c < combos; c++) { inputs.forEach((id, bi) => { nodes[id].value = !!(c & (1 << bi)); }); evalAll(); if (nodes[outId].value === target) { render(); return; } } };
      render();
      ctx.root.appendChild(board);
    },
  });

  /* ====================================================================== */
  /* WEIGHT BALANCE                                                         */
  /* ====================================================================== */
  PZ.register({
    id: 'weigh', name: 'Balance Scale', category: 'weight balancing', hue: 175, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const partCount = Math.min(5, 2 + Math.floor(d / 2));
      const solution = []; let target = 0;
      for (let i = 0; i < partCount; i++) { const w = r.int(1, 9); solution.push(w); target += w; }
      const decoys = Math.min(4, 1 + Math.floor(d / 2));
      const tray = solution.slice();
      for (let i = 0; i < decoys; i++) tray.push(r.int(1, 9));
      const trayItems = PZ.shuffle(tray, r).map((w, i) => ({ id: i, w, placed: false }));

      ctx.setPrompt('Drag weights onto the right pan until both pans balance. Click a placed weight to remove it.');
      const W = 420, H = 260;
      const board = kit.board(W, H, 'scale-board');
      const beam = svg('g', {}); board.appendChild(beam);
      const pivotX = W / 2, pivotY = 70;
      beam.appendChild(svg('polygon', { points: pivotX + ',' + pivotY + ' ' + (pivotX - 16) + ',' + (pivotY + 60) + ' ' + (pivotX + 16) + ',' + (pivotY + 60), class: 'scale-post' }));
      const arm = svg('g', {}); beam.appendChild(arm);
      const armLine = svg('line', { x1: pivotX - 150, y1: pivotY, x2: pivotX + 150, y2: pivotY, class: 'scale-arm' }); arm.appendChild(armLine);
      const leftPan = svg('g', {}), rightPan = svg('g', {}); arm.appendChild(leftPan); arm.appendChild(rightPan);
      function pan(g, x, label) {
        g.appendChild(svg('line', { x1: x, y1: pivotY, x2: x, y2: pivotY + 46, class: 'scale-string' }));
        g.appendChild(svg('rect', { x: x - 46, y: pivotY + 46, width: 92, height: 14, rx: 6, class: 'scale-pan' }));
        g.appendChild(svg('text', { x, y: pivotY + 84, 'text-anchor': 'middle', class: 'scale-total', text: label }));
      }
      pan(leftPan, pivotX - 150, ''); pan(rightPan, pivotX + 150, '');
      const leftTotalEl = leftPan.querySelector('.scale-total'), rightTotalEl = rightPan.querySelector('.scale-total');
      // left weights (fixed)
      solution.forEach((w, i) => leftPan.appendChild(svg('rect', { x: pivotX - 150 - 30 + (i % 3) * 20 - 10, y: pivotY + 24 - Math.floor(i / 3) * 20, width: 18, height: 16, rx: 3, class: 'scale-w fixed' })));
      const rightHost = svg('g', {}); rightPan.appendChild(rightHost);

      const trayEl = el('div', { class: 'weigh-tray' });
      function rightTotal() { return trayItems.filter(t => t.placed).reduce((s, t) => s + t.w, 0); }
      function renderScale() {
        leftTotalEl.textContent = 'Left: ' + target;
        const rt = rightTotal();
        rightTotalEl.textContent = 'Right: ' + rt;
        const diff = PZ.clamp((rt - target) * 3, -22, 22);
        arm.setAttribute('transform', 'rotate(' + diff + ' ' + pivotX + ' ' + pivotY + ')');
        PZ.clear(rightHost);
        const placed = trayItems.filter(t => t.placed);
        placed.forEach((t, i) => { const rx = svg('rect', { x: pivotX + 150 - 30 + (i % 3) * 20 - 10, y: pivotY + 24 - Math.floor(i / 3) * 20, width: 18, height: 16, rx: 3, class: 'scale-w' }); rx.addEventListener('click', () => { t.placed = false; renderScale(); renderTray(); }); rightHost.appendChild(rx); });
        if (rt === target && placed.length > 0) { kit.flashOk(board); ctx.good(); setTimeout(() => ctx.solve(), 400); }
      }
      function renderTray() {
        PZ.clear(trayEl);
        trayItems.filter(t => !t.placed).forEach(t => {
          const b = el('div', { class: 'weigh-block', text: t.w });
          b.style.touchAction = 'none';
          b.addEventListener('pointerdown', (ev) => startDrag(ev, t));
          trayEl.appendChild(b);
        });
      }
      let ghost = null;
      function startDrag(ev, t) {
        ev.preventDefault();
        ghost = el('div', { class: 'weigh-block weigh-ghost', text: t.w }); document.body.appendChild(ghost); mv(ev);
        const move = (e) => { e.preventDefault(); mv(e); };
        const up = (e) => {
          e.preventDefault(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          if (ghost) { ghost.remove(); ghost = null; }
          const b = board.getBoundingClientRect();
          // dropping anywhere on the right half of the scale places it
          if (e.clientX > b.left + b.width / 2 && e.clientY > b.top && e.clientY < b.bottom) { t.placed = true; ctx.good(); renderScale(); renderTray(); }
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }
      function mv(ev) { if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; } }
      ctx.onCleanup(() => { if (ghost) ghost.remove(); });

      renderScale(); renderTray();
      ctx.root.appendChild(el('div', { class: 'weigh-wrap' }, [board, el('div', { class: 'weigh-tray-box' }, [el('span', { class: 'fit-tray-label', text: 'Weights — drag to the right pan' }), trayEl])]));
    },
  });

  /* ====================================================================== */
  /* COLOR MIXING                                                           */
  /* ====================================================================== */
  PZ.register({
    id: 'colormix', name: 'Color Mixer', category: 'color matching', hue: 300, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const step = 8;
      const rnd = () => step * r.int(2, 30);
      const target = { r: rnd(), g: rnd(), b: rnd() };
      const tol = Math.max(10, 46 - d * 5);
      const cur = { r: 128, g: 128, b: 128 };

      ctx.setPrompt('Drag the three sliders to mix a color that matches the target.');
      const targetSw = el('div', { class: 'mix-swatch' });
      targetSw.style.background = rgb(target);
      const curSw = el('div', { class: 'mix-swatch' });
      const swatches = el('div', { class: 'mix-swatches' }, [
        el('div', { class: 'mix-col' }, [el('span', { class: 'mix-lbl', text: 'Target' }), targetSw]),
        el('div', { class: 'mix-col' }, [el('span', { class: 'mix-lbl', text: 'Your mix' }), curSw]),
      ]);
      const sliders = el('div', { class: 'mix-sliders' });
      let solved = false;
      function refresh() {
        curSw.style.background = rgb(cur);
        const close = Math.abs(cur.r - target.r) <= tol && Math.abs(cur.g - target.g) <= tol && Math.abs(cur.b - target.b) <= tol;
        curSw.classList.toggle('matched', close);
        if (close && !solved) { solved = true; kit.flashOk(curSw); ctx.good(); setTimeout(() => ctx.solve(), 400); }
      }
      ['r', 'g', 'b'].forEach(ch => {
        const track = el('div', { class: 'mix-track mix-' + ch });
        const fill = el('div', { class: 'mix-fill' });
        const handle = el('div', { class: 'mix-handle' });
        track.appendChild(fill); track.appendChild(handle);
        function setFromClientX(clientX) {
          const b = track.getBoundingClientRect();
          const v = PZ.clamp(Math.round(((clientX - b.left) / b.width) * 255), 0, 255);
          cur[ch] = v; const pct = (v / 255 * 100);
          handle.style.left = pct + '%'; fill.style.width = pct + '%';
          refresh();
        }
        handle.style.left = (cur[ch] / 255 * 100) + '%'; fill.style.width = (cur[ch] / 255 * 100) + '%';
        track.style.touchAction = 'none';
        kit.drag(track, { down: (p, ev) => setFromClientX(ev.clientX), move: (p, ev) => setFromClientX(ev.clientX) });
        sliders.appendChild(el('div', { class: 'mix-row' }, [el('span', { class: 'mix-ch', text: ch.toUpperCase() }), track]));
      });
      refresh();
      ctx.root.appendChild(el('div', { class: 'mix-wrap' }, [swatches, sliders]));
    },
  });
  function rgb(c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; }

  /* ====================================================================== */
  /* SPOT THE DIFFERENCE                                                    */
  /* ====================================================================== */
  PZ.register({
    id: 'spot', name: 'Spot the Difference', category: 'spot the difference', hue: 15, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const count = 9 + d * 2;
      const diffs = Math.min(6, 2 + Math.floor(d / 2));
      const shapes = ['circle', 'square', 'triangle', 'diamond', 'star', 'hex'];
      const base = [];
      const PW = 260, PH = 260;
      for (let i = 0; i < count; i++) base.push({ x: r.float(24, PW - 24), y: r.float(24, PH - 24), r: r.float(12, 22), shape: r.pick(shapes), color: r.pick(PZ._PALETTE) });
      const copy = base.map(s => Object.assign({}, s));
      const changedIdx = PZ.shuffle(PZ.range(count), r).slice(0, diffs);
      const changed = new Set(changedIdx);
      changedIdx.forEach(i => {
        const mode = r.int(0, 2);
        if (mode === 0) { let c; do { c = r.pick(PZ._PALETTE); } while (c === copy[i].color); copy[i].color = c; }
        else if (mode === 1) { let s; do { s = r.pick(shapes); } while (s === copy[i].shape); copy[i].shape = s; }
        else { copy[i].r = copy[i].r * (r.chance(0.5) ? 1.5 : 0.6); }
      });

      ctx.setPrompt('Two scenes, ' + diffs + ' differences. Click each changed shape in the right panel.');
      const found = new Set();
      function panel(items, interactive) {
        const s = kit.board(PW, PH, 'spot-panel');
        s.appendChild(svg('rect', { x: 0, y: 0, width: PW, height: PH, class: 'spot-bg' }));
        items.forEach((it, i) => {
          const node = PZ._drawSymbol(it.x, it.y, it.r, it.shape, it.color, 1);
          node.classList.add('spot-shape');
          if (interactive) node.addEventListener('click', () => {
            if (found.has(i)) return;
            if (changed.has(i)) { found.add(i); ctx.good(); s.appendChild(svg('circle', { cx: it.x, cy: it.y, r: it.r + 8, class: 'spot-mark' })); update(); if (found.size === diffs) { kit.flashOk(s); setTimeout(() => ctx.solve(), 350); } }
            else { ctx.fail(); ctx.toast('Not a difference', 'bad'); }
          });
          s.appendChild(node);
        });
        return s;
      }
      const counter = el('div', { class: 'spot-counter' });
      function update() { counter.textContent = 'Found ' + found.size + ' / ' + diffs; }
      update();
      ctx.root.appendChild(el('div', { class: 'spot-wrap' }, [
        el('div', { class: 'spot-pair' }, [
          el('div', { class: 'spot-col' }, [el('span', { class: 'spot-lbl', text: 'Original' }), panel(base, false)]),
          el('div', { class: 'spot-col' }, [el('span', { class: 'spot-lbl', text: 'Find the changes' }), panel(copy, true)]),
        ]),
        counter,
      ]));
    },
  });

  /* ====================================================================== */
  /* DRAG ORDERING                                                          */
  /* ====================================================================== */
  PZ.register({
    id: 'order', name: 'Sort It Out', category: 'ordering', hue: 230, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const k = Math.min(8, 4 + d);
      const ascending = r.chance(0.5);
      const values = []; const set = new Set();
      while (values.length < k) { const v = r.int(2, 99); if (!set.has(v)) { set.add(v); values.push(v); } }
      let arrange = PZ.shuffle(values, r);
      if (isSorted(arrange, ascending)) arrange = arrange.reverse();

      ctx.setPrompt('Drag the tiles into ' + (ascending ? 'ascending (small → large)' : 'descending (large → small)') + ' order.');
      const row = el('div', { class: 'order-row' });
      let order = arrange.slice();
      const tiles = [];
      function heightFor(v) { return 28 + (v / 99) * 80; }
      function render() {
        PZ.clear(row);
        order.forEach((v, i) => {
          const t = el('div', { class: 'order-tile', dataset: { i } });
          t.style.setProperty('--bar', heightFor(v) + 'px');
          t.appendChild(el('div', { class: 'order-bar' }));
          t.appendChild(el('span', { class: 'order-num', text: v }));
          t.style.touchAction = 'none';
          t.addEventListener('pointerdown', (ev) => startDrag(ev, i));
          row.appendChild(t); tiles[i] = t;
        });
        if (isSorted(order, ascending)) { kit.flashOk(row); setTimeout(() => ctx.solve(), 350); }
      }
      let ghost = null, from = -1;
      function indexUnder(clientX) {
        const kids = Array.from(row.children); for (let i = 0; i < kids.length; i++) { const b = kids[i].getBoundingClientRect(); if (clientX < b.left + b.width) return i; } return kids.length - 1;
      }
      function startDrag(ev, i) {
        ev.preventDefault(); from = i;
        ghost = el('div', { class: 'order-tile order-ghost' }); ghost.style.setProperty('--bar', heightFor(order[i]) + 'px');
        ghost.appendChild(el('div', { class: 'order-bar' })); ghost.appendChild(el('span', { class: 'order-num', text: order[i] }));
        document.body.appendChild(ghost); mv(ev); tiles[i].classList.add('dragging');
        const move = (e) => { e.preventDefault(); mv(e); };
        const up = (e) => {
          e.preventDefault(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          if (ghost) { ghost.remove(); ghost = null; }
          const to = indexUnder(e.clientX);
          if (to !== from && to >= 0) { const v = order.splice(from, 1)[0]; order.splice(to, 0, v); ctx.good(); }
          render();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }
      function mv(ev) { if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; } }
      ctx.onCleanup(() => { if (ghost) ghost.remove(); });
      render();
      ctx.root.appendChild(row);
    },
  });
  function isSorted(a, asc) { for (let i = 1; i < a.length; i++) { if (asc && a[i] < a[i - 1]) return false; if (!asc && a[i] > a[i - 1]) return false; } return true; }

  /* ====================================================================== */
  /* QUICK ACTIONS UNDER PRESSURE                                           */
  /* ====================================================================== */
  PZ.register({
    id: 'quicktap', name: 'Reflex Sequence', category: 'quick actions', hue: 5, minDifficulty: 1,
    build(ctx) {
      const r = ctx.rng, d = ctx.difficulty;
      const k = Math.min(12, 5 + d);
      const seconds = Math.max(5, 14 - d);
      const W = 380, H = 300;

      ctx.setPrompt('Tap the numbered targets in order (1 → ' + k + ') before the timer runs out!');
      const bar = el('div', { class: 'qt-bar' }); const barFill = el('div', { class: 'qt-fill' }); bar.appendChild(barFill);
      const board = kit.board(W, H, 'qt-board');
      const status = el('div', { class: 'qt-status' });

      let next = 1, targets = [], raf = null, endAt = 0, running = true;
      function layout() {
        PZ.clear(board); targets = [];
        const placed = [];
        for (let i = 1; i <= k; i++) {
          let x, y, tries = 0;
          do { x = r.float(28, W - 28); y = r.float(28, H - 28); tries++; } while (tries < 40 && placed.some(p => PZ.dist(p.x, p.y, x, y) < 46));
          placed.push({ x, y });
          const g = svg('g', { class: 'qt-target' });
          g.appendChild(svg('circle', { cx: x, cy: y, r: 20, class: 'qt-dot' }));
          g.appendChild(svg('text', { x, y: y + 6, 'text-anchor': 'middle', class: 'qt-num', text: i }));
          const num = i;
          g.addEventListener('click', () => hit(num, g));
          board.appendChild(g); targets.push(g);
        }
      }
      function hit(num, g) {
        if (!running) return;
        if (num === next) { g.classList.add('done'); ctx.good(); next++; if (next > k) { running = false; cancel(); kit.flashOk(board); setTimeout(() => ctx.solve(), 300); } }
        else { ctx.fail(); ctx.toast('Wrong order', 'bad'); g.classList.remove('shake-t'); void g.offsetWidth; g.classList.add('shake-t'); }
        status.textContent = 'Next: ' + Math.min(next, k);
      }
      function start() { next = 1; running = true; endAt = Date.now() + seconds * 1000; layout(); status.textContent = 'Next: 1'; tick(); }
      function tick() {
        const left = endAt - Date.now(); const pct = PZ.clamp(left / (seconds * 1000), 0, 1);
        barFill.style.width = (pct * 100) + '%';
        barFill.classList.toggle('danger', pct < 0.3);
        if (left <= 0) { ctx.fail(); ctx.toast('Time! Resetting…', 'bad'); start(); return; }
        raf = requestAnimationFrame(tick);
      }
      function cancel() { if (raf) cancelAnimationFrame(raf); raf = null; }
      ctx.onCleanup(cancel);
      start();
      ctx.root.appendChild(el('div', { class: 'qt-wrap' }, [bar, board, status]));
    },
  });
})(window);
