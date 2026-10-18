// tools/browser-check.mjs — end-to-end verification in a real browser.
//
// Covers: boot without console errors, every screen renders, board interaction
// produces engine replies, a puzzle can be solved by clicking squares, the
// service worker installs, the app is installable, and the app still works with
// the network switched off.
//
// usage: NODE_PATH=~/.hermes/hermes-agent/node_modules node tools/browser-check.mjs [baseUrl]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const OUT = process.env.OUT || '/home/lars/.hermes/cache/scratch/shots';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function goto(hash) {
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function clickSquare(sq) {
  const box = await page.locator('.board .board-squares').first().boundingBox();
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10);
  const x = box.x + (col + 0.5) * (box.width / 8);
  const y = box.y + (8 - rank + 0.5) * (box.height / 8);
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}

// ---- 1. boot
await goto('/');
const navCount = await page.locator('#sidenav .nav-item').count();
check('boots and renders navigation', navCount >= 9, `${navCount} nav items`);
const bootGone = await page.locator('#boot').count();
check('boot overlay removed', bootGone === 0);
await page.screenshot({ path: OUT + '/desktop-home.png' });

// engine warm-up
const engineReady = await page.waitForFunction(
  () => /ready|failed/i.test(document.getElementById('engineState')?.textContent || ''),
  null, { timeout: 45000 }).then(() => true).catch(() => false);
const engineText = await page.locator('#engineState').textContent();
check('stockfish worker starts', engineReady && /ready/i.test(engineText), engineText);

// engine internals: MultiPV must really be enabled — a newline-joined setoption
// string leaves the engine at MultiPV 1 and the eval-spread setting silently
// becomes "always play the best move".
const engineDeep = await page.evaluate(async () => {
  const { Engine } = await import('./js/ui/engine.js');
  const eng = new Engine();
  await eng.start();
  const pos = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4';
  const res = await eng.analyse({ fen: pos, movetime: 500, multipv: 4 });
  const picks = new Set();
  for (let i = 0; i < 12; i++) {
    const p = await eng.pickMove({ fen: pos, movetime: 220, spreadCp: 120 });
    picks.add(p.uci);
  }
  const wide = await eng.analyse({ fen: pos, movetime: 150, multipv: 1, elo: 1000 });
  return { lines: res.lines.length, moves: res.lines.map((l) => l.move), picks: [...picks], weakLines: wide.lines.length, weakMove: wide.lines[0] && wide.lines[0].move };
});
check('engine returns a MultiPV list (spread feature is live)', engineDeep.lines >= 3 && new Set(engineDeep.moves).size >= 3,
  `${engineDeep.lines} lines: ${engineDeep.moves.join(',')}`);
check('eval-spread selection actually varies the move', engineDeep.picks.length >= 2,
  `picked ${engineDeep.picks.join(',')}`);
check('weak-strength search still returns a move', !!engineDeep.weakMove, String(engineDeep.weakMove));

// ---- 1b. version footer + about page
const buildInfo = await page.locator('#buildInfo').textContent().catch(() => '');
check('sidebar shows the version and channel', /v\d+\.\d+\.\d+/.test(buildInfo || '') && /beta/.test(buildInfo || ''), (buildInfo || '').replace(/\s+/g, ' ').trim());
await goto('/#/about');
const aboutText = await page.locator('.content').first().textContent().catch(() => '');
check('About page shows version, beta status and release notes',
  /v1\.\d+\.\d+/.test(aboutText || '') && /beta/i.test(aboutText || '') && /Release notes/.test(aboutText || '') && /Licences/.test(aboutText || ''),
  (aboutText || '').replace(/\s+/g, ' ').slice(0, 80));

// ---- 2. screens
const screens = [
  ['#/openings', 'Opening database'],
  ['#/endgames', 'Endgame technique'],
  ['#/puzzles', 'Puzzle trainer'],
  ['#/memory', 'Learn a game by heart'],
  ['#/coach', 'Import your games'],
  ['#/sets', 'Exercise sets'],
  ['#/repertoire', 'Your repertoire'],
  ['#/settings', 'Settings'],
  ['#/about', 'Release notes'],
];
for (const [hash, text] of screens) {
  await goto(hash);
  const found = await page.locator(`text=${text}`).count();
  check(`screen ${hash} renders`, found > 0);
}

// ---- 3. opening training: the opponent's first move autoplays
await goto('/#/openings/' + encodeURIComponent('C50:italian-game') + '?side=w');
await page.waitForTimeout(600);
const openingTitle = await page.locator('.trainer').count();
check('opening trainer mounts', openingTitle > 0);
const statusBefore = await page.locator('.board-status').first().textContent();
check('opening trainer waits for the user move', /your move/i.test(statusBefore), statusBefore);

