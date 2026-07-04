// =====================================================================
//  OATHBREAKER TITAN — Kratos-inspired boss AI (human-sized, fast)
//  Moves: Titan Cleave, Earthsplitter Leap, Oathbound Parry,
//         Groundbreaker Throw, Core Mini summon, Oathcrusher Smash,
//         Titan Grapple, Rage Phase (50% HP), Final Judgment (10% HP)
// =====================================================================
import {
  world,
  system,
  EquipmentSlot,
  GameMode,
  EntityDamageCause
} from "@minecraft/server";

const TITAN_ID = "ob:oathbreaker_titan";
const MINI_ID = "ob:core_mini";
const BOULDER_ID = "ob:titan_boulder";
const OVERLORD_ID = "ob:obsidian_overlord";
const CLONE_ID = "ob:hellfire_clone";
// Phase 3
const LEVIATHAN_ID = "ob:blue_leviathan";
const MOLTEN_GOD_ID = "ob:molten_god";
const SOLAR_ID = "ob:solar_clone";
const CRYSTAL_ID = "ob:suffer_crystal";
const PILLAR_ID = "ob:white_pillar";
const BLADE_ID = "ob:divine_blade";
const STATE_PROP = "ob:attack_state";

// ---------------------------------------------------------------------
// Tuning (human-sized Kratos pacing: shorter reach, tighter cooldowns)
// ---------------------------------------------------------------------
const CHEST_Y = 1.25;            // chest/core height on the scaled model

const CLEAVE_RANGE = 5.0;
const CLEAVE_DAMAGE = 12;
const CLEAVE_BLOCKED_DAMAGE = 5;
const CLEAVE_COOLDOWN = 45;
const CLEAVE_HIT_TICK = 11;
const CLEAVE_LENGTH = 24;

const LEAP_COOLDOWN = 220;
const LEAP_AIR_TICKS = 20;
const LEAP_LOCK_TICK = 14;       // landing spot locks here (dodge window)
const LEAP_ARC_HEIGHT = 7;
const SLAM_DAMAGE = 13;
const SLAM_RADIUS = 4;
const SHOCKWAVE_LENGTH = 18;
const SHOCKWAVE_DAMAGE = 10;
const SHOCKWAVE_WIDTH = 1.7;     // dodge sideways...
const SHOCKWAVE_MAX_RISE = 1.4;  // ...or jump over it

const PARRY_WINDOW = 30;         // 3 hits inside 1.5s = parry
const PARRY_HITS = 3;
const PARRY_COOLDOWN = 140;
const PARRY_COUNTER_DAMAGE = 11;
const PARRY_LENGTH = 16;
const PARRY_COUNTER_TICK = 6;

const DASH_COOLDOWN = 90;        // rage-only fiery dash
const DASH_TICKS = 9;
const DASH_DAMAGE = 9;

const THROW_COOLDOWN = 170;      // Groundbreaker: rip up the floor, hurl it
const THROW_RELEASE_TICK = 17;
const THROW_LENGTH = 22;
const BOULDER_SPEED = 1.45;

const SUMMON_COOLDOWN = 550;     // Core Minis
const SUMMON_TICK = 10;
const SUMMON_LENGTH = 24;
const MINI_SPAWN_COUNT = 3;      // +1 in rage
const MINI_CAP = 4;              // +2 in rage

const SMASH_PRESSURE_TRIGGER = 45; // ticks of shield-turtling that provoke it
const SMASH_COOLDOWN = 260;
const SMASH_HIT_TICK = 18;
const SMASH_LENGTH = 30;
const SMASH_DAMAGE = 10;         // x2 vs raised shields, plus a stun
const SMASH_RANGE = 4.5;

const GRAPPLE_COOLDOWN = 240;
const GRAPPLE_TELEGRAPH = 8;
const GRAPPLE_LUNGE_END = 18;
const GRAPPLE_REACH = 2.4;
const GRAPPLE_HOLD_TICKS = 12;
const GRAPPLE_DAMAGE = 13;
const STUMBLE_TICKS = 50;        // free punish window on a whiffed grab

// Skybreaker: slam 8 + drag 6x2 (12) + three 5-dmg punches (15) = 35 total
const SKY_AIR_TRIGGER = 30;      // accumulated airtime that provokes Skybreaker
const SKY_GRAB_RADIUS = 4;       // how close the landing must be to snatch you
const SKY_SLAM_DAMAGE = 8;       // the initial ground slam
const SKY_DRAG_TICKS = 100;      // dragged across the ground for 5 seconds
const SKY_DRAG_DAMAGE = 2;       // every 16 ticks while dragged (6 hits)
const SKY_DRAG_SPEED = 1.6;
const PUMMEL_PUNCHES = 3;        // finisher: three punches...
const PUMMEL_DAMAGE = 5;         // ...at 5 damage each
const PUMMEL_INTERVAL = 10;      // one punch every half second

const PROJ_PARRY_HITS = 3;       // projectile hits inside the window...
const PROJ_WINDOW = 120;         // ...of 6 seconds provoke Aegis Return
const PROJ_PARRY_COOLDOWN = 300;
const DEFLECT_WINDOW = 70;       // 3.5s of batting projectiles back
const REFLECT_SPEED_MULT = 5;
const REFLECT_MAX_SPEED = 4.2;   // faster than this and arrows tunnel through targets

const RAGE_DAMAGE_MULT = 1.3;    // rage: EVERYTHING hits 30% harder

const MOLTEN_COOLDOWN = 500;     // Molten Explosion
const MOLTEN_BURST_TICK = 14;    // ~0.7s charge, then boom
const MOLTEN_LENGTH = 30;
const MOLTEN_RADIUS = 6;
const MOLTEN_DAMAGE = 15;
const MOLTEN_FIRE_SECONDS = 6;
const MOLTEN_DEBRIS = 10;        // chunks of the arena hurled skyward

const RUSH_COOLDOWN = 400;       // Skyhurl Rush
const RUSH_TELEGRAPH = 6;
const RUSH_TICKS = 12;
const RUSH_SPEED = 2.0;
const RUSH_REACH = 2.4;
const HURL_GRAB_DAMAGE = 4;
const HURL_HOLD = 6;             // held aloft before the throw
const HURL_UP_STRENGTH = 3.6;    // launched VERY high
const HURL_AIR_TICKS = 26;       // hang time before the spike
const HURL_IMPACT_DAMAGE = 14;   // driven into the ground

const JUDGMENT_CHARGE_TICKS = 120;
const JUDGMENT_COOLDOWN = 900;
const JUDGMENT_EXPLOSION_RADIUS = 7;
const JUDGMENT_BONUS_DAMAGE = 22;
const STUN_TICKS = 100;

// ---------------------------------------------------------------------
// Per-titan state
// ---------------------------------------------------------------------
const titans = new Map();

function getState(titan) {
  let s = titans.get(titan.id);
  if (!s) {
    s = {
      state: "idle",
      stateTicks: 0,
      cdCleave: 40,
      cdLeap: 160,
      cdDash: 60,
      cdParry: 80,
      cdThrow: 120,
      cdSummon: 260,
      cdSmash: 0,
      cdGrapple: 140,
      cdJudgment: 0,
      raged: false,
      judgmentInterrupted: false,
      hitLog: new Map(),   // playerId -> [tick, tick, ...]
      shieldPressure: 0,   // builds while the target turtles behind a shield
      cleaveHit: false,
      smashHit: false,
      leapStart: null,
      leapLock: null,
      dashDir: null,
      dashHit: null,
      grappleDir: null,
      grabId: null,
      holdTicks: 0,
      throwTargetId: null,
      parryTargetId: null,
      mobFoeId: null,     // grudge memory: last mob he traded damage with
      mobFoeTick: -9999,
      targetAir: 0,       // how long the target has been hopping around
      skyGrab: false,     // current leap is the Skybreaker variant
      dragVictimId: null,
      dragDir: null,
      dragStall: 0,
      dragLastPos: null,
      cdMolten: 200,
      cdRush: 300,
      rushDir: null,
      hurlVictimId: null,
      projHits: [],       // recent projectile hit ticks
      cdProjParry: 0,
      deflectUntil: 0,    // while now < this, projectiles get returned
      reflected: new Set(),
      lastShooterId: null
    };
    titans.set(titan.id, s);
  }
  return s;
}

// ---------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len2d = (v) => Math.sqrt(v.x * v.x + v.z * v.z);
const len3d = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

function norm2d(v) {
  const l = len2d(v);
  if (l < 0.001) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: 0, z: v.z / l };
}

function norm3d(v) {
  const l = len3d(v);
  if (l < 0.001) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function distance(a, b) {
  return len3d(sub(a, b));
}

// ---------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------
function alivePlayersNear(dimension, location, maxDistance) {
  try {
    return dimension.getPlayers({
      location,
      maxDistance,
      excludeGameModes: [GameMode.creative, GameMode.spectator]
    });
  } catch {
    return [];
  }
}

const isPlayer = (e) => e?.typeId === "minecraft:player";

// the Titan never hurts his own kind
const FRIENDLY = new Set([
  TITAN_ID, MINI_ID, BOULDER_ID, "ob:debris", OVERLORD_ID, CLONE_ID,
  LEVIATHAN_ID, MOLTEN_GOD_ID, SOLAR_ID, CRYSTAL_ID, PILLAR_ID, BLADE_ID
]);
// things that can't be fought
const NON_COMBAT = new Set([
  "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:snowball",
  "minecraft:egg", "minecraft:ender_pearl", "minecraft:fishing_hook",
  "minecraft:painting", "minecraft:leash_knot", "minecraft:boat",
  "minecraft:chest_boat", "minecraft:minecart", "minecraft:chest_minecart",
  "minecraft:hopper_minecart", "minecraft:tnt_minecart", "minecraft:armor_stand",
  "minecraft:tnt", "minecraft:falling_block", "minecraft:ender_crystal",
  "minecraft:evocation_fang", "minecraft:area_effect_cloud", "minecraft:llama_spit",
  "minecraft:thrown_trident", "minecraft:fireball", "minecraft:small_fireball",
  "minecraft:dragon_fireball", "minecraft:wither_skull", "minecraft:shulker_bullet",
  "minecraft:fireworks_rocket", "minecraft:splash_potion", "minecraft:lingering_potion",
  "minecraft:lightning_bolt", "minecraft:wind_charge_projectile",
  "minecraft:breeze_wind_charge_projectile", "minecraft:agent", "minecraft:npc"
]);

function canFight(e) {
  if (!e) return false;
  try {
    if (FRIENDLY.has(e.typeId) || NON_COMBAT.has(e.typeId)) return false;
    return !!e.getComponent("minecraft:health");
  } catch {
    return false;
  }
}

// everything an ability can hit: survival players AND mobs (wardens,
// golems, brawl-stick opponents...) — but never his own minis/boulders
function victimsNearDim(dimension, location, radius) {
  const out = alivePlayersNear(dimension, location, radius);
  try {
    for (const e of dimension.getEntities({ location, maxDistance: radius })) {
      if (isPlayer(e) || !canFight(e)) continue;
      out.push(e);
    }
  } catch { }
  return out;
}

function setAnimState(titan, value) {
  try {
    if (titan.getProperty(STATE_PROP) !== value) {
      titan.setProperty(STATE_PROP, value);
    }
  } catch { /* entity unloaded mid-tick */ }
}

function freeze(titan, ticks) {
  try {
    titan.addEffect("slowness", ticks, { amplifier: 20, showParticles: false });
  } catch { }
}

function faceTarget(titan, target) {
  try {
    titan.teleport(titan.location, { facingLocation: target.location });
  } catch { }
}

function playSoundAt(dimension, soundId, location, volume = 2) {
  try {
    dimension.playSound(soundId, location, { volume });
  } catch { }
}

function particle(dimension, name, location) {
  try {
    dimension.spawnParticle(name, location);
  } catch { /* unloaded chunk or bad name — cosmetic only */ }
}

// Find solid ground below a point (for slam / shockwave placement).
function groundY(dimension, x, yStart, z) {
  try {
    for (let y = Math.ceil(yStart) + 2; y > yStart - 12; y--) {
      const block = dimension.getBlock({ x: Math.floor(x), y, z: Math.floor(z) });
      if (block && !block.isAir && !block.isLiquid) return y + 1;
    }
  } catch { }
  return yStart;
}

// Bedrock has no isBlocking API: treat "sneaking with a shield equipped"
// as a block (that is how you raise a shield on Bedrock anyway).
function isBlocking(player) {
  try {
    if (!isPlayer(player)) return false;
    if (!player.isSneaking) return false;
    const equip = player.getComponent("minecraft:equippable");
    if (!equip) return false;
    const off = equip.getEquipment(EquipmentSlot.Offhand);
    const main = equip.getEquipment(EquipmentSlot.Mainhand);
    return off?.typeId === "minecraft:shield" || main?.typeId === "minecraft:shield";
  } catch {
    return false;
  }
}

function hurtPlayer(titan, player, amount) {
  try {
    // in rage, every ability hits harder
    const s = titans.get(titan.id);
    if (s?.raged) amount = Math.round(amount * RAGE_DAMAGE_MULT);
    // hell-buffed Overlord hits three times as hard
    const os = overlords.get(titan.id);
    if (os?.hellBuff) amount = Math.round(amount * 3);
    player.applyDamage(amount, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: titan
    });
  } catch { }
}

function knockPlayer(player, dir, horizontal, vertical) {
  try {
    player.applyKnockback(dir.x, dir.z, horizontal, vertical);
  } catch { }
}

function actionbarNearby(titan, radius, text) {
  for (const p of alivePlayersNear(titan.dimension, titan.location, radius)) {
    try { p.onScreenDisplay.setActionBar(text); } catch { }
  }
}

function titleNearby(titan, radius, title, subtitle) {
  for (const p of alivePlayersNear(titan.dimension, titan.location, radius)) {
    try {
      p.onScreenDisplay.setTitle(title, {
        subtitle,
        fadeInDuration: 5,
        stayDuration: 45,
        fadeOutDuration: 15
      });
    } catch { }
  }
}

function shakeCamera(player, intensity, seconds) {
  if (!isPlayer(player)) return;
  try {
    player.runCommandAsync(`camerashake add @s ${intensity} ${seconds} positional`);
  } catch { }
}

function tellVictim(victim, text) {
  if (!isPlayer(victim)) return;
  try { victim.onScreenDisplay.setActionBar(text); } catch { }
}

function countMinis(titan) {
  try {
    return titan.dimension.getEntities({
      type: MINI_ID,
      location: titan.location,
      maxDistance: 40
    }).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------
// Aegis Return: bat incoming projectiles back at the shooter, 5x faster
// ---------------------------------------------------------------------
const PROJECTILE_TYPES = new Set([
  "minecraft:arrow", "minecraft:thrown_trident", "minecraft:snowball",
  "minecraft:egg", "minecraft:small_fireball", "minecraft:fireball",
  "minecraft:llama_spit", "minecraft:shulker_bullet", "minecraft:dragon_fireball",
  "minecraft:wind_charge_projectile", "minecraft:breeze_wind_charge_projectile",
  "minecraft:wither_skull", "minecraft:wither_skull_dangerous",
  "minecraft:fireworks_rocket", "minecraft:splash_potion",
  "minecraft:lingering_potion", "minecraft:xp_bottle"
]);

// 5x the source projectile's usual damage, delivered by the return shot
const RETURN_5X_DAMAGE = {
  "minecraft:arrow": 15,
  "minecraft:thrown_trident": 40,
  "minecraft:wither_skull": 40,
  "minecraft:wither_skull_dangerous": 40,
  "minecraft:fireball": 30,
  "minecraft:small_fireball": 25,
  "minecraft:dragon_fireball": 25,
  "minecraft:shulker_bullet": 20,
  "minecraft:fireworks_rocket": 25,
  "minecraft:llama_spit": 5,
  "minecraft:snowball": 5,
  "minecraft:egg": 5,
  "minecraft:wind_charge_projectile": 5,
  "minecraft:breeze_wind_charge_projectile": 5,
  "minecraft:splash_potion": 5,
  "minecraft:lingering_potion": 5,
  "minecraft:xp_bottle": 5
};

// return shots in flight: projectileId -> { titanId, extra, expire }
const returnedShots = new Map();

// Spawn a fresh projectile flying back at the shooter. Reversing the
// original entity's velocity is unreliable on Bedrock, so the returned
// shot is always a brand-new arrow (fireball/skull entities won't fly
// under script impulse) carrying 5x the source projectile's damage,
// applied on impact via projectileHitEntity below.
function returnProjectile(titan, s, sourceTypeId, incomingSpeed) {
  const loc = titan.location;
  const chest = { x: loc.x, y: loc.y + CHEST_Y + 0.3, z: loc.z };

  // aim at the last shooter; fall back to wherever he's looking
  let dir = null;
  let dist = 12;
  try {
    const shooter = s.lastShooterId ? world.getEntity(s.lastShooterId) : null;
    if (shooter && shooter.dimension.id === titan.dimension.id) {
      const aim = { x: shooter.location.x, y: shooter.location.y + 1.1, z: shooter.location.z };
      dist = distance(aim, chest);
      dir = norm3d(sub(aim, chest));
    }
  } catch { }
  if (!dir) {
    try {
      const v = titan.getViewDirection();
      dir = norm3d({ x: v.x, y: v.y + 0.05, z: v.z });
    } catch {
      return;
    }
  }

  const speed = Math.min(REFLECT_MAX_SPEED, Math.max(1.2, incomingSpeed) * REFLECT_SPEED_MULT);
  // slight arc so long returns still connect
  const vel = {
    x: dir.x * speed,
    y: dir.y * speed + Math.min(0.35, dist * 0.008),
    z: dir.z * speed
  };
  // spawn clear of the Titan's own hitbox
  const spawnAt = { x: chest.x + dir.x * 1.4, y: chest.y + dir.y * 1.4, z: chest.z + dir.z * 1.4 };
  try {
    const ret = titan.dimension.spawnEntity("minecraft:arrow", spawnAt);
    s.reflected.add(ret.id); // never re-bat our own return shot
    // the arrow itself only stings — the real payload lands on impact
    const total = RETURN_5X_DAMAGE[sourceTypeId] ?? 5;
    returnedShots.set(ret.id, {
      titanId: titan.id,
      extra: Math.max(2, total - 3),
      expire: system.currentTick + 200
    });
    ret.applyImpulse(vel);
    particle(titan.dimension, "minecraft:critical_hit_emitter", spawnAt);
    if (total >= 20) {
      particle(titan.dimension, "minecraft:basic_flame_particle", spawnAt);
    }
    playSoundAt(titan.dimension, "random.anvil_land", titan.location, 1);
  } catch { }
}

// the return shot's 5x payload detonates on whoever it hits
try {
  world.afterEvents.projectileHitEntity.subscribe((ev) => {
    const info = returnedShots.get(ev.projectile?.id);
    if (!info) return;
    returnedShots.delete(ev.projectile.id);
    let hit = null;
    try { hit = ev.getEntityHit()?.entity; } catch { }
    if (!hit) return;
    let titan = null;
    try { titan = world.getEntity(info.titanId); } catch { }
    try {
      hit.applyDamage(info.extra, titan
        ? { cause: EntityDamageCause.projectile, damagingEntity: titan }
        : { cause: EntityDamageCause.projectile });
      particle(hit.dimension, "minecraft:critical_hit_emitter", {
        x: hit.location.x, y: hit.location.y + 1, z: hit.location.z
      });
      playSoundAt(hit.dimension, "random.anvil_land", hit.location, 1.2);
    } catch { }
  });
} catch { /* event unavailable — returns still deal base arrow damage */ }

function removeProjectile(proj) {
  try { proj.remove(); return; } catch { }
  try { proj.kill(); return; } catch { }
  try { proj.teleport({ x: proj.location.x, y: -100, z: proj.location.z }); } catch { }
}

function deflectProjectiles(titan, s) {
  let nearby = [];
  try {
    nearby = titan.dimension.getEntities({
      location: titan.location,
      maxDistance: 5.5
    });
  } catch {
    return;
  }
  for (const proj of nearby) {
    if (!PROJECTILE_TYPES.has(proj.typeId)) continue;
    if (s.reflected.has(proj.id)) continue;
    s.reflected.add(proj.id);
    let speed = 2;
    try { speed = Math.max(0.6, len3d(proj.getVelocity())); } catch { }
    const sourceType = proj.typeId;
    removeProjectile(proj);
    returnProjectile(titan, s, sourceType, speed);
  }
}

// ---------------------------------------------------------------------
// Active shockwaves (Earthsplitter Leap)
// ---------------------------------------------------------------------
const shockwaves = [];

function spawnShockwave(titan, origin, dir) {
  const s = titans.get(titan.id);
  shockwaves.push({
    dimension: titan.dimension,
    x: origin.x,
    y: origin.y,
    z: origin.z,
    dir,
    damage: s?.raged ? Math.round(SHOCKWAVE_DAMAGE * RAGE_DAMAGE_MULT) : SHOCKWAVE_DAMAGE,
    stepsLeft: SHOCKWAVE_LENGTH,
    hit: new Set()
  });
}

function tickShockwaves() {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i];
    w.x += w.dir.x * 1.1;
    w.z += w.dir.z * 1.1;
    w.y = groundY(w.dimension, w.x, w.y, w.z);
    w.stepsLeft--;

    const pos = { x: w.x, y: w.y, z: w.z };
    particle(w.dimension, "minecraft:large_explosion", pos);
    particle(w.dimension, "minecraft:basic_flame_particle", { x: w.x, y: w.y + 0.4, z: w.z });
    particle(w.dimension, "minecraft:lava_particle", pos);
    if (w.stepsLeft % 4 === 0) playSoundAt(w.dimension, "dig.stone", pos, 1.5);

    for (const p of victimsNearDim(w.dimension, pos, 4)) {
      if (w.hit.has(p.id)) continue;
      const d = sub(p.location, pos);
      // narrow line: dodge sideways, or jump: the wave only clips grounded feet
      if (len2d(d) <= SHOCKWAVE_WIDTH && p.location.y - w.y < SHOCKWAVE_MAX_RISE && p.isOnGround) {
        w.hit.add(p.id);
        try {
          p.applyDamage(w.damage, { cause: EntityDamageCause.entityAttack });
        } catch { }
        knockPlayer(p, w.dir, 1.2, 0.55);
      }
    }

    if (w.stepsLeft <= 0) shockwaves.splice(i, 1);
  }
}

