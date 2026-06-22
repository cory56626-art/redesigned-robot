/*
 * THE KNOCKER  -  Bedrock horror creature
 * ---------------------------------------
 * A pale-faced stalker that knocks on doors, burns houses while you aren't
 * looking, crawls, and mines its way through anything you barricade with.
 *
 * All of the "smart" psychological behaviour lives here in the script.
 * The entity JSON (knocker:the_knocker) only handles the base mob + the
 * component-group swaps (stalking / hostile / crawling / standing).
 *
 * Every feature is also wired to a /scriptevent command so it can be tested
 * on demand. Run  /scriptevent knocker:help  in-game for the full list.
 */

import {
  world,
  system,
  ItemStack,
  EquipmentSlot,
} from "@minecraft/server";

const KNOCKER_ID = "knocker:the_knocker";

// ---- Tunables -------------------------------------------------------------
const TICK = 20;                  // ticks per second
const AI_INTERVAL = 10;           // run the main brain every N ticks
const BREAK_COOLDOWN = 22;        // ticks between block breaks (player-like)
const KNOCK_TRIGGER_RANGE = 3.5;  // how close to a door before it knocks
const BURN_RANGE = 8;             // burn houses within this many blocks
const BURN_COOLDOWN = TICK * 12;  // min ticks between arson attempts
const SCREAM_RANGE = 5;           // "look at the player 5 blocks away"
const STARE_DOT = 0.4;            // view-dot above this == "you are looking"

// Per-entity runtime memory (entity.id -> state object)
const brains = new Map();

function brainOf(entity) {
  let b = brains.get(entity.id);
  if (!b) {
    b = {
      phase: "idle",        // idle | knocking | entering | hostile
      knockTicks: 0,
      lastBreak: 0,
      lastBurn: 0,
      doorLoc: null,
      tool: "axe",
    };
    brains.set(entity.id, b);
  }
  return b;
}

// ---- Small helpers --------------------------------------------------------

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Returns true if `player` is roughly looking at `entity`. */
function isLookingAt(player, entity) {
  try {
    const v = player.getViewDirection();
    const ph = player.getHeadLocation();
    const eh = entity.getHeadLocation();
    let dx = eh.x - ph.x, dy = eh.y - ph.y, dz = eh.z - ph.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const dot = v.x * dx + v.y * dy + v.z * dz;
    return dot > STARE_DOT;
  } catch {
    return false;
  }
}

function nearestPlayer(entity, maxDist = 48) {
  let best = null, bestD = maxDist;
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== entity.dimension.id) continue;
    const d = dist(p.location, entity.location);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function setTool(entity, which) {
  try {
    const eq = entity.getComponent("minecraft:equippable");
    if (!eq) return;
    const id = which === "pickaxe" ? "minecraft:iron_pickaxe" : "minecraft:iron_axe";
    eq.setEquipment(EquipmentSlot.Mainhand, new ItemStack(id, 1));
    brainOf(entity).tool = which;
  } catch {}
}

function playLoud(dimension, soundId, location, volume = 4, pitch = 1) {
  try {
    dimension.getEntities({ location, maxDistance: 48, type: "minecraft:player" });
  } catch {}
  // Play once positionally, and once at every nearby player so it is genuinely loud.
  try { world.playSound(soundId, location, { volume, pitch }); } catch {}
  for (const p of world.getAllPlayers()) {
    if (p.dimension.id !== dimension.id) continue;
    if (dist(p.location, location) <= 40) {
      try { p.playSound(soundId, { volume, pitch }); } catch {}
    }
  }
}

const DOOR_RE = /_door$|wooden_door$/;
function isDoor(typeId) { return DOOR_RE.test(typeId); }

const FLAMMABLE_RE =
  /planks$|_log$|_wood$|_door$|_fence$|_stairs$|_slab$|wool$|leaves$|carpet$|_trapdoor$|hay_block$|bookshelf$/;
function isFlammable(typeId) { return FLAMMABLE_RE.test(typeId); }

const STONE_RE =
  /stone|cobble|deepslate|granite|diorite|andesite|brick|concrete|ore$|obsidian|tuff|blackstone/;
function isStoneLike(typeId) { return STONE_RE.test(typeId); }

/** Find the closest door block within `range` of a location. */
function findDoorNear(dimension, loc, range = 4) {
  let best = null, bestD = range + 1;
  const r = Math.ceil(range);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const at = { x: loc.x + dx, y: loc.y + dy, z: loc.z + dz };
        let block;
        try { block = dimension.getBlock(at); } catch { continue; }
        if (!block || !isDoor(block.typeId)) continue;
        const d = dist(loc, at);
        if (d < bestD) { bestD = d; best = block; }
      }
    }
  }
  return best;
}

