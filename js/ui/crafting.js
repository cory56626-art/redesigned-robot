// Summoner Realms — crafting UI.
//
// Two views over one catalogue: the compact list that lives in the bag, and an
// expanded browser with search, category filters and a detail pane.
//
// The organising idea is that nothing is hidden. The old panel only listed
// recipes whose station was within five tiles — 10 of 102 while standing in the
// open — and said nothing about the rest, so a player with no Forge in sight
// concluded the pickaxes had no recipe at all. Every row is listed now, and the
// ones you cannot make say why in one plain sentence.
import { catalogue, craft as doCraft, blockerText, stationLabel, nearbyStations } from '../systems/crafting.js?v=realms-qor-48';
import { item as getItem } from '../data/items.js?v=realms-qor-48';
import { Sprites } from '../art/sprites.js?v=realms-qor-48';

const $ = (id) => document.getElementById(id);

// Filter chips. `test` runs against the *output* item def. Weapons split by
// class because "weapons" is 30 recipes and the classes are how players
// actually think about them.
const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'melee', label: 'Melee', test: d => d.weaponClass === 'melee' },
  { key: 'ranged', label: 'Ranged', test: d => d.weaponClass === 'ranged' },
  { key: 'mage', label: 'Magic', test: d => d.weaponClass === 'mage' },
  { key: 'summon', label: 'Summoner', test: d => d.weaponClass === 'summon' || d.category === 'summonitem' },
  { key: 'armor', label: 'Armor', test: d => d.category === 'armor' },
  { key: 'accessory', label: 'Accessories', test: d => d.category === 'accessory' },
  { key: 'tool', label: 'Tools', test: d => d.category === 'tool' },
  { key: 'potion', label: 'Potions', test: d => d.category === 'potion' },
  { key: 'throwable', label: 'Throwables', test: d => d.category === 'throwable' },
  { key: 'ammo', label: 'Ammo', test: d => d.category === 'ammo' },
  { key: 'block', label: 'Blocks', test: d => d.category === 'block' || d.category === 'station' },
  { key: 'material', label: 'Materials', test: d => d.category === 'material' },
];

const RARITY = [
  { name: 'Common', color: '#c7cede' },
  { name: 'Uncommon', color: '#7ee08a' },
  { name: 'Rare', color: '#8ad9ff' },
  { name: 'Epic', color: '#c58bff' },
  { name: 'Legendary', color: '#ffcf6b' },
];
const CLASS_LABEL = { melee: 'Melee', ranged: 'Ranged', mage: 'Magic', summon: 'Summoner' };

