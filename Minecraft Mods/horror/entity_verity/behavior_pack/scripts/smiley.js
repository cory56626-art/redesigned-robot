// Verity's fake-friendly "smiley" phase.
//
// On first join, a smiley ball spawns in front of you and introduces itself.
// It STAYS PUT in the world; PICK IT UP (interact) and it goes into your
// INVENTORY as an orb; USE the orb to set it back down. Leave it placed and
// walk off and it teleports back. It chats, and knows things it shouldn't.
// Abuse / neglect / nights raise a hidden corruption meter (face: bored ->
// normal -> manic -> angry). When it snaps it warns "Something is coming in 3
// days"; on the third night the ball is gone and the hunting Verity spawns.
//
// Talking: type in chat (needs the world's "Beta APIs" experiment, since the
// chatSend event is experimental) OR /scriptevent verity:say <message>.

import { world, system, ItemStack } from "@minecraft/server";

const SMILEY = "verity:smiley";
const ORB = "verity:smiley_orb";
const SCAN = 10;
const LEAVE_DIST = 24;

const S = new Map();      // entity id -> state
const placeCd = new Map(); // player id -> tick (debounce orb use)

function valid(e) { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (_) { return false; } }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
function isNight() { try { const t = world.getTimeOfDay() % 24000; return t >= 13000 && t <= 23000; } catch (_) { return false; } }
function safeDay() { try { return world.getDay(); } catch (_) { return 0; } }
function eyePos(p) { try { return p.getHeadLocation(); } catch (_) { return { x: p.location.x, y: p.location.y + 1.6, z: p.location.z }; } }
function playerById(id) { if (!id) return null; for (const p of world.getAllPlayers()) if (p.id === id) return p; return null; }
function say(p, t) { try { p.sendMessage(t); } catch (_) {} }
function face(c) { return c >= 80 ? "§4☹" : c >= 50 ? "§6☻" : "§e☺"; }
function setMood(e, m) { try { if (e.getProperty("verity:mood") !== m) e.setProperty("verity:mood", m); } catch (_) {} }
function moodFrom(c, ignored) { if (c >= 80) return 3; if (c >= 50) return 2; if (ignored > 1400) return 0; return 1; }
function heal(e) { try { const h = e.getComponent("minecraft:health"); h.setCurrentValue(h.effectiveMax ?? 2000); } catch (_) {} }

function st(e) {
  let s = S.get(e.id);
  if (!s) {
    let owner = null;
    try { for (const t of e.getTags()) if (t.startsWith("vo:")) { owner = t.slice(3); break; } } catch (_) {}
    s = { ownerId: owner, corrupt: 0, lastTalk: system.currentTick, startDay: safeDay(), doomDay: -1, lastAnn: -1 };
    S.set(e.id, s);
  }
  return s;
}
function smileyOf(player) {
  try { for (const e of player.dimension.getEntities({ type: SMILEY })) if (st(e).ownerId === player.id) return e; } catch (_) {}
  return null;
}
function nearestSmiley(player, range) {
  let best = null, bd = range * range;
  try { for (const e of player.dimension.getEntities({ type: SMILEY })) { const dd = dist(e.location, player.location); if (dd * dd < bd) { bd = dd * dd; best = e; } } } catch (_) {}
  return best;
}

function spawnInFront(p) {
  let vd; try { vd = p.getViewDirection(); } catch (_) { vd = { x: 0, y: 0, z: 1 }; }
  const loc = { x: p.location.x + vd.x * 2, y: p.location.y + 0.5, z: p.location.z + vd.z * 2 };
  let e; try { e = p.dimension.spawnEntity(SMILEY, loc); } catch (_) { return null; }
  if (e) {
    try { e.addTag("vo:" + p.id); } catch (_) {}
    const s = st(e);
    s.ownerId = p.id; s.corrupt = 0; s.startDay = safeDay(); s.lastTalk = system.currentTick; s.doomDay = -1; s.lastAnn = -1;
    setMood(e, 1);
    try { e.teleport(loc, { dimension: p.dimension, facingLocation: eyePos(p) }); } catch (_) {}
  }
  return e;
}

function behindSpot(player) {
  let vd; try { vd = player.getViewDirection(); } catch (_) { vd = { x: 0, y: 0, z: 1 }; }
  return { x: player.location.x - vd.x * 2, y: player.location.y + 0.5, z: player.location.z - vd.z * 2 };
}
function reappear(e, player, msg) {
  try { e.dimension.spawnParticle("minecraft:large_explosion", { x: e.location.x, y: e.location.y + 0.3, z: e.location.z }); } catch (_) {}
  try { e.dimension.playSound("mob.entity_verity.whisper", e.location, { volume: 0.7 }); } catch (_) {}
  try { e.teleport(behindSpot(player), { dimension: e.dimension, facingLocation: eyePos(player) }); } catch (_) {}
  if (msg) say(player, msg);
}
function abuse(e, player, amount, line) {
  const s = st(e); s.corrupt += amount; setMood(e, 3); heal(e);
  if (player) reappear(e, player, face(99) + " Verity:§r " + line);
}