// ---- Feature: knock sequence ---------------------------------------------

function startKnock(entity, door) {
  const b = brainOf(entity);
  b.phase = "knocking";
  b.knockTicks = 0;
  b.doorLoc = { x: door.location.x, y: door.location.y, z: door.location.z };
  setTool(entity, "axe");
  // Three deliberate knocks.
  const dim = entity.dimension;
  const at = b.doorLoc;
  for (let i = 0; i < 3; i++) {
    system.runTimeout(() => {
      try {
        playLoud(dim, "dig.wood", at, 3, 0.7);
        dim.spawnParticle?.("minecraft:basic_smoke_particle", {
          x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5,
        });
      } catch {}
    }, i * 8);
  }
  // After the knocking, decide its fate: 60% leave, 40% break in.
  system.runTimeout(() => decideKnock(entity), 30);
}

function decideKnock(entity) {
  if (!entity.isValid()) return;
  const b = brainOf(entity);
  const roll = Math.random();
  if (roll < 0.6) {
    // 60% — leave. Calm down and stroll away.
    b.phase = "idle";
    b.doorLoc = null;
    try { entity.triggerEvent("knocker:become_passive"); } catch {}
    const dim = entity.dimension;
    playLoud(dim, "mob.creeper.say", entity.location, 1.4, 0.4);
  } else {
    // 40% — break the door and come inside.
    breakDoor(entity);
  }
}

function breakDoor(entity) {
  const b = brainOf(entity);
  const at = b.doorLoc;
  const dim = entity.dimension;
  if (!at) { b.phase = "hostile"; return; }
  setTool(entity, "axe");
  // Chop the door (and its other half) out of existence.
  for (const dy of [0, 1, -1]) {
    try {
      const block = dim.getBlock({ x: at.x, y: at.y + dy, z: at.z });
      if (block && isDoor(block.typeId)) {
        playLoud(dim, "dig.wood", block.location, 4, 0.6);
        dim.spawnParticle?.("minecraft:basic_smoke_particle", {
          x: at.x + 0.5, y: at.y + dy + 0.5, z: at.z + 0.5,
        });
        block.setType("minecraft:air");
      }
    } catch {}
  }
  b.phase = "entering";
  b.lastBreak = system.currentTick;
}

// ---- Feature: enter, stare, scream, chase --------------------------------

function tickEntering(entity) {
  const b = brainOf(entity);
  const player = nearestPlayer(entity, 24);
  if (!player) return;
  const d = dist(player.location, entity.location);
  if (d <= SCREAM_RANGE) {
    // Face the player ("look at the player 5 blocks away").
    try {
      entity.teleport(entity.location, { facingLocation: player.getHeadLocation() });
    } catch {}
    screamAndChase(entity, player);
  }
}

function screamAndChase(entity, player) {
  const b = brainOf(entity);
  const dim = entity.dimension;
  // VERY loud scream.
  playLoud(dim, "mob.warden.roar", entity.location, 6, 0.8);
  playLoud(dim, "ambient.cave", entity.location, 4, 0.5);
  try {
    dim.spawnParticle?.("minecraft:sonic_explosion", entity.getHeadLocation());
  } catch {}
  b.phase = "hostile";
  try {
    entity.triggerEvent("knocker:become_hostile");
    entity.addEffect("speed", TICK * 30, { amplifier: 1, showParticles: false });
  } catch {}
  // Nudge the target so the AI locks on immediately.
  try { entity.setTarget?.(player); } catch {}
}

// ---- Feature: burn down the house while you aren't looking ----------------

function tryBurn(entity) {
  const b = brainOf(entity);
  if (system.currentTick - b.lastBurn < BURN_COOLDOWN) return;
  const player = nearestPlayer(entity, BURN_RANGE);
  if (!player) return;
  // Only does it while the player is NOT looking at it.
  if (isLookingAt(player, entity)) return;
  const dim = entity.dimension;
  // Look for a flammable block near the player and set it alight.
  const base = player.location;
  const r = 4;
  for (let attempt = 0; attempt < 24; attempt++) {
    const dx = Math.floor((Math.random() * 2 - 1) * r);
    const dy = Math.floor((Math.random() * 2 - 1) * 2);
    const dz = Math.floor((Math.random() * 2 - 1) * r);
    const at = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
    let solid, above;
    try {
      solid = dim.getBlock(at);
      above = dim.getBlock({ x: at.x, y: at.y + 1, z: at.z });
    } catch { continue; }
    if (!solid || !above) continue;
    if (isFlammable(solid.typeId) && above.typeId === "minecraft:air") {
      try {
        above.setType("minecraft:fire");
        playLoud(dim, "fire.ignite", at, 2, 1);
        b.lastBurn = system.currentTick;
      } catch {}
      return;
    }
  }
}