// ---------------------------------------------------------------------
// Move starters
// ---------------------------------------------------------------------
function startCleave(titan, s, target) {
  s.state = "cleave";
  s.stateTicks = 0;
  s.cleaveHit = false;
  s.cdCleave = s.raged ? Math.floor(CLEAVE_COOLDOWN * 0.6) : CLEAVE_COOLDOWN;
  setAnimState(titan, "cleave");
  freeze(titan, CLEAVE_LENGTH);
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.ravager.bite", titan.location);
}

function startLeap(titan, s, target, skyGrab = false) {
  s.state = "leap";
  s.stateTicks = 0;
  s.cdLeap = LEAP_COOLDOWN;
  s.leapStart = { ...titan.location };
  s.leapLock = { ...target.location };
  s.skyGrab = skyGrab;
  setAnimState(titan, "leap");
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location);
  actionbarNearby(titan, 40, skyGrab
    ? "§4⚠ The Titan leaps to RIP you from the sky!"
    : "§6⚠ The Titan takes to the sky!");
}

function startDash(titan, s, target) {
  s.state = "dash";
  s.stateTicks = 0;
  s.cdDash = DASH_COOLDOWN;
  s.dashDir = norm2d(sub(target.location, titan.location));
  s.dashHit = new Set();
  setAnimState(titan, "dash");
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.blaze.shoot", titan.location);
}

function startThrow(titan, s, target) {
  s.state = "throw";
  s.stateTicks = 0;
  s.cdThrow = THROW_COOLDOWN;
  s.throwTargetId = target.id;
  setAnimState(titan, "throw");
  freeze(titan, THROW_LENGTH);
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "dig.stone", titan.location, 2);
}

function startSummon(titan, s) {
  s.state = "summon";
  s.stateTicks = 0;
  s.cdSummon = SUMMON_COOLDOWN;
  setAnimState(titan, "summon");
  freeze(titan, SUMMON_LENGTH);
  playSoundAt(titan.dimension, "mob.evocation_illager.prepare_summon", titan.location, 2.5);
  actionbarNearby(titan, 40, "§c⚠ The Titan's core splinters — embers rise!");
}

function startSmash(titan, s, target) {
  s.state = "smash";
  s.stateTicks = 0;
  s.smashHit = false;
  s.cdSmash = SMASH_COOLDOWN;
  s.shieldPressure = 0;
  setAnimState(titan, "smash");
  freeze(titan, SMASH_LENGTH);
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.evocation_illager.prepare_attack", titan.location, 2.5);
  try { target.onScreenDisplay.setActionBar("§4⚠ OATHCRUSHER — your shield can't save you!"); } catch { }
}

function startGrapple(titan, s, target) {
  s.state = "grapple";
  s.stateTicks = 0;
  s.cdGrapple = GRAPPLE_COOLDOWN;
  s.grappleDir = norm2d(sub(target.location, titan.location));
  s.grabId = null;
  s.holdTicks = 0;
  setAnimState(titan, "grapple");
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.warden.attack", titan.location, 2);
}

function startMolten(titan, s) {
  s.state = "molten";
  s.stateTicks = 0;
  s.cdMolten = MOLTEN_COOLDOWN;
  setAnimState(titan, "molten");
  freeze(titan, MOLTEN_LENGTH);
  playSoundAt(titan.dimension, "random.fuse", titan.location, 3);
  actionbarNearby(titan, 40, "§c⚠ MOLTEN ERUPTION — GET AWAY!");
}

function tickMolten(titan, s) {
  const t = s.stateTicks;
  const loc = titan.location;

  if (t < MOLTEN_BURST_TICK) {
    // heat building: flames spiral inward toward the core
    if (t % 2 === 0) {
      const a = t * 0.9;
      const r = 3 - (t / MOLTEN_BURST_TICK) * 2.2;
      particle(titan.dimension, "minecraft:basic_flame_particle", {
        x: loc.x + Math.cos(a) * r, y: loc.y + 0.3 + t * 0.08, z: loc.z + Math.sin(a) * r
      });
      particle(titan.dimension, "minecraft:lava_particle", {
        x: loc.x - Math.cos(a) * r, y: loc.y + 0.3, z: loc.z - Math.sin(a) * r
      });
    }
    return;
  }

  if (t === MOLTEN_BURST_TICK) {
    // ERUPTION
    playSoundAt(titan.dimension, "random.explode", loc, 4);
    playSoundAt(titan.dimension, "mob.ghast.fireball", loc, 3);
    particle(titan.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
    particle(titan.dimension, "minecraft:knockback_roar_particle", { x: loc.x, y: loc.y + 0.4, z: loc.z });
    for (let ring = 0; ring < 2; ring++) {
      const rr = ring === 0 ? 3 : MOLTEN_RADIUS;
      for (let i = 0; i < 14; i++) {
        const a = (Math.PI * 2 * i) / 14;
        const px = loc.x + Math.cos(a) * rr;
        const pz = loc.z + Math.sin(a) * rr;
        const py = groundY(titan.dimension, px, loc.y, pz);
        particle(titan.dimension, "minecraft:lava_particle", { x: px, y: py + 0.2, z: pz });
        particle(titan.dimension, "minecraft:basic_flame_particle", { x: px, y: py + 0.5, z: pz });
      }
    }

    // everything nearby burns
    for (const p of victimsNearDim(titan.dimension, loc, MOLTEN_RADIUS)) {
      hurtPlayer(titan, p, MOLTEN_DAMAGE);
      try { p.setOnFire(MOLTEN_FIRE_SECONDS, true); } catch { }
      knockPlayer(p, norm2d(sub(p.location, loc)), 1.8, 0.8);
      shakeCamera(p, 0.6, 0.7);
      tellVictim(p, "§6🔥 Seared by the eruption!");
    }

    // chunks of the arena thrown into the sky
    for (let i = 0; i < MOLTEN_DEBRIS; i++) {
      const a = Math.random() * Math.PI * 2;
      try {
        const chunk = titan.dimension.spawnEntity("ob:debris", {
          x: loc.x + Math.cos(a) * 1.2, y: loc.y + 1, z: loc.z + Math.sin(a) * 1.2
        });
        chunk.applyImpulse({
          x: Math.cos(a) * (0.25 + Math.random() * 0.45),
          y: 0.8 + Math.random() * 0.6,
          z: Math.sin(a) * (0.25 + Math.random() * 0.45)
        });
      } catch { }
    }
    playSoundAt(titan.dimension, "dig.stone", loc, 2);
    return;
  }

  if (t >= MOLTEN_LENGTH) backToIdle(titan, s, 10);
}

function startRush(titan, s, target) {
  s.state = "rush";
  s.stateTicks = 0;
  s.cdRush = RUSH_COOLDOWN;
  s.rushDir = norm2d(sub(target.location, titan.location));
  s.hurlVictimId = null;
  setAnimState(titan, "dash"); // rush shares the dash lunge pose
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location, 2);
  actionbarNearby(titan, 40, "§6⚠ The Titan charges!");
}

function tickRush(titan, s) {
  const t = s.stateTicks;

  // telegraph: keep tracking while he coils
  if (t < RUSH_TELEGRAPH) {
    const target = nearestTarget(titan, s);
    if (target) {
      s.rushDir = norm2d(sub(target.location, titan.location));
      faceTarget(titan, target);
    }
    return;
  }

  if (t <= RUSH_TELEGRAPH + RUSH_TICKS) {
    try { titan.applyKnockback(s.rushDir.x, s.rushDir.z, RUSH_SPEED, 0.05); } catch { }
    const loc = titan.location;
    particle(titan.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 0.6, z: loc.z });
    particle(titan.dimension, "minecraft:basic_smoke_particle", { x: loc.x, y: loc.y + 1.2, z: loc.z });
    for (const p of victimsNearDim(titan.dimension, loc, RUSH_REACH)) {
      const to = norm2d(sub(p.location, loc));
      if (s.rushDir.x * to.x + s.rushDir.z * to.z < 0.2 && distance(p.location, loc) > 1) continue;
      // CAUGHT
      s.hurlVictimId = p.id;
      s.state = "skyhurl";
      s.stateTicks = 0;
      setAnimState(titan, "leap"); // skyhurl shares the arms-raised leap pose
      freeze(titan, HURL_HOLD + HURL_AIR_TICKS + 10);
      hurtPlayer(titan, p, HURL_GRAB_DAMAGE);
      playSoundAt(titan.dimension, "mob.warden.attack", loc, 2.5);
      tellVictim(p, "§4✊ CAUGHT — going UP!");
      return;
    }
    return;
  }

  // charged past everyone: skid to a stop
  backToIdle(titan, s, 12);
}

function tickSkyhurl(titan, s) {
  const t = s.stateTicks;
  let victim = null;
  try { victim = world.getEntity(s.hurlVictimId); } catch { }
  if (!victim || victim.dimension.id !== titan.dimension.id) {
    s.hurlVictimId = null;
    backToIdle(titan, s, 10);
    return;
  }
  const loc = titan.location;

  if (t < HURL_HOLD) {
    // hoisted overhead
    try {
      victim.teleport({
        x: loc.x + s.rushDir.x * 0.8,
        y: loc.y + 2.2,
        z: loc.z + s.rushDir.z * 0.8
      });
    } catch { }
    return;
  }

  if (t === HURL_HOLD) {
    // THROWN SKYWARD
    try { victim.applyKnockback(0, 0, 0, HURL_UP_STRENGTH); } catch { }
    playSoundAt(titan.dimension, "mob.irongolem.throw", loc, 2.5);
    particle(titan.dimension, "minecraft:knockback_roar_particle", { x: loc.x, y: loc.y + 2, z: loc.z });
    tellVictim(victim, "§6⬆ HURLED INTO THE SKY!");
    return;
  }

  if (t < HURL_HOLD + HURL_AIR_TICKS) {
    // rising... flame trail marks them
    if (t % 3 === 0) {
      particle(titan.dimension, "minecraft:basic_flame_particle", victim.location);
    }
    return;
  }

  // SPIKED back down into the earth
  const vloc = victim.location;
  const gy = groundY(titan.dimension, vloc.x, loc.y, vloc.z);
  try { victim.teleport({ x: vloc.x, y: gy, z: vloc.z }); } catch { }
  hurtPlayer(titan, victim, HURL_IMPACT_DAMAGE);
  try { victim.addEffect("slowness", 30, { amplifier: 2 }); } catch { }
  shakeCamera(victim, 0.7, 0.7);
  particle(titan.dimension, "minecraft:knockback_roar_particle", { x: vloc.x, y: gy + 0.3, z: vloc.z });
  playSoundAt(titan.dimension, "random.explode", { x: vloc.x, y: gy, z: vloc.z }, 3);
  tellVictim(victim, "§4⬇ SPIKED INTO THE EARTH!");
  s.hurlVictimId = null;
  backToIdle(titan, s, 15);
}

function startParry(titan, s, attacker) {
  s.state = "parry";
  s.stateTicks = 0;
  s.cdParry = PARRY_COOLDOWN;
  s.parryTargetId = attacker.id;
  s.hitLog.clear();
  setAnimState(titan, "parry");
  freeze(titan, PARRY_LENGTH);
  // brief invulnerability sells the parry
  try { titan.addEffect("resistance", PARRY_LENGTH, { amplifier: 4, showParticles: false }); } catch { }
  playSoundAt(titan.dimension, "random.anvil_land", titan.location, 1.2);
  try { attacker.onScreenDisplay.setActionBar("§c⚔ PARRIED!"); } catch { }
}

function startJudgment(titan, s) {
  s.state = "judgment";
  s.stateTicks = 0;
  s.judgmentInterrupted = false;
  s.cdJudgment = JUDGMENT_COOLDOWN;
  setAnimState(titan, "judgment");
  freeze(titan, JUDGMENT_CHARGE_TICKS + 10);
  playSoundAt(titan.dimension, "mob.wither.spawn", titan.location, 3);
  titleNearby(titan, 50, "§4FINAL JUDGMENT", "§6Strike the glowing chest core to interrupt!");
}

function rageBoost(titan) {
  // rage stats via effects, NOT an entity event: triggering an event
  // re-initializes the AI on Bedrock, which drops mob combat targets
  try { titan.addEffect("speed", 120, { amplifier: 1, showParticles: false }); } catch { }
  try { titan.addEffect("strength", 120, { amplifier: 1, showParticles: false }); } catch { }
}

function enterRage(titan, s) {
  s.raged = true;
  try { titan.setProperty("ob:rage", true); } catch { }
  rageBoost(titan);
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location, 3);
  titleNearby(titan, 50, "§4THE OATH BURNS", "§cThe Titan enters his rage...");
  const loc = titan.location;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    particle(titan.dimension, "minecraft:lava_particle", {
      x: loc.x + Math.cos(a) * 2.5, y: loc.y + 0.2, z: loc.z + Math.sin(a) * 2.5
    });
    particle(titan.dimension, "minecraft:basic_flame_particle", {
      x: loc.x + Math.cos(a) * 2.5, y: loc.y + 1, z: loc.z + Math.sin(a) * 2.5
    });
  }
}

// ---------------------------------------------------------------------
// Per-move tick logic
// ---------------------------------------------------------------------
function tickCleave(titan, s) {
  if (s.stateTicks === CLEAVE_HIT_TICK && !s.cleaveHit) {
    s.cleaveHit = true;
    const fwd = titan.getViewDirection();
    playSoundAt(titan.dimension, "mob.irongolem.throw", titan.location, 1.5);
    const chest = { x: titan.location.x, y: titan.location.y + CHEST_Y, z: titan.location.z };
    for (let i = -3; i <= 3; i++) {
      const a = Math.atan2(fwd.z, fwd.x) + i * 0.28;
      particle(titan.dimension, "minecraft:critical_hit_emitter", {
        x: chest.x + Math.cos(a) * 3, y: chest.y, z: chest.z + Math.sin(a) * 3
      });
    }
    // wide 120-degree arc in front of the Titan
    for (const p of victimsNearDim(titan.dimension, titan.location, CLEAVE_RANGE)) {
      const to = norm2d(sub(p.location, titan.location));
      const dot = fwd.x * to.x + fwd.z * to.z;
      if (dot < 0.35) continue;
      if (isBlocking(p)) {
        // reduced damage, but the sheer force staggers — and turtling
        // builds pressure toward the Oathcrusher Smash
        s.shieldPressure += 14;
        hurtPlayer(titan, p, CLEAVE_BLOCKED_DAMAGE);
        knockPlayer(p, to, 1.6, 0.5);
        try { p.addEffect("slowness", 30, { amplifier: 1 }); } catch { }
        tellVictim(p, "§7🛡 Blocked — but the blow staggers you!");
        playSoundAt(titan.dimension, "item.shield.block", p.location, 1.5);
      } else {
        hurtPlayer(titan, p, CLEAVE_DAMAGE);
        knockPlayer(p, to, 1.1, 0.35);
      }
    }
  }
  if (s.stateTicks >= CLEAVE_LENGTH) backToIdle(titan, s);
}

function tickLeap(titan, s) {
  const t = s.stateTicks;

  // track the target until the landing point locks
  if (t < LEAP_LOCK_TICK) {
    const target = nearestTarget(titan, s);
    if (target) s.leapLock = { ...target.location };
  }

  if (t <= LEAP_AIR_TICKS) {
    // parabolic arc from start to (tracked) landing point
    const f = t / LEAP_AIR_TICKS;
    const x = s.leapStart.x + (s.leapLock.x - s.leapStart.x) * f;
    const z = s.leapStart.z + (s.leapLock.z - s.leapStart.z) * f;
    const baseY = s.leapStart.y + (s.leapLock.y - s.leapStart.y) * f;
    const y = baseY + Math.sin(Math.PI * f) * LEAP_ARC_HEIGHT;
    try {
      titan.teleport({ x, y, z }, { facingLocation: s.leapLock });
    } catch { }
    if (t % 3 === 0) {
      particle(titan.dimension, "minecraft:basic_flame_particle", { x, y: y + 1, z });
    }
    if (t === LEAP_LOCK_TICK) {
      // telegraph the locked landing spot
      const gy = groundY(titan.dimension, s.leapLock.x, s.leapLock.y, s.leapLock.z);
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI * 2 * i) / 8;
        particle(titan.dimension, "minecraft:basic_flame_particle", {
          x: s.leapLock.x + Math.cos(a) * 2, y: gy + 0.2, z: s.leapLock.z + Math.sin(a) * 2
        });
      }
    }
    return;
  }

  if (t === LEAP_AIR_TICKS + 1) {
    // SLAM
    const gy = groundY(titan.dimension, s.leapLock.x, s.leapLock.y, s.leapLock.z);
    const land = { x: s.leapLock.x, y: gy, z: s.leapLock.z };
    try { titan.teleport(land); } catch { }
    setAnimState(titan, "slam");
    particle(titan.dimension, "minecraft:knockback_roar_particle", { x: land.x, y: land.y + 0.5, z: land.z });
    playSoundAt(titan.dimension, "random.explode", land, 3);

    // Skybreaker variant: snatch whoever's at the landing point
    if (s.skyGrab) {
      let victim = null;
      let best = SKY_GRAB_RADIUS;
      for (const v of victimsNearDim(titan.dimension, land, SKY_GRAB_RADIUS + 1)) {
        const d = distance(v.location, land);
        if (d < best) {
          best = d;
          victim = v;
        }
      }
      if (victim) {
        // slam them into the ground...
        try { victim.teleport({ x: land.x, y: land.y, z: land.z }); } catch { }
        hurtPlayer(titan, victim, SKY_SLAM_DAMAGE);
        shakeCamera(victim, 0.6, 0.6);
        tellVictim(victim, "§4✊ SLAMMED — he's dragging you!");
        // ...then drag them across it
        s.state = "drag";
        s.stateTicks = 0;
        s.dragVictimId = victim.id;
        s.dragStall = 0;
        s.dragLastPos = { ...titan.location };
        let dir = norm2d(sub(land, s.leapStart));
        if (len2d(sub(land, s.leapStart)) < 1) {
          const v = titan.getViewDirection();
          dir = norm2d({ x: v.x, y: 0, z: v.z });
        }
        s.dragDir = dir;
        setAnimState(titan, "drag");
        playSoundAt(titan.dimension, "mob.warden.attack", land, 2.5);
        return;
      }
      // whiffed the snatch: plain slam damage, then recover
      for (const p of victimsNearDim(titan.dimension, land, SLAM_RADIUS)) {
        hurtPlayer(titan, p, SLAM_DAMAGE);
        knockPlayer(p, norm2d(sub(p.location, land)), 1.4, 0.6);
        shakeCamera(p, 0.4, 0.4);
      }
      freeze(titan, 14);
      return;
    }

    for (const p of victimsNearDim(titan.dimension, land, SLAM_RADIUS)) {
      hurtPlayer(titan, p, SLAM_DAMAGE);
      knockPlayer(p, norm2d(sub(p.location, land)), 1.4, 0.6);
      shakeCamera(p, 0.4, 0.4);
    }

    // straight shockwave line: sidestep it or jump it
    let dir;
    const target = nearestTarget(titan, s);
    if (target && distance(target.location, land) > 1.5) {
      dir = norm2d(sub(target.location, land));
    } else {
      const v = titan.getViewDirection();
      dir = norm2d({ x: v.x, y: 0, z: v.z });
    }
    spawnShockwave(titan, { x: land.x + dir.x * 1.5, y: land.y, z: land.z + dir.z * 1.5 }, dir);
    freeze(titan, 14);
    return;
  }

  if (t >= LEAP_AIR_TICKS + 14) backToIdle(titan, s);
}

function tickDash(titan, s) {
  const t = s.stateTicks;
  if (t <= DASH_TICKS) {
    try { titan.applyKnockback(s.dashDir.x, s.dashDir.z, 1.6, 0.05); } catch { }
    const loc = titan.location;
    particle(titan.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    particle(titan.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 1.3, z: loc.z });
    particle(titan.dimension, "minecraft:lava_particle", loc);
    for (const p of victimsNearDim(titan.dimension, loc, 2.2)) {
      if (s.dashHit.has(p.id)) continue;
      s.dashHit.add(p.id);
      hurtPlayer(titan, p, DASH_DAMAGE);
      try { p.setOnFire(3, true); } catch { }
      knockPlayer(p, s.dashDir, 1.3, 0.4);
    }
    return;
  }
  if (t >= DASH_TICKS + 8) backToIdle(titan, s);
}

function tickThrow(titan, s) {
  const t = s.stateTicks;
  const loc = titan.location;

  // ripping a slab out of the arena floor
  if (t > 3 && t < THROW_RELEASE_TICK && t % 3 === 0) {
    particle(titan.dimension, "minecraft:basic_smoke_particle", {
      x: loc.x + (Math.random() - 0.5) * 1.5, y: loc.y + 0.2, z: loc.z + (Math.random() - 0.5) * 1.5
    });
  }
  if (t === 8) playSoundAt(titan.dimension, "dig.gravel", loc, 2);

  if (t === THROW_RELEASE_TICK) {
    let target = null;
    try {
      const remembered = world.getEntity(s.throwTargetId);
      if (remembered && remembered.dimension.id === titan.dimension.id &&
        distance(remembered.location, loc) <= 40) {
        target = remembered;
      }
    } catch { }
    if (!target) target = nearestTarget(titan, s);
    if (target) {
      faceTarget(titan, target);
      const chest = { x: loc.x, y: loc.y + CHEST_Y + 0.4, z: loc.z };
      // lead the shot a little based on the target's velocity
      let aim = { ...target.location };
      try {
        const v = target.getVelocity();
        aim = { x: aim.x + v.x * 8, y: aim.y + 0.8, z: aim.z + v.z * 8 };
      } catch { }
      const dist = distance(aim, chest);
      const dir = norm3d(sub(aim, chest));
      const spawnAt = { x: chest.x + dir.x * 1.4, y: chest.y + 0.3, z: chest.z + dir.z * 1.4 };
      try {
        const boulder = titan.dimension.spawnEntity(BOULDER_ID, spawnAt);
        boulder.applyImpulse({
          x: dir.x * BOULDER_SPEED,
          y: dir.y * BOULDER_SPEED + Math.min(0.65, 0.18 + dist * 0.022),
          z: dir.z * BOULDER_SPEED
        });
        playSoundAt(titan.dimension, "mob.enderdragon.flap", spawnAt, 2);
      } catch { }
    }
  }
  if (t >= THROW_LENGTH) backToIdle(titan, s);
}

