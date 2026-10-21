// tests/ratings.test.mjs — the Elo filters on the PGN database: reading ratings
// out of PGN headers and the range test that backs "2000-2300" and "2700+".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ratingsFrom, ratingInRange, parsePGN } from '../js/core/pgn.js';

test('ratings come from WhiteElo / BlackElo', () => {
  const elo = ratingsFrom({ WhiteElo: '2839', BlackElo: '2751' });
  assert.deepEqual(elo, { whiteElo: 2839, blackElo: 2751 });
});

test('the other spellings in the wild are accepted', () => {
  assert.deepEqual(ratingsFrom({ WhiteRating: '2100', BlackRating: '2050' }), { whiteElo: 2100, blackElo: 2050 });
  assert.deepEqual(ratingsFrom({ 'White rating': '1900', 'Black rating': '1880' }), { whiteElo: 1900, blackElo: 1880 });
  // a value with junk around the digits is still a rating
  assert.deepEqual(ratingsFrom({ WhiteElo: ' 2650 ', BlackElo: '?' }), { whiteElo: 2650, blackElo: 0 });
});

test('a game without ratings reads as zero, never NaN', () => {
  assert.deepEqual(ratingsFrom({}), { whiteElo: 0, blackElo: 0 });
  assert.deepEqual(ratingsFrom(), { whiteElo: 0, blackElo: 0 });
  assert.deepEqual(ratingsFrom({ WhiteElo: '-', BlackElo: '0' }), { whiteElo: 0, blackElo: 0 });
});

test('no bounds means every game passes, rated or not', () => {
  assert.equal(ratingInRange(0, 0, 0), true);
  assert.equal(ratingInRange(2700, 0, 0), true);
  assert.equal(ratingInRange(undefined), true);
});

test('2700+ is a lower bound on its own', () => {
  assert.equal(ratingInRange(2700, 2700, 0), true);
  assert.equal(ratingInRange(2699, 2700, 0), false);
  assert.equal(ratingInRange(0, 2700, 0), false, 'an unrated game cannot prove it belongs');
});

test('2000-2300 includes both ends', () => {
  assert.equal(ratingInRange(2000, 2000, 2300), true);
  assert.equal(ratingInRange(2300, 2000, 2300), true);
  assert.equal(ratingInRange(2001, 2000, 2300), true);
  assert.equal(ratingInRange(1999, 2000, 2300), false);
  assert.equal(ratingInRange(2301, 2000, 2300), false);
});

test('an upper bound alone works too', () => {
  assert.equal(ratingInRange(1800, 0, 2000), true);
  assert.equal(ratingInRange(2001, 0, 2000), false);
  assert.equal(ratingInRange(0, 0, 2000), false);
});

test('a parsed PGN game carries the ratings of its headers', () => {
  const pgn = `[Event "Test"]
[White "Carlsen, Magnus"]
[Black "Nakamura, Hikaru"]
[WhiteElo "2839"]
[BlackElo "2780"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 1-0`;
  const [game] = parsePGN(pgn);
  assert.equal(game.moves.length, 6);
  assert.deepEqual(ratingsFrom(game.headers), { whiteElo: 2839, blackElo: 2780 });
});
