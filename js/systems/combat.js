// Summoner Realms — combat & interaction resolution (weapons, mining, placing).
import { TILE, REACH } from '../config.js';
import { T, tileDef } from '../world/tiles.js';
import { item as getItem } from '../data/items.js';
import { Projectile } from '../entities/projectile.js';
import { angleTo, aabb } from '../utils.js';

const MINE_RATE = 95;

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
  const aimAng = angleTo(pc.x, pc.y, s.aimX, s.aimY);
  player.facing = Math.cos(aimAng) < 0 ? -1 : 1;

  if (item.weaponClass === 'melee') {
    player.useTimer = item.useTime;
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
    if (item.ammo) {
      if (!player.inventory.remove(item.ammo, 1)) {
        game.toast('Out of ' + getItem(item.ammo).name, 'bad');
        player.useTimer = 0.2;
        return;
      }
    }
    player.useTimer = item.useTime;
    const crit = rollCrit(item.crit || 0.06);
    const dmg = item.damage * (player.stats ? player.stats.rangedMul : 1) * (crit ? 2 : 1);
    _fireProjectiles(game, player, item, aimAng, dmg, crit, 'ranged');
    return;
  }

  if (item.weaponClass === 'mage') {
    if (!player.spendMana(item.manaCost)) { game.toast('Not enough Aether', 'bad'); player.useTimer = 0.2; return; }
    player.useTimer = item.useTime;
    const crit = rollCrit(item.crit || 0.06);
    const dmg = item.damage * (player.stats ? player.stats.mageMul : 1) * (crit ? 2 : 1);
    _fireProjectiles(game, player, item, aimAng, dmg, crit, 'mage');
    return;
  }

  if (item.weaponClass === 'summon') {
    if (!player.spendMana(item.manaCost)) { game.toast('Not enough Aether', 'bad'); player.useTimer = 0.3; return; }
    player.useTimer = item.useTime;
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

export function mineAt(game, player, power, dt) {
  const { tx, ty } = aimTile(game, player);
  if (!withinReach(player, tx, ty)) return;
  const id = game.world.get(tx, ty);
  if (id === T.AIR) return;
  const def = tileDef(id);
  const res = game.world.damageTile(tx, ty, power * MINE_RATE * dt, power);
  player.mineTarget = { tx, ty, ratio: res ? (res.progress || (res.broken ? 1 : 0)) : 0 };
  if (res && res.broken) {
    player.mineTarget = null;
    if (Math.random() <= (res.dropChance || 1) && res.drop) {
      const leftover = player.inventory.add(res.drop, 1);
      if (leftover > 0) game.spawnDrop(tx * TILE + 4, ty * TILE + 4, res.drop, leftover);
      game.floatText(tx * TILE + TILE / 2, ty * TILE, '+' + getItem(res.drop).name.split(' ')[0], '#7ee0c0');
    }
    game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || '#888', 6);
    game.netEditTile(tx, ty, T.AIR);
    game.markDirty();
  } else if (res) {
    game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || '#888', 1);
  }
}

export function placeSelected(game, player) {
  const sel = player.inventory.selectedItem();
  if (!sel || sel.place == null) return false;
  const { tx, ty } = aimTile(game, player);
  if (!withinReach(player, tx, ty)) return false;
  if (game.world.get(tx, ty) !== T.AIR) return false;

  const placingSolid = tileDef(sel.place).solid;
  // Don't place a solid tile inside any player.
  if (placingSolid) {
    const box = { x: tx * TILE, y: ty * TILE, w: TILE, h: TILE };
    for (const p of game.players.values()) if (p.alive && aabb(box, p)) return false;
  }
  // Require an adjacent solid tile or proximity to the player.
  const neighborSolid = game.world.isSolidAt(tx - 1, ty) || game.world.isSolidAt(tx + 1, ty) ||
    game.world.isSolidAt(tx, ty - 1) || game.world.isSolidAt(tx, ty + 1);
  const pcx = (player.x + player.w / 2) / TILE, pcy = (player.y + player.h / 2) / TILE;
  const near = Math.abs(tx + 0.5 - pcx) < 3 && Math.abs(ty + 0.5 - pcy) < 3;
  if (!neighborSolid && !near) return false;

  if (!player.inventory.remove(sel.id, 1)) return false;
  game.world.set(tx, ty, sel.place);
  game.netEditTile(tx, ty, sel.place);
  game.markDirty();
  game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, tileDef(sel.place).color || '#888', 3);
  return true;
}

export function consumeSelected(game, player) {
  const sel = player.inventory.selectedItem();
  if (!sel || sel.category !== 'potion') return;
  const eff = sel.potion;
  if (eff.heal) { if (player.hp >= player.maxHp) { game.toast('Health already full', 'bad'); return; } player.heal(eff.heal); }
  if (eff.mana) { if (player.mana >= player.maxMana) { game.toast('Aether already full', 'bad'); return; } player.restoreMana(eff.mana); }
  if (eff.buff) {
    const b = eff.buff;
    player.buffs = player.buffs.filter(x => x.type !== b.type);
    player.buffs.push(Object.assign({}, b));
  }
  player.inventory.remove(sel.id, 1);
  game.floatText(player.x + player.w / 2, player.y, 'used ' + sel.name.split(' ')[0], '#7ee08a');
  game.addHitParticles(player.x + player.w / 2, player.y + player.h / 2, sel.color, 6);
}

export function useSummonItem(game, player, item) {
  game.trySummonBoss(item.summonBoss, player, item.id);
}
