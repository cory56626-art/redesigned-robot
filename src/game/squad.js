// Squad model: formation + starters + bench + tactics, with validation, chemistry and
// team-rating helpers. Starters is an array aligned to the formation's slot order.
import { formation, POS_GROUP } from '../data/formations.js';
import { effectiveOvr, positionPenalty } from './ratings.js';
import { clamp, round, avg } from '../core/util.js';

export const DEFAULT_TACTICS = {
  mentality: 'balanced', // defensive | balanced | attacking
  pressing: 55,          // 0..100
  tempo: 55,             // 0..100
  width: 55,             // 0..100
  line: 52,              // defensive line height 0..100
  style: 'possession',   // possession | balanced | counter | direct
};

export function newSquad() {
  return {
    formation: '442',
    starters: Array(11).fill(null), // player ids
    bench: [],                      // player ids (max 7)
    tactics: { ...DEFAULT_TACTICS },
  };
}

export function collectionMap(save) {
  const m = new Map();
  for (const p of save.collection) m.set(p.id, p);
  return m;
}

/** Resolve starters into [{index, slot, player|null}]. */
export function starterSlots(save, cmap = collectionMap(save)) {
  const f = formation(save.squad.formation);
  return f.slots.map((slot, index) => ({ index, slot, player: cmap.get(save.squad.starters[index]) || null }));
}

export function benchPlayers(save, cmap = collectionMap(save)) {
  return save.squad.bench.map((id) => cmap.get(id)).filter(Boolean);
}

export function filledStarters(save, cmap = collectionMap(save)) {
  return starterSlots(save, cmap).filter((s) => s.player);
}

/** Position-adjusted team rating (average effective OVR of the XI). */
export function teamRating(save, cmap = collectionMap(save)) {
  const slots = starterSlots(save, cmap);
  const vals = slots.filter((s) => s.player).map((s) => effectiveOvr(s.player, s.slot.pos));
  return vals.length ? round(avg(vals)) : 0;
}

/** Simple chemistry 0..100 from position fit plus nation/club links. */
export function chemistry(save, cmap = collectionMap(save)) {
  const slots = filledStarters(save, cmap);
  if (!slots.length) return 0;
  // Fit component (0..60).
  const fitScore = avg(
    slots.map((s) => {
      const pen = positionPenalty(s.player, s.slot.pos);
      return pen === 0 ? 1 : pen <= 3 ? 0.75 : pen <= 10 ? 0.45 : 0.15;
    })
  ) * 60;
  // Link component (0..40): shared nationality / club across the XI.
  const players = slots.map((s) => s.player);
  let links = 0;
  for (const p of players) {
    const nat = players.filter((q) => q !== p && q.nationality === p.nationality).length;
    const club = players.filter((q) => q !== p && q.club === p.club).length;
    links += Math.min(3, nat) * 1.2 + Math.min(2, club) * 2.2;
  }
  const linkScore = clamp((links / players.length) * 9, 0, 40);
  return round(clamp(fitScore + linkScore, 0, 100));
}

export function validateSquad(save, cmap = collectionMap(save)) {
  const slots = starterSlots(save, cmap);
  const filled = slots.filter((s) => s.player);
  const gkSlots = slots.filter((s) => s.slot.pos === 'GK');
  const gkFilled = gkSlots.filter((s) => s.player && s.player.isGK).length;
  const issues = [];
  if (filled.length < 11) issues.push(`${11 - filled.length} empty position${filled.length === 10 ? '' : 's'} in the XI`);
  if (gkFilled < 1) issues.push('No goalkeeper selected in goal');
  // outfield players in GK slot or GK in outfield
  for (const s of filled) {
    if (s.slot.pos === 'GK' && !s.player.isGK) issues.push('An outfield player is in goal');
    if (s.slot.pos !== 'GK' && s.player.isGK) issues.push('A goalkeeper is playing outfield');
  }
  return { valid: filled.length === 11 && gkFilled === 1 && issues.length === 0, filled: filled.length, issues: [...new Set(issues)] };
}

/** Auto-fill the XI with the best available players by position fit, best formation slots first. */
export function autoFill(save) {
  const f = formation(save.squad.formation);
  const used = new Set();
  const starters = Array(11).fill(null);
  const pool = [...save.collection];

  // Order slots GK first, then defence->attack, so scarce specialists are placed first.
  const order = f.slots.map((s, i) => i).sort((a, b) => slotPriority(f.slots[a]) - slotPriority(f.slots[b]));
  for (const i of order) {
    const slot = f.slots[i];
    let best = null, bestScore = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      if (slot.pos === 'GK' && !p.isGK) continue;
      if (slot.pos !== 'GK' && p.isGK) continue;
      const score = effectiveOvr(p, slot.pos) + (positionPenalty(p, slot.pos) === 0 ? 6 : 0);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) { starters[i] = best.id; used.add(best.id); }
  }
  save.squad.starters = starters;

  // Bench: next best 7 outfield/GK not used.
  const rest = pool.filter((p) => !used.has(p.id)).sort((a, b) => b.ovr - a.ovr);
  save.squad.bench = rest.slice(0, 7).map((p) => p.id);
  return save.squad;
}

function slotPriority(slot) {
  const order = { GK: 0, CB: 1, FB: 2, DM: 3, CM: 4, AM: 5, W: 6, ST: 7 };
  return order[POS_GROUP[slot.pos]] ?? 4;
}

/** Change formation, keeping players and remapping them to the nearest matching slots. */
export function setFormation(save, newFormationId, cmap = collectionMap(save)) {
  const oldSlots = starterSlots(save, cmap);
  const players = oldSlots.filter((s) => s.player).map((s) => s.player);
  save.squad.formation = newFormationId;
  save.squad.starters = Array(11).fill(null);
  const f = formation(newFormationId);
  const used = new Set();
  const order = f.slots.map((s, i) => i).sort((a, b) => slotPriority(f.slots[a]) - slotPriority(f.slots[b]));
  for (const i of order) {
    const slot = f.slots[i];
    let best = null, bestScore = -1;
    for (const p of players) {
      if (used.has(p.id)) continue;
      if (slot.pos === 'GK' && !p.isGK) continue;
      if (slot.pos !== 'GK' && p.isGK) continue;
      const score = effectiveOvr(p, slot.pos);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) { save.squad.starters[i] = best.id; used.add(best.id); }
  }
  return save.squad;
}
