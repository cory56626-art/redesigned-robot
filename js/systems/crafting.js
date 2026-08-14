// Summoner Realms — crafting logic.
import { TILE } from '../config.js?v=tides-1';
import { RECIPES } from '../data/recipes.js?v=tides-1';
import { tileDef } from '../world/tiles.js?v=tides-1';
import { item as getItem } from '../data/items.js?v=tides-1';

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