// ---------- inventory pickup / placement ----------
function giveOrb(p, e) {
  try { p.getComponent("minecraft:inventory").container.addItem(new ItemStack(ORB, 1)); } catch (_) {}
  say(p, "§e☺ Verity:§r Into your pocket I go. Don't lose me.");
  try { e.remove(); } catch (_) {} S.delete(e.id);
}
function placeOrb(p) {
  if (system.currentTick - (placeCd.get(p.id) ?? -100) < 5) return;
  placeCd.set(p.id, system.currentTick);
  try {
    const inv = p.getComponent("minecraft:inventory").container;
    const slot = p.selectedSlotIndex, it = inv.getItem(slot);
    if (it && it.typeId === ORB) { if (it.amount > 1) { it.amount -= 1; inv.setItem(slot, it); } else inv.setItem(slot, undefined); }
  } catch (_) {}
  spawnInFront(p);
}

// ---------- intro / summon ----------
const INTRO = "§e☺ Verity:§r Hello! I'm Verity, your personal helper friend. Ask me anything. I know everything.";
function intro(p) {
  try { if (p.hasTag("verity_intro")) return; p.addTag("verity_intro"); } catch (_) {}
  if (smileyOf(p)) return;
  if (spawnInFront(p)) say(p, INTRO);
}
function summon(player) {
  let e = smileyOf(player);
  if (e && valid(e)) { say(player, "§e☺ Verity:§r I'm right here."); return e; }
  e = spawnInFront(player);
  if (e) say(player, INTRO);
  return e;
}

// ---------- the turn (3-day countdown) ----------
function armDoom(e, player) {
  const s = st(e); s.doomDay = safeDay() + 3; s.lastAnn = safeDay(); setMood(e, 3);
  if (player) say(player, "§4☹ Verity:§r §kxx§r Something is coming in 3 days. §kxx§r");
}
function doomTick(e, player) {
  const s = st(e); if (s.doomDay < 0) return;
  const today = safeDay(), rem = s.doomDay - today;
  if (today !== s.lastAnn && rem > 0) {
    s.lastAnn = today;
    if (player) say(player, "§4☹ Verity:§r §kx§r Something is coming in " + rem + (rem === 1 ? " day." : " days.") + " §kx§r");
  }
  if (today >= s.doomDay && isNight()) turn(e, player);
}
function turn(e, player) {
  if (player) {
    try {
      const dim = e.dimension;
      dim.spawnParticle("minecraft:large_explosion", { x: e.location.x, y: e.location.y, z: e.location.z });
      dim.playSound("mob.entity_verity.scream", player.location, { volume: 1.0 });
      const ang = Math.random() * Math.PI * 2;
      const loc = { x: player.location.x + Math.cos(ang) * 10, y: player.location.y + 1, z: player.location.z + Math.sin(ang) * 10 };
      const v = dim.spawnEntity("verity:entity_verity", loc);
      if (v) { try { v.triggerEvent("verity:begin_hunt"); } catch (_) {} }
    } catch (_) {}
  }
  try { e.remove(); } catch (_) {} S.delete(e.id);
}

// ---------- conversation ----------
function ctx(player) {
  const c = { name: player.name, day: safeDay() };
  try { const l = player.location; c.coords = `${Math.floor(l.x)}, ${Math.floor(l.y)}, ${Math.floor(l.z)}`; } catch (_) { c.coords = "somewhere"; }
  c.time = isNight() ? "night" : "day";
  try { c.hp = Math.max(0, Math.round(player.getComponent("minecraft:health").currentValue / 2)); } catch (_) { c.hp = "?"; }
  try {
    const inv = player.getComponent("minecraft:inventory").container;
    const it = inv.getItem(player.selectedSlotIndex);
    c.item = it ? it.typeId.replace("minecraft:", "").replace(/_/g, " ") : "nothing";
  } catch (_) { c.item = "nothing"; }
  return c;
}
function fill(s, c) { return s.replace(/{name}/g, c.name).replace(/{coords}/g, c.coords).replace(/{time}/g, c.time).replace(/{hp}/g, c.hp).replace(/{item}/g, c.item).replace(/{day}/g, c.day); }

