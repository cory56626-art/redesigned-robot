// =====================================================================
//  OATHBREAKER TITAN — Kratos-inspired boss AI
//  Moves: Titan Cleave, Earthsplitter Leap, Oathbound Parry,
//         Rage Phase (50% HP), Final Judgment (10% HP)
// =====================================================================
import {
  world,
  system,
  EquipmentSlot,
  GameMode,
  EntityDamageCause
} from "@minecraft/server";

const TITAN_ID = "ob:oathbreaker_titan";
const STATE_PROP = "ob:attack_state";

// ---------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------
const CLEAVE_RANGE = 6.5;        // wide horizontal slash reach
const CLEAVE_DAMAGE = 13;
const CLEAVE_BLOCKED_DAMAGE = 5; // blocking reduces damage...
const CLEAVE_COOLDOWN = 70;      // ticks
const CLEAVE_HIT_TICK = 11;      // damage lands mid-swing
const CLEAVE_LENGTH = 24;

const LEAP_COOLDOWN = 260;
const LEAP_AIR_TICKS = 26;       // time in the air
const LEAP_LOCK_TICK = 18;       // landing spot locks here (dodge window)
const SLAM_DAMAGE = 14;
const SLAM_RADIUS = 4.5;
const SHOCKWAVE_LENGTH = 18;     // blocks the wave travels
const SHOCKWAVE_DAMAGE = 10;
const SHOCKWAVE_WIDTH = 1.7;     // dodge sideways...
const SHOCKWAVE_MAX_RISE = 1.4;  // ...or jump over it

const PARRY_WINDOW = 30;         // ticks; 3 hits inside this = parry
const PARRY_HITS = 3;
const PARRY_COOLDOWN = 160;
const PARRY_COUNTER_DAMAGE = 12;
const PARRY_LENGTH = 18;
const PARRY_COUNTER_TICK = 7;

const DASH_COOLDOWN = 130;       // rage-only fiery dash
const DASH_TICKS = 9;
const DASH_DAMAGE = 9;

const JUDGMENT_CHARGE_TICKS = 120; // 6 seconds to strike the core
const JUDGMENT_COOLDOWN = 900;
const JUDGMENT_EXPLOSION_RADIUS = 7;
const JUDGMENT_BONUS_DAMAGE = 22;  // manual falloff damage on failure
const STUN_TICKS = 100;            // reward for striking the core

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
      cdCleave: 60,
      cdLeap: 200,
      cdDash: 80,
      cdParry: 100,
      cdJudgment: 0,
      raged: false,
      judgmentInterrupted: false,
      hitLog: new Map(),   // playerId -> [tick, tick, ...]
      cleaveHit: false,
      leapStart: null,
      leapLock: null,
      dashDir: null,
      dashHit: null,
      parryTargetId: null
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

// ---------------------------------------------------------------------
// Active shockwaves (Earthsplitter Leap)
// ---------------------------------------------------------------------
const shockwaves = [];

