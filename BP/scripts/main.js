// =====================================================================
//  THE MARAUDER — Blood/Beast rival-boss AI (human-sized, fast)
//  Moves (Phase 1 "Crimson Waltz"):
//         Waltz Cleave, Blood Flicker, Crimson Lance, Riposte/Visceral,
//         Blood Scent (passive)
//  Phase 2 "The Frenzy" (<=50% HP): transforms — draws second blade,
//         beast arm manifests. +Beast Lunge, Blood Eclipse, Feral Flurry,
//         Rally (passive self-heal), Twin Waltz, Blood-Curse debuff.
//  Designed as a rival to the Oathbreaker Titan (ob:oathbreaker_titan):
//  she actively hunts the Titan; the Titan retaliates via hurt_by_target.
// =====================================================================
import {
  world,
  system,
  GameMode
} from "@minecraft/server";

const MARAUDER_ID = "mar:marauder";
const TITAN_ID = "ob:oathbreaker_titan";
const STATE_PROP = "mar:attack_state";

// ---------------------------------------------------------------------
// Tuning (glass-cannon: lower HP than the Titan's 600, but faster + combos)
// ---------------------------------------------------------------------
const CHEST_Y = 1.2;

// --- Waltz Cleave (Phase 1) / Twin Waltz (Phase 2) ---
const WALTZ_RANGE = 4.8;
const WALTZ_HITS_P1 = 3;
const WALTZ_HITS_P2 = 4;
const WALTZ_DAMAGE_P1 = 9;
const WALTZ_DAMAGE_P2 = 8;
const WALTZ_COOLDOWN = 45;
const WALTZ_HIT_TICKS_P1 = [8, 16, 24];     // hit 2 has a deliberate pause (roll-catch)
const WALTZ_HIT_TICKS_P2 = [6, 12, 18, 24];
const WALTZ_LENGTH = 28;
const WALTZ_ARC_DOT = 0.3;                   // ~145 degree arc

// --- Blood Flicker (quickstep blink) ---
const FLICKER_COOLDOWN = 90;
const FLICKER_TICKS = 12;
const FLICKER_DIST = 5.5;
const FLICKER_EXIT_DAMAGE = 4;
const FLICKER_LENGTH = 14;

// --- Crimson Lance (ranged blood spear) ---
const LANCE_COOLDOWN = 110;
const LANCE_TICK = 8;
const LANCE_LENGTH = 18;
const LANCE_DAMAGE = 8;

// --- Riposte / Visceral (reactive parry) ---
const RIPOSTE_WINDOW = 25;        // telegraphed guard window where hits trigger parry
const RIPOSTE_COOLDOWN = 140;
const RIPOSTE_COUNTER_DAMAGE = 14;
const RIPOSTE_COUNTER_TICK = 6;
const RIPOSTE_LENGTH = 16;

// --- Blood Scent (passive: chase the wounded) ---
const SCENT_HP_THRESHOLD = 0.35;  // targets below 35% HP
const SCENT_SPEED_BOOST_AMP = 0;  // Speed I toward them

// --- Phase 2 transition ---
const PHASE2_HP_FRAC = 0.5;
const TRANSFORM_LENGTH = 64;      // ~3.2s invuln waltz->beast

// --- Beast Lunge (Phase 2 heavy hitter) ---
const LUNGE_COOLDOWN = 240;
const LUNGE_TELEGRAPH = 10;
const LUNGE_TICKS = 14;
const LUNGE_SPEED = 1.8;
const LUNGE_REACH = 3.0;
const LUNGE_DAMAGE = 16;
const LUNGE_LENGTH = 30;

// --- Blood Eclipse (Phase 2 AoE) ---
const ECLIPSE_COOLDOWN = 480;
const ECLIPSE_BURST_TICK = 16;
const ECLIPSE_LENGTH = 34;
const ECLIPSE_RADIUS = 6;
const ECLIPSE_DAMAGE = 12;
const ECLIPSE_POOL_SECONDS = 6;
const ECLIPSE_POOL_RADIUS = 1.7;
const ECLIPSE_POOL_TICK_INTERVAL = 10;   // pools bite every half second

// --- Feral Flurry (Phase 2 finisher combo) ---
const FLURRY_COOLDOWN = 360;
const FLURRY_HITS = 5;
const FLURRY_DAMAGE = 6;          // 6x5 = 30 burst, each dodgeable
const FLURRY_HIT_INTERVAL = 8;
const FLURRY_LENGTH = 50;

// --- Rally (Phase 2 passive self-heal) ---
const RALLY_WINDOW_TICKS = 60;    // 3s after taking damage
const RALLY_HEAL_FRACTION = 0.45;

// --- Blood-Curse (the bleed system) ---
const CURSE_MAX_STACKS = 5;
const CURSE_HEMORRHAGE_DAMAGE = 10;

