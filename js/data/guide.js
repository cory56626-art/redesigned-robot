// Summoner Realms — the Guide's dialogue.
//
// Two kinds of content live here:
//
//   TOPICS       hand-written advice, written as functions of the game state so
//                the Guide says something useful *now* rather than reciting a
//                fixed manual. He notices you have no bench, that you're
//                standing in the corruption, that you already beat the
//                Grovekeeper.
//
//   describeItem generated explanations for any item in your bag, assembled
//                from the item's own definition and cross-referenced against
//                the recipe list and boss loot tables, so a new item is
//                explained correctly the day it's added without anyone writing
//                a paragraph for it.
import { ITEMS, item as getItem } from './items.js?v=realms-qor-48';
import { RECIPES } from './recipes.js?v=realms-qor-48';
import { BOSSES } from './bosses.js?v=realms-qor-48';
import { ENEMIES } from './enemies.js?v=realms-qor-48';
import { TILE } from '../config.js?v=realms-qor-48';

const CLASS_LABEL = { melee: 'Melee', ranged: 'Ranged', mage: 'Mage', summon: 'Summoner' };

// ---------------------------------------------------------------------------
// Conversation topics
// ---------------------------------------------------------------------------

export const TOPICS = [
  {
    id: 'start', label: 'Where do I start?',
    text(g, p) {
      const has = (id) => p.inventory.count(id) > 0;
      const wood = p.inventory.count('wood');
      const lines = [];
      if (!has('craftingBench') && wood < 8) {
        lines.push(`Trees first. Take that hatchet to one and it will come down whole — you'll get <b>Oakenwood</b> from the trunk and twigs from the leaves. You have <b>${wood}</b>; a Crafting Bench wants eight.`);
      } else if (!has('craftingBench')) {
        lines.push(`You have wood enough. Open your bag and craft a <b>Crafting Bench</b> — everything else starts there. Place it, stand near it, and the list of what you can make grows.`);
      } else {
        lines.push(`Bench in hand. Put it down somewhere you'll come back to, then work down: <b>Smeltery</b> for bars, <b>Forge</b> for metal gear, <b>Aether Altar</b> for magic and idols.`);
      }
      lines.push(`Torches next. The dark below is genuinely dark, and a stack of <b>Emberlight</b> costs almost nothing.`);
      return lines;
    },
  },
  {
    id: 'mining', label: 'Mining & gathering',
    text(g, p) {
      const pick = p.inventory.bestToolFor('pickaxe');
      const axe = p.inventory.bestToolFor('axe');
      return [
        `Right-click and I'll pick the right tool for whatever you're aiming at — the pick for stone, the axe for wood. Your best pickaxe is power <b>${pick.power}</b> and your best axe power <b>${axe.power}</b>.`,
        `Power matters: Ironvein needs a Cuprite pick, Glimmer and Aetherite need Ironvein, and <b>Blightore</b> won't yield to anything under a Glimmer pick. Using the wrong tool still works, just badly.`,
        `Ore hides in seams inside the rock, deeper the richer. Cuprite sits near the surface; Glimmer and Aetherite want the caverns; Blightore only ever forms inside blightstone under the Corrupted Lands.`,
        `If you'd rather not swing at all — <b>bombs</b>. They'll take out dirt and stone in a radius. They will not touch Blightore, and they do not care that you're standing next to them.`,
      ];
    },
  },
  {
    id: 'crafting', label: 'Crafting stations',
    text(g, p) {
      return [
        `Four stations, each unlocking the next. <b>Crafting Bench</b> from wood; <b>Smeltery</b> from stone and clay, which turns ore into bars; <b>Forge</b> from stone and cuprite bars for metal weapons, armour and tools; <b>Aether Altar</b> for magic gear, summoner idols and the potions worth drinking.`,
        `You have to be standing near a station for its recipes to appear — about five tiles. Build a little workshop and keep all four together; you'll thank yourself.`,
      ];
    },
  },
  {
    id: 'combat', label: 'Fighting & classes',
    text(g, p) {
      const st = p.stats || p.inventory.getStats();
      return [
        `Four ways to fight, and armour sets that lean into each. <b>Melee</b> is close and forgiving. <b>Ranged</b> needs arrows, bolts or shot. <b>Magic</b> spends Aether, which regenerates slower right after a cast. <b>Summoners</b> pay Aether once and let minions do the work.`,
        `Wearing three pieces of a set completes it and grants a bonus on top. Right now you have <b>${st.defense}</b> defense and room for <b>${st.minionCap}</b> minion${st.minionCap === 1 ? '' : 's'}.`,
        `Watch enemies before they reach you. Anything about to commit flashes first — a boar pawing the ground, a shade gathering its shot. That flash is your window to move.`,
      ];
    },
  },
  {
    id: 'throwables', label: 'Bombs & throwables',
    text() {
      return [
        `Throw them and gravity does the rest — they arc, they bounce off stone, and they land where physics puts them, not where you pointed.`,
        `<b>Blast Bomb</b> for a small crater in dirt and stone. <b>Dynamite</b> for a much bigger one and tougher rock. <b>Cling Charge</b> sticks where it lands, which is the only sane way to blast a ceiling. <b>Ember Flask</b> bursts into flame on impact and leaves the terrain alone.`,
        `<b>Shurikens</b> and <b>knives</b> aren't explosives at all: flat, fast, and you can often pick them back up afterwards.`,
        `Stand clear. A blast doesn't check whose it was.`,
      ];
    },
  },
  {
    id: 'building', label: 'Building & light',
    text() {
      return [
        `Place a block where you can reach it and where something already sits beside it — or right next to yourself, which is how you climb out of a hole you've dug.`,
        `Turn on <b>Smart Cursor</b> and building gets much less fiddly: it snaps to the next sensible spot rather than the exact pixel you're pointing at, and it finds walls that want a torch.`,
        `Light isn't decoration underground. Anything with a wall behind it stays dark no matter how close the surface is — that's what makes a cave a cave.`,
      ];
    },
  },
  {
    id: 'bosses', label: 'The three bosses',
    text(g, p) {
      const done = (k) => g.progression.isDefeated(k);
      const lines = [];
      for (const key of ['grovekeeper', 'gravemaw', 'blightSovereign']) {
        const b = BOSSES[key];
        const where = b.biome === 'forest' ? 'the forest' : b.biome === 'corrupt' ? 'the Corrupted Lands' : 'the underground';
        const item = getItem(b.summonItem);
        lines.push(`<b>${b.name}</b> — ${b.maxHp} health, ${b.phases.length} phases, summoned with a <b>${item.name}</b> in ${where}. ${done(key) ? '<span class="npc-stat">Already beaten.</span>' : ''}`);
      }
      lines.push(`They all telegraph. Every attack has a charge-up you can see and a recovery afterwards where they're slow — that recovery is when you hit back.`);
      lines.push(`Two things they won't tolerate: running away, which enrages them and eventually makes them leave, and dying, which ends the fight outright. Either way you'll need another idol.`);
      return lines;
    },
  },
  {
    id: 'where', label: 'Where am I?',
    text(g, p) {
      const tx = Math.floor((p.x + p.w / 2) / TILE);
      const ty = Math.floor((p.y + p.h / 2) / TILE);
      const biome = g.world.biomeAt(tx, ty);
      const blurb = {
        forest: `The <b>Verdant Reach</b>. Ordinary, green, and the safest ground you'll find. Home.`,
        dunes: `The <b>Sunken Dunes</b> at the world's edge. Flat, hot, cactus-ridden, and hiding sandstone under the sand.`,
        frostpine: `<b>Frostpine Hollow</b>. Snow over stone, tall pines, and rimeglass that'll blunt a poor pickaxe.`,
        corrupt: `The <b>Corrupted Lands</b>. Blightstone and thornvines, and the only place Blightore forms. Mind the vines — they bite.`,
        underground: `<b>Underground</b>. Past the dirt, into the stone. This is where the ore starts being worth carrying home.`,
        cavern: `The <b>deep caverns</b>. Deepstone, wide halls, and the worst things in the world. Bring torches and don't be shy with them.`,
      };
      return [
        blurb[biome] || `Somewhere I don't have a name for. Tile ${tx}, ${ty}.`,
        `My camp is back at your spawn, and I don't wander far from it. If you're lost, that's where I'll be.`,
      ];
    },
  },
];

