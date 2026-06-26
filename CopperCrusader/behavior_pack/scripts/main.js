import { world, system, EquipmentSlot } from "@minecraft/server";

/* ============================================================
 * COPPER CRUSADER - core gameplay script
 * ============================================================ */

const SWORD_ID = "copper_crusader:sword";
const STATUE_ID = "copper_crusader:relic_statue";
const SHARD_ID = "copper_crusader:copper_shard";

const MAX_FALL_POWER = 60;

const SPEAR_ID = "copper_crusader:spear";

const ABILITY_NAMES = {
  1: "§6Skybreak Ascension",
  2: "§cCopper Corruption Rush",
  3: "§eCopper Relic Summon",
};

const SPEAR_ABILITY_NAMES = {
  1: "§bCopper Slipstream",
  2: "§bSkewer Lunge",
  3: "§bCopper Thunderlance",
};

// World-level key for the oxidation pause window (counter mechanic).
const OX_PAUSE_KEY = "cc:oxPauseUntil";

/* ---------- small helpers ---------- */

function getNum(holder, key, def = 0) {
  const v = holder.getDynamicProperty(key);
  return typeof v === "number" ? v : def;
}
function setNum(holder, key, val) {
  holder.setDynamicProperty(key, val);
}
function getBool(holder, key, def = false) {
  const v = holder.getDynamicProperty(key);
  return typeof v === "boolean" ? v : def;
}

function safeParticle(dim, id, loc) {
  try {
    dim.spawnParticle(id, loc);
  } catch (e) {
    /* particle id not present in this version - ignore */
  }
}
function safeSound(dim, id, loc, opts) {
  try {
    dim.playSound(id, loc, opts);
  } catch (e) {
    /* ignore */
  }
}

// Returns "sword" | "spear" | null based on the main-hand item.
function holdingWeapon(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    const item = eq?.getEquipment(EquipmentSlot.Mainhand);
    if (item?.typeId === SWORD_ID) return "sword";
    if (item?.typeId === SPEAR_ID) return "spear";
  } catch (e) {}
  return null;
}

// Count equipped Copper Crusader armor pieces (0..4).
function copperArmorCount(player) {
  let n = 0;
  try {
    const eq = player.getComponent("minecraft:equippable");
    for (const slot of [
      EquipmentSlot.Head,
      EquipmentSlot.Chest,
      EquipmentSlot.Legs,
      EquipmentSlot.Feet,
    ]) {
      const it = eq?.getEquipment(slot);
      if (it && it.typeId.startsWith("copper_crusader:")) n++;
    }
  } catch (e) {}
  return n;
}

function viewVector(player) {
  const v = player.getViewDirection();
  return { x: v.x, y: v.y, z: v.z };
}

function isOxPaused() {
  return system.currentTick < getNum(world, OX_PAUSE_KEY, 0);
}

/* ============================================================
 * OXIDATION (Copper Effect)
 * ============================================================ */

// Apply / increase the Copper Effect on a victim.
function applyCopperEffect(entity, amount) {
  try {
    if (!entity || !entity.isValid()) return;
    // Full Copper Crusader armor set grants oxidation immunity.
    if (entity.typeId === "minecraft:player" && copperArmorCount(entity) >= 4)
      return;
    if (!entity.getComponent("minecraft:health")) return;
    const cur = getNum(entity, "cc:ox", 0);
    setNum(entity, "cc:ox", Math.min(3, cur + amount));
  } catch (e) {}
}

// Progress oxidation stages and apply matching debuffs. Runs every second.
function oxidationTicker() {
  const paused = isOxPaused();
  for (const dim of [
    world.getDimension("overworld"),
    world.getDimension("nether"),
    world.getDimension("the_end"),
  ]) {
    let entities;
    try {
      entities = dim.getEntities();
    } catch (e) {
      continue;
    }
    for (const e of entities) {
      let ox;
      try {
        ox = getNum(e, "cc:ox", 0);
      } catch (err) {
        continue;
      }
      if (ox <= 0) continue;
      if (!e.isValid()) continue;

      if (!paused) {
        ox = Math.min(3, ox + 0.25);
        setNum(e, "cc:ox", ox);
      }

      const stage = Math.min(3, Math.floor(ox)); // 0..3
      if (stage >= 1) {
        const amp = stage - 1; // Exposed=0, Weathered=1, Oxidized=2
        try {
          // Slower movement + reduced damage output.
          e.addEffect("slowness", 40, { amplifier: amp, showParticles: false });
          e.addEffect("weakness", 40, { amplifier: amp, showParticles: false });
        } catch (err) {}
        safeParticle(e.dimension, "minecraft:electric_spark_particle", {
          x: e.location.x,
          y: e.location.y + 1,
          z: e.location.z,
        });
      }
    }
  }
}

