// Fictional club names + colour palettes for AI opponents and player "club" fields.
// All names are invented to avoid referencing real organisations.

export const CLUBS = [
  { name: 'Ironforge United', short: 'IRO', colors: ['#c0392b', '#2c3e50'] },
  { name: 'Northgate City', short: 'NGC', colors: ['#2980b9', '#ecf0f1'] },
  { name: 'Vallecano Rovers', short: 'VAL', colors: ['#8e44ad', '#f1c40f'] },
  { name: 'Riverside Athletic', short: 'RIV', colors: ['#16a085', '#0b1020'] },
  { name: 'Kingsbridge FC', short: 'KGB', colors: ['#e67e22', '#2c3e50'] },
  { name: 'Solaris Marseille', short: 'SOL', colors: ['#3498db', '#ffffff'] },
  { name: 'Real Montaña', short: 'RMT', colors: ['#ffffff', '#c0392b'] },
  { name: 'Bavaria Munich Sud', short: 'BMS', colors: ['#c0392b', '#ffffff'] },
  { name: 'Porto Azul', short: 'PAZ', colors: ['#2980b9', '#1a1a2e'] },
  { name: 'Amsterdam Lions', short: 'AML', colors: ['#e74c3c', '#ffffff'] },
  { name: 'Tokyo Sol', short: 'TKS', colors: ['#e84393', '#2d3436'] },
  { name: 'Cairo Pharaohs', short: 'CAP', colors: ['#d63031', '#fdcb6e'] },
  { name: 'Buenos Fuego', short: 'BFG', colors: ['#0984e3', '#dfe6e9'] },
  { name: 'Rio Verde', short: 'RIO', colors: ['#00b894', '#fdcb6e'] },
  { name: 'Lisbon Corsairs', short: 'LIS', colors: ['#00cec9', '#2d3436'] },
  { name: 'Manchester Vale', short: 'MNV', colors: ['#0984e3', '#ffffff'] },
  { name: 'Highbury Rangers', short: 'HBR', colors: ['#d63031', '#2d3436'] },
  { name: 'Turin Nero', short: 'TRN', colors: ['#2d3436', '#ffffff'] },
  { name: 'Sevilla Roja', short: 'SVR', colors: ['#c0392b', '#f39c12'] },
  { name: 'Dortmund Yellow', short: 'DTY', colors: ['#f1c40f', '#2d3436'] },
  { name: 'Nordic Frost', short: 'NRF', colors: ['#74b9ff', '#0b1020'] },
  { name: 'Andes Cóndores', short: 'AND', colors: ['#e17055', '#2d3436'] },
  { name: 'Casablanca Star', short: 'CBS', colors: ['#00b894', '#c0392b'] },
  { name: 'Seoul Tigers', short: 'SLT', colors: ['#e84118', '#2f3640'] },
  { name: 'Athens Olympians', short: 'ATH', colors: ['#0abde3', '#ffffff'] },
  { name: 'Prague Crown', short: 'PRC', colors: ['#8e44ad', '#dfe6e9'] },
  { name: 'Gdansk Anchors', short: 'GDA', colors: ['#c0392b', '#ecf0f1'] },
  { name: 'Bruges Canal', short: 'BRC', colors: ['#0984e3', '#2d3436'] },
  { name: 'Zagreb Checkers', short: 'ZGB', colors: ['#c0392b', '#2980b9'] },
  { name: 'Lagos Eagles', short: 'LGE', colors: ['#00b894', '#ffffff'] },
];

/** Deterministically pick N clubs for a division. */
export function pickClubs(rng, count) {
  const pool = rng.shuffle([...CLUBS]);
  return pool.slice(0, count).map((c) => ({ ...c }));
}

export const randomClub = (rng) => rng.pick(CLUBS).name;

/** Generate a stylised SVG badge for a club (data URI). */
export function clubBadge(colors, letter) {
  const [a, b] = colors;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>
    <stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs>
    <path d='M32 2 L58 12 V34 C58 50 46 58 32 62 C18 58 6 50 6 34 V12 Z' fill='url(#g)' stroke='#ffffff' stroke-width='2'/>
    <text x='32' y='42' font-family='Arial Black, sans-serif' font-size='26' font-weight='900' fill='#ffffff' text-anchor='middle'>${letter}</text>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
