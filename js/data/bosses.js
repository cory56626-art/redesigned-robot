// Summoner Realms — the active pre-Hardmode boss catalogue.
//
// The reset deliberately retired the old encounters. The Mech is the first
// boss brought back into the new eight-ore progression, so this file exposes
// exactly one fight and cannot quietly re-enable the old boss chain.

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
});

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.freeze(Object.keys(BOSSES));
