import { world, system, GameMode, EntityDamageCause, ItemStack } from "@minecraft/server";

// The Marauder — Bedrock Script API port.
// Server-authoritative: per-player progress via dynamic properties, a night
// manager that spawns the staged rival, telegraphed abilities, and defeat
// progression. Test hooks are exposed as /scriptevent commands.

const OVERWORLD = "minecraft:overworld";
const MARAUDER = "marauder:marauder";
const STAGE_MAX = 10;

const CHECK_INTERVAL = 40;   // night manager cadence (ticks)
const ABILITY_INTERVAL = 30; // ability cadence (ticks)
const SPAWN_CHANCE = 0.12;   // per-check chance once eligible
const CHALLENGE_RANGE = 14;

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
  const gm = player.getGameMode?.();
  if (gm === GameMode.creative || gm === GameMode.spectator) return;

  if (getFlag(player, "marauder:finalComplete") && !getFlag(player, "marauder:rematchArmed")) return;
  if (player.getDynamicProperty("marauder:lastAttemptDay") === day) return;
  if (hasActive(player)) return;
  if (Math.random() > SPAWN_CHANCE) return;

  if (spawnMarauder(player, getStage(player), false)) {
    player.setDynamicProperty("marauder:lastAttemptDay", day);
  }
}

function hasActive(player) {
  return player.dimension.getEntities({ type: MARAUDER })
    .some(e => e.getDynamicProperty("marauder:owner") === player.id);
}

// ------------------------------------------------------------- spawning

function spawnMarauder(player, stage, immediate) {
  stage = clampStage(stage);
  const loc = findSpawnNear(player, immediate ? 5 : 12);
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
  try { ent.nameTag = stageTitle(stage); } catch (e) {}
}

function findSpawnNear(player, dist) {
  const dim = player.dimension;
  const base = player.location;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = Math.floor(base.x + Math.cos(a) * dist);
    const z = Math.floor(base.z + Math.sin(a) * dist);
    for (let dy = 2; dy >= -3; dy--) {
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
  return { x: base.x + dist * 0.5, y: base.y, z: base.z };
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

// ------------------------------------------------------------- abilities

system.runInterval(() => {
  const dim = world.getDimension(OVERWORLD);
  let marauders;
  try { marauders = dim.getEntities({ type: MARAUDER }); } catch (e) { return; }
  for (const ent of marauders) {
    try { tickAbilities(ent); } catch (e) {}
  }
}, ABILITY_INTERVAL);

function tickAbilities(ent) {
  if (!ent.isValid()) return;
  const stage = ent.getDynamicProperty("marauder:stageNum") ?? 1;
  const players = ent.dimension.getEntities({
    type: "minecraft:player", location: ent.location, maxDistance: CHALLENGE_RANGE
  });
  if (players.length === 0) return;
  const target = players[0];
  const d = dist(ent.location, target.location);
  const roll = Math.random();

  if (d <= 4.5 && roll < 0.55) {
    abilityShockwave(ent, stage);
  } else if (stage >= 5 && d <= CHALLENGE_RANGE && roll < 0.85) {
    abilityBeam(ent, target, stage);
  } else if (d > 4) {
    abilityLunge(ent, target);
  }
}

function abilityShockwave(ent, stage) {
  triggerSwing(ent);
  const loc = ent.location;
  spawnRing(ent.dimension, loc, "minecraft:basic_flame_particle", 1.8);
  system.runTimeout(() => {
    if (!ent.isValid()) return;
    try { ent.dimension.playSound("random.explode", ent.location); } catch (e) {}
    const near = ent.dimension.getEntities({ type: "minecraft:player", location: loc, maxDistance: 4 });
    const dmg = 3 + stage;
    for (const p of near) {
      hurt(p, ent, dmg);
      const dx = p.location.x - loc.x, dz = p.location.z - loc.z;
      const l = Math.hypot(dx, dz) || 1;
      try { p.applyKnockback(dx / l, dz / l, 1.0, 0.4); } catch (e) {}
    }
  }, 12);
}

function abilityBeam(ent, target, stage) {
  triggerCast(ent);
  const start = { x: ent.location.x, y: ent.location.y + 1.2, z: ent.location.z };
  const dir = norm(sub(target.location, ent.location));
  system.runTimeout(() => {
    if (!ent.isValid()) return;
    for (let i = 1; i <= 16; i++) {
      const p = { x: start.x + dir.x * i, y: start.y + dir.y * i, z: start.z + dir.z * i };
      try { ent.dimension.spawnParticle("minecraft:endrod", p); } catch (e) {}
    }
    if (target.isValid()) hurt(target, ent, 4 + Math.floor(stage / 2));
  }, 20);
}

function abilityLunge(ent, target) {
  triggerSwing(ent);
  const dir = norm(sub(target.location, ent.location));
  try { ent.applyKnockback(dir.x, dir.z, 1.4, 0.25); } catch (e) {}
}

function hurt(entity, source, amount) {
  try {
    entity.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: source });
  } catch (e) {}
}

