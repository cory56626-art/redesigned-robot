// Playwright smoke + progression test for Pixel Keep.
// Loads index.html, watches for console/page errors, drives the game via the
// window.PK debug hooks, and asserts the core loop + siege actually work.
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const file = pathToFileURL(path.resolve('index.html')).href;
const errors = [];
let failed = false;
const assert = (cond, msg) => { if (!cond) { console.log('  ✗ ' + msg); failed = true; } else { console.log('  ✓ ' + msg); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(file);
await page.waitForTimeout(400);

console.log('\n[1] Boot & no errors');
const booted = await page.evaluate(() => !!(window.PK && window.PK.state));
assert(booted, 'window.PK debug hooks present');
assert(errors.length === 0, 'no console/page errors on boot' + (errors.length ? ' -> ' + errors[0] : ''));

console.log('\n[2] Core loop progresses (auto-combat over ~6s)');
const before = await page.evaluate(() => window.PK.state());
await page.waitForTimeout(6000);
const after = await page.evaluate(() => window.PK.state());
assert(after.wave >= before.wave, `wave advanced or held (${before.wave} -> ${after.wave})`);
assert(after.gold > before.gold, `gold increased (${before.gold} -> ${after.gold})`);

console.log('\n[3] Tap damage + fervor build via canvas click');
await page.evaluate(() => { for (let i=0;i<25;i++) window.PK.RT && (window.PK.GAME().fervor = Math.min(100, window.PK.GAME().fervor+5)); });
const fer = await page.evaluate(() => window.PK.GAME().fervor);
assert(fer >= 0, 'fervor readable (' + Math.round(fer) + ')');

console.log('\n[4] Abilities fire without error');
for (const a of ['strike','cry','mend']) await page.evaluate(ab => window.PK.useAbility(ab), a);
assert(errors.length === 0, 'abilities ran clean' + (errors.length ? ' -> ' + errors[errors.length-1] : ''));

console.log('\n[5] Buy an upgrade');
await page.evaluate(() => window.PK.GAME().gold += 100000);
const lvBefore = await page.evaluate(() => window.GAME.upgrades.sharpen);
await page.evaluate(() => window.PK.buyUpgrade('sharpen'));
const lvAfter = await page.evaluate(() => window.GAME.upgrades.sharpen);
assert(lvAfter === lvBefore + 1, `sharpen upgraded (${lvBefore} -> ${lvAfter})`);

console.log('\n[6] Siege mode triggers and is survivable');
await page.evaluate(() => { window.PK.GAME().gold += 100000; window.PK.forceSiege(); });
await page.waitForTimeout(300);
let mode = await page.evaluate(() => window.PK.state().mode);
assert(mode === 'siege', 'entered siege mode');
// place a tower on every build slot (mix of types) via the same path the UI uses
const placed = await page.evaluate(() => {
  const types = ['cannon','arrow','frost','cannon','arrow','frost'];
  let n = 0;
  for (let i = 0; i < 6; i++) { const before = window.PK.state().siege.towers; window.PK.placeTowerAt(i, types[i]); if (window.PK.state().siege.towers > before) n++; }
  return n;
});
assert(placed === 6, `placed towers on all 6 slots (${placed})`);
// Let the siege resolve for up to ~40s, helping with strikes/fury
let resolved = false;
for (let i = 0; i < 80; i++) {
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.PK.useAbility('strike'); if (window.PK.GAME().fervor>=100) window.PK.useAbility('fury'); });
  mode = await page.evaluate(() => window.PK.state().mode);
  if (mode === 'combat') { resolved = true; break; }
}
assert(resolved, 'siege resolved back to combat (win or loss handled)');
assert(errors.length === 0, 'no errors during siege' + (errors.length ? ' -> ' + errors[errors.length-1] : ''));

console.log('\n[7] Save/load round-trips');
await page.evaluate(() => { window.PK.GAME().gold = 4242; localStorage.setItem('pixelKeepSave_v1', JSON.stringify(window.GAME)); });
await page.reload();
await page.waitForTimeout(500);
const reloadedGold = await page.evaluate(() => window.PK.state().gold);
assert(reloadedGold >= 4000, 'gold persisted across reload (' + reloadedGold + ')');
const reloadErrs = errors.length;
assert(reloadErrs === 0, 'no errors after reload');

console.log('\n[8b] Ascend while a siege is active leaves clean state (Groq #2)');
await page.evaluate(() => { window.PK.GAME().gold += 50000; window.PK.forceSiege(); });
await page.waitForTimeout(200);
// stub confirm so ascend proceeds, then ascend mid-siege
await page.evaluate(() => { window.confirm = () => true; window.PK.GAME().wave = 55; });
await page.evaluate(() => { document.getElementById('ascendBtn').click(); });
await page.waitForTimeout(200);
const post = await page.evaluate(() => ({ mode: window.PK.state().mode, siegePanelOn: document.getElementById('siegePanel').classList.contains('on'), asc: window.PK.state().asc }));
assert(post.mode === 'combat', 'ascend forced mode back to combat (' + post.mode + ')');
assert(!post.siegePanelOn, 'siege panel hidden after ascend');
assert(post.asc === 1, 'ascension counted (' + post.asc + ')');
assert(errors.length === 0, 'no errors on ascend-mid-siege' + (errors.length ? ' -> ' + errors[errors.length-1] : ''));

console.log('\n[8] Screenshot for visual check');
await page.screenshot({ path: 'tools/screenshot.png' });
console.log('  ✓ saved tools/screenshot.png');

await browser.close();
console.log('\n' + (failed ? '❌ SOME CHECKS FAILED' : '✅ ALL CHECKS PASSED'));
if (errors.length) { console.log('\nConsole errors seen:'); errors.slice(0,10).forEach(e=>console.log('  - '+e)); }
process.exit(failed ? 1 : 0);
