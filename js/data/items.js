// Summoner Realms — item catalogue. All original names/designs.
// Categories: weapon (melee/ranged/mage/summon), tool, armor, accessory,
// potion, ammo, material, block, station, summonitem.
import { T } from '../world/tiles.js';

export const ITEMS = {};

function def(o) {
  const d = { maxStack: 99, tier: 0 };
  if (['weapon', 'tool', 'armor', 'accessory', 'summonitem'].includes(o.category)) d.maxStack = 1;
  ITEMS[o.id] = Object.assign(d, o);
  return ITEMS[o.id];
}

// ---------- Tools (pickaxes) ----------
def({ id: 'woodPick', name: 'Oaken Pick', category: 'tool', tool: { power: 1 }, color: '#a67c46', desc: 'Basic pickaxe. Mining power 1.' });
def({ id: 'cupritePick', name: 'Cuprite Pick', category: 'tool', tool: { power: 2 }, color: '#c47b4a', tier: 1, desc: 'Mining power 2. Breaks Ironvein.' });
def({ id: 'ironveinPick', name: 'Ironvein Pick', category: 'tool', tool: { power: 3 }, color: '#a9b0bd', tier: 2, desc: 'Mining power 3. Breaks Glimmer & Aetherite.' });
def({ id: 'glimmerPick', name: 'Glimmer Pick', category: 'tool', tool: { power: 4 }, color: '#ffe08a', tier: 3, desc: 'Mining power 4. Breaks Blightore.' });

// ---------- Melee weapons (8) ----------
const melee = (id, name, color, dmg, useTime, tier, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'melee', color, damage: dmg, useTime, tier, knockback: 4, crit: 0.06, reach: 30, arc: 1.6, meleeKind: 'sword', desc: `${name} — ${dmg} melee damage.` }, extra));
melee('rustedShortblade', 'Rusted Shortblade', '#b7bcc9', 9, 0.35, 0);
melee('bonefangDagger', 'Bonefang Dagger', '#e9e2c8', 6, 0.18, 0, { knockback: 2, crit: 0.12, reach: 22, desc: 'Fast, low-damage stabs. High crit.' });
melee('cupriteSword', 'Cuprite Sword', '#c47b4a', 13, 0.34, 1);
melee('thornspikeSpear', 'Thornspike Spear', '#5a7a3a', 15, 0.42, 1, { meleeKind: 'spear', reach: 46, arc: 0.6, knockback: 6, desc: 'Long thrust with extended reach.' });
melee('ironveinSaber', 'Ironvein Saber', '#a9b0bd', 19, 0.30, 2, { crit: 0.10 });
melee('emberaxe', 'Emberaxe', '#ff7a3b', 24, 0.55, 2, { meleeKind: 'heavy', reach: 34, arc: 2.0, knockback: 8, effect: { burn: 3 }, desc: 'Heavy swing that sets foes ablaze.' });
melee('glimmerGlaive', 'Glimmer Glaive', '#ffe08a', 28, 0.34, 3, { meleeKind: 'spear', reach: 44, crit: 0.10 });
melee('aetheredgeGreatblade', 'Aetheredge Greatblade', '#8ad9ff', 40, 0.5, 4, { meleeKind: 'heavy', reach: 40, arc: 2.2, knockback: 10, crit: 0.12, desc: 'Massive arc of arcane steel.' });

