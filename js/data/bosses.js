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
  // ---------------------------------------------------------------------
  // Slot 5 — the evil-biome pair.
  //
  // A world carries exactly one evil biome, so these two are *alternatives*,
  // not a chain: a Corruption world answers to The Hollowed Choir and a Mesh
  // world answers to The Weave, and clearing either one is the whole of slot 5
  // for that realm. Neither lists the other in `requiresBoss`; both sit behind
  // Vespera and behind their own biome (`biome`, checked by trySummonBoss).
  //
  // A note on the speed numbers. The design brief quotes movement in tiles per
  // second (1.8 slow / 2.5 medium / 3.0 fast). Taken literally that is 29–48
  // px/s against a player who runs at ~150, which would make both fights pure
  // kiting. The *relationships* are what matter, so the tiers are mapped onto
  // this engine's px/s scale — slow < medium < fast, and every tier still under
  // the player's run speed so positioning stays the answer.
  hollowedChoir: {
    name: 'The Hollowed Choir',
    // Eleven tiles across and seven high. The reference silhouette is much
    // wider than it is tall — a heap that has spread under its own weight —
    // and the splayed support limbs push past even that.
    w: 176, h: 116,
    movement: 'choir',
    stepHeight: 22,
    spawnDistance: 250,
    maxHp: 12000,
    defense: 12,
    contactBase: 33,
    color: '#4a2f52', color2: '#f062a8',
    biome: 'corrupt',
    evilBiome: 'corrupt',
    summonItem: 'choirEffigy',
    requiresBoss: 'vespera',
    // A tighter arena than the default 46 tiles. A grounded boss this slow can
    // be walked away from indefinitely otherwise: at 26 tiles the standoff
    // where nothing reaches you is also the distance at which it starts to
    // enrage, so the fight has to actually be fought.
    arenaTiles: 26,
    // Phase two splits the mass into husks, which spawn as their own bosses
    // sharing this bar. See Game.spawnChoirHusks.
    splitInto: 'choirHusk',
    splitCount: 3,
    barGroup: 'hollowedChoir',
    summonGuide: {
      prep: 'Call it inside the Corrupted Lands. Keep the ground open: at 55% the mass unravels into three husks that chase you from three directions, and two husks left alone together will re-fuse and heal.',
      reward: 'Always drops Choir Remnants, the full Hollowed Plate set, and The Hollow.',
    },
    loot: [
      { item: 'choirRemnant', min: 14, max: 22, chance: 1 },
      { item: 'hollowedPlateHelm', min: 1, max: 1, chance: 1 },
      { item: 'hollowedPlateMail', min: 1, max: 1, chance: 1 },
      { item: 'hollowedPlateGreaves', min: 1, max: 1, chance: 1 },
      { item: 'theHollow', min: 1, max: 1, chance: 1 },
    ],
    phases: [
      {
        at: 1,
        name: 'Fused',
        speed: 62,          // "slow, lurching"
        contact: 33,
        attacks: [
          // Two or three arms stretch out of the mass toward where you are
          // standing. The wind-up is long and the arms are visible the whole
          // time, so this is a positioning check rather than a reaction test.
          //
          // The reach is deliberately long. A grounded boss this slow cannot
          // threaten a player who simply runs, and a boss you can walk away
          // from is not a fight — so the *arms* cover the ground the body
          // cannot, which is what "reaching" was supposed to mean.
          {
            type: 'reachingGrasp', weight: 1.6,
            cooldown: 2.0, telegraph: 0.6, recover: 0.5,
            minRange: 0, maxRange: 480,
            count: 3, damage: 60, reach: 300,
          },
          // The wail: the whole body convulses, faces surface across it, and a
          // ring of slow spores bursts outward with wide gaps between them.
          // Slow, but faster than a sprint — running in a straight line away
          // from it should not be a free answer.
          {
            type: 'choirWail', weight: 1.15,
            cooldown: 4.0, telegraph: 0.7, recover: 0.6,
            minRange: 0, maxRange: 620,
            count: 8, damage: 40, projSpeed: 260,
          },
          // A committed forward lurch that smears corrupted ground behind it.
          // Standing in the smear ticks; crossing it once does not. The smear
          // is the real answer to kiting: it takes the lane away rather than
          // trying to out-run someone.
          {
            type: 'lurchCharge', weight: 1.35,
            cooldown: 3.5, telegraph: 0.62, recover: 0.75,
            minRange: 70, maxRange: 620,
            speed: 430, duration: 0.72, damage: 70,
            trailDamage: 3, trailLife: 3.5, trailInterval: 0.08,
          },
        ],
      },
      {
        at: 0.55,
        name: 'Unraveling',
        speed: 120,         // per husk: "medium", faster individually
        contact: 33,
        attacks: [
          // The husks own their own attacks (see the choirHusk entry). This
          // phase exists so the parent's HP threshold is a real phase change
          // the bar and the toast can report before the split happens.
          {
            type: 'unravel', weight: 1,
            cooldown: 99, telegraph: 0.9, recover: 0.4,
          },
        ],
      },
    ],
  },
  // One third of the Choir. Never summonable and never listed in the guide:
  // it only exists between the parent's split and the end of the fight.
  choirHusk: {
    name: 'Hollowed Husk',
    w: 56, h: 52,
    movement: 'husk',
    stepHeight: 20,
    spawnDistance: 90,
    maxHp: 4000,        // 12k / 3
    defense: 12,
    contactBase: 33,
    color: '#4a2f52', color2: '#b9d16a',
    biome: 'corrupt',
    hidden: true,
    parentBoss: 'hollowedChoir',
    barGroup: 'hollowedChoir',
    loot: [],
    phases: [
      {
        at: 1,
        name: 'Unraveling',
        speed: 120,
        contact: 33,
        attacks: [
          {
            type: 'snapBite', weight: 1,
            cooldown: 1.5, telegraph: 0.34, recover: 0.32,
            minRange: 0, maxRange: 118,
            damage: 45, knockback: 6,
          },
        ],
      },
    ],
  },
  theWeave: {
    name: 'The Weave',
    // The formation's bounding diamond. The strands between the nodes are part
    // of the creature, so the box is the creature rather than dead air.
    w: 148, h: 132,
    movement: 'weave',
    spawnDistance: 250,
    maxHp: 12000,
    defense: 12,
    contactBase: 33,
    color: '#3d2a26', color2: '#8fd8e8',
    biome: 'mesh',
    evilBiome: 'mesh',
    summonItem: 'wovenNexus',
    requiresBoss: 'vespera',
    arenaTiles: 30,
    barGroup: 'theWeave',
    nodeCount: 4,
    summonGuide: {
      prep: 'Call it inside the Mesh. Fight it in the open and spread your damage: a node dropped below a quarter of its share retracts and regenerates, so focusing one down is the slowest way to kill it.',
      reward: 'Always drops Woven Tissue, the full Frayed Plate set, and The Mesh.',
    },
    loot: [
      { item: 'wovenTissue', min: 14, max: 22, chance: 1 },
      { item: 'frayedPlateMask', min: 1, max: 1, chance: 1 },
      { item: 'frayedPlateMail', min: 1, max: 1, chance: 1 },
      { item: 'frayedPlateGreaves', min: 1, max: 1, chance: 1 },
      { item: 'theMesh', min: 1, max: 1, chance: 1 },
    ],
    phases: [
      {
        at: 1,
        name: 'Linked',
        speed: 150,         // "medium", nodes drift inside a loose formation
        contact: 33,
        // The formation comes down *onto* you. Both of phase one's attacks are
        // close-range by design — the lash runs along a strand and the pulse is
        // a burst around each node — so a formation that hovered out of reach
        // could not land either of them on a grounded player. It hangs just
        // above head height instead, which is also what makes the strands
        // something you have to move out from under.
        floatHeight: 46,
        nodes: 4,
        formation: 'diamond',
        nodeDrift: 26,
        attacks: [
          // Two adjacent nodes pull their shared strand taut and snap it. The
          // damage runs the whole length of the strand, so the safe ground is
          // off the line rather than away from the nodes.
          {
            type: 'strandLash', weight: 1.5,
            cooldown: 2.5, telegraph: 0.5, recover: 0.55,
            minRange: 0, maxRange: 420,
            damage: 55, lashLife: 0.22,
          },
          {
            type: 'nodePulse', weight: 1.2,
            cooldown: 4.0, telegraph: 0.6, recover: 0.55,
            minRange: 0, maxRange: 480,
            damage: 35, radius: 96,
          },
          // Reform is not an attack the player dodges — it is the answer to
          // focus fire, and it is driven by node HP rather than a timer. The
          // entry exists so its cooldown is visible in one place with the rest.
          {
            type: 'reform', weight: 0.01,
            cooldown: 15, telegraph: 0.3, recover: 0.3,
            regen: 0.03, regenTime: 3, threshold: 0.25,
          },
        ],
      },
      {
        at: 0.5,
        name: 'Frayed',
        speed: 205,         // "fast"
        contact: 33,
        floatHeight: 38,
        nodes: 3,
        formation: 'triangle',
        nodeDrift: 18,
        attacks: [
          {
            type: 'strandLash', weight: 1.65,
            cooldown: 1.8, telegraph: 0.3, recover: 0.42,
            minRange: 0, maxRange: 460,
            damage: 70, lashLife: 0.2,
          },
          // The sweep is the phase's signature: every strand rotates around the
          // formation for a second and a half, so the answer is to leave the
          // radius or dash through the gap between two strands.
          {
            type: 'tendrilSweep', weight: 1.1,
            cooldown: 5.0, telegraph: 0.66, recover: 0.7,
            minRange: 0, maxRange: 420,
            damage: 50, duration: 1.5, sweepSpeed: 3.4, reach: 132,
          },
          {
            type: 'nodePulse', weight: 1.3,
            cooldown: 3.5, telegraph: 0.44, recover: 0.45,
            minRange: 0, maxRange: 520,
            damage: 45, radius: 104,
            spores: 4, sporeDamage: 22, projSpeed: 210, homingStrength: 1.5,
          },
          {
            type: 'reform', weight: 0.01,
            cooldown: 15, telegraph: 0.3, recover: 0.3,
            regen: 0.03, regenTime: 3, threshold: 0.25,
          },
        ],
      },
    ],
  },
});

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.freeze(Object.keys(BOSSES));
// Keys a player can actually summon and see listed. Encounter-internal bosses
// (the Choir's husks) are excluded so they never appear in the guide, the
// achievement list or `/spawnboss` autocomplete as a separate fight.
export const SUMMONABLE_BOSS_KEYS = Object.freeze(BOSS_KEYS.filter(k => !BOSSES[k].hidden));
