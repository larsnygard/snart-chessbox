// tools/probe-elo.mjs — the White/Black Elo filters on the PGN database.
//
// Imports a small collection with Elo headers, then checks the ranges the user
// asked for (2000-2300, 2700+), that the ratings show in the result rows, and the
// backfill path: re-importing the same games *without* ratings first and *with*
// them second fills the ratings in instead of dropping them as duplicates.
//
// usage: node tools/probe-elo.mjs [baseUrl]
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:8741/';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const headers = (white, black, result, date = '2020.01.01') => `[Event "Elo test"]
[Site "?"]
[Date "${date}"]
[Round "1"]
[White "${white}"]
[Black "${black}"]
[Result "${result}"]`;

const games = [
  { white: 'Kasparov, Garry', black: 'Karpov, Anatoly', w: 2851, b: 2780, result: '1-0', moves: '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0' },
  { white: 'Amateur, Andy', black: 'Club, Cathy', w: 2100, b: 2200, result: '1/2-1/2', moves: '1. d4 d5 2. c4 e6 1/2-1/2' },
  { white: 'Master, Mia', black: 'Champ, Charlie', w: 2400, b: 2700, result: '0-1', moves: '1. c4 e5 2. Nc3 Nf6 0-1' },
];
const pgn = (withElo) => games.map((g) => `${headers(g.white, g.black, g.result)}${withElo ? `\n[WhiteElo "${g.w}"]\n[BlackElo "${g.b}"]` : ''}\n\n${g.moves}`).join('\n\n');

async function goto(hash) {
  await page.goto('about:blank');
  await page.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function importText(text) {
  const area = page.locator('.card textarea').first();
  await area.fill(text);
  await page.locator('button:has-text("Import pasted PGN")').click();
  await page.waitForFunction((n) => /Imported|duplicates|skipped/.test(document.querySelector('.card .dim + div, .card .faint')?.textContent || document.body.textContent) || true, null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => (document.querySelector('.card .badge') || {}).textContent || '');
}

const resultHead = () => page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].map((e) => e.textContent).find((t) => /found/.test(t));
  return h || '';
});

async function search({ whiteFrom = '', whiteTo = '', blackFrom = '', blackTo = '' } = {}) {
  const wf = page.locator('label.field:has-text("White Elo") input').nth(0);
  const wt = page.locator('label.field:has-text("White Elo") input').nth(1);
  const bf = page.locator('label.field:has-text("Black Elo") input').nth(0);
  const bt = page.locator('label.field:has-text("Black Elo") input').nth(1);
  await wf.fill(String(whiteFrom));
  await wt.fill(String(whiteTo));
  await bf.fill(String(blackFrom));
  await bt.fill(String(blackTo));
  await page.locator('button:has-text("Search")').first().click();
  await page.waitForTimeout(700);
  return resultHead();
}

const rows = () => page.$$eval('.game-list .list-item .name', (els) => els.map((e) => e.textContent.trim()));

await goto('#/database');
check('the database screen has White and Black Elo filters',
  (await page.locator('label.field:has-text("White Elo")').count()) === 1
  && (await page.locator('label.field:has-text("Black Elo")').count()) === 1);

// ---- 1. the same games, imported first without ratings
await importText(pgn(false));
let head = await resultHead();
check('an unrated collection imports', /3 games/.test(head), head);
const hint = await page.evaluate(() => [...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /no rating/.test(t)) || '');
check('the filter says how many games carry no rating', /3 of 3 games have no rating/.test(hint), hint.slice(0, 80));

head = await search({ whiteFrom: 2700 });
check('a rating filter finds nothing when no game has a rating', /0 games/.test(head), head);
const emptyMsg = await page.evaluate(() => (document.querySelector('.empty') || {}).textContent || '');
check('the empty result explains why and how to fix it', /no rating/i.test(emptyMsg) && /again fills them in/i.test(emptyMsg), emptyMsg.slice(0, 120));

// ---- 2. re-importing the same PGN with Elo headers backfills the ratings
await importText(pgn(true));
const afterReimport = await page.evaluate(() => ({
  info: (document.querySelector('.import-info') || {}).textContent || '',
  hint: [...document.querySelectorAll('.faint')].map((e) => e.textContent).find((t) => /no rating/.test(t)) || '',
}));
check('re-import reports the ratings it filled in',
  /ratings updated on 3/.test(afterReimport.info), afterReimport.info.trim());
check('the "no rating" warning disappears once they are filled in', afterReimport.hint === '', afterReimport.hint.slice(0, 60));

head = await search({});
check('all three games are still there (no duplicates added)', /3 games/.test(head), head);
check('the result rows show the ratings', (await rows()).some((t) => /Kasparov, Garry \(2851\)/.test(t)), (await rows()).join(' | ').slice(0, 90));

// ---- 3. the ranges the user asked for
head = await search({ whiteFrom: 2000, whiteTo: 2300 });
check('White 2000-2300 selects exactly that game', /1 game/.test(head) && (await rows()).some((t) => /Amateur, Andy \(2100\)/.test(t)), `${head} · ${(await rows()).join(' | ')}`);

head = await search({ whiteFrom: 2700 });
check('White 2700+ selects only the 2851 game', /1 game/.test(head) && (await rows()).some((t) => /Kasparov/.test(t)), `${head} · ${(await rows()).join(' | ')}`);

head = await search({ blackFrom: 2700 });
check('Black 2700+ keeps both games with a 2700+ black player',
  /2 games/.test(head) && (await rows()).some((t) => /Champ, Charlie \(2700\)/.test(t)) && (await rows()).some((t) => /Karpov, Anatoly \(2780\)/.test(t)),
  `${head} · ${(await rows()).join(' | ')}`);

head = await search({ whiteFrom: 2400, blackFrom: 2400, blackTo: 2750 });
check('both colours can be bounded at once (White 2400+, Black 2400-2750)', /1 game/.test(head) && (await rows()).some((t) => /Champ/.test(t)),
  `${head} · ${(await rows()).join(' | ')}`);

head = await search({ whiteTo: 2200 });
check('an upper bound alone works', /1 game/.test(head) && (await rows()).some((t) => /Amateur/.test(t)), `${head} · ${(await rows()).join(' | ')}`);

head = await search({});
check('clearing the ranges brings all games back', /3 games/.test(head), head);

// ---- 4. the filters persist into "new database from these"
await search({ whiteFrom: 2700 });
const newDbName = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => /New database from these/.test(b.textContent));
  return btn ? btn.disabled : null;
});
check('the filtered set can still be copied to its own database', newDbName === false, String(newDbName));

check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
