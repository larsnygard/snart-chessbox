import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await p.goto('http://127.0.0.1:8741/#/database', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await p.waitForTimeout(600);
await p.locator('button:has-text("Load bundled example database")').click();
await p.waitForFunction(() => /9,?8\d\d games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 240000 }).catch(() => {});
console.log('db:', await p.evaluate(() => (document.querySelector('.card .badge') || {}).textContent));
const noteText = () => p.evaluate(() => ([...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /Replayed|Scanned/.test(t))) || '');
const headText = () => p.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /position/.test(t))) || '');
const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4';
await p.locator('input[placeholder^="Paste a FEN"]').fill(fen);
let t0 = Date.now();
await p.locator('button:has-text("Search")').first().click();
await p.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /Scanned|Replayed/.test(e.textContent)), null, { timeout: 120000 }).catch(() => {});
console.log('first step:', Date.now() - t0, 'ms |', await headText(), '|', await noteText());
const btn = p.locator('button:has-text("Scan the rest of the database")');
console.log('resume button present:', await btn.count());
if (await btn.count()) {
  t0 = Date.now();
  await btn.click();
  await p.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /^Replayed/.test(e.textContent)), null, { timeout: 600000 }).catch(() => {});
  console.log('full scan:', Date.now() - t0, 'ms |', await headText(), '|', await noteText());
}
await b.close();
