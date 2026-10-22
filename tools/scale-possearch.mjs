// tools/scale-possearch.mjs — manual performance harness for the position search.
//
// NOT part of the test suite: it downloads the bundled example database (~2.4 MB,
// 9,834 games) and then replays the whole thing twice, which takes about two
// minutes. Run it by hand after touching js/core/possearch.js or the PGN search:
//
//   python3 -m http.server 8741 &
//   node tools/scale-possearch.mjs
//
// What it should print (2026-10):
//   first search  → tens of ms: the import built the index as it imported
//   second search → tens of ms
// A database imported *before* the index existed pays a one-time build (~110 s for
// 9,834 games, progress bar in the search card) and is instant afterwards. If both
// searches are slow, the index is not being stored or read back — that is a bug.
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();

await page.goto(BASE + '#/database', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(600);
let tImport = Date.now();
await page.locator('button:has-text("Load bundled example database")').click();
await page.waitForFunction(() => /9,?8\d\d games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 600000 }).catch(() => {});
console.log('db:', await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent), `— imported in ${Date.now() - tImport} ms (download + parse + index)`);

const noteText = () => page.evaluate(() => ([...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /Replayed|Scanned/.test(t))) || '');
const headText = () => page.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /position/.test(t))) || '');
const fenInput = () => page.locator('input[placeholder^="Paste a FEN"]');

const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4';
for (const [label, expectNote] of [['first search (index build)', /Instant:/], ['second search (from the index)', /Instant:/]]) {
  await fenInput().fill(fen);
  const t0 = Date.now();
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /Instant:|Replayed|Scanned/.test(e.textContent)), null, { timeout: 600000 }).catch(() => {});
  const ms = Date.now() - t0;
  console.log(`${label} → ${ms} ms |`, await headText(), '|', await noteText());
}

await browser.close();
