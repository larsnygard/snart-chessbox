// tests/core.test.mjs — pure logic: eval spread, PGN, repertoire, review, SRS, backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { candidatesWithin, pickWithin, rankLines, mulberry32, DEFAULT_SPREAD_CP } from '../js/core/evalband.js';
import { parsePGN, parseGame, buildPGN, cleanMovetext, movetextTokens, splitGames, wrapMovetext } from '../js/core/pgn.js';
import { emptyTree, addLine, buildFromGames, prune, treeLines, treeStats, annotateLosses, dropBadMoves, findMoveNode, movesAt, pickBookMove } from '../js/core/repertoire.js';
import { classify, reviewMoves, reviewSummary, blunderArrows, lossCp } from '../js/core/moveclass.js';
import { review, newSrs, mastery, isDue } from '../js/core/srs.js';
import { buildQuestionPlan, checkAnswer, questionContext, replayable } from '../js/core/memory.js';
import { makeBundle, parseBundle, serializeBundle, mergeById, mergeProgress, BUNDLE_FORMAT } from '../js/core/backup.js';
import { ENDGAME_DRILLS, judgeDrill } from '../js/core/endgames.js';
import { makeSet, makeItem, expandSet, moveItem, removeItem } from '../js/core/sets.js';
import { applyUci, sanToUci, endgameInfo, material, scoreToCp, winProbability, START_FEN } from '../js/core/chessutil.js';

// ------------------------------------------------------------------ eval spread
test('eval band keeps the best move and everything within the spread', () => {
  const lines = [
    { move: 'e2e4', score: { cp: 130 } },
    { move: 'd2d4', score: { cp: 90 } },
    { move: 'g1f3', score: { cp: 30 } },
    { move: 'h2h4', score: { cp: -320 } },
  ];
  const pool = candidatesWithin(lines, 100);
  assert.deepEqual(pool.map((l) => l.move), ['e2e4', 'd2d4', 'g1f3']);
  assert.ok(!pool.some((l) => l.move === 'h2h4'), 'losing move must be excluded');
});

test('spread 0 only ever returns the best move', () => {
  const lines = [
    { move: 'e2e4', score: { cp: 40 } },
    { move: 'd2d4', score: { cp: 35 } },
  ];
  const rng = mulberry32(7);
  for (let i = 0; i < 30; i++) assert.equal(pickWithin(lines, 0, rng).move, 'e2e4');
});

test('a forced mate is never traded for a non-mate', () => {
  const lines = [
    { move: 'h5f7', score: { mate: 2 } },
    { move: 'd1h5', score: { cp: 900 } },
  ];
  const pool = candidatesWithin(lines, 2000);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].move, 'h5f7');
});

test('mate against us is excluded when a normal move exists', () => {
  const lines = [
    { move: 'a2a3', score: { cp: 20 } },
    { move: 'b2b3', score: { mate: -1 } },
  ];
  const pool = candidatesWithin(lines, 150);
  assert.deepEqual(pool.map((l) => l.move), ['a2a3']);
});

test('uniform weighting can pick every candidate; best weighting never deviates', () => {
  const lines = [
    { move: 'a2a3', score: { cp: 100 } },
    { move: 'b2b3', score: { cp: 95 } },
    { move: 'c2c3', score: { cp: 90 } },
  ];
  const seen = new Set();
  const rng = mulberry32(99);
  for (let i = 0; i < 200; i++) seen.add(pickWithin(lines, 20, rng, 'uniform').move);
  assert.equal(seen.size, 3);
  const rng2 = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.equal(pickWithin(lines, 30, rng2, 'best').move, 'a2a3');
});

test('rankLines sorts by value and drops empty entries', () => {
  const ranked = rankLines([{ move: 'a2a3', score: { cp: 10 } }, { move: null, score: { cp: 99 } }, { move: 'b2b3', score: { mate: 3 } }]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].move, 'b2b3');
});

test('scoreToCp and winProbability behave', () => {
  assert.ok(scoreToCp({ mate: 1 }) > 90000);
  assert.ok(scoreToCp({ mate: -1 }) < -90000);
  assert.equal(scoreToCp({ cp: 25 }), 25);
  assert.ok(winProbability(0) === 50);
  assert.ok(winProbability(300) > 70);
  assert.ok(winProbability(-300) < 30);
});

