// Summoner Realms — the Guide's dialogue window.
//
// Two modes: a list of topics he can talk about, and an item-inspection mode
// where you hand him something from your bag and he explains it. The content
// itself lives in data/guide.js; this file is only presentation.
import { INV_SIZE } from '../systems/inventory.js?v=realms-qor-48';
import { Sprites } from '../art/sprites.js?v=realms-qor-48';
import { item as getItem } from '../data/items.js?v=realms-qor-48';
import { TOPICS, describeItem, greeting } from '../data/guide.js?v=realms-qor-48';

const $ = (id) => document.getElementById(id);

export class NpcDialog {
  constructor(game) {
    this.game = game;
    this.npc = null;
    this.mode = 'topics';
    this._wire();
  }

  _wire() {
    $('npcClose').onclick = () => this.close();
    // Clicking the world outside the panel closes the conversation, so you can
    // walk away from it the way you'd walk away from a person.
    $('npcDialog').addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.npc-panel')) this.close();
    });
  }

  isOpen() { return !$('npcDialog').classList.contains('hidden'); }
  toggle(npc) { this.isOpen() ? this.close() : this.open(npc); }

  open(npc) {
    this.npc = npc || this.game.npc;
    if (!this.npc) return;
    npc.met = true;
    $('npcName').textContent = this.npc.name;
    $('npcTitle').textContent = this.npc.title;
    this._drawPortrait();
    this.mode = 'topics';
    this._say([`<p>${greeting(this.game, this.game.localPlayer)}</p>`]);
    this._renderTopics();
    $('npcDialog').classList.remove('hidden');
    this.game.onMenuOpened();
  }

  close() {
    $('npcDialog').classList.add('hidden');
    this.mode = 'topics';
  }

  // A little portrait drawn from the same shapes the world sprite uses, so the
  // face in the window is recognisably the person standing in front of you.
  _drawPortrait() {
    const cv = $('npcPortrait');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2140'; ctx.fillRect(0, 0, 48, 48);
    // hood
    ctx.fillStyle = '#463a63'; ctx.fillRect(8, 6, 32, 12);
    ctx.fillRect(6, 12, 6, 26); ctx.fillRect(36, 12, 6, 26);
    // face
    ctx.fillStyle = '#e8c6a2'; ctx.fillRect(13, 14, 22, 20);
    // eyes
    ctx.fillStyle = '#2b2338'; ctx.fillRect(18, 21, 4, 4); ctx.fillRect(28, 21, 4, 4);
    // beard
    ctx.fillStyle = '#d8d2e4'; ctx.fillRect(14, 30, 20, 10);
    ctx.fillRect(11, 26, 4, 12); ctx.fillRect(33, 26, 4, 12);
    // robe
    ctx.fillStyle = '#5b4a7a'; ctx.fillRect(8, 40, 32, 8);
  }

  _say(paragraphs) {
    $('npcBody').innerHTML = paragraphs.join('');
  }

  _renderTopics() {
    const wrap = $('npcTopics');
    wrap.innerHTML = '';
    for (const t of TOPICS) {
      const b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = t.label;
      b.onclick = () => {
        const lines = t.text(this.game, this.game.localPlayer) || [];
        this._say(lines.map(l => `<p>${l}</p>`));
        this.npc.topicsSeen.add(t.id);
        this.game.markDirty();
      };
      wrap.appendChild(b);
    }
    const inspect = document.createElement('button');
    inspect.className = 'btn small primary';
    inspect.textContent = 'Explain an item';
    inspect.onclick = () => this._renderInspect();
    wrap.appendChild(inspect);
  }

  // Item inspection: show everything the player is carrying and explain
  // whichever one they hand over.
  _renderInspect() {
    const p = this.game.localPlayer;
    const wrap = $('npcTopics');
    this._say(['<p>Show me. Anything in that bag — I&rsquo;ll tell you what it does and where it comes from.</p>']);
    wrap.innerHTML = '';

    const grid = document.createElement('div');
    grid.className = 'npc-items';
    let any = false;
    const seen = new Set();
    for (let i = 0; i < INV_SIZE; i++) {
      const ref = p.inventory.slots[i];
      if (!ref || seen.has(ref.id)) continue;
      seen.add(ref.id);
      any = true;
      const def = getItem(ref.id);
      const cell = document.createElement('div');
      cell.className = 'inv-slot';
      cell.title = def.name;
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const icon = Sprites.getIcon(def);
      if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 32, 32);
      cell.appendChild(cv);
      cell.onclick = () => {
        this._say(describeItem(this.game, p, def));
      };
      grid.appendChild(cell);
    }
    // Equipped gear counts too — those are the items most worth asking about.
    for (const key of ['head', 'chest', 'legs', 'acc0', 'acc1', 'acc2']) {
      const ref = p.inventory.getEquip(key);
      if (!ref || seen.has(ref.id)) continue;
      seen.add(ref.id);
      any = true;
      const def = getItem(ref.id);
      const cell = document.createElement('div');
      cell.className = 'inv-slot equip';
      cell.title = def.name + ' (equipped)';
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const icon = Sprites.getIcon(def);
      if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 32, 32);
      cell.appendChild(cv);
      cell.onclick = () => this._say(describeItem(this.game, p, def));
      grid.appendChild(cell);
    }

    if (!any) {
      this._say(['<p>Your bag is empty. Come back when you&rsquo;re carrying something.</p>']);
    } else {
      wrap.appendChild(grid);
    }

    const back = document.createElement('button');
    back.className = 'btn small';
    back.textContent = '← Back';
    back.onclick = () => {
      this._say([`<p>${greeting(this.game, this.game.localPlayer)}</p>`]);
      this._renderTopics();
    };
    wrap.appendChild(back);
  }
}
