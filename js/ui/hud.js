// Summoner Realms — in-game HUD (bars, hotbar, boss bar, clock, indicators).
import { HOTBAR_SIZE } from '../config.js';
import { Sprites } from '../art/sprites.js';
import { item as getItem } from '../data/items.js';

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
      bossPhase: document.getElementById('bossPhase'),
      hotbar: document.getElementById('hotbar'),
      buffBar: document.getElementById('buffBar'),
      netStatus: document.getElementById('netStatus'),
      toasts: document.getElementById('toasts'),
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
      s.addEventListener('pointerdown', (e) => { e.preventDefault(); this.game.selectHotbar(i); });
      this.el.hotbar.appendChild(s);
      this.slotEls.push({ root: s, canvas: cv, ctx: cv.getContext('2d'), count });
    }
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

    // Boss bar (first boss)
    if (g.bosses.length) {
      const b = g.bosses[0];
      this.el.bossBar.classList.remove('hidden');
      this.el.bossName.textContent = b.name;
      this.el.bossHpFill.style.width = Math.max(0, (b.hp / b.maxHp) * 100) + '%';
      this.el.bossPhase.textContent = b.phase ? b.phase().name : (b.phaseName || '');
    } else {
      this.el.bossBar.classList.add('hidden');
    }

    // Net status
    if (g.net) {
      this.el.netStatus.classList.remove('hidden');
      this.el.netStatus.textContent = g.net.statusText();
      this.el.netStatus.className = 'net-status ' + g.net.statusClass();
    } else {
      this.el.netStatus.classList.add('hidden');
    }

    this._updateHotbar(p);
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
