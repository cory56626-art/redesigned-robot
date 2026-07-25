// Summoner Realms — the Guide NPC.
//
// Vesper Thane keeps a camp on the spawn plain from the moment a world is
// created. He wanders a short leash, faces whoever is nearest, and can be spoken
// to for advice or to have an item explained (see ui/npcdialog.js).
import { TILE } from '../config.js';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js';

const NPC_W = 12, NPC_H = 26;
// How far the Guide will stray from his camp, in world pixels.
const LEASH = 9 * TILE;
// The player must be within this range for the Talk prompt to appear.
export const TALK_RANGE = 3.2 * TILE;

export class Npc {
  constructor(game, opts = {}) {
    this.key = 'guide';
    this.name = 'Vesper Thane';
    this.title = 'the Guide';
    this.w = NPC_W; this.h = NPC_H;
    this.x = opts.x != null ? opts.x : 0;
    this.y = opts.y != null ? opts.y : 0;
    this.homeX = opts.homeX != null ? opts.homeX : this.x;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.stepHeight = TILE + 2; // same auto-climb the player gets
    this.walkAnim = 0;
    this.bob = Math.random() * 6;
    this.blink = 2 + Math.random() * 3;
    this.met = !!opts.met;
    this.topicsSeen = new Set(opts.topicsSeen || []);
    // Wander state: alternates between pausing and strolling.
    this._pause = 1 + Math.random() * 2;
    this._dir = 0;
  }

  // Build the Guide for a world, restoring saved state when there is any.
  // Always re-seats him on solid ground so a changed generator can never leave
  // him embedded in rock or hovering over a cave.
  static create(game, saved) {
    const world = game.world;
    const tx = world.spawnTx != null ? world.spawnTx : Math.floor(world.spawnX / TILE);
    let homeTx = tx + 4;
    if (saved && saved.homeTx != null) homeTx = saved.homeTx;
    homeTx = Math.max(2, Math.min(world.width - 3, homeTx));

    const npc = new Npc(game, {
      homeX: homeTx * TILE,
      met: saved ? saved.met : false,
      topicsSeen: saved ? saved.topicsSeen : [],
    });
    const startTx = saved && saved.tx != null
      ? Math.max(2, Math.min(world.width - 3, saved.tx))
      : homeTx;
    npc.x = startTx * TILE;
    npc.y = world.spawnPixelY(startTx, npc.h);
    return npc;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  update(dt, game) {
    this.bob += dt * 2.2;
    this.blink -= dt;
    if (this.blink <= -0.12) this.blink = 2.5 + Math.random() * 3.5;

    const target = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    const talking = game.ui && game.ui.npcDialog && game.ui.npcDialog.isOpen();
    const near = target && Math.abs(target.x - this.x) < TALK_RANGE * 1.6;

    if (talking || near) {
      // Stop and turn to face whoever is close enough to talk.
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else {
      this._wander(dt);
    }

    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
    if (Math.abs(this.vx) > 5) this.walkAnim += dt * 10; else this.walkAnim = 0;

    // If he somehow ends up in a pit or buried, walk him back to camp.
    if (this.y > game.world.height * TILE - 64 || game.world.rectHitsSolid(this.x, this.y, this.w, this.h)) {
      const tx = Math.floor(this.homeX / TILE);
      this.x = this.homeX;
      this.y = game.world.spawnPixelY(tx, this.h);
      this.vx = 0; this.vy = 0;
    }
  }

  _wander(dt) {
    this._pause -= dt;
    if (this._pause > 0) { this.vx = 0; return; }
    if (this._dir === 0) {
      this._dir = Math.random() < 0.5 ? -1 : 1;
      this._pause = -(0.8 + Math.random() * 1.6); // negative = time spent walking
    }
    // Turn around at the leash edge rather than drifting away from camp.
    const offset = this.x - this.homeX;
    if (offset < -LEASH) this._dir = 1;
    else if (offset > LEASH) this._dir = -1;

    this.vx = this._dir * 34;
    this.facing = this._dir;
    if (this._pause < 0) {
      this._pause += dt * 2;
      if (this._pause >= 0) { this._dir = 0; this._pause = 1.5 + Math.random() * 3; }
    }
  }

  canTalkTo(player) {
    if (!player || !player.alive) return false;
    const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
    const dy = (player.y + player.h / 2) - (this.y + this.h / 2);
    return Math.hypot(dx, dy) <= TALK_RANGE;
  }

  serialize() {
    return {
      tx: Math.round(this.x / TILE),
      homeTx: Math.round(this.homeX / TILE),
      met: this.met,
      topicsSeen: [...this.topicsSeen],
    };
  }
}
