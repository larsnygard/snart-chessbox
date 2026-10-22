import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await p.goto('http://127.0.0.1:8741/#/database', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await p.waitForTimeout(600);
await p.locator('button:has-text("Load bundled example database")').click();
await p.waitForFunction(() => /9,?8\d\d games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 240000 }).catch(() => {});
console.log('db size:', await p.evaluate(() => (document.querySelector('.card .badge') || {}).textContent));
for (const [label, fen] of [
  ['start position (32 pieces)', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1'],
  ['Italian 4 plies (30 pieces)', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4'],
  ['an endgame position', '8/8/8/4k3/8/8/4K3/6Q1 w - - 0 1'],
]) {
  await p.locator('input[placeholder^="Paste a FEN"]').fill(fen);
  const t0 = Date.now();
  await p.locator('button:has-text("Search")').first().click();
  await p.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /to find them/.test(e.textContent)), null, { timeout: 240000 }).catch(() => {});
  console.log(label, '→', Date.now() - t0, 'ms', await p.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /reach/.test(t)))));
}
await b.close();
