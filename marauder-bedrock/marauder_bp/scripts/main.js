import { world, system, GameMode, EntityDamageCause, ItemStack } from "@minecraft/server";

// The Marauder — Bedrock Script API port (reworked).
//
// The entity's *physical* AI (pathing, target acquisition, melee) lives in the
// behavior JSON. This script layers on the parts Bedrock behaviors cannot do on
// their own: per-player staged progression, a night manager that summons the
// rival, telegraphed abilities driven through the "casting" animation property,
// melee swing animation cues, and defeat/reward handling — mirroring the Java
// MarauderEntity state machine as closely as Bedrock allows.
//
// Server-authoritative. Test hooks are exposed via /scriptevent.

const OVERWORLD = "minecraft:overworld";
const MARAUDER = "marauder:marauder";
const STAGE_MAX = 10;

const CHECK_INTERVAL = 40;   // night manager cadence (ticks)
const COMBAT_INTERVAL = 2;   // combat/ability driver cadence (ticks)
const SPAWN_CHANCE = 0.12;   // per-check chance once eligible
const CHALLENGE_RANGE = 16;  // engagement radius
const LEASH_RANGE = 96;      // beyond this from its owner the marauder gives up

const SWING_TICKS = 13;      // how long the melee "attacking" flag stays raised

// Per-stage attack damage, matching the Java MarauderStages table.
const STAGE_DAMAGE = [0, 4, 5, 6, 7, 8, 9, 10, 11, 12.5, 14];

// ------------------------------------------------------------- small helpers

function isValid(e) {
  if (!e) return false;
  try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
  } catch (err) {
    return false;
  }
}
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function dist2d(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function stageDamage(stage) {
  return STAGE_DAMAGE[clampStage(stage)] || 4;
}

// ------------------------------------------------------------- progress

function clampStage(s) {
  s = Math.floor(Number(s));
  if (isNaN(s) || s < 1) return 1;
  if (s > STAGE_MAX) return STAGE_MAX;
  return s;
}
function getStage(player) {
  const v = player.getDynamicProperty("marauder:stage");
  return v === undefined ? 1 : clampStage(v);
}
function setStage(player, s) {
  player.setDynamicProperty("marauder:stage", clampStage(s));
}
function getFlag(player, key) {
  return player.getDynamicProperty(key) === true;
}
function resetProgress(player) {
  setStage(player, 1);
  player.setDynamicProperty("marauder:finalComplete", false);
  player.setDynamicProperty("marauder:rematchArmed", false);
  player.setDynamicProperty("marauder:lastAttemptDay", -1);
}

// ------------------------------------------------------------- time

function isNight() {
  const t = world.getTimeOfDay() % 24000;
  return t >= 13000 && t < 23000;
}
function currentDay() {
  try { return world.getDay(); } catch (e) { return Math.floor(world.getAbsoluteTime() / 24000); }
}

// ------------------------------------------------------------- night manager

system.runInterval(() => {
  if (!isNight()) return;
  const day = currentDay();
  for (const player of world.getAllPlayers()) {
    try { tryEncounter(player, day); } catch (e) { /* keep the loop alive */ }
  }
}, CHECK_INTERVAL);

function tryEncounter(player, day) {
  if (player.dimension.id !== OVERWORLD) return;
  const gm = safeGameMode(player);
  if (gm === GameMode.creative || gm === GameMode.spectator) return;

  const finalDone = getFlag(player, "marauder:finalComplete");
  const rematch = getFlag(player, "marauder:rematchArmed");
  if (finalDone && !rematch) return;
  if (player.getDynamicProperty("marauder:lastAttemptDay") === day) return;
  if (hasActive(player)) return;
  // The final rival is a certainty once armed; earlier stages roll a chance.
  const guaranteed = clampStage(getStage(player)) >= STAGE_MAX;
  if (!guaranteed && Math.random() > SPAWN_CHANCE) return;

  if (spawnMarauder(player, getStage(player), false)) {
    player.setDynamicProperty("marauder:lastAttemptDay", day);
  }
}

function safeGameMode(player) {
  try { return player.getGameMode?.(); } catch (e) { return undefined; }
}

function hasActive(player) {
  return player.dimension.getEntities({ type: MARAUDER })
    .some(e => e.getDynamicProperty("marauder:owner") === player.id);
}

// ------------------------------------------------------------- spawning

function spawnMarauder(player, stage, immediate) {
  stage = clampStage(stage);
  const loc = findSafeNear(player.dimension, player.location, immediate ? 5 : 12);
  let ent;
  try {
    ent = player.dimension.spawnEntity(MARAUDER, loc);
  } catch (e) {
    return false;
  }
  ent.setDynamicProperty("marauder:owner", player.id);
  applyStage(ent, stage);
  challengeCue(player, stage);
  return true;
}

function applyStage(ent, stage) {
  stage = clampStage(stage);
  ent.setDynamicProperty("marauder:stageNum", stage);
  try { ent.setProperty("marauder:stage", stage); } catch (e) {}
  try { ent.triggerEvent("marauder:set_stage_" + stage); } catch (e) {}
  if (stage >= 7) { try { ent.triggerEvent("marauder:become_boss"); } catch (e) {} }
  // Testing toggle: if free-for-all is armed world-wide, new marauders inherit it.
  if (world.getDynamicProperty("marauder:ffa") === true) {
    try { ent.triggerEvent("marauder:ffa_on"); } catch (e) {}
  }
  try { ent.nameTag = stageTitle(stage); } catch (e) {}
}

function findSafeNear(dim, base, distNear) {
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = distNear * (0.6 + Math.random() * 0.6);
    const x = Math.floor(base.x + Math.cos(a) * r);
    const z = Math.floor(base.z + Math.sin(a) * r);
    for (let dy = 3; dy >= -4; dy--) {
      const y = Math.floor(base.y) + dy;
      try {
        const feet = dim.getBlock({ x, y, z });
        const head = dim.getBlock({ x, y: y + 1, z });
        const ground = dim.getBlock({ x, y: y - 1, z });
        if (feet && head && ground && feet.isAir && head.isAir && !ground.isAir) {
          return { x: x + 0.5, y, z: z + 0.5 };
        }
      } catch (e) { /* unloaded chunk */ }
    }
  }
  return { x: base.x + distNear * 0.5, y: base.y, z: base.z };
}

