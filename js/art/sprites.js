// Summoner Realms — procedural pixel art.
// All original: tile textures, tile framing, wall textures and item icons drawn
// to offscreen canvases. Entities (player/enemies/minions/bosses/projectiles)
// are drawn procedurally in the renderer. Nothing here is copied from any
// existing game.
//
// The important idea here is *framing*: a tile's appearance depends on its
// neighbours. A stone tile buried in stone is flat; one exposed to air gets a lit
// top, a shadowed underside and rimmed sides. That neighbour awareness — plus
// grass fringing down onto dirt and trunk/canopy shading — is most of what makes
// terrain read as terrain instead of a grid of coloured squares.
import { T, TILES, tileMat, isTree, isLeaf } from '../world/tiles.js?v=vespera-surface-5';
import { W, WALLS } from '../world/walls.js?v=vespera-surface-5';
import { mulberry32 } from '../utils.js?v=vespera-surface-5';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Adjust a hex colour lighter (+) or darker (-) by amt (0..1).
export function shade(hex, amt) {
  const h = hex.replace('#', '');
  let r = parseInt(h.substring(0, 2), 16);
  let g = parseInt(h.substring(2, 4), 16);
  let b = parseInt(h.substring(4, 6), 16);
  const f = amt < 0 ? 1 + amt : 1;
  const t = amt < 0 ? 0 : amt;
  r = Math.round((r * f) + 255 * t * (amt > 0 ? 1 : 0));
  g = Math.round((g * f) + 255 * t * (amt > 0 ? 1 : 0));
  b = Math.round((b * f) + 255 * t * (amt > 0 ? 1 : 0));
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

const TS = 16; // tile sprite size
const IS = 20; // item icon size

// Neighbour mask bits. "Set" means that neighbour merges with this tile — same
// material group, so no edge is drawn between them.
export const N = 1, E = 2, S = 4, WBIT = 8, NE = 16, SE = 32, SW = 64, NW = 128;

class SpriteBank {
  constructor() {
    this.tileCache = new Map();   // base texture per tile id
    this.framedCache = new Map(); // (id, mask, flags) -> framed texture
    this.wallCache = new Map();   // (wallId, mask) -> wall texture
    this.treeCache = new Map();   // (id, mask, variant) -> trunk/canopy texture
    this.iconCache = new Map();
    this.ready = false;
  }

  init() {
    for (const idStr in TILES) {
      const id = +idStr;
      if (id === T.AIR) continue;
      this.tileCache.set(id, this._buildTile(id));
    }
    this.ready = true;
  }

  getTile(id) {
    if (!this.tileCache.has(id)) this.tileCache.set(id, this._buildTile(id));
    return this.tileCache.get(id);
  }

  // ---- Framed terrain ----
  // `grassAbove` is the tile id of a grass-topped tile sitting directly above,
  // or 0. It is part of the cache key so blighted grass fringes violet onto the
  // dirt below it while ordinary grass fringes green.
  getFramed(id, mask, grassAbove = 0) {
    const key = (id << 16) | ((grassAbove & 0xff) << 8) | (mask & 0xff);
    let c = this.framedCache.get(key);
    if (!c) { c = this._buildFramed(id, mask, grassAbove); this.framedCache.set(key, c); }
    return c;
  }

  _buildFramed(id, mask, grassAbove) {
    const def = TILES[id];
    const base = (def && def.color) || '#888';
    const src = this.getTile(id);
    const c = makeCanvas(TS, TS);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);

    const open = (bit) => (mask & bit) === 0;
    const lightEdge = shade(base, 0.26);
    const brightEdge = shade(base, 0.42);
    const darkEdge = shade(base, -0.34);
    const deepEdge = shade(base, -0.5);

    // Only *exposed* faces get shading. Shading an internal join too would put a
    // dark band along the top of every buried tile, which tiles into visible
    // brick courses across a solid mass — obvious on light terrain like snow.
    if (mask === 0xff) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(0, 0, TS, TS);
      return c;
    }

    // Light falls from above and slightly to the left: lit top and left faces,
    // shadowed underside and right face.
    if (open(N)) {
      ctx.fillStyle = brightEdge; ctx.fillRect(0, 0, TS, 1);
      ctx.fillStyle = lightEdge; ctx.fillRect(0, 1, TS, 1);
    }
    if (open(WBIT)) { ctx.fillStyle = lightEdge; ctx.fillRect(0, 0, 1, TS); }
    if (open(E)) { ctx.fillStyle = darkEdge; ctx.fillRect(TS - 1, 0, 1, TS); }
    if (open(S)) {
      ctx.fillStyle = darkEdge; ctx.fillRect(0, TS - 1, TS, 1);
      ctx.fillStyle = deepEdge; ctx.fillRect(0, TS - 2, TS, 1);
    }

    // Inner corners: where two sides merge but the diagonal between them does
    // not, a small notch of shadow sells the concave joint.
    const notch = 'rgba(0,0,0,0.26)';
    if (!open(N) && !open(WBIT) && open(NW)) { ctx.fillStyle = notch; ctx.fillRect(0, 0, 3, 3); }
    if (!open(N) && !open(E) && open(NE)) { ctx.fillStyle = notch; ctx.fillRect(TS - 3, 0, 3, 3); }
    if (!open(S) && !open(WBIT) && open(SW)) { ctx.fillStyle = notch; ctx.fillRect(0, TS - 3, 3, 3); }
    if (!open(S) && !open(E) && open(SE)) { ctx.fillStyle = notch; ctx.fillRect(TS - 3, TS - 3, 3, 3); }

    // Grass fringes down onto whatever is beneath it, the way Terraria's grass
    // overhangs dirt, so the boundary is organic rather than a ruled line.
    if (grassAbove) {
      const g = TILES[grassAbove];
      ctx.fillStyle = (g && g.grass) || '#5fae4a';
      const teeth = [3, 1, 4, 2, 3, 1, 2, 4];
      for (let x = 0; x < TS; x += 2) {
        const d = teeth[(x >> 1) % teeth.length];
        ctx.fillRect(x, 0, 2, d);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 0; x < TS; x += 2) ctx.fillRect(x, ((teeth[(x >> 1) % teeth.length]) - 1), 2, 1);
    }

    // A grass tile's own top edge is ragged, not a straight line.
    if (def && def.grass && open(N)) {
      ctx.clearRect(0, 0, TS, 2);
      ctx.fillStyle = shade(def.grass, 0.18);
      const teeth = [2, 1, 2, 0, 1, 2, 1, 0];
      for (let x = 0; x < TS; x += 2) ctx.fillRect(x, teeth[(x >> 1) % teeth.length], 2, 3 - teeth[(x >> 1) % teeth.length]);
      ctx.fillStyle = def.grass;
      ctx.fillRect(0, 3, TS, 2);
    }
    return c;
  }

  // ---- Background walls ----
  // Walls are drawn behind non-solid tiles. They are darker and lower contrast
  // than the foreground, with a recessed rim wherever they meet open air, so the
  // eye reads them as "behind" rather than "a different block".
  getWall(id, mask) {
    const key = (id << 8) | (mask & 0xff);
    let c = this.wallCache.get(key);
    if (!c) { c = this._buildWall(id, mask); this.wallCache.set(key, c); }
    return c;
  }

  _buildWall(id, mask) {
    const def = WALLS[id] || WALLS[W.STONE];
    const base = def.color || '#33373f';
    const c = makeCanvas(TS, TS);
    const ctx = c.getContext('2d');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TS, TS);
    const rand = mulberry32(((id + 7) * 2654435761) >>> 0);
    // Coarse mottling — bigger and softer than the foreground speckle so walls
    // never compete with the tiles in front of them for attention.
    for (let i = 0; i < 18; i++) {
      const x = (rand() * TS) | 0, y = (rand() * TS) | 0;
      const s = 1 + ((rand() * 3) | 0);
      ctx.fillStyle = rand() < 0.5 ? shade(base, -0.16) : shade(base, 0.12);
      ctx.fillRect(x, y, s, s);
    }
    // Recessed rim where the wall meets open air.
    const open = (bit) => (mask & bit) === 0;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    if (open(N)) ctx.fillRect(0, 0, TS, 2);
    if (open(WBIT)) ctx.fillRect(0, 0, 2, TS);
    if (open(E)) ctx.fillRect(TS - 2, 0, 2, TS);
    if (open(S)) ctx.fillRect(0, TS - 2, TS, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    if (open(N)) ctx.fillRect(0, 2, TS, 1);
    return c;
  }

  // ---- Trees ----
  // Trunks and canopies are shaded rather than flat-filled, which is what makes
  // a tree read as a round trunk under a layered canopy instead of a brown line
  // with a green blob on top.
  //
  // Trunk mask: N/S = trunk continues that way. variant 0..3 selects bark
  // detail and which side (if any) grows a branch stub.
  getTrunk(id, mask, variant) {
    const key = (1 << 24) | (id << 12) | ((variant & 3) << 8) | (mask & 0xff);
    let c = this.treeCache.get(key);
    if (!c) { c = this._buildTrunk(id, mask, variant); this.treeCache.set(key, c); }
    return c;
  }

  _buildTrunk(id, mask, variant) {
    const def = TILES[id] || {};
    const base = def.color || '#7a5228';
    const c = makeCanvas(TS, TS);
    const ctx = c.getContext('2d');
    const hasAbove = (mask & N) !== 0;
    const hasBelow = (mask & S) !== 0;

    // Cylinder shading: a horizontal light-to-dark ramp across the trunk.
    const x0 = 4, wdt = 8;
    const g = ctx.createLinearGradient(x0, 0, x0 + wdt, 0);
    g.addColorStop(0, shade(base, -0.12));
    g.addColorStop(0.28, shade(base, 0.24));
    g.addColorStop(0.62, base);
    g.addColorStop(1, shade(base, -0.38));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, wdt, TS);

    // Bark: short vertical striations, deterministic per variant.
    const rand = mulberry32(((id * 31 + variant * 977 + 5) * 2654435761) >>> 0);
    ctx.fillStyle = shade(base, -0.3);
    for (let i = 0; i < 5; i++) {
      const bx = x0 + 1 + ((rand() * (wdt - 2)) | 0);
      const by = (rand() * (TS - 5)) | 0;
      ctx.fillRect(bx, by, 1, 3 + ((rand() * 3) | 0));
    }
    ctx.fillStyle = shade(base, 0.3);
    ctx.fillRect(x0 + 2, 0, 1, TS);

    // Roots: the lowest trunk tile flares out into the ground.
    if (!hasBelow) {
      ctx.fillStyle = shade(base, -0.18);
      ctx.beginPath();
      ctx.moveTo(x0, TS - 6); ctx.lineTo(0, TS); ctx.lineTo(x0 + 3, TS); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x0 + wdt, TS - 6); ctx.lineTo(TS, TS); ctx.lineTo(x0 + wdt - 3, TS); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(base, 0.16);
      ctx.fillRect(x0 + 1, TS - 5, 1, 5);
    }

    // A rounded cap on the topmost trunk tile.
    if (!hasAbove) {
      ctx.fillStyle = shade(base, 0.18);
      ctx.fillRect(x0 + 1, 0, wdt - 2, 2);
    }

    // Branch stubs on some mid-trunk tiles, angled and shaded like the trunk.
    if (hasAbove && hasBelow && variant > 1) {
      const dir = variant === 2 ? -1 : 1;
      ctx.strokeStyle = shade(base, dir < 0 ? 0.1 : -0.2);
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(TS / 2, 10);
      ctx.lineTo(TS / 2 + dir * 7, 4);
      ctx.stroke();
    }
    return c;
  }

  // Canopy mask: N/E/S/W = the neighbouring tile is also foliage. Interior
  // leaves are darker (self-shadowed); exposed leaves catch light and get a
  // ragged silhouette.
  getCanopy(id, mask, variant) {
    const key = (2 << 24) | (id << 12) | ((variant & 3) << 8) | (mask & 0xff);
    let c = this.treeCache.get(key);
    if (!c) { c = this._buildCanopy(id, mask, variant); this.treeCache.set(key, c); }
    return c;
  }

  _buildCanopy(id, mask, variant) {
    const def = TILES[id] || {};
    const base = def.color || '#3e7a34';
    const c = makeCanvas(TS, TS);
    const ctx = c.getContext('2d');
    const open = (bit) => (mask & bit) === 0;
    const enclosed = (mask & (N | E | S | WBIT)) === (N | E | S | WBIT);

    // Depth: light falls from the upper left, so foliage darkens down and right,
    // and fully enclosed foliage sits in the tree's own shadow.
    const lit = enclosed ? shade(base, -0.24) : shade(base, 0.16);
    const dark = enclosed ? shade(base, -0.42) : shade(base, -0.2);
    const g = ctx.createLinearGradient(0, 0, TS, TS);
    g.addColorStop(0, lit);
    g.addColorStop(0.55, enclosed ? shade(base, -0.3) : base);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TS, TS);

    // Leaf clusters give the canopy internal texture instead of a flat wash.
    const rand = mulberry32(((id * 17 + variant * 613 + 3) * 2654435761) >>> 0);
    for (let i = 0; i < 6; i++) {
      const cx = 2 + ((rand() * (TS - 4)) | 0);
      const cy = 2 + ((rand() * (TS - 4)) | 0);
      ctx.fillStyle = rand() < 0.5 ? shade(base, 0.2) : shade(base, -0.22);
      ctx.fillRect(cx, cy, 2, 2);
      ctx.fillRect(cx + 1, cy + 1, 2, 1);
    }

    // Ragged silhouette on every exposed face.
    const bite = 'rgba(0,0,0,0)';
    const teeth = [0, 2, 1, 3, 0, 2, 1, 2];
    if (open(N)) { for (let x = 0; x < TS; x += 2) ctx.clearRect(x, 0, 2, teeth[(x >> 1) % teeth.length]); }
    if (open(S)) { for (let x = 0; x < TS; x += 2) ctx.clearRect(x, TS - teeth[((x >> 1) + 3) % teeth.length], 2, 3); }
    if (open(WBIT)) { for (let y = 0; y < TS; y += 2) ctx.clearRect(0, y, teeth[((y >> 1) + 1) % teeth.length], 2); }
    if (open(E)) { for (let y = 0; y < TS; y += 2) ctx.clearRect(TS - teeth[((y >> 1) + 2) % teeth.length], y, 3, 2); }

    // Highlight the top-left rim where the sun would actually catch it.
    if (open(N)) { ctx.fillStyle = shade(base, 0.34); for (let x = 0; x < TS; x += 2) ctx.fillRect(x, teeth[(x >> 1) % teeth.length], 2, 1); }
    void bite;
    return c;
  }

  _buildTile(id) {
    const def = TILES[id];
    const c = makeCanvas(TS, TS);
    const ctx = c.getContext('2d');
    const base = def.color || '#888';
    // Flora is drawn as actual plants on a transparent tile rather than as a
    // filled square, so the ground shows through behind it.
    if (def.flora) { this._flora(ctx, id, def, base); return c; }
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TS, TS);
    const rand = mulberry32((id * 2654435761) >>> 0);
    // speckle texture
    for (let i = 0; i < 26; i++) {
      const x = (rand() * TS) | 0, y = (rand() * TS) | 0;
      ctx.fillStyle = rand() < 0.5 ? shade(base, -0.18) : shade(base, 0.14);
      ctx.fillRect(x, y, 1, 1);
    }
    // Grass-topped tiles carry their grass colour across the top rows; the
    // framing pass gives them a ragged edge.
    if (def.grass) {
      ctx.fillStyle = def.grass;
      ctx.fillRect(0, 0, TS, 4);
      ctx.fillStyle = shade(def.grass, -0.2);
      for (let x = 0; x < TS; x += 3) ctx.fillRect(x, 4, 2, 1);
    }
    // Ore seams: coloured crystal clusters set into the surrounding rock.
    const gem = ORE_GEM[id];
    if (gem) {
      const spots = [[4, 5], [10, 4], [7, 9], [12, 11], [3, 11]];
      for (const [gx, gy] of spots) {
        ctx.fillStyle = shade(gem, -0.35);
        ctx.fillRect(gx - 1, gy - 1, 4, 4);
        ctx.fillStyle = gem;
        ctx.fillRect(gx, gy, 2, 2);
        ctx.fillStyle = shade(gem, 0.45);
        ctx.fillRect(gx, gy, 1, 1);
      }
    }
    if (id === T.ICE) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(2, 3, 5, 1); ctx.fillRect(9, 8, 4, 1); ctx.fillRect(4, 11, 6, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(11, 2, 1, 5); ctx.fillRect(5, 6, 1, 4);
    }
    if (id === T.SANDSTONE) {
      ctx.fillStyle = shade(base, -0.2);
      ctx.fillRect(0, 5, TS, 1); ctx.fillRect(0, 11, TS, 1);
      ctx.fillStyle = shade(base, 0.14);
      ctx.fillRect(0, 6, TS, 1);
    }
    if (id === T.DEEPSTONE) {
      ctx.fillStyle = shade(base, -0.3);
      ctx.fillRect(3, 3, 4, 3); ctx.fillRect(9, 8, 5, 4); ctx.fillRect(2, 10, 3, 3);
    }
    if (id === T.LOOT_CHEST) {
      ctx.clearRect(0, 0, TS, TS);
      // A compact, warmly lit chest that reads at tile scale without looking
      // like another brown block in a cave wall.
      ctx.fillStyle = '#3f2414'; ctx.fillRect(2, 8, 12, 6);
      ctx.fillStyle = '#875022'; ctx.fillRect(3, 7, 10, 7);
      ctx.fillStyle = '#be7833'; ctx.fillRect(3, 6, 10, 3);
      ctx.fillStyle = '#e8b45b'; ctx.fillRect(4, 6, 8, 1);
      ctx.fillStyle = '#5b3319'; ctx.fillRect(3, 10, 10, 1); ctx.fillRect(5, 8, 1, 6); ctx.fillRect(10, 8, 1, 6);
      ctx.fillStyle = '#ffdc79'; ctx.fillRect(7, 9, 2, 3); ctx.fillStyle = '#fff4bf'; ctx.fillRect(7, 9, 1, 1);
      ctx.fillStyle = '#2d1b12'; ctx.fillRect(3, 14, 2, 1); ctx.fillRect(11, 14, 2, 1);
    }
    if (id === T.POISON_DART_TRAP_LEFT || id === T.POISON_DART_TRAP_RIGHT) {
      ctx.clearRect(0, 0, TS, TS);
      const right = id === T.POISON_DART_TRAP_RIGHT;
      ctx.fillStyle = '#2f3b3a'; ctx.fillRect(4, 2, 8, 12);
      ctx.fillStyle = '#71816b'; ctx.fillRect(5, 3, 6, 10);
      ctx.fillStyle = '#a4b69d'; ctx.fillRect(6, 4, 4, 1);
      ctx.fillStyle = '#30472e'; ctx.fillRect(6, 8, 4, 4);
      ctx.fillStyle = '#90d65d'; ctx.fillRect(7, 8, 2, 2);
      const nozzleX = right ? 10 : 2;
      ctx.fillStyle = '#4d584d'; ctx.fillRect(nozzleX, 6, 4, 4);
      ctx.fillStyle = '#d7e1d3'; ctx.fillRect(right ? 12 : 0, 7, 3, 2);
      ctx.fillStyle = '#6da64b'; ctx.fillRect(right ? 14 : 0, 8, 1, 1);
      ctx.fillStyle = '#1d2927'; ctx.fillRect(4, 14, 8, 1);
    }
    // torch
    if (id === T.TORCH) {
      ctx.clearRect(0, 0, TS, TS);
      ctx.fillStyle = '#6a4a22'; ctx.fillRect(7, 8, 2, 7); // stick
      ctx.fillStyle = '#ffcf6b'; ctx.fillRect(6, 3, 4, 5); // flame
      ctx.fillStyle = '#ff8c3b'; ctx.fillRect(6, 5, 4, 3);
      ctx.fillStyle = '#fff2c0'; ctx.fillRect(7, 4, 2, 2);
    }
    // station accents
    if (id === T.BENCH) { ctx.fillStyle = shade(base, 0.25); ctx.fillRect(1, 5, 14, 2); ctx.fillStyle = shade(base, -0.3); ctx.fillRect(2, 9, 2, 6); ctx.fillRect(12, 9, 2, 6); }
    if (id === T.SMELTERY) { ctx.fillStyle = '#ff7a2b'; ctx.fillRect(5, 8, 6, 5); ctx.fillStyle = '#ffd66b'; ctx.fillRect(6, 9, 4, 3); }
    if (id === T.FORGE) { ctx.fillStyle = shade(base, -0.3); ctx.fillRect(2, 6, 12, 3); ctx.fillStyle = shade(base, 0.2); ctx.fillRect(6, 9, 4, 5); }
    if (id === T.ALTAR) { ctx.fillStyle = '#9ec3ff'; ctx.fillRect(5, 4, 6, 3); ctx.fillStyle = '#c58bff'; ctx.fillRect(6, 7, 4, 7); ctx.fillStyle = '#eaf3ff'; ctx.fillRect(7, 5, 2, 1); }
    if (id === T.STONEBRICK) { ctx.strokeStyle = shade(base, -0.28); ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, 15, 7); ctx.strokeRect(0.5, 8.5, 15, 7); ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8, 8); ctx.moveTo(4, 8); ctx.lineTo(4, 16); ctx.moveTo(12, 8); ctx.lineTo(12, 16); ctx.stroke(); }
    if (id === T.PLANKS) { ctx.fillStyle = shade(base, -0.22); ctx.fillRect(0, 5, 16, 1); ctx.fillRect(0, 10, 16, 1); ctx.fillRect(8, 0, 1, 5); ctx.fillRect(4, 11, 1, 5); }
    if (id === T.THORNVINE) { ctx.clearRect(0, 0, TS, TS); ctx.fillStyle = base; ctx.fillRect(7, 0, 2, 16); ctx.fillStyle = shade(base, -0.2); ctx.fillRect(3, 4, 4, 2); ctx.fillRect(9, 8, 4, 2); ctx.fillRect(4, 11, 4, 2); }
    if (id === T.TALLGRASS) {
      ctx.clearRect(0, 0, TS, TS);
      ctx.strokeStyle = base; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      for (const [bx, tilt] of [[4, -2], [8, 1], [11, 3], [6, 2]]) {
        ctx.beginPath(); ctx.moveTo(bx, TS); ctx.quadraticCurveTo(bx + tilt, TS - 6, bx + tilt * 2, TS - 11); ctx.stroke();
      }
      ctx.strokeStyle = shade(base, 0.3);
      ctx.beginPath(); ctx.moveTo(8, TS); ctx.quadraticCurveTo(9, TS - 7, 10, TS - 12); ctx.stroke();
    }
    if (id === T.CACTUS) {
      ctx.clearRect(0, 0, TS, TS);
      const g2 = ctx.createLinearGradient(4, 0, 12, 0);
      g2.addColorStop(0, shade(base, 0.22)); g2.addColorStop(0.6, base); g2.addColorStop(1, shade(base, -0.35));
      ctx.fillStyle = g2; ctx.fillRect(4, 0, 8, TS);
      ctx.fillStyle = shade(base, -0.4);
      for (let y = 2; y < TS; y += 4) { ctx.fillRect(3, y, 1, 1); ctx.fillRect(12, y + 2, 1, 1); }
    }
    if (id === T.STALAGMITE || id === T.STALACTITE) {
      ctx.clearRect(0, 0, TS, TS);
      const up = id === T.STALAGMITE;
      ctx.fillStyle = base;
      ctx.beginPath();
      if (up) { ctx.moveTo(4, TS); ctx.lineTo(8, 3); ctx.lineTo(12, TS); }
      else { ctx.moveTo(4, 0); ctx.lineTo(8, TS - 3); ctx.lineTo(12, 0); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(base, 0.28);
      ctx.beginPath();
      if (up) { ctx.moveTo(6, TS); ctx.lineTo(8, 4); ctx.lineTo(9, TS); }
      else { ctx.moveTo(6, 0); ctx.lineTo(8, TS - 4); ctx.lineTo(9, 0); }
      ctx.closePath(); ctx.fill();
    }
    return c;
  }

  // ---- Item icons ----
  // Plants. Each is a handful of strokes on a transparent tile, seeded from the
  // tile id so every instance of a species looks the same — the *variation*
  // between neighbouring plants comes from the wind sway at draw time, not from
  // baking different sprites, which keeps the atlas tiny.
  _flora(ctx, id, def, base) {
    const rand = mulberry32(((id + 7) * 2654435761) >>> 0);
    const dark = shade(base, -0.28), light = shade(base, 0.26);

    const blade = (x, bottom, height, lean, w = 1) => {
      ctx.strokeStyle = rand() < 0.4 ? light : base;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, bottom);
      ctx.quadraticCurveTo(x + lean * 0.4, bottom - height * 0.6, x + lean, bottom - height);
      ctx.stroke();
    };

    switch (id) {
      case T.SHORTGRASS:
        for (let i = 0; i < 6; i++) {
          const x = 1 + rand() * (TS - 2);
          blade(x, TS, 5 + rand() * 6, (rand() - 0.5) * 5);
        }
        break;
      case T.FLOWERS: {
        for (let i = 0; i < 4; i++) blade(2 + rand() * (TS - 4), TS, 5 + rand() * 5, (rand() - 0.5) * 4);
        const petals = ['#e8688a', '#ffd166', '#8ac6ff', '#f2f2f2', '#c58bff'];
        for (let i = 0; i < 3; i++) {
          const x = 2 + rand() * (TS - 4), y = 3 + rand() * 5;
          ctx.strokeStyle = base; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, TS); ctx.lineTo(x, y + 1); ctx.stroke();
          ctx.fillStyle = petals[(rand() * petals.length) | 0];
          ctx.fillRect(x - 1, y - 1, 2, 2);
          ctx.fillStyle = '#ffe9a0';
          ctx.fillRect(x, y, 1, 1);
        }
        break;
      }
      case T.FERN:
        // A central stem with paired fronds, narrowing toward the tip.
        ctx.strokeStyle = dark; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(TS / 2, TS); ctx.lineTo(TS / 2, 2); ctx.stroke();
        for (let i = 0; i < 5; i++) {
          const y = TS - 2 - i * 2.6;
          const len = 5.5 - i * 0.8;
          ctx.strokeStyle = i % 2 ? base : light;
          ctx.beginPath();
          ctx.moveTo(TS / 2, y); ctx.lineTo(TS / 2 - len, y - 1.6);
          ctx.moveTo(TS / 2, y); ctx.lineTo(TS / 2 + len, y - 1.6);
          ctx.stroke();
        }
        break;
      case T.REEDS:
        for (let i = 0; i < 4; i++) {
          const x = 2 + i * 3.4 + rand();
          blade(x, TS, 11 + rand() * 5, (rand() - 0.5) * 3, 1.2);
          ctx.fillStyle = shade(base, -0.35);
          ctx.fillRect(x - 0.5, 2 + rand() * 3, 1.5, 3); // seed head
        }
        break;
      case T.VINE:
        // Hangs from the ceiling: the pivot is at the top.
        ctx.strokeStyle = base; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(TS / 2, 0);
        ctx.quadraticCurveTo(TS / 2 + 2, TS * 0.5, TS / 2 - 1, TS);
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const y = 2 + i * 3.6;
          ctx.fillStyle = i % 2 ? light : dark;
          ctx.fillRect(TS / 2 + (i % 2 ? 1 : -3), y, 3, 2);
        }
        break;
      case T.MUSHROOM:
        for (let i = 0; i < 2; i++) {
          const x = 3 + i * 6 + rand() * 2, h = 4 + rand() * 3;
          ctx.fillStyle = shade(base, 0.3);
          ctx.fillRect(x - 0.5, TS - h, 1.6, h);          // stalk
          ctx.fillStyle = i ? shade(base, -0.2) : base;
          ctx.beginPath();
          ctx.ellipse(x + 0.3, TS - h, 3.2, 2.2, 0, Math.PI, 0);
          ctx.fill();
          ctx.fillStyle = '#f2e6d8';
          ctx.fillRect(x - 1, TS - h - 1, 1, 1);           // speck
        }
        break;
      case T.GLOWMOSS: {
        // Clings to any surface, so it fills the tile edges rather than sitting
        // on the floor.
        ctx.fillStyle = base;
        for (let i = 0; i < 16; i++) {
          const x = rand() * TS, y = rand() * TS;
          ctx.globalAlpha = 0.35 + rand() * 0.5;
          ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand());
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = light;
        for (let i = 0; i < 5; i++) ctx.fillRect(rand() * TS, rand() * TS, 1, 1);
        break;
      }
      case T.DUNESHRUB:
        ctx.strokeStyle = shade(base, -0.3); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(TS / 2, TS); ctx.lineTo(TS / 2, TS - 5); ctx.stroke();
        for (let i = 0; i < 7; i++) {
          const a = -Math.PI * (0.15 + rand() * 0.7);
          const r = 3 + rand() * 4;
          ctx.strokeStyle = rand() < 0.5 ? base : light;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(TS / 2, TS - 5);
          ctx.lineTo(TS / 2 + Math.cos(a) * r, TS - 5 + Math.sin(a) * r);
          ctx.stroke();
        }
        break;
      case T.FROSTBRACKEN:
        for (let i = 0; i < 5; i++) {
          const x = 2 + rand() * (TS - 4);
          blade(x, TS, 6 + rand() * 5, (rand() - 0.5) * 4);
        }
        ctx.fillStyle = '#eaf4ff';
        for (let i = 0; i < 5; i++) ctx.fillRect(rand() * TS, rand() * (TS - 4), 1, 1); // rime
        break;
      case T.BLIGHTBLOOM:
        for (let i = 0; i < 3; i++) {
          const x = 3 + rand() * (TS - 6);
          ctx.strokeStyle = shade(base, -0.25); ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, TS);
          ctx.quadraticCurveTo(x + 2, TS - 6, x - 1, TS - 10);
          ctx.stroke();
          ctx.fillStyle = light;
          ctx.beginPath(); ctx.arc(x - 1, TS - 10, 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#e8c8ff';
          ctx.fillRect(x - 1.5, TS - 10.5, 1, 1);
        }
        break;
      default:
        for (let i = 0; i < 5; i++) blade(2 + rand() * (TS - 4), TS, 6 + rand() * 4, (rand() - 0.5) * 4);
    }
  }

  getIcon(item) {
    if (!item) return null;
    if (this.iconCache.has(item.id)) return this.iconCache.get(item.id);
    const c = this._buildIcon(item);
    this.iconCache.set(item.id, c);
    return c;
  }

  _buildIcon(item) {
    const c = makeCanvas(IS, IS);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const col = item.color || '#cccccc';
    const col2 = item.color2 || shade(col, -0.3);
    const cat = item.category;
    if (cat === 'weapon') {
      if (item.weaponClass === 'melee') this._melee(ctx, col, col2, item.meleeKind, item.id);
      else if (item.weaponClass === 'ranged') this._ranged(ctx, col, col2, item.rangedKind, item.id);
      else if (item.weaponClass === 'mage') this._mage(ctx, col, col2, item.mageKind, item.id);
      else if (item.weaponClass === 'summon') this._summon(ctx, col, col2, item.id);
    } else if (cat === 'throwable') this._throwable(ctx, col, col2, item.throwKind, item.id);
    else if (cat === 'tool') {
      const kind = item.tool && item.tool.kind;
      if (kind === 'axe') this._axe(ctx, col, col2, item.id);
      else if (kind === 'hammer') this._hammer(ctx, col, col2, item.id);
      else this._pick(ctx, col, col2, item.id);
    } else if (cat === 'fishingrod') this._rod(ctx, col, col2, item.id);
    else if (cat === 'bait') this._bait(ctx, col, col2, item.bait);
    else if (cat === 'crate') this._crate(ctx, col, col2);
    else if (cat === 'bucket') this._bucket(ctx, col, col2, item.bucket);
    else if (cat === 'armor') this._armor(ctx, col, col2, item.slot, item.id);
    else if (cat === 'accessory') this._accessory(ctx, col, col2, item.accKind, item.id);
    else if (cat === 'potion') this._potion(ctx, col, col2, item.id, item.food);
    else if (cat === 'ammo') this._ammo(ctx, col, col2, item.id);
    else if (cat === 'summonitem') this._idol(ctx, col, col2, item.id);
    else if (cat === 'block' || cat === 'station') {
      const tc = item.place != null ? this.getTile(item.place) : null;
      if (tc) { ctx.imageSmoothingEnabled = false; ctx.drawImage(tc, 2, 2, IS - 4, IS - 4); }
      else this._nugget(ctx, col, col2);
    } else if (item.matKind === 'ore') this._ore(ctx, col, col2, item.id);
    else if (item.matKind === 'bar') this._bar(ctx, col, col2, item.id);
    else this._nugget(ctx, col, col2, item.id, item.matKind);
    return c;
  }

  // A hammer reads as a heavy square head on a short haft — deliberately
  // blunt-looking so it is never mistaken for the pickaxe beside it in the bag.
  _hammer(ctx, col, col2, id) {
    ctx.lineCap = 'round';
    if (id === 'woodHammer') {
      ctx.strokeStyle = '#6b421f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(5, 17); ctx.lineTo(12, 8); ctx.stroke();
      ctx.fillStyle = '#8d5a2b'; ctx.fillRect(10, 4, 8, 6); ctx.fillStyle = '#c08a4d'; ctx.fillRect(10, 4, 7, 2);
      ctx.fillStyle = '#4b2d17'; ctx.fillRect(15, 4, 3, 6);
    } else if (id === 'cupriteHammer') {
      ctx.strokeStyle = '#65401e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 17); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(5, 4, 12, 6); ctx.fillStyle = shade(col, 0.42); ctx.fillRect(6, 4, 9, 2);
      ctx.fillStyle = col2; ctx.fillRect(5, 8, 12, 2); ctx.fillStyle = '#f6c276'; ctx.fillRect(10, 5, 2, 3);
    } else {
      ctx.strokeStyle = '#5d3e20'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(12, 9); ctx.stroke();
      ctx.fillStyle = col2; ctx.fillRect(2, 4, 16, 7); ctx.fillStyle = col; ctx.fillRect(3, 4, 14, 3);
      ctx.fillStyle = shade(col, 0.4); ctx.fillRect(5, 5, 3, 1); ctx.fillRect(12, 5, 3, 1);
      ctx.fillStyle = '#4d5564'; ctx.fillRect(9, 4, 3, 7);
    }
  }

  // Rod: a tapering pole with a line and a bobber, so it is legible at 20px.
  _rod(ctx, col, col2, id) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = id === 'woodRod' ? '#81512b' : col; ctx.lineWidth = id === 'glimmerRod' ? 2.7 : 2.2;
    ctx.beginPath(); ctx.moveTo(4, 17); ctx.quadraticCurveTo(8, 9, 15, 3); ctx.stroke();
    ctx.strokeStyle = id === 'woodRod' ? '#c18a4e' : shade(col, 0.45); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(5, 16); ctx.quadraticCurveTo(9, 9, 15, 4); ctx.stroke();
    if (id === 'cupriteRod') { ctx.fillStyle = col2; ctx.fillRect(6, 12, 4, 3); ctx.fillStyle = '#f0bd77'; ctx.fillRect(7, 12, 1, 2); }
    if (id === 'glimmerRod') { ctx.fillStyle = '#fff2a0'; ctx.beginPath(); ctx.arc(15, 3, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(240,244,250,0.85)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(15, 3); ctx.quadraticCurveTo(19, 9, 15, 15); ctx.stroke();
    ctx.fillStyle = id === 'glimmerRod' ? '#a8e9ff' : '#e8e4da'; ctx.fillRect(13, 14, 4, 3);
    ctx.fillStyle = id === 'woodRod' ? '#c04a4a' : col; ctx.fillRect(14, 14, 2, 1);
    ctx.strokeStyle = col2; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(4, 17); ctx.lineTo(6, 14); ctx.stroke();
  }

  // Bait: a small curled creature. Grade adds a highlight so better bait is
  // visibly better in the bag rather than only in the tooltip.
  _bait(ctx, col, col2, grade) {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(5, 14);
    ctx.quadraticCurveTo(10, 17, 13, 12);
    ctx.quadraticCurveTo(15, 8, 11, 6);
    ctx.stroke();
    ctx.strokeStyle = col2; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, 13); ctx.quadraticCurveTo(10, 15.5, 12.5, 11.5);
    ctx.stroke();
    ctx.fillStyle = '#20242c';
    ctx.fillRect(10, 5.5, 1.4, 1.4);
    if (grade >= 3) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(10, 10, 0, 10, 10, 9);
      g.addColorStop(0, col2); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(1, 1, 18, 18);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // Crate: a banded box, drawn in perspective so it reads as a container.
  _crate(ctx, col, col2) {
    ctx.fillStyle = col;
    ctx.fillRect(3, 5, 14, 12);
    ctx.fillStyle = shade(col, 0.22);
    ctx.fillRect(3, 5, 14, 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(3, 14.5, 14, 2.5);
    // Bands.
    ctx.strokeStyle = col2; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(3, 9.5); ctx.lineTo(17, 9.5);
    ctx.moveTo(10, 5); ctx.lineTo(10, 17);
    ctx.stroke();
    ctx.strokeStyle = shade(col2, -0.25); ctx.lineWidth = 1;
    ctx.strokeRect(3.5, 5.5, 13, 11);
  }

  // Bucket: a tapered pail with a handle, filled or not.
  _bucket(ctx, col, col2, kind) {
    const body = kind === 'water' ? col2 : col;
    ctx.strokeStyle = shade(body, -0.1); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(10, 8, 5.5, Math.PI, 0); ctx.stroke(); // handle
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(5, 8); ctx.lineTo(15, 8); ctx.lineTo(13.5, 17); ctx.lineTo(6.5, 17);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(body, 0.25);
    ctx.fillRect(5, 8, 10, 1.6);
    if (kind === 'water') {
      ctx.fillStyle = '#3f7fc0';
      ctx.beginPath();
      ctx.moveTo(6, 10.5); ctx.lineTo(14, 10.5); ctx.lineTo(13.2, 16); ctx.lineTo(6.8, 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7ec2f0';
      ctx.fillRect(6, 10.3, 8, 0.9);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(6.5, 15.5, 7, 1.5);
  }

  _melee(ctx, col, col2, kind, id) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'rustedShortblade') {
      ctx.fillStyle = '#725d53'; ctx.beginPath(); ctx.moveTo(5, 15); ctx.lineTo(8, 7); ctx.lineTo(16, 3); ctx.lineTo(13, 12); ctx.lineTo(8, 17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b7bcc9'; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(15, 4); ctx.lineTo(11, 11); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#6b3e24'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(4, 17); ctx.lineTo(8, 13); ctx.stroke();
      ctx.strokeStyle = '#9c7a42'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(8, 18); ctx.stroke();
    } else if (id === 'bonefangDagger') {
      ctx.fillStyle = '#ded6bd'; ctx.beginPath(); ctx.moveTo(5, 15); ctx.quadraticCurveTo(8, 6, 16, 3); ctx.lineTo(12, 11); ctx.lineTo(7, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff7da'; ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(14, 4); ctx.lineTo(11, 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5c4128'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(7, 14); ctx.stroke();
      ctx.fillStyle = '#9b6a3d'; ctx.fillRect(2, 15, 5, 3);
    } else if (id === 'cupriteSword') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(9, 5); ctx.lineTo(16, 2); ctx.lineTo(13, 11); ctx.lineTo(7, 17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, 0.45); ctx.beginPath(); ctx.moveTo(9, 6); ctx.lineTo(15, 3); ctx.lineTo(11, 11); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#80502b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(7, 14); ctx.stroke();
      ctx.strokeStyle = '#f0bd77'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(8, 18); ctx.stroke();
    } else if (id === 'thornspikeSpear') {
      ctx.strokeStyle = '#71492a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(15, 5); ctx.stroke();
      ctx.fillStyle = '#8fb94f'; ctx.beginPath(); ctx.moveTo(13, 7); ctx.lineTo(18, 1); ctx.lineTo(16, 8); ctx.lineTo(11, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d9f08e'; ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(18, 1); ctx.lineTo(16, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4a6c32'; ctx.beginPath(); ctx.moveTo(7, 13); ctx.lineTo(11, 12); ctx.lineTo(9, 16); ctx.closePath(); ctx.fill();
    } else if (id === 'ironveinSaber') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(4, 16); ctx.quadraticCurveTo(8, 5, 17, 3); ctx.quadraticCurveTo(12, 11, 7, 17); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#edf2fb'; ctx.beginPath(); ctx.moveTo(8, 8); ctx.quadraticCurveTo(12, 5, 15, 4); ctx.lineTo(10, 11); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5e4526'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(7, 14); ctx.stroke();
      ctx.strokeStyle = '#d5b35d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(8, 18); ctx.stroke();
    } else if (id === 'emberaxe') {
      ctx.strokeStyle = '#623a22'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(12, 8); ctx.stroke();
      ctx.fillStyle = '#9d3e2b'; ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(18, 4); ctx.lineTo(16, 12); ctx.lineTo(11, 11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(12, 5); ctx.lineTo(17, 5); ctx.lineTo(15, 8); ctx.lineTo(12, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffec8a'; ctx.fillRect(13, 6, 2, 2);
    } else if (id === 'glimmerGlaive') {
      ctx.strokeStyle = '#77633a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(15, 5); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(13, 7); ctx.lineTo(18, 1); ctx.lineTo(17, 8); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff7ba'; ctx.beginPath(); ctx.moveTo(12, 8); ctx.lineTo(18, 1); ctx.lineTo(15, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col2; ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(8, 13); ctx.lineTo(7, 18); ctx.closePath(); ctx.fill();
    } else if (id === 'tideTrident') {
      ctx.strokeStyle = '#6b4c35'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(16, 4); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(13, 7); ctx.lineTo(17, 1); ctx.moveTo(13, 7); ctx.lineTo(15, 8); ctx.moveTo(13, 7); ctx.lineTo(10, 3); ctx.stroke();
      ctx.fillStyle = '#d8fbff'; ctx.fillRect(15, 2, 2, 2); ctx.fillRect(11, 4, 2, 2);
    } else if (id === 'emberblade') {
      ctx.strokeStyle = '#623523'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(8, 13); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(7, 14); ctx.lineTo(10, 5); ctx.lineTo(17, 2); ctx.lineTo(14, 11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(10, 7); ctx.lineTo(15, 3); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffec8a'; ctx.fillRect(5, 15, 2, 2);
    } else if (id === 'stoneironBroadsword') {
      ctx.strokeStyle = '#5d3e2b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(8, 13); ctx.stroke();
      ctx.fillStyle = '#6f7d8b'; ctx.beginPath(); ctx.moveTo(7, 14); ctx.lineTo(8, 5); ctx.lineTo(17, 2); ctx.lineTo(14, 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#cbd6df'; ctx.beginPath(); ctx.moveTo(9, 6); ctx.lineTo(16, 3); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8d9ba8'; ctx.fillRect(5, 14, 3, 2); ctx.fillStyle = '#dbe5ee'; ctx.fillRect(9, 5, 2, 2);
    } else if (id === 'verdantVineblade') {
      ctx.strokeStyle = '#5c3b25'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(8, 13); ctx.stroke();
      ctx.fillStyle = '#397a43'; ctx.beginPath(); ctx.moveTo(7, 14); ctx.quadraticCurveTo(8, 7, 17, 2); ctx.lineTo(14, 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9fe875'; ctx.beginPath(); ctx.moveTo(9, 10); ctx.quadraticCurveTo(12, 5, 16, 3); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d7ff9f'; ctx.fillRect(13, 4, 2, 2); ctx.strokeStyle = '#8bd55c'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(6, 13); ctx.quadraticCurveTo(8, 10, 9, 8); ctx.stroke();
    } else if (id === 'shadowglassScythe') {
      ctx.strokeStyle = '#44304e'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(14, 5); ctx.stroke();
      ctx.fillStyle = '#24172e'; ctx.beginPath(); ctx.moveTo(11, 7); ctx.quadraticCurveTo(14, 0, 19, 2); ctx.quadraticCurveTo(16, 8, 11, 11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b983e5'; ctx.beginPath(); ctx.moveTo(12, 7); ctx.quadraticCurveTo(15, 2, 18, 3); ctx.quadraticCurveTo(15, 6, 12, 9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e1b7ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(13, 7); ctx.quadraticCurveTo(16, 3, 18, 3); ctx.stroke();
    } else if (id === 'mechanicalSword') {
      ctx.strokeStyle = '#263847'; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(8, 13); ctx.stroke();
      ctx.fillStyle = '#37576b'; ctx.beginPath(); ctx.moveTo(7, 15); ctx.lineTo(8, 5); ctx.lineTo(17, 2); ctx.lineTo(14, 12); ctx.lineTo(10, 15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a9efff'; ctx.beginPath(); ctx.moveTo(9, 6); ctx.lineTo(16, 3); ctx.lineTo(12, 10); ctx.lineTo(10, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffcf72'; ctx.beginPath(); ctx.arc(7, 14, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e9ffff'; ctx.fillRect(10, 7, 2, 3);
      ctx.strokeStyle = '#7fdcf4'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(5, 13); ctx.lineTo(10, 18); ctx.stroke();
    } else {
      ctx.fillStyle = '#5288ac'; ctx.beginPath(); ctx.moveTo(3, 17); ctx.lineTo(8, 5); ctx.lineTo(17, 2); ctx.lineTo(13, 13); ctx.lineTo(7, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d6fbff'; ctx.beginPath(); ctx.moveTo(8, 6); ctx.lineTo(16, 3); ctx.lineTo(11, 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#a5e8ff'; ctx.fillRect(10, 7, 2, 4); ctx.fillRect(7, 13, 4, 2);
      ctx.strokeStyle = '#433652'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 18); ctx.lineTo(7, 14); ctx.stroke();
    }
  }
  _ranged(ctx, col, col2, kind, id) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'saplingBow' || id === 'huntersLongbow') {
      const tall = id === 'huntersLongbow';
      ctx.strokeStyle = tall ? '#6b421f' : '#56753b'; ctx.lineWidth = tall ? 2.8 : 2.2;
      ctx.beginPath(); ctx.moveTo(7, tall ? 1 : 3); ctx.quadraticCurveTo(tall ? 1 : 2, 10, 7, 18); ctx.stroke();
      ctx.strokeStyle = '#e6eef4'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(7, tall ? 1 : 3); ctx.lineTo(7, 18); ctx.stroke();
      ctx.strokeStyle = tall ? '#c99b59' : '#a5d364'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(17, 10); ctx.stroke();
      ctx.fillStyle = tall ? '#d8d2c0' : '#a8d883'; ctx.beginPath(); ctx.moveTo(17, 10); ctx.lineTo(14, 8); ctx.lineTo(14, 12); ctx.closePath(); ctx.fill();
    } else if (id === 'slingcaster') {
      ctx.strokeStyle = '#78502c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(10, 12); ctx.lineTo(15, 5); ctx.stroke();
      ctx.strokeStyle = '#ddd1bd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(3, 2); ctx.moveTo(15, 5); ctx.lineTo(17, 2); ctx.stroke();
      ctx.fillStyle = '#8b909c'; ctx.beginPath(); ctx.arc(10, 12, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#cfd4dc'; ctx.fillRect(9, 10, 1, 1);
    } else if (id === 'cupriteRepeater') {
      ctx.fillStyle = '#75411f'; ctx.fillRect(3, 10, 12, 3); ctx.fillStyle = col; ctx.fillRect(6, 7, 9, 4);
      ctx.strokeStyle = '#dcb18a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(5, 15); ctx.moveTo(4, 7); ctx.lineTo(13, 15); ctx.stroke();
      ctx.fillStyle = '#f3c174'; ctx.fillRect(12, 8, 4, 2); ctx.fillStyle = '#5e321f'; ctx.fillRect(4, 12, 3, 5);
    } else if (id === 'boltflinger') {
      ctx.fillStyle = '#505c72'; ctx.fillRect(3, 9, 12, 4); ctx.fillStyle = col; ctx.fillRect(6, 7, 6, 2); ctx.fillRect(13, 10, 5, 2);
      ctx.fillStyle = '#a9e8ff'; ctx.fillRect(10, 8, 2, 4); ctx.fillRect(15, 9, 2, 1); ctx.fillRect(16, 12, 2, 1);
      ctx.fillStyle = '#4c392a'; ctx.fillRect(5, 12, 3, 5);
    } else if (id === 'emberlockMusket') {
      ctx.fillStyle = '#4b3026'; ctx.fillRect(3, 10, 14, 3); ctx.fillStyle = '#875634'; ctx.fillRect(4, 12, 6, 4);
      ctx.fillStyle = '#ff8c3b'; ctx.fillRect(12, 8, 5, 2); ctx.fillStyle = '#e9c375'; ctx.fillRect(15, 10, 3, 3);
      ctx.fillStyle = '#c04c2f'; ctx.fillRect(8, 8, 3, 2);
    } else if (id === 'glimmerRifle') {
      ctx.fillStyle = '#7d6a3a'; ctx.fillRect(2, 9, 16, 3); ctx.fillStyle = '#a79548'; ctx.fillRect(5, 12, 6, 3);
      ctx.fillStyle = '#fff0a6'; ctx.fillRect(7, 8, 6, 2); ctx.fillRect(15, 9, 3, 1); ctx.fillStyle = '#5b4e68'; ctx.fillRect(4, 12, 2, 5);
    } else if (id === 'amberBow') {
      ctx.strokeStyle = '#7b4e29'; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(7, 2); ctx.quadraticCurveTo(1, 10, 7, 18); ctx.stroke();
      ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(7, 2); ctx.lineTo(7, 18); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(7, 10); ctx.lineTo(17, 10); ctx.stroke();
      ctx.fillStyle = '#fff4aa'; ctx.beginPath(); ctx.moveTo(18, 10); ctx.lineTo(14, 7); ctx.lineTo(14, 13); ctx.closePath(); ctx.fill();
    } else if (id === 'missileLauncher') {
      ctx.fillStyle = '#263746'; ctx.fillRect(2, 8, 15, 6);
      ctx.fillStyle = '#58788d'; ctx.fillRect(4, 7, 13, 4);
      ctx.fillStyle = '#9edff0'; ctx.fillRect(7, 8, 7, 1.5); ctx.fill();
      ctx.fillStyle = '#ffb35b'; ctx.beginPath(); ctx.moveTo(18, 11); ctx.lineTo(13, 8); ctx.lineTo(13, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff0bd'; ctx.fillRect(14, 10, 3, 2); ctx.fill();
      ctx.fillStyle = '#3c2b25'; ctx.fillRect(5, 13, 4, 5); ctx.fill(); ctx.fillStyle = '#ffcf72'; ctx.fillRect(9, 12, 2, 2);
    } else {
      ctx.strokeStyle = '#7dc4e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 16); ctx.lineTo(16, 4); ctx.stroke();
      ctx.fillStyle = '#dffbff'; ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(19, 5); ctx.lineTo(15, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#92dbff'; ctx.beginPath(); ctx.moveTo(12, 7); ctx.lineTo(15, 7); ctx.lineTo(15, 10); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(8, 11); ctx.lineTo(11, 11); ctx.lineTo(11, 14); ctx.closePath(); ctx.fill();
    }
  }
  _mage(ctx, col, col2, kind, id) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'emberTome') {
      ctx.fillStyle = '#74342b'; ctx.fillRect(4, 3, 11, 14); ctx.fillStyle = '#b75033'; ctx.fillRect(5, 4, 9, 12); ctx.fillStyle = '#ffcf6b'; ctx.fillRect(7, 8, 5, 5);
      ctx.fillStyle = '#fff0a0'; ctx.fillRect(9, 7, 1, 7); ctx.fillStyle = '#4c2730'; ctx.fillRect(14, 4, 2, 12);
    } else if (id === 'sparkWand') {
      ctx.strokeStyle = '#65452c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(12, 7); ctx.stroke();
      ctx.fillStyle = '#8ac0ff'; ctx.beginPath(); ctx.moveTo(13, 1); ctx.lineTo(16, 5); ctx.lineTo(13, 8); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e8f5ff'; ctx.fillRect(12, 3, 2, 2);
    } else if (id === 'frostshardStaff') {
      ctx.strokeStyle = '#5a5f7a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#bfe9ff'; ctx.beginPath(); ctx.moveTo(11, 7); ctx.lineTo(14, 1); ctx.lineTo(17, 7); ctx.lineTo(14, 11); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#f4fdff'; ctx.fillRect(13, 3, 2, 4);
    } else if (id === 'venomWand') {
      ctx.strokeStyle = '#533e2c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(5, 18); ctx.quadraticCurveTo(8, 11, 12, 7); ctx.stroke();
      ctx.fillStyle = '#4d9c58'; ctx.beginPath(); ctx.arc(13, 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c8ff91'; ctx.beginPath(); ctx.arc(12, 5, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#254c32'; ctx.fillRect(9, 9, 4, 2);
    } else if (id === 'aetherboltStaff') {
      ctx.strokeStyle = '#4a526c'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(11, 7); ctx.stroke();
      ctx.strokeStyle = '#8ad9ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, 7); ctx.lineTo(14, 2); ctx.lineTo(16, 7); ctx.lineTo(13, 10); ctx.stroke();
      ctx.fillStyle = '#e1fbff'; ctx.fillRect(13, 5, 2, 2);
    } else if (id === 'thunderRod') {
      ctx.strokeStyle = '#6a5125'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#fff2a0'; ctx.beginPath(); ctx.moveTo(13, 1); ctx.lineTo(10, 7); ctx.lineTo(13, 7); ctx.lineTo(11, 12); ctx.lineTo(17, 5); ctx.lineTo(14, 5); ctx.closePath(); ctx.fill();
    } else if (id === 'prismScepter') {
      ctx.strokeStyle = '#59415f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(10, 8); ctx.stroke();
      ctx.fillStyle = '#c58bff'; ctx.beginPath(); ctx.moveTo(12, 1); ctx.lineTo(17, 6); ctx.lineTo(12, 11); ctx.lineTo(7, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f5d4ff'; ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(15, 5); ctx.lineTo(12, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#7c4eb0'; ctx.fillRect(10, 8, 4, 2);
    } else if (id === 'stormcaller') {
      ctx.strokeStyle = '#6d5a29'; ctx.lineWidth = 2.7; ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#fff06a'; ctx.beginPath(); ctx.moveTo(13, 1); ctx.lineTo(10, 7); ctx.lineTo(13, 7); ctx.lineTo(11, 12); ctx.lineTo(18, 4); ctx.lineTo(14, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fffbd0'; ctx.fillRect(12, 4, 2, 2);
    } else if (id === 'tideWand') {
      ctx.strokeStyle = '#5c442d'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(5, 18); ctx.quadraticCurveTo(8, 11, 11, 7); ctx.stroke();
      ctx.fillStyle = '#4eb5d2'; ctx.beginPath(); ctx.arc(13, 6, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9fbff'; ctx.beginPath(); ctx.moveTo(13, 1); ctx.quadraticCurveTo(17, 5, 13, 9); ctx.quadraticCurveTo(9, 5, 13, 1); ctx.fill();
      ctx.fillStyle = '#77dff0'; ctx.fillRect(11, 5, 4, 2);
    } else if (id === 'verdantBloomStaff') {
      ctx.strokeStyle = '#5b3b28'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#397a43'; ctx.beginPath(); ctx.arc(13, 6, 4, 0, Math.PI * 2); ctx.fill();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.fillStyle = a === 0 ? '#d6ff9c' : '#72ca57';
        ctx.beginPath(); ctx.ellipse(13 + Math.cos(a) * 4, 6 + Math.sin(a) * 4, 2.6, 1.4, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff4a3'; ctx.fillRect(12, 5, 2, 2);
    } else if (id === 'shadowglassOrb') {
      ctx.strokeStyle = '#44304e'; ctx.lineWidth = 2.8; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#25152f'; ctx.beginPath(); ctx.arc(13, 5, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9d65d1'; ctx.beginPath(); ctx.arc(12, 4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f0cfff'; ctx.fillRect(11, 3, 2, 2); ctx.fillStyle = '#d7a5ff'; ctx.fillRect(14, 6, 2, 2);
    } else {
      ctx.strokeStyle = '#382947'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(12, 8); ctx.stroke();
      ctx.fillStyle = '#612d8f'; ctx.beginPath(); ctx.moveTo(11, 8); ctx.lineTo(13, 1); ctx.lineTo(17, 4); ctx.lineTo(15, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#db9cff'; ctx.fillRect(13, 4, 2, 3); ctx.fillStyle = '#a04fdb'; ctx.fillRect(9, 12, 4, 2);
    }
  }
  _summon(ctx, col, col2, id) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (id === 'spriteWhistle') {
      ctx.fillStyle = '#a7d7ff'; ctx.fillRect(3, 8, 10, 5); ctx.fillStyle = '#e9fbff'; ctx.fillRect(4, 8, 7, 1); ctx.fillStyle = '#587096'; ctx.fillRect(11, 9, 4, 3); ctx.fillStyle = '#2f4b72'; ctx.fillRect(6, 10, 2, 2);
      ctx.strokeStyle = '#cfe9ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(16, 10, 3, -1.2, 1.2); ctx.stroke();
    } else if (id === 'beetleSigil') {
      ctx.fillStyle = '#6e462a'; ctx.beginPath(); ctx.arc(10, 10, 7, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#c47b4a'; ctx.beginPath(); ctx.arc(10, 9, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd28a'; ctx.fillRect(9, 5, 2, 8); ctx.fillStyle = '#4b2d25'; ctx.fillRect(6, 9, 2, 2); ctx.fillRect(12, 9, 2, 2); ctx.strokeStyle = '#e1a363'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(2, 4); ctx.moveTo(16, 7); ctx.lineTo(18, 4); ctx.stroke();
    } else if (id === 'ravenTotem') {
      ctx.fillStyle = '#4a3e64'; ctx.fillRect(7, 6, 6, 11); ctx.fillStyle = '#292536'; ctx.beginPath(); ctx.moveTo(5, 7); ctx.lineTo(10, 2); ctx.lineTo(15, 7); ctx.lineTo(12, 10); ctx.lineTo(10, 8); ctx.lineTo(8, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d7c9ff'; ctx.fillRect(8, 5, 1, 1); ctx.fillRect(11, 5, 1, 1); ctx.fillStyle = '#a879cf'; ctx.fillRect(5, 17, 10, 2);
    } else if (id === 'emberlingStaff') {
      ctx.strokeStyle = '#5b3927'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(11, 8); ctx.stroke();
      ctx.fillStyle = '#d55031'; ctx.beginPath(); ctx.moveTo(12, 9); ctx.quadraticCurveTo(7, 3, 13, 1); ctx.quadraticCurveTo(18, 4, 14, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fff08a'; ctx.beginPath(); ctx.moveTo(13, 7); ctx.quadraticCurveTo(11, 4, 13, 3); ctx.quadraticCurveTo(16, 5, 14, 7); ctx.closePath(); ctx.fill();
    } else if (id === 'thornguardIdol') {
      ctx.fillStyle = '#476739'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(16, 7); ctx.lineTo(14, 16); ctx.lineTo(6, 16); ctx.lineTo(4, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#8dbd58'; ctx.fillRect(8, 6, 4, 5);
      ctx.fillStyle = '#dff58d'; ctx.fillRect(9, 7, 1, 1); ctx.fillRect(11, 7, 1, 1); ctx.fillStyle = '#704a2a'; ctx.fillRect(3, 17, 14, 2);
    } else if (id === 'tideSpriteStaff') {
      ctx.strokeStyle = '#5c442d'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(10, 8); ctx.stroke();
      ctx.fillStyle = '#286d8a'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(15, 5); ctx.lineTo(14, 11); ctx.lineTo(8, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8befff'; ctx.beginPath(); ctx.moveTo(10, 3); ctx.lineTo(13, 5); ctx.lineTo(12, 8); ctx.lineTo(9, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e6ffff'; ctx.fillRect(11, 5, 2, 2); ctx.strokeStyle = '#79dff1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(15, 7, 3, -1.2, 1.2); ctx.stroke();
    } else if (id === 'verdantSproutIdol') {
      ctx.fillStyle = '#47713a'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(15, 7); ctx.lineTo(14, 16); ctx.lineTo(6, 16); ctx.lineTo(5, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8fd35c'; ctx.fillRect(8, 7, 4, 5); ctx.fillStyle = '#d6ff9c'; ctx.fillRect(9, 8, 2, 2);
      ctx.strokeStyle = '#9fe875'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(6, 7); ctx.lineTo(3, 3); ctx.moveTo(14, 7); ctx.lineTo(17, 3); ctx.stroke();
      ctx.fillStyle = '#704a2a'; ctx.fillRect(3, 17, 14, 2);
    } else if (id === 'shadowmothTome') {
      ctx.fillStyle = '#2d1b3b'; ctx.fillRect(4, 3, 11, 14); ctx.fillStyle = '#6f3d91'; ctx.fillRect(5, 4, 9, 12);
      ctx.fillStyle = '#d7a5ff'; ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(14, 9); ctx.lineTo(10, 13); ctx.lineTo(6, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#301743'; ctx.fillRect(9, 7, 2, 6); ctx.fillStyle = '#f0cfff'; ctx.fillRect(8, 8, 1, 1); ctx.fillRect(11, 8, 1, 1);
    } else {
      ctx.strokeStyle = '#4a3a5f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, 3); ctx.lineTo(10, 13); ctx.stroke();
      ctx.fillStyle = '#7653a8'; ctx.beginPath(); ctx.moveTo(5, 10); ctx.quadraticCurveTo(10, 15, 15, 10); ctx.lineTo(14, 16); ctx.quadraticCurveTo(10, 19, 6, 16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d9a7ff'; ctx.fillRect(8, 12, 4, 2); ctx.fillStyle = '#3f2f57'; ctx.fillRect(8, 16, 4, 2);
    }
  }
  // Bombs, dynamite, shurikens and knives.
  _throwable(ctx, col, col2, kind, id) {
    if (id === 'fireFlask') {
      ctx.fillStyle = '#6b4530'; ctx.fillRect(7, 2, 6, 4); ctx.fillStyle = '#d9c3a0'; ctx.fillRect(8, 2, 4, 2);
      ctx.fillStyle = '#b94a31'; ctx.beginPath(); ctx.moveTo(5, 7); ctx.lineTo(15, 7); ctx.lineTo(16, 15); ctx.lineTo(13, 18); ctx.lineTo(7, 18); ctx.lineTo(4, 15); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff8c3b'; ctx.beginPath(); ctx.arc(10, 13, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff0a0'; ctx.fillRect(9, 9, 2, 5); ctx.fillRect(8, 11, 4, 2);
      return;
    }
    if (kind === 'shuriken') {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        ctx.moveTo(10, 10);
        ctx.lineTo(10 + Math.cos(a - 0.35) * 4, 10 + Math.sin(a - 0.35) * 4);
        ctx.lineTo(10 + Math.cos(a) * 9, 10 + Math.sin(a) * 9);
        ctx.lineTo(10 + Math.cos(a + 0.35) * 4, 10 + Math.sin(a + 0.35) * 4);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, 0.4);
      ctx.beginPath(); ctx.arc(10, 10, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b1020';
      ctx.beginPath(); ctx.arc(10, 10, 1.2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (kind === 'knife') {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(15, 3); ctx.lineTo(17, 6); ctx.lineTo(6, 18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, 0.45);
      ctx.beginPath(); ctx.moveTo(5, 15); ctx.lineTo(14, 4); ctx.lineTo(15, 5.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col2; ctx.fillRect(2, 15, 5, 3);
      return;
    }
    if (kind === 'stick') { // dynamite
      ctx.fillStyle = col; ctx.fillRect(6, 5, 8, 13);
      ctx.fillStyle = shade(col, 0.28); ctx.fillRect(6, 5, 3, 13);
      ctx.fillStyle = shade(col, -0.35); ctx.fillRect(6, 9, 8, 2); ctx.fillRect(6, 14, 8, 2);
      ctx.strokeStyle = '#d9cdb0'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(10, 5); ctx.quadraticCurveTo(14, 2, 16, 4); ctx.stroke();
      ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(16, 4, 1.6, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // Round bombs get different bodies: Blast Bomb is iron-and-brass, while
    // Cling Charge is a moss-green disc with clearly visible adhesive pads.
    ctx.fillStyle = col;
    if (id === 'stickyBomb') {
      ctx.beginPath(); ctx.arc(10, 11, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8e879'; ctx.fillRect(7, 5, 6, 2); ctx.fillRect(4, 10, 2, 4); ctx.fillRect(14, 10, 2, 4); ctx.fillRect(7, 15, 6, 2);
      ctx.fillStyle = '#294a2d'; ctx.fillRect(8, 9, 4, 4); ctx.fillStyle = '#e9ffbc'; ctx.fillRect(9, 10, 2, 1);
      return;
    }
    ctx.beginPath(); ctx.arc(9, 12, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(col, 0.4);
    ctx.beginPath(); ctx.arc(7, 10, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col2; ctx.fillRect(8, 4, 3, 3);
    ctx.strokeStyle = '#d9cdb0'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(10, 4); ctx.quadraticCurveTo(14, 1, 16, 4); ctx.stroke();
    ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(16, 4, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(16, 4, 0.8, 0, Math.PI * 2); ctx.fill();
  }
  _pick(ctx, col, col2, id) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = id === 'woodPick' ? '#744623' : '#65452d'; ctx.lineWidth = id === 'glimmerPick' ? 3 : 2.5;
    ctx.beginPath(); ctx.moveTo(8, 18); ctx.lineTo(11, 6); ctx.stroke();
    if (id === 'woodPick') {
      ctx.strokeStyle = '#9a6a3a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(3, 7); ctx.quadraticCurveTo(9, 3, 16, 6); ctx.stroke();
      ctx.fillStyle = '#c18a4e'; ctx.fillRect(8, 6, 3, 2);
    } else if (id === 'cupritePick') {
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(2, 8); ctx.quadraticCurveTo(10, 2, 18, 7); ctx.stroke();
      ctx.strokeStyle = '#ffd090'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(4, 7); ctx.quadraticCurveTo(10, 4, 16, 7); ctx.stroke();
    } else if (id === 'ironveinPick') {
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(2, 7); ctx.lineTo(10, 4); ctx.lineTo(18, 8); ctx.stroke();
      ctx.fillStyle = '#edf2fb'; ctx.fillRect(9, 4, 2, 3); ctx.fillStyle = '#626a78'; ctx.fillRect(9, 7, 3, 2);
    } else {
      ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(2, 7); ctx.quadraticCurveTo(7, 2, 11, 6); ctx.quadraticCurveTo(15, 2, 18, 7); ctx.stroke();
      ctx.fillStyle = shade(col, 0.36); ctx.fillRect(10, 4, 2, 3); ctx.fillStyle = col2; ctx.fillRect(8, 7, 5, 2);
    }
  }
  _axe(ctx, col, col2, id) {
    ctx.strokeStyle = '#704522'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(12, 6); ctx.stroke();
    if (id === 'woodAxe') {
      ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(18, 5); ctx.lineTo(16, 11); ctx.lineTo(11, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c89050'; ctx.fillRect(12, 5, 4, 1);
    } else if (id === 'cupriteAxe') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(10, 3); ctx.lineTo(18, 4); ctx.lineTo(17, 11); ctx.lineTo(10, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffd191'; ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(17, 5); ctx.lineTo(15, 7); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#6d7482'; ctx.beginPath(); ctx.moveTo(9, 3); ctx.lineTo(18, 5); ctx.lineTo(16, 12); ctx.lineTo(10, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e8edf5'; ctx.beginPath(); ctx.moveTo(11, 4); ctx.lineTo(17, 5); ctx.lineTo(14, 8); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#4b525e'; ctx.fillRect(9, 4, 2, 6);
    }
  }
  _armor(ctx, col, col2, slot, id) {
    const fiber = id.startsWith('fiber');
    const iron = id.startsWith('ironvein');
    const hunter = id.startsWith('hunters');
    const aether = id.startsWith('aetherweave');
    const thorn = id.startsWith('thornweave');
    const blight = id.startsWith('blight');
    if (slot === 'head') {
      if (fiber) { ctx.fillStyle = '#64763d'; ctx.beginPath(); ctx.moveTo(4, 14); ctx.lineTo(5, 5); ctx.lineTo(10, 2); ctx.lineTo(15, 5); ctx.lineTo(16, 14); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#b4c77b'; ctx.fillRect(7, 5, 6, 2); ctx.fillStyle = '#20242c'; ctx.fillRect(7, 9, 2, 2); ctx.fillRect(11, 9, 2, 2); }
      else if (iron) { ctx.fillStyle = '#707986'; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(4, 5); ctx.lineTo(7, 2); ctx.lineTo(13, 2); ctx.lineTo(16, 5); ctx.lineTo(17, 13); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d9e0ea'; ctx.fillRect(5, 5, 10, 2); ctx.fillStyle = '#333b48'; ctx.fillRect(5, 9, 10, 3); ctx.fillStyle = '#9ca7b6'; ctx.fillRect(9, 3, 2, 3); }
      else if (hunter) { ctx.fillStyle = '#52652f'; ctx.beginPath(); ctx.moveTo(3, 15); ctx.quadraticCurveTo(3, 4, 10, 3); ctx.quadraticCurveTo(17, 4, 17, 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#b2c66c'; ctx.fillRect(6, 5, 6, 2); ctx.fillStyle = '#202a1a'; ctx.fillRect(7, 10, 6, 2); ctx.fillStyle = '#d9c275'; ctx.fillRect(14, 4, 2, 5); }
      else if (aether) { ctx.fillStyle = '#5a86ab'; ctx.beginPath(); ctx.moveTo(6, 15); ctx.lineTo(6, 5); ctx.lineTo(10, 1); ctx.lineTo(14, 5); ctx.lineTo(14, 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d4f8ff'; ctx.fillRect(8, 3, 4, 2); ctx.fillStyle = '#bddfff'; ctx.fillRect(7, 9, 6, 2); }
      else if (thorn) { ctx.fillStyle = '#3b6130'; ctx.beginPath(); ctx.moveTo(3, 7); ctx.lineTo(7, 2); ctx.lineTo(10, 5); ctx.lineTo(13, 2); ctx.lineTo(17, 7); ctx.lineTo(15, 15); ctx.lineTo(5, 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#a7cf63'; ctx.fillRect(7, 7, 2, 2); ctx.fillRect(11, 7, 2, 2); }
      else if (blight) { ctx.fillStyle = '#59306f'; ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(5, 4); ctx.lineTo(10, 1); ctx.lineTo(15, 4); ctx.lineTo(17, 13); ctx.lineTo(13, 16); ctx.lineTo(7, 16); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d493ff'; ctx.fillRect(6, 5, 8, 2); ctx.fillStyle = '#1f1528'; ctx.fillRect(6, 10, 8, 2); }
    } else if (slot === 'chest') {
      if (fiber || hunter || thorn) { ctx.fillStyle = fiber ? '#718546' : hunter ? '#52652f' : '#3b6130'; ctx.beginPath(); ctx.moveTo(4, 4); ctx.lineTo(8, 3); ctx.lineTo(10, 6); ctx.lineTo(12, 3); ctx.lineTo(16, 4); ctx.lineTo(17, 16); ctx.lineTo(3, 16); ctx.closePath(); ctx.fill(); ctx.fillStyle = fiber ? '#b4c77b' : hunter ? '#a9bd63' : '#8dbd58'; ctx.fillRect(9, 7, 2, 7); if (thorn) { ctx.fillStyle = '#c8ed80'; ctx.fillRect(6, 6, 2, 3); ctx.fillRect(12, 6, 2, 3); } }
      else if (aether) { ctx.fillStyle = '#5a86ab'; ctx.beginPath(); ctx.moveTo(5, 3); ctx.lineTo(15, 3); ctx.lineTo(17, 16); ctx.lineTo(3, 16); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d4f8ff'; ctx.fillRect(9, 4, 2, 11); ctx.fillStyle = '#8ad9ff'; ctx.fillRect(5, 13, 10, 2); }
      else { ctx.fillStyle = iron ? '#7b8493' : '#5b3274'; ctx.beginPath(); ctx.moveTo(3, 4); ctx.lineTo(7, 2); ctx.lineTo(10, 5); ctx.lineTo(13, 2); ctx.lineTo(17, 4); ctx.lineTo(16, 16); ctx.lineTo(4, 16); ctx.closePath(); ctx.fill(); ctx.fillStyle = iron ? '#d9e0ea' : '#d493ff'; ctx.fillRect(9, 4, 2, 10); ctx.fillStyle = iron ? '#56606f' : '#392247'; ctx.fillRect(4, 13, 12, 2); }
    } else {
      ctx.fillStyle = fiber ? '#6d8243' : hunter ? '#52652f' : aether ? '#5a86ab' : thorn ? '#3b6130' : iron ? '#7b8493' : '#5b3274'; ctx.fillRect(4, 4, 5, 13); ctx.fillRect(11, 4, 5, 13);
      ctx.fillStyle = fiber ? '#b4c77b' : hunter ? '#a9bd63' : aether ? '#d4f8ff' : thorn ? '#8dbd58' : iron ? '#d9e0ea' : '#d493ff'; ctx.fillRect(4, 4, 12, 2); ctx.fillRect(8, 11, 1, 5); ctx.fillRect(11, 11, 1, 5);
      if (aether) { ctx.fillStyle = '#a8e9ff'; ctx.fillRect(5, 15, 4, 2); ctx.fillRect(11, 15, 4, 2); }
    }
  }
  _accessory(ctx, col, col2, kind, id) {
    if (id === 'swiftboots') { ctx.fillStyle = '#4f9f88'; ctx.fillRect(4, 8, 6, 7); ctx.fillRect(4, 13, 12, 3); ctx.fillStyle = '#b4ffe5'; ctx.fillRect(5, 9, 4, 2); ctx.fillStyle = '#ffeb83'; ctx.fillRect(10, 8, 2, 2); ctx.fillRect(13, 8, 2, 2); }
    else if (id === 'cloudstepCharm') { ctx.fillStyle = '#dfefff'; ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(2, 4); ctx.lineTo(5, 13); ctx.lineTo(2, 15); ctx.lineTo(9, 14); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(18, 4); ctx.lineTo(15, 13); ctx.lineTo(18, 15); ctx.lineTo(11, 14); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#82bfe8'; ctx.fillRect(9, 8, 2, 7); }
    else if (id === 'vitalBand') { ctx.strokeStyle = '#e84b68'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(10, 12, 5, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#ffd2d8'; ctx.beginPath(); ctx.arc(10, 5, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#ff5876'; ctx.fillRect(9, 4, 2, 2); }
    else if (id === 'aetherLocket') { ctx.strokeStyle = '#a6dfff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(10, 8, 5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); ctx.fillStyle = '#5c85ba'; ctx.beginPath(); ctx.arc(10, 12, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#dffbff'; ctx.beginPath(); ctx.arc(10, 11, 2, 0, Math.PI * 2); ctx.fill(); }
    else if (id === 'beastmasterSigil') { ctx.fillStyle = '#684589'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(16, 7); ctx.lineTo(14, 16); ctx.lineTo(6, 16); ctx.lineTo(4, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#efc8ff'; ctx.fillRect(7, 7, 2, 2); ctx.fillRect(11, 7, 2, 2); ctx.fillRect(9, 11, 2, 3); }
    else { ctx.fillStyle = '#667080'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(16, 5); ctx.lineTo(14, 16); ctx.lineTo(6, 16); ctx.lineTo(4, 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e7edf6'; ctx.fillRect(8, 5, 4, 5); ctx.fillStyle = '#515967'; ctx.fillRect(7, 13, 6, 2); }
  }
  _potion(ctx, col, col2, id, food) {
    if (food) {
      if (id === 'cookedFish') {
        ctx.fillStyle = '#b88456'; ctx.beginPath(); ctx.ellipse(10, 11, 7, 4, -0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#e5d29b'; ctx.beginPath(); ctx.moveTo(4, 11); ctx.lineTo(1, 7); ctx.lineTo(1, 15); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#5b3c2e'; ctx.fillRect(12, 9, 1, 1); ctx.strokeStyle = '#fff0b0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(7, 9); ctx.lineTo(7, 13); ctx.moveTo(9, 8); ctx.lineTo(9, 14); ctx.stroke();
      } else {
        const mutton = id === 'cookedMutton', game = id === 'cookedGame', pork = id === 'cookedPork';
        ctx.fillStyle = mutton ? '#8a5a42' : game ? '#754a36' : pork ? '#c27758' : '#9d482f'; ctx.beginPath(); ctx.ellipse(10, 11, 7, 5, mutton ? 0.3 : -0.25, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = mutton ? '#e7bea0' : pork ? '#f0b19c' : '#d98057'; ctx.beginPath(); ctx.ellipse(8, 9, 3, 1.5, 0, 0, Math.PI * 2); ctx.fill();
        if (game) { ctx.fillStyle = '#d0a268'; ctx.fillRect(14, 8, 3, 6); ctx.fillRect(16, 7, 2, 2); } else { ctx.fillStyle = '#553525'; ctx.fillRect(12, 13, 3, 1); }
      }
      return;
    }
    const heart = id === 'healLesser' || id === 'healGreater';
    const large = id === 'healGreater' || id === 'ironskinTonic';
    const round = id === 'aetherTonic' || id === 'vigorBrew';
    ctx.fillStyle = '#cfe0ff'; ctx.globalAlpha = 0.42;
    if (round) { ctx.beginPath(); ctx.arc(10, 12, 6, 0, Math.PI * 2); ctx.fill(); } else { ctx.fillRect(large ? 5 : 6, 6, large ? 10 : 8, 11); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a5a2a'; ctx.fillRect(8, 2, 4, 4);
    if (round) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(10, 12, 5, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = col; ctx.fillRect(large ? 6 : 7, 9, large ? 8 : 6, 7); }
    ctx.fillStyle = shade(col, 0.42); ctx.fillRect(large ? 7 : 8, 9, large ? 5 : 4, 1);
    if (heart) { ctx.fillStyle = '#ffe1e5'; ctx.fillRect(9, 11, 2, 3); ctx.fillRect(8, 12, 4, 1); }
    else if (id === 'aetherTonic') { ctx.fillStyle = '#dff8ff'; ctx.fillRect(9, 10, 2, 5); ctx.fillRect(8, 12, 4, 1); }
    else if (id === 'vigorBrew') { ctx.fillStyle = '#e1ffae'; ctx.fillRect(8, 11, 4, 2); ctx.fillRect(9, 10, 2, 4); }
    else if (id === 'ironskinTonic') { ctx.fillStyle = '#f1f4f7'; ctx.fillRect(8, 11, 4, 3); ctx.fillStyle = '#8a929e'; ctx.fillRect(9, 10, 2, 5); }
    else { ctx.fillStyle = '#e3fff2'; ctx.fillRect(8, 10, 2, 5); ctx.fillRect(10, 9, 2, 4); }
  }
  _ammo(ctx, col, col2, id) {
    if (id === 'flintArrow') {
      ctx.strokeStyle = '#9a6a3a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(3, 17); ctx.lineTo(15, 5); ctx.stroke(); ctx.fillStyle = '#c9c9c9'; ctx.beginPath(); ctx.moveTo(15, 2); ctx.lineTo(19, 6); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#e7e9ef'; ctx.fillRect(15, 4, 2, 2); ctx.fillStyle = '#8a6a3a'; ctx.fillRect(2, 15, 4, 2);
    } else if (id === 'bolt') {
      ctx.fillStyle = '#765033'; ctx.fillRect(4, 9, 11, 3); ctx.fillStyle = '#c6a171'; ctx.fillRect(5, 9, 7, 1); ctx.fillStyle = '#5a6572'; ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(19, 10); ctx.lineTo(15, 13); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#d9e1e7'; ctx.fillRect(15, 10, 2, 1);
    } else { ctx.fillStyle = '#6d727c'; ctx.beginPath(); ctx.arc(7, 10, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(12, 13, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(14, 7, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#f4d56d'; ctx.fillRect(6, 9, 1, 1); ctx.fillRect(11, 12, 1, 1); ctx.fillRect(13, 6, 1, 1); }
  }
  _idol(ctx, col, col2, id) {
    if (id === 'verdantEffigy') { ctx.fillStyle = '#3d6b35'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(16, 7); ctx.lineTo(14, 16); ctx.lineTo(6, 16); ctx.lineTo(4, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#b7e86e'; ctx.fillRect(8, 6, 4, 4); ctx.fillStyle = '#2b4b29'; ctx.fillRect(8, 7, 1, 1); ctx.fillRect(11, 7, 1, 1); ctx.fillStyle = '#80512e'; ctx.fillRect(3, 17, 14, 2); }
    else if (id === 'boneSigil') { ctx.fillStyle = '#d9d0b3'; ctx.beginPath(); ctx.arc(10, 9, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#4a3f36'; ctx.fillRect(6, 7, 3, 3); ctx.fillRect(11, 7, 3, 3); ctx.fillRect(8, 12, 4, 2); ctx.fillStyle = '#9d8e70'; ctx.fillRect(5, 16, 10, 2); }
    else if (id === 'wormLure') {
      // A broken-looking purple drill signal, distinct from both the Mech's
      // blue beacon and the retired occult idols.
      ctx.fillStyle = '#1f1728'; ctx.fillRect(4, 14, 12, 4);
      ctx.fillStyle = '#4a315d'; ctx.fillRect(6, 6, 8, 9);
      ctx.fillStyle = '#7b4ca0'; ctx.fillRect(8, 4, 4, 10); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.42; ctx.fillStyle = '#d39aff'; ctx.beginPath(); ctx.arc(10, 10, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#f0d4ff'; ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(13, 10); ctx.lineTo(10, 14); ctx.lineTo(7, 10); ctx.closePath(); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#c588f3'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(10, 2); ctx.moveTo(7, 6); ctx.lineTo(5, 3); ctx.moveTo(13, 6); ctx.lineTo(15, 3); ctx.stroke();
    }
    else if (id === 'mechBeacon') {
      // A small field beacon with a bright reactor, so it reads as technology
      // rather than another occult idol in the inventory.
      ctx.fillStyle = '#202d3b'; ctx.fillRect(4, 15, 12, 4);
      ctx.fillStyle = '#60798c'; ctx.fillRect(6, 12, 8, 4);
      ctx.fillStyle = '#31485b'; ctx.fillRect(7, 5, 6, 8);
      ctx.fillStyle = '#a6c7d4'; ctx.fillRect(8, 6, 4, 2);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.42; ctx.fillStyle = '#72ddff'; ctx.beginPath(); ctx.arc(10, 10, 5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8ffff'; ctx.fillRect(9, 9, 3, 3); ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#8fdff2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(10, 5); ctx.lineTo(10, 2); ctx.moveTo(8, 4); ctx.lineTo(6, 2); ctx.moveTo(12, 4); ctx.lineTo(14, 2); ctx.stroke();
    }
    else { ctx.fillStyle = '#4b2d66'; ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(17, 7); ctx.lineTo(14, 17); ctx.lineTo(6, 17); ctx.lineTo(3, 7); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c58bff'; ctx.fillRect(8, 6, 4, 7); ctx.fillStyle = '#f0c4ff'; ctx.fillRect(9, 7, 2, 2); ctx.fillStyle = '#2d1e3d'; ctx.fillRect(3, 17, 14, 2); }
  }
  _ore(ctx, col, col2, id) {
    const oreGem = {
      stoneironOre: '#b9c8d4', amberOre: '#ffd166', tideOre: '#69e3ff',
      emberOre: '#ff6a32', verdantOre: '#9be66b', stormOre: '#fff27a',
      shadowglassOre: '#c58bff', starsteelOre: '#f2fcff',
    }[id] || col;
    const rock = id === 'blightoreOre' || id === 'shadowglassOre' ? '#44304e'
      : id === 'aetheriteOre' || id === 'tideOre' || id === 'starsteelOre' ? '#5f7186'
        : id === 'emberOre' ? '#512b2c' : id === 'verdantOre' ? '#304b35' : '#6f7484';
    ctx.fillStyle = rock;
    if (id === 'cupriteOre') { ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(7, 5); ctx.lineTo(15, 6); ctx.lineTo(17, 13); ctx.lineTo(11, 17); ctx.lineTo(5, 16); ctx.closePath(); ctx.fill(); [[7,8],[11,7],[12,12],[6,13]].forEach(([x,y])=>{ctx.fillStyle='#de8550';ctx.fillRect(x,y,3,3);ctx.fillStyle='#ffd090';ctx.fillRect(x,y,1,1);}); }
    else if (id === 'ironveinOre') { ctx.beginPath(); ctx.moveTo(4, 15); ctx.lineTo(5, 7); ctx.lineTo(11, 4); ctx.lineTo(16, 8); ctx.lineTo(15, 15); ctx.lineTo(9, 17); ctx.closePath(); ctx.fill(); [[7,8],[11,7],[9,12],[13,13]].forEach(([x,y])=>{ctx.fillStyle='#c8d0dc';ctx.fillRect(x,y,3,2);ctx.fillStyle='#f1f5fb';ctx.fillRect(x,y,1,1);}); }
    else if (id === 'glimmerOre') { ctx.beginPath(); ctx.moveTo(3, 12); ctx.lineTo(8, 4); ctx.lineTo(16, 7); ctx.lineTo(17, 14); ctx.lineTo(9, 17); ctx.closePath(); ctx.fill(); [[8,7],[12,8],[7,12],[13,13]].forEach(([x,y])=>{ctx.fillStyle='#ffe27b';ctx.fillRect(x,y,3,3);ctx.fillStyle='#fff9c8';ctx.fillRect(x,y,1,1);}); }
    else if (id === 'glacieriteOre') { ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(6,6);ctx.lineTo(12,4);ctx.lineTo(17,9);ctx.lineTo(15,15);ctx.lineTo(8,17);ctx.closePath();ctx.fill();ctx.fillStyle='#6ecce8';ctx.beginPath();ctx.moveTo(7,7);ctx.lineTo(11,5);ctx.lineTo(10,12);ctx.lineTo(6,13);ctx.closePath();ctx.fill();ctx.beginPath();ctx.moveTo(13,9);ctx.lineTo(16,10);ctx.lineTo(13,15);ctx.lineTo(11,13);ctx.closePath();ctx.fill();ctx.fillStyle='#e8ffff';ctx.fillRect(8,7,2,3);ctx.fillRect(13,10,1,3); }
    else if (id === 'aetheriteOre') { ctx.beginPath(); ctx.moveTo(3, 12); ctx.lineTo(8, 4); ctx.lineTo(15, 6); ctx.lineTo(17, 14); ctx.lineTo(9, 17); ctx.closePath(); ctx.fill(); ctx.fillStyle='#91e5ff';ctx.beginPath();ctx.moveTo(9,5);ctx.lineTo(12,9);ctx.lineTo(10,14);ctx.lineTo(6,12);ctx.closePath();ctx.fill();ctx.fillStyle='#e4feff';ctx.fillRect(9,7,2,4);ctx.fillRect(13,11,2,2); }
    else { ctx.beginPath(); ctx.moveTo(3, 12); ctx.lineTo(8, 4); ctx.lineTo(16, 7); ctx.lineTo(17, 14); ctx.lineTo(9, 17); ctx.closePath(); ctx.fill(); ctx.fillStyle=oreGem;ctx.beginPath();ctx.moveTo(9,6);ctx.lineTo(14,9);ctx.lineTo(12,14);ctx.lineTo(7,12);ctx.closePath();ctx.fill();ctx.fillStyle=shade(oreGem, 0.34);ctx.fillRect(9,8,2,2);ctx.fillRect(12,11,2,2); }
  }
  _bar(ctx, col, col2, id) {
    if (id === 'cupriteBar') { ctx.fillStyle='#9c4d31';ctx.beginPath();ctx.moveTo(3,12);ctx.lineTo(6,8);ctx.lineTo(16,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle='#e89a66';ctx.fillRect(6,9,10,3);ctx.fillStyle='#ffd39d';ctx.fillRect(7,9,7,1); }
    else if (id === 'ironveinBar') { ctx.fillStyle='#69717d';ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(6,8);ctx.lineTo(16,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle='#cdd5e1';ctx.fillRect(6,9,10,3);ctx.fillStyle='#f3f6fb';ctx.fillRect(7,9,7,1);ctx.fillStyle='#929aa8';ctx.fillRect(8,12,6,1); }
    else if (id === 'glimmerBar') { ctx.fillStyle='#a88338';ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(7,8);ctx.lineTo(15,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle='#ffe79b';ctx.fillRect(7,9,8,3);ctx.fillStyle='#fff8d0';ctx.fillRect(8,9,5,1);ctx.fillStyle='#d2a946';ctx.fillRect(6,12,10,1); }
    else if (id === 'glacieriteBar') { ctx.fillStyle='#477c91';ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(7,8);ctx.lineTo(15,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle='#9eeaff';ctx.fillRect(7,9,8,3);ctx.fillStyle='#e9ffff';ctx.fillRect(8,9,5,1);ctx.fillStyle='#62bad7';ctx.fillRect(6,12,10,1);ctx.fillStyle='#d8fbff';ctx.fillRect(13,10,1,1); }
    else if (id === 'aetheriteBar') { ctx.fillStyle='#4e829c';ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(7,8);ctx.lineTo(15,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle='#a9edff';ctx.fillRect(7,9,8,3);ctx.fillStyle='#e6fcff';ctx.fillRect(8,9,5,1);ctx.fillStyle='#66b8db';ctx.fillRect(10,12,2,1); }
    else { const barGem = ({ stoneironBar: '#c5d0d8', amberBar: '#ffd36a', tideBar: '#9cecff', emberBar: '#ff9a55', verdantBar: '#a6e27d', stormBar: '#fff3a0', shadowglassBar: '#d4a4ff', starsteelBar: '#ffffff' }[id] || col); ctx.fillStyle=shade(barGem, -0.42);ctx.beginPath();ctx.moveTo(3,13);ctx.lineTo(7,8);ctx.lineTo(15,8);ctx.lineTo(18,13);ctx.lineTo(15,15);ctx.lineTo(5,15);ctx.closePath();ctx.fill();ctx.fillStyle=barGem;ctx.fillRect(7,9,8,3);ctx.fillStyle=shade(barGem, 0.35);ctx.fillRect(8,9,5,1);ctx.fillStyle=shade(barGem, -0.2);ctx.fillRect(9,12,4,1); }
  }
  _nugget(ctx, col, col2, id, kind) {
    if (id === 'fiber') { ctx.strokeStyle='#557c35';ctx.lineWidth=2;ctx.lineCap='round';for(const [x,y] of [[5,16],[8,17],[11,16],[14,17]]){ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x-2,9,x+2,4);ctx.stroke();}ctx.strokeStyle='#b9dc74';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(9,17);ctx.quadraticCurveTo(10,10,13,5);ctx.stroke();return; }
    if (id === 'mechCore') {
      ctx.fillStyle = '#21303e'; ctx.fillRect(4, 4, 12, 13);
      ctx.fillStyle = '#59778a'; ctx.fillRect(6, 5, 8, 10);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.40; ctx.fillStyle = '#72ddff'; ctx.beginPath(); ctx.arc(10, 10, 6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#dffcff'; ctx.beginPath(); ctx.arc(10, 10, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#ffcf72'; ctx.fillRect(8, 16, 4, 2);
      return;
    }
    if (id === 'wormCore') {
      ctx.fillStyle = '#20152a'; ctx.beginPath(); ctx.arc(10, 10, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.fillStyle = '#c383ff'; ctx.beginPath(); ctx.arc(10, 10, 7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8caff'; ctx.beginPath(); ctx.moveTo(10, 4); ctx.lineTo(14, 10); ctx.lineTo(10, 16); ctx.lineTo(6, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7d43a2'; ctx.fillRect(9, 6, 2, 8); ctx.globalCompositeOperation = 'source-over';
      return;
    }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(10, 11, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(col, 0.35); ctx.beginPath(); ctx.arc(8, 9, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col2; ctx.beginPath(); ctx.arc(13, 13, 2, 0, Math.PI * 2); ctx.fill();
  }
}

const ORE_GEM = {
  [T.CUPRITE]: '#ff9a5a',
  [T.IRONVEIN]: '#dfe4ee',
  [T.GLIMMER]: '#ffe86b',
  [T.AETHERITE]: '#8ad9ff',
  [T.BLIGHTORE]: '#c58bff',
  [T.GLACIERITE]: '#72d4ee',
  [T.STONEIRON]: '#b9c8d4',
  [T.AMBER]: '#ffd166',
  [T.TIDE]: '#69e3ff',
  [T.EMBER]: '#ff6a32',
  [T.VERDANT]: '#9be66b',
  [T.STORM]: '#fff27a',
  [T.SHADOWGLASS]: '#c58bff',
  [T.STARSTEEL]: '#f2fcff',
};

// Neighbour mask for framing. Two tiles merge when they share a `mat` group, so
// ore veins blend into their host rock and grass merges with the dirt below it.
export function framingMask(world, tx, ty, id) {
  const mine = tileMat(id);
  let m = 0;
  const same = (dx, dy) => {
    const other = world.get(tx + dx, ty + dy);
    if (other === id) return true;
    const om = tileMat(other);
    return !!mine && om === mine;
  };
  if (same(0, -1)) m |= N;
  if (same(1, 0)) m |= E;
  if (same(0, 1)) m |= S;
  if (same(-1, 0)) m |= WBIT;
  if (same(1, -1)) m |= NE;
  if (same(1, 1)) m |= SE;
  if (same(-1, 1)) m |= SW;
  if (same(-1, -1)) m |= NW;
  return m;
}

// Stable per-tile hash for picking sprite variants, so a tree looks the same
// every frame, after a reload, and while it is toppling.
export function tileHash(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function spriteVariant(tx, ty) { return tileHash(tx, ty) & 3; }

// Neighbour masks for the two tree layers. Exported because the felling code
// needs to capture a cell's appearance *before* clearing the tile, so the
// topple animation keeps the sprite the standing tree had — reading them after
// the clear would find air and fall back to the flat tile sprite.
export function trunkMask(world, tx, ty) {
  let mask = 0;
  if (isTree(world.get(tx, ty - 1))) mask |= N;
  if (isTree(world.get(tx, ty + 1))) mask |= S;
  return mask;
}

export function leafMask(world, tx, ty) {
  let mask = 0;
  if (isLeaf(world.get(tx, ty - 1))) mask |= N;
  if (isLeaf(world.get(tx + 1, ty))) mask |= E;
  if (isLeaf(world.get(tx, ty + 1))) mask |= S;
  if (isLeaf(world.get(tx - 1, ty))) mask |= WBIT;
  return mask;
}

export const Sprites = new SpriteBank();
