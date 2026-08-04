// Summoner Realms — crafting recipes.
// station: null (hand) | 'bench' | 'smeltery' | 'forge' | 'altar'
// requiresBoss: optional active-boss progression gate.
import { isItemEnabled } from './items.js?v=worm-surface-3';

const ALL_RECIPES = [
  // --- Hand ---
  { out: { item: 'craftingBench', count: 1 }, in: [{ item: 'wood', count: 8 }], station: null },
  { out: { item: 'torch', count: 5 }, in: [{ item: 'wood', count: 1 }, { item: 'fiber', count: 1 }], station: null },
  { out: { item: 'torch', count: 2 }, in: [{ item: 'stick', count: 1 }], station: null },
  { out: { item: 'woodPick', count: 1 }, in: [{ item: 'wood', count: 8 }], station: null },
  { out: { item: 'woodAxe', count: 1 }, in: [{ item: 'wood', count: 6 }], station: null },
  { out: { item: 'flintArrow', count: 12 }, in: [{ item: 'stick', count: 2 }, { item: 'stone', count: 1 }], station: null },
  { out: { item: 'planks', count: 4 }, in: [{ item: 'wood', count: 2 }], station: null },

  // --- Bench: starter gear & gathering tools ---
  { out: { item: 'fiberHood', count: 1 }, in: [{ item: 'fiber', count: 8 }], station: 'bench' },
  { out: { item: 'fiberVest', count: 1 }, in: [{ item: 'fiber', count: 12 }], station: 'bench' },
  { out: { item: 'fiberLeggings', count: 1 }, in: [{ item: 'fiber', count: 10 }], station: 'bench' },
  { out: { item: 'rustedShortblade', count: 1 }, in: [{ item: 'stone', count: 6 }, { item: 'wood', count: 3 }], station: 'bench' },
  { out: { item: 'bonefangDagger', count: 1 }, in: [{ item: 'stone', count: 4 }, { item: 'fiber', count: 4 }], station: 'bench' },
  { out: { item: 'saplingBow', count: 1 }, in: [{ item: 'wood', count: 8 }, { item: 'fiber', count: 4 }], station: 'bench' },
  { out: { item: 'slingcaster', count: 1 }, in: [{ item: 'wood', count: 6 }, { item: 'stone', count: 4 }], station: 'bench' },
  { out: { item: 'flintArrow', count: 25 }, in: [{ item: 'wood', count: 1 }, { item: 'stone', count: 1 }], station: 'bench' },
  { out: { item: 'sparkWand', count: 1 }, in: [{ item: 'wood', count: 6 }, { item: 'fiber', count: 3 }], station: 'bench' },
  { out: { item: 'emberTome', count: 1 }, in: [{ item: 'wood', count: 8 }, { item: 'stone', count: 4 }], station: 'bench' },
  { out: { item: 'spriteWhistle', count: 1 }, in: [{ item: 'wood', count: 10 }, { item: 'fiber', count: 3 }], station: 'bench' },
  { out: { item: 'smeltery', count: 1 }, in: [{ item: 'stone', count: 12 }, { item: 'clay', count: 4 }], station: 'bench' },
  { out: { item: 'stoneBrick', count: 10 }, in: [{ item: 'stone', count: 10 }], station: 'bench' },
  { out: { item: 'healLesser', count: 2 }, in: [{ item: 'fiber', count: 3 }, { item: 'clay', count: 1 }], station: 'bench' },
  { out: { item: 'verdantEffigy', count: 1 }, in: [{ item: 'wood', count: 12 }, { item: 'fiber', count: 8 }, { item: 'clay', count: 2 }], station: 'bench' },

  // --- Hammers: block sculpting ---
  // Available from the very first bench, because shaping terrain is a building
  // tool rather than a reward — locking it behind progression would just make
  // early building worse for no reason.
  { out: { item: 'woodHammer', count: 1 }, in: [{ item: 'wood', count: 8 }, { item: 'stick', count: 2 }], station: null },
  { out: { item: 'cupriteHammer', count: 1 }, in: [{ item: 'cupriteBar', count: 4 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'ironveinHammer', count: 1 }, in: [{ item: 'ironveinBar', count: 5 }, { item: 'wood', count: 3 }], station: 'forge' },

  // --- Fishing ---
  { out: { item: 'woodRod', count: 1 }, in: [{ item: 'wood', count: 8 }, { item: 'fiber', count: 5 }], station: 'bench' },
  { out: { item: 'cupriteRod', count: 1 }, in: [{ item: 'cupriteBar', count: 3 }, { item: 'wood', count: 5 }, { item: 'fiber', count: 4 }], station: 'forge' },
  { out: { item: 'glimmerRod', count: 1 }, in: [{ item: 'glimmerBar', count: 4 }, { item: 'aetheriteBar', count: 2 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'emptyBucket', count: 1 }, in: [{ item: 'cupriteBar', count: 3 }], station: 'forge' },

  // --- Cooking: raw meat and fish into food ---
  // Food shares the healing cooldown, so it supplements potions rather than
  // replacing them — but it can be eaten at full health for its buff.
  { out: { item: 'cookedBeef', count: 1 }, in: [{ item: 'rawBeef', count: 1 }], station: 'smeltery' },
  { out: { item: 'cookedPork', count: 1 }, in: [{ item: 'rawPork', count: 1 }], station: 'smeltery' },
  { out: { item: 'cookedMutton', count: 1 }, in: [{ item: 'rawMutton', count: 1 }], station: 'smeltery' },
  { out: { item: 'cookedGame', count: 1 }, in: [{ item: 'rawGame', count: 1 }], station: 'smeltery' },
  { out: { item: 'cookedFish', count: 1 }, in: [{ item: 'rawFish', count: 1 }], station: 'smeltery' },

  // --- Fauna materials ---
  { out: { item: 'fiber', count: 3 }, in: [{ item: 'wool', count: 1 }], station: 'bench' },
  { out: { item: 'flintArrow', count: 20 }, in: [{ item: 'feather', count: 2 }, { item: 'stick', count: 2 }, { item: 'stone', count: 1 }], station: 'bench' },
  { out: { item: 'huntersBoots', count: 1 }, in: [{ item: 'leather', count: 6 }, { item: 'fiber', count: 4 }], station: 'bench' },

  // --- Throwables ---
  // Deliberately cheap and craftable early: bombs are a mining tool as much as a
  // weapon, and running out of them shouldn't be a wall.
  { out: { item: 'shuriken', count: 8 }, in: [{ item: 'stone', count: 4 }, { item: 'stick', count: 1 }], station: 'bench' },
  { out: { item: 'bomb', count: 3 }, in: [{ item: 'clay', count: 2 }, { item: 'emberDust', count: 1 }, { item: 'fiber', count: 2 }], station: 'bench' },
  { out: { item: 'fireFlask', count: 3 }, in: [{ item: 'clay', count: 2 }, { item: 'emberDust', count: 2 }], station: 'bench' },
  { out: { item: 'throwingKnife', count: 6 }, in: [{ item: 'cupriteBar', count: 2 }, { item: 'wood', count: 1 }], station: 'forge' },
  { out: { item: 'dynamite', count: 3 }, in: [{ item: 'bomb', count: 3 }, { item: 'emberDust', count: 3 }, { item: 'ironveinBar', count: 1 }], station: 'forge' },
  { out: { item: 'stickyBomb', count: 3 }, in: [{ item: 'bomb', count: 3 }, { item: 'fiber', count: 6 }, { item: 'sapling', count: 2 }], station: 'forge' },

  // --- Smeltery: ore -> bars ---
  { out: { item: 'stoneironBar', count: 1 }, in: [{ item: 'stoneironOre', count: 3 }], station: 'smeltery' },
  { out: { item: 'amberBar', count: 1 }, in: [{ item: 'amberOre', count: 3 }], station: 'smeltery' },
  { out: { item: 'tideBar', count: 1 }, in: [{ item: 'tideOre', count: 4 }], station: 'smeltery' },
  { out: { item: 'emberBar', count: 1 }, in: [{ item: 'emberOre', count: 4 }], station: 'smeltery' },
  { out: { item: 'verdantBar', count: 1 }, in: [{ item: 'verdantOre', count: 5 }], station: 'smeltery' },
  { out: { item: 'stormBar', count: 1 }, in: [{ item: 'stormOre', count: 5 }], station: 'smeltery' },
  { out: { item: 'shadowglassBar', count: 1 }, in: [{ item: 'shadowglassOre', count: 6 }], station: 'smeltery' },
  { out: { item: 'starsteelBar', count: 1 }, in: [{ item: 'starsteelOre', count: 7 }], station: 'smeltery' },
  { out: { item: 'cupriteBar', count: 1 }, in: [{ item: 'cupriteOre', count: 3 }], station: 'smeltery' },
  { out: { item: 'ironveinBar', count: 1 }, in: [{ item: 'ironveinOre', count: 4 }], station: 'smeltery' },
  { out: { item: 'glimmerBar', count: 1 }, in: [{ item: 'glimmerOre', count: 5 }], station: 'smeltery' },
  { out: { item: 'aetheriteBar', count: 1 }, in: [{ item: 'aetheriteOre', count: 5 }], station: 'smeltery' },
  { out: { item: 'glacieriteBar', count: 1 }, in: [{ item: 'glacieriteOre', count: 4 }], station: 'smeltery' },
  { out: { item: 'blightBar', count: 1 }, in: [{ item: 'blightoreOre', count: 6 }, { item: 'blightstone', count: 2 }], station: 'smeltery', requiresBoss: 'gravemaw' },
  { out: { item: 'forge', count: 1 }, in: [{ item: 'stone', count: 10 }, { item: 'cupriteBar', count: 4 }], station: 'smeltery' },
  { out: { item: 'forge', count: 1 }, in: [{ item: 'stone', count: 16 }, { item: 'stoneironBar', count: 4 }], station: 'smeltery' },

  // --- Forge: metal gear ---
  { out: { item: 'stoneironPick', count: 1 }, in: [{ item: 'stoneironBar', count: 8 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'amberPick', count: 1 }, in: [{ item: 'amberBar', count: 10 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'tidePick', count: 1 }, in: [{ item: 'tideBar', count: 12 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'emberPick', count: 1 }, in: [{ item: 'emberBar', count: 14 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'verdantPick', count: 1 }, in: [{ item: 'verdantBar', count: 16 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'stormPick', count: 1 }, in: [{ item: 'stormBar', count: 18 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'shadowglassPick', count: 1 }, in: [{ item: 'shadowglassBar', count: 20 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'starsteelPick', count: 1 }, in: [{ item: 'starsteelBar', count: 22 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'amberBow', count: 1 }, in: [{ item: 'amberBar', count: 10 }, { item: 'wood', count: 6 }, { item: 'fiber', count: 4 }], station: 'forge' },
  { out: { item: 'tideTrident', count: 1 }, in: [{ item: 'tideBar', count: 14 }, { item: 'wood', count: 4 }], station: 'forge' },
  { out: { item: 'emberblade', count: 1 }, in: [{ item: 'emberBar', count: 16 }, { item: 'emberDust', count: 4 }], station: 'forge' },
  { out: { item: 'stormcaller', count: 1 }, in: [{ item: 'stormBar', count: 18 }, { item: 'emberDust', count: 6 }, { item: 'stone', count: 8 }], station: 'forge' },
  { out: { item: 'stoneironBroadsword', count: 1 }, in: [{ item: 'stoneironBar', count: 8 }, { item: 'wood', count: 3 }], station: 'forge' },
  { out: { item: 'verdantVineblade', count: 1 }, in: [{ item: 'verdantBar', count: 10 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'shadowglassScythe', count: 1 }, in: [{ item: 'shadowglassBar', count: 14 }, { item: 'wood', count: 4 }], station: 'forge' },
  { out: { item: 'tideWand', count: 1 }, in: [{ item: 'tideBar', count: 8 }, { item: 'wood', count: 4 }, { item: 'fiber', count: 3 }], station: 'forge' },
  { out: { item: 'verdantBloomStaff', count: 1 }, in: [{ item: 'verdantBar', count: 12 }, { item: 'fiber', count: 8 }], station: 'forge' },
  { out: { item: 'shadowglassOrb', count: 1 }, in: [{ item: 'shadowglassBar', count: 14 }, { item: 'stone', count: 6 }], station: 'forge' },
  { out: { item: 'tideSpriteStaff', count: 1 }, in: [{ item: 'tideBar', count: 8 }, { item: 'fiber', count: 5 }], station: 'forge' },
  { out: { item: 'verdantSproutIdol', count: 1 }, in: [{ item: 'verdantBar', count: 10 }, { item: 'fiber', count: 10 }], station: 'forge' },
  { out: { item: 'shadowmothTome', count: 1 }, in: [{ item: 'shadowglassBar', count: 12 }, { item: 'emberDust', count: 4 }], station: 'forge' },
  // The first boss is deliberately reached after the eight-ore climb. Its
  // beacon uses the final alloy but does not revive any retired boss material.
  { out: { item: 'mechBeacon', count: 1 }, in: [{ item: 'starsteelBar', count: 5 }, { item: 'stormBar', count: 4 }, { item: 'emberDust', count: 6 }], station: 'forge' },
  // The second boss is a post-Mech cavern fight. A guaranteed Mech Core means
  // the first clear always opens the path, while repeat summons still ask the
  // player to earn another core instead of making the lure an infinite freebie.
  { out: { item: 'wormLure', count: 1 }, in: [{ item: 'mechCore', count: 1 }, { item: 'shadowglassBar', count: 6 }, { item: 'emberDust', count: 8 }], station: 'forge', requiresBoss: 'theMech' },
  { out: { item: 'cupritePick', count: 1 }, in: [{ item: 'cupriteBar', count: 8 }], station: 'forge' },
  { out: { item: 'cupriteAxe', count: 1 }, in: [{ item: 'cupriteBar', count: 7 }, { item: 'wood', count: 2 }], station: 'forge' },
  { out: { item: 'cupriteSword', count: 1 }, in: [{ item: 'cupriteBar', count: 8 }], station: 'forge' },
  { out: { item: 'thornspikeSpear', count: 1 }, in: [{ item: 'cupriteBar', count: 6 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'cupriteRepeater', count: 1 }, in: [{ item: 'cupriteBar', count: 10 }, { item: 'wood', count: 2 }], station: 'forge' },
  { out: { item: 'bolt', count: 50 }, in: [{ item: 'cupriteBar', count: 1 }], station: 'forge' },
  { out: { item: 'aetherAltar', count: 1 }, in: [{ item: 'stone', count: 12 }, { item: 'glimmerBar', count: 4 }], station: 'forge' },
  { out: { item: 'ironveinPick', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }], station: 'forge' },
  { out: { item: 'ironveinAxe', count: 1 }, in: [{ item: 'ironveinBar', count: 10 }, { item: 'wood', count: 2 }], station: 'forge' },
  { out: { item: 'ironveinSaber', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }], station: 'forge' },
  { out: { item: 'ironveinHelm', count: 1 }, in: [{ item: 'ironveinBar', count: 10 }], station: 'forge' },
  { out: { item: 'ironveinPlate', count: 1 }, in: [{ item: 'ironveinBar', count: 16 }], station: 'forge' },
  { out: { item: 'ironveinGreaves', count: 1 }, in: [{ item: 'ironveinBar', count: 14 }], station: 'forge' },
  { out: { item: 'huntersCowl', count: 1 }, in: [{ item: 'ironveinBar', count: 8 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'huntersGarb', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }, { item: 'fiber', count: 8 }], station: 'forge' },
  { out: { item: 'huntersBoots', count: 1 }, in: [{ item: 'ironveinBar', count: 10 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'huntersLongbow', count: 1 }, in: [{ item: 'ironveinBar', count: 10 }, { item: 'wood', count: 4 }], station: 'forge' },
  { out: { item: 'boltflinger', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }], station: 'forge' },
  { out: { item: 'emberlockMusket', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }, { item: 'emberDust', count: 4 }], station: 'forge' },
  { out: { item: 'emberaxe', count: 1 }, in: [{ item: 'ironveinBar', count: 12 }, { item: 'emberDust', count: 3 }], station: 'forge' },
  { out: { item: 'shot', count: 60 }, in: [{ item: 'ironveinBar', count: 1 }], station: 'forge' },
  { out: { item: 'glimmerPick', count: 1 }, in: [{ item: 'glimmerBar', count: 15 }], station: 'forge' },
  { out: { item: 'glimmerGlaive', count: 1 }, in: [{ item: 'glimmerBar', count: 14 }], station: 'forge' },
  { out: { item: 'glimmerRifle', count: 1 }, in: [{ item: 'glimmerBar', count: 14 }, { item: 'aetheriteBar', count: 5 }], station: 'forge' },
  { out: { item: 'stormpiercer', count: 1 }, in: [{ item: 'glimmerBar', count: 12 }, { item: 'aetheriteBar', count: 6 }], station: 'forge' },
  // endgame melee (also boss loot)
  { out: { item: 'aetheredgeGreatblade', count: 1 }, in: [{ item: 'blightBar', count: 15 }, { item: 'aetheriteBar', count: 8 }, { item: 'sovereignCore', count: 1 }], station: 'forge', requiresBoss: 'blightSovereign' },
  // Blight armor (revealed after Gravemaw so the tier is reachable)
  { out: { item: 'blightHelm', count: 1 }, in: [{ item: 'blightBar', count: 8 }], station: 'forge', requiresBoss: 'gravemaw' },
  { out: { item: 'blightCuirass', count: 1 }, in: [{ item: 'blightBar', count: 12 }], station: 'forge', requiresBoss: 'gravemaw' },
  { out: { item: 'blightGreaves', count: 1 }, in: [{ item: 'blightBar', count: 10 }], station: 'forge', requiresBoss: 'gravemaw' },

  // --- Altar: mage & summon gear, mid/late boss idols ---
  { out: { item: 'frostshardStaff', count: 1 }, in: [{ item: 'cupriteBar', count: 6 }, { item: 'aetherShard', count: 1 }], station: 'altar' },
  { out: { item: 'venomWand', count: 1 }, in: [{ item: 'cupriteBar', count: 6 }, { item: 'fiber', count: 6 }], station: 'altar' },
  { out: { item: 'aetherboltStaff', count: 1 }, in: [{ item: 'aetheriteBar', count: 8 }], station: 'altar' },
  { out: { item: 'thunderRod', count: 1 }, in: [{ item: 'aetheriteBar', count: 10 }, { item: 'glimmerBar', count: 4 }], station: 'altar' },
  { out: { item: 'prismScepter', count: 1 }, in: [{ item: 'aetheriteBar', count: 10 }, { item: 'aetherShard', count: 2 }], station: 'altar' },
  { out: { item: 'voidlance', count: 1 }, in: [{ item: 'blightBar', count: 12 }, { item: 'sovereignCore', count: 1 }], station: 'altar', requiresBoss: 'blightSovereign' },
  { out: { item: 'aetherweaveHat', count: 1 }, in: [{ item: 'aetheriteBar', count: 8 }], station: 'altar' },
  { out: { item: 'aetherweaveRobe', count: 1 }, in: [{ item: 'aetheriteBar', count: 12 }], station: 'altar' },
  { out: { item: 'aetherweavePants', count: 1 }, in: [{ item: 'aetheriteBar', count: 10 }], station: 'altar' },
  { out: { item: 'thornweaveMask', count: 1 }, in: [{ item: 'fiber', count: 12 }, { item: 'cupriteBar', count: 4 }], station: 'altar' },
  { out: { item: 'thornweaveMantle', count: 1 }, in: [{ item: 'fiber', count: 16 }, { item: 'cupriteBar', count: 6 }], station: 'altar' },
  { out: { item: 'thornweaveGuards', count: 1 }, in: [{ item: 'fiber', count: 14 }, { item: 'cupriteBar', count: 5 }], station: 'altar' },
  { out: { item: 'beetleSigil', count: 1 }, in: [{ item: 'cupriteBar', count: 6 }, { item: 'fiber', count: 4 }], station: 'altar' },
  { out: { item: 'ravenTotem', count: 1 }, in: [{ item: 'ironveinBar', count: 8 }], station: 'altar' },
  { out: { item: 'emberlingStaff', count: 1 }, in: [{ item: 'ironveinBar', count: 8 }, { item: 'emberDust', count: 4 }], station: 'altar' },
  { out: { item: 'thornguardIdol', count: 1 }, in: [{ item: 'ironveinBar', count: 10 }, { item: 'fiber', count: 6 }], station: 'altar' },
  { out: { item: 'wraithBell', count: 1 }, in: [{ item: 'glimmerBar', count: 10 }, { item: 'aetherShard', count: 3 }], station: 'altar' },
  { out: { item: 'aetherTonic', count: 2 }, in: [{ item: 'aetherShard', count: 1 }], station: 'altar' },
  // accessories
  { out: { item: 'swiftboots', count: 1 }, in: [{ item: 'cupriteBar', count: 5 }, { item: 'fiber', count: 6 }], station: 'forge' },
  { out: { item: 'vitalBand', count: 1 }, in: [{ item: 'cupriteBar', count: 6 }, { item: 'healLesser', count: 2 }], station: 'forge' },
  { out: { item: 'ironhideEmblem', count: 1 }, in: [{ item: 'ironveinBar', count: 8 }], station: 'forge' },
  { out: { item: 'aetherLocket', count: 1 }, in: [{ item: 'aetheriteBar', count: 4 }, { item: 'aetherShard', count: 2 }], station: 'altar' },
  { out: { item: 'beastmasterSigil', count: 1 }, in: [{ item: 'glimmerBar', count: 4 }, { item: 'aetherShard', count: 2 }], station: 'altar' },
  { out: { item: 'cloudstepCharm', count: 1 }, in: [{ item: 'glimmerBar', count: 6 }, { item: 'aetherShard', count: 3 }], station: 'altar' },
  // potions
  { out: { item: 'healGreater', count: 2 }, in: [{ item: 'healLesser', count: 2 }, { item: 'glimmerBar', count: 1 }], station: 'altar' },
  { out: { item: 'vigorBrew', count: 1 }, in: [{ item: 'fiber', count: 6 }, { item: 'clay', count: 2 }], station: 'altar' },
  { out: { item: 'ironskinTonic', count: 1 }, in: [{ item: 'ironveinBar', count: 2 }, { item: 'clay', count: 2 }], station: 'altar' },
  { out: { item: 'swiftElixir', count: 1 }, in: [{ item: 'fiber', count: 6 }, { item: 'aetherShard', count: 1 }], station: 'altar' },
  // boss idols (progression gates)
  { out: { item: 'boneSigil', count: 1 }, in: [{ item: 'groveHeart', count: 1 }, { item: 'stone', count: 10 }, { item: 'cupriteBar', count: 6 }], station: 'altar', requiresBoss: 'grovekeeper' },
  { out: { item: 'blightIdol', count: 1 }, in: [{ item: 'marrow', count: 1 }, { item: 'blightoreOre', count: 8 }, { item: 'blightBar', count: 4 }], station: 'altar', requiresBoss: 'gravemaw' },
];

// Only recipes reachable in the starter, active pre-Hardmode, and active boss
// progression remain. Explicitly listing the live gates keeps retired boss
// recipes out even though the crafting system supports progression locks.
const ACTIVE_BOSS_RECIPE_GATES = new Set(['theMech', 'theWorm']);
export const RECIPES = ALL_RECIPES.filter((r) =>
  (!r.requiresBoss || ACTIVE_BOSS_RECIPE_GATES.has(r.requiresBoss)) &&
  isItemEnabled(r.out.item) && r.in.every(i => isItemEnabled(i.item))
);

// Give every retained recipe a stable id.
RECIPES.forEach((r, i) => { r.id = 'r' + i + '_' + r.out.item; });
