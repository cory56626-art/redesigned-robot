// Application shell: top bar, bottom navigation, screen routing, modals and toasts.
import { el, $, fmtCoins } from '../core/util.js';
import { state, save as persist, settings } from '../core/store.js';
import { xpForLevel } from '../game/economy.js';
import { addCoins } from '../game/economy.js';
import { generatePlayer } from '../game/player-gen.js';
import { RNG } from '../core/rng.js';

import { renderMenu } from './screen-menu.js';
import { renderSquad } from './screen-squad.js';
import { renderFormation } from './screen-formation.js';
import { renderCollection } from './screen-collection.js';
import { renderShop } from './screen-shop.js';
import { renderClub } from './screen-club.js';
import { renderStats } from './screen-stats.js';
import { renderSettings } from './screen-settings.js';
import { launchMatchFlow } from './screen-match.js';

const NAV = [
  { id: 'menu', ico: '🏠', label: 'Home' },
  { id: 'squad', ico: '👕', label: 'Squad' },
  { id: 'collection', ico: '🗂️', label: 'Club' },
  { id: 'shop', ico: '🛒', label: 'Store' },
  { id: 'club', ico: '🏟️', label: 'Manage' },
];

const SCREENS = {
  menu: renderMenu,
  squad: renderSquad,
  formation: renderFormation,
  collection: renderCollection,
  shop: renderShop,
  club: renderClub,
  stats: renderStats,
  settings: renderSettings,
};

class App {
  constructor() {
    this.current = 'menu';
    this.params = {};
    this.root = null;
  }

  mount(root) {
    this.root = root;
    root.innerHTML = '';
    this.topbarEl = el('div', { class: 'topbar' });
    this.screenEl = el('div', { class: 'screen' });
    this.navEl = el('div', { class: 'nav' });
    this.toastEl = el('div', { class: 'toasts' });
    root.append(this.topbarEl, this.screenEl, this.navEl, this.toastEl);
    this._buildNav();
    this.refreshChrome();
    this.go('menu');
  }

  _buildNav() {
    this.navEl.innerHTML = '';
    for (const n of NAV) {
      const b = el('button', { dataset: { id: n.id }, onclick: () => this.go(n.id) }, [
        el('span', { class: 'ico', text: n.ico }),
        el('span', { text: n.label }),
      ]);
      this.navEl.appendChild(b);
    }
  }

  refreshChrome() {
    const s = state();
    if (!s) return;
    const c = s.club;
    const xpNeed = xpForLevel(c.level);
    this.topbarEl.innerHTML = '';
    this.topbarEl.append(
      el('img', { class: 'badge', src: c.badge, alt: '' }),
      el('div', { class: 'club' }, [
        el('div', { class: 'name', text: c.name }),
        el('div', { class: 'lvl', text: `Lv ${c.level} · ${c.xp}/${xpNeed} XP` }),
      ]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'pill', title: 'Card menu', onclick: () => this.openCardMenu(), text: '🃏 Cards' }),
      el('div', { class: 'pill coins' }, [el('span', { class: 'ico', text: '🪙' }), el('span', { text: fmtCoins(c.coins) })]),
    );
    $$('button', this.navEl).forEach((b) => b.classList.toggle('active', b.dataset.id === this.current));
  }

  openCardMenu() {
    const content = el('div', {}, [
      el('h2', { text: 'Card Menu' }),
      el('p', { style: { color: 'var(--muted)', fontSize: '13px' }, text: 'Enter the test code to unlock card tools.' }),
    ]);
    const code = el('input', {
      type: 'password', inputMode: 'numeric', placeholder: 'Test code', maxLength: '4',
      style: { width: '100%', padding: '12px', marginTop: '10px', background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '10px', fontSize: '16px', letterSpacing: '.2em', textAlign: 'center' },
    });
    const unlock = el('button', { class: 'btn primary block', style: { marginTop: '10px' }, text: 'Unlock Test Commands' });
    const tools = el('div', { style: { display: 'none', marginTop: '14px' } });
    const error = el('div', { style: { color: 'var(--danger)', fontSize: '12px', marginTop: '8px', display: 'none' }, text: 'Incorrect code.' });
    unlock.onclick = () => {
      if (code.value !== '4062') { error.style.display = 'block'; return; }
      error.style.display = 'none';
      code.style.display = 'none'; unlock.style.display = 'none';
      tools.style.display = 'block';
      buildTestTools(tools);
    };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock.click(); });
    content.append(code, unlock, error, tools, el('button', { class: 'btn ghost block', style: { marginTop: '12px' }, onclick: () => this.closeModal(), text: 'Close' }));
    this.modal(content);
    setTimeout(() => code.focus(), 0);
  }

  save() { persist(); }

  toast(msg, kind = '') {
    const t = el('div', { class: 'toast ' + kind, text: msg });
    this.toastEl.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; }, 2100);
    setTimeout(() => t.remove(), 2450);
  }

  modal(contentNode, opts = {}) {
    this.closeModal();
    const inner = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, [contentNode]);
    const bg = el('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg && opts.dismissable !== false) this.closeModal(); } }, [inner]);
    document.body.appendChild(bg);
    this._modal = bg;
    return bg;
  }

  closeModal() {
    if (this._modal) { this._modal.remove(); this._modal = null; }
  }

  confirm(title, message, onYes, yesLabel = 'Confirm') {
    const node = el('div', {}, [
      el('h2', { text: title }),
      el('p', { style: { color: 'var(--muted)', fontSize: '14px', marginTop: '6px' }, text: message }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn ghost', onclick: () => this.closeModal(), text: 'Cancel' }),
        el('button', { class: 'btn primary', onclick: () => { this.closeModal(); onYes(); }, text: yesLabel }),
      ]),
    ]);
    this.modal(node);
  }

  playMatch(opts) { launchMatchFlow(this, opts); }
}

