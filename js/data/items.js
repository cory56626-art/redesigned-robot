// Summoner Realms — item catalogue. All original names/designs.
// Categories: weapon (melee/ranged/mage/summon), tool, armor, accessory,
// potion, ammo, material, block, station, summonitem.
import { T } from '../world/tiles.js?v=title-screen-1';

export const ITEMS = {};

// The starter boundary is deliberately explicit. These are the tools, basic
// gear, supplies, fauna materials, and simple utility items a player can reach
// before ore progression. Blocks stay available separately because the realm's
// building layer is not part of the combat/item cut.
export const FIRST_WORLD_ITEM_IDS = new Set([
  // Starting kit and first-world tools/weapons.
  'woodPick', 'woodAxe', 'woodHammer', 'rustedShortblade', 'bonefangDagger',
  'saplingBow', 'slingcaster', 'sparkWand', 'emberTome', 'spriteWhistle',
  'fiberHood', 'fiberVest', 'fiberLeggings', 'flintArrow',
  'bomb', 'fireFlask', 'shuriken', 'healLesser',
  // Gathered materials and early stations.
  'wood', 'fiber', 'stick', 'sapling', 'dirt', 'stone', 'clay', 'sand',
  'craftingBench', 'smeltery', 'emberDust',
  // Wildlife, cooking, fishing, and basic exploration supplies.
  'rawBeef', 'rawPork', 'rawMutton', 'rawGame', 'rawFish',
  'leather', 'wool', 'feather',
  'cookedBeef', 'cookedPork', 'cookedMutton', 'cookedGame', 'cookedFish',
  'woodRod', 'worm', 'grub', 'cricket', 'beetle', 'firefly', 'glowmoth',
  'woodCrate', 'huntersBoots',
]);

// New pre-Hardmode content is intentionally listed separately from the starter
// kit. This keeps the old retired catalogue disabled while making the new ore
// progression auditable in one place.
export const PREHARDMODE_ITEM_IDS = new Set([
  'forge',
  'stoneironOre', 'stoneironBar', 'amberOre', 'amberBar',
  'tideOre', 'tideBar', 'emberOre', 'emberBar',
  'verdantOre', 'verdantBar', 'stormOre', 'stormBar',
  'shadowglassOre', 'shadowglassBar', 'starsteelOre', 'starsteelBar',
  'stoneironPick', 'amberPick', 'tidePick', 'emberPick', 'verdantPick',
  'stormPick', 'shadowglassPick', 'starsteelPick',
  'amberBow', 'tideTrident', 'emberblade', 'stormcaller',
  'stoneironBroadsword', 'verdantVineblade', 'shadowglassScythe',
  'tideWand', 'verdantBloomStaff', 'shadowglassOrb',
  'tideSpriteStaff', 'verdantSproutIdol', 'shadowmothTome',
  'mechBeacon', 'mechCore', 'wormLure', 'wormCore', 'hiveResonanceCore',
  'royalChitinPlate', 'venomCore', 'royalChitinCrown', 'royalChitinCarapace', 'royalChitinTreads',
  'missileLauncher', 'mechanicalSword',
  'stingerBow', 'mandibleEdge', 'hiveCatalyst', 'broodStaff',
  'waspEmblem', 'vesperaWings',
]);

// Raw terrain materials are also placeable blocks, so they remain available
// under the user's explicit block exception even when they are not part of the
// starter/crafting set above.
const BLOCK_MATERIAL_IDS = new Set([
  'dirt', 'stone', 'wood', 'sand', 'clay', 'snow', 'ice', 'sandstone',
  'deepstone', 'blightstone',
]);

function def(o) {
  if (!FIRST_WORLD_ITEM_IDS.has(o.id) && !PREHARDMODE_ITEM_IDS.has(o.id) &&
      o.category !== 'block' && !BLOCK_MATERIAL_IDS.has(o.id)) return null;
  const d = { maxStack: 99, tier: 0 };
  if (['weapon', 'tool', 'armor', 'accessory', 'summonitem'].includes(o.category)) d.maxStack = 1;
  ITEMS[o.id] = Object.assign(d, o);
  return ITEMS[o.id];
}

// ---------- Tools: pickaxes (mine stone & ore) ----------
def({ id: 'woodPick', name: 'Oaken Pick', category: 'tool', tool: { power: 1, kind: 'pickaxe' }, color: '#a67c46', desc: 'Basic pickaxe. Mines stone and building materials (power 1).' });
const orePick = (id, name, color, power, tier, desc) =>
  def({ id, name, category: 'tool', tool: { power, kind: 'pickaxe' }, color, tier, desc: `${desc} Mining power ${power}.` });
orePick('stoneironPick', 'Stoneiron Pickaxe', '#9aa7b2', 2, 1, 'Rugged gray metal for the first ore tier.');
orePick('amberPick', 'Amber Pickaxe', '#d69a3c', 3, 2, 'Golden crystal-metal that cuts deeper stone.');
orePick('tidePick', 'Tide Pickaxe', '#4eb5d2', 4, 3, 'Blue aquatic metal that handles deep rock.');
orePick('emberPick', 'Ember Pickaxe', '#e45532', 5, 4, 'Hot red-orange metal built for caverns.');
orePick('verdantPick', 'Verdant Pickaxe', '#65b957', 6, 5, 'Plant-infused metal with a living edge.');
orePick('stormPick', 'Storm Pickaxe', '#f4dc55', 7, 6, 'Electric yellow metal that crackles in the dark.');
orePick('shadowglassPick', 'Shadowglass Pickaxe', '#9d65d1', 8, 7, 'Black-purple crystal-metal with a razor edge.');
orePick('starsteelPick', 'Starsteel Pickaxe', '#d8f4ff', 9, 8, 'White-blue glowing metal from the deepest rock.');
def({ id: 'cupritePick', name: 'Cuprite Pick', category: 'tool', tool: { power: 2, kind: 'pickaxe' }, color: '#c47b4a', tier: 1, desc: 'Mining power 2. Breaks Ironvein.' });
def({ id: 'ironveinPick', name: 'Ironvein Pick', category: 'tool', tool: { power: 3, kind: 'pickaxe' }, color: '#a9b0bd', tier: 2, desc: 'Mining power 3. Breaks Glimmer & Aetherite.' });
def({ id: 'glimmerPick', name: 'Glimmer Pick', category: 'tool', tool: { power: 4, kind: 'pickaxe' }, color: '#ffe08a', tier: 3, desc: 'Mining power 4. Breaks Blightore.' });

