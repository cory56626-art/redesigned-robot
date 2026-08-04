// Summoner Realms — the active boss catalogue.
//
// The reset deliberately retired the old encounters. The Mech and The Worm
// are the only active progression fights, so adding a new encounter never
// quietly re-enables the old boss chain.

// The Mech's rare reward is one slot, never two independent rolls. Keeping the
// roll here makes the 20% / otherwise-30% contract easy to test at its exact
// boundaries and prevents a future loot-table edit from dropping both weapons.
export function rollMechSpecialDrop(random = Math.random) {
  const roll = Number(random());
  if (roll < 0.20) return 'missileLauncher';
  if (roll < 0.50) return 'mechanicalSword';
  return null;
}

export const BOSSES = Object.freeze({
  theMech: {
    name: 'The Mech',
    // Seven tiles across and nearly seven high: it should feel like an arena
    // encounter, but still fit in the surface camera and an open player-built
    // arena.
    w: 112,
    h: 108,
    movement: 'mech',
    stepHeight: 16,
    spawnDistance: 240,
    maxHp: 1350,
    contactBase: 24,
    color: '#3b4b5d',
    color2: '#72ddff',
    biome: 'surface',
    summonItem: 'mechBeacon',
    summonGuide: {
      prep: 'Build a wide, flat arena before calling it so there is room to dodge missiles, jumps, and the Plasma Ray.',
      reward: 'It always drops a Mech Core and may also drop one special weapon: Missile Launcher (20%) or Mechanical Sword (30%).',
    },
    unlocksHardmode: true,
    loot: [
      { item: 'mechCore', min: 1, max: 1, chance: 1 },
    ],
    phases: [
      {
        at: 1,
        name: 'Siege Protocol',
        speed: 48,
        contact: 24,
        attacks: [
          // A normal-speed, shootable missile that follows the selected target
          // for five seconds, then detonates. The long fuse lets players run
          // it into terrain or destroy it instead of making it unavoidable.
          {
            type: 'mechMissile', weight: 1.55,
            cooldown: 8.2, telegraph: 0.9, recover: 0.72,
            minRange: 72, maxRange: 560, needsLos: true,
            count: 1, projSpeed: 170, homingStrength: 1.8,
            damage: 0, blastDamage: 26, blastRadius: 46,
          },
          // It only spends the huge jump when a target is genuinely airborne
          // or has opened a big gap, so its regular walk remains slow and
          // readable.
          {
            type: 'mechJump', weight: 2.4,
            cooldown: 7.6, telegraph: 0.82, recover: 0.92,
            when: 'airOrFar', triggerRange: 260,
            speed: 270,
          },
          {
            type: 'plasmaRay', weight: 1.35,
            cooldown: 7.4, telegraph: 1.08, recover: 0.9,
            minRange: 72, maxRange: 500, needsLos: true,
            duration: 1.55, fireInterval: 0.145, turnRate: 1.45,
            damage: 13, projSpeed: 670,
          },
        ],
      },
      {
        at: 0.5,
        name: 'Overdrive',
        speed: 60,
        contact: 30,
        attacks: [
          {
            type: 'mechMissile', weight: 1.55,
            cooldown: 6.9, telegraph: 0.82, recover: 0.64,
            minRange: 68, maxRange: 600, needsLos: true,
            count: 1, projSpeed: 182, homingStrength: 2.05,
            damage: 0, blastDamage: 31, blastRadius: 50,
          },
          {
            type: 'mechJump', weight: 2.05,
            cooldown: 6.2, telegraph: 0.68, recover: 0.84,
            when: 'airOrFar', triggerRange: 220,
            speed: 300,
          },
          {
            type: 'plasmaRay', weight: 1.5,
            cooldown: 6.3, telegraph: 0.88, recover: 0.78,
            minRange: 64, maxRange: 540, needsLos: true,
            duration: 1.9, fireInterval: 0.12, turnRate: 1.75,
            damage: 16, projSpeed: 720,
          },
          // Phase two's new move is a short, visibly shoulder-mounted fan.
          // It is fast enough to demand a dodge but leaves open lanes between
          // the shots, unlike adding a wall of unavoidable bullets.
          {
            type: 'mechVolley', weight: 1.15,
            cooldown: 8.4, telegraph: 0.82, recover: 0.82,
            minRange: 92, maxRange: 500, needsLos: true,
            count: 5, spread: 0.5, damage: 12, projSpeed: 540,
          },
        ],
      },
    ],
  },
  theWorm: {
    name: 'The Worm',
    // The visual body remains long, but its collision body is deliberately
    // smaller than the plates so natural cave ledges do not pin it in place.
    // If a path still closes off, its tunnel recovery burrow takes over.
    w: 88,
    h: 50,
    movement: 'worm',
    stepHeight: 24,
    spawnDistance: 210,
    segmentCount: 6,
    segmentLength: 17,
    maxHp: 1850,
    contactBase: 29,
    color: '#24182e',
    color2: '#c383ff',
    biome: 'surface',
    summonItem: 'wormLure',
    requiresBoss: 'theMech',
    summonGuide: {
      prep: 'Build a wide Surface arena. The Worm can pressure cover with a marked seismic breach, so do not try to box yourself in.',
      reward: 'It always drops a Worm Core.',
    },
    loot: [
      { item: 'wormCore', min: 1, max: 1, chance: 1 },
    ],
    phases: [
      {
        at: 1,
        name: 'Tunnel Hunt',
        speed: 64,
        contact: 29,
        attacks: [
          // The purple spit arcs rather than sniping in a straight line, so a
          // player can choose to sidestep it or get under it in a low tunnel.
          {
            type: 'wormSpit', weight: 1.25,
            cooldown: 5.8, telegraph: 0.86, recover: 0.72,
            minRange: 88, maxRange: 460, needsLos: true,
            count: 3, spread: 0.46, damage: 14, projSpeed: 360, poison: 1.8,
          },
          // The visible jaw wind-up leaves a real dodge window before the
          // grounded body commits to a fast horizontal rush.
          {
            type: 'wormCharge', weight: 1.45,
            cooldown: 7.1, telegraph: 0.94, recover: 0.88,
            minRange: 104, maxRange: 500, needsLos: true,
            speed: 342, duration: 0.78,
          },
          // Burrowing has no surprise hitbox: the warning ring marks where it
          // will surface for more than a second before contact resumes.
          {
            type: 'burrow', weight: 1.05,
            cooldown: 9.2, telegraph: 1.08, recover: 0.76,
            minRange: 92, maxRange: 560,
            burrowOffset: 118, burrowTime: 1.12,
          },
        ],
      },
      {
        at: 0.5,
        name: 'Deep Hunger',
        speed: 75,
        contact: 34,
        attacks: [
          {
            type: 'wormSpit', weight: 1.3,
            cooldown: 5.05, telegraph: 0.72, recover: 0.64,
            minRange: 80, maxRange: 490, needsLos: true,
            count: 5, spread: 0.58, damage: 16, projSpeed: 388, poison: 2.2,
          },
          {
            type: 'wormCharge', weight: 1.55,
            cooldown: 6.0, telegraph: 0.78, recover: 0.76,
            minRange: 92, maxRange: 540, needsLos: true,
            speed: 412, duration: 0.84,
          },
          {
            type: 'burrow', weight: 1.15,
            cooldown: 7.4, telegraph: 0.9, recover: 0.68,
            minRange: 76, maxRange: 600,
            burrowOffset: 150, burrowTime: 0.92,
          },
          // A single low quake travels out from the head on both sides. It is
          // quicker than phase one but remains jumpable instead of stacking a
          // wall of projectiles in a narrow cavern.
          {
            type: 'wormQuake', weight: 0.92,
            cooldown: 8.2, telegraph: 0.98, recover: 0.82,
            minRange: 56, maxRange: 520,
            damage: 16, projSpeed: 242,
          },
        ],
      },
    ],
  },
});

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.freeze(Object.keys(BOSSES));