function challengeCue(player, stage) {
  try {
    player.onScreenDisplay.setTitle("§4The Marauder has found you.", {
      fadeInDuration: 8, stayDuration: 40, fadeOutDuration: 16, subtitle: stageTitle(stage)
    });
  } catch (e) {}
  try { player.playSound("mob.wither.spawn"); } catch (e) {}
  try { player.dimension.playSound("mob.enderdragon.growl", player.location); } catch (e) {}
}

// ------------------------------------------------------------- combat driver
//
// A light per-marauder ability state machine. Melee approach/hits are handled by
// the behavior JSON; this adds telegraphed abilities (played through the "cast"
// animation) and keeps orphaned marauders from lingering.

const ABILITIES = [
  { id: "shock",  minStage: 1, min: 0.0, max: 4.5,  windup: 12, recover: 10, cd: 70,  weight: 10 },
  { id: "guard",  minStage: 2, min: 0.0, max: 4.0,  windup: 10, recover: 8,  cd: 90,  weight: 8  },
  { id: "lunge",  minStage: 2, min: 4.0, max: 9.0,  windup: 8,  recover: 8,  cd: 55,  weight: 10 },
  { id: "cinder", minStage: 5, min: 0.0, max: 5.5,  windup: 14, recover: 10, cd: 100, weight: 8  },
  { id: "brand",  minStage: 5, min: 3.0, max: 16.0, windup: 16, recover: 8,  cd: 150, weight: 5  },
  { id: "flash",  minStage: 6, min: 6.0, max: 20.0, windup: 10, recover: 8,  cd: 110, weight: 9  },
  { id: "beam",   minStage: 7, min: 4.0, max: 20.0, windup: 20, recover: 12, cd: 100, weight: 9  },
];