/* ============================================================
 * ABILITY 1 - SKYBREAK ASCENSION
 * ============================================================ */

function skybreakLaunch(player) {
  try {
    player.applyKnockback(0, 0, 0, 2.3);
  } catch (e) {
    try {
      player.applyImpulse({ x: 0, y: 1.6, z: 0 });
    } catch (err) {}
  }
  try {
    player.addEffect("slow_falling", 200, { amplifier: 0, showParticles: true });
  } catch (e) {}
  setNum(player, "cc:fallPower", 0); // meter resets on ability use
  player.setDynamicProperty("cc:skyArmed", true);
  safeParticle(player.dimension, "minecraft:electric_spark_particle", player.location);
  safeSound(player.dimension, "block.copper.place", player.location, { pitch: 1.5 });
  player.onScreenDisplay.setActionBar("§6⤴ Skybreak! §7Activate again mid-air to slam.");
}

function skybreakDive(player) {
  player.setDynamicProperty("cc:skyArmed", false);
  player.setDynamicProperty("cc:slamPending", true);
  try {
    player.applyKnockback(0, 0, 0, -1.4); // yank downward
  } catch (e) {
    try {
      player.applyImpulse({ x: 0, y: -1.4, z: 0 });
    } catch (err) {}
  }
  player.onScreenDisplay.setActionBar("§6▼ Ground Dive!");
}

function skybreakSlam(player) {
  const fp = getNum(player, "cc:fallPower", 0);
  const dmg = 10 + fp * 0.6;
  const radius = 4 + fp * 0.1;
  const loc = player.location;

  safeParticle(player.dimension, "minecraft:huge_explosion_emitter", loc);
  safeParticle(player.dimension, "minecraft:knockback_roar_particle", loc);
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    safeParticle(player.dimension, "minecraft:electric_spark_particle", {
      x: loc.x + Math.cos(a) * radius * 0.6,
      y: loc.y + 0.2,
      z: loc.z + Math.sin(a) * radius * 0.6,
    });
  }
  safeSound(player.dimension, "random.explode", loc, { pitch: 0.9 });
  safeSound(player.dimension, "block.copper.break", loc, { pitch: 0.7 });

  let targets;
  try {
    targets = player.dimension.getEntities({
      location: loc,
      maxDistance: radius,
      excludeTypes: [SHARD_ID],
    });
  } catch (e) {
    targets = [];
  }
  for (const t of targets) {
    if (t.id === player.id) continue;
    if (!t.getComponent("minecraft:health")) continue;
    try {
      t.applyDamage(dmg, { cause: "entityAttack", damagingEntity: player });
      const dx = t.location.x - loc.x;
      const dz = t.location.z - loc.z;
      const len = Math.hypot(dx, dz) || 1;
      t.applyKnockback((dx / len), (dz / len), 1.6, 0.7); // shockwave
    } catch (err) {}
  }

  setNum(player, "cc:fallPower", 0);
  player.onScreenDisplay.setActionBar(
    `§6💥 Copper Slam! §7(${dmg.toFixed(1)} dmg)`
  );
}

/* ============================================================
 * ABILITY 2 - COPPER CORRUPTION RUSH
 * ============================================================ */

function corruptionRush(player) {
  const v = viewVector(player);
  const len = Math.hypot(v.x, v.z) || 1;
  try {
    player.applyKnockback(v.x / len, v.z / len, 3.0, 0.35);
  } catch (e) {
    try {
      player.applyImpulse({ x: (v.x / len) * 1.6, y: 0.3, z: (v.z / len) * 1.6 });
    } catch (err) {}
  }
  player.setDynamicProperty("cc:dashTicks", 12);
  setNum(player, "cc:fallPower", 0);
  safeSound(player.dimension, "block.copper.place", player.location, { pitch: 0.8 });
  player.onScreenDisplay.setActionBar("§c➤ Corruption Rush!");
}