// ---------- Tools: axes (chop trees for wood) ----------
def({ id: 'woodAxe', name: 'Oaken Hatchet', category: 'tool', tool: { power: 1, kind: 'axe' }, color: '#9a6a3a', color2: '#7a5228', desc: 'Basic axe. Chop trees to fell them for wood (power 1).' });
def({ id: 'cupriteAxe', name: 'Cuprite Axe', category: 'tool', tool: { power: 2, kind: 'axe' }, color: '#c47b4a', tier: 1, desc: 'Chops trees faster (power 2).' });
def({ id: 'ironveinAxe', name: 'Ironvein Axe', category: 'tool', tool: { power: 3, kind: 'axe' }, color: '#a9b0bd', tier: 2, desc: 'Chops trees swiftly (power 3).' });

// ---------- Tools: hammers (sculpt blocks, strip walls) ----------
// A hammer never breaks a block. Each hit walks the tile one step around the
// shape cycle — full, half, the four slopes — and a hammer swung at open air
// with a background wall behind it takes the wall down instead.
def({ id: 'woodHammer', name: 'Oaken Mallet', category: 'tool', tool: { power: 1, kind: 'hammer' }, color: '#9a6a3a', color2: '#6b4a24', desc: 'Sculpts blocks into halves and slopes. Strips background walls.' });
def({ id: 'cupriteHammer', name: 'Cuprite Hammer', category: 'tool', tool: { power: 2, kind: 'hammer' }, color: '#c47b4a', tier: 1, desc: 'Shapes blocks and strips walls faster (power 2).' });
def({ id: 'ironveinHammer', name: 'Ironvein Sledge', category: 'tool', tool: { power: 3, kind: 'hammer' }, color: '#a9b0bd', tier: 2, desc: 'Shapes blocks and strips walls swiftly (power 3).' });

// ---------- Melee weapons (8) ----------
const melee = (id, name, color, dmg, useTime, tier, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'melee', color, damage: dmg, useTime, tier, knockback: 4, crit: 0.06, reach: 30, arc: 1.6, meleeKind: 'sword', desc: `${name} — ${dmg} melee damage.` }, extra));
melee('rustedShortblade', 'Rusted Shortblade', '#b7bcc9', 9, 0.35, 0);
melee('bonefangDagger', 'Bonefang Dagger', '#e9e2c8', 6, 0.18, 0, { knockback: 2, crit: 0.12, reach: 22, desc: 'Fast, low-damage stabs. High crit.' });
melee('cupriteSword', 'Cuprite Sword', '#c47b4a', 13, 0.34, 1);
melee('thornspikeSpear', 'Thornspike Spear', '#5a7a3a', 15, 0.42, 1, { meleeKind: 'spear', reach: 46, arc: 0.6, knockback: 6, desc: 'Long thrust with extended reach.' });
melee('ironveinSaber', 'Ironvein Saber', '#a9b0bd', 19, 0.30, 2, { crit: 0.10 });
melee('emberaxe', 'Emberaxe', '#ff7a3b', 24, 0.55, 2, { meleeKind: 'heavy', reach: 34, arc: 2.0, knockback: 8, effect: { burn: 3 }, fx: { swing: 'flame' }, desc: 'Heavy swing that sets foes ablaze.' });
melee('glimmerGlaive', 'Glimmer Glaive', '#ffe08a', 28, 0.34, 3, { meleeKind: 'spear', reach: 44, crit: 0.10, phasing: true, fx: { swing: 'gleam' }, desc: 'Glimmer Glaive — 28 melee damage. Its light passes through thin stone.' });
// `phasing` weapons are the only melee that reaches through terrain — every
// other blade is stopped by rock (see systems/combat._meleeCanReach). It is a
// deliberate top-tier perk, and the tooltip says so.
melee('aetheredgeGreatblade', 'Aetheredge Greatblade', '#8ad9ff', 40, 0.5, 4, { meleeKind: 'heavy', reach: 40, arc: 2.2, knockback: 10, crit: 0.12, phasing: true, fx: { swing: 'arcwave' }, desc: 'Massive arc of arcane steel. Its edge cuts straight through stone.' });
melee('tideTrident', 'Tide Trident', '#51c8e8', 24, 0.38, 3, { meleeKind: 'spear', reach: 52, arc: 0.55, knockback: 6, effect: { slow: 1.2 }, fx: { swing: 'tide' }, desc: 'A long blue-metal thrust that leaves a slowing spray.' });
melee('emberblade', 'Emberblade', '#f05b32', 32, 0.48, 4, { meleeKind: 'heavy', reach: 38, arc: 2.0, knockback: 8, effect: { burn: 4 }, fx: { swing: 'flame' }, desc: 'A hot red-orange blade that sets enemies ablaze.' });
melee('stoneironBroadsword', 'Stoneiron Broadsword', '#9aa7b2', 12, 0.39, 1, {
  reach: 34, knockback: 5, fx: { swing: 'stoneiron' }, desc: 'A dependable first-tier blade forged from rugged gray metal.',
});
melee('verdantVineblade', 'Verdant Vineblade', '#65b957', 25, 0.42, 5, {
  reach: 38, arc: 1.45, knockback: 5, effect: { poison: 2.5 }, fx: { swing: 'vine' },
  desc: 'A living green blade that leaves a mild toxin in its cuts.',
});
melee('shadowglassScythe', 'Shadowglass Scythe', '#9d65d1', 34, 0.54, 7, {
  meleeKind: 'heavy', reach: 45, arc: 2.05, knockback: 7, crit: 0.08, fx: { swing: 'shadow' },
  desc: 'A wide black-purple crystal sweep. Strong, but deliberately slow before Hardmode.',
});
melee('mechanicalSword', 'Mechanical Sword', '#78d9ff', 39, 0.46, 9, {
  meleeKind: 'heavy', reach: 43, arc: 1.9, knockback: 8, crit: 0.08, fx: { swing: 'mechanical' },
  desc: 'Rare Mech drop. A weighted blue-steel blade that tears a bright gear-shaped arc through a crowd.',
});
melee('mandibleEdge', 'Mandible Edge', '#efbb57', 22, 0.34, 10, {
  reach: 37, arc: 1.48, knockback: 4, crit: 0.10, doubleStrike: 0.68,
  effect: { poison: 1.8 }, fx: { swing: 'mandible' },
  desc: 'Vespera drop. Twin obsidian-gold blades land a fast second slash and leave a brief toxin.',
});

