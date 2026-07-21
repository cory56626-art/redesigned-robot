// Player collection grid + the advanced player detail modal (stats, radar, train, sell).
import { el, fmtCoins } from '../core/util.js';
import { state } from '../core/store.js';
import { rng } from '../core/rng.js';
import { nationByCode } from '../data/nations.js';
import { POS_GROUP } from '../data/formations.js';
import { PLAYSTYLES, TRAITS } from '../data/playstyles.js';
import { playerCard, rarityChip, faceStatTiles, detailedStats, radar } from './components.js';
import { trainPlayer, trainCost, addCoins } from '../game/economy.js';
import { sellValue } from '../game/packs.js';

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'gk', label: 'GK', test: (p) => p.isGK },
  { id: 'def', label: 'DEF', test: (p) => ['CB', 'FB'].includes(POS_GROUP[p.primaryPosition]) },
  { id: 'mid', label: 'MID', test: (p) => ['DM', 'CM', 'AM'].includes(POS_GROUP[p.primaryPosition]) },
  { id: 'att', label: 'ATT', test: (p) => ['W', 'ST'].includes(POS_GROUP[p.primaryPosition]) },
];
const SORTS = { ovr: (a, b) => b.ovr - a.ovr, pot: (a, b) => b.potential - a.potential, rar: (a, b) => b.rarityTier - a.rarityTier || b.ovr - a.ovr };

let uiState = { filter: 'all', sort: 'ovr' };

export function renderCollection(app) {
  const s = state();
  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(
    el('h1', { text: 'Player Collection' }),
    el('div', { class: 'sub', text: `${s.collection.length} players · tap a card for the advanced rating page` }),
  );

  const chips = el('div', { class: 'chip-row', style: { marginBottom: '12px' } },
    FILTERS.map((f) => el('button', { class: 'chip' + (uiState.filter === f.id ? ' active' : ''), text: f.label, onclick: () => { uiState.filter = f.id; app.render(); } }))
  );
  const sortSel = el('select', {
    style: { background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '999px', padding: '8px 12px', fontWeight: '700', fontSize: '12px' },
    onchange: (e) => { uiState.sort = e.target.value; app.render(); },
  }, [
    optionEl('ovr', 'Sort: Rating', uiState.sort),
    optionEl('pot', 'Sort: Potential', uiState.sort),
    optionEl('rar', 'Sort: Rarity', uiState.sort),
  ]);
  wrap.append(el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' } }, [chips, sortSel]));

  const f = FILTERS.find((x) => x.id === uiState.filter);
  const list = s.collection.filter(f.test).sort(SORTS[uiState.sort]);
  const grid = el('div', { class: 'card-grid', style: { marginTop: '12px' } });
  if (!list.length) grid.append(el('div', { class: 'center-note', text: 'No players in this filter.' }));
  for (const p of list) grid.append(playerCard(p, { size: 'small', onClick: () => openPlayerDetail(app, p) }));
  wrap.append(grid);
  return wrap;
}

function optionEl(v, label, cur) {
  const o = el('option', { value: v, text: label });
  if (v === cur) o.selected = true;
  return o;
}

/** The advanced player page (shared modal). */
export function openPlayerDetail(app, player) {
  const s = state();
  const nation = nationByCode(player.nationality);
  const inSquad = s.squad.starters.includes(player.id) || s.squad.bench.includes(player.id);

  const content = el('div', {});
  const rebuild = () => {
    content.innerHTML = '';
    const header = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, [
      el('div', { style: { width: '108px', flex: '0 0 108px' } }, [playerCard(player, { size: 'small' })]),
      el('div', { style: { minWidth: '0' } }, [
        el('div', { style: { fontSize: '19px', fontWeight: '900' }, text: player.name }),
        el('div', { style: { fontSize: '13px', color: 'var(--muted)', margin: '4px 0' }, text: `${nation.flag} ${nation.name} · ${player.club}` }),
        el('div', { style: { fontSize: '12px', color: 'var(--muted)' }, text: `Age ${player.age} · ${player.foot} foot · ${player.height}cm` }),
        el('div', { style: { marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
          rarityChip(player),
          el('span', { class: 'chip', style: { padding: '3px 9px', fontSize: '11px' }, text: `${player.positions.join(' · ')}` }),
        ]),
      ]),
    ]);

    const potRow = el('div', { class: 'kv' }, [
      el('span', { class: 'k', text: 'Potential' }),
      el('span', { class: 'v', style: { color: player.potential > player.ovr ? 'var(--accent)' : undefined }, text: player.ovr >= player.potential ? 'Maxed' : `${player.ovr} → ${player.potential}` }),
    ]);

    const styleChips = el('div', { style: { margin: '12px 0' } }, [
      el('div', { class: 'section-title', style: { margin: '0 0 8px' }, text: 'Playstyle & Traits' }),
      el('div', { class: 'chip-row' }, [
        el('span', { class: 'chip', style: { borderColor: 'var(--accent)', color: 'var(--accent)' }, text: '★ ' + (PLAYSTYLES[player.playstyle]?.name || player.playstyle) }),
        ...(player.traits || []).map((t) => el('span', { class: 'chip', text: TRAITS[t]?.name || t })),
      ]),
    ]);

    const statsSection = el('div', {}, [
      el('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', margin: '14px 0' } }, [
        el('div', { style: { flex: '1', minWidth: '150px' } }, [faceStatTiles(player)]),
        radar(player, 168),
      ]),
      el('div', { class: 'section-title', style: { margin: '4px 0 8px' }, text: player.isGK ? 'Goalkeeping Attributes' : 'Detailed Attributes' }),
      detailedStats(player),
    ]);

    // Actions
    const canTrain = player.ovr < player.potential;
    const trainBtn = el('button', {
      class: 'btn blue grow', disabled: !canTrain || undefined,
      onclick: () => {
        const res = trainPlayer(s, player, rng);
        if (res.ok) { app.toast(`Trained! ${player.name} is now ${res.ovr} OVR`, 'good'); app.save(); app.refreshChrome(); rebuild(); }
        else app.toast(res.reason === 'Not enough coins' ? 'Not enough coins' : 'Already at potential', 'bad');
      },
      text: canTrain ? `⬆ Train (${require_fmt(trainCost(s, player))})` : 'Maxed Out',
    });
    const sellBtn = el('button', {
      class: 'btn danger grow', disabled: inSquad || undefined,
      onclick: () => {
        if (inSquad) return app.toast('Remove from squad first', 'bad');
        const v = sellValue(player);
        app.confirm('Quick Sell', `Sell ${player.name} for ${require_fmt(v)} coins? This cannot be undone.`, () => {
          const idx = s.collection.findIndex((x) => x.id === player.id);
          if (idx >= 0) s.collection.splice(idx, 1);
          addCoins(s, v); app.save(); app.refreshChrome(); app.closeModal();
          app.toast(`Sold for ${require_fmt(v)} coins`, 'good');
          if (app.current === 'collection' || app.current === 'squad') app.render();
        }, 'Sell');
      },
      text: inSquad ? 'In Squad' : `💰 Sell (${require_fmt(sellValue(player))})`,
    });

    content.append(
      header, potRow, styleChips, statsSection,
      el('div', { class: 'row' }, [trainBtn, sellBtn]),
      el('button', { class: 'btn ghost block', style: { marginTop: '10px' }, onclick: () => app.closeModal(), text: 'Close' }),
    );
  };
  rebuild();
  app.modal(content, { wide: true });
}

const require_fmt = (n) => fmtCoins(n);
