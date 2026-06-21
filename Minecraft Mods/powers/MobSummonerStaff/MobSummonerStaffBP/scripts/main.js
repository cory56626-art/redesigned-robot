import { world, system } from "@minecraft/server";

/*
 * Mob Summoner Staff
 * ------------------
 * Use (interact)          -> summon the currently selected minion
 * Use while looking at one
 *   of YOUR minions        -> recall (dismiss) that minion
 * Sneak + Use (interact)  -> switch to the next ability / minion type
 *
 * Summoned minions are tamed to the player, so the vanilla wolf-style
 * "owner_hurt_target" / "owner_hurt_by_target" behaviours make them
 * automatically attack whatever you attack (and defend you).
 */

const STAFF_ID = "mss:summoner_staff";
const SEL_PROP = "mss:sel";
const BORN_PROP = "mss:born";
const MAX_MINIONS = 12;

// Roster of summonable minions. Order = cycle order.
const ROSTER = [
  {
    id: "mss:minion_zombie",
    name: "§2Zombie Brute",
    ability: "§7Tanky melee bruiser that swarms your targets.",
  },
  {
    id: "mss:minion_skeleton",
    name: "§fSkeleton Archer",
    ability: "§7Rains arrows on whoever you attack.",
  },
  {
    id: "mss:minion_wither_skeleton",
    name: "§8Wither Knight",
    ability: "§7Heavy melee that inflicts the Wither effect.",
  },
  {
    id: "mss:minion_spider",
    name: "§4Spider Stalker",
    ability: "§7Fast, wall-climbing flanker.",
  },
  {
    id: "mss:minion_creeper",
    name: "§aCreeper Sapper",
    ability: "§7Charges enemies and detonates (no block damage).",
  },
  {
    id: "mss:minion_enderman",
    name: "§5Enderman Reaper",
    ability: "§7Teleports to targets and hits very hard.",
  },
  {
    id: "mss:minion_iron_golem",
    name: "§7Iron Guardian",
    ability: "§fHuge tank with massive knockback. (Slow)",
  },
];

function safeRun(fn) {
  try { fn(); } catch (e) { /* ignore runtime hiccups */ }
}

function getSelection(player) {
  const v = player.getDynamicProperty(SEL_PROP);
  if (typeof v !== "number" || v < 0 || v >= ROSTER.length) return 0;
  return v;
}

function actionbar(player, text) {
  safeRun(() => player.onScreenDisplay.setActionBar(text));
}

function ownerTag(player) {
  return "mss_owner_" + player.id;
}

function ownedMinions(player) {
  return player.dimension
    .getEntities({ tags: ["mss_minion", ownerTag(player)] })
    .filter((e) => e.isValid());
}

function cycleAbility(player) {
  let idx = getSelection(player);
  idx = (idx + 1) % ROSTER.length;
  player.setDynamicProperty(SEL_PROP, idx);
  const entry = ROSTER[idx];
  actionbar(player, `§dStaff » ${entry.name}\n${entry.ability}`);
  safeRun(() => player.playSound("note.pling", { pitch: 1.2 + idx * 0.05 }));
}

function summonSelected(player) {
  const idx = getSelection(player);
  const entry = ROSTER[idx];

  // Enforce a per-player cap; cull the oldest when full.
  const owned = ownedMinions(player);
  if (owned.length >= MAX_MINIONS) {
    owned.sort(
      (a, b) =>
        (a.getDynamicProperty(BORN_PROP) ?? 0) -
        (b.getDynamicProperty(BORN_PROP) ?? 0)
    );
    safeRun(() => owned[0].remove());
  }

  const dir = player.getViewDirection();
  const loc = {
    x: player.location.x + dir.x * 2,
    y: player.location.y + 0.2,
    z: player.location.z + dir.z * 2,
  };

  let ent;
  try {
    ent = player.dimension.spawnEntity(entry.id, loc);
  } catch (e) {
    actionbar(player, "§cCan't summon here.");
    return;
  }

  // Tame so the wolf-style owner behaviours fire, then tag for tracking.
  safeRun(() => ent.getComponent("minecraft:tameable")?.tame(player));
  safeRun(() => ent.addTag("mss_minion"));
  safeRun(() => ent.addTag(ownerTag(player)));
  safeRun(() => ent.setDynamicProperty(BORN_PROP, system.currentTick));
  safeRun(() => (ent.nameTag = entry.name));

  safeRun(() =>
    ent.dimension.spawnParticle("minecraft:basic_smoke_particle", {
      x: loc.x,
      y: loc.y + 1,
      z: loc.z,
    })
  );
  safeRun(() => player.playSound("conduit.activate", { pitch: 1.4 }));
  actionbar(player, `§aSummoned ${entry.name}§a! §7(${owned.length + 1}/${MAX_MINIONS})`);
}