// ------------------------------------------------------------------ PGN
const SAMPLE = `[Event "Test"]
[Site "?"]
[Date "2026.01.01"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 {king pawn} e5 2. Nf3 (2. f4 exf4) Nc6 3. Bb5 a6 $1 4. Ba4 Nf6 5. O-O 1-0

[Event "Second"]
[White "Carol"]
[Black "Dan"]
[Result "0-1"]

1. d4 d5 2. c4 e6 0-1
`;

test('PGN file with comments, variations and two games parses', () => {
  const games = parsePGN(SAMPLE);
  assert.equal(games.length, 2);
  assert.deepEqual(games[0].moves, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
  assert.equal(games[0].headers.White, 'Alice');
  assert.equal(games[1].moves.length, 4);
  assert.equal(games[0].errors.length, 0);
});

test('cleanMovetext strips nested variations and comments', () => {
  const out = cleanMovetext('1. e4 {hello (x)} (1. d4 d5 (1... Nf6)) e5');
  assert.ok(!out.includes('('));
  assert.ok(!out.includes('{'));
  assert.deepEqual(movetextTokens(out), ['e4', 'e5']);
});

test('splitGames does not merge two header blocks', () => {
  assert.equal(splitGames(SAMPLE).length, 2);
});

test('wrapMovetext numbers black-first lines correctly', () => {
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const out = wrapMovetext(['e5', 'Nf3'], fen);
  assert.match(out, /1\.\.\. e5 2\. Nf3/);
});

test('buildPGN round-trips through the parser', () => {
  const pgn = buildPGN({ headers: { White: 'X', Black: 'Y', Result: '1-0' }, moves: ['e4', 'e5', 'Nf3'], result: '1-0' });
  const back = parseGame(pgn);
  assert.deepEqual(back.moves, ['e4', 'e5', 'Nf3']);
  assert.equal(back.headers.White, 'X');
  assert.equal(back.result, '1-0');
});

test('illegal moves are reported, not silently dropped', () => {
  const g = parseGame('[White "A"]\n\n1. e4 e5 2. Qxf9');
  assert.equal(g.errors.length, 1);
  assert.equal(g.moves.length, 2);
});

test('SAN→UCI conversion covers castling and promotion', () => {
  const fen = '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1';
  const r = sanToUci(fen, ['b8=Q+']);
  assert.equal(r.ucis[0], 'b7b8q');
  const cast = sanToUci('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O']);
  assert.equal(cast.ucis[0], 'e1g1');
});

