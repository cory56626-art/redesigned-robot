// Reusable UI components: player cards, stat displays, radar chart, modal.
import { el } from '../core/util.js';
import { nationByCode } from '../data/nations.js';
import { rarityFor, specialCard, themeFor } from '../data/rarities.js';
import { PLAYSTYLES } from '../data/playstyles.js';
import { faceStats, gkFaceStats, FACE_LABELS, GK_FACE_LABELS, ATTR_LABELS, OUTFIELD_ATTRS, GK_ATTRS } from '../game/ratings.js';

const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function cardTheme(player) {
  const rarity = rarityFor(player.isGK, player.rarity);
  const special = specialCard(player.special);
  const base = themeFor(rarity.theme);
  if (special) {
    const st = themeFor(special.theme);
    return { grad: st.grad, text: st.text, accent: st.accent, glow: st.glow, foil: true, rarity, special };
  }
  return { grad: base.grad, text: base.text, accent: base.accent, glow: base.glow, foil: base.foil, rarity, special: null };
}

/** Build a player card element. opts: { size:'small'|'mini', onClick } */
export function playerCard(player, opts = {}) {
  const t = cardTheme(player);
  const nation = nationByCode(player.nationality);
  const rarity = t.rarity;
  const cls = ['pcard'];
  if (opts.size) cls.push(opts.size);
  if (t.foil) cls.push('foil');

  const card = el('div', {
    class: cls.join(' '),
    style: {
      '--pc-a': t.grad[0], '--pc-b': t.grad[1], '--pc-text': t.text,
      boxShadow: `0 8px 22px ${t.glow}, inset 0 1px 0 rgba(255,255,255,.16)`,
    },
    onclick: opts.onClick,
  }, [
    t.special && el('div', { class: 'pc-special', style: { color: '#fff' }, text: t.special.abbr }),
    el('div', { class: 'pc-top' }, [
      el('div', {}, [
        el('div', { class: 'pc-ovr', text: player.ovr }),
        el('div', { class: 'pc-pos', text: player.primaryPosition }),
      ]),
      el('div', { class: 'pc-flags' }, [
        el('span', { text: nation.flag }),
        player.isGK ? el('span', { text: '🧤' }) : null,
      ]),
    ]),
    opts.size !== 'mini' && el('div', { class: 'pc-body' }, [
      el('div', { class: 'pc-avatar', style: { color: t.text }, text: initials(player.name) }),
    ]),
    el('div', {}, [
      el('div', { class: 'pc-name', text: player.name }),
      el('div', { class: 'pc-meta' }, [
        el('span', { text: rarity.name }),
        el('span', { text: '· ' + (PLAYSTYLES[player.playstyle]?.name || '') }),
      ]),
    ]),
  ]);
  return card;
}

export function rarityChip(player) {
  const t = cardTheme(player);
  const label = (t.special ? t.special.name + ' ' : '') + t.rarity.name;
  return el('span', { class: 'rarity-chip', style: { background: `linear-gradient(135deg, ${t.grad[0]}, ${t.grad[1]})`, color: t.text }, text: label });
}

function barColor(v) {
  if (v >= 87) return '#2fe08a';
  if (v >= 78) return '#8be04a';
  if (v >= 68) return '#f5c542';
  if (v >= 55) return '#f0994a';
  return '#f0664a';
}

export function statBar(label, value) {
  return el('div', { class: 'statbar' }, [
    el('div', { class: 'lbl', text: label }),
    el('div', { class: 'track' }, [el('div', { class: 'fill', style: { width: value + '%', background: barColor(value) } })]),
    el('div', { class: 'val', text: value }),
  ]);
}

/** The six summary (face) stats. */
export function faceStatTiles(player) {
  const faces = player.isGK ? gkFaceStats(player.gk) : faceStats(player.attributes);
  const labels = player.isGK ? GK_FACE_LABELS : FACE_LABELS;
  return el('div', { class: 'facegrid' },
    Object.keys(faces).map((k) => el('div', { class: 'facestat' }, [
      el('div', { class: 'v', style: { color: barColor(faces[k]) }, text: faces[k] }),
      el('div', { class: 'k', text: labels[k] }),
    ]))
  );
}

/** Full detailed attribute list. */
export function detailedStats(player) {
  const attrs = player.isGK ? GK_ATTRS : OUTFIELD_ATTRS;
  const bag = player.isGK ? player.gk : player.attributes;
  return el('div', {}, attrs.map((k) => statBar(ATTR_LABELS[k] || k, bag[k])));
}

/** SVG hexagonal radar of the six face stats. */
export function radar(player, size = 180) {
  const faces = player.isGK ? gkFaceStats(player.gk) : faceStats(player.attributes);
  const keys = Object.keys(faces);
  const labels = player.isGK ? GK_FACE_LABELS : FACE_LABELS;
  const cx = size / 2, cy = size / 2, r = size / 2 - 26;
  const pt = (i, rad) => {
    const a = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  };
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  // grid rings
  for (const ring of [0.33, 0.66, 1]) {
    const pts = keys.map((_, i) => pt(i, r * ring).join(',')).join(' ');
    svg.appendChild(mk('polygon', { points: pts, fill: 'none', stroke: '#ffffff18', 'stroke-width': 1 }));
  }
  // value polygon
  const vpts = keys.map((k, i) => pt(i, r * (faces[k] / 99)).join(',')).join(' ');
  svg.appendChild(mk('polygon', { points: vpts, fill: '#2fe08a44', stroke: '#2fe08a', 'stroke-width': 2 }));
  keys.forEach((k, i) => {
    const [lx, ly] = pt(i, r + 14);
    const t = mk('text', { x: lx, y: ly, fill: '#93a0bd', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = labels[k];
    svg.appendChild(t);
  });
  return svg;
}
