// Summoner Realms — menu & overlay controller (main menu, dialogs, inventory,
// crafting, multiplayer sidebar, chat, confirm, death screen).
import { HOTBAR_SIZE, HEAL_COOLDOWN, MANA_POTION_COOLDOWN, difficultyForIndex, difficultyInfo } from '../config.js?v=realms-qor-41';
import { INV_SIZE, SET_BONUS_DESC, SET_LABEL } from '../systems/inventory.js?v=realms-qor-41';
import { Sprites } from '../art/sprites.js?v=realms-qor-41';
import { item as getItem } from '../data/items.js?v=realms-qor-41';
import { availableRecipes } from '../systems/crafting.js?v=realms-qor-41';
import { claudeNotesHTML } from './claude-notes.js?v=realms-qor-41';

// Rarity tiers → label + colour, so tooltips read clearly.
const RARITY = [
  { name: 'Common', color: '#c7cede' },
  { name: 'Uncommon', color: '#7ee08a' },
  { name: 'Rare', color: '#8ad9ff' },
  { name: 'Epic', color: '#c58bff' },
  { name: 'Legendary', color: '#ffcf6b' },
];
const CLASS_LABEL = { melee: 'Melee', ranged: 'Ranged', mage: 'Mage', summon: 'Summoner' };

// Equipment slots, in the order they appear in the grid.
const EQUIP_SLOTS = [
  { kind: 'head', label: 'Head' }, { kind: 'chest', label: 'Chest' }, { kind: 'legs', label: 'Legs' },
  { kind: 'acc0', label: 'Acc' }, { kind: 'acc1', label: 'Acc' }, { kind: 'acc2', label: 'Acc' },
];

const $ = (id) => document.getElementById(id);
const WORLD_DIFFICULTY_FILL = (key) => ({ normal: 0, hard: 1 / 3, master: 2 / 3, masochist: 1 }[key] ?? 0);


export class Menus {
  constructor(game) {
    this.game = game;
    this.invOpen = false;
    this._craftTimer = 0;
    this._slotsBuilt = false;
    this._craftSig = '';
    this._deathWasBossFight = false;
    this._wire();
  }

