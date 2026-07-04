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
const OVERSEER = "marauder:overseer";
const FALLEN_KNIGHT = "marauder:fallen_knight";
const STAGE_MAX = 10;

// --- The Fractured Marauder (challenge variant) ---
const FRACTURED_CHANCE = 0.12;      // chance the stage-10 encounter is Fractured
const FRACTURE_GAIN_MELEE = 8;      // meter gain per landed melee hit
const FRACTURE_GAIN_ABILITY = 5;    // meter gain per scripted-ability hit
const FRACTURE_DECAY = 0.4;         // meter lost per combat tick while Seraphim
const FRACTURED_ABILITY_MULT = 1.25;// his abilities hit harder than stage 10's

// ------------------------------------------------------------- config
//
// Runtime-tunable settings, stored as world dynamic properties so they survive
// reloads and can be changed live with /scriptevent marauder:config <key> <val>.
// Read via cfg(key); every gameplay knob below routes through here.
const CONFIG_DEFAULTS = {
  overseerPhase: 1,      // 1 = the final Marauder rises as the Overseer on death
  fracturedChance: 0.12, // chance a stage-10 night is the Fractured Marauder
  adaptationEnabled: 1,  // Fractured's Mahoraga-style damage adaptation
  bossDamageMult: 1.0,   // global multiplier on all boss-dealt damage
  bossHealthMult: 1.0,   // global multiplier on boss max HP (applied on spawn)
  craterEnabled: 1,      // allow terrain-destroying craters
  knightCount: 3,        // Fallen Knights summoned at the Overseer's 50%
};
function cfg(key) {
  const v = world.getDynamicProperty("marauder:cfg:" + key);
  return v === undefined ? CONFIG_DEFAULTS[key] : v;
}
function setCfg(key, val) { world.setDynamicProperty("marauder:cfg:" + key, val); }

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

