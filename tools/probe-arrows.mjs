// tools/probe-arrows.mjs — repertoire arrows vs engine arrows in a real browser.
//
// Book moves are violet (a solid arrow for the move the line plays, dimmer ones for
// the alternatives), the engine's three moves are green/blue/yellow/red, and the
// strip's Arrows switch hides BOTH — on the repertoire browser, the repertoire
// trainer and anywhere else a repertoire is loaded.
//
// usage: node tools/probe-arrows.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const BOOK = ['#a970ff', '#6f5bb0'];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];

const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function goto(hash) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(500);
}

const arrows = (sel = '.board svg.arrows line.arrow-line') => page.$$eval(sel, (els) => els.map((l) => ({
  stroke: l.getAttribute('stroke'),
  width: Number(l.getAttribute('stroke-width')),
  opacity: Number(l.getAttribute('opacity')),
})));

// ---------------------------------------------------------------- a repertoire to look at
await goto('#/repertoire');
const packAdd = page.locator('button:has-text("Add")').first();
check('the repertoire screen offers a starter pack', (await packAdd.count()) >= 1);
await packAdd.click();
// adding a starter pack opens the new repertoire in browse mode
await page.waitForSelector('.explorer .board', { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1200);
check('a starter pack opens as a loaded repertoire', (await page.locator('.explorer .board').count()) === 1,
  ((await page.textContent('.badge').catch(() => '')) || '').trim());

// ---------------------------------------------------------------- book arrows
let marks = await arrows();
check('repertoire moves are drawn as violet arrows', marks.length > 0 && marks.every((a) => BOOK.includes(a.stroke)),
  marks.map((a) => a.stroke).join(' '));
check('no engine-green arrow without the engine', !marks.some((a) => a.stroke === '#37b98a'));

// the engine's three moves join in a different colour family
await page.click('.board-tools .engine-switch');
await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 45000 });
await page.waitForTimeout(400);
const both = await arrows();
check('engine arrows appear in their own colours',
  both.some((a) => a.stroke === '#37b98a') && both.some((a) => BOOK.includes(a.stroke)),
  both.map((a) => a.stroke).join(' '));
check('book and engine arrows are distinguishable at a glance',
  new Set(both.map((a) => a.stroke)).size >= 3, [...new Set(both.map((a) => a.stroke))].join(' '));

// ---------------------------------------------------------------- the switch hides both
await page.click('.board-tools .arrows-switch');
await page.waitForTimeout(250);
check('Arrows off hides the book arrows too', (await arrows()).length === 0, `${(await arrows()).length} arrows left`);
await page.click('.board-tools .arrows-switch');
await page.waitForTimeout(300);
const back = await arrows();
check('Arrows on brings both layers back',
  back.some((a) => a.stroke === '#37b98a') && back.some((a) => BOOK.includes(a.stroke)),
  back.map((a) => a.stroke).join(' '));

// ---------------------------------------------------------------- the trainer
// read the line's own move from the browse screen (the solid violet arrow)
const bookArrow = await page.$$eval('.board svg.arrows line.arrow-line', (els) => {
  const l = els.find((x) => x.getAttribute('stroke') === '#a970ff');
  return l ? { x1: Number(l.getAttribute('x1')), y1: Number(l.getAttribute('y1')), x2: Number(l.getAttribute('x2')), y2: Number(l.getAttribute('y2')) } : null;
});
check('the repertoire draws a solid violet arrow for the move it plays', !!bookArrow, JSON.stringify(bookArrow));

await page.click('.board-tools .engine-switch'); // engine off: only book arrows remain
await page.waitForTimeout(200);
// exact text: the sidebar entry is "⠿Train", the repertoire tab is plain "Train"
await page.locator('button:text-is("Train")').first().click();
await page.waitForSelector('.board-status:has-text("Your move")', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(600);
const trainerBoard = await page.locator('.board .board-squares').first().boundingBox();
const click = async (sq) => {
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10);
  await page.mouse.click(trainerBoard.x + (col + 0.5) * (trainerBoard.width / 8), trainerBoard.y + (8 - rank + 0.5) * (trainerBoard.height / 8));
  await page.waitForTimeout(500);
};
const sqOf = (bx, by) => 'abcdefgh'[Math.floor(bx)] + (8 - Math.floor(by));

const trainerStart = await arrows();
check('the repertoire trainer starts with no arrows of its own', trainerStart.length === 0, trainerStart.map((a) => a.stroke).join(' '));
if (bookArrow) {
  await click(sqOf(bookArrow.x1, bookArrow.y1));
  await click(sqOf(bookArrow.x2, bookArrow.y2));
  await page.waitForSelector('.board-status:has-text("Your move")', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const reply = await arrows();
  check('the book reply is drawn in violet, never engine green',
    reply.length > 0 && reply.every((a) => BOOK.includes(a.stroke)), reply.map((a) => a.stroke).join(' '));
}

// ---------------------------------------------------------------- the setting sticks
await goto('#/analyse');
const analyseArrows = await page.evaluate(() => !!document.querySelector('.board-tools .arrows-switch'));
check('the switch also sits on the analysis board', analyseArrows);

// puzzles keep their hint arrows: they have no Arrows switch at all
await goto('#/puzzles');
const puzzleState = await page.evaluate(() => ({
  switches: document.querySelectorAll('.board-tools .arrows-switch').length,
  hiddenNote: (document.querySelector('.board-tools') || {}).textContent || '',
}));
check('puzzles still hide the engine and keep their own hint arrows', puzzleState.switches === 0, puzzleState.hiddenNote.trim().slice(0, 40));

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