// ---- 4. endgame drill: a legal user move gets an engine reply
await goto('/#/endgames/kqk-1');
await page.waitForTimeout(1200);
await clickSquare('g1');
await clickSquare('g3');
await page.waitForTimeout(2500);
const movesText = await page.locator('.movelist').first().textContent();
check('engine replies in an endgame drill', /Qg3/.test(movesText) && /K[a-h][1-8]/.test(movesText), movesText.trim().slice(0, 60));

// move-list navigation on a live drill
await page.locator('.navgroup button').nth(1).click();
await page.waitForTimeout(300);
const backStatus = await page.locator('.board-status').first().textContent().catch(() => '');
check('move-list back arrow reviews the previous ply', /Reviewing ply/i.test(backStatus || ''), (backStatus || '').trim().slice(0, 50));
await page.locator('.navgroup button').nth(3).click();
await page.waitForTimeout(300);
const liveStatus = await page.locator('.board-status').first().textContent().catch(() => '');
check('move-list forward-to-end returns to the live position', /Your move|thinking/i.test(liveStatus || ''), (liveStatus || '').trim().slice(0, 40));

// ---- 4b. the board strip: eval bar + engine switch + play-from-here
const hasTools = await page.locator('.board-tools').count();
const hasEvalBar = await page.locator('.evalbar').count();
const playFromHere = await page.locator('button:has-text("Play engine from here")').count();
check('every board carries the tool strip (eval bar, engine, play-from-here)', hasTools >= 1 && hasEvalBar >= 1 && playFromHere >= 1,
  `tools ${hasTools}, bars ${hasEvalBar}, play buttons ${playFromHere}`);
await page.locator('button:has-text("Engine: off")').first().click();
const evalUpdated = await page.waitForFunction(() => {
  const t = document.querySelector('.eval-text');
  return t && t.textContent && t.textContent !== '—' && t.textContent.trim().length > 0;
}, null, { timeout: 20000 }).then(() => true).catch(() => false);
const evalTextNow = await page.locator('.eval-text').first().textContent().catch(() => '');
check('engine switch fills the eval bar', evalUpdated, evalTextNow);
const engineArrows = await page.locator('.arrows .arrow-line').count();
check('engine draws its best move as an arrow', engineArrows >= 1, `${engineArrows} arrows`);

// ---- 5. puzzles: solve a real mate-in-1 by clicking the solution
const puzzleData = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const mate1 = puzzleData.puzzles.find((p) => (p.themes || []).includes('mateIn1') && p.sol.length === 1 && p.fen.split(' ')[1] === 'w');
await goto('/#/puzzles?single=' + mate1.id);
await page.waitForTimeout(500);
await clickSquare(mate1.sol[0].slice(0, 2));
await clickSquare(mate1.sol[0].slice(2, 4));
await page.waitForTimeout(900);
const feedback = await page.locator('.feedback').first().textContent();
check('puzzle solved by playing the solution', /solved/i.test(feedback || ''), (feedback || '').trim().slice(0, 60));
const puzzleEngine = await page.locator('.board-tools button:has-text("Engine: off")').count();
check('puzzles keep the engine hidden (no spoilers)', puzzleEngine === 0, `${puzzleEngine} engine switches`);
await page.screenshot({ path: OUT + '/desktop-puzzle.png' });

// ---- 5b. simultan (parallel board exhibition)
await goto('/#/simultan');
await page.getByRole('button', { name: /Start simultan/ }).click();
await page.waitForTimeout(1800);
const boardsListed = await page.locator('.side-col .list .list-item').count();
check('simultan starts the requested number of boards', boardsListed >= 3, `${boardsListed} boards`);
await clickSquare('e2');
await clickSquare('e4');
await page.waitForTimeout(5000);
const simulStatus = await page.locator('.board-status').first().textContent().catch(() => '');
const simulList = await page.locator('.side-col .list').first().textContent().catch(() => '');
check('simultan engine answers while you are on other boards', /your move/i.test(simulStatus || '') && /\d+ moves/.test(simulList || ''),
  `${(simulStatus || '').trim().slice(0, 24)} | ${(simulList || '').replace(/\s+/g, ' ').slice(0, 44)}`);
