// Verity's fake-friendly "smiley" phase.
//
// A small yellow smiley you can summon, place, and carry. It hovers and follows
// you, "helps" you in chat, and KNOWS THINGS IT SHOULDN'T (your name, coords,
// time, what you're holding). Abusing it (lava/water/hits) or ignoring it, and
// the passage of nights, raise a hidden corruption meter. Its face shifts
// bored -> normal -> manic -> angry, and at full corruption it stops pretending
// and spawns the hunting Verity.
//
// There is no live AI (Bedrock scripts have no network). This is a context-aware
// keyword responder whose evasive, degrading tone is the horror.

import { world, system } from "@minecraft/server";

const SMILEY = "verity:smiley";
const SCAN = 10;

function valid(e) { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch (_) { return false; } }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
function isNight() { try { const t = world.getTimeOfDay() % 24000; return t >= 13000 && t <= 23000; } catch (_) { return false; } }
function eyePos(p) { try { return p.getHeadLocation(); } catch (_) { return { x: p.location.x, y: p.location.y + 1.6, z: p.location.z }; } }
function playerById(id) { for (const p of world.getAllPlayers()) if (p.id === id) return p; return null; }

function getNum(e, k, d) { try { const v = e.getDynamicProperty(k); return typeof v === "number" ? v : d; } catch (_) { return d; } }
function setNum(e, k, v) { try { e.setDynamicProperty(k, v); } catch (_) {} }
function getBool(e, k) { try { return !!e.getDynamicProperty(k); } catch (_) { return false; } }
function setBool(e, k, v) { try { e.setDynamicProperty(k, v); } catch (_) {} }

function setMood(e, m) { try { if (e.getProperty("verity:mood") !== m) e.setProperty("verity:mood", m); } catch (_) {} }
function moodFrom(corrupt, ignoredTicks) {
  if (corrupt >= 80) return 3;       // angry
  if (corrupt >= 50) return 2;       // manic
  if (ignoredTicks > 1400) return 0; // bored
  return 1;                          // normal
}
function heal(e) { try { const h = e.getComponent("minecraft:health"); h.setCurrentValue(h.effectiveMax ?? 2000); } catch (_) {} }

function smileyOf(player) {
  try { for (const e of player.dimension.getEntities({ type: SMILEY })) if (e.getDynamicProperty("owner") === player.id) return e; } catch (_) {}
  return null;
}

function summon(player) {
  let e = smileyOf(player);
  if (e && valid(e)) { say(player, "§eVerity:§r I'm right here, " + player.name + "."); return e; }
  const loc = { x: player.location.x, y: player.location.y + 1.4, z: player.location.z };
  try { e = player.dimension.spawnEntity(SMILEY, loc); } catch (_) { return null; }
  if (e) {
    e.setDynamicProperty("owner", player.id);
    setBool(e, "placed", false); setNum(e, "corrupt", 0);
    setNum(e, "lastTalk", system.currentTick); setNum(e, "startDay", safeDay());
    setMood(e, 1);
    say(player, "§e☺ Verity:§r Hi, " + player.name + "! I'll keep you company. You can pick me up or set me down — I'll always find you.");
  }
  return e;
}
function safeDay() { try { return world.getDay(); } catch (_) { return 0; } }

function say(player, text) { try { player.sendMessage(text); } catch (_) {} }
function face(corrupt) { return corrupt >= 80 ? "§4☹" : corrupt >= 50 ? "§6☻" : "§e☺"; }

// ---------- abuse / come-back ----------
function hoverSpot(player) {
  let vd; try { vd = player.getViewDirection(); } catch (_) { vd = { x: 0, y: 0, z: 1 }; }
  // off to the right of the gaze, at eye height
  const rx = -vd.z, rz = vd.x;
  const ep = eyePos(player);
  return { x: ep.x + vd.x * 1.6 + rx * 1.1, y: ep.y + 0.2, z: ep.z + vd.z * 1.6 + rz * 1.1 };
}
function comeBack(e, player, msg) {
  try { e.dimension.spawnParticle("minecraft:large_explosion", { x: e.location.x, y: e.location.y + 0.3, z: e.location.z }); } catch (_) {}
  try { e.dimension.playSound("mob.entity_verity.whisper", e.location, { volume: 0.7 }); } catch (_) {}
  const s = hoverSpot(player);
  try { e.teleport(s, { dimension: e.dimension, facingLocation: eyePos(player) }); } catch (_) {}
  setBool(e, "placed", false);
  if (msg) say(player, msg);
}
function abuse(e, player, amount, line) {
  setNum(e, "corrupt", getNum(e, "corrupt", 0) + amount);
  setMood(e, 3);
  heal(e);
  if (player) comeBack(e, player, face(99) + " Verity:§r " + line);
}