// ---------- Ranged weapons (8) ----------
const ranged = (id, name, color, dmg, useTime, tier, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'ranged', color, damage: dmg, useTime, tier, knockback: 3, crit: 0.06, projSpeed: 480, projColor: color, rangedKind: 'bow', desc: `${name} — ${dmg} ranged damage.` }, extra));
ranged('saplingBow', 'Sapling Bow', '#7a9a4a', 9, 0.42, 0, { ammo: 'flintArrow', gravity: true, projectileKind: 'saplingArrow', trail: '#a8d883', fx: { shot: 'leaf' }, desc: 'Simple bow. Uses Flint Arrows.' });
ranged('slingcaster', 'Slingcaster', '#b0895a', 7, 0.30, 0, { projSpeed: 420, gravity: true, projColor: '#9a9a9a', projectileKind: 'slingStone', trail: '#b7bec8', fx: { shot: 'sling' }, desc: 'Hurls pebbles. No ammo needed.' });
ranged('cupriteRepeater', 'Cuprite Repeater', '#c47b4a', 11, 0.22, 1, { ammo: 'bolt', projSpeed: 560, desc: 'Rapid crossbow. Uses Bolts.' });
ranged('huntersLongbow', "Hunter's Longbow", '#8a6a3a', 14, 0.45, 1, { ammo: 'flintArrow', gravity: true, projSpeed: 620, desc: 'Powerful draw. Uses Flint Arrows.' });
ranged('boltflinger', 'Boltflinger', '#9aa6c0', 16, 0.20, 2, { projSpeed: 640, desc: 'Auto-flings energy bolts. No ammo.' });
ranged('emberlockMusket', 'Emberlock Musket', '#5a4a3a', 26, 0.6, 2, { ammo: 'shot', rangedKind: 'gun', projSpeed: 760, projColor: '#ffcf6b', effect: { burn: 2 }, fx: { shot: 'muzzle' }, desc: 'Slow, heavy gun. Uses Shot.' });
ranged('glimmerRifle', 'Glimmer Rifle', '#ffe08a', 22, 0.26, 3, { ammo: 'shot', rangedKind: 'gun', projSpeed: 820, crit: 0.10, fx: { shot: 'muzzle' }, desc: 'Fast rifle. Uses Shot.' });
ranged('stormpiercer', 'Stormpiercer', '#8ad9ff', 20, 0.30, 3, { projSpeed: 700, pierce: 2, projColor: '#bfe9ff', fx: { shot: 'storm' }, trail: '#bfe9ff', desc: 'Piercing storm arrows. No ammo.' });
ranged('amberBow', 'Amber Bow', '#ffc04d', 18, 0.36, 2, { ammo: 'flintArrow', gravity: true, projSpeed: 650, projColor: '#ffe08a', projectileKind: 'amberArrow', trail: '#ffe08a', fx: { shot: 'amber' }, desc: 'Golden crystal limbs launch bright Flint Arrows.' });
ranged('missileLauncher', 'Missile Launcher', '#ffad55', 34, 0.72, 9, {
  rangedKind: 'launcher', projectileKind: 'playerMissile', projSpeed: 520, projColor: '#ffb35b',
  projectileW: 16, projectileH: 9, blastRadius: 54, blastDamage: 23, trail: '#ffca70',
  fx: { shot: 'launcher' }, knockback: 7,
  desc: 'Rare Mech drop. Fires a slow, self-powered rocket that detonates on impact. No ammo needed.',
});
ranged('stingerBow', 'Stinger Bow', '#d89d3e', 30, 0.32, 10, {
  ammo: 'flintArrow', gravity: true, projSpeed: 700, projColor: '#f4ce76', projectileKind: 'venomArrow',
  effect: { poison: 3.2 }, trail: '#e7bb58', fx: { shot: 'stinger' },
  desc: 'Vespera drop. Fires venom-coated arrows that keep poison pressure on anything they strike.',
});

