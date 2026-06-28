import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// Identifier of our custom feather item (defined in items/cheat_feather.json)
const ITEM_ID = "fcm:cheat_feather";

// The menu entries. Each one drives a REAL behavior in the tick loop below.
const CHEATS = [
  { key: "aim_assist",   label: "Aimbot" },
  { key: "bow_aimbot",   label: "Bow Aimbot" },
  { key: "trigger_bot",  label: "Trigger Bot" },
  { key: "kill_aura",    label: "Kill Aura" },
  { key: "auto_clicker", label: "Auto Clicker" },
  { key: "esp",          label: "ESP / Radar" },
  { key: "reach",        label: "Reach" },
  { key: "velocity",     label: "Velocity (Anti-Knockback)" },
  { key: "fly",          label: "Fly" },
  { key: "no_fall",      label: "No Fall Damage" },
];

// Per-player toggle state, keyed by player id.
const states = new Map();

function getState(player) {
  let s = states.get(player.id);
  if (!s) {
    s = {};
    for (const c of CHEATS) s[c.key] = false;
    states.set(player.id, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
function openMenu(player) {
  const state = getState(player);

  const form = new ActionFormData()
    .title("§l§cCHEAT MENU")
    .body("§7Tap a cheat to toggle it.\n");

  for (const c of CHEATS) {
    const on = state[c.key];
    form.button(`${c.label} ${on ? "§a[ON]" : "§c[OFF]"}`);
  }

  form.show(player).then((res) => {
    if (res.canceled) return;
    const chosen = CHEATS[res.selection];
    if (!chosen) return;

    state[chosen.key] = !state[chosen.key];
    const now = state[chosen.key];

    player.sendMessage(`§e[Cheat] §f${chosen.label} §r${now ? "§aENABLED" : "§cDISABLED"}`);
    player.playSound(now ? "random.orb" : "random.click");

    // Toggles that need to be applied the moment they change.
    if (chosen.key === "fly") applyFly(player, now);

    system.run(() => openMenu(player)); // re-open so you can flip several
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isAttackable(player, e) {
  if (!e || e.id === player.id) return false;
  try { if (!e.isValid()) return false; } catch (_) {}
  const t = e.typeId;
  if (t === "minecraft:item" || t === "minecraft:xp_orb" ||
      t === "minecraft:arrow" || t === "minecraft:area_effect_cloud") return false;
  return true;
}

function nearestTarget(player, range, includeMobs) {
  const loc = player.location;
  const list = [];
  try {
    list.push(...player.dimension.getPlayers({ location: loc, maxDistance: range, excludeNames: [player.name] }));
  } catch (_) {}
  if (includeMobs) {
    try {
      list.push(...player.dimension.getEntities({ location: loc, maxDistance: range, families: ["monster"] }));
    } catch (_) {}
  }
  let best = null, bestD = Infinity;
  for (const e of list) {
    if (!isAttackable(player, e)) continue;
    const d = dist(loc, e.location);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Snap the player's camera to look directly at a target (the "aimbot").
function faceEntity(player, target) {
  try {
    const h = player.getHeadLocation();
    const t = target.getHeadLocation();
    const dx = t.x - h.x, dy = t.y - h.y, dz = t.z - h.z;
    const flat = Math.sqrt(dx * dx + dz * dz);
    const yaw = -Math.atan2(dx, dz) * (180 / Math.PI);
    const pitch = -Math.atan2(dy, flat) * (180 / Math.PI);
    player.setRotation({ x: pitch, y: yaw });
  } catch (_) {}
}

function applyFly(player, on) {
  try { player.runCommand(`ability @s mayfly ${on ? "true" : "false"}`); } catch (_) {}
}

const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
function compass(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  let deg = Math.atan2(dx, dz) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return DIRS[Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// Main tick loop — runs every 2 ticks (0.1s) and enacts each enabled cheat.
// ---------------------------------------------------------------------------
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const st = states.get(player.id);
    if (!st) continue;
    try { tickPlayer(player, st); } catch (_) {}
  }
}, 2);

function tickPlayer(player, st) {
  const reach = st.reach ? 7 : 4;

  // Aimbot / Bow Aimbot — snap view to nearest target.
  if (st.aim_assist || st.bow_aimbot) {
    const target = nearestTarget(player, 28, st.aim_assist); // aimbot also tracks mobs
    if (target) faceEntity(player, target);
  }

  // Trigger Bot / Auto Clicker — damage whatever the crosshair is on.
  if (st.trigger_bot || st.auto_clicker) {
    try {
      const hits = player.getEntitiesFromViewDirection({ maxDistance: reach });
      const target = hits.length ? hits[0].entity : null;
      if (isAttackable(player, target)) {
        target.applyDamage(st.auto_clicker ? 6 : 4, { cause: "entityAttack", damagingEntity: player });
      }
    } catch (_) {}
  }

  // Kill Aura — damage every entity within reach, no aiming required.
  if (st.kill_aura) {
    try {
      const ents = player.dimension.getEntities({
        location: player.location, maxDistance: reach + 1,
        excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
      });
      for (const e of ents) {
        if (isAttackable(player, e)) {
          e.applyDamage(4, { cause: "entityAttack", damagingEntity: player });
        }
      }
    } catch (_) {}
  }

  // ESP / Radar — list nearby players & mobs (through walls) in the action bar.
  if (st.esp) {
    try {
      const loc = player.location;
      const near = player.dimension.getEntities({
        location: loc, maxDistance: 60,
        excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow"],
      }).filter((e) => e.id !== player.id);
      near.sort((a, b) => dist(loc, a.location) - dist(loc, b.location));
      const lines = near.slice(0, 5).map((e) => {
        const name = e.typeId === "minecraft:player"
          ? `§b${e.name}`
          : `§f${e.typeId.replace("minecraft:", "")}`;
        return `${name} §7${dist(loc, e.location).toFixed(0)}m ${compass(loc, e.location)}`;
      });
      player.onScreenDisplay.setActionBar(lines.length ? `§cESP\n${lines.join("\n")}` : "§cESP §7no targets");
    } catch (_) {}
  }
}

// Velocity / Anti-Knockback — cancel knockback the instant you're hit.
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || e.typeId !== "minecraft:player") return;
  const st = states.get(e.id);
  if (st?.velocity) system.run(() => { try { e.clearVelocity(); } catch (_) {} });
});

// No Fall Damage — instantly heal back any fall damage taken.
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || e.typeId !== "minecraft:player") return;
  const st = states.get(e.id);
  if (st?.no_fall && ev.damageSource?.cause === "fall") {
    system.run(() => { try { e.runCommand("effect @s instant_health 1 10 true"); } catch (_) {} });
  }
});

// ---------------------------------------------------------------------------
// Item use → open menu. First spawn → hand out the feather. !feather in chat.
// ---------------------------------------------------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId !== ITEM_ID) return;
  const player = ev.source;
  system.run(() => openMenu(player));
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  system.run(() => {
    try {
      player.runCommand(`give @s ${ITEM_ID} 1`);
      player.sendMessage("§a[Cheat Menu] §7You got a §bCheat Feather§7 — use it to open the menu!");
    } catch (_) {}
  });
});

world.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim().toLowerCase();
  if (msg === "!feather" || msg === "!cheat") {
    ev.cancel = true;
    const player = ev.sender;
    system.run(() => { try { player.runCommand(`give @s ${ITEM_ID} 1`); } catch (_) {} });
  }
});
