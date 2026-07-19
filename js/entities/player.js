// Summoner Realms — player entity (local and remote).
import {
  PLAYER_W, PLAYER_H, BASE_HP, BASE_MANA, MOVE_SPEED, JUMP_VELOCITY,
  MANA_REGEN, HP_REGEN, TILE,
  HEAL_COOLDOWN, MANA_POTION_COOLDOWN, POTION_BUFF_COOLDOWN,
  CAST_REGEN_DELAY, CAST_REGEN_MULT,
} from '../config.js';
import { tileDef } from '../world/tiles.js';
import { moveAndCollide, applyGravity, clampToWorld } from './physics.js';
import { Inventory } from '../systems/inventory.js';
import { item as getItem } from '../data/items.js';
import * as combat from '../systems/combat.js';
import { clamp } from '../utils.js';

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
    this.maxHp = BASE_HP; this.hp = BASE_HP;
    this.maxMana = BASE_MANA; this.mana = BASE_MANA;
    this.useTimer = 0;
    this.placeTimer = 0;
    this.iframes = 0;
    this.kbTimer = 0;
    // Consumable + casting cooldowns (persist across inventory/hotbar/death so
    // they cannot be bypassed). See config.js for the tunable values.
    this.healCd = 0;
    this.manaCd = 0;
    this.buffCd = 0;
    this.castTimer = 0;   // throttles mana regen right after a cast
    this.hazardTimer = 0; // gates contact damage from hazard tiles (thornvine)
    this.buffs = [];
    this.alive = true;
    this.respawnTimer = 0;
    this.swing = null; // {time, dur, dir, item}
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
    this._tickTimers(dt);
    if (this.swing) { this.swing.time += dt; if (this.swing.time >= this.swing.dur) this.swing = null; }
  }

  _localUpdate(dt, game) {
    this._tickTimers(dt);

    if (!this.alive) {
      this.respawnTimer -= dt;
      return;
    }

    const st = this.stats || this.inventory.getStats();
    const input = game.input.state;
    const canAct = game.canAct();

    // ---- Movement ----
    let speed = MOVE_SPEED * st.speedMul;
    for (const b of this.buffs) if (b.type === 'swift') speed *= (1 + b.speed);

    const moveX = canAct ? input.moveX : 0;
    if (this.kbTimer > 0) {
      this.kbTimer -= dt; // knockback owns velocity briefly
    } else {
      this.vx = moveX * speed;
    }
    if (moveX < -0.1) this.facing = -1; else if (moveX > 0.1) this.facing = 1;

    // ---- Jump / fly ----
    const extraJumps = st.extraJumps;
    if (this.cheats.fly) {
      this.vy = 0;
      if (input.jumpHeld) this.vy = -260;
      else if (input.moveX === 0 && game.input.keys && game.input.keys.has('s')) this.vy = 220;
      else this.vy = 40; // gentle sink
      // No gravity in fly.
      moveAndCollide(this, game.world, dt);
      clampToWorld(this, game.world);
    } else {
      if (canAct && input.jumpPressed) {
        if (this.onGround) { this.vy = -JUMP_VELOCITY; this.jumpsLeft = extraJumps; }
        else if (this.jumpsLeft > 0) { this.vy = -JUMP_VELOCITY * 0.92; this.jumpsLeft--; }
      }
      // Variable jump height
      if (!input.jumpHeld && this.vy < -140) this.vy *= 0.55;
      applyGravity(this, dt);
      moveAndCollide(this, game.world, dt);
      clampToWorld(this, game.world);
      if (this.onGround) this.jumpsLeft = extraJumps;
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

    // ---- Hazard tiles (thornvine etc.) ----
    this._tickHazards(game);

    // Swing anim
    if (this.swing) { this.swing.time += dt; if (this.swing.time >= this.swing.dur) this.swing = null; }

    // Fell into the void
    if (this.y > game.world.height * TILE + 200) this.takeDamage(9999, 0, game);
  }

  _tickTimers(dt) {
    if (this.useTimer > 0) this.useTimer -= dt;
    if (this.placeTimer > 0) this.placeTimer -= dt;
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
  }

  startHealCooldown() { this.healCd = HEAL_COOLDOWN; }
  startManaCooldown() { this.manaCd = MANA_POTION_COOLDOWN; }
  startBuffCooldown() { this.buffCd = POTION_BUFF_COOLDOWN; }

  _handleActions(dt, game, input) {
    const sel = this.inventory.selectedItem();
    this.selectedId = sel ? sel.id : null;

    // Consume (potion) via dedicated button/key.
    if (input.consumePressed && sel && sel.category === 'potion') combat.consumeSelected(game, this);

    // Dedicated mine (RMB / mobile Mine) — auto-picks the right tool for the tile.
    if (input.mineHeld) combat.mineAt(game, this, dt, { auto: true });

    // Dedicated place (mobile Place button).
    if (input.placeHeld && sel && (sel.category === 'block' || sel.category === 'station')) {
      if (this.placeTimer <= 0) { if (combat.placeSelected(game, this)) this.placeTimer = 0.12; }
    }

    // Primary use.
    if (input.primaryHeld && sel) {
      if (sel.category === 'tool') {
        combat.mineAt(game, this, dt, { tool: sel });
      } else if (sel.category === 'block' || sel.category === 'station') {
        if (this.placeTimer <= 0) { if (combat.placeSelected(game, this)) this.placeTimer = 0.12; }
      } else if (sel.category === 'potion') {
        if (input.primaryPressed) combat.consumeSelected(game, this);
      } else if (sel.category === 'weapon') {
        if (this.useTimer <= 0) combat.useWeapon(game, this, sel);
      } else if (sel.category === 'summonitem') {
        if (input.primaryPressed) combat.useSummonItem(game, this, sel);
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
    this.respawnTimer = 3;
    this.vx = 0; this.vy = 0;
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
    const sx = game.world.spawnX, sy = game.world.spawnPixelY(Math.floor(game.world.spawnX / TILE), this.h);
    this.x = sx; this.y = sy;
    this.vx = 0; this.vy = 0;
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

export function assignColor(index) {
  const pool = ['#7ee0c0', '#c58bff', '#ffcf6b', '#ff8b9a', '#8ad9ff', '#9ee07e', '#ff9a5a', '#b0a6ff'];
  return pool[index % pool.length];
}