// ---------- Ranged weapons (8) ----------
const ranged = (id, name, color, dmg, useTime, tier, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'ranged', color, damage: dmg, useTime, tier, knockback: 3, crit: 0.06, projSpeed: 480, projColor: color, rangedKind: 'bow', desc: `${name} — ${dmg} ranged damage.` }, extra));
ranged('saplingBow', 'Sapling Bow', '#7a9a4a', 9, 0.42, 0, { ammo: 'flintArrow', gravity: true, desc: 'Simple bow. Uses Flint Arrows.' });
ranged('slingcaster', 'Slingcaster', '#b0895a', 7, 0.30, 0, { projSpeed: 420, gravity: true, projColor: '#9a9a9a', desc: 'Hurls pebbles. No ammo needed.' });
ranged('cupriteRepeater', 'Cuprite Repeater', '#c47b4a', 11, 0.22, 1, { ammo: 'bolt', projSpeed: 560, desc: 'Rapid crossbow. Uses Bolts.' });
ranged('huntersLongbow', "Hunter's Longbow", '#8a6a3a', 14, 0.45, 1, { ammo: 'flintArrow', gravity: true, projSpeed: 620, desc: 'Powerful draw. Uses Flint Arrows.' });
ranged('boltflinger', 'Boltflinger', '#9aa6c0', 16, 0.20, 2, { projSpeed: 640, desc: 'Auto-flings energy bolts. No ammo.' });
ranged('emberlockMusket', 'Emberlock Musket', '#5a4a3a', 26, 0.6, 2, { ammo: 'shot', rangedKind: 'gun', projSpeed: 760, projColor: '#ffcf6b', effect: { burn: 2 }, desc: 'Slow, heavy gun. Uses Shot.' });
ranged('glimmerRifle', 'Glimmer Rifle', '#ffe08a', 22, 0.26, 3, { ammo: 'shot', rangedKind: 'gun', projSpeed: 820, crit: 0.10, desc: 'Fast rifle. Uses Shot.' });
ranged('stormpiercer', 'Stormpiercer', '#8ad9ff', 20, 0.30, 3, { projSpeed: 700, pierce: 2, projColor: '#bfe9ff', desc: 'Piercing storm arrows. No ammo.' });

// ---------- Mage weapons (8) ----------
const mage = (id, name, color, dmg, useTime, tier, mana, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'mage', color, damage: dmg, useTime, tier, manaCost: mana, knockback: 2, crit: 0.06, projSpeed: 420, projColor: color, mageKind: 'staff', desc: `${name} — ${dmg} magic damage, ${mana} Aether.` }, extra));
mage('sparkWand', 'Spark Wand', '#9ec3ff', 10, 0.3, 0, 4);
mage('emberTome', 'Ember Tome', '#ff7a3b', 12, 0.5, 0, 7, { mageKind: 'tome', effect: { burn: 3 }, gravity: false, desc: 'Lobs burning embers.' });
mage('frostshardStaff', 'Frostshard Staff', '#bfe9ff', 14, 0.35, 1, 6, { effect: { slow: 1.6 }, desc: 'Chilling shards that slow foes.' });
mage('venomWand', 'Venom Wand', '#7ee08a', 11, 0.3, 1, 5, { effect: { poison: 4 }, desc: 'Spits venom that poisons.' });
mage('aetherboltStaff', 'Aetherbolt Staff', '#8ad9ff', 18, 0.3, 2, 7);
mage('thunderRod', 'Thunder Rod', '#fff2a0', 22, 0.45, 2, 10, { pierce: 3, projSpeed: 900, desc: 'Piercing bolt of lightning.' });
mage('prismScepter', 'Prism Scepter', '#c58bff', 20, 0.28, 3, 8, { multishot: 3, spread: 0.4, desc: 'Fires a fan of prism shards.' });
mage('voidlance', 'Voidlance', '#b06bff', 34, 0.5, 4, 14, { pierce: 4, projSpeed: 640, desc: 'A lancing beam of void energy.' });

// ---------- Summoner weapons (6) ----------
const summon = (id, name, color, useTime, tier, mana, minion, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'summon', color, useTime, tier, manaCost: mana, summonMinion: minion, desc: `Summons a ${minion}. Costs ${mana} Aether.` }, extra));
summon('spriteWhistle', 'Sprite Whistle', '#9ec3ff', 0.5, 0, 12, 'wisp');
summon('beetleSigil', 'Beetle Sigil', '#c47b4a', 0.5, 1, 14, 'beetle');
summon('ravenTotem', 'Raven Totem', '#7a6a9a', 0.5, 1, 16, 'raven');
summon('emberlingStaff', 'Emberling Staff', '#ff7a3b', 0.5, 2, 18, 'emberling');
summon('thornguardIdol', 'Thornguard Idol', '#5a7a3a', 0.5, 2, 20, 'sentinel');
summon('wraithBell', 'Wraith Bell', '#b06bff', 0.5, 3, 24, 'wraith');

