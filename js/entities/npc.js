// Summoner Realms — friendly world NPCs.
//
// Vesper Thane keeps a camp on the spawn plain from the moment a world is
// created. He wanders a short leash, faces whoever is nearest, and can be spoken
// to for advice or to have an item explained (see ui/npcdialog.js). Nivara
// Frostbell uses the same safe, saveable entity with a snow-biome home.
import { TILE, GRAVITY } from '../config.js?v=snowy-taiga-npc-2';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=snowy-taiga-npc-2';
import { Projectile } from './projectile.js?v=snowy-taiga-npc-2';

const NPC_PRESETS = {
  guide: {
    name: 'Vesper Thane', title: 'the Guide', w: 12, h: 26,
    leash: 9 * TILE, talkRange: 3.2 * TILE, maxHp: 60,
    canFight: true, invulnerable: false,
    permanent: false, requiresHousing: false,
  },
  snowkeeper: {
    name: 'Nivara Frostbell', title: 'the Hearthkeeper', w: 18, h: 32,
    leash: 6 * TILE, talkRange: 3.5 * TILE, maxHp: 80,
    // Nivara is a peaceful landmark rather than another combat target. Keeping
    // her protected also prevents snow-biome enemies from pulling combat away
    // from the player just because she lives far from spawn.
    canFight: false, invulnerable: true,
    homeBiome: 'snowyTaiga', permanent: true, requiresHousing: false,
    auraRadius: 5 * TILE,
  },
};

// The player must be within this range for the Guide's Talk prompt to appear.
export const TALK_RANGE = NPC_PRESETS.guide.talkRange;

export class Npc {
  constructor(game, opts = {}) {
    const preset = NPC_PRESETS[opts.kind || 'guide'] || NPC_PRESETS.guide;
    this.kind = opts.kind || 'guide';
    this.key = this.kind === 'snowkeeper' ? 'snowkeeper' : 'guide';
    this.name = opts.name || preset.name;
    this.title = opts.title || preset.title;
    this.w = opts.w || preset.w; this.h = opts.h || preset.h;
    this.x = opts.x != null ? opts.x : 0;
    this.y = opts.y != null ? opts.y : 0;
    this.homeX = opts.homeX != null ? opts.homeX : this.x;
    this.leash = opts.leash != null ? opts.leash : preset.leash;
    this.talkRange = opts.talkRange != null ? opts.talkRange : preset.talkRange;
    this.canFight = opts.canFight != null ? opts.canFight : preset.canFight;
    this.invulnerable = opts.invulnerable != null ? opts.invulnerable : preset.invulnerable;
    this.homeBiome = opts.homeBiome || preset.homeBiome || null;
    this.permanent = opts.permanent != null ? opts.permanent : !!preset.permanent;
    this.requiresHousing = opts.requiresHousing != null ? opts.requiresHousing : !!preset.requiresHousing;
    this.auraRadius = opts.auraRadius != null ? opts.auraRadius : (preset.auraRadius || 0);
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

    // Nivara's lantern is a gameplay object, not just decoration. It gives a
    // small local recovery pulse and exposes a stronger once-per-day blessing
    // through the dialogue window. These values are local to the NPC instance
    // so they are safe in single-player and in each multiplayer client.
    this.auraActive = false;
    this.auraPulse = Math.random() * Math.PI * 2;
    this.hearthPulse = this.kind === 'snowkeeper' ? 0.4 : 0;
    this.lastHearthDay = opts.lastHearthDay != null ? opts.lastHearthDay : null;

    // The Guide has a deliberately weak, infinite-ammo bow so he can defend
    // the camp without becoming a replacement for the player's combat build.
    this.shootRange = this.canFight ? 15 * TILE : 0;
    this.shootDamage = 3;
    this.shootCooldown = 0;
    this.shootWindup = 0;
    this.shootWindupMax = 0.38;
    this.shootAngle = 0;
    this._shootTarget = null;
    this._shotAimError = 0;
    this._shotLeadFactor = 0.62;

    // Keep enough space to react to melee enemies, but don't let the Guide
    // flee forever because the danger and safe ranges are intentionally different.
    this.dangerRange = 3.5 * TILE;
    this.safeRange = 7 * TILE;
    this.retreating = false;
    this.arrowSpeed = 420;

    // The Guide is a real, killable NPC now. A death schedules three daily
    // respawn checks: two low-probability rolls, then a guaranteed return.
    this.alive = opts.alive !== false;
    this.dead = !this.alive;
    this.maxHp = opts.maxHp != null ? opts.maxHp : preset.maxHp;
    this.hp = this.alive ? Math.max(0, Math.min(this.maxHp, opts.hp != null ? opts.hp : this.maxHp)) : 0;
    this.iframes = 0;
    this.hurtFlash = 0;
    this.combatTimer = 0;
    this.respawnDay = opts.respawnDay != null ? opts.respawnDay : null;
    this.respawnAttemptDay = opts.respawnAttemptDay != null ? opts.respawnAttemptDay : null;
    this.respawnChance = 0.22;
  }

