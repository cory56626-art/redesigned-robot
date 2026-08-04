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

// Vespera always gives exactly one class weapon. Keeping this choice here, as
// with The Mech's special drop, makes the one-from-the-pool contract explicit
// and prevents a future loot edit from silently dropping two weapons at once.
export function rollVesperaWeaponDrop(random = Math.random) {
  const pool = ['stingerBow', 'mandibleEdge', 'hiveCatalyst', 'broodStaff'];
  const roll = Math.max(0, Math.min(0.999999, Number(random()) || 0));
  return pool[Math.floor(roll * pool.length)];
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
  vespera: {
    name: 'Vespera',
    // A little over 3.5 player-heights tall. The wide body and wings make her
    // read as an apex aerial threat without becoming too large for a surface
    // arena or the default camera.
    w: 112,
    h: 94,
    movement: 'vespera',
    spawnDistance: 250,
    maxHp: 5550, // exactly 3× The Worm before difficulty scaling
    contactBase: 39,
    color: '#17131b',
    color2: '#efbb57',
    biome: 'surface',
    requiresNight: true,
    requiresBoss: 'theWorm',
    summonItem: 'hiveResonanceCore',
    summonGuide: {
      prep: 'Call Vespera on the Surface at night. Build width and vertical lanes into the arena: her venom zones and dives punish standing still.',
      reward: 'She always drops Royal Chitin Plates, Venom Cores, a Wasp Emblem, and one weapon from her class pool. Vespera Wings are rare.',
    },
    loot: [
      { item: 'royalChitinPlate', min: 8, max: 12, chance: 1 },
      { item: 'venomCore', min: 3, max: 5, chance: 1 },
      { item: 'waspEmblem', min: 1, max: 1, chance: 1 },
      { item: 'vesperaWings', min: 1, max: 1, chance: 0.02 },
    ],
    phases: [
      {
        at: 1,
        name: 'Apex Hunt',
        speed: 186,
        contact: 39,
        floatHeight: 142,
        attacks: [
          {
            type: 'apexDive', weight: 1.45,
            cooldown: 7.6, telegraph: 0.88, recover: 0.58,
            minRange: 70, maxRange: 700,
            dives: 1, orbitTime: 0.72, diveSpeed: 630, diveDuration: 0.36,
          },
          {
            type: 'injectorBurst', weight: 1.30,
            cooldown: 6.2, telegraph: 0.86, recover: 0.58,
            minRange: 108, maxRange: 660,
            count: 9, frenzyCount: 11, spread: 1.46, damage: 13, projSpeed: 520,
            homingStrength: 0.72, poison: 2.3,
          },
          {
            type: 'broodDrop', weight: 1.08,
            cooldown: 8.5, telegraph: 0.92, recover: 0.64,
            minRange: 76, maxRange: 640,
            count: 2, frenzyCount: 4, damage: 7, podFuse: 1.18, frenzyFuse: 0.66,
          },
          {
            type: 'wingPressure', weight: 1.00,
            cooldown: 8.9, telegraph: 0.90, recover: 0.62,
            minRange: 72, maxRange: 600,
            count: 5, damage: 10, projSpeed: 315, homingStrength: 1.16,
            gustSpeed: 245, gustLift: 150, poison: 1.8,
          },
          {
            type: 'swarmCall', weight: 0.94,
            cooldown: 9.4, telegraph: 0.82, recover: 0.58,
            minRange: 56, maxRange: 680,
            addMin: 3, addMax: 5,
          },
        ],
      },
      {
        at: 0.65,
        name: 'Fractured Crown',
        speed: 236,
        contact: 45,
        floatHeight: 158,
        attacks: [
          {
            type: 'apexDive', weight: 1.28,
            cooldown: 5.5, telegraph: 0.56, recover: 0.42,
            minRange: 64, maxRange: 740,
            dives: 2, orbitTime: 0.48, diveSpeed: 710, diveDuration: 0.34,
          },
          {
            type: 'injectorBurst', weight: 1.34,
            cooldown: 4.85, telegraph: 0.58, recover: 0.40,
            minRange: 94, maxRange: 700,
            count: 9, frenzyCount: 11, spread: 1.52, damage: 15, projSpeed: 566,
            homingStrength: 0.86, poison: 2.7,
          },
          {
            type: 'broodDrop', weight: 1.16,
            cooldown: 6.65, telegraph: 0.60, recover: 0.45,
            minRange: 72, maxRange: 680,
            count: 2, frenzyCount: 4, damage: 8, podFuse: 0.94, frenzyFuse: 0.54,
          },
          {
            type: 'wingPressure', weight: 1.04,
            cooldown: 6.9, telegraph: 0.58, recover: 0.46,
            minRange: 66, maxRange: 650,
            count: 5, damage: 12, projSpeed: 352, homingStrength: 1.35,
            gustSpeed: 280, gustLift: 170, poison: 2.1,
          },
          {
            type: 'swarmCall', weight: 0.98,
            cooldown: 7.1, telegraph: 0.54, recover: 0.42,
            minRange: 50, maxRange: 720,
            addMin: 3, addMax: 5,
          },
          {
            type: 'executionDive', weight: 1.18,
            cooldown: 8.8, telegraph: 0.72, recover: 0.62,
            minRange: 92, maxRange: 760,
            dives: 4, orbitTime: 0.36, diveSpeed: 760, diveDuration: 0.29,
          },
          {
            type: 'hiveTrails', weight: 0.92,
            cooldown: 8.0, telegraph: 0.56, recover: 0.40,
            minRange: 70, maxRange: 700,
            duration: 2.45, interval: 0.30,
          },
        ],
      },
    ],
  },
});

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.freeze(Object.keys(BOSSES));
