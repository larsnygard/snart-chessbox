// tools/probe-setup.mjs — verify the Analyse → Set up position editor in a real
// browser: build a position by clicking and dragging, the side-to-move / castling
// / en-passant controls, the legality gate, quick positions, and that the finished
// FEN really reaches the analysis board.
//
// usage: node tools/probe-setup.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const errors = [];

async function open(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') }).catch(() => {});
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '#/analyse', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Set up")').first().click();
  await page.waitForSelector('.setup-board', { timeout: 5000 });
  await page.waitForTimeout(250);
  return { page, context };
}

async function squareBox(page, sq, boardSel = '.setup-board') {
  const box = await page.locator(boardSel + ' .board-squares').first().boundingBox();
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10);
  return {
    x: box.x + (col + 0.5) * (box.width / 8),
    y: box.y + (8 - rank + 0.5) * (box.height / 8),
  };
}

async function clickSquare(page, sq, boardSel = '.setup-board') {
  const p = await squareBox(page, sq, boardSel);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(90);
}

async function pick(page, tool) {
  await page.locator(`.setup-tool[data-tool="${tool}"]`).click();
  await page.waitForTimeout(60);
}

const setupPieces = (page) => page.$$eval('.setup-board .pieces .piece', (els) => els.map((e) => `${e.dataset.color}${e.dataset.type}@${e.dataset.sq}`));

