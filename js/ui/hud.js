// Summoner Realms — in-game HUD (bars, hotbar, boss bar, clock, indicators).
import { HOTBAR_SIZE, HEAL_COOLDOWN, MANA_POTION_COOLDOWN, POTION_BUFF_COOLDOWN } from '../config.js?v=realms-2';
import { Sprites } from '../art/sprites.js?v=realms-2';
import { item as getItem } from '../data/items.js?v=realms-2';

const BUFF_ICON = { regen: '♥', ironskin: '🛡', swift: '»' };

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById('hud'),
      hpFill: document.getElementById('hpFill'),
      hpText: document.getElementById('hpText'),
      manaFill: document.getElementById('manaFill'),
      manaText: document.getElementById('manaText'),
      clock: document.getElementById('clock'),
      minionCount: document.getElementById('minionCount'),
      bossBar: document.getElementById('bossBar'),
      bossName: document.getElementById('bossName'),
      bossHpFill: document.getElementById('bossHpFill'),
      bossHpText: document.getElementById('bossHpText'),
      bossPhase: document.getElementById('bossPhase'),
      hotbar: document.getElementById('hotbar'),
      buffBar: document.getElementById('buffBar'),
      netStatus: document.getElementById('netStatus'),
      smartChip: document.getElementById('smartCursorChip'),
      toasts: document.getElementById('toasts'),
      ammo: document.getElementById('ammoIndicator'),
    };
    this._buildHotbar();
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  _buildHotbar() {
    this.el.hotbar.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      const cv = document.createElement('canvas');
      cv.width = 20; cv.height = 20; cv.className = 'slot-canvas';
      s.innerHTML = `<span class="slot-key">${(i + 1) % 10}</span>`;
      s.appendChild(cv);
      const count = document.createElement('span');
      count.className = 'slot-count';
      s.appendChild(count);
      const cd = document.createElement('div');
      cd.className = 'slot-cd';
      s.appendChild(cd);
      const cdText = document.createElement('span');
      cdText.className = 'slot-cd-text';
      s.appendChild(cdText);
      s.addEventListener('pointerdown', (e) => { e.preventDefault(); this.game.selectHotbar(i); });
      this.el.hotbar.appendChild(s);
      this.slotEls.push({ root: s, canvas: cv, ctx: cv.getContext('2d'), count, cd, cdText });
    }
  }

  // Cooldown ratio (0..1) and countdown seconds for the item in a hotbar slot.
  _slotCooldown(p, def, isSelected) {
    if (!def) return null;
    if (def.category === 'potion' && def.potion) {
      if (def.potion.heal && p.healCd > 0) return { r: p.healCd / HEAL_COOLDOWN, s: p.healCd };
      if (def.potion.mana && p.manaCd > 0) return { r: p.manaCd / MANA_POTION_COOLDOWN, s: p.manaCd };
      if (def.potion.buff && p.buffCd > 0) return { r: p.buffCd / POTION_BUFF_COOLDOWN, s: p.buffCd };
    } else if (isSelected && def.category === 'weapon' && p.useTimer > 0 && def.useTime) {
      return { r: Math.min(1, p.useTimer / def.useTime), s: 0 };
    }
    return null;
  }

  update() {
    const g = this.game;
    const p = g.localPlayer;
    if (!p) return;

    this.el.hpFill.style.width = Math.max(0, (p.hp / p.maxHp) * 100) + '%';
    this.el.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
    this.el.manaFill.style.width = Math.max(0, (p.mana / p.maxMana) * 100) + '%';
    this.el.manaText.textContent = `${Math.floor(p.mana)}/${p.maxMana}`;
    this.el.clock.textContent = g.time.label;

    // Minion count
    const cap = p.stats ? p.stats.minionCap : 1;
    const mine = g.minions.filter(m => m.ownerId === p.id).length;
    if (cap > 1 || mine > 0) { this.el.minionCount.classList.remove('hidden'); this.el.minionCount.textContent = `Minions ${mine}/${cap}`; }
    else this.el.minionCount.classList.add('hidden');

    // Buffs
    this.el.buffBar.innerHTML = '';
    for (const b of p.buffs) {
      const d = document.createElement('div');
      d.className = 'buff-icon';
      d.innerHTML = `${BUFF_ICON[b.type] || '★'}<span class="buff-time">${Math.ceil(b.time)}</span>`;
      this.el.buffBar.appendChild(d);
    }

    // Smart Cursor indicator: on whenever it is actually influencing your aim.
    const smartOn = g.settings && (g.settings.smartCursor === 'on' ||
      (g.settings.smartCursor === 'hold' && g.input.smartHeld));
    this.el.smartChip.classList.toggle('hidden', !smartOn);

    // Boss bar (first boss)
    if (g.bosses.length) {
      const b = g.bosses[0];
      this.el.bossBar.classList.remove('hidden');
      this.el.bossName.textContent = b.name + (b.enraged ? ' — ENRAGED' : '');
      const pct = Math.max(0, (b.hp / b.maxHp) * 100);
      this.el.bossHpFill.style.width = pct + '%';
      if (this.el.bossHpText) this.el.bossHpText.textContent = `${Math.max(0, Math.ceil(b.hp))} / ${b.maxHp}  (${Math.round(pct)}%)`;
      this.el.bossPhase.textContent = b.phase ? b.phase().name : (b.phaseName || '');
      // The bar flashes with the boss's wind-up, so the tell is visible even
      // when the fight has scrolled the boss off the edge of the screen.
      this.el.bossBar.classList.toggle('telegraph', b.telegraph > 0);
    } else {
      this.el.bossBar.classList.add('hidden');
    }

    // Net status
    if (g.net) {
      this.el.netStatus.classList.remove('hidden');
      this.el.netStatus.textContent = g.net.statusText();
      this.el.netStatus.className = 'chip net-status ' + g.net.statusClass();
    } else {
      this.el.netStatus.classList.add('hidden');
    }

    this._updateHotbar(p);
    this._updateAmmo(p);
  }

  _updateHotbar(p) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const el = this.slotEls[i];
      const slot = p.inventory.slots[i];
      el.root.classList.toggle('active', i === p.inventory.selected);
      const id = slot ? slot.id : null;
      if (el._itemId !== id) {
        el._itemId = id;
        el.ctx.clearRect(0, 0, 20, 20);
        if (slot) { const icon = Sprites.getIcon(getItem(slot.id)); if (icon) el.ctx.drawImage(icon, 0, 0, 20, 20); }
      }
      el.count.textContent = slot && slot.count > 1 ? slot.count : '';
      // Cooldown overlay (heal / cast / use).
      const cd = slot ? this._slotCooldown(p, getItem(slot.id), i === p.inventory.selected) : null;
      if (cd) {
        el.cd.style.height = Math.max(0, Math.min(100, cd.r * 100)) + '%';
        el.root.classList.toggle('cooling', cd.s >= 1);
        el.cdText.textContent = cd.s >= 1 ? Math.ceil(cd.s) : '';
      } else {
        el.cd.style.height = '0%';
        el.root.classList.remove('cooling');
        el.cdText.textContent = '';
      }
    }
  }

  _updateAmmo(p) {
    const sel = p.inventory.selectedItem();
    if (sel && sel.category === 'weapon' && sel.weaponClass === 'ranged' && sel.ammo) {
      const n = p.inventory.count(sel.ammo);
      const ammoName = getItem(sel.ammo).name;
      this.el.ammo.classList.remove('hidden');
      this.el.ammo.classList.toggle('empty', n <= 0);
      this.el.ammo.innerHTML = n > 0
        ? `${ammoName}: <span class="ammo-ok">${n}</span>`
        : `Out of ${ammoName}!`;
    } else if (sel && sel.category === 'throwable') {
      // Throwables consume themselves, so the count that matters is the stack.
      const n = p.inventory.count(sel.id);
      this.el.ammo.classList.remove('hidden');
      this.el.ammo.classList.toggle('empty', n <= 0);
      this.el.ammo.innerHTML = `${sel.name}: <span class="ammo-ok">${n}</span> left`;
    } else {
      this.el.ammo.classList.add('hidden');
    }
  }

  toast(msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    this.el.toasts.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1800);
    // Cap number of toasts.
    while (this.el.toasts.children.length > 5) this.el.toasts.removeChild(this.el.toasts.firstChild);
  }
}