function tickSummon(titan, s) {
  const t = s.stateTicks;
  const loc = titan.location;
  if (t % 3 === 0) {
    particle(titan.dimension, "minecraft:basic_flame_particle", {
      x: loc.x, y: loc.y + CHEST_Y, z: loc.z
    });
  }
  if (t === SUMMON_TICK) {
    const count = MINI_SPAWN_COUNT + (s.raged ? 1 : 0);
    // if the Titan is fighting a mob, the minis join that fight too
    let mobFoe = null;
    const currentTarget = nearestTarget(titan, s);
    if (currentTarget && !isPlayer(currentTarget)) mobFoe = currentTarget;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const pos = {
        x: loc.x + Math.cos(a) * 2,
        y: loc.y + 0.1,
        z: loc.z + Math.sin(a) * 2
      };
      try {
        const mini = titan.dimension.spawnEntity(MINI_ID, pos);
        if (mobFoe) {
          // make the mini believe the foe struck it, so it retaliates
          try {
            mini.applyDamage(1, {
              cause: EntityDamageCause.entityAttack,
              damagingEntity: mobFoe
            });
          } catch { }
        }
        particle(titan.dimension, "minecraft:lava_particle", pos);
        particle(titan.dimension, "minecraft:basic_flame_particle", { x: pos.x, y: pos.y + 0.6, z: pos.z });
      } catch { }
    }
    playSoundAt(titan.dimension, "mob.evocation_illager.cast_spell", loc, 2.5);
  }
  if (t >= SUMMON_LENGTH) backToIdle(titan, s);
}

function tickSmash(titan, s) {
  const t = s.stateTicks;
  // raising the greatsword high...
  if (t < SMASH_HIT_TICK && t % 4 === 0) {
    const loc = titan.location;
    particle(titan.dimension, "minecraft:basic_flame_particle", {
      x: loc.x, y: loc.y + 2.4, z: loc.z
    });
  }
  if (t === SMASH_HIT_TICK && !s.smashHit) {
    s.smashHit = true;
    const fwd = titan.getViewDirection();
    const loc = titan.location;
    playSoundAt(titan.dimension, "random.explode", loc, 2.5);
    particle(titan.dimension, "minecraft:knockback_roar_particle", {
      x: loc.x + fwd.x * 1.5, y: loc.y + 0.3, z: loc.z + fwd.z * 1.5
    });
    for (const p of victimsNearDim(titan.dimension, loc, SMASH_RANGE)) {
      const to = norm2d(sub(p.location, loc));
      if (fwd.x * to.x + fwd.z * to.z < 0.45) continue;
      if (isBlocking(p)) {
        // the whole point: 2x damage through the shield, plus a stun
        hurtPlayer(titan, p, SMASH_DAMAGE * 2);
        try { p.addEffect("slowness", 50, { amplifier: 3 }); } catch { }
        try { p.addEffect("weakness", 50, { amplifier: 1 }); } catch { }
        shakeCamera(p, 0.6, 0.8);
        knockPlayer(p, to, 0.4, 0.3);
        playSoundAt(titan.dimension, "random.break", p.location, 2);
        tellVictim(p, "§4🛡 GUARD SHATTERED — you are stunned!");
      } else {
        hurtPlayer(titan, p, SMASH_DAMAGE);
        knockPlayer(p, to, 1.2, 0.45);
      }
    }
  }
  if (t >= SMASH_LENGTH) backToIdle(titan, s);
}

function tickGrapple(titan, s) {
  const t = s.stateTicks;

  // telegraph: keep tracking the target while he coils
  if (t < GRAPPLE_TELEGRAPH) {
    const target = nearestTarget(titan, s);
    if (target) {
      s.grappleDir = norm2d(sub(target.location, titan.location));
      faceTarget(titan, target);
    }
    return;
  }

  // holding a grabbed victim
  if (s.grabId) {
    s.holdTicks++;
    let held = null;
    try { held = world.getEntity(s.grabId); } catch { }
    if (!held || held.dimension.id !== titan.dimension.id ||
      distance(held.location, titan.location) > 12) {
      backToIdle(titan, s);
      return;
    }
    const loc = titan.location;
    if (s.holdTicks < GRAPPLE_HOLD_TICKS) {
      // hoisted into the air in his fist
      try {
        held.teleport({
          x: loc.x + s.grappleDir.x * 1.1,
          y: loc.y + 1.6,
          z: loc.z + s.grappleDir.z * 1.1
        });
      } catch { }
      if (s.holdTicks % 4 === 0) {
        particle(titan.dimension, "minecraft:critical_hit_emitter", held.location);
      }
    } else {
      // slammed into the ground — a grab beats a shield
      const gx = loc.x + s.grappleDir.x * 1.6;
      const gz = loc.z + s.grappleDir.z * 1.6;
      const gy = groundY(titan.dimension, gx, loc.y, gz);
      try { held.teleport({ x: gx, y: gy, z: gz }); } catch { }
      hurtPlayer(titan, held, GRAPPLE_DAMAGE);
      try { held.addEffect("slowness", 30, { amplifier: 2 }); } catch { }
      shakeCamera(held, 0.7, 0.6);
      particle(titan.dimension, "minecraft:knockback_roar_particle", { x: gx, y: gy + 0.3, z: gz });
      playSoundAt(titan.dimension, "random.explode", { x: gx, y: gy, z: gz }, 2.5);
      tellVictim(held, "§4✊ Slammed into the earth!");
      backToIdle(titan, s, 10);
    }
    return;
  }

  // lunge phase: try to connect the grab
  if (t <= GRAPPLE_LUNGE_END) {
    try { titan.applyKnockback(s.grappleDir.x, s.grappleDir.z, 1.7, 0.05); } catch { }
    const loc = titan.location;
    if (t % 2 === 0) {
      particle(titan.dimension, "minecraft:basic_smoke_particle", { x: loc.x, y: loc.y + 0.8, z: loc.z });
    }
    for (const p of victimsNearDim(titan.dimension, loc, GRAPPLE_REACH)) {
      const to = norm2d(sub(p.location, loc));
      if (s.grappleDir.x * to.x + s.grappleDir.z * to.z < 0.2 && distance(p.location, loc) > 1) continue;
      // CONNECTED
      s.grabId = p.id;
      s.holdTicks = 0;
      freeze(titan, GRAPPLE_HOLD_TICKS + 6);
      playSoundAt(titan.dimension, "mob.warden.attack", loc, 2.5);
      tellVictim(p, "§4✊ GRABBED!");
      return;
    }
    return;
  }

  // whiffed: he stumbles — free punish window
  s.state = "stumble";
  s.stateTicks = 0;
  setAnimState(titan, "stumble");
  freeze(titan, STUMBLE_TICKS);
  playSoundAt(titan.dimension, "mob.ravager.stunned", titan.location, 2);
  actionbarNearby(titan, 30, "§a⚔ The Titan stumbles — strike now!");
}

function startPummel(titan, s) {
  s.state = "pummel";
  s.stateTicks = 0;
  setAnimState(titan, "pummel");
  freeze(titan, PUMMEL_PUNCHES * PUMMEL_INTERVAL + 16);
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location, 1.5);
}

function tickDrag(titan, s) {
  const t = s.stateTicks;
  let victim = null;
  try { victim = world.getEntity(s.dragVictimId); } catch { }

  if (!victim || victim.dimension.id !== titan.dimension.id) {
    s.dragVictimId = null;
    backToIdle(titan, s, 12);
    return;
  }
  if (t >= SKY_DRAG_TICKS) {
    // drag's over — time for the beatdown
    startPummel(titan, s);
    return;
  }

  // sprint forward, grinding the victim along the ground
  try { titan.applyKnockback(s.dragDir.x, s.dragDir.z, SKY_DRAG_SPEED, 0); } catch { }
  const loc = titan.location;

  // ran into a wall? cut the drag short and start punching
  if (distance(loc, s.dragLastPos) < 0.25) {
    s.dragStall++;
    if (s.dragStall >= 6) {
      startPummel(titan, s);
      return;
    }
  } else {
    s.dragStall = 0;
  }
  s.dragLastPos = { ...loc };

  const vx = loc.x + s.dragDir.x * 1.2;
  const vz = loc.z + s.dragDir.z * 1.2;
  const vy = groundY(titan.dimension, vx, loc.y, vz);
  try { victim.teleport({ x: vx, y: vy, z: vz }); } catch { }
  if (t % 16 === 0 && t > 0) {
    hurtPlayer(titan, victim, SKY_DRAG_DAMAGE);
    playSoundAt(titan.dimension, "dig.stone", loc, 1.2);
    shakeCamera(victim, 0.25, 0.3);
  }
  particle(titan.dimension, "minecraft:basic_smoke_particle", { x: vx, y: vy + 0.2, z: vz });
  particle(titan.dimension, "minecraft:critical_hit_emitter", { x: vx, y: vy + 0.5, z: vz });
}

function tickPummel(titan, s) {
  const t = s.stateTicks;
  let victim = null;
  try { victim = world.getEntity(s.dragVictimId); } catch { }
  if (!victim || victim.dimension.id !== titan.dimension.id) {
    s.dragVictimId = null;
    backToIdle(titan, s, 12);
    return;
  }

  // pinned at arm's length while the fists come down
  const loc = titan.location;
  const hx = loc.x + s.dragDir.x * 1.3;
  const hz = loc.z + s.dragDir.z * 1.3;
  const hy = groundY(titan.dimension, hx, loc.y, hz);
  try { victim.teleport({ x: hx, y: hy, z: hz }); } catch { }

  // three punches, half a second apart
  if (t > 0 && t % PUMMEL_INTERVAL === 0 && t <= PUMMEL_PUNCHES * PUMMEL_INTERVAL) {
    hurtPlayer(titan, victim, PUMMEL_DAMAGE);
    shakeCamera(victim, 0.4, 0.3);
    playSoundAt(titan.dimension, "mob.irongolem.attack", loc, 1.6);
    particle(titan.dimension, "minecraft:critical_hit_emitter", {
      x: hx, y: hy + 1, z: hz
    });
  }

  if (t >= PUMMEL_PUNCHES * PUMMEL_INTERVAL + 8) {
    // discarded like a ragdoll (the 35 damage is already done)
    knockPlayer(victim, s.dragDir, 1.6, 0.55);
    playSoundAt(titan.dimension, "random.explode", loc, 1.5);
    particle(titan.dimension, "minecraft:knockback_roar_particle", victim.location);
    tellVictim(victim, "§4Discarded.");
    s.dragVictimId = null;
    backToIdle(titan, s, 15);
  }
}

function tickStumble(titan, s) {
  freeze(titan, 5);
  if (s.stateTicks % 8 === 0) {
    const loc = titan.location;
    particle(titan.dimension, "minecraft:critical_hit_emitter", {
      x: loc.x, y: loc.y + 2.3, z: loc.z
    });
  }
  if (s.stateTicks >= STUMBLE_TICKS) backToIdle(titan, s);
}

function tickParry(titan, s) {
  if (s.stateTicks === PARRY_COUNTER_TICK && s.parryTargetId) {
    // instant counterattack
    const target = titan.dimension
      .getPlayers({ location: titan.location, maxDistance: 8 })
      .find((p) => p.id === s.parryTargetId);
    if (target) {
      faceTarget(titan, target);
      hurtPlayer(titan, target, PARRY_COUNTER_DAMAGE);
      knockPlayer(target, norm2d(sub(target.location, titan.location)), 2.2, 0.7);
      playSoundAt(titan.dimension, "mob.irongolem.attack", titan.location, 2);
      particle(titan.dimension, "minecraft:critical_hit_emitter", {
        x: target.location.x, y: target.location.y + 1, z: target.location.z
      });
    }
  }
  if (s.stateTicks >= PARRY_LENGTH) backToIdle(titan, s);
}

