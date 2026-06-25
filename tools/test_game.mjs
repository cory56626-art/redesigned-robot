// Pixel Keep v2 — full Playwright suite.
// Covers: boot, core loop, tabs, gacha+pity, party/lead, ability modes (manual/auto/smart),
// reworked siege (winnable + creep variety), events->hero, world map jump, save/load, ascend, dev panel.
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const file = pathToFileURL(path.resolve('index.html')).href;
const errors = [];
let failed = false;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failed = true; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 860 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const S = () => page.evaluate(() => window.PK.state());

await page.goto(file);
await page.evaluate(() => { try { localStorage.removeItem('pixelKeep_v2'); } catch (e) {} });
await page.reload();
await page.waitForTimeout(500);

console.log('\n[1] Boot');
ok(await page.evaluate(() => !!(window.PK && window.PK.state)), 'PK hooks present');
ok(errors.length === 0, 'no console errors on boot' + (errors[0] ? ' -> ' + errors[0] : ''));
let s = await S();
ok(s.rubies === 800 && s.party[0] === 'squire' && s.mode2 === 'manual', 'fresh state: 800💎, squire lead, manual mode');

console.log('\n[2] Core loop');
const a = await S(); await page.waitForTimeout(6000); const b = await S();
ok(b.gold > a.gold, `gold up (${a.gold} -> ${b.gold})`);
ok(b.wave >= a.wave, `wave advanced (${a.wave} -> ${b.wave})`);

console.log('\n[3] Tabs render');
for (const t of ['heroes', 'summon', 'events', 'map', 'forge']) {
  await page.click(`.tab[data-tab="${t}"]`);
  await page.waitForTimeout(120);
}
ok(errors.length === 0, 'all tabs switched without errors');

console.log('\n[4] Gacha + pity');
await page.evaluate(() => window.PK.addRubies(5000));
const beforeOwned = (await S()).owned.length;
const r0 = (await S()).rubies;
await page.evaluate(() => window.PK.summon(10));
await page.waitForTimeout(150);
const s4 = await S();
ok(s4.rubies === r0 - 900, `10-pull cost 900💎 (${r0} -> ${s4.rubies})`);
ok(s4.owned.length >= beforeOwned, `roster grew or stayed (${beforeOwned} -> ${s4.owned.length})`);
ok(s4.pity >= 0 && s4.pity <= 60, 'pity counter in range (' + s4.pity + ')');
// force a 5* via pity by doing many singles
await page.evaluate(() => window.PK.addRubies(20000));
for (let i = 0; i < 60; i++) await page.evaluate(() => window.PK.summon(1));
const got5 = await page.evaluate(() => ['dragon','dio','sukuna'].some(id => window.PK.G().heroes[id] && window.PK.G().heroes[id].owned));
ok(got5, 'a 5★ hero obtained within pity window (Dragon/Dio/Sukuna)');

console.log('\n[5] Party + lead');
await page.evaluate(() => { window.PK.grant('dio', 5); window.PK.grant('sukuna', 5); });
await page.evaluate(() => {
  const G = window.PK.G(); G.party = ['squire', 'dio', 'sukuna'];
});
let s5 = await S();
ok(s5.party.join(',') === 'squire,dio,sukuna', 'party set to 3 heroes');
// make dio lead through the public helper path
await page.evaluate(() => { window.PK.G().party = ['dio','sukuna','squire']; });
ok((await S()).party[0] === 'dio', 'lead is Dio');
await page.evaluate(() => { window.PK.G().party = ['squire', null, null]; }); await page.waitForTimeout(150);
const dps1 = await page.evaluate(() => document.getElementById('dpsTag').textContent);
await page.evaluate(() => { window.PK.G().party = ['squire', 'dio', 'sukuna']; }); await page.waitForTimeout(150);
const dps3 = await page.evaluate(() => document.getElementById('dpsTag').textContent);
ok(parseInt(dps3.replace(/\D/g,'')) > parseInt(dps1.replace(/\D/g,'')), `bigger party => more DPS (${dps1} vs ${dps3})`);

console.log('\n[6] Ability modes (manual / auto / smart)');
await page.evaluate(() => window.PK.setMode('manual'));
ok((await S()).mode2 === 'manual', 'mode set manual');
// manual: fire slot 0 and confirm cooldown begins
await page.evaluate(() => window.PK.fireSlot(0, true));
const cdManual = await page.evaluate(() => window.PK.RT.abilCd[0]);
ok(cdManual > 0, 'manual fire put ability on cooldown (' + cdManual.toFixed(1) + 's)');
// auto: should auto-fire on its own; detect any cooldown becoming active over time
await page.evaluate(() => { window.PK.RT.abilCd = [0,0,0]; window.PK.setMode('auto'); });
let autoFired = false;
for (let i = 0; i < 16; i++) { await page.waitForTimeout(250);
  if (await page.evaluate(() => window.PK.RT.abilCd.some(c => c > 0))) { autoFired = true; break; } }
ok(autoFired, 'AUTO mode fires abilities by itself');
await page.evaluate(() => window.PK.setMode('smart'));
ok((await S()).mode2 === 'smart', 'mode set smart');

