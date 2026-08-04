// Summoner Realms — localStorage save/load with named slots + save indicator.
import {
  SAVE_PREFIX, SAVE_INDEX_KEY, SETTINGS_KEY, SAVE_VERSION, LEGACY_WORLD_W,
  CHAR_PREFIX, CHAR_INDEX_KEY, CHAR_VERSION, LAST_CHAR_KEY,
} from './config.js?v=worm-surface-4';

// Upgrade a save to the current format.
//
// v1 stored tile edits as flat `ty * width + tx` indices against a 420-wide
// world. The world is now 700 wide, so those indices would land somewhere
// completely different. v2 stores (x, y, id) triples instead, and legacy saves
// are converted using the old width so anything you built keeps its coordinates.
// Natural terrain around it regenerates with the new generator either way.
//
// v4 (4.1) adds the block-shape and liquid layers. Older saves simply have
// neither, which is exactly what an empty diff array means — so the upgrade is
// additive and a v3 world loads with every block full and every pool as
// worldgen placed it.
export function migrateSave(data) {
  if (!data || typeof data !== 'object') return null;
  const version = data.version || 1;
  const out = Object.assign({}, data, { difficulty: data.difficulty || 'normal' });
  if (version < SAVE_VERSION) { out.version = SAVE_VERSION; out.migratedFrom = version; }

  // v1 -> v2: flat indices become (x, y, id) triples against the old width.
  if (version < 2) {
    const legacy = data.diffs || [];
    const triples = [];
    for (let k = 0; k + 1 < legacy.length; k += 2) {
      const i = legacy[k], id = legacy[k + 1];
      triples.push(i % LEGACY_WORLD_W, Math.floor(i / LEGACY_WORLD_W), id);
    }
    out.diffs = triples;
    out.wallDiffs = [];
  }

  // v3 -> v4: the shape and liquid layers did not exist.
  if (!Array.isArray(out.shapeDiffs)) out.shapeDiffs = [];
  if (!Array.isArray(out.liquidDiffs)) out.liquidDiffs = [];
  if (out.weather == null) out.weather = null;
  if (!Array.isArray(out.explored)) out.explored = [];
  return out;
}

export class SaveManager {
  constructor() { this.currentId = null; }

  _index() {
    try { return JSON.parse(localStorage.getItem(SAVE_INDEX_KEY)) || []; }
    catch { return []; }
  }
  _writeIndex(idx) { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(idx)); }

  list() { return this._index().slice().sort((a, b) => b.updated - a.updated); }

  newId() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  write(id, data) {
    data.updated = Date.now();
    try {
      localStorage.setItem(SAVE_PREFIX + id, JSON.stringify(data));
    } catch (e) {
      console.warn('Save failed', e);
      return false;
    }
    const idx = this._index();
    const entry = { id, name: data.name, seed: data.seed, difficulty: data.difficulty || 'normal', updated: data.updated };
    const i = idx.findIndex(e => e.id === id);
    if (i >= 0) idx[i] = entry; else idx.push(entry);
    this._writeIndex(idx);
    return true;
  }

  read(id) {
    try { return migrateSave(JSON.parse(localStorage.getItem(SAVE_PREFIX + id))); }
    catch { return null; }
  }

  remove(id) {
    localStorage.removeItem(SAVE_PREFIX + id);
    this._writeIndex(this._index().filter(e => e.id !== id));
  }

  readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch { return {}; }
  }
  writeSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
//
// 4.1 splits characters out of worlds, the way Terraria does. A character owns
// its appearance, its inventory and equipment, and its achievements; a world
// owns terrain, time, weather and the map you have uncovered. Any character can
// be taken into any world, and progress made there comes back out with them.
//
// The migration is deliberately quiet: the first time this runs, the newest
// existing world's embedded player becomes a character called "Summoner", so
// nobody loses the inventory they had.

export const HAIR_STYLES = ['short', 'long', 'spiky', 'bald'];

// A palette rather than a colour picker: every option is legible against the
// game's terrain, which a free picker cannot promise.
export const LOOK_PALETTES = {
  skin: ['#f0c9a0', '#e0b088', '#c98f63', '#a4703f', '#7a4f2a', '#5a3a1e', '#f7ddc0', '#cfa9c0'],
  hair: ['#4a3a2a', '#20242c', '#8a5a2a', '#c9a26a', '#e8e4da', '#b1362f', '#7aa2ff', '#c58bff'],
  shirt: ['#7ee0c0', '#c58bff', '#ffcf6b', '#ff8b9a', '#8ad9ff', '#9ee07e', '#ff9a5a', '#b0a6ff'],
  pants: ['#2a2f45', '#4a3a2a', '#3a4a60', '#5a3a4a', '#2f4a35', '#544a2f', '#40384f', '#1c2130'],
  eyes: ['#222222', '#3a5a8a', '#3a7a4a', '#7a4a2a', '#5a3a7a', '#7a2a2a'],
};

