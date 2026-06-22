// ============================================================================
//  Warden Zombie Companion  -  smart guardian AI
//
//  The entity (wac:guardian_zombie) provides the *base* behaviours through
//  vanilla-style components (upgraded zombie pathfinding, melee, follow_owner,
//  tag-based target acquisition).  This script layers the "smart" behaviour on
//  top of that:
//
//    * Summoning + ownership + equipment (iron armor, stamping sword, shield)
//    * Friendly targeting   -> attacks whoever the owner attacks / attacks them
//    * Shield blocking       -> intercepts projectiles in its frontal arc
//    * Reactive walls        -> rapidly stacks cobblestone toward a shooter
//    * Jump-crits            -> leaps before a strike for bonus crit damage
//    * Pathing assists       -> stuck-hop over obstacles, teleport-to-owner
//    * Self-repair regen
//
//  Everything that touches the world is wrapped in try/catch so one bad entity
//  (e.g. one that just died) can never break the per-tick loops.
// ============================================================================

import { world, system, EquipmentSlot } from "@minecraft/server";

// ----- identifiers ----------------------------------------------------------
const COMPANION_ID = "wac:guardian_zombie";
const STAFF_ID = "wac:warden_staff";
const SWORD_ID = "wac:stamping_sword";

// ----- tunables -------------------------------------------------------------
const MAX_PER_OWNER = 3;
const ENEMY_DURATION = 30 * 20; // how long a marked enemy stays hostile (ticks)
const WALL_LIFETIME = 12 * 20; // temporary cobblestone wall lifetime (ticks)
const WALL_COOLDOWN = 4 * 20; // min ticks between wall builds per guardian
const CRIT_COOLDOWN = 50; // min ticks between jump-crit attempts
const CRIT_CHANCE = 0.45; // chance to leap when in range & off cooldown
const REGEN_INTERVAL = 60; // heal 1 hp every N ticks when not at full
const BLOCK_FX_COOLDOWN = 4; // min ticks between shield block effects

// ----- tags / dynamic props -------------------------------------------------
const ENEMY_TAG = "wac_enemy"; // read by nearest_attackable_target filter
const OWNER_TAG = "wac_is_owner"; // protects a player from ever being targeted
const CRIT_TAG = "wac_crit"; // set while a guardian is mid jump-crit
const OWNER_PROP = "wac:owner"; // stores owning player's id
const OWNER_NAME_PROP = "wac:owner_name";

// projectiles the shield can intercept
const PROJECTILES = new Set([
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:fireball",
  "minecraft:small_fireball",
  "minecraft:dragon_fireball",
  "minecraft:wither_skull",
  "minecraft:wither_skull_dangerous",
  "minecraft:llama_spit",
  "minecraft:shulker_bullet",
  "minecraft:fishing_hook",
]);

// ----- per-guardian state (keyed by entity id) ------------------------------
const enemyRefs = new Map(); // enemyId -> { entity, expire }
const critCd = new Map(); // guardianId -> next-allowed tick
const wallCd = new Map(); // guardianId -> next-allowed tick
const blockFxCd = new Map(); // guardianId -> last fx tick
const regenCd = new Map(); // guardianId -> last regen tick
const jumpStuck = new Map(); // guardianId -> { x, y, z, stuck }
const tempWalls = []; // { dim, x, y, z, expire }

// cache dimension handles once
const DIMENSIONS = [];
for (const id of ["overworld", "nether", "the_end"]) {
  try {
    DIMENSIONS.push(world.getDimension(id));
  } catch (e) {
    /* dimension unavailable */
  }
}

// ----- small math helpers ---------------------------------------------------
const hyp = (x, y, z) => Math.sqrt(x * x + y * y + (z === undefined ? 0 : z * z));
const isCompanion = (e) => !!e && e.typeId === COMPANION_ID;

function getAllCompanions() {
  const out = [];
  for (const dim of DIMENSIONS) {
    if (!dim) continue;
    let list;
    try {
      list = dim.getEntities({ type: COMPANION_ID });
    } catch (e) {
      continue;
    }
    for (const e of list) out.push(e);
  }
  return out;
}

function mainhandId(ent) {
  try {
    const eq = ent.getComponent("minecraft:equippable");
    if (!eq) return undefined;
    const item = eq.getEquipment(EquipmentSlot.Mainhand);
    return item ? item.typeId : undefined;
  } catch (e) {
    return undefined;
  }
}

