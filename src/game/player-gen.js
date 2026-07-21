// Procedural player generation. Produces coherent attribute spreads that resolve to a
// target OVR band, with role-appropriate playstyles, traits, and secondary positions.
import { clamp, round, uid } from '../core/util.js';
import { NATIONS } from '../data/nations.js';
import { generateName } from '../data/names.js';
import { randomClub } from '../data/clubs.js';
import { PLAYSTYLES, TRAITS } from '../data/playstyles.js';
import { OUTFIELD_RARITIES, GK_RARITIES, SPECIAL_CARDS, TIER_TO_OUTFIELD, TIER_TO_GK } from '../data/rarities.js';
import { OUTFIELD_ATTRS, GK_ATTRS, computeOvr, faceStats, gkFaceStats, outfieldOvr, gkOvr } from './ratings.js';

// Relative attribute bias per outfield position group (added on top of the OVR centre).
const BIAS = {
  ST: { finishing: 11, shooting: 8, positioning: 9, longShots: 3, composure: 6, heading: 4, dribbling: 3, ballControl: 4, acceleration: 5, sprintSpeed: 5, pace: 5, reactions: 6, agility: 3, balance: 2, strength: 3, jumping: 3, stamina: 0, vision: -3, passing: -4, crossing: -6, tackling: -22, interceptions: -22 },
  W:  { acceleration: 9, sprintSpeed: 10, pace: 9, dribbling: 10, ballControl: 7, agility: 8, balance: 5, crossing: 7, finishing: 2, shooting: 1, passing: 1, vision: 1, reactions: 4, stamina: 4, longShots: 1, positioning: 2, strength: -6, heading: -7, tackling: -14, interceptions: -13, jumping: -2 },
  AM: { passing: 9, vision: 10, dribbling: 9, ballControl: 9, composure: 6, longShots: 6, finishing: 4, shooting: 3, agility: 7, balance: 4, reactions: 5, crossing: 3, acceleration: 3, sprintSpeed: 2, pace: 2, stamina: 2, positioning: 3, strength: -5, heading: -6, tackling: -11, interceptions: -10, jumping: -3 },
  CM: { passing: 9, vision: 6, ballControl: 7, dribbling: 6, stamina: 8, composure: 5, reactions: 4, interceptions: 3, tackling: 3, strength: 3, longShots: 3, positioning: 2, agility: 2, balance: 2, heading: 0, crossing: 1, finishing: -3, shooting: -3, acceleration: 0, sprintSpeed: 0, pace: 0, jumping: 0 },
  DM: { tackling: 9, interceptions: 10, passing: 6, strength: 7, stamina: 7, positioning: 7, composure: 4, reactions: 4, heading: 5, ballControl: 3, vision: 3, jumping: 4, dribbling: -1, balance: 1, finishing: -7, shooting: -7, crossing: -3, agility: -1, longShots: 0, acceleration: -2, sprintSpeed: -2, pace: -2 },
  CB: { tackling: 13, interceptions: 13, strength: 13, heading: 12, jumping: 10, positioning: 9, reactions: 4, composure: 3, balance: 2, stamina: 2, passing: -2, ballControl: -4, dribbling: -9, agility: -9, acceleration: -6, sprintSpeed: -3, pace: -4, finishing: -20, shooting: -18, longShots: -13, crossing: -13, vision: -6 },
  FB: { acceleration: 7, sprintSpeed: 8, pace: 7, stamina: 9, crossing: 6, tackling: 7, interceptions: 7, dribbling: 3, ballControl: 3, passing: 3, agility: 5, balance: 3, reactions: 3, positioning: 3, strength: 2, heading: 1, jumping: 1, composure: 1, vision: -1, finishing: -9, shooting: -9, longShots: -6 },
};

const GK_BIAS = { reflexes: 4, diving: 3, handling: 2, positioning: 3, distribution: -4, oneOnOne: 1, aerialControl: -1, reactions: 3 };

// Non-GK group distribution when a pack does not force a position.
const GROUP_WEIGHTS = [
  { item: 'CB', weight: 20 }, { item: 'FB', weight: 15 }, { item: 'DM', weight: 8 },
  { item: 'CM', weight: 17 }, { item: 'AM', weight: 8 }, { item: 'W', weight: 15 }, { item: 'ST', weight: 12 },
];

const GROUP_POSITIONS = {
  CB: ['CB'], FB: ['LB', 'RB', 'LWB', 'RWB'], DM: ['CDM'], CM: ['CM'], AM: ['CAM'],
  W: ['LW', 'RW', 'LM', 'RM'], ST: ['ST', 'CF'],
};

const SECONDARY = {
  ST: ['CF', 'LW', 'RW', 'CAM'], W: ['ST', 'CAM', 'LM', 'RM', 'LW', 'RW'], AM: ['CM', 'LW', 'RW', 'CF'],
  CM: ['CDM', 'CAM'], DM: ['CM', 'CB'], CB: ['CDM', 'RB', 'LB'], FB: ['CB', 'LM', 'RM'],
};

const HEIGHT_BY_GROUP = { GK: 191, CB: 188, ST: 184, DM: 182, FB: 178, CM: 179, AM: 176, W: 175 };

function pickNation(rng) {
  const entries = NATIONS.map((n) => ({ item: n, weight: Math.pow(n.strength, 1.15) }));
  return rng.weighted(entries);
}

/**
 * @param opts { rng, tier(0-5), isGK, positionHint, group, special, nationHint, ageHint, targetOvr }
 */
