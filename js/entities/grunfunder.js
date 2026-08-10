// Summoner Realms — Grunfunder, the cursed traveler of the Corrupted Lands.
//
// Quest arc:
//   stranded   → talk → following (escort out of the corruption)
//   following  → leave corrupt surface → betrayal monologue → boss spawn
//   dormant    → boss fight (or incomplete clear); respawn stranded if lost
//   awaitingThanks → true defeat revive in the caves → talk → bodyguard
//   bodyguard  → follows the player, fights with gear from his personal bag
//
// He is a second NPC, separate from the Guide, so he never steals the camp seat
// or the Guide's dialogue tree.
import { TILE, GRAVITY } from '../config.js?v=realms-qor-49';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=realms-qor-49';
import { Projectile } from './projectile.js?v=realms-qor-49';
import { Inventory } from '../systems/inventory.js?v=realms-qor-49';
import { item as getItem } from '../data/items.js?v=realms-qor-49';

const NPC_W = 12, NPC_H = 26;
export const GRUNFUNDER_TALK_RANGE = 3.2 * TILE;
export const GRUNFUNDER_BAG_SIZE = 8;

// Modes the world save serialises.
export const GF_MODE = {
  STRANDED: 'stranded',
  FOLLOWING: 'following',
  BETRAYING: 'betraying',
  DORMANT: 'dormant',
  AWAITING: 'awaitingThanks',
  BODYGUARD: 'bodyguard',
};

export class Grunfunder {
  constructor(game, opts = {}) {
    this.key = 'grunfunder';
    this.name = 'Grunfunder';
    this.title = 'the Cursed Traveler';
    this.w = NPC_W; this.h = NPC_H;
    this.x = opts.x != null ? opts.x : 0;
    this.y = opts.y != null ? opts.y : 0;
    this.homeX = opts.homeX != null ? opts.homeX : this.x;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.stepHeight = TILE + 2;
    this.walkAnim = 0;
    this.bob = Math.random() * 6;
    this.blink = 2 + Math.random() * 3;
    this.met = !!opts.met;

    this.mode = opts.mode || GF_MODE.STRANDED;
    this.alive = opts.alive !== false && this.mode !== GF_MODE.DORMANT;
    this.dead = !this.alive;
    this.maxHp = 90;
    this.hp = this.alive ? Math.max(0, Math.min(this.maxHp, opts.hp != null ? opts.hp : this.maxHp)) : 0;
    this.iframes = 0;
    this.hurtFlash = 0;
    this.combatTimer = 0;

    // Betray monologue (spoken while still following, then he dies).
    this.betrayTimer = opts.betrayTimer != null ? opts.betrayTimer : 0;
    this.betrayLine = opts.betrayLine != null ? opts.betrayLine : 0;
    this._pause = 1 + Math.random() * 2;
    this._dir = 0;

    // Combat (bodyguard). Base stats; gear from the personal bag can raise them.
    this.shootRange = 14 * TILE;
    this.shootDamage = 8;
    this.shootCooldown = 0;
    this.shootWindup = 0;
    this.shootWindupMax = 0.32;
    this.shootAngle = 0;
    this._shootTarget = null;
    this.meleeRange = 2.4 * TILE;
    this.meleeCooldown = 0;
    this.dangerRange = 4 * TILE;
    this.safeRange = 8 * TILE;
    this.retreating = false;
    this.arrowSpeed = 400;
    this.weaponKind = 'sword'; // sword | bow — chosen from bag contents

    // Personal inventory the player stocks in bodyguard mode.
    this.bag = new Inventory();
    // Inventory is full-size under the hood; we only expose GRUNFUNDER_BAG_SIZE.
    if (opts.bag) {
      for (let i = 0; i < Math.min(GRUNFUNDER_BAG_SIZE, opts.bag.length); i++) {
        this.bag.slots[i] = opts.bag[i] ? { id: opts.bag[i].id, count: opts.bag[i].count } : null;
      }
    }
    this._recomputeLoadout();
  }

