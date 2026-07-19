// Summoner Realms — localStorage save/load with named slots + save indicator.
import { SAVE_PREFIX, SAVE_INDEX_KEY, SETTINGS_KEY } from './config.js';

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
    try { return JSON.parse(localStorage.getItem(SAVE_PREFIX + id)); }
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
