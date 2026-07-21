// Squad builder: interactive formation pitch, bench, team rating & chemistry.
import { el } from '../core/util.js';
import { state } from '../core/store.js';
import { formation } from '../data/formations.js';
import { starterSlots, benchPlayers, teamRating, chemistry, validateSquad, autoFill, collectionMap } from '../game/squad.js';
import { effectiveOvr, positionPenalty, fitLevel } from '../game/ratings.js';
import { playerCard } from './components.js';
import { openPlayerDetail } from './screen-collection.js';

const FIT_COLOR = { perfect: '#2fe08a', good: '#8be04a', ok: '#f5c542', poor: '#f0664a' };

export function renderSquad(app) {
  const s = state();
  const f = formation(s.squad.formation);
  const cmap = collectionMap(s);
  const valid = validateSquad(s, cmap);

  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' } }, [
      el('div', {}, [el('h1', { text: 'Squad Builder' }), el('div', { class: 'sub', text: f.name + ' · tap a position to fill it' })]),
      el('button', { class: 'btn', onclick: () => app.go('formation'), text: '⚽ Formation' }),
    ])
  );

  // stat row
  wrap.append(el('div', { style: { display: 'flex', gap: '10px', marginBottom: '14px' } }, [
    statTile('Team Rating', teamRating(s, cmap), '#38bdf8'),
    statTile('Chemistry', chemistry(s, cmap), '#2fe08a'),
    statTile('Filled', `${valid.filled}/11`, valid.valid ? '#2fe08a' : '#f0994a'),
  ]));

  // pitch
  const pitch = el('div', { class: 'pitch-view' });
  pitch.appendChild(pitchLines());
  const slots = starterSlots(s, cmap);
  for (const { index, slot, player } of slots) {
    const left = slot.x * 100;
    const top = (1 - slot.y) * 86 + 7;
    const node = el('div', { class: 'slot', style: { left: left + '%', top: top + '%' }, onclick: () => openSlotPicker(app, index, slot) });
    if (player) {
      const eff = effectiveOvr(player, slot.pos);
      const fit = fitLevel(player, slot.pos);
      node.append(
        el('div', { class: 'dot', style: { background: `linear-gradient(135deg, ${s.club.colors[0]}, ${s.club.colors[1]})`, borderColor: FIT_COLOR[fit] }, text: eff }),
        el('div', { class: 'pos', text: slot.pos }),
        el('div', { class: 'nm', text: player.name.split(' ').slice(-1)[0] }),
      );
    } else {
      node.append(el('div', { class: 'dot empty', text: '+' }), el('div', { class: 'pos', text: slot.pos }));
    }
    pitch.appendChild(node);
  }
  wrap.appendChild(pitch);

  wrap.append(el('button', { class: 'btn primary block', style: { marginTop: '14px' }, onclick: () => { autoFill(s); app.save(); app.render(); app.toast('Best XI selected', 'good'); }, text: '✨ Auto Fill Best XI' }));

  // bench
  wrap.append(el('div', { class: 'section-title', text: 'Substitutes' }));
  const bench = benchPlayers(s, cmap);
  const benchGrid = el('div', { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' } });
  for (let i = 0; i < 7; i++) {
    const p = bench[i];
    if (p) benchGrid.append(el('div', {}, [playerCard(p, { size: 'mini', onClick: () => openBenchOptions(app, p) })]));
    else benchGrid.append(el('div', { class: 'pcard mini empty', onclick: () => openBenchPicker(app), style: { minHeight: '52px' }, text: '+ Add sub' }));
  }
  wrap.appendChild(benchGrid);
  return wrap;
}

function statTile(label, value, color) {
  return el('div', { class: 'tile grow', style: { textAlign: 'center', padding: '12px' } }, [
    el('div', { style: { fontSize: '24px', fontWeight: '900', color }, text: value }),
    el('div', { style: { fontSize: '11px', color: 'var(--muted)', fontWeight: '700', marginTop: '2px' }, text: label }),
  ]);
}

function eligibleFor(s, slot, excludeId) {
  const isGKslot = slot.pos === 'GK';
  const used = new Set([...s.squad.starters, ...s.squad.bench].filter(Boolean));
  return s.collection
    .filter((p) => (isGKslot ? p.isGK : !p.isGK))
    .filter((p) => !used.has(p.id) || p.id === excludeId)
    .sort((a, b) => effectiveOvr(b, slot.pos) - effectiveOvr(a, slot.pos));
}

function openSlotPicker(app, index, slot) {
  const s = state();
  const current = s.squad.starters[index];
  const list = eligibleFor(s, slot, current);
  const content = el('div', {}, [el('h2', { text: `Select ${slot.pos}` })]);
  if (current) {
    content.append(el('button', {
      class: 'btn danger block', style: { marginTop: '10px' },
      onclick: () => { s.squad.starters[index] = null; app.save(); app.closeModal(); app.render(); },
      text: 'Remove from XI',
    }));
  }
  const rows = el('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '52vh', overflowY: 'auto' } });
  if (!list.length) rows.append(el('div', { class: 'center-note', text: 'No eligible players. Open packs to get more.' }));
  for (const p of list) rows.append(playerRow(p, slot, () => { assignStarter(s, index, p.id); app.save(); app.closeModal(); app.render(); }));
  content.append(rows, el('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => app.closeModal(), text: 'Cancel' }));
  app.modal(content);
}

function playerRow(p, slot, onClick) {
  const fit = fitLevel(p, slot.pos);
  const eff = effectiveOvr(p, slot.pos);
  return el('div', {
    style: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '8px 10px', cursor: 'pointer' },
    onclick: onClick,
  }, [
    el('div', { style: { fontSize: '20px', fontWeight: '900', width: '34px', textAlign: 'center' }, text: eff }),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div', { style: { fontWeight: '800', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, text: p.name }),
      el('div', { style: { fontSize: '11px', color: 'var(--muted)' }, text: `${p.primaryPosition} · ${p.ovr} OVR` }),
    ]),
    el('span', { style: { fontSize: '11px', fontWeight: '800', color: FIT_COLOR[fit] }, text: positionPenalty(p, slot.pos) === 0 ? 'Natural' : `-${positionPenalty(p, slot.pos)}` }),
  ]);
}

function assignStarter(s, index, playerId) {
  const si = s.squad.starters.indexOf(playerId);
  if (si >= 0) s.squad.starters[si] = null;
  const bi = s.squad.bench.indexOf(playerId);
  if (bi >= 0) s.squad.bench.splice(bi, 1);
  s.squad.starters[index] = playerId;
}

function openBenchPicker(app) {
  const s = state();
  const used = new Set([...s.squad.starters, ...s.squad.bench].filter(Boolean));
  const list = s.collection.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  const content = el('div', {}, [el('h2', { text: 'Add Substitute' })]);
  const rows = el('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '56vh', overflowY: 'auto' } });
  if (!list.length) rows.append(el('div', { class: 'center-note', text: 'No spare players.' }));
  for (const p of list) rows.append(playerRow(p, { pos: p.primaryPosition }, () => { if (s.squad.bench.length < 7) s.squad.bench.push(p.id); app.save(); app.closeModal(); app.render(); }));
  content.append(rows, el('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => app.closeModal(), text: 'Cancel' }));
  app.modal(content);
}

function openBenchOptions(app, p) {
  const s = state();
  const content = el('div', {}, [
    el('h2', { text: p.name }),
    el('div', { class: 'row' }, [
      el('button', { class: 'btn grow', onclick: () => { app.closeModal(); openPlayerDetail(app, p); }, text: 'View' }),
      el('button', { class: 'btn danger grow', onclick: () => { const i = s.squad.bench.indexOf(p.id); if (i >= 0) s.squad.bench.splice(i, 1); app.save(); app.closeModal(); app.render(); }, text: 'Remove' }),
    ]),
  ]);
  app.modal(content);
}

export function pitchLines() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'lines');
  svg.setAttribute('viewBox', '0 0 68 92');
  svg.setAttribute('preserveAspectRatio', 'none');
  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const st = { fill: 'none', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 0.5 };
  svg.appendChild(mk('rect', { x: 3, y: 3, width: 62, height: 86, ...st }));
  svg.appendChild(mk('line', { x1: 3, y1: 46, x2: 65, y2: 46, ...st }));
  svg.appendChild(mk('circle', { cx: 34, cy: 46, r: 8, ...st }));
  svg.appendChild(mk('rect', { x: 20, y: 3, width: 28, height: 12, ...st }));
  svg.appendChild(mk('rect', { x: 20, y: 77, width: 28, height: 12, ...st }));
  return svg;
}