function tickJudgment(titan, s) {
  const t = s.stateTicks;
  const loc = titan.location;
  freeze(titan, 5);

  if (s.judgmentInterrupted) {
    // core struck: Titan is stunned
    s.state = "stunned";
    s.stateTicks = 0;
    setAnimState(titan, "stunned");
    playSoundAt(titan.dimension, "mob.warden.hurt", loc, 3);
    titleNearby(titan, 50, "§bCORE SHATTERED", "§7The Titan reels, defenseless!");
    for (let i = 0; i < 20; i++) {
      particle(titan.dimension, "minecraft:critical_hit_emitter", {
        x: loc.x + (Math.random() - 0.5) * 2, y: loc.y + 1 + Math.random() * 1.5, z: loc.z + (Math.random() - 0.5) * 2
      });
    }
    return;
  }

  // charge-up drama at the chest core
  if (t % 4 === 0) {
    const core = { x: loc.x, y: loc.y + CHEST_Y, z: loc.z };
    particle(titan.dimension, "minecraft:basic_flame_particle", core);
    particle(titan.dimension, "minecraft:lava_particle", core);
  }
  if (t % 20 === 0) {
    actionbarNearby(titan, 40, `§6⚔ STRIKE THE GLOWING CORE! §c${Math.ceil((JUDGMENT_CHARGE_TICKS - t) / 20)}s`);
    playSoundAt(titan.dimension, "mob.warden.heartbeat", loc, 3);
  }

  if (t >= JUDGMENT_CHARGE_TICKS) {
    // failure: cataclysm (entity damage only, no terrain grief)
    playSoundAt(titan.dimension, "random.explode", loc, 4);
    particle(titan.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
    particle(titan.dimension, "minecraft:knockback_roar_particle", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    try {
      titan.dimension.createExplosion({ x: loc.x, y: loc.y + 1, z: loc.z }, JUDGMENT_EXPLOSION_RADIUS, {
        breaksBlocks: false,
        causesFire: false,
        source: titan
      });
    } catch { }
    for (const p of victimsNearDim(titan.dimension, loc, 10)) {
      const d = Math.max(1, distance(p.location, loc));
      hurtPlayer(titan, p, Math.round(JUDGMENT_BONUS_DAMAGE * Math.min(1, 3 / d)));
      knockPlayer(p, norm2d(sub(p.location, loc)), 2.5, 0.9);
      shakeCamera(p, 0.6, 0.8);
    }
    backToIdle(titan, s, 20);
  }
}

function tickStunned(titan, s) {
  freeze(titan, 5);
  if (s.stateTicks % 10 === 0) {
    const loc = titan.location;
    particle(titan.dimension, "minecraft:villager_angry", { x: loc.x, y: loc.y + 2.4, z: loc.z });
  }
  if (s.stateTicks >= STUN_TICKS) backToIdle(titan, s);
}

function backToIdle(titan, s, extraRecovery = 0) {
  s.state = "idle";
  s.stateTicks = -extraRecovery;
  s.grabId = null;
  s.skyGrab = false;
  setAnimState(titan, "idle");
}

// ---------------------------------------------------------------------
// Target selection & main brain
// ---------------------------------------------------------------------
const FOE_MEMORY_TICKS = 600; // remember a mob opponent for 30s per hit

// shared boss targeting: engine target -> grudge memory -> hostile scan
// -> nearest player. `s` is the boss's script state (titan or overlord).
function nearestTarget(boss, s) {
  // 1) whatever the vanilla AI is actually fighting right now
  try {
    const t = boss.target;
    if (
      t &&
      t.dimension.id === boss.dimension.id &&
      distance(t.location, boss.location) <= 48
    ) {
      if (isPlayer(t)) {
        // only chase players who are actually fightable (not creative)
        if (alivePlayersNear(boss.dimension, boss.location, 48).some((p) => p.id === t.id)) {
          return t;
        }
      } else if (canFight(t)) {
        s.mobFoeId = t.id;
        s.mobFoeTick = system.currentTick;
        return t;
      }
    }
  } catch { }

  // 2) grudge memory: the mob he last traded damage with (works even
  //    when the engine won't expose its combat target to scripts)
  if (s.mobFoeId && system.currentTick - s.mobFoeTick <= FOE_MEMORY_TICKS) {
    try {
      const foe = world.getEntity(s.mobFoeId);
      if (
        foe &&
        canFight(foe) &&
        foe.dimension.id === boss.dimension.id &&
        distance(foe.location, boss.location) <= 48
      ) {
        return foe;
      }
    } catch { }
  }

  // 3) scan for any mob actively hunting HIM (covers aggro the engine
  //    dropped, e.g. after phase changes) — throttled to every 10 ticks
  if (system.currentTick - (s.lastHostileScan ?? -99) >= 10) {
    s.lastHostileScan = system.currentTick;
    try {
      for (const e of boss.dimension.getEntities({
        location: boss.location,
        maxDistance: 24
      })) {
        if (isPlayer(e) || !canFight(e)) continue;
        try {
          if (e.target?.id === boss.id) {
            s.mobFoeId = e.id;
            s.mobFoeTick = system.currentTick;
            return e;
          }
        } catch { }
      }
    } catch { }
  }

  // 4) nearest survival/adventure player
  const players = alivePlayersNear(boss.dimension, boss.location, 48);
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = distance(p.location, boss.location);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function tickTitan(titan) {
  const s = getState(titan);
  s.stateTicks++;
  if (s.cdCleave > 0) s.cdCleave--;
  if (s.cdLeap > 0) s.cdLeap--;
  if (s.cdDash > 0) s.cdDash--;
  if (s.cdParry > 0) s.cdParry--;
  if (s.cdThrow > 0) s.cdThrow--;
  if (s.cdSummon > 0) s.cdSummon--;
  if (s.cdSmash > 0) s.cdSmash--;
  if (s.cdGrapple > 0) s.cdGrapple--;
  if (s.cdJudgment > 0) s.cdJudgment--;
  if (s.cdProjParry > 0) s.cdProjParry--;
  if (s.cdMolten > 0) s.cdMolten--;
  if (s.cdRush > 0) s.cdRush--;

  // Aegis Return: while the window is open, bat projectiles back
  if (system.currentTick < s.deflectUntil) deflectProjectiles(titan, s);

  // phase checks (also caught in the hurt handler, this is a safety net)
  const health = titan.getComponent("minecraft:health");
  const hpFrac = health ? health.currentValue / health.effectiveMax : 1;
  if (!s.raged && hpFrac <= 0.5) enterRage(titan, s);
  // keep the rage stat boost topped up (effect-based, no AI reset)
  if (s.raged && s.stateTicks % 100 === 0) rageBoost(titan);

  switch (s.state) {
    case "cleave": return tickCleave(titan, s);
    case "leap": return tickLeap(titan, s);
    case "dash": return tickDash(titan, s);
    case "throw": return tickThrow(titan, s);
    case "summon": return tickSummon(titan, s);
    case "smash": return tickSmash(titan, s);
    case "grapple": return tickGrapple(titan, s);
    case "stumble": return tickStumble(titan, s);
    case "drag": return tickDrag(titan, s);
    case "pummel": return tickPummel(titan, s);
    case "molten": return tickMolten(titan, s);
    case "rush": return tickRush(titan, s);
    case "skyhurl": return tickSkyhurl(titan, s);
    case "parry": return tickParry(titan, s);
    case "judgment": return tickJudgment(titan, s);
    case "stunned": return tickStunned(titan, s);
  }

  // ---- idle: rage ambience + decide next move ----
  if (s.raged && s.stateTicks % 30 === 0) {
    // the arena cracks and burns around him
    const loc = titan.location;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 7;
      const x = loc.x + Math.cos(a) * r;
      const z = loc.z + Math.sin(a) * r;
      const y = groundY(titan.dimension, x, loc.y, z);
      particle(titan.dimension, "minecraft:lava_particle", { x, y, z });
      particle(titan.dimension, "minecraft:basic_flame_particle", { x, y: y + 0.3, z });
    }
  }

  if (s.stateTicks < 0) return; // recovery window

  const target = nearestTarget(titan, s);
  if (!target) return;
  const dist = distance(target.location, titan.location);

  // shield pressure: turtling in his face provokes the Oathcrusher
  if (dist <= 6 && isBlocking(target)) {
    s.shieldPressure += 1;
  } else if (s.shieldPressure > 0) {
    s.shieldPressure -= 0.5;
  }

  // airtime tracking: staying off the ground provokes the Skybreaker
  try {
    if (!target.isOnGround) {
      s.targetAir = Math.min(80, s.targetAir + 1);
    } else if (s.targetAir > 0) {
      s.targetAir = Math.max(0, s.targetAir - 2);
    }
  } catch { }

  // Final Judgment at 10% HP
  if (hpFrac <= 0.1 && s.cdJudgment <= 0) {
    startJudgment(titan, s);
    return;
  }
  // Oathcrusher Smash: punish shield turtles
  if (s.cdSmash <= 0 && s.shieldPressure >= SMASH_PRESSURE_TRIGGER && dist <= SMASH_RANGE + 1) {
    startSmash(titan, s, target);
    return;
  }
  // Molten Explosion: close-range eruption
  if (s.cdMolten <= 0 && dist <= 5.5) {
    startMolten(titan, s);
    return;
  }
  // Titan Grapple
  if (s.cdGrapple <= 0 && dist >= 3 && dist <= 9) {
    startGrapple(titan, s, target);
    return;
  }
  // Skybreaker: they've been in the air too much — rip them down
  if (s.cdLeap <= 0 && dist >= 4 && dist <= 24 && s.targetAir >= SKY_AIR_TRIGGER) {
    s.targetAir = 0;
    startLeap(titan, s, target, true);
    return;
  }
  // Earthsplitter Leap
  if (s.cdLeap <= 0 && dist >= 5 && dist <= 24) {
    startLeap(titan, s, target);
    return;
  }
  // Fiery dash (rage only)
  if (s.raged && s.cdDash <= 0 && dist >= 5 && dist <= 16) {
    startDash(titan, s, target);
    return;
  }
  // Skyhurl Rush: charge, snatch, throw them into the sky
  if (s.cdRush <= 0 && dist >= 6 && dist <= 16) {
    startRush(titan, s, target);
    return;
  }
  // Groundbreaker Throw: rip up the floor at range
  if (s.cdThrow <= 0 && dist >= 8 && dist <= 26) {
    startThrow(titan, s, target);
    return;
  }
  // Core Minis
  if (s.cdSummon <= 0 && dist <= 30 && countMinis(titan) < MINI_CAP + (s.raged ? 2 : 0)) {
    startSummon(titan, s);
    return;
  }
  // Titan Cleave
  if (s.cdCleave <= 0 && dist <= CLEAVE_RANGE - 0.5) {
    startCleave(titan, s, target);
    return;
  }
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
const DIMENSIONS = ["overworld", "nether", "the_end"];

system.runInterval(() => {
  tickShockwaves();
  for (const dimId of DIMENSIONS) {
    let entities;
    try {
      entities = world.getDimension(dimId).getEntities({ type: TITAN_ID });
    } catch {
      continue;
    }
    for (const titan of entities) {
      try {
        tickTitan(titan);
      } catch { /* keep the loop alive if one titan throws */ }
    }
  }
}, 1);

// housekeeping: drop state for titans that no longer exist
system.runInterval(() => {
  const liveIds = new Set();
  for (const dimId of DIMENSIONS) {
    try {
      for (const t of world.getDimension(dimId).getEntities({ type: TITAN_ID })) liveIds.add(t.id);
    } catch { }
  }
  for (const id of titans.keys()) {
    if (!liveIds.has(id)) titans.delete(id);
  }
  const now = system.currentTick;
  for (const [id, info] of returnedShots) {
    if (now > info.expire) returnedShots.delete(id);
  }
}, 600);

// ---------------------------------------------------------------------
// Damage events: rage trigger, Oathbound Parry, Judgment interrupt,
// stumble vulnerability
// ---------------------------------------------------------------------
world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  const src = ev.damageSource?.damagingEntity;

  // the Titan dealt damage to a mob (vanilla melee or an ability):
  // remember it as his foe so the moveset stays aimed at it
  if (src?.typeId === TITAN_ID && hurt && !isPlayer(hurt) && canFight(hurt)) {
    const ts = getState(src);
    ts.mobFoeId = hurt.id;
    ts.mobFoeTick = system.currentTick;
  }

  if (hurt.typeId !== TITAN_ID) return;
  const titan = hurt;
  const s = getState(titan);

  const health = titan.getComponent("minecraft:health");
  if (health && !s.raged && health.currentValue / health.effectiveMax <= 0.5) {
    enterRage(titan, s);
  }

  const attacker = src;
  // a mob attacked the Titan: hold the grudge
  if (attacker && !isPlayer(attacker) && canFight(attacker)) {
    s.mobFoeId = attacker.id;
    s.mobFoeTick = system.currentTick;
  }

  // pelted with projectiles? He answers with the Aegis Return
  try {
    if (ev.damageSource?.cause === EntityDamageCause.projectile) {
      const now = system.currentTick;
      if (attacker) s.lastShooterId = attacker.id;
      s.projHits = s.projHits.filter((t) => now - t <= PROJ_WINDOW);
      s.projHits.push(now);
      if (
        s.projHits.length >= PROJ_PARRY_HITS &&
        s.cdProjParry <= 0 &&
        s.state !== "judgment" && s.state !== "stunned" &&
        s.state !== "drag" && s.state !== "pummel" && s.state !== "grapple"
      ) {
        s.projHits = [];
        s.cdProjParry = PROJ_PARRY_COOLDOWN;
        s.deflectUntil = now + DEFLECT_WINDOW;
        s.reflected.clear();
        try { titan.addEffect("resistance", DEFLECT_WINDOW, { amplifier: 2, showParticles: false }); } catch { }
        if (s.state === "idle" || s.state === "cleave") {
          s.state = "parry";
          s.stateTicks = 0;
          s.parryTargetId = null;
          setAnimState(titan, "parry");
          freeze(titan, PARRY_LENGTH);
        }
        playSoundAt(titan.dimension, "random.anvil_land", titan.location, 2);
        actionbarNearby(titan, 40, "§6⚔ The Titan bats your projectiles back FIVE-FOLD!");
        // the shot that triggered the parry comes right back, in kind
        returnProjectile(titan, s, ev.damageSource?.damagingProjectile?.typeId ?? "minecraft:arrow", 2.5);
      } else if (now < s.deflectUntil) {
        // anything that lands inside the window is answered in kind
        returnProjectile(titan, s, ev.damageSource?.damagingProjectile?.typeId ?? "minecraft:arrow", 2.5);
      }
    }
  } catch { }
  if (!attacker || attacker.typeId !== "minecraft:player") return;

  // Final Judgment: only a frontal hit reaches the glowing chest core
  if (s.state === "judgment") {
    const fwd = titan.getViewDirection();
    const to = norm2d(sub(attacker.location, titan.location));
    if (fwd.x * to.x + fwd.z * to.z > 0.3) {
      s.judgmentInterrupted = true;
    } else {
      try { attacker.onScreenDisplay.setActionBar("§7Your blow glances off — hit the core on his chest!"); } catch { }
    }
    return;
  }
  if (s.state === "stunned" || s.state === "parry") return;

  // stumbling after a whiffed grapple: hits land 50% harder
  if (s.state === "stumble") {
    try {
      // extra damage with no damagingEntity, so this can't re-enter
      titan.applyDamage(Math.max(1, Math.ceil(ev.damage * 0.5)), {
        cause: EntityDamageCause.override
      });
    } catch { }
    return; // no parry while stumbling
  }

  // Oathbound Parry: punish rapid attacks
  const now = system.currentTick;
  const log = (s.hitLog.get(attacker.id) ?? []).filter((t) => now - t <= PARRY_WINDOW);
  log.push(now);
  s.hitLog.set(attacker.id, log);
  if (
    log.length >= PARRY_HITS &&
    s.cdParry <= 0 &&
    (s.state === "idle" || s.state === "cleave") &&
    distance(attacker.location, titan.location) <= 7
  ) {
    startParry(titan, s, attacker);
  }
});

world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;

  // ============ PHASE 1 DEATH: HE REFUSES ============
  if (dead.typeId === TITAN_ID) {
    titans.delete(dead.id);
    const dimension = dead.dimension;
    const loc = { ...dead.location };
    try {
      playSoundAt(dimension, "mob.wither.death", loc, 3);
      playSoundAt(dimension, "ambient.weather.thunder", loc, 3);
      particle(dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
      // a column of ash swallows the corpse
      for (let i = 0; i < 24; i++) {
        particle(dimension, "minecraft:basic_smoke_particle", {
          x: loc.x + (Math.random() - 0.5) * 4, y: loc.y + Math.random() * 5, z: loc.z + (Math.random() - 0.5) * 4
        });
      }
      for (const p of alivePlayersNear(dimension, loc, 70)) {
        p.onScreenDisplay.setTitle("§5THE OATH REFUSES DEATH", {
          subtitle: "§bSomething colder than fire takes shape...",
          fadeInDuration: 5,
          stayDuration: 60,
          fadeOutDuration: 20
        });
      }
    } catch { }
    // the Obsidian Overlord rises from the ash
    system.runTimeout(() => {
      try {
        const gy = groundY(dimension, loc.x, loc.y + 1, loc.z);
        const overlord = dimension.spawnEntity(OVERLORD_ID, { x: loc.x, y: gy, z: loc.z });
        getOvState(overlord);
        playSoundAt(dimension, "mob.wither.spawn", loc, 4);
        playSoundAt(dimension, "mob.enderdragon.growl", loc, 3);
        particle(dimension, "minecraft:knockback_roar_particle", { x: loc.x, y: gy + 0.5, z: loc.z });
        for (let i = 0; i < 16; i++) {
          const a = (Math.PI * 2 * i) / 16;
          particle(dimension, "minecraft:blue_flame_particle", {
            x: loc.x + Math.cos(a) * 2.5, y: gy + 0.4 + (i % 4) * 0.7, z: loc.z + Math.sin(a) * 2.5
          });
        }
        for (const p of alivePlayersNear(dimension, loc, 70)) {
          p.onScreenDisplay.setTitle("§0THE OBSIDIAN OVERLORD", {
            subtitle: "§b\"Death was merely an interruption.\"",
            fadeInDuration: 10,
            stayDuration: 70,
            fadeOutDuration: 20
          });
          shakeCamera(p, 0.5, 1.0);
        }
      } catch { }
    }, 24);
    return;
  }

  // ============ OVERLORD DIES (debug/edge only — normal play transitions) ============
  if (dead.typeId === OVERLORD_ID) {
    overlords.delete(dead.id);
    try {
      const loc = dead.location;
      const dimension = dead.dimension;
      playSoundAt(dimension, "mob.enderdragon.death", loc, 4);
      particle(dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      for (const t of [MINI_ID, CLONE_ID]) {
        for (const e of dimension.getEntities({ type: t, location: loc, maxDistance: 80 })) {
          try { e.kill(); } catch { }
        }
      }
    } catch { }
    return;
  }

  // ============ TRUE FINAL DEATH: THE MOLTEN GOD FALLS ============
  if (dead.typeId === MOLTEN_GOD_ID) {
    gods.delete(dead.id);
    try {
      const loc = dead.location;
      const dimension = dead.dimension;
      playSoundAt(dimension, "mob.enderdragon.death", loc, 4);
      playSoundAt(dimension, "random.levelup", loc, 3);
      particle(dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      for (let i = 0; i < 30; i++) {
        particle(dimension, "minecraft:basic_flame_particle", {
          x: loc.x + (Math.random() - 0.5) * 5, y: loc.y + Math.random() * 5, z: loc.z + (Math.random() - 0.5) * 5
        });
      }
      // every conjuration dies with the god
      for (const t of [MINI_ID, CLONE_ID, SOLAR_ID, CRYSTAL_ID, PILLAR_ID, BLADE_ID, LEVIATHAN_ID]) {
        for (const e of dimension.getEntities({ type: t, location: loc, maxDistance: 100 })) {
          try { e.kill(); } catch { }
        }
      }
      for (const p of alivePlayersNear(dimension, loc, 100)) {
        p.onScreenDisplay.setTitle("§eTHE OATH IS BROKEN", {
          subtitle: "§7Even a god can fall. Nothing rises this time.",
          fadeInDuration: 10,
          stayDuration: 90,
          fadeOutDuration: 30
        });
      }
    } catch { }
    return;
  }
});

// ---------------------------------------------------------------------
// Summoning ritual: use a Forged Oath on a Molten Heart in a stone arena
// ---------------------------------------------------------------------
const STONE_HINTS = [
  "stone", "cobble", "deepslate", "andesite", "diorite", "granite",
  "brick", "tuff", "basalt", "blackstone"
];

function isArenaStone(typeId) {
  return STONE_HINTS.some((h) => typeId.includes(h));
}

function countArenaStone(dimension, center) {
  let count = 0;
  for (let dx = -5; dx <= 5; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      for (let dy = -2; dy <= 0; dy++) {
        try {
          const b = dimension.getBlock({
            x: center.x + dx,
            y: center.y + dy,
            z: center.z + dz
          });
          if (b && isArenaStone(b.typeId)) {
            count++;
            break; // count each column once
          }
        } catch { }
      }
    }
  }
  return count;
}

world.afterEvents.itemUseOn.subscribe((ev) => {
  if (ev.itemStack?.typeId !== "ob:forged_oath") return;
  const block = ev.block;
  if (block?.typeId !== "ob:molten_heart") return;
  const player = ev.source;
  const dimension = block.dimension;
  const center = { x: block.x, y: block.y, z: block.z };

  // only one Titan at a time
  const existing = dimension.getEntities({
    type: TITAN_ID,
    location: { x: center.x + 0.5, y: center.y, z: center.z + 0.5 },
    maxDistance: 48
  });
  if (existing.length > 0) {
    try { player.onScreenDisplay.setActionBar("§cAn Oathbreaker Titan already stalks this arena."); } catch { }
    return;
  }

  // the ritual demands a stone arena (floor around the Molten Heart)
  const stone = countArenaStone(dimension, center);
  if (stone < 60) {
    try {
      player.onScreenDisplay.setActionBar("§cThe Oath finds no arena of stone. Build a stone floor around the Molten Heart.");
    } catch { }
    playSoundAt(dimension, "mob.villager.no", center, 1.5);
    return;
  }

  // consume one Forged Oath
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (inv) {
      const slot = player.selectedSlot;
      const held = inv.getItem(slot);
      if (held?.typeId === "ob:forged_oath") {
        if (held.amount > 1) {
          held.amount -= 1;
          inv.setItem(slot, held);
        } else {
          inv.setItem(slot, undefined);
        }
      }
    }
  } catch { }

  // the Molten Heart burns out
  try { block.setType("minecraft:magma"); } catch {
    try { dimension.runCommandAsync(`setblock ${center.x} ${center.y} ${center.z} magma`); } catch { }
  }

  const spawnLoc = { x: center.x + 0.5, y: center.y + 1, z: center.z + 2.5 };
  playSoundAt(dimension, "mob.wither.spawn", spawnLoc, 4);
  particle(dimension, "minecraft:huge_explosion_emitter", spawnLoc);
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    particle(dimension, "minecraft:lava_particle", {
      x: spawnLoc.x + Math.cos(a) * 2, y: spawnLoc.y + 0.3, z: spawnLoc.z + Math.sin(a) * 2
    });
    particle(dimension, "minecraft:basic_flame_particle", {
      x: spawnLoc.x + Math.cos(a) * 2, y: spawnLoc.y + 1.2, z: spawnLoc.z + Math.sin(a) * 2
    });
  }

  try {
    const titan = dimension.spawnEntity(TITAN_ID, spawnLoc);
    getState(titan); // register immediately
  } catch {
    try { player.onScreenDisplay.setActionBar("§cThe ritual fizzled — is there room for the Titan to rise?"); } catch { }
    return;
  }

  for (const p of alivePlayersNear(dimension, spawnLoc, 60)) {
    try {
      p.onScreenDisplay.setTitle("§4OATHBREAKER TITAN", {
        subtitle: "§6The molten oath awakens...",
        fadeInDuration: 10,
        stayDuration: 60,
        fadeOutDuration: 20
      });
    } catch { }
  }
});

// =====================================================================
//  THE FINAL FORM — OBSIDIAN OVERLORD
//  World-Ender Meteor, Gravity Well, Hellfire Clones,
//  Executioner's Chain, Cataclysmic Eruption aura
// =====================================================================
const OV_CLEAVE_COOLDOWN = 50;
const OV_CLEAVE_DAMAGE = 16;
const OV_CLEAVE_RANGE = 5.5;

const METEOR_COOLDOWN = 620;
const METEOR_RISE_TICKS = 10;
const METEOR_LOCK_TICK = 30;     // shadow locks here — sprint OUT of the ring
const METEOR_CRASH_TICK = 52;
const METEOR_DAMAGE = 30;
const METEOR_RADIUS = 11;

const GRAVITY_COOLDOWN = 520;
const GRAVITY_PULL_TICKS = 70;
const GRAVITY_RADIUS = 12;
const GRAVITY_BURST_DAMAGE = 18;
const GRAVITY_BURST_RADIUS = 7;

const CLONES_COOLDOWN = 700;
const CLONE_COUNT = 3;           // +1 sometimes
const CLONE_EXPLODE_RANGE = 2.3;
const CLONE_EXPLODE_DAMAGE = 14;
const CLONE_FUSE_TICKS = 280;    // detonate even if they never reach anyone

const CHAIN_COOLDOWN = 460;
const CHAIN_FLY_TICKS = 16;
const CHAIN_STEP = 2.2;
const CHAIN_HOOK_RADIUS = 1.8;
const CHAIN_REEL_TIMEOUT = 100;  // hooked this long = reeled in regardless
const CHAIN_PULL = 0.5;          // dragged toward him every other tick
const CHAIN_ESCAPE_JUMPS = 5;    // SPAM JUMP to shatter the chain
const EXECUTE_HIT_TICK = 9;
const EXECUTE_DAMAGE = 25;       // unblockable

const AURA_INTERVAL = 25;        // ground fractures under him constantly
const AURA_TELEGRAPH = 15;
const AURA_DAMAGE = 8;
const AURA_RADIUS_MIN = 3;
const AURA_RADIUS_MAX = 9;

const overlords = new Map();

function getOvState(ov) {
  let s = overlords.get(ov.id);
  if (!s) {
    s = {
      state: "idle",
      stateTicks: 0,
      cdCleave: 30,
      cdMeteor: 160,
      cdGravity: 300,
      cdClones: 420,
      cdChain: 220,
      cleaveHit: false,
      meteorLock: null,
      chainDir: null,
      chainTip: null,
      chainVictimId: null,
      chainJumps: 0,
      chainWasJumping: false,
      cdHellrush: 400,
      hellUsed: false,
      hellBuff: false,
      hellDir: null,
      hellVictimId: null,
      catalyzed: false,
      absorbing: false,
      leviathanId: null,
      absorbTicks: 0,
      mobFoeId: null,
      mobFoeTick: -9999,
      lastHostileScan: -99
    };
    overlords.set(ov.id, s);
  }
  return s;
}

// ---- Cataclysmic Eruption aura: the arena itself turns hostile ----
const eruptions = []; // { dimension, x, y, z, born }

function tickEruptions() {
  const now = system.currentTick;
  for (let i = eruptions.length - 1; i >= 0; i--) {
    const e = eruptions[i];
    const age = now - e.born;
    if (age < AURA_TELEGRAPH) {
      if (age % 3 === 0) {
        particle(e.dimension, "minecraft:basic_smoke_particle", { x: e.x, y: e.y + 0.2, z: e.z });
        particle(e.dimension, "minecraft:basic_flame_particle", { x: e.x, y: e.y + 0.1, z: e.z });
      }
      continue;
    }
    // the ground bursts: a pillar of fire and magma
    playSoundAt(e.dimension, "random.explode", e, 1.2);
    for (let h = 0; h < 4; h++) {
      particle(e.dimension, "minecraft:lava_particle", { x: e.x, y: e.y + h * 0.8, z: e.z });
      particle(e.dimension, "minecraft:basic_flame_particle", { x: e.x, y: e.y + 0.3 + h * 0.8, z: e.z });
    }
    particle(e.dimension, "minecraft:large_explosion", { x: e.x, y: e.y + 0.5, z: e.z });
    for (const v of victimsNearDim(e.dimension, { x: e.x, y: e.y, z: e.z }, 2.4)) {
      try {
        v.applyDamage(AURA_DAMAGE, { cause: EntityDamageCause.entityAttack });
        v.setOnFire(3, true);
        v.applyKnockback(0, 0, 0, 0.9);
      } catch { }
    }
    eruptions.splice(i, 1);
  }
}

// ---- move starters ----
function ovStartCleave(ov, s, target) {
  s.state = "cleave";
  s.stateTicks = 0;
  s.cleaveHit = false;
  s.cdCleave = OV_CLEAVE_COOLDOWN;
  setAnimState(ov, "cleave");
  freeze(ov, CLEAVE_LENGTH);
  faceTarget(ov, target);
  playSoundAt(ov.dimension, "mob.ravager.bite", ov.location, 2);
}

function ovStartMeteor(ov, s, target) {
  s.state = "meteor";
  s.stateTicks = 0;
  s.cdMeteor = METEOR_COOLDOWN;
  s.meteorLock = { ...target.location };
  setAnimState(ov, "meteor");
  playSoundAt(ov.dimension, "mob.enderdragon.growl", ov.location, 4);
  titleNearby(ov, 60, "§0WORLD-ENDER", "§cRun from the shadow!");
}

function ovStartGravity(ov, s) {
  s.state = "gravity";
  s.stateTicks = 0;
  s.cdGravity = GRAVITY_COOLDOWN;
  setAnimState(ov, "gravity");
  freeze(ov, GRAVITY_PULL_TICKS + 20);
  playSoundAt(ov.dimension, "mob.enderdragon.flap", ov.location, 3);
  actionbarNearby(ov, 40, "§5🌀 GRAVITY WELL — fight the pull!");
}

function ovStartClones(ov, s) {
  s.state = "summon";
  s.stateTicks = 0;
  s.cdClones = CLONES_COOLDOWN;
  setAnimState(ov, "summon");
  freeze(ov, 26);
  playSoundAt(ov.dimension, "mob.evocation_illager.prepare_summon", ov.location, 3);
  actionbarNearby(ov, 40, "§c⚠ HELLFIRE CLONES — they explode on contact!");
}

function ovStartChain(ov, s, target) {
  s.state = "chain";
  s.stateTicks = 0;
  s.cdChain = CHAIN_COOLDOWN;
  s.chainVictimId = null;
  s.chainJumps = 0;
  s.chainWasJumping = false;
  const chest = { x: ov.location.x, y: ov.location.y + 1.6, z: ov.location.z };
  s.chainTip = { ...chest };
  s.chainDir = norm3d(sub(
    { x: target.location.x, y: target.location.y + 1, z: target.location.z }, chest));
  setAnimState(ov, "chain");
  freeze(ov, CHAIN_FLY_TICKS + 4);
  faceTarget(ov, target);
  playSoundAt(ov.dimension, "random.anvil_land", ov.location, 2);
  actionbarNearby(ov, 40, "§8⛓ THE EXECUTIONER'S CHAIN!");
}

