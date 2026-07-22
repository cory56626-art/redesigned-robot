// Build a fresh career save: club, starter squad, tactics, and the opening competition.
import { RNG } from '../core/rng.js';
import { generatePlayer } from './player-gen.js';
import { newSquad, autoFill } from './squad.js';
import { startStage } from './progression-wc.js';
import { SAVE_VERSION } from '../core/store.js';
import { clubBadge } from '../data/clubs.js';

const STARTER_BLUEPRINT = [
  { pos: 'GK', tier: 1 }, { pos: 'GK', tier: 0 },
  { pos: 'CB', tier: 1 }, { pos: 'CB', tier: 1 }, { pos: 'CB', tier: 0 },
  { pos: 'LB', tier: 1 }, { pos: 'RB', tier: 0 },
  { pos: 'CDM', tier: 1 }, { pos: 'CM', tier: 2 }, { pos: 'CM', tier: 1 }, { pos: 'CM', tier: 0 }, { pos: 'CAM', tier: 1 },
  { pos: 'LW', tier: 1 }, { pos: 'RW', tier: 1 }, { pos: 'ST', tier: 2 }, { pos: 'ST', tier: 1 }, { pos: 'ST', tier: 0 },
  { pos: 'LM', tier: 0 },
];

export function createNewCareer(clubName = 'Your Club FC') {
  const rng = new RNG(Date.now() ^ (Math.random() * 1e9));
  const colors = ['#12c2e9', '#0b1020'];
  const short = clubName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'YFC';

  const collection = STARTER_BLUEPRINT.map((b) =>
    generatePlayer({ rng, tier: b.tier, isGK: b.pos === 'GK', positionHint: b.pos })
  );

  const save = {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    club: {
      name: clubName,
      short,
      colors,
      badge: clubBadge(colors, short[0] || 'Y'),
      coins: 6500,
      level: 1,
      xp: 0,
      totalEarned: 0,
      facilities: { stadium: 1, training: 1, scouting: 1, medical: 1 },
      trophies: [],
    },
    collection,
    squad: newSquad(),
    stats: {
      matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
      packsOpened: 0, playersEarned: collection.length, bestWin: null, cleanSheets: 0,
    },
    progression: { campaignIndex: 0, attempts: {} },
    lastDaily: 0,
  };

  autoFill(save);
  startStage(save, 0);
  return save;
}