// --- Transform invuln ---
const TRANSFORM_INVULN_SECONDS = 3.5;

// ---------------------------------------------------------------------
// Per-Marauder state
// ---------------------------------------------------------------------
const marauders = new Map();

function getState(marauder) {
  let s = marauders.get(marauder.id);
  if (!s) {
    s = {
      state: "idle",
      stateTicks: 0,
      frenzied: false,
      // cooldowns (ticks)
      cdWaltz: 20,
      cdFlicker: 0,
      cdLance: 0,
      cdRiposte: 0,
      cdLunge: 0,
      cdEclipse: 0,
      cdFlurry: 0,
      // rally
      lastHurtTick: -9999,
      // blood-curse tracking: targetId -> stacks
      curseStacks: new Map(),
      // waltz hit bookkeeping
      waltzHitsDone: 0,
      // lunge
      lungeDir: null,
      // flicker
      flickerTarget: null,
      // riposte
      riposteTriggered: false,
      // flurriness
      flurryHitsDone: 0,
      nextFlurryHitTick: 0
    };
    marauders.set(marauder.id, s);
  }
  return s;
}

// ---------------------------------------------------------------------
// Vector + world helpers (mirrors the Titan's toolkit)
// ---------------------------------------------------------------------
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function addv(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v, n) {
  return { x: v.x * n, y: v.y * n, z: v.z * n };
}
function norm2d(v) {
  const l = Math.hypot(v.x, v.z);
  if (l < 0.001) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: 0, z: v.z / l };
}
function norm3d(v) {
  const l = Math.hypot(v.x, v.y, v.z);
  if (l < 0.001) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isAliveCombatant(e) {
  if (!e) return false;
  try {
    const h = e.getComponent("minecraft:health");
    return !!h && h.currentValue > 0;
  } catch {
    return false;
  }
}

function isPlayer(p) {
  try { return p && typeof p.isSneaking !== "undefined" && p.typeId === "minecraft:player"; }
  catch { return false; }
}

/** All valid targets of the Marauder within radius: players AND the rival Titan. */
function victimsNearDim(dimension, location, maxDistance) {
  const out = [];
  try {
    const ents = dimension.getEntities({
      location,
      maxDistance
    });
    for (const e of ents) {
      if (e.typeId === MARAUDER_ID) continue;
      if (!isAliveCombatant(e)) continue;
      if (e.typeId === "minecraft:player") {
        try {
          const gm = typeof e.getGameMode === "function" ? e.getGameMode() : undefined;
          if (gm === GameMode.creative || gm === GameMode.spectator) continue;
        } catch { }
        out.push(e);
      } else if (e.typeId === TITAN_ID) {
        out.push(e);
      }
    }
  } catch { /* keep ticking */ }
  return out;
}

/** Nearest priority target: prefer the rival Titan, else nearest player. */
function nearestTarget(marauder, s) {
  let best = null;
  let bestD = 1e9;
  try {
    // prefer the Titan if alive and in range
    const titans = marauder.dimension.getEntities({ type: TITAN_ID });
    for (const t of titans) {
      if (!isAliveCombatant(t)) continue;
      const d = distance(t.location, marauder.location);
      if (d < bestD && d <= 48) { bestD = d; best = t; }
    }
    // then players
    const players = victimsNearDim(marauder.dimension, marauder.location, 48);
    for (const p of players) {
      const d = distance(p.location, marauder.location);
      if (d < bestD) { bestD = d; best = p; }
    }
  } catch { /* keep ticking */ }
  return best;
}

function setAnimState(marauder, value) {
  try { marauder.setProperty(STATE_PROP, value); } catch { }
}

function freeze(marauder, ticks) {
  // lock her in place during charges / transform via slowness + no movement
  try { marauder.addEffect("slowness", ticks, { amplifier: 10, showParticles: false }); } catch { }
}

function faceTarget(marauder, target) {
  try {
    marauder.teleport(marauder.location, { facingLocation: target.location });
  } catch { }
}

function playSoundAt(dimension, soundId, location, volume = 2) {
  try { dimension.playSound(soundId, { location, volume, pitch: 1 }); } catch { }
}

function particle(dimension, name, location) {
  try { dimension.spawnParticle(name, location); } catch { }
}

function groundY(dimension, x, yStart, z) {
  // walk down to find the first solid block under yStart
  try {
    for (let y = Math.floor(yStart) + 2; y > yStart - 12; y--) {
      const below = dimension.getBlock({ x: Math.floor(x), y: y - 1, z: Math.floor(z) });
      if (below && !below.isAir) return y;
    }
  } catch { }
  return yStart;
}

function isBlocking(player) {
  if (!isPlayer(player)) return false;
  try { return !!player.isBlocking; } catch { return false; }
}

/** Apply damage to any combatant (player or boss). Returns true if damage applied. */
function hurtTarget(marauder, target, amount) {
  if (!isAliveCombatant(target)) return false;
  const s = getState(marauder);
  try {
    const dealt = target.applyDamage(amount, {
      cause: "entityAttack",
      damagingEntity: marauder
    });
    // --- Rally (Phase 2 only): heal for a fraction of damage dealt ---
    if (s.frenzied && dealt && (system.currentTick - s.lastHurtTick) <= RALLY_WINDOW_TICKS) {
      const mh = marauder.getComponent("minecraft:health");
      if (mh) {
        const heal = Math.round(amount * RALLY_HEAL_FRACTION);
        try {
          mh.setCurrentValue(Math.min(mh.effectiveMax, mh.currentValue + heal));
          particle(marauder.dimension, "minecraft:heart_particle", {
            x: marauder.location.x, y: marauder.location.y + 1.5, z: marauder.location.z
          });
        } catch { }
      }
    }
    return dealt;
  } catch {
    return false;
  }
}

/** Add a Blood-Curse stack to a target; Hemorrhage at max. */
function addCurse(marauder, target) {
  if (!isAliveCombatant(target)) return;
  const s = getState(marauder);
  const key = target.id;
  let stacks = (s.curseStacks.get(key) || 0) + 1;
  if (stacks >= CURSE_MAX_STACKS) {
    // Hemorrhage proc
    hurtTarget(marauder, target, CURSE_HEMORRHAGE_DAMAGE);
    particle(target.dimension, "minecraft:large_explosion", {
      x: target.location.x, y: target.location.y + 1, z: target.location.z
    });
    playSoundAt(target.dimension, "random.glass", target.location, 1.2);
    s.curseStacks.delete(key);
  } else {
    s.curseStacks.set(key, stacks);
    // short wither tick per stack (the bleed)
    try { target.addEffect("wither", 30 + stacks * 10, { amplifier: 0, showParticles: false }); } catch { }
    playSoundAt(target.dimension, "liquid.lava", target.location, 0.6);
  }
}

function knockback(target, dir, horizontal, vertical) {
  try {
    target.applyKnockback(dir.x, dir.z, horizontal, vertical);
  } catch {
    try { target.applyImpulse({ x: dir.x * horizontal, y: vertical, z: dir.z * horizontal }); } catch { }
  }
}

function titleNearby(marauder, radius, title, subtitle) {
  try {
    for (const p of victimsNearDim(marauder.dimension, marauder.location, radius)) {
      if (isPlayer(p)) {
        try { p.onScreenDisplay.setTitle(title, { subtitle, fadeInDuration: 5, fadeOutDuration: 10 }); } catch { }
      }
    }
  } catch { }
}

function actionbarNearby(marauder, radius, text) {
  try {
    for (const p of victimsNearDim(marauder.dimension, marauder.location, radius)) {
      if (isPlayer(p)) {
        try { p.onScreenDisplay.setActionBar(text); } catch { }
      }
    }
  } catch { }
}

function tellVictim(victim, text) {
  if (!isPlayer(victim)) return;
  try { victim.onScreenDisplay.setActionBar(text); } catch { }
}

// =====================================================================
// PHASE TRANSITION
// =====================================================================
function enterPhase2(marauder, s) {
  if (s.frenzied) return;
  s.frenzied = true;
  try { marauder.setProperty("mar:frenzied", true); } catch { }
  // speed boost via effect (NOT an entity event — avoids AI target reset)
  try { marauder.addEffect("speed", 99999, { amplifier: 1, showParticles: false }); } catch { }
  playSoundAt(marauder.dimension, "mob.ravager.roar", marauder.location, 3);
  titleNearby(marauder, 50, "§4THE FRENZY", "§cShe draws the second blade...");
  // burst of blood particles
  const loc = marauder.location;
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    particle(marauder.dimension, "minecraft:basic_flame_particle", {
      x: loc.x + Math.cos(a) * 2, y: loc.y + 1, z: loc.z + Math.sin(a) * 2
    });
    particle(marauder.dimension, "minecraft:redstone_particle", {
      x: loc.x + Math.cos(a) * 2.5, y: loc.y + 0.3, z: loc.z + Math.sin(a) * 2.5
    });
  }
  s.state = "transform";
  s.stateTicks = 0;
  setAnimState(marauder, "transform");
  freeze(marauder, TRANSFORM_LENGTH);
  // transform invulnerability: resistance V = full damage immunity for the waltz->beast switch
  try {
    marauder.addEffect("resistance", Math.ceil(TRANSFORM_INVULN_SECONDS * 20), { amplifier: 4, showParticles: false });
  } catch { }
}

