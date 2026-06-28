import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const ITEM_ID = "fcm:cheat_feather";

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

const TARGET_MODES = ["Mobs + Players", "Mobs only", "Players only"];

// Per-player state: { toggles..., cfg:{reach,cps,aimRange,targets}, _lastHit, _flying }
const states = new Map();

function getState(player) {
  let s = states.get(player.id);
  if (!s) {
    s = { _lastHit: 0, _flying: false, cfg: { reach: 4, cps: 8, aimRange: 16, targets: 0 } };
    for (const c of CHEATS) s[c.key] = false;
    states.set(player.id, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------
function openMenu(player) {
  const st = getState(player);
  const form = new ActionFormData().title("§l§cCHEAT MENU").body("§7Tap a cheat to toggle it.\n");
  for (const c of CHEATS) form.button(`${c.label} ${st[c.key] ? "§a[ON]" : "§c[OFF]"}`);
  form.button("§e⚙ Settings");

  form.show(player).then((res) => {
    if (res.canceled) return;
    if (res.selection === CHEATS.length) { openSettings(player); return; }
    const chosen = CHEATS[res.selection];
    if (!chosen) return;
    st[chosen.key] = !st[chosen.key];
    const now = st[chosen.key];
    player.sendMessage(`§e[Cheat] §f${chosen.label} §r${now ? "§aENABLED" : "§cDISABLED"}`);
    player.playSound(now ? "random.orb" : "random.click");
    if (chosen.key === "fly" && !now) stopFly(player, st);
    system.run(() => openMenu(player));
  }).catch(() => {});
}

function openSettings(player) {
  const st = getState(player);
  const c = st.cfg;
  const form = new ModalFormData()
    .title("§l§eCheat Settings")
    .slider("Reach / attack distance (blocks)", 2, 8, 1, c.reach)
    .slider("Attacks per second (CPS)", 1, 20, 1, c.cps)
    .slider("Aimbot lock-on range (blocks)", 5, 32, 1, c.aimRange)
    .dropdown("Aimbot targets", TARGET_MODES, c.targets);

  form.show(player).then((res) => {
    if (!res.canceled && res.formValues) {
      const [reach, cps, aimRange, targets] = res.formValues;
      st.cfg = { reach, cps, aimRange, targets };
      player.sendMessage(`§a[Cheat] §7Saved: reach §f${reach}§7, §f${cps}§7 CPS, aim §f${aimRange}§7, §f${TARGET_MODES[targets]}`);
    }
    system.run(() => openMenu(player));
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
  if (t === "minecraft:item" || t === "minecraft:xp_orb" || t === "minecraft:arrow" ||
      t === "minecraft:area_effect_cloud" || t === "minecraft:fishing_hook") return false;
  // must have a health component to be a living, damageable target
  try { return !!e.getComponent("minecraft:health"); } catch (_) { return false; }
}

// Nearest living target within range, honouring the player's target-mode setting.
function nearestTarget(player, range, mode) {
  const loc = player.location;
  let pool = [];
  try {
    pool = player.dimension.getEntities({ location: loc, maxDistance: range }).filter((e) => e.id !== player.id);
  } catch (_) { return null; }
  let best = null, bestD = Infinity;
  for (const e of pool) {
    if (!isAttackable(player, e)) continue;
    const isPlayer = e.typeId === "minecraft:player";
    if (mode === 1 && isPlayer) continue;   // Mobs only
    if (mode === 2 && !isPlayer) continue;  // Players only
    const d = dist(loc, e.location);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

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

// Effect-based flight: look up to rise, level to hover, look down to descend.
// Works on every world (no /ability command required).
function doFly(player) {
  try {
    const pitch = player.getRotation().x; // -90 = straight up, +90 = straight down
    const opt = { amplifier: 1, showParticles: false };
    player.addEffect("slow_falling", 6, { amplifier: 0, showParticles: false }); // never take fall dmg
    if (pitch < -20) {
      player.addEffect("levitation", 6, opt);            // ascend
    } else if (pitch > 25) {
      player.removeEffect("levitation");                 // descend gently (slow_falling handles it)
    } else {
      player.addEffect("levitation", 6, { amplifier: 0, showParticles: false }); // hover-ish
    }
  } catch (_) {}
}
function stopFly(player, st) {
  st._flying = false;
  try { player.removeEffect("levitation"); player.removeEffect("slow_falling"); } catch (_) {}
}

const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
function compass(from, to) {
  let deg = Math.atan2(to.x - from.x, to.z - from.z) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  return DIRS[Math.round(deg / 45) % 8];
}

// ---------------------------------------------------------------------------
// Main loop — every tick. CPS gating keeps attack rate configurable.
// ---------------------------------------------------------------------------
system.runInterval(() => {
  const tick = system.currentTick;
  for (const player of world.getAllPlayers()) {
    const st = states.get(player.id);
    if (!st) continue;
    try { tickPlayer(player, st, tick); } catch (_) {}
  }
}, 1);

function tickPlayer(player, st, tick) {
  const c = st.cfg;

  // Aimbot / Bow Aimbot
  if (st.aim_assist || st.bow_aimbot) {
    const mode = st.bow_aimbot && !st.aim_assist ? 2 : c.targets; // bow aimbot => players
    const target = nearestTarget(player, c.aimRange, mode);
    if (target) faceEntity(player, target);
  }

  // Attack-rate gate for trigger bot / auto clicker / kill aura
  const cooldown = Math.max(1, Math.round(20 / c.cps));
  const canHit = tick - st._lastHit >= cooldown;

  if (canHit && (st.trigger_bot || st.auto_clicker || st.kill_aura)) {
    let hit = false;

    if (st.kill_aura) {
      try {
        for (const e of player.dimension.getEntities({ location: player.location, maxDistance: c.reach + 1 })) {
          if (isAttackable(player, e)) { e.applyDamage(4, { cause: "entityAttack", damagingEntity: player }); hit = true; }
        }
      } catch (_) {}
    }

    if (st.trigger_bot || st.auto_clicker) {
      try {
        const hits = player.getEntitiesFromViewDirection({ maxDistance: c.reach });
        const target = hits.length ? hits[0].entity : null;
        if (isAttackable(player, target)) {
          target.applyDamage(st.auto_clicker ? 6 : 4, { cause: "entityAttack", damagingEntity: player });
          hit = true;
        }
      } catch (_) {}
    }

    if (hit) st._lastHit = tick;
  }

  // Fly
  if (st.fly) { st._flying = true; doFly(player); }

  // ESP radar (refresh ~5x/sec)
  if (st.esp && tick % 4 === 0) {
    try {
      const loc = player.location;
      const near = player.dimension.getEntities({ location: loc, maxDistance: 64 })
        .filter((e) => e.id !== player.id && isAttackable(player, e));
      near.sort((a, b) => dist(loc, a.location) - dist(loc, b.location));
      const lines = near.slice(0, 5).map((e) => {
        const name = e.typeId === "minecraft:player" ? `§b${e.name}` : `§f${e.typeId.replace("minecraft:", "")}`;
        return `${name} §7${dist(loc, e.location).toFixed(0)}m ${compass(loc, e.location)}`;
      });
      player.onScreenDisplay.setActionBar(lines.length ? `§cESP\n${lines.join("\n")}` : "§cESP §7no targets");
    } catch (_) {}
  }
}

// Anti-knockback + no-fall
world.afterEvents.entityHurt.subscribe((ev) => {
  const e = ev.hurtEntity;
  if (!e || e.typeId !== "minecraft:player") return;
  const st = states.get(e.id);
  if (!st) return;
  if (st.velocity) system.run(() => { try { e.clearVelocity(); } catch (_) {} });
  if (st.no_fall && ev.damageSource?.cause === "fall") {
    system.run(() => { try { e.runCommand("effect @s instant_health 1 10 true"); } catch (_) {} });
  }
});

// ---------------------------------------------------------------------------
// Item use → menu. First spawn → give feather. !feather chat shortcut.
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