// ---------- Mage weapons (8) ----------
const mage = (id, name, color, dmg, useTime, tier, mana, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'mage', color, damage: dmg, useTime, tier, manaCost: mana, knockback: 2, crit: 0.06, projSpeed: 420, projColor: color, mageKind: 'staff', desc: `${name} — ${dmg} magic damage, ${mana} Aether.` }, extra));
mage('sparkWand', 'Spark Wand', '#9ec3ff', 10, 0.32, 0, 7, { projectileKind: 'sparkBolt', trail: '#cfe6ff', fx: { cast: 'spark' } });
mage('emberTome', 'Ember Tome', '#ff7a3b', 12, 0.5, 0, 11, { mageKind: 'tome', effect: { burn: 3 }, gravity: false, projectileKind: 'emberball', trail: '#ff9e52', fx: { cast: 'ember' }, desc: 'Lobs burning embers.' });
mage('frostshardStaff', 'Frostshard Staff', '#bfe9ff', 14, 0.36, 1, 10, { effect: { slow: 1.6 }, fx: { cast: 'frost' }, desc: 'Chilling shards that slow foes.' });
mage('venomWand', 'Venom Wand', '#7ee08a', 11, 0.32, 1, 9, { effect: { poison: 4 }, desc: 'Spits venom that poisons.' });
mage('aetherboltStaff', 'Aetherbolt Staff', '#8ad9ff', 18, 0.32, 2, 13);
mage('thunderRod', 'Thunder Rod', '#fff2a0', 22, 0.45, 2, 18, { pierce: 3, projSpeed: 900, fx: { cast: 'lightning' }, trail: '#fff2a0', desc: 'Piercing bolt of lightning.' });
mage('prismScepter', 'Prism Scepter', '#c58bff', 20, 0.30, 3, 16, { multishot: 3, spread: 0.4, fx: { cast: 'prism' }, desc: 'Fires a fan of prism shards.' });
mage('voidlance', 'Voidlance', '#b06bff', 34, 0.5, 4, 24, { pierce: 4, projSpeed: 640, fx: { cast: 'void' }, trail: '#b06bff', desc: 'A lancing beam of void energy.' });
mage('stormcaller', 'Stormcaller', '#fff06a', 36, 0.42, 6, 20, { pierce: 3, projSpeed: 900, projectileKind: 'stormBolt', fx: { cast: 'lightning' }, trail: '#fff8a8', desc: 'Calls a piercing yellow bolt from the sky.' });
mage('tideWand', 'Tide Wand', '#4eb5d2', 15, 0.34, 3, 10, {
  effect: { slow: 0.8 }, projSpeed: 520, projectileKind: 'tideBolt', fx: { cast: 'tide' }, trail: '#9defff',
  desc: 'Launches a compact water bolt that briefly slows enemies.',
});
mage('verdantBloomStaff', 'Verdant Bloom Staff', '#65b957', 19, 0.44, 5, 13, {
  effect: { poison: 2.5 }, projSpeed: 500, projectileKind: 'seedBloom', fx: { cast: 'bloom' }, trail: '#b8f58a',
  desc: 'Fires a seed-bloom projectile with a small lingering toxin.',
});
mage('shadowglassOrb', 'Shadowglass Orb', '#9d65d1', 25, 0.48, 7, 17, {
  pierce: 1, projSpeed: 620, projectileKind: 'shadowOrb', fx: { cast: 'shadow' }, trail: '#d7a5ff',
  desc: 'A slow black-purple orb that pierces one enemy before Hardmode.',
});
mage('hiveCatalyst', 'Hive Catalyst', '#d7a34c', 24, 0.46, 10, 18, {
  projectileKind: 'hiveOrb', projSpeed: 390, projectileW: 12, projectileH: 12,
  homing: true, homingStrength: 2.2, effect: { poison: 2.8 }, trail: '#edc968',
  burstCount: 3, burstDamage: 9, burstKind: 'venomMote', burstColor: '#c9ee79',
  burstSpeed: 255, burstLife: 1.05, burstHoming: true, burstHomingStrength: 2.6,
  burstEffect: { poison: 2.0 }, fx: { cast: 'hive' },
  desc: 'Vespera drop. A guided venom orb splits into three smaller homing motes on impact.',
});

// ---------- Summoner weapons (6) ----------
const summon = (id, name, color, useTime, tier, mana, minion, extra = {}) =>
  def(Object.assign({ id, name, category: 'weapon', weaponClass: 'summon', color, useTime, tier, manaCost: mana, summonMinion: minion, desc: `Summons a ${minion}. Costs ${mana} Aether.` }, extra));
summon('spriteWhistle', 'Sprite Whistle', '#9ec3ff', 0.5, 0, 12, 'wisp');
summon('beetleSigil', 'Beetle Sigil', '#c47b4a', 0.5, 1, 14, 'beetle');
summon('ravenTotem', 'Raven Totem', '#7a6a9a', 0.5, 1, 16, 'raven');
summon('emberlingStaff', 'Emberling Staff', '#ff7a3b', 0.5, 2, 18, 'emberling');
summon('thornguardIdol', 'Thornguard Idol', '#5a7a3a', 0.5, 2, 20, 'sentinel');
summon('wraithBell', 'Wraith Bell', '#b06bff', 0.5, 3, 24, 'wraith');
summon('tideSpriteStaff', 'Tide Sprite Staff', '#4eb5d2', 0.5, 3, 10, 'tideSprite', {
  desc: 'Summons a small blue Tide Sprite. It only fires when it has clear line of sight.',
});
summon('verdantSproutIdol', 'Verdant Sprout Idol', '#65b957', 0.5, 5, 14, 'verdantSprout', {
  desc: 'Summons a tethered sprout guardian. Its melee lash requires clear line of sight.',
});
summon('shadowmothTome', 'Shadowmoth Tome', '#9d65d1', 0.5, 7, 18, 'shadowmoth', {
  desc: 'Summons a fragile shadow moth that fires only through open sight lines.',
});
summon('broodStaff', 'Brood Staff', '#d7a34c', 0.5, 10, 20, 'broodWasp', {
  desc: 'Vespera drop. Summons a quick wasp that fires toxin stings through clear sight lines.',
});
summon('diamondHeart', 'Diamond Heart', '#dffcff', 0.78, 5, 30, 'diamondHeart', {
  maxStack: 1,
  maxMinions: 1,
  debugOnly: true,
  desc: 'Endgame summon. Calls a winged Diamond Heart that hunts the highest-health foe.',
});
summon('aidanSigil', 'Aidan Sigil', '#b783ff', 0.78, 5, 40, 'aidan', {
  maxStack: 1,
  maxMinions: 1,
  debugOnly: true,
  desc: 'Demo-only endgame summon. Calls Aidan in permanent brown-and-gold armor with portal and railgun tech.',
});

