// Summoner Realms — NPC dialogue window.
//
// Handles both the Guide (topic list + item inspection) and Grunfunder (quest
// monologues, thanks, and bodyguard bag management). Content for the Guide
// lives in data/guide.js; Grunfunder lines live here with the state machine.
import { INV_SIZE } from '../systems/inventory.js?v=realms-qor-49';
import { Sprites } from '../art/sprites.js?v=realms-qor-49';
import { item as getItem } from '../data/items.js?v=realms-qor-49';
import { TOPICS, describeItem, greeting } from '../data/guide.js?v=realms-qor-49';
import { GF_MODE, GRUNFUNDER_BAG_SIZE } from '../entities/grunfunder.js?v=realms-qor-49';

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
    $('npcName').textContent = this.npc.name;
    $('npcTitle').textContent = this.npc.title || '';
    this._drawPortrait();
    this.mode = 'topics';

    if (this.npc.key === 'grunfunder') this._openGrunfunder();
    else this._openGuide();

    $('npcDialog').classList.remove('hidden');
    this.game.onMenuOpened();
  }

  close() {
    $('npcDialog').classList.add('hidden');
    this.mode = 'topics';
  }

  // ---- Guide ---------------------------------------------------------------

  _openGuide() {
    this._say([`<p>${greeting(this.game, this.game.localPlayer)}</p>`]);
    this._renderTopics();
  }

  // A little portrait drawn from the same shapes the world sprite uses, so the
  // face in the window is recognisably the person standing in front of you.
  _drawPortrait() {
    const cv = $('npcPortrait');
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 48, 48);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1b2140'; ctx.fillRect(0, 0, 48, 48);

    if (this.npc && this.npc.key === 'grunfunder') {
      // Weathered traveler: muddy cloak, sunken eyes, bone-pale skin.
      ctx.fillStyle = '#3a3228'; ctx.fillRect(8, 6, 32, 12);
      ctx.fillRect(6, 12, 6, 26); ctx.fillRect(36, 12, 6, 26);
      ctx.fillStyle = '#d4b896'; ctx.fillRect(13, 14, 22, 20);
      ctx.fillStyle = '#2b2338'; ctx.fillRect(18, 21, 4, 4); ctx.fillRect(28, 21, 4, 4);
      // tired bags
      ctx.fillStyle = '#a08060'; ctx.fillRect(17, 25, 6, 2); ctx.fillRect(27, 25, 6, 2);
      // ragged beard
      ctx.fillStyle = '#8a7a68'; ctx.fillRect(14, 30, 20, 10);
      // cloak
      ctx.fillStyle = '#5a4638'; ctx.fillRect(8, 40, 32, 8);
      // curse mark
      ctx.fillStyle = '#c58bff'; ctx.fillRect(22, 18, 4, 3);
      return;
    }

    // Guide (default)
    ctx.fillStyle = '#463a63'; ctx.fillRect(8, 6, 32, 12);
    ctx.fillRect(6, 12, 6, 26); ctx.fillRect(36, 12, 6, 26);
    ctx.fillStyle = '#e8c6a2'; ctx.fillRect(13, 14, 22, 20);
    ctx.fillStyle = '#2b2338'; ctx.fillRect(18, 21, 4, 4); ctx.fillRect(28, 21, 4, 4);
    ctx.fillStyle = '#d8d2e4'; ctx.fillRect(14, 30, 20, 10);
    ctx.fillRect(11, 26, 4, 12); ctx.fillRect(33, 26, 4, 12);
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

  // ---- Grunfunder ----------------------------------------------------------

  _openGrunfunder() {
    const g = this.npc;
    const wrap = $('npcTopics');
    wrap.innerHTML = '';

    if (g.mode === GF_MODE.STRANDED) {
      this._say([
        '<p>A ragged traveler flinches as you approach. Violet veins crawl under his skin.</p>',
        '<p><b>Grunfunder:</b> &ldquo;You&hellip; you&rsquo;re not one of them. Please. I can&rsquo;t find the edge of this blight on my own. Guide me out of the <b>Corrupted Lands</b> and I&rsquo;ll make it worth your while.&rdquo;</p>',
      ]);
      const accept = document.createElement('button');
      accept.className = 'btn small primary';
      accept.textContent = 'Lead the way';
      accept.onclick = () => {
        g.beginEscort(this.game);
        this._say([
          '<p><b>Grunfunder:</b> &ldquo;Bless you. Stay close — I&rsquo;ll follow. Just get me past the purple grass.&rdquo;</p>',
          '<p class="npc-stat">Escort Grunfunder until you leave the Corrupted Lands.</p>',
        ]);
        wrap.innerHTML = '';
        this._addCloseBtn(wrap);
      };
      wrap.appendChild(accept);
      const refuse = document.createElement('button');
      refuse.className = 'btn small';
      refuse.textContent = 'Not now';
      refuse.onclick = () => {
        this._say(['<p><b>Grunfunder:</b> &ldquo;I&hellip; I understand. I&rsquo;ll wait. Please don&rsquo;t leave me here forever.&rdquo;</p>']);
        wrap.innerHTML = '';
        this._addCloseBtn(wrap);
      };
      wrap.appendChild(refuse);
      return;
    }

    if (g.mode === GF_MODE.FOLLOWING) {
      this._say([
        '<p><b>Grunfunder:</b> &ldquo;Keep going. I can feel the blight thinning when we move — just a little further.&rdquo;</p>',
        '<p class="npc-stat">He is following you. Leave the Corrupted Lands surface to complete the escort.</p>',
      ]);
      this._addCloseBtn(wrap);
      return;
    }

    if (g.mode === GF_MODE.AWAITING) {
      this._say([
        '<p>Grunfunder sits against a cave wall, whole again — no curse-marks, only scars.</p>',
        '<p><b>Grunfunder:</b> &ldquo;You&hellip; you actually did it. You killed what I was carrying. I set you up for that curse, and you still pulled me through.&rdquo;</p>',
        '<p><b>Grunfunder:</b> &ldquo;I can never repay that. Let me try. I&rsquo;ll walk at your side and keep you breathing. Stock my bag with whatever weapons and armour you can spare — I&rsquo;ll put them to use.&rdquo;</p>',
      ]);
      const accept = document.createElement('button');
      accept.className = 'btn small primary';
      accept.textContent = 'Accept his service';
      accept.onclick = () => {
        g.becomeBodyguard(this.game);
        $('npcTitle').textContent = g.title;
        this._say([
          '<p><b>Grunfunder:</b> &ldquo;Then I am yours. Open my bag anytime — drop me a blade and I&rsquo;ll swing it.&rdquo;</p>',
        ]);
        wrap.innerHTML = '';
        this._renderBodyguardActions(wrap);
      };
      wrap.appendChild(accept);
      return;
    }

    if (g.mode === GF_MODE.BODYGUARD) {
      this._say([
        '<p><b>Grunfunder:</b> &ldquo;Still standing, thanks to you. Need me geared up? Hand me weapons or armour from your pack.&rdquo;</p>',
      ]);
      this._renderBodyguardActions(wrap);
      return;
    }

    // Fallback for odd states.
    this._say(['<p>Grunfunder has nothing to say right now.</p>']);
    this._addCloseBtn(wrap);
  }

  _renderBodyguardActions(wrap) {
    wrap.innerHTML = '';
    const bagBtn = document.createElement('button');
    bagBtn.className = 'btn small primary';
    bagBtn.textContent = 'Manage bag';
    bagBtn.onclick = () => this._renderGrunfunderBag();
    wrap.appendChild(bagBtn);
    this._addCloseBtn(wrap);
  }

  _renderGrunfunderBag() {
    const g = this.npc;
    const p = this.game.localPlayer;
    const wrap = $('npcTopics');
    wrap.innerHTML = '';

    this._say([
      '<p>Grunfunder&rsquo;s personal bag. Give him weapons or armour — he fights with the best gear he holds.</p>',
    ]);

    // His bag
    const label = document.createElement('div');
    label.className = 'npc-stat';
    label.textContent = 'His bag';
    label.style.margin = '6px 0 4px';
    wrap.appendChild(label);

    const bagGrid = document.createElement('div');
    bagGrid.className = 'npc-items';
    for (let i = 0; i < GRUNFUNDER_BAG_SIZE; i++) {
      const s = g.bag.slots[i];
      const cell = document.createElement('div');
      cell.className = 'inv-slot';
      if (s) {
        const def = getItem(s.id);
        cell.title = `${def.name} ×${s.count} (click to take back)`;
        const cv = document.createElement('canvas');
        cv.width = 32; cv.height = 32;
        const icon = Sprites.getIcon(def);
        if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 32, 32);
        cell.appendChild(cv);
        if (s.count > 1) {
          const n = document.createElement('span');
          n.className = 'count';
          n.textContent = s.count;
          cell.appendChild(n);
        }
        cell.onclick = () => {
          if (g.returnItem(p, i)) {
            this.game.toast(`Took ${def.name} back.`, 'info');
            this.game.markDirty();
            this._renderGrunfunderBag();
          } else {
            this.game.toast('Your inventory is full.', 'bad');
          }
        };
      } else {
        cell.title = 'Empty';
        cell.style.opacity = '0.35';
      }
      bagGrid.appendChild(cell);
    }
    wrap.appendChild(bagGrid);

    // Player inventory — click to give
    const plabel = document.createElement('div');
    plabel.className = 'npc-stat';
    plabel.textContent = 'Your pack (click to give)';
    plabel.style.margin = '10px 0 4px';
    wrap.appendChild(plabel);

    const invGrid = document.createElement('div');
    invGrid.className = 'npc-items';
    let any = false;
    for (let i = 0; i < INV_SIZE; i++) {
      const s = p.inventory.slots[i];
      if (!s) continue;
      const def = getItem(s.id);
      // Only weapons and armour are useful to him.
      if (!def || (def.category !== 'armor' && !def.weaponClass)) continue;
      any = true;
      const cell = document.createElement('div');
      cell.className = 'inv-slot';
      cell.title = `Give ${def.name}`;
      const cv = document.createElement('canvas');
      cv.width = 32; cv.height = 32;
      const icon = Sprites.getIcon(def);
      if (icon) cv.getContext('2d').drawImage(icon, 0, 0, 32, 32);
      cell.appendChild(cv);
      const slotIndex = i;
      cell.onclick = () => {
        const res = g.acceptItem(p, slotIndex);
        if (res.ok) {
          this.game.toast(`Gave ${getItem(res.item).name} to Grunfunder.`, 'good');
          this.game.markDirty();
          this._renderGrunfunderBag();
        } else {
          this.game.toast(res.reason || 'Could not give item.', 'bad');
        }
      };
      invGrid.appendChild(cell);
    }
    if (!any) {
      const empty = document.createElement('p');
      empty.className = 'npc-stat';
      empty.textContent = 'No weapons or armour in your pack to give.';
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(invGrid);
    }

    const back = document.createElement('button');
    back.className = 'btn small';
    back.textContent = '← Back';
    back.onclick = () => {
      this._say(['<p><b>Grunfunder:</b> &ldquo;Ready when you are.&rdquo;</p>']);
      this._renderBodyguardActions(wrap);
    };
    wrap.appendChild(back);
  }

  _addCloseBtn(wrap) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = 'Close';
    b.onclick = () => this.close();
    wrap.appendChild(b);
  }
}
