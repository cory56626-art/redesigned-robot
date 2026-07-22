// Summoner Realms — combat & interaction resolution (weapons, mining, placing).
import { TILE, REACH, HEAL_COOLDOWN, MANA_POTION_COOLDOWN, POTION_BUFF_COOLDOWN, CAST_REGEN_DELAY } from '../config.js';
import { T, tileDef, isTree, isLeaf } from '../world/tiles.js';
import { item as getItem } from '../data/items.js';
import { Projectile } from '../entities/projectile.js';
import { angleTo, aabb, clamp } from '../utils.js';

const MINE_RATE = 95;
// Melee swings are limited to a side-view arc: at most ~49° above/below level so
// there is never an instant straight-up swipe, and the arc never reaches behind.
const MELEE_MAX_TILT = 0.85;
const NEIGHBORS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function aimTile(game, player) {
  const s = game.input.state;
  return { tx: Math.floor(s.aimX / TILE), ty: Math.floor(s.aimY / TILE), ax: s.aimX, ay: s.aimY };
}

function withinReach(player, tx, ty) {
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const dx = tx + 0.5 - pcx, dy = ty + 0.5 - pcy;
  return dx * dx + dy * dy <= REACH * REACH;
}

function rollCrit(chance) { return Math.random() < chance; }

export function useWeapon(game, player, item) {
  const s = game.input.state;
  const pc = player.center();
  const rawAng = angleTo(pc.x, pc.y, s.aimX, s.aimY);
  const facing = Math.cos(rawAng) < 0 ? -1 : 1;
  player.facing = facing;

  if (item.weaponClass === 'melee') {
    // Clamp to a believable side-view arc. `tilt` is the vertical lean of the
    // swing (+down / -up), limited so you can angle a hit but never swipe
    // straight up or hook an enemy standing behind you.
    const dx = s.aimX - pc.x, dy = s.aimY - pc.y;
    const tilt = clamp(Math.atan2(dy, Math.abs(dx) + 0.001), -MELEE_MAX_TILT, MELEE_MAX_TILT);
    const aimAng = facing > 0 ? tilt : (Math.PI - tilt);
    player.useTimer = item.useTime;
    game.audio?.swordSwing();
    player.swing = { time: 0, dur: item.useTime, angle: aimAng, item: item.id, reach: item.reach };
    const crit = rollCrit(item.crit || 0.06);
    const dmg = item.damage * (player.stats ? player.stats.meleeMul : 1) * (crit ? 2 : 1);
    const reachPx = item.reach + 8;
    const arc = item.arc || 1.6;
    const targets = [];
    for (const e of game.enemies) targets.push(e);
    for (const b of game.bosses) targets.push(b);
    for (const tgt of targets) {
      const tcx = tgt.x + tgt.w / 2, tcy = tgt.y + tgt.h / 2;
      const d = Math.hypot(tcx - pc.x, tcy - pc.y);
      if (d > reachPx + Math.max(tgt.w, tgt.h) / 2) continue;
      const ang = Math.atan2(tcy - pc.y, tcx - pc.x);
      let diff = Math.abs(ang - aimAng);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff <= arc / 2 + 0.3) {
        game.hurtEnemyOrBoss(tgt, dmg, Math.sign(tcx - pc.x) * item.knockback, player.id, crit, item.effect);
      }
    }
    game.spawnSwingFx(player, aimAng, item);
    return;
  }

  if (item.weaponClass === 'ranged') {
    // Ranged weapons without an `ammo` field are self-powered (stated in their
    // tooltip). Ones that use ammo must have it, and the useTimer below prevents
    // a rapid click from consuming several arrows in one frame.
    if (item.ammo) {
      if (player.inventory.count(item.ammo) <= 0) {
        game.toast('Out of ' + getItem(item.ammo).name + '!', 'bad');
        player.floatText && game.floatText(pc.x, pc.y - 10, 'No ammo', '#ff6b7d');
        player.useTimer = 0.25;
        return;
      }
      player.inventory.remove(item.ammo, 1);
    }
    player.useTimer = item.useTime;
    const crit = rollCrit(item.crit || 0.06);
    const dmg = item.damage * (player.stats ? player.stats.rangedMul : 1) * (crit ? 2 : 1);
    _fireProjectiles(game, player, item, rawAng, dmg, crit, 'ranged');
    if (item.rangedKind === 'bow') game.audio?.bowShot();
    return;
  }

  if (item.weaponClass === 'mage') {
    if (player.mana < item.manaCost) {
      game.toast('Not enough Aether', 'bad');
      game.floatText(pc.x, pc.y - 10, 'Low Aether', '#6a7bff');
      player.useTimer = 0.25;
      return;
    }
    player.spendMana(item.manaCost);
    player.useTimer = item.useTime;
    player.castTimer = CAST_REGEN_DELAY; // throttle mana regen right after a cast
    const crit = rollCrit(item.crit || 0.06);
    const dmg = item.damage * (player.stats ? player.stats.mageMul : 1) * (crit ? 2 : 1);
    _fireProjectiles(game, player, item, rawAng, dmg, crit, 'mage');
    game.audio?.magicCast();
    game.spawnCastFx && game.spawnCastFx(player, rawAng, item);
    return;
  }

  if (item.weaponClass === 'summon') {
    if (player.mana < item.manaCost) {
      game.toast('Not enough Aether', 'bad');
      game.floatText(pc.x, pc.y - 10, 'Low Aether', '#6a7bff');
      player.useTimer = 0.3;
      return;
    }
    player.spendMana(item.manaCost);
    player.useTimer = item.useTime;
    player.castTimer = CAST_REGEN_DELAY;
    game.summonMinion(player, item.summonMinion);
    return;
  }
}