// ----- enemy marking --------------------------------------------------------
// Marks an entity as hostile so every guardian will path to & attack it.
// Owners and guardians are never markable, which keeps friendly fire impossible.
function markEnemy(ent) {
  if (!ent) return;
  try {
    if (isCompanion(ent)) return;
    if (ent.typeId === "minecraft:player" && ent.hasTag(OWNER_TAG)) return;
    ent.addTag(ENEMY_TAG);
    enemyRefs.set(ent.id, { entity: ent, expire: system.currentTick + ENEMY_DURATION });
  } catch (e) {
    /* entity gone */
  }
}

// ----- summoning ------------------------------------------------------------
function equipCompanion(z) {
  if (!z) return;
  const cmds = [
    "replaceitem entity @s slot.armor.head 0 iron_helmet",
    "replaceitem entity @s slot.armor.chest 0 iron_chestplate",
    "replaceitem entity @s slot.armor.legs 0 iron_leggings",
    "replaceitem entity @s slot.armor.feet 0 iron_boots",
    "replaceitem entity @s slot.weapon.mainhand 0 wac:stamping_sword",
    "replaceitem entity @s slot.weapon.offhand 0 shield",
  ];
  for (const c of cmds) {
    try {
      z.runCommand(c);
    } catch (e) {
      /* ignore */
    }
  }
}

function summon(player) {
  const dim = player.dimension;

  // enforce the per-owner cap
  let count = 0;
  for (const c of getAllCompanions()) {
    try {
      if (c.getDynamicProperty(OWNER_PROP) === player.id) count++;
    } catch (e) {
      /* ignore */
    }
  }
  if (count >= MAX_PER_OWNER) {
    try {
      player.onScreenDisplay.setActionBar(`§cYour guard is already at full strength (${MAX_PER_OWNER}).`);
    } catch (e) {
      /* ignore */
    }
    return;
  }

  const view = player.getViewDirection();
  const loc = player.location;
  const spawnLoc = { x: loc.x + view.x * 2, y: loc.y + 0.3, z: loc.z + view.z * 2 };

  let z;
  try {
    z = dim.spawnEntity(COMPANION_ID, spawnLoc);
  } catch (e) {
    return;
  }

  player.addTag(OWNER_TAG);
  try {
    z.setDynamicProperty(OWNER_PROP, player.id);
    z.setDynamicProperty(OWNER_NAME_PROP, player.name);
    z.nameTag = `§b${player.name}'s Guardian`;
  } catch (e) {
    /* ignore */
  }

  // tame so minecraft:behavior.follow_owner has an owner to follow
  try {
    const t = z.getComponent("minecraft:tameable");
    if (t) t.tame(player);
  } catch (e) {
    /* ignore */
  }

  // equip next tick, once the entity is fully initialised
  system.run(() => equipCompanion(z));

  try {
    dim.spawnParticle("minecraft:totem_particle", spawnLoc);
  } catch (e) {
    /* ignore */
  }
  try {
    player.runCommand("playsound mob.warden.emerge @a ~ ~ ~ 0.6 1.3");
    player.onScreenDisplay.setActionBar("§aA guardian rises to defend you!");
  } catch (e) {
    /* ignore */
  }
}

// ----- shield: intercept incoming projectiles -------------------------------
function shieldBlockFx(c, at) {
  const last = blockFxCd.get(c.id) || 0;
  if (system.currentTick - last < BLOCK_FX_COOLDOWN) return;
  blockFxCd.set(c.id, system.currentTick);
  try {
    c.setProperty("wac:guarding", true);
  } catch (e) {
    /* ignore */
  }
  system.runTimeout(() => {
    try {
      c.setProperty("wac:guarding", false);
    } catch (e) {
      /* ignore */
    }
  }, 8);
  try {
    c.dimension.spawnParticle("minecraft:critical_hit_emitter", at);
  } catch (e) {
    /* ignore */
  }
  try {
    c.runCommand("playsound item.shield.block @a ~ ~ ~ 1 1");
  } catch (e) {
    /* ignore */
  }
}

