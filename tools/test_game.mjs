// Pixel Keep v3 — full Playwright suite.
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const file = pathToFileURL(path.resolve('index.html')).href;
const errors = [];
let failed = false;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failed = true; };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 880 } });
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const S = () => page.evaluate(() => window.PK.state());

await page.goto(file);
await page.evaluate(() => { try { localStorage.removeItem('pixelKeep_v3'); } catch (e) {} });
await page.reload();
await page.waitForTimeout(500);

console.log('\n[1] Boot');
ok(await page.evaluate(() => !!(window.PK && window.PK.state)), 'PK hooks present');
ok(errors.length === 0, 'no console errors on boot' + (errors[0] ? ' -> ' + errors[0] : ''));
let s = await S();
ok(s.rubies === 800 && s.party[0] === 'squire' && s.partyHp[0] > 0, 'fresh: 800💎, squire lead, per-hero HP > 0 (' + s.partyHp[0] + ')');

console.log('\n[2] Core loop');
const a = await S(); await page.waitForTimeout(6000); const b = await S();
ok(b.gold > a.gold, `gold up (${a.gold} -> ${b.gold})`);
ok(b.wave >= a.wave, `wave advanced (${a.wave} -> ${b.wave})`);

console.log('\n[3] Tabs');
for (const t of ['heroes','summon','events','map','forge']) { await page.click(`.tab[data-tab="${t}"]`); await page.waitForTimeout(100); }
ok(errors.length === 0, 'all tabs switched cleanly');

console.log('\n[4] Gacha + pity + new heroes');
await page.evaluate(() => window.PK.addRubies(30000));
const r0 = (await S()).rubies;
await page.evaluate(() => window.PK.summon(10, true));
const s4 = await S();
ok(s4.rubies === r0 - 900, `10-pull cost 900💎 (${r0} -> ${s4.rubies})`);
for (let i = 0; i < 60; i++) await page.evaluate(() => window.PK.summon(1, true));
const fives = await page.evaluate(() => ['dragon','lich','dio','jotaro','gojo','sukuna'].filter(id => window.PK.G().heroes[id] && window.PK.G().heroes[id].owned));
ok(fives.length >= 1, '5★ obtained via pity (' + fives.join(',') + ')');
const dexCount = await page.evaluate(() => Object.keys(window.PK.DEX).length);
ok(dexCount >= 15, `expanded roster present (${dexCount} heroes incl Gojo/Jotaro/Lich/etc.)`);

console.log('\n[5] Party + per-hero HP + bigger party => more DPS');
await page.evaluate(() => { window.PK.grant('dio',5); window.PK.grant('sukuna',5); });
await page.evaluate(() => { window.PK.G().party = ['squire', null, null]; }); await page.waitForTimeout(150);
const dps1 = await page.evaluate(() => document.getElementById('dpsTag').textContent);
await page.evaluate(() => { window.PK.G().party = ['squire','dio','sukuna']; }); await page.waitForTimeout(150);
const dps3 = await page.evaluate(() => document.getElementById('dpsTag').textContent);
ok(parseInt(dps3.replace(/\D/g,'')) > parseInt(dps1.replace(/\D/g,'')), `more heroes => more DPS (${dps1} vs ${dps3})`);

console.log('\n[6] Death chain — downed hero is swapped for the next');
await page.evaluate(() => { window.PK.dev('heal'); window.PK.G().party = ['squire','dio','sukuna']; });
await page.waitForTimeout(120);
let before = await S();
ok(before.activeSlot === 0, 'active hero is slot 0');
await page.evaluate(() => window.PK.hurt(1e9)); // down the active hero
await page.waitForTimeout(60);
let mid = await S();
ok(mid.partyDead[0] === true && mid.activeSlot === 1, 'slot 0 downed -> active swapped to slot 1');
await page.evaluate(() => window.PK.hurt(1e9));
mid = await S();
ok(mid.partyDead[1] === true && mid.activeSlot === 2, 'slot 1 downed -> active swapped to slot 2');

