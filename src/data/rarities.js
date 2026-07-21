// Rarity definitions for outfield players and goalkeepers, plus special card overlays.
// Each rarity carries an OVR band, pack weight, and a visual theme used by card rendering
// and the pack-opening sequence.

// tier: numeric quality ladder shared across outfield + GK so packs can roll a tier then
// map it to the correct label for the player's role.

export const OUTFIELD_RARITIES = {
  common:     { id: 'common',     name: 'Common',     tier: 0, ovr: [54, 67], weight: 1000, theme: 'steel' },
  rare:       { id: 'rare',       name: 'Rare',       tier: 1, ovr: [63, 75], weight: 420,  theme: 'emerald' },
  epic:       { id: 'epic',       name: 'Epic',       tier: 2, ovr: [72, 83], weight: 150,  theme: 'violet' },
  legendary:  { id: 'legendary',  name: 'Legendary',  tier: 3, ovr: [81, 88], weight: 42,   theme: 'gold' },
  mythic:     { id: 'mythic',     name: 'Mythic',     tier: 4, ovr: [86, 92], weight: 12,   theme: 'crimson' },
  superhuman: { id: 'superhuman', name: 'Superhuman', tier: 5, ovr: [90, 97], weight: 3,    theme: 'aurora' },
};

export const GK_RARITIES = {
  common:       { id: 'common',       name: 'Common',            tier: 0, ovr: [54, 67], weight: 1000, theme: 'steel' },
  rare:         { id: 'rare',         name: 'Rare',              tier: 1, ovr: [63, 75], weight: 420,  theme: 'emerald' },
  epic:         { id: 'epic',         name: 'Epic',              tier: 2, ovr: [72, 83], weight: 150,  theme: 'violet' },
  supersight:   { id: 'supersight',   name: 'SuperSight',        tier: 3, ovr: [81, 88], weight: 42,   theme: 'teal' },
  extremereflex:{ id: 'extremereflex',name: 'Extreme Reflex',    tier: 4, ovr: [86, 92], weight: 12,   theme: 'ember' },
  catlike:      { id: 'catlike',      name: 'Cat-Like Reflexes', tier: 5, ovr: [90, 97], weight: 3,    theme: 'jade' },
};

// tier -> rarity id, per role. Used when a pack rolls a numeric tier.
export const TIER_TO_OUTFIELD = ['common', 'rare', 'epic', 'legendary', 'mythic', 'superhuman'];
export const TIER_TO_GK = ['common', 'rare', 'epic', 'supersight', 'extremereflex', 'catlike'];

export function rarityFor(isGK, id) {
  return (isGK ? GK_RARITIES : OUTFIELD_RARITIES)[id];
}

// Special card overlays. These sit on top of a rarity (not replace it) and add an OVR boost
// plus a distinct foil treatment. `weight` is the relative chance among special cards; a
// player only receives a special card when a pack "special roll" succeeds.
export const SPECIAL_CARDS = {
  prime:          { id: 'prime',          name: 'Prime',            boost: 2, weight: 100, theme: 'prime',    abbr: 'PRIME' },
  worldcupwinner: { id: 'worldcupwinner', name: 'World Cup Winner', boost: 3, weight: 55,  theme: 'wcw',      abbr: 'WCW' },
  icon:           { id: 'icon',           name: 'Icon',             boost: 4, weight: 40,  theme: 'icon',     abbr: 'ICON' },
  goat:           { id: 'goat',           name: 'GOAT',             boost: 6, weight: 10,  theme: 'goat',     abbr: 'GOAT' },
  primeicon:      { id: 'primeicon',      name: 'Prime Icon',       boost: 7, weight: 6,   theme: 'primeicon',abbr: 'P·ICON' },
};

export function specialCard(id) {
  return id ? SPECIAL_CARDS[id] : null;
}

// Visual themes: gradient stops + accent + glow, consumed by CSS-var driven card rendering.
export const THEMES = {
  steel:     { grad: ['#5b6472', '#2d333f'], accent: '#c8d0dc', glow: 'rgba(160,175,195,.5)', text: '#eef2f7' },
  emerald:   { grad: ['#1f8a5b', '#0c3b28'], accent: '#7bffb0', glow: 'rgba(60,220,150,.55)', text: '#eafff4' },
  violet:    { grad: ['#7b3fe4', '#2a1258'], accent: '#c9a6ff', glow: 'rgba(160,110,255,.6)', text: '#f4eeff' },
  gold:      { grad: ['#e8b743', '#7a5410'], accent: '#ffe9a8', glow: 'rgba(255,210,90,.7)',  text: '#2a1e05' },
  crimson:   { grad: ['#e0344d', '#5c0f1c'], accent: '#ffb0be', glow: 'rgba(255,70,110,.72)', text: '#fff2f4' },
  aurora:    { grad: ['#33d6e8', '#7b3fe4'], accent: '#c8fff6', glow: 'rgba(120,240,255,.8)', text: '#f2fdff', foil: true },
  teal:      { grad: ['#12b6b0', '#0a4b52'], accent: '#a6fff4', glow: 'rgba(60,230,220,.6)',  text: '#eafffb' },
  ember:     { grad: ['#f0663a', '#7a2410'], accent: '#ffc7a6', glow: 'rgba(255,120,60,.7)',  text: '#fff3ec' },
  jade:      { grad: ['#20c07a', '#0a5236'], accent: '#b8ffd8', glow: 'rgba(60,230,150,.75)', text: '#eafff4', foil: true },
  // special foils
  prime:     { grad: ['#d7dde6', '#8a94a6'], accent: '#ffffff', glow: 'rgba(220,230,245,.85)',text: '#20242e', foil: true },
  wcw:       { grad: ['#f4d06a', '#b5871f'], accent: '#fff5cf', glow: 'rgba(255,220,120,.85)',text: '#2a1e05', foil: true },
  icon:      { grad: ['#efe6c9', '#b9a15e'], accent: '#fffbe9', glow: 'rgba(255,244,200,.9)', text: '#2a2410', foil: true },
  goat:      { grad: ['#f5c542', '#141414'], accent: '#ffe07a', glow: 'rgba(255,205,70,.9)',  text: '#fff3cf', foil: true },
  primeicon: { grad: ['#ffffff', '#c9a94a'], accent: '#fff7d6', glow: 'rgba(255,240,190,.95)',text: '#2a2410', foil: true },
};

export const themeFor = (name) => THEMES[name] || THEMES.steel;