// ---- move ticks ----
function ovTickCleave(ov, s) {
  if (s.stateTicks === CLEAVE_HIT_TICK && !s.cleaveHit) {
    s.cleaveHit = true;
    const fwd = ov.getViewDirection();
    playSoundAt(ov.dimension, "mob.irongolem.throw", ov.location, 2);
    for (const p of victimsNearDim(ov.dimension, ov.location, OV_CLEAVE_RANGE)) {
      const to = norm2d(sub(p.location, ov.location));
      if (fwd.x * to.x + fwd.z * to.z < 0.35) continue;
      hurtPlayer(ov, p, isBlocking(p) ? Math.ceil(OV_CLEAVE_DAMAGE / 2) : OV_CLEAVE_DAMAGE);
      knockPlayer(p, to, 1.3, 0.4);
    }
  }
  if (s.stateTicks >= CLEAVE_LENGTH) ovBackToIdle(ov, s);
}

function ovTickMeteor(ov, s) {
  const t = s.stateTicks;

  if (t <= METEOR_RISE_TICKS) {
    // roars skyward, trailing blue fire
    const loc = ov.location;
    try { ov.teleport({ x: loc.x, y: loc.y + 7, z: loc.z }); } catch { }
    particle(ov.dimension, "minecraft:blue_flame_particle", loc);
    return;
  }

  // gone from the arena — only the shadow and the smoke remain
  if (t < METEOR_LOCK_TICK) {
    const target = nearestTarget(ov, s);
    if (target) s.meteorLock = { ...target.location };
  }
  const lock = s.meteorLock;
  const gy = groundY(ov.dimension, lock.x, lock.y, lock.z);

  if (t < METEOR_CRASH_TICK) {
    // thick smoke blankets the impact zone; the ring marks the blast
    if (t % 2 === 0) {
      particle(ov.dimension, "minecraft:basic_smoke_particle", {
        x: lock.x + (Math.random() - 0.5) * 8, y: gy + 0.3 + Math.random() * 2, z: lock.z + (Math.random() - 0.5) * 8
      });
    }
    if (t % 4 === 0) {
      const shrink = Math.max(2, 9 - (t - METEOR_LOCK_TICK) * 0.3);
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10 + t * 0.1;
        particle(ov.dimension, "minecraft:basic_flame_particle", {
          x: lock.x + Math.cos(a) * shrink, y: gy + 0.2, z: lock.z + Math.sin(a) * shrink
        });
      }
      playSoundAt(ov.dimension, "mob.ghast.moan", { x: lock.x, y: gy, z: lock.z }, 1.5);
    }
    return;
  }

  if (t === METEOR_CRASH_TICK) {
    // THE SKY FALLS
    const land = { x: lock.x, y: gy, z: lock.z };
    try { ov.teleport(land); } catch { }
    setAnimState(ov, "slam");
    playSoundAt(ov.dimension, "random.explode", land, 5);
    playSoundAt(ov.dimension, "ambient.weather.thunder", land, 4);
    particle(ov.dimension, "minecraft:huge_explosion_emitter", { x: land.x, y: land.y + 1, z: land.z });
    particle(ov.dimension, "minecraft:knockback_roar_particle", { x: land.x, y: land.y + 0.5, z: land.z });
    try {
      ov.dimension.createExplosion({ x: land.x, y: land.y + 1, z: land.z }, 8, {
        breaksBlocks: false,
        causesFire: false,
        source: ov
      });
    } catch { }
    for (const p of victimsNearDim(ov.dimension, land, METEOR_RADIUS)) {
      const d = Math.max(1, distance(p.location, land));
      hurtPlayer(ov, p, Math.round(METEOR_DAMAGE * Math.min(1, 4.5 / d)));
      knockPlayer(p, norm2d(sub(p.location, land)), 2.6, 1.0);
    }
    for (const p of alivePlayersNear(ov.dimension, land, 30)) shakeCamera(p, 1.0, 1.2);
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      try {
        const chunk = ov.dimension.spawnEntity("ob:debris", {
          x: land.x + Math.cos(a) * 1.5, y: land.y + 1, z: land.z + Math.sin(a) * 1.5
        });
        chunk.applyImpulse({
          x: Math.cos(a) * (0.3 + Math.random() * 0.5),
          y: 0.9 + Math.random() * 0.7,
          z: Math.sin(a) * (0.3 + Math.random() * 0.5)
        });
      } catch { }
    }
    return;
  }

  if (t >= METEOR_CRASH_TICK + 16) ovBackToIdle(ov, s, 14);
}

function ovTickGravity(ov, s) {
  const t = s.stateTicks;
  const loc = ov.location;
  freeze(ov, 5);

  if (t <= GRAVITY_PULL_TICKS) {
    // the swirling vortex: three arms of blue fire spiraling inward
    const a0 = t * 0.35;
    for (let arm = 0; arm < 3; arm++) {
      const a = a0 + (Math.PI * 2 * arm) / 3;
      const r = 7 - (t % 20) * 0.25;
      particle(ov.dimension, "minecraft:blue_flame_particle", {
        x: loc.x + Math.cos(a) * r, y: loc.y + 0.4, z: loc.z + Math.sin(a) * r
      });
      particle(ov.dimension, "minecraft:lava_particle", {
        x: loc.x + Math.cos(a) * (r * 0.55), y: loc.y + 0.7, z: loc.z + Math.sin(a) * (r * 0.55)
      });
    }
    if (t % 20 === 0) playSoundAt(ov.dimension, "mob.enderdragon.flap", loc, 2);

    // drag everything in — and pin whatever reaches the center
    if (t % 2 === 0) {
      for (const v of victimsNearDim(ov.dimension, loc, GRAVITY_RADIUS)) {
        const d = distance(v.location, loc);
        if (d > 2.5) {
          const pull = norm2d(sub(loc, v.location));
          knockPlayer(v, pull, Math.min(0.6, d * 0.07), 0.06);
        } else {
          try { v.addEffect("slowness", 15, { amplifier: 5, showParticles: false }); } catch { }
        }
      }
    }
    return;
  }

  if (t === GRAVITY_PULL_TICKS + 1) {
    // the follow-up: everything held close gets detonated
    playSoundAt(ov.dimension, "random.explode", loc, 4);
    particle(ov.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
    for (const v of victimsNearDim(ov.dimension, loc, GRAVITY_BURST_RADIUS)) {
      hurtPlayer(ov, v, GRAVITY_BURST_DAMAGE);
      try { v.setOnFire(4, true); } catch { }
      knockPlayer(v, norm2d(sub(v.location, loc)), 2.0, 0.9);
      shakeCamera(v, 0.6, 0.6);
    }
    return;
  }

  if (t >= GRAVITY_PULL_TICKS + 14) ovBackToIdle(ov, s, 12);
}

function ovTickSummon(ov, s) {
  const t = s.stateTicks;
  if (t === 12) {
    const count = CLONE_COUNT + (Math.random() < 0.5 ? 1 : 0);
    const target = nearestTarget(ov, s);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count;
      const pos = {
        x: ov.location.x + Math.cos(a) * 2.5,
        y: ov.location.y + 0.1,
        z: ov.location.z + Math.sin(a) * 2.5
      };
      try {
        const clone = ov.dimension.spawnEntity(CLONE_ID, pos);
        cloneBirth.set(clone.id, system.currentTick);
        if (target && !isPlayer(target)) {
          try {
            clone.applyDamage(1, {
              cause: EntityDamageCause.entityAttack,
              damagingEntity: target
            });
          } catch { }
        }
        particle(ov.dimension, "minecraft:lava_particle", pos);
        particle(ov.dimension, "minecraft:basic_flame_particle", { x: pos.x, y: pos.y + 1, z: pos.z });
      } catch { }
    }
    playSoundAt(ov.dimension, "mob.evocation_illager.cast_spell", ov.location, 3);
  }
  if (t >= 26) ovBackToIdle(ov, s);
}

function ovTickChain(ov, s) {
  const t = s.stateTicks;

  // chain in flight
  if (!s.chainVictimId) {
    if (t > CHAIN_FLY_TICKS) {
      ovBackToIdle(ov, s, 10); // whiffed into the dark
      return;
    }
    s.chainTip.x += s.chainDir.x * CHAIN_STEP;
    s.chainTip.y += s.chainDir.y * CHAIN_STEP;
    s.chainTip.z += s.chainDir.z * CHAIN_STEP;
    particle(ov.dimension, "minecraft:critical_hit_emitter", s.chainTip);
    particle(ov.dimension, "minecraft:basic_flame_particle", s.chainTip);
    for (const v of victimsNearDim(ov.dimension, s.chainTip, CHAIN_HOOK_RADIUS + 1)) {
      if (distance(v.location, s.chainTip) > CHAIN_HOOK_RADIUS &&
        distance({ x: v.location.x, y: v.location.y + 1, z: v.location.z }, s.chainTip) > CHAIN_HOOK_RADIUS) continue;
      // WRAPPED
      s.chainVictimId = v.id;
      s.chainJumps = 0;
      s.chainWasJumping = false;
      s.stateTicks = 0;
      playSoundAt(ov.dimension, "random.anvil_use", v.location, 2.5);
      tellVictim(v, `§8⛓ CHAINED — §eSPAM JUMP §8(${CHAIN_ESCAPE_JUMPS}x) to break free!`);
      return;
    }
    return;
  }

  // victim wrapped: reel them in while he keeps fighting
  let victim = null;
  try { victim = world.getEntity(s.chainVictimId); } catch { }
  if (!victim || victim.dimension.id !== ov.dimension.id ||
    distance(victim.location, ov.location) > 40) {
    s.chainVictimId = null;
    ovBackToIdle(ov, s, 8);
    return;
  }

  // ESCAPE: mash jump to shatter the chain
  if (isPlayer(victim)) {
    try {
      const jumping = victim.isJumping;
      if (jumping && !s.chainWasJumping) {
        s.chainJumps++;
        if (s.chainJumps < CHAIN_ESCAPE_JUMPS) {
          tellVictim(victim, `§e⛓ ${s.chainJumps}/${CHAIN_ESCAPE_JUMPS} — KEEP JUMPING!`);
          playSoundAt(ov.dimension, "random.anvil_use", victim.location, 1);
        }
      }
      s.chainWasJumping = jumping;
    } catch { }
    if (s.chainJumps >= CHAIN_ESCAPE_JUMPS) {
      // CHAIN SHATTERED
      tellVictim(victim, "§a⛓ CHAIN SHATTERED — RUN!");
      playSoundAt(ov.dimension, "random.break", victim.location, 2);
      particle(ov.dimension, "minecraft:critical_hit_emitter", victim.location);
      try { victim.addEffect("speed", 60, { amplifier: 1, showParticles: false }); } catch { }
      s.chainVictimId = null;
      ovBackToIdle(ov, s, 24); // he staggers when it snaps
      return;
    }
  }

  // the reel: dragged toward him, tick by tick (he stays free to move)
  if (t % 2 === 0) {
    const pull = norm2d(sub(ov.location, victim.location));
    knockPlayer(victim, pull, CHAIN_PULL, 0.1);
  }
  try { victim.addEffect("slowness", 8, { amplifier: 2, showParticles: false }); } catch { }
  try { ov.teleport(ov.location, { facingLocation: victim.location }); } catch { }

  if (t % 3 === 0) {
    // the burning chain between them
    const from = { x: ov.location.x, y: ov.location.y + 1.4, z: ov.location.z };
    const to = { x: victim.location.x, y: victim.location.y + 1, z: victim.location.z };
    for (let i = 1; i <= 7; i++) {
      const f = i / 8;
      particle(ov.dimension, "minecraft:basic_flame_particle", {
        x: from.x + (to.x - from.x) * f,
        y: from.y + (to.y - from.y) * f,
        z: from.z + (to.z - from.z) * f
      });
    }
  }

  const gap = distance(victim.location, ov.location);
  if (gap > 3.4 && t < CHAIN_REEL_TIMEOUT) return;

  // reeled all the way in (or time's up): THE EXECUTION
  s.state = "execute";
  s.stateTicks = 0;
  setAnimState(ov, "execute");
  freeze(ov, 24);
}

function ovTickExecute(ov, s) {
  const t = s.stateTicks;
  if (t === EXECUTE_HIT_TICK) {
    let victim = null;
    try { victim = world.getEntity(s.chainVictimId); } catch { }
    if (victim && victim.dimension.id === ov.dimension.id &&
      distance(victim.location, ov.location) <= 6) {
      // unblockable, and it doesn't care about your shield
      hurtPlayer(ov, victim, EXECUTE_DAMAGE);
      knockPlayer(victim, norm2d(sub(victim.location, ov.location)), 2.2, 0.7);
      shakeCamera(victim, 0.8, 0.6);
      playSoundAt(ov.dimension, "mob.irongolem.attack", ov.location, 3);
      particle(ov.dimension, "minecraft:knockback_roar_particle", victim.location);
      tellVictim(victim, "§4⚔ EXECUTED.");
    }
  }
  if (t >= 22) {
    s.chainVictimId = null;
    ovBackToIdle(ov, s, 14);
  }
}

function ovBackToIdle(ov, s, extraRecovery = 0) {
  s.state = "idle";
  s.stateTicks = -extraRecovery;
  setAnimState(ov, "idle");
}

// ---- overlord brain ----
function tickOverlord(ov) {
  const s = getOvState(ov);
  s.stateTicks++;

  // ===== PHASE 3 CATALYST: at the brink, the volcano awakens =====
  if (!s.catalyzed) {
    const h = ov.getComponent("minecraft:health");
    if (h && h.currentValue / h.effectiveMax <= 0.12) {
      enterCatalyst(ov, s);
      return;
    }
  }
  if (s.absorbing) { tickAbsorb(ov, s); return; }

  if (s.cdCleave > 0) s.cdCleave--;
  if (s.cdMeteor > 0) s.cdMeteor--;
  if (s.cdGravity > 0) s.cdGravity--;
  if (s.cdClones > 0) s.cdClones--;
  if (s.cdChain > 0) s.cdChain--;
  if (s.cdHellrush > 0) s.cdHellrush--;

  // the greatsword drips liquid blue fire wherever he moves
  try {
    const v = ov.getVelocity();
    if (Math.abs(v.x) + Math.abs(v.z) > 0.05 && s.stateTicks % 2 === 0) {
      const loc = ov.location;
      particle(ov.dimension, "minecraft:blue_flame_particle", {
        x: loc.x - v.x * 3, y: loc.y + 1.6, z: loc.z - v.z * 3
      });
    }
  } catch { }

  switch (s.state) {
    case "cleave": return ovTickCleave(ov, s);
    case "meteor": return ovTickMeteor(ov, s);
    case "gravity": return ovTickGravity(ov, s);
    case "summon": return ovTickSummon(ov, s);
    case "chain": return ovTickChain(ov, s);
    case "execute": return ovTickExecute(ov, s);
    case "hellrush": return ovTickHellrush(ov, s);
    case "hellpummel": return ovTickHellpummel(ov, s);
  }

  if (s.stateTicks < 0) return; // recovery window

  const target = nearestTarget(ov, s);
  if (!target) return;
  const dist = distance(target.location, ov.location);

  // Cataclysmic Eruption: the earth fractures around him while he fights
  if (s.stateTicks % AURA_INTERVAL === 0) {
    const n = 1 + (Math.random() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = AURA_RADIUS_MIN + Math.random() * (AURA_RADIUS_MAX - AURA_RADIUS_MIN);
      const x = ov.location.x + Math.cos(a) * r;
      const z = ov.location.z + Math.sin(a) * r;
      eruptions.push({
        dimension: ov.dimension,
        x, y: groundY(ov.dimension, x, ov.location.y, z), z,
        born: system.currentTick
      });
    }
  }

  // Hellrush Abduction: once, when they think range means safety
  if (!s.hellUsed && s.cdHellrush <= 0 && dist >= 10 && dist <= 48) {
    ovStartHellrush(ov, s, target);
    return;
  }
  // World-Ender Meteor
  if (s.cdMeteor <= 0 && dist >= 4 && dist <= 34) {
    ovStartMeteor(ov, s, target);
    return;
  }
  // Gravity Well
  if (s.cdGravity <= 0 && dist <= 11) {
    ovStartGravity(ov, s);
    return;
  }
  // Executioner's Chain
  if (s.cdChain <= 0 && dist >= 6 && dist <= 20) {
    ovStartChain(ov, s, target);
    return;
  }
  // Hellfire Clones
  if (s.cdClones <= 0 && dist <= 30) {
    ovStartClones(ov, s);
    return;
  }
  // basic obsidian cleave
  if (s.cdCleave <= 0 && dist <= OV_CLEAVE_RANGE - 0.5) {
    ovStartCleave(ov, s, target);
    return;
  }
}

// ---- hellfire clones: sprint and detonate ----
const cloneBirth = new Map(); // cloneId -> spawn tick

function tickClone(clone) {
  const now = system.currentTick;
  if (!cloneBirth.has(clone.id)) cloneBirth.set(clone.id, now);
  const age = now - cloneBirth.get(clone.id);
  const loc = clone.location;

  // burning from the inside
  if (now % 3 === 0) {
    particle(clone.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
  }

  // find something to die for
  let victim = null;
  let bestD = Infinity;
  for (const v of victimsNearDim(clone.dimension, loc, 24)) {
    const d = distance(v.location, loc);
    if (d < bestD) {
      bestD = d;
      victim = v;
    }
  }

  const boom = (victim && bestD <= CLONE_EXPLODE_RANGE) || age >= CLONE_FUSE_TICKS;
  if (boom) {
    cloneBirth.delete(clone.id);
    playSoundAt(clone.dimension, "random.explode", loc, 2.5);
    particle(clone.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
    try {
      clone.dimension.createExplosion({ x: loc.x, y: loc.y + 1, z: loc.z }, 3.5, {
        breaksBlocks: false,
        causesFire: false,
        source: clone
      });
    } catch { }
    for (const v of victimsNearDim(clone.dimension, loc, 4.5)) {
      try {
        v.applyDamage(CLONE_EXPLODE_DAMAGE, { cause: EntityDamageCause.entityAttack });
        v.setOnFire(4, true);
        v.applyKnockback(
          v.location.x - loc.x, v.location.z - loc.z, 1.4, 0.5);
      } catch { }
    }
    try { clone.remove(); } catch { try { clone.kill(); } catch { } }
    return;
  }

  // vanilla pathfinding does the chasing now (navigates around walls
  // and obstacles); the script only handles the boom
}

// ---- extend the main loop to run the final form ----
system.runInterval(() => {
  tickEruptions();
  for (const dimId of DIMENSIONS) {
    let dimension;
    try {
      dimension = world.getDimension(dimId);
    } catch {
      continue;
    }
    try {
      for (const ov of dimension.getEntities({ type: OVERLORD_ID })) {
        try { tickOverlord(ov); } catch { }
      }
    } catch { }
    try {
      for (const clone of dimension.getEntities({ type: CLONE_ID })) {
        try { tickClone(clone); } catch { }
      }
    } catch { }
  }
}, 1);

// overlord grudge memory: he remembers whoever wounds him
world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  const src = ev.damageSource?.damagingEntity;
  if (src?.typeId === OVERLORD_ID && hurt && !isPlayer(hurt) && canFight(hurt)) {
    const s = getOvState(src);
    s.mobFoeId = hurt.id;
    s.mobFoeTick = system.currentTick;
  }
  if (hurt.typeId !== OVERLORD_ID) return;
  const s = getOvState(hurt);
  if (src && !isPlayer(src) && canFight(src)) {
    s.mobFoeId = src.id;
    s.mobFoeTick = system.currentTick;
  }
  // catch a fatal burst before it kills him: the volcano awakens
  if (!s.catalyzed) {
    try {
      const h = hurt.getComponent("minecraft:health");
      if (h && h.currentValue / h.effectiveMax <= 0.12) enterCatalyst(hurt, s);
    } catch { }
  }
});

// housekeeping for the final form
system.runInterval(() => {
  const liveIds = new Set();
  for (const dimId of DIMENSIONS) {
    try {
      for (const e of world.getDimension(dimId).getEntities({ type: OVERLORD_ID })) liveIds.add(e.id);
    } catch { }
  }
  for (const id of overlords.keys()) {
    if (!liveIds.has(id)) overlords.delete(id);
  }
  const now = system.currentTick;
  for (const [id, born] of cloneBirth) {
    if (now - born > CLONE_FUSE_TICKS + 200) cloneBirth.delete(id);
  }
}, 600);

// =====================================================================
//  HELLRUSH ABDUCTION — 50-block dash; a caught victim eats nine
//  punches (75 total), then everyone nearby is dragged to the Nether
//  and the Overlord ascends: 3x damage and +335 HP. Once per Overlord.
// =====================================================================
const HELLRUSH_COOLDOWN = 900;
const HELLRUSH_TELEGRAPH = 10;
const HELLRUSH_MAX_TICKS = 30;   // x 1.7 blocks/tick = a true 50-block charge
const HELLRUSH_STEP = 1.7;       // teleport-stepped: physics can't shorten it
const HELLRUSH_REACH = 2.6;
const HELLPUMMEL_PUNCHES = 9;
const HELLPUMMEL_INTERVAL = 5;   // a punch every quarter second
const HELLPUMMEL_DAMAGE = 8;     // 8x8 + 11 on the last = exactly 75
const HELLPUMMEL_FINAL = 11;
const ABDUCT_RADIUS = 30;
const HELL_ASCEND_HP = 750;      // full vigor restored on ascension
const HELL_BOOST_AMP = 12;       // health_boost XIII: +52 max HP (700 -> 752 cap)