// While dash is active, hit entities in the player's path with Copper Effect.
function corruptionRushTick(player) {
  const remaining = getNum(player, "cc:dashTicks", 0);
  if (remaining <= 0) return;
  player.setDynamicProperty("cc:dashTicks", remaining - 1);

  let near;
  try {
    near = player.dimension.getEntities({
      location: player.location,
      maxDistance: 3,
      excludeTypes: [SHARD_ID, STATUE_ID],
      families: ["mob"],
    });
  } catch (e) {
    return;
  }
  for (const t of near) {
    if (t.id === player.id) continue;
    applyCopperEffect(t, 0.6);
    try {
      t.applyDamage(3, { cause: "entityAttack", damagingEntity: player });
    } catch (err) {}
    safeParticle(t.dimension, "minecraft:electric_spark_particle", t.location);
  }
}

/* ============================================================
 * ABILITY 3 - COPPER RELIC SUMMON + SHARD BREAK
 * ============================================================ */

function relicSummon(player) {
  // Enforce single active statue.
  const existingId = player.getDynamicProperty("cc:statueId");
  if (typeof existingId === "string") {
    try {
      const ents = player.dimension.getEntities({ type: STATUE_ID });
      if (ents.some((e) => e.id === existingId && e.isValid())) {
        player.onScreenDisplay.setActionBar("§eA relic is already active!");
        return;
      }
    } catch (e) {}
  }

  // Find a target location ~4 blocks ahead, dropped onto the ground.
  const v = viewVector(player);
  const base = player.location;
  let loc = {
    x: base.x + v.x * 4,
    y: base.y,
    z: base.z + v.z * 4,
  };
  try {
    const ray = player.getBlockFromViewDirection({ maxDistance: 8 });
    if (ray && ray.block) {
      loc = {
        x: ray.block.location.x + 0.5,
        y: ray.block.location.y + 1,
        z: ray.block.location.z + 0.5,
      };
    }
  } catch (e) {}

  let statue;
  try {
    statue = player.dimension.spawnEntity(STATUE_ID, loc);
  } catch (e) {
    player.onScreenDisplay.setActionBar("§cCannot summon a relic here.");
    return;
  }

  const fp = getNum(player, "cc:fallPower", 0);
  setNum(statue, "cc:fp", fp);
  statue.setDynamicProperty("cc:owner", player.id);
  statue.setDynamicProperty("cc:summonTick", system.currentTick);
  player.setDynamicProperty("cc:statueId", statue.id);

  setNum(player, "cc:fallPower", 0);
  safeSound(player.dimension, "block.copper.place", loc, { pitch: 0.6 });
  safeParticle(player.dimension, "minecraft:electric_spark_particle", loc);
  player.onScreenDisplay.setActionBar("§eCopper Relic summoned!");

  // Natural expiration after 6 seconds (wider, weaker burst).
  const statueId = statue.id;
  system.runTimeout(() => {
    try {
      const ents = player.dimension.getEntities({ type: STATUE_ID });
      const s = ents.find((e) => e.id === statueId && e.isValid());
      if (s) {
        s.setDynamicProperty("cc:bursted", true);
        shardBurst(s.dimension, s.location, getNum(s, "cc:fp", 0), false, player.id);
        try {
          s.remove();
        } catch (e) {}
      }
    } catch (e) {}
  }, 120);
}

// Visual glow pulse for active statues.
function statueTick() {
  let statues;
  try {
    statues = world.getDimension("overworld").getEntities({ type: STATUE_ID });
  } catch (e) {
    return;
  }
  for (const s of statues) {
    if (!s.isValid()) continue;
    safeParticle(s.dimension, "minecraft:electric_spark_particle", {
      x: s.location.x,
      y: s.location.y + 1.2,
      z: s.location.z,
    });
  }
}