// =====================================================================
// ABILITY: Waltz Cleave (P1) / Twin Waltz (P2)
// =====================================================================
function startWaltz(marauder, s, target) {
  s.state = "waltz";
  s.stateTicks = 0;
  s.cdWaltz = WALTZ_COOLDOWN;
  s.waltzHitsDone = 0;
  setAnimState(marauder, "waltz");
  faceTarget(marauder, target);
}

function tickWaltz(marauder, s) {
  const hits = s.frenzied ? WALTZ_HITS_P2 : WALTZ_HITS_P1;
  const ticks = s.frenzied ? WALTZ_HIT_TICKS_P2 : WALTZ_HIT_TICKS_P1;
  const dmg = s.frenzied ? WALTZ_DAMAGE_P2 : WALTZ_DAMAGE_P1;

  const t = s.stateTicks;
  if (s.waltzHitsDone < hits && t >= ticks[s.waltzHitsDone]) {
    s.waltzHitsDone++;
    const fwd = marauder.getViewDirection();
    playSoundAt(marauder.dimension, "mob.irongolem.throw", marauder.location, 1.2);
    // crescent particle arc
    for (let i = -3; i <= 3; i++) {
      const a = Math.atan2(fwd.z, fwd.x) + i * 0.22;
      particle(marauder.dimension, "minecraft:critical_hit_emitter", {
        x: marauder.location.x + Math.cos(a) * 3,
        y: marauder.location.y + CHEST_Y,
        z: marauder.location.z + Math.sin(a) * 3
      });
    }
    for (const v of victimsNearDim(marauder.dimension, marauder.location, WALTZ_RANGE)) {
      const to = norm2d(sub(v.location, marauder.location));
      const dot = fwd.x * to.x + fwd.z * to.z;
      if (dot < WALTZ_ARC_DOT) continue;
      hurtTarget(marauder, v, dmg);
      knockback(v, to, 0.9, 0.3);
      if (s.frenzied) addCurse(marauder, v);   // Twin Waltz bleeds
    }
  }
  if (t >= WALTZ_LENGTH) backToIdle(marauder, s);
}

