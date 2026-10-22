// tools/probe-import.mjs — import (speed + index) and the "wrong side to
// move" case that made a pasted FEN look like a broken position search.
//
// usage: node tools/probe-import.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// 300 games with the same moves, different players/dates → a parallel-sized import
const moves = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 1-0';
const pgn = Array.from({ length: 300 }, (_, i) => `[Event "Bulk"]
[Site "?"]
[Date "2021.0${(i % 9) + 1}.01"]
[White "Bulk, White ${i}"]
[Black "Bulk, Black ${i}"]
[WhiteElo "${2300 + (i % 200)}"]
[BlackElo "${2200 + (i % 200)}"]
[Result "1-0"]

${moves}`).join('\n\n');

await page.goto(BASE + '#/database', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(600);

await page.locator('.card textarea').first().fill(pgn);
const t0 = Date.now();
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForFunction(() => /300 games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 240000 }).catch(() => {});
const importMs = Date.now() - t0;
const badge = await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent || '');
check('300 games import', /300 games/.test(badge), `${badge} in ${importMs} ms`);
// 300 games ~ 2,400 plies: ~0.4 s on one core, so a couple of seconds including
// IndexedDB writes means the parse really did run on the workers
check('the import stays in proportion to its size', importMs < 8000, `${importMs} ms for ~2400 plies`);

// ---- indexed position search still works after the import
const sicilian = 'rn1qk2r/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPP3PP/R2QKB1R w KQkq - 1 9';
await page.locator('input[placeholder^="Paste a FEN"]').fill(sicilian);
await page.locator('button:has-text("Search")').first().click();
await page.waitForFunction(() => /reach that position|hold that position/.test(document.body.textContent), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(800);
const head1 = await page.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /position/.test(t))) || '');
check('the position index was built during the import', /300 games/.test(head1), head1);

// ---- the user's case: a FEN with the side to move the wrong way round.
// The g3 games go into their own database, the way the user hit it: search the
// White-to-move FEN after 1.g3 and get nothing although the games are there.
await page.locator('button:has-text("New database")').first().click().catch(() => {});
await page.waitForTimeout(400);
const nameInput = page.locator('.modal input[type="text"]').first();
if (await nameInput.count()) {
  await nameInput.fill('g3 test');
  await page.locator('.modal button:has-text("Create")').first().click().catch(() => {});
  await page.waitForTimeout(1200);
}
const g3pgn = [1, 2, 3].map((i) => `[Event "g3"]
[Site "?"]
[Date "2022.0${i}.01"]
[White "Gee, Three ${i}"]
[Black "Reply, Black ${i}"]
[Result "1-0"]

1. g3 e5 2. Bg2 Nf6 1-0`).join('\n\n');
await page.locator('.card textarea').first().fill(g3pgn);
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForTimeout(2500);
const wrongTurn = 'rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR w KQkq - 0 1';
await page.locator('input[placeholder^="Paste a FEN"]').fill(wrongTurn);
await page.locator('button:has-text("Search")').first().click();
await page.waitForFunction(() => [...document.querySelectorAll('.feedback')].some((e) => /the other side to move/.test(e.textContent)), null, { timeout: 30000 }).catch(() => {});
const offer = await page.evaluate(() => {
  const box = [...document.querySelectorAll('.feedback')].find((e) => /the other side to move/.test(e.textContent));
  return box ? box.textContent.replace(/\s+/g, ' ').trim() : '';
});
check('a wrong side to move is explained, not silently empty', /23|game/.test(offer), offer.slice(0, 120));

const showNext = page.locator('button:has-text("Show those")');
check('and offers the games with the other side to move', (await showNext.count()) === 1);
if (await showNext.count()) {
  await showNext.click();
  await page.waitForFunction(() => /Either side to move/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  const rows = await page.$$eval('.game-list .list-item .sub', (els) => els.map((e) => e.textContent));
  check('the offer lists them, saying whose move it is', rows.length > 0 && rows.every((t) => /(White|Black) to move/.test(t)), (rows[0] || '').slice(0, 70));
}

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
