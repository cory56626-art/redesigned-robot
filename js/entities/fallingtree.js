// Summoner Realms — falling-tree animation. Purely cosmetic and local: when a
// trunk is chopped the collapsed tiles are already removed from the grid (and
// synced over the network), and this entity plays them tipping over and fading
// so a felled tree reads as toppling from the point of impact rather than
// blinking out. Multiplayer note: the animation is client-local; the tile
// removals themselves replicate to everyone.
import { TILE } from '../config.js?v=realms-qor-46';
import { isTree, isLeaf } from '../world/tiles.js?v=realms-qor-46';

// Neighbour bits, matching the renderer's tile framing.
const N = 1, E = 2, S = 4, WBIT = 8;

export class FallingTree {
  // cells: [{x,y,id,trunk}] world-tile cells; pivot at the cut point (tx,ty).
  constructor(cells, pivotTx, pivotTy, dir) {
    // The cells are already cleared from the world, so their neighbour masks
    // can't be looked up live at draw time. Bake them here from the cell set
    // itself, so a falling tree keeps the same shaded trunk/canopy sprites it
    // had while standing instead of dropping to the flat generic texture.
    const occupied = new Set(cells.map(c => c.x + ',' + c.y));
    const treeAt = new Map(cells.map(c => [c.x + ',' + c.y, c.id]));
    const has = (x, y, pred) => {
      const k = x + ',' + y;
      return occupied.has(k) && pred(treeAt.get(k));
    };
    this.cells = cells.map(c => {
      let mask = 0;
      if (isTree(c.id)) {
        if (has(c.x, c.y - 1, isTree)) mask |= N;
        if (has(c.x, c.y + 1, isTree)) mask |= S;
      } else if (isLeaf(c.id)) {
        if (has(c.x, c.y - 1, isLeaf)) mask |= N;
        if (has(c.x + 1, c.y, isLeaf)) mask |= E;
        if (has(c.x, c.y + 1, isLeaf)) mask |= S;
        if (has(c.x - 1, c.y, isLeaf)) mask |= WBIT;
      }
      return {
        id: c.id,
        dx: c.x - pivotTx,
        dy: c.y - pivotTy,
        mask,
        variant: ((c.x * 73856093) ^ (c.y * 19349663)) & 3,
      };
    });
    this.px = pivotTx * TILE + TILE / 2; // pivot in world px (base of the cut)
    this.py = pivotTy * TILE + TILE;
    this.dir = dir || (Math.random() < 0.5 ? -1 : 1);
    this.angle = 0;
    this.t = 0;
    this.dur = 0.85;
    this.dead = false;
  }

  update(dt) {
    this.t += dt;
    const p = Math.min(1, this.t / this.dur);
    // Accelerating topple to ~83 degrees, then it "lands".
    this.angle = this.dir * (p * p) * (Math.PI * 0.46);
    if (this.t >= this.dur) this.dead = true;
  }
}