  // Build an NPC for a world, restoring saved state when there is any. Always
  // re-seats them on solid ground so a changed generator can never leave them
  // embedded in rock or hovering over a cave.
  static create(game, saved) {
    return Npc._createAt(game, saved, 'guide');
  }

  static createSnowkeeper(game, saved) {
    return Npc._createAt(game, saved, 'snowkeeper');
  }

  static _createAt(game, saved, kind) {
    const world = game.world;
    const spawnTx = world.spawnTx != null ? world.spawnTx : Math.floor(world.spawnX / TILE);
    const defaultTx = kind === 'snowkeeper' ? world.findBiomeColumn('snowyTaiga') : spawnTx + 4;
    let homeTx = defaultTx;
    if (saved && saved.homeTx != null) {
      const savedHome = Math.max(2, Math.min(world.width - 3, saved.homeTx));
      // A saved Nivara can never be moved into another biome by stale data or
      // by a generator change. She is a permanent Snowy Taiga resident and
      // does not use the game's player-housing rules.
      if (kind !== 'snowkeeper' || world.surfaceBiomeAt(savedHome) === 'snowyTaiga') homeTx = savedHome;
    }
    homeTx = Math.max(2, Math.min(world.width - 3, homeTx));

    const npc = new Npc(game, {
      kind,
      homeX: homeTx * TILE,
      met: saved ? saved.met : false,
      topicsSeen: saved ? saved.topicsSeen : [],
      alive: saved ? saved.alive !== false : true,
      hp: saved ? saved.hp : null,
      respawnDay: saved ? saved.respawnDay : null,
      respawnAttemptDay: saved ? saved.respawnAttemptDay : null,
      lastHearthDay: saved ? saved.lastHearthDay : null,
    });
    const savedTx = saved && saved.tx != null
      ? Math.max(2, Math.min(world.width - 3, saved.tx))
      : homeTx;
    const startTx = kind === 'snowkeeper' && world.surfaceBiomeAt(savedTx) !== 'snowyTaiga'
      ? homeTx
      : savedTx;
    npc.x = startTx * TILE;
    npc.y = world.spawnPixelY(startTx, npc.h);
    return npc;
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  update(dt, game) {
    if (!this.alive) {
      this._updateRespawn(game);
      return;
    }

    this.bob += dt * 2.2;
    this.blink -= dt;
    if (this.blink <= -0.12) this.blink = 2.5 + Math.random() * 3.5;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.combatTimer > 0) this.combatTimer -= dt;
    else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 5 * dt);

    const nc = this.center();
    const target = game.nearestPlayer(nc.x, nc.y);
    const talking = game.ui && game.ui.npcDialog && game.ui.npcDialog.isOpen();
    const near = target && Math.abs(target.x - this.x) < this.talkRange * 1.6;
    this._updateHearthlight(dt, game);

