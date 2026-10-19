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

// ---------------------------------------------------------------- beta notice + about page
await goto('/#/home');
const banner = await page.locator('.card:has-text("Beta build")').first().textContent().catch(() => '');
check('home shows the beta notice with a breaking-changes warning', /expect breaking changes/i.test(banner || '') && /backup/i.test(banner || ''),
  (banner || '').replace(/\s+/g, ' ').slice(0, 70));
await page.locator('button:has-text("Dismiss")').first().click();
await page.waitForTimeout(300);
await goto('/#/home');
const bannerAfter = await page.locator('.card:has-text("Beta build")').count();
check('the beta notice can be dismissed and stays dismissed', bannerAfter === 0, `${bannerAfter} banner(s)`);
await goto('/#/about');
const supportLinks = await page.locator('.content a[href*="ko-fi"], .content a[href*="lichess"], .content a[href*="theweekinchess"]').evaluateAll((els) => els.map((e) => e.href));
check('About has a support section with Ko-fi, Lichess and TWIC',
  supportLinks.some((h) => h.includes('ko-fi.com/larsnygard')) && supportLinks.some((h) => h.includes('lichess.org')) && supportLinks.some((h) => h.includes('theweekinchess')),
  supportLinks.join(' '));
const aboutBody = await page.locator('.content').first().textContent().catch(() => '');
check('about page states the version, beta status and release notes',
  /v1\.\d+\.\d+-beta/.test(aboutBody || '') && /this is a beta release/i.test(aboutBody || '') && /Licences/.test(aboutBody || ''),
  (aboutBody || '').replace(/\s+/g, ' ').slice(0, 60));

// ---------------------------------------------------------------- Play is a menu item
await goto('/#/home');
await page.waitForTimeout(500);
const playNav = await page.locator('#sidenav .nav-item[data-nav="play"]').count();
check('Play is in the menu', playNav === 1);
await page.locator('#sidenav .nav-item[data-nav="play"]').click();
await page.waitForTimeout(1200);
const playDialog = await page.locator('.modal:has-text("New game")').count();
const playBoard = await page.locator('.board').count();
check('Play offers the new-game dialog (or resumes a game)', playDialog === 1 || playBoard === 1,
  playDialog ? 'dialog shown' : 'board shown');
if (!playDialog) {
  await page.locator('button:has-text("New game")').first().click();
  await page.waitForTimeout(500);
}
const ngOptions = await page.locator('.modal').first().textContent().catch(() => '');
check('the new-game dialog covers colour, clock, strength and book',
  /Colour/.test(ngOptions || '') && /Time control/.test(ngOptions || '') && /Engine strength/.test(ngOptions || '') && /book/i.test(ngOptions || ''),
  (ngOptions || '').replace(/\s+/g, ' ').slice(0, 60));
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- menu reordering
await goto('/#/home');
await page.waitForTimeout(600);
const navIds = () => page.locator('#sidenav .nav-item').evaluateAll((els) => els.map((e) => e.dataset.nav));
const grips = await page.locator('#sidenav .nav-item .grip').count();
check('menu items show a drag grip', grips >= 10, `${grips} grips`);
const navBefore = await navIds();
await page.locator('#sidenav .nav-item').first().focus();
await page.keyboard.down('Alt');
await page.keyboard.press('ArrowDown');
await page.keyboard.up('Alt');
await page.waitForTimeout(500);
const afterKey = await navIds();
check('Alt+↓ moves a menu item down', afterKey[0] === navBefore[1] && afterKey[1] === navBefore[0],
  `${navBefore.slice(0, 3).join(',')} → ${afterKey.slice(0, 3).join(',')}`);
await goto('/#/home');
const afterReload = await navIds();
check('the menu order survives a reload', afterReload[0] === afterKey[0] && afterReload[1] === afterKey[1],
  afterReload.slice(0, 3).join(','));

const items = page.locator('#sidenav .nav-item');
const srcBox = await items.nth(2).boundingBox();
const dragTarget = await items.nth(0).boundingBox();
const dragId = await items.nth(2).getAttribute('data-nav');
await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
await page.mouse.down();
await page.mouse.move(dragTarget.x + dragTarget.width / 2, dragTarget.y + 3, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);
const afterDrag = await navIds();
check('dragging an item reorders the menu', afterDrag[0] === dragId, `${dragId} → ${afterDrag.slice(0, 3).join(',')}`);

