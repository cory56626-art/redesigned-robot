// Pack definitions + opening logic. A pack rolls a tier per slot (with guarantees), decides
// GK vs outfield, generates the player, then rolls an optional special-card overlay.
import { RNG } from '../core/rng.js';
import { generatePlayer } from './player-gen.js';
import { SPECIAL_CARDS } from '../data/rarities.js';

const GK_CHANCE = 0.12;

export const PACKS = {
  bronze:   { id: 'bronze',   name: 'Bronze Pack',   price: 400,   count: 5, icon: '📦', tierW: [70, 26, 4, 0.4, 0.05, 0.005], special: 0.002, guarantee: null,               desc: 'Entry-level pack. Mostly Common, a chance at Rare.' },
  silver:   { id: 'silver',   name: 'Silver Pack',   price: 1200,  count: 5, icon: '🥈', tierW: [30, 45, 20, 4, 0.6, 0.06],    special: 0.01,  guarantee: { minTier: 1, count: 1 }, desc: 'Guaranteed Rare. Decent shot at Epic.' },
  gold:     { id: 'gold',     name: 'Gold Pack',     price: 3000,  count: 6, icon: '🥇', tierW: [8, 34, 40, 15, 2.5, 0.3],     special: 0.02,  guarantee: { minTier: 2, count: 1 }, desc: 'Guaranteed Epic. Legendary within reach.' },
  premium:  { id: 'premium',  name: 'Premium Pack',  price: 7500,  count: 6, icon: '💎', tierW: [2, 18, 42, 30, 6.5, 1],       special: 0.04,  guarantee: { minTier: 3, count: 1 }, desc: 'Guaranteed Legendary. Elevated special-card odds.' },
  legendary:{ id: 'legendary',name: 'Legendary Pack',price: 18000, count: 6, icon: '🌟', tierW: [0, 6, 30, 44, 16, 4],         special: 0.07,  guarantee: { minTier: 3, count: 2 }, desc: 'Two Legendaries guaranteed. Mythic pulls possible.' },
  mythic:   { id: 'mythic',   name: 'Mythic Pack',   price: 42000, count: 7, icon: '🔥', tierW: [0, 0, 16, 42, 30, 12],        special: 0.12,  guarantee: { minTier: 4, count: 1 }, desc: 'Guaranteed Mythic. A real shot at Superhuman.' },
  icon:     { id: 'icon',     name: 'Icon & GOAT Pack', price: 90000, count: 7, icon: '👑', tierW: [0, 0, 8, 36, 38, 18],     special: 0.35,  guarantee: { minTier: 4, count: 2 }, allowTopSpecials: true, desc: 'The best pack. Icons, GOATs and Superhumans await.' },
};

export const PACK_LIST = Object.values(PACKS);
export const pack = (id) => PACKS[id];

function rollTier(rng, weights) {
  const entries = weights.map((w, i) => ({ item: i, weight: w }));
  return rng.weighted(entries);
}

function rollSpecial(rng, tier, allowTop) {
  // Gate the strongest specials behind higher pulls / premium packs.
  const pool = Object.values(SPECIAL_CARDS).filter((s) => {
    if ((s.id === 'goat' || s.id === 'primeicon') && !(allowTop || tier >= 5)) return false;
    if (s.id === 'icon' && !(allowTop || tier >= 3)) return false;
    return true;
  });
  return rng.weighted(pool.map((s) => ({ item: s.id, weight: s.weight })));
}

/**
 * Open a pack. Returns an array of freshly generated players.
 * @param packId key in PACKS
 * @param seed optional seed for deterministic openings
 */
export function openPack(packId, seed) {
  const def = PACKS[packId];
  if (!def) throw new Error('Unknown pack ' + packId);
  const rng = new RNG(seed ?? (Date.now() ^ (Math.random() * 1e9)));

  const tiers = [];
  for (let i = 0; i < def.count; i++) tiers.push(rollTier(rng, def.tierW));

  // Apply guarantees by upgrading the weakest slots.
  if (def.guarantee) {
    const { minTier, count } = def.guarantee;
    let have = tiers.filter((t) => t >= minTier).length;
    while (have < count) {
      let idx = 0;
      for (let i = 1; i < tiers.length; i++) if (tiers[i] < tiers[idx]) idx = i;
      if (tiers[idx] >= minTier) break;
      tiers[idx] = minTier;
      have++;
    }
  }

  const players = tiers.map((tier) => {
    const isGK = rng.chance(GK_CHANCE);
    let special = null;
    if (rng.chance(def.special)) special = rollSpecial(rng, tier, def.allowTopSpecials);
    return generatePlayer({ rng, tier, isGK, special });
  });

  // Sort best-first so the walkout reveal saves the best for last (reversed at display time).
  players.sort((a, b) => a.ovr - b.ovr);
  return players;
}

/** Coin value awarded when quick-selling a player (scales steeply with rating). */
export function sellValue(player) {
  const t = player.rarityTier;
  const base = [40, 120, 400, 1400, 5000, 16000][t] || 40;
  const ovrMult = 1 + Math.max(0, player.ovr - 60) * 0.03;
  const specialMult = player.special ? 1 + SPECIAL_CARDS[player.special].boost * 0.12 : 1;
  return Math.round(base * ovrMult * specialMult);
}
