// Summoner Realms — progression: defeated bosses + unlocked recipes.
export class Progression {
  constructor() {
    this.defeatedBosses = new Set();
    this.unlockedRecipes = new Set();
  }
  defeatBoss(key) { this.defeatedBosses.add(key); }
  isDefeated(key) { return this.defeatedBosses.has(key); }
  recipeAvailable(recipe) {
    if (recipe.requiresBoss && !this.defeatedBosses.has(recipe.requiresBoss)) return false;
    this.unlockedRecipes.add(recipe.id);
    return true;
  }
  serialize() { return { defeated: [...this.defeatedBosses], recipes: [...this.unlockedRecipes] }; }
  deserialize(d) {
    if (!d) return;
    this.defeatedBosses = new Set(d.defeated || []);
    this.unlockedRecipes = new Set(d.recipes || []);
  }
}
