// Application shell: top bar, bottom navigation, screen routing, modals and toasts.
import { el, $$, fmtCoins } from '../core/util.js';
import { state, save as persist, settings } from '../core/store.js';
import { xpForLevel, addCoins } from '../game/economy.js';
import { generatePlayer } from '../game/player-gen.js';
import { RNG } from '../core/rng.js';
import { autoFill } from '../game/squad.js';
import { GK_RARITIES, OUTFIELD_RARITIES, SPECIAL_CARDS, TIER_TO_GK, TIER_TO_OUTFIELD } from '../data/rarities.js';

import { renderMenu } from './screen-menu.js?build=d9e11ec11';
import { renderSquad } from './screen-squad.js';
import { renderFormation } from './screen-formation.js';
import { renderCollection } from './screen-collection.js';
import { renderShop } from './screen-shop.js';
import { renderClub } from './screen-club.js';
import { renderStats } from './screen-stats.js';
import { renderSettings } from './screen-settings.js';
import { launchMatchFlow } from './screen-match.js?build=d9e11ec11';
import { startStage, CAMPAIGN } from '../game/progression-wc.js';

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
      el('button', {
        class: 'btn ghost',
        title: 'Card test commands',
        style: { padding: '8px 10px', fontSize: '12px', whiteSpace: 'nowrap' },
        onclick: () => this.openCardTools(),
      }, [el('span', { text: '🃏 Cards' })]),
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

  openCardTools() {
    openCardTools(this);
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

function openCardTools(app) {
  const unlock = el('div', {}, [
    el('h2', { text: 'Card Test Commands' }),
    el('p', { style: { color: 'var(--muted)', fontSize: '14px' }, text: 'Enter the test code to unlock player commands.' }),
  ]);
  const code = el('input', {
    type: 'password',
    inputmode: 'numeric',
    placeholder: 'Test code',
    style: { width: '100%', padding: '12px', marginTop: '10px', background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '10px' },
  });
  const error = el('div', { style: { color: 'var(--danger)', fontSize: '12px', minHeight: '18px', marginTop: '6px' } });
  const enter = () => {
    if (code.value.trim() === '4062') showCardCommands(app);
    else error.textContent = 'Wrong code.';
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
  unlock.append(
    code,
    error,
    el('div', { class: 'row', style: { marginTop: '10px' } }, [
      el('button', { class: 'btn ghost grow', onclick: () => app.closeModal(), text: 'Cancel' }),
      el('button', { class: 'btn primary grow', onclick: enter, text: 'Unlock' }),
    ]),
  );
  app.modal(unlock);
  code.focus();
}

function showCardCommands(app) {
  const position = el('select', { class: 'input', style: fieldStyle() }, [
    option('', 'Random position'),
    option('GK', 'Goalkeeper'),
    option('CB', 'Centre back'),
    option('LB', 'Left back'),
    option('RB', 'Right back'),
    option('CM', 'Centre midfield'),
    option('CAM', 'Attacking midfield'),
    option('LW', 'Left wing'),
    option('RW', 'Right wing'),
    option('ST', 'Striker'),
  ]);
  const tier = el('select', { class: 'input', style: fieldStyle() });
  const special = el('select', { class: 'input', style: fieldStyle() }, [
    option('', 'Base card — no secondary type'),
    ...Object.values(SPECIAL_CARDS).map((card) => option(card.id, card.name + ' (+' + card.boost + ' OVR)')),
  ]);
  const count = el('input', { type: 'number', min: '1', max: '25', value: '1', style: fieldStyle() });

  const refreshTierOptions = () => {
    const isGK = position.value === 'GK';
    const ids = isGK ? TIER_TO_GK : TIER_TO_OUTFIELD;
    const defs = isGK ? GK_RARITIES : OUTFIELD_RARITIES;
    const previous = tier.value;
    tier.innerHTML = '';
    ids.forEach((id, index) => tier.append(option(String(index), defs[id].name + ' (' + index + ')')));
    tier.value = ids[Number(previous)] ? previous : '0';
  };
  position.addEventListener('change', refreshTierOptions);
  refreshTierOptions();

  const addPlayers = (players, message) => {
    const s = state();
    s.collection.push(...players);
    s.stats.playersEarned += players.length;
    app.save();
    app.refreshChrome();
    app.closeModal();
    app.toast(message, 'good');
    if (app.current === 'collection' || app.current === 'squad') app.render();
  };

  const selectedSettings = () => ({
    tier: Number(tier.value),
    special: special.value || undefined,
  });

  const content = el('div', {}, [
    el('h2', { text: 'Card Test Commands' }),
    el('p', {
      style: { color: 'var(--muted)', fontSize: '14px' },
      text: 'Choose the base tier, position, and secondary card type. These create real saved players.',
    }),
    el('label', { style: labelStyle(), text: 'Base tier' }), tier,
    el('label', { style: labelStyle(), text: 'Position' }), position,
    el('label', { style: labelStyle(), text: 'Secondary card type' }), special,
    el('label', { style: labelStyle(), text: 'How many' }), count,
    el('button', {
      class: 'btn primary block',
      style: { marginTop: '14px' },
      onclick: () => {
        const n = Math.max(1, Math.min(25, Number(count.value) || 1));
        const rng = new RNG(Date.now() ^ Math.floor(Math.random() * 1e9));
        const settings = selectedSettings();
        const generated = [];
        for (let i = 0; i < n; i++) {
          const pos = position.value;
          generated.push(generatePlayer({
            rng,
            tier: settings.tier,
            special: settings.special,
            isGK: pos === 'GK' ? true : pos ? false : undefined,
            positionHint: pos && pos !== 'GK' ? pos : undefined,
          }));
        }
        const tierLabel = tier.options[tier.selectedIndex]?.text || 'selected';
        const specialLabel = special.options[special.selectedIndex]?.text.split(' (+')[0] || 'Base card';
        addPlayers(generated, 'Added ' + generated.length + ' ' + specialLabel + ' ' + tierLabel.split(' (')[0] + ' card' + (generated.length === 1 ? '' : 's'));
      },
      text: 'Give Selected Card(s)',
    }),
    el('button', {
      class: 'btn primary block',
      style: { marginTop: '14px' },
      onclick: () => {
        const s = state();
        const positions = ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'];
        const rng = new RNG(Date.now() ^ Math.floor(Math.random() * 1e9));
        const absoluteBestTeam = positions.map((pos) => generatePlayer({
          rng,
          tier: 5,
          special: 'primeicon',
          isGK: pos === 'GK',
          positionHint: pos === 'GK' ? undefined : pos,
        }));
        s.collection.push(...absoluteBestTeam);
        s.stats.playersEarned += absoluteBestTeam.length;
        autoFill(s);
        app.save();
        app.refreshChrome();
        app.closeModal();
        app.toast('Added the absolute-best Prime Icon team and filled all 11 slots', 'good');
        if (app.current === 'collection' || app.current === 'squad') app.render();
      },
      text: 'Give Absolute Best Team',
    }),
    el('button', {
      class: 'btn blue block',
      style: { marginTop: '8px' },
      onclick: () => {
        const s = state();
        const settings = selectedSettings();
        const positions = ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'];
        const rng = new RNG(Date.now() ^ Math.floor(Math.random() * 1e9));
        const dreamTeam = positions.map((pos) => generatePlayer({
          rng,
          tier: settings.tier,
          special: settings.special,
          isGK: pos === 'GK',
          positionHint: pos === 'GK' ? undefined : pos,
        }));
        s.collection.push(...dreamTeam);
        s.stats.playersEarned += dreamTeam.length;
        autoFill(s);
        app.save();
        app.refreshChrome();
        app.closeModal();
        app.toast('Added a selected-tier Best XI and filled your squad', 'good');
        if (app.current === 'collection' || app.current === 'squad') app.render();
      },
      text: 'Give Selected Best XI',
    }),
    el('button', {
      class: 'btn ghost block',
      style: { marginTop: '8px' },
      onclick: () => {
        const s = state();
        const positions = ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'LW', 'RW', 'ST', 'ST'];
        const rng = new RNG(Date.now() ^ Math.floor(Math.random() * 1e9));
        const dreamTeam = positions.map((pos) => generatePlayer({
          rng,
          tier: 5,
          isGK: pos === 'GK',
          positionHint: pos === 'GK' ? undefined : pos,
        }));
        s.collection.push(...dreamTeam);
        s.stats.playersEarned += dreamTeam.length;
        autoFill(s);
        app.save();
        app.refreshChrome();
        app.closeModal();
        app.toast('Added a top-tier Best XI and filled your squad', 'good');
        if (app.current === 'collection' || app.current === 'squad') app.render();
      },
      text: 'Give Superhuman / Cat-Like Best XI',
    }),
    el('button', {
      class: 'btn gold block',
      style: { marginTop: '8px' },
      onclick: () => {
        const s = state();
        const worldCupIndex = CAMPAIGN.findIndex((stage) => stage.type === 'worldcup');
        startStage(s, worldCupIndex);
        app.save();
        app.closeModal();
        app.go('menu');
        app.toast('Jumped straight to the World Cup — press Play Match to start', 'good');
      },
      text: 'Go Straight to World Cup',
    }),
    el('button', { class: 'btn ghost block', style: { marginTop: '8px' }, onclick: () => app.closeModal(), text: 'Close' }),
  ]);
  app.modal(content, { wide: true });
}
function option(value, text) {
  return el('option', { value, text });
}

function fieldStyle() {
  return { width: '100%', padding: '10px 12px', margin: '4px 0 10px', background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: '10px' };
}

function labelStyle() {
  return { display: 'block', color: 'var(--muted)', fontSize: '12px', fontWeight: '800', marginTop: '8px' };
}

// small helper (avoid importing $ from util into every screen)
function $(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

export const app = new App();