  static create(game, saved) {
    const world = game.world;
    let homeTx;
    if (saved && saved.homeTx != null) {
      homeTx = Math.max(2, Math.min(world.width - 3, saved.homeTx));
    } else {
      homeTx = world.findBiomeColumn('corrupt');
      // Nudge a few tiles inland so he is clearly inside the corruption band.
      const bias = Math.floor(world.width * 0.02);
      homeTx = Math.max(2, Math.min(world.width - 3, homeTx + bias));
    }

    const mode = saved?.mode || GF_MODE.STRANDED;
    const npc = new Grunfunder(game, {
      homeX: homeTx * TILE,
      met: saved ? !!saved.met : false,
      mode,
      alive: saved ? saved.alive !== false : true,
      hp: saved ? saved.hp : null,
      bag: saved ? saved.bag : null,
      betrayTimer: saved ? saved.betrayTimer : 0,
      betrayLine: saved ? saved.betrayLine : 0,
    });

    if (mode === GF_MODE.DORMANT) {
      npc.alive = false;
      npc.dead = true;
      npc.hp = 0;
      return npc;
    }

    let startTx = homeTx;
    if (saved && saved.tx != null) {
      startTx = Math.max(2, Math.min(world.width - 3, saved.tx));
    } else if (mode === GF_MODE.AWAITING || mode === GF_MODE.BODYGUARD) {
      startTx = npc._findCaveColumn(world) ?? homeTx;
    }

    npc.x = startTx * TILE;
    if (mode === GF_MODE.AWAITING || (saved && saved.ty != null && (mode === GF_MODE.BODYGUARD || mode === GF_MODE.AWAITING))) {
      const ty = saved && saved.ty != null
        ? Math.max(2, Math.min(world.height - 4, saved.ty))
        : npc._findCaveFloorY(world, startTx);
      npc.y = ty * TILE;
      // Seat on solid ground if the saved spot is open air.
      if (!world.rectHitsSolid(npc.x, npc.y + npc.h, npc.w, 2)) {
        npc.y = world.spawnPixelY(startTx, npc.h);
        // Prefer underground seat when awaiting.
        if (mode === GF_MODE.AWAITING) {
          const cy = npc._findCaveFloorY(world, startTx);
          if (cy != null) npc.y = cy * TILE - npc.h;
        }
      } else {
        npc.y = world.spawnPixelY(startTx, npc.h);
      }
    } else {
      npc.y = world.spawnPixelY(startTx, npc.h);
    }
    return npc;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  // ---- Quest helpers -------------------------------------------------------

  isTalkable() {
    return this.alive && (
      this.mode === GF_MODE.STRANDED ||
      this.mode === GF_MODE.FOLLOWING ||
      this.mode === GF_MODE.AWAITING ||
      this.mode === GF_MODE.BODYGUARD
    );
  }

  canTalkTo(player) {
    if (!this.isTalkable() || !player || !player.alive) return false;
    const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
    const dy = (player.y + player.h / 2) - (this.y + this.h / 2);
    return Math.hypot(dx, dy) <= GRUNFUNDER_TALK_RANGE;
  }

  // Player accepted the rescue quest.
  beginEscort(game) {
    if (this.mode !== GF_MODE.STRANDED) return;
    this.mode = GF_MODE.FOLLOWING;
    this.met = true;
    game.toast?.('Escort Grunfunder out of the Corrupted Lands.', 'info');
    game.markDirty?.();
  }

  // True defeat: place him in the caves waiting to thank the player.
  reviveInCaves(game) {
    const world = game.world;
    const tx = this._findCaveColumn(world) ?? Math.floor(world.width * 0.45);
    const ty = this._findCaveFloorY(world, tx);
    this.mode = GF_MODE.AWAITING;
    this.alive = true;
    this.dead = false;
    this.hp = this.maxHp;
    this.x = tx * TILE;
    this.y = (ty != null ? ty * TILE - this.h : world.spawnPixelY(tx, this.h));
    this.homeX = this.x;
    this.vx = 0; this.vy = 0;
    this.iframes = 1.5;
    game.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#e9e2c8', 42, { life: 0.4, width: 2 });
    game.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#e9e2c8', 18, { speed: 110, life: 0.55, glow: true });
    game.toast?.('A grateful whisper echoes from the caves…', 'good');
    game.markDirty?.();
  }

  becomeBodyguard(game) {
    this.mode = GF_MODE.BODYGUARD;
    this.title = 'the Bodyguard';
    this.alive = true;
    this.dead = false;
    this.hp = this.maxHp;
    this._recomputeLoadout();
    game.toast?.('Grunfunder joins you as a bodyguard.', 'good');
    game.markDirty?.();
  }

  // Incomplete boss clear or mid-fight wipe: put him back in the corruption.
  resetToStranded(game) {
    const world = game.world;
    let homeTx = Math.round(this.homeX / TILE);
    if (world.surfaceBiomeAt(homeTx) !== 'corrupt') {
      homeTx = world.findBiomeColumn('corrupt');
    }
    homeTx = Math.max(2, Math.min(world.width - 3, homeTx));
    this.homeX = homeTx * TILE;
    this.mode = GF_MODE.STRANDED;
    this.alive = true;
    this.dead = false;
    this.hp = this.maxHp;
    this.x = this.homeX;
    this.y = world.spawnPixelY(homeTx, this.h);
    this.vx = 0; this.vy = 0;
    this.betrayTimer = 0;
    this.betrayLine = 0;
    this.iframes = 1;
    game.markDirty?.();
  }

  // Vanish while the boss fight is live.
  goDormant(game) {
    this.mode = GF_MODE.DORMANT;
    this.alive = false;
    this.dead = true;
    this.hp = 0;
    this.vx = 0; this.vy = 0;
    game.markDirty?.();
  }

  // ---- Update --------------------------------------------------------------

  update(dt, game) {
    if (this.mode === GF_MODE.DORMANT || !this.alive) return;

    this.bob += dt * 2.2;
    this.blink -= dt;
    if (this.blink <= -0.12) this.blink = 2.5 + Math.random() * 3.5;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.combatTimer > 0) this.combatTimer -= dt;
    else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 6 * dt);
    if (this.shootCooldown > 0) this.shootCooldown -= dt;
    if (this.meleeCooldown > 0) this.meleeCooldown -= dt;

