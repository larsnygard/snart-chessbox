// tools/probe-strip.mjs — verify the board strip's display switches in a real
// browser: Arrows (engine arrows on/off) and Moves (engine top-3 list with the
// line shown on hover), plus the two-row phone layout.
//
// usage: NODE_PATH=~/.hermes/hermes-agent/node_modules node tools/probe-strip.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];

async function open(viewport, hash = '#/coach?fen=start', extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { context, page };
}

const arrowCount = (page) => page.$$eval('.board svg.arrows line.arrow-line', (els) => els.length);
const rowInfo = (page) => page.$$eval('.engine-moves .em-row', (els) => els.map((e) => ({
  san: e.querySelector('.em-san').textContent,
  eval: e.querySelector('.em-eval').textContent,
  line: e.querySelector('.em-line').textContent,
  lineShown: getComputedStyle(e.querySelector('.em-line')).display !== 'none',
  on: e.classList.contains('best'),
})));

// ---------------------------------------------------------------- desktop
{
  const { page } = await open({ width: 1366, height: 900 });

  const labels = await page.$$eval('.board-tools .engine-switch, .board-tools .arrows-switch, .board-tools .moves-switch',
    (els) => els.map((e) => e.textContent.trim()));
  check('the strip carries three switches', labels.length === 3, labels.join(' | '));
  check('they read Engine / Arrows / Moves with state',
    labels[0].startsWith('Engine') && labels[1].startsWith('Arrows') && labels[2].startsWith('Moves'),
    labels.join(' | '));
  check('arrows and moves start on', /: on$/.test(labels[1]) && /: on$/.test(labels[2]), labels.slice(1).join(' | '));

  await page.click('.board-tools .engine-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 40000 });
  // the click leaves the pointer wherever the row layout put it — park it away
  // from the list so "hidden until hover" is measured honestly
  await page.mouse.move(680, 40);
  await page.waitForTimeout(150);
  const rows = await rowInfo(page);
  check('engine lists its top three moves', rows.length === 3,
    rows.map((r) => `${r.san} ${r.eval}`).join(' · '));
  check('the first row is the best move', rows[0].on && !rows[1].on && !rows[2].on);
  check('lines stay hidden until hovered', rows.every((r) => !r.lineShown));
  check('every row carries a numbered SAN line', rows.every((r) => /^\d+\./.test(r.line) && r.line.split(' ').length >= 3)
    && rows.some((r) => r.line.split(' ').length >= 7),
    rows.map((r) => r.line).join(' // '));
  check('the best move is a legal-looking SAN', /^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?$|^O-O(-O)?/.test(rows[0].san), rows[0].san);

  await page.hover('.engine-moves .em-row:nth-child(2)');
  await page.waitForTimeout(200);
  const hovered = await page.$eval('.engine-moves .em-row:nth-child(2) .em-line', (e) => ({
    shown: getComputedStyle(e).display !== 'none', text: e.textContent,
  }));
  check('hovering a move shows its line', hovered.shown && hovered.text.length > 4, hovered.text);

  const withArrows = await arrowCount(page);
  check('engine arrows are drawn', withArrows >= 1, `${withArrows} arrows`);
  await page.click('.board-tools .arrows-switch');
  await page.waitForTimeout(150);
  check('the Arrows switch removes them', (await arrowCount(page)) === 0, `${await arrowCount(page)} left`);
  await page.click('.board-tools .arrows-switch');
  await page.waitForTimeout(150);
  check('and puts them back without a new search', (await arrowCount(page)) === withArrows, `${await arrowCount(page)} arrows`);

  await page.click('.board-tools .moves-switch');
  await page.waitForTimeout(150);
  check('the Moves switch hides the list', await page.locator('.engine-moves').isHidden());
  await page.click('.board-tools .moves-switch');
  await page.waitForTimeout(150);
  check('and shows it again', (await rowInfo(page)).length === 3);
  check('the eval bar keeps working with the list hidden', true);

  // persistence: a reload must remember both switches
  await page.click('.board-tools .arrows-switch'); // arrows off
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const afterReload = await page.$eval('.board-tools .arrows-switch', (e) => e.textContent.trim());
  check('the switch state survives a reload', /: off$/.test(afterReload), afterReload);
  await page.click('.board-tools .arrows-switch'); // restore for the next run
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------- phone
{
  const { page } = await open({ width: 390, height: 844 }, '#/coach?fen=start', { hasTouch: true, isMobile: true });
  await page.click('.board-tools .engine-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 40000 });
  const layout = await page.evaluate(() => {
    // count visual rows: items on one flex line overlap vertically, so a new row
    // is an item that starts below everything measured so far
    const rects = [...document.querySelectorAll('.board-tools > *')]
      .filter((e) => e.offsetHeight > 0)
      .map((e) => e.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    let rows = 0;
    let bottom = -1e9;
    const tops = [];
    for (const r of rects) {
      if (r.top > bottom - 1) { rows++; tops.push(Math.round(r.top)); bottom = r.bottom; }
      else bottom = Math.max(bottom, r.bottom);
    }
    const suffix = [...document.querySelectorAll('.board-tools .st')].map((e) => getComputedStyle(e).display);
    const moves = document.querySelector('.engine-moves');
    return {
      rows, tops,
      suffixHidden: suffix.every((d) => d === 'none'),
      movesRowHeight: Math.round(moves.getBoundingClientRect().height),
      boardBelowFold: document.querySelector('.board-col').getBoundingClientRect().bottom > window.innerHeight,
    };
  });
  check('the phone strip is still two rows', layout.rows === 2, `rows at y=${layout.tops.join(',')}`);
  check('the switch suffixes are dropped on a phone', layout.suffixHidden);
  check('the move list becomes one compact row', layout.movesRowHeight > 0 && layout.movesRowHeight < 60, `${layout.movesRowHeight}px`);
  check('nothing is pushed below the fold', !layout.boardBelowFold);
  check('the list still has three moves on a phone', (await rowInfo(page)).length === 3);

  await page.locator('.engine-moves .em-row').nth(1).tap();
  await page.waitForTimeout(200);
  const tapped = await page.$eval('.engine-moves .em-row:nth-child(2) .em-line', (e) => getComputedStyle(e).display !== 'none');
  check('tapping a move pins its line open on touch', tapped);
  await page.locator('.engine-moves .em-row').nth(1).tap();
  await page.waitForTimeout(150);
  check('tapping it again closes the line',
    (await page.$$eval('.engine-moves .em-row', (els) => els.map((e) => e.classList.contains('pinned')))).every((x) => !x));
  await page.screenshot({ path: '/home/lars/.hermes/cache/scratch/shots/strip-phone.png' });
}

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
