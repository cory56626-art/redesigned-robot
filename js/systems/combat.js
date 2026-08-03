// Summoner Realms — combat & interaction resolution (weapons, mining, placing).
import { TILE, REACH, HEAL_COOLDOWN, MANA_POTION_COOLDOWN, POTION_BUFF_COOLDOWN, CAST_REGEN_DELAY, LIQUID_MAX } from '../config.js?v=first-world-no-ore-boss-1';
import { T, tileDef, isTree, isLeaf } from '../world/tiles.js?v=first-world-no-ore-boss-1';
import { trunkMask, leafMask, spriteVariant } from '../art/sprites.js?v=first-world-no-ore-boss-1';
import { SH, nextShape } from '../world/shapes.js?v=first-world-no-ore-boss-1';
import { W } from '../world/walls.js?v=first-world-no-ore-boss-1';
import { item as getItem } from '../data/items.js?v=first-world-no-ore-boss-1';
import { Projectile } from '../entities/projectile.js?v=first-world-no-ore-boss-1';
import { ThrownItem } from '../entities/thrown.js?v=first-world-no-ore-boss-1';
import { angleTo, aabb, clamp } from '../utils.js?v=first-world-no-ore-boss-1';

const MINE_RATE = 95;
const MINE_SOUND_INTERVAL = 0.32;
// Melee swings are limited to a side-view arc: at most ~49° above/below level so
// there is never an instant straight-up swipe, and the arc never reaches behind.
const MELEE_MAX_TILT = 0.85;
const NEIGHBORS8 = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// The tile the player is acting on. With Smart Cursor active this is the tile
// the game chose (see systems/smartcursor.js, resolved once per step in
// main._step); otherwise it is simply whatever the pointer is over.
function aimTile(game, player) {
  const s = game.input.state;
  if (game.smartTarget) {
    return { tx: game.smartTarget.tx, ty: game.smartTarget.ty, ax: s.aimX, ay: s.aimY };
  }
  return { tx: Math.floor(s.aimX / TILE), ty: Math.floor(s.aimY / TILE), ax: s.aimX, ay: s.aimY };
}

function withinReach(player, tx, ty) {
  const pcx = (player.x + player.w / 2) / TILE;
  const pcy = (player.y + player.h / 2) / TILE;
  const dx = tx + 0.5 - pcx, dy = ty + 0.5 - pcy;
  return dx * dx + dy * dy <= REACH * REACH;
}

function rollCrit(chance) { return Math.random() < chance; }

