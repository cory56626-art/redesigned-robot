// Summoner Realms — state synchronization & message handling (host-authoritative).
import { MSG } from './protocol.js?v=prehardmode-mech-1';
import { NET_SNAPSHOT_HZ, NET_INPUT_HZ, TILE } from '../config.js?v=prehardmode-mech-1';
import { Player, assignColor } from '../entities/player.js?v=prehardmode-mech-1';
import { Projectile } from '../entities/projectile.js?v=prehardmode-mech-1';
import { ThrownItem } from '../entities/thrown.js?v=prehardmode-mech-1';
import { ITEMS, isItemEnabled } from '../data/items.js?v=prehardmode-mech-1';
import { ENEMIES } from '../data/enemies.js?v=prehardmode-mech-1';
import { BOSSES } from '../data/bosses.js?v=prehardmode-mech-1';

const asArray = (value) => Array.isArray(value) ? value : [];

// ---------- Welcome (host builds, client applies) ----------
export function buildWelcome(game, forId) {
  return {
    t: MSG.WELCOME,
    id: forId,
    hostId: game.net.hostId,
    seed: game.world.seed,
    name: game.worldName,
    difficulty: game.difficulty,
    diffs: game.world.getDiffArray(),
    wallDiffs: game.world.getWallDiffArray(),
    shapeDiffs: game.world.getShapeDiffArray(),
    liquidDiffs: game.world.liquid ? game.world.liquid.getDiffArray() : [],
    weather: game.weather ? game.weather.serialize() : null,
    time: game.time.t,
    day: game.time.day,
    progression: game.progression.serialize(),
    players: [...game.players.values()].map(p => p.netState()),
    enemies: game.enemies.map(e => e.netState()),
    bosses: game.bosses.map(b => b.netState()),
    drops: game.drops.map(d => d.netState()),
  };
}

export function applyWelcome(game, msg) {
  if (!msg || typeof msg !== 'object') return;
  game.selfId = msg.id;
  game.net.hostId = msg.hostId;
  game.startClientWorld({
    seed: msg.seed,
    name: msg.name,
    diffs: asArray(msg.diffs),
    wallDiffs: asArray(msg.wallDiffs),
    shapeDiffs: asArray(msg.shapeDiffs),
    liquidDiffs: asArray(msg.liquidDiffs),
    weather: msg.weather || null,
    time: msg.time,
    day: msg.day || 1,
    progression: msg.progression || {},
    difficulty: msg.difficulty,
  });
  // Remote players (everyone except us).
  const players = asArray(msg.players);
  for (const ps of players) {
    if (!ps || ps.id == null || ps.id === msg.id) continue;
    const rp = new Player(ps.id, { name: ps.name, color: ps.color, isLocal: false });
    rp.applyNetState(ps); rp.x = ps.x; rp.y = ps.y;
    game.players.set(ps.id, rp);
  }
  applyEntitySnapshot(game, msg);
  game.ui.menus.refreshPlayerList();
}

// ---------- Snapshot ----------
export function buildSnapshot(game) {
  return {
    t: MSG.SNAPSHOT,
    time: game.time.t,
    day: game.time.day,
    players: [...game.players.values()].map(p => {
      const s = p.netState();
      if (p.isLocal) s.mins = game.minions.filter(m => m.ownerId === p.id).map(m => m.netInfo());
      else if (p.remoteMinions) s.mins = p.remoteMinions;
      return s;
    }),
    enemies: game.enemies.map(e => e.netState()),
    bosses: game.bosses.map(b => b.netState()),
    drops: game.drops.map(d => d.netState()),
  };
}

export function applySnapshot(game, msg) {
  if (!msg || typeof msg !== 'object' || !game.time) return;
  const time = Number(msg.time);
  if (Number.isFinite(time)) game.time.t = time;
  const day = Number(msg.day);
  if (Number.isFinite(day)) game.time.day = Math.max(1, Math.floor(day));
  // Players
  const players = asArray(msg.players);
  const seen = new Set();
  for (const ps of players) {
    if (!ps || ps.id == null) continue;
    seen.add(ps.id);
    if (ps.id === game.selfId) continue; // don't override our own sim
    let rp = game.players.get(ps.id);
    if (!rp) {
      rp = new Player(ps.id, { name: ps.name, color: ps.color, isLocal: false });
      rp.x = ps.x; rp.y = ps.y;
      game.players.set(ps.id, rp);
      game.ui.menus.refreshPlayerList();
    }
    rp.applyNetState(ps);
    rp.remoteMinions = asArray(ps.mins);
  }
  // Remove remote players who left (not in this snapshot).
  let removed = false;
  for (const id of [...game.players.keys()]) {
    if (id === game.selfId) continue;
    if (!seen.has(id)) { game.players.delete(id); removed = true; }
  }
  if (removed) game.ui.menus.refreshPlayerList();
  applyEntitySnapshot(game, msg);
}

