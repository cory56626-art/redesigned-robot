// Summoner Realms — progression: defeated bosses + unlocked recipes.
export class Progression {
  constructor() {
    this.defeatedBosses = new Set();
    this.unlockedRecipes = new Set();
  }
  defeatBoss(key) { this.defeatedBosses.add(key); }
  isDefeated(key) { return this.defeatedBosses.has(key); }
  // Read-only twin of recipeAvailable, for callers that only want to ask.
  // recipeAvailable records the unlock as a side effect, which makes it unsafe
  // to run over the whole recipe table just to render a list.
  isRecipeLocked(recipe) {
    return !!recipe.requiresBoss && !this.defeatedBosses.has(recipe.requiresBoss);
  }
  recipeAvailable(recipe) {
    if (this.isRecipeLocked(recipe)) return false;
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
