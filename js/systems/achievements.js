// Summoner Realms — achievements.
//
// Achievements belong to the *character*, not the world: take a summoner into a
// second realm and they keep what they have earned, exactly as in Terraria.
// They are stored in the character save (see save.js CharacterManager).
//
// Each achievement is a small record with a `check` that reads game state, or
// no check at all when it is fired by an explicit event (`unlock(id)` from the
// place that knows it happened). Polling is deliberately throttled — none of
// these need to be noticed the same frame they become true.
import { item as getItem } from '../data/items.js?v=worm-surface-4';
import { UNDERGROUND_Y, CAVERN_Y, TILE } from '../config.js?v=worm-surface-4';

const POLL_INTERVAL = 1.0;

export const ACHIEVEMENTS = [
  // --- First steps ---
  { id: 'firstTree', name: 'Timber', desc: 'Fell your first tree.', icon: '🌲', group: 'Gathering' },
  { id: 'firstCraft', name: 'Maker', desc: 'Craft anything at a bench.', icon: '🔨', group: 'Gathering' },
  { id: 'firstBuild', name: 'Homesteader', desc: 'Place 50 blocks.', icon: '🧱', group: 'Gathering',
    check: (g, st) => (st.counters.placed || 0) >= 50 },

  // --- Exploration ---
  { id: 'goUnder', name: 'Down the Hole', desc: 'Reach the Underground.', icon: '🕳',
    group: 'Exploration',
    check: (g) => g.localPlayer && g.localPlayer.y / TILE >= UNDERGROUND_Y },
  { id: 'goDeep', name: 'Cavernous', desc: 'Reach the Caverns.', icon: '🪨',
    group: 'Exploration',
    check: (g) => g.localPlayer && g.localPlayer.y / TILE >= CAVERN_Y },
  { id: 'bedrock', name: 'Bottom of the World', desc: 'Reach the deepest stone.', icon: '⬇',
    group: 'Exploration',
    check: (g) => g.localPlayer && g.localPlayer.y / TILE >= g.world.height - 12 },
  { id: 'allBiomes', name: 'Wayfarer', desc: 'Visit all six surface biomes.', icon: '🧭',
    group: 'Exploration',
    check: (g, st) => ['dunes', 'forest', 'jungle', 'frostpine', 'snowyTaiga', 'corrupt'].every(b => st.biomes[b]) },
  { id: 'swim', name: 'Out of Your Depth', desc: 'Go for a swim.', icon: '🌊',
    group: 'Exploration',
    check: (g) => g.localPlayer && g.localPlayer.submerged },

  // --- Wildlife and fishing ---
  { id: 'firstBug', name: 'Bug Collector', desc: 'Catch a bug.', icon: '🐛', group: 'Wildlife' },
  { id: 'firstFish', name: 'Angler', desc: 'Catch your first fish.', icon: '🎣', group: 'Wildlife' },
  { id: 'firstCrate', name: 'Salvager', desc: 'Open a crate.', icon: '📦', group: 'Wildlife' },
  { id: 'cook', name: 'Camp Cook', desc: 'Cook a meal.', icon: '🍖', group: 'Wildlife' },

  // --- Gear ---
  { id: 'fullSet', name: 'Suited Up', desc: 'Wear a complete armour set.', icon: '🛡', group: 'Gear',
    check: (g) => {
      const p = g.localPlayer;
      if (!p) return false;
      const sets = p.inventory.equippedSets();
      return Object.values(sets).some(n => n >= 3);
    } },
  { id: 'minionArmy', name: 'Summoner', desc: 'Have three minions at once.', icon: '✨', group: 'Gear',
    check: (g) => g.localPlayer && g.minions.filter(m => m.ownerId === g.localPlayer.id && !m.dead).length >= 3 },
  { id: 'sculpt', name: 'Stonecutter', desc: 'Shape a block with a hammer.', icon: '📐', group: 'Gear' },
  { id: 'wealthy', name: 'Well Supplied', desc: 'Carry 500 of any one material.', icon: '💰', group: 'Gear',
    check: (g) => {
      const p = g.localPlayer;
      if (!p) return false;
      const totals = new Map();
      for (const s of p.inventory.slots) {
        if (!s) continue;
        totals.set(s.id, (totals.get(s.id) || 0) + s.count);
      }
      for (const n of totals.values()) if (n >= 500) return true;
      return false;
    } },

  // --- Bosses ---
  { id: 'theMech', name: 'Machina Breaker', desc: 'Defeat The Mech.', icon: '⚙', group: 'Bosses' },
  { id: 'theWorm', name: 'Tunnelbreaker', desc: 'Defeat The Worm.', icon: '🪱', group: 'Bosses' },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

export class Achievements {
  constructor(game) {
    this.game = game;
    // { unlocked: { id: timestamp }, counters: {...}, biomes: {...} }
    this.state = { unlocked: {}, counters: {}, biomes: {} };
    this._poll = 0;
  }

  load(data) {
    this.state = {
      unlocked: (data && data.unlocked) || {},
      counters: (data && data.counters) || {},
      biomes: (data && data.biomes) || {},
    };
  }
  serialize() { return this.state; }

  has(id) { return !!this.state.unlocked[id]; }
  count() { return Object.keys(this.state.unlocked).length; }
  total() { return ACHIEVEMENTS.length; }

  /** Bump a named counter (blocks placed, and so on). */
  bump(key, n = 1) {
    this.state.counters[key] = (this.state.counters[key] || 0) + n;
  }

  /** Unlock by id. Idempotent; announces only the first time. */
  unlock(id) {
    if (this.state.unlocked[id]) return false;
    const def = ACHIEVEMENT_BY_ID[id];
    if (!def) return false;
    this.state.unlocked[id] = Date.now();
    this.game.toast(`${def.icon}  ${def.name} — ${def.desc}`, 'good');
    this.game.audio?.coin?.();
    const p = this.game.localPlayer;
    if (p) {
      this.game.floatText(p.x + p.w / 2, p.y - 14, def.name, '#ffe08a');
      this.game.fx.ring(p.x + p.w / 2, p.y + p.h / 2, 'rgba(255,224,138,0.8)', 34, { life: 0.6, width: 2 });
    }
    this.game.saveCharacter && this.game.saveCharacter();
    return true;
  }

  /** Poll the predicate-based achievements. Cheap, and only once a second. */
  update(dt) {
    const g = this.game;
    if (!g.localPlayer || g.state !== 'playing') return;

    // Track which surface biomes have been stood in, for the Wayfarer unlock.
    const p = g.localPlayer;
    const tx = Math.floor((p.x + p.w / 2) / TILE);
    const ty = Math.floor((p.y + p.h / 2) / TILE);
    if (ty < UNDERGROUND_Y) {
      const b = g.world.surfaceBiomeAt(tx);
      if (b && !this.state.biomes[b]) this.state.biomes[b] = 1;
    }

    this._poll -= dt;
    if (this._poll > 0) return;
    this._poll = POLL_INTERVAL;

    for (const a of ACHIEVEMENTS) {
      if (!a.check || this.state.unlocked[a.id]) continue;
      let ok = false;
      try { ok = !!a.check(g, this.state); } catch { ok = false; }
      if (ok) this.unlock(a.id);
    }
  }

  /** Grouped view for the UI. */
  grouped() {
    const groups = new Map();
    for (const a of ACHIEVEMENTS) {
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(a);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items }));
  }
}

/** Which achievement, if any, a crafted item should unlock. */
export function craftAchievement(itemId) {
  const def = getItem(itemId);
  if (!def) return null;
  if (def.food) return 'cook';
  return 'firstCraft';
}
