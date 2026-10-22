// tools/scale-possearch.mjs — manual performance harness for the position search.
//
// NOT part of the test suite: it downloads the bundled example database (~2.4 MB,
// 9,834 games) and then replays the whole thing twice, which takes about two
// minutes. Run it by hand after touching js/core/possearch.js or the PGN search:
//
//   python3 -m http.server 8741 &
//   node tools/scale-possearch.mjs
//
// What it should print (2026-10, chess.js ~6,200 moves/s):
//   start position   → ~1 s,  9834 games (nothing to replay)
//   first step       → ~8 s,  ~750 of 9834 scanned, "Scan the rest" offered
//   full scan        → ~100 s, "Replayed 9834 games"
// A budgeted first step that reports "0 games so far" in 8 s means the scan is
// working in steps as designed — it is not a failure.
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();

await page.goto(BASE + '#/database', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(600);
await page.locator('button:has-text("Load bundled example database")').click();
await page.waitForFunction(() => /9,?8\d\d games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 240000 }).catch(() => {});
console.log('db:', await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent));

const noteText = () => page.evaluate(() => ([...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /Replayed|Scanned/.test(t))) || '');
const headText = () => page.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /position/.test(t))) || '');
const fenInput = () => page.locator('input[placeholder^="Paste a FEN"]');

for (const [label, fen] of [
  ['start position (nothing to replay)', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1'],
  ['a middlegame position (full replay)', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4'],
]) {
  await fenInput().fill(fen);
  const t0 = Date.now();
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /Scanned|Replayed/.test(e.textContent)), null, { timeout: 240000 }).catch(() => {});
  console.log(`\n${label} — first step ${Date.now() - t0} ms`);
  console.log('  ', await headText(), '|', await noteText());
  const rest = page.locator('button:has-text("Scan the rest of the database")');
  if (await rest.count()) {
    const t1 = Date.now();
    await rest.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /^Replayed/.test(e.textContent)), null, { timeout: 600000 }).catch(() => {});
    console.log(`  full scan ${Date.now() - t1} ms`);
    console.log('  ', await headText(), '|', await noteText());
  }
}

await browser.close();
