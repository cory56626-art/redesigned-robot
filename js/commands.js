// Summoner Realms — Demo Commands console (testing only).
import { ITEMS, DEMO_GIVE_ALL } from './data/items.js';
import { ENEMY_KEYS, ENEMIES } from './data/enemies.js';
import { BOSS_KEYS, BOSSES } from './data/bosses.js';

const $ = (id) => document.getElementById(id);

// Friendly aliases so common creature names map to this game's original enemies
// (e.g. there's no "slime" — the slime-like foe is the Slugling).
const SPAWN_ALIASES = {
  slime: 'slugling', slimes: 'slugling', slug: 'slugling',
  zombie: 'husk', skeleton: 'bonepicker', bones: 'bonepicker',
  spider: 'crawler', pig: 'boar', ghost: 'blightshade', caster: 'blightshade',
};

export class CommandConsole {
  constructor(game) {
    this.game = game;
    this.history = [];
    this.histIdx = -1;
    this.acIndex = 0;
    this.acItems = [];
    this._defineCommands();
    this._wire();
    this._renderList();
  }

  _defineCommands() {
    const g = this.game;
    this.commands = {
      help: { args: '', desc: 'List all commands', run: () => this._help() },
      give: { args: '[item] [amount]', desc: 'Give an item', run: (a) => this._give(a) },
      giveall: { args: '', desc: 'Give all demo items', run: () => this._giveAll() },
      spawn: { args: '[enemy]', desc: 'Spawn an enemy nearby', run: (a) => this._spawn(a) },
      spawnboss: { args: '[boss]', desc: 'Spawn a boss', run: (a) => this._spawnBoss(a) },
      summonitem: { args: '[boss]', desc: 'Give a boss-summoning item', run: (a) => this._summonItem(a) },
      killall: { args: '', desc: 'Defeat nearby enemies (not bosses — use /clearboss)', run: () => this._killAll() },
      clearboss: { args: '', desc: 'Remove active boss(es), their adds & shots', run: () => this._clearBoss() },
      resetcombat: { args: '', desc: 'Clear projectiles/effects & combat state', run: () => this._resetCombat() },
      resetworldstate: { args: '', desc: 'Clear all bosses, enemies & projectiles', run: () => this._resetWorldState() },
      heal: { args: '', desc: 'Restore health', run: () => { g.localPlayer.hp = g.localPlayer.maxHp; return ok('Health restored.'); } },
      mana: { args: '', desc: 'Restore Aether (mana)', run: () => { g.localPlayer.mana = g.localPlayer.maxMana; return ok('Aether restored.'); } },
      fly: { args: '', desc: 'Toggle flight', run: () => { g.localPlayer.cheats.fly = !g.localPlayer.cheats.fly; return ok('Fly ' + (g.localPlayer.cheats.fly ? 'ON' : 'OFF')); } },
      godmode: { args: '', desc: 'Toggle invincibility', run: () => { g.localPlayer.cheats.godmode = !g.localPlayer.cheats.godmode; return ok('God mode ' + (g.localPlayer.cheats.godmode ? 'ON' : 'OFF')); } },
      time: { args: '[day|night]', desc: 'Set time of day', run: (a) => this._time(a) },
      teleport: { args: '[forest|underground|corrupt|cavern]', desc: 'Teleport to a biome', run: (a) => this._teleport(a) },
      clearinventory: { args: '', desc: 'Clear the inventory', run: () => { g.localPlayer.inventory.clear(); g.localPlayer.recomputeStats(); return ok('Inventory cleared.'); } },
      resetcooldowns: { args: '', desc: 'Clear attack/mana/heal cooldowns', run: () => this._resetCooldowns() },
      save: { args: '', desc: 'Manually save the game', run: () => { g.saveGame(true); return ok('Game saved.'); } },
      resetdemo: { args: '', desc: 'Reset the demo world', run: () => { g.resetDemo(); return ok('Demo world reset.'); } },
      // ---- Debug overlays ----
      debugcollision: { args: '', desc: 'Toggle collision hitbox overlay', run: () => this._toggleDebug('collision') },
      debugai: { args: '', desc: 'Toggle enemy/minion target overlay', run: () => this._toggleDebug('ai') },
      debugbiome: { args: '', desc: 'Toggle current-biome readout', run: () => this._toggleDebug('biome') },
      debugspawn: { args: '', desc: 'Toggle valid/invalid spawn overlay', run: () => this._toggleDebug('spawn') },
      debugcaves: { args: '', desc: 'Toggle cave-void overlay', run: () => this._toggleDebug('caves') },
    };
  }

