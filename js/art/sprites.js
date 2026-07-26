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
import { T, TILES, tileMat } from '../world/tiles.js?v=realms-qor-45';
import { W, WALLS } from '../world/walls.js?v=realms-qor-45';
import { mulberry32 } from '../utils.js?v=realms-qor-45';

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
    this.bossCache = new Map(); // (boss, part, phase) -> boss part texture
    this.ready = false;
  }

  // ---- Boss parts ----
  // Segmented bosses are assembled from a small set of reusable pieces (head,
  // body segment, tail, leg), one set per phase, exactly the way the reference
  // art is laid out. Each piece is rasterised once into an offscreen canvas and
  // then blitted rotated along the body chain, so a six-node Gravemaw costs six
  // drawImage calls rather than a few hundred path operations every frame.
  // `imageSmoothingEnabled` is off in the renderer, so these stay crisp.
  getBossPart(part, phase) {
    const key = (GM_PARTS.indexOf(part) << 4) | (phase & 0xf);
    let c = this.bossCache.get(key);
    if (!c) { c = buildGravemawPart(part, phase); this.bossCache.set(key, c); }
    return c;
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

    // Corruption trunks are twisted: the column leans per-tile, narrows, and
    // grows knots and dead stubs instead of a clean cylinder.
    const gnarled = id === T.BLIGHTWOOD;
    if (gnarled) {
      const lean = [-2, 1, 2, -1][variant & 3];
      ctx.save();
      ctx.translate(TS / 2, TS / 2);
      ctx.rotate(lean * 0.06);
      ctx.translate(-TS / 2, -TS / 2);
      const gx0 = 5 + lean * 0.5, gw = 6;
      const gg = ctx.createLinearGradient(gx0, 0, gx0 + gw, 0);
      gg.addColorStop(0, shade(base, -0.2));
      gg.addColorStop(0.3, shade(base, 0.2));
      gg.addColorStop(1, shade(base, -0.45));
      ctx.fillStyle = gg;
      ctx.fillRect(gx0, 0, gw, TS);
      // Knots and bark splits.
      const gr = mulberry32(((id * 17 + variant * 613 + 3) * 2654435761) >>> 0);
      ctx.fillStyle = shade(base, -0.5);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(gx0 + ((gr() * gw) | 0), (gr() * (TS - 3)) | 0, 1, 2 + ((gr() * 3) | 0));
      }
      ctx.fillStyle = shade(base, 0.3);
      ctx.beginPath();
      ctx.arc(gx0 + 2, 5 + ((gr() * 6) | 0), 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // A bare, crooked branch on some tiles.
      if (hasAbove && hasBelow && (variant & 1)) {
        const dir = variant < 2 ? -1 : 1;
        ctx.strokeStyle = shade(base, -0.3);
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(TS / 2, 11);
        ctx.lineTo(TS / 2 + dir * 4, 7);
        ctx.lineTo(TS / 2 + dir * 7, 8);
        ctx.stroke();
      }
      if (!hasBelow) {
        ctx.fillStyle = shade(base, -0.25);
        ctx.beginPath();
        ctx.moveTo(5, TS - 5); ctx.lineTo(1, TS); ctx.lineTo(8, TS); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(11, TS - 4); ctx.lineTo(15, TS); ctx.lineTo(9, TS); ctx.closePath(); ctx.fill();
      }
      return c;
    }

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
    if (id === T.SHORTGRASS) {
      ctx.clearRect(0, 0, TS, TS);
      ctx.strokeStyle = base; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (const [bx, tilt, len] of [[3, -1, 5], [6, 1, 7], [9, 0, 6], [12, 2, 4]]) {
        ctx.beginPath(); ctx.moveTo(bx, TS); ctx.quadraticCurveTo(bx + tilt, TS - len * 0.6, bx + tilt * 2, TS - len); ctx.stroke();
      }
    }
    if (id === T.FLOWER) {
      ctx.clearRect(0, 0, TS, TS);
      // stem + leaf
      ctx.strokeStyle = '#4f8f46'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(8, TS); ctx.quadraticCurveTo(7, TS - 5, 8, TS - 9); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, TS - 5); ctx.quadraticCurveTo(5, TS - 6, 4, TS - 8); ctx.stroke();
      // five petals around a pale centre
      ctx.fillStyle = base;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath(); ctx.arc(8 + Math.cos(a) * 2.4, TS - 10 + Math.sin(a) * 2.4, 1.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffe08a';
      ctx.beginPath(); ctx.arc(8, TS - 10, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    if (id === T.FERN) {
      ctx.clearRect(0, 0, TS, TS);
      ctx.strokeStyle = base; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(8, TS); ctx.quadraticCurveTo(8 + dir * 3, TS - 7, 8 + dir * 6, TS - 12); ctx.stroke();
        // fronds off the spine
        ctx.lineWidth = 0.9;
        for (let i = 1; i <= 3; i++) {
          const t = i / 4;
          const sx = 8 + dir * 3 * t * 2, sy = TS - 12 * t;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + dir * 3, sy - 1.5); ctx.stroke();
        }
        ctx.lineWidth = 1.1;
      }
    }
    if (id === T.CAVEMOSS) {
      ctx.clearRect(0, 0, TS, TS);
      // A clinging fringe rather than a plant: it hangs off whatever is above.
      ctx.fillStyle = base;
      for (let x = 0; x < TS; x += 2) {
        const len = 3 + ((x * 7) % 5);
        ctx.fillRect(x, 0, 2, len);
      }
      ctx.fillStyle = shade(base, 0.25);
      for (let x = 1; x < TS; x += 5) ctx.fillRect(x, 0, 1, 2);
    }
    if (id === T.GLOWSHROOM) {
      ctx.clearRect(0, 0, TS, TS);
      ctx.fillStyle = '#d9e6ea';
      ctx.fillRect(7, TS - 7, 2, 7);
      // cap with a soft bloom, so it reads as a light source
      const g3 = ctx.createRadialGradient(8, TS - 8, 0, 8, TS - 8, 7);
      g3.addColorStop(0, '#ffffff'); g3.addColorStop(0.45, base); g3.addColorStop(1, 'rgba(127,216,232,0)');
      ctx.fillStyle = g3;
      ctx.beginPath(); ctx.arc(8, TS - 8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath(); ctx.ellipse(8, TS - 8, 4.5, 3, 0, Math.PI, 0); ctx.fill();
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
    const col = item.color || '#cccccc';
    const col2 = item.color2 || shade(col, -0.3);
    const cat = item.category;
    if (cat === 'weapon') {
      if (item.weaponClass === 'melee') this._melee(ctx, col, col2, item.meleeKind);
      else if (item.weaponClass === 'ranged') this._ranged(ctx, col, col2, item.rangedKind);
      else if (item.weaponClass === 'mage') this._mage(ctx, col, col2, item.mageKind);
      else if (item.weaponClass === 'summon') this._summon(ctx, col, col2);
    } else if (cat === 'throwable') this._throwable(ctx, col, col2, item.throwKind);
    else if (cat === 'tool') { if (item.tool && item.tool.kind === 'axe') this._axe(ctx, col, col2); else this._pick(ctx, col, col2); }
    else if (cat === 'armor') this._armor(ctx, col, col2, item.slot);
    else if (cat === 'accessory') this._accessory(ctx, col, col2, item.accKind);
    else if (cat === 'potion') this._potion(ctx, col);
    else if (cat === 'ammo') this._ammo(ctx, col, col2);
    else if (cat === 'summonitem') this._idol(ctx, col, col2);
    else if (cat === 'block' || cat === 'station') {
      const tc = item.place != null ? this.getTile(item.place) : null;
      if (tc) { ctx.imageSmoothingEnabled = false; ctx.drawImage(tc, 2, 2, IS - 4, IS - 4); }
      else this._nugget(ctx, col, col2);
    } else if (item.matKind === 'ore') this._ore(ctx, col, col2);
    else if (item.matKind === 'bar') this._bar(ctx, col, col2);
    else this._nugget(ctx, col, col2);
    return c;
  }

  _melee(ctx, col, col2, kind) {
    // diagonal blade + hilt
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(15, 4); ctx.stroke();
    ctx.strokeStyle = shade(col, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(5, 15); ctx.lineTo(14, 5); ctx.stroke();
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2; // hilt
    ctx.beginPath(); ctx.moveTo(2, 18); ctx.lineTo(6, 14); ctx.stroke();
    ctx.strokeStyle = col2; ctx.lineWidth = 2; // guard
    ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(7, 17); ctx.stroke();
    if (kind === 'spear') { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, 17); ctx.lineTo(17, 3); ctx.stroke(); }
  }
  _ranged(ctx, col, col2, kind) {
    if (kind === 'gun') {
      ctx.fillStyle = col2; ctx.fillRect(3, 9, 14, 3);
      ctx.fillStyle = col; ctx.fillRect(3, 11, 5, 4);
      ctx.fillStyle = shade(col, -0.3); ctx.fillRect(15, 8, 3, 2);
    } else {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(7, 10, 8, -Math.PI / 2.2, Math.PI / 2.2); ctx.stroke();
      ctx.strokeStyle = '#dfe6ff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(9, 2); ctx.lineTo(9, 18); ctx.stroke();
      ctx.strokeStyle = col2; ctx.lineWidth = 1; // arrow
      ctx.beginPath(); ctx.moveTo(9, 10); ctx.lineTo(18, 10); ctx.stroke();
    }
  }
  _mage(ctx, col, col2, kind) {
    if (kind === 'tome') {
      ctx.fillStyle = col2; ctx.fillRect(4, 3, 12, 14);
      ctx.fillStyle = col; ctx.fillRect(5, 4, 10, 12);
      ctx.fillStyle = '#fff2c0'; ctx.fillRect(9, 6, 2, 8); ctx.fillRect(7, 9, 6, 2);
      return;
    }
    ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 2; // staff rod
    ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(12, 6); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(13, 5, 4, 0, Math.PI * 2); ctx.fill(); // orb
    ctx.fillStyle = shade(col, 0.5); ctx.beginPath(); ctx.arc(12, 4, 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shade(col, 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(13, 5, 6, 0, Math.PI * 2); ctx.stroke();
  }
  _summon(ctx, col, col2) {
    ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(6, 18); ctx.lineTo(11, 7); ctx.stroke();
    // rune/whistle head
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(12, 6, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col2; ctx.fillRect(10, 4, 4, 1); ctx.fillRect(11, 3, 2, 5);
    ctx.fillStyle = shade(col, 0.5); ctx.fillRect(11, 5, 1, 1);
  }
  // Bombs, dynamite, shurikens and knives.
  _throwable(ctx, col, col2, kind) {
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
    // round bomb
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(9, 12, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(col, 0.4);
    ctx.beginPath(); ctx.arc(7, 10, 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col2; ctx.fillRect(8, 4, 3, 3);
    ctx.strokeStyle = '#d9cdb0'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(10, 4); ctx.quadraticCurveTo(14, 1, 16, 4); ctx.stroke();
    ctx.fillStyle = '#ffcf6b'; ctx.beginPath(); ctx.arc(16, 4, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff2c0'; ctx.beginPath(); ctx.arc(16, 4, 0.8, 0, Math.PI * 2); ctx.fill();
  }
  _pick(ctx, col, col2) {
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, 18); ctx.lineTo(11, 4); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(3, 6); ctx.quadraticCurveTo(11, 2, 18, 7); ctx.stroke();
    ctx.strokeStyle = shade(col, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(4, 6); ctx.quadraticCurveTo(11, 3, 17, 7); ctx.stroke();
  }
  _axe(ctx, col, col2) {
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2; // haft
    ctx.beginPath(); ctx.moveTo(7, 18); ctx.lineTo(12, 4); ctx.stroke();
    // axe head (wedge) at the top-right of the haft
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(11, 3); ctx.lineTo(18, 5); ctx.lineTo(17, 10); ctx.lineTo(11, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, 0.4); ctx.beginPath(); ctx.moveTo(12, 4); ctx.lineTo(17, 5.5); ctx.lineTo(16.5, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(col, -0.3); ctx.fillRect(10, 3, 2, 6);
  }
  _armor(ctx, col, col2, slot) {
    ctx.fillStyle = col;
    if (slot === 'head') { ctx.fillRect(4, 4, 12, 8); ctx.fillRect(4, 11, 12, 4); ctx.fillStyle = '#0b1020'; ctx.fillRect(6, 8, 3, 3); ctx.fillRect(11, 8, 3, 3); ctx.fillStyle = shade(col, 0.3); ctx.fillRect(4, 4, 12, 2); }
    else if (slot === 'chest') { ctx.fillRect(3, 4, 14, 12); ctx.fillStyle = col2; ctx.fillRect(9, 4, 2, 12); ctx.fillStyle = shade(col, 0.3); ctx.fillRect(3, 4, 14, 2); ctx.fillStyle = shade(col, -0.2); ctx.fillRect(3, 6, 3, 8); ctx.fillRect(14, 6, 3, 8); }
    else { ctx.fillRect(4, 3, 5, 14); ctx.fillRect(11, 3, 5, 14); ctx.fillStyle = shade(col, -0.2); ctx.fillRect(9, 3, 2, 14); ctx.fillStyle = shade(col, 0.3); ctx.fillRect(4, 3, 12, 2); }
  }
  _accessory(ctx, col, col2, kind) {
    if (kind === 'boots') { ctx.fillStyle = col; ctx.fillRect(4, 9, 6, 7); ctx.fillRect(4, 13, 12, 3); ctx.fillStyle = shade(col, 0.3); ctx.fillRect(4, 9, 6, 2); }
    else if (kind === 'wing') { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(2, 4); ctx.lineTo(4, 14); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(18, 4); ctx.lineTo(16, 14); ctx.closePath(); ctx.fill(); }
    else { // ring / charm
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(10, 11, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col2; ctx.beginPath(); ctx.arc(10, 5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(col2, 0.5); ctx.fillRect(9, 3, 1, 1);
    }
  }
  _potion(ctx, col) {
    ctx.fillStyle = '#cfe0ff'; ctx.globalAlpha = 0.4; ctx.fillRect(6, 5, 8, 12); ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.fillRect(7, 9, 6, 7);
    ctx.fillStyle = shade(col, 0.4); ctx.fillRect(7, 9, 6, 1);
    ctx.fillStyle = '#7a5a2a'; ctx.fillRect(8, 3, 4, 3); // cork
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(8, 10, 1, 5);
  }
  _ammo(ctx, col, col2) {
    ctx.strokeStyle = '#c9c9c9'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(15, 5); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(15, 3); ctx.lineTo(18, 6); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col2; ctx.fillRect(3, 15, 3, 3);
  }
  _idol(ctx, col, col2) {
    ctx.fillStyle = col2; ctx.fillRect(6, 3, 8, 14);
    ctx.fillStyle = col; ctx.fillRect(7, 5, 6, 4);
    ctx.fillStyle = '#0b1020'; ctx.fillRect(8, 6, 1, 2); ctx.fillRect(11, 6, 1, 2);
    ctx.fillStyle = shade(col, 0.4); ctx.fillRect(8, 11, 4, 4);
    ctx.fillStyle = col2; ctx.fillRect(4, 16, 12, 2);
  }
  _ore(ctx, col, col2) {
    ctx.fillStyle = '#6f7484'; ctx.beginPath(); ctx.moveTo(4, 12); ctx.lineTo(8, 5); ctx.lineTo(15, 7); ctx.lineTo(16, 14); ctx.lineTo(8, 17); ctx.closePath(); ctx.fill();
    for (const [x, y] of [[7, 9], [11, 8], [9, 12], [13, 11]]) { ctx.fillStyle = col; ctx.fillRect(x, y, 3, 3); ctx.fillStyle = shade(col, 0.4); ctx.fillRect(x, y, 1, 1); }
  }
  _bar(ctx, col, col2) {
    ctx.fillStyle = col2; ctx.beginPath(); ctx.moveTo(3, 12); ctx.lineTo(6, 9); ctx.lineTo(16, 9); ctx.lineTo(17, 14); ctx.lineTo(6, 14); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(6, 9, 10, 2);
    ctx.fillStyle = shade(col, 0.5); ctx.fillRect(6, 9, 10, 1);
  }
  _nugget(ctx, col, col2) {
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

// ---------------------------------------------------------------------------
// Gravemaw parts
// ---------------------------------------------------------------------------
// Built from the design sheet's own modular breakdown: a head, a repeating
// armoured body segment, a tail spike and a leg, in a Phase I ("Buried Hunger",
// jaws shut) and a Phase II ("Open Maw", gaping and spined) variant. Every part
// is drawn facing +X and centred on its canvas, so the renderer can blit it
// rotated along the body chain without per-part anchor bookkeeping.

export const GM_PARTS = ['head', 'segment', 'tail', 'leg'];

const GM = {
  boneHi: '#efe3c6', boneLit: '#d9c9a4', bone: '#bda887', boneSh: '#8b7a5b', boneDeep: '#5f5340',
  tooth: '#f2e9d2', toothHi: '#fffdf5',
  scaleLit: '#5a7a42', scale: '#41603a', scaleDark: '#2c4128', scaleOut: '#1e2c1c',
  band: '#221c1a', lash: '#3a2f28',
  eye: '#ff3d6e', eyeGlow: '#ff8fb4', socket: '#2a1018',
  maw: '#180a10', gum: '#6b2b3a',
};

// Filled polygon from a flat [x,y,...] list.
function gmPoly(ctx, pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

// A row of tapering fangs along an edge. `dir` is -1 for teeth pointing up.
function gmTeeth(ctx, x0, x1, y, len, step, dir, fill) {
  ctx.fillStyle = fill;
  for (let x = x0; x < x1; x += step) {
    const l = len * (0.65 + ((x * 7) % 5) / 10);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + step * 0.5, y + l * dir);
    ctx.lineTo(x + step * 0.92, y);
    ctx.closePath();
    ctx.fill();
  }
}

function buildGravemawPart(part, phase) {
  const p2 = phase >= 1;
  if (part === 'head') return gmHead(p2);
  if (part === 'segment') return gmSegment(p2);
  if (part === 'tail') return gmTail(p2);
  return gmLeg(p2);
}

function gmHead(p2) {
  const w = p2 ? 42 : 32, h = p2 ? 32 : 24;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (!p2) {
    // ---- Phase I: jaws shut into a crocodile grin ----
    // Cranium, tapering to a blunt snout on the right.
    gmPoly(ctx, [3, 7, 9, 3, 20, 3, 29, 9, 30, 13, 4, 14], GM.bone);
    gmPoly(ctx, [3, 7, 9, 3, 20, 3, 24, 6, 5, 9], GM.boneLit);   // lit upper plate
    gmPoly(ctx, [24, 6, 29, 9, 30, 13, 22, 12], GM.boneSh);      // shaded snout side
    // Backswept brow ridges.
    ctx.fillStyle = GM.boneSh;
    for (const [bx, by] of [[7, 2], [12, 1], [17, 2]]) {
      gmPoly(ctx, [bx, by + 3, bx - 3, by - 1, bx + 3, by + 1], GM.boneSh);
    }
    // Lower jaw.
    gmPoly(ctx, [5, 14, 29, 13, 27, 19, 7, 19], GM.bone);
    gmPoly(ctx, [5, 17, 27, 17, 27, 19, 7, 19], GM.boneSh);
    // Interlocking fangs along the closed mouth line. Kept small and tight:
    // oversized teeth here read as a gaping maw, which is Phase II's job.
    ctx.fillStyle = GM.band;
    ctx.fillRect(10, 13, 19, 2);
    gmTeeth(ctx, 11, 28, 13, 2.4, 2.6, 1, GM.tooth);   // upper, pointing down
    gmTeeth(ctx, 12, 29, 15, 2.4, 2.6, -1, GM.tooth);  // lower, pointing up
    // Eye.
    ctx.fillStyle = GM.socket;
    ctx.beginPath(); ctx.ellipse(11, 8, 5, 4, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = GM.eyeGlow;
    ctx.beginPath(); ctx.ellipse(11, 8, 3.2, 2.6, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = GM.eye;
    ctx.beginPath(); ctx.ellipse(11, 8, 2.1, 1.7, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = GM.toothHi;
    ctx.fillRect(10, 7, 1, 1);
    // Nostril.
    ctx.fillStyle = GM.boneDeep;
    ctx.fillRect(26, 9, 2, 1);
    // Neck joint on the trailing edge.
    ctx.fillStyle = GM.band;
    ctx.fillRect(2, 5, 3, 12);
    return c;
  }

  // ---- Phase II: the maw is open ----
  // Throat cavity first, so both jaws overlap it.
  gmPoly(ctx, [8, 12, 34, 4, 38, 10, 36, 24, 10, 21], GM.maw);
  gmPoly(ctx, [10, 13, 30, 7, 32, 11, 12, 18], GM.gum);
  // Upper jaw, hinged up and back.
  gmPoly(ctx, [3, 12, 8, 4, 22, 1, 34, 4, 38, 9, 30, 11, 8, 13], GM.bone);
  gmPoly(ctx, [3, 12, 8, 4, 22, 1, 30, 3, 6, 9], GM.boneLit);
  gmPoly(ctx, [30, 3, 34, 4, 38, 9, 31, 9], GM.boneSh);
  // Heavier angular brow and backswept horns.
  for (const [bx, by, l] of [[6, 3, 5], [11, 1, 6], [17, 0, 6], [23, 1, 5]]) {
    gmPoly(ctx, [bx, by + 4, bx - l, by - 2, bx + 3, by + 1], GM.boneSh);
  }
  // Lower jaw, dropped open.
  gmPoly(ctx, [4, 15, 12, 19, 30, 25, 38, 29, 26, 30, 8, 24], GM.bone);
  gmPoly(ctx, [8, 21, 28, 27, 38, 29, 26, 30, 10, 25], GM.boneSh);
  // Two ranks of long fangs.
  ctx.save();
  ctx.translate(0, 0);
  gmTeeth(ctx, 10, 36, 11, 7, 3.4, 1, GM.tooth);
  ctx.restore();
  ctx.save();
  ctx.rotate(0.18);
  gmTeeth(ctx, 8, 34, 20, 6, 3.2, -1, GM.tooth);
  ctx.restore();
  // Eye, set deeper and angrier.
  ctx.fillStyle = GM.socket;
  ctx.beginPath(); ctx.ellipse(14, 7, 6, 4.4, -0.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GM.eyeGlow;
  ctx.beginPath(); ctx.ellipse(14, 7, 3.8, 2.8, -0.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GM.eye;
  ctx.beginPath(); ctx.ellipse(14, 7, 2.4, 1.8, -0.25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GM.toothHi;
  ctx.fillRect(13, 6, 1, 1);
  ctx.fillStyle = GM.band;
  ctx.fillRect(2, 8, 3, 12);
  return c;
}

function gmSegment(p2) {
  const w = p2 ? 20 : 17, h = p2 ? 26 : 21;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const midY = h / 2;

  // Phase II bristles with bone spines, drawn behind the shell.
  if (p2) {
    for (const [sx, sy, dx, dy] of [[5, 4, -6, -4], [11, 3, -3, -6], [15, 5, 2, -5],
      [5, h - 4, -6, 4], [13, h - 4, 3, 5]]) {
      gmPoly(ctx, [sx, sy, sx + dx, sy + dy, sx + 4, sy + (dy > 0 ? 1 : -1) * 0.5], GM.boneSh);
      gmPoly(ctx, [sx + 1, sy, sx + dx * 0.7, sy + dy * 0.7, sx + 3, sy], GM.boneLit);
    }
  }

  // Scaled hide.
  const bodyTop = p2 ? 5 : 3;
  const bodyH = h - bodyTop * 2;
  ctx.fillStyle = GM.scale;
  ctx.fillRect(2, bodyTop, w - 4, bodyH);
  ctx.fillStyle = GM.scaleLit;
  ctx.fillRect(2, bodyTop, w - 4, 3);
  ctx.fillStyle = GM.scaleDark;
  ctx.fillRect(2, bodyTop + bodyH - 3, w - 4, 3);
  // Individual scales.
  ctx.fillStyle = GM.scaleOut;
  for (let sy = bodyTop + 1; sy < bodyTop + bodyH - 1; sy += 3) {
    for (let sx = 3 + ((sy / 3) % 2 ? 0 : 2); sx < w - 3; sx += 4) ctx.fillRect(sx, sy, 2, 1);
  }

  // Bone plate carrying the grave marker.
  // Inset on all sides, so the scaled hide frames it the way the sheet does
  // rather than the plate covering the whole flank.
  const plateX = Math.round(w * 0.36), plateW = Math.round(w * 0.36);
  const plateY = bodyTop + 3, plateH = bodyH - 6;
  ctx.fillStyle = GM.bone;
  ctx.fillRect(plateX, plateY, plateW, plateH);
  ctx.fillStyle = GM.boneLit;
  ctx.fillRect(plateX, plateY, plateW, 2);
  ctx.fillStyle = GM.boneSh;
  ctx.fillRect(plateX, plateY + plateH - 2, plateW, 2);
  // The tombstone itself: an arched marker set into the plate.
  const tx = plateX + 1, tw = plateW - 2;
  const ty = Math.round(midY - 3), th = 6;
  ctx.fillStyle = GM.boneDeep;
  ctx.beginPath();
  ctx.moveTo(tx, ty + th);
  ctx.lineTo(tx, ty + 2.5);
  ctx.quadraticCurveTo(tx + tw / 2, ty - 1.5, tx + tw, ty + 2.5);
  ctx.lineTo(tx + tw, ty + th);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = GM.boneSh;
  ctx.fillRect(tx + 1, ty + 3, tw - 2, 1);

  // Dark lashed band on the trailing edge.
  ctx.fillStyle = GM.band;
  ctx.fillRect(0, bodyTop - 1, 3, bodyH + 2);
  ctx.strokeStyle = GM.lash;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let ly = bodyTop; ly < bodyTop + bodyH; ly += 4) {
    ctx.moveTo(0, ly); ctx.lineTo(3, ly + 2);
    ctx.moveTo(3, ly); ctx.lineTo(0, ly + 2);
  }
  ctx.stroke();
  return c;
}

function gmTail(p2) {
  const w = p2 ? 24 : 20, h = p2 ? 18 : 14;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const midY = h / 2;
  // Cone tapering to the left (the tail trails behind the body).
  gmPoly(ctx, [w, midY - 5, w - 4, midY - 6, 1, midY, w - 4, midY + 6, w, midY + 5], GM.bone);
  gmPoly(ctx, [w, midY - 5, w - 4, midY - 6, 1, midY, w - 6, midY - 1], GM.boneLit);
  gmPoly(ctx, [1, midY, w - 4, midY + 6, w, midY + 5, w - 6, midY + 1], GM.boneSh);
  // Ridge rings.
  ctx.fillStyle = GM.boneDeep;
  for (let i = 1; i <= 3; i++) {
    const rx = 3 + i * (w - 6) / 4;
    const rh = 1 + i * 1.2;
    ctx.fillRect(rx, midY - rh, 1, rh * 2);
  }
  if (p2) {
    // Barbs.
    gmPoly(ctx, [w - 7, midY - 4, w - 12, midY - 9, w - 4, midY - 5], GM.boneSh);
    gmPoly(ctx, [w - 7, midY + 4, w - 12, midY + 9, w - 4, midY + 5], GM.boneSh);
  }
  return c;
}

function gmLeg(p2) {
  const w = p2 ? 14 : 11, h = p2 ? 18 : 14;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // A jointed bone limb: femur down-right, then a clawed foot.
  ctx.strokeStyle = GM.bone;
  ctx.lineWidth = p2 ? 3 : 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.5, 1);
  ctx.lineTo(w * 0.78, h * 0.5);
  ctx.lineTo(w * 0.34, h - 3);
  ctx.stroke();
  ctx.strokeStyle = GM.boneLit;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.46, 2);
  ctx.lineTo(w * 0.72, h * 0.48);
  ctx.stroke();
  // Claws.
  ctx.strokeStyle = GM.boneLit;
  ctx.lineWidth = 1.4;
  for (const dx of [-2.5, 0, 2.5]) {
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h - 3);
    ctx.lineTo(w * 0.34 + dx, h - 0.5);
    ctx.stroke();
  }
  return c;
}

export const Sprites = new SpriteBank();