function _fireProjectiles(game, player, item, aimAng, dmg, crit, cls) {
  const pc = player.center();
  const count = item.multishot || 1;
  const spread = item.spread || 0;
  for (let i = 0; i < count; i++) {
    const a = aimAng + (count > 1 ? (i - (count - 1) / 2) * (spread / Math.max(1, count - 1)) : 0);
    const speed = item.projSpeed || 480;
    game.addProjectile(new Projectile({
      x: pc.x, y: pc.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      damage: dmg, ownerType: cls === 'ranged' ? 'player' : 'player', ownerId: player.id,
      kind: item.rangedKind || item.mageKind || 'spark', color: item.projColor || item.color,
      pierce: item.pierce || 0, gravity: !!item.gravity, effect: item.effect || null,
      knockback: item.knockback || 3, crit, life: 3,
    }), true);
  }
}

function bestAnyToolPower(player) {
  let p = 1;
  for (const s of player.inventory.slots) { if (s) { const d = getItem(s.id); if (d && d.tool) p = Math.max(p, d.tool.power); } }
  return p;
}

// source: { tool: <itemDef> } for an explicitly selected tool, or { auto:true }
// for the dedicated mine action (auto-picks the correct tool for the tile).
export function mineAt(game, player, dt, source) {
  const { tx, ty } = aimTile(game, player);
  if (!withinReach(player, tx, ty)) return;
  const id = game.world.get(tx, ty);
  if (id === T.AIR) return;
  const def = tileDef(id);
  if (!def.hardness) return;

  const need = def.toolType || null;         // 'pickaxe' | 'axe' | null (any)
  let power = 1, haveKind = null;
  if (source && source.tool && source.tool.tool) {
    power = source.tool.tool.power; haveKind = source.tool.tool.kind;
  } else if (need) {
    const best = player.inventory.bestToolFor(need);
    power = best.power; haveKind = best.kind;
  } else {
    power = bestAnyToolPower(player);
  }

  // Right tool mines at full speed; the wrong tool (an axe on stone, a pick on a
  // tree) still works but at a slow 25% fallback so it never fully blocks play.
  const rightTool = !need || haveKind === need;
  const factor = rightTool ? 1 : 0.25;
  const res = game.world.damageTile(tx, ty, power * MINE_RATE * factor * dt, rightTool ? power : 0);
  if (res) {
    const hitKind = haveKind || need;
    if (hitKind === 'axe') game.audio?.axeHit();
    else game.audio?.pickaxeHit();
  }
  player.mineTarget = { tx, ty, ratio: res ? (res.progress || (res.broken ? 1 : 0)) : 0 };

  if (res && res.broken) {
    player.mineTarget = null;
    game.audio?.blockBreak();
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    if (isTree(id)) {
      // Base trunk segment: gives its own wood, then fells everything above it.
      _giveOrDrop(game, player, tx, ty, 'wood', 1);
      collapseTree(game, player, tx, ty);
      game.addHitParticles(cx, cy, def.color || '#8a5a2a', 6);
    } else if (isLeaf(id)) {
      _leafDrop(game, player, tx, ty);
      game.addHitParticles(cx, cy, def.color || '#3e7a34', 5);
    } else if (Math.random() <= (res.dropChance || 1) && res.drop) {
      _giveOrDrop(game, player, tx, ty, res.drop, 1);
      game.addHitParticles(cx, cy, def.color || '#888', 6);
    } else {
      game.addHitParticles(cx, cy, def.color || '#888', 6);
    }
    game.netEditTile(tx, ty, T.AIR);
    game.markDirty();
  } else if (res) {
    game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || '#888', 1);
  }
}

