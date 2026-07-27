// Summoner Realms — passive wildlife. All original creatures.
//
// Kept separate from data/enemies.js on purpose: these never attack, never
// count against the hostile spawn budget, and exist to make the world feel
// inhabited rather than to fight you. Two kinds live here:
//
//   critter : walks or hops around, flees when you get close, drops materials
//   bug     : tiny, caught by clicking rather than by killing, used as bait
//
// behavior : grazer | hopper | flutter | swimmer
// skittish : tiles at which it notices you and starts running
// bait     : bugs only — fishing bait quality, 1 (poor) to 3 (excellent)
export const FAUNA = {
  // ---- Surface livestock ----
  cow: {
    key: 'cow', name: 'Meadow Cow', kind: 'critter', hp: 30, behavior: 'grazer',
    biomes: ['forest'], time: 'day', speed: 22, w: 26, h: 18,
    color: '#e8e2d6', color2: '#5a4a3a', skittish: 5,
    drops: [{ item: 'rawBeef', chance: 1, min: 1, max: 2 }, { item: 'leather', chance: 0.7, min: 1, max: 2 }],
  },
  pig: {
    key: 'pig', name: 'Truffle Pig', kind: 'critter', hp: 24, behavior: 'grazer',
    biomes: ['forest', 'dunes'], time: 'any', speed: 30, w: 22, h: 14,
    color: '#e5a9a9', color2: '#b47b7b', skittish: 6,
    drops: [{ item: 'rawPork', chance: 1, min: 1, max: 2 }, { item: 'leather', chance: 0.4, min: 1, max: 1 }],
  },
  sheep: {
    key: 'sheep', name: 'Cloudback Sheep', kind: 'critter', hp: 26, behavior: 'grazer',
    biomes: ['forest', 'frostpine'], time: 'any', speed: 26, w: 22, h: 17,
    color: '#f2efe6', color2: '#c9c2b2', skittish: 6,
    drops: [{ item: 'rawMutton', chance: 1, min: 1, max: 1 }, { item: 'wool', chance: 1, min: 1, max: 3 }],
  },
  rabbit: {
    key: 'rabbit', name: 'Thicket Rabbit', kind: 'critter', hp: 8, behavior: 'hopper',
    biomes: ['forest', 'frostpine'], time: 'any', speed: 62, w: 12, h: 10,
    color: '#c8b9a4', color2: '#8e8172', skittish: 9,
    drops: [{ item: 'rawGame', chance: 1, min: 1, max: 1 }, { item: 'leather', chance: 0.3, min: 1, max: 1 }],
  },
  chicken: {
    key: 'chicken', name: 'Dustfowl', kind: 'critter', hp: 10, behavior: 'hopper',
    biomes: ['forest', 'dunes'], time: 'day', speed: 44, w: 12, h: 13,
    color: '#f0e4c8', color2: '#d4423a', skittish: 8,
    drops: [{ item: 'rawGame', chance: 1, min: 1, max: 1 }, { item: 'feather', chance: 0.8, min: 1, max: 3 }],
  },
  frog: {
    key: 'frog', name: 'Pondskip Frog', kind: 'critter', hp: 8, behavior: 'hopper',
    biomes: ['forest'], time: 'any', speed: 40, w: 11, h: 9, nearWater: true,
    color: '#6ba85a', color2: '#3f6f38', skittish: 7,
    drops: [{ item: 'rawGame', chance: 0.5, min: 1, max: 1 }],
  },

  // ---- Bugs: catchable bait ----
  grub: {
    key: 'grub', name: 'Pale Grub', kind: 'bug', bait: 1, behavior: 'grazer',
    biomes: ['underground', 'cavern'], time: 'any', speed: 12, w: 7, h: 5,
    color: '#e8dcc4', color2: '#c0ad8e', skittish: 4,
    catchItem: 'grub',
  },
  worm: {
    key: 'worm', name: 'Loam Worm', kind: 'bug', bait: 1, behavior: 'grazer',
    biomes: ['forest', 'frostpine'], time: 'any', speed: 10, w: 8, h: 4,
    color: '#c98b7a', color2: '#9a6558', skittish: 4,
    catchItem: 'worm',
  },
  cricket: {
    key: 'cricket', name: 'Field Cricket', kind: 'bug', bait: 2, behavior: 'hopper',
    biomes: ['forest', 'dunes'], time: 'any', speed: 52, w: 7, h: 6,
    color: '#7a8a4a', color2: '#4f5c2e', skittish: 7,
    catchItem: 'cricket',
  },
  beetle: {
    key: 'beetle', name: 'Ironshell Beetle', kind: 'bug', bait: 2, behavior: 'grazer',
    biomes: ['underground', 'cavern', 'forest'], time: 'any', speed: 22, w: 9, h: 6,
    color: '#4a5464', color2: '#2e3642', skittish: 6,
    catchItem: 'beetle',
  },
  firefly: {
    key: 'firefly', name: 'Emberfly', kind: 'bug', bait: 3, behavior: 'flutter',
    biomes: ['forest', 'frostpine'], time: 'night', speed: 40, w: 6, h: 6,
    color: '#ffe9a0', color2: '#ffb347', light: 0.35, skittish: 6,
    catchItem: 'firefly',
  },
  glowmoth: {
    key: 'glowmoth', name: 'Glowmoth', kind: 'bug', bait: 3, behavior: 'flutter',
    biomes: ['underground', 'cavern'], time: 'any', speed: 34, w: 9, h: 8,
    color: '#cfe0ff', color2: '#8fa8d8', light: 0.28, skittish: 6,
    catchItem: 'glowmoth',
  },
};

export function faunaDef(key) { return FAUNA[key]; }
export const FAUNA_KEYS = Object.keys(FAUNA);
export const BUG_KEYS = FAUNA_KEYS.filter(k => FAUNA[k].kind === 'bug');
export const CRITTER_KEYS = FAUNA_KEYS.filter(k => FAUNA[k].kind === 'critter');