function tryRecall(player) {
  const hits = player.getEntitiesFromViewDirection({ maxDistance: 6 });
  for (const hit of hits) {
    const e = hit.entity;
    if (e && e.isValid() && e.hasTag("mss_minion") && e.hasTag(ownerTag(player))) {
      safeRun(() =>
        e.dimension.spawnParticle("minecraft:basic_smoke_particle", e.location)
      );
      safeRun(() => player.playSound("mob.endermen.portal", { pitch: 1.5 }));
      safeRun(() => e.remove());
      actionbar(player, "§7Minion recalled.");
      return true;
    }
  }
  return false;
}

// ---- Input handling -------------------------------------------------------
// Debounce so air-interact and block-interact can't both fire in one tick.
const lastAction = new Map();

function handleStaffUse(player, stack) {
  if (!player || stack?.typeId !== STAFF_ID) return;
  const t = system.currentTick;
  if (lastAction.get(player.id) === t) return;
  lastAction.set(player.id, t);

  if (player.isSneaking) {
    cycleAbility(player);
  } else {
    // Looking at one of your minions = recall it; otherwise summon.
    if (!tryRecall(player)) summonSelected(player);
  }
}

// Fires when interacting with air (and most non-interactive blocks).
world.afterEvents.itemUse.subscribe((ev) => handleStaffUse(ev.source, ev.itemStack));

// Also fire when interacting while pointing at a block, across API versions.
safeRun(() =>
  world.afterEvents.itemUseOn?.subscribe((ev) =>
    handleStaffUse(ev.source, ev.itemStack)
  )
);
safeRun(() =>
  world.afterEvents.playerInteractWithBlock?.subscribe((ev) =>
    handleStaffUse(ev.player, ev.itemStack)
  )
);

// ---- Creeper Sapper detonation -------------------------------------------
const DETONATE_RADIUS = 3.2;
const DAMAGE_RADIUS = 4.5;
const CREEPER_DAMAGE = 16;

function isEnemyOf(entity, ownerId) {
  if (!entity.isValid()) return false;
  if (entity.typeId === "minecraft:player") return false;
  if (entity.hasTag("mss_minion")) return false;
  return true;
}

system.runInterval(() => {
  let creepers;
  try {
    creepers = world.getDimension("overworld").getEntities({ families: ["mss_creeper"] });
  } catch (e) {
    return;
  }
  // Also sweep nether/end so creepers work everywhere.
  for (const dimId of ["nether", "the_end"]) {
    safeRun(() => {
      creepers = creepers.concat(
        world.getDimension(dimId).getEntities({ families: ["mss_creeper"] })
      );
    });
  }

  for (const creeper of creepers) {
    if (!creeper.isValid()) continue;

    // Find a valid enemy in detonation range.
    let nearby = [];
    safeRun(() => {
      nearby = creeper.dimension.getEntities({
        location: creeper.location,
        maxDistance: DETONATE_RADIUS,
        families: ["monster"],
      });
    });

    let target = creeper.target; // may be undefined on some versions
    let inRange = nearby.length > 0;
    if (!inRange && target && target.isValid()) {
      const d = Math.hypot(
        target.location.x - creeper.location.x,
        target.location.y - creeper.location.y,
        target.location.z - creeper.location.z
      );
      if (d <= DETONATE_RADIUS) inRange = true;
    }
    if (!inRange) continue;

    const loc = creeper.location;
    const dim = creeper.dimension;

    safeRun(() => dim.spawnParticle("minecraft:huge_explosion_emitter", loc));
    safeRun(() => dim.playSound("random.explode", loc));

    // Manual, friendly-safe AoE damage (no block damage, never hits owner/minions).
    let victims = [];
    safeRun(() => {
      victims = dim.getEntities({ location: loc, maxDistance: DAMAGE_RADIUS });
    });
    for (const v of victims) {
      if (isEnemyOf(v)) {
        safeRun(() => v.applyDamage(CREEPER_DAMAGE, { cause: "entityExplosion", damagingEntity: creeper }));
      }
    }
    safeRun(() => creeper.remove());
  }
}, 5);

// ---- Welcome message on first join ---------------------------------------
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {
    safeRun(() =>
      p.sendMessage(
        "§5[Mob Summoner Staff] §7Craft the staff (Blaze Rod + Diamond + Eye of Ender).\n" +
          "§7• §fUse§7 to summon  • §fLook at a minion + Use§7 to recall  • §fSneak + Use§7 to switch ability."
      )
    );
  }, 40);
});