// ---- Feature: player-like block breaking (with cooldown) ------------------

/**
 * When hostile and walled off from the target, mine the obstructing block.
 * Stone-like blocks switch the Knocker to its iron pickaxe; everything else
 * uses the iron axe. Honours BREAK_COOLDOWN so it breaks at a human pace.
 */
function tryMineToward(entity, target) {
  const b = brainOf(entity);
  if (system.currentTick - b.lastBreak < BREAK_COOLDOWN) return;
  const dim = entity.dimension;
  const from = entity.getHeadLocation();
  let dx = target.x - from.x, dz = target.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  dx /= len; dz /= len;
  // Check the block directly ahead at body and head height.
  for (const dy of [0, 1]) {
    const at = {
      x: Math.floor(entity.location.x + dx + 0.5 * Math.sign(dx)),
      y: Math.floor(entity.location.y + dy),
      z: Math.floor(entity.location.z + dz + 0.5 * Math.sign(dz)),
    };
    let block;
    try { block = dim.getBlock(at); } catch { continue; }
    if (!block || block.typeId === "minecraft:air" || block.typeId === "minecraft:water") continue;
    if (block.typeId.includes("bedrock")) continue;

    const stone = isStoneLike(block.typeId);
    setTool(entity, stone ? "pickaxe" : "axe");
    try {
      playLoud(dim, stone ? "dig.stone" : "dig.wood", at, 2, 1);
      dim.spawnParticle?.("minecraft:basic_smoke_particle",
        { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 });
      block.setType("minecraft:air");
      b.lastBreak = system.currentTick;
    } catch {}
    return;
  }
  // Nothing to break in front — make sure the axe is back out.
  if (b.tool !== "axe") setTool(entity, "axe");
}

// ---- Feature: crawling ----------------------------------------------------

function startCrawl(entity) {
  try {
    entity.triggerEvent("knocker:start_crawling");
    entity.playAnimation?.("animation.knocker.crawl");
  } catch {}
}
function stopCrawl(entity) {
  try { entity.triggerEvent("knocker:stop_crawling"); } catch {}
}

// ---- Main brain -----------------------------------------------------------

system.runInterval(() => {
  for (const dimId of ["overworld", "nether", "the_end"]) {
    let dim;
    try { dim = world.getDimension(dimId); } catch { continue; }
    let knockers;
    try { knockers = dim.getEntities({ type: KNOCKER_ID }); } catch { continue; }
    for (const k of knockers) {
      if (!k.isValid()) continue;
      const b = brainOf(k);

      // Make sure it is always armed.
      try {
        const eq = k.getComponent("minecraft:equippable");
        if (eq && !eq.getEquipment(EquipmentSlot.Mainhand)) setTool(k, "axe");
      } catch {}

      // Arson — only when un-watched.
      tryBurn(k);

      if (b.phase === "idle") {
        // Look for a door with a player nearby to knock on.
        const player = nearestPlayer(k, 16);
        if (player) {
          const door = findDoorNear(dim, k.location, KNOCK_TRIGGER_RANGE);
          if (door) startKnock(k, door);
        }
      } else if (b.phase === "entering") {
        tickEntering(k);
      } else if (b.phase === "hostile") {
        // If something is in the way of the target, dig through it.
        const target = nearestPlayer(k, 40);
        if (target) tryMineToward(k, target.location);
      }
    }
  }
}, AI_INTERVAL);

// Clean up dead brains occasionally.
system.runInterval(() => {
  for (const id of [...brains.keys()]) {
    // Cheap GC: if no knocker reports this id this pass, drop it.
  }
}, TICK * 60);

// ---- /scriptevent test commands ------------------------------------------

function feedback(player, msg) {
  if (player) {
    try { player.sendMessage(msg); } catch {}
  } else {
    try { world.sendMessage(msg); } catch {}
  }
}

function senderOf(ev) {
  if (ev.sourceEntity && ev.sourceEntity.typeId === "minecraft:player") return ev.sourceEntity;
  return world.getAllPlayers()[0] ?? null;
}

function spawnInFront(player) {
  const dir = player.getViewDirection();
  const loc = player.location;
  const at = { x: loc.x + dir.x * 4, y: loc.y, z: loc.z + dir.z * 4 };
  const k = player.dimension.spawnEntity(KNOCKER_ID, at);
  setTool(k, "axe");
  return k;
}

