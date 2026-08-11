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
    biomes: ['forest', 'jungle', 'frostpine'], time: 'any', color: '#7ea04a', color2: '#5a7a30', w: 16, h: 12, kbResist: 0.2,
    aggroRange: 14, loseRange: 26, memory: 3, telegraph: 0.3,
    drops: [{ item: 'fiber', chance: 0.7, min: 1, max: 2 }],
  },
  boar: {
    key: 'boar', name: 'Bristle Boar', hp: 44, damage: 12, speed: 46, behavior: 'charger',
    biomes: ['forest', 'jungle', 'dunes'], time: 'any', color: '#8a5a3a', color2: '#5a3a24', w: 24, h: 16, kbResist: 0.4,
    aggroRange: 17, loseRange: 30, memory: 5, telegraph: 0.5,
    drops: [{ item: 'wood', chance: 0.6, min: 1, max: 3 }, { item: 'healLesser', chance: 0.08, min: 1, max: 1 }],
  },
  husk: {
    key: 'husk', name: 'Hollow Husk', hp: 32, damage: 11, speed: 40, behavior: 'walker',
    biomes: ['forest', 'jungle', 'corrupt', 'frostpine', 'dunes'], time: 'night', color: '#5a6a4a', color2: '#3a4a30', w: 14, h: 24, kbResist: 0.3,
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
    biomes: ['corrupt', 'infestedOcean'], time: 'any', color: '#8a4fb0', color2: '#5a2f7a', w: 22, h: 16, kbResist: 0.4,
    aggroRange: 19, loseRange: 34, memory: 6, telegraph: 0.45,
    drops: [{ item: 'blightstone', chance: 0.5, min: 1, max: 2 }],
  },
  // ---- The Mesh ----
  //
  // The Mesh used to borrow the cave pool and a handful of rust-coloured
  // reskins, which is why it had no identity of its own. Its six creatures are
  // all the same idea taken in different directions: something that used to be
  // machinery and is now mostly meat. Every one of them drops Mesh Sinew, so
  // the biome funds its own boss.
  sinewCrawler: {
    key: 'sinewCrawler', name: 'Sinew Crawler', hp: 64, damage: 16, speed: 52, behavior: 'charger',
    biomes: ['mesh', 'whirringOcean'], time: 'any', color: '#8a4a48', color2: '#3f2a2c', w: 24, h: 16, kbResist: 0.45,
    aggroRange: 18, loseRange: 32, memory: 6, telegraph: 0.4,
    drops: [{ item: 'meshSinew', chance: 0.75, min: 1, max: 3 }, { item: 'emberDust', chance: 0.3, min: 1, max: 2 }],
  },
  sporeDrone: {
    key: 'sporeDrone', name: 'Spore Drone', hp: 40, damage: 12, speed: 92, behavior: 'flyer',
    biomes: ['mesh'], time: 'any', color: '#c07a5a', color2: '#e8b070', w: 18, h: 14, kbResist: 0.15,
    aggroRange: 20, loseRange: 34, memory: 5, telegraph: 0.35,
    drops: [{ item: 'meshSinew', chance: 0.6, min: 1, max: 2 }],
  },
  gristleHusk: {
    key: 'gristleHusk', name: 'Gristle Husk', hp: 86, damage: 19, speed: 34, behavior: 'walker',
    biomes: ['mesh'], time: 'any', color: '#6b4348', color2: '#9aa0a4', w: 20, h: 28, kbResist: 0.6,
    aggroRange: 16, loseRange: 30, memory: 7, telegraph: 0.5,
    drops: [{ item: 'meshSinew', chance: 0.8, min: 2, max: 4 }, { item: 'stoneironOre', chance: 0.12, min: 1, max: 1 }],
  },
  wireSerpent: {
    key: 'wireSerpent', name: 'Wire Serpent', hp: 52, damage: 15, speed: 74, behavior: 'hopper',
    biomes: ['mesh', 'whirringOcean'], time: 'night', color: '#c45a2a', color2: '#5a2a18', w: 22, h: 12, kbResist: 0.25,
    aggroRange: 17, loseRange: 30, memory: 5, telegraph: 0.3, hazard: true,
    drops: [{ item: 'meshSinew', chance: 0.65, min: 1, max: 2 }, { item: 'emberDust', chance: 0.4, min: 1, max: 2 }],
  },
  // The Mesh's ranged answer: a knot of tissue on a spool that spits a live
  // strand. Slow, fragile, and the reason you cannot simply stand at range.
  strandSpitter: {
    key: 'strandSpitter', name: 'Strand Spitter', hp: 46, damage: 13, speed: 30, behavior: 'caster',
    biomes: ['mesh', 'whirringOcean'], time: 'any', color: '#a85a54', color2: '#8fd8e8', w: 18, h: 22, kbResist: 0.25,
    aggroRange: 22, loseRange: 36, memory: 6, telegraph: 0.5, fireRate: 2.1,
    projectile: { kind: 'strandSpit', damage: 12, speed: 235, color: '#c8f2ff' },
    drops: [{ item: 'meshSinew', chance: 0.7, min: 1, max: 3 }],
  },
  // The heavy. It only shows up once Vespera is down, which is exactly when a
  // player starts farming the Mesh for Woven Nexus components.
  meshBrute: {
    key: 'meshBrute', name: 'Mesh Brute', hp: 210, damage: 26, speed: 44, behavior: 'charger',
    biomes: ['mesh'], time: 'any', color: '#7d3f46', color2: '#d0705a', w: 30, h: 32, kbResist: 0.7,
    aggroRange: 20, loseRange: 38, memory: 9, telegraph: 0.55, requiresBoss: 'vespera',
    drops: [
      { item: 'meshSinew', chance: 1, min: 3, max: 6 },
      { item: 'healGreater', chance: 0.25, min: 1, max: 1 },
    ],
  },
  modulineDevil: {
    key: 'modulineDevil', name: 'Moduline Devil', hp: 420, damage: 22, speed: 54, behavior: 'caster',
    biomes: ['cavern'], time: 'any', color: '#c42828', color2: '#e8e0d0', w: 28, h: 36, kbResist: 0.65,
    aggroRange: 26, loseRange: 48, memory: 12, telegraph: 0.55, fireRate: 1.6,
    miniboss: true, teleport: true, stunScreech: true,
    projectile: { kind: 'modulineScreech', damage: 16, speed: 0, color: '#ff6060', effect: { stun: 1.2 } },
    drops: [
      { item: 'modulineOre', chance: 1, min: 6, max: 14 },
      { item: 'modulineBar', chance: 0.35, min: 1, max: 2 },
      { item: 'healGreater', chance: 0.4, min: 1, max: 2 },
    ],
  },
  blightshade: {
    key: 'blightshade', name: 'Blightshade', hp: 40, damage: 12, speed: 30, behavior: 'caster',
    biomes: ['corrupt'], time: 'any', color: '#6d3f8a', color2: '#3a2050', w: 16, h: 22, kbResist: 0.25,
    aggroRange: 21, loseRange: 36, memory: 6, telegraph: 0.5, fireRate: 2.0,
    projectile: { kind: 'blight', damage: 10, speed: 220, color: '#c58bff' },
    drops: [{ item: 'blightstone', chance: 0.2, min: 1, max: 1 }],
  },
  // Post-Worm overgrowth-cavern swarm. These only enter the natural cave pool
  // below forest or jungle surface bands, so their materials are an earned
  // exploration step rather than something that appears in every shallow cave.
  swarmStinger: {
    key: 'swarmStinger', name: 'Swarm Stinger', hp: 46, damage: 15, speed: 132, behavior: 'flyer',
    biomes: ['underground', 'cavern'], time: 'any', color: '#26202b', color2: '#d99b3e', w: 18, h: 12, kbResist: 0.18,
    aggroRange: 24, loseRange: 40, memory: 6, requiresBoss: 'theWorm', overgrowth: true,
    drops: [{ item: 'royalChitinPlate', chance: 0.46, min: 1, max: 2 }],
  },
  broodDrone: {
    key: 'broodDrone', name: 'Brood Drone', hp: 58, damage: 18, speed: 116, behavior: 'flyer',
    biomes: ['underground', 'cavern'], time: 'any', color: '#1d1721', color2: '#efbb57', w: 22, h: 15, kbResist: 0.28,
    aggroRange: 26, loseRange: 44, memory: 7, requiresBoss: 'theWorm', overgrowth: true, noBossLoot: true,
    drops: [
      { item: 'royalChitinPlate', chance: 0.70, min: 1, max: 2 },
      { item: 'venomCore', chance: 0.18, min: 1, max: 1 },
    ],
  },
  // Never appears naturally. Vespera hatches these from pods; their short
  // lifetime is assigned by spawnBossAdds so they cannot turn into a permanent
  // post-fight cleanup problem.
  swarmling: {
    key: 'swarmling', name: 'Swarmling', hp: 18, damage: 8, speed: 176, behavior: 'flyer',
    biomes: [], time: 'any', color: '#392d42', color2: '#b7df65', w: 12, h: 9, kbResist: 0.05,
    aggroRange: 28, loseRange: 48, memory: 5, drops: [],
  },
};

export function enemyDef(key) { return ENEMIES[key]; }
export const ENEMY_KEYS = Object.keys(ENEMIES);