function triggerSwing(ent) {
  setAttacking(ent, true);
  system.runTimeout(() => setAttacking(ent, false), 10);
}
function triggerCast(ent) {
  setAttacking(ent, true);
  system.runTimeout(() => setAttacking(ent, false), 22);
}
function setAttacking(ent, v) {
  try { if (ent.isValid()) ent.setProperty("marauder:attacking", v); } catch (e) {}
}

function spawnRing(dim, loc, particle, radius) {
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    const p = { x: loc.x + Math.cos(a) * radius, y: loc.y + 0.2, z: loc.z + Math.sin(a) * radius };
    try { dim.spawnParticle(particle, p); } catch (e) {}
  }
}

// ------------------------------------------------------------- defeat

world.afterEvents.entityDie.subscribe(ev => {
  const dead = ev.deadEntity;
  if (!dead || dead.typeId !== MARAUDER) return;
  try { handleDefeat(dead, ev.damageSource); } catch (e) {}
});

function handleDefeat(dead, source) {
  const stage = clampStage(dead.getDynamicProperty("marauder:stageNum") ?? 1);
  const ownerId = dead.getDynamicProperty("marauder:owner");
  const dim = dead.dimension;
  const loc = dead.location;

  dropRewards(dim, loc, stage);

  let owner = ownerId ? world.getAllPlayers().find(p => p.id === ownerId) : null;
  if (!owner && source && source.damagingEntity && source.damagingEntity.typeId === "minecraft:player") {
    owner = source.damagingEntity;
  }
  if (!owner) return;

  // Anti-cheese: only a player kill advances progression.
  if (!source || !source.damagingEntity || source.damagingEntity.typeId !== "minecraft:player") {
    owner.sendMessage("§7The Marauder was slain by another hand. Your rivalry is unchanged.");
    return;
  }

  if (stage >= STAGE_MAX) {
    owner.setDynamicProperty("marauder:finalComplete", true);
    owner.setDynamicProperty("marauder:rematchArmed", false);
    owner.sendMessage("§6The Marauder Ascendant falls. The ten-night rivalry is over.");
  } else {
    setStage(owner, Math.max(getStage(owner), stage + 1));
    owner.sendMessage("§cThe Marauder falls — but he will return, stronger.");
  }
}

function dropRewards(dim, loc, stage) {
  try { dim.spawnItem(new ItemStack("minecraft:iron_ingot", 1 + Math.floor(Math.random() * 2)), loc); } catch (e) {}
  if (stage >= 5) { try { dim.spawnItem(new ItemStack("minecraft:blaze_powder", 1), loc); } catch (e) {} }
  if (stage >= 9) { try { dim.spawnItem(new ItemStack("minecraft:netherite_scrap", 1), loc); } catch (e) {} }
  if (stage >= STAGE_MAX) {
    try { dim.spawnItem(new ItemStack("marauder:blacksteel_blade", 1), loc); } catch (e) {}
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
  }
});

function clearActive(player) {
  let n = 0;
  for (const e of player.dimension.getEntities({ type: MARAUDER })) {
    if (e.getDynamicProperty("marauder:owner") === player.id) {
      try { e.remove(); n++; } catch (err) {}
    }
  }
  return n;
}

// ------------------------------------------------------------- helpers

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function norm(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

function stageTitle(stage) {
  const names = [
    "", "Rusted Challenger", "Scarred Pursuer", "Oathbound Duelist", "Blacksteel Marauder",
    "Ashen Knight", "Moonlit Executioner", "Spellscarred Knight", "Abyss-Touched Marauder",
    "The Unbroken", "The Marauder Ascendant"
  ];
  return "The Marauder — " + (names[clampStage(stage)] || "");
}

world.afterEvents.worldInitialize.subscribe(() => {
  console.warn("[Marauder] Bedrock addon loaded. The hunt begins at dusk.");
});