// Can a melee swing from `pc` actually land on `tgt`, or is there rock between
// them? Large targets are sampled at several points across their body, because
// a boss whose centre is buried in a wall can still legitimately be hit where it
// leans out into the open — testing the centre alone would make big enemies
// immune whenever their midpoint clipped terrain.
function _meleeCanReach(game, pc, tgt) {
  const world = game.world;
  const cx = tgt.x + tgt.w / 2, cy = tgt.y + tgt.h / 2;
  if (world.hasLineOfSight(pc.x, pc.y, cx, cy)) return true;
  if (tgt.w <= TILE && tgt.h <= TILE) return false;
  const xs = [tgt.x + 2, cx, tgt.x + tgt.w - 2];
  const ys = [tgt.y + 2, cy, tgt.y + tgt.h - 2];
  for (const x of xs) {
    for (const y of ys) {
      if (world.hasLineOfSight(pc.x, pc.y, x, y)) return true;
    }
  }
  return false;
}

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

    // Blight's crystals are threatening but not untouchable. A sword swing
    // can clear one when it is close enough, giving melee players a real
    // defensive answer during the Sovereign's ring attacks.
    for (const pr of game.projectiles) {
      if (pr.dead || pr.ownerType !== 'boss' || !pr.destructible) continue;
      const pcx2 = pr.x + pr.w / 2, pcy2 = pr.y + pr.h / 2;
      const d = Math.hypot(pcx2 - pc.x, pcy2 - pc.y);
      if (d > reachPx + 24) continue;
      const ang = Math.atan2(pcy2 - pc.y, pcx2 - pc.x);
      let diff = Math.abs(ang - aimAng);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff <= arc / 2 + 0.3) {
        pr.dead = true;
        game.addHitParticles(pcx2, pcy2, pr.color, 6);
      }
    }

    const targets = [];
    for (const e of game.enemies) targets.push(e);
    for (const b of game.bosses) targets.push(b);
    // Wildlife is hittable — that is how you get meat and hide. Bugs are not:
    // they are caught by clicking (see game.catchBugAt), and letting a sword
    // delete one would just lose the player their bait.
    for (const c of game.critters) if (c.kind !== 'bug') targets.push(c);
    for (const tgt of targets) {
      const tcx = tgt.x + tgt.w / 2, tcy = tgt.y + tgt.h / 2;
      const d = Math.hypot(tcx - pc.x, tcy - pc.y);
      if (d > reachPx + Math.max(tgt.w, tgt.h) / 2) continue;
      const ang = Math.atan2(tcy - pc.y, tcx - pc.x);
      let diff = Math.abs(ang - aimAng);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > arc / 2 + 0.3) continue;
      // A blade is not a ranged weapon: it cannot reach through rock. Only
      // weapons that declare `phasing` (arcane blades whose tooltip says so)
      // ignore terrain, so hitting something on the far side of a wall is a
      // property of the weapon rather than an oversight in the hit test.
      if (!item.phasing && !_meleeCanReach(game, pc, tgt)) continue;
      game.hurtEnemyOrBoss(tgt, dmg, Math.sign(tcx - pc.x) * item.knockback, player.id, crit, item.effect);
    }
    game.spawnSwingFx(player, aimAng, item);
    if (item.fx && item.fx.swing) swingFx(game, player, item, aimAng, dmg, crit);
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
    if (item.fx && item.fx.shot) shotFx(game, player, item, rawAng);
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
    if (item.fx && item.fx.cast) castFx(game, player, item, rawAng);
    return;
  }

  if (item.weaponClass === 'summon') {
    // Aidan is a unique, demo-only summon. Check before spending mana so a
    // duplicate attempt never consumes resources or bypasses the 500s lockout.
    if (item.summonMinion === 'aidan' && game.canSummonMinion &&
        !game.canSummonMinion(player, item.summonMinion)) {
      player.useTimer = 0.3;
      return;
    }
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

// ---------------------------------------------------------------------------
// Weapon effects
//
// Only weapons that declare an `fx` in data/items.js get one — most weapons are
// deliberately plain, so the ones that do flash, burn or throw an arc feel like
// an upgrade rather than more of the same noise.
// ---------------------------------------------------------------------------

function swingFx(game, player, item, angle, dmg, crit) {
  const pc = player.center();
  const reach = item.reach || 30;
  const tipX = pc.x + Math.cos(angle) * reach;
  const tipY = pc.y + Math.sin(angle) * reach;

  switch (item.fx.swing) {
    case 'flame': {
      // Embers thrown along the whole arc, drifting up as they die.
      for (let i = 0; i < 14; i++) {
        const a = angle + (Math.random() - 0.5) * (item.arc || 1.6);
        const r = reach * (0.4 + Math.random() * 0.7);
        game.fx.push({
          x: pc.x + Math.cos(a) * r, y: pc.y + Math.sin(a) * r,
          vx: Math.cos(a) * 40, vy: Math.sin(a) * 40 - 50,
          life: 0.42, max: 0.42, size: 2.5,
          color: Math.random() < 0.5 ? '#ff8c3b' : '#ffcf6b',
          gravity: -60, drag: 2, glow: true, shrink: true,
        });
      }
      game.fx.smoke(tipX, tipY, '#6b5348', 3, { jitter: 8 });
      player.swing.color = 'rgba(255,150,70,0.85)';
      break;
    }
    case 'gleam': {
      game.fx.streak(tipX, tipY, angle, '#fff2c0', 6, { speed: 200, spread: 0.7, life: 0.2, size: 2 });
      game.fx.ring(pc.x, pc.y, 'rgba(255,232,160,0.7)', reach + 6, { life: 0.18, width: 2 });
      player.swing.color = 'rgba(255,240,180,0.9)';
      break;
    }
    case 'arcwave': {
      // The greatblade projects its arc: a real damaging crescent, which is what
      // makes the top-tier melee weapon feel like an endgame item.
      const speed = 320;
      game.addProjectile(new Projectile({
        x: pc.x, y: pc.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        damage: dmg * 0.6, ownerType: 'player', ownerId: player.id,
        kind: 'arcwave', color: '#bfe9ff', w: 18, h: 18,
        pierce: 3, life: 0.8, crit, trail: '#8ad9ff',
      }), true);
      game.fx.streak(tipX, tipY, angle, '#bfe9ff', 8, { speed: 240, spread: 0.6, life: 0.22, size: 3 });
      player.swing.color = 'rgba(180,230,255,0.95)';
      break;
    }
  }
}

function castFx(game, player, item, angle) {
  const pc = player.center();
  const hx = pc.x + Math.cos(angle) * 14, hy = pc.y + Math.sin(angle) * 14;
  switch (item.fx.cast) {
    case 'lightning': {
      // A branching bolt drawn ahead of the shot, plus a white flash.
      game.fx.ring(hx, hy, 'rgba(255,255,220,0.85)', 26, { life: 0.12, width: 3 });
      let bx = hx, by = hy, a = angle;
      for (let i = 0; i < 7; i++) {
        a += (Math.random() - 0.5) * 0.7;
        bx += Math.cos(a) * 16; by += Math.sin(a) * 16;
        game.fx.push({
          x: bx, y: by, vx: 0, vy: 0, life: 0.12, max: 0.12,
          size: 3, color: '#fff6b0', gravity: 0, glow: true, shrink: true,
        });
      }
      game.fx.shake(1.5, 0.12);
      break;
    }
    case 'void': {
      // Light pulled inward rather than thrown outward.
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 20 + Math.random() * 16;
        game.fx.push({
          x: hx + Math.cos(a) * r, y: hy + Math.sin(a) * r,
          vx: -Math.cos(a) * 90, vy: -Math.sin(a) * 90,
          life: 0.3, max: 0.3, size: 2.5, color: '#b06bff',
          gravity: 0, drag: 0.5, glow: true, shrink: true,
        });
      }
      game.fx.ring(hx, hy, '#6a2f9a', 30, { life: 0.22, width: 2 });
      break;
    }
    case 'prism': {
      const cols = ['#ff8fb0', '#ffd58a', '#9ce8a0', '#8ad9ff', '#c58bff'];
      for (let i = 0; i < 12; i++) {
        game.fx.streak(hx, hy, angle, cols[i % cols.length], 1, { speed: 170, spread: 1.1, life: 0.3, size: 2 });
      }
      break;
    }
    case 'frost': {
      game.fx.streak(hx, hy, angle, '#e6f6ff', 8, { speed: 90, spread: 1.4, life: 0.45, size: 2, gravity: 40 });
      game.fx.ring(hx, hy, 'rgba(190,235,255,0.6)', 22, { life: 0.2, width: 2 });
      break;
    }
  }
}

