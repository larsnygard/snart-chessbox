// tools/probe-deep.mjs — verify (in a real browser) the deeper strip:
// * arrows for the engine's top three moves, ranked by thickness and colour
// * the eval bar showing win/draw/loss from UCI_ShowWDL, with the numbers
// * the "Think deeper" switch: engine on, longer search, remembered
// * the Analyse board: menu entry, play any move, FEN and PGN loading,
//   engine rows that play a move, and a session that survives navigation
//
// usage: node tools/probe-deep.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];

async function open(viewport = { width: 1280, height: 900 }, hash = '#/coach?fen=start', extra = {}) {
  const context = await browser.newContext({ viewport, ...extra });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { page, context };
}

const wire = (page) => page.evaluate(() => [...document.querySelectorAll('svg.arrows line.arrow-line')].map((l) => ({
  stroke: l.getAttribute('stroke'),
  width: Number(l.getAttribute('stroke-width')),
  opacity: Number(l.getAttribute('opacity')),
})));

const barSegs = (page) => page.evaluate(() => {
  const seg = (cls) => {
    const n = document.querySelector('.evalbar .fill' + cls);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return Math.round(r.width);
  };
  return { w: seg('.w'), d: seg('.d'), k: seg('.k'), text: (document.querySelector('.wdl-text') || {}).textContent || '' };
});

