// Summoner Realms — boss definitions. Three original phased bosses.
// The boss AI in entities/boss.js interprets `phases[].attacks`.
export const BOSSES = {
  grovekeeper: {
    key: 'grovekeeper', name: 'Grovekeeper', maxHp: 600, w: 40, h: 44,
    color: '#3a7a34', color2: '#7ee08a', biome: 'forest', summonItem: 'verdantEffigy',
    movement: 'float', floatHeight: 90, contactBase: 16,
    phases: [
      { name: 'Phase I', at: 1.0, contact: 16, speed: 70, attacks: [
        { type: 'volley', cooldown: 2.2, count: 4, spread: 0.5, projKind: 'thorn', projSpeed: 240, damage: 12 },
        { type: 'charge', cooldown: 4.5, speed: 320, damage: 18 },
      ] },
      { name: 'Phase II — Enraged', at: 0.5, contact: 20, speed: 105, attacks: [
        { type: 'volley', cooldown: 1.4, count: 6, spread: 0.8, projKind: 'thorn', projSpeed: 280, damage: 14 },
        { type: 'charge', cooldown: 3.2, speed: 400, damage: 22 },
        { type: 'spawnAdds', cooldown: 6, enemy: 'slugling', addCount: 2 },
      ] },
    ],
    loot: [
      { item: 'groveHeart', chance: 1, min: 1, max: 1 },
      { item: 'cupriteBar', chance: 1, min: 6, max: 10 },
      { item: 'thornweaveMask', chance: 0.5, min: 1, max: 1 },
      { item: 'thornweaveMantle', chance: 0.5, min: 1, max: 1 },
      { item: 'thornweaveGuards', chance: 0.5, min: 1, max: 1 },
      { item: 'spriteWhistle', chance: 0.3, min: 1, max: 1 },
    ],
  },
  gravemaw: {
    key: 'gravemaw', name: 'Gravemaw', maxHp: 1100, w: 48, h: 40,
    color: '#8a7a5a', color2: '#e9e2c8', biome: 'underground', summonItem: 'boneSigil',
    movement: 'ground', contactBase: 20,
    phases: [
      { name: 'Phase I', at: 1.0, contact: 20, speed: 60, attacks: [
        { type: 'rockthrow', cooldown: 2.0, count: 1, projKind: 'rock', projSpeed: 300, gravity: true, damage: 16 },
        { type: 'charge', cooldown: 3.5, speed: 340, damage: 22 },
      ] },
      { name: 'Phase II — Frenzy', at: 0.5, contact: 26, speed: 90, attacks: [
        { type: 'rockthrow', cooldown: 1.4, count: 3, spread: 0.4, projKind: 'rock', projSpeed: 340, gravity: true, damage: 18 },
        { type: 'burrow', cooldown: 7, damage: 26 },
        { type: 'spawnAdds', cooldown: 6, enemy: 'bonepicker', addCount: 2 },
      ] },
    ],
    loot: [
      { item: 'marrow', chance: 1, min: 1, max: 1 },
      { item: 'ironveinBar', chance: 1, min: 8, max: 12 },
      { item: 'glimmerBar', chance: 0.6, min: 2, max: 5 },
      { item: 'ironveinPlate', chance: 0.4, min: 1, max: 1 },
      { item: 'huntersGarb', chance: 0.4, min: 1, max: 1 },
    ],
  },
  blightSovereign: {
    key: 'blightSovereign', name: 'Blight Sovereign', maxHp: 1800, w: 44, h: 54,
    color: '#8a4fb0', color2: '#c58bff', biome: 'corrupt', summonItem: 'blightIdol',
    movement: 'float', floatHeight: 120, contactBase: 24,
    phases: [
      { name: 'Phase I', at: 1.0, contact: 24, speed: 85, attacks: [
        { type: 'volley', cooldown: 1.8, count: 5, spread: 0.7, projKind: 'blight', projSpeed: 260, damage: 18 },
        { type: 'charge', cooldown: 4.0, speed: 360, damage: 26 },
      ] },
      { name: 'Phase II — Corruption', at: 0.66, contact: 30, speed: 110, attacks: [
        { type: 'sweep', cooldown: 3.0, count: 12, projKind: 'blight', projSpeed: 240, damage: 20 },
        { type: 'spawnAdds', cooldown: 6, enemy: 'blightshade', addCount: 2 },
        { type: 'volley', cooldown: 1.5, count: 6, spread: 0.9, projKind: 'blight', projSpeed: 300, damage: 20 },
      ] },
      { name: 'Phase III — Ascendant', at: 0.33, contact: 36, speed: 150, attacks: [
        { type: 'homingBarrage', cooldown: 2.2, count: 6, projKind: 'voidorb', projSpeed: 180, damage: 22, homing: true },
        { type: 'charge', cooldown: 2.8, speed: 460, damage: 32 },
        { type: 'sweep', cooldown: 3.4, count: 16, projKind: 'blight', projSpeed: 280, damage: 22 },
      ] },
    ],
    loot: [
      { item: 'sovereignCore', chance: 1, min: 1, max: 1 },
      { item: 'blightBar', chance: 1, min: 10, max: 14 },
      { item: 'blightCuirass', chance: 0.5, min: 1, max: 1 },
      { item: 'blightHelm', chance: 0.5, min: 1, max: 1 },
      { item: 'blightGreaves', chance: 0.5, min: 1, max: 1 },
      { item: 'voidlance', chance: 0.25, min: 1, max: 1 },
      { item: 'aetheredgeGreatblade', chance: 0.2, min: 1, max: 1 },
    ],
  },
};

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.keys(BOSSES);
