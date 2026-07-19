/* ==========================================================================
   util.js  — global namespace + tiny DOM/SVG helpers (no external libraries)
   ========================================================================== */
(function (global) {
  'use strict';

  const PZ = global.PZ || (global.PZ = {});

  /* ----- DOM helpers ----------------------------------------------------- */
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    if (opts) {
      for (const key in opts) {
        const val = opts[key];
        if (key === 'class' || key === 'className') node.className = val;
        else if (key === 'text') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key === 'style' && typeof val === 'object') Object.assign(node.style, val);
        else if (key === 'dataset') Object.assign(node.dataset, val);
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (val !== null && val !== undefined && val !== false) {
          node.setAttribute(key, val === true ? '' : val);
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, opts, children) {
    const node = document.createElementNS(SVGNS, tag);
    if (opts) {
      for (const key in opts) {
        const val = opts[key];
        if (key === 'text') node.textContent = val;
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (val !== null && val !== undefined && val !== false) {
          node.setAttribute(key, val);
        }
      }
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    for (const c of children) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    }
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ----- math / array helpers ------------------------------------------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function range(n) { return Array.from({ length: n }, (_, i) => i); }

  /* ----- pointer helpers (unify mouse + touch) --------------------------- */
  // Returns {x,y} in the coordinate space of `elm`.
  function localPoint(elm, ev) {
    const r = elm.getBoundingClientRect();
    const cx = ev.clientX, cy = ev.clientY;
    return { x: cx - r.left, y: cy - r.top };
  }
  // For SVG: map client coords into SVG user units.
  function svgPoint(svgEl, ev) {
    const r = svgEl.getBoundingClientRect();
    const vb = svgEl.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : r.width;
    const h = vb && vb.height ? vb.height : r.height;
    return {
      x: ((ev.clientX - r.left) / r.width) * w + (vb ? vb.x : 0),
      y: ((ev.clientY - r.top) / r.height) * h + (vb ? vb.y : 0),
    };
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  PZ.el = el;
  PZ.svg = svg;
  PZ.clear = clear;
  PZ.clamp = clamp;
  PZ.lerp = lerp;
  PZ.dist = dist;
  PZ.shuffle = shuffle;
  PZ.range = range;
  PZ.localPoint = localPoint;
  PZ.svgPoint = svgPoint;
  PZ.fmtTime = fmtTime;
  PZ.SVGNS = SVGNS;
})(window);