function buildTestTools(root) {
  const tier = el('select', { style: fieldStyle() }, [0, 1, 2, 3, 4, 5].map((n) => el('option', { value: n, text: `Tier ${n}` })));
  const position = el('select', { style: fieldStyle() }, [
    ['random', 'Random position'], ['GK', 'Goalkeeper'], ['ST', 'Striker'], ['CM', 'Midfielder'], ['CB', 'Defender'], ['W', 'Winger'],
  ].map(([value, text]) => el('option', { value, text })));
  const count = el('input', { type: 'number', min: '1', max: '50', value: '1', style: fieldStyle() });
  const add = (label, fn, cls = 'btn blue block') => root.append(el('button', { class: cls, style: { marginTop: '8px' }, onclick: fn, text: label }));
  root.append(
    el('div', { style: { fontWeight: '900', color: 'var(--accent)', marginBottom: '8px' }, text: 'Test commands unlocked' }),
    el('label', { style: labelStyle(), text: 'Card tier' }), tier,
    el('label', { style: labelStyle(), text: 'Position' }), position,
    el('label', { style: labelStyle(), text: 'Number of cards' }), count,
  );
  add('🃏 Give Me Card(s)', () => {
    const s = state(); const n = Math.max(1, Math.min(50, Number(count.value) || 1));
    const rng = new RNG(Date.now() ^ Math.random() * 1e9);
    for (let i = 0; i < n; i++) {
      const pos = position.value === 'random' ? undefined : position.value;
      s.collection.push(generatePlayer({ rng, tier: Number(tier.value), positionHint: pos, isGK: pos === 'GK' }));
    }
    s.stats.playersEarned += n; persist(true); thisRefresh();
  });
  add('🪙 Give Me 100,000 Coins', () => { addCoins(state(), 100000); persist(true); thisRefresh(); });
  add('⭐ Max Facilities', () => { const s = state(); for (const key of Object.keys(s.club.facilities)) s.club.facilities[key] = 10; persist(true); thisRefresh(); });
  add('✨ Fill Best XI', () => { const s = state(); const ids = s.collection.slice().sort((a, b) => b.ovr - a.ovr).map((p) => p.id); s.squad.starters = ids.slice(0, 11); s.squad.bench = ids.slice(11, 18); persist(true); thisRefresh(); });
  function thisRefresh() { app.closeModal(); app.refreshChrome(); app.render(); app.toast('Test command applied', 'good'); }
}

const labelStyle = () => ({ display: 'block', fontSize: '11px', color: 'var(--muted)', marginTop: '9px', marginBottom: '4px', fontWeight: '800' });
const fieldStyle = () => ({ width: '100%', padding: '10px', background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '9px', fontSize: '14px' });

function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
export const app = new App();