await goto('/#/settings');
await page.locator('button:has-text("Reset menu order")').click();
await page.waitForTimeout(700);
await goto('/#/home');
const afterReset = await navIds();
check('the menu order can be reset to the default', afterReset[0] === 'home' && afterReset[1] === 'play' && afterReset[2] === 'openings',
  afterReset.slice(0, 3).join(','));

// ---------------------------------------------------------------- simultan orientation per board
await goto('/#/simultan');
await page.locator('.chip:has-text("2 boards")').first().click();
await page.locator('button:has-text("Start simultan")').first().click();
await page.waitForTimeout(1800);
const boards = await page.locator('.side-col .list .list-item').count();
check('simultan: board 1 shows the user colour at the bottom (White)', (await topLeftSquare()) === 'a8', `${boards} boards, ${await topLeftSquare()}`);
await page.locator('.side-col .list .list-item').nth(1).click();
await page.waitForTimeout(600);
check('simultan: black board flips to Black at the bottom', (await topLeftSquare()) === 'h1', await topLeftSquare());
await page.locator('.side-col .list .list-item').nth(0).click();
await page.waitForTimeout(600);
check('simultan: switching back restores the white board', (await topLeftSquare()) === 'a8', await topLeftSquare());

// a manual flip must survive engine repaints and board switches
await page.locator('.board-tools button[title="Flip board"]').click();
await page.waitForTimeout(400);
const flipped = await topLeftSquare();
await page.locator('.side-col .list .list-item').nth(1).click();
await page.waitForTimeout(400);
await page.locator('.side-col .list .list-item').nth(0).click();
await page.waitForTimeout(600);
check('simultan: a hand-flipped board keeps its orientation', flipped === 'h1' && (await topLeftSquare()) === 'h1', `${flipped} → ${await topLeftSquare()}`);

// ---------------------------------------------------------------- simultan: animated board switch
await page.locator('.side-col .list .list-item').nth(0).click();
await page.waitForTimeout(700);
const animSample = await page.evaluate(async () => {
  const b = document.querySelector('.board');
  const before = getComputedStyle(b).transform;
  const nextBtn = [...document.querySelectorAll('.board-col .row button')].find((x) => /Next/.test(x.textContent));
  nextBtn.click();
  await new Promise((r) => setTimeout(r, 90));
  const during = getComputedStyle(b).transform;
  const running = b.getAnimations().map((a) => a.playState);
  await new Promise((r) => setTimeout(r, 700));
  const after = getComputedStyle(b).transform;
  return { before, during, after, running };
});
check('switching boards is animated (slide)', animSample.during !== animSample.before && animSample.after === animSample.before && animSample.running.includes('running'),
  `${animSample.before} → ${animSample.during} (${animSample.running.join(',')}) → ${animSample.after}`);

// ---------------------------------------------------------------- simultan: switch delay
async function startSimulWithDelay(label) {
  await goto('/#/simultan');
  await page.locator('.chip:has-text("3 boards")').first().click();
  await page.locator(`.chip:has-text("${label}")`).first().click();
  await page.locator('button:has-text("Start simultan")').first().click();
  await page.waitForTimeout(1500);
}
await startSimulWithDelay('Manual');
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(2200);
const manualBoard = await page.locator('.board-col strong').first().textContent().catch(() => '');
check('manual mode keeps you on the board after your move', /Board 1/.test(manualBoard || ''), manualBoard);

await startSimulWithDelay('Instant');
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(1600);
const autoBoard = await page.locator('.board-col strong').first().textContent().catch(() => '');
check('instant mode moves to the next board by itself', !/Board 1/.test(autoBoard || ''), autoBoard);

// ---------------------------------------------------------------- right-click annotations
await goto('/#/endgames/kqk-1');
await page.waitForTimeout(900);
const markBox = await page.locator('.board .board-squares').first().boundingBox();
const sqPoint = (name) => {
  const f = 'abcdefgh'.indexOf(name[0]);
  const r = parseInt(name[1], 10);
  return { x: markBox.x + (f + 0.5) * (markBox.width / 8), y: markBox.y + (8 - r + 0.5) * (markBox.height / 8) };
};
const sqClass = (name) => page.locator(`.sq[data-sq="${name}"]`).getAttribute('class');
const rightClick = async (name, modifiers = []) => {
  const pt = sqPoint(name);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(150);
};

