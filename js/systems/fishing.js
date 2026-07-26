// Summoner Realms — fishing.
//
// One cast at a time per player. The bobber is a small entity that arcs out to
// where you aimed, and only settles if it lands in water; anything else is a
// failed cast you can immediately re-throw. Once it is floating, a bite timer
// runs — shortened by better bait — and a bite opens a short window in which
// reeling in lands the catch. Reel outside that window and you get nothing but
// your bait back.
//
// The host is authoritative for bites and loot rolls, so two players fishing
// the same pool cannot roll different results for the same cast.
import { TILE } from '../config.js?v=realms-qor-45';
import { item as getItem } from '../data/items.js?v=realms-qor-45';

// Seconds of waiting before a bite, before bait is taken into account.
const BITE_MIN = 3.2;
const BITE_MAX = 11;
// How long the fish stays on after it bites.
const HOOK_WINDOW = 0.9;
// Cast physics.
const CAST_SPEED = 300;
const CAST_GRAVITY = 620;

// Catch tables by depth. `w` is relative weight.
const SURFACE_CATCH = [
  { id: 'minnow', w: 34 },
  { id: 'tangledLine', w: 22 },
  { id: 'goldfin', w: 4 },
  { id: 'woodCrate', w: 9 },
  { id: 'ironCrate', w: 2 },
];
const DEEP_CATCH = [
  { id: 'cavefish', w: 32 },
  { id: 'minnow', w: 14 },
  { id: 'tangledLine', w: 16 },
  { id: 'goldfin', w: 8 },
  { id: 'woodCrate', w: 10 },
  { id: 'ironCrate', w: 7 },
  { id: 'goldCrate', w: 3 },
];

export class Bobber {
  constructor(owner, x, y, vx, vy) {
    this.ownerId = owner.id;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.w = 4; this.h = 4;
    this.settled = false;   // floating in water
    this.dead = false;
    this.biteTimer = 0;
    this.hookTimer = 0;     // >0 means a fish is on right now
    this.bobPhase = Math.random() * Math.PI * 2;
    this.life = 45;         // give up eventually so a forgotten cast cleans up
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    const world = game.world;

    if (!this.settled) {
      this.vy += CAST_GRAVITY * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
      if (!world.inBounds(tx, ty)) { this.dead = true; return; }
      if (world.isLiquidAt(tx, ty)) {
        // Settle at the surface of the pool rather than wherever it entered.
        let sy = ty;
        while (sy > 0 && world.isLiquidAt(tx, sy - 1)) sy--;
        this.settled = true;
        this.x = tx * TILE + TILE / 2;
        this.y = sy * TILE + 2;
        this.vx = this.vy = 0;
        this.biteTimer = this._rollBiteDelay(game);
        return;
      }
      // Hit ground or a wall without finding water: a failed cast.
      if (world.isSolidAt(tx, ty)) { this.dead = true; this.missed = true; }
      return;
    }

    this.bobPhase += dt * (this.hookTimer > 0 ? 14 : 2.2);
    if (this.hookTimer > 0) {
      this.hookTimer -= dt;
      // The window closed — the fish took the bait and left.
      if (this.hookTimer <= 0) {
        this.biteTimer = this._rollBiteDelay(game);
        this.lostIt = true;
      }
      return;
    }
    this.biteTimer -= dt;
    if (this.biteTimer <= 0) {
      this.hookTimer = HOOK_WINDOW;
      this.bit = true; // consumed by the game loop to toast/splash once
    }
  }

  _rollBiteDelay(game) {
    const power = this.baitPower || 1;
    // Better bait shortens the wait, with diminishing returns.
    const scale = 1 / (1 + (power - 1) * 0.45);
    return (BITE_MIN + Math.random() * (BITE_MAX - BITE_MIN)) * scale;
  }
}

// Is this item usable as bait?
export function baitPowerOf(item) { return item && item.bait ? item.bait : 0; }

// Find the best bait the player is carrying, preferring the weakest that still
// works so strong bait is saved for deliberate use.
export function findBait(player) {
  let best = null;
  for (let i = 0; i < player.inventory.slots.length; i++) {
    const st = player.inventory.slots[i];
    if (!st) continue;
    const def = getItem(st.id);
    const p = baitPowerOf(def);
    if (!p) continue;
    if (!best || p < best.power) best = { id: st.id, power: p };
  }
  return best;
}

// Roll a catch. Deeper water yields the better table.
export function rollCatch(game, bobber, baitPower) {
  const ty = Math.floor(bobber.y / TILE);
  const deep = ty > (game.world.surface ? game.world.surface[Math.floor(bobber.x / TILE)] + 20 : 100);
  const table = deep ? DEEP_CATCH : SURFACE_CATCH;
  // Bait tilts the roll toward the rarer end by re-rolling junk once.
  let pick = weighted(table);
  if (pick === 'tangledLine' && Math.random() < 0.25 * baitPower) pick = weighted(table);
  return pick;
}

function weighted(table) {
  let total = 0;
  for (const e of table) total += e.w;
  let r = Math.random() * total;
  for (const e of table) { r -= e.w; if (r <= 0) return e.id; }
  return table[table.length - 1].id;
}

// What a crate contains. Tier drives both the quantity and the ceiling.
const CRATE_LOOT = [
  [['cupriteOre', 8, 16], ['stone', 20, 40], ['healLesser', 1, 2], ['torch', 5, 12]],
  [['ironveinOre', 8, 18], ['cupriteBar', 2, 5], ['healLesser', 2, 3], ['aetherShard', 1, 2]],
  [['glimmerOre', 6, 14], ['aetheriteOre', 4, 9], ['ironveinBar', 3, 6], ['aetherShard', 2, 4]],
];

export function openCrate(game, player, item) {
  const tier = Math.max(0, Math.min(CRATE_LOOT.length - 1, item.crateTier || 0));
  const pool = CRATE_LOOT[tier];
  const rolls = 2 + Math.floor(Math.random() * 2);
  const got = [];
  const picked = new Set();
  for (let i = 0; i < rolls; i++) {
    const entry = pool[Math.floor(Math.random() * pool.length)];
    if (picked.has(entry[0])) continue;
    picked.add(entry[0]);
    const n = entry[1] + Math.floor(Math.random() * (entry[2] - entry[1] + 1));
    const leftover = player.inventory.add(entry[0], n);
    if (leftover > 0) game.spawnDrop(player.x, player.y, entry[0], leftover);
    got.push({ id: entry[0], n });
  }
  return got;
}
