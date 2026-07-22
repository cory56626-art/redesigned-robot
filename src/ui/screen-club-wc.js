// Club management: overview, career progress, facility upgrades, trophies.
import { el, fmtCoins } from '../core/util.js';
import { state } from '../core/store.js';
import { FACILITIES, upgradeCost, applyUpgrade, facilityLevel, canUpgrade, xpForLevel } from '../game/economy.js';
import { currentCompetition, advanceCampaign, leagueStandings, CAMPAIGN } from '../game/progression-wc.js';

export function renderClub(app) {
  const s = state();
  const c = s.club;
  const comp = currentCompetition(s);
  const wrap = el('div', { class: 'screen-inner' });

  // header
  const xpNeed = xpForLevel(c.level);
  wrap.append(el('div', { class: 'panel', style: { padding: '18px', display: 'flex', gap: '14px', alignItems: 'center' } }, [
    el('img', { src: c.badge, style: { width: '58px', height: '58px' } }),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div', { style: { fontWeight: '900', fontSize: '19px' }, text: c.name }),
      el('div', { style: { fontSize: '12px', color: 'var(--muted)', margin: '3px 0 6px' }, text: `Level ${c.level} · ${c.xp}/${xpNeed} XP` }),
      el('div', { style: { height: '6px', background: '#0c1224', borderRadius: '3px', overflow: 'hidden' } }, [
        el('div', { style: { height: '100%', width: Math.min(100, (c.xp / xpNeed) * 100) + '%', background: 'linear-gradient(90deg, var(--accent2), var(--accent))' } }),
      ]),
    ]),
  ]));

  // record
  wrap.append(el('div', { style: { display: 'flex', gap: '10px', marginTop: '12px' } }, [
    rec('Wins', s.stats.wins, '#2fe08a'), rec('Draws', s.stats.draws, '#f5c542'), rec('Losses', s.stats.losses, '#ff5470'),
  ]));

  // career progress
  wrap.append(el('div', { class: 'section-title', text: 'Career' }));
  const careerBox = el('div', { class: 'panel', style: { padding: '16px' } });
  const stageIdx = comp ? comp.index : 0;
  careerBox.append(
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
      el('div', {}, [
        el('div', { style: { fontWeight: '900', fontSize: '16px' }, text: comp ? comp.name : 'Career' }),
        el('div', { style: { fontSize: '12px', color: 'var(--muted)' }, text: `Stage ${stageIdx + 1} of ${CAMPAIGN.length} · road to the World Cup` }),
      ]),
      el('div', { style: { fontSize: '26px' }, text: stageIcon(comp) }),
    ]),
  );
  if (comp && comp.done) {
    careerBox.append(el('button', {
      class: 'btn primary block', style: { marginTop: '14px' },
      onclick: () => {
        const won = comp.won;
        advanceCampaign(s); app.save(); app.refreshChrome(); app.render();
        app.toast(won ? 'Advanced to the next challenge!' : 'New season — try again!', won ? 'good' : '');
      },
      text: comp.won ? (comp.index >= CAMPAIGN.length - 1 ? '🏆 New Season' : 'Advance to Next Stage →') : 'Start New Season →',
    }));
  } else if (comp && comp.type === 'league') {
    careerBox.append(el('button', { class: 'btn block', style: { marginTop: '14px' }, onclick: () => showTable(app, comp), text: 'View Full Table' }));
  }
  wrap.append(careerBox);

  // facilities
  wrap.append(el('div', { class: 'section-title', text: 'Facilities' }));
  const fgrid = el('div', { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' } });
  for (const key of Object.keys(FACILITIES)) fgrid.append(facilityCard(app, key));
  wrap.append(fgrid);

  // trophies
  wrap.append(el('div', { class: 'section-title', text: `Trophy Cabinet (${(c.trophies || []).length})` }));
  if (!(c.trophies || []).length) wrap.append(el('div', { class: 'center-note', text: 'No trophies yet. Win cups and the World Cup!' }));
  else wrap.append(el('div', { class: 'chip-row' }, c.trophies.map((t) => el('span', { class: 'chip', style: { borderColor: 'var(--gold)', color: 'var(--gold)' }, text: `🏆 ${t}` }))));

  return wrap;
}

function rec(label, val, color) {
  return el('div', { class: 'tile grow', style: { textAlign: 'center', padding: '12px' } }, [
    el('div', { style: { fontSize: '22px', fontWeight: '900', color }, text: val }),
    el('div', { style: { fontSize: '11px', color: 'var(--muted)', fontWeight: '700' }, text: label }),
  ]);
}

function stageIcon(comp) {
  if (!comp) return '⚽';
  if (comp.type === 'worldcup') return '🌍';
  if (comp.type === 'cup') return '🏆';
  return '📋';
}

function facilityCard(app, key) {
  const s = state();
  const def = FACILITIES[key];
  const lvl = facilityLevel(s, key);
  const maxed = lvl >= def.max;
  const cost = upgradeCost(key, lvl);
  const can = canUpgrade(s, key);
  return el('div', { class: 'tile' }, [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      el('div', { style: { fontSize: '22px' }, text: def.icon }),
      el('div', { style: { fontWeight: '800', fontSize: '14px', flex: '1' }, text: def.name }),
      el('div', { style: { fontSize: '12px', color: 'var(--accent)', fontWeight: '800' }, text: `Lv ${lvl}` }),
    ]),
    el('div', { style: { fontSize: '11px', color: 'var(--muted)', margin: '8px 0' }, text: def.desc }),
    el('button', {
      class: 'btn block ' + (can ? 'blue' : ''), disabled: !can || undefined,
      onclick: () => { const r = applyUpgrade(s, key); if (r.ok) { app.save(); app.refreshChrome(); app.render(); app.toast(`${def.name} upgraded to Lv ${r.level}`, 'good'); } else app.toast(r.reason, 'bad'); },
      text: maxed ? 'Max Level' : `Upgrade · 🪙 ${fmtCoins(cost)}`,
    }),
  ]);
}

function showTable(app, comp) {
  const rows = leagueStandings(comp);
  const table = el('table', { class: 'table' }, [
    el('thead', {}, [el('tr', {}, ['#', 'Team', 'P', 'W', 'D', 'L', 'GD', 'Pts'].map((h) => el('th', { text: h })))]),
    el('tbody', {}, rows.map((r, i) => el('tr', { class: (r.isPlayer ? 'me ' : '') + (i < comp.promote ? 'promo' : '') }, [
      el('td', { text: i + 1 }), el('td', { text: r.name }), el('td', { text: r.p }), el('td', { text: r.w }),
      el('td', { text: r.d }), el('td', { text: r.l }), el('td', { text: (r.gd > 0 ? '+' : '') + r.gd }), el('td', { text: r.pts }),
    ]))),
  ]);
  app.modal(el('div', {}, [el('h2', { text: comp.name }), el('div', { style: { overflowX: 'auto', marginTop: '12px' } }, [table]), el('button', { class: 'btn ghost block', style: { marginTop: '14px' }, onclick: () => app.closeModal(), text: 'Close' })]), { wide: true });
}