function ovStartHellrush(ov, s, target) {
  s.state = "hellrush";
  s.stateTicks = 0;
  s.cdHellrush = HELLRUSH_COOLDOWN;
  s.hellUsed = true;
  s.hellVictimId = null;
  s.hellDir = norm2d(sub(target.location, ov.location));
  setAnimState(ov, "dash");
  faceTarget(ov, target);
  playSoundAt(ov.dimension, "mob.enderdragon.growl", ov.location, 4);
  titleNearby(ov, 60, "§4HELLRUSH", "§cHe's coming. RUN.");
}

function ovTickHellrush(ov, s) {
  const t = s.stateTicks;

  if (t < HELLRUSH_TELEGRAPH) {
    const target = nearestTarget(ov, s);
    if (target) {
      s.hellDir = norm2d(sub(target.location, ov.location));
      faceTarget(ov, target);
    }
    const loc = ov.location;
    particle(ov.dimension, "minecraft:blue_flame_particle", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    return;
  }

  if (t <= HELLRUSH_TELEGRAPH + HELLRUSH_MAX_TICKS) {
    // teleport-stepped charge: 1.7 blocks per tick, guaranteed —
    // knockback physics gets damped by the mob's own AI, this doesn't
    const loc = ov.location;
    const nx = loc.x + s.hellDir.x * HELLRUSH_STEP;
    const nz = loc.z + s.hellDir.z * HELLRUSH_STEP;
    const ny = groundY(ov.dimension, nx, loc.y + 1, nz);

    // a wall taller than a climbable step ends the charge
    if (ny - loc.y > 2.5) {
      playSoundAt(ov.dimension, "random.explode", loc, 2);
      particle(ov.dimension, "minecraft:large_explosion", { x: loc.x, y: loc.y + 1, z: loc.z });
      ovBackToIdle(ov, s, 14);
      return;
    }
    // a cliff with no floor below ends it too (no charging into the void)
    let footing = false;
    try {
      const below = ov.dimension.getBlock({ x: Math.floor(nx), y: Math.floor(ny) - 1, z: Math.floor(nz) });
      footing = !!below && !below.isAir && !below.isLiquid;
    } catch { }
    if (!footing) {
      ovBackToIdle(ov, s, 12);
      return;
    }

    try {
      ov.teleport({ x: nx, y: ny, z: nz }, {
        facingLocation: { x: nx + s.hellDir.x * 3, y: ny + 1, z: nz + s.hellDir.z * 3 }
      });
    } catch { }
    particle(ov.dimension, "minecraft:blue_flame_particle", { x: nx, y: ny + 0.6, z: nz });
    particle(ov.dimension, "minecraft:basic_smoke_particle", { x: nx, y: ny + 1.4, z: nz });
    if (t % 4 === 0) playSoundAt(ov.dimension, "mob.ravager.step", { x: nx, y: ny, z: nz }, 1.5);

    for (const p of victimsNearDim(ov.dimension, { x: nx, y: ny, z: nz }, HELLRUSH_REACH)) {
      const to = norm2d(sub(p.location, { x: nx, y: ny, z: nz }));
      if (s.hellDir.x * to.x + s.hellDir.z * to.z < 0.2 &&
        distance(p.location, { x: nx, y: ny, z: nz }) > 1) continue;
      // CAUGHT — the beatdown begins
      s.hellVictimId = p.id;
      s.state = "hellpummel";
      s.stateTicks = 0;
      setAnimState(ov, "pummel");
      freeze(ov, HELLPUMMEL_PUNCHES * HELLPUMMEL_INTERVAL + 40);
      playSoundAt(ov.dimension, "mob.warden.attack", { x: nx, y: ny, z: nz }, 3);
      tellVictim(p, "§4✊ CAUGHT — there is no mercy left.");
      return;
    }
    return;
  }

  ovBackToIdle(ov, s, 14); // charged 50 blocks into nothing
}

function ovTickHellpummel(ov, s) {
  const t = s.stateTicks;
  let victim = null;
  try { victim = world.getEntity(s.hellVictimId); } catch { }
  if (!victim || victim.dimension.id !== ov.dimension.id) {
    s.hellVictimId = null;
    ovBackToIdle(ov, s, 12);
    return;
  }
  const loc = ov.location;

  // pinned in his fist
  const hx = loc.x + s.hellDir.x * 1.3;
  const hz = loc.z + s.hellDir.z * 1.3;
  const hy = groundY(ov.dimension, hx, loc.y, hz);
  try { victim.teleport({ x: hx, y: hy, z: hz }); } catch { }

  // nine punches — exactly 75 damage, no multipliers, no mercy
  if (t > 0 && t % HELLPUMMEL_INTERVAL === 0 && t <= HELLPUMMEL_PUNCHES * HELLPUMMEL_INTERVAL) {
    const punchNo = t / HELLPUMMEL_INTERVAL;
    const dmg = punchNo === HELLPUMMEL_PUNCHES ? HELLPUMMEL_FINAL : HELLPUMMEL_DAMAGE;
    try {
      victim.applyDamage(dmg, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: ov
      });
    } catch { }
    shakeCamera(victim, 0.5, 0.25);
    playSoundAt(ov.dimension, "mob.irongolem.attack", loc, 1.8);
    particle(ov.dimension, "minecraft:critical_hit_emitter", { x: hx, y: hy + 1.2, z: hz });
    if (punchNo === HELLPUMMEL_PUNCHES) {
      particle(ov.dimension, "minecraft:knockback_roar_particle", { x: hx, y: hy + 0.5, z: hz });
    }
  }

  // ...then the world burns away
  if (t >= HELLPUMMEL_PUNCHES * HELLPUMMEL_INTERVAL + 12) {
    abductToNether(ov, s);
  }
}

function abductToNether(ov, s) {
  const dimension = ov.dimension;
  const loc = { ...ov.location };
  const abducted = alivePlayersNear(dimension, loc, ABDUCT_RADIUS);
  let victim = null;
  try { victim = world.getEntity(s.hellVictimId); } catch { }
  s.hellVictimId = null;

  playSoundAt(dimension, "mob.endermen.portal", loc, 4);
  playSoundAt(dimension, "mob.wither.spawn", loc, 3);
  for (let i = 0; i < 20; i++) {
    particle(dimension, "minecraft:blue_flame_particle", {
      x: loc.x + (Math.random() - 0.5) * 6, y: loc.y + Math.random() * 4, z: loc.z + (Math.random() - 0.5) * 6
    });
    particle(dimension, "minecraft:basic_smoke_particle", {
      x: loc.x + (Math.random() - 0.5) * 6, y: loc.y + Math.random() * 4, z: loc.z + (Math.random() - 0.5) * 6
    });
  }

  // already fighting in hell? skip the trip, keep the ascension
  if (dimension.id !== "minecraft:nether") {
    let nether = null;
    try { nether = world.getDimension("nether"); } catch { }
    if (nether) {
      const nx = Math.floor(loc.x / 8) + 0.5;
      const nz = Math.floor(loc.z / 8) + 0.5;
      const drop = { x: nx, y: 100, z: nz };
      const travelers = [...abducted];
      if (victim && !isPlayer(victim)) travelers.push(victim);
      const travelerIds = [];
      for (const p of travelers) {
        try {
          // shielded arrival: no suffocation while chunks load, no fall
          // deaths, no instant lava melt
          p.teleport(drop, { dimension: nether });
          travelerIds.push(p.id);
          p.addEffect("resistance", 120, { amplifier: 4, showParticles: false });
          p.addEffect("slow_falling", 300, { showParticles: false });
          if (isPlayer(p)) {
            p.addEffect("fire_resistance", 900, { showParticles: false });
            p.onScreenDisplay.setTitle("§4WELCOME TO HELL", {
              subtitle: "§6The Overlord drags you into his domain...",
              fadeInDuration: 5,
              stayDuration: 70,
              fadeOutDuration: 20
            });
          }
        } catch { }
      }
      try {
        ov.teleport(drop, { dimension: nether });
        ov.addEffect("slow_falling", 300, { showParticles: false });
        travelerIds.push(ov.id);
      } catch { }

      // once the player presence has loaded the chunks, find real ground
      system.runTimeout(() => {
        try {
          const fx = Math.floor(nx);
          const fz = Math.floor(nz);
          let sy = null;
          for (let y = 96; y >= 34; y--) {
            try {
              const b = nether.getBlock({ x: fx, y, z: fz });
              const a1 = nether.getBlock({ x: fx, y: y + 1, z: fz });
              const a2 = nether.getBlock({ x: fx, y: y + 2, z: fz });
              if (b && !b.isAir && !b.isLiquid && a1?.isAir && a2?.isAir) {
                sy = y + 1;
                break;
              }
            } catch { }
          }
          if (sy === null) {
            // no natural floor: carve a hellish arrival ledge
            sy = 80;
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                try { nether.getBlock({ x: fx + dx, y: 79, z: fz + dz })?.setType("minecraft:netherrack"); } catch { }
                for (let dy = 0; dy < 3; dy++) {
                  try { nether.getBlock({ x: fx + dx, y: 80 + dy, z: fz + dz })?.setType("minecraft:air"); } catch { }
                }
              }
            }
          }
          const landing = { x: nx, y: sy, z: nz };
          for (const id of travelerIds) {
            try {
              const e = world.getEntity(id);
              if (e && e.dimension.id === "minecraft:nether") e.teleport(landing);
            } catch { }
          }
          playSoundAt(nether, "mob.wither.spawn", landing, 4);
          particle(nether, "minecraft:huge_explosion_emitter", landing);
          for (let i = 0; i < 12; i++) {
            const a = (Math.PI * 2 * i) / 12;
            particle(nether, "minecraft:blue_flame_particle", {
              x: landing.x + Math.cos(a) * 2.5, y: landing.y + 0.5, z: landing.z + Math.sin(a) * 2.5
            });
          }
        } catch { }
      }, 15);
    }
  }

  // THE ASCENSION: 3x damage, restored to 750 HP
  s.hellBuff = true;
  try { ov.addEffect("health_boost", 20000000, { amplifier: HELL_BOOST_AMP, showParticles: false }); } catch { }
  system.runTimeout(() => {
    try {
      const health = ov.getComponent("minecraft:health");
      if (health) {
        health.setCurrentValue(Math.min(health.effectiveMax, HELL_ASCEND_HP));
      }
    } catch { }
  }, 2);
  playSoundAt(ov.dimension, "mob.enderdragon.growl", ov.location, 4);
  actionbarNearby(ov, 60, "§4👑 THE OVERLORD ASCENDS — 3x DAMAGE, 750 HP");
  ovBackToIdle(ov, s, 20);
}

// keep the hell-buffed strength topped up (vanilla melee scales too)
system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    try {
      for (const ov of world.getDimension(dimId).getEntities({ type: OVERLORD_ID })) {
        const s = overlords.get(ov.id);
        if (s?.hellBuff) {
          try { ov.addEffect("strength", 140, { amplifier: 3, showParticles: false }); } catch { }
        }
      }
    } catch { }
  }
}, 100);

// =====================================================================
//  DEBUG COMMANDS — run with cheats on:
//    /scriptevent ob:help
//    /scriptevent ob:spawn titan|overlord|mini|clone
//    /scriptevent ob:move <move name>       (forces the nearest boss)
//    /scriptevent ob:hp <number>            (sets nearest boss HP)
//    /scriptevent ob:rage                   (titan rage phase)
//    /scriptevent ob:buff                   (overlord hell ascension)
//    /scriptevent ob:kill                   (removes ALL addon entities)
// =====================================================================
const TITAN_DEBUG_MOVES = ["cleave", "leap", "skybreak", "dash", "throw", "summon", "smash", "grapple", "molten", "rush", "judgment"];
const OVERLORD_DEBUG_MOVES = ["cleave", "meteor", "gravity", "chain", "clones", "hellrush"];
const GOD_DEBUG_MOVES = ["fusion", "solar", "suffer", "pillars", "starfire", "blades", "chain"];

function debugReply(src, text) {
  if (!isPlayer(src)) return;
  try { src.sendMessage(text); } catch { }
}

function nearestOfType(dimension, location, typeId) {
  let best = null;
  let bestD = Infinity;
  try {
    for (const e of dimension.getEntities({ type: typeId, location, maxDistance: 96 })) {
      const d = distance(e.location, location);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
  } catch { }
  return best;
}

try {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (!ev.id.startsWith("ob:")) return;
    const cmd = ev.id.slice(3).toLowerCase();
    const msg = (ev.message ?? "").trim().toLowerCase();
    const src = ev.sourceEntity;
    if (!src) return;
    const dimension = src.dimension;
    const loc = src.location;
    const titan = nearestOfType(dimension, loc, TITAN_ID);
    const overlord = nearestOfType(dimension, loc, OVERLORD_ID);
    const god = nearestOfType(dimension, loc, MOLTEN_GOD_ID);

    switch (cmd) {
      case "help": {
        debugReply(src, "§6Oathbreaker debug: §f/scriptevent ob:<cmd>");
        debugReply(src, "§7 spawn titan|overlord|god|leviathan|mini|clone|crystal|pillar");
        debugReply(src, "§7 move " + TITAN_DEBUG_MOVES.join("|") + " §8(titan)");
        debugReply(src, "§7 move " + OVERLORD_DEBUG_MOVES.join("|") + " §8(overlord)");
        debugReply(src, "§7 move " + GOD_DEBUG_MOVES.join("|") + " §8(god)");
        debugReply(src, "§7 hp <number> · rage · buff · catalyst · ultimate · kill");
        return;
      }
      case "spawn": {
        const types = {
          titan: TITAN_ID, overlord: OVERLORD_ID, god: MOLTEN_GOD_ID,
          leviathan: LEVIATHAN_ID, mini: MINI_ID, clone: CLONE_ID,
          crystal: CRYSTAL_ID, pillar: PILLAR_ID
        };
        const typeId = types[msg];
        if (!typeId) {
          debugReply(src, "§cUsage: /scriptevent ob:spawn titan|overlord|god|leviathan|mini|clone|crystal|pillar");
          return;
        }
        try {
          const v = src.getViewDirection();
          const e = dimension.spawnEntity(typeId, {
            x: loc.x + v.x * 5, y: loc.y, z: loc.z + v.z * 5
          });
          if (typeId === TITAN_ID) getState(e);
          if (typeId === OVERLORD_ID) getOvState(e);
          if (typeId === MOLTEN_GOD_ID) getGodState(e);
          debugReply(src, `§aSpawned ${msg}.`);
        } catch (err) {
          debugReply(src, `§cSpawn failed: ${err}`);
        }
        return;
      }
      case "kill": {
        let n = 0;
        for (const typeId of [TITAN_ID, OVERLORD_ID, MOLTEN_GOD_ID, LEVIATHAN_ID,
          MINI_ID, CLONE_ID, SOLAR_ID, CRYSTAL_ID, PILLAR_ID, BLADE_ID, BOULDER_ID, "ob:debris"]) {
          try {
            for (const e of dimension.getEntities({ type: typeId })) {
              try { e.remove(); n++; } catch { }
            }
          } catch { }
        }
        titans.clear();
        overlords.clear();
        gods.clear();
        debugReply(src, `§aRemoved ${n} addon entities.`);
        return;
      }
      case "catalyst": {
        if (!overlord) { debugReply(src, "§cNo overlord nearby."); return; }
        const s = getOvState(overlord);
        if (!s.catalyzed) enterCatalyst(overlord, s);
        debugReply(src, "§aVolcanic Awakening triggered.");
        return;
      }
      case "ultimate": {
        if (!god) { debugReply(src, "§cNo Molten God nearby."); return; }
        const s = getGodState(god);
        godStartBlades(god, s);
        debugReply(src, "§aBlades of Chaos unchained.");
        return;
      }
      case "hp": {
        const boss = god ?? overlord ?? titan;
        const value = parseInt(msg, 10);
        if (!boss || isNaN(value)) {
          debugReply(src, "§cNo boss nearby, or bad number. Usage: /scriptevent ob:hp 60");
          return;
        }
        try {
          const health = boss.getComponent("minecraft:health");
          health.setCurrentValue(Math.max(1, Math.min(health.effectiveMax, value)));
          debugReply(src, `§aSet ${boss.typeId} HP to ${Math.max(1, Math.min(health.effectiveMax, value))}.`);
        } catch (err) {
          debugReply(src, `§cFailed: ${err}`);
        }
        return;
      }
      case "rage": {
        if (!titan) {
          debugReply(src, "§cNo titan nearby.");
          return;
        }
        const s = getState(titan);
        if (!s.raged) enterRage(titan, s);
        debugReply(src, "§aRage phase triggered.");
        return;
      }
      case "buff": {
        if (!overlord) {
          debugReply(src, "§cNo overlord nearby.");
          return;
        }
        const s = getOvState(overlord);
        if (!s.hellBuff) {
          s.hellBuff = true;
          s.hellUsed = true;
          try { overlord.addEffect("health_boost", 20000000, { amplifier: HELL_BOOST_AMP, showParticles: false }); } catch { }
          try {
            const health = overlord.getComponent("minecraft:health");
            health.setCurrentValue(Math.min(health.effectiveMax, HELL_ASCEND_HP));
          } catch { }
        }
        debugReply(src, "§aHell ascension applied (3x damage, 750 HP).");
        return;
      }
      case "move": {
        // the Molten God takes priority when present
        if (god && GOD_DEBUG_MOVES.includes(msg)) {
          const s = getGodState(god);
          godBackToIdle(god, s);
          const target = nearestTarget(god, s) ?? src;
          if (msg === "fusion") godStartFusion(god, s, target);
          else if (msg === "solar") godStartSolar(god, s);
          else if (msg === "suffer") godStartSuffer(god, s);
          else if (msg === "pillars") godStartPillars(god, s);
          else if (msg === "starfire") godStartStarfire(god, s);
          else if (msg === "blades") godStartBlades(god, s);
          else if (msg === "chain") godStartChain(god, s, target);
          debugReply(src, `§aGod: forced ${msg}.`);
          return;
        }
        // overlord moves take priority if one is closer
        const useOverlord = overlord && (!titan ||
          distance(overlord.location, loc) <= distance(titan.location, loc));
        if (useOverlord && OVERLORD_DEBUG_MOVES.includes(msg)) {
          const s = getOvState(overlord);
          ovBackToIdle(overlord, s);
          const target = nearestTarget(overlord, s) ?? src;
          if (msg === "cleave") ovStartCleave(overlord, s, target);
          else if (msg === "meteor") ovStartMeteor(overlord, s, target);
          else if (msg === "gravity") ovStartGravity(overlord, s);
          else if (msg === "chain") ovStartChain(overlord, s, target);
          else if (msg === "clones") ovStartClones(overlord, s);
          else if (msg === "hellrush") ovStartHellrush(overlord, s, target);
          debugReply(src, `§aOverlord: forced ${msg}.`);
          return;
        }
        if (titan && TITAN_DEBUG_MOVES.includes(msg)) {
          const s = getState(titan);
          backToIdle(titan, s);
          const target = nearestTarget(titan, s) ?? src;
          if (msg === "cleave") startCleave(titan, s, target);
          else if (msg === "leap") startLeap(titan, s, target);
          else if (msg === "skybreak") startLeap(titan, s, target, true);
          else if (msg === "dash") startDash(titan, s, target);
          else if (msg === "throw") startThrow(titan, s, target);
          else if (msg === "summon") startSummon(titan, s);
          else if (msg === "smash") startSmash(titan, s, target);
          else if (msg === "grapple") startGrapple(titan, s, target);
          else if (msg === "molten") startMolten(titan, s);
          else if (msg === "rush") startRush(titan, s, target);
          else if (msg === "judgment") startJudgment(titan, s);
          debugReply(src, `§aTitan: forced ${msg}.`);
          return;
        }
        debugReply(src, "§cNo boss nearby or unknown move. Try /scriptevent ob:help");
        return;
      }
      default:
        debugReply(src, "§cUnknown command. Try /scriptevent ob:help");
    }
  });
} catch { /* scriptevent unavailable — debug commands disabled */ }

// =====================================================================
//  PHASE 3 — THE VOLCANIC AWAKENING & THE MOLTEN GOD
// =====================================================================

// ---- generic white-energy damage from a phase-3 source ----
function godHurt(source, victim, amount) {
  try {
    victim.applyDamage(amount, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: source
    });
  } catch {
    try { victim.applyDamage(amount, { cause: EntityDamageCause.entityAttack }); } catch { }
  }
}

// =========================== THE CATALYST ============================
function enterCatalyst(ov, s) {
  s.catalyzed = true;
  s.absorbing = true;
  s.absorbTicks = 0;
  const dimension = ov.dimension;
  const loc = { ...ov.location };
  setAnimState(ov, "absorb");

  // the volcano erupts — the arena shatters (visuals only, no grief)
  playSoundAt(dimension, "mob.wither.spawn", loc, 4);
  playSoundAt(dimension, "ambient.weather.thunder", loc, 4);
  particle(dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 2, z: loc.z });
  for (const p of alivePlayersNear(dimension, loc, 80)) {
    try {
      p.onScreenDisplay.setTitle("§4THE VOLCANO AWAKENS", {
        subtitle: "§6Something ancient stirs in the magma...",
        fadeInDuration: 8, stayDuration: 70, fadeOutDuration: 20
      });
      shakeCamera(p, 1.0, 2.0);
    } catch { }
  }
  // a ring of erupting magma pillars tears the ground open
  for (let i = 0; i < 20; i++) {
    const a = (Math.PI * 2 * i) / 20;
    const r = 6 + Math.random() * 6;
    const x = loc.x + Math.cos(a) * r;
    const z = loc.z + Math.sin(a) * r;
    const y = groundY(dimension, x, loc.y, z);
    eruptions.push({ dimension, x, y, z, born: system.currentTick + i * 2 });
  }

  // heal to full and become an invulnerable channel of volcanic energy
  try {
    const h = ov.getComponent("minecraft:health");
    if (h) h.setCurrentValue(h.effectiveMax);
  } catch { }
  try { ov.addEffect("resistance", 20000000, { amplifier: 255, showParticles: false }); } catch { }

  // THE VANGUARD rises from the magma to buy him time
  system.runTimeout(() => {
    try {
      const a = Math.random() * Math.PI * 2;
      const lx = loc.x + Math.cos(a) * 6;
      const lz = loc.z + Math.sin(a) * 6;
      const ly = groundY(dimension, lx, loc.y, lz);
      const lev = dimension.spawnEntity(LEVIATHAN_ID, { x: lx, y: ly, z: lz });
      s.leviathanId = lev.id;
      leviathans.set(lev.id, { cdSpew: 60, cdBite: 30 });
      playSoundAt(dimension, "mob.enderdragon.growl", { x: lx, y: ly, z: lz }, 4);
      particle(dimension, "minecraft:huge_explosion_emitter", { x: lx, y: ly + 1, z: lz });
      for (const p of alivePlayersNear(dimension, loc, 80)) {
        p.onScreenDisplay.setTitle("§1THE BLUE LEVIATHAN", {
          subtitle: "§bSlay it — before he finishes absorbing the volcano!",
          fadeInDuration: 8, stayDuration: 70, fadeOutDuration: 20
        });
      }
    } catch { }
  }, 30);
}

