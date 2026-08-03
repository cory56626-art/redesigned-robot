// Summoner Realms — runtime world: tile grid, wall grid, collision, mining,
// lighting, and the edit diffs that get saved.
import { WORLD_H, TILE, UNDERGROUND_Y, CAVERN_Y } from '../config.js?v=prehardmode-mech-1';
import { T, tileDef, isSolid, tileLight, isLegacyOreTile } from './tiles.js?v=prehardmode-mech-1';
import { W, hasWall, wallBlastResist } from './walls.js?v=prehardmode-mech-1';
import { SH, shapeContains, surfaceOffset, fillsTop } from './shapes.js?v=prehardmode-mech-1';
import { LiquidGrid } from './liquid.js?v=prehardmode-mech-1';
import { BIOME_ORDER } from './biomes.js?v=prehardmode-mech-1';
import { generateWorld } from './worldgen.js?v=prehardmode-mech-1';

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    const g = generateWorld(this.seed);
    this.width = g.width;
    this.height = g.height;
    this.tiles = g.tiles;
    this.walls = g.walls;
    // Per-tile block shape (the hammer layer). Natural terrain is all FULL, so
    // a fresh world's shape buffer is entirely zero.
    this.shapes = new Uint8Array(this.width * this.height);
    this.surface = g.surface;
    this.biomeMap = g.biomeMap;
    this.biomeBands = g.biomeBands;
    this.spawnTx = g.spawnTx;
    this.spawnX = g.spawnX;
    this.spawnY = g.spawnY;
    // Player edits, keyed by flat index so repeated edits to one tile collapse.
    this.diffs = new Map();      // index -> tileId
    this.wallDiffs = new Map();  // index -> wallId
    this.shapeDiffs = new Map(); // index -> shapeId
    this.mineProgress = new Map(); // index -> accumulated mining amount
    // Runtime state for wall-mounted dart traps. The trap itself remains a
    // normal tile, so breaking it/opening a save stays compatible with world
    // diffs; only its short cooldown/telegraph is transient.
    this.dartTraps = new Map();
    this._rebuildDartTraps();
    this.topSolid = new Int32Array(this.width);
    this._recomputeAllTopSolid();
    // Water. Created after the grids exist because it reads them, and seeded
    // with the pools worldgen carved so natural lakes don't count as edits.
    this.liquid = new LiquidGrid(this);
    this.liquid.seedFrom(g.liquid);
    // Reusable light buffer.
    this._lightBuf = new Float32Array(1);
  }

  index(tx, ty) { return ty * this.width + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height; }

  get(tx, ty) {
    if (!this.inBounds(tx, ty)) return T.STONE; // out of bounds = solid wall
    return this.tiles[this.index(tx, ty)];
  }

  // Set a tile. record=true adds to save diffs. Updates the lighting column.
  set(tx, ty, id, record = true) {
    if (!this.inBounds(tx, ty)) return;
    // Only the retired pre-reset ore IDs are invalid in a saved edit. The new
    // pre-Hardmode ore tiles are real terrain and must survive edits/sync.
    if (isLegacyOreTile(id)) id = T.AIR;
    const i = this.index(tx, ty);
    const previous = this.tiles[i];
    if (previous === id) return;
    this.tiles[i] = id;
    this._syncDartTrap(i, tx, ty, previous, id);
    if (record) this.diffs.set(i, id);
    this.mineProgress.delete(i);
    // A tile losing its identity loses its shape with it, otherwise mining a
    // sloped block and placing a new one there would inherit the old slope.
    if (this.shapes[i] !== SH.FULL) {
      this.shapes[i] = SH.FULL;
      if (record) this.shapeDiffs.set(i, SH.FULL);
    }
    this._recomputeTopSolidColumn(tx);
    if (this.liquid) this.liquid.onTileChanged(tx, ty);
  }

  _rebuildDartTraps() {
    this.dartTraps.clear();
    for (let i = 0; i < this.tiles.length; i++) {
      const id = this.tiles[i];
      if (!tileDef(id).dartTrap) continue;
      this._syncDartTrap(i, i % this.width, (i / this.width) | 0, T.AIR, id);
    }
  }

  _syncDartTrap(index, tx, ty, previous, next) {
    if (!this.dartTraps) return;
    if (tileDef(previous).dartTrap) this.dartTraps.delete(index);
    const dir = tileDef(next).dartTrap;
    if (!dir) return;
    this.dartTraps.set(index, { tx, ty, dir, cooldown: 0.65, charge: 0 });
  }

  // ---- Block shapes (hammer) ----
  getShape(tx, ty) {
    if (!this.inBounds(tx, ty)) return SH.FULL;
    return this.shapes[this.index(tx, ty)];
  }
  setShape(tx, ty, shape, record = true) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    if (this.shapes[i] === shape) return;
    this.shapes[i] = shape;
    if (record) this.shapeDiffs.set(i, shape);
    this._recomputeTopSolidColumn(tx);
    if (this.liquid) this.liquid.onTileChanged(tx, ty);
  }

  // True when a point given in world pixels is inside solid material, shape
  // included. This is the primitive the collision resolver is built on.
  pointInSolid(wx, wy) {
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    if (!this.isSolidAt(tx, ty)) return false;
    const shape = this.getShape(tx, ty);
    if (shape === SH.FULL) return true;
    return shapeContains(shape, (wx / TILE) - tx, (wy / TILE) - ty);
  }

  // Y in world pixels of the walkable surface of the tile at (tx,ty), for an
  // entity whose feet are at world-x `wx`. Returns null when there is nothing
  // to stand on there. Slopes return a height part-way up the tile, which is
  // what lets the player walk up a ramp instead of stepping onto it.
  surfaceYAt(tx, ty, wx) {
    if (!this.isSolidAt(tx, ty)) return null;
    const shape = this.getShape(tx, ty);
    if (!fillsTop(shape) && shape !== SH.HALF_BOTTOM) return null;
    const fx = clamp01((wx / TILE) - tx);
    const off = surfaceOffset(shape, fx);
    if (off >= 1) return null;
    return (ty + off) * TILE;
  }

  // ---- Background walls ----
  getWall(tx, ty) {
    if (!this.inBounds(tx, ty)) return W.NONE;
    return this.walls[this.index(tx, ty)];
  }
  hasWallAt(tx, ty) { return hasWall(this.getWall(tx, ty)); }
  setWall(tx, ty, id, record = true) {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    if (this.walls[i] === id) return;
    this.walls[i] = id;
    if (record) this.wallDiffs.set(i, id);
  }
  // Explosions are currently the only thing that removes walls; `power` is the
  // blast strength (see tiles.js blastResist).
  breakWall(tx, ty, power) {
    const id = this.getWall(tx, ty);
    if (!hasWall(id) || wallBlastResist(id) > power) return false;
    this.setWall(tx, ty, W.NONE);
    return true;
  }

  isSolidAt(tx, ty) { return isSolid(this.get(tx, ty)); }

  // Solid *and* shaped full, i.e. a tile that blocks its whole cell. Used where
  // a cheap conservative answer is wanted (navigation, spawning).
  isFullSolidAt(tx, ty) {
    return this.isSolidAt(tx, ty) && this.getShape(tx, ty) === SH.FULL;
  }

  // True if a straight line between two world-pixel points crosses no solid
  // tile. Used by minions/AI so they don't target through walls, and by melee
  // so a sword can't reach through rock.
  hasLineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(d / (TILE * 0.5)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.pointInSolid(x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  }

  // Rectangle (world px) vs solid tiles. Shape-aware: a rectangle overlapping
  // only the empty half of a half-block or the open side of a slope does not
  // collide, which is what makes sculpted terrain walkable.
  rectHitsSolid(x, y, w, h) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.isSolidAt(tx, ty)) continue;
        const shape = this.getShape(tx, ty);
        if (shape === SH.FULL) return true;
        if (this._shapeOverlapsRect(shape, tx, ty, x, y, w, h)) return true;
      }
    }
    return false;
  }

  // Sample the shaped part of one tile against a rectangle. A handful of
  // samples across the overlap is plenty at tile scale and avoids a per-shape
  // polygon clip.
  _shapeOverlapsRect(shape, tx, ty, x, y, w, h) {
    const tileX = tx * TILE, tileY = ty * TILE;
    const ox0 = Math.max(x, tileX), ox1 = Math.min(x + w, tileX + TILE);
    const oy0 = Math.max(y, tileY), oy1 = Math.min(y + h, tileY + TILE);
    if (ox1 <= ox0 || oy1 <= oy0) return false;
    const SAMPLES = 4;
    for (let i = 0; i <= SAMPLES; i++) {
      const sx = ox0 + ((ox1 - ox0) * i) / SAMPLES;
      const fx = clamp01((sx - tileX) / TILE);
      for (let j = 0; j <= SAMPLES; j++) {
        const sy = oy0 + ((oy1 - oy0) * j) / SAMPLES;
        const fy = clamp01((sy - tileY) / TILE);
        if (shapeContains(shape, fx, fy)) return true;
      }
    }
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

  // Biome at a tile position. Below the underground line, depth wins; above it,
  // the generated surface band map decides (there is no hard x split any more).
  biomeAt(tx, ty) {
    if (ty >= UNDERGROUND_Y) return ty >= CAVERN_Y ? 'cavern' : 'underground';
    return this.surfaceBiomeAt(tx);
  }

  surfaceBiomeAt(tx) {
    const x = Math.max(0, Math.min(this.width - 1, tx | 0));
    return BIOME_ORDER[this.biomeMap[x]] || 'forest';
  }

  // Middle of the widest run of a surface biome — used by /teleport and by the
  // Guide when it points you somewhere.
  findBiomeColumn(key) {
    const want = BIOME_ORDER.indexOf(key);
    if (want < 0) return this.spawnTx;
    let best = null, start = -1;
    for (let x = 0; x <= this.width; x++) {
      const match = x < this.width && this.biomeMap[x] === want;
      if (match && start < 0) start = x;
      else if (!match && start >= 0) {
        if (!best || x - start > best.x1 - best.x0) best = { x0: start, x1: x };
        start = -1;
      }
    }
    return best ? Math.floor((best.x0 + best.x1) / 2) : this.spawnTx;
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
  // of {tx,ty,level}. Returns Float32Array(cols*rows), AMBIENT_FLOOR..1.
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
          const i = this.index(tx, ty);
          const id = this.tiles[i];
          seed = tileLight(id);
          // Daylight reaches open air only where there is nothing solid above it
          // *and* no background wall behind it. A walled-off pocket stays dark
          // even near the surface, which is what makes caves feel enclosed.
          if (ty < this.topSolid[tx] && !isSolid(id) && !hasWall(this.walls[i])) {
            seed = Math.max(seed, dayLevel);
          }
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

  // ---- Save/load diffs ----
  // v2 stores (x, y, id) triples so a world can change size without a saved
  // build landing in the wrong place. v1 stored flat indices; see save.js for
  // the migration, which converts them using the old world width.
  getDiffArray() {
    const out = [];
    for (const [i, id] of this.diffs) out.push(i % this.width, (i / this.width) | 0, id);
    return out;
  }
  getWallDiffArray() {
    const out = [];
    for (const [i, id] of this.wallDiffs) out.push(i % this.width, (i / this.width) | 0, id);
    return out;
  }
  getShapeDiffArray() {
    const out = [];
    for (const [i, id] of this.shapeDiffs) out.push(i % this.width, (i / this.width) | 0, id);
    return out;
  }

  applyDiffArray(arr) {
    if (!arr) return;
    for (let k = 0; k + 2 < arr.length; k += 3) {
      const tx = arr[k], ty = arr[k + 1], rawId = arr[k + 2];
      if (!this.inBounds(tx, ty)) continue;
      const id = isLegacyOreTile(rawId) ? T.AIR : rawId;
      const i = this.index(tx, ty);
      this.tiles[i] = id;
      this.diffs.set(i, id);
    }
    this._recomputeAllTopSolid();
  }

  applyWallDiffArray(arr) {
    if (!arr) return;
    for (let k = 0; k + 2 < arr.length; k += 3) {
      const tx = arr[k], ty = arr[k + 1], id = arr[k + 2];
      if (!this.inBounds(tx, ty)) continue;
      const i = this.index(tx, ty);
      this.walls[i] = id;
      this.wallDiffs.set(i, id);
    }
  }

  applyLiquidDiffArray(arr) { this.liquid.applyDiffArray(arr); }

  applyShapeDiffArray(arr) {
    if (!arr) return;
    for (let k = 0; k + 2 < arr.length; k += 3) {
      const tx = arr[k], ty = arr[k + 1], id = arr[k + 2];
      if (!this.inBounds(tx, ty)) continue;
      const i = this.index(tx, ty);
      this.shapes[i] = id;
      this.shapeDiffs.set(i, id);
    }
    this._recomputeAllTopSolid();
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
