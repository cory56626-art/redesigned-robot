// Club economy: coins, XP/levels, facility upgrades, match rewards, and player training.
import { clamp, round } from '../core/util.js';
import { computeOvr, OUTFIELD_ATTRS, GK_ATTRS, faceStats, gkFaceStats } from './ratings.js';

export const FACILITIES = {
  stadium:  { name: 'Stadium',           icon: '🏟️', max: 10, desc: 'Bigger crowds — more matchday income.' },
  training: { name: 'Training Centre',   icon: '🎯', max: 10, desc: 'Cheaper, more effective player training.' },
  scouting: { name: 'Scouting Network',  icon: '🔭', max: 10, desc: 'Better daily rewards and pack value.' },
  medical:  { name: 'Medical Centre',    icon: '🏥', max: 10, desc: 'Players keep more stamina between matches.' },
};

export function upgradeCost(facility, currentLevel) {
  const base = { stadium: 5000, training: 4000, scouting: 6000, medical: 4500 }[facility] || 5000;
  return Math.round(base * Math.pow(1.7, currentLevel));
}

export function facilityLevel(save, facility) {
  return save.club.facilities?.[facility] || 1;
}

export function canUpgrade(save, facility) {
  const lvl = facilityLevel(save, facility);
  return lvl < FACILITIES[facility].max && save.club.coins >= upgradeCost(facility, lvl);
}

export function applyUpgrade(save, facility) {
  const lvl = facilityLevel(save, facility);
  if (lvl >= FACILITIES[facility].max) return { ok: false, reason: 'Max level reached' };
  const cost = upgradeCost(facility, lvl);
  if (save.club.coins < cost) return { ok: false, reason: 'Not enough coins' };
  save.club.coins -= cost;
  save.club.facilities[facility] = lvl + 1;
  return { ok: true, cost, level: lvl + 1 };
}

/** Matchday reward multiplier from the stadium level. */
export function rewardMultiplier(save) {
  return 1 + (facilityLevel(save, 'stadium') - 1) * 0.12;
}

/** Compute coins + XP for a finished match. */
export function matchReward(save, { won, drew, goalsFor, goalsAgainst, oppRating, tier = 1, knockout = false }) {
  const base = 300 + tier * 220;
  const resultBonus = won ? 700 + tier * 240 : drew ? 260 : 90;
  const goalsBonus = goalsFor * 45;
  const cleanSheet = goalsAgainst === 0 ? 180 : 0;
  const upsetBonus = won ? clamp((oppRating - teamBaseline(save)) * 30, 0, 1200) : 0;
  const knockoutBonus = knockout && won ? 600 + tier * 300 : 0;
  const coins = Math.round((base + resultBonus + goalsBonus + cleanSheet + upsetBonus + knockoutBonus) * rewardMultiplier(save));
  const xp = Math.round((won ? 60 : drew ? 30 : 15) + goalsFor * 6 + tier * 10);
  return { coins, xp };
}

function teamBaseline() {
  return 70; // reference rating for upset calc
}

// ---- XP / club level ----
export function xpForLevel(level) {
  return Math.round(200 * Math.pow(1.35, level - 1));
}

export function addXp(save, xp) {
  save.club.xp += xp;
  let leveled = 0;
  while (save.club.xp >= xpForLevel(save.club.level)) {
    save.club.xp -= xpForLevel(save.club.level);
    save.club.level += 1;
    leveled++;
  }
  return leveled;
}

export function addCoins(save, n) {
  save.club.coins = Math.max(0, save.club.coins + n);
  save.club.totalEarned = (save.club.totalEarned || 0) + Math.max(0, n);
}

export function spend(save, n) {
  if (save.club.coins < n) return false;
  save.club.coins -= n;
  return true;
}

// ---- Player training ----
export function trainCost(save, player) {
  const tLvl = facilityLevel(save, 'training');
  const raw = 400 + Math.max(0, player.ovr - 60) * 90 + player.rarityTier * 250;
  return Math.round(raw * (1 - (tLvl - 1) * 0.05));
}

/** Train a player: raise one below-potential attribute, recompute OVR. Returns changed attr. */
export function trainPlayer(save, player, rng) {
  if (player.ovr >= player.potential) return { ok: false, reason: 'At potential' };
  const cost = trainCost(save, player);
  if (!spend(save, cost)) return { ok: false, reason: 'Not enough coins' };
  const attrs = player.isGK ? GK_ATTRS : OUTFIELD_ATTRS;
  const bag = player.isGK ? player.gk : player.attributes;
  // Pick a couple of the lower attributes to raise.
  const sorted = attrs.filter((k) => bag[k] < 99).sort((a, b) => bag[a] - bag[b]);
  const raised = [];
  for (let i = 0; i < 3 && i < sorted.length; i++) {
    const k = sorted[rng ? rng.int(0, Math.min(5, sorted.length - 1)) : i];
    bag[k] = clamp(bag[k] + 1, 1, 99);
    raised.push(k);
  }
  if (!player.isGK) bag.pace = clamp(round(bag.acceleration * 0.45 + bag.sprintSpeed * 0.55), 1, 99);
  player.ovr = Math.min(player.potential, computeOvr(player));
  player.faces = player.isGK ? gkFaceStats(player.gk) : faceStats(player.attributes);
  return { ok: true, cost, raised, ovr: player.ovr };
}