// Spawn homing copper shards. early=true -> tight strong burst; false -> wide weak.
function shardBurst(dim, loc, fp, early, ownerId) {
  safeParticle(dim, "minecraft:huge_explosion_emitter", loc);
  safeSound(dim, "block.copper.break", loc, { pitch: 1.2 });

  const baseCount = 6 + Math.floor(fp * 0.12);
  const count = early ? baseCount : baseCount + 4;
  const spread = early ? 0.4 : 1.4;
  const dmg = early ? 4 + fp * 0.06 : 2 + fp * 0.04;
  const speed = early ? 0.9 + fp * 0.012 : 0.6 + fp * 0.008;

  for (let i = 0; i < count; i++) {
    const o = {
      x: loc.x + (Math.random() - 0.5) * spread,
      y: loc.y + 0.8 + (Math.random() - 0.5) * spread,
      z: loc.z + (Math.random() - 0.5) * spread,
    };
    let shard;
    try {
      shard = dim.spawnEntity(SHARD_ID, o);
    } catch (e) {
      continue;
    }
    setNum(shard, "cc:dmg", dmg);
    setNum(shard, "cc:spd", speed);
    if (ownerId) shard.setDynamicProperty("cc:owner", ownerId);
  }
}

// Homing movement + impact for every active shard. Runs every tick.
function shardTick() {
  let shards;
  try {
    shards = world.getDimension("overworld").getEntities({ type: SHARD_ID });
  } catch (e) {
    return;
  }
  for (const shard of shards) {
    if (!shard.isValid()) continue;
    const spd = getNum(shard, "cc:spd", 0.7);
    const dmg = getNum(shard, "cc:dmg", 3);
    const owner = shard.getDynamicProperty("cc:owner");

    // Acquire nearest enemy mob.
    let targets;
    try {
      targets = shard.dimension.getEntities({
        location: shard.location,
        maxDistance: 16,
        families: ["mob"],
        excludeTypes: [SHARD_ID, STATUE_ID],
      });
    } catch (e) {
      targets = [];
    }
    let best = null;
    let bestD = Infinity;
    for (const t of targets) {
      if (t.id === owner) continue;
      const d =
        (t.location.x - shard.location.x) ** 2 +
        (t.location.y - shard.location.y) ** 2 +
        (t.location.z - shard.location.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }

    if (!best) {
      safeParticle(shard.dimension, "minecraft:electric_spark_particle", shard.location);
      continue;
    }

    const tx = best.location.x - shard.location.x;
    const ty = best.location.y + 1 - shard.location.y;
    const tz = best.location.z - shard.location.z;
    const len = Math.hypot(tx, ty, tz) || 1;

    // Impact.
    if (len <= 1.2) {
      try {
        best.applyDamage(dmg, { cause: "magic", damagingEntity: shard });
      } catch (e) {}
      applyCopperEffect(best, 0.25); // light Copper Effect
      safeParticle(shard.dimension, "minecraft:electric_spark_particle", best.location);
      try {
        shard.remove();
      } catch (e) {}
      continue;
    }

    // Home toward target.
    const nx = shard.location.x + (tx / len) * spd;
    const ny = shard.location.y + (ty / len) * spd;
    const nz = shard.location.z + (tz / len) * spd;
    try {
      shard.teleport({ x: nx, y: ny, z: nz });
    } catch (e) {}
    safeParticle(shard.dimension, "minecraft:electric_spark_particle", shard.location);
  }
}

/* ============================================================
 * SPEAR ABILITY 1 - COPPER SLIPSTREAM (directional flight)
 * ============================================================ */

function spearSlipstream(player) {
  player.setDynamicProperty("cc:flightUntil", system.currentTick + 100); // ~5s
  setNum(player, "cc:fallPower", 0); // meter resets on use
  safeSound(player.dimension, "item.trident.riptide_3", player.location, { pitch: 1.0 });
  safeSound(player.dimension, "block.copper.place", player.location, { pitch: 1.4 });
  // initial burst in look direction
  const v = viewVector(player);
  const h = Math.hypot(v.x, v.z) || 0.001;
  try {
    player.applyKnockback(v.x / h, v.z / h, 2.2 * h, v.y * 1.6 + 0.4);
  } catch (e) {
    try {
      player.applyImpulse({ x: v.x * 1.2, y: v.y * 1.0 + 0.3, z: v.z * 1.2 });
    } catch (err) {}
  }
  player.onScreenDisplay.setActionBar("§b✈ Copper Slipstream! §7Fly where you look.");
}

// Sustains high-speed directional flight while the window is active.
function spearFlightTick(player) {
  const until = getNum(player, "cc:flightUntil", 0);
  if (system.currentTick >= until) return;

  const v = viewVector(player);
  const h = Math.hypot(v.x, v.z) || 0.001;
  const hPower = 1.7;
  const vPower = 1.45;
  try {
    // Re-applied every tick -> sustained elytra-like glide in the look vector.
    player.applyKnockback(v.x / h, v.z / h, hPower * h, v.y * vPower);
  } catch (e) {
    try {
      player.applyImpulse({ x: v.x * hPower * 0.6, y: v.y * vPower * 0.6, z: v.z * hPower * 0.6 });
    } catch (err) {}
  }
  try {
    player.addEffect("speed", 20, { amplifier: 3, showParticles: false });
    player.addEffect("slow_falling", 40, { amplifier: 0, showParticles: false });
  } catch (e) {}
  safeParticle(player.dimension, "minecraft:electric_spark_particle", player.location);

  if (until - system.currentTick <= 1) {
    // Cushion the landing so flight never ends in fall damage.
    try {
      player.addEffect("slow_falling", 80, { amplifier: 0, showParticles: true });
    } catch (e) {}
    player.onScreenDisplay.setActionBar("§7Slipstream fading...");
  }
}

/* ============================================================
 * SPEAR ABILITY 2 - SKEWER LUNGE (piercing thrust)
 * ============================================================ */

function spearLunge(player) {
  const v = viewVector(player);
  const h = Math.hypot(v.x, v.z) || 0.001;
  try {
    player.applyKnockback(v.x / h, v.z / h, 3.2, 0.35);
  } catch (e) {
    try {
      player.applyImpulse({ x: (v.x / h) * 1.8, y: 0.3, z: (v.z / h) * 1.8 });
    } catch (err) {}
  }
  setNum(player, "cc:lungeFp", getNum(player, "cc:fallPower", 0));
  player.setDynamicProperty("cc:lungeTicks", 10);
  setNum(player, "cc:fallPower", 0);
  safeSound(player.dimension, "block.copper.place", player.location, { pitch: 0.7 });
  player.onScreenDisplay.setActionBar("§b➤ Skewer Lunge!");
}

function spearLungeTick(player) {
  const rem = getNum(player, "cc:lungeTicks", 0);
  if (rem <= 0) return;
  player.setDynamicProperty("cc:lungeTicks", rem - 1);

  const fp = getNum(player, "cc:lungeFp", 0);
  const dmg = 6 + fp * 0.4;
  let near;
  try {
    near = player.dimension.getEntities({
      location: player.location,
      maxDistance: 3.5,
      families: ["mob"],
      excludeTypes: [SHARD_ID, STATUE_ID],
    });
  } catch (e) {
    return;
  }
  for (const t of near) {
    if (t.id === player.id) continue;
    // Vanilla hurt-cooldown naturally limits this to ~one hit per target per lunge.
    try {
      t.applyDamage(dmg, { cause: "entityAttack", damagingEntity: player });
    } catch (e) {}
    applyCopperEffect(t, 0.8);
    const dx = t.location.x - player.location.x;
    const dz = t.location.z - player.location.z;
    const len = Math.hypot(dx, dz) || 1;
    try {
      t.applyKnockback(dx / len, dz / len, 0.8, 0.3);
    } catch (e) {}
    safeParticle(t.dimension, "minecraft:electric_spark_particle", t.location);
  }
}

/* ============================================================
 * SPEAR ABILITY 3 - COPPER THUNDERLANCE (targeted strike)
 * ============================================================ */

function spearThunderlance(player) {
  const fp = getNum(player, "cc:fallPower", 0);
  setNum(player, "cc:fallPower", 0);

  const v = viewVector(player);
  let base;
  try {
    base = player.getHeadLocation();
  } catch (e) {
    base = player.location;
  }
  let loc = { x: base.x + v.x * 12, y: base.y + v.y * 12, z: base.z + v.z * 12 };
  try {
    const ray = player.getBlockFromViewDirection({ maxDistance: 24 });
    if (ray && ray.block) {
      loc = {
        x: ray.block.location.x + 0.5,
        y: ray.block.location.y + 1,
        z: ray.block.location.z + 0.5,
      };
    }
  } catch (e) {}

  const radius = 4 + fp * 0.1;
  const dmg = 8 + fp * 0.5;

  safeParticle(player.dimension, "minecraft:huge_explosion_emitter", loc);
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    safeParticle(player.dimension, "minecraft:electric_spark_particle", {
      x: loc.x + Math.cos(a) * radius * 0.6,
      y: loc.y + 0.2,
      z: loc.z + Math.sin(a) * radius * 0.6,
    });
  }
  safeSound(player.dimension, "ambient.weather.thunder", loc, { pitch: 1.2 });
  safeSound(player.dimension, "random.explode", loc, { pitch: 1.0 });

  let targets;
  try {
    targets = player.dimension.getEntities({
      location: loc,
      maxDistance: radius,
      families: ["mob"],
      excludeTypes: [SHARD_ID],
    });
  } catch (e) {
    targets = [];
  }
  for (const t of targets) {
    if (t.id === player.id) continue;
    try {
      t.applyDamage(dmg, { cause: "lightning", damagingEntity: player });
    } catch (e) {}
    applyCopperEffect(t, 1.0); // heavy oxidation
    const dx = t.location.x - loc.x;
    const dz = t.location.z - loc.z;
    const len = Math.hypot(dx, dz) || 1;
    try {
      t.applyKnockback(dx / len, dz / len, 1.2, 0.6);
    } catch (e) {}
  }

  // Copper shard scatter (reuses the relic shard system) - tight & strong.
  shardBurst(player.dimension, loc, fp, true, player.id);
  player.onScreenDisplay.setActionBar(`§b⚡ Copper Thunderlance! §7(${dmg.toFixed(1)} dmg)`);
}