// =====================================================================
// ABILITY: Blood Flicker (quickstep blink through target)
// =====================================================================
function startFlicker(marauder, s, target) {
  s.state = "flicker";
  s.stateTicks = 0;
  s.cdFlicker = FLICKER_COOLDOWN;
  s.flickerTarget = target;
  setAnimState(marauder, "flicker");
  // blood afterimage at the start point
  const loc = marauder.location;
  for (let i = 0; i < 6; i++) {
    particle(marauder.dimension, "minecraft:redstone_particle", {
      x: loc.x + (Math.random() - 0.5),
      y: loc.y + 0.5 + Math.random() * 2,
      z: loc.z + (Math.random() - 0.5)
    });
  }
}

function tickFlicker(marauder, s) {
  const t = s.stateTicks;
  if (t === 1 && s.flickerTarget) {
    // blink to the far side of the target (through them)
    const target = s.flickerTarget;
    if (isAliveCombatant(target)) {
      const fwd = norm2d(sub(target.location, marauder.location));
      const land = {
        x: target.location.x + fwd.x * (FLICKER_DIST - 1),
        y: target.location.y,
        z: target.location.z + fwd.z * (FLICKER_DIST - 1)
      };
      try { marauder.teleport(land); } catch { }
      faceTarget(marauder, target);
    }
  }
  if (t >= FLICKER_TICKS) {
    // exit slash on whoever's now in front (repositioned behind them)
    const fwd = marauder.getViewDirection();
    for (const v of victimsNearDim(marauder.dimension, marauder.location, WALTZ_RANGE)) {
      const to = norm2d(sub(v.location, marauder.location));
      if (fwd.x * to.x + fwd.z * to.z < 0.2) continue;
      hurtTarget(marauder, v, FLICKER_EXIT_DAMAGE);
      tellVictim(v, "§c✦ Flickered past you!");
    }
  }
  if (t >= FLICKER_LENGTH) backToIdle(marauder, s);
}

// =====================================================================
// ABILITY: Crimson Lance (ranged blood spear)
// =====================================================================
function startLance(marauder, s, target) {
  s.state = "lance";
  s.stateTicks = 0;
  s.cdLance = LANCE_COOLDOWN;
  s.flickerTarget = target; // reuse as lance target
  setAnimState(marauder, "lance");
  faceTarget(marauder, target);
}