function _giveOrDrop(game, player, tx, ty, itemId, n) {
  const leftover = player.inventory.add(itemId, n);
  if (leftover > 0) game.spawnDrop(tx * TILE + 4, ty * TILE + 4, itemId, leftover);
  game.floatText(tx * TILE + TILE / 2, ty * TILE, '+' + n + ' ' + getItem(itemId).name.split(' ')[0], '#7ee0c0');
}

// Breaking leaves yields twigs/seeds (never wood).
function _leafDrop(game, player, tx, ty) {
  const r = Math.random();
  if (r < 0.32) _giveOrDrop(game, player, tx, ty, 'stick', 1);
  else if (r < 0.40) _giveOrDrop(game, player, tx, ty, 'sapling', 1);
  game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, '#3e7a34', 4);
}

// Fell the tree above a freshly-broken trunk tile at (tx,ty): collapse the trunk
// column above the cut and every connected leaf, drop wood from the trunk and
// twigs from the leaves, and kick off a short falling animation. No floating
// leaves are ever left behind.
function collapseTree(game, player, tx, ty) {
  const world = game.world;
  const key = (x, y) => x + ',' + y;
  const seen = new Set();
  const removed = [];
  // 1) Trunk column above the cut.
  for (let y = ty - 1; y >= 0; y--) {
    if (isTree(world.get(tx, y))) { seen.add(key(tx, y)); removed.push({ x: tx, y, id: world.get(tx, y), trunk: true }); }
    else break;
  }
  // 2) Flood connected leaves, seeded from the cut point and each trunk tile.
  const q = [{ x: tx, y: ty }, ...removed];
  let guard = 0;
  while (q.length && guard++ < 500) {
    const c = q.shift();
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
      if (seen.has(k)) continue;
      if (isLeaf(world.get(nx, ny))) { seen.add(k); const cell = { x: nx, y: ny, id: world.get(nx, ny), trunk: false }; removed.push(cell); q.push(cell); }
    }
  }
  if (!removed.length) return;

  let woodCount = 0;
  for (const cell of removed) {
    world.set(cell.x, cell.y, T.AIR);
    game.netEditTile(cell.x, cell.y, T.AIR);
    if (cell.trunk) woodCount++;
    else { const r = Math.random(); if (r < 0.22) player.inventory.add('stick', 1); else if (r < 0.28) player.inventory.add('sapling', 1); }
  }
  if (woodCount > 0) {
    const leftover = player.inventory.add('wood', woodCount);
    if (leftover > 0) game.spawnDrop(tx * TILE + 4, (ty - 1) * TILE, 'wood', leftover);
    game.floatText(tx * TILE + TILE / 2, (ty - 1) * TILE, '+' + woodCount + ' Wood', '#c9a26a');
  }
  const dir = player.center().x < tx * TILE ? 1 : -1; // fall away from the chopper
  game.spawnFallingTree(removed, tx, ty, dir);
}