// ---------- Armor sets (helmet/chest/legs each) ----------
const armor = (id, name, color, slot, defense, tier, setKey, setBonus) =>
  def({ id, name, category: 'armor', color, slot, defense, tier, setKey, setBonus, desc: `${defense} defense.` });
// Fiber (starter)
armor('fiberHood', 'Fiber Hood', '#8a9a5a', 'head', 1, 0, 'fiber');
armor('fiberVest', 'Fiber Vest', '#8a9a5a', 'chest', 2, 0, 'fiber');
armor('fiberLeggings', 'Fiber Leggings', '#8a9a5a', 'legs', 1, 0, 'fiber');
// Ironvein (melee set): +melee
armor('ironveinHelm', 'Ironvein Helm', '#a9b0bd', 'head', 3, 2, 'ironvein', { classBonus: 'melee', dmgMul: 0.1 });
armor('ironveinPlate', 'Ironvein Plate', '#a9b0bd', 'chest', 5, 2, 'ironvein', { classBonus: 'melee', dmgMul: 0.1 });
armor('ironveinGreaves', 'Ironvein Greaves', '#a9b0bd', 'legs', 4, 2, 'ironvein', { classBonus: 'melee', dmgMul: 0.1 });
// Hunter (ranged set): +ranged
armor('huntersCowl', "Hunter's Cowl", '#6a7a3a', 'head', 2, 2, 'hunter', { classBonus: 'ranged', dmgMul: 0.12 });
armor('huntersGarb', "Hunter's Garb", '#6a7a3a', 'chest', 4, 2, 'hunter', { classBonus: 'ranged', dmgMul: 0.1 });
armor('huntersBoots', "Hunter's Boots", '#6a7a3a', 'legs', 3, 2, 'hunter', { classBonus: 'ranged', dmgMul: 0.1 });
// Aetherweave (mage set): +mana +magic
armor('aetherweaveHat', 'Aetherweave Hat', '#8ad9ff', 'head', 2, 3, 'aetherweave', { classBonus: 'mage', dmgMul: 0.14, maxMana: 20 });
armor('aetherweaveRobe', 'Aetherweave Robe', '#8ad9ff', 'chest', 3, 3, 'aetherweave', { classBonus: 'mage', dmgMul: 0.12, maxMana: 20 });
armor('aetherweavePants', 'Aetherweave Pants', '#8ad9ff', 'legs', 2, 3, 'aetherweave', { classBonus: 'mage', dmgMul: 0.1, maxMana: 20 });
// Thornweave (summoner set): +minion cap +summon dmg
armor('thornweaveMask', 'Thornweave Mask', '#5a7a3a', 'head', 2, 1, 'thornweave', { classBonus: 'summon', dmgMul: 0.1, minionCap: 1 });
armor('thornweaveMantle', 'Thornweave Mantle', '#5a7a3a', 'chest', 3, 1, 'thornweave', { classBonus: 'summon', dmgMul: 0.12, minionCap: 1 });
armor('thornweaveGuards', 'Thornweave Guards', '#5a7a3a', 'legs', 2, 1, 'thornweave', { classBonus: 'summon', dmgMul: 0.1, minionCap: 1 });
// Blightplate (endgame): high defense
armor('blightHelm', 'Blight Helm', '#8a4fb0', 'head', 6, 4, 'blight', { dmgMul: 0.08 });
armor('blightCuirass', 'Blight Cuirass', '#8a4fb0', 'chest', 9, 4, 'blight', { dmgMul: 0.08 });
armor('blightGreaves', 'Blight Greaves', '#8a4fb0', 'legs', 7, 4, 'blight', { dmgMul: 0.08 });

// ---------- Accessories ----------
const acc = (id, name, color, kind, stats, tier, desc) =>
  def({ id, name, category: 'accessory', color, accKind: kind, accStats: stats, tier, desc });