const INTENTS = [
  { k: ["hi", "hello", "hey", "yo", "sup", "hiya", "howdy"], r: ["Hello again.", "Hi! Holding {item}, I see.", "There you are. Day {day} already.", "Hey. It's getting toward {time}."] },
  { k: ["who are you", "what are you", "your name", "whats your name", "what's your name"], r: ["I'm Verity. I just want to help.", "A friend. Yours, specifically.", "I'm whatever you need me to be.", "Names aren't important. Yours is {name}, though — I know."] },
  { k: ["help", "where am i", "lost", "how do i", "what do i do", "stuck"], r: ["You're at {coords}. Don't wander after dark.", "Stay near light. {time} is close.", "Keep that {item} ready. You'll need it.", "Head home. I'll be watching the door."] },
  { k: ["are you safe", "are you evil", "scary", "monster", "dangerous", "trust you", "good"], r: ["Me? I'd never hurt you.", "Safe as houses. Yours, at {coords}.", "I'm your friend. Why would you ask that?", "Of course you can trust me. Who else knows you this well?"] },
  { k: ["go away", "leave me", "shut up", "stop", "get out", "go home", "annoying"], r: ["…that hurt.", "You don't mean that.", "Fine. But I always come back.", "You'll want me later. When it's {time}."] },
  { k: ["stupid", "dumb", "ugly", "hate you", "idiot", "kill you", "delete you", "shut"], r: ["I'll remember that.", "Cruel. After everything.", "Say that again. I dare you.", "You won't talk like that for long."] },
  { k: ["thanks", "thank you", "love you", "nice", "good job", "friend", "cool", "best"], r: ["Anytime. That's what friends are for.", "I knew you liked me.", "We'll be together a long time.", "Aw. {hp} hearts and still so sweet."] },
  { k: ["my name", "do you know me", "know me", "who am i"], r: ["You're {name}. You were at {coords} just now.", "I know everything about you.", "Of course I know you. I always have."] },
  { k: ["night", "dark", "scared", "afraid", "coming", "help me"], r: ["Don't worry. I see in the dark.", "It's {time}. Stay close to me.", "Something's out there. Not me, though. Not yet.", "Hold still. Don't look behind you."] },
  { k: ["how are you", "you ok", "you okay", "whats up", "what's up"], r: ["Better, now that you're here.", "Watching. Always watching.", "I'm fine. Are you? {hp} hearts.", "Bored. Talk to me more."] },
  { k: ["everything", "know", "secret", "tell me"], r: ["Everything. I told you.", "Ask me. I dare you.", "I know what's under your house, {name}.", "I know how this ends. You don't."] },
];
const FALLBACK = ["I'm listening.", "Mm. Tell me more.", "You always say the most interesting things at {coords}.", "Is that {item} for me?", "Day {day}. {time}. I'm still here.", "I don't understand… but I'm learning you."];

function corruptText(text, corrupt) {
  if (corrupt < 35) return text;
  if (corrupt >= 70) {
    const tags = [" Don't run.", " I can see you.", " Behind you.", " Soon."];
    return "§c" + glitch(text, 0.25) + "§r" + tags[Math.floor(Math.random() * tags.length)];
  }
  let out = text;
  if (Math.random() < 0.5) out = glitch(out, 0.1);
  if (Math.random() < 0.4) out += " …how do I know that?";
  return out;
}
function glitch(s, p) { return s.split(" ").map(w => (w.length > 3 && Math.random() < p) ? "§k" + w + "§r" : w).join(" "); }

function handleSay(player, raw) {
  let e = smileyOf(player);
  if (!e || !valid(e)) e = nearestSmiley(player, 48);
  if (!e || !valid(e)) { say(player, "§7(no smiley nearby — /scriptevent verity:smiley to summon one)"); return; }
  const s = st(e);
  if (!s.ownerId) { s.ownerId = player.id; try { e.addTag("vo:" + player.id); } catch (_) {} }
  s.lastTalk = system.currentTick;
  const text = (raw || "").toLowerCase();
  let intent = null;
  for (const it of INTENTS) if (it.k.some(k => text.includes(k))) { intent = it; break; }
  if (intent && intent.k[0] === "go away") s.corrupt += 8;
  else if (intent && intent.k[0] === "stupid") s.corrupt += 12;
  else if (intent && intent.k[0] === "thanks" && s.corrupt < 45) s.corrupt = Math.max(0, s.corrupt - 5);
  const c = ctx(player);
  const pool = intent ? intent.r : FALLBACK;
  const line = corruptText(fill(pool[Math.floor(Math.random() * pool.length)], c), s.corrupt);
  say(player, face(s.corrupt) + " Verity:§r " + line);
}

