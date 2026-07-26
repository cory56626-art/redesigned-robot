// Summoner Realms — game orchestrator, main loop, and all cross-system glue.
import {
  TILE, UNDERGROUND_Y, CAVERN_Y, SIM_DT, AUTOSAVE_INTERVAL, SAVE_VERSION,
  HOTBAR_SIZE, MAX_PROJECTILES, MAX_THROWN, normalizeDifficulty,
} from './config.js?v=realms-qor-45';
import { hashString, mulberry32, dist2, uid } from './utils.js?v=realms-qor-45';
import { World } from './world/world.js?v=realms-qor-45';
import { T } from './world/tiles.js?v=realms-qor-45';
import { Sprites } from './art/sprites.js?v=realms-qor-45';
import { Camera } from './engine/camera.js?v=realms-qor-45';
import { Input } from './engine/input.js?v=realms-qor-45';
import { AudioManager } from './engine/audio.js?v=realms-qor-45';
import { Renderer } from './engine/renderer.js?v=realms-qor-45';
import { Fx } from './engine/fx.js?v=realms-qor-45';
import { DayNight } from './systems/daynight.js?v=realms-qor-45';
import { Weather } from './systems/weather.js?v=realms-qor-45';
import { Spawner } from './systems/spawner.js?v=realms-qor-45';
import { Progression } from './systems/progression.js?v=realms-qor-45';
import { starterInventory } from './systems/inventory.js?v=realms-qor-45';
import * as craftSys from './systems/crafting.js?v=realms-qor-45';
import { applyPotion } from './systems/combat.js?v=realms-qor-45';
import { smartTarget } from './systems/smartcursor.js?v=realms-qor-45';
import { Minimap } from './systems/minimap.js?v=realms-qor-45';
import { MinimapUI } from './ui/minimap.js?v=realms-qor-45';
import { Bobber, findBait, rollCatch, openCrate } from './systems/fishing.js?v=realms-qor-45';
import { Player, assignColor } from './entities/player.js?v=realms-qor-45';
import { Enemy } from './entities/enemy.js?v=realms-qor-45';
import { Boss } from './entities/boss.js?v=realms-qor-45';
import { Minion } from './entities/minion.js?v=realms-qor-45';
import { Npc } from './entities/npc.js?v=realms-qor-45';
import { Projectile } from './entities/projectile.js?v=realms-qor-45';
import { DropItem } from './entities/droppeditem.js?v=realms-qor-45';
import { FallingTree } from './entities/fallingtree.js?v=realms-qor-45';
import { ThrownItem } from './entities/thrown.js?v=realms-qor-45';
import { ENEMIES } from './data/enemies.js?v=realms-qor-45';
import { BOSSES } from './data/bosses.js?v=realms-qor-45';
import { item as getItem } from './data/items.js?v=realms-qor-45';
import { HUD } from './ui/hud.js?v=realms-qor-45';
import { Menus } from './ui/menus.js?v=realms-qor-45';
import { NpcDialog } from './ui/npcdialog.js?v=realms-qor-45';
import { detectDefaultMode, applyControlMode } from './ui/controls-mode.js?v=realms-qor-45';
import { SaveManager, setSaveIndicator } from './save.js?v=realms-qor-45';
import { CommandConsole } from './commands.js?v=realms-qor-45';
import { Net } from './net/net.js?v=realms-qor-45';
import { MSG } from './net/protocol.js?v=realms-qor-45';
import * as sync from './net/sync.js?v=realms-qor-45';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.audio = new AudioManager();
    this.audio.attach();
    this.camera = new Camera();
    this.input = new Input(this.canvas);
    this.input.setCamera(this.camera);
    this.renderer = new Renderer(this.canvas, this.camera);
    this.saves = new SaveManager();

    this.state = 'menu';         // menu | playing
    this.paused = false;
    this.controlMode = 'pc';

    this.world = null;
    this.time = new DayNight();
    this.weather = new Weather();
    this.spawner = new Spawner();
    this.progression = new Progression();
    this.minimap = new Minimap();

    this.players = new Map();
    this.localPlayer = null;
    this.selfId = 'local';
    this.enemies = [];
    this.enemyById = new Map();
    this.minions = [];
    this.bosses = [];
    this.projectiles = [];
    this.drops = [];
    this.dropById = new Map();
    this.particles = [];
    this.rings = [];         // expanding shockwave / telegraph rings
    this.flashes = [];       // transient light sources (explosions)
    this.floatTexts = [];
    this.fallingTrees = [];  // cosmetic tree-topple animations
    this.bobbers = [];       // fishing floats, one per player at most
    this.thrown = [];        // bombs, dynamite, shurikens in flight
    this.npc = null;         // the Guide
    this.fx = new Fx(this);

    // Debug overlays toggled from the demo command console.
    this.debug = { collision: false, ai: false, biome: false, spawn: false, caves: false, walls: false };

    this.net = null;
    this.isHost = true;          // true in single-player and while hosting
    this._netId = 1;

    this.worldName = 'Realm';
    this.seed = 0;
    this.difficulty = 'normal';
    this.currentSaveId = null;
    this.dirty = false;
    this._autosaveTimer = AUTOSAVE_INTERVAL;

    // Settings. Smart Cursor defaults on for touch (where picking one tile with
    // a stick is impractical) and to hold-to-enable on desktop, where the
    // pointer is already precise.
    const s = this.saves.readSettings();
    this.playerName = s.name || 'Summoner';
    this.playerColorIndex = s.colorIndex || 0;
    this.playerColor = assignColor(this.playerColorIndex);
    this.settings = {
      smartCursor: s.smartCursor || (detectDefaultMode() === 'mobile' ? 'on' : 'hold'),
      screenShake: s.screenShake !== false,
      masterVolume: s.masterVolume != null ? s.masterVolume : 0.8,
      musicVolume: s.musicVolume != null ? s.musicVolume : 0.55,
      sfxVolume: s.sfxVolume != null ? s.sfxVolume : 0.9,
      zoom: s.zoom != null ? s.zoom : 1,
    };
    this.smartTarget = null;

    this.ui = { hud: null, menus: null, npcDialog: null, minimap: null };
    this.commands = null;
  }

  nextNetId() { return this._netId++; }

  init() {
    Sprites.init();
    this.audio.applyVolumes(this.settings);
    this.audio.playMenuMusic();
    this.ui.hud = new HUD(this);
    this.ui.menus = new Menus(this);
    this.ui.npcDialog = new NpcDialog(this);
    this.ui.minimap = new MinimapUI(this);
    this.commands = new CommandConsole(this);
    this._wireInputActions();
    this.ui.menus.refreshContinue(); // reflect any existing saves on first paint
    this._resize();
    this.camera.setZoom(this.settings.zoom); // restore the saved zoom level
    window.addEventListener('resize', () => this._resize());

    const mode = s_or(detectDefaultMode(), this.saves.readSettings().controlMode);
    applyControlMode(this, mode);

    // Invite link?
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) {
      this.ui.menus.hideMainMenu();
      this.ui.menus.show('mpMenu');
      document.getElementById('joinCodeInput').value = room.toUpperCase();
      this.ui.menus.setMpStatus('Ready to join room ' + room.toUpperCase() + ' — press Join.');
    }

    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _wireInputActions() {
    const inp = this.input;
    inp.on('inventory', () => { if (this.state === 'playing') this.ui.menus.toggleInventory(); });
    inp.on('pause', () => this._handleEscape());
    inp.on('escapeWhileTyping', () => { const a = document.activeElement; if (a) a.blur(); });
    inp.on('chat', () => { if (this.net) { const ci = document.getElementById('chatInput'); if (ci) ci.focus(); } });
    inp.on('commandPanel', () => { if (this.state === 'playing') this.openCommandPanel(); });
    inp.on('hotbar', (i) => this.selectHotbar(i));
    inp.on('hotbarScroll', (d) => { if (this.localPlayer) { let n = (this.localPlayer.inventory.selected + d + HOTBAR_SIZE) % HOTBAR_SIZE; this.selectHotbar(n); } });
    inp.on('zoomStep', (d) => this.nudgeZoom(d));
    inp.on('map', () => { if (this.state === 'playing') this.ui.minimap.toggle(); });
    inp.on('interact', () => this.interact());
    inp.on('smartToggle', () => { /* the input layer owns the latch; nothing else to do */ });
  }

  // Escape resolves one layer at a time, outermost first, so it never both
  // closes a dialog and pauses the game in a single press.
  // Point the minimap at the current world and subscribe it to tile edits, so
  // mining or building repaints just the affected chunk.
  _attachMinimap() {
    this.minimap.attach(this.world);
    this.world.onTileChanged = (tx, ty) => this.minimap.markTile(tx, ty);
  }

  _handleEscape() {
    const m = this.ui.menus;
    if (this.commands.isOpen()) { this.commands.close(); return; }
    if (m.isOpen('minimapDialog')) { m.hide('minimapDialog'); return; }
    if (m.isOpen('npcDialog')) { if (this.ui.npcDialog) this.ui.npcDialog.close(); else m.hide('npcDialog'); return; }
    if (m.isOpen('settingsDialog')) { m.hide('settingsDialog'); return; }
    if (m.isOpen('howtoDialog')) { m.hide('howtoDialog'); return; }
    if (m.isOpen('claudeNotesDialog')) { m.hide('claudeNotesDialog'); return; }
    if (m.isOpen('confirmDialog')) { m.hide('confirmDialog'); return; }
    if (m.invOpen) { m.closeInventory(); return; }
    if (m.isOpen('newWorldDialog') || m.isOpen('loadWorldDialog') || m.isOpen('mpMenu')) { m.hide('newWorldDialog'); m.hide('loadWorldDialog'); m.hide('mpMenu'); return; }
    if (this.state === 'playing') this.setPaused(!this.paused);
  }

  // Mobile has no keyboard, so the Talk prompt is a real button that appears
  // only while the Guide is actually within range.
  _updateTalkButton() {
    const el = document.getElementById('mbTalk');
    if (!el) return;
    const show = this.controlMode === 'mobile' && this.npc && this.localPlayer &&
      this.npc.canTalkTo(this.localPlayer) &&
      !(this.ui.npcDialog && this.ui.npcDialog.isOpen());
    el.classList.toggle('hidden', !show);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = w; this.canvas.height = h;
    this.camera.resize(w, h);
  }

  // ============ MAIN LOOP ============
  _loop(ts) {
    let dt = (ts - this._last) / 1000;
    this._last = ts;
    if (dt > 0.05) dt = 0.05;

    try {
      if (this.state === 'playing' && !this.paused && !this._simFrozen()) {
        this._acc = (this._acc || 0) + dt;
        let steps = 0;
        while (this._acc >= SIM_DT && steps < 5) { this._step(SIM_DT); this._acc -= SIM_DT; steps++; }
      } else {
        this._acc = 0; // don't bank time while frozen, or it fast-forwards on resume
      }

      if (this.state !== 'playing') {
        // The simulation is what normally drives audio, so keep the soundtrack
        // ticking in the menu too.
        this.audio.update(this, dt);
      }

      if (this.state === 'playing') {
        this.renderer.draw(this);
        // Render-rate, cosmetic work: reveal what the camera can see and
        // repaint any chunks that changed, then draw the widget / expanded map.
        this.minimap.update(dt, this);
        this.ui.minimap.draw();
        this.ui.hud.update();
        this._updateTalkButton();
        this.ui.menus.tick(dt);
        this._autosaveTick(dt);
        // death screen toggle
        if (this.localPlayer && !this.localPlayer.alive && !this.ui.menus.isOpen('deathScreen')) this.ui.menus.showDeath();
      }
    } catch (err) {
      // One bad entity or snapshot must not terminate requestAnimationFrame
      // permanently. Reset the accumulator so recovery never fast-forwards the
      // world, and surface a throttled notice for debugging/playtesting.
      this._acc = 0;
      this._reportRuntimeFault(err);
    } finally {
      requestAnimationFrame(this._loop);
    }
  }

  _reportRuntimeFault(err) {
    console.error('[Summoner Realms] recovered from a frame error', err);
    const now = performance.now();
    if (!this._runtimeFaultAt || now - this._runtimeFaultAt > 2000) {
      this._runtimeFaultAt = now;
      try { this.toast('Recovered from a temporary game hiccup.', 'bad'); } catch {}
    }
  }

  _step(dt) {
    if (this._placeFailCd > 0) this._placeFailCd -= dt;
    // Aim resolve needs local player centre.
    const lc = this.localPlayer ? this.localPlayer.center() : { x: 0, y: 0 };
    this.input.resolveAim(lc.x, lc.y, this.canvas.width, this.canvas.height);

    // Resolve the Smart Cursor target once per step so the renderer, the
    // placement preview and the action code all agree on one tile.
    this.smartTarget = this.localPlayer && this.localPlayer.alive
      ? smartTarget(this, this.localPlayer, this.localPlayer.inventory.selectedItem())
      : null;

    this.time.update(dt);
    this.weather.update(dt);
    this.audio.update(this, dt);

    // Players
    for (const p of [...this.players.values()]) p.update(dt, this);

    if (this.isHost) {
      this.spawner.update(dt, this);
      for (const e of this.enemies.slice()) { if (!e.ghost) { e.update(dt, this); e.tickEffects && e.tickEffects(dt, this); } }
      for (const b of this.bosses.slice()) if (!b.ghost) b.update(dt, this);
      for (const d of this.drops.slice()) if (!d.ghost) d.update(dt, this);
    } else {
      sync.interpolateGhosts(this, dt);
      this._clientDropPickup(dt);
      for (const d of this.drops.slice()) if (d.localOnly) d.update(dt, this);
    }

    // Guide NPC
    if (this.npc) this.npc.update(dt, this);
    this._updateBobbers(dt);

    // Minions (local only)
    for (const m of this.minions.slice()) m.update(dt, this);

    // Projectiles: use a stable batch because impact bursts append new
    // projectiles while the current batch is being simulated.
    for (const pr of this.projectiles.slice()) pr.update(dt, this);

    // Thrown items (bombs, shurikens, …)
    for (const t of this.thrown.slice()) t.update(dt, this);

    // Cleanup dead
    this.enemies = this.enemies.filter(e => { if (e.dead) { this.enemyById.delete(e.netId); return false; } return true; });
    if (this.isHost) this.bosses = this.bosses.filter(b => !b.dead);
    this.minions = this.minions.filter(m => !m.dead);
    this.projectiles = this.projectiles.filter(p => !p.dead);
    this.drops = this.drops.filter(d => !d.dead);
    this.thrown = this.thrown.filter(t => !t.dead);

    // Particles & float text
    this._updateParticles(dt);

    // Camera
    if (this.localPlayer) this.camera.follow(this.localPlayer, dt);

    // Net
    if (this.net) sync.netTick(this, dt);

    this.input.lateUpdate();
  }

  _clientDropPickup(dt) {
    const p = this.localPlayer; if (!p || !p.alive) return;
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (const d of this.drops) {
      if (!d.ghost) continue;
      const dcx = d.x + 5, dcy = d.y + 5;
      const dd = dist2(pcx, pcy, dcx, dcy);
      if (dd < 60 * 60) { const a = Math.atan2(pcy - dcy, pcx - dcx); d.x += Math.cos(a) * 200 * dt; d.y += Math.sin(a) * 200 * dt; }
      if (dd < 22 * 22 && !d.requested) { d.requested = true; this.net.toHost({ t: MSG.PICKUP, netId: d.netId }); }
    }
  }

  _updateParticles(dt) {
    this.fx.step(dt); // particles, rings and screen shake
    for (const ft of this.floatTexts) { ft.y += ft.vy * dt; ft.life -= dt; }
    this.floatTexts = this.floatTexts.filter(f => f.life > 0);
    for (const t of this.fallingTrees) t.update(dt);
    this.fallingTrees = this.fallingTrees.filter(t => !t.dead);
  }

  // Can the player move and use items right now? The inventory deliberately
  // does *not* block this — in Terraria the world keeps running and you keep
  // playing with your bag open. Blocking dialogs still do.
  canAct() {
    return this.state === 'playing' && !this.paused && this.localPlayer && this.localPlayer.alive
      && !this.ui.menus.anyBlockingModalOpen() && !this.input.isTyping();
  }

  // While these single-player overlays are open the world simulation is frozen
  // (see _loop) so enemies/bosses can't keep attacking you while you're in the
  // debug console or managing your inventory. A shared (networked) world can't be
  // frozen unilaterally, so it keeps running there.
  _simFrozen() {
    if (this.net) return false;
    // Only the debug console freezes the world. The inventory used to as well,
    // which is the opposite of how Terraria plays.
    return (this.commands && this.commands.isOpen());
  }

  // ============ WORLD LIFECYCLE ============
  _resetEntities() {
    this.players.clear(); this.enemies = []; this.enemyById.clear(); this.minions = [];
    this.bosses = []; this.projectiles = []; this.drops = []; this.dropById.clear();
    this.particles = []; this.rings = []; this.flashes = []; this.floatTexts = []; this.fallingTrees = []; this.thrown = [];
    this.bobbers = [];
    this.npc = null;
  }

  _seedFromString(str) {
    if (!str) return (Math.random() * 0xffffffff) >>> 0;
    if (/^\d+$/.test(str)) return parseInt(str, 10) >>> 0;
    return hashString(str);
  }

  startNewWorld(name, seedStr, difficulty = 'normal') {
    this.seed = this._seedFromString(seedStr);
    this.worldName = name;
    this.difficulty = normalizeDifficulty(difficulty);
    this.world = new World(this.seed);
    this._attachMinimap();
    this.progression = new Progression();
    this._resetEntities();
    this.time = new DayNight();
    this.weather = new Weather(this.seed);
    this._createLocalPlayer(true);
    this._spawnGuide(null);
    this.currentSaveId = this.saves.newId();
    this._enterPlaying();
    this.saveGame(false);
    this.toast('Welcome to ' + name + '!', 'good');
  }

  // Load the most recently played save (Main Menu "Continue" button).
  continueGame() {
    const saves = this.saves.list();
    if (!saves.length) { this.toast('No saved worlds yet', 'bad'); return; }
    this.loadWorldSlot(saves[0].id);
  }

  loadWorldSlot(id) {
    const data = this.saves.read(id);
    if (!data) { this.toast('Save not found', 'bad'); return; }
    this.seed = data.seed;
    this.worldName = data.name;
    this.difficulty = normalizeDifficulty(data.difficulty);
    this.world = new World(this.seed);
    this._attachMinimap();
    this.world.applyDiffArray(data.diffs);
    this.world.applyWallDiffArray(data.wallDiffs);
    this.progression = new Progression();
    this.progression.deserialize(data.progression);
    this.minimap.deserialize(data.explored);
    this._resetEntities();
    this.time = new DayNight(data.time || 0, data.day || 1);
    this.weather = new Weather(this.seed);
    this.weather.deserialize(data.weather);
    this._createLocalPlayer(false);
    this._spawnGuide(data.npc);
    const pd = data.player;
    if (pd) {
      this.localPlayer.x = pd.x; this.localPlayer.y = pd.y;
      this.localPlayer.inventory.deserialize(pd.inventory);
      this.localPlayer.recomputeStats();
      this.localPlayer.hp = pd.hp != null ? pd.hp : this.localPlayer.maxHp;
      this.localPlayer.mana = pd.mana != null ? pd.mana : this.localPlayer.maxMana;
    }
    this.currentSaveId = id;
    this._enterPlaying();
    this.toast('Loaded ' + data.name, 'good');
  }

  // The Guide NPC that keeps the player company from world creation onward.
  // Implemented in js/entities/npc.js; see _spawnGuide's body for the lifecycle.
  _spawnGuide(saved) {
    this.npc = null;
    if (!this.world) return;
    this.npc = Npc.create(this, saved);
  }

  _createLocalPlayer(fresh) {
    const p = new Player(this.selfId, { name: this.playerName, color: this.playerColor, isLocal: true });
    if (fresh) { p.inventory = starterInventory(); }
    p.recomputeStats();
    p.hp = p.maxHp; p.mana = p.maxMana;
    const tx = Math.floor(this.world.spawnX / TILE);
    p.x = this.world.spawnX; p.y = this.world.spawnPixelY(tx, p.h);
    this.localPlayer = p;
    this.players.set(p.id, p);
  }

  startClientWorld(seed, name, diffs, time, progression, wallDiffs, day = 1, difficulty = 'normal') {
    this.seed = seed; this.worldName = name || 'Realm';
    this.difficulty = normalizeDifficulty(difficulty);
    this.world = new World(seed);
    this._attachMinimap();
    this.world.applyDiffArray(diffs);
    this.world.applyWallDiffArray(wallDiffs);
    this.progression = new Progression();
    this.progression.deserialize(progression);
    this.enemies = []; this.enemyById.clear(); this.minions = []; this.bosses = [];
    this.projectiles = []; this.drops = []; this.dropById.clear(); this.particles = []; this.rings = []; this.flashes = []; this.floatTexts = [];
    this.fallingTrees = []; this.thrown = [];
    // keep players map empty except local (added here)
    this.players.clear();
    this.time = new DayNight(time || 0, day || 1);
    this.weather = new Weather(this.seed);
    this._createLocalPlayer(true);
    this._spawnGuide(null);
    this.currentSaveId = null; // clients never autosave the host's world
    this._enterPlaying();
    this.toast('Joined ' + this.worldName, 'good');
  }

  _enterPlaying() {
    this.state = 'playing';
    this.paused = false;
    this.ui.menus.hideMainMenu();
    this.ui.menus.hidePause();
    this.ui.menus.hideDeath();
    this.ui.hud.show();
    applyControlMode(this, this.controlMode);
    this.camera.follow(this.localPlayer, 0, true);
    setSaveIndicator('saved');
    this.dirty = false;
  }

  quitToMenu() {
    if (this.currentSaveId && !this.net) this.saveGame(false);
    if (this.net) this.leaveServer();
    this.state = 'menu';
    this.paused = false;
    this.ui.hud.hide();
    this.ui.menus.hidePause();
    this.ui.menus.closeInventory();
    if (this.ui.npcDialog) this.ui.npcDialog.close();
    // applyControlMode owns whether the touch controls are visible; it hides
    // them because we are no longer 'playing'.
    applyControlMode(this, this.controlMode);
    this.ui.menus.showMainMenu();
  }

  resetWorld() {
    if (!this.world) return;
    const inv = this.localPlayer.inventory;
    this.world = new World(this.seed);
    this._attachMinimap();
    this._resetEntities();               // clears enemies, bosses, drops, minions, projectiles
    this.time = new DayNight();           // fresh morning, not whatever time it was
    this.localPlayer.inventory = inv;
    this.players.set(this.localPlayer.id, this.localPlayer);
    this._spawnGuide(null);
    const tx = Math.floor(this.world.spawnX / TILE);
    this.localPlayer.x = this.world.spawnX; this.localPlayer.y = this.world.spawnPixelY(tx, this.localPlayer.h);
    this.localPlayer.vx = 0; this.localPlayer.vy = 0;
    this.localPlayer.alive = true;
    this.localPlayer.hp = this.localPlayer.maxHp; this.localPlayer.mana = this.localPlayer.maxMana;
    this.localPlayer.buffs = [];
    this.camera.follow(this.localPlayer, 0, true);
    this.setPaused(false);
    this.markDirty();
    this.toast('World reset from seed', 'info');
  }

  resetDemo() {
    this.progression = new Progression();
    this.startNewWorld(this.worldName || 'Realm', String(this.seed), this.difficulty);
    this.toast('Demo world reset', 'info');
  }

  // ============ SAVE ============
  buildSaveData() {
    const p = this.localPlayer;
    return {
      version: SAVE_VERSION, name: this.worldName, seed: this.seed, difficulty: this.difficulty, time: this.time.t, day: this.time.day, weather: this.weather.serialize(),
      width: this.world.width, height: this.world.height,
      diffs: this.world.getDiffArray(),
      wallDiffs: this.world.getWallDiffArray(),
      progression: this.progression.serialize(),
      explored: this.minimap.serialize(),
      player: { x: p.x, y: p.y, hp: p.hp, mana: p.mana, inventory: p.inventory.serialize() },
      npc: this.npc ? this.npc.serialize() : null,
    };
  }

  saveGame(manual) {
    if (!this.world || !this.currentSaveId) return;
    if (this.net && !this.isHost) { if (manual) this.toast('Only the host can save the shared world', 'bad'); return; }
    setSaveIndicator('saving');
    const okSave = this.saves.write(this.currentSaveId, this.buildSaveData());
    this.dirty = false;
    setTimeout(() => setSaveIndicator(okSave ? 'saved' : 'unsaved'), 250);
    if (manual) this.toast(okSave ? 'Game saved' : 'Save failed', okSave ? 'good' : 'bad');
  }

  _autosaveTick(dt) {
    if (!this.currentSaveId || (this.net && !this.isHost)) return;
    this._autosaveTimer -= dt;
    if (this._autosaveTimer <= 0) { this._autosaveTimer = AUTOSAVE_INTERVAL; if (this.dirty) this.saveGame(false); }
  }

  deleteSave(id) {
    this.saves.remove(id);
    if (id === this.currentSaveId) this.currentSaveId = null;
    this.toast('Save deleted', 'info');
  }

  markDirty() { if (!this.dirty && !(this.net && !this.isHost)) { this.dirty = true; setSaveIndicator('unsaved'); } }
  saveStateText() { return this.dirty ? 'Unsaved changes' : 'All changes saved'; }

  onMenuOpened() {
    // Autosave when entering a menu.
    if (this.state === 'playing' && this.dirty) this.saveGame(false);
  }

  saveSettings() {
    this.saves.writeSettings(Object.assign({
      name: this.playerName,
      colorIndex: this.playerColorIndex,
      controlMode: this.controlMode,
    }, this.settings));
  }
  setSetting(key, value) {
    this.settings[key] = value;
    if (key === 'masterVolume' || key === 'musicVolume' || key === 'sfxVolume') this.audio.applyVolumes(this.settings);
    this.saveSettings();
  }
  cyclePlayerColor() { this.playerColorIndex = (this.playerColorIndex + 1) % 8; this.playerColor = assignColor(this.playerColorIndex); if (this.localPlayer) this.localPlayer.color = this.playerColor; this.saveSettings(); }
  setControlMode(mode) { applyControlMode(this, mode); this.saveSettings(); }

  // Zoom. Ctrl+wheel and +/- step it; the Settings slider sets it directly.
  setZoom(z) {
    this.settings.zoom = this.camera.setZoom(z);
    this.saveSettings();
    return this.settings.zoom;
  }
  nudgeZoom(dir) {
    const z = this.camera.nudgeZoom(dir);
    this.settings.zoom = z;
    this.saveSettings();
    this.toast('Zoom ' + Math.round(z * 100) + '%');
    return z;
  }

  // ============ UI GLUE ============
  setPaused(v) {
    this.paused = v;
    if (v) { this.ui.menus.showPause(); this.onMenuOpened(); }
    else this.ui.menus.hidePause();
  }
  openCommandPanel() { this.commands.open(); }
  // Clicking directly on the Guide is the other way in, alongside F / the
  // mobile Talk button.
  clickedNpc(worldX, worldY) {
    const n = this.npc;
    if (!n || !this.localPlayer) return false;
    if (worldX < n.x - 4 || worldX > n.x + n.w + 4 || worldY < n.y - 6 || worldY > n.y + n.h + 4) return false;
    if (!n.canTalkTo(this.localPlayer)) { this.toast('Too far away to talk', 'info'); return false; }
    this.ui.npcDialog.toggle(n);
    return true;
  }

  // Context action: talk to the Guide if we're standing next to them.
  interact() {
    if (this.state !== 'playing' || !this.localPlayer || !this.localPlayer.alive) return;
    if (this.npc && this.npc.canTalkTo(this.localPlayer) && this.ui.npcDialog) {
      this.ui.npcDialog.toggle(this.npc);
    }
  }
  // Shared by the Esc key and the always-visible HUD ☰ button, so PC players have
  // a visible pause affordance (the review flagged that Esc was the only way).
  menuButton() { this._handleEscape(); }
  selectHotbar(i) { if (this.localPlayer) this.localPlayer.inventory.selected = Math.max(0, Math.min(HOTBAR_SIZE - 1, i)); }

  useInventoryItem(index) {
    const p = this.localPlayer; const s = p.inventory.slots[index];
    if (!s) return;
    const def = getItem(s.id);
    if (def.category === 'armor' || def.category === 'accessory') { p.inventory.equipFromSlot(index); p.recomputeStats(); this.markDirty(); }
    else if (def.category === 'potion') { this._consumePotionAt(p, index, def); }
    else { // move into selected hotbar slot
      if (index >= HOTBAR_SIZE) { p.inventory.swap(index, p.inventory.selected); }
      else { p.inventory.selected = index; }
    }
  }
  _consumePotionAt(p, index, def) {
    // Routes through the shared handler so the healing cooldown applies here too.
    applyPotion(this, p, index, def);
  }
  // Drag-and-drop between inventory slots, including on and off the equipment
  // slots. Illegal moves (a sword into a helmet slot) are simply refused.
  moveInventoryItem(src, dst) {
    const inv = this.localPlayer && this.localPlayer.inventory;
    if (!inv) return;
    const bag = (s) => s.kind === 'inv';

    if (bag(src) && bag(dst)) {
      if (inv.moveSlot(+src.index, +dst.index)) this.markDirty();
      return;
    }
    if (bag(src) && !bag(dst)) {
      const ref = inv.slots[+src.index];
      if (!ref || !inv.fitsEquip(dst.index, getItem(ref.id))) return;
      const cur = inv.getEquip(dst.index);
      inv.setEquip(dst.index, { id: ref.id, count: 1 });
      // Equipment holds one item, so anything beyond the first stays behind.
      if (ref.count > 1) { ref.count -= 1; if (cur) inv.add(cur.id, 1); }
      else inv.slots[+src.index] = cur || null;
      this.localPlayer.recomputeStats();
      this.markDirty();
      return;
    }
    if (!bag(src) && bag(dst)) {
      const ref = inv.getEquip(src.index);
      if (!ref) return;
      const target = inv.slots[+dst.index];
      if (target && !inv.fitsEquip(src.index, getItem(target.id))) return;
      inv.setEquip(src.index, target ? { id: target.id, count: 1 } : null);
      inv.slots[+dst.index] = { id: ref.id, count: 1 };
      this.localPlayer.recomputeStats();
      this.markDirty();
      return;
    }
    // Equipment to equipment: only if the item is legal in the destination.
    const ref = inv.getEquip(src.index);
    if (!ref || !inv.fitsEquip(dst.index, getItem(ref.id))) return;
    const cur = inv.getEquip(dst.index);
    if (cur && !inv.fitsEquip(src.index, getItem(cur.id))) return;
    inv.setEquip(dst.index, ref);
    inv.setEquip(src.index, cur || null);
    this.localPlayer.recomputeStats();
    this.markDirty();
  }

  dropInventoryItem(index) {
    const p = this.localPlayer; const s = p.inventory.slots[index];
    if (!s) return;
    const taken = p.inventory.removeAt(index, 1);
    if (taken) { this.spawnDrop(p.x + p.facing * 10, p.y, taken.id, taken.count); this.markDirty(); }
  }
  unequip(kind) {
    const p = this.localPlayer;
    if (kind.startsWith('acc')) p.inventory.unequip('acc', +kind.slice(3));
    else p.inventory.unequip(kind);
    p.recomputeStats(); this.markDirty();
  }
  craftRecipe(recipe) { craftSys.craft(this, this.localPlayer, recipe); this.localPlayer.recomputeStats(); }

  respawnLocal() {
    if (!this.localPlayer) return;
    // The death screen disables its button until the countdown ends; this is the
    // authoritative check, so a stray click or a script can't skip it either.
    if (this.localPlayer.respawnTimer > 0) return;
    this.localPlayer.respawn(this);
    // Clear leftover combat so you never respawn straight into a projectile or a
    // lingering damage state. (Bosses are already despawned on death below.)
    this.resetCombatState();
    this.ui.menus.hideDeath();
  }
  onLocalDeath(srcName) {
    this.ui.menus.showDeath(srcName ? 'Slain by ' + srcName : undefined);
    // Dying ends the encounter. The boss, its adds and its projectiles all
    // despawn, so respawning is a clean slate rather than a way to whittle a
    // boss down across lives — the summon item was already consumed, so
    // re-engaging costs another one.
    const anyAlive = [...this.players.values()].some(p => p.alive);
    this.ui.menus._deathWasBossFight = this.bosses.length > 0;
    if (!this.net || !anyAlive) {
      const had = this.bosses.length;
      this.clearBosses(true);
      this.resetCombatState();
      if (had) this.toast('The encounter ends. Summon it again to try once more.', 'info');
    }
  }

  // Remove every active boss plus the adds it spawned and any boss projectiles.
  clearBosses(silent) {
    if (!this.isHost) { if (!silent) this.toast('Only the host can clear bosses', 'bad'); return 0; }
    const n = this.bosses.length;
    this.bosses = [];
    this.enemies = this.enemies.filter(e => { if (e.fromBoss) { this.enemyById.delete(e.netId); return false; } return true; });
    this.projectiles = this.projectiles.filter(p => p.ownerType !== 'boss');
    if (n && !silent) this.toast(n + ' boss' + (n > 1 ? 'es' : '') + ' cleared', 'info');
    this.markDirty();
    return n;
  }

  // Wipe transient combat: all projectiles, particles, and float texts, and the
  // local player's hit/knockback state. Used on death/respawn and by /resetcombat.
  resetCombatState() {
    this.projectiles = [];
    this.thrown = [];
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.floatTexts = [];
    const p = this.localPlayer;
    if (p) { p.iframes = Math.max(p.iframes, 1.5); p.kbTimer = 0; p.combatTimer = 0; p.hazardTimer = 0; }
  }

  // ============ COMBAT / ENTITY HELPERS ============
  addProjectile(proj, broadcast) {
    if (this.projectiles.length > MAX_PROJECTILES) this.projectiles.shift();
    this.projectiles.push(proj);
    if (broadcast && this.net && this.net.status === 'connected') {
      this.net.relay({ t: MSG.PROJFX, x: Math.round(proj.x), y: Math.round(proj.y), vx: Math.round(proj.vx), vy: Math.round(proj.vy), kind: proj.kind, color: proj.color, gravity: proj.gravity, life: proj.life });
    }
  }

  // Thrown items are simulated by whoever threw them and mirrored to everyone
  // else, the same way projectiles are. Explosion tile edits stay host-owned.
  addThrown(t, broadcast) {
    if (this.thrown.length > MAX_THROWN) this.thrown.shift();
    this.thrown.push(t);
    if (broadcast && this.net && this.net.status === 'connected') {
      this.net.relay(Object.assign({ t: MSG.THROW }, t.netState()));
    }
  }

  addHitParticles(x, y, color, count = 6) {
    this.fx.burst(x, y, color, count, { speed: 80, life: 0.45, size: 2 });
  }
  shake(mag, dur) { this.fx.shake(mag, dur); }
  floatText(x, y, text, color) { this.floatTexts.push({ x, y, text, color, vy: -34, life: 0.8, max: 0.8 }); }
  spawnSwingFx(player, angle, item) {
    const pc = player.center();
    for (let i = 0; i < 4; i++) {
      const a = angle + (Math.random() - 0.5) * (item.arc || 1.4);
      const r = (item.reach || 26) * (0.5 + Math.random() * 0.5);
      this.fx.push({ x: pc.x + Math.cos(a) * r, y: pc.y + Math.sin(a) * r, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 2, color: item.color, gravity: 0 });
    }
  }
  // Visible cast puff at the caster's hand so magic reads as an actual cast.
  spawnCastFx(player, angle, item) {
    const pc = player.center();
    const hx = pc.x + Math.cos(angle) * 12, hy = pc.y + Math.sin(angle) * 12;
    this.fx.streak(hx, hy, angle, item.projColor || item.color, 7, { speed: 50, spread: 1.2, life: 0.25, size: 2, glow: true });
  }
  // ---- Fishing ----
  bobberFor(playerId) { return this.bobbers.find(b => b.ownerId === playerId && !b.dead) || null; }

  _updateBobbers(dt) {
    for (const b of this.bobbers) {
      b.update(dt, this);
      if (b.bit) {
        b.bit = false;
        this.fx.ring(b.x, b.y, '#8fd0f0', 14, { life: 0.35, width: 2 });
        this.audio?.blockPlace();
        if (b.ownerId === this.selfId) this.toast('Something\u2019s biting!', 'good');
      }
      if (b.lostIt) {
        b.lostIt = false;
        if (b.ownerId === this.selfId) this.toast('It got away', 'bad');
      }
      if (b.missed) { b.missed = false; if (b.ownerId === this.selfId) this.toast('No water there', 'bad'); }
    }
    this.bobbers = this.bobbers.filter(b => !b.dead);
  }

  // Left-click with a rod casts; clicking again reels in. Reeling while a fish
  // is on lands the catch, otherwise you just get the line back.
  toggleFishing(player, rod) {
    const existing = this.bobberFor(player.id);
    if (existing) { this._reelIn(player, existing); return; }

    const bait = findBait(player);
    if (!bait) { this.toast('You need bait \u2014 catch a grub or an emberfly', 'bad'); return; }

    const pc = player.center();
    const s = this.input.state;
    const dx = s.aimX - pc.x, dy = s.aimY - pc.y;
    const len = Math.hypot(dx, dy) || 1;
    const b = new Bobber(player, pc.x, pc.y - 4, (dx / len) * 300, (dy / len) * 300 - 90);
    b.baitPower = bait.power;
    b.baitId = bait.id;
    this.bobbers.push(b);
    this.audio?.swordSwing();
  }

  _reelIn(player, b) {
    b.dead = true;
    if (!b.settled) return;
    if (b.hookTimer > 0) {
      // Landed it. The bait is consumed only on a successful catch.
      player.inventory.remove(b.baitId, 1);
      const id = rollCatch(this, b, b.baitPower || 1);
      const leftover = player.inventory.add(id, 1);
      if (leftover > 0) this.spawnDrop(player.x, player.y, id, leftover);
      const def = getItem(id);
      this.floatText(b.x, b.y - 8, '+1 ' + (def ? def.name : id), '#8fd0f0');
      this.fx.burst(b.x, b.y, '#8fd0f0', 10, { speed: 90, gravity: 200 });
      if (player.id === this.selfId) this.toast('Caught: ' + (def ? def.name : id), 'good');
    }
  }

  openCrateItem(player, item) {
    if (!player.inventory.remove(item.id, 1)) return;
    const got = openCrate(this, player, item);
    const names = got.map(g => g.n + ' ' + (getItem(g.id) ? getItem(g.id).name : g.id)).join(', ');
    this.toast('Crate: ' + (names || 'empty'), 'good');
    this.audio?.blockBreak();
  }

  spawnFallingTree(cells, tx, ty, dir) {
    this.fallingTrees.push(new FallingTree(cells, tx, ty, dir));
    if (this.fallingTrees.length > 16) this.fallingTrees.shift();
    // A shower of leaf/wood bits from the topple.
    this.addHitParticles(tx * TILE + TILE / 2, (ty - 2) * TILE, '#3e7a34', 10);
  }

  nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) { if (!p.alive) continue; const d = dist2(x, y, p.x + p.w / 2, p.y + p.h / 2); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  nearestHostileTarget(x, y) {
    const PLAYER_PRIORITY_RADIUS = 240;
    let nearestPlayer = null, nearestPlayerDist = Infinity;
    for (const p of this.players.values()) {
      if (!p || p.alive === false || p.dead) continue;
      const d = dist2(x, y, p.x + p.w / 2, p.y + p.h / 2);
      if (d < nearestPlayerDist) {
        nearestPlayerDist = d;
        nearestPlayer = p;
      }
    }

    // A nearby player remains the boss's immediate threat. The Heart is the
    // preferred target only when the player is outside this close-threat range.
    if (nearestPlayer && nearestPlayerDist <= PLAYER_PRIORITY_RADIUS * PLAYER_PRIORITY_RADIUS) {
      return nearestPlayer;
    }

    let heart = null, heartDist = Infinity;
    for (const m of this.minions) {
      if (!m || m.key !== 'diamondHeart' || m.alive === false || m.dead || m.maxHp == null) continue;
      const d = dist2(x, y, m.x + m.w / 2, m.y + m.h / 2);
      if (d < heartDist) { heartDist = d; heart = m; }
    }
    if (heart) return heart;

    let best = null, bd = Infinity;
    const consider = (t) => {
      if (!t || t.alive === false || t.dead) return;
      const d = dist2(x, y, t.x + t.w / 2, t.y + t.h / 2);
      if (d < bd) { bd = d; best = t; }
    };
    for (const p of this.players.values()) consider(p);
    if (this.npc) consider(this.npc);
    for (const m of this.minions) if (m.maxHp != null) consider(m);
    return best;
  }
  minDistToAnyPlayer(x, y) {
    let bd = Infinity;
    for (const p of this.players.values()) { if (!p.alive) continue; const d = dist2(x, y, p.x + p.w / 2, p.y + p.h / 2); if (d < bd) bd = d; }
    return bd;
  }
  nearestEnemyOrBoss(x, y, range) {
    let best = null, bd = range ? range * range : Infinity;
    for (const e of this.enemies) { const d = dist2(x, y, e.x + e.w / 2, e.y + e.h / 2); if (d < bd) { bd = d; best = e; } }
    for (const b of this.bosses) { const d = dist2(x, y, b.x + b.w / 2, b.y + b.h / 2); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  // Nearest enemy/boss with unobstructed line-of-sight from (x,y) — i.e. one a
  // minion can actually reach/hit rather than a target behind a wall.
  nearestReachableEnemyOrBoss(x, y, range) {
    let best = null, bd = range ? range * range : Infinity;
    const consider = (t) => {
      const tcx = t.x + t.w / 2, tcy = t.y + t.h / 2;
      const d = dist2(x, y, tcx, tcy);
      if (d < bd && this.world.hasLineOfSight(x, y, tcx, tcy)) { bd = d; best = t; }
    };
    for (const e of this.enemies) consider(e);
    for (const b of this.bosses) consider(b);
    return best;
  }

  hurtEnemy(e, dmg, kbx, kby, effect, ownerId, crit) {
    if (this.net && !this.isHost && e.netId != null) { this.net.toHost({ t: MSG.HIT_ENEMY, netId: e.netId, dmg, kbx, effect, crit }); e.hurtFlash = 0.1; return; }
    if (e.takeDamage) e.takeDamage(dmg, kbx, kby, this, effect, crit);
  }
  hurtBoss(b, dmg, ownerId, crit) {
    if (this.net && !this.isHost) { this.net.toHost({ t: MSG.HIT_BOSS, dmg, crit }); b.hurtFlash = 0.1; return; }
    if (b.takeDamage) b.takeDamage(dmg, this, crit);
  }
  hurtEnemyOrBoss(target, dmg, kb, ownerId, crit, effect) {
    if (this.bosses.includes(target)) this.hurtBoss(target, dmg, ownerId, crit);
    else this.hurtEnemy(target, dmg, kb, -1, effect, ownerId, crit);
  }
  applyEnemyDamageToPlayer(player, dmg, kbx) {
    if (player.isLocal) player.takeDamage(dmg, kbx, this);
    else if (this.isHost && this.net) this.net.toPeer(player.id, { t: MSG.HURT, dmg, kbx });
  }

  // ============ MINIONS ============
  summonMinion(player, key) {
    if (!player.isLocal) return;
    const cap = player.stats ? player.stats.minionCap : 1;
    // Retire the oldest living minions until there's a free summon slot.
    const mine = this.minions.filter(m => m.ownerId === player.id && !m.dead);
    while (mine.length >= cap) { mine.shift().dead = true; }
    const pc = player.center();
    const minion = new Minion(key, player.id, pc.x, pc.y - 30);
    this.minions.push(minion);
    this.toast('Summoned ' + (minion.def?.name || key), 'good');
    this.addHitParticles(pc.x, pc.y - 20, '#c58bff', 8);
  }
  removeMinionsOf(id) { for (const m of this.minions) if (m.ownerId === id) m.dead = true; }

  // ============ ENEMIES / BOSSES (host) ============
  spawnEnemy(key, x, y) {
    if (!this.isHost) return null;
    if (this.enemies.length > 60) return null;
    const e = new Enemy(key, x, y, this.nextNetId(), this.difficulty);
    this.enemies.push(e); this.enemyById.set(e.netId, e);
    return e;
  }
  spawnBossAdds(key, count, x, y) {
    for (let i = 0; i < count; i++) { const e = this.spawnEnemy(key, x + (Math.random() - 0.5) * 80, y - 20); if (e) e.fromBoss = true; }
  }
  spawnBossByKey(key) {
    if (!this.isHost) return;
    if (this.bosses.length) { this.toast('A boss is already present', 'bad'); return; }
    const def = BOSSES[key];
    const anchor = this.nearestPlayer(this.localPlayer ? this.localPlayer.x : 0, this.localPlayer ? this.localPlayer.y : 0) || this.localPlayer;
    let bx = anchor ? anchor.x : this.world.spawnX;
    let by = anchor ? anchor.y - 140 : this.world.spawnY - 140;
    if (def.movement === 'gravemaw') by = anchor ? anchor.y - def.h : by;
    // Never materialise inside terrain — search outward for clear air first, so
    // a boss summoned in a tight cave doesn't start the fight embedded in rock.
    const spot = this._findClearSpot(bx, by, def.w, def.h);
    bx = spot.x; by = spot.y;
    const b = new Boss(key, bx, by, this.difficulty);
    this.bosses.push(b);
    this.toast(def.name + ' has appeared!', 'bad');
    this.addHitParticles(bx + b.w / 2, by + b.h / 2, def.color2, 24);
    if (this.net && this.isHost) this.net.broadcast({ t: MSG.EVENT, kind: 'bossSpawn', name: def.name });
    this.markDirty();
  }
  // Nearest position to (x,y) where a w x h box fits in open air. Spirals
  // outward in tile steps and gives up on the original spot if nothing fits.
  _findClearSpot(x, y, w, h) {
    if (!this.world.rectHitsSolid(x, y, w, h)) return { x, y };
    for (let r = 1; r <= 14; r++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = x + dx * r * TILE, ny = y + dy * r * TILE;
        if (!this.world.rectHitsSolid(nx, ny, w, h)) return { x: nx, y: ny };
      }
    }
    return { x, y };
  }

  trySummonBoss(key, player, itemId) {
    const def = BOSSES[key];
    const tx = Math.floor((player.x + player.w / 2) / TILE), ty = Math.floor((player.y + player.h / 2) / TILE);
    const biome = this.world.biomeAt(tx, ty);
    const okBiome = (def.biome === 'underground') ? (biome === 'underground' || biome === 'cavern') : (biome === def.biome);
    if (!okBiome) { this.toast('Must be summoned in the ' + this.biomeLabel(def.biome) + '!', 'bad'); return; }
    if (this.bosses.length) { this.toast('A boss is already present', 'bad'); return; }
    if (!player.inventory.remove(itemId, 1)) { this.toast('You need a ' + getItem(itemId).name, 'bad'); return; }
    if (this.isHost) this.spawnBossByKey(key);
    else this.net.toHost({ t: MSG.CMD, cmd: 'spawnboss', args: { key } });
    this.toast('The ground trembles…', 'info');
  }
  biomeLabel(b) { return b === 'forest' ? 'Forest' : b === 'corrupt' ? 'Corrupted Lands' : 'Underground'; }

  onEnemyDeath(e) {
    if (!this.isHost) return;
    this.addHitParticles(e.x + e.w / 2, e.y + e.h / 2, e.color, 12);
    const def = ENEMIES[e.key];
    for (const drop of def.drops || []) {
      if (Math.random() <= drop.chance) {
        const n = drop.min + ((Math.random() * (drop.max - drop.min + 1)) | 0);
        if (n > 0) this.spawnDrop(e.x + e.w / 2, e.y, drop.item, n);
      }
    }
  }
  onBossDeath(b) {
    if (!this.isHost) return;
    // A boss that fled its arena was never defeated: no progression, no loot.
    if (b.fled) {
      this.enemies = this.enemies.filter(e => { if (e.fromBoss) { this.enemyById.delete(e.netId); return false; } return true; });
      this.projectiles = this.projectiles.filter(p => p.ownerType !== 'boss');
      return;
    }
    const def = BOSSES[b.key];
    this.progression.defeatBoss(b.key);
    for (const drop of def.loot || []) {
      if (Math.random() <= drop.chance) {
        const n = drop.min + ((Math.random() * (drop.max - drop.min + 1)) | 0);
        for (let i = 0; i < n; i++) this.spawnDrop(b.x + b.w / 2 + (Math.random() - 0.5) * 40, b.y + b.h / 2, drop.item, 1);
      }
    }
    // clear boss adds
    this.enemies = this.enemies.filter(e => { if (e.fromBoss) { this.enemyById.delete(e.netId); return false; } return true; });
    this.toast(def.name + ' defeated!', 'good');
    if (this.net && this.isHost) { this.net.broadcast({ t: MSG.EVENT, kind: 'bossDefeat', key: b.key, name: def.name }); }
    this.markDirty();
    this.saveGame(false);
  }

  killAllEnemies() {
    for (const e of [...this.enemies]) if (e.takeDamage) e.takeDamage(99999, 0, 0, this);
  }
  setTime(t) { if (t === 'day') this.time.setDay(); else this.time.setNight(); }
  teleportBiome(biome) {
    const p = this.localPlayer; if (!p) return;
    let tx, ty;
    if (biome === 'cavern') { tx = Math.floor(this.world.width * 0.4); ty = this._findAir(tx, CAVERN_Y + 6); }
    else if (biome === 'underground') { tx = Math.floor(this.world.width * 0.3); ty = this._findAir(tx, UNDERGROUND_Y + 8); }
    else { tx = this.world.findBiomeColumn(biome); ty = this.world.safeSpawnY(tx) - 2; }
    p.x = tx * TILE; p.y = ty * TILE; p.vx = 0; p.vy = 0;
    this.camera.follow(p, 0, true);
  }
  _findAir(tx, startY) {
    for (let y = startY; y < this.world.height - 3; y++) if (!this.world.isSolidAt(tx, y) && !this.world.isSolidAt(tx, y + 1)) return y;
    return startY;
  }

  // ============ DROPS ============
  spawnDrop(x, y, itemId, count) {
    const d = new DropItem(this.nextNetId(), itemId, count, x, y);
    if (this.net && !this.isHost) d.localOnly = true;
    this.drops.push(d); this.dropById.set(d.netId, d);
  }
  pickupDrop(drop, player) {
    if (drop.ghost) { if (!drop.requested) { drop.requested = true; this.net.toHost({ t: MSG.PICKUP, netId: drop.netId }); } return; }
    if (this.isHost || !this.net) this.grantDropTo(player.id, drop);
    else { // client local drop
      player.inventory.add(drop.itemId, drop.count); this.playPickupSound(drop.itemId);
      drop.dead = true; this.dropById.delete(drop.netId);
      this.floatText(drop.x, drop.y, '+' + drop.count, '#7ee0c0');
    }
  }
  grantDropTo(playerId, drop) {
    const player = this.players.get(playerId);
    drop.dead = true; this.dropById.delete(drop.netId);
    if (!player) return;
    if (player.isLocal) { player.inventory.add(drop.itemId, drop.count); this.playPickupSound(drop.itemId); this.floatText(drop.x, drop.y, '+' + drop.count, '#7ee0c0'); this.markDirty(); }
    else if (this.net) this.net.toPeer(playerId, { t: MSG.GRANT, item: drop.itemId, count: drop.count });
  }

  netEditTile(tx, ty, id) {
    if (!this.net || this.net.status !== 'connected') return;
    const msg = { t: MSG.TILE_EDIT, tx, ty, id };
    if (this.isHost) this.net.broadcast(msg); else this.net.toHost(msg);
  }
  netEditWall(tx, ty, id) {
    if (!this.net || this.net.status !== 'connected') return;
    const msg = { t: MSG.WALL_EDIT, tx, ty, id };
    if (this.isHost) this.net.broadcast(msg); else this.net.toHost(msg);
  }

  toast(msg, kind) { this.ui.hud.toast(msg, kind); }

  playPickupSound(itemId) {
    this.audio?.itemPickup();
    if (/coin|gold|silver|copper/i.test(String(itemId))) this.audio?.coin();
  }

  // ============ COMMANDS ============
  hostCommand(cmd, args) {
    if (this.isHost) this.execHostCommand(cmd, args, this.selfId);
    else this.net.toHost({ t: MSG.CMD, cmd, args });
  }
  execHostCommand(cmd, args, fromId) {
    if (!this.isHost) return;
    if (cmd === 'spawn') {
      const p = this.players.get(fromId) || this.localPlayer;
      for (let i = 0; i < (args.count || 1); i++) this.spawnEnemy(args.key, p.x + (Math.random() < 0.5 ? -180 : 180), p.y - 40);
    } else if (cmd === 'spawnboss') { this.spawnBossByKey(args.key); }
    else if (cmd === 'killall') { this.killAllEnemies(); }
    else if (cmd === 'time') { this.setTime(args.t); }
  }

  // ============ MULTIPLAYER ============
  createServer(difficulty = 'normal') {
    // Hosting from the menu used to fall through to startNewWorld's default,
    // so a hosted world was always Normal with no way to choose. An already
    // loaded world keeps its own difficulty.
    if (this.state !== 'playing') this.startNewWorld('Realm', '', difficulty);
    if (this.net) { this.toast('Already connected', 'bad'); return; }
    this.net = new Net(this);
    this.isHost = true;
    this.ui.menus.setMpStatus('Starting server…');
    this.net.host((code) => {
      this._setLocalId(this.net.hostId);
      this.ui.menus.hide('mpMenu');
      this.ui.menus.showMpSidebar();
      this.ui.menus.setRoomLabel(code);
      this.ui.menus.refreshPlayerList();
      this.ui.menus.addChat(null, null, 'Server started. Room code: ' + code, true);
      this.toast('Hosting room ' + code, 'good');
    });
  }
  joinRoom(code) {
    if (this.net) { this.toast('Already connected', 'bad'); return; }
    this.net = new Net(this);
    this.isHost = false;
    this.ui.menus.setMpStatus('Connecting to ' + code + '…');
    this.net.join(code, () => {
      this.ui.menus.hide('mpMenu');
      this.ui.menus.hideMainMenu();
      this.ui.menus.showMpSidebar();
      this.ui.menus.setRoomLabel(code);
      this.ui.menus.addChat(null, null, 'Connected to room ' + code, true);
    });
  }
  _setLocalId(newId) {
    if (!this.localPlayer) return;
    const old = this.localPlayer.id;
    this.players.delete(old);
    this.localPlayer.id = newId;
    this.selfId = newId;
    this.players.set(newId, this.localPlayer);
  }
  leaveServer() {
    if (!this.net) { this.toast('Not connected', 'bad'); return; }
    this.net.leave();
    this.net = null;
    this.isHost = true;
    this.ui.menus.hideMpSidebar();
    this.toast('Left the server', 'info');
    // Drop remote players & ghosts; keep local world.
    for (const id of [...this.players.keys()]) if (id !== this.selfId) this.players.delete(id);
    this.enemies = this.enemies.filter(e => !e.ghost); this.bosses = this.bosses.filter(b => !b.ghost);
    this.drops = this.drops.filter(d => !d.ghost);
  }
  copyInviteLink() {
    if (!this.net || !this.net.roomCode) { this.toast('Not hosting', 'bad'); return; }
    const url = location.origin + location.pathname + '?room=' + this.net.roomCode;
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => this.toast('Invite link copied!', 'good'), () => this.toast(url, 'info'));
    else this.toast(url, 'info');
  }
  sendChat(text) {
    const msg = { t: MSG.CHAT, name: this.playerName, color: this.playerColor, text };
    this.ui.menus.addChat(this.playerName, this.playerColor, text, false);
    if (this.net) this.net.relay(msg);
  }

  handleNetMessage(fromId, msg, conn) {
    try {
      sync.handleMessage(this, fromId, msg, conn);
    } catch (err) {
      this._reportRuntimeFault(err);
    }
  }
  onClientLeave(id) {
    const p = this.players.get(id);
    if (p) { this.ui.menus.addChat(null, null, p.name + ' left', true); this.toast(p.name + ' left', 'info'); }
    this.players.delete(id);
    this.removeMinionsOf(id);
    this.ui.menus.refreshPlayerList();
  }
  onJoinError(msg) {
    this.ui.menus.setMpStatus(msg);
    this.toast(msg, 'bad');
    if (this.net) { this.net.leave(); this.net = null; }
    this.isHost = true;
  }
  onHostLost() {
    this.toast('Disconnected from host', 'bad');
    this.leaveServer();
    this.quitToMenu();
  }
  handleNetEvent(msg) {
    if (msg.kind === 'bossDefeat') { this.progression.defeatBoss(msg.key); this.toast(msg.name + ' defeated!', 'good'); }
    else if (msg.kind === 'bossSpawn') { this.toast(msg.name + ' has appeared!', 'bad'); }
    else if (msg.kind === 'toast') { this.toast(msg.text, msg.tkind || 'info'); }
  }
}

function s_or(a, b) { return b || a; }

// ---- Boot ----
const game = new Game();
window.__game = game; // test hook
game.init();
