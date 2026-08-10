// Summoner Realms — player entity (local and remote).
import {
  PLAYER_W, PLAYER_H, BASE_HP, BASE_MANA, MOVE_SPEED, JUMP_VELOCITY,
  MANA_REGEN, HP_REGEN, TILE,
  HEAL_COOLDOWN, MANA_POTION_COOLDOWN, POTION_BUFF_COOLDOWN,
  CAST_REGEN_DELAY, CAST_REGEN_MULT, RESPAWN_DELAY, RESPAWN_DELAY_BOSS,
  SWIM_DRAG, SWIM_STROKE, WIND_PLAYER_PUSH,
} from '../config.js?v=runeframe-1';
import { tileDef } from '../world/tiles.js?v=runeframe-1';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js?v=runeframe-1';
import { Inventory } from '../systems/inventory.js?v=runeframe-1';
import { item as getItem } from '../data/items.js?v=runeframe-1';
import * as combat from '../systems/combat.js?v=runeframe-1';
import * as fishing from '../systems/fishing.js?v=runeframe-1';
import { clamp } from '../utils.js?v=runeframe-1';

export class Player {
  constructor(id, opts = {}) {
    this.id = id;
    this.name = opts.name || 'Summoner';
    this.color = opts.color || '#7ee0c0';
    this.isLocal = !!opts.isLocal;
    this.w = PLAYER_W; this.h = PLAYER_H;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.stepHeight = TILE + 2; // auto-climb 1-tile ledges (see physics.moveAndCollide)
    this.jumpsLeft = 0;
    // Vespera Wings replenish a short, controlled flight reserve on landing.
    // Keeping the reserve on the player lets the accessory stay declarative in
    // item data and prevents holding jump from granting unlimited lift.
    this.flightLeft = 0;
    this.wingActive = false;
    this.coyoteTimer = 0;
    this.maxHp = BASE_HP; this.hp = BASE_HP;
    this.maxMana = BASE_MANA; this.mana = BASE_MANA;
    this.useTimer = 0;
    this.placeTimer = 0;
    this.hammerTimer = 0;
    this.mineSoundTimer = 0;
    this.iframes = 0;
    this.kbTimer = 0;
    // Consumable + casting cooldowns (persist across inventory/hotbar/death so
    // they cannot be bypassed). See config.js for the tunable values.
    this.healCd = 0;
    this.manaCd = 0;
    this.buffCd = 0;
    this.castTimer = 0;   // throttles mana regen right after a cast
    this.hazardTimer = 0; // gates contact damage from hazard tiles (thornvine)
    this.poison = null;   // { time, tick, dps } from poison dart traps
    this.buffs = [];
    this.alive = true;
    this.respawnTimer = 0;
    this.swing = null; // {time, dur, dir, item}
    this.fishing = null; // active cast: {tx,ty,x,y,timer,biting,...}
    this.submerged = false;
    this.inventory = new Inventory();
    this.cheats = { fly: false, godmode: false };
    this.selectedId = null; // for remote render
    this.netTarget = null;  // {x,y} for remote interpolation
    this.combatTimer = 0;   // time since last hit (for regen gating)
    this.walkAnim = 0;
    this.remoteMinions = []; // for remote render only
  }

  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  recomputeStats() {
    const st = this.inventory.getStats();
    this.stats = st;
    const newMaxHp = BASE_HP + st.maxHpBonus;
    const newMaxMana = BASE_MANA + st.maxManaBonus;
    this.maxHp = newMaxHp;
    this.maxMana = newMaxMana;
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    if (this.mana > this.maxMana) this.mana = this.maxMana;
  }

  update(dt, game) {
    if (this.isLocal) this._localUpdate(dt, game);
    else this._remoteUpdate(dt, game);
  }