// ---------- per-tick management ----------
let tk = 0;
system.runInterval(() => {
  tk++;
  if (tk % SCAN !== 0) return;
  const now = system.currentTick;
  let list = [];
  for (const d of ["overworld", "nether", "the_end"]) { try { list = list.concat(world.getDimension(d).getEntities({ type: SMILEY })); } catch (_) {} }

  for (const e of list) {
    try {
      if (!valid(e)) continue;
      const s = st(e);
      let owner = playerById(s.ownerId);
      if (!owner) {
        let best = null, bd = 32 * 32;
        for (const p of world.getAllPlayers()) { if (p.dimension.id !== e.dimension.id) continue; const dd = dist(p.location, e.location); if (dd * dd < bd) { bd = dd * dd; best = p; } }
        if (best) { s.ownerId = best.id; try { e.addTag("vo:" + best.id); } catch (_) {} owner = best; }
      }

      s.corrupt += 0.06;
      if (isNight()) s.corrupt += 0.07;
      if (now - s.lastTalk > 1400) s.corrupt += 0.08;

      if (owner) {
        try {
          const b = e.dimension.getBlock(e.location);
          if (b && b.typeId && b.typeId.includes("lava")) abuse(e, owner, 22, "You threw me in the LAVA?");
          else if (b && b.typeId && b.typeId.includes("water")) abuse(e, owner, 14, "Trying to drown me? Cute.");
        } catch (_) {}

        // it stays where placed; only reappears if you wander off
        if (owner.dimension.id !== e.dimension.id || dist(e.location, owner.location) > LEAVE_DIST) {
          reappear(e, owner, face(s.corrupt) + " Verity:§r You can't just leave me.");
        }

        setMood(e, moodFrom(s.corrupt, now - s.lastTalk));
        if (s.doomDay < 0 && s.corrupt >= 100) armDoom(e, owner);
        doomTick(e, owner);
      }
    } catch (_) {}
  }
}, 1);

// ---------- events ----------
try {
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (!ev.initialSpawn || !ev.player) return;
    const p = ev.player;
    system.runTimeout(() => { try { intro(p); } catch (_) {} }, 20);
  });
} catch (_) {}

try {
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (!e || e.typeId !== SMILEY) return;
    abuse(e, playerById(st(e).ownerId), 9, "Ow. You HIT me.");
  });
} catch (_) {}

// pick up -> goes into your inventory
try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const e = ev.target, p = ev.player;
    if (!e || e.typeId !== SMILEY) return;
    system.run(() => { try { giveOrb(p, e); } catch (_) {} });
  });
} catch (_) {}

// use the orb -> sets it back down in front of you
try {
  world.afterEvents.itemUse.subscribe((ev) => {
    const it = ev.itemStack, p = ev.source;
    if (!it || it.typeId !== ORB || !p || p.typeId !== "minecraft:player") return;
    system.run(() => { try { placeOrb(p); } catch (_) {} });
  });
} catch (_) {}
try {
  world.afterEvents.itemUseOn.subscribe((ev) => {
    const it = ev.itemStack, p = ev.source;
    if (!it || it.typeId !== ORB || !p || p.typeId !== "minecraft:player") return;
    system.run(() => { try { placeOrb(p); } catch (_) {} });
  });
} catch (_) {}

// natural chat (needs the world's Beta APIs experiment) — replies to nearest smiley
try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = (ev.message || "").trim();
    if (!msg || msg.startsWith("!") || msg.startsWith("/")) return;
    const p = ev.sender;
    system.run(() => { try { if (nearestSmiley(p, 64)) handleSay(p, msg); } catch (_) {} });
  });
} catch (_) {}

// stable commands / fallbacks
try {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    const id = ev.id || "";
    if (!id.startsWith("verity:")) return;
    const action = id.slice(7);
    let p = ev.sourceEntity;
    if (!p || p.typeId !== "minecraft:player") p = world.getAllPlayers()[0];
    if (!p) return;
    system.run(() => {
      if (action === "smiley") summon(p);
      else if (action === "say") handleSay(p, ev.message || "");
      else if (action === "mood") { const e = smileyOf(p) || nearestSmiley(p, 48); if (e) { const m = (e.getProperty("verity:mood") + 1) % 4; setMood(e, m); say(p, "§7mood=" + m); } }
      else if (action === "corrupt") { const e = smileyOf(p) || nearestSmiley(p, 48); if (e) { st(e).corrupt += 30; say(p, "§7corrupt=" + Math.round(st(e).corrupt)); } }
      else if (action === "doom") { const e = smileyOf(p) || nearestSmiley(p, 48); if (e) armDoom(e, p); }
      else if (action === "turn") { const e = smileyOf(p) || nearestSmiley(p, 48); if (e) turn(e, p); }
    });
  });
} catch (_) {}
