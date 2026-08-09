// Summoner Realms — falling-tree animation. Purely cosmetic and local: when a
// trunk is chopped the collapsed tiles are already removed from the grid (and
// synced over the network), and this entity plays them tipping over and fading
// so a felled tree reads as toppling from the point of impact rather than
// blinking out. Multiplayer note: the animation is client-local; the tile
// removals themselves replicate to everyone.
import { TILE } from '../config.js?v=hivewrought-1';

export class FallingTree {
  // cells: [{x,y,id,trunk,mask,variant}] world-tile cells; pivot at the cut
  // point (tx,ty). `mask`/`variant` are the sprite selectors captured while the
  // tree was still standing, so the topple animation renders the same shaded
  // trunk and canopy rather than a flat fallback tile.
  constructor(cells, pivotTx, pivotTy, dir) {
    this.cells = cells.map(c => ({
      id: c.id, dx: c.x - pivotTx, dy: c.y - pivotTy,
      mask: c.mask || 0, variant: c.variant || 0,
    }));
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