  _remoteUpdate(dt, game) {
    if (this.netTarget) {
      const k = 1 - Math.pow(0.0005, dt);
      const nx = this.x + (this.netTarget.x - this.x) * k;
      const ny = this.y + (this.netTarget.y - this.y) * k;
      this.facing = this.netTarget.x < this.x - 0.5 ? -1 : this.netTarget.x > this.x + 0.5 ? 1 : this.facing;
      this.x = nx; this.y = ny;
    }
    if (Math.abs(this.vx) > 5 || (this.netTarget && Math.abs(this.netTarget.x - this.x) > 1)) this.walkAnim += dt * 10;
    this._tickTimers(dt, game);
    if (this.swing) { this.swing.time += dt; if (this.swing.time >= this.swing.dur) this.swing = null; }
  }

  _localUpdate(dt, game) {
    this._tickTimers(dt, game);

    if (!this.alive) {
      if (this.respawnTimer > 0) this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      return;
    }

    const st = this.stats || this.inventory.getStats();
    const input = game.input.state;
    const canAct = game.canAct();

    // Water changes how everything below behaves: you sink slowly, move
    // sluggishly, and jump becomes a swim stroke.
    this.submerged = game.world.liquid
      ? game.world.liquid.rectSubmerged(this.x, this.y, this.w, this.h)
      : false;

    // ---- Movement ----
    let speed = MOVE_SPEED * st.speedMul;
    for (const b of this.buffs) if (b.type === 'swift') speed *= (1 + b.speed);
    if (this.submerged) speed *= SWIM_DRAG;

    const moveX = canAct ? input.moveX : 0;
    if (this.kbTimer > 0) {
      this.kbTimer -= dt; // knockback owns velocity briefly
    } else {
      this.vx = moveX * speed;
      // Wind pushes you along the surface. Deliberately small — enough to feel
      // the weather, never enough to fight it — and zero underground, where the
      // wind does not reach and precision matters most.
      if (!this.submerged && game.weather) {
        const wind = game.weather.windAt(game.world, this.x + this.w / 2, this.y + this.h / 2);
        this.vx += wind * MOVE_SPEED * WIND_PLAYER_PUSH;
      }
    }
    if (moveX < -0.1) this.facing = -1; else if (moveX > 0.1) this.facing = 1;

    // ---- Jump / fly ----
    const extraJumps = st.extraJumps;
    const jumpMul = st.jumpMul || 1;
    if (this.cheats.fly) {
      this.wingActive = false;
      this.vy = 0;
      if (input.jumpHeld) this.vy = -260;
      else if (input.moveX === 0 && game.input.keys && game.input.keys.has('s')) this.vy = 220;
      else this.vy = 40; // gentle sink
      // No gravity in fly.
      moveAndCollide(this, game.world, dt);
      clampToWorld(this, game.world);
    } else {
      if (this.onGround) {
        this.coyoteTimer = 0.1;
        this.flightLeft = Math.max(0, st.flightTime || 0);
      }
      else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

      if (canAct && this.submerged && input.jumpHeld) {
        // Swimming: holding jump strokes upward repeatedly rather than needing
        // a fresh press per stroke, which is what makes crossing a pool feel
        // like swimming instead of like failing to jump.
        this.vy = Math.min(this.vy, -SWIM_STROKE);
        game.input.consumeJumpPress();
      } else if (canAct && input.jumpPressed) {
        if (this.onGround || this.coyoteTimer > 0) {
          this.vy = -JUMP_VELOCITY * jumpMul;
          this.jumpsLeft = extraJumps;
          this.coyoteTimer = 0;
          game.input.consumeJumpPress();
          game.audio?.jump();
        } else if (this.jumpsLeft > 0) {
          this.vy = -JUMP_VELOCITY * 0.92 * jumpMul;
          this.jumpsLeft--;
          game.input.consumeJumpPress();
          game.audio?.jump();
        }
      }
      // Wings are an air-control tool rather than a second full jump. Holding
      // jump spends the small reserve at a capped lift speed; letting go
      // immediately returns to the normal, readable fall arc.
      const canFly = canAct && !this.submerged && !this.onGround && input.jumpHeld &&
        (st.flightTime || 0) > 0 && this.flightLeft > 0;
      this.wingActive = !!canFly;
      if (canFly) {
        const lift = st.flightLift || 245;
        this.vy = Math.min(this.vy, -lift);
        this.flightLeft = Math.max(0, this.flightLeft - dt);
      }
      // Variable jump height (out of water only — a swim stroke is not a jump).
      if (!this.submerged && !input.jumpHeld && this.vy < -140) this.vy *= 0.55;
      applyGravity(this, dt, this.submerged);
      // The same wings make descent predictable when their flight reserve is
      // spent, without cancelling gravity or allowing permanent hovering.
      if (!this.submerged && !this.onGround && (st.glideFallSpeed || 0) > 0 && this.vy > 0) {
        this.vy = Math.min(this.vy, st.glideFallSpeed);
      }
      moveAndCollide(this, game.world, dt);
      clampToWorld(this, game.world);
      if (this.onGround) {
        this.jumpsLeft = extraJumps;
        this.flightLeft = Math.max(0, st.flightTime || 0);
      }
    }

    if (Math.abs(this.vx) > 5) this.walkAnim += dt * 12; else this.walkAnim = 0;

    // ---- Actions ----
    if (canAct) this._handleActions(dt, game, input);

    // ---- Regen ----
    this.combatTimer -= dt;
    let hpRegen = HP_REGEN;
    for (const b of this.buffs) if (b.type === 'regen') hpRegen += b.hpRegen;
    if (this.combatTimer <= 0 || hpRegen > HP_REGEN) this.hp = Math.min(this.maxHp, this.hp + hpRegen * dt);
    // Mana regen is throttled briefly after each cast so magic has real upkeep.
    const manaRegen = MANA_REGEN * (this.castTimer > 0 ? CAST_REGEN_MULT : 1);
    this.mana = Math.min(this.maxMana, this.mana + manaRegen * dt);

    // ---- Fishing line ----
    fishing.tickFishing(game, this, dt);

    // ---- Hazard tiles (thornvine etc.) ----
    this._tickHazards(game);

    // Swing anim
    if (this.swing) { this.swing.time += dt; if (this.swing.time >= this.swing.dur) this.swing = null; }

    // Fell into the void
    if (this.y > game.world.height * TILE + 200) this.takeDamage(9999, 0, game);
  }