// entityId -> { cooldowns, globalCd, current, swingUntil }
const combat = new Map();

function stateFor(ent) {
  let s = combat.get(ent.id);
  if (!s) {
    s = { cooldowns: {}, globalCd: 40, current: null, swingUntil: 0 };
    combat.set(ent.id, s);
  }
  return s;
}

system.runInterval(() => {
  const dim = world.getDimension(OVERWORLD);
  let marauders;
  try { marauders = dim.getEntities({ type: MARAUDER }); } catch (e) { return; }
  const now = system.currentTick;
  const alive = new Set();
  for (const ent of marauders) {
    if (!isValid(ent)) continue;
    alive.add(ent.id);
    try { tickCombat(ent, now); } catch (e) { /* keep loop alive */ }
  }
  // Drop combat state for marauders that no longer exist.
  for (const id of combat.keys()) {
    if (!alive.has(id)) combat.delete(id);
  }
}, COMBAT_INTERVAL);

function ownerOf(ent) {
  const id = ent.getDynamicProperty("marauder:owner");
  if (!id) return null;
  return world.getAllPlayers().find(p => p.id === id) || null;
}

function tickCombat(ent, now) {
  const s = stateFor(ent);

  // Clear a finished melee swing.
  if (s.swingUntil && now >= s.swingUntil) {
    s.swingUntil = 0;
    setAttacking(ent, false);
  }

  const owner = ownerOf(ent);
  // Leash: if the owner is gone or very far, the marauder melts away.
  if (owner) {
    if (owner.dimension.id !== ent.dimension.id || dist(owner.location, ent.location) > LEASH_RANGE) {
      retreat(ent);
      return;
    }
  }

  // Cool down abilities.
  if (s.globalCd > 0) s.globalCd -= COMBAT_INTERVAL;
  for (const k of Object.keys(s.cooldowns)) {
    s.cooldowns[k] -= COMBAT_INTERVAL;
    if (s.cooldowns[k] <= 0) delete s.cooldowns[k];
  }

  // Advance an in-progress ability.
  if (s.current) {
    advanceAbility(ent, s, now);
    return;
  }

  const target = pickTarget(ent, owner);
  if (!target) return;

  const d = dist(ent.location, target.location);
  if (s.globalCd > 0) return;

  const choice = chooseAbility(ent, d);
  if (choice) beginAbility(ent, s, choice, target, now);
}

function isFFA() {
  return world.getDynamicProperty("marauder:ffa") === true;
}

// Anything the marauder may legitimately fight: a live, non-creative player or
// any non-marauder mob. Used for the *current* target, which the AI (or an
// external mod like Brawl Stick, via hurt_by_target) may already have set to a
// mob — his abilities should follow whatever he is actually fighting.
function isEngageable(e) {
  if (!isValid(e) || e.typeId === MARAUDER) return false;
  if (e.typeId === "minecraft:player") {
    const gm = safeGameMode(e);
    return gm !== GameMode.creative && gm !== GameMode.spectator;
  }
  return true;
}

// Whether the marauder is presently fighting a non-player mob.
function currentTargetIsMob(ent) {
  try {
    const t = ent.target;
    return !!t && t.typeId !== "minecraft:player" && t.typeId !== MARAUDER;
  } catch (e) { return false; }
}

