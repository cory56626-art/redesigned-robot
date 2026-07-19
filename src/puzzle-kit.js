/* ==========================================================================
   puzzle-kit.js — shared helpers used by many puzzles (mouse/touch only).
   ========================================================================== */
(function (global) {
  'use strict';
  const PZ = global.PZ;
  const { el, svg } = PZ;

  const kit = {};

  // Create a responsive SVG board with a fixed viewBox coordinate space.
  kit.board = function (w, h, cls) {
    const s = svg('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      class: 'board ' + (cls || ''),
      preserveAspectRatio: 'xMidYMid meet',
    });
    s.style.touchAction = 'none';
    return s;
  };

  // Attach unified pointer handlers (mouse + touch) to a target.
  // handlers: { down(pt,ev), move(pt,ev), up(pt,ev) }, mapper(ev)->pt
  kit.drag = function (target, handlers, mapper) {
    let active = false, id = null;
    const map = mapper || ((ev) => PZ.localPoint(target, ev));
    function down(ev) {
      if (active) return;
      active = true; id = ev.pointerId;
      if (target.setPointerCapture) { try { target.setPointerCapture(id); } catch (e) {} }
      ev.preventDefault();
      handlers.down && handlers.down(map(ev), ev);
    }
    function move(ev) {
      if (!active || (id !== null && ev.pointerId !== id)) return;
      ev.preventDefault();
      handlers.move && handlers.move(map(ev), ev);
    }
    function up(ev) {
      if (!active || (id !== null && ev.pointerId !== id)) return;
      active = false;
      ev.preventDefault();
      handlers.up && handlers.up(map(ev), ev);
      id = null;
    }
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
    return function off() {
      target.removeEventListener('pointerdown', down);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
  };

  // Generic multiple-choice grid. options: array of {label|node, correct:bool}
  // opts: { columns, onDone(correct) }. Calls ctx.solve() when correct chosen,
  // ctx.fail() on wrong pick (wrong choices get disabled).
  kit.choices = function (ctx, options, opts) {
    opts = opts || {};
    const grid = el('div', { class: 'choice-grid' });
    if (opts.columns) grid.style.gridTemplateColumns = 'repeat(' + opts.columns + ', 1fr)';
    let done = false;
    options.forEach((o) => {
      const b = el('button', { class: 'choice-btn' });
      if (o.node) b.appendChild(o.node); else b.innerHTML = o.label;
      b.addEventListener('click', () => {
        if (done || b.classList.contains('locked')) return;
        if (o.correct) {
          done = true;
          b.classList.add('correct');
          Array.from(grid.children).forEach(c => c.classList.add('locked'));
          ctx.good();
          setTimeout(() => ctx.solve(), 420);
        } else {
          b.classList.add('wrong', 'locked');
          ctx.fail();
        }
      });
      grid.appendChild(b);
    });
    return grid;
  };

  // A labeled panel wrapper for quiz-style puzzles.
  kit.panel = function (children, cls) {
    return el('div', { class: 'kit-panel ' + (cls || '') }, children);
  };

  // Pulse an SVG/DOM node to signal success.
  kit.flashOk = function (node) {
    node.classList.remove('flash-ok'); void node.offsetWidth; node.classList.add('flash-ok');
  };

  // Palette of pleasant symbol glyphs for matching puzzles.
  kit.glyphs = ['★', '●', '▲', '■', '◆', '✦', '♥', '☀', '☾', '♣', '✿', '⬢', '▼', '◑', '☂', '⚡'];
  kit.symbolColors = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#b5179e',
    '#ff8c42', '#7bdff2', '#c77dff', '#90be6d', '#f9c74f'];

  PZ.kit = kit;
})(window);
