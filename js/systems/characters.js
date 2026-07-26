// Summoner Realms — characters.
//
// Terraria keeps characters and worlds in separate files, and this mirrors that:
// a character owns its name, appearance, inventory, equipment and progression,
// and a world owns terrain, weather and the explored map. That is what lets you
// take one character into several worlds — which the old layout could not do,
// because the player blob lived *inside* each world save.
//
// Deliberately shaped like SaveManager in js/save.js (same prefix/index/list/
// read/write pattern), so the two stores behave identically and the character
// select screen can reuse the world-select markup.
import { CHAR_PREFIX, CHAR_INDEX_KEY, CHAR_VERSION } from '../config.js?v=realms-qor-46';
import { Inventory, starterInventory } from './inventory.js?v=realms-qor-46';

// Appearance palettes. Kept here rather than in the UI so the renderer, the
// customization screen and the network all agree on the same set.
export const SKIN_TONES = ['#f0c9a0', '#e0b088', '#c98e63', '#a06840', '#7a4a2c', '#5a3620'];
export const HAIR_COLORS = ['#3a2a1e', '#6b4423', '#a8702e', '#d9b45c', '#8f8f96', '#e8e2d8', '#7a3b52', '#3c4a66'];
export const SHIRT_COLORS = ['#7ee0c0', '#c58bff', '#ffcf6b', '#ff8b9a', '#8ad9ff', '#9ee07e', '#ff9a5a', '#b0a6ff'];
export const PANTS_COLORS = ['#2a2f45', '#3d3348', '#4a3b2c', '#243a44', '#402a2a', '#1f2733'];
// Hair silhouettes the renderer knows how to draw.
export const HAIR_STYLES = ['short', 'swept', 'long', 'mohawk', 'bald'];

export function defaultAppearance(seed = 0) {
  return {
    skin: SKIN_TONES[seed % SKIN_TONES.length],
    hair: HAIR_STYLES[0],
    hairColor: HAIR_COLORS[0],
    shirt: SHIRT_COLORS[seed % SHIRT_COLORS.length],
    pants: PANTS_COLORS[0],
  };
}

// Normalise anything read off disk or the wire, so a hand-edited or truncated
// record can never leave the renderer with an undefined colour.
export function normalizeAppearance(a) {
  const d = defaultAppearance(0);
  if (!a || typeof a !== 'object') return d;
  const pick = (v, pool, fallback) => (pool.includes(v) ? v : fallback);
  return {
    skin: pick(a.skin, SKIN_TONES, d.skin),
    hair: pick(a.hair, HAIR_STYLES, d.hair),
    hairColor: pick(a.hairColor, HAIR_COLORS, d.hairColor),
    shirt: pick(a.shirt, SHIRT_COLORS, d.shirt),
    pants: pick(a.pants, PANTS_COLORS, d.pants),
  };
}

export function newCharacter(name, appearance) {
  const inv = starterInventory();
  return {
    version: CHAR_VERSION,
    name: (name || 'Summoner').slice(0, 14),
    appearance: normalizeAppearance(appearance),
    inventory: inv.serialize(),
    progression: { defeated: [], recipes: [] },
    hp: null, mana: null, // null = full; filled in on first save
    playtime: 0,
    updated: Date.now(),
  };
}

export class CharacterManager {
  _index() {
    try { return JSON.parse(localStorage.getItem(CHAR_INDEX_KEY)) || []; }
    catch { return []; }
  }
  _writeIndex(idx) {
    try { localStorage.setItem(CHAR_INDEX_KEY, JSON.stringify(idx)); } catch (e) { console.warn('Character index write failed', e); }
  }

  list() { return this._index().slice().sort((a, b) => b.updated - a.updated); }
  newId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  write(id, data) {
    data.updated = Date.now();
    data.version = CHAR_VERSION;
    try { localStorage.setItem(CHAR_PREFIX + id, JSON.stringify(data)); }
    catch (e) { console.warn('Character save failed', e); return false; }
    const idx = this._index();
    // The index carries just enough to render the select screen without
    // deserializing every character.
    const entry = {
      id, name: data.name, updated: data.updated,
      appearance: data.appearance,
      defeated: (data.progression && data.progression.defeated ? data.progression.defeated.length : 0),
    };
    const i = idx.findIndex(e => e.id === id);
    if (i >= 0) idx[i] = entry; else idx.push(entry);
    this._writeIndex(idx);
    return true;
  }

  read(id) {
    try {
      const raw = JSON.parse(localStorage.getItem(CHAR_PREFIX + id));
      if (!raw) return null;
      raw.appearance = normalizeAppearance(raw.appearance);
      if (!raw.progression) raw.progression = { defeated: [], recipes: [] };
      return raw;
    } catch { return null; }
  }

  remove(id) {
    localStorage.removeItem(CHAR_PREFIX + id);
    this._writeIndex(this._index().filter(e => e.id !== id));
  }

  create(name, appearance) {
    const id = this.newId();
    const c = newCharacter(name, appearance);
    this.write(id, c);
    return { id, data: c };
  }

  // Pull the player out of a pre-4.1 world save and give it its own record, so
  // upgrading never loses a character. Returns the new id, or null if there was
  // nothing to migrate.
  adoptFromWorldSave(save) {
    if (!save || !save.player) return null;
    const id = this.newId();
    const c = newCharacter(save.migratedName || 'Summoner', null);
    c.inventory = save.player.inventory || c.inventory;
    c.progression = save.progression || c.progression;
    c.hp = save.player.hp != null ? save.player.hp : null;
    c.mana = save.player.mana != null ? save.player.mana : null;
    this.write(id, c);
    return id;
  }
}

// Snapshot the live player back into a character record.
export function captureCharacter(record, player, progression) {
  record.inventory = player.inventory.serialize();
  record.progression = progression ? progression.serialize() : record.progression;
  record.hp = Math.round(player.hp);
  record.mana = Math.round(player.mana);
  return record;
}

// Apply a character record onto a freshly created Player.
export function applyCharacter(record, player) {
  const a = normalizeAppearance(record.appearance);
  player.name = record.name || 'Summoner';
  player.appearance = a;
  player.skin = a.skin;
  player.hairStyle = a.hair;
  player.hairColor = a.hairColor;
  player.color = a.shirt;      // torso, and the name-tag colour
  player.pantsColor = a.pants;
  if (record.inventory) {
    const inv = new Inventory();
    inv.deserialize(record.inventory);
    player.inventory = inv;
  }
  player.recomputeStats();
  player.hp = record.hp != null ? Math.min(record.hp, player.maxHp) : player.maxHp;
  player.mana = record.mana != null ? Math.min(record.mana, player.maxMana) : player.maxMana;
}