function tickLance(marauder, s) {
  const t = s.stateTicks;
  if (t === LANCE_TICK) {
    // fire a fast-tracking blood spear toward the target
    const target = s.flickerTarget;
    let dir = marauder.getViewDirection();
    if (isAliveCombatant(target)) {
      dir = norm3d(sub(target.location, {
        x: marauder.location.x, y: marauder.location.y + CHEST_Y, z: marauder.location.z
      }));
    }
    playSoundAt(marauder.dimension, "mob.blaze.shoot", marauder.location, 1.5);
    // spawn an arrow as the projectile (re-skinned by particles), blood-tinted
    try {
      const proj = marauder.dimension.spawnEntity("minecraft:arrow", {
        x: marauder.location.x + dir.x,
        y: marauder.location.y + CHEST_Y + dir.y,
        z: marauder.location.z + dir.z
      });
      try { proj.applyImpulse(scale(dir, 2.2)); } catch { }
      // tag it so we can detect lance hits in the projectile handler
      try { proj.nameTag = "mar_blood_lance"; } catch { }
      // curse on hit is applied via entityHurt (any arrow damage from the marauder while in 'lance' counts)
    } catch { }
    for (let i = 0; i < 5; i++) {
      particle(marauder.dimension, "minecraft:redstone_particle", {
        x: marauder.location.x + dir.x * i,
        y: marauder.location.y + CHEST_Y + dir.y * i,
        z: marauder.location.z + dir.z * i
      });
    }
  }
  if (t >= LANCE_LENGTH) backToIdle(marauder, s);
}

// =====================================================================
// ABILITY: Riposte / Visceral (reactive parry counter)
// =====================================================================
function startRiposte(marauder, s) {
  s.state = "riposte";
  s.stateTicks = 0;
  s.cdRiposte = RIPOSTE_COOLDOWN;
  s.riposteTriggered = false;
  setAnimState(marauder, "riposte");
  actionbarNearby(marauder, 12, "§7< The Marauder reads you — bait her or back off >");
}

function tickRiposte(marauder, s) {
  const t = s.stateTicks;
  // during the guard window, getting hit triggers the visceral counter
  if (!s.riposteTriggered && t < RIPOSTE_WINDOW) {
    // hold the stance so the telegraph reads; the counter fires from entityHurt (see bottom)
    freeze(marauder, 2);
    return;
  }
  if (s.riposteTriggered && t >= RIPOSTE_COUNTER_TICK + (t - RIPOSTE_WINDOW)) {
    // already countered; wait out the animation
  }
  if (t >= RIPOSTE_LENGTH) backToIdle(marauder, s);
}

/** Called from the entityHurt handler: if she's guarding and gets struck, counter. */
function tryRiposteCounter(marauder, s, attacker) {
  if (s.state !== "riposte" || s.riposteTriggered) return false;
  if (s.stateTicks >= RIPOSTE_WINDOW) return false;
  if (!isAliveCombatant(attacker)) return false;
  s.riposteTriggered = true;
  faceTarget(marauder, attacker);
  // visceral stab
  hurtTarget(marauder, attacker, RIPOSTE_COUNTER_DAMAGE);
  knockback(attacker, norm2d(sub(attacker.location, marauder.location)), 1.4, 0.5);
  playSoundAt(marauder.dimension, "mob.wither.hurt", marauder.location, 1.5);
  particle(marauder.dimension, "minecraft:critical_hit_emitter", {
    x: attacker.location.x, y: attacker.location.y + 1, z: attacker.location.z
  });
  tellVictim(attacker, "§4✦ VISCERAL — parried and stabbed!");
  return true;
}

// =====================================================================
// ABILITY: Beast Lunge (Phase 2 heavy hitter)
// =====================================================================
function startLunge(marauder, s, target) {
  s.state = "lunge";
  s.stateTicks = 0;
  s.cdLunge = LUNGE_COOLDOWN;
  setAnimState(marauder, "lunge");
  faceTarget(marauder, target);
  s.lungeDir = norm2d(sub(target.location, marauder.location));
  titleNearby(marauder, 20, "§c✦ FERAL BURST", "");
  actionbarNearby(marauder, 14, "§cThe beast winds up — sidestep!");
}

function tickLunge(marauder, s) {
  const t = s.stateTicks;
  if (t < LUNGE_TELEGRAPH) {
    // wind-up: freeze, telegraph
    freeze(marauder, 2);
    if (t % 2 === 0) {
      particle(marauder.dimension, "minecraft:redstone_particle", {
        x: marauder.location.x, y: marauder.location.y + 0.5, z: marauder.location.z
      });
    }
    return;
  }
  if (t < LUNGE_TELEGRAPH + LUNGE_TICKS && s.lungeDir) {
    // the lunge
    try {
      marauder.teleport({
        x: marauder.location.x + s.lungeDir.x * LUNGE_SPEED,
        y: marauder.location.y,
        z: marauder.location.z + s.lungeDir.z * LUNGE_SPEED
      }, { facingLocation: addv(marauder.location, s.lungeDir) });
    } catch { }
    // claw rake on anyone in reach
    for (const v of victimsNearDim(marauder.dimension, marauder.location, LUNGE_REACH)) {
      const to = norm2d(sub(v.location, marauder.location));
      if (s.lungeDir.x * to.x + s.lungeDir.z * to.z < 0.3) continue;
      hurtTarget(marauder, v, LUNGE_DAMAGE);
      knockback(v, s.lungeDir, 1.8, 0.6);
      addCurse(marauder, v);
      playSoundAt(marauder.dimension, "mob.wolf.growl", v.location, 1.5);
    }
    if (t % 2 === 0) {
      particle(marauder.dimension, "minecraft:critical_hit_emitter", {
        x: marauder.location.x, y: marauder.location.y + 1, z: marauder.location.z
      });
    }
  }
  if (t >= LUNGE_LENGTH) backToIdle(marauder, s);
}

