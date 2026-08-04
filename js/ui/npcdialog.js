// Summoner Realms — the NPC dialogue window.
//
// Two modes: a list of topics she can talk about, and an item-inspection mode
// where you hand him something from your bag and he explains it. The content
// itself lives in data/guide.js; this file is only presentation.
import { INV_SIZE } from '../systems/inventory.js?v=worm-surface-2';
import { Sprites } from '../art/sprites.js?v=worm-surface-2';
import { item as getItem } from '../data/items.js?v=worm-surface-2';
import {
  TOPICS, SNOWKEEPER_TOPICS, describeItem, greeting, snowkeeperGreeting,
} from '../data/guide.js?v=worm-surface-2';

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
    this.npc.met = true;
    $('npcDialog').classList.toggle('snowkeeper', this._isSnowkeeper());
    $('npcName').textContent = this.npc.name;
    $('npcTitle').textContent = this.npc.title;
    this._drawPortrait();
    this.mode = 'topics';
    this._say([`<p>${this._greeting()}</p>`]);
    this._renderTopics();
    $('npcDialog').classList.remove('hidden');
    this.game.onMenuOpened();
  }

  close() {
    $('npcDialog').classList.add('hidden');
    $('npcDialog').classList.remove('snowkeeper');
    this.mode = 'topics';
  }

  _isSnowkeeper() { return this.npc && this.npc.kind === 'snowkeeper'; }
  _topics() { return this._isSnowkeeper() ? SNOWKEEPER_TOPICS : TOPICS; }
  _greeting() {
    return this._isSnowkeeper()
      ? snowkeeperGreeting(this.game, this.game.localPlayer)
      : greeting(this.game, this.game.localPlayer);
  }

  // A little portrait drawn from the same shapes the world sprite uses, so the
  // face in the window is recognisably the person standing in front of you.
  _drawPortrait() {
    const cv = $('npcPortrait');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2140'; ctx.fillRect(0, 0, 48, 48);
    if (this._isSnowkeeper()) {
      // Match the upgraded world silhouette: deep hood, fur, face, layered
      // coat, frost-star brooch and the lantern that powers her services.
      ctx.fillStyle = '#273c61'; ctx.fillRect(4, 5, 40, 36);
      ctx.fillStyle = '#395b80'; ctx.fillRect(7, 8, 34, 29);
      ctx.fillStyle = '#9cecff';
      ctx.fillRect(9, 11, 2, 2); ctx.fillRect(37, 8, 2, 2); ctx.fillRect(6, 28, 2, 2);
      ctx.fillStyle = '#172a43';
      ctx.fillRect(10, 7, 28, 22); ctx.fillRect(7, 15, 5, 23); ctx.fillRect(36, 15, 5, 23);
      ctx.fillStyle = '#315d79'; ctx.fillRect(12, 10, 24, 20);
      ctx.fillStyle = '#ead5bd'; ctx.fillRect(15, 15, 18, 15);
      ctx.fillStyle = '#5d4758'; ctx.fillRect(15, 15, 4, 8);
      ctx.fillStyle = '#253044'; ctx.fillRect(27, 21, 4, 2); ctx.fillRect(18, 20, 3, 1);
      ctx.fillStyle = '#d28b98'; ctx.fillRect(29, 25, 2, 1);
      ctx.fillStyle = '#d8f8ff'; ctx.fillRect(12, 28, 24, 4); ctx.fillRect(9, 31, 5, 3); ctx.fillRect(34, 31, 5, 3);
      ctx.fillStyle = '#21445f'; ctx.fillRect(9, 33, 30, 12);
      ctx.fillStyle = '#416f8e'; ctx.fillRect(11, 34, 12, 11); ctx.fillRect(25, 34, 12, 11);
      ctx.fillStyle = '#b9e9f2'; ctx.fillRect(10, 42, 28, 3);
      ctx.fillStyle = '#f1d37d'; ctx.fillRect(22, 35, 4, 4);
      ctx.fillStyle = '#e8ffff'; ctx.fillRect(23, 36, 2, 7); ctx.fillRect(20, 38, 8, 2);
      ctx.fillStyle = '#6ca7c4'; ctx.fillRect(38, 29, 6, 10);
      ctx.fillStyle = '#e8ffff'; ctx.fillRect(40, 31, 2, 5);
      return;
    }
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

    if (this._isSnowkeeper()) {
      const label = document.createElement('div');
      label.className = 'npc-section-label';
      label.textContent = 'Hearth services';
      wrap.appendChild(label);

      const blessing = document.createElement('button');
      blessing.className = 'btn small primary';
      const day = Math.max(1, Math.floor(this.game.time?.day || 1));
      blessing.textContent = this.npc.lastHearthDay === day
        ? 'Hearth Blessing · tomorrow'
        : 'Take Hearth Blessing';
      blessing.onclick = () => {
        const result = this.game.useNpcService(this.npc, 'hearth');
        this._say([`<p>${result.message}</p>`]);
        this._renderTopics();
      };
      wrap.appendChild(blessing);

      const waymark = document.createElement('button');
      waymark.className = 'btn small';
      waymark.textContent = 'Mark nearby paths';
      waymark.onclick = () => {
        const result = this.game.useNpcService(this.npc, 'waymark');
        this._say([`<p>${result.message}</p>`]);
        this._renderTopics();
      };
      wrap.appendChild(waymark);

      const topicLabel = document.createElement('div');
      topicLabel.className = 'npc-section-label';
      topicLabel.textContent = 'Ask Nivara';
      wrap.appendChild(topicLabel);
    }

    for (const t of this._topics()) {
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
    this._say([`<p>${this._greeting()}</p>`]);
      this._renderTopics();
    };
    wrap.appendChild(back);
  }
}