// ------------------------------------------------------------------ repertoire
const gamesFixture = [
  { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { moves: ['e4', 'c5', 'Nf3', 'Nc6', 'Bb5', 'g6'] },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
];

test('buildFromGames counts branch frequency', () => {
  const tree = buildFromGames(gamesFixture, { color: 'w', maxPly: 20 });
  assert.equal(tree.moves.length, 1);
  const e5 = tree.moves[0];
  const c5 = e5.children.moves.find((m) => m.san === 'c5');
  assert.equal(c5.count, 3);
  const nf3 = c5.children.moves.find((m) => m.san === 'Nf3');
  assert.equal(nf3.count, 3);
  const stats = treeStats(tree);
  assert.ok(stats.nodes > 8, `expected several nodes, got ${stats.nodes}`);
  assert.ok(treeLines(tree).length >= 2);
});

test('prune keeps only branches above the frequency threshold', () => {
  const tree = buildFromGames(gamesFixture, { color: 'w', maxPly: 20 });
  prune(tree, { minCount: 2 });
  const e4 = tree.moves[0];
  const replies = e4.children.moves.map((m) => m.san);
  assert.deepEqual(replies, ['c5']);
});

test('addLine creates nodes and findMoveNode walks them', () => {
  const tree = emptyTree('w');
  const res = addLine(tree, ['d4', 'd5', 'c4']);
  assert.ok(res.ok);
  const node = findMoveNode(tree, ['d4', 'd5']);
  assert.deepEqual(movesAt(node).map((m) => m.san), ['c4']);
  const bad = addLine(tree, ['d4', 'd5', 'Qh9']);
  assert.equal(bad.ok, false);
});

test('annotateLosses marks and dropBadMoves removes losing branches', () => {
  const tree = emptyTree('w');
  addLine(tree, ['e4', 'e5', 'Qh5', 'Nc6']);
  addLine(tree, ['e4', 'e5', 'Nf3', 'Nc6']);
  const root = findMoveNode(tree, ['e4', 'e5']);
  const evals = new Map();
  for (const m of root.moves) {
    evals.set(`${root.fen}|${m.uci}`, m.san === 'Qh5' ? -200 : 40);
  }
  const rejected = annotateLosses(tree, evals, 100);
  assert.equal(rejected.length, 1);
  const removed = dropBadMoves(tree);
  assert.equal(removed, 1);
  assert.deepEqual(movesAt(findMoveNode(tree, ['e4', 'e5'])).map((m) => m.san), ['Nf3']);
});

test('pickBookMove respects weights', () => {
  const moves = [{ san: 'a', uci: 'a2a3', count: 9 }, { san: 'b', uci: 'b2b3', count: 1 }];
  const rng = mulberry32(1);
  let a = 0;
  for (let i = 0; i < 500; i++) if (pickBookMove(moves, rng).san === 'a') a++;
  assert.ok(a > 350, `expected the popular move to dominate, got ${a}/500`);
});

// ------------------------------------------------------------------ move review
test('move classification thresholds', () => {
  assert.equal(classify(30, 30), 'best');
  assert.equal(classify(30, 10), 'good');
  assert.equal(classify(120, 40), 'inaccuracy');
  assert.equal(classify(300, 150), 'mistake');
  assert.equal(classify(600, -200), 'blunder');
  assert.equal(lossCp(100, 20), 80);
});

test('reviewMoves only grades the user and produces red arrows', () => {
  const rows = reviewMoves([
    { ply: 0, uci: 'e2e4', san: 'e4', moverColor: 'w', cp: 20, bestCp: 20, bestUci: 'e2e4' },
    { ply: 1, uci: 'a7a6', san: 'a6', moverColor: 'b', cp: 20, bestCp: 20, bestUci: 'a7a6' },
    { ply: 2, uci: 'f1c4', san: 'Bc4', moverColor: 'w', cp: -500, bestCp: 200, bestUci: 'g1f3' },
  ], 'w');
  assert.equal(rows[1].cls, null);
  assert.equal(rows[2].cls, 'blunder');
  const summary = reviewSummary(rows, 'w');
  assert.equal(summary.counts.blunder, 1);
  const arrows = blunderArrows(rows, { minClass: 'mistake' });
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].bestFrom, 'g1');
});

// ------------------------------------------------------------------ srs
test('srs ladder moves forward on success and back on failure', () => {
  const now = 1_700_000_000_000;
  let item = newSrs(now);
  item = review(item, true, now);
  assert.equal(item.box, 1);
  assert.ok(item.due > now);
  assert.equal(isDue(item, now), false);
  const afterFail = review(item, false, now);
  assert.equal(afterFail.box, 0);
  assert.equal(afterFail.lapses, 1);
  assert.equal(mastery({ a: { box: 4 }, b: { box: 0 } }), 50);
});

// ------------------------------------------------------------------ memory
test('memory question plan respects side and ply range', () => {
  const game = { moves: ['e4', 'e5', 'Nf3', 'Nc6'], ucis: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], startFen: START_FEN };
  const plan = buildQuestionPlan(game, { fromPly: 0, toPly: 4, side: 'w' });
  assert.deepEqual(plan.map((q) => q.ply), [0, 2]);
  const ctx = questionContext(game, 2);
  assert.equal(ctx.expectedSan, 'Nf3');
  assert.equal(ctx.fen.split(' ')[1], 'w');
  assert.ok(checkAnswer('g1f3', 'g1f3'));
  assert.ok(!checkAnswer('g1f3', 'b1c3'));
  assert.ok(checkAnswer('b7b8q', 'b7b8'));
});

test('replayable() validates a whole game', () => {
  const ok = replayable({ startFen: START_FEN, moves: ['e4', 'e5', 'Nf3'] });
  assert.equal(ok.ok, true);
  const bad = replayable({ startFen: START_FEN, moves: ['e4', 'e5', 'Nf6'] });
  assert.equal(bad.ok, false);
});

