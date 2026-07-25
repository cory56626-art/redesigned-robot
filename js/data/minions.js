// Summoner Realms — minion definitions. Summoned by summoner weapons.
// behavior: homing | charge | dive | shooter | guard | fastmelee | diamondHeart
export const MINIONS = {
  wisp: {
    key: 'wisp', name: 'Wisp', behavior: 'homing', damage: 8, speed: 200, range: 300,
    color: '#9ec3ff', color2: '#cfe6ff', w: 10, h: 10, fireRate: 0.9,
    projectile: { kind: 'wispbolt', speed: 320, color: '#9ec3ff', homing: true },
    desc: 'A hovering wisp that fires homing bolts.',
  },
  beetle: {
    key: 'beetle', name: 'Carapace Beetle', behavior: 'charge', damage: 12, speed: 150, range: 260,
    color: '#c47b4a', color2: '#7a4a24', w: 16, h: 12, attackRate: 0.7,
    desc: 'A ground beetle that charges enemies.',
  },
  raven: {
    key: 'raven', name: 'Shadow Raven', behavior: 'dive', damage: 14, speed: 260, range: 320,
    color: '#4a3a5a', color2: '#7a6a9a', w: 16, h: 12, attackRate: 0.6,
    desc: 'A flying raven that dive-bombs foes.',
  },
  emberling: {
    key: 'emberling', name: 'Emberling', behavior: 'shooter', damage: 16, speed: 180, range: 340,
    color: '#ff7a3b', color2: '#ffcf6b', w: 12, h: 14, fireRate: 0.8,
    projectile: { kind: 'emberball', speed: 300, color: '#ff8c3b', effect: { burn: 2 } },
    desc: 'A fiery sprite that lobs fireballs.',
  },
  sentinel: {
    key: 'sentinel', name: 'Thorn Sentinel', behavior: 'guard', damage: 20, speed: 120, range: 150,
    color: '#5a7a3a', color2: '#3a5a24', w: 18, h: 22, attackRate: 0.5,
    desc: 'A rooted guardian that lashes nearby enemies.',
  },
  wraith: {
    key: 'wraith', name: 'Wraith', behavior: 'fastmelee', damage: 22, speed: 300, range: 360,
    color: '#b06bff', color2: '#7a3aae', w: 14, h: 18, attackRate: 0.35,
    desc: 'A swift wraith that slashes enemies rapidly.',
  },
  diamondHeart: {
    key: 'diamondHeart', name: 'Diamond Heart', behavior: 'diamondHeart',
    damage: 0, speed: 235, range: 620, color: '#dffcff', color2: '#62c9e8',
    w: 30, h: 42, maxHp: 100, flying: true,
    spearDamage: 16, spearRate: 5.8,
    dashDamage: 20, dashRate: 1.85, dashSpeed: 820, dashDuration: 0.30,
    dashTripleChance: 0.34,
    beamDamage: 50, beamRate: 5.2,
    desc: 'A winged crystal avatar with a great sword, explosive spear, triple dash, and sky beams.',
  },
};

export function minionDef(key) { return MINIONS[key]; }
export const MINION_KEYS = Object.keys(MINIONS);