acc('swiftboots', 'Swiftboots', '#7ee0c0', 'boots', { speed: 0.25 }, 1, '+25% movement speed.');
acc('cloudstepCharm', 'Cloudstep Charm', '#cfe0ff', 'wing', { extraJumps: 1 }, 2, 'Grants a double jump.');
acc('vitalBand', 'Vital Band', '#ff6b7d', 'ring', { maxHp: 40 }, 1, '+40 max health.');
acc('aetherLocket', 'Aether Locket', '#9ec3ff', 'ring', { maxMana: 30 }, 2, '+30 max Aether.');
acc('beastmasterSigil', 'Beastmaster Sigil', '#c58bff', 'ring', { minionCap: 1 }, 2, '+1 minion capacity.');
acc('ironhideEmblem', 'Ironhide Emblem', '#a9b0bd', 'ring', { defense: 6 }, 2, '+6 defense.');

// ---------- Potions ----------
const pot = (id, name, color, effect, desc) => def({ id, name, category: 'potion', color, potion: effect, maxStack: 30, desc });
pot('healLesser', 'Lesser Healing Draught', '#ff6b7d', { heal: 45 }, 'Restores 45 health.');
pot('healGreater', 'Greater Healing Draught', '#ff3b5d', { heal: 100 }, 'Restores 100 health.');
pot('aetherTonic', 'Aether Tonic', '#6a7bff', { mana: 60 }, 'Restores 60 Aether.');
pot('vigorBrew', 'Vigor Brew', '#7ee08a', { buff: { type: 'regen', duration: 30, hpRegen: 4 } }, 'Health regen for 30s.');
pot('ironskinTonic', 'Ironskin Tonic', '#c9c9c9', { buff: { type: 'ironskin', duration: 40, defense: 8 } }, '+8 defense for 40s.');
pot('swiftElixir', 'Swiftness Elixir', '#7ee0c0', { buff: { type: 'swift', duration: 40, speed: 0.3 } }, '+30% speed for 40s.');

// ---------- Ammo ----------
def({ id: 'flintArrow', name: 'Flint Arrow', category: 'ammo', color: '#c9c9c9', color2: '#8a6a3a', maxStack: 200, desc: 'Ammunition for bows.' });
def({ id: 'bolt', name: 'Bolt', category: 'ammo', color: '#b0895a', maxStack: 200, desc: 'Ammunition for repeaters.' });
def({ id: 'shot', name: 'Shot', category: 'ammo', color: '#ffcf6b', maxStack: 200, desc: 'Ammunition for guns.' });

// ---------- Materials ----------
const mat = (id, name, color, kind = 'misc', tier = 0, desc = '') => def({ id, name, category: 'material', color, matKind: kind, tier, desc });
mat('wood', 'Oakenwood', '#8a5a2a', 'misc', 0, 'Crafting wood.');
mat('fiber', 'Plant Fiber', '#7ea04a', 'misc', 0, 'Woven for starter gear.');
mat('dirt', 'Dirt', '#6b4a2b', 'misc');
mat('stone', 'Stone', '#6f7484', 'misc');
mat('clay', 'Clay', '#9a5b45', 'misc');
mat('sand', 'Sand', '#d8c98a', 'misc');
mat('blightstone', 'Blightstone', '#4a2f66', 'misc', 4);
mat('cupriteOre', 'Cuprite Ore', '#c47b4a', 'ore', 1);
mat('ironveinOre', 'Ironvein Ore', '#a9b0bd', 'ore', 2);
mat('glimmerOre', 'Glimmer Ore', '#ffe08a', 'ore', 3);
mat('aetheriteOre', 'Aetherite Ore', '#8ad9ff', 'ore', 3);
mat('blightoreOre', 'Blightore', '#8a4fb0', 'ore', 4);
mat('cupriteBar', 'Cuprite Bar', '#e08a5a', 'bar', 1);
mat('ironveinBar', 'Ironvein Bar', '#c0c6d2', 'bar', 2);
mat('glimmerBar', 'Glimmer Bar', '#ffe8a0', 'bar', 3);
mat('aetheriteBar', 'Aetherite Bar', '#a0e4ff', 'bar', 3);
mat('blightBar', 'Blight Bar', '#a06bd0', 'bar', 4);
mat('groveHeart', 'Grove Heart', '#7ee08a', 'drop', 1, 'Beats with forest life. Dropped by the Grovekeeper.');
mat('marrow', 'Ancient Marrow', '#e9e2c8', 'drop', 2, 'Dropped by the Gravemaw.');
mat('sovereignCore', "Sovereign's Core", '#c58bff', 'drop', 4, 'Pulsing heart of corruption. Dropped by the Blight Sovereign.');
mat('emberDust', 'Ember Dust', '#ff8c3b', 'drop', 1, 'Warm to the touch.');
mat('aetherShard', 'Aether Shard', '#8ad9ff', 'drop', 2, 'Crystalized Aether.');

