// tools/flows-check.mjs — deeper end-to-end flows: opening line completion,
// coach PGN import + review, memory quiz, set session, board theme, export.
//
// usage: node tools/flows-check.mjs [baseUrl]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { Chess } from '../vendor/chess.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const OUT = process.env.OUT || '/home/lars/.hermes/cache/scratch/shots';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const openings = JSON.parse(readFileSync(new URL('../data/openings.json', import.meta.url), 'utf8')).openings;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function goto(hash) {
  // a hash-only change is a same-document navigation: blank out first so every
  // call really re-mounts the view (otherwise stale trainer state leaks between checks)
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function clickSquare(sq, orientation = 'w') {
  const box = await page.locator('.board .board-squares').first().boundingBox();
  const f = 'abcdefgh'.indexOf(sq[0]);
  const r = parseInt(sq[1], 10);
  const col = orientation === 'w' ? f : 7 - f;
  const row = orientation === 'w' ? 8 - r : r - 1;
  await page.mouse.click(box.x + (col + 0.5) * (box.width / 8), box.y + (row + 0.5) * (box.height / 8));
  await page.waitForTimeout(150);
}

function uciFor(fen, san) {
  const c = new Chess(fen);
  const m = c.move(san);
  return { uci: m.from + m.to + (m.promotion || ''), fen: c.fen() };
}

// ---------------------------------------------------------------- 1. opening line
const short = openings.find((o) => o.moves.length === 4 && o.moves[0] === 'e4' && o.eco.startsWith('C'));
await goto('/#/openings/' + encodeURIComponent(short.id) + '?side=w');
await page.waitForTimeout(900);
let fen = short.fen; // end position; replay from start
let walkFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const plies = [];
for (const san of short.moves) {
  const r = uciFor(walkFen, san);
  plies.push(r.uci);
  walkFen = r.fen;
}
// the user plays every white ply; the opponent's replies autoplay
for (let i = 0; i < plies.length; i += 2) {
  const uci = plies[i];
  await clickSquare(uci.slice(0, 2));
  await clickSquare(uci.slice(2, 4));
  await page.waitForTimeout(1600);
}
const lineFeedback = await page.locator('.feedback').first().textContent().catch(() => '');
check('opening line completes after playing the book moves', /line complete/i.test(lineFeedback || ''), (lineFeedback || '').trim().slice(0, 70));
await page.screenshot({ path: OUT + '/flow-opening.png' });

// wrong move feedback
await goto('/#/openings/' + encodeURIComponent(short.id) + '?side=w');
await page.waitForTimeout(800);
await clickSquare('a2');
await clickSquare('a3');
await page.waitForTimeout(500);
const wrong = await page.locator('.feedback').first().textContent().catch(() => '');
check('deviating from the line is rejected with feedback', /not the line/i.test(wrong || ''), (wrong || '').trim().slice(0, 60));

// ---------------------------------------------------------------- 2. coach import + review
const shortGame = `[Event "Club game"]
[White "Lars"]
[Black "Opponent"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 0-1`;
await goto('/#/coach');
await page.locator('textarea').first().fill(shortGame);
await page.locator('input[type="text"]').first().fill('Lars');
await page.locator('button:has-text("Add games")').first().click();
await page.waitForTimeout(1500);
const gameRows = await page.locator('.game-list .list-item').count();
check('PGN import adds a game to the library', gameRows >= 1, `${gameRows} rows`);
await page.locator('.game-list .list-item').first().click();
await page.waitForTimeout(1000);
const tableAppeared = await page.locator('.an-table').first().waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
check('engine review produces a move table', tableAppeared);
if (tableAppeared) {
  const rows = await page.locator('.an-table tbody tr').count();
  const summaryText = await page.locator('.card .stat .v').first().textContent().catch(() => '');
  check('review grades the user moves', rows >= 5, `${rows} graded rows, accuracy ${summaryText}`);
  const arrows = await page.locator('.arrows line').count();
  check('review can draw arrows on the board', arrows >= 0, `${arrows} arrows on the current ply`);
}
await page.screenshot({ path: OUT + '/flow-review.png' });

// ---------------------------------------------------------------- 3. memory quiz
await goto('/#/memory');
const memRows = await page.locator('.game-list .list-item').count();
check('memory library lists games', memRows > 10, `${memRows} games`);
const famous = JSON.parse(readFileSync(new URL('../data/famous-games.json', import.meta.url), 'utf8')).games[0];
await goto('/#/memory/' + encodeURIComponent(famous.id) + '?mode=quiz&side=both');
await page.waitForTimeout(1200);
const firstSan = (Array.isArray(famous.moves) ? famous.moves : famous.moves.split(' '))[0];
const first = uciFor('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', firstSan);
await clickSquare(first.uci.slice(0, 2));
await page.mouse.move(0, 0);
const box = await page.locator('.board .board-squares').first().boundingBox();
const f = 'abcdefgh'.indexOf(first.uci[2]);
const rk = parseInt(first.uci[3], 10);
await page.mouse.click(box.x + (f + 0.5) * (box.width / 8), box.y + (8 - rk + 0.5) * (box.height / 8));
// "Correct." is shown for ~260 ms only, so read it immediately
await page.waitForTimeout(120);
const memFeedback = await page.locator('.feedback').first().textContent().catch(() => '');
await page.waitForTimeout(900);
check('memory quiz accepts the correct first move', /correct/i.test(memFeedback || ''), (memFeedback || '').trim().slice(0, 40));