// ---------- Throwables ----------
// Thrown along the aim direction and pulled into an arc by gravity, bouncing off
// terrain. See entities/thrown.js for the physics and systems/explosions.js for
// what the explosive ones do on detonation.
//
//   throwKind      icon/behaviour family: bomb | stick | shuriken | knife
//   blastPower     what it is strong enough to break (see tiles.js blastResist)
//   blastRadius    tiles of destruction · blastDamage peak damage at the centre
//   fuse           seconds before it goes off; explodeOnImpact detonates on
//                  contact instead; sticky latches on and finishes its fuse
//   recoverChance  odds it drops back as a pickup instead of being consumed
const throwable = (id, name, o) =>
  def(Object.assign({ id, name, category: 'throwable', maxStack: 30, throwSpeed: 420, throwKind: 'bomb' }, o));

throwable('bomb', 'Blast Bomb', {
  color: '#3b4150', color2: '#ffcf6b', tier: 1, throwSize: 9,
  fuse: 2.2, blastPower: 1, blastRadius: 3, blastDamage: 46, explode: true, breaksBlocks: true,
  bounce: 0.42, spin: 6,
  desc: 'Fuse-lit bomb. Blows a small crater in dirt and stone, and hurts anything nearby — including you.',
});
throwable('dynamite', 'Dynamite', {
  color: '#b1362f', color2: '#e8d6a6', tier: 2, throwSize: 10, throwSpeed: 380,
  fuse: 3.0, blastPower: 2, blastRadius: 6, blastDamage: 95, explode: true, breaksBlocks: true,
  bounce: 0.3, spin: 8, gravityScale: 1.1,
  desc: 'A far bigger blast with a longer fuse. Breaks tougher stone. Throw it and then be somewhere else.',
});
throwable('stickyBomb', 'Cling Charge', {
  color: '#4f7a4a', color2: '#a7e36f', tier: 2, throwSize: 9,
  fuse: 2.6, blastPower: 2, blastRadius: 4, blastDamage: 62, explode: true, breaksBlocks: true,
  sticky: true, bounce: 0, spin: 5,
  desc: 'Latches onto the first surface it touches, then detonates. For blasting ceilings and shafts.',
});
throwable('fireFlask', 'Ember Flask', {
  color: '#ff7a3b', color2: '#ffcf6b', tier: 1, throwSize: 8,
  explodeOnImpact: true, blastPower: 0, blastRadius: 2, blastDamage: 34, explode: true,
  breaksBlocks: false, blastColors: ['#fff2c0', '#ff8c3b', '#ff5a2b'],
  bounce: 0, spin: 10, effect: { burn: 4 },
  desc: 'Shatters on impact in a gout of flame. Sets foes alight but leaves the terrain standing.',
});
throwable('shuriken', 'Iron Shuriken', {
  color: '#b8bfcc', color2: '#6f7484', tier: 0, throwKind: 'shuriken', throwSize: 8,
  throwSpeed: 560, gravityScale: 0.35, bounce: 0.55, friction: 0.8, spin: 26,
  contactDamage: 14, knockback: 3, pierce: 0, breakOnImpact: false,
  recoverChance: 0.5, maxLife: 6,
  desc: 'Flat, fast and barely affected by gravity. Often recoverable after it lands.',
});
throwable('throwingKnife', 'Balanced Knife', {
  color: '#d8d2c0', color2: '#7a5a2a', tier: 1, throwKind: 'knife', throwSize: 8,
  throwSpeed: 500, gravityScale: 0.7, bounce: 0.2, spin: 20,
  contactDamage: 22, knockback: 4, pierce: 1, breakOnImpact: true,
  recoverChance: 0.35, maxLife: 6,
  desc: 'Heavier than a shuriken and it punches through one foe before stopping.',
});

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
// Royal Chitin is Vespera's post-clear defensive path. The base armor is solid
// but not a tank set; its completed bonus turns that protection into movement,
// making repeat Vespera clears and the next pre-Hardmode challenges feel more
// mobile instead of simply erasing mistakes with raw defense.
armor('royalChitinCrown', 'Royal Chitin Crown', '#2a222d', 'head', 7, 10, 'royalChitin', {});
armor('royalChitinCarapace', 'Royal Chitin Carapace', '#2a222d', 'chest', 10, 10, 'royalChitin', {});
armor('royalChitinTreads', 'Royal Chitin Treads', '#2a222d', 'legs', 8, 10, 'royalChitin', {});

// ---------- Accessories ----------
const acc = (id, name, color, kind, stats, tier, desc) =>
  def({ id, name, category: 'accessory', color, accKind: kind, accStats: stats, tier, desc });