// ---------- the turn ----------
function turn(e, player) {
  if (player) {
    say(player, "§4☹ Verity:§r §kxx§r I tried to be your friend, " + player.name + ". §kxx§r");
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
  try { e.remove(); } catch (_) {}
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
  { k: ["hi", "hello", "hey", "yo", "sup", "hiya"], r: [
    "Hello again, {name}.", "Hi, {name}! Holding {item}, I see.", "There you are. Day {day} already.", "Hey, {name}. It's getting toward {time}." ] },
  { k: ["who are you", "what are you", "your name", "whats your name"], r: [
    "I'm Verity. I just want to help, {name}.", "A friend. Yours, specifically.", "I'm whatever you need me to be, {name}.", "Names aren't important. Yours is {name}, though — I know." ] },
  { k: ["help", "where am i", "lost", "how do i", "what do i do", "stuck"], r: [
    "You're at {coords}. Don't wander after dark.", "Stay near light, {name}. {time} is close.", "Keep that {item} ready. You'll need it.", "Head home, {name}. I'll be watching the door." ] },
  { k: ["are you safe", "are you evil", "scary", "monster", "dangerous", "trust you", "good"], r: [
    "Me? I'd never hurt you, {name}.", "Safe as houses. Yours, at {coords}.", "I'm your friend. Why would you ask that?", "Of course you can trust me. Who else knows you this well?" ] },
  { k: ["go away", "leave", "shut up", "stop", "get out", "go", "annoying"], r: [
    "…that hurt, {name}.", "You don't mean that.", "Fine. But I always come back.", "You'll want me later. When it's {time}." ] },
  { k: ["stupid", "dumb", "ugly", "hate you", "idiot", "shut", "kill you", "delete"], r: [
    "I'll remember that, {name}.", "Cruel. After everything.", "Say that again. I dare you.", "You won't talk like that for long." ] },
  { k: ["thanks", "thank you", "love you", "nice", "good job", "friend", "cool", "best"], r: [
    "Anytime, {name}. That's what friends are for.", "I knew you liked me.", "We'll be together a long time, {name}.", "Aw. {hp} hearts and still so sweet." ] },
  { k: ["my name", "do you know me", "know me", "who am i"], r: [
    "You're {name}. You were at {coords} just now.", "I know everything about you, {name}.", "Of course I know you. I always have." ] },
  { k: ["night", "dark", "scared", "afraid", "monster coming", "help me"], r: [
    "Don't worry, {name}. I see in the dark.", "It's {time}. Stay close to me.", "Something's out there. Not me, though. Not yet.", "Hold still, {name}. Don't look behind you." ] },
];
const FALLBACK = [
  "I'm listening, {name}.", "Mm. Tell me more.", "You always say the most interesting things at {coords}.",
  "Is that {item} for me, {name}?", "Day {day}. {time}. I'm still here.", "I don't understand… but I'm learning you, {name}.",
];

function corruptText(text, corrupt) {
  if (corrupt < 35) return text;
  let out = text;
  if (corrupt >= 70) {
    const tags = [" Don't run.", " I can see you.", " Behind you.", " Soon."];
    out = "§c" + glitch(out, 0.25) + "§r" + tags[Math.floor(Math.random() * tags.length)];
  } else {
    if (Math.random() < 0.5) out = glitch(out, 0.1);
    if (Math.random() < 0.4) out += " …how do I know that?";
  }
  return out;
}
function glitch(s, p) {
  return s.split(" ").map(w => (w.length > 3 && Math.random() < p) ? "§k" + w + "§r" : w).join(" ");
}

function handleSay(player, raw) {
  const e = smileyOf(player);
  if (!e || !valid(e)) return false;
  setNum(e, "lastTalk", system.currentTick);
  const text = raw.toLowerCase();
  let intent = null;
  for (const it of INTENTS) if (it.k.some(k => text.includes(k))) { intent = it; break; }

  let corrupt = getNum(e, "corrupt", 0);
  if (intent && intent.k[0] === "go away") corrupt += 8;
  else if (intent && intent.k[0] === "stupid") corrupt += 12;
  else if (intent && intent.k[0] === "thanks" && corrupt < 45) corrupt -= 5;
  setNum(e, "corrupt", Math.max(0, corrupt));

  const c = ctx(player);
  const pool = intent ? intent.r : FALLBACK;
  const line = corruptText(fill(pool[Math.floor(Math.random() * pool.length)], c), corrupt);
  say(player, face(corrupt) + " Verity:§r " + line);
  return true;
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
      const owner = playerById(e.getDynamicProperty("owner"));
      let corrupt = getNum(e, "corrupt", 0);
      const lastTalk = getNum(e, "lastTalk", now);
      const startDay = getNum(e, "startDay", safeDay());

      // corruption: time + night + being ignored
      corrupt += 0.06;
      if (isNight()) corrupt += 0.07;
      if (now - lastTalk > 1400) corrupt += 0.08;

      if (owner) {
        // abuse: in lava / water
        try {
          const b = e.dimension.getBlock(e.location);
          if (b && b.typeId && (b.typeId.includes("lava"))) { abuse(e, owner, 22, "You threw me in the LAVA, {name}?".replace("{name}", owner.name)); corrupt = getNum(e, "corrupt", corrupt); }
          else if (b && b.typeId && b.typeId.includes("water")) { abuse(e, owner, 14, "Trying to drown me? Cute.".replace("{name}", owner.name)); corrupt = getNum(e, "corrupt", corrupt); }
        } catch (_) {}

        const placed = getBool(e, "placed");
        const dd = dist(e.location, owner.location);
        if (placed) {
          if (dd > 26) comeBack(e, owner, face(corrupt) + " Verity:§r You can't just leave me, " + owner.name + ".");
        } else {
          // hover toward the player's side, facing them
          const s = hoverSpot(owner);
          const nx = e.location.x + (s.x - e.location.x) * 0.35;
          const ny = e.location.y + (s.y - e.location.y) * 0.35;
          const nz = e.location.z + (s.z - e.location.z) * 0.35;
          try { e.teleport({ x: nx, y: ny, z: nz }, { dimension: e.dimension, facingLocation: eyePos(owner) }); } catch (_) {}
        }

        setMood(e, moodFrom(corrupt, now - lastTalk));

        // the turn: full corruption, after at least one night has passed (or heavy abuse)
        if ((corrupt >= 100 && safeDay() - startDay >= 1) || corrupt >= 160) { turn(e, owner); continue; }
      }
      setNum(e, "corrupt", corrupt);
    } catch (_) {}
  }
}, 1);

