// Application shell: top bar, bottom navigation, screen routing, modals and toasts.
import { el, $, fmtCoins } from '../core/util.js';
import { state, save as persist, settings } from '../core/store.js';
import { xpForLevel } from '../game/economy.js';

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
      el('div', { class: 'pill coins' }, [el('span', { class: 'ico', text: '🪙' }), el('span', { text: fmtCoins(c.coins) })]),
    );
    // nav active
    $$('button', this.navEl).forEach((b) => b.classList.toggle('active', b.dataset.id === this.current));
  }

  go(name, params = {}) {
    if (!SCREENS[name]) name = 'menu';
    this.current = name;
    this.params = params;
    this.render();
    this.refreshChrome();
    this.screenEl.scrollTop = 0;
  }

  render() {
    this.screenEl.innerHTML = '';
    const node = SCREENS[this.current](this, this.params);
    this.screenEl.appendChild(node);
  }

  save() {
    persist();
  }

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

  playMatch(opts) {
    launchMatchFlow(this, opts);
  }
}

// small helper (avoid importing $$ from util into every screen)
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

export const app = new App();