function pickTarget(ent, owner) {
  const ffa = isFFA();
  // Aim abilities at whatever the entity's own AI is actually fighting — this
  // is what makes Brawl Stick / any hurt_by_target-based mod work: once he has
  // been goaded onto a mob, his abilities lock onto it too.
  let aiTarget = null;
  try { aiTarget = ent.target; } catch (e) {}
  if (aiTarget && isEngageable(aiTarget) && dist(ent.location, aiTarget.location) <= CHALLENGE_RANGE + 6) {
    return aiTarget;
  }
  // In a normal duel, keep the pressure on the owning player.
  if (!ffa && owner && safeGameMode(owner) !== GameMode.creative && safeGameMode(owner) !== GameMode.spectator
      && dist(owner.location, ent.location) <= CHALLENGE_RANGE + 6) {
    return owner;
  }
  // Otherwise fall back to the nearest valid mark.
  let best = null, bestD = Infinity;
  for (const v of victimsNear(ent, CHALLENGE_RANGE)) {
    const d = dist(ent.location, v.location);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function chooseAbility(ent, d) {
  const stage = ent.getDynamicProperty("marauder:stageNum") ?? 1;
  const s = stateFor(ent);
  const pool = [];
  let total = 0;
  for (const a of ABILITIES) {
    if (a.minStage > stage) continue;
    if (s.cooldowns[a.id] > 0) continue;
    if (d < a.min || d > a.max) continue;
    pool.push(a);
    total += a.weight;
  }
  if (pool.length === 0) return null;
  let roll = Math.random() * total;
  for (const a of pool) {
    roll -= a.weight;
    if (roll < 0) return a;
  }
  return pool[pool.length - 1];
}

function beginAbility(ent, s, ability, target, now) {
  s.current = { ability, tick: 0, targetId: target.id, fired: false };
  setCasting(ent, true);
  faceTarget(ent, target);
  telegraphStart(ent, ability);
}

function advanceAbility(ent, s, now) {
  const cur = s.current;
  cur.tick += COMBAT_INTERVAL;
  const a = cur.ability;
  const target = resolveTargetId(ent, cur.targetId);

  if (cur.tick < a.windup) {
    // Wind-up: telegraph particles, keep facing the mark.
    if (target) faceTarget(ent, target);
    telegraphTick(ent, a);
    return;
  }

  if (!cur.fired) {
    cur.fired = true;
    if (target) {
      faceTarget(ent, target);
      try { fireAbility(ent, a, target); } catch (e) {}
    }
    return;
  }

  if (cur.tick >= a.windup + a.recover) {
    s.current = null;
    s.cooldowns[a.id] = a.cd;
    s.globalCd = 25 + Math.floor(Math.random() * 25);
    setCasting(ent, false);
  }
}

function resolveTargetId(ent, id) {
  try {
    const near = ent.dimension.getEntities({ location: ent.location, maxDistance: CHALLENGE_RANGE + 12 });
    return near.find(e => e.id === id && isValid(e)) || null;
  } catch (e) { return null; }
}

// ------------------------------------------------------------- ability effects

function fireAbility(ent, a, target) {
  const stage = ent.getDynamicProperty("marauder:stageNum") ?? 1;
  const base = stageDamage(stage);
  switch (a.id) {
    case "shock":  effectShock(ent, target, base); break;
    case "guard":  effectGuard(ent, target, base); break;
    case "lunge":  effectLunge(ent, target, base); break;
    case "cinder": effectCinder(ent, target, base); break;
    case "brand":  effectBrand(ent, target); break;
    case "flash":  effectFlash(ent, target, base); break;
    case "beam":   effectBeam(ent, target, base, a.max); break;
  }
}

function effectShock(ent, target, base) {
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:basic_flame_particle", 2.0, 18);
  try { ent.dimension.playSound("random.explode", loc); } catch (e) {}
  for (const p of victimsNear(ent, 4.0)) {
    hurt(p, ent, base + 2);
    knockFrom(p, loc, 1.0, 0.45);
  }
}

function effectGuard(ent, target, base) {
  if (dist(ent.location, target.location) > 4.5) return;
  hurt(target, ent, base * 1.4);
  knockFrom(target, ent.location, 1.1, 0.5);
  try { ent.dimension.playSound("item.shield.block", target.location); } catch (e) {}
}

function effectLunge(ent, target, base) {
  const dir = norm(sub(target.location, ent.location));
  try { ent.applyKnockback(dir.x, dir.z, 1.3, 0.25); } catch (e) {}
  // Land the blow a beat after the leap.
  system.runTimeout(() => {
    if (!isValid(ent) || !isValid(target)) return;
    if (dist(ent.location, target.location) < 3.2) {
      hurt(target, ent, base);
      knockFrom(target, ent.location, 0.5, 0.35);
    }
  }, 6);
}

function effectCinder(ent, target, base) {
  const fwd = norm(sub(target.location, ent.location));
  for (let i = 1; i <= 5; i++) {
    const p = { x: ent.location.x + fwd.x * i, y: ent.location.y + 0.4, z: ent.location.z + fwd.z * i };
    trySpawnParticle(ent.dimension, "minecraft:basic_flame_particle", p);
  }
  for (const p of victimsNear(ent, 5.0)) {
    const to = norm(sub(p.location, ent.location));
    if (fwd.x * to.x + fwd.z * to.z > 0.55) {
      hurt(p, ent, base * 0.9);
      try { p.setOnFire(3, true); } catch (e) {}
    }
  }
  try { ent.dimension.playSound("mob.blaze.shoot", ent.location); } catch (e) {}
}

function effectBrand(ent, target) {
  try { target.addEffect("slowness", 120, { amplifier: 1 }); } catch (e) {}
  try { target.addEffect("weakness", 120, { amplifier: 0 }); } catch (e) {}
  try { ent.addEffect("speed", 120, { amplifier: 1 }); } catch (e) {}
  trySpawnParticle(ent.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 1, z: target.location.z });
  try { ent.dimension.playSound("mob.wither.shoot", target.location); } catch (e) {}
}

function effectFlash(ent, target, base) {
  // Flash-step behind the target and strike.
  const look = norm(sub(target.location, ent.location));
  const dest = { x: target.location.x - look.x * 2.2, y: target.location.y, z: target.location.z - look.z * 2.2 };
  const safe = findSafeNear(ent.dimension, dest, 1.5);
  spawnRing(ent.dimension, ent.location, "minecraft:endrod", 1.2, 16);
  try { ent.teleport(safe); } catch (e) {}
  spawnRing(ent.dimension, safe, "minecraft:endrod", 1.2, 16);
  try { ent.dimension.playSound("mob.endermen.portal", safe); } catch (e) {}
  system.runTimeout(() => {
    if (!isValid(ent) || !isValid(target)) return;
    if (dist(ent.location, target.location) < 3.5) {
      hurt(target, ent, base);
      knockFrom(target, ent.location, 0.5, 0.4);
    }
  }, 6);
}

function effectBeam(ent, target, base, range) {
  const start = { x: ent.location.x, y: ent.location.y + 1.2, z: ent.location.z };
  const dir = norm(sub({ x: target.location.x, y: target.location.y + 1, z: target.location.z }, start));
  for (let i = 1; i <= range; i++) {
    const p = { x: start.x + dir.x * i, y: start.y + dir.y * i, z: start.z + dir.z * i };
    trySpawnParticle(ent.dimension, "minecraft:endrod", p);
  }
  try { ent.dimension.playSound("mob.evocation_illager.cast_spell", start); } catch (e) {}
  // Damage anything roughly along the beam line.
  for (const p of victimsNear(ent, range)) {
    const to = sub({ x: p.location.x, y: p.location.y + 1, z: p.location.z }, start);
    const proj = to.x * dir.x + to.y * dir.y + to.z * dir.z;
    if (proj <= 0) continue;
    const closest = { x: start.x + dir.x * proj, y: start.y + dir.y * proj, z: start.z + dir.z * proj };
    if (dist(closest, { x: p.location.x, y: p.location.y + 1, z: p.location.z }) < 1.6) {
      hurt(p, ent, base * 1.2);
    }
  }
}

// ------------------------------------------------------------- telegraphs

function telegraphStart(ent, a) {
  try {
    const pitch = a.id === "beam" || a.id === "brand" ? 1.4 : 0.6;
    ent.dimension.playSound("mob.wither.ambient", ent.location, { pitch, volume: 0.7 });
  } catch (e) {}
}

function telegraphTick(ent, a) {
  if (system.currentTick % 2 !== 0) return;
  const head = { x: ent.location.x, y: ent.location.y + 1.6, z: ent.location.z };
  const particle = a.id === "cinder" ? "minecraft:basic_flame_particle"
    : a.id === "beam" ? "minecraft:endrod"
    : "minecraft:soul_particle";
  trySpawnParticle(ent.dimension, particle, head);
}

// ------------------------------------------------------------- combat helpers

// Everything an AoE ability may strike: players always, other mobs when
// free-for-all is armed OR he is presently fighting a mob (e.g. a Brawl Stick
// grudge). Never the marauder itself or another marauder.
function victimsNear(ent, range) {
  const includeMobs = isFFA() || currentTargetIsMob(ent);
  const out = [];
  const seen = new Set();
  for (const p of ent.dimension.getEntities({ type: "minecraft:player", location: ent.location, maxDistance: range })) {
    if (isEngageable(p)) { out.push(p); seen.add(p.id); }
  }
  if (includeMobs) {
    let mobs = [];
    try {
      mobs = ent.dimension.getEntities({ location: ent.location, maxDistance: range, families: ["mob"], excludeFamilies: ["marauder"] });
    } catch (e) { mobs = []; }
    for (const m of mobs) {
      if (m.id === ent.id || seen.has(m.id) || m.typeId === "minecraft:player") continue;
      if (isValid(m)) { out.push(m); seen.add(m.id); }
    }
  }
  return out;
}

function hurt(entity, source, amount) {
  try {
    entity.applyDamage(Math.max(1, Math.round(amount)), { cause: EntityDamageCause.entityAttack, damagingEntity: source });
  } catch (e) {}
}

function knockFrom(entity, from, horizontal, vertical) {
  const dx = entity.location.x - from.x;
  const dz = entity.location.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  try { entity.applyKnockback(dx / l, dz / l, horizontal, vertical); } catch (e) {}
}

function faceTarget(ent, target) {
  // Entity has no lookAt(); teleporting in place with a facingLocation turns the
  // marauder to aim at its mark during a telegraph without moving it.
  try {
    ent.teleport(ent.location, {
      facingLocation: { x: target.location.x, y: target.location.y + 1, z: target.location.z }
    });
  } catch (e) {}
}

function setAttacking(ent, v) {
  try { if (isValid(ent)) ent.setProperty("marauder:attacking", v); } catch (e) {}
}
function setCasting(ent, v) {
  try { if (isValid(ent)) ent.setProperty("marauder:casting", v); } catch (e) {}
}

function retreat(ent) {
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:soul_particle", 1.2, 24);
  try { ent.dimension.playSound("mob.endermen.portal", loc); } catch (e) {}
  combat.delete(ent.id);
  try { ent.remove(); } catch (e) {}
}

function spawnRing(dim, loc, particle, radius, count) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const p = { x: loc.x + Math.cos(a) * radius, y: loc.y + 0.2, z: loc.z + Math.sin(a) * radius };
    trySpawnParticle(dim, particle, p);
  }
}

