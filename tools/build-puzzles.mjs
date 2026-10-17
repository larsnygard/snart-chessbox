#!/usr/bin/env node
/**
 * build-puzzles.mjs -- build data/puzzles.json for SnartChessTrainer from the
 * official Lichess puzzle database.
 *
 *   Source : https://database.lichess.org/lichess_db_puzzle.csv.zst  (CC0-1.0)
 *   Dataset: Lichess puzzle DB, streamed (never fully loaded into memory)
 *
 * Requirements: node >= 18 (global fetch), `zstd` on PATH, and the vendored
 * ../vendor/chess.mjs (chess.js, ESM). Nothing else.
 *
 * Lichess convention: the FEN is the position BEFORE the opponent's forcing
 * move, and Moves[0] is that move. The position the solver sees is therefore
 * FEN + Moves[0]; the solution is Moves[1..]. This script applies Moves[0],
 * then replays every solution move through chess.js as a legal UCI move and
 * records the SAN of each ply. Any puzzle that fails validation is dropped.
 *
 * Usage:
 *   node tools/build-puzzles.mjs [--rows 150000] [--out data/puzzles.json]
 *                                [--csv /path/to/lichess_db_puzzle.csv.zst]
 *                                [--refetch]
 *
 * Env: LICHESS_CSV overrides the csv path, PUZZLE_CACHE dir overrides the
 * download directory (default: $TMPDIR/snart-puzzles).
 */

import { Chess, validateFen } from '../vendor/chess.mjs';
import { createWriteStream, mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CSV_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

/** Theme coverage, in priority order. Each theme gets up to PER_THEME puzzles. */
const THEMES = [
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'backRankMate', 'smotheredMate',
  'doubleCheck', 'fork', 'pin', 'skewer', 'discoveredAttack', 'sacrifice',
  'hangingPiece', 'promotion', 'endgame', 'defensiveMove', 'zugzwang',
  'trappedPiece', 'attraction', 'clearance',
];
const PER_THEME = 90;
const MAX_THEMES_PER_PUZZLE = 3; // keep "themes" arrays short
const MIN_TOTAL = 1000;
const MAX_TOTAL = 1800;

/** Preference tiers: [popularity, nbPlays, ratingMin, ratingMax] */
const TIERS = [
  { name: 'A', pop: 80, plays: 300, min: 600, max: 2200 },
  { name: 'B', pop: 60, plays: 150, min: 500, max: 2400 },
  { name: 'C', pop: 0, plays: 0, min: 400, max: 2600 },
];
const BUCKET_CAP = 220; // per theme per tier, bounds memory

// ---------------------------------------------------------------- args ----

function parseArgs(argv) {
  const opts = {
    rows: 150000,
    out: resolve(ROOT, 'data/puzzles.json'),
    csv: process.env.LICHESS_CSV || null,
    refetch: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rows') opts.rows = Number(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--csv') opts.csv = resolve(argv[++i]);
    else if (a === '--refetch') opts.refetch = true;
    else if (a === '--help' || a === '-h') {
      console.log('see header of tools/build-puzzles.mjs for usage');
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!opts.csv) {
    const cache = resolve(process.env.PUZZLE_CACHE || tmpdir(), 'snart-puzzles');
    opts.csv = resolve(cache, 'lichess_db_puzzle.csv.zst');
  }
  return opts;
}

// ------------------------------------------------------------ download ----

async function ensureCsv(path, refetch) {
  if (!refetch && existsSync(path) && statSync(path).size > 1e6) return path;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + '.part';
  console.error(`downloading ${CSV_URL} -> ${path}`);
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const { renameSync } = await import('node:fs');
  renameSync(tmp, path);
  console.error(`downloaded ${(statSync(path).size / 1e6).toFixed(1)} MB`);
  return path;
}

// ------------------------------------------------------- chess helpers ----

const PROMO = { q: 'q', r: 'r', b: 'b', n: 'n' };

/** Apply one UCI move on `chess`; returns the move object or null. */
function applyUci(chess, uci) {
  if (typeof uci !== 'string' || (uci.length !== 4 && uci.length !== 5)) return null;
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const promo = uci.length === 5 ? uci[4].toLowerCase() : null;
  if (promo && !PROMO[promo]) return null;
  const legal = chess.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!legal.length) return null;
  let pick;
  if (legal.length === 1 && !legal[0].promotion) pick = legal[0];
  else if (promo) pick = legal.find((m) => m.promotion === promo);
  else pick = legal.find((m) => m.promotion === 'q') || legal[0];
  if (!pick) return null;
  try {
    return chess.move({ from: pick.from, to: pick.to, promotion: pick.promotion });
  } catch {
    return null;
  }
}

