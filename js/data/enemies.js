// Summoner Realms — enemy definitions. All original creatures.
// behavior: walker | charger | flyer | hopper | caster
export const ENEMIES = {
  slugling: {
    key: 'slugling', name: 'Slugling', hp: 20, damage: 6, speed: 26, behavior: 'hopper',
    biomes: ['forest'], time: 'any', color: '#7ea04a', color2: '#5a7a30', w: 16, h: 12, kbResist: 0.2,
    drops: [{ item: 'fiber', chance: 0.7, min: 1, max: 2 }],
  },
  boar: {
    key: 'boar', name: 'Bristle Boar', hp: 44, damage: 12, speed: 46, behavior: 'charger',
    biomes: ['forest'], time: 'any', color: '#8a5a3a', color2: '#5a3a24', w: 24, h: 16, kbResist: 0.4,
    drops: [{ item: 'wood', chance: 0.6, min: 1, max: 3 }, { item: 'healLesser', chance: 0.08, min: 1, max: 1 }],
  },
  husk: {
    key: 'husk', name: 'Hollow Husk', hp: 32, damage: 11, speed: 40, behavior: 'walker',
    biomes: ['forest', 'corrupt'], time: 'night', color: '#5a6a4a', color2: '#3a4a30', w: 14, h: 24, kbResist: 0.3,
    drops: [{ item: 'fiber', chance: 0.5, min: 1, max: 2 }, { item: 'emberDust', chance: 0.05, min: 1, max: 1 }],
  },
  bat: {
    key: 'bat', name: 'Cave Flitter', hp: 16, damage: 8, speed: 78, behavior: 'flyer',
    biomes: ['underground', 'cavern'], time: 'any', color: '#6a5a7a', color2: '#463a5a', w: 16, h: 10, kbResist: 0.1,
    drops: [{ item: 'fiber', chance: 0.3, min: 1, max: 1 }],
  },
  crawler: {
    key: 'crawler', name: 'Rockback Crawler', hp: 46, damage: 12, speed: 34, behavior: 'walker',
    biomes: ['underground', 'cavern'], time: 'any', color: '#6f7484', color2: '#4a4e5a', w: 20, h: 14, kbResist: 0.5,
    drops: [{ item: 'stone', chance: 0.7, min: 1, max: 3 }, { item: 'cupriteOre', chance: 0.2, min: 1, max: 2 }],
  },
  bonepicker: {
    key: 'bonepicker', name: 'Bonepicker', hp: 56, damage: 16, speed: 58, behavior: 'walker',
    biomes: ['cavern'], time: 'any', color: '#e9e2c8', color2: '#b0a884', w: 16, h: 24, kbResist: 0.35,
    drops: [{ item: 'ironveinOre', chance: 0.25, min: 1, max: 2 }, { item: 'marrow', chance: 0.03, min: 1, max: 1 }],
  },
  blightcrawler: {
    key: 'blightcrawler', name: 'Blight Crawler', hp: 52, damage: 15, speed: 50, behavior: 'charger',
    biomes: ['corrupt'], time: 'any', color: '#8a4fb0', color2: '#5a2f7a', w: 22, h: 16, kbResist: 0.4,
    drops: [{ item: 'blightstone', chance: 0.5, min: 1, max: 2 }, { item: 'blightoreOre', chance: 0.1, min: 1, max: 1 }],
  },
  blightshade: {
    key: 'blightshade', name: 'Blightshade', hp: 40, damage: 12, speed: 30, behavior: 'caster',
    biomes: ['corrupt'], time: 'any', color: '#6d3f8a', color2: '#3a2050', w: 16, h: 22, kbResist: 0.25,
    projectile: { kind: 'blight', damage: 10, speed: 220, color: '#c58bff' },
    drops: [{ item: 'blightoreOre', chance: 0.2, min: 1, max: 1 }, { item: 'aetherShard', chance: 0.06, min: 1, max: 1 }],
  },
};

export function enemyDef(key) { return ENEMIES[key]; }
export const ENEMY_KEYS = Object.keys(ENEMIES);
