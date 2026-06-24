import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'index.html');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url);
await page.waitForTimeout(300);

console.log('\n[1] Page + cards');
ok(await page.title() !== '', 'has a title');
const cards = await page.locator('.card').count();
ok(cards === 8, 'renders 8 animal cards (got ' + cards + ')');
ok(await page.locator('.card .popline .num').first().isVisible(), 'shows population number');
ok((await page.locator('#count').textContent()).includes('species'), 'shows species count');

console.log('\n[2] Explore modal: family / evolution / roles');
await page.locator('.card [data-explore]').first().focus();
await page.locator('.card [data-explore]').first().click();
await page.waitForTimeout(250);
ok(await page.locator('#modal-backdrop.open').isVisible(), 'modal opens');
ok(await page.locator('.panel[data-panel="family"].active .tree li').count() > 3, 'family tree has nodes');
await page.locator('.tab[data-tab="evo"]').click();
await page.waitForTimeout(150);
ok(await page.locator('.panel[data-panel="evo"].active .tree li.evo').count() > 3, 'evolution tree shows on tab switch');
await page.locator('.tab[data-tab="roles"]').click();
await page.waitForTimeout(150);
const predator = await page.locator('.panel[data-panel="roles"].active .tag.predator, .panel[data-panel="roles"].active .tag.prey').count();
ok(predator >= 1, 'predator/prey roles render (' + predator + ' tags)');
// close via Escape
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
ok(!(await page.locator('#modal-backdrop.open').isVisible().catch(() => false)), 'modal closes on Escape');
const focusedTag = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-explore'));
ok(!!focusedTag, 'focus returns to the Explore button after closing (a11y)');

console.log('\n[3] Search + sort');
await page.fill('#search', 'vaquita');
await page.waitForTimeout(150);
ok(await page.locator('.card').count() === 1, 'search filters to 1 card');
await page.fill('#search', '');
await page.selectOption('#sort', 'pop-asc');
await page.waitForTimeout(150);
const firstName = await page.locator('.card h2').first().textContent();
ok(/vaquita/i.test(firstName), 'sort by population asc puts smallest first (' + firstName + ')');

console.log('\n[4] Miku buddy');
ok(await page.locator('#miku svg rect').count() > 10, 'Miku pixel sprite has rects');
// click toggles the bubble; the auto-greeting may already be open, so click until shown
for (let i = 0; i < 2; i++) {
  if (await page.locator('#miku-bubble.show').isVisible().catch(() => false)) break;
  await page.locator('#miku').click();
  await page.waitForTimeout(150);
}
ok(await page.locator('#miku-bubble.show').isVisible(), 'clicking Miku shows speech bubble');
ok(await page.locator('#miku-bubble .mk-actions button').count() > 0, 'bubble shows action buttons');
// drag test
const box = await page.locator('#miku').boundingBox();
const startX = box.x, startY = box.y;
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(600, 300, { steps: 10 });
await page.mouse.move(620, 320, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(150);
const box2 = await page.locator('#miku').boundingBox();
ok(Math.abs(box2.x - startX) > 50 || Math.abs(box2.y - startY) > 50, 'Miku can be dragged (moved ' + Math.round(box2.x - startX) + ',' + Math.round(box2.y - startY) + ')');
// Miku can open an animal
await page.locator('#miku').click();
await page.waitForTimeout(150);

console.log('\n[5] No console errors');
ok(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await page.screenshot({ path: path.join(__dirname, 'screenshot.png'), fullPage: false });
await browser.close();

console.log('\n========================================');
console.log('  PASSED: ' + pass + '   FAILED: ' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
