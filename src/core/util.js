// Core utilities: DOM helpers, math, formatting. No dependencies.

/** Create an element with attributes and children. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** querySelector shorthand. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Clamp a number to [min,max]. */
export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Inverse lerp. */
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

/** Map value from one range to another. */
export const remap = (v, a, b, c, d) => lerp(c, d, invLerp(a, b, v));

/** Distance between two 2D points. */
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Round to n decimals. */
export const round = (v, n = 0) => {
  const p = Math.pow(10, n);
  return Math.round(v * p) / p;
};

/** Format a number with thousands separators. */
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Format coins compactly (12.4K, 3.1M). */
export function fmtCoins(n) {
  n = Math.round(n);
  if (n >= 1_000_000) return round(n / 1_000_000, 2) + 'M';
  if (n >= 10_000) return round(n / 1000, 1) + 'K';
  return fmt(n);
}

/** Format seconds as mm:ss. */
export function fmtClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Pick a weighted random entry. weights: [{item, weight}]. */
export function weightedPick(entries, rand = Math.random) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let r = rand() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

/** Debounce a function. */
export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Deep-ish clone via JSON (data objects only). */
export const clone = (o) => JSON.parse(JSON.stringify(o));

/** Wait ms. */
export const wait = (ms) => new Promise((res) => setTimeout(res, ms));

/** Uppercase-first. */
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Unique-ish id. */
let _idc = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(_idc++).toString(36)}`;

/** Sum a numeric array. */
export const sum = (arr) => arr.reduce((s, v) => s + v, 0);

/** Average of numeric array. */
export const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
