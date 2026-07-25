// Summoner Realms — localStorage save/load with named slots + save indicator.
import { SAVE_PREFIX, SAVE_INDEX_KEY, SETTINGS_KEY, SAVE_VERSION, LEGACY_WORLD_W } from './config.js';

// Upgrade a save to the current format.
//
// v1 stored tile edits as flat `ty * width + tx` indices against a 420-wide
// world. The world is now 700 wide, so those indices would land somewhere
// completely different. v2 stores (x, y, id) triples instead, and legacy saves
// are converted using the old width so anything you built keeps its coordinates.
// Natural terrain around it regenerates with the new generator either way.
export function migrateSave(data) {
  if (!data || typeof data !== 'object') return null;
  const version = data.version || 1;
  if (version >= SAVE_VERSION) return data;

  const out = Object.assign({}, data, { version: SAVE_VERSION, migratedFrom: version });
  const legacy = data.diffs || [];
  const triples = [];
  for (let k = 0; k + 1 < legacy.length; k += 2) {
    const i = legacy[k], id = legacy[k + 1];
    triples.push(i % LEGACY_WORLD_W, Math.floor(i / LEGACY_WORLD_W), id);
  }
  out.diffs = triples;
  out.wallDiffs = [];
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
    const entry = { id, name: data.name, seed: data.seed, updated: data.updated };
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

// Save indicator state: 'saved' | 'saving' | 'unsaved'
export function setSaveIndicator(state) {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.className = 'save-indicator ' + state;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Unsaved Changes' : 'Saved';
}