function shotFx(game, player, item, angle) {
  const pc = player.center();
  const mx = pc.x + Math.cos(angle) * 15, my = pc.y + Math.sin(angle) * 15;
  switch (item.fx.shot) {
    case 'muzzle':
      game.fx.muzzle(mx, my, angle, item.projColor || '#ffcf6b');
      // Guns kick.
      player.vx -= Math.cos(angle) * 26;
      game.fx.shake(1.2, 0.1);
      break;
    case 'storm':
      game.fx.streak(mx, my, angle, '#bfe9ff', 8, { speed: 260, spread: 0.4, life: 0.2, size: 2 });
      game.fx.ring(mx, my, 'rgba(140,220,255,0.6)', 18, { life: 0.14, width: 2 });
      break;
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
      knockback: item.knockback || 3, crit, life: 3, trail: item.trail || null,
    }), true);
  }
}

// ---------------------------------------------------------------------------
// Throwables
// ---------------------------------------------------------------------------

// Launch the selected throwable along the aim direction. Gravity does the rest,
// which is what gives the arc — no special-case trajectory code needed.
export function throwItem(game, player, item) {
  if (!item || item.category !== 'throwable') return false;
  if (player.useTimer > 0) return false;
  if (!player.inventory.remove(item.id, 1)) return false;

  const s = game.input.state;
  const pc = player.center();
  const ang = angleTo(pc.x, pc.y, s.aimX, s.aimY);
  player.facing = Math.cos(ang) < 0 ? -1 : 1;
  player.useTimer = item.useTime || 0.32;

  const speed = item.throwSpeed || 420;
  // A slight upward bias so a flat throw still arcs rather than nosediving.
  const vx = Math.cos(ang) * speed + player.vx * 0.35;
  const vy = Math.sin(ang) * speed - 60;

  const t = new ThrownItem(item, pc.x - 4, pc.y - 4, vx, vy, player.id);
  game.addThrown(t, true);
  game.audio?.throwItem?.();
  game.fx.streak(pc.x, pc.y, ang, item.color, 3, { speed: 60, life: 0.15, size: 2, glow: false });
  return true;
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
  // Cave chests are opened through the same direct click/mining affordance as
  // Terraria containers; they are never quietly destroyed into nothing.
  if (def.chest) { game.openLootChest?.(tx, ty, player); return; }
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
  if (player.mineSoundTimer > 0) player.mineSoundTimer -= dt;
  if (res && !res.broken && player.mineSoundTimer <= 0) {
    const hitKind = haveKind || need;
    if (hitKind === 'axe') game.audio?.axeHit();
    else game.audio?.pickaxeHit();
    player.mineSoundTimer = MINE_SOUND_INTERVAL;
  }

  if (res && res.broken) {
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
      if (getItem(res.drop) && getItem(res.drop).matKind === 'ore') game.onOreMined && game.onOreMined();
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

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

// Pour a full pail into the aimed tile, or scoop a full tile of water into an
// empty one. Swapping the item in place keeps the pail in the same hotbar slot,
// so repeatedly moving water doesn't shuffle the bar around.
export function useBucket(game, player, item) {
  const { tx, ty } = aimTile(game, player);
  if (!withinReach(player, tx, ty)) {
    game.floatText(tx * TILE + TILE / 2, ty * TILE, 'Too far away', '#ff8b7d');
    return false;
  }
  const liq = game.world.liquid;
  if (!liq) return false;
  const slot = player.inventory.selected;

  if (item.bucket === 'empty') {
    if (liq.get(tx, ty) < LIQUID_MAX) {
      game.floatText(tx * TILE + TILE / 2, ty * TILE, 'Not enough water', '#ff8b7d');
      return false;
    }
    liq.set(tx, ty, 0, true);
    game.netEditLiquid(tx, ty, 0);
    player.inventory.slots[slot] = { id: 'waterBucket', count: 1 };
  } else {
    if (game.world.get(tx, ty) !== T.AIR || liq.get(tx, ty) > 0) {
      game.floatText(tx * TILE + TILE / 2, ty * TILE, 'No room', '#ff8b7d');
      return false;
    }
    liq.set(tx, ty, LIQUID_MAX, true);
    game.netEditLiquid(tx, ty, LIQUID_MAX);
    player.inventory.slots[slot] = { id: 'emptyBucket', count: 1 };
  }
  player.useTimer = 0.3;
  game.audio?.blockPlace?.();
  game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, '#4f8fd0', 5);
  game.markDirty();
  return true;
}

// ---------------------------------------------------------------------------
// Hammer — block sculpting
// ---------------------------------------------------------------------------

// Hammers don't break blocks, they reshape them: each hit walks the aimed tile
// one step around HAMMER_CYCLE (full -> half -> the four slopes -> half-top ->
// full). A hammer with no solid tile under the cursor knocks the background
// wall off instead, which is the other thing Terraria's hammer is for.
//
// The cooldown is per-hit rather than continuous, otherwise holding the button
// would spin a tile through every shape in a fraction of a second.
export function hammerAt(game, player, dt) {
  if (player.hammerTimer > 0) return;
  const { tx, ty } = aimTile(game, player);
  if (!withinReach(player, tx, ty)) return;
  const id = game.world.get(tx, ty);
  const def = tileDef(id);

  if (id !== T.AIR && def.solid) {
    const shape = nextShape(game.world.getShape(tx, ty));
    game.world.setShape(tx, ty, shape);
    game.netEditShape(tx, ty, shape);
    game.onBlockShaped && game.onBlockShaped();
    game.markDirty();
    player.hammerTimer = 0.22;
    game.audio?.pickaxeHit();
    game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, def.color || '#888', 4);
    return;
  }

  // Nothing solid here: take the wall down instead.
  if (game.world.hasWallAt(tx, ty)) {
    game.world.setWall(tx, ty, W.NONE);
    game.netEditWall(tx, ty, W.NONE);
    game.markDirty();
    player.hammerTimer = 0.26;
    game.audio?.pickaxeHit();
    game.addHitParticles(tx * TILE + TILE / 2, ty * TILE + TILE / 2, '#4a4a55', 5);
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

// Widest canopy any biome grows, in tiles either side of the trunk. The leaf
// flood is capped to this so a fell can never walk across into the next tree.
const MAX_CANOPY_REACH = 4;

// Fell the tree above a freshly-broken trunk tile at (tx,ty): collapse the trunk
// column above the cut and the leaves that belong to *this* tree, drop wood from
// the trunk and twigs from the leaves, and kick off a short falling animation.
//
// Leaf ownership matters. The old flood took every 8-connected leaf, so two
// trees whose canopies touched were a single blob and chopping one stripped the
// other bare. A leaf now has to be within this trunk's canopy reach *and* not be
// held up by a different trunk that is still standing.
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
  // The felled trunk's own columns, so "is this leaf supported by someone else"
  // can tell our trunk from a neighbour's.
  const ownTrunk = new Set(removed.map(c => key(c.x, c.y)));
  ownTrunk.add(key(tx, ty));
  const topY = removed.length ? removed[removed.length - 1].y : ty;

  // 2) Flood connected leaves, seeded from the cut point and each trunk tile,
  //    bounded to this trunk's canopy footprint.
  const q = [{ x: tx, y: ty }, ...removed];
  let guard = 0;
  while (q.length && guard++ < 500) {
    const c = q.shift();
    for (const [dx, dy] of NEIGHBORS8) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
      if (seen.has(k)) continue;
      if (!isLeaf(world.get(nx, ny))) continue;
      // Bound the canopy to this trunk: never more than a canopy's width to the
      // side, and never below the cut.
      if (Math.abs(nx - tx) > MAX_CANOPY_REACH) continue;
      if (ny > ty || ny < topY - MAX_CANOPY_REACH - 2) continue;
      // Held up by somebody else's trunk? Leave it standing with its tree.
      if (_leafHeldByOtherTrunk(world, nx, ny, ownTrunk, key)) continue;
      seen.add(k);
      const cell = { x: nx, y: ny, id: world.get(nx, ny), trunk: false };
      removed.push(cell); q.push(cell);
    }
  }
  if (!removed.length) return;

  // Capture each cell's rendered appearance *before* the tiles are cleared, so
  // the topple animation keeps the shaded trunk/canopy sprites the standing tree
  // had. Reading them afterwards would find air and fall back to the flat tile
  // sprite, which is what made a felled tree visibly revert to an older model.
  for (const cell of removed) {
    cell.mask = cell.trunk ? trunkMask(world, cell.x, cell.y) : leafMask(world, cell.x, cell.y);
    cell.variant = spriteVariant(cell.x, cell.y);
  }

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
  game.onTreeFelled && game.onTreeFelled(woodCount);
  const dir = player.center().x < tx * TILE ? 1 : -1; // fall away from the chopper
  game.spawnFallingTree(removed, tx, ty, dir);
}

// Is this leaf orthogonally touching a trunk tile that is not part of the tree
// being felled? If so it belongs to that tree and must stay up.
function _leafHeldByOtherTrunk(world, lx, ly, ownTrunk, key) {
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = lx + dx, ny = ly + dy;
    if (!isTree(world.get(nx, ny))) continue;
    if (!ownTrunk.has(key(nx, ny))) return true;
  }
  return false;
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
  // Remember where this block went so the Smart Cursor can continue the run
  // while the button stays held (see systems/smartcursor.findPlacement).
  game.smartRun = { tx, ty, item: sel.id };
  game.onBlockPlaced && game.onBlockPlaced();
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
  // Don't waste a potion (or start a cooldown) if it would do nothing. Food is
  // the exception: it is eaten for the buff as much as for the healing, so a
  // full-health meal is a reasonable thing to want.
  const worthItAnyway = def.food && eff.buff;
  if (eff.heal && player.hp >= player.maxHp && !worthItAnyway) { game.toast('Health already full', 'bad'); return false; }
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
  if (!item || !item.summonBoss) return false;
  game.trySummonBoss(item.summonBoss, player, item.id);
  return true;
}