  _wire() {
    const g = this.game;
    // ---- Main menu ----
    $('btnContinue').onclick = () => g.continueGame();
    $('btnNewWorld').onclick = () => {
      $('newWorldDifficulty').value = '0';
      this._syncNewWorldDifficulty();
      this.show('newWorldDialog');
    };
    $('btnLoadWorld').onclick = () => this.openLoadDialog();
    $('btnMultiplayer').onclick = () => this.show('mpMenu');
    $('btnSettings').onclick = () => this.openSettings();
    $('btnHowto').onclick = () => this.showHowTo();
    $('btnClaudeNotes').onclick = () => this.showClaudeNotes();
    $('controlModeSeg').querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => g.setControlMode(b.dataset.mode);
    });
    $('playerNameInput').value = g.playerName;
    $('playerNameInput').oninput = (e) => { g.playerName = e.target.value.trim() || 'Summoner'; g.saveSettings(); };
    $('playerColorSwatch').style.background = g.playerColor;
    $('playerColorSwatch').onclick = () => { g.cyclePlayerColor(); $('playerColorSwatch').style.background = g.playerColor; };

    // ---- New world dialog ----
    $('newWorldDifficulty').addEventListener('input', () => this._syncNewWorldDifficulty());
    this._syncNewWorldDifficulty();
    $('newWorldCancel').onclick = () => this.hide('newWorldDialog');
    $('newWorldCreate').onclick = () => {
      const name = $('newWorldName').value.trim() || 'Realm';
      const seed = $('newWorldSeed').value.trim();
      const difficulty = difficultyForIndex($('newWorldDifficulty').value).key;
      this.hide('newWorldDialog');
      g.startNewWorld(name, seed, difficulty);
    };

    // ---- Load world dialog ----
    $('loadWorldClose').onclick = () => this.hide('loadWorldDialog');

    // ---- Multiplayer menu ----
    $('mpDifficulty').addEventListener('input', () => this._syncDifficultyPicker('mpDifficulty'));
    this._syncDifficultyPicker('mpDifficulty');
    // Only applies when hosting spins up a fresh world; an already-loaded world
    // keeps the difficulty it was created with.
    $('btnCreateServer').onclick = () => g.createServer(difficultyForIndex($('mpDifficulty').value).key);
    $('btnJoinServer').onclick = () => { const code = $('joinCodeInput').value.trim().toUpperCase(); if (code) g.joinRoom(code); };
    $('mpClose').onclick = () => this.hide('mpMenu');

    // ---- Pause menu ----
    $('btnResume').onclick = () => g.setPaused(false);
    $('btnSaveGame').onclick = () => { g.saveGame(true); };
    $('btnSettingsPause').onclick = () => this.openSettings();
    $('btnDemoCommands').onclick = () => g.openCommandPanel();
    $('btnClaudeNotesPause').onclick = () => this.showClaudeNotes();
    $('btnResetWorld').onclick = () => this.confirm('Reset World?', 'This regenerates the world from its seed and clears your placed/mined blocks. Your inventory is kept.', () => g.resetWorld());
    $('btnLeaveServer').onclick = () => g.leaveServer();
    $('btnQuitMenu').onclick = () => this.confirm('Quit to Menu?', 'The game will autosave first.', () => g.quitToMenu());

    // ---- Settings ----
    $('settingsClose').onclick = () => { this.hide('settingsDialog'); };
    for (const [segId, key] of [['smartCursorSeg', 'smartCursor'], ['screenShakeSeg', 'screenShake']]) {
      $(segId).querySelectorAll('.seg-btn').forEach(b => {
        b.onclick = () => {
          const v = key === 'screenShake' ? b.dataset.mode === 'on' : b.dataset.mode;
          g.setSetting(key, v);
          this._syncSettings();
        };
      });
    }
    $('settingsControlSeg').querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => { g.setControlMode(b.dataset.mode); this._syncSettings(); };
    });
    for (const [id, key] of [['setMaster', 'masterVolume'], ['setMusic', 'musicVolume'], ['setSfx', 'sfxVolume']]) {
      $(id).addEventListener('input', (e) => {
        g.setSetting(key, e.target.value / 100);
        this._syncSettings();
      });
    }

    // ---- Inventory ----
    $('invClose').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closeInventory();
    });
    // Slot actions fire on *release*, from the drag handler below — acting on
    // press would mean every drag also used or equipped the item first.
    this._wireDragAndDrop();
    $('invGrid').addEventListener('contextmenu', (e) => e.preventDefault());
    $('equipGrid').addEventListener('contextmenu', (e) => e.preventDefault());
    // Desktop hover tooltips (delegated so grid rebuilds don't drop handlers).
    for (const gid of ['invGrid', 'equipGrid']) {
      const grid = $(gid);
      grid.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch') return; this._hoverSlot(e); });
      grid.addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; this._moveTooltip(e.clientX, e.clientY); });
      grid.addEventListener('pointerout', (e) => { if (e.pointerType === 'touch') return; this._scheduleHideTooltip(); });
    }
    // Touch: tap outside a slot / tooltip closes an open (persistent) tooltip.
    document.addEventListener('pointerdown', (e) => {
      if (!this._ttOpen) return;
      if (e.target.closest('#itemTooltip') || e.target.closest('.inv-slot')) return;
      this.hideTooltip();
    }, true);

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

    // ---- Claude's Notes ----
    $('claudeNotesClose').onclick = () => this.hide('claudeNotesDialog');

    // ---- Death ----
    $('btnRespawn').onclick = () => g.respawnLocal();

    // ---- Always-visible HUD menu/pause button (works in PC & mobile) ----
    $('hudMenuBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); g.menuButton(); });

    // ---- Command panel close handled in commands.js ----
  }

  // ---- Generic overlay show/hide ----
  show(id) { $(id).classList.remove('hidden'); this.game.onMenuOpened(); }
  hide(id) { $(id).classList.add('hidden'); }
  // Shared by the New World dialog and the Multiplayer host panel, which use
  // the same markup under different id prefixes.
  _syncDifficultyPicker(id) {
    const info = difficultyForIndex($(id).value);
    $(id + 'Label').textContent = info.label;
    $(id + 'Tier').textContent = info.tier;
    $(id + 'Hint').textContent = info.hint;
    $(id).style.setProperty('--fill', (WORLD_DIFFICULTY_FILL(info.key) * 100) + '%');
    return info.key;
  }
  _syncNewWorldDifficulty() { return this._syncDifficultyPicker('newWorldDifficulty'); }

  isOpen(id) { return !$(id).classList.contains('hidden'); }

  anyModalOpen() {
    return ['mainMenu', 'pauseMenu', 'inventoryScreen', 'newWorldDialog', 'loadWorldDialog', 'mpMenu',
      'commandPanel', 'howtoDialog', 'claudeNotesDialog', 'confirmDialog', 'deathScreen', 'settingsDialog', 'npcDialog']
      .some(id => this.isOpen(id));
  }

  // Overlays that actually stop you playing. The inventory is deliberately not
  // one of them: in Terraria the world keeps running and you keep moving and
  // using items with your bag open, which is what this list encodes.
  anyBlockingModalOpen() {
    return ['mainMenu', 'pauseMenu', 'newWorldDialog', 'loadWorldDialog', 'mpMenu',
      'commandPanel', 'howtoDialog', 'claudeNotesDialog', 'confirmDialog', 'deathScreen', 'settingsDialog', 'npcDialog']
      .some(id => this.isOpen(id));
  }

  confirm(title, msg, onYes) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = msg;
    this.show('confirmDialog');
    $('confirmYes').onclick = () => { this.hide('confirmDialog'); onYes(); };
  }

  // ---- Main menu / pause visibility ----
  showMainMenu() { this.refreshContinue(); this.show('mainMenu'); }
  hideMainMenu() { this.hide('mainMenu'); }
  // Show "Continue" only when there's at least one save to resume.
  refreshContinue() {
    const btn = $('btnContinue');
    if (btn) btn.classList.toggle('hidden', this.game.saves.list().length === 0);
  }
  showPause() { this.show('pauseMenu'); $('btnLeaveServer').style.display = this.game.net ? '' : 'none'; this._updatePauseSaveState(); }
  hidePause() { this.hide('pauseMenu'); }
  _updatePauseSaveState() { $('pauseSaveState').textContent = this.game.saveStateText(); }

  // ---- Death ----
  showDeath(msg) {
    $('deathMessage').textContent = msg || 'The realm claims another summoner…';
    this.show('deathScreen');
    this._updateRespawnButton();
  }
  hideDeath() { this.hide('deathScreen'); }

  // The Respawn button stays disabled until the countdown ends. Dying while a
  // boss is up costs noticeably longer, so throwing yourself at an encounter is
  // never the cheap option.
  _updateRespawnButton() {
    const p = this.game.localPlayer;
    const btn = $('btnRespawn');
    const note = $('respawnNote');
    if (!p || !btn) return;
    const t = Math.max(0, p.respawnTimer || 0);
    if (t > 0) {
      btn.disabled = true;
      btn.textContent = `Respawn in ${Math.ceil(t)}s`;
      note.textContent = this._deathWasBossFight
        ? 'The encounter has ended — the boss must be summoned again.'
        : '';
    } else {
      btn.disabled = false;
      btn.textContent = 'Respawn';
      note.textContent = this._deathWasBossFight
        ? 'The encounter has ended — the boss must be summoned again.'
        : '';
    }
  }

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
      const diff = difficultyInfo(s.difficulty);
      div.innerHTML = `<div class="save-info"><div class="save-name">${escapeHtml(s.name)}</div><div class="save-meta">Seed ${s.seed} · ${diff.label} · ${date}</div></div>`;
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
        <li><b>Left-click</b> — use item (attack / cast / summon / throw / place / mine or chop with the held tool)</li>
        <li><b>Right-click</b> — dig/chop the targeted tile with the best tool for it (pickaxe for stone, axe for trees)</li>
        <li><kbd>1</kbd>–<kbd>0</kbd> / scroll — select hotbar · <kbd>E</kbd> — inventory &amp; crafting · <kbd>Q</kbd> — use potion</li>
        <li><kbd>F</kbd> — talk to the Guide · <kbd>Ctrl</kbd> — hold for <b>Smart Cursor</b> (or set it to Always in Settings)</li>
        <li><kbd>+</kbd> / <kbd>-</kbd> or <kbd>Ctrl</kbd>+scroll — <b>zoom</b> in and out</li>
        <li><kbd>Esc</kbd> — pause · <kbd>Enter</kbd> — chat (multiplayer)</li>
      </ul>
      <h4>Mobile Controls</h4>
      <ul>
        <li>Left stick moves, right stick aims. Buttons: Jump, Use, Mine, Place, Bag, Item.</li>
        <li><b>◎</b> toggles Smart Cursor, which picks the best tile for you — essential when aiming with a stick.</li>
        <li>Tap an item in your bag to inspect it, or drag it to another slot to rearrange.</li>
      </ul>
      <h4>Playing with the bag open</h4>
      <ul>
        <li>The world keeps running while your inventory is open, and you can still <b>move, jump and use items</b>. The panel sits in the corner rather than covering the screen.</li>
      </ul>
      <h4>Tips</h4>
      <ul>
        <li>You start with only a <b>pickaxe</b>, an <b>axe</b>, and a <b>sword</b>. Chop trees with the axe (they topple and drop wood — leaves only give twigs), mine stone &amp; ore with the pickaxe.</li>
        <li>Craft a <b>Crafting Bench</b> from wood, then build a Smeltery, Forge and Aether Altar as you progress.</li>
        <li><b>Bombs</b> are a mining tool as much as a weapon — they arc, bounce, and blow craters in dirt and stone. Stand clear: the blast hurts you too.</li>
        <li>Bows need <b>arrows</b>, magic drains <b>Aether</b>, and healing has a <b>cooldown</b> — watch the hotbar timers.</li>
        <li>Craft a <b>Verdant Effigy</b> and use it in the Forest to summon the first boss. Bosses <b>telegraph</b> every attack — watch for the charge-up.</li>
        <li>Dying during a boss fight ends the encounter and costs a longer respawn, so the boss has to be summoned again.</li>
        <li>Lost? Talk to <b>Vesper Thane</b>, the Guide who lives at your spawn. He'll explain any item you're carrying.</li>
        <li>Stuck? Open the pause menu → <b>Demo Commands</b> for testing tools like <code>/giveall</code> or <code>/debugai</code>.</li>
      </ul>`;
    this.show('howtoDialog');
  }

  // ---- Settings ----
  openSettings() { this._syncSettings(); this.show('settingsDialog'); }

  _syncSettings() {
    const g = this.game;
    const st = g.settings;
    const setSeg = (id, value) => {
      $(id).querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === value));
    };
    setSeg('smartCursorSeg', st.smartCursor);
    setSeg('screenShakeSeg', st.screenShake ? 'on' : 'off');
    setSeg('settingsControlSeg', g.controlMode);
    const slider = (id, outId, v) => {
      const el = $(id);
      el.value = Math.round(v * 100);
      // Paint the filled portion of the track.
      el.style.setProperty('--fill', el.value + '%');
      $(outId).textContent = el.value + '%';
    };
    slider('setMaster', 'setMasterOut', st.masterVolume);
    slider('setMusic', 'setMusicOut', st.musicVolume);
    slider('setSfx', 'setSfxOut', st.sfxVolume);
    const ms = $('musicStatus');
    if (ms) ms.textContent = g.audio && g.audio.music ? g.audio.music.statusText() : 'Music tracks live in assets/music/.';
  }

  // ---- Claude's Notes (dev annotations for the stress-test review) ----
  showClaudeNotes() {
    $('claudeNotesBody').innerHTML = claudeNotesHTML();
    this.show('claudeNotesDialog');
  }

  // ---- Inventory / crafting ----
  openInventory() {
    if (this.game.state !== 'playing') return;
    this.invOpen = true;
    $('inventoryScreen').classList.remove('hidden');
    this.renderInventory();
    this.game.onMenuOpened();
  }
  closeInventory() { this.invOpen = false; $('inventoryScreen').classList.add('hidden'); this.hideTooltip(); }
  toggleInventory() { this.invOpen ? this.closeInventory() : this.openInventory(); }

  tick(dt) {
    if (this.invOpen) {
      // Slots are diffed in place every frame — cheap, and it means counts and
      // the selected-slot highlight track the world in real time now that the
      // world keeps running while the bag is open.
      this._syncSlots();
      this._craftTimer -= dt;
      if (this._craftTimer <= 0) { this._craftTimer = 0.4; this.renderCrafting(); this._renderStats(this.game.localPlayer); }
    }
    if (this.isOpen('deathScreen')) this._updateRespawnButton();
  }

  // Build the slot DOM exactly once. It used to be torn down and rebuilt four
  // times a second along with the whole ~80-row crafting list, which is what
  // made the panel flicker, drop hover state, and feel janky.
  _buildSlots() {
    if (this._slotsBuilt) return;
    const eg = $('equipGrid');
    eg.innerHTML = '';
    for (const ed of EQUIP_SLOTS) eg.appendChild(this._slotEl('equip', ed.kind, ed.label));
    const ig = $('invGrid');
    ig.innerHTML = '';
    for (let i = 0; i < INV_SIZE; i++) ig.appendChild(this._slotEl('inv', i));
    this._slotsBuilt = true;
  }

  // Update the existing slot elements in place, redrawing an icon only when the
  // item in that slot actually changed.
  _syncSlots() {
    const p = this.game.localPlayer;
    if (!p) return;
    this._buildSlots();
    const inv = p.inventory;

    const paint = (el, ref) => {
      const id = ref ? ref.id : null;
      const count = ref ? ref.count : 0;
      if (el._itemId !== id) {
        el._itemId = id;
        const cv = el.querySelector('canvas');
        const ctx = cv.getContext('2d');
        ctx.clearRect(0, 0, cv.width, cv.height);
        if (ref) {
          const icon = Sprites.getIcon(getItem(ref.id));
          if (icon) ctx.drawImage(icon, 0, 0, cv.width, cv.height);
        }
        el.classList.toggle('empty', !ref);
      }
      if (el._count !== count) {
        el._count = count;
        el.querySelector('.slot-count').textContent = count > 1 ? count : '';
      }
    };

    const eg = $('equipGrid').children;
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const ed = EQUIP_SLOTS[i];
      const ref = ed.kind.startsWith('acc') ? inv.equip.acc[+ed.kind.slice(3)] : inv.equip[ed.kind];
      paint(eg[i], ref);
    }
    const ig = $('invGrid').children;
    for (let i = 0; i < INV_SIZE; i++) {
      const el = ig[i];
      paint(el, inv.slots[i]);
      if (i < HOTBAR_SIZE) el.classList.toggle('selected', i === inv.selected);
    }
  }

  renderInventory() {
    const p = this.game.localPlayer;
    if (!p) return;
    this._syncSlots();
    this._renderStats(p);
    this.renderCrafting();
  }

  _renderStats(p) {
    const st = p.stats || p.inventory.getStats();
    $('equipDefense').textContent = `· ${st.defense} defense`;
    const pct = (m) => (m >= 1 ? '+' : '') + Math.round((m - 1) * 100) + '%';
    const row = (k, v) => `<div class="ps-row"><span class="ps-k">${k}</span><span class="ps-v">${v}</span></div>`;
    const rows = ['<div class="ps-head">Character</div>'];
    rows.push(row('Total defense', st.defense));
    rows.push(row('Melee damage', pct(st.meleeMul)));
    rows.push(row('Ranged damage', pct(st.rangedMul)));
    rows.push(row('Magic damage', pct(st.mageMul)));
    rows.push(row('Summon damage', pct(st.summonMul)));
    rows.push(row('Minion capacity', st.minionCap));
    if (st.maxHpBonus) rows.push(row('Max health', '+' + st.maxHpBonus));
    if (st.maxManaBonus) rows.push(row('Max Aether', '+' + st.maxManaBonus));
    if (st.speedMul !== 1) rows.push(row('Move speed', pct(st.speedMul)));
    if (st.extraJumps) rows.push(row('Extra jumps', '+' + st.extraJumps));
    const sets = p.inventory.equippedSets();
    for (const k in sets) {
      const complete = sets[k] >= 3;
      rows.push(`<div class="ps-set">${SET_LABEL[k] || k} set ${sets[k]}/3${complete ? ' ✓ — ' + SET_BONUS_DESC[k] : ''}</div>`);
    }
    $('playerStats').innerHTML = rows.join('');
  }

  // An empty shell. Contents are filled in by _syncSlots, so this runs once per
  // slot for the lifetime of the page.
  _slotEl(kind, index, label) {
    const d = document.createElement('div');
    d.className = 'inv-slot empty' + (kind === 'equip' ? ' equip' : '');
    if (kind === 'inv' && index < HOTBAR_SIZE) d.classList.add('hotbar');
    d.dataset.kind = kind; d.dataset.index = index;
    if (label) d.dataset.label = label;
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    d.appendChild(cv);
    // The first row is the hotbar, so it carries the same select keys the HUD
    // shows — the connection between bag row one and the hotbar is the point.
    if (kind === 'inv' && index < HOTBAR_SIZE) {
      const k = document.createElement('span');
      k.className = 'slot-key';
      k.textContent = (index + 1) % 10;
      d.appendChild(k);
    }
    const c = document.createElement('span'); c.className = 'slot-count';
    d.appendChild(c);
    return d;
  }

  // Called on release for a gesture that turned out not to be a drag.
  _slotClick(e, slot) {
    if (!slot) return;
    const kind = slot.dataset.kind;
    const index = slot.dataset.index;
    const def = this._slotDef(kind, index);
    // Touch: a tap inspects the item (persistent tooltip with action buttons) so
    // the tooltip never vanishes instantly and you can still act on the item.
    if (e.pointerType === 'touch') {
      if (def) this._showTooltip(def, slot, kind, index, true);
      else this.hideTooltip();
      return;
    }
    // Mouse: act immediately (hover already surfaced the tooltip).
    if (kind === 'equip') this.game.unequip(index);
    else { if (e.button === 2) this.game.dropInventoryItem(+index); else this.game.useInventoryItem(+index); }
    this._syncSlots();
    this._renderStats(this.game.localPlayer);
  }

  // Pointer drag between slots, so items can be rearranged the way they can in
  // any inventory the player has used before. A drag that doesn't move far
  // enough falls through to the click handler above.
  _wireDragAndDrop() {
    const DRAG_THRESHOLD = 6;
    let from = null, startX = 0, startY = 0, dragging = false;

    const slotAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('.inv-slot') : null;
    };
    const clearHighlight = () => {
      document.querySelectorAll('.inv-slot.drag-over').forEach(el => el.classList.remove('drag-over'));
    };

    const onDown = (e) => {
      const slot = e.target.closest('.inv-slot');
      if (!slot) return;
      // A right-click is always a drop, never a drag: act immediately.
      if (e.button === 2) {
        e.preventDefault();
        from = null;
        this._slotClick(e, slot);
        return;
      }
      from = slot; startX = e.clientX; startY = e.clientY; dragging = false;
    };
    const onMove = (e) => {
      if (!from) return;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_THRESHOLD) {
        dragging = true;
        from.classList.add('dragging');
        this.hideTooltip();
      }
      if (!dragging) return;
      clearHighlight();
      const over = slotAt(e.clientX, e.clientY);
      if (over && over !== from) over.classList.add('drag-over');
    };
    const onUp = (e) => {
      if (!from) return;
      const wasDragging = dragging;
      from.classList.remove('dragging');
      clearHighlight();
      const src = from;
      from = null; dragging = false;

      if (!wasDragging) {
        // Not a drag after all — this was a click on the slot.
        e.preventDefault();
        this._slotClick(e, src);
        return;
      }
      const target = slotAt(e.clientX, e.clientY);
      if (!target || target === src) return;
      e.preventDefault();
      this.game.moveInventoryItem(
        { kind: src.dataset.kind, index: src.dataset.index },
        { kind: target.dataset.kind, index: target.dataset.index },
      );
      this._syncSlots();
      this._renderStats(this.game.localPlayer);
    };

    for (const gid of ['invGrid', 'equipGrid']) {
      $(gid).addEventListener('pointerdown', onDown);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', () => {
      if (from) from.classList.remove('dragging');
      clearHighlight(); from = null; dragging = false;
    });
  }

  _slotDef(kind, index) {
    const inv = this.game.localPlayer && this.game.localPlayer.inventory;
    if (!inv) return null;
    let ref;
    if (kind === 'equip') { ref = index.startsWith('acc') ? inv.equip.acc[+index.slice(3)] : inv.equip[index]; }
    else ref = inv.slots[+index];
    return ref ? getItem(ref.id) : null;
  }

  // ---- Item tooltips ----
  _hoverSlot(e) {
    const slot = e.target.closest('.inv-slot');
    if (!slot) return;
    clearTimeout(this._ttHideT);
    const def = this._slotDef(slot.dataset.kind, slot.dataset.index);
    if (!def) { this.hideTooltip(); return; }
    this._showTooltip(def, slot, slot.dataset.kind, slot.dataset.index, false);
    this._moveTooltip(e.clientX, e.clientY);
  }
  _scheduleHideTooltip() { clearTimeout(this._ttHideT); this._ttHideT = setTimeout(() => this.hideTooltip(), 90); }

  _showTooltip(def, slot, kind, index, touch) {
    const tt = $('itemTooltip');
    tt.innerHTML = this._tooltipHTML(def) + (touch ? this._tooltipActions(kind, index, def) : '');
    tt.classList.toggle('touch', !!touch);
    tt.classList.remove('hidden');
    this._ttOpen = true;
    if (touch) {
      const r = slot.getBoundingClientRect();
      this._placeTooltip(r.left + r.width / 2, r.top - 8, true);
      // Wire action buttons.
      const act = (fn) => { fn(); this.renderInventory(); this.hideTooltip(); };
      const btnUse = tt.querySelector('[data-tt="use"]');
      const btnDrop = tt.querySelector('[data-tt="drop"]');
      if (btnUse) btnUse.onclick = () => act(() => { if (kind === 'equip') this.game.unequip(index); else this.game.useInventoryItem(+index); });
      if (btnDrop) btnDrop.onclick = () => act(() => { if (kind !== 'equip') this.game.dropInventoryItem(+index); });
    }
  }
  _moveTooltip(x, y) { if (this._ttOpen && !$('itemTooltip').classList.contains('touch')) this._placeTooltip(x + 16, y + 16, false); }
  _placeTooltip(x, y, above) {
    const tt = $('itemTooltip');
    const w = tt.offsetWidth || 220, h = tt.offsetHeight || 120;
    let px = Math.min(x, window.innerWidth - w - 8);
    let py = above ? y - h : y;
    px = Math.max(8, px - (above ? w / 2 : 0));
    py = Math.max(8, Math.min(py, window.innerHeight - h - 8));
    tt.style.left = px + 'px'; tt.style.top = py + 'px';
  }
  hideTooltip() { clearTimeout(this._ttHideT); const tt = $('itemTooltip'); tt.classList.add('hidden'); tt.classList.remove('touch'); this._ttOpen = false; }

  _rarity(tier) { return RARITY[Math.max(0, Math.min(RARITY.length - 1, tier || 0))]; }

  _tooltipActions(kind, index, def) {
    const useLabel = kind === 'equip' ? 'Unequip'
      : (def.category === 'armor' || def.category === 'accessory') ? 'Equip'
      : def.category === 'potion' ? 'Use'
      : 'Select';
    const drop = kind === 'equip' ? '' : `<button class="btn small" data-tt="drop">Drop</button>`;
    return `<div class="tt-actions"><button class="btn small primary" data-tt="use">${useLabel}</button>${drop}</div>`;
  }

  _tooltipHTML(def) {
    const rar = this._rarity(def.tier);
    const rows = [];
    const stat = (label, val, cls) => rows.push(`<div class="tt-stat ${cls || ''}"><b>${label}:</b> ${val}</div>`);
    const atkSpeed = (t) => (t ? (1 / t).toFixed(1) + '/s' : '');

    if (def.category === 'weapon') {
      stat('Class', CLASS_LABEL[def.weaponClass] || def.weaponClass);
      if (def.weaponClass !== 'summon') stat('Damage', def.damage);
      stat('Attack speed', atkSpeed(def.useTime));
      if (def.knockback) stat('Knockback', def.knockback);
      if (def.crit) stat('Crit chance', Math.round(def.crit * 100) + '%');
      if (def.manaCost) stat('Aether cost', def.manaCost, 'tt-mag');
      if (def.ammo) stat('Ammo', getItem(def.ammo).name);
      else if (def.weaponClass === 'ranged') stat('Ammo', 'None needed', 'tt-good');
      if (def.pierce) stat('Pierce', def.pierce);
      if (def.multishot) stat('Projectiles', def.multishot);
      if (def.summonMinion) stat('Summons', def.summonMinion);
      if (def.effect) stat('Effect', Object.keys(def.effect).join(', '), 'tt-good');
    } else if (def.category === 'tool') {
      stat('Type', def.tool.kind === 'axe' ? 'Axe (chops trees)' : 'Pickaxe (mines stone/ore)');
      stat('Power', def.tool.power);
    } else if (def.category === 'armor') {
      stat('Slot', def.slot);
      stat('Defense', def.defense, 'tt-good');
      if (def.setBonus && def.setBonus.classBonus) stat('Class', CLASS_LABEL[def.setBonus.classBonus] + ' focus', 'tt-mag');
      if (def.setBonus && def.setBonus.dmgMul) stat('Piece bonus', '+' + Math.round(def.setBonus.dmgMul * 100) + '% ' + (CLASS_LABEL[def.setBonus.classBonus] || '') + ' dmg', 'tt-mag');
      if (def.setBonus && def.setBonus.maxMana) stat('Piece bonus', '+' + def.setBonus.maxMana + ' Aether', 'tt-mag');
      if (def.setBonus && def.setBonus.minionCap) stat('Piece bonus', '+' + def.setBonus.minionCap + ' minion', 'tt-mag');
      if (def.setKey) rows.push(`<div class="tt-set">${SET_LABEL[def.setKey] || def.setKey} set (3 pieces): ${SET_BONUS_DESC[def.setKey] || ''}</div>`);
    } else if (def.category === 'accessory') {
      const s = def.accStats || {};
      if (s.defense) stat('Defense', '+' + s.defense, 'tt-good');
      if (s.speed) stat('Move speed', '+' + Math.round(s.speed * 100) + '%');
      if (s.extraJumps) stat('Extra jumps', '+' + s.extraJumps);
      if (s.maxHp) stat('Max health', '+' + s.maxHp);
      if (s.maxMana) stat('Max Aether', '+' + s.maxMana, 'tt-mag');
      if (s.minionCap) stat('Minion capacity', '+' + s.minionCap, 'tt-mag');
    } else if (def.category === 'potion') {
      const e = def.potion || {};
      if (e.heal) { stat('Restores', e.heal + ' health', 'tt-good'); stat('Cooldown', HEAL_COOLDOWN + 's'); }
      if (e.mana) { stat('Restores', e.mana + ' Aether', 'tt-mag'); stat('Cooldown', MANA_POTION_COOLDOWN + 's'); }
      if (e.buff) stat('Effect', e.buff.type + ' for ' + e.buff.duration + 's', 'tt-good');
    } else if (def.category === 'ammo') {
      stat('Type', 'Ammunition');
    } else if (def.category === 'throwable') {
      stat('Type', 'Thrown');
      if (def.contactDamage) stat('Impact damage', def.contactDamage);
      if (def.blastDamage) stat('Blast damage', def.blastDamage, 'tt-good');
      if (def.blastRadius) stat('Blast radius', def.blastRadius + ' tiles');
      if (def.fuse) stat('Fuse', def.fuse + 's');
      if (def.explodeOnImpact) stat('Detonates', 'on impact');
      if (def.sticky) stat('Sticks', 'to terrain', 'tt-good');
      if (def.breaksBlocks) stat('Breaks blocks', 'Yes', 'tt-good');
      else if (def.explode) stat('Breaks blocks', 'No');
      if (def.pierce) stat('Pierce', def.pierce);
      if (def.recoverChance) stat('Recoverable', Math.round(def.recoverChance * 100) + '%');
      if (def.effect) stat('Effect', Object.keys(def.effect).join(', '), 'tt-good');
    }

    const tag = def.category === 'weapon' ? (CLASS_LABEL[def.weaponClass] + ' weapon')
      : def.category === 'summonitem' ? 'Boss summon'
      : def.category === 'throwable' ? 'Throwable'
      : def.category.charAt(0).toUpperCase() + def.category.slice(1);
    return `<div class="tt-name" style="color:${rar.color}">${def.name}</div>`
      + `<div class="tt-tag" style="color:${rar.color}">${rar.name} · ${tag}</div>`
      + rows.join('')
      + (def.desc ? `<div class="tt-desc">${def.desc}</div>` : '');
  }

  renderCrafting(force) {
    const p = this.game.localPlayer;
    if (!p) return;
    const list = $('craftList');
    const recs = availableRecipes(this.game, p);
    // Rebuilding ~80 rows every tick was most of the inventory's cost. Only do
    // it when what's craftable (or the material counts shown) actually changed.
    const sig = recs.map(r => r.recipe.id + (r.craftable ? '1' : '0') +
      r.recipe.in.map(i => p.inventory.count(i.item)).join(',')).join('|');
    if (!force && sig === this._craftSig) return;
    this._craftSig = sig;
    list.innerHTML = '';
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
