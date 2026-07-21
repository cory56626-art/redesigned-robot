// Central game state + localStorage persistence.
import { bus } from './events.js';

const SAVE_KEY = 'fm3d.save.v1';
const SETTINGS_KEY = 'fm3d.settings.v1';
export const SAVE_VERSION = 1;

let _state = null;
let _saveTimer = null;

/** In-memory game state (career save). */
export function state() {
  return _state;
}

export function setState(s) {
  _state = s;
  bus.emit('state:set', _state);
}

export function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== SAVE_VERSION) return null; // simple: ignore incompatible saves
    return data;
  } catch (e) {
    console.warn('Failed to load save', e);
    return null;
  }
}

/** Persist current state (debounced). */
export function save(immediate = false) {
  if (!_state) return;
  const doSave = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(_state));
      bus.emit('save:done');
    } catch (e) {
      console.warn('Failed to save', e);
      bus.emit('save:error', e);
    }
  };
  clearTimeout(_saveTimer);
  if (immediate) doSave();
  else _saveTimer = setTimeout(doSave, 400);
}

export function deleteSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

// ---- Settings (separate from career save so they persist across resets) ----

const DEFAULT_SETTINGS = {
  sound: true,
  music: true,
  graphics: 'high', // 'low' | 'medium' | 'high'
  defaultSpeed: 1,
  showParticles: true,
  reducedMotion: false,
  crowdVolume: 0.6,
};

let _settings = null;

export function settings() {
  if (!_settings) loadSettings();
  return _settings;
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    _settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

export function saveSettings(patch = {}) {
  _settings = { ...settings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
  } catch {}
  bus.emit('settings:changed', _settings);
  return _settings;
}
