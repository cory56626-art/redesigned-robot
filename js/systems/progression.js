// Summoner Realms — progression: defeated bosses + unlocked recipes.
export class Progression {
  constructor() {
    this.defeatedBosses = new Set();
    this.unlockedRecipes = new Set();
    this.hardmodeUnlocked = false;
  }
  defeatBoss(key) {
    this.defeatedBosses.add(key);
    if (key === 'theMech') this.hardmodeUnlocked = true;
  }
  isDefeated(key) { return this.defeatedBosses.has(key); }
  recipeAvailable(recipe) {
    if (recipe.requiresBoss && !this.defeatedBosses.has(recipe.requiresBoss)) return false;
    this.unlockedRecipes.add(recipe.id);
    return true;
  }
  serialize() { return { defeated: [...this.defeatedBosses], recipes: [...this.unlockedRecipes], hardmodeUnlocked: this.hardmodeUnlocked }; }
  deserialize(d) {
    if (!d) return;
    this.defeatedBosses = new Set(d.defeated || []);
    this.unlockedRecipes = new Set(d.recipes || []);
    this.hardmodeUnlocked = !!d.hardmodeUnlocked || this.defeatedBosses.has('theMech');
  }
}