// Can the given placeable item be placed at aim tile (tx,ty)? Returns
// { ok:true } or { ok:false, reason:'...' }. Pure check — never mutates state —
// so the renderer can colour a valid/invalid ghost preview with the same rules.
export function canPlaceAt(game, player, tx, ty, sel) {
  if (!sel || sel.place == null) return { ok: false, reason: 'Not placeable' };
  if (!withinReach(player, tx, ty)) return { ok: false, reason: 'Too far away' };
  if (game.world.get(tx, ty) !== T.AIR) return { ok: false, reason: 'Space is occupied' };
  const placingSolid = tileDef(sel.place).solid;
  if (placingSolid) {
    const box = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    for (const p of game.players.values()) if (p.alive && aabb(box, p)) return { ok: false, reason: "Can't place on a player" };
  }
  const neighborSolid = game.world.isSolidAt(tx - 1, ty) || game.world.isSolidAt(tx + 1, ty) ||
    game.world.isSolidAt(tx, ty - 1) || game.world.isSolidAt(tx, ty + 1);
  const pcx = (player.x + player.w / 2) / TILE, pcy = (player.y + player.h / 2) / TILE;
  const near = Math.abs(tx + 0.5 - pcx) < 3 && Math.abs(ty + 0.5 - pcy) < 3;
  if (!neighborSolid && !near) return { ok: false, reason: 'Needs a solid neighbour' };
  return { ok: true };
}

export function placeSelected(game, player) {
  const sel = player.inventory.selectedItem();
  if (!sel || sel.place == null) return false;
  const { tx, ty } = aimTile(game, player);
  const check = canPlaceAt(game, player, tx, ty, sel);
  if (!check.ok) {
    // Throttled so a deliberate misclick is explained without spamming while the
    // Place button is held over an invalid tile.
    if (!game._placeFailCd || game._placeFailCd <= 0) {
      game.floatText(tx * TILE + TILE / 2, ty * TILE, check.reason, '#ff8b7d');
      game._placeFailCd = 0.7;
    }
    return false;
  }
  if (!player.inventory.remove(sel.id, 1)) return false;
  game.world.set(tx, ty, sel.place);
  game.netEditTile(tx, ty, sel.place);
  game.markDirty();
  game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, tileDef(sel.place).color || '#888', 3);
  game.audio?.blockPlace();
  game.floatText(tx * TILE + TILE / 2, ty * TILE, getItem(sel.id).name.split(' ')[0] + ' placed', '#7ee0c0');
  return true;
}

// Consume the currently-selected potion (Q key / mobile Item button / primary).
export function consumeSelected(game, player) {
  const sel = player.inventory.selectedItem();
  if (!sel || sel.category !== 'potion') return;
  applyPotion(game, player, player.inventory.selected, sel);
}

// Shared potion handler used by every input path (hotbar key, inventory click,
// mobile, and test commands) so healing cooldowns can never be bypassed.
// Returns true if the potion was consumed.
export function applyPotion(game, player, index, def) {
  if (!def || def.category !== 'potion') return false;
  const eff = def.potion || {};
  // Enforce cooldowns *before* consuming so a spammed click just no-ops.
  if (eff.heal && player.healCd > 0) { game.toast('Healing recharging… ' + Math.ceil(player.healCd) + 's', 'bad'); return false; }
  if (eff.mana && player.manaCd > 0) { game.toast('Tonic recharging… ' + Math.ceil(player.manaCd) + 's', 'bad'); return false; }
  if (eff.buff && player.buffCd > 0) { game.toast('Brew recharging… ' + Math.ceil(player.buffCd) + 's', 'bad'); return false; }
  // Don't waste a potion (or start a cooldown) if it would do nothing.
  if (eff.heal && player.hp >= player.maxHp) { game.toast('Health already full', 'bad'); return false; }
  if (eff.mana && player.mana >= player.maxMana) { game.toast('Aether already full', 'bad'); return false; }

  if (eff.heal) { player.heal(eff.heal); player.startHealCooldown(); }
  if (eff.mana) { player.restoreMana(eff.mana); player.startManaCooldown(); }
  if (eff.buff) { player.buffs = player.buffs.filter(x => x.type !== eff.buff.type); player.buffs.push(Object.assign({}, eff.buff)); player.startBuffCooldown(); }

  player.inventory.removeAt(index, 1);
  game.floatText(player.x + player.w / 2, player.y, 'used ' + def.name.split(' ')[0], '#7ee08a');
  game.addHitParticles(player.x + player.w / 2, player.y + player.h / 2, def.color, 6);
  return true;
}

export function useSummonItem(game, player, item) {
  game.trySummonBoss(item.summonBoss, player, item.id);
}
