// Summoner Realms — procedural pixel art.
// All original: tile textures and item icons drawn to offscreen canvases.
// Entities (player/enemies/minions/bosses/projectiles) are drawn procedurally
// in the renderer. Nothing here is copied from any existing game.
import { T, TILES } from '../world/tiles.js';
import { mulberry32 } from '../utils.js';

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

class SpriteBank {
  constructor() {
    this.tileCache = new Map();
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
    // top edge highlight for grass-like tiles
    if (id === T.GRASS || id === T.BLIGHTGRASS) {
      ctx.fillStyle = shade(base, 0.22);
      for (let x = 0; x < TS; x++) if (((x + id) % 3) !== 0) ctx.fillRect(x, 0, 1, 2);
    }
    // ore gems
    const gem = ORE_GEM[id];
    if (gem) {
      const spots = [[4, 5], [10, 4], [7, 9], [12, 11], [3, 11]];
      for (const [gx, gy] of spots) {
        ctx.fillStyle = gem;
        ctx.fillRect(gx, gy, 2, 2);
        ctx.fillStyle = shade(gem, 0.4);
        ctx.fillRect(gx, gy, 1, 1);
      }
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
    } else if (cat === 'tool') { if (item.tool && item.tool.kind === 'axe') this._axe(ctx, col, col2); else this._pick(ctx, col, col2); }
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

export const Sprites = new SpriteBank();
