// tests/data.test.mjs — the bundled datasets must be legal chess, not just JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from '../vendor/chess.mjs';
import { applyUci } from '../js/core/chessutil.js';
import { parseGame } from '../js/core/pgn.js';

const openings = JSON.parse(readFileSync(new URL('../data/openings.json', import.meta.url), 'utf8'));
const puzzles = JSON.parse(readFileSync(new URL('../data/puzzles.json', import.meta.url), 'utf8'));
const famous = JSON.parse(readFileSync(new URL('../data/famous-games.json', import.meta.url), 'utf8'));

test('openings: every line replays legally from the start position', () => {
  assert.ok(openings.openings.length > 3000, `only ${openings.openings.length} openings`);
  let checked = 0;
  const bad = [];
  for (const o of openings.openings) {
    assert.ok(o.eco && /^[A-E]\d\d$/.test(o.eco), `bad eco ${o.eco} for ${o.name}`);
    assert.ok(o.name && o.name.length > 2, 'missing name');
    assert.ok(Array.isArray(o.moves) && o.moves.length > 0, `missing moves for ${o.name}`);
    assert.equal(o.plies, o.moves.length, `plies mismatch for ${o.name}`);
    const c = new Chess();
    let ok = true;
    for (const san of o.moves) {
      try { c.move(san); } catch (e) { ok = false; break; }
    }
    if (!ok) bad.push(o.name);
    else {
      assert.equal(c.fen(), o.fen, `fen mismatch for ${o.name}`);
      checked++;
    }
  }
  assert.deepEqual(bad, [], `illegal opening lines: ${bad.slice(0, 5).join(', ')}`);
  assert.equal(checked, openings.openings.length);
});

test('starter packs: every line is legal and the index matches the files', () => {
  const idxPath = new URL('../data/packs/index.json', import.meta.url);
  const index = JSON.parse(readFileSync(idxPath, 'utf8'));
  assert.ok(index.packs.length >= 3, `only ${index.packs.length} packs`);
  for (const meta of index.packs) {
    const file = new URL('../data/packs/' + meta.file, import.meta.url);
    const pack = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(pack.id, meta.id);
    assert.equal(pack.name, meta.name);
    assert.ok(['w', 'b'].includes(pack.color), `${pack.id}: colour`);
    assert.ok(Array.isArray(pack.moves) && pack.moves.length > 20, `${pack.id}: ${pack.moves.length} lines`);
    assert.equal(pack.lines, pack.moves.length, `${pack.id}: line count`);
    assert.equal(pack.lines, meta.lines, `${pack.id}: index line count`);
    assert.equal(pack.nodes, meta.nodes, `${pack.id}: index node count`);
    let checked = 0;
    for (const line of pack.moves) {
      assert.ok(line.length >= 8 && line.length <= 40, `${pack.id}: odd line length ${line.length}`);
      const c = new Chess();
      for (const san of line) {
        assert.doesNotThrow(() => c.move(san), `${pack.id}: illegal move ${san}`);
      }
      checked++;
    }
    assert.equal(checked, pack.moves.length);
  }
});

test('openings: ids are unique', () => {
  const ids = new Set(openings.openings.map((o) => o.id));
  assert.equal(ids.size, openings.openings.length);
});

test('puzzles: 1000+ puzzles, every solution line legal, mate themes end in mate', () => {
  assert.ok(puzzles.puzzles.length >= 1000, `only ${puzzles.puzzles.length} puzzles`);
  assert.equal(puzzles.license, 'CC0-1.0');
  const ids = new Set();
  const bad = [];
  let mateChecked = 0;
  for (const p of puzzles.puzzles) {
    if (ids.has(p.id)) { bad.push(`${p.id}: duplicate`); continue; }
    ids.add(p.id);
    let c;
    try { c = new Chess(p.fen); } catch (e) { bad.push(`${p.id}: illegal fen`); continue; }
    if (!Array.isArray(p.sol) || !p.sol.length) { bad.push(`${p.id}: empty solution`); continue; }
    let k = 0;
    let last = null;
    for (const uci of p.sol) {
      const r = applyUci(c.fen(), uci);
      if (!r) { bad.push(`${p.id}: illegal move ${uci} at ${k}`); break; }
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
      last = r;
      k++;
    }
    if (k !== p.sol.length) continue;
    const mateTheme = (p.themes || []).some((t) => /^mateIn\d$/.test(t));
    if (mateTheme) {
      if (!c.isCheckmate()) bad.push(`${p.id}: mate theme but no mate`);
      else mateChecked++;
    }
    if (!p.rating || p.rating < 400 || p.rating > 3000) bad.push(`${p.id}: odd rating ${p.rating}`);
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} puzzle problems`);
  assert.equal(bad.length, 0);
  assert.ok(mateChecked > 200, `expected many mate puzzles, got ${mateChecked}`);
});

test('puzzles: solution length matches san length and sides alternate', () => {
  for (const p of puzzles.puzzles.slice(0, 400)) {
    assert.ok(Array.isArray(p.san), `${p.id}: san missing`);
    assert.equal(p.san.length, p.sol.length, `${p.id}: san/sol length mismatch`);
    for (const s of p.san) assert.ok(s.length >= 2, `${p.id}: bad san ${s}`);
  }
});

test('puzzles: required theme coverage for the filter UI', () => {
  const counts = new Map();
  for (const p of puzzles.puzzles) for (const t of p.themes || []) counts.set(t, (counts.get(t) || 0) + 1);
  for (const need of ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'sacrifice', 'backRankMate', 'endgame']) {
    assert.ok((counts.get(need) || 0) >= 8, `theme ${need} only has ${counts.get(need) || 0} puzzles`);
  }
});

test('famous games: 30+ games replayed move by move, PGN agrees with the move list', () => {
  assert.ok(famous.games.length >= 30, `only ${famous.games.length} games`);
  const ids = new Set();
  for (const g of famous.games) {
    assert.ok(g.id && !ids.has(g.id), `duplicate/missing id ${g.id}`);
    ids.add(g.id);
    const moves = Array.isArray(g.moves) ? g.moves : String(g.moves || '').trim().split(/\s+/);
    assert.ok(moves.length >= 20, `${g.id}: only ${moves.length} plies`);
    const c = new Chess();
    for (const san of moves) {
      assert.doesNotThrow(() => c.move(san), `${g.id}: illegal move ${san}`);
    }
    // the stored PGN must describe the same game
    if (g.pgn) {
      const parsed = parseGame(g.pgn);
      assert.deepEqual(parsed.moves, moves, `${g.id}: pgn movetext differs from moves`);
    }
    assert.ok(g.source && /^https?:/.test(g.source), `${g.id}: missing source url`);
    assert.ok(g.white && g.black, `${g.id}: missing players`);
  }
});

test('famous games: sources are distinct per game and the Opera Game is present', () => {
  const opera = famous.games.find((g) => /morphy/i.test(g.white) && g.year === 1858);
  assert.ok(opera, 'Opera Game missing');
  const sources = famous.games.map((g) => g.source).filter(Boolean);
  assert.ok(new Set(sources).size >= 5, 'sources look copy-pasted');
});
