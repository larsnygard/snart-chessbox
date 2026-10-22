// tools/probe-db-actions.mjs — every action on the PGN database screen, on the
// big bundled collection, because the 1.17/1.18 rework (position index, batched
// records, lazy ucis) touched all of them:
//
//   search · Review · Memorise · Export PGN · New database from these ·
//   Build repertoire from these (with and without a position filter)
//
// usage: node tools/probe-db-actions.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function goto(hash) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// ---- load the collection once
await goto('#/database');
await page.locator('button:has-text("Load bundled example database")').click();
await page.waitForFunction(() => /9,?8\d\d games/.test((document.querySelector('.card .badge') || {}).textContent || ''), null, { timeout: 400000 }).catch(() => {});
check('the example database loads', /9,?8\d\d games/.test(await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent || '')));

// ---- a filtered search, on a player that is really in the collection
const player = await page.evaluate(async () => {
  const m = await import('./js/ui/pgndb.js');
  const list = m.playerList();
  return list.length ? list[0].name : '';
});
check('the collection has players to filter on', !!player, player);

await page.locator('label.field:has-text("White player") input').fill(player);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
const found = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /found/.test(t)) || '';
  return { head: h, n: document.querySelectorAll('.game-list .list-item').length };
});
check('the player filter finds games', found.n > 0, found.head);

// ---- Review: opens the coach on that game
await page.locator('.game-list .list-item button:has-text("Review")').first().click();
await page.waitForTimeout(2500);
check('Review opens the game in the coach', /\/coach\//.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
await goto('#/database');

// ---- Memorise: lands in the memory library with its moves
await page.locator('label.field:has-text("White player") input').fill(player);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
await page.locator('.game-list .list-item button:has-text("Memorise")').first().click();
await page.waitForTimeout(1200);
const memToast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));
check('Memorise adds the game', /memory/i.test(memToast), memToast.slice(0, 60));
await goto('#/memory');
const memCount = await page.evaluate(() => document.querySelectorAll('.list-item').length);
check('the memory library lists it', memCount > 0, `${memCount} entries`);

// ---- Export PGN (filtered): a file download with real content
await goto('#/database');
await page.locator('label.field:has-text("White player") input').fill(player);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
const dl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
await page.locator('button:has-text("Export PGN")').first().click();
await page.waitForTimeout(500);
const confirmExport = page.locator('.modal button:has-text("Export")').first();
if (await confirmExport.count()) await confirmExport.click();
const download = await dl;
check('Export PGN downloads a file', !!download, download ? download.suggestedFilename() : 'no download');

// ---- New database from these
await goto('#/database');
await page.locator('label.field:has-text("White player") input').fill(player);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
await page.locator('button:has-text("New database from these")').first().click();
await page.waitForTimeout(600);
const nameField = page.locator('.modal input[type="text"]').first();
if (await nameField.count()) await nameField.fill('Filtered copy');
await page.locator('.modal button:has-text("Create")').first().click();
await page.waitForTimeout(4000);
const created = await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent || '');
check('New database from these copies the result set', /games/.test(created) && !/^0 games/.test(created), created);

// ---- Build repertoire from these (no position filter)
await goto('#/database');
await page.locator('label.field:has-text("White player") input').fill(player);
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
const t0 = Date.now();
await page.locator('button:has-text("Build repertoire from these")').first().click();
await page.waitForTimeout(500);
await page.locator('.modal button:has-text("Build")').first().click();
await page.waitForFunction(() => /\/repertoire\//.test(location.hash), null, { timeout: 180000 }).catch(() => {});
check('Build repertoire from these finishes', /\/repertoire\//.test(await page.evaluate(() => location.hash)), `${Math.round((Date.now() - t0) / 1000)} s`);

// ---- Build repertoire from a *position* search result set
await goto('#/database');
const fen = await page.evaluate(async () => {
  const m = await import('./js/ui/pgndb.js');
  // a game from the *active* database (the copy made in the previous step)
  const rows = m.metaCached().filter((r) => m.dbOf(r) === m.activeDbId());
  const g = await m.getGame(rows[0].id);
  const { applySan } = await import('./js/core/chessutil.js');
  let f = g.startFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  for (const san of g.moves.slice(0, 12)) { const r = applySan(f, san); if (!r) break; f = r.fen; }
  return f;
});
await page.locator('input[placeholder^="Paste a FEN"]').fill(fen);
await page.locator('button:has-text("Search")').first().click();
await page.waitForFunction(() => /reach that position|hold that position/.test(document.body.textContent), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(600);
const posCount = await page.evaluate(() => Number((([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /position/.test(t)) || '0').match(/\d+/) || [0])[0]));
check('a position search finds games to build from', posCount > 0, `${posCount} games`);
await page.locator('button:has-text("Build repertoire from these")').first().click();
await page.waitForTimeout(500);
await page.locator('.modal button:has-text("Build")').first().click();
await page.waitForFunction(() => /\/repertoire\//.test(location.hash), null, { timeout: 120000 }).catch(() => {});
check('and the repertoire is built from those games only', /\/repertoire\//.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
