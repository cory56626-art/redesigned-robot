import { world, system, GameMode, EntityDamageCause, EquipmentSlot, ItemStack, BlockPermutation } from "@minecraft/server";

// The Marauder — Bedrock Script API port (v3, reworked combat).
//
// The entity's *physical* AI (pathing, target acquisition, melee) lives in the
// behavior JSON. This script layers on what Bedrock behaviors cannot do alone:
// per-player staged progression, a night manager, telegraphed abilities, the
// afterimage/mirage set-piece, and defeat/reward handling.
//
// Combat targeting no longer relies on the flaky Entity.target getter — instead
// it tracks aggro from the entityHurt event, so the marauder uses his abilities
// against whatever he is actually fighting (players, or mobs via Brawl Stick).
//
// Server-authoritative. Test hooks are exposed via /scriptevent.

const OVERWORLD = "minecraft:overworld";
const MARAUDER = "marauder:marauder";
const AFTERIMAGE = "marauder:afterimage";
const FRACTURED = "marauder:fractured_marauder";
const STAGE_MAX = 10;

// --- The Fractured Marauder (challenge variant) ---
const FRACTURED_CHANCE = 0.12;      // chance the stage-10 encounter is Fractured
const FRACTURE_GAIN_MELEE = 8;      // meter gain per landed melee hit
const FRACTURE_GAIN_ABILITY = 5;    // meter gain per scripted-ability hit
const FRACTURE_DECAY = 0.4;         // meter lost per combat tick while Seraphim
const FRACTURED_ABILITY_MULT = 1.25;// his abilities hit harder than stage 10's

const CHECK_INTERVAL = 40;   // night manager cadence (ticks)
const COMBAT_INTERVAL = 2;   // combat/ability driver cadence (ticks)
const SPAWN_CHANCE = 0.12;   // per-check chance once eligible
const CHALLENGE_RANGE = 16;  // engagement radius
const LEASH_RANGE = 96;      // beyond this from its owner the marauder gives up
const AGGRO_TICKS = 120;     // how long a mob/player that hit him stays his mark

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

function stageDamage(stage) { return STAGE_DAMAGE[clampStage(stage)] || 4; }

function isMobId(e) {
  if (!e) return false;
  const t = e.typeId;
  return t && t !== "minecraft:player" && !isMarauderKind(t);
}