// switching boards: pick board 2 from the list (the focused board also
// auto-advances after each move, so 'Next' is not deterministic here)
await page.locator('.side-col .list .list-item').nth(1).click();
await page.waitForTimeout(500);
const boardLabel = await page.locator('.board-col strong').first().textContent().catch(() => '');
const chipSel = await page.locator('.side-col .list .list-item.sel').count();
check('simultan switches between boards', /Board 2/.test(boardLabel || '') && chipSel === 1, `${boardLabel}, ${chipSel} selected`);

const navLabels = await page.locator('#sidenav .nav-item').allTextContents();
const iP = navLabels.findIndex((t) => /Puzzle/i.test(t));
const iS = navLabels.findIndex((t) => /Simultan/i.test(t));
const iM = navLabels.findIndex((t) => /Memory/i.test(t));
check('Simultan sits between Puzzles and Memory in the menu', iS === iP + 1 && iM === iS + 1, navLabels.join(' | '));

// ---- 5c. branding
const docTitle = await page.title();
const brand = await page.locator('.brand-name').first().textContent().catch(() => '');
check('app is named SnartChessBox', /SnartChessBox/.test(docTitle) && brand === 'SnartChessBox', `${docTitle} / ${brand}`);

// ---- 6. settings: change the spread and board theme, then reload to prove persistence
await goto('/#/settings');
await page.locator('select').first().selectOption('softmax').catch(() => {});
await page.waitForTimeout(500);
const stored = await page.evaluate(async () => {
  // open without a version: the schema version is an implementation detail
  const db = await new Promise((res) => { const r = indexedDB.open('snart-chessbox'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); });
  if (!db) return null;
  return await new Promise((res) => {
    const q = db.transaction('kv', 'readonly').objectStore('kv').get('settings');
    q.onsuccess = () => res(q.result);
    q.onerror = () => res(null);
  });
});
check('settings persist to IndexedDB', !!stored && stored.spreadWeighting === 'softmax', JSON.stringify(stored && stored.spreadWeighting));

// ---- 7. mobile viewport
await page.setViewportSize({ width: 390, height: 844 });
await goto('/#/puzzles');
const bottomNav = await page.locator('#bottomnav button').count();
const bottomVisible = await page.locator('#bottomnav').isVisible();
check('mobile bottom navigation visible', bottomVisible && bottomNav >= 5, `${bottomNav} buttons`);
const sidebarHidden = await page.locator('.sidebar').isVisible();
check('sidebar hidden on mobile', !sidebarHidden);
await page.screenshot({ path: OUT + '/mobile-puzzles.png' });

// ---- 8. service worker + installability
await page.setViewportSize({ width: 1366, height: 900 });
await goto('/');
await page.waitForTimeout(1200);
const swState = await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  return { count: regs.length, active: regs.some((r) => r.active && r.active.state === 'activated') };
});
check('service worker registered and activated', swState.active, JSON.stringify(swState));

const cacheInfo = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cache = await caches.open(keys[0]);
  const reqs = await cache.keys();
  return { keys, entries: reqs.length, hasWasm: reqs.some((r) => r.url.includes('stockfish-19-lite-single.wasm')), hasPuzzles: reqs.some((r) => r.url.includes('puzzles.json')) };
});
check('app shell precached (engine + data)', cacheInfo.entries > 30 && cacheInfo.hasWasm && cacheInfo.hasPuzzles, JSON.stringify({ entries: cacheInfo.entries }));

const cdp = await context.newCDPSession(page);
const manifestInfo = await cdp.send('Page.getAppManifest').catch(() => null);
const installErrors = await cdp.send('Page.getInstallabilityErrors').catch(() => null);
check('manifest parsed by Chromium', !!manifestInfo && (manifestInfo.errors || []).length === 0, JSON.stringify(manifestInfo && manifestInfo.errors));
check('installability errors empty', !!installErrors && (installErrors.installabilityErrors || []).length === 0,
  JSON.stringify(installErrors && installErrors.installabilityErrors));

// ---- 9. offline
await context.setOffline(true);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(800);
const offlineNav = await page.locator('#sidenav .nav-item').count();
await goto('/#/puzzles');
const offlinePuzzles = await page.locator('.chip').count();
check('works offline: UI renders', offlineNav >= 9, `${offlineNav} nav items`);
check('works offline: datasets load', offlinePuzzles > 5, `${offlinePuzzles} filter chips`);
await page.screenshot({ path: OUT + '/offline-home.png' });
await context.setOffline(false);

// ---- report
const uniqueErrors = [...new Set(errors)];
check('no console/page errors', uniqueErrors.length === 0, uniqueErrors.slice(0, 4).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n'));
  process.exit(1);
}
