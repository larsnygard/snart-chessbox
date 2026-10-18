import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto('http://127.0.0.1:8741/#/endgames/kqk-1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);
const out = await page.evaluate(() => {
  return [...document.querySelectorAll('.piece')].map((p) => {
    const svg = p.querySelector('svg');
    const path = svg.querySelector('path');
    const pr = p.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const ir = path.getBoundingClientRect();
    return {
      piece: p.dataset.color + p.dataset.type,
      pieceBox: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
      svgBox: [Math.round(sr.x), Math.round(sr.y), Math.round(sr.width), Math.round(sr.height)],
      inkBox: [Math.round(ir.x), Math.round(ir.y), Math.round(ir.width), Math.round(ir.height)],
      marginL: Math.round(ir.x - sr.x), marginT: Math.round(ir.y - sr.y),
      marginR: Math.round(sr.x + sr.width - (ir.x + ir.width)),
      marginB: Math.round(sr.y + sr.height - (ir.y + ir.height)),
    };
  });
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