    // Threat detection ignores line of sight on purpose: a melee enemy that is
    // already inside the danger radius must make the Guide retreat immediately.
    let threat = !talking && !this.invulnerable ? game.nearestEnemyOrBoss(nc.x, nc.y, this.dangerRange) : null;
    if (threat && threat.dead) threat = null;
    if (threat) {
      this.retreating = true;
    } else if (this.retreating) {
      const stillClose = game.nearestEnemyOrBoss(nc.x, nc.y, this.safeRange);
      this.retreating = !!(stillClose && !stillClose.dead);
      threat = this.retreating && stillClose && !stillClose.dead ? stillClose : null;
    }

    const candidateTarget = this.canFight && !talking && !this.retreating
      ? game.nearestReachableEnemyOrBoss(nc.x, nc.y, this.shootRange)
      : null;
    const enemyTarget = candidateTarget && !candidateTarget.dead ? candidateTarget : null;

    this._updateCombat(dt, game, enemyTarget, this.retreating);

    if (this.retreating && threat) {
      this._retreatFrom(threat, game);
    } else if (talking || near) {
      // Stop and turn to face whoever is close enough to talk.
      this.vx = 0;
      if (target) this.facing = target.x + target.w / 2 < this.x + this.w / 2 ? -1 : 1;
    } else if (enemyTarget || this.shootWindup > 0) {
      // Hold position while aiming so the bow visibly tracks its target.
      this.vx = 0;
      const aimTarget = enemyTarget || this._shootTarget;
      if (aimTarget && !aimTarget.dead) this._aimAt(aimTarget);
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

  _updateHearthlight(dt, game) {
    if (this.kind !== 'snowkeeper' || !game || !game.localPlayer) return;
    const p = game.localPlayer;
    const pc = p.center();
    const nc = this.center();
    const inRange = !!p.alive && Math.hypot(pc.x - nc.x, pc.y - nc.y) <= this.auraRadius;
    this.auraActive = inRange;
    this.auraPulse = (this.auraPulse + dt * (inRange ? 2.6 : 1.1)) % (Math.PI * 2);
    if (!inRange) {
      this.hearthPulse = 0.4;
      return;
    }

    this.hearthPulse -= dt;
    if (this.hearthPulse > 0) return;
    this.hearthPulse = 2.5;
    const hpBefore = p.hp;
    const manaBefore = p.mana;
    p.heal(1.25);
    p.restoreMana(1);
    if (p.hp !== hpBefore || p.mana !== manaBefore) {
      game.floatText?.(p.x + p.w / 2, p.y - 7, 'Hearthlight', '#b9f4ff');
      game.fx?.ring(p.x + p.w / 2, p.y + p.h / 2, '#b9f4ff', 18, { life: 0.28, width: 1.2 });
      game.markDirty?.();
    }
  }

  _updateRespawn(game) {
    if (!game || !game.time || this.respawnDay == null) return;
    const day = Math.max(1, Math.floor(game.time.day || 1));
    if (day < this.respawnDay || this.respawnAttemptDay === day) return;

    this.respawnAttemptDay = day;
    const attempt = day - this.respawnDay + 1;
    const guaranteed = attempt >= 3;
    if (!guaranteed && Math.random() >= this.respawnChance) return;

    const tx = Math.max(2, Math.min(game.world.width - 3, Math.round(this.homeX / TILE)));
    this.x = tx * TILE;
    this.y = game.world.spawnPixelY(tx, this.h);
    this.vx = 0;
    this.vy = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.dead = false;
    this.iframes = 1.2;
    this.hurtFlash = 0;
    this.combatTimer = 0;
    this.respawnDay = null;
    this.respawnAttemptDay = null;
    this.retreating = false;
    this.shootWindup = 0;
    this._shootTarget = null;
    game.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#7ee0c0', 38, { life: 0.35, width: 2 });
    game.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#7ee0c0', 16, { speed: 100, life: 0.55, glow: true });
    game.toast?.('The Guide has returned.', 'good');
    game.markDirty?.();
  }

  _retreatFrom(threat, game) {
    const tc = threat.center ? threat.center() : { x: threat.x + threat.w / 2, y: threat.y + threat.h / 2 };
    const nc = this.center();
    let dir = Math.sign(nc.x - tc.x);
    if (!dir) dir = this.facing || 1;
    this.facing = dir;
    this.vx = dir * 86;

    // Try to hop a wall or one-tile obstruction instead of getting pinned
    // beside the enemy.
    const blockedAhead = game.world.rectHitsSolid(this.x + dir * 18, this.y, this.w, this.h);
    if (this.onGround && blockedAhead) this.vy = -250;
  }

  _updateCombat(dt, game, target, retreating = false) {
    if (this.shootCooldown > 0) this.shootCooldown -= dt;

    if (retreating) {
      this.shootWindup = 0;
      this._shootTarget = null;
      this._shotAimError = 0;
      return;
    }

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
    // Keep each shot readable and consistent during its wind-up, but give the
    // Guide a small human-sized miss chance instead of perfect tracking.
    this._shotAimError = (Math.random() * 2 - 1) * 0.06;
    this._shotLeadFactor = 0.55 + Math.random() * 0.18;
    this._aimAt(target);
    this.shootWindup = this.shootWindupMax;
  }

  _aimAt(target) {
    const tc = target.center ? target.center() : { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    const nc = this.center();

    // Use a practical lead and compensate for normal arrow drop, but do not
    // solve a perfect intercept. The Guide should land useful shots while
    // still missing enough that he cannot carry a boss on his own.
    const distance = Math.hypot(tc.x - nc.x, tc.y - nc.y);
    const flightTime = Math.max(0.12, Math.min(1.35, distance / this.arrowSpeed));
    const leadTime = flightTime * this._shotLeadFactor;
    const predictedX = tc.x + (target.vx || 0) * leadTime;
    const predictedY = tc.y + (target.vy || 0) * leadTime;
    const gravity = GRAVITY * 0.5;
    const drop = 0.5 * gravity * flightTime * flightTime;
    const horizontal = predictedX - nc.x;
    const vertical = predictedY - nc.y - drop;

    this.shootAngle = Math.atan2(vertical, horizontal) + this._shotAimError;
    this.facing = horizontal < 0 ? -1 : 1;
  }
  _fireArrow(game, target) {
    const nc = this.center();
    const speed = this.arrowSpeed;
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
    if (offset < -this.leash) this._dir = 1;
    else if (offset > this.leash) this._dir = -1;

    this.vx = this._dir * 34;
    this.facing = this._dir;
    if (this._pause < 0) {
      this._pause += dt * 2;
      if (this._pause >= 0) { this._dir = 0; this._pause = 1.5 + Math.random() * 3; }
    }
  }

  takeDamage(amount, knockbackX, game, srcName) {
    if (!this.alive || this.iframes > 0 || this.invulnerable) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this.iframes = 0.45;
    this.hurtFlash = 0.16;
    this.combatTimer = 4;
    this.vx = knockbackX || 0;
    this.vy = -120;
    game?.audio?.playerHurt?.();
    game?.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#ff6b7d', 6);
    game?.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#ff6b7d');

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.dead = true;
      this.respawnDay = (game?.time?.day || 1) + 1;
      this.respawnAttemptDay = null;
      this.shootWindup = 0;
      this._shootTarget = null;
      this.retreating = false;
      game?.fx?.burst(this.x + this.w / 2, this.y + this.h / 2, '#ff6b7d', 18, { speed: 150, life: 0.7, glow: true });
      game?.toast?.('The Guide has fallen. He may return within three days.', 'bad');
      game?.markDirty?.();
    }
  }

  canTalkTo(player) {
    if (!this.alive || !player || !player.alive) return false;
    const dx = (player.x + player.w / 2) - (this.x + this.w / 2);
    const dy = (player.y + player.h / 2) - (this.y + this.h / 2);
    return Math.hypot(dx, dy) <= this.talkRange;
  }

  serialize() {
    return {
      kind: this.kind,
      tx: Math.round(this.x / TILE),
      homeTx: Math.round(this.homeX / TILE),
      met: this.met,
      topicsSeen: [...this.topicsSeen],
      alive: this.alive,
      hp: this.hp,
      respawnDay: this.respawnDay,
      respawnAttemptDay: this.respawnAttemptDay,
      lastHearthDay: this.lastHearthDay,
    };
  }
}