function blockProjectiles(c) {
  let view, cloc, headLoc;
  try {
    view = c.getViewDirection();
    cloc = c.location;
    headLoc = c.getHeadLocation();
  } catch (e) {
    return;
  }
  if (!headLoc) headLoc = { x: cloc.x, y: cloc.y + 1.5, z: cloc.z };

  let projs;
  try {
    projs = c.dimension.getEntities({ location: cloc, maxDistance: 4 });
  } catch (e) {
    return;
  }

  const vlen = hyp(view.x, view.y, view.z) || 1;
  for (const p of projs) {
    if (!PROJECTILES.has(p.typeId)) continue;

    let vel;
    try {
      vel = p.getVelocity();
    } catch (e) {
      continue;
    }
    const pl = p.location;
    const toC = { x: headLoc.x - pl.x, y: headLoc.y - pl.y, z: headLoc.z - pl.z };
    const dC = hyp(toC.x, toC.y, toC.z);
    if (dC > 3.5 || dC < 0.001) continue;

    // only block projectiles that are actually heading at the guardian...
    if (vel.x * toC.x + vel.y * toC.y + vel.z * toC.z <= 0) continue;

    // ...and only from within the frontal arc (so flanking shots get through,
    // and the owner's outgoing arrows fired from behind are never blocked)
    const fdot = (view.x * -toC.x + view.y * -toC.y + view.z * -toC.z) / (vlen * dC);
    if (fdot < 0.15) continue;

    try {
      p.remove();
    } catch (e) {
      /* ignore */
    }
    shieldBlockFx(c, pl);
  }
}

// ----- reactive walls -------------------------------------------------------
function placeWall(c, threatLoc) {
  const last = wallCd.get(c.id) || 0;
  if (system.currentTick - last < WALL_COOLDOWN) return;
  wallCd.set(c.id, system.currentTick);

  const cloc = c.location;
  let fx = threatLoc.x - cloc.x;
  let fz = threatLoc.z - cloc.z;
  const fl = hyp(fx, 0, fz) || 1;
  fx /= fl;
  fz /= fl;
  // perpendicular axis for the 3-wide wall
  const px = -fz;
  const pz = fx;
  const baseX = cloc.x + fx * 1.5;
  const baseY = Math.floor(cloc.y);
  const baseZ = cloc.z + fz * 1.5;
  const dim = c.dimension;

  const cells = [];
  for (let w = -1; w <= 1; w++) {
    for (let h = 0; h <= 2; h++) {
      cells.push({
        x: Math.floor(baseX + px * w),
        y: baseY + h,
        z: Math.floor(baseZ + pz * w),
      });
    }
  }

  // place a few blocks per tick so it stacks up fast rather than appearing
  // instantly all at once
  let i = 0;
  const step = () => {
    for (let n = 0; n < 3 && i < cells.length; n++, i++) {
      const cell = cells[i];
      try {
        const b = dim.getBlock(cell);
        if (b && b.isAir) {
          b.setType("minecraft:cobblestone");
          tempWalls.push({ dim, x: cell.x, y: cell.y, z: cell.z, expire: system.currentTick + WALL_LIFETIME });
        }
      } catch (e) {
        /* unloaded / protected */
      }
    }
    if (i < cells.length) system.runTimeout(step, 2);
  };
  step();

  try {
    c.runCommand("playsound dig.stone @a ~ ~ ~ 1 0.8");
  } catch (e) {
    /* ignore */
  }
}

// ----- jump-crits -----------------------------------------------------------
function critJump(c) {
  let tgt;
  try {
    tgt = c.target;
  } catch (e) {
    return;
  }
  if (!tgt) return;
  if (!c.isOnGround) return;

  const last = critCd.get(c.id) || 0;
  if (system.currentTick < last) return;

  const cl = c.location;
  const tl = tgt.location;
  const dx = tl.x - cl.x;
  const dz = tl.z - cl.z;
  const d = hyp(dx, 0, dz);
  if (d < 1.2 || d > 4.0) return;
  if (Math.random() > CRIT_CHANCE) return;

  const nx = dx / d;
  const nz = dz / d;
  try {
    c.applyImpulse({ x: nx * 0.34, y: 0.55, z: nz * 0.34 });
  } catch (e) {
    /* ignore */
  }
  try {
    c.addTag(CRIT_TAG);
  } catch (e) {
    /* ignore */
  }
  critCd.set(c.id, system.currentTick + CRIT_COOLDOWN);
  // clear the crit window if no hit landed during the leap
  system.runTimeout(() => {
    try {
      c.removeTag(CRIT_TAG);
    } catch (e) {
      /* ignore */
    }
  }, 18);
}

function applyCrit(c, hit) {
  try {
    c.removeTag(CRIT_TAG);
  } catch (e) {
    /* ignore */
  }
  try {
    hit.applyDamage(4, { cause: "entityAttack", damagingEntity: c });
  } catch (e) {
    /* ignore */
  }
  try {
    const hl = hit.location;
    c.dimension.spawnParticle("minecraft:critical_hit_emitter", { x: hl.x, y: hl.y + 1, z: hl.z });
  } catch (e) {
    /* ignore */
  }
  try {
    c.runCommand("playsound random.anvil_land @a ~ ~ ~ 0.35 1.7");
  } catch (e) {
    /* ignore */
  }
}