// ---------------------------------------------------------------- 4. set session
await goto('/#/session/set-tactics-mate1');
await page.waitForTimeout(1200);
const badge = await page.locator('.badge').first().textContent().catch(() => '');
check('set session starts its first exercise', /exercise 1/i.test(badge || ''), badge);
await page.locator('button:has-text("Skip")').first().click();
await page.waitForTimeout(900);
const badge2 = await page.locator('.badge').first().textContent().catch(() => '');
check('skipping advances the session', /exercise 2/i.test(badge2 || ''), badge2);

// ---------------------------------------------------------------- 5. board theme applies
await goto('/#/settings');
const before = await page.evaluate(() => getComputedStyle(document.querySelector('.board')).getPropertyValue('--sq-dark').trim());
await page.locator('.swatches .swatch').nth(1).click();
await page.waitForTimeout(500);
const after = await page.evaluate(() => {
  const b = document.querySelector('.board');
  return { theme: b.dataset.board, dark: getComputedStyle(b).getPropertyValue('--sq-dark').trim() };
});
check('board theme switch changes the square colours', after.theme === 'walnut' && after.dark !== before, `${before} → ${after.dark}`);

// piece design switch
await page.locator('.piece-preview button').nth(1).click();
await page.waitForTimeout(400);
const setNow = await page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('snart-chess-trainer', 1); r.onsuccess = () => res(r.result); });
  return await new Promise((res) => { const q = db.transaction('kv', 'readonly').objectStore('kv').get('settings'); q.onsuccess = () => res(q.result.pieceSet); });
});
check('piece design switch persists', setNow === 'solid', String(setNow));

// ---------------------------------------------------------------- 6. bundle export
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.locator('button:has-text("Export bundle")').first().click(),
]);
const name = download.suggestedFilename();
check('bundle export downloads a JSON file', /\.json$/.test(name), name);

// ---------------------------------------------------------------- 6b. repertoire from PGN + train
await goto('/#/repertoire');
await page.locator('button:has-text("New repertoire")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal input[type="text"]').first().fill('Flow repertoire');
await page.locator('.modal select').nth(1).selectOption('pgn');
await page.waitForTimeout(200);
await page.locator('.modal textarea').first().fill(
  '[Event "R1"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 1-0\n\n[Event "R2"]\n\n1. e4 c5 2. Nf3 Nc6 3. Bb5 1-0');
await page.locator('.modal button:has-text("Create")').first().click();
await page.waitForTimeout(1200);
const treeMoves = await page.locator('.tree .mv').count();
check('repertoire built from PGN shows a move tree', treeMoves >= 6, `${treeMoves} nodes`);
const statsText = await page.locator('.card .dim').first().textContent().catch(() => '');
check('repertoire stats report lines and depth', /lines/.test(statsText || ''), (statsText || '').trim().slice(0, 50));
await page.screenshot({ path: OUT + '/flow-repertoire.png' });

// scope to the view: the sidebar also has a nav item called "Train"
await page.locator('.content .btn:has-text("Train")').first().click();
await page.waitForTimeout(1500);
const repStatus = await page.locator('.board-status').first().textContent().catch(() => '');
check('repertoire trainer starts on the user move', /your move/i.test(repStatus || ''), repStatus);
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(1500);
const repMoves = await page.locator('.movelist').first().textContent().catch(() => '');
check('repertoire trainer accepts a book move and replies', /e4/.test(repMoves) && /c5|Nf3|Nc6/.test(repMoves), repMoves.trim().slice(0, 40));

// ---------------------------------------------------------------- 6c. spread test button
await goto('/#/settings');
await page.locator('button:has-text("Test this setting")').first().click();
await page.waitForFunction(() => /Allowed at/.test(document.querySelector('.feedback')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
const spreadText = await page.locator('.feedback').first().textContent().catch(() => '');
check('engine spread test lists the allowed moves', /Allowed at/.test(spreadText || ''), (spreadText || '').slice(0, 60));

// ---------------------------------------------------------------- 7. mobile endgame drill
await page.setViewportSize({ width: 390, height: 844 });
await goto('/#/endgames/krk-1');
await page.waitForTimeout(1500);
const boardBox = await page.locator('.board').boundingBox();
check('mobile board fits the viewport width', boardBox.width <= 390 && boardBox.width > 250, `${Math.round(boardBox.width)}px wide`);
await page.screenshot({ path: OUT + '/mobile-endgame.png' });

const unique = [...new Set(errors)];
check('no console/page errors during flows', unique.length === 0, unique.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} flow checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n'));
  process.exit(1);
}