// Matching is forgiving in the same way the command console's resolver is
// (commands.js): case and punctuation are ignored, so "aether altar",
// "AetherAltar" and "altar" all find the same thing.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class CraftingUI {
  constructor(game) {
    this.game = game;
    this.query = '';        // shared by both views — searching in one carries over
    this.filter = 'all';
    this.selectedId = null; // recipe id shown in the detail pane
    this._listSig = null;
    this._gridSig = null;
    this._bound = false;
  }

  // ---- lifecycle -----------------------------------------------------------

  bind() {
    if (this._bound) return;
    this._bound = true;

    const searchBtn = $('craftSearchBtn');
    if (searchBtn) searchBtn.onclick = () => this._toggleCompactSearch();
    const expandBtn = $('craftExpandBtn');
    if (expandBtn) expandBtn.onclick = () => this.open();
    const closeBtn = $('bigCraftClose');
    if (closeBtn) closeBtn.onclick = () => this.close();
    const clearBtn = $('bigCraftClear');
    if (clearBtn) clearBtn.onclick = () => { this._setQuery(''); $('bigCraftSearch').focus(); };

    for (const id of ['craftSearch', 'bigCraftSearch']) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('input', () => this._setQuery(el.value));
      el.addEventListener('keydown', (e) => {
        // Escape clears a query before it closes anything — losing a search you
        // are halfway through typing is the more annoying of the two outcomes.
        // With the field already empty it closes, so Escape never dead-ends on
        // a blur you cannot see.
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (el.value) { this._setQuery(''); return; }
        el.blur();
        if (this.isOpen()) this.close();
        else this._toggleCompactSearch();
      });
    }
    this._buildFilterChips();
  }

  isOpen() { return $('craftingDialog') && !$('craftingDialog').classList.contains('hidden'); }

  open() {
    if (!$('craftingDialog')) return;
    // The bag's tooltip is position:fixed at z-index 50 and would float over
    // the dialog, so retire it on the way in.
    this.game.ui.menus.hideTooltip();
    this.game.ui.menus.show('craftingDialog');
    this._gridSig = null;
    this.renderBig(true);
    // Autofocus on desktop only: on mobile it would throw up the soft keyboard
    // over the grid you just opened.
    const s = $('bigCraftSearch');
    if (s) { s.value = this.query; if (this.game.controlMode !== 'mobile') s.focus(); }
  }

  close() {
    if (!this.isOpen()) return;
    this.game.ui.menus.hide('craftingDialog');
    const s = $('bigCraftSearch');
    if (s) s.blur();
  }

  toggle() { this.isOpen() ? this.close() : this.open(); }

  // ---- shared state --------------------------------------------------------

  _setQuery(q) {
    this.query = q;
    for (const id of ['craftSearch', 'bigCraftSearch']) {
      const el = $(id);
      if (el && el.value !== q) el.value = q;
    }
    const clear = $('bigCraftClear');
    if (clear) clear.classList.toggle('hidden', !q);
    this.refresh();
  }

  _toggleCompactSearch() {
    const row = $('craftSearchRow');
    if (!row) return;
    const showing = row.classList.toggle('hidden');
    if (!showing) $('craftSearch').focus();
    else if (this.query) this._setQuery('');
  }

  _buildFilterChips() {
    const host = $('craftFilters');
    if (!host) return;
    host.innerHTML = '';
    for (const f of FILTERS) {
      const b = document.createElement('button');
      b.className = 'fchip' + (f.key === this.filter ? ' active' : '');
      b.textContent = f.label;
      b.dataset.key = f.key;
      b.onclick = () => {
        this.filter = f.key;
        host.querySelectorAll('.fchip').forEach(c => c.classList.toggle('active', c.dataset.key === f.key));
        this.refresh();
      };
      host.appendChild(b);
    }
  }

  // Force both views to repaint on the next tick. The renderers skip work when
  // nothing has changed, so state changes have to invalidate explicitly.
  refresh() { this._listSig = null; this._gridSig = null; this.render(); }

  // ---- data ----------------------------------------------------------------

  _entries() {
    const p = this.game.localPlayer;
    if (!p) return [];
    const f = FILTERS.find(x => x.key === this.filter) || FILTERS[0];
    const q = norm(this.query);
    const out = [];
    for (const e of catalogue(this.game, p)) {
      const def = getItem(e.recipe.out.item);
      if (!def) continue;
      if (!f.test(def)) continue;
      if (q && !this._matches(e, def, q)) continue;
      e.def = def;
      out.push(e);
    }
    // Ready first, then the ones you have the bench for, then everything else.
    // Within a group, recipe order — which is roughly progression order.
    const rank = { ready: 0, short: 1, away: 2 };
    out.sort((a, b) => rank[a.state] - rank[b.state]);
    return out;
  }

  // Name, description and ingredient names all match, so "cuprite" finds both
  // the bars and everything forged from them.
  _matches(entry, def, q) {
    if (norm(def.name).includes(q) || norm(def.id).includes(q)) return true;
    if (def.desc && norm(def.desc).includes(q)) return true;
    for (const ing of entry.ingredients) {
      const d = getItem(ing.item);
      if (d && norm(d.name).includes(q)) return true;
    }
    return false;
  }

  _stationHTML() {
    const p = this.game.localPlayer;
    if (!p) return '';
    const near = [...nearbyStations(this.game, p)].filter(Boolean).map(stationLabel);
    if (!near.length) return 'near: <b>nothing</b> — place a Crafting Bench to unlock more';
    return 'near: ' + near.map(n => `<b>${escapeHtml(n)}</b>`).join(', ');
  }

  // ---- render --------------------------------------------------------------

  render() {
    this.renderList();
    if (this.isOpen()) this.renderBig();
  }

  // Compact list, in the bag.
  renderList(force) {
    const list = $('craftList');
    if (!list || !this.game.localPlayer) return;
    const entries = this._entries();
    const sig = this.filter + '|' + this.query + '|' +
      entries.map(e => e.recipe.id + e.state + e.ingredients.map(i => i.have).join(',')).join('~');
    if (!force && sig === this._listSig) return;
    this._listSig = sig;

    const label = $('craftStationLabel');
    if (label) label.innerHTML = this._stationHTML();

    // Rebuilding blows away the scroll offset, and the panel repaints 2.5x a
    // second — without this the list jumps back to the top while you read it.
    const scroll = list.scrollTop;
    list.innerHTML = '';
    if (!entries.length) {
      list.innerHTML = `<div class="craft-empty">${this.query ? 'No recipe matches “' + escapeHtml(this.query) + '”.' : 'No recipes.'}</div>`;
      return;
    }
    // A rule before the out-of-reach block, so the greyed tail reads as a
    // separate section rather than as a list that runs out of steam.
    let ruled = false;
    for (const e of entries) {
      if (!ruled && e.state === 'away' && entries[0].state !== 'away') {
        const d = document.createElement('div');
        d.className = 'craft-divider';
        d.textContent = 'At other stations';
        list.appendChild(d);
        ruled = true;
      }
      list.appendChild(this._row(e));
    }
    list.scrollTop = scroll;
  }

  _row(e) {
    const div = document.createElement('div');
    const ready = e.state === 'ready';
    div.className = 'craft-item ' + e.state + (ready ? '' : ' disabled');
    const cv = document.createElement('canvas');
    cv.width = 34; cv.height = 34; cv.className = 'craft-icon';
    const icon = Sprites.getIcon(e.def);
    if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 34, 34);
    div.appendChild(cv);

    const info = document.createElement('div');
    info.className = 'craft-info';
    const count = e.recipe.out.count > 1 ? ' ×' + e.recipe.out.count : '';
    let second;
    if (ready) {
      second = `<div class="craft-cost">${e.ingredients.map(i =>
        `<span class="ok">${escapeHtml(getItem(i.item).name)} ${i.have}/${i.need}</span>`).join(', ')}</div>`;
    } else {
      second = `<div class="craft-block">${escapeHtml(blockerText(e))}</div>`;
    }
    info.innerHTML = `<div class="craft-name">${escapeHtml(e.def.name)}${count}</div>` + second;
    div.appendChild(info);

    if (ready) div.onclick = () => this._craft(e.recipe);
    else div.onclick = () => { this.selectedId = e.recipe.id; this.open(); };
    return div;
  }

  // Expanded browser.
  renderBig(force) {
    const grid = $('craftGrid');
    if (!grid || !this.game.localPlayer) return;
    const entries = this._entries();
    const sig = this.filter + '|' + this.query + '|' + this.selectedId + '|' +
      entries.map(e => e.recipe.id + e.state + e.ingredients.map(i => i.have).join(',')).join('~');
    if (!force && sig === this._gridSig) return;
    this._gridSig = sig;

    const label = $('bigStationLabel');
    if (label) label.innerHTML = this._stationHTML();

    // Keep a selection that is still on screen; otherwise fall back to the
    // first entry so the detail pane is never blank next to a full grid.
    if (!entries.some(e => e.recipe.id === this.selectedId)) {
      this.selectedId = entries.length ? entries[0].recipe.id : null;
    }

    const scroll = grid.scrollTop;
    grid.innerHTML = '';
    if (!entries.length) {
      grid.innerHTML = `<div class="craft-empty">${this.query ? 'No recipe matches “' + escapeHtml(this.query) + '”.' : 'Nothing in this category.'}</div>`;
    }
    for (const e of entries) grid.appendChild(this._cell(e));
    grid.scrollTop = scroll;

    this._renderDetail(entries.find(x => x.recipe.id === this.selectedId));
  }

  _cell(e) {
    const b = document.createElement('button');
    b.className = 'craft-cell ' + e.state + (e.recipe.id === this.selectedId ? ' selected' : '');
    b.type = 'button';
    b.title = e.def.name + (e.state === 'ready' ? '' : ' — ' + blockerText(e));
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', e.recipe.id === this.selectedId ? 'true' : 'false');
    const tier = Math.max(0, Math.min(RARITY.length - 1, e.def.tier || 0));
    if (tier > 0) b.style.borderColor = RARITY[tier].color + '66';

    const cv = document.createElement('canvas');
    cv.width = 40; cv.height = 40;
    const icon = Sprites.getIcon(e.def);
    if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 40, 40);
    b.appendChild(cv);

    if (e.recipe.out.count > 1) {
      const n = document.createElement('span');
      n.className = 'cell-count'; n.textContent = e.recipe.out.count;
      b.appendChild(n);
    }
    if (e.state !== 'ready') {
      const dot = document.createElement('span');
      dot.className = 'cell-dot';
      b.appendChild(dot);
    }
    b.onclick = () => { this.selectedId = e.recipe.id; this._gridSig = null; this.renderBig(true); };
    b.ondblclick = () => { if (e.state === 'ready') this._craft(e.recipe); };
    return b;
  }

  _renderDetail(e) {
    const host = $('craftDetail');
    if (!host) return;
    if (!e) { host.innerHTML = '<div class="craft-empty">Pick a recipe.</div>'; return; }
    const def = e.def;
    const tier = Math.max(0, Math.min(RARITY.length - 1, def.tier || 0));
    const r = RARITY[tier];
    const kind = def.weaponClass ? CLASS_LABEL[def.weaponClass] + ' weapon' : def.category;

    const parts = [];
    parts.push(`<div class="cd-name" style="color:${r.color}">${escapeHtml(def.name)}${e.recipe.out.count > 1 ? ' ×' + e.recipe.out.count : ''}</div>`);
    parts.push(`<div class="cd-tag">${escapeHtml(r.name)} · ${escapeHtml(kind)}</div>`);

    const stats = this._stats(def);
    if (stats.length) parts.push(stats.map(s => `<div class="cd-stat">${s}</div>`).join(''));
    // Many descriptions are auto-generated from the same numbers as the stat
    // line ("Cuprite Sword — 13 melee damage", "1 defense"), so printing both
    // says everything twice. Drop the description when it adds nothing.
    if (def.desc && !this._redundant(def.desc, def.name, stats)) {
      parts.push(`<div class="cd-desc">${escapeHtml(def.desc)}</div>`);
    }

    parts.push('<div class="cd-rule"></div>');
    for (const ing of e.ingredients) {
      const d = getItem(ing.item);
      const ok = ing.have >= ing.need;
      parts.push(`<div class="cd-ing ${ok ? 'ok' : 'no'}" data-item="${escapeHtml(ing.item)}">` +
        `<canvas width="20" height="20"></canvas>${escapeHtml(d ? d.name : ing.item)}` +
        `<span class="cd-have">${ing.have}/${ing.need}</span></div>`);
    }
    parts.push(`<div class="cd-station">Made ${e.station ? 'at the ' + escapeHtml(stationLabel(e.station)) : 'by hand'}</div>`);

    if (e.state === 'ready') {
      parts.push('<button class="btn primary" id="cdCraft">Craft</button>');
    } else {
      parts.push(`<div class="cd-block ${e.state}">${escapeHtml(blockerText(e))}</div>`);
      parts.push('<button class="btn" disabled>Craft</button>');
    }
    host.innerHTML = parts.join('');

    // Ingredient icons, painted after the HTML lands.
    host.querySelectorAll('.cd-ing').forEach(row => {
      const d = getItem(row.dataset.item);
      const icon = d && Sprites.getIcon(d);
      const cv = row.querySelector('canvas');
      if (icon && cv) cv.getContext('2d').drawImage(icon, 0, 0, 20, 20);
    });
    const btn = $('cdCraft');
    if (btn) btn.onclick = () => this._craft(e.recipe);
  }

  // A couple of headline numbers, so the detail pane says something useful
  // about what you are about to make rather than only what it costs.
  _stats(def) {
    const out = [];
    if (def.damage) out.push(`<b>${def.damage}</b> damage`);
    if (def.manaCost) out.push(`<b>${def.manaCost}</b> aether`);
    if (def.defense) out.push(`<b>${def.defense}</b> defense`);
    if (def.tool) out.push(`Power <b>${def.tool.power}</b>`);
    if (def.heal) out.push(`Restores <b>${def.heal}</b> health`);
    if (def.ammo) out.push(`Uses ${escapeHtml(getItem(def.ammo)?.name || def.ammo)}`);
    return out;
  }

  // True when the description only repeats the name or the stats above it.
  _redundant(desc, name, stats) {
    const d = norm(desc);
    if (d.startsWith(norm(name))) return true;
    const s = norm(stats.join(' ').replace(/<[^>]+>/g, ' '));
    return !!d && !!s && (s.includes(d) || d.includes(s));
  }

  _craft(recipe) {
    const p = this.game.localPlayer;
    if (!p) return;
    if (!doCraft(this.game, p, recipe)) return;
    p.recomputeStats();
    this.game.ui.menus.renderInventory();
    this.refresh();
  }
}
