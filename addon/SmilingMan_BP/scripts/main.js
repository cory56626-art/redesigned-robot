/*
 * THE SMILING MAN — slow-burn stalking horror entity.
 * Server script. Targets @minecraft/server 1.13.x (Bedrock 1.21).
 *
 * Design:
 *  - Phases 1-4: movement is fully script-driven (teleport stepping). Vanilla
 *    AI is parked. The entity repositions ONLY while unobserved and freezes
 *    the instant a player looks at it.
 *  - Phase 5 (final hunt): vanilla hunting AI (nearest_attackable_target +
 *    melee_attack) is enabled via the sm:hunting component group; the script
 *    still enforces the look-freeze and handles weak-block breaking.
 */

import { world, system } from "@minecraft/server";

const ENTITY_ID = "sm:smiling_man";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function alive(e) {
  try {
    if (!e) return false;
    const v = e.isValid;
    return typeof v === "function" ? v.call(e) : !!v;
  } catch {
    return false;
  }
}
// Some Block flags have shifted between method and property across Bedrock
// versions; read them safely either way so spawn/move logic stays correct.
function boolFlag(obj, name) {
  try {
    const v = obj[name];
    return typeof v === "function" ? !!v.call(obj) : !!v;
  } catch {
    return false;
  }
}
function blockIsAir(b) { return b ? boolFlag(b, "isAir") : false; }
function blockIsSolid(b) { return b ? boolFlag(b, "isSolid") : false; }

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function norm(a) { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function dist(a, b) { return len(sub(a, b)); }
function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

// ---------------------------------------------------------------------------
// Persistent world state (dynamic properties)
// ---------------------------------------------------------------------------
const DEFAULTS = {
  "sm:phase": 1,
  "sm:day": 0,
  "sm:aggression": 0,
  "sm:debug": false,
  "sm:ai_locked": false,
  "sm:no_break": false,
  "sm:speed_mode": "normal",
  "sm:last_was_night": false,
};
function getP(key) {
  const v = world.getDynamicProperty(key);
  return v === undefined ? DEFAULTS[key] : v;
}
function setP(key, val) { world.setDynamicProperty(key, val); }
function phase() { return Number(getP("sm:phase")) || 1; }

// Speed-mode -> per-tick teleport step (blocks). Loop runs every 4 ticks.
function stepFor(mode) {
  switch (mode) {
    case "slow": return 0.10;
    case "fast": return 0.55;
    case "scare": return 1.40;
    default: return 0.22; // normal
  }
}

const WEAK_BLOCKS = [
  "door", "glass", "glass_pane", "stained_glass", "planks", "fence",
  "fence_gate", "trapdoor", "leaves", "_wood", "window",
];
function isWeakBlock(typeId) {
  if (!typeId) return false;
  const id = typeId.replace("minecraft:", "");
  if (id.includes("iron_door") || id.includes("iron_trapdoor")) return false;
  return WEAK_BLOCKS.some((w) => id.includes(w));
}

// ---------------------------------------------------------------------------
// Entity lookup helpers
// ---------------------------------------------------------------------------
function allSmiling() {
  const out = [];
  for (const d of ["overworld", "nether", "the_end"]) {
    try {
      const dim = world.getDimension(d);
      for (const e of dim.getEntities({ type: ENTITY_ID })) out.push(e);
    } catch { /* dimension may be unavailable */ }
  }
  return out;
}
function nearestPlayer(loc, dim) {
  let best = undefined, bestD = Infinity;
  for (const p of world.getAllPlayers()) {
    if (dim && p.dimension.id !== dim.id) continue;
    try {
      const d = dist(p.location, loc);
      if (d < bestD) { bestD = d; best = p; }
    } catch { /* ignore */ }
  }
  return { player: best, d: bestD };
}

// Is `player` looking roughly at `ent`? Generous cone so freeze feels instant.
function isObserved(player, ent) {
  try {
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const el = ent.location;
    const targets = [
      { x: el.x, y: el.y + 2.6, z: el.z }, // head height
      { x: el.x, y: el.y + 1.3, z: el.z }, // torso
    ];
    for (const t of targets) {
      const to = sub(t, head);
      const d = len(to);
      if (d > 90) continue;
      // wider cone when close, tighter far away
      const threshold = d < 12 ? 0.80 : d < 40 ? 0.95 : 0.985;
      if (dot(view, norm(to)) > threshold) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function isNight(dim) {
  try {
    const t = world.getTimeOfDay();
    return t >= 13000 && t <= 23000;
  } catch {
    return false;
  }
}

function trigger(ent, ev) {
  if (!alive(ent)) return;
  try { ent.triggerEvent(ev); } catch { /* ignore */ }
}
function setObservedState(ent, frozen) {
  // Use a tag to debounce triggerEvent calls.
  if (!alive(ent)) return;
  try {
    const wasFrozen = ent.hasTag("sm.frozen");
    if (frozen && !wasFrozen) {
      ent.addTag("sm.frozen");
      trigger(ent, "sm:freeze");
    } else if (!frozen && wasFrozen) {
      ent.removeTag("sm.frozen");
      trigger(ent, phase() >= 5 ? "sm:enable_hunting" : "sm:unfreeze");
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Block breaking (final phase / break tests)
// ---------------------------------------------------------------------------
function breakBlockAt(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (b && isWeakBlock(b.typeId)) {
      dim.runCommand(`setblock ${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} air destroy`);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}
function breakInFront(ent) {
  if (getP("sm:no_break")) return;
  try {
    const dir = ent.getViewDirection();
    const base = ent.location;
    for (const h of [0.5, 1.5, 2.5]) {
      const target = { x: base.x + dir.x * 1.0, y: base.y + h, z: base.z + dir.z * 1.0 };
      breakBlockAt(ent.dimension, target);
    }
  } catch { /* ignore */ }
}

function openDoorNear(dim, loc, radius = 6) {
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        try {
          const p = { x: loc.x + dx, y: loc.y + dy, z: loc.z + dz };
          const b = dim.getBlock(p);
          if (b && b.typeId.includes("door") && !b.typeId.includes("trapdoor")) {
            try {
              const perm = b.permutation.withState("open_bit", true);
              b.setPermutation(perm);
            } catch { /* some doors use different state */ }
            return p;
          }
        } catch { /* ignore */ }
      }
    }
  }
  return undefined;
}
function findBlockType(dim, loc, predicate, radius = 8) {
  for (let r = 1; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -2; dy <= 3; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          try {
            const p = { x: loc.x + dx, y: loc.y + dy, z: loc.z + dz };
            const b = dim.getBlock(p);
            if (b && predicate(b.typeId)) return p;
          } catch { /* ignore */ }
        }
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sounds (mapped to vanilla sound events — no custom audio shipped)
// ---------------------------------------------------------------------------
function playFor(player, soundId, opts = {}) {
  try { player.playSound(soundId, { location: player.location, volume: opts.volume ?? 1, pitch: opts.pitch ?? 1 }); }
  catch { /* ignore */ }
}
const SND = {
  footstep: "step.gravel",
  breath: "mob.warden.heartbeat",
  whisper: "mob.phantom.ambient",
  knock: "random.click",
  creak: "open.iron_door",
  scream: "mob.warden.nearby_closest",
  bang: "random.anvil_land",
};

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------
function preferredDistance() {
  switch (phase()) {
    case 1: return [60, 150];
    case 2: return [30, 70];
    case 3: return [12, 30];
    case 4: return [8, 20];
    default: return [16, 40];
  }
}
function groundSpawn(dim, around, minD, maxD) {
  for (let i = 0; i < 12; i++) {
    const ang = rand(0, Math.PI * 2);
    const d = rand(minD, maxD);
    const x = Math.floor(around.x + Math.cos(ang) * d);
    const z = Math.floor(around.z + Math.sin(ang) * d);
    for (let y = Math.floor(around.y) + 8; y > Math.floor(around.y) - 12; y--) {
      try {
        const floor = dim.getBlock({ x, y: y - 1, z });
        const feet = dim.getBlock({ x, y, z });
        const head = dim.getBlock({ x, y: y + 1, z });
        const head2 = dim.getBlock({ x, y: y + 2, z });
        if (blockIsSolid(floor) && blockIsAir(feet) && blockIsAir(head) && blockIsAir(head2)) {
          return { x: x + 0.5, y, z: z + 0.5 };
        }
      } catch { /* ignore */ }
    }
  }
  return undefined;
}
function spawnSmilingMan(player, forceClose = false) {
  try {
    const dim = player.dimension;
    const [minD, maxD] = forceClose ? [6, 10] : preferredDistance();
    const loc = groundSpawn(dim, player.location, minD, maxD);
    if (!loc) return undefined;
    const ent = dim.spawnEntity(ENTITY_ID, loc);
    try { ent.teleport(loc, { facingLocation: player.location }); } catch { /* ignore */ }
    return ent;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Per-entity scripted movement for phases 1-4
// ---------------------------------------------------------------------------
function driveStalker(ent, player) {
  try {
    const ploc = player.location;
    const eloc = ent.location;
    const d = dist(ploc, eloc);
    const ph = phase();
    const [minD, maxD] = preferredDistance();
    const step = stepFor(getP("sm:speed_mode"));

    // Always face the player.
    try { ent.teleport(eloc, { facingLocation: { x: ploc.x, y: ploc.y + 1.0, z: ploc.z } }); } catch { /* ignore */ }

    // Phase 1-2: keep distance. If observed while too close, vanish.
    if (ph <= 2) {
      if (d < minD - 4) {
        // back away from player
        const away = norm(sub(eloc, ploc));
        moveStep(ent, add(eloc, scale(away, step * 1.5)));
      } else if (d > maxD) {
        const toward = norm(sub(ploc, eloc));
        moveStep(ent, add(eloc, scale(toward, step)));
      }
      return;
    }

    // Phase 3-4: close in slowly while unobserved.
    if (d > 5) {
      const toward = norm(sub(ploc, eloc));
      moveStep(ent, add(eloc, scale(toward, step * 1.2)));
    }
  } catch { /* ignore */ }
}
function moveStep(ent, target) {
  try {
    const dim = ent.dimension;
    const below = dim.getBlock({ x: Math.floor(target.x), y: Math.floor(target.y) - 1, z: Math.floor(target.z) });
    if (blockIsSolid(below) || phase() >= 5) {
      ent.teleport(target, { keepVelocity: false });
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Main AI loop (every 4 ticks)
// ---------------------------------------------------------------------------
system.runInterval(() => {
  if (getP("sm:ai_locked")) return;
  const debug = getP("sm:debug");
  for (const ent of allSmiling()) {
    if (!alive(ent)) continue;
    if (ent.hasTag("sm.scripted")) continue; // a set-piece owns this entity
    const { player, d } = nearestPlayer(ent.location, ent.dimension);
    if (!player) continue;

    const observed = isObserved(player, ent);
    setObservedState(ent, observed);

    if (!observed) {
      if (phase() >= 5) {
        // hunting AI does the chasing; we just break weak blocks in the path
        breakInFront(ent);
      } else {
        driveStalker(ent, player);
        // Phase 1/2 vanish trick: if seen-too-close handled by observed branch
        if (phase() <= 2 && d < 6) safeDespawn(ent);
      }
      // rare footsteps
      if (Math.random() < 0.04) playFor(player, SND.footstep, { volume: 0.5, pitch: 0.7 });
    } else {
      // observed: frozen. Occasional breath/whisper in later phases.
      if (phase() >= 2 && Math.random() < 0.02) playFor(player, SND.breath, { volume: 0.6 });
    }

    if (debug) {
      try {
        player.onScreenDisplay.setActionBar(
          `§7SM §fdist §a${d.toFixed(1)} §fphase §e${phase()} §faggro §c${getP("sm:aggression")} §fobs §b${observed}`
        );
      } catch { /* ignore */ }
    }
  }
}, 4);

function safeDespawn(ent) {
  try {
    const p = ent.location;
    try { ent.dimension.spawnParticle?.("minecraft:large_smoke_particle", p); } catch { /* ignore */ }
    ent.remove();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Slow loop: spawn cadence, day counter, sunrise despawn (every 5s)
// ---------------------------------------------------------------------------
system.runInterval(() => {
  const players = world.getAllPlayers();
  if (players.length === 0) return;

  // Day / night transition tracking -> advance phase over multiple nights.
  let nightNow = false;
  try { nightNow = isNight(); } catch { /* ignore */ }
  const wasNight = getP("sm:last_was_night");
  if (wasNight && !nightNow) {
    // dawn just happened: count a survived night
    setP("sm:day", Number(getP("sm:day")) + 1);
    autoAdvancePhase();
    // sunrise despawn unless final phase
    if (phase() < 5) for (const e of allSmiling()) safeDespawn(e);
  }
  setP("sm:last_was_night", nightNow);

  if (getP("sm:ai_locked")) return;

  // Natural rare spawns at night.
  if (nightNow) {
    const existing = allSmiling().length;
    const maxAllowed = phase() >= 5 ? 1 : 1;
    if (existing < maxAllowed) {
      const chance = [0, 0.06, 0.12, 0.20, 0.30, 0.45][phase()] ?? 0.1;
      for (const p of players) {
        if (Math.random() < chance) { spawnSmilingMan(p); break; }
      }
    }
  }
}, 100);

function autoAdvancePhase() {
  const day = Number(getP("sm:day"));
  // thresholds (in survived nights): 1->2 at 2, 2->3 at 4, 3->4 at 6, 4->5 at 8
  let target = 1;
  if (day >= 8) target = 5;
  else if (day >= 6) target = 4;
  else if (day >= 4) target = 3;
  else if (day >= 2) target = 2;
  if (target > phase()) setPhase(target);
}

function setPhase(n) {
  setP("sm:phase", n);
  setP("sm:aggression", Math.min(100, n * 20));
  for (const e of allSmiling()) {
    if (n >= 5) trigger(e, "sm:enable_hunting");
    else trigger(e, "sm:disable_hunting");
  }
}

// ---------------------------------------------------------------------------
// Scripted set-piece events
// ---------------------------------------------------------------------------
function getTargetEntityFor(player) {
  // nearest existing SM, else spawn one close
  let best, bestD = Infinity;
  for (const e of allSmiling()) {
    if (!alive(e) || e.dimension.id !== player.dimension.id) continue;
    const d = dist(e.location, player.location);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (!best) best = spawnSmilingMan(player, true);
  return best;
}

function eventDoorburst(player) {
  const ent = getTargetEntityFor(player);
  if (!ent) return;
  ent.addTag("sm.scripted");
  const dim = player.dimension;
  const doorPos = openDoorNear(dim, player.location, 8) ?? player.location;
  playFor(player, SND.creak, { volume: 1 });
  // rush to 5 blocks from player
  system.runTimeout(() => {
    if (!alive(ent)) return;
    const dir = norm(sub(ent.location, player.location));
    const stop = add(player.location, scale(dir, 5));
    try { ent.teleport(stop, { facingLocation: { x: player.location.x, y: player.location.y + 1, z: player.location.z } }); } catch { /* ignore */ }
    trigger(ent, "sm:freeze");
    playFor(player, SND.breath, { volume: 1 });
    // stare 3-5s then flee fast
    const stare = randInt(60, 100);
    system.runTimeout(() => fleeAndDespawn(ent, player), stare);
  }, 10);
}

function fleeAndDespawn(ent, player, breakStuff = false) {
  if (!alive(ent)) return;
  trigger(ent, "sm:unfreeze");
  let steps = 16;
  const run = () => {
    if (!alive(ent) || steps-- <= 0) { safeDespawn(ent); return; }
    const away = norm(sub(ent.location, player.location));
    const tgt = add(ent.location, scale(away, 2.0));
    if (breakStuff) breakInFront(ent);
    try { ent.teleport(tgt, { facingLocation: add(ent.location, away) }); } catch { /* ignore */ }
    system.runTimeout(run, 2);
  };
  run();
}

function eventWindowWatch(player) {
  const ent = getTargetEntityFor(player);
  if (!ent) return;
  ent.addTag("sm.scripted");
  const dim = player.dimension;
  const glass = findBlockType(dim, player.location, (id) => id.includes("glass"), 10);
  const at = glass ? { x: glass.x + 0.5, y: glass.y, z: glass.z + 0.5 } : add(player.location, { x: 3, y: 0, z: 0 });
  try { ent.teleport(at, { facingLocation: { x: player.location.x, y: player.location.y + 1, z: player.location.z } }); } catch { /* ignore */ }
  trigger(ent, "sm:freeze");
  playFor(player, SND.whisper, { volume: 0.7 });
  system.runTimeout(() => { ent.removeTag("sm.scripted"); }, 200);
}

function eventBackSpawn(player, lookDown = false) {
  const dim = player.dimension;
  const view = player.getViewDirection();
  const behind = add(player.location, scale({ x: -view.x, y: 0, z: -view.z }, 2.2));
  const ent = (() => { try { return dim.spawnEntity(ENTITY_ID, behind); } catch { return undefined; } })();
  if (!ent) return;
  ent.addTag("sm.scripted");
  const face = lookDown
    ? { x: player.location.x, y: player.location.y - 1.5, z: player.location.z }
    : { x: player.location.x, y: player.location.y + 1, z: player.location.z };
  try { ent.teleport(behind, { facingLocation: face }); } catch { /* ignore */ }
  trigger(ent, "sm:freeze");
  playFor(player, SND.breath, { volume: 1 });

  if (lookDown) {
    // wait until the player turns and looks at it, then flee fast breaking blocks
    let ticks = 0;
    const watch = system.runInterval(() => {
      ticks += 4;
      if (!alive(ent)) { system.clearRun(watch); return; }
      if (isObserved(player, ent) || ticks > 200) {
        system.clearRun(watch);
        fleeAndDespawn(ent, player, true);
      }
    }, 4);
  } else {
    system.runTimeout(() => { if (alive(ent)) ent.removeTag("sm.scripted"); }, 100);
  }
}

function eventWindowMurder(player) {
  const dim = player.dimension;
  const glassPos = findBlockType(dim, player.location, (id) => id.includes("glass"), 12);
  const standAt = glassPos
    ? { x: glassPos.x + 0.5, y: glassPos.y, z: glassPos.z + 0.5 }
    : add(player.location, { x: 3, y: 0, z: 0 });
  const ent = (() => { try { return dim.spawnEntity(ENTITY_ID, standAt); } catch { return undefined; } })();
  if (!ent) return;
  ent.addTag("sm.scripted");
  try { ent.teleport(standAt, { facingLocation: { x: player.location.x, y: player.location.y + 1, z: player.location.z } }); } catch { /* ignore */ }
  trigger(ent, "sm:freeze");

  // Escalating banging: slow -> fast.
  const bangTimes = [0, 14, 26, 36, 44, 50, 55, 59, 62, 64, 66, 68];
  for (const t of bangTimes) {
    system.runTimeout(() => { if (alive(ent)) playFor(player, SND.bang, { volume: 1, pitch: 0.8 }); }, t);
  }
  // Break the glass, darkness + HIDE + scream.
  system.runTimeout(() => {
    if (glassPos) breakBlockAt(dim, glassPos);
    try { player.addEffect("darkness", 14 * 20, { amplifier: 0, showParticles: false }); } catch { /* ignore */ }
    try { player.onScreenDisplay.setTitle("§4HIDE", { fadeInDuration: 0, stayDuration: 50, fadeOutDuration: 10 }); } catch { /* ignore */ }
    try { player.onScreenDisplay.setActionBar("§cHIDE"); } catch { /* ignore */ }
    playFor(player, SND.scream, { volume: 1, pitch: 0.8 });
  }, 72);

  // After 8-12s, roll the 50/50.
  const delay = randInt(8 * 20, 12 * 20);
  system.runTimeout(() => {
    if (!alive(ent)) return;
    const found = Math.random() < 0.5;
    if (found) {
      // approach, break a block / open door, stare, then kill
      const dir = norm(sub(ent.location, player.location));
      const near = add(player.location, scale(dir, 2));
      try { ent.teleport(near, { facingLocation: { x: player.location.x, y: player.location.y + 1, z: player.location.z } }); } catch { /* ignore */ }
      const door = openDoorNear(dim, player.location, 3);
      if (!door) breakInFront(ent);
      playFor(player, SND.breath, { volume: 1 });
      system.runTimeout(() => {
        if (!alive(ent)) return;
        try {
          player.applyDamage(1000, { cause: "entityAttack", damagingEntity: ent });
        } catch {
          try { player.kill(); } catch { /* ignore */ }
        }
        safeDespawn(ent);
      }, randInt(20, 40));
    } else {
      try { player.onScreenDisplay.setActionBar("§7it ran away"); } catch { /* ignore */ }
      fleeAndDespawn(ent, player, true);
    }
  }, 72 + delay);
}

// ---------------------------------------------------------------------------
// Command routing via /scriptevent  (the .mcfunction files call these)
// ---------------------------------------------------------------------------
function resolvePlayer(ev) {
  if (ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player") return ev.sourceEntity;
  const players = world.getAllPlayers();
  return players[0];
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("sm:")) return;
  const id = ev.id;
  const player = resolvePlayer(ev);
  try {
    switch (id) {
      // spawn / control
      case "sm:spawn": if (player) spawnSmilingMan(player, true); break;
      case "sm:despawn": for (const e of allSmiling()) safeDespawn(e); break;
      case "sm:reset":
        setP("sm:phase", 1); setP("sm:day", 0); setP("sm:aggression", 0);
        setP("sm:speed_mode", "normal"); setP("sm:no_break", false);
        for (const e of allSmiling()) safeDespawn(e);
        break;

      // phase control
      case "sm:phase_1": setPhase(1); break;
      case "sm:phase_2": setPhase(2); break;
      case "sm:phase_3": setPhase(3); break;
      case "sm:phase_4": setPhase(4); break;
      case "sm:phase_final": setPhase(5); break;

      // scare events
      case "sm:event_doorburst": if (player) eventDoorburst(player); break;
      case "sm:event_windowwatch": if (player) eventWindowWatch(player); break;
      case "sm:event_backspawn": if (player) eventBackSpawn(player, false); break;
      case "sm:event_backspawnlookdown": if (player) eventBackSpawn(player, true); break;
      case "sm:event_windowmurder": if (player) eventWindowMurder(player); break;

      // movement speeds
      case "sm:speed_slow": setP("sm:speed_mode", "slow"); break;
      case "sm:speed_normal": setP("sm:speed_mode", "normal"); break;
      case "sm:speed_fast": setP("sm:speed_mode", "fast"); break;
      case "sm:speed_scare": setP("sm:speed_mode", "scare"); break;

      // block interaction
      case "sm:break_test":
        for (const e of allSmiling()) breakInFront(e); break;
      case "sm:no_break": setP("sm:no_break", true); break;
      case "sm:allow_break": setP("sm:no_break", false); break;
      case "sm:open_door_test":
        if (player) openDoorNear(player.dimension, player.location, 8); break;

      // debug
      case "sm:debug_on": setP("sm:debug", true); break;
      case "sm:debug_off":
        setP("sm:debug", false);
        for (const p of world.getAllPlayers()) { try { p.onScreenDisplay.setActionBar(""); } catch { /* ignore */ } }
        break;
      case "sm:lock_ai":
        setP("sm:ai_locked", true);
        for (const e of allSmiling()) trigger(e, "sm:freeze");
        break;
      case "sm:unlock_ai":
        setP("sm:ai_locked", false);
        for (const e of allSmiling()) trigger(e, phase() >= 5 ? "sm:enable_hunting" : "sm:unfreeze");
        break;
    }
  } catch (err) {
    console.warn("[SmilingMan] command error: " + err);
  }
});

// Initialize defaults once.
system.run(() => {
  for (const k of Object.keys(DEFAULTS)) {
    if (world.getDynamicProperty(k) === undefined) setP(k, DEFAULTS[k]);
  }
  console.warn("[SmilingMan] loaded. phase=" + phase());
});
