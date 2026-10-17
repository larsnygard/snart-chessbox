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
await desktop.close();

// mobile (2x for crisp store/README rendering → 780x1688)
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await shot(mobile, '/#/home', 'mobile-home.png', 1500);
await shot(mobile, '/#/endgames/kqk-1', 'mobile-endgame.png', 2000);
await mobile.close();

await browser.close();
