// OVR + face-stat computation and position-fit logic. Shared by generation, squad UI, sim.
import { clamp, round } from '../core/util.js';
import { POS_GROUP } from '../data/formations.js';

export const OUTFIELD_ATTRS = [
  'pace', 'acceleration', 'sprintSpeed', 'shooting', 'finishing', 'longShots', 'passing',
  'vision', 'crossing', 'dribbling', 'ballControl', 'agility', 'balance', 'strength',
  'jumping', 'stamina', 'heading', 'tackling', 'interceptions', 'positioning', 'reactions', 'composure',
];

export const GK_ATTRS = ['reflexes', 'diving', 'handling', 'positioning', 'distribution', 'oneOnOne', 'aerialControl', 'reactions'];

export const ATTR_LABELS = {
  pace: 'Pace', acceleration: 'Acceleration', sprintSpeed: 'Sprint Speed', shooting: 'Shooting',
  finishing: 'Finishing', longShots: 'Long Shots', passing: 'Passing', vision: 'Vision',
  crossing: 'Crossing', dribbling: 'Dribbling', ballControl: 'Ball Control', agility: 'Agility',
  balance: 'Balance', strength: 'Strength', jumping: 'Jumping', stamina: 'Stamina', heading: 'Heading',
  tackling: 'Tackling', interceptions: 'Interceptions', positioning: 'Positioning', reactions: 'Reactions',
  composure: 'Composure', reflexes: 'Reflexes', diving: 'Diving', handling: 'Handling',
  distribution: 'Distribution', oneOnOne: 'One-on-One', aerialControl: 'Aerial Control',
};

// ---- Face stats (the six summary numbers on a card) ----
export function faceStats(a) {
  return {
    PAC: round(a.acceleration * 0.45 + a.sprintSpeed * 0.55),
    SHO: round(a.finishing * 0.45 + a.shooting * 0.24 + a.longShots * 0.2 + a.positioning * 0.11),
    PAS: round(a.passing * 0.4 + a.vision * 0.3 + a.crossing * 0.3),
    DRI: round(a.dribbling * 0.45 + a.ballControl * 0.3 + a.agility * 0.15 + a.balance * 0.1),
    DEF: round(a.tackling * 0.4 + a.interceptions * 0.35 + a.heading * 0.1 + a.positioning * 0.15),
    PHY: round(a.strength * 0.4 + a.jumping * 0.2 + a.stamina * 0.25 + a.composure * 0.15),
  };
}

export const FACE_LABELS = { PAC: 'PAC', SHO: 'SHO', PAS: 'PAS', DRI: 'DRI', DEF: 'DEF', PHY: 'PHY' };

// OVR weights per position group over the six face stats.
const OVR_WEIGHTS = {
  ST: { SHO: 0.3, PAC: 0.2, DRI: 0.2, PAS: 0.12, PHY: 0.13, DEF: 0.05 },
  W:  { PAC: 0.24, DRI: 0.26, SHO: 0.18, PAS: 0.18, PHY: 0.09, DEF: 0.05 },
  AM: { DRI: 0.26, PAS: 0.28, SHO: 0.2, PAC: 0.12, PHY: 0.08, DEF: 0.06 },
  CM: { PAS: 0.28, DRI: 0.2, DEF: 0.16, PHY: 0.16, SHO: 0.1, PAC: 0.1 },
  DM: { DEF: 0.3, PAS: 0.24, PHY: 0.22, DRI: 0.12, PAC: 0.07, SHO: 0.05 },
  CB: { DEF: 0.42, PHY: 0.26, PAC: 0.14, PAS: 0.1, DRI: 0.05, SHO: 0.03 },
  FB: { PAC: 0.24, DEF: 0.26, PAS: 0.2, DRI: 0.16, PHY: 0.12, SHO: 0.02 },
};

export function outfieldOvr(a, group) {
  const w = OVR_WEIGHTS[group] || OVR_WEIGHTS.CM;
  const f = faceStats(a);
  let ovr = 0;
  for (const k in w) ovr += f[k] * w[k];
  return round(clamp(ovr, 1, 99));
}

// ---- Goalkeeper ----
export function gkFaceStats(g) {
  return {
    DIV: g.diving, HAN: g.handling, KIC: g.distribution, REF: g.reflexes,
    SPD: round(g.reactions * 0.6 + g.aerialControl * 0.4), POS: g.positioning,
  };
}
export const GK_FACE_LABELS = { DIV: 'DIV', HAN: 'HAN', KIC: 'KIC', REF: 'REF', SPD: 'SPD', POS: 'POS' };

export function gkOvr(g) {
  const ovr =
    g.reflexes * 0.21 + g.diving * 0.2 + g.handling * 0.19 + g.positioning * 0.2 +
    g.oneOnOne * 0.1 + g.distribution * 0.05 + g.aerialControl * 0.03 + g.reactions * 0.02;
  return round(clamp(ovr, 1, 99));
}

export function computeOvr(player) {
  if (player.isGK) return gkOvr(player.gk);
  return outfieldOvr(player.attributes, POS_GROUP[player.primaryPosition] || 'CM');
}

// ---- Position fit ----
// Adjacency of position groups; smaller distance = better fit when playing out of position.
const GROUP_INDEX = { GK: -3, CB: 0, FB: 1, DM: 2, CM: 3, AM: 4, W: 5, ST: 6 };

export function positionPenalty(player, slotPos) {
  const slotGroup = POS_GROUP[slotPos];
  if (player.isGK) return slotGroup === 'GK' ? 0 : 60;
  if (slotGroup === 'GK') return 60; // outfield in goal
  if ((player.positions || []).includes(slotPos)) return 0; // natural position
  const pg = POS_GROUP[player.primaryPosition];
  if (pg === slotGroup) return 2; // same group, different slot
  // wing/fullback lateral compatibility bonus
  const d = Math.abs((GROUP_INDEX[pg] ?? 3) - (GROUP_INDEX[slotGroup] ?? 3));
  return clamp(d * 4, 3, 22);
}

/** Effective OVR for a player in a given slot (position-adjusted). */
export function effectiveOvr(player, slotPos) {
  return clamp(player.ovr - positionPenalty(player, slotPos), 1, 99);
}

/** Fit label for UI colouring. */
export function fitLevel(player, slotPos) {
  const p = positionPenalty(player, slotPos);
  if (p === 0) return 'perfect';
  if (p <= 3) return 'good';
  if (p <= 10) return 'ok';
  return 'poor';
}