console.log('\n[7] Full wipe restarts the island + revives');
await page.evaluate(() => window.PK.dev('wave 25')); // island 3, starts at wave 21
await page.evaluate(() => window.PK.dev('heal'));
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.PK.hurt(1e9); }); // down all three
await page.waitForTimeout(120);
const wiped = await S();
ok(wiped.wave === 21, `wiped -> restarted island 3 at wave 21 (got ${wiped.wave})`);
ok(wiped.partyDead.every(d => !d), 'all heroes revived after wipe');

console.log('\n[8] God mode (dev) blocks damage');
await page.evaluate(() => window.PK.dev('heal'));
await page.evaluate(() => window.PK.dev('god'));
const hpA = (await S()).partyHp[(await S()).activeSlot];
await page.evaluate(() => window.PK.hurt(1e9));
const after8 = await S();
ok(after8.god === true && after8.partyDead.every(d => !d), 'god mode on: no one downed by huge hit');
await page.evaluate(() => window.PK.dev('god')); // off

console.log('\n[9] Siege — winnable + creep variety');
await page.evaluate(() => { window.PK.dev('god'); window.PK.addGold(100000); window.PK.G().party = ['dio','sukuna','squire']; window.PK.forceSiege(); });
await page.waitForTimeout(250);
ok((await S()).mode === 'siege', 'entered siege');
await page.evaluate(() => { const ty=['cannon','arrow','frost','cannon','arrow','frost']; for (let i=0;i<6;i++) window.PK.placeTowerAt(i, ty[i]); });
const types = new Set(); let resolved = false;
for (let i = 0; i < 90; i++) { await page.waitForTimeout(400);
  const snap = await page.evaluate(() => ({ mode: window.PK.state().mode, types: window.PK.RT.siege ? window.PK.RT.siege.creeps.map(c=>c.type) : [] }));
  snap.types.forEach(t => types.add(t)); if (snap.mode === 'combat') { resolved = true; break; } }
ok(resolved, 'siege resolved back to combat (winnable)');
ok(types.size >= 2, 'multiple creep types appeared (' + [...types].join(',') + ')');
await page.evaluate(() => window.PK.dev('god')); // off

console.log('\n[10] Event win grants hero; event wipe ejects (no reward)');
await page.evaluate(() => { window.PK.dev('heal'); window.PK.G().party = ['dio','sukuna','squire']; window.PK.challengeEvent('bloodmoon'); });
await page.waitForTimeout(150);
ok((await S()).event === 'bloodmoon', 'event boss engaged');
const evHp = await page.evaluate(() => window.PK.RT.monster.maxHp);
const myAtk = await page.evaluate(() => Math.round(window.PK.RT ? 0 : 0) || document.getElementById('dpsTag').textContent);
ok(evHp > 3000, `event boss is beefy (HP ${evHp}) — not a pushover`);
await page.evaluate(() => window.PK.dev('kill')); // win it
ok((await S()).owned.includes('vlord'), 'defeating event recruited Vampire Lord');
// now wipe during an event -> ejected, no crash
await page.evaluate(() => { window.PK.G().party = ['squire', null, null]; window.PK.challengeEvent('cursedrite'); });
await page.waitForTimeout(120);
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.PK.hurt(1e9); });
await page.waitForTimeout(120);
const ej = await S();
ok(ej.event === null && ej.mode === 'combat', 'party wipe ejected from event');
ok(!ej.owned.includes('cursed'), 'no hero granted on event wipe');

