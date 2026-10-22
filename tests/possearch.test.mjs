// tests/possearch.test.mjs — searching a database by position: the position key,
// FEN normalisation, and the replay that decides whether a game reaches it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  positionKey, normaliseFen, matchPly, findPosition,
  hashKey, gamePositionHashes, indexOffsets, lookupHashes,
} from '../js/core/possearch.js';
import { START_FEN, sanToUci, applyUci } from '../js/core/chessutil.js';

const ITALIAN = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4'];
const START = positionKey(START_FEN);

/** FEN after `n` plies of a SAN line. */
function fenAfter(sans, n = sans.length) {
  let fen = START_FEN;
  for (let i = 0; i < n; i++) {
    const uci = sanToUci(fen, [sans[i]]).ucis[0];
    const res = applyUci(fen, uci);
    fen = res.fen;
  }
  return fen;
}

test('the position key is the placement plus the side to move', () => {
  assert.equal(positionKey(START_FEN), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  assert.equal(positionKey('4k3/8/8/8/8/8/8/4K3 b - - 12 40'), '4k3/8/8/8/8/8/8/4K3 b');
  assert.equal(positionKey('not a fen'), null);
  assert.equal(positionKey('4k3/8/8/8/8/8/8/4K3'), null, 'a side to move is required');
  assert.equal(positionKey('4k3/8/8/8/8/8/8/4K3 x - - 0 1'), null);
});

test('castling, en passant and the clocks are not part of the position', () => {
  const a = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const b = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w - - 22 60');
  assert.equal(a, b);
});

test('a pasted FEN or the book shorthand both normalise', () => {
  assert.equal(normaliseFen('4k3/8/8/8/8/8/8/4K3 w'), '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(normaliseFen('  4k3/8/8/8/8/8/8/4K3   b  '), '4k3/8/8/8/8/8/8/4K3 b - - 0 1');
  assert.equal(normaliseFen('4k3/8/8/8/8/8/8/4K3 w KQ - 3 9'), '4k3/8/8/8/8/8/8/4K3 w KQ - 3 9');
  assert.equal(normaliseFen(''), null);
  assert.equal(normaliseFen('hello'), null);
});

test('the game start counts as a match at ply 0', () => {
  assert.equal(matchPly(START, START_FEN, ITALIAN), 0);
});

test('a later position is found at the right ply', () => {
  const afterE4 = positionKey(fenAfter(ITALIAN, 1));
  assert.equal(matchPly(afterE4, START_FEN, ITALIAN), 1);
  const afterTen = positionKey(fenAfter(ITALIAN, ITALIAN.length));
  assert.equal(matchPly(afterTen, START_FEN, ITALIAN), ITALIAN.length);
});

test('the side to move must match — the same pieces one ply apart are not it', () => {
  const afterE4 = positionKey(fenAfter(ITALIAN, 1));        // White's move made, Black to move
  const samePiecesWhiteToMove = afterE4.replace(/ [wb]$/, ' w');
  assert.equal(matchPly(samePiecesWhiteToMove, START_FEN, ITALIAN), -1);
});

test('a position the game never reaches is not a match', () => {
  const london = positionKey(fenAfter(['d4', 'd5', 'Bf4'], 3));
  assert.equal(matchPly(london, START_FEN, ITALIAN), -1);
});

test('games from a custom start position are replayed from that FEN', () => {
  const study = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1';
  const startKey = positionKey(study);
  assert.equal(matchPly(startKey, study, ['Kxa2']), 0);
});

test('findPosition returns the id and ply of every game that holds it', () => {
  const games = [
    { id: 'a', startFen: START_FEN, moves: ITALIAN },
    { id: 'b', startFen: START_FEN, moves: ['d4', 'd5', 'Bf4'] },
    { id: 'c', startFen: START_FEN, moves: ITALIAN.slice(0, 2) },
  ];
  const target = fenAfter(ITALIAN, 4);
  const hits = findPosition(target, games);
  assert.deepEqual(hits, [{ id: 'a', ply: 4 }]);
  assert.deepEqual(findPosition(START_FEN, games).map((h) => h.id), ['a', 'b', 'c']);
});

test('an invalid FEN simply matches nothing', () => {
  assert.deepEqual(findPosition('nonsense', [{ id: 'a', startFen: START_FEN, moves: ITALIAN }]), []);
});

// ------------------------------------------------------------------ the index
test('the hash is a stable 32-bit number per position', () => {
  const a = hashKey(positionKey(START_FEN));
  const b = hashKey(positionKey('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w - - 0 1'));
  assert.equal(a, hashKey(positionKey(START_FEN)), 'same position, same hash');
  assert.notEqual(a, b);
  for (const v of [a, b]) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff, `not a uint32: ${v}`);
  }
});

test('a game hashes its start position and then every ply', () => {
  const hashes = gamePositionHashes(START_FEN, ITALIAN);
  assert.equal(hashes.length, ITALIAN.length + 1);
  assert.ok(hashes instanceof Uint32Array);
  assert.equal(hashes[0], hashKey(positionKey(START_FEN)));
  assert.equal(hashes[ITALIAN.length], hashKey(positionKey(fenAfter(ITALIAN))));
  // and the position after ply 4 sits at index 4
  assert.equal(hashes[4], hashKey(positionKey(fenAfter(ITALIAN, 4))));
});

test('offsets and lookup map a hash back to the game and the ply', () => {
  const games = [
    { start: START_FEN, moves: ITALIAN },
    { start: START_FEN, moves: ['d4', 'd5', 'Bf4'] },
    { start: START_FEN, moves: ITALIAN.slice(0, 2) },
  ];
  const perGame = games.map((g) => gamePositionHashes(g.start, g.moves));
  const counts = perGame.map((h) => h.length);
  const offsets = indexOffsets(counts);
  const flat = new Uint32Array(counts.reduce((a, b) => a + b, 0));
  let at = 0;
  for (const h of perGame) { flat.set(h, at); at += h.length; }

  const startHits = lookupHashes(flat, offsets, counts, hashKey(positionKey(START_FEN)));
  assert.deepEqual(startHits, [
    { game: 0, ply: 0 }, { game: 1, ply: 0 }, { game: 2, ply: 0 },
  ]);

  const afterFour = hashKey(positionKey(fenAfter(ITALIAN, 4)));
  assert.deepEqual(lookupHashes(flat, offsets, counts, afterFour), [{ game: 0, ply: 4 }]);

  const afterTwo = hashKey(positionKey(fenAfter(ITALIAN, 2)));
  assert.deepEqual(lookupHashes(flat, offsets, counts, afterTwo), [
    { game: 0, ply: 2 }, { game: 2, ply: 2 },
  ], 'the second game stops at ply 2 and still finds it');

  assert.deepEqual(lookupHashes(flat, offsets, counts, 0), [], 'a hash nothing has');
});
