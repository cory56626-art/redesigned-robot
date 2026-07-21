// Pack-opening sequence: stadium lights, per-card walkout reveal with flag/position/club,
// flashes for high rarities, then a summary. Tap to advance.
import { el } from '../core/util.js';
import { state, settings } from '../core/store.js';
import { nationByCode } from '../data/nations.js';
import { openPack, sellValue } from '../game/packs.js';
import { rarityFor } from '../data/rarities.js';
import { playerCard, rarityChip } from './components.js';
import { PLAYSTYLES } from '../data/playstyles.js';

export function runPackOpening(app, packId, pulledPlayers) {
  const s = state();
  const players = pulledPlayers || openPack(packId);
  // add to collection immediately + track stats
  for (const p of players) s.collection.push(p);
  s.stats.packsOpened = (s.stats.packsOpened || 0) + 1;
  s.stats.playersEarned = (s.stats.playersEarned || 0) + players.length;
  app.save();
  app.refreshChrome();

  const reduced = settings().reducedMotion;
  const stage = el('div', { class: 'pack-stage' });
  const lights = el('div', { class: 'pack-lights' });
  const counter = el('div', { class: 'pack-counter' });
  const center = el('div', { style: { position: 'relative', zIndex: '2', textAlign: 'center', width: '100%' } });
  const hint = el('div', { class: 'pack-hint', text: 'Tap to reveal' });
  stage.append(lights, counter, center, hint);
  document.body.appendChild(stage);

  let idx = -1;
  let phase = 'idle'; // idle | shown | summary

  const revealCard = (p) => {
    const tier = p.rarityTier;
    const nation = nationByCode(p.nationality);
    const rar = rarityFor(p.isGK, p.rarity);
    center.innerHTML = '';
    if (tier >= 3 && !reduced) flash();
    const walk = el('div', { class: reduced ? '' : 'walkout' }, [playerCard(p, {})]);
    center.append(
      el('div', { class: 'reveal-flags', style: { marginBottom: '10px' } }, [
        el('div', { style: { fontSize: '30px' }, text: nation.flag }),
        el('div', { class: 'lbl', text: `${nation.name} · ${p.primaryPosition}${p.isGK ? ' · GK' : ''}` }),
      ]),
      walk,
      el('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' } }, [
        rarityChip(p),
        el('div', { style: { fontSize: '12px', color: 'var(--muted)' }, text: `${PLAYSTYLES[p.playstyle]?.name || ''} · ${p.club}` }),
      ]),
    );
    hint.textContent = idx >= players.length - 1 ? 'Tap for summary' : 'Tap for next';
    phase = 'shown';
  };

  const advance = () => {
    if (phase === 'summary') return;
    idx++;
    if (idx >= players.length) return showSummary();
    counter.textContent = `${idx + 1} / ${players.length}`;
    revealCard(players[idx]);
  };

  const showSummary = () => {
    phase = 'summary';
    counter.textContent = '';
    hint.style.display = 'none';
    const best = [...players].sort((a, b) => b.ovr - a.ovr)[0];
    const totalValue = players.reduce((sum, p) => sum + sellValue(p), 0);
    center.innerHTML = '';
    center.append(
      el('div', { style: { fontSize: '20px', fontWeight: '900', marginBottom: '4px' }, text: 'Pack Opened!' }),
      el('div', { style: { fontSize: '13px', color: 'var(--muted)', marginBottom: '14px' }, text: `Best pull: ${best.name} (${best.ovr})` }),
      el('div', { class: 'card-grid', style: { maxWidth: '460px', margin: '0 auto', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' } },
        [...players].sort((a, b) => b.ovr - a.ovr).map((p) => playerCard(p, { size: 'small' }))),
      el('div', { style: { display: 'flex', gap: '10px', maxWidth: '460px', margin: '18px auto 0', padding: '0 12px' } }, [
        el('button', { class: 'btn primary grow', onclick: () => { close(); app.go('collection'); }, text: 'View in Club' }),
        el('button', { class: 'btn grow', onclick: () => { close(); app.go('shop'); }, text: 'Store' }),
      ]),
    );
  };

  const close = () => { stage.remove(); };
  stage.addEventListener('click', advance);
  // kick off first reveal shortly after appearing
  setTimeout(advance, reduced ? 0 : 350);
}

function flash() {
  const f = el('div', { class: 'flash' });
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 500);
}