function applyEntitySnapshot(game, msg) {
  const enemies = asArray(msg && msg.enemies);
  const bosses = asArray(msg && msg.bosses);
  const drops = asArray(msg && msg.drops);

  // Enemies (ghosts on client).
  const eSeen = new Set();
  for (const es of enemies) {
    if (!es || es.netId == null || !ENEMIES[es.key]) continue;
    eSeen.add(es.netId);
    let e = game.enemyById.get(es.netId);
    if (!e) {
      e = makeGhostEnemy(es);
      if (!e) continue;
      game.enemyById.set(es.netId, e);
      game.enemies.push(e);
    }
    e._tx = es.x; e._ty = es.y; e.hp = es.hp; e.facing = es.facing;
    if (es.f) e.hurtFlash = 0.1;
  }
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    if (!eSeen.has(e.netId)) {
      game.enemies.splice(i, 1);
      game.enemyById.delete(e.netId);
    }
  }

  // Bosses. Ignore an unknown boss definition instead of crashing the client's
  // frame loop on a stale or malformed packet.
  const newBosses = [];
  for (const bs of bosses) {
    const def = bs && BOSSES[bs.key];
    if (!def) continue;
    let b = game.bosses.find(x => x.key === bs.key);
    if (!b) b = makeGhostBoss(bs);
    if (!b) continue;
    b._tx = bs.x; b._ty = bs.y; b.hp = bs.hp; b.maxHp = bs.maxHp; b.facing = bs.facing;
    const phases = Array.isArray(def.phases) ? def.phases : [];
    const phaseNumber = Number(bs.phase);
    const phaseIndex = Number.isInteger(phaseNumber) && phaseNumber >= 0 ? phaseNumber : 0;
    b.phaseName = (phases[phaseIndex] || phases[0] || {}).name || '';
    if (b.ghost) {
      b.hidden = !!bs.hidden;
      b.aiState = bs.state || '';
      // Replicate the wind-up so clients see the same tell the host does.
      b.telegraph = bs.tel ? b.telegraphMax : 0;
      // The chassis itself is intentionally stable during Plasma Ray, but its
      // cannon needs the host's angle so remote players see the same sweep.
      b.mechRay = bs.mr ? { angle: Number(bs.mr.a) || 0, time: Number(bs.mr.t) || 0 } : null;
      b.mechHeat = phaseIndex > 0 ? 1 : 0;
    }
    newBosses.push(b);
  }
  game.bosses = newBosses;

  // Drops
  const dSeen = new Set();
  for (const ds of drops) {
    if (!ds || ds.netId == null || !isItemEnabled(ds.itemId)) continue;
    dSeen.add(ds.netId);
    let d = game.dropById.get(ds.netId);
    if (!d) {
      d = {
        netId: ds.netId, itemId: ds.itemId, count: ds.count,
        x: ds.x, y: ds.y, w: 10, h: 10, bob: Math.random() * 6, ghost: true
      };
      game.dropById.set(ds.netId, d);
      game.drops.push(d);
    }
    d.x = ds.x; d.y = ds.y;
  }
  for (let i = game.drops.length - 1; i >= 0; i--) {
    const d = game.drops[i];
    if (d.ghost && !dSeen.has(d.netId)) {
      game.drops.splice(i, 1);
      game.dropById.delete(d.netId);
    }
  }
}