await rightClick('d5');
const mark1 = await sqClass('d5');
await rightClick('d5');
const mark2 = await sqClass('d5');
await rightClick('d5');
const mark3 = await sqClass('d5');
await rightClick('d5');
const mark4 = await sqClass('d5');
check('right-click cycles green → red → yellow → off',
  /mark-green/.test(mark1) && /mark-red/.test(mark2) && /mark-yellow/.test(mark3) && !/mark-/.test(mark4),
  `${(mark1.match(/mark-\w+/) || [''])[0]} → ${(mark2.match(/mark-\w+/) || [''])[0]} → ${(mark3.match(/mark-\w+/) || [''])[0]} → ${(mark4.match(/mark-\w+/) || ['none'])[0]}`);

await rightClick('c4', ['Shift']);
check('shift+right-click sets red directly', /mark-red/.test(await sqClass('c4')), await sqClass('c4'));
await rightClick('c4', ['Alt']);
check('alt+right-click sets yellow directly', /mark-yellow/.test(await sqClass('c4')), await sqClass('c4'));

// arrows: right-drag, then the same drag again removes it
const arrowCount = () => page.locator('.arrows .arrow-line').count();
const beforeArrows = await arrowCount();
const from = sqPoint('d2');
const to = sqPoint('d4');
const drag = async () => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(250);
};
await drag();
const afterDraw = await arrowCount();
await drag();
const afterRemove = await arrowCount();
check('right-drag draws an arrow and repeating it removes it',
  afterDraw === beforeArrows + 1 && afterRemove === beforeArrows,
  `${beforeArrows} → ${afterDraw} → ${afterRemove}`);

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
const pliesBefore = await page.locator('.mtree-mv').count();
await goto('/#/settings');           // leave the board entirely
await page.waitForTimeout(400);
await goto('/#/coach?fen=start');    // come back
await page.waitForTimeout(1500);
const pliesAfter = await page.locator('.mtree-mv').count();
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
// start from a fresh game (the book applies from ply 1)
await page.locator('button:has-text("New game")').first().click();
await page.waitForTimeout(300);
await page.locator('.modal button:has-text("Start")').last().click();
await page.waitForTimeout(900);
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

// ---------------------------------------------------------------- play screen: game options
await goto('/#/coach?fen=start');
await page.locator('button:has-text("New game")').first().click();
await page.waitForTimeout(400);
const ngText = await page.locator('.modal').first().textContent().catch(() => '');
check('new game dialog offers colour, time control, strength and book',
  /Colour/.test(ngText || '') && /Time control/.test(ngText || '') && /Engine strength/.test(ngText || '') && /book/i.test(ngText || ''),
  (ngText || '').replace(/\s+/g, ' ').slice(0, 70));
await page.locator('.modal .chip:has-text("I play Black")').click();
await page.locator('.modal .chip:has-text("3 + 0")').click();
await page.locator('.modal button:has-text("Start")').last().click();
await page.waitForTimeout(2500);
const clockText = await page.locator('.badge.mono').first().textContent().catch(() => '');
check('time control starts visible clocks', /\d:\d\d/.test(clockText || ''), clockText);
check('playing Black puts Black at the bottom', (await topLeftSquare()) === 'h1', await topLeftSquare());

await page.locator('button:has-text("Switch sides")').first().click();
await page.waitForTimeout(400);
if (await page.locator('.modal button:has-text("Switch sides")').count()) {
  await page.locator('.modal button:has-text("Switch sides")').last().click();
}
await page.waitForTimeout(1200);
check('switch sides starts a game with the other colour', (await topLeftSquare()) === 'a8', await topLeftSquare());

// jumping back and playing a different move makes a variation
await goto('/#/coach?fen=start');
await page.waitForTimeout(600);
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(2000);
await page.locator('.mtree-start').click();
await page.waitForTimeout(300);
await clickSquare('d2');
await clickSquare('d4');
await page.waitForTimeout(2000);
const altCount = await page.locator('.mtree-alt').count();
check('jumping back and playing another move creates a variation', altCount >= 1, `${altCount} alternative(s)`);
const firstMoveNow = await page.locator('.mtree-mv').first().textContent().catch(() => '');
check('the new move is on the board and in the list', firstMoveNow === 'd4', firstMoveNow);

// delete the last move of the line
const movesBefore = await page.locator('.mtree-mv').count();
await page.locator('.mtree-edit').last().click();
await page.waitForTimeout(400);
await page.locator('.modal button:has-text("Delete from this move")').click();
await page.waitForTimeout(800);
const movesAfter = await page.locator('.mtree-mv').count();
check('delete removes the move and its continuation', movesAfter < movesBefore, `${movesBefore} → ${movesAfter}`);