function spawnShockwave(titan, origin, dir) {
  shockwaves.push({
    dimension: titan.dimension,
    titanId: titan.id,
    x: origin.x,
    y: origin.y,
    z: origin.z,
    dir,
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

    for (const p of alivePlayersNear(w.dimension, pos, 4)) {
      if (w.hit.has(p.id)) continue;
      const d = sub(p.location, pos);
      // narrow line: dodge sideways, or jump: the wave only clips grounded feet
      if (len2d(d) <= SHOCKWAVE_WIDTH && p.location.y - w.y < SHOCKWAVE_MAX_RISE && p.isOnGround) {
        w.hit.add(p.id);
        try {
          p.applyDamage(SHOCKWAVE_DAMAGE, { cause: EntityDamageCause.entityAttack });
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

function startLeap(titan, s, target) {
  s.state = "leap";
  s.stateTicks = 0;
  s.cdLeap = LEAP_COOLDOWN;
  s.leapStart = { ...titan.location };
  s.leapLock = { ...target.location };
  setAnimState(titan, "leap");
  playSoundAt(titan.dimension, "mob.ravager.roar", titan.location);
  actionbarNearby(titan, 40, "§6⚠ The Titan takes to the sky!");
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

function enterRage(titan, s) {
  s.raged = true;
  try { titan.triggerEvent("ob:enter_rage"); } catch { }
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
    const chest = { x: titan.location.x, y: titan.location.y + 2, z: titan.location.z };
    for (let i = -3; i <= 3; i++) {
      const a = Math.atan2(fwd.z, fwd.x) + i * 0.28;
      particle(titan.dimension, "minecraft:critical_hit_emitter", {
        x: chest.x + Math.cos(a) * 4, y: chest.y, z: chest.z + Math.sin(a) * 4
      });
    }
    // wide 120-degree arc in front of the Titan
    for (const p of alivePlayersNear(titan.dimension, titan.location, CLEAVE_RANGE)) {
      const to = norm2d(sub(p.location, titan.location));
      const dot = fwd.x * to.x + fwd.z * to.z;
      if (dot < 0.35) continue;
      if (isBlocking(p)) {
        // reduced damage, but the sheer force staggers
        hurtPlayer(titan, p, CLEAVE_BLOCKED_DAMAGE);
        knockPlayer(p, to, 1.6, 0.5);
        try { p.addEffect("slowness", 30, { amplifier: 1 }); } catch { }
        try { p.onScreenDisplay.setActionBar("§7🛡 Blocked — but the blow staggers you!"); } catch { }
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
    const y = baseY + Math.sin(Math.PI * f) * 9;
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

    for (const p of alivePlayersNear(titan.dimension, land, SLAM_RADIUS)) {
      hurtPlayer(titan, p, SLAM_DAMAGE);
      knockPlayer(p, norm2d(sub(p.location, land)), 1.4, 0.6);
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
    particle(titan.dimension, "minecraft:basic_flame_particle", { x: loc.x, y: loc.y + 1.6, z: loc.z });
    particle(titan.dimension, "minecraft:lava_particle", loc);
    for (const p of alivePlayersNear(titan.dimension, loc, 2.6)) {
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
        x: loc.x + (Math.random() - 0.5) * 3, y: loc.y + 2 + Math.random() * 2, z: loc.z + (Math.random() - 0.5) * 3
      });
    }
    return;
  }

  // charge-up drama at the chest core
  if (t % 4 === 0) {
    const core = { x: loc.x, y: loc.y + 2.3, z: loc.z };
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
    for (const p of alivePlayersNear(titan.dimension, loc, 10)) {
      const d = Math.max(1, distance(p.location, loc));
      hurtPlayer(titan, p, Math.round(JUDGMENT_BONUS_DAMAGE * Math.min(1, 3 / d)));
      knockPlayer(p, norm2d(sub(p.location, loc)), 2.5, 0.9);
    }
    backToIdle(titan, s, 20);
  }
}

function tickStunned(titan, s) {
  freeze(titan, 5);
  if (s.stateTicks % 10 === 0) {
    const loc = titan.location;
    particle(titan.dimension, "minecraft:villager_angry", { x: loc.x, y: loc.y + 4.2, z: loc.z });
  }
  if (s.stateTicks >= STUN_TICKS) backToIdle(titan, s);
}

function backToIdle(titan, s, extraRecovery = 0) {
  s.state = "idle";
  s.stateTicks = -extraRecovery;
  setAnimState(titan, "idle");
}

// ---------------------------------------------------------------------
// Target selection & main brain
// ---------------------------------------------------------------------
function nearestTarget(titan) {
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
  if (s.cdJudgment > 0) s.cdJudgment--;

  // phase checks (also caught in the hurt handler, this is a safety net)
  const health = titan.getComponent("minecraft:health");
  const hpFrac = health ? health.currentValue / health.effectiveMax : 1;
  if (!s.raged && hpFrac <= 0.5) enterRage(titan, s);

  switch (s.state) {
    case "cleave": return tickCleave(titan, s);
    case "leap": return tickLeap(titan, s);
    case "dash": return tickDash(titan, s);
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

  // Final Judgment at 10% HP
  if (hpFrac <= 0.1 && s.cdJudgment <= 0) {
    startJudgment(titan, s);
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
}, 600);

// ---------------------------------------------------------------------
// Damage events: rage trigger, Oathbound Parry, Judgment interrupt
// ---------------------------------------------------------------------
world.afterEvents.entityHurt.subscribe((ev) => {
  const titan = ev.hurtEntity;
  if (titan.typeId !== TITAN_ID) return;
  const s = getState(titan);

  const health = titan.getComponent("minecraft:health");
  if (health && !s.raged && health.currentValue / health.effectiveMax <= 0.5) {
    enterRage(titan, s);
  }

  const attacker = ev.damageSource?.damagingEntity;
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
    particle(titan.dimension, "minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 2, z: loc.z });
    for (let i = 0; i < 16; i++) {
      particle(titan.dimension, "minecraft:basic_smoke_particle", {
        x: loc.x + (Math.random() - 0.5) * 3, y: loc.y + Math.random() * 4, z: loc.z + (Math.random() - 0.5) * 3
      });
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
