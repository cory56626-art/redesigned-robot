// Summoner Realms — menu & overlay controller (main menu, dialogs, inventory,
// crafting, multiplayer sidebar, chat, confirm, death screen).
import { HOTBAR_SIZE, HEAL_COOLDOWN, MANA_POTION_COOLDOWN, difficultyForIndex, difficultyInfo } from '../config.js?v=prehardmode-classes-1';
import { INV_SIZE, SET_BONUS_DESC, SET_LABEL } from '../systems/inventory.js?v=prehardmode-classes-1';
import { Sprites } from '../art/sprites.js?v=prehardmode-classes-1';
import { item as getItem } from '../data/items.js?v=prehardmode-classes-1';
import { availableRecipes } from '../systems/crafting.js?v=prehardmode-classes-1';
import { claudeNotesHTML } from './claude-notes.js?v=prehardmode-classes-1';
import { LOOK_PALETTES, HAIR_STYLES, defaultAppearance } from '../save.js?v=prehardmode-classes-1';
import { ACHIEVEMENT_BY_ID } from '../systems/achievements.js?v=prehardmode-classes-1';
import { drawCharacterPreview } from '../art/charpreview.js?v=prehardmode-classes-1';

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
    $('btnMultiplayer').onclick = () => this.openMultiplayer();
    $('btnSettings').onclick = () => this.openSettings();
    $('btnHowto').onclick = () => this.showHowTo();
    $('btnClaudeNotes').onclick = () => this.showClaudeNotes();
    $('controlModeSeg').querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => g.setControlMode(b.dataset.mode);
    });
    // ---- Characters ----
    $('btnCharacters').onclick = () => this.openCharacterSelect();
    $('btnEditCharacter').onclick = () => this.openCharacterEditor(g.character);
    $('charSelectClose').onclick = () => this.hide('charSelect');
    $('charNew').onclick = () => this.openCharacterEditor(null);
    $('charCreateCancel').onclick = () => { this.hide('charCreate'); this._stopPreview(); };
    $('charCreateSave').onclick = () => this.saveCharacterEditor();
    $('charPoseSeg').querySelectorAll('.seg-btn').forEach(b => {
      b.onclick = () => {
        $('charPoseSeg').querySelectorAll('.seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this._previewPose = b.dataset.pose;
      };
    });
    $('btnAchievements').onclick = () => this.showAchievements();
    $('achieveClose').onclick = () => this.hide('achievementsDialog');
    this._buildSwatches();
    this.refreshActiveCharacter();

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
    $('mpDifficulty').addEventListener('input', () => this._syncDifficultySlider('mp'));
    $('mpUseCurrent').addEventListener('change', () => this._syncMpHostMode());
    $('mpChangeChar').onclick = () => this.openCharacterSelect();
    $('btnCreateServer').onclick = () => {
      const useCurrent = $('mpUseCurrent').checked && g.state === 'playing';
      g.createServer({
        useCurrent,
        name: ($('mpWorldName').value || '').trim() || 'Shared Realm',
        seed: ($('mpWorldSeed').value || '').trim(),
        difficulty: difficultyForIndex($('mpDifficulty').value).key,
      });
    };
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
    $('setZoom').addEventListener('input', (e) => {
      g.setZoom(Number(e.target.value) / 100);
      this._syncSettings();
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
  _syncNewWorldDifficulty() { this._syncDifficultySlider('newWorld'); }
  // Shared by the New World dialog and the multiplayer host card, so both
  // sliders read and behave identically instead of being two near-copies.
  _syncDifficultySlider(prefix) {
    const slider = $(prefix + 'Difficulty');
    if (!slider) return;
    const info = difficultyForIndex(slider.value);
    $(prefix + 'DifficultyLabel').textContent = info.label;
    $(prefix + 'DifficultyTier').textContent = info.tier;
    $(prefix + 'DifficultyHint').textContent = info.hint;
    slider.style.setProperty('--fill', (WORLD_DIFFICULTY_FILL(info.key) * 100) + '%');
    return info;
  }

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
    return ['mainMenu', 'newWorldDialog', 'loadWorldDialog', 'mpMenu',
      'commandPanel', 'howtoDialog', 'claudeNotesDialog', 'confirmDialog', 'amountDialog',
      'deathScreen', 'settingsDialog', 'npcDialog']
      .some(id => this.isOpen(id));
  }

  confirm(title, msg, onYes) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = msg;
    this.show('confirmDialog');
    $('confirmYes').onclick = () => { this.hide('confirmDialog'); onYes(); };
  }

  // Ask for a count between 1 and `max`. The slider and the number field stay
  // in sync so this works with a mouse, a keyboard or a thumb.
  askAmount(title, max, onConfirm) {
    const cap = Math.max(1, Math.floor(max) || 1);
    $('amountTitle').textContent = title;
    const input = $('amountInput'), range = $('amountRange');
    input.max = String(cap); range.max = String(cap);
    const set = (n) => {
      const v = Math.max(1, Math.min(cap, Math.floor(Number(n) || 1)));
      input.value = String(v); range.value = String(v);
    };
    set(cap);
    input.oninput = () => { range.value = input.value; };
    range.oninput = () => { input.value = range.value; };
    $('amountMinus').onclick = () => set(Number(input.value) - 1);
    $('amountPlus').onclick = () => set(Number(input.value) + 1);
    $('amountHalf').onclick = () => set(Math.max(1, Math.floor(cap / 2)));
    $('amountAll').onclick = () => set(cap);
    $('amountCancel').onclick = () => this.hide('amountDialog');
    $('amountOk').onclick = () => {
      this.hide('amountDialog');
      onConfirm(Math.max(1, Math.min(cap, Math.floor(Number(input.value) || 1))));
    };
    this.show('amountDialog');
    input.focus();
  }

  // ---- Multiplayer ----

  openMultiplayer() {
    const g = this.game;
    // Hosting the world you are already in only makes sense when there is one.
    const canUseCurrent = g.state === 'playing' && !!g.world;
    const cb = $('mpUseCurrent');
    cb.disabled = !canUseCurrent;
    cb.checked = canUseCurrent;
    cb.closest('.check-row').classList.toggle('disabled', !canUseCurrent);
    this._syncDifficultySlider('mp');
    this._syncMpHostMode();
    this.refreshMpCharacter();
    this.show('mpMenu');
  }

  // Hosting your current world means its name, seed and difficulty are already
  // decided — so the fields that would contradict that are disabled rather than
  // silently ignored.
  _syncMpHostMode() {
    const useCurrent = $('mpUseCurrent').checked;
    for (const id of ['mpWorldName', 'mpWorldSeed', 'mpDifficulty']) {
      const el = $(id);
      el.disabled = useCurrent;
      el.closest('div')?.classList.toggle('disabled', useCurrent);
    }
    $('btnCreateServer').textContent = useCurrent ? 'Host this world' : 'Start hosting';
  }

  refreshMpCharacter() {
    const g = this.game;
    const ch = g.character;
    $('mpCharName').textContent = ch ? ch.name : 'Summoner';
    const cv = $('mpCharPreview');
    if (cv) {
      drawCharacterPreview(cv.getContext('2d'), g.renderer,
        (ch && ch.appearance) || defaultAppearance(0), { scale: 2.2 });
    }
  }

  // ---- Characters ----

  refreshActiveCharacter() {
    const el = $('activeCharName');
    if (!el) return;
    const ch = this.game.character;
    el.textContent = ch ? ch.name : 'None';
    el.style.color = ch ? ch.appearance.shirt : '';
  }

  openCharacterSelect() {
    this.renderCharacterList();
    this.show('charSelect');
  }

  renderCharacterList() {
    const g = this.game;
    const wrap = $('charList');
    wrap.innerHTML = '';
    const list = g.characters.list();
    if (!list.length) {
      wrap.innerHTML = '<p class="hint">No summoners yet. Create one to begin.</p>';
      return;
    }
    for (const entry of list) {
      const row = document.createElement('div');
      row.className = 'char-row' + (g.character && g.character.id === entry.id ? ' active' : '');

      const cv = document.createElement('canvas');
      cv.width = 48; cv.height = 76; cv.className = 'char-thumb';
      drawCharacterPreview(cv.getContext('2d'), g.renderer, entry.appearance || defaultAppearance(0), { scale: 2.2 });
      row.appendChild(cv);

      const info = document.createElement('div');
      info.className = 'char-info';
      const when = new Date(entry.updated).toLocaleDateString();
      info.innerHTML = `<b>${escapeHtml(entry.name)}</b>`
        + `<span class="hint small">${entry.achievements || 0} achievements · last played ${when}</span>`;
      row.appendChild(info);

      const acts = document.createElement('div');
      acts.className = 'char-actions';
      const play = document.createElement('button');
      play.className = 'btn small primary';
      play.textContent = g.character && g.character.id === entry.id ? 'Selected' : 'Select';
      play.onclick = () => {
        g.selectCharacter(entry.id);
        this.refreshActiveCharacter();
        this.refreshMpCharacter();
        this.renderCharacterList();
      };
      const edit = document.createElement('button');
      edit.className = 'btn small';
      edit.textContent = 'Customise';
      edit.onclick = () => { g.selectCharacter(entry.id); this.openCharacterEditor(g.character); };
      const del = document.createElement('button');
      del.className = 'btn small danger';
      del.textContent = 'Delete';
      del.onclick = () => this.confirm('Delete summoner?',
        `"${entry.name}" and everything they carry will be lost.`,
        () => { g.deleteCharacter(entry.id); this.refreshActiveCharacter(); this.renderCharacterList(); });
      acts.append(play, edit, del);
      row.appendChild(acts);
      wrap.appendChild(row);
    }
  }

  // The editor works for both "create" and "customise": passing a record edits
  // it in place, passing null starts a new one.
  openCharacterEditor(record) {
    this._editing = record || null;
    this._draft = record
      ? Object.assign({}, record.appearance)
      : defaultAppearance(this.game.characters.list().length);
    $('charCreateTitle').textContent = record ? 'Customise Summoner' : 'Create a Summoner';
    $('charName').value = record ? record.name : '';
    $('charName').placeholder = 'Summoner';
    this._previewPose = 'idle';
    this._syncSwatches();
    this.show('charCreate');
    this._startPreview();
  }

  _buildSwatches() {
    for (const row of document.querySelectorAll('#charCreate .swatch-row')) {
      const look = row.dataset.look;
      const holder = row.querySelector('.swatches');
      holder.innerHTML = '';
      const values = look === 'hairStyle' ? HAIR_STYLES : LOOK_PALETTES[look];
      for (const v of values) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.dataset.value = v;
        if (look === 'hairStyle') b.textContent = v;
        else b.style.background = v;
        b.onclick = () => {
          this._draft[look] = v;
          this._syncSwatches();
        };
        holder.appendChild(b);
      }
    }
  }

  _syncSwatches() {
    if (!this._draft) return;
    for (const row of document.querySelectorAll('#charCreate .swatch-row')) {
      const look = row.dataset.look;
      for (const b of row.querySelectorAll('.swatch')) {
        b.classList.toggle('on', b.dataset.value === this._draft[look]);
      }
    }
  }

  // The preview animates, so a walk cycle actually walks.
  _startPreview() {
    this._stopPreview();
    const cv = $('charPreview');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const t0 = performance.now();
    const tick = () => {
      if (this.isOpen('charCreate') === false) { this._stopPreview(); return; }
      const t = (performance.now() - t0) / 1000;
      drawCharacterPreview(ctx, this.game.renderer, this._draft, { pose: this._previewPose, scale: 5, t });
      this._previewRaf = requestAnimationFrame(tick);
    };
    tick();
  }
  _stopPreview() {
    if (this._previewRaf) cancelAnimationFrame(this._previewRaf);
    this._previewRaf = null;
  }

  saveCharacterEditor() {
    const g = this.game;
    const name = ($('charName').value || '').trim() || 'Summoner';
    if (this._editing) {
      this._editing.name = name.slice(0, 14);
      g.characters.write(this._editing);
      if (g.character && g.character.id === this._editing.id) {
        g.updateAppearance(this._draft);
        g.playerName = this._editing.name;
        if (g.localPlayer) g.localPlayer.name = this._editing.name;
      }
    } else {
      g.createCharacter(name, this._draft);
    }
    this._stopPreview();
    this.hide('charCreate');
    this.refreshActiveCharacter();
    if (this.isOpen('charSelect')) this.renderCharacterList();
  }

  // ---- Achievements ----

  showAchievements() {
    const g = this.game;
    const a = g.achievements;
    $('achieveCount').textContent = `${a.count()} / ${a.total()}`;
    const body = $('achieveBody');
    body.innerHTML = '';
    for (const group of a.grouped()) {
      const h = document.createElement('h3');
      h.textContent = group.name;
      body.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'achieve-grid';
      for (const def of group.items) {
        const got = a.has(def.id);
        const card = document.createElement('div');
        card.className = 'achieve-card' + (got ? ' got' : '');
        card.innerHTML = `<span class="achieve-icon">${got ? def.icon : '🔒'}</span>`
          + `<span class="achieve-name">${escapeHtml(def.name)}</span>`
          + `<span class="hint small">${escapeHtml(def.desc)}</span>`;
        grid.appendChild(card);
      }
      body.appendChild(grid);
    }
    this.show('achievementsDialog');
  }

  // ---- Main menu / pause visibility ----
  showMainMenu() { this.refreshContinue(); this.show('mainMenu'); }
  hideMainMenu() { this.hide('mainMenu'); }
  // Show "Continue" only when there's at least one save to resume.
  refreshContinue() {
    const btn = $('btnContinue');
    if (btn) btn.classList.toggle('hidden', this.game.saves.list().length === 0);
  }
  showPause() {
    // Transparent pause: a translucent side panel rather than a full-screen
    // scrim, offset so it never covers the player, and non-blocking so you can
    // keep moving and interacting while it is open.
    $('pauseMenu').classList.add('transparent');
    this.show('pauseMenu');
    $('btnLeaveServer').style.display = this.game.net ? '' : 'none';
    this._updatePauseSaveState();
  }
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
      <ul><li>Gather first-world materials, climb the eight pre-Hardmode ore tiers, survive the hostile wildlife, and build a safe realm.</li></ul>
      <h4>PC Controls</h4>
      <ul>
        <li><kbd>A</kbd>/<kbd>D</kbd> or arrows — move · <kbd>W</kbd>/<kbd>Space</kbd> — jump</li>
        <li><b>Left-click</b> — use item (attack / cast / summon / throw / place / mine or chop with the held tool)</li>
        <li><b>Right-click</b> — dig/chop the targeted tile with the best tool for it (pickaxe for stone, axe for trees)</li>
        <li><kbd>1</kbd>–<kbd>0</kbd> / scroll — select hotbar · <kbd>E</kbd> — inventory &amp; crafting · <kbd>Q</kbd> — use potion</li>
        <li><kbd>F</kbd> — talk to the nearest NPC · <kbd>Ctrl</kbd> — hold for <b>Smart Cursor</b> (or set it to Always in Settings)</li>
        <li><kbd>+</kbd>/<kbd>&minus;</kbd> or <kbd>Ctrl</kbd>+scroll — <b>zoom</b> · <kbd>M</kbd> — resize the <b>map</b></li>
        <li>Right-click a bag slot to <b>drop one</b>; <kbd>Shift</kbd>+right-click drops the stack, <kbd>Ctrl</kbd>+right-click asks how many</li>
        <li><kbd>Esc</kbd> — pause · <kbd>Enter</kbd> — chat (multiplayer)</li>
      </ul>
      <h4>Mobile Controls</h4>
      <ul>
        <li>Left stick moves, right stick aims. Buttons: Jump, Use, Mine, Place, Bag, Item.</li>
        <li><b>◎</b> toggles Smart Cursor, which picks the best tile for you — essential when aiming with a stick.</li>
        <li><b>🗺</b> resizes the map. Drag it to pan and pinch it to zoom; pinch anywhere else to zoom the view.</li>
        <li>Tap an item in your bag to inspect it, or drag it to another slot to rearrange.</li>
      </ul>
      <h4>Playing with the bag — or the pause menu — open</h4>
      <ul>
        <li>The world keeps running while your inventory is open, and you can still <b>move, jump and use items</b>. The panel sits in the corner rather than covering the screen.</li>
        <li>The <b>pause menu works the same way</b>: it is a translucent side panel, and the world carries on behind it. Enemies stay live while it is open.</li>
      </ul>
      <h4>Water, wildlife and fishing</h4>
      <ul>
        <li>Water <b>flows</b>. Mine into a pool and it drains. You can swim — hold jump to stroke upward.</li>
        <li><b>Click a bug</b> to catch it rather than attacking it. Bugs are fishing bait, and better bugs are better bait.</li>
        <li>Craft a <b>Sapling Rod</b>, stand by water and click to cast. Click again the moment the bobber dips. Rod tier, bait and how much open water you cast into all decide what you land — including <b>crates</b>.</li>
        <li>Animals drop meat and hides. Cook meat at a <b>Smeltery</b> for food that heals <i>and</i> buffs.</li>
      </ul>
      <h4>Building</h4>
      <ul>
        <li>A <b>hammer</b> never breaks a block — it reshapes it. Each hit cycles through half-blocks and four slopes, and you can genuinely walk up a slope. Swing one at open air to strip the background wall.</li>
        <li>With Smart Cursor held, dragging while you place <b>continues the line you started</b>, so walls and floors come out straight.</li>
      </ul>
      <h4>Summoners &amp; achievements</h4>
      <ul>
        <li>Your <b>character</b> is separate from the world: their look, inventory and achievements come with them into any realm. Make more from <b>Summoners</b> on the main menu.</li>
        <li>There are <b>16 realm achievements</b> — see them from the pause menu.</li>
      </ul>
      <h4>Tips</h4>
      <ul>
        <li>You start with only a <b>pickaxe</b>, an <b>axe</b>, a <b>sword</b>, and Emberlight. Chop trees with the axe (they topple and drop wood — leaves only give twigs), then mine stone with the pickaxe.</li>
        <li>Craft a <b>Crafting Bench</b> and <b>Smeltery</b>, then mine Stoneiron to begin the eight-tier pre-Hardmode ore progression. There are no bosses in this reset.</li>
        <li>Caves run mostly <b>sideways</b> and open up the deeper you go. Look for a sinkhole on the surface, and take torches — or catch a <b>Glowmoth</b>, which lights the way on its own.</li>
        <li>The <b>wind</b> changes through the day and pushes you a little on the surface. It stops entirely underground.</li>
        <li><b>Bombs</b> are a mining tool as much as a weapon — they arc, bounce, and blow craters in dirt and stone. Stand clear: the blast hurts you too.</li>
        <li>Bows need <b>arrows</b>, magic drains <b>Aether</b>, and healing has a <b>cooldown</b> — watch the hotbar timers.</li>
        <li>Lost? Talk to <b>Vesper Thane</b>, the Guide at your spawn, or find <b>Nivara Frostbell</b> in the Snowy Taiga. Either can explain items you are carrying.</li>
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
    // Zoom runs 60-200%, so its track fill is scaled to that range rather than
    // reusing the 0-100 mapping the volume sliders use.
    {
      const el = $('setZoom');
      el.value = Math.round(g.camera.zoom * 100);
      el.style.setProperty('--fill', ((el.value - 60) / 1.4) + '%');
      $('setZoomOut').textContent = el.value + '%';
    }
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
    // Right-click drops one; hold Shift for the whole stack, Ctrl to be asked
    // for an exact amount.
    if (kind === 'equip') this.game.unequip(index);
    else if (e.button === 2) {
      if (e.ctrlKey) { this.game.dropInventoryAmount(+index); return; }
      this.game.dropInventoryItem(+index, e.shiftKey ? Infinity : 1);
    } else this.game.useInventoryItem(+index);
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
      const btnDropAll = tt.querySelector('[data-tt="dropAll"]');
      const btnDropN = tt.querySelector('[data-tt="dropN"]');
      if (btnUse) btnUse.onclick = () => act(() => { if (kind === 'equip') this.game.unequip(index); else this.game.useInventoryItem(+index); });
      if (btnDrop) btnDrop.onclick = () => act(() => { if (kind !== 'equip') this.game.dropInventoryItem(+index, 1); });
      if (btnDropAll) btnDropAll.onclick = () => act(() => { if (kind !== 'equip') this.game.dropInventoryItem(+index, Infinity); });
      // "Drop N" opens its own dialog, so the tooltip closes without acting.
      if (btnDropN) btnDropN.onclick = () => { this.hideTooltip(); this.game.dropInventoryAmount(+index); };
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
    let drop = '';
    if (kind !== 'equip') {
      const held = this._slotCount(kind, index);
      drop = `<button class="btn small" data-tt="drop">Drop 1</button>`;
      // Only offer stack actions when there is actually a stack to split.
      if (held > 1) {
        drop += `<button class="btn small" data-tt="dropN">Drop N…</button>`
          + `<button class="btn small" data-tt="dropAll">Drop all (${held})</button>`;
      }
    }
    return `<div class="tt-actions"><button class="btn small primary" data-tt="use">${useLabel}</button>${drop}</div>`;
  }

  _slotCount(kind, index) {
    if (kind === 'equip') return 1;
    const inv = this.game.localPlayer && this.game.localPlayer.inventory;
    const s = inv && inv.slots[+index];
    return s ? s.count : 0;
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
      const kinds = {
        axe: 'Axe (chops trees)',
        pickaxe: 'Pickaxe (mines stone)',
        hammer: 'Hammer (shapes blocks, strips walls)',
      };
      stat('Type', kinds[def.tool.kind] || def.tool.kind);
      stat('Power', def.tool.power);
    } else if (def.category === 'fishingrod') {
      stat('Fishing power', def.rod.power);
      stat('Needs', 'Bait — catch a bug');
    } else if (def.category === 'bait') {
      stat('Bait quality', ['', 'Basic', 'Good', 'Excellent'][def.bait] || def.bait, 'tt-good');
    } else if (def.category === 'crate') {
      stat('Use', 'Click to open', 'tt-good');
    } else if (def.category === 'bucket') {
      stat('Use', def.bucket === 'water' ? 'Pour a tile of water' : 'Scoop a tile of water');
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

    const TAGS = {
      summonitem: 'Boss summon', throwable: 'Throwable', fishingrod: 'Fishing rod',
      bait: 'Bait', crate: 'Crate', bucket: 'Pail',
    };
    const tag = def.category === 'weapon' ? (CLASS_LABEL[def.weaponClass] + ' weapon')
      : def.food ? 'Food'
      : TAGS[def.category]
      || def.category.charAt(0).toUpperCase() + def.category.slice(1);
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