function makeGhostEnemy(es) {
  const def = ENEMIES[es.key];
  if (!def) return null;
  return {
    netId: es.netId, key: es.key, def, x: es.x, y: es.y, _tx: es.x, _ty: es.y,
    w: def.w, h: def.h, hp: es.hp, maxHp: def.hp, color: def.color, color2: def.color2,
    facing: es.facing === -1 ? -1 : 1, hurtFlash: 0, ghost: true,
    // Replicated enemies do not run their host-side update loop, so provide
    // the animation/physics fields the renderer reads.
    vx: 0, vy: 0, speed: Math.max(1, Number(def.speed) || 1),
    behavior: def.behavior || 'walker',
    walkAnim: 0, animTime: 0, onGround: true,
    telegraph: 0, telegraphMax: Math.max(0.4, Number(def.telegraph) || 0.4),
    center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; },
  };
}
// A client-side stand-in with every field the renderer reads, so a replicated
// boss animates like a simulated one instead of throwing on a missing property.
function makeGhostBoss(bs) {
  const def = BOSSES[bs.key];
  if (!def) return null;
  const segments = [];
  for (let i = 0; i < 3; i++) segments.push({ x: bs.x + 4 + i * 17, y: bs.y + 12 });
  return {
    key: bs.key, name: bs.name, x: bs.x, y: bs.y, _tx: bs.x, _ty: bs.y,
    w: def.w, h: def.h, hp: bs.hp, maxHp: bs.maxHp, color: def.color, color2: def.color2,
    facing: bs.facing, hurtFlash: 0, invuln: 0, bob: 0, ghost: true, phaseName: '',
    movement: def.movement,
    vx: 0, vy: 0,
    hidden: !!bs.hidden, telegraph: 0, telegraphMax: 0.6, attackPulse: 0,
    warnAt: null, warnTime: 0, warnMax: 0.6,
    squashX: 1, squashY: 1, jaw: 0, shardSpin: 0, segments, ghostTrail: [],
    walkCycle: 0, mechArmOpen: 0, mechRayCharge: 0, mechJumpCharge: 0,
    mechHeat: 0, mechLanding: 0, mechRay: null,
    aiState: bs.state || '',
    center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; },
  };
}

// Smooth ghost interpolation (client). Call each frame.
export function interpolateGhosts(game, dt) {
  const k = 1 - Math.pow(0.0006, dt);
  for (const e of game.enemies) { if (e.ghost) { e.x += (e._tx - e.x) * k; e.y += (e._ty - e.y) * k; if (e.hurtFlash > 0) e.hurtFlash -= dt; } }
  for (const b of game.bosses) {
    if (!b.ghost) continue;
    b.x += (b._tx - b.x) * k; b.y += (b._ty - b.y) * k;
    b.bob += dt * 3;
    b.shardSpin += dt * (b.telegraph > 0 ? 5.5 : 0.7);
    if (b.hurtFlash > 0) b.hurtFlash -= dt;
    // Segment lag, so a replicated Gravemaw undulates like the host's.
    if (b.movement === 'gravemaw' && b.segments) {
      const headX = b.x + (b.facing > 0 ? b.w - 29 : 4);
      const lagK = 1 - Math.pow(0.02, dt);
      const order = b.facing > 0 ? [2, 1, 0] : [0, 1, 2];
      for (let i = 0; i < 3; i++) {
        const s = b.segments[order[i]];
        s.x += ((headX - b.facing * i * 17) - s.x) * lagK;
        s.y += ((b.y + 12 + Math.sin(b.bob + i * 0.9) * 2) - s.y) * lagK;
      }
    }
    if (b.movement === 'mech') {
      const moving = Math.abs((b._tx || 0) - b.x) > 0.4;
      b.walkCycle += dt * (moving ? 4.8 : 0.65);
      const heat = b.phaseName === 'Overdrive' ? 1 : 0;
      b.mechHeat += (heat - (b.mechHeat || 0)) * (1 - Math.pow(0.12, dt));
      const rayTarget = b.mechRay ? 1 : 0;
      b.mechRayCharge += (rayTarget - (b.mechRayCharge || 0)) * (1 - Math.pow(0.01, dt));
    }
  }
  for (const d of game.drops) { if (d.ghost) d.bob += dt * 4; }
}

// ---------- Periodic sends ----------
export function netTick(game, dt) {
  const net = game.net;
  if (!net || net.status !== 'connected') return;
  game._snapAcc = (game._snapAcc || 0) + dt;
  if (net.isHost) {
    if (game._snapAcc >= 1 / NET_SNAPSHOT_HZ) { game._snapAcc = 0; net.broadcast(buildSnapshot(game)); }
  } else {
    if (game._snapAcc >= 1 / NET_INPUT_HZ) {
      game._snapAcc = 0;
      const p = game.localPlayer;
      if (!p) return;
      const s = p.netState();
      s.mins = game.minions.filter(m => m.ownerId === p.id).map(m => m.netInfo());
      net.toHost({ t: MSG.PSTATE, s });
    }
  }
}

