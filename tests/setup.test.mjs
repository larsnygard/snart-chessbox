// tests/setup.test.mjs — the position editor's rules: squares ⇄ FEN, en passant
// candidates, and every reason a hand-built position may be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyMap, mapFromFen, mapToFen, readFen, startMap, epCandidates, validateSetup, CASTLE_RIGHTS,
} from '../js/core/setup.js';
import { START_FEN } from '../js/core/chessutil.js';
import { ENDGAME_DRILLS } from '../js/core/endgames.js';

const FEN_EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

test('board map ⇄ FEN round trip keeps the exact position', () => {
  const key = (fen) => String(fen).split(' ').slice(0, 4).join(' ');
  for (const fen of [
    START_FEN,
    '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    FEN_EMPTY,
  ]) {
    const state = readFen(fen);
    assert.equal(key(mapToFen(state.map, state)), key(fen), fen);
  }
});

test('an empty map makes an empty board FEN', () => {
  assert.equal(mapToFen(emptyMap(), { turn: 'w' }), FEN_EMPTY);
  assert.equal(mapToFen({ e4: { type: 'p', color: 'w' } }, { turn: 'b' }), '8/8/8/8/4P3/8/8/8 b - - 0 1');
});

test('the starting position needs no castling rights beyond KQkq', () => {
  const res = validateSetup(startMap(), { turn: 'w', castling: CASTLE_RIGHTS, ep: '-' });
  assert.equal(res.ok, true, res.errors.join('; '));
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.fen.split(' ')[2], 'KQkq');
});

test('a side without a king is refused', () => {
  const map = mapFromFen('8/8/8/4k3/8/8/4K3/8 w - - 0 1');
  delete map.e2;
  const res = validateSetup(map, { turn: 'w' });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /White has no king/);
});

test('two kings of one colour are refused', () => {
  const map = mapFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  map.d1 = { type: 'k', color: 'w' };
  const res = validateSetup(map, { turn: 'w' });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /White has 2 kings/);
});

test('pawns are refused on the first and last rank', () => {
  const map = mapFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  map.a1 = { type: 'p', color: 'w' };
  const res = validateSetup(map, { turn: 'w' });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /pawn cannot stand on a1/);
});

test('too many pawns or pieces are refused', () => {
  const manyPawns = mapFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  for (const f of 'abcdefgh') manyPawns[f + '2'] = { type: 'p', color: 'w' };
  manyPawns.a3 = { type: 'p', color: 'w' };
  assert.match(validateSetup(manyPawns, { turn: 'w' }).errors.join(' '), /9 pawns/);

  const manyPieces = mapFromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  let n = 0;
  for (const f of 'abcdefgh') for (const r of ['2', '3']) {
    manyPieces[f + r] = { type: n % 2 ? 'n' : 'r', color: 'w' };
    n++;
  }
  assert.match(validateSetup(manyPieces, { turn: 'w' }).errors.join(' '), /pieces \(at most 16\)/);
});

test('the side that just moved may not be left in check', () => {
  // White rook on e1, Black king on e8, White to move: Black would be in check
  // after White's "last move", which no legal game can produce.
  const map = mapFromFen('4k3/8/8/8/8/8/8/4R2K w - - 0 1');
  const illegal = validateSetup(map, { turn: 'w' });
  assert.equal(illegal.ok, false);
  assert.match(illegal.errors.join(' '), /Black is in check, but White is to move/);

  // The same position with Black to move is a normal check.
  const legal = validateSetup(map, { turn: 'b' });
  assert.equal(legal.ok, true, legal.errors.join('; '));
});

test('castling rights need the king and rook that carry them', () => {
  const map = mapFromFen(START_FEN);
  delete map.h1; // the h1 rook is gone, K must not be offered
  const res = validateSetup(map, { turn: 'w', castling: ['K', 'Q', 'k', 'q'] });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /White kingside/);
  const fixed = validateSetup(map, { turn: 'w', castling: ['Q', 'k', 'q'] });
  assert.equal(fixed.ok, true, fixed.errors.join('; '));
});

test('en passant must point at a square a capture could really use', () => {
  // Black just played e7-e5, White has a pawn on d5 → e6 is a real ep square.
  const map = mapFromFen('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1');
  assert.deepEqual(epCandidates(map, 'w'), ['e6']);
  const ok = validateSetup(map, { turn: 'w', ep: 'e6' });
  assert.equal(ok.ok, true, ok.errors.join('; '));

  // No white pawn beside it: the square is meaningless but not illegal.
  const alone = mapFromFen('4k3/8/8/4p3/8/8/8/4K3 w - e6 0 1');
  assert.deepEqual(epCandidates(alone, 'w'), []);
  const warned = validateSetup(alone, { turn: 'w', ep: 'e6' });
  assert.equal(warned.ok, true, warned.errors.join('; '));
  assert.match(warned.warnings.join(' '), /No pawn can capture on e6/);

  // Wrong rank for the side to move.
  const wrongRank = validateSetup(map, { turn: 'b', ep: 'e6' });
  assert.equal(wrongRank.ok, false);

  // The square must be empty.
  const occupied = mapFromFen('4k3/8/4N3/3Pp3/8/8/8/4K3 w - e6 0 1');
  assert.match(validateSetup(occupied, { turn: 'w', ep: 'e6' }).errors.join(' '), /must be empty/);

  // The doubled pawn has to be standing there.
  const gone = mapFromFen('4k3/8/8/3P4/8/8/8/4K3 w - e6 0 1');
  assert.match(validateSetup(gone, { turn: 'w', ep: 'e6' }).errors.join(' '), /black pawn that just moved/);
});

test('en passant candidates follow the side to move', () => {
  // White just played d2-d4: Black to move sees d3.
  const map = mapFromFen('4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1');
  assert.deepEqual(epCandidates(map, 'b'), ['d3']);
  assert.deepEqual(epCandidates(map, 'w'), []);
});

test('a finished game is legal but flagged', () => {
  // Fool's mate: checkmate with White to move.
  const fool = readFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  const mate = validateSetup(fool.map, fool);
  assert.equal(mate.ok, true, mate.errors.join('; '));
  assert.match(mate.warnings.join(' '), /Checkmate/);

  // A stalemate: Black king in the corner, White queen covering, Black to move.
  const staleState = readFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const stale = validateSetup(staleState.map, staleState);
  assert.equal(stale.ok, true, stale.errors.join('; '));
  assert.match(stale.warnings.join(' '), /Stalemate/);
});

test('every bundled drill position passes the editor’s own rules', () => {
  for (const drill of ENDGAME_DRILLS) {
    const state = readFen(drill.fen);
    const res = validateSetup(state.map, state);
    assert.equal(res.ok, true, `${drill.id} (${drill.fen}): ${res.errors.join('; ')}`);
  }
});