    if (this.mode === GF_MODE.BETRAYING) {
      this._updateBetrayal(dt, game);
      return;
    }

    const talking = game.ui?.npcDialog?.isOpen() && game.ui.npcDialog.npc === this;
    const target = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);

    if (this.mode === GF_MODE.FOLLOWING) {
      this._updateFollowing(dt, game, target, talking);
    } else if (this.mode === GF_MODE.BODYGUARD) {
      this._updateBodyguard(dt, game, target, talking);
    } else if (this.mode === GF_MODE.STRANDED) {
      this._updateStranded(dt, game, target, talking);
    } else if (this.mode === GF_MODE.AWAITING) {
      // Stay put and face the player.
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
      applyGravity(this, dt);
      moveAndCollide(this, game.world, dt);
      clampToWorld(this, game.world);
    }

    if (Math.abs(this.vx) > 5) this.walkAnim += dt * 10; else this.walkAnim = 0;
  }

  _updateStranded(dt, game, target, talking) {
    const near = target && Math.abs(target.x - this.x) < GRUNFUNDER_TALK_RANGE * 1.6;
    if (talking || near) {
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else {
      this._wander(dt);
    }
    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
    // Keep him inside the corruption band while stranded.
    this._keepInCorruption(game);
  }

  _updateFollowing(dt, game, target, talking) {
    if (!target) {
      this.vx = 0;
      applyGravity(this, dt);
      moveAndCollide(this, game.world, dt);
      return;
    }

    // Leaving the corrupted surface triggers the betrayal.
    if (this._hasLeftCorruption(game, target)) {
      this._beginBetrayal(game);
      return;
    }

    if (talking) {
      this.vx = 0;
      this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else {
      this._followPlayer(game, target, 70);
    }
    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
  }

  _updateBodyguard(dt, game, target, talking) {
    const nc = this.center();
    let threat = !talking ? game.nearestEnemyOrBoss(nc.x, nc.y, this.dangerRange) : null;
    if (threat && threat.dead) threat = null;
    if (threat) this.retreating = true;
    else if (this.retreating) {
      const still = game.nearestEnemyOrBoss(nc.x, nc.y, this.safeRange);
      this.retreating = !!(still && !still.dead);
      threat = this.retreating && still && !still.dead ? still : null;
    }

    const enemyTarget = !talking && !this.retreating
      ? game.nearestReachableEnemyOrBoss(nc.x, nc.y, this.shootRange)
      : null;

    this._updateCombat(dt, game, enemyTarget && !enemyTarget.dead ? enemyTarget : null);

    if (talking) {
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else if (this.retreating && threat) {
      this._retreatFrom(threat);
    } else if (enemyTarget && this.weaponKind === 'sword' && this._distTo(enemyTarget) < this.meleeRange) {
      // Close the gap for melee.
      this.facing = enemyTarget.x + enemyTarget.w / 2 < this.x + this.w / 2 ? -1 : 1;
      this.vx = this.facing * 90;
      if (this.onGround && game.world.rectHitsSolid(this.x + this.facing * 16, this.y, this.w, this.h)) {
        this.vy = -250;
      }
    } else if (enemyTarget) {
      this.vx = 0;
      this._aimAt(enemyTarget);
    } else if (target) {
      this._followPlayer(game, target, 95);
    } else {
      this.vx = 0;
    }

    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);
  }

  _followPlayer(game, target, speed) {
    const dx = (target.x + target.w / 2) - (this.x + this.w / 2);
    const dy = (target.y + target.h / 2) - (this.y + this.h / 2);
    const dist = Math.hypot(dx, dy);
    // Soft leash: stop when close so he doesn't push the player around.
    if (dist < 28) { this.vx = 0; this.facing = dx < 0 ? -1 : 1; return; }
    this.facing = dx < 0 ? -1 : 1;
    this.vx = Math.sign(dx) * speed;
    if (this.onGround) {
      const blocked = game.world.rectHitsSolid(this.x + this.facing * 14, this.y, this.w, this.h);
      const gap = !game.world.rectHitsSolid(this.x + this.facing * 10, this.y + this.h + 2, this.w, 4)
        && !game.world.rectHitsSolid(this.x + this.facing * 10, this.y + this.h + TILE, this.w, 4);
      if (blocked || (gap && dy < 40)) this.vy = -280;
    }
    // If the player is far above (rope / tower), hop repeatedly.
    if (this.onGround && dy < -40 && Math.abs(dx) < 80) this.vy = -300;
  }

  _beginBetrayal(game) {
    this.mode = GF_MODE.BETRAYING;
    this.betrayTimer = 0;
    this.betrayLine = 0;
    this.vx = 0; this.vy = 0;
    // Close any open dialog so the monologue is the focus.
    if (game.ui?.npcDialog?.isOpen() && game.ui.npcDialog.npc === this) {
      game.ui.npcDialog.close();
    }
    game.toast?.('Grunfunder stops at the edge of the blight…', 'bad');
    game.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#c58bff', 50, { life: 0.5, width: 2 });
  }

  _updateBetrayal(dt, game) {
    this.vx = 0;
    applyGravity(this, dt);
    moveAndCollide(this, game.world, dt);
    clampToWorld(this, game.world);

    const target = game.nearestPlayer(this.x + this.w / 2, this.y + this.h / 2);
    if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;

    this.betrayTimer += dt;
    // Staged monologue toasts — the "talk" that reveals the setup.
    const lines = [
      { t: 0.4, msg: 'Grunfunder: "Wait… this is far enough."' },
      { t: 2.6, msg: 'Grunfunder: "I… I am so sorry. I never wanted this."' },
      { t: 5.0, msg: 'Grunfunder: "The curse inside me needed a vessel. You led me out — and freed it."' },
      { t: 7.8, msg: 'Grunfunder: "Forgive me…"' },
    ];
    while (this.betrayLine < lines.length && this.betrayTimer >= lines[this.betrayLine].t) {
      game.toast?.(lines[this.betrayLine].msg, this.betrayLine >= 2 ? 'bad' : 'info');
      this.betrayLine++;
    }

    if (this.betrayTimer >= 9.4) {
      this._dieAndSpawnBoss(game);
    }
  }

  _dieAndSpawnBoss(game) {
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    game.fx?.burst(cx, cy, ['#e9e2c8', '#c58bff', '#5a2f7a'], 40, { speed: 220, life: 0.9, glow: true, gravity: 80 });
    game.fx?.ring(cx, cy, '#ff6b7d', 90, { life: 0.55, width: 4 });
    game.fx?.shake(8, 0.55);
    game.toast?.('The Rotten One emerges from Grunfunder\'s corpse!', 'bad');

    this.goDormant(game);

    if (game.isHost) {
      // Clear any existing boss so the quest fight always starts clean.
      if (game.bosses.length) game.clearBosses(true);
      game.spawnBossByKey('rottenOne');
    } else if (game.net) {
      // Clients ask the host to materialise the boss.
      game.net.toHost({ t: 'cmd', cmd: 'spawnboss', args: { key: 'rottenOne' } });
    }
    game.markDirty?.();
  }

  // Surface biome of the player (not depth) — leaving the corruption band is
  // what ends the escort, even if they tunnel underground.
  _hasLeftCorruption(game, player) {
    const tx = Math.floor((player.x + player.w / 2) / TILE);
    return game.world.surfaceBiomeAt(tx) !== 'corrupt';
  }

  _keepInCorruption(game) {
    const tx = Math.floor((this.x + this.w / 2) / TILE);
    if (game.world.surfaceBiomeAt(tx) === 'corrupt') return;
    const homeTx = Math.max(2, Math.min(game.world.width - 3, Math.round(this.homeX / TILE)));
    this.x = homeTx * TILE;
    this.y = game.world.spawnPixelY(homeTx, this.h);
    this.vx = 0; this.vy = 0;
  }

  _findCaveColumn(world) {
    // Prefer a column under forest/frostpine with open cavern space.
    const candidates = [];
    const step = Math.max(8, Math.floor(world.width / 40));
    for (let tx = 20; tx < world.width - 20; tx += step) {
      const surface = world.surfaceBiomeAt(tx);
      if (surface === 'corrupt' || surface === 'dunes') continue;
      const ty = this._findCaveFloorY(world, tx);
      if (ty != null) candidates.push(tx);
    }
    if (!candidates.length) {
      // Fall back to any cavern pocket.
      for (let tx = 30; tx < world.width - 30; tx += step) {
        const ty = this._findCaveFloorY(world, tx);
        if (ty != null) candidates.push(tx);
      }
    }
    if (!candidates.length) return null;
    return candidates[(Math.random() * candidates.length) | 0];
  }

  _findCaveFloorY(world, tx) {
    // Scan the cavern layer for a 2-tile air pocket over solid floor.
    const start = Math.max(world.surfaceY(tx) + 12, 40);
    const end = Math.min(world.height - 6, start + 80);
    for (let ty = start; ty < end; ty++) {
      if (!world.isSolidAt(tx, ty) && !world.isSolidAt(tx, ty - 1) && world.isSolidAt(tx, ty + 1)) {
        return ty + 1; // floor tile; caller seats entity on top
      }
    }
    return null;
  }

  // ---- Combat (bodyguard) --------------------------------------------------

  _recomputeLoadout() {
    // Scan the personal bag for the best weapon the player stocked.
    let bestMelee = null, bestRanged = null;
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE; i++) {
      const s = this.bag.slots[i];
      if (!s) continue;
      const def = getItem(s.id);
      if (!def || !def.weaponClass) continue;
      if (def.weaponClass === 'melee') {
        if (!bestMelee || (def.damage || 0) > (bestMelee.damage || 0)) bestMelee = def;
      } else if (def.weaponClass === 'ranged') {
        if (!bestRanged || (def.damage || 0) > (bestRanged.damage || 0)) bestRanged = def;
      }
    }
    // Prefer melee if both present and melee is stronger or close; otherwise bow.
    if (bestMelee && (!bestRanged || (bestMelee.damage || 0) >= (bestRanged.damage || 0) * 0.85)) {
      this.weaponKind = 'sword';
      this.shootDamage = Math.max(8, Math.round((bestMelee.damage || 10) * 0.55));
      this.meleeRange = Math.min(3.2 * TILE, (bestMelee.reach || 36) + 8);
    } else if (bestRanged) {
      this.weaponKind = 'bow';
      this.shootDamage = Math.max(6, Math.round((bestRanged.damage || 8) * 0.55));
      this.shootRange = 16 * TILE;
    } else {
      this.weaponKind = 'sword';
      this.shootDamage = 8;
      this.meleeRange = 2.4 * TILE;
    }

    // Armor scraps in the bag raise his durability a little.
    let armorBonus = 0;
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE; i++) {
      const s = this.bag.slots[i];
      if (!s) continue;
      const def = getItem(s.id);
      if (def && def.category === 'armor') armorBonus += 12;
    }
    this.maxHp = 90 + armorBonus;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }

  _distTo(e) {
    const c = e.center ? e.center() : { x: e.x + e.w / 2, y: e.y + e.h / 2 };
    const nc = this.center();
    return Math.hypot(c.x - nc.x, c.y - nc.y);
  }

  _updateCombat(dt, game, target) {
    if (this.shootWindup > 0) {
      this.shootWindup -= dt;
      const live = target && !target.dead ? target : this._shootTarget;
      if (live && !live.dead) this._aimAt(live);
      if (this.shootWindup <= 0) {
        this.shootWindup = 0;
        if (live && !live.dead) {
          if (this.weaponKind === 'sword' && this._distTo(live) <= this.meleeRange * 1.15) {
            this._meleeStrike(game, live);
          } else {
            this._fireArrow(game, live);
          }
        }
        this._shootTarget = null;
      }
      return;
    }
    if (!target || this.shootCooldown > 0) return;
    this._shootTarget = target;
    this._aimAt(target);
    this.shootWindup = this.shootWindupMax;
  }

  _aimAt(target) {
    const tc = target.center ? target.center() : { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const nc = this.center();
    this.shootAngle = Math.atan2(tc.y - nc.y, tc.x - nc.x);
    this.facing = tc.x < nc.x ? -1 : 1;
  }

  _meleeStrike(game, target) {
    const nc = this.center();
    const dmg = this.shootDamage;
    game.hurtEnemyOrBoss?.(target, dmg, this.facing * 4, 'grunfunder', false);
    game.fx?.streak(nc.x, nc.y, this.shootAngle, '#e9e2c8', 4, { speed: 70, life: 0.12, size: 2 });
    game.audio?.swordSwing?.();
    this.shootCooldown = 0.55;
  }

  _fireArrow(game, target) {
    const nc = this.center();
    const speed = this.arrowSpeed;
    game.addProjectile(new Projectile({
      x: nc.x + Math.cos(this.shootAngle) * 8 - 3,
      y: nc.y + Math.sin(this.shootAngle) * 8 - 3,
      vx: Math.cos(this.shootAngle) * speed,
      vy: Math.sin(this.shootAngle) * speed,
      damage: this.shootDamage,
      ownerType: 'npc',
      ownerId: this.key,
      kind: 'arrow',
      color: '#e9e2c8',
      gravity: true,
      knockback: 1.4,
      life: 2.4,
    }), true);
    game.audio?.bowShot?.();
    this.shootCooldown = 0.9;
  }

  _retreatFrom(threat) {
    const tc = threat.center ? threat.center() : { x: threat.x + threat.w / 2, y: threat.y + threat.h / 2 };
    const nc = this.center();
    let dir = Math.sign(nc.x - tc.x) || this.facing || 1;
    this.facing = dir;
    this.vx = dir * 90;
  }

  _wander(dt) {
    this._pause -= dt;
    if (this._pause > 0) { this.vx = 0; return; }
    if (this._dir === 0) {
      this._dir = Math.random() < 0.5 ? -1 : 1;
      this._pause = -(0.7 + Math.random() * 1.4);
    }
    const offset = this.x - this.homeX;
    const leash = 7 * TILE;
    if (offset < -leash) this._dir = 1;
    else if (offset > leash) this._dir = -1;
    this.vx = this._dir * 30;
    this.facing = this._dir;
    if (this._pause < 0) {
      this._pause += dt * 2;
      if (this._pause >= 0) { this._dir = 0; this._pause = 1.5 + Math.random() * 3; }
    }
  }

  takeDamage(amount, knockbackX, game, srcName) {
    if (!this.alive || this.iframes > 0) return;
    // Stranded / following / awaiting: he is mostly a story prop. Only the
    // bodyguard form is meant to tank hits for the player.
    if (this.mode !== GF_MODE.BODYGUARD) {
      this.hurtFlash = 0.1;
      this.iframes = 0.3;
      return;
    }
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 0.4;
    this.hurtFlash = 0.16;
    this.combatTimer = 4;
    this.vx = knockbackX || 0;
    this.vy = -110;
    game?.audio?.playerHurt?.();
    game?.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#ff6b7d', 6);
    game?.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#ff6b7d');
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dead = true;
      // Bodyguard "downs" temporarily; he regenerates near the player later.
      this._downedTimer = 18;
      game?.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#e9e2c8', 16, { speed: 140, life: 0.6, glow: true });
      game?.toast?.('Grunfunder has fallen! He will recover nearby…', 'bad');
      game?.markDirty?.();
    }
  }

  // Called from game loop while dead in bodyguard mode.
  updateDowned(dt, game) {
    if (this.mode !== GF_MODE.BODYGUARD || this.alive) return;
    this._downedTimer = (this._downedTimer || 18) - dt;
    if (this._downedTimer > 0) return;
    const p = game.nearestPlayer?.(this.x, this.y) || game.localPlayer;
    if (p) {
      this.x = p.x - p.facing * 24;
      this.y = p.y;
    }
    this.alive = true;
    this.dead = false;
    this.hp = Math.round(this.maxHp * 0.5);
    this.iframes = 2;
    game.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#7ee0c0', 30, { life: 0.3, width: 2 });
    game.toast?.('Grunfunder is back on his feet.', 'good');
    game.markDirty?.();
  }

  // Accept an item from the player's inventory into the personal bag.
  acceptItem(player, slotIndex) {
    if (this.mode !== GF_MODE.BODYGUARD) return { ok: false, reason: 'Not bodyguard' };
    const taken = player.inventory.removeAt(slotIndex, 1);
    if (!taken) return { ok: false, reason: 'Empty slot' };
    // Find a free bag slot or stack.
    const leftover = this._bagAdd(taken.id, taken.count);
    if (leftover > 0) {
      // Couldn't fit — give it back.
      player.inventory.add(taken.id, leftover);
      if (leftover === taken.count) return { ok: false, reason: 'Bag full' };
    }
    this._recomputeLoadout();
    return { ok: true, item: taken.id };
  }

  _bagAdd(id, amount = 1) {
    const def = getItem(id);
    if (!def) return amount;
    const max = def.maxStack || 99;
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE && amount > 0; i++) {
      const s = this.bag.slots[i];
      if (s && s.id === id && s.count < max) {
        const add = Math.min(max - s.count, amount);
        s.count += add; amount -= add;
      }
    }
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE && amount > 0; i++) {
      if (!this.bag.slots[i]) {
        const add = Math.min(max, amount);
        this.bag.slots[i] = { id, count: add }; amount -= add;
      }
    }
    return amount;
  }

  // Pull an item back out of the bag into the player inventory.
  returnItem(player, bagIndex) {
    if (bagIndex < 0 || bagIndex >= GRUNFUNDER_BAG_SIZE) return false;
    const s = this.bag.slots[bagIndex];
    if (!s) return false;
    const left = player.inventory.add(s.id, s.count);
    if (left >= s.count) return false;
    if (left > 0) s.count = left;
    else this.bag.slots[bagIndex] = null;
    this._recomputeLoadout();
    return true;
  }

  serialize() {
    const bag = [];
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE; i++) {
      const s = this.bag.slots[i];
      bag.push(s ? { id: s.id, count: s.count } : null);
    }
    return {
      tx: Math.round(this.x / TILE),
      ty: Math.round(this.y / TILE),
      homeTx: Math.round(this.homeX / TILE),
      met: this.met,
      mode: this.mode,
      alive: this.alive,
      hp: this.hp,
      bag,
      betrayTimer: this.betrayTimer,
      betrayLine: this.betrayLine,
    };
  }
}