// ---------------------------------------------------------------- editor basics
{
  const { page } = await open();
  check('the editor opens from the analysis screen', (await page.locator('.setup-board').count()) === 1);
  check('it starts on the position being analysed', (await setupPieces(page)).length === 32, `${(await setupPieces(page)).length} pieces`);
  check('the palette has 12 pieces plus move and erase',
    (await page.$$eval('.setup-tool', (els) => els.map((e) => e.dataset.tool))).join(',') === 'move,wk,wq,wr,wb,wn,wp,bk,bq,br,bb,bn,bp,erase');

  // empty board quick link
  await page.locator('button:has-text("Empty board")').first().click();
  await page.waitForTimeout(200);
  check('the Empty board quick link clears the board', (await setupPieces(page)).length === 0);

  // the legality gate refuses it
  await page.locator('button:has-text("Use position")').click();
  await page.waitForTimeout(250);
  const gate = await page.evaluate(() => ({
    stillSetup: !!document.querySelector('.setup-board'),
    msg: (document.querySelector('.setup-messages') || {}).textContent || '',
  }));
  check('an empty board is refused with a reason', gate.stillSetup && /White has no king/.test(gate.msg), gate.msg.trim());

  // place two kings with the palette
  await pick(page, 'wk');
  await clickSquare(page, 'e1');
  await pick(page, 'bk');
  await clickSquare(page, 'e8');
  const placed = await setupPieces(page);
  check('palette clicks place pieces', placed.length === 2 && placed.includes('wk@e1') && placed.includes('bk@e8'), placed.join(' '));

  // drag one of them
  const from = await squareBox(page, 'e8');
  const to = await squareBox(page, 'd5');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await setupPieces(page);
  check('a piece can be dragged to another square', dragged.includes('bk@d5') && !dragged.includes('bk@e8'), dragged.join(' '));

  // and dragged off the board to remove it (aim left of the board, not just down)
  const d5 = await squareBox(page, 'd5');
  const rect = await page.locator('.setup-board').boundingBox();
  await page.mouse.move(d5.x, d5.y);
  await page.mouse.down();
  await page.mouse.move(rect.x - 60, d5.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('dragging a piece off the board removes it', (await setupPieces(page)).length === 1, (await setupPieces(page)).join(' '));

  // the erase tool and quick links
  await page.locator('button:has-text("Start position")').first().click();
  await page.waitForTimeout(200);
  check('the Start position quick link restores all 32 pieces', (await setupPieces(page)).length === 32);
  await pick(page, 'erase');
  await clickSquare(page, 'd8');
  check('the erase tool removes a clicked piece', !(await setupPieces(page)).includes('bq@d8'), (await setupPieces(page)).length + ' pieces');
}

// ---------------------------------------------------------------- controls + gate
{
  const { page } = await open();
  // side to move
  const rights = await page.$$eval('.card .check input', (els) => els.map((e) => ({ checked: e.checked, disabled: e.disabled })));
  check('castling rights are offered when the pieces are home',
    rights.length === 4 && rights.every((r) => r.checked && !r.disabled), JSON.stringify(rights));

  await page.locator('button:has-text("Black to move")').click();
  await page.waitForTimeout(150);

  // castling right disappears with the rook
  await pick(page, 'erase');
  await clickSquare(page, 'h1');
  await page.waitForTimeout(200);
  const afterRook = await page.$$eval('.card .check input', (els) => els.map((e) => ({ checked: e.checked, disabled: e.disabled })));
  check('losing the rook withdraws the kingside right', afterRook[0].checked === false && afterRook[0].disabled === true, JSON.stringify(afterRook));

  // en passant: black pawn e5 + white pawn d5 with White to move → e6 offered
  await page.locator('button:has-text("Empty board")').first().click();
  await page.waitForTimeout(150);
  await pick(page, 'wk'); await clickSquare(page, 'e1');
  await pick(page, 'bk'); await clickSquare(page, 'e8');
  await pick(page, 'bp'); await clickSquare(page, 'e5');
  await pick(page, 'wp'); await clickSquare(page, 'd5');
  await page.locator('button:has-text("White to move")').click();
  await page.waitForTimeout(200);
  const epOptions = await page.$$eval('select option', (els) => els.map((e) => e.value));
  check('en passant offers only the square the capture can use', epOptions.includes('e6') && epOptions.length === 2, epOptions.join(','));
  await page.selectOption('select', 'e6');
  await page.waitForTimeout(150);

  // finish and read the FEN back through the clipboard
  await page.locator('button:has-text("Use position")').click();
  await page.waitForTimeout(800);
  check('a legal position lands on the analysis board', (await page.locator('.explorer .board').count()) === 1);
  check('the analysis board holds exactly the built pieces', (await page.$$eval('.explorer .pieces .piece', (els) => els.length)) === 4);
  await page.locator('button:has-text("Copy FEN")').click();
  await page.waitForTimeout(300);
  const fen = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check('the FEN keeps the castling and en passant fields',
    /^4k3\/8\/8\/3Pp3\/8\/8\/8\/4K3 w - e6 /.test(fen), fen);
}

// ---------------------------------------------------------------- phone
{
  const { context } = await open({ width: 390, height: 844 });
  await context.close();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '#/analyse', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Set up")').first().click();
  await page.waitForSelector('.setup-board', { timeout: 5000 });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    boardW: Math.round(document.querySelector('.setup-board').getBoundingClientRect().width),
    tools: document.querySelectorAll('.setup-tool').length,
    useVisible: !!document.querySelector('button.primary') && getComputedStyle([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use position')).display !== 'none',
  }));
  check('the phone editor fits the viewport', layout.scrollW === layout.innerW && layout.boardW <= 370, JSON.stringify(layout));
  check('the phone editor keeps the palette and the Use position button', layout.tools === 14 && layout.useVisible, `${layout.tools} tools`);
  // tap to place on touch
  await page.locator('.setup-tool[data-tool="wq"]').tap();
  const q = await squareBox(page, 'd1');
  await page.touchscreen.tap(q.x, q.y);
  await page.waitForTimeout(200);
  check('a tap places a piece on a phone', (await setupPieces(page)).includes('wq@d1'), (await setupPieces(page)).join(' ').slice(0, 60));
  await page.screenshot({ path: '/home/lars/.hermes/cache/scratch/shots/setup-phone.png' });
  await ctx.close();
}

// ---------------------------------------------------------------- offline
{
  const { page, context } = await open();
  // wait for the worker to control the page, then pull the plug
  const controlled = await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller,
    null, { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  check('the service worker controls the app', controlled);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(600);
  const offlineAnalysis = await page.locator('.explorer .board, .setup-board').count();
  check('the analysis screen still loads with the network off', offlineAnalysis === 1, `${offlineAnalysis} boards`);
  await page.locator('button:has-text("Set up")').first().click().catch(() => {});
  await page.waitForTimeout(500);
  check('and the position editor loads offline too', (await page.locator('.setup-board').count()) === 1);
  await context.setOffline(false);
  await context.close();
}

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
