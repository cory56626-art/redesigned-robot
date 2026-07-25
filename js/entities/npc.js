// Summoner Realms — the Guide NPC.
//
// Vesper Thane keeps a camp on the spawn plain from the moment a world is
// created. He wanders a short leash, faces whoever is nearest, and can be spoken
// to for advice or to have an item explained (see ui/npcdialog.js).
import { TILE } from '../config.js?v=realms-2';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=realms-2';
import { Projectile } from './projectile.js?v=realms-3';

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

    // The Guide has a deliberately weak, infinite-ammo bow so he can defend
    // the camp without becoming a replacement for the player's combat build.
    this.shootRange = 15 * TILE;
    this.shootDamage = 3;
    this.shootCooldown = 0;
    this.shootWindup = 0;
    this.shootWindupMax = 0.38;
    this.shootAngle = 0;
    this._shootTarget = null;
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
    const enemyTarget = !talking
      ? game.nearestReachableEnemyOrBoss(this.x + this.w / 2, this.y + this.h / 2, this.shootRange)
      : null;

    this._updateCombat(dt, game, enemyTarget);

    if (talking || near) {
      // Stop and turn to face whoever is close enough to talk.
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else if (enemyTarget || this.shootWindup > 0) {
      // Hold position while aiming so the bow visibly tracks its target.
      this.vx = 0;
      const aimTarget = enemyTarget || this._shootTarget;
      if (aimTarget && !aimTarget.dead) {
        this._aimAt(aimTarget);
      }
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

  _updateCombat(dt, game, target) {
    if (this.shootCooldown > 0) this.shootCooldown -= dt;

    if (this.shootWindup > 0) {
      this.shootWindup -= dt;
      const liveTarget = target && !target.dead ? target : this._shootTarget;
      if (liveTarget && !liveTarget.dead) this._aimAt(liveTarget);
      if (this.shootWindup <= 0) {
        this.shootWindup = 0;
        if (liveTarget && !liveTarget.dead) this._fireArrow(game, liveTarget);
        else this._shootTarget = null;
      }
      return;
    }

    if (!target || this.shootCooldown > 0) return;
    this._shootTarget = target;
    this._aimAt(target);
    this.shootWindup = this.shootWindupMax;
  }

  _aimAt(target) {
    const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const nc = this.center();
    this.shootAngle = Math.atan2(tc.y - nc.y, tc.x - nc.x);
    this.facing = Math.cos(this.shootAngle) < 0 ? -1 : 1;
  }

  _fireArrow(game, target) {
    const nc = this.center();
    const speed = 330;
    const x = nc.x + Math.cos(this.shootAngle) * 9 - 3;
    const y = nc.y + Math.sin(this.shootAngle) * 9 - 3;
    game.addProjectile(new Projectile({
      x, y,
      vx: Math.cos(this.shootAngle) * speed,
      vy: Math.sin(this.shootAngle) * speed,
      damage: this.shootDamage,
      ownerType: 'npc',
      ownerId: this.key,
      kind: 'arrow',
      color: '#e9e2c8',
      gravity: true,
      knockback: 1,
      life: 2.5,
    }), true);
    game.audio?.bowShot();
    game.fx?.streak(nc.x, nc.y, this.shootAngle, '#e9e2c8', 3, { speed: 55, life: 0.14, size: 2 });
    this.shootCooldown = 1.05;
    this._shootTarget = null;
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
