// scratch: capture mobile rendering at several sizes for inspection
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8741/';
const OUT = '/home/lars/.hermes/cache/scratch/mobile';
const browser = await chromium.launch();
const sizes = [
  { name: 'se-375', width: 375, height: 667, dpr: 2 },
  { name: 'small-360', width: 360, height: 640, dpr: 3 },
  { name: 'android-412', width: 412, height: 915, dpr: 2.6 },
];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: true, hasTouch: true });
  await page.goto(BASE + '#/endgames/kqk-1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${s.name}-drill.png` });
  // crop the board area
  const box = await page.locator('.board').boundingBox();
  console.log(s.name, 'board box', JSON.stringify(box));
  if (box) await page.screenshot({ path: `${OUT}/${s.name}-board.png`, clip: box });
  const metrics = await page.evaluate(() => {
    const b = document.querySelector('.board');
    const p = document.querySelector('.piece');
    const svg = document.querySelector('.piece svg');
    const r = b.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    return {
      boardW: Math.round(r.width), boardH: Math.round(r.height),
      pieceW: pr.width.toFixed(1), pieceH: pr.height.toFixed(1),
      svgW: sr.width.toFixed(1), svgH: sr.height.toFixed(1),
      dpr: window.devicePixelRatio, vw: window.innerWidth,
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log(s.name, JSON.stringify(metrics));
  await page.close();
}
await browser.close();
