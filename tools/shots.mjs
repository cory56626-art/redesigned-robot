import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const file = pathToFileURL(path.resolve('index.html')).href;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 820 } });
await p.goto(file); await p.waitForTimeout(1500);
// progress a bit + give gear/gold for a richer combat shot
await p.evaluate(() => { window.PK.skipWaves(7); window.PK.GAME().gold += 5000; for(let i=0;i<60;i++) window.PK.buyUpgrade('sharpen'); });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'tools/shot_combat.png' });
// siege shot
await p.evaluate(() => { window.PK.GAME().gold += 50000; window.PK.forceSiege(); window.PK.placeTowerAt(0,'cannon'); window.PK.placeTowerAt(1,'arrow'); window.PK.placeTowerAt(3,'frost'); window.PK.placeTowerAt(4,'arrow'); });
await p.waitForTimeout(2600);
await p.screenshot({ path: 'tools/shot_siege.png' });
await b.close();
console.log('shots saved');