// ------------------------------------------------------------------ backup
test('bundle round-trip and merge strategies', () => {
  const bundle = makeBundle({
    settings: { thinkMs: 300 },
    repertoires: [{ id: 'r1', name: 'A', updated: 5 }],
    sets: [{ id: 's1', name: 'Set', updated: 5 }],
    games: [{ id: 'g1', moves: ['e4'], updated: 5 }],
    memoryGames: [],
    progress: { 'puzzle:x': { box: 1, due: 10, seen: 1, ok: 1 } },
  });
  assert.equal(bundle.format, BUNDLE_FORMAT);
  const parsed = parseBundle(serializeBundle(bundle));
  assert.equal(parsed.repertoires.length, 1);
  assert.equal(parsed.settings.thinkMs, 300);

  const merged = mergeById([{ id: 'r1', name: 'old', updated: 1 }], [{ id: 'r1', name: 'new', updated: 9 }]);
  assert.equal(merged[0].name, 'new');
  const kept = mergeById([{ id: 'r1', name: 'old', updated: 99 }], [{ id: 'r1', name: 'new', updated: 9 }]);
  assert.equal(kept[0].name, 'old');
  const replaced = mergeById([{ id: 'r1' }], [{ id: 'r2' }], { mode: 'replace' });
  assert.deepEqual(replaced.map((x) => x.id), ['r2']);

  const progress = mergeProgress({ a: { box: 2, seen: 3, due: 50 } }, { a: { box: 1, seen: 9, due: 10 } });
  assert.equal(progress.a.box, 2);
  assert.equal(progress.a.seen, 9);
  assert.equal(progress.a.due, 10);

  assert.throws(() => parseBundle('{"nope":1}'), /Not a Snart Chess Trainer backup/);
});

// ------------------------------------------------------------------ endgames
test('every endgame drill has a legal position and sane metadata', () => {
  for (const d of ENDGAME_DRILLS) {
    const moves = applyUci(d.fen, null);
    assert.equal(moves, null);
    const info = endgameInfo(d.fen);
    assert.ok(info.label.length > 0);
    assert.ok(d.maxMoves > 0, d.id);
    assert.ok(['w', 'b'].includes(d.side), d.id);
    assert.ok(['mate', 'promote', 'hold'].includes(d.goal), d.id);
    const m = material(d.fen);
    assert.equal(m.w.k, 1, `${d.id} must have one white king`);
    assert.equal(m.b.k, 1, `${d.id} must have one black king`);
  }
});

test('judgeDrill recognises mate, stalemate and draw', () => {
  assert.equal(judgeDrill({ goal: 'mate', maxMoves: 5, movesPlayed: 2, state: { mate: true } }).status, 'win');
  assert.equal(judgeDrill({ goal: 'mate', maxMoves: 5, movesPlayed: 2, state: { stalemate: true } }).status, 'fail');
  assert.equal(judgeDrill({ goal: 'promote', maxMoves: 5, movesPlayed: 2, state: { promo: 'q' } }).status, 'win');
  assert.equal(judgeDrill({ goal: 'hold', maxMoves: 5, movesPlayed: 5, state: {} }).status, 'win');
  assert.equal(judgeDrill({ goal: 'mate', maxMoves: 5, movesPlayed: 5, state: {} }).status, 'fail');
  assert.equal(judgeDrill({ goal: 'mate', maxMoves: 9, movesPlayed: 1, state: {} }).status, 'running');
});

// ------------------------------------------------------------------ sets
test('set expansion resolves puzzle runs by theme', () => {
  const set = makeSet({ name: 'S', items: [makeItem('puzzles', null, { themes: ['fork'], count: 3 }), makeItem('endgame', 'kqk-1')] });
  const puzzles = [
    { id: 'p1', themes: ['fork'] }, { id: 'p2', themes: ['fork'] }, { id: 'p3', themes: ['pin'] }, { id: 'p4', themes: ['fork'] },
  ];
  const q = expandSet(set, { puzzles }, mulberry32(2));
  assert.equal(q.length, 4);
  assert.equal(q[0].kind, 'puzzle');
  assert.ok(q.slice(0, 3).every((x) => ['p1', 'p2', 'p4'].includes(x.ref)));
  assert.equal(q[3].kind, 'endgame');
  const again = expandSet(set, { puzzles }, mulberry32(3));
  assert.deepEqual(again.filter((x) => x.kind === 'puzzle').map((x) => x.ref).sort(), ['p1', 'p2', 'p4']);
});

test('set item operations mutate order and remove by id', () => {
  const a = makeItem('endgame', 'kqk-1');
  const b = makeItem('endgame', 'krk-1');
  const set = makeSet({ name: 'S', items: [a, b] });
  moveItem(set, b.id, -1);
  assert.equal(set.items[0].id, b.id);
  removeItem(set, b.id);
  assert.equal(set.items.length, 1);
});
