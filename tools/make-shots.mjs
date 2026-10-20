// tools/make-shots.mjs — capture the screenshots used by the README and the
// PWA install dialog. Real app state, real viewports — never mocked pixels.
//
// usage: node tools/make-shots.mjs [baseUrl]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const puzzles = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8')).puzzles;
const mate2 = puzzles.find((p) => (p.themes || []).includes('mateIn2') && p.fen.split(' ')[1] === 'w');

const browser = await chromium.launch();

async function shot(page, hash, file, waitMs = 1200) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: OUT + file });
  console.log('wrote', file);
}

// desktop
const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await shot(desktop, '/#/home', 'desktop-home.png', 1500);
await shot(desktop, '/#/endgames/krk-1', 'desktop-endgame.png', 2000);
await shot(desktop, '/#/puzzles?single=' + mate2.id, 'desktop-puzzle.png', 1500);
await shot(desktop, '/#/memory', 'desktop-memory.png', 1200);

// the analysis board: engine on, its three moves listed with W/D/L
await desktop.goto('about:blank');
await desktop.goto(BASE + '#/analyse', { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await desktop.waitForTimeout(900);
await desktop.locator('.board-tools .engine-switch').first().click();
await desktop.waitForFunction(() => document.querySelectorAll('.engine-moves .em-row').length >= 3, null, { timeout: 45000 }).catch(() => {});
await desktop.waitForTimeout(900);
await desktop.screenshot({ path: OUT + 'desktop-analyse.png' });
console.log('wrote desktop-analyse.png');

// the position editor: a half-built position with the palette in use
await desktop.goto('about:blank');
await desktop.goto(BASE + '#/analyse', { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await desktop.waitForTimeout(700);
await desktop.locator('button:has-text("Set up")').first().click();
await desktop.waitForSelector('.setup-board', { timeout: 5000 }).catch(() => {});
await desktop.locator('button:has-text("Empty board")').first().click();
await desktop.waitForTimeout(250);
const put = async (tool, sq) => {
  await desktop.locator(`.setup-tool[data-tool="${tool}"]`).click();
  const box = await desktop.locator('.setup-board .board-squares').boundingBox();
  const col = 'abcdefgh'.indexOf(sq[0]);
  const rank = parseInt(sq[1], 10);
  await desktop.mouse.click(box.x + (col + 0.5) * (box.width / 8), box.y + (8 - rank + 0.5) * (box.height / 8));
  await desktop.waitForTimeout(90);
};
await put('wk', 'e1');
await put('wp', 'a7');
await put('wp', 'c7');
await put('bk', 'e8');
await put('br', 'h8');
await desktop.locator('.setup-tool[data-tool="move"]').click();
await desktop.waitForTimeout(250);
await desktop.screenshot({ path: OUT + 'desktop-setup.png' });
console.log('wrote desktop-setup.png');


// simultan needs a started session: start 4 boards and play one move
await desktop.goto('about:blank');
await desktop.goto(BASE + '#/simultan', { waitUntil: 'domcontentloaded' });
await desktop.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
await desktop.waitForTimeout(700);
await desktop.locator('.chip:has-text("4 boards")').first().click();
await desktop.locator('button:has-text("Start simultan")').first().click();
await desktop.waitForTimeout(1500);
const bb = await desktop.locator('.board .board-squares').first().boundingBox();
const click = async (sq) => {
  const f = 'abcdefgh'.indexOf(sq[0]); const rk = parseInt(sq[1], 10);
  await desktop.mouse.click(bb.x + (f + 0.5) * (bb.width / 8), bb.y + (8 - rk + 0.5) * (bb.height / 8));
  await desktop.waitForTimeout(150);
};
await click('e2'); await click('e4');
await desktop.waitForTimeout(2600);
await desktop.screenshot({ path: OUT + 'desktop-simultan.png' });
console.log('wrote desktop-simultan.png');
await desktop.close();

// mobile (2x for crisp store/README rendering → 780x1688)
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await shot(mobile, '/#/home', 'mobile-home.png', 1500);
await shot(mobile, '/#/endgames/kqk-1', 'mobile-endgame.png', 2000);
await mobile.close();

await browser.close();