// ---------------------------------------------------------------------------
// Item explanations
// ---------------------------------------------------------------------------

// Where does this item come from? Checked against the recipe list and every
// boss's loot table, so it stays correct as content is added.
function sourceOf(id) {
  const out = [];
  const recipe = RECIPES.find(r => r.out.item === id);
  if (recipe) {
    const cost = recipe.in.map(i => `${i.count}× ${getItem(i.item).name}`).join(', ');
    const where = recipe.station ? `at a ${recipe.station}` : 'by hand';
    out.push(`Crafted ${where} from ${cost}.`);
  }
  for (const key in BOSSES) {
    const b = BOSSES[key];
    if ((b.loot || []).some(l => l.item === id)) out.push(`Dropped by the <b>${b.name}</b>.`);
  }
  const droppers = [];
  for (const key in ENEMIES) {
    if ((ENEMIES[key].drops || []).some(d => d.item === id)) droppers.push(ENEMIES[key].name);
  }
  if (droppers.length) out.push(`Dropped by ${droppers.slice(0, 3).join(', ')}${droppers.length > 3 ? ' and others' : ''}.`);
  if (ITEMS[id] && ITEMS[id].place != null) out.push(`Can be placed back into the world.`);
  return out;
}

// What is this item *for*? Written per category, from the definition's own
// numbers, so it never drifts out of sync with the item itself.
function purposeOf(def) {
  switch (def.category) {
    case 'weapon': {
      const cls = CLASS_LABEL[def.weaponClass] || def.weaponClass;
      if (def.weaponClass === 'summon') {
        return `A <b>summoner</b> weapon. Spend ${def.manaCost} Aether and it calls a ${def.summonMinion} that fights for you until it dies or you do. Minions cost nothing to keep — the cap is what limits you.`;
      }
      const rate = def.useTime ? `${(1 / def.useTime).toFixed(1)} swings a second` : '';
      let s = `A <b>${cls.toLowerCase()}</b> weapon: ${def.damage} damage, ${rate}.`;
      if (def.ammo) s += ` It needs <b>${getItem(def.ammo).name}</b> and won't fire without it.`;
      else if (def.weaponClass === 'ranged') s += ` It makes its own ammunition — nothing to carry.`;
      if (def.manaCost) s += ` Each cast spends ${def.manaCost} Aether, and your Aether comes back slower for a moment afterwards.`;
      if (def.pierce) s += ` Shots pass through ${def.pierce} foes before stopping.`;
      if (def.multishot) s += ` Fires ${def.multishot} at once.`;
      if (def.effect) s += ` Leaves ${Object.keys(def.effect).join(' and ')} on whatever it hits.`;
      if (def.fx) s += ` And it makes a proper show of itself when you swing.`;
      return s;
    }
    case 'throwable': {
      let s = `Thrown, not swung. It arcs and bounces.`;
      if (def.explode) {
        s += ` ${def.fuse ? `A ${def.fuse}-second fuse` : 'Detonates on impact'}, ${def.blastDamage} damage at the centre, ${def.blastRadius} tiles across.`;
        s += def.breaksBlocks ? ` It will take the terrain with it.` : ` It leaves the terrain standing.`;
        s += ` It will also take <i>you</i> with it if you're close.`;
      } else {
        s += ` ${def.contactDamage} damage on contact${def.pierce ? `, punching through ${def.pierce} foe${def.pierce > 1 ? 's' : ''}` : ''}.`;
      }
      if (def.sticky) s += ` This one sticks where it lands, so you can charge a ceiling.`;
      if (def.recoverChance) s += ` Roughly ${Math.round(def.recoverChance * 100)}% of the time you can pick it back up.`;
      return s;
    }
    case 'tool':
      return def.tool.kind === 'axe'
        ? `An axe, power ${def.tool.power}. Chop a trunk and the whole tree comes down — trunk into wood, leaves into twigs and seeds.`
        : `A pickaxe, power ${def.tool.power}. Power decides what you can break at all: 2 for Ironvein, 3 for Glimmer and Aetherite, 4 for Blightore.`;
    case 'armor': {
      let s = `Armour for the <b>${def.slot}</b> slot: ${def.defense} defense, which takes the edge off every hit.`;
      if (def.setKey) s += ` Part of a set — wear all three pieces and you get a bonus on top of the armour itself.`;
      if (def.setBonus && def.setBonus.classBonus) s += ` It leans ${CLASS_LABEL[def.setBonus.classBonus].toLowerCase()}.`;
      return s;
    }
    case 'accessory': {
      const s = def.accStats || {};
      const bits = [];
      if (s.speed) bits.push(`${Math.round(s.speed * 100)}% faster on your feet`);
      if (s.extraJumps) bits.push(`${s.extraJumps} extra jump in mid-air`);
      if (s.maxHp) bits.push(`${s.maxHp} more health`);
      if (s.maxMana) bits.push(`${s.maxMana} more Aether`);
      if (s.minionCap) bits.push(`room for ${s.minionCap} more minion`);
      if (s.defense) bits.push(`${s.defense} more defense`);
      return `An accessory. Equip it for ${bits.join(', ')}. You have three accessory slots, and they all stack.`;
    }
    case 'potion': {
      const e = def.potion || {};
      if (e.heal) return `Drink it for ${e.heal} health. Then wait — healing has a shared cooldown you can't drink around, so hold it until you actually need it.`;
      if (e.mana) return `Restores ${e.mana} Aether, on its own cooldown separate from healing.`;
      if (e.buff) return `A ${e.buff.duration}-second ${e.buff.type} brew. Drink it <i>before</i> the fight, not during.`;
      return `A potion.`;
    }
    case 'ammo': return `Ammunition. Carry it and the right weapon spends it automatically; run out and that weapon simply won't fire.`;
    case 'station': return `A crafting station. Place it, stand within about five tiles, and its recipes appear in your bag.`;
    case 'block': return `A building block. Place it against something solid, or right beside yourself to climb.`;
    case 'summonitem': {
      const b = BOSSES[def.summonBoss];
      const where = b.biome === 'forest' ? 'the forest' : b.biome === 'corrupt' ? 'the Corrupted Lands' : 'the underground';
      return `This calls the <b>${b.name}</b>, and only in ${where}. It is consumed whether the fight goes well or not, so bring more than one.`;
    }
    case 'material': {
      if (def.matKind === 'ore') return `Raw ore. Worthless until you smelt it into bars at a Smeltery.`;
      if (def.matKind === 'bar') return `A refined bar. This is what the Forge and the Altar actually want.`;
      return `A crafting material. Something in your recipe list needs it.`;
    }
    default: return `I'm not sure what to tell you about this one.`;
  }
}