/**
 * Validate one CSV row. Returns {id, fen, sol, san, themes, rating} for the
 * solver's position, or null when anything is off.
 */
function validateRow(row, themeList) {
  const { PuzzleId, FEN, Moves, Rating } = row;
  if (!PuzzleId || !FEN || !Moves) return null;
  const moves = Moves.trim().split(/\s+/);
  if (moves.length < 2) return null;      // need setup move + >=1 solution move
  if (moves.length > 9) return null;      // sanity: solutions are short

  if (validateFen(FEN).ok !== true) return null;

  let chess;
  try { chess = new Chess(FEN); } catch { return null; }

  // The opponent's forcing move, which the solver never plays.
  const setup = applyUci(chess, moves[0]);
  if (!setup) return null;

  // Position the solver actually sees.
  let solverFen;
  try { solverFen = chess.fen(); } catch { return null; }
  if (validateFen(solverFen).ok !== true) return null;

  const sol = [];
  const san = [];
  for (let i = 1; i < moves.length; i++) {
    const mv = applyUci(chess, moves[i]);
    if (!mv || !mv.san) return null;       // illegal / unrepresentable move
    sol.push(moves[i]);
    san.push(mv.san);
  }
  if (!sol.length) return null;

  // Final position must round-trip through chess.js.
  let finalFen;
  try { finalFen = chess.fen(); } catch { return null; }
  if (validateFen(finalFen).ok !== true) return null;
  try { new Chess(finalFen); } catch { return null; }

  // The stored position must be legal, with the solver to move and able to move.
  try {
    const check = new Chess(solverFen);
    if (!check.moves().length) return null;
    if (check.turn() !== solverFen.split(' ')[1]) return null;
  } catch { return null; }

  const all = (row.Themes || '').trim().split(/\s+/).filter(Boolean);
  const themes = themeList.filter((t) => all.includes(t)).slice(0, MAX_THEMES_PER_PUZZLE);

  return {
    id: PuzzleId,
    fen: solverFen,
    sol,
    san,
    themes,
    rating: Math.round(Number(Rating)),
  };
}

// --------------------------------------------------------------- main ----

function parseLine(line, header) {
  // No quoted fields with embedded commas appear in this dataset; split plainly.
  const f = line.split(',');
  if (f.length < header.length - 1) return null;
  const row = {};
  for (let i = 0; i < header.length; i++) row[header[i]] = f[i];
  return row;
}