// ----- stamping sword: heavy stagger blow -----------------------------------
function applyStamp(attacker, hit) {
  try {
    const al = attacker.location;
    const hl = hit.location;
    let dx = hl.x - al.x;
    let dz = hl.z - al.z;
    const d = hyp(dx, 0, dz) || 1;
    dx /= d;
    dz /= d;
    try {
      hit.applyKnockback(dx, dz, 1.5, 0.4);
    } catch (e) {
      try {
        hit.applyImpulse({ x: dx * 1.2, y: 0.35, z: dz * 1.2 });
      } catch (e2) {
        /* ignore */
      }
    }
    try {
      hit.runCommand("effect @s slowness 1 1 true");
    } catch (e) {
      /* ignore */
    }
    try {
      attacker.dimension.spawnParticle("minecraft:critical_hit_emitter", hl);
    } catch (e) {
      /* ignore */
    }
  } catch (e) {
    /* ignore */
  }
}

// ----- pathing assists ------------------------------------------------------
function regen(c) {
  const last = regenCd.get(c.id) || 0;
  if (system.currentTick - last < REGEN_INTERVAL) return;
  regenCd.set(c.id, system.currentTick);
  try {
    const h = c.getComponent("minecraft:health");
    if (h && h.currentValue < h.effectiveMax) {
      h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 1));
    }
  } catch (e) {
    /* ignore */
  }
}

function stuckAssist(c, owner) {
  let tgt;
  try {
    tgt = c.target;
  } catch (e) {
    tgt = undefined;
  }
  const cl = c.location;

  // failsafe teleport: if it isn't fighting and falls way behind, snap to owner
  if (owner && !tgt) {
    if (owner.dimension !== c.dimension) {
      try {
        const ol = owner.location;
        c.teleport({ x: ol.x, y: ol.y, z: ol.z }, { dimension: owner.dimension });
      } catch (e) {
        /* ignore */
      }
      jumpStuck.delete(c.id);
      return;
    }
    const ol = owner.location;
    const dd = hyp(ol.x - cl.x, ol.y - cl.y, ol.z - cl.z);
    if (dd > 26) {
      try {
        const v = owner.getViewDirection();
        c.teleport({ x: ol.x - v.x * 1.5, y: ol.y, z: ol.z - v.z * 1.5 }, { dimension: owner.dimension });
      } catch (e) {
        /* ignore */
      }
      jumpStuck.delete(c.id);
      return;
    }
  }

  // stuck-hop: jump to clear a step/obstacle if it has a goal but isn't moving
  const goal = tgt ? tgt.location : owner ? owner.location : undefined;
  if (!goal) {
    jumpStuck.delete(c.id);
    return;
  }
  const gd = hyp(goal.x - cl.x, 0, goal.z - cl.z);
  if (gd < 2.2) {
    jumpStuck.delete(c.id);
    return;
  }

  const prev = jumpStuck.get(c.id);
  if (!prev) {
    jumpStuck.set(c.id, { x: cl.x, y: cl.y, z: cl.z, stuck: 0 });
    return;
  }
  const moved = hyp(cl.x - prev.x, 0, cl.z - prev.z);
  if (moved >= 0.08) {
    jumpStuck.set(c.id, { x: cl.x, y: cl.y, z: cl.z, stuck: 0 });
    return;
  }
  const stuck = (prev.stuck || 0) + 1;
  if (stuck >= 3 && c.isOnGround) {
    let dx = goal.x - cl.x;
    let dz = goal.z - cl.z;
    const dl = hyp(dx, 0, dz) || 1;
    dx /= dl;
    dz /= dl;
    try {
      c.applyImpulse({ x: dx * 0.28, y: 0.45, z: dz * 0.28 });
    } catch (e) {
      /* ignore */
    }
    jumpStuck.set(c.id, { x: cl.x, y: cl.y, z: cl.z, stuck: 0 });
  } else {
    jumpStuck.set(c.id, { x: cl.x, y: cl.y, z: cl.z, stuck });
  }
}

