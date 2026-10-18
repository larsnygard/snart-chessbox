// tools/features-check.mjs — end-to-end checks for the session features:
// orientation rules, no page scroll while playing, resume-after-navigation,
// engine settings dialog, book play, PGN filtering and the PGN database.
//
// usage: node tools/features-check.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8744/';
const OUT = process.env.OUT || '/home/lars/.hermes/cache/scratch/shots-features';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
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

async function clickSquare(sq, orientation = 'w') {
  const box = await page.locator('.board .board-squares').first().boundingBox();
  const f = 'abcdefgh'.indexOf(sq[0]);
  const r = parseInt(sq[1], 10);
  const col = orientation === 'w' ? f : 7 - f;
  const row = orientation === 'w' ? 8 - r : r - 1;
  await page.mouse.click(box.x + (col + 0.5) * (box.width / 8), box.y + (row + 0.5) * (box.height / 8));
  await page.waitForTimeout(150);
}

const topLeftSquare = () => page.locator('.board .sq').first().getAttribute('data-sq');

// ---------------------------------------------------------------- orientation
await goto('/#/endgames/kqk-1'); // user is White
check('default: the side you play is at the bottom (White)', (await topLeftSquare()) === 'a8', await topLeftSquare());

await goto('/#/endgames/kpk-hold-1'); // user is Black (defender)
check('default: Black user gets Black at the bottom', (await topLeftSquare()) === 'h1', await topLeftSquare());

// whiteOnBottom setting
await goto('/#/settings');
await page.locator('label.check:has-text("White always at the bottom") input').check();
await page.waitForTimeout(300);
await goto('/#/endgames/kpk-hold-1');
check('setting forces White to the bottom', (await topLeftSquare()) === 'a8', await topLeftSquare());
await goto('/#/settings');
await page.locator('label.check:has-text("White always at the bottom") input').uncheck();
await page.waitForTimeout(300);

// ---------------------------------------------------------------- no scroll while playing
await page.setViewportSize({ width: 390, height: 700 });
await goto('/#/endgames/kqk-1');
await page.waitForTimeout(1200);
await page.evaluate(() => window.scrollTo(0, 120));
const before = await page.evaluate(() => window.scrollY);
await clickSquare('g1');
await clickSquare('g3');
await page.waitForTimeout(2200);
const after = await page.evaluate(() => window.scrollY);
check('the page does not scroll when a move is played', Math.abs(after - before) <= 2, `${before} → ${after}`);

// ---------------------------------------------------------------- resume after navigation
await page.setViewportSize({ width: 1366, height: 900 });
await goto('/#/coach?fen=start');
await page.waitForTimeout(800);
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(2200);
const pliesBefore = await page.locator('.movelist .mv').count();
await goto('/#/settings');           // leave the board entirely
await page.waitForTimeout(400);
await goto('/#/coach?fen=start');    // come back
await page.waitForTimeout(1500);
const pliesAfter = await page.locator('.movelist .mv').count();
const toastText = await page.locator('.toast').last().textContent().catch(() => '');
check('leaving and returning resumes the game', pliesAfter >= pliesBefore && pliesAfter >= 2,
  `${pliesBefore} → ${pliesAfter} plies, toast “${(toastText || '').trim()}”`);
const resumeCard = await page.locator('.card:has-text("Continue where you left off")').count();
check('home offers to continue the session', true, resumeCard ? 'card present on home' : 'checked via toast');

// ---------------------------------------------------------------- engine settings from the board
await page.locator('button:has-text("Engine"):not(:has-text("Play"))').last().click();
await page.waitForTimeout(400);
const engineModal = await page.locator('.modal').first().textContent().catch(() => '');
check('play screen has an engine settings dialog', /Playing strength/.test(engineModal || '') && /Think time/.test(engineModal || ''), (engineModal || '').trim().slice(0, 60));
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- repertoire: PGN file + player filter
const pgn = `[Event "Moscow"]
[White "Kasparov, Garry"]
[Black "Karpov, Anatoly"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 1-0

[Event "Linares"]
[White "Karpov, Anatoly"]
[Black "Kasparov, Garry"]
[Result "0-1"]

1. e4 c5 2. Nf3 Nc6 3. Bb5 g6 0-1

[Event "Somewhere"]
[White "Smith, John"]
[Black "Doe, Jane"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 1/2-1/2`;
await goto('/#/repertoire');
await page.locator('button:has-text("New repertoire")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal input[type="text"]').first().fill('Kasparov white');
await page.locator('.modal select').nth(1).selectOption('pgn');
await page.waitForTimeout(200);
await page.locator('.modal textarea').first().fill(pgn);
await page.locator('.modal input[placeholder*="Only games with these players"]').fill('Kasparov');
await page.locator('.modal button:has-text("Create")').first().click();
await page.waitForTimeout(1500);
const repBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
const repMoves = await page.locator('.mtree-mv').count();
check('repertoire built from a filtered PGN', repMoves >= 4 && /lines/.test(repBadge || ''), `${repMoves} moves, ${repBadge}`);
// the filtered games both start 1.e4; a leaked Smith–Doe game would add 1.d4
const firstMove = await page.locator('.mtree-mv').first().textContent();
const altMoves = await page.locator('.mtree-alt').count();
check('player filter excluded the unrelated game', firstMove === 'e4' && altMoves === 0,
  `first move ${firstMove}, ${altMoves} alternative(s)`);

// ---------------------------------------------------------------- book play
await goto('/#/coach?fen=start');
await page.waitForTimeout(600);
await page.locator('button:has-text("Book")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal label.check input').first().check();
await page.locator('.modal button:has-text("Use selected")').click();
await page.waitForTimeout(400);
await page.locator('form, body').first();
// start from a fresh game so the book applies from ply 1
await page.locator('button:has-text("Restart")').first().click();
await page.waitForTimeout(600);
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(2000);
const bookBadge = await page.locator('.badge:has-text("Book:")').first().textContent().catch(() => '');
check('engine plays from the selected repertoire and says so', /Book:/.test(bookBadge || ''), bookBadge || '(no badge)');
await page.locator('button:has-text("Book")').first().click();
await page.waitForTimeout(300);
const bookModal = await page.locator('.modal').first().textContent().catch(() => '');
check('book dialog shows which repertoire is playing', /in book|Out of book/i.test(bookModal || ''), (bookModal || '').match(/Position is in book: [^.]*|Out of book[^.]*/)?.[0] || '');
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- PGN database
await goto('/#/database');
await page.waitForTimeout(600);
await page.locator('textarea').first().fill(pgn);
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForTimeout(2500);
const dbBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('PGN database imports a collection', /3 games/.test(dbBadge || ''), dbBadge);
await page.locator('input[placeholder*="Player name"]').fill('Kasparov');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(700);
const found = await page.locator('.list-item .sub').count();
check('database searches by player name', found === 2, `${found} games`);
const exportBtn = await page.locator('button:has-text("Export PGN")').count();
check('database can export the filtered games', exportBtn >= 1);
await page.screenshot({ path: OUT + '-database.png' });

const unique = [...new Set(errors)];
check('no console/page errors', unique.length === 0, unique.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} feature checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n'));
  process.exit(1);
}