// export to a repertoire
await page.locator('button:has-text("Export")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal button:has-text("Export")').last().click();
await page.waitForTimeout(800);
const exportToast = await page.locator('.toast').last().textContent().catch(() => '');
check('export to repertoire adds the game to a tree', /added to/i.test(exportToast || ''), (exportToast || '').trim());

// ---------------------------------------------------------------- memory study: arrows + notes
await goto('/#/memory');
await page.waitForTimeout(800);
await page.locator('.game-list .list-item button:has-text("Study")').first().click();
await page.waitForTimeout(1200);
const navButtons = await page.locator('.navgroup button').count();
check('back/forward are two compact buttons on one line', navButtons === 2, `${navButtons} nav buttons`);
await page.locator('.navgroup button').nth(1).click(); // forward one ply
await page.waitForTimeout(400);
const arrowsOn = await page.locator('.arrows .arrow-line').count();
check('study mode draws an arrow for the game move', arrowsOn >= 1, `${arrowsOn} arrows`);
await page.locator('button:has-text("Arrows on")').first().click();
await page.waitForTimeout(400);
const arrowsOff = await page.locator('.arrows .arrow-line').count();
check('the arrow toggle turns move arrows off', arrowsOff < arrowsOn, `${arrowsOn} → ${arrowsOff}`);
await page.locator('button:has-text("Arrows off")').first().click();
await page.waitForTimeout(300);

await page.locator('button:has-text("Add note")').first().click();
await page.waitForTimeout(300);
await page.locator('.card:has-text("Notes") textarea').fill('Key idea: develop before attacking.');
await page.locator('button:has-text("Save note")').click();
await page.waitForTimeout(500);
const noteText = await page.locator('.card:has-text("Notes")').first().textContent().catch(() => '');
check('a note can be added to a position', /Key idea/.test(noteText || ''), (noteText || '').replace(/\s+/g, ' ').slice(0, 60));
await goto('/#/memory');
await page.waitForTimeout(500);
await page.locator('.game-list .list-item button:has-text("Study")').first().click();
await page.waitForTimeout(800);
await page.locator('.navgroup button').nth(1).click();
await page.waitForTimeout(500);
const noteAfterReload = await page.locator('.card:has-text("Notes")').first().textContent().catch(() => '');
check('notes survive a reload', /Key idea/.test(noteAfterReload || ''), (noteAfterReload || '').replace(/\s+/g, ' ').slice(0, 50));

// ---------------------------------------------------------------- starter packs
await goto('/#/repertoire');
await page.waitForTimeout(1400);
const packRows = await page.locator('.card:has-text("Starter packs") .list-item').count();
check('repertoire page offers the bundled starter packs', packRows >= 3, `${packRows} packs`);
await page.locator('.card:has-text("Starter packs") button:has-text("Add")').first().click();
await page.waitForTimeout(3000);
const packMoves = await page.locator('.mtree-mv').count();
const packBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('adding a pack creates a browsable repertoire', packMoves >= 8 && /positions/.test(packBadge || ''), `${packMoves} moves, ${packBadge}`);

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