export function defaultAppearance(index = 0) {
  const pick = (arr, i) => arr[i % arr.length];
  return {
    skin: pick(LOOK_PALETTES.skin, 0),
    hair: pick(LOOK_PALETTES.hair, index),
    hairStyle: HAIR_STYLES[index % HAIR_STYLES.length],
    shirt: pick(LOOK_PALETTES.shirt, index),
    pants: pick(LOOK_PALETTES.pants, index),
    eyes: pick(LOOK_PALETTES.eyes, 0),
  };
}

export function normalizeAppearance(a, index = 0) {
  const d = defaultAppearance(index);
  if (!a || typeof a !== 'object') return d;
  const ok = (v, list, fallback) => (list.includes(v) ? v : fallback);
  return {
    skin: ok(a.skin, LOOK_PALETTES.skin, d.skin),
    hair: ok(a.hair, LOOK_PALETTES.hair, d.hair),
    hairStyle: ok(a.hairStyle, HAIR_STYLES, d.hairStyle),
    shirt: ok(a.shirt, LOOK_PALETTES.shirt, d.shirt),
    pants: ok(a.pants, LOOK_PALETTES.pants, d.pants),
    eyes: ok(a.eyes, LOOK_PALETTES.eyes, d.eyes),
  };
}

export class CharacterManager {
  constructor() { this.migrated = false; }

  _index() {
    try { return JSON.parse(localStorage.getItem(CHAR_INDEX_KEY)) || []; }
    catch { return []; }
  }
  _writeIndex(idx) {
    try { localStorage.setItem(CHAR_INDEX_KEY, JSON.stringify(idx)); } catch {}
  }

  list() { return this._index().slice().sort((a, b) => b.updated - a.updated); }
  newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  create(name, appearance) {
    const id = this.newId();
    const count = this._index().length;
    const rec = {
      version: CHAR_VERSION,
      id,
      name: (name || 'Summoner').slice(0, 14),
      appearance: normalizeAppearance(appearance, count),
      inventory: null,          // null means "give the starter kit"
      achievements: { unlocked: {}, counters: {}, biomes: {} },
      created: Date.now(),
      updated: Date.now(),
      playtime: 0,
    };
    this.write(rec);
    return rec;
  }

  read(id) {
    try {
      const raw = JSON.parse(localStorage.getItem(CHAR_PREFIX + id));
      if (!raw) return null;
      raw.appearance = normalizeAppearance(raw.appearance);
      if (!raw.achievements) raw.achievements = { unlocked: {}, counters: {}, biomes: {} };
      return raw;
    } catch { return null; }
  }

  write(rec) {
    rec.updated = Date.now();
    try { localStorage.setItem(CHAR_PREFIX + rec.id, JSON.stringify(rec)); }
    catch (e) { console.warn('Character save failed', e); return false; }
    const idx = this._index();
    const entry = {
      id: rec.id, name: rec.name, updated: rec.updated,
      appearance: rec.appearance,
      achievements: Object.keys(rec.achievements.unlocked || {}).length,
    };
    const i = idx.findIndex(e => e.id === rec.id);
    if (i >= 0) idx[i] = entry; else idx.push(entry);
    this._writeIndex(idx);
    return true;
  }

  remove(id) {
    try { localStorage.removeItem(CHAR_PREFIX + id); } catch {}
    this._writeIndex(this._index().filter(e => e.id !== id));
    if (this.lastUsed() === id) this.setLastUsed(null);
  }

  lastUsed() {
    try { return localStorage.getItem(LAST_CHAR_KEY) || null; } catch { return null; }
  }
  setLastUsed(id) {
    try {
      if (id) localStorage.setItem(LAST_CHAR_KEY, id);
      else localStorage.removeItem(LAST_CHAR_KEY);
    } catch {}
  }

  /**
   * One-time migration from the pre-4.1 layout, where the player lived inside
   * the world save. The newest world's player becomes a character so nobody
   * opens 4.1 to an empty inventory; the world saves keep their embedded copy
   * untouched, so rolling back loses nothing either.
   */
  migrateFromWorlds(saveManager) {
    if (this._index().length > 0) return null;
    const worlds = saveManager.list();
    if (!worlds.length) return null;
    const newest = saveManager.read(worlds[0].id);
    if (!newest || !newest.player) return null;

    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
    const rec = this.create(settings.name || 'Summoner');
    rec.inventory = newest.player.inventory || null;
    // Boss defeats were world progression before; give the character credit for
    // the ones the newest world records, so an existing player's achievements
    // are not blank on first launch.
    const prog = newest.progression || {};
    const beaten = prog.bosses || prog.defeated || [];
    if (Array.isArray(beaten)) {
      for (const key of beaten) rec.achievements.unlocked[key] = Date.now();
    }
    this.write(rec);
    return rec;
  }
}

// Save indicator state: 'saved' | 'saving' | 'unsaved'
export function setSaveIndicator(state) {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  // Keep the shared `chip` styling and swap only the state class.
  el.className = 'chip ' + state;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved' : 'Saved';
}
