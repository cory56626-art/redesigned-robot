// Summoner Realms — runtime world: tile grid, collision, mining, lighting, diffs.
import { WORLD_W, WORLD_H, TILE, UNDERGROUND_Y, CORRUPT_X, CAVERN_Y } from '../config.js';
import { T, TILES, tileDef, isSolid, tileLight } from './tiles.js';
import { generateWorld } from './worldgen.js';

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    const g = generateWorld(this.seed);
    this.width = g.width;
    this.height = g.height;
    this.tiles = g.tiles;
    this.surface = g.surface;
    this.spawnX = g.spawnX;
    this.spawnY = g.spawnY;
    this.diffs = new Map();      // index -> tileId (all player edits, for saving)
    this.mineProgress = new Map(); // index -> accumulated mining amount
    this.topSolid = new Int32Array(this.width);
    this._recomputeAllTopSolid();
    // Reusable light buffer.
    this._lightBuf = new Float32Array(1);
  }

  index(tx, ty) { return ty * this.width + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height; }

  get(tx, ty) {
    if (!this.inBounds(tx, ty)) return T.STONE; // out of bounds = solid wall
    return this.tiles[this.index(tx, ty)];
  }

  // Set a tile. record=true adds to save diffs. Updates lighting column.
  set(tx, ty, id, record = true) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    if (this.tiles[i] === id) return;
    this.tiles[i] = id;
    if (record) this.diffs.set(i, id);
    this.mineProgress.delete(i);
    this._recomputeTopSolidColumn(tx);
  }

  isSolidAt(tx, ty) { return isSolid(this.get(tx, ty)); }

  // True if a straight line between two world-pixel points crosses no solid
  // tile. Used by minions/AI so they don't target through walls.
  hasLineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(d / (TILE * 0.5)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidAt(Math.floor((x1 + dx * t) / TILE), Math.floor((y1 + dy * t) / TILE))) return false;
    }
    return true;
  }

  // Rectangle (world px) vs solid tiles.
  rectHitsSolid(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.isSolidAt(tx, ty)) return true;
    return false;
  }

  // Mining: add damage to a tile; returns null or {broken, id, drop, dropChance}.
  damageTile(tx, ty, amount, toolPower) {
    if (!this.inBounds(tx, ty)) return null;
    const id = this.get(tx, ty);
    const def = tileDef(id);
    if (id === T.AIR || !def.hardness) return null;
    const i = this.index(tx, ty);
    const effective = (toolPower >= (def.minPower || 0)) ? amount : amount * 0.12;
    const prog = (this.mineProgress.get(i) || 0) + effective;
    if (prog >= def.hardness) {
      this.mineProgress.delete(i);
      this.set(tx, ty, T.AIR);
      return { broken: true, id, drop: def.drop, dropChance: def.dropChance || 1 };
    }
    this.mineProgress.set(i, prog);
    return { broken: false, id, progress: prog / def.hardness };
  }

  miningRatio(tx, ty) {
    const i = this.index(tx, ty);
    const def = tileDef(this.get(tx, ty));
    if (!def.hardness) return 0;
    return (this.mineProgress.get(i) || 0) / def.hardness;
  }

  // Biome at a tile position (for teleport / spawning / music-less flavour).
  biomeAt(tx, ty) {
    if (ty >= UNDERGROUND_Y) return ty >= CAVERN_Y ? 'cavern' : 'underground';
    return tx >= CORRUPT_X ? 'corrupt' : 'forest';
  }

  surfaceY(tx) {
    tx = Math.max(0, Math.min(this.width - 1, tx | 0));
    return this.surface[tx];
  }

  // First non-solid tile y (from surface up) to safely place an entity.
  safeSpawnY(tx) {
    let ty = this.surfaceY(tx) - 1;
    while (ty > 2 && this.isSolidAt(tx, ty)) ty--;
    return ty;
  }

  // Pixel Y at which an entity of pixel-height h rests directly on the surface at
  // column tx (its feet on the first solid tile), so it spawns standing rather
  // than floating a few tiles up and dropping in.
  spawnPixelY(tx, h) {
    // Find the first solid tile at/under the safe air tile.
    let ty = this.safeSpawnY(tx);
    while (ty < this.height - 1 && !this.isSolidAt(tx, ty + 1)) ty++;
    return (ty + 1) * TILE - h - 1;
  }

  _recomputeAllTopSolid() {
    for (let x = 0; x < this.width; x++) this._recomputeTopSolidColumn(x);
  }
  _recomputeTopSolidColumn(x) {
    let y = 0;
    while (y < this.height && !isSolid(this.tiles[this.index(x, y)])) y++;
    this.topSolid[x] = y;
  }

  // Compute a light buffer for a viewport window. dayLevel 0..1, extraLights list
  // of {tx,ty,level}. Returns Float32Array(cols*rows), 0.05..1.
  computeLightWindow(tx0, ty0, cols, rows, dayLevel, extraLights) {
    const n = cols * rows;
    if (this._lightBuf.length !== n) this._lightBuf = new Float32Array(n);
    const buf = this._lightBuf;
    for (let j = 0; j < rows; j++) {
      const ty = ty0 + j;
      for (let ii = 0; ii < cols; ii++) {
        const tx = tx0 + ii;
        const k = j * cols + ii;
        let seed = 0;
        if (this.inBounds(tx, ty)) {
          const id = this.tiles[this.index(tx, ty)];
          seed = tileLight(id);
          if (ty < this.topSolid[tx] && !isSolid(id)) seed = Math.max(seed, dayLevel);
        } else if (ty < 0) {
          seed = dayLevel; // sky above the world
        }
        buf[k] = seed;
      }
    }
    if (extraLights) {
      for (const L of extraLights) {
        const ii = L.tx - tx0, j = L.ty - ty0;
        if (ii >= 0 && ii < cols && j >= 0 && j < rows) {
          const k = j * cols + ii;
          buf[k] = Math.max(buf[k], L.level);
        }
      }
    }
    // Relaxation passes (alternating direction) with solidity-based attenuation.
    // Solid tiles block light a little less than before and light spreads a bit
    // further, so caves and the underside of tree canopies stay *readable* dim
    // rather than dropping to unreadable pure black.
    const PASSES = 6;
    for (let p = 0; p < PASSES; p++) {
      const fwd = p % 2 === 0;
      for (let s = 0; s < n; s++) {
        const k = fwd ? s : (n - 1 - s);
        const j = (k / cols) | 0, ii = k - j * cols;
        const tx = tx0 + ii, ty = ty0 + j;
        const solid = this.inBounds(tx, ty) ? isSolid(this.tiles[this.index(tx, ty)]) : true;
        const att = solid ? 0.19 : 0.085;
        let l = buf[k];
        if (ii > 0) l = Math.max(l, buf[k - 1] - att);
        if (ii < cols - 1) l = Math.max(l, buf[k + 1] - att);
        if (j > 0) l = Math.max(l, buf[k - cols] - att);
        if (j < rows - 1) l = Math.max(l, buf[k + cols] - att);
        buf[k] = l;
      }
    }
    // AMBIENT_FLOOR keeps unlit terrain dimly visible instead of pure black.
    // Torches (light 0.95) and the player's own glow are still clearly brighter,
    // so lighting the dark still matters — you just aren't blind without it.
    const AMBIENT_FLOOR = 0.14;
    for (let k = 0; k < n; k++) buf[k] = Math.max(AMBIENT_FLOOR, Math.min(1, buf[k]));
    return buf;
  }

  // Save/load diffs.
  getDiffArray() {
    const out = [];
    for (const [i, id] of this.diffs) out.push(i, id);
    return out;
  }
  applyDiffArray(arr) {
    if (!arr) return;
    for (let k = 0; k < arr.length; k += 2) {
      const i = arr[k], id = arr[k + 1];
      this.tiles[i] = id;
      this.diffs.set(i, id);
    }
    this._recomputeAllTopSolid();
  }
}