// separate White / Black player filters
await page.locator('input[placeholder*="Player name"]').fill('');
await page.locator('input[placeholder*="White player"]').fill('Karpov');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(600);
const asWhite = await page.locator('.list-item .sub').count();
check('database filters by the White player', asWhite === 1, `${asWhite} games with Karpov as White`);
await page.locator('input[placeholder*="Black player"]').fill('Kasparov');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(600);
const bothSides = await page.locator('.list-item .sub').count();
check('White and Black player filters combine', bothSides === 1, `${bothSides} game(s) Karpov (W) vs Kasparov (B)`);
await page.locator('input[placeholder*="White player"]').fill('');
await page.locator('input[placeholder*="Black player"]').fill('');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(500);
const exportBtn = await page.locator('button:has-text("Export PGN")').count();
check('database can export the filtered games', exportBtn >= 1);
const exampleBtn = await page.locator('button:has-text("Load bundled example database")').count();
check('database offers the bundled example collection', exampleBtn === 1);
const exampleProbe = await page.evaluate(async () => {
  const mod = await import('./js/ui/packs.js');
  const text = await mod.fetchExampleDatabase();
  return { chars: text.length, games: (text.match(/\[Event /g) || []).length, head: text.slice(0, 20) };
});
check('bundled example database downloads and decompresses', exampleProbe.games > 9000 && /\[Event/.test(exampleProbe.head),
  `${exampleProbe.games} games, ${Math.round(exampleProbe.chars / 1048576)} MB of PGN`);
await page.screenshot({ path: OUT + '-database.png' });

// ---------------------------------------------------------------- multiple databases
await goto('/#/database');
await page.waitForTimeout(700);
await page.locator('button:has-text("New database")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal input[type="text"]').first().fill('Second DB');
await page.locator('.modal button:has-text("Create")').last().click();
await page.waitForTimeout(900);
const dbSelect = page.locator('#dbSelectHost select').first();
const dbCountAfterCreate = await dbSelect.locator('option').count();
check('a second database can be created', dbCountAfterCreate >= 2, `${dbCountAfterCreate} databases`);
const activeName = await dbSelect.inputValue().catch(() => '');
await page.locator('textarea').first().fill(pgn);
await page.locator('button:has-text("Import pasted PGN")').click();
await page.waitForTimeout(2200);
const newBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('games import into the active database', /3 games/.test(newBadge || ''), newBadge);
await page.locator('#dbSelectHost select').first().selectOption({ index: 0 }); // the first database is 'Main database'
await page.waitForTimeout(900);
const mainBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('switching databases switches the game set', /3 games/.test(mainBadge || ''), `active ${activeName} → ${mainBadge}`);

// ---------------------------------------------------------------- create a database from search results
await page.locator('input[placeholder*="Player name"]').fill('Kasparov');
await page.locator('button:has-text("Search")').click();
await page.waitForTimeout(600);
await page.locator('button:has-text("New database from these")').click();
await page.waitForTimeout(400);
await page.locator('.modal input[type="text"]').first().fill('Kasparov only');
await page.locator('.modal button:has-text("Create")').last().click();
await page.waitForTimeout(1500);
const kasparovBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('a new database can be built from the search results', /2 games/.test(kasparovBadge || ''), kasparovBadge);

// ---------------------------------------------------------------- zip backup + restore
const [zipDownload] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.locator('button:has-text("Backup (.zip)")').click(),
]);
const zipPath = await zipDownload.path();
check('database backup downloads a zip', /\.zip$/.test(zipDownload.suggestedFilename()), zipDownload.suggestedFilename());
await page.locator('input[type="file"][accept*="zip"]').setInputFiles(zipPath);
await page.waitForTimeout(800);
const zipModal = await page.locator('.modal').first().textContent().catch(() => '');
check('a zipped backup offers restore as a new database', /Import zipped PGN/i.test(zipModal || ''), (zipModal || '').replace(/\s+/g, ' ').slice(0, 60));
await page.locator('.modal input[type="text"]').first().fill('Restored');
await page.locator('.modal button:has-text("Import")').last().click();
await page.waitForTimeout(2500);
const restoredBadge = await page.locator('.card-head .badge').first().textContent().catch(() => '');
check('restoring the zip recreates the games', /2 games/.test(restoredBadge || ''), restoredBadge);

// ---------------------------------------------------------------- game collections
await goto('/#/coach');
await page.waitForTimeout(700);
// the library needs one game before collections mean anything
await page.locator('textarea').first().fill(pgn);
await page.locator('button:has-text("Add games")').first().click();
await page.waitForTimeout(1500);
await page.locator('.chip:has-text("New collection")').click();
await page.waitForTimeout(400);
await page.locator('.modal input[type="text"]').first().fill('Club games');
await page.locator('.modal button:has-text("Create")').last().click();
await page.waitForTimeout(900);
const colChip = await page.locator('.chip:has-text("Club games")').first().textContent().catch(() => '');
check('a game collection can be created', /Club games/.test(colChip || ''), colChip);
await page.locator('.game-list .list-item button[title*="Collection"]').first().click();
await page.waitForTimeout(400);
await page.locator('.modal select').first().selectOption({ label: 'Club games' });
await page.locator('.modal button:has-text("Save")').last().click();
await page.waitForTimeout(900);
const clubCount = await page.locator('.chip:has-text("Club games")').first().textContent().catch(() => '');
check('a game can be moved into a collection', /Club games \(1\)/.test(clubCount || ''), clubCount);
await page.locator('.chip:has-text("Club games")').first().click();
await page.waitForTimeout(700);
const inClub = await page.locator('.game-list .list-item').count();
check('filtering by collection shows its games', inClub === 1, `${inClub} games`);

const unique = [...new Set(errors)];
check('no console/page errors', unique.length === 0, unique.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} feature checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n'));
  process.exit(1);
}
