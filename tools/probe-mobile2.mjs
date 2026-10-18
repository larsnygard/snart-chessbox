// scratch: measure piece geometry per square on mobile
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8741/#/endgames/kqk-1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const board = document.querySelector('.board');
  const br = board.getBoundingClientRect();
  const sq = (name) => {
    const el = [...document.querySelectorAll('.sq')].find((x) => x.dataset.sq === name);
    const r = el.getBoundingClientRect();
    return { x: +(r.x - br.x).toFixed(1), y: +(r.y - br.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const pieces = [...document.querySelectorAll('.piece')].map((p) => {
    const r = p.getBoundingClientRect();
    const svg = p.querySelector('svg');
    const sr = svg ? svg.getBoundingClientRect() : null;
    return {
      color: p.dataset.color, type: p.dataset.type,
      styleLeft: p.style.left, styleTop: p.style.top,
      px: +(r.x - br.x).toFixed(1), py: +(r.y - br.y).toFixed(1), pw: +r.width.toFixed(1), ph: +r.height.toFixed(1),
      sx: sr ? +(sr.x - br.x).toFixed(1) : null, sy: sr ? +(sr.y - br.y).toFixed(1) : null,
      sw: sr ? +sr.width.toFixed(1) : null, sh: sr ? +sr.height.toFixed(1) : null,
    };
  });
  return { board: { w: br.width, h: br.height }, squares: { e2: sq('e2'), e5: sq('e5'), g1: sq('g1') }, pieces };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
