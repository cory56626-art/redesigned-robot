// Transfer / pack store: buy packs, claim the daily free pack.
import { el, fmtCoins } from '../core/util.js';
import { state } from '../core/store.js';
import { PACK_LIST } from '../game/packs.js';
import { spend, addCoins } from '../game/economy.js';
import { runPackOpening } from './pack-open.js';

const PACK_GRAD = {
  bronze: ['#a86a34', '#5c3611'], silver: ['#8f9bb3', '#4a5470'], gold: ['#e8b743', '#7a5410'],
  premium: ['#7b3fe4', '#2a1258'], legendary: ['#e88b3a', '#7a3a10'], mythic: ['#e0344d', '#5c0f1c'],
  icon: ['#f5c542', '#141414'],
};
const DAILY_MS = 20 * 60 * 60 * 1000;

export function renderShop(app) {
  const s = state();
  const wrap = el('div', { class: 'screen-inner' });
  wrap.append(el('h1', { text: 'Transfer Store' }), el('div', { class: 'sub', text: 'Open packs to collect footballers and build your dream squad.' }));

  // Daily reward
  const canClaim = Date.now() - (s.lastDaily || 0) > DAILY_MS;
  const daily = el('div', { class: 'panel', style: { padding: '16px', display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' } }, [
    el('div', { style: { fontSize: '34px' }, text: '🎁' }),
    el('div', { style: { flex: '1' } }, [
      el('div', { style: { fontWeight: '900', fontSize: '15px' }, text: 'Daily Free Pack' }),
      el('div', { style: { fontSize: '12px', color: 'var(--muted)' }, text: canClaim ? 'A free pack is waiting — come back every day!' : 'Come back tomorrow for another free pack.' }),
    ]),
    el('button', {
      class: 'btn ' + (canClaim ? 'primary' : ''), disabled: !canClaim || undefined,
      onclick: () => { s.lastDaily = Date.now(); addCoins(s, 500); app.save(); app.refreshChrome(); runPackOpening(app, 'silver'); },
      text: canClaim ? 'Claim' : 'Claimed',
    }),
  ]);
  wrap.append(daily);

  wrap.append(el('div', { class: 'section-title', text: 'Packs' }));
  const grid = el('div', { class: 'card-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' } });
  for (const p of PACK_LIST) {
    const grad = PACK_GRAD[p.id] || ['#555', '#222'];
    const afford = s.club.coins >= p.price;
    grid.append(el('div', { class: 'shop-pack', style: { background: `linear-gradient(160deg, ${grad[0]}, ${grad[1]})` } }, [
      el('div', { class: 'pk-ico', text: p.icon }),
      el('div', { class: 'pk-name', text: p.name }),
      el('div', { class: 'pk-desc', text: p.desc }),
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' } }, [
        el('div', { style: { fontWeight: '900', fontSize: '15px' }, text: '🪙 ' + fmtCoins(p.price) }),
        el('div', { style: { fontSize: '11px', opacity: '.85' }, text: `${p.count} players` }),
      ]),
      el('button', {
        class: 'btn pk-buy block ' + (afford ? 'gold' : ''), disabled: !afford || undefined,
        onclick: () => buy(app, p),
        text: afford ? 'Open Pack' : 'Not enough coins',
      }),
    ]));
  }
  wrap.append(grid);

  // earn coins hint
  wrap.append(el('div', { class: 'center-note', style: { paddingTop: '20px' }, text: 'Win matches and trophies to earn more coins.' }));
  return wrap;
}

function buy(app, p) {
  const s = state();
  if (!spend(s, p.price)) return app.toast('Not enough coins', 'bad');
  app.save(); app.refreshChrome();
  runPackOpening(app, p.id);
}