function withinTier(row, tier) {
  const pop = Number(row.Popularity), plays = Number(row.NbPlays), rating = Number(row.Rating);
  if (!Number.isFinite(rating)) return null;
  if (pop < tier.pop || plays < tier.plays) return null;
  if (rating < tier.min || rating > tier.max) return null;
  return rating;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const csv = await ensureCsv(opts.csv, opts.refetch);

  /** bucket theme -> tierName -> [rowIndex] and parallel row store */
  const rows = [];
  const buckets = new Map(THEMES.map((t) => [t, { A: [], B: [], C: [] }]));
  let seen = 0, skippedEarly = 0;

  const zstd = spawn('zstd', ['-dc', csv], { stdio: ['ignore', 'pipe', 'pipe'] });
  let zstdErr = '';
  zstd.stderr.on('data', (d) => { zstdErr += d.toString(); });
  let zstdExit = null;
  zstd.on('close', (code) => { zstdExit = code; });
  zstd.on('error', (e) => { throw new Error(`cannot run zstd: ${e.message}`); });
  const rl = createInterface({ input: zstd.stdout, crlfDelay: Infinity });

  let header = null;
  for await (const line of rl) {
    if (!header) {
      header = line.trim().split(',');
      if (header[0] !== 'PuzzleId' || !header.includes('Themes')) {
        throw new Error('unexpected CSV header: ' + line.slice(0, 120));
      }
      continue;
    }
    if (!line) continue;
    if (seen >= opts.rows) break;
    seen++;
    const row = parseLine(line, header);
    if (!row) { skippedEarly++; continue; }

    const tierHits = {};
    let any = false;
    for (const t of TIERS) {
      if (withinTier(row, t) !== null) { tierHits[t.name] = true; any = true; }
    }
    if (!any) { skippedEarly++; continue; }

    const themes = (row.Themes || '').split(/\s+/).filter((t) => buckets.has(t));
    if (!themes.length) { skippedEarly++; continue; }

    const idx = rows.length;
    rows.push(row);
    for (const t of themes) {
      const b = buckets.get(t);
      for (const tn of Object.keys(tierHits)) {
        if (b[tn].length < BUCKET_CAP) b[tn].push(idx);
      }
    }
  }
  rl.close();
  try { zstd.kill(); } catch {}

  if (seen === 0) {
    throw new Error(`zstd produced no usable data (exit ${zstdExit}): ${zstdErr.trim() || 'empty input'}`);
  }

  console.error(`scanned ${seen} rows (${skippedEarly} skipped early), ${rows.length} candidates`);

  // ------------------------------------------------------- allocation ----
  const chosen = [];
  const used = new Set();
  const themeCount = Object.fromEntries(THEMES.map((t) => [t, 0]));

  const tryAccept = (row, preferTheme) => {
    if (used.has(row.PuzzleId)) return false;
    const validated = validateRow(row, THEMES);
    if (!validated) return false;
    if (!validated.themes.length) validated.themes = [preferTheme];
    if (!validated.themes.includes(preferTheme)) validated.themes.unshift(preferTheme);

    // Keep the advertised themes that still have room; always keep preferTheme.
    const keep = [];
    for (const t of validated.themes) {
      if (t === preferTheme || themeCount[t] < PER_THEME) keep.push(t);
    }
    if (!keep.length) return false;
    if (themeCount[preferTheme] >= PER_THEME && !keep.includes(preferTheme)) return false;

    validated.themes = keep.slice(0, MAX_THEMES_PER_PUZZLE);
    for (const t of validated.themes) themeCount[t]++;
    used.add(validated.id);
    chosen.push(validated);
    return true;
  };

  for (const tier of ['A', 'B', 'C']) {
    for (const theme of THEMES) {
      if (themeCount[theme] >= PER_THEME) continue;
      const list = buckets.get(theme)[tier];
      for (const idx of list) {
        if (themeCount[theme] >= PER_THEME) break;
        tryAccept(rows[idx], theme);
      }
    }
  }

  // Top-up pass: if we are still short of MIN_TOTAL because puzzles matched
  // several themes and consumed several slots, relax to one theme per puzzle.
  if (chosen.length < MIN_TOTAL) {
    for (const tier of ['A', 'B', 'C']) {
      for (const theme of THEMES) {
        if (chosen.length >= MAX_TOTAL) break;
        const list = buckets.get(theme)[tier];
        for (const idx of list) {
          if (chosen.length >= MAX_TOTAL || themeCount[theme] >= PER_THEME) break;
          const row = rows[idx];
          if (used.has(row.PuzzleId)) continue;
          const v = validateRow(row, THEMES);
          if (!v) continue;
          v.themes = [theme];
          themeCount[theme]++;
          used.add(v.id);
          chosen.push(v);
        }
      }
    }
  }

  // Stable, readable ordering: theme priority, then rating.
  chosen.sort((a, b) => {
    const ta = THEMES.indexOf(a.themes[0]), tb = THEMES.indexOf(b.themes[0]);
    if (ta !== tb) return ta - tb;
    return a.rating - b.rating || a.id.localeCompare(b.id);
  });

  for (const p of chosen) p.url = `https://lichess.org/training/${p.id}`;

  const out = {
    generated: new Date().toISOString(),
    source: 'https://database.lichess.org/#puzzles',
    license: 'CC0-1.0',
    puzzles: chosen.map((p) => ({
      id: p.id, fen: p.fen, sol: p.sol, san: p.san,
      themes: p.themes, rating: p.rating, url: p.url,
    })),
  };

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(out));

  const counts = {};
  for (const t of THEMES) counts[t] = out.puzzles.filter((p) => p.themes.includes(t)).length;
  console.error(`wrote ${out.puzzles.length} puzzles -> ${opts.out}`);
  console.error(`size: ${(statSync(opts.out).size / 1e6).toFixed(3)} MB`);
  console.error('themes: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
}

main().catch((e) => { console.error(e); process.exit(1); });
