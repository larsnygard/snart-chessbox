// tools/build-packs.mjs — turn the bundled repertoire PGNs into starter packs.
//
// A pack is stored as line lists (arrays of SAN), not as a prebuilt tree: the
// JSON stays small (a few tens of KB) and the tree is built in the browser when
// the user adds the pack, which takes milliseconds.
//
// usage: node tools/build-packs.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitGames, parseGame } from '../js/core/pgn.js';
import { linesToTree, treeStats } from '../js/core/repertoire.js';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'pgn');
const OUT = join(ROOT, 'data', 'packs');

const PACKS = [
  {
    id: 'rubinstein-white',
    file: 'repertoire-white_Rubinstein.pgn',
    name: 'Rubinstein — White',
    color: 'w',
    description: 'Akiba Rubinstein’s White repertoire: 1.d4 systems with an early Nf3, the Rubinstein System against the Nimzo, and his QGD treatment.',
    source: 'Rubinstein’s games from the bundled master database',
  },
  {
    id: 'rubinstein-black',
    file: 'repertoire-black_Rubinstein.pgn',
    name: 'Rubinstein — Black',
    color: 'b',
    description: 'Rubinstein’s Black repertoire: a Ruy Lopez line, the French and his aggressive replies to 1.d4.',
    source: 'Rubinstein’s games from the bundled master database',
  },
  {
    id: 'caro-kann-black',
    file: 'repertoire-black_caro-kann.pgn',
    name: 'Caro-Kann — Black',
    color: 'b',
    description: 'Caro-Kann lines against 1.e4: the main 3.exd5 cxd5 structure with Bd3/c3/Nf3, taken from the games in the database.',
    source: 'Caro-Kann games from the bundled master database',
  },
];

mkdirSync(OUT, { recursive: true });
const index = [];

for (const spec of PACKS) {
  const raw = readFileSync(join(SRC, spec.file), 'utf8');
  const games = splitGames(raw);
  const lines = [];
  let dropped = 0;
  let maxPlies = 0;
  for (const g of games) {
    let parsed;
    try { parsed = parseGame(g); } catch (e) { dropped++; continue; }
    if (!parsed.moves.length || parsed.errors.length) { dropped++; continue; }
    lines.push(parsed.moves);
    maxPlies = Math.max(maxPlies, parsed.moves.length);
  }
  // dedupe identical lines while keeping order
  const seen = new Set();
  const unique = lines.filter((l) => {
    const k = l.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const tree = linesToTree(unique, spec.color);
  const stats = treeStats(tree);
  const payload = {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    description: spec.description,
    source: spec.source,
    generated: new Date().toISOString().slice(0, 10),
    lines: unique.length,
    duplicates: lines.length - unique.length,
    maxPlies,
    nodes: stats.nodes,
    leaves: stats.leaves,
    moves: unique,
  };
  const file = `${spec.id}.json`;
  writeFileSync(join(OUT, file), JSON.stringify(payload));
  index.push({
    id: spec.id, name: spec.name, color: spec.color, description: spec.description,
    source: spec.source, file, lines: payload.lines, nodes: payload.nodes,
    maxPlies: payload.maxPlies, duplicates: payload.duplicates,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
  });
  console.log(`${spec.id}: ${payload.lines} lines (${payload.duplicates} dupes dropped), ${stats.nodes} nodes, ${stats.leaves} leaves, ${payload.bytes ? '' : ''}${Math.round(Buffer.byteLength(JSON.stringify(payload)) / 1024)} KB`);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  packs: index,
}, null, 1));

const total = readdirSync(OUT).reduce((n, f) => n + Buffer.byteLength(readFileSync(join(OUT, f))), 0);
console.log(`\nwrote ${index.length} packs to data/packs (${Math.round(total / 1024)} KB total)`);