function trySpawnParticle(dim, particle, loc) {
  try { dim.spawnParticle(particle, loc); } catch (e) {}
}

// ------------------------------------------------------------- melee swing anim
//
// The behavior pack's melee_attack handles the actual hit; we listen for it and
// raise the "attacking" property so the swing animation plays — the Bedrock
// analog of the Java entity triggering its "attack" animation on a landed hit.

world.afterEvents.entityHitEntity?.subscribe(ev => {
  const attacker = ev.damagingEntity;
  if (!attacker) return;

  if (attacker.typeId === MARAUDER) {
    const s = stateFor(attacker);
    if (!s.current) { // don't stomp a cast in progress
      setAttacking(attacker, true);
      s.swingUntil = system.currentTick + SWING_TICKS;
    }
    return;
  }

  // Blacksteel Blade: a night-time cut carries the curse (glow + lifesteal).
  if (attacker.typeId === "minecraft:player") {
    const hit = ev.hitEntity;
    if (!hit || !isNight()) return;
    let held;
    try { held = attacker.getComponent("minecraft:equippable")?.getEquipment?.("Mainhand"); } catch (e) {}
    if (held && held.typeId === "marauder:blacksteel_blade") {
      try { hit.addEffect("glowing", 60, { amplifier: 0 }); } catch (e) {}
      try { attacker.addEffect("regeneration", 40, { amplifier: 1 }); } catch (e) {}
    }
  }
});