  _tickTimers(dt, game) {
    if (this.useTimer > 0) this.useTimer -= dt;
    if (this.placeTimer > 0) this.placeTimer -= dt;
    if (this.hammerTimer > 0) this.hammerTimer -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.healCd > 0) this.healCd -= dt;
    if (this.manaCd > 0) this.manaCd -= dt;
    if (this.buffCd > 0) this.buffCd -= dt;
    if (this.castTimer > 0) this.castTimer -= dt;
    if (this.hazardTimer > 0) this.hazardTimer -= dt;
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].time -= dt;
      if (this.buffs[i].time <= 0) this.buffs.splice(i, 1);
    }
    if (this.poison) {
      this.poison.time -= dt;
      this.poison.tick -= dt;
      if (this.poison.time <= 0) {
        this.poison = null;
      } else if (this.isLocal && this.alive && !this.cheats.godmode && this.poison.tick <= 0) {
        // Poison is a small, steady follow-up rather than another knockback
        // hit. It intentionally ignores the normal contact iframe so a dart
        // still matters after the initial strike.
        this.poison.tick += 1;
        const dmg = this.poison.dps;
        this.hp -= dmg;
        this.combatTimer = 4;
        game?.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#8be06f', 3);
        game?.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#8be06f');
        if (this.hp <= 0) { this.hp = 0; this.die(game, 'poison'); }
      }
    }
  }

  applyStatusEffect(effect, game) {
    if (!effect || !effect.poison || !this.alive) return;
    const duration = Math.max(1, Number(effect.poison) || 0);
    const current = this.poison;
    this.poison = {
      time: Math.max(duration, current ? current.time : 0),
      tick: Math.min(current ? current.tick : 0.9, 0.9),
      dps: 2,
    };
    if (this.isLocal) {
      game?.floatText(this.x + this.w / 2, this.y - 7, 'POISONED', '#9be871');
      game?.fx?.ring(this.x + this.w / 2, this.y + this.h / 2, '#8be06f', 22, { life: 0.3, width: 1.5 });
    }
  }

  startHealCooldown() { this.healCd = HEAL_COOLDOWN; }
  startManaCooldown() { this.manaCd = MANA_POTION_COOLDOWN; }
  startBuffCooldown() { this.buffCd = POTION_BUFF_COOLDOWN; }

  _handleActions(dt, game, input) {
    const sel = this.inventory.selectedItem();
    this.selectedId = sel ? sel.id : null;

    // Clicking the Guide talks to them rather than swinging at them.
    if (input.primaryPressed && game.clickedNpc && game.clickedNpc(input.aimX, input.aimY)) return;

    // Clicking a bug collects it as bait rather than attacking it. Swatting a
    // cricket with a sword and getting nothing would be a poor way to learn
    // that bugs are the fishing bait.
    if (input.primaryPressed && game.catchBugAt && game.catchBugAt(input.aimX, input.aimY)) return;

    // Consume (potion) via dedicated button/key.
    if (input.consumePressed && sel && sel.category === 'potion') combat.consumeSelected(game, this);

    // Dedicated mine (RMB / mobile Mine) — auto-picks the right tool for the tile.
    if (input.mineHeld) combat.mineAt(game, this, dt, { auto: true });

    // Dedicated place (mobile Place button).
    //
    // Placeability is decided by whether the item *has* a tile to place, not by
    // its category. Dirt, stone, wood, sand and every other raw material carry a
    // `place` tile while staying category 'material' — gating on the category
    // made the blocks you actually mine impossible to place, which is the
    // single most-reported bug in this build. `canPlaceAt` and the Smart Cursor
    // already key off `place`; this makes all three agree.
    if (input.placeHeld && sel && sel.place != null) {
      if (this.placeTimer <= 0) { if (combat.placeSelected(game, this)) this.placeTimer = 0.12; }
    }

    // Mobile Terraria-style Aim & Use: holding the right aim stick also uses
    // tools and non-summon weapons. Summon weapons intentionally stay manual so
    // a cursor adjustment never accidentally spawns/replaces a minion.
    const aimUse = input.aimHeld && aimUseItem(sel);

    // Primary use. Include the queued edge so a quick desktop click still
    // reaches weapons and summons after mouseup before the next fixed step.
    const primaryUse = input.primaryHeld || input.primaryPressed || aimUse;
    if (primaryUse && sel) {
      if (sel.category === 'tool') {
        if (sel.tool && sel.tool.kind === 'hammer') combat.hammerAt(game, this, dt);
        else combat.mineAt(game, this, dt, { tool: sel });
      } else if (sel.place != null) {
        if (this.placeTimer <= 0) { if (combat.placeSelected(game, this)) this.placeTimer = 0.12; }
      } else if (sel.category === 'potion') {
        if (input.primaryPressed) combat.consumeSelected(game, this);
      } else if (sel.category === 'bucket') {
        if (input.primaryPressed && this.useTimer <= 0) combat.useBucket(game, this, sel);
      } else if (sel.category === 'fishingrod') {
        // One press casts, the next reels — so it must be edge-triggered, or
        // holding the button would cast and reel on alternate frames.
        if (input.primaryPressed && this.useTimer <= 0) fishing.useRod(game, this, sel);
      } else if (sel.category === 'weapon') {
        if (this.useTimer <= 0) combat.useWeapon(game, this, sel);
      } else if (sel.category === 'throwable') {
        // One throw per press: holding the button should not empty the stack.
        if (input.primaryPressed) combat.throwItem(game, this, sel);
      } else if (sel.category === 'summonitem') {
        // The quick-click queue remains active for a few fixed steps. Give
        // summon items a short use lock so one click cannot produce a valid
        // summon followed by an immediate "A boss is already present" toast.
        if (input.primaryPressed && this.useTimer <= 0) {
          combat.useSummonItem(game, this, sel);
          this.useTimer = 0.22;
        }
      }
    }
  }

  // Contact damage from hazard tiles (e.g. corrupted thornvines) the player is
  // standing in. Non-solid so they never block movement, but they sting.
  _tickHazards(game) {
    if (this.hazardTimer > 0 || this.cheats.godmode || !this.alive) return;
    const x0 = Math.floor(this.x / TILE), x1 = Math.floor((this.x + this.w - 0.001) / TILE);
    const y0 = Math.floor(this.y / TILE), y1 = Math.floor((this.y + this.h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const def = tileDef(game.world.get(tx, ty));
        if (def.hazard) { this.takeDamage(def.hazard, this.facing * -2, game, 'thornvine'); this.hazardTimer = 0.8; return; }
      }
    }
  }

  spendMana(n) {
    if (this.mana < n) return false;
    this.mana -= n; return true;
  }

  takeDamage(amount, knockbackX, game, srcName) {
    if (!this.alive) return;
    if (this.iframes > 0) return;
    if (this.cheats.godmode) { this.iframes = 0.2; return; }
    const def = this.stats ? this.stats.defense : 0;
    let dmg = Math.max(1, Math.round(amount - def * 0.5));
    for (const b of this.buffs) if (b.type === 'ironskin') dmg = Math.max(1, dmg - b.defense);
    this.hp -= dmg;
    game.audio?.playerHurt();
    this.iframes = 0.6;
    this.combatTimer = 4;
    this.kbTimer = 0.2;
    this.vx = knockbackX;
    this.vy = -160;
    if (game) game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#ff6b7d');
    if (game) game.floatText(this.x + this.w / 2, this.y, '-' + dmg, '#ff6b7d');
    if (this.hp <= 0) { this.hp = 0; this.die(game, srcName); }
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
  restoreMana(n) { this.mana = Math.min(this.maxMana, this.mana + n); }

  die(game, srcName) {
    this.alive = false;
    // Dying mid-boss costs real time, so trading your life for a free reset is
    // no longer the cheapest way through a fight.
    const bossActive = game && game.bosses && game.bosses.length > 0;
    this.respawnTimer = bossActive ? RESPAWN_DELAY_BOSS : RESPAWN_DELAY;
    this.vx = 0; this.vy = 0; this.wingActive = false; this.flightLeft = 0;
    if (game) {
      game.addHitParticles(this.x + this.w / 2, this.y + this.h / 2, '#ff6b7d', 24);
      if (this.isLocal) game.onLocalDeath(srcName);
      // Clear this player's minions.
      game.removeMinionsOf(this.id);
    }
  }

  respawn(game) {
    this.alive = true;
    this.hp = this.maxHp;
    this.mana = this.maxMana;
    this.iframes = 2;
    this.poison = null;
    const sx = game.world.spawnX, sy = game.world.spawnPixelY(Math.floor(game.world.spawnX / TILE), this.h);
    this.x = sx; this.y = sy;
    this.vx = 0; this.vy = 0; this.wingActive = false; this.flightLeft = 0;
  }

  // Networked state (sent by owner each tick).
  netState() {
    return {
      id: this.id, name: this.name, color: this.color,
      x: Math.round(this.x), y: Math.round(this.y),
      hp: Math.round(this.hp), maxHp: this.maxHp,
      mana: Math.round(this.mana), maxMana: this.maxMana,
      facing: this.facing, alive: this.alive,
      selectedId: this.selectedId,
      walk: Math.round(this.walkAnim * 10) % 100,
    };
  }
  applyNetState(s) {
    this.name = s.name; this.color = s.color;
    this.netTarget = { x: s.x, y: s.y };
    this.hp = s.hp; this.maxHp = s.maxHp; this.mana = s.mana; this.maxMana = s.maxMana;
    this.facing = s.facing; this.alive = s.alive; this.selectedId = s.selectedId;
    this.walkAnim = (s.walk || 0) / 10;
  }
}

function aimUseItem(item) {
  if (!item) return false;
  if (item.category === 'tool') return true; // axes and pickaxes
  return item.category === 'weapon' && item.weaponClass !== 'summon';
}

export function assignColor(index) {
  const pool = ['#7ee0c0', '#c58bff', '#ffcf6b', '#ff8b9a', '#8ad9ff', '#9ee07e', '#ff9a5a', '#b0a6ff'];
  return pool[index % pool.length];
}
