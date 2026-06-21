
import { world, system } from "@minecraft/server";

// --- TNT registry (mirrors build.py) -------------------------------------
const TNT = {
  "tnt_mod:radioactive_tnt": { primed: "tnt_mod:primed_radioactive_tnt", radius: 6,  fuse: 80,  fire: false, effect: "radioactive" },
  "tnt_mod:chain_tnt":       { primed: "tnt_mod:primed_chain_tnt",       radius: 3,  fuse: 60,  fire: false, effect: "chain" },
  "tnt_mod:mini_tnt":        { primed: "tnt_mod:primed_mini_tnt",        radius: 2,  fuse: 25,  fire: false, effect: "none" },
  "tnt_mod:nuke_tnt":        { primed: "tnt_mod:primed_nuke_tnt",        radius: 18, fuse: 120, fire: true,  effect: "nuke" },
  "tnt_mod:lightning_tnt":   { primed: "tnt_mod:primed_lightning_tnt",   radius: 4,  fuse: 70,  fire: false, effect: "lightning" },
  "tnt_mod:ender_tnt":       { primed: "tnt_mod:primed_ender_tnt",       radius: 4,  fuse: 70,  fire: false, effect: "ender" },
  "tnt_mod:rainbow_tnt":     { primed: "tnt_mod:primed_rainbow_tnt",     radius: 5,  fuse: 70,  fire: false, effect: "rainbow" },
};

const rand = (a, b) => a + Math.random() * (b - a);

// Spawn a primed TNT entity and schedule its detonation.
function ignite(dimension, blockPos, cfg, fuse, impulse) {
  const center = {
    x: Math.floor(blockPos.x) + 0.5,
    y: Math.floor(blockPos.y) + 0.5,
    z: Math.floor(blockPos.z) + 0.5,
  };
  let entity;
  try { entity = dimension.spawnEntity(cfg.primed, center); }
  catch (e) { return; }
  if (impulse) { try { entity.applyImpulse(impulse); } catch (e) {} }
  const ticks = fuse ?? cfg.fuse;
  system.runTimeout(() => detonate(entity, cfg), ticks);
}

// Ignite any of our placed TNT blocks within range -> chain reactions.
function igniteNearby(dimension, loc, radius) {
  const r = Math.min(Math.ceil(radius), 6);
  for (let x = -r; x <= r; x++)
    for (let y = -r; y <= r; y++)
      for (let z = -r; z <= r; z++) {
        const pos = { x: Math.floor(loc.x) + x, y: Math.floor(loc.y) + y, z: Math.floor(loc.z) + z };
        let block;
        try { block = dimension.getBlock(pos); } catch (e) { continue; }
        if (!block) continue;
        const cfg = TNT[block.typeId];
        if (cfg) {
          try { block.setType("minecraft:air"); } catch (e) {}
          ignite(dimension, pos, cfg, 5 + Math.floor(rand(0, 16)));
        }
      }
}

function detonate(entity, cfg) {
  let loc, dim;
  try { loc = entity.location; dim = entity.dimension; }
  catch (e) { return; }          // entity already gone
  try { entity.remove(); } catch (e) {}

  igniteNearby(dim, loc, cfg.radius);
  applyEffect(dim, loc, cfg);

  try {
    dim.createExplosion(loc, cfg.radius, {
      breaksBlocks: true,
      causesFire: cfg.fire,
      allowUnderwater: true,
    });
  } catch (e) {}
}

function applyEffect(dim, loc, cfg) {
  switch (cfg.effect) {
    case "radioactive": {
      poisonWave(dim, loc, cfg.radius + 4, 4);    // lingering toxic cloud
      break;
    }
    case "chain": {
      const mini = TNT["tnt_mod:mini_tnt"];
      for (let i = 0; i < 5; i++) {
        const off = { x: loc.x + rand(-2, 2), y: loc.y + 0.5, z: loc.z + rand(-2, 2) };
        const vel = { x: rand(-0.3, 0.3), y: rand(0.4, 0.7), z: rand(-0.3, 0.3) };
        ignite(dim, off, mini, 15 + Math.floor(rand(0, 25)), vel);
      }
      break;
    }
    case "lightning": {
      try { dim.spawnEntity("minecraft:lightning_bolt", loc); } catch (e) {}
      for (let i = 0; i < 3; i++) {
        const off = { x: loc.x + rand(-5, 5), y: loc.y, z: loc.z + rand(-5, 5) };
        try { dim.spawnEntity("minecraft:lightning_bolt", off); } catch (e) {}
      }
      break;
    }
    case "ender": {
      let mobs = [];
      try { mobs = dim.getEntities({ location: loc, maxDistance: cfg.radius + 6 }); } catch (e) {}
      for (const m of mobs) {
        if (m.typeId === "minecraft:item") continue;
        try {
          m.teleport({ x: loc.x + rand(-15, 15), y: loc.y + rand(0, 6), z: loc.z + rand(-15, 15) });
        } catch (e) {}
      }
      try { dim.spawnParticle("minecraft:knockback_roar_particle", loc); } catch (e) {}
      break;
    }
    case "rainbow": {
      // burst of coloured smoke around the blast
      for (let i = 0; i < 24; i++) {
        const off = { x: loc.x + rand(-cfg.radius, cfg.radius), y: loc.y + rand(0, 3), z: loc.z + rand(-cfg.radius, cfg.radius) };
        try { dim.spawnParticle("minecraft:colored_flame_particle", off); } catch (e) {}
      }
      break;
    }
    case "nuke": {
      // mushroom ring of secondary blasts
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const off = { x: loc.x + Math.cos(a) * cfg.radius * 0.6, y: loc.y, z: loc.z + Math.sin(a) * cfg.radius * 0.6 };
        try { dim.createExplosion(off, cfg.radius * 0.5, { breaksBlocks: true, causesFire: true, allowUnderwater: true }); } catch (e) {}
      }
      poisonWave(dim, loc, cfg.radius, 6);
      break;
    }
  }
}

// Apply poison/wither to nearby living entities over several ticks.
function poisonWave(dim, loc, range, waves) {
  let n = 0;
  const id = system.runInterval(() => {
    let mobs = [];
    try { mobs = dim.getEntities({ location: loc, maxDistance: range }); } catch (e) {}
    for (const m of mobs) {
      try {
        m.addEffect("poison", 120, { amplifier: 2, showParticles: true });
        m.addEffect("wither", 80, { amplifier: 1, showParticles: true });
        m.addEffect("nausea", 120, { amplifier: 0, showParticles: true });
      } catch (e) {}
    }
    try { dim.spawnParticle("minecraft:wither_boss_invulnerable_particle", loc); } catch (e) {}
    if (++n >= waves) system.clearRun(id);
  }, 10);
}

// --- Ignition: right-click any custom TNT with flint & steel --------------
world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || item.typeId !== "minecraft:flint_and_steel") return;
  const cfg = TNT[ev.block?.typeId];
  if (!cfg) return;
  const dim = ev.block.dimension;
  const pos = ev.block.location;
  try { ev.block.setType("minecraft:air"); } catch (e) {}
  ignite(dim, pos, cfg);
});

world.afterEvents.worldInitialize?.subscribe?.(() => {});