/**
 * Everything the Guide can say about one item. Returns HTML paragraphs.
 */
export function describeItem(game, player, def) {
  if (!def) return ['<p>Nothing in that hand.</p>'];
  const out = [];
  out.push(`<p><b>${def.name}</b>${def.desc ? ` — <i>${def.desc}</i>` : ''}</p>`);
  out.push(`<p>${purposeOf(def)}</p>`);
  const src = sourceOf(def.id);
  if (src.length) out.push(`<p class="npc-stat">${src.join(' ')}</p>`);

  // A closing nudge that depends on the player's actual situation.
  const tip = situationalTip(game, player, def);
  if (tip) out.push(`<p>${tip}</p>`);
  return out;
}

function situationalTip(game, player, def) {
  const inv = player.inventory;
  if (def.category === 'weapon' && def.ammo && inv.count(def.ammo) === 0) {
    return `You have none of the ammunition for it, mind. It won't fire like that.`;
  }
  if (def.category === 'weapon' && def.manaCost && def.manaCost > player.maxMana) {
    return `That costs more Aether than you can hold. Find something that raises your maximum first.`;
  }
  if (def.category === 'armor' && def.setKey) {
    const sets = inv.equippedSets();
    const n = sets[def.setKey] || 0;
    if (n > 0 && n < 3) return `You're wearing ${n} of the three. One more piece and the set bonus is yours.`;
  }
  if (def.category === 'summonitem' && !game.progression.isDefeated(previousBoss(def.summonBoss))) {
    const prev = BOSSES[previousBoss(def.summonBoss)];
    if (prev) return `I'd deal with the <b>${prev.name}</b> first, if I were you.`;
  }
  if (def.category === 'tool' && def.tool) {
    const best = inv.bestToolFor(def.tool.kind);
    if (best.power > def.tool.power) return `You have a better one in the bag already — no reason to carry both.`;
  }
  return null;
}

const BOSS_ORDER = ['grovekeeper', 'gravemaw', 'blightSovereign'];
function previousBoss(key) {
  const i = BOSS_ORDER.indexOf(key);
  return i > 0 ? BOSS_ORDER[i - 1] : null;
}

// The line the Guide opens with, which changes as you make progress.
export function greeting(game, player) {
  const p = game.progression;
  if (!player.inventory.count('craftingBench') && player.inventory.count('wood') < 8) {
    return `Ah — you're up. Vesper Thane; I keep a camp here so nobody has to start entirely alone. Get some wood into you and we'll talk about a workbench.`;
  }
  if (p.isDefeated('blightSovereign')) return `The Sovereign is dead and the corruption is quiet. I'm not sure there's much left I can teach you.`;
  if (p.isDefeated('gravemaw')) return `Two down. Only the <b>Blight Sovereign</b> left, and it is not like the others. Ask me anything.`;
  if (p.isDefeated('grovekeeper')) return `The Grovekeeper's beaten — well done. The <b>Gravemaw</b> is next, and it's underground. What do you need?`;
  return `Back again? Good. Ask, and I'll tell you what I know.`;
}