acc('swiftboots', 'Swiftboots', '#7ee0c0', 'boots', { speed: 0.25 }, 1, '+25% movement speed.');
acc('cloudstepCharm', 'Cloudstep Charm', '#cfe0ff', 'wing', { extraJumps: 1 }, 2, 'Grants a double jump.');
acc('vitalBand', 'Vital Band', '#ff6b7d', 'ring', { maxHp: 40 }, 1, '+40 max health.');
acc('aetherLocket', 'Aether Locket', '#9ec3ff', 'ring', { maxMana: 30 }, 2, '+30 max Aether.');
acc('beastmasterSigil', 'Beastmaster Sigil', '#c58bff', 'ring', { minionCap: 1 }, 2, '+1 minion capacity.');
acc('ironhideEmblem', 'Ironhide Emblem', '#a9b0bd', 'ring', { defense: 6 }, 2, '+6 defense.');
acc('waspEmblem', 'Wasp Emblem', '#efbb57', 'emblem', { speed: 0.10, jumpMul: 1.12, fallDamageMul: 0.82 }, 10, '+10% movement speed, +12% jump height, and slightly reduced fall damage.');
acc('vesperaWings', 'Vespera Wings', '#d7a34c', 'wing', { speed: 0.18, flightTime: 1.35, flightLift: 245, glideFallSpeed: 190 }, 10, 'Rare Vespera drop. Short flight, controlled glide, brief hover, and a strong horizontal boost.');

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
mat('wood', 'Oakenwood', '#8a5a2a', 'misc', 0, 'Crafting wood. Fell trees with an axe.');
mat('fiber', 'Plant Fiber', '#7ea04a', 'misc', 0, 'Woven for starter gear.');
mat('stick', 'Twig', '#9a6a3a', 'misc', 0, 'Snapped from leaves. Crafts torches and arrows.');
mat('sapling', 'Sapling Seed', '#7ee08a', 'misc', 0, 'A seed shaken from the canopy.');
mat('dirt', 'Dirt', '#6b4a2b', 'misc');
mat('stone', 'Stone', '#6f7484', 'misc');
mat('clay', 'Clay', '#9a5b45', 'misc');
mat('sand', 'Sand', '#d8c98a', 'misc');
mat('blightstone', 'Blightstone', '#4a2f66', 'misc', 4);
mat('snow', 'Snowpack', '#dfe8f4', 'misc', 0, 'Packed snow from the Frostpine Hollow.');
mat('ice', 'Rimeglass', '#a8cfe4', 'misc', 1, 'Clear frozen stone. Slippery underfoot.');
mat('sandstone', 'Sandstone', '#bfa367', 'misc', 1, 'Compacted dune rock.');
mat('deepstone', 'Deepstone', '#4e4a59', 'misc', 2, 'Dense rock from below the caverns.');
mat('cupriteOre', 'Cuprite Ore', '#c47b4a', 'ore', 1);
mat('ironveinOre', 'Ironvein Ore', '#a9b0bd', 'ore', 2);
mat('glimmerOre', 'Glimmer Ore', '#ffe08a', 'ore', 3);
mat('aetheriteOre', 'Aetherite Ore', '#8ad9ff', 'ore', 3);
mat('glacieriteOre', 'Glacierite Ore', '#78c7e6', 'ore', 2, 'Cold blue ore found beneath the Snowy Taiga.');
mat('blightoreOre', 'Blightore', '#8a4fb0', 'ore', 4);
mat('cupriteBar', 'Cuprite Bar', '#e08a5a', 'bar', 1);
mat('ironveinBar', 'Ironvein Bar', '#c0c6d2', 'bar', 2);
mat('glimmerBar', 'Glimmer Bar', '#ffe8a0', 'bar', 3);
mat('aetheriteBar', 'Aetherite Bar', '#a0e4ff', 'bar', 3);
mat('glacieriteBar', 'Glacierite Bar', '#b5f1ff', 'bar', 2, 'A clear, cold ingot smelted from Taiga ore.');
mat('blightBar', 'Blight Bar', '#a06bd0', 'bar', 4);
mat('groveHeart', 'Grove Heart', '#7ee08a', 'drop', 1, 'Beats with forest life. Dropped by the Grovekeeper.');
mat('marrow', 'Ancient Marrow', '#e9e2c8', 'drop', 2, 'Dropped by the Gravemaw.');
mat('sovereignCore', "Sovereign's Core", '#c58bff', 'drop', 4, 'Pulsing heart of corruption. Dropped by the Blight Sovereign.');
mat('emberDust', 'Ember Dust', '#ff8c3b', 'drop', 1, 'Warm to the touch.');
mat('aetherShard', 'Aether Shard', '#8ad9ff', 'drop', 2, 'Crystalized Aether.');

// Eight new pre-Hardmode ores and their refined bars. The names, colours and
// tiers mirror the worldgen table so the inventory and terrain tell the same
// progression story.
mat('stoneironOre', 'Stoneiron Ore', '#9aa7b2', 'ore', 1, 'Rugged gray metal from surface caves.');
mat('stoneironBar', 'Stoneiron Bar', '#c5d0d8', 'bar', 1, 'Refined Stoneiron for early mining gear.');
mat('amberOre', 'Amber Ore', '#d69a3c', 'ore', 2, 'Golden crystal-metal in forests and deserts.');
mat('amberBar', 'Amber Bar', '#ffd36a', 'bar', 2, 'Warm golden metal with a glassy shine.');
mat('tideOre', 'Tide Ore', '#4eb5d2', 'ore', 3, 'Blue aquatic metal found beside underground lakes.');
mat('tideBar', 'Tide Bar', '#9cecff', 'bar', 3, 'A cool blue ingot that still hums with water.');
mat('emberOre', 'Ember Ore', '#e45532', 'ore', 4, 'Hot red-orange ore in the deep caverns.');
mat('emberBar', 'Ember Bar', '#ff9a55', 'bar', 4, 'A blazing ingot that holds a living spark.');
mat('verdantOre', 'Verdant Ore', '#65b957', 'ore', 5, 'Green, plant-infused metal beneath the jungle.');
mat('verdantBar', 'Verdant Bar', '#a6e27d', 'bar', 5, 'A living green alloy threaded with vines.');
mat('stormOre', 'Storm Ore', '#f4dc55', 'ore', 6, 'Electric yellow ore inside high sky islands.');
mat('stormBar', 'Storm Bar', '#fff3a0', 'bar', 6, 'Charged metal that snaps with static.');
mat('shadowglassOre', 'Shadowglass Ore', '#9d65d1', 'ore', 7, 'Black-purple crystalline ore in the Corrupted Lands.');
mat('shadowglassBar', 'Shadowglass Bar', '#d4a4ff', 'bar', 7, 'Dark crystal refined into a razor-edged bar.');
mat('starsteelOre', 'Starsteel Ore', '#d8f4ff', 'ore', 8, 'White-blue glowing metal at the deepest boundary.');
mat('starsteelBar', 'Starsteel Bar', '#ffffff', 'bar', 8, 'A brilliant final pre-Hardmode alloy.');
mat('mechCore', 'Mech Core', '#72ddff', 'drop', 8, 'A heavy blue reactor core claimed from The Mech. Its pulse marks the realm as Hardmode-ready.');
mat('wormCore', 'Worm Core', '#c383ff', 'drop', 9, 'A pulsing violet core from The Worm. It vibrates as if the tunnel is still moving.');
mat('royalChitinPlate', 'Royal Chitin Plate', '#2a222d', 'drop', 10, 'Obsidian-black chitin threaded with molten gold. Used to craft the Hive Resonance Core and future mobility gear.');
mat('venomCore', 'Venom Core', '#b9e86e', 'drop', 10, 'A pressurized gland taken from a Brood Drone. A rare component for venom gear and alchemy.');