function tickAbsorb(ov, s) {
  s.absorbTicks++;
  const dimension = ov.dimension;
  const loc = ov.location;
  // pin health — he cannot die while channeling
  if (s.absorbTicks % 5 === 0) {
    try {
      const h = ov.getComponent("minecraft:health");
      if (h) h.setCurrentValue(h.effectiveMax);
    } catch { }
  }
  // rivers of volcanic energy pour into him
  if (s.absorbTicks % 2 === 0) {
    const a = s.absorbTicks * 0.4;
    for (let k = 0; k < 2; k++) {
      const aa = a + k * Math.PI;
      particle(dimension, "minecraft:basic_flame_particle", {
        x: loc.x + Math.cos(aa) * 3, y: loc.y + 0.3 + (s.absorbTicks % 40) * 0.06, z: loc.z + Math.sin(aa) * 3
      });
      particle(dimension, "minecraft:lava_particle", {
        x: loc.x + Math.cos(aa) * 2, y: loc.y + 1, z: loc.z + Math.sin(aa) * 2
      });
    }
  }
  if (s.absorbTicks % 60 === 0) {
    playSoundAt(dimension, "mob.warden.heartbeat", loc, 3);
    // the volcano keeps erupting around the arena during the fight
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 10;
      const x = loc.x + Math.cos(a) * r;
      const z = loc.z + Math.sin(a) * r;
      eruptions.push({ dimension, x, y: groundY(dimension, x, loc.y, z), z, born: system.currentTick });
    }
  }

  // is the Vanguard slain? then THE TRUE FORM emerges
  let levAlive = false;
  if (s.leviathanId) {
    try {
      const lev = world.getEntity(s.leviathanId);
      levAlive = !!lev && lev.isValid;
    } catch { }
  } else if (s.absorbTicks < 40) {
    levAlive = true; // grace period before it spawns
  }
  if (!levAlive || s.absorbTicks > 3600) {
    transformToGod(ov, s);
  }
}

function transformToGod(ov, s) {
  const dimension = ov.dimension;
  const loc = { ...ov.location };
  try { ov.remove(); } catch { }
  overlords.delete(ov.id);

  playSoundAt(dimension, "mob.wither.spawn", loc, 5);
  playSoundAt(dimension, "random.levelup", loc, 4);
  particle(dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 2, z: loc.z });
  for (let i = 0; i < 30; i++) {
    const a = (Math.PI * 2 * i) / 30;
    particle(dimension, "minecraft:basic_flame_particle", {
      x: loc.x + Math.cos(a) * 3, y: loc.y + 0.5 + (i % 6), z: loc.z + Math.sin(a) * 3
    });
  }
  try {
    const gy = groundY(dimension, loc.x, loc.y + 1, loc.z);
    const god = dimension.spawnEntity(MOLTEN_GOD_ID, { x: loc.x, y: gy, z: loc.z });
    getGodState(god);
    for (const p of alivePlayersNear(dimension, loc, 90)) {
      p.onScreenDisplay.setTitle("§eTHE MOLTEN GOD", {
        subtitle: "§f\"You should not have made me shed my blade.\"",
        fadeInDuration: 10, stayDuration: 80, fadeOutDuration: 25
      });
      shakeCamera(p, 0.8, 1.5);
    }
  } catch { }
}

// ===================== THE BLUE LEVIATHAN ===========================
const leviathans = new Map();

function tickLeviathan(lev) {
  let ls = leviathans.get(lev.id);
  if (!ls) { ls = { cdSpew: 80, cdBite: 40 }; leviathans.set(lev.id, ls); }
  if (ls.cdSpew > 0) ls.cdSpew--;
  if (ls.busy) {
    ls.atk--;
    if (ls.atk <= 0) { ls.busy = false; setAnimState(lev, "idle"); }
    return;
  }
  const target = nearestTarget(lev, ls);
  if (!target) return;
  const dist = distance(target.location, lev.location);

  // molten spew: a cone of magma globs at range
  if (ls.cdSpew <= 0 && dist >= 5 && dist <= 22) {
    ls.cdSpew = 140;
    ls.busy = true;
    ls.atk = 20;
    setAnimState(lev, "spew");
    try { lev.teleport(lev.location, { facingLocation: target.location }); } catch { }
    playSoundAt(lev.dimension, "mob.ghast.fireball", lev.location, 3);
    const chest = { x: lev.location.x, y: lev.location.y + 2.4, z: lev.location.z };
    const dir = norm3d(sub({ x: target.location.x, y: target.location.y + 1, z: target.location.z }, chest));
    for (let i = 0; i < 5; i++) {
      system.runTimeout(() => {
        try {
          const spread = { x: dir.x + (Math.random() - 0.5) * 0.25, y: dir.y + (Math.random() - 0.5) * 0.15, z: dir.z + (Math.random() - 0.5) * 0.25 };
          const glob = lev.dimension.spawnEntity(BOULDER_ID, {
            x: chest.x + spread.x * 1.5, y: chest.y + spread.y * 1.5, z: chest.z + spread.z * 1.5
          });
          glob.applyImpulse({ x: spread.x * 1.6, y: spread.y * 1.6 + 0.2, z: spread.z * 1.6 });
          particle(lev.dimension, "minecraft:basic_flame_particle", chest);
        } catch { }
      }, i * 3);
    }
    return;
  }
  if (dist <= 3.5 && ls.cdSpew > 40) {
    setAnimState(lev, "bite");
    ls.busy = true;
    ls.atk = 12;
  }
}

// ===================== THE MOLTEN GOD ================================
const GOD_ULTIMATE_FRAC = 0.75;

const FUSION_COOLDOWN = 240;
const FUSION_DAMAGE = 12;
const FUSION_BURN_TICKS = 200;   // slow-burn death over ~10s
const FUSION_BURN_INTERVAL = 12;
const FUSION_BURN_DMG = 3;

const SOLAR_COOLDOWN = 420;
const SOLAR_CLONES = 4;
const SOLAR_SHOTS = 4;
const SOLAR_SHOT_INTERVAL = 14;
const SOLAR_BEAM_DAMAGE = 7;

const SUFFER_COOLDOWN = 380;
const SUFFER_HOMING_COUNT = 20;
const SUFFER_SENTINEL_MIN = 10;
const SUFFER_SENTINEL_MAX = 15;
const CRYSTAL_HOMING_SPEED = 0.42;
const CRYSTAL_EXPLODE_DMG = 8;
const CRYSTAL_BEAM_DAMAGE = 6;
const SENTINEL_CHARGE = 50;

const PILLARS_COOLDOWN = 700;
const PILLAR_COUNT = 4;
const PILLAR_CRYSTAL_INTERVAL = 55;
const PILLAR_HEAL = 12;
const PILLAR_HEAL_INTERVAL = 40;

const STARFIRE_COOLDOWN = 620;
const STARFIRE_TICKS = 120;
const STARFIRE_RADIUS = 20;
const STARFIRE_SAFE = 3.5;

const BLADES_COOLDOWN = 220;      // ticks between blade commands
const CHAIN_REACH = 22;
const CHAIN_DAMAGE = 14;
const CHAIN_AOE = 4;

// ---- Blades of Chaos tuning ----
const BLADE_REST_DIST = 3.4;      // how far behind the god the blades hover
const BLADE_REST_HEIGHT = 2.9;    // hover height above his feet
const BLADE_REST_SPREAD = 1.1;    // sideways gap between the two blades
const BLADE_FLY_SPEED = 1.7;      // blocks/tick while streaking out to a target
const BLADE_ARRIVE_DIST = 2.2;    // switch to the whirlwind once this close
const BLADE_SPIN_TICKS = 46;      // how long the whirlwind lasts on the target
const BLADE_SPIN_RADIUS = 2.4;    // radius of the orbiting slash
const BLADE_SPIN_SPEED = 0.6;     // radians/tick the blade whirls
const BLADE_SPIN_DAMAGE = 7;      // damage per bite while spinning
const BLADE_SPIN_HIT_EVERY = 5;   // ticks between bites
const BLADE_RETURN_SPEED = 2.0;   // blocks/tick flying home
const BLADE_MAX_RANGE = 42;       // give up / return past this range

const gods = new Map();

function getGodState(god) {
  let s = gods.get(god.id);
  if (!s) {
    s = {
      state: "idle", stateTicks: 0,
      cdPunch: 20, cdFusion: 120, cdSolar: 200, cdSuffer: 160,
      cdPillars: 320, cdStarfire: 260, cdBlades: 200, cdChain: 0,
      bladeMode: false, blades: [], bladeTargetId: null,
      fusionVictimId: null,
      subTicks: 0, subData: null,
      lastPos: null, wasMoving: null,
      mobFoeId: null, mobFoeTick: -9999, lastHostileScan: -99
    };
    gods.set(god.id, s);
  }
  return s;
}

function godBackToIdle(god, s, recovery = 0) {
  s.state = "idle";
  s.stateTicks = -recovery;
  setAnimState(god, "idle");
}

// ---- Ability 1: Internal Fusion Grab ----
function godStartFusion(god, s, target) {
  s.state = "fusion";
  s.stateTicks = 0;
  s.cdFusion = FUSION_COOLDOWN;
  setAnimState(god, "fusion");
  freeze(god, 18);
  // teleport BEHIND the target
  try {
    const vd = target.getViewDirection();
    const behind = { x: target.location.x - vd.x * 1.4, y: target.location.y, z: target.location.z - vd.z * 1.4 };
    const gy = groundY(god.dimension, behind.x, behind.y + 1, behind.z);
    god.teleport({ x: behind.x, y: gy, z: behind.z }, { facingLocation: target.location });
  } catch { }
  playSoundAt(god.dimension, "mob.endermen.portal", god.location, 2);
  s.fusionVictimId = target.id;
  tellVictim(target, "§f✊ He's behind you...");
}

function godTickFusion(god, s) {
  if (s.stateTicks === 10) {
    let victim = null;
    try { victim = world.getEntity(s.fusionVictimId); } catch { }
    if (victim && victim.dimension.id === god.dimension.id &&
      distance(victim.location, god.location) <= 4) {
      godHurt(god, victim, FUSION_DAMAGE);
      particle(god.dimension, "minecraft:huge_explosion_emitter", {
        x: victim.location.x, y: victim.location.y + 1, z: victim.location.z
      });
      playSoundAt(god.dimension, "mob.warden.sonic_boom", god.location, 2);
      // inject white molten energy: slow-burn death + massive Weakness
      try { victim.addEffect("weakness", FUSION_BURN_TICKS, { amplifier: 4 }); } catch { }
      try { victim.addEffect("wither", 60, { amplifier: 1, showParticles: true }); } catch { }
      dots.push({
        dimension: god.dimension, victimId: victim.id, godId: god.id,
        ticksLeft: FUSION_BURN_TICKS, next: FUSION_BURN_INTERVAL
      });
      tellVictim(victim, "§f☀ MOLTEN ENERGY INJECTED — you are burning from within!");
    }
  }
  if (s.stateTicks >= 22) godBackToIdle(god, s, 8);
}

// slow-burn damage-over-time from the Fusion Grab
const dots = [];
function tickDots() {
  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    d.ticksLeft--;
    d.next--;
    if (d.next <= 0) {
      d.next = FUSION_BURN_INTERVAL;
      try {
        const v = world.getEntity(d.victimId);
        if (v && v.isValid) {
          v.applyDamage(FUSION_BURN_DMG, { cause: EntityDamageCause.wither });
          particle(v.dimension, "minecraft:basic_flame_particle", { x: v.location.x, y: v.location.y + 1, z: v.location.z });
        }
      } catch { }
    }
    if (d.ticksLeft <= 0) dots.splice(i, 1);
  }
}

// ---- Ability 2: Solar Beam Clones ----
function godStartSolar(god, s) {
  s.state = "beams";
  s.stateTicks = 0;
  s.cdSolar = SOLAR_COOLDOWN;
  setAnimState(god, "beams");
  freeze(god, 20);
  playSoundAt(god.dimension, "mob.evocation_illager.cast_spell", god.location, 3);
  actionbarNearby(god, 50, "§e☀ SOLAR CLONES — dodge the beams!");
  for (let i = 0; i < SOLAR_CLONES; i++) {
    const a = (Math.PI * 2 * i) / SOLAR_CLONES;
    const px = god.location.x + Math.cos(a) * 4;
    const pz = god.location.z + Math.sin(a) * 4;
    // snap to the ground so clones never spawn buried in a wall
    const py = groundY(god.dimension, px, god.location.y + 1, pz);
    const pos = { x: px, y: py, z: pz };
    try {
      const clone = god.dimension.spawnEntity(SOLAR_ID, pos);
      solars.set(clone.id, { godId: god.id, shotsLeft: SOLAR_SHOTS, cd: 12 + i * 4 });
      particle(god.dimension, "minecraft:huge_explosion_emitter", { x: px, y: py + 1, z: pz });
    } catch { }
  }
}

const solars = new Map();
function tickSolar(clone) {
  const cs = solars.get(clone.id);
  if (!cs) { try { clone.remove(); } catch { } return; }
  cs.cd--;
  const target = combatTargetFor(cs.godId, clone);
  if (target) { try { clone.teleport(clone.location, { facingLocation: target.location }); } catch { } }
  if (cs.cd <= 0 && cs.shotsLeft > 0 && target) {
    cs.cd = SOLAR_SHOT_INTERVAL;
    cs.shotsLeft--;
    fireBeam(clone, { x: clone.location.x, y: clone.location.y + 2.2, z: clone.location.z }, target, SOLAR_BEAM_DAMAGE);
    if (cs.shotsLeft <= 0) {
      // vanishes instead of exploding
      system.runTimeout(() => {
        try { particle(clone.dimension, "minecraft:basic_smoke_particle", clone.location); clone.remove(); } catch { }
        solars.delete(clone.id);
      }, 16);
    }
  }
}

function nearestSolarTarget(from) {
  let best = null, bestD = Infinity;
  for (const v of victimsNearDim(from.dimension, from.location, 30)) {
    const d = distance(v.location, from.location);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

// what a summon should shoot at: the GOD's own combat foe (the mob he's
// fighting), so in a mob-vs-mob battle beams/crystals hit that mob and
// never the watching player. Falls back to nearest victim.
function combatTargetFor(godId, fromEntity) {
  try {
    const god = godId ? world.getEntity(godId) : null;
    if (god && god.isValid) {
      const gs = gods.get(god.id) ?? getGodState(god);
      const foe = nearestTarget(god, gs);
      if (foe) return foe;
    }
  } catch { }
  return nearestSolarTarget(fromEntity);
}

// active beams persist for several ticks so they're clearly visible
const activeBeams = [];

const BEAM_PERSIST_TICKS = 20; // the sonic beam holds for ~1s

// the Warden sonic-boom beam: a line of sonic_explosion pulses
function drawBeam(dimension, origin, dir, len) {
  for (let d = 0; d < len; d += 1.3) {
    particle(dimension, "minecraft:sonic_explosion", {
      x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d
    });
  }
}

// a concentrated white molten beam from `origin` toward `target`
function fireBeam(source, origin, target, damage) {
  const aim = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
  const dir = norm3d(sub(aim, origin));
  const len = Math.min(30, Math.max(2, distance(aim, origin)));
  playSoundAt(source.dimension, "mob.warden.sonic_boom", origin, 2.5);
  drawBeam(source.dimension, origin, dir, len);
  // persist the beam so it's clearly visible (~1s)
  activeBeams.push({ dimension: source.dimension, origin, dir, len, ticks: BEAM_PERSIST_TICKS });
  // damage anyone the beam passes near
  for (const v of victimsNearDim(source.dimension, origin, len + 2)) {
    const to = sub({ x: v.location.x, y: v.location.y + 1, z: v.location.z }, origin);
    const proj = to.x * dir.x + to.y * dir.y + to.z * dir.z;
    if (proj < 0 || proj > len + 1) continue;
    const closest = { x: origin.x + dir.x * proj, y: origin.y + dir.y * proj, z: origin.z + dir.z * proj };
    if (distance({ x: v.location.x, y: v.location.y + 1, z: v.location.z }, closest) <= 1.8) {
      godHurt(source, v, damage);
      try { v.setOnFire(2, true); } catch { }
    }
  }
}

function tickBeams() {
  for (let i = activeBeams.length - 1; i >= 0; i--) {
    const b = activeBeams[i];
    b.ticks--;
    // re-pulse the sonic beam periodically; sonic_explosion lingers ~1s
    // on its own, so a sparse re-pulse keeps it visible without smearing
    if (b.ticks % 8 === 0) drawBeam(b.dimension, b.origin, b.dir, b.len);
    if (b.ticks <= 0) activeBeams.splice(i, 1);
  }
}

// ---- Ability 3: Suffer (two variants) ----
function godStartSuffer(god, s) {
  s.state = "suffer";
  s.stateTicks = 0;
  s.cdSuffer = SUFFER_COOLDOWN;
  setAnimState(god, "suffer");
  freeze(god, 22);
  playSoundAt(god.dimension, "mob.evocation_illager.prepare_summon", god.location, 3);
  const sentinelMode = Math.random() < 0.5;
  if (sentinelMode) {
    actionbarNearby(god, 50, "§f❖ CRYSTAL SENTINELS — destroy them before they fire!");
    const count = SUFFER_SENTINEL_MIN + Math.floor(Math.random() * (SUFFER_SENTINEL_MAX - SUFFER_SENTINEL_MIN + 1));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 12;
      const x = god.location.x + Math.cos(a) * r;
      const z = god.location.z + Math.sin(a) * r;
      const y = groundY(god.dimension, x, god.location.y, z) + 1.5;
      spawnCrystal(god, { x, y, z }, "sentinel", null, null);
    }
  } else {
    actionbarNearby(god, 50, "§f❖ SUFFER — homing crystals inbound!");
    for (let i = 0; i < SUFFER_HOMING_COUNT; i++) {
      const a = (Math.PI * 2 * i) / SUFFER_HOMING_COUNT;
      const pos = { x: god.location.x + Math.cos(a) * 2, y: god.location.y + 1.5 + Math.random() * 2, z: god.location.z + Math.sin(a) * 2 };
      spawnCrystal(god, pos, "homing", null, null);
    }
  }
  if (s.stateTicks >= 0) { /* no-op */ }
}

// ---- Ability 4: White Pillars ----
function godStartPillars(god, s) {
  s.state = "pillars";
  s.stateTicks = 0;
  s.cdPillars = PILLARS_COOLDOWN;
  setAnimState(god, "pillars");
  freeze(god, 22);
  playSoundAt(god.dimension, "mob.wither.spawn", god.location, 3);
  actionbarNearby(god, 50, "§f▲ WHITE PILLARS RISE — tear them down!");
  for (let i = 0; i < PILLAR_COUNT; i++) {
    const a = (Math.PI * 2 * i) / PILLAR_COUNT + 0.6;
    const r = 9;
    const x = god.location.x + Math.cos(a) * r;
    const z = god.location.z + Math.sin(a) * r;
    const y = groundY(god.dimension, x, god.location.y, z);
    try {
      const pillar = god.dimension.spawnEntity(PILLAR_ID, { x, y, z });
      pillars.set(pillar.id, { godId: god.id, cdCrystal: 40 + i * 8, cdHeal: PILLAR_HEAL_INTERVAL });
      particle(god.dimension, "minecraft:huge_explosion_emitter", { x, y: y + 1, z });
    } catch { }
  }
}

const pillars = new Map();
function tickPillar(pillar) {
  const ps = pillars.get(pillar.id);
  if (!ps) { return; }
  const loc = pillar.location;
  if (pillar.dimension && Math.random() < 0.4) {
    particle(pillar.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 3.5 + Math.random() * 1.5, z: loc.z });
  }
  ps.cdCrystal--;
  ps.cdHeal--;
  // empower the field with fresh homing crystals
  if (ps.cdCrystal <= 0) {
    ps.cdCrystal = PILLAR_CRYSTAL_INTERVAL;
    let god = null;
    try { god = world.getEntity(ps.godId); } catch { }
    if (god) spawnCrystal(god, { x: loc.x, y: loc.y + 3.5, z: loc.z }, "homing", null, pillar.id);
  }
  // and slowly heal the Molten God
  if (ps.cdHeal <= 0) {
    ps.cdHeal = PILLAR_HEAL_INTERVAL;
    try {
      const god = world.getEntity(ps.godId);
      if (god && god.isValid) {
        const h = god.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + PILLAR_HEAL));
        // a beam of energy from pillar to god
        const gl = god.location;
        const dir = norm3d(sub({ x: gl.x, y: gl.y + 1.5, z: gl.z }, { x: loc.x, y: loc.y + 4, z: loc.z }));
        for (let d = 0; d < distance(gl, loc); d += 1.2) {
          particle(pillar.dimension, "minecraft:endrod", {
            x: loc.x + dir.x * d, y: loc.y + 4 + dir.y * d, z: loc.z + dir.z * d
          });
        }
      }
    } catch { }
  }
}

