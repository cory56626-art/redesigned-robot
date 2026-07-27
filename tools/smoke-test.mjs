#!/usr/bin/env node
// Summoner Realms — end-to-end smoke test.
//
// Boots the real game in a headless browser and exercises each system through
// the *actual input path* — the mouse position and the primary button — rather
// than by calling internals. That distinction matters: the bugs this release
// fixed lived in the dispatch between an input and an action, and a test that
// calls the action directly would have passed against the broken build.
//
// Requires a static server on port 8899 and Playwright:
//
//   npx http-server -p 8899 -c-1 --silent .
//   node tools/smoke-test.mjs
//
// Exits non-zero on any failed assertion or uncaught page error. Missing
// optional music assets (see assets/music/README.md) are ignored.

// Boot the real game in a browser and exercise the 4.1 systems through the
// actual input path, so the test covers what a player's click covers.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Playwright may be installed globally in CI images; fall back to that.
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js')); }

const BASE = process.env.SMOKE_URL || 'http://localhost:8899';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], missing = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('response', r => { if (r.status() === 404) missing.push(r.url()); });

await page.goto(BASE + '/index.html');
await page.waitForFunction(() => window.__game && window.__game.ui && window.__game.ui.hud, null, { timeout: 15000 });

const res = await page.evaluate(async () => {
  const g = window.__game;
  const out = {};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Aim by moving the *mouse*, not by writing state.aimX/aimY: resolveAim()
  // recomputes those from the pointer at the top of every fixed step, so
  // writing them directly is overwritten before any action ever sees them.
  const aimAt = (wx, wy) => {
    const s = g.camera.worldToScreen(wx, wy, g.canvas.width, g.canvas.height);
    g.input.mouseScreen.x = s.x; g.input.mouseScreen.y = s.y;
  };
  // Press and hold the primary button for a few real frames, queueing the press
  // edge the way the mouse handler does.
  const press = async (wx, wy, ms = 150) => {
    aimAt(wx, wy);
    g.input.state.primaryHeld = true;
    g.input._queuePrimary();
    await sleep(ms);
    g.input.state.primaryHeld = false;
    await sleep(50);
  };

  g.startNewWorld('Smoke', '12345');
  await sleep(500);
  const p = g.localPlayer;

  out.booted = !!g.world;
  out.waterTiles = (() => { let n = 0; const L = g.world.liquid.levels; for (let i = 0; i < L.length; i++) if (L[i]) n++; return n; })();
  out.weather = g.weather.label();

  const selectItem = (id, n) => {
    p.inventory.add(id, n || 1);
    const i = p.inventory.slots.findIndex(s => s && s.id === id);
    if (i >= 10) p.inventory.swap(i, 0);
    p.inventory.selected = i >= 10 ? 0 : i;
  };

  // --- Block placement through a real click ---
  selectItem('dirt', 20);
  const tx = Math.floor(p.x / 16) + 2, ty = Math.floor((p.y + p.h) / 16) - 1;
  g.world.set(tx, ty, 0);
  await press(tx * 16 + 8, ty * 16 + 8, 250);
  out.placedTile = g.world.get(tx, ty);
  out.placeWorked = out.placedTile !== 0;

  // --- Hammer reshapes the block just placed ---
  selectItem('woodHammer', 1);
  await press(tx * 16 + 8, ty * 16 + 8, 250);
  out.shapeAfterHammer = g.world.getShape(tx, ty);
  out.hammerWorked = out.shapeAfterHammer !== 0;

  // --- Melee cannot reach through rock ---
  const e = g.spawnEnemy('husk', p.x + 34, p.y);
  // Wall the enemy off completely.
  const wx = Math.floor((p.x + 20) / 16);
  for (let dy = -3; dy <= 3; dy++) g.world.set(wx, Math.floor(p.y / 16) + dy, 3);
  const hpBefore = e.hp;
  selectItem('rustedShortblade', 1);
  for (let i = 0; i < 6; i++) await press(e.x + e.w / 2, e.y + e.h / 2, 120);
  out.blockedByWall = e.hp === hpBefore;
  for (let dy = -3; dy <= 3; dy++) g.world.set(wx, Math.floor(p.y / 16) + dy, 0);
  for (let i = 0; i < 6; i++) await press(e.x + e.w / 2, e.y + e.h / 2, 120);
  out.hitsWithoutWall = e.dead || e.hp < hpBefore;

  // --- Drops ---
  selectItem('stone', 30);
  const si = p.inventory.slots.findIndex(s => s && s.id === 'stone');
  const before = g.drops.length;
  g.dropInventoryItem(si, Infinity);
  const d = g.drops[g.drops.length - 1];
  out.dropSpawned = g.drops.length > before;
  out.dropCount = d && d.count;
  out.dropImmune = d && !d.canBePickedUpBy(p);
  await sleep(400);
  out.stillOnGround = g.drops.includes(d);

  // --- Fishing at real water ---
  const L = g.world.liquid;
  let fx = -1, fy = -1;
  outer: for (let y = 60; y < 250; y++) for (let x = 5; x < 690; x++) {
    if (L.get(x, y) > 0 && L.get(x, y - 1) === 0 && L.poolSize(x, y, 30) > 12) { fx = x; fy = y; break outer; }
  }
  out.foundWater = fx >= 0;
  if (fx >= 0) {
    p.x = (fx - 2) * 16; p.y = (fy - 3) * 16; p.vx = 0; p.vy = 0;
    await sleep(120);
    selectItem('worm', 5);
    selectItem('woodRod', 1);
    await press(fx * 16 + 8, fy * 16 + 8, 200);
    out.castStarted = !!p.fishing;
    if (p.fishing) {
      p.fishing.timer = 0;
      await sleep(150);
      out.biting = !!(p.fishing && p.fishing.biting);
      const fishBefore = p.inventory.count('rawFish');
      await press(fx * 16 + 8, fy * 16 + 8, 200);
      out.landed = !p.fishing;
    }
  }

  // --- Wildlife ---
  g.spawnCritter('rabbit', p.x + 70, p.y - 20);
  g.spawnCritter('cricket', p.x + 40, p.y - 20);
  await sleep(500);
  out.critters = g.critters.length;
  const bug = g.critters.find(c => c.kind === 'bug');
  out.caughtBug = bug ? g.catchBugAt(bug.x + bug.w / 2, bug.y + bug.h / 2) : 'no bug';

  // --- Water actually flows when you dig into it ---
  if (fx >= 0) {
    const lvlBefore = L.get(fx, fy);
    for (let dy = 1; dy < 6; dy++) g.world.set(fx, fy + dy, 0);
    // Dig the floor out from under the pool.
    let floor = fy + 1;
    while (floor < fy + 20 && !g.world.isSolidAt(fx, floor)) floor++;
    g.world.set(fx, floor, 0);
    await sleep(900);
    out.waterFlowed = L.get(fx, fy) !== lvlBefore || L.get(fx, floor) > 0;
  }

  await sleep(800);
  out.stillRunning = g.state === 'playing' && !!g.world;
  return out;
});

