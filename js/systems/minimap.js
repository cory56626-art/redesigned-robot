// Summoner Realms — minimap.
//
// Keeps a 1px-per-tile raster of the world plus a one-bit-per-tile "explored"
// mask, and repaints only what changed. A full 700x260 world is 182,000 cells,
// so redrawing all of it every frame is out of the question — instead the map
// is divided into chunks, and a chunk is only re-rastered when a tile inside it
// is edited or when new ground inside it is revealed.
//
// Fog of war is the point: the map starts black and fills in as you travel, so
// the layout of the caverns is something you earn rather than something you are
// handed at world creation.
import { TILE, WORLD_W, WORLD_H } from '../config.js?v=realms-qor-47';
import { T, TILES } from '../world/tiles.js?v=realms-qor-47';
import { WALLS } from '../world/walls.js?v=realms-qor-47';

// Tiles per chunk edge. 32 keeps the repaint budget small while making the
// dirty set cheap to iterate (a 700x260 world is only ~198 chunks).
const CHUNK = 32;
// Chunks re-rastered per frame. Editing a tile only ever dirties one chunk, so
// this is really a cap on how fast a big newly-revealed area paints in.
const CHUNK_BUDGET = 6;
// How far the map reveals around the player, in tiles, beyond the visible view.
const REVEAL_MARGIN = 6;

// Parse '#rrggbb' once per distinct colour.
const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  const h = hex.replace('#', '');
  v = [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
  rgbCache.set(hex, v);
  return v;
}

export class Minimap {
  constructor() {
    this.width = WORLD_W;
    this.height = WORLD_H;
    this.canvas = null;
    this.ctx = null;
    this.img = null;
    this.explored = null;
    this.dirty = new Set();
    this.chunksX = Math.ceil(WORLD_W / CHUNK);
    this.chunksY = Math.ceil(WORLD_H / CHUNK);
    this._revealTimer = 0;
  }

  // Called whenever a world is created or loaded.
  attach(world) {
    this.width = world.width;
    this.height = world.height;
    this.chunksX = Math.ceil(this.width / CHUNK);
    this.chunksY = Math.ceil(this.height / CHUNK);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.width, this.height);
    if (!this.explored || this.explored.length !== this._maskLen()) {
      this.explored = new Uint8Array(this._maskLen());
    }
    this.dirty.clear();
    for (let i = 0; i < this.chunksX * this.chunksY; i++) this.dirty.add(i);
    // Paint everything already known in one go, so a loaded save shows its map
    // immediately instead of trickling in over thirty frames.
    this.flush(world, Infinity);
  }

  _maskLen() { return Math.ceil((this.width * this.height) / 8); }

  isExplored(tx, ty) {
    const i = ty * this.width + tx;
    return (this.explored[i >> 3] >> (i & 7)) & 1;
  }

  _setExplored(tx, ty) {
    const i = ty * this.width + tx;
    const byte = i >> 3, bit = 1 << (i & 7);
    if (this.explored[byte] & bit) return false;
    this.explored[byte] |= bit;
    return true;
  }

  // Mark a chunk for re-raster. Called by World.set through the game.
  markTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return;
    this.dirty.add(((ty / CHUNK) | 0) * this.chunksX + ((tx / CHUNK) | 0));
  }

  // Reveal the rectangle the player can currently see, plus a margin.
  revealView(camera) {
    const x0 = Math.max(0, Math.floor((camera.x - camera.vw / 2) / TILE) - REVEAL_MARGIN);
    const x1 = Math.min(this.width - 1, Math.ceil((camera.x + camera.vw / 2) / TILE) + REVEAL_MARGIN);
    const y0 = Math.max(0, Math.floor((camera.y - camera.vh / 2) / TILE) - REVEAL_MARGIN);
    const y1 = Math.min(this.height - 1, Math.ceil((camera.y + camera.vh / 2) / TILE) + REVEAL_MARGIN);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this._setExplored(tx, ty)) this.markTile(tx, ty);
      }
    }
  }

  update(dt, game) {
    if (!this.canvas || !game.world) return;
    // Revealing is a rectangle scan; there is no need to run it every frame.
    this._revealTimer -= dt;
    if (this._revealTimer <= 0) {
      this._revealTimer = 0.12;
      this.revealView(game.camera);
    }
    this.flush(game.world, CHUNK_BUDGET);
  }

  // Re-raster up to `budget` dirty chunks.
  flush(world, budget) {
    if (!this.dirty.size) return;
    let n = 0;
    for (const key of this.dirty) {
      this._paintChunk(world, key);
      this.dirty.delete(key);
      if (++n >= budget) break;
    }
  }

  _paintChunk(world, key) {
    const cx = (key % this.chunksX) | 0;
    const cy = ((key / this.chunksX) | 0);
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const x1 = Math.min(this.width, x0 + CHUNK), y1 = Math.min(this.height, y0 + CHUNK);
    const data = this.img.data;

    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const o = (ty * this.width + tx) * 4;
        if (!this.isExplored(tx, ty)) { data[o + 3] = 0; continue; }
        const id = world.get(tx, ty);
        const def = TILES[id];
        let c = null, dim = 1;
        if (id !== T.AIR && def && def.color) {
          c = def.color;
        } else {
          // Open space: show the wall behind it, darkened, so caves read as
          // enclosed rather than as holes into the sky. T.AIR has no colour and
          // W.NONE's colour is null, hence both fallbacks.
          const wd = WALLS[world.getWall(tx, ty)];
          if (wd && wd.color) { c = wd.color; dim = 0.55; }
        }
        if (!c) { // genuinely open sky
          data[o] = 26; data[o + 1] = 34; data[o + 2] = 56; data[o + 3] = 190;
          continue;
        }
        const v = rgb(c);
        data[o] = v[0] * dim;
        data[o + 1] = v[1] * dim;
        data[o + 2] = v[2] * dim;
        data[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }

  // ---- Persistence ----
  // A raw byte-per-tile array would be ~1MB of JSON and risks the localStorage
  // quota. One bit per tile is ~22KB, and base64 keeps it JSON-safe at ~30KB.
  serialize() {
    if (!this.explored) return null;
    return { w: this.width, h: this.height, bits: encodeBits(this.explored) };
  }

  deserialize(data) {
    const len = this._maskLen();
    if (!data || !data.bits || data.w !== this.width || data.h !== this.height) {
      this.explored = new Uint8Array(len);
      return;
    }
    this.explored = decodeBits(data.bits, len);
  }
}

export function encodeBits(bits) {
  let s = '';
  // Chunked so the argument list never overflows the call stack.
  const STEP = 0x8000;
  for (let i = 0; i < bits.length; i += STEP) {
    s += String.fromCharCode.apply(null, bits.subarray(i, i + STEP));
  }
  return btoa(s);
}

export function decodeBits(str, len) {
  const out = new Uint8Array(len);
  try {
    const bin = atob(str);
    for (let i = 0, n = Math.min(len, bin.length); i < n; i++) out[i] = bin.charCodeAt(i);
  } catch (_) { /* corrupt payload: start from an unexplored map */ }
  return out;
}