// ---------- Fauna drops, food and cooking ----------
// Raw meat is a material; cooking it at a Smeltery turns it into a food item
// that heals a little and grants a short buff. Food shares the healing
// cooldown, so it supplements potions rather than replacing them — but unlike a
// potion it can still be eaten at full health for the buff alone.
mat('rawBeef', 'Raw Beef', '#c05a5a', 'food', 0, 'Cook it at a Smeltery.');
mat('rawPork', 'Raw Pork', '#d98a8a', 'food', 0, 'Cook it at a Smeltery.');
mat('rawMutton', 'Raw Mutton', '#c47b7b', 'food', 0, 'Cook it at a Smeltery.');
mat('rawGame', 'Raw Game', '#b06a5a', 'food', 0, 'Small game. Cook it at a Smeltery.');
mat('rawFish', 'Raw Fish', '#8fb8d8', 'food', 0, 'Caught with a rod. Cook it at a Smeltery.');
mat('leather', 'Cured Hide', '#8a6242', 'misc', 1, 'Tough hide from grazing animals.');
mat('wool', 'Raw Wool', '#efeadd', 'misc', 0, 'Soft fleece. Spins into fiber.');
mat('feather', 'Down Feather', '#f4f0e4', 'misc', 0, 'Light and stiff. Fletches arrows.');

const food = (id, name, color, heal, buff, desc) =>
  def({ id, name, category: 'potion', color, maxStack: 30, food: true, potion: { heal, buff }, desc });
food('cookedBeef', 'Roast Beef', '#a4562f', 30, { type: 'regen', duration: 40, hpRegen: 2 }, 'Restores 30 health and keeps you mending.');
food('cookedPork', 'Roast Pork', '#c2764f', 26, { type: 'regen', duration: 34, hpRegen: 2 }, 'Restores 26 health and keeps you mending.');
food('cookedMutton', 'Roast Mutton', '#b06340', 26, { type: 'ironskin', duration: 30, defense: 3 }, 'Restores 26 health and toughens you up.');
food('cookedGame', 'Roast Game', '#a86a4a', 18, { type: 'swift', duration: 30, speed: 0.12 }, 'Restores 18 health and quickens your step.');
food('cookedFish', 'Grilled Fish', '#c8b98a', 22, { type: 'regen', duration: 30, hpRegen: 2 }, 'Restores 22 health and keeps you mending.');

// ---------- Fishing ----------
// Rods differ in how fast a fish bites and how good the loot table gets. Bait
// is a bug (see data/fauna.js); better bait shifts the table further.
const rod = (id, name, color, tier, power, desc) =>
  def({ id, name, category: 'fishingrod', color, tier, rod: { power }, maxStack: 1, desc });
rod('woodRod', 'Sapling Rod', '#9a6a3a', 0, 1, 'A bent sapling and a line. Needs bait — catch a bug.');
rod('cupriteRod', 'Cuprite Rod', '#c47b4a', 1, 2, 'Bites come faster and the catch is better.');
rod('glimmerRod', 'Glimmer Rod', '#ffe08a', 3, 3, 'The finest line in the realm. Crates surface often.');

const bait = (id, name, color, color2, quality, desc) =>
  def({ id, name, category: 'bait', color, color2, bait: quality, maxStack: 99, desc });
bait('worm', 'Loam Worm', '#c98b7a', '#9a6558', 1, 'Basic bait. Dug from grassy ground.');
bait('grub', 'Pale Grub', '#e8dcc4', '#c0ad8e', 1, 'Basic bait. Found in caves.');
bait('cricket', 'Field Cricket', '#7a8a4a', '#4f5c2e', 2, 'Good bait. Hops through tall grass.');
bait('beetle', 'Ironshell Beetle', '#4a5464', '#2e3642', 2, 'Good bait. Scuttles over stone.');
bait('firefly', 'Emberfly', '#ffe9a0', '#ffb347', 3, 'Excellent bait. Only out after dark.');
bait('glowmoth', 'Glowmoth', '#cfe0ff', '#8fa8d8', 3, 'Excellent bait. Drifts through deep caves.');

// Buckets move water around by hand: the full one pours a tile's worth, the
// empty one scoops it back up. Placement goes through the same aim-tile path
// blocks use, so reach and the Smart Cursor behave identically.
def({ id: 'emptyBucket', name: 'Empty Pail', category: 'bucket', color: '#9aa2b0', color2: '#5f6672', maxStack: 1, bucket: 'empty', desc: 'Scoops up a tile of water. Use it on water.' });
def({ id: 'waterBucket', name: 'Water Pail', category: 'bucket', color: '#3f7fc0', color2: '#9aa2b0', maxStack: 1, bucket: 'water', desc: 'Pours out a tile of water. Use it on empty space.' });

