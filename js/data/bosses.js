// Summoner Realms — boss definitions. Three original phased bosses.
// Each boss owns a different movement language and attack vocabulary.
export const BOSSES = {
  grovekeeper: {
    key: 'grovekeeper', name: 'Grovekeeper', maxHp: 520, w: 46, h: 52,
    color: '#3a7a34', color2: '#a7e36f', biome: 'forest', summonItem: 'verdantEffigy',
    movement: 'grovekeeper', floatHeight: 105, contactBase: 14,
    phases: [
      { name: 'Phase I — The Ancient', at: 1.0, contact: 14, speed: 58, attacks: [
        { type: 'seedRain', cooldown: 3.2, count: 3, spread: 42, projKind: 'seed', projSpeed: 190, damage: 9 },
        { type: 'vineBurst', cooldown: 4.5, count: 5, projKind: 'thorn', projSpeed: 170, damage: 10 },
      ] },
      { name: 'Phase II — Rootbound', at: 0.5, contact: 18, speed: 78, attacks: [
        { type: 'seedRain', cooldown: 2.2, count: 5, spread: 54, projKind: 'seed', projSpeed: 230, damage: 11 },
        { type: 'leap', cooldown: 3.8, speed: 330, damage: 16 },
        { type: 'spawnAdds', cooldown: 7, enemy: 'slugling', addCount: 2 },
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
    key: 'gravemaw', name: 'Gravemaw', maxHp: 1050, w: 60, h: 46,
    color: '#75624b', color2: '#d3b985', biome: 'underground', summonItem: 'boneSigil',
    movement: 'gravemaw', contactBase: 20,
    phases: [
      { name: 'Phase I — Buried Hunger', at: 1.0, contact: 20, speed: 58, attacks: [
        { type: 'rockthrow', cooldown: 2.3, count: 1, projKind: 'rock', projSpeed: 280, gravity: true, damage: 14 },
        { type: 'shockwave', cooldown: 3.8, speed: 230, damage: 16 },
        { type: 'leap', cooldown: 5.0, speed: 330, damage: 20 },
      ] },
      { name: 'Phase II — Open Maw', at: 0.5, contact: 27, speed: 82, attacks: [
        { type: 'rockthrow', cooldown: 1.5, count: 3, spread: 0.35, projKind: 'rock', projSpeed: 330, gravity: true, damage: 17 },
        { type: 'burrow', cooldown: 6.0, damage: 24 },
        { type: 'shockwave', cooldown: 2.8, speed: 300, damage: 21 },
        { type: 'spawnAdds', cooldown: 7, enemy: 'bonepicker', addCount: 2 },
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
    key: 'blightSovereign', name: 'Blight Sovereign', maxHp: 2200, w: 54, h: 64,
    color: '#693b91', color2: '#df8cff', biome: 'corrupt', summonItem: 'blightIdol',
    movement: 'sovereign', floatHeight: 72, contactBase: 26,
    phases: [
      { name: 'Phase I — The Court', at: 1.0, contact: 26, speed: 72, attacks: [
        { type: 'crystalRing', cooldown: 3.4, count: 6, projKind: 'crystal', projSpeed: 165, damage: 12 },
        { type: 'teleport', cooldown: 5.5, damage: 0 },
        { type: 'volley', cooldown: 3.0, count: 3, spread: 0.55, projKind: 'blight', projSpeed: 230, damage: 14 },
      ] },
      { name: 'Phase II — The Rot', at: 0.66, contact: 32, speed: 96, attacks: [
        { type: 'seedRain', cooldown: 2.4, count: 5, spread: 72, projKind: 'blight', projSpeed: 250, damage: 15 },
        { type: 'crystalRing', cooldown: 3.0, count: 8, projKind: 'crystal', projSpeed: 200, damage: 14 },
        { type: 'teleport', cooldown: 4.2, damage: 0 },
        { type: 'spawnAdds', cooldown: 7, enemy: 'blightshade', addCount: 2 },
      ] },
      { name: 'Phase III — The Collapse', at: 0.33, contact: 40, speed: 125, attacks: [
        { type: 'homingBarrage', cooldown: 2.5, count: 5, projKind: 'voidorb', projSpeed: 175, damage: 16, homing: true },
        { type: 'crystalRing', cooldown: 2.8, count: 10, projKind: 'crystal', projSpeed: 235, damage: 16 },
        { type: 'teleport', cooldown: 3.4, damage: 0 },
        { type: 'spawnAdds', cooldown: 8, enemy: 'blightshade', addCount: 3 },
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