// ---------- Message handling ----------
export function handleMessage(game, fromId, msg, conn) {
  if (!msg || typeof msg !== 'object' || msg.t == null) return;
  const net = game.net;
  switch (msg.t) {
    case MSG.HELLO: { // host
      let color = msg.color || assignColor(game.players.size);
      const rp = new Player(fromId, { name: msg.name || 'Summoner', color, isLocal: false });
      const sx = game.world.spawnX, sy = (game.world.safeSpawnY(Math.floor(game.world.spawnX / TILE)) - 2) * TILE;
      rp.x = sx; rp.y = sy;
      game.players.set(fromId, rp);
      conn.send(buildWelcome(game, fromId));
      net.broadcast({ t: MSG.CHAT, system: true, text: rp.name + ' joined' }, fromId);
      game.ui.menus.addChat(null, null, rp.name + ' joined', true);
      game.ui.menus.refreshPlayerList();
      game.toast(rp.name + ' joined', 'info');
      break;
    }
    case MSG.WELCOME: applyWelcome(game, msg); break;
    case MSG.SNAPSHOT: applySnapshot(game, msg); break;
    case MSG.PSTATE: { // host receives client state
      let rp = game.players.get(fromId);
      if (rp) { rp.applyNetState(msg.s); rp.remoteMinions = msg.s.mins || []; }
      break;
    }
    case MSG.TILE_EDIT: {
      game.world.set(msg.tx, msg.ty, msg.id, true);
      game.markDirty();
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.WALL_EDIT: {
      game.world.setWall(msg.tx, msg.ty, msg.id, true);
      game.markDirty();
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.SHAPE_EDIT: {
      game.world.setShape(msg.tx, msg.ty, msg.id, true);
      game.markDirty();
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.LIQUID_EDIT: {
      if (game.world.liquid) game.world.liquid.set(msg.tx, msg.ty, msg.level, true);
      game.markDirty();
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.HIT_ENEMY: { // host authoritative
      if (!net.isHost) break;
      const e = game.enemyById.get(msg.netId);
      if (e && e.takeDamage) e.takeDamage(msg.dmg, msg.kbx, -1, game, msg.effect, msg.crit);
      break;
    }
    case MSG.HIT_BOSS: {
      if (!net.isHost) break;
      const b = game.bosses[0];
      if (b && b.takeDamage) b.takeDamage(msg.dmg, game, msg.crit);
      break;
    }
    case MSG.HURT: { // client's player takes damage
      if (game.localPlayer) {
        game.localPlayer.takeDamage(msg.dmg, msg.kbx, game);
        game.localPlayer.applyStatusEffect?.(msg.effect, game);
      }
      break;
    }
    case MSG.GRANT: {
      if (game.localPlayer) { game.localPlayer.inventory.add(msg.item, msg.count); game.floatText(game.localPlayer.x, game.localPlayer.y, '+' + msg.count, '#7ee0c0'); }
      break;
    }
    case MSG.PICKUP: { // host validates
      if (!net.isHost) break;
      const d = game.dropById.get(msg.netId);
      if (d) { game.grantDropTo(fromId, d); }
      break;
    }
    case MSG.THROW: {
      // A peer threw something: mirror it locally so everyone sees the arc and
      // the blast. Tile destruction still only happens on the host.
      const def = ITEMS[msg.id];
      if (def && isItemEnabled(msg.id)) {
        const t = new ThrownItem(def, msg.x, msg.y, msg.vx, msg.vy, fromId);
        game.thrown.push(t);
      }
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.PROJFX: {
      game.projectiles.push(new Projectile({ x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, kind: msg.kind, color: msg.color, gravity: msg.gravity, life: msg.life || 2, visualOnly: true }));
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.CHAT: {
      game.ui.menus.addChat(msg.name, msg.color, msg.text, msg.system);
      if (net.isHost) net.broadcast(msg, fromId);
      break;
    }
    case MSG.EVENT: game.handleNetEvent(msg); break;
    case MSG.CMD: { if (net.isHost) game.execHostCommand(msg.cmd, msg.args, fromId); break; }
    case MSG.BYE: game.onClientLeave(fromId); break;
  }
}