// Crates: fished up, opened from the inventory for a rolled reward.
const crate = (id, name, color, color2, tier, desc) =>
  def({ id, name, category: 'crate', color, color2, tier, maxStack: 30, desc });
crate('woodCrate', 'Waterlogged Crate', '#8a6a3a', '#5f4a28', 1, 'Fished from the water. Open it to see what is inside.');
crate('ironCrate', 'Banded Crate', '#8d939f', '#5c626c', 2, 'A sturdier crate. Better odds of something worth having.');
crate('aetherCrate', 'Aetherbound Crate', '#8ad9ff', '#3f7fa0', 3, 'Hums faintly. The best of what the water gives up.');

// ---------- Blocks & stations (placeable) ----------
const block = (id, name, tile, tier = 0) => def({ id, name, category: 'block', place: tile, color: (ITEMS.stone && '#888'), tier });
def({ id: 'planks', name: 'Oaken Planks', category: 'block', place: T.PLANKS, color: '#a67c46' });
def({ id: 'stoneBrick', name: 'Stone Brick', category: 'block', place: T.STONEBRICK, color: '#7c8296', tier: 1 });
def({ id: 'torch', name: 'Emberlight', category: 'block', place: T.TORCH, color: '#ffb347', maxStack: 99, desc: 'Placeable light source.' });
// stations
def({ id: 'craftingBench', name: 'Crafting Bench', category: 'station', place: T.BENCH, color: '#8a6a3a', desc: 'Unlocks basic recipes.' });
def({ id: 'smeltery', name: 'Smeltery', category: 'station', place: T.SMELTERY, color: '#5a5560', desc: 'Cooks food and supports basic recipes.' });
def({ id: 'forge', name: 'Forge', category: 'station', place: T.FORGE, color: '#4a4a55', desc: 'Forges metal gear.' });
def({ id: 'aetherAltar', name: 'Aether Altar', category: 'station', place: T.ALTAR, color: '#5a7abf', desc: 'Crafts magic gear & boss idols.' });
// raw dirt/stone/etc as placeable too
def({ id: 'dirtBlock', name: 'Dirt Block', category: 'block', place: T.DIRT, color: '#6b4a2b' });

// Raw materials double as placeable blocks.
ITEMS.dirt.place = T.DIRT;
ITEMS.stone.place = T.STONE;
ITEMS.wood.place = T.WOOD;
ITEMS.sand.place = T.SAND;
ITEMS.clay.place = T.CLAY;
ITEMS.snow.place = T.SNOW;
ITEMS.ice.place = T.ICE;
ITEMS.sandstone.place = T.SANDSTONE;
ITEMS.deepstone.place = T.DEEPSTONE;
ITEMS.blightstone.place = T.BLIGHTSTONE;

// ---------- Boss summoning items ----------
def({ id: 'mechBeacon', name: 'Mech Beacon', category: 'summonitem', color: '#5f7896', color2: '#9deeff', summonBoss: 'theMech', maxStack: 20, desc: 'Forge: 5 Starsteel Bars, 4 Storm Bars, 6 Ember Dust. Use on the Surface in an open arena to summon The Mech.' });
def({ id: 'wormLure', name: 'Worm Lure', category: 'summonitem', color: '#3a2448', color2: '#d39aff', summonBoss: 'theWorm', maxStack: 20, desc: 'Post-Mech Forge recipe: 1 Mech Core, 6 Shadowglass Bars, 8 Ember Dust. Use on the Surface in an open arena to summon The Worm.' });
def({ id: 'hiveResonanceCore', name: 'Hive Resonance Core', category: 'summonitem', color: '#211a25', color2: '#efbb57', summonBoss: 'vespera', maxStack: 20, desc: 'Post-Worm Forge recipe: 8 Royal Chitin Plates and 4 rare Venom Cores. Use anywhere on the Surface at night to summon Vespera.' });
def({ id: 'verdantEffigy', name: 'Verdant Effigy', category: 'summonitem', color: '#7ee08a', color2: '#3a6a2a', summonBoss: 'grovekeeper', maxStack: 20, desc: 'Summons the Grovekeeper in the Forest (day or night).' });
def({ id: 'boneSigil', name: 'Bone Sigil', category: 'summonitem', color: '#e9e2c8', color2: '#8a7a5a', summonBoss: 'gravemaw', maxStack: 20, desc: 'Summons the Gravemaw in the Underground.' });
def({ id: 'blightIdol', name: 'Blight Idol', category: 'summonitem', color: '#c58bff', color2: '#4a2f66', summonBoss: 'blightSovereign', maxStack: 20, desc: 'Summons the Blight Sovereign in the Corrupted Lands.' });

export function item(id) { return ITEMS[id]; }
export function isItemEnabled(id) {
  const d = ITEMS[id];
  if (!d) return false;
  // All blocks and raw materials that can be placed are explicitly excluded
  // from the item removal request, including biome building materials.
  if (d.category === 'block' || (d.category === 'material' && d.place != null)) return true;
  return FIRST_WORLD_ITEM_IDS.has(id) || PREHARDMODE_ITEM_IDS.has(id);
}
export function allItemIds() { return Object.keys(ITEMS).filter(isItemEnabled); }

// Convenience groupings for commands / crafting UI.
export const WEAPON_IDS = Object.values(ITEMS).filter(i => isItemEnabled(i.id) && i.category === 'weapon').map(i => i.id);
export const DEMO_GIVE_ALL = Object.values(ITEMS)
  .filter(i => isItemEnabled(i.id) && !i.debugOnly && (i.category !== 'material' || i.matKind === 'bar'))
  .map(i => i.id);
