// Summoner Realms — boss catalogue.
//
// Boss encounters are intentionally disabled for the pre-Hardmode build. The
// empty catalogue keeps imports and multiplayer snapshots compatible while
// making every summon, spawn, and boss loot path resolve to no content.
export const BOSSES = Object.freeze({});

export function bossDef(key) { return BOSSES[key]; }
export const BOSS_KEYS = Object.freeze([]);
