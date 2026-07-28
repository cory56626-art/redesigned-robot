// Summoner Realms — flowing water.
//
// Water is a per-tile level 0..LIQUID_MAX stored in a byte array parallel to
// the tile grid. It is simulated with an *active set*: only cells that were
// touched (and their neighbours) are considered each tick, so a settled world
// costs nothing per frame no matter how much water it contains. That is the
// difference between a liquid layer you can ship in a 700x260 world and one
// that eats the frame budget.
//
// The rules are deliberately simple and mass-conserving:
//
//   1. Water falls into the cell below if there is room.
//   2. Otherwise it levels out with its left and right neighbours.
//   3. Any cell that changes wakes itself and its four neighbours for the next
//      tick, so a change propagates outward until everything settles.
//
// Mining into a pool drains it because World.set wakes the tile it changed.
import { LIQUID_MAX, LIQUID_TICK, LIQUID_BUDGET, TILE } from '../config.js?v=snowy-taiga-underground-1';
import { isSolid } from './tiles.js?v=snowy-taiga-underground-1';
import { SH, shapeContains } from './shapes.js?v=snowy-taiga-underground-1';

export class LiquidGrid {
  constructor(world) {
    this.world = world;
    this.w = world.width;
    this.h = world.height;
    this.levels = new Uint8Array(this.w * this.h);
    // Player/world edits worth persisting. Natural pools regenerate from the
    // seed, so only deltas from the generated state are saved.
    this.diffs = new Map();
    this.active = new Set();
    this._next = new Set();
    this._acc = 0;
    // Set once worldgen has finished placing natural pools, so the fill pass
    // itself doesn't get recorded as a million player edits.
    this.recording = false;
  }

  index(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  get(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    return this.levels[this.index(tx, ty)];
  }

  // Fraction of a tile that is water, 0..1. Used by rendering and by the
  // submersion test.
  fill(tx, ty) { return this.get(tx, ty) / LIQUID_MAX; }

  set(tx, ty, level, record = this.recording) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    const v = Math.max(0, Math.min(LIQUID_MAX, level | 0));
    if (this.levels[i] === v) return;
    this.levels[i] = v;
    if (record) this.diffs.set(i, v);
    this.wake(tx, ty);
  }

  add(tx, ty, amount) {
    this.set(tx, ty, this.get(tx, ty) + amount);
  }