// ---- crystal system (shared by Suffer + Pillars) ----
const crystals = new Map();
function spawnCrystal(god, pos, mode, targetId, pillarId) {
  try {
    const c = god.dimension.spawnEntity(CRYSTAL_ID, pos);
    let tid = targetId;
    if (!tid) {
      const t = combatTargetFor(god.id, c);
      tid = t ? t.id : null;
    }
    crystals.set(c.id, {
      mode, godId: god.id, targetId: tid, pillarId,
      born: system.currentTick, charge: SENTINEL_CHARGE
    });
    particle(god.dimension, "minecraft:basic_flame_particle", pos);
  } catch { }
}

function tickCrystal(crystal) {
  const cs = crystals.get(crystal.id);
  if (!cs) { return; }
  const loc = crystal.location;
  particle(crystal.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 0.3, z: loc.z });

  // refresh target — prefer the God's own combat foe (the mob he's
  // fighting) so crystals home the golem, not the watching player
  let target = null;
  try { if (cs.targetId) target = world.getEntity(cs.targetId); } catch { }
  if (!target || !target.isValid || (isPlayer(target) === false && !canFight(target))) {
    target = combatTargetFor(cs.godId, crystal);
    cs.targetId = target ? target.id : null;
  }

  if (cs.mode === "homing") {
    if (!target) return;
    const dir = norm3d(sub({ x: target.location.x, y: target.location.y + 1, z: target.location.z }, loc));
    try {
      crystal.teleport({ x: loc.x + dir.x * CRYSTAL_HOMING_SPEED, y: loc.y + dir.y * CRYSTAL_HOMING_SPEED, z: loc.z + dir.z * CRYSTAL_HOMING_SPEED },
        { facingLocation: target.location });
    } catch { }
    if (distance(loc, { x: target.location.x, y: target.location.y + 1, z: target.location.z }) <= 1.5) {
      // explode on impact
      let god = null; try { god = world.getEntity(cs.godId); } catch { }
      playSoundAt(crystal.dimension, "random.explode", loc, 1.5);
      particle(crystal.dimension, "minecraft:large_explosion", loc);
      for (const v of victimsNearDim(crystal.dimension, loc, 2.5)) {
        godHurt(god ?? crystal, v, CRYSTAL_EXPLODE_DMG);
        try { v.setOnFire(2, true); } catch { }
      }
      crystals.delete(crystal.id);
      try { crystal.remove(); } catch { }
    }
  } else {
    // sentinel: stationary, charge then fire a beam
    cs.charge--;
    if (cs.charge <= SENTINEL_CHARGE * 0.4 && cs.charge % 2 === 0) {
      particle(crystal.dimension, "minecraft:endrod", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    }
    if (cs.charge <= 0) {
      cs.charge = SENTINEL_CHARGE + 20;
      if (target) {
        let god = null; try { god = world.getEntity(cs.godId); } catch { }
        fireBeam(god ?? crystal, { x: loc.x, y: loc.y + 0.5, z: loc.z }, target, CRYSTAL_BEAM_DAMAGE);
      }
    }
  }
}

// ---- The Special: Starfire Rain ----
function godStartStarfire(god, s) {
  s.state = "starfire";
  s.stateTicks = 0;
  s.cdStarfire = STARFIRE_COOLDOWN;
  setAnimState(god, "starfire");
  freeze(god, STARFIRE_TICKS + 10);
  playSoundAt(god.dimension, "ambient.weather.thunder", god.location, 4);
  titleNearby(god, 60, "§eSTARFIRE RAIN", "§6The heavens burn — find no shelter!");
}

function godTickStarfire(god, s) {
  const t = s.stateTicks;
  const loc = god.location;
  freeze(god, 5);
  if (t < STARFIRE_TICKS) {
    // fire falls everywhere across the battlefield
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * STARFIRE_RADIUS;
      const x = loc.x + Math.cos(a) * r;
      const z = loc.z + Math.sin(a) * r;
      particle(god.dimension, "minecraft:basic_flame_particle", { x, y: loc.y + 6 + Math.random() * 6, z });
      particle(god.dimension, "minecraft:basic_flame_particle", { x, y: loc.y + 2 + Math.random() * 4, z });
    }
    if (t % 6 === 0) playSoundAt(god.dimension, "mob.ghast.fireball", loc, 1.5);
    // ignite everyone caught in the open (but never the God himself)
    if (t % 8 === 0) {
      for (const v of victimsNearDim(god.dimension, loc, STARFIRE_RADIUS)) {
        if (distance(v.location, loc) < STARFIRE_SAFE) continue;
        try { v.setOnFire(4, true); v.applyDamage(2, { cause: EntityDamageCause.fire }); } catch { }
      }
    }
    return;
  }
  godBackToIdle(god, s, 12);
}

// ---- The Ultimate: the Blades of Chaos ----
// Two chained blades that hover BEHIND the god (never orbiting, never held).
// On command he hurls them out; they streak to the target, whirl around it in
// a chain-slinging vortex doing heavy damage, then retract to their rest slots.
function bladesReady(s) {
  return s.bladeMode && s.blades.some((bl) => bl.phase === "rest");
}

// where a resting blade should hover: behind him, split to either side
function restBladePos(god, i) {
  let fwd;
  try { fwd = god.getViewDirection(); } catch { fwd = { x: 0, y: 0, z: 1 }; }
  const f = norm2d(fwd);                  // horizontal forward
  const side = { x: -f.z, y: 0, z: f.x }; // perpendicular
  const off = (i === 0 ? 1 : -1) * BLADE_REST_SPREAD;
  const bob = Math.sin((system.currentTick + i * 24) * 0.08) * 0.28;
  return {
    x: god.location.x - f.x * BLADE_REST_DIST + side.x * off,
    y: god.location.y + BLADE_REST_HEIGHT + bob,
    z: god.location.z - f.z * BLADE_REST_DIST + side.z * off
  };
}

// a point ahead of the god so a resting blade keeps its tip pointed forward
function bladeForwardAim(god, from) {
  let fwd;
  try { fwd = god.getViewDirection(); } catch { fwd = { x: 0, y: 0, z: 1 }; }
  const f = norm2d(fwd);
  return { x: from.x + f.x * 6, y: from.y, z: from.z + f.z * 6 };
}

// glide a blade toward a point, leading with its edge; returns its new position
function moveBladeToward(b, aim, speed, faceLoc) {
  const cur = b.location;
  const d = sub(aim, cur);
  const dist = len3d(d);
  let next;
  if (dist <= speed) {
    next = { x: aim.x, y: aim.y, z: aim.z };
  } else {
    const dir = norm3d(d);
    next = { x: cur.x + dir.x * speed, y: cur.y + dir.y * speed, z: cur.z + dir.z * speed };
  }
  try { b.teleport(next, { facingLocation: faceLoc || aim }); } catch { }
  return next;
}

// the taut chain of light linking the god to a blade
function drawBladeChain(god, bladePos, spacing) {
  const origin = { x: god.location.x, y: god.location.y + 2.0, z: god.location.z };
  const d = sub(bladePos, origin);
  const dist = len3d(d);
  if (dist < 0.4) return;
  const dir = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  for (let t = 0.4; t < dist; t += spacing) {
    particle(god.dimension, "minecraft:endrod", {
      x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t
    });
  }
}

// first manifestation: conjure the two resting blades behind him
function godManifestBlades(god, s) {
  s.bladeMode = true;
  s.blades = [];
  for (let i = 0; i < 2; i++) {
    const rp = restBladePos(god, i);
    try {
      const b = god.dimension.spawnEntity(BLADE_ID, rp);
      s.blades.push({ id: b.id, phase: "rest", t: 0, angle: 0, lastAim: null });
    } catch { }
  }
}

// the command cast: thrust his arms out and hurl the blades at the target
function godStartBlades(god, s) {
  s.state = "blades";
  s.stateTicks = 0;
  s.cdBlades = BLADES_COOLDOWN;
  setAnimState(god, "blades");
  freeze(god, 18);
  const firstTime = !s.bladeMode;
  if (firstTime) godManifestBlades(god, s);
  const target = nearestTarget(god, s);
  if (target) faceTarget(god, target);
  playSoundAt(god.dimension, firstTime ? "mob.enderdragon.growl" : "mob.enderdragon.flap", god.location, 4);
  if (firstTime) titleNearby(god, 60, "§fBLADES OF CHAOS", "§eHeaven's edge is unchained.");
  // command every resting blade to fly at the target
  if (target) {
    s.bladeTargetId = target.id;
    const aim = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
    for (const bl of s.blades) {
      if (bl.phase === "rest") { bl.phase = "launch"; bl.t = 0; bl.lastAim = aim; }
    }
  }
}

function godTickBlades(god, s) {
  // hold the throwing pose briefly; the blades fly on their own in tickGodBlades
  if (s.stateTicks >= 16) godBackToIdle(god, s, 8);
}

// long-range, high-speed chain strike (basic attack once bladeMode is on)
function godStartChain(god, s, target) {
  s.state = "chain";
  s.stateTicks = 0;
  s.cdChain = 14;
  setAnimState(god, "chain");
  faceTarget(god, target);
}

function godTickChain(god, s) {
  if (s.stateTicks === 5) {
    const target = nearestTarget(god, s);
    if (target && distance(target.location, god.location) <= CHAIN_REACH) {
      godChainStrike(god, s, target, false);
    }
  }
  if (s.stateTicks >= 10) godBackToIdle(god, s);
}

function godChainStrike(god, s, target, heavy) {
  const origin = { x: god.location.x, y: god.location.y + 2, z: god.location.z };
  const aim = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
  const dir = norm3d(sub(aim, origin));
  const len = Math.min(CHAIN_REACH, distance(aim, origin) + 2);
  playSoundAt(god.dimension, "mob.enderdragon.flap", god.location, 2);
  // a streak of divine light lashes out
  for (let d = 0; d < len; d += 0.5) {
    particle(god.dimension, "minecraft:basic_flame_particle", {
      x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d
    });
    particle(god.dimension, "minecraft:endrod", {
      x: origin.x + dir.x * d, y: origin.y + dir.y * d, z: origin.z + dir.z * d
    });
  }
  const dmg = heavy ? CHAIN_DAMAGE + 8 : CHAIN_DAMAGE;
  // heavy AOE around the strike's end point plus the line it travels
  const end = { x: origin.x + dir.x * len, y: origin.y + dir.y * len, z: origin.z + dir.z * len };
  for (const v of victimsNearDim(god.dimension, end, CHAIN_AOE)) {
    godHurt(god, v, dmg);
    knockPlayer(v, norm2d(sub(v.location, god.location)), 1.4, 0.4);
  }
  for (const v of victimsNearDim(god.dimension, origin, len)) {
    const to = sub({ x: v.location.x, y: v.location.y + 1, z: v.location.z }, origin);
    const proj = to.x * dir.x + to.y * dir.y + to.z * dir.z;
    if (proj < 0 || proj > len) continue;
    const closest = { x: origin.x + dir.x * proj, y: origin.y + dir.y * proj, z: origin.z + dir.z * proj };
    if (distance({ x: v.location.x, y: v.location.y + 1, z: v.location.z }, closest) <= 2) {
      godHurt(god, v, dmg);
    }
  }
  if (heavy) {
    particle(god.dimension, "minecraft:huge_explosion_emitter", end);
    playSoundAt(god.dimension, "random.explode", end, 3);
  }
}

// drive every blade each tick: rest behind him, or carry out a command
function tickGodBlades(god, s) {
  if (!s.bladeMode || s.blades.length === 0) return;
  const gLoc = god.location;

  // the blades home on the live target where possible
  let target = null;
  if (s.bladeTargetId) { try { target = world.getEntity(s.bladeTargetId); } catch { } }

  for (let i = 0; i < s.blades.length; i++) {
    const bl = s.blades[i];
    let b = null;
    try { b = world.getEntity(bl.id); } catch { }
    if (!b) {
      // a blade got unloaded/removed — reconjure it at its rest slot
      const rp = restBladePos(god, i);
      try { b = god.dimension.spawnEntity(BLADE_ID, rp); bl.id = b.id; bl.phase = "rest"; bl.t = 0; }
      catch { continue; }
    }
    bl.t++;

    if (bl.phase === "rest") {
      const rp = restBladePos(god, i);
      try { b.teleport(rp, { facingLocation: bladeForwardAim(god, rp) }); } catch { }
      drawBladeChain(god, rp, 1.4);
      continue;
    }

    if (bl.phase === "launch") {
      const aim = target
        ? { x: target.location.x, y: target.location.y + 1, z: target.location.z }
        : bl.lastAim;
      if (!aim) { bl.phase = "return"; bl.t = 0; continue; }
      bl.lastAim = aim;
      const pos = moveBladeToward(b, aim, BLADE_FLY_SPEED);
      drawBladeChain(god, pos, 0.8);
      particle(god.dimension, "minecraft:basic_flame_particle", pos);
      if (distance(pos, aim) <= BLADE_ARRIVE_DIST || distance(pos, gLoc) >= BLADE_MAX_RANGE) {
        bl.phase = "spin"; bl.t = 0; bl.angle = i * Math.PI;
        playSoundAt(god.dimension, "mob.enderdragon.flap", pos, 2);
        particle(god.dimension, "minecraft:huge_explosion_emitter", pos);
      }
      continue;
    }

    if (bl.phase === "spin") {
      const center = target
        ? { x: target.location.x, y: target.location.y + 1, z: target.location.z }
        : (bl.lastAim || gLoc);
      if (target) bl.lastAim = center;
      bl.angle += BLADE_SPIN_SPEED;
      const pos = {
        x: center.x + Math.cos(bl.angle) * BLADE_SPIN_RADIUS,
        y: center.y + Math.sin(bl.t * 0.4) * 0.4,
        z: center.z + Math.sin(bl.angle) * BLADE_SPIN_RADIUS
      };
      // lead with the edge: face a point further along the orbit
      const lead = {
        x: center.x + Math.cos(bl.angle + 1.3) * BLADE_SPIN_RADIUS,
        y: pos.y,
        z: center.z + Math.sin(bl.angle + 1.3) * BLADE_SPIN_RADIUS
      };
      try { b.teleport(pos, { facingLocation: lead }); } catch { }
      drawBladeChain(god, pos, 0.8);
      particle(god.dimension, "minecraft:basic_flame_particle", pos);
      particle(god.dimension, "minecraft:endrod", pos);
      if (bl.t % BLADE_SPIN_HIT_EVERY === 0) {
        for (const v of victimsNearDim(god.dimension, pos, 2.2)) {
          godHurt(god, v, BLADE_SPIN_DAMAGE);
          knockPlayer(v, norm2d(sub(v.location, center)), 0.5, 0.25);
        }
      }
      if (bl.t >= BLADE_SPIN_TICKS + i * 6) { bl.phase = "return"; bl.t = 0; }
      continue;
    }

    if (bl.phase === "return") {
      const rp = restBladePos(god, i);
      const pos = moveBladeToward(b, rp, BLADE_RETURN_SPEED, bladeForwardAim(god, rp));
      drawBladeChain(god, pos, 1.0);
      if (distance(pos, rp) <= 0.8) { bl.phase = "rest"; bl.t = 0; }
      continue;
    }
  }

  // command finished once every blade is back home
  if (!s.blades.some((bl) => bl.phase !== "rest")) s.bladeTargetId = null;
}

// ---- the Molten God brain ----
function tickGod(god) {
  const s = getGodState(god);
  s.stateTicks++;
  if (s.cdPunch > 0) s.cdPunch--;
  if (s.cdFusion > 0) s.cdFusion--;
  if (s.cdSolar > 0) s.cdSolar--;
  if (s.cdSuffer > 0) s.cdSuffer--;
  if (s.cdPillars > 0) s.cdPillars--;
  if (s.cdStarfire > 0) s.cdStarfire--;
  if (s.cdBlades > 0) s.cdBlades--;
  if (s.cdChain > 0) s.cdChain--;

  // WALK DETECTION (script-driven, never relies on molang move speed):
  // measure real horizontal displacement and sync a bool the animation
  // controller reads to switch idle <-> walk
  try {
    const here = god.location;
    if (s.lastPos) {
      const dx = here.x - s.lastPos.x, dz = here.z - s.lastPos.z;
      const moving = (dx * dx + dz * dz) > 0.0009; // ~0.03 blocks/tick
      if (moving !== s.wasMoving) {
        god.setProperty("ob:moving", moving);
        s.wasMoving = moving;
      }
    } else {
      god.setProperty("ob:moving", false);
      s.wasMoving = false;
    }
    s.lastPos = { x: here.x, y: here.y, z: here.z };
  } catch { }

  // radiant white aura constantly pouring off him
  if (s.stateTicks % 3 === 0) {
    const loc = god.location;
    const a = Math.random() * Math.PI * 2;
    particle(god.dimension, "minecraft:basic_flame_particle", {
      x: loc.x + Math.cos(a) * 1.2, y: loc.y + 0.5 + Math.random() * 2.5, z: loc.z + Math.sin(a) * 1.2
    });
  }
  if (s.bladeMode) tickGodBlades(god, s);

  switch (s.state) {
    case "fusion": return godTickFusion(god, s);
    case "beams": if (s.stateTicks >= 22) godBackToIdle(god, s, 10); return;
    case "suffer": if (s.stateTicks >= 24) godBackToIdle(god, s, 10); return;
    case "pillars": if (s.stateTicks >= 24) godBackToIdle(god, s, 10); return;
    case "starfire": return godTickStarfire(god, s);
    case "blades": return godTickBlades(god, s);
    case "chain": return godTickChain(god, s);
    case "punch": if (s.stateTicks >= 8) godBackToIdle(god, s); return;
  }

  if (s.stateTicks < 0) return;

  const target = nearestTarget(god, s);
  if (!target) return;
  const dist = distance(target.location, god.location);
  const h = god.getComponent("minecraft:health");
  const frac = h ? h.currentValue / h.effectiveMax : 1;

  // ULTIMATE: at 75% HP, unchain the Blades of Chaos (once)
  if (!s.bladeMode && frac <= GOD_ULTIMATE_FRAC) {
    godStartBlades(god, s);
    return;
  }

  // ability rotation
  if (s.cdStarfire <= 0 && dist <= 26) { godStartStarfire(god, s); return; }
  if (s.cdPillars <= 0 && dist <= 30) { godStartPillars(god, s); return; }
  if (s.cdSuffer <= 0 && dist <= 30) { godStartSuffer(god, s); return; }
  if (s.cdSolar <= 0 && dist >= 4 && dist <= 30) { godStartSolar(god, s); return; }
  if (s.cdFusion <= 0 && dist >= 3 && dist <= 26) { godStartFusion(god, s, target); return; }
  // in blade mode he commands the Blades of Chaos to fly out and whirl on his foe
  if (s.bladeMode) {
    if (s.cdBlades <= 0 && bladesReady(s) && dist >= 5 && dist <= BLADE_MAX_RANGE) { godStartBlades(god, s); return; }
    if (s.cdChain <= 0 && dist >= 3 && dist <= CHAIN_REACH) { godStartChain(god, s, target); return; }
  } else if (s.cdPunch <= 0 && dist <= 3.2) {
    // hyper-fast bare-fist flurry up close
    s.state = "punch"; s.stateTicks = 0; s.cdPunch = 16;
    setAnimState(god, "punch");
    faceTarget(god, target);
    godHurt(god, target, 6);
    knockPlayer(target, norm2d(sub(target.location, god.location)), 0.6, 0.2);
    return;
  }
}

// ---- god grudge memory (fights mobs too) ----
world.afterEvents.entityHurt.subscribe((ev) => {
  const hurt = ev.hurtEntity;
  const src = ev.damageSource?.damagingEntity;
  if (src?.typeId === MOLTEN_GOD_ID && hurt && !isPlayer(hurt) && canFight(hurt)) {
    const s = getGodState(src);
    s.mobFoeId = hurt.id; s.mobFoeTick = system.currentTick;
  }
  if (hurt.typeId !== MOLTEN_GOD_ID) return;
  const s = getGodState(hurt);
  if (src && !isPlayer(src) && canFight(src)) {
    s.mobFoeId = src.id; s.mobFoeTick = system.currentTick;
  }
});

// clean maps when props die
world.afterEvents.entityDie.subscribe((ev) => {
  const id = ev.deadEntity?.id;
  if (!id) return;
  crystals.delete(id);
  pillars.delete(id);
  solars.delete(id);
  leviathans.delete(id);
});

// ---- phase 3 master loop ----
system.runInterval(() => {
  tickDots();
  tickBeams();
  for (const dimId of DIMENSIONS) {
    let dimension;
    try { dimension = world.getDimension(dimId); } catch { continue; }
    try { for (const g of dimension.getEntities({ type: MOLTEN_GOD_ID })) { try { tickGod(g); } catch { } } } catch { }
    try { for (const l of dimension.getEntities({ type: LEVIATHAN_ID })) { try { tickLeviathan(l); } catch { } } } catch { }
    try { for (const c of dimension.getEntities({ type: SOLAR_ID })) { try { tickSolar(c); } catch { } } } catch { }
    try { for (const c of dimension.getEntities({ type: CRYSTAL_ID })) { try { tickCrystal(c); } catch { } } } catch { }
    try { for (const p of dimension.getEntities({ type: PILLAR_ID })) { try { tickPillar(p); } catch { } } } catch { }
  }
}, 1);

// phase 3 housekeeping
system.runInterval(() => {
  const live = new Set();
  for (const dimId of DIMENSIONS) {
    try {
      for (const t of [MOLTEN_GOD_ID, CRYSTAL_ID, PILLAR_ID, SOLAR_ID, LEVIATHAN_ID]) {
        for (const e of world.getDimension(dimId).getEntities({ type: t })) live.add(e.id);
      }
    } catch { }
  }
  for (const m of [gods, crystals, pillars, solars, leviathans]) {
    for (const id of m.keys()) if (!live.has(id)) m.delete(id);
  }
}, 600);