  _toggleDebug(key) {
    const d = this.game.debug;
    d[key] = !d[key];
    return ok('Debug ' + key + ' ' + (d[key] ? 'ON' : 'OFF'));
  }

  _resetCooldowns() {
    const p = this.game.localPlayer;
    p.healCd = 0; p.manaCd = 0; p.buffCd = 0; p.useTimer = 0; p.placeTimer = 0; p.castTimer = 0;
    return ok('Attack, mana, and healing cooldowns reset.');
  }

  _wire() {
    const input = $('cmdInput');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._submit(input.value); input.value = ''; this._updateAutocomplete(''); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (this.acItems.length) { this.acIndex = (this.acIndex - 1 + this.acItems.length) % this.acItems.length; this._renderAutocomplete(); } else this._histNav(-1, input); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (this.acItems.length) { this.acIndex = (this.acIndex + 1) % this.acItems.length; this._renderAutocomplete(); } else this._histNav(1, input); }
      else if (e.key === 'Tab') { e.preventDefault(); this._applyAutocomplete(input); }
      else if (e.key === 'Escape') { this.close(); }
    });
    input.addEventListener('input', () => this._updateAutocomplete(input.value));
    $('cmdClose').onclick = () => this.close();
  }

  open() {
    $('commandPanel').classList.remove('hidden');
    this.game.onMenuOpened();
    setTimeout(() => $('cmdInput').focus(), 30);
    if (!this._greeted) { this.print('Type a command or click one below. Try /help.', 'info'); this._greeted = true; }
  }
  close() { $('commandPanel').classList.add('hidden'); $('cmdAutocomplete').innerHTML = ''; this.acItems = []; }
  isOpen() { return !$('commandPanel').classList.contains('hidden'); }

  _submit(raw) {
    let line = raw.trim();
    if (!line) return;
    if (line.startsWith('/')) line = line.slice(1);
    this.history.push(line); this.histIdx = this.history.length;
    this.print('/' + line, 'echo');
    const parts = line.split(/\s+/);
    const name = parts[0].toLowerCase();
    const args = parts.slice(1);
    const cmd = this.commands[name];
    if (!cmd) { this.print(`Unknown command: /${name}. Try /help.`, 'err'); return; }
    if (!this.game.localPlayer) { this.print('Start a world first.', 'err'); return; }
    try {
      const res = cmd.run(args);
      if (res) this.print(res.msg, res.ok ? 'ok' : 'err');
    } catch (e) { this.print('Error: ' + e.message, 'err'); console.error(e); }
  }

  print(msg, cls = 'info') {
    const out = $('cmdOutput');
    const d = document.createElement('div');
    d.className = 'cmd-line ' + cls;
    d.textContent = msg;
    out.appendChild(d);
    out.scrollTop = out.scrollHeight;
    while (out.children.length > 120) out.removeChild(out.firstChild);
  }

  _histNav(dir, input) {
    if (!this.history.length) return;
    this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + dir));
    input.value = this.history[this.histIdx] || '';
  }

  // ---- Autocomplete ----
  _updateAutocomplete(value) {
    const box = $('cmdAutocomplete');
    let v = value.trim();
    if (v.startsWith('/')) v = v.slice(1);
    const parts = v.split(/\s+/);
    let items = [];
    if (parts.length <= 1) {
      const q = (parts[0] || '').toLowerCase();
      items = Object.keys(this.commands).filter(c => c.startsWith(q)).map(c => ({ text: c, desc: this.commands[c].args }));
    } else {
      const name = parts[0].toLowerCase();
      const q = (parts[parts.length - 1] || '').toLowerCase();
      let pool = [];
      if (name === 'give') pool = Object.keys(ITEMS);
      else if (name === 'spawn') pool = ENEMY_KEYS;
      else if (name === 'spawnboss' || name === 'summonitem') pool = BOSS_KEYS;
      else if (name === 'time') pool = ['day', 'night'];
      else if (name === 'teleport') pool = ['forest', 'underground', 'corrupt', 'cavern'];
      const prefix = parts.slice(0, parts.length - 1).join(' ') + ' ';
      items = pool.filter(k => k.toLowerCase().startsWith(q) || (ITEMS[k] && ITEMS[k].name.toLowerCase().includes(q)))
        .slice(0, 40).map(k => ({ text: prefix + k, desc: (ITEMS[k] && ITEMS[k].name) || (ENEMIES[k] && ENEMIES[k].name) || (BOSSES[k] && BOSSES[k].name) || '' }));
    }
    this.acItems = items;
    this.acIndex = 0;
    this._renderAutocomplete();
  }

  _renderAutocomplete() {
    const box = $('cmdAutocomplete');
    box.innerHTML = '';
    if (!this.acItems.length) return;
    this.acItems.slice(0, 8).forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'ac-item' + (i === this.acIndex ? ' active' : '');
      d.innerHTML = `${it.text}${it.desc ? `<span class="ac-desc">${it.desc}</span>` : ''}`;
      d.onclick = () => { $('cmdInput').value = it.text + ' '; $('cmdInput').focus(); this._updateAutocomplete(it.text); };
      box.appendChild(d);
    });
  }

  _applyAutocomplete(input) {
    if (!this.acItems.length) return;
    input.value = this.acItems[this.acIndex].text + ' ';
    this._updateAutocomplete(input.value);
  }

  _renderList() {
    const list = $('cmdList');
    list.innerHTML = '';
    for (const name in this.commands) {
      const c = this.commands[name];
      const d = document.createElement('div');
      d.className = 'cmd-help';
      d.innerHTML = `<b>/${name}</b> ${c.args} <span>— ${c.desc}</span>`;
      d.onclick = () => { $('cmdInput').value = '/' + name + ' '; $('cmdInput').focus(); this._updateAutocomplete(name + ' '); };
      list.appendChild(d);
    }
  }

  // ---- Command implementations ----
  _help() {
    this.print('Available commands:', 'info');
    for (const name in this.commands) this.print(`/${name} ${this.commands[name].args} — ${this.commands[name].desc}`, 'info');
    return null;
  }

  _resolve(pool, query, nameMap) {
    query = (query || '').toLowerCase();
    if (!query) return null;
    // Space/punctuation-insensitive form so "plantfiber" matches the item whose
    // display name is "Plant Fiber", "craftingbench" matches "Crafting Bench", etc.
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nq = norm(query);
    if (pool.includes(query)) return query;
    let m = pool.find(k => k.toLowerCase() === query);
    if (m) return m;
    // Exact match on the normalized id or display name.
    m = pool.find(k => norm(k) === nq || (nameMap && nameMap[k] && norm(nameMap[k]) === nq));
    if (m) return m;
    m = pool.find(k => k.toLowerCase().startsWith(query));
    if (m) return m;
    m = pool.find(k => k.toLowerCase().includes(query) || norm(k).includes(nq) ||
      (nameMap && nameMap[k] && (nameMap[k].toLowerCase().includes(query) || norm(nameMap[k]).includes(nq))));
    return m || null;
  }

  _give(a) {
    const nameMap = {}; for (const k in ITEMS) nameMap[k] = ITEMS[k].name;
    const id = this._resolve(Object.keys(ITEMS), a[0], nameMap);
    if (!id) return err(`No item matching "${a[0] || ''}".`);
    const amt = Math.max(1, parseInt(a[1], 10) || 1);
    const left = this.game.localPlayer.inventory.add(id, amt);
    this.game.localPlayer.recomputeStats();
    this.game.markDirty();
    return ok(`Gave ${amt - left}× ${ITEMS[id].name}` + (left ? ` (${left} didn't fit)` : ''));
  }

  _giveAll() {
    let n = 0;
    for (const id of DEMO_GIVE_ALL) { const def = ITEMS[id]; const amt = def.maxStack > 1 ? Math.min(def.maxStack, 50) : 1; this.game.localPlayer.inventory.add(id, amt); n++; }
    this.game.localPlayer.recomputeStats();
    this.game.markDirty();
    return ok(`Gave ${n} demo items. Check your bag (E).`);
  }

  _spawn(a) {
    const raw = (a[0] || '').toLowerCase();
    const id = SPAWN_ALIASES[raw] || this._resolve(ENEMY_KEYS, a[0], ENEMYNAMES());
    if (!id) return err(`No enemy matching "${a[0] || ''}". Options: ${ENEMY_KEYS.join(', ')}`);
    const count = Math.max(1, Math.min(10, parseInt(a[1], 10) || 1));
    this.game.hostCommand('spawn', { key: id, count });
    return ok(`Spawned ${count}× ${ENEMIES[id].name}.`);
  }

  _spawnBoss(a) {
    const id = this._resolve(BOSS_KEYS, a[0], BOSSNAMES());
    if (!id) return err(`No boss matching "${a[0] || ''}". Options: ${BOSS_KEYS.join(', ')}`);
    this.game.hostCommand('spawnboss', { key: id });
    return ok(`Summoned ${BOSSES[id].name}.`);
  }

  _summonItem(a) {
    const id = this._resolve(BOSS_KEYS, a[0], BOSSNAMES());
    if (!id) return err(`No boss matching "${a[0] || ''}".`);
    const itemId = BOSSES[id].summonItem;
    this.game.localPlayer.inventory.add(itemId, 3);
    return ok(`Gave 3× ${ITEMS[itemId].name}.`);
  }

  _killAll() {
    this.game.hostCommand('killall', {});
    const hasBoss = this.game.bosses.length > 0;
    return ok('Cleared nearby enemies.' + (hasBoss ? ' (Bosses are NOT included — use /clearboss.)' : ''));
  }

  _clearBoss() {
    const n = this.game.clearBosses(false);
    return n ? ok(`Removed ${n} boss${n > 1 ? 'es' : ''}, adds and boss projectiles.`) : ok('No active boss to clear.');
  }

  _resetCombat() {
    this.game.resetCombatState();
    return ok('Projectiles, particles and combat state cleared.');
  }

  _resetWorldState() {
    this.game.clearBosses(true);
    this.game.killAllEnemies();
    this.game.resetCombatState();
    return ok('World runtime reset: bosses, enemies and projectiles cleared (terrain kept).');
  }

  _time(a) {
    const t = (a[0] || '').toLowerCase();
    if (t !== 'day' && t !== 'night') return err('Usage: /time day  or  /time night');
    this.game.hostCommand('time', { t });
    return ok('Set time to ' + t + '.');
  }

  _teleport(a) {
    const b = (a[0] || '').toLowerCase();
    if (!['forest', 'underground', 'corrupt', 'cavern'].includes(b)) return err('Usage: /teleport forest|underground|corrupt');
    this.game.teleportBiome(b);
    return ok('Teleported to ' + b + '.');
  }
}

function ok(msg) { return { ok: true, msg }; }
function err(msg) { return { ok: false, msg }; }
function ENEMYNAMES() { const m = {}; for (const k in ENEMIES) m[k] = ENEMIES[k].name; return m; }
function BOSSNAMES() { const m = {}; for (const k in BOSSES) m[k] = BOSSES[k].name; return m; }
