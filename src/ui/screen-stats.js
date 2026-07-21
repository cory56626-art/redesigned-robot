// Statistics: career record, collection breakdown, best players.
import { el } from '../core/util.js';
import { state } from '../core/store.js';
import { OUTFIELD_RARITIES } from '../data/rarities.js';
import { playerCard } from './components.js';
import { openPlayerDetail } from './screen-collection.js';

export function renderStats(app) {
  const s = state();
  const st = s.stats;
  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(el('h1', { text: 'Statistics' }), el('div', { class: 'sub', text: 'Your career at a glance.' }));

  const played = st.matches || 0;
  const winPct = played ? Math.round((st.wins / played) * 100) : 0;
  const kvs = [
    ['Matches Played', played], ['Wins', st.wins], ['Draws', st.draws], ['Losses', st.losses],
    ['Win Rate', winPct + '%'], ['Goals For', st.goalsFor], ['Goals Against', st.goalsAgainst],
    ['Clean Sheets', st.cleanSheets || 0], ['Best Win', st.bestWin || '—'],
    ['Packs Opened', st.packsOpened || 0], ['Players Collected', s.collection.length],
  ];
  const box = el('div', { class: 'panel', style: { padding: '6px 16px', marginTop: '6px' } });
  kvs.forEach(([k, v]) => box.append(el('div', { class: 'kv' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })])));
  wrap.append(box);

  // rarity breakdown
  wrap.append(el('div', { class: 'section-title', text: 'Collection by Rarity' }));
  const counts = {};
  for (const p of s.collection) counts[p.rarity] = (counts[p.rarity] || 0) + 1;
  const rgrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' } });
  for (const key of Object.keys(OUTFIELD_RARITIES)) {
    rgrid.append(el('div', { class: 'tile', style: { textAlign: 'center', padding: '10px' } }, [
      el('div', { style: { fontSize: '20px', fontWeight: '900' }, text: counts[key] || 0 }),
      el('div', { style: { fontSize: '10px', color: 'var(--muted)', fontWeight: '700' }, text: OUTFIELD_RARITIES[key].name }),
    ]));
  }
  wrap.append(rgrid);

  // top players
  wrap.append(el('div', { class: 'section-title', text: 'Best Players' }));
  const top = [...s.collection].sort((a, b) => b.ovr - a.ovr).slice(0, 6);
  const grid = el('div', { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' } });
  for (const p of top) grid.append(playerCard(p, { size: 'small', onClick: () => openPlayerDetail(app, p) }));
  wrap.append(grid);

  return wrap;
}
