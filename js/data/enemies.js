// Summoner Realms — enemy definitions. All original creatures.
//
// behavior   : walker | charger | flyer | hopper | caster
// aggroRange : tiles at which it notices a player it can see
// loseRange  : tiles at which it drops the hunt outright
// memory     : seconds it keeps hunting your last known position after losing
//              sight of you
// telegraph  : seconds of visible wind-up before an attack lands
export const ENEMIES = {
  slugling: {
    key: 'slugling', name: 'Slugling', hp: 20, damage: 6, speed: 26, behavior: 'hopper',
    biomes: ['forest', 'frostpine'], time: 'any', color: '#7ea04a', color2: '#5a7a30', w: 16, h: 12, kbResist: 0.2,
    aggroRange: 14, loseRange: 26, memory: 3, telegraph: 0.3,
    drops: [{ item: 'fiber', chance: 0.7, min: 1, max: 2 }],
  },
  boar: {
    key: 'boar', name: 'Bristle Boar', hp: 44, damage: 12, speed: 46, behavior: 'charger',
    biomes: ['forest', 'dunes'], time: 'any', color: '#8a5a3a', color2: '#5a3a24', w: 24, h: 16, kbResist: 0.4,
    aggroRange: 17, loseRange: 30, memory: 5, telegraph: 0.5,
    drops: [{ item: 'wood', chance: 0.6, min: 1, max: 3 }, { item: 'healLesser', chance: 0.08, min: 1, max: 1 }],
  },
  husk: {
    key: 'husk', name: 'Hollow Husk', hp: 32, damage: 11, speed: 40, behavior: 'walker',
    biomes: ['forest', 'corrupt', 'frostpine', 'dunes'], time: 'night', color: '#5a6a4a', color2: '#3a4a30', w: 14, h: 24, kbResist: 0.3,
    aggroRange: 18, loseRange: 34, memory: 6, telegraph: 0.35,
    drops: [{ item: 'fiber', chance: 0.5, min: 1, max: 2 }, { item: 'emberDust', chance: 0.05, min: 1, max: 1 }],
  },
  duneStalker: {
    key: 'duneStalker', name: 'Dune Stalker', hp: 38, damage: 13, speed: 62, behavior: 'walker',
    biomes: ['dunes'], time: 'any', color: '#c2a56a', color2: '#8e7442', w: 18, h: 18, kbResist: 0.25,
    aggroRange: 22, loseRange: 38, memory: 7, telegraph: 0.3,
    drops: [{ item: 'sand', chance: 0.7, min: 1, max: 3 }, { item: 'fiber', chance: 0.3, min: 1, max: 2 }],
  },
  rimeWisp: {
    key: 'rimeWisp', name: 'Rime Wisp', hp: 26, damage: 10, speed: 84, behavior: 'caster',
    biomes: ['frostpine'], time: 'any', color: '#9fd4e8', color2: '#5f93ad', w: 14, h: 16, kbResist: 0.1,
    aggroRange: 20, loseRange: 32, memory: 4, telegraph: 0.45, fireRate: 2.2,
    projectile: { kind: 'crystal', damage: 9, speed: 210, color: '#bfe9ff' },
    drops: [{ item: 'ice', chance: 0.6, min: 1, max: 2 }],
  },
  borealLynx: {
    key: 'borealLynx', name: 'Boreal Lynx', hp: 48, damage: 15, speed: 66, behavior: 'charger',
    biomes: ['snowyTaiga'], time: 'any', color: '#dcecf0', color2: '#6e95a8', w: 22, h: 16, kbResist: 0.35,
    aggroRange: 19, loseRange: 34, memory: 5, telegraph: 0.42,
    drops: [{ item: 'rawGame', chance: 0.65, min: 1, max: 2 }],
  },
  auroraWisp: {
    key: 'auroraWisp', name: 'Aurora Wisp', hp: 34, damage: 12, speed: 78, behavior: 'caster',
    biomes: ['snowyTaiga'], time: 'any', color: '#a6f6d9', color2: '#3b99a5', w: 14, h: 18, kbResist: 0.1,
    aggroRange: 21, loseRange: 35, memory: 5, telegraph: 0.5, fireRate: 2.15,
    projectile: { kind: 'aurora', damage: 10, speed: 225, color: '#b9ffe8' },
    drops: [{ item: 'ice', chance: 0.65, min: 1, max: 2 }],
  },
  bat: {
    key: 'bat', name: 'Cave Flitter', hp: 16, damage: 8, speed: 78, behavior: 'flyer',
    biomes: ['underground', 'cavern'], time: 'any', color: '#6a5a7a', color2: '#463a5a', w: 16, h: 10, kbResist: 0.1,
    aggroRange: 13, loseRange: 24, memory: 3,
    drops: [{ item: 'fiber', chance: 0.3, min: 1, max: 1 }],
  },
  crawler: {
    key: 'crawler', name: 'Rockback Crawler', hp: 46, damage: 12, speed: 34, behavior: 'walker',
    biomes: ['underground', 'cavern'], time: 'any', color: '#6f7484', color2: '#4a4e5a', w: 20, h: 14, kbResist: 0.5,
    aggroRange: 15, loseRange: 28, memory: 5, telegraph: 0.35,
    drops: [{ item: 'stone', chance: 0.7, min: 1, max: 3 }],
  },
  bonepicker: {
    key: 'bonepicker', name: 'Bonepicker', hp: 56, damage: 16, speed: 58, behavior: 'walker',
    biomes: ['cavern'], time: 'any', color: '#e9e2c8', color2: '#b0a884', w: 16, h: 24, kbResist: 0.35,
    aggroRange: 19, loseRange: 34, memory: 7, telegraph: 0.35,
    drops: [{ item: 'stone', chance: 0.35, min: 1, max: 2 }],
  },
  blightcrawler: {
    key: 'blightcrawler', name: 'Blight Crawler', hp: 52, damage: 15, speed: 50, behavior: 'charger',
    biomes: ['corrupt'], time: 'any', color: '#8a4fb0', color2: '#5a2f7a', w: 22, h: 16, kbResist: 0.4,
    aggroRange: 19, loseRange: 34, memory: 6, telegraph: 0.45,
    drops: [{ item: 'blightstone', chance: 0.5, min: 1, max: 2 }],
  },
  blightshade: {
    key: 'blightshade', name: 'Blightshade', hp: 40, damage: 12, speed: 30, behavior: 'caster',
    biomes: ['corrupt'], time: 'any', color: '#6d3f8a', color2: '#3a2050', w: 16, h: 22, kbResist: 0.25,
    aggroRange: 21, loseRange: 36, memory: 6, telegraph: 0.5, fireRate: 2.0,
    projectile: { kind: 'blight', damage: 10, speed: 220, color: '#c58bff' },
    drops: [{ item: 'blightstone', chance: 0.2, min: 1, max: 1 }],
  },
};

export function enemyDef(key) { return ENEMIES[key]; }
export const ENEMY_KEYS = Object.keys(ENEMIES);
