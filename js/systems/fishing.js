// Summoner Realms — fishing.
//
// Cast toward the water, wait for the bobber to dip, and click again inside a
// short window to land the catch. Three things decide what you pull up: the
// rod's power, the quality of the bait on your hotbar, and how much open water
// surrounds the bobber — a puddle is not a lake, and the loot table knows it.
//
// Bait comes from the bugs in data/fauna.js, which is what ties the wildlife
// and the fishing together rather than leaving them as two unrelated features.
import {
  TILE, REACH, FISH_MIN_WAIT, FISH_MAX_WAIT, FISH_HOOK_WINDOW, FISH_MIN_POOL,
} from '../config.js?v=hivewrought-1';
import { item as getItem } from '../data/items.js?v=hivewrought-1';
import { UNDERGROUND_Y, CAVERN_Y } from '../config.js?v=hivewrought-1';

// How far a cast can reach, in tiles. Generous compared to mining reach, since
// standing on a bank and casting across is the point.
const CAST_RANGE = REACH + 6;

/**
 * Loot tables by "quality", a 0..1 score combining rod power, bait grade and
 * pool size. Each entry is a weight; the table is rolled after quality picks
 * which band applies, so a better setup shifts the whole distribution rather
 * than just adding a rare drop on top.
 */
const CATCH_TABLES = {
  poor: [
    { item: 'rawFish', weight: 44 },
    { item: 'fiber', weight: 16 },
    { item: 'stick', weight: 14 },
    { item: 'worm', weight: 10 },
    { item: 'woodCrate', weight: 8 },
    { item: 'sand', weight: 8 },
  ],
  fair: [
    { item: 'rawFish', weight: 42 },
    { item: 'woodCrate', weight: 18 },
    { item: 'healLesser', weight: 8 },
    { item: 'fiber', weight: 12 },
    { item: 'stone', weight: 12 },
  ],
  good: [
    { item: 'rawFish', weight: 34 },
    { item: 'woodCrate', weight: 22 },
    { item: 'healLesser', weight: 12 },
    { item: 'flintArrow', weight: 12 },
    { item: 'bomb', weight: 8 },
    { item: 'fiber', weight: 12 },
  ],
};

/** What a crate can contain, by crate tier. */
const CRATE_TABLES = {
  woodCrate: [
    { item: 'stone', min: 10, max: 25, weight: 18 },
    { item: 'healLesser', min: 1, max: 3, weight: 16 },
    { item: 'torch', min: 4, max: 10, weight: 14 },
    { item: 'flintArrow', min: 15, max: 40, weight: 12 },
    { item: 'bomb', min: 1, max: 3, weight: 8 },
    { item: 'fireFlask', min: 1, max: 2, weight: 7 },
    { item: 'shuriken', min: 2, max: 6, weight: 7 },
  ],
};

/** Best bait the player is carrying, or null. Higher grade wins. */
export function bestBait(player) {
  let best = null;
  for (let i = 0; i < player.inventory.slots.length; i++) {
    const s = player.inventory.slots[i];
    if (!s) continue;
    const d = getItem(s.id);
    if (!d || !d.bait) continue;
    if (!best || d.bait > best.grade) best = { id: s.id, grade: d.bait, index: i };
  }
  return best;
}

/**
 * Start or resolve a cast. Called on each primary press while a rod is held.
 *
 * The same button does both jobs, exactly like Terraria: press once to cast,
 * press again to reel. Pressing while a fish is on resolves the catch; pressing
 * at any other time just picks the line back up.
 */
export function useRod(game, player, rod) {
  const line = player.fishing;

  if (line) {
    if (line.biting) landCatch(game, player, rod, line);
    else {
      player.fishing = null;
      game.floatText(player.x + player.w / 2, player.y, 'Reeled in', '#9fd4e8');
    }
    player.useTimer = 0.3;
    return;
  }

  const spot = findCastSpot(game, player);
  if (!spot) {
    game.floatText(player.x + player.w / 2, player.y, 'No water in range', '#ff8b7d');
    player.useTimer = 0.35;
    return;
  }

  const bait = bestBait(player);
  if (!bait) {
    game.toast('You need bait — catch a bug first', 'bad');
    game.floatText(player.x + player.w / 2, player.y, 'No bait', '#ff8b7d');
    player.useTimer = 0.4;
    return;
  }

  const pool = game.world.liquid.poolSize(spot.tx, spot.ty, 60);
  // Wait time shortens with rod power and bait grade. A poor setup on a small
  // puddle is a genuinely slow way to fish, which is what makes upgrading feel
  // like it did something.
  const power = (rod.rod ? rod.rod.power : 1) + bait.grade * 0.5;
  const span = FISH_MAX_WAIT - FISH_MIN_WAIT;
  const wait = FISH_MIN_WAIT + Math.random() * span * (1 / (1 + power * 0.35));

  player.fishing = {
    tx: spot.tx, ty: spot.ty,
    x: spot.tx * TILE + TILE / 2, y: spot.ty * TILE + 2,
    timer: wait, biting: false, biteTimer: 0, bob: 0,
    pool, baitId: bait.id, baitGrade: bait.grade,
  };
  player.useTimer = 0.4;
  game.audio?.itemPickup?.();
  game.fx.ring(player.fishing.x, player.fishing.y, 'rgba(140,200,255,0.6)', 10, { life: 0.35, width: 1.5 });
}

