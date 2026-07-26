// Summoner Realms — crafting logic.
import { TILE } from '../config.js?v=realms-qor-48';
import { RECIPES } from '../data/recipes.js?v=realms-qor-48';
import { tileDef } from '../world/tiles.js?v=realms-qor-48';
import { item as getItem } from '../data/items.js?v=realms-qor-48';

// Which crafting stations are within reach of the player? (null = by hand)
export function nearbyStations(game, player) {
  const set = new Set([null]);
  const pcx = Math.floor((player.x + player.w / 2) / TILE);
  const pcy = Math.floor((player.y + player.h / 2) / TILE);
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const def = tileDef(game.world.get(pcx + dx, pcy + dy));
      if (def.station) set.add(def.station);
    }
  }
  return set;
}

export function canCraft(inv, recipe) {
  for (const ing of recipe.in) if (inv.count(ing.item) < ing.count) return false;
  return true;
}

export function availableRecipes(game, player) {
  const stations = nearbyStations(game, player);
  const out = [];
  for (const r of RECIPES) {
    if (!stations.has(r.station)) continue;
    if (!game.progression.recipeAvailable(r)) continue;
    out.push({ recipe: r, craftable: canCraft(player.inventory, r) });
  }
  return out;
}

// Display names for the stations, so the UI never has to say "forge" in lower
// case in the middle of a sentence.
export const STATION_LABEL = {
  null: 'hand', bench: 'Crafting Bench', smeltery: 'Smeltery', forge: 'Forge', altar: 'Aether Altar',
};
export function stationLabel(station) { return STATION_LABEL[station] || STATION_LABEL[null]; }

// Every recipe the player could ever make, annotated with what is stopping it.
//
// `availableRecipes` above hides anything whose station is out of reach, which
// is 92 of 102 recipes when you are standing in the open — and it says nothing
// about why. That is what made the pickaxes look as though they had no recipe
// at all. This returns the whole catalogue instead and names the blocker, and
// the UI dims rather than hides.
//
//   state 'ready' — craft it now
//         'short' — station is in reach, materials are not
//         'away'  — the station itself is somewhere else
//
// Boss-locked recipes are still omitted: revealing them would spoil which boss
// gates which gear before you have met it.
export function catalogue(game, player) {
  const stations = nearbyStations(game, player); // one 11x11 scan for all 102
  const inv = player.inventory;
  const out = [];
  for (const recipe of RECIPES) {
    if (game.progression.isRecipeLocked(recipe)) continue;
    const hasStation = stations.has(recipe.station);
    // Resolve counts once here so the renderer does no inventory work per frame.
    const ingredients = recipe.in.map(ing => ({
      item: ing.item, need: ing.count, have: inv.count(ing.item),
    }));
    const missing = ingredients.filter(i => i.have < i.need);
    out.push({
      recipe,
      ingredients,
      missing,
      station: recipe.station,
      hasStation,
      state: !hasStation ? 'away' : (missing.length ? 'short' : 'ready'),
    });
  }
  return out;
}

// The single sentence a row shows about why it cannot be crafted. One blocker,
// not a list: the first thing standing in your way is the useful one.
export function blockerText(entry) {
  if (entry.state === 'ready') return null;
  if (entry.state === 'away') return 'Needs a ' + stationLabel(entry.station);
  const m = entry.missing[0];
  const short = m.need - m.have;
  const name = getItem(m.item).name;
  const more = entry.missing.length > 1 ? ` +${entry.missing.length - 1} more` : '';
  return `Missing ${short} ${name}${more}`;
}

export function craft(game, player, recipe) {
  const stations = nearbyStations(game, player);
  if (!stations.has(recipe.station)) { game.toast('No ' + (recipe.station || 'station') + ' nearby', 'bad'); return false; }
  if (!game.progression.recipeAvailable(recipe)) { game.toast('Recipe locked', 'bad'); return false; }
  if (!canCraft(player.inventory, recipe)) { game.toast('Missing materials', 'bad'); return false; }
  for (const ing of recipe.in) player.inventory.remove(ing.item, ing.count);
  const leftover = player.inventory.add(recipe.out.item, recipe.out.count);
  if (leftover > 0) game.spawnDrop(player.x, player.y, recipe.out.item, leftover);
  game.toast('Crafted ' + getItem(recipe.out.item).name, 'good');
  game.markDirty();
  return true;
}