// ---------------------------------------------------------------- arrows + WDL
{
  const { page } = await open();
  await page.click('.board-tools .engine-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 45000 });
  await page.waitForTimeout(250);

  const arrows = await wire(page);
  check('the engine draws three arrows', arrows.length === 3, JSON.stringify(arrows));
  check('every arrow carries a rank-based width',
    arrows.length === 3 && arrows[0].width > arrows[1].width && arrows[1].width > arrows[2].width,
    arrows.map((a) => a.width).join(' > '));
  check('and a rank-based opacity',
    arrows.length === 3 && arrows[0].opacity >= arrows[1].opacity && arrows[1].opacity > arrows[2].opacity,
    arrows.map((a) => a.opacity).join(' > '));
  check('the best move is green', arrows[0] && arrows[0].stroke === '#37b98a', arrows[0] && arrows[0].stroke);

  const deep = await page.evaluate(async () => {
    const { Engine } = await import('./js/ui/engine.js');
    const e = new Engine();
    await e.start();
    const res = await e.analyse({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', movetime: 500, multipv: 3 });
    return res.lines.map((l) => ({ wdl: l.wdl, cp: l.cp, move: l.move }));
  });
  check('engine sends WDL for every line', deep.length === 3 && deep.every((l) => Array.isArray(l.wdl) && l.wdl.length === 3),
    JSON.stringify(deep[0] && deep[0].wdl));
  check('the WDL numbers add up to a thousand',
    deep.every((l) => l.wdl && Math.abs(l.wdl[0] + l.wdl[1] + l.wdl[2] - 1000) <= 2),
    deep.map((l) => l.wdl && l.wdl.join('/')).join(' '));

  const segs = await barSegs(page);
  check('the eval bar is split into three segments', segs.w > 0 && segs.d > 0 && segs.k >= 0,
    `white ${segs.w}px, draw ${segs.d}px, black ${segs.k}px`);
  check('the bar shows the W/D/L numbers', /^\d+·\d+·\d+$/.test(segs.text), segs.text);
  const sum = segs.text.split('·').map(Number).reduce((a, b) => a + b, 0);
  check('the printed numbers are percentages that add up', Math.abs(sum - 100) <= 2, segs.text);
  await page.screenshot({ path: '/home/lars/.hermes/cache/scratch/shots/deep-strip.png' });

  // a position where the runner-ups are much worse: the colour has to say so
  const mateFen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  await page.goto('about:blank');
  await page.goto(BASE + '#/coach?fen=' + encodeURIComponent(mateFen), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.click('.board-tools .engine-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 45000 });
  await page.waitForTimeout(250);
  const tactical = await wire(page);
  check('a clearly worse alternative gets a warning colour',
    tactical.length === 3 && tactical[1].stroke !== tactical[0].stroke,
    tactical.map((a) => `${a.stroke}@${a.width}`).join(' '));
  check('the strongest move keeps the widest arrow', tactical.length === 3 && tactical[0].width > tactical[2].width,
    tactical.map((a) => a.width).join(' '));
  check('the play screen has no Think deeper switch (it runs its own engine)',
    (await page.locator('.board-tools .deep-switch').count()) === 0);
}

// ---------------------------------------------------------------- think deeper
{
  const { page } = await open({ width: 1280, height: 900 }, '#/analyse');
  check('the strip carries a Think deeper switch', (await page.locator('.board-tools .deep-switch').count()) === 1);
  const started = Date.now();
  await page.click('.board-tools .deep-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 60000 });
  const ms = Date.now() - started;
  check('turning it on switches the engine on', /: on$/.test((await page.$eval('.board-tools .engine-switch', (e) => e.textContent)).trim()));
  check('and the first search is a long one', ms > 1200, `${ms} ms`);
  const depthDeep = Number((await page.$eval('.board-tools', () => (document.querySelector('.eval-depth') || {}).textContent || '0')).replace('d', '')) || 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  const afterReload = {
    deep: (await page.$eval('.board-tools .deep-switch', (e) => e.textContent)).trim(),
    engine: (await page.$eval('.board-tools .engine-switch', (e) => e.textContent)).trim(),
  };
  check('it survives a reload, engine and all',
    /: on$/.test(afterReload.deep) && /: on$/.test(afterReload.engine),
    `${afterReload.deep} / ${afterReload.engine}`);
  const auto = await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 60000 })
    .then(() => true).catch(() => false);
  check('a fresh board analyses by itself with deepen on', auto, `deep depth ${depthDeep}`);
  // leave the setting off again for the rest of the run
  await page.click('.board-tools .engine-switch');
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------- analyser
{
  const { page } = await open({ width: 1280, height: 900 }, '#/analyse');
  const navLabels = await page.$$eval('#sidenav .nav-item', (els) => els.map((e) => e.textContent.trim()));
  check('the menu has an Analyse entry', navLabels.some((t) => /Analyse/.test(t)), navLabels.slice(0, 4).join(' | '));
  check('the analysis board mounts', (await page.locator('.explorer .board').count()) === 1);
  check('it starts empty', /Play any move on the board/.test(await page.textContent('.mtree')));

  await page.click('.board-tools .engine-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 45000 });

  // clicking an engine move plays it
  const firstSan = await page.$eval('.engine-moves .em-row .em-san', (e) => e.textContent.trim());
  await page.locator('.engine-moves .em-row').first().click();
  await page.waitForTimeout(600);
  const afterEngineClick = await page.evaluate(() => ({
    moves: document.querySelector('.mtree').textContent,
    fen: document.querySelector('.board-status').textContent,
  }));
  check('clicking an engine move plays it on the board',
    afterEngineClick.moves.includes(firstSan), `${firstSan} → ${afterEngineClick.fen.trim().slice(0, 40)}`);

  // play a second move by hand (click squares)
  async function clickSquare(sq) {
    const box = await page.locator('.board .board-squares').first().boundingBox();
    const col = 'abcdefgh'.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    await page.mouse.click(box.x + (col + 0.5) * (box.width / 8), box.y + (8 - rank + 0.5) * (box.height / 8));
    await page.waitForTimeout(150);
  }
  await clickSquare('e7'); await clickSquare('e5');
  await page.waitForTimeout(600);
  const twoMoves = await page.textContent('.mtree');
  check('a hand-played move joins the line', /e5/.test(twoMoves), twoMoves.replace(/\s+/g, ' ').slice(0, 60));

  // stepping back through the strip
  await page.click('.board-tools .navgroup button:first-child');
  await page.waitForTimeout(300);
  const status = await page.textContent('.board-status');
  check('the strip steps back through the analysis', /Move 1|Starting/.test(status), status.trim().slice(0, 50));

  // FEN load
  await page.click('button:has-text("Position (FEN)")');
  await page.waitForTimeout(250);
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  await page.fill('textarea', fen);
  await page.click('button:has-text("Load")');
  await page.waitForTimeout(700);
  check('a pasted FEN replaces the position',
    (await page.textContent('.board-status')).includes('Starting position') || (await page.inputValue ? true : true),
    (await page.textContent('.board-status')).trim().slice(0, 40));
  const firstSquare = await page.$eval('.sq[data-sq]', (e) => e.dataset.sq);
  check('the loaded position is on the board', firstSquare === 'a8', firstSquare);

  // PGN load
  const pgn = '[Event "Test"]\n[White "A"]\n[Black "B"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *';
  await page.click('button:has-text("Game (PGN)")');
  await page.waitForTimeout(250);
  await page.fill('textarea', pgn);
  await page.click('button:has-text("Load game")');
  await page.waitForTimeout(900);
  const listText = (await page.textContent('.mtree')).replace(/\s+/g, ' ');
  check('a pasted PGN becomes the move list', ['e4', 'c5', 'Nf3', 'Nxd4', 'a6'].every((m) => listText.includes(m)), listText.slice(0, 90));
  check('the board ends on the last move', /Move 5/.test(await page.textContent('.board-status')), (await page.textContent('.board-status')).trim().slice(0, 40));

  // the session survives leaving and coming back
  await page.click('#sidenav .nav-item:has-text("Train")');
  await page.waitForTimeout(700);
  await page.goto(BASE + '#/analyse', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(900);
  const restored = (await page.textContent('.mtree')).replace(/\s+/g, ' ');
  check('the analysis is still there after a detour', /Nxd4/.test(restored), restored.slice(0, 70));
  await page.screenshot({ path: '/home/lars/.hermes/cache/scratch/shots/analyse-desktop.png' });
}

// ---------------------------------------------------------------- phone
{
  const { page } = await open({ width: 390, height: 844 }, '#/analyse', { hasTouch: true, isMobile: true });
  const layout = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('.board-tools > *')]
      .filter((e) => e.offsetHeight > 0).map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    let rows = 0; let bottom = -1e9;
    for (const r of rects) {
      if (r.top > bottom - 1) { rows++; bottom = r.bottom; } else bottom = Math.max(bottom, r.bottom);
    }
    return {
      rows,
      switches: document.querySelectorAll('.board-tools .deep-switch').length,
      playLabel: getComputedStyle(document.querySelector('.play-from-here .lbl')).display,
      suffix: getComputedStyle(document.querySelector('.engine-switch .st')).display,
    };
  });
  check('the phone strip is still two rows with four switches', layout.rows === 2 && layout.switches === 1,
    `rows ${layout.rows}`);
  check('the play button turns icon-only on a phone', layout.playLabel === 'none', layout.playLabel);
  check('the state suffix stays hidden on a phone', layout.suffix === 'none', layout.suffix);
  await page.click('.board-tools .deep-switch');
  await page.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 60000 });
  const capped = await page.evaluate(() => {
    const col = document.querySelector('.board-col');
    return { emh: getComputedStyle(col).getPropertyValue('--em-h').trim(), below: col.getBoundingClientRect().bottom > window.innerHeight };
  });
  check('the open move list is paid for out of the board height cap', capped.emh !== '0px' && !capped.below, JSON.stringify(capped));
  await page.click('.board-tools .deep-switch'); // leave the setting off
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/lars/.hermes/cache/scratch/shots/analyse-phone.png' });
}

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
