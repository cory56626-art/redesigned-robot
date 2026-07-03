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
const FRIENDLY = new Set([TITAN_ID, MINI_ID, BOULDER_ID, "ob:debris"]);
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
  setAnimState(titan, "rush");
  faceTarget(titan, target);
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location, 2);
  actionbarNearby(titan, 40, "§6⚠ The Titan charges!");
}

function tickRush(titan, s) {
  const t = s.stateTicks;

  // telegraph: keep tracking while he coils
  if (t < RUSH_TELEGRAPH) {
    const target = nearestTarget(titan);
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
      setAnimState(titan, "skyhurl");
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
    const target = nearestTarget(titan);
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
    const target = nearestTarget(titan);
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
    if (!target) target = nearestTarget(titan);
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
    const currentTarget = nearestTarget(titan);
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
    const target = nearestTarget(titan);
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

function nearestTarget(titan) {
  const s = getState(titan);

  // 1) whatever the vanilla AI is actually fighting right now
  try {
    const t = titan.target;
    if (
      t &&
      t.dimension.id === titan.dimension.id &&
      distance(t.location, titan.location) <= 48
    ) {
      if (isPlayer(t)) {
        // only chase players who are actually fightable (not creative)
        if (alivePlayersNear(titan.dimension, titan.location, 48).some((p) => p.id === t.id)) {
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
        foe.dimension.id === titan.dimension.id &&
        distance(foe.location, titan.location) <= 48
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
      for (const e of titan.dimension.getEntities({
        location: titan.location,
        maxDistance: 24
      })) {
        if (isPlayer(e) || !canFight(e)) continue;
        try {
          if (e.target?.id === titan.id) {
            s.mobFoeId = e.id;
            s.mobFoeTick = system.currentTick;
            return e;
          }
        } catch { }
      }
    } catch { }
  }

  // 4) nearest survival/adventure player
  const players = alivePlayersNear(titan.dimension, titan.location, 48);
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = distance(p.location, titan.location);
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

  const target = nearestTarget(titan);
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
  const titan = ev.deadEntity;
  if (titan.typeId !== TITAN_ID) return;
  titans.delete(titan.id);
  try {
    const loc = titan.location;
    playSoundAt(titan.dimension, "mob.wither.death", loc, 3);
    particle(titan.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 1, z: loc.z });
    for (let i = 0; i < 16; i++) {
      particle(titan.dimension, "minecraft:basic_smoke_particle", {
        x: loc.x + (Math.random() - 0.5) * 3, y: loc.y + Math.random() * 2.5, z: loc.z + (Math.random() - 0.5) * 3
      });
    }
    // his embers die with him
    for (const mini of titan.dimension.getEntities({ type: MINI_ID, location: loc, maxDistance: 60 })) {
      try {
        particle(titan.dimension, "minecraft:basic_smoke_particle", mini.location);
        mini.kill();
      } catch { }
    }
    for (const p of alivePlayersNear(titan.dimension, loc, 60)) {
      p.onScreenDisplay.setTitle("§6THE OATH IS BROKEN", {
        subtitle: "§7The Titan has fallen.",
        fadeInDuration: 10,
        stayDuration: 60,
        fadeOutDuration: 20
      });
    }
  } catch { }
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
