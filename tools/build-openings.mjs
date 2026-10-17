// tools/build-openings.mjs — build data/openings.json from the Lichess opening
// database (github.com/lichess-org/chess-openings, CC0).
//
// Each entry: { id, eco, name, moves:[san...], plies, fen (final position) }
// The app only needs SAN + the final FEN (for preview thumbnails).
import { writeFileSync } from 'node:fs';
import { Chess } from '../vendor/chess.mjs';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const FILES = ['a', 'b', 'c', 'd', 'e'];
const OUT = new URL('../data/openings.json', import.meta.url);

const rows = [];
for (const f of FILES) {
  const res = await fetch(BASE + f + '.tsv');
  if (!res.ok) throw new Error(`download failed: ${f}.tsv ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    if (!eco || !name || !pgn) continue;
    rows.push({ eco, name, pgn });
  }
}

const out = [];
const seen = new Set();
let skipped = 0;
for (const r of rows) {
  // Strip move numbers and results from the TSV pgn column.
  const sans = r.pgn.replace(/\d+\.(\.\.)?/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  const c = new Chess();
  let ok = true;
  for (const san of sans) { try { c.move(san); } catch (e) { ok = false; break; } }
  if (!ok || !sans.length) { skipped++; continue; }
  const id = r.eco + ':' + r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (seen.has(id)) { skipped++; continue; }
  seen.add(id);
  out.push({ id, eco: r.eco, name: r.name, moves: sans, plies: sans.length, fen: c.fen() });
}
out.sort((a, b) => a.eco.localeCompare(b.eco) || a.moves.length - b.moves.length || a.name.localeCompare(b.name));

const payload = {
  generated: new Date().toISOString(),
  source: 'https://github.com/lichess-org/chess-openings',
  license: 'CC0-1.0',
  count: out.length,
  openings: out,
};
writeFileSync(OUT, JSON.stringify(payload));
console.log(`wrote ${out.length} openings (${skipped} skipped) to data/openings.json`);
console.log('max plies:', Math.max(...out.map((o) => o.plies)));