/* ============================================================
 * ABILITY SWITCHING + DISPATCH
 * ============================================================ */

function cycleAbility(player) {
  let a = getNum(player, "cc:ability", 1);
  a = a >= 3 ? 1 : a + 1;
  setNum(player, "cc:ability", a);
  safeSound(player.dimension, "random.orb", player.location, { pitch: 1.2 });
  player.onScreenDisplay.setActionBar(`§7Ability: ${ABILITY_NAMES[a]}`);
}

function activateAbility(player) {
  const a = getNum(player, "cc:ability", 1);
  if (a === 1) {
    // Skybreak: launch, or dive if already airborne & armed.
    if (getBool(player, "cc:skyArmed", false) && !player.isOnGround) {
      skybreakDive(player);
    } else {
      skybreakLaunch(player);
    }
  } else if (a === 2) {
    corruptionRush(player);
  } else if (a === 3) {
    relicSummon(player);
  }
}

function cycleSpearAbility(player) {
  let a = getNum(player, "cc:spAbility", 1);
  a = a >= 3 ? 1 : a + 1;
  setNum(player, "cc:spAbility", a);
  safeSound(player.dimension, "random.orb", player.location, { pitch: 1.4 });
  player.onScreenDisplay.setActionBar(`§7Spear: ${SPEAR_ABILITY_NAMES[a]}`);
}

