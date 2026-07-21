// Playstyles (one per player) and traits (several per player). Both are surfaced on the
// player card / advanced page AND read by the match AI to bias decisions, so two players
// with the same OVR behave differently.

// Each playstyle lists the position groups it can apply to and behaviour biases the sim reads.
// Bias keys: shoot, pass, dribble, cross, press, hold, run, longshot, aerial, tackle.
export const PLAYSTYLES = {
  poacher:        { name: 'Poacher',              groups: ['ST'],            bias: { shoot: 1.3, run: 1.25, longshot: 0.8 } },
  targetman:      { name: 'Target Man',           groups: ['ST'],            bias: { aerial: 1.4, hold: 1.3, shoot: 1.1, run: 0.8 } },
  advforward:     { name: 'Advanced Forward',     groups: ['ST', 'W'],       bias: { shoot: 1.2, dribble: 1.15, run: 1.2 } },
  falsenine:      { name: 'False Nine',           groups: ['ST', 'AM'],      bias: { pass: 1.25, dribble: 1.15, hold: 1.1 } },
  insideforward:  { name: 'Inside Forward',       groups: ['W'],             bias: { dribble: 1.25, shoot: 1.15, run: 1.15 } },
  winger:         { name: 'Winger',               groups: ['W'],             bias: { cross: 1.35, dribble: 1.2, run: 1.2 } },
  playmaker:      { name: 'Playmaker',            groups: ['AM', 'CM'],      bias: { pass: 1.35, dribble: 1.15, longshot: 1.1 } },
  deeplying:      { name: 'Deep-Lying Playmaker', groups: ['CM', 'DM'],      bias: { pass: 1.3, hold: 1.15, tackle: 1.05 } },
  boxtobox:       { name: 'Box-to-Box',           groups: ['CM'],            bias: { run: 1.2, press: 1.15, tackle: 1.1, shoot: 1.05 } },
  ballwinner:     { name: 'Ball-Winning Mid',     groups: ['DM', 'CM'],      bias: { tackle: 1.35, press: 1.3, pass: 0.95 } },
  regista:        { name: 'Regista',              groups: ['DM'],            bias: { pass: 1.3, longshot: 1.1, hold: 1.1 } },
  wingback:       { name: 'Wing Back',            groups: ['FB'],            bias: { run: 1.25, cross: 1.25, press: 1.1 } },
  fullback:       { name: 'Full-Back',            groups: ['FB'],            bias: { tackle: 1.15, press: 1.1, cross: 1.05 } },
  ballplaying:    { name: 'Ball-Playing Defender',groups: ['CB'],            bias: { pass: 1.25, tackle: 1.1, hold: 1.1 } },
  stopper:        { name: 'No-Nonsense Defender', groups: ['CB'],            bias: { tackle: 1.3, aerial: 1.25, press: 1.1, pass: 0.85 } },
  sweeper:        { name: 'Sweeper',              groups: ['CB'],            bias: { tackle: 1.2, press: 1.05, pass: 1.1 } },
  sweeperkeeper:  { name: 'Sweeper Keeper',       groups: ['GK'],            bias: { pass: 1.3, run: 1.2 } },
  shotstopper:    { name: 'Shot Stopper',         groups: ['GK'],            bias: { tackle: 1.2 } },
};

// Traits are cosmetic + light sim modifiers. Each maps to a small bias tweak.
export const TRAITS = {
  finesse:       { name: 'Finesse Shot',            bias: { shoot: 1.08 } },
  longshot:      { name: 'Long Shot Taker',         bias: { longshot: 1.35 } },
  powerheader:   { name: 'Power Header',            bias: { aerial: 1.2 } },
  speeddribbler: { name: 'Speed Dribbler',          bias: { dribble: 1.2, run: 1.05 } },
  flair:         { name: 'Flair',                   bias: { dribble: 1.12 } },
  clinical:      { name: 'Clinical Finisher',       bias: { shoot: 1.15 } },
  visionary:     { name: 'Visionary',               bias: { pass: 1.15 } },
  rapid:         { name: 'Rapid',                   bias: { run: 1.12 } },
  engine:        { name: 'Engine',                  bias: {} },
  leadership:    { name: 'Leadership',              bias: {} },
  aerialthreat:  { name: 'Aerial Threat',           bias: { aerial: 1.18 } },
  interceptor:   { name: 'Interceptor',             bias: { press: 1.12, tackle: 1.08 } },
  solidtackle:   { name: 'Solid Tackle',            bias: { tackle: 1.15 } },
  setpiece:      { name: 'Set-Piece Specialist',    bias: {} },
  composed:      { name: 'Composed',                bias: { shoot: 1.05, pass: 1.05 } },
  trickster:     { name: 'Trickster',               bias: { dribble: 1.15 } },
  workhorse:     { name: 'Workhorse',               bias: { press: 1.15 } },
  wall:          { name: 'Wall',                    bias: { tackle: 1.1 } },
  playmakerT:    { name: 'Playmaker',               bias: { pass: 1.12 } },
  outsidefoot:   { name: 'Outside Foot',            bias: { cross: 1.1 } },
};

export const playstyle = (id) => PLAYSTYLES[id];
export const trait = (id) => TRAITS[id];

/** Combine playstyle + traits into one bias multiplier map read by the AI. */
export function combinedBias(player) {
  const out = {};
  const add = (bias) => {
    if (!bias) return;
    for (const [k, v] of Object.entries(bias)) out[k] = (out[k] || 1) * v;
  };
  add(PLAYSTYLES[player.playstyle]?.bias);
  (player.traits || []).forEach((t) => add(TRAITS[t]?.bias));
  return out;
}