function nearestKnocker(origin, maxDist = 48) {
  let best = null, bestD = maxDist;
  for (const k of origin.dimension.getEntities({ type: KNOCKER_ID })) {
    const d = dist(k.location, origin.location);
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!ev.id.startsWith("knocker:")) return;
  const cmd = ev.id.slice("knocker:".length);
  const player = senderOf(ev);

  switch (cmd) {
    case "help": {
      feedback(player,
        "§c§lTHE KNOCKER §r§7— test commands:\n" +
        "§f/scriptevent knocker:spawn §7- spawn one in front of you\n" +
        "§f/scriptevent knocker:knock §7- send nearest to your door to knock\n" +
        "§f/scriptevent knocker:break_door §7- force the break-in branch\n" +
        "§f/scriptevent knocker:scream §7- stare + loud scream + chase\n" +
        "§f/scriptevent knocker:chase §7- become hostile and hunt you\n" +
        "§f/scriptevent knocker:burn §7- burn nearby flammables\n" +
        "§f/scriptevent knocker:mine §7- mine the block you're facing\n" +
        "§f/scriptevent knocker:crawl §7/ §fknocker:stand §7- toggle crawl\n" +
        "§f/scriptevent knocker:axe §7/ §fknocker:pickaxe §7- swap tool\n" +
        "§f/scriptevent knocker:passive §7- calm it down\n" +
        "§f/scriptevent knocker:remove §7- remove all Knockers");
      break;
    }
    case "spawn": {
      if (!player) return;
      spawnInFront(player);
      feedback(player, "§aThe Knocker has entered your world...");
      break;
    }
    case "knock": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      const door = findDoorNear(player.dimension, player.location, 6);
      if (door) {
        // Teleport it just outside the door so the sequence triggers reliably.
        try { k.teleport({ x: door.location.x + 0.5, y: door.location.y, z: door.location.z + 1.5 }); } catch {}
        startKnock(k, door);
        feedback(player, "§e*knock... knock... knock*");
      } else {
        feedback(player, "§cNo door nearby. Stand next to a door and try again.");
      }
      break;
    }
    case "break_door": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      const door = findDoorNear(player.dimension, player.location, 6);
      if (door) {
        brainOf(k).doorLoc = { x: door.location.x, y: door.location.y, z: door.location.z };
        breakDoor(k);
        feedback(player, "§4It chose to come in.");
      } else {
        feedback(player, "§cNo door nearby to break.");
      }
      break;
    }
    case "scream": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      try { k.teleport(k.location, { facingLocation: player.getHeadLocation() }); } catch {}
      screamAndChase(k, player);
      feedback(player, "§4§lAAAAAHHH!!!");
      break;
    }
    case "chase": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      brainOf(k).phase = "hostile";
      try {
        k.triggerEvent("knocker:become_hostile");
        k.addEffect("speed", TICK * 30, { amplifier: 1, showParticles: false });
        k.setTarget?.(player);
      } catch {}
      feedback(player, "§cIt is hunting you now.");
      break;
    }
    case "burn": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      brainOf(k).lastBurn = 0;
      tryBurn(k);
      feedback(player, "§6Look away... and it lights the match.");
      break;
    }
    case "mine": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      brainOf(k).lastBreak = 0;
      tryMineToward(k, player.location);
      feedback(player, "§7It claws through the wall.");
      break;
    }
    case "crawl": {
      if (!player) return;
      const k = nearestKnocker(player) ?? spawnInFront(player);
      startCrawl(k);
      feedback(player, "§8It drops to the floor and crawls.");
      break;
    }
    case "stand": {
      if (!player) return;
      const k = nearestKnocker(player);
      if (k) stopCrawl(k);
      feedback(player, "§7It rises back up.");
      break;
    }
    case "axe": {
      if (!player) return;
      const k = nearestKnocker(player);
      if (k) setTool(k, "axe");
      feedback(player, "§7Iron axe equipped.");
      break;
    }
    case "pickaxe": {
      if (!player) return;
      const k = nearestKnocker(player);
      if (k) setTool(k, "pickaxe");
      feedback(player, "§7Iron pickaxe equipped.");
      break;
    }
    case "passive": {
      if (!player) return;
      const k = nearestKnocker(player);
      if (k) {
        brainOf(k).phase = "idle";
        try { k.triggerEvent("knocker:become_passive"); } catch {}
      }
      feedback(player, "§aThe Knocker loses interest... for now.");
      break;
    }
    case "remove": {
      const dim = player ? player.dimension : world.getDimension("overworld");
      let n = 0;
      for (const k of dim.getEntities({ type: KNOCKER_ID })) { try { k.remove(); n++; } catch {} }
      feedback(player, `§7Removed ${n} Knocker(s).`);
      break;
    }
    default:
      feedback(player, "§cUnknown Knocker command. Try §f/scriptevent knocker:help");
  }
});

world.afterEvents.worldInitialize?.subscribe?.(() => {
  console.warn("[The Knocker] loaded. Run /scriptevent knocker:help");
});