// ------------------------------------------------------------- ashen remnant use

world.afterEvents.itemUse?.subscribe(ev => {
  const player = ev.source;
  const item = ev.itemStack;
  if (!player || !item || item.typeId !== "marauder:ashen_remnant") return;
  if (!getFlag(player, "marauder:finalComplete")) {
    try { player.onScreenDisplay.setActionBar("§8The remnant is cold. The rivalry is not yet finished."); }
    catch (e) { try { player.sendMessage("§8The remnant is cold. The rivalry is not yet finished."); } catch (e2) {} }
    return;
  }
  player.setDynamicProperty("marauder:rematchArmed", true);
  setStage(player, STAGE_MAX);
  try { player.dimension.playSound("mob.wither.spawn", player.location, { pitch: 0.5 }); } catch (e) {}
  try { player.sendMessage("§7The ash stirs. The Marauder will answer on the next night."); } catch (e) {}
});

// ------------------------------------------------------------- defeat

world.afterEvents.entityDie.subscribe(ev => {
  const dead = ev.deadEntity;
  if (!dead || dead.typeId !== MARAUDER) return;
  combat.delete(dead.id);
  try { handleDefeat(dead, ev.damageSource); } catch (e) {}
});

function handleDefeat(dead, source) {
  const stage = clampStage(dead.getDynamicProperty("marauder:stageNum") ?? 1);
  const ownerId = dead.getDynamicProperty("marauder:owner");
  const dim = dead.dimension;
  const loc = dead.location;

  dropRewards(dim, loc, stage);
  try { dim.spawnParticle("minecraft:soul_particle", { x: loc.x, y: loc.y + 0.8, z: loc.z }); } catch (e) {}

  let owner = ownerId ? world.getAllPlayers().find(p => p.id === ownerId) : null;
  const killer = source && source.damagingEntity;
  if (!owner && killer && killer.typeId === "minecraft:player") owner = killer;
  if (!owner) return;

  // Anti-cheese: only a player kill advances the rivalry.
  if (!killer || killer.typeId !== "minecraft:player") {
    owner.sendMessage("§7The Marauder was slain by another hand. Your rivalry is unchanged.");
    return;
  }

  if (stage >= STAGE_MAX) {
    owner.setDynamicProperty("marauder:finalComplete", true);
    owner.setDynamicProperty("marauder:rematchArmed", false);
    owner.sendMessage("§6The Marauder Ascendant falls. The ten-night rivalry is over.");
    owner.sendMessage("§8An Ashen Remnant remains — should you ever wish to face him again.");
  } else {
    setStage(owner, Math.max(getStage(owner), stage + 1));
    owner.sendMessage("§cThe Marauder falls — but he will return, stronger.");
  }
}