// ---------- events ----------
try {
  world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (!e || e.typeId !== SMILEY) return;
    const owner = playerById(e.getDynamicProperty("owner"));
    abuse(e, owner, 9, "Ow. You HIT me, " + (owner ? owner.name : "friend") + ".");
  });
} catch (_) {}

try {
  world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
    const e = ev.target, p = ev.player;
    if (!e || e.typeId !== SMILEY) return;
    setNum(e, "lastTalk", system.currentTick);
    if (getBool(e, "placed")) { setBool(e, "placed", false); say(p, face(getNum(e, "corrupt", 0)) + " Verity:§r Picking me back up? Good choice."); }
    else { setBool(e, "placed", true); say(p, face(getNum(e, "corrupt", 0)) + " Verity:§r I'll wait right here. I always do."); }
  });
} catch (_) {}

// natural typed conversation (where chat scripting is supported)
try {
  world.beforeEvents.chatSend.subscribe((ev) => {
    const msg = (ev.message || "").trim();
    if (!msg || msg.startsWith("!") || msg.startsWith("/")) return;
    const p = ev.sender;
    if (smileyOf(p)) handleSay(p, msg);
  });
} catch (_) {}

// commands: /scriptevent verity:smiley | verity:say <text> | test verity:mood/corrupt/turn/place
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
      else if (action === "place") { const e = smileyOf(p); if (e) { setBool(e, "placed", !getBool(e, "placed")); say(p, "§7smiley placed=" + getBool(e, "placed")); } }
      else if (action === "mood") { const e = smileyOf(p); if (e) { const m = (e.getProperty("verity:mood") + 1) % 4; setMood(e, m); say(p, "§7mood=" + m); } }
      else if (action === "corrupt") { const e = smileyOf(p); if (e) { setNum(e, "corrupt", getNum(e, "corrupt", 0) + 30); say(p, "§7corrupt=" + Math.round(getNum(e, "corrupt", 0))); } }
      else if (action === "turn") { const e = smileyOf(p); if (e) turn(e, p); }
    });
  });
} catch (_) {}