function activateSpearAbility(player) {
  const a = getNum(player, "cc:spAbility", 1);
  if (a === 1) {
    spearSlipstream(player);
  } else if (a === 2) {
    spearLunge(player);
  } else if (a === 3) {
    spearThunderlance(player);
  }
}

/* ============================================================
 * PER-PLAYER TICK (fall power, slam detection, passives, HUD)
 * ============================================================ */

function playerTick(player) {
  // ---- Always-on combat state (runs regardless of held item) ----

  // ---- Skybreak slam landing detection ----
  if (getBool(player, "cc:slamPending", false)) {
    if (player.isOnGround) {
      player.setDynamicProperty("cc:slamPending", false);
      skybreakSlam(player);
    }
  } else if (getBool(player, "cc:skyArmed", false) && player.isOnGround) {
    // Landed without diving -> disarm.
    player.setDynamicProperty("cc:skyArmed", false);
  }

  corruptionRushTick(player); // sword dash path damage
  spearFlightTick(player);    // spear directional flight
  spearLungeTick(player);     // spear pierce

  // ---- Armor set bonus (independent of held item) ----
  const pieces = copperArmorCount(player);
  if (pieces > 0) {
    try {
      // Increased effective max HP via absorption (1 piece = +2 hearts ... full = +8).
      player.addEffect("absorption", 60, { amplifier: pieces - 1, showParticles: false });
    } catch (e) {}
  }

  // ---- Weapon-only: fall power meter + HUD ----
  const weapon = holdingWeapon(player);
  if (!weapon) return;

  const y = player.location.y;
  const lastY = getNum(player, "cc:lastY", y);
  if (!player.isOnGround && y < lastY) {
    const fp = Math.min(MAX_FALL_POWER, getNum(player, "cc:fallPower", 0) + (lastY - y));
    setNum(player, "cc:fallPower", fp);
  }
  setNum(player, "cc:lastY", y);

  const isSpear = weapon === "spear";
  const a = getNum(player, isSpear ? "cc:spAbility" : "cc:ability", 1);
  const names = isSpear ? SPEAR_ABILITY_NAMES : ABILITY_NAMES;
  const fp = getNum(player, "cc:fallPower", 0);
  const filled = Math.round((fp / MAX_FALL_POWER) * 10);
  let meter = "";
  for (let i = 0; i < 10; i++) meter += i < filled ? "§6▰" : "§8▰";
  player.onScreenDisplay.setActionBar(
    `${names[a]} §r §7[crouch+use to switch]\n§eFall Power ${meter} §7${Math.round(fp)}`
  );
}