export function generatePlayer(opts) {
  const rng = opts.rng;
  const isGK = opts.isGK ?? (opts.positionHint === 'GK') ?? false;

  // Determine rarity + target OVR from tier band (or explicit targetOvr).
  const tier = clamp(opts.tier ?? 0, 0, 5);
  const rarityId = (isGK ? TIER_TO_GK : TIER_TO_OUTFIELD)[tier];
  const rarityDef = (isGK ? GK_RARITIES : OUTFIELD_RARITIES)[rarityId];
  let target = opts.targetOvr ?? round(rng.range(rarityDef.ovr[0], rarityDef.ovr[1]));

  const nation = opts.nationHint || pickNation(rng);
  const nm = generateName(nation.code, rng);
  const foot = rng.chance(0.76) ? 'Right' : 'Left';
  const age = opts.ageHint ?? rng.int(17, 35);

  const base = {
    id: uid('pl'),
    first: nm.first, last: nm.last, name: nm.name,
    nationality: nation.code, club: randomClub(rng),
    age, foot,
    rarity: rarityId, rarityTier: tier,
    special: opts.special || null,
  };

  if (isGK) {
    base.isGK = true;
    base.primaryPosition = 'GK';
    base.positions = ['GK'];
    base.group = 'GK';
    base.height = round(HEIGHT_BY_GROUP.GK + rng.gaussian(0, 4));
    const gk = {};
    for (const k of GK_ATTRS) gk[k] = clamp(target + (GK_BIAS[k] || 0) + rng.gaussian(0, 5), 24, 99);
    // align to target
    const d = target - gkOvr(gk);
    for (const k of GK_ATTRS) gk[k] = clamp(gk[k] + d, 24, 99);
    base.gk = gk;
    base.playstyle = rng.chance(0.5) ? 'sweeperkeeper' : 'shotstopper';
  } else {
    const group = opts.group || (opts.positionHint ? groupOfPos(opts.positionHint) : rng.weighted(GROUP_WEIGHTS));
    const pos = opts.positionHint || rng.pick(GROUP_POSITIONS[group]);
    base.isGK = false;
    base.primaryPosition = pos;
    base.group = group;
    base.positions = buildPositions(rng, group, pos);
    base.height = round((HEIGHT_BY_GROUP[group] || 179) + rng.gaussian(0, 5));
    const bias = BIAS[group] || BIAS.CM;
    const a = {};
    for (const k of OUTFIELD_ATTRS) a[k] = clamp(target + (bias[k] || 0) + rng.gaussian(0, 5.5), 22, 99);
    // keep pace consistent with accel/sprint
    a.pace = clamp(round(a.acceleration * 0.45 + a.sprintSpeed * 0.55) + rng.gaussian(0, 2), 22, 99);
    // align OVR to target
    const d = target - outfieldOvr(a, group);
    for (const k of OUTFIELD_ATTRS) a[k] = clamp(a[k] + d, 22, 99);
    a.pace = clamp(round(a.acceleration * 0.45 + a.sprintSpeed * 0.55), 22, 99);
    base.attributes = a;
    base.playstyle = pickPlaystyle(rng, group);
  }

  base.traits = pickTraits(rng, tier);
  base.ovr = computeOvr(base);

  // Special card OVR boost, applied and folded into the underlying rating.
  if (base.special && SPECIAL_CARDS[base.special]) {
    const boost = SPECIAL_CARDS[base.special].boost;
    applyBoost(base, boost);
  }

  base.potential = computePotential(rng, base.ovr, age);
  base.faces = base.isGK ? gkFaceStats(base.gk) : faceStats(base.attributes);
  return base;
}

// Fold an OVR boost into the underlying attributes so the card OVR reflects it.
function applyBoost(p, boost) {
  if (p.isGK) {
    for (const k of GK_ATTRS) p.gk[k] = clamp(p.gk[k] + boost, 24, 99);
  } else {
    for (const k of OUTFIELD_ATTRS) p.attributes[k] = clamp(p.attributes[k] + boost, 22, 99);
    p.attributes.pace = clamp(round(p.attributes.acceleration * 0.45 + p.attributes.sprintSpeed * 0.55), 22, 99);
  }
  p.ovr = clamp(computeOvr(p), 1, 99);
}

function computePotential(rng, ovr, age) {
  if (age <= 21) return clamp(round(ovr + rng.range(3, 14)), ovr, 99);
  if (age <= 25) return clamp(round(ovr + rng.range(1, 7)), ovr, 99);
  if (age <= 29) return clamp(round(ovr + rng.range(0, 3)), ovr, 99);
  return ovr;
}

function buildPositions(rng, group, pos) {
  const set = new Set([pos]);
  const opts = SECONDARY[group] || [];
  const extra = rng.int(0, 2);
  const shuffled = rng.shuffle([...opts]);
  for (let i = 0; i < extra && i < shuffled.length; i++) set.add(shuffled[i]);
  return [...set];
}

function pickPlaystyle(rng, group) {
  const candidates = Object.keys(PLAYSTYLES).filter((k) => PLAYSTYLES[k].groups.includes(group));
  return candidates.length ? rng.pick(candidates) : 'boxtobox';
}

function pickTraits(rng, tier) {
  const count = clamp(1 + Math.floor(tier / 2) + (rng.chance(0.4) ? 1 : 0), 1, 4);
  const keys = rng.shuffle(Object.keys(TRAITS));
  return keys.slice(0, count);
}

const groupOfPos = (pos) => {
  for (const [g, arr] of Object.entries(GROUP_POSITIONS)) if (arr.includes(pos)) return g;
  return 'CM';
};