function dropRewards(dim, loc, stage) {
  const drop = (id, n) => { try { dim.spawnItem(new ItemStack(id, n), loc); } catch (e) {} };
  drop("marauder:dark_scrap", 1 + Math.floor(Math.random() * 2));
  if (stage >= 3) drop("marauder:blacksteel_fragment", 1 + Math.floor(Math.random() * 2));
  if (stage >= 5) drop("marauder:ashen_shard", 1);
  if (stage >= 6) drop("marauder:moon_shard", 1);
  if (stage >= 7) drop("marauder:rune_fragment", 1);
  if (stage >= 8) drop("marauder:abyss_fragment", 1);
  if (stage >= 9) drop("marauder:unbroken_core", 1);
  if (stage >= STAGE_MAX) {
    drop("marauder:blacksteel_blade", 1);
    drop("marauder:marauder_trophy", 1);
    drop("marauder:ashen_remnant", 1);
  }
}

// ------------------------------------------------------------- test commands

// Run in-game as: /scriptevent marauder:duel 3
system.afterEvents.scriptEventReceive.subscribe(ev => {
  if (!ev.id.startsWith("marauder:")) return;
  const src = ev.sourceEntity;
  const player = (src && src.typeId === "minecraft:player") ? src : world.getAllPlayers()[0];
  if (!player) return;
  const arg = parseInt(ev.message);

  switch (ev.id) {
    case "marauder:spawn":
      clearActive(player);
      spawnMarauder(player, isNaN(arg) ? getStage(player) : arg, false);
      break;
    case "marauder:duel":
      clearActive(player);
      spawnMarauder(player, isNaN(arg) ? getStage(player) : arg, true);
      break;
    case "marauder:setstage":
      setStage(player, isNaN(arg) ? 1 : arg);
      player.sendMessage("§eMarauder stage set to " + getStage(player) + ".");
      break;
    case "marauder:stage":
      player.sendMessage("§7Stage " + getStage(player)
        + ", finalComplete=" + getFlag(player, "marauder:finalComplete"));
      break;
    case "marauder:reset":
      resetProgress(player);
      clearActive(player);
      player.sendMessage("§eMarauder rivalry reset to Stage 1.");
      break;
    case "marauder:rematch":
      player.setDynamicProperty("marauder:finalComplete", true);
      player.setDynamicProperty("marauder:rematchArmed", true);
      setStage(player, 10);
      player.sendMessage("§5Rematch armed. The Marauder Ascendant returns next night.");
      break;
    case "marauder:clear":
      player.sendMessage("§7Cleared " + clearActive(player) + " Marauder(s).");
      break;
    case "marauder:freeforall":
    case "marauder:ffa":
      setFreeForAll(player, ev.message);
      break;
  }
});