// ---------- Blocks & stations (placeable) ----------
const block = (id, name, tile, tier = 0) => def({ id, name, category: 'block', place: tile, color: (ITEMS.stone && '#888'), tier });
def({ id: 'planks', name: 'Oaken Planks', category: 'block', place: T.PLANKS, color: '#a67c46' });
def({ id: 'stoneBrick', name: 'Stone Brick', category: 'block', place: T.STONEBRICK, color: '#7c8296', tier: 1 });
def({ id: 'torch', name: 'Emberlight', category: 'block', place: T.TORCH, color: '#ffb347', maxStack: 99, desc: 'Placeable light source.' });
// stations
def({ id: 'craftingBench', name: 'Crafting Bench', category: 'station', place: T.BENCH, color: '#8a6a3a', desc: 'Unlocks basic recipes.' });
def({ id: 'smeltery', name: 'Smeltery', category: 'station', place: T.SMELTERY, color: '#5a5560', desc: 'Smelts ore into bars.' });
def({ id: 'forge', name: 'Forge', category: 'station', place: T.FORGE, color: '#4a4a55', desc: 'Forges metal gear.' });
def({ id: 'aetherAltar', name: 'Aether Altar', category: 'station', place: T.ALTAR, color: '#5a7abf', desc: 'Crafts magic gear & boss idols.' });
// raw dirt/stone/etc as placeable too
def({ id: 'dirtBlock', name: 'Dirt Block', category: 'block', place: T.DIRT, color: '#6b4a2b' });

// dirt material can also be placed:
ITEMS.dirt.place = T.DIRT;
ITEMS.stone.place = T.STONE;
ITEMS.wood.place = T.WOOD;
ITEMS.sand.place = T.SAND;
ITEMS.clay.place = T.CLAY;

// ---------- Boss summoning items ----------
def({ id: 'verdantEffigy', name: 'Verdant Effigy', category: 'summonitem', color: '#7ee08a', color2: '#3a6a2a', summonBoss: 'grovekeeper', maxStack: 20, desc: 'Summons the Grovekeeper in the Forest (day or night).' });
def({ id: 'boneSigil', name: 'Bone Sigil', category: 'summonitem', color: '#e9e2c8', color2: '#8a7a5a', summonBoss: 'gravemaw', maxStack: 20, desc: 'Summons the Gravemaw in the Underground.' });
def({ id: 'blightIdol', name: 'Blight Idol', category: 'summonitem', color: '#c58bff', color2: '#4a2f66', summonBoss: 'blightSovereign', maxStack: 20, desc: 'Summons the Blight Sovereign in the Corrupted Lands.' });

export function item(id) { return ITEMS[id]; }
export function allItemIds() { return Object.keys(ITEMS); }

// Convenience groupings for commands / crafting UI.
export const WEAPON_IDS = Object.values(ITEMS).filter(i => i.category === 'weapon').map(i => i.id);
export const DEMO_GIVE_ALL = Object.values(ITEMS)
  .filter(i => i.category !== 'material' || i.matKind === 'bar')
  .map(i => i.id);