// ----- main loops -----------------------------------------------------------
// fast loop (every tick): shield blocking needs to react before arrows land
system.runInterval(() => {
  try {
    const comps = getAllCompanions();
    if (!comps.length) return;
    for (const c of comps) {
      try {
        blockProjectiles(c);
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    /* ignore */
  }
}, 1);

// behaviour loop (every 4 ticks): crits, pathing, regen, owner bookkeeping
system.runInterval(() => {
  try {
    const comps = getAllCompanions();
    if (!comps.length) return;

    const players = world.getAllPlayers();
    const pById = new Map();
    for (const p of players) pById.set(p.id, p);

    const ownerIds = new Set();
    for (const c of comps) {
      try {
        const oid = c.getDynamicProperty(OWNER_PROP);
        let owner;
        if (typeof oid === "string") {
          ownerIds.add(oid);
          owner = pById.get(oid);
        }
        if (!c.nameTag) {
          const nm = c.getDynamicProperty(OWNER_NAME_PROP);
          if (typeof nm === "string") c.nameTag = `§b${nm}'s Guardian`;
        }
        critJump(c);
        stuckAssist(c, owner);
        regen(c);
      } catch (e) {
        /* ignore */
      }
    }

    // keep owners flagged so guardians can never be turned against them
    for (const p of players) {
      if (ownerIds.has(p.id) && !p.hasTag(OWNER_TAG)) {
        try {
          p.addTag(OWNER_TAG);
        } catch (e) {
          /* ignore */
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
}, 4);

// housekeeping (every second): expire enemy marks, decay temp walls, prune state
system.runInterval(() => {
  try {
    const now = system.currentTick;

    for (const [id, rec] of enemyRefs) {
      if (now > rec.expire) {
        try {
          rec.entity.removeTag(ENEMY_TAG);
        } catch (e) {
          /* entity gone */
        }
        enemyRefs.delete(id);
      }
    }

    if (tempWalls.length) {
      const remain = [];
      for (const w of tempWalls) {
        if (now > w.expire) {
          try {
            const b = w.dim.getBlock({ x: w.x, y: w.y, z: w.z });
            if (b && b.typeId === "minecraft:cobblestone") b.setType("minecraft:air");
          } catch (e) {
            /* unloaded */
          }
        } else {
          remain.push(w);
        }
      }
      tempWalls.length = 0;
      for (const w of remain) tempWalls.push(w);
    }

    // prune per-guardian state for guardians that no longer exist
    const live = new Set(getAllCompanions().map((c) => c.id));
    for (const m of [critCd, wallCd, blockFxCd, regenCd, jumpStuck]) {
      for (const id of m.keys()) if (!live.has(id)) m.delete(id);
    }
  } catch (e) {
    /* ignore */
  }
}, 20);

// ----- events ---------------------------------------------------------------
// summon with the Warden Staff
world.afterEvents.itemUse.subscribe((e) => {
  try {
    if (e.itemStack && e.itemStack.typeId === STAFF_ID && e.source && e.source.typeId === "minecraft:player") {
      summon(e.source);
    }
  } catch (err) {
    /* ignore */
  }
});

// owner strikes a target -> mark it; stamping sword & guardian crits resolve here
world.afterEvents.entityHitEntity.subscribe((e) => {
  try {
    const dmg = e.damagingEntity;
    const hit = e.hitEntity;
    if (!dmg || !hit) return;

    if (dmg.typeId === "minecraft:player" && dmg.hasTag(OWNER_TAG)) markEnemy(hit);
    if (mainhandId(dmg) === SWORD_ID) applyStamp(dmg, hit);
    if (isCompanion(dmg)) {
      // drive the sword-swing animation
      try {
        dmg.setProperty("wac:attacking", true);
        system.runTimeout(() => {
          try {
            dmg.setProperty("wac:attacking", false);
          } catch (e) {
            /* ignore */
          }
        }, 9);
      } catch (e) {
        /* ignore */
      }
      try {
        if (dmg.hasTag(CRIT_TAG)) applyCrit(dmg, hit);
      } catch (err) {
        /* ignore */
      }
    }
  } catch (err) {
    /* ignore */
  }
});

// something hurts the owner -> retaliate; something shoots a guardian -> wall up
world.afterEvents.entityHurt.subscribe((e) => {
  try {
    const hurt = e.hurtEntity;
    const src = e.damageSource;
    if (!hurt || !src) return;

    if (hurt.typeId === "minecraft:player" && hurt.hasTag(OWNER_TAG)) {
      if (src.damagingEntity) markEnemy(src.damagingEntity);
      return;
    }

    if (isCompanion(hurt)) {
      const attacker = src.damagingEntity;
      if (attacker && !isCompanion(attacker)) {
        const isOwner = attacker.typeId === "minecraft:player" && attacker.hasTag(OWNER_TAG);
        if (!isOwner) markEnemy(attacker);
      }
      if (src.cause === "projectile") {
        let threat;
        if (attacker) threat = attacker.location;
        else if (src.damagingProjectile) threat = src.damagingProjectile.location;
        if (threat) placeWall(hurt, threat);
      }
    }
  } catch (err) {
    /* ignore */
  }
});

try {
  console.warn("[Warden Zombie Companion] loaded");
} catch (e) {
  /* ignore */
}
