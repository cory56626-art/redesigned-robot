// Summoner Realms — minion definitions. Summoned by summoner weapons.
// behavior: homing | charge | dive | shooter | guard | fastmelee | diamondHeart | aidan
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
    damage: 0, speed: 280, range: 620, color: '#dffcff', color2: '#62c9e8',
    w: 30, h: 42, maxHp: 300, flying: true,
    spearDamage: 22, spearRate: 3.2,
    dashDamage: 24, dashRate: 1.85, dashSpeed: 820, dashDuration: 0.30,
    dashTripleChance: 0.34,
    beamDamage: 3, beamTick: 0.1, beamDuration: 2.5, beamWindup: 0.8, beamBlinkInterval: 0.3, beamFlashDuration: 0.1, beamHitWidth: 24, dodgeSpeed: 680, dodgeDuration: 0.20, dodgeRate: 1.10, beamRate: 5.2,
    desc: 'A winged crystal avatar with a great sword, explosive spear, triple dash, and sky beams.',
  },
  aidan: {
    key: 'aidan', name: 'Aidan', behavior: 'aidan',
    damage: 30, speed: 180, range: 1800, color: '#c88b2e', color2: '#5a341d',
    w: 12, h: 26, maxHp: 1400, flying: false,
    basicDamage: 30, basicRate: 1.05, basicSpeed: 720, basicRange: 352,
    portalTrigger: 360, portalSourceDistance: 64, portalExitDistance: 80, portalCooldown: 2.2,
    railgunDamage: 75, railgunCharge: 5, railgunCooldown: 14, railgunRange: 1800, railgunMinRange: 192,
    radioDamage: 5, radioTick: 0.5, radioDuration: 20,
    freezeDamage: 0, freezeCharge: 0.7, freezeDuration: 5, freezeSpeed: 520, freezeCooldown: 8.0, freezeRange: 900,
    freezeTriggerHits: 3, freezeTriggerDamage: 24, freezeTriggerWindow: 2.5,
    novaDamage: 12, novaCount: 8, novaSpeed: 380, novaLife: 0.85, novaRadius: 96,
    novaTriggerRange: 126, novaCharge: 0.42, novaCooldown: 6.5,
    phaseDashDamage: 30, phaseDashSpeed: 520, phaseDashDuration: 0.28,
    phaseDashRange: 250, phaseDashMinRange: 72, phaseDashCharge: 0.20, phaseDashCooldown: 5.5,
    jetpackDuration: 1.55, jetpackCooldown: 4.0,
    desc: 'Aidan, the player-sized grounded nanotech summon: Portal Pursuit, Purple Railgun, defensive Freeze Gun, Nanite Nova, Phase Dash, stronger pulse fire, and jetpack recovery.',
  },
};

export function minionDef(key) { return MINIONS[key]; }
export const MINION_KEYS = Object.keys(MINIONS);