  // Mark a cell (and its neighbours) as worth simulating next tick.
  wake(tx, ty) {
    for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const x = tx + dx, y = ty + dy;
      if (this.inBounds(x, y)) this.active.add(this.index(x, y));
    }
  }

  // World.set/setShape call this so mining into a pool makes it flow again.
  onTileChanged(tx, ty) { this.wake(tx, ty); }

  // A tile blocks water when it is solid and fully shaped. Half blocks and
  // slopes hold a reduced amount, which is close enough at this scale and
  // avoids water vanishing into a sculpted floor.
  _blocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    return isSolid(this.world.tiles[this.index(tx, ty)]) &&
      this.world.shapes[this.index(tx, ty)] === SH.FULL;
  }

  // How much water a cell can hold — zero for solid rock, reduced for a
  // partially-filled sculpted tile.
  capacity(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    const i = this.index(tx, ty);
    if (!isSolid(this.world.tiles[i])) return LIQUID_MAX;
    const shape = this.world.shapes[i];
    if (shape === SH.FULL) return 0;
    // Sample the shape to estimate the free volume, rounded to a level.
    let free = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        if (!shapeContains(shape, (sx + 0.5) / 4, (sy + 0.5) / 4)) free++;
      }
    }
    return Math.round((free / 16) * LIQUID_MAX);
  }

  // Fixed-rate flow update, budgeted so a huge disturbance spreads over a few
  // ticks instead of stalling one frame.
  update(dt) {
    this._acc += dt;
    if (this._acc < LIQUID_TICK) return;
    this._acc = 0;
    if (!this.active.size) return;

    const cells = [...this.active];
    this.active.clear();
    // Bottom-up so water settles downward in a single pass rather than
    // shimmering between rows.
    cells.sort((a, b) => b - a);

    let processed = 0;
    for (const i of cells) {
      if (processed++ > LIQUID_BUDGET) { this.active.add(i); continue; }
      const tx = i % this.w, ty = (i / this.w) | 0;
      this._step(tx, ty);
    }
  }

  _step(tx, ty) {
    let level = this.levels[this.index(tx, ty)];
    if (level <= 0) return;

    // 1) Fall.
    const belowCap = this.capacity(tx, ty + 1);
    if (belowCap > 0) {
      const below = this.get(tx, ty + 1);
      const room = belowCap - below;
      if (room > 0) {
        const move = Math.min(room, level);
        this.set(tx, ty + 1, below + move);
        level -= move;
        this.set(tx, ty, level);
        if (level <= 0) return;
      }
    }

    // 2) Level out sideways. Moving at most half the difference keeps the
    //    surface from oscillating between two cells forever.
    for (const dx of Math.random() < 0.5 ? [-1, 1] : [1, -1]) {
      const nx = tx + dx;
      const cap = this.capacity(nx, ty);
      if (cap <= 0) continue;
      const other = this.get(nx, ty);
      const diff = level - other;
      if (diff <= 1) continue;
      const move = Math.min(Math.floor(diff / 2), cap - other);
      if (move <= 0) continue;
      this.set(nx, ty, other + move);
      level -= move;
      this.set(tx, ty, level);
      if (level <= 0) return;
    }

    // A cell with a single unit left and nowhere to go evaporates rather than
    // leaving a permanent one-pixel film that keeps waking its neighbours.
    if (level === 1 && this._blocked(tx, ty + 1)) {
      const l = this.get(tx - 1, ty), r = this.get(tx + 1, ty);
      if (l === 0 && r === 0) this.set(tx, ty, 0);
    }
  }

  // ---- Queries used by gameplay ----

  // Is a world-pixel rectangle mostly under water? Used for buoyancy and for
  // deciding whether the player is swimming.
  rectSubmerged(x, y, w, h) {
    const tx0 = Math.floor(x / TILE), tx1 = Math.floor((x + w - 0.001) / TILE);
    const ty0 = Math.floor(y / TILE), ty1 = Math.floor((y + h - 0.001) / TILE);
    let wet = 0, total = 0;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        total++;
        if (this.get(tx, ty) >= LIQUID_MAX / 2) wet++;
      }
    }
    return total > 0 && wet / total >= 0.5;
  }

  // Any water at all touching the rectangle — enough to splash, not enough to
  // swim in.
  rectTouchesWater(x, y, w, h) {
    const tx0 = Math.floor(x / TILE), tx1 = Math.floor((x + w - 0.001) / TILE);
    const ty0 = Math.floor(y / TILE), ty1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) if (this.get(tx, ty) > 0) return true;
    }
    return false;
  }

  // The topmost water tile in a column at or below `fromTy`, or null. Fishing
  // uses this to seat a bobber on the surface.
  surfaceAt(tx, fromTy, maxDepth = 40) {
    for (let ty = fromTy; ty < Math.min(this.h, fromTy + maxDepth); ty++) {
      if (this.get(tx, ty) > 0) return ty;
    }
    return null;
  }

  // How many connected water tiles surround (tx,ty), capped at `cap`. Fishing
  // uses this so a one-tile puddle is not as good as a lake.
  poolSize(tx, ty, cap = 40) {
    const seen = new Set();
    const q = [this.index(tx, ty)];
    seen.add(q[0]);
    let n = 0;
    while (q.length && n < cap) {
      const i = q.shift();
      const x = i % this.w, y = (i / this.w) | 0;
      if (this.get(x, y) <= 0) continue;
      n++;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.index(nx, ny);
        if (seen.has(ni)) continue;
        seen.add(ni);
        if (this.get(nx, ny) > 0) q.push(ni);
      }
    }
    return n;
  }

  // ---- Save/load ----
  getDiffArray() {
    const out = [];
    for (const [i, v] of this.diffs) out.push(i % this.w, (i / this.w) | 0, v);
    return out;
  }
  applyDiffArray(arr) {
    if (!arr) return;
    for (let k = 0; k + 2 < arr.length; k += 3) {
      const tx = arr[k], ty = arr[k + 1], v = arr[k + 2];
      if (!this.inBounds(tx, ty)) continue;
      const i = this.index(tx, ty);
      this.levels[i] = Math.max(0, Math.min(LIQUID_MAX, v | 0));
      this.diffs.set(i, this.levels[i]);
      this.wake(tx, ty);
    }
  }

  // Adopt the levels worldgen produced. Called once, before recording starts.
  seedFrom(levels) {
    if (levels && levels.length === this.levels.length) this.levels.set(levels);
    this.recording = true;
    this.active.clear();
  }
}