// Regeneration near copper blocks (runs less frequently).
function copperRegenTick(player) {
  if (copperArmorCount(player) < 1) return;
  const base = player.location;
  let found = false;
  outer: for (let dx = -2; dx <= 2 && !found; dx++) {
    for (let dz = -2; dz <= 2 && !found; dz++) {
      for (let dy = -1; dy <= 2 && !found; dy++) {
        try {
          const b = player.dimension.getBlock({
            x: Math.floor(base.x) + dx,
            y: Math.floor(base.y) + dy,
            z: Math.floor(base.z) + dz,
          });
          if (b && b.typeId.includes("copper")) {
            found = true;
            break outer;
          }
        } catch (e) {}
      }
    }
  }
  if (found) {
    try {
      player.addEffect("regeneration", 60, { amplifier: 0, showParticles: false });
    } catch (e) {}
  }
}

/* ============================================================
 * EVENT WIRING
 * ============================================================ */

world.afterEvents.itemUse.subscribe((ev) => {
  const player = ev.source;
  const item = ev.itemStack;
  if (!item) return;
  if (item.typeId === SWORD_ID) {
    if (player.isSneaking) cycleAbility(player);
    else activateAbility(player);
  } else if (item.typeId === SPEAR_ID) {
    if (player.isSneaking) cycleSpearAbility(player);
    else activateSpearAbility(player);
  }
});

// Counter mechanic: when a Copper Crusader user is hit, oxidation pauses 5s.
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || e.typeId !== "minecraft:player") return;
  if (holdingWeapon(e)) {
    setNum(world, OX_PAUSE_KEY, system.currentTick + 100);
  }
});

// Statue destroyed early -> instant strong shard burst.
world.afterEvents.entityDie.subscribe((ev) => {
  const e = ev.deadEntity;
  if (!e || e.typeId !== STATUE_ID) return;
  if (getBool(e, "cc:bursted", false)) return; // already handled by expiry
  const fp = getNum(e, "cc:fp", 0);
  const owner = e.getDynamicProperty("cc:owner");
  shardBurst(e.dimension, e.location, fp, true, typeof owner === "string" ? owner : undefined);
});

/* ---------- master tick loops ---------- */

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      playerTick(player);
    } catch (e) {}
  }
  try {
    shardTick();
    statueTick();
  } catch (e) {}
}, 1);

system.runInterval(() => {
  try {
    oxidationTicker();
  } catch (e) {}
  for (const player of world.getAllPlayers()) {
    try {
      copperRegenTick(player);
    } catch (e) {}
  }
}, 20);

world.afterEvents.worldInitialize?.subscribe(() => {});