// =====================================================================
// ABILITY: Blood Eclipse (Phase 2 AoE + lingering pools)
// =====================================================================
function startEclipse(marauder, s) {
  s.state = "eclipse";
  s.stateTicks = 0;
  s.cdEclipse = ECLIPSE_COOLDOWN;
  setAnimState(marauder, "eclipse");
  actionbarNearby(marauder, 16, "§cBlood Eclipse — get clear!");
}

function tickEclipse(marauder, s) {
  const t = s.stateTicks;
  if (t < ECLIPSE_BURST_TICK) {
    // charge: arms raise, blood gathers
    freeze(marauder, 2);
    const loc = marauder.location;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      particle(marauder.dimension, "minecraft:redstone_particle", {
        x: loc.x + Math.cos(a) * ECLIPSE_RADIUS,
        y: loc.y + 0.3,
        z: loc.z + Math.sin(a) * ECLIPSE_RADIUS
      });
    }
    return;
  }
  if (t === ECLIPSE_BURST_TICK) {
    // BURST
    const loc = marauder.location;
    playSoundAt(marauder.dimension, "random.explode", loc, 2.5);
    particle(marauder.dimension, "minecraft:knockback_roar_particle", { x: loc.x, y: loc.y + 0.5, z: loc.z });
    for (const v of victimsNearDim(marauder.dimension, loc, ECLIPSE_RADIUS)) {
      hurtTarget(marauder, v, ECLIPSE_DAMAGE);
      knockback(v, norm2d(sub(v.location, loc)), 1.3, 0.5);
      addCurse(marauder, v);
    }
    // lingering blood pools: spawn slow area-effect via lingering potion entities
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6;
      const px = loc.x + Math.cos(a) * (ECLIPSE_RADIUS - 1);
      const pz = loc.z + Math.sin(a) * (ECLIPSE_RADIUS - 1);
      try {
        const pool = marauder.dimension.spawnEntity("minecraft:area_effect_cloud", {
          x: px, y: loc.y, z: pz
        });
        try { pool.nameTag = "mar_blood_pool"; } catch { }
        // register with the pool ticker (wither bite + cleanup after ECLIPSE_POOL_SECONDS)
        bloodPools.push({
          entity: pool,
          dimension: marauder.dimension,
          location: { x: px, y: loc.y, z: pz },
          expireTick: system.currentTick + ECLIPSE_POOL_SECONDS * 20
        });
      } catch { }
      for (let k = 0; k < 4; k++) {
        particle(marauder.dimension, "minecraft:redstone_particle", {
          x: px + (Math.random() - 0.5), y: loc.y + 0.1, z: pz + (Math.random() - 0.5)
        });
      }
    }
  }
  if (t >= ECLIPSE_LENGTH) backToIdle(marauder, s);
}

// --- Blood pool ticker: lingering Eclipse pools wither anyone standing in them ---
const bloodPools = [];

system.runInterval(() => {
  for (let i = bloodPools.length - 1; i >= 0; i--) {
    const p = bloodPools[i];
    if (system.currentTick >= p.expireTick) {
      try { p.entity.remove(); } catch { }
      bloodPools.splice(i, 1);
      continue;
    }
    // simmer visual
    particle(p.dimension, "minecraft:redstone_particle", {
      x: p.location.x + (Math.random() - 0.5) * 2,
      y: p.location.y + 0.15,
      z: p.location.z + (Math.random() - 0.5) * 2
    });
    // the bite: wither anyone (player or Titan) standing in the pool
    for (const v of victimsNearDim(p.dimension, p.location, ECLIPSE_POOL_RADIUS)) {
      try { v.addEffect("wither", 40, { amplifier: 1, showParticles: true }); } catch { }
    }
  }
}, ECLIPSE_POOL_TICK_INTERVAL);

// =====================================================================
// ABILITY: Feral Flurry (Phase 2 rushing 5-hit combo)
// =====================================================================
function startFlurry(marauder, s, target) {
  s.state = "flurry";
  s.stateTicks = 0;
  s.cdFlurry = FLURRY_COOLDOWN;
  s.flurryHitsDone = 0;
  s.nextFlurryHitTick = FLURRY_HIT_INTERVAL;
  setAnimState(marauder, "flurry");
  faceTarget(marauder, target);
  actionbarNearby(marauder, 16, "§cFeral Flurry — weave through the slashes!");
}

