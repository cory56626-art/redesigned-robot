// Career progression: a fixed campaign of leagues, cups and the World Cup. The player plays
// their own fixture each round interactively; other fixtures are quick-simulated from ratings.
import { RNG } from '../core/rng.js';
import { clamp } from '../core/util.js';
import { pickClubs } from '../data/clubs.js';
import { NATIONS } from '../data/nations.js';

export const CAMPAIGN = [
  { type: 'league', name: 'Fourth Division', tier: 1, teams: 8, promote: 3, baseRating: 62 },
  { type: 'league', name: 'Third Division',  tier: 2, teams: 8, promote: 3, baseRating: 68 },
  { type: 'league', name: 'Second Division', tier: 3, teams: 8, promote: 2, baseRating: 74 },
  { type: 'league', name: 'First Division',  tier: 4, teams: 8, promote: 1, baseRating: 80 },
  { type: 'cup', name: 'Domestic Cup',       tier: 4, teams: 8,  baseRating: 80 },
  { type: 'cup', name: 'Continental Cup',    tier: 5, teams: 8,  baseRating: 84 },
  { type: 'worldcup', name: 'World Cup',     tier: 5, teams: 16, baseRating: 85, national: true },
];

// ---- Quick simulation for non-player fixtures ----
function poisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L);
  return k - 1;
}

export function quickSim(ratingA, ratingB, rng) {
  const diff = ratingA - ratingB;
  const xgA = clamp(1.35 + diff * 0.045, 0.18, 4.6);
  const xgB = clamp(1.35 - diff * 0.045, 0.18, 4.6);
  return { a: poisson(xgA, rng), b: poisson(xgB, rng) };
}

function decideWinner(a, b, ra, rb, rng) {
  if (a.goals !== b.goals) return a.goals > b.goals ? a : b;
  // penalties, weighted slightly by rating
  const pa = 0.5 + (ra - rb) * 0.01;
  return rng.chance(clamp(pa, 0.15, 0.85)) ? a : b;
}

// ---- Stage setup ----
export function startStage(save, index) {
  const stage = CAMPAIGN[index];
  const rng = new RNG(`${save.club.name}-stage-${index}-${save.progression?.attempts?.[index] || 0}`);
  const playerRating = 68; // display only; real strength comes from the squad in-sim

  const comp = { type: stage.type, name: stage.name, tier: stage.tier, index, round: 0, done: false, won: false };

  if (stage.type === 'league') {
    const clubs = pickClubs(rng, stage.teams - 1).map((c) => ({ ...c, rating: stage.baseRating + rng.int(-5, 7) }));
    const teams = [{ name: save.club.name, short: save.club.short, colors: save.club.colors, rating: playerRating, isPlayer: true }, ...clubs];
    comp.teams = teams;
    comp.table = {};
    for (const t of teams) comp.table[t.name] = { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
    comp.schedule = roundRobin(teams.map((t) => t.name), rng);
    comp.promote = stage.promote;
  } else {
    // knockout
    let entrants;
    if (stage.national) {
      const nats = [...NATIONS].sort((a, b) => b.strength - a.strength).slice(0, stage.teams - 1);
      entrants = nats.map((n) => ({ name: n.name, short: n.code, colors: ['#1f6feb', '#ffffff'], flag: n.flag, rating: stage.baseRating - 6 + n.strength * 3 + rng.int(-3, 4) }));
    } else {
      entrants = pickClubs(rng, stage.teams - 1).map((c) => ({ ...c, rating: stage.baseRating + rng.int(-6, 7) }));
    }
    const player = { name: save.club.name, short: save.club.short, colors: save.club.colors, rating: playerRating, isPlayer: true };
    const all = rng.shuffle([player, ...entrants]);
    comp.bracket = [pairUp(all)];
    comp.national = !!stage.national;
  }
  save.progression = save.progression || { campaignIndex: index, attempts: {} };
  save.progression.campaignIndex = index;
  save.progression.competition = comp;
  return comp;
}

function pairUp(list) {
  const ties = [];
  for (let i = 0; i < list.length; i += 2) ties.push({ a: list[i], b: list[i + 1], played: false, as: 0, bs: 0, winner: null });
  return ties;
}

// Circle-method round robin. Returns rounds: [ [ [homeName, awayName], ... ], ... ].
function roundRobin(names, rng) {
  const list = [...names];
  if (list.length % 2) list.push('__bye__');
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const home = list[i], away = list[n - 1 - i];
      if (home !== '__bye__' && away !== '__bye__') round.push(r % 2 ? [away, home] : [home, away]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop());
  }
  return rng.shuffle(rounds);
}

// ---- Player fixture access ----
export function currentCompetition(save) {
  return save.progression?.competition;
}

/** The player's next match this round, or null if the stage has no pending player match. */
export function playerFixture(save) {
  const comp = currentCompetition(save);
  if (!comp || comp.done) return null;
  if (comp.type === 'league') {
    const round = comp.schedule[comp.round];
    if (!round) return null;
    const fx = round.find((m) => m[0] === save.club.name || m[1] === save.club.name);
    if (!fx) return null;
    const home = fx[0] === save.club.name;
    const oppName = home ? fx[1] : fx[0];
    const opp = comp.teams.find((t) => t.name === oppName);
    return { competition: comp, opponent: opp, home, roundLabel: `Matchday ${comp.round + 1}` };
  } else {
    const round = comp.bracket[comp.round];
    if (!round) return null;
    const tie = round.find((t) => (t.a.isPlayer || t.b.isPlayer) && !t.played);
    if (!tie) return null;
    const home = tie.a.isPlayer;
    const opp = home ? tie.b : tie.a;
    return { competition: comp, opponent: opp, home, roundLabel: knockoutLabel(comp, round.length) };
  }
}

