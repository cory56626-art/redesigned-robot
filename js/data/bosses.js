// Summoner Realms — boss definitions. Three original phased bosses.
// Each boss owns a different movement language and attack vocabulary.
//
// Attacks now run one at a time through the boss state machine, each preceded by
// a wind-up and followed by a recovery window, so cooldowns are shorter than
// they were when every attack ticked on its own independent timer.
//
//   telegraph : seconds of visible charge-up before the attack lands
//   recover   : seconds of reduced-speed vulnerability afterwards
//   weight    : relative likelihood when several attacks are available
//   minRange / maxRange : distance in pixels the attack is chosen within
//   needsLos  : only chosen when the boss can actually see the player
export const BOSSES = {
  grovekeeper: {
    key: 'grovekeeper', name: 'Grovekeeper', maxHp: 520, w: 46, h: 52,
    color: '#3a7a34', color2: '#a7e36f', biome: 'forest', summonItem: 'verdantEffigy',
    movement: 'grovekeeper', floatHeight: 105, contactBase: 14,
    phases: [
      { name: 'Phase I — The Ancient', at: 1.0, contact: 14, speed: 58, attacks: [
        { type: 'seedRain', cooldown: 2.4, telegraph: 0.7, recover: 0.5, weight: 3, count: 3, spread: 42, projKind: 'seed', projSpeed: 190, damage: 9 },
        { type: 'vineBurst', cooldown: 3.2, telegraph: 0.55, recover: 0.5, weight: 2, maxRange: 220, count: 5, projKind: 'thorn', projSpeed: 170, damage: 10 },
      ] },
      { name: 'Phase II — Rootbound', at: 0.5, contact: 18, speed: 78, attacks: [
        { type: 'seedRain', cooldown: 1.8, telegraph: 0.6, recover: 0.4, weight: 3, count: 5, spread: 54, projKind: 'seed', projSpeed: 230, damage: 11 },
        { type: 'vineBurst', cooldown: 3.0, telegraph: 0.5, recover: 0.45, weight: 2, maxRange: 240, count: 6, projKind: 'thorn', projSpeed: 200, damage: 11 },
        { type: 'leap', cooldown: 3.2, telegraph: 0.65, recover: 0.6, weight: 2, maxRange: 300, speed: 330, damage: 16 },
        { type: 'spawnAdds', cooldown: 8, telegraph: 0.8, recover: 0.6, weight: 1, enemy: 'slugling', addCount: 2 },
      ] },
    ],
    loot: [
      { item: 'groveHeart', chance: 1, min: 1, max: 1 },
      { item: 'cupriteBar', chance: 1, min: 6, max: 10 },
      { item: 'thornweaveMask', chance: 0.5, min: 1, max: 1 },
      { item: 'thornweaveMantle', chance: 0.5, min: 1, max: 1 },
      { item: 'thornweaveGuards', chance: 0.5, min: 1, max: 1 },
      { item: 'spriteWhistle', chance: 0.3, min: 1, max: 1 },
      { item: 'bomb', chance: 0.6, min: 3, max: 6 },
    ],
  },
  gravemaw: {
    key: 'gravemaw', name: 'Gravemaw', maxHp: 1050, w: 60, h: 46,
    color: '#75624b', color2: '#d3b985', biome: 'underground', summonItem: 'boneSigil',
    movement: 'gravemaw', contactBase: 20,
    phases: [
      { name: 'Phase I — Buried Hunger', at: 1.0, contact: 20, speed: 58, attacks: [
        { type: 'rockthrow', cooldown: 1.8, telegraph: 0.55, recover: 0.4, weight: 3, minRange: 90, needsLos: true, count: 1, projKind: 'rock', projSpeed: 280, gravity: true, damage: 14 },
        { type: 'shockwave', cooldown: 2.8, telegraph: 0.7, recover: 0.55, weight: 3, speed: 230, damage: 16 },
        { type: 'leap', cooldown: 4.0, telegraph: 0.6, recover: 0.5, weight: 2, minRange: 70, speed: 330, damage: 20 },
      ] },
      { name: 'Phase II — Open Maw', at: 0.5, contact: 27, speed: 82, attacks: [
        { type: 'rockthrow', cooldown: 1.3, telegraph: 0.45, recover: 0.35, weight: 3, minRange: 80, needsLos: true, count: 3, spread: 0.35, projKind: 'rock', projSpeed: 330, gravity: true, damage: 17 },
        { type: 'burrow', cooldown: 5.5, telegraph: 0.6, recover: 0.4, weight: 2, damage: 24 },
        { type: 'shockwave', cooldown: 2.2, telegraph: 0.6, recover: 0.5, weight: 3, speed: 300, damage: 21 },
        { type: 'spawnAdds', cooldown: 8, telegraph: 0.8, recover: 0.6, weight: 1, enemy: 'bonepicker', addCount: 2 },
      ] },
    ],
    loot: [
      { item: 'marrow', chance: 1, min: 1, max: 1 },
      { item: 'ironveinBar', chance: 1, min: 8, max: 12 },
      { item: 'glimmerBar', chance: 0.6, min: 2, max: 5 },
      { item: 'ironveinPlate', chance: 0.4, min: 1, max: 1 },
      { item: 'huntersGarb', chance: 0.4, min: 1, max: 1 },
      { item: 'dynamite', chance: 0.7, min: 3, max: 6 },
    ],
  },
  blightSovereign: {
    key: 'blightSovereign', name: 'Blight Sovereign', maxHp: 2200, w: 54, h: 64,
    color: '#693b91', color2: '#df8cff', biome: 'corrupt', summonItem: 'blightIdol',
    movement: 'sovereign', floatHeight: 72, contactBase: 26,
    phases: [
      { name: 'Phase I — The Court', at: 1.0, contact: 26, speed: 72, attacks: [
        { type: 'crystalRing', cooldown: 2.6, telegraph: 0.65, recover: 0.5, weight: 3, count: 6, projKind: 'crystal', projSpeed: 165, damage: 12 },
        { type: 'teleport', cooldown: 5.0, telegraph: 0.45, recover: 0.3, weight: 1, minRange: 60, damage: 0 },
        { type: 'volley', cooldown: 2.2, telegraph: 0.5, recover: 0.4, weight: 3, needsLos: true, count: 3, spread: 0.55, projKind: 'blight', projSpeed: 230, damage: 14 },
      ] },
      { name: 'Phase II — The Rot', at: 0.66, contact: 32, speed: 96, attacks: [
        { type: 'seedRain', cooldown: 2.0, telegraph: 0.6, recover: 0.4, weight: 3, count: 5, spread: 72, projKind: 'blight', projSpeed: 250, damage: 15 },
        { type: 'crystalRing', cooldown: 2.4, telegraph: 0.6, recover: 0.45, weight: 3, count: 8, projKind: 'crystal', projSpeed: 200, damage: 14 },
        { type: 'teleport', cooldown: 4.0, telegraph: 0.4, recover: 0.3, weight: 1, minRange: 60, damage: 0 },
        { type: 'spawnAdds', cooldown: 8, telegraph: 0.8, recover: 0.5, weight: 1, enemy: 'blightshade', addCount: 2 },
      ] },
      { name: 'Phase III — The Collapse', at: 0.33, contact: 40, speed: 125, attacks: [
        { type: 'homingBarrage', cooldown: 2.0, telegraph: 0.7, recover: 0.5, weight: 3, count: 5, projKind: 'voidorb', projSpeed: 175, damage: 16, homing: true },
        { type: 'crystalRing', cooldown: 2.2, telegraph: 0.55, recover: 0.4, weight: 3, count: 10, projKind: 'crystal', projSpeed: 235, damage: 16 },
        { type: 'teleport', cooldown: 3.2, telegraph: 0.35, recover: 0.25, weight: 2, minRange: 50, damage: 0 },
        { type: 'spawnAdds', cooldown: 9, telegraph: 0.8, recover: 0.5, weight: 1, enemy: 'blightshade', addCount: 3 },
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