function tickFlurry(marauder, s) {
  const t = s.stateTicks;
  const target = nearestTarget(marauder, s);
  if (target) faceTarget(marauder, target);
  // rush toward target while slashing
  if (target && t % 3 === 0) {
    const dir = norm2d(sub(target.location, marauder.location));
    try {
      marauder.teleport({
        x: marauder.location.x + dir.x * 0.6,
        y: marauder.location.y,
        z: marauder.location.z + dir.z * 0.6
      });
    } catch { }
  }
  // each hit on the cadence
  if (s.flurryHitsDone < FLURRY_HITS && t >= s.nextFlurryHitTick) {
    s.flurryHitsDone++;
    s.nextFlurryHitTick += FLURRY_HIT_INTERVAL;
    const fwd = marauder.getViewDirection();
    playSoundAt(marauder.dimension, "mob.irongolem.throw", marauder.location, 1);
    for (const v of victimsNearDim(marauder.dimension, marauder.location, WALTZ_RANGE)) {
      const to = norm2d(sub(v.location, marauder.location));
      if (fwd.x * to.x + fwd.z * to.z < WALTZ_ARC_DOT) continue;
      hurtTarget(marauder, v, FLURRY_DAMAGE);
      addCurse(marauder, v);
    }
    particle(marauder.dimension, "minecraft:critical_hit_emitter", {
      x: marauder.location.x + fwd.x * 2, y: marauder.location.y + CHEST_Y, z: marauder.location.z + fwd.z * 2
    });
  }
  if (t >= FLURRY_LENGTH) backToIdle(marauder, s);
}

// =====================================================================
// State return
// =====================================================================
function backToIdle(marauder, s) {
  s.state = "idle";
  s.stateTicks = 0;
  setAnimState(marauder, "idle");
}

// =====================================================================
// MAIN AI: decide next move
// =====================================================================
function tickMarauder(marauder) {
  const s = getState(marauder);
  s.stateTicks++;
  // tick cooldowns
  if (s.cdWaltz > 0) s.cdWaltz--;
  if (s.cdFlicker > 0) s.cdFlicker--;
  if (s.cdLance > 0) s.cdLance--;
  if (s.cdRiposte > 0) s.cdRiposte--;
  if (s.cdLunge > 0) s.cdLunge--;
  if (s.cdEclipse > 0) s.cdEclipse--;
  if (s.cdFlurry > 0) s.cdFlurry--;

  // Blood-Curse bookkeeping: prune stacks for targets that are gone or dead
  if (s.stateTicks % 100 === 0 && s.curseStacks.size > 0) {
    for (const key of [...s.curseStacks.keys()]) {
      let ent;
      try { ent = world.getEntity(key); } catch { ent = undefined; }
      if (!isAliveCombatant(ent)) s.curseStacks.delete(key);
    }
  }

  // --- run active move state machine ---
  switch (s.state) {
    case "waltz": return tickWaltz(marauder, s);
    case "flicker": return tickFlicker(marauder, s);
    case "lance": return tickLance(marauder, s);
    case "riposte": return tickRiposte(marauder, s);
    case "lunge": return tickLunge(marauder, s);
    case "eclipse": return tickEclipse(marauder, s);
    case "flurry": return tickFlurry(marauder, s);
    case "transform": {
      // mid-transform invuln waltz; ride out the animation, then idle
      if (s.stateTicks >= TRANSFORM_LENGTH) backToIdle(marauder, s);
      return;
    }
  }

  // --- phase 2 transition check (safety net; primary in entityHurt) ---
  const health = marauder.getComponent("minecraft:health");
  const hpFrac = health ? health.currentValue / health.effectiveMax : 1;
  if (!s.frenzied && hpFrac <= PHASE2_HP_FRAC) {
    enterPhase2(marauder, s);
    return;
  }

  // --- idle ambience (Phase 2 blood mist) ---
  if (s.frenzied && s.stateTicks % 20 === 0) {
    const loc = marauder.location;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      particle(marauder.dimension, "minecraft:redstone_particle", {
        x: loc.x + Math.cos(a) * r, y: loc.y + Math.random() * 2, z: loc.z + Math.sin(a) * r
      });
    }
  }

  // --- Blood Scent (passive): speed up toward wounded targets ---
  const target = nearestTarget(marauder, s);
  if (!target) return;
  const dist = distance(target.location, marauder.location);
  try {
    if (isPlayer(target)) {
      const th = target.getComponent("minecraft:health");
      if (th && th.currentValue / th.effectiveMax <= SCENT_HP_THRESHOLD) {
        // brief speed pulse
        if (s.stateTicks % 60 === 0) {
          marauder.addEffect("speed", 40, { amplifier: SCENT_SPEED_BOOST_AMP + 1, showParticles: false });
        }
      }
    }
  } catch { }

  // --- DECIDE NEXT MOVE ---
  // Phase 2 exclusive moves first
  if (s.frenzied) {
    // Feral Flurry: occasional big combo
    if (s.cdFlurry <= 0 && dist >= 3 && dist <= 14) { startFlurry(marauder, s, target); return; }
    // Blood Eclipse: close AoE
    if (s.cdEclipse <= 0 && dist <= ECLIPSE_RADIUS) { startEclipse(marauder, s); return; }
    // Beast Lunge: mid-range gap closer
    if (s.cdLunge <= 0 && dist >= 5 && dist <= 20) { startLunge(marauder, s, target); return; }
  }

  // Riposte: if she's been getting hit a lot, bait a parry
  if (s.cdRiposte <= 0 && dist >= 2 && dist <= 6 && Math.random() < 0.25) {
    startRiposte(marauder, s); return;
  }
  // Blood Flicker: reposition when very close or to close a gap
  if (s.cdFlicker <= 0 && dist >= 2 && dist <= 12) { startFlicker(marauder, s, target); return; }
  // Crimson Lance: ranged punish
  if (s.cdLance <= 0 && dist >= 8 && dist <= 26) { startLance(marauder, s, target); return; }
  // Waltz Cleave / Twin Waltz: the bread-and-butter
  if (s.cdWaltz <= 0 && dist <= WALTZ_RANGE) { startWaltz(marauder, s, target); return; }
}