// The boss family — none of these should ever be caught by a boss's own AoE, and
// none count as a "mob" the boss will hunt. Overseer + knights are allies of the
// Overseer; the afterimage is a prop.
function isMarauderKind(typeId) {
  return typeId === MARAUDER || typeId === FRACTURED || typeId === AFTERIMAGE
      || typeId === OVERSEER || typeId === FALLEN_KNIGHT;
}
function isBoss(ent) {
  const t = ent?.typeId;
  return t === MARAUDER || t === FRACTURED || t === OVERSEER;
}
function isFractured(ent) { return ent?.typeId === FRACTURED; }
function isOverseer(ent) { return ent?.typeId === OVERSEER; }
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
    || (forceFractured !== false && stage >= STAGE_MAX && Math.random() < (Number(cfg("fracturedChance")) || FRACTURED_CHANCE));
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
  ent.setDynamicProperty("marauder:risen", false);
  ent.setDynamicProperty("marauder:enrageTier", 1);
  // Reset the per-encounter visual properties too.
  try { ent.setProperty("marauder:kneeling", false); } catch (e) {}
  try { ent.setProperty("marauder:omni", false); } catch (e) {}
  try { ent.setProperty("marauder:last_stand", false); } catch (e) {}
  clearPoses(ent);

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
  ent.setDynamicProperty("marauder:seraphPermanent", false);
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
    if (ent.typeId === OVERSEER) { overseerTitle(ent); return; }
    if (ent.typeId === FRACTURED) {
      const m = Math.round(ent.getDynamicProperty("marauder:fracture") ?? 0);
      const bars = Math.round(m / 10);
      const meter = "§e" + "|".repeat(bars) + "§8" + "|".repeat(10 - bars);
      ent.nameTag = (isSeraph(ent)
        ? `§6✧ SERAPHIM ✧ §f${meter} §6✧`
        : `§fThe Fractured Marauder §7— ${meter} §7${m}%`) + adaptLabel(ent);
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
// `noSeraph` marks Fractured moves sealed while transformed; `seraphOnly` marks
// the Seraphim signature that is ONLY available while transformed.
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
  // --- Fractured Marauder base-form toolkit (sealed while Seraphim) ---
  { id: "grit",    minStage: 1, min: 0.0, max: 4.5,  windup: 9,  recover: 12, cd: 170, weight: 9, only: "fractured", noSeraph: true },
  { id: "skyfall", minStage: 1, min: 0.0, max: 7.0,  windup: 8,  recover: 24, cd: 220, weight: 8, only: "fractured", noSeraph: true },
  { id: "tether",  minStage: 1, min: 3.0, max: 16.0, windup: 12, recover: 8,  cd: 150, weight: 8, only: "fractured", noSeraph: true },
  { id: "arena",   minStage: 1, min: 0.0, max: 12.0, windup: 16, recover: 10, cd: 320, weight: 6, only: "fractured", noSeraph: true },
  { id: "mirror",  minStage: 1, min: 0.0, max: 6.0,  windup: 6,  recover: 30, cd: 200, weight: 7, only: "fractured", noSeraph: true },
  { id: "spears",  minStage: 1, min: 3.0, max: 20.0, windup: 14, recover: 10, cd: 170, weight: 8, only: "fractured", noSeraph: true },
  // --- Seraphim signatures (only WHILE transformed) ---
  { id: "wingsweep", minStage: 1, min: 0.0, max: 6.5,  windup: 12, recover: 14, cd: 70,  weight: 12, only: "fractured", seraphOnly: true },
  { id: "divebomb",  minStage: 1, min: 3.0, max: 22.0, windup: 10, recover: 26, cd: 200, weight: 9, only: "fractured", seraphOnly: true },
  { id: "cleave",    minStage: 1, min: 0.0, max: 6.0,  windup: 20, recover: 16, cd: 130, weight: 10, only: "fractured", seraphOnly: true },
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
    let marauders = [];
    try {
      marauders = dim.getEntities({ type: MARAUDER });
      for (const t of [FRACTURED, OVERSEER]) {
        try { marauders = marauders.concat(dim.getEntities({ type: t })); } catch (e2) {}
      }
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

// Bleed DoT — once a second, bleeding players drip and take tick damage. The
// +50% incoming-damage vulnerability is applied in the entityHurt handler.
try {
  system.runInterval(() => {
    const now = system.currentTick;
    for (const p of world.getAllPlayers()) {
      if (!isBleeding(p)) continue;
      try { p.applyDamage(2, { cause: EntityDamageCause.magic }); } catch (e) {}
      try {
        const l = p.location;
        p.dimension.spawnParticle("minecraft:redstone_wander_particle", { x: l.x, y: l.y + 0.8, z: l.z });
      } catch (e) {}
    }
    try { tickHolyGrounds(now); } catch (e) {}
  }, 10);
  _subsLoaded.bleedInterval = true;
} catch (e) {}

function ownerOf(ent) {
  const id = ent.getDynamicProperty("marauder:owner");
  if (!id) return null;
  return world.getAllPlayers().find(p => p.id === id) || null;
}

function tickCombat(ent, now) {
  const s = stateFor(ent);

  // Clear a finished melee swing.
  if (s.swingUntil && now >= s.swingUntil) { s.swingUntil = 0; setAttacking(ent, false); }

  // The Overseer runs a completely different fight (stances, King's Orders,
  // parry, Fallen Knights) — hand him off to his own driver.
  if (isOverseer(ent)) { try { tickOverseer(ent, s, now); } catch (e) {} return; }

  // Fractured Marauder: Seraphim decay + radiant aura + active tether.
  tickFracture(ent, s);
  tickTether(ent, s, now);

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
  if (!id) return null;
  // Players first and explicitly — some engine builds don't return players from
  // dim.getEntities({}), which would make tracking strikes fall back to the boss.
  try {
    const p = world.getAllPlayers().find(pl => pl.id === id);
    if (p) return isValid(p) ? p : null;
  } catch (e) {}
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
    if (a.seraphOnly && !seraph) continue;
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
  faceTarget(ent, target);
  // Omni-flurry: 20-tick movement lock via stun_on + drive the omni animation.
  if (ability.id === "omni") {
    clearPoses(ent);
    try { ent.triggerEvent("marauder:stun_on"); } catch (e) {}
    try { ent.setProperty("marauder:omni", true); } catch (e) {}
  } else if (ability.id === "grit") {
    // Unrivaled Grit is a FEINT: it must look like a normal sword swing, so the
    // only tells are the swing pose + a faint stance-shift sound (telegraphStart).
    setPose(ent, "swing");
    s.swingUntil = now + ability.windup + 4;
  } else {
    // Everything else gets a distinct wind-up stance keyed to the attack.
    setPose(ent, ABILITY_POSE[ability.id] || "cast");
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
    clearPoses(ent);
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
    const hit = near.find(e => e.id === id && isValid(e));
    if (hit) return hit;
  } catch (e) {}
  // Some engine builds omit players from dimension queries — fall back to the
  // explicit lookup (world.getAllPlayers first) so abilities keep their mark.
  const e2 = entityById(ent.dimension, id);
  return e2 && isValid(e2) && dist(e2.location, ent.location) <= CHALLENGE_RANGE + 12 ? e2 : null;
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
    case "tether":  effectTether(ent, target, base); break;
    case "arena":   effectArena(ent, target); break;
    case "mirror":  effectMirror(ent, target); break;
    case "spears":  effectSpears(ent, target, base); break;
    case "wingsweep": effectWingsweep(ent, target, base); break;
    case "divebomb":  effectDivebomb(ent, target, base); break;
    case "cleave":    effectCleave(ent, target, base); break;
  }
}

// ============================================================= SERAPHIM SIGNATURE: RADIANT WING-SWEEP
// His transformation's own offensive identity: he flares six wings of light and
// sweeps a 360° radiant nova outward — holy fire plus an armor-piercing core that
// falls off with distance, launching everything around him up and away.
function effectWingsweep(ent, target, base) {
  const dim = ent.dimension;
  const origin = ent.location;
  const R = 6.5;

  try { dim.playSound("mob.enderdragon.flap", origin, { pitch: 0.7, volume: 1.8 }); } catch (e) {}
  try { dim.playSound("beacon.power", origin, { pitch: 1.5, volume: 1.3 }); } catch (e) {}

  // Expanding rings of light fanning outward over a few ticks — the "wing sweep".
  for (let step = 0; step < 5; step++) {
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      const c = ent.location;
      spawnRing(dim, c, "minecraft:endrod", 1.2 + step * 1.3, 20 + step * 8);
      if (step % 2 === 0) spawnRing(dim, c, "minecraft:basic_flame_particle", 1.0 + step * 1.3, 14 + step * 6);
    }, step * 2);
  }

  // The blast: holy fire + a distance-scaled TRUE core, big outward + upward launch.
  for (const v of victimsNear(ent, R, target, true)) {
    const d = dist(v.location, origin);
    const falloff = Math.max(0.35, 1 - d / R);
    try { v.applyDamage(Math.max(1, Math.round(base * 0.8)), { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
    trueDamage(v, Math.round(12 * falloff));           // armor cannot save you near the core
    try { v.setOnFire(4, true); } catch (e) {}
    const away = norm({ x: v.location.x - origin.x, y: 0, z: v.location.z - origin.z });
    try { v.applyKnockback(away.x, away.z, 1.4 + 1.6 * falloff, 0.9); } catch (e) {}
  }
}

// ============================================================= FRACTURED BASE TOOLKIT
// Radiant Tether — golden chains bind the target; stray too far and they snap taut,
// yanking the player back into melee. Tracked per-marauder in state.tether.
function effectTether(ent, target, base) {
  const dim = ent.dimension;
  triggerCast(ent, 14);
  spawnRing(dim, ent.location, "minecraft:endrod", 1.2, 16);
  try { dim.playSound("mob.wither.shoot", ent.location, { pitch: 1.2 }); } catch (e) {}
  hurt(target, ent, Math.round(base * 0.4));
  const s = stateFor(ent);
  s.tether = { id: target.id, until: system.currentTick + 80 }; // 4 seconds
}
// Called each combat tick from tickCombat: draw the chain + yank if it goes taut.
function tickTether(ent, s, now) {
  if (!s.tether) return;
  if (now >= s.tether.until) { s.tether = null; return; }
  const t = entityById(ent.dimension, s.tether.id);
  if (!t || !isValid(t)) { s.tether = null; return; }
  // chain of light
  const a = ent.location, b = t.location;
  const steps = 6;
  for (let i = 1; i < steps; i++) {
    trySpawnParticle(ent.dimension, "minecraft:endrod", { x: a.x + (b.x - a.x) * i / steps, y: a.y + 1 + (b.y - a.y) * i / steps, z: a.z + (b.z - a.z) * i / steps });
  }
  if (dist(a, b) > 6) {
    const pull = norm({ x: a.x - b.x, y: 0, z: a.z - b.z });
    try { t.applyKnockback(pull.x, pull.z, 2.6, 0.35); } catch (e) {}
    try { ent.dimension.playSound("mob.enderdragon.flap", b, { pitch: 1.4, volume: 1.0 }); } catch (e) {}
  }
}

// Consecrated Arena — a glowing golden seal. Buffs the Marauder, "purifies"
// players inside (no sprint + holy tick damage). Tracked in the holyGrounds list.
const holyGrounds = [];
function effectArena(ent, target) {
  triggerCast(ent, 16);
  const c = target ? { x: Math.floor(target.location.x) + 0.5, y: target.location.y, z: Math.floor(target.location.z) + 0.5 } : ent.location;
  try { ent.dimension.playSound("beacon.activate", c, { pitch: 0.9, volume: 1.4 }); } catch (e) {}
  holyGrounds.push({ dimId: ent.dimension.id, ownerId: ent.id, x: c.x, y: c.y, z: c.z, r: 6, until: system.currentTick + 200 });
}
function tickHolyGrounds(now) {
  for (let i = holyGrounds.length - 1; i >= 0; i--) {
    const g = holyGrounds[i];
    if (now >= g.until) { holyGrounds.splice(i, 1); continue; }
    let dim; try { dim = world.getDimension(g.dimId); } catch (e) { holyGrounds.splice(i, 1); continue; }
    const center = { x: g.x, y: g.y, z: g.z };
    // seal ring VFX
    if (now % 6 === 0) spawnRing(dim, center, "minecraft:endrod", g.r, 26);
    // buff the owner if inside
    const owner = entityById(dim, g.ownerId);
    if (owner && isValid(owner) && dist(owner.location, center) <= g.r) {
      try { owner.addEffect("speed", 40, { amplifier: 1, showParticles: false }); } catch (e) {}
      try { owner.addEffect("regeneration", 40, { amplifier: 1, showParticles: false }); } catch (e) {}
    }
    // purify players inside
    if (now % 20 === 0) {
      try {
        for (const p of playersInRange(dim, center, g.r)) {
          const gm = safeGameMode(p);
          if (gm === GameMode.creative || gm === GameMode.spectator) continue;
          try { p.addEffect("mining_fatigue", 40, { amplifier: 1, showParticles: false }); } catch (e) {}
          try { p.applyDamage(2, { cause: EntityDamageCause.magic, damagingEntity: owner }); } catch (e) {}
          try { p.onScreenDisplay.setActionBar("§6✟ Purification §7— leave the holy ground!"); } catch (e) {}
        }
      } catch (e) {}
    }
  }
}

// Blinding Counter — mirror guard. Sets a window; if struck (entityHurt), he
// negates it, blinds the attacker, and dash-bashes them.
function effectMirror(ent, target) {
  const s = stateFor(ent);
  s.mirrorUntil = system.currentTick + 30; // 1.5s
  triggerCast(ent, 30);
  spawnRing(ent.dimension, ent.location, "minecraft:endrod", 0.8, 10);
  try { ent.dimension.playSound("item.shield.block", ent.location, { pitch: 1.3 }); } catch (e) {}
}
function mirrorRiposte(ent, attacker) {
  const dim = ent.dimension;
  try { dim.spawnParticle("minecraft:wax_particle", { x: ent.location.x, y: ent.location.y + 1.4, z: ent.location.z }); } catch (e) {}
  try { dim.playSound("random.orb", ent.location, { pitch: 1.6, volume: 1.4 }); } catch (e) {}
  if (attacker && isValid(attacker)) {
    faceTarget(ent, attacker);
    try { attacker.addEffect("blindness", 60, { amplifier: 0 }); } catch (e) {}
    // dashing shoulder-bash
    const dir = norm(sub(attacker.location, ent.location));
    try { ent.applyKnockback(dir.x, dir.z, 2.0, 0.2); } catch (e) {}
    system.runTimeout(() => {
      if (!isValid(ent) || !isValid(attacker)) return;
      if (dist(ent.location, attacker.location) < 3.5) {
        const stage = clampStage(ent.getDynamicProperty("marauder:stageNum") ?? 10);
        hurt(attacker, ent, Math.round(stageDamage(stage) * 1.2));
        knockFrom(attacker, ent.location, 1.0, 0.4);
      }
    }, 5);
  }
}

// Spears of Hard-Light — 3 floating javelins launch in sequence; each detonates
// a beat after impact in a holy-fire burst.
function effectSpears(ent, target, base) {
  triggerCast(ent, 16);
  const dim = ent.dimension;
  try { dim.playSound("item.trident.throw", ent.location, { pitch: 1.2 }); } catch (e) {}
  const targetId = target.id;
  for (let n = 0; n < 3; n++) {
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      const t = entityById(dim, targetId);
      const start = { x: ent.location.x, y: ent.location.y + 1.6, z: ent.location.z };
      const aim = t && isValid(t) ? { x: t.location.x, y: t.location.y + 0.5, z: t.location.z } : { x: start.x, y: start.y, z: start.z + 3 };
      const dir = norm(sub(aim, start));
      // fast tracer
      for (let i = 1; i <= 18; i++) trySpawnParticle(dim, "minecraft:endrod", { x: start.x + dir.x * i, y: start.y + dir.y * i, z: start.z + dir.z * i });
      const impact = { x: start.x + dir.x * Math.min(18, dist(start, aim)), y: aim.y, z: start.z + dir.z * Math.min(18, dist(start, aim)) };
      try { dim.playSound("item.trident.hit", impact, { pitch: 1.0 }); } catch (e) {}
      // detonate after ~1s
      system.runTimeout(() => {
        if (!isValid(ent)) return;
        spawnRing(dim, impact, "minecraft:basic_flame_particle", 2.0, 20);
        spawnRing(dim, impact, "minecraft:endrod", 1.2, 12);
        try { dim.playSound("random.explode", impact, { pitch: 1.1, volume: 1.1 }); } catch (e) {}
        for (const v of victimsAt(dim, impact, 3.0)) {
          try { v.applyDamage(Math.max(1, Math.round(base * 0.6)), { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
          trueDamage(v, 4);
          try { v.setOnFire(3, true); } catch (e) {}
        }
      }, 20);
    }, n * 8);
  }
}

// ============================================================= SERAPHIM: DIVE-BOMB + GREATSWORD
// Dive-Bomb & Feather Rain — leaps up with a wind gust, hovers target-locking,
// crash-lands for heavy AoE + stun, then holy feathers rain down for area denial.
function effectDivebomb(ent, target, base) {
  const dim = ent.dimension;
  triggerCast(ent, 40);
  // wind gust pushback + leap
  spawnRing(dim, ent.location, "minecraft:knockback_roar_particle", 2.0, 16);
  for (const v of victimsNear(ent, 4.0, target, true)) { const a = norm(sub(v.location, ent.location)); try { v.applyKnockback(a.x, a.z, 1.4, 0.3); } catch (e) {} }
  try { ent.applyKnockback(0, 0, 0, 1.4); } catch (e) {}
  try { dim.playSound("mob.enderdragon.flap", ent.location, { pitch: 0.7, volume: 1.6 }); } catch (e) {}
  const targetId = target.id;
  // hover + target-lock (~1.5s), then crash where the target is.
  system.runTimeout(() => {
    if (!isValid(ent)) return;
    const t = entityById(dim, targetId);
    const pos = t && isValid(t) ? { x: t.location.x, y: t.location.y, z: t.location.z } : ent.location;
    try { ent.teleport({ x: pos.x, y: pos.y, z: pos.z }); } catch (e) {}
    spawnRing(dim, pos, "minecraft:basic_flame_particle", 3.5, 34);
    spawnRing(dim, pos, "minecraft:endrod", 2.0, 20);
    try { dim.spawnParticle("minecraft:huge_explosion_emitter", { x: pos.x, y: pos.y + 0.5, z: pos.z }); } catch (e) {}
    try { dim.playSound("random.explode", pos, { pitch: 0.5, volume: 2.0 }); } catch (e) {}
    for (const v of victimsAt(dim, pos, 4.5)) {
      try { v.applyDamage(Math.max(1, Math.round(base * 1.0)), { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
      trueDamage(v, 10);
      // 2-second stun: near-frozen + can't jump out
      try { v.addEffect("slowness", 40, { amplifier: 254 }); } catch (e) {}
      try { v.addEffect("jump_boost", 40, { amplifier: 128 }); } catch (e) {} // negative-style: prevents useful jump
      try { v.addEffect("weakness", 60, { amplifier: 2 }); } catch (e) {}
    }
    featherRain(dim, pos, ent);
  }, 30);
}
// Holy feathers rain over ~3s: delayed AoE motes falling around the crash site.
function featherRain(dim, center, ent) {
  const drops = 8 + Math.floor(Math.random() * 5);
  for (let i = 0; i < drops; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 4.5;
    const gx = center.x + Math.cos(a) * r, gz = center.z + Math.sin(a) * r;
    const delay = 6 + Math.floor(Math.random() * 54);
    // falling streak
    for (let k = 0; k < 4; k++) {
      system.runTimeout(() => trySpawnParticle(dim, "minecraft:endrod", { x: gx, y: center.y + 10 - k * 2.5, z: gz }), delay + k * 2);
    }
    // impact
    system.runTimeout(() => {
      spawnRing(dim, { x: gx, y: center.y, z: gz }, "minecraft:basic_flame_particle", 1.0, 8);
      try { dim.playSound("random.orb", { x: gx, y: center.y, z: gz }, { pitch: 1.4, volume: 0.5 }); } catch (e) {}
      for (const v of victimsAt(dim, { x: gx, y: center.y, z: gz }, 1.6)) {
        try { v.applyDamage(4, { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
        try { v.setOnFire(2, true); } catch (e) {}
      }
    }, delay + 8);
  }
}

// Flaming Greatsword Cleave — a slow, charged 180° frontal wave.
function effectCleave(ent, target, base) {
  const dim = ent.dimension;
  // The 1s charge is the ability's 20-tick windup (telegraphed by casting + flame).
  faceTarget(ent, target);
  const origin = ent.location;
  const fwd = norm(sub(target.location, origin));
  // charge flames along the blade
  for (let i = 0; i < 6; i++) system.runTimeout(() => { if (isValid(ent)) trySpawnParticle(dim, "minecraft:basic_flame_particle", { x: ent.location.x + fwd.x, y: ent.location.y + 1.4, z: ent.location.z + fwd.z }); }, i * 3);
  try { dim.playSound("mob.blaze.shoot", origin, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  try { dim.playSound("mob.player.attack.sweep", origin, { pitch: 0.6, volume: 1.6 }); } catch (e) {}
  // the wave: 180° frontal
  const R = 6.0;
  for (let ring = 1; ring <= 6; ring++) {
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      for (let deg = -90; deg <= 90; deg += 15) {
        const rad = Math.atan2(fwd.z, fwd.x) + deg * Math.PI / 180;
        trySpawnParticle(dim, "minecraft:basic_flame_particle", { x: origin.x + Math.cos(rad) * ring, y: origin.y + 0.6, z: origin.z + Math.sin(rad) * ring });
      }
    }, ring * 2);
  }
  for (const v of victimsNear(ent, R, target, true)) {
    const to = norm(sub(v.location, origin));
    if (fwd.x * to.x + fwd.z * to.z < 0) continue; // frontal 180°
    try { v.applyDamage(Math.max(1, Math.round(base * 1.1)), { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
    trueDamage(v, 8);
    try { v.setOnFire(5, true); } catch (e) {}
    const k = norm({ x: v.location.x - origin.x, y: 0, z: v.location.z - origin.z });
    try { v.applyKnockback(k.x, k.z, 2.4, 0.5); } catch (e) {}
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

// The crater destroys terrain of ANY kind (whatever a given Bedrock version calls
// it) but spares player builds and valuables. A blacklist is far more robust than
// a natural-terrain whitelist, whose exact ids differ between Bedrock versions
// (e.g. grass_block vs grass) — that mismatch made the old crater silently no-op.
const PROTECTED_EXACT = new Set([
  "minecraft:bedrock", "minecraft:barrier", "minecraft:command_block", "minecraft:repeating_command_block",
  "minecraft:chain_command_block", "minecraft:structure_block", "minecraft:jigsaw", "minecraft:structure_void",
  "minecraft:end_portal_frame", "minecraft:end_portal", "minecraft:end_gateway", "minecraft:reinforced_deepslate",
  "minecraft:obsidian", "minecraft:crying_obsidian", "minecraft:respawn_anchor", "minecraft:beacon",
  "minecraft:conduit", "minecraft:enchanting_table", "minecraft:ender_chest", "minecraft:mob_spawner",
  "minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel", "minecraft:furnace", "minecraft:blast_furnace",
  "minecraft:smoker", "minecraft:hopper", "minecraft:dispenser", "minecraft:dropper", "minecraft:crafting_table",
  "minecraft:cartography_table", "minecraft:smithing_table", "minecraft:loom", "minecraft:stonecutter",
  "minecraft:grindstone", "minecraft:brewing_stand", "minecraft:lectern", "minecraft:bookshelf",
  "minecraft:chiseled_bookshelf", "minecraft:bell", "minecraft:anvil", "minecraft:chipped_anvil",
  "minecraft:damaged_anvil", "minecraft:glass", "minecraft:tinted_glass", "minecraft:glowstone",
  "minecraft:sea_lantern", "minecraft:shulker_box", "minecraft:undyed_shulker_box", "minecraft:spawner",
]);
const PROTECTED_SUFFIX = [
  "_planks", "_stairs", "_slab", "_wall", "_fence", "_fence_gate", "_door", "_trapdoor",
  "_glass", "_glass_pane", "_wool", "_carpet", "_concrete", "_concrete_powder", "_terracotta",
  "_glazed_terracotta", "_bricks", "_sign", "_bed", "_banner", "_shulker_box", "_log", "_wood",
  "_stem", "_hyphae", "_button", "_pressure_plate", "_candle",
];
function isProtectedBlock(id) {
  if (!id) return true;
  if (PROTECTED_EXACT.has(id)) return true;
  for (const s of PROTECTED_SUFFIX) if (id.endsWith(s)) return true;
  return false;
}

// A single divine strike at `loc`. Fire (for the ignite + hurt-flash) plus a big
// TRUE-DAMAGE core that ARMOR CANNOT reduce — the old version only did fire, which
// heavy armor shrugged off, so it "did too little." `victimsAt` centers on the
// strike, not the marauder, so it lands where the beam telegraphed.
function divineStrike(ent, loc, isFinal) {
  const dim = ent.dimension;
  const RADIUS = 4.5, CORE = 3.0;
  const fireDmg = isFinal ? 8 : 6;
  const coreTrue = isFinal ? 16 : 10;

  for (const v of victimsAt(dim, loc, RADIUS)) {
    try { v.applyDamage(fireDmg, { cause: EntityDamageCause.fire, damagingEntity: ent }); } catch (e) {}
    try { v.setOnFire(6, true); } catch (e) {}
    // Full true damage at the core; the outer ring still takes half — unavoidable
    // by armor, so the strike actually threatens a geared player.
    const inCore = dist(v.location, loc) <= CORE;
    trueDamage(v, inCore ? coreTrue : Math.round(coreTrue * 0.5));
    if (isFinal) {
      const away = norm({ x: v.location.x - loc.x, y: 0, z: v.location.z - loc.z });
      try { v.applyKnockback(away.x, away.z, 1.4, 1.1); } catch (e) {}
    }
  }

  // Crater: gouge terrain of any type; spare builds/valuables (isProtectedBlock).
  const cx = Math.floor(loc.x), cy = Math.floor(loc.y), cz = Math.floor(loc.z);
  const air = BlockPermutation.resolve("minecraft:air");
  const R = 3;
  for (let dx = -R; dx <= R; dx++) {
    for (let dy = -2; dy <= 1; dy++) {
      for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue; // round the crater
        try {
          const block = dim.getBlock({ x: cx + dx, y: cy + dy, z: cz + dz });
          if (!block || block.isAir || isProtectedBlock(block.typeId)) continue;
          block.setPermutation(air);
        } catch (e) { /* unloaded / read-only — skip */ }
      }
    }
  }

  // VFX: flame nova + endrod ring + explosion.
  spawnRing(dim, loc, "minecraft:basic_flame_particle", isFinal ? 4.0 : 3.0, isFinal ? 40 : 32);
  spawnRing(dim, loc, "minecraft:endrod", 2.0, 18);
  try { dim.spawnParticle("minecraft:huge_explosion_emitter", { x: loc.x, y: loc.y + 0.5, z: loc.z }); } catch (e) {}
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
    // A meter-triggered Seraphim burns down; an HP-triggered (<=50%) one is permanent.
    const permanent = ent.getDynamicProperty("marauder:seraphPermanent") === true;
    const meter = permanent ? 100 : Math.max(0, getFracture(ent) - FRACTURE_DECAY);
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
    if (!permanent && meter <= 0) { seraphOff(ent); return; }
    // Throttled meter readout on the boss bar.
    if (system.currentTick % 20 === 0) updateTitle(ent);
  }
}

// ============================================================= FRACTURED: THE ADAPTATION HALO
// Mahoraga-style: his halo "learns" the damage type it keeps eating and builds a
// stacking resistance to it (15% per stack, cap 45%). Hit him with something else
// and the old resistance erodes while the new one builds — forcing weapon rotation.
const ADAPT_THRESHOLD = 30; // damage of one type absorbed per stack gained/lost
const ADAPT_PER_STACK = 0.15;
const ADAPT_MAX_STACKS = 3;

function damageCategory(cause) {
  switch (cause) {
    case "entityAttack": case "entity_attack": return "melee";
    case "projectile": case "arrow": case "thrown": return "projectile";
    case "fire": case "fireTick": case "fire_tick": case "lava": case "magic":
    case "wither": case "soul_campfire": case "campfire": case "fireworks": return "firemagic";
    case "entityExplosion": case "entity_explosion":
    case "blockExplosion": case "block_explosion": return "explosive";
    default: return null;
  }
}
const CATEGORY_LABEL = { melee: "MELEE", projectile: "PROJECTILE", firemagic: "FIRE/MAGIC", explosive: "EXPLOSIVE" };

function adaptState(ent) {
  const s = stateFor(ent);
  if (!s.adapt) s.adapt = { cat: null, stacks: 0, build: 0, erode: 0 };
  return s.adapt;
}
function adaptTo(ent, cause, dmg) {
  const cat = damageCategory(cause);
  if (!cat || dmg <= 0) return;
  const a = adaptState(ent);
  if (a.stacks === 0 || cat === a.cat) {
    if (a.stacks === 0) a.cat = cat;
    a.build += dmg; a.erode = 0;
    if (a.build >= ADAPT_THRESHOLD && a.stacks < ADAPT_MAX_STACKS) {
      a.stacks++; a.build = 0; adaptProc(ent, a.cat, a.stacks, true);
    }
  } else {
    a.erode += dmg;
    if (a.erode >= ADAPT_THRESHOLD) {
      a.erode = 0; a.stacks = Math.max(0, a.stacks - 1); adaptProc(ent, a.cat, a.stacks, false);
      if (a.stacks === 0) { a.cat = cat; a.build = dmg; }
    }
  }
  updateTitle(ent);
}
function adaptationResist(ent, cause) {
  const s = combat.get(ent.id);
  if (!s || !s.adapt || s.adapt.stacks === 0) return 0;
  if (damageCategory(cause) !== s.adapt.cat) return 0;
  return Math.min(0.45, s.adapt.stacks * ADAPT_PER_STACK);
}
function adaptProc(ent, cat, stacks, gained) {
  // Echoing clockwork chime + a ring of light spinning off the halo.
  const head = { x: ent.location.x, y: ent.location.y + 2.4, z: ent.location.z };
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    trySpawnParticle(ent.dimension, "minecraft:endrod", { x: head.x + Math.cos(a) * 1.1, y: head.y, z: head.z + Math.sin(a) * 1.1 });
  }
  try { ent.dimension.playSound(gained ? "block.bell.hit" : "note.bell", ent.location, { pitch: gained ? 1.2 : 0.7, volume: 1.2 }); } catch (e) {}
  try { ent.setProperty("marauder:casting", true); } catch (e) {}
  system.runTimeout(() => { try { if (isValid(ent) && !stateFor(ent).current) ent.setProperty("marauder:casting", false); } catch (e) {} }, 8);
  overseerAnnounceGeneric(ent, gained
    ? `§b✦ Adapted to ${CATEGORY_LABEL[cat]} §7(${Math.round(Math.min(45, stacks * 15))}% resist)`
    : `§7Resistance to ${CATEGORY_LABEL[cat]} erodes §8(${Math.round(stacks * 15)}%)`);
}
function adaptLabel(ent) {
  const s = combat.get(ent.id);
  if (!s || !s.adapt || s.adapt.stacks === 0) return "";
  return ` §b[${CATEGORY_LABEL[s.adapt.cat]} ${Math.round(Math.min(45, s.adapt.stacks * 15))}%]`;
}
// Small actionbar broadcaster reused by several systems.
function overseerAnnounceGeneric(ent, text) {
  try {
    for (const p of playersInRange(ent.dimension, ent.location, 36)) {
      try { p.onScreenDisplay.setActionBar(text); } catch (e) {}
    }
  } catch (e) {}
}

// ============================================================= PART 1: THE OVERSEER (FALLEN KING)
// The corrupted final phase: the stage-10 Marauder dies and rises as the Overseer.
// He fights in two stances (scythe / crossbow), barks King's Orders, parries into
// a bleeding impale, and at 50% HP raises Fallen Knights behind a Royal Aegis.

// Rise from the fallen Marauder at `loc`, inheriting the owner.
function emergeOverseer(dim, loc, ownerId) {
  let ovr;
  try { ovr = dim.spawnEntity(OVERSEER, loc); } catch (e) { console.warn(`[Marauder] Overseer spawnEntity threw: ${e?.stack || e}`); return null; }
  if (!ovr) { console.warn("[Marauder] Overseer spawnEntity returned null"); return null; }
  if (ownerId) ovr.setDynamicProperty("marauder:owner", ownerId);
  ovr.setDynamicProperty("marauder:stageNum", STAGE_MAX);
  ovr.setDynamicProperty("marauder:knightsUsed", false);
  applyHealthMult(ovr);
  const s = stateFor(ovr);
  s.stance = "melee"; s.phaseLock = true; s.emergeUntil = system.currentTick + 80;
  try { ovr.triggerEvent("marauder:emerge_on"); } catch (e) {}
  try { ovr.triggerEvent("marauder:become_boss"); } catch (e) {}
  try { ovr.setProperty("marauder:kneeling", true); } catch (e) {}
  if (world.getDynamicProperty("marauder:ffa") === true) { try { ovr.triggerEvent("marauder:ffa_on"); } catch (e) {} }
  ovr.nameTag = "§4The Overseer §8— §cFallen King (rising…)";

  // Armor-shattering debris + heavy metallic breaks over the 4-second rise.
  const owner = ownerId ? world.getAllPlayers().find(p => p.id === ownerId) : null;
  if (owner) {
    try { owner.onScreenDisplay.setTitle("§4THE OVERSEER", { fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: "§8The Fallen King rises" }); } catch (e) {}
  }
  try { dim.playSound("mob.wither.spawn", loc, { pitch: 0.5, volume: 1.6 }); } catch (e) {}
  for (let i = 0; i < 4; i++) {
    system.runTimeout(() => {
      if (!isValid(ovr)) return;
      const c = ovr.location;
      spawnRing(dim, c, "minecraft:basic_flame_particle", 1.0 + i * 0.4, 20);
      try { dim.spawnParticle("minecraft:knockback_roar_particle", { x: c.x, y: c.y + 0.4, z: c.z }); } catch (e) {}
      try { dim.playSound("random.anvil_land", c, { pitch: 0.6, volume: 1.0 }); } catch (e) {}
      try { dim.spawnItem(new ItemStack(i % 2 ? "marauder:blacksteel_fragment" : "marauder:ashen_shard", 1), { x: c.x, y: c.y + 1, z: c.z }); } catch (e) {}
    }, 12 + i * 16);
  }
  // End of emerge: unlock and begin the real fight.
  system.runTimeout(() => {
    if (!isValid(ovr)) return;
    try { ovr.triggerEvent("marauder:emerge_off"); } catch (e) {}
    try { ovr.triggerEvent("marauder:melee_on"); } catch (e) {}
    try { ovr.setProperty("marauder:kneeling", false); } catch (e) {}
    const st = stateFor(ovr); st.phaseLock = false; st.stance = "melee";
    updateTitle(ovr);
    try { dim.playSound("mob.enderdragon.growl", ovr.location, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  }, 82);
  return ovr;
}

function applyHealthMult(ent) {
  const mult = Number(cfg("bossHealthMult")) || 1;
  if (mult === 1) return;
  try {
    const h = ent.getComponent("minecraft:health");
    if (h) { const m = (h.effectiveMax ?? h.defaultValue) * mult; /* raise cap via resetToMaxValue after event not available; scale current */ h.setCurrentValue(Math.min(h.effectiveMax ?? m, (h.effectiveMax ?? m))); }
  } catch (e) {}
}

function overseerTitle(ent) {
  const s = combat.get(ent.id);
  let tag = "§4The Overseer §8— §cFallen King";
  if (s && s.phaseLock) tag = "§4The Overseer §8— §cFallen King (rising…)";
  else if (knightsAlive(ent) > 0) tag = "§4The Overseer §8— §bRoyal Aegis §7(" + knightsAlive(ent) + ")";
  else if (s && s.stance === "ranged") tag = "§4The Overseer §8— §eKing's Crossbow";
  try { ent.nameTag = tag; } catch (e) {}
}

function knightsAlive(ovr) {
  try {
    return ovr.dimension.getEntities({ type: FALLEN_KNIGHT })
      .filter(k => isValid(k) && k.getDynamicProperty("marauder:master") === ovr.id).length;
  } catch (e) { return 0; }
}

function tickOverseer(ent, s, now) {
  // Emerge lock — invulnerable, kneeling, no actions.
  if (s.phaseLock) { if (now >= (s.emergeUntil || 0)) s.phaseLock = false; else return; }

  if (s.swingUntil && now >= s.swingUntil) { s.swingUntil = 0; setAttacking(ent, false); }
  if (s.castUntil && now >= s.castUntil) { s.castUntil = 0; setCasting(ent, false); }
  if (s.poseUntil && now >= s.poseUntil) { s.poseUntil = 0; clearPoses(ent); }

  const owner = ownerOf(ent);
  if (owner && (owner.dimension.id !== ent.dimension.id || dist(owner.location, ent.location) > LEASH_RANGE)) { retreat(ent); return; }

  // Cooldowns.
  if (s.globalCd > 0) s.globalCd -= COMBAT_INTERVAL;

  // Royal Aegis: at 50% HP (first time) summon knights + raise the shield.
  if (!ent.getDynamicProperty("marauder:knightsUsed") && healthPct(ent) <= 0.5) {
    summonFallenKnights(ent, s, now); return;
  }
  // Maintain the aegis while knights live; drop it (and bark) when they fall.
  const alive = knightsAlive(ent);
  if (s.aegis && alive === 0) {
    s.aegis = false;
    try { ent.triggerEvent("marauder:aegis_off"); } catch (e) {}
    try { ent.triggerEvent("marauder:ranged_off"); } catch (e) {}
    s.stance = "melee";
    overseerAnnounce(ent, "§cThe Aegis shatters!");
    try { ent.dimension.playSound("mob.wither.break_block", ent.location, { volume: 1.4 }); } catch (e) {}
  }

  const target = pickTarget(ent, s, owner, now);
  if (!target) return;
  overseerTitle(ent);
  const d = dist(ent.location, target.location);

  // While the aegis holds he stays back, bolsters his knights, and fires.
  if (s.aegis && alive > 0) {
    if (now >= (s.nextBolster || 0)) { s.nextBolster = now + 120; bolsterKnights(ent); }
    if (s.globalCd <= 0) { overseerVolley(ent, target); s.globalCd = 45; }
    return;
  }

  // King's Orders on a 10–15s cadence.
  if (now >= (s.nextOrder || (s.nextOrder = now + 160))) {
    s.nextOrder = now + 200 + Math.floor(Math.random() * 100);
    kingsOrder(ent, s, target, now);
    return;
  }

  if (s.globalCd > 0) return;

  // Pressure → backstep into ranged stance.
  s.pressure = d <= 3 ? (s.pressure || 0) + COMBAT_INTERVAL : 0;
  if (s.stance !== "ranged" && s.pressure >= 80) {
    overseerBackstep(ent, target, s, now);
    return;
  }
  if (s.stance === "ranged") {
    // Kite: if the mark closes the gap, hop back so he actually "stays back"
    // and fires. His melee_attack behavior is removed in this stance (ranged_on),
    // so he won't just walk back into melee.
    if (d < 4.5) {
      const away = norm(sub(ent.location, target.location));
      try { ent.applyKnockback(away.x, away.z, 1.1, 0.25); } catch (e) {}
    }
    overseerVolley(ent, target);
    s.globalCd = 45;
    if (now >= (s.stanceUntil || 0)) { s.stance = "melee"; try { ent.triggerEvent("marauder:ranged_off"); } catch (e) {} try { ent.setProperty("marauder:stance", 0); } catch (e) {} }
    return;
  }
  // Melee stance: parry, then heavy scythe slash.
  const roll = Math.random();
  if (roll < 0.28 && d <= 6) { overseerParry(ent, s, now); s.globalCd = 60; }
  else if (d <= 5.0) { overseerSlash(ent, target); s.globalCd = 34; }
}

function overseerDamage(base) { return Math.round(base * (Number(cfg("bossDamageMult")) || 1)); }

function overseerAnnounce(ent, text) {
  for (const p of playersInRange(ent.dimension, ent.location, 40)) {
    try { p.onScreenDisplay.setActionBar(text); } catch (e) {}
  }
}

// -------- scythe stance --------
function overseerSlash(ent, target) {
  setPose(ent, "slash");
  stateFor(ent).poseUntil = system.currentTick + SWING_TICKS + 3;
  faceTarget(ent, target);
  const dim = ent.dimension, origin = ent.location;
  const fwd = norm(sub(target.location, origin));
  system.runTimeout(() => {
    if (!isValid(ent)) return;
    for (let i = 1; i <= 4; i++) trySpawnParticle(dim, "minecraft:critical_hit_emitter", { x: origin.x + fwd.x * i, y: origin.y + 1, z: origin.z + fwd.z * i });
    try { dim.playSound("mob.player.attack.sweep", origin, { pitch: 0.7, volume: 1.3 }); } catch (e) {}
    for (const v of victimsNear(ent, 4.5, target, true)) {
      const to = norm(sub(v.location, origin));
      if (fwd.x * to.x + fwd.z * to.z < 0.35) continue;
      hurt(v, ent, overseerDamage(14));
      const k = norm({ x: v.location.x - origin.x, y: 0, z: v.location.z - origin.z });
      try { v.applyKnockback(k.x, k.z, 1.2, 0.4); } catch (e) {}
    }
  }, 6);
}

// -------- backstep + afterimage → ranged --------
function overseerBackstep(ent, target, s, now) {
  const dim = ent.dimension, loc = ent.location;
  let ghost;
  try { ghost = dim.spawnEntity(AFTERIMAGE, loc); } catch (e) {}
  if (ghost) { try { ghost.setDynamicProperty("marauder:dodgePhantom", true); } catch (e) {} system.runTimeout(() => { try { poof(dim, ghost.location); ghost.remove(); } catch (e) {} }, 24); }
  poof(dim, loc);
  const away = norm(sub(loc, target.location));
  try { ent.applyKnockback(away.x, away.z, 2.0, 0.5); } catch (e) {}
  try { dim.playSound("mob.endermen.portal", loc, { pitch: 0.8 }); } catch (e) {}
  s.stance = "ranged"; s.pressure = 0; s.stanceUntil = now + 120; s.globalCd = 20;
  try { ent.triggerEvent("marauder:ranged_on"); } catch (e) {}
  try { ent.setProperty("marauder:stance", 1); } catch (e) {}
}

// -------- crossbow stance: 3 homing spectral bolts --------
function overseerVolley(ent, target) {
  setPose(ent, "aim");
  stateFor(ent).poseUntil = system.currentTick + 26;
  faceTarget(ent, target);
  const dim = ent.dimension;
  try { dim.playSound("item.crossbow.loading_end", ent.location, { pitch: 0.8, volume: 1.2 }); } catch (e) {}
  const targetId = target.id;
  for (let n = 0; n < 3; n++) {
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      try { dim.playSound("item.crossbow.shoot", ent.location, { pitch: 1.0 + n * 0.1 }); } catch (e) {}
      spectralBolt(ent, targetId, (n - 1) * 0.25);
    }, 4 + n * 4);
  }
}

// A scripted homing "spectral arrow": a glowing point that steers toward the mark.
function spectralBolt(ent, targetId, spreadYaw) {
  const dim = ent.dimension;
  let pos = { x: ent.location.x, y: ent.location.y + 1.3, z: ent.location.z };
  const t0 = entityById(dim, targetId);
  let dir = t0 ? norm(sub({ x: t0.location.x, y: t0.location.y + 1, z: t0.location.z }, pos)) : { x: 0, y: 0, z: 1 };
  // apply spread (rotate around Y)
  const cs = Math.cos(spreadYaw), sn = Math.sin(spreadYaw);
  dir = { x: dir.x * cs - dir.z * sn, y: dir.y, z: dir.x * sn + dir.z * cs };
  const speed = 1.1;
  let life = 40;
  const handle = system.runInterval(() => {
    if (!isValid(ent) || life-- <= 0) { system.clearRun(handle); return; }
    const t = entityById(dim, targetId);
    if (t && isValid(t)) {
      const want = norm(sub({ x: t.location.x, y: t.location.y + 1, z: t.location.z }, pos));
      dir = norm({ x: dir.x + want.x * 0.35, y: dir.y + want.y * 0.35, z: dir.z + want.z * 0.35 }); // homing
    }
    pos = { x: pos.x + dir.x * speed, y: pos.y + dir.y * speed, z: pos.z + dir.z * speed };
    trySpawnParticle(dim, "minecraft:endrod", pos);
    // hit test
    for (const v of victimsAt(dim, pos, 1.2)) {
      hurt(v, ent, overseerDamage(7));
      try { v.addEffect("glowing", 60, { amplifier: 0 }); } catch (e) {}
      system.clearRun(handle); return;
    }
    try { const b = dim.getBlock(pos); if (b && !b.isAir) { system.clearRun(handle); } } catch (e) {}
  }, 1);
}

// -------- parry stance --------
function overseerParry(ent, s, now) {
  s.parryUntil = now + 24; // ~1.2s window
  setPose(ent, "guard");
  s.poseUntil = now + 28;
  try { ent.dimension.playSound("item.shield.block", ent.location, { pitch: 0.7, volume: 1.2 }); } catch (e) {}
  trySpawnParticle(ent.dimension, "minecraft:balloon_gas_particle", { x: ent.location.x, y: ent.location.y + 1.4, z: ent.location.z });
}

// The counter, fired from the entityHurt handler when he is struck mid-parry.
function overseerRiposte(ent, attacker) {
  const dim = ent.dimension;
  spawnRing(dim, ent.location, "minecraft:critical_hit_emitter", 1.5, 16);
  try { dim.playSound("random.anvil_use", ent.location, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  if (attacker && isValid(attacker)) {
    faceTarget(ent, attacker);
    // Stun + overhead impale → bleed.
    try { attacker.addEffect("slowness", 40, { amplifier: 4 }); } catch (e) {}
    try { attacker.addEffect("weakness", 40, { amplifier: 1 }); } catch (e) {}
    hurt(attacker, ent, overseerDamage(12));
    applyBleed(attacker, 160);
    setPose(ent, "slash"); stateFor(ent).poseUntil = system.currentTick + SWING_TICKS;
  }
}

// -------- King's Orders --------
function kingsOrder(ent, s, target, now) {
  const orders = ["halt", "kneel", "scatter"];
  const which = orders[Math.floor(Math.random() * orders.length)];
  const dim = ent.dimension;
  setPose(ent, "cast");
  s.poseUntil = now + 34;
  if (which === "halt") {
    overseerAnnounce(ent, "§4§lOrder: §cHALT!");
    try { dim.playSound("mob.evocation_illager.prepare_summon", ent.location, { pitch: 0.7, volume: 1.4 }); } catch (e) {}
    for (const p of playersNearEnt(ent, 24)) {
      try { p.addEffect("slowness", 50, { amplifier: 254 }); } catch (e) {}
      try { p.addEffect("weakness", 50, { amplifier: 2 }); } catch (e) {}
      try { p.addEffect("mining_fatigue", 50, { amplifier: 2 }); } catch (e) {}
    }
  } else if (which === "kneel") {
    overseerAnnounce(ent, "§4§lOrder: §cKNEEL! §7(sneak!)");
    try { dim.playSound("mob.wither.ambient", ent.location, { pitch: 0.5, volume: 1.4 }); } catch (e) {}
    const marks = playersNearEnt(ent, 24).map(p => p.id);
    system.runTimeout(() => {
      if (!isValid(ent)) return;
      for (const p of playersNearEnt(ent, 26)) {
        if (!marks.includes(p.id)) continue;
        let sneaking = false; try { sneaking = p.isSneaking; } catch (e) {}
        if (sneaking) { try { p.onScreenDisplay.setActionBar("§aYou knelt."); } catch (e) {} continue; }
        hurt(p, ent, overseerDamage(16));
        trueDamage(p, 6);
        try { p.addEffect("weakness", 140, { amplifier: 3 }); } catch (e) {}
        try { p.addEffect("slowness", 140, { amplifier: 3 }); } catch (e) {}
        spawnRing(dim, p.location, "minecraft:basic_flame_particle", 1.5, 16);
        try { dim.playSound("random.explode", p.location, { pitch: 0.7, volume: 1.2 }); } catch (e) {}
      }
    }, 30);
  } else {
    overseerAnnounce(ent, "§4§lOrder: §cSCATTER!");
    try { dim.playSound("mob.warden.sonic_boom", ent.location, { volume: 1.2 }); } catch (e) {}
    spawnRing(dim, ent.location, "minecraft:knockback_roar_particle", 2.5, 20);
    for (const p of playersNearEnt(ent, 12)) {
      const away = norm({ x: p.location.x - ent.location.x, y: 0, z: p.location.z - ent.location.z });
      try { p.applyKnockback(away.x, away.z, 3.2, 0.7); } catch (e) {}
    }
    // Instantly transition to crossbow.
    s.stance = "ranged"; s.stanceUntil = now + 120;
    try { ent.triggerEvent("marauder:ranged_on"); } catch (e) {}
    try { ent.setProperty("marauder:stance", 1); } catch (e) {}
  }
  s.globalCd = 40;
}

// -------- Fallen Knights + Royal Aegis --------
function summonFallenKnights(ent, s, now) {
  ent.setDynamicProperty("marauder:knightsUsed", true);
  s.aegis = true; s.stance = "ranged"; s.stanceUntil = now + 999999; s.globalCd = 60;
  try { ent.triggerEvent("marauder:aegis_on"); } catch (e) {}
  try { ent.triggerEvent("marauder:ranged_on"); } catch (e) {}
  try { ent.setProperty("marauder:stance", 1); } catch (e) {}
  overseerAnnounce(ent, "§4§lRISE, MY KNIGHTS!");
  try { ent.dimension.playSound("mob.wither.spawn", ent.location, { pitch: 0.6, volume: 1.6 }); } catch (e) {}
  const dim = ent.dimension;
  const count = Math.max(1, Math.min(6, Number(cfg("knightCount")) || 3));
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count;
    const spot = findSafeNear(dim, { x: ent.location.x + Math.cos(a) * 4, y: ent.location.y, z: ent.location.z + Math.sin(a) * 4 }, 2);
    let k;
    try { k = dim.spawnEntity(FALLEN_KNIGHT, spot); } catch (e) { continue; }
    k.setDynamicProperty("marauder:master", ent.id);
    try { k.triggerEvent("marauder:rise_on"); } catch (e) {}
    spawnRing(dim, spot, "minecraft:basic_flame_particle", 1.0, 12);
    const kref = k;
    system.runTimeout(() => { try { if (isValid(kref)) kref.triggerEvent("marauder:rise_off"); } catch (e) {} }, 20);
  }
  updateTitle(ent);
}

function bolsterKnights(ent) {
  overseerAnnounce(ent, "§4§lOrder: §eBOLSTER!");
  try { ent.dimension.playSound("beacon.power", ent.location, { pitch: 0.8 }); } catch (e) {}
  for (const k of ent.dimension.getEntities({ type: FALLEN_KNIGHT })) {
    if (k.getDynamicProperty("marauder:master") !== ent.id) continue;
    try { k.addEffect("speed", 160, { amplifier: 1 }); } catch (e) {}
    try { k.addEffect("strength", 160, { amplifier: 1 }); } catch (e) {}
    trySpawnParticle(ent.dimension, "minecraft:endrod", { x: k.location.x, y: k.location.y + 1.4, z: k.location.z });
  }
}

// -------- bleed system (shared: Overseer impale) --------
function applyBleed(player, ticks) {
  try { player.setDynamicProperty("marauder:bleedUntil", system.currentTick + ticks); } catch (e) {}
  try { player.onScreenDisplay.setActionBar("§4✚ Bleeding!"); } catch (e) {}
}
function isBleeding(player) {
  try { return (player.getDynamicProperty("marauder:bleedUntil") ?? 0) > system.currentTick; } catch (e) { return false; }
}

function triggerCast(ent, ticks) {
  setCasting(ent, true);
  stateFor(ent).castUntil = system.currentTick + (ticks || 16);
}
function playersNearEnt(ent, range) {
  const out = [];
  try {
    for (const p of playersInRange(ent.dimension, ent.location, range)) {
      const gm = safeGameMode(p);
      if (gm !== GameMode.creative && gm !== GameMode.spectator) out.push(p);
    }
  } catch (e) {}
  return out;
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

// Engine-proof player query. Some engine builds do NOT return players from
// dimension.getEntities() — the same quirk already worked around in entityById.
// Every AoE that queried players through the dimension (halo strikes, King's
// Orders, the arena, victimsNear/At...) silently hit nobody on those builds,
// which is why the divine beam "did no damage". world.getAllPlayers() is
// reliable everywhere, so all player lookups now route through here.
function playersInRange(dim, loc, range) {
  const out = [];
  try {
    for (const p of world.getAllPlayers()) {
      if (!isValid(p)) continue;
      try {
        if (p.dimension.id === dim.id && dist(p.location, loc) <= range) out.push(p);
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

// Everything an AoE ability may strike: players always; other mobs when free-for-all
// is armed, when forceMobs is set, or when the primary mark itself is a mob (a Brawl
// Stick grudge). Never the marauder itself, another marauder, or an afterimage.
function victimsNear(ent, range, primary, forceMobs) {
  const includeMobs = forceMobs === true || isFFA() || isMobId(primary);
  const out = [];
  const seen = new Set();
  for (const p of playersInRange(ent.dimension, ent.location, range)) {
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
    for (const p of playersInRange(dim, loc, range)) {
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

// --- pose system: give every move a distinct, readable silhouette ---
// The animation controller shows one stance at a time (swing / cast / slash /
// aim / guard). setPose raises exactly one of these and lowers the rest, so
// players can actually tell which attack is coming instead of a generic wobble.
const POSE_PROPS = ["attacking", "casting", "slash", "aim", "guard"];
const POSE_TO_PROP = { swing: "attacking", cast: "casting", slash: "slash", aim: "aim", guard: "guard" };
function setPose(ent, pose) {
  const keep = POSE_TO_PROP[pose];
  for (const p of POSE_PROPS) { try { if (isValid(ent)) ent.setProperty("marauder:" + p, p === keep); } catch (e) {} }
}
function clearPoses(ent) {
  for (const p of POSE_PROPS) { try { if (isValid(ent)) ent.setProperty("marauder:" + p, false); } catch (e) {} }
}
// The wind-up stance each telegraphed ability strikes from. omni + grit are
// special-cased (omni has its own six-arm clip; grit is a feint that must read
// as a normal swing).
const ABILITY_POSE = {
  shock: "slash", guard: "guard", lunge: "slash", cinder: "cast", mirage: "cast",
  brand: "cast", flash: "cast", beam: "aim", skyfall: "slash", tether: "aim",
  arena: "cast", mirror: "guard", spears: "aim", wingsweep: "slash",
  divebomb: "aim", cleave: "slash",
};
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

  // Overseer lands a basic melee hit -> show a swing, unless a scripted move
  // (slash / aim / guard / order) already owns the pose this instant.
  if (attacker.typeId === OVERSEER) {
    const os = combat.get(attacker.id);
    if (!os || !(os.poseUntil && system.currentTick < os.poseUntil)) {
      try { attacker.setProperty("marauder:attacking", true); } catch (e) {}
      const oref = attacker;
      system.runTimeout(() => { try { if (isValid(oref)) oref.setProperty("marauder:attacking", false); } catch (e) {} }, SWING_TICKS);
    }
    return;
  }

  // Fallen Knight lands a hit -> show a swing (its melee_attack has no built-in
  // animation, which is why the guards previously looked like they did nothing).
  if (attacker.typeId === FALLEN_KNIGHT) {
    try { attacker.setProperty("marauder:attacking", true); } catch (e) {}
    const kref = attacker;
    system.runTimeout(() => { try { if (isValid(kref)) kref.setProperty("marauder:attacking", false); } catch (e) {} }, SWING_TICKS);
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

// Death intercept for the stage-10 → Overseer transition. Runs the moment a
// FATAL hit lands (entityHurt), while the dying entity is still fully readable —
// entityDie on some engine builds can't reliably read the corpse's dimension or
// dynamic properties (and mis-attributes some killing blows), which is why the
// transition sometimes never happened in-game. Guarded by marauder:risen so the
// entityDie backup path can't double-spawn. Works for ANY killer (player, mob,
// environment) — sandbox deaths transition too.
function interceptBossDeath(victim, s) {
  if (victim.typeId !== MARAUDER) return false;
  let risen = false;
  try { risen = victim.getDynamicProperty("marauder:risen") === true; } catch (e) {}
  if (risen) return true;
  const stage = clampStage(victim.getDynamicProperty("marauder:stageNum") ?? 1);
  if (stage < STAGE_MAX || Number(cfg("overseerPhase")) !== 1) return false;
  try { victim.setDynamicProperty("marauder:risen", true); } catch (e) {}
  try { victim.setDynamicProperty("marauder:lastStandUsed", true); } catch (e) {} // no revive from the grave
  if (s) s.phaseLock = true;
  const dim = victim.dimension;
  const loc = { x: victim.location.x, y: victim.location.y, z: victim.location.z };
  const oid = victim.getDynamicProperty("marauder:owner");
  system.run(() => {
    try { emergeOverseer(dim, loc, oid); }
    catch (e) { console.warn(`[Marauder] Overseer emerge (death intercept) failed: ${e?.stack || e}`); }
  });
  return true;
}

// AFTER damage applies. Not cancellable — we heal the hit back instead.
safeSub("entityHurt", world.afterEvents?.entityHurt, ev => {
  const victim = ev.hurtEntity;
  if (!victim) return;

  // Bleeding players suffer +50% from every incoming hit (top up after the fact).
  if (victim.typeId === "minecraft:player" && isBleeding(victim)) {
    const extra = Math.round((ev.damage || 0) * 0.5);
    const src = ev.damageSource?.damagingEntity;
    if (extra > 0) { try { victim.applyDamage(extra, { cause: EntityDamageCause.entityAttack, damagingEntity: src }); } catch (e) {} }
    return;
  }

  if (victim.typeId === AFTERIMAGE) { poof(victim.dimension, victim.location); return; }

  const now = system.currentTick;
  const attacker = ev.damageSource?.damagingEntity;
  const dmg = ev.damage || 0;

  // The Overseer: aegis is handled by his JSON group; here we only resolve the
  // parry riposte and track aggro. (No dodge / halo / last-stand.)
  if (victim.typeId === OVERSEER) {
    const s = stateFor(victim);
    if (attacker && !isMarauderKind(attacker.typeId)) { s.aggroId = attacker.id; s.aggroTick = now; }
    // A fatal hit ends it — never parry-negate a killing blow back to life.
    try { const oh = victim.getComponent("minecraft:health"); if (oh && oh.currentValue <= 0.001) return; } catch (e) {}
    if (s.parryUntil && now < s.parryUntil && attacker && attacker.typeId === "minecraft:player") {
      s.parryUntil = 0;
      const h = victim.getComponent("minecraft:health");
      if (h) { try { h.setCurrentValue(Math.min(maxHp(victim), h.currentValue + dmg)); } catch (e) {} } // negate the hit
      try { overseerRiposte(victim, attacker); } catch (e) {}
    }
    overseerTitle(victim);
    return;
  }

  if (victim.typeId !== MARAUDER && victim.typeId !== FRACTURED) return;

  const s = stateFor(victim);

  if (attacker && !isMarauderKind(attacker.typeId)) {
    s.aggroId = attacker.id;
    s.aggroTick = now;
  }

  // Fractured Marauder: Mahoraga-style adaptation — build resistance to the damage
  // type he keeps eating, healing back the adapted fraction.
  if (isFractured(victim) && Number(cfg("adaptationEnabled")) === 1) {
    try { adaptTo(victim, ev.damageSource?.cause, dmg); } catch (e) {}
  }

  const health = victim.getComponent("minecraft:health");
  if (!health) return;
  const max = maxHp(victim);

  // The hit was FATAL: never heal a corpse back (that can wedge the entity in a
  // 0-HP zombie state and eat the death event), and raise the Overseer from
  // right here while the entity is still readable.
  if (health.currentValue <= 0.001) {
    try { interceptBossDeath(victim, s); } catch (e) {}
    return;
  }

  const healBack = (amt) => { try { health.setCurrentValue(Math.min(max, health.currentValue + amt)); } catch (e) {} };

  // Blinding Counter (Mirror Guard) — negate + blind + shoulder-bash if struck mid-guard.
  if (isFractured(victim) && s.mirrorUntil && now < s.mirrorUntil && attacker && attacker.typeId === "minecraft:player") {
    s.mirrorUntil = 0;
    healBack(dmg);
    try { mirrorRiposte(victim, attacker); } catch (e) {}
    return;
  }

  // Apply the Fractured adaptation resistance as heal-back.
  if (isFractured(victim) && dmg > 0) {
    const res = adaptationResist(victim, ev.damageSource?.cause);
    if (res > 0) healBack(dmg * res);
  }

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

  // (C2) Fractured Seraphim transformation at <=50% HP (in addition to the meter).
  // HP-triggered Seraphim is PERMANENT — it does not decay back.
  if (isFractured(victim) && !isSeraph(victim) && postPct <= 0.5) {
    victim.setDynamicProperty("marauder:seraphPermanent", true);
    seraphOn(victim);
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
  if (!dead) return;

  // Fallen Knight death — just clean up; the Overseer tick drops the aegis.
  if (dead.typeId === FALLEN_KNIGHT) {
    try { poof(dead.dimension, dead.location); } catch (e) {}
    combat.delete(dead.id);
    return;
  }

  if (dead.typeId !== MARAUDER && dead.typeId !== FRACTURED && dead.typeId !== OVERSEER) return;
  // Wrap every read on the corpse — on some engine builds these throw for a
  // freshly dead entity, and one throw here used to abort the whole handler
  // (killing the transition AND the rewards).
  try { removeClonesOf(dead.dimension, dead.id); } catch (e) {}
  combat.delete(dead.id);

  // Phase transition: when the stage-10 NORMAL Marauder finally dies, he rises
  // as the Overseer instead of being defeated (config-gated, any killer). The
  // entityHurt death intercept is the PRIMARY path (the entity is still fully
  // readable there) — this is the backup, guarded by marauder:risen so the two
  // can never double-spawn. Fractured and the Overseer himself never re-transform.
  if (dead.typeId === MARAUDER) {
    let stage = 1, risen = false, oid;
    try { stage = clampStage(dead.getDynamicProperty("marauder:stageNum") ?? 1); } catch (e) {}
    try { risen = dead.getDynamicProperty("marauder:risen") === true; } catch (e) {}
    try { oid = dead.getDynamicProperty("marauder:owner"); } catch (e) {}
    if (risen) return; // the death intercept already raised him — rewards come when the Overseer falls
    if (stage >= STAGE_MAX && Number(cfg("overseerPhase")) === 1) {
      // Defer the spawn out of the entityDie handler — spawning an entity from
      // inside a death event is unreliable on some engine builds.
      let dim = null, loc = null;
      try { dim = dead.dimension; loc = { x: dead.location.x, y: dead.location.y, z: dead.location.z }; } catch (e) {}
      if (dim && loc) {
        system.run(() => { try { emergeOverseer(dim, loc, oid); } catch (e) { console.warn(`[Marauder] Overseer emerge failed: ${e?.stack || e}`); } });
        return; // rewards come when the Overseer falls
      }
    }
  }

  try { handleDefeat(dead, ev.damageSource); } catch (e) {}
});

function handleDefeat(dead, source) {
  const fractured = dead.typeId === FRACTURED;
  const overseer = dead.typeId === OVERSEER;
  const stage = (fractured || overseer) ? STAGE_MAX : clampStage(dead.getDynamicProperty("marauder:stageNum") ?? 1);
  const ownerId = dead.getDynamicProperty("marauder:owner");
  const dim = dead.dimension;
  const loc = dead.location;

  dropRewards(dim, loc, stage, fractured || overseer);
  try { dim.spawnParticle("minecraft:soul_particle", { x: loc.x, y: loc.y + 0.8, z: loc.z }); } catch (e) {}
  if (fractured) {
    spawnRing(dim, loc, "minecraft:endrod", 2.0, 24);
    try { dim.playSound("beacon.deactivate", loc, { pitch: 0.6, volume: 1.4 }); } catch (e) {}
  }
  if (overseer) {
    // The Fallen King falls at last — sever his surviving knights and dim the sky.
    for (const k of dim.getEntities({ type: FALLEN_KNIGHT })) {
      if (k.getDynamicProperty("marauder:master") === dead.id) { try { poof(dim, k.location); k.remove(); } catch (e) {} }
    }
    spawnRing(dim, loc, "minecraft:basic_flame_particle", 2.5, 30);
    try { dim.playSound("mob.wither.death", loc, { pitch: 0.7, volume: 1.6 }); } catch (e) {}
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
    if (overseer) {
      owner.sendMessage("§4The Overseer, Fallen King, is undone. His corruption is spent.");
      owner.sendMessage("§8An Ashen Remnant remains — should you ever wish to face him again.");
    } else if (fractured) {
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
    case "marauder:wingsweep":
      tryTell(player, "marauder:wingsweep", () => forceAbilityOnNearest(player, "wingsweep"));
      break;
    // Generic: force ANY ability by id (tether/arena/mirror/spears/divebomb/cleave/...).
    case "marauder:ability":
      tryTell(player, "marauder:ability", () => {
        const id = (ev.message || "").trim().split(/\s+/)[0];
        if (!id) { player.sendMessage("§7Usage: /scriptevent marauder:ability <" + ABILITIES.map(a => a.id).join("|") + ">"); return; }
        forceAbilityOnNearest(player, id);
      });
      break;

    // ---- The Overseer (Part 1) ----
    case "marauder:overseer":
      tryTell(player, "marauder:overseer", () => {
        clearActive(player);
        const dim = player.dimension;
        const loc = findSafeNear(player.dimension, player.location, 6);
        const pid = player.id;
        // Defer the spawn out of the scriptEvent handler for the same reason as
        // the natural transition — spawning inside an event context can silently
        // fail on some engine builds.
        system.run(() => {
          const ovr = emergeOverseer(dim, loc, pid);
          try { player.sendMessage(ovr ? "§4The Overseer rises." : "§c[Marauder] Overseer failed to spawn — check the content log."); } catch (e) {}
        });
      });
      break;
    case "marauder:knights":
      tryTell(player, "marauder:knights", () => {
        const ent = nearestOwnedMarauder(player);
        if (!ent || !isOverseer(ent)) { player.sendMessage("§cNo active Overseer found."); return; }
        const h = ent.getComponent("minecraft:health");
        if (h) h.setCurrentValue((h.effectiveMax ?? h.defaultValue) * 0.5);
        ent.setDynamicProperty("marauder:knightsUsed", false);
        player.sendMessage("§aSet the Overseer to 50% HP — he will raise his Fallen Knights.");
      });
      break;

    // ---- config ----
    case "marauder:config":
      tryTell(player, "marauder:config", () => configCommand(player, ev.message));
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
        player.sendMessage("§7marauder:wingsweep      §8- force the Seraphim wing-sweep (must be transformed)");
        player.sendMessage("§7marauder:ability <id>   §8- force any ability (tether/arena/mirror/spears/divebomb/cleave/...)");
        player.sendMessage("§4-- The Overseer --");
        player.sendMessage("§7marauder:overseer       §8- rise the Overseer next to you");
        player.sendMessage("§7marauder:knights        §8- drop him to 50% (summons Fallen Knights)");
        player.sendMessage("§7marauder:config [k] [v] §8- list/set config (overseerPhase, fracturedChance, ...)");
        player.sendMessage("§7marauder:ping           §8- check script is alive");
      });
      break;
  }
});

function nearestOwnedMarauder(player) {
  let best = null, bestD = Infinity;
  for (const t of [MARAUDER, FRACTURED, OVERSEER]) {
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
  if (a.seraphOnly && !isSeraph(ent)) { player.sendMessage("§cThat is a Seraphim-only move — transform him first (marauder:fracture 100)."); return; }
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

// /scriptevent marauder:config            -> list all keys + values
// /scriptevent marauder:config <key> <v>  -> set a key (numbers parsed, else stored raw)
function configCommand(player, message) {
  const parts = (message || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    player.sendMessage("§6=== Marauder config ===");
    for (const k of Object.keys(CONFIG_DEFAULTS)) {
      player.sendMessage(`§7${k} §8= §f${cfg(k)} §8(default ${CONFIG_DEFAULTS[k]})`);
    }
    player.sendMessage("§8Set with: /scriptevent marauder:config <key> <value>");
    return;
  }
  const key = parts[0];
  if (!(key in CONFIG_DEFAULTS)) { player.sendMessage("§cUnknown config key: " + key); return; }
  if (parts.length < 2) { player.sendMessage(`§7${key} §8= §f${cfg(key)}`); return; }
  const num = Number(parts[1]);
  const val = isNaN(num) ? parts[1] : num;
  setCfg(key, val);
  player.sendMessage(`§aSet §f${key} §a= §f${val}`);
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
