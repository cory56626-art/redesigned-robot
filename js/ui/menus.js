// Summoner Realms — menu & overlay controller (main menu, dialogs, inventory,
// crafting, multiplayer sidebar, chat, confirm, death screen).
import { HOTBAR_SIZE } from '../config.js';
import { INV_SIZE } from '../systems/inventory.js';
import { Sprites } from '../art/sprites.js';
import { item as getItem } from '../data/items.js';
import { availableRecipes } from '../systems/crafting.js';

const $ = (id) => document.getElementById(id);

export class Menus {
  constructor(game) {
    this.game = game;
    this.invOpen = false;
    this._invTimer = 0;
    this._wire();
  }

  _wire() {
    const g = this.game;
    // ---- Main menu ----
    $('btnNewWorld').onclick = () => this.show('newWorldDialog');
    $('btnLoadWorld').onclick = () => this.openLoadDialog();
    $('btnMultiplayer').onclick = () => this.show('mpMenu');
    $('btnHowto').onclick = () => this.showHowTo();
    $('controlModeSeg').querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => g.setControlMode(b.dataset.mode);
    });
    $('playerNameInput').value = g.playerName;
    $('playerNameInput').oninput = (e) => { g.playerName = e.target.value.trim() || 'Summoner'; g.saveSettings(); };
    $('playerColorSwatch').style.background = g.playerColor;
    $('playerColorSwatch').onclick = () => { g.cyclePlayerColor(); $('playerColorSwatch').style.background = g.playerColor; };

    // ---- New world dialog ----
    $('newWorldCancel').onclick = () => this.hide('newWorldDialog');
    $('newWorldCreate').onclick = () => {
      const name = $('newWorldName').value.trim() || 'Realm';
      const seed = $('newWorldSeed').value.trim();
      this.hide('newWorldDialog');
      g.startNewWorld(name, seed);
    };

    // ---- Load world dialog ----
    $('loadWorldClose').onclick = () => this.hide('loadWorldDialog');

    // ---- Multiplayer menu ----
    $('btnCreateServer').onclick = () => g.createServer();
    $('btnJoinServer').onclick = () => { const code = $('joinCodeInput').value.trim().toUpperCase(); if (code) g.joinRoom(code); };
    $('mpClose').onclick = () => this.hide('mpMenu');

    // ---- Pause menu ----
    $('btnResume').onclick = () => g.setPaused(false);
    $('btnSaveGame').onclick = () => { g.saveGame(true); };
    $('btnDemoCommands').onclick = () => g.openCommandPanel();
    $('btnResetWorld').onclick = () => this.confirm('Reset World?', 'This regenerates the world from its seed and clears your placed/mined blocks. Your inventory is kept.', () => g.resetWorld());
    $('btnLeaveServer').onclick = () => g.leaveServer();
    $('btnQuitMenu').onclick = () => this.confirm('Quit to Menu?', 'The game will autosave first.', () => g.quitToMenu());

    // ---- Inventory ----
    $('invGrid').addEventListener('pointerdown', (e) => this._slotClick(e, 'inv'));
    $('equipGrid').addEventListener('pointerdown', (e) => this._slotClick(e, 'equip'));
    $('invGrid').addEventListener('contextmenu', (e) => e.preventDefault());
    $('equipGrid').addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- MP sidebar ----
    $('mpCopyLink').onclick = () => g.copyInviteLink();
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) g.sendChat(v); e.target.value = ''; e.target.blur(); }
      else if (e.key === 'Escape') e.target.blur();
    });

    // ---- Confirm ----
    $('confirmNo').onclick = () => this.hide('confirmDialog');

    // ---- How to ----
    $('howtoClose').onclick = () => this.hide('howtoDialog');

    // ---- Death ----
    $('btnRespawn').onclick = () => g.respawnLocal();

    // ---- Command panel close handled in commands.js ----
  }

  // ---- Generic overlay show/hide ----
  show(id) { $(id).classList.remove('hidden'); this.game.onMenuOpened(); }
  hide(id) { $(id).classList.add('hidden'); }
  isOpen(id) { return !$(id).classList.contains('hidden'); }

  anyModalOpen() {
    return ['mainMenu', 'pauseMenu', 'inventoryScreen', 'newWorldDialog', 'loadWorldDialog', 'mpMenu', 'commandPanel', 'howtoDialog', 'confirmDialog', 'deathScreen']
      .some(id => this.isOpen(id));
  }

  confirm(title, msg, onYes) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = msg;
    this.show('confirmDialog');
    $('confirmYes').onclick = () => { this.hide('confirmDialog'); onYes(); };
  }

  // ---- Main menu / pause visibility ----
  showMainMenu() { this.show('mainMenu'); }
  hideMainMenu() { this.hide('mainMenu'); }
  showPause() { this.show('pauseMenu'); $('btnLeaveServer').style.display = this.game.net ? '' : 'none'; this._updatePauseSaveState(); }
  hidePause() { this.hide('pauseMenu'); }
  _updatePauseSaveState() { $('pauseSaveState').textContent = this.game.saveStateText(); }

  // ---- Death ----
  showDeath(msg) { $('deathMessage').textContent = msg || 'The realm claims another summoner…'; this.show('deathScreen'); }
  hideDeath() { this.hide('deathScreen'); }

  // ---- Load dialog ----
  openLoadDialog() {
    const list = $('saveList');
    list.innerHTML = '';
    const saves = this.game.saves.list();
    if (!saves.length) { list.innerHTML = '<div class="empty-note">No saved worlds yet. Start a New World!</div>'; }
    for (const s of saves) {
      const div = document.createElement('div');
      div.className = 'save-item';
      const date = new Date(s.updated).toLocaleString();
      div.innerHTML = `<div class="save-info"><div class="save-name">${escapeHtml(s.name)}</div><div class="save-meta">Seed ${s.seed} · ${date}</div></div>`;
      const load = document.createElement('button'); load.className = 'btn small'; load.textContent = 'Load';
      load.onclick = () => { this.hide('loadWorldDialog'); this.game.loadWorldSlot(s.id); };
      const del = document.createElement('button'); del.className = 'btn small danger'; del.textContent = 'Delete';
      del.onclick = () => this.confirm('Delete Save?', `Permanently delete "${s.name}"? This cannot be undone.`, () => { this.game.deleteSave(s.id); this.openLoadDialog(); });
      div.appendChild(load); div.appendChild(del);
      list.appendChild(div);
    }
    this.show('loadWorldDialog');
  }

  // ---- How to ----
  showHowTo() {
    $('howtoBody').innerHTML = `
      <h4>Goal</h4>
      <ul><li>Gather materials, craft gear, and defeat the three bosses in order: <b>Grovekeeper → Gravemaw → Blight Sovereign</b>.</li></ul>
      <h4>PC Controls</h4>
      <ul>
        <li><kbd>A</kbd>/<kbd>D</kbd> or arrows — move · <kbd>W</kbd>/<kbd>Space</kbd> — jump (double-jump with Cloudstep Charm)</li>
        <li><b>Left-click</b> — use item (attack / cast / summon / place / mine with a pickaxe)</li>
        <li><b>Right-click</b> — mine the targeted tile with your best pickaxe</li>
        <li><kbd>1</kbd>–<kbd>0</kbd> / scroll — select hotbar · <kbd>E</kbd> — inventory & crafting · <kbd>Q</kbd> — use potion</li>
        <li><kbd>Esc</kbd> — pause · <kbd>Enter</kbd> — chat (multiplayer)</li>
      </ul>
      <h4>Mobile Controls</h4>
      <ul><li>Left stick moves, right stick aims. Buttons: Jump, Use, Mine, Place, Bag, Item.</li></ul>
      <h4>Tips</h4>
      <ul>
        <li>Place a <b>Crafting Bench</b> (in your bag) to unlock recipes. Build a Smeltery, Forge and Aether Altar as you progress.</li>
        <li>Craft a <b>Verdant Effigy</b> and use it in the Forest to summon the first boss.</li>
        <li>Stuck? Open the pause menu → <b>Demo Commands</b> for testing tools like <code>/giveall</code>.</li>
      </ul>`;
    this.show('howtoDialog');
  }

  // ---- Inventory / crafting ----
  openInventory() {
    if (this.game.state !== 'playing') return;
    this.invOpen = true;
    $('inventoryScreen').classList.remove('hidden');
    this.renderInventory();
    this.game.onMenuOpened();
  }
  closeInventory() { this.invOpen = false; $('inventoryScreen').classList.add('hidden'); $('itemTooltip').classList.add('hidden'); }
  toggleInventory() { this.invOpen ? this.closeInventory() : this.openInventory(); }

  tick(dt) {
    if (this.invOpen) {
      this._invTimer -= dt;
      if (this._invTimer <= 0) { this._invTimer = 0.25; this.renderInventory(); }
    }
  }

  renderInventory() {
    const p = this.game.localPlayer;
    if (!p) return;
    // Equipment
    const eg = $('equipGrid');
    eg.innerHTML = '';
    const equipDefs = [
      { kind: 'head', label: 'Head' }, { kind: 'chest', label: 'Chest' }, { kind: 'legs', label: 'Legs' },
      { kind: 'acc0', label: 'Acc' }, { kind: 'acc1', label: 'Acc' }, { kind: 'acc2', label: 'Acc' },
    ];
    for (const ed of equipDefs) {
      let ref;
      if (ed.kind.startsWith('acc')) ref = p.inventory.equip.acc[+ed.kind.slice(3)];
      else ref = p.inventory.equip[ed.kind];
      eg.appendChild(this._slotEl(ref, 'equip', ed.kind, ed.label));
    }
    // Inventory grid
    const ig = $('invGrid');
    ig.innerHTML = '';
    for (let i = 0; i < INV_SIZE; i++) ig.appendChild(this._slotEl(p.inventory.slots[i], 'inv', i));
    // Crafting
    this.renderCrafting();
  }

  _slotEl(ref, kind, index, label) {
    const d = document.createElement('div');
    d.className = 'inv-slot' + (kind === 'equip' ? ' equip' : '');
    d.dataset.kind = kind; d.dataset.index = index;
    if (ref) {
      const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
      const icon = Sprites.getIcon(getItem(ref.id));
      if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 24, 24);
      d.appendChild(cv);
      if (ref.count > 1) { const c = document.createElement('span'); c.className = 'slot-count'; c.textContent = ref.count; d.appendChild(c); }
      d.title = getItem(ref.id).name;
    } else if (kind === 'equip') {
      d.classList.add('empty'); d.dataset.label = label;
    }
    return d;
  }

  _slotClick(e, area) {
    const slot = e.target.closest('.inv-slot');
    if (!slot) return;
    e.preventDefault();
    const kind = slot.dataset.kind;
    const index = slot.dataset.index;
    const right = e.button === 2 || e.pointerType === 'touch' && this._longPress;
    if (kind === 'equip') {
      this.game.unequip(index);
    } else {
      if (e.button === 2) this.game.dropInventoryItem(+index);
      else this.game.useInventoryItem(+index);
    }
    this.renderInventory();
  }

  renderCrafting() {
    const p = this.game.localPlayer;
    const list = $('craftList');
    list.innerHTML = '';
    const recs = availableRecipes(this.game, p);
    const stations = [...new Set(recs.map(r => r.recipe.station))];
    $('craftStationLabel').textContent = `(near: ${stations.filter(Boolean).join(', ') || 'hand only — place a Crafting Bench'})`;
    // sort craftable first
    recs.sort((a, b) => (b.craftable - a.craftable));
    for (const r of recs) {
      const rec = r.recipe;
      const out = getItem(rec.out.item);
      const div = document.createElement('div');
      div.className = 'craft-item' + (r.craftable ? '' : ' disabled');
      const cv = document.createElement('canvas'); cv.width = 34; cv.height = 34; cv.className = 'craft-icon';
      const icon = Sprites.getIcon(out); if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 34, 34);
      div.appendChild(cv);
      const info = document.createElement('div'); info.className = 'craft-info';
      const cost = rec.in.map(ing => {
        const have = p.inventory.count(ing.item);
        const cls = have >= ing.count ? 'ok' : 'no';
        return `<span class="${cls}">${getItem(ing.item).name} ${have}/${ing.count}</span>`;
      }).join(', ');
      info.innerHTML = `<div class="craft-name">${out.name}${rec.out.count > 1 ? ' ×' + rec.out.count : ''} <span class="hint small">[${rec.station || 'hand'}]</span></div><div class="craft-cost">${cost}</div>`;
      div.appendChild(info);
      if (r.craftable) div.onclick = () => { this.game.craftRecipe(rec); this.renderInventory(); };
      list.appendChild(div);
    }
    if (!recs.length) list.innerHTML = '<div class="empty-note">Place & stand near a Crafting Bench to see recipes.</div>';
  }

  // ---- Multiplayer sidebar ----
  showMpSidebar() { $('mpSidebar').classList.remove('hidden'); }
  hideMpSidebar() { $('mpSidebar').classList.add('hidden'); }
  setRoomLabel(code) { $('mpRoomLabel').textContent = 'Room: ' + (code || '—'); }

  refreshPlayerList() {
    const ul = $('playerList');
    ul.innerHTML = '';
    for (const p of this.game.players.values()) {
      const li = document.createElement('li');
      const isHost = this.game.net && p.id === this.game.net.hostId;
      li.innerHTML = `<span class="pdot" style="background:${p.color}"></span>${escapeHtml(p.name)}${p.isLocal ? ' <span class="hint small">(you)</span>' : ''}${isHost ? ' <span class="phost">HOST</span>' : ''}`;
      ul.appendChild(li);
    }
  }

  addChat(name, color, text, system) {
    const log = $('chatLog');
    const d = document.createElement('div');
    d.className = 'cmsg' + (system ? ' system' : '');
    if (system) d.textContent = text;
    else d.innerHTML = `<span class="cname" style="color:${color}">${escapeHtml(name)}:</span> ${escapeHtml(text)}`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > 80) log.removeChild(log.firstChild);
  }

  setMpStatus(msg) { $('mpStatus').textContent = msg || ''; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