// Testing helper: toggle whether marauders attack any mob (and are hunted back),
// not just the owning player. Usage: /scriptevent marauder:freeforall on|off
// (bare "/scriptevent marauder:freeforall" flips the current state).
function setFreeForAll(player, message) {
  const msg = (message || "").trim().toLowerCase();
  let on;
  if (msg === "") on = !(world.getDynamicProperty("marauder:ffa") === true);
  else on = /^(on|1|true|yes|enable|enabled)$/.test(msg);

  world.setDynamicProperty("marauder:ffa", on);

  let n = 0;
  for (const e of world.getDimension(OVERWORLD).getEntities({ type: MARAUDER })) {
    try { e.triggerEvent(on ? "marauder:ffa_on" : "marauder:ffa_off"); n++; } catch (err) {}
  }
  player.sendMessage(
    "§dMarauder free-for-all " + (on ? "§aENABLED" : "§cDISABLED")
    + " §7(" + n + " active updated). Marauders " + (on ? "now attack any mob and fight back." : "target only players again.")
  );
}

function clearActive(player) {
  let n = 0;
  for (const e of player.dimension.getEntities({ type: MARAUDER })) {
    if (e.getDynamicProperty("marauder:owner") === player.id) {
      combat.delete(e.id);
      try { e.remove(); n++; } catch (err) {}
    }
  }
  return n;
}

// ------------------------------------------------------------- misc

function stageTitle(stage) {
  const names = [
    "", "Rusted Challenger", "Scarred Pursuer", "Oathbound Duelist", "Blacksteel Marauder",
    "Ashen Knight", "Moonlit Executioner", "Spellscarred Knight", "Abyss-Touched Marauder",
    "The Unbroken", "The Marauder Ascendant"
  ];
  return "The Marauder — " + (names[clampStage(stage)] || "");
}

system.run(() => {
  console.warn("[Marauder] Bedrock addon loaded. The hunt begins at dusk.");
});