function knockoutLabel(comp, ties) {
  const teams = ties * 2;
  if (teams === 2) return 'Final';
  if (teams === 4) return 'Semi-Final';
  if (teams === 8) return 'Quarter-Final';
  if (teams === 16) return 'Round of 16';
  return `Round of ${teams}`;
}

// ---- Recording results ----
export function recordPlayerResult(save, playerGoals, oppGoals, oppRating, rng = new RNG(Date.now())) {
  const comp = currentCompetition(save);
  if (comp.type === 'league') return recordLeague(save, comp, playerGoals, oppGoals, rng);
  return recordKnockout(save, comp, playerGoals, oppGoals, oppRating, rng);
}

function recordLeague(save, comp, pg, og, rng) {
  const round = comp.schedule[comp.round];
  const results = [];
  for (const [home, away] of round) {
    let hs, as;
    if (home === save.club.name) { hs = pg; as = og; }
    else if (away === save.club.name) { hs = og; as = pg; }
    else {
      const rh = comp.teams.find((t) => t.name === home).rating;
      const ra = comp.teams.find((t) => t.name === away).rating;
      const s = quickSim(rh + 3, ra, rng); // small home advantage
      hs = s.a; as = s.b;
    }
    applyTable(comp.table, home, away, hs, as);
    results.push({ home, away, hs, as });
  }
  comp.round++;
  const finished = comp.round >= comp.schedule.length;
  if (finished) {
    const standings = leagueStandings(comp);
    const pos = standings.findIndex((s) => s.name === save.club.name) + 1;
    comp.done = true;
    comp.won = pos <= comp.promote;
    comp.finalPosition = pos;
  }
  return { results, finished, standings: finished ? leagueStandings(comp) : null };
}

function applyTable(table, home, away, hs, as) {
  const H = table[home], A = table[away];
  H.p++; A.p++; H.gf += hs; H.ga += as; A.gf += as; A.ga += hs;
  if (hs > as) { H.w++; A.l++; H.pts += 3; }
  else if (hs < as) { A.w++; H.l++; A.pts += 3; }
  else { H.d++; A.d++; H.pts++; A.pts++; }
}

export function leagueStandings(comp) {
  return Object.entries(comp.table)
    .map(([name, s]) => ({ name, ...s, gd: s.gf - s.ga, isPlayer: name === (comp.teams.find((t) => t.isPlayer)?.name) }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
}

function recordKnockout(save, comp, pg, og, oppRating, rng) {
  const round = comp.bracket[comp.round];
  const results = [];
  for (const tie of round) {
    if (tie.played) continue;
    if (tie.a.isPlayer || tie.b.isPlayer) {
      const home = tie.a.isPlayer;
      tie.as = home ? pg : og; tie.bs = home ? og : pg;
    } else {
      const s = quickSim(tie.a.rating, tie.b.rating, rng);
      tie.as = s.a; tie.bs = s.b;
    }
    const wa = { name: tie.a.name, ref: tie.a, goals: tie.as };
    const wb = { name: tie.b.name, ref: tie.b, goals: tie.bs };
    const ratingA = tie.a.isPlayer && comp.national ? 98 : tie.a.rating;
    const ratingB = tie.b.isPlayer && comp.national ? 98 : tie.b.rating;
    const winner = comp.national && (tie.a.isPlayer || tie.b.isPlayer)
      ? (tie.a.isPlayer ? wa : wb)
      : decideWinner(wa, wb, ratingA, ratingB, rng);
    tie.winner = winner.ref;
    tie.played = true;
    results.push({ a: tie.a.name, b: tie.b.name, as: tie.as, bs: tie.bs, winner: tie.winner.name });
  }
  const winners = round.map((t) => t.winner);
  const playerAdvanced = winners.some((w) => w.isPlayer);
  let finished = false;
  if (winners.length === 1) {
    comp.done = true;
    comp.won = winners[0].isPlayer;
    comp.champion = winners[0].name;
    finished = true;
  } else if (!playerAdvanced) {
    comp.done = true;
    comp.won = false;
    finished = true;
  } else {
    comp.bracket.push(pairUp(winners));
    comp.round++;
  }
  return { results, finished, advanced: playerAdvanced, champion: comp.champion };
}

// ---- Advancing the campaign ----
export function stageComplete(save) {
  const comp = currentCompetition(save);
  return comp?.done;
}

export function advanceCampaign(save) {
  const comp = currentCompetition(save);
  save.progression.attempts = save.progression.attempts || {};
  if (comp.won && comp.index < CAMPAIGN.length - 1) {
    return startStage(save, comp.index + 1);
  }
  if (comp.won) {
    // Campaign complete (won the World Cup). Loop back into an endless First Division for replay.
    return startStage(save, 3);
  }
  // Failed — retry same stage with fresh fixtures.
  save.progression.attempts[comp.index] = (save.progression.attempts[comp.index] || 0) + 1;
  return startStage(save, comp.index);
}

export function campaignLabel(save) {
  const comp = currentCompetition(save);
  if (!comp) return '';
  return comp.name;
}