console.log('\n[11] Dev console commands');
await page.evaluate(() => { window.PK.G().party = ['squire','dio','sukuna']; });
const rb = (await S()).rubies;
ok((await page.evaluate(() => window.PK.dev('give ruby 1000'))) && (await S()).rubies === rb + 1000, 'give ruby 1000');
await page.evaluate(() => window.PK.dev('give hero gojo'));
ok((await S()).owned.includes('gojo'), 'give hero gojo');
await page.evaluate(() => window.PK.dev('give hero all'));
ok((await S()).owned.includes('jotaro') && (await S()).owned.includes('lich'), 'give hero all');
await page.evaluate(() => window.PK.dev('gear max'));
ok((await S()).gear === 5, 'gear max');
const lvA = (await S()).lv;
await page.evaluate(() => window.PK.dev('level 5'));
ok((await S()).lv === lvA + 5, 'level 5');

console.log('\n[12] World map jump');
await page.evaluate(() => { window.PK.G().bestWave = 45; });
await page.evaluate(() => window.PK.jumpIsland(2));
ok((await S()).island === 2, 'jumped to island 2');
await page.evaluate(() => window.PK.jumpIsland(4));
ok((await S()).island === 4, 'jumped to island 4');

console.log('\n[13] Mute toggle');
const mPre = (await S()).muted;
await page.evaluate(() => window.PK.dev('mute'));
ok((await S()).muted !== mPre, 'mute toggled (' + mPre + ' -> ' + (await S()).muted + ')');

console.log('\n[14] Save / load reload');
await page.evaluate(() => { window.PK.addRubies(1234); window.PK.G().gold = 7777; });
await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
await page.waitForTimeout(80); await page.reload(); await page.waitForTimeout(600);
const re = await S();
ok(re.gold >= 7000, 'gold persisted (' + re.gold + ')');
ok(re.owned.includes('gojo') && re.owned.includes('vlord'), 'gacha + event heroes persisted');
ok(errors.length === 0, 'no errors after reload');

console.log('\n[15] Ascend keeps heroes/rubies');
await page.evaluate(() => { window.confirm = () => true; window.PK.setMode('manual'); window.PK.G().wave = 55; window.PK.G().bestWave = 55; });
await page.waitForTimeout(80);
const preAsc = await S();
await page.click('#ascendBtn');
await page.evaluate(() => { window.PK.RT.paused = true; });
const postAsc = await S();
ok(postAsc.asc === 1, 'ascension counted');
ok(postAsc.island === 1, 'reset to island 1 (' + postAsc.island + ')');
ok(postAsc.owned.length === preAsc.owned.length && postAsc.rubies === preAsc.rubies, 'heroes & rubies kept');
await page.evaluate(() => { window.PK.RT.paused = false; });

console.log('\n[16] Gacha animation + screenshots');
await page.click('.tab[data-tab="heroes"]'); await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/v3_heroes.png' });
await page.click('.tab[data-tab="summon"]'); await page.waitForTimeout(120);
await page.evaluate(() => window.PK.addRubies(5000));
await page.evaluate(() => window.PK.summon(10, false)); // real animated pull
await page.waitForTimeout(1600);
const gachaOpen = await page.evaluate(() => document.getElementById('gachaModal').classList.contains('on'));
ok(gachaOpen, 'gacha animation overlay shown');
await page.screenshot({ path: 'tools/v3_gacha.png' });
await page.evaluate(() => document.getElementById('gachaModal').click());
await page.waitForTimeout(200);
await page.evaluate(() => { window.PK.dev('god'); window.PK.forceSiege(); for (let i=0;i<6;i++) window.PK.placeTowerAt(i,['cannon','arrow','frost','cannon','arrow','frost'][i]); });
await page.waitForTimeout(900);
await page.screenshot({ path: 'tools/v3_siege.png' });
console.log('  ✓ screenshots saved');

await browser.close();
console.log('\n' + (failed ? '❌ SOME CHECKS FAILED' : '✅ ALL CHECKS PASSED'));
if (errors.length) { console.log('\nConsole errors:'); errors.slice(0,12).forEach(e => console.log('  - ' + e)); }
process.exit(failed ? 1 : 0);