// Both boss variants share the combat driver; the afterimage is a prop, not a boss.
function isMarauderKind(typeId) {
  return typeId === MARAUDER || typeId === FRACTURED || typeId === AFTERIMAGE;
}
function isFractured(ent) { return ent?.typeId === FRACTURED; }
function isSeraph(ent) {
  try { return ent.getDynamicProperty("marauder:seraph") === true; } catch (e) { return false; }
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
function setStage(player, s) { player.setDynamicProperty("marauder:stage", clampStage(s)); }
function getFlag(player, key) { return player.getDynamicProperty(key) === true; }
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
function safeGameMode(player) {
  try { return player.getGameMode?.(); } catch (e) { return undefined; }
}

// ------------------------------------------------------------- night manager

// Track which subscriptions registered successfully so /scriptevent marauder:ping
// can report script health. This is the user's first line of defense when
// "the script doesn't seem to be working" — it tells them whether the load
// actually completed.
const _subsLoaded = {};

// Wrap an event subscribe call so a single failing subscription cannot prevent
// subsequent subscriptions (especially scriptEventReceive) from registering.
function safeSub(label, eventObj, fn) {
  try {
    if (!eventObj || typeof eventObj.subscribe !== "function") {
      console.warn(`[Marauder] ${label}: event unavailable on this API version`);
      return;
    }
    eventObj.subscribe(fn);
    _subsLoaded[label] = true;
  } catch (err) {
    console.warn(`[Marauder] ${label} subscribe failed: ${err?.stack || err}`);
  }
}

try {
  system.runInterval(() => {
    if (!isNight()) return;
    const day = currentDay();
    for (const player of world.getAllPlayers()) {
      try { tryEncounter(player, day); } catch (e) { /* keep the loop alive */ }
    }
  }, CHECK_INTERVAL);
  _subsLoaded.nightInterval = true;
} catch (err) {
  console.warn(`[Marauder] night runInterval failed: ${err?.stack || err}`);
}

function tryEncounter(player, day) {
  if (player.dimension.id !== OVERWORLD) return;
  const gm = safeGameMode(player);
  if (gm === GameMode.creative || gm === GameMode.spectator) return;

  const finalDone = getFlag(player, "marauder:finalComplete");
  const rematch = getFlag(player, "marauder:rematchArmed");
  if (finalDone && !rematch) return;
  if (player.getDynamicProperty("marauder:lastAttemptDay") === day) return;
  if (hasActive(player)) return;
  const guaranteed = clampStage(getStage(player)) >= STAGE_MAX;
  if (!guaranteed && Math.random() > SPAWN_CHANCE) return;

  if (spawnMarauder(player, getStage(player), false)) {
    player.setDynamicProperty("marauder:lastAttemptDay", day);
  }
}

function hasActive(player) {
  const mine = e => e.getDynamicProperty("marauder:owner") === player.id;
  return player.dimension.getEntities({ type: MARAUDER }).some(mine)
    || player.dimension.getEntities({ type: FRACTURED }).some(mine);
}

// ------------------------------------------------------------- spawning

function spawnMarauder(player, stage, immediate, forceFractured) {
  stage = clampStage(stage);
  // The final night has a low chance of sending the Fractured Marauder instead.
  const fractured = forceFractured === true
    || (forceFractured !== false && stage >= STAGE_MAX && Math.random() < FRACTURED_CHANCE);
  const loc = findSafeNear(player.dimension, player.location, immediate ? 5 : 12);
  let ent;
  try {
    ent = player.dimension.spawnEntity(fractured ? FRACTURED : MARAUDER, loc);
  } catch (e) {
    return false;
  }
  ent.setDynamicProperty("marauder:owner", player.id);
  if (fractured) initFractured(ent); else applyStage(ent, stage);
  challengeCue(player, stage, fractured);
  return true;
}

function applyStage(ent, stage) {
  stage = clampStage(stage);
  ent.setDynamicProperty("marauder:stageNum", stage);
  // Reset per-encounter dynamic properties for the new mechanics. A freshly
  // spawned Marauder hasn't shattered his halo or used his last-stand revive yet,
  // and his enrage tier should be 1 (full armor) at full HP.
  ent.setDynamicProperty("marauder:haloShattered", false);
  ent.setDynamicProperty("marauder:lastStandUsed", false);
  ent.setDynamicProperty("marauder:enrageTier", 1);
  // Reset the per-encounter visual properties too.
  try { ent.setProperty("marauder:kneeling", false); } catch (e) {}
  try { ent.setProperty("marauder:omni", false); } catch (e) {}
  try { ent.setProperty("marauder:last_stand", false); } catch (e) {}

  try { ent.setProperty("marauder:stage", stage); } catch (e) {}
  try { ent.triggerEvent("marauder:set_stage_" + stage); } catch (e) {}
  if (stage >= 7) { try { ent.triggerEvent("marauder:become_boss"); } catch (e) {} }
  if (world.getDynamicProperty("marauder:ffa") === true) {
    try { ent.triggerEvent("marauder:ffa_on"); } catch (e) {}
  }
  updateTitle(ent);
}

// The Fractured Marauder is its own thing: stage-10-equivalent stats live in his
// entity JSON; the script only tracks his Fracture meter and encounter flags.
function initFractured(ent) {
  ent.setDynamicProperty("marauder:stageNum", STAGE_MAX); // ability damage baseline
  ent.setDynamicProperty("marauder:fracture", 0);
  ent.setDynamicProperty("marauder:seraph", false);
  ent.setDynamicProperty("marauder:haloShattered", true); // halo shatter is the normal boss's set-piece
  ent.setDynamicProperty("marauder:lastStandUsed", false);
  ent.setDynamicProperty("marauder:enrageTier", 1);
  try { ent.setProperty("marauder:fracture_stage", 0); } catch (e) {}
  try { ent.setProperty("marauder:kneeling", false); } catch (e) {}
  try { ent.setProperty("marauder:omni", false); } catch (e) {}
  try { ent.setProperty("marauder:last_stand", false); } catch (e) {}
  try { ent.triggerEvent("marauder:become_boss"); } catch (e) {}
  if (world.getDynamicProperty("marauder:ffa") === true) {
    try { ent.triggerEvent("marauder:ffa_on"); } catch (e) {}
  }
  updateTitle(ent);
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

// Two-beat cinematic arrival. A soft action-bar pre-warn, then a SHORT centered
// title a beat later so it never clips off-screen / TV overscan, with a single
// low cue instead of two loud sounds stacked. The subtitle carries the stage name.
function challengeCue(player, stage, fractured) {
  // Beat 1 — subtle warning near the hotbar (always visible, never clipped).
  const warn = fractured ? "§8. . . §fthe air splinters with light §8. . ."
                         : "§8. . . §7a dread presence draws near §8. . .";
  try { player.onScreenDisplay.setActionBar(warn); } catch (e) {}
  try { player.playSound("mob.wither.ambient", { pitch: 0.6, volume: 0.5 }); } catch (e) {}

  // Beat 2 — a short, smooth title a beat later. Long fades = no jarring pop.
  system.runTimeout(() => {
    if (!isValid(player)) return;
    try {
      player.onScreenDisplay.setTitle(fractured ? "§e⚔ §fThe Fractured Marauder" : "§4⚔ §cThe Marauder", {
        fadeInDuration: 12, stayDuration: 50, fadeOutDuration: 20,
        subtitle: fractured ? "§6Something is wrong with him." : "§7" + stageName(stage)
      });
    } catch (e) {}
    try { player.playSound("mob.wither.spawn", { pitch: fractured ? 1.1 : 0.8, volume: 0.7 }); } catch (e) {}
  }, 18);
}

// ------------------------------------------------------------- boss-bar readout
//
// The boss bar mirrors the entity nameTag (the JSON boss component no longer
// pins a fixed name), so this doubles as a live phase readout: enrage tier,
// halo shatter, last stand — and for the Fractured Marauder, his Fracture meter.
function updateTitle(ent) {
  try {
    if (ent.typeId === FRACTURED) {
      const m = Math.round(ent.getDynamicProperty("marauder:fracture") ?? 0);
      const bars = Math.round(m / 10);
      const meter = "§e" + "|".repeat(bars) + "§8" + "|".repeat(10 - bars);
      ent.nameTag = isSeraph(ent)
        ? `§6✧ SERAPHIM ✧ §f${meter} §6✧`
        : `§fThe Fractured Marauder §7— ${meter} §7${m}%`;
      return;
    }
    const stage = clampStage(ent.getDynamicProperty("marauder:stageNum") ?? 1);
    let suffix = "";
    const s = combat.get(ent.id);
    if (s && s.phaseLock) suffix = " §7— §eHALO SHATTERED";
    else if (ent.getDynamicProperty("marauder:lastStandUsed") === true) suffix = " §7— §4LAST STAND";
    else {
      const tier = ent.getDynamicProperty("marauder:enrageTier") ?? 1;
      if (tier === 4) suffix = " §7— §cBerserk";
      else if (tier === 3) suffix = " §7— §6Frenzied";
      else if (tier === 2) suffix = " §7— §eEnraged";
    }
    ent.nameTag = "§c" + stageTitle(stage) + suffix;
  } catch (e) {}
}

// ------------------------------------------------------------- combat driver

// `only` restricts an ability to one variant ("marauder" | "fractured");
// `noSeraph` marks Fractured moves that are sealed while he is transformed.
const ABILITIES = [
  { id: "shock",  minStage: 1, min: 0.0, max: 5.0,  windup: 10, recover: 8,  cd: 55,  weight: 10 },
  { id: "guard",  minStage: 2, min: 0.0, max: 4.5,  windup: 8,  recover: 6,  cd: 70,  weight: 8  },
  { id: "lunge",  minStage: 1, min: 3.5, max: 10.0, windup: 6,  recover: 6,  cd: 45,  weight: 11 },
  { id: "cinder", minStage: 3, min: 0.0, max: 6.0,  windup: 12, recover: 8,  cd: 80,  weight: 8  },
  { id: "mirage", minStage: 4, min: 0.0, max: 12.0, windup: 14, recover: 6,  cd: 280, weight: 6,  only: "marauder" },
  { id: "brand",  minStage: 4, min: 3.0, max: 16.0, windup: 14, recover: 6,  cd: 130, weight: 5  },
  { id: "flash",  minStage: 5, min: 5.0, max: 20.0, windup: 8,  recover: 6,  cd: 85,  weight: 9  },
  { id: "beam",   minStage: 6, min: 4.0, max: 22.0, windup: 16, recover: 10, cd: 80,  weight: 9  },
  { id: "omni",   minStage: 5, min: 0.0, max: 4.5,  windup: 8,  recover: 20, cd: 280, weight: 4,  only: "marauder" },
  // --- Fractured Marauder exclusives (sealed while Seraphim) ---
  { id: "grit",    minStage: 1, min: 0.0, max: 4.5,  windup: 9,  recover: 12, cd: 170, weight: 9, only: "fractured", noSeraph: true },
  { id: "skyfall", minStage: 1, min: 0.0, max: 7.0,  windup: 8,  recover: 24, cd: 220, weight: 8, only: "fractured", noSeraph: true },
];

// entityId -> { cooldowns, globalCd, current, swingUntil, aggroId, aggroTick, illusion, phaseLock }
const combat = new Map();

function stateFor(ent) {
  let s = combat.get(ent.id);
  if (!s) {
    s = { cooldowns: {}, globalCd: 20, current: null, swingUntil: 0, aggroId: null, aggroTick: -9999, illusion: null, phaseLock: false };
    combat.set(ent.id, s);
  }
  return s;
}

try {
  system.runInterval(() => {
    const dim = world.getDimension(OVERWORLD);
    let marauders;
    try {
      marauders = dim.getEntities({ type: MARAUDER });
      try { marauders = marauders.concat(dim.getEntities({ type: FRACTURED })); } catch (e2) {}
    } catch (e) { return; }
    const now = system.currentTick;
    const alive = new Set();
    const illusionIds = new Set();
    for (const ent of marauders) {
      if (!isValid(ent)) continue;
      alive.add(ent.id);
      try { tickCombat(ent, now); } catch (e) { /* keep loop alive */ }
      const s = combat.get(ent.id);
      if (s && s.illusion && s.illusion.active) illusionIds.add(ent.id);
    }
    // Drop combat state for marauders that no longer exist.
    for (const id of combat.keys()) if (!alive.has(id)) combat.delete(id);
    // Prune orphaned afterimages (their real marauder is gone or no longer casting).
    // Dodge phantoms have their own 20-tick lifetime managed by afterimageDodge(),
    // so we leave them alone here.
    try {
      for (const c of dim.getEntities({ type: AFTERIMAGE })) {
        if (c.getDynamicProperty("marauder:dodgePhantom") === true) continue;
        const rid = c.getDynamicProperty("marauder:realId");
        if (!rid || !illusionIds.has(rid)) { try { c.remove(); } catch (e) {} }
      }
    } catch (e) {}
  }, COMBAT_INTERVAL);
  _subsLoaded.combatInterval = true;
} catch (err) {
  console.warn(`[Marauder] combat runInterval failed: ${err?.stack || err}`);
}

function ownerOf(ent) {
  const id = ent.getDynamicProperty("marauder:owner");
  if (!id) return null;
  return world.getAllPlayers().find(p => p.id === id) || null;
}

function tickCombat(ent, now) {
  const s = stateFor(ent);

  // Clear a finished melee swing.
  if (s.swingUntil && now >= s.swingUntil) { s.swingUntil = 0; setAttacking(ent, false); }

  // Fractured Marauder: Seraphim decay + radiant aura.
  tickFracture(ent, s);

  // Unbroken-Core Revive — primary monitor. Catch him just above death and revive
  // BEFORE a killing blow lands (the stable API can't cancel the lethal hit itself).
  if (!s.phaseLock && ent.getDynamicProperty("marauder:lastStandUsed") !== true && healthPct(ent) <= 0.10) {
    tryLastStand(ent);
  }

  // Phase lock pauses all combat — used during Halo Shatter's invulnerable kneel.
  // We still tick the illusion timer so a set-piece can expire cleanly.
  if (s.phaseLock) {
    if (s.illusion && s.illusion.active && now >= s.illusion.endTick) endIllusion(ent, s);
    return;
  }

  // While an afterimage set-piece runs, the real Marauder keeps fighting
  // alongside his clones — only the illusion timer is checked here.
  if (s.illusion && s.illusion.active) {
    if (now >= s.illusion.endTick) endIllusion(ent, s);
  }

  const owner = ownerOf(ent);
  if (owner) {
    if (owner.dimension.id !== ent.dimension.id || dist(owner.location, ent.location) > LEASH_RANGE) {
      retreat(ent);
      return;
    }
  }

  if (s.globalCd > 0) s.globalCd -= COMBAT_INTERVAL;
  for (const k of Object.keys(s.cooldowns)) {
    s.cooldowns[k] -= COMBAT_INTERVAL;
    if (s.cooldowns[k] <= 0) delete s.cooldowns[k];
  }

  if (s.current) { advanceAbility(ent, s, now); return; }

  const target = pickTarget(ent, s, owner, now);
  if (!target) return;

  if (s.globalCd > 0) return;
  const d = dist(ent.location, target.location);
  const choice = chooseAbility(ent, d);
  if (choice) beginAbility(ent, s, choice, target, now);
}

// Robust target selection that does NOT depend on Entity.target: prefer whoever
// recently hit him (aggro — this is what makes Brawl Stick / mob fights use
// abilities), then the owning player, then the nearest valid mark.
function pickTarget(ent, s, owner, now) {
  const loc = ent.location;

  // 1) Recent attacker (mob or player) still nearby.
  if (s.aggroId && now - s.aggroTick <= AGGRO_TICKS) {
    const a = entityById(ent.dimension, s.aggroId);
    if (a && isEngageable(a) && dist(loc, a.location) <= CHALLENGE_RANGE + 4) return a;
  }
  // 2) The owning player, in a normal duel.
  if (owner && !isFFA()) {
    const gm = safeGameMode(owner);
    if (gm !== GameMode.creative && gm !== GameMode.spectator && dist(owner.location, loc) <= CHALLENGE_RANGE + 6) {
      return owner;
    }
  }
  // 3) Nearest valid mark within engagement range.
  let best = null, bestD = Infinity;
  for (const v of victimsNear(ent, CHALLENGE_RANGE, null, isFFA())) {
    const d = dist(loc, v.location);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function entityById(dim, id) {
  try {
    for (const e of dim.getEntities({})) if (e.id === id) return isValid(e) ? e : null;
  } catch (e) {}
  return null;
}

function isEngageable(e) {
  if (!isValid(e) || isMarauderKind(e.typeId)) return false;
  if (e.typeId === "minecraft:player") {
    const gm = safeGameMode(e);
    return gm !== GameMode.creative && gm !== GameMode.spectator;
  }
  return true;
}

function chooseAbility(ent, d) {
  const stage = ent.getDynamicProperty("marauder:stageNum") ?? 1;
  const s = stateFor(ent);
  const pool = [];
  let total = 0;
  const kind = isFractured(ent) ? "fractured" : "marauder";
  const seraph = kind === "fractured" && isSeraph(ent);
  for (const a of ABILITIES) {
    if (a.only && a.only !== kind) continue;
    if (a.noSeraph && seraph) continue;
    if (a.minStage > stage) continue;
    if (s.cooldowns[a.id] > 0) continue;
    if (d < a.min || d > a.max) continue;
    // Don't fire the omni-flurry mid-illusion — too chaotic.
    if (a.id === "omni" && s.illusion && s.illusion.active) continue;
    pool.push(a);
    total += a.weight;
  }
  if (pool.length === 0) return null;
  let roll = Math.random() * total;
  for (const a of pool) { roll -= a.weight; if (roll < 0) return a; }
  return pool[pool.length - 1];
}

function beginAbility(ent, s, ability, target, now) {
  s.current = { ability, tick: 0, targetId: target.id, fired: false };
  setCasting(ent, true);
  faceTarget(ent, target);
  // Omni-flurry: 20-tick movement lock via stun_on + drive the omni animation.
  if (ability.id === "omni") {
    try { ent.triggerEvent("marauder:stun_on"); } catch (e) {}
    try { ent.setProperty("marauder:omni", true); } catch (e) {}
    setCasting(ent, false);  // omni has its own animation, not the generic cast pose
  }
  // Unrivaled Grit is a FEINT: it must look like a normal sword swing, so the
  // only tells are the swing pose + a faint stance-shift sound (in telegraphStart).
  if (ability.id === "grit") {
    setCasting(ent, false);
    setAttacking(ent, true);
    s.swingUntil = now + ability.windup + 4;
  }
  telegraphStart(ent, ability);
}

function advanceAbility(ent, s, now) {
  const cur = s.current;
  cur.tick += COMBAT_INTERVAL;
  const a = cur.ability;
  const target = resolveTargetId(ent, cur.targetId);

  if (cur.tick < a.windup) {
    if (target) faceTarget(ent, target);
    telegraphTick(ent, a);
    return;
  }

  if (!cur.fired) {
    cur.fired = true;
    if (target) { faceTarget(ent, target); try { fireAbility(ent, a, target); } catch (e) {} }
    return;
  }

  if (cur.tick >= a.windup + a.recover) {
    s.current = null;
    s.cooldowns[a.id] = a.cd;
    s.globalCd = 14 + Math.floor(Math.random() * 16);
    setCasting(ent, false);
    // Omni cleanup: release the movement lock and clear the animation property.
    if (a.id === "omni") {
      try { ent.triggerEvent("marauder:stun_off"); } catch (e) {}
      try { ent.setProperty("marauder:omni", false); } catch (e) {}
    }
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
  let base = stageDamage(stage) * enrageTier(ent).damageMult;
  if (isFractured(ent)) base *= FRACTURED_ABILITY_MULT;
  switch (a.id) {
    case "shock":  effectShock(ent, target, base); break;
    case "guard":  effectGuard(ent, target, base); break;
    case "lunge":  effectLunge(ent, target, base); break;
    case "cinder": effectCinder(ent, target, base); break;
    case "mirage": effectMirage(ent, target); break;
    case "brand":  effectBrand(ent, target); break;
    case "flash":  effectFlash(ent, target, base); break;
    case "beam":   effectBeam(ent, target, base, a.max); break;
    case "omni":   effectOmni(ent, target); break;
    case "grit":    effectGrit(ent, target, base); break;
    case "skyfall": effectSkyfall(ent, target, base); break;
  }
}

// ============================================================= FRACTURED: UNRIVALED GRIT
// A feint. The wind-up looked like an ordinary sword swing (see beginAbility) —
// then he switches stances and drives a heavy blow into the jaw, stunning the
// victim. The only warnings were the stance-shift sound and the swing itself.
function effectGrit(ent, target, base) {
  const dim = ent.dimension;
  if (!isValid(target) || dist(ent.location, target.location) > 5.0) return;
  faceTarget(ent, target);
  // The stance switch: uppercut sound + crack, heavy damage, brief stun.
  try { dim.playSound("game.player.attack.strong", target.location, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  try { dim.playSound("random.anvil_land", target.location, { pitch: 1.6, volume: 0.6 }); } catch (e) {}
  const head = { x: target.location.x, y: target.location.y + 1.6, z: target.location.z };
  trySpawnParticle(dim, "minecraft:critical_hit_emitter", head);
  hurt(target, ent, base * 1.5);
  // "Stunned for a moment": rooted, weakened, vision swimming; a short pop upward.
  try { target.addEffect("slowness", 45, { amplifier: 4, showParticles: true }); } catch (e) {}
  try { target.addEffect("weakness", 60, { amplifier: 1, showParticles: false }); } catch (e) {}
  try { target.addEffect("nausea", 80, { amplifier: 0, showParticles: false }); } catch (e) {}
  try { target.applyKnockback(0, 0, 0, 0.45); } catch (e) {}
}

// ============================================================= FRACTURED: MIGHT & SKYFALL
// He hurls everything near him away with sheer might to buy distance, then a
// holy beam slams down from the sky onto the shoved target after a short
// telegraph — punishing anyone who just holds W back toward him.
function effectSkyfall(ent, target, base) {
  const dim = ent.dimension;
  const origin = ent.location;

  // 1. The mighty shove — everyone nearby is blasted back.
  spawnRing(dim, origin, "minecraft:knockback_roar_particle", 2.0, 16);
  try { dim.playSound("mob.irongolem.attack", origin, { pitch: 0.6, volume: 1.6 }); } catch (e) {}
  try { dim.playSound("random.explode", origin, { pitch: 1.3, volume: 0.8 }); } catch (e) {}
  for (const v of victimsNear(ent, 5.0, target, true)) {
    const away = norm({ x: v.location.x - origin.x, y: 0, z: v.location.z - origin.z });
    try { v.applyKnockback(away.x, away.z, 2.6, 0.5); } catch (e) {}
  }

  // 2. Lock the beam onto where the shoved target lands (sampled after the shove).
  const targetId = target?.id;
  system.runTimeout(() => {
    if (!isValid(ent)) return;
    const t = targetId ? entityById(ent.dimension, targetId) : null;
    const pos = t && isValid(t)
      ? { x: t.location.x, y: t.location.y, z: t.location.z }
      : { x: origin.x, y: origin.y, z: origin.z };
    // Telegraph: a column of light from the sky.
    for (let k = 0; k < 16; k++) {
      trySpawnParticle(dim, "minecraft:endrod", { x: pos.x, y: pos.y + k * 0.8, z: pos.z });
    }
    try { dim.playSound("beacon.activate", pos, { pitch: 1.4 }); } catch (e) {}

    // 3. The holy beam slams down after a short dodge window.
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      spawnRing(dim, pos, "minecraft:endrod", 2.5, 24);
      spawnRing(dim, pos, "minecraft:basic_flame_particle", 1.5, 16);
      try { dim.playSound("mob.wither.death", pos, { pitch: 1.2, volume: 1.2 }); } catch (e) {}
      try { dim.playSound("random.explode", pos, { pitch: 0.6, volume: 1.6 }); } catch (e) {}
      for (const v of victimsAt(dim, pos, 3.0)) {
        try { v.applyDamage(Math.round(base * 1.2), { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
        try { v.setOnFire(5, true); } catch (e) {}
        if (dist(v.location, pos) <= 1.6) trueDamage(v, 5); // dead-center pierces armor
      }
    }, 10);
  }, 8);
}

function effectShock(ent, target, base) {
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:basic_flame_particle", 2.0, 18);
  try { ent.dimension.playSound("random.explode", loc); } catch (e) {}
  for (const p of victimsNear(ent, 4.0, target)) { hurt(p, ent, base + 2); knockFrom(p, loc, 1.0, 0.45); }
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
  system.runTimeout(() => {
    if (!isValid(ent) || !isValid(target)) return;
    if (dist(ent.location, target.location) < 3.4) { hurt(target, ent, base); knockFrom(target, ent.location, 0.5, 0.35); }
  }, 6);
}

function effectCinder(ent, target, base) {
  const fwd = norm(sub(target.location, ent.location));
  for (let i = 1; i <= 5; i++) {
    const p = { x: ent.location.x + fwd.x * i, y: ent.location.y + 0.4, z: ent.location.z + fwd.z * i };
    trySpawnParticle(ent.dimension, "minecraft:basic_flame_particle", p);
  }
  for (const p of victimsNear(ent, 5.0, target)) {
    const to = norm(sub(p.location, ent.location));
    if (fwd.x * to.x + fwd.z * to.z > 0.55) { hurt(p, ent, base * 0.9); try { p.setOnFire(3, true); } catch (e) {} }
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
  const look = norm(sub(target.location, ent.location));
  const dest = { x: target.location.x - look.x * 2.2, y: target.location.y, z: target.location.z - look.z * 2.2 };
  const safe = findSafeNear(ent.dimension, dest, 1.5);
  spawnRing(ent.dimension, ent.location, "minecraft:endrod", 1.2, 16);
  try { ent.teleport(safe); } catch (e) {}
  spawnRing(ent.dimension, safe, "minecraft:endrod", 1.2, 16);
  try { ent.dimension.playSound("mob.endermen.portal", safe); } catch (e) {}
  system.runTimeout(() => {
    if (!isValid(ent) || !isValid(target)) return;
    if (dist(ent.location, target.location) < 3.5) { hurt(target, ent, base); knockFrom(target, ent.location, 0.5, 0.4); }
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
  for (const p of victimsNear(ent, range, target)) {
    const to = sub({ x: p.location.x, y: p.location.y + 1, z: p.location.z }, start);
    const proj = to.x * dir.x + to.y * dir.y + to.z * dir.z;
    if (proj <= 0) continue;
    const closest = { x: start.x + dir.x * proj, y: start.y + dir.y * proj, z: start.z + dir.z * proj };
    if (dist(closest, { x: p.location.x, y: p.location.y + 1, z: p.location.z }) < 1.6) hurt(p, ent, base * 1.2);
  }
}

// ============================================================= FEATURE 1: ENRAGE
// As the Marauder's HP drops, his heavy armor breaks away but his speed, damage,
// and dodge chance climb. Tier is computed live from current HP every time we
// need it — no stale state. The armor component group is swapped via JSON events
// from updateEnrage() whenever the tier boundary changes.

// `reduce` = fraction of incoming damage healed back that tick (the real "armor"):
// tanky at full HP, glass-cannon in berserk. Applied in the entityHurt handler.
const ENRAGE_TIERS = [
  null,
  { tier: 1, reduce: 0.45, speedMult: 1.00, damageMult: 1.00, dodge: 0.00 },  // 100% – 76%
  { tier: 2, reduce: 0.30, speedMult: 1.15, damageMult: 1.10, dodge: 0.10 },  //  75% – 51%
  { tier: 3, reduce: 0.15, speedMult: 1.30, damageMult: 1.25, dodge: 0.20 },  //  50% – 26%
  { tier: 4, reduce: 0.05, speedMult: 1.50, damageMult: 1.45, dodge: 0.35 },  //  25% – 0%
];

function healthPct(ent) {
  const h = ent.getComponent("minecraft:health");
  if (!h) return 1;
  const max = h.effectiveMax ?? h.maxValue ?? 1;
  return max > 0 ? h.currentValue / max : 1;
}

function enrageTier(ent) {
  const pct = healthPct(ent);
  if (pct > 0.75) return ENRAGE_TIERS[1];
  if (pct > 0.50) return ENRAGE_TIERS[2];
  if (pct > 0.25) return ENRAGE_TIERS[3];
  return ENRAGE_TIERS[4];
}

// Swap the armor component group + refresh the speed effect when crossing a tier.
// Called from afterEvents.entityHurt and after last-stand revive.
function updateEnrage(ent) {
  if (!isValid(ent)) return;
  const tier = enrageTier(ent).tier;
  const prev = ent.getDynamicProperty("marauder:enrageTier") ?? 1;
  if (tier === prev) {
    // Same tier — still refresh the speed effect so it doesn't tick out mid-fight.
    if (tier > 1) {
      try { ent.addEffect("speed", 600, { amplifier: tier - 2, showParticles: false }); } catch (e) {}
    }
    return;
  }
  ent.setDynamicProperty("marauder:enrageTier", tier);

  // NOTE: Damage reduction ("armor") is applied in the entityHurt handler via
  // armorReduction(tier) heal-back — Bedrock has no minecraft:armor entity
  // component, so the old armor_* component groups were a no-op and are gone.
  // Refresh speed effect: tier 2 = Speed I (amp 0), tier 3 = Speed II (amp 1), tier 4 = Speed III (amp 2).
  if (tier === 1) {
    try { ent.removeEffect("speed"); } catch (e) {}
  } else {
    try { ent.addEffect("speed", 600, { amplifier: tier - 2, showParticles: false }); } catch (e) {}
  }
  updateTitle(ent); // boss bar mirrors the new phase
}

// ============================================================= FEATURE 1b: AFTERIMAGE DODGE
// When a hit lands and the dodge roll succeeds, cancel the damage, leave a phantom
// at the Marauder's old position, dash him sideways/backwards, then 20 ticks later
// the phantom unleashes a sweeping AoE and despawns.
function afterimageDodge(ent, attacker) {
  const dim = ent.dimension;
  const loc = ent.location;
  const stage = clampStage(ent.getDynamicProperty("marauder:stageNum") ?? 1);

  // Spawn the phantom at the position the Marauder is currently standing.
  let phantom;
  try { phantom = dim.spawnEntity(AFTERIMAGE, loc); } catch (e) { return; }
  try { phantom.setProperty("marauder:stage", stage); } catch (e) {}
  try { phantom.setDynamicProperty("marauder:dodgePhantom", true); } catch (e) {}
  try { phantom.triggerEvent("marauder:arm"); } catch (e) {}
  try { phantom.triggerEvent("marauder:dodge_phantom_on"); } catch (e) {}
  poof(dim, loc);

  // Directional dash: 50/50 between sideways and straight back from attacker.
  let dashX, dashZ;
  if (attacker && isValid(attacker)) {
    const away = norm(sub(loc, attacker.location));
    if (Math.random() < 0.5) {
      // Sideways: 90° rotation of the "away" vector.
      dashX = -away.z; dashZ = away.x;
    } else {
      dashX = away.x; dashZ = away.z;
    }
  } else {
    const a = Math.random() * Math.PI * 2;
    dashX = Math.cos(a); dashZ = Math.sin(a);
  }
  try { ent.applyKnockback(dashX, dashZ, 1.6, 0.25); } catch (e) {}

  // After 20 ticks the phantom does its sweeping strike and dissolves.
  const phantomRef = phantom;
  system.runTimeout(() => {
    if (!isValid(phantomRef)) return;
    phantomSweep(phantomRef);
    poof(phantomRef.dimension, phantomRef.location);
    try { phantomRef.remove(); } catch (e) {}
  }, 20);
}

function phantomSweep(phantom) {
  const dim = phantom.dimension;
  const loc = phantom.location;
  spawnRing(dim, loc, "minecraft:critical_hit_emitter", 3.0, 22);
  try { dim.playSound("mob.player.attack.sweep", loc, { volume: 1.4 }); } catch (e) {}
  // Damage scales modestly with the stage the Marauder was at when he dodged.
  const stage = clampStage(phantom.getDynamicProperty("marauder:stage") ?? 1);
  const base = 4 + stage * 0.6;
  for (const v of victimsNear(phantom, 3.0, null, true)) {
    hurt(v, phantom, base);
    const dir = norm(sub(v.location, loc));
    try { v.applyKnockback(dir.x, dir.z, 1.0, 0.4); } catch (e) {}
  }
}

// ============================================================= FEATURE 2: SIX-ARM OMNI-FLURRY
// A cooldown heavy attack. The 20-tick windup is locked via stun_on (in
// beginAbility). At the fire tick we sweep a frontal arc and deal True Damage
// by directly reducing the victim's currentHealth — armor is bypassed entirely.
function effectOmni(ent, target) {
  const dim = ent.dimension;

  // Yank everyone in the frontal arc inward so they can't simply stroll out of
  // the flurry during the wind-up.
  const o0 = ent.location;
  const f0 = norm(sub(target.location, o0));
  for (const v of victimsNear(ent, 5.5, target, true)) {
    const to = sub(v.location, o0);
    const l = Math.hypot(to.x, to.z) || 1;
    if ((to.x * f0.x + to.z * f0.z) / l < 0.3) continue;
    const pull = norm({ x: o0.x - v.location.x, y: 0, z: o0.z - v.location.z });
    try { v.applyKnockback(pull.x, pull.z, 0.8, 0.1); } catch (e) {}
  }
  try { dim.playSound("mob.wither.shoot", o0, { pitch: 0.5, volume: 1.4 }); } catch (e) {}

  // Six synchronized arm-strikes over ~15 ticks, each True Damage (bypasses armor
  // via setCurrentValue). 6 x 3 = ~18 true on a full connect — near one-combo on a
  // 20-HP player, but capped so it leaves a sliver rather than a guaranteed kill.
  const HITS = 6, PER_HIT = 3, ARC = 4.5;
  for (let i = 0; i < HITS; i++) {
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      const origin = ent.location;
      const t = resolveTargetId(ent, target.id) || (isValid(target) ? target : null);
      const fwd = t ? norm(sub(t.location, origin)) : f0;
      spawnRing(dim, origin, "minecraft:critical_hit_emitter", 2.0 + i * 0.35, 12);
      try { dim.playSound("mob.player.attack.sweep", origin, { pitch: 0.8 + i * 0.06, volume: 1.1 }); } catch (e) {}
      for (const v of victimsNear(ent, ARC, t, true)) {
        const to = sub(v.location, origin);
        const l = Math.hypot(to.x, to.z) || 1;
        if ((to.x * fwd.x + to.z * fwd.z) / l < 0.45) continue;
        trueDamage(v, PER_HIT);
      }
    }, i * 3);
  }

  // Concussive finale: big ring + heavy outward launch.
  system.runTimeout(() => {
    if (!isValid(ent)) return;
    const origin = ent.location;
    spawnRing(dim, origin, "minecraft:critical_hit_emitter", 4.5, 30);
    try { dim.playSound("random.explode", origin, { pitch: 0.7, volume: 1.6 }); } catch (e) {}
    for (const v of victimsNear(ent, ARC + 0.5, target, true)) {
      const dir = norm({ x: v.location.x - origin.x, y: 0, z: v.location.z - origin.z });
      try { v.applyKnockback(dir.x, dir.z, 2.5, 0.6); } catch (e) {}
    }
  }, HITS * 3 + 2);
}

function trueDamage(target, amount) {
  try {
    const h = target.getComponent("minecraft:health");
    if (!h) return;
    const next = Math.max(0, h.currentValue - amount);
    h.setCurrentValue(next);
  } catch (e) {}
}

// ============================================================= FEATURE 3: HALO SHATTER & DIVINE SMITE
// First time the Marauder drops to <=25% HP, his halo shatters. He kneels and turns
// invulnerable, then rains down THREE tracking divine strikes — each re-locks onto
// the target's CURRENT position and telegraphs with a vertical beam, so standing
// still is death while moving takes only chip damage. Each strike ignites, deals
// fire + an unavoidable true-damage core, and craters the terrain.
function haloShatter(ent, target) {
  const s = stateFor(ent);
  s.phaseLock = true;
  ent.setDynamicProperty("marauder:haloShattered", true);
  updateTitle(ent); // boss bar: "HALO SHATTERED"

  // Invulnerable kneel + halo-shatter VFX at head height.
  try { ent.triggerEvent("marauder:invulnerable_on"); } catch (e) {}
  try { ent.setProperty("marauder:kneeling", true); } catch (e) {}
  const head = { x: ent.location.x, y: ent.location.y + 2.6, z: ent.location.z };
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.4 + Math.random() * 1.8;
    trySpawnParticle(ent.dimension, "minecraft:endrod",
      { x: head.x + Math.cos(a) * r, y: head.y + (Math.random() - 0.5) * 1.2, z: head.z + Math.sin(a) * r });
  }
  try { ent.dimension.playSound("mob.wither.break_block", head); } catch (e) {}
  try { ent.dimension.playSound("mob.enderdragon.hit", head, { pitch: 0.7 }); } catch (e) {}

  const targetId = target && isValid(target) ? target.id : null;
  const STRIKES = 3, FIRST = 24, GAP = 16, TELEGRAPH = 10;

  for (let i = 0; i < STRIKES; i++) {
    const isFinal = i === STRIKES - 1;
    system.runTimeout(() => {
      if (!isValid(ent)) { s.phaseLock = false; return; }
      // Re-lock onto where the target is NOW (tracking), then telegraph a beam.
      const t = targetId ? entityById(ent.dimension, targetId) : null;
      const pos = t && isValid(t)
        ? { x: t.location.x, y: t.location.y, z: t.location.z }
        : { x: ent.location.x, y: ent.location.y, z: ent.location.z };
      for (let k = 0; k < 12; k++) {
        trySpawnParticle(ent.dimension, "minecraft:endrod", { x: pos.x, y: pos.y + k * 0.6, z: pos.z });
      }
      try { ent.dimension.playSound("beacon.power", pos, { pitch: 1.2 }); } catch (e) {}
      try { ent.dimension.playSound("mob.wither.spawn", pos, { pitch: 1.4, volume: 0.7 }); } catch (e) {}

      // After the dodge window the strike lands at that locked position.
      system.runTimeout(() => {
        if (!isValid(ent)) { s.phaseLock = false; return; }
        divineStrike(ent, pos, isFinal);
        if (isFinal) {
          try { ent.setProperty("marauder:kneeling", false); } catch (e) {}
          try { ent.triggerEvent("marauder:invulnerable_off"); } catch (e) {}
          s.phaseLock = false;
          updateEnrage(ent); // reflect the current (low) HP berserk tier
          updateTitle(ent);  // boss bar back to the live tier readout
        }
      }, TELEGRAPH);
    }, FIRST + i * GAP);
  }
}

// The crater only consumes NATURAL terrain — player builds (planks, concrete,
// glass, etc.) are spared. Explicit whitelist plus a few suffix families.
const NATURAL_BLOCKS = new Set([
  "minecraft:stone", "minecraft:cobblestone", "minecraft:mossy_cobblestone",
  "minecraft:granite", "minecraft:diorite", "minecraft:andesite",
  "minecraft:deepslate", "minecraft:cobbled_deepslate", "minecraft:tuff", "minecraft:calcite",
  "minecraft:dirt", "minecraft:grass_block", "minecraft:grass_path", "minecraft:podzol",
  "minecraft:mycelium", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:farmland",
  "minecraft:sand", "minecraft:red_sand", "minecraft:gravel", "minecraft:clay",
  "minecraft:sandstone", "minecraft:red_sandstone", "minecraft:mud", "minecraft:packed_mud",
  "minecraft:snow", "minecraft:snow_layer", "minecraft:ice", "minecraft:packed_ice",
  "minecraft:moss_block", "minecraft:moss_carpet", "minecraft:netherrack", "minecraft:soul_sand",
  "minecraft:soul_soil", "minecraft:basalt", "minecraft:blackstone", "minecraft:end_stone",
  "minecraft:magma", "minecraft:dripstone_block", "minecraft:pointed_dripstone",
  "minecraft:tallgrass", "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern",
  "minecraft:large_fern", "minecraft:double_plant", "minecraft:deadbush", "minecraft:vine",
  "minecraft:web", "minecraft:brown_mushroom", "minecraft:red_mushroom",
]);
function isNaturalBlock(typeId) {
  if (NATURAL_BLOCKS.has(typeId)) return true;
  // Ore veins and foliage are terrain too.
  return typeId.endsWith("_ore") || typeId.endsWith("_leaves") || typeId.endsWith("_sapling");
}

// A single divine strike at `loc`. Fire damage + ignite across a 4-block radius,
// an unavoidable true-damage core near the epicenter, and (final strike) a big
// upward launch. `victimsAt` centers on the strike, not the marauder.
function divineStrike(ent, loc, isFinal) {
  const dim = ent.dimension;
  const RADIUS = 4.0, CORE = 2.2;
  const fireDmg = isFinal ? 12 : 8;
  const coreDmg = isFinal ? 6 : 4;

  for (const v of victimsAt(dim, loc, RADIUS)) {
    try { v.applyDamage(fireDmg, { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
    try { v.setOnFire(8, true); } catch (e) {}
    if (dist(v.location, loc) <= CORE) trueDamage(v, coreDmg); // pierces armor
    if (isFinal) {
      const away = norm({ x: v.location.x - loc.x, y: 0, z: v.location.z - loc.z });
      try { v.applyKnockback(away.x, away.z, 1.2, 1.0); } catch (e) {}
    }
  }

  // Crater: consume NATURAL terrain in a 3-block radius — player builds survive.
  const cx = Math.floor(loc.x), cy = Math.floor(loc.y), cz = Math.floor(loc.z);
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        try {
          const block = dim.getBlock({ x: cx + dx, y: cy + dy, z: cz + dz });
          if (!block || block.isAir) continue;
          if (!isNaturalBlock(block.typeId)) continue;
          block.setPermutation(BlockPermutation.resolve("minecraft:air"));
        } catch (e) {}
      }
    }
  }

  // VFX: flame nova + endrod ring + explosion.
  spawnRing(dim, loc, "minecraft:basic_flame_particle", isFinal ? 4.0 : 3.0, isFinal ? 40 : 32);
  spawnRing(dim, loc, "minecraft:endrod", 2.0, 18);
  try { dim.playSound("random.explode", loc, { pitch: isFinal ? 0.4 : 0.5, volume: 2.0 }); } catch (e) {}
  try { dim.playSound("mob.wither.death", loc, { pitch: 0.8 }); } catch (e) {}
}

// ============================================================= FEATURE 4: UNBROKEN CORE LAST-STAND REVIVE
// The first time lethal damage would land, cancel it, pull nearby entities
// inward, play an energy pulse, and restore HP to 30% of max for a final
// hyper-aggressive phase. The second death is final.
function lastStandRevive(ent) {
  ent.setDynamicProperty("marauder:lastStandUsed", true);
  try { ent.setProperty("marauder:last_stand", true); } catch (e) {}

  const dim = ent.dimension;
  const loc = ent.location;

  // 1. Gravitational pull: drag nearby entities slightly inward toward the Marauder.
  for (const v of victimsNear(ent, 8.0, null, true)) {
    const dir = norm(sub(loc, v.location));
    try { v.applyKnockback(dir.x, dir.z, 0.9, 0.15); } catch (e) {}
  }

  // 2. Visual explosion / energy pulse representing the Unbroken Core flaring.
  spawnRing(dim, loc, "minecraft:endrod", 1.0, 18);
  spawnRing(dim, loc, "minecraft:basic_flame_particle", 2.5, 28);
  spawnRing(dim, loc, "minecraft:soul_particle", 4.0, 24);
  try { dim.playSound("mob.wither.spawn", loc, { pitch: 0.4, volume: 1.6 }); } catch (e) {}
  try { dim.playSound("random.explode", loc, { pitch: 1.4, volume: 1.4 }); } catch (e) {}

  // 3. Restore HP to 30% of max.
  const h = ent.getComponent("minecraft:health");
  if (h) {
    const max = h.effectiveMax ?? h.maxValue ?? 1;
    h.setCurrentValue(max * 0.30);
  }

  // 4. Hyper-aggressive buffs for the final phase.
  try { ent.addEffect("speed", 400, { amplifier: 3, showParticles: false }); } catch (e) {}
  try { ent.addEffect("strength", 400, { amplifier: 2, showParticles: true }); } catch (e) {}
  try { ent.addEffect("regeneration", 60, { amplifier: 1, showParticles: true }); } catch (e) {}

  // Re-evaluate enrage tier (HP just jumped to 30%, which is tier 4).
  updateEnrage(ent);
  updateTitle(ent);
}

// ============================================================= FRACTURED: FRACTURE METER & SERAPHIM
// Every successful attack — on players OR mobs — cracks the Fractured Marauder's
// facade a little more. His skin bleaches toward the holy as the meter climbs
// (fracture_stage 0-2 -> texture swap), and at 100% he transforms: SERAPHIM.
// Seraphim mode buffs him hard but DRAINS the meter; at 0 he reverts to normal.

function getFracture(ent) {
  const v = ent.getDynamicProperty("marauder:fracture");
  return typeof v === "number" ? v : 0;
}

function fractureStageFor(meter, seraph) {
  if (seraph) return 3;
  if (meter >= 66) return 2;
  if (meter >= 33) return 1;
  return 0;
}

function addFracture(ent, amount) {
  if (!isFractured(ent) || !isValid(ent)) return;
  if (isSeraph(ent)) return; // the meter only decays while transformed
  const meter = Math.min(100, getFracture(ent) + amount);
  ent.setDynamicProperty("marauder:fracture", meter);
  applyFractureVisual(ent, meter);
  if (meter >= 100) seraphOn(ent);
  else updateTitle(ent);
}

function applyFractureVisual(ent, meter) {
  const stage = fractureStageFor(meter, isSeraph(ent));
  try {
    if (ent.getProperty("marauder:fracture_stage") !== stage) {
      ent.setProperty("marauder:fracture_stage", stage);
      // A soft chime + light burst whenever his body visibly lightens.
      trySpawnParticle(ent.dimension, "minecraft:endrod",
        { x: ent.location.x, y: ent.location.y + 1.6, z: ent.location.z });
      try { ent.dimension.playSound("random.orb", ent.location, { pitch: 0.8 + stage * 0.2, volume: 0.8 }); } catch (e) {}
    }
  } catch (e) {}
}

function seraphOn(ent) {
  ent.setDynamicProperty("marauder:seraph", true);
  try { ent.setProperty("marauder:fracture_stage", 3); } catch (e) {}
  try { ent.triggerEvent("marauder:seraph_on"); } catch (e) {}
  // Transformation flourish: light nova + ascending chime.
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:endrod", 1.5, 24);
  spawnRing(ent.dimension, loc, "minecraft:endrod", 3.0, 32);
  for (let k = 0; k < 10; k++) {
    trySpawnParticle(ent.dimension, "minecraft:endrod", { x: loc.x, y: loc.y + k * 0.5, z: loc.z });
  }
  try { ent.dimension.playSound("beacon.activate", loc, { pitch: 0.8, volume: 1.5 }); } catch (e) {}
  try { ent.dimension.playSound("mob.enderdragon.growl", loc, { pitch: 1.6, volume: 0.8 }); } catch (e) {}
  try { ent.addEffect("speed", 1200, { amplifier: 1, showParticles: false }); } catch (e) {}
  try { ent.addEffect("strength", 1200, { amplifier: 1, showParticles: false }); } catch (e) {}
  try { ent.addEffect("regeneration", 100, { amplifier: 1, showParticles: false }); } catch (e) {}
  updateTitle(ent);
}

function seraphOff(ent) {
  ent.setDynamicProperty("marauder:seraph", false);
  ent.setDynamicProperty("marauder:fracture", 0);
  try { ent.setProperty("marauder:fracture_stage", 0); } catch (e) {}
  try { ent.triggerEvent("marauder:seraph_off"); } catch (e) {}
  try { ent.removeEffect("speed"); } catch (e) {}
  try { ent.removeEffect("strength"); } catch (e) {}
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:soul_particle", 1.5, 18);
  try { ent.dimension.playSound("beacon.deactivate", loc, { pitch: 0.9, volume: 1.2 }); } catch (e) {}
  updateTitle(ent);
}

// Called from tickCombat: Seraphim slowly burns the meter down; ambient radiance.
function tickFracture(ent, s) {
  if (!isFractured(ent)) return;
  if (isSeraph(ent)) {
    const meter = Math.max(0, getFracture(ent) - FRACTURE_DECAY);
    ent.setDynamicProperty("marauder:fracture", meter);
    // Radiant aura while transformed.
    if (system.currentTick % 8 === 0) {
      const a = Math.random() * Math.PI * 2;
      trySpawnParticle(ent.dimension, "minecraft:endrod", {
        x: ent.location.x + Math.cos(a) * 0.9,
        y: ent.location.y + 0.6 + Math.random() * 1.6,
        z: ent.location.z + Math.sin(a) * 0.9
      });
    }
    if (meter <= 0) { seraphOff(ent); return; }
    // Throttled meter readout on the boss bar.
    if (system.currentTick % 20 === 0) updateTitle(ent);
  }
}

// ---- afterimage / mirage -----------------------------------------------

// He stands still, performs the cast, then splits into three identical figures
// spread around the mark — two illusions and himself. Strike the true Marauder
// and the images fade as he answers with a heavy area blow; strike an image and
// it merely dissolves.
function effectMirage(ent, target) {
  const s = stateFor(ent);
  const now = system.currentTick;
  const stage = clampStage(ent.getDynamicProperty("marauder:stageNum") ?? 1);
  const center = target ? target.location : ent.location;
  const pts = ringPositions(ent.dimension, center, 3.6, 3);
  const realIdx = Math.floor(Math.random() * 3);

  const wasBoss = stage >= 7;
  if (wasBoss) { try { ent.triggerEvent("marauder:clear_boss"); } catch (e) {} }
  const title = safeName(ent);

  // Real Marauder teleports to his slot — NO stun. He stays mobile and fights
  // alongside his clones, making the trio genuinely hard to tell apart.
  try { ent.teleport(pts[realIdx]); } catch (e) {}
  poof(ent.dimension, pts[realIdx]);

  const cloneIds = [];
  for (let i = 0; i < 3; i++) {
    if (i === realIdx) continue;
    let c;
    try { c = ent.dimension.spawnEntity(AFTERIMAGE, pts[i]); } catch (e) { continue; }
    try { c.setProperty("marauder:stage", stage); } catch (e) {}
    try { c.setDynamicProperty("marauder:realId", ent.id); } catch (e) {}
    try { if (title) c.nameTag = title; } catch (e) {}
    try { c.triggerEvent("marauder:arm"); } catch (e) {}
    poof(ent.dimension, pts[i]);
    cloneIds.push(c.id);
  }

  s.illusion = { active: true, endTick: now + 140, cloneIds, wasBoss };
  // Return the real one to an idle pose so it is indistinguishable from the images.
  setCasting(ent, false);
  try { ent.dimension.playSound("mob.endermen.portal", ent.location); } catch (e) {}
}

function retaliate(ent, s) {
  if (!(s.illusion && s.illusion.active)) return;
  endIllusion(ent, s);

  setAttacking(ent, true);
  s.swingUntil = system.currentTick + SWING_TICKS;
  const stage = clampStage(ent.getDynamicProperty("marauder:stageNum") ?? 1);
  const base = stageDamage(stage);
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:basic_flame_particle", 3.0, 30);
  try { ent.dimension.playSound("random.explode", loc, { pitch: 0.7, volume: 1.0 }); } catch (e) {}
  for (const v of victimsNear(ent, 5.5, null, true)) { hurt(v, ent, base * 2.2 + 4); knockFrom(v, loc, 1.5, 0.6); }
  // Brief cooldown so he doesn't instantly chain another cast.
  s.globalCd = 30;
  s.cooldowns["mirage"] = 280;
}

function endIllusion(ent, s) {
  if (!s.illusion) return;
  const info = s.illusion;
  s.illusion = null;
  removeClonesOf(ent.dimension, ent.id);
  if (info.wasBoss) { try { ent.triggerEvent("marauder:become_boss"); } catch (e) {} }
  setCasting(ent, false);
  // Clear a lingering mirage cast so normal combat resumes cleanly.
  if (s.current && s.current.ability && s.current.ability.id === "mirage") {
    s.current = null;
    s.cooldowns["mirage"] = 280;
    s.globalCd = Math.max(s.globalCd, 20);
  }
}

function removeClonesOf(dim, realId) {
  let list;
  try { list = dim.getEntities({ type: AFTERIMAGE }); } catch (e) { return; }
  for (const c of list) {
    if (c.getDynamicProperty("marauder:realId") === realId) {
      poof(dim, c.location);
      try { c.remove(); } catch (e) {}
    }
  }
}

function ringPositions(dim, center, radius, count) {
  const out = [];
  const base = Math.random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = base + (Math.PI * 2 * i) / count;
    const raw = { x: center.x + Math.cos(a) * radius, y: center.y, z: center.z + Math.sin(a) * radius };
    out.push(findSafeNear(dim, raw, 1.2));
  }
  return out;
}

function poof(dim, loc) {
  spawnRing(dim, loc, "minecraft:soul_particle", 0.8, 10);
  trySpawnParticle(dim, "minecraft:basic_smoke_particle", { x: loc.x, y: loc.y + 0.9, z: loc.z });
}

// ------------------------------------------------------------- telegraphs

function telegraphStart(ent, a) {
  try {
    // Unrivaled Grit is a feint — the ONLY audio tell is a quiet stance-shift.
    if (a.id === "grit") {
      ent.dimension.playSound("armor.equip_netherite", ent.location, { pitch: 0.7, volume: 0.9 });
      return;
    }
    const pitch = a.id === "beam" || a.id === "brand" ? 1.4 : a.id === "mirage" ? 0.5 : 0.6;
    ent.dimension.playSound("mob.wither.ambient", ent.location, { pitch, volume: 0.7 });
  } catch (e) {}
}

function telegraphTick(ent, a) {
  if (a.id === "grit") return; // no particle tell — it must read as a normal swing
  if (system.currentTick % 2 !== 0) return;
  const head = { x: ent.location.x, y: ent.location.y + 1.6, z: ent.location.z };
  const particle = a.id === "cinder" ? "minecraft:basic_flame_particle"
    : a.id === "beam" ? "minecraft:endrod"
    : "minecraft:soul_particle";
  trySpawnParticle(ent.dimension, particle, head);
}

// ------------------------------------------------------------- combat helpers

// Everything an AoE ability may strike: players always; other mobs when free-for-all
// is armed, when forceMobs is set, or when the primary mark itself is a mob (a Brawl
// Stick grudge). Never the marauder itself, another marauder, or an afterimage.
function victimsNear(ent, range, primary, forceMobs) {
  const includeMobs = forceMobs === true || isFFA() || isMobId(primary);
  const out = [];
  const seen = new Set();
  for (const p of ent.dimension.getEntities({ type: "minecraft:player", location: ent.location, maxDistance: range })) {
    if (isEngageable(p)) { out.push(p); seen.add(p.id); }
  }
  if (includeMobs) {
    let mobs = [];
    try {
      mobs = ent.dimension.getEntities({ location: ent.location, maxDistance: range, families: ["mob"], excludeFamilies: ["marauder", "marauder_illusion"] });
    } catch (e) { mobs = []; }
    for (const m of mobs) {
      if (m.id === ent.id || seen.has(m.id) || m.typeId === "minecraft:player" || isMarauderKind(m.typeId)) continue;
      if (isValid(m)) { out.push(m); seen.add(m.id); }
    }
  }
  // Always include the explicit mark if it is close enough.
  if (primary && isValid(primary) && !seen.has(primary.id) && dist(ent.location, primary.location) <= range + 0.5) {
    out.push(primary);
  }
  return out;
}

// Victims near an arbitrary WORLD LOCATION (not the marauder) — used by strikes
// that land away from him, like the tracking divine smite.
function victimsAt(dim, loc, range) {
  const out = [];
  const seen = new Set();
  try {
    for (const p of dim.getEntities({ type: "minecraft:player", location: loc, maxDistance: range })) {
      if (isEngageable(p)) { out.push(p); seen.add(p.id); }
    }
  } catch (e) {}
  try {
    for (const m of dim.getEntities({ location: loc, maxDistance: range, families: ["mob"], excludeFamilies: ["marauder", "marauder_illusion"] })) {
      if (seen.has(m.id) || m.typeId === "minecraft:player" || isMarauderKind(m.typeId)) continue;
      if (isValid(m)) { out.push(m); seen.add(m.id); }
    }
  } catch (e) {}
  return out;
}

function hurt(entity, source, amount) {
  try {
    entity.applyDamage(Math.max(1, Math.round(amount)), { cause: EntityDamageCause.entityAttack, damagingEntity: source });
    // Every successful hit — on players or mobs — feeds the Fracture meter.
    if (source && source.typeId === FRACTURED) addFracture(source, FRACTURE_GAIN_ABILITY);
  } catch (e) {}
}

function knockFrom(entity, from, horizontal, vertical) {
  const dx = entity.location.x - from.x;
  const dz = entity.location.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  try { entity.applyKnockback(dx / l, dz / l, horizontal, vertical); } catch (e) {}
}

function faceTarget(ent, target) {
  try {
    ent.teleport(ent.location, { facingLocation: { x: target.location.x, y: target.location.y + 1, z: target.location.z } });
  } catch (e) {}
}

function setAttacking(ent, v) { try { if (isValid(ent)) ent.setProperty("marauder:attacking", v); } catch (e) {} }
function setCasting(ent, v) { try { if (isValid(ent)) ent.setProperty("marauder:casting", v); } catch (e) {} }
function safeName(ent) { try { return ent.nameTag; } catch (e) { return ""; } }

function retreat(ent) {
  const loc = ent.location;
  removeClonesOf(ent.dimension, ent.id);
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
function trySpawnParticle(dim, particle, loc) { try { dim.spawnParticle(particle, loc); } catch (e) {} }
function isFFA() { return world.getDynamicProperty("marauder:ffa") === true; }

// ------------------------------------------------------------- events: hits

// Landed melee hit BY the marauder -> play the swing animation.
safeSub("entityHitEntity", world.afterEvents?.entityHitEntity, ev => {
  const attacker = ev.damagingEntity;
  if (!attacker) return;

  if (attacker.typeId === MARAUDER || attacker.typeId === FRACTURED) {
    const s = stateFor(attacker);
    // Allow the swing animation during the illusion — he fights alongside his
    // clones. Suppress only while another ability cast is mid-windup.
    if (!s.current) {
      setAttacking(attacker, true);
      s.swingUntil = system.currentTick + SWING_TICKS;
    }
    // Enrage bonus damage on landed melee hits: the JSON melee_attack behavior
    // already deals the stage's base damage; we layer the enrage multiplier on
    // top so the marauder hits harder as his HP drops.
    const hit = ev.hitEntity;
    if (hit && isValid(hit)) {
      const stage = clampStage(attacker.getDynamicProperty("marauder:stageNum") ?? 1);
      const mult = enrageTier(attacker).damageMult;
      const bonus = Math.max(0, Math.round(STAGE_DAMAGE[stage] * (mult - 1)));
      // Raw applyDamage (not hurt()) so the bonus doesn't double-feed the meter.
      if (bonus > 0) {
        try { hit.applyDamage(bonus, { cause: EntityDamageCause.entityAttack, damagingEntity: attacker }); } catch (e) {}
      }
    }
    // Every landed melee blow — on a player or a mob — cracks the Fracture meter.
    if (attacker.typeId === FRACTURED) addFracture(attacker, FRACTURE_GAIN_MELEE);
    return;
  }

  // Afterimage lands a hit -> play the same swing animation as the real one.
  if (attacker.typeId === AFTERIMAGE) {
    try { attacker.setProperty("marauder:attacking", true); } catch (e) {}
    const ref = attacker;
    system.runTimeout(() => {
      try { if (isValid(ref)) ref.setProperty("marauder:attacking", false); } catch (e) {}
    }, SWING_TICKS);
    return;
  }

  // Blacksteel Blade: a night-time cut carries the curse (glow + lifesteal).
  if (attacker.typeId === "minecraft:player") {
    const hit = ev.hitEntity;
    if (!hit || !isNight()) return;
    let held;
    try { held = attacker.getComponent("minecraft:equippable")?.getEquipment?.(EquipmentSlot.Mainhand); } catch (e) {}
    if (held && held.typeId === "marauder:blacksteel_blade") {
      try { hit.addEffect("glowing", 60, { amplifier: 0 }); } catch (e) {}
      try { attacker.addEffect("regeneration", 40, { amplifier: 1 }); } catch (e) {}
    }
  }
});

// ------------------------------------------------------------- events: damage intercepts
//
// The stable @minecraft/server module has NO cancellable damage event, so every
// defensive mechanic runs off the (stable) afterEvents.entityHurt by HEALING the
// damage back — a net-zero (dodge) or reduced (armor) hit — plus a proactive HP
// monitor in tickCombat that fires the last-stand revive before a killing blow.

const DODGE_CD = 12; // ticks between afterimage dodges (no chain-dodging)

// Returns the marauder's effective max health.
function maxHp(ent) {
  const h = ent.getComponent("minecraft:health");
  return (h && (h.effectiveMax ?? h.defaultValue)) || 20;
}

// Restore HP to 30% and enter the hyper-aggressive last stand. Shared by the HP
// monitor (tickCombat) and the entityHurt safety net.
function tryLastStand(ent) {
  if (!isValid(ent)) return false;
  const s = stateFor(ent);
  if (s.phaseLock) return false;
  if (ent.getDynamicProperty("marauder:lastStandUsed") === true) return false;
  try { lastStandRevive(ent); } catch (e) {}
  return true;
}

// AFTER damage applies. Not cancellable — we heal the hit back instead.
safeSub("entityHurt", world.afterEvents?.entityHurt, ev => {
  const victim = ev.hurtEntity;
  if (!victim) return;

  if (victim.typeId === AFTERIMAGE) { poof(victim.dimension, victim.location); return; }
  if (victim.typeId !== MARAUDER && victim.typeId !== FRACTURED) return;

  const s = stateFor(victim);
  const now = system.currentTick;
  const attacker = ev.damageSource?.damagingEntity;
  const dmg = ev.damage || 0;

  if (attacker && !isMarauderKind(attacker.typeId)) {
    s.aggroId = attacker.id;
    s.aggroTick = now;
  }

  const health = victim.getComponent("minecraft:health");
  if (!health) return;
  const max = maxHp(victim);
  const healBack = (amt) => { try { health.setCurrentValue(Math.min(max, health.currentValue + amt)); } catch (e) {} };

  // enrageTier reads live HP, so capture it BEFORE we heal anything back.
  const tier = enrageTier(victim);

  // (A) Afterimage Dodge — fully negate the hit, dash, leave a phantom. On cooldown.
  if (dmg > 0 && tier.dodge > 0 && now >= (s.dodgeUntil || 0) && Math.random() < tier.dodge) {
    healBack(dmg);
    s.dodgeUntil = now + DODGE_CD;
    try { afterimageDodge(victim, attacker); } catch (e) {}
    updateEnrage(victim);
    return;
  }

  // (B) "Armor" — heal back a tier-scaled fraction of the damage (tanky early, glass late).
  if (dmg > 0 && tier.reduce > 0) healBack(dmg * tier.reduce);

  updateEnrage(victim);

  const postPct = health.currentValue / (max || 1);

  // (C) Halo Shatter — first time he drops to <=25% HP. The NORMAL Marauder's
  // set-piece only; the Fractured variant spawns with haloShattered=true.
  const haloShattered = victim.getDynamicProperty("marauder:haloShattered") === true;
  if (victim.typeId === MARAUDER && !haloShattered && !s.phaseLock && postPct <= 0.25) {
    const target = attacker && attacker.typeId === "minecraft:player" ? attacker : ownerOf(victim);
    haloShatter(victim, target);
    return;
  }

  // (D) Unbroken-Core Revive — safety net (tickCombat is the primary monitor).
  if (!s.phaseLock && postPct <= 0.12 && tryLastStand(victim)) return;

  // (E) Struck the true Marauder during a mirage -> heavy retaliation.
  if (s.illusion && s.illusion.active && attacker && !isMarauderKind(attacker.typeId)) {
    retaliate(victim, s);
  }
});

// Afterimage destroyed -> dissolve.
safeSub("entityDie_afterimage", world.afterEvents?.entityDie, ev => {
  const dead = ev.deadEntity;
  if (dead && dead.typeId === AFTERIMAGE) { try { poof(dead.dimension, dead.location); } catch (e) {} }
});

// ------------------------------------------------------------- ashen remnant

safeSub("itemUse", world.afterEvents?.itemUse, ev => {
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

safeSub("entityDie_marauder", world.afterEvents?.entityDie, ev => {
  const dead = ev.deadEntity;
  if (!dead || (dead.typeId !== MARAUDER && dead.typeId !== FRACTURED)) return;
  removeClonesOf(dead.dimension, dead.id);
  combat.delete(dead.id);
  try { handleDefeat(dead, ev.damageSource); } catch (e) {}
});

function handleDefeat(dead, source) {
  const fractured = dead.typeId === FRACTURED;
  const stage = fractured ? STAGE_MAX : clampStage(dead.getDynamicProperty("marauder:stageNum") ?? 1);
  const ownerId = dead.getDynamicProperty("marauder:owner");
  const dim = dead.dimension;
  const loc = dead.location;

  dropRewards(dim, loc, stage, fractured);
  try { dim.spawnParticle("minecraft:soul_particle", { x: loc.x, y: loc.y + 0.8, z: loc.z }); } catch (e) {}
  if (fractured) {
    // He dies the way he fought: in a burst of light.
    spawnRing(dim, loc, "minecraft:endrod", 2.0, 24);
    try { dim.playSound("beacon.deactivate", loc, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  }

  let owner = ownerId ? world.getAllPlayers().find(p => p.id === ownerId) : null;
  const killer = source && source.damagingEntity;
  if (!owner && killer && killer.typeId === "minecraft:player") owner = killer;
  if (!owner) return;

  if (!killer || killer.typeId !== "minecraft:player") {
    owner.sendMessage("§7The Marauder was slain by another hand. Your rivalry is unchanged.");
    return;
  }

  if (stage >= STAGE_MAX) {
    owner.setDynamicProperty("marauder:finalComplete", true);
    owner.setDynamicProperty("marauder:rematchArmed", false);
    if (fractured) {
      owner.sendMessage("§eThe Fractured Marauder shatters into motes of light. The rivalry ends in radiance.");
      owner.sendMessage("§8An Ashen Remnant remains — should you ever wish to face him again.");
    } else {
      owner.sendMessage("§6The Marauder Ascendant falls. The ten-night rivalry is over.");
      owner.sendMessage("§8An Ashen Remnant remains — should you ever wish to face him again.");
    }
  } else {
    setStage(owner, Math.max(getStage(owner), stage + 1));
    owner.sendMessage("§cThe Marauder falls — but he will return, stronger.");
  }
}

function dropRewards(dim, loc, stage, fractured) {
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
  // The Fractured Marauder yields a richer core haul — he hit harder, after all.
  if (fractured) {
    drop("marauder:unbroken_core", 2);
    drop("marauder:moon_shard", 2);
    drop("marauder:abyss_fragment", 1);
  }
}

// ------------------------------------------------------------- test commands

// Wrap the entire scriptEventReceive handler so any runtime error in the
// dispatch logic itself is caught and surfaced to the source player — instead
// of silently swallowing the event (which is what was happening in v4).
function tryTell(player, label, fn) {
  try {
    fn();
  } catch (err) {
    try {
      console.warn(`[Marauder] /scriptevent ${label} threw: ${err?.stack || err}`);
      player?.sendMessage?.(`§c[Marauder] ${label} failed: ${err?.message || err}`);
    } catch (_) {}
  }
}

safeSub("scriptEventReceive", system.afterEvents?.scriptEventReceive, ev => {
  // Be defensive — if ev.id is somehow missing, do nothing instead of throwing.
  if (!ev || typeof ev.id !== "string" || !ev.id.startsWith("marauder:")) return;
  const src = ev.sourceEntity;
  const player = (src && src.typeId === "minecraft:player") ? src : world.getAllPlayers()[0];
  if (!player) return;
  const arg = parseInt(ev.message);

  switch (ev.id) {
    case "marauder:spawn":
      tryTell(player, "marauder:spawn", () => {
        clearActive(player);
        spawnMarauder(player, isNaN(arg) ? getStage(player) : arg, false);
      });
      break;
    case "marauder:duel":
      tryTell(player, "marauder:duel", () => {
        clearActive(player);
        spawnMarauder(player, isNaN(arg) ? getStage(player) : arg, true);
      });
      break;
    case "marauder:setstage":
      tryTell(player, "marauder:setstage", () => {
        setStage(player, isNaN(arg) ? 1 : arg);
        player.sendMessage("§eMarauder stage set to " + getStage(player) + ".");
      });
      break;
    case "marauder:stage":
      tryTell(player, "marauder:stage", () => {
        player.sendMessage("§7Stage " + getStage(player) + ", finalComplete=" + getFlag(player, "marauder:finalComplete"));
      });
      break;
    case "marauder:reset":
      tryTell(player, "marauder:reset", () => {
        resetProgress(player);
        clearActive(player);
        player.sendMessage("§eMarauder rivalry reset to Stage 1.");
      });
      break;
    case "marauder:rematch":
      tryTell(player, "marauder:rematch", () => {
        player.setDynamicProperty("marauder:finalComplete", true);
        player.setDynamicProperty("marauder:rematchArmed", true);
        setStage(player, 10);
        player.sendMessage("§5Rematch armed. The Marauder Ascendant returns next night.");
      });
      break;
    case "marauder:clear":
      tryTell(player, "marauder:clear", () => {
        player.sendMessage("§7Cleared " + clearActive(player) + " Marauder(s).");
      });
      break;
    case "marauder:freeforall":
    case "marauder:ffa":
      tryTell(player, "marauder:ffa", () => setFreeForAll(player, ev.message));
      break;

    // ---- debug triggers for the four new mechanics ----
    case "marauder:omni":
      tryTell(player, "marauder:omni", () => forceAbilityOnNearest(player, "omni"));
      break;
    case "marauder:halo":
      tryTell(player, "marauder:halo", () => forceHaloShatter(player));
      break;
    case "marauder:revive":
      tryTell(player, "marauder:revive", () => forceLastStand(player));
      break;
    case "marauder:enrage":
      tryTell(player, "marauder:enrage", () => reportEnrage(player));
      break;

    // ---- Fractured Marauder (challenge variant) ----
    case "marauder:fractured":
      tryTell(player, "marauder:fractured", () => {
        clearActive(player);
        spawnMarauder(player, STAGE_MAX, true, true);
      });
      break;
    case "marauder:fracture":
      tryTell(player, "marauder:fracture", () => {
        const ent = nearestOwnedMarauder(player);
        if (!ent || !isFractured(ent)) { player.sendMessage("§cNo active Fractured Marauder found."); return; }
        if (!isNaN(arg)) {
          const v = Math.max(0, Math.min(100, arg));
          ent.setDynamicProperty("marauder:fracture", v);
          if (v >= 100 && !isSeraph(ent)) seraphOn(ent);
          else { applyFractureVisual(ent, v); updateTitle(ent); }
          player.sendMessage("§eFracture meter set to " + v + "%.");
        } else {
          player.sendMessage(`§7Fracture ${Math.round(getFracture(ent))}% | Seraphim: ${isSeraph(ent)}`);
        }
      });
      break;
    case "marauder:grit":
      tryTell(player, "marauder:grit", () => forceAbilityOnNearest(player, "grit"));
      break;
    case "marauder:skyfall":
      tryTell(player, "marauder:skyfall", () => forceAbilityOnNearest(player, "skyfall"));
      break;

    // ---- diagnostic events (added in v5 so users can confirm the script loaded) ----
    case "marauder:ping":
      tryTell(player, "marauder:ping", () => {
        const expected = ["nightInterval","combatInterval","entityHitEntity","entityHurt","entityDie_afterimage","entityDie_marauder","itemUse","scriptEventReceive"];
        const loaded = expected.filter(k => _subsLoaded[k]);
        player.sendMessage(`§a[Marauder v5] script alive. ${loaded.length}/${expected.length} subscriptions registered (tick ${system.currentTick}).`);
        if (loaded.length < expected.length) {
          const missing = expected.filter(k => !_subsLoaded[k]);
          player.sendMessage(`§c Missing: ${missing.join(", ")}`);
        }
      });
      break;
    case "marauder:help":
      tryTell(player, "marauder:help", () => {
        player.sendMessage("§6=== Marauder /scriptevent commands ===");
        player.sendMessage("§7marauder:spawn [stage]   §8- spawn a Marauder at night position");
        player.sendMessage("§7marauder:duel [stage]   §8- spawn right next to you");
        player.sendMessage("§7marauder:setstage <n>   §8- set your stage (1-10)");
        player.sendMessage("§7marauder:stage          §8- show your current stage");
        player.sendMessage("§7marauder:reset          §8- reset all rivalry progress");
        player.sendMessage("§7marauder:rematch        §8- arm the Stage-10 rematch");
        player.sendMessage("§7marauder:clear          §8- remove all your Marauders");
        player.sendMessage("§7marauder:ffa [on|off]   §8- toggle free-for-all mode");
        player.sendMessage("§7marauder:omni           §8- force Six-Arm Omni-Flurry");
        player.sendMessage("§7marauder:halo           §8- force Halo Shatter");
        player.sendMessage("§7marauder:revive         §8- force Last-Stand Revive trigger");
        player.sendMessage("§7marauder:enrage         §8- report current enrage tier");
        player.sendMessage("§7marauder:fractured      §8- spawn the Fractured Marauder variant");
        player.sendMessage("§7marauder:fracture [n]   §8- report or set his Fracture meter");
        player.sendMessage("§7marauder:grit           §8- force Unrivaled Grit (feint)");
        player.sendMessage("§7marauder:skyfall        §8- force Might Shove + Sky Beam");
        player.sendMessage("§7marauder:ping           §8- check script is alive");
      });
      break;
  }
});

function nearestOwnedMarauder(player) {
  let best = null, bestD = Infinity;
  for (const t of [MARAUDER, FRACTURED]) {
    for (const e of player.dimension.getEntities({ type: t })) {
      if (e.getDynamicProperty("marauder:owner") !== player.id) continue;
      if (!isValid(e)) continue;
      const d = dist(e.location, player.location);
      if (d < bestD) { best = e; bestD = d; }
    }
  }
  return best;
}

function forceAbilityOnNearest(player, abilityId) {
  const ent = nearestOwnedMarauder(player);
  if (!ent) { player.sendMessage("§cNo active Marauder found."); return; }
  const s = stateFor(ent);
  if (s.phaseLock) { player.sendMessage("§cMarauder is mid-phase-lock; wait a moment."); return; }
  if (s.current) { player.sendMessage("§cMarauder is already mid-ability."); return; }
  const a = ABILITIES.find(x => x.id === abilityId);
  if (!a) { player.sendMessage("§cUnknown ability."); return; }
  const kind = isFractured(ent) ? "fractured" : "marauder";
  if (a.only && a.only !== kind) {
    player.sendMessage(`§cThat ability belongs to the ${a.only === "fractured" ? "Fractured Marauder" : "normal Marauder"}.`);
    return;
  }
  if (a.noSeraph && isSeraph(ent)) { player.sendMessage("§cThat move is sealed while he is Seraphim."); return; }
  s.cooldowns[a.id] = 0;
  s.globalCd = 0;
  beginAbility(ent, s, a, player, system.currentTick);
  player.sendMessage("§aForced " + abilityId + " on the Marauder.");
}

function forceHaloShatter(player) {
  const ent = nearestOwnedMarauder(player);
  if (!ent) { player.sendMessage("§cNo active Marauder found."); return; }
  const s = stateFor(ent);
  if (s.phaseLock) { player.sendMessage("§cMarauder is already in a phase-lock."); return; }
  ent.setDynamicProperty("marauder:haloShattered", false);
  haloShatter(ent, player);
  player.sendMessage("§aForced Halo Shatter on the Marauder.");
}

function forceLastStand(player) {
  const ent = nearestOwnedMarauder(player);
  if (!ent) { player.sendMessage("§cNo active Marauder found."); return; }
  const h = ent.getComponent("minecraft:health");
  if (!h) return;
  ent.setDynamicProperty("marauder:lastStandUsed", false);
  h.setCurrentValue(1);
  player.sendMessage("§aSet Marauder to 1 HP and cleared last-stand flag. Hit him once more to trigger the revive.");
}

function reportEnrage(player) {
  const ent = nearestOwnedMarauder(player);
  if (!ent) { player.sendMessage("§cNo active Marauder found."); return; }
  const t = enrageTier(ent);
  const h = ent.getComponent("minecraft:health");
  const hp = h ? `${Math.round(h.currentValue)}/${Math.round(h.effectiveMax ?? h.defaultValue ?? 0)}` : "?";
  player.sendMessage(`§7HP ${hp} | Tier ${t.tier} | dmg-reduce ${Math.round(t.reduce * 100)}% | speed ${t.speedMult}x | dmg ${t.damageMult}x | dodge ${Math.round(t.dodge * 100)}%`);
}

function setFreeForAll(player, message) {
  const msg = (message || "").trim().toLowerCase();
  let on;
  if (msg === "") on = !(world.getDynamicProperty("marauder:ffa") === true);
  else on = /^(on|1|true|yes|enable|enabled)$/.test(msg);

  world.setDynamicProperty("marauder:ffa", on);

  let n = 0;
  const dim = world.getDimension(OVERWORLD);
  for (const t of [MARAUDER, FRACTURED]) {
    for (const e of dim.getEntities({ type: t })) {
      try { e.triggerEvent(on ? "marauder:ffa_on" : "marauder:ffa_off"); n++; } catch (err) {}
    }
  }
  player.sendMessage(
    "§dMarauder free-for-all " + (on ? "§aENABLED" : "§cDISABLED")
    + " §7(" + n + " active updated). Marauders " + (on ? "now attack any mob and fight back." : "target only players again.")
  );
}

function clearActive(player) {
  let n = 0;
  for (const t of [MARAUDER, FRACTURED]) {
    for (const e of player.dimension.getEntities({ type: t })) {
      if (e.getDynamicProperty("marauder:owner") === player.id) {
        removeClonesOf(e.dimension, e.id);
        combat.delete(e.id);
        try { e.remove(); n++; } catch (err) {}
      }
    }
  }
  return n;
}

// ------------------------------------------------------------- misc

const STAGE_NAMES = [
  "", "Rusted Challenger", "Scarred Pursuer", "Oathbound Duelist", "Blacksteel Marauder",
  "Ashen Knight", "Moonlit Executioner", "Spellscarred Knight", "Abyss-Touched Marauder",
  "The Unbroken", "The Marauder Ascendant"
];
function stageName(stage) { return STAGE_NAMES[clampStage(stage)] || "The Marauder"; }
function stageTitle(stage) { return "The Marauder — " + stageName(stage); }

// ------------------------------------------------------------- load banner
//
// Final load banner. This fires AFTER every subscription has been registered,
// so seeing this message in the content log confirms the script reached the
// end of module evaluation. If you don't see it, something earlier in the file
// threw at load time — check the content log for the prior "[Marauder] ...
// failed" warnings.
try {
  system.run(() => {
    const loaded = Object.keys(_subsLoaded);
    console.warn(`[Marauder] v5 loaded. Subscriptions: ${loaded.join(", ") || "(none)"}`);
    console.warn(`[Marauder] Try /scriptevent marauder:ping to verify, or /scriptevent marauder:help for the command list.`);
    // Ping the first online player once so the user has in-game confirmation
    // that the script is alive — without this, a script that fails to load
    // produces zero in-game feedback and looks identical to "no addon".
    try {
      const p = world.getAllPlayers()[0];
      if (p) {
        p.sendMessage("§6[Marauder v5] addon script active. /scriptevent marauder:help for commands.");
      }
    } catch (_) {}
  });
} catch (err) {
  console.warn(`[Marauder] load banner system.run failed: ${err?.stack || err}`);
}