/** Advance an active line. Called every step from the player update. */
export function tickFishing(game, player, dt) {
  const line = player.fishing;
  if (!line) return;

  // The line breaks if you wander off, or if the water goes away because
  // somebody drained it.
  const pcx = player.x + player.w / 2, pcy = player.y + player.h / 2;
  const far = Math.hypot(line.x - pcx, line.y - pcy) > (CAST_RANGE + 4) * TILE;
  const dry = game.world.liquid.get(line.tx, line.ty) <= 0;
  if (far || dry) {
    player.fishing = null;
    game.floatText(pcx, player.y, dry ? 'The water is gone' : 'Line snapped', '#ff8b7d');
    return;
  }

  line.bob += dt;
  if (line.biting) {
    line.biteTimer -= dt;
    if (line.biteTimer <= 0) {
      // Missed the window. The fish takes the bait with it.
      player.fishing = null;
      player.inventory.remove(line.baitId, 1);
      game.floatText(line.x, line.y - 8, 'It got away', '#ff8b7d');
    }
    return;
  }

  line.timer -= dt;
  if (line.timer <= 0) {
    line.biting = true;
    line.biteTimer = FISH_HOOK_WINDOW;
    game.floatText(line.x, line.y - 10, '!', '#ffe08a');
    game.fx.ring(line.x, line.y, 'rgba(255,224,138,0.9)', 14, { life: 0.3, width: 2 });
    game.audio?.itemPickup?.();
  }
}

/** Resolve a bite into a reward. */
function landCatch(game, player, rod, line) {
  player.fishing = null;
  player.inventory.remove(line.baitId, 1);

  // Quality 0..1 from rod power, bait grade and how much water is around.
  const rodPower = rod.rod ? rod.rod.power : 1;
  const poolScore = Math.min(1, line.pool / FISH_MIN_POOL / 3);
  const quality = Math.min(1,
    (rodPower - 1) / 2 * 0.45 + (line.baitGrade - 1) / 2 * 0.35 + poolScore * 0.20);
  const table = quality > 0.62 ? CATCH_TABLES.good
    : quality > 0.3 ? CATCH_TABLES.fair
      : CATCH_TABLES.poor;

  const pick = rollWeighted(table);
  const count = pick.item === 'rawFish' ? 1 + (Math.random() < 0.25 ? 1 : 0) : 1;
  const leftover = player.inventory.add(pick.item, count);
  if (leftover > 0) game.spawnDrop(line.x, line.y - 8, pick.item, leftover);

  const name = getItem(pick.item).name;
  game.floatText(line.x, line.y - 12, '+' + count + ' ' + name, '#7ee0c0');
  game.toast('Caught: ' + name, 'good');
  game.audio?.itemPickup?.();
  game.fx.burst(line.x, line.y, '#8fb8d8', 8, { speed: 70, life: 0.4, size: 2 });
  game.onFishCaught && game.onFishCaught(pick.item);
  game.markDirty();
}

/** Open a crate from the inventory. Rolls one stack from the crate's table. */
export function openCrate(game, player, index, def) {
  const table = CRATE_TABLES[def.id];
  if (!table) return false;
  if (!player.inventory.removeAt(index, 1)) return false;

  // Crates give two rolls, so opening one always feels like an event rather
  // than like picking up a single ore.
  const rolls = def.id === 'aetherCrate' ? 3 : 2;
  const got = [];
  for (let i = 0; i < rolls; i++) {
    const pick = rollWeighted(table);
    const n = pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1));
    if (n <= 0) continue;
    const leftover = player.inventory.add(pick.item, n);
    if (leftover > 0) game.spawnDrop(player.x, player.y, pick.item, leftover);
    got.push(n + ' ' + getItem(pick.item).name);
  }
  game.toast('Crate: ' + got.join(', '), 'good');
  game.addHitParticles(player.x + player.w / 2, player.y + player.h / 2, def.color, 12);
  game.audio?.coin?.();
  game.onCrateOpened && game.onCrateOpened(def.id);
  game.markDirty();
  return true;
}

// Nearest water surface tile toward the aim point that the player can reach.
function findCastSpot(game, player) {
  const liq = game.world.liquid;
  if (!liq) return null;
  const s = game.input.state;
  const aimTx = Math.floor(s.aimX / TILE), aimTy = Math.floor(s.aimY / TILE);
  const pcx = (player.x + player.w / 2) / TILE, pcy = (player.y + player.h / 2) / TILE;

  let best = null, bestD = Infinity;
  for (let dy = -4; dy <= 8; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const tx = aimTx + dx, ty = aimTy + dy;
      if (!liq.inBounds(tx, ty)) continue;
      if (liq.get(tx, ty) <= 0) continue;
      // The bobber wants the *surface* of the water, not a submerged cell.
      if (liq.get(tx, ty - 1) > 0) continue;
      const ddx = tx + 0.5 - pcx, ddy = ty + 0.5 - pcy;
      const d = ddx * ddx + ddy * ddy;
      if (d > CAST_RANGE * CAST_RANGE) continue;
      // Prefer the spot nearest where the player actually pointed.
      const aimD = dx * dx + dy * dy;
      if (aimD < bestD) { bestD = aimD; best = { tx, ty }; }
    }
  }
  if (!best) return null;
  if (liq.poolSize(best.tx, best.ty, FISH_MIN_POOL) < 4) return null;
  return best;
}

function rollWeighted(table) {
  let total = 0;
  for (const e of table) total += e.weight;
  let r = Math.random() * total;
  for (const e of table) { r -= e.weight; if (r <= 0) return e; }
  return table[table.length - 1];
}
