import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// Identifier of our custom feather item (defined in items/cheat_feather.json)
const ITEM_ID = "fcm:cheat_feather";

// The list of "cheats" shown in the menu. None of these do anything real —
// it's a prank/joke menu. Toggling just flips a fake ON/OFF state.
const CHEATS = [
  { key: "aim_assist",   label: "Aim Assist" },
  { key: "bow_aimbot",   label: "Bow Aimbot" },
  { key: "trigger_bot",  label: "Trigger Bot" },
  { key: "kill_aura",    label: "Kill Aura" },
  { key: "auto_clicker", label: "Auto Clicker" },
  { key: "esp",          label: "ESP / Wallhack" },
  { key: "reach",        label: "Reach" },
  { key: "velocity",     label: "Velocity (Anti-Knockback)" },
  { key: "fly",          label: "Fly" },
  { key: "fast_place",   label: "Fast Place" },
];

// Per-player fake toggle state, keyed by player id.
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

function openMenu(player) {
  const state = getState(player);

  const form = new ActionFormData()
    .title("§l§cCHEAT MENU")
    .body("§7Tap a cheat to toggle it.\n§8(100% fake — just for fun)\n");

  for (const c of CHEATS) {
    const on = state[c.key];
    const status = on ? "§a[ON]" : "§c[OFF]";
    form.button(`${c.label} ${status}`);
  }

  // Show next tick so the form opens reliably after the item-use event.
  form.show(player).then((res) => {
    if (res.canceled) return;
    const chosen = CHEATS[res.selection];
    if (!chosen) return;

    state[chosen.key] = !state[chosen.key];
    const now = state[chosen.key];

    player.sendMessage(
      `§e[Cheat] §f${chosen.label} §r${now ? "§aENABLED" : "§cDISABLED"}`
    );
    player.playSound(now ? "random.orb" : "random.click");

    // Re-open the menu so the player can keep toggling.
    system.run(() => openMenu(player));
  }).catch(() => {
    // Form failed to open (player busy / closed chat) — ignore.
  });
}

// Open the menu when the player uses (right-click / long-press) the feather.
world.afterEvents.itemUse.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || item.typeId !== ITEM_ID) return;
  const player = ev.source;
  system.run(() => openMenu(player));
});

// Give the Cheat Feather the first time a player spawns into the world.
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  system.run(() => {
    try {
      player.runCommand(`give @s ${ITEM_ID} 1`);
      player.sendMessage(
        "§a[Cheat Menu] §7You received a §bCheat Feather§7. Use it to open the menu!"
      );
    } catch (e) {
      // Inventory full or command failed — player can use !feather instead.
    }
  });
});

// Chat shortcut: type "!feather" (or "!cheat") to get another Cheat Feather.
world.beforeEvents.chatSend.subscribe((ev) => {
  const msg = ev.message.trim().toLowerCase();
  if (msg === "!feather" || msg === "!cheat") {
    ev.cancel = true;
    const player = ev.sender;
    system.run(() => {
      try {
        player.runCommand(`give @s ${ITEM_ID} 1`);
        player.sendMessage("§a[Cheat Menu] §7Here's your §bCheat Feather§7!");
      } catch (e) {}
    });
  }
});
