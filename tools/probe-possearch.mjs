// tools/probe-possearch.mjs — searching the PGN database by position.
//
// Paste a FEN → the games that reach it are found by replaying; the "Board…"
// button opens the setup editor and feeds the FEN it builds back into the field.
//
// usage: node tools/probe-possearch.mjs [baseUrl]
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

const pgn = `[Event "Italian"]
[Site "?"]
[Date "2020.01.01"]
[White "White, Wendy"]
[Black "Black, Bobby"]
[WhiteElo "2500"]
[BlackElo "2480"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0

[Event "London"]
[Site "?"]
[Date "2021.02.02"]
[White "Queen, Quinn"]
[Black "Pawn, Peter"]
[WhiteElo "2100"]
[BlackElo "2050"]
[Result "1/2-1/2"]

1. d4 d5 2. Bf4 Nf6 1/2-1/2

[Event "Sicilian"]
[Site "?"]
[Date "2022.03.03"]
[White "Sicil, Sam"]
[Black "Dragon, Dana"]
[WhiteElo "2700"]
[BlackElo "2650"]
[Result "0-1"]

1. e4 c5 2. Nf3 d6 0-1`;

async function goto(hash) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
}

const fenInput = () => page.locator('input[placeholder^="Paste a FEN"]');
const headText = () => page.evaluate(() => ([...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /found|reach that position/.test(t))) || '');
const rows = () => page.$$eval('.game-list .list-item', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));

async function searchFen(fen) {
  await fenInput().fill(fen);
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForFunction(() => /reach that position|found/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { head: await headText(), rows: await rows(), note: await page.evaluate(() => ([...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /Replayed|Scanned|Instant:/.test(t))) || '') };
}

await goto('#/database');
await page.locator('.card textarea').first().fill(pgn);
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForTimeout(2500);
check('three games imported', /3 games/.test(await page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent || '')));

// ---- a FEN pasted by hand
const italian4 = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
let res = await searchFen(italian4);
check('the search switches to position mode', /reach that position/.test(res.head), res.head);
check('exactly the Italian game is found', /1 game/.test(res.head) && res.rows.length === 1 && /White, Wendy/.test(res.rows[0]), res.rows[0] && res.rows[0].slice(0, 70));
check('the row says where the position occurs', /reached at move 2/.test(res.rows[0] || ''), (res.rows[0] || '').slice(-40));
check('the search reports the indexed lookup', /Instant: a hash lookup into the position index/.test(res.note), res.note);

// ---- the index makes the next search instant, and new imports join it
const timed = await page.evaluate(async () => {
  const t0 = performance.now();
  document.querySelector('button:has-text("Search")');
  return t0;
}).catch(() => 0);
const t0 = Date.now();
await page.locator('button:has-text("Search")').first().click();
await page.waitForFunction(() => [...document.querySelectorAll('.faint')].some((e) => /Instant:/.test(e.textContent)), null, { timeout: 20000 }).catch(() => {});
check('a second search is instant', Date.now() - t0 < 1500, `${Date.now() - t0} ms`);

// ---- the starting position is in every game
res = await searchFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
check('the start position matches all three games', /3 games/.test(res.head) && res.rows.length === 3, res.head);

// ---- castling/ep/clocks are ignored
res = await searchFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w - - 22 40');
check('different rights and clocks are the same position', /1 game/.test(res.head), res.head);

// ---- a position nothing reaches
res = await searchFen('1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1');
check('a position no game reaches gives zero', /0 games/.test(res.head), res.head);

// ---- the cheap filters still apply
await fenInput().fill('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1');
await page.locator('label.field:has-text("White player") input').fill('Sicil');
await page.locator('button:has-text("Search")').first().click();
await page.waitForTimeout(1500);
check('the name filters narrow the position search', /1 game/.test(await headText()), await headText());

// ---- a new import is appended to the index, not a rebuild
const extra = `\n\n[Event "Late arrival"]\n[Site "?"]\n[Date "2023.04.04"]\n[White "Late, Larry"]\n[Black "Extra, Eve"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0`;
await page.locator('.card textarea').first().fill(extra);
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForTimeout(2500);
await page.locator('label.field:has-text("White player") input').fill('');
await fenInput().fill(italian4);
const t1 = Date.now();
await page.locator('button:has-text("Search")').first().click();
await page.waitForFunction((n) => [...document.querySelectorAll('.h3, h3')].some((e) => /reach that position/.test(e.textContent)) && document.querySelectorAll('.game-list .list-item').length >= n, 2, { timeout: 20000 }).catch(() => {});
check('a freshly imported game is found without a rebuild', /2 games/.test(await headText()) && Date.now() - t1 < 4000, `${await headText()} (${Date.now() - t1} ms)`);
await page.locator('label.field:has-text("White player") input').fill('');
await page.waitForTimeout(200);

// ---- Board… builds the FEN
await fenInput().fill('');
await page.locator('button:has-text("Board…")').click();
await page.waitForSelector('.setup-board', { timeout: 8000 }).catch(() => {});
check('the Board… button opens the setup editor', (await page.locator('.setup-board').count()) === 1);
await page.locator('button:has-text("K+Q vs K")').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Use position")').click();
await page.waitForTimeout(2000);
const builtFen = await fenInput().inputValue();
check('Use position puts the FEN in the field', /^8\/8\/8\/4k3\/8\/8\/4K3\/6Q1 w /.test(builtFen), builtFen);
check('the editor closes again', (await page.locator('.setup-board').count()) === 0);
check('and the search ran for that position', /0 games/.test(await headText()), await headText());

// ---- pasting a FEN for a position from the setup board finds the games
await page.locator('button:has-text("Board…")').click();
await page.waitForSelector('.setup-board', { timeout: 8000 }).catch(() => {});
await page.locator('button:has-text("Start position")').click();
await page.waitForTimeout(300);
await page.locator('button:has-text("Use position")').click();
await page.waitForTimeout(2000);
const startFen = await fenInput().inputValue();
check('the start position builds the standard FEN', /^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w /.test(startFen), startFen);
check('and every game is found again', /4 games/.test(await headText()), await headText());

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