// =====================================================================
// EVENT HANDLERS
// =====================================================================

// Phase transition + Rally trigger: fires when the Marauder takes damage.
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || e.typeId !== MARAUDER_ID) return;
  const marauder = e;
  const s = getState(marauder);

  // record for Rally window
  s.lastHurtTick = system.currentTick;

  // Phase 2 trigger (primary path)
  try {
    const health = marauder.getComponent("minecraft:health");
    if (health && !s.frenzied && health.currentValue / health.effectiveMax <= PHASE2_HP_FRAC) {
      enterPhase2(marauder, s);
      return;
    }
  } catch { }

  // Riposte counter: if she's guarding and the source is a combatant, counter
  if (s.state === "riposte" && !s.riposteTriggered) {
    let attacker = null;
    try {
      const ds = ev.damageSource;
      if (ds && ds.damagingEntity) attacker = ds.damagingEntity;
    } catch { }
    if (attacker) tryRiposteCounter(marauder, s, attacker);
  }
});

// Blood-Curse on lance arrow hits: when the Marauder (idle/lance) damages via projectile
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  try {
    const proj = ev.projectile;
    if (!proj || proj.nameTag !== "mar_blood_lance") return;
    const hit = ev.getEntityHit()?.entity;
    if (!hit) return;
    // find the nearest Marauder to apply curse + bonus damage
    const dim = hit.dimension;
    const ms = dim.getEntities({ type: MARAUDER_ID });
    for (const m of ms) {
      if (distance(m.location, proj.location) < 40) {
        const s = getState(m);
        // the arrow already did its base damage; add curse + small bonus
        addCurse(m, hit);
        break;
      }
    }
  } catch { }
});

// Prune state for dead/despawned Marauders
world.afterEvents.entityRemove.subscribe((ev) => {
  marauders.delete(ev.removedEntityId);
});

// =====================================================================
// MAIN LOOP
// =====================================================================
const DIMENSIONS = ["overworld", "nether", "the_end"];

system.runInterval(() => {
  for (const dimId of DIMENSIONS) {
    let entities;
    try {
      entities = world.getDimension(dimId).getEntities({ type: MARAUDER_ID });
    } catch {
      continue;
    }
    for (const marauder of entities) {
      try {
        tickMarauder(marauder);
      } catch { /* keep the loop alive if one Marauder throws */ }
    }
  }
}, 1);

// =====================================================================
// Spawn egg helper + debug (optional)
//   /scriptevent mar:spawn   -> spawns a Marauder at the sender
// =====================================================================
world.afterEvents.playerSpawn.subscribe(() => { /* ensure script loaded */ });

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (ev.id !== "mar:spawn") return;
  const src = ev.sourceEntity;
  if (!src) return;
  try {
    const m = src.dimension.spawnEntity(MARAUDER_ID, {
      x: src.location.x, y: src.location.y, z: src.location.z + 3
    });
    try { m.nameTag = "The Marauder"; } catch { }
  } catch (e) {
    try { src.sendMessage("§cSpawn failed: " + e); } catch { }
  }
});

console.warn("[The Marauder] script loaded — rival boss active. /scriptevent mar:spawn to summon.");
