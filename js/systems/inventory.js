// Summoner Realms — inventory, hotbar, equipment, and derived stats.
import { HOTBAR_SIZE, INV_ROWS, INV_COLS, ACCESSORY_SLOTS } from '../config.js';
import { ITEMS, item as getItem } from '../data/items.js';

export const INV_SIZE = HOTBAR_SIZE + INV_ROWS * INV_COLS;

export class Inventory {
  constructor() {
    this.slots = new Array(INV_SIZE).fill(null); // {id, count}
    this.equip = { head: null, chest: null, legs: null, acc: [null, null, null] };
    this.selected = 0; // hotbar index
  }

  getSelected() { return this.slots[this.selected]; }
  selectedItem() { const s = this.slots[this.selected]; return s ? getItem(s.id) : null; }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id, amount) { return this.count(id) >= amount; }

  add(id, amount = 1) {
    const def = ITEMS[id];
    if (!def) return amount;
    const max = def.maxStack || 99;
    // fill existing stacks first
    for (let i = 0; i < this.slots.length && amount > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const add = Math.min(max - s.count, amount);
        s.count += add; amount -= add;
      }
    }
    // then empty slots
    for (let i = 0; i < this.slots.length && amount > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(max, amount);
        this.slots[i] = { id, count: add }; amount -= add;
      }
    }
    return amount; // leftover that didn't fit
  }

  remove(id, amount = 1) {
    if (this.count(id) < amount) return false;
    for (let i = 0; i < this.slots.length && amount > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, amount);
        s.count -= take; amount -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return true;
  }

  removeAt(index, amount = 1) {
    const s = this.slots[index];
    if (!s) return null;
    const take = Math.min(s.count, amount);
    const id = s.id;
    s.count -= take;
    if (s.count <= 0) this.slots[index] = null;
    return { id, count: take };
  }

  clear() {
    this.slots.fill(null);
    this.equip = { head: null, chest: null, legs: null, acc: [null, null, null] };
  }

  // Swap two inventory slots (for drag or click-move).
  swap(a, b) {
    const t = this.slots[a]; this.slots[a] = this.slots[b]; this.slots[b] = t;
  }

  // Equip an item from an inventory slot into the right equipment slot.
  equipFromSlot(index) {
    const s = this.slots[index];
    if (!s) return false;
    const def = getItem(s.id);
    if (!def) return false;
    if (def.category === 'armor') {
      const cur = this.equip[def.slot];
      this.equip[def.slot] = { id: s.id, count: 1 };
      this.slots[index] = cur; // swap back what was there
      return true;
    }
    if (def.category === 'accessory') {
      // find first empty acc slot, else replace acc[0]
      let ai = this.equip.acc.findIndex(a => !a);
      if (ai < 0) ai = 0;
      const cur = this.equip.acc[ai];
      this.equip.acc[ai] = { id: s.id, count: 1 };
      this.slots[index] = cur;
      return true;
    }
    return false;
  }

  unequip(kind, accIndex = 0) {
    let itemRef;
    if (kind === 'acc') { itemRef = this.equip.acc[accIndex]; }
    else itemRef = this.equip[kind];
    if (!itemRef) return false;
    const leftover = this.add(itemRef.id, 1);
    if (leftover > 0) return false; // no room
    if (kind === 'acc') this.equip.acc[accIndex] = null; else this.equip[kind] = null;
    return true;
  }

  // Aggregate stats from armor + accessories.
  getStats() {
    const st = {
      defense: 0, meleeMul: 1, rangedMul: 1, mageMul: 1, summonMul: 1,
      maxHpBonus: 0, maxManaBonus: 0, minionCap: 1, speedMul: 1, extraJumps: 0,
    };
    const pieces = [this.equip.head, this.equip.chest, this.equip.legs];
    const setCount = {};
    for (const p of pieces) {
      if (!p) continue;
      const def = getItem(p.id);
      if (!def) continue;
      st.defense += def.defense || 0;
      const sb = def.setBonus;
      if (sb) {
        if (sb.classBonus === 'melee') st.meleeMul += sb.dmgMul || 0;
        if (sb.classBonus === 'ranged') st.rangedMul += sb.dmgMul || 0;
        if (sb.classBonus === 'mage') st.mageMul += sb.dmgMul || 0;
        if (sb.classBonus === 'summon') st.summonMul += sb.dmgMul || 0;
        st.maxManaBonus += sb.maxMana || 0;
        st.minionCap += sb.minionCap || 0;
      }
      if (def.setKey) setCount[def.setKey] = (setCount[def.setKey] || 0) + 1;
    }
    // Full-set completion bonus.
    for (const key in setCount) {
      if (setCount[key] >= 3) {
        if (key === 'thornweave') { st.minionCap += 1; st.summonMul += 0.15; }
        else if (key === 'aetherweave') { st.maxManaBonus += 20; st.mageMul += 0.12; }
        else if (key === 'ironvein') { st.defense += 4; st.meleeMul += 0.1; }
        else if (key === 'hunter') { st.rangedMul += 0.12; st.speedMul += 0.1; }
        else if (key === 'blight') { st.defense += 6; }
        else if (key === 'fiber') { st.maxHpBonus += 10; }
      }
    }
    for (const a of this.equip.acc) {
      if (!a) continue;
      const def = getItem(a.id);
      if (!def || !def.accStats) continue;
      const s = def.accStats;
      st.speedMul += s.speed || 0;
      st.extraJumps += s.extraJumps || 0;
      st.maxHpBonus += s.maxHp || 0;
      st.maxManaBonus += s.maxMana || 0;
      st.minionCap += s.minionCap || 0;
      st.defense += s.defense || 0;
    }
    return st;
  }

  // Best pickaxe power owned (for the dedicated mine action). Hands = 1.
  bestMinePower() {
    let p = 1;
    for (const s of this.slots) {
      if (s) { const d = getItem(s.id); if (d && d.tool) p = Math.max(p, d.tool.power); }
    }
    return p;
  }

  serialize() {
    return { slots: this.slots, equip: this.equip, selected: this.selected };
  }
  deserialize(data) {
    if (!data) return;
    this.slots = new Array(INV_SIZE).fill(null);
    if (data.slots) for (let i = 0; i < Math.min(data.slots.length, INV_SIZE); i++) this.slots[i] = data.slots[i] || null;
    this.equip = data.equip || { head: null, chest: null, legs: null, acc: [null, null, null] };
    if (!this.equip.acc) this.equip.acc = [null, null, null];
    this.selected = data.selected || 0;
  }
}

export function starterInventory() {
  const inv = new Inventory();
  inv.add('woodPick', 1);
  inv.add('rustedShortblade', 1);
  inv.add('spriteWhistle', 1);
  inv.add('sparkWand', 1);
  inv.add('slingcaster', 1);
  inv.add('torch', 20);
  inv.add('healLesser', 5);
  inv.add('craftingBench', 1);
  return inv;
}