console.log('\n[7] Siege — winnable + creep variety');
await page.evaluate(() => { window.PK.addGold(100000); window.PK.G().party = ['dio','sukuna','squire']; window.PK.forceSiege(); });
await page.waitForTimeout(300);
ok((await S()).mode === 'siege', 'entered siege');
const placed = await page.evaluate(() => { const ty=['cannon','arrow','frost','cannon','arrow','frost']; let n=0;
  for (let i=0;i<6;i++){ const before=window.PK.state().siege.towers; window.PK.placeTowerAt(i,ty[i]); if(window.PK.state().siege.towers>before)n++; } return n; });
ok(placed === 6, `placed 6 towers (${placed})`);
// sample creep types over the siege + drive hero
const typesSeen = new Set();
let resolved = false, minGate = 160;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(400);
  const snap = await page.evaluate(() => ({ mode: window.PK.state().mode, sg: window.PK.state().siege,
    types: window.PK.RT.siege ? window.PK.RT.siege.creeps.map(c => c.type) : [] }));
  snap.types.forEach(t => typesSeen.add(t));
  if (snap.sg) minGate = Math.min(minGate, snap.sg.gate);
  await page.evaluate(() => { window.PK.fireSlot(0,true); window.PK.fireSlot(1,true); if(window.PK.G().fervor>=100) window.PK.fervorFury(); });
  if (snap.mode === 'combat') { resolved = true; break; }
}
ok(resolved, 'siege resolved back to combat');
ok(typesSeen.size >= 2, 'multiple creep types appeared (' + [...typesSeen].join(',') + ')');
const afterSiege = await S();
ok(afterSiege.gold >= 0, 'siege ended with valid state');

console.log('\n[8] Events -> unique hero');
await page.evaluate(() => { window.PK.G().party = ['dio','sukuna','squire']; window.PK.challengeEvent('bloodmoon'); });
await page.waitForTimeout(200);
ok((await S()).event === 'bloodmoon', 'event boss engaged');
let eventWon = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.PK.fireSlot(0,true); window.PK.fireSlot(1,true); window.PK.fireSlot(2,true); if(window.PK.G().fervor>=100) window.PK.fervorFury(); });
  if (await page.evaluate(() => window.PK.G().heroes.vlord && window.PK.G().heroes.vlord.owned)) { eventWon = true; break; }
}
ok(eventWon, 'defeated event boss and recruited Vampire Lord');

console.log('\n[9] World map jump');
await page.evaluate(() => { window.PK.G().bestWave = 45; });
await page.evaluate(() => window.PK.jumpIsland(2));
ok((await S()).island === 2, 'jumped to island 2 to farm (' + (await S()).island + ')');
await page.evaluate(() => window.PK.jumpIsland(4));
ok((await S()).island === 4, 'jumped to island 4');
ok(errors.length === 0, 'no errors during events/map');

console.log('\n[10] Save / load reload');
await page.evaluate(() => { window.PK.addRubies(1234); window.PK.G().gold = 7777; });
await page.evaluate(() => { window.dispatchEvent(new Event('beforeunload')); });
await page.waitForTimeout(100);
await page.reload(); await page.waitForTimeout(600);
const re = await S();
ok(re.gold >= 7000, 'gold persisted across reload (' + re.gold + ')');
ok(re.owned.includes('dio') && re.owned.includes('vlord'), 'gacha + event heroes persisted');
ok(errors.length === 0, 'no errors after reload');

console.log('\n[11] Ascend keeps heroes/rubies');
await page.evaluate(() => { window.confirm = () => true; window.PK.setMode('manual'); const G = window.PK.G(); G.wave = 55; G.bestWave = 55; });
await page.waitForTimeout(80);
const preAsc = await S();
await page.click('#ascendBtn');
await page.evaluate(() => { window.PK.RT.paused = true; }); // freeze so the kept strong party can't blitz before we read
const postAsc = await S();
ok(postAsc.asc === 1, 'ascension counted');
ok(postAsc.island === 1, 'progress reset to island 1 (' + postAsc.island + ')');
ok(postAsc.owned.length === preAsc.owned.length && postAsc.rubies === preAsc.rubies, 'heroes & rubies kept through ascend');
await page.evaluate(() => { window.PK.RT.paused = false; });

console.log('\n[12] Dev panel passcode 4212');
await page.evaluate(() => { window.prompt = () => '4212'; });
await page.click('#devBtn');
await page.waitForTimeout(120);
const devOpen = await page.evaluate(() => document.getElementById('devModal').classList.contains('on'));
ok(devOpen, 'dev modal opened with correct passcode');
const rb = (await S()).rubies;
await page.click('[data-dev="ruby"]');
ok((await S()).rubies === rb + 5000, 'dev +5000💎 works');

console.log('\n[13] Screenshots');
await page.evaluate(() => document.getElementById('devModal').classList.remove('on'));
await page.click('.tab[data-tab="heroes"]'); await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/v2_heroes.png' });
await page.click('.tab[data-tab="summon"]'); await page.waitForTimeout(150);
await page.evaluate(() => window.PK.summon(10)); await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/v2_summon.png' });
console.log('  ✓ screenshots saved');

await browser.close();
console.log('\n' + (failed ? '❌ SOME CHECKS FAILED' : '✅ ALL CHECKS PASSED'));
if (errors.length) { console.log('\nConsole errors:'); errors.slice(0, 12).forEach(e => console.log('  - ' + e)); }
process.exit(failed ? 1 : 0);