await browser.close();
console.log(JSON.stringify(res, null, 2));

// Each entry is an invariant this release is responsible for. Naming them
// individually means a failure says which feature broke, not just "smoke failed".
const ASSERTIONS = [
  ['world boots', res.booted],
  ['water generates', res.waterTiles > 200],
  ['blocks can be placed', res.placeWorked],
  ['hammer reshapes blocks', res.hammerWorked],
  ['melee is stopped by rock', res.blockedByWall],
  ['melee connects without rock', res.hitsWithoutWall],
  ['a whole stack can be dropped', res.dropSpawned && res.dropCount === 30],
  ['a dropped stack is not re-collected', res.dropImmune && res.stillOnGround],
  ['fishing finds water', res.foundWater],
  ['a cast starts', res.castStarted],
  ['a fish bites', res.biting],
  ['a catch lands', res.landed],
  ['wildlife spawns', res.critters > 0],
  ['bugs are catchable', res.caughtBug === true],
  ['water flows when drained', res.waterFlowed],
  ['the game is still running', res.stillRunning],
];
const failed = ASSERTIONS.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error('\n\u2717 failed:');
  for (const f of failed) console.error('  ' + f);
  process.exit(1);
}
console.log('\n\u2713 ' + ASSERTIONS.length + ' smoke assertions hold');
if (missing.length) { console.log('\n404s:'); [...new Set(missing)].slice(0, 10).forEach(u => console.log('  ' + u)); }
const real = errors.filter(e => !/404/.test(e));
if (real.length) { console.error('\nCONSOLE ERRORS:'); real.slice(0, 20).forEach(e => console.error(' ', e)); process.exit(1); }
console.log('\nno console errors');
